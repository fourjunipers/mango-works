"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Field, inputClass } from "@/components/form";
import { Button } from "@/components/ui/button";
import { adjustmentParts } from "@mango/core/season";
import { codeGiven, couponFoundOf, type CouponInputs } from "@/lib/coupons";
import { dayText, notAppliedKey, refusalWords } from "@/lib/coupon-words";
import { formatMinor } from "@/lib/money";
import { parseWholeNumber } from "@/lib/number-input";
import type { BookingChannel } from "@mango/core/booking-rules";
import type {
  PricingContext,
  PricingDraft,
  ProductType,
} from "@/lib/pricing-form";
import {
  extrasOf,
  type PricingInputs,
  type ProductPricingRow,
} from "@/lib/pricing-inputs";
import {
  checkPrice,
  draftRow,
  sampleSpan,
  type Checked,
  type SharedList,
  type TaxProfile,
} from "@/lib/pricing-preview";
import { percentLabel } from "@/lib/seasons";
import { cn } from "@/lib/utils";
import { lookUpCoupon } from "./check-price-actions";

/**
 * "Check a price" (docs/products-redesign.md §9.12; Phase 2 stage 9): a
 * sample rental priced by quote() with the shop's settings and seasons,
 * the extras taken with a vehicle, a coupon code and a "Returning
 * customer" tick. The breakdown shows each discount: the returning-customer
 * discount, then the coupon with its code, each with what it took.
 *
 * Read-only: the code is looked up (coupon_inputs()) and judged by
 * decideDiscounts() as a counter booking would be, but nothing is reserved
 * and no use is counted. Used on the Pricing tab (the price as it is being
 * edited, on the walk-in channel) and on the New order price check (the
 * saved price, on the channel picked there; Phase 2 stage 11).
 */
export function CheckPrice({
  slug,
  productId,
  priced,
  inputs,
  timeZone,
  currency,
  pickup: firstPickup,
  dropoff: firstDropoff,
  channel = "walk_in",
  title,
}: {
  slug: string;
  productId: string;
  /**
   * What is priced: the Pricing tab's draft, saved or not ("changed" says
   * which), or the product's saved row as pricing_inputs() returned it.
   */
  priced:
    | {
        kind: "draft";
        draft: PricingDraft;
        ctx: PricingContext;
        shared: SharedList[];
        taxProfiles: TaxProfile[];
        defaultTaxId: string | null;
        changed: boolean;
      }
    | { kind: "saved"; type: ProductType; row: ProductPricingRow | null };
  inputs: PricingInputs;
  timeZone: string;
  currency: string;
  pickup: string;
  /** A return to start from: the sample is then "by dates". */
  dropoff?: string;
  /** Where the booking would come from: a coupon's channels are judged by it. */
  channel?: BookingChannel;
  /** The heading, when it is not "Check a price". */
  title?: string;
}) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const [by, setBy] = useState<"days" | "dates">(
    firstDropoff ? "dates" : "days",
  );
  const [days, setDays] = useState("7");
  const [pickup, setPickup] = useState(firstPickup);
  const [dropoff, setDropoff] = useState(() => {
    if (firstDropoff) return firstDropoff;
    const span = sampleSpan(
      { by: "days", pickup: firstPickup, days: 7 },
      timeZone,
    );
    return span ? localInput(span.end, timeZone) : firstPickup;
  });
  const type = priced.kind === "draft" ? priced.ctx.type : priced.type;
  const [quantity, setQuantity] = useState("1");
  const [extraCounts, setExtraCounts] = useState<Record<string, string>>({});
  const [returning, setReturning] = useState(false);
  const [codeTyped, setCodeTyped] = useState("");
  const [applied, setApplied] = useState<{
    code: string;
    read: CouponInputs;
    /** "Today" for its valid dates: the moment Apply was pressed. */
    at: Date;
  } | null>(null);
  const [lookupFailed, setLookupFailed] = useState(false);
  const [looking, startLooking] = useTransition();
  // Every box stays disabled until the component has started: typed into
  // before then, a box would keep the text while the price was worked out
  // from the defaults (review of PR 50).
  const started = useStarted();
  const money = (value: bigint) => formatMinor(value, currency, locale);

  // The extras offered with this vehicle that have a price.
  const names = new Map(
    inputs.products.map((p) => [p.product_id, p.product_name]),
  );
  const extras =
    type === "vehicle"
      ? extrasOf(inputs, productId).filter((e) =>
          inputs.products.some(
            (p) =>
              p.product_id === e.extra_product_id && p.pricing_method !== null,
          ),
        )
      : [];

  const span = sampleSpan(
    by === "days" ? { by, pickup, days: count(days) } : { by, pickup, dropoff },
    timeZone,
  );
  const row =
    priced.kind === "draft"
      ? draftRow(productId, priced.draft, priced.ctx, priced.shared, {
          profiles: priced.taxProfiles,
          defaultId: priced.defaultTaxId,
        })
      : priced.row?.pricing_method
        ? priced.row
        : null;
  const checked: Checked | null = span
    ? checkPrice({
        inputs,
        row,
        sample: { ...span, quantity: count(quantity), timeZone },
        extras: extras.map((e) => ({
          productId: e.extra_product_id,
          quantity: count(extraCounts[e.extra_product_id] || "0"),
        })),
        code: applied?.code ?? null,
        coupon: applied?.read ?? null,
        returning,
        channel,
        // A coupon's valid dates are judged at the moment Apply was pressed
        // (on the shop's clock, in decideDiscounts); with no code, "now"
        // decides nothing.
        now: applied?.at ?? new Date(),
      })
    : null;
  const result = checked?.quote ?? null;
  const line = result?.lines.find((l) => l.id === "sample") ?? null;
  const extraLines = result?.lines.filter((l) => l.id !== "sample") ?? [];
  const seasonName = (id: string) =>
    inputs.seasons.find((s) => s.id === id)?.name ?? "";

  const settings = inputs.settings;
  const returningOn =
    !!settings?.returning_enabled && settings.returning_percent_bp != null;

  const apply = () => {
    const code = codeTyped;
    setLookupFailed(false);
    if (!codeGiven(code)) {
      setApplied(null);
      return;
    }
    startLooking(async () => {
      const answer = await lookUpCoupon(slug, code);
      if (answer.ok) setApplied({ code, read: answer.read, at: new Date() });
      else {
        setApplied(null);
        setLookupFailed(true);
      }
    });
  };

  return (
    <section
      aria-labelledby="check-price"
      className="rounded-lg border bg-card p-4 sm:p-5"
    >
      <h2 id="check-price" className="text-lg font-semibold">
        {title ?? t("check.title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {t(
          priced.kind === "draft" && priced.changed
            ? "check.introUnsaved"
            : "check.intro",
        )}
      </p>
      <fieldset
        disabled={!started}
        data-started={started ? "yes" : "no"}
        className="mt-4 min-w-0 space-y-4"
      >
        <div
          role="radiogroup"
          aria-label={t("check.by")}
          className="flex flex-wrap gap-2"
        >
          {(["days", "dates"] as const).map((value) => (
            <label
              key={value}
              className={cn(
                "flex min-h-11 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm",
                by === value && "border-primary bg-primary/5",
              )}
            >
              <input
                type="radio"
                name="check-by"
                checked={by === value}
                onChange={() => setBy(value)}
                className="size-5 accent-primary"
              />
              {t(`check.by_${value}`)}
            </label>
          ))}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="check-pickup" label={t("check.pickup")}>
            <input
              id="check-pickup"
              type="datetime-local"
              className={inputClass}
              value={pickup}
              onChange={(e) => setPickup(e.target.value)}
            />
          </Field>
          {by === "days" ? (
            <Field id="check-days" label={t("check.days")}>
              <input
                id="check-days"
                type="number"
                min={1}
                max={1000}
                inputMode="numeric"
                className={inputClass}
                value={days}
                onChange={(e) => setDays(e.target.value)}
              />
            </Field>
          ) : (
            <Field id="check-return" label={t("check.return")}>
              <input
                id="check-return"
                type="datetime-local"
                className={inputClass}
                value={dropoff}
                onChange={(e) => setDropoff(e.target.value)}
              />
            </Field>
          )}
          <Field id="check-quantity" label={t("check.quantity")}>
            <input
              id="check-quantity"
              type="number"
              min={1}
              max={99}
              inputMode="numeric"
              className={inputClass}
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
            />
          </Field>
        </div>

        {extras.length > 0 && (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">{t("check.extras")}</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {extras.map((e) => {
                const id = `check-extra-${e.extra_product_id}`;
                return (
                  <Field
                    key={e.extra_product_id}
                    id={id}
                    label={names.get(e.extra_product_id) ?? ""}
                    help={
                      e.included_quantity > 0
                        ? t("check.extraIncluded", {
                            count: e.included_quantity,
                          })
                        : undefined
                    }
                  >
                    <input
                      id={id}
                      aria-describedby={
                        e.included_quantity > 0 ? `${id}-help` : undefined
                      }
                      type="number"
                      min={0}
                      max={99}
                      inputMode="numeric"
                      className={inputClass}
                      value={extraCounts[e.extra_product_id] ?? "0"}
                      onChange={(ev) =>
                        setExtraCounts((c) => ({
                          ...c,
                          [e.extra_product_id]: ev.target.value,
                        }))
                      }
                    />
                  </Field>
                );
              })}
            </div>
          </fieldset>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="check-coupon" className="block text-sm font-medium">
              {t("check.coupon")}
            </label>
            <div className="flex gap-2">
              <input
                id="check-coupon"
                className={cn(inputClass, "min-w-0 flex-1 uppercase")}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                maxLength={60}
                value={codeTyped}
                onChange={(e) => setCodeTyped(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    apply();
                  }
                }}
              />
              <Button
                type="button"
                variant="outline"
                className="h-11 px-4"
                onClick={apply}
                disabled={looking}
              >
                {looking ? t("check.couponChecking") : t("check.couponApply")}
              </Button>
            </div>
            {applied && (
              <Button
                type="button"
                variant="link"
                className="h-11 px-0"
                onClick={() => {
                  setApplied(null);
                  setCodeTyped("");
                }}
              >
                {t("check.couponRemove")}
              </Button>
            )}
          </div>
          <div className="space-y-1">
            <label className="flex min-h-11 items-center gap-3 text-sm font-medium">
              <input
                type="checkbox"
                checked={returning}
                onChange={(e) => setReturning(e.target.checked)}
                className="size-5 accent-primary"
              />
              {t("check.returning")}
            </label>
            <p className="text-xs text-muted-foreground">
              {returningOn
                ? t("check.returningHelp", {
                    percent: percentLabel(
                      settings!.returning_percent_bp!,
                      locale,
                    ),
                    count: settings!.returning_rentals_needed ?? 1,
                  })
                : t("check.returningOff")}
            </p>
          </div>
        </div>

        <CouponNote
          checked={checked}
          applied={applied}
          lookupFailed={lookupFailed}
          money={money}
          locale={locale}
        />

        <div aria-live="polite">
          {!result || !line ? (
            <p className="rounded-md border bg-muted/40 p-3 text-sm">
              {row ? t("check.cantPrice") : t("check.notPriced")}
            </p>
          ) : (
            <dl
              className="divide-y rounded-md border text-sm"
              aria-label={t("check.breakdown")}
            >
              <Row
                label={t("check.listPrice")}
                detail={basisText(line.unit.basis, t, money)}
                value={money(line.listPrice)}
              />
              {line.seasons.map((s) => {
                const parts = adjustmentParts(s.amount);
                return (
                  <Row
                    key={s.ruleId}
                    label={t("check.season", { name: seasonName(s.ruleId) })}
                    detail={t("check.seasonDays", { count: s.periodsInside })}
                    value={money(parts.size)}
                    sign={parts.direction === "decrease" ? "−" : "+"}
                  />
                );
              })}
              {extraLines.map((l) => (
                <Row
                  key={l.id}
                  label={t("check.extraLine", {
                    name: names.get(l.productId) ?? "",
                    count: l.quantity,
                  })}
                  detail={
                    l.includedQuantity > 0
                      ? t("check.extraLineIncluded", {
                          count: l.includedQuantity,
                        })
                      : undefined
                  }
                  value={money(l.seasonPrice)}
                />
              ))}
              {checked!.discounts.map((d) => (
                <Row
                  key={d.id}
                  label={
                    d.kind === "returning"
                      ? t("check.discountReturning")
                      : t("check.discountCoupon", { code: d.code })
                  }
                  value={money(d.amount)}
                  sign="−"
                />
              ))}
              {result.taxGroups.map((g) => (
                <Row
                  key={g.rateBp}
                  label={t(
                    inputs.settings?.tax_inclusive === false
                      ? "check.vatAdded"
                      : "check.vatIncluded",
                    { rate: percentText(g.rateBp, locale) },
                  )}
                  value={money(g.vat)}
                />
              ))}
              <Row
                label={t("check.total")}
                value={money(result.totals.total)}
                strong
              />
              <Row
                label={t("check.deposit")}
                detail={t("check.depositHelp")}
                value={money(result.deposit.amount)}
              />
            </dl>
          )}
        </div>
      </fieldset>
    </section>
  );
}

/**
 * What became of the code, in plain words: applied; refused, and why;
 * good but not applied (it would take nothing, or the returning-customer
 * discount is the larger and the two don't combine); or applied in place
 * of the returning-customer discount.
 */
function CouponNote({
  checked,
  applied,
  lookupFailed,
  money,
  locale,
}: {
  checked: Checked | null;
  applied: { code: string; read: CouponInputs } | null;
  lookupFailed: boolean;
  money: (value: bigint) => string;
  locale: string;
}) {
  const t = useTranslations("Pricing.coupon");
  let text: string | null = null;
  let tone: "good" | "bad" | "plain" = "plain";
  if (lookupFailed) {
    text = t("lookupFailed");
    tone = "bad";
  } else if (applied && checked) {
    const decision = checked.decision;
    if (decision.outcome === "refused") {
      const found = couponFoundOf(applied.read);
      const words = refusalWords(decision.reason, found?.settings ?? null);
      const v = words.values;
      text = t(`refused.${words.key}` as "refused.unknown", {
        from: v.from ? dayText(v.from, locale) : "",
        to: v.to ? dayText(v.to, locale) : "",
        days: v.days ?? 0,
        amount: v.amount !== undefined ? money(v.amount) : "",
      });
      tone = "bad";
    } else if (decision.outcome === "decided" && decision.coupon) {
      const coupon = decision.coupon;
      if (!coupon.applied) {
        text = t(
          `notApplied.${notAppliedKey(coupon.because)}` as "notApplied.takesNothing",
          {
            code: coupon.code,
          },
        );
      } else {
        text = checked.couponBeatReturning
          ? t("appliedInstead", { code: coupon.code })
          : t("applied", { code: coupon.code });
        tone = "good";
      }
    }
  }
  if (!text) return null;
  return (
    <p
      role="status"
      data-coupon-note={tone}
      className={cn(
        "rounded-md border p-3 text-sm",
        tone === "bad" && "border-destructive/40 text-destructive",
        tone === "good" &&
          "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-50",
      )}
    >
      {text}
    </p>
  );
}

/**
 * A box of the sample as a whole number, by the platform's one number rule
 * (lib/number-input.ts). NaN when it is empty or not one ("2e3", "1.5"):
 * the sample then has no price, as before.
 */
function count(text: string): number {
  const whole = parseWholeNumber(text);
  return typeof whole === "bigint" && whole <= BigInt(1_000_000)
    ? Number(whole)
    : Number.NaN;
}

const noSubscribe = () => () => {};

/**
 * False in the server's HTML and while the page is starting, true once this
 * component runs in the browser: the boxes are usable only then.
 */
function useStarted(): boolean {
  return useSyncExternalStore(
    noSubscribe,
    () => true,
    () => false,
  );
}

/** 7% from 700 basis points, in the viewer's locale. */
function percentText(bp: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(bp / 10000);
}

function localInput(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function Row({
  label,
  detail,
  value,
  sign,
  strong,
}: {
  label: string;
  detail?: string;
  value: string;
  sign?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 p-3">
      <dt>
        <span className={cn(strong && "font-semibold")}>{label}</span>
        {detail && (
          <span className="block text-xs text-muted-foreground">{detail}</span>
        )}
      </dt>
      <dd className={cn("tabular-nums", strong && "font-semibold")}>
        {sign}
        {value}
      </dd>
    </div>
  );
}

type Basis = Checked["quote"]["lines"][number]["unit"]["basis"];

/** How the list price was worked out, in words. */
function basisText(
  basis: Basis,
  t: ReturnType<typeof useTranslations<"Pricing">>,
  money: (value: bigint) => string,
): string {
  switch (basis.kind) {
    case "hours":
      return t(basis.capped ? "basis.hoursCapped" : "basis.hours", {
        hours: basis.hours,
        hourly: money(basis.hourly),
      });
    case "list":
      return t("basis.list", { days: basis.days });
    case "months":
      return basis.underOneMonth
        ? t("basis.underOneMonth")
        : t("basis.months", {
            months: basis.months,
            days: basis.leftoverDays,
            rate: money(basis.longStayDay),
          });
    case "periods":
      return t(`basis.periods_${basis.period}`, { count: basis.count });
    case "fixed":
      return t("basis.fixed");
    case "free":
      return t("basis.free");
    case "continuation":
      return "";
  }
}
