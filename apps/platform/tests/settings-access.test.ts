/**
 * Who opens which part of Settings (lib/settings-access.ts).
 *
 * Since Phase 2 stage 6 the Settings layout lets staff in, for Settings ›
 * Extras alone. Every other Settings page must therefore turn anyone but
 * an owner or a manager away by itself: each one's first check is
 * requireArea(slug, "settings"). One test per page, so a page added
 * without its own check fails here. e2e/extras.spec.ts opens each page as
 * staff in a browser and is answered "Page not found".
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { roles } from "@/lib/roles";
import {
  canEnterSettings,
  canSeeExtrasSettings,
  menuAreasFor,
  settingsSections,
  settingsSectionsFor,
} from "@/lib/settings-access";

const settingsDir = fileURLToPath(
  new URL("../app/[tenant]/settings", import.meta.url),
);

function pagesUnder(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return pagesUnder(full);
    return entry === "page.tsx" || entry === "route.ts" ? [full] : [];
  });
}

/**
 * A page's source with its comments taken out, so a check that is only in
 * a comment (commented out) does not count.
 */
function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}
const code = (path: string) => stripComments(readFileSync(path, "utf8"));

const pages = pagesUnder(settingsDir)
  .map((full) => relative(settingsDir, full).split(sep).join("/"))
  .sort();

/** The pages owners and managers alone open. Extras is the one exception. */
const OWNER_OR_MANAGER = [
  "booking-rules/page.tsx",
  "coupons/[id]/page.tsx",
  "coupons/new/page.tsx",
  "coupons/page.tsx",
  "page.tsx",
  "price-lists/[id]/page.tsx",
  "price-lists/new/page.tsx",
  "price-lists/page.tsx",
  "pricing/page.tsx",
  "seasons/[id]/page.tsx",
  "seasons/new/page.tsx",
  "seasons/page.tsx",
];

describe("every Settings page but Extras refuses anyone but an owner or a manager", () => {
  it("the pages on disk are the ones listed here and Extras: a new page has to be added to a list", () => {
    expect(pages).toEqual([...OWNER_OR_MANAGER, "extras/page.tsx"].sort());
  });

  for (const page of OWNER_OR_MANAGER) {
    it(`settings/${page}: its first check is requireArea(slug, "settings")`, () => {
      const source = code(join(settingsDir, page));
      // The page's own function: before the check it waits only for its
      // params, and it reads, returns or redirects nothing.
      const body = source.slice(source.indexOf("export default"));
      const check = body.indexOf('await requireArea(slug, "settings")');
      expect(check, page).toBeGreaterThan(0);
      const before = body.slice(0, check);
      for (const [awaited] of before.matchAll(
        /await\s+(Promise\.all\(\[\s*\S+|\S+)/g,
      ))
        expect(awaited, page).toMatch(
          /^await\s+(params|Promise\.all\(\[\s*params,)/,
        );
      expect(before, page).not.toMatch(/\breturn\b|notFound|redirect/);
      expect(source).not.toContain("canSeeExtrasSettings");
    });
  }

  it("a check that is only in a comment does not count", () => {
    const commented = [
      "export default async function Page({ params }) {",
      "  const { tenant: slug } = await params;",
      '  // const { membership } = await requireArea(slug, "settings");',
      '  /* await requireArea(slug, "settings"); */',
      "  return null;",
      "}",
    ].join("\n");
    expect(stripComments(commented)).not.toContain("requireArea");
    // A URL in a string keeps its "//".
    expect(stripComments('const a = "https://x.test";')).toBe(
      'const a = "https://x.test";',
    );
  });

  it("settings/extras/page.tsx: owners, managers and staff; mechanics and drivers are not found", () => {
    const source = code(join(settingsDir, "extras/page.tsx"));
    expect(source).toContain("if (!canSeeExtrasSettings(role)) notFound();");
  });
});

describe("lib/settings-access.ts", () => {
  it("owners and managers get every section; staff Extras alone; mechanics and drivers nothing", () => {
    for (const role of roles) {
      const expected =
        role === "owner" || role === "manager"
          ? settingsSections
          : role === "staff"
            ? ["extras"]
            : [];
      expect(settingsSectionsFor(role), role).toEqual(expected);
      expect(canEnterSettings(role), role).toBe(expected.length > 0);
      expect(canSeeExtrasSettings(role), role).toBe(
        expected.includes("extras" as never),
      );
    }
  });

  it("the menu: owners and managers open Shop settings itself; staff open it at Extras; mechanics and drivers have none", () => {
    const settings = (role: (typeof roles)[number]) =>
      menuAreasFor(role).find((entry) => entry.area === "settings")?.path;
    expect(settings("owner")).toBe("settings");
    expect(settings("manager")).toBe("settings");
    expect(settings("staff")).toBe("settings/extras");
    expect(settings("mechanic")).toBeUndefined();
    expect(settings("driver")).toBeUndefined();
    // Nothing else in staff's menu changes.
    expect(menuAreasFor("staff").map((entry) => entry.area)).toEqual([
      "products",
      "fleet",
      "settings",
    ]);
  });
});
