// New-run setup screen, survivor appearance editor and zombie look settings.
// HTML builders plus their action handlers; main.js registers the handlers with its dispatcher.
import { SKILLS, SKILL_NAMES, TRAITS } from "../sim/data.js";
import { survivorById, skill, rollTraits } from "../sim/world.js";
import { latestSave, listSaves } from "./saves.js";
import { WORLD_SIZES, SIZE_KEYS, sizeDef, customDef, isCustom, CUSTOM, GROUPS_MAX, HIVES_MAX } from "../sim/worldsize.js";
import { MODES, isHardcore, START_PEOPLE, clampStartPeople } from "../sim/hardcore.js";
import { BACKGROUNDS, countWord } from "../sim/hardcore-start.js"; // who they were (a hardcore start)
import {
  LOOK_OPTIONS, LOOK_COLORS, ensureAppearance, randomAppearance, freshRng, randomName, randomSkills, fitSkills, skillTotal, SKILL_MAX,
} from "../sim/appearance.js";
import {
  appearanceURL, survivorURL, zombieURL, spriteImg, ZOMBIE_LOOK_OPTIONS, ZOMBIE_VARIANTS, zombieLook, setZombieLook, resetZombieLook,
} from "./sprites.js";

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
    return d ? `${TRAITS[t].name} ${d > 0 ? "+" : "−"}${Math.abs(d)}` : "";
  }).filter(Boolean).join(", ");
  return `<i class="nrmod ${eff < s.skills[k] ? "neg" : ""}"${tip(`Counts as ${eff} in play${why ? `: ${why}` : ""}. The points are what you spend; traits are applied on top.`)}>→${eff}</i>`;
}

function crewCard(state, ui, s) {
  const left = budgetOf(ui, s) - skillTotal(s.skills);
  if (ui.lookEdit === s.id) {
    return `<div class="card leader-pick nrcard nrwide ${s.leader ? "on" : ""}">
      <div class="spread"><b>${s.leader ? "★ " : ""}${esc(s.name)}</b><span class="muted small">Appearance</span></div>
      ${appearanceEditor(state, s)}</div>`;
  }
  const skills = SKILLS.map((k) => `<div class="nrskill"><span>${SKILL_NAMES[k]}</span>
      <button class="mini" data-action="nr-skill" data-id="${s.id}" data-k="${k}" data-d="-1" ${s.skills[k] > 0 ? "" : "disabled"}${tip("Move a point back to the pool")}>−</button>
      <b>${s.skills[k]}${traitMod(s, k)}</b>
      <button class="mini" data-action="nr-skill" data-id="${s.id}" data-k="${k}" data-d="1" ${left > 0 && s.skills[k] < SKILL_MAX ? "" : "disabled"}${tip("Spend a point from the pool")}>+</button></div>`).join("");
  return `<div class="card leader-pick nrcard ${s.leader ? "on" : ""}">
    <div class="nrtop">
      <div class="nrport" data-action="look-edit" data-id="${s.id}"${tip("Click to customize how they look")}>${spriteImg(survivorURL(s, state.seed), 4.4)}<div class="small muted">Edit look</div></div>
      <div style="flex:1;min-width:0">
        <div class="row"><input data-action="rename" data-id="${s.id}" value="${esc(s.name)}" style="flex:1;min-width:6rem"${tip("Rename")}>
          <button class="mini" data-action="nr-name" data-id="${s.id}"${tip("Random name")}>🎲</button></div>
        <div class="row" style="margin-top:0.3rem">
          <button class="mini ${s.leader ? "active" : ""}" data-action="pickleader" data-id="${s.id}"${tip("The leader's Leadership lifts morale at their base. If they die, you pick a new one.")}>${s.leader ? "★ Leader" : "Make leader"}</button>
          <span class="small muted">${s.gear.weapon ? esc(s.gear.weapon.name) : ""}${s.gear.armor ? `, ${esc(s.gear.armor.name)}` : ""}${s.gear.backpack ? `${s.gear.weapon || s.gear.armor ? ", " : ""}${esc(s.gear.backpack.name)}` : ""}</span></div>
        <div class="small" style="margin-top:0.2rem">${s.background && BACKGROUNDS[s.background] ? `<span class="chip"${tip(`Who they were before Calder fell (Hardcore): ${BACKGROUNDS[s.background].blurb}. It shaped their skills, what they grabbed and the car.`)}>${esc(BACKGROUNDS[s.background].name)}</span>` : ""}${s.traits.map((t) => `<span class="chip trait"${tip(TRAITS[t].desc)}>${TRAITS[t].name}</span>`).join("")}</div>
      </div>
    </div>
    <div class="spread small" style="margin-top:0.35rem"><span class="muted">Skills</span><span${tip("Points can be moved between skills. Randomizing skills keeps the same total, so nobody gets better or worse overall.")}>Points left <b class="${left > 0 ? "warn" : ""}">${left}</b> / ${budgetOf(ui, s)}</span></div>
    <div class="nrskills">${skills}</div>
    <div class="row nrrand">
      <span class="small muted">Randomize</span>
      <button class="mini" data-action="nr-name" data-id="${s.id}"${tip("New random name")}>Name</button>
      <button class="mini" data-action="nr-skills" data-id="${s.id}"${tip("Shuffle skills, same point total")}>Skills</button>
      <button class="mini" data-action="nr-look" data-id="${s.id}"${tip("New random look")}>Look</button>
      <button class="mini" data-action="nr-all" data-id="${s.id}"${tip("Randomize name, skills and look")}>All</button>
    </div>
  </div>`;
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
// Starting hives: what the map makes (Default), or 0–10.
function hiveSelect(state, ui) {
  const made = isHardcore(state) ? state.hardcore?.outbreak?.normalHives ?? (state.hives || []).length : (state.hives || []).length;
  const cur = ui.hiveCount == null ? "default" : String(ui.hiveCount);
  const opts = [`<option value="default" ${cur === "default" ? "selected" : ""}>Default${ui.hiveCount == null ? ` (${made})` : ""}</option>`];
  for (let v = 0; v <= HIVES_MAX; v++) opts.push(`<option value="${v}" ${cur === String(v) ? "selected" : ""}>${v}</option>`);
  const t = `How many hives the outbreak starts with (Default: what this map makes on its own). More hives mean more hordes from the start; with none, new hives still rise near the border.${isHardcore(state) ? " In Hardcore the outbreak still begins with one hive: this is how many the first year grows to." : ""}`;
  return `<label${tip(t)}>Starting hives <select data-action="hivecount">${opts.join("")}</select></label>`;
}

// Normal or Hardcore (sim/hardcore.js MODES): the mode the world on this screen was built with.
function modeSelect(state) {
  const cur = isHardcore(state) ? "hardcore" : "normal";
  const opts = Object.entries(MODES).map(([k, m]) => `<option value="${k}" ${k === cur ? "selected" : ""}${tip(m.tip)}>${esc(m.label)}</option>`).join("");
  return `<label${tip(`${MODES[cur].tip}. Changing it builds the world again on the same seed (your edited colonists are kept: in Hardcore the first ${countWord(START_PEOPLE.DEF)}, or as many as Starting people says).`)}>Mode <select data-action="gamemode">${opts}</select></label>`;
}

// Starting people (Hardcore only, sim/hardcore.js START_PEOPLE): how many flee together on day 1. A normal start is a
// full hub of six, so the select is shown greyed out there with the reason.
// The count shown: the world's own (Hardcore), else the screen's setting (kept for when Hardcore is picked).
function startPeopleSelect(state, ui) {
  const hard = isHardcore(state);
  const cur = hard && Number.isFinite(state.startPeople) ? state.startPeople : clampStartPeople(ui.startPeople ?? START_PEOPLE.DEF);
  const opts = [];
  for (let v = START_PEOPLE.MIN; v <= START_PEOPLE.MAX; v++) opts.push(`<option value="${v}" ${v === cur ? "selected" : ""}>${v}${v === START_PEOPLE.DEF ? " (default)" : ""}</option>`);
  const t = hard
    ? `How many of you flee together on the day Calder falls, ${START_PEOPLE.MIN}–${START_PEOPLE.MAX} (${START_PEOPLE.DEF} by default). Each one brings what they grabbed (1–3 days of food and water each), so fewer hands carry less, scavenge, build the first camp and fight slower; the car, what is in its back and a prepper's bag are one of each whatever the count, so a small team has more of those to share. Changing it builds the world again on the same seed`
    : `Hardcore only: a normal start is a hub with six survivors. Pick Hardcore under Mode to choose how many flee together (${START_PEOPLE.MIN}–${START_PEOPLE.MAX})`;
  return `<label${tip(t)}${hard ? "" : ` class="muted"`}>Starting people <select data-action="startpeople"${hard ? "" : " disabled"}>${opts.join("")}</select>${hard ? "" : ` <span class="small">(Hardcore only)</span>`}</label>`;
}

export function newRunScreen(state, ui) {
  const people = state.survivors;
  const hard = isHardcore(state);
  const intro = hard
    ? `Hardcore. The day the State of Calder falls. ${people.length === 1 ? "You get out alone" : `${countWord(people.length).replace(/^./, (c) => c.toUpperCase())} of you get out`} with whatever you can grab: no hub, food and water for a day or three, and the outbreak just starting. Gather what a hub takes and found your own. ${state.factions.length} other groups are out there, starting out just like you.`
    : `Six years after the outbreak. Your survivors hold a town in the State of Calder. ${state.factions.length} other groups are out there, along with the hordes.`;
  return `<div class="box wide">
    <h1>Broken State — New run</h1>
    <div class="text small">${intro} Customize your starting colonists (name, skills, look) and choose your leader. The game starts paused: give your first orders, then press Space.</div>
    <div class="row" style="margin-bottom:0.8rem">
      ${modeSelect(state)}
      ${startPeopleSelect(state, ui)}
      <label${tip("Ironman: the game saves itself (at dawn, when a battle starts and ends, when you leave it) to one slot of its own. No saving or loading by hand, no restarting a battle, no export: you live with every choice. Works with Normal and Hardcore.")}><input type="checkbox" data-action="ironman"${ui.ironman ? " checked" : ""}> Ironman</label>
      <label${tip("The same seed always builds the same map. Your edited colonists are kept when you change it.")}>Seed <input type="number" min="1" step="1" style="width:7rem" data-action="seed" value="${state.seed}"></label>
      ${worldSizeSelect(ui)}
      ${groupInput(state, ui)}
      ${hiveSelect(state, ui)}
      <button data-action="reroll"${tip("Generate a new map and new colonists")}>New map and colonists</button>
      <button data-action="nr-allcrew"${tip(`Randomize every colonist's name, skills, traits, gear and look (skill totals stay the same)${hard ? ". In Hardcore that is who they were, what they grabbed and whose car they fled in: the world is built again on the same seed" : ": the starting weapons and the vest are handed out again"}`)}>🎲 Randomize all</button>
      <button data-action="zlook-open"${tip("Change how the dead look in battle")}>Zombie look…</button>
    </div>
    ${customSizeRow(state, ui)}
    ${!hard && state.factions.length < ui.factionCount ? `<div class="small muted" style="margin-bottom:0.5rem">Only ${state.factions.length} of the ${ui.factionCount} groups found room on this map (each needs a site of its own, 8 hexes from the others).</div>` : ""}
    ${ui.nrMsg ? `<div class="small danger" style="margin-bottom:0.5rem">${esc(ui.nrMsg)}</div>` : ""}
    <div class="crew nrcrew">${people.map((s) => crewCard(state, ui, s)).join("")}</div>
    <div class="row" style="margin-top:1rem;justify-content:flex-end">${loadButtons()}<button class="primary" data-action="begin">Start</button></div>
  </div>`;
}

// Continue (the latest save) and Load game (the menu's save list), when this browser has saves (ui/saves.js).
function loadButtons() {
  const last = latestSave();
  if (!last) return "";
  const n = listSaves().length;
  return `<button data-action="set-continue"${tip(`Load the latest save: ${last.name} (day ${last.day}, ${last.survivors} alive, seed ${last.seed})`)}>▶ Continue: ${esc(last.name)}</button>
    <button data-action="set-open" data-tab="game"${tip(`Pick one of your ${n} save${n === 1 ? "" : "s"}, or load a save file`)}>Load game…</button>
    <span style="flex:1"></span>`;
}

// Overrides to carry the edited crew into a rebuilt world (seed or group count changed).
// A normal start's weapon and armor go along (a Hardcore start's gear is what they grabbed, rolled with the world).
export function crewSnapshot(state) {
  const kit = (s) => (isHardcore(state) ? null : { weapon: s.gear.weapon ? { ...s.gear.weapon } : null, armor: s.gear.armor ? { ...s.gear.armor } : null });
  return state.survivors.map((s) => ({ name: s.name, skills: { ...s.skills }, traits: [...s.traits], budget: s.skillBudget ?? skillTotal(s.skills), appearance: s.appearance ? { ...s.appearance } : null, gear: kit(s), leader: !!s.leader }));
}

// Randomize all: every colonist's name, skills (same total), traits, gear and look. Normal: in place, with the starting
// weapons and the vest handed out again. Hardcore: the gear comes with who they were, what they grabbed and the car, so
// the world is built again on the same seed with a crew roll of its own: rebuild(crew, crewRoll) returns the new state,
// whose background-shaped skills are then fitted to each colonist's old total. Returns the state to keep.
export function randomizeAllCrew(state, ui, rebuild) {
  const rng = freshRng();
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
  "look-edit": (state, ui, d) => { ui.lookEdit = ui.lookEdit === Number(d.id) ? null : Number(d.id); },
  "look-done": (state, ui) => { ui.lookEdit = null; },
  "look-set": (state, ui, d) => setLook(state, ui, d.id, d.k, d.v),
  "look-rand": (state, ui, d) => { const s = survivorById(state, Number(d.id)); if (s) { s.appearance = randomAppearance(freshRng()); if (!ui.started) ui.crewEdited = true; } },
  "nr-name": withSurvivor(["name"]),
  "nr-skills": withSurvivor(["skills"]),
  "nr-look": withSurvivor(["look"]),
  "nr-all": withSurvivor(["name", "skills", "look"]),
  "nr-skill": (state, ui, d) => {
    const s = survivorById(state, Number(d.id));
    if (!s || ui.started) return;
    const k = d.k, delta = Number(d.d);
    if (!SKILLS.includes(k)) return;
    const left = budgetOf(ui, s) - skillTotal(s.skills);
    if (delta > 0 && (left <= 0 || s.skills[k] >= SKILL_MAX)) return;
    if (delta < 0 && s.skills[k] <= 0) return;
    s.skills[k] += delta > 0 ? 1 : -1;
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
};
