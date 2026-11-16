"use client";

import { useActionState } from "react";
import { RefreshCw } from "lucide-react";
import { retryJobAction, syncSourceAction, uploadAction } from "@/app/actions";
import { ResultNote, useAction } from "./dialogs";
import { Button, Field, inputCls } from "./ui";

export function UploadForm({ sources }: { sources: { id: string; name: string }[] }) {
  const [state, action, pending] = useActionState(uploadAction, undefined);
  return (
    <form action={action} className="space-y-3 px-5 py-4">
      <Field label="Into source"><select name="sourceId" className={inputCls}>{sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      <Field label="File"><input name="file" type="file" required accept=".csv,.xlsx,.eml,.pdf,.md,.txt" data-testid="upload-file" className="block w-full text-sm file:mr-3 file:rounded-md file:border file:border-stone-300 file:bg-white file:px-3 file:py-1.5 file:text-sm file:font-medium" /></Field>
      <Button variant="primary" type="submit" disabled={pending} data-testid="upload-submit">{pending ? "Importing…" : "Import"}</Button>
      <div data-testid="upload-result"><ResultNote result={state ?? null} /></div>
    </form>
  );
}

export function SyncButton({ sourceId }: { sourceId: string }) {
  const { pending, result, run } = useAction();
  return <span className="flex flex-col items-end gap-1"><Button size="sm" disabled={pending} data-testid="sync-now" onClick={() => run(() => syncSourceAction(sourceId))}><RefreshCw size={13} className={pending ? "animate-spin" : ""} />Sync now</Button><span data-testid="sync-result"><ResultNote result={result} /></span></span>;
}

export function RetryButton({ id }: { id: string }) {
  const { pending, result, run } = useAction();
  return <span className="mt-1 block"><Button size="sm" disabled={pending} data-testid="retry-job" onClick={() => run(() => retryJobAction(id))}>{pending ? "Retrying…" : "Retry"}</Button><ResultNote result={result} /></span>;
}
