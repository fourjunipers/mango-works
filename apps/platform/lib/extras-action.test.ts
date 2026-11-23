import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * saveExtras (the Server Action) left "who may" to the database alone. The
 * database still decides; the action now refuses a staff member, mechanic or
 * driver itself, before anything is sent, like the other actions do.
 */

const state = vi.hoisted(() => ({ role: "owner", rpc: 0 }));

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/session", () => ({
  requireMembership: async () => ({
    membership: { role: state.role, tenant: { id: "t1", slug: "bsr" } },
  }),
}));
vi.mock("@mango/db/platform-server", () => ({
  createClient: async () => ({
    rpc: async () => {
      state.rpc += 1;
      return { data: null, error: null };
    },
  }),
}));

const { saveExtras } = await import("@/app/[tenant]/products/extras-actions");

function form() {
  const data = new FormData();
  data.set("slug", "bsr");
  data.set("productId", "");
  data.set("extras", JSON.stringify({ lines: [], notOffered: [] }));
  return data;
}

beforeEach(() => {
  state.rpc = 0;
});

describe("saveExtras", () => {
  it.each(["owner", "manager"])("sends a %s's save to the database", async (role) => {
    state.role = role;
    const answer = await saveExtras({}, form());
    expect(answer).toEqual({ ok: true });
    expect(state.rpc).toBe(1);
  });

  it.each(["staff", "mechanic", "driver"])(
    "refuses a %s before the database is asked",
    async (role) => {
      state.role = role;
      const answer = await saveExtras({}, form());
      expect(answer).toEqual({ errors: { form: "extrasOnlyOwnerOrManager" } });
      expect(state.rpc).toBe(0);
    },
  );
});
