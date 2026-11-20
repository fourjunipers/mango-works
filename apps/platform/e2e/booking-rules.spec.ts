/**
 * Phase 2, stage 11: Settings › Booking rules, at 375 px and 1280 px.
 *
 * An owner saves the shop's hold length, a location's notice and a
 * vehicle's own minimum days, and finds them after a reload; a value out of
 * range is refused in words, on its box, with the focus on it. Staff,
 * mechanics and drivers are answered "Page not found". Every rule is put
 * back afterwards (e2e/booking-rules.ts).
 */
import { expect, test } from "@playwright/test";
import { withBookingRules } from "./booking-rules";
import { demo, signIn } from "./helpers";

test("an owner saves the booking rules, and finds them after a reload", async ({
  page,
}) => {
  await withBookingRules(demo.bsrOwner, "bsr", async () => {
    await signIn(page, demo.bsrOwner);
    await page.goto("/bsr/settings");
    await page
      .getByRole("navigation", { name: "Settings sections" })
      .getByRole("link", { name: "Booking rules" })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Booking rules" }),
    ).toBeVisible();

    const hold = page.getByLabel("Hold length (minutes)");
    const notice = page.getByLabel("Minimum notice (hours)").first();
    const vehicle = page.getByRole("group").filter({
      has: page.getByLabel("Booked ahead (days)"),
    });
    const firstAhead = vehicle.first().getByLabel("Booked ahead (days)");
    const overbooking = page.getByLabel("Allow overbooking");

    await hold.fill("20");
    await notice.fill("24");
    await firstAhead.fill("2");
    const wasOn = await overbooking.isChecked();
    await overbooking.setChecked(!wasOn);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");

    await page.reload();
    await expect(hold).toHaveValue("20");
    await expect(notice).toHaveValue("24");
    await expect(firstAhead).toHaveValue("2");
    await expect(overbooking).toBeChecked({ checked: !wasOn });

    // Out of range: refused on its box, focus on it, nothing saved.
    await hold.fill("90");
    await notice.fill("1,000");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator("#hold_minutes-error")).toHaveText(
      "Enter a hold length from 5 to 60 minutes.",
    );
    await expect(hold).toHaveAttribute("aria-invalid", "true");
    await expect(hold).toHaveAttribute(
      "aria-describedby",
      /(^| )hold_minutes-error( |$)/,
    );
    await expect(hold).toBeFocused();
    await expect(
      page.getByText("Enter whole hours from 0 to 720, or leave it blank."),
    ).toBeVisible();
    await page.reload();
    await expect(hold).toHaveValue("20");

    // Blank is no rule of its own.
    await notice.fill("");
    await firstAhead.fill("");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");
    await page.reload();
    await expect(notice).toHaveValue("");
    await expect(firstAhead).toHaveValue("");
  });
});

for (const who of ["bsrStaff", "bsrMechanic", "bsrDriver"] as const) {
  test(`${who} is answered "Page not found" at Booking rules`, async ({
    page,
  }) => {
    await signIn(page, demo[who]);
    await page.goto("/bsr/settings/booking-rules");
    await expect(page.getByText("Page not found")).toBeVisible();
    await expect(page.getByLabel("Hold length (minutes)")).toHaveCount(0);
  });
}
