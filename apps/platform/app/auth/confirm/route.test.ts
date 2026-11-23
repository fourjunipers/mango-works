import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

/**
 * The sign-in link's `type` went to verifyOtp() as it came, so a link could
 * be built for any one-time-code type Supabase knows (recovery, invite,
 * email_change, signup). This route signs people in by email link and
 * nothing else.
 */

const verifyOtp = vi.hoisted(() =>
  vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null })),
);

vi.mock("server-only", () => ({}));
vi.mock("@mango/db/server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));
vi.mock("@mango/db/platform-server", () => ({
  createClient: async () => ({ auth: { verifyOtp } }),
}));
vi.mock("@/lib/auth/sync-role", () => ({ syncRoleAfterSignIn: async () => {} }));

const { GET } = await import("./route");

const open = (query: string) =>
  GET(new NextRequest(`http://localhost/auth/confirm?${query}`));

beforeEach(() => verifyOtp.mockClear());

describe("GET /auth/confirm", () => {
  it.each(["email", "magiclink"])("verifies a %s link", async (type) => {
    const res = await open(`token_hash=abc&type=${type}&next=/account`);
    expect(verifyOtp).toHaveBeenCalledWith({ type, token_hash: "abc" });
    expect(res.headers.get("location")).toBe("http://localhost/account");
  });

  it.each([
    "recovery",
    "invite",
    "email_change",
    "signup",
    "sms",
    "phone_change",
    "EMAIL",
    "",
  ])("never verifies a %j link", async (type) => {
    const res = await open(`token_hash=abc&type=${type}&next=/account`);
    expect(verifyOtp).not.toHaveBeenCalled();
    const to = new URL(res.headers.get("location")!);
    expect(to.pathname).toBe("/login");
    expect(to.searchParams.get("error")).toBe("link");
  });
});
