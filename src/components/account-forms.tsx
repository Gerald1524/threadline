"use client";

import { useState } from "react";
import { beginTwoStepAction, confirmTwoStepAction, disableTwoStepAction } from "@/app/actions";
import { ResultNote, useAction } from "./dialogs";
import { Badge, Button, Field, inputCls } from "./ui";

type Setup = { secret: string; qrSvg: string };

export function TwoStepPanel({ enabled }: { enabled: boolean }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [turningOff, setTurningOff] = useState(false);
  const { pending, result, run, clear } = useAction();
  const digits = (v: string) => v.replace(/\D/g, "").slice(0, 6);

  if (enabled) {
    return (
      <div className="space-y-3 px-5 py-4 text-sm" data-testid="two-step-on">
        <p className="flex items-center gap-2"><Badge tone="green">On</Badge> Sign-in asks for a code from your authenticator app.</p>
        {turningOff ? (
          <form className="max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => disableTwoStepAction({ password, code }), (r) => { if (r.ok) { setTurningOff(false); setPassword(""); setCode(""); } }); }}>
            <Field label="Password"><input type="password" required autoComplete="current-password" className={inputCls} value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Field label="Current code"><input required inputMode="numeric" autoComplete="one-time-code" className={inputCls} value={code} onChange={(e) => setCode(digits(e.target.value))} /></Field>
            <div className="flex gap-2">
              <Button variant="danger" type="submit" disabled={pending || code.length !== 6}>Turn off</Button>
              <Button type="button" onClick={() => { setTurningOff(false); clear(); }}>Cancel</Button>
            </div>
          </form>
        ) : <Button onClick={() => { clear(); setTurningOff(true); }}>Turn off…</Button>}
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
          <form className="max-w-sm space-y-3" onSubmit={(e) => { e.preventDefault(); run(() => confirmTwoStepAction(code), (r) => { if (r.ok) { setSetup(null); setCode(""); } }); }}>
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
