import Link from "next/link";
import { requireContext } from "@/lib/auth/session";
import { CATEGORY_LABEL } from "@/lib/ingest/lexicon";
import { listCases } from "@/lib/services/cases";
import { fmtDate } from "@/lib/util/time";
import { Card, Empty, PageHeader, StatusBadge, td, th } from "@/components/ui";

export default async function CasesPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireContext("cases.read");
  const { status } = await searchParams;
  const all = await listCases(ctx);
  const open = (s: string) => !["resolved", "closed"].includes(s);
  const rows = status === "all" ? all : status === "closed" ? all.filter((c) => !open(c.status)) : all.filter((c) => open(c.status));
  const tabs = [["open", `Open (${all.filter((c) => open(c.status)).length})`], ["closed", `Resolved / closed (${all.filter((c) => !open(c.status)).length})`], ["all", `All (${all.length})`]];
  return (
    <>
      <PageHeader title="Cases" lead="A case groups the reports, checks, replies and work orders about one matter. Records are linked by rules; uncertain links wait in the review inbox and are never counted until a person confirms them." />
      <div className="mb-3 flex gap-1.5">
        {tabs.map(([k, label]) => <Link key={k} href={`/cases?status=${k}`} className={`rounded-full px-3 py-1 text-sm font-medium ${(status ?? "open") === k ? "bg-brand-800 text-white" : "bg-white text-stone-700 ring-1 ring-inset ring-stone-300 hover:bg-stone-50"}`}>{label}</Link>)}
      </div>
      {rows.length ? (
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-stone-200"><tr><th className={th}>Case</th><th className={th}>Category</th><th className={th}>Status</th><th className={th}>Records</th><th className={th}>Opened</th><th className={th}>Last activity</th></tr></thead>
            <tbody className="divide-y divide-stone-100">
              {rows.map((c) => (
                <tr key={c.id} className="hover:bg-stone-50">
                  <td className={td}><Link href={`/cases/${c.id}`} className="font-medium text-brand-800 hover:underline"><span className="mr-2 font-mono text-xs text-stone-500">{c.number}</span>{c.title}</Link></td>
                  <td className={td}>{CATEGORY_LABEL[c.category] ?? c.category}</td>
                  <td className={td}><StatusBadge status={c.status} /></td>
                  <td className={td}>{c.eventCount}</td>
                  <td className={td}>{fmtDate(c.openedAt, ctx.timezone)}</td>
                  <td className={td}>{fmtDate(c.lastActivityAt, ctx.timezone)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : <Empty title="No cases in this view">Cases open automatically when a complaint or request is logged or imported.</Empty>}
    </>
  );
}
