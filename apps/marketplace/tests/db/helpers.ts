import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@mango/db/database.types";

export type Db = SupabaseClient<Database>;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!url?.startsWith("http://127.0.0.1")) {
  // Never run these against a hosted project: they create and delete users.
  throw new Error("DB tests only run against local Supabase (127.0.0.1)");
}

const options = { auth: { persistSession: false, autoRefreshToken: false } };

/** Seeded IDs (supabase/seed.sql). */
export const seed = {
  users: {
    admin: "admin@bike-booking.test",
    customer: "customer@bike-booking.test",
    bsrOwner: "owner@bsr.test",
    bsrStaff: "staff@bsr.test",
    draftOwner: "owner@draft-shop.test",
  },
  customerId: "a0000000-0000-4000-8000-000000000002",
  bsrShop: "b0000000-0000-4000-8000-000000000001",
  draftShop: "b0000000-0000-4000-8000-000000000002",
  bsrPcx: "c0000000-0000-4000-8000-000000000002",
  draftModel: "c0000000-0000-4000-8000-000000000004",
  booking: "d0000000-0000-4000-8000-000000000001",
} as const;

export function serviceClient(): Db {
  return createClient<Database>(url, serviceKey, options);
}

export function anonClient(): Db {
  return createClient<Database>(url, anonKey, options);
}

/** A client signed in as `email`, using an admin-generated magic link. */
export async function signedInClient(email: string): Promise<Db> {
  const { data, error } = await serviceClient().auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw error;

  const client = anonClient();
  const { error: verifyError } = await client.auth.verifyOtp({
    type: "email",
    token_hash: data.properties.hashed_token,
  });
  if (verifyError) throw verifyError;
  return client;
}

/** Creates a confirmed user for one test file; delete it with deleteUser. */
export async function createUser(prefix: string) {
  const email = `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@bike-booking.test`;
  const { data, error } = await serviceClient().auth.admin.createUser({
    email,
    email_confirm: true,
  });
  if (error) throw error;
  return { id: data.user.id, email };
}

export async function deleteUser(id: string) {
  await serviceClient().auth.admin.deleteUser(id);
}

/**
 * Bangkok calendar date `days` from today, "YYYY-MM-DD". The seeded booking
 * (K7Q4ZP) holds BSR's only PCX from bangkokDay(-2) to bangkokDay(12).
 */
export function bangkokDay(days: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok" }).format(
    Date.now() + days * 86_400_000,
  );
}

/**
 * Removes a platform tenant a test created.
 *
 * A tenant with audit rows can't be hard-deleted, and no audit row can be
 * deleted (20261120000200); every tenant has one from the moment it is
 * created. So, as the platform's own test helper does, the tenant is removed
 * as the local database's superuser: its audit rows first, with the table's
 * triggers switched off for that one statement (session_replication_role,
 * which only a superuser may set), then the tenant, in one transaction, with
 * a short lock timeout so that it fails rather than waits. Throws if it could
 * not. Only tests do this; no app can delete a tenant.
 */
export async function deleteTenant(tenantId: string | undefined) {
  if (!tenantId) return;
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) {
    throw new Error(`Not a tenant id: ${tenantId}`);
  }
  // This checkout's local database container, named after project_id in
  // supabase/config.toml (another checkout may run its own beside it).
  const config = readFileSync(
    fileURLToPath(new URL("../../../../supabase/config.toml", import.meta.url)),
    "utf8",
  );
  const project = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (!project) throw new Error("No project_id in supabase/config.toml");
  const statements = [
    "begin;",
    "set local lock_timeout = '5s';",
    "set local session_replication_role = replica;",
    `delete from platform.audit_events where tenant_id = '${tenantId}';`,
    "set local session_replication_role = origin;",
    `delete from platform.tenants where id = '${tenantId}';`,
    "commit;",
  ].join("\n");
  const failed = await new Promise<string>((resolve) => {
    const child = spawn("docker", [
      "exec",
      "-i",
      `supabase_db_${project}`,
      "psql",
      "-U",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ]);
    let err = "";
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("error", (error) => resolve(String(error)));
    child.on("close", (code) =>
      resolve(code === 0 ? "" : err || `exit ${code}`),
    );
    child.stdin.end(statements);
  });
  if (failed) throw new Error(`deleteTenant ${tenantId}: ${failed}`);
}
