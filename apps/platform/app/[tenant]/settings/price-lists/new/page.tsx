import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page";
import { requireArea } from "@/lib/access";
import { getCurrencyLocked, getPricingInputs } from "@/lib/pricing-data";
import { emptyBoxes, suggestedStep } from "@/lib/pricing-form";
import { canPricing } from "@/lib/pricing-permissions";
import { PriceListForm } from "../price-list-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Pricing.lists");
  return { title: t("newTitle") };
}

/** "New price list": a name, Amounts or Multipliers, and its days. */
export default async function NewPriceListPage({
  params,
}: PageProps<"/[tenant]/settings/price-lists/new">) {
  const { tenant: slug } = await params;
  const { membership } = await requireArea(slug, "settings");
  const { tenant, role } = membership;
  if (!canPricing(role, "write")) notFound();
  const [t, inputs, locked] = await Promise.all([
    getTranslations("Pricing.lists"),
    getPricingInputs(tenant.id, []),
    getCurrencyLocked(tenant.id),
  ]);
  return (
    <>
      <BackLink href={`/${slug}/settings/price-lists`} label={t("title")} />
      <PageHeader title={t("newTitle")} intro={t("newIntro")} />
      <PriceListForm
        slug={slug}
        currency={tenant.currency}
        step={
          inputs.settings?.rounding_step ??
          String(suggestedStep(tenant.currency))
        }
        canEdit
        fixesCurrency={!locked}
        list={{
          name: "",
          kind: null,
          draft: { boxes: emptyBoxes(), manual: {} },
          products: [],
        }}
      />
    </>
  );
}
