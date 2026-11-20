import { getTranslations } from "next-intl/server";
import { Panel } from "@/components/action-form";
import { formatInstant } from "@/lib/shop-time";
import { statusOf, type UnitBooking } from "@/lib/unit-bookings";
import { cn } from "@/lib/utils";

/**
 * Bookings on a unit's page (Phase 2 stage 11; docs/phase-2-plan.md §7):
 * the reservations holding this vehicle, read-only, for every member of the
 * shop. Held, booked, out (or overdue) and returned; times on the
 * location's clock. Making, changing and cancelling bookings come with
 * orders in Phase 3.
 */
export async function UnitBookingsPanel({
  current,
  past,
  zone,
  locale,
  now,
}: {
  current: UnitBooking[];
  past: UnitBooking[];
  zone: string;
  locale: string;
  now: Date;
}) {
  const t = await getTranslations("Fleet.bookings");
  const range = (b: UnitBooking) =>
    t("range", {
      from: formatInstant(b.start, zone, locale),
      to: formatInstant(b.end, zone, locale),
    });
  const label = (b: UnitBooking) => {
    const status = statusOf(b, now);
    switch (status.kind) {
      case "held":
        return status.until
          ? t("held", { until: formatInstant(status.until, zone, locale) })
          : t("heldNoEnd");
      case "booked":
        return t("booked");
      case "out":
        return t("out");
      case "overdue":
        return t("overdue");
      case "returned":
        return t("returned");
    }
  };
  return (
    <Panel
      title={t("title")}
      intro={t("intro", { zone: zone.replaceAll("_", " ") })}
    >
      {current.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {current.map((b) => (
            <li key={b.reservationId} className="p-3" data-state={b.state}>
              <p
                className={cn(
                  "font-medium",
                  statusOf(b, now).kind === "overdue" && "text-destructive",
                )}
              >
                {label(b)}
              </p>
              <p className="text-sm text-muted-foreground">{range(b)}</p>
            </li>
          ))}
        </ul>
      )}
      {past.length > 0 && (
        <details className="mt-5 text-sm">
          <summary className="min-h-11 cursor-pointer py-2 font-medium">
            {t("past")}
          </summary>
          <ul className="space-y-1 text-muted-foreground">
            {past.map((b) => (
              <li key={b.reservationId}>
                {label(b)} · {range(b)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Panel>
  );
}
