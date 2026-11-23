// Row 1: the same calls against Supabase (staging) and the Neon Data API, from one Netlify function,
// interleaved in the same run. Holds no user secret: the caller sends short-lived tokens in the body.
// Every request must carry the spike's secret header.
import type { Context } from "@netlify/functions";
import { supabaseClient, neonClient } from "../../lib/clients.mjs";
import { readProducts, readPrices, reserve } from "../../lib/calls.mjs";

const startedAt = Date.now();
let invocations = 0;
const clients = new Map<string, any>();

function clientFor(name: string, vendor: string, token: string) {
  const key = `${name}:${token.slice(-16)}`;
  let c = clients.get(key);
  if (!c) {
    c =
      vendor === "supabase"
        ? supabaseClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, token)
        : neonClient(name === "launch" ? process.env.NEON_LAUNCH_DATA_API_URL! : process.env.NEON_FREE_DATA_API_URL!, () => token);
    clients.set(key, c);
  }
  return c;
}

const CALLS: Record<string, (db: any, shop: any, slot: number, baseDay: Date) => PromiseLike<any>> = {
  readProducts: (db, shop) => readProducts(db, shop),
  readPrices: (db, shop) => readPrices(db, shop),
  reserve: (db, shop, slot, baseDay) => reserve(db, shop, slot, baseDay),
};

export default async (req: Request, context: Context) => {
  if (!process.env.BENCH_SECRET || req.headers.get("x-spike-secret") !== process.env.BENCH_SECRET) {
    return new Response("not found", { status: 404 });
  }
  const body = await req.json();
  // targets: [{ name: "staging"|"free"|"launch", vendor, token, shop: { tenantId, locationId, products: [{id}] } }]
  const { targets, iterations, slotStart, baseDay, calls = ["readProducts", "readPrices", "reserve"], deadlineMs = 50_000 } = body;
  const base = new Date(baseDay);
  const began = Date.now();
  const coldStart = invocations++ === 0;
  const samples: any[] = [];
  let done = 0;

  for (let i = 0; i < iterations; i++) {
    if (Date.now() - began > deadlineMs) break;
    for (const call of calls) {
      // Rotate which target goes first, so no vendor always follows the same neighbour.
      const order = targets.map((_: any, k: number) => targets[(k + i) % targets.length]);
      for (const t of order) {
        const db = clientFor(t.name, t.vendor, t.token);
        const t0 = performance.now();
        let result: any;
        try {
          result = await CALLS[call](db, t.shop, slotStart + i, base);
        } catch (e: any) {
          result = { error: { code: "THROWN", message: String(e?.message ?? e) }, status: 0 };
        }
        const ms = performance.now() - t0;
        const ok =
          !result.error &&
          (call === "reserve" ? result.data?.ok === true : call === "readProducts" ? result.data?.length === t.shop.products.length : result.data?.products?.length === t.shop.products.length);
        samples.push({
          i: slotStart + i,
          call,
          target: t.name,
          ms: Math.round(ms * 100) / 100,
          ok,
          status: result.status,
          ...(ok ? {} : { code: result.error?.code ?? null, note: String(result.error?.message ?? JSON.stringify(result.data)).slice(0, 160) }),
        });
      }
    }
    done++;
  }

  return Response.json({
    region: context.server?.region ?? null,
    node: process.version,
    coldStart,
    instanceAgeMs: Date.now() - startedAt,
    iterationsDone: done,
    tookMs: Date.now() - began,
    samples,
  });
};

export const config = { path: "/api/bench" };
