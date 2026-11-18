import { execFileSync, spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@mango/db/database.types";
import type { Role } from "@/lib/roles";

/** Clients point at the `platform` schema, like the app (`.schema("public")` for the catalog). */
export type Db = SupabaseClient<Database, "platform">;

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(url ?? "")) {
  // Never run these against a hosted project: they create and delete users.
  throw new Error("DB tests only run against local Supabase (127.0.0.1)");
}

const options = {
  auth: { persistSession: false, autoRefreshToken: false },
  db: { schema: "platform" as const },
};

export function serviceClient(): Db {
  return createClient<Database, "platform">(url, serviceKey, options);
}

export function anonClient(): Db {
  return createClient<Database, "platform">(url, anonKey, options);
}

// One throwaway password per test run; the users are deleted afterwards.
const password = randomBytes(12).toString("hex");

export type TestUser = { id: string; email: string; db: Db };

/** Creates a confirmed user and returns a client signed in as them. */
export async function createUser(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@platform-test.test`;
  const service = serviceClient();
  const { data, error } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { name: `Test ${label}` },
  });
  if (error) throw error;

  const db = anonClient();
  const { error: signInError } = await db.auth.signInWithPassword({
    email,
    password,
  });
  if (signInError) throw signInError;
  return { id: data.user.id, email, db };
}

export type TestTenant = {
  id: string;
  slug: string;
  currency: string;
  /** The default location every tenant is created with. */
  locationId: string;
  members: Record<Role, TestUser & { membershipId: string }>;
};

/** A tenant (with its default location) and one user in every role. */
export async function createTenant(
  label: string,
  shop: {
    country: string;
    currency: string;
    locale: string;
    timezone: string;
  } = {
    country: "VN",
    currency: "VND",
    locale: "vi-VN",
    timezone: "Asia/Ho_Chi_Minh",
  },
): Promise<TestTenant> {
  const service = serviceClient();
  const slug = `${label}-${randomUUID().slice(0, 8)}`;
  const { data: tenantId, error } = await service.rpc("create_tenant", {
    p_name: `Test ${label}`,
    p_slug: slug,
    p_country: shop.country,
    p_currency: shop.currency,
    p_locale: shop.locale,
    p_timezone: shop.timezone,
  });
  if (error) throw error;
  const tenant = { id: tenantId };
  const { data: location, error: locationError } = await service
    .from("locations")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("is_default", true)
    .single();
  if (locationError) throw locationError;

  const roles: Role[] = ["owner", "manager", "staff", "mechanic", "driver"];
  const members = {} as TestTenant["members"];
  for (const role of roles) {
    const user = await createUser(`${label}-${role}`);
    const { data: membership, error: memberError } = await service
      .from("memberships")
      .insert({ tenant_id: tenant.id, user_id: user.id, role })
      .select("id")
      .single();
    if (memberError) throw memberError;
    members[role] = { ...user, membershipId: membership.id };
  }
  return {
    id: tenant.id,
    slug,
    currency: shop.currency,
    locationId: location.id,
    members,
  };
}

/**
 * Removes a tenant (memberships cascade) and its users.
 *
 * A tenant with audit rows can't be hard-deleted (20261119000100), and every
 * tenant has one from the moment it is created. So a test's tenant is
 * removed as the local database's superuser, its audit rows first, in one
 * transaction. Only tests do this: the app has no way to delete a tenant.
 */
export async function deleteTenant(tenant: TestTenant | undefined) {
  if (!tenant) return;
  if (!/^[0-9a-f-]{36}$/i.test(tenant.id)) {
    throw new Error(`Not a tenant id: ${tenant.id}`);
  }
  const service = serviceClient();
  const removed = sql(
    [
      "begin;",
      `delete from platform.audit_events where tenant_id = '${tenant.id}';`,
      `delete from platform.tenants where id = '${tenant.id}';`,
      "commit;",
    ].join("\n"),
  );
  if (removed.failed) {
    throw new Error(`deleteTenant ${tenant.id}: ${removed.failed}`);
  }
  for (const member of Object.values(tenant.members)) {
    await service.auth.admin.deleteUser(member.id);
  }
}

export async function deleteUser(user: TestUser | undefined) {
  if (user) await serviceClient().auth.admin.deleteUser(user.id);
}

/** An approved catalog entry to hang test models on; removed with removeCatalogEntry. */
export async function createCatalogEntry(label: string): Promise<string> {
  const { data, error } = await serviceClient()
    .schema("public")
    .from("bike_catalog")
    .insert({
      make: "Testmake",
      model: `${label} ${randomUUID().slice(0, 8)}`,
      type: "city_scooter",
      transmission: "automatic",
      cc: 125,
      status: "approved",
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id;
}

export async function removeCatalogEntry(id: string | undefined) {
  if (id)
    await serviceClient()
      .schema("public")
      .from("bike_catalog")
      .delete()
      .eq("id", id);
}

/** "[from, to)" as Postgres reads a time range; no `to` = open-ended. */
export function period(from: Date, to?: Date): string {
  return `[${from.toISOString()},${to ? to.toISOString() : ""})`;
}

export const hours = (n: number) => new Date(Date.now() + n * 3_600_000);

/**
 * A booking's block written by hand with the service role: makes the
 * reservation row an allocation must belong to (since 20261116000100) and
 * returns the block to insert. For setting a scene; a real booking is made
 * with platform.reserve().
 */
export async function allocationFor(
  tenantId: string,
  unitId: string,
  from: Date,
  to: Date,
) {
  const service = serviceClient();
  const unit = await service
    .from("units")
    .select("product_id, product_type, location_id")
    .eq("id", unitId)
    .single();
  if (unit.error) throw unit.error;
  const reservation = await service
    .from("reservations")
    .insert({
      tenant_id: tenantId,
      booking_id: randomUUID(),
      product_id: unit.data.product_id,
      product_type: unit.data.product_type,
      location_id: unit.data.location_id,
      starts_at: from.toISOString(),
      ends_at: to.toISOString(),
      block_period: period(from, to),
      quantity: 1,
      channel: "walk_in",
      mode: "staff",
      state: "reserved",
    })
    .select("id")
    .single();
  if (reservation.error) throw reservation.error;
  return {
    tenant_id: tenantId,
    unit_id: unitId,
    kind: "allocation",
    period: period(from, to),
    reservation_id: reservation.data.id as string | null,
  };
}

/**
 * A model row's own description. For a model on a catalog entry the database
 * replaces these with the entry's values; they are here so the row is complete.
 */
export const modelSpec = {
  make: "Testmake",
  model: "Test",
  vehicle_type: "motorbike",
  cc: 125,
  transmission: "automatic" as const,
};

/**
 * This checkout's local database container. Named after project_id in
 * supabase/config.toml, because another checkout of the repo may have its own
 * local database running beside this one.
 */
function dbContainer(): string {
  const config = readFileSync(
    fileURLToPath(new URL("../../../../supabase/config.toml", import.meta.url)),
    "utf8",
  );
  const project = /^project_id\s*=\s*"([^"]+)"/m.exec(config)?.[1];
  if (!project) throw new Error("No project_id in supabase/config.toml");
  const name = `supabase_db_${project}`;
  const running = execFileSync(
    "docker",
    ["ps", "--filter", `name=^${name}$`, "--format", "{{.Names}}"],
    { encoding: "utf8" },
  ).trim();
  if (running !== name)
    throw new Error(`The local Supabase database (${name}) isn't running`);
  return name;
}

/**
 * Runs SQL straight in the local database, as its superuser unless the SQL
 * itself switches role. For what the API can't reach: functions in the
 * platform_private schema. Returns psql's output; `failed` is its error text.
 */
export function sql(statements: string): { out: string; failed: string } {
  const container = dbContainer();
  const run = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { input: statements, encoding: "utf8" },
  );
  return { out: run.stdout.trim(), failed: run.status === 0 ? "" : run.stderr };
}

/** SQL run as a signed-in user, the way the API would run it. */
export function sqlAs(userId: string, statement: string) {
  const claims = JSON.stringify({ sub: userId, role: "authenticated" });
  return sql(
    [
      "begin;",
      `select set_config('request.jwt.claims', '${claims}', true);`,
      "set local role authenticated;",
      statement,
      "commit;",
    ].join("\n"),
  );
}

/**
 * Like sql(), but doesn't wait: for a second session that must run while
 * another holds a transaction open. Resolves when psql exits.
 */
export function sqlBackground(
  statements: string,
): Promise<{ out: string; failed: string }> {
  const container = dbContainer();
  return new Promise((resolve) => {
    const child = spawn("docker", [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-At",
      "-v",
      "ON_ERROR_STOP=1",
    ]);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) =>
      resolve({ out: out.trim(), failed: code === 0 ? "" : err }),
    );
    child.stdin.end(statements);
  });
}

// --------------------------------------------------------------------- gates
// A test that needs one session to hold its locks while another waits used
// to keep the holder open with pg_sleep(n) and race that clock. A gate has
// no clock: the holder waits at the gate after its writes, the test looks
// at whatever it needs to see for as long as that takes, and then opens the
// gate. Nothing depends on how fast the machine is.
//
// The gate is an advisory lock of its own class (not the booking functions'
// 1a01 and 1a02), held by a session of its own. A holder asks for it shared
// inside its transaction, so it waits there, locks and all, until the
// gate's session lets go.

/** The advisory-lock class of every gate. */
export const GATE_CLASS = 27262;

/**
 * In pg_stat_activity.query, what a session waiting at a gate is running.
 * For a poll that looks for "a session waiting for a lock" and must not
 * take the holder at its gate for one: `a.query not like '%${GATE_WAIT}%'`.
 */
export const GATE_WAIT = `pg_advisory_xact_lock_shared(${GATE_CLASS}`;

export type Gate = {
  /**
   * The statement a holder runs, inside its transaction, where pg_sleep()
   * used to be: it waits here until the gate is opened. `marker` is found
   * in pg_stat_activity.query, as it was with pg_sleep.
   */
  wait(marker: string): string;
  /** Lets every holder at the gate go on. Safe to call more than once. */
  open(): Promise<void>;
};

let gateCount = 0;
const gateBase = Math.floor(Math.random() * 1_000_000) * 1_000;

/** Runs `statement` until it answers `wanted`, 50 ms apart, 10 s at most. */
async function polled(statement: string, wanted: string, what: string) {
  for (let i = 0; i < 200; i++) {
    if (sql(statement).out === wanted) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Gave up waiting for ${what}`);
}

/**
 * A gate, closed. Open it when the test has seen what it came for; a test
 * that fails first leaves it to the ceiling below, so a holder never stays
 * in the database holding locks for the files that run next.
 */
export async function closedGate(): Promise<Gate> {
  const key = gateBase + ++gateCount;
  const child = spawn("docker", [
    "exec",
    "-i",
    dbContainer(),
    "psql",
    "-U",
    "postgres",
    "-At",
    "-v",
    "ON_ERROR_STOP=1",
  ]);
  const closed = new Promise<void>((resolve) =>
    child.on("close", () => resolve()),
  );
  child.stdout.resume();
  child.stderr.resume();
  child.stdin.write(`select pg_advisory_lock(${GATE_CLASS}, ${key});\n`);
  await polled(
    `select count(*) from pg_locks where locktype = 'advisory' and classid = ${GATE_CLASS} and objid = ${key} and mode = 'ExclusiveLock' and granted;`,
    "1",
    "a gate to close",
  );
  let opened = false;
  const open = async () => {
    if (!opened) {
      opened = true;
      // The session ends, and its lock with it.
      child.stdin.end(`select pg_advisory_unlock(${GATE_CLASS}, ${key});\n`);
    }
    await closed;
  };
  // Not part of any test's timing: only so that a failed test's holder is
  // let go. Longer than any test waits.
  setTimeout(() => void open(), 120_000).unref();
  return {
    wait: (marker) =>
      `select pg_advisory_xact_lock_shared(${GATE_CLASS}, ${key}) /* ${marker} */;`,
    open,
  };
}

/**
 * Waits until a session whose current statement contains `queryLike` is
 * waiting for a lock (and is not a holder at its gate). Polled with a
 * bound, never slept: the test goes on the moment it is so.
 */
export async function seenWaitingForLock(queryLike: string): Promise<void> {
  const text = queryLike.replaceAll("'", "''");
  await polled(
    `select (count(*) > 0)::text from pg_stat_activity a where a.wait_event_type = 'Lock' and a.query like '%${text}%' and a.query not like '%${GATE_WAIT}%' and a.pid <> pg_backend_pid();`,
    "true",
    `a session running ${queryLike} to wait for a lock`,
  );
}

/** A product's Moto Mangos listing under the names its settings had as columns. */
export type ListingValues = {
  marketplace_listed: boolean;
  instant_units: number;
  request_units: number;
  ready_now: number;
};

/**
 * The listing of a product (platform.product_listings), read with the
 * service role. A product that was never listed has no row: off and zero.
 */
export async function listingOf(productId: string): Promise<ListingValues> {
  const { data, error } = await serviceClient()
    .from("product_listings")
    .select("enabled, instant_units, request_units, ready_now")
    .eq("product_id", productId)
    .maybeSingle();
  if (error) throw error;
  return {
    marketplace_listed: data?.enabled ?? false,
    instant_units: data?.instant_units ?? 0,
    request_units: data?.request_units ?? 0,
    ready_now: data?.ready_now ?? 0,
  };
}

/**
 * Changes a product's listing as the signed-in user of `db`, through
 * platform.save_listing(): the only way a shop can. Only what is named
 * changes. `marketplace_listed` is the switch (`enabled` in the table).
 */
export function setListing(
  db: Db,
  productId: string,
  values: Partial<ListingValues> & { lead_time_hours?: number | null },
) {
  const { marketplace_listed, ...rest } = values;
  return db.rpc("save_listing", {
    p_product_id: productId,
    p_settings: {
      ...(marketplace_listed === undefined
        ? {}
        : { enabled: marketplace_listed }),
      ...rest,
    },
  });
}

/**
 * Writes a product's listing with the service role, past save_listing()'s
 * role check (the table's own guard still applies). For setting a scene.
 */
export function forceListing(
  tenantId: string,
  productId: string,
  values: Partial<ListingValues>,
) {
  const { marketplace_listed, ...rest } = values;
  return serviceClient()
    .from("product_listings")
    .upsert({
      tenant_id: tenantId,
      product_id: productId,
      ...(marketplace_listed === undefined
        ? {}
        : { enabled: marketplace_listed }),
      ...rest,
    })
    .select("product_id");
}
