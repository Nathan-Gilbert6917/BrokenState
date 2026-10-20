// What people are doing, in the UI (sim/activity.js): the People tab's activity chip and its Idle filter, the base's
// "Work now" panel (the Idle list on top, then one row per job: who is on it and what each is doing this hour, a bar
// toward the next output, the winter target for wood, what it brought in on its last days with a 7-day sparkline,
// and why it brings in nothing when it cannot work), the Bases card's "N of M working" chip and the stalled-job alert.
// Small functions with their own classes (act-*, wn-*, idle-*) so the base window's look can change around them.
import { describeActivity, workingActivity, baseWork, idlePeople, workCount, stalledJobs, outputSeries, amountText, STALL_ALERT_DAYS } from "../sim/activity.js";
import { roleSelect } from "./work.js"; // the role drop-down (work roles and fixed jobs): put someone idle to work
import { planIdle, planText } from "../sim/idlework.js"; // "Assign all idle": each to what the base needs most
import { fold } from "./panelfold.js"; // the Bases tab's per-base Idle drop-downs (open state kept)
import { TRIP_JOBS } from "../sim/tripland.js"; // the outdoor jobs: their loads come in as they get home (sim/jobtrips.js)
import { kitWarnings, gearOutdoorWorkers } from "../sim/tripgear.js"; // the outdoor workers' kit: the chips, Gear outdoor workers (trips-plus #2)
import { lunchHour } from "../sim/meals.js"; // the lunch hour (the Work tab)
import { noWorkRoles, helpingText } from "../sim/noidle.js"; // roles with no work: the quiet alert
const hh = (h) => `${String(h).padStart(2, "0")}:00`;

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => s.name.split(" ")[0];
const plural = (n, a, b = `${a}s`) => `${n} ${n === 1 ? a : b}`;

// The chip: icon and a few words, coloured by kind (work, off, sleep, guard, hurt, free, idle, stalled, away, eat).
export function activityChip(state, s, { short = false } = {}) {
  const a = describeActivity(state, s);
  return `<span class="act act-${a.kind}${short ? " act-short" : ""}"${tip(a.why ? `${a.text}. ${a.why}` : a.text)}><i class="act-ico" aria-hidden="true">${a.icon}</i><span class="act-txt">${esc(short ? a.text.replace(/ \([^)]*\)$/, "") : a.text)}</span></span>`;
}
// Under the chip when their job has nothing for them, whatever the hour shows (asleep, eating …): why.
export function idleNote(state, s) {
  const a = workingActivity(state, s);
  if (a.kind !== "idle" && a.kind !== "stalled") return "";
  if (describeActivity(state, s).kind === a.kind) return ""; // the chip says it already
  return `<div class="idle-note small warn"${tip(a.why)}>⏸ No work: ${esc(a.text)}</div>`;
}

// ---------- the People tab's Idle filter (main.js "ppl-idle") ----------
let pplIdle = false;
export const peopleIdleOn = () => pplIdle;
export const togglePeopleIdle = () => { pplIdle = !pplIdle; };
export function peopleIdleButton(state) {
  const n = idlePeople(state).length;
  return `<button class="mini ppl-idle${pplIdle ? " on" : ""}" data-action="ppl-idle" aria-pressed="${pplIdle}"${tip(pplIdle ? "Show everyone again" : "Show only the people at your bases with nothing to do: a work role with no work, or a job that cannot be done there (no tool, nothing to build, the land cut bare …). Resting, in bed, on watch and away are left out.")}>⏸ Idle${n ? ` <span class="idle-badge">${n}</span>` : ""}</button>`;
}
export const idleSet = (state) => new Set(idlePeople(state).map((x) => x.s.id));

// ---------- sparkline ----------
export function sparkline(state, base, job) {
  const ser = outputSeries(state, base, job);
  if (!ser.days.some((d) => d.rec)) return "";
  const W = 56, H = 14, max = Math.max(...ser.days.map((d) => d.n), 1e-9);
  const step = W / Math.max(1, ser.days.length - 1);
  const pts = ser.days.map((d, i) => `${(i * step).toFixed(1)},${(H - 1 - (d.n / max) * (H - 2)).toFixed(1)}`).join(" ");
  const t = ser.days.map((d) => `Day ${d.day}: ${d.rec ? amountText(ser.unit, d.n) : "—"}`).join("\n");
  return `<span class="wn-spark"${tip(`The last ${ser.days.length} days:\n${t}`)}><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/></svg></span>`;
}

// ---------- the Work now panel ----------
// A thin bar with its text: frac 0..1.
function wnBar(p, cls = "") {
  const w = Math.max(0, Math.min(100, Math.round((p.frac || 0) * 100)));
  return `<div class="wn-prog ${cls}"><div class="wn-bar"><i style="width:${w}%"></i></div><span class="wn-ptxt small">${esc(p.text)}</span></div>`;
}
function wnLast(state, base, row) {
  if (!row.last.length) return `<div class="wn-last small muted">Nothing recorded yet${["build", "craft", "medic"].includes(row.job) ? "" : TRIP_JOBS[row.job] ? ": each load comes in as they get home" : ": the day's work comes in at midnight"}.</div>`;
  const [a, b] = row.last;
  return `<div class="wn-last small">${sparkline(state, base, row.job)}<span class="${a.zero ? "warn" : "good"}">${esc(a.text)}</span> <span class="muted">${esc(a.when)}</span>${b ? ` <span class="muted">· ${esc(b.text)} ${esc(b.when)}</span>` : ""}</div>`;
}
function wnPerson(state, x, base) {
  const a = x.act;
  const warn = base ? kitWarnings(state, base, x.s) : []; // an outdoor worker going out without a weapon, rounds or a light
  const chip = warn.length ? ` <b class="wn-kit warn"${tip(warn.map((w) => w.tip).join(" "))}>⚠ ${esc(warn.map((w) => w.text).join(", "))}</b>` : "";
  return `<span class="wn-who act-${a.kind}" data-action="survivor" data-id="${x.s.id}"${tip(`${x.s.name}: ${a.text}${a.why ? `. ${a.why}` : ""}`)}><i aria-hidden="true">${a.icon}</i>${esc(first(x.s))}${chip}</span>`;
}
// "Gear outdoor workers": what the armory can spare to those going out (sim/tripgear.js). Shown while one of them is
// short of something; greyed out when the armory has nothing that would help.
export function gearOutButton(state, base) {
  const short = atBaseOut(state, base).filter((s) => kitWarnings(state, base, s).length);
  if (!short.length) return "";
  const dry = gearPreview(state, base);
  return `<button class="mini wn-gear" data-action="gear-out" data-base="${base.id}"${dry.length ? "" : " disabled"}${tip(dry.length ? `From ${base.name}'s armory: ${dry.join(", ")}. A weapon for the job, a light for the dusk hunt or fishing, light armour, a tourniquet or kit (one of each kept for a team and the medics).` : `Nothing in ${base.name}'s armory would help ${short.map(first).join(", ")} (no spare weapon, light, armour or tourniquet): craft or find some.`)}>🗡 Gear outdoor workers</button>`;
}
const atBaseOut = (state, base) => (state.survivors || []).filter((s) => s.alive && s.location && s.location.kind === "base" && s.location.baseId === base.id && TRIP_JOBS[s.role]);
// What the button would hand out, without moving anything.
const gearPreview = (state, base) => gearOutdoorWorkers(state, base, { pinned: true, dry: true }).map((x) => `${first(x.s)}: ${String(x.item.name || "").toLowerCase()}`);
function wnRow(state, base, row) {
  const n = row.people.length;
  const busy = row.job === "rest" ? "" : `<span class="wn-count small ${row.now ? "good" : "muted"}">${row.now} of ${n} at it now${row.out ? ` · ${row.out} out on the land` : ""}</span>`;
  const days = row.stalledDays >= 1 ? ` (${plural(row.stalledDays, "day")})` : "";
  return `<div class="wn-row wn-${row.job}">
    <div class="wn-head"><span class="wn-ico" aria-hidden="true">${row.icon}</span><b class="wn-name">${esc(row.name)}</b>${busy}</div>
    <div class="wn-people">${row.people.map((x) => wnPerson(state, x, TRIP_JOBS[row.job] ? base : null)).join("")}</div>
    ${row.why ? `<div class="wn-why small ${row.stalledDays >= STALL_ALERT_DAYS ? "danger" : "warn"}">⚠️ ${esc(row.why)}${days}</div>` : ""}
    ${row.progress ? wnBar(row.progress) : ""}
    ${row.goal ? wnBar(row.goal, "wn-goal") : ""}
    ${(row.why && !row.last.length) || ["rest", "guard"].includes(row.job) ? "" : wnLast(state, base, row)}
  </div>`;
}
// The Idle list: who has nothing to do here, why, and a role drop-down to put them to work; "Assign all idle".
function idleRows(state, list) {
  return list.map((x) => `<div class="idle-row"><span class="idle-who"><a class="link" data-action="survivor" data-id="${x.s.id}">${esc(x.s.name)}</a><span class="small warn idle-why"${tip(x.act.why)}>${esc(x.why)}</span></span>${roleSelect(state, x.s)}</div>`).join("");
}
export function assignIdleButton(state, base) {
  const plan = planIdle(state, base);
  return `<button class="mini primary idle-assign" data-action="idle-assign" data-base="${base.id}"${plan.length ? "" : " disabled"}${tip(plan.length ? `Each to the job ${base.name} needs most (asks first): ${planText(plan)}` : "Nothing here has room for them now: pick their jobs by hand.")}>Assign all idle</button>`;
}
export function idleList(state, base) {
  const list = idlePeople(state, base);
  if (!list.length) return "";
  return `<div class="idle-list"><div class="idle-head spread"><span><b>⏸ Idle</b> <span class="idle-badge">${list.length}</span> <span class="small muted">nothing to do: pick them a job</span></span>${assignIdleButton(state, base)}</div>
    ${idleRows(state, list)}
  </div>`;
}
// The Bases tab: every base's idle colonists, one drop-down a base with its count.
export function idleBasesSection(state) {
  const by = state.bases.map((b) => [b, idlePeople(state, b)]).filter(([, l]) => l.length);
  if (!by.length) return "";
  const n = by.reduce((a, [, l]) => a + l.length, 0);
  return `<div class="card idle-bases"><div class="idle-head"><b>⏸ Idle colonists</b> <span class="idle-badge">${n}</span> <span class="small muted">no work at their base: pick them a job</span></div>
    ${by.map(([b, l]) => fold(`idle:${b.id}`, `<span class="idle-sum"><b>${esc(b.name)}</b> <span class="idle-badge">${l.length}</span> <span class="small muted">${esc(l.map((x) => first(x.s)).join(", "))}</span></span>`, `${idleRows(state, l)}<div class="row idle-foot">${assignIdleButton(state, b)}</div>`, { cls: "idle-fold", tipText: `Show or hide ${b.name}'s idle colonists` })).join("")}
  </div>`;
}
// The confirmation's text: who goes where and why.
export function assignIdlePreview(state, base) {
  const plan = planIdle(state, base);
  return { plan, text: plan.map((p) => `${p.s.name} → ${p.job === "operate" ? "Operate" : planText([p]).split(" → ")[1]} (${p.why})`).join("; ") };
}

// The base's "Work now" panel (Overview tab).
export function workNowPanel(state, base) {
  const rows = baseWork(state, base);
  if (!rows.length) return "";
  return `<div class="worknow"><h3${tip(`Every job here: who is on it and what each of them is doing this hour, how far the day's work has got, and what it brought in on its last days (hover the sparkline for 7 days). The outdoor jobs (wood, foraging, hunting, fishing, scavenging, fetching water) go out in trips to the base's land and bring each load into the store as they get home (on the map: the Base workers layer); the workshops, teaching and reading bring theirs in at midnight. Breakfast (06:00, hunters and fishers 10:00) and dinner (20:00): building and crafting stop for them; someone out on a trip eats when back. Lunch (${hh(lunchHour(state))}, set in the Work tab): all work stops; someone out on a trip eats from their pack where they are.`)}>Work now</h3>${gearOutButton(state, base)}${idleList(state, base)}${rows.map((r) => wnRow(state, base, r)).join("")}</div>`;
}

// ---------- the Bases card and the alerts ----------
// "⚒ 5/6 working" on the Bases card's strip (ui.js baseStrip: its .bs-chip look).
export function workChip(state, base) {
  const c = workCount(state, base);
  if (!c.total) return "";
  const idle = idlePeople(state, base);
  const parts = [`${c.working} of ${c.total} working`, c.idle ? `${c.idle} idle${idle.length ? ` (${idle.map((x) => `${first(x.s)}: ${x.why.toLowerCase()}`).join("; ")})` : ""}` : "", c.hurt ? `${c.hurt} in bed or resting for their health` : "", c.resting ? `${c.resting} resting or on free time` : ""].filter(Boolean);
  return `<span class="bs-chip${c.idle ? " warn" : ""}"${tip(`${parts.join(" · ")}. By each one's job, whatever the hour (the base's Work now panel has who is at it now).`)}>⚒ ${c.working}/${c.total} working</span>`;
}
// alerts.js SECTIONS: a job at a base that has been unable to work for STALL_ALERT_DAYS or more (one per base and job;
// gone when it can work again).
// alerts.js SECTIONS (noidle, the user's request 2026-10-20): the roles with no work at each base (by the job), one quiet
// alert a base, so the player can reassign them; meanwhile they help elsewhere (sim/noidle.js helpHour). A job stalled
// STALL_ALERT_DAYS or more has the stalled-job alert (stallAlerts) instead.
export function noWorkAlerts(state, out) {
  const by = new Map();
  const loud = new Set(stalledJobs(state).map((j) => `${j.base.id}:${j.job}`)); // stalled 2+ days: the stalled-job alert has it
  for (const r of noWorkRoles(state)) { if (loud.has(`${r.base.id}:${r.job}`)) continue; if (!by.has(r.base.id)) by.set(r.base.id, []); by.get(r.base.id).push(r); }
  for (const [id, rows] of by) {
    const b = rows[0].base;
    const n = rows.reduce((a, r) => a + r.people.length, 0);
    const list = rows.map((r) => `${r.name} (${r.people.map(first).join(", ")})`).join(", ");
    const helping = rows.map(helpingText).filter(Boolean).join(", ");
    out.push({ key: `nowork:${id}:${rows.map((r) => r.job).join(",")}`, kind: "nowork", icon: "💤", tone: "info", text: `${b.name}: no work for ${list}`, tip: `${rows.map((r) => `${r.name}: ${r.why.replace(/^[^:–]*[:–]\s*/, "").toLowerCase() || "nothing to do"}`).join("; ")}. ${plural(n, "person has", "people have")} a job with no work; they help where there is work meanwhile${helping ? ` (${helping})` : ""} and go back to their own job when it has some. Give them another job to keep them on it. Click to open the base.`, go: { base: id, tab: "overview" } });
  }
}
export function stallAlerts(state, out) {
  for (const j of stalledJobs(state)) {
    out.push({ key: `stall:${j.base.id}:${j.job}`, kind: "stalled", icon: "⏸", tone: "warn", text: `${j.base.name}: ${j.name} stalled ${plural(j.days, "day")}`, tip: `${j.people.map(first).join(", ")} ${j.people.length === 1 ? "is" : "are"} on ${j.name} and cannot work: ${j.why}. Give them another job or fix what it needs. Click to open the base.`, go: { base: j.base.id, tab: "overview" } });
  }
}
