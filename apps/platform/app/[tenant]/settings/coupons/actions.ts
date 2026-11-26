"use server";

import * as Sentry from "@sentry/nextjs";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { FormState } from "@/components/action-form";
import {
  couponChannels,
  couponPayload,
  couponSaveError,
  type CouponChannelChoice,
} from "@/lib/coupon-form";
import {
  saveCoupon,
  type CouponPayload,
  type CouponSaveDb,
} from "@/lib/coupon-save";
import { getLiveCouponByCode } from "@/lib/coupons-data";
import { canPricing } from "@/lib/pricing-permissions";
import { requireMembership } from "@/lib/session";
import { createClient } from "@mango/db/platform-server";

/**
 * Settings › Coupons (Phase 2 stage 9). Every write goes through
 * lib/coupon-save.ts' saveCoupon(), the one caller of
 * platform.save_coupon(): it answers `try_again` for a lock that ran out
 * (55P03), a statement the API ended (57014) and a deadlock (40P01), and
 * names the database's other refusals. The database decides who may (owners
 * and managers); the role check here only spares a round trip.
 */

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
  revalidatePath(`/${slug}/settings/coupons`, "layout");
}

const notAllowed: FormState = {
  errors: { form: "couponOnlyOwnerOrManager" },
};

/** saveCoupon(), with each refusal as words on the form. */
async function save(
  ctx: Awaited<ReturnType<typeof context>>,
  payload: CouponPayload,
): Promise<{ ok: true; id: string } | { ok: false; state: FormState }> {
  let answer: Awaited<ReturnType<typeof saveCoupon>>;
  try {
    answer = await saveCoupon(
      ctx.supabase as unknown as CouponSaveDb,
      ctx.tenant.id,
      payload,
    );
  } catch (error) {
    // An error no refusal names (saveCoupon() throws it): "Couldn't save" on
    // the form, not the error page. The save ran in one transaction, so
    // nothing was written. Sentry still hears of it (a no-op when it is off).
    Sentry.captureException(error);
    return { ok: false, state: { errors: { form: "saveFailed" } } };
  }
  if (answer.ok) return { ok: true, id: answer.coupon.id };
  const { field: where, key } = couponSaveError(answer.reason);
  if (answer.reason === "code_taken") {
    // Name the clash: the live coupon that has the code now.
    const code = payload.code ?? "";
    const other = code ? await getLiveCouponByCode(ctx.tenant.id, code) : null;
    return {
      ok: false,
      state: {
        errors: { [where]: other?.name ? "couponCodeTakenBy" : key },
        values: { code: other?.code ?? code, name: other?.name ?? "" },
      },
    };
  }
  return { ok: false, state: { errors: { [where]: key } } };
}

/** Creates a coupon, or changes one, from the form. */
export async function saveCouponForm(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await context(formData);
  if (!ctx.allowed) return notAllowed;
  const id = field(formData, "id");
  const result = couponPayload(
    {
      code: String(formData.get("code") ?? ""),
      name: field(formData, "name"),
      kind: field(formData, "kind") === "fixed" ? "fixed" : "percent",
      percent: field(formData, "percent"),
      amount: field(formData, "amount"),
      allProducts: field(formData, "scope") !== "chosen",
      productIds: formData.getAll("productIds").map(String),
      validFrom: field(formData, "validFrom"),
      validTo: field(formData, "validTo"),
      pickupFrom: field(formData, "pickupFrom"),
      pickupTo: field(formData, "pickupTo"),
      minDays: field(formData, "minDays"),
      minSpend: field(formData, "minSpend"),
      maxUses: field(formData, "maxUses"),
      channels: formData
        .getAll("channels")
        .map(String)
        .filter((c): c is CouponChannelChoice =>
          (couponChannels as readonly string[]).includes(c),
        ),
      withReturningDiscount: formData.get("withReturningDiscount") === "on",
      withSeasonDiscount: formData.get("withSeasonDiscount") === "on",
    },
    ctx.tenant.currency,
    id || undefined,
  );
  if (!result.ok) return { errors: result.errors };
  const saved = await save(ctx, result.payload);
  if (!saved.ok) return saved.state;
  refresh(ctx.slug);
  if (!id) redirect(`/${ctx.slug}/settings/coupons/${saved.id}?added=1`);
  return { ok: true };
}

/**
 * One button on the list or a coupon's page: "Switch off", "Switch on",
 * "Archive" or "Bring back". Sends only that setting.
 */
export async function setCouponState(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await context(formData);
  if (!ctx.allowed) return notAllowed;
  const id = field(formData, "id");
  const change = field(formData, "change");
  const payload: CouponPayload | null =
    change === "on"
      ? { id, active: true }
      : change === "off"
        ? { id, active: false }
        : change === "archive"
          ? { id, archived: true }
          : change === "restore"
            ? { id, archived: false, code: field(formData, "code") }
            : null;
  if (!id || !payload) return { errors: { form: "couponInvalid" } };
  const saved = await save(ctx, payload);
  if (!saved.ok) {
    // On a one-button form, a code refusal is shown over the form too.
    const state = saved.state;
    return state.errors?.code
      ? { ...state, errors: { form: state.errors.code } }
      : state;
  }
  refresh(ctx.slug);
  return { ok: true };
}
