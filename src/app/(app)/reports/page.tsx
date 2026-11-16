import Link from "next/link";
import { requireContext } from "@/lib/auth/session";
import { listReports } from "@/lib/services/reports";
import { fmtDateTime } from "@/lib/util/time";
import { Card, CardHeader, Empty, PageHeader, btn } from "@/components/ui";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ id?: string }> }) {
  const ctx = await requireContext("reports.read");
  const { id } = await searchParams;
  const reports = await listReports(ctx);
  const current = reports.find((r) => r.id === id) ?? reports[0];
  return (
    <>
      <PageHeader title="Reports" lead="Case packets generated for management or attorney review. Each is stored privately with a hash, lists every source it relies on, and is reproducible from the records as they stood when it was generated." />
      {reports.length ? (
        <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
          <Card className="h-fit">
            <CardHeader title="Generated packets" />
            <ul className="divide-y divide-stone-100">
              {reports.map((r) => (
                <li key={r.id}>
                  <Link href={`/reports?id=${r.id}`} aria-current={r.id === current.id} className={`block px-5 py-3 text-sm hover:bg-stone-50 ${r.id === current.id ? "bg-brand-50" : ""}`}>
                    <span className="block font-medium text-stone-900">{r.caseNumber} · {r.caseTitle}</span>
                    <span className="block text-xs text-stone-500">{fmtDateTime(r.generatedAt, ctx.timezone)} · {r.generatedByName} · {r.sourceCount} sources</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title={current.title} hint={<>SHA-256 <span className="font-mono">{current.pdfSha256?.slice(0, 24)}…</span>{current.reviewNote ? ` · Reviewer note: ${current.reviewNote}` : ""}</>}
              right={<span className="flex gap-2"><Link href={`/cases/${current.caseId}`} className={btn("secondary", "sm")}>Open case</Link><a href={`/api/reports/${current.id}?download=1`} className={btn("primary", "sm")}>Download PDF</a></span>} />
            <iframe title="Case packet" src={`/api/reports/${current.id}`} className="h-[75vh] w-full rounded-b-xl" />
          </Card>
        </div>
      ) : <Empty title="No case packets yet">Open a case and choose “Generate Case Packet”. You will be asked to confirm you have reviewed the sources first.</Empty>}
    </>
  );
}
