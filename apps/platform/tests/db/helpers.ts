import {
  execFileSync,
  spawn,
  spawnSync,
  type ChildProcess,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, afterEach } from "vitest";
import type { Database } from "@mango/db/database.types";
import type { Role } from "@/lib/roles";
import { atMostOne, exactlyOne } from "@mango/db/rows";

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
  const { data: location, error: locationError } = await exactlyOne(
    service
      .from("locations")
      .select("id")
      .eq("tenant_id", tenant.id)
      .eq("is_default", true),
  );
  if (locationError) throw locationError;

  const roles: Role[] = ["owner", "manager", "staff", "mechanic", "driver"];
  const members = {} as TestTenant["members"];
  for (const role of roles) {
    const user = await createUser(`${label}-${role}`);
    const { data: membership, error: memberError } = await exactlyOne(
      service
        .from("memberships")
        .insert({ tenant_id: tenant.id, user_id: user.id, role })
        .select("id"),
    );
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
 * transaction, with a lock timeout of 5 seconds so that it fails rather
 * than waits. Only tests do this: the app has no way to delete a tenant.
 *
 * No audit row can be deleted either (20261120000200: the table's own
 * triggers refuse it, its owner included), so the audit rows go with those
 * triggers switched off for that one statement (session_replication_role,
 * which only a superuser may set).
 */
export async function deleteTenant(tenant: TestTenant | undefined) {
  if (!tenant) return;
  if (!/^[0-9a-f-]{36}$/i.test(tenant.id)) {
    throw new Error(`Not a tenant id: ${tenant.id}`);
  }
  const service = serviceClient();
  // In a session of its own, never blocking this process, and with a short
  // lock timeout: if something still holds one of the shop's rows, this
  // fails loudly and soon rather than wait behind it.
  const removed = await sqlBackground(
    [
      "begin;",
      "set local lock_timeout = '5s';",
      "set local session_replication_role = replica;",
      `delete from platform.audit_events where tenant_id = '${tenant.id}';`,
      "set local session_replication_role = origin;",
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
  const { data, error } = await exactlyOne(
    serviceClient()
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
      .select("id"),
  );
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
  const unit = await exactlyOne(
    service
      .from("units")
      .select("product_id, product_type, location_id")
      .eq("id", unitId),
  );
  if (unit.error) throw unit.error;
  const reservation = await exactlyOne(
    service
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
      .select("id"),
  );
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
let container: string | undefined;
function dbContainer(): string {
  if (container) return container;
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
  return (container = name);
}

/**
 * Every psql session a test file opens carries this application_name, so
 * that the file can end, after each test, whatever session a failed test
 * left behind (leftSessions(), and the afterEach below).
 */
const SESSION_NAME = `platform-db-test-${randomUUID().slice(0, 8)}`;

const psql = () => [
  "exec",
  "-i",
  "-e",
  `PGAPPNAME=${SESSION_NAME}`,
  dbContainer(),
  "psql",
  "-U",
  "postgres",
  "-At",
];

/**
 * Runs SQL straight in the local database, as its superuser unless the SQL
 * itself switches role. For what the API can't reach: functions in the
 * platform_private schema. Returns psql's output; `failed` is its error text.
 *
 * It blocks this process until psql answers. Never use it to look at the
 * database while a call of the test's own is on its way there (the call
 * can't be sent while this waits), and never for anything that may wait for
 * a lock: use watch() or sqlBackground() for those.
 */
export function sql(statements: string): { out: string; failed: string } {
  const run = spawnSync("docker", [...psql(), "-v", "ON_ERROR_STOP=1"], {
    input: statements,
    encoding: "utf8",
  });
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

/** The psql sessions this file has open: holders, waiters, gates. */
const sessions = new Set<ChildProcess>();

/**
 * Like sql(), but doesn't wait: for a second session that must run while
 * another holds a transaction open. Resolves when psql exits.
 */
export function sqlBackground(
  statements: string,
): Promise<{ out: string; failed: string }> {
  return new Promise((resolve) => {
    const child = spawn("docker", [...psql(), "-v", "ON_ERROR_STOP=1"]);
    sessions.add(child);
    let out = "";
    let err = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (err += chunk));
    child.on("close", (code) => {
      sessions.delete(child);
      resolve({ out: out.trim(), failed: code === 0 ? "" : err });
    });
    child.stdin.end(statements);
  });
}

// ------------------------------------------------------------------ watching
// Looking at the database while a test's own call is in flight (is a session
// waiting for a lock? is the holder still at its gate?) goes through one
// psql session that stays open for the whole file. It answers in
// milliseconds whatever the machine is doing, where a new `docker exec` per
// look costs a second or more on a busy one; and it never blocks this
// process, so the call being watched can be sent in the meantime.

type Watcher = {
  child: ChildProcessWithoutNullStreams;
  /** One look at a time: each waits for the one before it. */
  last: Promise<unknown>;
};
let watcher: Watcher | undefined;
let looks = 0;

function watcherSession(): Watcher {
  if (watcher && watcher.child.exitCode === null) return watcher;
  const child = spawn("docker", psql());
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  return (watcher = { child, last: Promise.resolve() });
}

/**
 * Runs `statements` in the file's watching session and answers what they
 * printed. Never blocks this process. `failed` is what psql wrote as errors.
 * For reads that do not wait for a lock; anything that may wait goes in a
 * session of its own (sqlBackground).
 */
export function watch(
  statements: string,
): Promise<{ out: string; failed: string }> {
  const session = watcherSession();
  const mark = `<<look ${++looks}>>`;
  const run = session.last.then(
    () =>
      new Promise<{ out: string; failed: string }>((resolve, reject) => {
        const { child } = session;
        let out = "";
        let err = "";
        const done = (result: { out: string; failed: string } | Error) => {
          child.stdout.off("data", onOut);
          child.stderr.off("data", onErr);
          child.off("close", onClose);
          if (result instanceof Error) reject(result);
          else resolve(result);
        };
        const onOut = (chunk: string) => {
          out += chunk;
          const at = out.indexOf(mark);
          if (at < 0) return;
          // Errors come down another pipe: give them a moment to arrive.
          setTimeout(
            () => done({ out: out.slice(0, at).trim(), failed: err.trim() }),
            15,
          );
        };
        const onErr = (chunk: string) => (err += chunk);
        const onClose = () =>
          done(new Error(`The watching session ended: ${err}`));
        child.stdout.on("data", onOut);
        child.stderr.on("data", onErr);
        child.on("close", onClose);
        child.stdin.write(`${statements}\n;\nselect '${mark}';\n`);
      }),
  );
  session.last = run.catch(() => undefined);
  return run;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The longest a poll looks for a session that is waiting for a lock. Inside
 * the 6-second lock_timeout of the booking functions and the API's 8
 * seconds: past it the waiting call has given up, and nothing is left to
 * see.
 */
export const WAIT_SEEN_WITHIN = 5_000;

/**
 * Polls `statement` in the watching session until `done` says its answer
 * is the one wanted; at least twice, 25 ms apart, for `within` ms at most.
 */
async function polled(
  statement: string,
  done: (out: string) => boolean,
  what: string,
  within: number,
): Promise<string> {
  const deadline = Date.now() + within;
  let last = "";
  for (let i = 0; i < 2 || Date.now() < deadline; i++) {
    const { out, failed } = await watch(statement);
    if (failed) throw new Error(`Looking for ${what}: ${failed}`);
    if (done(out)) return out;
    last = out;
    await pause(25);
  }
  throw new Error(
    `Gave up after ${within} ms waiting for ${what}${last ? ` (last answer: ${last})` : ""}`,
  );
}

/**
 * Waits until another session is running a statement that carries
 * `marker`: a holder has reached its gate. If `session` is that holder and
 * it ends first, says why at once.
 */
export async function holding(
  marker: string,
  session?: Promise<{ out: string; failed: string }>,
): Promise<void> {
  let ended: { out: string; failed: string } | undefined;
  void session?.then((result) => (ended = result));
  const text = marker.replaceAll("'", "''");
  await polled(
    `select count(*) from pg_stat_activity where state = 'active' and query like '%${text}%' and pid <> pg_backend_pid();`,
    (out) => {
      if (ended)
        throw new Error(
          `The session ended before ${marker}: ${ended.failed || ended.out}`,
        );
      return out === "1";
    },
    `a session to reach ${marker}`,
    20_000,
  );
}

/**
 * The session carrying `marker` is still at its gate, its locks in hand:
 * whatever answered before this did not wait for it.
 */
export async function stillHolding(marker: string): Promise<void> {
  const text = marker.replaceAll("'", "''");
  const { out, failed } = await watch(
    `select count(*) from pg_stat_activity where query like '%${text}%' and state = 'active' and pid <> pg_backend_pid();`,
  );
  if (failed || out !== "1")
    throw new Error(
      `The holder ${marker} is no longer at its gate (${failed || out})`,
    );
}

/**
 * Polls `statement` until it answers something other than an empty string,
 * and answers that. For a look at a call that is waiting for a lock, so
 * bounded like seenWaitingForLock().
 */
export function until(
  statement: string,
  within = WAIT_SEEN_WITHIN,
): Promise<string> {
  return polled(
    statement,
    (out) => out !== "",
    `"${statement.trim().replace(/\s+/g, " ").slice(0, 120)}"`,
    within,
  );
}

// --------------------------------------------------------------------- gates
// A test that needs one session to hold its locks while another waits used
// to keep the holder open with pg_sleep(n) and race that clock. A gate has
// no clock: the holder waits at the gate after its writes, the test looks
// at whatever it needs to see for as long as that takes, and then opens the
// gate.
//
// The gate is an advisory lock of its own class (not the booking functions'
// 1a01 and 1a02), held by a session of its own. A holder asks for it shared
// inside its transaction, so it waits there, locks and all, until the
// gate's session lets go.
//
// No test can leave a holder at its gate: every gate is kept in a list here,
// and an afterEach registered by this file opens them all, waits for the
// sessions the test opened to end, and ends any that has not (endOfTest()).
// A test that fails half-way therefore goes red, and the next one starts
// with nothing held.

/** The advisory-lock class of every gate. */
export const GATE_CLASS = 27262;

/**
 * In pg_stat_activity.query, what a session waiting at a gate is running.
 * For a poll that looks for "a session waiting for a lock" and must not
 * take the holder at its gate for one: `a.query not like '%${GATE_WAIT}%'`.
 */
export const GATE_WAIT = `pg_advisory_xact_lock_shared(${GATE_CLASS}`;

/**
 * The timeout of a test that uses a gate, and of the hooks around it. Sized
 * for a busy machine: such a test opens several database sessions, each a
 * `docker exec` that can take seconds to start there. A file with gate
 * tests sets it at its top: `vi.setConfig(GATE_TIMEOUTS)`.
 */
export const GATE_TEST_TIMEOUT = 60_000;
export const GATE_TIMEOUTS = {
  testTimeout: GATE_TEST_TIMEOUT,
  hookTimeout: GATE_TEST_TIMEOUT,
};

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
/** Every gate that is still closed. */
const closedGates = new Set<Gate>();

/**
 * A gate, closed. Open it when the test has seen what it came for. A test
 * that fails first leaves it to this file's afterEach, which opens every
 * gate still closed.
 */
export async function closedGate(): Promise<Gate> {
  const key = gateBase + ++gateCount;
  const child = spawn("docker", [...psql(), "-v", "ON_ERROR_STOP=1"]);
  sessions.add(child);
  const closed = new Promise<void>((resolve) =>
    child.on("close", () => {
      sessions.delete(child);
      resolve();
    }),
  );
  child.stderr.resume();
  // The session says so itself once it has the lock: nothing to poll.
  const locked = new Promise<void>((resolve, reject) => {
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
      if (out.includes("gate closed")) resolve();
    });
    void closed.then(() => reject(new Error("A gate's session ended early")));
  });
  child.stdin.write(
    `select pg_advisory_lock(${GATE_CLASS}, ${key});\nselect 'gate closed';\n`,
  );
  let opened = false;
  const gate: Gate = {
    wait: (marker) =>
      `select pg_advisory_xact_lock_shared(${GATE_CLASS}, ${key}) /* ${marker} */;`,
    open: async () => {
      if (!opened) {
        opened = true;
        closedGates.delete(gate);
        // The session ends, and its lock with it.
        child.stdin.end(`select pg_advisory_unlock(${GATE_CLASS}, ${key});\n`);
      }
      await closed;
    },
  };
  closedGates.add(gate);
  await locked;
  return gate;
}

/**
 * Waits until a session whose current statement contains `queryLike` is
 * waiting for a lock (and is not a holder at its gate). Polled with a
 * bound, never slept: the test goes on the moment it is so.
 */
export async function seenWaitingForLock(
  queryLike: string,
  within = WAIT_SEEN_WITHIN,
): Promise<void> {
  const text = queryLike.replaceAll("'", "''");
  await polled(
    `select (count(*) > 0)::text from pg_stat_activity a where a.wait_event_type = 'Lock' and a.query like '%${text}%' and a.query not like '%${GATE_WAIT}%' and a.pid <> pg_backend_pid();`,
    (out) => out === "true",
    `a session running ${queryLike} to wait for a lock`,
    within,
  );
}

/** The sessions of this file that are still in the database, as text. */
export async function leftSessions(): Promise<string> {
  const { out } = await watch(
    `select pid || ' ' || state || ' ' || coalesce(wait_event_type, '-') || ' ' || left(query, 80) from pg_stat_activity where application_name = '${SESSION_NAME}' and pid <> pg_backend_pid();`,
  );
  return out;
}

/**
 * After every test: opens each gate still closed, gives the sessions the
 * test opened ten seconds to finish, then ends in the database whichever
 * has not. So a test that failed with a holder at its gate, or a call still
 * waiting, leaves nothing that the next test or the file's clean-up could
 * wait behind.
 */
async function endOfTest() {
  await Promise.all([...closedGates].map((gate) => gate.open()));
  const deadline = Date.now() + 10_000;
  while (sessions.size > 0 && Date.now() < deadline) await pause(25);
  if (sessions.size === 0) return;
  const left = await leftSessions();
  await watch(
    `select pg_terminate_backend(pid) from pg_stat_activity where application_name = '${SESSION_NAME}' and pid <> pg_backend_pid();`,
  );
  for (const child of sessions) child.kill();
  sessions.clear();
  console.warn(`Ended sessions a test left behind:\n${left}`);
}

afterEach(endOfTest);
afterAll(() => {
  watcher?.child.stdin.end();
  watcher = undefined;
});

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
  const { data, error } = await atMostOne(
    serviceClient()
      .from("product_listings")
      .select("enabled, instant_units, request_units, ready_now")
      .eq("product_id", productId),
  );
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

// ---------------------------------------------------------------------------
// Phase 2's bookings, through create_order() (Phase 3 stage 2b).
//
// platform.reserve() is gone: every booking is an order. Phase 2's tests
// were written as "N units of a product on one line"; an order takes one
// line per vehicle (a vehicle rental is one bike, decision 2). So that the
// ported tests keep their requests, rounds and outcomes, bookingOrder()
// turns a Phase 2 request into create_order()'s (a vehicle line for N bikes
// becomes N lines; `hold` becomes the action; a coupon's customer becomes
// the order's), and bookingAnswer() folds the answer back to one entry per
// line the test sent.

export type BookingLine = {
  product_id?: unknown;
  quantity?: unknown;
  parent?: unknown;
  unit_ids?: unknown;
  [key: string]: unknown;
};

export type BookingRequest = {
  channel?: unknown;
  mode?: unknown;
  hold?: unknown;
  lines?: unknown;
  coupon?: unknown;
  [key: string]: unknown;
};

export type BookedLine = {
  /** The line's first (for gear and services, only) reservation and rental. */
  reservation_id: string;
  rental_id: string;
  /** One per bike for a vehicle line; one for anything else. */
  reservation_ids: string[];
  rental_ids: string[];
  unit_ids: string[];
  shortage: number;
};

export type BookingAnswer =
  | {
      ok: true;
      /** The order's id: reservations.booking_id. */
      booking_id: string;
      order_id: string;
      number: number;
      code: string;
      status: string;
      hold_expires_at?: string;
      repeat?: boolean;
      lines: BookedLine[];
    }
  | { ok: false; reason: string; line: number | null };

export type BookingResult = {
  data: BookingAnswer | null;
  error: { code?: string; message?: string } | null;
};

const vehicleProducts = new Map<string, boolean>();

async function vehiclesAmong(ids: string[]): Promise<void> {
  const unknown = [...new Set(ids)].filter((id) => !vehicleProducts.has(id));
  if (unknown.length === 0) return;
  const { data, error } = await serviceClient()
    .from("products")
    .select("id, type")
    .in("id", unknown);
  if (error) throw error;
  for (const row of data) vehicleProducts.set(row.id, row.type === "vehicle");
}

const isUuid = (value: unknown): value is string =>
  typeof value === "string" &&
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export type BookingOrder = {
  /** create_order()'s p_order. */
  order: Record<string, unknown>;
  /** For each line sent to create_order(), the index of the test's line. */
  from: number[];
};

/**
 * A Phase 2 request as create_order()'s p_order. Anything it does not
 * understand is passed on as it is, so a malformed request still reaches the
 * database to be refused there.
 */
export async function bookingOrder(
  request: BookingRequest,
): Promise<BookingOrder> {
  const { hold, lines, coupon, ...rest } = request;
  const order: Record<string, unknown> = { ...rest };
  if (!("action" in order)) {
    if (hold === true) order.action = "hold";
    else if (hold === undefined || hold === false || hold === null)
      order.action = "reserve";
    // Not a boolean: sent on, to be refused.
    else order.action = hold;
  }
  if (coupon !== undefined) {
    if (
      coupon !== null &&
      typeof coupon === "object" &&
      !Array.isArray(coupon)
    ) {
      const { customer_id, ...use } = coupon as Record<string, unknown>;
      order.coupon = use;
      if (customer_id !== undefined && !("customer_id" in order))
        order.customer_id = customer_id;
    } else order.coupon = coupon;
  }
  const from: number[] = [];
  if (!Array.isArray(lines)) {
    if (lines !== undefined) order.lines = lines;
    return { order, from };
  }
  const plain = (line: unknown): line is BookingLine =>
    line !== null && typeof line === "object" && !Array.isArray(line);
  await vehiclesAmong(
    lines.flatMap((line) =>
      plain(line) && isUuid(line.product_id) ? [line.product_id] : [],
    ),
  );
  /** Where each of the test's lines starts in what is sent. */
  const first: number[] = [];
  const sent: unknown[] = [];
  lines.forEach((line, index) => {
    first[index] = sent.length;
    if (!plain(line)) {
      sent.push(line);
      from.push(index);
      return;
    }
    const mapped: BookingLine = { ...line };
    if (
      typeof line.parent === "number" &&
      Number.isInteger(line.parent) &&
      line.parent >= 0 &&
      line.parent < index
    ) {
      mapped.parent = first[line.parent];
    }
    const many =
      isUuid(line.product_id) &&
      vehicleProducts.get(line.product_id) === true &&
      typeof line.quantity === "number" &&
      Number.isInteger(line.quantity) &&
      line.quantity >= 2 &&
      line.quantity <= 1000;
    // Units named for a line of N bikes: one each, when there are N of them
    // and no two are the same (else sent whole, to be refused).
    const named = Array.isArray(line.unit_ids) ? line.unit_ids : null;
    if (
      !many ||
      (named !== null &&
        (named.length !== line.quantity ||
          new Set(named).size !== named.length))
    ) {
      sent.push(mapped);
      from.push(index);
      return;
    }
    for (let n = 0; n < (line.quantity as number); n++) {
      sent.push({
        ...mapped,
        quantity: 1,
        ...(named === null ? {} : { unit_ids: [named[n]] }),
      });
      from.push(index);
    }
  });
  order.lines = sent;
  return { order, from };
}

/** create_order()'s answer, folded back to one entry per line of the test. */
export function bookingAnswer(
  answer: unknown,
  from: readonly number[],
): BookingAnswer | null {
  if (answer === null || typeof answer !== "object") return null;
  const raw = answer as Record<string, unknown>;
  if (raw.ok !== true) {
    const line = raw.line;
    return {
      ...(raw as { ok: false; reason: string }),
      line: typeof line === "number" ? (from[line] ?? line) : null,
    };
  }
  const lines: BookedLine[] = [];
  (
    raw.lines as {
      rental_id: string;
      reservation_id: string;
      unit_ids: string[];
      shortage: number;
    }[]
  ).forEach((line, sentIndex) => {
    const index = from[sentIndex] ?? sentIndex;
    const entry = (lines[index] ??= {
      reservation_id: line.reservation_id,
      rental_id: line.rental_id,
      reservation_ids: [],
      rental_ids: [],
      unit_ids: [],
      shortage: 0,
    });
    entry.reservation_ids.push(line.reservation_id);
    entry.rental_ids.push(line.rental_id);
    entry.unit_ids.push(...line.unit_ids);
    entry.shortage += line.shortage;
  });
  return {
    ...(raw as Extract<BookingAnswer, { ok: true }>),
    booking_id: raw.order_id as string,
    lines,
  };
}

/** Phase 2's reserve(tenant, request), as an order. */
export async function createOrder(
  client: Db,
  tenantId: string,
  request: BookingRequest,
): Promise<BookingResult> {
  const { order, from } = await bookingOrder(request);
  const { data, error } = await client.rpc("create_order", {
    p_tenant_id: tenantId,
    p_order: order as never,
  });
  return { data: error ? null : bookingAnswer(data, from), error };
}

/**
 * The SQL text of the same call, for a session held at a gate. Its answer is
 * create_order()'s own (not folded back).
 */
export async function createOrderSql(
  tenantId: string,
  request: BookingRequest,
): Promise<string> {
  const { order } = await bookingOrder(request);
  return `platform.create_order('${tenantId}', '${JSON.stringify(order).replaceAll("'", "''")}'::jsonb)`;
}

/** A customer of the shop, made with the service role. */
export async function createCustomer(
  tenantId: string,
  fullName = `Customer ${Math.random().toString(36).slice(2, 8)}`,
): Promise<string> {
  const row = await serviceClient()
    .from("customers")
    .insert({ tenant_id: tenantId, full_name: fullName })
    .select("id");
  if (row.error) throw row.error;
  return row.data[0].id;
}

export type CancelAnswer =
  | {
      ok: true;
      /** The order's id (the functions answer it as order_id). */
      booking_id: string;
      reservation_ids: string[];
    }
  | { ok: false; reason: string };

export type CancelResult = {
  data: CancelAnswer | null;
  error: { code?: string; message?: string } | null;
};

const withBookingId = (answer: unknown): CancelAnswer | null => {
  if (answer === null || typeof answer !== "object") return null;
  const { order_id, ...raw } = answer as Record<string, unknown>;
  return (
    raw.ok === true ? { booking_id: order_id, ...raw } : raw
  ) as CancelAnswer;
};

/** Phase 2's cancel_reservation(booking), as cancel_order(). */
export async function cancelOrder(
  client: Db,
  tenantId: string,
  orderId: string | undefined,
): Promise<CancelResult> {
  const { data, error } = await client.rpc("cancel_order", {
    p_tenant_id: tenantId,
    // None: sent as null, to be refused there.
    p_order_id: (orderId ?? null) as string,
  });
  return { data: error ? null : withBookingId(data), error };
}

/**
 * Phase 2's cancel_reservation(reservation): one row with its extras. Its
 * order function is cancel_rental() (migration 6); until then only the
 * private core does it, so the test calls the core as the database's owner.
 * Who may cancel is tested on cancel_order().
 */
export function cancelReservationCore(
  tenantId: string,
  reservationId: string,
): CancelResult {
  const { out, failed } = sql(`
    select platform_private.cancel_reservation(
      '${tenantId}',
      coalesce(
        (select r.booking_id from platform.reservations r where r.id = '${reservationId}'),
        '00000000-0000-0000-0000-000000000000'),
      '${reservationId}', 'shop', 'shop_request')::text;`);
  if (failed) return { data: null, error: { message: failed } };
  return { data: withBookingId(JSON.parse(out.split("\n").pop()!)), error: null };
}

/**
 * createOrderSql() without the look-up: for a request that already has one
 * bike per vehicle line, where the SQL text is needed at once.
 */
export function orderSql(tenantId: string, request: BookingRequest): string {
  const { hold, coupon, ...rest } = request;
  const order: Record<string, unknown> = {
    ...rest,
    action: hold === true ? "hold" : "reserve",
  };
  if (coupon !== undefined && coupon !== null) {
    const { customer_id, ...use } = coupon as Record<string, unknown>;
    order.coupon = use;
    if (customer_id !== undefined) order.customer_id = customer_id;
  }
  return `platform.create_order('${tenantId}', '${JSON.stringify(order).replaceAll("'", "''")}'::jsonb)`;
}

const CODE_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/**
 * An order with one rental, written by hand with the service role: for a
 * test that then writes a reservation by hand (a reservation must have a
 * rental of its own order). The number is far above any the counter gives.
 */
export async function orderWithRental(
  tenantId: string,
  rental: {
    product_id: string;
    product_type?: "vehicle" | "gear" | "service";
    location_id: string;
    starts_at: string;
    ends_at: string;
    quantity?: number;
  },
  order: { channel?: string; mode?: string; status?: string } = {},
): Promise<{ orderId: string; rentalId: string }> {
  const service = serviceClient();
  const tenant = await service
    .from("tenants")
    .select("currency")
    .eq("id", tenantId);
  if (tenant.error) throw tenant.error;
  const made = await service
    .from("orders")
    .insert({
      tenant_id: tenantId,
      code: Array.from(
        { length: 6 },
        () => CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)],
      ).join(""),
      number: 1_000_000_000 + Math.floor(Math.random() * 1_000_000_000),
      status: order.status ?? "booked",
      channel: order.channel ?? "walk_in",
      mode: order.mode ?? "staff",
      currency: tenant.data[0].currency,
    })
    .select("id");
  if (made.error) throw made.error;
  const orderId = made.data[0].id;
  const row = await service
    .from("rentals")
    .insert({
      tenant_id: tenantId,
      order_id: orderId,
      product_id: rental.product_id,
      product_type: rental.product_type ?? "vehicle",
      location_id: rental.location_id,
      quantity: rental.quantity ?? 1,
      starts_at: rental.starts_at,
      ends_at: rental.ends_at,
      status: "booked",
      position: 0,
    })
    .select("id");
  if (row.error) throw row.error;
  return { orderId, rentalId: row.data[0].id };
}
