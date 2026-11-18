/**
 * Phase 2, stage 9: the coupon screens, at 375 px and 1280 px.
 *
 * Settings › Coupons: create, edit, switch off and on, archive, a code
 * reused once archived (and "Bring back" refused while another coupon has
 * it), every refusal in words, History. The returning-customer card on
 * Settings › Pricing and tax. Check a price with a good code, a refused
 * code, and a coupon against the returning-customer discount (the larger
 * applies), with nothing counted. Staff can't reach the coupon form.
 *
 * Runs against local Supabase or a deploy preview on staging, again and
 * again. A coupon can't be deleted, so every code carries a stamp and every
 * coupon a test makes is archived when it ends. BSR's pricing settings are
 * held while a test changes them and put back (e2e/shop-settings.ts).
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { acquireFileLock } from "./file-lock";
import { demo, signIn } from "./helpers";
import { ownerClient, withShopSettings } from "./shop-settings";

const stamp = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`.toUpperCase();

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function as(browser: Browser, email: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  return { page, close: () => context.close() };
}

const row = (page: Page, code: string) =>
  page.locator(`li[data-coupon="${code}"]`).first();

/** Archives every live BSR coupon whose code starts with `prefix`. */
async function archiveCoupons(prefix: string) {
  const { db, tenantId } = await ownerClient(demo.bsrOwner, "bsr");
  const { data, error } = await db
    .from("coupons")
    .select("id")
    .eq("tenant_id", tenantId)
    .like("code", `${prefix}%`)
    .is("archived_at", null);
  if (error) throw error;
  for (const { id } of data) {
    const { error: saveError } = await db.rpc("save_coupon", {
      p_tenant_id: tenantId,
      p_coupon: { id, archived: true },
    });
    if (saveError) throw saveError;
  }
}

/** Accepts the next confirm() only. */
const acceptNext = (page: Page) =>
  page.once("dialog", (dialog) => void dialog.accept());

test("an owner creates, edits, switches off and on and archives a coupon; an archived code is used again; History", async ({
  page,
}) => {
  test.setTimeout(4 * 60_000);
  const code = `E2E${stamp()}`;
  await signIn(page, demo.bsrOwner);
  try {
    await page.goto("/bsr/settings/coupons");
    await expect(
      page
        .getByRole("navigation", { name: "Settings sections" })
        .getByRole("link", { name: "Coupons" }),
    ).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "New coupon" }).click();
    await expect(page).toHaveURL(/\/bsr\/settings\/coupons\/new$/);

    // A Thai code: said at once, and refused by the server in plain words.
    await page.getByLabel("Code", { exact: true }).fill("ส่วนลด");
    await expect(page.getByText(/This code can’t be saved/)).toBeVisible();
    await page.getByLabel("Percentage off").fill("10");
    await page.getByLabel(/^By staff/).check();
    await page.getByRole("button", { name: "Create coupon" }).click();
    await expect(
      page.getByText(/Thai letters and full-width characters/).last(),
    ).toBeVisible();

    // Typed in small letters with a space: shown and saved as stored.
    await page
      .getByLabel("Code", { exact: true })
      .fill(`${code.toLowerCase().slice(0, 4)} ${code.slice(4)}`);
    await expect(page.getByText(`Saved as ${code}`)).toBeVisible();
    await page.getByLabel("Name (for the shop)").fill("E2E flyer");
    await page.getByRole("button", { name: "Create coupon" }).click();
    await expect(page.getByText("Coupon created.")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: code, level: 1 }),
    ).toBeVisible();
    await noSidewaysScroll(page);

    // Edit: a fixed ฿200 off, 50 uses in all.
    await page.getByRole("radio", { name: "Fixed amount" }).check();
    await page.getByLabel("Amount off (THB)").fill("200");
    await page.getByLabel("Total uses").fill("50");
    await page.getByRole("button", { name: "Save coupon" }).click();
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();

    // The list: its value, its uses, on.
    await page.goto("/bsr/settings/coupons");
    await expect(row(page, code)).toHaveAttribute("data-status", "on");
    await expect(row(page, code)).toContainText(/200 off/);
    await expect(row(page, code)).toContainText("Used 0 of 50");
    await expect(row(page, code)).toContainText("E2E flyer");
    await noSidewaysScroll(page);

    // Switch off, then on, from the list.
    await row(page, code).getByRole("button", { name: "Switch off" }).click();
    await expect(row(page, code)).toHaveAttribute("data-status", "off");
    await row(page, code).getByRole("button", { name: "Switch on" }).click();
    await expect(row(page, code)).toHaveAttribute("data-status", "on");

    // Archive: asked first.
    acceptNext(page);
    await row(page, code).getByRole("button", { name: "Archive" }).click();
    await expect(
      page.locator(`li[data-coupon="${code}"][data-status="archived"]`),
    ).toHaveCount(1);
    await expect(
      page
        .locator(`li[data-coupon="${code}"][data-status="archived"]`)
        .getByRole("button"),
    ).toHaveCount(0);

    // The code is free: a new coupon takes it.
    await page.goto("/bsr/settings/coupons/new");
    await page.getByLabel("Code", { exact: true }).fill(code);
    await page.getByLabel("Percentage off").fill("5");
    await page.getByLabel(/^On the shop’s booking page/).check();
    await page.getByRole("button", { name: "Create coupon" }).click();
    await expect(page.getByText("Coupon created.")).toBeVisible();

    // A third with the same code: refused, naming the coupon that has it.
    await page.goto("/bsr/settings/coupons/new");
    await page.getByLabel("Code", { exact: true }).fill(code);
    await page.getByLabel("Percentage off").fill("5");
    await page.getByLabel(/^By staff/).check();
    await page.getByRole("button", { name: "Create coupon" }).click();
    await expect(
      page.getByText(
        new RegExp(`Another coupon already uses the code ${code}`),
      ),
    ).toBeVisible();

    // Bringing the archived one back is refused while the new one has it.
    await page.goto("/bsr/settings/coupons");
    await page
      .locator(`li[data-coupon="${code}"][data-status="archived"]`)
      .getByRole("link", { name: "View" })
      .click();
    await expect(page.getByText(/This coupon is archived/)).toBeVisible();
    await page.getByRole("button", { name: "Bring back" }).click();
    await expect(
      page.getByText(
        new RegExp(`Another coupon already uses the code ${code}`),
      ),
    ).toBeVisible();

    // History on the archived coupon's page, in the buttons' words.
    const history = page.locator('li[data-history="coupon"]');
    for (const line of [
      `archived ${code}`,
      `switched on ${code}`,
      `switched off ${code}`,
      `set the total uses of ${code} to 50`,
      new RegExp(`changed ${code} from 10% off to \\D*200 off`),
      `created coupon ${code}: 10% off, all products`,
    ])
      await expect(history.filter({ hasText: line })).toHaveCount(1);
    await noSidewaysScroll(page);
  } finally {
    await archiveCoupons(code);
  }
});

test("Settings › Pricing and tax: the returning-customer card; the coupons note when coupons are off", async ({
  page,
}) => {
  await signIn(page, demo.bsrOwner);
  await withShopSettings(demo.bsrOwner, "bsr", async () => {
    await page.goto("/bsr/settings/pricing");
    await expect(page.getByText(/in a later update/)).toHaveCount(0);
    const card = page.getByRole("region", {
      name: "Returning-customer discount",
    });
    await expect(card).toBeVisible();

    // On with no percentage: refused on its box.
    await card.getByLabel("Give returning customers a discount").check();
    await card.getByLabel("Percentage off").fill("");
    await page.getByLabel("Accept coupons").uncheck();
    page.on("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Save pricing settings" }).click();
    await expect(
      page.getByText("Enter the percentage to switch the discount on."),
    ).toBeVisible();

    await card.getByLabel("Percentage off").fill("12.5");
    await card.getByLabel("Completed rentals needed").fill("2");
    await page.getByRole("button", { name: "Save pricing settings" }).click();
    await expect(
      page.getByText("Saved", { exact: true }).first(),
    ).toBeVisible();
    await page.reload();
    await expect(
      card.getByLabel("Give returning customers a discount"),
    ).toBeChecked();
    await expect(card.getByLabel("Percentage off")).toHaveValue("12.5");
    await expect(card.getByLabel("Completed rentals needed")).toHaveValue("2");
    await noSidewaysScroll(page);

    // Coupons off: Settings › Coupons says so, with a link, and still creates.
    await page.goto("/bsr/settings/coupons");
    const note = page.getByRole("note");
    await expect(note).toContainText("doesn’t accept coupons right now");
    await note
      .getByRole("link", { name: "Settings › Pricing and tax" })
      .click();
    await expect(page).toHaveURL(/\/bsr\/settings\/pricing$/);
    await page.goto("/bsr/settings/coupons");
    await expect(page.getByRole("link", { name: "New coupon" })).toBeVisible();
  });
});

test("Check a price: a good code, a refused code, and a coupon against the returning-customer discount; nothing is counted", async ({
  page,
}) => {
  const prefix = `E2EC${stamp()}`;
  const big = `${prefix}BIG`;
  const small = `${prefix}SMALL`;
  const long = `${prefix}LONG`;
  const name = `Coupon Boat ${stamp()}`;
  await signIn(page, demo.bsrOwner);
  await withShopSettings(demo.bsrOwner, "bsr", async () => {
    const { db, tenantId } = await ownerClient(demo.bsrOwner, "bsr");
    // Coupons accepted; 10% off for a returning customer after 1 rental;
    // no tax, no deposit, so the totals are the prices.
    const { error } = await db.rpc("save_pricing_settings", {
      p_tenant_id: tenantId,
      p_settings: {
        coupons_enabled: true,
        returning_enabled: true,
        returning_percent_bp: 1000,
        returning_rentals_needed: 1,
        tax_inclusive: true,
        default_tax_profile_id: null,
        deposit_mode: "none",
      },
    });
    if (error) throw error;
    const coupon = async (payload: Record<string, unknown>) => {
      const { error: e } = await db.rpc("save_coupon", {
        p_tenant_id: tenantId,
        p_coupon: { channels: ["staff"], ...payload },
      });
      if (e) throw e;
    };
    await coupon({ code: big, kind: "percent", percent_bp: 2000 });
    await coupon({ code: small, kind: "fixed", amount: 5000 });
    await coupon({
      code: long,
      kind: "percent",
      percent_bp: 1000,
      min_days: 30,
    });

    await page.goto("/bsr/products/new");
    await page.getByText("Boat or jet ski", { exact: true }).click();
    await page.getByLabel("Product name").fill(name);
    await page.getByRole("button", { name: "Save product" }).click();
    await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
    const address = page.url().split("?")[0];
    try {
      await page.goto(`${address}?tab=pricing`);
      await page.getByRole("radio", { name: /^By rental length/ }).check();
      await page.getByLabel("Daily (1 day)").fill("300");
      await page.getByLabel("Weekly (7 days)").fill("1400");
      await page.getByLabel("Monthly (30 days)").fill("3000");
      await page.getByLabel("Long-stay daily rate (THB)").fill("100");
      await page.getByRole("button", { name: "Save prices" }).click();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();

      const check = page.getByRole("region", { name: "Check a price" });
      const value = (label: string | RegExp) =>
        check
          .locator("dl > div")
          .filter({
            has:
              typeof label === "string"
                ? page.getByText(label, { exact: true })
                : page.getByText(label),
          })
          .locator("dd");
      const apply = async (code: string) => {
        await check.getByLabel("Coupon code").fill(code);
        await check.getByRole("button", { name: "Apply" }).click();
      };
      await check.getByLabel("Pickup").fill("2027-01-01T10:00");
      await check.getByLabel("Days", { exact: true }).fill("7");
      await expect(value("Total")).toHaveText(/^\D*1,400$/);

      // A good code: its row with its code, and the total less 20%.
      await apply(big.toLowerCase());
      await expect(check.getByRole("status")).toHaveText(
        `Coupon ${big} applied.`,
      );
      await expect(value(`Coupon ${big}`)).toHaveText(/^−\D*280$/);
      await expect(value("Total")).toHaveText(/^\D*1,120$/);

      // With the tick: they don't stack, the coupon takes more and wins.
      await check.getByLabel("Returning customer").check();
      await expect(check.getByRole("status")).toContainText(
        "the larger discount applies",
      );
      await expect(value("Returning-customer discount")).toHaveCount(0);
      await expect(value("Total")).toHaveText(/^\D*1,120$/);

      // ฿50 against 10% (฿140): the returning discount wins; not applied.
      await apply(small);
      await expect(check.getByRole("status")).toContainText(
        `Coupon ${small} not applied`,
      );
      await expect(check.getByRole("status")).toContainText(
        "the larger discount applies",
      );
      await expect(value("Returning-customer discount")).toHaveText(
        /^−\D*140$/,
      );
      await expect(value("Total")).toHaveText(/^\D*1,260$/);

      // Refused, with the reason: too short; and no such code.
      await check.getByLabel("Returning customer").uncheck();
      await apply(long);
      await expect(check.getByRole("status")).toHaveText(
        "Not applied: the rental must be at least 30 days.",
      );
      await expect(value("Total")).toHaveText(/^\D*1,400$/);
      await apply(`${prefix}NOPE`);
      await expect(check.getByRole("status")).toHaveText(
        "Not applied: no coupon has this code.",
      );
      await noSidewaysScroll(page);

      // Read-only: no use was counted.
      for (const c of [big, small, long]) {
        const { data, error: e } = await db.rpc("coupon_inputs", {
          p_tenant_id: tenantId,
          p_code: c,
        });
        if (e) throw e;
        expect((data as { uses: { total: number } }).uses.total, c).toBe(0);
      }
    } finally {
      await page.goto(address);
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("button", { name: /^Delete product$/ }).click();
      await expect(page).toHaveURL(/\/bsr\/products(\?.*)?$/);
      await archiveCoupons(prefix);
    }
  });
});

test("staff can't reach Settings › Coupons or the coupon form; they have no Coupons section", async ({
  browser,
}) => {
  const staff = await as(browser, demo.bsrStaff);
  try {
    for (const path of ["coupons", "coupons/new"]) {
      await staff.page.goto(`/bsr/settings/${path}`);
      await expect(staff.page.getByText("Page not found")).toBeVisible();
      await expect(staff.page.getByLabel("Code", { exact: true })).toHaveCount(
        0,
      );
      await expect(
        staff.page.getByRole("button", { name: /Create coupon|Save coupon/ }),
      ).toHaveCount(0);
    }
    await staff.page.goto("/bsr/settings/extras");
    await expect(staff.page.getByRole("link", { name: "Coupons" })).toHaveCount(
      0,
    );
  } finally {
    await staff.close();
  }
});

// ------------------------------------------------ review of PR 50: more tests

async function addBoat(page: Page, name: string): Promise<string> {
  await page.goto("/bsr/products/new");
  await page.getByText("Boat or jet ski", { exact: true }).click();
  await page.getByLabel("Product name").fill(name);
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return page.url().split("?")[0];
}

/** Rental gear with none in stock (so it can be deleted), at `perDay` a day. */
async function addGear(page: Page, name: string, perDay: string) {
  await page.goto("/bsr/products/new");
  await page.getByRole("radio", { name: /^General/ }).check();
  await page.getByRole("radio", { name: /^Rental gear/ }).check();
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Quantity", { exact: true }).fill("0");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  const address = page.url().split("?")[0];
  await page.goto(`${address}?tab=pricing`);
  await page.getByRole("radio", { name: /^Flat fee per period/ }).check();
  await page.getByLabel("Amount (THB)").fill(perDay);
  await page.getByLabel("Period", { exact: true }).selectOption("day");
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  return address;
}

/** 300 a day, 1,400 a week, 3,000 a month, 100 a long-stay day. */
async function ownPrices(page: Page, address: string) {
  await page.goto(`${address}?tab=pricing`);
  await page.getByRole("radio", { name: /^By rental length/ }).check();
  await page.getByLabel("Daily (1 day)").fill("300");
  await page.getByLabel("Weekly (7 days)").fill("1400");
  await page.getByLabel("Monthly (30 days)").fill("3000");
  await page.getByLabel("Long-stay daily rate (THB)").fill("100");
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

async function deleteProduct(page: Page, address: string) {
  await page.goto(address);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: /^Delete product$/ }).click();
  await expect(page).toHaveURL(/\/bsr\/products(\?.*)?$/);
}

const idOf = (address: string) => address.split("/").pop()!;

/** No tax, no deposit, no returning discount: totals are the prices. */
async function plainPrices() {
  const { db, tenantId } = await ownerClient(demo.bsrOwner, "bsr");
  const { error } = await db.rpc("save_pricing_settings", {
    p_tenant_id: tenantId,
    p_settings: {
      tax_inclusive: true,
      default_tax_profile_id: null,
      deposit_mode: "none",
      returning_enabled: false,
    },
  });
  if (error) throw error;
  return { db, tenantId };
}

const checkRegion = (page: Page) =>
  page.getByRole("region", { name: "Check a price" });
const checkValue = (page: Page, label: string | RegExp) =>
  checkRegion(page)
    .locator("dl > div")
    .filter({
      has:
        typeof label === "string"
          ? page.getByText(label, { exact: true })
          : page.getByText(label),
    })
    .locator("dd");

test("Check a price with its scripts held back 4 seconds: Days and Pickup typed at once are what is priced", async ({
  page,
}) => {
  const name = `Slow Boat ${stamp()}`;
  await signIn(page, demo.bsrOwner);
  await withShopSettings(demo.bsrOwner, "bsr", async () => {
    const { db, tenantId } = await plainPrices();
    const address = await addBoat(page, name);
    let seasonId: string | null = null;
    try {
      // A season from 1 Apr to 30 Sep 2027, 20% off this boat alone.
      const { data, error } = await db.rpc("save_price_rule", {
        p_tenant_id: tenantId,
        p_rule: {
          name: `E2E slow ${stamp()}`,
          starts_on: "2027-04-01",
          ends_on: "2027-09-30",
          repeats_yearly: false,
          adjust_bp: -2000,
          all_products: false,
          active: true,
          product_ids: [idOf(address)],
        },
      });
      if (error) throw error;
      seasonId = data as string;
      await ownPrices(page, address);
      // The page's own scripts arrive 4 seconds late.
      await page.route(/\/_next\/static\/chunks\/.+\.js/, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 4_000));
        await route.continue();
      });
      await page.goto(`${address}?tab=pricing`, { waitUntil: "commit" });
      const check = checkRegion(page);
      // Typed as soon as the boxes can be typed into.
      await check.getByLabel("Days", { exact: true }).fill("1");
      await check.getByLabel("Pickup").fill("2027-04-01T10:00");
      await expect(check.locator("fieldset[data-started]")).toHaveAttribute(
        "data-started",
        "yes",
        { timeout: 30_000 },
      );
      // The boxes say 1 day from 1 Apr; the price is for exactly that:
      // 300 less the season's 20%, not the 7-day 1,400 of the defaults.
      await expect(check.getByLabel("Days", { exact: true })).toHaveValue("1");
      await expect(check.getByLabel("Pickup")).toHaveValue("2027-04-01T10:00");
      await expect(checkValue(page, "List price")).toHaveText(/^\D*300$/);
      await expect(checkValue(page, /^Season: /)).toHaveText(/^−\D*60$/);
      await expect(checkValue(page, "Total")).toHaveText(/^\D*240$/);
    } finally {
      await page.unrouteAll({ behavior: "ignoreErrors" });
      if (seasonId)
        await db.rpc("save_price_rule", {
          p_tenant_id: tenantId,
          p_rule: { id: seasonId, delete: true },
        });
      await deleteProduct(page, address);
    }
  });
});

test("Check a price with extras: two vehicles and five helmets, two included with each, is 4 included and 1 charged; the vehicle's own row wins over the shop's", async ({
  page,
}) => {
  const boatName = `Extras Boat ${stamp()}`;
  const helmetName = `E2E Helmet ${stamp()}`;
  const lockName = `E2E Lock ${stamp()}`;
  await signIn(page, demo.bsrOwner);
  await withShopSettings(demo.bsrOwner, "bsr", async () => {
    // BSR's "every vehicle" list is shared: held as e2e/extras.spec.ts does.
    const release = await acquireFileLock(
      join(tmpdir(), "mango-e2e-extras-every-vehicle-bsr.lock"),
    );
    const { db, tenantId } = await plainPrices();
    const { data: before, error: readError } = await db
      .from("product_extras")
      .select("extra_product_id, included_quantity, max_quantity")
      .eq("tenant_id", tenantId)
      .is("product_id", null)
      .order("sort_position");
    if (readError) throw readError;
    const made: string[] = [];
    const extras = async (productId: string | null, rows: unknown[]) => {
      const { error } = await db.rpc("save_product_extras", {
        p_tenant_id: tenantId,
        p_product_id: productId,
        p_extras: rows,
      });
      if (error) throw error;
    };
    try {
      const boat = await addBoat(page, boatName);
      made.push(boat);
      await ownPrices(page, boat);
      const helmet = await addGear(page, helmetName, "50");
      made.push(helmet);
      const lock = await addGear(page, lockName, "20");
      made.push(lock);
      // The shop's list: one helmet and one lock free with every vehicle.
      await extras(null, [
        ...before,
        {
          extra_product_id: idOf(helmet),
          included_quantity: 1,
          max_quantity: null,
        },
        {
          extra_product_id: idOf(lock),
          included_quantity: 1,
          max_quantity: null,
        },
      ]);
      // The boat's own row for the helmet: two free. It wins over the shop's.
      await extras(idOf(boat), [
        {
          extra_product_id: idOf(helmet),
          included_quantity: 2,
          max_quantity: null,
        },
      ]);

      await page.goto(`${boat}?tab=pricing`);
      const check = checkRegion(page);
      await check.getByLabel("Pickup").fill("2027-01-01T10:00");
      await check.getByLabel("Days", { exact: true }).fill("1");
      await check.getByLabel("How many").fill("2");
      const helmetBox = check.getByRole("spinbutton", { name: helmetName });
      const lockBox = check.getByRole("spinbutton", { name: lockName });
      // The helmet says the boat's two; the lock the shop's one.
      await expect(helmetBox).toHaveAccessibleDescription(
        "2 included with each",
      );
      await expect(lockBox).toHaveAccessibleDescription("1 included with each");
      await helmetBox.fill("5");
      // Two boats for a day: 600. Five helmets, 2 × 2 included: 1 charged, 50.
      await expect(checkValue(page, `${helmetName} × 5`)).toHaveText(/^\D*50$/);
      await expect(
        check.getByText("4 of them included", { exact: true }),
      ).toBeVisible();
      await expect(checkValue(page, "Total")).toHaveText(/^\D*650$/);
      // A lock each comes free with the shop's row: two locks cost nothing.
      await lockBox.fill("2");
      await expect(checkValue(page, `${lockName} × 2`)).toHaveText(/^\D*0$/);
      await expect(checkValue(page, "Total")).toHaveText(/^\D*650$/);
      await noSidewaysScroll(page);
    } finally {
      try {
        await extras(null, before);
      } finally {
        release();
      }
      for (const address of made) await deleteProduct(page, address);
    }
  });
});

test("mechanics and drivers reach no coupon page and not Pricing and tax, by address; staff not a coupon's page", async ({
  browser,
}) => {
  test.setTimeout(4 * 60_000);
  const code = `E2EROLE${stamp()}`;
  const { db, tenantId } = await ownerClient(demo.bsrOwner, "bsr");
  const { data, error } = await db.rpc("save_coupon", {
    p_tenant_id: tenantId,
    p_coupon: { code, kind: "percent", percent_bp: 1000, channels: ["staff"] },
  });
  if (error) throw error;
  const id = (data as { id: string }).id;
  const every = ["coupons", "coupons/new", `coupons/${id}`, "pricing"];
  try {
    for (const [who, paths] of [
      [demo.bsrMechanic, every],
      [demo.bsrDriver, every],
      [demo.bsrStaff, [`coupons/${id}`]],
    ] as const) {
      const other = await as(browser, who);
      try {
        for (const path of paths) {
          await other.page.goto(`/bsr/settings/${path}`);
          await expect(
            other.page.getByText("Page not found"),
            `${who} on ${path}`,
          ).toBeVisible();
          await expect(other.page.getByText(code)).toHaveCount(0);
          await expect(
            other.page.getByLabel("Code", { exact: true }),
          ).toHaveCount(0);
          await expect(
            other.page.getByRole("button", {
              name: /Save coupon|Create coupon|Save pricing settings|Switch off|Archive/,
            }),
          ).toHaveCount(0);
        }
      } finally {
        await other.close();
      }
    }
  } finally {
    await archiveCoupons(code);
  }
});
