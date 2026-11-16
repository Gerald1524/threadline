import { NextResponse } from "next/server";
import { withContext } from "@/lib/api";
import { transcribe } from "@/lib/ai/voice";

/** Staff-initiated dictation only. The audio is forwarded to the provider and discarded. */
export async function POST(req: Request) {
  return withContext(async (ctx) => {
    const bytes = new Uint8Array(await req.arrayBuffer());
    if (!bytes.length || bytes.length > 8 * 1024 * 1024) return NextResponse.json({ error: "Recording is empty or too long." }, { status: 400 });
    return NextResponse.json({ text: await transcribe(ctx, bytes, req.headers.get("content-type") ?? "audio/webm") });
  });
}
