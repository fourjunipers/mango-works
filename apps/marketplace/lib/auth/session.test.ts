import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * requireAdmin: the role stored on the profile was the only thing read, and
 * it is written at sign-in. Someone taken off ADMIN_EMAILS stayed an admin
 * for as long as their session lasted.
 */

const state = vi.hoisted(() => ({
  claims: null as null | { sub: string; email?: string },
  role: "customer" as string,
  demoted: [] as string[],
}));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));
vi.mock("react", async (original) => ({
  ...(await original<typeof import("react")>()),
  // No request to remember things for in a unit test.
  cache: <T>(fn: T) => fn,
}));
vi.mock("@mango/db/server", () => ({
  createClient: async () => ({
    auth: { getClaims: async () => ({ data: { claims: state.claims } }) },
    from: () => ({
      select: () => ({
        // Rows, as the query answers before exactlyOne() counts them.
        eq: async () => ({
          data: state.claims
            ? [{ id: state.claims.sub, role: state.role }]
            : [],
          error: null,
        }),
      }),
    }),
  }),
}));
vi.mock("./sync-role", () => ({
  removeAdminRole: async (id: string) => {
    state.demoted.push(id);
  },
}));

const { requireAdmin } = await import("./session");

beforeEach(() => {
  state.claims = { sub: "u1", email: "boss@example.com" };
  state.role = "admin";
  state.demoted = [];
  vi.stubEnv("ADMIN_EMAILS", "boss@example.com, second@example.com");
});

describe("requireAdmin", () => {
  it("lets in an admin whose email is still on the list", async () => {
    await expect(requireAdmin()).resolves.toMatchObject({ role: "admin" });
    expect(state.demoted).toEqual([]);
  });

  it("is a 404 for an admin taken off the list since they signed in, and the role is removed", async () => {
    vi.stubEnv("ADMIN_EMAILS", "second@example.com");
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
    expect(state.demoted).toEqual(["u1"]);
  });

  it("is a 404 when the list is empty or unset", async () => {
    vi.stubEnv("ADMIN_EMAILS", "");
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
  });

  it("is a 404 for someone on the list whose profile is not an admin", async () => {
    state.role = "customer";
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
    expect(state.demoted).toEqual([]);
  });

  it("sends a signed-out visitor to sign in", async () => {
    state.claims = null;
    await expect(requireAdmin()).rejects.toThrow("REDIRECT /login");
  });
});
