/** Load .env.local for CLI scripts (Next.js loads it itself for the app). */
import fs from "node:fs";
for (const f of [".env.local", ".env"]) if (fs.existsSync(f)) process.loadEnvFile(f);
