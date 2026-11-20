import type { Metadata } from "next";
import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page";
import { inputClass } from "@/components/form";
import { buttonVariants } from "@/components/ui/button";
import { requireTab } from "@/lib/access";
import {
  answersFor,
  priceCheckChannels,
  readPriceCheck,
  spanOf,
  type PriceCheckAsked,
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
import { CheckPrice } from "../products/check-price";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("NewOrder");
  return { title: t("title") };
}

/**
 * New order, as a price check (Phase 2 stage 11; docs/phase-2-plan.md §7).
 * Pick a location, a pickup, a return and where the booking would come
 * from (the counter, the shop's booking page, Moto Mangos): each product
 * shows how many are free and, when it can't be booked, why. Owners,
 * managers and staff tap one for its price, by the same Check a price as
 * the Pricing tab, with that channel's coupons; mechanics and drivers see
 * the counts only. Nothing is reserved or held: orders come in Phase 3,
 * which continues this screen.
 *
 * The form is a plain GET form, so a search is a link that can be shared
 * and works before the page's scripts have loaded.
 */
export default async function NewOrderPage({
  params,
  searchParams,
}: PageProps<"/[tenant]/new-order">) {
  const { tenant: slug } = await params;
  const { membership } = await requireTab(slug, "new-order");
  const { tenant, role } = membership;
  const [t, locale, locations, products, query] = await Promise.all([
    getTranslations("NewOrder"),
    getLocale(),
    getPriceCheckLocations(tenant.id),
    getPriceCheckProducts(tenant.id),
    searchParams,
  ]);
  const now = new Date();
  const asked = readPriceCheck(query, locations, now);
  const location = locations.find((l) => l.id === asked?.locationId);
  const seesPrices = canPricing(role, "read");

  return (
    <>
      <PageHeader title={t("title")} intro={t("intro")} />
      <p
        role="note"
        className="mb-6 max-w-3xl rounded-md border border-highlight-border bg-highlight p-3 text-sm text-highlight-foreground"
      >
        {t("nothingBooked")}
      </p>
      {!asked || !location ? (
        <p className="text-sm text-muted-foreground">{t("noLocation")}</p>
      ) : (
        <div className="max-w-3xl space-y-6">
          <SearchForm slug={slug} asked={asked} locations={locations} t={t} />
          <Results
            slug={slug}
            tenantId={tenant.id}
            asked={asked}
            timeZone={location.timezone}
            products={products}
            now={now}
            locale={locale}
            seesPrices={seesPrices}
            currency={tenant.currency}
            t={t}
          />
        </div>
      )}
    </>
  );
}

type T = Awaited<ReturnType<typeof getTranslations<"NewOrder">>>;

function SearchForm({
  slug,
  asked,
  locations,
  t,
}: {
  slug: string;
  asked: PriceCheckAsked;
  locations: { id: string; name: string }[];
  t: T;
}) {
  return (
    <form
      method="get"
      action={`/${slug}/new-order`}
      className="space-y-4 rounded-lg border bg-card p-4 sm:p-5"
    >
      <div className="grid gap-4 sm:grid-cols-3">
        {locations.length > 1 ? (
          <div className="space-y-1.5">
            <label htmlFor="po-location" className="block text-sm font-medium">
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
        <div className="space-y-1.5">
          <label htmlFor="po-pickup" className="block text-sm font-medium">
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
        <div className="space-y-1.5">
          <label htmlFor="po-return" className="block text-sm font-medium">
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
      </div>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">{t("channel")}</legend>
        <div className="flex flex-wrap gap-2">
          {priceCheckChannels.map((channel) => (
            <label
              key={channel}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/5"
            >
              <input
                type="radio"
                name="channel"
                value={channel}
                defaultChecked={asked.channel === channel}
                className="size-5 accent-primary"
              />
              {t(`channels.${channel}`)}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">{t("channelHelp")}</p>
      </fieldset>
      <button type="submit" className={cn(buttonVariants(), "h-11 px-6")}>
        {t("check")}
      </button>
    </form>
  );
}

async function Results({
  slug,
  tenantId,
  asked,
  timeZone,
  products,
  now,
  locale,
  seesPrices,
  currency,
  t,
}: {
  slug: string;
  tenantId: string;
  asked: PriceCheckAsked;
  timeZone: string;
  products: PriceCheckProduct[];
  now: Date;
  locale: string;
  seesPrices: boolean;
  currency: string;
  t: T;
}) {
  const span = spanOf(asked, timeZone);
  if (span === "invalid")
    return (
      <p role="alert" className="text-sm text-destructive">
        {t("badDates")}
      </p>
    );
  const reads = await getPriceCheckReads(
    tenantId,
    asked.locationId,
    products.map((p) => p.id),
    span,
  );
  if (!reads)
    return <p className="text-sm text-muted-foreground">{t("noProducts")}</p>;
  const answers = answersFor(
    reads.inputs,
    reads.rows,
    span,
    asked.channel,
    now,
  );
  const byId = new Map(products.map((p) => [p.id, p]));
  // A product with nothing at this location is left out; a service always shows.
  const shown = answers.filter((a) => a.stock === null || a.stock > 0);
  const chosen =
    seesPrices && asked.productId
      ? (shown.find((a) => a.productId === asked.productId) ?? null)
      : null;
  const link = (productId: string | null) => {
    const search = new URLSearchParams({
      location: asked.locationId,
      pickup: asked.pickup,
      return: asked.dropoff,
      channel: asked.channel,
    });
    if (productId) search.set("product", productId);
    return `/${slug}/new-order?${search}#${productId ? "price" : "results"}`;
  };

  return (
    <>
      <section
        aria-labelledby="results-heading"
        id="results"
        className="scroll-mt-20"
      >
        <h2 id="results-heading" className="mb-2 text-lg font-semibold">
          {t("results", { channel: t(`channels.${asked.channel}`) })}
        </h2>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("noProducts")}</p>
        ) : (
          <ul className="divide-y rounded-lg border bg-card">
            {shown.map((answer) => {
              const product = byId.get(answer.productId);
              if (!product) return null;
              return (
                <li
                  key={answer.productId}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 p-3"
                  data-product={product.name}
                >
                  <div className="min-w-0">
                    <p className="font-medium">{product.name}</p>
                    <p
                      data-count={answer.available ?? "service"}
                      data-stock={answer.stock ?? "service"}
                      className="text-sm text-muted-foreground tabular-nums"
                    >
                      {countText(answer, t)}
                    </p>
                    {answer.refused && (
                      <p className="text-sm text-destructive">
                        {refusedText(answer.refused, timeZone, locale, t)}
                      </p>
                    )}
                  </div>
                  {seesPrices && (
                    <Link
                      href={link(answer.productId)}
                      aria-current={
                        chosen?.productId === answer.productId
                          ? "true"
                          : undefined
                      }
                      className={cn(
                        buttonVariants({ variant: "outline" }),
                        "h-11 px-4",
                      )}
                    >
                      {t("seePrice")}
                      <span className="sr-only">: {product.name}</span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
      {chosen && (
        <div id="price" className="scroll-mt-20">
          <ChosenPrice
            key={`${chosen.productId}|${asked.pickup}|${asked.dropoff}|${asked.channel}`}
            slug={slug}
            tenantId={tenantId}
            product={byId.get(chosen.productId)!}
            asked={asked}
            timeZone={timeZone}
            currency={currency}
            t={t}
          />
        </div>
      )}
    </>
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
    case "none_free":
      return refused.overbooking
        ? t("refused.noneFreeShortage")
        : t("refused.noneFree");
  }
}
