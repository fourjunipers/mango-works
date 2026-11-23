// Row 5, the lock behaviour: 55P03, 57014 and 40P01 must reach the caller through the data API unchanged,
// at the same times, with nothing written. The same script runs against Supabase (staging) and Neon.
// Usage: node scripts/row5-locks.mjs staging|free|launch
//
// A second session (direct SQL) plays the part of the gate tests' holder. It only ever takes locks on the
// spike shop's own product rows and product locks, inside transactions that are rolled back: it writes nothing.
import { writeFileSync } from "node:fs";
import { target, loadState, saveState } from "../lib/targets.mjs";
import { reserveRequest, isTryAgain, staffAnswer } from "../lib/calls.mjs";
import { safe } from "../lib/env.mjs";

const name = process.argv[2];
const shop = loadState(name);
const t = await target(name);
const owner = t.userClient(await t.userToken(shop.users[0]));
const holder = await t.sql();
const watcher = await t.sql();
const out = { target: name, vendor: t.vendor, at: new Date().toISOString(), tests: {} };

const P = shop.products[0].id; // the vehicle the tests fight over
const V = shop.products[1].id; // a second vehicle, for the deadlock
const baseDay = new Date("2028-01-10T00:00:00+07:00");

// A gear product to offer as an extra (the deadlock test needs two product rows of different kinds).
if (!shop.gearId) {
  const r = await owner.rpc("create_general_product", {
    p_tenant_id: shop.tenantId, p_type: "gear", p_name: `Spike helmet ${shop.tag}`, p_track_units: false,
    p_quantities: [{ location_id: shop.locationId, quantity: 5 }],
  });
  if (r.error) throw new Error(`create_general_product: [${r.error.code}] ${safe(r.error.message)}`);
  shop.gearId = r.data;
  saveState(name, shop);
}
const E = shop.gearId;

async function written() {
  const r = await watcher.query(
    `select
      (select count(*) from platform.reservations where tenant_id = $1) reservations,
      (select count(*) from platform.unit_blocks where tenant_id = $1) unit_blocks,
      (select count(*) from platform.audit_events where tenant_id = $1) audit_events,
      (select count(*) from platform.product_extras where tenant_id = $1) product_extras,
      (select coalesce(md5(string_agg(pp::text, '|' order by pp.product_id)), '-') from platform.product_pricing pp where pp.tenant_id = $1) pricing_md5`,
    [shop.tenantId],
  );
  return JSON.stringify(r.rows[0]);
}

async function timed(promise) {
  const t0 = performance.now();
  const r = await promise;
  return {
    waitedMs: Math.round(performance.now() - t0),
    httpStatus: r.status,
    data: r.data ?? null,
    error: r.error ? { code: r.error.code, message: safe(r.error.message), details: r.error.details ?? null, hint: r.error.hint ?? null } : null,
  };
}

/** Waits until some other backend is waiting for a lock while running a query that names `marker`. */
async function seenWaiting(marker, withinMs = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < withinMs) {
    const r = await watcher.query(
      "select count(*)::int n from pg_stat_activity where pid <> pg_backend_pid() and wait_event_type = 'Lock' and query ilike $1",
      [`%${marker}%`],
    );
    if (r.rows[0].n > 0) return Date.now() - t0;
    await new Promise((res) => setTimeout(res, 40));
  }
  return null;
}

// ---- 1. 55P03: a product lock that can't be had in time ------------------------------------------------
{
  const before = await written();
  await holder.query("begin");
  await holder.query("select platform_private.lock_products_stock(array[$1]::uuid[], array[$2]::uuid[])", [P, shop.locationId]);
  const staffReq = reserveRequest({ ...shop, products: [{ id: P }] }, 0, baseDay);
  const onlineReq = { p_tenant_id: shop.tenantId, p_request: { ...staffReq.p_request, channel: "booking_page", mode: "instant" } };
  const [staff, online] = await Promise.all([timed(owner.rpc("reserve", staffReq)), timed(t.service.rpc("reserve", onlineReq))]);
  await holder.query("rollback");
  let staffCaller;
  try {
    staffCaller = staffAnswer({ data: staff.data, error: staff.error });
  } catch (e) {
    staffCaller = { thrown: e.code };
  }
  out.tests.lock_timeout_55P03 = {
    staff,
    online,
    staffCallerAnswers: staffCaller,
    onlineCallerAnswers: online.error ? (isTryAgain(online.error) ? { ok: false, reason: "try_again", line: null } : { thrown: online.error.code }) : online.data,
    nothingWritten: before === (await written()),
    lockTimeoutOnFunction: (await watcher.query("select array_to_string(proconfig, ';') c from pg_proc where oid = 'platform.reserve(uuid,jsonb)'::regprocedure")).rows[0].c,
  };
}

// ---- 2. 57014: a statement the API's 8-second timeout ends ---------------------------------------------
// save_product_pricing() has no lock_timeout of its own and takes the product's row "for no key update".
{
  const before = await written();
  await holder.query("begin");
  await holder.query("select 1 from platform.products where id = $1 for update", [P]);
  const call = await timed(
    owner.rpc("save_product_pricing", { p_product_id: P, p_settings: { pricing_method: "per_period", price_amount: 99900, price_period: "day" } }),
  );
  await holder.query("rollback");
  out.tests.statement_timeout_57014 = {
    call,
    callerAnswers: call.error ? (isTryAgain(call.error) ? { ok: false, reason: "try_again" } : { thrown: call.error.code }) : call.data,
    nothingWritten: before === (await written()),
  };
}

// ---- 3. 40P01: a real deadlock, with the API call as the one Postgres ends ------------------------------
// save_product_extras(vehicle V, [extra E]) takes V's row, then E's. The holder has E's row; once the call
// is seen waiting for it, the holder asks for V's row. The call began waiting first, so its deadlock check
// runs first and it is the one ended. save_product_extras() does not catch 40P01, so it reaches the caller.
{
  const attempts = [];
  for (let attempt = 1; attempt <= 4 && !attempts.some((a) => a.call.error?.code === "40P01"); attempt++) {
    const before = await written();
    await holder.query("begin");
    await holder.query("select 1 from platform.products where id = $1 for update", [E]);
    const pending = timed(owner.rpc("save_product_extras", { p_tenant_id: shop.tenantId, p_product_id: V, p_extras: [{ extra_product_id: E, included_quantity: 1 }] }));
    const seenAfterMs = await seenWaiting("save_product_extras");
    let holderResult = "got the row";
    try {
      await holder.query("select 1 from platform.products where id = $1 for update", [V]);
    } catch (e) {
      holderResult = `holder was ended: ${e.code}`;
    }
    const call = await pending;
    await holder.query("rollback").catch(() => {});
    attempts.push({ attempt, seenWaitingAfterMs: seenAfterMs, holder: holderResult, call, nothingWritten: before === (await written()) });
    if (call.error?.code !== "40P01" && !call.error) {
      // The save went through (the holder lost): undo it so the next attempt starts from the same state.
      await owner.rpc("save_product_extras", { p_tenant_id: shop.tenantId, p_product_id: V, p_extras: [] });
    }
  }
  const hit = attempts.find((a) => a.call.error?.code === "40P01");
  out.tests.deadlock_40P01 = {
    attempts,
    reachedCaller: !!hit,
    callerAnswers: hit ? (isTryAgain(hit.call.error) ? { ok: false, reason: "try_again" } : { thrown: hit.call.error.code }) : null,
  };
}

// The API's statement timeout as a request sees it, and Postgres's deadlock timeout.
out.settings = (await watcher.query("select current_setting('deadlock_timeout') deadlock_timeout")).rows[0];

await holder.end();
await watcher.end();
writeFileSync(new URL(`../results/row5-locks-${name}.json`, import.meta.url), JSON.stringify(out, null, 2));

const brief = (c) => (c.error ? `[${c.error.code}] HTTP ${c.httpStatus} after ${c.waitedMs} ms: ${c.error.message}` : `no error, HTTP ${c.httpStatus} after ${c.waitedMs} ms: ${JSON.stringify(c.data).slice(0, 120)}`);
const a = out.tests.lock_timeout_55P03;
console.log(`${name} 55P03 staff : ${brief(a.staff)} -> caller ${JSON.stringify(a.staffCallerAnswers)}`);
console.log(`${name} 55P03 online: ${brief(a.online)} -> caller ${JSON.stringify(a.onlineCallerAnswers)}`);
console.log(`${name} 55P03 nothing written: ${a.nothingWritten} | function config: ${a.lockTimeoutOnFunction}`);
const b = out.tests.statement_timeout_57014;
console.log(`${name} 57014: ${brief(b.call)} -> caller ${JSON.stringify(b.callerAnswers)} | nothing written: ${b.nothingWritten}`);
const c = out.tests.deadlock_40P01;
for (const x of c.attempts) console.log(`${name} 40P01 attempt ${x.attempt}: seen waiting after ${x.seenWaitingAfterMs} ms; ${x.holder}; ${brief(x.call)} | nothing written: ${x.nothingWritten}`);
console.log(`${name} 40P01 reached the caller: ${c.reachedCaller} -> caller ${JSON.stringify(c.callerAnswers)}`);
