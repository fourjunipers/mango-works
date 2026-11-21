import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The two old addresses under /[tenant]/fleet/models redirected to whatever
 * the address said, before anyone had checked that the visitor belongs to
 * that shop. They now ask requireMembership() first, and send the visitor
 * only to a path built from the shop it answered with and a checked id.
 */

const state = vi.hoisted(() => ({ member: true, asked: [] as string[] }));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/session", () => ({
  requireMembership: async (slug: string) => {
    state.asked.push(slug);
    if (!state.member) throw new Error("NOT_FOUND");
    return { membership: { tenant: { slug: "bsr" } } };
  },
}));

const { default: OldNewModelPage } =
  await import("@/app/[tenant]/fleet/models/new/page");
const { default: OldModelPage } =
  await import("@/app/[tenant]/fleet/models/[id]/page");

const ID = "c0000000-0000-4000-8000-000000000002";

const openNew = (tenant: string, query: Record<string, string | string[]>) =>
  OldNewModelPage({
    params: Promise.resolve({ tenant }),
    searchParams: Promise.resolve(query),
  } as never);

const openOld = (tenant: string, id: string) =>
  OldModelPage({ params: Promise.resolve({ tenant, id }) } as never);

beforeEach(() => {
  state.member = true;
  state.asked = [];
});

describe("the old 'New product' address", () => {
  it("sends a member on, keeping the query", async () => {
    await expect(openNew("bsr", { type: "gear", x: ["a", "b"] })).rejects.toThrow(
      "REDIRECT /bsr/products/new?type=gear",
    );
    expect(state.asked).toEqual(["bsr"]);
  });

  it("is a 404 for someone who is not in that shop, with no redirect", async () => {
    state.member = false;
    await expect(openNew("other-shop", {})).rejects.toThrow("NOT_FOUND");
    expect(state.asked).toEqual(["other-shop"]);
  });

  it("goes to the shop the membership names, never to what the address said", async () => {
    await expect(openNew("\\evil.example", {})).rejects.toThrow(
      "REDIRECT /bsr/products/new",
    );
  });
});

describe("the old product page address", () => {
  it("sends a member on to the product", async () => {
    await expect(openOld("bsr", ID)).rejects.toThrow(
      `REDIRECT /bsr/products/${ID}`,
    );
    expect(state.asked).toEqual(["bsr"]);
  });

  it("is a 404 for someone who is not in that shop", async () => {
    state.member = false;
    await expect(openOld("other-shop", ID)).rejects.toThrow("NOT_FOUND");
  });

  it.each(["..", "x/../../login", "%2F%2Fevil.example", "not-an-id", ""])(
    "is a 404 for the id %j",
    async (id) => {
      await expect(openOld("bsr", id)).rejects.toThrow("NOT_FOUND");
    },
  );
});
