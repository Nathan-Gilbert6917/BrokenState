// Needs on screen (sim/needs.js): the Hunger, Thirst and Mood bars on the People tab, the roster, the team panel and
// the survivor screen; the team's ration and share settings; treats at hand with a Use button; the needs alerts.
// Actions are merged into main.js's dispatcher (NEEDS_ACTIONS).
import { survivorById, log } from "../sim/world.js";
import { NEEDS, RATIONS, SHARES, hungerOf, thirstOf, hungerWord, thirstWord, needsWork, needsAim, treatsFor, useTreat, teamFood, teamWater, needAlerts, teamCold } from "../sim/needs.js";
import { useText } from "../sim/comforts.js";
import { GEAR } from "../sim/data.js";
import { partyMembers, partyPace, onTheMove, teamName } from "../sim/parties.js";
import { thirstAt } from "../sim/weather.js";
import { RAW_DRINK, rawDrinkOf, setRawDrink } from "../sim/rawdrink.js"; // un-purified water: Ask / Allow / Never
import { teamMeds, teamWants, conditionsOf, CONDITIONS } from "../sim/health.js";
import { tiredLevel, tiredText, TIRED, TIRED_WORDS } from "../sim/sleep.js";
import { eatTarget, EAT, PACK, packFood, packWater, packKg, thoughtsOf, setRationLevel } from "../sim/eating.js"; // meal breaks, carried rations, food thoughts
import { RATION_LEVELS, rationKey } from "../sim/meals.js"; // the ration levels per base
import { FOODS, foodText } from "../sim/foods.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;
const tone = (v) => (v < NEEDS.starving ? "var(--danger)" : v < NEEDS.lean ? "var(--accent)" : "var(--good)");

const HUNGER_TIP = `Hunger (how full they are): falls ${NEEDS.food} a day (more on the move under a load and in the cold without a fire; slower below ${NEEDS.lean}: the body gets by on less). A ration fills ${NEEDS.food}. They eat at the mealtimes and when hungry until they are ${EAT.band[0]}–${EAT.band[1]}% full (each their own target: the mark on the bar; the shaded band is ${EAT.band[0]}–${EAT.band[1]}); at a base from the stores, away from them from the pack they carry, on a team from its food when they drop below 70 (its ration setting). Below ${NEEDS.lean} work and aim suffer; empty away from a base it costs health.`;
const THIRST_TIP = `Thirst: falls ${NEEDS.water} a day, 1.5× as fast as hunger (more in summer and a heat wave, less in winter; more on the move under a load). A water fills ${NEEDS.water}. They drink when they drop below ${NEEDS.drink[0]} until they are full (the shaded band is ${NEEDS.drink[0]}–${NEEDS.drink[1]}): at a base from the stores (a base out of water: nobody drinks), away from them from the pack they carry, on a team from its water. Thirst runs out faster than hunger and hurts more: empty away from a base it costs a point of health an hour.`;

// One person's three gauges as rows (People tab, team panel, survivor screen).
export function gaugeRows(s, { mood = true, label = "3.5rem" } = {}) {
  const h = hungerOf(s), t = thirstOf(s);
  const row = (name, v, color, t2, b = bar(v, color), shown = n0(v)) => `<div class="row small"${tip(t2)}><span style="width:${label}" class="muted">${name}</span><div style="flex:1">${b}</div><span style="width:2.2rem;text-align:right">${shown}</span></div>`;
  const tg = eatTarget(s);
  return row("Hunger", h, tone(h), `${hungerWord(h)} (${n0(h)}; eats to ${tg}). ${HUNGER_TIP}`, bandBar(h, tone(h), EAT.band[0], EAT.band[1], tg)) + row("Thirst", t, tone(t), `${thirstWord(t)} (${n0(t)}; drinks below ${NEEDS.drink[0]}). ${THIRST_TIP}`, bandBar(t, tone(t), NEEDS.drink[0], NEEDS.drink[1], NEEDS.drink[1])) +
    sleepRow(s, row) + (mood ? row("Mood", s.mood, "var(--info)", "Mood: rest, a bed, food, a good leader, comforts and treats lift it; crowding, short rations, hunger, thirst and the cold lower it.") : "") + tiredRow(s);
}
// Sleep (sim/sleep.js s.tired, the hours of sleep owed, updated every hour): a bar full when rested, empty at
// Exhausted; the number is the hours owed. A normal day dips to about half by bedtime and is full again by morning.
export const sleepGauge = (s) => Math.max(0, Math.min(100, 100 - (100 * Math.max(0, (s && s.tired) || 0)) / TIRED.EXHAUSTED));
const sleepTone = (s) => { const lv = tiredLevel(s); return lv === 2 ? "var(--danger)" : lv === 1 ? "var(--accent)" : "var(--good)"; };
const sleepWord = (s) => { const t = Math.ceil(Math.max(0, (s && s.tired) || 0)); return `${TIRED_WORDS[tiredLevel(s)]}${t ? ` (owes ${t} h of sleep)` : " (no sleep owed)"}${s && s.sleepIn ? ", sleeping it off" : ""}`; };
function sleepRow(s, row) {
  const v = sleepGauge(s);
  return row("Sleep", v, sleepTone(s), `Sleep: ${sleepWord(s)}. ${TIRED_TIP}`, bar(v, sleepTone(s)), `${Math.ceil(Math.max(0, s.tired || 0))}h`);
}
// A bar with the eating band shaded (lo–hi) and a mark at their own target.
const bandBar = (v, color, lo, hi, mark) => `<div class="bar" style="position:relative"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i><span style="position:absolute;top:0;bottom:0;left:${lo}%;width:${hi - lo}%;background:rgba(127,127,127,0.18);pointer-events:none"></span><span style="position:absolute;top:-1px;bottom:-1px;left:${Math.max(0, Math.min(99.5, mark))}%;width:2px;background:var(--text,#ddd);opacity:0.7;pointer-events:none"></span></div>`;
// The food they carry, their last meal and the food thoughts running (survivor screen, team panel, inventory).
export function foodOnThem(state, s) {
  if (!s || !s.alive) return "";
  const f = packFood(s), w = packWater(s);
  const items = s.ration ? Object.fromEntries(Object.entries(s.ration.supplies || {}).filter(([k, q]) => FOODS[k] && q > 0)) : {};
  const r1 = (v) => Math.round(v * 10) / 10;
  const hh = (h) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:00`;
  const last = s.meal ? `Last ate ${state.hour - s.meal.h < 24 ? `at ${hh(s.meal.h)}` : `${Math.floor((state.hour - s.meal.h) / 24)} days ago`}${s.meal.k && FOODS[s.meal.k] ? `: ${esc(FOODS[s.meal.k].name.toLowerCase())}` : ""} (${s.meal.min} min${s.meal.from === "pack" ? ", from the pack" : s.meal.from === "kitchen" ? ", at the kitchen" : s.meal.from === "team" ? ", the team's food" : ""})` : "";
  const th = thoughtsOf(state, s).map((t) => `<span class="${t.v < 0 ? "warn" : "good"}"${tip(`${t.label}: mood ${t.v > 0 ? "+" : ""}${t.v} when it came; it cannot come again for ${Math.ceil(t.hoursLeft / 24 * 10) / 10} more days (sim/eating.js)`)}>${esc(t.label)} ${t.v > 0 ? "+" : ""}${t.v}</span>`).join(" · ");
  return `<div class="small"${tip(`Everyone carries a pack of about ${PACK.food} days of food that keeps and ${PACK.water} purified water (sim/eating.js): topped up from the stores each morning at a base, eaten away from the stores (a job trip, a field work, an errand; on a team after its shared food).`)}><span class="muted">Food on them:</span> ${f > 0.01 || w > 0.01 ? `${r1(f)} days of food${Object.keys(items).length ? ` (${esc(foodText(items, 2))})` : ""}, ${r1(w)} water · ${r1(packKg(s))} kg` : "nothing"}</div>${last ? `<div class="small muted">${last}</div>` : ""}${th ? `<div class="small">${th}</div>` : ""}`;
}
// Tired or Exhausted (sim/sleep.js): a line under the gauges, nothing when rested.
const TIRED_TIP = `Sleep owed: +${TIRED.AWAKE} an hour awake, −${TIRED.SLEEP} an hour asleep (a normal day peaks at 16). A watch in someone's sleep hours keeps them up; off a long one they sleep until rested. Tired from ${TIRED.TIRED}: aim ${TIRED.AIM[1]}, mood falls. Exhausted from ${TIRED.EXHAUSTED}: aim ${TIRED.AIM[2]}, counts half on guard and may doze off on watch.`;
export function tiredRow(s) {
  const lv = tiredLevel(s);
  return lv ? `<div class="${lv === 2 ? "danger" : "warn"} small"${tip(TIRED_TIP)}>${esc(tiredText(s))}</div>` : "";
}
export const tiredChip = (s) => { const lv = tiredLevel(s); return lv ? ` <span class="${lv === 2 ? "danger" : "warn"}"${tip(`${tiredText(s)}. ${TIRED_TIP}`)}>${TIRED_WORDS[lv]}</span>` : ""; };
// Three thin bars in one cell (the roster table).
export function gaugeMini(s) {
  const h = hungerOf(s), t = thirstOf(s);
  const one = (v, color, label) => `<span class="ro-xp" style="display:block;width:3.2rem;margin:1px 0"${tip(`${label} ${n0(v)}`)}><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></span>`;
  return `<div${tip(`Hunger ${n0(h)} (${hungerWord(h)}) · Thirst ${n0(t)} (${thirstWord(t)}) · Sleep: ${sleepWord(s)} · Mood ${n0(s.mood)}`)}>${one(h, tone(h), "Hunger")}${one(t, tone(t), "Thirst")}${one(sleepGauge(s), sleepTone(s), "Sleep")}${one(s.mood, "var(--info)", "Mood")}${tiredLevel(s) ? `<span class="${tiredLevel(s) === 2 ? "danger" : "warn"}" style="display:block;font-size:0.65rem;line-height:1">${TIRED_WORDS[tiredLevel(s)]}</span>` : ""}</div>`;
}
// What hunger and thirst do to someone now (a line, "" when nothing).
export function needsEffectText(s) {
  const w = needsWork(s), a = needsAim(s);
  if (w >= 0.999 && !a) return "";
  return `${hungerOf(s) < NEEDS.lean ? hungerWord(hungerOf(s)) : ""}${hungerOf(s) < NEEDS.lean && thirstOf(s) < NEEDS.lean ? " and " : ""}${thirstOf(s) < NEEDS.lean ? thirstWord(thirstOf(s)).toLowerCase() : ""}: work ×${w.toFixed(2)}${a ? `, aim ${a}` : ""}`;
}

// Treats this person can reach, with a Use button each (survivor screen, team panel).
export function treatsRow(state, s) {
  if (!s || !s.alive) return "";
  const list = treatsFor(state, s);
  if (!list.length) return "";
  const seen = new Set();
  const btns = list.filter((x) => !seen.has(x.key) && seen.add(x.key)).map((x) =>
    `<button class="mini" data-action="nd-treat" data-sid="${s.id}" data-loc="${esc(x.loc)}"${tip(`${s.name.split(" ")[0]} ${GEAR[x.key].useVerb || "uses"} the ${GEAR[x.key].name.toLowerCase()} (${x.whose === "own" ? "their own" : x.whose === "cargo" ? "from the cargo" : x.whose === "armory" ? "from the armory" : `${x.whose}'s`}): ${useText(x.key)}. Used up.${GEAR[x.key].valuable ? " Valuable in trade." : ""}`)}>${esc(GEAR[x.key].name)}</button>`).join("");
  return `<div class="row small" style="flex-wrap:wrap;margin-top:0.2rem"><span class="muted"${tip(`Treats lift a low mood. The team uses one by itself in the evening for anyone below 35 mood (the gentlest first; drink only at rest; valuables only below ${NEEDS.valuableMood}).`)}>Treats:</span>${btns}</div>`;
}

// What a team has of food, water and meds (its shared supplies and what it found, plus everyone's own pack), what it
// uses a day as it is now (sim/needs.js teamNeedsHour: each person's ration, more on the move under a load, food × the
// cold, water × today's thirst, the Rations setting; sim/health.js teamCare: a dose a day for each illness the team
// treats by itself) and the days that lasts. Food is in days of food (2000 kcal: one person's day).
const RATION_EAT = { full: 1, short: 0.6, none: 0 };
export function teamUpkeep(state, p) {
  const members = partyMembers(state, p).filter((s) => s.alive);
  const pace = partyPace(state, p);
  const moving = onTheMove(p);
  const eat = RATION_EAT[p.ration] ?? 1;
  const food = { have: teamFood(p) + members.reduce((a, s) => a + packFood(s), 0), perDay: (moving ? pace.foodMove : pace.foodRest) * teamCold(state, p) * eat };
  const water = { have: teamWater(p) + members.reduce((a, s) => a + packWater(s), 0), perDay: (moving ? pace.eatMove : members.length) * thirstAt(state) };
  let doses = 0;
  for (const s of members) for (const c of conditionsOf(s)) if (teamWants(c)) doses += CONDITIONS[c.key] ? CONDITIONS[c.key].meds : 1;
  const meds = { have: teamMeds(p), perDay: doses };
  for (const r of [food, water, meds]) r.days = r.perDay > 1e-9 ? r.have / r.perDay : Infinity;
  return { food, water, meds, people: members.length, moving };
}
// The team panel's card: food, water and meds, what it has, uses a day and how long that lasts.
export function teamUpkeepCard(state, p) {
  const u = teamUpkeep(state, p);
  if (!u.people) return "";
  const r1 = (v) => (Math.round(v * 10) / 10).toString();
  const lasts = (r, crit, low) => (r.days === Infinity ? `<span class="muted">${r.have > 0 ? "not used now" : "–"}</span>` : `<span class="${r.days < crit ? "danger" : r.days < low ? "warn" : "good"}">${r1(r.days)}d</span>`);
  const row = (name, r, unit, why, crit, low) => `<tr${tip(why)}><td>${name}</td><td>${r1(r.have)}${unit}</td><td>${r.perDay > 1e-9 ? `−${r1(r.perDay)}${unit}` : '<span class="muted">0</span>'}</td><td>${lasts(r, crit, low)}</td></tr>`;
  const how = u.moving ? "on the move (more under a load)" : "resting";
  return `<div class="card small"><b${tip("What the team carries (its supplies, what it found and everyone's own pack), what it uses a day as it is now, and how long that lasts.")}>Daily use</b>
    <table class="t" style="margin-top:0.25rem"><tr><th></th><th>Has</th><th>Per day</th><th>Lasts</th></tr>
      ${row("🥫 Food", u.food, "", `Days of food (2000 kcal: one person's day). ${u.people} ${u.people === 1 ? "person eats" : "people eat"} about ${r1(u.food.perDay)} a day ${how}${p.ration && p.ration !== "full" ? `, on ${RATIONS[p.ration] ? RATIONS[p.ration].name.toLowerCase() : p.ration} rations` : ""}${teamCold(state, p) > 1 ? ", more in the cold without a camp fire" : ""}.`, 1, 3)}
      ${row("💧 Water", u.water, "", `Water, purified and un-purified. ${u.people} ${u.people === 1 ? "person drinks" : "people drink"} about ${r1(u.water.perDay)} a day ${how} at today's thirst.`, 1, 2)}
      ${row("💊 Meds", u.meds, "", u.meds.perDay ? `A dose a day for each illness the team treats by itself (${u.meds.perDay} now).` : "Nobody on the team is being treated: no meds used a day.", 2, 4)}
    </table></div>`;
}

// The team's rations and who eats first, and who is short (team panel).
export function teamNeedsBlock(state, p, live) {
  const members = partyMembers(state, p);
  const ration = RATIONS[p.ration] ? p.ration : "full";
  const share = SHARES[p.share] ? p.share : "hurt";
  const pick = (action, cur, opts) => opts.map(([k, v]) => `<button class="mini ${cur === k ? "active" : ""}" data-action="${action}" data-id="${p.id}" data-v="${k}"${tip(v.desc)}>${esc(v.name)}</button>`).join("");
  const short = needAlerts(state, members);
  const food = teamFood(p), water = teamWater(p);
  return `<div class="card small"><div class="spread"><b${tip("Everyone eats and drinks from the team's supplies and what it found (fresh game first) when their hunger or thirst gauge gets low.")}>Eating</b><span class="muted">food ${n0(food)} · water ${n0(water)}</span></div>
    ${live ? `<div class="row" style="flex-wrap:wrap;margin-top:0.25rem"><span class="muted" style="width:4.5rem">Rations</span>${pick("nd-ration", ration, Object.entries(RATIONS))}</div>
    <div class="row" style="flex-wrap:wrap;margin-top:0.2rem"><span class="muted" style="width:4.5rem"${tip("Who eats and drinks first when there is not enough for everyone")}>When short</span>${pick("nd-share", share, Object.entries(SHARES))}</div>
    <div class="row" style="flex-wrap:wrap;margin-top:0.2rem"><span class="muted" style="width:4.5rem"${tip(RAW_TIP)}>Un-purified</span>${pick("nd-raw-team", rawDrinkOf(p), Object.entries(RAW_DRINK))}</div>` : `<div class="muted">Rations: ${RATIONS[ration].name} · ${SHARES[share].name} · Un-purified water: ${RAW_DRINK[rawDrinkOf(p)].name}</div>`}
    ${short.length ? short.map((x) => `<div class="${x.tone}">${esc(x.text)}</div>`).join("") : ""}
    ${p.noFood ? `<div class="danger">Out of food: nobody heals in camp.</div>` : ""}${p.noWater ? `<div class="danger">Out of water.</div>` : ""}
  </div>`;
}

// A base's ration level (sim/meals.js RATION_LEVELS, sim/eating.js): Normal / Lean / Feast today, for the Overview's
// Status (a kv row pair). The automatic short rations show instead while they hold.
export function rationRow(state, b) {
  const key = rationKey(state, b);
  const btn = (k) => `<button class="mini ${key === k || (k !== "feast" && key !== "feast" && key !== "short" && (b.rationLevel || "normal") === k) ? "active" : ""}" data-action="nd-ration-level" data-base="${b.id}" data-v="${k}"${tip(RATION_LEVELS[k].desc)}>${k === "feast" ? "Feast today" : RATION_LEVELS[k].name}</button>`;
  const note = key === "short" ? `<span class="danger"${tip("Under a week of food: everyone eats to 48 and the body gets by on 60% of a ration (mood −3 a day) until the stores are back over a week. Comes first, whatever the setting.")}>Short rations</span> ` : key === "feast" ? `<span class="good">Feast day</span> ` : "";
  return `<div${tip("How much everyone here eats (sim/eating.js): Normal, Lean (smaller portions: food lasts a quarter longer, mood −1 a day) or a Feast today (everyone eats their fill and half as much again; mood +6). The governor and a steward with Farming & food set it by themselves.")}>Rations</div><div>${note}${["normal", "lean", "feast"].map(btn).join("")}</div>`;
}

// Un-purified water (sim/rawdrink.js): a base's rule, for the Overview's Status (a kv row pair).
const RAW_TIP = "Un-purified water (from a well, rain or a river): may they drink it as it is when the purified water is gone? Ask (a card the first time), Allow, or Never (purified water only: they go thirsty). A team with a water filter, at a camp fire or with purification tablets makes it safe as it drinks, whatever this says.";
export function rawDrinkRow(state, b) {
  const cur = rawDrinkOf(b);
  const btn = (k) => `<button class="mini ${cur === k ? "active" : ""}" data-action="nd-raw-base" data-base="${b.id}" data-v="${k}"${tip(RAW_DRINK[k].desc)}>${RAW_DRINK[k].name}</button>`;
  return `<div${tip(RAW_TIP)}>Un-purified water</div><div>${Object.keys(RAW_DRINK).map(btn).join("")}</div>`;
}

export const NEEDS_ACTIONS = {
  "nd-raw-base": (state, ui, d) => { const b = state.bases.find((x) => x.id === Number(d.base)); const line = b ? setRawDrink(state, b, d.v, b.name) : ""; if (line) log(state, line, "info"); },
  "nd-raw-team": (state, ui, d) => { const p = state.parties.find((x) => x.id === Number(d.id)); const line = p ? setRawDrink(state, p, d.v, teamName(state, p)) : ""; if (line) log(state, line, "info"); },
  "nd-ration-level": (state, ui, d) => { const b = state.bases.find((x) => x.id === Number(d.base)); const line = b ? setRationLevel(state, b, d.v) : ""; if (line) log(state, line, "info"); },
  "nd-ration": (state, ui, d) => { const p = state.parties.find((x) => x.id === Number(d.id)); if (p && RATIONS[d.v]) p.ration = d.v; },
  "nd-share": (state, ui, d) => { const p = state.parties.find((x) => x.id === Number(d.id)); if (p && SHARES[d.v]) p.share = d.v; },
  "nd-treat": (state, ui, d) => {
    const s = survivorById(state, Number(d.sid));
    const line = s ? useTreat(state, s, d.loc) : "";
    if (line) log(state, line, "info");
    ui.xpMsg = line || "They cannot reach that.";
  },
};
