// Median and 95th percentile, and Mark's line for row 1 (19 Nov 2026):
// Neon is no worse than Supabase by more than 10% or 20 ms, whichever is larger, on both median and p95.

/** Percentile by linear interpolation between closest ranks (the usual "type 7" definition). */
export function percentile(sorted, p) {
  if (!sorted.length) return null;
  const h = (sorted.length - 1) * p;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (h - lo);
}

const round = (n) => (n == null ? null : Math.round(n * 10) / 10);

/** One row per call and target: n, failures, median, p95, min, max (ms). Failed calls are counted, not timed. */
export function summarise(samples) {
  const groups = new Map();
  for (const s of samples) {
    const k = `${s.call} / ${s.target}`;
    if (!groups.has(k)) groups.set(k, { call: s.call, target: s.target, ok: [], failed: 0 });
    const g = groups.get(k);
    if (s.ok) g.ok.push(s.ms);
    else g.failed++;
  }
  const out = {};
  for (const [k, g] of groups) {
    const sorted = g.ok.slice().sort((a, b) => a - b);
    out[k] = { n: sorted.length, failed: g.failed, median: round(percentile(sorted, 0.5)), p95: round(percentile(sorted, 0.95)), min: round(sorted[0]), max: round(sorted.at(-1)) };
  }
  return out;
}

/** The allowance on top of Supabase's figure: 10% or 20 ms, whichever is larger. */
export const allowance = (supabaseMs) => Math.max(supabaseMs * 0.1, 20);

/** Applies the line to one call. Returns { median: {...}, p95: {...}, pass }. */
export function judge(supabase, neonRow) {
  const one = (key) => {
    const limit = supabase[key] + allowance(supabase[key]);
    return { supabase: supabase[key], neon: neonRow[key], difference: round(neonRow[key] - supabase[key]), limit: round(limit), pass: neonRow[key] <= limit };
  };
  const median = one("median");
  const p95 = one("p95");
  return { median, p95, pass: median.pass && p95.pass };
}
