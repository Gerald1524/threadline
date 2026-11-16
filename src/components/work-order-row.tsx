"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { updateWorkOrderAction } from "@/app/actions";
import { MessageDialog, ResultNote, useAction } from "./dialogs";
import { Badge, Button, StatusBadge, cx, inputCls } from "./ui";

type Wo = { id: string; number: string; title: string; description: string; status: string; unit: string | null; assignee: string | null; assigneeId: string | null; caseId: string | null; note: string | null; etaLabel: string | null; etaLocal: string; created: string; completed: string | null };
const NEXT: Record<string, string[]> = { open: ["assigned", "in_progress", "cancelled"], assigned: ["in_progress", "on_hold", "completed", "cancelled", "open"], in_progress: ["on_hold", "completed", "assigned"], on_hold: ["in_progress", "assigned", "cancelled"], completed: [], cancelled: [] };

export function WorkOrderRow({ wo, canUpdate, canAsk, staff, asked }: { wo: Wo; canUpdate: boolean; canAsk: boolean; staff: { id: string; name: string }[]; asked: boolean }) {
  const [open, setOpen] = useState(false);
  const [ask, setAsk] = useState(false);
  const [status, setStatus] = useState(wo.status);
  const [eta, setEta] = useState(wo.etaLocal);
  const [assignee, setAssignee] = useState(wo.assigneeId ?? "");
  const [note, setNote] = useState("");
  const { pending, result, run } = useAction();
  const done = ["completed", "cancelled"].includes(wo.status);
  return (
    <div data-testid={`wo-${wo.number}`}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <button type="button" onClick={() => setOpen(!open)} aria-expanded={open} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ChevronDown size={15} className={cx("shrink-0 text-stone-400 transition-transform", open && "rotate-180")} />
          <span className="min-w-0">
            <span className="block truncate text-sm font-medium text-stone-900"><span className="mr-2 font-mono text-xs text-stone-500">{wo.number}</span>{wo.title}</span>
            <span className="block text-xs text-stone-500">{wo.unit ? `Unit ${wo.unit} · ` : ""}{wo.assignee ?? "Unassigned"} · opened {wo.created}{wo.completed ? ` · completed ${wo.completed}` : ""}</span>
          </span>
        </button>
        {asked ? <Badge tone="amber">update requested</Badge> : null}
        {!done ? <Badge tone={wo.etaLabel ? "sky" : "rose"}>{wo.etaLabel ? `ETA ${wo.etaLabel}` : "No ETA"}</Badge> : null}
        <StatusBadge status={wo.status} />
        {canAsk && !done ? <Button size="sm" onClick={() => setAsk(true)} data-testid="ask-update">Request update</Button> : null}
      </div>
      {open ? (
        <div className="space-y-3 border-t border-stone-100 bg-stone-50/60 px-5 py-4 text-sm">
          {wo.description ? <p className="text-stone-700">{wo.description}</p> : null}
          {wo.note ? <p className="text-stone-700"><span className="text-stone-500">Latest note:</span> {wo.note}</p> : null}
          {wo.caseId ? <Link href={`/cases/${wo.caseId}`} className="inline-block text-brand-700 hover:underline">Open related case →</Link> : null}
          {canUpdate && !done ? (
            <form className="grid gap-2 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); run(() => updateWorkOrderAction({ id: wo.id, status: status !== wo.status ? (status as never) : undefined, etaLocal: eta !== wo.etaLocal ? eta || null : undefined, assigneeUserId: assignee !== (wo.assigneeId ?? "") ? assignee || null : undefined, note }), (r) => r.ok && setNote("")); }}>
              <label className="text-xs font-medium text-stone-600">Status<select className={`${inputCls} mt-1`} value={status} onChange={(e) => setStatus(e.target.value)} data-testid="wo-status"><option value={wo.status}>{wo.status.replace(/_/g, " ")}</option>{NEXT[wo.status].map((s) => <option key={s} value={s}>{s.replace(/_/g, " ")}</option>)}</select></label>
              <label className="text-xs font-medium text-stone-600">ETA<input type="datetime-local" className={`${inputCls} mt-1`} value={eta} onChange={(e) => setEta(e.target.value)} data-testid="wo-eta" /></label>
              <label className="text-xs font-medium text-stone-600">Assigned to<select className={`${inputCls} mt-1`} value={assignee} onChange={(e) => setAssignee(e.target.value)}><option value="">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
              <label className="text-xs font-medium text-stone-600">Note<input className={`${inputCls} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should the desk know?" data-testid="wo-note" /></label>
              <div className="flex items-center gap-3 sm:col-span-4"><Button variant="primary" size="sm" type="submit" disabled={pending} data-testid="wo-save">{pending ? "Saving…" : "Save update"}</Button><ResultNote result={result} /></div>
            </form>
          ) : null}
        </div>
      ) : null}
      {ask ? <MessageDialog open onClose={() => setAsk(false)} kind="maintenance_update_request" workOrderId={wo.id} caseId={wo.caseId ?? undefined} /> : null}
    </div>
  );
}
