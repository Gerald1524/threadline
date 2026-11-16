import { requireContext } from "@/lib/auth/session";
import { CATEGORY_LABEL } from "@/lib/ingest/lexicon";
import { listPolicies } from "@/lib/services/policies";
import { SourceChip } from "@/components/timeline";
import { Badge, Card, PageHeader, StatusBadge } from "@/components/ui";

export default async function PoliciesPage() {
  const ctx = await requireContext("policies.read");
  const policies = await listPolicies(ctx);
  return (
    <>
      <PageHeader title="Policies" lead="Only the single approved version of each policy is authoritative. Superseded versions are kept for the record; drafts and working notes are never used to answer a policy question." />
      <div className="space-y-4">
        {policies.map((p) => (
          <Card key={p.id} id={p.key} className="scroll-mt-20 px-5 py-4">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[15px] font-semibold text-stone-900">{p.title}</h2>
              <Badge tone="brand">{CATEGORY_LABEL[p.category] ?? p.category}</Badge>
              {p.current ? <Badge tone="green">v{p.current.version} approved{p.current.effectiveFrom ? ` · effective ${p.current.effectiveFrom}` : ""}</Badge> : <Badge tone="rose">no approved version</Badge>}
              {p.current?.sourceRecordId ? <SourceChip id={p.current.sourceRecordId} label="original" /> : null}
            </div>
            {p.current ? (
              <>
                <ol className="mt-3 space-y-1.5 text-sm leading-relaxed text-stone-800">{p.current.body.split("\n").filter((l) => /^\d+\./.test(l.trim())).map((l, i) => <li key={i}>{l.trim()}</li>)}</ol>
                {p.current.approvedByName ? <p className="mt-2 text-xs text-stone-500">Approved by {p.current.approvedByName}</p> : null}
              </>
            ) : null}
            {p.versions.filter((v) => v.id !== p.current?.id).length ? (
              <details className="mt-3 text-sm">
                <summary className="cursor-pointer text-xs font-medium text-stone-600">Earlier and draft versions ({p.versions.filter((v) => v.id !== p.current?.id).length})</summary>
                {p.versions.filter((v) => v.id !== p.current?.id).map((v) => (
                  <div key={v.id} className="mt-2 rounded-lg border border-dashed border-stone-300 bg-stone-50 p-3">
                    <p className="flex items-center gap-2 text-xs text-stone-600">Version {v.version} <StatusBadge status={v.status === "superseded" ? "closed" : "draft"} /> {v.status} — not in force{v.sourceRecordId ? <SourceChip id={v.sourceRecordId} label="original" /> : null}</p>
                    <p className="mt-1 whitespace-pre-wrap text-[13px] text-stone-500 line-through decoration-stone-300">{v.body.replace(/^#.*\n+/, "")}</p>
                  </div>
                ))}
              </details>
            ) : null}
          </Card>
        ))}
      </div>
    </>
  );
}
