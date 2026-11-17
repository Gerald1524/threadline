import { and, eq, inArray } from "drizzle-orm";
import { can, scopeOf } from "@/lib/access";
import { requireContext } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { memberships, messages, users } from "@/lib/db/schema";
import { listWorkOrders } from "@/lib/services/workorders";
import { fmtDate, fmtDateTime, localParts } from "@/lib/util/time";
import { WorkOrderRow } from "@/components/work-order-row";
import { Card, Empty, Notice, PageHeader } from "@/components/ui";

export default async function WorkOrdersPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const ctx = await requireContext("workorders.read");
  const { show } = await searchParams;
  const db = await getDb(ctx);
  const all = await listWorkOrders(ctx);
  const open = all.filter((w) => !["completed", "cancelled"].includes(w.status));
  const rows = show === "all" ? all : open;
  const staff = await db.select({ id: users.id, name: users.fullName }).from(users).innerJoin(memberships, eq(memberships.userId, users.id)).where(and(eq(memberships.propertyId, ctx.propertyId), inArray(memberships.role, ["porter", "superintendent"])));
  const asks = await db.select().from(messages).where(and(scopeOf(ctx, messages), eq(messages.kind, "maintenance_update_request"), eq(messages.status, "sent")));
  const waiting = open.filter((w) => asks.some((m) => m.workOrderId === w.id && m.sentAt && m.sentAt > w.updatedAt));
  const tz = ctx.timezone;
  return (
    <>
      <PageHeader title="Work orders" lead="Maintenance work, imported from the work-order export or created from an approved request. Status changes and ETAs are recorded on the related case." />
      {waiting.length && can(ctx, "workorders.update") ? <div className="mb-4"><Notice tone="amber"><strong>The front desk is waiting for an update on:</strong> {waiting.map((w) => `${w.number} (${w.title})`).join(", ")}.</Notice></div> : null}
      <div className="mb-3 flex gap-1.5 text-sm">
        <a href="/work-orders" className={`rounded-full px-3 py-1 font-medium ${show !== "all" ? "bg-brand-800 text-white" : "bg-white ring-1 ring-inset ring-stone-300"}`}>Open ({open.length})</a>
        <a href="/work-orders?show=all" className={`rounded-full px-3 py-1 font-medium ${show === "all" ? "bg-brand-800 text-white" : "bg-white ring-1 ring-inset ring-stone-300"}`}>All ({all.length})</a>
      </div>
      {rows.length ? (
        <Card className="divide-y divide-stone-100">
          {rows.map((w) => (
            <WorkOrderRow key={w.id} canUpdate={can(ctx, "workorders.update")} canAsk={can(ctx, "messages.draft")} staff={staff} asked={waiting.some((x) => x.id === w.id)}
              wo={{ id: w.id, number: w.number, title: w.title, description: w.description, status: w.status, unit: w.unitLabel, assignee: w.assigneeName, assigneeId: w.assigneeUserId, caseId: w.caseId, note: w.resolutionNote,
                etaLabel: w.eta ? fmtDateTime(w.eta, tz) : null, etaLocal: w.eta ? `${localParts(w.eta, tz).date}T${localParts(w.eta, tz).time}` : "", created: fmtDate(w.createdAt, tz), completed: w.completedAt ? fmtDate(w.completedAt, tz) : null }} />
          ))}
        </Card>
      ) : <Empty title="No open work orders" />}
    </>
  );
}
