import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

/**
 * The browser entry (instrumentation-client.ts) turns zod's JIT off, so the
 * `new Function` probe never runs under the CSP (docs/platform/csp-decision.md
 * §5 item 3).
 */

vi.mock("@sentry/nextjs", () => ({
  init: vi.fn(),
  captureRouterTransitionStart: vi.fn(),
}));

describe("instrumentation-client", () => {
  beforeEach(() => {
    vi.resetModules();
    z.config({ jitless: false });
  });

  it("sets zod jitless", async () => {
    expect(z.config().jitless).toBe(false);
    await import("../instrumentation-client");
    expect(z.config().jitless).toBe(true);
  });
});
