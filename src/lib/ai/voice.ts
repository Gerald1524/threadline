/**
 * Server-side speech adapters (OpenAI). Optional: without a key, or when the organization's
 * policy selects "browser", voice runs on the browser's own speech APIs and these are unused.
 * Audio is processed in memory and never written to disk or the database.
 *
 * Not exercised against the live API in this build (no key available). Model names are
 * configurable because they change; see docs/AI_PROVIDER_EVALUATION.md before enabling.
 */
import OpenAI, { toFile } from "openai";
import type { AccessContext } from "../access";
import { authorizeProvider, logProviderRequest } from "./provider";

export async function voiceConfig(ctx: AccessContext) {
  const stt = await authorizeProvider(ctx, "transcription", "openai", []);
  const tts = await authorizeProvider(ctx, "speech", "openai", []);
  const browserStt = await authorizeProvider(ctx, "transcription", "browser", []);
  const browserTts = await authorizeProvider(ctx, "speech", "browser", []);
  return { serverTranscription: stt.allowed, serverSpeech: tts.allowed, browserTranscription: browserStt.allowed, browserSpeech: browserTts.allowed };
}

export async function transcribe(ctx: AccessContext, audio: Uint8Array, mediaType: string): Promise<string> {
  const decision = await authorizeProvider(ctx, "transcription", "openai", ["resident_pi"]);
  if (!decision.allowed) {
    await logProviderRequest(ctx, { provider: "openai", task: "transcription", maxSensitivity: "resident_pi", status: decision.status });
    throw new Error(decision.reason);
  }
  const t0 = Date.now();
  const model = process.env.THREADLINE_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
  try {
    const res = await new OpenAI().audio.transcriptions.create({ model, file: await toFile(audio, `dictation.${mediaType.includes("mp4") ? "mp4" : "webm"}`, { type: mediaType }) });
    await logProviderRequest(ctx, { provider: "openai", task: "transcription", model, maxSensitivity: "resident_pi", status: "ok", latencyMs: Date.now() - t0 });
    return res.text;
  } catch (e) {
    await logProviderRequest(ctx, { provider: "openai", task: "transcription", model, maxSensitivity: "resident_pi", status: "error", errorCode: (e as Error).name, latencyMs: Date.now() - t0 });
    throw new Error("Transcription failed. Type your question instead.");
  }
}

export async function speak(ctx: AccessContext, text: string): Promise<Uint8Array> {
  const decision = await authorizeProvider(ctx, "speech", "openai", ["confidential_case"]);
  if (!decision.allowed) {
    await logProviderRequest(ctx, { provider: "openai", task: "speech", maxSensitivity: "confidential_case", status: decision.status });
    throw new Error(decision.reason);
  }
  const t0 = Date.now();
  const model = process.env.THREADLINE_TTS_MODEL || "gpt-4o-mini-tts";
  try {
    const res = await new OpenAI().audio.speech.create({ model, voice: "alloy", input: text.slice(0, 3500) });
    await logProviderRequest(ctx, { provider: "openai", task: "speech", model, maxSensitivity: "confidential_case", status: "ok", latencyMs: Date.now() - t0 });
    return new Uint8Array(await res.arrayBuffer());
  } catch (e) {
    await logProviderRequest(ctx, { provider: "openai", task: "speech", model, maxSensitivity: "confidential_case", status: "error", errorCode: (e as Error).name, latencyMs: Date.now() - t0 });
    throw new Error("Speech synthesis failed.");
  }
}
