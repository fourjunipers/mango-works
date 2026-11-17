import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // A marker package that throws outside a Server Component build. Tests
      // of server modules (lib/book-online.ts) run in plain Node.
      "server-only": fileURLToPath(
        new URL("./tests/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // tests/db needs local Supabase: run it with `npm run test:db`.
    exclude: ["node_modules/**", ".next/**", "e2e/**", "tests/db/**"],
    environment: "node",
  },
});
