import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page";
import { requireArea } from "@/lib/access";
import { getBookingRules } from "@/lib/booking-rules-data";
import { BookingRulesForm } from "./booking-rules-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.bookingRules");
  return { title: t("title") };
}

/**
 * Settings › Booking rules (Phase 2 stage 11; docs/phase-2-plan.md §7).
 * Owners and managers, as every Settings page but Extras: staff, mechanics
 * and drivers are answered "Page not found" (requireArea), and the database
 * refuses them anyway (save_booking_rules(), booking_roles('rules')).
 */
export default async function BookingRulesPage({
  params,
}: PageProps<"/[tenant]/settings/booking-rules">) {
  const { tenant: slug } = await params;
  const { membership } = await requireArea(slug, "settings");
  const [t, rules] = await Promise.all([
    getTranslations("Settings.bookingRules"),
    getBookingRules(membership.tenant.id),
  ]);
  return (
    <>
      <PageHeader title={t("title")} intro={t("intro")} />
      <BookingRulesForm slug={slug} rules={rules} />
    </>
  );
}
