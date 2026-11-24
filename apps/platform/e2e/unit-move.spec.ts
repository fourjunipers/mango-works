import { expect, test, type Page } from "@playwright/test";
import { demo, signIn } from "./helpers";
import { ownerClient } from "./shop-settings";
import { exactlyOne } from "@mango/db/rows";

/**
 * Moving a vehicle that has upcoming bookings to another product (the
 * owner, 16 Nov 2026): the Details form warns first, with how many bookings
 * and where they are going, and the bookings move with the vehicle
 * (platform.move_unit). The test makes its own two products, vehicle and
 * bookings as BSR's owner through the API, and removes what it can.
 */

const stamp = () =>
  `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;
const panel = (page: Page, name: string) =>
  page.getByRole("region", { name, exact: true });
/** A day far ahead, so no other test's bookings are near. */
const day = (n: number) =>
  new Date(Date.UTC(2033, 5, 1) + n * 86_400_000).toISOString();

test("a booked vehicle moved to another product: the form says how many bookings move and where to; declined, nothing moves; accepted, they go with it", async ({
  page,
}) => {
  const id = stamp();
  const from = `Move From ${id}`;
  const to = `Move To ${id}`;
  const { db, tenantId } = await ownerClient(demo.bsrOwner, "bsr");
  const { data: place } = await exactlyOne(
    db
      .from("locations")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("is_default", true),
  );
  const products = await db
    .from("products")
    .insert(
      [from, to].map((name) => ({
        tenant_id: tenantId,
        name,
        vehicle_type: "motorbike",
      })),
    )
    .select("id, name");
  expect(products.error).toBeNull();
  const fromId = products.data!.find((p) => p.name === from)!.id as string;
  const toId = products.data!.find((p) => p.name === to)!.id as string;
  const unit = await exactlyOne(
    db
      .from("units")
      .insert({
        tenant_id: tenantId,
        product_id: fromId,
        location_id: place!.id,
        plate: `MV-${id}`.toUpperCase(),
      })
      .select("id"),
  );
  expect(unit.error).toBeNull();
  const unitId = unit.data!.id as string;

  const book = async (n: number) => {
    const { data, error } = await db.rpc("reserve", {
      p_tenant_id: tenantId,
      p_request: {
        channel: "walk_in",
        mode: "staff",
        lines: [
          {
            product_id: fromId,
            location_id: place!.id,
            starts_at: day(n),
            ends_at: day(n + 1),
            quantity: 1,
          },
        ],
      },
    });
    expect(error).toBeNull();
    expect(data).toMatchObject({ ok: true });
    return (data as { booking_id: string }).booking_id;
  };
  const bookedOn = async () => {
    const { data } = await db
      .from("reservations")
      .select("product_id")
      .in("product_id", [fromId, toId])
      .eq("state", "reserved");
    return (data ?? []).map((r) => (r.product_id === toId ? "to" : "from"));
  };
  const bookings: string[] = [];

  try {
    bookings.push(await book(0));
    await signIn(page, demo.bsrOwner);
    await page.goto(`/bsr/fleet/units/${unitId}`);
    const details = panel(page, "Details");
    const choose = async () => {
      const option = details
        .getByLabel("Product")
        .locator("option", { hasText: to });
      await details
        .getByLabel("Product")
        .selectOption((await option.getAttribute("value"))!);
    };

    // One booking: the question is in the singular. Declined: nothing moves.
    await choose();
    let asked = "";
    page.once("dialog", (dialog) => {
      asked = dialog.message();
      void dialog.dismiss();
    });
    await details.getByRole("button", { name: "Save" }).click();
    await expect
      .poll(() => asked)
      .toBe(
        `This vehicle has an upcoming booking. It will move with it to ${to}.`,
      );
    expect(await bookedOn()).toEqual(["from"]);

    // A second booking: the question counts them. Accepted: both move.
    bookings.push(await book(3));
    await page.reload();
    await choose();
    // Another field in the same save: one call writes both, or neither.
    await details.getByLabel("Colour").fill("Blue");
    page.once("dialog", (dialog) => {
      asked = dialog.message();
      void dialog.accept();
    });
    await details.getByRole("button", { name: "Save" }).click();
    await expect
      .poll(() => asked)
      .toBe(
        `This vehicle has 2 upcoming bookings. They will move with it to ${to}.`,
      );
    await expect(details.getByText("Saved", { exact: true })).toBeVisible();
    await expect.poll(bookedOn).toEqual(["to", "to"]);
    const { data: moved } = await exactlyOne(
      db.from("units").select("product_id, colour").eq("id", unitId),
    );
    expect(moved).toEqual({ product_id: toId, colour: "Blue" });
    await page.reload();
    await expect(page.getByRole("link", { name: to })).toBeVisible();

    // A change that moves nothing asks nothing.
    await details.getByLabel("Colour").fill("Green");
    let askedAgain = false;
    page.once("dialog", (dialog) => {
      askedAgain = true;
      void dialog.accept();
    });
    await details.getByRole("button", { name: "Save" }).click();
    await expect(details.getByText("Saved", { exact: true })).toBeVisible();
    expect(askedAgain).toBe(false);
  } finally {
    for (const booking of bookings) {
      await db.rpc("cancel_reservation", {
        p_tenant_id: tenantId,
        p_booking_id: booking,
      });
    }
    await db.from("units").delete().eq("id", unitId);
    // A product that was ever booked can't be deleted: retired instead.
    await db
      .from("products")
      .update({ retired_at: new Date().toISOString() })
      .in("id", [fromId, toId]);
  }
});
