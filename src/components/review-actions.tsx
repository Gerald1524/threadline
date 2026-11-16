"use client";

import { resolveReviewAction } from "@/app/actions";
import { ResultNote, useAction } from "./dialogs";
import { Button } from "./ui";

export function ReviewActions({ id, type }: { id: string; type: string }) {
  const { pending, result, run } = useAction();
  const go = (decision: "confirm" | "reject" | "acknowledge" | "restrict") => run(() => resolveReviewAction({ id, decision }));
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-100 pt-3">
      {type === "tentative_link" ? <><Button size="sm" variant="primary" disabled={pending} onClick={() => go("confirm")} data-testid="review-confirm">Confirm link</Button><Button size="sm" disabled={pending} onClick={() => go("reject")} data-testid="review-reject">Not related</Button></> : null}
      {type === "duplicate_candidate" ? <><Button size="sm" variant="primary" disabled={pending} onClick={() => go("confirm")}>Same event — count once</Button><Button size="sm" disabled={pending} onClick={() => go("reject")}>Separate reports</Button></> : null}
      {!["tentative_link", "duplicate_candidate"].includes(type) ? <><Button size="sm" variant="primary" disabled={pending} onClick={() => go("acknowledge")} data-testid="review-ack">Reviewed — keep as is</Button><Button size="sm" disabled={pending} onClick={() => go("restrict")}>Restrict access</Button></> : null}
      <ResultNote result={result} />
    </div>
  );
}
