"use client";

import { useState } from "react";
import { FileText, Lock } from "lucide-react";
import { legalHoldAction, setCaseStatusAction } from "@/app/actions";
import { PacketDialog, ResultNote, useAction } from "./dialogs";
import { Button, Card, CardHeader, inputCls } from "./ui";

const NEXT: Record<string, string[]> = { open: ["investigating", "awaiting_response", "resolved"], investigating: ["awaiting_response", "resolved", "open"], awaiting_response: ["investigating", "resolved", "open"], resolved: ["closed", "open"], closed: ["open"] };

export function CaseControls({ caseId, caseNumber, status, canManage, canPacket, hold, canReleaseHold, sourceCount, gapCount }: { caseId: string; caseNumber: string; status: string; canManage: boolean; canPacket: boolean; hold: { id: string; reason: string } | null; canReleaseHold: boolean; sourceCount: number; gapCount: number }) {
  const [packet, setPacket] = useState(false);
  const [next, setNext] = useState(NEXT[status]?.[0] ?? "");
  const [note, setNote] = useState("");
  const [reason, setReason] = useState("");
  const st = useAction();
  const hd = useAction();
  if (!canManage && !canPacket) return null;
  return (
    <Card>
      <CardHeader title="Case actions" hint="Every action is recorded with your name and the time." />
      <div className="space-y-4 px-5 py-4">
        {canPacket ? <Button variant="primary" className="w-full" onClick={() => setPacket(true)} data-testid="open-packet"><FileText size={15} />Generate Case Packet</Button> : null}
        {canManage ? (
          <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); st.run(() => setCaseStatusAction({ caseId, status: next as never, note: note || undefined }), (r) => r.ok && setNote("")); }}>
            <label className="block text-xs font-semibold uppercase tracking-wide text-stone-500" htmlFor="case-status">Change status</label>
            <select id="case-status" className={inputCls} value={next} onChange={(e) => setNext(e.target.value)}>{(NEXT[status] ?? []).map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select>
            <input className={inputCls} placeholder="Reason (kept on the record)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Reason" />
            <Button type="submit" size="sm" disabled={st.pending}>{st.pending ? "Saving…" : "Update status"}</Button>
            <ResultNote result={st.result} />
          </form>
        ) : null}
        {canManage ? (
          <div className="space-y-2 border-t border-stone-100 pt-3">
            <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500"><Lock size={12} />Legal hold</p>
            {hold ? (
              <>
                <p className="text-sm text-stone-700">In place: {hold.reason}</p>
                {canReleaseHold ? <Button size="sm" variant="danger" disabled={hd.pending} onClick={() => hd.run(() => legalHoldAction({ releaseId: hold.id }))}>Release hold</Button> : <p className="text-xs text-stone-500">Only an organization admin can release a hold.</p>}
              </>
            ) : (
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); hd.run(() => legalHoldAction({ caseId, reason })); }}>
                <input className={inputCls} placeholder="Reason for preserving these records" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for legal hold" />
                <Button type="submit" size="sm" disabled={hd.pending || reason.trim().length < 5}>Place legal hold</Button>
              </form>
            )}
            <ResultNote result={hd.result} />
          </div>
        ) : null}
      </div>
      <PacketDialog open={packet} onClose={() => setPacket(false)} caseId={caseId} caseLabel={caseNumber} sourceCount={sourceCount} gapCount={gapCount} />
    </Card>
  );
}
