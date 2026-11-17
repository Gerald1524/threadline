import { can } from "@/lib/access";
import { requireContext } from "@/lib/auth/session";
import { SENSITIVITY_LABEL, SENSITIVITY_ORDER } from "@/lib/ingest/lexicon";
import { getPrivacyOverview, listAudit, retentionReview } from "@/lib/services/privacy";
import { fmtDateTime, relative } from "@/lib/util/time";
import { ExportPanel, LifecyclePanel, ProviderRow, RetentionRow, ScopePanel, SourceStatusButtons, TwoStepRequirementPanel } from "@/components/privacy-forms";
import { Badge, Card, CardHeader, Notice, PageHeader, StatusBadge, td, th } from "@/components/ui";

const TASK: Record<string, string> = { reasoning: "Answer narrative (reasoning)", classification: "Classification and extraction", transcription: "Speech to text", speech: "Read aloud", embeddings: "Semantic search (embeddings)" };

export default async function SettingsPage() {
  const ctx = await requireContext("privacy.view");
  const o = await getPrivacyOverview(ctx);
  const audit = await listAudit(ctx, 60);
  const review = await retentionReview(ctx);
  const admin = can(ctx, "privacy.admin");
  const tz = ctx.timezone;
  const now = new Date();
  const count = (cls: string, life: string) => o.classCounts.find((c) => c.c === cls && c.lifecycle === life)?.n ?? 0;
  return (
    <>
      <PageHeader title="Data & Privacy" lead="Your organization controls which sources Threadline may read, which AI providers may process which classes of record, how long records are kept, and what leaves the system. Every change on this page is audited." />
      {!admin ? <div className="mb-4"><Notice>You can view these controls. Changing them requires an organization administrator.</Notice></div> : null}
      <div className="space-y-6">
        <Card>
          <CardHeader title="Connected sources" hint="Threadline reads only the building-controlled sources listed here. A shared front-desk mailbox does not grant access to anyone's personal mailbox. Disconnecting stops new intake; records already imported remain under the retention and hold rules below." />
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-stone-200"><tr><th className={th}>Source</th><th className={th}>Access requested</th><th className={th}>Records</th><th className={th}>Last import</th><th className={th}>Status</th>{admin ? <th className={th}>Control</th> : null}</tr></thead>
              <tbody className="divide-y divide-stone-100">
                {o.sources.map((s) => (
                  <tr key={s.id} data-testid={`privacy-source-${s.id}`}>
                    <td className={td}><span className="font-medium">{s.name}</span>{s.failedJobs.length ? <Badge tone="rose" className="ml-2">{s.failedJobs.length} failed</Badge> : null}{s.coverageNote ? <span className="block text-xs text-stone-500">{s.coverageNote}</span> : null}</td>
                    <td className={`${td} max-w-xs text-xs text-stone-600`}>{s.scopes.join("; ") || "—"}</td>
                    <td className={td}>{s.records}</td>
                    <td className={td}>{s.mode === "planned_connector" ? "—" : relative(s.lastSuccessAt, now)}</td>
                    <td className={td}><StatusBadge status={s.status} /></td>
                    {admin ? <td className={td}>{s.mode === "planned_connector" ? <span className="text-xs text-stone-500">Not available in this build</span> : s.mode === "in_app" ? <span className="text-xs text-stone-500">Always on</span> : <SourceStatusButtons sourceId={s.id} status={s.status} />}</td> : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Sign-in security" hint="Two-step verification asks for a code from an authenticator app after the password. Each person sets it up from their account page." />
          <TwoStepRequirementPanel required={o.twoStep.required} enabled={o.twoStep.enabled} total={o.twoStep.total} editable={admin} />
        </Card>

        <Card>
          <CardHeader title="AI providers" hint="One provider per task, limited to the record classes you allow. If a provider is not allowed or has no credential, Threadline does not fall back to another provider: it answers from records without a model and says so." />
          <div className="divide-y divide-stone-100">
            {o.providers.map((p) => <ProviderRow key={p.task} task={p.task} label={TASK[p.task]} selected={p.selected} allowed={p.allowedSensitivity} options={p.options.map((x) => ({ id: x.id, label: x.label, note: x.note, external: x.external, configured: x.configured, envKey: x.envKey ?? null }))} classes={SENSITIVITY_ORDER.map((c) => ({ id: c, label: SENSITIVITY_LABEL[c] }))} editable={admin} />)}
          </div>
          <div className="border-t border-stone-100 px-5 py-3 text-xs text-stone-500">
            <p className="font-medium text-stone-600">Provider request log (metadata only — no prompts or outputs are stored)</p>
            {o.providerLog.length ? <ul className="mt-1 space-y-0.5">{o.providerLog.map((l, i) => <li key={i}>{l.provider} · {l.task} · {l.status.replace(/_/g, " ")} × {l.n} (last {fmtDateTime(l.last, tz)})</li>)}</ul> : <p className="mt-1">No external AI request has been made from this organization.</p>}
          </div>
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Retention by record class" hint="How long each class is kept before it becomes eligible for an approved archival or disposal. Records past their period are flagged here for review. Nothing is removed automatically." />
            <div className="divide-y divide-stone-100">
              {SENSITIVITY_ORDER.map((c) => <RetentionRow key={c} recordClass={c} label={SENSITIVITY_LABEL[c]} days={o.settings.retention[c]?.days ?? null} active={count(c, "active")} archived={count(c, "archived")} disposed={count(c, "disposed")} editable={admin} eligible={review.find((r) => r.recordClass === c)?.eligible} held={review.find((r) => r.recordClass === c)?.held} cutoffDate={review.find((r) => r.recordClass === c)?.cutoff.toISOString().slice(0, 10)} />)}
            </div>
          </Card>
          <div className="space-y-6">
            <Card>
              <CardHeader title="Ingestion scope" hint="Classes excluded here are not stored at all when encountered during import." />
              <ScopePanel classes={SENSITIVITY_ORDER.map((c) => ({ id: c, label: SENSITIVITY_LABEL[c] }))} excluded={o.settings.excludedSensitivity} editable={admin} />
            </Card>
            <Card>
              <CardHeader title="Legal holds" hint="Records linked to a held case are preserved regardless of retention schedules. Holds are placed from the case page." />
              <ul className="divide-y divide-stone-100 text-sm">
                {o.holds.length ? o.holds.map((h) => <li key={h.h.id} className="px-5 py-3"><p className="font-medium">{h.number} · {h.title} {h.h.releasedAt ? <Badge>released</Badge> : <Badge tone="rose">active</Badge>}</p><p className="text-xs text-stone-500">{h.h.reason} — {h.by}, {fmtDateTime(h.h.placedAt, tz)}</p></li>) : <li className="px-5 py-3 text-stone-500">No legal holds.</li>}
              </ul>
            </Card>
          </div>
        </div>

        <Card>
          <CardHeader title="Record lifecycle" hint="Archival or disposal is proposed first, showing exactly how many records match and how many are protected by a legal hold, and takes effect only after explicit approval. Disposal removes the content, derived text, attachments, cached answers and packets that quote it; the record's identity and hash remain in the audit trail." />
          <LifecyclePanel classes={SENSITIVITY_ORDER.map((c) => ({ id: c, label: SENSITIVITY_LABEL[c] }))} editable={admin}
            requests={o.lifecycle.map((r) => ({ id: r.id, action: r.action, recordClass: SENSITIVITY_LABEL[r.recordClass] ?? r.recordClass, olderThan: r.olderThan.toISOString().slice(0, 10), status: r.status, matched: r.matchedCount, held: r.heldCount, affected: r.affectedCount }))} />
        </Card>

        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader title="Export" hint="A complete copy of your organization's records with a manifest of every source record and its hash." />
            <ExportPanel editable={admin} exports={o.exports.map((e) => ({ id: e.id, at: fmtDateTime(e.createdAt, tz), sha: e.sha256 ?? "", records: Number((e.manifest as { sourceRecords?: number }).sourceRecords ?? 0) }))} />
          </Card>
          <Card>
            <CardHeader title="Storage and deployment" />
            <dl className="space-y-2 px-5 py-4 text-sm">
              <div><dt className="text-xs text-stone-500">Data region</dt><dd>{o.settings.dataRegion}</dd></div>
              <div><dt className="text-xs text-stone-500">Organization isolation</dt><dd className="flex flex-wrap items-center gap-2" data-testid="isolation-status">{o.isolation.enforced ? <Badge tone="green">enforced by the database</Badge> : <Badge tone="rose">not enforced: {o.isolation.unprotected.join(", ")}</Badge>}<span className="text-xs text-stone-500">row-level security on {o.isolation.tables - o.isolation.unprotected.length} of {o.isolation.tables} tables</span></dd></div>
              <div><dt className="text-xs text-stone-500">Audit trail integrity</dt><dd className="flex items-center gap-2">{o.chain.entries} entries {o.chain.brokenAt === null ? <Badge tone="green">hash chain intact</Badge> : <Badge tone="rose">chain broken at #{o.chain.brokenAt}</Badge>}</dd></div>
              <div><dt className="text-xs text-stone-500">Purpose limitation</dt><dd>Operational recordkeeping for incidents and requests. No productivity, attendance or performance analytics are computed.</dd></div>
              <div><dt className="text-xs text-stone-500">Readiness</dt><dd>Synthetic data only. Real resident or employee data requires the launch gate in <code className="rounded bg-stone-100 px-1 text-xs">docs/PRIVACY_SECURITY.md</code> (contracts, legal review, security review).</dd></div>
            </dl>
          </Card>
        </div>

        <Card className="overflow-hidden">
          <CardHeader title="Audit log" hint="Append-only and hash-chained. Entries hold who, what and when — identifiers and state names only, never record content." />
          <div className="max-h-[420px] overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 border-b border-stone-200 bg-white"><tr><th className={th}>#</th><th className={th}>When</th><th className={th}>Who</th><th className={th}>Action</th><th className={th}>Entity</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {audit.map((a) => (
                  <tr key={a.id}>
                    <td className={`${td} font-mono text-xs text-stone-500`}>{a.seq}</td>
                    <td className={`${td} whitespace-nowrap text-xs`}>{fmtDateTime(a.at, tz)}</td>
                    <td className={`${td} text-xs`}>{a.actorLabel}</td>
                    <td className={`${td} font-mono text-xs`}>{a.action}</td>
                    <td className={`${td} max-w-[260px] truncate font-mono text-xs text-stone-500`} title={JSON.stringify(a.meta)}>{a.entityType} {a.entityId}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}
