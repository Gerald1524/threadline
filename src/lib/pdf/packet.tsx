/**
 * Case packet PDF. Built only from verified claims and structured evidence — never from
 * unverified model prose. Every statement carries source labels that resolve in the source
 * index at the end, where each record's identifier and content hash are listed.
 */
import { Document, Page, StyleSheet, Text, View, renderToBuffer } from "@react-pdf/renderer";
import { OUTCOME_LABEL } from "../ingest/lexicon";
import { fmtDate, fmtDateTime } from "../util/time";
import { CLASS_LABEL, type AnswerClaim, type Fact, type Gap, type SourceRef, type TimelineItem } from "../engine/types";

export type PacketData = {
  property: string; caseNumber: string; title: string; status: string; category: string; units: string[]; dateRange: [string, string] | null;
  headline: string; facts: Fact[]; claims: AnswerClaim[]; timeline: TimelineItem[]; gaps: Gap[]; conflicts: Gap[]; tentative: TimelineItem[];
  workOrders: { number: string; title: string; status: string; assignee: string | null; completedAt: string | null; note: string | null }[];
  policy: { title: string; version: number; effectiveFrom: string | null } | null;
  sources: SourceRef[]; attachments: { filename: string; mediaType: string; source: string }[];
  generatedAt: string; generatedBy: string; reviewNote: string; legalHold: boolean; tz: string; restrictedNote: string | null;
};

const s = StyleSheet.create({
  page: { paddingTop: 44, paddingBottom: 52, paddingHorizontal: 44, fontSize: 9, fontFamily: "Helvetica", color: "#1c1917", lineHeight: 1.4 },
  h1: { fontSize: 17, fontFamily: "Helvetica-Bold", marginBottom: 2 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 14, marginBottom: 5, paddingBottom: 3, borderBottomWidth: 0.7, borderBottomColor: "#a8a29e" },
  meta: { fontSize: 8.5, color: "#57534e" },
  box: { borderWidth: 0.7, borderColor: "#d6d3d1", padding: 7, marginTop: 8, backgroundColor: "#fafaf9" },
  row: { flexDirection: "row", borderBottomWidth: 0.4, borderBottomColor: "#e7e5e4", paddingVertical: 3 },
  th: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#44403c" },
  bold: { fontFamily: "Helvetica-Bold" },
  tag: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#44403c" },
  footer: { position: "absolute", bottom: 22, left: 44, right: 44, fontSize: 7.5, color: "#78716c", flexDirection: "row", justifyContent: "space-between" },
});

const labels = (ids: string[], map: Map<string, string>) => {
  const ls = ids.map((i) => map.get(i)).filter(Boolean);
  return ls.length ? ` [${ls.join(", ")}]` : "";
};

function Packet({ d }: { d: PacketData }) {
  const L = new Map(d.sources.map((x) => [x.id, x.label]));
  const tz = d.tz;
  const by = (cls: string[]) => d.claims.filter((c) => cls.includes(c.classification));
  const staff = new Map<string, { title: string; employment: string; steps: string[] }>();
  for (const i of d.timeline.filter((x) => x.linkStatus === "confirmed" && x.status === "active")) {
    const note = (p: TimelineItem["recordedBy"], what: string) => {
      if (!p) return;
      const e = staff.get(p.name) ?? { title: p.title, employment: p.employment, steps: [] };
      e.steps.push(`${what} ${fmtDate(i.occurredAt, tz).replace(/, \d{4}$/, "")}${L.get(i.sourceId) ? ` [${L.get(i.sourceId)}]` : ""}`);
      staff.set(p.name, e);
    };
    if (i.type === "investigation") note(i.investigatedBy, "checked");
    else if (i.direction === "outbound") note(i.respondedBy, "wrote");
    else if (i.recordedBy) note(i.recordedBy, i.type === "work_order" ? "opened work order" : "recorded");
    if (i.type === "work_order" && i.assignee) note(i.assignee, "assigned work order");
  }
  const mail = d.timeline.filter((i) => i.channel === "email" && i.linkStatus === "confirmed");
  return (
    <Document title={`Case packet ${d.caseNumber}`} author="Threadline" subject={d.title}>
      <Page size="LETTER" style={s.page} wrap>
        <Text style={s.meta}>{d.property} · Case packet for management / legal review</Text>
        <Text style={s.h1}>{d.caseNumber} — {d.title}</Text>
        <Text style={s.meta}>
          Status: {d.status.replace("_", " ")} · Units: {d.units.join(", ") || "—"} · Records dated {d.dateRange ? `${fmtDate(d.dateRange[0], tz)} to ${fmtDate(d.dateRange[1], tz)}` : "—"}
        </Text>
        <Text style={s.meta}>Generated {fmtDateTime(d.generatedAt, tz)} by {d.generatedBy} · {d.sources.length} source records{d.legalHold ? " · LEGAL HOLD IN PLACE" : ""}</Text>
        <View style={s.box}>
          <Text style={s.bold}>What this document is</Text>
          <Text>A factual compilation of the building's own records about this matter, with each statement tied to its source. It distinguishes what was reported from what staff observed. It is not a finding of fact, a legal conclusion, or a recommendation, and it should be read together with the original records listed in the source index.</Text>
          {d.reviewNote ? <Text style={{ marginTop: 4 }}><Text style={s.bold}>Reviewer note ({d.generatedBy}): </Text>{d.reviewNote}</Text> : null}
        </View>

        <Text style={s.h2}>1. Summary</Text>
        <Text>{d.headline}</Text>
        <View style={{ marginTop: 6 }}>
          {d.facts.map((f) => (
            <View key={f.key} style={s.row} wrap={false}>
              <Text style={{ width: "42%", color: "#44403c" }}>{f.label}</Text>
              <Text style={{ width: "58%" }}>{f.value}{labels(f.sourceIds.slice(0, 12), L)}</Text>
            </View>
          ))}
        </View>

        <Text style={s.h2}>2. Reported versus observed</Text>
        {([["Reported by residents or other parties (allegations and statements — not findings)", ["allegation", "statement"]], ["Observed by staff", ["staff_observation"]], ["Documented actions by staff and management", ["documented_action"]], ["Supported by records from two different authors", ["independently_supported"]], ["Not shown by the records", ["missing_evidence"]]] as const).map(([title, cls]) =>
          by([...cls]).length ? (
            <View key={title} style={{ marginBottom: 6 }}>
              <Text style={s.tag}>{title.toUpperCase()}</Text>
              {by([...cls]).map((c) => <Text key={c.id} style={{ marginTop: 2 }}>• {c.text}{labels(c.sourceIds, L)}</Text>)}
            </View>
          ) : null,
        )}

        <Text style={s.h2}>3. Chronology</Text>
        <View style={s.row} fixed>
          <Text style={[s.th, { width: "17%" }]}>When</Text>
          <Text style={[s.th, { width: "23%" }]}>Record / who handled it</Text>
          <Text style={[s.th, { width: "53%" }]}>What the record says</Text>
          <Text style={[s.th, { width: "7%" }]}>Source</Text>
        </View>
        {d.timeline.filter((i) => i.linkStatus === "confirmed").map((i) => (
          <View key={i.eventId} style={s.row} wrap={false}>
            <View style={{ width: "17%" }}>
              <Text>{fmtDate(i.occurredAt, tz).replace(/, \d{4}$/, "")}</Text>
              <Text style={s.meta}>{new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(i.occurredAt))}</Text>
              {i.lateEntry && i.recordedAt ? <Text style={s.meta}>written {fmtDate(i.recordedAt, tz).replace(/, \d{4}$/, "")}</Text> : null}
            </View>
            <View style={{ width: "23%", paddingRight: 4 }}>
              <Text style={s.bold}>{i.typeLabel}{i.status === "duplicate" ? " (duplicate entry, not counted)" : ""}</Text>
              {i.reporter ? <Text style={s.meta}>From: {i.reporter}{i.reporterUnit ? ` (${i.reporterUnit})` : ""}</Text> : null}
              {i.recordedBy ? <Text style={s.meta}>Recorded by: {i.recordedBy.name}{i.recordedBy.employment === "temp" ? " (temp)" : ""}</Text> : null}
              {i.onDuty ? <Text style={s.meta}>On desk: {i.onDuty.name}, {i.onDuty.shift} shift{i.onDuty.coverage === "temp_cover" ? " (temp cover)" : ""}</Text> : null}
              {i.investigatedBy ? <Text style={s.meta}>Checked by: {i.investigatedBy.name}</Text> : null}
              {i.respondedBy ? <Text style={s.meta}>Sent by: {i.respondedBy.name}</Text> : null}
            </View>
            <View style={{ width: "53%", paddingRight: 4 }}>
              {i.claims.slice(0, 7).map((c, k) => (
                <Text key={k}><Text style={s.tag}>{CLASS_LABEL[c.classification].toUpperCase()}{c.outcome ? ` · ${(OUTCOME_LABEL[c.outcome] ?? c.outcome).toUpperCase()}` : ""}: </Text>{c.text}</Text>
              ))}
              {i.attachments.length ? <Text style={s.meta}>Attachment (not authenticated): {i.attachments.map((a) => a.filename).join(", ")}</Text> : null}
            </View>
            <Text style={{ width: "7%" }}>{L.get(i.sourceId)}</Text>
          </View>
        ))}

        <Text style={s.h2}>4. Staff who handled this matter</Text>
        <Text style={s.meta}>Listed to show who received, recorded, checked and replied at each step. This is a chain-of-custody record for this case, not an assessment of any employee.</Text>
        {[...staff].map(([name, e]) => <Text key={name} style={{ marginTop: 3 }}><Text style={s.bold}>{name}</Text> — {e.title}{e.employment !== "permanent" ? ` (${e.employment})` : ""}: {e.steps.join("; ")}</Text>)}

        <Text style={s.h2}>5. Correspondence</Text>
        {mail.length ? mail.map((m) => <Text key={m.eventId} style={{ marginTop: 2 }}>{fmtDateTime(m.occurredAt, tz)} — {m.direction === "outbound" ? `sent by ${m.respondedBy?.name ?? "management"}` : `received from ${m.reporter ?? "resident"}`}: "{m.summary}" [{L.get(m.sourceId)}]</Text>) : <Text>No email is linked to this case.</Text>}

        <Text style={s.h2}>6. Related work orders and policy</Text>
        {d.workOrders.length ? d.workOrders.map((w) => <Text key={w.number} style={{ marginTop: 2 }}><Text style={s.bold}>{w.number}</Text> {w.title} — {w.status.replace("_", " ")}{w.assignee ? `, ${w.assignee}` : ""}{w.completedAt ? `, completed ${fmtDate(w.completedAt, tz)}` : ""}.{w.note ? ` Recorded result: "${w.note}"` : ""}</Text>) : <Text>No work order is linked to this case.</Text>}
        <Text style={{ marginTop: 4 }}>{d.policy ? `Governing policy: ${d.policy.title}, version ${d.policy.version} (approved${d.policy.effectiveFrom ? `, effective ${d.policy.effectiveFrom}` : ""}).` : "No approved policy is on file for this category."}</Text>

        <Text style={s.h2}>7. Conflicting records</Text>
        {d.conflicts.length ? d.conflicts.map((g, i) => <Text key={i} style={{ marginTop: 2 }}>• {g.text}{labels(g.sourceIds, L)}</Text>) : <Text>None identified.</Text>}

        <Text style={s.h2}>8. Known limitations</Text>
        {d.gaps.map((g, i) => <Text key={i} style={{ marginTop: 2 }}>• {g.text}{labels(g.sourceIds, L)}</Text>)}
        {d.tentative.map((i) => <Text key={i.eventId} style={{ marginTop: 2 }}>• Possibly related but unconfirmed, and not counted above: {i.typeLabel.toLowerCase()} of {fmtDate(i.occurredAt, tz)} [{L.get(i.sourceId)}]. {i.linkRationale}</Text>)}
        {d.restrictedNote ? <Text style={{ marginTop: 2 }}>• {d.restrictedNote}</Text> : null}
        <Text style={{ marginTop: 2 }}>• The absence of a record is not evidence that an event did not occur. Counts reflect only records imported into Threadline as of the generation time above.</Text>

        <Text style={s.h2} break>9. Source index</Text>
        <Text style={s.meta}>Each source is a preserved original. The SHA-256 prefix identifies the exact content this packet was generated from; the full record can be opened in Threadline by its identifier.</Text>
        <View style={[s.row, { marginTop: 4 }]} fixed>
          <Text style={[s.th, { width: "6%" }]}>#</Text>
          <Text style={[s.th, { width: "15%" }]}>Date</Text>
          <Text style={[s.th, { width: "45%" }]}>Record</Text>
          <Text style={[s.th, { width: "19%" }]}>Author</Text>
          <Text style={[s.th, { width: "15%" }]}>SHA-256</Text>
        </View>
        {d.sources.map((x) => (
          <View key={x.id} style={s.row} wrap={false}>
            <Text style={{ width: "6%" }}>{x.label}</Text>
            <Text style={{ width: "15%" }}>{x.occurredAt ? fmtDate(x.occurredAt, tz) : "—"}</Text>
            <View style={{ width: "45%", paddingRight: 4 }}>
              <Text>{x.title}</Text>
              <Text style={s.meta}>{x.sourceName} · {x.externalId.replace(/[<>]/g, "")}{x.version > 1 ? ` · version ${x.version}` : ""}{x.flagged ? " · flagged: instruction-like text" : ""}</Text>
            </View>
            <Text style={{ width: "19%" }}>{x.author ?? "—"}</Text>
            <Text style={{ width: "15%", fontFamily: "Courier", fontSize: 7.5 }}>{x.contentHash.slice(0, 16)}</Text>
          </View>
        ))}
        {d.attachments.length ? (
          <View style={{ marginTop: 8 }}>
            <Text style={s.tag}>ATTACHMENTS REFERENCED (SUPPLIED BY RESIDENTS; NOT AUTHENTICATED)</Text>
            {d.attachments.map((a, i) => <Text key={i}>{a.filename} ({a.mediaType}) — attached to {a.source}</Text>)}
          </View>
        ) : null}
        <View style={s.footer} fixed>
          <Text>{d.caseNumber} · {d.property} · Confidential — prepared for management / legal review</Text>
          <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}

export async function renderPacket(d: PacketData): Promise<Uint8Array> {
  return new Uint8Array(await renderToBuffer(<Packet d={d} />));
}
