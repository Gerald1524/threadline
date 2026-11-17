/** Permission-scoped full-text retrieval over preserved originals (Postgres tsvector). */
import { and, eq, inArray, sql } from "drizzle-orm";
import { visibleLevels, type AccessContext } from "../access";
import { getDb } from "../db/client";
import { sourceRecords } from "../db/schema";

const EXPAND: Record<string, string[]> = {
  smoke: ["smoke", "cigarette", "smoking", "odor", "tobacco"], smoking: ["smoke", "cigarette", "smoking"], noise: ["noise", "loud", "music", "banging", "thumping"],
  key: ["key", "fob", "lockout"], leak: ["leak", "dripping", "water"], mirror: ["mirror", "install", "mount", "hang"], package: ["package", "pkg", "fedex", "ups"],
};
const STOP = new Set("there been were they them their our us you your he she his her not no yes please tell me show all some just also ever get got know known happened happen the a an of to in on at for and or is are was were did do does we i it this that with about from what when who how any has have had be been near again actually can".split(" "));

/** One tsquery per concept in the question (a word plus its synonyms). */
export function toConcepts(question: string): string[] {
  const out: string[] = [];
  for (const w of new Set(question.toLowerCase().match(/[a-z0-9]{2,}/g) ?? [])) {
    if (STOP.has(w)) continue;
    out.push((EXPAND[w] ?? [w]).join(" | "));
  }
  return out;
}

export type SearchHit = { id: string; title: string; kind: string; externalId: string; occurredAt: Date | null; snippet: string; rank: number };

/**
 * A record must match at least two concepts of a multi-word question. A single stemmed
 * coincidence ("parking" vs. a resident named Park) is not a result.
 */
export async function searchRecords(ctx: AccessContext, question: string, limit = 8): Promise<SearchHit[]> {
  const concepts = toConcepts(question).slice(0, 12);
  if (!concepts.length) return [];
  const db = await getDb(ctx);
  const query = sql`to_tsquery('english', ${concepts.map((c) => `(${c})`).join(" | ")})`;
  const matched = sql.join(concepts.map((c) => sql`(search @@ to_tsquery('english', ${c}))::int`), sql` + `);
  const need = Math.min(2, concepts.length);
  const rows = await db
    .select({ id: sourceRecords.id, title: sourceRecords.title, kind: sourceRecords.kind, externalId: sourceRecords.externalId, occurredAt: sourceRecords.occurredAt, snippet: sql<string>`ts_headline('english', ${sourceRecords.rawText}, ${query}, 'MaxWords=28, MinWords=12, StartSel=«, StopSel=»')`, rank: sql<number>`ts_rank(search, ${query})` })
    .from(sourceRecords)
    .where(and(eq(sourceRecords.orgId, ctx.orgId), eq(sourceRecords.propertyId, ctx.propertyId), inArray(sourceRecords.visibility, visibleLevels(ctx)), eq(sourceRecords.isCurrent, true), eq(sourceRecords.lifecycle, "active"), sql`search @@ ${query}`, sql`(${matched}) >= ${need}`))
    .orderBy(sql`(${matched}) desc, ts_rank(search, ${query}) desc`).limit(limit);
  return rows;
}
