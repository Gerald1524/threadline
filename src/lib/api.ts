import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { AccessDenied, type AccessContext } from "./access";
import { getContext } from "./auth/session";

/** Route-handler wrapper: authenticate, then map expected failures to status codes. */
export async function withContext(fn: (ctx: AccessContext) => Promise<Response>): Promise<Response> {
  const ctx = await getContext();
  if (!ctx) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  try {
    return await fn(ctx);
  } catch (e) {
    if (e instanceof AccessDenied) return NextResponse.json({ error: "Your role is not permitted to do that." }, { status: 403 });
    if (e instanceof ZodError) return NextResponse.json({ error: e.issues.map((i) => i.message).join(" ") }, { status: 400 });
    console.error("[api error]", (e as Error).name);
    return NextResponse.json({ error: (e as Error).name === "Error" ? (e as Error).message : "Request failed." }, { status: 500 });
  }
}
export const notFound = () => NextResponse.json({ error: "Not found." }, { status: 404 });
