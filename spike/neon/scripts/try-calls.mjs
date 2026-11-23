// Runs each measured call once from this machine against one target, and shows the shape of what came back.
// Usage: node scripts/try-calls.mjs staging|free|launch [slot]
import { target, loadState } from "../lib/targets.mjs";
import { readProducts, readPrices, reserve } from "../lib/calls.mjs";
import { safe } from "../lib/env.mjs";

const name = process.argv[2];
const slot = Number(process.argv[3] ?? 9000);
const shop = loadState(name);
const t = await target(name);
const db = t.userClient(await t.userToken(shop.users[0]));
const baseDay = new Date("2027-03-01T00:00:00+07:00");

const timed = async (label, fn, summarise) => {
  const t0 = performance.now();
  const r = await fn();
  const ms = Math.round(performance.now() - t0);
  console.log(`${label}: ${ms} ms, status ${r.status}, ` + (r.error ? `ERROR [${r.error.code}] ${safe(r.error.message)}` : summarise(r.data)));
  return r;
};

await timed("readProducts", () => readProducts(db, shop), (d) => `${d.length} rows, first: ${JSON.stringify(d[0]).slice(0, 220)}`);
await timed("readPrices", () => readPrices(db, shop), (d) => `keys ${Object.keys(d)}, products ${d.products.length}, first: ${JSON.stringify(d.products[0]).slice(0, 260)}`);
await timed("reserve", () => reserve(db, shop, slot, baseDay), (d) => JSON.stringify(d));
await timed("reserve same slot again", () => reserve(db, shop, slot, baseDay), (d) => JSON.stringify(d));
