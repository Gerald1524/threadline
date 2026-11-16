"use client";

import Link from "next/link";
import { btn } from "@/components/ui";

/** Shown when a page's server-side permission check or data load fails. No record content is rendered. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const denied = error.name === "AccessDenied" || /Not permitted/.test(error.message);
  return (
    <div className="mx-auto mt-16 max-w-md rounded-xl border border-stone-200 bg-white p-8 text-center" data-testid="app-error">
      <h1 className="text-lg font-semibold text-stone-900">{denied ? "Not available to your role" : "This page could not be loaded"}</h1>
      <p className="mt-2 text-sm text-stone-600">{denied ? "Your role does not include access to this area. If you need it, ask your community manager or organization administrator." : "Nothing was changed. You can try again."}</p>
      <div className="mt-5 flex justify-center gap-2">
        {!denied ? <button className={btn("secondary")} onClick={reset}>Try again</button> : null}
        <Link href="/" className={btn("primary")}>Back to Ask</Link>
      </div>
    </div>
  );
}
