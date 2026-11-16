import Link from "next/link";
import { can } from "@/lib/access";
import { requireContext } from "@/lib/auth/session";
import { APPROVAL_TYPES, listApprovals } from "@/lib/services/approvals";
import { fmtDateTime } from "@/lib/util/time";
import { ApprovalDecision, NewApprovalForm } from "@/components/approval-forms";
import { Badge, Card, CardHeader, Empty, PageHeader, StatusBadge, td, th } from "@/components/ui";

export default async function ApprovalsPage() {
  const ctx = await requireContext("approvals.read");
  const all = await listApprovals(ctx);
  const pending = all.filter((a) => a.status === "pending");
  const decided = all.filter((a) => a.status !== "pending");
  const tz = ctx.timezone;
  const decide = can(ctx, "approvals.decide");
  return (
    <>
      <PageHeader title="Approvals" lead="Key releases, policy exceptions and installations are decided by a person with authority. The decision, who made it and when are part of the record; a decision is not overwritten." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-5">
          <section aria-label="Pending">
            <h2 className="mb-2 text-sm font-semibold text-stone-900">Waiting for a decision ({pending.length})</h2>
            {pending.length ? (
              <div className="space-y-3">
                {pending.map((a) => (
                  <Card key={a.id} className="px-5 py-4" data-testid="pending-approval">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-stone-900">{a.title}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-stone-500"><Badge tone="brand">{APPROVAL_TYPES[a.type]?.label ?? a.type}</Badge>Requested by {a.requesterName} · {fmtDateTime(a.requestedAt, tz)}{a.neededBy ? <Badge tone="amber">needed by {fmtDateTime(a.neededBy, tz)}</Badge> : null}</p>
                      </div>
                      {a.caseId ? <Link href={`/cases/${a.caseId}`} className="text-xs font-medium text-brand-700 hover:underline">Open case</Link> : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-stone-700">{a.detail}</p>
                    {decide ? <ApprovalDecision id={a.id} selfRequested={a.requestedBy === ctx.userId && ctx.role !== "regional_admin"} createsWorkOrder={!!APPROVAL_TYPES[a.type]?.createsWorkOrder} /> : <p className="mt-3 text-xs text-stone-500">Waiting for the community manager.</p>}
                  </Card>
                ))}
              </div>
            ) : <Empty title="Nothing is waiting for a decision" />}
          </section>
          <Card className="overflow-x-auto">
            <CardHeader title={`Decided (${decided.length})`} />
            <table className="w-full">
              <thead className="border-b border-stone-200"><tr><th className={th}>Request</th><th className={th}>Decision</th><th className={th}>By</th><th className={th}>Note on record</th></tr></thead>
              <tbody className="divide-y divide-stone-100">
                {decided.map((a) => (
                  <tr key={a.id}>
                    <td className={td}>{a.caseId ? <Link href={`/cases/${a.caseId}`} className="font-medium text-brand-800 hover:underline">{a.title}</Link> : <span className="font-medium">{a.title}</span>}<span className="block text-xs text-stone-500">Requested by {a.requesterName}</span></td>
                    <td className={td}><StatusBadge status={a.status} /></td>
                    <td className={td}>{a.deciderName}<span className="block text-xs text-stone-500">{fmtDateTime(a.decidedAt, tz)}</span></td>
                    <td className={`${td} max-w-xs text-stone-600`}>{a.decisionNote ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        {can(ctx, "approvals.request") ? (
          <Card className="h-fit">
            <CardHeader title="New request" hint="Record a resident's request that needs a manager's decision." />
            <NewApprovalForm types={Object.entries(APPROVAL_TYPES).map(([id, t]) => ({ id, label: t.label }))} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
