"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import {
  ActionForm,
  SelectInput,
  TextInput,
  useFieldError,
  type FormAction,
} from "@/components/action-form";
import { describedBy, Field, inputClass } from "@/components/form";
import type { TenantSettings } from "@/lib/tenant-settings";
import { saveSettings } from "./actions";

type Options = {
  countries: { code: string; name: string }[];
  currencies: { code: string; name: string }[];
};

/** Common locale tags offered as suggestions; any valid BCP 47 tag is accepted. */
const localeSuggestions = [
  "en",
  "en-GB",
  "en-US",
  "th-TH",
  "vi-VN",
  "ja-JP",
  "id-ID",
  "ms-MY",
  "zh-CN",
  "ko-KR",
];

/**
 * The shop's name, country, currency, distance unit and formats, on the
 * shared form (Phase 2 stage 11): after a refused save the focus goes to the
 * first field with an error, and each error is tied to its field with
 * aria-describedby and aria-invalid. The action answers with keys of
 * "Settings.errors", so the form is given those words.
 */
export function SettingsForm({
  slug,
  initial,
  options,
  currencyLocked,
  locationsHref,
}: {
  slug: string;
  initial: TenantSettings;
  options: Options;
  /** Money has been saved in this currency, so it can no longer change. */
  currencyLocked: boolean;
  locationsHref: string;
}) {
  const t = useTranslations("Settings");
  const errorText = (key: string) => {
    const known = `errors.${key}` as "errors.saveFailed";
    return t.has(known) ? t(known) : undefined;
  };

  return (
    <ActionForm
      action={saveSettings as FormAction}
      hidden={{ slug }}
      errorText={errorText}
      className="max-w-3xl rounded-lg border bg-card p-5"
    >
      <TextInput
        name="name"
        label={t("name")}
        required
        maxLength={120}
        defaultValue={initial.name}
        autoComplete="organization"
      />
      <div className="grid gap-5 md:grid-cols-2">
        <SelectInput
          name="country"
          label={t("country")}
          defaultValue={initial.country}
          options={options.countries.map((c) => ({
            value: c.code,
            label: `${c.name} (${c.code})`,
          }))}
        />
        <CurrencyField
          label={t("currency")}
          help={currencyLocked ? t("currencyLockedHelp") : undefined}
          initial={initial.currency}
          locked={currencyLocked}
          currencies={options.currencies}
        />
        <SelectInput
          name="distance_unit"
          label={t("distanceUnit")}
          help={t("distanceUnitHelp")}
          defaultValue={initial.distance_unit}
          options={[
            { value: "km", label: t("km") },
            { value: "mi", label: t("mi") },
          ]}
        />
        <div>
          <TextInput
            name="locale"
            label={t("locale")}
            help={t("localeHelp")}
            required
            list="locale-suggestions"
            defaultValue={initial.locale}
          />
          <datalist id="locale-suggestions">
            {localeSuggestions.map((tag) => (
              <option key={tag} value={tag} />
            ))}
          </datalist>
        </div>
      </div>
      <p className="text-sm text-muted-foreground">
        {t.rich("timezoneMoved", {
          link: (chunks) => (
            <Link href={locationsHref} className="font-medium underline">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </ActionForm>
  );
}

/**
 * The currency. Once money has been saved in it, the select is disabled and
 * the value rides along in a hidden field (a disabled select isn't sent).
 */
function CurrencyField({
  label,
  help,
  initial,
  locked,
  currencies,
}: {
  label: string;
  help?: string;
  initial: string;
  locked: boolean;
  currencies: { code: string; name: string }[];
}) {
  const error = useFieldError("currency");
  return (
    <Field id="currency" label={label} help={help} error={error}>
      {locked && <input type="hidden" name="currency" value={initial} />}
      <select
        id="currency"
        name={locked ? undefined : "currency"}
        disabled={locked}
        defaultValue={initial}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy("currency", { help, error })}
        className={inputClass}
      >
        {currencies.map((c) => (
          <option key={c.code} value={c.code}>
            {c.code} · {c.name}
          </option>
        ))}
      </select>
    </Field>
  );
}
