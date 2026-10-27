// Status icons: the small stacking icons next to a survivor's name wherever people are listed (the roster, the People
// tab, the survivor screen, a team's members, a base's people, the Medical tab, the work grid, the battle roster). One
// per state that is on now, in a fixed order, each with its detail for the tooltip. Every threshold is in STATUS here.
//   😞 low mood     mood below STATUS.mood (30: they talk about leaving, morale.js MOOD.warn1); danger below
//                   STATUS.moodBad (15: they may walk out; under 10 for 3 days they may break, mentalbreaks.js)
//   🍽 hungry       hunger below STATUS.hunger (25, needs.js NEEDS.low); starving at a base out of food, or below
//                   NEEDS.starving (15) away from one: the days starving and the mood they cost (needs.js starvingDaily)
//   💧 thirsty      thirst below STATUS.thirst (25); parched at a base out of water or below 15 away from one
//   🩸 low health   health below STATUS.health (40); danger below STATUS.healthBad (20)
//   🦠 infected     an infected wound (medical.js), or the worm once it has been spotted (worm.js)
//   🤒 sick         an illness, 🩹 when it is only injuries (health.js conditions)
// The UI draws them (ui/status.js statusIcons); the tests read statusesOf.
import { NEEDS, hungerOf, thirstOf, hungerWord, thirstWord, starveMood, starvingNow } from "./needs.js";
import { MOOD, moodRisk } from "./morale.js";
import { CONDITIONS, conditionsOf, conditionText } from "./health.js";
import { wormSeen, wormLabel } from "./worm.js";

export const STATUS = {
  mood: MOOD.warn1, moodBad: MOOD.desert,
  hunger: NEEDS.low, thirst: NEEDS.low, starving: NEEDS.starving,
  health: 40, healthBad: 20,
};
export const STATUS_ICONS = { mood: "😞", hunger: "🍽", thirst: "💧", health: "🩸", infected: "🦠", sick: "🤒", injured: "🩹" };
export const STATUS_KEYS = ["mood", "hunger", "thirst", "health", "infected", "sick"];

const n0 = (v) => Math.floor((v || 0) + 1e-9);
const first = (s) => s.name.split(" ")[0];

// A gauge that is running out, with the starving days (needs.js): its line for the tooltip.
function needLine(state, s, kind) {
  const food = kind === "food";
  const now = starvingNow(state, s)[kind];
  const v = food ? hungerOf(s) : thirstOf(s);
  const days = food ? s.starveDays || 0 : s.parchDays || 0;
  const word = food ? hungerWord(v) : thirstWord(v);
  const gauge = food ? "hunger" : "thirst";
  if (!now && !days) return `${word} (${gauge} ${n0(v)}): ${s.location && (s.location.kind === "base" || s.location.kind === "route" || s.location.kind === "post") ? `if the base runs out of ${food ? "food" : "water"}` : `below ${STATUS.starving}`} they start losing mood every morning, more each day.`;
  if (!now) return `${food ? "Fed" : "Watered"} again (${gauge} ${n0(v)}) after ${days} day${days === 1 ? "" : "s"} ${food ? "starving" : "parched"}: tomorrow morning it no longer costs mood.`;
  const name = food ? "Starving" : "Parched";
  const fix = food ? "eat" : "drink";
  const atBase = s.location && (s.location.kind === "base" || s.location.kind === "route" || s.location.kind === "post");
  const why = atBase ? `their base is out of ${food ? "food" : "water"}; ${gauge} ${n0(v)}` : `${gauge} ${n0(v)}`;
  if (!days) return `${name} (${why}): from tomorrow morning mood −${starveMood(1, kind)} a day, more each day until they ${fix}.`;
  return `${name}: day ${days}, mood −${starveMood(days, kind)} a day (${why}); tomorrow −${starveMood(days + 1, kind)} unless they ${fix}.${v <= 0 ? ` Empty: it costs health${food ? "" : " fast"}.` : ""}`;
}

// The states on now: [{ key, icon, name, tone: "warn" | "danger", tip }], in STATUS_KEYS order. skip: keys to leave
// out (the battle roster has its own hit points).
export function statusesOf(state, s, { skip = [] } = {}) {
  const out = [];
  if (!s || !s.alive) return out;
  const add = (key, icon, name, tone, tip) => { if (!skip.includes(key)) out.push({ key, icon, name, tone, tip }); };
  const mood = Number.isFinite(s.mood) ? s.mood : 50;
  if (mood < STATUS.mood) {
    const r = moodRisk(s, state);
    add("mood", STATUS_ICONS.mood, "Low mood", mood < STATUS.moodBad || (r && r.level >= 3) ? "danger" : "warn", `Low mood (${n0(mood)})${r ? `: ${r.text.toLowerCase()}` : ""}. Below ${STATUS.mood} they talk about leaving, below ${STATUS.moodBad} they may walk out, and under 10 for 3 mornings they may break down. Hover their mood for what weighs on them.`);
  }
  const now = starvingNow(state, s);
  const h = hungerOf(s), sf = now.food;
  if (h < STATUS.hunger || sf || s.starveDays > 0) add("hunger", STATUS_ICONS.hunger, sf ? "Starving" : "Hungry", sf ? "danger" : "warn", needLine(state, s, "food"));
  const t = thirstOf(s), sw = now.water;
  if (t < STATUS.thirst || sw || s.parchDays > 0) add("thirst", STATUS_ICONS.thirst, sw ? "Parched" : "Thirsty", sw ? "danger" : "warn", needLine(state, s, "water"));
  if (s.health < STATUS.health) add("health", STATUS_ICONS.health, "Low health", s.health < STATUS.healthBad ? "danger" : "warn", `Low health (${n0(s.health)} of 100)${s.health < STATUS.healthBad ? ": one more bad hit could kill them" : ""}. Rest, a bed and a medic heal it; hunger, thirst and the cold slow it.`);
  const worm = wormSeen(s);
  if (s.woundInfected || worm) {
    const bits = [];
    if (s.woundInfected) bits.push("Infected wound: heals at half speed at a base and gets worse on the road. Treat it with meds.");
    if (worm) bits.push(`The worm. ${wormLabel(s)}. If ${first(s)} dies they get up as one of the dead: see the Medical tab.`);
    add("infected", STATUS_ICONS.infected, "Infected", "danger", bits.join(" "));
  }
  const conds = conditionsOf(s).filter((c) => CONDITIONS[c.key]);
  if (conds.length) {
    const ill = conds.some((c) => CONDITIONS[c.key].kind === "illness");
    add("sick", ill ? STATUS_ICONS.sick : STATUS_ICONS.injured, ill ? "Sick" : "Injured", conds.some((c) => !c.mending && c.sev >= 50) ? "danger" : "warn",
      `${ill ? "Sick" : "Injured"}: ${conds.map((c) => `${conditionText(c)}${c.mending ? ", mending" : ""}`).join(", ")}. Treat on the Medical tab or the team panel.`);
  }
  return out;
}
