import { defineConfig } from "eslint/config";
import { nextApp } from "@mango/config/eslint/next";

/**
 * One pricer (docs/products-redesign.md §9.9): every price is worked out by
 * quote() in @mango/core. Nothing in this app may multiply, divide or take a
 * remainder of money, so there can never be a second code path that
 * produces a price. Adding and comparing amounts is fine; turning minor
 * units into a display string is lib/money.ts's job alone.
 */
const moneyName =
  "/(price|amount|deposit|vat|tax|discount|subtotal|total|charge|fee|cost)/i";
const arithmetic = "/^(\\*|\\/|%|\\*\\*)$/";
const message =
  "Money is priced in @mango/core (quote) only: no multiplying, dividing or remainders of amounts in the app.";
const onePricer = {
  files: ["app/**", "components/**", "lib/**"],
  // Tests may work an expected figure out by hand.
  ignores: ["**/*.test.ts", "**/*.test.tsx", "lib/money.ts"],
  rules: {
    "no-restricted-syntax": [
      "error",
      {
        selector: `BinaryExpression[operator=${arithmetic}] > Identifier[name=${moneyName}]`,
        message,
      },
      {
        selector: `BinaryExpression[operator=${arithmetic}] > MemberExpression > Identifier.property[name=${moneyName}]`,
        message,
      },
      {
        selector: `AssignmentExpression[operator=/^(\\*|\\/|%)=$/] > Identifier.left[name=${moneyName}]`,
        message,
      },
    ],
  },
};

/** Files that still import @supabase/* themselves (docs/PROGRESS.md). */
const supabaseAllowed = [
  "proxy.ts",
  "app/auth/confirm/route.ts",
  "scripts/create-line-provider.mjs",
  "tests/db/helpers.ts",
  "scripts/seed.mts",
  "scripts/load-bsr-pricing.mts",
  "e2e/shop-settings.ts",
];

// Next.js rules, Prettier, "never import from another app" or @supabase/*,
// and one pricer.
export default defineConfig([
  ...nextApp("platform", { supabaseAllowed }),
  onePricer,
]);
