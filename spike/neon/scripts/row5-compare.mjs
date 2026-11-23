// Compares the row 5 results of two targets: every check must give the same HTTP status, the same error
// code and text, and the same result shape. Also the lock tests' codes and times.
// Usage: node scripts/row5-compare.mjs staging free   -> results/row5-compare-staging-free.json
import { readFileSync, writeFileSync, existsSync } from "node:fs";

const [a, b] = process.argv.slice(2);
const load = (kind, n) => {
  const f = new URL(`../results/row5-${kind}-${n}.json`, import.meta.url);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
};
const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
const out = { a, b, shapes: { same: [], different: [] }, locks: [] };

const sa = load("shapes", a);
const sb = load("shapes", b);
if (sa && sb) {
  for (const label of Object.keys(sa.results)) {
    const x = sa.results[label];
    const y = sb.results[label];
    const diffs = [];
    if (!y) diffs.push("missing on " + b);
    else {
      if (x.httpStatus !== y.httpStatus) diffs.push(`HTTP status ${x.httpStatus} vs ${y.httpStatus}`);
      if ((x.error?.code ?? null) !== (y.error?.code ?? null)) diffs.push(`code ${x.error?.code ?? "none"} vs ${y.error?.code ?? "none"}`);
      if ((x.error?.message ?? null) !== (y.error?.message ?? null)) diffs.push(`message "${x.error?.message}" vs "${y.error?.message}"`);
      if (!same(x.error?.details ?? null, y.error?.details ?? null)) diffs.push(`details "${x.error?.details}" vs "${y.error?.details}"`);
      if (!same(x.error?.hint ?? null, y.error?.hint ?? null)) diffs.push(`hint "${x.error?.hint}" vs "${y.error?.hint}"`);
      if (!same(x.shape, y.shape)) diffs.push(`result shape ${JSON.stringify(x.shape)?.slice(0, 200)} vs ${JSON.stringify(y.shape)?.slice(0, 200)}`);
      if (!same(x.count ?? null, y.count ?? null)) diffs.push(`count ${x.count} vs ${y.count}`);
    }
    (diffs.length ? out.shapes.different : out.shapes.same).push(diffs.length ? { label, diffs } : label);
  }
}

const la = load("locks", a);
const lb = load("locks", b);
if (la && lb) {
  const pick = (t) => ({
    "55P03 staff": t.tests.lock_timeout_55P03.staff,
    "55P03 online": t.tests.lock_timeout_55P03.online,
    "57014": t.tests.statement_timeout_57014.call,
    "40P01": t.tests.deadlock_40P01.attempts.find((x) => x.call.error?.code === "40P01")?.call ?? t.tests.deadlock_40P01.attempts.at(-1).call,
  });
  const pa = pick(la);
  const pb = pick(lb);
  for (const k of Object.keys(pa)) {
    out.locks.push({
      test: k,
      [a]: { code: pa[k].error?.code ?? null, httpStatus: pa[k].httpStatus, waitedMs: pa[k].waitedMs, message: pa[k].error?.message ?? null },
      [b]: { code: pb[k].error?.code ?? null, httpStatus: pb[k].httpStatus, waitedMs: pb[k].waitedMs, message: pb[k].error?.message ?? null },
      sameCode: (pa[k].error?.code ?? null) === (pb[k].error?.code ?? null),
      sameStatus: pa[k].httpStatus === pb[k].httpStatus,
      sameMessage: (pa[k].error?.message ?? null) === (pb[k].error?.message ?? null),
      differenceMs: pb[k].waitedMs - pa[k].waitedMs,
    });
  }
  out.nothingWritten = {
    [a]: [la.tests.lock_timeout_55P03.nothingWritten, la.tests.statement_timeout_57014.nothingWritten, la.tests.deadlock_40P01.attempts.every((x) => x.nothingWritten || !x.call.error)],
    [b]: [lb.tests.lock_timeout_55P03.nothingWritten, lb.tests.statement_timeout_57014.nothingWritten, lb.tests.deadlock_40P01.attempts.every((x) => x.nothingWritten || !x.call.error)],
  };
  out.callerAnswers = {
    [a]: { staff55P03: la.tests.lock_timeout_55P03.staffCallerAnswers, online55P03: la.tests.lock_timeout_55P03.onlineCallerAnswers, on57014: la.tests.statement_timeout_57014.callerAnswers, on40P01: la.tests.deadlock_40P01.callerAnswers },
    [b]: { staff55P03: lb.tests.lock_timeout_55P03.staffCallerAnswers, online55P03: lb.tests.lock_timeout_55P03.onlineCallerAnswers, on57014: lb.tests.statement_timeout_57014.callerAnswers, on40P01: lb.tests.deadlock_40P01.callerAnswers },
  };
}

writeFileSync(new URL(`../results/row5-compare-${a}-${b}.json`, import.meta.url), JSON.stringify(out, null, 2));
console.log(`${a} vs ${b}: ${out.shapes.same.length} checks the same, ${out.shapes.different.length} different`);
for (const d of out.shapes.different) console.log(` DIFFERENT  ${d.label}\n     ${d.diffs.join("\n     ")}`);
for (const l of out.locks) console.log(` ${l.test}: ${a} [${l[a].code}] HTTP ${l[a].httpStatus} ${l[a].waitedMs} ms | ${b} [${l[b].code}] HTTP ${l[b].httpStatus} ${l[b].waitedMs} ms | same code ${l.sameCode}, same status ${l.sameStatus}, same message ${l.sameMessage}`);
if (out.nothingWritten) console.log(" nothing written:", JSON.stringify(out.nothingWritten), "\n caller answers:", JSON.stringify(out.callerAnswers));
