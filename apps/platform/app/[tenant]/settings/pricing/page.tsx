import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/page";
import { requireArea } from "@/lib/access";
import { getPricingInputs } from "@/lib/pricing-data";
import { suggestedStep } from "@/lib/pricing-form";
import { canPricing } from "@/lib/pricing-permissions";
import { settingsDraft, usualTaxProfile } from "@/lib/pricing-settings";
import { minorDecimal } from "@/lib/money";
import { getTaxProfileUses } from "@/lib/settings-data";
import { createClient } from "@mango/db/platform-server";
import { PricingSettingsForm } from "./pricing-settings-form";
import { TaxProfiles } from "./tax-profiles";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Settings.pricing");
  return { title: t("title") };
}

/**
 * Settings › Pricing and tax (docs/products-redesign.md §9.12, stage D6).
 * Owners and managers. Opening the page writes nothing: the shop's settings
 * row is made by its first Save, which fixes the shop's currency, so the
 * page says so first.
 */
export default async function PricingSettingsPage({
  params,
}: PageProps<"/[tenant]/settings/pricing">) {
  const { tenant: slug } = await params;
  const { membership } = await requireArea(slug, "settings");
  const { tenant, role } = membership;
  const supabase = await createClient();
  const [t, inputs, profiles, locked] = await Promise.all([
    getTranslations("Settings.pricing"),
    getPricingInputs(tenant.id, []),
    getTaxProfileUses(tenant.id),
    supabase.rpc("currency_locked", { p_tenant_id: tenant.id }),
  ]);
  const settings = inputs.settings;
  const firstSave = settings === null && locked.data !== true;
  const defaultStep = minorDecimal(
    suggestedStep(tenant.currency),
    tenant.currency,
  ).replace(/\.0+$/, "");
  const active = profiles
    .filter((p) => !p.archived)
    .map(({ id, name, rate_bp }) => ({ id, name, rate_bp }));
  const edit = canPricing(role, "write");

  return (
    <>
      <PageHeader title={t("title")} intro={t("intro")} />
      {firstSave && (
        <p
          role="note"
          className="mb-6 max-w-3xl rounded-md border border-highlight-border bg-highlight p-3 text-sm text-highlight-foreground"
        >
          {t("firstSaveNote", { currency: tenant.currency })}
        </p>
      )}
      <PricingSettingsForm
        slug={slug}
        currency={tenant.currency}
        initial={settingsDraft(settings, tenant.currency)}
        defaultStep={defaultStep}
        profiles={active}
        firstSave={firstSave}
        disabled={!edit}
      />
      <TaxProfiles
        slug={slug}
        profiles={profiles}
        defaultId={settings?.default_tax_profile_id ?? null}
        usual={usualTaxProfile(tenant.country)}
        firstSave={firstSave}
        currency={tenant.currency}
      />
    </>
  );
}
