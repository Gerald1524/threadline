"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { ackHandoffAction, publishHandoffAction } from "@/app/actions";
import type { HandoffItem } from "@/lib/db/schema";
import { ResultNote, useAction } from "./dialogs";
import { Button, Field, inputCls } from "./ui";

export function AckButton({ id }: { id: string }) {
  const { pending, run, result } = useAction();
  return <span className="flex items-center gap-2"><ResultNote result={result?.ok ? null : result} /><Button size="sm" variant="primary" disabled={pending} data-testid="ack" onClick={() => run(() => ackHandoffAction(id))}>Acknowledge</Button></span>;
}

export function HandoffComposer({ suggested, defaultLabel }: { suggested: HandoffItem[]; defaultLabel: string }) {
  const [items, setItems] = useState(suggested);
  const [label, setLabel] = useState(defaultLabel);
  const [note, setNote] = useState("");
  const [extra, setExtra] = useState("");
  const { pending, result, run } = useAction();
  return (
    <form className="space-y-3 px-5 py-4" onSubmit={(e) => { e.preventDefault(); const all = extra.trim() ? [...items, { kind: "note" as const, text: extra.trim() }] : items; run(() => publishHandoffAction({ shiftLabel: label, note, items: all }), (r) => r.ok && setExtra("")); }}>
      <Field label="Shift"><input className={inputCls} value={label} onChange={(e) => setLabel(e.target.value)} /></Field>
      <div>
        <p className="mb-1 text-sm font-medium text-stone-700">Items ({items.length})</p>
        <ul className="space-y-1.5">
          {items.map((it, i) => (
            <li key={i} className="flex gap-1.5">
              <textarea aria-label={`Item ${i + 1}`} className={`${inputCls} min-h-16 text-[13px]`} value={it.text} onChange={(e) => setItems(items.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
              <button type="button" aria-label="Remove item" onClick={() => setItems(items.filter((_, j) => j !== i))} className="h-8 rounded-md p-1.5 text-stone-400 hover:bg-stone-100 hover:text-stone-700"><X size={15} /></button>
            </li>
          ))}
        </ul>
      </div>
      <Field label="Add an item"><input className={inputCls} value={extra} onChange={(e) => setExtra(e.target.value)} placeholder="Anything else the next shift should know" /></Field>
      <Field label="Note"><input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <Button variant="primary" type="submit" disabled={pending || (!items.length && !extra.trim())} data-testid="publish-handoff">{pending ? "Publishing…" : "Publish handoff"}</Button>
      <ResultNote result={result} />
    </form>
  );
}
