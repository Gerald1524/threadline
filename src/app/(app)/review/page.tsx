import Link from "next/link";
import { can } from "@/lib/access";
import { requireContext } from "@/lib/auth/session";
import { listReviewItems } from "@/lib/services/review";
import { fmtDateTime } from "@/lib/util/time";
import { ReviewActions } from "@/components/review-actions";
import { SourceChip } from "@/components/timeline";
import { Badge, Card, Empty, PageHeader, type Tone } from "@/components/ui";

const TYPE: Record<string, { label: string; tone: Tone; why: string }> = {
  tentative_link: { label: "Tentative link", tone: "violet", why: "Possibly related to a case. It is not counted as evidence unless you confirm it." },
  duplicate_candidate: { label: "Possible duplicate", tone: "amber", why: "Two entries may describe one event. Confirm to count it once; both entries are kept." },
  ambiguous_identity: { label: "Identity uncertain", tone: "amber", why: "The person or apartment could not be confirmed. Link it to a case from that case if it belongs there." },
  sensitive_content: { label: "Sensitive content", tone: "rose", why: "Check that this record should be visible at its current level." },
  suspected_injection: { label: "Instruction-like text", tone: "rose", why: "The text addresses an automated system. It is kept as evidence and withheld from AI model prompts." },
  low_confidence: { label: "Low confidence", tone: "amber", why: "The extraction rules were unsure." },
};

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireContext("review.read");
  const { show } = await searchParams;
  const items = await listReviewItems(ctx, show === "all" ? "all" : "open");
  const resolve = can(ctx, "review.resolve");
  return (
    <>
      <PageHeader title="Review inbox" lead="Where the system was unsure, or the content is sensitive, a person decides. Nothing here is treated as established until someone has." right={<Link href={show === "all" ? "/review" : "/review?show=all"} className="text-sm font-medium text-brand-700 hover:underline">{show === "all" ? "Show open only" : "Show resolved too"}</Link>} />
      {items.length ? (
        <div className="space-y-3">
          {items.map((r) => {
            const t = TYPE[r.type] ?? TYPE.low_confidence;
            return (
              <Card key={r.id} className="px-5 py-4" data-testid="review-item" data-type={r.type}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={t.tone}>{t.label}</Badge>
                  <h2 className="text-sm font-semibold text-stone-900">{r.title}</h2>
                  {r.sourceRecordId ? <SourceChip id={r.sourceRecordId} label="open record" /> : null}
                  {r.caseId ? <Link href={`/cases/${r.caseId}`} className="text-xs font-medium text-brand-700 hover:underline">open case</Link> : null}
                </div>
                <p className="mt-1.5 text-sm text-stone-700">{r.detail}</p>
                <p className="mt-1 text-xs text-stone-500">{t.why}</p>
                {r.status === "open" ? (resolve ? <ReviewActions id={r.id} type={r.type} /> : <p className="mt-2 text-xs text-stone-500">A community manager decides these.</p>) : <p className="mt-2 text-xs text-emerald-700">Resolved {fmtDateTime(r.resolvedAt, ctx.timezone)}: {r.resolution}</p>}
              </Card>
            );
          })}
        </div>
      ) : <Empty title="The review inbox is empty">New uncertain links, possible duplicates and sensitive records will appear here as records are imported.</Empty>}
    </>
  );
}
