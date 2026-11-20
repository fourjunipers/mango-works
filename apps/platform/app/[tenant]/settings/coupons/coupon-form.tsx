"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  ActionForm,
  CheckboxInput,
  Panel,
  TextInput,
  useFieldError,
} from "@/components/action-form";
import { inputClass } from "@/components/form";
import {
  codePreview,
  COUPON_CODE_MAX,
  COUPON_NAME_MAX,
  couponChannels,
  type CouponDraft,
} from "@/lib/coupon-form";
import { cn } from "@/lib/utils";
import { saveCouponForm } from "./actions";

type Product = { id: string; name: string; type: string; retired: boolean };

/**
 * The coupon form (Phase 2 stage 9; docs/phase-2-plan.md §5.3, §7), in the
 * brief's order: the code, its name, percentage or fixed amount, which
 * products, the valid dates, the pickup dates, minimum days, minimum
 * spend, total uses, where it can be used, whether it combines with the
 * returning-customer discount, and whether it can be used on season
 * discounts. "Uses per customer" is left off until Phase 3 sends a
 * customer (lib/coupon-form.ts).
 *
 * The code is shown as it will be stored, and said to be impossible as
 * soon as it is typed; the server checks the whole form again, and the
 * database checks it once more.
 */
export function CouponForm({
  slug,
  id,
  currency,
  initial,
  products,
  canEdit,
}: {
  slug: string;
  id?: string;
  currency: string;
  initial: CouponDraft;
  products: Product[];
  canEdit: boolean;
}) {
  const t = useTranslations("Settings.coupons");
  const [code, setCode] = useState(initial.code);
  const [kind, setKind] = useState(initial.kind);
  const [allProducts, setAllProducts] = useState(initial.allProducts);
  const [search, setSearch] = useState("");
  const chosen = new Set(initial.productIds);
  // Retired products show only when already chosen.
  const offered = products.filter((p) => !p.retired || chosen.has(p.id));
  const shown = offered.filter((p) =>
    p.name.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const preview = codePreview(code);

  return (
    <ActionForm
      action={saveCouponForm}
      hidden={{ slug, ...(id ? { id } : {}) }}
      submitLabel={id ? t("save") : t("create")}
      showSubmit={canEdit}
      className="max-w-3xl"
    >
      <fieldset disabled={!canEdit} className="min-w-0 space-y-6">
        <Panel>
          <div className="space-y-4">
            <div className="space-y-1">
              <TextInput
                name="code"
                label={t("code")}
                help={t("codeHelp")}
                maxLength={COUPON_CODE_MAX + 20}
                autoCapitalize="characters"
                spellCheck={false}
                value={code}
                onChange={(e) => setCode(e.target.value)}
              />
              {preview && (
                <p
                  aria-live="polite"
                  className={cn(
                    "text-sm",
                    preview.ok ? "text-muted-foreground" : "text-destructive",
                  )}
                >
                  {preview.ok
                    ? preview.stored === code
                      ? null
                      : t("codeStoredAs", { code: preview.stored })
                    : t("codeCantSave")}
                </p>
              )}
            </div>
            <TextInput
              name="name"
              label={t("name")}
              help={t("nameHelp")}
              maxLength={COUPON_NAME_MAX}
              defaultValue={initial.name}
            />
          </div>
        </Panel>

        <Panel title={t("value")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <fieldset className="space-y-2">
              <legend className="mb-1.5 text-sm font-medium">
                {t("kind")}
              </legend>
              {(["percent", "fixed"] as const).map((value) => (
                <label
                  key={value}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 has-checked:border-primary has-checked:bg-highlight"
                >
                  <input
                    type="radio"
                    name="kind"
                    value={value}
                    checked={kind === value}
                    onChange={() => setKind(value)}
                    className="size-5 accent-primary"
                  />
                  <span className="font-medium">
                    {t(value === "percent" ? "kindPercent" : "kindFixed")}
                  </span>
                </label>
              ))}
            </fieldset>
            {kind === "percent" ? (
              <TextInput
                key="percent"
                name="percent"
                label={t("percent")}
                help={t("percentHelp")}
                inputMode="decimal"
                defaultValue={initial.percent}
              />
            ) : (
              <TextInput
                key="amount"
                name="amount"
                label={t("amount", { currency })}
                help={t("amountHelp")}
                inputMode="decimal"
                defaultValue={initial.amount}
              />
            )}
          </div>
        </Panel>

        <Panel title={t("products")} intro={t("productsIntro")}>
          <fieldset className="space-y-2">
            <legend className="sr-only">{t("products")}</legend>
            {(["all", "chosen"] as const).map((scope) => (
              <label
                key={scope}
                className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border px-3 has-checked:border-primary has-checked:bg-highlight"
              >
                <input
                  type="radio"
                  name="scope"
                  value={scope}
                  defaultChecked={(scope === "all") === initial.allProducts}
                  onChange={() => setAllProducts(scope === "all")}
                  className="size-5 accent-primary"
                />
                <span className="font-medium">
                  {t(scope === "all" ? "scopeAll" : "scopeChosen")}
                </span>
              </label>
            ))}
          </fieldset>
          {/* Kept in the form while hidden, so a switch back keeps the choice. */}
          <div className={cn("mt-4 space-y-3", allProducts && "hidden")}>
            <input
              type="search"
              aria-label={t("search")}
              placeholder={t("search")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              // A filter, not a save: Enter (or a phone's Search key) must not
              // send the form.
              enterKeyHint="search"
              onKeyDown={(e) => {
                if (e.key === "Enter") e.preventDefault();
              }}
              className={inputClass}
            />
            <ul className="max-h-80 divide-y overflow-y-auto rounded-md border">
              {offered.map((p) => (
                <li key={p.id} className={cn(!shown.includes(p) && "hidden")}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm">
                    <input
                      type="checkbox"
                      name="productIds"
                      value={p.id}
                      defaultChecked={chosen.has(p.id)}
                      className="size-5 accent-primary"
                    />
                    <span>
                      {p.name}
                      {p.retired && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          {t("retired")}
                        </span>
                      )}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
            <ErrorFor name="products" />
          </div>
        </Panel>

        <Panel title={t("valid")} intro={t("validIntro")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              name="validFrom"
              type="date"
              label={t("validFrom")}
              defaultValue={initial.validFrom}
            />
            <TextInput
              name="validTo"
              type="date"
              label={t("validTo")}
              defaultValue={initial.validTo}
            />
          </div>
        </Panel>

        <Panel title={t("pickup")} intro={t("pickupIntro")}>
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput
              name="pickupFrom"
              type="date"
              label={t("pickupFrom")}
              defaultValue={initial.pickupFrom}
            />
            <TextInput
              name="pickupTo"
              type="date"
              label={t("pickupTo")}
              defaultValue={initial.pickupTo}
            />
          </div>
        </Panel>

        <Panel title={t("limits")}>
          <div className="space-y-4">
            <TextInput
              name="minDays"
              label={t("minDays")}
              help={t("minDaysHelp")}
              inputMode="numeric"
              defaultValue={initial.minDays}
            />
            <TextInput
              name="minSpend"
              label={t("minSpend", { currency })}
              help={t("minSpendHelp")}
              inputMode="decimal"
              defaultValue={initial.minSpend}
            />
            <TextInput
              name="maxUses"
              label={t("maxUses")}
              help={t("maxUsesHelp")}
              inputMode="numeric"
              defaultValue={initial.maxUses}
            />
          </div>
        </Panel>

        <Panel title={t("channels")} intro={t("channelsIntro")}>
          <fieldset className="space-y-1">
            <legend className="sr-only">{t("channels")}</legend>
            {couponChannels.map((channel) => (
              <label
                key={channel}
                className="flex min-h-11 cursor-pointer items-center gap-3 text-sm font-medium"
              >
                <input
                  type="checkbox"
                  name="channels"
                  value={channel}
                  defaultChecked={initial.channels.includes(channel)}
                  className="size-5 accent-primary"
                />
                {t(`channel_${channel}`)}
              </label>
            ))}
            <ErrorFor name="channels" />
          </fieldset>
        </Panel>

        <Panel title={t("combining")}>
          <div className="space-y-3">
            <CheckboxInput
              name="withReturningDiscount"
              label={t("withReturning")}
              help={t("withReturningHelp")}
              defaultChecked={initial.withReturningDiscount}
            />
            <CheckboxInput
              name="withSeasonDiscount"
              label={t("withSeason")}
              help={t("withSeasonHelp")}
              defaultChecked={initial.withSeasonDiscount}
            />
          </div>
        </Panel>
      </fieldset>
    </ActionForm>
  );
}

function ErrorFor({ name }: { name: string }) {
  const error = useFieldError(name);
  return error ? (
    <p id={`${name}-error`} role="alert" className="text-sm text-destructive">
      {error}
    </p>
  ) : null;
}
