import { defineConfig } from "eslint/config";
import { nextApp } from "@mango/config/eslint/next";
import {
  appImportPatterns,
  supabasePatterns,
} from "@mango/config/eslint/boundaries";

/** Files that still import @supabase/* themselves (docs/PROGRESS.md). */
const supabaseAllowed = [
  "proxy.ts",
  "app/auth/confirm/route.ts",
  "scripts/create-line-provider.mjs",
  "tests/db/helpers.ts",
  "lib/admin-queue.ts",
  "lib/auth/sync-role.ts",
  "lib/stations/merge.ts",
];

const eslintConfig = defineConfig([
  // Next.js rules, Prettier, "never import from another app" or @supabase/*.
  ...nextApp("marketplace", { supabaseAllowed }),
  // Marketplace rule (docs/INTEGRATION.md): customer pages, components and
  // API routes reach shop data only through "@/lib/data", never a database
  // client, so the Mango Works API can replace it without UI changes.
  {
    files: [
      "app/(customer)/**",
      "app/api/**",
      "components/customer/**",
      "lib/search.ts",
      "lib/marketplace-search.ts",
    ],
    // Customer accounts and sign-in are the marketplace's own data.
    ignores: ["app/(customer)/*/account/**", "app/(customer)/*/login/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            // Repeated here because this block replaces the app-wide option.
            ...appImportPatterns("marketplace"),
            ...supabasePatterns,
            {
              group: ["@mango/db", "@mango/db/*", "@/lib/data/current-db"],
              message:
                "Use @/lib/data for shop data (see docs/INTEGRATION.md).",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
