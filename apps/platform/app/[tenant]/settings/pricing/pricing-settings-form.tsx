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
import { Field, inputClass } from "@/components/form";
import {
  depositModes,
  type DepositMode,
  type SettingsDraft,
} from "@/lib/pricing-settings";
import { cn } from "@/lib/utils";
import { savePricingSettings } from "./actions";

type Profile = { id: string; name: string; rate_bp: number };

/**
 * The shop's pricing settings in one form with one Save
 * (docs/products-redesign.md §9.12): the rounding step, the tax style and
 * default profile, the deposit choice, "Accept coupons" and the
 * returning-customer discount (Phase 2 stage 9). The first Save
 * makes the shop's settings row, which fixes its currency: it asks first.
 */
export function PricingSettingsForm({
  slug,
  currency,
  initial,
  defaultStep,
  profiles,
  firstSave,
  disabled,
}: {
  slug: string;
  currency: string;
  initial: SettingsDraft;
  /** The currency's default step as typed ("10"), shown while blank. */
  defaultStep: string;
  profiles: Profile[];
  /** No settings row yet and the currency not yet fixed: ask before saving. */
  firstSave: boolean;
  disabled: boolean;
}) {
  const t = useTranslations("Settings.pricing");
  const [mode, setMode] = useState<DepositMode>(initial.depositMode);

  return (
    <ActionForm
      action={savePricingSettings}
      hidden={{ slug }}
      submitLabel={t("save")}
      showSubmit={!disabled}
      confirmIf={() =>
        firstSave ? t("firstSaveConfirm", { currency }) : undefined
      }
      className="max-w-3xl"
    >
      <fieldset disabled={disabled} className="min-w-0 space-y-6">
        <Panel title={t("rounding.title")} intro={t("rounding.intro")}>
          <TextInput
            name="roundingStep"
            label={t("rounding.label", { currency })}
            help={t("rounding.help", { step: defaultStep })}
            inputMode="decimal"
            placeholder={defaultStep}
            defaultValue={initial.roundingStep}
          />
        </Panel>

        <Panel title={t("tax.title")} intro={t("tax.intro")}>
          <div className="space-y-4">
            <Choice
              name="taxInclusive"
              legend={t("tax.style")}
              value={initial.taxInclusive ? "inclusive" : "exclusive"}
              options={[
                {
                  value: "inclusive",
                  label: t("tax.inclusive"),
                  help: t("tax.inclusiveHelp"),
                },
                {
                  value: "exclusive",
                  label: t("tax.exclusive"),
                  help: t("tax.exclusiveHelp"),
                },
              ]}
            />
            {profiles.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {t("tax.noProfiles")}
              </p>
            ) : (
              <DefaultProfile
                profiles={profiles}
                initial={initial.defaultTaxId}
                label={t("tax.default")}
                help={t("tax.defaultHelp")}
                none={t("tax.defaultNone")}
              />
            )}
          </div>
        </Panel>

        <Panel title={t("deposit.title")} intro={t("deposit.intro")}>
          <div className="space-y-4">
            <Choice
              name="depositMode"
              legend={t("deposit.title")}
              value={mode}
              onChange={(value) => setMode(value as DepositMode)}
              options={depositModes.map((value) => ({
                value,
                label: t(`deposit.${value}`),
                help: t(`deposit.${value}Help`),
              }))}
            />
            {mode === "percent_of_order" && (
              <TextInput
                name="depositPercent"
                label={t("deposit.percent")}
                help={t("deposit.percentHelp")}
                inputMode="decimal"
                defaultValue={initial.depositPercent}
              />
            )}
            {(mode === "fixed_per_order" || mode === "per_product") && (
              <TextInput
                key={mode}
                name="depositAmount"
                label={t(
                  mode === "fixed_per_order"
                    ? "deposit.fixedAmount"
                    : "deposit.shopAmount",
                  { currency },
                )}
                help={t(
                  mode === "fixed_per_order"
                    ? "deposit.fixedAmountHelp"
                    : "deposit.shopAmountHelp",
                )}
                inputMode="decimal"
                defaultValue={
                  mode === initial.depositMode ? initial.depositAmount : ""
                }
              />
            )}
          </div>
        </Panel>

        <Panel title={t("coupons.title")}>
          <CheckboxInput
            name="couponsEnabled"
            label={t("coupons.label")}
            defaultChecked={initial.couponsEnabled}
          />
          <p className="mt-1 text-sm text-muted-foreground">
            {t("coupons.help")}
          </p>
        </Panel>

        <Panel title={t("returning.title")} intro={t("returning.intro")}>
          <div className="space-y-4">
            <CheckboxInput
              name="returningEnabled"
              label={t("returning.label")}
              defaultChecked={initial.returningEnabled}
            />
            <div className="grid gap-4 sm:grid-cols-2">
              <TextInput
                name="returningPercent"
                label={t("returning.percent")}
                help={t("returning.percentHelp")}
                inputMode="decimal"
                defaultValue={initial.returningPercent}
              />
              <TextInput
                name="returningRentals"
                label={t("returning.rentals")}
                help={t("returning.rentalsHelp")}
                inputMode="numeric"
                defaultValue={initial.returningRentals}
              />
            </div>
          </div>
        </Panel>
      </fieldset>
    </ActionForm>
  );
}

function DefaultProfile({
  profiles,
  initial,
  label,
  help,
  none,
}: {
  profiles: Profile[];
  initial: string;
  label: string;
  help: string;
  none: string;
}) {
  const error = useFieldError("defaultTaxId");
  return (
    <Field id="defaultTaxId" label={label} help={help} error={error}>
      <select
        id="defaultTaxId"
        name="defaultTaxId"
        defaultValue={initial}
        className={inputClass}
        aria-invalid={error ? true : undefined}
      >
        <option value="">{none}</option>
        {profiles.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Radio choices, each with a line saying what it means. */
function Choice({
  name,
  legend,
  value,
  onChange,
  options,
}: {
  name: string;
  legend: string;
  value: string;
  onChange?: (value: string) => void;
  options: { value: string; label: string; help: string }[];
}) {
  const error = useFieldError(name);
  return (
    <fieldset className="space-y-2">
      <legend className="sr-only">{legend}</legend>
      {options.map((option) => (
        <label
          key={option.value}
          className={cn(
            "flex min-h-11 cursor-pointer items-start gap-3 rounded-md border p-3 has-checked:border-primary has-checked:bg-highlight",
          )}
        >
          <input
            type="radio"
            name={name}
            value={option.value}
            defaultChecked={option.value === value}
            onChange={() => onChange?.(option.value)}
            className="mt-0.5 size-5 accent-primary"
          />
          <span>
            <span className="block font-medium">{option.label}</span>
            <span className="block text-sm text-muted-foreground">
              {option.help}
            </span>
          </span>
        </label>
      ))}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </fieldset>
  );
}
