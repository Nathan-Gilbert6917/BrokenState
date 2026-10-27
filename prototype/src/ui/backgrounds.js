// Custom backgrounds editor (2026-10-07, user request): the new-run screen's "Backgrounds…" window, where the player
// makes their own backgrounds (sim/custombg.js) for a Hardcore start: skill bumps, traits, what they wear and hold, what
// they carry, the supplies on them, how likely the car is theirs, which car and what is in its back. Kept in this
// browser (localStorage BG_KEY); a world built with them keeps its own copy. Not in an Ironman run: the button is off
// while Ironman is ticked. HTML builders plus their action handlers; main.js registers them (bg-close there: closing
// the window rebuilds the world when a colonist's background was changed in it).
import { isRoadStart } from "../sim/roadstart.js";
import { GEAR, SKILLS, SKILL_NAMES, SUPPLIES } from "../sim/data.js";
import { VEHICLE_TYPES } from "../sim/vehicles.js";
import { HC_START } from "../sim/hardcore-start.js";
import { traitPickerHtml, traitBlock } from "./traitpick.js"; // the traits, good and bad, none that clash
import {
  CUSTOM_BG, blankBackground, sanitizeBackground, sanitizeLibrary, newBackgroundId, slotOptions, carryOptions, trunkOptions, carTypes, customTraitKeys, backgroundSummary,
  roundOptions, bgCals, roundsOf,
} from "../sim/custombg.js";
import { ROUND_SUPPLIES, CALIBERS } from "../sim/data-ammo.js"; // rounds by calibre and type
import { POCKETS } from "../sim/inventory.js";
import { backgroundPoints, pointsMax } from "../sim/custompoints.js"; // what it comes to under Customize
import { cleanTier, tierCount } from "../sim/traits.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const SLOT_LABELS = { weapon: "Hands", tool: "Off hand", armor: "Body", head: "Head", arms: "Arms", legs: "Legs", backpack: "Bag" };
const SUP_LABELS = { food: "Food", water: "Water", ammo: "Ammo", arrows: "Arrows", meds: "Meds", fuel: "Fuel", scrap: "Scrap", parts: "Parts" };
const supLabel = (k) => SUP_LABELS[k] || (SUPPLIES[k] ? SUPPLIES[k].name : k); // the materials by their own names (wood, stone, building materials…)

// ---------- the list, kept in this browser ----------
const BG_KEY = "brokenstate.customBackgrounds";
let migrated = false;
let lib = load();
if (migrated) store(); // a list saved before rounds went by calibre: kept as rounds now (sim/custombg.js)
function load() {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(BG_KEY) : null;
    migrated = !!raw && /"ammo":/.test(raw);
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
  for (const k of [...Object.keys(CUSTOM_BG.TRUNK), "ammo"]) if (T[k]) def.car.trunk[k] = mid(T[k]); // ammo: sanitized into the rounds of its guns
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
      <div class="bgform">${sel ? form(sel, ui, state) : `<div class="muted">Pick a background on the left, or make a new one.</div>`}</div>
    </div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end">
      ${sel ? `<button data-action="bg-dup" ${full ? "disabled" : ""}${tip("A copy of this background")}>Duplicate</button>
      <button class="${ui.bgEditor.confirmDel ? "danger" : ""}" data-action="bg-del"${tip("Delete this background. Colonists who had it go back to the dice")}>${ui.bgEditor.confirmDel ? "Really delete?" : "Delete"}</button>` : ""}
      <span style="flex:1"></span>
      <button class="primary" data-action="bg-close">Done</button>
    </div></div>`;
}

// What the background comes to under Customize: the line with its Total (form; BG_INPUT redraws only this line while
// a number is typed, so the box keeps its focus and caret).
export function costLineHtml(d, state) {
  // Under Customize a colonist with this background pays for what it gives (sim/custompoints.js backgroundPoints): its
  // skill bumps (priced from 0: on their own levels at least that), its traits by tier, its kit, the supplies on them
  // and, at a normal start, its car and its back (on the colonist's own bill since 2026-10-24); the line adds them up
  // (2026-10-09, user request) against Points each, and follows every change in the window. In Hardcore the car's back
  // is the starting vehicle's (As rolled), so it is shown apart.
  const hard = isRoadStart(state);
  const T = backgroundPoints(d, hard ? "hardcore" : "normal");
  const max = pointsMax(state);
  const sign = (v) => `${v >= 0 ? "+" : "−"}${Math.abs(v)}`;
  const parts = [`skill bumps ${T.skills}${T.skills ? "+" : ""}`, `traits ${sign(T.traits)}`, `kit ${T.kit}`, `supplies on them ${T.supplies}`, `${hard ? "the car free (Hardcore)" : `the car ${T.car}`}`, ...(hard ? [] : [`its back ${T.trunk}`])];
  const costTip = `With Customize ticked, a colonist with this background pays points for what it gives, like anything else: its skill bumps on top of what they pay for their skills (from level 0 they cost ${T.skills}; on higher levels more, 2 a level past 10 and 3 past 15), its traits by tier (bad ones give points back), its kit, the supplies on them and, at a normal start, its car (a vehicle more at the hub) and what is in its back (to the hub with it). In Hardcore the car they flee in is free, and its back is the starting vehicle's own (As rolled, against its point limit). Total: ${T.total} of the ${max} points each colonist has (Points each)${T.total > max ? ": more than one colonist can pay, so they would start over" : ""}.`;
  return `<div class="small bgtotal"${tip(costTip)}><span class="muted">Under Customize: ${parts.join(", ")}</span> · <b class="${T.total > max ? "danger" : ""}">Total ${T.total} points</b> <span class="muted">of ${max} each${hard && T.trunk ? ` · the car's back (${T.trunk}): the starting vehicle's own, As rolled` : ""}</span></div>`;
}

function form(d, ui, state) {
  const C = CUSTOM_BG;
  const skills = SKILLS.map((k) => `<label class="nrskill"><span>${SKILL_NAMES[k]}</span> +${num("bg-skill", d.skills[k], C.SKILL, ` data-k="${k}"`, `Added to their own ${SKILL_NAMES[k]} (0–${C.SKILL}; a skill tops out at 20)`)}</label>`).join("");
  const traits = traitPickerHtml(customTraitKeys(), d.traits, C.TRAITS, `data-action="bg-trait"`, { tiers: d.traitTier || {}, tierAttrs: `data-action="bg-tier"`, points: true });
  const costLine = costLineHtml(d, state);
  const gear = C.SLOTS.map((slot) => `<label class="lookopt">${SLOT_LABELS[slot]}${select("bg-gear", d.gear[slot], byName(slotOptions(slot)), "None", ` data-slot="${slot}"`)}</label>`).join("");
  const fit = fitCheck(d);
  const items = d.items.map((k, i) => `<span class="chip ${fit.left.includes(k) ? "off" : ""}">${esc(gearName(k))} <button class="mini" data-action="bg-item-del" data-i="${i}"${tip("Take it out")}>×</button></span>`).join("");
  const sups = Object.entries(C.SUPPLY).map(([k, cap]) => `<label class="lookopt">${SUP_LABELS[k]}${num("bg-sup", d.supplies[k], cap, ` data-k="${k}"`, `${SUP_LABELS[k]} on them, 0–${cap}, pooled with the team's (a day's ration is 1 food and 1 water)`)}</label>`).join("");
  const trunk = Object.entries(C.TRUNK).map(([k, cap]) => `<label class="lookopt">${supLabel(k)}${num("bg-trunk", d.car.trunk[k], cap, ` data-k="${k}"`, `${supLabel(k)} in the back of the car, 0–${cap}`)}</label>`).join("");
  const supRounds = roundRows(d, "sup"), trunkRounds = roundRows(d, "trunk");
  const trunkItems = d.car.items.map((k, i) => `<span class="chip">${esc(gearName(k))} <button class="mini" data-action="bg-trunk-del" data-i="${i}"${tip("Take it out")}>×</button></span>`).join("");
  const cars = carTypes().map((k) => `<option value="${k}" ${d.car.type === k ? "selected" : ""}>${esc(VEHICLE_TYPES[k].name)}</option>`).join("");
  return `<div class="row"><label class="lookopt" style="flex:1">Name<input data-action="bg-name" value="${esc(d.name)}" maxlength="${C.NAME}"></label>
      <label class="lookopt" style="flex:2">Who they were (a few words)<input data-action="bg-blurb" value="${esc(d.blurb)}" maxlength="${C.BLURB}" placeholder="came off a double shift"></label></div>
    <h3>Skills <span class="small muted">(added to what they rolled)</span></h3><div class="nrskills">${skills}</div>
    <h3>Traits <span class="small muted">(up to ${C.TRAITS}, always given; they go first; − and + set the tier)</span></h3>${traits}
    ${costLine}
    <h3>Worn and held</h3><div class="lookopts">${gear}</div>
    <h3>Carried <span class="small muted">(${d.items.length}/${C.ITEMS}: a tool to the off hand, small things to the ${POCKETS} pockets, the rest to the bag; about ${fit.kg} kg with the gear)</span></h3>
    <div>${items || `<span class="small muted">Nothing.</span>`}</div>
    ${fit.left.length ? `<div class="small danger">No room for ${esc(fit.left.map(gearName).join(", "))}: pick a bigger bag, or it is left behind.</div>` : ""}
    <div class="row" style="margin-top:0.3rem">${select("bg-item-add", "", byName(carryOptions()), "Add a thing…", d.items.length >= C.ITEMS ? " disabled" : "")}</div>
    <h3>Supplies on them <span class="small muted">(on top of the team's 1–3 days)</span></h3><div class="lookopts">${sups}</div>
    ${supRounds}
    <h3>The car</h3>
    <div class="lookopts">
      <label class="lookopt"${tip(`How likely the car the team fled in is theirs, 0–${C.CAR_ODDS}, against the others' (the presets are 0.7–1.6; 0: never theirs, ${C.CAR_ODDS}: almost always). The car, its kind and its back are the owner's.`)}>Theirs (odds)<input type="number" min="0" max="${C.CAR_ODDS}" step="0.1" style="width:4.2rem" data-action="bg-carodds" value="${d.car.odds}"></label>
      <label class="lookopt">Kind<select data-action="bg-cartype"><option value="">Any (sedan or truck)</option>${cars}</select></label>
      ${trunk}
    </div>
    ${trunkRounds}
    <div style="margin-top:0.3rem">${trunkItems || `<span class="small muted">Nothing else in the back.</span>`}</div>
    <div class="row" style="margin-top:0.3rem">${select("bg-trunk-add", "", byName(trunkOptions()), "Put a thing in the back…", d.car.items.length >= C.TRUNK_ITEMS ? " disabled" : "")}</div>`;
}

// Rounds by calibre and type (sim/custombg.js ROUNDS, TRUNK_ROUNDS): a row each (how many, ×), and a pick to add a
// calibre and type (a box of it), the calibres of the background's own guns first.
function roundRows(d, where) {
  const C = CUSTOM_BG, rec = where === "sup" ? d.supplies : d.car.trunk, cap = where === "sup" ? C.ROUNDS : C.TRUNK_ROUNDS;
  const act = where === "sup" ? "bg-sup" : "bg-trunk";
  const keys = Object.keys(rec).filter((k) => ROUND_SUPPLIES[k]).sort();
  const total = roundsOf(rec);
  const rows = keys.map((k) => `<label class="lookopt">${esc(ROUND_SUPPLIES[k].name)}${num(act, rec[k], cap, ` data-k="${k}"`, `${ROUND_SUPPLIES[k].name} ${where === "sup" ? "on them" : "in the back of the car"} (all the rounds together at most ${cap}; a gun fires only its own calibre)`)} <button class="mini" data-action="bg-round-del" data-w="${where}" data-k="${k}"${tip("Take them out")}>×</button></label>`).join("");
  const cals = bgCals(d, where !== "sup");
  const opts = roundOptions().filter((k) => !rec[k]).sort((a, b) => (cals[ROUND_SUPPLIES[b].round.cal] ? 1 : 0) - (cals[ROUND_SUPPLIES[a].round.cal] ? 1 : 0) || ROUND_SUPPLIES[a].name.localeCompare(ROUND_SUPPLIES[b].name));
  const add = `<select data-action="bg-round-add" data-w="${where}"${total >= cap ? " disabled" : ""}${tip(`Add rounds of a calibre and type (a box of them; change how many after). Their guns' calibres first`)}><option value="">Add rounds…</option>${opts.map((k) => `<option value="${k}">${esc(ROUND_SUPPLIES[k].name)}${cals[ROUND_SUPPLIES[k].round.cal] ? " (their gun)" : ""}</option>`).join("")}</select>`;
  return `<div class="small muted" style="margin-top:0.25rem">Rounds ${where === "sup" ? "on them" : "in the back"}, by calibre and type: ${total}/${cap}</div><div class="lookopts">${rows}</div><div class="row" style="margin-top:0.2rem">${add}</div>`;
}
// A box of a round key added (at most what the cap leaves).
function addRounds(b, where, k) {
  if (!ROUND_SUPPLIES[k]) return;
  const rec = where === "sup" ? b.supplies : b.car.trunk, cap = where === "sup" ? CUSTOM_BG.ROUNDS : CUSTOM_BG.TRUNK_ROUNDS;
  const left = cap - roundsOf(rec);
  const box = (CALIBERS[ROUND_SUPPLIES[k].round.cal] || { box: 20 }).box;
  if (left > 0) rec[k] = (rec[k] || 0) + Math.min(box, left);
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
  // A trait's tier up or down (traits.js TRAIT_TIERS).
  "bg-tier": (state, ui, d) => edit(ui, (b) => {
    if (!b.traits.includes(d.k) || tierCount(d.k) < 2) return;
    b.traitTier = { ...(b.traitTier || {}), [d.k]: cleanTier(d.k, ((b.traitTier || {})[d.k] || 1) + (Number(d.d) > 0 ? 1 : -1)) };
  }),
  "bg-item-del": (state, ui, d) => edit(ui, (b) => { b.items.splice(Number(d.i), 1); }),
  "bg-trunk-del": (state, ui, d) => edit(ui, (b) => { b.car.items.splice(Number(d.i), 1); }),
  "bg-round-del": (state, ui, d) => edit(ui, (b) => { delete (d.w === "sup" ? b.supplies : b.car.trunk)[d.k]; }),
};

// Typing in a number that changes the Total (2026-10-09, user pick: the Total follows every key press): the line is
// worked out on a copy (made safe as when it is kept) and only it is redrawn, in place; nothing is kept or rebuilt
// until the box's change (BG_CHANGE). Returns the copy (the tools read it).
const BG_FIELD = { "bg-skill": (b, el) => { b.skills[el.dataset.k] = Number(el.value); }, "bg-sup": (b, el) => { b.supplies[el.dataset.k] = Number(el.value); }, "bg-trunk": (b, el) => { b.car.trunk[el.dataset.k] = Number(el.value); }, "bg-carodds": (b, el) => { b.car.odds = Number(el.value); } };
export const BG_INPUT = Object.fromEntries(Object.entries(BG_FIELD).map(([k, set]) => [k, (state, ui, el) => {
  const d = ui.bgEditor && lib[ui.bgEditor.sel];
  if (!d) return null;
  const draft = JSON.parse(JSON.stringify(d));
  set(draft, el);
  const safe = sanitizeBackground(draft, d.id);
  const doc = el && el.ownerDocument;
  const line = doc && doc.querySelector ? doc.querySelector(".bgtotal") : null;
  if (line) line.outerHTML = costLineHtml(safe, state);
  return safe;
}]));

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
  "bg-round-add": (state, ui, el) => edit(ui, (b) => { if (el.value) addRounds(b, el.dataset.w, el.value); }),
};
