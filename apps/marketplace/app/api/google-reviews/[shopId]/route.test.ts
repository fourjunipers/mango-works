import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/data", () => ({
  getShopById: async () => ({ googlePlaceId: "ChIJ-test-place" }),
}));

const SHOP = "b0000000-0000-4000-8000-000000000001";
let calls = 0;

beforeEach(() => {
  calls = 0;
  vi.stubEnv("GOOGLE_PLACES_SERVER_KEY", "test-key");
  vi.stubGlobal("fetch", async () => {
    calls += 1;
    return Response.json({ rating: 4.6, userRatingCount: 12, reviews: [] });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function get(ip: string) {
  const { GET } = await import("./route");
  return GET(
    new Request(`http://localhost/api/google-reviews/${SHOP}`, {
      headers: { "x-nf-client-connection-ip": ip },
    }),
    { params: Promise.resolve({ shopId: SHOP }) },
  );
}

describe("GET /api/google-reviews/[shopId]", () => {
  it("answers with the rating", async () => {
    const res = await get("203.0.113.1");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ rating: 4.6, count: 12 });
  });

  // Every call is a billed Places request (Enterprise + Atmosphere).
  it("stops one caller after 60 calls a minute, without asking Google again", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 70; i++)
      statuses.push((await get("203.0.113.2")).status);
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(60).every((s) => s === 429)).toBe(true);
    expect(calls).toBe(60);
    // Another caller still gets an answer.
    expect((await get("203.0.113.3")).status).toBe(200);
  });
});
