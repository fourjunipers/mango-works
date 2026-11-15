/**
 * Dragging to reorder on Fleet and the Products list (design §5.8; owner, 14
 * Nov 2026). In reorder mode each row has a small drag handle at its outside
 * edge, after the arrows, and only the handle starts a drag:
 *
 * - mouse: press the handle and move 8 px; a plain click does nothing;
 * - touch: hold the handle a quarter of a second, then drag; a quick tap does
 *   nothing and a finger that moves sooner scrolls the page;
 * - keyboard: Space to pick up, arrows to move, Space to drop, Escape to
 *   cancel, with what a screen reader is told.
 *
 * The order is saved through the same move as the arrows, is shared by both
 * lists, includes general products, and is still there after a reload. The
 * drag library is fetched in reorder mode only, which only owners and
 * managers reach.
 *
 * Touch is simulated: real touch events sent through Chromium's own input
 * pipeline (Input.dispatchTouchEvent), not a phone. At 375 px and 1280 px.
 */
import {
  expect,
  test,
  type Browser,
  type Locator,
  type Page,
} from "@playwright/test";
import { demo, signIn } from "./helpers";

const shop = "big-fleet";
const stamp = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

const productsList = (page: Page) =>
  page.getByRole("list", { name: "Products" });
const fleetList = (page: Page) =>
  page.getByRole("list", { name: "Vehicles by product" });
const handle = (page: Page, name: string) =>
  page.getByRole("button", { name: `Drag to move: ${name}`, exact: true });
/** What the drag library tells a screen reader. */
const spoken = (page: Page) => page.locator('[id^="DndLiveRegion"]');

/** The names on a list, top to bottom. */
const namesOf = (list: Locator) =>
  list
    .locator("[data-list-row] .font-semibold[title]")
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("title")!),
    );

/** The list with `name` moved to where `over` is, as lib/general-products moveInList. */
function moved(names: string[], name: string, over: string) {
  const next = names.filter((other) => other !== name);
  next.splice(names.indexOf(over), 0, name);
  return next;
}

async function centre(target: Locator) {
  const box = (await target.boundingBox())!;
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

/** Runs `action` and waits for the move it makes to be saved. */
async function saving(page: Page, action: () => Promise<void>) {
  const done = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      "next-action" in response.request().headers(),
  );
  await action();
  await done;
}

/** The list in the middle of the screen, clear of the bars around it. */
const bringIntoView = (list: Locator) =>
  list.evaluate((element) => element.scrollIntoView({ block: "center" }));

async function mouseDrag(page: Page, from: Locator, to: Locator) {
  const start = await centre(from);
  const end = await centre(to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  // 8 px starts it.
  await page.mouse.move(start.x, start.y + 10, { steps: 4 });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.waitForTimeout(100);
  await page.mouse.up();
}

/** Real touch events, through Chromium's input pipeline. */
async function touchScreen(page: Page) {
  const session = await page.context().newCDPSession(page);
  const send = (type: string, point?: { x: number; y: number }) =>
    session.send("Input.dispatchTouchEvent", {
      type: type as "touchStart",
      touchPoints: point ? [{ x: point.x, y: point.y }] : [],
    });
  return {
    start: (point: { x: number; y: number }) => send("touchStart", point),
    move: (point: { x: number; y: number }) => send("touchMove", point),
    end: () => send("touchEnd"),
  };
}

/** A finger slides from one point to another. */
async function slide(
  page: Page,
  touch: Awaited<ReturnType<typeof touchScreen>>,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  const steps = 12;
  for (let step = 1; step <= steps; step++) {
    await touch.move({
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
    });
    await page.waitForTimeout(16);
  }
}

/** Hold the handle, then drag it onto another row's handle. */
async function touchDrag(page: Page, from: Locator, to: Locator) {
  const touch = await touchScreen(page);
  const start = await centre(from);
  const end = await centre(to);
  await touch.start(start);
  // A quarter of a second, and a little more.
  await page.waitForTimeout(350);
  await slide(page, touch, start, end);
  await page.waitForTimeout(100);
  await touch.end();
}

/** Keys at a person's speed: the library measures the list between them. */
async function keys(page: Page, ...pressed: string[]) {
  for (const key of pressed) {
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
  }
}

/** The addresses of the scripts this page has fetched that hold the drag library. */
async function dragScripts(page: Page) {
  return page.evaluate(async () => {
    const scripts = performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((name) => /\/_next\/.*\.js(\?|$)/.test(name));
    const found: string[] = [];
    for (const src of new Set(scripts)) {
      const text = await (await fetch(src)).text();
      // The library's own ids for its screen-reader text.
      if (text.includes("DndDescribedBy") || text.includes("DndLiveRegion"))
        found.push(src);
    }
    return found;
  });
}

async function resetOrder(page: Page) {
  await page.goto(`/${shop}/products?reorder=1`);
  await expect(page.getByRole("link", { name: "Done" })).toBeVisible();
  const reset = page.getByRole("button", { name: "Reset to A–Z" });
  if (await reset.isVisible()) {
    page.once("dialog", (dialog) => void dialog.accept());
    await reset.click();
    await expect(reset).toHaveCount(0);
  }
}

async function open(browser: Browser, width: number, height: number) {
  const context = await browser.newContext({
    viewport: { width, height },
    hasTouch: true,
  });
  const page = await context.newPage();
  await signIn(page, demo.bigOwner);
  return { page, close: () => context.close() };
}

test("drag to reorder with a mouse, a finger and the keyboard; saved, shared by both lists, kept after a reload", async ({
  page,
  browser,
}, testInfo) => {
  // The order belongs to the whole shop, so this runs once (in the phone
  // project) and opens both widths itself; side by side, the two projects
  // would reorder the same shop under each other.
  test.skip(
    testInfo.project.name !== "phone",
    "one shop-wide order: run once, both widths inside",
  );
  test.setTimeout(240_000);
  await signIn(page, demo.bigOwner);
  await resetOrder(page);

  // A general product, to take part in the order.
  const gear = `E2E Drag helmet ${stamp()}`;
  await page.goto(`/${shop}/products/new`);
  await page.getByRole("radio", { name: /^General/ }).check();
  await page.getByRole("radio", { name: /^Rental gear/ }).check();
  await page.getByLabel("Product name").fill(gear);
  await page.getByRole("button", { name: "Add product" }).click();
  await expect(page.getByText("Product saved.")).toBeVisible();
  const gearUrl = page.url().replace(/\?.*$/, "");

  try {
    for (const size of [
      // Short enough for the page to scroll under a finger.
      { name: "phone", width: 375, height: 600 },
      { name: "desktop", width: 1280, height: 800 },
    ]) {
      const opened = await open(browser, size.width, size.height);
      const p = opened.page;
      const products = productsList(p);
      const check = async (list: Locator, expected: string[]) => {
        await expect.poll(() => namesOf(list)).toEqual(expected);
      };
      const reload = async (list: Locator, expected: string[]) => {
        await p.reload();
        await check(list, expected);
        await bringIntoView(list);
      };

      await p.goto(`/${shop}/products?reorder=1`);
      await expect(
        p.getByText(
          "Select and drag to move anywhere on the list, or use the arrows to move one row at a time",
        ),
      ).toBeVisible();
      let order = await namesOf(products);
      expect(order.length).toBeGreaterThanOrEqual(5);
      expect(order).toContain(gear);
      await bringIntoView(products);

      // Pictures of reorder mode at this width, light and dark, attached to
      // the run.
      for (const scheme of ["dark", "light"] as const) {
        await p.emulateMedia({ colorScheme: scheme });
        await expect(p.locator("html")).toHaveClass(
          scheme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/,
        );
        const shot = testInfo.outputPath(
          `reorder-${size.name}-${scheme}.png`,
        );
        await p.screenshot({ path: shot });
        await testInfo.attach(`reorder-${size.name}-${scheme}`, {
          path: shot,
          contentType: "image/png",
        });
      }

      // The handle: after the arrows, at the row's outside edge, small to
      // see, 44 px to hold, and it
      // leaves the page free to scroll under a finger.
      const first = handle(p, order[0]);
      const box = (await first.boundingBox())!;
      expect(Math.round(box.width)).toBeGreaterThanOrEqual(44);
      expect(Math.round(box.height)).toBeGreaterThanOrEqual(44);
      expect(
        await first
          .locator("svg")
          .evaluate((svg) => svg.getBoundingClientRect().width),
      ).toBeLessThanOrEqual(16);
      // Up, down, then the handle, side by side without overlapping; the
      // arrows are 44 px too; the handle ends the row; the name has room.
      const arrow = async (direction: "up" | "down") => {
        const found = (await p
          .getByRole("button", { name: `Move ${direction}: ${order[0]}` })
          .boundingBox())!;
        expect(Math.round(found.width)).toBeGreaterThanOrEqual(44);
        expect(Math.round(found.height)).toBeGreaterThanOrEqual(44);
        return found;
      };
      const up = await arrow("up");
      const down = await arrow("down");
      expect(up.x + up.width).toBeLessThanOrEqual(down.x + 0.5);
      expect(down.x + down.width).toBeLessThanOrEqual(box.x + 0.5);
      const rowBox = (await products
        .locator("[data-list-row]")
        .first()
        .boundingBox())!;
      // Nothing but the row's padding is to the right of the handle.
      expect(rowBox.x + rowBox.width - (box.x + box.width)).toBeLessThanOrEqual(
        20,
      );
      expect(box.x + box.width).toBeLessThanOrEqual(rowBox.x + rowBox.width);
      // Names stay readable: at least 130 px for the name on a phone.
      const nameWidth = await products
        .locator("[data-list-row] .font-semibold[title]")
        .first()
        .evaluate((element) => element.getBoundingClientRect().width);
      expect(nameWidth).toBeGreaterThanOrEqual(130);
      expect(
        await first.evaluate((button) => getComputedStyle(button).touchAction),
      ).toBe("manipulation");
      expect(await handle(p, order[1]).count()).toBe(1);
      expect(
        await p.evaluate(
          () => document.documentElement.scrollWidth - window.innerWidth,
        ),
      ).toBeLessThanOrEqual(0);

      // Mouse ---------------------------------------------------------------
      // A plain click on the handle does nothing.
      await first.click();
      // Dragging the row by its name does nothing: only the handle drags.
      await mouseDrag(
        p,
        products.locator(`.font-semibold[title="${order[0]}"]`),
        products.locator(`.font-semibold[title="${order[2]}"]`),
      );
      await p.waitForTimeout(300);
      await check(products, order);
      // The first row onto the third.
      let next = moved(order, order[0], order[2]);
      await saving(p, () =>
        mouseDrag(p, handle(p, order[0]), handle(p, order[2])),
      );
      await check(products, next);
      await expect(spoken(p)).toHaveText(
        `${order[0]} dropped at position 3 of ${order.length}.`,
      );
      order = next;
      await reload(products, order);

      // Touch (simulated) ---------------------------------------------------
      const touch = await touchScreen(p);
      // A quick tap does nothing.
      const tapAt = await centre(handle(p, order[3]));
      await touch.start(tapAt);
      await p.waitForTimeout(60);
      await touch.end();
      await p.waitForTimeout(300);
      await check(products, order);
      // A finger that moves at once scrolls the page and moves nothing.
      if (size.name === "phone") {
        expect(
          await p.evaluate(
            () => document.documentElement.scrollHeight - window.innerHeight,
          ),
        ).toBeGreaterThan(60);
        await p.evaluate(() => window.scrollTo(0, 0));
        await handle(p, order[0]).scrollIntoViewIfNeeded();
        const before = await p.evaluate(() => window.scrollY);
        const from = await centre(handle(p, order[0]));
        await touch.start(from);
        await slide(p, touch, from, { x: from.x, y: from.y - 160 });
        await touch.end();
        await expect
          .poll(() => p.evaluate(() => window.scrollY))
          .toBeGreaterThan(before + 40);
        await check(products, order);
        await bringIntoView(products);
      }
      // Hold, then drag: the fourth row onto the second.
      next = moved(order, order[3], order[1]);
      await saving(p, () =>
        touchDrag(p, handle(p, order[3]), handle(p, order[1])),
      );
      await check(products, next);
      order = next;
      await reload(products, order);

      // Keyboard ------------------------------------------------------------
      // Escape puts it back.
      await handle(p, order[1]).focus();
      await keys(p, "Space");
      await expect(spoken(p)).toHaveText(
        `Picked up ${order[1]}. Position 2 of ${order.length}.`,
      );
      await keys(p, "ArrowDown");
      await expect(spoken(p)).toHaveText(
        `${order[1]}: position 3 of ${order.length}.`,
      );
      await keys(p, "Escape");
      await expect(spoken(p)).toHaveText(
        `Move cancelled. ${order[1]} is back at position 2 of ${order.length}.`,
      );
      await check(products, order);
      // Space, two rows down, Space. The general product is the one moved
      // when it isn't in the way, so it takes part.
      const picked = order.indexOf(gear) <= order.length - 3 ? gear : order[0];
      const from = order.indexOf(picked);
      next = moved(order, picked, order[from + 2]);
      await handle(p, picked).focus();
      // The handle says what to do with it.
      const described = await handle(p, picked).getAttribute(
        "aria-describedby",
      );
      await expect(p.locator(`[id="${described}"]`)).toHaveText(
        "Press Space to pick up. Then use the arrow keys to move it, Space to drop it, or Escape to cancel.",
      );
      await keys(p, "Space", "ArrowDown", "ArrowDown");
      await saving(p, () => keys(p, "Space"));
      await check(products, next);
      await expect(spoken(p)).toHaveText(
        `${picked} dropped at position ${from + 3} of ${order.length}.`,
      );
      order = next;
      await reload(products, order);

      // The arrows still work, from the order the drags left.
      next = moved(order, order[2], order[1]);
      await p.getByRole("button", { name: `Move up: ${order[2]}` }).click();
      await check(products, next);
      order = next;

      // Fleet: the same order, without the general product ------------------
      const fleet = fleetList(p);
      await p.goto(`/${shop}/fleet?reorder=1`);
      let vehicles = order.filter((name) => name !== gear);
      await check(fleet, vehicles);
      await bringIntoView(fleet);
      // A product's group is shut while reordering, and drags as one block.
      await expect(fleet.locator("details")).toHaveCount(0);
      const last = vehicles[vehicles.length - 1];
      next = moved(vehicles, last, vehicles[0]);
      await saving(p, () =>
        size.name === "phone"
          ? touchDrag(p, handle(p, last), handle(p, vehicles[0]))
          : mouseDrag(p, handle(p, last), handle(p, vehicles[0])),
      );
      await check(fleet, next);
      vehicles = next;
      // And by keyboard: the first one down a row.
      next = moved(vehicles, vehicles[0], vehicles[1]);
      await handle(p, vehicles[0]).focus();
      await keys(p, "Space", "ArrowDown");
      await saving(p, () => keys(p, "Space"));
      await check(fleet, next);
      vehicles = next;
      await reload(fleet, vehicles);

      // Done: no handles; a tap opens a line again and the pencil is back.
      await p.getByRole("link", { name: "Done" }).click();
      await expect(p).not.toHaveURL(/reorder/, { timeout: 20_000 });
      await expect(p.locator("[data-drag-handle]")).toHaveCount(0);
      await check(fleet, vehicles);
      const line = fleet.locator("details[data-fleet-product]").first();
      const wasOpen = await line.evaluate(
        (d) => (d as HTMLDetailsElement).open,
      );
      await line.locator("summary").click({ position: { x: 4, y: 4 } });
      expect(await line.evaluate((d) => (d as HTMLDetailsElement).open)).toBe(
        !wasOpen,
      );
      await expect(
        fleet.getByRole("link", { name: `Edit product: ${vehicles[0]}` }),
      ).toBeVisible();

      // The Products list shows what Fleet did; the general product is still
      // in the order.
      await p.goto(`/${shop}/products`);
      await expect
        .poll(async () =>
          (await namesOf(products)).filter((name) => name !== gear),
        )
        .toEqual(vehicles);
      expect(await namesOf(products)).toContain(gear);
      await opened.close();
    }
  } finally {
    await resetOrder(page);
    await page.goto(gearUrl);
    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Delete product" }).click();
    await expect(page).toHaveURL(/\/products$/);
  }
});

test("the drag library is fetched in reorder mode only, and never for staff", async ({
  page,
  browser,
}) => {
  // Read-only: nothing is moved here.
  await signIn(page, demo.bigOwner);
  for (const path of ["fleet", "products"]) {
    // An owner on the list as it normally is: no handle, no library.
    await page.goto(`/${shop}/${path}`);
    await expect(page.getByRole("link", { name: "Reorder" })).toBeVisible();
    await expect(page.locator("[data-drag-handle]")).toHaveCount(0);
    await page.waitForLoadState("networkidle");
    expect(await dragScripts(page)).toEqual([]);

    // In reorder mode: handles, and the library.
    await page.goto(`/${shop}/${path}?reorder=1`);
    await expect(page.locator("[data-drag-handle]").first()).toBeVisible();
    await page.waitForLoadState("networkidle");
    expect((await dragScripts(page)).length).toBeGreaterThan(0);
  }

  // Staff can't reorder: no handles and no library, even when asked for in
  // the address.
  const context = await browser.newContext();
  const staff = await context.newPage();
  await signIn(staff, demo.both, "/saigon-scooters/products");
  for (const path of ["fleet?reorder=1", "products?reorder=1"]) {
    await staff.goto(`/saigon-scooters/${path}`);
    await expect(staff.getByRole("heading", { level: 1 })).toBeVisible();
    // Not in reorder mode (and the shop may have nothing to list).
    await expect(staff.getByRole("link", { name: "Done" })).toHaveCount(0);
    await expect(staff.locator("[data-drag-handle]")).toHaveCount(0);
    await staff.waitForLoadState("networkidle");
    expect(await dragScripts(staff)).toEqual([]);
  }
  await context.close();
});
