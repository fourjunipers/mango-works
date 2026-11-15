import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { requireArea } from "@/lib/access";
import { formatMinor, multiplierText } from "@/lib/money";
import { getSharedLists } from "@/lib/pricing-data";
import { canPricing } from "@/lib/pricing-permissions";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Pricing.lists");
  return { title: t("title") };
}

/**
 * Settings › Price lists (docs/products-redesign.md §9.12): the shop's
 * shared price lists, with the number of products on each. Owners and
 * managers only, like the rest of Settings (moved here from Products in
 * stage D6; the old address redirects). Staff see each product's prices on
 * its Pricing tab.
 */
export default async function PriceListsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/settings/price-lists">) {
  const [{ tenant: slug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireArea(slug, "settings");
  const { tenant, role } = membership;
  if (!canPricing(role, "read")) notFound();
  const [t, locale, lists] = await Promise.all([
    getTranslations("Pricing.lists"),
    getLocale(),
    getSharedLists(tenant.id),
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
              href={`/${slug}/settings/price-lists/new`}
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
      {lists.length === 0 ? (
        <p className="max-w-3xl rounded-lg border bg-card p-4 text-sm text-muted-foreground">
          {t("none")}
        </p>
      ) : (
        <ul className="max-w-3xl divide-y rounded-lg border bg-card">
          {lists.map((list) => (
            <li key={list.id}>
              <Link
                href={`/${slug}/settings/price-lists/${list.id}`}
                className="flex min-h-11 flex-wrap items-center justify-between gap-2 p-4 hover:bg-muted/40"
              >
                <span>
                  <span className="block font-medium">{list.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {t(
                      list.kind === "amounts"
                        ? "kindAmounts"
                        : "kindMultipliers",
                    )}
                    {" · "}
                    {t("products", { count: list.products.length })}
                  </span>
                </span>
                {list.days[0] && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    {t("firstDay", {
                      amount:
                        list.kind === "amounts"
                          ? formatMinor(list.days[0], tenant.currency, locale)
                          : `×${multiplierText(list.days[0])}`,
                    })}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
