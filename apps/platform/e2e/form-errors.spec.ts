/**
 * Phase 2, stage 10: the shared form (components/action-form.tsx) after a
 * refused save, at 375 px and 1280 px.
 *
 *  - Focus moves to the first field with an error; when that field is put
 *    right and another is still wrong, to that one; when the error has no
 *    field of its own, to the message.
 *  - Each error message has an id, and its input names it in
 *    aria-describedby and is marked aria-invalid, so a screen reader reads
 *    the message with the field.
 *
 *  - A list of checkboxes or of radios is marked as a group and names its
 *    message the same way; its first box, or its chosen radio, takes the
 *    focus.
 *
 * On the new-coupon form, which has every kind of single field, and on the
 * new-product forms, whose lists can be refused. Nothing is ever saved: each
 * attempt is refused, so the tests leave nothing behind and can run in any
 * order, any number of times.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { demo, signIn } from "./helpers";

test("after a refused save, focus is on the first field with an error, and each error is tied to its field", async ({
  page,
}) => {
  await signIn(page, demo.bsrOwner);
  await page.goto("/bsr/settings/coupons/new");

  const code = page.getByLabel("Code", { exact: true });
  const percent = page.getByLabel("Percentage off");
  // Before anything is sent: no field is marked, and none names an error.
  await expect(code).not.toHaveAttribute("aria-invalid", "true");
  await expect(percent).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#code-error")).toHaveCount(0);

  // Two mistakes: a Thai code, and a comma for a decimal point.
  await code.fill("ส่วนลด");
  await percent.fill("12,5");
  await page.getByLabel(/^By staff/).check();
  const create = page.getByRole("button", { name: "Create coupon" });
  await create.click();

  // Each message has its id, and its field points at it.
  const codeError = page.locator("#code-error");
  const percentError = page.locator("#percent-error");
  await expect(codeError).toContainText("Thai letters");
  await expect(percentError).toContainText("Use a dot for decimals");
  await expect(code).toHaveAttribute("aria-invalid", "true");
  await expect(percent).toHaveAttribute("aria-invalid", "true");
  await expect(code).toHaveAttribute(
    "aria-describedby",
    /(^| )code-error( |$)/,
  );
  await expect(percent).toHaveAttribute(
    "aria-describedby",
    /(^| )percent-error( |$)/,
  );
  // Every id a field names is on the page: nothing points at air.
  for (const field of [code, percent]) {
    const ids = ((await field.getAttribute("aria-describedby")) ?? "")
      .split(" ")
      .filter(Boolean);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) await expect(page.locator(`#${id}`)).toHaveCount(1);
  }
  // What a screen reader says with each field.
  await expect(code).toHaveAccessibleDescription(/Thai letters/);
  await expect(percent).toHaveAccessibleDescription(/Use a dot for decimals/);
  // Focus is on the first of the two.
  await expect(code).toBeFocused();

  // The first is put right, the second is still wrong: focus goes to the
  // second, and the first is no longer marked or tied to an error.
  await code.fill("FOCUS TEST");
  await create.click();
  await expect(page.locator("#code-error")).toHaveCount(0);
  await expect(percent).toBeFocused();
  await expect(code).not.toHaveAttribute("aria-invalid", "true");
  await expect(code).not.toHaveAttribute("aria-describedby", /code-error/);
  await expect(percent).toHaveAttribute("aria-invalid", "true");
  await expect(percentError).toBeVisible();

  // An error with no field of its own (no product chosen): the message
  // itself takes the focus, so it is read and scrolled to.
  await percent.fill("12.5");
  await page.getByLabel("Chosen products").check();
  await create.click();
  const productsError = page.locator("#products-error");
  await expect(productsError).toContainText("Choose at least one product");
  await expect(productsError).toBeFocused();
  await expect(percent).not.toHaveAttribute("aria-invalid", "true");
  await expect(page.locator("#percent-error")).toHaveCount(0);

  // Still the new-coupon form: nothing was saved.
  await expect(page).toHaveURL(/\/bsr\/settings\/coupons\/new$/);
});

/** A message as a pattern, whatever its words: the copy is not the test. */
const containing = (text: string) =>
  new RegExp(text.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));

/**
 * What every refused group must show: it is marked, it names its message,
 * every id it names is on the page once, and a screen reader reads the
 * message with it.
 */
async function expectGroupTiedToError(
  page: Page,
  group: Locator,
  errorId: string,
) {
  const error = page.locator(`#${errorId}`);
  await expect(error).toHaveCount(1);
  await expect(error).toHaveAttribute("role", "alert");
  await expect(error).not.toBeEmpty();
  await expect(group).toHaveAttribute("aria-invalid", "true");
  await expect(group).toHaveAttribute(
    "aria-describedby",
    new RegExp(`(^| )${errorId}( |$)`),
  );
  const ids = ((await group.getAttribute("aria-describedby")) ?? "")
    .split(" ")
    .filter(Boolean);
  for (const id of ids) await expect(page.locator(`#${id}`)).toHaveCount(1);
  await expect(group).toHaveAccessibleDescription(
    containing(await error.innerText()),
  );
}

test("a refused save whose error is on a list of checkboxes: the list is marked, names its message, and its first box takes the focus", async ({
  page,
}) => {
  await signIn(page, demo.bsrOwner);
  // A new vehicle product: a motorbike (the kind it opens on) needs a
  // category, and none is ticked. The save is refused, so nothing is added.
  await page.goto("/bsr/products/new");
  const boxes = page.locator('input[type="checkbox"][name="category"]');
  const group = page.locator("fieldset", { has: boxes });
  const form = page.locator("form", { has: group });
  await expect(group).toHaveCount(1);
  await expect(boxes.first()).not.toBeChecked();
  await expect(group.locator("input:checked")).toHaveCount(0);

  // Before anything is sent: not marked, and it names its help line alone.
  await expect(group).not.toHaveAttribute("aria-invalid");
  await expect(group).toHaveAttribute("aria-describedby", "category-help");
  await expect(page.locator("#category-help")).toHaveCount(1);
  await expect(page.locator("#category-error")).toHaveCount(0);

  await form.locator("#name").fill("E2E form errors");
  await form.locator('button[type="submit"]').click();

  await expectGroupTiedToError(page, group, "category-error");
  // The list can't take the focus itself: its first box does.
  await expect(boxes.first()).toBeFocused();
  // The kind above it was not what was wrong: it is not marked.
  await expect(
    page.locator('[role="radiogroup"]', {
      has: page.locator('input[name="vehicle_type"]'),
    }),
  ).not.toHaveAttribute("aria-invalid");

  // Still the new-product form, with what was typed: nothing was saved.
  await expect(page).toHaveURL(/\/bsr\/products\/new$/);
  await expect(form.locator("#name")).toHaveValue("E2E form errors");
});

test("a refused save whose error is on a list of radios: the group is marked, names its message, and the chosen radio takes the focus", async ({
  page,
}) => {
  await signIn(page, demo.bsrOwner);
  // A new general product. Its type is one of three radios, so the page
  // can't send a wrong one by itself: the chosen radio is given a value the
  // server does not know (what an out-of-date page would send), and the
  // server refuses it under the radios. Nothing is added.
  await page.goto("/bsr/products/new");
  await page.locator('input[name="product_choice"][value="general"]').check();
  const radios = page.locator('input[type="radio"][name="type"]');
  const group = page.locator('[role="radiogroup"]', { has: radios });
  const form = page.locator("form", { has: group });
  await expect(group).toHaveCount(1);
  await expect(radios).toHaveCount(3);

  // Before anything is sent: not marked, and nothing to name.
  await expect(group).not.toHaveAttribute("aria-invalid");
  await expect(group).not.toHaveAttribute("aria-describedby");
  await expect(page.locator("#type-error")).toHaveCount(0);

  // The second radio is chosen, so "the chosen one" is not also the first.
  await radios.nth(1).check();
  await form.locator("#name").fill("E2E form errors");
  await radios
    .nth(1)
    .evaluate((radio: HTMLInputElement) => (radio.value = "no-such-type"));
  await form.locator('button[type="submit"]').click();

  await expectGroupTiedToError(page, group, "type-error");
  // The group can't take the focus itself: its chosen radio does.
  await expect(radios.nth(1)).toBeChecked();
  await expect(radios.nth(1)).toBeFocused();

  // Still the new-product form, with what was typed: nothing was saved.
  await expect(page).toHaveURL(/\/bsr\/products\/new$/);
  await expect(form.locator("#name")).toHaveValue("E2E form errors");
});
