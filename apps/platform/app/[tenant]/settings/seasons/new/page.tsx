import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page";
import { requireArea } from "@/lib/access";
import { canPricing } from "@/lib/pricing-permissions";
import { emptySeasonDraft } from "@/lib/seasons";
import { getSeasonProducts } from "@/lib/settings-data";
import { SeasonForm } from "../season-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.seasons");
  return { title: t("newTitle") };
}

/** "New season". */
export default async function NewSeasonPage({
  params,
}: PageProps<"/[tenant]/settings/seasons/new">) {
  const { tenant: slug } = await params;
  const { membership } = await requireArea(slug, "settings");
  if (!canPricing(membership.role, "write")) notFound();
  const [t, products] = await Promise.all([
    getTranslations("Settings.seasons"),
    getSeasonProducts(membership.tenant.id),
  ]);
  return (
    <>
      <BackLink href={`/${slug}/settings/seasons`} label={t("title")} />
      <PageHeader title={t("newTitle")} intro={t("newIntro")} />
      <SeasonForm
        slug={slug}
        initial={emptySeasonDraft()}
        products={products}
        canEdit
      />
    </>
  );
}
