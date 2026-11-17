import { and, eq } from "drizzle-orm";
import { assertCan } from "@/lib/access";
import { notFound, withContext } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import { exportsTable } from "@/lib/db/schema";
import { readBlob } from "@/lib/storage";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withContext(async (ctx) => {
    assertCan(ctx, "privacy.admin");
    const db = await getDb(ctx);
    const [e] = await db.select().from(exportsTable).where(and(eq(exportsTable.id, id), eq(exportsTable.orgId, ctx.orgId)));
    const b = e?.blobId ? await readBlob(db, ctx, e.blobId) : null;
    if (!b) return notFound();
    await db.transaction((tx) => audit(tx, ctx, "export.downloaded", "export", id, {}));
    return new Response(b.bytes as BodyInit, { headers: { "Content-Type": "application/json", "Content-Disposition": `attachment; filename="${b.meta.filename}"`, "Cache-Control": "private, no-store" } });
  });
}
