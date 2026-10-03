// New-run setup screen, survivor appearance editor and zombie look settings.
// HTML builders plus their action handlers; main.js registers the handlers with its dispatcher.
import { SKILLS, SKILL_NAMES, TRAITS } from "../sim/data.js";
import { survivorById, skill } from "../sim/world.js";
import {
  LOOK_OPTIONS, LOOK_COLORS, ensureAppearance, randomAppearance, freshRng, randomName, randomSkills, skillTotal, SKILL_MAX,
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
          <span class="small muted">${s.gear.weapon ? esc(s.gear.weapon.name) : ""}${s.gear.armor ? `, ${esc(s.gear.armor.name)}` : ""}</span></div>
        <div class="small" style="margin-top:0.2rem">${s.traits.map((t) => `<span class="chip trait"${tip(TRAITS[t].desc)}>${TRAITS[t].name}</span>`).join("")}</div>
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

export function newRunScreen(state, ui) {
  const people = state.survivors;
  return `<div class="box wide">
    <h1>Broken State — New run</h1>
    <div class="text small">Six years after the outbreak. Your survivors hold a town in the State of Calder. ${state.factions.length} other groups are out there, along with the hordes. Customize your starting colonists (name, skills, look) and choose your leader. The game starts paused: give your first orders, then press Space.</div>
    <div class="row" style="margin-bottom:0.8rem">
      <label${tip("The same seed always builds the same map. Your edited colonists are kept when you change it.")}>Seed <input type="number" min="1" step="1" style="width:7rem" data-action="seed" value="${state.seed}"></label>
      <label${tip("How many other survivor groups share the state (5–10)")}>AI groups <select data-action="factioncount">${[5, 6, 7, 8, 9, 10].map((v) => `<option ${v === ui.factionCount ? "selected" : ""}>${v}</option>`).join("")}</select></label>
      <button data-action="reroll"${tip("Generate a new map and new colonists")}>New map and colonists</button>
      <button data-action="nr-allcrew"${tip("Randomize every colonist's name, skills and look (skill totals stay the same)")}>🎲 Randomize all</button>
      <button data-action="zlook-open"${tip("Change how the dead look in battle")}>Zombie look…</button>
    </div>
    ${ui.nrMsg ? `<div class="small danger" style="margin-bottom:0.5rem">${esc(ui.nrMsg)}</div>` : ""}
    <div class="crew nrcrew">${people.map((s) => crewCard(state, ui, s)).join("")}</div>
    <div class="row" style="margin-top:1rem;justify-content:flex-end"><button class="primary" data-action="begin">Start</button></div>
  </div>`;
}

// Overrides to carry the edited crew into a rebuilt world (seed or group count changed).
export function crewSnapshot(state) {
  return state.survivors.map((s) => ({ name: s.name, skills: { ...s.skills }, traits: [...s.traits], budget: s.skillBudget ?? skillTotal(s.skills), appearance: s.appearance ? { ...s.appearance } : null, leader: !!s.leader }));
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
  "nr-allcrew": (state, ui) => { for (const s of state.survivors) reroll(state, ui, s, ["name", "skills", "look"]); },
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
