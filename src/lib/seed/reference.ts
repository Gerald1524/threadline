/**
 * Fixed reference data for the synthetic tenants. All people, addresses and domains are
 * fictional. IDs are stable so evaluations can refer to them.
 */
import type { Role } from "../access";
import { addDays, weekdayOf, zonedToUtc } from "../util/time";

export const DEMO_PASSWORD = "threadline-demo";
export const TZ = "America/New_York";
export const STAFF_DOMAINS = ["northbridge.example", "riversidehouse.example", "harborview.example"];

export const ORGS = [
  { id: "org_northbridge", name: "Northbridge Residential" },
  { id: "org_harborview", name: "Harborview Property Group" },
];

export const PROPERTIES = [
  { id: "prop_riverside", orgId: "org_northbridge", name: "Riverside House", address: "410 Riverside Drive, New York, NY", floors: [2, 15] as const, lines: "ABCDEF" },
  { id: "prop_annex", orgId: "org_northbridge", name: "Riverside Annex", address: "418 Riverside Drive, New York, NY", floors: [1, 4] as const, lines: "ABC" },
  { id: "prop_calder", orgId: "org_harborview", name: "Calder Court", address: "77 Calder Street, Brooklyn, NY", floors: [1, 14] as const, lines: "ABCD" },
];

export const unitId = (propertyId: string, label: string) => `unit_${propertyId.replace("prop_", "")}_${label.toLowerCase()}`;

export type SeedUser = { id: string; orgId: string; name: string; email: string; title: string; employment: "permanent" | "temp" | "contractor"; role: Role; propertyId: string | null };

export const USERS: SeedUser[] = [
  { id: "u_priya", orgId: "org_northbridge", name: "Priya Raman", email: "priya.raman@northbridge.example", title: "Community Manager", employment: "permanent", role: "community_manager", propertyId: "prop_riverside" },
  { id: "u_dana", orgId: "org_northbridge", name: "Dana Kim", email: "dana.kim@northbridge.example", title: "Community Manager (started Nov 9, 2026)", employment: "permanent", role: "community_manager", propertyId: "prop_riverside" },
  { id: "u_marcus", orgId: "org_northbridge", name: "Marcus Bell", email: "marcus.bell@northbridge.example", title: "Regional Property Admin", employment: "permanent", role: "regional_admin", propertyId: null },
  { id: "u_michael", orgId: "org_northbridge", name: "Michael Torres", email: "michael.torres@northbridge.example", title: "Concierge (evening)", employment: "permanent", role: "concierge", propertyId: "prop_riverside" },
  { id: "u_angela", orgId: "org_northbridge", name: "Angela Brooks", email: "angela.brooks@northbridge.example", title: "Concierge (day)", employment: "permanent", role: "concierge", propertyId: "prop_riverside" },
  { id: "u_dmitri", orgId: "org_northbridge", name: "Dmitri Volkov", email: "dmitri.volkov@northbridge.example", title: "Concierge (overnight)", employment: "permanent", role: "concierge", propertyId: "prop_riverside" },
  { id: "u_jordan", orgId: "org_northbridge", name: "Jordan Lee", email: "jordan.lee@staffright.example", title: "Temp concierge (StaffRight agency)", employment: "temp", role: "temp_concierge", propertyId: "prop_riverside" },
  { id: "u_sam", orgId: "org_northbridge", name: "Sam Okoye", email: "sam.okoye@staffright.example", title: "Temp concierge (StaffRight agency)", employment: "temp", role: "temp_concierge", propertyId: "prop_riverside" },
  { id: "u_riley", orgId: "org_northbridge", name: "Riley Chen", email: "riley.chen@staffright.example", title: "Temp concierge, weekend overnight", employment: "temp", role: "temp_concierge", propertyId: "prop_riverside" },
  { id: "u_carlos", orgId: "org_northbridge", name: "Carlos Mendez", email: "carlos.mendez@northbridge.example", title: "Porter", employment: "permanent", role: "porter", propertyId: "prop_riverside" },
  { id: "u_luis", orgId: "org_northbridge", name: "Luis Ortega", email: "luis.ortega@northbridge.example", title: "Maintenance Technician", employment: "permanent", role: "porter", propertyId: "prop_riverside" },
  { id: "u_frank", orgId: "org_northbridge", name: "Frank Russo", email: "frank.russo@northbridge.example", title: "Superintendent / Resident Manager", employment: "permanent", role: "superintendent", propertyId: "prop_riverside" },
  { id: "u_nina", orgId: "org_northbridge", name: "Nina Petrov", email: "nina.petrov@northbridge.example", title: "Concierge (Annex)", employment: "permanent", role: "concierge", propertyId: "prop_annex" },
  { id: "u_helen", orgId: "org_harborview", name: "Helen Cho", email: "helen.cho@harborview.example", title: "Community Manager", employment: "permanent", role: "community_manager", propertyId: "prop_calder" },
];

export type SeedResident = { id: string; propertyId: string; name: string; unit: string; email: string; start: string; end?: string };

const r = (id: string, unit: string, name: string, start = "2021-05-01", end?: string, propertyId = "prop_riverside"): SeedResident => ({
  id: `res_${id}`, propertyId, name, unit, start, end,
  email: `${name.toLowerCase().replace(/[^a-z ]/g, "").split(" ").map((p, i) => (i === 0 ? p[0] : p)).join(".")}@example.net`,
});

export const RESIDENTS: SeedResident[] = [
  r("whitfield", "12C", "Eleanor Whitfield", "2017-09-01"),
  r("reyes", "12B", "Daniel Reyes", "2026-03-01"),
  r("brandt", "12B", "Harold Brandt", "2019-06-01", "2026-01-31"),
  r("liu", "13B", "Grace Liu"),
  r("carter", "7D", "Thomas Carter", "2023-02-01"),
  r("feldman", "9A", "Naomi Feldman", "2022-08-15"),
  r("hale", "5E", "Victor Hale", "2020-01-10"),
  r("vega", "6E", "Marisol Vega", "2025-07-01"),
  r("novak", "4A", "Peter Novak"),
  r("castillo", "3A", "Irene Castillo"),
  r("adeyemi", "10F", "Samuel Adeyemi"),
  r("stein", "8C", "Rachel Stein"),
  r("haddad", "11D", "Omar Haddad"),
  r("rosen", "11A", "Isaac Rosen"),
  r("park", "2B", "Linda Park"),
  r("mitchell", "14A", "George Mitchell"),
  r("tanaka", "15A", "Yuki Tanaka", "2026-11-01"),
  r("weiss", "6B", "Hannah Weiss"),
  r("baptiste", "9F", "Andre Baptiste"),
  r("murphy", "3D", "Colleen Murphy"),
  r("patel", "13E", "Raj Patel"),
  r("marino", "5A", "Sofia Marino"),
  r("okafor", "7A", "Ben Okafor"),
  r("dubois", "10C", "Claire Dubois"),
  r("greene", "2F", "Walter Greene"),
  r("chen", "14D", "Mei Chen"),
  r("brooks", "8F", "Tanya Brooks"),
  r("ross", "15E", "Julian Ross"),
  r("nwosu", "4C", "Amara Nwosu"),
  // Other tenants. Calder Court deliberately has its own "12B" smoke complaint for isolation tests.
  r("annex_ito", "2A", "Kenji Ito", "2022-01-01", undefined, "prop_annex"),
  r("annex_dunn", "3B", "Maeve Dunn", "2022-01-01", undefined, "prop_annex"),
  r("calder_voss", "12B", "Leonard Voss", "2020-01-01", undefined, "prop_calder"),
  r("calder_amari", "12A", "Farah Amari", "2020-01-01", undefined, "prop_calder"),
];

export const SHIFT_DEFS = [
  { id: "shift_day", name: "Day", roleScope: "front_desk", start: "07:00", end: "15:00" },
  { id: "shift_evening", name: "Evening", roleScope: "front_desk", start: "15:00", end: "23:00" },
  { id: "shift_overnight", name: "Overnight", roleScope: "front_desk", start: "23:00", end: "07:00" },
  { id: "shift_porter", name: "Porter", roleScope: "porter", start: "09:00", end: "17:00" },
  { id: "shift_maint", name: "Maintenance", roleScope: "maintenance", start: "08:00", end: "16:00" },
];

export type SeedAssignment = { id: string; shiftDefinitionId: string; userId: string; startsAt: Date; endsAt: Date; coverageType: string; note?: string };

/** Riverside House roster, 2026-09-28 through 2026-11-22. Deterministic. */
export function buildRoster(): SeedAssignment[] {
  const out: SeedAssignment[] = [];
  const add = (date: string, def: (typeof SHIFT_DEFS)[number], userId: string, coverageType = "scheduled", note?: string, start = def.start, end = def.end) => {
    const startsAt = zonedToUtc(date, start, TZ);
    const endsAt = zonedToUtc(end <= start ? addDays(date, 1) : date, end, TZ);
    out.push({ id: `sa_${date}_${def.id.replace("shift_", "")}_${userId.replace("u_", "")}`, shiftDefinitionId: def.id, userId, startsAt, endsAt, coverageType, note });
  };
  const [day, evening, overnight, porter, maint] = SHIFT_DEFS;
  for (let date = "2026-09-28"; date <= "2026-11-22"; date = addDays(date, 1)) {
    const wd = weekdayOf(date); // 0 Sun .. 6 Sat
    const weekday = wd >= 1 && wd <= 5;
    add(date, day, weekday ? "u_angela" : "u_sam", weekday ? "scheduled" : "temp_cover");
    if (date === "2026-10-27") add(date, evening, "u_sam", "temp_cover", "Covering for Michael Torres (out sick)");
    else add(date, evening, weekday ? "u_michael" : "u_jordan", weekday ? "scheduled" : "temp_cover");
    // Overnight shift that starts on this date at 23:00.
    add(date, overnight, wd === 5 || wd === 6 ? "u_riley" : "u_dmitri", wd === 5 || wd === 6 ? "temp_cover" : "scheduled");
    const carlosVacation = date >= "2026-10-19" && date <= "2026-10-23";
    if (weekday && !carlosVacation) add(date, porter, "u_carlos");
    if (date === "2026-10-11") add(date, porter, "u_carlos", "overtime", "Sunday overtime coverage", "07:00", "15:00");
    if (weekday) add(date, maint, "u_luis");
  }
  return out;
}
