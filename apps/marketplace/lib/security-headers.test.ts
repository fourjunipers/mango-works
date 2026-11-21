import { describe, expect, it } from "vitest";
import config from "../next.config";

/** What next.config.ts sends with every response. */
async function sent() {
  const rules = (await config.headers?.()) ?? [];
  const all = rules.find((rule) => rule.source === "/:path*");
  return new Map((all?.headers ?? []).map((h) => [h.key, h.value]));
}

describe("security headers on every response", () => {
  it("no other site can frame a page", async () => {
    const headers = await sent();
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'none'",
    );
  });

  it("no type sniffing, a short referrer, and https only", async () => {
    const headers = await sent();
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Referrer-Policy")).toBe(
      "strict-origin-when-cross-origin",
    );
    expect(headers.get("Strict-Transport-Security")).toMatch(
      /^max-age=(\d+)$/,
    );
    expect(
      Number(headers.get("Strict-Transport-Security")!.split("=")[1]),
    ).toBeGreaterThanOrEqual(31536000);
  });

  it("the full policy is report-only, and the enforced one holds nothing else", async () => {
    const headers = await sent();
    const policy = headers.get("Content-Security-Policy-Report-Only") ?? "";
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ])
      expect(policy).toContain(directive);
    // Next.js needs inline scripts while there are no nonces.
    expect(policy).toMatch(/script-src [^;]*'unsafe-inline'/);
    expect(policy).not.toContain("*;");
    expect(policy).not.toMatch(/(^|[ ;])\*( |;|$)/);
    expect(headers.get("Content-Security-Policy")).not.toContain("script-src");
  });
});
