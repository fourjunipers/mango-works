"use client";

import { useLocale, useTranslations } from "next-intl";
import { ActionForm, Panel, useFieldError } from "@/components/action-form";
import { describedBy, Field, inputClass } from "@/components/form";
import { percentInput, percentLabel } from "@/lib/seasons";
import type { TaxProfileUse } from "@/lib/settings-data";
import {
  addUsualTaxProfile,
  archiveTaxProfile,
  saveTaxProfile,
} from "./actions";

/**
 * The shop's tax profiles (docs/products-redesign.md §9.7): add one, change
 * a name or rate, remove one from use, bring one back. A profile a product
 * uses can't be removed: the refusal names the products. A rate change on
 * a profile in use names the products it reprices before it saves.
 */
export function TaxProfiles({
  slug,
  profiles,
  defaultId,
  usual,
  firstSave,
  currency,
}: {
  slug: string;
  profiles: TaxProfileUse[];
  defaultId: string | null;
  /** The country's usual profile, offered while the shop has none. */
  usual: { name: string; rateBp: number } | null;
  firstSave: boolean;
  currency: string;
}) {
  const t = useTranslations("Settings.pricing.profiles");
  const tFirst = useTranslations("Settings.pricing");
  const locale = useLocale();
  const active = profiles.filter((p) => !p.archived);
  const archived = profiles.filter((p) => p.archived);

  return (
    <Panel
      id="tax-profiles"
      title={t("title")}
      intro={t("intro")}
      className="mt-6 max-w-3xl"
    >
      {active.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("none")}</p>
      ) : (
        <ul className="space-y-3">
          {active.map((profile) => (
            <li key={profile.id} className="rounded-md border p-3">
              <p className="font-medium">
                {profile.name} · {percentLabel(profile.rate_bp, locale)}
                {profile.id === defaultId && (
                  <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">
                    {t("isDefault")}
                  </span>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {profile.products.length === 0
                  ? t("unused")
                  : t("usedBy", {
                      count: profile.products.length,
                      names: profile.products.map((p) => p.name).join(", "),
                    })}
              </p>
              <details className="mt-2">
                <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium underline underline-offset-4">
                  {t("edit")}
                </summary>
                <ActionForm
                  action={saveTaxProfile}
                  hidden={{ slug, id: profile.id }}
                  submitLabel={t("save")}
                  confirmIf={(data) => {
                    const rate = String(data.get("rate") ?? "").trim();
                    return profile.products.length > 0 &&
                      rate !== percentInput(profile.rate_bp)
                      ? t("rateConfirm", {
                          count: profile.products.length,
                          names: profile.products.map((p) => p.name).join(", "),
                        })
                      : undefined;
                  }}
                  className="mt-3"
                >
                  <ProfileFields
                    prefix={profile.id}
                    name={profile.name}
                    rate={percentInput(profile.rate_bp)}
                  />
                </ActionForm>
              </details>
              <ActionForm
                action={archiveTaxProfile}
                hidden={{ slug, id: profile.id, archived: "1" }}
                submitLabel={t("remove")}
                confirm={t("removeConfirm", { name: profile.name })}
                quiet
                className="mt-2"
              />
            </li>
          ))}
        </ul>
      )}

      {usual && active.length === 0 && (
        <ActionForm
          action={addUsualTaxProfile}
          hidden={{ slug }}
          submitLabel={t("addUsual", { name: usual.name })}
          confirmIf={() =>
            firstSave ? tFirst("firstSaveConfirm", { currency }) : undefined
          }
          className="mt-4"
        />
      )}

      <details className="mt-4" open={active.length === 0 && !usual}>
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-medium underline underline-offset-4">
          {t("add")}
        </summary>
        <ActionForm
          action={saveTaxProfile}
          hidden={{ slug }}
          submitLabel={t("addSave")}
          className="mt-3"
        >
          <ProfileFields prefix="new" name="" rate="" />
        </ActionForm>
      </details>

      {archived.length > 0 && (
        <div className="mt-6">
          <h3 className="text-sm font-semibold">{t("archived")}</h3>
          <ul className="mt-2 space-y-2">
            {archived.map((profile) => (
              <li
                key={profile.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
              >
                <span>
                  {profile.name} · {percentLabel(profile.rate_bp, locale)}
                </span>
                <ActionForm
                  action={archiveTaxProfile}
                  hidden={{ slug, id: profile.id, archived: "0" }}
                  submitLabel={t("restore")}
                  quiet
                />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Panel>
  );
}

function ProfileFields({
  prefix,
  name,
  rate,
}: {
  prefix: string;
  name: string;
  rate: string;
}) {
  const t = useTranslations("Settings.pricing.profiles");
  const nameError = useFieldError("name");
  const rateError = useFieldError("rate");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field id={`${prefix}-name`} label={t("name")} error={nameError}>
        <input
          id={`${prefix}-name`}
          name="name"
          defaultValue={name}
          maxLength={80}
          autoComplete="off"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={describedBy(`${prefix}-name`, { error: nameError })}
          className={inputClass}
        />
      </Field>
      <Field
        id={`${prefix}-rate`}
        label={t("rate")}
        help={t("rateHelp")}
        error={rateError}
      >
        <input
          id={`${prefix}-rate`}
          name="rate"
          defaultValue={rate}
          inputMode="decimal"
          autoComplete="off"
          aria-invalid={rateError ? true : undefined}
          aria-describedby={describedBy(`${prefix}-rate`, {
            help: true,
            error: rateError,
          })}
          className={inputClass}
        />
      </Field>
    </div>
  );
}
