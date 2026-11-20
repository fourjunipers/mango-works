/**
 * Phase 2, stage 11: New order as a price check, at 375 px and 1280 px.
 *
 *  - It says it books nothing.
 *  - The free counts fall after the seeded bookings (scripts/seed.mts), and
 *    the seeded shortage reads "None free" with what overbooking allows.
 *  - The channel decides: a booking-page-only coupon is refused at the
 *    counter and applied on the booking page; a Moto Mangos-only one only
 *    on Moto Mangos; the shop's notice binds online bookings, not the
 *    counter. Nothing is counted: the coupon's uses are the same after.
 *  - Mechanics and drivers see the counts and no prices.
 *
 * The rules and the pricing settings are put back afterwards
 * (e2e/booking-rules.ts, e2e/shop-settings.ts); the coupons made here have
 * codes of their own.
 */
import { expect, test, type Page } from "@playwright/test";
import { withBookingRules } from "./booking-rules";
import { demo, signIn } from "./helpers";
import { ownerClient, withShopSettings } from "./shop-settings";

type Booked = {
  name: string;
  quantity: number;
  shortage: number;
  starts: string;
  ends: string;
};

/** BSR's location, and its seeded bookings with the product's name, read as the owner. */
async function seeded() {
  const { db, tenantId } = await ownerClient(demo.bsrOwner, "bsr");
  const { data: location, error: e1 } = await db
    .from("locations")
    .select("id, timezone")
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .single();
  if (e1) throw e1;
  const { data, error } = await db
    .from("reservations")
    .select("quantity, shortage, starts_at, ends_at, state, products(name)")
    .eq("tenant_id", tenantId)
    .eq("state", "reserved")
    .order("starts_at");
  if (error) throw error;
  const zone = location.timezone as string;
  const local = (iso: string) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(iso));
    const get = (type: string) => parts.find((p) => p.type === type)!.value;
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
  };
  const booked: Booked[] = (data ?? []).map((r) => ({
    name: (r.products as unknown as { name: string }).name,
    quantity: r.quantity as number,
    shortage: r.shortage as number,
    starts: local(r.starts_at as string),
    ends: local(r.ends_at as string),
  }));
  return { db, tenantId, booked, zone, locationId: location.id as string };
}

async function search(
  page: Page,
  pickup: string,
  dropoff: string,
  channel: "The counter" | "Your booking page" | "Moto Mangos",
) {
  await page.goto("/bsr/new-order");
  await page.getByLabel("Pickup", { exact: true }).fill(pickup);
  await page.getByLabel("Return", { exact: true }).fill(dropoff);
  await page.getByRole("radio", { name: channel }).check();
  await page.getByRole("button", { name: "Check", exact: true }).click();
  await expect(page).toHaveURL(/pickup=/);
}

const rowOf = (page: Page, name: string) =>
  page.locator(`li[data-product="${name}"]`);

test("it says it books nothing, and the free counts fall after the seeded bookings", async ({
  page,
}) => {
  await withBookingRules(demo.bsrOwner, "bsr", async () => {
    const { db, tenantId, booked, locationId } = await seeded();
    // Overbooking on, as the seed leaves it, and no notice or minimum days
    // at the location, whatever another run left: the answers below are
    // the counts alone.
    const { error } = await db.rpc("save_booking_rules", {
      p_tenant_id: tenantId,
      p_rules: {
        shop: { allow_overbooking: true },
        locations: [
          {
            id: locationId,
            min_notice_hours: null,
            booking_cutoff_minutes: null,
            min_days_advance: null,
            min_days_walkin: null,
          },
        ],
      },
    });
    if (error) throw error;
    const scooters = booked.find((b) => b.shortage === 0 && b.quantity >= 2);
    const short = booked.find((b) => b.shortage > 0);
    expect(scooters, "the seed's booking of two").toBeTruthy();
    expect(short, "the seed's shortage").toBeTruthy();

    await signIn(page, demo.bsrOwner);
    await page.goto("/bsr/new-order");
    await expect(
      page.getByRole("heading", { level: 1, name: "Price check" }),
    ).toBeVisible();
    await expect(page.getByRole("note")).toContainText(
      "Nothing is booked or held",
    );

    await search(page, scooters!.starts, scooters!.ends, "The counter");
    await expect(rowOf(page, scooters!.name)).toContainText(/\d+ of \d+ free/);
    const count = rowOf(page, scooters!.name).locator("[data-count]");
    const free = await count.getAttribute("data-count");
    const stock = await count.getAttribute("data-stock");
    expect(Number(stock) - Number(free)).toBeGreaterThanOrEqual(
      scooters!.quantity,
    );

    // The model with every bike booked and one short.
    await search(page, short!.starts, short!.ends, "The counter");
    await expect(rowOf(page, short!.name)).toContainText("0 of");
    await expect(rowOf(page, short!.name)).toContainText(
      "None free. Overbooking is on, so staff could still save it as a shortage.",
    );
    await search(page, short!.starts, short!.ends, "Your booking page");
    await expect(rowOf(page, short!.name)).toContainText(
      "None free for these dates.",
    );
  });
});

test("the channel decides: notice online only, and a coupon only where it can be used; nothing is counted", async ({
  page,
}) => {
  const stamp = Date.now().toString(36).toUpperCase();
  const web = `E2EWEB${stamp}`;
  const moto = `E2EMM${stamp}`;
  await withShopSettings(demo.bsrOwner, "bsr", async () => {
    await withBookingRules(demo.bsrOwner, "bsr", async () => {
      const { db, tenantId, booked } = await seeded();
      const { error: settingsError } = await db.rpc("save_pricing_settings", {
        p_tenant_id: tenantId,
        p_settings: { coupons_enabled: true },
      });
      if (settingsError) throw settingsError;
      for (const [code, channels] of [
        [web, ["booking_page"]],
        [moto, ["marketplace"]],
      ] as const) {
        const { error } = await db.rpc("save_coupon", {
          p_tenant_id: tenantId,
          p_coupon: { code, kind: "percent", percent_bp: 1000, channels },
        });
        if (error) throw error;
      }
      const usesOf = async (code: string) => {
        const { data, error } = await db.rpc("coupon_inputs", {
          p_tenant_id: tenantId,
          p_code: code,
        });
        if (error) throw error;
        return (data as { uses: { total: number } }).uses.total;
      };
      const before = await usesOf(web);
      const scooter = booked.find((b) => b.shortage === 0 && b.quantity >= 2)!;

      // A notice of 720 hours: online can't book these dates, the counter can.
      const { error: rulesError } = await db.rpc("save_booking_rules", {
        p_tenant_id: tenantId,
        p_rules: {
          locations: [
            {
              id: (
                await db
                  .from("locations")
                  .select("id")
                  .eq("tenant_id", tenantId)
                  .eq("is_default", true)
                  .single()
              ).data!.id,
              min_notice_hours: 720,
            },
          ],
        },
      });
      if (rulesError) throw rulesError;

      await signIn(page, demo.bsrOwner);
      await search(page, scooter.starts, scooter.ends, "Your booking page");
      await expect(rowOf(page, scooter.name)).toContainText(
        "Too soon: the earliest pickup on this channel is",
      );
      await search(page, scooter.starts, scooter.ends, "The counter");
      await expect(rowOf(page, scooter.name)).not.toContainText("Too soon");

      // The price at the counter: the booking-page coupon is refused.
      await rowOf(page, scooter.name)
        .getByRole("link", { name: /^Price/ })
        .click();
      const price = page.getByRole("region", {
        name: `${scooter.name}: price from The counter`,
      });
      await expect(price).toBeVisible();
      const code = price.getByLabel("Coupon code");
      await code.fill(web);
      await price.getByRole("button", { name: "Apply" }).click();
      await expect(price.locator("[data-coupon-note]")).toHaveText(
        "Not applied: this coupon can’t be used by staff.",
      );

      // On the booking page it is applied; the Moto Mangos one is not.
      await search(page, scooter.starts, scooter.ends, "Your booking page");
      await rowOf(page, scooter.name)
        .getByRole("link", { name: /^Price/ })
        .click();
      const online = page.getByRole("region", {
        name: `${scooter.name}: price from Your booking page`,
      });
      await online.getByLabel("Coupon code").fill(web);
      await online.getByRole("button", { name: "Apply" }).click();
      await expect(online.locator("[data-coupon-note]")).toHaveText(
        `Coupon ${web} applied.`,
      );
      await online.getByLabel("Coupon code").fill(moto);
      await online.getByRole("button", { name: "Apply" }).click();
      await expect(online.locator("[data-coupon-note]")).toHaveText(
        "Not applied: this coupon can’t be used on your booking page.",
      );

      // On Moto Mangos, the Moto Mangos coupon is applied.
      await search(page, scooter.starts, scooter.ends, "Moto Mangos");
      await rowOf(page, scooter.name)
        .getByRole("link", { name: /^Price/ })
        .click();
      const mm = page.getByRole("region", {
        name: `${scooter.name}: price from Moto Mangos`,
      });
      await mm.getByLabel("Coupon code").fill(moto);
      await mm.getByRole("button", { name: "Apply" }).click();
      await expect(mm.locator("[data-coupon-note]")).toHaveText(
        `Coupon ${moto} applied.`,
      );

      // A price check counts no use.
      expect(await usesOf(web)).toBe(before);
    });
  });
});

for (const who of ["bsrMechanic", "bsrDriver"] as const) {
  test(`${who} sees the counts and no prices`, async ({ page }) => {
    await signIn(page, demo[who]);
    await page.goto("/bsr/new-order");
    await page.getByRole("button", { name: "Check", exact: true }).click();
    await expect(page.locator("li[data-product]").first()).toContainText(
      / of \d+ free|A service/,
    );
    await expect(page.getByRole("link", { name: /^Price/ })).toHaveCount(0);
  });
}
