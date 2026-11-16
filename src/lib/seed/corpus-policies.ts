/** Synthetic policy binder for Riverside House. Front matter drives version and approval status. */

export type PolicyDoc = { file: string; key: string; title: string; category: string; version: number; status: "approved" | "superseded" | "draft"; effective: string; approvedBy: string; body: string; asPdf?: boolean };

const p = (key: string, title: string, category: string, version: number, status: PolicyDoc["status"], effective: string, body: string, extra: Partial<PolicyDoc> = {}): PolicyDoc => ({
  file: `${key}-v${version}.md`, key, title, category, version, status, effective, approvedBy: status === "draft" ? "" : "Priya Raman, Community Manager", body, ...extra,
});

export const POLICIES: PolicyDoc[] = [
  p("smoke-free", "Smoke-Free Building Policy", "smoke_odor", 3, "approved", "2025-01-01",
    `1. Smoking of tobacco, cannabis or any other substance, including electronic cigarettes, is prohibited in all apartments, on balconies and terraces, and in all common areas of Riverside House.
2. Residents are responsible for the conduct of their guests.
3. Complaints are documented by the front desk. Staff will check the reported location as soon as practical and record what they personally observe.
4. A complaint alone is not a finding of a violation. Management will not issue a violation notice unless a violation is substantiated by staff observation or other reliable evidence reviewed by the Community Manager.
5. Management may send a courtesy notice, inspect building ventilation, and take other reasonable steps while a complaint is being investigated.
6. Repeated substantiated violations are referred to the owner for action under the lease. Any such referral is decided by management, with counsel as appropriate.`,
    { asPdf: true, file: "smoke-free-policy-v3.pdf" }),
  p("noise-quiet-hours", "Noise and Quiet Hours Policy", "noise", 2, "approved", "2024-03-01",
    `1. Quiet hours are 10:00 pm to 8:00 am daily.
2. Construction and alteration noise is permitted weekdays 9:00 am to 5:00 pm only.
3. When a noise complaint is received, front desk staff log it and, when a porter or superintendent is available, a staff member listens from the hallway outside the reported apartment and records what they hear.
4. Recordings supplied by residents are kept with the complaint but are not treated as verified evidence of the source of the noise.
5. Repeated substantiated complaints are reviewed by the Community Manager.`),
  p("key-replacement", "Keys, Lockouts and Replacement Key Policy", "key_access", 4, "approved", "2025-09-15",
    `1. Lockouts: front desk staff may admit a resident of record after checking photo ID. Each lockout is logged.
2. Replacement apartment keys require written approval from the Community Manager before a key is cut. The front desk records the request and submits it for approval.
3. After approval, maintenance cuts the key under a work order. The standard fee is $25 per key.
4. Keys are released only to a resident of record with photo ID. Staff may not release keys to guests, contractors or delivery services without written resident authorization on file.
5. Lost fobs are deactivated at the time the loss is reported.`),
  p("tool-lending-installation", "Tool Lending and In-Unit Installation Policy", "installation_tools", 1, "superseded", "2023-02-01",
    `1. The front desk may lend residents basic tools, including the cordless drill, for up to 48 hours.
2. Maintenance will hang pictures, mirrors and shelves up to 50 lbs at no charge when time permits.`),
  p("tool-lending-installation", "Tool Lending and In-Unit Installation Policy", "installation_tools", 2, "approved", "2026-06-01",
    `1. Hand tools: the front desk may lend non-powered hand tools (hammer, screwdriver set, level, tape measure, stud finder) for up to 24 hours against photo ID. Loans are logged.
2. Power tools, including drills, are not loaned to residents.
3. Installation by maintenance: maintenance may install wall-mounted items weighing up to 40 lbs under a work order. The fee is $45 per item.
4. Items over 40 lbs, and any item to be anchored into a masonry or plumbing wall, require review by the Community Manager before any work is scheduled. The Community Manager may require the resident to use a licensed and insured contractor instead.
5. Staff may not agree to an installation that requires review until the Community Manager's decision is recorded.`),
  p("package-handling", "Package Handling Policy", "package", 3, "approved", "2025-04-01",
    `1. Packages are logged on receipt and shelved by apartment number.
2. Residents are notified the same day.
3. A package reported missing is searched for across all shelves and the oversized area before a carrier claim is suggested.
4. Perishables are refrigerated when space allows and released within 24 hours.`),
  p("move-in-out", "Move-In, Move-Out and Service Elevator Policy", "move", 2, "approved", "2024-09-01",
    `1. Moves are scheduled Monday to Saturday, 9:00 am to 5:00 pm, with a service elevator reservation.
2. Sunday and holiday moves require an exception approved by the Community Manager.
3. Movers must provide a certificate of insurance at least three business days in advance.`),
  p("visitor-access", "Visitor and Guest Access Policy", "visitor", 2, "approved", "2024-01-15",
    `1. Guests are announced to the resident before being admitted unless they are on the resident's permanent guest list.
2. Staff do not confirm to callers or visitors whether a named person lives in the building.`),
  p("contractor-access", "Contractor and Alteration Policy", "contractor", 2, "approved", "2025-02-01",
    `1. Contractors need a certificate of insurance naming Northbridge Residential and a signed alteration form.
2. Work hours are weekdays 9:00 am to 5:00 pm.
3. Access is approved by the Community Manager for specific dates.`),
  p("pets", "Pet Policy", "pets", 3, "approved", "2025-06-01",
    `1. Dogs and cats must be registered with management with a current license and vaccination record.
2. Persistent barking is treated under the Noise and Quiet Hours Policy.`),
  p("amenity-booking", "Amenity Room Booking Policy", "amenity", 1, "approved", "2024-05-01",
    `1. The party room may be booked by residents for up to four hours.
2. Bookings for more than 15 guests require approval from the Community Manager.`),
  p("bike-storage", "Bike Storage Policy", "bike", 1, "approved", "2024-04-01",
    `1. Bike room access requires a signed bike storage form and approval by the Community Manager.
2. One fob per registered bicycle.`),
  p("after-hours-maintenance", "After-Hours and Emergency Maintenance Policy", "maintenance", 2, "approved", "2025-10-01",
    `1. Emergencies (active leaks, no heat, no hot water, lockouts with safety concerns) are escalated to the superintendent on call at any hour.
2. Non-emergency requests received after 5:00 pm are logged and assigned the next business day.`),
  p("incident-documentation", "Front Desk Incident Documentation Procedure", "general", 2, "approved", "2026-01-10",
    `1. Log every complaint, request and inspection at the time it happens. If an entry is written later, begin it with "Late entry" and give the time of the event.
2. Record who reported the matter, who took the report, who checked, and exactly what the person checking saw, heard or smelled.
3. Keep what a resident says separate from what staff personally observed.
4. Do not record opinions about who is at fault.`),
];

/** A Google Docs export of working notes. Not an approved policy and must not be cited as one. */
export const DRAFT_DOC = {
  file: "front-desk-interview-notes-DRAFT.txt",
  title: "Front desk interview notes - tool lending (DRAFT)",
  body: `DRAFT - NOT APPROVED - working notes from front desk interviews, March 2026
Author: Priya Raman

Tool lending, what staff say they do today:
- Angela: we usually just lend the drill if someone asks, they bring it back same day.
- Michael: maintenance has hung heavy mirrors as a favor before, no charge.
- Idea: maybe allow drills with a deposit?

To do: reconcile with the written policy before the June update.`,
};
