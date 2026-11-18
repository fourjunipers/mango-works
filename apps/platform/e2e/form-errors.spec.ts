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
 * On the new-coupon form, which has every kind of field. Nothing is ever
 * saved: each attempt is refused, so the test leaves no coupon behind.
 */
import { expect, test } from "@playwright/test";
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

test("a checkbox and a radio list of the shared form carry the same wiring", async ({
  page,
}) => {
  await signIn(page, demo.bsrOwner);
  await page.goto("/bsr/settings/coupons/new");
  // The two ticks at the foot of the form have help lines: each help line
  // has an id and its box names it, error or not.
  for (const name of ["withReturningDiscount", "withSeasonDiscount"]) {
    const box = page.locator(`#${name}`);
    const described = await box.getAttribute("aria-describedby");
    if (described === null) {
      // No help line on this box: then there is nothing to name.
      await expect(page.locator(`#${name}-help`)).toHaveCount(0);
      continue;
    }
    expect(described.split(" ")).toContain(`${name}-help`);
    await expect(page.locator(`#${name}-help`)).toHaveCount(1);
    await expect(box).not.toHaveAttribute("aria-invalid", "true");
  }
});
