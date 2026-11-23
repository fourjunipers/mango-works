// Row 2: the first call after an idle spell, through the Data API, then five more straight after (warm).
// Usage: node scripts/row2-cold.mjs free|launch <cycles> <idleSeconds> <label>
//   Free   : 20 cycles of 630 s idle (the compute sleeps after 5 idle minutes).
//   Launch : 1 cycle after an hour, 1 after a night (scale-to-zero is off; the first call must be no slower).
// Results are appended to results/row2-<target>-<label>.json after every cycle.
import { writeFileSync } from "node:fs";
import { target, loadState } from "../lib/targets.mjs";
import { readProducts } from "../lib/calls.mjs";

const [name, cyclesArg, idleArg, label = "run", mode = "fresh-token"] = process.argv.slice(2);
const cycles = Number(cyclesArg);
const idle = Number(idleArg);
const shop = loadState(name);
const t = await target(name);
const out = { target: name, label, mode, idleSeconds: idle, startedAt: new Date().toISOString(), cycles: [] };
const file = new URL(`../results/row2-${name}-${label}.json`, import.meta.url);

// mode "same-token": one token for the whole run, used once before the first idle spell, so a cycle's first
// call pays for a new connection and whatever the idle spell cost, but not for a token the API has never seen.
// (A first control run showed a fresh client with a freshly signed token is slow on its first two calls
// even with no idle spell at all.)
let sameToken = null;
if (mode === "same-token") {
  sameToken = await t.userToken(shop.users[0]);
  await readProducts(t.userClient(sameToken), shop);
}
for (let i = 1; i <= cycles; i++) {
  await new Promise((r) => setTimeout(r, idle * 1000));
  // A fresh client each cycle: no kept-alive connection from the cycle before.
  const db = t.userClient(sameToken ?? (await t.userToken(shop.users[0])));
  const one = async () => {
    const t0 = performance.now();
    const r = await readProducts(db, shop);
    return { ms: Math.round(performance.now() - t0), ok: !r.error && r.data?.length === shop.products.length, status: r.status, code: r.error?.code ?? null };
  };
  const first = await one();
  const rest = [];
  for (let k = 0; k < 5; k++) rest.push(await one());
  const warm = rest.map((x) => x.ms).sort((a, b) => a - b)[2];
  out.cycles.push({ cycle: i, at: new Date().toISOString(), first, rest: rest.map((x) => x.ms), warmMedian: warm, extraMs: first.ms - warm, allOk: first.ok && rest.every((x) => x.ok) });
  writeFileSync(file, JSON.stringify(out, null, 2));
  console.log(`${name} cycle ${i}/${cycles}: first ${first.ms} ms${first.ok ? "" : " (FAILED " + first.status + " " + first.code + ")"}, then ${rest.map((x) => x.ms).join(", ")} ms`);
}
out.finishedAt = new Date().toISOString();
writeFileSync(file, JSON.stringify(out, null, 2));
