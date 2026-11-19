import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

describe("safeNextPath", () => {
  it("keeps same-site paths, with their query and fragment", () => {
    for (const path of [
      "/",
      "/vendor",
      "/account?tab=cards",
      "/bsr/orders?q=1",
      "/ja/search?from=2026-12-01&to=2026-12-05#results",
      "/login?next=%2Faccount",
      "/a/b//c",
      "/search?next=//evil.example",
      "/search?u=https://evil.example/",
    ])
      expect(safeNextPath(path), path).toBe(path);
  });

  it("falls back for a missing value or one that is not a path", () => {
    expect(safeNextPath(null)).toBe("/");
    expect(safeNextPath(undefined)).toBe("/");
    expect(safeNextPath("")).toBe("/");
    expect(safeNextPath("vendor", "/account")).toBe("/account");
    expect(safeNextPath(null, "/home")).toBe("/home");
  });

  // Each of these sends a browser to another site, or is read differently
  // by a browser than by a check that only looks at the first characters.
  it.each([
    ["an absolute address", "https://evil.example"],
    ["an absolute address, upper case", "HTTPS://evil.example/"],
    ["a scheme-relative address", "//evil.example"],
    ["a scheme-relative address with a path", "//evil.example/account"],
    ["three slashes", "///evil.example"],
    ["a backslash after the slash", "/\\evil.example"],
    ["two backslashes", "\\\\evil.example"],
    ["a backslash further in", "/account\\..\\evil"],
    ["a tab between the slashes", "/\t/evil.example"],
    ["a line feed between the slashes", "/\n/evil.example"],
    ["a carriage return between the slashes", "/\r/evil.example"],
    ["a tab, then a backslash", "/\t\\evil.example"],
    ["a tab before the first slash", "\t//evil.example"],
    ["a space before the address", " //evil.example"],
    ["a null byte", "/\u0000/evil.example"],
    ["a control character further in", "/account\u001f"],
    ["a delete character", "/account\u007f"],
    ["a script address", "javascript:alert(1)"],
    ["a script address after a slash and a tab", "/\tjavascript:alert(1)"],
    ["a data address", "data:text/html,<script>alert(1)</script>"],
    ["an address with a user part", "https://example.com@evil.example/"],
    ["a mail address", "mailto:someone@evil.example"],
    ["a path with no leading slash", "evil.example/account"],
    ["a dot path", "./account"],
  ])("refuses %s", (_what, next) => {
    expect(safeNextPath(next)).toBe("/");
    expect(safeNextPath(next, "/home")).toBe("/home");
  });
});
