"use client";

import Link from "next/link";
import { useId, useMemo, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ActionForm, useFieldError } from "@/components/action-form";
import { Field, inputClass } from "@/components/form";
import { Button } from "@/components/ui/button";
import { formatMinor, multiplierText, parseMinorUnits } from "@/lib/money";
import {
  asksProductDeposit,
  boxDay,
  boxes,
  computeList,
  methodsFor,
  periods,
  sameAsSavedDraft,
  sameEveryDayDraft,
  valueText,
  withBox,
  type Box,
  type ListDraft,
  type ListKind,
  type ListResult,
  type Method,
  type PricingContext,
  type PricingDraft,
  type ProductType,
} from "@/lib/pricing-form";
import { seasonsFor, type PricingInputs } from "@/lib/pricing-inputs";
import { percentLabel, seasonDates } from "@/lib/seasons";
import { type SharedList, type TaxProfile } from "@/lib/pricing-preview";
import { cn } from "@/lib/utils";
import { resolvePriceList } from "@mango/core/price-list";
import { CheckPrice } from "./check-price";
import { saveProductPricing } from "./pricing-actions";

/**
 * The Pricing tab's form (docs/products-redesign.md §9.12). Owners and
 * managers edit; staff see the same, read only. Every amount on screen is
 * worked out by @mango/core: the days of a list by fillPriceList, a
 * multipliers list by resolvePriceList, the sample rental by quote().
 */

export type DepositInfo = {
  /** Null: the shop has saved no setting yet (no deposit until one is typed). */
  mode: "none" | "percent_of_order" | "fixed_per_order" | "per_product" | null;
  percentBp: number | null;
  /** fixed_per_order: the amount. per_product: for a vehicle with none of its own. */
  amount: string | null;
};

export function PricingForm({
  slug,
  productId,
  type,
  currency,
  timeZone,
  canEdit,
  fixesCurrency,
  initial,
  step,
  shared,
  taxProfiles,
  defaultTaxId,
  deposit,
  inputs,
  pickup,
}: {
  slug: string;
  productId: string;
  type: ProductType;
  currency: string;
  timeZone: string;
  canEdit: boolean;
  /**
   * The shop's currency is not fixed yet, and the first price saved fixes
   * it: the form says so and asks first, as Settings › Pricing and tax does.
   */
  fixesCurrency: boolean;
  initial: PricingDraft;
  /** The rounding step, minor units as a string of digits. */
  step: string;
  shared: SharedList[];
  taxProfiles: TaxProfile[];
  defaultTaxId: string | null;
  deposit: DepositInfo;
  /** The shop's settings and the seasons for this product (pricing_inputs). */
  inputs: PricingInputs;
  /** The sample's first pickup, "2027-01-01T10:00" on the shop's clock. */
  pickup: string;
}) {
  const t = useTranslations("Pricing");
  const tFirst = useTranslations("Settings.pricing");
  const locale = useLocale();
  const [draft, setDraft] = useState<PricingDraft>(initial);
  const set = (change: Partial<PricingDraft>) =>
    setDraft((d) => ({ ...d, ...change }));
  const money = (value: bigint | string) =>
    formatMinor(value, currency, locale);

  const isVehicle = type === "vehicle";
  // This product's seasons only: the read also returns the seasons of the
  // gear and services offered with a vehicle.
  const seasons = seasonsFor(inputs, productId);
  const showDeposit = asksProductDeposit(type, deposit.mode);
  const ctx: PricingContext = {
    type,
    currency,
    step: BigInt(step),
    sharedKinds: new Map(shared.map((l) => [l.id, l.kind])),
    showDeposit,
    showTax: taxProfiles.length > 0,
  };
  const ownList = useMemo(
    () => computeList(draft.list, "amounts", currency, BigInt(step)),
    [draft.list, currency, step],
  );
  const ownBlocked =
    draft.method === "tiered" && draft.source === "own" && !ownList.ok;
  const methods = methodsFor[type];
  const sharedList = shared.find((l) => l.id === draft.sharedId) ?? null;

  return (
    <div className="max-w-3xl space-y-6">
      <ActionForm
        action={saveProductPricing}
        hidden={{ slug, productId, draft: JSON.stringify(draft) }}
        showSubmit={canEdit}
        submitDisabled={ownBlocked}
        submitLabel={t("save")}
        confirmIf={() =>
          fixesCurrency ? tFirst("firstSaveConfirm", { currency }) : undefined
        }
        className="space-y-6"
      >
        {canEdit && fixesCurrency && (
          <p
            role="note"
            className="rounded-md border border-highlight-border bg-highlight p-3 text-sm text-highlight-foreground"
          >
            {tFirst("firstSaveNote", { currency })}
          </p>
        )}
        {!canEdit && (
          <p className="rounded-md border bg-muted/40 p-3 text-sm">
            {t("readOnly")}
          </p>
        )}
        <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
          <Card title={t("method.title")}>
            <div
              role="radiogroup"
              aria-label={t("method.title")}
              className="grid gap-2 sm:grid-cols-2"
            >
              {methods.map((method) => (
                <Choice
                  key={method}
                  name="method"
                  checked={draft.method === method}
                  onChange={() => set({ method })}
                  label={t(`method.${method}`)}
                  help={t(`method.${method}Help`)}
                />
              ))}
            </div>
            <ErrorFor name="method" />
          </Card>

          {draft.method === "per_period" && (
            <Card title={t("flat.title")}>
              <div className="grid gap-4 sm:grid-cols-2">
                <MoneyInput
                  id="flatAmount"
                  label={t("flat.amount", { currency })}
                  value={draft.flatAmount}
                  onChange={(flatAmount) => set({ flatAmount })}
                />
                <Field id="flatPeriod" label={t("flat.period")}>
                  <select
                    id="flatPeriod"
                    className={inputClass}
                    value={draft.flatPeriod}
                    onChange={(e) =>
                      set({
                        flatPeriod: e.target
                          .value as PricingDraft["flatPeriod"],
                      })
                    }
                  >
                    {periods.map((period) => (
                      <option key={period} value={period}>
                        {t(`period.${period}`)}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("flat.help")}
              </p>
            </Card>
          )}

          {draft.method === "fixed" && (
            <Card title={t("fixed.title")}>
              <MoneyInput
                id="fixedAmount"
                label={t("fixed.amount", { currency })}
                help={t("fixed.help")}
                value={draft.fixedAmount}
                onChange={(fixedAmount) => set({ fixedAmount })}
              />
            </Card>
          )}

          {draft.method === "free" && (
            <Card title={t("free.title")}>
              <p className="text-sm">{t("free.help")}</p>
            </Card>
          )}

          {draft.method === "tiered" && (
            <Card title={t("tiered.title")}>
              <div
                role="radiogroup"
                aria-label={t("tiered.title")}
                className="grid gap-2 sm:grid-cols-2"
              >
                <Choice
                  name="source"
                  checked={draft.source === "own"}
                  onChange={() => set({ source: "own" })}
                  label={t("tiered.own")}
                  help={t("tiered.ownHelp")}
                />
                <Choice
                  name="source"
                  checked={draft.source === "shared"}
                  onChange={() => set({ source: "shared" })}
                  label={t("tiered.shared")}
                  help={t("tiered.sharedHelp")}
                />
              </div>

              <div className="mt-5">
                {draft.source === "own" ? (
                  <ListEditor
                    kind="amounts"
                    currency={currency}
                    draft={draft.list}
                    result={ownList}
                    onChange={(list) => set({ list })}
                    readOnly={!canEdit}
                  />
                ) : (
                  <SharedChoice
                    canEdit={canEdit}
                    slug={slug}
                    currency={currency}
                    shared={shared}
                    list={sharedList}
                    draft={draft}
                    set={set}
                  />
                )}
              </div>
              <ErrorFor name="list" />

              <div className="mt-5 border-t pt-5">
                <MoneyInput
                  id="longStay"
                  label={t("tiered.longStay", { currency })}
                  help={t("tiered.longStayHelp")}
                  value={draft.longStay}
                  onChange={(longStay) => set({ longStay })}
                />
              </div>
            </Card>
          )}

          {isVehicle && (
            <Card title={t("deposit.title")}>
              {showDeposit ? (
                <MoneyInput
                  id="deposit"
                  label={t("deposit.amount", { currency })}
                  help={
                    deposit.amount
                      ? t("deposit.shopAmount", {
                          amount: money(deposit.amount),
                        })
                      : t("deposit.help")
                  }
                  value={draft.deposit}
                  onChange={(value) => set({ deposit: value })}
                />
              ) : (
                <p className="text-sm">
                  {deposit.mode === "percent_of_order"
                    ? t("deposit.percent", {
                        percent: percentText(deposit.percentBp ?? 0, locale),
                      })
                    : deposit.mode === "fixed_per_order"
                      ? t("deposit.fixed", {
                          amount: money(deposit.amount ?? "0"),
                        })
                      : t("deposit.none")}
                  {canEdit && (
                    <>
                      {" "}
                      <Link
                        href={`/${slug}/settings/pricing`}
                        className="underline underline-offset-2"
                      >
                        {t("deposit.change")}
                      </Link>
                    </>
                  )}
                </p>
              )}
            </Card>
          )}

          {taxProfiles.length > 0 && (
            <Card title={t("tax.title")}>
              <Field id="tax" label={t("tax.label")}>
                <select
                  id="tax"
                  className={inputClass}
                  value={draft.tax}
                  onChange={(e) => set({ tax: e.target.value })}
                >
                  <option value="default">
                    {defaultTaxId
                      ? t("tax.default", {
                          name:
                            taxProfiles.find((p) => p.id === defaultTaxId)
                              ?.name ?? "",
                        })
                      : t("tax.defaultNone")}
                  </option>
                  {taxProfiles
                    .filter((p) => p.id !== defaultTaxId)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  <option value="none">{t("tax.none")}</option>
                </select>
              </Field>
            </Card>
          )}

          {type === "gear" && (
            <Card title={t("replacement.title")}>
              <MoneyInput
                id="replacement"
                label={t("replacement.amount", { currency })}
                help={t("replacement.help")}
                value={draft.replacement}
                onChange={(replacement) => set({ replacement })}
              />
            </Card>
          )}

          {seasons.length > 0 && (
            <Card title={t("seasons.title")}>
              <ul className="space-y-2 text-sm">
                {seasons.map((season) => (
                  <li key={season.id}>
                    <span className="font-medium">{season.name}</span>
                    {" · "}
                    {t(season.adjust_bp < 0 ? "seasons.off" : "seasons.more", {
                      percent: percentLabel(season.adjust_bp, locale),
                    })}
                    {" · "}
                    {t(
                      season.repeats_yearly ? "seasons.yearly" : "seasons.once",
                      seasonDates(
                        season.starts_on,
                        season.ends_on,
                        season.repeats_yearly,
                        locale,
                      ),
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-muted-foreground">
                {t("seasons.help")}
              </p>
            </Card>
          )}
        </fieldset>
      </ActionForm>

      <CheckPrice
        slug={slug}
        productId={productId}
        draft={draft}
        ctx={ctx}
        shared={shared}
        taxProfiles={taxProfiles}
        defaultTaxId={defaultTaxId}
        inputs={inputs}
        timeZone={timeZone}
        currency={currency}
        pickup={pickup}
        changed={!sameAsSavedDraft(draft, initial, ctx)}
      />
    </div>
  );
}

/** 7% from 700 basis points, in the viewer's locale. */
function percentText(bp: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 2,
  }).format(bp / 10000);
}

function Card({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className="rounded-lg border bg-card p-4 sm:p-5"
    >
      <h2 id={headingId} className="mb-4 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ErrorFor({ name }: { name: string }) {
  const message = useFieldError(name);
  return message ? (
    <p role="alert" className="mt-2 text-sm text-destructive">
      {message}
    </p>
  ) : null;
}

function Choice({
  name,
  checked,
  onChange,
  label,
  help,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  label: string;
  help: string;
}) {
  return (
    <label
      className={cn(
        "flex min-h-11 cursor-pointer gap-3 rounded-md border p-3 text-sm",
        checked && "border-primary bg-primary/5",
      )}
    >
      <input
        type="radio"
        name={`pricing-${name}`}
        checked={checked}
        onChange={onChange}
        className="mt-0.5 size-5 shrink-0 accent-primary"
      />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{help}</span>
      </span>
    </label>
  );
}

function MoneyInput({
  id,
  label,
  help,
  value,
  onChange,
}: {
  id: string;
  label: string;
  help?: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const error = useFieldError(id);
  return (
    <Field id={id} label={label} help={help} error={error}>
      <input
        id={id}
        inputMode="decimal"
        autoComplete="off"
        aria-invalid={error ? true : undefined}
        aria-describedby={help ? `${id}-help` : undefined}
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

// ------------------------------------------------------------ the list editor

/**
 * Quick entry and the 30 days (§9.4): six boxes; the days between fill in;
 * every day can be typed by hand and reset. On a phone the grid is behind
 * "Show all days". Used for a product's own prices and for shared lists.
 */
export function ListEditor({
  kind,
  currency,
  draft,
  result,
  onChange,
  readOnly,
}: {
  kind: ListKind;
  currency: string;
  draft: ListDraft;
  result: ListResult;
  onChange: (draft: ListDraft) => void;
  readOnly: boolean;
}) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const [showAll, setShowAll] = useState(false);
  const shown = (value: bigint) =>
    kind === "amounts"
      ? formatMinor(value, currency, locale)
      : `×${multiplierText(value)}`;
  const setBox = (box: Box, text: string) =>
    onChange(withBox(draft, box, text));
  const setDay = (day: number, text: string) =>
    onChange({ ...draft, manual: { ...draft.manual, [day]: text } });
  const resetDay = (day: number) => {
    const manual = { ...draft.manual };
    delete manual[day];
    onChange({ ...draft, manual });
  };
  const falls = result.problems.filter((p) => p.kind === "falls");

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">{t("quick.title")}</h3>
        <p className="text-xs text-muted-foreground">
          {t(kind === "amounts" ? "quick.help" : "quick.helpMultipliers")}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {boxes.map((box) => {
          const error = result.boxErrors[box];
          const id = `box-${box}`;
          return (
            <Field
              key={box}
              id={id}
              label={t(`quick.${box}`)}
              error={
                error === "invalid"
                  ? t(
                      kind === "amounts"
                        ? "quick.invalid"
                        : "quick.invalidMultiplier",
                    )
                  : error === "required" &&
                      draft.boxes.daily + draft.boxes.monthly
                    ? t("quick.required")
                    : undefined
              }
            >
              <input
                id={id}
                inputMode="decimal"
                autoComplete="off"
                readOnly={readOnly}
                placeholder={
                  box === "daily" || box === "monthly"
                    ? t("quick.requiredMark")
                    : ""
                }
                aria-invalid={error === "invalid" ? true : undefined}
                className={inputClass}
                value={draft.boxes[box]}
                onChange={(e) => setBox(box, e.target.value)}
              />
            </Field>
          );
        })}
      </div>
      {!readOnly && (
        <Button
          type="button"
          variant="outline"
          className="h-11 px-4"
          onClick={() => {
            const next = sameEveryDayDraft(draft, kind, currency);
            if (next) onChange(next);
          }}
          disabled={!draft.boxes.daily.trim()}
        >
          {t("quick.sameEveryDay")}
        </Button>
      )}

      {falls.length > 0 && (
        <div
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive"
        >
          <p className="font-medium">{t("grid.fallsTitle")}</p>
          <ul className="mt-1 list-disc pl-5">
            {falls.map((p) => (
              <li key={p.kind + ("day" in p ? p.day : "")}>
                {"day" in p &&
                  t("grid.falls", { day: p.day, before: p.day - 1 })}
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.days.some((d) => d.invalid) && (
        <p role="alert" className="text-sm text-destructive">
          {t("grid.invalidDays")}
        </p>
      )}

      <div>
        <Button
          type="button"
          variant="outline"
          className="h-11 px-4 sm:hidden"
          aria-expanded={showAll}
          onClick={() => setShowAll((s) => !s)}
        >
          {t(showAll ? "grid.hide" : "grid.showAll")}
        </Button>
        <ol
          aria-label={t("grid.label")}
          className={cn(
            "mt-3 grid grid-cols-2 gap-2 sm:mt-0 sm:grid sm:grid-cols-3 lg:grid-cols-5",
            !showAll && "hidden",
          )}
        >
          {result.days.map((d) => {
            const anchored =
              d.source === "anchor" &&
              (Object.values(boxDay) as number[]).includes(d.day) &&
              !!draft.boxes[
                (Object.keys(boxDay) as (keyof typeof boxDay)[]).find(
                  (b) => boxDay[b] === d.day,
                )!
              ].trim();
            const falling = falls.some((p) => "day" in p && p.day === d.day);
            const typed = draft.manual[d.day];
            const id = `day-${d.day}`;
            return (
              <li
                key={d.day}
                className={cn(
                  "rounded-md border p-2",
                  falling && "border-destructive bg-destructive/5",
                )}
              >
                <label
                  htmlFor={id}
                  className="flex items-baseline justify-between gap-1 text-xs"
                >
                  <span className="font-medium">
                    {t("grid.day", { days: d.day })}
                  </span>
                  <span className="text-muted-foreground">
                    {anchored
                      ? t("grid.fromBox")
                      : d.source === "manual"
                        ? t("grid.byHand")
                        : t("grid.filled")}
                  </span>
                </label>
                <input
                  id={id}
                  inputMode="decimal"
                  autoComplete="off"
                  readOnly={readOnly || anchored}
                  aria-invalid={falling || d.invalid ? true : undefined}
                  title={d.value === null ? undefined : shown(d.value)}
                  className={cn(
                    inputClass,
                    "mt-1 h-10 px-2",
                    d.source === "filled" && "text-muted-foreground",
                    anchored && "bg-muted",
                  )}
                  value={
                    typed ??
                    (d.value === null ? "" : valueText(d.value, kind, currency))
                  }
                  onChange={(e) => setDay(d.day, e.target.value)}
                />
                {typed !== undefined && !readOnly && !anchored && (
                  <button
                    type="button"
                    onClick={() => resetDay(d.day)}
                    className="mt-1 min-h-8 text-xs font-medium underline underline-offset-4"
                  >
                    {t("grid.reset")}
                    <span className="sr-only">
                      {" "}
                      {t("grid.day", { days: d.day })}
                    </span>
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </div>
  );
}

// ----------------------------------------------------------- a shared list

function SharedChoice({
  canEdit,
  slug,
  currency,
  shared,
  list,
  draft,
  set,
}: {
  /** Price lists are in Settings, which staff can't open. */
  canEdit: boolean;
  slug: string;
  currency: string;
  shared: SharedList[];
  list: SharedList | null;
  draft: PricingDraft;
  set: (change: Partial<PricingDraft>) => void;
}) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const error = useFieldError("sharedId");
  const amounts = useMemo(() => {
    if (!list) return null;
    try {
      const base =
        list.kind === "multipliers"
          ? parseBase(draft.baseAmount, currency)
          : null;
      if (list.kind === "multipliers" && base === null) return null;
      return resolvePriceList(
        {
          kind: list.kind,
          days: list.days.map((d) => BigInt(d)),
          hourly: list.hourly === null ? null : BigInt(list.hourly),
        },
        base,
      );
    } catch {
      return null;
    }
  }, [list, draft.baseAmount, currency]);

  return (
    <div className="space-y-4">
      {shared.length === 0 ? (
        <p className="text-sm">{t("tiered.noLists")}</p>
      ) : (
        <Field id="sharedId" label={t("tiered.list")} error={error}>
          <select
            id="sharedId"
            className={inputClass}
            value={draft.sharedId}
            onChange={(e) => set({ sharedId: e.target.value })}
          >
            <option value="">{t("tiered.pickList")}</option>
            {shared.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name} ·{" "}
                {t(
                  l.kind === "amounts"
                    ? "lists.kindAmounts"
                    : "lists.kindMultipliers",
                )}
              </option>
            ))}
          </select>
        </Field>
      )}
      {canEdit && (
        <p className="text-sm">
          <Link
            href={`/${slug}/settings/price-lists`}
            className="font-medium underline underline-offset-4"
          >
            {t("tiered.manageLists")}
          </Link>
        </p>
      )}
      {list?.kind === "multipliers" && (
        <MoneyInput
          id="baseAmount"
          label={t("tiered.base", { currency })}
          help={t("tiered.baseHelp")}
          value={draft.baseAmount}
          onChange={(baseAmount) => set({ baseAmount })}
        />
      )}
      {list && amounts && (
        <div>
          <h3 className="text-sm font-semibold">{t("tiered.resulting")}</h3>
          <ol className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-5">
            {amounts.hourly !== null && (
              <li className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  {t("quick.hourly")}
                </span>
                <span className="tabular-nums">
                  {formatMinor(amounts.hourly, currency, locale)}
                </span>
              </li>
            )}
            {amounts.days.map((value, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span className="text-muted-foreground">
                  {t("grid.day", { days: i + 1 })}
                </span>
                <span className="tabular-nums">
                  {formatMinor(value, currency, locale)}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

/** A base price as typed, through the one money parser. Null: not usable. */
function parseBase(text: string, currency: string): bigint | null {
  const value = parseMinorUnits(text, currency);
  return typeof value === "bigint" && value > BigInt(0) ? value : null;
}

export type { Method };
