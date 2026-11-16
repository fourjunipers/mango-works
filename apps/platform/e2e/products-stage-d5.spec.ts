/**
 * Pricing, stage D5 (docs/products-redesign.md §9.12): the Pricing tab.
 * Quick entry and the 30 days (a falling total refused, equal neighbours
 * allowed, a day by hand kept and reset), the long-stay rate and the
 * deposit (moved here from the vehicle form), "Check a price", saving,
 * a reload, the History; shared price lists (create, use with a base price,
 * delete refused while in use); the ways of pricing each type is offered;
 * who sees what (owner edits, staff reads, a mechanic has no tab); Thai on
 * a phone. Phone and desktop widths. (A saved list read back as stored after
 * the rounding step changes is in products-stage-d6.spec.ts, with Settings.)
 *
 * Runs against local Supabase or a deploy preview on staging, again and
 * again: whatever a test creates it removes. The sample rental in "Check a
 * price" always gets a fixed pickup, so no result depends on today's date.
 * A test that reads a total or a deposit holds BSR's pricing settings while
 * it runs and puts them back after (e2e/shop-settings.ts).
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { demo, signIn } from "./helpers";
import { chooseDeposit, withShopSettings } from "./shop-settings";

const stamp = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

const productTabs = (page: Page) =>
  page.getByRole("navigation", { name: "Sections of this product" });
const checkPrice = (page: Page) =>
  page.getByRole("region", { name: "Check a price" });
/** The amount on one row of "Check a price": "Total", "Deposit". */
const checkRow = (page: Page, label: string) =>
  checkPrice(page)
    .locator("dl > div")
    .filter({ has: page.getByText(label, { exact: true }) })
    .locator("dd");
/** The sample rental's pickup, fixed: 1 January 2027, 10:00 on the shop's clock. */
const fixedPickup = (page: Page) =>
  checkPrice(page).getByLabel("Pickup").fill("2027-01-01T10:00");

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

/** A second person, signed in, in their own browser window. */
async function as(browser: Browser, email: string, path: string) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, email);
  await page.goto(path);
  return { page, close: () => context.close() };
}

/** A boat: no category, no Moto Mangos tab, the shortest vehicle form. */
async function addBoat(
  page: Page,
  name: string,
  shop = "bsr",
): Promise<string> {
  await page.goto(`/${shop}/products/new`);
  await page.getByText("Boat or jet ski", { exact: true }).click();
  await page.getByLabel("Product name").fill(name);
  // The deposit is no longer on this form: it is on the Pricing tab.
  await expect(page.getByLabel(/^Deposit/)).toHaveCount(0);
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return page.url().split("?")[0];
}

async function addGeneral(
  page: Page,
  type: "Rental gear" | "Item for sale" | "Service or extra",
  name: string,
): Promise<string> {
  await page.goto("/bsr/products/new");
  await page.getByRole("radio", { name: /^General/ }).check();
  await page.getByRole("radio", { name: new RegExp(`^${type}`) }).check();
  await page.getByLabel("Product name").fill(name);
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return page.url().replace(/\?.*$/, "");
}

async function deleteProduct(page: Page, address: string) {
  await page.goto(address);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: /^Delete product$/ }).click();
  await expect(page).toHaveURL(/\/[a-z-]+\/products(\?.*)?$/);
}

/** On a phone the 30 days are behind "Show all days". */
async function showDays(page: Page, isPhone: boolean) {
  if (isPhone)
    await page.getByRole("button", { name: "Show all days" }).click();
}

const save = async (page: Page) => {
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
};

test("own prices: quick entry, a falling total refused, saved, reloaded, in the History", async ({
  page,
}, testInfo) => {
  const isPhone = testInfo.project.name === "phone";
  const name = `Priced Boat ${stamp()}`;
  await signIn(page, demo.bsrOwner);
  await withShopSettings(demo.bsrOwner, "bsr", async () => {
    // A vehicle's own deposit is asked only while the shop takes one per
    // vehicle: chosen in Settings, as an owner would (stage D6).
    await chooseDeposit(page, "bsr", /^Per vehicle/);
    const address = await addBoat(page, name);

    await productTabs(page).getByRole("link", { name: "Pricing" }).click();
    await expect(page).toHaveURL(/tab=pricing/);
    // A vehicle: by rental length or a flat fee, nothing else.
    await expect(
      page.getByRole("radio", { name: /^By rental length/ }),
    ).toBeVisible();
    await expect(
      page.getByRole("radio", { name: /^Flat fee per period/ }),
    ).toBeVisible();
    await expect(page.getByRole("radio", { name: /^Fixed price/ })).toHaveCount(
      0,
    );
    await expect(page.getByRole("radio", { name: /^Free/ })).toHaveCount(0);

    await page.getByRole("radio", { name: /^By rental length/ }).check();
    await page.getByLabel("Daily (1 day)").fill("300");
    await page.getByLabel("Weekly (7 days)").fill("1400");
    await page.getByLabel("Monthly (30 days)").fill("3000");
    await showDays(page, isPhone);
    // The days between fill in, in equal steps to ฿10.
    await expect(page.locator("#day-2")).toHaveValue("480.00");
    await expect(page.locator("#day-7")).toHaveValue("1400.00");
    await expect(page.locator("#day-30")).toHaveValue("3000.00");

    // A falling total is refused, in words, and Save waits.
    await page.locator("#day-5").fill("100");
    await expect(
      page.getByText("A longer rental can't cost less"),
    ).toBeVisible();
    await expect(page.getByText(/5 days cost less than 4 days/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save prices" }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Reset 5 days" }).click();
    await expect(page.getByText("A longer rental can't cost less")).toHaveCount(
      0,
    );

    // Equal neighbours are fine.
    await page.locator("#day-2").fill("300");
    await expect(page.getByText("A longer rental can't cost less")).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("button", { name: "Save prices" }),
    ).toBeEnabled();

    await page.getByLabel("Long-stay daily rate (THB)").fill("100");
    await page.getByLabel("Deposit (THB)").fill("2000");

    // Check a price, from what is on screen, for a rental from 1 Jan 2027:
    // 7 days, then 45 days, which is a month (to 1 Feb) and 14 days.
    await fixedPickup(page);
    await checkPrice(page).getByLabel("Days", { exact: true }).fill("7");
    await expect(checkPrice(page)).toContainText("7 days from the price list");
    await expect(checkRow(page, "Total")).toHaveText(/^\D*1,400$/);
    await checkPrice(page).getByLabel("Days", { exact: true }).fill("45");
    await expect(checkPrice(page)).toContainText("1 month and 14 days");
    // One: ฿3,000 + 14 × ฿100, and the deposit typed.
    await expect(checkRow(page, "Total")).toHaveText(/^\D*4,400$/);
    await expect(checkRow(page, "Deposit")).toHaveText(/^\D*2,000$/);
    await checkPrice(page).getByLabel("How many").fill("2");
    await expect(checkRow(page, "Total")).toHaveText(/^\D*8,800$/);
    await expect(checkRow(page, "Deposit")).toHaveText(/^\D*4,000$/);

    await save(page);
    await noSidewaysScroll(page);

    // Kept across a reload: the boxes, the day typed by hand, the rest.
    await page.reload();
    await expect(page.getByLabel("Weekly (7 days)")).toHaveValue("1400.00");
    await showDays(page, isPhone);
    await expect(page.locator("#day-2")).toHaveValue("300.00");
    await expect(page.locator("#day-3")).not.toHaveValue("");
    await expect(page.getByLabel("Long-stay daily rate (THB)")).toHaveValue(
      "100.00",
    );
    await expect(page.getByLabel("Deposit (THB)")).toHaveValue("2000.00");

    // A box changed: only the filled days around it move.
    await page.getByLabel("Weekly (7 days)").fill("1500");
    await save(page);

    await page.goto(`${address}?tab=history`);
    await expect(
      page.getByText(/set how it is priced: By rental length/),
    ).toBeVisible();
    await expect(page.getByText(/set the price: daily/)).toBeVisible();
    await expect(page.getByText(/set the deposit to/)).toBeVisible();
    await expect(
      page.getByText(/set the long-stay daily rate to/),
    ).toBeVisible();
    await expect(page.getByText(/changed the weekly price from/)).toBeVisible();

    // The Products list shows its 1-day price.
    await page.goto(`/bsr/products?q=${encodeURIComponent(name)}`);
    await expect(page.getByText(/300 \/ day/)).toBeVisible();

    // The deposit cleared: blank again.
    await page.goto(`${address}?tab=pricing`);
    await page.getByLabel("Deposit (THB)").fill("");
    await save(page);
    await page.reload();
    await expect(page.getByLabel("Deposit (THB)")).toHaveValue("");

    await deleteProduct(page, address);
  });
});

test("a flat fee, and who sees prices: staff read, a mechanic and a driver see none", async ({
  page,
  browser,
}) => {
  const name = `Flat Boat ${stamp()}`;
  await signIn(page, demo.bsrOwner);
  // The totals read below depend on the shop's tax settings.
  await withShopSettings(demo.bsrOwner, "bsr", async () => {
    const address = await addBoat(page, name);
    await page.goto(`${address}?tab=pricing`);
    await page.getByRole("radio", { name: /^Flat fee per period/ }).check();
    await page.getByLabel("Amount (THB)").fill("250");
    await page.getByLabel("Period", { exact: true }).selectOption("week");
    // An amount that is not money is refused, by the field.
    await page.getByLabel("Amount (THB)").fill("lots");
    await page.getByRole("button", { name: "Save prices" }).click();
    await expect(page.getByText(/Enter an amount/)).toBeVisible();
    await page.getByLabel("Amount (THB)").fill("250");
    await save(page);
    await fixedPickup(page);
    await checkPrice(page).getByLabel("Days", { exact: true }).fill("10");
    await expect(checkPrice(page)).toContainText("2 weeks");
    await expect(checkRow(page, "Total")).toHaveText(/^\D*500$/);

    // Staff: the same tab, read only.
    const staff = await as(browser, demo.bsrStaff, `${address}?tab=pricing`);
    await expect(
      staff.page.getByText("You can see these prices but not change them."),
    ).toBeVisible();
    await expect(staff.page.getByLabel("Amount (THB)")).toHaveValue("250.00");
    await expect(staff.page.getByLabel("Amount (THB)")).toBeDisabled();
    await expect(
      staff.page.getByRole("button", { name: "Save prices" }),
    ).toHaveCount(0);
    // Check a price still works for them: 7 days is one week.
    await fixedPickup(staff.page);
    await expect(checkRow(staff.page, "Total")).toHaveText(/^\D*250$/);
    await staff.close();

    // A mechanic and a driver: no Pricing tab, and the address shows Units.
    for (const who of [demo.bsrMechanic, demo.bsrDriver]) {
      const other = await as(browser, who, `${address}?tab=pricing`);
      await expect(
        other.page.getByRole("heading", { name, level: 1 }),
      ).toBeVisible();
      await expect(
        other.page.getByRole("link", { name: "Pricing" }),
      ).toHaveCount(0);
      await expect(checkPrice(other.page)).toHaveCount(0);
      await expect(other.page.getByText("250")).toHaveCount(0);
      await other.close();
    }

    await deleteProduct(page, address);
  });
});

test("a shared price list: made, used with a base price, delete refused while in use", async ({
  page,
}) => {
  const listName = `E2E list ${stamp()}`;
  const name = `Listed Boat ${stamp()}`;
  await signIn(page, demo.bsrOwner);

  await page.goto("/bsr/products");
  await page.getByRole("link", { name: "Price lists" }).click();
  await page.getByRole("link", { name: "New price list" }).click();
  await page.getByLabel("Name", { exact: true }).fill(listName);
  await page
    .getByRole("radio", { name: /^Multipliers of a base price/ })
    .check();
  await page.getByLabel("Daily (1 day)").fill("3");
  await page.getByLabel("Monthly (30 days)").fill("30");
  await page.getByRole("button", { name: "Create price list" }).click();
  await expect(page.getByText("Price list saved.")).toBeVisible();
  const listAddress = page.url().split("?")[0];

  const address = await addBoat(page, name);
  await page.goto(`${address}?tab=pricing`);
  await page.getByRole("radio", { name: /^By rental length/ }).check();
  await page.getByRole("radio", { name: /^Use a shared price list/ }).check();
  await page
    .getByLabel("Price list", { exact: true })
    .selectOption({ label: `${listName} · Multipliers of a base price` });
  await page.getByLabel("Base price (THB)").fill("100");
  await expect(page.getByText("Prices for this product")).toBeVisible();
  await save(page);
  await page.reload();
  await expect(page.getByLabel("Base price (THB)")).toHaveValue("100.00");

  // The list names the product, and won't be deleted while it is on it.
  await page.goto(listAddress);
  await expect(
    page.getByRole("listitem").filter({ hasText: name }),
  ).toBeVisible();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete price list" }).click();
  await expect(
    page.getByText(/used by a product, so it can't be deleted/),
  ).toBeVisible();

  await page.goto(`${address}?tab=history`);
  await expect(
    page.getByText(
      new RegExp(
        `moved it to the shared price list ${listName} with a base price of`,
      ),
    ),
  ).toBeVisible();

  // With the product gone, the list can go.
  await deleteProduct(page, address);
  await page.goto(listAddress);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete price list" }).click();
  await expect(page.getByText("Price list deleted.")).toBeVisible();
});

test("general products get only their ways of pricing; a free service on the list", async ({
  page,
}) => {
  await signIn(page, demo.bsrOwner);
  const service = `Wash ${stamp()}`;
  const serviceAddress = await addGeneral(page, "Service or extra", service);
  await productTabs(page).getByRole("link", { name: "Pricing" }).click();
  await expect(
    page.getByRole("radio", { name: /^By rental length/ }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("radio", { name: /^Flat fee per period/ }),
  ).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Fixed price/ })).toBeVisible();
  await page.getByRole("radio", { name: /^Free/ }).check();
  await save(page);
  await page.goto(`/bsr/products?tab=general&q=${encodeURIComponent(service)}`);
  await expect(page.getByText(/Free/)).toBeVisible();

  const item = `Sticker ${stamp()}`;
  const itemAddress = await addGeneral(page, "Item for sale", item);
  await page.goto(`${itemAddress}?tab=pricing`);
  await expect(
    page
      .getByRole("radiogroup", { name: "How it is priced" })
      .getByRole("radio"),
  ).toHaveCount(1);
  await page.getByRole("radio", { name: /^Fixed price/ }).check();
  await page.getByLabel("Price (THB)").fill("0");
  await page.getByRole("button", { name: "Save prices" }).click();
  await expect(page.getByText(/can't be 0/)).toBeVisible();
  await page.getByLabel("Price (THB)").fill("150");
  await save(page);

  await deleteProduct(page, serviceAddress);
  await deleteProduct(page, itemAddress);
});

test("in Thai: the tab and its six boxes fit a phone", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "the narrow-width check");
  const name = `Thai Boat ${stamp()}`;
  await signIn(page, demo.bsrOwner);
  const address = await addBoat(page, name);
  const url = new URL(page.url());
  await page
    .context()
    .addCookies([
      { name: "mw_locale", value: "th", domain: url.hostname, path: "/" },
    ]);
  await page.goto(`${address}?tab=pricing`);
  await expect(
    page.getByRole("heading", { name: "วิธีคิดราคา" }),
  ).toBeVisible();
  await page.getByRole("radio", { name: /^ตามระยะเวลาเช่า/ }).check();
  await expect(page.getByLabel("รายวัน (1 วัน)")).toBeVisible();
  await expect(page.getByLabel("รายเดือน (30 วัน)")).toBeVisible();
  await noSidewaysScroll(page);
  await page.context().clearCookies({ name: "mw_locale" });
  await deleteProduct(page, address);
});
