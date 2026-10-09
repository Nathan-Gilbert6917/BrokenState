// Custom backgrounds editor (2026-10-07, user request): the new-run screen's "Backgrounds…" window, where the player
// makes their own backgrounds (sim/custombg.js) for a Hardcore start: skill bumps, traits, what they wear and hold, what
// they carry, the supplies on them, how likely the car is theirs, which car and what is in its back. Kept in this
// browser (localStorage BG_KEY); a world built with them keeps its own copy. Not in an Ironman run: the button is off
// while Ironman is ticked. HTML builders plus their action handlers; main.js registers them (bg-close there: closing
// the window rebuilds the world when a colonist's background was changed in it).
import { GEAR, SKILLS, SKILL_NAMES } from "../sim/data.js";
import { VEHICLE_TYPES } from "../sim/vehicles.js";
import { HC_START } from "../sim/hardcore-start.js";
import { traitPickerHtml, traitBlock } from "./traitpick.js"; // the traits, good and bad, none that clash
import {
  CUSTOM_BG, blankBackground, sanitizeBackground, sanitizeLibrary, newBackgroundId, slotOptions, carryOptions, trunkOptions, carTypes, customTraitKeys, backgroundSummary,
} from "../sim/custombg.js";
import { POCKETS } from "../sim/inventory.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const SLOT_LABELS = { weapon: "Hands", tool: "Off hand", armor: "Body", head: "Head", arms: "Arms", legs: "Legs", backpack: "Bag" };
const SUP_LABELS = { food: "Food", water: "Water", ammo: "Ammo", arrows: "Arrows", meds: "Meds", fuel: "Fuel", scrap: "Scrap", parts: "Parts" };

// ---------- the list, kept in this browser ----------
const BG_KEY = "brokenstate.customBackgrounds";
let lib = load();
function load() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(BG_KEY) : null;
    return sanitizeLibrary(raw ? JSON.parse(raw) : []);
  } catch {
    return {};
  }
}
function store() {
  try { localStorage.setItem(BG_KEY, JSON.stringify(Object.values(lib))); } catch { /* storage blocked: keep for this session */ }
}
// The backgrounds the player has made ({ id: background }): what createWorld gets (main.js newWorld).
export const customLibrary = () => lib;
// Tools and tests: replace the list (not stored).
export function setCustomLibrary(list) { lib = sanitizeLibrary(list); }

// ---------- a preset as a starting point ----------
// The dice made exact: the middle of each roll, the likeliest pick of each table (the bag, the weapon and the vest when
// the background has them at least half the time), its three likeliest things, the middle of its trunk.
const top = (table, n = 1) => Object.entries(table || {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k);
const mid = (r) => Math.round((r[0] + r[1]) / 2);
export function presetToCustom(key, id) {
  const C = HC_START, A = C.ARCHETYPES[key];
  if (!A) return blankBackground(id);
  const def = blankBackground(id);
  def.name = `${A.name} (custom)`.slice(0, CUSTOM_BG.NAME);
  def.blurb = A.blurb || "";
  for (const [k, r] of Object.entries(A.skills || {})) def.skills[k] = Math.min(CUSTOM_BG.SKILL, mid(r));
  def.traits = top(A.traits, 1).filter((t) => customTraitKeys().includes(t));
  if (key === "prepper") {
    const P = C.PREPPER;
    def.gear = { backpack: P.BAG, weapon: top(P.GUNS)[0] };
    def.items = [...P.KIT, ...top(P.EXTRA, 2)];
    def.supplies = { food: P.FOOD, water: P.WATER, meds: P.MEDS, ammo: P.AMMO };
  } else {
    if ((A.pack ?? C.PACK) >= 0.5) def.gear.backpack = top(A.packs || C.PACKS)[0];
    if ((A.weaponOdds ?? C.WEAPON.pack) >= 0.5) def.gear.weapon = top(A.weapons || C.WEAPONS)[0];
    for (const [k, odds] of Object.entries(A.armor || {})) if (odds >= 0.5) def.gear[GEAR[k].slot] = k;
    def.items = top(A.stuff || {}, 3);
    const F = A.food || C.FOOD;
    def.supplies = { food: mid(def.gear.backpack ? F.pack : F.pockets), water: mid(def.gear.backpack ? C.WATER.pack : C.WATER.pockets) };
    const w = def.gear.weapon, rr = w && C.ROUNDS[w];
    if (rr) def.supplies.ammo = Math.round(mid(rr) * (A.rounds || 1));
    if (w && GEAR[w].cat === "bow") def.supplies.arrows = 12;
    if (A.meds) def.supplies.meds = mid(A.meds);
  }
  const T = A.trunk || {};
  def.car = { odds: A.carOdds ?? 1, type: top(A.cars)[0] || null, trunk: {}, items: top(T.gear, T.n ? T.n[1] : 0) };
  for (const k of Object.keys(CUSTOM_BG.TRUNK)) if (T[k]) def.car.trunk[k] = mid(T[k]);
  return sanitizeBackground(def, id);
}

// ---------- what fits ----------
// Where the things go (as sim/hardcore-start.js rollCustom puts them): a tool to the off hand if free, small things
// to the four pockets, the rest to the bag. Returns { left: [keys], kg }.
export function fitCheck(def) {
  let tool = !!def.gear.tool, pockets = POCKETS, bag = def.gear.backpack ? GEAR[def.gear.backpack].slots || 0 : 0;
  const left = [];
  let kg = 0;
  for (const k of Object.values(def.gear)) kg += GEAR[k].weight ?? 1;
  for (const k of def.items) {
    const g = GEAR[k];
    kg += g.weight ?? 1;
    if (g.slot === "tool" && !tool) tool = true;
    else if (g.small && pockets > 0) pockets--;
    else if (bag > 0) bag--;
    else left.push(k);
  }
  return { left, kg: Math.round(kg * 10) / 10 };
}

// ---------- the window ----------
const gearName = (k) => (GEAR[k] ? GEAR[k].name : k);
const byName = (keys) => [...keys].sort((a, b) => gearName(a).localeCompare(gearName(b)));
function select(action, current, keys, none, extra = "") {
  return `<select data-action="${action}"${extra}>${none ? `<option value="">${none}</option>` : ""}${keys.map((k) => `<option value="${k}" ${k === current ? "selected" : ""}>${esc(gearName(k))}</option>`).join("")}</select>`;
}
function num(action, value, max, extra = "", t = "") {
  return `<input type="number" min="0" max="${max}" step="1" style="width:4.2rem" data-action="${action}"${extra} value="${value || 0}"${tip(t)}>`;
}

export function backgroundEditor(state, ui) {
  const ids = Object.keys(lib);
  const sel = ui.bgEditor && lib[ui.bgEditor.sel] ? lib[ui.bgEditor.sel] : null;
  const list = ids.length
    ? ids.map((id) => `<button class="bgitem ${sel && sel.id === id ? "active" : ""}" data-action="bg-sel" data-id="${id}"${tip(backgroundSummary(lib[id], SKILL_NAMES))}><b>${esc(lib[id].name)}</b><span class="small muted">${esc(lib[id].blurb || backgroundSummary(lib[id], SKILL_NAMES))}</span></button>`).join("")
    : `<div class="small muted">None yet. Make one, or start from a preset.</div>`;
  const presets = Object.entries(HC_START.ARCHETYPES).map(([k, a]) => `<option value="${k}">${esc(a.name)}</option>`).join("");
  const full = ids.length >= CUSTOM_BG.MAX;
  return `<div class="box wide"><h1>Custom backgrounds</h1>
    <div class="where">Who your survivors were, made your way: skill bumps, traits, what they wear, hold and carry, the supplies on them and the car. No dice: they start with exactly this. In Hardcore it is what they fled with; in a normal start their kit replaces what the hub handed them (that goes to the armory), the supplies and the car's back go to the hub's stores, and the car parks at the hub. Pick one for a colonist on the new-run screen with Customize ticked. Kept in this browser. Not for Ironman runs.</div>
    <div class="bgedit">
      <div class="bglist">
        ${list}
        <div class="row" style="margin-top:0.4rem">
          <button data-action="bg-new" ${full ? "disabled" : ""}${tip(full ? `At most ${CUSTOM_BG.MAX}` : "A blank background")}>+ New</button>
          <select data-action="bg-copy" ${full ? "disabled" : ""}${tip("Start from a preset background: its dice made exact (the middle of each roll, its likeliest bag, weapon and things)")}><option value="">From a preset…</option>${presets}</select>
        </div>
      </div>
      <div class="bgform">${sel ? form(sel, ui) : `<div class="muted">Pick a background on the left, or make a new one.</div>`}</div>
    </div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end">
      ${sel ? `<button data-action="bg-dup" ${full ? "disabled" : ""}${tip("A copy of this background")}>Duplicate</button>
      <button class="${ui.bgEditor.confirmDel ? "danger" : ""}" data-action="bg-del"${tip("Delete this background. Colonists who had it go back to the dice")}>${ui.bgEditor.confirmDel ? "Really delete?" : "Delete"}</button>` : ""}
      <span style="flex:1"></span>
      <button class="primary" data-action="bg-close">Done</button>
    </div></div>`;
}

function form(d, ui) {
  const C = CUSTOM_BG;
  const skills = SKILLS.map((k) => `<label class="nrskill"><span>${SKILL_NAMES[k]}</span> +${num("bg-skill", d.skills[k], C.SKILL, ` data-k="${k}"`, `Added to their own ${SKILL_NAMES[k]} (0–${C.SKILL}; a skill tops out at 20)`)}</label>`).join("");
  const traits = traitPickerHtml(customTraitKeys(), d.traits, C.TRAITS, `data-action="bg-trait"`);
  const gear = C.SLOTS.map((slot) => `<label class="lookopt">${SLOT_LABELS[slot]}${select("bg-gear", d.gear[slot], byName(slotOptions(slot)), "None", ` data-slot="${slot}"`)}</label>`).join("");
  const fit = fitCheck(d);
  const items = d.items.map((k, i) => `<span class="chip ${fit.left.includes(k) ? "off" : ""}">${esc(gearName(k))} <button class="mini" data-action="bg-item-del" data-i="${i}"${tip("Take it out")}>×</button></span>`).join("");
  const sups = Object.entries(C.SUPPLY).map(([k, cap]) => `<label class="lookopt">${SUP_LABELS[k]}${num("bg-sup", d.supplies[k], cap, ` data-k="${k}"`, `${SUP_LABELS[k]} on them, 0–${cap}, pooled with the team's (a day's ration is 1 food and 1 water)`)}</label>`).join("");
  const trunk = Object.entries(C.TRUNK).map(([k, cap]) => `<label class="lookopt">${SUP_LABELS[k]}${num("bg-trunk", d.car.trunk[k], cap, ` data-k="${k}"`, `${SUP_LABELS[k]} in the back of the car, 0–${cap}`)}</label>`).join("");
  const trunkItems = d.car.items.map((k, i) => `<span class="chip">${esc(gearName(k))} <button class="mini" data-action="bg-trunk-del" data-i="${i}"${tip("Take it out")}>×</button></span>`).join("");
  const cars = carTypes().map((k) => `<option value="${k}" ${d.car.type === k ? "selected" : ""}>${esc(VEHICLE_TYPES[k].name)}</option>`).join("");
  return `<div class="row"><label class="lookopt" style="flex:1">Name<input data-action="bg-name" value="${esc(d.name)}" maxlength="${C.NAME}"></label>
      <label class="lookopt" style="flex:2">Who they were (a few words)<input data-action="bg-blurb" value="${esc(d.blurb)}" maxlength="${C.BLURB}" placeholder="came off a double shift"></label></div>
    <h3>Skills <span class="small muted">(added to what they rolled)</span></h3><div class="nrskills">${skills}</div>
    <h3>Traits <span class="small muted">(up to ${C.TRAITS}, always given; they go first)</span></h3>${traits}
    <h3>Worn and held</h3><div class="lookopts">${gear}</div>
    <h3>Carried <span class="small muted">(${d.items.length}/${C.ITEMS}: a tool to the off hand, small things to the ${POCKETS} pockets, the rest to the bag; about ${fit.kg} kg with the gear)</span></h3>
    <div>${items || `<span class="small muted">Nothing.</span>`}</div>
    ${fit.left.length ? `<div class="small danger">No room for ${esc(fit.left.map(gearName).join(", "))}: pick a bigger bag, or it is left behind.</div>` : ""}
    <div class="row" style="margin-top:0.3rem">${select("bg-item-add", "", byName(carryOptions()), "Add a thing…", d.items.length >= C.ITEMS ? " disabled" : "")}</div>
    <h3>Supplies on them <span class="small muted">(on top of the team's 1–3 days)</span></h3><div class="lookopts">${sups}</div>
    <h3>The car</h3>
    <div class="lookopts">
      <label class="lookopt"${tip(`How likely the car the team fled in is theirs, 0–${C.CAR_ODDS}, against the others' (the presets are 0.7–1.6; 0: never theirs, ${C.CAR_ODDS}: almost always). The car, its kind and its back are the owner's.`)}>Theirs (odds)<input type="number" min="0" max="${C.CAR_ODDS}" step="0.1" style="width:4.2rem" data-action="bg-carodds" value="${d.car.odds}"></label>
      <label class="lookopt">Kind<select data-action="bg-cartype"><option value="">Any (sedan or truck)</option>${cars}</select></label>
      ${trunk}
    </div>
    <div style="margin-top:0.3rem">${trunkItems || `<span class="small muted">Nothing else in the back.</span>`}</div>
    <div class="row" style="margin-top:0.3rem">${select("bg-trunk-add", "", byName(trunkOptions()), "Put a thing in the back…", d.car.items.length >= C.TRUNK_ITEMS ? " disabled" : "")}</div>`;
}

// ---------- actions ----------
// Every change: the background made safe again, stored, and marked changed (bg-close rebuilds the world for it).
function edit(ui, fn) {
  const d = ui.bgEditor && lib[ui.bgEditor.sel];
  if (!d) return;
  fn(d);
  lib[d.id] = sanitizeBackground(d, d.id);
  ui.bgEditor.confirmDel = false;
  mark(ui, d.id);
  store();
}
const mark = (ui, id) => { (ui.bgEditor.changed = ui.bgEditor.changed || []).includes(id) || ui.bgEditor.changed.push(id); };
function add(ui, def) {
  if (Object.keys(lib).length >= CUSTOM_BG.MAX) return;
  lib[def.id] = sanitizeBackground(def, def.id);
  ui.bgEditor.sel = def.id;
  ui.bgEditor.confirmDel = false;
  store();
}

export const BG_ACTIONS = {
  "bg-open": (state, ui) => { if (!ui.ironman && !ui.started) ui.bgEditor = { sel: Object.keys(lib)[0] || null, changed: [], confirmDel: false }; },
  "bg-sel": (state, ui, d) => { if (lib[d.id]) { ui.bgEditor.sel = d.id; ui.bgEditor.confirmDel = false; } },
  "bg-new": (state, ui) => add(ui, blankBackground(newBackgroundId(lib))),
  "bg-dup": (state, ui) => { const d = lib[ui.bgEditor.sel]; if (d) add(ui, { ...JSON.parse(JSON.stringify(d)), id: newBackgroundId(lib), name: `${d.name} (2)`.slice(0, CUSTOM_BG.NAME) }); },
  "bg-del": (state, ui) => {
    const id = ui.bgEditor.sel;
    if (!lib[id]) return;
    if (!ui.bgEditor.confirmDel) { ui.bgEditor.confirmDel = true; return; }
    delete lib[id];
    mark(ui, id);
    ui.bgEditor.sel = Object.keys(lib)[0] || null;
    ui.bgEditor.confirmDel = false;
    store();
  },
  "bg-trait": (state, ui, d) => edit(ui, (b) => { b.traits = b.traits.includes(d.k) ? b.traits.filter((t) => t !== d.k) : traitBlock(b.traits, d.k, CUSTOM_BG.TRAITS) ? b.traits : [...b.traits, d.k]; }),
  "bg-item-del": (state, ui, d) => edit(ui, (b) => { b.items.splice(Number(d.i), 1); }),
  "bg-trunk-del": (state, ui, d) => edit(ui, (b) => { b.car.items.splice(Number(d.i), 1); }),
};

export const BG_CHANGE = {
  "bg-copy": (state, ui, el) => { if (el.value) add(ui, presetToCustom(el.value, newBackgroundId(lib))); },
  "bg-name": (state, ui, el) => edit(ui, (b) => { b.name = el.value; }),
  "bg-blurb": (state, ui, el) => edit(ui, (b) => { b.blurb = el.value; }),
  "bg-skill": (state, ui, el) => edit(ui, (b) => { b.skills[el.dataset.k] = Number(el.value); }),
  "bg-gear": (state, ui, el) => edit(ui, (b) => { b.gear[el.dataset.slot] = el.value || null; }),
  "bg-item-add": (state, ui, el) => edit(ui, (b) => { if (el.value) b.items.push(el.value); }),
  "bg-sup": (state, ui, el) => edit(ui, (b) => { b.supplies[el.dataset.k] = Number(el.value); }),
  "bg-carodds": (state, ui, el) => edit(ui, (b) => { b.car.odds = Number(el.value); }),
  "bg-cartype": (state, ui, el) => edit(ui, (b) => { b.car.type = el.value || null; }),
  "bg-trunk": (state, ui, el) => edit(ui, (b) => { b.car.trunk[el.dataset.k] = Number(el.value); }),
  "bg-trunk-add": (state, ui, el) => edit(ui, (b) => { if (el.value) b.car.items.push(el.value); }),
};
