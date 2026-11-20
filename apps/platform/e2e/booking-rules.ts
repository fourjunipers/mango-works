import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "@playwright/test";
import { acquireFileLock } from "./file-lock";
import { ownerClient } from "./shop-settings";

/**
 * A shop's booking rules (Settings › Booking rules; Phase 2 stage 11) are
 * shared by every screen that judges a booking: the New order price check
 * reads them too. Browser tests that change them, or that read an answer
 * that depends on them, run one at a time across every worker and both
 * widths, and put every rule back as it was, pass or fail.
 *
 * The restore goes through save_booking_rules() as the shop's owner, the
 * function the screen uses: no service key, so it works on a deploy preview.
 */

type Read = {
  shop: {
    allow_overbooking: boolean;
    hold_minutes: number;
    buffer_before_minutes: number | null;
    buffer_after_minutes: number | null;
  };
  locations: {
    id: string;
    min_notice_hours: number | null;
    booking_cutoff_minutes: number | null;
    min_days_advance: number | null;
    min_days_walkin: number | null;
  }[];
  products: {
    id: string;
    min_days_advance: number | null;
    min_days_walkin: number | null;
  }[];
};

type Db = Awaited<ReturnType<typeof ownerClient>>["db"];

async function readRules(db: Db, tenantId: string): Promise<Read> {
  const [shop, locations, products] = await Promise.all([
    db
      .from("tenants")
      .select(
        "allow_overbooking, hold_minutes, buffer_before_minutes, buffer_after_minutes",
      )
      .eq("id", tenantId)
      .single(),
    db
      .from("locations")
      .select(
        "id, min_notice_hours, booking_cutoff_minutes, min_days_advance, min_days_walkin",
      )
      .eq("tenant_id", tenantId),
    db
      .from("products")
      .select("id, min_days_advance, min_days_walkin")
      .eq("tenant_id", tenantId)
      .eq("type", "vehicle"),
  ]);
  for (const answer of [shop, locations, products])
    if (answer.error) throw answer.error;
  return {
    shop: shop.data as Read["shop"],
    locations: (locations.data ?? []) as Read["locations"],
    products: (products.data ?? []) as Read["products"],
  };
}

const lock = (slug: string) =>
  acquireFileLock(join(tmpdir(), `mango-e2e-booking-rules-${slug}.lock`));

/** Runs `body` holding the shop's booking rules, then puts them all back. */
export async function withBookingRules<T>(
  email: string,
  slug: string,
  body: () => Promise<T>,
): Promise<T> {
  test.setTimeout(6 * 60_000);
  const release = await lock(slug);
  try {
    const { db, tenantId } = await ownerClient(email, slug);
    const before = await readRules(db, tenantId);
    try {
      return await body();
    } finally {
      const { error } = await db.rpc("save_booking_rules", {
        p_tenant_id: tenantId,
        p_rules: before,
      });
      if (error) throw error;
    }
  } finally {
    release();
  }
}
