/**
 * The Price check tab (route /new-order), at 375 px and 1280 px: Phase 2
 * stage 11, in its compact layout (20 Nov 2026).
 *
 *  - One card: the dates, the location and the channel on top, one search
 *    box, and one product's answer under it. It says it books nothing, and
 *    nothing on it scrolls sideways at 375 px.
 *  - The search finds a product by name, kind or category; the last ones
 *    looked at come back as chips; without the page's scripts, the text
 *    typed opens its one match or lists them.
 *  - The free counts fall after the seeded bookings (scripts/seed.mts), and
 *    the seeded shortage reads "None free" with what overbooking allows.
 *  - The channel decides: a booking-page-only coupon is refused at the
 *    counter and applied on the booking page; a Moto Mangos-only one only
 *    on Moto Mangos; the shop's notice binds online bookings, not the
 *    counter. Nothing is counted: the coupon's uses are the same after.
 *  - Mechanics and drivers see the counts and no prices, in what the server
 *    sends as well as on screen.
 *
 * The rules and the pricing settings are put back afterwards
 * (e2e/booking-rules.ts, e2e/shop-settings.ts); the coupons made here have
 * codes of their own.
 */
import { expect, test, type Page } from "@playwright/test";
import { withBookingRules } from "./booking-rules";
import { demo, signIn } from "./helpers";
import { ownerClient, withShopSettings } from "./shop-settings";
import { exactlyOne } from "@mango/db/rows";

type Channel = "The counter" | "Your booking page" | "Moto Mangos";

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
  const { data: location, error: e1 } = await exactlyOne(
    db
      .from("locations")
      .select("id, timezone")
      .eq("tenant_id", tenantId)
      .eq("is_default", true),
  );
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

/** The search box, once its scripts have started. */
async function searchBox(page: Page) {
  await expect(page.locator('form [data-started="yes"]')).toHaveCount(1);
  return page.getByRole("combobox", { name: "Product" });
}

/** Type a product's name and pick it from the list: its answer opens. */
async function pick(page: Page, name: string) {
  const box = await searchBox(page);
  await box.fill(name);
  // The exact name sorts first among names that start with it.
  await page
    .getByRole("listbox", { name: "Product" })
    .getByRole("option")
    .first()
    .click();
  await expect(page).toHaveURL(/product=/);
  await expect(result(page, name)).toBeVisible();
}

/** Set the dates and the channel, then pick the product. */
async function check(
  page: Page,
  pickup: string,
  dropoff: string,
  channel: Channel,
  product: string,
) {
  await page.goto("/bsr/new-order");
  await page.getByLabel("Pickup", { exact: true }).fill(pickup);
  await page.getByLabel("Return", { exact: true }).fill(dropoff);
  await page.getByLabel("Booked from").selectOption({ label: channel });
  await pick(page, product);
  await expect(page).toHaveURL(
    new RegExp(`pickup=${encodeURIComponent(pickup)}`),
  );
}

const result = (page: Page, name: string) =>
  page.locator(`[data-result] [data-product="${name}"]`);

const priceOf = (page: Page, name: string, channel: Channel) =>
  page.getByRole("region", { name: `${name}: price from ${channel}` });

test("one compact card: it says it books nothing, fits the screen, and the free counts fall after the seeded bookings", async ({
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
      "nothing is booked or held",
    );
    // No list of products until one is searched for.
    await expect(page.locator("[data-product]")).toHaveCount(0);
    await expect(page.locator("[data-result]")).toContainText(
      "Find a product to see how many are free and its price",
    );
    await expect(page.getByLabel("Booked from")).toHaveValue("walk_in");

    await check(
      page,
      scooters!.starts,
      scooters!.ends,
      "The counter",
      scooters!.name,
    );
    await expect(result(page, scooters!.name)).toContainText(/\d+ of \d+ free/);
    const count = result(page, scooters!.name).locator("[data-count]");
    const free = await count.getAttribute("data-count");
    const stock = await count.getAttribute("data-stock");
    expect(Number(stock) - Number(free)).toBeGreaterThanOrEqual(
      scooters!.quantity,
    );
    // The price for those dates sits in the same card.
    await expect(
      priceOf(page, scooters!.name, "The counter").getByLabel(
        "Price breakdown",
      ),
    ).toContainText("Total");
    // Nothing scrolls sideways, at 375 px as at 1280 px.
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);

    // The model with every bike booked and one short.
    await check(page, short!.starts, short!.ends, "The counter", short!.name);
    await expect(result(page, short!.name)).toContainText("0 of");
    await expect(result(page, short!.name)).toContainText(
      "None free. Overbooking is on, so staff could still save it as a shortage.",
    );
    await check(
      page,
      short!.starts,
      short!.ends,
      "Your booking page",
      short!.name,
    );
    await expect(result(page, short!.name)).toContainText(
      "None free for these dates.",
    );
  });
});

test("the search finds by name, kind or category, keeps recent ones as chips, and works before the scripts", async ({
  page,
}) => {
  const { booked } = await seeded();
  const first = booked[0].name;
  const second = booked.find((b) => b.name !== first)!.name;

  await signIn(page, demo.bsrOwner);
  await page.goto("/bsr/new-order");
  const box = await searchBox(page);

  // By kind: every match is a motorbike.
  await box.fill("motorbike");
  const options = page
    .getByRole("listbox", { name: "Product" })
    .getByRole("option");
  await expect(options.first()).toContainText("Motorbike");
  // By a word that matches nothing.
  await box.fill("zzzz-nothing");
  await expect(page.getByRole("listbox", { name: "Product" })).toContainText(
    "Nothing matches “zzzz-nothing”.",
  );

  // Two products looked at: the first comes back as a chip.
  await pick(page, first);
  await pick(page, second);
  const chips = page.getByRole("list", { name: "Recent" });
  await expect(chips.getByRole("button", { name: first })).toBeVisible();
  await chips.getByRole("button", { name: first }).click();
  await expect(result(page, first)).toBeVisible();

  // Without the scripts (or Enter with nothing picked), the text goes as q.
  await page.goto(`/bsr/new-order?q=${encodeURIComponent(first)}`);
  await expect(result(page, first)).toBeVisible();
  await page.goto("/bsr/new-order?q=motorbike");
  await expect(
    page.locator("[data-result]").getByRole("link").first(),
  ).toBeVisible();
  await page.goto("/bsr/new-order?q=zzzz-nothing");
  await expect(page.locator("[data-result]")).toContainText(
    "Nothing matches “zzzz-nothing”.",
  );
});

test("the channel decides: notice online only, and a coupon only where it can be used; nothing is counted", async ({
  page,
}) => {
  const stamp = Date.now().toString(36).toUpperCase();
  const web = `E2EWEB${stamp}`;
  const moto = `E2EMM${stamp}`;
  await withShopSettings(demo.bsrOwner, "bsr", async () => {
    await withBookingRules(demo.bsrOwner, "bsr", async () => {
      const { db, tenantId, booked, locationId } = await seeded();
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
        p_rules: { locations: [{ id: locationId, min_notice_hours: 720 }] },
      });
      if (rulesError) throw rulesError;

      await signIn(page, demo.bsrOwner);
      await check(
        page,
        scooter.starts,
        scooter.ends,
        "Your booking page",
        scooter.name,
      );
      await expect(result(page, scooter.name)).toContainText(
        "Too soon: the earliest pickup on this channel is",
      );
      await check(
        page,
        scooter.starts,
        scooter.ends,
        "The counter",
        scooter.name,
      );
      await expect(result(page, scooter.name)).not.toContainText("Too soon");

      // The price at the counter: the booking-page coupon is refused.
      const price = priceOf(page, scooter.name, "The counter");
      await expect(price.locator('[data-started="yes"]')).toHaveCount(1);
      await price.getByLabel("Coupon code").fill(web);
      await price.getByRole("button", { name: "Apply" }).click();
      await expect(price.locator("[data-coupon-note]")).toHaveText(
        "Not applied: this coupon can’t be used by staff.",
      );

      // On the booking page it is applied; the Moto Mangos one is not.
      await check(
        page,
        scooter.starts,
        scooter.ends,
        "Your booking page",
        scooter.name,
      );
      const online = priceOf(page, scooter.name, "Your booking page");
      await expect(online.locator('[data-started="yes"]')).toHaveCount(1);
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
      await check(
        page,
        scooter.starts,
        scooter.ends,
        "Moto Mangos",
        scooter.name,
      );
      const mm = priceOf(page, scooter.name, "Moto Mangos");
      await expect(mm.locator('[data-started="yes"]')).toHaveCount(1);
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

/** What only the price part puts in a page: its section, its coupon box, its pricing read. */
const priceMarkers = [
  "data-price-check",
  'id="check-coupon"',
  "pricing_method",
];

for (const who of ["bsrMechanic", "bsrDriver"] as const) {
  test(`${who} sees the counts and no prices, in what the server sends too`, async ({
    page,
  }) => {
    const { booked } = await seeded();
    const name = booked[0].name;
    await signIn(page, demo[who]);
    await page.goto("/bsr/new-order");
    await expect(page.locator("[data-result]")).toContainText(
      "Find a product to see how many are free for these dates.",
    );
    await pick(page, name);
    await expect(result(page, name)).toContainText(/ of \d+ free/);
    await expect(page.getByRole("region", { name: /price from/ })).toHaveCount(
      0,
    );
    await expect(page.getByLabel("Coupon code")).toHaveCount(0);

    // The page as the server sends it (its HTML and the data inlined for
    // React) holds the count and nothing of a price: not the price part,
    // its coupon box, nor the pricing read it is given. (Words alone would
    // prove nothing: every page carries the whole message catalogue.)
    const sent = await (await page.request.get(page.url())).text();
    expect(sent).toContain("data-count");
    for (const marker of priceMarkers)
      expect(sent, marker).not.toContain(marker);
  });
}

test("the owner's page as the server sends it does hold the price (so the check above means something)", async ({
  page,
}) => {
  const { booked } = await seeded();
  await signIn(page, demo.bsrOwner);
  await page.goto("/bsr/new-order");
  await pick(page, booked[0].name);
  const sent = await (await page.request.get(page.url())).text();
  for (const marker of priceMarkers) expect(sent, marker).toContain(marker);
});
