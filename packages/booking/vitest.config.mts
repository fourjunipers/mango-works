import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // A marker package that throws outside a Server Component build. The
      // tests of src/book-online.ts run in plain Node.
      "server-only": fileURLToPath(
        new URL("./src/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
