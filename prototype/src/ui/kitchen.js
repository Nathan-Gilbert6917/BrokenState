// The Kitchen (sim/kitchen.js) in the base screen: its card on the Buildings tab and under its entry in Construction:
// the cooks on duty (and how many it wants), today's hot meals and the food they saved yesterday, the mood and the
// water boiled for the meals, and the stove's firewood (a cold stove: cold meals).
import { KITCHEN, kitchenService, kitchenWood, kitchenCanLight, cookPlusOf } from "../sim/kitchen.js";
import { ROLES } from "../sim/economy.js";
import { day } from "../sim/world.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => s.name.split(" ")[0];
const r1 = (v) => Math.round((v || 0) * 10) / 10;
const n0 = (v) => Math.round(v || 0);
const pct = (v) => `${r1((v || 0) * 100)}%`;

// The kitchen's lines: "Cooks: Ana (+ Farm), Ben (2 of 2 wanted)", "Hot meals today: 28 (14 of 14 fed)", "Firewood: 32 a
// day (stove 4 + meals 28) · 410 in store", "Food saved: 1.4 yesterday".
export function kitchenNote(state, b) {
  const ks = kitchenService(state, b);
  if (!ks.built) return "";
  const rec = b.kitchenDay && b.kitchenDay.day >= day(state) - 1 ? b.kitchenDay : null;
  const short = ks.count < ks.wanted; // the day's main cooks (sim/kitchen.js: a cook who handed over mid-day is not a second one)
  const who = (s) => { const k = cookPlusOf(state, s); return `${esc(first(s))}${k && ROLES[k] ? ` (+ ${esc(ROLES[k].name)})` : ""}`; };
  const cooks = ks.cooks.length
    ? `<span class="${short ? "warn" : "good"}"${tip("A cook on Cook + a second job (or on work priorities) cooks in the cooking hours (05:00–06:00, 16:00–20:00) and does the other job the rest of the day; plain Cook is the kitchen all day.")}>Cooks: ${ks.main.map(who).join(", ")}${ks.cooks.length > ks.main.length ? ` (with ${ks.cooks.filter((s) => !ks.main.includes(s)).map((s) => esc(first(s))).join(", ")} for some of the hours)` : ""} (${ks.count} of ${ks.wanted} wanted)</span>`
    : `<span class="warn">No cook: put someone on Cook (${ks.wanted} wanted, one per ${KITCHEN.perCook} people). Until then the food is eaten as before.</span>`;
  const meals = ks.cold
    ? `<span class="danger"${tip("The stove had no firewood to spare at midnight (after the water boiler's and the heating's day): cold meals, nothing saved, no mood, no water boiled, and the game and greens from infected land wait for a cook fire. It is lit again at midnight once the firewood is in.")}>Cold meals today: no firewood for the stove</span>`
    : ks.cooks.length
      ? `<span${tip("Breakfast at 06:00 (the hunters and fishers at 10:00) and dinner at 20:00 at the kitchen. With too few cooks only that share of the people get hot meals.")}>Hot meals today: ${ks.served * 2} (${ks.served} of ${ks.fed} fed)</span> · −${pct(ks.save)} food a day · +${r1(ks.mood)} mood${ks.boil > 0 ? ` · ${Math.round(ks.boil * 100)}% of the drinking water boiled for the meals` : ""}`
      : "";
  const w = kitchenWood(state, b);
  const have = Math.max(0, b.stock.wood || 0);
  const can = kitchenCanLight(state, b);
  const wood = `<span class="${can ? "muted" : "warn"}"${tip(`The stove burns ${KITCHEN.wood.stove} firewood a day (lit for the worm whether anyone cooks or not) and ${KITCHEN.wood.meal} a meal served (two a day for everyone fed)${w.low ? ", a third less with a Low Flame cook" : ""}, at midnight, from what is left after the water boiler's and the heating's day. It counts in the firewood forecast (Upkeep, the needs bar): ${KITCHEN.wood.keepDays} days of it are wanted in store.`)}>Firewood: ${r1(w.need)} a day (stove ${w.stove} + meals ${r1(w.meals)}) · ${n0(have)} in store${can ? "" : " · not enough to light it after the boiler and the heating"}</span>`;
  const saved = rec && rec.saved > 0 ? `<span class="good"${tip("What the people fed at the kitchen did not eat thanks to the hot meals, on the last day counted (it comes off the day's eating at midnight).")}>Food saved: ${r1(rec.saved)} ${rec.day === day(state) ? "today" : "yesterday"}</span>` : "";
  const skillTxt = ks.cooks.length ? `<span class="muted"${tip(`The best cook's Cooking sets how far the food stretches: −${KITCHEN.save * 100}% up to Cooking ${KITCHEN.skillFrom}, +0.5% a point above (−${KITCHEN.saveMax * 100}% at most, and the Cooking perks add to it); Cooking ${KITCHEN.moodSkillAt}+ lifts the mood to +${KITCHEN.moodSkilled}. Cooks learn Cooking at the stove.`)}>Best cook: Cooking ${ks.skill}</span>` : "";
  return `<div class="small kitchen-note" style="margin-top:0.3rem">${[cooks, meals, wood, [saved, skillTxt].filter(Boolean).join(" · ")].filter(Boolean).map((x) => `<div>${x}</div>`).join("")}</div>`;
}
