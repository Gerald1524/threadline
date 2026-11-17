import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content Security Policy for pages (Next.js "without nonces" pattern). Same-origin only:
 * the app loads no third-party scripts, fonts or frames. Frames are allowed from the app
 * itself (case packet preview). Audio may come from a blob (server read-aloud). API responses
 * (JSON, PDFs, files) are excluded so the browser's own PDF viewer keeps working.
 */
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' blob: data:",
  "media-src 'self' blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join("; ");

const common = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // The microphone is used only by this app's own voice input; nothing else is requested.
  { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  // Native/wasm-heavy server libraries are loaded from node_modules at runtime rather than bundled.
  serverExternalPackages: ["@electric-sql/pglite", "pg", "exceljs", "unpdf", "@react-pdf/renderer"],
  poweredByHeader: false,
  experimental: { serverActions: { bodySizeLimit: "8mb" } },
  async headers() {
    return [
      { source: "/:path*", headers: common },
      { source: "/((?!api/).*)", headers: [{ key: "Content-Security-Policy", value: csp }] },
    ];
  },
};

export default nextConfig;
