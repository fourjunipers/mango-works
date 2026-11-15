/**
 * Products, stage D4 (docs/products-redesign.md §9.2): a vehicle's deposit
 * moved from the product to platform.product_pricing, written through
 * platform.save_product_pricing(). Nothing on the screen changed, and that
 * is what this holds: the deposit is still typed on the product form, still
 * there after a reload, still in the History, and gone when it is cleared.
 * The Pricing tab comes in the next stage.
 *
 * Runs against local Supabase or a deploy preview on staging, again and
 * again: the product it creates it removes.
 */
import { expect, test } from "@playwright/test";
import { demo, signIn } from "./helpers";

test("a vehicle's deposit: typed on the form, kept, in the History, cleared", async ({
  page,
}) => {
  const name = `Deposit Boat ${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;
  const deposit = page.getByLabel("Deposit (THB)");

  await signIn(page, demo.bsrOwner);
  await page.goto("/bsr/products/new");
  // A boat needs no category and has no Moto Mangos panel: the shortest form.
  await page.getByText("Boat or jet ski", { exact: true }).click();
  await page.getByLabel("Product name").fill(name);
  await deposit.fill("2000");
  await page.getByRole("button", { name: "Save product" }).click();
  await expect(page.getByRole("heading", { name, level: 1 })).toBeVisible();
  const address = page.url().split("?")[0];

  // Still there on the product's own page, in the shop's currency.
  await page.goto(address);
  await expect(deposit).toHaveValue("2000.00");

  // Changed, and kept across a reload.
  await deposit.fill("2500.50");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(deposit).toHaveValue("2500.50");

  // An amount that is not money is refused, and the stored one is untouched.
  await deposit.fill("lots");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.reload();
  await expect(deposit).toHaveValue("2500.50");

  // The History tells both changes as the product's own.
  await page.goto(`${address}?tab=history`);
  await expect(page.getByText(/Deposit/).first()).toBeVisible();

  // Cleared: blank again.
  await page.goto(address);
  await deposit.fill("");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Saved", { exact: true })).toBeVisible();
  await page.reload();
  await expect(deposit).toHaveValue("");

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Delete product" }).click();
  await expect(page).toHaveURL(/\/bsr\/products(\?.*)?$/);
});
