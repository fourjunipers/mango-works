import Image from "next/image";
import { getTranslations } from "next-intl/server";
import { Panel } from "@/components/action-form";
import { buttonVariants } from "@/components/ui/button";
import {
  catalogName,
  countUpcomingBookings,
  getCatalog,
  getCatalogEntry,
  getModel,
} from "@/lib/fleet-data";
import { splitMakeModel } from "@/lib/known-models";
import { getPricingInputs } from "@/lib/pricing-data";
import { pricingRowOf } from "@/lib/pricing-inputs";
import { catalogChoices } from "@/lib/model-options";
import { formatInstant } from "@/lib/shop-time";
import { cn } from "@/lib/utils";
import { reviewNews } from "@/lib/vehicle-kinds";
import {
  ChooseFromListForm,
  ListEntryActions,
  ListingSettingsForm,
  ListingSwitch,
  ReviewRequest,
} from "./moto-mangos-forms";

type Product = NonNullable<Awaited<ReturnType<typeof getModel>>>;
type Catalog = Awaited<ReturnType<typeof getCatalog>>;

/**
 * A motorbike's Moto Mangos tab (docs/products-redesign.md §5.11; owners and
 * managers only). Top to bottom, as the panel read on the Details tab before
 * (owner, 13 Nov 2026): the logo; "List it on Moto Mangos"; the Make then
 * Model picker; "Don't see your bike above?", which opens the review form;
 * the waiting, approved and rejected states; Change model and Disconnect;
 * then the listing part, usable only once a model is connected or approved:
 * the switch, which saves by itself, and the counts and lead time under one
 * Save button.
 */
export async function MotoMangosTab({
  slug,
  tenantId,
  model,
  units,
  catalog,
  timezone,
  locale,
}: {
  slug: string;
  tenantId: string;
  model: Product;
  units: { id: string; status: string }[];
  catalog: Catalog;
  timezone: string;
  locale: string;
}) {
  const t = await getTranslations("Fleet");
  // The list entry it is on: one picked from the list, or its own request.
  const entry = model.catalog_id
    ? (catalog.find((c) => c.id === model.catalog_id) ??
      (await getCatalogEntry(model.catalog_id)))
    : null;
  const waiting = entry?.status === "requested";
  const approved = entry?.status === "approved";
  // Bookings that changing the model or disconnecting must leave alone.
  const upcoming = approved
    ? await countUpcomingBookings(
        tenantId,
        units.map((unit) => unit.id),
      )
    : 0;
  const news = reviewNews(model, new Date());
  // Open item 9 (a): a listed product with no price by rental length is
  // never offered on Moto Mangos (from the switch-over, 3M). Said here now.
  const pricing = await getPricingInputs(tenantId, [model.id]);
  const noLengthPrice =
    model.marketplace_listed &&
    // By id: the read also returns the vehicle's extras, in id order.
    pricingRowOf(pricing, model.id)?.pricing_method !== "tiered";
  const own = !model.catalog_id;
  const active = units.filter((unit) => unit.status === "active").length;
  const usable = Boolean(approved) && !model.retired_at;
  // A first guess at the make and model from the name, for the review form.
  const guess = splitMakeModel(model.name, [
    ...new Set(catalog.map((c) => c.make)),
  ]);
  const outline = cn(
    buttonVariants({ variant: "outline" }),
    "h-11 bg-card px-4 text-foreground",
  );

  return (
    <Panel
      id="moto-mangos"
      className="max-w-3xl"
      // The logo first (its alt text is the panel's name). On a white
      // plate, so it reads on the dark theme too.
      title={
        <span className="inline-flex rounded-md bg-white px-2 py-1">
          <Image
            src="/moto-mangos-logo.png"
            alt={t("motoMangos.title")}
            width={710}
            height={290}
            className="h-12 w-auto"
          />
        </span>
      }
    >
      <h3 className="text-lg font-semibold">{t("motoMangos.submitTitle")}</h3>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">
        {t("motoMangos.intro")}
      </p>

      {noLengthPrice && (
        <p
          role="status"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          {t("motoMangos.noPrice")}
        </p>
      )}

      {/* What Moto Mangos decided about its last request, until it is sent
        again or put on a list entry. */}
      {model.catalog_rejected_at && !waiting && (
        <div
          role="status"
          className="mb-4 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950"
        >
          <p className="font-medium">
            {t("motoMangos.rejected", {
              date: formatInstant(
                new Date(model.catalog_rejected_at),
                timezone,
                locale,
              ),
            })}
          </p>
          {model.catalog_reject_reason ? (
            <p className="mt-2">
              {t("motoMangos.rejectReason")}{" "}
              <q>{model.catalog_reject_reason}</q>
            </p>
          ) : (
            <p className="mt-2">{t("motoMangos.rejectNoReason")}</p>
          )}
          {/* What to do next: only a product that came back to the shop can
            be changed and sent again. */}
          {own && (
            <div className="mt-3 border-t border-amber-300 pt-3">
              <p className="font-medium">{t("motoMangos.nextTitle")}</p>
              <p className="mt-1">{t("motoMangos.nextHelp")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <a href="#send-for-review" className={outline}>
                  {t("motoMangos.editAgain")}
                </a>
                <a href="#choose-from-list" className={outline}>
                  {t("motoMangos.chooseInstead")}
                </a>
              </div>
            </div>
          )}
        </div>
      )}
      {news === "added" && model.catalog_approved_at && (
        <p
          role="status"
          className="mb-4 rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm font-medium text-emerald-950"
        >
          {t("motoMangos.approved", {
            date: formatInstant(
              new Date(model.catalog_approved_at),
              timezone,
              locale,
            ),
          })}
        </p>
      )}

      {waiting ? (
        <p className="text-sm">{t("motoMangos.waiting")}</p>
      ) : entry?.status === "rejected" ? (
        <p className="text-sm">{t("motoMangos.rejectedLinked")}</p>
      ) : approved && entry ? (
        <>
          <p className="text-sm">
            {t("motoMangos.ready", { name: catalogName(entry) })}
          </p>
          {/* Already on a list entry: change it, or disconnect. */}
          <ListEntryActions
            slug={slug}
            id={model.id}
            choices={catalogChoices(catalog.filter((c) => c.id !== entry.id))}
            upcoming={upcoming}
          />
        </>
      ) : (
        <div className="space-y-4">
          <div id="choose-from-list" className="scroll-mt-20">
            <ChooseFromListForm
              slug={slug}
              id={model.id}
              choices={catalogChoices(catalog)}
            />
          </div>
          {model.categories.length === 0 ? (
            <p className="text-sm">{t("motoMangos.categoryFirst")}</p>
          ) : (
            <ReviewRequest
              slug={slug}
              id={model.id}
              again={Boolean(model.catalog_rejected_at)}
              // A request being corrected starts open, with what was sent.
              open={Boolean(model.catalog_rejected_at)}
              values={{
                make: model.make || guess.make,
                model: model.make ? model.model : guess.model,
                cc: model.cc === null ? "" : String(model.cc),
                transmission: model.transmission ?? "",
              }}
            />
          )}
        </div>
      )}

      {/* The listing part: below, and only usable once a model is connected
        or approved. */}
      <section
        aria-labelledby="listing-title"
        className="mt-5 space-y-5 border-t pt-5"
      >
        <h3 id="listing-title" className="font-medium">
          {t("motoMangos.listingTitle")}
        </h3>
        {!usable && (
          <p id="listing-locked" className="text-sm font-medium">
            {t("motoMangos.listingLocked")}
          </p>
        )}
        <ListingSwitch
          slug={slug}
          id={model.id}
          on={model.marketplace_listed}
          enabled={usable}
        />
        <ListingSettingsForm
          slug={slug}
          id={model.id}
          enabled={usable}
          active={active}
          values={{
            instant_units: String(model.instant_units),
            request_units: String(model.request_units),
            ready_now: String(model.ready_now),
            lead_time_hours:
              model.lead_time_hours === null
                ? ""
                : String(model.lead_time_hours),
          }}
        />
        <p className="text-xs text-muted-foreground">{t("motoMangos.later")}</p>
      </section>
    </Panel>
  );
}
