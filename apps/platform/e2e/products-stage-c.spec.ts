/**
 * Products, stage C (docs/products-redesign.md §5.11): a motorbike's Moto
 * Mangos tab. From not listed, through Connect, the listing part (the
 * switch that saves by itself, the counts and lead time under one Save,
 * the "Offering N of M" line and the two messages), Change model and
 * Disconnect, and the History's lines; sent for review, rejected, sent
 * again and approved; no tab for a car, a helmet, or staff; old
 * #moto-mangos links and the lists' mango landing on the tab. Phone and
 * desktop widths.
 *
 * Runs against local Supabase or a deploy preview on staging, again and
 * again: whatever a test creates it removes. Approval is by merging into an
 * entry already on the list, so no run adds a lasting entry to the shared
 * Moto Mangos list.
 */
import { expect, test, type Browser, type Page } from "@playwright/test";
import { demo, signIn } from "./helpers";

const stamp = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

const productTabs = (page: Page) =>
  page.getByRole("navigation", { name: "Sections of this product" });
const tab = (page: Page, name: string) =>
  productTabs(page).getByRole("link", { name: new RegExp(`^${name}`) });
const mangosPanel = (page: Page) =>
  page.getByRole("region", { name: "Moto Mangos", exact: true });
const toggle = (page: Page) =>
  mangosPanel(page).getByRole("switch", {
    name: "List this product on Moto Mangos",
  });

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
  await signIn(page, email, path);
  return page;
}

/** A new BSR motorbike (Scooter); answers with its page's address. */
async function newMotorbike(page: Page, name: string) {
  await page.goto("/bsr/products/new");
  await page.getByLabel("Product name").fill(name);
  await page
    .getByRole("group", { name: "Categories" })
    .getByText("Scooter", { exact: true })
    .click();
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return page.url().replace(/\?.*$/, "");
}

/** Adds a vehicle to a product; answers with the vehicle's page. */
async function addVehicle(page: Page, productUrl: string) {
  const id = productUrl.split("/").pop()!;
  await page.goto(`/bsr/fleet/units/new?product=${id}`);
  const plate = `E2E-${stamp()}`.slice(0, 20);
  await page.getByLabel("Plate", { exact: true }).fill(plate);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(
    page.getByRole("heading", { name: plate, level: 1 }),
  ).toBeVisible();
  return page.url().replace(/\?.*$/, "");
}

async function deleteVehicle(page: Page, url: string) {
  await page.goto(url);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete vehicle" }).click();
  await expect(page).toHaveURL(/\/bsr\/fleet(\?.*)?$/);
}

async function deleteProduct(page: Page, url: string) {
  await page.goto(url);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete product" }).click();
  await expect(page).toHaveURL(/\/bsr\/products(\?.*)?$/);
}

/** Picks a make, then its first model, in a Make then Model picker. */
async function pick(scope: ReturnType<Page["locator"]>, make: string) {
  await scope.locator("#list-make").selectOption(make);
  await scope.locator("#catalog_id").selectOption({ index: 1 });
}

test("Moto Mangos tab: Connect, the switch, counts and lead time, Change model, Disconnect, History", async ({
  page,
}) => {
  test.slow();
  await signIn(page, demo.bsrOwner);
  const name = `E2E Tab ${stamp()}`;
  const url = await newMotorbike(page, name);
  const vehicles = [await addVehicle(page, url), await addVehicle(page, url)];

  // The tab is after Units; Details keeps the product form, Duplicate and
  // Delete, and no Moto Mangos panel.
  await page.goto(url);
  await expect(productTabs(page).getByRole("link")).toHaveText([
    "Details",
    /^Units/,
    "Moto Mangos",
    "History",
  ]);
  await expect(mangosPanel(page)).toHaveCount(0);
  await expect(page.getByLabel("Product name")).toBeVisible();
  await expect(page.getByRole("link", { name: "Duplicate" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Delete product" }),
  ).toBeVisible();
  await tab(page, "Moto Mangos").click();
  await expect(page).toHaveURL(/\?tab=moto-mangos$/);
  await expect(tab(page, "Moto Mangos")).toHaveAttribute(
    "aria-current",
    "page",
  );
  const mangos = mangosPanel(page);
  await expect(page.getByLabel("Product name")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Delete product" }),
  ).toHaveCount(0);

  // Not listed: the picker, the review line, and a listing part that
  // can't be used yet.
  await expect(mangos.getByRole("img", { name: "Moto Mangos" })).toBeVisible();
  await expect(
    mangos.getByRole("heading", { name: "List it on Moto Mangos" }),
  ).toBeVisible();
  await expect(
    mangos.getByRole("group", {
      name: "Select your make and model from the list",
    }),
  ).toBeVisible();
  await expect(
    mangos.getByText(
      "Don’t see your bike above? Send us the details and we’ll get it added",
    ),
  ).toBeVisible();
  await expect(
    mangos.getByText(
      "You can switch this on once a model is selected from the list above, or your request is approved.",
    ),
  ).toBeVisible();
  await expect(toggle(page)).toBeDisabled();
  await expect(mangos.getByLabel("Lead time (hours)")).toBeDisabled();
  await expect(
    mangos.getByText(
      "Listing takes effect when Moto Mangos starts reading from this system.",
    ),
  ).toBeVisible();
  await noSidewaysScroll(page);

  // Connect: the picker's button is "Connect" now.
  await expect(
    mangos.getByRole("button", { name: "Select", exact: true }),
  ).toHaveCount(0);
  await pick(mangos, "Honda");
  await mangos.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    mangos.getByText(/^On the Moto Mangos list as Honda /),
  ).toBeVisible();
  await expect(toggle(page)).toBeEnabled();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");

  // The switch saves by itself: no Save button needed, and it stays after
  // a reload.
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  await expect(
    mangos.getByText("On. The switch saves as soon as you press it."),
  ).toBeVisible();
  await page.reload();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");

  // The counts: a line worked out from them, and the owner's two messages
  // as soon as a count is too high. Save waits until they are put right.
  const save = mangos.getByRole("button", { name: "Save", exact: true });
  const offering = mangos.locator("[data-offering]");
  await expect(offering).toHaveText(
    "Offering 0 of 2 bikes for advance booking",
  );
  await mangos.getByLabel("Instant units").fill("2");
  await mangos.getByLabel("Request units").fill("1");
  await expect(offering).toHaveText(
    "Offering 3 of 2 bikes for advance booking",
  );
  await expect(
    mangos.getByText(
      "Total units listed on Moto Mangos can not exceed the number of units in your inventory",
    ),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await mangos.getByLabel("Request units").fill("0");
  await expect(
    mangos.getByText(/Total units listed on Moto Mangos/),
  ).toHaveCount(0);
  await mangos.getByLabel("Walk-ins").fill("3");
  await expect(
    mangos.getByText(
      "Walk-ins can not exceed the number of units in your inventory",
    ),
  ).toBeVisible();
  await expect(save).toBeDisabled();
  await mangos.getByLabel("Walk-ins").fill("1");
  await expect(save).toBeEnabled();
  await expect(offering).toHaveText(
    "Offering 2 of 2 bikes for advance booking",
  );

  // Lead time: 0 to 720 hours, empty for none, with a help line.
  const lead = mangos.getByLabel("Lead time (hours)");
  await expect(lead).toHaveValue("");
  await expect(
    mangos.getByText(
      "How many hours ahead a booking must be made, from 0 to 720. Leave it empty for none.",
    ),
  ).toBeVisible();
  await lead.fill("721");
  await save.click();
  await expect(
    mangos.getByText("Enter whole hours from 0 to 720, or leave it empty."),
  ).toBeVisible();
  await lead.fill("12");
  await save.click();
  await expect(mangos.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(mangos.getByLabel("Instant units")).toHaveValue("2");
  await expect(mangos.getByLabel("Walk-ins")).toHaveValue("1");
  await expect(lead).toHaveValue("12");
  await lead.fill("24");
  await save.click();
  await expect(mangos.getByText("Saved", { exact: true })).toBeVisible();
  await noSidewaysScroll(page);

  // Off and on again, each saved at once.
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  await expect(
    mangos.getByText("Off. The switch saves as soon as you press it."),
  ).toBeVisible();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");

  // Change model: the same picker and button. The listing stays as it is.
  await mangos.getByText("Change model", { exact: true }).click();
  const change = mangos.getByRole("group", {
    name: "Select the new make and model",
  });
  await pick(change, "Yamaha");
  await mangos.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(
    mangos.getByText(/^On the Moto Mangos list as Yamaha /),
  ).toBeVisible();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  await expect(lead).toHaveValue("24");

  // Disconnect asks first; then it is off, back to the picker, its counts
  // at zero and its lead time kept.
  page.once("dialog", (dialog) => void dialog.accept());
  await mangos.getByRole("button", { name: "Disconnect" }).click();
  await expect(
    mangos.getByRole("group", {
      name: "Select your make and model from the list",
    }),
  ).toBeVisible();
  await expect(toggle(page)).toBeDisabled();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "false");
  await expect(mangos.getByLabel("Instant units")).toHaveValue("0");
  await expect(lead).toHaveValue("24");

  // History: the switch in its own words, the lead time on one line, and
  // one line for the disconnect (not a second "switched off" with it).
  await tab(page, "History").click();
  const history = page.locator("ol");
  await expect(history.getByText(/switched Moto Mangos on$/)).toHaveCount(2);
  await expect(history.getByText(/switched Moto Mangos off$/)).toHaveCount(1);
  await expect(
    history.getByText(/changed lead time from 12 to 24 hours$/),
  ).toHaveCount(1);
  await expect(
    history.getByText("Lead time (hours): (empty) → 12"),
  ).toHaveCount(1);
  await expect(
    history.getByText(/moved this product to another Moto Mangos list entry/),
  ).toHaveCount(1);
  await expect(
    history.getByText(/disconnected this product from Moto Mangos/),
  ).toHaveCount(1);
  await expect(history.getByText("Listed on Moto Mangos")).toHaveCount(0);

  for (const vehicle of vehicles) await deleteVehicle(page, vehicle);
  await deleteProduct(page, url);
});

test("Moto Mangos tab: sent for review, rejected, sent again, approved", async ({
  page,
  browser,
}) => {
  test.slow();
  await signIn(page, demo.bsrOwner);
  const make = `E2etab${stamp()}`;
  const url = await newMotorbike(page, `${make} Rider 150`);
  await page.goto(`${url}?tab=moto-mangos`);
  const mangos = mangosPanel(page);

  // Sent with all five details.
  await mangos
    .getByText(
      "Don’t see your bike above? Send us the details and we’ll get it added",
    )
    .click();
  const review = page.locator("#send-for-review");
  await review.getByLabel("Engine size (cc)").fill("150");
  await review.getByLabel("Transmission").selectOption("automatic");
  await review.getByLabel("Year of your bike").fill("2024");
  await mangos.getByRole("button", { name: "Send for review" }).click();
  await expect(mangos.getByText(/Sent to Moto Mangos\./)).toBeVisible();
  await expect(toggle(page)).toBeDisabled();

  // Rejected with a note: the tab says why and what to do next.
  const reviewer = await as(browser, demo.admin, "/admin/catalog");
  const entry = reviewer.locator("li", { hasText: `${make} Rider 150` });
  await entry.getByLabel("Review note").fill("E2E: wrong engine size");
  await entry.getByRole("button", { name: "Reject" }).click();
  await expect(entry).toHaveCount(0);
  await page.reload();
  await expect(
    mangos.getByText(
      /Moto Mangos reviewed this model on .+ and didn't add it\./,
    ),
  ).toBeVisible();
  await expect(mangos.getByText("E2E: wrong engine size")).toBeVisible();
  await expect(mangos.getByText("What to do next")).toBeVisible();
  await expect(
    mangos.getByRole("button", { name: "Connect", exact: true }),
  ).toBeVisible();

  // The dashboard's line opens this tab.
  await page.goto("/bsr/dashboard");
  await page
    .getByRole("region", { name: "Moto Mangos reviews" })
    .getByRole("link", { name: `${make} Rider 150` })
    .click();
  await expect(page).toHaveURL(/\?tab=moto-mangos$/);
  await expect(mangos.getByText("E2E: wrong engine size")).toBeVisible();

  // Edited and sent again, from what was sent before.
  await mangos.getByRole("link", { name: "Edit and send again" }).click();
  await expect(page).toHaveURL(/#send-for-review$/);
  await expect(review.getByLabel("Engine size (cc)")).toHaveValue("150");
  await review.getByLabel("Engine size (cc)").fill("155");
  await review.getByLabel("Year of your bike").fill("2024");
  await mangos.getByRole("button", { name: "Send for review again" }).click();
  await expect(mangos.getByText(/Sent to Moto Mangos\./)).toBeVisible();
  await expect(mangos.getByText("E2E: wrong engine size")).toHaveCount(0);

  // Approved (as an entry already on the list): listed, and the switch can
  // be used.
  await reviewer.reload();
  const again = reviewer.locator("li", { hasText: `${make} Rider 150` });
  await again
    .getByLabel("It is the same bike as")
    .selectOption({ label: "Honda Forza 350" });
  await again.getByRole("button", { name: "Merge" }).click();
  await expect(again).toHaveCount(0);
  await reviewer.context().close();
  await page.reload();
  await expect(
    mangos.getByText(/Moto Mangos added this model to its list on /),
  ).toBeVisible();
  await expect(
    mangos.getByText("On the Moto Mangos list as Honda Forza 350."),
  ).toBeVisible();
  await expect(toggle(page)).toBeEnabled();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  await noSidewaysScroll(page);

  await deleteProduct(page, url);
});

test("no Moto Mangos tab for a car, a helmet, or staff", async ({
  page,
  browser,
}) => {
  await signIn(page, demo.bsrOwner);
  // A car.
  const car = `E2E Car ${stamp()}`;
  await page.goto("/bsr/products/new");
  await page.getByText("Car", { exact: true }).click();
  await page.getByLabel("Product name").fill(car);
  await page
    .getByRole("group", { name: "Categories" })
    .getByText("Sedan", { exact: true })
    .click();
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(
    page.getByRole("heading", { name: car, level: 1 }),
  ).toBeVisible();
  const carUrl = page.url().replace(/\?.*$/, "");
  await expect(tab(page, "Moto Mangos")).toHaveCount(0);
  // Asked for by its address: the Details tab instead.
  await page.goto(`${carUrl}?tab=moto-mangos`);
  await expect(mangosPanel(page)).toHaveCount(0);
  await expect(tab(page, "Details")).toHaveAttribute("aria-current", "page");
  await deleteProduct(page, carUrl);

  // A helmet (rental gear).
  const helmet = `E2E Helmet ${stamp()}`;
  await page.goto("/bsr/products/new");
  await page.getByRole("radio", { name: /^General/ }).check();
  await page.getByRole("radio", { name: /^Rental gear/ }).check();
  await page.getByLabel("Product name").fill(helmet);
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(
    page.getByRole("heading", { name: helmet, level: 1 }),
  ).toBeVisible();
  const helmetUrl = page.url().replace(/\?.*$/, "");
  await expect(tab(page, "Moto Mangos")).toHaveCount(0);
  await page.goto(`${helmetUrl}?tab=moto-mangos`);
  await expect(mangosPanel(page)).toHaveCount(0);
  await expect(tab(page, "Moto Mangos")).toHaveCount(0);
  await deleteProduct(page, helmetUrl);

  // Staff, a mechanic and a driver open a motorbike: its vehicles only.
  await page.goto("/bsr/products?q=Honda%20PCX%20160");
  const pcx = await page
    .getByRole("link", { name: "Honda PCX 160", exact: true })
    .getAttribute("href");
  const pcxUrl = pcx!.replace(/\?.*$/, "");
  for (const who of [demo.bsrStaff, demo.bsrMechanic, demo.bsrDriver]) {
    const other = await as(browser, who, `${pcxUrl}?tab=moto-mangos`);
    await expect(
      other.getByRole("heading", { name: "Honda PCX 160", level: 1 }),
    ).toBeVisible();
    await expect(mangosPanel(other)).toHaveCount(0);
    await expect(tab(other, "Moto Mangos")).toHaveCount(0);
    await expect(
      other.getByRole("link", { name: /Not on Moto Mangos|On Moto Mangos/ }),
    ).toHaveCount(0);
    await other.context().close();
  }
});

test("old #moto-mangos links, the lists' mango and the back link land on the tab", async ({
  page,
}) => {
  await signIn(page, demo.bsrOwner);
  await page.goto("/bsr/products?q=Honda%20PCX%20160");
  const row = page
    .getByRole("list", { name: "Products" })
    .locator("> li")
    .filter({
      has: page.getByRole("link", { name: "Honda PCX 160", exact: true }),
    });
  const href = await row
    .getByRole("link", { name: "Honda PCX 160", exact: true })
    .getAttribute("href");
  const url = href!.replace(/\?.*$/, "");

  // An old link to the panel on the Details tab.
  await page.goto(`${url}#moto-mangos`);
  await expect(page).toHaveURL(/\?tab=moto-mangos$/);
  await expect(mangosPanel(page)).toBeVisible();
  // One to a place in the panel keeps its place.
  await page.goto(`${url}#choose-from-list`);
  await expect(page).toHaveURL(/\?tab=moto-mangos#choose-from-list$/);
  await expect(mangosPanel(page)).toBeVisible();

  // The mango on the Products list opens the tab, 44 px to tap; the back
  // link goes back to the Products list.
  await page.goto("/bsr/products?q=Honda%20PCX%20160");
  const mango = row.locator("[data-mango-link]");
  await expect(mango).toHaveAttribute(
    "href",
    /\/bsr\/products\/[0-9a-f-]{36}\?tab=moto-mangos&back=/,
  );
  const box = (await mango.boundingBox())!;
  expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
  expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
  await mango.click();
  await expect(page).toHaveURL(/\?tab=moto-mangos&back=/);
  await expect(mangosPanel(page)).toBeVisible();
  // The tabs keep the way back.
  await tab(page, "Units").click();
  await tab(page, "Moto Mangos").click();
  await page.locator("[data-back]").click();
  await expect(page).toHaveURL(
    /\/bsr\/products\?q=Honda(%20|\+)PCX(%20|\+)160$/,
  );

  // From Fleet: back to Fleet.
  await page.goto("/bsr/fleet?q=Honda%20PCX%20160");
  const line = page
    .getByRole("list", { name: "Vehicles by product" })
    .locator("[data-fleet-product]")
    .filter({ hasText: "Honda PCX 160" })
    .first();
  await line.locator("[data-mango-link]").click();
  await expect(page).toHaveURL(/\?tab=moto-mangos&back=/);
  await expect(mangosPanel(page)).toBeVisible();
  await expect(page.locator("[data-back]")).toHaveText("Fleet");
  await page.locator("[data-back]").click();
  await expect(page).toHaveURL(/\/bsr\/fleet/);
});

async function shoot(page: Page, name: string) {
  const path = test.info().outputPath(`${name}.png`);
  await page.screenshot({ path, fullPage: true });
  await test.info().attach(name, { path, contentType: "image/png" });
}

test("screenshots: the Moto Mangos tab, not listed and listed, and its History, light and dark", async ({
  page,
}, info) => {
  test.slow();
  await signIn(page, demo.bsrOwner);
  const url = await newMotorbike(page, `E2E Shots ${stamp()}`);
  const vehicles = [await addVehicle(page, url), await addVehicle(page, url)];
  const tabUrl = `${url}?tab=moto-mangos`;
  const both = async (name: string, path = tabUrl) => {
    for (const scheme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("html")).toHaveClass(
        scheme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/,
      );
      await shoot(page, `${info.project.name}-${scheme}-${name}`);
    }
    await page.emulateMedia({ colorScheme: "light" });
  };

  await both("not-listed");
  await page.goto(tabUrl);
  const mangos = mangosPanel(page);
  await pick(mangos, "Honda");
  await mangos.getByRole("button", { name: "Connect", exact: true }).click();
  await expect(toggle(page)).toBeEnabled();
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-checked", "true");
  await mangos.getByLabel("Instant units").fill("1");
  await mangos.getByLabel("Request units").fill("1");
  await mangos.getByLabel("Walk-ins").fill("1");
  await mangos.getByLabel("Lead time (hours)").fill("12");
  await mangos.getByRole("button", { name: "Save", exact: true }).click();
  await expect(mangos.getByText("Saved", { exact: true })).toBeVisible();
  await mangos.getByLabel("Lead time (hours)").fill("24");
  await mangos.getByRole("button", { name: "Save", exact: true }).click();
  await expect(mangos.getByText("Saved", { exact: true })).toBeVisible();
  await both("listed");
  // The two messages, as typed.
  await page.goto(tabUrl);
  await mangos.getByLabel("Request units").fill("2");
  await mangos.getByLabel("Walk-ins").fill("3");
  await expect(mangos.getByRole("alert")).toBeVisible();
  await shoot(page, `${info.project.name}-light-messages`);
  await both("history", `${url}?tab=history`);

  for (const vehicle of vehicles) await deleteVehicle(page, vehicle);
  await deleteProduct(page, url);
});
