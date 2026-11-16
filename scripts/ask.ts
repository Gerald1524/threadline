/** Ask a question from the terminal: `npm run ask -- u_priya "When did the smoke at 12B start?" ["follow-up" ...]` */
import "./_env";
import { closeDb } from "../src/lib/db/client";
import { ask } from "../src/lib/engine/ask";
import { ctxFor } from "../src/lib/seed/seed";

const [userId, ...questions] = process.argv.slice(2);
if (!userId || !questions.length) {
  console.error('usage: npm run ask -- <userId> "<question>" ["<follow-up>" ...]');
  process.exit(1);
}
const ctx = ctxFor(userId);
let conversationId: string | undefined;
for (const question of questions) {
  const { answer: a, conversationId: id } = await ask(ctx, { question, conversationId });
  conversationId = id;
  const label = new Map(a.sources.map((s) => [s.id, s.label]));
  console.log(`\n━━ ${question}\n[${a.intent} · ${a.mode} · ${a.latencyMs} ms · verified ${a.verification.verified}/${a.verification.checked}]\n\n${a.headline}\n`);
  for (const c of a.claims) console.log(` • (${c.classification}) ${c.text} ${c.sourceIds.map((i) => `[${label.get(i)}]`).join("")}`);
  for (const c of a.withheld) console.log(` ✗ WITHHELD: ${c.text}\n     reason: ${c.issue}`);
  if (a.facts.length) console.log("\n Facts: " + a.facts.map((f) => `${f.label}: ${f.value}`).join(" | "));
  if (a.gaps.length) console.log("\n Gaps:\n" + a.gaps.map((g) => `   - ${g.text}`).join("\n"));
  if (a.conflicts.length) console.log(" Conflicts:\n" + a.conflicts.map((g) => `   - ${g.text}`).join("\n"));
  if (a.restrictedNote) console.log(` Note: ${a.restrictedNote}`);
  console.log(` Actions: ${a.actions.map((x) => x.label).join(", ") || "—"}   Sources: ${a.sources.length}   Timeline: ${a.timeline.length}`);
}
await closeDb();
