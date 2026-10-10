// What people are doing, in the UI (sim/activity.js): the People tab's activity chip and the base's "Work now"
// panel (one row per job: who is on it and what each is doing this hour, a bar toward the next output, the winter
// target for firewood, what it brought in on its last days, and why it brings in nothing when it cannot work).
// Small functions with their own classes (act-*, wn-*) so the base window's look can change around them.
import { describeActivity, baseWork } from "../sim/activity.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => s.name.split(" ")[0];

// The chip: icon and a few words, coloured by kind (work, off, sleep, guard, hurt, free, idle, stalled, away).
export function activityChip(state, s, { short = false } = {}) {
  const a = describeActivity(state, s);
  return `<span class="act act-${a.kind}${short ? " act-short" : ""}"${tip(a.why ? `${a.text}. ${a.why}` : a.text)}><i class="act-ico" aria-hidden="true">${a.icon}</i><span class="act-txt">${esc(a.text)}</span></span>`;
}

// A thin bar with its text: frac 0..1.
function wnBar(p, cls = "") {
  const w = Math.max(0, Math.min(100, Math.round((p.frac || 0) * 100)));
  return `<div class="wn-prog ${cls}"><div class="wn-bar"><i style="width:${w}%"></i></div><span class="wn-ptxt small">${esc(p.text)}</span></div>`;
}
function wnLast(row) {
  if (!row.last.length) return `<div class="wn-last small muted">Nothing recorded yet${["build", "craft"].includes(row.job) ? "" : ": the day's work comes in at midnight"}.</div>`;
  const [a, b] = row.last;
  return `<div class="wn-last small"><span class="${a.zero ? "warn" : "good"}">${esc(a.text)}</span> <span class="muted">${esc(a.when)}</span>${b ? ` <span class="muted">· ${esc(b.text)} ${esc(b.when)}</span>` : ""}</div>`;
}
function wnPerson(state, x) {
  const a = x.act;
  return `<span class="wn-who act-${a.kind}" data-action="survivor" data-id="${x.s.id}"${tip(`${x.s.name}: ${a.text}${a.why ? `. ${a.why}` : ""}`)}><i aria-hidden="true">${a.icon}</i>${esc(first(x.s))}</span>`;
}
function wnRow(state, row) {
  const n = row.people.length;
  const busy = row.job === "rest" ? "" : `<span class="wn-count small ${row.now ? "good" : "muted"}">${row.now} of ${n} at it now</span>`;
  return `<div class="wn-row wn-${row.job}">
    <div class="wn-head"><span class="wn-ico" aria-hidden="true">${row.icon}</span><b class="wn-name">${esc(row.name)}</b>${busy}</div>
    <div class="wn-people">${row.people.map((x) => wnPerson(state, x)).join("")}</div>
    ${row.why ? `<div class="wn-why small warn">⚠️ ${esc(row.why)}</div>` : ""}
    ${row.progress ? wnBar(row.progress) : ""}
    ${row.goal ? wnBar(row.goal, "wn-goal") : ""}
    ${row.job === "rest" || row.job === "guard" || row.job === "medic" || row.job === "teach" || row.job === "read" || row.job === "trainee" ? "" : wnLast(row)}
  </div>`;
}

// The base's "Work now" panel (Overview tab).
export function workNowPanel(state, base) {
  const rows = baseWork(state, base);
  if (!rows.length) return "";
  return `<div class="worknow"><h3${tip("Every job here: who is on it and what each of them is doing this hour, how far the day's work has got, and what it brought in on its last days. Daily jobs (wood, foraging, hunting, fishing, the workshops, scavenging) bring their goods into the store at midnight.")}>Work now</h3>${rows.map((r) => wnRow(state, r)).join("")}</div>`;
}
