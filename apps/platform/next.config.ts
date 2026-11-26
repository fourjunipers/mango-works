import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";
import { securityHeaders } from "./lib/security-headers";

const nextConfig: NextConfig = {
  // Shared workspace packages ship TypeScript source (no build step).
  transpilePackages: ["@mango/booking", "@mango/core", "@mango/db"],
  // Price lists moved from Products to Settings in stage D6: old links and
  // bookmarks keep working.
  async redirects() {
    return [
      {
        source: "/:tenant/products/price-lists",
        destination: "/:tenant/settings/price-lists",
        permanent: false,
      },
      {
        source: "/:tenant/products/price-lists/:rest*",
        destination: "/:tenant/settings/price-lists/:rest*",
        permanent: false,
      },
    ];
  },
  // Sent with every response: lib/security-headers.ts says what and why.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders({
          supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
          development: process.env.NODE_ENV === "development",
        }),
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

export default withNextIntl(nextConfig);
