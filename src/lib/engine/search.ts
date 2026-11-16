/** Permission-scoped full-text retrieval over preserved originals (Postgres tsvector). */
import { and, eq, inArray, sql } from "drizzle-orm";
import { visibleLevels, type AccessContext } from "../access";
import { getDb } from "../db/client";
import { sourceRecords } from "../db/schema";

const EXPAND: Record<string, string[]> = {
  smoke: ["smoke", "cigarette", "smoking", "odor", "tobacco"], smoking: ["smoke", "cigarette", "smoking"], noise: ["noise", "loud", "music", "banging", "thumping"],
  key: ["key", "fob", "lockout"], leak: ["leak", "dripping", "water"], mirror: ["mirror", "install", "mount", "hang"], package: ["package", "pkg", "fedex", "ups"],
};
const STOP = new Set("the a an of to in on at for and or is are was were did do does we i it this that with about from what when who how any has have had be been near again actually can".split(" "));

export function toTsQuery(question: string): string | null {
  const terms = new Set<string>();
  for (const w of question.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []) {
    if (STOP.has(w)) continue;
    for (const x of EXPAND[w] ?? [w]) terms.add(x);
  }
  return terms.size ? [...terms].join(" | ") : null;
}

export type SearchHit = { id: string; title: string; kind: string; externalId: string; occurredAt: Date | null; snippet: string; rank: number };

export async function searchRecords(ctx: AccessContext, question: string, limit = 8): Promise<SearchHit[]> {
  const tsq = toTsQuery(question);
  if (!tsq) return [];
  const db = await getDb();
  const query = sql`to_tsquery('english', ${tsq})`;
  const rows = await db
    .select({ id: sourceRecords.id, title: sourceRecords.title, kind: sourceRecords.kind, externalId: sourceRecords.externalId, occurredAt: sourceRecords.occurredAt, snippet: sql<string>`ts_headline('english', ${sourceRecords.rawText}, ${query}, 'MaxWords=28, MinWords=12, StartSel=«, StopSel=»')`, rank: sql<number>`ts_rank(search, ${query})` })
    .from(sourceRecords)
    .where(and(eq(sourceRecords.orgId, ctx.orgId), eq(sourceRecords.propertyId, ctx.propertyId), inArray(sourceRecords.visibility, visibleLevels(ctx)), eq(sourceRecords.isCurrent, true), eq(sourceRecords.lifecycle, "active"), sql`search @@ ${query}`))
    .orderBy(sql`ts_rank(search, ${query}) desc`).limit(limit);
  return rows;
}
