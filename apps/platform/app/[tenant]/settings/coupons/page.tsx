import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { requireArea } from "@/lib/access";
import {
  couponStatus,
  couponUsesText,
  type CouponRecord,
} from "@/lib/coupon-form";
import { getCouponUses, getCoupons } from "@/lib/coupons-data";
import { formatMinor } from "@/lib/money";
import { getPricingInputs } from "@/lib/pricing-data";
import { canPricing } from "@/lib/pricing-permissions";
import { percentLabel } from "@/lib/seasons";
import { cn } from "@/lib/utils";
import { CouponHistory } from "./coupon-history";
import { CouponStateButton } from "./state-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.coupons");
  return { title: t("title") };
}

/**
 * Settings › Coupons (Phase 2 stage 9; docs/phase-2-plan.md §7). Owners and
 * managers: each coupon with its code, name, value, state and uses ("12 of
 * 50"), New coupon, and on each row Edit, Switch off or on, and Archive.
 * Staff never reach this page (requireArea); they see a coupon only when
 * they check a price with its code. The database enforces who may change
 * one (save_coupon()).
 */
export default async function CouponsPage({
  params,
}: PageProps<"/[tenant]/settings/coupons">) {
  const { tenant: slug } = await params;
  const { membership } = await requireArea(slug, "settings");
  const { tenant, role } = membership;
  const [t, locale, coupons, inputs] = await Promise.all([
    getTranslations("Settings.coupons"),
    getLocale(),
    getCoupons(tenant.id),
    getPricingInputs(tenant.id, []),
  ]);
  const uses = await getCouponUses(
    tenant.id,
    coupons.map((c) => c.id),
  );
  const edit = canPricing(role, "write");
  const accepting = inputs.settings?.coupons_enabled ?? false;

  const value = (c: CouponRecord) =>
    c.kind === "percent"
      ? t("percentOff", { percent: percentLabel(c.percent_bp ?? 0, locale) })
      : t("amountOff", {
          amount: formatMinor(c.amount ?? "0", c.currency, locale),
        });
  const usesText = (c: CouponRecord) => {
    const u = couponUsesText(uses.get(c.id) ?? 0, c.max_uses);
    return u.kind === "ofLimit"
      ? t("usesOf", { used: u.used, limit: u.limit })
      : t("usesNoLimit", { used: u.used });
  };

  return (
    <>
      <PageHeader
        title={t("title")}
        intro={t("intro")}
        actions={
          edit && (
            <Link
              href={`/${slug}/settings/coupons/new`}
              className={cn(buttonVariants(), "h-11 px-4")}
            >
              <Plus aria-hidden />
              {t("new")}
            </Link>
          )
        }
      />
      {!accepting && (
        <p
          role="note"
          className="mb-6 max-w-3xl rounded-md border border-highlight-border bg-highlight p-3 text-sm text-highlight-foreground"
        >
          {t.rich("notAccepting", {
            link: (chunks) => (
              <Link
                href={`/${slug}/settings/pricing`}
                className="font-medium underline"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>
      )}
      {coupons.length === 0 ? (
        <p className="max-w-3xl rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {t("none")}
        </p>
      ) : (
        <ul
          aria-label={t("listLabel")}
          className="max-w-3xl divide-y rounded-lg border bg-card"
        >
          {coupons.map((c) => {
            const status = couponStatus(c);
            return (
              <li
                key={c.id}
                data-coupon={c.code}
                data-status={status}
                className="space-y-3 p-4"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-mono font-semibold break-all">
                      {c.code}
                      <span
                        className={cn(
                          "ml-2 rounded px-1.5 py-0.5 font-sans text-xs font-normal",
                          status === "on"
                            ? "bg-emerald-100 text-emerald-950 dark:bg-emerald-900 dark:text-emerald-50"
                            : "bg-muted",
                        )}
                      >
                        {t(`status_${status}`)}
                      </span>
                    </p>
                    {c.name && (
                      <p className="text-sm break-words text-muted-foreground">
                        {c.name}
                      </p>
                    )}
                  </div>
                  <div className="text-right text-sm">
                    <p className="font-medium tabular-nums">{value(c)}</p>
                    <p className="text-muted-foreground tabular-nums">
                      {usesText(c)}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/${slug}/settings/coupons/${c.id}`}
                    className={cn(
                      buttonVariants({ variant: "outline" }),
                      "h-11 px-4",
                    )}
                  >
                    {edit && status !== "archived" ? t("edit") : t("view")}
                  </Link>
                  {edit && status !== "archived" && (
                    <>
                      <CouponStateButton
                        slug={slug}
                        id={c.id}
                        code={c.code}
                        change={status === "on" ? "off" : "on"}
                      />
                      <CouponStateButton
                        slug={slug}
                        id={c.id}
                        code={c.code}
                        change="archive"
                      />
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-6">
        <CouponHistory
          tenantId={tenant.id}
          timezone={tenant.timezone}
          currency={tenant.currency}
          codes={new Map(coupons.map((c) => [c.id, c.code]))}
        />
      </div>
    </>
  );
}
