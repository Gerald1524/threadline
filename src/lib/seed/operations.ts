/**
 * Historic human decisions, applied through the same services the UI calls so that the
 * seeded state has a real audit trail (who decided what, when).
 */
import { and, eq } from "drizzle-orm";
import { getDb } from "../db/client";
import * as t from "../db/schema";
import { decideApproval, requestApproval } from "../services/approvals";
import { setCaseStatus, type CaseStatus } from "../services/cases";
import { acknowledgeHandoff, publishHandoff } from "../services/handoffs";
import { placeLegalHold } from "../services/privacy";
import { resolveReview } from "../services/review";
import { zonedToUtc } from "../util/time";
import { TZ, unitId } from "./reference";
import { ctxFor } from "./seed";

const at = (local: string) => zonedToUtc(local.slice(0, 10), local.slice(11), TZ);
const P = "prop_riverside";

export async function seedOperations() {
  const db = await getDb("system");
  const caseFor = async (category: string, unit: string, year = "2026") => {
    const rows = await db.select().from(t.cases).where(and(eq(t.cases.propertyId, P), eq(t.cases.category, category), eq(t.cases.unitId, unitId(P, unit))));
    return rows.find((c) => c.openedAt.toISOString().startsWith(year))!;
  };
  const reviewFor = async (type: string, externalId: string) => {
    const [r] = await db.select({ r: t.reviewItems }).from(t.reviewItems).innerJoin(t.sourceRecords, eq(t.sourceRecords.id, t.reviewItems.sourceRecordId)).where(and(eq(t.reviewItems.type, type), eq(t.sourceRecords.externalId, externalId)));
    return r?.r;
  };
  const priya = ctxFor("u_priya"), marcus = ctxFor("u_marcus"), michael = ctxFor("u_michael"), angela = ctxFor("u_angela"), sam = ctxFor("u_sam"), jordan = ctxFor("u_jordan"), dmitri = ctxFor("u_dmitri");

  // --- review decisions already made by the manager
  const dup = await reviewFor("duplicate_candidate", "TC-0044");
  if (dup) await resolveReview(priya, { id: dup.id, decision: "confirm", note: "Same call logged in both the shared sheet and the temp workbook.", at: at("2026-10-28 09:15") });
  const pkg = await reviewFor("tentative_link", "FD-1015-02");
  if (pkg) await resolveReview(priya, { id: pkg.id, decision: "confirm", at: at("2026-10-15 11:00") });

  // --- case statuses
  const status = async (category: string, unit: string, steps: [CaseStatus, string, string?][], year?: string) => {
    const c = await caseFor(category, unit, year);
    for (const [s, when, note] of steps) await setCaseStatus(priya, { caseId: c.id, status: s, note, at: at(when) });
    return c;
  };
  const smoke = await status("smoke_odor", "12B", [["investigating", "2026-10-06 14:35", "Front desk to check the 12th floor whenever a report comes in."]]);
  await status("smoke_odor", "12B", [["resolved", "2026-02-02 10:00", "Occupant moved out Jan 31, 2026."], ["closed", "2026-02-02 10:01"]], "2025");
  await status("leak", "4A", [["resolved", "2026-10-21 09:30", "Ceiling repaired; resident confirmed."]]);
  await status("package", "10F", [["resolved", "2026-10-15 10:10", "Package found mis-shelved and collected."]]);
  await status("hvac_water", "14A", [["resolved", "2026-11-03 09:40", "Mixing valve reset; plumber to evaluate."]]);
  await status("building_systems", "2B", [["resolved", "2026-10-14 11:30", "Handset replaced."]]);
  await status("noise", "6E", [["investigating", "2026-10-19 09:00"]]);
  await status("pest", "8C", [["investigating", "2026-10-26 13:15", "Exterminator visit scheduled; follow-up in two weeks."]]);
  await status("move", "15A", [["resolved", "2026-11-02 09:00", "Move-in completed Nov 1."]]);
  await status("contractor", "13E", [["resolved", "2026-10-23 09:00", "Work completed Oct 22."]]);
  const key = await status("key_access", "7D", [["awaiting_response", "2026-11-13 09:20", "Approved; waiting on maintenance to cut the key."]]);

  // --- approvals (requested by front desk, decided by the community manager)
  const approve = async (who: typeof michael, spec: { type: string; title: string; detail: string; unit: string; resident?: string; caseId?: string; neededBy?: Date; key: string; requested: string; decision?: ["approved" | "denied", string, string]; assignee?: string }) => {
    const { approval } = await requestApproval(who, { type: spec.type, title: spec.title, detail: spec.detail, unitId: unitId(P, spec.unit), residentId: spec.resident, caseId: spec.caseId, neededBy: spec.neededBy, idempotencyKey: `seed:${spec.key}`, at: at(spec.requested) });
    if (spec.decision) await decideApproval(priya, { id: approval.id, decision: spec.decision[0], note: spec.decision[2], assigneeUserId: spec.assignee, at: at(spec.decision[1]) });
    return approval;
  };
  await approve(michael, { type: "key_replacement", title: "Replacement apartment key — 7D (Thomas Carter)", detail: "Resident reports his apartment key was lost at work. Needs a replacement before Tuesday morning, Nov 17; he is travelling for work.", unit: "7D", resident: "res_carter", caseId: key.id, neededBy: at("2026-11-17 06:00"), key: "key-carter", requested: "2026-11-12 17:28", decision: ["approved", "2026-11-13 09:10", "ID verified against the lease file. Approve one replacement key, standard $25 fee."], assignee: "u_luis" });
  await approve(angela, { type: "move_exception", title: "Sunday move-in — 15A (Nov 1, 9am–1pm)", detail: "New resident requests a Sunday move-in with a service elevator reservation.", unit: "15A", resident: "res_tanaka", caseId: (await caseFor("move", "15A")).id, key: "move-15a", requested: "2026-10-20 15:00", decision: ["approved", "2026-10-20 16:15", "Approved provided the movers' certificate of insurance arrives by Oct 28."] });
  await approve(angela, { type: "contractor_access", title: "Contractor access — 13E backsplash (Oct 21–22)", detail: "Hudson Tile, two days, weekday hours.", unit: "13E", resident: "res_patel", caseId: (await caseFor("contractor", "13E")).id, key: "contractor-13e", requested: "2026-10-12 13:00", decision: ["approved", "2026-10-12 14:40", "Approved once the certificate of insurance is received."] });
  await approve(angela, { type: "amenity_booking", title: "Party room — 9F, Nov 7, about 20 guests", detail: "Booking exceeds 15 guests and needs manager sign-off.", unit: "9F", resident: "res_baptiste", caseId: (await caseFor("amenity", "9F")).id, key: "amenity-9f", requested: "2026-10-27 15:35", decision: ["approved", "2026-10-28 10:00", "Approved. Standard cleaning deposit applies."] });
  await approve(angela, { type: "bike_storage", title: "Bike room fob — 6B (Hannah Weiss)", detail: "Signed bike storage form received by email Nov 5.", unit: "6B", resident: "res_weiss", caseId: (await caseFor("bike", "6B")).id, key: "bike-6b", requested: "2026-11-05 09:30" });
  await approve(michael, { type: "policy_exception", title: "After-hours furniture delivery — 3D", detail: "Resident asks for a 9pm delivery on a Saturday.", unit: "3D", resident: "res_murphy", key: "delivery-3d", requested: "2026-10-08 18:20", decision: ["denied", "2026-10-09 09:05", "Deliveries are limited to 9am–5pm Monday to Saturday under the move-in policy. Offered Saturday 10am instead."] });
  await approve(angela, { type: "other", title: "Pet registration — 5A (dog license renewal)", detail: "Renewed license received for the pet file.", unit: "5A", resident: "res_marino", key: "pet-5a", requested: "2026-10-30 17:50", decision: ["approved", "2026-11-02 09:15", "License on file through 2027."] });
  await approve(michael, { type: "policy_exception", title: "Hold perishable package 48 hours — 7A", detail: "Resident travelling; asks for a refrigerated package to be held two days.", unit: "7A", resident: "res_okafor", key: "package-7a", requested: "2026-10-16 17:10", decision: ["approved", "2026-10-16 17:45", "One-time exception, fridge space permitting."] });
  await approve(angela, { type: "policy_exception", title: "Satellite dish on balcony railing — 14D", detail: "Resident asks to clamp a dish to the balcony railing.", unit: "14D", resident: "res_chen", key: "dish-14d", requested: "2026-10-22 11:00", decision: ["denied", "2026-10-23 10:30", "Exterior attachments are not permitted under the alteration policy."] });
  await approve(angela, { type: "policy_exception", title: "Balcony planters — 10C", detail: "Two freestanding planters, no railing attachment.", unit: "10C", resident: "res_dubois", key: "planter-10c", requested: "2026-10-05 10:15", decision: ["approved", "2026-10-05 15:00", "Freestanding planters with saucers are fine."] });
  await approve(michael, { type: "policy_exception", title: "Lockout fee waiver — 2F", detail: "Third lockout this year; resident asks for the fee to be waived.", unit: "2F", resident: "res_greene", key: "lockout-2f", requested: "2026-11-04 19:30", decision: ["approved", "2026-11-05 09:00", "Waived once given the faulty latch found by maintenance."] });
  await approve(angela, { type: "contractor_access", title: "Flooring refinishing — 8F (Nov 23–25)", detail: "Resident's contractor; certificate of insurance not yet received.", unit: "8F", resident: "res_brooks", key: "flooring-8f", requested: "2026-11-13 11:20" });
  await approve(sam, { type: "policy_exception", title: "Key release to dog walker — 4C", detail: "Resident asks the desk to release her key to a dog walker daily; no written authorization on file yet.", unit: "4C", resident: "res_nwosu", key: "keyrelease-4c", requested: "2026-11-14 10:40" });

  // --- legal hold on the smoke case after the resident mentioned an attorney
  await placeLegalHold(marcus, { caseId: smoke.id, reason: "Resident stated on Nov 5 that she has consulted an attorney. Preserve all records for this case.", at: at("2026-11-06 10:00") });

  // --- shift handoffs
  const mirror = await caseFor("installation_tools", "9A");
  const h1 = await publishHandoff(sam, { shiftLabel: "Day → Evening (Sun Nov 15)", note: "Quiet day otherwise.", at: at("2026-11-15 14:55"), items: [
    { kind: "case", refId: key.id, text: `${key.number} Carter 7D replacement key: approved Friday, work order with Luis, no ETA. He asked again today and leaves Tuesday 6am.` },
    { kind: "case", refId: mirror.id, text: `${mirror.number} Feldman 9A asked about hanging a 60 lb mirror and borrowing a drill. I said I'd check the policy — not answered yet.` },
    { kind: "note", text: "Party room keys returned by 9F, room checked." },
  ] });
  await acknowledgeHandoff(jordan, h1.id, at("2026-11-15 15:04"));
  await publishHandoff(dmitri, { shiftLabel: "Overnight → Day (Mon Nov 16)", note: "", at: at("2026-11-16 06:50"), items: [
    { kind: "case", refId: key.id, text: `${key.number} Carter 7D key still open with maintenance, no ETA on the work order. Resident leaves tomorrow 6am.` },
    { kind: "case", refId: smoke.id, text: `${smoke.number} 12C smoke reports: nothing overnight. Last call was Thursday 11:30pm, walked the floor, nothing noted.` },
    { kind: "note", text: "Lobby door closer is fine since the adjustment." },
  ] });
}
