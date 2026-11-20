import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page";
import { inputClass } from "@/components/form";
import { buttonVariants } from "@/components/ui/button";
import { requireTab } from "@/lib/access";
import {
  answersFor,
  matchOptions,
  priceCheckChannels,
  readPriceCheck,
  spanOf,
  type PriceCheckAsked,
  type PriceCheckOption,
  type ProductAnswer,
} from "@/lib/new-order";
import {
  getPriceCheckLocations,
  getPriceCheckProducts,
  getPriceCheckReads,
  type PriceCheckProduct,
} from "@/lib/new-order-data";
import { getPricingInputs } from "@/lib/pricing-data";
import { pricingRowOf } from "@/lib/pricing-inputs";
import { canPricing } from "@/lib/pricing-permissions";
import { formatInstant } from "@/lib/shop-time";
import { cn } from "@/lib/utils";
import { humanizeKey } from "@/lib/vehicle-kinds";
import { CheckPrice } from "../products/check-price";
import { PriceCheckSearch } from "./search";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NewOrder");
  return { title: t("title") };
}

/**
 * The Price check (Phase 2 stage 11; docs/phase-2-plan.md §7), on the
 * New order tab's route until the real New order arrives in Phase 3 stage
 * 9; the tab and the page are called "Price check" (the owner, 20 Nov 2026).
 *
 * One compact card (the owner, 20 Nov 2026: "a compact price checker"):
 * the pickup, the return, the location and where the booking would come
 * from (the counter, the shop's booking page, Moto Mangos) on top; one
 * search box for a product by name, kind or category; and under it that one
 * product's free count, or why it can't be booked, and for owners, managers
 * and staff its price, by the same Check a price as the Pricing tab with
 * that channel's coupons. Mechanics and drivers get the count only: the
 * price is never read or sent for them. Nothing is reserved or held: orders
 * come in Phase 3, which continues this screen.
 *
 * The form is a plain GET form, so a search is a link that can be shared
 * and works before the page's scripts have loaded (the typed text goes as
 * `q`, and the page opens its one match or lists them).
 */
export default async function NewOrderPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/new-order">) {
  const { tenant: slug } = await params;
  const { membership } = await requireTab(slug, "new-order");
  const { tenant, role } = membership;
  const [t, tProducts, tFleet, locale, locations, products, query] =
    await Promise.all([
      getTranslations("NewOrder"),
      getTranslations("Products"),
      getTranslations("Fleet"),
      getLocale(),
      getPriceCheckLocations(tenant.id),
      getPriceCheckProducts(tenant.id),
      searchParams,
    ]);
  const now = new Date();
  const asked = readPriceCheck(query, locations, now);
  const location = locations.find((l) => l.id === asked?.locationId);
  const seesPrices = canPricing(role, "read");

  /** What a product is, in words: "Motorbike · Scooter", "Rental gear". */
  const whatOf = (p: PriceCheckProduct) =>
    p.kind
      ? [
          tFleet(`kind.${p.kind}` as "kind.car"),
          ...p.categories.map((key) =>
            tFleet.has(`category.${key}` as "category.sedan")
              ? tFleet(`category.${key}` as "category.sedan")
              : humanizeKey(key),
          ),
        ].join(" · ")
      : tProducts(`type.${p.type}` as "type.gear");

  return (
    <>
      <PageHeader title={t("title")} />
      <div className="max-w-4xl rounded-lg border bg-card">
        {!asked || !location ? (
          <p className="p-4 text-sm text-muted-foreground">{t("noLocation")}</p>
        ) : (
          <Checker
            slug={slug}
            tenantId={tenant.id}
            asked={asked}
            locations={locations}
            timeZone={location.timezone}
            products={products}
            whatOf={whatOf}
            now={now}
            locale={locale}
            seesPrices={seesPrices}
            currency={tenant.currency}
            t={t}
          />
        )}
        <p
          role="note"
          className="border-t px-3 py-2 text-xs text-muted-foreground sm:px-4"
        >
          {t("nothingBooked")}
        </p>
      </div>
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"NewOrder">>>;

async function Checker({
  slug,
  tenantId,
  asked,
  locations,
  timeZone,
  products,
  whatOf,
  now,
  locale,
  seesPrices,
  currency,
  t,
}: {
  slug: string;
  tenantId: string;
  asked: PriceCheckAsked;
  locations: { id: string; name: string }[];
  timeZone: string;
  products: PriceCheckProduct[];
  whatOf: (p: PriceCheckProduct) => string;
  now: Date;
  locale: string;
  seesPrices: boolean;
  currency: string;
  t: T;
}) {
  const span = spanOf(asked, timeZone);
  const reads =
    span === "invalid"
      ? null
      : await getPriceCheckReads(
          tenantId,
          asked.locationId,
          products.map((p) => p.id),
          span,
        );
  const answers =
    reads && span !== "invalid"
      ? answersFor(reads.inputs, reads.rows, span, asked.channel, now)
      : [];
  const byId = new Map(products.map((p) => [p.id, p]));
  // A product with nothing at this location is left out; a service always shows.
  const shown = answers.filter((a) => a.stock === null || a.stock > 0);
  const options: PriceCheckOption[] = shown.flatMap((a) => {
    const product = byId.get(a.productId);
    return product
      ? [{ id: product.id, name: product.name, what: whatOf(product) }]
      : [];
  });
  // The product picked; else what was typed, when it matches one product only.
  const matches =
    asked.productId || !asked.search ? [] : matchOptions(options, asked.search);
  const chosenId =
    asked.productId ?? (matches.length === 1 ? matches[0].id : null);
  const chosen = shown.find((a) => a.productId === chosenId) ?? null;
  const chosenProduct = chosen ? byId.get(chosen.productId)! : null;
  const link = (productId: string) =>
    `/${slug}/new-order?${new URLSearchParams({
      location: asked.locationId,
      pickup: asked.pickup,
      return: asked.dropoff,
      channel: asked.channel,
      product: productId,
    })}`;

  return (
    <>
      <SearchForm
        slug={slug}
        asked={asked}
        locations={locations}
        options={options}
        chosenId={chosen?.productId ?? null}
        typed={chosenProduct?.name ?? asked.search}
        t={t}
      />
      <div
        id="result"
        aria-live="polite"
        className="border-t p-3 sm:p-4"
        data-result
      >
        {span === "invalid" ? (
          <p role="alert" className="text-sm text-destructive">
            {t("badDates")}
          </p>
        ) : shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noProducts")}</p>
        ) : chosen && chosenProduct ? (
          <Result
            answer={chosen}
            product={chosenProduct}
            what={whatOf(chosenProduct)}
            timeZone={timeZone}
            locale={locale}
            t={t}
          >
            {seesPrices && (
              <ChosenPrice
                key={`${chosen.productId}|${asked.pickup}|${asked.dropoff}|${asked.channel}`}
                slug={slug}
                tenantId={tenantId}
                product={chosenProduct}
                asked={asked}
                timeZone={timeZone}
                currency={currency}
                t={t}
              />
            )}
          </Result>
        ) : asked.search && !asked.productId ? (
          matches.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("noMatch", { query: asked.search })}
            </p>
          ) : (
            <ul className="divide-y rounded-md border" aria-label={t("search")}>
              {matches.map((m) => (
                <li key={m.id}>
                  <Link
                    href={link(m.id)}
                    className="flex min-h-11 flex-col justify-center px-3 py-1.5 hover:bg-accent"
                  >
                    <span className="text-sm font-medium">{m.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {m.what}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            {t(seesPrices ? "pickHint" : "pickHintCounts")}
          </p>
        )}
      </div>
    </>
  );
}

function SearchForm({
  slug,
  asked,
  locations,
  options,
  chosenId,
  typed,
  t,
}: {
  slug: string;
  asked: PriceCheckAsked;
  locations: { id: string; name: string }[];
  options: PriceCheckOption[];
  chosenId: string | null;
  typed: string;
  t: T;
}) {
  const several = locations.length > 1;
  const label = "mb-1 block text-xs font-medium text-muted-foreground";
  return (
    <form
      method="get"
      action={`/${slug}/new-order`}
      className="space-y-3 p-3 sm:p-4"
    >
      <div
        className={cn(
          "grid grid-cols-2 gap-x-3 gap-y-2",
          several ? "lg:grid-cols-4" : "lg:grid-cols-3",
        )}
      >
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="po-pickup" className={label}>
            {t("pickup")}
          </label>
          <input
            id="po-pickup"
            name="pickup"
            type="datetime-local"
            required
            defaultValue={asked.pickup}
            className={inputClass}
          />
        </div>
        <div className="col-span-2 sm:col-span-1">
          <label htmlFor="po-return" className={label}>
            {t("return")}
          </label>
          <input
            id="po-return"
            name="return"
            type="datetime-local"
            required
            defaultValue={asked.dropoff}
            className={inputClass}
          />
        </div>
        {several ? (
          <div className="min-w-0">
            <label htmlFor="po-location" className={label}>
              {t("location")}
            </label>
            <select
              id="po-location"
              name="location"
              defaultValue={asked.locationId}
              className={inputClass}
            >
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <input type="hidden" name="location" value={asked.locationId} />
        )}
        <div className={cn("min-w-0", !several && "col-span-2 sm:col-span-1")}>
          <label htmlFor="po-channel" className={label}>
            {t("channel")}
          </label>
          <select
            id="po-channel"
            name="channel"
            defaultValue={asked.channel}
            className={inputClass}
          >
            {priceCheckChannels.map((channel) => (
              <option key={channel} value={channel}>
                {t(`channels.${channel}`)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="flex items-start gap-2">
        <PriceCheckSearch
          // A new search starts the box afresh.
          key={`${chosenId ?? ""}|${asked.search}`}
          slug={slug}
          options={options}
          selectedId={chosenId}
          typed={typed}
        />
        <button
          type="submit"
          className={cn(buttonVariants(), "h-11 shrink-0 px-4")}
        >
          {t("check")}
        </button>
      </div>
    </form>
  );
}

function Result({
  answer,
  product,
  what,
  timeZone,
  locale,
  t,
  children,
}: {
  answer: ProductAnswer;
  product: PriceCheckProduct;
  what: string;
  timeZone: string;
  locale: string;
  t: T;
  children?: ReactNode;
}) {
  return (
    <div data-product={product.name} className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate font-semibold">{product.name}</h2>
          <p className="truncate text-xs text-muted-foreground">{what}</p>
        </div>
        <p
          data-count={answer.available ?? "service"}
          data-stock={answer.stock ?? "service"}
          className={cn(
            "shrink-0 text-right text-sm font-semibold tabular-nums",
            answer.available === 0 && "text-destructive",
          )}
        >
          {countText(answer, t)}
        </p>
      </div>
      {answer.refused && (
        <p
          data-refused={answer.refused.reason}
          className="rounded-md border border-destructive/40 p-2 text-sm text-destructive"
        >
          {refusedText(answer.refused, timeZone, locale, t)}
        </p>
      )}
      {children}
    </div>
  );
}

async function ChosenPrice({
  slug,
  tenantId,
  product,
  asked,
  timeZone,
  currency,
  t,
}: {
  slug: string;
  tenantId: string;
  product: PriceCheckProduct;
  asked: PriceCheckAsked;
  timeZone: string;
  currency: string;
  t: T;
}) {
  const inputs = await getPricingInputs(tenantId, [product.id]);
  return (
    <CheckPrice
      compact
      slug={slug}
      productId={product.id}
      priced={{
        kind: "saved",
        type: product.type,
        row: pricingRowOf(inputs, product.id) ?? null,
      }}
      inputs={inputs}
      timeZone={timeZone}
      currency={currency}
      pickup={asked.pickup}
      dropoff={asked.dropoff}
      channel={asked.channel}
      title={t("priceFor", {
        name: product.name,
        channel: t(`channels.${asked.channel}`),
      })}
    />
  );
}

function countText(answer: ProductAnswer, t: T): string {
  if (answer.available === null) return t("count.service");
  return t("count.free", {
    free: answer.available,
    stock: answer.stock ?? 0,
  });
}

function refusedText(
  refused: NonNullable<ProductAnswer["refused"]>,
  timeZone: string,
  locale: string,
  t: T,
): string {
  switch (refused.reason) {
    case "too_short":
      return t("refused.tooShort", { min: refused.minDays });
    case "too_soon":
      return t("refused.tooSoon", {
        when: formatInstant(refused.earliestPickup, timeZone, locale),
      });
    case "outside_hours":
      return refused.at === "return"
        ? t("refused.closedReturn")
        : refused.at === "no_hours"
          ? t("refused.noHours")
          : t("refused.closedPickup");
    case "not_now":
      return t("refused.closedPickup");
    case "not_listed":
      return t("refused.notListed");
    case "cap_reached":
      return t("refused.capReached");
    case "none_free":
      return refused.overbooking
        ? t("refused.noneFreeShortage")
        : t("refused.noneFree");
  }
}
