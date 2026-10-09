// Children and generations (suggestions-4 #25): couples, expecting, births, children growing up into survivors.
//
// Couples: two adults living at the same base who are close friends (opinion FAMILY.coupleAt+, relations.js) and
// neither of whom has a partner become a couple (FAMILY.coupleChance a day; relations.js makePartners, a diary line).
// Partners from the hub event "two survivors grown close" count too.
// Expecting: a couple at home together may expect a child (FAMILY.conceive a day at best). Rarer when food or beds
// are short, when the base is under threat or when either of them is low (conceiveInfo lists every factor); never
// with no free bed, with no food in store, on rations, or when the base already has its share of children (one per
// FAMILY.perAdults adults, at least FAMILY.minKids). One of the two carries (s.expecting): FAMILY.carry days (two
// seasons: a pregnancy shows within a run), the last FAMILY.late days at work x FAMILY.lateWork (morale.js moodWork).
// Birth: at a base when due (away on a team: when they are back, or after FAMILY.overdueAway days wherever they are,
// the child brought to the nearest base). A hard birth (FAMILY.hard, halved by a medic (Medicine 5+ or the Medic
// role) and halved again by a hospital, doubled on the road) costs the parent FAMILY.hardHp health and a med if there
// is one; rarely (hardLoss: 20% of hard births with no care, 5% with a medic or a hospital, none with both) the baby
// does not live. The couple waits FAMILY.rest days before the next.
// Children (state.children, NOT survivors: no team, battle, guard post, job, prisoner trade or recruit card ever
// sees them): a name, a look mixed from the parents (appearance.js), traits from the parents. They grow by the day
// they are fed: a baby (under FAMILY.baby days), a child (to FAMILY.youth), a youngster, and at FAMILY.adult days (a
// year) a survivor who joins the work at their base (work.js newcomers), skills low, nudged by the parents' best and
// by the work they grew up around and helped with.
// Upkeep: they eat FAMILY.food x a ration (upkeep.js foodUse: the "children" group, eaten here) and drink the same
// share of water; a baby sleeps with a parent, the older ones two to a bed (base.kidBeds, buildings.js baseBeds). With
// nothing in store the parents go without for them (their hunger gauges), and a hungry child stops growing that day.
// Chores: from FAMILY.baby days, at a base with farm plots or a kitchen, FAMILY.chores food a day (helping in the
// fields and the kitchen). Mood (relations.js moodFactors, applied daily): children about the base +FAMILY.moodBase
// for everyone there, their own child at the same base +FAMILY.moodParent, expecting +FAMILY.moodExpect.
// Shelter: in a raid or a horde at the walls they hide; only a base that falls touches them: they leave with its
// people for your nearest base (FAMILY.flightLoss of being lost on the way); with no base left they go with the
// exiles and come to the next base you hold. Losing a child: the parents -FAMILY.lossParent mood and grief, everyone
// at the base -FAMILY.lossBase.
// The new-run screen's "Children" box (state.childrenOff) turns all of it off. Own dice (state.family.rng): the
// world's dice are untouched. birthsOn(state, day) / state.family.births: counts for the history (stats).
import { log, day, hub, baseById, survivorById, residents, atBase, skill, makeSurvivor, rollTraits, newId } from "./world.js";
import { getRel, makePartners, addMood, addMoment, relationsOf } from "./relations.js";
import { FIRST_NAMES, SKILLS, clashIn } from "./data.js";
import { traitDice, rollTiers } from "./traits.js"; // a child's own trait: the newer traits' dice
import { SKIN_TONES, HAIR_COLORS, LOOK_OPTIONS, randomAppearance } from "./appearance.js";
import { Rng } from "./rng.js";
import { count, baseBeds } from "./buildings.js";
import { hospitalTier } from "./medical.js";
import { edibleFood, eatFromStore } from "./storage.js";
import { foodUse } from "./upkeep.js";
import { drawWater, waterIn } from "./water.js";
import { drinkRate } from "./economy.js";

export const FAMILY = {
  // Off for now (2026-10-07, the user's call): no couples, pregnancies or births, the new-run box and the Help topic
  // hidden. Everything else stays; true brings it all back. Children already in a save still grow up.
  enabled: false,
  coupleAt: 70, coupleChance: 0.04,
  conceive: 0.03, carry: 56, late: 14, lateWork: 0.85, overdueAway: 7, rest: 56,
  baby: 28, youth: 84, adult: 112,
  food: { baby: 0.25, child: 0.5, youth: 0.75 },
  chores: { child: 0.25, youth: 0.5 },
  perAdults: 3, minKids: 2,
  hard: 0.1, hardHp: 20, hardLoss: [0.2, 0.05, 0],
  moodBase: 0.5, moodParent: 1, moodExpect: 0.5, lossParent: 25, lossBase: 5, griefDays: 12,
  flightLoss: 0.08,
};
export const STAGES = {
  baby: { name: "Baby", icon: "🍼", desc: "Sleeps with a parent, eats a quarter of a ration. No chores." },
  child: { name: "Child", icon: "🧒", desc: "Eats half a ration, shares a bed. Helps in the fields and the kitchen where there are any." },
  youth: { name: "Youngster", icon: "🧑", desc: "Eats three quarters of a ration, shares a bed, does more chores. Grows up soon." },
};
// What children learn from watching the work at their base: role → skill.
const ROLE_SKILL = { farm: "farming", forage: "scouting", hunt: "scouting", fish: "farming", wood: "farming", scavenge: "scavenging", build: "mechanics", craft: "mechanics", operate: "mechanics", guard: "shooting", medic: "medicine", teach: "speech", read: "speech" };

const first = (s) => String(s.name).split(" ")[0];
const lastOf = (name) => String(name).split(" ").slice(1).join(" ") || String(name);
const r1 = (v) => Math.round(v * 10) / 10;

// ---------- state ----------
export const familyOn = (state) => FAMILY.enabled && !!state && !state.childrenOff;
export function familyState(state) {
  if (!state.family) state.family = { rng: new Rng(((state.seed || 1) * 2246822519 + 0xc41d) >>> 0), births: 0, bornOn: {}, grown: 0, lost: 0 };
  return state.family;
}
const famRng = (state) => familyState(state).rng;
export const childrenOf = (state) => state.children || (state.children = []);
// Births on a day (for the history: stats), and in all.
export const birthsOn = (state, d) => (state.family && state.family.bornOn[d]) || 0;
export const birthsTotal = (state) => (state.family ? state.family.births : 0);

// ---------- children ----------
export const ageOf = (state, c) => day(state) - c.bornDay;
export function stageOf(c) {
  const g = c.grown || 0;
  return g < FAMILY.baby ? "baby" : g < FAMILY.youth ? "child" : "youth";
}
export const daysToAdult = (c) => Math.max(0, FAMILY.adult - (c.grown || 0));
export const childrenAt = (state, baseId) => childrenOf(state).filter((c) => c.baseId === baseId);
// A person's children (living, at a base or grown up) and their parents.
export const kidsOf = (state, s) => childrenOf(state).filter((c) => c.parents.includes(s.id));
export const grownKidsOf = (state, s) => state.survivors.filter((o) => o.parents && o.parents.includes(s.id));
export const parentsOf = (state, c) => (c.parents || []).map((id) => survivorById(state, id)).filter(Boolean);
// Rations a day the children at a base eat (before the cold and the quartermaster: upkeep.js foodUse).
export function childRations(state, base) {
  if (!state.children || !state.children.length) return 0;
  return childrenAt(state, base.id).reduce((a, c) => a + FAMILY.food[stageOf(c)], 0);
}
// Beds the children take: babies sleep with a parent, the others two to a bed (buildings.js baseBeds reads kidBeds).
export function updateKidBeds(state) {
  for (const b of state.bases) {
    const n = state.children ? childrenAt(state, b.id).filter((c) => stageOf(c) !== "baby").length : 0;
    b.kidBeds = Math.ceil(n / 2);
    if (!b.kidBeds) delete b.kidBeds;
  }
}

// ---------- couples ----------
// Partner pairs in the world (relations.js r.p), both alive: [[a, b, rel]].
function couples(state) {
  const out = [];
  if (!state.rel) return out;
  const byId = new Map(state.survivors.filter((s) => s.alive).map((s) => [s.id, s]));
  for (const [k, r] of Object.entries(state.rel)) {
    if (!r.p) continue;
    const [x, y] = k.split(":").map(Number);
    const a = byId.get(x), b = byId.get(y);
    if (a && b) out.push([a, b, r]);
  }
  return out;
}
const homeBase = (state, s) => { const b = s && s.alive && s.location && s.location.kind === "base" ? baseById(state, s.location.baseId) : null; return b && (b.owner == null || b.owner === "player") ? b : null; };
const sameBase = (state, a, b) => { const x = homeBase(state, a); return x && x === homeBase(state, b) ? x : null; };
// Close friends at the same base, neither with a partner: a chance a day to become a couple.
function newCouples(state) {
  if (!state.rel) return;
  const rng = famRng(state);
  const taken = new Set();
  for (const [a, b] of couples(state)) { taken.add(a.id); taken.add(b.id); }
  const byId = new Map(state.survivors.filter((s) => s.alive).map((s) => [s.id, s]));
  for (const [k, r] of Object.entries(state.rel)) {
    if (r.p || r.o < FAMILY.coupleAt) continue;
    const [x, y] = k.split(":").map(Number);
    if (taken.has(x) || taken.has(y)) continue;
    const a = byId.get(x), b = byId.get(y);
    if (!a || !b || !sameBase(state, a, b)) continue;
    if (!rng.chance(FAMILY.coupleChance)) continue;
    makePartners(state, a, b);
    taken.add(x); taken.add(y);
    log(state, `${first(a)} and ${first(b)} have grown close: they are a couple now.`, "good");
  }
}

// ---------- expecting ----------
const isExpecting = (s) => !!(s && s.expecting);
// Which of the two carries: the one with no beard (appearance.js facial), else a fixed coin per pair.
function carrierOf(a, b) {
  const fa = (a.appearance && a.appearance.facial) || "none", fb = (b.appearance && b.appearance.facial) || "none";
  if ((fa === "none") !== (fb === "none")) return fa === "none" ? a : b;
  return ((a.id * 31 + b.id * 17) % 2) ? a : b;
}
const threatened = (state, base) => !!base.alert || (state.hordes || []).some((h) => h.role === "attack" && h.target === base.tile);
// How likely a couple at a base is to expect a child today: { p, factors: [[label, x]], why } (why: the hard stop).
export function conceiveInfo(state, a, b, base) {
  const factors = [];
  let why = "";
  const adults = residents(state, base.id).length;
  const kids = childrenAt(state, base.id).length;
  const kidCap = Math.max(FAMILY.minKids, Math.floor(adults / FAMILY.perAdults));
  const freeBeds = baseBeds(base) - adults;
  const use = foodUse(state, base).total;
  const foodDays = edibleFood(base) / Math.max(1, use);
  if (freeBeds < 1) why = "No free bed at the base";
  else if (kids >= kidCap) why = `Already ${kids} children for ${adults} adults`;
  else if (base.hungerDays > 0 || base.thirstDays > 0 || base.rationing) why = "Short of food or water";
  else if (foodDays < 10) why = "Under 10 days of food";
  else if (isExpecting(a) || isExpecting(b)) why = "Already expecting";
  if (foodDays < 30) factors.push([`${Math.floor(foodDays)} days of food`, 0.6]);
  if (freeBeds < 3) factors.push(["Few free beds", 0.6]);
  if (threatened(state, base)) factors.push(["The base is under threat", 0.5]);
  const mood = (a.mood + b.mood) / 2;
  if (mood < 35) why = why || "Too unhappy";
  else if (mood < 50) factors.push(["Low spirits", 0.4]);
  else if (mood >= 70) factors.push(["Good spirits", 1.3]);
  if (Math.min(a.health, b.health) < 50) factors.push(["Hurt or ill", 0.5]);
  const p = why ? 0 : factors.reduce((x, f) => x * f[1], FAMILY.conceive);
  return { p, factors, why, kidCap, freeBeds, foodDays };
}
function conceiveDaily(state) {
  const rng = famRng(state);
  const d = day(state);
  for (const [a, b, r] of couples(state)) {
    if (r.kidDay != null && d - r.kidDay < FAMILY.rest) continue;
    const base = sameBase(state, a, b);
    if (!base) continue;
    const info = conceiveInfo(state, a, b, base);
    if (!(info.p > 0) || !rng.chance(info.p)) continue;
    const c = carrierOf(a, b), o = c === a ? b : a;
    c.expecting = { with: o.id, since: d, due: d + FAMILY.carry, late: false };
    r.kidDay = d;
    addMood(state, a, 5, "Expecting a child");
    addMood(state, b, 5, "Expecting a child");
    log(state, `${first(c)} and ${first(o)} are expecting a child (due around day ${d + FAMILY.carry}).`, "good");
  }
}
// The carrier's daily round: late days, and the birth when due.
function expectingDaily(state) {
  const d = day(state);
  for (const s of state.survivors) {
    const e = s.expecting;
    if (!e) continue;
    if (!s.alive) { delete s.expecting; continue; }
    e.late = d >= e.due - FAMILY.late;
    if (d < e.due) continue;
    const L = s.location || {};
    const base = L.kind === "base" ? baseById(state, L.baseId) : null;
    if (base) { giveBirth(state, s, base, false); continue; }
    if (L.kind === "captive" || d < e.due + FAMILY.overdueAway) continue; // held, or not back yet: born once home
    const to = L.kind === "party" ? baseById(state, (state.parties.find((p) => p.id === L.partyId) || {}).homeBaseId) || hub(state) : hub(state);
    if (to) giveBirth(state, s, to, true);
  }
}
// Care at a base: { medic, hospital }.
function careAt(state, base, s) {
  const staff = atBase(state, base.id).filter((o) => o !== s && (o.role === "medic" || skill(o, "medicine") >= 5));
  return { medic: staff.length > 0, hospital: hospitalTier(base) >= 1 };
}
export function birthRisk(state, base, s, road = false) {
  const c = careAt(state, base, s);
  const hard = FAMILY.hard * (c.medic ? 0.5 : 1) * (c.hospital ? 0.5 : 1) * (road ? 2 : 1);
  const loss = FAMILY.hardLoss[(c.medic ? 1 : 0) + (c.hospital ? 1 : 0)];
  return { ...c, hard, loss: hard * loss };
}
function giveBirth(state, s, base, road) {
  const rng = famRng(state);
  const d = day(state);
  const e = s.expecting;
  delete s.expecting;
  const o = survivorById(state, e.with);
  const r = o ? getRel(state, s, o) : null;
  if (r) r.kidDay = d;
  const risk = birthRisk(state, base, s, road);
  const where = road ? "on the road" : `at ${base.name}`;
  if (rng.chance(risk.hard)) {
    const med = (base.stock.meds || 0) >= 1;
    if (med) base.stock.meds -= 1;
    s.health = Math.max(15, s.health - FAMILY.hardHp);
    if (rng.chance(risk.hard > 0 ? risk.loss / risk.hard : 0)) {
      const fam = familyState(state);
      fam.lost++;
      log(state, `${first(s)}${o ? ` and ${first(o)}` : ""}'s baby was born too early ${where} and died the same day.`, "death");
      for (const p of [s, o]) if (p && p.alive) childGrief(state, p, "their baby");
      for (const x of residents(state, base.id)) if (x !== s && x !== o) addMood(state, x, -FAMILY.lossBase, "A baby died");
      return null;
    }
    log(state, `A hard birth ${where}${med ? " (a med used)" : ""}: ${first(s)} needs rest.`, "danger");
  }
  const c = makeChild(state, s, o, base);
  const fam = familyState(state);
  fam.births++;
  fam.bornOn[d] = (fam.bornOn[d] || 0) + 1;
  for (const p of [s, o]) if (p && p.alive) { addMood(state, p, 10, `${first(c)} was born`); addMoment(state, p, `${c.name} was born, day ${d}`, d); }
  for (const x of residents(state, base.id)) if (x !== s && x !== o) addMood(state, x, 2, "A baby at the base");
  log(state, `${c.name} was born ${road ? `on the road and brought to ${base.name}` : `at ${base.name}`}, to ${first(s)}${o ? ` and ${first(o)}` : ""}.`, "good");
  updateKidBeds(state);
  return c;
}

// ---------- a new child ----------
function childName(state, a, b) {
  const rng = famRng(state);
  const used = new Set([...state.survivors.map((s) => s.name), ...(state.namesGiven || []), ...childrenOf(state).map((c) => c.name)].map((n) => String(n).split(" ")[0]));
  const pool = FIRST_NAMES.filter((f) => !used.has(f));
  const firstName = rng.pick(pool.length ? pool : FIRST_NAMES);
  const last = lastOf((b && rng.chance(0.5) ? b : a).name);
  const name = `${firstName} ${last}`;
  (state.namesGiven || (state.namesGiven = [])).push(name);
  return name;
}
// Traits from the parents: each of theirs 40%, at most two, never two that clash (data.js TRAIT_CLASH); none taken:
// one of their own (the family's dice draw it as ever; the newer traits come in with dice of their own, keyed by the
// family's dice: world.js rollTraits).
function childTraits(rng, a, b) {
  const out = [];
  for (const t of [...(a ? a.traits : []), ...(b ? b.traits : [])]) {
    if (out.length >= 2 || out.includes(t) || !rng.chance(0.4)) continue;
    if (clashIn(out, t)) continue;
    out.push(t);
  }
  if (out.length) return out;
  return rollTraits(rng, traitDice(rng.state >>> 0, 0x6b1d)).slice(0, 1); // keyed by where the family's dice stand (read, not drawn)
}
// A look between the parents': skin between their tones, one parent's hair color, a child's build and clothes.
export function mixAppearance(rng, a, b) {
  const pa = (a && a.appearance) || {}, pb = (b && b.appearance) || pa;
  const look = randomAppearance(rng);
  const ia = SKIN_TONES.indexOf(pa.skin), ib = SKIN_TONES.indexOf(pb.skin);
  if (ia >= 0 && ib >= 0) look.skin = SKIN_TONES[Math.min(ia, ib) + rng.int(0, Math.abs(ia - ib))];
  else if (pa.skin) look.skin = pa.skin;
  const hair = rng.chance(0.5) ? pa.hair : pb.hair;
  look.hair = hair && rng.chance(0.9) ? hair : rng.pick(HAIR_COLORS.slice(0, 8));
  look.hairStyle = rng.pick(LOOK_OPTIONS.hairStyle.values.map((v) => v[0]).filter((k) => k !== "bald" && k !== "mohawk"));
  look.facial = "none";
  look.build = "slim";
  look.accessory = "none";
  return look;
}
function makeChild(state, a, b, base) {
  const rng = famRng(state);
  const d = day(state);
  const parents = [a, b].filter(Boolean);
  const c = {
    id: newId(), name: childName(state, a, b), bornDay: d, baseId: base.id, tile: base.tile,
    parents: parents.map((p) => p.id), parentNames: parents.map((p) => p.name),
    traits: childTraits(rng, a, b), appearance: mixAppearance(rng, a, b),
    grown: 0, hungry: 0, chores: 0, seen: {},
  };
  childrenOf(state).push(c);
  return c;
}

// ---------- growing up ----------
// A day of a child's life at a base: eaten and drunk (the parents go without when the store is empty), chores,
// the work they see, and a day older when fed.
function childrenDaily(state) {
  const kids = childrenOf(state);
  if (!kids.length) return;
  const byBase = new Map();
  for (const c of kids) { if (!byBase.has(c.baseId)) byBase.set(c.baseId, []); byBase.get(c.baseId).push(c); }
  for (const [baseId, list] of byBase) {
    const base = baseById(state, baseId);
    if (!base) continue;
    const use = foodUse(state, base);
    const g = use.groups.find((x) => x.key === "children");
    const want = g ? g.total : 0;
    const missing = eatFromStore(base, want);
    const water = childRations(state, base) * drinkRate(state);
    const short = Math.max(0, water - waterIn(base.stock));
    drawWater(base.stock, Math.min(water, waterIn(base.stock)));
    // The parents (then anyone) give up their share for the children: hunger gauge points (needs.js NEEDS.food 40).
    if (missing > 0 || short > 0) {
      const givers = residents(state, base.id).filter((s) => list.some((c) => c.parents.includes(s.id)));
      const pool = givers.length ? givers : residents(state, base.id);
      for (const s of pool) {
        if (missing > 0) s.hunger = Math.max(0, (s.hunger ?? 100) - (missing * 40) / pool.length);
        if (short > 0) s.thirst = Math.max(0, (s.thirst ?? 100) - (short * 60) / pool.length);
      }
    }
    const fed = !(missing > 0.5 && !residents(state, base.id).length);
    const farms = count(base, "farm_plot") > 0 || count(base, "kitchen") > 0;
    const roles = atBase(state, base.id).map((s) => ROLE_SKILL[s.role]).filter(Boolean);
    for (const c of list) {
      const st = stageOf(c);
      if (fed) { c.grown = (c.grown || 0) + 1; c.hungry = 0; } else c.hungry = (c.hungry || 0) + 1;
      if (st !== "baby" && farms) {
        const q = FAMILY.chores[st] || 0;
        base.stock.food = (base.stock.food || 0) + q;
        c.chores = r1((c.chores || 0) + q);
      }
      if (st !== "baby") for (const k of roles) c.seen[k] = (c.seen[k] || 0) + 1 / Math.max(1, roles.length);
    }
  }
}
// Skills of a new adult: low, plus a third of the better parent's in each, plus what they helped with and saw done.
function grownSkills(rng, c, parents) {
  const skills = {};
  for (const k of SKILLS) {
    const best = parents.length ? Math.max(...parents.map((p) => skill(p, k))) : 0;
    skills[k] = rng.int(0, 3) + Math.round(best * 0.3);
  }
  if ((c.chores || 0) > 0) skills.farming += 2;
  const seen = Object.entries(c.seen || {}).sort((x, y) => y[1] - x[1]);
  if (seen[0]) skills[seen[0][0]] += 3;
  if (seen[1]) skills[seen[1][0]] += 2;
  for (const k of SKILLS) skills[k] = Math.max(0, Math.min(12, skills[k]));
  return skills;
}
function comeOfAge(state, c) {
  const base = baseById(state, c.baseId);
  if (!base) return null;
  const rng = famRng(state);
  // makeSurvivor with the family's dice (the world's are untouched); no name of its own used up.
  const keep = state.rng, made = state.peopleMade, given = state.namesGiven ? state.namesGiven.length : 0;
  let s;
  try { state.rng = rng; s = makeSurvivor(state, 0.4); } finally { state.rng = keep; state.peopleMade = made; if (state.namesGiven) state.namesGiven.length = given; }
  const parents = (c.parents || []).map((id) => survivorById(state, id)).filter(Boolean);
  s.id = c.id; // the same id as the child (world.js newId)
  s.name = c.name;
  s.skills = grownSkills(rng, c, parents);
  s.traits = c.traits.slice();
  rollTiers(s, state.seed, c.id); // a tier for each, dice of their own (traits.js)
  s.appearance = { ...c.appearance, build: rng.weighted(["slim", "average", "heavy"], (x) => (x === "average" ? 3 : 1.5)), facial: rng.chance(0.3) ? rng.pick(["stubble", "beard", "stache"]) : "none" };
  s.health = 100;
  s.mood = 65;
  s.location = { kind: "base", baseId: base.id };
  s.role = "farm";
  s.station = null;
  s.joined = c.bornDay;
  s.born = s.bornDay = c.bornDay; // history.js isBirth reads these and s.parents
  s.parents = c.parents.slice();
  s.parentNames = (c.parentNames || []).slice();
  state.survivors.push(s);
  state.children.splice(state.children.indexOf(c), 1);
  familyState(state).grown++;
  const d = day(state);
  addMoment(state, s, `Born at ${base.name}, day ${c.bornDay}`, c.bornDay);
  addMoment(state, s, `Grew up, day ${d}`, d);
  for (const p of parents) {
    if (!p.alive) continue;
    const r = getRel(state, s, p, true);
    r.o = Math.max(r.o, 55);
    r.h = Math.max(r.h, 30);
    addMood(state, p, 6, `${first(s)} grew up`);
  }
  const best = SKILLS.slice().sort((x, y) => s.skills[y] - s.skills[x]).slice(0, 2);
  log(state, `${s.name} has grown up and joins the work at ${base.name} (best at ${best.join(" and ")}).`, "good");
  updateKidBeds(state);
  return s;
}

// ---------- moving with the family, a base lost ----------
// A child whose base is gone (overrun, taken, burned) leaves with its people for your nearest base; with no base
// left they go with the exiles and come to the next base. A child with no parent at their base follows a parent
// who lives at another one.
function placeDaily(state) {
  const rng = famRng(state);
  const g = state.grid;
  for (const c of [...childrenOf(state)]) {
    const base = c.baseId != null ? baseById(state, c.baseId) : null;
    if (base) { c.tile = base.tile; continue; }
    if (!state.bases.length) { c.baseId = null; continue; } // with the exiles
    const to = [...state.bases].sort((x, y) => (c.tile != null && g ? g.distance(x.tile, c.tile) - g.distance(y.tile, c.tile) : 0) || x.id - y.id)[0];
    if (c.baseId != null && rng.chance(FAMILY.flightLoss)) {
      loseChild(state, c, `${c.name} (${STAGES[stageOf(c)].name.toLowerCase()}) died in the flight from the lost base.`);
      continue;
    }
    c.baseId = to.id;
    c.tile = to.tile;
    log(state, `${c.name} (${STAGES[stageOf(c)].name.toLowerCase()}) was brought to ${to.name}.`, "info");
  }
  for (const c of childrenOf(state)) {
    if (c.baseId == null) continue;
    const parents = (c.parents || []).map((id) => survivorById(state, id)).filter((p) => p && p.alive);
    if (!parents.length || parents.some((p) => homeBase(state, p) && homeBase(state, p).id === c.baseId)) continue;
    const to = parents.map((p) => homeBase(state, p)).find(Boolean);
    if (!to) continue;
    c.baseId = to.id;
    c.tile = to.tile;
    log(state, `${c.name} moved to ${to.name} to be with ${first(parents.find((p) => homeBase(state, p) === to))}.`, "info");
  }
}
function childGrief(state, p, name) {
  addMood(state, p, -FAMILY.lossParent, `Lost ${name}`);
  if (!p.grief || p.grief.bond <= 1) p.grief = { name, id: null, bond: 1, days: FAMILY.griefDays };
  addMoment(state, p, `Lost ${name}, day ${day(state)}`);
}
// A child lost: grief for the parents, a blow to everyone at the base.
export function loseChild(state, c, text) {
  const list = childrenOf(state);
  const i = list.indexOf(c);
  if (i < 0) return;
  list.splice(i, 1);
  familyState(state).lost++;
  log(state, text, "death");
  for (const p of parentsOf(state, c)) if (p.alive) childGrief(state, p, first(c));
  const base = c.baseId != null ? baseById(state, c.baseId) : null;
  if (base) for (const x of residents(state, base.id)) if (!c.parents.includes(x.id)) addMood(state, x, -FAMILY.lossBase, `${first(c)} died`);
  updateKidBeds(state);
}

// ---------- daily ----------
// Once a day (world.js tickHour, after the bases' day).
export function familyDaily(state) {
  if (state.gameOver) return;
  if (!familyOn(state)) {
    if (state.children && state.children.length) { childrenDaily(state); growUp(state); placeDaily(state); }
    return;
  }
  placeDaily(state);
  childrenDaily(state);
  growUp(state);
  expectingDaily(state);
  newCouples(state);
  conceiveDaily(state);
  updateKidBeds(state);
}
function growUp(state) {
  for (const c of [...childrenOf(state)]) if ((c.grown || 0) >= FAMILY.adult) comeOfAge(state, c);
}

// ---------- mood (relations.js moodFactors) ----------
// Lines for someone's daily mood at a base: [{ label, v }].
export function familyMood(state, s, base) {
  const out = [];
  if (s.expecting) { const o = survivorById(state, s.expecting.with); out.push({ label: `Expecting a child${o ? ` with ${first(o)}` : ""}`, v: FAMILY.moodExpect }); }
  else if (state.survivors.some((o) => o.alive && o.expecting && o.expecting.with === s.id)) { const o = state.survivors.find((x) => x.alive && x.expecting && x.expecting.with === s.id); out.push({ label: `Expecting a child with ${first(o)}`, v: FAMILY.moodExpect }); }
  if (!base || !state.children || !state.children.length) return out;
  const here = childrenAt(state, base.id);
  if (!here.length) return out;
  const own = here.filter((c) => c.parents.includes(s.id));
  if (own.length) out.push({ label: `With ${own.length === 1 ? `their child ${first(own[0])}` : `their ${own.length} children`}`, v: FAMILY.moodParent });
  out.push({ label: `Children about the base (${here.length})`, v: FAMILY.moodBase });
  return out;
}
// Work from a late pregnancy (morale.js moodWork).
export const expectingWork = (s) => (s && s.expecting && s.expecting.late ? FAMILY.lateWork : 1);

// ---------- a summary for the UI ----------
export function familyOfPerson(state, s) {
  const partner = relationsOf(state, s).find((x) => x.partner && x.other.alive);
  const parents = (s.parents || []).map((id, i) => survivorById(state, id) || { name: (s.parentNames || [])[i] || "?", alive: false });
  return {
    partner: partner ? partner.other : null,
    kids: kidsOf(state, s), grown: grownKidsOf(state, s), parents,
    expecting: s.expecting ? { ...s.expecting, other: survivorById(state, s.expecting.with) } : null,
    expectingBy: state.survivors.find((o) => o.alive && o.expecting && o.expecting.with === s.id) || null,
  };
}
