import Link from "next/link";
import { can } from "@/lib/access";
import { requireContext } from "@/lib/auth/session";
import { draftHandoffItems, listHandoffs } from "@/lib/services/handoffs";
import { fmtTime, localParts } from "@/lib/util/time";
import { AckButton, HandoffComposer } from "@/components/handoff-forms";
import { Badge, Card, CardHeader, Empty, PageHeader } from "@/components/ui";

export default async function HandoffsPage() {
  const ctx = await requireContext("handoffs.read");
  const list = await listHandoffs(ctx);
  const canWrite = can(ctx, "handoffs.write");
  const suggested = canWrite ? await draftHandoffItems(ctx) : [];
  const h = localParts(new Date(), ctx.timezone).hour;
  const shift = h >= 7 && h < 15 ? "Day → Evening" : h >= 15 && h < 23 ? "Evening → Overnight" : "Overnight → Day";
  return (
    <>
      <PageHeader title="Shift handoffs" lead="What the next person on the desk needs to know. Incoming staff, including temps, acknowledge that they have read it." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="space-y-4">
          {list.length ? list.map((x) => {
            const mine = x.acks.some((a) => a.userId === ctx.userId);
            return (
              <Card key={x.id} data-testid="handoff">
                <CardHeader title={x.shiftLabel} hint={<>{x.fromName}{x.fromEmployment === "temp" ? " (temp)" : ""} · {x.when}</>}
                  right={x.fromUserId === ctx.userId ? <Badge>yours</Badge> : mine ? <Badge tone="green">You acknowledged</Badge> : <AckButton id={x.id} />} />
                <ul className="space-y-2 px-5 py-4 text-sm text-stone-800">
                  {x.items.map((it, i) => <li key={i} className="flex gap-2"><span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" aria-hidden /><span>{it.text}{it.kind === "case" && it.refId ? <> <Link href={`/cases/${it.refId}`} className="text-xs font-medium text-brand-700 hover:underline">open</Link></> : null}</span></li>)}
                  {x.note ? <li className="text-stone-600">Note: {x.note}</li> : null}
                </ul>
                <footer className="border-t border-stone-100 px-5 py-2.5 text-xs text-stone-500">{x.acks.length ? `Acknowledged by ${x.acks.map((a) => `${a.name} (${fmtTime(a.at, ctx.timezone)})`).join(", ")}` : "Not yet acknowledged by incoming staff"}</footer>
              </Card>
            );
          }) : <Empty title="No handoffs yet" />}
        </div>
        {canWrite ? (
          <Card className="h-fit">
            <CardHeader title="Write a handoff" hint="Suggested from what is open right now and visible to you. Remove or edit anything before publishing." />
            <HandoffComposer suggested={suggested} defaultLabel={shift} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
