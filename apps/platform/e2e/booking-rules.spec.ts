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
import { ownerClient } from "./shop-settings";
import { exactlyOne } from "@mango/db/rows";

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
    const firstWalkin = vehicle.first().getByLabel("Walk-in (days)");
    const overbooking = page.getByLabel("Allow overbooking");
    const before = page.getByLabel("Time free before (hours)");
    const after = page.getByLabel("Time free after (hours)");
    const cutoff = page.getByLabel("Cut-off before closing (minutes)").first();
    const ahead = page.getByLabel("Minimum days, booked ahead").first();
    const walkin = page.getByLabel("Minimum days, walk-in").first();

    await hold.fill("20");
    await before.fill("0.5");
    await after.fill("1.25");
    await notice.fill("24");
    await cutoff.fill("90");
    await ahead.fill("2");
    await walkin.fill("1");
    await firstAhead.fill("2");
    await firstWalkin.fill("3");
    const wasOn = await overbooking.isChecked();
    await overbooking.setChecked(!wasOn);
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.getByRole("status")).toHaveText("Saved");

    await page.reload();
    await expect(hold).toHaveValue("20");
    await expect(before).toHaveValue("0.5");
    await expect(after).toHaveValue("1.25");
    await expect(notice).toHaveValue("24");
    await expect(cutoff).toHaveValue("90");
    await expect(ahead).toHaveValue("2");
    await expect(walkin).toHaveValue("1");
    await expect(firstAhead).toHaveValue("2");
    await expect(firstWalkin).toHaveValue("3");
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

test("the Moto Mangos tab says when the shop's minimum notice is the stricter one", async ({
  page,
}) => {
  await withBookingRules(demo.bsrOwner, "bsr", async () => {
    const { db, tenantId } = await ownerClient(demo.bsrOwner, "bsr");
    const { data: location } = await exactlyOne(
      db
        .from("locations")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("is_default", true)
        .throwOnError(),
    );
    const { data: unit } = await exactlyOne(
      db
        .from("units")
        .select(
          "product_id, products!inner(type, lead:product_listings(lead_time_hours))",
        )
        .eq("tenant_id", tenantId)
        .eq("location_id", location!.id)
        .eq("status", "active")
        .eq("products.type", "vehicle")
        .limit(1)
        .throwOnError(),
    );
    const lead = (
      unit!.products as unknown as {
        lead:
          | { lead_time_hours: number | null }[]
          | { lead_time_hours: number | null }
          | null;
      }
    ).lead;
    const leadHours =
      (Array.isArray(lead)
        ? lead[0]?.lead_time_hours
        : lead?.lead_time_hours) ?? 0;
    const notice = Math.min(720, leadHours + 48);
    await db
      .rpc("save_booking_rules", {
        p_tenant_id: tenantId,
        p_rules: {
          locations: [{ id: location!.id, min_notice_hours: notice }],
        },
      })
      .throwOnError();

    await signIn(page, demo.bsrOwner);
    await page.goto(`/bsr/products/${unit!.product_id}?tab=moto-mangos`);
    await expect(page.locator("[data-shop-notice]")).toHaveText(
      `Bookings need ${notice} hours: your shop's minimum notice.`,
    );

    // No notice: no line.
    await db
      .rpc("save_booking_rules", {
        p_tenant_id: tenantId,
        p_rules: { locations: [{ id: location!.id, min_notice_hours: null }] },
      })
      .throwOnError();
    await page.reload();
    await expect(page.getByLabel("Lead time (hours)")).toBeVisible();
    await expect(page.locator("[data-shop-notice]")).toHaveCount(0);
  });
});
