"use client";

import { useState } from "react";
import { Clock, Paperclip } from "lucide-react";
import type { TimelineItem } from "@/lib/engine/types";
import { fmtDate, fmtTime } from "@/lib/util/time";
import { useSourcePanel } from "./source-panel";
import { Badge, CLASS_TONE, cx } from "./ui";

const who = (p: { name: string; title: string; employment: string } | null) => (p ? `${p.name}${p.employment === "temp" ? " (temp)" : ""}` : null);

export function SourceChip({ id, label }: { id: string; label?: string }) {
  const { open } = useSourcePanel();
  return (
    <button type="button" onClick={() => open(id, label)} title="Open the original record" data-testid="source-chip"
      className="mx-0.5 inline-flex items-center rounded border border-brand-100 bg-brand-50 px-1.5 py-px align-baseline text-[11px] font-semibold text-brand-800 transition-colors hover:border-brand-600 hover:bg-brand-100">
      {label ?? "source"}
    </button>
  );
}

/** Chronology with who reported, recorded, was on the desk, checked and replied at each step. */
export function Timeline({ items, labels, tz, initial = 8 }: { items: TimelineItem[]; labels: Map<string, string>; tz?: string; initial?: number }) {
  const [all, setAll] = useState(items.length <= initial + 2);
  if (!items.length) return <p className="text-sm text-stone-500">No records to show.</p>;
  const shown = all ? items : items.slice(0, initial);
  return (
    <>
    <ol className="relative space-y-3 border-l border-stone-200 pl-5" data-testid="timeline">
      {shown.map((i, idx) => {
        const day = fmtDate(i.occurredAt, tz);
        const showDay = idx === 0 || day !== fmtDate(shown[idx - 1].occurredAt, tz);
        const dim = i.status !== "active" || i.linkStatus === "suggested";
        return (
          <li key={i.eventId} className="relative">
            <span className={cx("absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-paper", i.type === "investigation" ? "bg-sky-500" : i.type === "complaint_report" ? "bg-amber-400" : i.direction === "outbound" ? "bg-slate-500" : "bg-stone-300")} aria-hidden />
            {showDay ? <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">{day}</p> : null}
            <div className={cx("rounded-lg border bg-white px-3.5 py-2.5", dim ? "border-dashed border-stone-300" : "border-stone-200")}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span className="text-sm font-semibold text-stone-900">{i.typeLabel}</span>
                <span className="text-xs text-stone-500">{fmtTime(i.occurredAt, tz)}</span>
                <SourceChip id={i.sourceId} label={labels.get(i.sourceId)} />
                {i.linkStatus === "suggested" ? <Badge tone="violet" title={i.linkRationale ?? ""}>tentative link · not counted</Badge> : null}
                {i.status === "duplicate" ? <Badge tone="neutral">duplicate entry · not counted</Badge> : null}
                {i.lateEntry ? <Badge tone="amber" title={i.recordedAt ? `Written ${fmtDate(i.recordedAt, tz)} ${fmtTime(i.recordedAt, tz)}` : ""}><Clock size={11} />late entry</Badge> : null}
                {i.outsideShift ? <Badge tone="neutral" title="Recorded or carried out by someone who was not on a scheduled shift at that time (for example on call).">outside scheduled shift</Badge> : null}
                {i.attachments.length ? <Badge tone="neutral"><Paperclip size={11} />{i.attachments.length} attachment{i.attachments.length > 1 ? "s" : ""} · unauthenticated</Badge> : null}
              </div>
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-stone-600">
                {i.reporter ? <span>From <strong className="font-medium text-stone-800">{i.reporter}{i.reporterUnit ? ` (${i.reporterUnit})` : ""}</strong></span> : null}
                {i.recordedBy ? <span>Recorded by <strong className="font-medium text-stone-800">{who(i.recordedBy)}</strong></span> : null}
                {i.onDuty ? <span>On desk: <strong className="font-medium text-stone-800">{who(i.onDuty)}</strong>, {i.onDuty.shift.toLowerCase()} shift{i.onDuty.coverage === "temp_cover" ? " (temp cover)" : ""}</span> : null}
                {i.investigatedBy ? <span>Checked by <strong className="font-medium text-stone-800">{who(i.investigatedBy)}</strong></span> : null}
                {i.respondedBy ? <span>Sent by <strong className="font-medium text-stone-800">{who(i.respondedBy)}</strong></span> : null}
                {i.assignee ? <span>Assigned to <strong className="font-medium text-stone-800">{who(i.assignee)}</strong></span> : null}
              </p>
              {i.claims.length ? (
                <ul className="mt-2 space-y-1">
                  {i.claims.slice(0, 8).map((c, k) => (
                    <li key={k} className={cx("border-l-2 py-0.5 pl-2.5 text-[13px] leading-snug text-stone-800", CLASS_TONE[c.classification].bar)}>
                      <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-stone-500">{CLASS_TONE[c.classification].short}{c.outcomeLabel ? ` · ${c.outcomeLabel}` : ""}</span>
                      {c.text}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-1 text-[13px] text-stone-700">{i.summary}</p>
              )}
            </div>
          </li>
        );
      })}
    </ol>
    {!all ? <button type="button" onClick={() => setAll(true)} data-testid="timeline-all" className="ml-5 mt-3 rounded-md border border-stone-300 bg-white px-3 py-1.5 text-xs font-medium text-stone-700 hover:bg-stone-50">Show all {items.length} records</button> : null}
    </>
  );
}
