import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronDown, Plus, Search } from "lucide-react";
import { SortableRows } from "@/components/fleet/drag-reorder";
import { EditPencil } from "@/components/fleet/edit-pencil";
import { ListReturn } from "@/components/fleet/list-return";
import { RowIcon } from "@/components/fleet/kind-icon";
import {
  cell,
  FilterChips,
  ListToolbar,
  MangoStatus,
  rowGrid,
  RowTags,
} from "@/components/fleet/list-bits";
import { MoveButtons, MoveForms } from "@/components/fleet/order-controls";
import { Field, inputClass } from "@/components/form";
import { PageHeader } from "@/components/page";
import { Button, buttonVariants } from "@/components/ui/button";
import { requireArea } from "@/lib/access";
import { formatMinor } from "@/lib/money";
import { getPricingInputs } from "@/lib/pricing-data";
import { canPricing } from "@/lib/pricing-permissions";
import { priceSummary } from "@/lib/pricing-preview";
import {
  getFleet,
  getGeneralProducts,
  getProductStock,
} from "@/lib/fleet-data";
import {
  hasCustomOrder,
  parseProductsTab,
  productTabs,
  stockOf,
  stockWording,
} from "@/lib/general-products";
import {
  filterChips,
  parseListSort,
  parseReorder,
  sortRows,
  withBack,
  type ListSort,
} from "@/lib/product-list";
import {
  buildProductsView,
  listingFilters,
  parseProductsView,
  productScopes,
  productsFilterCount,
} from "@/lib/products-view";
import { canManageFleet } from "@/lib/roles";
import { humanizeKey } from "@/lib/vehicle-kinds";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Nav");
  return { title: t("products") };
}

/**
 * Products (docs/products-redesign.md §4.1; owner, 14 Nov 2026): everything
 * the shop rents out, sells or charges for, one row each, under three tabs:
 * All, Vehicles and General (rental gear, items for sale, services). Every
 * row is two lines high (components/fleet/list-bits rowGrid): the name and
 * the edit pencil, then the summary ("3 vehicles in the fleet", "18 in stock,
 * 2 lost", a dash for a service) and, on a motorbike, the Moto Mangos mango.
 * Sorted A–Z, by type or in the shop's own order; chips filter by kind,
 * category or general type. Fleet, beside it, lists the vehicles unit by
 * unit. Both lists share the shop's one order. Everyone reads; owners and
 * managers add, change and reorder.
 */
export default async function ProductsPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/products">) {
  const [{ tenant: slug }, query] = await Promise.all([params, searchParams]);
  const { membership } = await requireArea(slug, "products");
  const { tenant, role } = membership;
  const manage = canManageFleet(role);
  const [t, tFleet, tCommon, tLists, locale, fleet, general, stock] =
    await Promise.all([
      getTranslations("Products"),
      getTranslations("Fleet"),
      getTranslations("Common"),
      getTranslations("Lists"),
      getLocale(),
      getFleet(tenant.id),
      getGeneralProducts(tenant.id),
      getProductStock(tenant.id),
    ]);
  const base = `/${slug}/products`;
  const tab = parseProductsTab(query);
  const view = parseProductsView(query);
  const sort = parseListSort(query);
  // The Moto Mangos state is the owner's and manager's business.
  if (!manage) view.listing = "";
  const products = [
    ...fleet,
    ...general.map((product) => ({
      ...product,
      vehicle_type: null,
      categories: [],
      marketplace_listed: false,
      catalog_rejected_at: null,
      entry_status: null,
      units: [],
      stock: stockOf(stock, product.id),
    })),
  ];
  const built = buildProductsView(products, view, tab);
  const { total } = built;
  const rows = sortRows(
    built.rows.map((row) => ({ ...row, kind: row.vehicle_type })),
    sort,
  );
  const filters = productsFilterCount(view);
  // The price beside each product (§9.12): owners, managers and staff. A
  // mechanic or a driver has no prices to see, and the database would send
  // none (RLS). Worked out from pricing_inputs by @mango/core.
  const seePrices = canPricing(role, "read");
  // Price lists live in Settings: owners and managers.
  const editPrices = canPricing(role, "write");
  const prices = seePrices
    ? await getPricingInputs(
        tenant.id,
        products.map((p) => p.id),
      )
    : null;
  const priceRows = new Map(
    (prices?.products ?? []).map((row) => [row.product_id, row]),
  );
  const priceText = (id: string): string => {
    const summary = priceSummary(priceRows.get(id));
    const money = (amount: bigint) =>
      formatMinor(amount, tenant.currency, locale);
    switch (summary.kind) {
      case "day":
        return t("price.perDay", { amount: money(summary.amount) });
      case "period":
        return t(`price.per_${summary.period}`, {
          amount: money(summary.amount),
        });
      case "fixed":
        return money(summary.amount);
      case "free":
        return t("price.free");
      case "none":
        return t("price.none");
    }
  };
  // The order is changed on the whole list of a tab in its own order, never
  // on a search, a filter or another sort.
  const custom = hasCustomOrder(products);
  const shown = rows.map((row) => row.id);
  const reordering =
    manage &&
    parseReorder(query) &&
    sort === "mine" &&
    filters === 0 &&
    rows.length > 1;
  const categoryLabel = (key: string) =>
    tFleet.has(`category.${key}` as "category.sedan")
      ? tFleet(`category.${key}` as "category.sedan")
      : humanizeKey(key);
  /** A kind's label, or a general type's. */
  const kindLabel = (key: string) =>
    t.has(`type.${key}` as "type.gear") && key !== "vehicle"
      ? t(`type.${key}` as "type.gear")
      : tFleet(`kind.${key}` as "kind.car");

  /** This view with some of it changed, as an address. */
  const href = (
    changes: Partial<typeof view> & {
      tab?: string;
      sort?: ListSort;
      reorder?: boolean;
    },
  ) => {
    const next = { ...view, tab, sort, reorder: false, ...changes };
    const search = new URLSearchParams();
    if (next.tab !== "all") search.set("tab", next.tab);
    if (next.q) search.set("q", next.q);
    if (next.scope !== "current") search.set("scope", next.scope);
    for (const key of ["kind", "category", "listing"] as const)
      if (next[key]) search.set(key, next[key]);
    if (next.sort !== "mine") search.set("sort", next.sort);
    if (next.reorder) search.set("reorder", "1");
    const text = search.toString();
    return text ? `${base}?${text}` : base;
  };
  // What a product page's back link returns to: this view.
  const here = href({});
  const tabHref = (name: string) =>
    name === "all" ? base : `${base}?tab=${name}`;

  // Chips: only the kinds, categories and general types this tab has.
  const inTab = products.filter(
    (p) =>
      (tab === "all" ||
        (tab === "vehicles" ? p.type === "vehicle" : p.type !== "vehicle")) &&
      (view.scope === "all" ||
        (view.scope === "retired") === (p.retired_at !== null)),
  );
  const chips = [
    {
      label: tLists("chips.all"),
      href: href({ kind: "", category: "" }),
      current: !view.kind && !view.category,
    },
    ...filterChips(
      inTab.map((p) => ({
        id: p.id,
        name: p.name,
        type: p.type,
        kind: p.vehicle_type,
        categories: p.categories,
      })),
    ).map((chip) =>
      chip.by === "kind"
        ? {
            label: kindLabel(chip.key),
            href: href({ kind: chip.key, category: "" }),
            current: view.kind === chip.key && !view.category,
          }
        : {
            label: categoryLabel(chip.key),
            href: href({ kind: "", category: chip.key }),
            current: view.category === chip.key,
          },
    ),
  ];
  // The filters panel holds the rest: kind and category are the chips.
  const panelFilters =
    filters - Number(view.kind !== "") - Number(view.category !== "");

  return (
    <>
      <PageHeader
        title={t("title")}
        intro={t("intro", { count: total })}
        actions={
          (manage || editPrices) && (
            <div className="flex flex-wrap gap-2">
              {editPrices && (
                <Link
                  href={`/${slug}/settings/price-lists`}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "h-11 px-4",
                  )}
                >
                  {t("priceLists")}
                </Link>
              )}
              {manage && (
                <Link
                  href={`${base}/new`}
                  className={cn(
                    buttonVariants({ variant: "default" }),
                    "h-11 px-4",
                  )}
                >
                  <Plus aria-hidden />
                  {t("new")}
                </Link>
              )}
            </div>
          )
        }
      />

      {total > 0 && (
        <nav
          aria-label={t("tab.label")}
          className="mb-4 flex gap-1 overflow-x-auto border-b"
        >
          {productTabs.map((name) => (
            <Link
              key={name}
              href={tabHref(name)}
              aria-current={name === tab ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-4 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                name === tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {t(`tab.${name}`)}
            </Link>
          ))}
        </nav>
      )}

      {total > 0 && (
        <form
          // A new view redraws the form, so its fields show the view on screen.
          key={JSON.stringify([tab, view, sort])}
          role="search"
          action={base}
          className="mb-3 space-y-3 rounded-lg border bg-card p-3 sm:p-4"
        >
          {tab !== "all" && <input type="hidden" name="tab" value={tab} />}
          {/* A search keeps the chip and the sort. */}
          {view.kind && <input type="hidden" name="kind" value={view.kind} />}
          {view.category && (
            <input type="hidden" name="category" value={view.category} />
          )}
          {sort !== "mine" && <input type="hidden" name="sort" value={sort} />}
          <div className="flex gap-2">
            <label htmlFor="q" className="sr-only">
              {t("searchLabel")}
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={view.q}
              placeholder={t("searchPlaceholder")}
              autoComplete="off"
              className={cn(inputClass, "flex-1")}
            />
            <Button type="submit" className="h-11 px-4">
              <Search aria-hidden />
              <span className="max-sm:sr-only">{tCommon("search")}</span>
            </Button>
          </div>
          <details open={panelFilters > (view.q ? 1 : 0)}>
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 text-sm font-medium">
              <ChevronDown aria-hidden className="size-4" />
              {tFleet("view.filters", { count: panelFilters })}
            </summary>
            <div className="grid gap-3 pt-2 sm:grid-cols-2 lg:grid-cols-4">
              <Field id="scope" label={t("show")}>
                <select
                  id="scope"
                  name="scope"
                  defaultValue={view.scope}
                  className={inputClass}
                >
                  {productScopes.map((scope) => (
                    <option key={scope} value={scope}>
                      {t(`scope.${scope}`)}
                    </option>
                  ))}
                </select>
              </Field>
              {/* Moto Mangos is about vehicles. */}
              {manage && tab !== "general" && (
                <Field id="listing" label={t("motoMangos")}>
                  <select
                    id="listing"
                    name="listing"
                    defaultValue={view.listing}
                    className={inputClass}
                  >
                    <option value="">{tFleet("view.any")}</option>
                    {listingFilters.map((status) => (
                      <option key={status} value={status}>
                        {tFleet(`listing.${status}`)}
                      </option>
                    ))}
                  </select>
                </Field>
              )}
            </div>
            <div className="flex flex-wrap gap-2 pt-3">
              <Button type="submit" variant="outline" className="h-11 px-4">
                {tFleet("view.apply")}
              </Button>
              {filters > 0 && (
                <Link
                  href={tabHref(tab)}
                  className={cn(
                    buttonVariants({ variant: "ghost" }),
                    "h-11 px-4",
                  )}
                >
                  {tFleet("view.reset")}
                </Link>
              )}
            </div>
          </details>
        </form>
      )}

      {total > 0 && <FilterChips chips={chips} />}

      {total === 0 ? (
        <p className="rounded-lg border bg-card p-5 text-muted-foreground">
          {t("empty")}
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border bg-card p-5 text-muted-foreground">
          {t("noMatch")}
        </p>
      ) : (
        <>
          {rows.length !== total && (
            <p role="status" className="mb-2 text-sm text-muted-foreground">
              {t("showing", { shown: rows.length, total })}
            </p>
          )}
          <ListToolbar
            slug={slug}
            sort={sort}
            sortHref={(next) => href({ sort: next })}
            reorderHref={
              manage && total > 1
                ? `${tabHref(tab)}${tab === "all" ? "?" : "&"}reorder=1`
                : null
            }
            doneHref={tabHref(tab)}
            reordering={reordering}
            custom={custom}
          />
          {(() => {
            const listClass = "divide-y rounded-lg border bg-card";
            /** A row's cells, the same in and out of reorder mode. */
            const cellsOf = (row: (typeof rows)[number]) => {
              // Only a web address can be shown as it is; photos are uploaded
              // with the online booking page (Phase 3).
              const photo = row.photos.find((url) => /^https?:\/\//.test(url));
              const wording = row.stock
                ? stockWording(row.type, row.stock)
                : null;
              const retired = row.retired_at !== null;
              const summary =
                row.type === "vehicle" ? (
                  <>
                    {t("stock", { count: row.inFleet })}
                    {row.past > 0 && (
                      <> · {t("stockPast", { count: row.past })}</>
                    )}
                  </>
                ) : wording ? (
                  t(wording.key, {
                    inStock: wording.inStock,
                    lost: wording.lost,
                  })
                ) : (
                  // A service has no stock: a dash, with words for a screen reader.
                  <>
                    <span aria-hidden>—</span>
                    <span className="sr-only">{t("noStock")}</span>
                  </>
                );
              return (
                <>
                  {/* A fixed box, so the row doesn't move when a photo loads. */}
                  <span className={cell.icon}>
                    {photo ? (
                      // eslint-disable-next-line @next/next/no-img-element -- a shop's own photo address, not ours to optimise
                      <img
                        src={photo}
                        alt=""
                        width={32}
                        height={32}
                        loading="lazy"
                        className="size-full object-cover"
                      />
                    ) : (
                      <RowIcon
                        type={row.type}
                        kind={row.vehicle_type}
                        className="size-4"
                      />
                    )}
                  </span>
                  {/* One line; the full name is on the product page. In
                      reorder mode the name doesn't open it. */}
                  {reordering ? (
                    <span className={cell.name} title={row.name}>
                      {row.name}
                    </span>
                  ) : (
                    <Link
                      href={withBack(`${base}/${row.id}`, here)}
                      data-return
                      title={row.name}
                      className={cn(
                        cell.name,
                        "rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      )}
                    >
                      {row.name}
                    </Link>
                  )}
                  {!reordering && (
                    <span className={cell.pencil}>
                      <EditPencil
                        href={withBack(`${base}/${row.id}`, here)}
                        name={row.name}
                      />
                    </span>
                  )}
                  <span className={cell.summary}>
                    <span className="min-w-0 shrink-0 truncate tabular-nums max-sm:shrink">
                      {retired && <>{tFleet("listing.retired")} · </>}
                      <span>{summary}</span>
                      {seePrices && <span> · {priceText(row.id)}</span>}
                    </span>
                    {/* Wide screens: what it is, as far as it fits. */}
                    <RowTags
                      labels={[
                        row.vehicle_type
                          ? tFleet(`kind.${row.vehicle_type}` as "kind.car")
                          : t(`type.${row.type}` as "type.vehicle"),
                        ...row.categories.map(categoryLabel),
                      ]}
                    />
                  </span>
                  <span className={reordering ? cell.reorderMango : cell.mango}>
                    <MangoStatus
                      listing={manage ? row.listing : null}
                      href={
                        reordering
                          ? undefined
                          : withBack(`${base}/${row.id}?tab=moto-mangos`, here)
                      }
                    />
                  </span>
                  {reordering && (
                    <span className={cell.reorderEnd}>
                      <MoveButtons id={row.id} name={row.name} shown={shown} />
                    </span>
                  )}
                </>
              );
            };
            // Reorder mode: each row has a drag handle and the arrows.
            if (reordering)
              return (
                <SortableRows
                  slug={slug}
                  label={t("list")}
                  className={listClass}
                  rows={rows.map((row) => ({
                    id: row.id,
                    name: row.name,
                    content: (
                      <>
                        <MoveForms slug={slug} id={row.id} shown={shown} />
                        <div
                          data-list-row
                          className={rowGrid({ reorder: true })}
                        >
                          {cellsOf(row)}
                        </div>
                      </>
                    ),
                  }))}
                />
              );
            return (
              <ListReturn>
                <ul aria-label={t("list")} className={listClass}>
                  {rows.map((row) => (
                    <li key={row.id} data-list-row className={rowGrid({})}>
                      {cellsOf(row)}
                    </li>
                  ))}
                </ul>
              </ListReturn>
            );
          })()}
        </>
      )}
    </>
  );
}
