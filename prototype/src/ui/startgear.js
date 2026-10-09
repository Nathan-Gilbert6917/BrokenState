// Starting gear on the new-run screen (2026-10-08, user request; sim/startgear.js has the rules): with Customize ticked
// (not with Ironman) each crew card shows the colonist's load and a Gear… button, which opens this window: every worn
// and held slot picked from the catalogue (or nothing, or back to the dice), and what they carry (as rolled, or a list
// of their own placed where it fits). Every change builds the world again on the same seed (main.js gearRebuild), so
// what the window shows is what they start with: the load, what went where, what had no room.
// HTML builders plus their action handlers; main.js registers them (an action returning true asks for the rebuild).
import { GEAR } from "../sim/data.js";
import { isHardcore } from "../sim/hardcore.js";
import { POCKETS, packOf, rigOf, rigPouches, itemLoad } from "../sim/inventory.js";
import { LOAD_BANDS } from "../sim/load.js";
import { START_GEAR, slotChoices, carryChoices, sanitizeStartGear, hasPicks, kitLoad } from "../sim/startgear.js";
import { magFitsGun } from "../sim/mags.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const freeEdit = (ui) => !!ui.freeEdit && !ui.ironman; // Customize, as ui/newgame.js
const SLOT_LABELS = { weapon: "Hands", tool: "Off hand", armor: "Body", head: "Head", arms: "Arms", legs: "Legs", rig: "Rig", backpack: "Bag" };
const SLOT_TIPS = {
  weapon: "The weapon in their hands",
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

// The catalogue as a select: grouped by category, each with its weight; its description on hover.
function optionsHtml(keys, current) {
  const groups = {};
  for (const k of keys) (groups[GEAR[k].cat || "other"] = groups[GEAR[k].cat || "other"] || []).push(k);
  return Object.keys(groups).sort((a, b) => catOrder(a) - catOrder(b) || a.localeCompare(b)).map((c) => {
    const list = groups[c].sort((a, b) => GEAR[a].name.localeCompare(GEAR[b].name));
    return `<optgroup label="${esc(CAT_NAME[c] || c.replace(/^./, (x) => x.toUpperCase()))}">${list.map((k) => `<option value="${k}" ${k === current ? "selected" : ""} title="${esc(GEAR[k].desc || "")}">${esc(GEAR[k].name)} · ${kgText(k)}</option>`).join("")}</optgroup>`;
  }).join("");
}

// ---------- the crew card's row ----------
const BAND_CLASS = ["", "warn", "warn", "danger"];
const bandsTip = `Load bands by felt weight: ${LOAD_BANDS.map((b) => (Number.isFinite(b.upTo) ? `${b.name} up to ${b.upTo} kg` : `${b.name} above`)).join(", ")}. Heavier is slower and hungrier on the road and slower in a fight. On a trip the team's supplies are shared out on top.`;
export function loadText(s) {
  const L = kitLoad(s);
  return `<span class="small ${BAND_CLASS[L.band]}"${tip(`Their own kit: ${L.kg} kg of the ${L.max} kg they can carry. ${bandsTip}`)}>${L.kg} / ${L.max} kg · ${L.name}</span>`;
}
const pickCount = (P) => (P ? Object.keys(P.slots || {}).length + (Array.isArray(P.items) ? 1 : 0) : 0);
export function gearRow(state, s) {
  const n = pickCount(sanitizeStartGear(s.startGear));
  return `<div class="row" style="margin-top:0.3rem;gap:0.35rem">
    <button class="mini" data-action="sg-open" data-id="${s.id}"${tip("Pick what they wear, hold and carry: any item, free, like skills under Customize. Not for Ironman.")}>🎒 Gear…</button>
    ${loadText(s)}${n ? ` <span class="chip on"${tip("Gear picked on this screen (the rest is as rolled)")}>✎ ${n} picked</span>` : ""}</div>`;
}

// ---------- the window ----------
export function startGearEditor(state, ui) {
  const i = ui.gearEdit ? ui.gearEdit.i : -1, s = state.survivors[i];
  if (!s) return `<div class="box"><h1>Starting gear</h1><div class="muted">Nobody to dress.</div><div class="row" style="justify-content:flex-end"><button class="primary" data-action="sg-close">Done</button></div></div>`;
  const hard = isHardcore(state);
  const P = sanitizeStartGear(s.startGear) || { slots: {} };
  const extra = s.startGear || {}; // what the last rebuild wrote: the dice's items, what had no room
  const who = state.survivors.map((o, j) => `<button class="mini ${j === i ? "active" : ""}" data-action="sg-who" data-i="${j}"${tip(`${o.name}: ${kitLoad(o).kg} kg`)}>${o.leader ? "★ " : ""}${esc(o.name.split(" ")[0])}${hasPicks(sanitizeStartGear(o.startGear)) ? " ✎" : ""}</button>`).join("");
  const L = kitLoad(s);
  const pct = Math.min(100, Math.round((L.kg / Math.max(1, L.max)) * 100));
  const color = ["var(--good)", "#ffd166", "var(--accent)", "var(--danger)"][L.band];
  const slots = START_GEAR.SLOTS.map((slot) => {
    const picked = slot in P.slots, cur = s.gear[slot];
    const was = picked && extra.rolled && slot in extra.rolled ? extra.rolled[slot] || "nothing" : null;
    const value = picked ? P.slots[slot] || "-" : "";
    // What is there now: its weight as worn (a carrier with its plates, a gun with its parts) and the first line of its description.
    const info = cur ? `<span${tip(GEAR[cur.key] ? GEAR[cur.key].desc : "")}>${r1(itemLoad(cur))} kg${GEAR[cur.key] && GEAR[cur.key].desc ? ` — ${esc(shortDesc(cur.key))}` : ""}</span>` : `<span>—</span>`;
    return `<div class="sgslot">
      <span class="sglabel"${tip(SLOT_TIPS[slot])}>${SLOT_LABELS[slot]}</span>
      <select data-action="sg-slot" data-slot="${slot}">
        <option value="" ${value === "" ? "selected" : ""}>As rolled${picked ? (was ? ` (was ${esc(was)})` : "") : ` (${esc(cur ? cur.name : "nothing")})`}</option>
        <option value="-" ${value === "-" ? "selected" : ""}>Nothing</option>
        ${optionsHtml(slotChoices(slot), picked ? P.slots[slot] : null)}
      </select>
      ${picked ? `<span class="chip on"${tip("Picked here. As rolled puts the dice's back")}>✎</span>` : `<span class="chip"${tip(hard ? "What the dice say they grabbed" : "What the dice handed them")}>🎲</span>`}
      <div class="sginfo small muted">${info}</div>
    </div>`;
  }).join("");
  // Where everything they carry is.
  const names = (list) => list.filter(Boolean).map((it) => `<span class="chip"${tip(GEAR[it.key] ? `${GEAR[it.key].desc || ""} (${kg(it.key)} kg)` : "")}>${esc(it.name)}</span>`).join("") || `<span class="small muted">empty</span>`;
  const pk = packOf(s), rp = rigOf(s) ? rigPouches(s) : null;
  const where = `<div class="sgwhere small">
      <div><span class="muted">Pockets (${s.pockets.filter(Boolean).length}/${POCKETS})</span> ${names(s.pockets)}</div>
      ${rp ? `<div><span class="muted">${esc(rigOf(s).name)} pouches (${rp.filter(Boolean).length}/${rp.length})</span> ${names(rp)}</div>` : ""}
      ${pk ? `<div><span class="muted">${esc(s.gear.backpack.name)} (${pk.filter(Boolean).length}/${pk.length})</span> ${names(pk)}</div>` : `<div class="muted">No bag: only what fits the pockets${rp ? " and pouches" : ""}.</div>`}
    </div>`;
  const own = Array.isArray(P.items);
  const left = [...(extra.left || [])];
  const list = own ? P.items.map((k, j) => {
    const at = left.indexOf(GEAR[k].name), off = at >= 0;
    if (off) left.splice(at, 1);
    return `<span class="chip ${off ? "off" : ""}"${tip(`${GEAR[k].desc || ""} (${kg(k)} kg)${off ? `. No room for it: ${hard ? "left behind" : "it goes to the hub's armory"}` : ""}`)}>${esc(GEAR[k].name)} <button class="mini" data-action="sg-item-del" data-i="${j}"${tip("Take it out")}>×</button></span>`;
  }).join("") || `<span class="small muted">Nothing: empty pockets.</span>` : "";
  const noRoom = (extra.left || []).length;
  const replacedTo = hard ? "is left behind (not grabbed)" : "goes to the hub's armory";
  return `<div class="box wide"><h1>Starting gear</h1>
    <div class="row" style="gap:0.25rem;margin-bottom:0.5rem">${who}</div>
    <div class="where">What ${esc(s.name)} starts with. Any item, free, like skills under Customize; a slot left <b>As rolled</b> keeps the dice${hard ? " (what they grabbed as they fled)" : " (what the hub handed them)"}. What a pick replaces ${replacedTo}. Picked things are new. A picked gun comes with its rounds (a full load and two more, to the ${hard ? "team's" : "hub's"} stock) and two spare magazines where it takes them; a launcher with ${START_GEAR.LAUNCH} rounds, a bow with ${START_GEAR.ARROWS} arrows. Not for Ironman.</div>
    <div class="sgedit">
      <div class="sgcol">
        <h3>Worn and held</h3>
        ${slots}
        ${extra.rig ? `<div class="small danger">${esc(extra.rig)} The rig ${hard ? "is left behind" : "goes to the armory"}.</div>` : ""}
      </div>
      <div class="sgcol">
        <h3>Load</h3>
        <div class="spread"><b>${L.kg} / ${L.max} kg</b><span class="${BAND_CLASS[L.band]}"${tip(bandsTip)}>${L.name}</span></div>
        <div class="bar"${tip(bandsTip)}><i style="width:${pct}%;background:${color}"></i></div>
        <div class="small muted" style="margin-top:0.2rem">Their own kit (worn, held, pockets, pouches, pack). On a trip the team's food, water and rounds are shared out on top.</div>
        <h3>Carried</h3>
        <div class="row" style="gap:0.3rem">
          <button class="mini ${own ? "" : "active"}" data-action="sg-items-rolled"${tip("What the dice gave them to carry (with a new gun or bag, put back where it fits)")}>🎲 As rolled</button>
          <button class="mini ${own ? "active" : ""}" data-action="sg-items-own"${tip("A list of your own, starting from what they carry now. Placed where it fits: magazines, grenades, a radio and meds in matching rig pouches, small things in the pockets, the rest in the bag")}>✎ My own list</button>
        </div>
        ${where}
        ${own ? `<div style="margin-top:0.35rem"><span class="small muted">Your list (${P.items.length}/${START_GEAR.ITEMS})</span> ${list}</div>
        ${noRoom ? `<div class="small danger">No room for ${noRoom === 1 ? "one thing" : `${noRoom} things`} (marked): pick a bigger bag or a rig, or it ${hard ? "is left behind" : "goes to the hub's armory"}.</div>` : ""}
        <div class="row" style="margin-top:0.3rem"><select data-action="sg-item-add"${P.items.length >= START_GEAR.ITEMS ? " disabled" : ""}><option value="">Add a thing…</option>${optionsHtml(carryChoices(), null)}</select></div>` : ""}
      </div>
    </div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end">
      <button data-action="sg-reset" ${hasPicks(P) ? "" : "disabled"}${tip("Everything back to the dice for this colonist")}>🎲 All as rolled</button>
      <span style="flex:1"></span>
      <button class="primary" data-action="sg-close">Done</button>
    </div></div>`;
}

// ---------- actions (registered in main.js; true: build the world again for the change) ----------
function edit(state, ui, fn) {
  const s = ui.gearEdit && state.survivors[ui.gearEdit.i];
  if (!s || ui.started || !freeEdit(ui)) return false;
  const P = sanitizeStartGear(s.startGear) || { slots: {} };
  if (fn(P, s) === false) return false;
  s.startGear = sanitizeStartGear(P);
  s.startCustom = true; // Customize: Ironman puts it back, Start refuses it in an Ironman run
  ui.crewEdited = true;
  return true;
}
// What they carry now, as a list of their own (magazines that come with a picked gun again are left out).
function carriedNow(s, P) {
  const ok = new Set(carryChoices());
  const gun = P.slots.weapon ? s.gear.weapon : null;
  const all = [...s.pockets, ...(rigOf(s) ? rigPouches(s) : []), ...(packOf(s) || [])].filter(Boolean);
  return all.filter((it) => ok.has(it.key) && !(gun && GEAR[it.key].mag && magFitsGun(gun.key, it.key))).map((it) => it.key).slice(0, START_GEAR.ITEMS);
}

export const SG_ACTIONS = {
  "sg-open": (state, ui, d) => {
    if (ui.started || !freeEdit(ui)) return false;
    const i = state.survivors.findIndex((s) => s.id === Number(d.id));
    if (i >= 0) ui.gearEdit = { i };
    return false;
  },
  "sg-close": (state, ui) => { ui.gearEdit = null; return false; },
  "sg-who": (state, ui, d) => { if (ui.gearEdit && state.survivors[Number(d.i)]) ui.gearEdit.i = Number(d.i); return false; },
  "sg-reset": (state, ui) => edit(state, ui, (P) => { if (!hasPicks(P)) return false; P.slots = {}; delete P.items; }),
  "sg-items-rolled": (state, ui) => edit(state, ui, (P) => { if (!Array.isArray(P.items)) return false; delete P.items; }),
  "sg-items-own": (state, ui) => edit(state, ui, (P, s) => { if (Array.isArray(P.items)) return false; P.items = carriedNow(s, P); }),
  "sg-item-del": (state, ui, d) => edit(state, ui, (P) => { if (!Array.isArray(P.items)) return false; P.items.splice(Number(d.i), 1); }),
};

export const SG_CHANGE = {
  // "": as rolled, "-": nothing there, else the item.
  "sg-slot": (state, ui, el) => edit(state, ui, (P) => {
    const slot = el.dataset.slot, v = el.value;
    if (!START_GEAR.SLOTS.includes(slot)) return false;
    if (v === "") delete P.slots[slot];
    else P.slots[slot] = v === "-" ? "" : v;
  }),
  "sg-item-add": (state, ui, el) => edit(state, ui, (P) => {
    if (!el.value || !GEAR[el.value]) return false;
    if (!Array.isArray(P.items)) P.items = [];
    P.items.push(el.value);
  }),
};
