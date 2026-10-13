// The team panel's Daily use card (ui/needs.js teamUpkeep, teamUpkeepCard) and the road team's Needs list
// (ui/hardcore.js roadNeeds): food, water and meds the team has, uses a day and how long that lasts, from one sum.
// node tools/teamupkeeptest.js
import { createWorld } from "../src/sim/world.js";
import { roadTeam } from "../src/sim/hardcore-start.js";
import { partyMembers } from "../src/sim/parties.js";
import { teamUpkeep, teamUpkeepCard } from "../src/ui/needs.js";
import { roadNeeds } from "../src/ui/hardcore.js";
import { renderExpedition } from "../src/ui/expedition.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const st = createWorld({ seed: 42, factionCount: 7, mode: "hardcore" });
const p = roadTeam(st);
const n = partyMembers(st, p).length;
const u = teamUpkeep(st, p);
console.log(`  ${n} people: food ${u.food.have.toFixed(1)} −${u.food.perDay.toFixed(2)}/d ${u.food.days.toFixed(1)}d · water ${u.water.have.toFixed(1)} −${u.water.perDay.toFixed(2)}/d ${u.water.days.toFixed(1)}d · meds ${u.meds.have} −${u.meds.perDay}/d`);
check(u.people === n && n > 1, "the whole team counts");
check(u.food.perDay >= n * 0.99, `resting, each person eats a day of food a day (${u.food.perDay.toFixed(2)} for ${n})`);
check(Math.abs(u.food.days - u.food.have / u.food.perDay) < 1e-9 && Math.abs(u.water.days - u.water.have / u.water.perDay) < 1e-9, "lasts = has ÷ per day");
const card = text(teamUpkeepCard(st, p));
check(/Daily use/.test(card) && /Food/.test(card) && /Water/.test(card) && /Meds/.test(card) && /Per day/.test(card) && /Lasts/.test(card), "the card lists food, water and meds with per day and lasts");
check(text(renderExpedition(st, { xpQueue: false, expedition: p.id }, p)).includes("Daily use"), "the team panel shows the card");
const r = roadNeeds(st);
const f = r.rows.find((x) => x.k === "food");
check(f.name === "Food" && Number(f.amt) === Math.floor(u.food.have + 1e-9) && f.note === `${Math.round(u.food.days * 10) / 10}d`, `the Needs list's food row agrees with the card (${f.name} ${f.amt} ${f.note})`);
check(/a day/.test(f.tip), "its tip says what the team eats a day");
const w = r.rows.find((x) => x.k === "water");
check(w.name === "Water" && Number(w.amt) === Math.floor(u.water.have + 1e-9) && w.note === `${Math.round(u.water.days * 10) / 10}d`, `the water row too (${w.name} ${w.amt} ${w.note})`);

console.log(`\n${passes} passed, ${fails} failed`);
if (fails) { console.log("teamupkeeptest FAILED"); process.exit(1); }
