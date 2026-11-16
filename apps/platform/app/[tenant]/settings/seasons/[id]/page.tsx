import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { BackLink } from "@/components/back-link";
import { PageHeader } from "@/components/page";
import { requireArea } from "@/lib/access";
import { canPricing } from "@/lib/pricing-permissions";
import { seasonDraft } from "@/lib/seasons";
import { getSeason, getSeasonProducts } from "@/lib/settings-data";
import { SeasonForm } from "../season-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.seasons");
  return { title: t("editTitle") };
}

/** One season: change it, switch it off, or delete it. */
export default async function SeasonPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/settings/seasons/[id]">) {
  const [{ tenant: slug, id }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const { membership } = await requireArea(slug, "settings");
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const [t, season, products] = await Promise.all([
    getTranslations("Settings.seasons"),
    getSeason(membership.tenant.id, id),
    getSeasonProducts(membership.tenant.id),
  ]);
  if (!season) notFound();
  return (
    <>
      <BackLink href={`/${slug}/settings/seasons`} label={t("title")} />
      <PageHeader title={season.name} intro={t("editIntro")} />
      {query.added === "1" && (
        <p
          role="status"
          className="mb-4 max-w-3xl rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-950"
        >
          {t("added")}
        </p>
      )}
      <SeasonForm
        slug={slug}
        id={season.id}
        initial={seasonDraft(season)}
        products={products}
        canEdit={canPricing(membership.role, "write")}
      />
    </>
  );
}
