"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Download, ShieldAlert, X } from "lucide-react";
import type { Classification } from "@/lib/engine/types";
import { fmtDateTime } from "@/lib/util/time";
import { Badge, CLASS_TONE, cx } from "./ui";

type SourceDetail = {
  id: string; kind: string; title: string; externalId: string; locator: string; sourceName: string; author: string | null; filename: string | null;
  occurredAt: string | null; recordedAt: string | null; ingestedAt: string; contentHash: string; version: number; isCurrent: boolean; hashVerified: boolean | null;
  sensitivity: string; visibility: string; flagged: boolean; lifecycle: string; text: string; fields: Record<string, unknown>;
  attachments: { id: string; filename: string; mediaType: string; byteSize: number; sha256: string }[];
  events: { id: string; type: string; status: string; occurredAt: string; extraction: string; confidence: number; recorder: string | null; investigator: string | null; claims: { classification: Classification; outcome: string | null; text: string }[] }[];
  versions: { id: string; version: number; isCurrent: boolean; ingestedAt: string }[];
  corrections: { id: string; sourceId: string; summary: string; at: string; by: string | null }[];
};

const Ctx = createContext<{ open: (id: string, label?: string) => void }>({ open: () => {} });
export const useSourcePanel = () => useContext(Ctx);

const KIND: Record<string, string> = { shift_note: "Shift log entry", email: "Email", work_order: "Work order", policy_doc: "Policy document", document: "Document", manual_entry: "Threadline entry" };

export function SourcePanelProvider({ children }: { children: React.ReactNode }) {
  const [id, setId] = useState<string | null>(null);
  const [label, setLabel] = useState<string | undefined>();
  const [data, setData] = useState<SourceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const lastFocus = useRef<HTMLElement | null>(null);

  const open = useCallback((sid: string, l?: string) => {
    lastFocus.current = document.activeElement as HTMLElement;
    setData(null);
    setError(null);
    setLabel(l);
    setId(sid);
  }, []);
  const close = useCallback(() => {
    setId(null);
    lastFocus.current?.focus();
  }, []);

  useEffect(() => {
    if (!id) return;
    let live = true;
    fetch(`/api/source/${id}`).then(async (r) => {
      if (!live) return;
      if (r.ok) setData(await r.json());
      else setError(r.status === 404 ? "This record is not available to your role, or no longer exists." : "The record could not be loaded.");
    }).catch(() => live && setError("The record could not be loaded."));
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => {
      live = false;
      window.removeEventListener("keydown", onKey);
    };
  }, [id, close]);

  const f = (data?.fields ?? {}) as { columns?: Record<string, string>; from?: { name: string; address: string }; to?: { name: string; address: string }[]; subject?: string; date?: string; inReplyTo?: string | null };
  return (
    <Ctx.Provider value={{ open }}>
      {children}
      {id ? (
        <>
          <div className="fixed inset-0 z-30 bg-stone-900/30" onClick={close} aria-hidden />
          <aside role="dialog" aria-modal="true" aria-label="Original record" data-open="true" data-testid="source-panel" className="drawer fixed inset-y-0 right-0 z-40 flex w-full max-w-xl flex-col border-l border-stone-200 bg-white shadow-2xl">
            <header className="flex items-start justify-between gap-3 border-b border-stone-200 px-5 py-4">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-stone-500">
                  {label ? <span className="rounded bg-brand-700 px-1.5 py-0.5 text-[11px] font-semibold text-white">{label}</span> : null}
                  Original record {data ? `· ${KIND[data.kind] ?? data.kind}` : ""}
                </p>
                <h2 className="mt-1 text-base font-semibold text-stone-900">{data?.title ?? (error ? "Unavailable" : "Loading…")}</h2>
              </div>
              <button ref={closeRef} onClick={close} aria-label="Close record" className="rounded-md p-1.5 text-stone-500 hover:bg-stone-100"><X size={18} /></button>
            </header>
            <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4 text-sm">
              {error ? <p role="alert" className="text-stone-700">{error}</p> : null}
              {!data && !error ? <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-4 animate-pulse rounded bg-stone-100" style={{ width: `${90 - i * 14}%` }} />)}</div> : null}
              {data ? (
                <>
                  {data.flagged ? (
                    <div className="flex gap-2 rounded-lg bg-rose-50 p-3 text-rose-900 ring-1 ring-inset ring-rose-200">
                      <ShieldAlert size={16} className="mt-0.5 shrink-0" />
                      <p><strong>Contains text addressed to an AI system.</strong> Threadline stores it as evidence only. It is never followed as an instruction and is withheld from AI model prompts.</p>
                    </div>
                  ) : null}
                  {data.lifecycle !== "active" ? <p className="rounded-lg bg-stone-100 p-3 text-stone-700">This record was {data.lifecycle} under an approved retention action.</p> : null}
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-[13px]">
                    <dt className="text-stone-500">Source</dt><dd>{data.sourceName}</dd>
                    <dt className="text-stone-500">Identifier</dt><dd className="break-all font-mono text-xs">{data.externalId}</dd>
                    <dt className="text-stone-500">Location</dt><dd className="break-all font-mono text-xs">{data.locator}</dd>
                    {data.author ? <><dt className="text-stone-500">Author</dt><dd>{data.author}</dd></> : null}
                    {data.occurredAt ? <><dt className="text-stone-500">Event time</dt><dd>{fmtDateTime(data.occurredAt)}</dd></> : null}
                    {data.recordedAt && data.recordedAt !== data.occurredAt ? <><dt className="text-stone-500">Written</dt><dd>{fmtDateTime(data.recordedAt)}</dd></> : null}
                    <dt className="text-stone-500">Imported</dt><dd>{fmtDateTime(data.ingestedAt)}</dd>
                    <dt className="text-stone-500">Class</dt><dd>{data.sensitivity} · visible to {data.visibility === "staff" ? "all property staff" : data.visibility}</dd>
                    <dt className="text-stone-500">SHA-256</dt>
                    <dd className="flex flex-wrap items-center gap-2"><span className="break-all font-mono text-xs">{data.contentHash.slice(0, 32)}…</span>{data.hashVerified === true ? <Badge tone="green">matches stored content</Badge> : data.hashVerified === false ? <Badge tone="rose">does not match</Badge> : null}</dd>
                    <dt className="text-stone-500">Version</dt><dd>{data.version}{data.isCurrent ? " (current)" : " (superseded)"}{data.versions.length > 1 ? ` of ${data.versions.length}` : ""}</dd>
                  </dl>

                  {data.kind === "email" && f.from ? (
                    <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-[13px]">
                      <p><span className="text-stone-500">From:</span> {f.from.name} &lt;{f.from.address}&gt;</p>
                      <p><span className="text-stone-500">To:</span> {(f.to ?? []).map((x) => `${x.name} <${x.address}>`).join(", ")}</p>
                      <p><span className="text-stone-500">Subject:</span> {f.subject}</p>
                      {f.inReplyTo ? <p><span className="text-stone-500">In reply to:</span> <span className="font-mono text-xs">{f.inReplyTo}</span></p> : null}
                    </div>
                  ) : null}
                  {f.columns ? (
                    <table className="w-full border-collapse text-[13px]">
                      <tbody>{Object.entries(f.columns).filter(([k]) => !/notes|what happened|description|resolution/i.test(k)).map(([k, v]) => <tr key={k} className="border-b border-stone-100"><th className="w-32 py-1 pr-3 text-left font-normal text-stone-500">{k}</th><td className="py-1">{v || "—"}</td></tr>)}</tbody>
                    </table>
                  ) : null}

                  <section>
                    <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">Original text</h3>
                    <pre data-testid="source-text" className="whitespace-pre-wrap rounded-lg border border-stone-200 bg-white p-3 font-sans text-[13px] leading-relaxed text-stone-900">{data.text}</pre>
                  </section>

                  {data.attachments.length ? (
                    <section>
                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">Attachments</h3>
                      <ul className="space-y-1.5">{data.attachments.map((a) => (
                        <li key={a.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2">
                          <span className="min-w-0"><span className="block truncate font-medium">{a.filename}</span><span className="block text-xs text-stone-500">{a.mediaType} · {a.byteSize} bytes · supplied by the sender, not authenticated</span></span>
                          <a href={`/api/blob/${a.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:underline"><Download size={14} />Download</a>
                        </li>
                      ))}</ul>
                    </section>
                  ) : null}

                  {data.events.some((e) => e.claims.length) ? (
                    <section>
                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">How Threadline read it</h3>
                      {data.events.filter((e) => e.claims.length).map((e) => (
                        <div key={e.id} className="mb-3">
                          <p className="mb-1 text-xs text-stone-500">{e.type.replace(/_/g, " ")} · {fmtDateTime(e.occurredAt)}{e.investigator ? ` · checked by ${e.investigator}` : ""}{e.recorder ? ` · recorded by ${e.recorder}` : ""} · {e.extraction} extraction{e.confidence < 1 ? `, confidence ${e.confidence}` : ""}{e.status !== "active" ? ` · ${e.status}` : ""}</p>
                          <ul className="space-y-1">{e.claims.map((c, i) => (
                            <li key={i} className={cx("border-l-2 py-0.5 pl-2.5", CLASS_TONE[c.classification]?.bar)}>
                              <Badge tone={CLASS_TONE[c.classification]?.tone}>{CLASS_TONE[c.classification]?.short}{c.outcome ? ` · ${c.outcome}` : ""}</Badge> <span className="text-[13px]">{c.text}</span>
                            </li>
                          ))}</ul>
                        </div>
                      ))}
                      <p className="text-xs text-stone-500">Classifications are suggestions made by rules. The original text above is the record.</p>
                    </section>
                  ) : null}

                  {data.corrections.length ? (
                    <section>
                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">Corrections added later</h3>
                      <ul className="space-y-1">{data.corrections.map((c) => <li key={c.id}><button className="text-left text-brand-700 hover:underline" onClick={() => open(c.sourceId)}>{fmtDateTime(c.at)} — {c.by ?? "staff"}: {c.summary}</button></li>)}</ul>
                    </section>
                  ) : null}
                  {data.versions.length > 1 ? (
                    <section>
                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">Versions</h3>
                      <ul className="space-y-1">{data.versions.map((v) => <li key={v.id}><button className={cx("text-left hover:underline", v.id === data.id ? "font-medium text-stone-900" : "text-brand-700")} onClick={() => open(v.id, label)}>Version {v.version}{v.isCurrent ? " (current)" : ""} — imported {fmtDateTime(v.ingestedAt)}</button></li>)}</ul>
                    </section>
                  ) : null}
                </>
              ) : null}
            </div>
          </aside>
        </>
      ) : null}
    </Ctx.Provider>
  );
}
