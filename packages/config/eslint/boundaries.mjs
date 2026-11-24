// Monorepo import boundaries (docs/platform/SPEC.md › Repository and database).
// Each entry is a `no-restricted-imports` pattern object.

const APPS = ["marketplace", "platform"];

/** Patterns that stop code from importing an app (by package name or path). */
export function appImportPatterns(allowedApp) {
  return APPS.filter((app) => app !== allowedApp).map((app) => ({
    regex: `^(@mango/${app}(/.*)?|(\.\./)+(apps/)?${app}(/.*)?|.*/apps/${app}(/.*)?)$`,
    message: `Apps never import from another app (here: ${app}). Move shared code to packages/.`,
  }));
}

/**
 * Apps never import @supabase/* themselves (root CLAUDE.md, the Neon
 * rules): their client comes from @mango/db. Type-only imports count too.
 * The files that still do are listed in docs/PROGRESS.md and allowed by
 * each app's `supabaseAllowed` (eslint/next.mjs); don't add to them.
 */
export const supabasePatterns = [
  {
    group: ["@supabase/*"],
    message:
      "Apps get their database client from @mango/db, never @supabase/* (root CLAUDE.md, the Neon rules).",
  },
];

/**
 * `.single()` and `.maybeSingle()` are refused outside packages/db (root
 * CLAUDE.md, the Neon rules): on Neon's Data API they give no error when zero
 * or several rows match. Use `exactlyOne()` / `atMostOne()` from
 * `@mango/db/rows`, which count the rows themselves. A `no-restricted-properties`
 * rule, so it doesn't clash with the apps' own `no-restricted-syntax`.
 */
export const singleRowRule = [
  "error",
  ...["single", "maybeSingle"].map((property) => ({
    property,
    message: `Use ${property === "single" ? "exactlyOne()" : "atMostOne()"} from @mango/db/rows, never .${property}() (root CLAUDE.md, the Neon rules).`,
  })),
];

/** packages/core is pure TypeScript: no React, Next.js or Supabase. */
export const pureCorePatterns = [
  {
    group: [
      "react",
      "react/*",
      "react-dom",
      "react-dom/*",
      "next",
      "next/*",
      "server-only",
    ],
    message: "packages/core is pure TypeScript: no React or Next.js.",
  },
  {
    group: ["@supabase/*", "@mango/db", "@mango/db/*"],
    message: "packages/core is pure TypeScript: no Supabase or database code.",
  },
];

/** Packages never import from an app or use an app's "@/..." alias. */
export const packagePatterns = [
  ...appImportPatterns(null),
  {
    group: ["@/*"],
    message: "Packages can't use an app's @/ alias. Import from packages only.",
  },
];
