import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { requireArea } from "@/lib/access";
import { canPricing } from "@/lib/pricing-permissions";
import { percentLabel, seasonDates } from "@/lib/seasons";
import { getSeasons } from "@/lib/settings-data";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.seasons");
  return { title: t("title") };
}

/**
 * Settings › Seasons (docs/products-redesign.md §9.5, §9.12): each season
 * with its dates, "every year", the percentage and its products. Owners and
 * managers. Staff see the seasons that apply on each product's Pricing tab.
 */
export default async function SeasonsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/settings/seasons">) {
  const [{ tenant: slug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireArea(slug, "settings");
  const { tenant, role } = membership;
  const [t, locale, seasons] = await Promise.all([
    getTranslations("Settings.seasons"),
    getLocale(),
    getSeasons(tenant.id),
  ]);
  const edit = canPricing(role, "write");

  return (
    <>
      <PageHeader
        title={t("title")}
        intro={t("intro")}
        actions={
          edit && (
            <Link
              href={`/${slug}/settings/seasons/new`}
              className={cn(buttonVariants(), "h-11 px-4")}
            >
              <Plus aria-hidden />
              {t("new")}
            </Link>
          )
        }
      />
      {query.deleted === "1" && (
        <p
          role="status"
          className="mb-4 max-w-3xl rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-950"
        >
          {t("deleted")}
        </p>
      )}
      {seasons.length === 0 ? (
        <p className="max-w-3xl rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {t("none")}
        </p>
      ) : (
        <ul className="max-w-3xl divide-y rounded-lg border bg-card">
          {seasons.map((season) => (
            <li key={season.id}>
              <Link
                href={`/${slug}/settings/seasons/${season.id}`}
                className="flex min-h-11 flex-wrap items-center justify-between gap-2 p-4 hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="block font-medium">
                    {season.name}
                    {!season.active && (
                      <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">
                        {t("off")}
                      </span>
                    )}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t(
                      season.repeats_yearly ? "yearly" : "once",
                      seasonDates(
                        season.starts_on,
                        season.ends_on,
                        season.repeats_yearly,
                        locale,
                      ),
                    )}
                    {" · "}
                    {season.all_products
                      ? t("allProducts")
                      : t("someProducts", { count: season.product_ids.length })}
                  </span>
                </span>
                <span className="text-sm font-medium tabular-nums">
                  {t(season.adjust_bp < 0 ? "decreaseBy" : "increaseBy", {
                    percent: percentLabel(season.adjust_bp, locale),
                  })}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
