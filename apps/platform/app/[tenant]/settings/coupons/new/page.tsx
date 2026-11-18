import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page";
import { requireArea } from "@/lib/access";
import { emptyCouponDraft } from "@/lib/coupon-form";
import { getCouponProducts } from "@/lib/coupons-data";
import { canPricing } from "@/lib/pricing-permissions";
import { CouponForm } from "../coupon-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.coupons");
  return { title: t("newTitle") };
}

/** "New coupon". Owners and managers. */
export default async function NewCouponPage({
  params,
}: PageProps<"/[tenant]/settings/coupons/new">) {
  const { tenant: slug } = await params;
  const { membership } = await requireArea(slug, "settings");
  if (!canPricing(membership.role, "write")) notFound();
  const [t, products] = await Promise.all([
    getTranslations("Settings.coupons"),
    getCouponProducts(membership.tenant.id),
  ]);
  return (
    <>
      <BackLink href={`/${slug}/settings/coupons`} label={t("title")} />
      <PageHeader title={t("newTitle")} intro={t("newIntro")} />
      <CouponForm
        slug={slug}
        currency={membership.tenant.currency}
        initial={emptyCouponDraft()}
        products={products}
        canEdit
      />
    </>
  );
}
