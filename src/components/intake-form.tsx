"use client";

import { useCallback, useRef, useState } from "react";
import { Mic, Square } from "lucide-react";
import { confirmIntakeAction, previewIntakeAction } from "@/app/actions";
import type { Classification } from "@/lib/engine/types";
import { fmtDateTime } from "@/lib/util/time";
import { ResultNote, newKey, useAction } from "./dialogs";
import { Badge, Button, CLASS_TONE, Field, Notice, cx, inputCls } from "./ui";
import { useDictation, type VoiceConfig } from "./voice";

type Preview = { events: { type: string; categoryLabel: string; unit: string | null; reporterUnit: string | null; reporterName: string | null; occurredAt: string; claims: { classification: Classification; outcome?: string; text: string }[] }[]; flags: string[] };

/** Incident intake by typing or dictation: transcript -> review how it was read -> confirm -> saved once. */
export function IntakeForm({ voice }: { voice: VoiceConfig }) {
  const [text, setText] = useState("");
  const [unit, setUnit] = useState("");
  const [type, setType] = useState("");
  const [dictated, setDictated] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const key = useRef(newKey());
  const pv = useAction();
  const save = useAction();
  const onText = useCallback((t: string) => {
    setText(t);
    setDictated(true);
    setPreview(null);
  }, []);
  const dictation = useDictation(voice, onText);
  const input = () => ({ text, unit: unit || undefined, type: type as "" | "Complaint" | "Inspection" | "Request" | "Note", inputMode: dictated ? ("voice" as const) : ("text" as const), idempotencyKey: key.current });
  const reset = () => {
    setText(""); setUnit(""); setType(""); setDictated(false); setPreview(null);
    key.current = newKey();
  };
  return (
    <div className="space-y-3 px-5 py-4">
      <Field label="What happened">
        <div className="relative">
          <textarea data-testid="intake-text" className={`${inputCls} min-h-32 pr-11`} value={text} onChange={(e) => { setText(e.target.value); setPreview(null); }} placeholder="Ms. Liu (13B) called, says there is loud banging from 14B. Asked Carlos to check." />
          {dictation.available ? (
            <button type="button" data-testid="intake-mic" onClick={() => (dictation.listening ? dictation.stop() : void dictation.start())} aria-pressed={dictation.listening} aria-label={dictation.listening ? "Stop dictation" : "Dictate"} className={cx("absolute right-2 top-2 grid h-8 w-8 place-items-center rounded-full border", dictation.listening ? "recording border-rose-300 bg-rose-600 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50")}>
              {dictation.listening ? <Square size={13} /> : <Mic size={15} />}
            </button>
          ) : null}
        </div>
      </Field>
      {dictated ? <p className="text-xs text-stone-500" role="status">Dictated. Check the transcript and correct anything that was misheard. Audio is not kept.</p> : null}
      {dictation.error ? <p className="text-xs text-rose-700">{dictation.error}</p> : null}
      <div className="grid grid-cols-2 gap-2">
        <Field label="Unit"><input className={inputCls} value={unit} onChange={(e) => { setUnit(e.target.value); setPreview(null); }} placeholder="13B" /></Field>
        <Field label="Type">
          <select className={inputCls} value={type} onChange={(e) => { setType(e.target.value); setPreview(null); }}>
            <option value="">Work it out</option><option>Complaint</option><option>Inspection</option><option>Request</option><option>Note</option>
          </select>
        </Field>
      </div>
      {!preview ? (
        <>
          <Button variant="primary" className="w-full" disabled={pv.pending || text.trim().length < 8} data-testid="intake-preview" onClick={() => pv.run(async () => { const r = await previewIntakeAction(input()); if (r.ok) setPreview(r.data as Preview); return r; })}>{pv.pending ? "Reading…" : "Review entry"}</Button>
          {!pv.result?.ok ? <ResultNote result={pv.result} /> : null}
        </>
      ) : (
        <div className="space-y-3" data-testid="intake-review">
          <p className="text-xs font-semibold uppercase tracking-wide text-stone-500">How this will be recorded</p>
          {preview.events.map((e, i) => (
            <div key={i} className="rounded-lg border border-stone-200 p-3 text-sm">
              <p className="flex flex-wrap items-center gap-1.5 font-medium text-stone-900">{e.type.replace(/_/g, " ")}<Badge tone="brand">{e.categoryLabel}</Badge>{e.unit ? <Badge>about {e.unit}</Badge> : null}{e.reporterUnit ? <Badge>from {e.reporterName ? `${e.reporterName}, ` : ""}{e.reporterUnit}</Badge> : null}</p>
              <p className="mt-0.5 text-xs text-stone-500">{fmtDateTime(e.occurredAt)}</p>
              <ul className="mt-2 space-y-1">{e.claims.map((c, k) => <li key={k} className={cx("border-l-2 pl-2 text-[13px]", CLASS_TONE[c.classification].bar)}><span className="mr-1 text-[11px] font-semibold uppercase text-stone-500">{CLASS_TONE[c.classification].short}</span>{c.text}</li>)}</ul>
            </div>
          ))}
          {preview.flags.map((f) => <Notice key={f} tone="amber">{f}</Notice>)}
          {save.result?.ok ? (
            <><ResultNote result={save.result} /><Button className="w-full" onClick={reset}>New entry</Button></>
          ) : (
            <div className="flex gap-2">
              <Button className="flex-1" onClick={() => setPreview(null)}>Edit</Button>
              <Button variant="primary" className="flex-1" disabled={save.pending} data-testid="intake-confirm" onClick={() => save.run(() => confirmIntakeAction(input()))}>{save.pending ? "Saving…" : "Confirm and save"}</Button>
            </div>
          )}
          {!save.result?.ok ? <ResultNote result={save.result} /> : null}
        </div>
      )}
    </div>
  );
}
