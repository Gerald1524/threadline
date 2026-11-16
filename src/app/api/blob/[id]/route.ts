import { notFound, withContext } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import { readBlob } from "@/lib/storage";

/** Private attachment access: no public URLs, permission-checked and audited on every read. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withContext(async (ctx) => {
    const db = await getDb();
    const b = await readBlob(db, ctx, id);
    if (!b || !b.meta.sourceRecordId) return notFound();
    await db.transaction((tx) => audit(tx, ctx, "attachment.downloaded", "blob", id, { sensitivity: b.meta.sensitivity }));
    return new Response(b.bytes as BodyInit, { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${b.meta.filename.replace(/[^\w.\- ]/g, "_")}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  });
}
