"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import {
  MULTIPLIER_STEP,
  computeList,
  daysPayload,
  listNameError,
  pricingPayload,
  readListDraft,
  readPricingDraft,
  sameAsSaved,
  suggestedStep,
  type ListKind,
  type ProductType,
} from "@/lib/pricing-form";
import { getProductPricingExtras, getSharedList } from "@/lib/pricing-data";
import { canPricing } from "@/lib/pricing-permissions";
import { requireMembership } from "@/lib/session";
import { createClient } from "@mango/db/platform-server";

/**
 * Pricing actions (docs/products-redesign.md §9.2, §9.12). Every write goes
 * through the stage D4 functions: save_product_pricing, save_price_template
 * and delete_price_template. Nothing here works out a price: the form's
 * values are checked and passed on, and the database checks them again.
 */

const notAllowed: FormState = { errors: { form: "notAllowed" } };
const field = (formData: FormData, name: string) =>
  String(formData.get(name) ?? "").trim();

/** The database's refusal in words (FormErrors keys). */
export async function pricingErrorKey(
  error: { code?: string; message?: string } | null,
): Promise<string> {
  const message = error?.message ?? "";
  const known: Record<string, string> = {
    price_list_falls: "priceListFalls",
    price_list_incomplete: "priceListIncomplete",
    price_list_in_use: "priceListInUse",
    price_list_kind_fixed: "priceListKindFixed",
    price_list_required: "priceListRequired",
    base_price_required: "basePriceRequired",
    price_required: "priceRequired",
    price_zero: "priceZero",
    pricing_method_not_allowed: "methodNotAllowed",
    deposit_vehicles_only: "depositVehiclesOnly",
    invalid_tax_profile: "invalidTaxProfile",
    price_templates_name_idx: "listNameExists",
    only_owner_or_manager: "notAllowed",
  };
  for (const [code, key] of Object.entries(known))
    if (message.includes(code)) return key;
  if (error?.code === "23505") return "listNameExists";
  if (error?.code === "42501") return "notAllowed";
  return "saveFailed";
}

async function context(formData: FormData) {
  const slug = field(formData, "slug");
  const { membership } = await requireMembership(slug);
  return {
    slug,
    tenant: membership.tenant,
    role: membership.role,
    supabase: await createClient(),
  };
}

function refresh(slug: string) {
  revalidatePath(`/${slug}/products`, "layout");
  revalidatePath(`/${slug}/fleet`, "layout");
}

/** The shop's rounding step: its own, or the one suggested for its currency. */
async function stepOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  tenantId: string,
  currency: string,
): Promise<bigint> {
  const { data } = await supabase
    .from("pricing_settings")
    .select("rounding_step::text")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  return data?.rounding_step
    ? BigInt(data.rounding_step)
    : suggestedStep(currency);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Saves a product's pricing from the Pricing tab. The form sends what was
 * typed; it is read again here with the same rules (lib/pricing-form.ts)
 * and sent to platform.save_product_pricing().
 *
 * A list that is on the form as it is saved is not sent again, so a save of
 * the deposit alone leaves the list's days as they are.
 *
 * Until the shop's settings have a screen (stage D6), a shop that enters
 * its first product deposit is set to "per product", as it was in stage D4.
 */
export async function saveProductPricing(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { slug, tenant, role, supabase } = await context(formData);
  if (!canPricing(role, "write")) return notAllowed;
  const productId = field(formData, "productId");
  const draft = readPricingDraft(parseJson(field(formData, "draft")));
  if (!productId || !draft) return { errors: { form: "saveFailed" } };

  const [product, settings, lists, profiles, extras] = await Promise.all([
    supabase
      .from("products")
      .select("id, type")
      .eq("tenant_id", tenant.id)
      .eq("id", productId)
      .maybeSingle(),
    supabase
      .from("pricing_settings")
      .select("rounding_step::text, deposit_mode")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    supabase
      .from("price_templates")
      .select("id, kind")
      .eq("tenant_id", tenant.id)
      .is("product_id", null),
    supabase
      .from("tax_profiles")
      .select("id")
      .eq("tenant_id", tenant.id)
      .is("archived_at", null),
    getProductPricingExtras(tenant.id, productId),
  ]);
  if (!product.data) return notAllowed;
  const type = product.data.type as ProductType;
  const mode = settings.data?.deposit_mode ?? null;
  const showDeposit =
    type === "vehicle" && (mode === null || mode === "per_product");
  const result = pricingPayload(draft, {
    type,
    currency: tenant.currency,
    step: settings.data?.rounding_step
      ? BigInt(settings.data.rounding_step)
      : suggestedStep(tenant.currency),
    sharedKinds: new Map(
      (lists.data ?? []).map((l) => [l.id, l.kind as ListKind]),
    ),
    showDeposit,
    showTax: (profiles.data ?? []).length > 0,
    savedOwn: extras.ownList,
  });
  if (!result.ok) return { errors: result.errors };

  const { error } = await supabase.rpc("save_product_pricing", {
    p_product_id: productId,
    p_settings: result.payload as never,
  });
  if (error) return { errors: { form: await pricingErrorKey(error) } };

  const deposit = result.payload.deposit;
  if (showDeposit && mode === null && deposit && deposit !== "0") {
    const { error: modeError } = await supabase.rpc("save_pricing_settings", {
      p_tenant_id: tenant.id,
      p_settings: { deposit_mode: "per_product" },
    });
    if (modeError)
      return { errors: { form: await pricingErrorKey(modeError) } };
  }
  refresh(slug);
  return { ok: true };
}

/**
 * Adds or changes a shared price list (platform.save_price_template()). A
 * new list asks its kind, which can't be changed afterwards.
 */
export async function savePriceList(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { slug, tenant, role, supabase } = await context(formData);
  if (!canPricing(role, "write")) return notAllowed;
  const id = field(formData, "id");
  const name = field(formData, "name");
  const nameError = listNameError(name);
  if (nameError) return { errors: { name: nameError } };
  const kind = field(formData, "kind") as ListKind;
  if (kind !== "amounts" && kind !== "multipliers")
    return { errors: { kind: "required" } };
  const draft = readListDraft(parseJson(field(formData, "list")));
  if (!draft) return { errors: { form: "saveFailed" } };
  const step =
    kind === "multipliers"
      ? MULTIPLIER_STEP
      : await stepOf(supabase, tenant.id, tenant.currency);
  const list = computeList(draft, kind, tenant.currency, step);
  if (!list.ok) return { errors: { form: "listNotReady" } };
  // A list that is as it was saved keeps its days: a new name alone
  // rewrites nothing and reprices nothing.
  const saved = id ? await getSharedList(tenant.id, id) : null;
  const unchanged = saved?.kind === kind && sameAsSaved(list, saved);

  const { data, error } = await supabase.rpc("save_price_template", {
    p_tenant_id: tenant.id,
    p_template: {
      ...(id ? { id } : { kind }),
      name,
      hourly: list.hourly === null ? null : String(list.hourly),
      ...(unchanged ? {} : { days: daysPayload(list) }),
    } as never,
  });
  if (error) {
    const key = await pricingErrorKey(error);
    return key === "listNameExists"
      ? { errors: { name: key } }
      : { errors: { form: key } };
  }
  refresh(slug);
  if (!id) redirect(`/${slug}/products/price-lists/${data}?added=1`);
  return { ok: true };
}

/** Deletes a shared price list. Refused while a product is priced from it. */
export async function deletePriceList(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { slug, role, supabase } = await context(formData);
  if (!canPricing(role, "write")) return notAllowed;
  const { error } = await supabase.rpc("delete_price_template", {
    p_template_id: field(formData, "id"),
  });
  if (error) return { errors: { form: await pricingErrorKey(error) } };
  refresh(slug);
  redirect(`/${slug}/products/price-lists?deleted=1`);
}
