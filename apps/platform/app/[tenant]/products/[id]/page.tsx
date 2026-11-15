import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { Copy, Plus } from "lucide-react";
import { ActionForm, Panel } from "@/components/action-form";
import { BackLink } from "@/components/back-link";
import { UnitRow } from "@/components/fleet/unit-bits";
import { PageHeader } from "@/components/page";
import { buttonVariants } from "@/components/ui/button";
import { requireArea } from "@/lib/access";
import {
  getCatalog,
  getCatalogEntry,
  getFleet,
  getLocations,
  getModel,
  getProduct,
} from "@/lib/fleet-data";
import { isGeneralType } from "@/lib/general-products";
import { minutesToHours } from "@/lib/fleet";
import { moneyInputValue } from "@/lib/money";
import { backTarget, keptBack, withBack } from "@/lib/product-list";
import { canManageFleet } from "@/lib/roles";
import { humanizeKey } from "@/lib/vehicle-kinds";
import { formatInstant } from "@/lib/shop-time";
import { cn } from "@/lib/utils";
import { setModelRetired } from "../../fleet/actions";
import { DeleteProductButton } from "../delete-product";
import { GeneralProductPage } from "../general-product";
import { HistoryTab } from "../history-tab";
import { MotoMangosTab } from "../moto-mangos-tab";
import { OldAnchor } from "../old-anchor";
import { ProductForm } from "../product-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Fleet.model");
  return { title: t("editTitle") };
}

const text = (value: number | null) => (value === null ? "" : String(value));

const tabs = ["details", "units", "moto-mangos", "history"] as const;
type Tab = (typeof tabs)[number];

const tabLabel = {
  details: "tabs.details",
  units: "tabs.units",
  "moto-mangos": "tabs.motoMangos",
  history: "tabs.history",
} as const;

/**
 * One product (docs/products-redesign.md §4.1), in tabs:
 * - Details: what it is and its settings, retire and delete (owners and
 *   managers);
 * - Units: its vehicles (everyone);
 * - Moto Mangos: its list entry and listing (motorbikes only; owners and
 *   managers), §5.11;
 * - History: who changed what (owners and managers).
 * The tab is in the address (?tab=units), so a tab can be linked to.
 */
export default async function ProductPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/products/[id]">) {
  const [{ tenant: slug, id }, query] = await Promise.all([
    params,
    searchParams,
  ]);
  const { membership } = await requireArea(slug, "products");
  // An address that isn't an id is simply not found (the database would
  // refuse to compare it with one).
  if (!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)) notFound();
  const { tenant, role } = membership;
  const manage = canManageFleet(role);
  const asked = typeof query.tab === "string" ? query.tab : "";
  // Back to the list it was opened from (Fleet or Products, as it was);
  // opened any other way, to the Products list. Tabs and "Duplicate" keep it.
  const back = keptBack(slug, query.back);
  const target = backTarget(slug, back);
  const tLists = await getTranslations(
    target.to === "fleet" ? "Fleet" : "Products",
  );
  const backLink = { href: target.href, label: tLists("title") };
  // Rental gear, an item for sale or a service: its own page (Details,
  // Stock, History). A vehicle carries on below, as before.
  const product = await getProduct(tenant.id, id);
  if (product && isGeneralType(product.type))
    return (
      <GeneralProductPage
        slug={slug}
        tenant={tenant}
        role={role}
        product={product}
        asked={asked}
        added={query.added === "1"}
        back={back}
        backLink={backLink}
      />
    );
  const [t, tFleet, tProducts, locale, model, fleet, catalog, locations] =
    await Promise.all([
      getTranslations("Fleet.model"),
      getTranslations("Fleet"),
      getTranslations("Products"),
      getLocale(),
      getModel(tenant.id, id),
      getFleet(tenant.id),
      getCatalog(),
      getLocations(tenant.id),
    ]);
  if (!model) notFound();
  // Details, Moto Mangos and History are for those who set the shop up.
  // Moto Mangos lists motorbikes only (any of their categories).
  const motorbike = model.vehicle_type === "motorbike";
  const allowed: readonly Tab[] = manage
    ? tabs.filter((name) => name !== "moto-mangos" || motorbike)
    : ["units"];
  const tab: Tab = (allowed as readonly string[]).includes(asked)
    ? (asked as Tab)
    : allowed[0];
  const locationNames = new Map(locations.map((l) => [l.id, l.name]));
  const units = fleet.find((m) => m.id === id)?.units ?? [];
  const here = `/${slug}/products/${model.id}`;

  return (
    <>
      <BackLink href={backLink.href} label={backLink.label} />
      <PageHeader
        title={model.name}
        intro={[
          tProducts(`type.${model.type}` as "type.vehicle"),
          model.vehicle_type === "motorbike"
            ? null
            : tFleet(`kind.${model.vehicle_type}` as "kind.car"),
          ...model.categories.map((key) =>
            tFleet.has(`category.${key}` as "category.sedan")
              ? tFleet(`category.${key}` as "category.sedan")
              : humanizeKey(key),
          ),
        ]
          .filter(Boolean)
          .join(" · ")}
        actions={
          manage && (
            <Link
              href={withBack(`/${slug}/products/new?from=${model.id}`, back)}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-11 px-4",
              )}
            >
              <Copy aria-hidden />
              {tProducts("duplicate")}
            </Link>
          )
        }
      />
      {query.added === "1" && (
        <p
          role="status"
          className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-950"
        >
          {tProducts("added")}
        </p>
      )}
      {allowed.length > 1 && (
        <nav
          aria-label={tProducts("tabs.label")}
          className="mb-5 flex gap-1 overflow-x-auto border-b"
        >
          {allowed.map((name) => (
            <Link
              key={name}
              href={withBack(
                name === allowed[0] ? here : `${here}?tab=${name}`,
                back,
              )}
              aria-current={name === tab ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-11 shrink-0 items-center border-b-2 px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset sm:px-4",
                name === tab
                  ? "border-primary text-foreground"
                  : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
              )}
            >
              {tProducts(tabLabel[name])}
              {name === "units" && (
                <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums">
                  {units.length}
                </span>
              )}
            </Link>
          ))}
        </nav>
      )}

      {tab === "details" && (
        <>
          {/* The Moto Mangos panel was here until it got its own tab: an
            old link to it (…#moto-mangos) is sent there. */}
          {allowed.includes("moto-mangos") && (
            <OldAnchor
              anchors={["moto-mangos", "choose-from-list", "send-for-review"]}
              href={withBack(`${here}?tab=moto-mangos`, back)}
            />
          )}
          <DetailsTab
            slug={slug}
            model={model}
            units={units}
            catalog={catalog}
            timezone={tenant.timezone}
            currency={tenant.currency}
            locale={locale}
          />
        </>
      )}

      {tab === "units" && (
        <div className="max-w-3xl">
          <section
            aria-labelledby="model-units"
            className="overflow-hidden rounded-lg border bg-card"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-3">
              <h2 id="model-units" className="font-semibold">
                {t("units")}
              </h2>
              {manage && !model.retired_at && (
                <Link
                  href={`/${slug}/fleet/units/new?product=${model.id}`}
                  className={cn(
                    buttonVariants({ variant: "outline" }),
                    "h-11 px-4",
                  )}
                >
                  <Plus aria-hidden />
                  {tFleet("addUnit")}
                </Link>
              )}
            </div>
            {units.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">
                {tFleet("noUnits")}
              </p>
            ) : (
              <ul className="divide-y">
                {units.map((unit) => (
                  <UnitRow
                    key={unit.id}
                    unit={unit}
                    href={`/${slug}/fleet/units/${unit.id}`}
                    distanceUnit={tenant.distanceUnit}
                    locale={locale}
                    detail={
                      [unit.model_year, locationNames.get(unit.location_id)]
                        .filter(Boolean)
                        .join(" · ") || undefined
                    }
                  />
                ))}
              </ul>
            )}
            {units.length > 0 && (
              <p className="border-t px-4 py-3 text-sm">
                <Link
                  href={`/${slug}/fleet?model=${model.id}&scope=all`}
                  className="font-medium underline underline-offset-4"
                >
                  {tProducts("seeInFleet")}
                </Link>
              </p>
            )}
          </section>
        </div>
      )}

      {tab === "moto-mangos" && (
        <MotoMangosTab
          slug={slug}
          tenantId={tenant.id}
          model={model}
          units={units}
          catalog={catalog}
          timezone={tenant.timezone}
          locale={locale}
        />
      )}

      {tab === "history" && (
        <HistoryTab
          tenantId={tenant.id}
          productId={model.id}
          units={units.map((unit) => ({ id: unit.id, name: unit.plate }))}
          unitsAre="vehicles"
          timezone={tenant.timezone}
          locale={locale}
        />
      )}
    </>
  );
}

type Product = NonNullable<Awaited<ReturnType<typeof getModel>>>;
type Catalog = Awaited<ReturnType<typeof getCatalog>>;

/**
 * What the product is and, at the very bottom of the page, deleting it. The
 * Moto Mangos panel has its own tab (MotoMangosTab).
 */
async function DetailsTab({
  slug,
  model,
  units,
  catalog,
  timezone,
  currency,
  locale,
}: {
  slug: string;
  model: Product;
  units: { id: string; status: string }[];
  catalog: Catalog;
  timezone: string;
  currency: string;
  locale: string;
}) {
  const t = await getTranslations("Fleet.model");
  // Waiting on a Moto Mangos review: deleting it withdraws the request.
  const entry = model.catalog_id
    ? (catalog.find((c) => c.id === model.catalog_id) ??
      (await getCatalogEntry(model.catalog_id)))
    : null;
  const waiting = entry?.status === "requested";
  const own = !model.catalog_id;

  return (
    <div className="space-y-6">
      <Panel id="model-details" className="max-w-3xl">
        <ProductForm
          what={{
            vehicle_type: model.vehicle_type,
            categories: model.categories,
          }}
          // On a list entry, or waiting on one: its kind is the entry's.
          locked={!own}
          slug={slug}
          currency={currency}
          values={{
            id: model.id,
            name: model.name,
            description: model.description ?? "",
            bookable_online: model.bookable_online,
            buffer_before_hours: minutesToHours(model.buffer_before_minutes),
            buffer_after_hours: minutesToHours(model.buffer_after_minutes),
            deposit:
              model.deposit === null
                ? ""
                : moneyInputValue(model.deposit, currency),
            min_age: text(model.min_age),
            licence_class: model.licence_class ?? "",
          }}
        />
      </Panel>

      {/* The very bottom of the page. Out of use: retire it (kept, hidden)
          once none of its vehicles is in the fleet; delete it when it has no
          vehicles at all. */}
      {model.retired_at && (
        <Panel title={t("retiredTitle")} className="max-w-3xl">
          <p className="mb-3 text-sm">
            {t("retiredOn", {
              date: formatInstant(new Date(model.retired_at), timezone, locale),
            })}
          </p>
          <ActionForm
            action={setModelRetired}
            hidden={{ slug, id: model.id, retired: "0" }}
            submitLabel={t("restore")}
            className="space-y-1"
          />
        </Panel>
      )}
      <section
        aria-label={t("removeTitle")}
        className="flex flex-wrap gap-3 border-t pt-6"
      >
        <DeleteProductButton
          slug={slug}
          id={model.id}
          hasVehicles={units.length > 0}
          label={t("delete")}
          confirm={t(waiting ? "deleteConfirmWaiting" : "deleteConfirm")}
          blocked={t("deleteBlocked")}
        />
      </section>
    </div>
  );
}
