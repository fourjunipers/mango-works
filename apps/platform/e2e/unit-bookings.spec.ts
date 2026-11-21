/**
 * Phase 2, stage 11: bookings on a unit's page, at 375 px and 1280 px.
 * The seeded booking (scripts/seed.mts) shows as "Booked" with its dates,
 * read-only, for the owner and for a mechanic; downtime keeps its own list.
 * Held, out and returned are covered by lib/unit-bookings.test.ts: a hold
 * runs out within the hour, and nothing writes out or returned before
 * Phase 3.
 */
import { expect, test } from "@playwright/test";
import { demo, signIn } from "./helpers";
import { ownerClient } from "./shop-settings";

/** A unit that holds a seeded booking, read as the owner. */
async function bookedUnit(): Promise<string> {
  const { db, tenantId } = await ownerClient(demo.bsrOwner, "bsr");
  const { data, error } = await db
    .from("unit_blocks")
    .select("unit_id, reservations!inner(state)")
    .eq("tenant_id", tenantId)
    .eq("kind", "allocation")
    .eq("reservations.state", "reserved")
    .limit(1)
    .single();
  if (error) throw error;
  return data.unit_id as string;
}

for (const who of ["bsrOwner", "bsrMechanic"] as const) {
  test(`${who} sees the unit's bookings, read-only`, async ({ page }) => {
    const unitId = await bookedUnit();
    await signIn(page, demo[who]);
    await page.goto(`/bsr/fleet/units/${unitId}`);
    const panel = page.getByRole("region", { name: "Bookings" });
    await expect(panel).toBeVisible();
    const booked = panel.locator('li[data-state="reserved"]').first();
    await expect(booked).toContainText("Booked");
    await expect(booked).toContainText(" to ");
    // Read-only: no button in the panel.
    await expect(panel.getByRole("button")).toHaveCount(0);
    // The downtime list no longer lists the booking's block.
    await expect(
      page.getByRole("region", { name: "Downtime" }).getByText("Booking", {
        exact: true,
      }),
    ).toHaveCount(0);
  });
}
