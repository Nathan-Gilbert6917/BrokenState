// New-run setup screen, survivor appearance editor and zombie look settings.
// HTML builders plus their action handlers; main.js registers the handlers with its dispatcher.
import { SKILLS, SKILL_NAMES, TRAITS } from "../sim/data.js";
import { survivorById, skill, rollTraits, HUB_START, START_WEAPONS } from "../sim/world.js";
import { newItem, START_DUR } from "../sim/inventory.js"; // the card's Everything: a new starting weapon
import { randomStarterMods } from "../sim/gunmods.js";
import { WORLD_SIZES, SIZE_KEYS, sizeDef, customDef, isCustom, CUSTOM, GROUPS_MAX, HIVES_MAX, clampGroups, clampHives } from "../sim/worldsize.js";
import { MODES, isHardcore, peopleRange, clampStartPeople } from "../sim/hardcore.js";
import { CUSTOM_RUN, CUSTOM_KEYS, isCustomRun, startsWithVehicle } from "../sim/custommode.js"; // Custom mode and Start with a vehicle (2026-10-24)
import { HC_START, backgroundInfo, countWord } from "../sim/hardcore-start.js"; // who they were (a hardcore start)
import { customLibrary } from "./backgrounds.js";
import { isCustomBg } from "../sim/custombg.js"; // custom backgrounds (sim/custombg.js), kept in this browser
import { FAMILY } from "../sim/family.js"; // the Children box shows only while children are on
import { sanitizeStartGear, hasPicks, trunkKg } from "../sim/startgear.js"; // starting gear picked under Customize
import { gearRow, pointsBar, fleetSection, uiFleet } from "./startgear.js"; // its Gear… button, load and kit points, and the points bar, on the crew card; the Starting vehicles
import { cleanFleet, fleetRoom, openLoads, ridesIn } from "../sim/startfleet.js"; // the starting vehicles: each its point limit and back (2026-10-24)
import { gunCals } from "../sim/ammo.js"; // a random back's rounds: the crew's guns' calibres
import { traitPickerHtml, traitBlock, traitChips, traitWords } from "./traitpick.js"; // Customize: the traits, good and bad, none that clash; the chips
import { randomBuild, randomEverything, randomTraits, randomKit, randomTrunk, kitBudget, kitKeys } from "../sim/randomkit.js"; // Customize: a whole random colonist within the points; the crew and the vehicles' backs
import { CUSTOM_POINTS, pricePerson, pointsMax, maxFor, nextLevelCost, skillCost, clampMax } from "../sim/custompoints.js";
import { wornLoad } from "../sim/load.js"; // Customize: everything costs points
import { traitLabel, traitTier, setTier, tidyTiers, tierCount, cleanTier } from "../sim/traits.js";
import {
  LOOK_OPTIONS, LOOK_COLORS, ensureAppearance, randomAppearance, freshRng, randomName, randomSkills, fitSkills, skillTotal, SKILL_MAX,
} from "../sim/appearance.js";
import {
  appearanceURL, survivorURL, zombieURL, spriteImg, ZOMBIE_LOOK_OPTIONS, ZOMBIE_VARIANTS, zombieLook, setZombieLook, resetZombieLook,
} from "./sprites.js";
import { worldButton } from "./worldcfg.js"; // World…: the run's dials (sim/worldcfg.js), a preset or Custom
import { keyHint } from "./hints.js"; // "then press Space" by the device in use
import { START_CLEAR } from "../sim/startpick.js"; // Pick start on map: how far a start keeps from the towns, cities, hives and groups

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const VARIANT_NAMES = { walker: "Walker", runner: "Runner", bloated: "Bloated", brute: "Brute" };

// ---------- appearance editor (survivor screen and new-run screen) ----------
export function appearanceEditor(state, s) {
  const a = ensureAppearance(s, state.seed);
  const w = s.gear && s.gear.weapon ? s.gear.weapon.key : null;
  const ar = s.gear && s.gear.armor ? s.gear.armor.key : null;
  const opts = Object.entries(LOOK_OPTIONS).map(([k, o]) => `<label class="lookopt">${o.name}
      <select data-action="look" data-id="${s.id}" data-k="${k}">${o.values.map(([v, l]) => `<option value="${v}" ${a[k] === v ? "selected" : ""}>${l}</option>`).join("")}</select></label>`).join("");
  const colors = Object.entries(LOOK_COLORS).map(([k, c]) => `<div class="lookcolor"><span class="muted">${c.name}</span>
      ${c.palette.map((hex) => `<button class="colorpick ${a[k] === hex ? "on" : ""}" style="background:${hex}" data-action="look-set" data-id="${s.id}" data-k="${k}" data-v="${hex}"${tip(`${c.name} ${hex}`)}></button>`).join("")}
      <input type="color" class="colorinput" data-action="look" data-id="${s.id}" data-k="${k}" value="${esc(a[k])}"${tip("Any color")}></div>`).join("");
  return `<div class="looked">
    <div class="lookprev">
      <div class="lookstage">${spriteImg(appearanceURL(a, w, ar), 7.5)}</div>
      <div class="small muted" style="text-align:center">As seen in battle${w ? " (with gear)" : ""}</div>
      <div class="row" style="justify-content:center;margin-top:0.4rem">
        <button data-action="look-rand" data-id="${s.id}"${tip("New random look for this survivor")}>🎲 Randomize</button>
        <button class="primary" data-action="look-done"${tip("Close the look editor")}>Done</button>
      </div>
    </div>
    <div class="lookbody"><div class="lookopts">${opts}</div>${colors}</div>
  </div>`;
}

// ---------- new-run screen ----------
// The skill-point budget is kept on the colonist (s.skillBudget), so it survives a rebuilt world (new seed or
// group count): crewSnapshot carries it and world.applyCrew puts it back.
function budgetOf(ui, s) {
  if (s.skillBudget == null) s.skillBudget = skillTotal(s.skills);
  return s.skillBudget;
}

// What a skill counts as in play when traits change it (Loud, Lucky, Former Medic...): " →3" after the points,
// with the traits and their effect in the hover text. Worked out from world.skill, so it follows the rules.
function traitMod(s, k) {
  const eff = skill(s, k);
  if (eff === s.skills[k]) return "";
  const why = s.traits.map((t) => {
    const d = eff - skill({ ...s, traits: s.traits.filter((x) => x !== t) }, k);
    return d ? `${traitLabel(t, traitTier(s, t))} ${d > 0 ? "+" : "−"}${Math.abs(d)}` : "";
  }).filter(Boolean).join(", ");
  return `<i class="nrmod ${eff < s.skills[k] ? "neg" : ""}"${tip(`Counts as ${eff} in play${why ? `: ${why}` : ""}. The points are what you spend; traits are applied on top.`)}>→${eff}</i>`;
}

// Customize (2026-10-07, user request; points 2026-10-08: sim/custompoints.js; not with Ironman): every colonist starts
// blank and everything costs points from their max (the "Points each" box): skill levels (+ and −, any level 0–20),
// traits picked with their tier (good ones cost, bad ones give points back), who they were (a preset or a custom
// background, ui/backgrounds.js: picking one loads what it gives, priced) and what they wear, hold and carry (Gear…;
// the vehicles' backs have point limits of their own since 2026-10-24: Starting vehicles). "Start from the dice" loads what was rolled for them; "Clear" goes back to blank. Start is
// refused while anyone is over. Anything set this way marks the colonist (s.startCustom): ticking Ironman puts the crew
// back as rolled, and Start refuses an Ironman run with it.
const freeEdit = (ui) => !!ui.freeEdit && !ui.ironman;
const MAX_TRAITS = CUSTOM_POINTS.MAX_TRAITS;
function traitPicker(s) {
  const tiers = Object.fromEntries(s.traits.map((t) => [t, traitTier(s, t)]));
  return `<div style="margin-top:0.3rem">${traitPickerHtml(Object.keys(TRAITS), s.traits, MAX_TRAITS, `data-action="nr-trait" data-id="${s.id}"`, { tiers, tierAttrs: `data-action="nr-tier" data-id="${s.id}"`, points: true })}</div>`;
}
// Customize: this colonist's own points max (2026-10-19, user request): set here, it is theirs alone (sim/custompoints.js
// maxFor) and nobody else's changes; setting Points each again puts the whole crew back on it (main.js nr-points).
function ownPointsBox(state, s) {
  const own = Number.isFinite(s.ownMax), crew = pointsMax(state);
  const t = `${s.name.split(" ")[0]}'s own points max (${CUSTOM_POINTS.MIN}–${CUSTOM_POINTS.MAX}). Changing it changes only theirs; the crew's Points each is ${crew}. Set Points each again and everyone goes back to it.`;
  return `<div class="row small" style="margin-top:0.2rem;gap:0.3rem"><label${tip(t)}>Their points <input type="number" min="${CUSTOM_POINTS.MIN}" max="${CUSTOM_POINTS.MAX}" step="5" style="width:4.5rem" data-action="nr-ownpoints" data-id="${s.id}" value="${maxFor(state, s)}"></label>${own && s.ownMax !== crew ? `<span class="muted"${tip(`Their own max: the crew's Points each is ${crew}`)}>(own; crew ${crew})</span>` : ""}</div>`;
}
// Who they were (Hardcore): the dice (what was drawn, in brackets), a preset, or one of the custom backgrounds.
function backgroundPicker(state, s) {
  const cur = s.bgPicked ? s.background : "";
  const drawn = !s.bgPicked && backgroundInfo(state, s.background);
  const presets = Object.entries(HC_START.ARCHETYPES).map(([k, a]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${esc(a.name)}</option>`).join("");
  const mine = Object.values(customLibrary()).map((b) => `<option value="${b.id}" ${cur === b.id ? "selected" : ""}>${esc(b.name)}</option>`).join("");
  const what = isHardcore(state)
    ? "it adds to their skills, may give a trait, and decides what they grabbed and the car if it is theirs"
    : "it shapes their skills (the same total: more where the background is, less elsewhere) and may give a trait; six years on, the hub's kit is theirs";
  return `<label class="small"${tip(`Who they were before Calder fell: ${what}. A custom background (Backgrounds…) gives exactly what it says${isHardcore(state) ? "" : ", its kit and supplies too (its car parks at the hub)"}. Changing it builds the world again on the same seed; this colonist's skills and traits start over from it.`)}>Background <select data-action="nr-bg" data-id="${s.id}"><option value="" ${cur ? "" : "selected"}>Dice${drawn ? ` (${esc(drawn.name)})` : ""}</option><optgroup label="Presets">${presets}</optgroup>${mine ? `<optgroup label="Custom">${mine}</optgroup>` : ""}</select></label>`;
}

// The crew card (the user's request 2026-10-24: "so many menus are crowded", "remove redundant buttons", "a card stays a
// card"): the portrait, the name (its 🎲 is the one way to a random name), the leader, what they hold, their chips, the
// skills, and one Reroll row of small buttons with the detail in their hovers. Under Customize the points bar, the
// background and own-points row, a toolbar (Gear…, the load, Traits ▸ which unfolds the picker, Start from the dice,
// Clear); the trait picker is folded until Traits ▸ is pressed (ui.nrOpen["id:traits"], ui/newgame.js nr-fold), so the
// card keeps its height. The look editor replaces the card while it is open.
const foldOpen = (ui, s, k) => !!(ui.nrOpen && ui.nrOpen[`${s.id}:${k}`]);
function crewCard(state, ui, s) {
  const left = budgetOf(ui, s) - skillTotal(s.skills);
  const free = freeEdit(ui), locked = !!ui.ironman, hard = isHardcore(state);
  const i = state.survivors.indexOf(s);
  // Gear: Customize draws a kit on points; a normal start trades the starting weapon and vest with a crewmate (the
  // crew's kit stays the same); Hardcore draws what they grabbed again (not in Ironman: as rolled).
  const gearLocked = locked && hard;
  const gearTip = free ? "Empty what they wear, hold and carry, then a new random kit for the points they have left after their skills and traits. Each click is a new draw"
    : hard ? (locked ? "Ironman: what they grabbed stays as rolled" : "Draw again what they grabbed as they fled (their bag, weapon and things; the others keep theirs). Each click is a new draw")
    : "Trade their starting weapon and vest with a random crewmate's (the crew's kit stays the same)";
  const allTip = locked ? "Everything for this colonist only: a new name, skills (same total) and look. Ironman: traits and who they were stay as rolled"
    : free ? "Everything for this colonist only: a new name, look and background, and a random build (traits, skills and what they wear, hold and carry, within their points)"
    : `Everything for this colonist only: a new name, look and background, skills (same total)${hard ? ", traits and what they grabbed (the others keep theirs)" : ", traits and a new starting weapon (the others keep theirs; Gear trades the weapon and vest with a crewmate)"}`;
  if (ui.lookEdit === s.id) {
    return `<div class="card leader-pick nrcard nrwide ${s.leader ? "on" : ""}">
      <div class="spread"><b>${s.leader ? "★ " : ""}${esc(s.name)}</b><span class="muted small">Appearance</span></div>
      ${appearanceEditor(state, s)}</div>`;
  }
  const skills = SKILLS.map((k) => `<div class="nrskill"><span>${SKILL_NAMES[k]}</span>
      <button class="mini" data-action="nr-skill" data-id="${s.id}" data-k="${k}" data-d="-1" ${!locked && s.skills[k] > 0 ? "" : "disabled"}${tip(locked ? "Ironman: skills stay as rolled" : free ? `One lower (${nextLevelCost(s.skills[k] - 1)} back)` : "Move a point back to the pool")}>−</button>
      <b>${s.skills[k]}${traitMod(s, k)}</b>
      <button class="mini" data-action="nr-skill" data-id="${s.id}" data-k="${k}" data-d="1" ${!locked && (free || left > 0) && s.skills[k] < SKILL_MAX ? "" : "disabled"}${tip(locked ? "Ironman: skills stay as rolled" : free ? `One higher: ${nextLevelCost(s.skills[k])} point${nextLevelCost(s.skills[k]) === 1 ? "" : "s"} (a level costs 1 up to 10, 2 up to 15, 3 up to ${SKILL_MAX}; ${SKILL_NAMES[k]} ${s.skills[k]} costs ${skillCost(s.skills[k])} in all)` : "Spend a point from the pool")}>+</button></div>`).join("");
  const held = [s.gear.weapon, s.gear.armor, s.gear.backpack].filter(Boolean).map((g) => esc(g.name)).join(", ");
  const traitsOpen = free && foldOpen(ui, s, "traits");
  const n = s.traits.length;
  return `<div class="card leader-pick nrcard ${s.leader ? "on" : ""}">
    <div class="nrtop">
      <div class="nrport" data-action="look-edit" data-id="${s.id}"${tip("Click to customize how they look")}>${spriteImg(survivorURL(s, state.seed), 4.4)}<div class="small muted">Edit look</div></div>
      <div class="nrmain">
        <div class="row nrname"><input data-action="rename" data-id="${s.id}" value="${esc(s.name)}"${tip("Rename")}>
          <button class="mini" data-action="nr-name" data-id="${s.id}"${tip("A random name")}>🎲</button></div>
        <div class="row nrlead">
          <button class="mini ${s.leader ? "active" : ""}" data-action="pickleader" data-id="${s.id}"${tip("The leader's Leadership lifts morale at their base. If they die, you pick a new one.")}>${s.leader ? "★ Leader" : "Make leader"}</button>
          <span class="small muted nrheld"${held ? tip(`What they start with: ${held}`) : ""}>${held}</span></div>
        <div class="small nrchips">${bgChip(state, s)}${traitChips(s)}</div>
        ${free ? pointsBar(state, s) : ""}
      </div>
    </div>
    ${free ? `<div class="row nrcust">${backgroundPicker(state, s)}${ownPointsBox(state, s)}</div>` : ""}
    <div class="spread small nrskhead"><span class="muted">Skills</span>${locked
      ? `<span class="muted"${tip("Ironman: the crew starts as rolled (skills, traits and who they were). Names, looks and the leader are yours.")}>Ironman: as rolled</span>`
      : free ? `<span${tip("Customize is on: any level 0–20, each level costs points (1 each up to 10, 2 up to 15, 3 up to 20)")}>Skills ${pricePerson(state, s).skills} pts</span>`
      : `<span${tip("Points can be moved between skills. Rerolling skills keeps the same total, so nobody gets better or worse overall.")}>Points left <b class="${left > 0 ? "warn" : ""}">${left}</b> / ${budgetOf(ui, s)}</span>`}</div>
    <div class="nrskills">${skills}</div>
    ${free ? `<div class="nrtools">
      ${gearRow(state, s)}
      <button class="mini nrfold ${traitsOpen ? "active" : ""}" data-action="nr-fold" data-id="${s.id}" data-k="traits" aria-expanded="${traitsOpen}"${tip(traitsOpen ? "Fold the trait picker away" : `Pick their traits: good ones cost points by tier, bad ones give points back, at most ${MAX_TRAITS}${n ? ` (${n} picked: ${traitWords(s)})` : ""}`)}>${traitsOpen ? "▾" : "▸"} Traits${n ? ` (${n})` : ""}</button>
      <button class="mini" data-action="sg-dice" data-i="${i}"${tip("Load what the dice rolled for them: skills, traits and their tiers, what they wear, hold and carry. It shows what that costs (it may be over the max)")}>🎲 Start from the dice</button>
      <button class="mini" data-action="sg-blank" data-i="${i}"${tip("Back to a blank slate: skills 0, no traits, nothing worn or carried")}>Clear</button>
    </div>` : ""}
    ${traitsOpen ? traitPicker(s) : ""}
    <div class="row nrrand">
      <span class="small muted"${tip("Each button draws that part again for this colonist only. The 🎲 by the name draws a new name.")}>🎲 Reroll</span>
      ${free ? "" : `<button class="mini" data-action="nr-skills" data-id="${s.id}"${locked ? " disabled" : ""}${tip(locked ? "Ironman: skills stay as rolled" : "Shuffle their skills, the same point total")}>Skills</button>`}
      <button class="mini" data-action="nr-look" data-id="${s.id}"${tip("A new random look")}>Look</button>
      <button class="mini" data-action="nr-rand-bg" data-id="${s.id}"${locked ? " disabled" : ""}${tip(locked ? "Ironman: who they were stays as rolled" : `A random background, one nobody else in the crew has (${free ? "what it gives is loaded and priced, as picking it does" : hard ? "it reshapes their skills, may give a trait, and decides what they grabbed" : "it reshapes their skills (the same total) and may give a trait"}). Each click is a new draw`)}>Background</button>
      <button class="mini" data-action="nr-rand-traits" data-id="${s.id}"${locked ? " disabled" : ""}${tip(locked ? "Ironman: traits stay as rolled" : free ? "New random traits, good and bad, within the points they have left. Each click is a new draw" : "New random traits (one or two, none that clash)")}>Traits</button>
      <button class="mini" data-action="nr-rand-gear" data-id="${s.id}"${gearLocked ? " disabled" : ""}${tip(gearTip)}>Gear</button>
      ${free ? `<button class="mini" data-action="sg-build" data-i="${i}"${tip("A new random build for this colonist only: traits, skills and what they wear, hold and carry, within their points. Each click is a new draw")}>Build</button>` : ""}
      <button class="mini" data-action="nr-all" data-id="${s.id}"${tip(allTip)}>Everything</button>
    </div>
  </div>`;
}

// Who they were (Hardcore): a chip with what it means, a custom one marked.
function bgChip(state, s) {
  const b = backgroundInfo(state, s.background);
  if (!b) return "";
  const shaped = isHardcore(state) ? "It shaped their skills, what they grabbed and the car." : "It shaped their skills (the same total) and maybe a trait.";
  return `<span class="chip"${tip(`Who they were before Calder fell${b.blurb ? `: ${b.blurb}` : ""}. ${b.custom ? "A custom background: it gave exactly what it says." : shaped}${s.bgPicked ? " Picked on the new-run screen." : ""}`)}>${esc(b.name)}${b.custom ? " ✎" : ""}</span>`;
}

// World size (sim/worldsize.js) and the group counts that size allows.
const SIZE_TIPS = {
  small: "A tight state: shorter trips, fewer towns, hives and groups close by",
  normal: "The standard State of Calder",
  large: "More towns, a third city and a second infestation; longer trips",
  huge: "A sprawling state: four cities, two more infestations, many groups. Long trips: vehicles and outposts matter",
};
function worldSizeSelect(ui) {
  const opts = SIZE_KEYS.map((k) => {
    const d = WORLD_SIZES[k];
    return `<option value="${k}" ${k === ui.worldSize ? "selected" : ""}>${d.label} (${d.w}×${d.h})</option>`;
  }).join("") + `<option value="custom" ${isCustom(ui.worldSize) ? "selected" : ""}>Custom… (experimental)</option>`;
  const what = isCustom(ui.worldSize) ? "Any width × height you set (experimental)" : SIZE_TIPS[sizeDef(ui.worldSize).key];
  return `<label${tip(`Map size in hexes. ${what}. Changing it builds a new map on the same seed`)}>World size <select data-action="worldsize">${opts}</select></label>`;
}
// The size the screen is set to: a preset, or the custom width × height (sim/worldsize.js customDef).
const uiSizeDef = (ui) => (isCustom(ui.worldSize) ? customDef(ui.customW, ui.customH) : sizeDef(ui.worldSize));
// Custom size: width and height, with the warning that goes with it.
function customSizeRow(state, ui) {
  if (!isCustom(ui.worldSize)) return "";
  const tiles = state.grid.width * state.grid.height, huge = WORLD_SIZES.huge.w * WORLD_SIZES.huge.h;
  return `<div class="row" style="margin-bottom:0.5rem">
      <label${tip(`Map width in hexes (${CUSTOM.MIN_W}–${CUSTOM.MAX_W}). Normal is ${WORLD_SIZES.normal.w}, Huge ${WORLD_SIZES.huge.w}`)}>Width <input type="number" min="${CUSTOM.MIN_W}" max="${CUSTOM.MAX_W}" step="1" style="width:5rem" data-action="customw" value="${state.grid.width}"></label>
      <label${tip(`Map height in hexes (${CUSTOM.MIN_H}–${CUSTOM.MAX_H}). Normal is ${WORLD_SIZES.normal.h}, Huge ${WORLD_SIZES.huge.h}`)}>Height <input type="number" min="${CUSTOM.MIN_H}" max="${CUSTOM.MAX_H}" step="1" style="width:5rem" data-action="customh" value="${state.grid.height}"></label>
      <span class="small ${tiles > huge ? "danger" : "muted"}">⚠ Experimental: custom sizes are not balanced or tested like the presets, and maps bigger than Huge (${WORLD_SIZES.huge.w}×${WORLD_SIZES.huge.h}) may run slowly.${tiles > huge ? ` This one is ${(tiles / huge).toFixed(1)}× Huge.` : ""}</span>
    </div>`;
}
// AI groups: 0–50 on any size; the size suggests a range.
function groupInput(state, ui) {
  const d = uiSizeDef(ui);
  const hard = isHardcore(state);
  const t = `How many other survivor groups share the state, 0–${GROUPS_MAX} (${d.groups.join("–")} suits a ${d.label} map; many groups on a small map may not all find room, and many groups slow the game)${hard ? ". Hardcore always has the National Guard" : ""}`;
  return `<label${tip(t)}>AI groups <input type="number" min="0" max="${GROUPS_MAX}" step="1" style="width:4rem" data-action="factioncount" value="${ui.factionCount}"></label>`;
}
// Starting hives: what the map makes (Default), or 0–20 (worldsize.js HIVES_MAX).
function hiveSelect(state, ui) {
  const made = isHardcore(state) ? state.hardcore?.outbreak?.normalHives ?? (state.hives || []).length : (state.hives || []).length;
  const cur = ui.hiveCount == null ? "default" : String(ui.hiveCount);
  const opts = [`<option value="default" ${cur === "default" ? "selected" : ""}>Default${ui.hiveCount == null ? ` (${made})` : ""}</option>`];
  for (let v = 0; v <= HIVES_MAX; v++) opts.push(`<option value="${v}" ${cur === String(v) ? "selected" : ""}>${v}</option>`);
  const t = `How many hives the outbreak starts with (Default: what this map makes on its own). More hives mean more hordes from the start; with none, new hives still rise near the border.${isHardcore(state) ? " In Hardcore the outbreak still begins with one hive: this is how many the first year grows to." : ""}`;
  return `<label${tip(t)}>Starting hives <select data-action="hivecount">${opts.join("")}</select></label>`;
}

// The new-run screen's mode for a world: Custom (sim/custommode.js isCustomRun: a normal start with state.custom),
// Hardcore or Normal.
export const screenMode = (state) => (isCustomRun(state) ? "custom" : isHardcore(state) ? "hardcore" : "normal");

// Each mode keeps its own Starting people, Points each, Start with a vehicle and Starting vehicles (2026-10-19 and
// 2026-10-24, user requests): ui.startPeople, ui.pointsMax, ui.startVehicle and ui.fleet (sim/startfleet.js: each
// vehicle's kind, point limit and back) are the current mode's, the others' wait in ui.modeSets
// (main.js). stashModeSet puts the current mode's away (anything else its entry holds is kept); takeModeSet makes mode
// the current one with its own. The gamemode select, rollRandomRun and main.js adopt use them.
export function stashModeSet(ui) {
  if (!ui.modeSets) return;
  ui.modeSets[ui.mode] = { ...(ui.modeSets[ui.mode] || {}), startPeople: ui.startPeople, pointsMax: ui.pointsMax, startVehicle: ui.startVehicle !== false, fleet: cleanFleet(ui.fleet, ui.mode) };
}
export function takeModeSet(ui, mode) {
  const m = (ui.modeSets && ui.modeSets[mode]) || {};
  ui.mode = mode;
  ui.startPeople = clampStartPeople(m.startPeople ?? peopleRange(mode).DEF, mode);
  ui.pointsMax = clampMax(m.pointsMax ?? CUSTOM_POINTS.DEF);
  ui.startVehicle = m.startVehicle !== false;
  ui.fleet = cleanFleet(m.fleet, mode);
}

// Normal, Hardcore or Custom (sim/hardcore.js MODES): the mode the world on this screen was built with.
function modeSelect(state) {
  const cur = screenMode(state);
  const opts = Object.entries(MODES).map(([k, m]) => `<option value="${k}" ${k === cur ? "selected" : ""}${tip(m.tip)}>${esc(m.label)}</option>`).join("");
  return `<label${tip(`${MODES[cur].tip}. Changing it builds the world again on the same seed (your edited colonists are kept, as many as that mode's Starting people says). Each mode keeps its own Starting people, Points each and Start with a vehicle.`)}>Mode <select data-action="gamemode">${opts}</select></label>`;
}

// Start with a vehicle (2026-10-24, user request), every mode, Ironman too: off, no pickup at the hub (Normal, Custom)
// or no car to flee in (Hardcore: on foot). Each mode keeps its own (main.js ui.modeSets).
function vehicleToggle(state) {
  const on = startsWithVehicle(state), hard = isHardcore(state);
  const t = hard
    ? "Start with a vehicle: ticked, one of you fled in their car with what was in its back (and a small team loaded its empty seats; Starting vehicles sets the back). Unticked, you flee on foot with only what you can carry (the tents too). Changing it builds the world again on the same seed"
    : `Start with a vehicle: ticked, the hub starts with the vehicles set under Starting vehicles (a pickup truck by default) (and a custom background's car, if it brings one); Starting vehicles sets what is in their backs. Unticked, no vehicle at all: your people go on foot until they find, take or fix one. Changing it builds the world again on the same seed`;
  return `<label${tip(t)}><input type="checkbox" data-action="nr-vehicle"${on ? " checked" : ""}> Start with a vehicle</label>`;
}

// Custom mode's counts (sim/custommode.js CUSTOM_RUN, 2026-10-24, user request: "set any number above 1 for starting
// survivors, hives, cities etc"): number inputs in place of Starting people, AI groups and Starting hives. The world's
// own counts are shown (state.custom; the survivors: state.startPeople).
const CUSTOM_TIPS = {
  people: "How many survivors hold the hub at the start. More than the hub's six beds sleep rough until beds are built; the stores are the same whatever the count, and many people slow the game",
  groups: "How many other survivor groups share the state. Each needs a site of its own, so on a small map not all may find room; many groups slow the game",
  hives: "How many hives the outbreak starts with, around the outbreak's hot spots. More hives mean more hordes from the start",
  cities: "How many cities the map has: Calder City and others far from it (closer when the map is short of room). A city that finds no room is left out",
  towns: "How many towns the map has, spread 8 hexes apart; on a small map not all may find room",
  military: "How many National Guard bases and Army depots the map has, kept apart (closer when the map is short of room)",
};
function customInputs(state, keys) {
  const cur = { ...(state.custom || {}), people: state.startPeople };
  return keys.map((k) => {
    const R = CUSTOM_RUN[k];
    return `<label${tip(`Custom: ${CUSTOM_TIPS[k]}. ${R.MIN}–${R.MAX} (capped so the game does not grind to a halt; ${R.DEF} on a Normal map). Changing it builds the world again on the same seed`)}>${esc(R.label)} <input type="number" min="${R.MIN}" max="${R.MAX}" step="1" style="width:4rem" data-action="nr-custom" data-k="${k}" value="${cur[k] ?? R.DEF}"></label>`;
  }).join("\n      ");
}
// What a Custom run's map made of its counts: a line when something found no room ("" when everything fit).
function customShort(state) {
  if (!isCustomRun(state)) return "";
  const c = state.custom;
  const towns = state.tiles.filter((t) => t.loc && t.loc.type === "town").length;
  const got = { groups: state.factions.length, hives: (state.hives || []).length, cities: (state.cityIds || []).length, towns, military: (state.militaryIds || []).length };
  const short = Object.entries(got).filter(([k, n]) => n < c[k]).map(([k, n]) => `${n} of the ${c[k]} ${CUSTOM_RUN[k].label.toLowerCase()}`);
  return short.length ? `Only ${short.join(", ")} found room on this map: try a bigger map (World size) or another seed.` : "";
}

// Starting people (sim/hardcore.js peopleRange): Hardcore, how many flee together on day 1 (1–4); a normal start, how many
// hold the hub (1–8, six by default). Each mode keeps its own count (main.js ui.modeSets).
// The count shown: the world's own, else the screen's setting.
function startPeopleSelect(state, ui) {
  const hard = isHardcore(state), mode = hard ? "hardcore" : "normal", R = peopleRange(mode);
  const cur = Number.isFinite(state.startPeople) ? clampStartPeople(state.startPeople, mode) : clampStartPeople(ui.startPeople ?? R.DEF, mode);
  const opts = [];
  for (let v = R.MIN; v <= R.MAX; v++) opts.push(`<option value="${v}" ${v === cur ? "selected" : ""}>${v}${v === R.DEF ? " (default)" : ""}</option>`);
  const t = hard
    ? `How many of you flee together on the day Calder falls, ${R.MIN}–${R.MAX} (${R.DEF} by default). Each one brings what they grabbed (1–3 days of food and water each; a farmer, a hunter or a trucker more food, a veteran, a nurse, a mechanic or a cop less), so fewer hands carry less, scavenge, build the first camp and fight slower; the car, what is in its back and a prepper's bag are one of each whatever the count, so a small team has more of those to share. One or two are the kind who can look after themselves (better Scouting, Stealth and Medicine), loaded the car's empty seats with food and water too, and meet fewer armed strangers on the road. Changing it builds the world again on the same seed`
    : `How many survivors hold the hub at the start, ${R.MIN}–${R.MAX} (${R.DEF} by default). The hub has six beds (a lodge's four and a two-person tent) and the stores are the same whatever the count: more hands work, fight and scavenge, and eat more. Changing it builds the world again on the same seed (your edited colonists are kept, as many as fit)`;
  return `<label${tip(t)}>Starting people <select data-action="startpeople">${opts.join("")}</select></label>`;
}

// Customize's own settings (2026-10-19, user request: hidden while Customize is off, and kept apart for Normal and
// Hardcore): Points each (each mode its own: main.js ui.modeSets), the custom backgrounds and Randomize everything.
function customizeRow(state, ui) {
  if (!freeEdit(ui)) return "";
  const mode = MODES[screenMode(state)].label;
  return `<div class="row nrcustom" style="margin-bottom:0.8rem">
      <span class="small muted"${tip(`Customize's settings for ${mode} (the other modes keep their own)`)}>Customize (${esc(mode)}):</span>
      <label${tip(`Customize (${mode}): the points each colonist may spend (${CUSTOM_POINTS.MIN}–${CUSTOM_POINTS.MAX}, ${CUSTOM_POINTS.DEF} by default: about what an average rolled colonist and their start kit come to). Everyone starts blank; skills, good traits, gear and what they carry cost points, bad traits give some back (at most a third of this). Setting it puts every colonist on it, their own points (on their card) too.`)}>Points each <input type="number" min="${CUSTOM_POINTS.MIN}" max="${CUSTOM_POINTS.MAX}" step="5" style="width:4.5rem" data-action="nr-points" value="${pointsMax(state)}"></label>
      <button data-action="bg-open"${tip(`Make your own backgrounds: skills, traits, gear, supplies and the car (${Object.keys(customLibrary()).length} made)`)}>Backgrounds…</button>
      <button data-action="nr-everything"${tip("Everything at once: every colonist a new name, look and random build (traits, skills and what they wear, hold and carry), within their points, and every starting vehicle's back emptied and filled again up to its own point limit. Each click is a new draw")}>🎲 Randomize everything</button>
    </div>`;
}

const startWood = (state) => { const h = state.bases.find((b) => b.type === "hub"); return Math.floor(h ? h.stock.wood || 0 : 0); };
// The story of the start: one short line on the screen, the whole of it in the hover of the ? beside it (the user's
// request 2026-10-24: "if it's just a description of what is happening remove it; provide more details in a hover").
// The tests read the whole: the Custom counts, "No vehicle".
function introText(state) {
  const people = state.survivors, hard = isHardcore(state), custom = isCustomRun(state);
  const foot = startsWithVehicle(state) ? "" : hard ? " No car: you go on foot." : " No vehicle: your people go on foot until they find, take or fix one.";
  const who = people.length === 1 ? "You get out alone" : `${countWord(people.length).replace(/^./, (c) => c.toUpperCase())} of you get out`;
  const full = (custom ? `Custom: a normal start with the counts you set (${people.length} ${people.length === 1 ? "survivor" : "survivors"}, ${state.custom.groups} AI ${state.custom.groups === 1 ? "group" : "groups"}, ${state.custom.hives} ${state.custom.hives === 1 ? "hive" : "hives"}, ${state.custom.cities} ${state.custom.cities === 1 ? "city" : "cities"}, ${state.custom.towns} ${state.custom.towns === 1 ? "town" : "towns"} and ${state.custom.military} military ${state.custom.military === 1 ? "site" : "sites"}). ` : "") + (hard
    ? `Hardcore. The day the State of Calder falls. ${who} with whatever you can grab: no hub, food and water for a day or three, and the outbreak just starting. Gather what a hub takes and found your own. ${state.factions.length} other groups are out there, starting out just like you.`
    : `Six years after the outbreak. Your survivors hold a homestead out in the open in the State of Calder, well clear of the towns: a main house (a well, a cellar, no wall yet), a lodge with four beds, a two-person tent and eight crop plots dug, and nothing else built yet. What to put up first, with a woodpile of ${startWood(state).toLocaleString("en-US")} wood, ${HUB_START.scrap} scrap and ${HUB_START.parts} parts, is yours to choose: beds, a crafting bench, fields, walls. ${state.factions.length} other groups are out there, starting bare as well, along with the hordes.`) + foot
    + ` Customize your starting colonists (name, skills, look) and choose your leader. The game starts paused: give your first orders, then ${keyHint({ key: "press Space", touch: "tap ▶ Run", pad: "press ☰" })}.`;
  const line = custom ? `Custom: a normal start with the counts you set.`
    : hard ? `Hardcore: the day Calder falls, ${who.toLowerCase()} with what you can grab.`
    : `Six years after the outbreak: a homestead in the State of Calder, ${state.factions.length} other groups out there.`;
  return { line: line + foot, full };
}

// The screen (the user's request 2026-10-24): a full screen over the title's background (ui/title.js newRunUp,
// prototype/newrun.css), with a header that stays put while the rest scrolls (◀ the title, the name, ⚙ Menu, 🎲 Random
// run, 🗺 View map, ▶ Start, and the last notice under them), the settings in three labelled groups (Mode & people,
// World, Crew with the starting vehicles) instead of one long row, then the crew cards in a grid that takes the columns
// the screen has room for. Continue and Load game… are gone from here: the title and the Menu have them.
export function newRunScreen(state, ui) {
  const people = state.survivors;
  const hard = isHardcore(state), custom = isCustomRun(state), free = freeEdit(ui);
  const story = introText(state);
  const mode = MODES[screenMode(state)].label;
  const randomTip = `Random run: a new seed and a random world size, AI groups, starting hives, mode (Normal or Hardcore), starting people, zombie look, and a random crew with their gear${free ? " built within random Points each" : ""}, then it starts at once. Ironman, Customize, the First-week guide, Children and the World… dials stay as you set them; the settings rolled are in the log`;
  const head = `<div class="nrhead">
      <div class="nrh-row">
        <button class="nr-ib" data-action="title-back"${tip("Back to the title screen (this setup waits there under New game)")}>◀</button>
        <span class="nrh1" role="heading" aria-level="1">New run</span>
        <span class="nrh-sp"></span>
        <button class="nr-ib" data-action="set-open"${tip("The menu: settings, how to play, load a game (Esc)")}><span class="nr-ic">⚙</span><span class="nr-lb">Menu</span></button>
        <button class="nr-ib" data-action="nr-random"${tip(randomTip)}><span class="nr-ic">🎲</span><span class="nr-lb">Random run</span></button>
        <button class="nr-ib" data-action="nr-map"${tip("Put this screen aside and look at the world map: where you start, the groups, the roads (the banner's Back to setup, or Esc, brings it back)")}><span class="nr-ic">🗺</span><span class="nr-lb">View map</span></button>
        <button class="primary" data-action="begin"${tip(`Start this run with the map and crew as set. It starts paused: give your first orders, then ${keyHint({ key: "press Space", touch: "tap ▶ Run", pad: "press ☰" })}`)}>▶ Start</button>
      </div>
      ${ui.nrMsg ? `<div class="nrh-msg small">${esc(ui.nrMsg)}</div>` : ""}
    </div>`;
  const intro = `<div class="nrintro small muted"><span>${esc(story.line)}</span> <button class="mini nr-why"${tip(story.full)}>?</button></div>`;
  const modeGroup = `<section class="nrgroup nrg-mode"><h3 class="nrg-h"${tip("The kind of start and who is in it. Each mode keeps its own Starting people, Points each, Start with a vehicle and Starting vehicles")}>Mode &amp; people</h3><div class="row nrg-b">
      ${modeSelect(state)}
      ${custom ? customInputs(state, ["people"]) : startPeopleSelect(state, ui)}
      ${vehicleToggle(state)}
      <label${tip("Ironman: the game saves itself (at dawn, when a battle starts and ends, when you leave it) to one slot of its own. No saving or loading by hand, no restarting a battle, no export: you live with every choice. The crew starts as rolled: no Customize, no custom backgrounds, no moving skill points (names, looks and the leader are yours). Works with Normal, Hardcore and Custom.")}><input type="checkbox" data-action="ironman"${ui.ironman ? " checked" : ""}> Ironman</label>
      <label${tip(ui.ironman ? "Not with Ironman: an Ironman crew starts as rolled. Untick Ironman to customize." : "Customize: build each colonist from a blank slate with points (Points each, under Crew): skill levels, traits and their tiers (bad ones give points back; Traits ▸ on each card opens the picker), who they were (a preset or one of your own, Backgrounds… under Crew), what they wear, hold and carry, placed by hand (Gear… on each card). The vehicles' backs are set under Starting vehicles, with or without Customize. Start from the dice loads what was rolled. Unticking puts the crew back as rolled. Not with Ironman.")}${ui.ironman ? ` class="muted"` : ""}><input type="checkbox" data-action="nr-free"${free ? " checked" : ""}${ui.ironman ? " disabled" : ""}> Customize</label>
      <label${tip("First-week guide: a checklist under the alerts for the first days (check the stores, work priorities, a building, a team out and home, the first night), each step with a Show me that points at the button to press. It ticks off as you play and steps aside after day 7; the menu hides it or brings it back. On for your first campaign here.")}><input type="checkbox" data-action="nr-guide"${ui.guide ? " checked" : ""}> First-week guide</label>
      ${FAMILY.enabled ? `<label${tip("Children: couples at a base may have children, who grow up in a year into survivors (Help: Children and families). Untick for a run without couples forming on their own, pregnancies or children.")}><input type="checkbox" data-action="children"${ui.childrenOff ? "" : " checked"}> Children</label>` : ""}
    </div></section>`;
  const short = custom ? customShort(state) : !hard && state.factions.length < ui.factionCount ? `Only ${state.factions.length} of the ${ui.factionCount} groups found room on this map (each needs a site of its own, 8 hexes from the others).` : "";
  const worldGroup = `<section class="nrgroup nrg-world"><h3 class="nrg-h"${tip("The map and what is on it. Changing a count builds the world again on the same seed; your edited colonists are kept")}>World</h3><div class="row nrg-b">
      <label${tip("The same seed always builds the same map. Your edited colonists are kept when you change it.")}>Seed <input type="number" min="1" step="1" style="width:7rem" data-action="seed" value="${state.seed}"></label>
      ${worldSizeSelect(ui)}
      ${custom ? customInputs(state, ["groups", "hives", "cities", "towns", "military"]) : `${groupInput(state, ui)}
      ${hiveSelect(state, ui)}`}
    </div>
    ${customSizeRow(state, ui)}
    <div class="row nrg-b nrg-btns">
      ${worldButton(ui)}
      <button data-action="nr-newmap"${tip(`A new map on a new seed, your survivors kept as they are: names, looks, skills, traits, who they were and the leader${free ? ", and what they were built with" : hard ? " (what they grabbed and the car come with the map)" : ""}`)}>New map</button>
      <button data-action="reroll"${tip("A new map on a new seed and new survivors with it")}>New map and survivors</button>
      <button data-action="nr-start"${tip(`Roll a new starting position on this same map and seed: ${hard ? "another roadside spot to flee from" : "another town for your hub"}, away from the hives and the cities as usual. The map, the hives and your colonists stay as they are (the groups settle around where you are). Look at it with View map; each click is a new spot`)}>📍 New start position</button>
      <button data-action="nr-pick"${tip(`Pick where you start yourself: the map opens and the tile you click is your start (${hard ? "any open land that is not water, a mountain, a hive or another group's base" : `open land for your hub, not water or a mountain, at least ${START_CLEAR} tiles from the towns, the cities, the hives and the other groups`}). The map, the hives and your colonists stay as they are. New start position goes back to the dice`)}>🎯 Pick start on map</button>
    </div>
    ${short ? `<div class="small muted nrg-note">${esc(short)}</div>` : ""}</section>`;
  const crewGroup = `<section class="nrgroup nrg-crew"><h3 class="nrg-h"${tip(free ? `What the whole crew is built with under Customize (${mode}: the other modes keep their own Points each), and the starting vehicles` : "The whole crew at once, how the dead look, and the starting vehicles")}>Crew</h3><div class="row nrg-b">
      ${free
    ? `<label${tip(`Customize (${mode}): the points each colonist may spend (${CUSTOM_POINTS.MIN}–${CUSTOM_POINTS.MAX}, ${CUSTOM_POINTS.DEF} by default: about what an average rolled colonist and their start kit come to). Everyone starts blank; skills, good traits, gear and what they carry cost points, bad traits give some back (at most a third of this). Setting it puts every colonist on it, their own points (on their card) too.`)}>Points each <input type="number" min="${CUSTOM_POINTS.MIN}" max="${CUSTOM_POINTS.MAX}" step="5" style="width:4.5rem" data-action="nr-points" value="${pointsMax(state)}"></label>
      <button data-action="bg-open"${tip(`Make your own backgrounds: skills, traits, gear, supplies and the car (${Object.keys(customLibrary()).length} made)`)}>Backgrounds…</button>
      <button data-action="nr-everything"${tip("Everything at once: every colonist a new name, look and random build (traits, skills and what they wear, hold and carry), within their points, and every starting vehicle's back emptied and filled again up to its own point limit. Each click is a new draw")}>🎲 Randomize everything</button>`
    : `<button data-action="nr-allcrew"${tip(`Randomize every colonist's name, skills, traits, gear and look (skill totals stay the same; gear picked under Customize is cleared)${hard ? ". In Hardcore that is who they were, what they grabbed and whose car they fled in: the world is built again on the same seed" : ": the starting weapons and the vest are handed out again"}. Everything on a crew card does one colonist`)}>🎲 Randomize all</button>`}
      <button data-action="zlook-open"${tip("Change how the dead look in battle")}>Zombie look…</button>
    </div>
    ${fleetSection(state, ui)}</section>`;
  return `<div class="box wide nrscreen">
    ${head}
    <div class="nrbody">
      ${intro}
      <div class="nrgroups">${modeGroup}${worldGroup}${crewGroup}</div>
      <div class="crew nrcrew">${people.map((s) => crewCard(state, ui, s)).join("")}</div>
    </div>
  </div>`;
}

// Overrides to carry the edited crew into a rebuilt world (seed or group count changed).
// A normal start's weapon and armor go along (a Hardcore start's gear is what they grabbed, rolled with the world).
// Who they were goes when picked, or kept through an earlier rebuild (rolled: still the dice's; sim/hardcore-start.js bgKept). Hardcore:
// what they grabbed and the car go with their dice (grabRoll, carRoll, carOwner), so a rebuild hands them out as they were.
// Gear picked under Customize (sim/startgear.js, both modes) goes as the picks, put on again after the dice; for a picked
// weapon or armor the dice's item is carried (s.startDice), not the picked one, so clearing the pick gives it back.
export function crewSnapshot(state) {
  // A custom background's kit comes with it again (sim/hardcore-start.js normalStartKit), not from here.
  const kit = (s) => {
    if (isHardcore(state) || (s.bgPicked && isCustomBg(s.background))) return null;
    const dice = s.startDice || {}, out = {};
    for (const k of ["weapon", "armor"]) { const it = k in dice ? dice[k] : s.gear[k]; out[k] = it ? { ...it } : null; }
    return out;
  };
  return state.survivors.map((s) => ({ name: s.name, skills: { ...s.skills }, traits: [...s.traits], traitTier: { ...(s.traitTier || {}) }, budget: s.skillBudget ?? skillTotal(s.skills), appearance: s.appearance ? { ...s.appearance } : null, gear: kit(s), leader: !!s.leader, background: s.bgPicked || s.bgKept ? s.background : null, rolled: !s.bgPicked && !!s.bgKept, custom: !!s.startCustom, points: !!s.startPoints, startGear: sanitizeStartGear(s.startGear), grabRoll: s.grabRoll ?? null, grabPick: !!s.grabPick, carRoll: s.carRoll ?? null, carOwner: !!(state.hardcore && state.hardcore.start && state.hardcore.start.carOwner === s.id), ownMax: Number.isFinite(s.ownMax) ? s.ownMax : null }));
}
// Customize ticked (main.js): every colonist blank (skills 0, no traits, nothing worn or carried), built on points.
// Names, looks, the leader and a picked background stay.
export function blankCrew(state) {
  const none = Object.fromEntries(["weapon", "tool", "armor", "head", "arms", "legs", "rig", "backpack"].map((k) => [k, ""]));
  return state.survivors.map((s) => ({ name: s.name, appearance: s.appearance ? { ...s.appearance } : null, leader: !!s.leader, background: s.bgPicked ? s.background : null, skills: Object.fromEntries(SKILLS.map((k) => [k, 0])), traits: [], traitTier: {}, points: true, custom: true, startGear: { slots: { ...none }, carry: { pocket: [], pouch: [], pack: [] } } }));
}
// An Ironman crew (main.js, the Ironman box): only what is yours in Ironman (names, looks, the leader); skills, traits,
// who they were and the kit go back to the dice.
export function ironmanCrew(state) {
  return state.survivors.map((s) => ({ name: s.name, appearance: s.appearance ? { ...s.appearance } : null, leader: !!s.leader }));
}
// Anything on the crew past the dice (Customize, moved skill points, a picked background): not for Ironman.
export const crewCustomized = (state) => state.survivors.some((s) => s.startCustom || s.bgPicked);
// Backgrounds picked (the nr-bg select; the backgrounds window's Done): the crew to rebuild with. changes: { id: key }
// ("" or null: back to the dice). A changed colonist's skills, traits and points start over from the new background;
// the others keep theirs and who they were (rolled: kept, not counted as picked), whatever the new dice draw.
export function crewWithBackgrounds(state, changes) {
  const crew = crewSnapshot(state);
  let any = false;
  state.survivors.forEach((s, i) => {
    if (Object.prototype.hasOwnProperty.call(changes, s.id)) {
      const key = changes[s.id] || null;
      const { skills, traits, traitTier, budget, gear, startGear, rolled, ...rest } = crew[i]; // gear: a normal start's kit is handed out again
      // Built on points: the new background's own skills, traits and kit are loaded as their picks after the rebuild
      // (main.js, ui/startgear.js loadDice) and priced like anything else; else the picked gear stays.
      crew[i] = { ...rest, background: key, custom: !!key || !!rest.points, ...(rest.points ? {} : { startGear }) };
      any = true;
    } else if (!crew[i].background && s.background) crew[i] = { ...crew[i], background: s.background, rolled: true };
  });
  return any ? crew : null;
}
export const crewWithBackground = (state, id, key) => crewWithBackgrounds(state, { [id]: key });

// Randomize all: every colonist's name, skills (same total), traits, gear and look. Customize: a new name, look and
// random build each (sim/randomkit.js), the world built again with them. Normal: in place, with the starting
// weapons and the vest handed out again (gear picked under Customize is cleared first: the world is built again without
// it, so the dice's kit is back to be shuffled). Hardcore: the gear comes with who they were, what they grabbed and the car, so
// the world is built again on the same seed with a crew roll of its own: rebuild(crew, crewRoll) returns the new state,
// whose background-shaped skills are then fitted to each colonist's old total. Returns the state to keep.
export function randomizeAllCrew(state, ui, rebuild) {
  const rng = freshRng();
  if (freeEdit(ui)) { // Customize: a new name, look and random build each (within the points)
    state.survivors.forEach((s) => {
      reroll(state, ui, s, ["name", "look"]);
      randomBuild(state, s, rng);
      s.startPoints = true;
      s.startCustom = true;
    });
    return rebuild(crewSnapshot(state), ui.crewRoll ?? null, ui.pickRoll);
  }
  if (!isHardcore(state) && state.survivors.some((s) => hasPicks(sanitizeStartGear(s.startGear)))) {
    const crew = crewSnapshot(state).map((c) => ({ ...c, startGear: null }));
    state = rebuild(crew, ui.crewRoll ?? null);
  }
  if (!isHardcore(state)) {
    const weapons = rng.shuffle(state.survivors.map((s) => s.gear.weapon));
    const armor = rng.shuffle(state.survivors.map((s) => s.gear.armor));
    state.survivors.forEach((s, i) => {
      reroll(state, ui, s, ["name", "skills", "look"]);
      s.traits = rollTraits(rng);
      s.gear.weapon = weapons[i];
      s.gear.armor = armor[i];
    });
    return state;
  }
  const budgets = state.survivors.map((s) => budgetOf(ui, s));
  const names = [];
  const crew = state.survivors.map((s, i) => {
    const name = randomName(rng, names);
    names.push(name);
    return { name, appearance: randomAppearance(rng), budget: budgets[i], leader: !!s.leader };
  });
  const next = rebuild(crew, 1 + Math.floor(rng.next() * 2147483646));
  next.survivors.forEach((s, i) => { if (budgets[i] != null) s.skills = fitSkills(rng, s.skills, budgets[i]); });
  return next;
}

// Randomize everything (Customize only): Randomize all's names, looks and builds (sim/randomkit.js randomEverything),
// and every starting vehicle's back emptied and filled again up to its own point limit (sim/startfleet.js; the screen's
// ui.fleet), rounds for the crew's new guns. In Hardcore the riders' kit rides in the car, so its room is reckoned with
// the new kits in place of the old. The world is built again with them. Returns the state to keep (as is outside
// Customize).
/** @param {any} state @param {any} ui @param {(crew: any[], crewRoll: any, pickRoll: any) => any} rebuild */
export function randomizeEverything(state, ui, rebuild) {
  if (ui.started || !freeEdit(ui)) return state;
  const rng = freshRng();
  const hard = isHardcore(state), F = uiFleet(state, ui);
  const worn = state.survivors.reduce((a, s) => a + wornLoad(s), 0);
  state.survivors.forEach((s) => reroll(state, ui, s, ["name", "look"]));
  randomEverything(state, rng);
  state.survivors.forEach((s) => { s.startPoints = true; s.startCustom = true; });
  const guns = state.survivors.map((s) => s.startGear.slots.weapon).filter(Boolean).map((key) => ({ key }));
  const kitKg = state.survivors.reduce((a, s) => a + trunkKg({ items: kitKeys(s.startGear) }), 0);
  F.forEach((f, i) => {
    if (!state.fleet || !state.fleet[i] || state.fleet[i].vid == null) return; // Start with a vehicle off: none to fill
    const room = Math.max(0, fleetRoom(state, i) + (hard && ridesIn(state, i) ? worn - kitKg : 0)); // the riders ride in the first vehicle
    f.load = randomTrunk(f.limit, room, rng, gunCals([], guns), { fill: true, open: openLoads(state) });
    state.fleet[i].load = f.load;
  });
  return rebuild(crewSnapshot(state), ui.crewRoll ?? null, ui.pickRoll);
}

// Random run (2026-10-16, user request): every setting on the new-run screen rolled at once (main.js nr-random builds the
// world on a new seed, randomizes the crew and starts). Ironman, Customize, the guide and Children are the player's own
// and stay. The zombie look is rolled too (saved in this browser, like picking it by hand). Returns a line for the log.
const RANDOM_HIVES = [2, 6]; // starting hives when not the map's own: few enough that a Small map is no death trap
const RANDOM_POINTS = [60, 150]; // Customize's Points each, in steps of 5
export function rollRandomRun(ui, rng) {
  ui.worldSize = rng.pick(SIZE_KEYS);
  const d = sizeDef(ui.worldSize);
  ui.factionCount = clampGroups(ui.worldSize, rng.int(d.groups[0], d.groups[1]));
  ui.hiveCount = rng.chance(0.5) ? null : clampHives(rng.int(RANDOM_HIVES[0], RANDOM_HIVES[1]));
  const was = ui.mode;
  const mode = rng.chance(0.5) ? "hardcore" : "normal"; // never Custom (2026-10-24): a random run is Normal or Hardcore
  if (was !== mode) { stashModeSet(ui); takeModeSet(ui, mode); } // main.js ui.modeSets: each mode keeps its own (Custom's too)
  const R = peopleRange(ui.mode);
  ui.startPeople = clampStartPeople(rng.int(R.MIN, R.MAX), ui.mode);
  if (freeEdit(ui)) ui.pointsMax = clampMax(5 * rng.int(RANDOM_POINTS[0] / 5, RANDOM_POINTS[1] / 5));
  for (const [k, o] of Object.entries(ZOMBIE_LOOK_OPTIONS)) setZombieLook(k, rng.pick(o.values)[0]);
  return `A random run: ${MODES[ui.mode].label} with ${ui.startPeople} ${ui.startPeople === 1 ? "survivor" : "survivors"}, a ${d.label} map, ${ui.factionCount} other groups, ${ui.hiveCount == null ? "the map's own hives" : `${ui.hiveCount} hives`}${freeEdit(ui) ? `, ${ui.pointsMax} points each` : ""}.`;
}

// ---------- one colonist's dice (the crew card's Background, Gear and All) ----------
// Each returns the state to keep. rebuild(crew, pick): the world again on the same seed (main.js newWorld): crew null
// with the edited crew as it stands; else with this crew (pick: a background was picked, main.js pickRebuild).
const newRoll = (rng) => 1 + Math.floor(rng.next() * 2147483646);
// A random preset background for s (sim/hardcore-start.js ARCHETYPES): not theirs now, and none of the crew's others'
// while one is free. null: none to draw.
export function randomBackground(state, s, rng = freshRng()) {
  const keys = Object.keys(HC_START.ARCHETYPES).filter((k) => k !== s.background);
  const taken = new Set(state.survivors.filter((o) => o !== s).map((o) => o.background));
  const free = keys.filter((k) => !taken.has(k));
  const pool = free.length ? free : keys;
  return pool.length ? rng.pick(pool) : null;
}
// A normal start's crewmate to trade the starting weapon and vest with: one whose kit differs (null: nobody's does).
function tradePartner(state, s, rng) {
  const same = (a, b) => (a ? a.key : null) === (b ? b.key : null);
  const others = state.survivors.filter((o) => o !== s && !(same(o.gear.weapon, s.gear.weapon) && same(o.gear.armor, s.gear.armor)));
  return others.length ? rng.pick(others) : null;
}

// Gear on a crew card. Customize: a random kit on their points left (sim/randomkit.js randomKit). Hardcore: what they
// grabbed drawn again on dice of its own (crew[i].grabRoll: sim/hardcore-start.js ownGrab; not in Ironman). Normal: their
// starting weapon and vest traded with a crewmate's, in place.
export function randomizeGear(state, ui, s, rebuild) {
  if (!s || ui.started) return state;
  const rng = freshRng();
  if (freeEdit(ui)) {
    s.startGear = sanitizeStartGear(randomKit(kitBudget(state, s), rng));
    s.startPoints = true;
    s.startCustom = true;
    ui.crewEdited = true;
    return rebuild(null);
  }
  if (isHardcore(state)) {
    if (ui.ironman) return state;
    const crew = crewSnapshot(state);
    Object.assign(crew[state.survivors.indexOf(s)], { grabRoll: newRoll(rng), grabPick: true });
    return rebuild(crew, false);
  }
  const o = tradePartner(state, s, rng);
  if (!o) return state;
  [s.gear.weapon, o.gear.weapon] = [o.gear.weapon, s.gear.weapon];
  [s.gear.armor, o.gear.armor] = [o.gear.armor, s.gear.armor];
  ui.crewEdited = true;
  return state;
}

// All on a crew card: everything for this colonist, and nobody else's. Customize: a new background (what it gives is
// loaded, then replaced), name, look and random build within their points. Otherwise a new background, name, look,
// skills (the same total) and traits, in one rebuild; Hardcore: what they grabbed on dice of its own (the others keep
// theirs: sim/hardcore-start.js ownGrab). A normal start: a new weapon of the start's own (sim/world.js START_WEAPONS),
// not the one they hold, and the vest stays (trading would change a crewmate's: that is the Gear dice). Ironman: name,
// skills and look only (traits and who they were stay as rolled).
export function randomizeOne(state, ui, s, rebuild) {
  if (!s || ui.started) return state;
  const rng = freshRng();
  const i = state.survivors.indexOf(s);
  if (ui.ironman) {
    reroll(state, ui, s, ["name", "skills", "look"]);
    return state;
  }
  const key = randomBackground(state, s, rng);
  if (freeEdit(ui)) {
    const crew = key ? crewWithBackground(state, s.id, key) : null;
    if (crew) state = rebuild(crew, true);
    const t = state.survivors[i];
    if (!t) return state;
    t.name = randomName(rng, state.survivors.filter((o) => o !== t).map((o) => o.name));
    t.appearance = randomAppearance(rng);
    randomBuild(state, t, rng);
    t.startPoints = true;
    t.startCustom = true;
    ui.crewEdited = true;
    return rebuild(null);
  }
  const budget = budgetOf(ui, s);
  const crew = (key && crewWithBackground(state, s.id, key)) || crewSnapshot(state);
  const c = crew[i];
  c.name = randomName(rng, state.survivors.filter((o) => o !== s).map((o) => o.name));
  c.appearance = randomAppearance(rng);
  c.skills = randomSkills(rng, budget);
  c.budget = budget;
  c.traits = rollTraits(rng);
  delete c.traitTier;
  if (isHardcore(state)) { c.grabRoll = newRoll(rng); c.grabPick = true; }
  else c.gear = { ...(crewSnapshot(state)[i].gear || {}), weapon: startWeapon(rng, s) }; // their vest as it was (a background change leaves out the kit)
  return rebuild(crew, !!key);
}
// A normal start's weapon drawn again for s: one of the start's own, part-worn and maybe with a cheap part, as the dice
// hand them out (sim/world.js createWorld), not the kind they hold now.
function startWeapon(rng, s) {
  const now = s.gear.weapon ? s.gear.weapon.key : null;
  const item = newItem(rng.pick(START_WEAPONS.filter((k) => k !== now)), 1, rng.next(), START_DUR);
  randomStarterMods(rng, item, newRoll(rng));
  return item;
}

// ---------- zombie look settings ----------
export function zombieLookModal(ui) {
  const look = zombieLook();
  const seed = ui.zseed || 1;
  const preview = ZOMBIE_VARIANTS.map((v) => `<div class="zprev"><div class="lookstage">${spriteImg(zombieURL(v, seed * 3 + v.length), 5)}${spriteImg(zombieURL(v, seed * 7 + v.length * 5), 5)}</div><div class="small muted">${VARIANT_NAMES[v]}</div></div>`).join("");
  const rows = Object.entries(ZOMBIE_LOOK_OPTIONS).map(([k, o]) => `<div class="row zrow"><span style="width:7rem"${tip(o.tip)}>${o.name}</span>
      ${o.values.map(([v, l]) => `<button class="mini ${look[k] === v ? "active" : ""}" data-action="zlook" data-k="${k}" data-v="${v}">${l}</button>`).join("")}</div>`).join("");
  return `<div class="box"><h1>Zombie look</h1>
    <div class="where">How the dead are drawn in battles and raids. Saved in this browser. Looks only: it does not change how they fight.</div>
    <div class="zprevs">${preview}</div>
    ${rows}
    <div class="row" style="margin-top:1rem;justify-content:flex-end">
      <button data-action="zlook-reroll"${tip("Show other random examples")}>🎲 Other examples</button>
      <button data-action="zlook-reset"${tip("Back to the default look")}>Reset</button>
      <button class="primary" data-action="zlook-close">Done</button>
    </div></div>`;
}

// Back from looking at the map before the start (View map): the windows opened from the map's panels are closed, so
// none of them waits behind the new-run screen to pop up at Start.
const MAP_WINDOWS = ["baseView", "survivor", "roster", "diary", "codex", "ledger", "inv", "planner", "routeSetup", "caravanPlan", "gunb", "diplo", "volPick", "volReq", "memorial", "radioWith"];
export function backToSetup(ui) {
  ui.nrMap = false;
  ui.nrPick = false; // Pick start on map ends with the map
  for (const k of MAP_WINDOWS) if (ui[k] != null && ui[k] !== false) ui[k] = null;
}

// ---------- actions (registered in main.js; each gets (state, ui, data)) ----------
const valid = (k, v) => (LOOK_OPTIONS[k] ? LOOK_OPTIONS[k].values.some(([x]) => x === v) : LOOK_COLORS[k] ? /^#[0-9a-fA-F]{6}$/.test(v) : false);
function setLook(state, ui, id, k, v) {
  const s = survivorById(state, Number(id));
  if (!s || !valid(k, v)) return;
  ensureAppearance(s, state.seed)[k] = v;
  if (!ui.started) ui.crewEdited = true;
}
function reroll(state, ui, s, what) {
  const rng = freshRng();
  if (what.includes("name")) s.name = randomName(rng, state.survivors.map((o) => o.name));
  if (what.includes("skills")) s.skills = randomSkills(rng, budgetOf(ui, s));
  if (what.includes("look")) s.appearance = randomAppearance(rng);
  ui.crewEdited = true;
}
const withSurvivor = (what) => (state, ui, d) => { const s = survivorById(state, Number(d.id)); if (s) reroll(state, ui, s, what); };

export const LOOK_ACTIONS = {
  // The new-run screen put aside to look at the map, or back (main.js bannerHTML; Esc).
  "nr-map": (state, ui) => { if (ui.started) return; if (ui.nrMap) backToSetup(ui); else ui.nrMap = true; },
  // Pick start on map (sim/startpick.js): the map opens, and a click on it picks the start (main.js pickStartAt).
  "nr-pick": (state, ui) => { if (ui.started) return; ui.nrPick = !ui.nrPick; if (ui.nrPick) { ui.nrMap = true; ui.nrMsg = ""; } },
  // A crew card's fold (Traits ▸ under Customize): open or shut, kept by colonist in ui.nrOpen ("id:traits") through the
  // world being built again (it is not in main.js freshUi), so a background picked does not fold the picker away.
  "nr-fold": (state, ui, d) => { const o = ui.nrOpen || (ui.nrOpen = {}); const k = `${Number(d.id)}:${d.k}`; if (o[k]) delete o[k]; else o[k] = true; },
  "look-edit": (state, ui, d) => { ui.lookEdit = ui.lookEdit === Number(d.id) ? null : Number(d.id); },
  "look-done": (state, ui) => { ui.lookEdit = null; },
  "look-set": (state, ui, d) => setLook(state, ui, d.id, d.k, d.v),
  "look-rand": (state, ui, d) => { const s = survivorById(state, Number(d.id)); if (s) { s.appearance = randomAppearance(freshRng()); if (!ui.started) ui.crewEdited = true; } },
  "nr-name": withSurvivor(["name"]),
  "nr-skills": withSurvivor(["skills"]),
  "nr-look": withSurvivor(["look"]),
  // One colonist's traits (the crew card's Traits; not in Ironman): under Customize good and bad within their points
  // (sim/randomkit.js randomTraits), else one or two as the dice roll them.
  "nr-rand-traits": (state, ui, d) => {
    const s = survivorById(state, Number(d.id));
    if (!s || ui.started || ui.ironman) return;
    if (freeEdit(ui)) {
      randomTraits(state, s, freshRng());
      s.startPoints = true;
      s.startCustom = true;
    } else {
      s.traits = rollTraits(freshRng());
      tidyTiers(s);
    }
    ui.crewEdited = true;
  },
  "nr-skill": (state, ui, d) => {
    const s = survivorById(state, Number(d.id));
    if (!s || ui.started || ui.ironman) return; // Ironman: skills stay as rolled
    const k = d.k, delta = Number(d.d), free = freeEdit(ui);
    if (!SKILLS.includes(k)) return;
    const left = budgetOf(ui, s) - skillTotal(s.skills);
    if (delta > 0 && ((!free && left <= 0) || s.skills[k] >= SKILL_MAX)) return;
    if (delta < 0 && s.skills[k] <= 0) return;
    s.skills[k] += delta > 0 ? 1 : -1;
    if (free) { s.skillBudget = Math.max(budgetOf(ui, s), skillTotal(s.skills)); s.startPoints = true; } // points, not the pool (custompoints.js)
    s.startCustom = true;
    ui.crewEdited = true;
  },
  // Customize: a trait on or off (at most MAX_TRAITS, never two that clash: data.js TRAIT_CLASH).
  "nr-trait": (state, ui, d) => {
    const s = survivorById(state, Number(d.id));
    if (!s || ui.started || !freeEdit(ui) || !TRAITS[d.k]) return;
    if (s.traits.includes(d.k)) s.traits = s.traits.filter((t) => t !== d.k);
    else if (!traitBlock(s.traits, d.k, MAX_TRAITS)) s.traits = [...s.traits, d.k];
    else return;
    tidyTiers(s);
    s.startCustom = true;
    s.startPoints = true;
    ui.crewEdited = true;
  },
  // Customize: a picked trait a tier up or down (traits.js TRAIT_TIERS; its points follow).
  "nr-tier": (state, ui, d) => {
    const s = survivorById(state, Number(d.id));
    if (!s || ui.started || !freeEdit(ui) || !s.traits.includes(d.k) || tierCount(d.k) < 2) return;
    const n = cleanTier(d.k, traitTier(s, d.k) + (Number(d.d) > 0 ? 1 : -1));
    if (n === traitTier(s, d.k)) return;
    setTier(s, d.k, n);
    s.startCustom = true;
    s.startPoints = true;
    ui.crewEdited = true;
  },
  "zlook-open": (state, ui) => { ui.zombieLook = true; },
  "zlook-close": (state, ui) => { ui.zombieLook = false; },
  "zlook": (state, ui, d) => setZombieLook(d.k, d.v),
  "zlook-reset": () => resetZombieLook(),
  "zlook-reroll": (state, ui) => { ui.zseed = (ui.zseed || 1) + 1; },
};

export const LOOK_CHANGE_ACTIONS = {
  look: (state, ui, el) => setLook(state, ui, el.dataset.id, el.dataset.k, el.value),
  // Customize: one colonist's own points max (sim/custompoints.js maxFor); the others keep theirs.
  "nr-ownpoints": (state, ui, el) => {
    const s = survivorById(state, Number(el.dataset.id));
    if (!s || ui.started || !freeEdit(ui)) return;
    s.ownMax = clampMax(el.value);
    el.value = s.ownMax;
    ui.crewEdited = true;
  },
};
