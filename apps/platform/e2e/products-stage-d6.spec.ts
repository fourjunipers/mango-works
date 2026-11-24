/**
 * Pricing, stage D6 (docs/products-redesign.md §9.12, §9.15): Settings.
 * The four sections and who may open them; price lists moved under
 * Settings (the old address redirects); the deposit choice, with Check a
 * price agreeing with what is saved in every mode and a vehicle's own
 * deposit kept while the shop takes none; tax profiles (one in use can't be
 * removed, and the refusal names the product), the default and tax added on
 * top; the rounding step changed on screen while saved prices stay as
 * stored; a season shown on the product it covers, in Check a price and in
 * its History; the first save's warning that it fixes the currency, on
 * Settings, on a product's Pricing tab and on a new price list; a shared
 * list read as stored in its editor after the step changes; Thai on a
 * phone. Phone and desktop widths.
 *
 * Runs against local Supabase or a deploy preview on staging, again and
 * again. Whatever a test creates it removes. BSR's pricing settings are
 * held while a test changes them or reads a total, and put back as they
 * were (e2e/shop-settings.ts). No settings row is ever made in the Saigon
 * or big-fleet shops. Every sample rental has a fixed pickup.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { demo, signIn } from "./helpers";
import {
  chooseDeposit,
  currencyFixedBy,
  ownerClient,
  readSettings,
  withShopSettings,
} from "./shop-settings";
import { exactlyOne } from "@mango/db/rows";

const stamp = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

const settingsNav = (page: Page) =>
  page.getByRole("navigation", { name: "Settings sections" });
const checkPrice = (page: Page) =>
  page.getByRole("region", { name: "Check a price" });
const checkRow = (page: Page, label: string | RegExp) =>
  checkPrice(page)
    .locator("dl > div")
    .filter({
      has:
        typeof label === "string"
          ? page.getByText(label, { exact: true })
          : page.getByText(label),
    })
    .locator("dd");
const pickup = (page: Page, at = "2027-01-01T10:00") =>
  checkPrice(page).getByLabel("Pickup").fill(at);

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

async function addBoat(page: Page, name: string): Promise<string> {
  await page.goto("/bsr/products/new");
  await page.getByText("Boat or jet ski", { exact: true }).click();
  await page.getByLabel("Product name").fill(name);
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return page.url().split("?")[0];
}

async function deleteProduct(page: Page, address: string) {
  await page.goto(address);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: /^Delete product$/ }).click();
  await expect(page).toHaveURL(/\/[a-z-]+\/products(\?.*)?$/);
}

const savePrices = async (page: Page) => {
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
};

/** Own prices: ฿300 a day, ฿1,400 a week, ฿3,000 a month, ฿100 a long-stay day. */
async function ownPrices(page: Page, address: string) {
  await page.goto(`${address}?tab=pricing`);
  await page.getByRole("radio", { name: /^By rental length/ }).check();
  await page.getByLabel("Daily (1 day)").fill("300");
  await page.getByLabel("Weekly (7 days)").fill("1400");
  await page.getByLabel("Monthly (30 days)").fill("3000");
  await page.getByLabel("Long-stay daily rate (THB)").fill("100");
  await savePrices(page);
}

/** Check a price for two, 45 days from 1 Jan 2027: what the deposit row says. */
async function depositFor45DaysForTwo(page: Page, address: string) {
  await page.goto(`${address}?tab=pricing`);
  // Check a price's boxes stay disabled until the page has started, so what
  // is typed is what is priced (review of PR 50).
  await pickup(page);
  await checkPrice(page).getByLabel("Days", { exact: true }).fill("45");
  await checkPrice(page).getByLabel("How many").fill("2");
  // 2 × (฿3,000 + 14 × ฿100), whatever the deposit.
  await expect(checkRow(page, "Total")).toHaveText(/^\D*8,800$/);
  return checkRow(page, "Deposit");
}

test("Settings has six sections for owners; staff, mechanics and drivers can't open the first four; old price list links redirect", async ({
  page,
  browser,
}) => {
  await signIn(page, demo.bsrOwner);
  await page.goto("/bsr/settings");
  for (const section of [
    "Shop",
    "Pricing and tax",
    "Seasons",
    "Price lists",
    "Coupons",
    "Extras",
  ])
    await expect(
      settingsNav(page).getByRole("link", { name: section }),
    ).toBeVisible();
  await settingsNav(page).getByRole("link", { name: "Seasons" }).click();
  await expect(page).toHaveURL(/\/bsr\/settings\/seasons$/);
  await expect(
    settingsNav(page).getByRole("link", { name: "Seasons" }),
  ).toHaveAttribute("aria-current", "page");
  await noSidewaysScroll(page);

  // Price lists live under Settings now; the old address still works.
  await page.goto("/bsr/products/price-lists");
  await expect(page).toHaveURL(/\/bsr\/settings\/price-lists$/);
  await expect(
    page.getByRole("heading", { name: "Price lists", level: 1 }),
  ).toBeVisible();
  await page.goto("/bsr/products");
  await page.getByRole("link", { name: "Price lists" }).click();
  await expect(page).toHaveURL(/\/bsr\/settings\/price-lists$/);

  for (const who of [demo.bsrStaff, demo.bsrMechanic, demo.bsrDriver]) {
    const other = await as(browser, who);
    // Not found for them: the page streams, so the answer is in what shows.
    for (const [path, title] of [
      ["pricing", "Pricing and tax"],
      ["seasons", "Seasons"],
      ["price-lists", "Price lists"],
    ] as const) {
      await other.page.goto(`/bsr/settings/${path}`);
      await expect(other.page.getByText("Page not found")).toBeVisible();
      await expect(
        other.page.getByRole("heading", { name: title, level: 1 }),
        `${who} on ${path}`,
      ).toHaveCount(0);
      await expect(settingsNav(other.page)).toHaveCount(0);
    }
    if (who === demo.bsrStaff) {
      // Staff still see prices on the Products list, with no way to the lists.
      await other.page.goto("/bsr/products");
      await expect(
        other.page.getByRole("link", { name: "Price lists" }),
      ).toHaveCount(0);
    }
    await other.close();
  }
});

test("the deposit choice: Check a price agrees with what is saved in every mode; a vehicle's own deposit is kept while the shop takes none", async ({
  page,
}) => {
  const name = `Deposit Boat ${stamp()}`;
  await signIn(page, demo.bsrOwner);
  await withShopSettings(demo.bsrOwner, "bsr", async () => {
    const address = await addBoat(page, name);
    try {
      await ownPrices(page, address);

      // Per vehicle, with a shop amount of ฿1,500 for a vehicle with none.
      await chooseDeposit(page, "bsr", /^Per vehicle/, {
        label: /^Shop amount per vehicle/,
        value: "1500",
      });
      let deposit = await depositFor45DaysForTwo(page, address);
      await expect(deposit).toHaveText(/^\D*3,000$/);
      await page.getByLabel("Deposit (THB)").fill("2000");
      await expect(deposit).toHaveText(/^\D*4,000$/);
      await savePrices(page);
      // Saved: the same after a reload.
      deposit = await depositFor45DaysForTwo(page, address);
      await expect(deposit).toHaveText(/^\D*4,000$/);

      // None: no field, a line saying so with the way to Settings, ฿0.
      await chooseDeposit(page, "bsr", /^No deposit/);
      deposit = await depositFor45DaysForTwo(page, address);
      await expect(deposit).toHaveText(/^\D*0$/);
      await expect(page.getByLabel("Deposit (THB)")).toHaveCount(0);
      await expect(page.getByText("The shop takes no deposit.")).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Change in Settings" }),
      ).toHaveAttribute("href", "/bsr/settings/pricing");

      // A percentage: 10% of ฿8,800.
      await chooseDeposit(page, "bsr", /^A percentage of the order/, {
        label: /^Percentage of the order/,
        value: "10",
      });
      deposit = await depositFor45DaysForTwo(page, address);
      await expect(deposit).toHaveText(/^\D*880$/);

      // A fixed amount per order, however many vehicles.
      await chooseDeposit(page, "bsr", /^A fixed amount per order/, {
        label: /^Amount per order/,
        value: "3000",
      });
      deposit = await depositFor45DaysForTwo(page, address);
      await expect(deposit).toHaveText(/^\D*3,000$/);

      // Back to per vehicle: the vehicle's own ฿2,000 was kept all along.
      await chooseDeposit(page, "bsr", /^Per vehicle/);
      deposit = await depositFor45DaysForTwo(page, address);
      await expect(page.getByLabel("Deposit (THB)")).toHaveValue("2000.00");
      await expect(deposit).toHaveText(/^\D*4,000$/);
    } finally {
      await deleteProduct(page, address);
    }
  });
});

test("tax profiles: one in use can't be removed and the refusal names the product; the default, and tax added on top", async ({
  page,
}) => {
  const profile = "E2E VAT";
  const name = `Taxed Boat ${stamp()}`;
  await signIn(page, demo.bsrOwner);
  await withShopSettings(demo.bsrOwner, "bsr", async () => {
    await page.goto("/bsr/settings/pricing");
    const profiles = page.locator("#tax-profiles");
    // One fixed name, brought back if an earlier run left it removed:
    // profiles are never deleted, so a run adds none.
    const removed = profiles
      .getByRole("listitem")
      .filter({ hasText: profile })
      .getByRole("button", { name: "Bring back" });
    // count() reads the page as it is and does not wait. The section's last
    // element is there only once the whole list is, removed profiles
    // included; without this the check could run on the loading screen, find
    // nothing, and leave a removed profile removed.
    await expect(profiles.getByText("Add a tax profile")).toBeVisible();
    if (await removed.count()) {
      await removed.click();
      await expect(
        profiles.getByText(new RegExp(`^${profile} · 7%`)),
      ).toBeVisible();
    } else if (
      !(await profiles.getByText(new RegExp(`^${profile} · `)).count())
    ) {
      await profiles.getByText("Add a tax profile").click();
      await profiles.locator("#new-name").fill(profile);
      await profiles.locator("#new-rate").fill("7");
      await profiles.getByRole("button", { name: "Add profile" }).click();
      await expect(
        profiles.getByText(new RegExp(`^${profile} · 7%`)),
      ).toBeVisible();
    }

    const address = await addBoat(page, name);
    try {
      // A flat fee of ฿250 a week, taxed at the new profile.
      await page.goto(`${address}?tab=pricing`);
      await page.getByRole("radio", { name: /^Flat fee per period/ }).check();
      await page.getByLabel("Amount (THB)").fill("250");
      await page.getByLabel("Period", { exact: true }).selectOption("week");
      await page
        .getByLabel("Tax on this product")
        .selectOption({ label: profile });
      await savePrices(page);

      // Removing it is refused while the boat names it: the boat is named.
      await page.goto("/bsr/settings/pricing");
      const row = profiles
        .getByRole("listitem")
        .filter({ hasText: new RegExp(`^${profile} · `) });
      await expect(
        row.getByText(new RegExp(`Named by 1 product: .*${name}`)),
      ).toBeVisible();
      page.once("dialog", (dialog) => void dialog.accept());
      await row.getByRole("button", { name: "Remove" }).click();
      await expect(
        row.getByText(new RegExp(`Still named by 1 product: ${name}\\.`)),
      ).toBeVisible();

      // The default, with tax added on top: 7 days is ฿250 + VAT ฿17.50.
      await page
        .getByLabel("Default tax profile")
        .selectOption({ label: profile });
      await page.getByRole("radio", { name: /^Tax is added on top/ }).check();
      await page.getByRole("button", { name: "Save pricing settings" }).click();
      await expect(
        page.getByText("Saved", { exact: true }).first(),
      ).toBeVisible();
      await page.goto(`${address}?tab=pricing`);
      await page
        .getByLabel("Tax on this product")
        .selectOption({ label: `Shop default (${profile})` });
      await savePrices(page);
      await pickup(page);
      await checkPrice(page).getByLabel("Days", { exact: true }).fill("7");
      await expect(checkRow(page, "VAT 7%")).toHaveText(/^\D*17\.50$/);
      await expect(checkRow(page, "Total")).toHaveText(/^\D*267\.50$/);

      // The default can't be removed either; with no default it can.
      await page.goto("/bsr/settings/pricing");
      page.once("dialog", (dialog) => void dialog.accept());
      await row.getByRole("button", { name: "Remove" }).click();
      await expect(
        row.getByText("This is the shop's default tax profile."),
      ).toBeVisible();
      await page
        .getByLabel("Default tax profile")
        .selectOption({ label: "No tax" });
      await page
        .getByRole("radio", { name: /^Our prices include tax/ })
        .check();
      await page.getByRole("button", { name: "Save pricing settings" }).click();
      await expect(
        page.getByText("Saved", { exact: true }).first(),
      ).toBeVisible();
    } finally {
      await deleteProduct(page, address);
    }
    // No product names it now: removed, and listed under Removed profiles.
    await page.goto("/bsr/settings/pricing");
    page.once("dialog", (dialog) => void dialog.accept());
    await profiles
      .getByRole("listitem")
      .filter({ hasText: new RegExp(`^${profile} · `) })
      .getByRole("button", { name: "Remove" })
      .click();
    await expect(
      profiles
        .getByRole("listitem")
        .filter({ hasText: profile })
        .getByRole("button", { name: "Bring back" }),
    ).toBeVisible();
  });
});

test("the rounding step changed in Settings: a saved list reads as stored, and a save of the long-stay rate alone leaves its days", async ({
  page,
}, testInfo) => {
  const isPhone = testInfo.project.name === "phone";
  const name = `Stored Boat ${stamp()}`;
  await signIn(page, demo.bsrOwner);
  await withShopSettings(demo.bsrOwner, "bsr", async () => {
    const { db, tenantId } = await ownerClient(demo.bsrOwner, "bsr");
    const address = await addBoat(page, name);
    const productId = address.split("/").pop()!;
    try {
      await ownPrices(page, address);
      /** The list's 30 days as the database holds them (read as the owner). */
      const storedDays = async () => {
        const { data, error } = await exactlyOne(
          db
            .from("price_templates")
            .select("price_template_days(day, value::text, source)")
            .eq("product_id", productId),
        );
        if (error) throw error;
        return [
          ...(data.price_template_days as {
            day: number;
            value: string;
            source: string;
          }[]),
        ].sort((a, b) => a.day - b.day);
      };
      const before = await storedDays();
      expect(before).toHaveLength(30);
      expect(before[0]).toEqual({ day: 1, value: "30000", source: "anchor" });

      // A step the list was not filled with: ฿20 (or ฿40 if ฿20 is the step).
      // Both keep ฿480 on day 2 of the other tests' lists.
      const step = (await readSettings(db, tenantId))?.rounding_step;
      const newStep = step === "2000" ? "40" : "20";
      await page.goto("/bsr/settings/pricing");
      await expect(
        page.getByText("Prices already saved never change."),
      ).toBeVisible();
      await page.getByLabel("Rounding step (THB)").fill(newStep);
      await page.getByRole("button", { name: "Save pricing settings" }).click();
      await expect(
        page.getByText("Saved", { exact: true }).first(),
      ).toBeVisible();
      expect((await readSettings(db, tenantId))?.rounding_step).toBe(
        `${newStep}00`,
      );

      // Read back: every day is the stored amount, not a new fill.
      await page.goto(`${address}?tab=pricing`);
      if (isPhone)
        await page.getByRole("button", { name: "Show all days" }).click();
      const shown = (value: string) =>
        `${value.slice(0, -2)}.${value.slice(-2)}`;
      for (const d of before)
        await expect(page.locator(`#day-${d.day}`)).toHaveValue(shown(d.value));
      // Check a price charges the stored amount too: 3 days.
      await pickup(page);
      await checkPrice(page).getByLabel("Days", { exact: true }).fill("3");
      const threeDays = Number(before[2].value.slice(0, -2)).toLocaleString(
        "en-US",
      );
      await expect(checkRow(page, "Total")).toHaveText(
        new RegExp(`^\\D*${threeDays}$`),
      );

      // The long-stay rate alone saved: the list's days are as they were.
      await page.getByLabel("Long-stay daily rate (THB)").fill("110");
      await savePrices(page);
      expect(await storedDays()).toEqual(before);

      // A box changed: the days around it are filled in again, to the new step.
      await page.reload();
      if (isPhone)
        await page.getByRole("button", { name: "Show all days" }).click();
      await page.getByLabel("Weekly (7 days)").fill("1500");
      await expect(page.locator("#day-7")).toHaveValue("1500.00");
      await expect(page.locator("#day-3")).not.toHaveValue(
        shown(before[2].value),
      );
    } finally {
      await deleteProduct(page, address);
    }
  });
});

test("a season: made for one product, on its Pricing tab, in Check a price and its History; switched off, then deleted", async ({
  page,
}) => {
  const name = `Season Boat ${stamp()}`;
  const season = `E2E low ${stamp()}`;
  await signIn(page, demo.bsrOwner);
  // Check a price's total depends on the shop's tax settings.
  await withShopSettings(demo.bsrOwner, "bsr", async () => {
    const address = await addBoat(page, name);
    let seasonAddress = "";
    try {
      await ownPrices(page, address);

      await page.goto("/bsr/settings/seasons");
      await page.getByRole("link", { name: "New season" }).click();
      await page.getByLabel("Name", { exact: true }).fill(season);
      await page.getByLabel("First day").fill("2027-04-01");
      await page.getByLabel("Last day").fill("2027-09-30");
      await page.getByRole("radio", { name: "Decrease" }).check();
      await page.getByLabel("Percentage").fill("20");
      await page.getByRole("radio", { name: "Chosen products" }).check();
      await page.getByRole("searchbox", { name: "Search products" }).fill(name);
      await page.getByRole("checkbox", { name }).check();
      await page.getByRole("button", { name: "Create season" }).click();
      await expect(page.getByText("Season saved.")).toBeVisible();
      seasonAddress = page.url().split("?")[0];

      // On the season list, with its dates in the viewer's format.
      await page.goto("/bsr/settings/seasons");
      const line = page.getByRole("listitem").filter({ hasText: season });
      await expect(line).toContainText("Apr 1 to Sep 30, every year");
      await expect(line).toContainText("20% off");
      await expect(line).toContainText("1 product");

      // On the product's Pricing tab, and in Check a price: 7 days from
      // 1 Apr 2027 are all inside, so ฿1,400 − 20% = ฿1,120.
      await page.goto(`${address}?tab=pricing`);
      const card = page.getByRole("region", { name: "Seasons" });
      await expect(card).toContainText(season);
      await expect(card).toContainText("20% off");
      await pickup(page, "2027-04-01T10:00");
      await checkPrice(page).getByLabel("Days", { exact: true }).fill("7");
      await expect(checkRow(page, `Season: ${season}`)).toHaveText(/^−\D*280$/);
      await expect(checkRow(page, "Total")).toHaveText(/^\D*1,120$/);
      // Outside it, the list price.
      await pickup(page, "2027-01-01T10:00");
      await expect(checkRow(page, "Total")).toHaveText(/^\D*1,400$/);

      // Switched off: kept, but no longer on the product.
      await page.goto(seasonAddress);
      await page.getByLabel("Season on").uncheck();
      await page.getByRole("button", { name: "Save season" }).click();
      await expect(page.getByText("Saved", { exact: true })).toBeVisible();
      await page.goto(`${address}?tab=pricing`);
      await expect(page.getByRole("region", { name: "Seasons" })).toHaveCount(
        0,
      );

      // Deleted.
      await page.goto(seasonAddress);
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("button", { name: "Delete season" }).click();
      await expect(page.getByText("Season deleted.")).toBeVisible();
      seasonAddress = "";

      // The product's History tells the story.
      await page.goto(`${address}?tab=history`);
      await expect(
        page.getByText(
          new RegExp(
            `added the season ${season}: 20% off, Apr 1 to Sep 30, every year`,
          ),
        ),
      ).toBeVisible();
      await expect(
        page.getByText(new RegExp(`switched off the season ${season}`)),
      ).toBeVisible();
      await expect(
        page.getByText(new RegExp(`removed the season ${season}`)),
      ).toBeVisible();
    } finally {
      if (seasonAddress) {
        await page.goto(seasonAddress);
        page.once("dialog", (dialog) => void dialog.accept());
        await page.getByRole("button", { name: "Delete season" }).click();
      }
      await deleteProduct(page, address);
    }
  });
});

test("a shared price list reads as stored in its editor after the rounding step changes, and a new name alone leaves its days", async ({
  page,
}, testInfo) => {
  const isPhone = testInfo.project.name === "phone";
  const listName = `Stored list ${stamp()}`;
  await signIn(page, demo.bsrOwner);
  await withShopSettings(demo.bsrOwner, "bsr", async () => {
    const { db, tenantId } = await ownerClient(demo.bsrOwner, "bsr");
    // BSR's currency is fixed already: a new list asks nothing first.
    await page.goto("/bsr/settings/price-lists/new");
    await expect(page.getByText(/fixes the shop's currency/)).toHaveCount(0);
    await page.getByLabel("Name", { exact: true }).fill(listName);
    await page.getByRole("radio", { name: /^Amounts/ }).check();
    await page.getByLabel("Daily (1 day)").fill("300");
    await page.getByLabel("Weekly (7 days)").fill("1400");
    await page.getByLabel("Monthly (30 days)").fill("3000");
    await page.getByRole("button", { name: "Create price list" }).click();
    await expect(page.getByText("Price list saved.")).toBeVisible();
    const listAddress = page.url().split("?")[0];
    const listId = listAddress.split("/").pop()!;
    try {
      /** The list's 30 days as the database holds them (read as the owner). */
      const storedDays = async () => {
        const { data, error } = await exactlyOne(
          db
            .from("price_templates")
            .select("name, price_template_days(day, value::text, source)")
            .eq("id", listId),
        );
        if (error) throw error;
        return {
          name: data.name as string,
          days: [
            ...(data.price_template_days as {
              day: number;
              value: string;
              source: string;
            }[]),
          ].sort((a, b) => a.day - b.day),
        };
      };
      const before = (await storedDays()).days;
      expect(before).toHaveLength(30);
      expect(before[0]).toEqual({ day: 1, value: "30000", source: "anchor" });

      // A step the list was not filled with: ฿20 (or ฿40 if ฿20 is the step).
      const step = (await readSettings(db, tenantId))?.rounding_step;
      const newStep = step === "2000" ? "40" : "20";
      await page.goto("/bsr/settings/pricing");
      await page.getByLabel("Rounding step (THB)").fill(newStep);
      await page.getByRole("button", { name: "Save pricing settings" }).click();
      await expect(
        page.getByText("Saved", { exact: true }).first(),
      ).toBeVisible();
      expect((await readSettings(db, tenantId))?.rounding_step).toBe(
        `${newStep}00`,
      );

      // The editor shows every day as stored, not a new fill.
      const showDays = async () => {
        if (isPhone)
          await page.getByRole("button", { name: "Show all days" }).click();
      };
      const shown = (value: string) =>
        `${value.slice(0, -2)}.${value.slice(-2)}`;
      await page.goto(listAddress);
      await showDays();
      for (const d of before)
        await expect(page.locator(`#day-${d.day}`)).toHaveValue(shown(d.value));

      // A new name alone: saved, and the list's days are as they were.
      await page.getByLabel("Name", { exact: true }).fill(`${listName} B`);
      await page.getByRole("button", { name: "Save price list" }).click();
      await expect(
        page.getByText("Saved", { exact: true }).first(),
      ).toBeVisible();
      const after = await storedDays();
      expect(after.name).toBe(`${listName} B`);
      expect(after.days).toEqual(before);

      // A box changed: the days around it are filled in again, to the new step.
      await page.reload();
      await showDays();
      await page.getByLabel("Weekly (7 days)").fill("1500");
      await expect(page.locator("#day-7")).toHaveValue("1500.00");
      await expect(page.locator("#day-3")).not.toHaveValue(
        shown(before[2].value),
      );
    } finally {
      await page.goto(listAddress);
      page.once("dialog", (dialog) => void dialog.accept());
      await page.getByRole("button", { name: "Delete price list" }).click();
      await expect(page.getByText("Price list deleted.")).toBeVisible();
    }
  });
});

test("the first save warns that it fixes the shop's currency, on Settings, a product's prices and a new price list, and saves nothing if declined", async ({
  page,
}, testInfo) => {
  // Read only: nothing is ever saved in big-fleet (every question is declined).
  test.skip(testInfo.project.name !== "desktop", "one width is enough");
  const { db, tenantId } = await ownerClient(demo.bigOwner, "big-fleet");
  // Decided from the database, not from the page: where the currency is
  // still open, a missing note fails the test instead of skipping it.
  const fixedBy = await currencyFixedBy(db, tenantId);
  if (fixedBy !== null) {
    const reason = `big-fleet's currency is already fixed (${fixedBy}), so no screen warns. This runs in full only where big-fleet has saved nothing priced: a clean database, as in CI`;
    console.log(`Skipped "${testInfo.title}": ${reason}.`);
    test.skip(true, reason);
  }
  // The shop's own currency, whatever it is (big-fleet is not in baht).
  const { data: shop, error: shopError } = await exactlyOne(
    db.from("tenants").select("currency").eq("id", tenantId),
  );
  if (shopError) throw shopError;
  const currency = shop.currency as string;
  const note = page.getByRole("note").filter({
    hasText: `Saving here for the first time fixes the shop's currency as ${currency}.`,
  });
  /** Presses `button`, declines the question, and returns what was asked. */
  const declined = async (button: string) => {
    let asked = "";
    page.once("dialog", (dialog) => {
      asked = dialog.message();
      void dialog.dismiss();
    });
    await page.getByRole("button", { name: button }).click();
    await expect
      .poll(() => asked)
      .toContain(`fixes the shop's currency as ${currency},`);
  };
  await signIn(page, demo.bigOwner);

  // Settings › Pricing and tax.
  await page.goto("/big-fleet/settings/pricing");
  await expect(note).toBeVisible();
  await declined("Save pricing settings");
  await page.reload();
  await expect(note).toBeVisible();

  // A product's first price.
  const { data: product, error } = await exactlyOne(
    db.from("products").select("id").eq("tenant_id", tenantId).limit(1),
  );
  if (error) throw error;
  await page.goto(`/big-fleet/products/${product.id}?tab=pricing`);
  await expect(note).toBeVisible();
  await page.getByRole("radio", { name: /^Flat fee per period/ }).check();
  await page.getByLabel(`Amount (${currency})`).fill("250");
  await declined("Save prices");
  await expect(page.getByText("Saved", { exact: true })).toHaveCount(0);
  await page.reload();
  await expect(note).toBeVisible();
  await expect(
    page.getByRole("radio", { name: /^Flat fee per period/ }),
  ).not.toBeChecked();

  // The shop's first price list.
  await page.goto("/big-fleet/settings/price-lists/new");
  await expect(note).toBeVisible();
  await page.getByLabel("Name", { exact: true }).fill(`Declined ${stamp()}`);
  await page.getByRole("radio", { name: /^Amounts/ }).check();
  await page.getByLabel("Daily (1 day)").fill("300");
  await page.getByLabel("Monthly (30 days)").fill("3000");
  await declined("Create price list");
  await expect(page).toHaveURL(/\/big-fleet\/settings\/price-lists\/new$/);

  // Nothing was saved: the currency is as open as it was.
  expect(await currencyFixedBy(db, tenantId)).toBeNull();
});

test("in Thai: Pricing and tax and Seasons fit a phone", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the narrow-width check");
  await signIn(page, demo.bsrOwner);
  const url = new URL(page.url());
  await page
    .context()
    .addCookies([
      { name: "mw_locale", value: "th", domain: url.hostname, path: "/" },
    ]);
  await page.goto("/bsr/settings/pricing");
  await expect(
    page.getByRole("heading", { name: "ราคาและภาษี", level: 1 }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: /^ต่อคัน/ })).toBeVisible();
  await noSidewaysScroll(page);
  await page.goto("/bsr/settings/seasons/new");
  await expect(page.getByRole("heading", { name: "ฤดูกาลใหม่" })).toBeVisible();
  await noSidewaysScroll(page);
  await page.context().clearCookies({ name: "mw_locale" });
});
