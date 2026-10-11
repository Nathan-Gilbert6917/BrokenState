// The Kitchen (sim/kitchen.js) in the base screen: its card on the Buildings tab and under its entry in Construction:
// the cooks on duty (and how many it wants), today's hot meals and the food they saved yesterday, the mood and the
// water boiled for the meals.
import { KITCHEN, kitchenService } from "../sim/kitchen.js";
import { day } from "../sim/world.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => s.name.split(" ")[0];
const r1 = (v) => Math.round((v || 0) * 10) / 10;
const pct = (v) => `${r1((v || 0) * 100)}%`;

// The kitchen's lines: "Cooks: Ana, Ben (2 of 2 wanted)", "Hot meals today: 28 (14 of 14 fed)", "Food saved: 1.4 yesterday".
export function kitchenNote(state, b) {
  const ks = kitchenService(state, b);
  if (!ks.built) return "";
  const rec = b.kitchenDay && b.kitchenDay.day >= day(state) - 1 ? b.kitchenDay : null;
  const short = ks.cooks.length < ks.wanted;
  const cooks = ks.cooks.length
    ? `<span class="${short ? "warn" : "good"}">Cooks: ${ks.cooks.map((s) => esc(first(s))).join(", ")} (${ks.cooks.length} of ${ks.wanted} wanted)</span>`
    : `<span class="warn">No cook: put someone on Cook (${ks.wanted} wanted, one per ${KITCHEN.perCook} people). Until then the food is eaten as before.</span>`;
  const meals = ks.cooks.length
    ? `<span${tip("Breakfast at 06:00 (the hunters and fishers at 08:00) and dinner at 20:00 at the kitchen. With too few cooks only that share of the people get hot meals.")}>Hot meals today: ${ks.served * 2} (${ks.served} of ${ks.fed} fed)</span> · −${pct(ks.save)} food a day · +${r1(ks.mood)} mood${ks.boil > 0 ? ` · ${Math.round(ks.boil * 100)}% of the drinking water boiled for the meals` : ""}`
    : "";
  const saved = rec && rec.saved > 0 ? `<span class="good"${tip("What the people fed at the kitchen did not eat thanks to the hot meals, on the last day counted (it comes off the day's eating at midnight).")}>Food saved: ${r1(rec.saved)} ${rec.day === day(state) ? "today" : "yesterday"}</span>` : "";
  const skillTxt = ks.cooks.length ? `<span class="muted"${tip(`The best cook's Farming sets how far the food stretches: −${KITCHEN.save * 100}% up to Farming ${KITCHEN.skillFrom}, +0.5% a point above (−${KITCHEN.saveMax * 100}% at most); Farming ${KITCHEN.moodSkillAt}+ lifts the mood to +${KITCHEN.moodSkilled}.`)}>Best cook: Farming ${ks.skill}</span>` : "";
  return `<div class="small kitchen-note" style="margin-top:0.3rem">${[cooks, meals, [saved, skillTxt].filter(Boolean).join(" · ")].filter(Boolean).map((x) => `<div>${x}</div>`).join("")}</div>`;
}
