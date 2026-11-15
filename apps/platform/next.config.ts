import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const nextConfig: NextConfig = {
  // Shared workspace packages ship TypeScript source (no build step).
  transpilePackages: ["@mango/core", "@mango/db"],
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
