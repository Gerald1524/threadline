"use client";

import { useActionState } from "react";
import { loginAction } from "@/app/actions";
import { Button, Field, inputCls } from "@/components/ui";

export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, undefined);
  return (
    <form action={action} className="mt-3 space-y-3">
      <Field label="Work email"><input name="email" type="email" required autoComplete="username" className={inputCls} placeholder="priya.raman@northbridge.example" /></Field>
      <Field label="Password"><input name="password" type="password" required autoComplete="current-password" className={inputCls} /></Field>
      <Field label="Verification code" hint="Only if two-step verification is on for your account: the code from your app, or a recovery code."><input name="code" autoComplete="one-time-code" className={inputCls} /></Field>
      {state?.error ? <p role="alert" className="text-sm text-rose-700">{state.error}</p> : null}
      <Button variant="primary" type="submit" disabled={pending} className="w-full">{pending ? "Signing in…" : "Sign in"}</Button>
    </form>
  );
}
