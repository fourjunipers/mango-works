/**
 * From the database to the booking rules (docs/phase-2-plan.md §3.6).
 *
 * platform.booking_inputs() returns everything bookable() and offer() in
 * @mango/core need as rows, and platform.availability() the stock for each
 * line. This file turns those rows into the rules' input and decides
 * nothing: every rule is in @mango/core. Pure functions: the database call
 * is the caller's.
 */

import type { LineAvailability, OfferInputs } from "@mango/core/booking-rules";

/** platform.booking_inputs() as it arrives. */
export type BookingInputs = {
  shop: {
    currency: string;
    allow_overbooking: boolean;
    hold_minutes: number;
    buffer_before_minutes: number | null;
    buffer_after_minutes: number | null;
  };
  location: {
    id: string;
    timezone: string;
    min_notice_hours: number | null;
    booking_cutoff_minutes: number | null;
    min_days_advance: number | null;
    min_days_walkin: number | null;
    /** Wall-clock times at the location, "09:00:00". 0 = Sunday. */
    hours: { weekday: number; open: string; close: string }[];
    closures: {
      start_date: string;
      end_date: string;
      repeats_yearly: boolean;
    }[];
  };
  products: {
    product_id: string;
    type: "vehicle" | "gear" | "sale_item" | "service";
    /** The buffers in force: the product's own, else for a vehicle the shop's. */
    buffer_before_minutes: number | null;
    buffer_after_minutes: number | null;
    min_days_advance: number | null;
    min_days_walkin: number | null;
    listing: {
      enabled: boolean;
      instant_units: number;
      request_units: number;
      lead_time_hours: number | null;
      ready_now: number;
    } | null;
  }[];
};

/** One answer of platform.availability(), as it arrives. */
export type AvailabilityRow = {
  product_id: string;
  location_id: string;
  type: "vehicle" | "gear" | "sale_item" | "service";
  stock: number | null;
  free: number | null;
  shortage_demand: number;
  available: number | null;
  unlimited: boolean;
  marketplace: {
    enabled: boolean;
    instant_units: number;
    request_units: number;
    mm_held: number;
    mm_instant: number;
    mm_request: number;
  } | null;
};

/** The rules of a location and its products, for offer(). */
export function offerInputsOf(inputs: BookingInputs): OfferInputs {
  return {
    location: {
      timeZone: inputs.location.timezone,
      hours: inputs.location.hours,
      closures: inputs.location.closures,
      minNoticeHours: inputs.location.min_notice_hours,
      bookingCutoffMinutes: inputs.location.booking_cutoff_minutes,
      minDaysAdvance: inputs.location.min_days_advance,
      minDaysWalkin: inputs.location.min_days_walkin,
    },
    products: inputs.products.map((row) => ({
      productId: row.product_id,
      type: row.type,
      minDaysAdvance: row.min_days_advance,
      minDaysWalkin: row.min_days_walkin,
      listing: row.listing
        ? {
            enabled: row.listing.enabled,
            instantUnits: row.listing.instant_units,
            requestUnits: row.listing.request_units,
            leadTimeHours: row.listing.lead_time_hours,
          }
        : null,
    })),
  };
}

/** The availability read's answers, in the order they were asked, for offer(). */
export function lineAvailabilityOf(
  rows: readonly AvailabilityRow[],
): LineAvailability[] {
  return rows.map((row) => ({
    productId: row.product_id,
    // A service has nothing to count.
    available: row.unlimited ? null : (row.available ?? 0),
    marketplace: row.marketplace
      ? {
          enabled: row.marketplace.enabled,
          instantUnits: row.marketplace.instant_units,
          requestUnits: row.marketplace.request_units,
          held: row.marketplace.mm_held,
          instant: row.marketplace.mm_instant,
          request: row.marketplace.mm_request,
        }
      : null,
  }));
}
