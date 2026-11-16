import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  // PDF text nodes are not HTML: quotes need no entity escaping there.
  { files: ["src/lib/pdf/**"], rules: { "react/no-unescaped-entities": "off" } },
  globalIgnores([".next/**", "legacy/**", "node_modules/**", ".data/**", "drizzle/**", "next-env.d.ts", "playwright-report/**", "test-results/**"]),
]);
