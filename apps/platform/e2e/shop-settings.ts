import { closeSync, openSync, statSync, unlinkSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Dialog, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

type Db = ReturnType<typeof platformClient>;
const platformClient = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { db: { schema: "platform" }, auth: { persistSession: false } },
  );
import { demoPassword } from "./helpers";

/**
 * A shop's pricing settings are one row the whole shop shares (Settings ›
 * Pricing and tax). Browser tests that change them, or read a total that
 * depends on them (Check a price), run one at a time across every worker
 * and both widths, and put each setting back as it was when they finish,
 * pass or fail, so a run against staging leaves nothing behind.
 *
 * Only BSR is used (Mark, 15 Nov 2026): never make a settings row in the
 * Saigon or big-fleet demo shops. BSR's row may be made by the first test
 * (a clean database has none); a row on the defaults then behaves exactly
 * like no row, and BSR's currency is already fixed by its fleet's money.
 *
 * The restore goes through save_pricing_settings as the shop's owner, the
 * same function the screen uses: no service key, so it works on a deploy
 * preview too.
 */

type Settings = {
  rounding_step: string | null;
  tax_inclusive: boolean;
  coupons_enabled: boolean;
  deposit_mode: string;
  deposit_percent_bp: number | null;
  deposit_amount: string | null;
  default_tax_profile_id: string | null;
};

/** The settings row's defaults: what a shop with no row works by. */
const defaults: Settings = {
  rounding_step: null,
  tax_inclusive: true,
  coupons_enabled: false,
  deposit_mode: "none",
  deposit_percent_bp: null,
  deposit_amount: null,
  default_tax_profile_id: null,
};

/** The shop's owner, signed in through the API (not a browser). */
export async function ownerClient(
  email: string,
  slug: string,
): Promise<{ db: Db; tenantId: string }> {
  const db = platformClient();
  const { error } = await db.auth.signInWithPassword({
    email,
    password: demoPassword(),
  });
  if (error) throw error;
  const { data, error: readError } = await db
    .from("tenants")
    .select("id")
    .eq("slug", slug)
    .single();
  if (readError) throw readError;
  return { db, tenantId: data.id as string };
}

export async function readSettings(
  db: Db,
  tenantId: string,
): Promise<Settings | null> {
  const { data, error } = await db.rpc("pricing_inputs", {
    p_tenant_id: tenantId,
    p_product_ids: [],
  });
  if (error) throw error;
  return (data as { settings: Settings | null }).settings;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One test at a time per shop, across processes: an exclusive lock file. */
async function lock(slug: string): Promise<() => void> {
  const path = join(tmpdir(), `mango-e2e-pricing-settings-${slug}.lock`);
  for (;;) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, `${process.pid} ${new Date().toISOString()}`);
      closeSync(fd);
      return () => {
        try {
          unlinkSync(path);
        } catch {
          // Already gone.
        }
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      // A lock left by a run that was killed: older than any test.
      try {
        if (Date.now() - statSync(path).mtimeMs > 10 * 60_000) unlinkSync(path);
      } catch {
        // Released meanwhile.
      }
      await sleep(250);
    }
  }
}

/**
 * Runs `body` holding the shop's pricing settings, then puts every setting
 * back as it was. The test's timeout is raised to allow for waiting.
 */
export async function withShopSettings<T>(
  email: string,
  slug: string,
  body: () => Promise<T>,
): Promise<T> {
  test.setTimeout(6 * 60_000);
  const release = await lock(slug);
  try {
    const { db, tenantId } = await ownerClient(email, slug);
    const before = await readSettings(db, tenantId);
    try {
      return await body();
    } finally {
      const now = await readSettings(db, tenantId);
      // No row before and none made: nothing to put back.
      if (now !== null) {
        const back = before ?? defaults;
        const { error } = await db.rpc("save_pricing_settings", {
          p_tenant_id: tenantId,
          p_settings: {
            rounding_step: back.rounding_step,
            tax_inclusive: back.tax_inclusive,
            coupons_enabled: back.coupons_enabled,
            default_tax_profile_id: back.default_tax_profile_id,
            deposit_mode: back.deposit_mode,
            deposit_percent_bp: back.deposit_percent_bp,
            deposit_amount: back.deposit_amount,
          },
        });
        if (error) throw error;
      }
    }
  } finally {
    release();
  }
}

/**
 * Chooses the shop's deposit in Settings › Pricing and tax, as an owner
 * would: "No deposit", "A percentage of the order", "A fixed amount per
 * order" or "Per vehicle", with its number when it has one.
 */
export async function chooseDeposit(
  page: Page,
  slug: string,
  choice: RegExp,
  number?: { label: RegExp; value: string },
) {
  await page.goto(`/${slug}/settings/pricing`);
  await page.getByRole("radio", { name: choice }).check();
  if (number) await page.getByLabel(number.label).fill(number.value);
  // The first save of a shop whose currency isn't fixed yet asks first.
  // Accepted only while saving: a handler left waiting would take a later
  // dialog meant for something else.
  const accept = (dialog: Dialog) => void dialog.accept();
  page.on("dialog", accept);
  try {
    await page.getByRole("button", { name: "Save pricing settings" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  } finally {
    page.off("dialog", accept);
  }
}
