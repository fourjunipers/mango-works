/**
 * Stage D7 (docs/products-redesign.md §9.11): BSR's four Booqable price lists
 * and TEST prices for its scooters, on STAGING only.
 *
 *   npm run load:bsr-pricing -w @mango/platform              what would match, then the checks (reads only)
 *   npm run load:bsr-pricing -w @mango/platform -- --load    loads, then the checks
 *
 * Everything is written through the platform's own functions, signed in as
 * BSR's demo owner: save_price_template, save_product_pricing and
 * save_pricing_settings. No table is written directly and no service key is
 * used. Safe to run again: a list is found by its name and updated, a
 * product's pricing is saved over itself, and nothing is made twice.
 *
 * The target comes from STAGING_SUPABASE_URL and STAGING_ANON_KEY only
 * (apps/platform/.env.local, never committed), with DEMO_PASSWORD for the
 * sign-in. It never runs against live or a local database.
 *
 * These are test prices: the lists are BSR's real ones, but which scooter is
 * on which list is round-robin. Live gets BSR's real prices at go-live.
 *
 * No arithmetic on money here: amounts are written out below as BSR types
 * them, turned into minor units digit by digit (lib/money.ts), and priced by
 * quote() in @mango/core.
 */
import { createClient } from "@supabase/supabase-js";
import { quote } from "@mango/core/quote";
import { minorDecimal, parseMinorUnits } from "../lib/money.ts";
import { quoteInputFor, type PricingInputs } from "../lib/pricing-inputs.ts";
import { fromLocalInput } from "../lib/shop-time.ts";

const load = process.argv.includes("--load");

const SHOP = "bsr";
const OWNER = "owner@bsr.demo.test";
/** The live project. This script refuses it whatever the variables say. */
const LIVE_REF = "mfaqydyoweerlqsgwnay";

function fail(message: string): never {
  console.error(`load-bsr-pricing: ${message}`);
  process.exit(1);
}

const url = process.env.STAGING_SUPABASE_URL;
const anonKey = process.env.STAGING_ANON_KEY;
const password = process.env.DEMO_PASSWORD;
if (!url || !anonKey)
  fail(
    "set STAGING_SUPABASE_URL and STAGING_ANON_KEY in apps/platform/.env.local",
  );
if (!password) fail("set DEMO_PASSWORD in apps/platform/.env.local");
if (url.includes(LIVE_REF)) fail("STAGING_SUPABASE_URL names the live project");
if (/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url))
  fail(`STAGING_SUPABASE_URL points at a local server (${url})`);

// ------------------------------------------------------------------ the data

/** The currency every amount below is written in. BSR's must be this one. */
const CURRENCY = "THB";

/**
 * The four lists, from BSR's Booqable account at a base price of 100: the
 * total for each of days 1 to 30. Equal neighbours are intended. No hourly
 * price. `longStayDay` is the daily rate from day 31 for a product on the
 * list, and `deposit` what each scooter takes; both as written by the owner.
 * `at45Days` is what a 45-day rental must come to (the 30-day total and 15
 * long-stay days), written out so nothing here is worked out in code.
 */
const lists = [
  {
    name: "300–3000",
    days: "300, 600, 900, 1200, 1300, 1350, 1400, 1500, 1600, 1700, 1800, 1900, 2000, 2100, 2200, 2300, 2400, 2450, 2500, 2550, 2600, 2650, 2700, 2750, 2800, 2850, 2900, 2950, 2950, 3000",
    longStayDay: "100.00",
    at45Days: "4500.00",
  },
  {
    name: "350–3500",
    days: "350, 700, 1050, 1350, 1400, 1450, 1500, 1650, 1800, 1950, 2100, 2250, 2400, 2500, 2600, 2700, 2800, 2850, 2900, 2950, 3000, 3000, 3100, 3200, 3250, 3300, 3350, 3400, 3450, 3500",
    longStayDay: "116.67",
    at45Days: "5250.05",
  },
  {
    name: "400–4000",
    days: "400, 800, 1200, 1500, 1600, 1700, 1800, 1950, 2100, 2250, 2400, 2550, 2700, 2800, 2900, 3000, 3100, 3200, 3300, 3400, 3500, 3600, 3650, 3700, 3750, 3800, 3850, 3900, 3950, 4000",
    longStayDay: "133.33",
    at45Days: "5999.95",
  },
  {
    name: "500–5400",
    days: "500, 1000, 1500, 1900, 2000, 2100, 2200, 2400, 2600, 2800, 3000, 3200, 3350, 3500, 3650, 3800, 3950, 4100, 4250, 4400, 4500, 4600, 4700, 4800, 4900, 5000, 5100, 5200, 5300, 5400",
    longStayDay: "180.00",
    at45Days: "8100.00",
  },
];

const DEPOSIT = "2000";

/**
 * BSR's scooters, matched to its products by name. Test prices: the four
 * lists are given out in turn, in this order. BSR's bigger bikes are not
 * here; the owner prices those by hand.
 */
const scooters = [
  "Benelli Leoncino 250",
  "Benelli TNT135",
  "Fazzio",
  "GPX 250",
  "Honda ADV160",
  "Honda Click 125",
  "Honda Click 150",
  "Honda Click 160",
  "Honda Giorno",
  "Honda Lead",
  "Honda PCX",
  "Honda Scoopy",
  "Honda Spacy",
  "Honda Zoomer-X",
  "Yamaha Nmax",
  "Ryuka Infinity 250",
  "Yamaha Aerox",
  "Yamaha Fino",
  "Yamaha Freego",
  "Yamaha Grand Filano",
  "Yamaha GT",
  "Yamaha Mio 115",
  "Yamaha Qbix",
  "Yamaha TTX",
  "Kawasaki Z250SL",
];

/** An amount as written above, in minor units. */
function minor(text: string): bigint {
  const value = parseMinorUnits(text, CURRENCY);
  if (value === null || value === "invalid") fail(`not an amount: ${text}`);
  return value;
}

const plan = lists.map((list) => {
  const days = list.days.split(",").map((day) => minor(day));
  if (days.length !== 30) fail(`${list.name} has ${days.length} days, not 30`);
  return {
    name: list.name,
    days,
    longStayDay: minor(list.longStayDay),
    at45Days: minor(list.at45Days),
  };
});
/** Which list each scooter takes: the four in turn. */
const listFor = (index: number) => plan[index % plan.length];
const deposit = minor(DEPOSIT);

// -------------------------------------------------------------- the database

const db = createClient(url, anonKey, {
  db: { schema: "platform" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const same = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();
const baht = (value: bigint | string) => minorDecimal(value, CURRENCY);

type Product = { id: string; name: string };
type ListRow = {
  id: string;
  name: string;
  kind: string;
  hourly: string | null;
  price_template_days: { day: number; value: string; source: string }[];
};

async function sharedLists(tenantId: string): Promise<ListRow[]> {
  const { data, error } = await db
    .from("price_templates")
    .select(
      "id, name, kind, hourly::text, price_template_days(day, value::text, source)",
    )
    .eq("tenant_id", tenantId)
    .is("product_id", null);
  if (error) throw error;
  return data as unknown as ListRow[];
}

/** The one shared list of this name. Two is a fault: stop. */
function listNamed(rows: ListRow[], name: string): ListRow | undefined {
  const found = rows.filter((row) => row.name === name);
  if (found.length > 1) fail(`BSR has ${found.length} lists named ${name}`);
  return found[0];
}

async function main() {
  console.log(
    `BSR test prices on STAGING: ${url}${load ? "" : " (reads only)"}`,
  );

  const { error: signInError } = await db.auth.signInWithPassword({
    email: OWNER,
    password: password!,
  });
  if (signInError) fail(`sign-in as ${OWNER} refused: ${signInError.message}`);

  const { data: tenant, error: tenantError } = await db
    .from("tenants")
    .select("id, currency")
    .eq("slug", SHOP)
    .single();
  if (tenantError) throw tenantError;
  if (tenant.currency !== CURRENCY)
    fail(`BSR's currency is ${tenant.currency}; the figures are ${CURRENCY}`);
  const tenantId = tenant.id as string;

  // ---- match the scooters to BSR's products, by name
  const { data: productRows, error: productError } = await db
    .from("products")
    .select("id, name")
    .eq("tenant_id", tenantId)
    .eq("type", "vehicle")
    .order("name");
  if (productError) throw productError;
  const products = productRows as Product[];

  const matched: { name: string; product: Product; index: number }[] = [];
  const missing: { name: string; index: number; near: string[] }[] = [];
  scooters.forEach((name, index) => {
    const found = products.filter((product) => same(product.name, name));
    if (found.length > 1)
      fail(`BSR has ${found.length} products named ${name}`);
    if (found.length === 1) matched.push({ name, product: found[0], index });
    else
      missing.push({
        name,
        index,
        near: products
          .map((product) => product.name)
          .filter((other) => {
            const a = other.toLowerCase().replace(/[^a-z0-9]/g, "");
            const b = name.toLowerCase().replace(/[^a-z0-9]/g, "");
            return a.includes(b) || b.includes(a);
          }),
      });
  });

  console.log(
    `\nProducts: ${matched.length} of ${scooters.length} found by name`,
  );
  for (const { name, index } of matched)
    console.log(`  ${name.padEnd(22)} ${listFor(index).name}`);
  if (missing.length > 0) {
    console.log(`Not in BSR on staging (${missing.length}), left alone:`);
    for (const { name, index, near } of missing)
      console.log(
        `  ${name.padEnd(22)} ${listFor(index).name}${near.length ? `   similar: ${near.join("; ")}` : ""}`,
      );
  }

  // ---- load
  if (load) {
    const existing = await sharedLists(tenantId);
    for (const list of plan) {
      const found = listNamed(existing, list.name);
      const { error } = await db.rpc("save_price_template", {
        p_tenant_id: tenantId,
        p_template: {
          ...(found ? { id: found.id } : { kind: "amounts" }),
          name: list.name,
          hourly: null,
          // Every day as loaded, so the uneven steps are never refilled.
          days: list.days.map((value, i) => ({
            day: i + 1,
            value: value.toString(),
            source: "manual",
          })),
        },
      });
      if (error) fail(`save_price_template ${list.name}: ${error.message}`);
      console.log(`  list ${list.name} ${found ? "updated" : "made"}`);
    }

    const saved = await sharedLists(tenantId);
    for (const { name, product, index } of matched) {
      const list = listFor(index);
      const { error } = await db.rpc("save_product_pricing", {
        p_product_id: product.id,
        p_settings: {
          pricing_method: "tiered",
          price_template_id: listNamed(saved, list.name)!.id,
          long_stay_day: list.longStayDay.toString(),
          deposit: deposit.toString(),
        },
      });
      if (error) fail(`save_product_pricing ${name}: ${error.message}`);
    }
    console.log(`  ${matched.length} products priced`);

    // The deposit choice is set explicitly (stage D6's note for D7). The
    // rounding step, the tax profiles and the default are not sent, so they
    // stay as they are.
    const { error } = await db.rpc("save_pricing_settings", {
      p_tenant_id: tenantId,
      p_settings: { deposit_mode: "per_product", tax_inclusive: true },
    });
    if (error) fail(`save_pricing_settings: ${error.message}`);
    console.log("  settings: deposit per vehicle, prices include tax");
  }

  // ---- checks, reads only
  const problems: string[] = [];
  const check = (ok: boolean, what: string) => {
    if (!ok) problems.push(what);
  };
  console.log("\nChecks");

  // 1. Four lists, 30 days each, the figures above.
  const now = await sharedLists(tenantId);
  for (const list of plan) {
    const row = now.filter((r) => r.name === list.name);
    check(row.length === 1, `${list.name}: ${row.length} lists of this name`);
    if (row.length !== 1) continue;
    const days = [...row[0].price_template_days].sort((a, b) => a.day - b.day);
    check(row[0].kind === "amounts", `${list.name}: kind is ${row[0].kind}`);
    check(row[0].hourly === null, `${list.name}: has an hourly price`);
    check(days.length === 30, `${list.name}: ${days.length} days`);
    list.days.forEach((value, i) =>
      check(
        days[i]?.day === i + 1 && days[i]?.value === value.toString(),
        `${list.name} day ${i + 1}: ${days[i]?.value} stored, ${value} expected`,
      ),
    );
  }
  const before1 = problems.length;
  console.log(
    `  1. four lists, 30 days each, matching: ${before1 === 0 ? "pass" : "FAIL"}`,
  );

  // 2. Each product on the right list and long-stay rate, with the deposit.
  const { data: pricingRows, error: pricingError } = await db
    .from("product_pricing")
    .select(
      "product_id, pricing_method, price_template_id, long_stay_day::text, deposit::text, tax_profile_id",
    )
    .eq("tenant_id", tenantId);
  if (pricingError) throw pricingError;
  const pricing = pricingRows as unknown as {
    product_id: string;
    pricing_method: string | null;
    price_template_id: string | null;
    long_stay_day: string | null;
    deposit: string | null;
    tax_profile_id: string | null;
  }[];
  let right = 0;
  for (const { name, product, index } of matched) {
    const list = listFor(index);
    const row = pricing.find((p) => p.product_id === product.id);
    const listId = now.find((r) => r.name === list.name)?.id;
    const ok =
      row !== undefined &&
      row.pricing_method === "tiered" &&
      listId !== undefined &&
      row.price_template_id === listId &&
      row.long_stay_day === list.longStayDay.toString() &&
      row.deposit === deposit.toString();
    if (ok) right++;
    check(
      ok,
      `${name}: not on ${list.name} with its long-stay rate and deposit`,
    );
  }
  check(
    matched.length === scooters.length,
    `${scooters.length - matched.length} of the ${scooters.length} scooters are not products in BSR`,
  );
  console.log(
    `  2. products on the right list, long-stay rate and ${baht(deposit)} deposit: ${right} of ${scooters.length}${right === scooters.length ? " pass" : " FAIL"}`,
  );

  // 3. No product names an archived tax profile (the whole shop).
  const { data: profiles, error: profileError } = await db
    .from("tax_profiles")
    .select("id, archived_at")
    .eq("tenant_id", tenantId);
  if (profileError) throw profileError;
  const archived = new Set(
    profiles.filter((p) => p.archived_at !== null).map((p) => p.id as string),
  );
  const onArchived = pricing.filter(
    (p) => p.tax_profile_id !== null && archived.has(p.tax_profile_id),
  ).length;
  check(
    onArchived === 0,
    `${onArchived} products name an archived tax profile`,
  );
  console.log(
    `  3. products naming an archived tax profile: ${onArchived}${onArchived === 0 ? " pass" : " FAIL"}`,
  );

  // 4. quote() for one product per list at 1, 7, 30 and 45 days. April has
  // 30 days, so 45 days from 1 April is one month and 15 long-stay days.
  const pickup = "2027-04-01T10:00";
  const returns = [
    { days: 1, dropoff: "2027-04-02T10:00" },
    { days: 7, dropoff: "2027-04-08T10:00" },
    { days: 30, dropoff: "2027-05-01T10:00" },
    { days: 45, dropoff: "2027-05-16T10:00" },
  ];
  // Days and months run on the clock of the shop's main location.
  const { data: location, error: locationError } = await db
    .from("locations")
    .select("timezone")
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .single();
  if (locationError) throw locationError;
  const timeZone = location.timezone as string;
  const start = fromLocalInput(pickup, timeZone);
  for (const list of plan) {
    const sample = matched.find(({ index }) => listFor(index) === list);
    if (!sample) {
      check(false, `${list.name}: no product on it to quote`);
      console.log(`  4. ${list.name}: no product to quote FAIL`);
      continue;
    }
    const { data: inputs, error } = await db.rpc("pricing_inputs", {
      p_tenant_id: tenantId,
      p_product_ids: [sample.product.id],
    });
    if (error) throw error;
    const seasons = (inputs as PricingInputs).seasons.length;
    check(seasons === 0, `${sample.name}: ${seasons} seasons apply to it`);
    const cells: string[] = [];
    for (const { days, dropoff } of returns) {
      const end = fromLocalInput(dropoff, timeZone);
      if (!start || !end) fail("the sample dates could not be read");
      const result = quote(
        quoteInputFor(inputs as PricingInputs, [
          {
            id: "check",
            productId: sample.product.id,
            quantity: 1,
            span: { start, end, timeZone },
          },
        ]),
      );
      const expected = days === 45 ? list.at45Days : list.days[days - 1];
      const got = result.ok ? result.totals.total : null;
      const paid = result.ok ? result.deposit.amount : null;
      check(
        got === expected,
        `${sample.name} (${list.name}) at ${days} days: ${got === null ? "no price" : baht(got)}, expected ${baht(expected)}`,
      );
      check(
        paid === deposit,
        `${sample.name} at ${days} days: deposit ${paid === null ? "none" : baht(paid)}`,
      );
      cells.push(
        `${days}d ${got === null ? "no price" : baht(got)}${got === expected ? "" : " (FAIL)"}`,
      );
    }
    console.log(`  4. ${list.name}, ${sample.name}: ${cells.join(", ")}`);
  }

  // The shop's settings, as the pricer reads them.
  const { data: shop, error: shopError } = await db.rpc("pricing_inputs", {
    p_tenant_id: tenantId,
    p_product_ids: [],
  });
  if (shopError) throw shopError;
  const settings = (shop as PricingInputs).settings;
  check(
    settings?.deposit_mode === "per_product",
    `deposit choice is ${settings?.deposit_mode ?? "not set"}`,
  );
  check(settings?.tax_inclusive === true, "prices do not include tax");
  console.log(
    `  settings: deposit ${settings?.deposit_mode ?? "not set"}, prices include tax ${settings?.tax_inclusive ?? "not set"}, rounding step ${settings?.rounding_step ?? "not chosen"}, default tax profile ${settings?.default_tax_profile_id ? "set" : "none"}`,
  );

  if (problems.length > 0) {
    console.log(`\n${problems.length} problems:`);
    for (const problem of problems) console.log(`  ${problem}`);
    process.exit(1);
  }
  console.log("\nAll checks pass.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
