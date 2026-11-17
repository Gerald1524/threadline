"use client";

import { useState } from "react";
import { beginTwoStepAction, confirmTwoStepAction, disableTwoStepAction, regenerateRecoveryCodesAction } from "@/app/actions";
import { ResultNote, useAction } from "./dialogs";
import { Badge, Button, Field, inputCls } from "./ui";

type Setup = { secret: string; qrSvg: string };
const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

/** Shown once, right after the codes are created. Only their hashes are stored. */
function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  const text = `Threadline recovery codes\nEach code works once. Keep them somewhere safe.\n\n${codes.join("\n")}\n`;
  const href = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
  return (
    <div className="space-y-3 rounded-lg border border-amber-300 bg-amber-50 p-4" data-testid="recovery-codes">
      <p className="font-medium text-amber-950">Save your recovery codes</p>
      <p className="text-amber-900">If you lose your phone, each of these codes signs you in once in place of an authenticator code. They are shown only now.</p>
      <ul className="grid grid-cols-2 gap-x-6 gap-y-1 font-mono text-sm sm:grid-cols-3">
        {codes.map((c) => <li key={c} data-testid="recovery-code">{c}</li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" type="button" onClick={() => navigator.clipboard?.writeText(text).then(() => setCopied(true), () => setCopied(false))}>{copied ? "Copied" : "Copy"}</Button>
        <a className="inline-flex items-center rounded-md border border-stone-300 bg-white px-2.5 py-1 text-xs font-medium text-stone-800 hover:bg-stone-50" href={href} download="threadline-recovery-codes.txt">Download</a>
        <Button size="sm" variant="primary" type="button" onClick={onDone} data-testid="recovery-codes-saved">I have saved these codes</Button>
      </div>
    </div>
  );
}

export function TwoStepPanel({ enabled, recoveryCodesLeft, required }: { enabled: boolean; recoveryCodesLeft: number; required: boolean }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"idle" | "off" | "regenerate">("idle");
  const { pending, result, run, clear } = useAction();
  const reset = () => { setMode("idle"); setPassword(""); setCode(""); };

  if (codes) {
    return <div className="px-5 py-4 text-sm"><RecoveryCodes codes={codes} onDone={() => { setCodes(null); clear(); }} /></div>;
  }

  if (enabled) {
    return (
      <div className="space-y-3 px-5 py-4 text-sm" data-testid="two-step-on">
        <p className="flex flex-wrap items-center gap-2"><Badge tone="green">On</Badge> Sign-in asks for a code from your authenticator app.{required ? <Badge tone="brand">required by your organization</Badge> : null}</p>
        <p className={recoveryCodesLeft <= 2 ? "text-amber-800" : "text-stone-600"} data-testid="recovery-codes-left">{recoveryCodesLeft} recovery code{recoveryCodesLeft === 1 ? "" : "s"} left.{recoveryCodesLeft <= 2 ? " Generate new ones soon." : ""}</p>
        {mode === "regenerate" ? (
          <form className="max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await regenerateRecoveryCodesAction(code); if (r.ok && r.data) { setCodes(r.data.recoveryCodes); reset(); } return r; }); }}>
            <Field label="Current code from your app"><input required inputMode="numeric" autoComplete="one-time-code" className={inputCls} value={code} onChange={(e) => setCode(digits(e.target.value))} /></Field>
            <div className="flex gap-2">
              <Button variant="primary" type="submit" disabled={pending || code.length !== 6}>Generate new codes</Button>
              <Button type="button" onClick={() => { reset(); clear(); }}>Cancel</Button>
            </div>
          </form>
        ) : mode === "off" ? (
          <form className="max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => disableTwoStepAction({ password, code }), (r) => { if (r.ok) reset(); }); }}>
            <Field label="Password"><input type="password" required autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Current code" hint="From your app, or one of your recovery codes."><input required autoComplete="one-time-code" className={inputCls} value={code} onChange={(e) => setCode(e.target.value.slice(0, 16))} /></Field>
            <div className="flex gap-2">
              <Button variant="danger" type="submit" disabled={pending || code.length < 6}>Turn off</Button>
              <Button type="button" onClick={() => { reset(); clear(); }}>Cancel</Button>
            </div>
          </form>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button onClick={() => { clear(); setMode("regenerate"); }}>New recovery codes…</Button>
            {required ? null : <Button onClick={() => { clear(); setMode("off"); }}>Turn off…</Button>}
          </div>
        )}
        <ResultNote result={result} />
      </div>
    );
  }

  return (
    <div className="space-y-4 px-5 py-4 text-sm" data-testid="two-step-off">
      {!setup ? (
        <>
          <p className="flex items-center gap-2"><Badge>Off</Badge> Sign-in uses your password only.</p>
          <Button variant="primary" disabled={pending} onClick={() => run(async () => { const r = await beginTwoStepAction(); if (r.ok && r.data) setSetup(r.data); return r; })} data-testid="two-step-start">Set up two-step verification</Button>
        </>
      ) : (
        <div className="grid gap-5 sm:grid-cols-[auto_minmax(0,1fr)]">
          <div className="h-44 w-44 rounded-lg border border-stone-200 bg-white p-2 [&>svg]:h-full [&>svg]:w-full" role="img" aria-label="QR code for your authenticator app" dangerouslySetInnerHTML={{ __html: setup.qrSvg }} />
          <form className="max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); run(async () => { const r = await confirmTwoStepAction(code); if (r.ok && r.data) { setCodes(r.data.recoveryCodes); setSetup(null); setCode(""); } return r; }); }}>
            <p>1. Scan the code with an authenticator app, or enter this key by hand:</p>
            <p><code className="break-all rounded bg-stone-100 px-2 py-1 font-mono text-xs" data-testid="two-step-secret">{setup.secret}</code></p>
            <p>2. Enter the six-digit code the app shows.</p>
            <Field label="Code from the app"><input required inputMode="numeric" autoComplete="one-time-code" className={inputCls} value={code} onChange={(e) => setCode(digits(e.target.value))} data-testid="two-step-code" /></Field>
            <div className="flex gap-2">
              <Button variant="primary" type="submit" disabled={pending || code.length !== 6} data-testid="two-step-confirm">Turn on</Button>
              <Button type="button" onClick={() => { setSetup(null); setCode(""); clear(); }}>Cancel</Button>
            </div>
            <p className="text-xs text-stone-500">Nothing changes until you confirm a code. This key is shown only now.</p>
          </form>
        </div>
      )}
      <ResultNote result={result} />
    </div>
  );
}
