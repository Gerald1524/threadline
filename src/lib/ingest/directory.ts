import { eq } from "drizzle-orm";
import type { Queryable } from "../db/client";
import { memberships, properties, residencies, residents, units, users } from "../db/schema";
import type { Directory } from "./extract";

const STAFF_DOMAINS = ["northbridge.example", "riversidehouse.example", "harborview.example", "staffright.example"];

/** Snapshot of the people and units needed to resolve identities for one property. */
export async function loadDirectory(q: Queryable, propertyId: string): Promise<Directory> {
  const [prop] = await q.select().from(properties).where(eq(properties.id, propertyId));
  if (!prop) throw new Error(`Unknown property ${propertyId}`);
  const us = await q.select().from(units).where(eq(units.propertyId, propertyId));
  const rs = await q.select().from(residents).where(eq(residents.propertyId, propertyId));
  const stays = await q.select().from(residencies).where(eq(residencies.propertyId, propertyId));
  const ms = await q.select().from(memberships).where(eq(memberships.orgId, prop.orgId));
  const staffIds = new Set(ms.filter((m) => m.propertyId === propertyId || m.propertyId === null).map((m) => m.userId));
  const staff = (await q.select().from(users).where(eq(users.orgId, prop.orgId))).filter((u) => staffIds.has(u.id));
  const unitLabel = new Map(us.map((u) => [u.id, u.label]));
  return {
    orgId: prop.orgId, propertyId, timezone: prop.timezone,
    units: new Map(us.map((u) => [u.label, { id: u.id, floor: u.floor }])),
    residents: rs.map((r) => ({
      id: r.id, fullName: r.fullName, surname: r.fullName.split(" ").slice(-1)[0].toLowerCase(), email: r.email,
      stays: stays.filter((s) => s.residentId === r.id).map((s) => ({ unitId: s.unitId, unitLabel: unitLabel.get(s.unitId) ?? "", start: s.startDate, end: s.endDate })),
    })),
    staff: staff.map((u) => ({ id: u.id, fullName: u.fullName, firstName: u.fullName.split(" ")[0].toLowerCase(), email: u.email })),
    staffDomains: STAFF_DOMAINS,
  };
}
