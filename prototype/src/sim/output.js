// Work output: what each job at a base brought in, by day, for the base's "Work now" panel and the People tab
// (activity.js). A plain counter with no imports, so every producing module can note into it without a cycle.
//
// base.output = { [job]: [[day, { unit: n, … }], …] }   (made on the first note; older saves simply start empty)
//   job:  the role key (economy.js ROLES: wood, forage, hunt, fish, farm, scavenge, operate, build, craft …)
//   day:  the work day it was made on. The daily systems run at midnight (world.js tickHour, hour % 24 === 0) and
//         count for the day that just ended; the hourly ones (construction, crafting) for the day they run in.
//   unit: a supply key (firewood is "wood", food "food" …) or a work measure ("workh": work-hours done, "items").
// Only the last KEEP days are kept a job. Pure bookkeeping: it reads no dice and changes nothing else.
export const OUTPUT_KEEP = 3;
// The work day an hour counts for (1-based like world.js day): the midnight tick belongs to the day before it.
export const workDay = (hour) => Math.floor((Math.max(1, hour) - 1) / 24) + 1;

export function noteOutput(state, base, job, amount, unit) {
  if (!base || !job || !unit) return;
  const n = Number(amount) || 0;
  const out = base.output || (base.output = {});
  const list = Array.isArray(out[job]) ? out[job] : (out[job] = []);
  const d = workDay(state.hour);
  let row = list.find((r) => r[0] === d);
  if (!row) { row = [d, {}]; list.push(row); list.sort((a, b) => a[0] - b[0]); while (list.length > OUTPUT_KEEP) list.shift(); }
  row[1][unit] = Math.round(((row[1][unit] || 0) + n) * 100) / 100;
}

// The recorded days of one job, newest first: [{ day, by: { unit: n } }].
export function outputDays(base, job) {
  const list = base && base.output && Array.isArray(base.output[job]) ? base.output[job] : [];
  return list.filter((r) => Array.isArray(r) && r[1]).map((r) => ({ day: r[0], by: r[1] })).sort((a, b) => b.day - a.day);
}
