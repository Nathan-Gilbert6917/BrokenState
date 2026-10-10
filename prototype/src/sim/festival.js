// The harvest festival (suggestions-4 #27): once a year, after the harvest, the hub asks for a day off to celebrate.
//
// On autumn day FEST.DAY (weather.js calendar: day 64 of the first year, then every 112 days) at FEST.HOUR, a card at
// the hub, if at least FEST.MIN_PEOPLE live there:
// - Hold the festival: a day off for everyone at the hub except the guards and the medics (the Rest role until
//   midnight: work.js and morale.js already honour restUntil), FULL.food extra food a head (a child at the hub half), a bonfire of FULL.wood
//   firewood if the hub has it, a bottle of liquor from the armory for every DRINK_PER people if there is any. Everyone
//   at the hub mood +FULL.mood (+fire, +drink), then +FULL.glow a day for FULL.glowDays days ("The harvest festival" in
//   the mood breakdown, relations.js moodFactors); everyone else (outposts, teams) gets the smaller outpost share. Every
//   pair at the hub grows a little closer (relations.js bumpPair) and there is a FULL.story chance of a story: a couple,
//   two rivals making peace, or a new friendship.
// - A small festival: an evening do, no day off: SMALL.food a head, a smaller lift, a smaller story chance.
// - Skip it: nothing, unless the hub's mood is already under SKIP.below (then everyone there SKIP.mood).
// Not offered while the hub is under attack (a siege or an alert, a horde heading for it within 4 tiles) or starving
// (out of food, or under FOOD_DAYS days of it left): put off POSTPONE days, once; still not possible then, no
// festival that year. No hub (hardcore before the first one): no festival that year.
//
// state.festival: { year (the calendar year last offered or skipped), postponed (day | null), last: { day, baseId,
// kind } }; people carry s.festGlow = { until, v }. Saved with the state. The stories use relations.js's own dice.
import { log, addCard, day, hub, atBase, residents, alive } from "./world.js";
import { GEAR } from "./data.js";
import { season } from "./weather.js";
import { underAttack } from "./buildings.js";
import { foodOutlook } from "./economy.js";
import { childrenAt } from "./family.js"; // children eat at the festival
import { addMood, bumpPair, getRel, relKind, relRng, partnerOf, makePartners, rivalPairs, addMoment } from "./relations.js";
import { countOf, takeOneAt } from "./itemstack.js"; // bottles stack (three a slot)

export const FEST = {
  SEASON: "autumn", DAY: 22, HOUR: 7, // the morning of autumn day 22: the harvest is in, the hard frosts not yet
  POSTPONE: 3, MIN_PEOPLE: 3, FOOD_DAYS: 5, DRINK_PER: 4, KID_SHARE: 0.5,
  FULL: { food: 2, wood: 40, mood: 10, fire: 2, drink: 2, glow: 1, glowDays: 7, outpost: 4, outpostGlow: 0.5, bond: 2, story: 0.4 },
  SMALL: { food: 1, mood: 5, glow: 0.5, glowDays: 4, outpost: 2, outpostGlow: 0.25, bond: 1, story: 0.15 },
  SKIP: { below: 40, mood: -3 },
};

const fest = (state) => state.festival || (state.festival = { year: 0, postponed: null, last: null });
const first = (s) => s.name.split(" ")[0];
const foodOf = (b) => (b.stock.food || 0) + (b.stock.preserved || 0);
// Fresh food first (it spoils), then preserved.
function eat(b, n) {
  const fresh = Math.min(b.stock.food || 0, n);
  b.stock.food = (b.stock.food || 0) - fresh;
  b.stock.preserved = Math.max(0, (b.stock.preserved || 0) - (n - fresh));
}
// Heads at the table: the people who live at the hub, and its children (family.js: they have no mood of their own,
// but they eat at the festival, KID_SHARE of a head).
const heads = (state, b) => residents(state, b.id).length + FEST.KID_SHARE * childrenAt(state, b.id).length;
const costOf = (n, k) => Math.ceil(n * FEST[k].food);
// Every bottle in the armory, one entry a bottle (a stack of three is three: itemstack.js).
const liquor = (b) => (b.armory || []).flatMap((it) => (it && GEAR[it.key] && GEAR[it.key].cat === "liquor" ? Array.from({ length: countOf(it) }, () => it) : []));

// Why the hub cannot hold it today ("" when it can).
export function festivalBlocker(state, b) {
  if (!b) return "no hub";
  const g = state.grid;
  if (underAttack(state, b) || state.hordes.some((h) => h.role === "attack" && h.goal && h.goal.baseId === b.id && g.distance(h.tile, b.tile) <= 4)) return "the hub is under attack";
  const fo = foodOutlook(state, b) || {};
  if (b.hungerDays > 0 || foodOf(b) < 1 || (fo.daysLeft != null && fo.daysLeft < FEST.FOOD_DAYS)) return "the stores are nearly empty";
  return "";
}

// Hourly (world.js tickHour): the morning of the festival day, or of the day it was put off to.
export function festivalHour(state) {
  if (state.hour % 24 !== FEST.HOUR || state.timelapse) return;
  const F = fest(state);
  const se = season(state), d = day(state);
  if (F.year >= se.year) return; // offered (or skipped) this year already
  const due = F.postponed != null ? d >= F.postponed : se.key === FEST.SEASON && se.dayOfSeason >= FEST.DAY;
  if (!due) return;
  const b = hub(state);
  if (!b || residents(state, b.id).length < FEST.MIN_PEOPLE) { F.year = se.year; F.postponed = null; return; }
  const why = festivalBlocker(state, b);
  if (why) {
    if (F.postponed == null) {
      F.postponed = d + FEST.POSTPONE;
      log(state, `The harvest festival at ${b.name} is put off for ${FEST.POSTPONE} days: ${why}.`, "info");
    } else {
      F.year = se.year;
      F.postponed = null;
      log(state, `No harvest festival at ${b.name} this year: ${why}.`, "danger");
    }
    return;
  }
  F.year = se.year;
  F.postponed = null;
  if (!state.cards.some((c) => c.festival)) addCard(state, festivalCard(state, b));
}

// The card. Its choices read the hub when they are answered (the food may have changed).
export function festivalCard(state, b) {
  const n = () => heads(state, b);
  const daysAfter = (k) => { const fo = foodOutlook(state, b) || {}; const burn = fo.daysLeft > 0 && Number.isFinite(fo.daysLeft) ? foodOf(b) / fo.daysLeft : 0; return burn > 0 ? (foodOf(b) - costOf(n(), k)) / burn : 99; };
  const avgMood = () => { const p = residents(state, b.id); return p.length ? p.reduce((a, s) => a + s.mood, 0) / p.length : 60; };
  const F = FEST.FULL, S = FEST.SMALL;
  const wood = (b.stock.firewood || 0) >= F.wood, drink = liquor(b).length > 0;
  return {
    title: "The harvest festival",
    where: b.name,
    festival: true,
    festivalBase: b.id, // cardrules.js: out of date if the hub is lost
    text: `The harvest is in and the nights are drawing in. People at ${b.name} want to mark another year alive: a day off, a long table, ${wood ? "a bonfire" : "music"}${drink ? " and a bottle or two" : ""}. ` +
      `${residents(state, b.id).length} people live at the hub${childrenAt(state, b.id).length ? ` with ${childrenAt(state, b.id).length} children` : ""}; the food would last about ${Math.max(0, Math.floor(daysAfter("FULL")))} days after a full festival.`,
    choices: [
      {
        label: `Hold the festival (${costOf(n(), "FULL")} food${wood ? `, ${F.wood} firewood` : ""}${drink ? `, ${Math.min(liquor(b).length, Math.ceil(residents(state, b.id).length / FEST.DRINK_PER))} bottles` : ""})`,
        hint: `A day off at the hub for all but the guards and medics. Everyone there mood +${F.mood}${wood ? ` (+${F.fire} for the bonfire)` : ""}${drink ? ` (+${F.drink} for the drink)` : ""}, then +${F.glow} a day for ${F.glowDays} days; people at the outposts and on the road +${F.outpost}, then +${F.outpostGlow} a day. Everyone at the hub grows a little closer, ${Math.round(F.story * 100)}% chance of a story (a couple, a peace, a friendship)`,
        disabled: (st) => foodOf(b) < costOf(n(), "FULL"),
        ai: () => (daysAfter("FULL") >= 40 ? 8 + (avgMood() < 50 ? 2 : 0) : 0),
        resolve: (st) => holdFestival(st, b, "FULL"),
      },
      {
        label: `A small festival (${costOf(n(), "SMALL")} food)`,
        hint: `An evening meal and songs, no day off. Everyone at the hub mood +${S.mood}, then +${S.glow} a day for ${S.glowDays} days; elsewhere +${S.outpost}. ${Math.round(S.story * 100)}% chance of a story`,
        default: true, // the safe answer when nobody picks (cheap, no work lost)
        disabled: (st) => foodOf(b) < costOf(n(), "SMALL"),
        ai: () => (daysAfter("SMALL") >= 20 ? 5 : 1),
        resolve: (st) => holdFestival(st, b, "SMALL"),
      },
      {
        label: "Skip it this year",
        hint: avgMood() < FEST.SKIP.below ? `Spirits are already low: everyone at the hub mood ${FEST.SKIP.mood}` : "Work goes on; nobody minds much",
        ai: () => 2,
        resolve: (st) => {
          const low = avgMood() < FEST.SKIP.below;
          if (low) for (const s of residents(st, b.id)) addMood(st, s, FEST.SKIP.mood, "No festival this year");
          log(st, `No harvest festival at ${b.name} this year.`, "info");
          return low ? `Work goes on. Spirits sink a little further (everyone at the hub mood ${FEST.SKIP.mood}).` : "Work goes on.";
        },
      },
    ],
  };
}

// Holds it: the costs, the day off, the mood, the bonds and maybe a story. kind: "FULL" or "SMALL". Returns the text.
export function holdFestival(state, b, kind) {
  const K = FEST[kind], full = kind === "FULL";
  const people = residents(state, b.id);
  const kids = childrenAt(state, b.id).length;
  const cost = costOf(heads(state, b), kind);
  if (!state.bases.includes(b)) return `${b.name} is no longer yours.`;
  if (foodOf(b) < cost) return `${b.name} cannot spare ${cost} food now.`;
  eat(b, cost);
  const d = day(state);
  let lift = K.mood;
  const extras = [];
  if (full && (b.stock.firewood || 0) >= K.wood) { b.stock.firewood -= K.wood; lift += K.fire; extras.push("a bonfire"); }
  const bottles = full ? liquor(b).slice(0, Math.ceil(people.length / FEST.DRINK_PER)) : [];
  if (bottles.length) { for (const it of bottles) takeOneAt(b.armory, b.armory.indexOf(it)); lift += K.drink; extras.push(`${bottles.length} bottle${bottles.length === 1 ? "" : "s"}`); }
  // The day off: the Rest role until midnight (morale.js gives the old role back), but for the guards and the medics.
  if (full) for (const s of atBase(state, b.id)) {
    if (s.role === "guard" || s.role === "medic" || s.inBed || s.restUntil != null) continue;
    if (s.role !== "rest") s.restPrev = s.role;
    s.role = "rest"; s.station = null; s.restUntil = d + 1;
  }
  for (const s of people) { addMood(state, s, lift, "The harvest festival"); s.festGlow = { until: d + K.glowDays, v: K.glow }; }
  for (const s of alive(state)) {
    if (people.includes(s) || !s.location || s.location.kind === "captive") continue;
    addMood(state, s, K.outpost, "News of the harvest festival");
    s.festGlow = { until: d + K.glowDays, v: K.outpostGlow };
  }
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) bumpPair(state, people[i], people[j], K.bond);
  const story = relRng(state).chance(K.story) ? festivalStory(state, people) : "";
  fest(state).last = { day: d, baseId: b.id, kind: full ? "full" : "small" };
  const text = `${full ? "The harvest festival" : "A small harvest supper"} at ${b.name} (${cost} food${extras.length ? `, ${extras.join(", ")}` : ""}): everyone there mood +${lift}${full ? ", and a day off" : ""}.${kids ? ` The children ran wild${full ? " around the fires" : ""} until long after dark.` : ""}${story ? ` ${story}` : ""}`;
  log(state, text, "good");
  return text;
}

// A story from the night: two friends who become a couple, two rivals who make peace, or two people who hit it off.
function festivalStory(state, people) {
  const rng = relRng(state);
  const pairs = [];
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) pairs.push([people[i], people[j], getRel(state, people[i], people[j], true)]);
  const d = day(state);
  const couple = pairs.filter(([a, b, r]) => !r.p && r.o >= 50 && !partnerOf(state, a) && !partnerOf(state, b));
  if (couple.length && rng.chance(0.5)) {
    const [a, b] = couple[Math.floor(rng.next() * couple.length)];
    makePartners(state, a, b);
    return `${first(a)} and ${first(b)} danced until the fire burned down. They are together now.`;
  }
  const rivals = rivalPairs(state, people);
  if (rivals.length && rng.chance(0.5)) {
    const [a, b] = rivals[Math.floor(rng.next() * rivals.length)];
    bumpPair(state, a, b, 24);
    addMoment(state, a, `Made peace with ${b.name} at the harvest festival, day ${d}`, d);
    addMoment(state, b, `Made peace with ${a.name} at the harvest festival, day ${d}`, d);
    return `${first(a)} and ${first(b)} shared a bottle and buried the hatchet, for now.`;
  }
  const warm = pairs.filter(([, , r]) => relKind(r) !== "rival" && r.o > 0 && r.o < 40);
  if (!warm.length) return "";
  const [a, b] = warm[Math.floor(rng.next() * warm.length)];
  bumpPair(state, a, b, 20);
  addMoment(state, a, `Talked until dawn with ${b.name} at the harvest festival, day ${d}`, d);
  addMoment(state, b, `Talked until dawn with ${a.name} at the harvest festival, day ${d}`, d);
  return `${first(a)} and ${first(b)} talked until dawn by the fire.`;
}

// The mood breakdown's line (relations.js moodFactors): the festival's afterglow, a little a day for a while.
export function festivalGlow(state, s) {
  const g = s.festGlow;
  if (!g) return 0;
  if (g.until < day(state)) { delete s.festGlow; return 0; }
  return g.v;
}
// The map (ui/render.js): the hub's festival day, for the extra fires.
export const festivalNow = (state, b) => { const L = state.festival && state.festival.last; return !!L && L.baseId === b.id && L.day === day(state); };

// ---------- help (ui/help.js) ----------
export const FESTIVAL_HELP = `Once a year, on the morning of autumn day ${FEST.DAY} (after the harvest, before the hard frosts), the people at your hub ask for a harvest festival (a card; the hub needs at least ${FEST.MIN_PEOPLE} people). <i>Hold the festival:</i> a day off for everyone at the hub but the guards and the medics, ${FEST.FULL.food} food a head (a child counts as half: children have no mood of their own, but they eat), a bonfire of ${FEST.FULL.wood} firewood if the hub has it and a bottle of liquor from the armory for every ${FEST.DRINK_PER} people if there is any. Everyone at the hub mood +${FEST.FULL.mood} (+${FEST.FULL.fire} with the bonfire, +${FEST.FULL.drink} with drink), then +${FEST.FULL.glow} a day for ${FEST.FULL.glowDays} days; people at the outposts and on the road +${FEST.FULL.outpost}, then +${FEST.FULL.outpostGlow} a day. Everyone at the hub grows a little closer, and ${Math.round(FEST.FULL.story * 100)}% of festivals leave a story: two friends becoming a couple, two rivals making peace, or a new friendship. <i>A small festival:</i> an evening supper with no day off, ${FEST.SMALL.food} food a head, mood +${FEST.SMALL.mood} and +${FEST.SMALL.glow} a day for ${FEST.SMALL.glowDays} days (+${FEST.SMALL.outpost} elsewhere), a ${Math.round(FEST.SMALL.story * 100)}% chance of a story. <i>Skip it:</i> nothing, unless spirits at the hub are already under ${FEST.SKIP.below} (then mood ${FEST.SKIP.mood}). While the hub is under attack or has under ${FEST.FOOD_DAYS} days of food the festival is put off ${FEST.POSTPONE} days, once; still not possible then, there is none that year. On the festival day extra fires burn at the hub on the map.`;
