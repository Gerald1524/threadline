import { notFound, withContext } from "@/lib/api";
import { getReportPdf } from "@/lib/services/reports";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withContext(async (ctx) => {
    const r = await getReportPdf(ctx, id);
    if (!r) return notFound();
    const download = new URL(req.url).searchParams.get("download") === "1";
    return new Response(r.bytes as BodyInit, { headers: { "Content-Type": "application/pdf", "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${r.filename}"`, "Cache-Control": "private, no-store" } });
  });
}
