"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { draftMessageAction, discardDraftAction, generatePacketAction, requestApprovalAction, sendMessageAction } from "@/app/actions";
import type { ActionResult } from "@/lib/action-result";
import { Button, Field, Notice, inputCls } from "./ui";

export const newKey = () => `ui-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function Modal({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onClose} onClick={(e) => e.target === ref.current && onClose()} aria-labelledby={titleId} className={`m-auto w-[calc(100%-2rem)] rounded-xl border border-stone-200 bg-white p-0 shadow-2xl ${wide ? "max-w-3xl" : "max-w-xl"}`}>
      {open ? (
        <div className="flex max-h-[88vh] flex-col">
          <header className="flex items-center justify-between gap-3 border-b border-stone-200 px-5 py-3.5">
            <h2 id={titleId} className="text-base font-semibold text-stone-900">{title}</h2>
            <button onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100"><X size={18} /></button>
          </header>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
        </div>
      ) : null}
    </dialog>
  );
}

export function ResultNote({ result }: { result: ActionResult | null }) {
  if (!result) return null;
  return result.ok ? (result.message ? <p role="status" className="text-sm text-emerald-700">{result.message}</p> : null) : <p role="alert" className="text-sm text-rose-700">{result.error}</p>;
}

/** Runs a server action with pending state and an inline result; refreshes server data after success. */
export function useAction() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<ActionResult | null>(null);
  const router = useRouter();
  const run = (fn: () => Promise<ActionResult>, after?: (r: ActionResult) => void) =>
    start(async () => {
      const r = await fn();
      setResult(r);
      if (r.ok) router.refresh();
      after?.(r);
    });
  return { pending, result, run, clear: () => setResult(null) };
}

type Draft = { id: string; toLabel: string; subject: string; body: string; status: string; audience: string };

/** Review, edit and confirm an outbound message. Nothing is sent until the person confirms. */
export function MessageDialog({ open, onClose, kind, caseId, workOrderId }: { open: boolean; onClose: () => void; kind: "maintenance_update_request" | "resident_update"; caseId?: string; workOrderId?: string }) {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef<string>("");
  const { pending, result, run, clear } = useAction();
  useEffect(() => {
    if (!open) return;
    keyRef.current = newKey();
    let live = true;
    draftMessageAction({ kind, caseId, workOrderId, idempotencyKey: keyRef.current }).then((r) => {
      if (!live) return;
      if (r.ok && r.data) setDraft(r.data as Draft);
      else if (!r.ok) setError(r.error);
    });
    return () => {
      live = false;
      setDraft(null);
      setError(null);
      clear();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, kind, caseId, workOrderId]);
  const sent = result?.ok;
  const cancel = () => {
    if (draft && !sent) void discardDraftAction(draft.id);
    onClose();
  };
  return (
    <Modal open={open} onClose={cancel} title={kind === "maintenance_update_request" ? "Request maintenance update" : "Update to resident"}>
      {error ? <Notice tone="rose">{error}</Notice> : null}
      {!draft && !error ? <p className="text-sm text-stone-500" aria-busy="true">Preparing a draft from the records…</p> : null}
      {draft ? (
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => sendMessageAction({ id: draft.id, subject: draft.subject, body: draft.body })); }}>
          <Notice tone="amber">Drafted from recorded facts for your review. Edit anything before sending. Delivery is simulated in this build: the message is logged on the case, no email leaves the system.</Notice>
          <p className="text-sm"><span className="text-stone-500">To:</span> <span className="font-medium">{draft.toLabel}</span></p>
          <Field label="Subject"><input className={inputCls} value={draft.subject} disabled={!!sent} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></Field>
          <Field label="Message"><textarea data-testid="message-body" className={`${inputCls} min-h-56 leading-relaxed`} value={draft.body} disabled={!!sent} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></Field>
          <ResultNote result={result} />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={cancel}>{sent ? "Close" : "Discard"}</Button>
            {!sent ? <Button variant="primary" type="submit" disabled={pending}>{pending ? "Sending…" : draft.audience === "resident" ? "Confirm and send to resident" : "Confirm and send"}</Button> : null}
          </div>
        </form>
      ) : null}
    </Modal>
  );
}

export function ApprovalRequestDialog({ open, onClose, preset }: { open: boolean; onClose: () => void; preset: { approvalType: string; title: string; detail: string; caseId?: string; unitId?: string; policyVersionId?: string } }) {
  const [title, setTitle] = useState(preset.title);
  const [detail, setDetail] = useState(preset.detail);
  const keyRef = useRef(newKey());
  const { pending, result, run } = useAction();
  return (
    <Modal open={open} onClose={onClose} title="Submit for manager review">
      <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => requestApprovalAction({ type: preset.approvalType, title, detail, caseId: preset.caseId, unitId: preset.unitId, policyVersionId: preset.policyVersionId, idempotencyKey: keyRef.current })); }}>
        <Notice>The community manager decides. Staff may not agree to the request until the decision is recorded.</Notice>
        <Field label="Request"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} disabled={!!result?.ok} /></Field>
        <Field label="Details for the manager"><textarea className={`${inputCls} min-h-36`} value={detail} onChange={(e) => setDetail(e.target.value)} disabled={!!result?.ok} /></Field>
        <ResultNote result={result} />
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>{result?.ok ? "Close" : "Cancel"}</Button>
          {!result?.ok ? <Button variant="primary" type="submit" disabled={pending}>{pending ? "Submitting…" : "Submit for review"}</Button> : null}
        </div>
      </form>
    </Modal>
  );
}

/** Human-reviewed case packet generation with an in-app preview of the resulting PDF. */
export function PacketDialog({ open, onClose, caseId, caseLabel, sourceCount, gapCount }: { open: boolean; onClose: () => void; caseId: string; caseLabel: string; sourceCount: number; gapCount: number }) {
  const [reviewed, setReviewed] = useState(false);
  const [note, setNote] = useState("");
  const [reportId, setReportId] = useState<string | null>(null);
  const { pending, result, run } = useAction();
  return (
    <Modal open={open} onClose={onClose} title={`Generate case packet — ${caseLabel}`} wide>
      {reportId ? (
        <div className="space-y-3">
          <Notice tone="green">Packet generated and stored. It lists every source by identifier and content hash.</Notice>
          <iframe title="Case packet preview" data-testid="packet-preview" src={`/api/reports/${reportId}`} className="h-[58vh] w-full rounded-lg border border-stone-200" />
          <div className="flex justify-end gap-2">
            <a className="inline-flex items-center rounded-md border border-stone-300 px-3.5 py-2 text-sm font-medium hover:bg-stone-50" href={`/api/reports/${reportId}?download=1`} data-testid="packet-download">Download PDF</a>
            <Button variant="primary" onClick={onClose}>Done</Button>
          </div>
        </div>
      ) : (
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); run(() => generatePacketAction({ caseId, reviewNote: note, reviewed }), (r) => r.ok && setReportId((r.data as { reportId: string }).reportId)); }}>
          <p className="text-sm text-stone-700">The packet is a factual compilation for management or attorney review: summary, reported-versus-observed, chronology with staff attribution, correspondence, work orders, conflicts, known limitations and a source index. It is not a legal conclusion.</p>
          <ul className="list-disc space-y-1 pl-5 text-sm text-stone-700">
            <li>{sourceCount} source records will be indexed with their SHA-256 hashes.</li>
            <li>{gapCount} evidence gaps and limitations will be stated explicitly.</li>
            <li>Only statements that pass verification against the originals are included. Tentative links are listed separately and not counted.</li>
          </ul>
          <Field label="Reviewer note (optional, printed on the packet)"><textarea className={`${inputCls} min-h-20`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Reviewed all sources on Nov 16; nothing further to add." /></Field>
          <label className="flex items-start gap-2.5 text-sm">
            <input type="checkbox" className="mt-1 h-4 w-4 accent-teal-700" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} data-testid="packet-reviewed" />
            <span>I have reviewed the timeline and opened the original records I am relying on.</span>
          </label>
          <ResultNote result={result} />
          <div className="flex justify-end gap-2">
            <Button type="button" onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" disabled={pending || !reviewed} data-testid="packet-generate">{pending ? "Generating…" : "Generate packet"}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
