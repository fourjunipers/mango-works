// Row 1 runner: drives the Netlify bench function in back-to-back batches (a function stops at 60 s),
// so every vendor is measured from the same function instance, interleaved, in one run.
// Usage: node scripts/bench-run.mjs <label> <targets, comma separated> [iterations=200] [baseDayOffset=0]
//   e.g. node scripts/bench-run.mjs dry launch,free 20
//        node scripts/bench-run.mjs main staging,launch,free 200
import { writeFileSync } from "node:fs";
import { target, loadState } from "../lib/targets.mjs";
import { need } from "../lib/env.mjs";
import { summarise } from "../lib/stats.mjs";

const [label, targetList, iterArg, offsetArg] = process.argv.slice(2);
const names = targetList.split(",");
const iterations = Number(iterArg ?? 200);
const WARM = 10; // warm-up iterations per target, thrown away
const BATCH = 6; // iterations per invocation: 6 x 3 calls x 3 targets is about 54 calls, well inside 60 s
const baseDay = new Date(new Date("2027-03-01T00:00:00+07:00").getTime() + Number(offsetArg ?? 0) * 60 * 86_400_000).toISOString();
const url = `https://spike--${need("NETLIFY_SITE_NAME")}.netlify.app/api/bench`;

const targets = [];
for (const n of names) {
  const t = await target(n);
  const shop = loadState(n);
  if (!shop) throw new Error(`no spike shop on record for ${n}`);
  targets.push({
    name: n,
    vendor: t.vendor,
    token: await t.userToken(shop.users[0]),
    shop: { tenantId: shop.tenantId, locationId: shop.locationId, products: shop.products.map((p) => ({ id: p.id })) },
  });
}

async function invoke(slotStart, count) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-spike-secret": need("BENCH_SECRET") },
    body: JSON.stringify({ targets, iterations: count, slotStart, baseDay }),
  });
  if (!res.ok) throw new Error(`bench function answered HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

const run = { label, startedAt: new Date().toISOString(), targets: names, iterations, warm: WARM, batch: BATCH, baseDay, invocations: [], warmup: [], samples: [] };
let slot = 0;
const phase = async (total, into) => {
  let left = total;
  while (left > 0) {
    const r = await invoke(slot, Math.min(BATCH, left));
    run.invocations.push({ region: r.region, node: r.node, coldStart: r.coldStart, instanceAgeMs: r.instanceAgeMs, iterationsDone: r.iterationsDone, tookMs: r.tookMs });
    into.push(...r.samples);
    slot += r.iterationsDone;
    left -= r.iterationsDone;
    if (r.iterationsDone === 0) throw new Error("the function did no iterations");
    process.stdout.write(`\r${into === run.warmup ? "warm-up" : "measured"} ${total - left}/${total}   `);
  }
};
await phase(WARM, run.warmup);
await phase(iterations, run.samples);
run.finishedAt = new Date().toISOString();
run.summary = summarise(run.samples);
writeFileSync(new URL(`../results/row1-${label}.json`, import.meta.url), JSON.stringify(run));

console.log("\nregion(s):", [...new Set(run.invocations.map((i) => i.region))].join(","), "| invocations:", run.invocations.length, "| cold starts:", run.invocations.filter((i) => i.coldStart).length, "| instances:", new Set(run.invocations.map((i) => Math.round((Date.parse(run.startedAt) - i.instanceAgeMs) / 60000))).size);
console.table(run.summary);
