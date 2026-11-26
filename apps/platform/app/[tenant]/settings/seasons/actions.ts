"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import { canPricing } from "@/lib/pricing-permissions";
import { seasonPayload, type Direction } from "@/lib/seasons";
import { requireMembership } from "@/lib/session";
import { createClient } from "@mango/db/platform-server";
import { pricingErrorKey } from "../../products/pricing-actions";

/**
 * Settings › Seasons (docs/products-redesign.md §9.5, stage D6). Adds,
 * changes, switches off and deletes a season through
 * platform.save_price_rule(); nothing writes a table.
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

/** Adds a season, or changes one. */
export async function saveSeason(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { slug, tenant, allowed, supabase } = await context(formData);
  if (!allowed) return notAllowed;
  const id = field(formData, "id");
  // Nothing is preselected on a new season: no choice is refused below.
  const typed = field(formData, "direction");
  const direction: Direction | null =
    typed === "increase" || typed === "decrease" ? typed : null;
  const result = seasonPayload(
    {
      name: field(formData, "name"),
      startsOn: field(formData, "startsOn"),
      endsOn: field(formData, "endsOn"),
      repeatsYearly: formData.get("repeatsYearly") === "on",
      direction,
      percent: field(formData, "percent"),
      allProducts: field(formData, "scope") !== "chosen",
      productIds: formData.getAll("productIds").map(String),
      active: formData.get("active") === "on",
    },
    id || undefined,
  );
  if (!result.ok) return { errors: result.errors };
  const { data, error } = await supabase.rpc("save_price_rule", {
    p_tenant_id: tenant.id,
    p_rule: result.payload as never,
  });
  if (error) return { errors: { form: await pricingErrorKey(error) } };
  refresh(slug);
  if (!id) redirect(`/${slug}/settings/seasons/${data}?added=1`);
  return { ok: true };
}

/** Deletes a season. Each product it covered says so in its History. */
export async function deleteSeason(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { slug, tenant, allowed, supabase } = await context(formData);
  if (!allowed) return notAllowed;
  const { error } = await supabase.rpc("save_price_rule", {
    p_tenant_id: tenant.id,
    p_rule: { id: field(formData, "id"), delete: true } as never,
  });
  if (error) return { errors: { form: await pricingErrorKey(error) } };
  refresh(slug);
  redirect(`/${slug}/settings/seasons?deleted=1`);
}
