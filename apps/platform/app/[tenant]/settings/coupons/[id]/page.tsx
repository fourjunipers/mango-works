import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page";
import { requireArea } from "@/lib/access";
import { couponDraft, couponStatus } from "@/lib/coupon-form";
import { getCoupon, getCouponProducts } from "@/lib/coupons-data";
import { canPricing } from "@/lib/pricing-permissions";
import { CouponForm } from "../coupon-form";
import { CouponHistory } from "../coupon-history";
import { CouponStateButton } from "../state-button";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.coupons");
  return { title: t("editTitle") };
}

/**
 * One coupon: change it, switch it off or on, archive it. An archived
 * coupon is shown read-only with "Bring back" (refused while a live coupon
 * has its code).
 */
export default async function CouponPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/settings/coupons/[id]">) {
  const [{ tenant: slug, id }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const { membership } = await requireArea(slug, "settings");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const { tenant, role } = membership;
  const [t, coupon, products] = await Promise.all([
    getTranslations("Settings.coupons"),
    getCoupon(tenant.id, id),
    getCouponProducts(tenant.id),
  ]);
  if (!coupon) notFound();
  const status = couponStatus(coupon);
  const edit = canPricing(role, "write");
  return (
    <>
      <BackLink href={`/${slug}/settings/coupons`} label={t("title")} />
      <PageHeader
        title={coupon.code}
        intro={
          status === "archived"
            ? t("archivedIntro")
            : status === "off"
              ? t("offIntro")
              : t("editIntro")
        }
      />
      {query.added === "1" && (
        <p
          role="status"
          className="mb-4 max-w-3xl rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-950"
        >
          {t("added")}
        </p>
      )}
      <div className="max-w-3xl space-y-6">
        {edit && (
          <div className="flex flex-wrap gap-2">
            {status === "archived" ? (
              <CouponStateButton
                slug={slug}
                id={coupon.id}
                code={coupon.code}
                change="restore"
              />
            ) : (
              <>
                <CouponStateButton
                  slug={slug}
                  id={coupon.id}
                  code={coupon.code}
                  change={status === "on" ? "off" : "on"}
                />
                <CouponStateButton
                  slug={slug}
                  id={coupon.id}
                  code={coupon.code}
                  change="archive"
                />
              </>
            )}
          </div>
        )}
        <CouponForm
          key={`${coupon.id}:${status}`}
          slug={slug}
          id={coupon.id}
          currency={coupon.currency}
          initial={couponDraft(coupon)}
          products={products}
          canEdit={edit && status !== "archived"}
        />
        <CouponHistory
          tenantId={tenant.id}
          timezone={tenant.timezone}
          currency={tenant.currency}
          couponId={coupon.id}
        />
      </div>
    </>
  );
}
