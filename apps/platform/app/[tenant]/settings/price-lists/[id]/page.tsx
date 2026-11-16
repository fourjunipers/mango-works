import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page";
import { requireArea } from "@/lib/access";
import {
  getPricingInputs,
  getSharedList,
  getSharedLists,
} from "@/lib/pricing-data";
import { draftFromSaved, suggestedStep } from "@/lib/pricing-form";
import { canPricing } from "@/lib/pricing-permissions";
import { PriceListForm } from "../price-list-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Pricing.lists");
  return { title: t("editTitle") };
}

/**
 * One shared price list: its days, the products on it, and Delete (refused
 * while a product is priced from it). Owners and managers.
 */
export default async function PriceListPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/settings/price-lists/[id]">) {
  const [{ tenant: slug, id }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const { membership } = await requireArea(slug, "settings");
  const { tenant, role } = membership;
  if (!canPricing(role, "read")) notFound();
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const [t, list, lists, inputs] = await Promise.all([
    getTranslations("Pricing.lists"),
    getSharedList(tenant.id, id),
    getSharedLists(tenant.id),
    getPricingInputs(tenant.id, []),
  ]);
  if (!list) notFound();
  const products = lists.find((l) => l.id === id)?.products ?? [];

  return (
    <>
      <BackLink href={`/${slug}/settings/price-lists`} label={t("title")} />
      <PageHeader title={list.name} intro={t("editIntro")} />
      {query.added === "1" && (
        <p
          role="status"
          className="mb-4 max-w-3xl rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-950"
        >
          {t("added")}
        </p>
      )}
      <PriceListForm
        slug={slug}
        currency={tenant.currency}
        step={
          inputs.settings?.rounding_step ??
          String(suggestedStep(tenant.currency))
        }
        canEdit={canPricing(role, "write")}
        list={{
          id: list.id,
          name: list.name,
          kind: list.kind,
          draft: draftFromSaved(
            list.days,
            list.hourly,
            list.kind,
            tenant.currency,
          ),
          products,
        }}
      />
    </>
  );
}
