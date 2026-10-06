// Needs on screen (sim/needs.js): the Hunger, Thirst and Mood bars on the People tab, the roster, the team panel and
// the survivor screen; the team's ration and share settings; treats at hand with a Use button; the needs alerts.
// Actions are merged into main.js's dispatcher (NEEDS_ACTIONS).
import { survivorById, log } from "../sim/world.js";
import { NEEDS, RATIONS, SHARES, hungerOf, thirstOf, hungerWord, thirstWord, needsWork, needsAim, treatsFor, useTreat, teamFood, teamWater, needAlerts } from "../sim/needs.js";
import { useText } from "../sim/comforts.js";
import { GEAR } from "../sim/data.js";
import { partyMembers } from "../sim/parties.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;
const tone = (v) => (v < NEEDS.starving ? "var(--danger)" : v < NEEDS.lean ? "var(--accent)" : "var(--good)");

const HUNGER_TIP = `Hunger: falls ${NEEDS.food} a day (more on the move under a load and in the cold without a fire; slower below ${NEEDS.lean}: the body gets by on less). A ration fills ${NEEDS.food}. On a team people eat from its food when they drop below 70 (its ration setting); at a base the stores feed everyone. Below ${NEEDS.lean} work and aim suffer; empty away from a base it costs health.`;
const THIRST_TIP = `Thirst: falls ${NEEDS.water} a day (more in summer and a heat wave, on the move under a load). A water fills ${NEEDS.water}. Thirst runs out faster than hunger and hurts more: empty away from a base it costs a point of health an hour.`;

// One person's three gauges as rows (People tab, team panel, survivor screen).
export function gaugeRows(s, { mood = true, label = "3.5rem" } = {}) {
  const h = hungerOf(s), t = thirstOf(s);
  const row = (name, v, color, t2) => `<div class="row small"${tip(t2)}><span style="width:${label}" class="muted">${name}</span><div style="flex:1">${bar(v, color)}</div><span style="width:2.2rem;text-align:right">${n0(v)}</span></div>`;
  return row("Hunger", h, tone(h), `${hungerWord(h)} (${n0(h)}). ${HUNGER_TIP}`) + row("Thirst", t, tone(t), `${thirstWord(t)} (${n0(t)}). ${THIRST_TIP}`) +
    (mood ? row("Mood", s.mood, "var(--info)", "Mood: rest, a bed, food, a good leader, comforts and treats lift it; crowding, short rations, hunger, thirst and the cold lower it.") : "");
}
// Three thin bars in one cell (the roster table).
export function gaugeMini(s) {
  const h = hungerOf(s), t = thirstOf(s);
  const one = (v, color, label) => `<span class="ro-xp" style="display:block;width:3.2rem;margin:1px 0"${tip(`${label} ${n0(v)}`)}><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></span>`;
  return `<div${tip(`Hunger ${n0(h)} (${hungerWord(h)}) · Thirst ${n0(t)} (${thirstWord(t)}) · Mood ${n0(s.mood)}`)}>${one(h, tone(h), "Hunger")}${one(t, tone(t), "Thirst")}${one(s.mood, "var(--info)", "Mood")}</div>`;
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
    <div class="row" style="flex-wrap:wrap;margin-top:0.2rem"><span class="muted" style="width:4.5rem"${tip("Who eats and drinks first when there is not enough for everyone")}>When short</span>${pick("nd-share", share, Object.entries(SHARES))}</div>` : `<div class="muted">Rations: ${RATIONS[ration].name} · ${SHARES[share].name}</div>`}
    ${short.length ? short.map((x) => `<div class="${x.tone}">${esc(x.text)}</div>`).join("") : ""}
    ${p.noFood ? `<div class="danger">Out of food: nobody heals in camp.</div>` : ""}${p.noWater ? `<div class="danger">Out of water.</div>` : ""}
  </div>`;
}

export const NEEDS_ACTIONS = {
  "nd-ration": (state, ui, d) => { const p = state.parties.find((x) => x.id === Number(d.id)); if (p && RATIONS[d.v]) p.ration = d.v; },
  "nd-share": (state, ui, d) => { const p = state.parties.find((x) => x.id === Number(d.id)); if (p && SHARES[d.v]) p.share = d.v; },
  "nd-treat": (state, ui, d) => {
    const s = survivorById(state, Number(d.sid));
    const line = s ? useTreat(state, s, d.loc) : "";
    if (line) log(state, line, "info");
    ui.xpMsg = line || "They cannot reach that.";
  },
};
