"use client";

import { useCallback, useRef, useState, useSyncExternalStore } from "react";

export type VoiceConfig = { serverTranscription: boolean; serverSpeech: boolean; browserTranscription: boolean; browserSpeech: boolean };

type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start: () => void; stop: () => void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onerror: ((e: { error: string }) => void) | null; onend: (() => void) | null };
const recognitionCtor = (): (new () => Recognition) | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

const noop = () => () => {};
/** True only in the browser after hydration, so capability checks never mismatch server HTML. */
const useIsClient = () => useSyncExternalStore(noop, () => true, () => false);

/**
 * Dictation started by the employee pressing the microphone button. Nothing is recorded
 * otherwise. The transcript is returned for review and editing; audio is never stored.
 */
export function useDictation(cfg: VoiceConfig, onText: (text: string, final: boolean) => void) {
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const media = useRef<MediaRecorder | null>(null);
  const isClient = useIsClient();
  const mode: "browser" | "server" | "none" = !isClient ? "none" : cfg.serverTranscription && typeof MediaRecorder !== "undefined" ? "server" : cfg.browserTranscription && recognitionCtor() ? "browser" : "none";

  const stop = useCallback(() => {
    rec.current?.stop();
    if (media.current?.state === "recording") media.current.stop();
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (mode === "browser") {
      const R = recognitionCtor()!;
      const r = new R();
      r.lang = "en-US";
      r.interimResults = true;
      r.continuous = false;
      r.onresult = (e) => {
        let text = "";
        let final = false;
        for (let i = 0; i < e.results.length; i++) {
          text += e.results[i][0].transcript;
          final = e.results[i].isFinal;
        }
        onText(text, final);
      };
      r.onerror = (e) => setError(e.error === "not-allowed" ? "Microphone access was blocked. You can type instead." : "Dictation stopped. You can type instead.");
      r.onend = () => setListening(false);
      rec.current = r;
      setListening(true);
      r.start();
    } else if (mode === "server") {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        mr.ondataavailable = (e) => chunks.push(e.data);
        mr.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          setListening(false);
          const blob = new Blob(chunks, { type: mr.mimeType });
          const res = await fetch("/api/voice/transcribe", { method: "POST", headers: { "Content-Type": mr.mimeType }, body: blob });
          const body = await res.json();
          if (res.ok) onText(body.text, true);
          else setError(body.error ?? "Transcription failed. You can type instead.");
        };
        media.current = mr;
        setListening(true);
        mr.start();
      } catch {
        setError("Microphone access was blocked. You can type instead.");
      }
    }
  }, [mode, onText]);

  return { available: mode !== "none", mode, listening, error, start, stop };
}

/** Reads the answer's own verified text aloud. Same facts as the written answer. */
export function useSpeech(cfg: VoiceConfig) {
  const [speakingId, setSpeakingId] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const isClient = useIsClient();
  const available = isClient && (cfg.serverSpeech || (cfg.browserSpeech && "speechSynthesis" in window));

  const stop = useCallback(() => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
    audio.current?.pause();
    setSpeakingId(null);
  }, []);

  const speak = useCallback(async (id: string, text: string) => {
    stop();
    setSpeakingId(id);
    if (cfg.serverSpeech) {
      const res = await fetch("/api/voice/speak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
      if (res.ok) {
        const a = new Audio(URL.createObjectURL(await res.blob()));
        audio.current = a;
        a.onended = () => setSpeakingId(null);
        void a.play();
        return;
      }
    }
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 1;
    u.onend = () => setSpeakingId(null);
    u.onerror = () => setSpeakingId(null);
    window.speechSynthesis.speak(u);
  }, [cfg, stop]);

  return { available, speakingId, speak, stop };
}
