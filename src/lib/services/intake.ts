import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { assertCan, scopeOf, type AccessContext } from "../access";
import { audit } from "../audit";
import { getDb } from "../db/client";
import { dataSources, events, sourceRecords } from "../db/schema";
import { loadDirectory } from "../ingest/directory";
import { extractRecord } from "../ingest/extract";
import { CATEGORY_LABEL } from "../ingest/lexicon";
import { ingestRecords } from "../ingest/pipeline";
import type { ParsedRecord } from "../ingest/parsers";
import { localParts } from "../util/time";

const IntakeSchema = z.object({
  text: z.string().trim().min(8, "Describe what happened in a sentence or two.").max(4000),
  unit: z.string().trim().max(8).optional(),
  type: z.enum(["", "Complaint", "Inspection", "Request", "Note"]).optional(),
  occurredAt: z.date().optional(),
  inputMode: z.enum(["text", "voice"]).default("text"),
  idempotencyKey: z.string().min(8),
});
export type IntakeInput = z.input<typeof IntakeSchema>;

function toRecord(ctx: AccessContext, v: z.output<typeof IntakeSchema>, now: Date): ParsedRecord {
  const occurredAt = v.occurredAt ?? now;
  const p = localParts(occurredAt, ctx.timezone);
  return {
    kind: "shift_note", externalId: `inapp:${v.idempotencyKey}`, locator: `threadline://intake/${v.idempotencyKey}`, title: `Front desk entry by ${ctx.userName}`, text: v.text,
    json: { staff: ctx.userName, unit: v.unit ?? "", type: v.type ?? "", inputMode: v.inputMode, eventLocal: { date: p.date, time: p.time }, loggedLocal: null },
    author: ctx.userName, occurredAt, recordedAt: now,
  };
}

/** Show the employee how the entry will be read before anything is saved. */
export async function previewIntake(ctx: AccessContext, input: IntakeInput) {
  assertCan(ctx, "activity.write");
  const v = IntakeSchema.parse(input);
  const db = await getDb();
  const dir = await loadDirectory(db, ctx.propertyId);
  const ext = extractRecord(toRecord(ctx, v, new Date()), dir, { visibility: "staff" });
  const unitLabel = (id?: string) => [...dir.units.entries()].find(([, u]) => u.id === id)?.[0] ?? null;
  return {
    events: ext.events.map((e) => ({ type: e.type, category: e.category, categoryLabel: CATEGORY_LABEL[e.category] ?? e.category, unit: unitLabel(e.unitId), reporterUnit: unitLabel(e.reporterUnitId), reporterName: e.reporterName ?? null, occurredAt: e.occurredAt.toISOString(), claims: e.claims })),
    flags: ext.reviews.map((r) => r.title), sensitivity: ext.sensitivity,
  };
}

/** Save a confirmed entry through the same pipeline as imported records. Idempotent. */
export async function confirmIntake(ctx: AccessContext, input: IntakeInput) {
  assertCan(ctx, "activity.write");
  const v = IntakeSchema.parse(input);
  const db = await getDb();
  const [source] = await db.select().from(dataSources).where(and(scopeOf(ctx, dataSources), eq(dataSources.mode, "in_app")));
  if (!source) throw new Error("In-app source is not configured");
  const rec = toRecord(ctx, v, new Date());
  const counts = await ingestRecords(source, [rec]);
  const [sr] = await db.select().from(sourceRecords).where(and(scopeOf(ctx, sourceRecords), eq(sourceRecords.externalId, rec.externalId), eq(sourceRecords.isCurrent, true)));
  const evs = sr ? await db.select().from(events).where(eq(events.sourceRecordId, sr.id)) : [];
  if (counts.created) await db.transaction((tx) => audit(tx, ctx, "intake.recorded", "source_record", sr!.id, { inputMode: v.inputMode, events: evs.length }));
  return { sourceRecordId: sr?.id ?? null, eventIds: evs.map((e) => e.id), created: counts.created > 0 };
}
