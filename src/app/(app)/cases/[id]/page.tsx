import Link from "next/link";
import { notFound } from "next/navigation";
import { can } from "@/lib/access";
import { requireContext } from "@/lib/auth/session";
import { answerForCase } from "@/lib/engine/ask";
import { listReports } from "@/lib/services/reports";
import { fmtDate, fmtDateTime } from "@/lib/util/time";
import { AnswerView } from "@/components/answer-view";
import { CaseControls } from "@/components/case-controls";
import { Badge, Card, CardHeader, StatusBadge } from "@/components/ui";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireContext("cases.read");
  const { id } = await params;
  const res = await answerForCase(ctx, id);
  if (!res) notFound();
  const { answer, ev } = res;
  const tz = ctx.timezone;
  const reports = can(ctx, "reports.read") ? (await listReports(ctx)).filter((r) => r.caseId === id) : [];
  return (
    <>
      <nav className="mb-3 text-sm"><Link href="/cases" className="text-brand-700 hover:underline">← Cases</Link></nav>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono text-xs text-stone-500">{ev.case.number}</p>
          <h1 className="text-xl font-semibold tracking-tight text-stone-900">{ev.case.title}</h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-2 text-sm text-stone-600">
            <StatusBadge status={ev.case.status} />
            <span>{ev.categoryLabel}</span>
            <span>· opened {fmtDate(ev.case.openedAt, tz)}</span>
            {ev.complainant ? <span>· reported by {ev.complainant}{ev.complainantUnit ? ` (${ev.complainantUnit})` : ""}</span> : null}
            {ev.occupant && ev.case.unitId ? <span>· {ev.subjectLabel} occupant: {ev.occupant.name}</span> : null}
            {ev.legalHold ? <Badge tone="rose" title={ev.legalHold.reason}>Legal hold · records preserved</Badge> : null}
          </p>
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <AnswerView answer={answer} />
        <div className="space-y-4">
          <CaseControls caseId={ev.case.id} caseNumber={ev.case.number} status={ev.case.status} canManage={can(ctx, "cases.manage")} canPacket={can(ctx, "reports.generate")} hold={ev.legalHold ? { id: ev.legalHold.id, reason: ev.legalHold.reason } : null} canReleaseHold={can(ctx, "privacy.admin")} sourceCount={answer.sources.length} gapCount={answer.gaps.length} />
          {ev.approvals.length ? (
            <Card>
              <CardHeader title="Approvals" />
              <ul className="divide-y divide-stone-100 text-sm">
                {ev.approvals.map((a) => <li key={a.id} className="px-5 py-3"><p className="font-medium text-stone-900">{a.title}</p><p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500"><StatusBadge status={a.status} />{a.deciderName ? `${a.deciderName}, ${fmtDateTime(a.decidedAt, tz)}` : `requested by ${a.requesterName}`}</p>{a.decisionNote ? <p className="mt-1 text-xs text-stone-600">“{a.decisionNote}”</p> : null}</li>)}
              </ul>
            </Card>
          ) : null}
          {ev.workOrders.length ? (
            <Card>
              <CardHeader title="Work orders" right={<Link href="/work-orders" className="text-xs font-medium text-brand-700 hover:underline">All</Link>} />
              <ul className="divide-y divide-stone-100 text-sm">
                {ev.workOrders.map((w) => <li key={w.id} className="px-5 py-3"><p className="font-medium text-stone-900"><span className="font-mono text-xs text-stone-500">{w.number}</span> {w.title}</p><p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-stone-500"><StatusBadge status={w.status} />{w.assigneeName ?? "unassigned"} · {w.eta ? `ETA ${fmtDateTime(w.eta, tz)}` : w.completedAt ? `completed ${fmtDate(w.completedAt, tz)}` : "no ETA"}</p></li>)}
              </ul>
            </Card>
          ) : null}
          {reports.length ? (
            <Card>
              <CardHeader title="Case packets" />
              <ul className="divide-y divide-stone-100 text-sm">
                {reports.map((r) => <li key={r.id} className="px-5 py-3"><Link href={`/reports?id=${r.id}`} className="font-medium text-brand-800 hover:underline">{fmtDateTime(r.generatedAt, tz)}</Link><p className="text-xs text-stone-500">{r.generatedByName} · {r.sourceCount} sources</p></li>)}
              </ul>
            </Card>
          ) : null}
          {ev.policy ? <Card className="px-5 py-3 text-sm"><p className="text-xs font-semibold uppercase tracking-wide text-stone-500">Governing policy</p><Link href={`/policies#${ev.policy.key}`} className="mt-1 block font-medium text-brand-800 hover:underline">{ev.policy.title}</Link><p className="text-xs text-stone-500">Version {ev.policy.version}, approved</p></Card> : null}
        </div>
      </div>
    </>
  );
}
