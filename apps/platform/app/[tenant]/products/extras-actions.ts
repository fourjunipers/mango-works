"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/action-form";
import { saveExtrasList, type ExtrasDb } from "@/lib/extras-save";
import { requireMembership } from "@/lib/session";
import { createClient } from "@mango/db/platform-server";

const UUID = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

/**
 * Saves a list of extras from a vehicle's Extras tab (productId set) or
 * from Settings › Extras (productId empty: the list offered with every
 * vehicle), through platform.save_product_extras() as the signed-in
 * member. lib/extras-save.ts words the database's answer.
 */
export async function saveExtras(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const slug = String(formData.get("slug") ?? "");
  const productId = String(formData.get("productId") ?? "").trim();
  if (productId !== "" && !UUID.test(productId))
    return { errors: { form: "extrasProductNotFound" } };
  const { membership } = await requireMembership(slug);
  const supabase = await createClient();
  const answer = await saveExtrasList(
    supabase as unknown as ExtrasDb,
    membership.tenant.id,
    productId === "" ? null : productId,
    String(formData.get("extras") ?? ""),
  );
  if (!answer.ok) return { errors: answer.errors };
  revalidatePath(`/${slug}/products`, "layout");
  revalidatePath(`/${slug}/settings/extras`);
  return { ok: true };
}
