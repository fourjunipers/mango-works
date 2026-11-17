import {
  getCurrencyLocked,
  getPricingInputs,
  getProductPricingExtras,
  getSharedLists,
  getTaxProfiles,
} from "@/lib/pricing-data";
import {
  draftFromSaved,
  emptyBoxes,
  suggestedStep,
  taxChoice,
  type PricingDraft,
  type ProductType,
} from "@/lib/pricing-form";
import { pricingRowOf } from "@/lib/pricing-inputs";
import { canPricing } from "@/lib/pricing-permissions";
import type { Role } from "@/lib/roles";
import { addCalendarDays, dateInZone } from "@/lib/shop-time";
import { minorDecimal } from "@/lib/money";
import { PricingForm } from "./pricing-form";

/**
 * A product's Pricing tab (docs/products-redesign.md §9.12): owners and
 * managers edit, staff read. Mechanics and drivers have no tab, and the
 * database would give them no row anyway (RLS).
 *
 * The prices come from platform.pricing_inputs(), the one read that feeds
 * quote(); the editor's extras (how each day got its value, the tax choice,
 * the shop's lists and profiles) are read beside it.
 */
export async function PricingTab({
  slug,
  tenant,
  role,
  productId,
  type,
}: {
  slug: string;
  tenant: { id: string; currency: string; timezone: string };
  role: Role;
  productId: string;
  type: ProductType;
}) {
  const [inputs, extras, shared, taxProfiles, locked] = await Promise.all([
    getPricingInputs(tenant.id, [productId]),
    getProductPricingExtras(tenant.id, productId),
    getSharedLists(tenant.id),
    getTaxProfiles(tenant.id),
    getCurrencyLocked(tenant.id),
  ]);
  const currency = tenant.currency;
  const row = pricingRowOf(inputs, productId);
  const settings = inputs.settings;
  const step = settings?.rounding_step ?? String(suggestedStep(currency));
  const money = (value: string | null) =>
    value === null ? "" : minorDecimal(value, currency);
  const own = row?.template && !row.template.shared;

  const initial: PricingDraft = {
    method: row?.pricing_method ?? null,
    flatAmount:
      row?.pricing_method === "per_period" ? money(row.price_amount) : "",
    flatPeriod: row?.price_period ?? "day",
    fixedAmount: row?.pricing_method === "fixed" ? money(row.price_amount) : "",
    source: row?.template?.shared ? "shared" : "own",
    sharedId: row?.template?.shared ? row.template.id : "",
    baseAmount: money(row?.base_amount ?? null),
    list: own
      ? draftFromSaved(
          extras.ownDays,
          row!.template!.hourly,
          "amounts",
          currency,
        )
      : { boxes: emptyBoxes(), manual: {} },
    longStay: money(row?.long_stay_day ?? null),
    deposit: money(row?.deposit ?? null),
    tax: taxChoice(extras),
    replacement: money(row?.replacement_price ?? null),
  };
  // The sample rental starts tomorrow at 10:00 on the shop's clock.
  const tomorrow = addCalendarDays(dateInZone(new Date(), tenant.timezone), 1);
  const pad = (n: number) => String(n).padStart(2, "0");
  const pickup = `${tomorrow.year}-${pad(tomorrow.month)}-${pad(tomorrow.day)}T10:00`;

  return (
    <PricingForm
      slug={slug}
      productId={productId}
      type={type}
      currency={currency}
      timeZone={tenant.timezone}
      canEdit={canPricing(role, "write")}
      fixesCurrency={!locked}
      initial={initial}
      step={step}
      shared={shared.map(({ id, name, kind, hourly, days }) => ({
        id,
        name,
        kind,
        hourly,
        days,
      }))}
      taxProfiles={taxProfiles}
      defaultTaxId={settings?.default_tax_profile_id ?? null}
      deposit={{
        mode: settings?.deposit_mode ?? null,
        percentBp: settings?.deposit_percent_bp ?? null,
        amount: settings?.deposit_amount ?? null,
      }}
      inputs={inputs}
      pickup={pickup}
    />
  );
}
