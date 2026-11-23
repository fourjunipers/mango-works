// Row 6: read what the sign-ins left behind on the Launch project (read-only). Emails and names are masked.
// Usage: node scripts/row6-read.mjs
import { writeFileSync } from "node:fs";
import { neon } from "../lib/pg.mjs";

const db = await neon("LAUNCH");
const q = async (s) => (await db.query(s)).rows;
const mask = (v) => {
  if (Array.isArray(v)) return v.map(mask);
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, /email|name|picture|image|token|sub$|^id$|[iI]d$/i.test(k) && typeof x === "string" ? `<${x.length} chars>` : mask(x)]));
  if (typeof v === "string" && /@/.test(v)) return "<email>";
  return v;
};
const out = {
  readAt: new Date().toISOString(),
  log: (await q("select at, kind, detail from better_auth.spike_log order by id")).map((r) => ({ at: r.at, kind: r.kind, detail: mask(r.detail) })),
  accounts: await q('select "providerId" as provider, count(*)::int n, count(distinct "userId")::int users from better_auth.account group by 1 order by 1'),
  users: (await q('select count(*)::int n from better_auth."user"'))[0].n,
  linked: (await q("select count(*)::int n from platform.memberships m join better_auth.\"user\" u on u.id = m.user_id"))[0].n,
};
writeFileSync(new URL("../results/row6.json", import.meta.url), JSON.stringify(out, null, 2));
console.log(JSON.stringify(out, null, 1));
await db.end();
