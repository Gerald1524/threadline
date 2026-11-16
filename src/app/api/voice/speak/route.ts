import { z } from "zod";
import { withContext } from "@/lib/api";
import { speak } from "@/lib/ai/voice";

export async function POST(req: Request) {
  return withContext(async (ctx) => {
    const { text } = z.object({ text: z.string().min(1).max(6000) }).parse(await req.json());
    return new Response((await speak(ctx, text)) as BodyInit, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, no-store" } });
  });
}
