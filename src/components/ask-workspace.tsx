"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUp, Mic, Square } from "lucide-react";
import type { Answer } from "@/lib/engine/types";
import { AnswerView } from "./answer-view";
import { useSourcePanel } from "./source-panel";
import { Badge, cx } from "./ui";
import { useDictation, useSpeech, type VoiceConfig } from "./voice";

type Turn = { id: string; question: string; inputMode: "text" | "voice"; answer?: Answer; error?: string };

export function AskWorkspace({ userFirstName, propertyName, examples, voice, modelConfigured }: { userFirstName: string; propertyName: string; examples: string[]; voice: VoiceConfig; modelConfigured: boolean }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [heard, setHeard] = useState(false);
  const conv = useRef<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const { open } = useSourcePanel();
  const speech = useSpeech(voice);

  const onDictated = useCallback((t: string) => {
    setText(t);
    setHeard(true);
  }, []);
  const dictation = useDictation(voice, onDictated);

  const submit = useCallback(async (question: string, inputMode: "text" | "voice" = "text") => {
    const q = question.trim();
    if (!q || busy) return;
    const id = `${Date.now()}`;
    setTurns((t) => [...t, { id, question: q, inputMode }]);
    setText("");
    setHeard(false);
    setBusy(true);
    try {
      const res = await fetch("/api/ask", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q, conversationId: conv.current, inputMode }) });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "The question could not be answered.");
      conv.current = body.conversationId;
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, answer: body.answer } : x)));
      if (body.answer.openSourceId) open(body.answer.openSourceId, body.answer.sources.find((s: { id: string; label: string }) => s.id === body.answer.openSourceId)?.label);
    } catch (e) {
      setTurns((t) => t.map((x) => (x.id === id ? { ...x, error: (e as Error).message } : x)));
    } finally {
      setBusy(false);
      box.current?.focus();
    }
  }, [busy, open]);

  useEffect(() => {
    end.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, busy]);

  const composer = (
    <form onSubmit={(e) => { e.preventDefault(); void submit(text, heard ? "voice" : "text"); }} className="rounded-2xl border border-stone-300 bg-white p-2 shadow-sm focus-within:border-brand-600 focus-within:ring-2 focus-within:ring-brand-100">
      <label htmlFor="ask-box" className="sr-only">Ask your building</label>
      <textarea id="ask-box" ref={box} data-testid="ask-input" rows={turns.length ? 1 : 3} value={text} onChange={(e) => { setText(e.target.value); }} placeholder={`Ask about a unit, a resident, a complaint or a work order at ${propertyName}…`}
        onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void submit(text, heard ? "voice" : "text"); } }}
        className="block w-full resize-none border-0 bg-transparent px-3 py-2 text-[15px] leading-relaxed text-stone-900 placeholder:text-stone-400 focus:outline-none" />
      <div className="flex items-center justify-between gap-2 px-1 pb-0.5">
        <p className="min-h-5 text-xs text-stone-500" aria-live="polite">
          {dictation.listening ? "Listening… press stop when you are done." : heard ? "Check what was heard, edit if needed, then send." : dictation.error ?? (dictation.available ? "Type, or press the microphone to dictate." : "Voice input is not available in this browser. Typing works everywhere.")}
        </p>
        <div className="flex items-center gap-1.5">
          {dictation.available ? (
            <button type="button" data-testid="mic" onClick={() => (dictation.listening ? dictation.stop() : void dictation.start())} aria-pressed={dictation.listening} aria-label={dictation.listening ? "Stop dictation" : "Dictate your question"}
              className={cx("grid h-9 w-9 place-items-center rounded-full border transition-colors", dictation.listening ? "recording border-rose-300 bg-rose-600 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-50")}>
              {dictation.listening ? <Square size={14} /> : <Mic size={16} />}
            </button>
          ) : null}
          <button type="submit" data-testid="ask-submit" disabled={busy || !text.trim()} aria-label="Ask" className="grid h-9 w-9 place-items-center rounded-full bg-brand-700 text-white transition-colors hover:bg-brand-800 disabled:opacity-40"><ArrowUp size={17} /></button>
        </div>
      </div>
    </form>
  );

  return (
    <div className="mx-auto max-w-3xl">
      {!turns.length ? (
        <div className="pb-6 pt-8 text-center">
          <h1 className="text-[28px] font-semibold tracking-tight text-stone-900">Ask your building</h1>
          <p className="mx-auto mt-2 max-w-xl text-[15px] text-stone-600">Good to see you, {userFirstName}. Ask what happened and get the documented history, with every statement linked to the original record.</p>
        </div>
      ) : null}
      <div className="space-y-5">
        {turns.map((t) => (
          <section key={t.id} aria-label={`Question: ${t.question}`}>
            <div className="mb-2 flex justify-end">
              <p className="max-w-[85%] rounded-2xl rounded-br-md bg-brand-800 px-4 py-2.5 text-[15px] text-white">{t.question}{t.inputMode === "voice" ? <span className="ml-2 text-[11px] text-brand-100">dictated</span> : null}</p>
            </div>
            {t.answer ? <AnswerView answer={t.answer} onAsk={(q) => void submit(q)} speech={{ available: speech.available, speaking: speech.speakingId === t.id, speak: (txt) => void speech.speak(t.id, txt), stop: speech.stop }} />
              : t.error ? <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">{t.error}</p>
              : <div className="rounded-xl border border-stone-200 bg-white px-5 py-4" aria-busy="true" data-testid="answer-loading"><p className="text-sm text-stone-500">Reading the records you can access…</p><div className="mt-3 space-y-2">{[82, 96, 64].map((w) => <div key={w} className="h-3 animate-pulse rounded bg-stone-100" style={{ width: `${w}%` }} />)}</div></div>}
          </section>
        ))}
        <div ref={end} />
      </div>
      <div className={cx(turns.length ? "sticky bottom-0 -mx-2 mt-5 bg-gradient-to-t from-paper via-paper to-transparent px-2 pb-4 pt-6" : "")}>{composer}</div>
      {!turns.length ? (
        <>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {examples.map((q) => <button key={q} type="button" onClick={() => void submit(q)} data-testid="example" className="rounded-xl border border-stone-200 bg-white px-4 py-3 text-left text-sm text-stone-700 transition-colors hover:border-brand-600 hover:text-stone-900">{q}</button>)}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 text-xs text-stone-500">
            <Badge tone={modelConfigured ? "violet" : "neutral"}>{modelConfigured ? "AI narrative on · every statement verified" : "No AI model configured · answers composed from records"}</Badge>
            <span>Answers use only records your role may see.</span>
          </div>
        </>
      ) : null}
    </div>
  );
}
