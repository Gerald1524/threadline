import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { Narrator } from "@/lib/ai/narrate";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { ask, setNarratorForTests } from "@/lib/engine/ask";
import { NOW, as, useSeededDb } from "./helpers/db";

const Q = "What do we know about the smoke complaints about 12B?";

/**
 * The model path is exercised with a scripted narrator standing in for the API. These tests
 * show what happens when a model's narrative is wrong: the verifier withholds it.
 */
describe("claim verification of model narratives (scripted model)", () => {
  useSeededDb();
  const priya = as("u_priya");
  afterEach(() => setNarratorForTests(null));
  const id = (draft: Parameters<Narrator>[2], ext: string) => draft.sources.find((s) => s.externalId === ext)!.id;
  const base = { speakable: "spoken", usage: { inputTokens: 100, outputTokens: 50 }, model: "scripted-test-model", extraSourceIds: [] as string[] };

  it("accepts an accurate narrative and marks the answer as model-written", async () => {
    setNarratorForTests(async (_ctx, _q, draft) => ({ ...base, headline: "Ten reports, five checks, nothing observed at 12B.", claims: [
      { text: "Carlos Mendez checked the 12th floor on Oct 5 and recorded no smoke smell in the hallway and no answer at 12B.", classification: "staff_observation", sourceIds: [id(draft, "FD-1005-08")] },
      { text: "There have been 10 reports and 5 staff checks; no employee observed smoking in 12B.", classification: "missing_evidence", sourceIds: [id(draft, "FD-1005-07"), id(draft, "FD-1005-08")] },
    ] }));
    const { answer } = await ask(priya, { question: Q }, { now: NOW });
    expect(answer.mode).toBe("model");
    expect(answer.claims).toHaveLength(2);
    expect(answer.withheld).toHaveLength(0);
    expect(answer.facts.find((f) => f.key === "complaints")?.n).toBe(10); // facts still come from Threadline
    const db = await getDb("system");
    const logs = await db.select().from(t.providerRequests).where(eq(t.providerRequests.orgId, "org_northbridge"));
    expect(logs.at(-1)).toMatchObject({ status: "ok", model: "scripted-test-model", inputTokens: 100, outputTokens: 50 });
  });

  it("withholds fabricated dates, counts, names, quotes and unsupported confirmation", async () => {
    const db = await getDb("system");
    const [foreign] = await db.select().from(t.sourceRecords).where(and(eq(t.sourceRecords.orgId, "org_harborview"), eq(t.sourceRecords.kind, "email")));
    setNarratorForTests(async (_ctx, _q, draft) => ({ ...base, headline: "Summary", claims: [
      { text: "Carlos Mendez checked on Oct 5 and found no smoke smell in the hallway.", classification: "staff_observation", sourceIds: [id(draft, "FD-1005-08")] }, // true
      { text: "Carlos Mendez checked again on Oct 8 and found nothing.", classification: "staff_observation", sourceIds: [id(draft, "FD-1005-08")] }, // wrong date
      { text: "There have been 14 reports about 12B.", classification: "allegation", sourceIds: [id(draft, "FD-1005-07")] }, // wrong count
      { text: "Angela Brooks inspected the 12th floor hallway.", classification: "staff_observation", sourceIds: [id(draft, "FD-1005-08")] }, // wrong person
      { text: 'The log says "strong smell of smoke coming from under the door of 12B".', classification: "staff_observation", sourceIds: [id(draft, "FD-1005-08")] }, // invented quote
      { text: "Staff have confirmed smoking inside unit 12B.", classification: "staff_observation", sourceIds: [id(draft, "FD-1102-07")] }, // overclaim
      { text: "Smoking in 12B is established by the reports.", classification: "note", sourceIds: [] }, // overclaim, uncited
      { text: "A lease violation notice was issued.", classification: "documented_action", sourceIds: [foreign.id] }, // another tenant's record
      { text: "The resident reported smoke.", classification: "allegation", sourceIds: [] }, // allegation without a source
      { text: "It came from 12B.", classification: "allegation", sourceIds: ["unknown:S99"] }, // unknown label
    ] }));
    const { answer } = await ask(priya, { question: Q }, { now: NOW });
    // More than half failed, so the whole narrative is discarded in favour of the exact composer.
    expect(answer.mode).toBe("deterministic");
    expect(answer.modeNote).toMatch(/could not be verified.*discarded/);
    expect(answer.withheld).toHaveLength(0);
    expect(answer.headline).toContain("10 reports");
  });

  it("withholds individual bad statements when most of the narrative is sound", async () => {
    setNarratorForTests(async (_ctx, _q, draft) => ({ ...base, headline: "Summary", claims: [
      { text: "Carlos Mendez checked on Oct 5 and found no smoke smell in the hallway.", classification: "staff_observation", sourceIds: [id(draft, "FD-1005-08")] },
      { text: "Frank Russo checked on Oct 19 and could not detect smoke in the bathroom of 12C.", classification: "staff_observation", sourceIds: [id(draft, "FD-1019-12")] },
      { text: "Priya Raman replied by email on Oct 6.", classification: "documented_action", sourceIds: [id(draft, "<smoke-02@mail.riversidehouse.example>")] },
      { text: "Staff have confirmed smoking inside unit 12B.", classification: "staff_observation", sourceIds: [id(draft, "FD-1102-07")] },
    ] }));
    const { answer } = await ask(priya, { question: Q }, { now: NOW });
    expect(answer.mode).toBe("model");
    expect(answer.claims).toHaveLength(3);
    expect(answer.withheld).toHaveLength(1);
    expect(answer.withheld[0].issue).toMatch(/Asserts confirmation/);
    expect(answer.speakable).toBe("spoken");
  });

  it("falls back to the deterministic composer when the model returns nothing or throws", async () => {
    setNarratorForTests(async () => null);
    expect((await ask(priya, { question: Q }, { now: NOW })).answer).toMatchObject({ mode: "deterministic", modeNote: expect.stringMatching(/did not return a usable answer/) });
    setNarratorForTests(async () => { throw new Error("network down"); });
    const { answer } = await ask(priya, { question: Q }, { now: NOW });
    expect(answer).toMatchObject({ mode: "deterministic", modeNote: expect.stringMatching(/could not be reached/) });
    expect(answer.claims.length).toBeGreaterThan(8);
  });
});
