/**
 * Synthetic shift-log rows for Riverside House. Hand-authored rows carry the evaluated
 * scenarios; generated rows are unrelated daily activity. Typos, late entries, duplicate
 * entries and vague descriptions are intentional.
 */

export type LogRow = {
  id: string;
  logged: string; // "YYYY-MM-DD HH:mm" local — when the entry was written
  date: string; // local date of the event
  time: string; // "HH:mm" local time of the event
  staff: string;
  unit: string;
  type: string;
  notes: string;
};

const row = (id: string, logged: string, date: string, time: string, staff: string, unit: string, type: string, notes: string): LogRow => ({ id, logged, date, time, staff, unit, type, notes });

/** Front desk log kept in a shared Google Sheet (exported as CSV). */
export const FRONT_DESK_ROWS: LogRow[] = [
  // ---- Smoke / odor, 12C reporting 12B
  row("FD-1005-07", "2026-10-05 15:47", "2026-10-05", "15:45", "Michael Torres", "12C", "Complaint",
    "Ms. Whitfield (12C) called the desk. Says strong cigarette smoke is coming into her apartment from 12B again, bathroom and hallway side. Radioed Carlos to go up and check."),
  row("FD-1005-08", "2026-10-05 16:05", "2026-10-05", "15:54", "Michael Torres", "12B", "Inspection",
    "Carlos went up to 12 at 3:54pm. No smoke smell in the 12th floor hallway. Knocked on 12B twice, no answer. Called Ms. Whitfield back and told her nothing was detected, we will keep monitoring."),
  row("FD-1019-11", "2026-10-19 18:38", "2026-10-19", "18:30", "Michael Torres", "12C", "Complaint",
    "Ms. Whitfield came to the desk in person. Reports cigarette smoke smell in her bathroom again tonight, says it is from 12B. Very upset. Carlos is on vacation this week so I called Frank."),
  row("FD-1019-12", "2026-10-19 19:15", "2026-10-19", "18:50", "Michael Torres", "12B", "Inspection",
    "Frank went up at 6:50pm re the 12B smoke complaint. No odor in the 12th floor hallway. Ms. Whitfield let him into 12C, he could not detect smoke in her bathroom at the time of the visit. Did not knock on 12B."),
  row("FD-1027-09", "2026-10-27 22:21", "2026-10-27", "22:15", "Sam Okoye", "12C", "Complaint",
    "12C Whitfield called about cigarette smell from next door (12B). I did not go up, alone at the desk tonight. Smelled nothing in the lobby."),
  row("FD-1030-04", "2026-10-30 10:42", "2026-10-30", "10:30", "Angela Brooks", "", "Note",
    "Carlos found 3 cigarette butts on the stairwell B landing between 11 and 12 during morning rounds. Swept up. No one around."),
  row("FD-1102-06", "2026-11-02 16:12", "2026-11-02", "16:10", "Michael Torres", "12C", "Complaint",
    "Ms. Whitfield called, says the cigarette smoke is back and coming through the wall she shares with 12B. Sent Carlos up."),
  row("FD-1102-07", "2026-11-02 16:41", "2026-11-02", "16:20", "Michael Torres", "12B", "Inspection",
    "Carlos checked at 4:20pm. No odor detected in the hallway outside 12B or 12C. Knocked on 12B and Mr. Reyes answered the door. Reyes said he does not smoke and nobody was smoking in the apartment. Carlos did not notice any smoke odor at the doorway."),
  row("FD-1113-01", "2026-11-13 01:15", "2026-11-12", "23:30", "Dmitri Volkov", "12C", "Complaint",
    "Late entry. Whitfield 12C called the desk around 11:30pm re cigarette smoke smell from 12B again. Did a walk of the 12th floor at 11:40pm, nothing noted in the hallway or by the trash room. Did not knock on 12B due to the hour."),

  // ---- Noise, 5E reporting 6E
  row("FD-1029-07", "2026-10-29 16:58", "2026-10-29", "16:30", "Michael Torres", "5E", "Complaint",
    "Mr. Hale (5E) called, says there is loud banging and drilling noise coming from 6E above him. Asked Carlos to check."),
  row("FD-1029-08", "2026-10-29 17:02", "2026-10-29", "16:40", "Michael Torres", "6E", "Inspection",
    "Carlos went to the 6th floor at 4:40pm. Stood outside 6E for several minutes and did not hear any noise. Knocked on 6E, no answer. Let Mr. Hale know."),
  row("FD-1030-09", "2026-10-30 15:10", "2026-10-29", "22:50", "Michael Torres", "5E", "Complaint",
    "Late entry for last night. Around 10:50pm Hale 5E called again about loud music from 6E. I was closing out the package log and forgot to write it up. Told him we would note it. Nobody went up."),

  // ---- Replacement key, 7D
  row("FD-1112-09", "2026-11-12 17:26", "2026-11-12", "17:20", "Michael Torres", "7D", "Request",
    "Mr. Carter (7D) came to the desk, lost his apartment key at work. Needs a replacement key before Tuesday morning, he is traveling for work on 11/17. Explained that replacement keys need community manager approval. Submitted the request to Priya."),

  // ---- Leak 3A / 4A
  row("FD-1008-03", "2026-10-08 10:24", "2026-10-08", "10:20", "Angela Brooks", "3A", "Complaint",
    "Ms. Castillo (3A) called, water dripping from her bathroom ceiling. Thinks the leak is from 4A above. Called Frank."),
  row("FD-1008-04", "2026-10-08 10:55", "2026-10-08", "10:35", "Angela Brooks", "4A", "Inspection",
    "Frank checked 4A at 10:35am re the leak into 3A. Found a loose supply line under the bathroom sink and shut the valve. Mr. Novak was home. Work order opened for Luis."),

  // ---- Missing package 10F
  row("FD-1013-05", "2026-10-13 18:14", "2026-10-13", "18:10", "Michael Torres", "10F", "Complaint",
    "Mr. Adeyemi (10F) says a FedEx package marked delivered Saturday is not in the package room. Checked the shelves and the log, not found. Will ask the weekend temp."),
  row("FD-1015-02", "2026-10-15 09:55", "2026-10-15", "09:30", "Angela Brooks", "10F", "Package",
    "Found the Adeyemi 10F package behind the oversized shelf, mis-shelved under 10E. Called him, he picked it up at 9:50am."),

  // ---- Pest 8C
  row("FD-1026-04", "2026-10-26 11:18", "2026-10-26", "11:15", "Angela Brooks", "8C", "Complaint",
    "Ms. Stein (8C) reports seeing mice droppings under her kitchen sink. Asked for the exterminator. Emailed Priya."),

  // ---- Hot water, 14 line
  row("FD-1103-01", "2026-11-03 07:31", "2026-11-03", "07:25", "Angela Brooks", "14A", "Complaint",
    "Mr. Mitchell (14A) called, no hot water this morning. Two more calls from other upper floor apartments. Frank notified, checking the boiler."),
  row("FD-1103-03", "2026-11-03 09:12", "2026-11-03", "08:50", "Angela Brooks", "14A", "Inspection",
    "Frank reset the mixing valve at 8:50am, hot water restored. Called 14A back to confirm."),

  // ---- Building systems / misc that should NOT be pulled into other cases
  row("FD-1009-02", "2026-10-09 13:40", "2026-10-09", "13:35", "Angela Brooks", "2B", "Complaint",
    "Ms. Park (2B) says her intercom buzzes but she cannot hear visitors. Work order requested."),
  row("FD-1016-03", "2026-10-16 08:20", "2026-10-16", "08:15", "Angela Brooks", "8F", "Maintenance",
    "8F smoke detector chirping, low battery. Ms. Brooks asked for a new battery. WO for Luis."),
  row("FD-1020-06", "2026-10-20 14:22", "2026-10-20", "14:15", "Angela Brooks", "", "Maintenance",
    "Elevator B stuck on 9 with doors open at 2:15pm. Called Apex Elevator, tech ETA 4pm. Posted sign in lobby."),
  row("FD-1020-10", "2026-10-20 17:05", "2026-10-20", "16:50", "Michael Torres", "", "Maintenance",
    "Apex tech reset elevator B door operator, back in service 4:50pm."),
  row("FD-1029-01", "2026-10-29 08:05", "2026-10-29", "08:00", "Angela Brooks", "", "Maintenance",
    "Lobby door closer slamming again. Told Frank, he will adjust it today."),
  row("FD-1104-05", "2026-11-04 12:10", "2026-11-04", "12:05", "Angela Brooks", "6B", "Request",
    "Ms. Weiss (6B) asked for a bike room fob. Told her it needs a signed bike storage form and manager approval. Gave her the form."),
];

/** Temp coverage log kept by agency staff in an Excel workbook with different column names. */
export const TEMP_ROWS: LogRow[] = [
  row("TC-0031", "2026-10-10 21:26", "2026-10-10", "21:20", "Jordan Lee", "12-C", "",
    "Mrs Witfield called 9:20p, says smoke smell v strong in her bathrm vent, thinks its from 12B. No porter on tonight and I cant leave the desk so nobody went up. Left note for AM shift."),
  row("TC-0032", "2026-10-11 07:55", "2026-10-11", "07:40", "Sam Okoye", "12B", "",
    "Saw Jordan's note from last night re the 12C smoke complaint. Carlos checked the 12th fl at 7:40am. Faint stale odor near the trash chute room, could not tell where it was coming from. Nothing at the 12B door."),
  row("TC-0036", "2026-10-17 22:58", "2026-10-17", "22:50", "Jordan Lee", "5E", "",
    "Mr Hale 5E called 10:50p, says loud thumping and music from 6E upstairs. Rang 6E on the intercom, no answer. Cant leave desk."),
  row("TC-0044", "2026-10-27 22:48", "2026-10-27", "22:40", "Sam Okoye", "12C", "",
    "Whitfield 12C phoned re smoke smell from neighbor (12B). Couldnt leave desk. Will tell Michael tmrw."),
  row("TC-0047", "2026-11-01 20:52", "2026-11-01", "20:45", "Jordan Lee", "11A", "",
    "Mr Rosen 11A called 8:45p, says the dog in 11D has been barking for over an hour. Called 11D, no pickup."),
  row("TC-0052", "2026-11-14 14:21", "2026-11-14", "14:15", "Sam Okoye", "9A", "",
    "Ms Feldman 9A asked if maintenance can hang a heavy mirror (about 60 lbs) in her living rm and if she can borrow a drill. Told her I would check the policy and get back to her."),
  row("TC-0053", "2026-11-15 11:09", "2026-11-15", "11:05", "Sam Okoye", "7D", "",
    "Carter 7D asked at the desk about his replacement key, any update? He leaves Tues AM. Told him I would pass it along."),
  row("TC-0040", "2026-10-24 09:12", "2026-10-24", "09:05", "Sam Okoye", "", "",
    "Dry cleaning van dropped 4 orders, hung in the valet closet."),
  row("TC-0041", "2026-10-25 13:30", "2026-10-25", "13:20", "Sam Okoye", "3D", "",
    "Guest for 3D signed in, Ms Murphy confirmed by phone."),
  row("TC-0049", "2026-11-07 23:12", "2026-11-07", "23:05", "Riley Chen", "", "",
    "Mr Michell called re loud music from upstairs, didnt give his apt. Told him it would be logged."),
  row("TC-0048", "2026-11-07 19:40", "2026-11-07", "19:35", "Jordan Lee", "13E", "",
    "Food delivery for 13E left at desk, called up, Mr Patel came down."),
];

// ---------------------------------------------------------------- generated daily activity

function mulberry32(seed: number) {
  return () => {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ROUTINE: { type: string; unit: boolean; notes: string[] }[] = [
  { type: "Package", unit: true, notes: ["UPS dropped {n} pkgs, logged in the package room. Notified {unit}.", "Amazon locker full, {n} overflow pkgs shelved for {unit}.", "Oversized pkg for {unit}, stored in the back room. Text sent."] },
  { type: "Visitor", unit: true, notes: ["Guest for {unit} signed in, resident confirmed by phone.", "Housekeeper for {unit} signed in with key release on file.", "Dog walker for {unit} picked up at {t}, back 40 min later."] },
  { type: "Lockout", unit: true, notes: ["{name} ({unit}) locked out, verified ID and let in with the master. Logged per key policy.", "{unit} lockout, resident showed photo ID, escorted up."] },
  { type: "Delivery", unit: true, notes: ["Furniture delivery for {unit}, service elevator padded 1-3pm.", "Grocery delivery for {unit} sent up with resident OK."] },
  { type: "Vendor", unit: false, notes: ["Window cleaning crew signed in for the lobby glass, done by noon.", "Apex Elevator tech in for monthly service, signed out after 2 hrs.", "Carpet vendor measured the 3rd fl hallway, COI on file."] },
  { type: "Note", unit: false, notes: ["Fire alarm panel showed a trouble signal for 2 min then cleared. Told Frank.", "Lobby quiet. Rounds done, nothing to report.", "Recycling pickup missed again, bags moved to the service entrance.", "Gym towel service delivered, restocked.", "Salt put down at the front entrance, wet floor sign out."] },
];

const STAFF_BY_SLOT = (date: string, hour: number): string => {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
  const weekday = wd >= 1 && wd <= 5;
  if (hour >= 7 && hour < 15) return weekday ? "Angela Brooks" : "Sam Okoye";
  if (hour >= 15 && hour < 23) return date === "2026-10-27" ? "Sam Okoye" : weekday ? "Michael Torres" : "Jordan Lee";
  return "Dmitri Volkov";
};

export function routineRows(residents: { name: string; unit: string }[]): LogRow[] {
  const rnd = mulberry32(20261005);
  const out: LogRow[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  let d = new Date(Date.UTC(2026, 9, 1));
  let seq = 0;
  while (d <= new Date(Date.UTC(2026, 10, 15))) {
    const date = d.toISOString().slice(0, 10);
    const wd = d.getUTCDay();
    const weekday = wd >= 1 && wd <= 5;
    // Weekend temps keep their own workbook; the shared sheet only has weekday routine rows.
    const count = weekday ? 1 + Math.floor(rnd() * 2) : 0;
    for (let i = 0; i < count; i++) {
      const tpl = ROUTINE[Math.floor(rnd() * ROUTINE.length)];
      const res = residents[Math.floor(rnd() * residents.length)];
      const hour = 7 + Math.floor(rnd() * 15);
      const minute = Math.floor(rnd() * 12) * 5;
      const notes = tpl.notes[Math.floor(rnd() * tpl.notes.length)]
        .replace("{n}", String(2 + Math.floor(rnd() * 9)))
        .replace("{unit}", res.unit)
        .replace("{name}", res.name)
        .replace("{t}", `${hour > 12 ? hour - 12 : hour}:${pad(minute)}`);
      const logMin = minute + 2 + Math.floor(rnd() * 6);
      seq++;
      out.push(row(`FD-${date.slice(5, 7)}${date.slice(8, 10)}-R${pad(seq % 100)}`, `${date} ${pad(hour + Math.floor(logMin / 60))}:${pad(logMin % 60)}`, date, `${pad(hour)}:${pad(minute)}`, STAFF_BY_SLOT(date, hour), tpl.unit ? res.unit : "", tpl.type, notes));
    }
    d = new Date(d.getTime() + 86400000);
  }
  return out;
}

/** Later rows delivered by the mock "Sheets sync" connector to demonstrate incremental sync. */
export const MOCK_SYNC_BATCHES: LogRow[][] = [
  [
    row("FD-1116-01", "2026-11-16 07:20", "2026-11-16", "07:15", "Angela Brooks", "", "Note", "Read weekend handoff. Carter 7D key still open with maintenance, no ETA on the work order."),
    row("FD-1116-02", "2026-11-16 08:40", "2026-11-16", "08:35", "Angela Brooks", "10C", "Package", "Oversized pkg for 10C, stored in the back room. Text sent."),
  ],
  [
    row("FD-1116-03", "2026-11-16 09:50", "2026-11-16", "09:45", "Angela Brooks", "12C", "Complaint", "Ms. Whitfield (12C) stopped at the desk, says the cigarette smoke from 12B was bad again last night and she has not heard back on her last email to management."),
  ],
];

export const WORK_ORDER_ROWS: { number: string; created: string; unit: string; title: string; description: string; status: string; assignee: string; eta: string; updated: string; completed: string; resolution: string; createdBy: string }[] = (() => {
  const w = (number: string, created: string, unit: string, title: string, description: string, status: string, assignee: string, updated: string, completed = "", resolution = "", eta = "", createdBy = "Priya Raman") =>
    ({ number, created, unit, title, description, status, assignee, eta, updated, completed, resolution, createdBy });
  return [
    w("WO-2030", "2026-10-01 09:10", "", "Replace lobby vestibule light", "Two fixtures out in the vestibule.", "Completed", "Luis Ortega", "2026-10-01 14:00", "2026-10-01 14:00", "Replaced both lamps."),
    w("WO-2031", "2026-10-02 11:00", "6B", "Kitchen faucet drip", "Slow drip at kitchen faucet.", "Completed", "Luis Ortega", "2026-10-05 10:30", "2026-10-05 10:30", "Replaced cartridge."),
    w("WO-2032", "2026-10-06 08:45", "", "Service elevator pads torn", "Replace two torn pads.", "Completed", "Carlos Mendez", "2026-10-07 09:00", "2026-10-07 09:00", "Pads replaced."),
    w("WO-2033", "2026-10-08 10:50", "4A", "Leak from 4A bathroom into 3A", "Loose supply line under 4A bathroom sink, water dripping into 3A ceiling. Valve shut by Frank.", "Completed", "Luis Ortega", "2026-10-09 15:20", "2026-10-09 15:20", "Replaced supply line in 4A. 3A ceiling to be patched and painted after it dries.", "", "Frank Russo"),
    w("WO-2034", "2026-10-09 13:45", "2B", "Intercom handset no audio", "Resident cannot hear visitors on the intercom.", "Completed", "Luis Ortega", "2026-10-14 11:00", "2026-10-14 11:00", "Replaced handset."),
    w("WO-2035", "2026-10-12 09:30", "3A", "Patch and paint bathroom ceiling", "Follow-up to the leak from 4A.", "Completed", "Luis Ortega", "2026-10-20 16:00", "2026-10-20 16:00", "Patched and painted."),
    w("WO-2036", "2026-10-13 10:00", "", "Gym treadmill belt slipping", "Treadmill #2 belt slips at speed.", "On hold", "Luis Ortega", "2026-10-16 09:00", "", "Waiting on vendor part."),
    w("WO-2037", "2026-10-15 08:30", "11D", "Bedroom window will not latch", "", "Completed", "Luis Ortega", "2026-10-16 13:00", "2026-10-16 13:00", "Adjusted latch."),
    w("WO-2038", "2026-10-16 08:25", "8F", "Smoke detector battery", "Detector chirping, low battery.", "Completed", "Luis Ortega", "2026-10-16 10:10", "2026-10-16 10:10", "Battery replaced, detector tested."),
    w("WO-2039", "2026-10-19 09:00", "", "Roof drain cleaning", "Seasonal leaf clearing.", "Completed", "Carlos Mendez", "2026-10-26 12:00", "2026-10-26 12:00", "Cleared all four drains."),
    w("WO-2040", "2026-10-20 14:30", "", "Elevator B door operator", "Stuck on 9 with doors open. Apex called.", "Completed", "Frank Russo", "2026-10-20 16:55", "2026-10-20 16:55", "Vendor reset door operator.", "", "Angela Brooks"),
    w("WO-2041", "2026-10-23 09:50", "12C", "Inspect bathroom exhaust in 12C", "Resident reports cigarette smoke odor entering through the bathroom vent (ref. complaints about 12B). Inspect exhaust damper and duct connection.", "Completed", "Luis Ortega", "2026-10-28 11:40", "2026-10-28 11:40", "Bathroom exhaust damper in 12C was stuck open. Replaced damper and sealed gap at the duct collar. Did not identify the source of any smoke odor."),
    w("WO-2042", "2026-10-23 15:00", "5A", "Dishwasher not draining", "", "Completed", "Luis Ortega", "2026-10-27 10:00", "2026-10-27 10:00", "Cleared drain hose."),
    w("WO-2043", "2026-10-26 08:10", "", "Lobby door closer adjustment", "Door slamming.", "Completed", "Frank Russo", "2026-10-29 12:30", "2026-10-29 12:30", "Adjusted closer speed.", "", "Frank Russo"),
    w("WO-2044", "2026-10-26 11:30", "8C", "Exterminator visit - mice", "Resident reports droppings under kitchen sink.", "Completed", "Frank Russo", "2026-11-04 10:00", "2026-11-04 10:00", "Vendor treated unit and sealed pipe penetration under sink. Follow-up visit in 2 weeks."),
    w("WO-2045", "2026-10-27 09:15", "13B", "Radiator valve hissing", "", "In progress", "Luis Ortega", "2026-11-02 09:00", "", "Valve on order."),
    w("WO-2046", "2026-10-28 13:20", "", "Laundry room dryer #3", "Not heating.", "Completed", "Luis Ortega", "2026-10-30 15:00", "2026-10-30 15:00", "Replaced igniter."),
    w("WO-2047", "2026-10-30 10:00", "2F", "Closet door off track", "", "Completed", "Luis Ortega", "2026-10-30 14:30", "2026-10-30 14:30", "Re-hung door."),
    w("WO-2048", "2026-11-02 08:40", "", "Stairwell B relamp", "Three landings dim.", "Completed", "Carlos Mendez", "2026-11-03 11:00", "2026-11-03 11:00", "Relamped 9, 11 and 12."),
    w("WO-2049", "2026-11-03 07:40", "", "No hot water - upper floors", "Calls from 14A, 14D, 13E.", "Completed", "Frank Russo", "2026-11-03 08:55", "2026-11-03 08:55", "Reset mixing valve at boiler. Monitoring.", "", "Angela Brooks"),
    w("WO-2050", "2026-11-04 09:00", "9F", "Bathroom fan noisy", "", "Assigned", "Luis Ortega", "2026-11-04 09:00", "", "", "2026-11-18 10:00"),
    w("WO-2051", "2026-11-05 14:10", "15A", "Move-in punch list", "Touch-up paint and missing closet shelf.", "In progress", "Luis Ortega", "2026-11-10 09:00", "", "Paint done, shelf on order."),
    w("WO-2052", "2026-11-06 10:30", "", "Package room shelf labels", "Relabel shelves after mis-shelving incident.", "Completed", "Carlos Mendez", "2026-11-09 12:00", "2026-11-09 12:00", "Relabeled."),
    w("WO-2053", "2026-11-09 08:20", "7A", "Thermostat reads 5 degrees high", "", "Assigned", "Luis Ortega", "2026-11-09 08:20", "", "", "2026-11-17 13:00"),
    w("WO-2054", "2026-11-10 11:00", "", "Bike room door fob reader", "Reader intermittently fails.", "Open", "", "2026-11-10 11:00"),
    w("WO-2055", "2026-11-11 09:30", "10C", "Balcony door weatherstrip", "", "Assigned", "Luis Ortega", "2026-11-11 09:30", "", "", "2026-11-19 11:00"),
    w("WO-2056", "2026-11-12 15:00", "4C", "Garbage disposal jammed", "", "Completed", "Luis Ortega", "2026-11-13 10:15", "2026-11-13 10:15", "Cleared jam."),
  ];
})();
