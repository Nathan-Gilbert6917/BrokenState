// Food by type (sim/foods.js) on the screens: a base's Food section (every item with its icon, how many, the kcal, the
// days before the soonest lot spoils at today's storage, the room it sits in; the days of food it all comes to; the food
// rooms and what each does to the shelf life), the same for a team's packs and cargo, and the short lines for the top
// bar and the tooltips. There is no "Food" item: food is counted in days of food (2000 kcal a day) where a planner needs
// one number.
import { FOODS, FOOD_GROUPS, foodIn, foodSplit, lotRows, unitsOf, eggFood, DAY_KCAL } from "../sim/foods.js";
import { foodRows, foodStore, storeSpaces, kindWord, STORE, MEAL } from "../sim/storage.js";
import { carriedFactor } from "../sim/hunting.js";
import * as Weather from "../sim/weather.js";
import { count } from "../sim/buildings.js";
import { mealTag } from "./cooking.js"; // wave 2 cooking: a meal's tier and mood

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const n1 = (v) => (Math.round((v || 0) * 10) / 10).toString();
const qty = (q) => (q >= 10 || Math.abs(q - Math.round(q)) < 0.05 ? String(Math.round(q)) : n1(q));
const daysText = (d) => (!isFinite(d) ? "keeps" : d >= 365 ? `${Math.round(d / 365)}y` : d >= 60 ? `${Math.round(d / 30)}mo` : d < 1 ? "<1d" : `${n0(d)}d`);
const spoilCls = (d) => (d < 2 ? "danger" : d < 5 ? "warn" : "");

// An item's tooltip: what it is, its kcal and weight, how long it keeps at room temperature, its kind.
export function foodTip(k) {
  const f = FOODS[k];
  if (!f) return "";
  const keeps = f.shelf >= 365 ? `${Math.round(f.shelf / 365)} years` : `${f.shelf} days`;
  return `${f.name}: ${f.desc} ${f.kcal} kcal (${n1(f.kcal / DAY_KCAL)} of a day's food), ${f.kg} kg. Keeps about ${keeps} at room temperature${f.stable ? " (needs no cold room)" : "; a root cellar about triples that, a cold store in winter or a freezer much more"}. ${FOOD_GROUPS[f.group] ? FOOD_GROUPS[f.group].name : ""}${f.raw ? ": raw, wants cooking (a Kitchen's or a cook fire's bills make meals of it; eaten raw it can give food poisoning)" : ""}.`;
}

// The food rooms at a base, one row each: name, kind, held/room, today's shelf factor; outside; what keeps.
function roomsHtml(store) {
  const rows = store.spaces.map((s) => `<tr${tip(`${s.name}: ${s.cap} days of food of room (fresh food). Today its food uses ${n1(s.factor)} days of shelf life a day (${kindWord(s.kind)}).`)}><td>${esc(s.name)}</td><td class="muted small">${esc(kindWord(s.kind))}</td><td>${n0(s.held)}/${s.cap}</td><td class="small">×${n1(s.factor)}</td></tr>`);
  rows.push(`<tr class="${store.outside >= 1 ? "danger" : ""}"${tip("Fresh food above the rooms is stored outside (tarps, crates, the back of a truck): it spoils faster, more in heat and rain, much slower once it freezes.")}><td>Outside</td><td class="muted small">no room</td><td>${n0(store.outside)}</td><td class="small">×${n1(store.outFactor)}</td></tr>`);
  rows.push(`<tr${tip("Canned, dry, packaged and preserved food (and rations) needs no cold room: it keeps months to years wherever it sits.")}><td>Food that keeps</td><td class="muted small">dry store</td><td>${n0(store.stable)}</td><td class="small">×${n1(store.stableFactor)}</td></tr>`);
  return `<table class="t small"><tr><th>Room</th><th></th><th${tip("Days of food in it / its room")}>Held</th><th${tip("Shelf life used a day today (1 = room temperature)")}>Shelf</th></tr>${rows.join("")}</table>`;
}

// One item row: icon, name (eggs: a warning), how many, kcal in all, days until the soonest lot spoils, where.
function itemRow(r) {
  const egg = r.egg > 0 ? ` <span class="danger"${tip("Some of it carries the worm's eggs (grown, gathered or hunted on infected land): eaten last, and raw unless a cook fire or a kitchen cooks it.")}>eggs</span>` : "";
  return `<tr${tip(foodTip(r.key))}><td>${FOODS[r.key].icon} ${esc(r.name)}${egg}${mealTag(r.key)}</td><td>${qty(r.q)}</td><td class="small muted">${n1(r.units)}d · ${Math.round(r.kcal).toLocaleString("en-US")} kcal</td><td class="small ${spoilCls(r.days)}">${daysText(r.days)}</td><td class="small muted">${esc(r.where)}</td></tr>`;
}

// A base's Food section (the base screen's Stock, the Farming tab).
export function baseFoodHtml(state, b, { max = 40 } = {}) {
  const rows = foodRows(state, b);
  const store = foodStore(state, b);
  const split = foodSplit(b.stock);
  const soon = store.forecast.soon.filter((x) => x.q >= 0.5);
  const cooks = count(b, "cookhouse") || count(b, "canteen") || (b.tier === 0 && b.fire !== false);
  const list = rows.length ? `<table class="t small"><tr><th>Food</th><th>Qty</th><th${tip("Days of food it comes to (2000 kcal a day) and its calories")}>Days · kcal</th><th${tip("Days before the soonest lot of it spoils, where it sits today")}>Spoils</th><th>Where</th></tr>${rows.slice(0, max).map(itemRow).join("")}${rows.length > max ? `<tr><td colspan="5" class="muted">and ${rows.length - max} more kinds</td></tr>` : ""}</table>` : `<div class="muted small">No food in store.</div>`;
  const warn = soon.length ? `<div class="small warn" style="margin-top:0.3rem"${tip("What will spoil before it is eaten at today's rate (the soonest to spoil is eaten first). Spoiled food is thrown out.")}>Will spoil within the week: ${soon.slice(0, 5).map((x) => `${FOODS[x.key].icon} ${qty(x.q)} ${esc(FOODS[x.key].word)}`).join(", ")}</div>` : "";
  const spoiled = b.spoiledToday && b.spoiledToday.units >= 0.1 ? `<div class="small muted">Thrown out yesterday: ${n1(b.spoiledToday.units)} days of food.</div>` : "";
  const cook = `<div class="small muted">${cooks ? `The ${count(b, "canteen") ? "Kitchen" : count(b, "cookhouse") ? "cook fire" : "camp fire"} cooks by its bills (the Farming tab's Cooking: a simple meal is ${Math.round((MEAL.gain - 1) * 100)}% more filling than its makings).` : "No cook fire: raw meat and fish are eaten as they are (food poisoning), and food with the worm's eggs waits to the last."}</div>`;
  return `<div class="spread"><b${tip("Days of food in store: every kind together, at 2000 kcal a day")}>${n1(split.all)} days of food</b><span class="small muted">${n1(split.fresh)} fresh · ${n1(split.stable)} keeps</span></div>${list}${warn}${spoiled}${cook}<div style="margin-top:0.3rem">${roomsHtml(store)}</div>`;
}

// A team's food (its packs and what it found): item, how many, days of food, days before it spoils as carried today.
export function teamFoodHtml(state, p) {
  const t = Weather.weather ? Weather.weather(state).temp : 15;
  const fac = carriedFactor(t);
  const all = [];
  for (const [h, where] of [[p, "packed"], [p.cargo, "found"]]) {
    if (!h || !h.supplies) continue;
    for (const r of lotRows(h, state)) all.push({ ...r, where, days: r.next / fac, kcal: r.q * FOODS[r.key].kcal, name: FOODS[r.key].name });
  }
  if (!all.length) return `<div class="muted small">No food carried.</div>`;
  all.sort((a, b) => a.days - b.days);
  const e = eggFood(p.cargo || {});
  const days = foodIn(p.supplies) + foodIn(p.cargo && p.cargo.supplies);
  return `<div class="small"><b>${n1(days)} days of food</b> <span class="muted">(eaten the soonest to spoil first)</span>${e.all >= 0.1 ? ` <span class="danger">${n1(e.all)} days with the worm's eggs</span>` : ""}</div><table class="t small">${all.map(itemRow).join("")}</table>`;
}

// The top bar's food chip: days of food at the hub and its short tooltip.
// The food at a base in a sentence or three (the Needs list's Food row, the food chip): days of food, fresh and that
// keeps, the kinds there are most of, and (line: farming.js foodLine) the outlook.
export function foodTipText(state, b, line = null) {
  const split = foodSplit(b.stock);
  const rows = foodRows(state, b).slice(0, 8);
  const list = rows.map((r) => `${qty(r.q)} ${FOODS[r.key].word}`).join(", ");
  return `Food at ${b.name}: ${n1(split.all)} days of food (2000 kcal a day; ${n1(split.fresh)} fresh, ${n1(split.stable)} that keeps). Most of it: ${list || "nothing"}. Every food keeps its own time; the soonest to spoil is eaten first (the base window's Food section has every kind).${line ? ` ${line.tip}` : ""}`;
}
export function foodChip(state, b, line) {
  const split = foodSplit(b.stock);
  return `<span${tip(foodTipText(state, b, line))}><b>Food</b>${n0(split.all)}${line && line.short ? ` <span class="small ${line.cls}">${esc(line.short.split(" · ")[0])}</span>` : ""}</span>`;
}
// The rooms a base could have (the Help topic's numbers).
export const roomsHelp = () => `the hub's cellar ${STORE.hubCellar}, a root cellar +${STORE.rootCellar} (×0.35 shelf a day), an outpost's pantry ${STORE.pantry} and a storehouse +${STORE.storehouse} or crates +${STORE.crates} (room temperature, ×1), a cold store +${STORE.coldStore} (an ice house: ×0.15–0.9 by the season), a walk-in freezer +${STORE.freezer} (×0.05 while it runs); outside ×1.5 (more in heat and rain, ×0.2 once it freezes)`;
export { storeSpaces };
