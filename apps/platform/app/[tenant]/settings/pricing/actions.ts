"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { canPricing } from "@/lib/pricing-permissions";
import {
  depositModes,
  parseRateBp,
  profileNameError,
  settingsPayload,
  usualTaxProfile,
  type DepositMode,
} from "@/lib/pricing-settings";
import { requireMembership } from "@/lib/session";
import { productsUsingProfile } from "@/lib/settings-data";
import { createClient } from "@mango/db/platform-server";
import { pricingErrorKey } from "../../products/pricing-actions";

/**
 * Settings › Pricing and tax (stage D6). Every write goes through the stage
 * D4 functions, save_pricing_settings and save_tax_profile; nothing writes a
 * table. The shop's settings row is made by the first Save, never by
 * opening the page.
 */

const notAllowed: FormState = { errors: { form: "notAllowed" } };
const field = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "").trim();

async function context(formData: FormData) {
  const slug = field(formData, "slug");
  const { membership } = await requireMembership(slug);
  return {
    slug,
    tenant: membership.tenant,
    allowed: canPricing(membership.role, "write"),
    supabase: await createClient(),
  };
}

function refresh(slug: string) {
  revalidatePath(`/${slug}/settings`, "layout");
  revalidatePath(`/${slug}/products`, "layout");
}

/** Saves the shop's pricing settings (platform.save_pricing_settings()). */
export async function savePricingSettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { slug, tenant, allowed, supabase } = await context(formData);
  if (!allowed) return notAllowed;
  const mode = field(formData, "depositMode") as DepositMode;
  const { data: profiles, error: readError } = await supabase
    .from("tax_profiles")
    .select("id")
    .eq("tenant_id", tenant.id)
    .is("archived_at", null);
  if (readError) return { errors: { form: "saveFailed" } };
  const result = settingsPayload(
    {
      roundingStep: field(formData, "roundingStep"),
      taxInclusive: field(formData, "taxInclusive") !== "exclusive",
      defaultTaxId: field(formData, "defaultTaxId"),
      depositMode: depositModes.includes(mode) ? mode : "none",
      depositPercent: field(formData, "depositPercent"),
      depositAmount: field(formData, "depositAmount"),
      couponsEnabled: formData.get("couponsEnabled") === "on",
    },
    tenant.currency,
    profiles.map((p) => p.id),
  );
  if (!result.ok) return { errors: result.errors };
  const { error } = await supabase.rpc("save_pricing_settings", {
    p_tenant_id: tenant.id,
    p_settings: result.payload as never,
  });
  if (error) return { errors: { form: await pricingErrorKey(error) } };
  refresh(slug);
  return { ok: true };
}

/** Adds a tax profile, or changes one's name or rate. */
export async function saveTaxProfile(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { slug, tenant, allowed, supabase } = await context(formData);
  if (!allowed) return notAllowed;
  const id = field(formData, "id");
  const name = field(formData, "name");
  const errors: Record<string, string> = {};
  const nameError = profileNameError(name);
  if (nameError) errors.name = nameError;
  const rate = parseRateBp(field(formData, "rate"));
  if (rate === null) errors.rate = "required";
  else if (rate === "invalid") errors.rate = "invalidRate";
  if (Object.keys(errors).length > 0) return { errors };
  const { error } = await supabase.rpc("save_tax_profile", {
    p_tenant_id: tenant.id,
    p_profile: { ...(id ? { id } : {}), name, rate_bp: rate } as never,
  });
  if (error) {
    const key =
      error.code === "23505" ? "profileNameExists" : await pricingErrorKey(error);
    return key === "profileNameExists"
      ? { errors: { name: key } }
      : { errors: { form: key } };
  }
  refresh(slug);
  return { ok: true };
}

/**
 * Removes a tax profile from use (archives it), or brings one back. Refused
 * while a product's pricing names it: the error names those products,
 * retired ones included, so the owner can move them first.
 */
export async function archiveTaxProfile(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { slug, tenant, allowed, supabase } = await context(formData);
  if (!allowed) return notAllowed;
  const id = field(formData, "id");
  const archived = field(formData, "archived") === "1";
  const { error } = await supabase.rpc("save_tax_profile", {
    p_tenant_id: tenant.id,
    p_profile: { id, archived } as never,
  });
  if (error) {
    const key = await pricingErrorKey(error);
    if (key === "taxProfileInUse") {
      const products = await productsUsingProfile(tenant.id, id);
      return {
        errors: { form: key },
        values: {
          count: products.length,
          names: products.map((p) => p.name).join(", "),
        },
      };
    }
    return { errors: { form: key } };
  }
  refresh(slug);
  return { ok: true };
}

/** One tap: the country's usual profile (Thailand: VAT 7%), as the default. */
export async function addUsualTaxProfile(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { slug, tenant, allowed, supabase } = await context(formData);
  if (!allowed) return notAllowed;
  const usual = usualTaxProfile(tenant.country);
  if (!usual) return { errors: { form: "saveFailed" } };
  const { data: id, error } = await supabase.rpc("save_tax_profile", {
    p_tenant_id: tenant.id,
    p_profile: { name: usual.name, rate_bp: usual.rateBp } as never,
  });
  if (error) {
    const key =
      error.code === "23505" ? "profileNameExists" : await pricingErrorKey(error);
    return { errors: { form: key } };
  }
  const { error: defaultError } = await supabase.rpc("save_pricing_settings", {
    p_tenant_id: tenant.id,
    p_settings: { default_tax_profile_id: id } as never,
  });
  // The profile is saved either way; say so if it couldn't become the default.
  if (defaultError) {
    refresh(slug);
    return { errors: { form: "profileAddedNotDefault" } };
  }
  refresh(slug);
  return { ok: true };
}
