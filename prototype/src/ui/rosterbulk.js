// The roster's bulk actions for the ticked people (ui/roster.js shows them next to "Set role"): Equip best available
// (from their own base's armory), Send to the hospital (walked to the nearest base whose hospital runs) and Move to
// base… (the supply run's transfer). The rules live in sim/bulk.js; this is the buttons, why one is greyed out, and
// the report of what happened under the bar.
import { survivorById, baseById } from "../sim/world.js";
import { equipBest, equipLine, hospitalPlan, sendToHospital, moveToBase, awayReason, nameList } from "../sim/bulk.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => String(s.name || "").split(" ")[0];
const ticked = (state, p) => (p.sel || []).map((id) => survivorById(state, id)).filter((s) => s && s.alive);
const atBase = (state, s) => s.location && s.location.kind === "base" && !!baseById(state, s.location.baseId);

// "Ann, Bob: out on a team · Cal: held by the Iron Jackals" from [{ s, why }].
export function whyList(rows) {
  const by = new Map();
  for (const r of rows) {
    const why = String(r.why || "").replace(/^is /, "");
    if (!by.has(why)) by.set(why, []);
    by.get(why).push(first(r.s));
  }
  return [...by].map(([why, names]) => `${names.join(", ")}: ${why}`).join(" · ");
}

// Which of the bulk actions apply to the ticked people, and why not: { equip, hospital, move } each { n, tip }.
export function bulkState(state, p) {
  const people = ticked(state, p);
  const base = people.filter((s) => atBase(state, s));
  const away = people.filter((s) => !atBase(state, s)).map((s) => ({ s, why: awayReason(state, s) }));
  const armed = base.filter((s) => (baseById(state, s.location.baseId).armory || []).length > 0);
  const noGear = base.filter((s) => !armed.includes(s)).map((s) => ({ s, why: `${baseById(state, s.location.baseId).name}'s armory is empty` }));
  const plans = people.map((s) => ({ s, plan: hospitalPlan(state, s) }));
  const go = plans.filter((x) => x.plan.ok);
  const stay = plans.filter((x) => !x.plan.ok).map((x) => ({ s: x.s, why: x.plan.why }));
  const none = !people.length ? "Tick people in the table first." : "";
  return {
    people,
    equip: {
      n: armed.length,
      tip: none || (armed.length ? `Hand ${armed.length === 1 ? first(armed[0]) : `the ${armed.length} at a base`} the best the base's armory has: weapons by their power at each person's skill, armor, packs and off-hand tools, best fighters first. Only real upgrades, nothing taken from anyone else, and the kit stays within a Medium load.${away.length || noGear.length ? ` Not: ${whyList([...away, ...noGear])}.` : ""}` : `Nobody ticked is at a base with gear in its armory. ${whyList([...away, ...noGear])}.`),
    },
    hospital: {
      n: go.length,
      tip: none || (go.length ? `Walk ${go.map((x) => `${first(x.s)} to ${x.plan.dest.name} (~${x.plan.hours}h)`).join(", ")}: a one-off convoy on foot with road food and water from their base, joining that base's hospital when it arrives.${stay.length ? ` Not: ${whyList(stay)}.` : ""}` : `Nobody ticked can be sent. ${whyList(stay)}. A base's hospital runs once it is built and has its medics (Medical tab).`),
    },
    move: {
      n: base.length,
      tip: none || (state.bases.length < 2 ? "You have only one base." : base.length ? `Pick a base: the ${base.length === 1 ? "person" : `${base.length} people`} at other bases walk there as a one-off convoy (a supply run that disbands there), with road food and water from the base they leave.${away.length ? ` Not: ${whyList(away)}.` : ""}` : `Nobody ticked is at a base. ${whyList(away)}.`),
    },
  };
}

// The buttons for the roster's bar.
export function bulkBar(state, ui, p) {
  const b = bulkState(state, p);
  const moveOk = b.move.n > 0 && state.bases.length > 1;
  return `<button data-action="ro-equip" ${b.equip.n ? "" : "disabled"}${tip(b.equip.tip)}>🎒 Equip best</button>
    <button data-action="ro-hospital" ${b.hospital.n ? "" : "disabled"}${tip(b.hospital.tip)}>🏥 To the hospital${b.hospital.n ? ` (${b.hospital.n})` : ""}</button>
    <select data-action="ro-bulkmove" ${moveOk ? "" : "disabled"}${tip(b.move.tip)}><option value="">Move to base…</option>${state.bases.map((x) => `<option value="${x.id}">${esc(x.name)}</option>`).join("")}</select>`;
}

// What the last bulk action did, under the bar (✕ closes it).
export function bulkReport(p) {
  const r = p.report;
  if (!r || !r.lines || !r.lines.length) return "";
  return `<div class="result small ro-report"><div class="spread"><b>${esc(r.title)}</b><button class="mini" data-action="ro-report-close"${tip("Close this report")}>✕</button></div>${r.lines.map((l) => `<div>${esc(l)}</div>`).join("")}</div>`;
}

const baseName = (state, id) => (baseById(state, id) || { name: "a base" }).name;
function sentLines(state, res, what) {
  const lines = res.sent.map((g) => `${nameList(state, g.ids)}: ${baseName(state, g.from)} → ${baseName(state, g.to)}, about ${g.hours}h on foot${what}.`);
  for (const f of res.failed) lines.push(`${nameList(state, f.ids)} could not leave ${baseName(state, f.from)}: ${String(f.why).replace(/^Cannot leave: /, "")}`);
  if (res.stay.length) lines.push(`Not sent: ${whyList(res.stay)}.`);
  return lines;
}
const prefsOf = (ui) => ui.rosterPrefs || (ui.rosterPrefs = { sort: "name", dir: 1, base: "all", role: "all", status: "all", sel: [], msg: "" });

export const BULK_ACTIONS = {
  "ro-equip": (state, ui) => {
    const p = prefsOf(ui);
    const res = equipBest(state, ticked(state, p));
    const n = res.changed.reduce((a, c) => a + c.got.length, 0);
    const lines = res.changed.map(equipLine);
    if (res.same.length) lines.push(`Nothing better in the armory (or too heavy) for ${res.same.map(first).join(", ")}.`);
    if (res.away.length) lines.push(`Not at a base: ${whyList(res.away)}.`);
    p.report = { title: n ? `Equipped ${n} item${n === 1 ? "" : "s"} for ${res.changed.length} ${res.changed.length === 1 ? "person" : "people"}` : "Nothing changed", lines };
    p.msg = "";
  },
  "ro-hospital": (state, ui) => {
    const p = prefsOf(ui);
    const res = sendToHospital(state, ticked(state, p));
    const n = res.sent.reduce((a, g) => a + g.ids.length, 0);
    p.report = { title: n ? `${n} on the way to a hospital` : "Nobody sent", lines: sentLines(state, res, ", then a hospital bed when they need one") };
    p.msg = "";
  },
  "ro-report-close": (state, ui) => { prefsOf(ui).report = null; },
};
export const BULK_CHANGE = {
  "ro-bulkmove": (state, ui, el) => {
    const p = prefsOf(ui), id = Number(el.value);
    if (!el.value || !baseById(state, id)) return;
    const res = moveToBase(state, ticked(state, p), id);
    const n = res.sent.reduce((a, g) => a + g.ids.length, 0);
    p.report = { title: n ? `${n} on the way to ${baseName(state, id)}` : "Nobody moved", lines: sentLines(state, res, "") };
    p.msg = "";
  },
};

// Help → Roster: bulk actions (ui/help.js).
export const BULK_HELP = {
  title: "Roster: bulk actions",
  html: `Tick people in the <b>Roster</b> (R), or tick the header box for everyone shown, then: <b>Set role</b> for all of them; <b>🎒 Equip best</b>: each one at a base gets the best weapon, armor (body, head, arms, legs), pack and off-hand tool their own base's armory holds, the best fighters first. A weapon counts by its power at that person's skill; only real upgrades are taken, what they had goes back to the armory, nobody else's kit is touched, and the worn kit stays within a Medium load (or gets no heavier). A new pack takes the old one's contents along. The report under the bar lists every change. <b>🏥 To the hospital</b>: the hurt and the ill at a base whose hospital is not running (none built, or too few medics) walk to the nearest base where one runs, as a one-off supply-run convoy on foot with road food and water from the base they leave; when they arrive they join that base and take a bed when they need one (Medical tab: the admit line). People already at a running hospital stay. <b>Move to base…</b>: the same walk to any base you pick. Moves take the road's usual time and risks, never instantly. A greyed-out button says why on hover: out on a team, held captive, on a convoy, an empty armory, no road, no base with a hospital.`,
};
