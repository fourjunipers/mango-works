import "server-only";
import type { User } from "@supabase/supabase-js";
import { createAdminClient } from "@mango/db/admin";
import { isAdminEmail, parseAdminEmails } from "./admin-emails";
import { exactlyOne } from "@mango/db/rows";

/**
 * Runs after every sign-in. Grants the admin role to verified emails listed
 * in ADMIN_EMAILS and removes it from anyone no longer listed.
 */
export async function syncRoleAfterSignIn(user: User): Promise<void> {
  const verified = !!user.email_confirmed_at;
  const shouldBeAdmin =
    verified &&
    isAdminEmail(user.email, parseAdminEmails(process.env.ADMIN_EMAILS));

  const db = createAdminClient();
  const { data: profile, error } = await exactlyOne(
    db.from("profiles").select("role").eq("id", user.id),
  );
  if (error) throw error;

  if (shouldBeAdmin && profile.role !== "admin") {
    await updateRole(db, user.id, "admin");
  } else if (!shouldBeAdmin && profile.role === "admin") {
    await removeAdminRole(user.id, db);
  }
}

/**
 * Takes the admin role from someone no longer listed in ADMIN_EMAILS: back
 * to shop staff if they are in a shop, otherwise a customer. Also called by
 * requireAdmin on every admin request (session.ts).
 */
export async function removeAdminRole(
  userId: string,
  db: ReturnType<typeof createAdminClient> = createAdminClient(),
): Promise<void> {
  const { count } = await db
    .from("shop_members")
    .select("*", { count: "exact", head: true })
    .eq("user_id", userId);
  await updateRole(db, userId, count ? "vendor_staff" : "customer");
}

async function updateRole(
  db: ReturnType<typeof createAdminClient>,
  userId: string,
  role: "admin" | "vendor_staff" | "customer",
) {
  const { error } = await db.from("profiles").update({ role }).eq("id", userId);
  if (error) throw error;
}
