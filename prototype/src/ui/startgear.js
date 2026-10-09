// Starting gear on the new-run screen (2026-10-08, user requests; sim/startgear.js has the rules, sim/custompoints.js the
// prices): with Customize ticked (not with Ironman) each crew card shows the colonist's load, their points and a Gear…
// button, which opens this window: every worn and held slot picked from the catalogue (or nothing), what they carry put
// by hand into each pocket, pouch and pack slot (click a thing, then where it goes; Add puts a new one in the cell
// picked, else where it first fits; what does not fit is refused with the reason), and what is in the starting
// vehicle's back (Hardcore: the car the team flees in; a normal start: the hub's pickup, unloaded on the first day),
// paid for by its owner. Every change to what they wear or carry builds the world again on the same seed (main.js
// gearRebuild), so what the window shows is what they start with.
// HTML builders plus their action handlers; main.js registers them (an action returning true asks for the rebuild).
import { GEAR, SUPPLIES } from "../sim/data.js";
import { POUCH_NAMES } from "../sim/data-kit.js";
import { isHardcore } from "../sim/hardcore.js";
import { itemLoad } from "../sim/inventory.js";
import { LOAD_BANDS, wornLoad } from "../sim/load.js";
import { VEHICLE_TYPES, RIDER_KG } from "../sim/vehicles.js";
import {
  START_GEAR, START_TRUNK, CARRY_PLACES, slotChoices, carryChoices, trunkChoices, sanitizeStartGear, sanitizeStartVehicle, hasPicks, kitLoad, carrySpec,
  carryReason, firstFit, misfits, trunkKg, vehicleOwner, noteDiceKit,
} from "../sim/startgear.js";
import { itemPoints, slotPoints, pricePerson, pointsMax, vehiclePoints, suppliesPoints } from "../sim/custompoints.js";
import { tidyTiers } from "../sim/traits.js";
import { standardMag } from "../sim/mags.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const freeEdit = (ui) => !!ui.freeEdit && !ui.ironman; // Customize, as ui/newgame.js
const SLOT_LABELS = { weapon: "Hands", tool: "Off hand", armor: "Body", head: "Head", arms: "Arms", legs: "Legs", rig: "Rig", backpack: "Bag" };
const SLOT_TIPS = {
  weapon: "The weapon in their hands (a gun comes with a full load and two more of its rounds, in the price)",
  tool: "The off hand: a light, a radio, a medical kit, night vision…",
  armor: "Body armour (a vest or carrier with pouches takes magazines and meds itself)",
  head: "A helmet, ear protection or a headset",
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
function optionsHtml(keys, current, price = (k) => itemPoints(k)) {
  const groups = {};
  for (const k of keys) (groups[GEAR[k].cat || "other"] = groups[GEAR[k].cat || "other"] || []).push(k);
  return Object.keys(groups).sort((a, b) => catOrder(a) - catOrder(b) || a.localeCompare(b)).map((c) => {
    const list = groups[c].sort((a, b) => GEAR[a].name.localeCompare(GEAR[b].name));
    return `<optgroup label="${esc(CAT_NAME[c] || c.replace(/^./, (x) => x.toUpperCase()))}">${list.map((k) => `<option value="${k}" ${k === current ? "selected" : ""} title="${esc(GEAR[k].desc || "")}">${esc(GEAR[k].name)} · ${kgText(k)} · ${price(k)} pts</option>`).join("")}</optgroup>`;
  }).join("");
}

// ---------- the points bar (the crew card and this window) ----------
export function pointsBar(state, s) {
  const B = pricePerson(state, s);
  const pct = Math.min(100, Math.round((B.total / Math.max(1, B.max)) * 100));
  const over = B.over > 0;
  const t = `${s.name}'s customization points: ${B.total} of ${B.max} spent. ${B.lines.join(" · ")}. Skill levels cost 1 each up to 10, 2 up to 15, 3 up to 20; good traits cost points by tier, bad ones give points back (at most ${B.cap}); every thing worn, held, carried or put in the vehicle costs what it is worth.${over ? " Over the max: Start is refused until it is back under." : ""}`;
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
    <button class="mini" data-action="sg-open" data-id="${s.id}"${tip("Pick what they wear and hold, put what they carry in each pocket, pouch and pack slot, and load the vehicle's back. Each thing costs points.")}>🎒 Gear…</button>
    ${loadText(s)} <span class="small muted"${tip("What their kit costs (worn, held and carried)")}>kit ${kit} pts</span>${B.vehicle ? ` <span class="small muted"${tip("They pay for what is in the vehicle's back")}>vehicle ${B.vehicle} pts</span>` : ""}</div>`;
}

// ---------- the starting vehicle ----------
// The vehicle whose back is picked: Hardcore, the car the team flees in; a normal start, the hub's pickup (the first
// vehicle at the hub). { v, type, name, room (kg), hard }.
export function startVehicleInfo(state) {
  const hard = isHardcore(state);
  let v = null;
  if (hard) { const id = state.hardcore && state.hardcore.start && state.hardcore.start.car; v = (state.vehicles || []).find((x) => x.id === id) || null; }
  else v = (state.vehicles || []).find((x) => x.location && x.location.kind === "base") || null;
  if (!v || !VEHICLE_TYPES[v.type]) return null;
  const T = VEHICLE_TYPES[v.type];
  // Hardcore: the riders and what they wear ride in it too; a normal start: it is unloaded at the hub on day 1.
  const riders = hard ? state.survivors.reduce((a, s) => a + RIDER_KG + wornLoad(s), 0) : 0;
  return { v, type: v.type, name: T.name, room: Math.max(0, Math.round((T.payload || 0) - riders)), hard };
}

function vehicleSection(state, ui) {
  const info = startVehicleInfo(state);
  if (!info) return `<div class="sgtrunk small muted">No starting vehicle in this start.</div>`;
  const owner = vehicleOwner(state);
  const V = sanitizeStartVehicle(owner && owner.startVehicle) || { items: [], supplies: {} };
  const hcOwner = info.hard && state.hardcore && state.hardcore.start ? state.survivors.find((s) => s.id === state.hardcore.start.carOwner) : null;
  const payer = owner || hcOwner || state.survivors.find((s) => s.leader) || state.survivors[0];
  const load = trunkKg(V);
  const who = state.survivors.map((s) => `<option value="${s.id}" ${s === payer ? "selected" : ""}>${esc(s.name)}</option>`).join("");
  const items = V.items.map((k, j) => `<span class="chip"${tip(`${GEAR[k].desc || ""} (${kg(k)} kg, ${itemPoints(k)} points)`)}>${esc(GEAR[k].name)} <button class="mini" data-action="sg-trunk-del" data-i="${j}"${tip("Take it out (the points back)")}>×</button></span>`).join("") || `<span class="small muted">Nothing in the back.</span>`;
  const sups = Object.entries(START_TRUNK.SUPPLIES).map(([k, cap]) => `<label class="lookopt">${SUP_LABELS[k]}<input type="number" min="0" max="${cap}" step="1" style="width:4.2rem" data-action="sg-trunk-sup" data-k="${k}" value="${V.supplies[k] || 0}"${tip(`${SUP_LABELS[k]} in the back, 0–${cap} (${SUPPLIES[k] ? SUPPLIES[k].weight : 0} kg each; ${suppliesPoints({ [k]: 10 })} points for 10)`)}></label>`).join("");
  const what = info.hard
    ? `The car the ${state.survivors.length === 1 ? "survivor flees" : "team flees"} in: ${esc(info.name)}${hcOwner ? `, ${esc(hcOwner.name.split(" ")[0])}'s` : ""}. Whoever pays for the back owns the car (its kind goes with who they were).`
    : `The hub's ${esc(info.name.toLowerCase())}: what is in its back is unloaded into the hub's armory and stores on the first day.`;
  return `<div class="sgtrunk">
    <h3>The vehicle's back <span class="small muted">${vehiclePoints(V)} pts · ${r1(load)} / ${info.room} kg</span></h3>
    <div class="small muted">${what}</div>
    <div class="row" style="gap:0.3rem;margin:0.25rem 0"><label class="small"${tip("Whose points pay for what is in the back (in Hardcore they own the car)")}>Paid by <select data-action="sg-trunk-owner">${who}</select></label>
      <button class="mini" data-action="sg-trunk-dice"${tip("Load what the dice put in the back (the points it costs)")}>🎲 The dice's back</button>
      <button class="mini" data-action="sg-trunk-clear" ${V.items.length || Object.keys(V.supplies).length ? "" : "disabled"}${tip("Empty the back (the points back)")}>Empty</button></div>
    <div>${items}</div>
    <div class="row" style="margin-top:0.25rem"><select data-action="sg-trunk-add"${V.items.length >= START_TRUNK.ITEMS ? " disabled" : ""}><option value="">Put a thing in the back…</option>${optionsHtml(trunkChoices(), null)}</select></div>
    <div class="lookopts" style="margin-top:0.25rem">${sups}</div>
  </div>`;
}

// ---------- the containers ----------
function cellsHtml(state, ui, s, P, where, spec) {
  const n = spec[where].n;
  if (!n) return "";
  const list = (P.carry && P.carry[where]) || [];
  const sel = ui.gearEdit && ui.gearEdit.sel;
  const cells = [];
  for (let i = 0; i < n; i++) {
    const key = list[i] || null;
    const on = sel && sel.where === where && sel.i === i;
    const kind = where === "pouch" ? POUCH_NAMES[spec.pouch.kinds[i]] || spec.pouch.kinds[i] : where === "pocket" ? "Pocket" : "Pack";
    const why = key ? carryReason(key, where, i, spec) : "";
    const t = key ? `${GEAR[key].name}: ${shortDesc(key)} (${kg(key)} kg, ${itemPoints(key)} points). Click to pick it up, then click where it goes${why ? `. ${why}` : ""}` : `${kind}${where === "pouch" ? " pouch" : ""}: empty. ${sel ? "Click to put the picked thing here" : "Click to pick this spot for the next thing you add"}`;
    const btn = `<button class="sgcell ${key ? "" : "empty"} ${on ? "sel" : ""} ${why ? "bad" : ""}" data-action="sg-cell" data-w="${where}" data-i="${i}"${tip(t)}><span class="sgkind">${esc(kind)}</span><span class="sgname">${key ? esc(GEAR[key].name) : "—"}</span></button>`;
    cells.push(key ? `<span class="sgcellwrap">${btn}<button class="mini" data-action="sg-cell-del" data-w="${where}" data-i="${i}"${tip("Take it out (the points back)")}>×</button></span>` : btn);
  }
  const used = list.filter(Boolean).length;
  const head = where === "pocket" ? `Pockets (${used}/${n}): small things` : where === "pouch" ? `${esc(spec.pouch.name)} pouches (${used}/${n})` : `${esc(spec.pack.name)} (${used}/${n} slots)`;
  return `<div class="sgbox"><span class="small muted">${head}</span><div class="sgcells">${cells.join("")}</div></div>`;
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
    const info = cur ? `<span${tip(GEAR[cur.key] ? GEAR[cur.key].desc : "")}>${r1(itemLoad(cur))} kg · ${slotPoints(slot, cur.key)} pts${GEAR[cur.key] && GEAR[cur.key].desc ? ` — ${esc(shortDesc(cur.key))}` : ""}</span>` : `<span>—</span>`;
    return `<div class="sgslot">
      <span class="sglabel"${tip(SLOT_TIPS[slot])}>${SLOT_LABELS[slot]}</span>
      <select data-action="sg-slot" data-slot="${slot}">
        <option value="-" ${value === "" ? "selected" : ""}>Nothing</option>
        ${optionsHtml(slotChoices(slot), value || null, (k) => slotPoints(slot, k))}
      </select>
      <span></span>
      <div class="sginfo small muted">${info}</div>
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
        <h3>Load</h3>
        <div class="spread"><b>${L.kg} / ${L.max} kg</b><span class="${BAND_CLASS[L.band]}"${tip(bandsTip)}>${L.name}</span></div>
        <div class="bar"${tip(bandsTip)}><i style="width:${pct}%;background:${color}"></i></div>
        <h3>Carried</h3>
        ${cells}${noRig}${noBag}
        ${left.length ? `<div class="small danger">No room for ${esc(left.join(", "))}: ${hard ? "left behind" : "it goes to the hub's armory"}. Take it out or pick a bigger bag.</div>` : ""}
        <div class="row" style="margin-top:0.35rem;gap:0.3rem"><select data-action="sg-item-add"><option value="">Add a thing${sel && !((P.carry && P.carry[sel.where]) || [])[sel.i] ? ` to the ${sel.where === "pouch" ? "pouch" : sel.where} picked` : ""}…</option>${optionsHtml(carryChoices(), null)}</select>
          ${gun ? `<button class="mini" data-action="sg-mags"${tip(`Two spare magazines for the ${s.gear.weapon.name} (${GEAR[gun].name}, ${itemPoints(gun)} points each), where they fit: a pouch, the pack, a pocket`)}>+ 2 spare magazines</button>` : ""}
          <button class="mini" data-action="sg-carry-clear" ${hasPicks(P) && P.carry && CARRY_PLACES.some((w) => (P.carry[w] || []).some(Boolean)) ? "" : "disabled"}${tip("Empty their pockets, pouches and pack (the points back)")}>Empty all</button></div>
        ${vehicleSection(state, ui)}
      </div>
    </div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end;gap:0.3rem">
      <button data-action="sg-dice" data-i="${i}"${tip("Load what the dice rolled for them: skills, traits, what they wear, hold and carry (the points it costs; it may be over)")}>🎲 Start from the dice</button>
      <button data-action="sg-blank" data-i="${i}"${tip("Back to a blank slate: skills 0, no traits, nothing worn or carried (the vehicle's back stays)")}>Clear</button>
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
    if (at) P.carry[at.where][at.i] = x.key; else out.push(GEAR[x.key].name);
  }
  if (out.length) ui.gearEdit.msg = `No room for ${out.join(", ")} any more: taken out (the points back).`;
}
// Puts key in a spot: the spot picked if it is empty (refused with the reason if it does not fit), else where it
// first fits. Returns false (with the window's message) when there is no room.
function putIn(ui, P, s, key) {
  const spec = carrySpec(P, s);
  const sel = ui.gearEdit.sel;
  if (sel && !(P.carry[sel.where] || [])[sel.i]) {
    const why = carryReason(key, sel.where, sel.i, spec);
    if (why) { ui.gearEdit.msg = `${GEAR[key].name}: ${why}`; return false; }
    P.carry[sel.where][sel.i] = key;
    ui.gearEdit.sel = null;
    return true;
  }
  const at = firstFit(P, key, spec);
  if (!at) { ui.gearEdit.msg = `No room for the ${GEAR[key].name}: ${isPocketOnly(spec) ? "only small things go in pockets; pick a bag or a rig" : "every spot it fits is taken"}.`; return false; }
  P.carry[at.where][at.i] = key;
  return true;
}
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
// The vehicle's back: edit it on whoever pays (the owner on the window; nobody yet: the car's owner, else the leader).
function editTrunk(state, ui, fn) {
  if (ui.started || !freeEdit(ui)) return false;
  let o = vehicleOwner(state);
  if (!o) {
    const id = state.hardcore && state.hardcore.start ? state.hardcore.start.carOwner : null;
    o = state.survivors.find((s) => s.id === id) || state.survivors.find((s) => s.leader) || state.survivors[0];
  }
  if (!o) return false;
  const V = sanitizeStartVehicle(o.startVehicle) || { items: [], supplies: {} };
  ui.gearEdit && (ui.gearEdit.msg = "");
  if (fn(V, o) === false) return false;
  o.startVehicle = sanitizeStartVehicle(V);
  o.startCustom = true;
  ui.crewEdited = true;
  return true;
}
const room = (state) => { const info = startVehicleInfo(state); return info ? info.room : 0; };

export const SG_ACTIONS = {
  "sg-open": (state, ui, d) => {
    if (ui.started || !freeEdit(ui)) return false;
    const i = state.survivors.findIndex((s) => s.id === Number(d.id));
    if (i >= 0) ui.gearEdit = { i, sel: null, msg: "" };
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
      const why = carryReason(selKey, where, i, spec) || (here ? carryReason(here, sel.where, sel.i, spec) : "");
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
  "sg-blank": (state, ui, d) => {
    const s = state.survivors[Number(d.i)];
    if (!s || ui.started || !freeEdit(ui)) return false;
    blankPerson(s);
    ui.crewEdited = true;
    if (ui.gearEdit) { ui.gearEdit.sel = null; ui.gearEdit.msg = ""; }
    return true;
  },
  "sg-trunk-del": (state, ui, d) => editTrunk(state, ui, (V) => { if (!V.items[Number(d.i)]) return false; V.items.splice(Number(d.i), 1); }),
  "sg-trunk-clear": (state, ui) => editTrunk(state, ui, (V) => { V.items = []; V.supplies = {}; }),
  "sg-trunk-dice": (state, ui) => editTrunk(state, ui, (V, o) => {
    const dice = (state.survivors.find((s) => s.diceTrunk) || {}).diceTrunk;
    if (!dice) { if (ui.gearEdit) ui.gearEdit.msg = isHardcore(state) ? "The dice put nothing in the back." : "A normal start's pickup comes empty: nothing to load."; return false; }
    V.items = [...dice.items];
    V.supplies = { ...dice.supplies };
  }),
};

export const SG_CHANGE = {
  // "-": nothing there, else the item. A new bag, rig or vest moves what no longer fits.
  "sg-slot": (state, ui, el) => edit(state, ui, (P, s) => {
    const slot = el.dataset.slot, v = el.value;
    if (!START_GEAR.SLOTS.includes(slot)) return false;
    for (const k of START_GEAR.SLOTS) if (!(k in P.slots)) P.slots[k] = s.gear[k] ? s.gear[k].key : ""; // every slot named under Customize
    P.slots[slot] = v === "-" || !v ? "" : v;
    if (["backpack", "rig", "armor"].includes(slot)) reflow(ui, P, s);
    ui.gearEdit.sel = null;
  }),
  "sg-item-add": (state, ui, el) => edit(state, ui, (P, s) => {
    if (!el.value || !GEAR[el.value]) return false;
    if (!putIn(ui, P, s, el.value)) return false;
  }),
  "sg-trunk-add": (state, ui, el) => editTrunk(state, ui, (V) => {
    const k = el.value;
    if (!k || !GEAR[k]) return false;
    if (V.items.length >= START_TRUNK.ITEMS) { if (ui.gearEdit) ui.gearEdit.msg = `At most ${START_TRUNK.ITEMS} things in the back.`; return false; }
    if (trunkKg(V) + kg(k) > room(state) + 1e-9) { if (ui.gearEdit) ui.gearEdit.msg = `No room in the back for the ${GEAR[k].name} (${kg(k)} kg; ${r1(Math.max(0, room(state) - trunkKg(V)))} kg left).`; return false; }
    V.items.push(k);
  }),
  "sg-trunk-sup": (state, ui, el) => editTrunk(state, ui, (V) => {
    const k = el.dataset.k, cap = START_TRUNK.SUPPLIES[k];
    if (!cap) return false;
    let n = Math.max(0, Math.min(cap, Math.round(Number(el.value) || 0)));
    const w = SUPPLIES[k] ? SUPPLIES[k].weight || 0 : 0;
    const other = trunkKg({ ...V, supplies: { ...V.supplies, [k]: 0 } });
    if (w > 0 && other + n * w > room(state)) { n = Math.max(0, Math.floor((room(state) - other) / w)); if (ui.gearEdit) ui.gearEdit.msg = `Only room for ${n} ${SUP_LABELS[k].toLowerCase()} in the back.`; }
    if (n) V.supplies[k] = n; else delete V.supplies[k];
  }),
  // Who pays: the back moves to them (in Hardcore they own the car).
  "sg-trunk-owner": (state, ui, el) => {
    if (ui.started || !freeEdit(ui)) return false;
    const to = state.survivors.find((s) => s.id === Number(el.value));
    if (!to) return false;
    const from = vehicleOwner(state);
    const V = sanitizeStartVehicle(from && from.startVehicle) || { items: [], supplies: {} };
    for (const s of state.survivors) delete s.startVehicle;
    to.startVehicle = V;
    to.startCustom = true;
    ui.crewEdited = true;
    return true;
  },
};
