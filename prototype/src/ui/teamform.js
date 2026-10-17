// The Form a team window (sim/teamform.js): at one of your bases, pick people, up to four vehicles, their gear and the team's
// supplies and cargo, then Form team: they stand on the base's tile as a team waiting for orders. The same window edits
// a team of yours that waits on one of your bases' tiles (add or send back people, add or leave vehicles, gear, supplies),
// every change at once.
//
// The window lives in ui.inv (ui.inv.form: its state) so the inventory's clicks, drags, selection bar, Esc and the
// paused clock all work in its Gear tab as in the base's own inventory screen:
//   ui.inv = { sid (whose doll the Gear tab shows), form: { baseId, partyId (editing) | null, crew: Set (forming),
//     vehicleIds (up to MAX_VEHICLES), supplies: { key: qty }, cargo: [armory items], tab: "people" | "gear" | "supplies", filter, sort, cursor,
//     stance, lights, days } }.
// Forming: the people are still at the base, so the Gear tab moves things between them and the armory straight away
// (sim/inventory.js moveItem: the same as the base's inventory screen); nothing else moves until Form team.
// Editing: a member's kit and the team's cargo are the team's, the armory the base's; a move between the two goes
// through sim/teaminv.js (loadFromBase, dropOff), with the same weight rules.
// Keys while it is open (teamFormKey, main.js): 1 2 3 the tabs, ↑ ↓ pick a person in the list, Space take or leave
// them, F the filter, S the sort, Enter Form team (or Done).
import { FOODS } from "../sim/foods.js"; // food by kind on the team form
import { foodTip } from "./food.js";
import { FOOD_PACK_KG } from "../sim/parties.js";
import { SUPPLIES, SKILL_NAMES, supWeight } from "../sim/data.js";
import { traitWords } from "./traitpick.js"; // "Tough II, Loud I"
import { survivorById, atBase, baseById, skill } from "../sim/world.js";
import { partyMembers, teamName, poolLoad, partyCapacity, STANCES } from "../sim/parties.js";
import { vehiclesAtBase, carsAtBase, bikesAtBase, isBike, isCar, partyVehicles, partyFleet, vehicleLabel, payloadOf, tank, upgradeText, vehicleById, VEHICLE_TYPES, MAX_VEHICLES, seatsOf, vehicleCapacity } from "../sim/vehicles.js";
import { SEATS } from "../sim/combat.js";
import { ROLES } from "../sim/economy.js";
import { wornLoad, maxLoad, teamLoad } from "../sim/load.js";
import { tiredLevel } from "../sim/sleep.js";
import { thirstAhead } from "../sim/weather.js";
import { stockHas, RAW } from "../sim/water.js";
import { parseLoc, itemAt, placeOfLoc, allCarried, quickMove, itemLoad } from "../sim/inventory.js";
import { packMags } from "../sim/carrykit.js";
import { packLights, hasLight } from "../sim/lights.js";
import { loadFromBase, dropOff, dropRounds } from "../sim/teaminv.js";
import { roundRoom, roundsHeld, ROUND_PLACES, PLACE_WORDS } from "../sim/supitems.js"; // rounds onto a named member: pockets, pack or rig, boxed or loose (2026-10-17)
import { isRoundKey } from "../sim/rounds.js";
import { formTeam, formPreview, editBase, editProblem, addMember, removeMember, setVehicles, toggleVehicle, setSupply, teamHas, gearSnapshot, gearChanged, restoreGear } from "../sim/teamform.js";
import { doll, storageBox, selBar, tile, INV_ACTIONS, invDrop } from "./inventory.js";
import { supplyIcon } from "./stackmove.js"; // a supply's own drawing (ui/itemart.js)
import { fleetPicker, toggleFleetIds } from "./fleetpick.js"; // the vehicle picker the planners share
import { loadWarnings, paceLine, carLine } from "./loadview.js";
import { statusIcons } from "./status.js";
import { sickRestWhy } from "../sim/sickrest.js"; // the sick rest at the base (the Fit filter, a warning when picked)
import { survivorURL, spriteImg } from "./sprites.js";
import { shortName } from "./names.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const n1 = (x) => Math.round((x || 0) * 10) / 10;
const first = (s) => esc(shortName(s));
const bar = (load, cap) => `<div class="bar"><i style="width:${Math.min(100, (load / Math.max(1, cap)) * 100)}%;background:${load > cap + 1e-6 ? "var(--danger)" : load > cap * 0.9 ? "var(--accent)" : "var(--info)"}"></i></div>`;

// ---------- the window's state ----------
const SKILLS = ["shooting", "melee", "scouting", "stealth", "medicine", "mechanics", "scavenging", "speech"];
const SKILL_SHORT = { shooting: "Sho", melee: "Mel", scouting: "Sco", stealth: "Ste", medicine: "Med", mechanics: "Mec", scavenging: "Scv", speech: "Spe" };
export const FILTERS = {
  all:     { name: "Everyone",   tip: "Everyone at the base", test: () => true },
  fit:     { name: "Fit",        tip: "Health 70 or more, not exhausted and not resting sick (Sick people rest, the Work tab)", test: (s, picked, state) => s.health >= 70 && tiredLevel(s) < 2 && !(state && sickRestWhy(state, s)) },
  armed:   { name: "Armed",      tip: "Holding a weapon", test: (s) => !!(s.gear && s.gear.weapon) },
  idle:    { name: "Not on the team", tip: "Only people not picked yet", test: (s, picked) => !picked },
};
export const SORTS = {
  name: { name: "Name", key: (s) => s.name },
  role: { name: "Role", key: (s) => (ROLES[s.role] ? ROLES[s.role].name : s.role || "") },
  health: { name: "Health", key: (s) => -s.health },
  tired: { name: "Rested first", key: (s) => s.tired || 0 },
  load: { name: "Lightest kit", key: (s) => wornLoad(s) },
  ...Object.fromEntries(SKILLS.map((k) => [k, { name: SKILL_NAMES[k] || k, key: (s) => -skill(s, k) }])),
};
const TABS = [["people", "1 People and vehicle"], ["gear", "2 Gear"], ["supplies", "3 Supplies and cargo"]];
const SUPPLY_ROWS = ["food", "water", "meds", "fuel", "ammo", "arrows", "parts", "scrap"]; // food: days of it (forming: packed as what keeps); the kinds below

const formOf = (ui) => (ui && ui.inv && ui.inv.form) || null;
const baseOf = (state, F) => (F ? baseById(state, F.baseId) : null);
const partyOf = (state, F) => (F && F.partyId != null ? state.parties.find((x) => x.id === F.partyId) || null : null);
const editing = (F) => !!F && F.partyId != null;

// The people in the list: at the base (and, editing, the team's people first).
function pool(state, F) {
  const b = baseOf(state, F);
  const p = partyOf(state, F);
  const here = b ? atBase(state, b.id) : [];
  return p ? [...partyMembers(state, p), ...here] : here;
}
const picked = (state, F, s) => (editing(F) ? (partyOf(state, F)?.members || []).includes(s.id) : F.crew.has(s.id));
function crewOf(state, F) {
  const p = partyOf(state, F);
  if (p) return partyMembers(state, p);
  return [...F.crew].map((id) => survivorById(state, id)).filter((s) => s && s.alive);
}
function listed(state, F) {
  const f = FILTERS[F.filter] || FILTERS.all;
  const S = SORTS[F.sort] || SORTS.name;
  const rows = pool(state, F).filter((s) => f.test(s, picked(state, F, s), state));
  return rows.sort((a, b) => {
    const ka = S.key(a), kb = S.key(b);
    return ka < kb ? -1 : ka > kb ? 1 : a.name < b.name ? -1 : 1;
  });
}

// ---------- ways in ----------
// The base screen and the tile panel: Form a team… (only with someone at the base).
export function formTeamButton(state, base, cls = "mini") {
  if (!base) return "";
  const n = atBase(state, base.id).length;
  return n ? `<button class="${cls}" data-action="tf-open" data-base="${base.id}"${tip(`Pick people at ${base.name}, up to four vehicles, what each of them wears and carries from its armory, and the team's supplies and cargo from its stores. They then stand outside the base as a team, waiting for your orders (move, scavenge, any order; Enter base brings them back in).`)}>Form a team…</button>` : "";
}
// The team panel, the tile panel and the Teams tab: Edit team… for a team that waits on one of your bases.
export function editTeamButton(state, p, cls = "mini") {
  const b = p ? editBase(state, p) : null;
  if (!b) return "";
  const why = editProblem(state, p);
  return `<button class="${cls}" data-action="tf-edit" data-id="${p.id}" ${why ? "disabled" : ""}${tip(why || `Change the team at ${b.name}: take on people from the base or send some back in, add or leave vehicles parked there (up to four), change their gear and the supplies and cargo it carries`)}>Edit team…</button>`;
}
// The right-click menu on one of your bases: Form a team here, and Edit for each team waiting on it.
export function formTeamCtx(state, tile) {
  const b = state.bases.find((x) => x.tile === tile);
  if (!b) return "";
  const n = atBase(state, b.id).length;
  const edits = state.parties.filter((p) => editBase(state, p) === b && !editProblem(state, p));
  return (n ? `<button data-action="tf-open" data-base="${b.id}" data-tip="Pick people, a vehicle, gear and supplies at ${esc(b.name)}: they stand outside as a team waiting for orders">Form a team at ${esc(b.name)}…</button>` : "") +
    edits.map((p) => `<button data-action="tf-edit" data-id="${p.id}" data-tip="Add or send back people, add or leave vehicles, change gear and supplies">Edit ${esc(teamName(state, p))}…</button>`).join("");
}

// ---------- the window ----------
export function teamFormModal(state, ui) {
  const F = formOf(ui);
  if (!F) return null;
  const b = baseOf(state, F);
  const p = partyOf(state, F);
  if (!b || (editing(F) && (!p || editBase(state, p) !== b))) {
    return `<div class="box"><h1>${editing(F) ? "Edit team" : "Form a team"}</h1><div class="text">${editing(F) ? "The team is no longer waiting on one of your bases." : "That base is no longer yours."}</div><div class="row"><button class="primary" data-action="tf-keep">Close</button></div></div>`;
  }
  const crew = crewOf(state, F);
  if (!crew.some((s) => s.id === ui.inv.sid)) ui.inv.sid = crew[0] ? crew[0].id : null;
  const where = b.type === "hub" ? `the hub (${b.name})` : b.name;
  const tabs = `<div class="invwho" style="margin:0.3rem 0 0.5rem">${TABS.map(([t, label]) => `<button class="mini ${F.tab === t ? "active" : ""}" data-action="tf-tab" data-tab="${t}"${tip(`${label.slice(2)} (key ${label[0]})`)}>${label}</button>`).join("")}</div>`;
  const body = F.tab === "gear" ? gearTab(state, ui, F, b, p, crew) : F.tab === "supplies" ? suppliesTab(state, ui, F, b, p, crew) : peopleTab(state, ui, F, b, p, crew);
  const sum = summary(state, F, b, p, crew);
  const msg = ui.invMsg ? `<div class="result small">${esc(ui.invMsg)}</div>` : "";
  const changed = gearChanged(state, F.snap);
  const undo = `<button data-action="tf-undo" ${changed ? "" : "disabled"}${tip(changed ? "Put every item, magazine and supply moved since this window opened back exactly where it was (people joining or leaving and the vehicles stay as they are)" : "Nothing moved yet")}>Undo changes</button>`;
  const foot = editing(F)
    ? `<div class="row" style="margin-top:0.8rem;justify-content:flex-end">${undo}<button class="primary" data-action="tf-close"${tip(changed ? "Close: you are asked whether to keep the gear changes (Enter or Esc)" : "Every change is already made (Enter or Esc)")}>Done</button></div>`
    : `<div class="row" style="margin-top:0.8rem;justify-content:flex-end">${undo}<button data-action="tf-close"${tip(changed ? "Close without forming a team: you are asked whether to keep the gear changes or put everything back (Esc)" : "Close without forming a team (Esc)")}>Cancel</button><button class="primary" data-action="tf-go" ${sum.problem ? "disabled" : ""}${tip(sum.problem || `They leave ${where}'s roster and stand outside as a team waiting for orders, with the gear they have on: its panel opens. (Enter)`)}>Form team (${crew.length})</button></div>`;
  // Closing with gear moved: keep it, or put it all back (the game's confirmation box).
  const asking = F.asking ? `<div class="askwrap"><div class="askbox" role="alertdialog"><div class="asktitle">Keep the gear changes?</div><div class="asktext">Items, magazines or supplies were moved while this window was open. Keep them where they are now, or put everything back exactly where it was?</div><div class="askbtns"><button class="primary" data-action="tf-keep" data-tip="Enter">Keep gear changes</button><button class="danger" data-action="tf-undoclose">Undo changes</button><button data-action="tf-back" data-tip="Esc">Back</button></div></div></div>` : "";
  return `<div class="box wide invbox loot">
    <div class="spread"><h1>${editing(F) ? `Edit ${esc(teamName(state, p))}` : `Form a team at ${esc(b.name)}`}</h1><span class="muted small">${editing(F) ? "changes apply at once" : `${atBase(state, b.id).length} people at ${esc(where)}`}</span></div>
    ${sum.html}
    ${tabs}
    ${msg}
    ${body}
    ${foot}
    ${asking}
  </div>`;
}

// The line at the top on every tab: who, how they travel, the weight against what they can carry, the warnings.
function summary(state, F, b, p, crew) {
  let load, cap, problem = "", pv = null;
  if (p) { load = poolLoad(p); cap = partyCapacity(state, p); pv = partyFleet(state, p); }
  else {
    const pre = formPreview(state, previewOpts(F));
    load = pre.load; cap = pre.cap; problem = pre.problem; pv = pre.v;
  }
  const v = pv; // one vehicle, or a fleet (sim/vehicles.js fleetOf: seats, payload and fuel together)
  const t = crew.length ? teamLoad(crew, load, pv || null) : null;
  const warn = [...loadWarnings(t)];
  if (crew.length && isCar(v) && !v.fleet && SEATS[v.type] && crew.length > SEATS[v.type]) warn.push(`${crew.length} people, ${SEATS[v.type]} seats in the ${v.name}: on a battle map only ${SEATS[v.type]} ride in it`);
  const cars = v ? (v.fleet ? v.fleet.filter(isCar) : isCar(v) ? [v] : []) : [];
  if (cars.length && !p && n0(v.fuel) + n0(F.supplies.fuel) < 6 * cars.length) warn.push(`Fuel: ${n0(v.fuel)} in the tank${cars.length > 1 ? "s" : ""}${F.supplies.fuel ? ` + ${n0(F.supplies.fuel)} in cans` : ""}: about ${Math.floor((n0(v.fuel) + n0(F.supplies.fuel)) / (0.6 * cars.length))} road tiles${cars.length > 1 ? ` for ${cars.length} cars` : ""}`);
  if (crew.some((s) => s.health < 50)) warn.push(`Hurt: ${crew.filter((s) => s.health < 50).map((s) => shortName(s)).join(", ")} (under 50 health)`);
  const sickOnes = crew.map((s) => [s, sickRestWhy(state, s)]).filter(([, w]) => w);
  if (sickOnes.length) warn.push(`Sick: ${sickOnes.map(([s, w]) => `${shortName(s)} (${w.slice(6)})`).join(", ")} (resting at the base until it is gone; they can still go)`);
  if (crew.some((s) => tiredLevel(s) >= 2)) warn.push(`Exhausted: ${crew.filter((s) => tiredLevel(s) >= 2).map((s) => shortName(s)).join(", ")} (they rest on the way only when they stop)`);
  const how = isBike(v) ? `on ${vehicleLabel(pv)}` : v ? `in the ${esc(vehicleLabel(v))}${v.fleet ? ` (${seatsOf(v)} seats)` : ""}` : "on foot";
  const html = `<div class="card small" style="margin-top:0.3rem">
    <div class="spread"><span><b>${crew.length ? crew.map(first).join(", ") : "Nobody picked yet"}</b> · ${how}</span>
      <span class="${load > cap + 1e-6 ? "danger" : "muted"}"${tip("The team's supplies and cargo against what it can carry on top of what its people wear: everyone's max load (40 kg, 28 with a Bad Back, more with a pack, a rig and Packrat) less what they wear, plus the bikes' racks (15 kg each) or the car's payload up to 125% (riders 80 kg each). Over it, the team cannot set off.")}>Load ${n1(load)} / ${n0(cap)} kg</span></div>
    ${bar(load, cap)}
    ${t ? `${paceLine(t)}${carLine(t, v && (v.fleet ? "the cars" : v.name))}` : ""}
    ${warn.length ? `<div class="warn">${warn.map(esc).join("<br>")}</div>` : ""}
    ${problem && crew.length ? `<div class="danger">${esc(problem)}</div>` : ""}
  </div>`;
  return { html, problem: problem || (p ? "" : crew.length ? "" : "Pick at least one person") };
}
const previewOpts = (F) => ({ baseId: F.baseId, memberIds: [...F.crew], vehicleIds: F.vehicleIds, supplies: F.supplies, cargo: F.cargo, rounds: (F.rounds || []).filter((r) => F.crew.has(r.sid)) }); // rounds onto a named member (sim/teamform.js formPreview)
// The rounds row's target while forming or editing (F.roundTo = { sid, where, loose }; sid null: the team's supplies):
// { who, where, loose } with who the member picked (on the crew) or null.
function roundTarget(state, F, crew) {
  const rt = F.roundTo || {};
  const who = rt.sid != null ? crew.find((s) => s.id === rt.sid) || null : null;
  return { who, where: who && ROUND_PLACES.includes(rt.where) ? rt.where : null, loose: !!rt.loose };
}
// The picks of rounds onto members while forming (F.rounds: [{ key, n, sid, where, loose }]): the one for this key and target.
const roundPick = (F, k, T) => (F.rounds || []).find((r) => r.key === k && r.sid === T.who.id && r.where === T.where && !!r.loose === T.loose) || null;
function setRoundPick(F, k, T, n) {
  F.rounds = F.rounds || [];
  const r = roundPick(F, k, T);
  n = Math.max(0, Math.floor(n));
  if (r) { if (n) r.n = n; else F.rounds.splice(F.rounds.indexOf(r), 1); }
  else if (n) F.rounds.push({ key: k, n, sid: T.who.id, where: T.where, loose: T.loose });
}
// Sets how many rounds of a key go onto the member picked (T), in that place and form. Forming: the pick, capped by the
// stores and the room on them. Editing a team at the base: the difference is loaded onto them (sim/teaminv.js
// loadFromBase with a person target) or dropped back into the stores (dropRounds). Returns the line to show.
function setRounds(state, F, p, k, T, want) {
  const b = baseOf(state, F);
  want = Math.max(0, Math.floor(want));
  if (p) {
    const have = roundsHeld(T.who, k, T.where, T.loose);
    if (want === have) return "";
    const r = want > have ? loadFromBase(state, p, { supplies: { [k]: want - have } }, { sid: T.who.id, where: T.where, loose: T.loose }) : dropRounds(state, p, { sid: T.who.id, key: k, n: have - want, where: T.where, loose: T.loose });
    return r.text;
  }
  const others = (F.supplies[k] || 0) + (F.rounds || []).filter((r) => r.key === k && !(r.sid === T.who.id && r.where === T.where && !!r.loose === T.loose)).reduce((a, r) => a + r.n, 0);
  const stock = b ? Math.max(0, Math.floor(stockHas(b.stock, k)) - others) : 0;
  const room = roundRoom(T.who, k, T.where, T.loose);
  const n = Math.min(want, stock, room.n);
  setRoundPick(F, k, T, n);
  return n < want ? (room.n < want && room.n <= stock ? room.why || `Only ${room.n} fit in ${shortName(T.who)}'s ${PLACE_WORDS[T.where]}.` : `Only ${stock} ${SUPPLIES[k].name.toLowerCase()} left at the base for that.`) : "";
}

// ---------- tab 1: people and the vehicle ----------
function peopleTab(state, ui, F, b, p, crew) {
  const rows = listed(state, F);
  if (F.cursor >= rows.length) F.cursor = Math.max(0, rows.length - 1);
  const head = `<div class="row" style="flex-wrap:wrap;gap:0.3rem;margin-bottom:0.3rem"><span class="small muted">Show</span>${Object.entries(FILTERS).map(([k, f]) => `<button class="mini ${F.filter === k ? "active" : ""}" data-action="tf-filter" data-v="${k}"${tip(`${f.tip} (F cycles)`)}>${f.name}</button>`).join("")}
    <span class="small muted" style="margin-left:0.6rem">Sort</span><select data-action="tf-sort"${tip("Order the list (S cycles)")}>${Object.entries(SORTS).map(([k, s]) => `<option value="${k}" ${F.sort === k ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></div>`;
  const th = `<tr><th></th><th>Name</th><th>Role</th><th${tip("Shooting · Scouting · Stealth · Medicine · Mechanics · Scavenging · Speech")}>Skills</th><th>Health</th><th${tip("Hours of sleep they owe: Tired at 8, Exhausted at 16 (aim and mood suffer)")}>Sleep</th><th>Gear</th><th${tip("What they wear and carry now, against their max load")}>Kit kg</th></tr>`;
  const tr = rows.map((s, i) => {
    const on = picked(state, F, s);
    const lv = tiredLevel(s);
    const g = s.gear || {};
    const gear = [g.weapon, g.armor, g.head, g.rig, g.backpack].filter(Boolean).map((x) => esc(x.name)).join(", ") || `<span class="muted">none</span>`;
    const worn = wornLoad(s), max = maxLoad(s);
    const cur = F.cursor === i ? "outline:2px solid var(--accent);" : "";
    const bg = on ? "background:var(--panel-2);" : "";
    const where = editing(F) ? (on ? "on the team: click to send them back into the base" : "at the base: click to add them to the team") : (on ? "picked: click to leave them" : "click to take them");
    return `<tr data-action="tf-crew" data-id="${s.id}" style="cursor:pointer;${bg}${cur}"${tip(`${s.name}, ${where}. ${ROLES[s.role] ? ROLES[s.role].name : s.role || ""}${s.traits && s.traits.length ? ` · traits: ${traitWords(s)}` : ""}`)}>
      <td><input type="checkbox" data-action="tf-crew" data-id="${s.id}" ${on ? "checked" : ""}></td>
      <td>${s.leader ? "★ " : ""}<b>${esc(s.name)}</b>${statusIcons(state, s)}</td>
      <td class="small">${esc(ROLES[s.role] ? ROLES[s.role].name : on && editing(F) ? "team" : s.role || "")}</td>
      <td class="small">${SKILLS.map((k) => { const v = skill(s, k); return `<span class="${v >= 8 ? "good" : v <= 2 ? "muted" : ""}">${SKILL_SHORT[k]} ${v}</span>`; }).join(" ")}</td>
      <td class="${s.health < 50 ? "danger" : s.health < 80 ? "warn" : ""}">${n0(s.health)}</td>
      <td class="small ${lv >= 2 ? "danger" : lv ? "warn" : "muted"}">${lv >= 2 ? "Exhausted" : lv ? "Tired" : "Rested"}</td>
      <td class="small">${gear}</td>
      <td class="small ${worn > max ? "danger" : ""}">${n1(worn)}/${max}</td></tr>`;
  }).join("");
  const table = `<div style="max-height:22rem;overflow-y:auto"><table class="t">${th}${tr || `<tr><td colspan="8" class="muted">Nobody here matches.</td></tr>`}</table></div>`;
  const stance = editing(F) ? "" : `<h3>Stance</h3><div class="row">${Object.entries(STANCES).map(([k, x]) => `<button class="mini ${F.stance === k ? "active" : ""}" data-action="tf-stance" data-v="${k}"${tip(x.desc)}>${x.name}</button>`).join("")}</div>`;
  return `${head}${table}<div class="grid2" style="margin-top:0.6rem"><div><h3>Vehicle</h3>${vehiclePick(state, F, b, p, crew)}</div><div>${stance}<h3>${editing(F) ? "On the map" : "After forming"}</h3><div class="small muted">The team stands on ${esc(b.name)}'s tile waiting for orders: Move (click a tile), any order on its panel, the team inventory, or Enter ${esc(b.name)} to bring everyone back in. ${editing(F) ? "" : "It is shown in the Teams tab and on the map, and its panel opens."}</div></div></div>`;
}

// Up to MAX_VEHICLES (sim/vehicles.js fleets): the planners' shared picker (ui/fleetpick.js).
function vehiclePick(state, F, b, p, crew) {
  const own = p ? partyVehicles(state, p) : [];
  return fleetPicker(state, { base: b, ids: p ? own.map((x) => x.id) : F.vehicleIds, crewN: crew.length, cans: p ? teamHas(p, "fuel") : F.supplies.fuel || 0, action: "tf-vehicle", own, party: p });
}

// ---------- tab 2: gear ----------
function gearTab(state, ui, F, b, p, crew) {
  if (!crew.length) return `<div class="muted">Pick people first (tab 1): then set what each of them wears and carries here.</div>`;
  const s = survivorById(state, ui.inv.sid) || crew[0];
  const who = `<div class="invwho">${crew.map((m) => `<button class="mini ${m.id === s.id ? "active" : ""}" data-action="tf-who" data-id="${m.id}"${tip(`${m.name}: wears ${n1(wornLoad(m))} of ${maxLoad(m)} kg`)}>${first(m)} <span class="muted">${n1(wornLoad(m))}kg</span></button>`).join("")}</div>`;
  const quick = `<div class="row small" style="flex-wrap:wrap;gap:0.25rem;margin:0.3rem 0">
    <button class="mini" data-action="tf-mags" data-id="${s.id}"${tip(`Spare magazines for ${shortName(s)}'s gun from the armory: rig pouches, pockets, then the pack (sim/carrykit.js). Forming the team does this for everyone anyway.`)}>Spare magazines</button>
    <button class="mini" data-action="tf-light" data-id="${s.id}" ${hasLight(s) ? "disabled" : ""}${tip(hasLight(s) ? `${shortName(s)} has a light` : `The lightest light in the armory that works for ${shortName(s)} (a headlamp anywhere, others in a free off hand): at night they see further in a fight or a raid, and are seen further off`)}>A light</button>
    <button class="mini" data-action="tf-mags-all"${tip("Spare magazines for everyone's guns from the armory")}>Magazines for all</button></div>`;
  const place = p ? `party:${p.id}` : `base:${b.id}`;
  const armory = storageBox(state, ui, `base:${b.id}`, s);
  const cargo = p ? `<div style="margin-top:0.6rem">${storageBox(state, ui, `party:${p.id}`, s)}</div>` : "";
  const html = `${who}${quick}<div class="invcols"><div class="invcol">${doll(state, ui, s, `s:${s.id}`, spriteImg(survivorURL(s, state.seed), 6), { user: s })}</div><div class="invcol">${armory}${cargo}</div></div>
    ${selBar(state, ui, placeOfLoc(state, parseLoc(ui.invSel || `s:${s.id}:weapon`)) || place)}
    <div class="small muted" style="margin-top:0.4rem">Click an item, then where it goes (a slot, pocket, pouch or pack cell, or the armory${p ? " or the cargo" : ""}), or drag it. Click it twice: off ${esc(shortName(s))} into ${p ? "the cargo" : "the armory"}, or from the armory onto ${esc(shortName(s))}. ${p ? "Between the team and the armory the team's carry limit counts." : "They are still at the base: what you change here is changed now."}</div>`;
  return html.replace(/data-action="inv-click"/g, 'data-action="tf-click"');
}

// ---------- tab 3: supplies and cargo ----------
function supplyKeys(state, F, b, p) {
  const keys = SUPPLY_ROWS.filter((k) => (SUPPLIES[k] || (k === "food" && !p)) && !(p && k === "ammo"));
  if (p && (b.stock[RAW] >= 1 || teamHas(p, RAW) >= 1)) keys.splice(keys.indexOf("water") + 1, 0, RAW);
  const rounds = Object.keys(SUPPLIES).filter((k) => SUPPLIES[k].round && ((b.stock[k] || 0) >= 1 || (p ? teamHas(p, k) : F.supplies[k] || 0) >= 1));
  rounds.sort((x, y) => SUPPLIES[x].name.localeCompare(SUPPLIES[y].name));
  const other = Object.keys(SUPPLIES).filter((k) => !FOODS[k] && !keys.includes(k) && !rounds.includes(k) && k !== RAW && !SUPPLIES[k].reload && !SUPPLIES[k].round && ((b.stock[k] || 0) >= 1 || (p ? teamHas(p, k) : F.supplies[k] || 0) >= 1));
  const foods = Object.keys(FOODS).filter((k) => (b.stock[k] || 0) >= 1 || (p ? teamHas(p, k) : F.supplies[k] || 0) >= 0.1); // sim/foods.js: each kind on its own
  return { keys, rounds, other, foods };
}
function suppliesTab(state, ui, F, b, p, crew) {
  const { keys, rounds, other, foods } = supplyKeys(state, F, b, p);
  const have = (k) => (p ? stockAt(b, k) : stockHas(b.stock, k));
  // Rounds by calibre go into the team's supplies, or (F.roundTo: a member, a place, boxed or loose) onto that member as
  // items: the row then counts what goes to them there (forming: the pick; editing: what they hold) and says the room.
  const T = roundTarget(state, F, crew);
  const onto = (k) => !!(T.who && T.where && isRoundKey(k));
  const row = (k) => {
    const pick = onto(k) ? (p ? null : roundPick(F, k, T)) : null;
    const take = onto(k) ? (p ? roundsHeld(T.who, k, T.where, T.loose) : pick ? pick.n : 0) : p ? teamHas(p, k) : F.supplies[k] || 0;
    const name = k === "ammo" ? "Rounds for their guns" : k === RAW ? "Un-purified water" : k === "food" ? "Food (days)" : SUPPLIES[k].name;
    const kgEach = k === "food" ? FOOD_PACK_KG : supWeight(k);
    const hint = k === "food" ? "Days of food for the road (2000 kcal a day): packed as what keeps longest and weighs least (ration bars, MREs, jerky, peanut butter before cans). Or pick kinds below." : FOODS[k] ? foodTip(k) : k === "ammo" ? "Any calibre: packed as the rounds that fit each person's gun (most for the gun they carry), from the stores. Or pick calibres below." : k === "water" ? (p ? "Purified water" : "Purified water first, then un-purified water (boil it at a camp fire, or tablets)") : k === "fuel" ? "Fuel cans: the tank is topped up from them when it runs dry" : onto(k) ? `${supWeight(k)} kg each, onto ${shortName(T.who)}'s ${PLACE_WORDS[T.where]} (${T.loose ? "loose" : "boxed"}): their own rounds` : `${supWeight(k)} kg each`;
    const room = onto(k) ? roundRoom(T.who, k, T.where, T.loose) : null;
    const roomCell = room ? `<td class="small ${room.n ? "muted" : "danger"}"${tip(room.why || `${room.n} more fit in ${shortName(T.who)}'s ${PLACE_WORDS[T.where]} now, within their max load`)}>${room.n ? `room ${room.n}` : "no room"} · ${n1(take * kgEach)} kg</td>` : `<td class="muted small">${n1(take * kgEach)} kg</td>`;
    return `<tr${tip(hint)}><td>${k === "food" ? "🥫" : supplyIcon(k)} ${esc(name)}${onto(k) ? ` <span class="muted">→ ${esc(shortName(T.who))}</span>` : ""}</td>
      <td><button class="mini" data-action="tf-sup" data-k="${k}" data-d="-5"${tip("5 fewer")}>−</button><input type="number" min="0" step="1" style="width:4.5em" data-action="tf-qty" data-k="${k}" value="${n1(take)}"><button class="mini" data-action="tf-sup" data-k="${k}" data-d="5"${tip("5 more")}>+</button></td>
      <td class="muted small">${n0(have(k))} at base</td>${roomCell}</tr>`;
  };
  const chip = (act, attrs, label, on, hint) => `<button class="mini ${on ? "active" : ""}" data-action="${act}" ${attrs}${tip(hint)}>${on ? "✓ " : ""}${label}</button>`;
  const roundsTo = !rounds.length ? "" : `<tr><td colspan="4"><div class="row small" style="gap:0.25rem;flex-wrap:wrap;align-items:center"><span class="muted"${tip("Where the rounds by calibre below go: the team's supplies (shared out, eaten first on the road), or onto one person as their own rounds in their pockets, pack or rig's admin pouch, boxed or loose. Their gun draws on their own rounds first in a fight; they go back into the stores with Drop off or when the team comes home.")}>Rounds go to:</span>
    ${chip("tf-roundto", `data-sid=""`, "Team supplies", !T.who, "The team's packed supplies, as before")}
    ${crew.map((s) => ROUND_PLACES.map((w) => chip("tf-roundto", `data-sid="${s.id}" data-where="${w}"`, `${esc(shortName(s))}: ${PLACE_WORDS[w]}`, !!(T.who && T.who.id === s.id && T.where === w), `Onto ${s.name.split(" ")[0]} as items in their ${PLACE_WORDS[w]} (wears ${n1(wornLoad(s))} of ${maxLoad(s)} kg)`)).join("")).join("")}
    ${T.who ? `${chip("tf-roundloose", `data-v="0"`, "boxed", !T.loose, "As boxes (up to five boxes a slot)")}${chip("tf-roundloose", `data-v="1"`, "loose", T.loose, "Loose (up to 80 rounds a slot; a handful in an admin pouch)")}<span class="muted"${tip("What they wear and carry on them against their max load")}>${esc(shortName(T.who))} wears ${n1(wornLoad(T.who))}/${maxLoad(T.who)} kg</span>` : ""}</div></td></tr>`;
  const table = `<table class="t small"><tr><th>Supply</th><th>${p ? "Carried" : "Take"}</th><th></th><th>Weight</th></tr>${keys.map(row).join("")}
    ${rounds.length ? `<tr><th colspan="4">Rounds by calibre</th></tr>${roundsTo}${rounds.map(row).join("")}` : ""}
    ${foods.length ? `<tr><th colspan="4"${tip("Food by kind (sim/foods.js): take a kind on its own")}>Food by kind</th></tr>${foods.map(row).join("")}` : ""}
    ${other.length ? `<tr><th colspan="4">Other stores</th></tr>${other.map(row).join("")}` : ""}</table>`;
  const auto = p ? "" : `<div class="row small" style="margin-top:0.4rem;gap:0.3rem"><button class="mini" data-action="tf-auto"${tip(`Food and water for ${F.days} days for everyone picked (with the season's thirst), 2 meds, rounds for their guns, fuel cans for a car; trimmed to what they can carry`)}>Auto-fill for</button><input type="number" min="1" max="30" style="width:3.5em" data-action="tf-days" value="${F.days}"> days <button class="mini" data-action="tf-clearsup"${tip("Take no supplies")}>Clear</button>
    <label${tip("A light each from the armory for those without one, when the team forms (the lightest that works for each)")}><input type="checkbox" data-action="tf-lights" ${F.lights ? "checked" : ""}> a light each</label></div>`;
  // Cargo: armory items to take along (forming: picked, moved on Form team; editing: loaded or dropped off at once).
  const tiles = (arr, act, hintFn) => arr.map(({ it, loc, on }) => `<div class="islot store${on ? " sel" : ""}" data-action="${act}" data-loc="${loc}"${tip(hintFn(it, on))}>${tile(it, loc, null, false)}</div>`).join("");
  const armory = b.armory.map((it, i) => ({ it, loc: `armory:${b.id}:list:${i}`, on: !p && F.cargo.includes(it) }));
  const cargoKg = p ? (p.cargo.gear || []).reduce((a, it) => a + itemLoad(it), 0) : F.cargo.reduce((a, it) => a + itemLoad(it), 0);
  const cargo = `<h3${tip(p ? "What rides in the vehicle (or is shared out among the people on foot): click an item to put it back in the armory" : "Click armory items to take them along in the team's cargo (tools, ammo boxes, spare kit, trade goods): they ride in the vehicle, or are shared out among the people on foot")}>Cargo (${n1(cargoKg)} kg)</h3>
    ${p ? `<div class="istore" style="min-height:2.5rem">${tiles((p.cargo.gear || []).map((it, i) => ({ it, loc: `cargo:${p.id}:list:${i}`, on: false })), "tf-uncargo", (it) => `${it.name}, ${n1(itemLoad(it))} kg: click to put it in the armory`) || `<span class="small muted">Empty.</span>`}</div>` : ""}
    <div class="small muted" style="margin-top:0.3rem">Armory (${b.armory.length}): click to ${p ? "load into the cargo" : "pick or leave"}</div>
    <div class="istore" style="max-height:16rem;overflow-y:auto">${tiles(armory, "tf-cargo", (it, on) => `${it.name}, ${n1(itemLoad(it))} kg${p ? ": click to load it into the team's cargo" : on ? ": picked for the cargo (click to leave it)" : ": click to take it in the cargo"}`) || `<span class="small muted">Empty.</span>`}</div>`;
  return `<div class="grid2"><div>${table}${auto}</div><div>${cargo}</div></div>`;
}
const stockAt = (b, k) => Math.max(0, b.stock[k] || 0);

// Auto-fill (forming): food and water for the days, meds, rounds, fuel cans; then trimmed to what they can carry.
function autoFill(state, F) {
  const b = baseById(state, F.baseId);
  const crew = [...F.crew].map((id) => survivorById(state, id)).filter(Boolean);
  if (!b || !crew.length) return;
  const n = crew.length, d = Math.max(1, F.days || 3);
  const v = formPreview(state, previewOpts(F)).v; // one vehicle or several (sim/vehicles.js fleets)
  const want = { food: n * d, water: Math.ceil(n * d * thirstAhead(state, d)), meds: Math.min(2, n), ammo: 15 * crew.filter((s) => s.gear && s.gear.weapon).length, fuel: isCar(v) ? Math.max(0, 10 * (v.fleet ? v.fleet.filter(isCar).length : 1) - Math.floor(v.fuel / 3)) : 0 };
  for (const k of ["preserved", "arrows", "parts", "scrap"]) delete F.supplies[k];
  for (const [k, q] of Object.entries(want)) F.supplies[k] = Math.max(0, Math.min(Math.floor(stockHas(b.stock, k)), q));
  // Too heavy: less ammo, fewer meds, then less food and water, down to a day.
  for (const [k, floor] of [["ammo", 5 * n], ["meds", 1], ["fuel", 0], ["food", n], ["water", n]]) {
    const pre = formPreview(state, previewOpts(F));
    const over = pre.load - pre.cap;
    if (over > 0 && F.supplies[k]) F.supplies[k] = Math.max(Math.min(F.supplies[k], floor), F.supplies[k] - Math.ceil(over / (SUPPLIES[k] ? SUPPLIES[k].weight : FOOD_PACK_KG)));
  }
}

// ---------- clicks between the team and the armory (editing) ----------
// Within one place (a person and the armory at the base while forming; a member, another member and the cargo while
// editing) it is the inventory's own click. Between the team and the base's armory: load or drop off.
function crossMove(state, ui, from, to) {
  const F = formOf(ui);
  const p = partyOf(state, F);
  if (!p) return null;
  const A = parseLoc(from), B = parseLoc(to);
  const pa = placeOfLoc(state, A), pb = placeOfLoc(state, B);
  if (!pa || !pb || pa === pb) return null;
  if (A.o === "armory") {
    const target = B.o === "s" ? B.id : B.o === "cargo" ? "cargo" : null;
    if (target == null) return "Put it on someone on the team, or in the cargo.";
    return loadFromBase(state, p, { items: [from] }, target).text;
  }
  if (B.o === "armory") return dropOff(state, p, { items: [from] }).text;
  return "Between the team and the base, things go through the armory.";
}
export function teamFormDrop(state, ui, from, to) {
  const m = crossMove(state, ui, from, to);
  if (m != null) { ui.invMsg = m; ui.invSel = null; return; }
  invDrop(state, ui, from, to); // within one place: the inventory's own drop (moveItem)
}

// Spare magazines or a light for people (forming: straight from the armory; editing: the team's carry limit counts,
// and what would take it over goes back).
function kitFor(state, ui, people, what) {
  const F = formOf(ui);
  const b = baseOf(state, F);
  const p = partyOf(state, F);
  if (!b) return;
  const before = new Map(people.map((s) => [s, new Set(allCarried(s))]));
  const got = what === "light" ? packLights(b, people) : packMags(b.armory, people);
  if (p && poolLoad(p) > partyCapacity(state, p) + 1e-6) {
    for (const s of people) for (const it of allCarried(s)) if (!before.get(s).has(it)) dropOff(state, p, { items: [it] });
    ui.invMsg = "No room: the team could not carry its load as well.";
    return;
  }
  ui.invMsg = got.length ? `From the armory: ${got.join(", ")}.` : what === "light" ? "No light in the armory that works for them." : "No spare magazines in the armory for their guns (or nowhere to put them).";
}

// ---------- actions (wired in main.js) ----------
const fresh = (baseId, partyId = null) => ({ baseId, partyId, crew: new Set(), vehicleIds: [], supplies: {}, cargo: [], rounds: [], roundTo: { sid: null, where: "pocket", loose: false }, tab: "people", filter: "all", sort: "name", cursor: 0, stance: "normal", lights: true, days: 3 }); // rounds / roundTo: rounds onto a named member (sim/teamform.js formPreview opts.rounds)
function open(state, ui, F, sid = null) {
  const b = baseById(state, F.baseId);
  const p = F.partyId != null ? state.parties.find((x) => x.id === F.partyId) || null : null;
  F.snap = b ? gearSnapshot(state, b, p) : null; // keep or undo the gear changes made in here (sim/teamform.js)
  F.asking = false;
  ui.inv = { sid, form: F, loot: false };
  ui.invSel = null;
  ui.invMsg = "";
}
export const TEAMFORM_ACTIONS = {
  "tf-open": (state, ui, d) => { const b = baseById(state, Number(d.base)); if (b) { open(state, ui, fresh(b.id)); ui.baseView = null; } },
  // Closing (Cancel, Done, Esc): with gear moved, asked first whether to keep it.
  "tf-close": (state, ui) => { const F = formOf(ui); if (!F) return; if (gearChanged(state, F.snap)) { F.asking = true; return; } shut(ui); },
  "tf-keep": (state, ui) => shut(ui),
  "tf-undoclose": (state, ui) => { const F = formOf(ui); if (F) restoreGear(state, F.snap); shut(ui); },
  "tf-back": (state, ui) => { const F = formOf(ui); if (F) F.asking = false; },
  "tf-undo": (state, ui) => { const F = formOf(ui); if (!F) return; ui.invMsg = restoreGear(state, F.snap); ui.invSel = null; },
  "tf-edit": (state, ui, d) => {
    const p = state.parties.find((x) => x.id === Number(d.id));
    const b = p ? editBase(state, p) : null;
    if (!b) return;
    open(state, ui, fresh(b.id, p.id), partyMembers(state, p)[0]?.id ?? null);
    ui.baseView = null;
  },
  "tf-tab": (state, ui, d) => { const F = formOf(ui); if (F) { F.tab = d.tab; ui.invSel = null; ui.invMsg = ""; } },
  "tf-filter": (state, ui, d) => { const F = formOf(ui); if (F) { F.filter = d.v; F.cursor = 0; } },
  "tf-crew": (state, ui, d) => {
    const F = formOf(ui);
    if (!F) return;
    const id = Number(d.id);
    const s = survivorById(state, id);
    if (!s) return;
    const rows = listed(state, F);
    const i = rows.indexOf(s);
    if (i >= 0) F.cursor = i;
    const p = partyOf(state, F);
    if (p) { ui.invMsg = p.members.includes(id) ? removeMember(state, p, id) : addMember(state, p, id); return; }
    if (F.crew.has(id)) F.crew.delete(id); else F.crew.add(id);
    if (!ui.inv.sid || !F.crew.has(ui.inv.sid)) ui.inv.sid = F.crew.size ? [...F.crew][0] : null;
    ui.invMsg = "";
  },
  "tf-vehicle": (state, ui, d) => {
    const F = formOf(ui);
    if (!F) return;
    const id = d.v ? Number(d.v) : null;
    const p = partyOf(state, F);
    if (p) { ui.invMsg = id == null ? setVehicles(state, p, []) : toggleVehicle(state, p, id); return; }
    const r = toggleFleetIds(state, F.vehicleIds, id); // ui/fleetpick.js
    F.vehicleIds = r.ids;
    if (r.msg) ui.invMsg = r.msg;
  },
  "tf-stance": (state, ui, d) => { const F = formOf(ui); if (F && STANCES[d.v]) F.stance = d.v; },
  "tf-who": (state, ui, d) => { if (ui.inv) { ui.inv.sid = Number(d.id); ui.invSel = null; } },
  "tf-click": (state, ui, d, ev) => {
    if (!ui.inv) return;
    const sel = ui.invSel;
    const L = parseLoc(d.loc);
    if (sel && sel !== d.loc) {
      const m = crossMove(state, ui, sel, (L.o === "armory" || L.o === "cargo") ? `${L.o}:${L.id}:list` : d.loc);
      if (m != null) { ui.invMsg = m; ui.invSel = null; return; }
    }
    if (sel && sel === d.loc) {
      // Twice on an armory item while editing: onto the person shown.
      const p = partyOf(state, formOf(ui));
      if (p && L.o === "armory" && p.members.includes(ui.inv.sid)) { ui.invMsg = loadFromBase(state, p, { items: [sel] }, ui.inv.sid).text; ui.invSel = null; return; }
      if (!p && L.o === "armory") { ui.invMsg = quickMove(state, sel, ui.inv.sid); ui.invSel = null; return; }
    }
    INV_ACTIONS["inv-click"](state, ui, d, ev);
  },
  "tf-mags": (state, ui, d) => { const s = survivorById(state, Number(d.id)); if (s) kitFor(state, ui, [s], "mags"); },
  "tf-mags-all": (state, ui) => { const F = formOf(ui); if (F) kitFor(state, ui, crewOf(state, F), "mags"); },
  "tf-light": (state, ui, d) => { const s = survivorById(state, Number(d.id)); if (s) kitFor(state, ui, [s], "light"); },
  "tf-sup": (state, ui, d) => {
    const F = formOf(ui);
    if (!F) return;
    const k = d.k, delta = Number(d.d) || 0;
    const p = partyOf(state, F);
    const T = roundTarget(state, F, crewOf(state, F));
    if (T.who && T.where && isRoundKey(k)) { ui.invMsg = setRounds(state, F, p, k, T, (p ? roundsHeld(T.who, k, T.where, T.loose) : (roundPick(F, k, T) || { n: 0 }).n) + delta); return; }
    if (p) { ui.invMsg = setSupply(state, p, k, Math.max(0, teamHas(p, k) + delta)); return; }
    const b = baseOf(state, F);
    F.supplies[k] = Math.max(0, Math.min(Math.floor(stockHas(b.stock, k)), (F.supplies[k] || 0) + delta));
  },
  // Rounds by calibre onto a member (sim/supitems.js): the member and the place, boxed or loose.
  "tf-roundto": (state, ui, d) => { const F = formOf(ui); if (!F) return; F.roundTo = { ...(F.roundTo || { loose: false }), sid: d.sid ? Number(d.sid) : null, where: ROUND_PLACES.includes(d.where) ? d.where : "pocket" }; },
  "tf-roundloose": (state, ui, d) => { const F = formOf(ui); if (F) F.roundTo = { ...(F.roundTo || { sid: null, where: "pocket" }), loose: d.v === "1" }; },
  "tf-auto": (state, ui) => { const F = formOf(ui); if (F && !editing(F)) autoFill(state, F); },
  "tf-clearsup": (state, ui) => { const F = formOf(ui); if (F && !editing(F)) { F.supplies = {}; F.rounds = []; } },
  "tf-lights": (state, ui) => { const F = formOf(ui); if (F) F.lights = !F.lights; },
  "tf-cargo": (state, ui, d) => {
    const F = formOf(ui);
    const b = baseOf(state, F);
    if (!F || !b) return;
    const it = itemAt(state, d.loc);
    if (!it) return;
    const p = partyOf(state, F);
    if (p) { ui.invMsg = loadFromBase(state, p, { items: [it] }, "cargo").text; return; }
    const i = F.cargo.indexOf(it);
    if (i >= 0) F.cargo.splice(i, 1); else F.cargo.push(it);
  },
  "tf-uncargo": (state, ui, d) => {
    const p = partyOf(state, formOf(ui));
    const it = p ? itemAt(state, d.loc) : null;
    if (it) ui.invMsg = dropOff(state, p, { items: [it] }).text;
  },
  "tf-go": (state, ui) => {
    const F = formOf(ui);
    if (!F) return;
    if (editing(F)) { TEAMFORM_ACTIONS["tf-close"](state, ui, {}); return; }
    F.cargo = F.cargo.filter((it) => (baseOf(state, F) || { armory: [] }).armory.includes(it));
    const r = formTeam(state, { ...previewOpts(F), stance: F.stance, lights: F.lights });
    if (r.error) { ui.invMsg = r.error; return; }
    ui.inv = null; ui.invSel = null; ui.invMsg = "";
    ui.baseView = null;
    ui.expedition = r.party.id; // its panel (ui/teamsel.js treats the open panel's team as selected)
    ui.xpMsg = r.notes && r.notes.length ? r.notes.join(" ") : "";
  },
};
// Typed in or picked from a list.
export const TEAMFORM_CHANGE = {
  "tf-sort": (state, ui, el) => { const F = formOf(ui); if (F && SORTS[el.value]) { F.sort = el.value; F.cursor = 0; } },
  "tf-days": (state, ui, el) => { const F = formOf(ui); if (F) F.days = Math.max(1, Math.min(30, Math.floor(Number(el.value) || 3))); },
  "tf-qty": (state, ui, el) => {
    const F = formOf(ui);
    if (!F) return;
    const k = el.dataset.k, q = Math.max(0, Number(el.value) || 0);
    const p = partyOf(state, F);
    const T = roundTarget(state, F, crewOf(state, F));
    if (T.who && T.where && isRoundKey(k)) { ui.invMsg = setRounds(state, F, p, k, T, q); return; } // onto the member picked
    if (p) { ui.invMsg = setSupply(state, p, k, q); return; }
    const b = baseOf(state, F);
    F.supplies[k] = Math.max(0, Math.min(Math.floor(stockHas(b.stock, k)), Math.floor(q)));
  },
};

// Keys while the window is open (main.js keydown, before the inventory takes the keyboard). True when used.
export function teamFormKey(state, ui, e) {
  const F = formOf(ui);
  if (!F) return false;
  const k = e.key;
  if (k === "1" || k === "2" || k === "3") { F.tab = TABS[Number(k) - 1][0]; ui.invSel = null; ui.invMsg = ""; return true; }
  if (F.asking) { if (k === "Enter") TEAMFORM_ACTIONS["tf-keep"](state, ui, {}); return true; } // the question takes the keys (Esc: teamFormEsc)
  if (k === "Enter") { TEAMFORM_ACTIONS["tf-go"](state, ui, {}); return true; }
  if (F.tab !== "people") return false;
  const rows = listed(state, F);
  if (k === "ArrowDown") { F.cursor = Math.min(rows.length - 1, (F.cursor || 0) + 1); return true; }
  if (k === "ArrowUp") { F.cursor = Math.max(0, (F.cursor || 0) - 1); return true; }
  if (k === " " && rows[F.cursor]) { TEAMFORM_ACTIONS["tf-crew"](state, ui, { id: rows[F.cursor].id }); return true; }
  if (k === "f" || k === "F") { const ks = Object.keys(FILTERS); F.filter = ks[(ks.indexOf(F.filter) + 1) % ks.length]; F.cursor = 0; return true; }
  if (k === "s" || k === "S") { const ks = Object.keys(SORTS); F.sort = ks[(ks.indexOf(F.sort) + 1) % ks.length]; F.cursor = 0; return true; }
  return false;
}
// The Teams tab's first line: Form a team… at each of your bases with someone there.
export function formTeamRow(state) {
  const btns = state.bases.filter((b) => atBase(state, b.id).length).map((b) => formTeamButton(state, b).replace(">Form a team…<", `>Form a team at ${esc(b.name)}…<`));
  return btns.length ? `<div class="row" style="flex-wrap:wrap;gap:0.3rem;margin-bottom:0.5rem">${btns.join("")}</div>` : "";
}

const shut = (ui) => { ui.inv = null; ui.invSel = null; ui.invMsg = ""; };
// Esc while the window is open (main.js closeTopLayer, before the inventory's own Esc): drops a selected item, backs out
// of the question, or closes (asking first when gear was moved). Always true: the window took it.
export function teamFormEsc(state, ui) {
  const F = formOf(ui);
  if (!F) return false;
  if (ui.invSel) { ui.invSel = null; return true; }
  if (F.asking) { F.asking = false; return true; }
  TEAMFORM_ACTIONS["tf-close"](state, ui, {});
  return true;
}
