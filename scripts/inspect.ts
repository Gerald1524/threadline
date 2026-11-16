/** Developer aid: print what the pipeline derived. `npx tsx scripts/inspect.ts [caseNumber]` */
import "./_env";
import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../src/lib/db/client";

const db = await getDb();
const q = async (s: ReturnType<typeof sql>) => (await db.execute(s)).rows as Record<string, unknown>[];
const arg = process.argv[2];
if (!arg) {
  console.table(await q(sql`select kind, count(*)::int n from source_records group by 1 order by 1`));
  console.table(await q(sql`select c.number, c.title, c.status, p.name property,
    (select count(*)::int from case_events ce where ce.case_id=c.id and ce.link_status='confirmed') confirmed,
    (select count(*)::int from case_events ce where ce.case_id=c.id and ce.link_status='suggested') suggested
    from cases c join properties p on p.id=c.property_id order by p.name, c.number`));
  console.table(await q(sql`select type, status, left(title,70) title from review_items order by type`));
  console.table(await q(sql`select filename, status, left(coalesce(error,''),80) error from ingest_jobs where status<>'succeeded'`));
  console.table(await q(sql`select type, count(*)::int n from events where property_id='prop_riverside' group by 1 order by 2 desc`));
} else {
  const rows = await q(sql`select to_char(e.occurred_at at time zone 'America/New_York','MM-DD HH24:MI') at, e.type, e.status st, ce.link_status link, sr.external_id src,
      coalesce((select full_name from users u where u.id=e.recorder_user_id),'') rec, coalesce((select full_name from users u where u.id=e.on_duty_user_id),'') duty,
      coalesce((select full_name from users u where u.id=e.investigator_user_id),'') inv,
      (select string_agg(left(cl.classification,5)||coalesce(':'||cl.outcome,''), ' | ' order by cl.ord) from claims cl where cl.event_id=e.id) claims
    from cases c join case_events ce on ce.case_id=c.id join events e on e.id=ce.event_id join source_records sr on sr.id=e.source_record_id
    where c.number=${arg} and c.property_id='prop_riverside' order by e.occurred_at`);
  for (const r of rows) console.log(`${r.at} ${String(r.type).padEnd(18)} ${String(r.st).padEnd(6)} ${String(r.link).padEnd(9)} ${String(r.src).slice(0, 34).padEnd(34)} rec=${r.rec} duty=${r.duty} inv=${r.inv}\n      ${r.claims}`);
}
await closeDb();
