"use client";

import { useState } from "react";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, FileText, Info, Square, Volume2 } from "lucide-react";
import { CLASS_LABEL, type Answer, type SuggestedAction } from "@/lib/engine/types";
import { fmtDateTime, relative } from "@/lib/util/time";
import { ApprovalRequestDialog, MessageDialog, PacketDialog } from "./dialogs";
import { SourceChip, Timeline } from "./timeline";
import { useSourcePanel } from "./source-panel";
import { Badge, Button, CLASS_TONE, btn, cx } from "./ui";

type Tab = "timeline" | "facts" | "gaps" | "sources";

export function AnswerView({ answer, onAsk, speech, defaultTab }: { answer: Answer; onAsk?: (q: string) => void; speech?: { speak: (text: string) => void; stop: () => void; speaking: boolean; available: boolean }; defaultTab?: Tab }) {
  const labels = new Map(answer.sources.map((s) => [s.id, s.label]));
  const gapsN = answer.gaps.length + answer.conflicts.length + answer.openItems.length;
  const [tab, setTab] = useState<Tab>(defaultTab ?? (answer.timeline.length ? "timeline" : gapsN ? "gaps" : "sources"));
  const [dialog, setDialog] = useState<SuggestedAction | null>(null);
  const [showWithheld, setShowWithheld] = useState(false);
  const { open } = useSourcePanel();
  const tabs: [Tab, string, number][] = [["timeline", "Timeline", answer.timeline.length], ["facts", "Key facts", answer.facts.length], ["gaps", "Gaps & open items", gapsN], ["sources", "Sources", answer.sources.length]];

  return (
    <article className="fade-in rounded-xl border border-stone-200 bg-white shadow-[0_1px_2px_rgb(0_0_0/0.04)]" data-testid="answer" data-intent={answer.intent}>
      <div className="px-5 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          {answer.caseRef ? <Link href={`/cases/${answer.caseRef.id}`} className="text-xs font-semibold text-brand-700 hover:underline">{answer.caseRef.number}</Link> : null}
          <Badge tone={answer.mode === "model" ? "violet" : "neutral"} title={answer.modeNote}><Info size={11} />{answer.mode === "model" ? "AI narrative, verified" : "Composed from records"}</Badge>
          {answer.verification.checked ? (
            <Badge tone={answer.verification.withheld ? "amber" : "green"} title="Each statement was re-checked against the original records it cites."><CheckCircle2 size={11} />{answer.verification.verified} of {answer.verification.checked} statements verified</Badge>
          ) : null}
          <span className="text-[11px] text-stone-400">{answer.latencyMs} ms</span>
          {speech?.available ? (
            <button type="button" onClick={() => (speech.speaking ? speech.stop() : speech.speak(answer.speakable))} className={cx(btn("ghost", "sm"), "ml-auto")} aria-pressed={speech.speaking} data-testid="read-aloud">
              {speech.speaking ? <><Square size={13} />Stop</> : <><Volume2 size={14} />Read aloud</>}
            </button>
          ) : null}
        </div>
        <p className="mt-2.5 text-[17px] font-semibold leading-snug text-stone-900" data-testid="answer-headline">{answer.headline}</p>
        {answer.mode === "deterministic" && !/No AI model is configured/.test(answer.modeNote) ? <p className="mt-1.5 text-xs text-amber-800">{answer.modeNote}</p> : null}
      </div>

      {answer.claims.length ? (
        <ul className="mt-3 space-y-2 px-5" data-testid="answer-claims">
          {answer.claims.map((c) => (
            <li key={c.id} className={cx("border-l-[3px] py-0.5 pl-3", CLASS_TONE[c.classification].bar)}>
              <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-wide text-stone-500">{CLASS_LABEL[c.classification]}</span>
              <span className="text-sm leading-relaxed text-stone-800">{c.text}</span>
              {c.sourceIds.map((id) => <SourceChip key={id} id={id} label={labels.get(id)} />)}
            </li>
          ))}
        </ul>
      ) : null}

      {answer.withheld.length ? (
        <div className="mx-5 mt-3 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900 ring-1 ring-inset ring-amber-200">
          <button type="button" className="flex items-center gap-1.5 font-medium" onClick={() => setShowWithheld(!showWithheld)} aria-expanded={showWithheld}>
            <AlertTriangle size={14} />{answer.withheld.length} statement{answer.withheld.length > 1 ? "s" : ""} withheld: could not be verified against the records
          </button>
          {showWithheld ? <ul className="mt-2 space-y-1.5">{answer.withheld.map((c) => <li key={c.id}><span className="line-through decoration-amber-700/50">{c.text}</span><span className="block text-xs">Reason: {c.issue}</span></li>)}</ul> : null}
        </div>
      ) : null}
      {answer.restrictedNote ? <p className="mx-5 mt-3 rounded-lg bg-stone-100 px-3.5 py-2 text-sm text-stone-700">{answer.restrictedNote}</p> : null}

      {answer.actions.length ? (
        <div className="mt-4 flex flex-wrap gap-2 px-5" data-testid="answer-actions">
          {answer.actions.map((a, i) =>
            a.kind === "link" ? <Link key={i} href={a.href} className={btn("secondary", "sm")}>{a.label}</Link>
              : <Button key={i} size="sm" variant={a.kind === "generate_packet" ? "primary" : "secondary"} onClick={() => setDialog(a)}>{a.kind === "generate_packet" ? <FileText size={13} /> : null}{a.label}</Button>,
          )}
        </div>
      ) : null}

      {tabs.some(([, , n]) => n > 0) ? (
        <>
          <div role="tablist" aria-label="Evidence" className="mt-4 flex gap-1 overflow-x-auto border-b border-stone-200 px-4">
            {tabs.filter(([, , n]) => n > 0).map(([id, label, n]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} data-testid={`tab-${id}`}
                className={cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors", tab === id ? "border-brand-700 text-brand-800" : "border-transparent text-stone-500 hover:text-stone-800")}>
                {label} <span className="text-xs text-stone-400">{n}</span>
              </button>
            ))}
          </div>
          <div role="tabpanel" className="px-5 py-4">
            {tab === "timeline" ? <Timeline items={answer.timeline} labels={labels} /> : null}
            {tab === "facts" ? (
              <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-2" data-testid="facts">
                {answer.facts.map((f) => (
                  <div key={f.key} className="flex items-baseline justify-between gap-3 border-b border-stone-100 pb-1.5">
                    <dt className="text-sm text-stone-600">{f.label}</dt>
                    <dd className="text-right text-sm font-semibold text-stone-900" data-fact={f.key}>{f.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {tab === "gaps" ? (
              <div className="space-y-4" data-testid="gaps">
                {([["What the records do not show", answer.gaps, "rose"], ["Conflicting records", answer.conflicts, "amber"], ["Open items", answer.openItems, "sky"]] as const).map(([title, list, tone]) =>
                  list.length ? (
                    <section key={title}>
                      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-stone-500">{title}</h3>
                      <ul className="space-y-1.5">
                        {list.map((g, i) => (
                          <li key={i} className={cx("rounded-lg px-3 py-2 text-sm ring-1 ring-inset", tone === "rose" ? "bg-rose-50/60 ring-rose-100" : tone === "amber" ? "bg-amber-50/60 ring-amber-100" : "bg-sky-50/60 ring-sky-100")}>
                            {g.text}{g.sourceIds.map((id) => (labels.has(id) ? <SourceChip key={id} id={id} label={labels.get(id)} /> : null))}
                          </li>
                        ))}
                      </ul>
                    </section>
                  ) : null,
                )}
              </div>
            ) : null}
            {tab === "sources" ? (
              <ul className="divide-y divide-stone-100" data-testid="sources">
                {answer.sources.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => open(s.id, s.label)} className="flex w-full items-center gap-3 rounded-md px-1 py-2 text-left hover:bg-stone-50">
                      <span className="w-9 shrink-0 rounded bg-brand-50 px-1 py-0.5 text-center text-[11px] font-semibold text-brand-800">{s.label}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-stone-900">{s.title}</span>
                        <span className="block truncate text-xs text-stone-500">{s.sourceName}{s.author ? ` · ${s.author}` : ""}{s.occurredAt ? ` · ${fmtDateTime(s.occurredAt)}` : ""}</span>
                      </span>
                      {s.flagged ? <Badge tone="rose">flagged</Badge> : null}
                      <span className="hidden font-mono text-[10px] text-stone-400 sm:block">{s.contentHash.slice(0, 10)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </>
      ) : null}

      {answer.coverage.length ? (
        <footer className="border-t border-stone-100 px-5 py-2.5 text-xs text-stone-500">
          <span className="font-medium text-stone-600">Source coverage: </span>
          {answer.coverage.map((c) => `${c.sourceName} (last import ${relative(c.lastSuccessAt, new Date())})`).join(" · ")}. A missing record is not proof that nothing happened.
        </footer>
      ) : null}

      {onAsk && answer.suggestions.length ? (
        <div className="flex flex-wrap gap-1.5 border-t border-stone-100 px-5 py-3">
          {answer.suggestions.map((s) => <button key={s} type="button" onClick={() => onAsk(s)} className="rounded-full border border-stone-300 bg-white px-3 py-1 text-xs text-stone-700 transition-colors hover:border-brand-600 hover:text-brand-800">{s}</button>)}
        </div>
      ) : null}

      {dialog?.kind === "draft_message" ? <MessageDialog open onClose={() => setDialog(null)} kind={dialog.messageKind} caseId={dialog.caseId} workOrderId={dialog.workOrderId} /> : null}
      {dialog?.kind === "request_approval" ? <ApprovalRequestDialog open onClose={() => setDialog(null)} preset={dialog} /> : null}
      {dialog?.kind === "generate_packet" && answer.caseRef ? <PacketDialog open onClose={() => setDialog(null)} caseId={dialog.caseId} caseLabel={answer.caseRef.number} sourceCount={answer.sources.length} gapCount={answer.gaps.length} /> : null}
    </article>
  );
}
