/** Typed, UI-friendly answer contract shared by the engine, the API, the UI and the PDF. */

export type Classification =
  | "allegation" // what a resident or outside party reported
  | "staff_observation" // what an employee personally saw, heard or smelled
  | "documented_action" // something staff or management recorded doing
  | "statement" // an assertion by another party (e.g. a denial) or by management
  | "independently_supported" // supported by records from at least two different authors
  | "tentative_link" // possibly related; not confirmed by a person
  | "missing_evidence" // something the records do not show
  | "note";

export const CLASS_LABEL: Record<Classification, string> = {
  allegation: "Reported (allegation)",
  staff_observation: "Staff observation",
  documented_action: "Documented action",
  statement: "Statement",
  independently_supported: "Independently supported",
  tentative_link: "Tentative link",
  missing_evidence: "Not in the records",
  note: "Note",
};

export type Person = { id: string; name: string; title: string; employment: string };

export type SourceRef = {
  id: string;
  label: string; // S1, S2 …
  kind: string;
  title: string;
  externalId: string;
  locator: string;
  sourceName: string;
  author: string | null;
  occurredAt: string | null;
  recordedAt: string | null;
  contentHash: string;
  version: number;
  flagged: boolean; // instruction-like content detected
  sensitivity: string;
};

export type TimelineClaim = { classification: Classification; outcome: string | null; outcomeLabel: string | null; text: string; observer: string | null };

export type TimelineItem = {
  eventId: string;
  sourceId: string;
  type: string;
  typeLabel: string;
  category: string;
  channel: string;
  direction: string;
  summary: string;
  occurredAt: string;
  recordedAt: string | null;
  lateEntry: boolean;
  linkStatus: "confirmed" | "suggested";
  linkRationale: string | null;
  status: string; // active | duplicate
  reporter: string | null;
  reporterUnit: string | null;
  unit: string | null;
  recordedBy: Person | null;
  onDuty: (Person & { shift: string; coverage: string }) | null;
  investigatedBy: Person | null;
  respondedBy: Person | null;
  assignee: Person | null;
  claims: TimelineClaim[];
  attachments: { blobId: string; filename: string; mediaType: string }[];
  outsideShift: boolean; // recorded or performed by someone not on a scheduled shift at that time
  correctionOf: string | null;
  workOrderId: string | null;
};

export type Fact = { key: string; label: string; value: string; n?: number; sourceIds: string[] };

export type AnswerClaim = {
  id: string;
  text: string;
  classification: Classification;
  sourceIds: string[];
  verification: "verified" | "unverified";
  issue?: string;
};

export type Gap = { kind: string; text: string; sourceIds: string[] };

export type SuggestedAction =
  | { kind: "generate_packet"; label: string; caseId: string }
  | { kind: "draft_message"; label: string; messageKind: "maintenance_update_request" | "resident_update"; caseId?: string; workOrderId?: string }
  | { kind: "request_approval"; label: string; approvalType: string; title: string; detail: string; caseId?: string; unitId?: string; policyVersionId?: string }
  | { kind: "link"; label: string; href: string };

export type CoverageNote = { sourceId: string; sourceName: string; status: string; lastSuccessAt: string | null; coverageThrough: string | null; issue: string | null };

export type Answer = {
  id: string;
  question: string;
  intent: string;
  mode: "deterministic" | "model";
  modeNote: string;
  headline: string;
  claims: AnswerClaim[];
  withheld: AnswerClaim[]; // statements that failed verification and are not presented as fact
  facts: Fact[];
  timeline: TimelineItem[];
  gaps: Gap[];
  conflicts: Gap[];
  openItems: Gap[];
  actions: SuggestedAction[];
  sources: SourceRef[];
  coverage: CoverageNote[];
  restrictedNote: string | null;
  focus: { caseId?: string; unitId?: string; dateIso?: string; workOrderId?: string; policyKey?: string };
  caseRef: { id: string; number: string; title: string; status: string } | null;
  openSourceId: string | null;
  suggestions: string[]; // follow-up questions the user can ask next
  speakable: string;
  verification: { checked: number; verified: number; withheld: number };
  latencyMs: number;
};

export const EVENT_TYPE_LABEL: Record<string, string> = {
  complaint_report: "Complaint received", investigation: "Staff check", response: "Reply sent", notice: "Notice sent", resident_statement: "Resident statement",
  request: "Request received", follow_up: "Resident follow-up", work_order: "Work order", work_order_update: "Work order update", note: "Log note",
  correspondence: "Correspondence", approval_request: "Approval requested", approval_decision: "Approval decision", status_change: "Status change",
  maintenance_update_request: "Update requested from maintenance", correction: "Correction", handoff: "Shift handoff",
};
