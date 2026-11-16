import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native/wasm-heavy server libraries are loaded from node_modules at runtime rather than bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "exceljs", "unpdf", "@react-pdf/renderer"],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
};

export default nextConfig;
