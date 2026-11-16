"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ActionForm, TextInput } from "@/components/action-form";
import { Field, inputClass } from "@/components/form";
import { formatMinor, parseMinorUnits } from "@/lib/money";
import {
  MULTIPLIER_STEP,
  computeList,
  suggestedSampleBase,
  type ListDraft,
  type ListKind,
} from "@/lib/pricing-form";
import { cn } from "@/lib/utils";
import { resolvePriceList } from "@mango/core/price-list";
import { deletePriceList, savePriceList } from "../../products/pricing-actions";
import { ListEditor } from "../../products/pricing-form";

/**
 * A shared price list's editor (docs/products-redesign.md §9.3, §9.4,
 * §9.12): its name, its kind (chosen once, when it is made), the six
 * quick-entry boxes and the 30 days. A multipliers list shows the amounts
 * at a sample base price beside it, as Booqable's editor does. Saving names
 * the products whose prices it changes.
 */
export function PriceListForm({
  slug,
  currency,
  step,
  canEdit,
  list,
}: {
  slug: string;
  currency: string;
  /** The shop's rounding step for amounts, minor units as digits. */
  step: string;
  canEdit: boolean;
  list: {
    id?: string;
    name: string;
    kind: ListKind | null;
    draft: ListDraft;
    products: { id: string; name: string }[];
  };
}) {
  const t = useTranslations("Pricing");
  const locale = useLocale();
  const [kind, setKind] = useState<ListKind | null>(list.kind);
  const [draft, setDraft] = useState<ListDraft>(list.draft);
  const [sample, setSample] = useState(() => suggestedSampleBase(currency));
  const listStep = kind === "multipliers" ? MULTIPLIER_STEP : BigInt(step);
  const result = useMemo(
    () => computeList(draft, kind ?? "amounts", currency, listStep),
    [draft, kind, currency, listStep],
  );
  const sampleAmounts = useMemo(() => {
    if (kind !== "multipliers" || !result.ok) return null;
    const base = parseMinorUnits(sample, currency);
    if (base === null || base === "invalid" || base === BigInt(0)) return null;
    try {
      return resolvePriceList(
        {
          kind: "multipliers",
          days: result.days.map((d) => d.value!),
          hourly: result.hourly,
        },
        base,
      );
    } catch {
      return null;
    }
  }, [kind, result, sample, currency]);
  const others = list.products.length;

  return (
    <div className="max-w-3xl space-y-6">
      <ActionForm
        action={savePriceList}
        hidden={{
          slug,
          ...(list.id ? { id: list.id } : {}),
          kind: kind ?? "",
          list: JSON.stringify(draft),
        }}
        showSubmit={canEdit}
        submitDisabled={!kind || !result.ok}
        submitLabel={t(list.id ? "lists.save" : "lists.create")}
        confirmIf={() =>
          list.id && others > 0
            ? t("lists.repriceConfirm", { count: others })
            : undefined
        }
        className="space-y-6"
      >
        <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
          <section className="space-y-4 rounded-lg border bg-card p-4 sm:p-5">
            <TextInput
              name="name"
              label={t("lists.name")}
              help={t("lists.nameHelp")}
              maxLength={120}
              required
              defaultValue={list.name}
            />
            {list.id ? (
              <p className="text-sm">
                {t(
                  kind === "amounts"
                    ? "lists.kindAmounts"
                    : "lists.kindMultipliers",
                )}
                {" · "}
                <span className="text-muted-foreground">
                  {t("lists.kindFixed")}
                </span>
              </p>
            ) : (
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">
                  {t("lists.kind")}
                </legend>
                <div className="grid gap-2 sm:grid-cols-2">
                  {(["amounts", "multipliers"] as const).map((value) => (
                    <label
                      key={value}
                      className={cn(
                        "flex min-h-11 cursor-pointer gap-3 rounded-md border p-3 text-sm",
                        kind === value && "border-primary bg-primary/5",
                      )}
                    >
                      <input
                        type="radio"
                        name="list-kind"
                        checked={kind === value}
                        onChange={() => setKind(value)}
                        className="mt-0.5 size-5 shrink-0 accent-primary"
                      />
                      <span>
                        <span className="block font-medium">
                          {t(
                            value === "amounts"
                              ? "lists.kindAmounts"
                              : "lists.kindMultipliers",
                          )}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t(
                            value === "amounts"
                              ? "lists.kindAmountsHelp"
                              : "lists.kindMultipliersHelp",
                          )}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
          </section>

          {kind && (
            <section className="rounded-lg border bg-card p-4 sm:p-5">
              <ListEditor
                kind={kind}
                currency={currency}
                draft={draft}
                result={result}
                onChange={setDraft}
                readOnly={!canEdit}
              />
            </section>
          )}
        </fieldset>

        {kind === "multipliers" && (
          <section className="rounded-lg border bg-card p-4 sm:p-5">
            <Field
              id="sample-base"
              label={t("lists.sampleBase", { currency })}
              help={t("lists.sampleBaseHelp")}
            >
              <input
                id="sample-base"
                inputMode="decimal"
                className={inputClass}
                value={sample}
                onChange={(e) => setSample(e.target.value)}
              />
            </Field>
            {sampleAmounts && (
              <ol className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3 lg:grid-cols-5">
                {sampleAmounts.days.map((value, i) => (
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
            )}
          </section>
        )}

        {list.id && (
          <section className="rounded-lg border bg-card p-4 sm:p-5">
            <h2 className="text-lg font-semibold">{t("lists.usedBy")}</h2>
            {others === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                {t("lists.unused")}
              </p>
            ) : (
              <>
                <p className="mt-2 text-sm">
                  {t("lists.repriceNote", { count: others })}
                </p>
                <ul className="mt-2 list-disc pl-5 text-sm">
                  {list.products.map((p) => (
                    <li key={p.id}>{p.name}</li>
                  ))}
                </ul>
              </>
            )}
          </section>
        )}
      </ActionForm>

      {list.id && canEdit && (
        <section className="border-t pt-6">
          <ActionForm
            action={deletePriceList}
            hidden={{ slug, id: list.id }}
            submitLabel={t("lists.delete")}
            confirm={t("lists.deleteConfirm")}
            destructive
          >
            {others > 0 && (
              <p className="text-sm text-muted-foreground">
                {t("lists.deleteBlocked")}
              </p>
            )}
          </ActionForm>
        </section>
      )}
    </div>
  );
}
