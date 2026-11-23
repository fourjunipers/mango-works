// Applies Mark's line to a row 1 run: for each call, Neon's median and p95 must each be no worse than
// Supabase's by more than 10% or 20 ms, whichever is larger.
// Usage: node scripts/row1-judge.mjs <label>   -> results/row1-<label>-verdict.json
import { readFileSync, writeFileSync } from "node:fs";
import { summarise, judge } from "../lib/stats.mjs";

const label = process.argv[2];
const run = JSON.parse(readFileSync(new URL(`../results/row1-${label}.json`, import.meta.url), "utf8"));
const summary = summarise(run.samples);
const calls = [...new Set(run.samples.map((s) => s.call))];
const neons = run.targets.filter((t) => t !== "staging");
const verdict = { label, startedAt: run.startedAt, finishedAt: run.finishedAt, region: [...new Set(run.invocations.map((i) => i.region))], invocations: run.invocations.length, coldStarts: run.invocations.filter((i) => i.coldStart).length, summary, lines: [] };
for (const call of calls) {
  for (const n of neons) {
    const j = judge(summary[`${call} / staging`], summary[`${call} / ${n}`]);
    verdict.lines.push({ call, neon: n, ...j });
  }
}
verdict.pass = Object.fromEntries(neons.map((n) => [n, verdict.lines.filter((l) => l.neon === n).every((l) => l.pass)]));
writeFileSync(new URL(`../results/row1-${label}-verdict.json`, import.meta.url), JSON.stringify(verdict, null, 2));
console.table(summary);
console.table(verdict.lines.map((l) => ({ call: l.call, neon: l.neon, "median S": l.median.supabase, "median N": l.median.neon, "median limit": l.median.limit, "p95 S": l.p95.supabase, "p95 N": l.p95.neon, "p95 limit": l.p95.limit, pass: l.pass })));
console.log("pass:", verdict.pass, "| failures:", Object.values(summary).reduce((a, r) => a + r.failed, 0));
