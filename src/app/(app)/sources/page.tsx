import { can } from "@/lib/access";
import { requireContext } from "@/lib/auth/session";
import { PLANNED_CONNECTORS } from "@/lib/connectors";
import { latestJobs } from "@/lib/ingest/pipeline";
import { getPrivacyOverview } from "@/lib/services/privacy";
import { fmtDateTime, relative } from "@/lib/util/time";
import { RetryButton, SyncButton, UploadForm } from "@/components/source-forms";
import { Badge, Card, CardHeader, PageHeader, StatusBadge, td, th } from "@/components/ui";

const MODE: Record<string, string> = { import: "File import", in_app: "Created in Threadline", mock_connector: "Simulated connector", planned_connector: "Planned connector — not connected" };

export default async function SourcesPage() {
  const ctx = await requireContext("ingest.run");
  const { sources } = await getPrivacyOverview(ctx);
  const jobs = await latestJobs(ctx, 25);
  const now = new Date();
  const tz = ctx.timezone;
  const importable = sources.filter((s) => s.mode === "import" && s.status === "active");
  return (
    <>
      <PageHeader title="Sources and imports" lead="Records are prepared before anyone asks a question: each file is preserved, hashed, parsed, classified, linked to cases and indexed. Re-importing the same file or the same rows adds nothing." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-3">
          {sources.map((s) => (
            <Card key={s.id} className="px-5 py-4" data-testid={`source-${s.id}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-stone-900">{s.name}<StatusBadge status={s.status} /><Badge>{MODE[s.mode] ?? s.mode}</Badge></p>
                  {s.description ? <p className="mt-1 text-sm text-stone-600">{s.description}</p> : null}
                </div>
                {s.mode === "mock_connector" && s.status === "active" ? <SyncButton sourceId={s.id} /> : null}
              </div>
              {s.mode !== "planned_connector" ? (
                <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-4">
                  <div><dt className="text-xs text-stone-500">Records</dt><dd className="font-medium">{s.records}</dd></div>
                  <div><dt className="text-xs text-stone-500">Last successful import</dt><dd className="font-medium" title={s.lastSuccessAt ? fmtDateTime(s.lastSuccessAt, tz) : ""}>{relative(s.lastSuccessAt, now)}</dd></div>
                  <div><dt className="text-xs text-stone-500">Covers through</dt><dd className="font-medium">{s.coverageThrough ? fmtDateTime(s.coverageThrough, tz) : "—"}</dd></div>
                  <div><dt className="text-xs text-stone-500">Default visibility</dt><dd className="font-medium">{s.defaultVisibility === "staff" ? "All property staff" : "Management"}</dd></div>
                </dl>
              ) : (
                <p className="mt-2 text-[13px] text-stone-600">{PLANNED_CONNECTORS[s.kind as keyof typeof PLANNED_CONNECTORS]?.mechanism}. <span className="text-stone-500">Before connecting: {PLANNED_CONNECTORS[s.kind as keyof typeof PLANNED_CONNECTORS]?.gate}.</span></p>
              )}
              <p className="mt-2 text-xs text-stone-500">Access requested: {s.scopes.join("; ") || "—"}</p>
              {s.coverageNote ? <p className="mt-2 rounded-md bg-amber-50 px-3 py-1.5 text-xs text-amber-900 ring-1 ring-inset ring-amber-200">{s.coverageNote}</p> : null}
              {s.failedJobs.map((j) => <p key={j.id} className="mt-2 rounded-md bg-rose-50 px-3 py-1.5 text-xs text-rose-900 ring-1 ring-inset ring-rose-200">Failed import: {j.filename} — {j.error}</p>)}
            </Card>
          ))}
        </div>
        <div className="space-y-4">
          {can(ctx, "ingest.run") ? (
            <Card className="h-fit">
              <CardHeader title="Import a file" hint="CSV or XLSX logs, EML email, PDF, Markdown or text. Up to 6 MB." />
              <UploadForm sources={importable.map((s) => ({ id: s.id, name: s.name }))} />
            </Card>
          ) : null}
          <Card className="overflow-hidden">
            <CardHeader title="Recent imports" hint="Failed imports stay here until they succeed." />
            <table className="w-full">
              <thead className="border-b border-stone-200"><tr><th className={th}>File</th><th className={th}>Result</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {jobs.map((j) => (
                  <tr key={j.id} data-testid="job-row">
                    <td className={`${td} max-w-[150px]`}><span className="block truncate text-[13px] font-medium" title={j.filename}>{j.filename}</span><span className="block text-xs text-stone-500">{relative(j.createdAt, now)}{j.attempts > 1 ? ` · ${j.attempts} attempts` : ""}</span></td>
                    <td className={td}><StatusBadge status={j.status} />{j.result ? <span className="mt-0.5 block text-xs text-stone-500">{j.result.created} new · {j.result.updated} updated · {j.result.unchanged} same</span> : null}{j.status === "failed" ? <><span className="mt-1 block text-xs text-rose-700">{j.error}</span><RetryButton id={j.id} /></> : null}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      </div>
    </>
  );
}
