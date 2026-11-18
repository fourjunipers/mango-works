import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";
import { globalIgnores } from "eslint/config";
import { appImportPatterns, supabasePatterns } from "./boundaries.mjs";

/**
 * ESLint for a Next.js app in apps/<app>. Spread it into the app's
 * eslint.config.mjs and add app rules after it.
 *
 * `supabaseAllowed`: the app's files that still import @supabase/*
 * themselves (docs/PROGRESS.md lists them). Every other file is refused.
 */
export function nextApp(app, { supabaseAllowed = [] } = {}) {
  return [
    ...nextVitals,
    ...nextTs,
    prettier,
    {
      rules: {
        "no-restricted-imports": [
          "error",
          { patterns: [...appImportPatterns(app), ...supabasePatterns] },
        ],
      },
    },
    ...(supabaseAllowed.length
      ? [
          {
            files: supabaseAllowed,
            rules: {
              "no-restricted-imports": [
                "error",
                { patterns: appImportPatterns(app) },
              ],
            },
          },
        ]
      : []),
    globalIgnores([
      // Default ignores of eslint-config-next:
      ".next/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "playwright-report/**",
      "test-results/**",
    ]),
  ];
}
