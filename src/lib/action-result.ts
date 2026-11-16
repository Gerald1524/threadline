import { ZodError } from "zod";
import { AccessDenied } from "./access";

export type ActionResult<T = unknown> = { ok: true; data?: T; message?: string } | { ok: false; error: string };

/** Wrap a service call for a server action: expected failures become messages, not crashes. */
export async function attempt<T>(fn: () => Promise<T>, message?: string): Promise<ActionResult<T>> {
  try {
    return { ok: true, data: await fn(), message };
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e; // redirects
    if (e instanceof AccessDenied) return { ok: false, error: "Your role is not permitted to do that." };
    if (e instanceof ZodError) return { ok: false, error: e.issues.map((i) => i.message).join(" ") };
    const name = (e as Error).name;
    if (name === "WorkflowError" || name === "IngestBlocked" || name === "Error") return { ok: false, error: (e as Error).message };
    console.error("[action failed]", name);
    return { ok: false, error: "Something went wrong. The action was not completed." };
  }
}
