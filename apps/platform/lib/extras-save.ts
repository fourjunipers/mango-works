import {
  extrasErrorKey,
  extrasErrors,
  extrasPayload,
  readExtrasForm,
} from "./extras";

/**
 * Saving a list of extras (a vehicle's, or the shop's "every vehicle"
 * list) through platform.save_product_extras(), the only writer.
 *
 * The database is the judge of who may: it raises only_owner_or_manager
 * for anyone else, and that is answered here in words, as is a lock that
 * could not be had in 6 seconds ("try again", lib/try-again.ts). The
 * screens hide the controls from staff, mechanics and drivers; this does
 * not rely on it.
 */

/** A signed-in member's client on the platform schema. */
export type ExtrasDb = {
  rpc(
    fn: "save_product_extras",
    args: {
      p_tenant_id: string;
      p_product_id: string | null;
      p_extras: unknown;
    },
  ): PromiseLike<{
    data: unknown;
    error: { code?: string; message: string } | null;
  }>;
};

export type ExtrasSaveAnswer =
  | { ok: true }
  | {
      ok: false;
      /** A FormErrors key: "form" for the whole list, or a line's box. */
      errors: Record<string, string>;
    };

/**
 * `productId`: the vehicle, or null for the list offered with every
 * vehicle. `form`: the editor's hidden JSON field, as sent.
 */
export async function saveExtrasList(
  db: ExtrasDb,
  tenantId: string,
  productId: string | null,
  form: string,
): Promise<ExtrasSaveAnswer> {
  const read = readExtrasForm(form);
  if (!read) return { ok: false, errors: { form: "extrasInvalid" } };
  // "Not offered" is a vehicle's: the shop's list has nothing to opt out of.
  if (productId === null && read.notOffered.length > 0)
    return { ok: false, errors: { form: "extrasInvalid" } };
  const payload = extrasPayload(read);
  if (!payload) {
    const errors: Record<string, string> = { form: "extrasCheckLines" };
    for (const error of extrasErrors(read.lines))
      errors[`${error.field}-${error.line}`] = error.key;
    return { ok: false, errors };
  }
  const { error } = await db.rpc("save_product_extras", {
    p_tenant_id: tenantId,
    p_product_id: productId,
    p_extras: payload,
  });
  if (error) return { ok: false, errors: { form: extrasErrorKey(error) } };
  return { ok: true };
}
