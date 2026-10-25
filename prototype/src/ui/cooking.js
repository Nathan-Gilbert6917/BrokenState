// Cooking (sim/cooking.js, wave 2 cooking) on the screens: the Farming tab's Cooking section (every station's bills:
// add, reorder, pause, Do N times / until you have N / forever, the ingredient filter, the dirt and Clean first, what
// was cooked yesterday), the short lines under the Kitchen's and the cook fire's cards, the recipe tooltips (ingredients,
// purified water, work-hours, Cooking, cookbooks, machine) and the Help topic. Actions merge into main.js's dispatcher
// (COOK_ACTIONS on click, checkboxes included; COOK_CHANGE on change).
import { baseById, survivorById } from "../sim/world.js";
import { FOODS, foodWord, foodText } from "../sim/foods.js";
import { GEAR } from "../sim/data.js";
import {
  COOK, POISON, COOK_RECIPES, RECIPE_KEYS, CLASSES, NEEDS_NAME, STATIONS, stationName, stationsAt, stationState, stationWhy,
  ensureStations, addBill, removeBill, moveBill, setBill, setStationClean, billTarget, billHave, billDone, modeText,
  recipeSkillOk, madeAt, booksFor, recipeText, machineAt, skillPz, poisonChance, crewOf, cookingHelp,
} from "../sim/cooking.js";
import { rangeStatus, ovenBoost, ovenAt, microwaveOn, OVEN, MICROWAVE } from "../sim/appliances.js"; // the kitchen range, the oven, the microwave (#19)
import { isKnown } from "../sim/blueprints.js";
import { pbar, badge, sectionHead, infoTip } from "./uikit.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const r1 = (v) => Math.round((v || 0) * 10) / 10;
const pct = (v) => `${Math.round((v || 0) * 1000) / 10}%`;
const first = (s) => s.name.split(" ")[0];
const open = new Set(); // bills whose ingredient filter is shown (this session only)

// A recipe's tooltip: what it takes and makes, its water, time, Cooking, books and machine.
export function recipeTip(state, key) {
  const R = COOK_RECIPES[key];
  const books = booksFor(key).map((b) => `${GEAR[b.id] ? GEAR[b.id].name : b.id} (Cooking ${b.min}${isKnown(state, b.id) ? ", read" : ""})`);
  return `${R.name}: ${R.desc} ${recipeText(R)}. ${r1(R.hours)} work-hours a batch at Cooking 10 (slower below, faster above). Cooking ${R.skill}${books.length ? `; cookbooks: ${books.join(", ")}` : ""}.${R.needs ? ` Needs ${NEEDS_NAME[R.needs]}.` : ""} ${FOODS[R.out].name}: ${FOODS[R.out].kcal} kcal, keeps ${FOODS[R.out].shelf} days at room temperature${FOODS[R.out].moodLift ? `, +${FOODS[R.out].moodLift} mood` : ""}.`;
}

// One bill row.
function billRow(state, b, key, x, i, n) {
  const R = COOK_RECIPES[x.recipe];
  if (!R) return "";
  const data = `data-base="${b.id}" data-st="${key}" data-id="${x.id}"`;
  const sk = recipeSkillOk(state, b, key, x.recipe);
  const modeSel = `<select data-action="ck-mode" ${data}${tip("Do N times: N batches, then it stops. Do until you have N: keeps N of it in store (cooks more when it is eaten). Do forever: while there are ingredients and time.")}>${[["count", "Do N times"], ["until", "Until you have"], ["forever", "Forever"]].map(([k, l]) => `<option value="${k}" ${k === x.mode ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const nIn = x.mode === "forever" ? "" : `<input type="number" min="0" max="9999" step="1" class="po-n" data-action="ck-n" ${data} value="${x.mode === "until" ? billTarget(state, b, x) : x.n}"${tip(x.mode === "until" ? `Keep this many ${FOODS[R.out].word}${x.auto ? ` (now: ${COOK.autoDays} days of eating for everyone here; type a number to fix it)` : ""}` : "Batches to make")}>`;
  const have = x.mode === "until" ? ` <span class="muted"${tip("In store now")}>have ${Math.floor(billHave(b, x))}</span>` : x.mode === "count" ? ` <span class="muted">${x.done || 0} done</span>` : "";
  const who = x.by === "ai" ? ` <span class="chip"${tip("Set by this base's steward (or the governor). Change it and it becomes yours.")}>steward</span>` : "";
  const btn = (act, label, t, dis = false) => `<button class="mini" data-action="${act}" ${data}${dis ? " disabled" : ""}${tip(t)}>${label}</button>`;
  const why = x.paused ? `<span class="muted">paused</span>` : billDone(x) ? `<span class="good">done</span>` : x.why ? `<span class="${/^(done|enough)/.test(x.why) ? "muted" : "warn"}">${esc(x.why)}</span>` : "";
  const skill = sk.ok ? "" : ` <span class="warn"${tip(`The best ${key === "canteen" ? "cook here" : "hand here"} has Cooking ${Math.max(0, sk.best)}${sk.book ? ` (a cookbook lowers it to ${sk.min})` : ""}`)}>Cooking ${sk.min}</span>`;
  const flt = open.has(x.id) ? filterPanel(state, b, key, x) : "";
  return `<div class="ck-bill${x.paused ? " muted" : ""}" style="border-top:1px solid var(--line, #3335);padding:0.25rem 0">
    <div class="spread"><span>${btn("ck-up", "▲", "Higher priority", i === 0)}${btn("ck-down", "▼", "Lower priority", i === n - 1)} <b${tip(recipeTip(state, x.recipe))}>${FOODS[R.out].icon} ${esc(R.name)}</b>${skill}${who}</span>
    <span class="row">${btn("ck-flt", open.has(x.id) ? "Ingredients ▴" : "Ingredients ▾", "The ingredient filter: fresh only, human meat, what spoils first, items left out")}${btn("ck-pause", x.paused ? "Resume" : "Pause", x.paused ? "Cook it again" : "Leave it for now")}${x.mode === "count" && billDone(x) ? btn("ck-again", "Again", "Do it N times again") : ""}${btn("ck-del", "✕", "Remove the bill")}</span></div>
    <div class="row prodctl">${modeSel}${nIn}${have}${why ? ` · ${why}` : ""}</div>
    <div class="small muted"${tip(recipeTip(state, x.recipe))}>${esc(recipeText(R))} · ${r1(R.hours)}h${R.needs ? ` · ${esc(NEEDS_NAME[R.needs])}` : ""}</div>${flt}
  </div>`;
}
// The ingredient filter of a bill: fresh only, human meat, order, and every item its recipe could take (unticked: left out).
function filterPanel(state, b, key, x) {
  const R = COOK_RECIPES[x.recipe];
  const data = `data-base="${b.id}" data-st="${key}" data-id="${x.id}"`;
  const items = Object.keys(FOODS).filter((k) => R.in.some((inp) => CLASSES[inp.cls].test(k, FOODS[k], { fresh: !!x.flt.fresh, human: true }))); // with Fresh only, the fresh ones
  const boxes = items.map((k) => `<label style="white-space:nowrap;margin-right:0.5rem"${tip(`${FOODS[k].name}: ${Math.floor(b.stock[k] || 0)} in store`)}><input type="checkbox" data-action="ck-no" ${data} data-key="${k}" ${(x.flt.no || []).includes(k) ? "" : "checked"}> ${FOODS[k].icon} ${esc(FOODS[k].name)}</label>`).join(" ");
  return `<div class="card small" style="margin:0.2rem 0">
    <label${tip("Only fresh ingredients (raw meat and fish, eggs and milk, produce, crops and forage). Off: also rice, pasta, oats, dry beans, nuts, jerky, cheese, canned meat and vegetables (food that keeps).")}><input type="checkbox" data-action="ck-fresh" ${data} ${x.flt.fresh ? "checked" : ""}> Fresh only</label>
    <label style="margin-left:0.6rem"${tip("Meat from people. Nobody here would, and nothing makes it yet.")}><input type="checkbox" data-action="ck-human" ${data} ${x.flt.human ? "checked" : ""}> Human meat</label>
    <select data-action="ck-order" ${data} style="margin-left:0.6rem"${tip("Which ingredients go in first")}><option value="spoil" ${x.flt.order !== "cheap" ? "selected" : ""}>What spoils first</option><option value="cheap" ${x.flt.order === "cheap" ? "selected" : ""}>The cheapest first</option></select>
    <div style="margin-top:0.2rem">${boxes}</div>
  </div>`;
}
// The dirt bar and Clean first.
function dirtBar(b, key) {
  const S = stationState(b, key);
  const d = Math.round(S.dirt || 0);
  const tone = d >= 60 ? "bad" : d >= 30 ? "warn" : "good";
  const t = `Every hour of cooking dirties it (+${COOK.dirt.perHour}). With Clean first on, the cooks scrub it before they cook (up to ${Math.round(COOK.dirt.share * 100)}% of their day) once it is at ${COOK.dirt.cleanAt}+. Dirt makes food poisoning more likely: ×${r1(1 + POISON.dirt * d / 100)} now (×${1 + POISON.dirt} at 100).`;
  return `<div class="row" style="gap:0.5rem;align-items:center"><div style="flex:1">${pbar(d, tone, "Dirt", `${d}/100`, null, t)}</div><label${tip("Clean before cooking each day (costs the cooks some of their hours). Off: more meals, more food poisoning.")}><input type="checkbox" data-action="ck-clean" data-base="${b.id}" data-st="${key}" ${S.clean !== false ? "checked" : ""}> Clean first</label></div>`;
}
// What a station did on its last day: "Yesterday: 6 batches (24 simple meals) · 8.2 h cooking, 1.1 h cleaning".
function stationDay(state, b, key) {
  const rec = b.cookDay && b.cookDay.st && b.cookDay.st[key];
  if (!rec) return "";
  if (!rec.batches && rec.why) return `<div class="small warn">Last night: ${esc(rec.why)}</div>`;
  if (!rec.batches && !rec.hours) return "";
  const cooks = (rec.cooks || []).map((id) => survivorById(state, id)).filter(Boolean).map(first);
  return `<div class="small muted">Last night: ${rec.batches} batch${rec.batches === 1 ? "" : "es"}${cooks.length ? ` by ${esc(cooks.join(", "))}` : ""} · ${r1(rec.hours)}h cooking${rec.clean > 0.05 ? `, ${r1(rec.clean)}h cleaning` : ""}</div>`;
}
// The crew line: who cooks here and their Cooking, the food-poisoning odds of their meals today.
function crewLine(state, b, key) {
  const why = stationWhy(state, b, key);
  if (why) return `<div class="small warn">${esc(why)}: nothing cooks here today.</div>`;
  const crew = crewOf(state, b, key); // the Kitchen's cooks, the range's (sim/cooking.js rangeCrew, #19), the fire's tender
  if (!crew.length) return `<div class="small warn">${key === "canteen" ? "No cook on duty: put someone on Cook (the Work tab)." : key === "range" ? "Nobody free to cook at the range (the Kitchen's cooks are busy there)." : "Nobody home to tend the fire."}</div>`;
  const fuel = key === "range" ? ` · ${esc(rangeStatus(state, b).reason)}${ovenBoost(state, b) > 1 ? ` · the oven beside it ×${OVEN.boost}` : ovenAt(b) ? " · an oven here: it bakes" : ""}` : "";
  const S = stationState(b, key);
  const best = crew[0];
  return `<div class="small"${tip(`Food poisoning a day of food of their meals: ${pct(skillPz(best.lvl))} at Cooking ${best.lvl}, ×${r1(1 + POISON.dirt * (S.dirt || 0) / 100)} for the dirt now. RimWorld's curve: ${pct(skillPz(0))} at Cooking 0, ${pct(skillPz(5))} at 5, ${pct(skillPz(10))} at 10, ${pct(skillPz(20))} at 20.`)}>${key === "canteen" ? "Cooks" : "Tending it"}: ${crew.map((c) => `${esc(first(c.s))} (Cooking ${c.lvl}, ${r1(c.hours)}h)`).join(", ")} · meals ${pct(poisonChance(best.lvl, S.dirt || 0))} food poisoning${fuel}${microwaveOn(b) ? ` · the microwave ×${MICROWAVE.boost} on the meals` : ""}</div>`;
}
// The add-a-bill select: every recipe made at this station (locked ones say why).
function addSelect(state, b, key) {
  const opts = RECIPE_KEYS.filter((k) => !COOK_RECIPES[k].team && madeAt(state, b, key, k)).map((k) => {
    const R = COOK_RECIPES[k];
    const sk = recipeSkillOk(state, b, key, k);
    const lack = [R.needs && !machineAt(state, b, R.needs) ? `needs ${NEEDS_NAME[R.needs]}` : "", sk.ok ? "" : `Cooking ${sk.min}`].filter(Boolean).join(", ");
    return `<option value="${k}">${esc(R.name)}${lack ? ` (${esc(lack)})` : ""}</option>`;
  }).join("");
  return `<select data-action="ck-add" data-base="${b.id}" data-st="${key}"${tip("Add a bill: what to cook here (the list is the order the cooks work it)")}><option value="">Add a bill…</option>${opts}</select>`;
}
// One station's card.
export function stationCard(state, b, key) {
  const S = stationState(b, key);
  const list = S.bills.map((x, i) => billRow(state, b, key, x, i, S.bills.length)).join("");
  const name = stationName(b, key);
  return `<div class="card small" style="margin-bottom:0.4rem">
    <div class="spread"><b>${STATIONS[key].icon} ${esc(name)}</b><span class="muted">${S.bills.length ? `${S.bills.length} bill${S.bills.length === 1 ? "" : "s"}` : "no bills"}</span></div>
    ${crewLine(state, b, key)}${dirtBar(b, key)}${stationDay(state, b, key)}
    ${list || `<div class="muted">No bills: nothing is cooked here. Add one below.</div>`}
    <div class="row" style="margin-top:0.3rem">${addSelect(state, b, key)}</div>
  </div>`;
}
// The Farming tab's Cooking section (every station at the base), or "" with none.
export function cookingCard(state, b) {
  const keys = stationsAt(b, state); // a camp cook pot at a base with no Kitchen or cook fire is a Camp fire (cooking.js)
  if (!keys.length) return "";
  ensureStations(state, b);
  return `${sectionHead(`Cooking${infoTip("Bills, as in RimWorld: each station cooks its list from the top. Meals are more filling than their makings, take purified water, and spoil in days. Help: Cooking and meals.")}`)}${keys.map((k) => stationCard(state, b, k)).join("")}`;
}
// Under the Kitchen's and the cook fire's building cards: the bills in a line and last night's cooking.
export function cookingNote(state, b, key) {
  const S = stationState(b, key);
  const names = S.bills.filter((x) => !x.paused).map((x) => COOK_RECIPES[x.recipe] ? COOK_RECIPES[x.recipe].name : x.recipe);
  const rec = b.cookDay && b.cookDay.st && b.cookDay.st[key];
  const made = rec && rec.batches && b.cookDay.made ? ` · last night ${rec.batches} batch${rec.batches === 1 ? "" : "es"}` : "";
  return `<div class="small muted"${tip("Bills: the Farming tab's Cooking section (add, reorder, pause, the ingredient filter).")}>Bills: ${names.length ? esc(names.join(", ")) : "none"}${made} · dirt ${Math.round(S.dirt || 0)}</div>`;
}
// A meal's tier and mood for the food list (ui/food.js).
export function mealTag(k) {
  const f = FOODS[k];
  if (!f || f.group !== "meal" && k !== "f_survivalmeal") return "";
  return ` <span class="muted small"${tip(`Quality: ${f.tier}${f.moodLift ? `; +${f.moodLift} mood eaten` : ""}`)}>${f.tier}${f.moodLift ? ` · 🙂+${f.moodLift}` : ""}</span>`;
}

// ---------- actions ----------
const baseOf = (state, d) => baseById(state, Number(d.base));
const say = (ui, msg) => { if (msg) ui.baseMsg = msg; };
export const COOK_ACTIONS = {
  "ck-up": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, moveBill(state, b, d.st, d.id, -1)); },
  "ck-down": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, moveBill(state, b, d.st, d.id, 1)); },
  "ck-del": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, removeBill(state, b, d.st, d.id)); },
  "ck-pause": (state, ui, d) => { const b = baseOf(state, d); const x = b && stationState(b, d.st).bills.find((y) => y.id === Number(d.id)); if (x) say(ui, setBill(state, b, d.st, x.id, { paused: !x.paused })); },
  "ck-again": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, setBill(state, b, d.st, d.id, { again: true })); },
  "ck-flt": (state, ui, d) => { const id = Number(d.id); if (open.has(id)) open.delete(id); else open.add(id); },
  "ck-clean": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, setStationClean(b, d.st, stationState(b, d.st).clean === false)); },
  "ck-fresh": (state, ui, d) => { const b = baseOf(state, d); const x = b && stationState(b, d.st).bills.find((y) => y.id === Number(d.id)); if (x) say(ui, setBill(state, b, d.st, x.id, { fresh: !x.flt.fresh })); },
  "ck-human": (state, ui, d) => { const b = baseOf(state, d); const x = b && stationState(b, d.st).bills.find((y) => y.id === Number(d.id)); if (x) say(ui, setBill(state, b, d.st, x.id, { human: !x.flt.human })); },
  "ck-no": (state, ui, d) => { const b = baseOf(state, d); if (b) say(ui, setBill(state, b, d.st, d.id, { toggle: d.key })); },
};
export const COOK_CHANGE = {
  "ck-mode": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) say(ui, setBill(state, b, el.dataset.st, el.dataset.id, { mode: el.value })); },
  "ck-n": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) say(ui, setBill(state, b, el.dataset.st, el.dataset.id, { n: el.value })); },
  "ck-order": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b) say(ui, setBill(state, b, el.dataset.st, el.dataset.id, { order: el.value })); },
  "ck-add": (state, ui, el) => { const b = baseOf(state, el.dataset); if (b && el.value) say(ui, addBill(state, b, el.dataset.st, el.value)); },
};
export { cookingHelp };
