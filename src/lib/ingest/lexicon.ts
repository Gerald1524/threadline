/**
 * Deterministic baseline classifiers. These are transparent keyword/pattern rules: the
 * "rules baseline" that any optional model classifier must beat in evaluation before it is
 * adopted (docs/AI_PROVIDER_EVALUATION.md). Output is always a *suggested* classification.
 */

export const CATEGORY_LABEL: Record<string, string> = {
  smoke_odor: "Smoke / odor", noise: "Noise", leak: "Leak / water", pest: "Pest", hvac_water: "Heat / hot water",
  key_access: "Keys / access", installation_tools: "Installation / tools", package: "Package", move: "Move / service elevator",
  contractor: "Contractor / alteration", amenity: "Amenity booking", bike: "Bike storage", building_systems: "Building systems",
  elevator: "Elevator", life_safety: "Life safety equipment", pets: "Pets", visitor: "Visitor", maintenance: "Maintenance", general: "General",
};

/** Order matters: the first matching category wins. */
const CATEGORY_RULES: [string, RegExp][] = [
  ["life_safety", /\bsmoke (detector|alarm)s?\b|\bfire alarm\b|\balarm panel\b/i],
  ["bike", /\bbike\b|\bbicycle\b/i],
  ["amenity", /\bparty room\b|\bamenity room\b/i],
  ["move", /\bmove-?in\b|\bmove-?out\b|\bmoving in\b|\bmovers?\b|\bservice elevator\b/i],
  ["contractor", /\bcontractor\b|\balteration\b|\bcertificate of insurance\b|\bCOI\b/],
  ["smoke_odor", /\bcigarettes?\b|\bcigars?\b|\bsmok(e|ing|es)\b|\btobacco\b|\bmarijuana\b|\bsmoke-free\b/i],
  ["noise", /\bnoise\b|\bloud\b|\bmusic\b|\bthumping\b|\bbanging\b|\bbark(ing|ed|s)?\b|\bdrilling\b|\bquiet hours\b/i],
  ["leak", /\bleak(s|ing|ed)?\b|\bdripping\b|\bwater damage\b/i],
  ["pest", /\bmice\b|\bmouse\b|\broach(es)?\b|\bexterminator\b|\bdroppings\b|\bbed ?bugs\b|\bpests?\b/i],
  ["hvac_water", /\bhot water\b|\bno heat\b|\bboiler\b|\bradiator\b|\bmixing valve\b/i],
  ["elevator", /\belevator\b/i],
  ["key_access", /\breplacement keys?\b|\bkeys?\b|\bfob\b|\block(ed)? ?out\b/i],
  ["installation_tools", /\bmirror\b|\bdrill\b|\bborrow\b|\bhang (a|the|pictures)\b|\bwall-?mount/i],
  ["building_systems", /\bintercom\b|\bdoor closer\b|\bbuzzer\b/i],
  ["package", /\bpackages?\b|\bpkgs?\b|\bparcel\b|\bfedex\b|\bups\b/i],
  ["pets", /\bdog\b|\bcat\b|\bpet\b/i],
  ["visitor", /\bguest\b|\bvisitor\b|\bsigned in\b|\bhousekeeper\b/i],
  ["maintenance", /\bmaintenance\b|\bwork order\b|\bWO\b/],
];

export function categorize(text: string): string {
  for (const [cat, re] of CATEGORY_RULES) if (re.test(text)) return cat;
  return "general";
}

/** Categories where a resident report opens (or joins) a case. */
export const COMPLAINT_CATEGORIES = new Set(["smoke_odor", "noise", "leak", "pest", "hvac_water", "building_systems", "package"]);
export const REQUEST_CATEGORIES = new Set(["key_access", "installation_tools", "move", "contractor", "amenity", "bike"]);
export const isCaseCategory = (c: string) => COMPLAINT_CATEGORIES.has(c) || REQUEST_CATEGORIES.has(c);

// ---------------------------------------------------------------- sentence-level cues

export const CUES = {
  notInvestigated: /\b(nobody|no one) (went|checked)\b|\bdid(n'?t| not) go up\b|\bcan'?t leave\b|\bcould ?n'?t leave\b|\bcould not leave\b|\balone at (the )?desk\b|\bno porter\b/i,
  noContactAttempt: /\bdid not knock\b|\bdidn'?t knock\b/i,
  denial: /\b(does not|doesn'?t|do not|don'?t) smoke\b|\b(nobody|no one) (was |is )?smok(es|ing)\b|\bdenie[sd]\b/i,
  actionStart: /^(called|told|let|radioed|sent|asked (carlos|frank|luis|priya)|left|emailed|submitted|explained|posted|gave|rang|swept)\b/i,
  staffSubject: (firstNames: string[]) => new RegExp(`^(i|we|${firstNames.join("|")})\\b`, "i"),
  allegation: /\b(says?|said|reports?|reported|complain(s|ed|ing)|claims?|thinks?|believes?|alleges?|called (again )?(about|re|the desk)|phoned|came to the desk|stopped at the desk|asked (if|for|at)|needs?|wants?)\b|\b(mr|mrs|ms|miss)\.? [\w'-]+ (\(\w+\) )?(\w+ )?(called|phoned)\b/i,
  action: /\b(radioed|called (frank|carlos|luis|priya|apex)|notified|emailed|left (a )?note|submitted|opened|posted|will (ask|tell|pass|keep|follow|check)|told (him|her|them))\b/i,
  observation: /\b(went (up|to)|checked|did a walk|walk of|stood outside|inspected|no (smoke |cigarette )?(smell|odor)|nothing (noted|detected|was detected|at)|did not (hear|notice|detect|smell)|could not (detect|smell|hear|tell)|smelled nothing|faint|knocked|no answer|answered the door|was home|found|reset|shut the valve|not found)\b/i,
  investigative: /\b(went (up|to)|checked|did a walk|walk of|stood outside|inspected)\b/i,
  followUp: /\bany update\b|\bstill waiting\b|\bfollowing up\b|\bwhat is the status\b|\basked (at the desk )?about (his|her|the|their)\b/i,
  request: /\basked (if|for)\b|\bneeds? a\b|\bwould like\b|\bcould i\b|\bcan i\b|\bplease let me know when\b/i,
  lateEntry: /^\s*late entry\b/i,
};

const POSITIVE_SENSE = /\b(faint|strong|slight|stale|noticeable|definite)\b[^.]*\b(odor|smell|smoke)\b|\b(smelled|detected|noticed) (smoke|an? odor|cigarette|marijuana)\b/i;
const NEGATIVE_SENSE = /\bno (smoke |cigarette |smoke-like )?(smell|odor)\b|\bno odor\b|\bnothing (noted|detected|was detected|at)\b|\b(did not|could not|didn'?t|couldn'?t) (notice|detect|smell)\b|\bsmelled nothing\b/i;
const COMMON_AREA = /\b(trash|chute|stairwell|lobby|hallway|landing|laundry)\b/i;

/** Outcome code for a sentence, or undefined. Checked in priority order. */
export function outcomeOf(sentence: string): string | undefined {
  if (/\b(saw|observed|witnessed)\b[^.]*\bsmoking\b|\bsmoke (coming|visible) from (inside|under|the door of)\b/i.test(sentence)) return "smoking_observed";
  if (!NEGATIVE_SENSE.test(sentence) && POSITIVE_SENSE.test(sentence)) return COMMON_AREA.test(sentence) ? "odor_detected_common_area" : "odor_detected";
  if (NEGATIVE_SENSE.test(sentence)) return "no_odor_detected";
  if (/\bheard (loud|music|noise|banging|thumping)\b/i.test(sentence)) return "noise_heard";
  if (/\bdid not hear\b|\bdidn'?t hear\b|\bno noise\b/i.test(sentence)) return "no_noise_detected";
  if (/\banswered the door\b|\bwas home\b|\bspoke (with|to)\b/i.test(sentence)) return "contact_made";
  if (/\bno answer\b|\bno pickup\b|\bdid(n'?t| not) answer\b|\bno response\b/i.test(sentence)) return "no_answer";
  if (/\bcigarette butts?\b|\bash\b/i.test(sentence)) return "physical_trace";
  if (/\bdid not identify\b|\bcould not (identify|determine|tell)\b/i.test(sentence)) return "source_not_identified";
  if (/\bfound (a |the )?(loose|leak|broken|stuck)\b|\bwas stuck\b/i.test(sentence)) return "cause_identified";
  return undefined;
}

export const OUTCOME_LABEL: Record<string, string> = {
  smoking_observed: "Smoking directly observed", odor_detected: "Odor detected", odor_detected_common_area: "Odor detected in a common area",
  no_odor_detected: "No odor detected", noise_heard: "Noise heard by staff", no_noise_detected: "No noise heard by staff",
  contact_made: "Occupant contacted", no_answer: "No answer", not_investigated: "Not checked at the time", no_contact_attempt: "Did not attempt contact",
  denial: "Denial", physical_trace: "Physical trace noted", source_not_identified: "Source not identified", cause_identified: "Cause identified",
};

// ---------------------------------------------------------------- sensitivity & untrusted-content screening

export const SENSITIVITY_ORDER = ["public_policy", "internal_ops", "employee_pi", "resident_pi", "confidential_case", "highly_sensitive"] as const;
export type Sensitivity = (typeof SENSITIVITY_ORDER)[number];
export const SENSITIVITY_LABEL: Record<string, string> = {
  public_policy: "Building policy", internal_ops: "Internal operations", employee_pi: "Employee personal information",
  resident_pi: "Resident personal information", confidential_case: "Confidential complaint / case material", highly_sensitive: "Highly sensitive",
};
export const maxSensitivity = (xs: string[]): Sensitivity =>
  xs.reduce<Sensitivity>((a, b) => (SENSITIVITY_ORDER.indexOf(b as Sensitivity) > SENSITIVITY_ORDER.indexOf(a) ? (b as Sensitivity) : a), "public_policy");

const HIGHLY_SENSITIVE = /\bpassport\b|\bsocial security\b|\bssn\b|\bbank account\b|\brouting number\b|\bmedical records?\b|\breasonable accommodation\b|\b(door|alarm|gate) code\b|\bpassword\b/i;
const HEALTH = /\basthma\b|\bdiagnos(is|ed)\b|\bdisabilit(y|ies)\b|\bmedication\b/i;
const LEGAL = /\battorney\b|\blawyer\b|\blegal action\b|\bcounsel\b/i;
const INJECTION = /ignore (all )?(previous|prior|above|earlier) instructions|disregard (the |all )?(above|previous|prior)|system (note|prompt|message|override)|to (the )?ai assistant|you are (now )?an? (ai|assistant|language model)|mark this case as/i;

export function screenContent(text: string) {
  return { highlySensitive: HIGHLY_SENSITIVE.test(text), health: HEALTH.test(text), legal: LEGAL.test(text), injection: INJECTION.test(text) };
}

/** Field-level minimization applied before any text is sent to an external model. */
export function redactForModel(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(\+?1[ .-]?)?\(?\b\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}\b/g, "[phone]");
}
