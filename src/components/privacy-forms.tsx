"use client";

import { useState } from "react";
import { decideLifecycleAction, exportAction, proposeLifecycleAction, setExcludedAction, setSourceStatusAction, updateProviderPolicyAction, updateRetentionAction } from "@/app/actions";
import type { AiTask } from "@/lib/ai/provider";
import { ResultNote, useAction } from "./dialogs";
import { Badge, Button, StatusBadge, inputCls } from "./ui";

type Cls = { id: string; label: string };

export function SourceStatusButtons({ sourceId, status }: { sourceId: string; status: string }) {
  const { pending, result, run } = useAction();
  const set = (s: "active" | "paused" | "disconnected") => run(() => setSourceStatusAction({ sourceId, status: s }));
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {status === "active" ? <Button size="sm" disabled={pending} onClick={() => set("paused")} data-testid="pause-source">Pause</Button> : <Button size="sm" disabled={pending} onClick={() => set("active")} data-testid="resume-source">Resume</Button>}
      {status !== "disconnected" ? <Button size="sm" variant="danger" disabled={pending} onClick={() => set("disconnected")}>Disconnect</Button> : null}
      {!result?.ok ? <ResultNote result={result} /> : null}
    </span>
  );
}

export function ProviderRow({ task, label, selected, allowed, options, classes, editable }: { task: string; label: string; selected: string; allowed: string[]; options: { id: string; label: string; note: string; external: boolean; configured: boolean; envKey: string | null }[]; classes: Cls[]; editable: boolean }) {
  const [provider, setProvider] = useState(selected);
  const [allow, setAllow] = useState(allowed);
  const { pending, result, run } = useAction();
  const opt = options.find((o) => o.id === provider);
  const dirty = provider !== selected || allow.slice().sort().join() !== allowed.slice().sort().join();
  return (
    <div className="grid gap-3 px-5 py-4 lg:grid-cols-[220px_minmax(0,1fr)]" data-testid={`provider-${task}`}>
      <div>
        <p className="text-sm font-medium text-stone-900">{label}</p>
        <select aria-label={`Provider for ${label}`} className={`${inputCls} mt-1.5`} value={provider} disabled={!editable} onChange={(e) => setProvider(e.target.value)}>{options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
      </div>
      <div className="text-sm">
        <p className="text-stone-600">{opt?.note}</p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
          {opt?.external ? <Badge tone="amber">data leaves Threadline</Badge> : <Badge tone="green">stays in Threadline</Badge>}
          {opt?.envKey ? (opt.configured ? <Badge tone="green">credential configured</Badge> : <Badge tone="rose">no credential: {opt.envKey} is not set</Badge>) : null}
        </p>
        {opt?.external ? (
          <fieldset className="mt-2" disabled={!editable}>
            <legend className="text-xs font-medium text-stone-600">Record classes this provider may process</legend>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
              {classes.map((c) => <label key={c.id} className="flex items-center gap-1.5 text-xs"><input type="checkbox" className="accent-teal-700" checked={allow.includes(c.id)} onChange={(e) => setAllow(e.target.checked ? [...allow, c.id] : allow.filter((x) => x !== c.id))} />{c.label}</label>)}
            </div>
          </fieldset>
        ) : null}
        {editable && dirty ? <div className="mt-2 flex items-center gap-2"><Button size="sm" variant="primary" disabled={pending} data-testid="save-provider" onClick={() => run(() => updateProviderPolicyAction({ task: task as AiTask, provider, allowedSensitivity: opt?.external ? allow : [] }))}>Save</Button></div> : null}
        <ResultNote result={result} />
      </div>
    </div>
  );
}

export function RetentionRow({ recordClass, label, days, active, archived, disposed, editable }: { recordClass: string; label: string; days: number | null; active: number; archived: number; disposed: number; editable: boolean }) {
  const [value, setValue] = useState(days === null ? "" : String(days));
  const { pending, result, run } = useAction();
  const dirty = value !== (days === null ? "" : String(days));
  return (
    <div className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
      <div className="min-w-0 flex-1"><p className="font-medium text-stone-900">{label}</p><p className="text-xs text-stone-500">{active} active{archived ? ` · ${archived} archived` : ""}{disposed ? ` · ${disposed} disposed` : ""}</p></div>
      <label className="flex items-center gap-1.5 text-xs text-stone-600">Keep<input aria-label={`Retention days for ${label}`} className={`${inputCls} w-24`} inputMode="numeric" placeholder="forever" value={value} disabled={!editable} onChange={(e) => setValue(e.target.value.replace(/\D/g, ""))} />days</label>
      {editable && dirty ? <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => updateRetentionAction({ recordClass, days: value ? Number(value) : null }))}>Save</Button> : null}
      {!result?.ok ? <ResultNote result={result} /> : null}
    </div>
  );
}

export function ScopePanel({ classes, excluded, editable }: { classes: Cls[]; excluded: string[]; editable: boolean }) {
  const [ex, setEx] = useState(excluded);
  const { pending, result, run } = useAction();
  return (
    <div className="space-y-2 px-5 py-4">
      {classes.map((c) => <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-teal-700" disabled={!editable} checked={!ex.includes(c.id)} onChange={(e) => setEx(e.target.checked ? ex.filter((x) => x !== c.id) : [...ex, c.id])} />{c.label}{ex.includes(c.id) ? <Badge tone="rose">not ingested</Badge> : null}</label>)}
      {editable && ex.slice().sort().join() !== excluded.slice().sort().join() ? <Button size="sm" variant="primary" disabled={pending} onClick={() => run(() => setExcludedAction(ex))}>Save scope</Button> : null}
      <ResultNote result={result} />
    </div>
  );
}

type Req = { id: string; action: string; recordClass: string; olderThan: string; status: string; matched: number; held: number; affected: number };

export function LifecyclePanel({ classes, requests, editable }: { classes: Cls[]; requests: Req[]; editable: boolean }) {
  const [action, setAction] = useState<"archive" | "dispose">("archive");
  const [cls, setCls] = useState("internal_ops");
  const [date, setDate] = useState("2026-10-01");
  const [confirm, setConfirm] = useState<Record<string, string>>({});
  const propose = useAction();
  const decide = useAction();
  return (
    <div className="space-y-4 px-5 py-4">
      {editable ? (
        <form className="flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); propose.run(() => proposeLifecycleAction({ action, recordClass: cls, olderThanDate: date })); }}>
          <label className="text-xs font-medium text-stone-600">Action<select className={`${inputCls} mt-1 w-32`} value={action} onChange={(e) => setAction(e.target.value as "archive")}><option value="archive">Archive</option><option value="dispose">Dispose</option></select></label>
          <label className="text-xs font-medium text-stone-600">Record class<select className={`${inputCls} mt-1 w-64`} value={cls} onChange={(e) => setCls(e.target.value)}>{classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
          <label className="text-xs font-medium text-stone-600">Dated before<input type="date" className={`${inputCls} mt-1`} value={date} onChange={(e) => setDate(e.target.value)} /></label>
          <Button type="submit" disabled={propose.pending} data-testid="propose-lifecycle">Propose</Button>
          <ResultNote result={propose.result} />
        </form>
      ) : null}
      {requests.length ? (
        <ul className="divide-y divide-stone-100 rounded-lg border border-stone-200">
          {requests.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm" data-testid="lifecycle-request">
              <span className="min-w-0 flex-1"><span className="font-medium capitalize">{r.action}</span> {r.recordClass} dated before {r.olderThan}<span className="block text-xs text-stone-500">{r.matched} match · {r.held} under legal hold (skipped){r.status === "executed" ? ` · ${r.affected} ${r.action === "archive" ? "archived" : "disposed"}` : ""}</span></span>
              <StatusBadge status={r.status} />
              {editable && r.status === "proposed" ? (
                <span className="flex items-center gap-1.5">
                  <input aria-label={`Type ${r.action.toUpperCase()} to confirm`} className={`${inputCls} w-32`} placeholder={`Type ${r.action.toUpperCase()}`} value={confirm[r.id] ?? ""} onChange={(e) => setConfirm({ ...confirm, [r.id]: e.target.value })} data-testid="lifecycle-confirm" />
                  <Button size="sm" variant="danger" disabled={decide.pending || confirm[r.id] !== r.action.toUpperCase()} data-testid="lifecycle-execute" onClick={() => decide.run(() => decideLifecycleAction({ id: r.id, decision: "execute", confirm: confirm[r.id] }))}>Approve and run</Button>
                  <Button size="sm" disabled={decide.pending} onClick={() => decide.run(() => decideLifecycleAction({ id: r.id, decision: "reject" }))}>Reject</Button>
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-stone-500">No archival or disposal has been proposed.</p>}
      <ResultNote result={decide.result} />
    </div>
  );
}

export function ExportPanel({ exports, editable }: { exports: { id: string; at: string; sha: string; records: number }[]; editable: boolean }) {
  const { pending, result, run } = useAction();
  return (
    <div className="space-y-3 px-5 py-4 text-sm">
      {editable ? <Button variant="primary" disabled={pending} data-testid="create-export" onClick={() => run(() => exportAction())}>{pending ? "Preparing…" : "Create export"}</Button> : null}
      {!result?.ok ? <ResultNote result={result} /> : null}
      {exports.length ? <ul className="space-y-1.5">{exports.map((e) => <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-stone-200 px-3 py-2" data-testid="export-row"><span>{e.at} · {e.records} source records<span className="block font-mono text-[11px] text-stone-500">sha256 {e.sha.slice(0, 24)}…</span></span>{editable ? <a href={`/api/export/${e.id}`} className="text-xs font-medium text-brand-700 hover:underline">Download JSON</a> : null}</li>)}</ul> : <p className="text-stone-500">No export has been created.</p>}
    </div>
  );
}
