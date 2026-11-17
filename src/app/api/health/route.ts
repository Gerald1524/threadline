import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb, rowLevelSecurityStatus } from "@/lib/db/client";

export const dynamic = "force-dynamic";

/**
 * Liveness and readiness for a load balancer or uptime monitor. Unauthenticated, so it
 * reports only whether each check passed: no counts, names or other tenant information.
 * 503 when the database is unreachable or organization isolation is not in force.
 */
export async function GET() {
  try {
    const db = await getDb("system");
    await db.execute(sql`select 1`);
    const isolation = await rowLevelSecurityStatus();
    const ok = isolation.enforced;
    return NextResponse.json(
      { status: ok ? "ok" : "degraded", checks: { database: "ok", organizationIsolation: ok ? "enforced" : "not enforced" } },
      { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json({ status: "error", checks: { database: "unreachable" } }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
