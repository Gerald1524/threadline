"use client";

import { useRef, useState } from "react";
import { decideApprovalAction, requestApprovalAction } from "@/app/actions";
import { ResultNote, newKey, useAction } from "./dialogs";
import { Button, Field, inputCls } from "./ui";

export function ApprovalDecision({ id, selfRequested, createsWorkOrder }: { id: string; selfRequested: boolean; createsWorkOrder: boolean }) {
  const [note, setNote] = useState("");
  const { pending, result, run } = useAction();
  if (selfRequested) return <p className="mt-3 text-xs text-stone-500">You submitted this request, so another manager must decide it.</p>;
  return (
    <div className="mt-3 space-y-2 border-t border-stone-100 pt-3">
      <label className="block text-xs font-medium text-stone-600">Decision note (required to deny; kept on the record)
        <input data-testid="decision-note" className={`${inputCls} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. ID verified against the lease file." />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled={pending} data-testid="approve" onClick={() => run(() => decideApprovalAction({ id, decision: "approved", note: note || undefined }))}>Approve{createsWorkOrder ? " and create work order" : ""}</Button>
        <Button variant="danger" size="sm" disabled={pending} data-testid="deny" onClick={() => run(() => decideApprovalAction({ id, decision: "denied", note: note || undefined }))}>Deny</Button>
        <ResultNote result={result} />
      </div>
    </div>
  );
}

export function NewApprovalForm({ types }: { types: { id: string; label: string }[] }) {
  const [type, setType] = useState(types[0].id);
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const key = useRef(newKey());
  const { pending, result, run } = useAction();
  return (
    <form className="space-y-3 px-5 py-4" onSubmit={(e) => { e.preventDefault(); run(() => requestApprovalAction({ type, title, detail, idempotencyKey: key.current }), (r) => { if (r.ok) { setTitle(""); setDetail(""); key.current = newKey(); } }); }}>
      <Field label="Type"><select className={inputCls} value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select></Field>
      <Field label="Request"><input className={inputCls} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Replacement key — 3D" required minLength={3} /></Field>
      <Field label="Details"><textarea className={`${inputCls} min-h-24`} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="What the resident asked for and why." required minLength={3} /></Field>
      <Button variant="primary" type="submit" disabled={pending}>{pending ? "Submitting…" : "Submit for approval"}</Button>
      <ResultNote result={result} />
    </form>
  );
}
