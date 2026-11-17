/**
 * Phase 2, stage 6: the Extras screens (docs/phase-2-plan.md §7). A
 * vehicle's Extras tab and Settings › Extras, as an owner (edits) and as
 * staff (reads, no controls); "Not offered for this vehicle"; the History
 * lines; and every other Settings page still "Page not found" for staff,
 * now that the Settings layout lets staff in for Extras. Phone (375 px) and
 * desktop widths.
 *
 * Runs against local Supabase or a deploy preview on staging, again and
 * again. Whatever a test creates it removes. BSR's "every vehicle" list is
 * one list the whole shop shares: a test that changes it holds a lock
 * across workers and both widths, and puts the list back as it was.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { acquireFileLock } from "./file-lock";
import { demo, signIn } from "./helpers";
import { ownerClient } from "./shop-settings";

const stamp = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

async function noSidewaysScroll(page: Page) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
}

async function as(browser: Browser, email: string) {
  const context = await browser.newContext({
    viewport: test.info().project.use.viewport ?? undefined,
  });
  const page = await context.newPage();
  await signIn(page, email);
  return { page, close: () => context.close() };
}

/** A vehicle product (a boat: no Moto Mangos tab), made as the owner. */
async function addBoat(page: Page, name: string): Promise<string> {
  await page.goto("/bsr/products/new");
  await page.getByText("Boat or jet ski", { exact: true }).click();
  await page.getByLabel("Product name").fill(name);
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return page.url().split("?")[0];
}

/** Rental gear, 5 in stock, made as the owner. */
async function addGear(page: Page, name: string): Promise<string> {
  await page.goto("/bsr/products/new");
  await page.getByRole("radio", { name: /^General/ }).check();
  await page.getByRole("radio", { name: /^Rental gear/ }).check();
  await page.getByLabel("Product name").fill(name);
  await page.getByLabel("Quantity", { exact: true }).fill("5");
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  return page.url().split("?")[0];
}

async function deleteProduct(page: Page, address: string) {
  await page.goto(address);
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: /^Delete product$/ }).click();
  await expect(page).toHaveURL(/\/[a-z-]+\/products(\?.*)?$/);
}

/** Adds a gear product to the list on screen. */
async function addLine(page: Page, gear: string) {
  await page
    .getByLabel("Add rental gear or a service")
    .selectOption({ label: `${gear} · Rental gear` });
  await page.getByRole("button", { name: "Add", exact: true }).click();
}

async function saveExtras(page: Page) {
  await page.getByRole("button", { name: "Save extras" }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
}

/**
 * Runs `body` holding BSR's "every vehicle" list, then saves it back as it
 * was, through save_product_extras() as the owner (no service key, so it
 * works on a deploy preview too).
 */
async function withEveryVehicleList(body: () => Promise<void>) {
  test.setTimeout(5 * 60_000);
  const release = await acquireFileLock(
    join(tmpdir(), "mango-e2e-extras-every-vehicle-bsr.lock"),
  );
  try {
    const { db, tenantId } = await ownerClient(demo.bsrOwner, "bsr");
    const read = async () => {
      const { data, error } = await db
        .from("product_extras")
        .select("extra_product_id, included_quantity, max_quantity")
        .eq("tenant_id", tenantId)
        .is("product_id", null)
        .order("sort_position");
      if (error) throw error;
      return data;
    };
    const before = await read();
    try {
      await body();
    } finally {
      const { error } = await db.rpc("save_product_extras", {
        p_tenant_id: tenantId,
        p_product_id: null,
        p_extras: before,
      });
      if (error) throw error;
    }
  } finally {
    release();
  }
}

test("an owner sets a vehicle's extras on its Extras tab: Included free and Most per vehicle, a most below the included refused, saved and in its History", async ({
  page,
}) => {
  test.setTimeout(3 * 60_000);
  await signIn(page, demo.bsrOwner);
  const boatName = `Extras boat ${stamp()}`;
  const gearName = `Extras helmet ${stamp()}`;
  const gear = await addGear(page, gearName);
  const boat = await addBoat(page, boatName);
  try {
    await page.goto(`${boat}?tab=extras`);
    await expect(
      page.getByRole("heading", { name: "Offered with this vehicle" }),
    ).toBeVisible();
    await expect(page.getByText("Nothing of its own yet.")).toBeVisible();
    await addLine(page, gearName);
    const line = page.locator("li[data-extra]").filter({ hasText: gearName });
    await expect(line.getByLabel("Most per vehicle")).toHaveAttribute(
      "placeholder",
      "No limit",
    );

    // A most below the included quantity is refused before anything is sent.
    await line.getByLabel("Included free").fill("3");
    await line.getByLabel("Most per vehicle").fill("2");
    await expect(
      line.getByText("The most per vehicle can't be below the number included."),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Save extras" }),
    ).toBeDisabled();

    await line.getByLabel("Included free").fill("1");
    await expect(
      line.getByText("The most per vehicle can't be below the number included."),
    ).toHaveCount(0);
    await noSidewaysScroll(page);
    await saveExtras(page);

    await page.reload();
    const saved = page.locator("li[data-extra]").filter({ hasText: gearName });
    await expect(saved.getByLabel("Included free")).toHaveValue("1");
    await expect(saved.getByLabel("Most per vehicle")).toHaveValue("2");
    await noSidewaysScroll(page);

    await page.goto(`${boat}?tab=history`);
    await expect(
      page.getByText(`added ${gearName}: 1 included, most 2 per vehicle`),
    ).toBeVisible();
  } finally {
    await deleteProduct(page, boat);
    await deleteProduct(page, gear);
  }
});

test("Settings › Extras: the owner adds to the list for every vehicle; a vehicle switches it off with Not offered for this vehicle; both in History", async ({
  page,
}) => {
  await withEveryVehicleList(async () => {
    await signIn(page, demo.bsrOwner);
    const boatName = `Extras boat ${stamp()}`;
    const gearName = `Extras rain gear ${stamp()}`;
    const gear = await addGear(page, gearName);
    const boat = await addBoat(page, boatName);
    try {
      await page.goto("/bsr/settings");
      await page
        .getByRole("navigation", { name: "Settings sections" })
        .getByRole("link", { name: "Extras" })
        .click();
      await expect(page).toHaveURL(/\/bsr\/settings\/extras$/);
      await expect(
        page.getByRole("heading", { name: "Extras", level: 1 }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Offered with every vehicle" }),
      ).toBeVisible();
      await addLine(page, gearName);
      const line = page.locator("li[data-extra]").filter({ hasText: gearName });
      await line.getByLabel("Included free").fill("2");
      await noSidewaysScroll(page);
      await saveExtras(page);
      await page.reload();
      await expect(
        page.getByText(
          new RegExp(`added ${gearName}: 2 included, no limit per vehicle \\(every vehicle\\)`),
        ),
      ).toBeVisible();

      // On the boat it comes from the shop's list, until it is switched off.
      await page.goto(`${boat}?tab=extras`);
      const shopLine = page
        .locator("li[data-shop-extra]")
        .filter({ hasText: gearName });
      await expect(shopLine).toContainText(
        "2 included · Most per vehicle: no limit",
      );
      const off = shopLine.getByLabel("Not offered for this vehicle");
      await expect(off).not.toBeChecked();
      await off.check();
      await noSidewaysScroll(page);
      await saveExtras(page);
      await page.reload();
      await expect(
        page
          .locator("li[data-shop-extra]")
          .filter({ hasText: gearName })
          .getByLabel("Not offered for this vehicle"),
      ).toBeChecked();

      await page.goto(`${boat}?tab=history`);
      await expect(
        page.getByText(`set ${gearName} to Not offered for this vehicle`),
      ).toBeVisible();
    } finally {
      await deleteProduct(page, boat);
      await deleteProduct(page, gear);
    }
  });
});

test("staff read both screens with no controls; a mechanic reads the Extras tab and not Settings › Extras", async ({
  page,
  browser,
}) => {
  test.setTimeout(3 * 60_000);
  await signIn(page, demo.bsrOwner);
  const boatName = `Extras boat ${stamp()}`;
  const gearName = `Extras helmet ${stamp()}`;
  const gear = await addGear(page, gearName);
  const boat = await addBoat(page, boatName);
  try {
    await page.goto(`${boat}?tab=extras`);
    await addLine(page, gearName);
    const line = page.locator("li[data-extra]").filter({ hasText: gearName });
    await line.getByLabel("Included free").fill("1");
    await line.getByLabel("Most per vehicle").fill("2");
    await saveExtras(page);

    const staff = await as(browser, demo.bsrStaff);
    try {
      await staff.page.goto(`${boat}?tab=extras`);
      await expect(
        staff.page.getByRole("heading", { name: "Offered with this vehicle" }),
      ).toBeVisible();
      await expect(
        staff.page.locator("li").filter({ hasText: gearName }),
      ).toContainText("1 included · Most per vehicle: 2");
      await expect(
        staff.page.getByText("Only an owner or a manager can change extras."),
      ).toBeVisible();
      await expect(
        staff.page.getByRole("button", { name: "Save extras" }),
      ).toHaveCount(0);
      await expect(
        staff.page.getByLabel("Add rental gear or a service"),
      ).toHaveCount(0);
      await expect(staff.page.getByRole("textbox")).toHaveCount(0);
      await noSidewaysScroll(staff.page);

      // Settings › Extras: read-only, with no menu of sections and no History.
      await staff.page
        .getByRole("link", { name: "Settings › Extras: what every vehicle offers" })
        .click();
      await expect(staff.page).toHaveURL(/\/bsr\/settings\/extras$/);
      await expect(
        staff.page.getByRole("heading", { name: "Extras", level: 1 }),
      ).toBeVisible();
      await expect(
        staff.page.getByRole("heading", { name: "Offered with every vehicle" }),
      ).toBeVisible();
      await expect(
        staff.page.getByRole("button", { name: "Save extras" }),
      ).toHaveCount(0);
      await expect(
        staff.page.getByRole("navigation", { name: "Settings sections" }),
      ).toHaveCount(0);
      await expect(
        staff.page.getByRole("heading", { name: "History" }),
      ).toHaveCount(0);
      await noSidewaysScroll(staff.page);
    } finally {
      await staff.close();
    }

    const mechanic = await as(browser, demo.bsrMechanic);
    try {
      await mechanic.page.goto(`${boat}?tab=extras`);
      await expect(
        mechanic.page.locator("li").filter({ hasText: gearName }),
      ).toContainText("1 included · Most per vehicle: 2");
      await expect(
        mechanic.page.getByRole("button", { name: "Save extras" }),
      ).toHaveCount(0);
      await mechanic.page.goto("/bsr/settings/extras");
      await expect(mechanic.page.getByText("Page not found")).toBeVisible();
      await expect(
        mechanic.page.getByRole("heading", { name: "Extras", level: 1 }),
      ).toHaveCount(0);
    } finally {
      await mechanic.close();
    }
  } finally {
    await deleteProduct(page, boat);
    await deleteProduct(page, gear);
  }
});

/**
 * The Settings layout lets staff in for Extras, so every other Settings
 * page must turn them away itself (tests/settings-access.test.ts holds the
 * code to it). One test per page: the owner sees it, staff get "Page not
 * found" and no part of it.
 */
test.describe("every other Settings page is Page not found for staff", () => {
  test.describe.configure({ mode: "serial" });
  let seasonId = "";
  let listId = "";
  let tenantId = "";

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(2 * 60_000);
    const owner = await ownerClient(demo.bsrOwner, "bsr");
    tenantId = owner.tenantId;
    // Switched off and far ahead: it changes no price.
    const { data, error } = await owner.db.rpc("save_price_rule", {
      p_tenant_id: tenantId,
      p_rule: {
        name: `Extras season ${stamp()}`,
        starts_on: "2040-01-01",
        ends_on: "2040-01-02",
        repeats_yearly: false,
        adjust_bp: -1000,
        all_products: true,
        active: false,
        product_ids: [],
      },
    });
    if (error) throw error;
    seasonId = data as string;
    // A price list nothing is priced from.
    const page = (await as(browser, demo.bsrOwner)).page;
    await page.goto("/bsr/settings/price-lists/new");
    await page.getByLabel("Name", { exact: true }).fill(`Extras list ${stamp()}`);
    await page.getByRole("radio", { name: /^Amounts/ }).check();
    await page.getByLabel("Daily (1 day)").fill("300");
    await page.getByLabel("Monthly (30 days)").fill("3000");
    await page.getByRole("button", { name: "Create price list" }).click();
    await expect(page.getByText("Price list saved.")).toBeVisible();
    listId = page.url().split("?")[0].split("/").pop()!;
    await page.context().close();
  });

  test.afterAll(async () => {
    const owner = await ownerClient(demo.bsrOwner, "bsr");
    if (seasonId)
      await owner.db.rpc("save_price_rule", {
        p_tenant_id: tenantId,
        p_rule: { id: seasonId, delete: true },
      });
    if (listId)
      await owner.db.rpc("delete_price_template", { p_template_id: listId });
  });

  const pages: [string, () => string, string][] = [
    ["Shop", () => "", "Shop settings"],
    ["Pricing and tax", () => "/pricing", "Pricing and tax"],
    ["Seasons", () => "/seasons", "Seasons"],
    ["a new season", () => "/seasons/new", "New season"],
    ["a season", () => `/seasons/${seasonId}`, "Extras season"],
    ["Price lists", () => "/price-lists", "Price lists"],
    ["a new price list", () => "/price-lists/new", "New price list"],
    ["a price list", () => `/price-lists/${listId}`, "Extras list"],
  ];

  for (const [what, path, heading] of pages) {
    test(`${what}`, async ({ page, browser }) => {
      const address = `/bsr/settings${path()}`;
      await signIn(page, demo.bsrOwner);
      await page.goto(address);
      const title = page.getByRole("heading", { level: 1 });
      await expect(title).toContainText(heading);

      const staff = await as(browser, demo.bsrStaff);
      try {
        await staff.page.goto(address);
        await expect(staff.page.getByText("Page not found")).toBeVisible();
        await expect(
          staff.page.getByRole("heading", { level: 1, name: new RegExp(heading) }),
        ).toHaveCount(0);
        await expect(
          staff.page.getByRole("navigation", { name: "Settings sections" }),
        ).toHaveCount(0);
      } finally {
        await staff.close();
      }
    });
  }
});
