import { and, desc, eq, ilike, inArray, or } from "drizzle-orm";
import { can, visibleScope } from "@/lib/access";
import { requireContext } from "@/lib/auth/session";
import { voiceConfig } from "@/lib/ai/voice";
import { getDb } from "@/lib/db/client";
import { events, units } from "@/lib/db/schema";
import { buildItems, loadLookups } from "@/lib/engine/evidence";
import { IntakeForm } from "@/components/intake-form";
import { Timeline } from "@/components/timeline";
import { Card, CardHeader, Empty, PageHeader, btn, inputCls } from "@/components/ui";

const TYPES: Record<string, string[]> = { reports: ["complaint_report", "request", "follow_up"], checks: ["investigation"], replies: ["response", "notice", "resident_statement"], workflow: ["approval_request", "approval_decision", "work_order", "work_order_update", "status_change", "maintenance_update_request", "correction"] };

export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ type?: string; q?: string; unit?: string }> }) {
  const ctx = await requireContext("activity.read");
  const sp = await searchParams;
  const db = await getDb(ctx);
  const unit = sp.unit ? (await db.select().from(units).where(and(eq(units.propertyId, ctx.propertyId), eq(units.label, sp.unit.toUpperCase().replace(/[^0-9A-Z]/g, "")))))[0] : undefined;
  const where = and(
    visibleScope(ctx, events), inArray(events.status, ["active", "duplicate"]),
    sp.type && TYPES[sp.type] ? inArray(events.type, TYPES[sp.type]) : undefined,
    sp.q ? ilike(events.summary, `%${sp.q.replace(/[%_]/g, "")}%`) : undefined,
    sp.unit ? (unit ? or(eq(events.unitId, unit.id), eq(events.reporterUnitId, unit.id)) : eq(events.id, "__none__")) : undefined,
  );
  const rows = await db.select().from(events).where(where).orderBy(desc(events.occurredAt)).limit(60);
  const { items, sources } = await buildItems(ctx, await loadLookups(ctx), rows);
  const labels = new Map(sources.map((s) => [s.id, "open"]));
  return (
    <>
      <PageHeader title="Activity log" lead="The event ledger: every imported or entered record, with who reported it, who wrote it down, who was on the desk and who checked. Entries are never edited in place; corrections are added alongside the original." />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <form className="mb-4 flex flex-wrap items-end gap-2" role="search">
            <label className="text-xs font-medium text-stone-600">Type
              <select name="type" defaultValue={sp.type ?? ""} className={`${inputCls} mt-1 w-40`}>
                <option value="">All records</option><option value="reports">Reports & requests</option><option value="checks">Staff checks</option><option value="replies">Replies & statements</option><option value="workflow">Workflow</option>
              </select>
            </label>
            <label className="text-xs font-medium text-stone-600">Unit<input name="unit" defaultValue={sp.unit ?? ""} placeholder="12B" className={`${inputCls} mt-1 w-24`} /></label>
            <label className="flex-1 text-xs font-medium text-stone-600">Contains<input name="q" defaultValue={sp.q ?? ""} placeholder="smoke, key, WO-2041…" className={`${inputCls} mt-1`} /></label>
            <button className={btn("secondary")}>Filter</button>
          </form>
          {items.length ? <Timeline items={[...items].reverse()} labels={labels} tz={ctx.timezone} initial={25} /> : <Empty title="No records match">{sp.unit && !unit ? `There is no unit ${sp.unit} at this property.` : "Try a broader filter. A missing record is not proof that nothing happened."}</Empty>}
          {rows.length === 60 ? <p className="mt-3 text-xs text-stone-500">Showing the 60 most recent matching records. Narrow the filter to see older ones.</p> : null}
        </div>
        {can(ctx, "activity.write") ? (
          <Card className="h-fit lg:sticky lg:top-20">
            <CardHeader title="New entry" hint="Type or dictate what happened. You confirm how it was read before it is saved." />
            <IntakeForm voice={await voiceConfig(ctx)} />
          </Card>
        ) : null}
      </div>
    </>
  );
}
