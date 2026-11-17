import { and, desc, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { scopeOf, visibleScope } from "@/lib/access";
import { notFound, withContext } from "@/lib/api";
import { audit } from "@/lib/audit";
import { getDb } from "@/lib/db/client";
import { blobs, claims, dataSources, events, sourceRecords, users } from "@/lib/db/schema";
import { OUTCOME_LABEL, SENSITIVITY_LABEL } from "@/lib/ingest/lexicon";
import { getSourceRecord } from "@/lib/services/cases";
import { recordHash } from "@/lib/util/core";

/** The original record behind a citation, with its provenance, for the source inspector. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return withContext(async (ctx) => {
    const r = await getSourceRecord(ctx, id);
    if (!r) return notFound();
    const db = await getDb(ctx);
    const [src] = await db.select().from(dataSources).where(eq(dataSources.id, r.sourceId));
    const evs = await db.select().from(events).where(and(visibleScope(ctx, events), eq(events.sourceRecordId, r.id)));
    const cls = evs.length ? await db.select().from(claims).where(and(scopeOf(ctx, claims), inArray(claims.eventId, evs.map((e) => e.id)))).orderBy(claims.ord) : [];
    const people = new Map((await db.select().from(users).where(eq(users.orgId, ctx.orgId))).map((u) => [u.id, u.fullName]));
    const atts = await db.select().from(blobs).where(and(scopeOf(ctx, blobs), eq(blobs.sourceRecordId, r.id)));
    const versions = await db.select({ id: sourceRecords.id, version: sourceRecords.version, isCurrent: sourceRecords.isCurrent, ingestedAt: sourceRecords.ingestedAt }).from(sourceRecords)
      .where(and(visibleScope(ctx, sourceRecords), eq(sourceRecords.sourceId, r.sourceId), eq(sourceRecords.externalId, r.externalId))).orderBy(desc(sourceRecords.version));
    const corrections = evs.length ? await db.select().from(events).where(and(visibleScope(ctx, events), inArray(events.correctsEventId, evs.map((e) => e.id)))) : [];
    // Opening confidential case material is itself an auditable access.
    if (["confidential_case", "highly_sensitive"].includes(r.sensitivity)) await db.transaction((tx) => audit(tx, ctx, "source.viewed", "source_record", r.id, { sensitivity: r.sensitivity }));
    return NextResponse.json({
      id: r.id, kind: r.kind, title: r.title, externalId: r.externalId, locator: r.locator, sourceName: src?.name ?? "", author: r.author, filename: r.filename,
      occurredAt: r.occurredAt, recordedAt: r.recordedAt, ingestedAt: r.ingestedAt, contentHash: r.contentHash, version: r.version, isCurrent: r.isCurrent,
      hashVerified: r.lifecycle === "disposed" ? null : recordHash(r.kind, r.rawText, r.rawJson) === r.contentHash,
      sensitivity: SENSITIVITY_LABEL[r.sensitivity] ?? r.sensitivity, visibility: r.visibility, flagged: r.injectionFlag, lifecycle: r.lifecycle, text: r.rawText, fields: r.rawJson,
      attachments: atts.map((a) => ({ id: a.id, filename: a.filename, mediaType: a.mediaType, byteSize: a.byteSize, sha256: a.sha256 })),
      events: evs.map((e) => ({ id: e.id, type: e.type, status: e.status, occurredAt: e.occurredAt, extraction: e.extractionMethod, confidence: e.extractionConfidence, recorder: e.recorderUserId ? people.get(e.recorderUserId) : null, investigator: e.investigatorUserId ? people.get(e.investigatorUserId) : null, claims: cls.filter((c) => c.eventId === e.id).map((c) => ({ classification: c.classification, outcome: c.outcome ? (OUTCOME_LABEL[c.outcome] ?? c.outcome) : null, text: c.text })) })),
      versions, corrections: corrections.map((c) => ({ id: c.id, sourceId: c.sourceRecordId, summary: c.summary, at: c.occurredAt, by: c.recorderUserId ? people.get(c.recorderUserId) : null })),
    });
  });
}
