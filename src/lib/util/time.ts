/** Timezone helpers without a date library. Building records are authored in local wall time. */

export const DEFAULT_TZ = "America/New_York";

function offsetMinutes(utc: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(utc);
  const v = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const asUtc = Date.UTC(v("year"), v("month") - 1, v("day"), v("hour"), v("minute"), v("second"));
  return Math.round((asUtc - utc.getTime()) / 60000);
}

/** Convert a local wall-clock time ("2026-10-05", "15:45") in `tz` to an absolute instant. */
export function zonedToUtc(date: string, time: string, tz = DEFAULT_TZ): Date {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let utc = new Date(guess - offsetMinutes(new Date(guess), tz) * 60000);
  utc = new Date(guess - offsetMinutes(utc, tz) * 60000); // second pass handles DST edges
  return utc;
}

export function localParts(d: Date, tz = DEFAULT_TZ) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short",
  }).formatToParts(d);
  const v = (t: string) => parts.find((p) => p.type === t)!.value;
  return { date: `${v("year")}-${v("month")}-${v("day")}`, time: `${v("hour")}:${v("minute")}`, hour: Number(v("hour")), minute: Number(v("minute")), weekday: v("weekday") };
}

export const fmtDate = (d: Date | string | null | undefined, tz = DEFAULT_TZ) =>
  d ? new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric", year: "numeric" }).format(new Date(d)) : "—";

export const fmtTime = (d: Date | string | null | undefined, tz = DEFAULT_TZ) =>
  d ? new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date(d)) : "—";

export const fmtDateTime = (d: Date | string | null | undefined, tz = DEFAULT_TZ) =>
  d ? new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(d)) : "—";

export const fmtDayLong = (d: Date | string, tz = DEFAULT_TZ) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric" }).format(new Date(d));

export function addDays(date: string, n: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday

/** "3 days ago" style relative label, used for sync freshness. */
export function relative(from: Date | string | null | undefined, now: Date): string {
  if (!from) return "never";
  const mins = Math.round((now.getTime() - new Date(from).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)} h ago`;
  return `${Math.round(mins / 1440)} days ago`;
}
