import { NextResponse } from "next/server";
import { z } from "zod";
import { withContext } from "@/lib/api";
import { ask } from "@/lib/engine/ask";

const Body = z.object({ question: z.string().trim().min(2).max(2000), conversationId: z.string().nullish(), inputMode: z.enum(["text", "voice"]).optional() });

export async function POST(req: Request) {
  return withContext(async (ctx) => {
    const body = Body.parse(await req.json());
    return NextResponse.json(await ask(ctx, body));
  });
}
