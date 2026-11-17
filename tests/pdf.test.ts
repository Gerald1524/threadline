import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { extractText } from "unpdf";
import { getDb } from "@/lib/db/client";
import * as t from "@/lib/db/schema";
import { generatePacket, getReportPdf, preparePacket } from "@/lib/services/reports";
import { sha256 } from "@/lib/util/core";
import { NOW, as, useSeededDb } from "./helpers/db";

describe("case packet PDF", () => {
  useSeededDb();
  const priya = as("u_priya");
  const smoke = async () => (await (await getDb("system")).select().from(t.cases).where(and(eq(t.cases.propertyId, "prop_riverside"), eq(t.cases.number, "C-1001"))))[0];

  it("requires the reviewer's confirmation", async () => {
    await expect(generatePacket(priya, { caseId: (await smoke()).id, reviewed: false })).rejects.toThrow(/Confirm that you have reviewed/);
  });

  it("renders a real PDF whose text carries the facts, the citations and a complete source index", async () => {
    const c = await smoke();
    const data = (await preparePacket(priya, c.id, NOW))!;
    const { report, bytes } = await generatePacket(priya, { caseId: c.id, reviewed: true, reviewNote: "Reviewed sources S1 to S23 on Nov 16.", now: NOW });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect(report.pdfSha256).toBe(sha256(bytes));
    const { text, totalPages } = await extractText(new Uint8Array(bytes), { mergePages: true });
    const flat = (text as string).replace(/\s+/g, " ");
    expect(totalPages).toBeGreaterThanOrEqual(3);
    for (const s of [
      "C-1001", "Riverside House", "Case packet for management / legal review", "It is not a finding of fact, a legal conclusion",
      "10 (6 to the front desk, 4 by email)", "None recorded", "Oct 5, 2026 at 3:45 PM",
      "Reviewer note (Priya Raman): Reviewed sources S1 to S23 on Nov 16.", "LEGAL HOLD IN PLACE",
      "1. Summary", "2. Reported versus observed", "3. Chronology", "4. Staff who handled this matter", "5. Correspondence", "6. Related work orders and policy", "7. Conflicting records", "8. Known limitations", "9. Source index",
      "Faint stale odor near the trash chute room", "Carlos Mendez", "Jordan Lee (temp)", "temp cover", "WO-2041", "Smoke-Free Building Policy, version 3",
      "Daniel Reyes of 12B denies it", "IMG_4412.jpg", "not authenticated", "Possibly related but unconfirmed", "The absence of a record is not evidence that an event did not occur",
      "not an assessment of any employee",
    ]) expect(flat, s).toContain(s);
    // Every source in the packet is indexed with its label and hash prefix, and every citation resolves.
    for (const src of data.sources) {
      expect(flat, src.label).toContain(src.contentHash.slice(0, 16));
    }
    const cited = new Set([...flat.matchAll(/\[(S\d+(?:, S\d+)*)\]/g)].flatMap((m) => m[1].split(", ")));
    const indexed = new Set(data.sources.map((s) => s.label));
    expect(cited.size).toBeGreaterThan(15);
    for (const label of cited) expect(indexed.has(label), label).toBe(true);
    // Untrusted instruction text never reaches the packet as a statement of fact.
    expect(flat).not.toMatch(/have confirmed smoking inside|lease termination/);
  });

  it("stores the packet privately with a hash and serves it only to permitted roles", async () => {
    const { report, bytes } = await generatePacket(priya, { caseId: (await smoke()).id, reviewed: true, now: NOW });
    const got = (await getReportPdf(as("u_dana"), report.id))!;
    expect(sha256(got.bytes)).toBe(sha256(bytes));
    await expect(getReportPdf(as("u_michael"), report.id)).rejects.toThrow(/Not permitted/);
    const snap = report.snapshot as { sourceIds: { contentHash: string }[] };
    expect(snap.sourceIds.length).toBe(report.sourceCount);
  });
});
