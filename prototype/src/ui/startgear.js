// Starting gear on the new-run screen (2026-10-08, user requests; sim/startgear.js has the rules, sim/custompoints.js the
// prices): with Customize ticked (not with Ironman) each crew card shows the colonist's load, their points and a Gear…
// button, which opens this window: every worn and held slot picked from the catalogue (or nothing), what they carry put
// by hand into each pocket, pouch and pack slot (click a thing, then where it goes; Add puts a new one in the cell
// picked, else where it first fits; what does not fit is refused with the reason). Every change to what they wear or
// carry builds the world again on the same seed (main.js gearRebuild), so what the window shows is what they start with.
// The starting vehicles (2026-10-24, user request; sim/startfleet.js): the new-run screen's Starting vehicles section
// (fleetSection, every mode, Customize ticked or not; read-only in Ironman) and each vehicle's back window (fleetEditor:
// Edit…), the back priced against that vehicle's own point limit, on nobody's points (the car pool is gone). Their
// actions return "fleet" (main.js gearRebuild: the world again with ui.fleet, the crew as it stands).
// HTML builders plus their action handlers; main.js registers them (an action returning true asks for the rebuild).
import { GEAR, SUPPLIES } from "../sim/data.js";
import { POUCH_NAMES } from "../sim/data-kit.js";
import { isHardcore } from "../sim/hardcore.js";
import { itemLoad } from "../sim/inventory.js";
import { LOAD_BANDS, wornLoad } from "../sim/load.js";
import { VEHICLE_TYPES, RIDER_KG } from "../sim/vehicles.js";
import {
  START_GEAR, START_TRUNK, OPEN_TRUNK, CARRY_PLACES, slotChoices, carryChoices, trunkChoices, sanitizeStartGear, sanitizeStartVehicle, hasPicks, kitLoad, carrySpec,
  carryReason, firstFit, misfits, trunkKg, noteDiceKit, gunInfo, gunWith, sanitizeGunMods, pickKey, pickMods, pickN, pickStackMax, openSupplyKeys,
} from "../sim/startgear.js";
import { itemPoints, slotPoints, gunPoints, loosePoints, pickPoints, pricePerson, pointsMax, vehiclePoints, suppliesPoints } from "../sim/custompoints.js";
import { START_FLEET, fleetKinds, cleanFleet, resizeFleet, clampLimit, clampFleetCount, fleetMode, fleetEntry, fleetVehicle, fleetRoom, fleetName, openLoads } from "../sim/startfleet.js"; // the starting vehicles (2026-10-24)
import { startsWithVehicle } from "../sim/custommode.js";
import { ATTACH, SLOT_NAMES as GUN_SLOT_NAMES, slotsOf, modsFor, fitsSlot, makeMod, takesMods, stripMod } from "../sim/gunmods.js"; // a picked gun's parts
import { tidyTiers } from "../sim/traits.js";
import { standardMag } from "../sim/mags.js";
import { ROUND_SUPPLIES, HAND_SUPPLIES, CALIBERS } from "../sim/data-ammo.js"; // the back's rounds, by calibre and type
import { gunCals } from "../sim/ammo.js";
import { randomKit, randomTrunk, randomBuild, kitBudget } from "../sim/randomkit.js"; // the dice under Customize: a new draw each time, within the points
import { freshRng } from "../sim/appearance.js";
import { gunIconHtml } from "./gunart.js"; // the picked gun as it comes (its picture by its line)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const freeEdit = (ui) => !!ui.freeEdit && !ui.ironman; // Customize, as ui/newgame.js
const SLOT_LABELS = { weapon: "Hands", tool: "Off hand", armor: "Body", head: "Head", ears: "Ear pro", arms: "Arms", legs: "Legs", rig: "Rig", backpack: "Bag" };
const SLOT_TIPS = {
  weapon: "The weapon in their hands (a gun comes with a full load and two more of its rounds, in the price)",
  tool: "The off hand: a light, a radio, a medical kit, night vision…",
  armor: "Body armour (a vest or carrier with pouches takes magazines and meds itself)",
  head: "A helmet or a hat",
  ears: "Ear protection: earplugs, muffs, electronic defenders, a team headset (only what is worn here protects the ears; no muffs under a full-shell helmet)",
  arms: "Arm guards", legs: "Leg guards",
  rig: "A chest rig: pouches for magazines, grenades, a radio and small things (not over a vest that has pouches of its own)",
  backpack: "A bag: pack slots and more weight they can carry",
};
// Item categories as the pickers group them (anything else after these, by its own name).
const CATS = [
  ["melee", "Melee"], ["pistol", "Pistols"], ["shotgun", "Shotguns"], ["rifle", "Rifles"], ["automatic", "Automatic weapons"], ["bow", "Bows and crossbows"],
  ["explosive", "Launchers, grenades and throwables"], ["armor", "Armour"], ["packs", "Packs and rigs"], ["medical", "Medical"], ["tools", "Tools"],
  ["electronics", "Electronics"], ["optics", "Optics"], ["ammo", "Ammunition (boxes)"], ["gunmod", "Magazines and gun parts"], ["camp", "Camp"],
  ["manuals", "Manuals"], ["books", "Books"], ["containers", "Cases"], ["defence", "Defences"],
];
const CAT_NAME = Object.fromEntries(CATS);
const catOrder = (c) => { const i = CATS.findIndex(([k]) => k === c); return i < 0 ? CATS.length : i; };
const kg = (k) => GEAR[k].weight ?? 1;
const r1 = (v) => Math.round(v * 10) / 10;
const kgText = (k) => `${kg(k)} kg${GEAR[k].inserts ? " + plates" : ""}`; // a plate carrier's plates come with it
const shortDesc = (k) => { const d = GEAR[k].desc || ""; const one = d.split(/(?<=\.)\s/)[0]; return one.length > 110 ? `${one.slice(0, 107)}…` : one; };
const SUP_LABELS = { food: "Food", water: "Water", fuel: "Fuel", meds: "Meds", ammo: "Ammo", arrows: "Arrows", scrap: "Scrap", parts: "Parts" };

// The catalogue as a select: grouped by category, each with its weight and points; its description on hover.
// A gun's calibre and capacity in a picker ("9mm · 15 rds"), and its sentence for the hover text.
const gunBit = (k) => { const g = gunInfo(k); return g ? ` · ${g.text}` : ""; };
const gunLong = (k, item = null) => { const g = gunInfo(k, item); return g ? ` ${g.long}` : ""; };
function optionsHtml(keys, current, price = (k) => itemPoints(k)) {
  const groups = {};
  for (const k of keys) (groups[GEAR[k].cat || "other"] = groups[GEAR[k].cat || "other"] || []).push(k);
  return Object.keys(groups).sort((a, b) => catOrder(a) - catOrder(b) || a.localeCompare(b)).map((c) => {
    const list = groups[c].sort((a, b) => GEAR[a].name.localeCompare(GEAR[b].name));
    return `<optgroup label="${esc(CAT_NAME[c] || c.replace(/^./, (x) => x.toUpperCase()))}">${list.map((k) => `<option value="${k}" ${k === current ? "selected" : ""} title="${esc((GEAR[k].desc || "") + gunLong(k))}">${esc(GEAR[k].name)}${gunBit(k)} · ${kgText(k)} · ${price(k)} pts</option>`).join("")}</optgroup>`;
  }).join("");
}

// ---------- the points bar (the crew card and this window) ----------
// What the points went on, in words (the gear window shows it under the bar: a dice-loaded colonist's skills can be most of it).
export function pointsSplit(state, s) {
  const B = pricePerson(state, s);
  const parts = [["Skills", B.skills], ["Traits", B.good + B.back], ["Kit", B.gear + B.carried], ["Background's own", B.extra]];
  return `<div class="small muted">${parts.filter(([, v], i) => v || i < 3).map(([n, v]) => `${n} ${v < 0 ? "−" : ""}${Math.abs(v)}`).join(" · ")}</div>`;
}
export function pointsBar(state, s) {
  const B = pricePerson(state, s);
  const pct = Math.min(100, Math.round((B.total / Math.max(1, B.max)) * 100));
  const over = B.over > 0;
  const t = `${s.name}'s customization points: ${B.total} of ${B.max} spent. ${B.lines.join(" · ")}. Skill levels cost 1 each up to 10, 2 up to 15, 3 up to 20; good traits cost points by tier, bad ones give points back (at most ${B.cap}); every thing worn, held or carried costs what it is worth (the starting vehicles' backs have point limits of their own: Starting vehicles).${over ? " Over the max: Start is refused until it is back under." : ""}`;
  return `<div class="ptsbar ${over ? "over" : ""}"${tip(t)}><div class="spread small"><span>Points <b>${B.total}</b> / ${B.max}</span><span class="ptsleft">${over ? `${B.over} over` : `${B.left} left`}</span></div><div class="bar"><i style="width:${pct}%;background:${over ? "var(--danger)" : "var(--good)"}"></i></div></div>`;
}

// ---------- the crew card's row ----------
const BAND_CLASS = ["", "warn", "warn", "danger"];
const bandsTip = `Load bands by felt weight: ${LOAD_BANDS.map((b) => (Number.isFinite(b.upTo) ? `${b.name} up to ${b.upTo} kg` : `${b.name} above`)).join(", ")}. Heavier is slower and hungrier on the road and slower in a fight. On a trip the team's supplies are shared out on top.`;
export function loadText(s) {
  const L = kitLoad(s);
  return `<span class="small ${BAND_CLASS[L.band]}"${tip(`Their own kit: ${L.kg} kg of the ${L.max} kg they can carry. ${bandsTip}`)}>${L.kg} / ${L.max} kg · ${L.name}</span>`;
}
export function gearRow(state, s) {
  const B = pricePerson(state, s);
  const kit = B.gear + B.carried;
  return `<div class="row" style="margin-top:0.3rem;gap:0.35rem">
    <button class="mini" data-action="sg-open" data-id="${s.id}"${tip("Pick what they wear and hold, and put what they carry in each pocket, pouch and pack slot. Each thing costs points. (The vehicles' backs: Starting vehicles, each with its own point limit.)")}>🎒 Gear…</button>
    ${loadText(s)} <span class="small muted"${tip("What their kit costs (worn, held and carried)")}>kit ${kit} pts</span></div>`;
}
// How many of the next thing (the gear window's × box, qty; a vehicle's back window's, tqty): 1 up to QTY_MAX.
const QTY_MAX = 99;
const qtyHolder = (ui, k) => (k === "tqty" ? ui.fleetEdit : ui.gearEdit);
const qtyOf = (ui, k) => Math.max(1, Math.min(QTY_MAX, Math.round(Number(qtyHolder(ui, k) && qtyHolder(ui, k)[k]) || 1)));
const qtyBox = (ui, k, max, t) => `<label class="small"${tip(t)}>× <input type="number" min="1" max="${Math.max(1, max)}" step="1" style="width:3.4rem" data-action="sg-qty" data-k="${k}" value="${Math.min(qtyOf(ui, k), Math.max(1, max))}"></label>`;

// ---------- the starting vehicles (sim/startfleet.js) ----------
// The fleet as the new-run screen sets it (main.js ui.fleet: [{ type, limit, load }], each mode its own), from the world's
// when the screen has none for it yet (the tools, a fresh screen).
export function uiFleet(state, ui) {
  const mode = fleetMode(state), live = (state && state.fleet) || [];
  if (!Array.isArray(ui.fleet) || ui.fleet.length !== live.length) ui.fleet = cleanFleet(live.map((f) => ({ type: f.type, limit: f.limit, load: f.load })), mode);
  return ui.fleet;
}
// One vehicle as the screen shows it: { v, type, name, label, room (kg), hard, open, limit, load (null: as rolled) }.
export function fleetInfo(state, i) {
  const f = fleetEntry(state, i), v = fleetVehicle(state, i);
  if (!f || !v || !VEHICLE_TYPES[v.type]) return null;
  return { v, type: v.type, name: VEHICLE_TYPES[v.type].name, label: fleetName(state, i), room: fleetRoom(state, i), hard: isHardcore(state), open: openLoads(state), limit: f.limit, load: f.load };
}
// The first starting vehicle (Hardcore: the car the team flees in; a normal start: the hub's pickup): { v, type, name,
// room (kg), hard }, as before the fleet (the tools read it).
export const startVehicleInfo = (state) => fleetInfo(state, 0);
// What the dice put in Hardcore's car (its owner's s.diceTrunk, noted by hardcore-start.js rollCar), as a load; a normal
// start's vehicles come empty.
const diceLoad = (state) => { const d = (state.survivors || []).find((s) => s.diceTrunk); return d ? d.diceTrunk : null; };
// The back shown for vehicle i: its load, or as rolled (Hardcore: the dice's; else empty).
const shownLoad = (state, i) => { const f = fleetEntry(state, i); return (f && f.load) || (isHardcore(state) && diceLoad(state)) || { items: [], supplies: {} }; };
// A back in a few words: "3 things, 40 food, 20 meds, 60 rounds" ("empty").
const supLabel = (k) => SUP_LABELS[k] || (SUPPLIES[k] ? SUPPLIES[k].name : k);
export function loadWords(V) {
  if (!V) return "empty";
  const n = (V.items || []).reduce((a, e) => a + pickN(e), 0);
  const rounds = Object.entries(V.supplies || {}).reduce((a, [k, q]) => a + (ROUND_SUPPLIES[k] ? q : 0), 0);
  const sups = Object.entries(V.supplies || {}).filter(([k]) => !ROUND_SUPPLIES[k]).map(([k, q]) => `${q} ${supLabel(k).toLowerCase()}`);
  const out = [...(n ? [`${n} thing${n === 1 ? "" : "s"}`] : []), ...sups.slice(0, 4), ...(sups.length > 4 ? [`${sups.length - 4} more supplies`] : []), ...(rounds ? [`${rounds} rounds`] : [])];
  return out.length ? out.join(", ") : "empty";
}

// The new-run screen's Starting vehicles (2026-10-24, user request), shown while Start with a vehicle is on, every mode:
// a row each with its name (Custom: its kind), its Point limit, the points its back takes (n / limit) and its weight
// (kg / room), 🎲 Random (filled to the limit in the room there is), Edit… (the back's window), Empty and, in Hardcore,
// As rolled. Custom: how many (Vehicles). Ironman: the backs as rolled, read-only.
export function fleetSection(state, ui) {
  if (!startsWithVehicle(state) || !(state.fleet || []).length) return "";
  const mode = fleetMode(state), iron = !!ui.ironman, locked = iron || !!ui.started;
  const dis = locked ? " disabled" : "";
  const rows = state.fleet.map((f, i) => {
    const info = fleetInfo(state, i);
    if (!info) return "";
    const V = shownLoad(state, i), rolled = !f.load;
    const pts = rolled ? 0 : vehiclePoints(f.load), kg = trunkKg(V);
    const over = pts > f.limit, heavy = kg > info.room + 1e-9;
    const pct = Math.min(100, Math.round((pts / Math.max(1, f.limit)) * 100));
    const kind = mode === "custom"
      ? `<label${tip("This vehicle's kind (every motor vehicle; no bicycles). It parks at the hub with a part-full tank. Changing it builds the world again on the same seed")}>Vehicle ${i + 1} <select data-action="fleet-kind" data-i="${i}">${fleetKinds().map((k) => `<option value="${k}" ${k === info.type ? "selected" : ""}>${esc(VEHICLE_TYPES[k].name)} (${VEHICLE_TYPES[k].payload} kg)</option>`).join("")}</select></label>`
      : `<b${tip(info.hard ? "The car the team flees in: its kind goes with whose it was (who they were)" : "The hub's pickup truck: what is in its back is unloaded into the hub's armory and stores on the first day")}>${esc(info.label)}</b>`;
    const t = `${info.label}: its back costs ${rolled ? "nothing as rolled" : `${pts} points`} of its own limit of ${f.limit} (nobody's points pay for it) and weighs ${kg} of the ${info.room} kg it holds${info.hard ? " (the riders and what they wear ride in it too)" : ""}.${over || heavy ? " Over: Start is refused until it is back within." : ""}`;
    const bar = `<div class="fleetbar ptsbar ${over ? "over" : ""}" style="min-width:9rem"${tip(t)}><div class="spread small"><span>Back <b>${rolled ? "as rolled" : pts}</b> / ${f.limit} pts</span><span class="${heavy ? "danger" : "muted"}">${kg} / ${info.room} kg</span></div><div class="bar"><i style="width:${rolled ? 0 : pct}%;background:${over ? "var(--danger)" : "var(--good)"}"></i></div></div>`;
    const what = rolled ? (info.hard ? `As rolled: ${loadWords(V)}` : "Empty") : loadWords(f.load);
    return `<div class="row nrveh" style="gap:0.35rem;align-items:center;margin-top:0.25rem">
        ${kind}
        <label${tip(`${info.label}'s point limit: what its back may cost (${START_FLEET.MIN}–${START_FLEET.MAX}, ${START_FLEET.LIMIT} by default). Its own, nobody's points${iron ? ". Ironman: the backs stay as rolled" : ""}`)}>Point limit <input type="number" min="${START_FLEET.MIN}" max="${START_FLEET.MAX}" step="${START_FLEET.STEP}" style="width:4.5rem" data-action="fleet-limit" data-i="${i}" value="${f.limit}"${dis}></label>
        ${bar}
        <button class="mini" data-action="fleet-rand" data-i="${i}"${dis}${tip(`Empty its back, then fill it with random things and supplies${info.open ? " (any thing and any material)" : ""} up to its point limit (${f.limit}) in the room there is (${info.room} kg). Each click is a new draw`)}>🎲 Random</button>
        <button class="mini" data-action="fleet-edit" data-i="${i}"${dis}${tip(`Put things, supplies${info.open ? ", materials" : ""} and rounds in its back by hand, each priced against its point limit`)}>Edit…</button>
        <button class="mini" data-action="fleet-empty" data-i="${i}"${dis}${tip("Nothing in its back")}>Empty</button>
        ${info.hard ? `<button class="mini" data-action="fleet-dice" data-i="${i}"${locked || rolled ? " disabled" : ""}${tip("What the world's dice put in the back (free)")}>As rolled</button>` : ""}
        <span class="small muted"${tip(what)}>${esc(what.length > 70 ? `${what.slice(0, 67)}…` : what)}</span>
      </div>`;
  }).join("");
  const count = mode === "custom" ? `<label${tip(`Custom: how many vehicles start at the hub, ${START_FLEET.COUNT.MIN}–${START_FLEET.COUNT.MAX}, each a kind, a point limit and a back of its own. Changing it builds the world again on the same seed`)}>Vehicles <input type="number" min="${START_FLEET.COUNT.MIN}" max="${START_FLEET.COUNT.MAX}" step="1" style="width:3.6rem" data-action="fleet-count" value="${state.fleet.length}"></label>` : "";
  const head = mode === "hardcore" ? "the car you flee in; a back set here replaces what the dice put in it" : mode === "custom" ? "at the hub; each back is unloaded into the hub's armory and stores on the first day, any thing and any material" : "what is in its back is unloaded into the hub's armory and stores on the first day";
  // What the backs are for is the heading's hover, not a line of its own (the user's request 2026-10-24).
  return `<div class="nrfleet">
      <div class="row small" style="gap:0.5rem"><b${tip(`Starting vehicles: ${head}. Each one's back has its own point limit (nobody's points pay for it). Start is refused while a back costs more than its limit or weighs more than its room`)}>Starting vehicles</b>${count}${iron ? `<span class="muted">Ironman: as rolled.</span>` : ""}</div>
      ${rows}
    </div>`;
}

// The vehicle's back window (Edit…): vehicle ui.fleetEdit.i's back by hand, priced against its point limit.
export function fleetEditor(state, ui) {
  const i = ui.fleetEdit ? ui.fleetEdit.i : -1, info = fleetInfo(state, i);
  const msg = (ui.fleetEdit && ui.fleetEdit.msg) || "";
  return `<div class="box wide"><h1>${info ? esc(info.label) : "Starting vehicle"}</h1>
    ${msg ? `<div class="small danger" style="margin-bottom:0.3rem">${esc(msg)}</div>` : ""}
    ${vehicleSection(state, ui)}
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary" data-action="fleet-close">Done</button></div></div>`;
}
function vehicleSection(state, ui) {
  const i = ui.fleetEdit ? ui.fleetEdit.i : 0;
  const info = fleetInfo(state, i);
  if (!info) return `<div class="sgtrunk small muted">No such vehicle in this start.</div>`;
  const V = sanitizeStartVehicle(shownLoad(state, i), info.open) || { items: [], supplies: {} };
  const rolled = !info.load;
  const load = trunkKg(V);
  const cost = rolled ? 0 : vehiclePoints(V);
  const maxItems = info.open ? OPEN_TRUNK.ITEMS : START_TRUNK.ITEMS;
  const tFree = Math.max(0, maxItems - V.items.length);
  const tsel = ui.fleetEdit && Number.isInteger(ui.fleetEdit.tsel) && takesMods(pickKey(V.items[ui.fleetEdit.tsel]) || "") ? ui.fleetEdit.tsel : -1;
  const items = V.items.map((e, j) => {
    const k = pickKey(e), m = pickMods(e), fitted = m ? gunWith(k, m) : null;
    const parts = takesMods(k) ? ` <button class="mini ${j === tsel ? "active" : ""}" data-action="sg-trunk-pick" data-i="${j}"${tip("Fit this gun with parts (they cost what they are worth)")}>⚙</button>` : "";
    return `<span class="chip"${tip(`${GEAR[k].desc || ""} (${kg(k)} kg, ${pickPoints(e)} points)${gunLong(k, fitted)}${gunInfo(k) && gunInfo(k).cal ? " It comes loaded." : ""}`)}>${esc(GEAR[k].name)}${m ? " ⚙" : ""}${pickN(e) > 1 ? ` ×${pickN(e)}${ROUND_SUPPLIES[k] ? " boxes" : ""}` : ""}${gunInfo(k, fitted) ? ` · ${gunInfo(k, fitted).text}` : ""}${parts} <button class="mini" data-action="sg-trunk-del" data-i="${j}"${tip("Take it out (the points back)")}>×</button></span>`;
  }).join("") || `<span class="small muted">Nothing in the back.</span>`;
  const tparts = tsel >= 0 ? gunPartsBox(pickKey(V.items[tsel]), pickMods(V.items[tsel]), `data-t="trunk" data-j="${tsel}"`, `the ${GEAR[pickKey(V.items[tsel])].name} in the back`) : "";
  // Supplies: Normal and Hardcore the usual few, each to its cap; Custom any supply or material (no cap but the room).
  const supKeys = info.open ? [...new Set([...Object.keys(START_TRUNK.SUPPLIES), ...Object.keys(V.supplies).filter((k) => !ROUND_SUPPLIES[k])])] : Object.keys(START_TRUNK.SUPPLIES);
  const capOf = (k) => (info.open ? OPEN_TRUNK.MAX : START_TRUNK.SUPPLIES[k]);
  const sups = supKeys.map((k) => `<label class="lookopt">${esc(supLabel(k))}<input type="number" min="0" max="${capOf(k)}" step="1" style="width:4.2rem" data-action="sg-trunk-sup" data-k="${k}" value="${V.supplies[k] || 0}"${tip(`${supLabel(k)} in the back, 0–${info.open ? "as much as there is room for" : capOf(k)} (${SUPPLIES[k] ? SUPPLIES[k].weight : 0} kg each; ${suppliesPoints({ [k]: 10 })} points for 10)`)}></label>`).join("");
  const more = info.open ? (() => {
    const groups = {};
    for (const k of openSupplyKeys().filter((x) => !supKeys.includes(x))) { const c = (SUPPLIES[k] && SUPPLIES[k].cat) || "other"; (groups[c] = groups[c] || []).push(k); }
    const opts = Object.keys(groups).sort().map((c) => `<optgroup label="${esc(c.replace(/^./, (x) => x.toUpperCase()))}">${groups[c].sort((a, b) => supLabel(a).localeCompare(supLabel(b))).map((k) => `<option value="${k}">${esc(supLabel(k))} · ${SUPPLIES[k] ? SUPPLIES[k].weight : 0} kg · ${suppliesPoints({ [k]: 10 })} pts for 10</option>`).join("")}</optgroup>`).join("");
    return `<div class="row" style="margin-top:0.2rem"><select data-action="sg-trunk-supadd"${tip("Custom: any supply or material in the game (wood, stone, building materials, car and gun parts, electronics, foods, reloading supplies...): ten of it go in (change how many after)")}><option value="">Add a supply or material…</option>${opts}</select></div>`;
  })() : "";
  const what = info.hard
    ? `The car the ${state.survivors.length === 1 ? "survivor flees" : "team flees"} in. ${rolled ? "As rolled: what the dice put in it, free. A change makes the back yours, priced against its point limit." : "A back set here goes in place of what the dice put in it."}`
    : `At the hub: what is in its back is unloaded into the hub's armory and stores on the first day.${info.open ? " Custom: any thing and any material, as much as its point limit and its room allow." : ""}`;
  return `<div class="sgtrunk">
    <h3>The back <span class="small muted">${rolled ? (info.hard ? "as rolled (free)" : "empty") : `${cost} / ${info.limit} pts`} · ${r1(load)} / ${info.room} kg</span></h3>
    <div class="small muted">${what}</div>
    <div class="row" style="gap:0.3rem;margin:0.25rem 0">
      <button class="mini" data-action="sg-trunk-rand"${tip(`Empty the back, then fill it with new random things and supplies up to its point limit (${info.limit}) in the room there is (${info.room} kg). Each click is a new draw`)}>🎲 Random back</button>
      ${info.hard ? `<button class="mini" data-action="sg-trunk-dice"${rolled ? " disabled" : ""}${tip("What the world's dice put in the back (free)")}>As rolled</button>` : ""}
      <button class="mini" data-action="sg-trunk-clear" ${!rolled && (V.items.length || Object.keys(V.supplies).length) || (rolled && info.hard) ? "" : "disabled"}${tip("Empty the back (the points back)")}>Empty</button></div>
    <div>${items}</div>
    ${tparts}
    <div class="row" style="margin-top:0.25rem;gap:0.3rem"><select data-action="sg-trunk-add"${V.items.length >= maxItems ? " disabled" : ""}><option value="">Put a thing in the back…</option>${optionsHtml(trunkChoices(), null, loosePoints)}</select>
      ${qtyBox(ui, "tqty", tFree, `How many of the next thing put in the back (each is a thing of its own: at most ${maxItems} things, the room there is and what its point limit leaves; ${tFree} more things fit)`)}</div>
    <div class="lookopts" style="margin-top:0.25rem">${sups}</div>
    ${more}
    ${trunkRoundsHtml(state, V, info.open)}
  </div>`;
}
// The back's rounds by calibre and type (sim/startgear.js START_TRUNK.ROUNDS in all; Custom: no cap but the room): a row
// each and a pick to add a box of one, the crew's guns' calibres first.
const trunkRounds = (V) => Object.entries(V.supplies || {}).reduce((a, [k, q]) => a + (ROUND_SUPPLIES[k] ? q : 0), 0);
const roundsCap = (open) => (open ? OPEN_TRUNK.ROUNDS : START_TRUNK.ROUNDS);
function trunkRoundsHtml(state, V, open = false) {
  const cap = roundsCap(open), total = trunkRounds(V), cals = gunCals(state.survivors);
  const rows = Object.keys(V.supplies).filter((k) => ROUND_SUPPLIES[k]).sort().map((k) => `<label class="lookopt">${esc(ROUND_SUPPLIES[k].name)}<input type="number" min="0" max="${cap}" step="1" style="width:4.2rem" data-action="sg-trunk-sup" data-k="${k}" value="${V.supplies[k] || 0}"${tip(`${ROUND_SUPPLIES[k].name} in the back (${open ? "as many as there is room for" : `every round together at most ${cap}`}; ${ROUND_SUPPLIES[k].weight} kg each; ${suppliesPoints({ [k]: 10 })} points for 10). 0 takes them out`)}></label>`).join("");
  const opts = Object.keys(ROUND_SUPPLIES).filter((k) => !HAND_SUPPLIES[k] && !V.supplies[k]).sort((a, b) => (cals[ROUND_SUPPLIES[b].round.cal] ? 1 : 0) - (cals[ROUND_SUPPLIES[a].round.cal] ? 1 : 0) || ROUND_SUPPLIES[a].name.localeCompare(ROUND_SUPPLIES[b].name));
  return `<div class="small muted" style="margin-top:0.25rem">Rounds in the back, by calibre and type: ${total}${open ? "" : `/${cap}`}</div><div class="lookopts">${rows}</div>
    <div class="row" style="margin-top:0.2rem"><select data-action="sg-trunk-round"${total >= cap ? " disabled" : ""}${tip("Add rounds of a calibre and type (a box of them; change how many after). The crew's guns' calibres first")}><option value="">Add rounds…</option>${opts.map((k) => `<option value="${k}">${esc(ROUND_SUPPLIES[k].name)}${cals[ROUND_SUPPLIES[k].round.cal] ? " (a gun of yours)" : ""}</option>`).join("")}</select></div>`;
}

// ---------- the containers ----------
function cellsHtml(state, ui, s, P, where, spec) {
  const n = spec[where].n;
  if (!n) return "";
  const list = (P.carry && P.carry[where]) || [];
  const sel = ui.gearEdit && ui.gearEdit.sel;
  const cells = [];
  for (let i = 0; i < n; i++) {
    const e = list[i] || null, key = pickKey(e), m = pickMods(e);
    const on = sel && sel.where === where && sel.i === i;
    const kind = where === "pouch" ? POUCH_NAMES[spec.pouch.kinds[i]] || spec.pouch.kinds[i] : where === "pocket" ? "Pocket" : "Pack";
    const why = key ? carryReason(key, where, i, spec) : "";
    const t = key ? `${GEAR[key].name}: ${shortDesc(key)} (${kg(key)} kg, ${pickPoints(e)} points).${gunLong(key, m ? gunWith(key, m) : null)}${gunInfo(key) && gunInfo(key).cal ? " It comes loaded." : ""} Click to pick it up (a gun: then fit it with parts below), then click where it goes${why ? `. ${why}` : ""}` : `${kind}${where === "pouch" ? " pouch" : ""}: empty. ${sel ? "Click to put the picked thing here" : "Click to pick this spot for the next thing you add"}`;
    const btn = `<button class="sgcell ${key ? "" : "empty"} ${on ? "sel" : ""} ${why ? "bad" : ""}" data-action="sg-cell" data-w="${where}" data-i="${i}"${tip(t)}><span class="sgkind">${esc(kind)}</span><span class="sgname">${key ? `${esc(GEAR[key].name)}${m ? " ⚙" : ""}${pickN(e) > 1 ? ` ×${pickN(e)}${ROUND_SUPPLIES[key] ? " boxes" : ""}` : ""}` : "—"}</span></button>`;
    cells.push(key ? `<span class="sgcellwrap">${btn}<button class="mini" data-action="sg-cell-del" data-w="${where}" data-i="${i}"${tip("Take it out (the points back)")}>×</button></span>` : btn);
  }
  const used = list.filter(Boolean).length;
  const head = where === "pocket" ? `Pockets (${used}/${n}): small things` : where === "pouch" ? `${esc(spec.pouch.name)} pouches (${used}/${n})` : `${esc(spec.pack.name)} (${used}/${n} slots)`;
  return `<div class="sgbox"><span class="small muted">${head}</span><div class="sgcells">${cells.join("")}</div></div>`;
}

// ---------- the gun's parts ----------
// The gun in the hands, fitted (2026-10-09, user request): a select for each slot open on it (gunmods.js slotsOf: a
// mount or rail opens more), each listing the parts that fit it (gunmods.js fitsSlot: platform, calibre, the space),
// "As it comes" (its factory part or nothing) and, where it has a factory part, None. What each costs is what it adds
// to the gun's points (custompoints.js gunPoints: its worth).
export const gunParts = (P) => gunPartsBox(P && P.slots && P.slots.weapon, P && P.mods, `data-t="hand"`, "");
// The same for any picked gun: key and its parts; attrs: which gun (data-t hand / carry / trunk, data-j); what: words
// for the head ("" for the one in the hands).
export function gunPartsBox(key, mods0, attrs, what) {
  if (!key || !GEAR[key] || !takesMods(key)) return "";
  const mods = mods0 || {};
  const gun = gunWith(key, mods), stock = gunWith(key), factory = stock.mods || {};
  const pts = gunPoints(key, mods), base = gunPoints(key);
  const all = modsFor(key);
  const rows = slotsOf(gun).map((slot) => {
    const without = { ...mods };
    delete without[slot];
    const bare = gunWith(key, without);
    const room = gunWith(key, without);
    stripMod(room, slot); // the slot empty, to ask what fits it
    const from = gunPoints(key, without);
    const fac = factory[slot] ? factory[slot].name : "";
    const cur = slot in mods ? mods[slot] : "=";
    const opts = all.filter((k) => ATTACH[k].slot === slot && !fitsSlot(room, makeMod(k, 1)) && !(bare.mods && bare.mods[slot] && bare.mods[slot].key === k && !(slot in mods))).map((k) => {
      const d = gunPoints(key, { ...without, [slot]: k }) - from;
      return `<option value="${k}" ${cur === k ? "selected" : ""} title="${esc(GEAR[k].desc || "")}">${esc(GEAR[k].name)} · ${d >= 0 ? "+" : "−"}${Math.abs(d)} pts</option>`;
    }).join("");
    const none = fac ? `<option value="-" ${cur === "" ? "selected" : ""}>None (take the ${esc(fac)} off) · −${Math.max(0, from - gunPoints(key, { ...without, [slot]: "" }))} pts</option>` : "";
    return `<label class="lookopt">${esc(GUN_SLOT_NAMES[slot] || slot)}<select data-action="sg-gunmod" data-gs="${slot}" ${attrs}><option value="=" ${cur === "=" ? "selected" : ""}>As it comes${fac ? ` (${esc(fac)})` : " (nothing)"}</option>${none}${opts}</select></label>`;
  }).join("");
  if (!rows) return "";
  const gi = gunInfo(key, gun);
  const t = `Fit the ${GEAR[key].name} with parts: each slot lists what fits it (a mount or rail opens more slots). A part costs what it is worth, added to the gun's points (${base} as it comes, ${pts} now). A bigger magazine also brings more rounds (a full load and two more, in the price).`;
  return `<div class="sgparts"${tip(t)}><div class="small muted">${what ? `Parts for ${esc(what)}` : "Gun parts"}: ${gi ? `${esc(gi.text)} · ` : ""}gun ${pts} pts${pts !== base ? ` (${base} as it comes)` : ""}${Object.keys(mods).length ? ` <button class="mini" data-action="sg-gunmods-clear" ${attrs}${tip("Back to the gun as it comes (its factory parts)")}>As it comes</button>` : ""}</div><div class="lookopts">${rows}</div></div>`;
}

// ---------- the window ----------
export function startGearEditor(state, ui) {
  const i = ui.gearEdit ? ui.gearEdit.i : -1, s = state.survivors[i];
  if (!s) return `<div class="box"><h1>Starting gear</h1><div class="muted">Nobody to dress.</div><div class="row" style="justify-content:flex-end"><button class="primary" data-action="sg-close">Done</button></div></div>`;
  const hard = isHardcore(state);
  const P = sanitizeStartGear(s.startGear) || { slots: {} };
  const extra = s.startGear || {}; // what the last rebuild wrote: what had no room
  const who = state.survivors.map((o, j) => { const B = pricePerson(state, o); return `<button class="mini ${j === i ? "active" : ""}" data-action="sg-who" data-i="${j}"${tip(`${o.name}: ${kitLoad(o).kg} kg, ${B.total} / ${B.max} points`)}>${o.leader ? "★ " : ""}${esc(o.name.split(" ")[0])}${B.over ? " ⚠" : ""}</button>`; }).join("");
  const L = kitLoad(s);
  const pct = Math.min(100, Math.round((L.kg / Math.max(1, L.max)) * 100));
  const color = ["var(--good)", "#ffd166", "var(--accent)", "var(--danger)"][L.band];
  const slots = START_GEAR.SLOTS.map((slot) => {
    const cur = s.gear[slot];
    const value = slot in P.slots ? P.slots[slot] : cur ? cur.key : "";
    const gi = cur && slot === "weapon" ? gunInfo(cur.key, cur) : null;
    const info = cur ? `${gi ? gunIconHtml(cur, 1.1, "igun inl") : ""}<span${tip((GEAR[cur.key] ? GEAR[cur.key].desc : "") + (gi ? ` ${gi.long}` : ""))}>${gi ? `${esc(gi.text)} · ` : ""}${r1(itemLoad(cur))} kg · ${slotPoints(slot, cur.key, slot === "weapon" && cur.key === P.slots.weapon ? P.mods : null)} pts${GEAR[cur.key] && GEAR[cur.key].desc ? ` — ${esc(shortDesc(cur.key))}` : ""}</span>` : `<span>—</span>`;
    return `<div class="sgslot">
      <span class="sglabel"${tip(SLOT_TIPS[slot])}>${SLOT_LABELS[slot]}</span>
      <select data-action="sg-slot" data-slot="${slot}">
        <option value="-" ${value === "" ? "selected" : ""}>Nothing</option>
        ${optionsHtml(slotChoices(slot), value || null, (k) => slotPoints(slot, k))}
      </select>
      <span></span>
      <div class="sginfo small muted">${info}</div>
      ${slot === "weapon" ? gunParts(P) : ""}
    </div>`;
  }).join("");
  const spec = carrySpec(P, s);
  const sel = ui.gearEdit.sel;
  const cells = CARRY_PLACES.map((w) => cellsHtml(state, ui, s, P, w, spec)).join("");
  const noRig = !spec.pouch.n ? `<div class="small muted">No pouches: pick a chest rig (Rig) or a vest or carrier with pouches (Body).</div>` : "";
  const noBag = !spec.pack.n ? `<div class="small muted">No bag: pick one (Bag) for pack slots.</div>` : "";
  const left = extra.left || [];
  const gun = s.gear.weapon && standardMag(s.gear.weapon.key);
  const msg = ui.gearEdit.msg || "";
  const free = CARRY_PLACES.reduce((a, w) => a + Math.max(0, spec[w].n - ((P.carry && P.carry[w]) || []).slice(0, spec[w].n).filter(Boolean).length), 0);
  return `<div class="box wide"><h1>Starting gear</h1>
    <div class="row" style="gap:0.25rem;margin-bottom:0.5rem">${who}</div>
    <div class="where">What ${esc(s.name)} starts with, every thing paid for in points (its worth; a gun in the hands with a full load and two more of its rounds, to the ${hard ? "team's" : "hub's"} stock). Put what they carry by hand: click a thing, then where it goes; <b>Add</b> puts a new thing in the spot you picked, else where it first fits. Picked things are new. Not for Ironman.</div>
    ${msg ? `<div class="small danger" style="margin-bottom:0.3rem">${esc(msg)}</div>` : ""}
    <div class="sgedit">
      <div class="sgcol">
        <h3>Worn and held</h3>
        ${slots}
        ${extra.rig ? `<div class="small danger">${esc(extra.rig)}</div>` : ""}
      </div>
      <div class="sgcol">
        ${pointsBar(state, s)}
        ${pointsSplit(state, s)}
        <h3>Load</h3>
        <div class="spread"><b>${L.kg} / ${L.max} kg</b><span class="${BAND_CLASS[L.band]}"${tip(bandsTip)}>${L.name}</span></div>
        <div class="bar"${tip(bandsTip)}><i style="width:${pct}%;background:${color}"></i></div>
        <h3>Carried</h3>
        ${cells}${noRig}${noBag}
        ${(() => { const e = sel && P.carry && P.carry[sel.where] ? P.carry[sel.where][sel.i] : null; const k = pickKey(e); return k ? gunPartsBox(k, pickMods(e), `data-t="carry"`, `the picked ${GEAR[k].name}`) : ""; })()}
        ${left.length ? `<div class="small danger">No room for ${esc(left.join(", "))}: ${hard ? "left behind" : "it goes to the hub's armory"}. Take it out or pick a bigger bag.</div>` : ""}
        <div class="row" style="margin-top:0.35rem;gap:0.3rem"><select data-action="sg-item-add"><option value="">Add a thing${sel && !((P.carry && P.carry[sel.where]) || [])[sel.i] ? ` to the ${sel.where === "pouch" ? "pouch" : sel.where} picked` : ""}…</option>${optionsHtml(carryChoices(), null, loosePoints)}</select>
          ${qtyBox(ui, "qty", free, `How many of the next thing you add, each in a spot of its own where it fits (a pocket, pouch or pack slot holds one thing; a box of rounds is a full box). At most what fits (${free} spot${free === 1 ? "" : "s"} free) and what their points pay for; the points are its price that many times`)}
          ${gun ? `<button class="mini" data-action="sg-mags"${tip(`Two spare magazines for the ${s.gear.weapon.name} (${GEAR[gun].name}, ${itemPoints(gun)} points each), where they fit: a pouch, the pack, a pocket`)}>+ 2 spare magazines</button>` : ""}
          <button class="mini" data-action="sg-carry-clear" ${hasPicks(P) && P.carry && CARRY_PLACES.some((w) => (P.carry[w] || []).some(Boolean)) ? "" : "disabled"}${tip("Empty their pockets, pouches and pack (the points back)")}>Empty all</button></div>
        <div class="sgtrunk small muted"${tip("The starting vehicles' backs are set on the new-run screen (Starting vehicles: Random, Edit…), each against a point limit of its own: nobody's points pay for them")}>The vehicles' backs: Starting vehicles on the new-run screen, each with its own point limit.</div>
      </div>
    </div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end;gap:0.3rem">
      <button data-action="sg-rand-kit"${tip(`Empty what they wear, hold and carry, then a new random kit for the points they have left after their skills and traits (${kitBudget(state, s)} now). Each click is a new draw`)}>🎲 Random gear</button>
      <button data-action="sg-dice-kit"${tip("What the world's dice gave them to wear, hold and carry (only the gear: skills and traits stay as they are). It may cost more than they have left")}>The dice's gear</button>
      <button data-action="sg-kit-clear"${tip("Nothing worn, held or carried (the points back). Skills and traits stay")}>Empty</button>
      <span style="flex:1"></span>
      <button class="primary" data-action="sg-close">Done</button>
    </div></div>`;
}

// ---------- actions (registered in main.js; true: build the world again for the change) ----------
const blankCarry = () => ({ pocket: [], pouch: [], pack: [] });
function edit(state, ui, fn) {
  const s = ui.gearEdit && state.survivors[ui.gearEdit.i];
  if (!s || ui.started || !freeEdit(ui)) return false;
  const P = sanitizeStartGear(s.startGear) || { slots: {} };
  if (!P.carry) P.carry = blankCarry();
  for (const w of CARRY_PLACES) P.carry[w] = [...(P.carry[w] || [])];
  ui.gearEdit.msg = "";
  if (fn(P, s) === false) return false;
  s.startGear = sanitizeStartGear(P);
  s.startCustom = true; // Customize: Ironman puts it back, Start refuses it in an Ironman run
  s.startPoints = true;
  ui.crewEdited = true;
  return true;
}
// After the containers change (a smaller bag, the rig gone): what no longer fits is moved to where it fits, or taken
// out (the points back), and the window says so.
function reflow(ui, P, s) {
  const spec = carrySpec(P, s);
  const bad = misfits(P, spec);
  const out = [];
  for (const x of bad) P.carry[x.where][x.i] = null;
  for (const x of bad) {
    const at = firstFit(P, x.key, spec);
    if (at) P.carry[at.where][at.i] = x.entry; else out.push(GEAR[x.key].name);
  }
  if (out.length) ui.gearEdit.msg = `No room for ${out.join(", ")} any more: taken out (the points back).`;
}
// Puts key in a spot: the spot picked if it is empty (refused with the reason if it does not fit), else where it
// first fits. Returns false (with the window's message) when there is no room.
function putIn(ui, P, s, entry) {
  const key = /** @type {string} */ (pickKey(entry));
  const spec = carrySpec(P, s);
  const sel = ui.gearEdit.sel;
  if (sel && !(P.carry[sel.where] || [])[sel.i]) {
    const why = carryReason(key, sel.where, sel.i, spec);
    if (why) { ui.gearEdit.msg = `${GEAR[key].name}: ${why}`; return false; }
    P.carry[sel.where][sel.i] = entry;
    ui.gearEdit.sel = null;
    return true;
  }
  const at = firstFit(P, key, spec);
  if (!at) { ui.gearEdit.msg = `No room for the ${GEAR[key].name}: ${isPocketOnly(spec) ? "only small things go in pockets; pick a bag or a rig" : "every spot it fits is taken"}.`; return false; }
  P.carry[at.where][at.i] = entry;
  return true;
}
// N of a thing as picks: one stack a spot (pickStackMax: a consumable's stack, five boxes of rounds), else one each.
// Returns the entries (the last may be a smaller stack).
const stackPicks = (key, n) => { const max = pickStackMax(key), out = []; for (let left = n; left > 0; left -= max) { const q = Math.min(max, left); out.push(q > 1 ? { key, n: q } : key); } return out; };
const isPocketOnly = (spec) => !spec.pack.n && !spec.pouch.n;

// "Start from the dice" (this window and the crew card): what the dice made of them, as their picks: skills, traits
// and tiers (world.js applyCrew noted them, s.diceRoll), what they wear and carry (startgear.js noteDiceKit).
export function loadDice(state, s) {
  const R = s.diceRoll || { skills: s.skills, traits: s.traits, traitTier: s.traitTier };
  s.skills = { ...R.skills };
  s.traits = [...R.traits];
  tidyTiers(s, R.traitTier || {});
  if (!s.diceKit) noteDiceKit(s);
  s.startGear = sanitizeStartGear(s.diceKit) || { slots: Object.fromEntries(START_GEAR.SLOTS.map((k) => [k, ""])), carry: blankCarry() };
  s.startPoints = true;
  s.startCustom = true;
}
// "Clear": a blank slate (skills 0, no traits, nothing worn or carried).
export function blankPerson(s) {
  for (const k of Object.keys(s.skills)) s.skills[k] = 0;
  s.traits = [];
  delete s.traitTier;
  s.startGear = { slots: Object.fromEntries(START_GEAR.SLOTS.map((k) => [k, ""])), carry: blankCarry() };
  s.startPoints = true;
  s.startCustom = true;
}
// A starting vehicle's back (sim/startfleet.js; the window's vehicle, ui.fleetEdit.i, or i): fn(V, f, i) changes the
// back as shown (as rolled: Hardcore the dice's, else empty), which is then the vehicle's load, on the screen's fleet
// (ui.fleet: the next world is built with it) and the world's (state.fleet). Not once started, not in Ironman (as
// rolled). Returns "fleet" (main.js: the world again with it) or false.
function editTrunk(state, ui, fn, at = null) {
  if (ui.started || ui.ironman) return false;
  const i = at ?? (ui.fleetEdit ? ui.fleetEdit.i : 0);
  const F = uiFleet(state, ui), f = F[i], live = fleetEntry(state, i);
  if (!f || !live) return false;
  const open = openLoads(state);
  const V = sanitizeStartVehicle(shownLoad(state, i), open) || { items: [], supplies: {} };
  if (ui.fleetEdit) ui.fleetEdit.msg = "";
  if (fn(V, f, i) === false) return false;
  f.load = sanitizeStartVehicle(V, open);
  live.load = f.load ? JSON.parse(JSON.stringify(f.load)) : null;
  return "fleet";
}
const room = (state, ui) => fleetRoom(state, ui && ui.fleetEdit ? ui.fleetEdit.i : 0);
const limitOf = (state, ui) => { const f = fleetEntry(state, ui && ui.fleetEdit ? ui.fleetEdit.i : 0); return f ? f.limit : 0; };
const say = (ui, t) => { if (ui.fleetEdit) ui.fleetEdit.msg = t; else ui.nrMsg = t; };
// A random back for vehicle i, up to its point limit and its room (rounds for the crew's guns; Custom: any thing and material).
const randomBack = (state, i, limit, rng = freshRng()) => randomTrunk(limit, fleetRoom(state, i), rng, gunCals(state.survivors), { fill: true, open: openLoads(state) });

// A gun's parts with one slot changed ("=": as it comes, "-": the factory part off, else a part): the new parts (null:
// as it comes), or false with the window's reason when it does not fit (what it needs came off).
function partsAfter(ui, key, cur, slot, v) {
  const want = { ...(cur || {}) };
  if (v === "=") delete want[slot]; else if (v === "-") want[slot] = ""; else if (ATTACH[v]) want[slot] = v; else return false;
  const got = sanitizeGunMods(key, want);
  if (v !== "=" && !(got && slot in got)) {
    const room = gunWith(key, { ...want, [slot]: undefined });
    stripMod(room, slot);
    const H = ui.gearEdit || ui.fleetEdit; // the gear window or a vehicle's back window
    if (H) H.msg = v === "-" ? "Nothing to take off there." : fitsSlot(room, makeMod(v, 1)) || `The ${GEAR[v].name} does not fit there.`;
    return false;
  }
  return got;
}

export const SG_ACTIONS = {
  "sg-open": (state, ui, d) => {
    if (ui.started || !freeEdit(ui)) return false;
    const i = state.survivors.findIndex((s) => s.id === Number(d.id));
    if (i >= 0) { ui.gearEdit = { i, sel: null, msg: "" }; ui.fleetEdit = null; }
    return false;
  },
  "sg-close": (state, ui) => { ui.gearEdit = null; return false; },
  "sg-who": (state, ui, d) => { if (ui.gearEdit && state.survivors[Number(d.i)]) { ui.gearEdit.i = Number(d.i); ui.gearEdit.sel = null; ui.gearEdit.msg = ""; } return false; },
  // A cell: pick up what is there, or put the picked thing here (a swap if both are full; refused with the reason).
  "sg-cell": (state, ui, d) => {
    if (!ui.gearEdit) return false;
    const where = d.w, i = Number(d.i);
    if (!CARRY_PLACES.includes(where)) return false;
    const sel = ui.gearEdit.sel;
    const s = state.survivors[ui.gearEdit.i];
    const P = sanitizeStartGear(s && s.startGear) || { slots: {} };
    const here = P.carry && P.carry[where] ? P.carry[where][i] : null;
    const selKey = sel && P.carry && P.carry[sel.where] ? P.carry[sel.where][sel.i] : null;
    if (sel && sel.where === where && sel.i === i) { ui.gearEdit.sel = null; return false; } // put down again
    if (!sel || !selKey) { ui.gearEdit.sel = { where, i }; ui.gearEdit.msg = ""; return false; } // pick it up (or pick this spot)
    return edit(state, ui, (Q, who) => {
      const spec = carrySpec(Q, who);
      const why = carryReason(pickKey(selKey), where, i, spec) || (here ? carryReason(pickKey(here), sel.where, sel.i, spec) : "");
      if (why) { ui.gearEdit.msg = why; return false; }
      Q.carry[where][i] = selKey;
      Q.carry[sel.where][sel.i] = here || null;
      ui.gearEdit.sel = null;
    });
  },
  "sg-cell-del": (state, ui, d) => edit(state, ui, (P) => { const l = P.carry[d.w]; if (!l || !l[Number(d.i)]) return false; l[Number(d.i)] = null; ui.gearEdit.sel = null; }),
  "sg-carry-clear": (state, ui) => edit(state, ui, (P) => { P.carry = blankCarry(); ui.gearEdit.sel = null; }),
  // Two spare magazines for the gun in their hands, where they fit.
  "sg-mags": (state, ui) => edit(state, ui, (P, s) => {
    const key = s.gear.weapon && standardMag(s.gear.weapon.key);
    if (!key) return false;
    ui.gearEdit.sel = null;
    let n = 0;
    for (let k = 0; k < 2; k++) if (putIn(ui, P, s, key)) n++;
    if (!n) return false;
  }),
  "sg-dice": (state, ui, d) => {
    const s = state.survivors[Number(d.i)];
    if (!s || ui.started || !freeEdit(ui)) return false;
    loadDice(state, s);
    ui.crewEdited = true;
    if (ui.gearEdit) { ui.gearEdit.sel = null; ui.gearEdit.msg = ""; }
    return true;
  },
  // The crew card's Build: a whole random colonist within their points (its All: ui/newgame.js randomizeOne).
  "sg-build": (state, ui, d) => {
    const s = state.survivors[Number(d.i)];
    if (!s || ui.started || !freeEdit(ui)) return false;
    const rng = freshRng();
    randomBuild(state, s, rng);
    s.startPoints = true;
    s.startCustom = true;
    ui.crewEdited = true;
    return true;
  },
  // The gear window: what they wear, hold and carry only.
  "sg-rand-kit": (state, ui) => edit(state, ui, (P, s) => {
    const K = randomKit(kitBudget(state, s), freshRng());
    P.slots = K.slots;
    P.carry = K.carry;
    delete P.mods; // the dice leave guns as they come
    ui.gearEdit.sel = null;
  }),
  "sg-dice-kit": (state, ui) => edit(state, ui, (P, s) => {
    if (!s.diceKit) noteDiceKit(s);
    const K = sanitizeStartGear(s.diceKit) || { slots: {} };
    P.slots = { ...Object.fromEntries(START_GEAR.SLOTS.map((k) => [k, ""])), ...K.slots };
    P.carry = K.carry || blankCarry();
    if (K.mods) P.mods = { ...K.mods }; else delete P.mods; // the parts the dice put on the gun come with it
    ui.gearEdit.sel = null;
  }),
  "sg-kit-clear": (state, ui) => edit(state, ui, (P) => {
    delete P.mods;
    P.slots = Object.fromEntries(START_GEAR.SLOTS.map((k) => [k, ""]));
    P.carry = blankCarry();
    ui.gearEdit.sel = null;
  }),
  "sg-blank": (state, ui, d) => {
    const s = state.survivors[Number(d.i)];
    if (!s || ui.started || !freeEdit(ui)) return false;
    blankPerson(s);
    ui.crewEdited = true;
    if (ui.gearEdit) { ui.gearEdit.sel = null; ui.gearEdit.msg = ""; }
    return true;
  },
  // The gun in the hands back as it comes.
  "sg-gunmods-clear": (state, ui, d) => {
    const t = (d && d.t) || "hand";
    if (t === "trunk") return editTrunk(state, ui, (V) => { const j = Number(d.j), k = pickKey(V.items[j]); if (!k || !pickMods(V.items[j])) return false; V.items[j] = k; });
    return edit(state, ui, (P) => {
      if (t === "carry") { const sel = ui.gearEdit.sel, e = sel && P.carry[sel.where] && P.carry[sel.where][sel.i]; if (!pickMods(e)) return false; P.carry[sel.where][sel.i] = pickKey(e); return; }
      if (!P.mods) return false;
      delete P.mods;
    });
  },
  // A gun in the back picked for its parts (again: put down). Nothing changes in the world.
  "sg-trunk-pick": (state, ui, d) => { if (ui.fleetEdit) ui.fleetEdit.tsel = ui.fleetEdit.tsel === Number(d.i) ? null : Number(d.i); return false; },
  "sg-trunk-del": (state, ui, d) => editTrunk(state, ui, (V) => { if (!V.items[Number(d.i)]) return false; V.items.splice(Number(d.i), 1); if (ui.fleetEdit) ui.fleetEdit.tsel = null; }),
  "sg-trunk-clear": (state, ui) => editTrunk(state, ui, (V) => { V.items = []; V.supplies = {}; if (ui.fleetEdit) ui.fleetEdit.tsel = null; }),
  // Empty, then a new random back up to its point limit.
  "sg-trunk-rand": (state, ui) => editTrunk(state, ui, (V, f, i) => {
    const R = randomBack(state, i, f.limit);
    if (!R.items.length && !Object.keys(R.supplies).length) say(ui, `Its point limit (${f.limit}) pays for nothing: raise it.`);
    V.items = R.items;
    V.supplies = R.supplies;
    if (ui.fleetEdit) ui.fleetEdit.tsel = null;
  }),
  // As rolled (Hardcore: what the dice put in the car, free); a normal start's vehicles come empty.
  "sg-trunk-dice": (state, ui) => {
    if (!isHardcore(state)) { say(ui, "A normal start's vehicles come empty: nothing to load."); return false; }
    return asRolled(state, ui, ui.fleetEdit ? ui.fleetEdit.i : 0);
  },
  // The new-run screen's Starting vehicles (fleetSection).
  "fleet-edit": (state, ui, d) => {
    const i = Number(d.i);
    if (ui.started || ui.ironman || !fleetInfo(state, i)) return false;
    uiFleet(state, ui);
    ui.gearEdit = null;
    ui.fleetEdit = { i, msg: "", tsel: null };
    return false;
  },
  "fleet-close": (state, ui) => { ui.fleetEdit = null; return false; },
  "fleet-rand": (state, ui, d) => editTrunk(state, ui, (V, f, i) => {
    const R = randomBack(state, i, f.limit);
    if (!R.items.length && !Object.keys(R.supplies).length) say(ui, `${fleetName(state, i)}: its point limit (${f.limit}) pays for nothing; raise it.`);
    V.items = R.items;
    V.supplies = R.supplies;
  }, Number(d.i)),
  "fleet-empty": (state, ui, d) => editTrunk(state, ui, (V) => { V.items = []; V.supplies = {}; }, Number(d.i)),
  "fleet-dice": (state, ui, d) => (isHardcore(state) ? asRolled(state, ui, Number(d.i)) : false),
};
// A vehicle's back as rolled again (load null: Hardcore the dice's back, free).
function asRolled(state, ui, i) {
  if (ui.started || ui.ironman) return false;
  const F = uiFleet(state, ui), f = F[i], live = fleetEntry(state, i);
  if (!f || !live || !f.load) return false;
  f.load = null;
  live.load = null;
  if (ui.fleetEdit) ui.fleetEdit.tsel = null;
  return "fleet";
}

export const SG_CHANGE = {
  // "-": nothing there, else the item. A new bag, rig or vest moves what no longer fits.
  "sg-slot": (state, ui, el) => edit(state, ui, (P, s) => {
    const slot = el.dataset.slot, v = el.value;
    if (!START_GEAR.SLOTS.includes(slot)) return false;
    for (const k of START_GEAR.SLOTS) if (!(k in P.slots)) P.slots[k] = s.gear[k] ? s.gear[k].key : ""; // every slot named under Customize
    P.slots[slot] = v === "-" || !v ? "" : v;
    if (slot === "weapon") delete P.mods; // another gun: as it comes
    if (["backpack", "rig", "armor"].includes(slot)) reflow(ui, P, s);
    ui.gearEdit.sel = null;
  }),
  // The thing picked, as many as the × box says (each in a spot of its own): at most what fits, and what their points
  // left pay for (always one, as a single thing always went in; Start refuses it if that puts them over).
  "sg-item-add": (state, ui, el) => edit(state, ui, (P, s) => {
    const key = el.value;
    if (!key || !GEAR[key]) return false;
    const want = qtyOf(ui, "qty"), price = loosePoints(key);
    const afford = Math.floor(Math.max(0, pricePerson(state, s).left) / Math.max(1, price));
    const cap = Math.min(want, Math.max(1, afford));
    let n = 0;
    for (const e of stackPicks(key, cap)) { if (!putIn(ui, P, s, e)) break; n += pickN(e); } // a stack a spot (itemstack.js)
    if (!n) return false;
    if (n < want) ui.gearEdit.msg = `${n} ${GEAR[key].name} added of the ${want} asked (${n * price} points): ${n < cap ? "no room for more" : `their points left pay for ${afford}`}.`;
  }),
  // The same for a starting vehicle's back: at most its things (Custom: OPEN_TRUNK's), its room and what its point limit leaves.
  "sg-trunk-add": (state, ui, el) => editTrunk(state, ui, (V, f, i) => {
    const k = el.value;
    if (!k || !GEAR[k]) return false;
    const maxItems = openLoads(state) ? OPEN_TRUNK.ITEMS : START_TRUNK.ITEMS, rm = fleetRoom(state, i);
    if (V.items.length >= maxItems) { say(ui, `At most ${maxItems} things in the back.`); return false; }
    if (trunkKg(V) + kg(k) > rm + 1e-9) { say(ui, `No room in the back for the ${GEAR[k].name} (${kg(k)} kg; ${r1(Math.max(0, rm - trunkKg(V)))} kg left).`); return false; }
    const want = qtyOf(ui, "tqty"), price = loosePoints(k);
    const afford = Math.floor(Math.max(0, f.limit - (f.load ? vehiclePoints(V) : 0)) / Math.max(1, price)); // as rolled: the dice's back is free, what is added is not
    const cap = Math.min(want, Math.max(1, afford));
    let n = 0, why = "";
    for (const e of stackPicks(k, cap)) { // a stack a slot of the back (itemstack.js)
      if (V.items.length >= maxItems) { why = `at most ${maxItems} things in the back`; break; }
      let one = e;
      while (trunkKg({ ...V, items: [...V.items, one] }) > rm + 1e-9 && pickN(one) > 1) one = pickN(one) - 1 > 1 ? { key: k, n: pickN(one) - 1 } : k; // what of the stack fits
      if (trunkKg({ ...V, items: [...V.items, one] }) > rm + 1e-9) { why = "no room for more"; break; }
      V.items.push(one);
      n += pickN(one);
      if (one !== e) { why = "no room for more"; break; }
    }
    if (n < want) say(ui, `${n} ${GEAR[k].name} put in of the ${want} asked (${n * price} points): ${why || `its point limit (${f.limit}) pays for ${afford}`}.`);
  }),
  // A part for one slot of the gun in the hands ("=": as it comes, "-": the factory part off). One that does not fit
  // (what it needs came off) is refused with the reason.
  // data-t: the gun in the hands (hand), the carried gun picked up (carry), a gun in the back (trunk, data-j).
  "sg-gunmod": (state, ui, el) => {
    const t = el.dataset.t || "hand", slot = el.dataset.gs, v = el.value;
    if (!slot) return false;
    if (t === "trunk") {
      return editTrunk(state, ui, (V) => {
        const j = Number(el.dataset.j), k = pickKey(V.items[j]);
        const got = k ? partsAfter(ui, k, pickMods(V.items[j]), slot, v) : false;
        if (got === false) return false;
        V.items[j] = got ? { key: k, mods: got } : k;
      });
    }
    return edit(state, ui, (P) => {
      if (t === "carry") {
        const sel = ui.gearEdit.sel, e = sel && P.carry[sel.where] ? P.carry[sel.where][sel.i] : null, k = pickKey(e);
        const got = k ? partsAfter(ui, k, pickMods(e), slot, v) : false;
        if (got === false) return false;
        P.carry[sel.where][sel.i] = got ? { key: k, mods: got } : k;
        return;
      }
      const key = P.slots.weapon;
      const got = key && GEAR[key] ? partsAfter(ui, key, P.mods, slot, v) : false;
      if (got === false) return false;
      if (got) P.mods = got; else delete P.mods;
    });
  },
  // The × boxes: how many of the next thing (kept while the window is open).
  "sg-qty": (state, ui, el) => {
    const H = qtyHolder(ui, el.dataset.k);
    if (!H || !["qty", "tqty"].includes(el.dataset.k)) return false;
    H[el.dataset.k] = Math.max(1, Math.min(QTY_MAX, Math.round(Number(el.value) || 1)));
    return false;
  },
  // A supply in the back: Normal and Hardcore to its cap (rounds: every calibre together under START_TRUNK.ROUNDS); Custom
  // any supply or material, held by the room.
  "sg-trunk-sup": (state, ui, el) => editTrunk(state, ui, (V, f, i) => {
    const k = el.dataset.k, open = openLoads(state);
    if (open ? !(ROUND_SUPPLIES[k] || openSupplyKeys().includes(k)) : !(ROUND_SUPPLIES[k] || k in START_TRUNK.SUPPLIES)) return false;
    const cap = ROUND_SUPPLIES[k] ? Math.max(0, roundsCap(open) - trunkRounds(V) + (V.supplies[k] || 0)) : open ? OPEN_TRUNK.MAX : START_TRUNK.SUPPLIES[k];
    let n = Math.max(0, Math.min(cap, Math.round(Number(el.value) || 0)));
    const w = SUPPLIES[k] ? SUPPLIES[k].weight || 0 : 0, rm = fleetRoom(state, i);
    const other = trunkKg({ ...V, supplies: { ...V.supplies, [k]: 0 } });
    if (w > 0 && other + n * w > rm) { n = Math.max(0, Math.floor((rm - other) / w)); say(ui, `Only room for ${n} ${supLabel(k).toLowerCase()} in the back.`); }
    if (n) V.supplies[k] = n; else delete V.supplies[k];
  }),
  // Custom: any supply or material into the back (ten of it, or what the room leaves).
  "sg-trunk-supadd": (state, ui, el) => editTrunk(state, ui, (V, f, i) => {
    const k = el.value;
    if (!openLoads(state) || !openSupplyKeys().includes(k) || V.supplies[k]) return false;
    const w = SUPPLIES[k] ? SUPPLIES[k].weight || 0 : 0;
    const n = w > 0 ? Math.min(10, Math.floor((fleetRoom(state, i) - trunkKg(V)) / w)) : 10;
    if (!(n > 0)) { say(ui, `No room in the back for ${supLabel(k).toLowerCase()}.`); return false; }
    V.supplies[k] = n;
  }),
  // A box of rounds of a calibre and type into the back (what the room and START_TRUNK.ROUNDS leave).
  "sg-trunk-round": (state, ui, el) => editTrunk(state, ui, (V, f, i) => {
    const k = el.value;
    if (!k || !ROUND_SUPPLIES[k]) return false;
    const cap = roundsCap(openLoads(state));
    const left = cap - trunkRounds(V), w = ROUND_SUPPLIES[k].weight || 0;
    let n = Math.min(left, (CALIBERS[ROUND_SUPPLIES[k].round.cal] || { box: 20 }).box);
    if (w > 0) n = Math.min(n, Math.floor((fleetRoom(state, i) - trunkKg(V)) / w));
    if (!(n > 0)) { say(ui, left > 0 ? "No room in the back for more rounds." : `At most ${cap} rounds in the back.`); return false; }
    V.supplies[k] = (V.supplies[k] || 0) + n;
  }),
  // The new-run screen's Starting vehicles: a point limit, on the screen's fleet and the world's (nothing else in the
  // world changes: no rebuild).
  "fleet-limit": (state, ui, el) => {
    if (ui.started || ui.ironman) return false;
    const i = Number(el.dataset.i), F = uiFleet(state, ui), live = fleetEntry(state, i);
    if (!F[i] || !live) return false;
    F[i].limit = live.limit = clampLimit(el.value);
    el.value = F[i].limit;
    return false;
  },
  // Custom: a vehicle's kind, and how many (the world again: they are made at the hub).
  "fleet-kind": (state, ui, el) => {
    if (ui.started || fleetMode(state) !== "custom") return false;
    const i = Number(el.dataset.i), F = uiFleet(state, ui);
    if (!F[i] || !fleetKinds().includes(el.value)) return false;
    F[i].type = el.value;
    return "fleet";
  },
  "fleet-count": (state, ui, el) => {
    if (ui.started || fleetMode(state) !== "custom") return false;
    const n = clampFleetCount(el.value);
    el.value = n;
    ui.fleet = resizeFleet(uiFleet(state, ui), n);
    return "fleet";
  },
};
