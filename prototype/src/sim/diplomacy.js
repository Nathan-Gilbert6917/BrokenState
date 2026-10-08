// Groups and each other: a relations matrix between the AI groups, pacts, wars (raids, sieges, territory, peace
// terms), news on the radio, and what you can do about it (stay out, sell to both sides, broker a ceasefire,
// join a war on one side). Also the prisoner calls other systems use (prisonerTaken, askRansom, payRansom,
// releasePrisoner) and the daily / hourly entry points for jobs (jobs.js) and the coalition (alliance.js).
//
// Relations (state.diplo.rel["a|b"], −100..100, one number per pair)
// - Start from the two types (a raider gang −44 with everyone, −20 with another gang; zealots −34; other
//   aggressive groups −24 with peaceful ones and −28 with each other; traders and communes +30 with peaceful
//   groups; +18 between other peaceful groups) minus neighbour friction (1 per tile closer than 12 between their
//   nearest bases), ± 8 at random.
// - Each day they drift 2% of the way back toward that resting value; events push them off it: a raid outside a
//   war −12, a war started −30, peace sets −15, sharing an enemy +0.4 a day, coalition members +0.3 a day.
// - Pacts: two groups at peace with relations 28+ sign a pact (5% a day); it breaks below 10. Pact partners never
//   raid each other and may join each other's wars (40% when the war starts).
//
// Wars (state.diplo.wars)
// - Declared when relations are −42 or worse, no pact, nearest bases within 18 tiles, the attacker at least 0.6×
//   as strong: 1% a day × the attacker's temper (raiders 1.5, expansionists 1.4, zealots 1.2, military 0.5,
//   fortress 0.3, traders and communes 0.1). At most one war per group (two for aggressive types), three in all,
//   and none for 90 days after a peace between the same two. The reason is land (bases within 9 tiles),
//   resources (the attacker is short of food or ammo and the other is not) or a hive (one within 10 tiles of both).
// - Each side raids the other (6% a day, aggressive types 9%, while none of its war raids is out; the ordinary
//   raids between those two stop): a party of strength × 0.3–0.45 marches, lays siege (the usual 18 hours: you can
//   answer a call for help) and wins with the odds att / (att + 4 + strength × 0.5 + helpers). A win kills 5–10%
//   of the defenders (never below 3), loots 10% of their food, ammo, meds and scrap, may take a secondary base
//   (35%) and a captive (25%). A loss costs the attackers 1–2 people (never below 3).
// - Exhaustion: 0.4 a day (0.8 below 70% of the starting people), +4 a failed raid, +5 a raid suffered, +8 a base
//   lost. Peace comes after 10 days when a side is worn out (55: 25% a day), at once when a side is down to 6
//   people, 10% a day after 75 days, and 1% a day otherwise. Terms by the war score (2 a won raid, +2 for a base,
//   1 a raid held): a lead of 5+ and a loser with 2+ bases cedes the base nearest the winner (land); a lead of 2+
//   pays 25% of its food, ammo, meds and scrap (tribute); otherwise a white peace. Captives go home.
//
// Blocs (blocs.js): alliances of groups by type and a shared threat. A bloc's members never raid each other or go to
// war with each other; a war on a member brings the others in (blocWarJoin, from startWar, beside the pact partners);
// their war raids draw members along (jointRaid); declareWars weighs what each side's bloc could spare. The temper for
// war is groupcare.js GROUP_PRIORITIES warlike (the old TEMPER numbers). Wars with you: playerwars.js (pwarsDaily).
//
// You and their wars
// - Selling: a group at war pays 35% more for ammo and meds and 30% more for weapons and armor, and keeps twice
//   its usual reserve of food, ammo, meds and fuel (less to trade) (trade.js). Arming one side costs a little
//   goodwill with the other (1 a deal with 20+ ammo or a weapon, 3 a day at most).
// - Brokering a ceasefire (both in radio reach, neither hostile, once a week per war): chance 20% + 3.5% per point
//   of your best Speech at the hub + (goodwill A + goodwill B) / 400 + their exhaustion / 200, between 5% and 90%.
//   Success: a white peace, +8 goodwill with both and a thank-you from each (about 40 worth of their surplus).
//   Failure: −3 goodwill with both.
// - Joining a war: the enemy turns hostile (goodwill −60 at most, pact torn up) and can raid you; your side +10
//   goodwill, its raids are 25% stronger and your patrols add 0.3 a day to its war score while your strength is at
//   least 0.4× the enemy's. Raids on your bases count for the war (held +2 your side, broken in +2 theirs). When
//   your side wins you get half the tribute, and land taken in the terms is left free for your outpost (reserved
//   from the groups' expansion for 60 days). After the peace the enemy settles at goodwill −35 (wary, not hostile).
import { Rng } from "./rng.js";
import { groupCapture, jailsOn } from "./groupjails.js"; // jailhouse: war captives into the raider's jail
import { SUPPLIES, SUPPLY_KEYS, supplyFew } from "./data.js";
import { day, log, hub, factionById, addCard, playerStrength, atBase, skill } from "./world.js";
import { attitude, changeGoodwill, isAggressiveType, strength, recomputeOwnership, keepChance } from "./factions.js";
import { clashKit, raidCount } from "./arsenal.js"; // group arsenals: a war raid's dead lose their kit, the side holding the field picks some up
import { spawnAiParty, tileLabel } from "./parties.js";
import { hasNetwork, canListen, canRadioGroup, radioSpeech } from "./radio.js";
import { available, need, buyPrice, refreshMarkets, refreshMarket } from "./trade.js";
import { season } from "./weather.js";
import { gainXp, USE } from "./skills.js";
import { jobsDaily, jobsHour } from "./jobs.js";
import { allianceDaily, isMember } from "./alliance.js";
import { raidPaceOpen, noteRaid } from "./eras.js";
import { hcGroupRaidsQuiet } from "./hardcore-groups.js";
import { keyWord } from "./water.js"; // "un-purified water" in texts
import { raidTurretPower } from "./vehicles.js"; // the Humvee a raid brought (its M2)
import { totalRounds } from "./rounds.js"; // rounds by calibre ("ammo": every round there)
import { payAmmo } from "./ammo.js"; // rounds by calibre: the ones its guns need least go
import { warCaptureMult } from "./nonlethal.js"; // groups that take people alive take more prisoners in a war
import { weightOf } from "./groupcare.js"; // GROUP_PRIORITIES warlike: a group's temper for war
import { noteStrife, SPLINTER } from "./splinters.js"; // a lost war stirs strife (splinter bands)
import { sameBloc, blocSpare, blocWarJoin, blocsDaily, jointRaid } from "./blocs.js"; // AI blocs (alliances of groups)
import { pwarsDaily } from "./playerwars.js"; // wars declared on you (and by you)

export const DIPLO = {
  DRIFT: 0.02, PACT_REL: 28, PACT_BREAK: 10, PACT_CHANCE: 0.05, WAR_REL: -42, WAR_BASE: 0.01, WAR_RANGE: 18,
  WAR_STRENGTH: 0.6, PEACE_COOLDOWN: 90, MAX_WARS: 3, RAID_CHANCE: 0.06, RAID_CHANCE_AGG: 0.09, MIN_POP: 3, SUE_POP: 6, // war raids grind a group down to 3 (factions.js GROUP_BREAK); peace at once at 6
  EXHAUSTED: 55, LONG_WAR: 75, LAND_LEAD: 5, TRIBUTE_LEAD: 2, TRIBUTE: 0.25, BROKER_DAYS: 7, RESERVE_DAYS: 60,
};
// A group's temper for war: groupcare.js GROUP_PRIORITIES warlike (raiders 1.5, expansionists 1.4, zealots 1.2, military 0.5,
// fortress 0.3, traders and communes 0.1: the old TEMPER table).
const temper = (f) => weightOf(f, "warlike", 1);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------- state ----------
export function ensureDiplo(state) {
  if (state.diplo) return state.diplo;
  state.diplo = {
    rel: {}, rest: {}, pacts: [], wars: [], ended: [], news: [], seq: 1, reserved: {}, lastPeace: {}, armsGw: {},
    stats: { wars: 0, peace: 0, land: 0, tribute: 0, white: 0, brokered: 0, joined: 0, raids: 0, raidWins: 0, basesTaken: 0, pacts: 0, pactsBroken: 0 },
  };
  for (const a of state.factions) for (const b of state.factions) if (a.id < b.id) {
    const r = restingRel(state, a, b) + Math.round(diploRng(state).range(-8, 8));
    state.diplo.rel[key(a, b)] = clamp(r, -100, 100);
  }
  return state.diplo;
}
// The coalition, jobs and wars draw from their own stream, so the rest of the world's dice are not shifted by
// how often a group thinks about its neighbours.
export function diploRng(state) {
  if (!state.diploRng) state.diploRng = new Rng(((state.seed || 1) * 2246822519 + 0xd1b0) >>> 0);
  return state.diploRng;
}
const key = (a, b) => (a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`);
// The two types' resting relation (groupcare.js GROUP_PRIORITIES relKin / relOut / relRank): with its own type a
// group's relKin; with another, the relOut of the type with the higher relRank (the lower relOut on a tie).
const TYPE_REL = 18; // an unknown type's (relKin and relOut)
function typeRel(a, b) {
  if (a.type === b.type) return weightOf(a, "relKin", TYPE_REL);
  const ra = weightOf(a, "relRank", 0), rb = weightOf(b, "relRank", 0);
  const oa = weightOf(a, "relOut", TYPE_REL), ob = weightOf(b, "relOut", TYPE_REL);
  return ra > rb ? oa : rb > ra ? ob : Math.min(oa, ob);
}
export function baseDistance(state, a, b) {
  let best = Infinity;
  for (const x of a.bases) for (const y of b.bases) best = Math.min(best, state.grid.distance(x, y));
  return best;
}
// Where relations settle when nothing happens: the two types, minus friction between close neighbours.
export function restingRel(state, a, b) {
  const d = baseDistance(state, a, b);
  return typeRel(a, b) - (Number.isFinite(d) ? 1.0 * Math.max(0, 12 - d) : 0);
}
export function relation(state, a, b) {
  if (!a || !b || a === b) return 0;
  const d = ensureDiplo(state);
  const k = key(a, b);
  if (d.rel[k] == null) d.rel[k] = clamp(restingRel(state, a, b), -100, 100);
  return d.rel[k];
}
export function changeRelation(state, a, b, amount) {
  if (!a || !b || a === b) return 0;
  const d = ensureDiplo(state);
  const k = key(a, b);
  d.rel[k] = clamp(relation(state, a, b) + amount, -100, 100);
  return d.rel[k];
}
export const relWord = (r) => (r <= -45 ? "enemies" : r <= -15 ? "rivals" : r < 15 ? "wary" : r < 35 ? "friendly" : "close");

// ---------- wars and pacts: lookups ----------
export const warsOf = (state, f) => ensureDiplo(state).wars.filter((w) => w.a === f.id || w.b === f.id);
export const atWar = (state, f) => !!f && !!state.diplo && state.diplo.wars.some((w) => w.a === f.id || w.b === f.id);
export const warBetween = (state, a, b) => ensureDiplo(state).wars.find((w) => (w.a === a.id && w.b === b.id) || (w.a === b.id && w.b === a.id)) || null;
export const warById = (state, id) => ensureDiplo(state).wars.find((w) => w.id === Number(id)) || null;
export const enemyIn = (w, f) => (w.a === f.id ? w.b : w.a);
export const pactBetween = (state, a, b) => ensureDiplo(state).pacts.some((p) => (p.a === a.id && p.b === b.id) || (p.a === b.id && p.b === a.id));
export const pactsOf = (state, f) => ensureDiplo(state).pacts.filter((p) => p.a === f.id || p.b === f.id).map((p) => factionById(state, p.a === f.id ? p.b : p.a)).filter((o) => o && o.alive);
// f.atWar: how many wars a group is in (trade.js reads it for prices and what they can spare).
export function syncWarFlags(state) {
  for (const f of state.factions) f.atWar = state.diplo ? state.diplo.wars.filter((w) => w.a === f.id || w.b === f.id).length : 0;
}
// The player's side in a war, as the group they fight beside (null: not in it).
export const playerSideIn = (state, w) => (w.playerSide != null ? factionById(state, w.playerSide) : null);
// Wars you are in, and the groups you are at war with because of them.
export const playerWars = (state) => ensureDiplo(state).wars.filter((w) => w.playerSide != null);
export const playerEnemies = (state) => playerWars(state).map((w) => factionById(state, w.playerSide === w.a ? w.b : w.a)).filter(Boolean);

// A group's name as you know it ("a group to the north" if you have not met them).
export function knownAs(state, f) {
  if (!f) return "someone";
  if (f.known) return f.name;
  const h = hub(state);
  if (!h || f.bases[0] == null) return "a group you have not met";
  const a = state.tiles[h.tile], b = state.tiles[f.bases[0]];
  const dx = b.x - a.x, dy = b.y - a.y;
  const dir = Math.abs(dx) > Math.abs(dy) * 2 ? (dx > 0 ? "east" : "west") : Math.abs(dy) > Math.abs(dx) * 2 ? (dy > 0 ? "south" : "north") : `${dy > 0 ? "south" : "north"}${dx > 0 ? "east" : "west"}`;
  return `a group to the ${dir}`;
}

// News on the radio: kept for the Affairs screen, and logged when you have a radio on the air (a station, or a
// hand-crank radio listening: radio.js canListen) and know one of them.
export function news(state, text, kind = "info", involved = []) {
  const d = ensureDiplo(state);
  const heard = canListen(state) && involved.some((f) => f && f.known);
  d.news.unshift({ day: day(state), text, heard });
  if (d.news.length > 60) d.news.length = 60;
  if (heard) log(state, `📻 ${text}`, kind);
  return text;
}

// ---------- daily ----------
// Called from radio.js radioDaily (after the groups' own day): relations, pacts, wars, market lists, jobs and the
// coalition. state.noWars (tools) keeps the old world: no pacts or wars between groups.
export function diplomacyDaily(state) {
  ensureDiplo(state);
  shocksDaily(state);
  refreshMarkets(state); // trade.js: weekly wants and surplus lists
  if (!state.noWars) {
    relationsDaily(state);
    pactsDaily(state);
    if (!state.noBlocs) blocsDaily(state); // blocs.js: alliances between groups form, help, share, break
    warsDaily(state);
    if (!hcGroupRaidsQuiet(state)) declareWars(state); // hardcore-groups.js: no new wars while the bands found their hubs
  }
  pwarsDaily(state); // playerwars.js: wars on you (declared, fought, ended on terms or weariness); state.noPlayerWars: none
  jobsDaily(state);
  allianceDaily(state);
}
// Called from world.js tickHour: job checks (a team in place, a horde or hive engaged, cargo delivered).
export function diplomacyHour(state) {
  if (!state.diplo) return;
  jobsHour(state);
}

// Shortages: now and then a group loses part of a store (frost or blight on the fields outside winter, sickness
// through the meds, a fire in the fuel store): 1% a day per group, news on the radio, and its wants list is made
// again at once so the market board shows the new prices (they stay high until the stock recovers).
const SHOCKS = [
  { key: "food", frac: 0.45, text: (n, s) => `${cap(n)} lost ${s === "winter" ? "a store of food to rot" : "its harvest to frost and blight"}: food prices are high there.` },
  { key: "meds", frac: 0.6, text: (n) => `Sickness swept through ${n}: they are short of meds and pay well for them.` },
  { key: "fuel", frac: 0.6, text: (n) => `A fire at ${n} burned most of their fuel: fuel prices are high there.` },
  { key: "ammo", frac: 0.4, text: (n) => `${cap(n)} lost an ammo store: they pay more for ammo.` },
];
function shocksDaily(state) {
  const rng = diploRng(state);
  const s = season(state).key;
  for (const f of state.factions) {
    if (!f.alive || !rng.chance(0.01)) continue;
    const sh = rng.pick(SHOCKS);
    f.stock[sh.key] = Math.floor((f.stock[sh.key] || 0) * (1 - sh.frac));
    f.shock = { key: sh.key, day: day(state) };
    refreshMarket(state, f);
    news(state, sh.text(knownAs(state, f), s), "info", [f]);
  }
}

function relationsDaily(state) {
  const d = state.diplo;
  const live = state.factions.filter((f) => f.alive);
  for (const a of live) for (const b of live) {
    if (a.id >= b.id) continue;
    const k = key(a, b);
    const rest = restingRel(state, a, b);
    let r = relation(state, a, b);
    r += (rest - r) * DIPLO.DRIFT;
    // A shared enemy brings two groups closer; coalition members grow closer.
    if (warsOf(state, a).some((w) => { const e = enemyIn(w, a); return e !== b.id && warsOf(state, b).some((v) => enemyIn(v, b) === e); })) r += 0.4;
    if (isMember(state, a) && isMember(state, b)) r += 0.3;
    d.rel[k] = clamp(r, -100, 100);
  }
}

function pactsDaily(state) {
  const d = state.diplo, rng = diploRng(state);
  d.pacts = d.pacts.filter((p) => {
    const a = factionById(state, p.a), b = factionById(state, p.b);
    if (!a || !b || !a.alive || !b.alive) return false;
    if (relation(state, a, b) < DIPLO.PACT_BREAK || warBetween(state, a, b)) {
      d.stats.pactsBroken++;
      news(state, `${cap(knownAs(state, a))} and ${knownAs(state, b)} have broken off their pact.`, "info", [a, b]);
      return false;
    }
    return true;
  });
  const live = state.factions.filter((f) => f.alive);
  for (const a of live) for (const b of live) {
    if (a.id >= b.id || pactBetween(state, a, b) || warBetween(state, a, b)) continue;
    if (relation(state, a, b) < DIPLO.PACT_REL || !rng.chance(DIPLO.PACT_CHANCE)) continue;
    d.pacts.push({ a: a.id, b: b.id, since: day(state) });
    d.stats.pacts++;
    news(state, `${cap(knownAs(state, a))} and ${knownAs(state, b)} signed a pact.`, "info", [a, b]);
  }
}

function warReason(state, a, b) {
  const g = state.grid;
  if (baseDistance(state, a, b) <= 9) return "land";
  if ((need(a, "food") >= 1.5 || need(a, "ammo") >= 1.5) && need(b, "food") < 1.1) return "resources";
  if ((state.hives || []).some((h) => a.bases.some((x) => g.distance(x, h.tile) <= 10) && b.bases.some((x) => g.distance(x, h.tile) <= 10))) return "hive";
  return "land";
}
const REASON_TEXT = { land: "over land", resources: "over food and ammo", hive: "over the ground around a hive", bloc: "beside its bloc" };

function declareWars(state) {
  const d = state.diplo, rng = diploRng(state), today = day(state);
  if (d.wars.length >= DIPLO.MAX_WARS) return;
  const live = state.factions.filter((f) => f.alive);
  const maxWars = (f) => (isAggressiveType(f) ? 2 : 1);
  for (const a of live) for (const b of live) {
    if (a === b || d.wars.length >= DIPLO.MAX_WARS) continue;
    // a is the one who starts it: the more aggressive of the pair checks first.
    if (temper(a) < temper(b) || (temper(a) === temper(b) && a.id > b.id)) continue;
    if (warBetween(state, a, b) || pactBetween(state, a, b) || sameBloc(state, a, b)) continue; // blocs.js: a bloc keeps its own peace
    if (relation(state, a, b) > DIPLO.WAR_REL) continue;
    if (warsOf(state, a).length >= maxWars(a) || warsOf(state, b).length >= maxWars(b)) continue;
    if (a.pop < 10 || b.pop < 8 || strength(a) + blocSpare(state, a) < (strength(b) + blocSpare(state, b)) * DIPLO.WAR_STRENGTH) continue; // blocs.js: what its bloc could send counts
    if (baseDistance(state, a, b) > DIPLO.WAR_RANGE) continue;
    if (isMember(state, a) && isMember(state, b)) continue; // the coalition keeps its own peace
    const last = d.lastPeace[key(a, b)];
    if (last != null && today - last < DIPLO.PEACE_COOLDOWN) continue;
    if (!rng.chance(DIPLO.WAR_BASE * temper(a))) continue;
    startWar(state, a, b, warReason(state, a, b));
  }
}

export function startWar(state, a, b, reason = "land") {
  const d = ensureDiplo(state);
  if (warBetween(state, a, b)) return warBetween(state, a, b);
  const w = {
    id: d.seq++, a: a.id, b: b.id, reason, start: day(state), score: { [a.id]: 0, [b.id]: 0 }, exh: { [a.id]: 0, [b.id]: 0 },
    pop0: { [a.id]: a.pop, [b.id]: b.pop }, raids: 0, captives: { [a.id]: 0, [b.id]: 0 }, playerSide: null, brokerDay: -99, asked: false,
  };
  d.wars.push(w);
  d.stats.wars++;
  changeRelation(state, a, b, -30);
  d.pacts = d.pacts.filter((p) => !((p.a === a.id && p.b === b.id) || (p.a === b.id && p.b === a.id)));
  news(state, `${cap(knownAs(state, a))} went to war with ${knownAs(state, b)} ${REASON_TEXT[reason] || ""}.`.replace(" .", "."), "danger", [a, b]);
  // Pact partners of the defender may come in on its side: they start their own war with the attacker.
  const rng = diploRng(state);
  for (const p of pactsOf(state, b)) {
    if (p === a || warBetween(state, p, a) || warsOf(state, p).length >= (isAggressiveType(p) ? 2 : 1) || d.wars.length >= DIPLO.MAX_WARS + 1) continue;
    if (!rng.chance(0.4)) continue;
    allyWar(state, p, a, "pact");
    news(state, `${cap(knownAs(state, p))} stands by its pact with ${knownAs(state, b)}: it is at war with ${knownAs(state, a)} too.`, "danger", [p, a, b]);
  }
  blocWarJoin(state, w, a, b); // blocs.js: the defender's bloc comes in on its side, the attacker's may march with it
  syncWarFlags(state);
  askPlayerToJoin(state, w);
  return w;
}

// A war a group joins beside another (a pact partner, a bloc member: blocs.js blocWarJoin): its own war with the enemy.
export function allyWar(state, p, enemy, reason = "pact") {
  const d = ensureDiplo(state);
  if (warBetween(state, p, enemy)) return null;
  const w2 = {
    id: d.seq++, a: p.id, b: enemy.id, reason, start: day(state), score: { [p.id]: 0, [enemy.id]: 0 }, exh: { [p.id]: 0, [enemy.id]: 0 },
    pop0: { [p.id]: p.pop, [enemy.id]: enemy.pop }, raids: 0, captives: { [p.id]: 0, [enemy.id]: 0 }, playerSide: null, brokerDay: -99, asked: false,
  };
  d.wars.push(w2);
  d.stats.wars++;
  changeRelation(state, p, enemy, -30);
  d.pacts = d.pacts.filter((x) => !((x.a === p.id && x.b === enemy.id) || (x.a === enemy.id && x.b === p.id)));
  return w2;
}

// Raids, exhaustion and peace, once a day for every war.
function warsDaily(state) {
  const d = state.diplo, rng = diploRng(state), today = day(state);
  for (const w of [...d.wars]) {
    const a = factionById(state, w.a), b = factionById(state, w.b);
    if (!a || !b || !a.alive || !b.alive) { endWar(state, w, null, "gone"); continue; }
    for (const [f, o] of [[a, b], [b, a]]) {
      w.exh[f.id] = (w.exh[f.id] || 0) + (f.pop < (w.pop0[f.id] || f.pop) * 0.7 ? 0.8 : 0.4);
      const chance = isAggressiveType(f) ? DIPLO.RAID_CHANCE_AGG : DIPLO.RAID_CHANCE;
      const out = state.parties.some((p) => p.owner === f.id && p.kind === "raid" && p.warId === w.id);
      if (!out && f.pop >= 8 && rng.chance(chance)) warRaid(state, w, f, o);
    }
    // Your patrols harry the enemy's roads while you are in the war and strong enough to matter.
    if (w.playerSide != null) {
      const foe = factionById(state, enemyIn(w, { id: w.playerSide }));
      if (foe && playerStrength(state) >= strength(foe) * 0.4) w.score[w.playerSide] = (w.score[w.playerSide] || 0) + 0.3;
    }
    // Peace?
    const age = today - w.start;
    const worn = Math.max(w.exh[a.id] || 0, w.exh[b.id] || 0);
    const broken = Math.min(a.pop, b.pop) <= DIPLO.SUE_POP;
    if (broken || (age >= 10 && worn >= DIPLO.EXHAUSTED && rng.chance(0.25)) || (age >= DIPLO.LONG_WAR && rng.chance(0.1)) || (age >= 10 && rng.chance(0.01))) makePeace(state, w);
  }
}

export function warRaid(state, w, f, o) {
  const rng = diploRng(state), g = state.grid;
  const origin = f.bases[0];
  if (origin == null) return null;
  const targets = o.bases.map((t) => ({ kind: "faction", factionId: o.id, tile: t, w: 1 / (1 + g.distance(origin, t) / 8) }));
  // You fight beside one side: its enemy may come for your bases too.
  if (w.playerSide === o.id && raidPaceOpen(state)) for (const b of state.bases) if (g.distance(origin, b.tile) <= 20) targets.push({ kind: "player", baseId: b.id, tile: b.tile, w: 0.6 / (1 + g.distance(origin, b.tile) / 8) });
  if (!targets.length) return null;
  const tgt = rng.weighted(targets, (t) => t.w);
  const mult = w.playerSide === f.id ? 1.25 : 1;
  const p = spawnAiParty(state, f, "raid", origin, tgt.tile, { strength: Math.max(4, strength(f) * rng.range(0.3, 0.45) * mult), target: tgt });
  if (!p) return null;
  p.warId = w.id;
  const j = jointRaid(state, f, tgt.tile, tgt.kind === "player" ? { kind: "player", id: "player" } : { kind: "group", id: o.id }); // blocs.js: bloc members march with them
  if (j) { p.strength += j.power; p.joint = j.ids; }
  if (tgt.kind === "player") noteRaid(state); // eras.js: the pace of raids on you
  w.raids++;
  state.diplo.stats.raids++;
  return p;
}

// factions.js resolveRaidOnFaction: a war raid's siege is over. Returns true when the defenders held.
export function resolveWarRaid(state, party, attacker, target, helpPower) {
  const d = ensureDiplo(state), rng = diploRng(state);
  const w = warById(state, party.warId);
  const att = party.strength + raidTurretPower(state, party); // vehicles.js: the Humvee they brought
  const def = 4 + strength(target) * 0.5 + helpPower;
  const won = rng.chance(att / (att + def));
  const report = state.live.has(party.target.tile) || (attacker && attacker.known && target.known);
  if (won) {
    d.stats.raidWins++;
    const loss = Math.min(Math.max(1, Math.round(target.pop * rng.range(0.05, 0.1))), Math.max(0, target.pop - DIPLO.MIN_POP));
    target.pop -= loss;
    clashKit(state, attacker, attacker ? raidCount(attacker, att) : 0, 0, target, loss, "a", 0.1, true, "war"); // arsenal.js
    for (const k of ["food", "ammo", "meds", "scrap"]) {
      const take = Math.floor((target.stock[k] || 0) * 0.1);
      target.stock[k] -= take;
      if (attacker) attacker.stock[k] = (attacker.stock[k] || 0) + take;
    }
    let took = false;
    const tile = party.target.tile;
    if (attacker && target.bases.length > 1 && tile !== target.bases[0] && attacker.bases.length < 5 && rng.chance(0.35 * Math.min(1, keepChance(state, attacker, tile) / 0.6))) { // factions.js keepChance: the same wish to keep a base as an ordinary raid
      target.bases = target.bases.filter((x) => x !== tile);
      target.lostBaseDay = day(state); // valuation.js
      attacker.bases.push(tile);
      recomputeOwnership(state);
      took = true;
      d.stats.basesTaken++;
    }
    if (w && attacker) {
      w.score[attacker.id] = (w.score[attacker.id] || 0) + 2 + (took ? 2 : 0);
      w.exh[target.id] = (w.exh[target.id] || 0) + 5 + (took ? 8 : 0);
      if (rng.chance(0.25 * warCaptureMult(attacker))) {
        const n = Math.min(1, Math.max(0, target.pop - DIPLO.MIN_POP));
        // groupjails.js: in a world with the groups' jails the captive goes into the raider's jail (room, or by type:
        // sold, let go, killed), where it can be swapped or turned; older saves keep the war's own count (back at peace).
        if (n > 0) { target.pop -= n; if (jailsOn(state)) groupCapture(state, attacker, target, n); else w.captives[target.id] = (w.captives[target.id] || 0) + n; }
      }
    }
    if (report) log(state, `${cap(knownAs(state, attacker))} raided ${knownAs(state, target)} at ${tileLabel(state, tile)} (${loss} dead${took ? ", the base taken" : ""}).`, "danger");
    return false;
  }
  const tp = target.pop, ap = attacker ? attacker.pop : 0;
  target.pop = Math.max(Math.min(target.pop, DIPLO.MIN_POP), target.pop - rng.int(0, 1));
  if (attacker) attacker.pop = Math.max(Math.min(attacker.pop, DIPLO.MIN_POP), attacker.pop - rng.int(1, 2));
  clashKit(state, attacker, attacker ? raidCount(attacker, att) : 0, attacker ? ap - attacker.pop : 0, target, tp - target.pop, "b", 0, true, "war"); // arsenal.js: the defenders hold the field
  if (w && attacker) {
    w.score[target.id] = (w.score[target.id] || 0) + 1;
    w.exh[attacker.id] = (w.exh[attacker.id] || 0) + 4;
  }
  if (report) log(state, `${cap(knownAs(state, target))} held off a raid by ${knownAs(state, attacker)}.`, "info");
  return true;
}

// factions.js resolveRaidOnPlayer: a war raid on your base counts for the war.
export function warRaidOnPlayer(state, party, held) {
  const w = party.warId != null ? warById(state, party.warId) : null;
  if (!w || w.playerSide == null) return;
  const foe = party.owner;
  if (held) { w.score[w.playerSide] = (w.score[w.playerSide] || 0) + 2; w.exh[foe] = (w.exh[foe] || 0) + 4; }
  else w.score[foe] = (w.score[foe] || 0) + 2;
}

// Peace on terms from the war score.
export function makePeace(state, w, how = "terms") {
  const a = factionById(state, w.a), b = factionById(state, w.b);
  if (!a || !b) return endWar(state, w, null, "gone");
  const sa = (w.score[a.id] || 0) - (w.exh[a.id] || 0) / 10, sb = (w.score[b.id] || 0) - (w.exh[b.id] || 0) / 10;
  const [win, lose] = sa >= sb ? [a, b] : [b, a];
  const lead = Math.abs((w.score[a.id] || 0) - (w.score[b.id] || 0));
  const d = state.diplo;
  let terms = "white";
  let text;
  const youWon = w.playerSide === win.id;
  if (how === "brokered") {
    text = `${cap(knownAs(state, a))} and ${knownAs(state, b)} agreed to a ceasefire.`;
    d.stats.brokered++;
  } else if (lead >= DIPLO.LAND_LEAD && lose.bases.length >= 2) {
    terms = "land";
    const g = state.grid;
    const tile = lose.bases.slice(1).sort((x, y) => Math.min(...win.bases.map((z) => g.distance(x, z))) - Math.min(...win.bases.map((z) => g.distance(y, z))))[0];
    lose.bases = lose.bases.filter((x) => x !== tile);
    lose.lostBaseDay = day(state); // valuation.js
    if (youWon) d.reserved[tile] = day(state) + DIPLO.RESERVE_DAYS;
    else if (win.bases.length < 5) win.bases.push(tile);
    recomputeOwnership(state);
    d.stats.land++;
    text = `${cap(knownAs(state, lose))} made peace with ${knownAs(state, win)} and gave up ${tileLabel(state, tile)}${youWon ? ": the land is free for an outpost of yours" : ""}.`;
  } else if (lead >= DIPLO.TRIBUTE_LEAD) {
    terms = "tribute";
    const paid = {};
    for (const k of ["food", "ammo", "meds", "scrap"]) {
      const q = Math.floor((lose.stock[k] || 0) * DIPLO.TRIBUTE);
      lose.stock[k] -= q;
      const mine = youWon ? Math.floor(q / 2) : 0;
      win.stock[k] = (win.stock[k] || 0) + q - mine;
      if (mine > 0) { const h = hub(state); h.stock[k] = (h.stock[k] || 0) + mine; paid[k] = mine; }
    }
    d.stats.tribute++;
    const share = Object.entries(paid).map(([k, q]) => `${q} ${keyWord(k)}`).join(", ");
    text = `${cap(knownAs(state, lose))} made peace with ${knownAs(state, win)} and pays tribute.${share ? ` Your share reached the hub: ${share}.` : ""}`;
  } else {
    d.stats.white++;
    text = `${cap(knownAs(state, a))} and ${knownAs(state, b)} made peace. Neither side gained anything.`;
  }
  endWar(state, w, terms, text);
  if (terms === "land" || terms === "tribute") noteStrife(lose, SPLINTER.WAR_LOST, "war"); // splinters.js: a lost war stirs strife
  if (w.playerSide != null) {
    const ally = factionById(state, w.playerSide);
    const foe = ally === a ? b : a;
    if (ally && ally.alive && youWon) changeGoodwill(state, ally, 10, "victory together");
    if (foe && foe.alive && foe.goodwill < -35) changeGoodwill(state, foe, -35 - foe.goodwill, "the peace");
  }
  return terms;
}

function endWar(state, w, terms, text) {
  const d = state.diplo;
  const i = d.wars.indexOf(w);
  if (i < 0) return;
  d.wars.splice(i, 1);
  syncWarFlags(state);
  const a = factionById(state, w.a), b = factionById(state, w.b);
  // Captives go home.
  for (const f of [a, b]) if (f && f.alive && w.captives[f.id]) f.pop += w.captives[f.id];
  if (a && b) {
    d.lastPeace[key(a, b)] = day(state);
    d.rel[key(a, b)] = Math.max(relation(state, a, b), -15);
  }
  d.ended.unshift({ id: w.id, a: w.a, b: w.b, reason: w.reason, start: w.start, end: day(state), terms: terms || "none", raids: w.raids, playerSide: w.playerSide });
  if (d.ended.length > 30) d.ended.length = 30;
  if (terms) {
    d.stats.peace++;
    news(state, text, "good", [a, b]);
  }
}

// ---------- the player and the wars ----------
// The group you fight for asks: join, send ammo, or stay out (only groups that like you ask).
function askPlayerToJoin(state, w) {
  for (const id of [w.b, w.a]) {
    const f = factionById(state, id), foe = factionById(state, enemyIn(w, f));
    if (!f || !foe || !f.known || attitude(f) === "Hostile") continue;
    if (!(f.goodwill >= 40 || f.pact || isMember(state, f))) continue;
    if (!canRadioGroup(state, f)) continue;
    w.asked = true;
    if (hub(state)) addCard(state, warCard(state, w, f, foe)); // no base left (conquest.js exiles): nobody to ask
    return;
  }
}

export function warCard(state, w, f, foe) {
  const h = hub(state);
  return {
    title: `${f.name} asks you to join their war`, warId: w.id,
    text: `${f.name} (${attitude(f).toLowerCase()}) is at war with ${foe.known ? foe.name : "a group you have not met"} ${REASON_TEXT[w.reason] || ""}. They ask you to stand with them. Joining makes ${foe.known ? foe.name : "the enemy"} hostile (they may raid you); if your side wins you share the tribute and any land they give up.`,
    choices: [
      { label: `Join the war beside ${f.name}`, hint: joinProblem(state, w, f) || `${foe.name}: goodwill −60 at most, pact torn up. ${f.name}: +10 goodwill, their raids 25% stronger`, disabled: (st) => !!joinProblem(st, w, f),
        ai: (st) => warJoinScore(st, w, f, foe), resolve: (st) => joinWar(st, w.id, f.id) },
      { label: "Send 40 ammo", hint: `+5 goodwill with ${f.name}; ${foe.name} hears of it (−2)`, disabled: (st) => totalRounds(hub(st).stock) < 40 || !warById(st, w.id),
        ai: (st) => (totalRounds(hub(st).stock) >= 160 && !(st.governor && st.governor.personality === "cautious") ? 1 : -1), resolve: (st) => {
          if (totalRounds(hub(st).stock) < 40 || !warById(st, w.id)) return "It is too late for that.";
          payAmmo(st, hub(st), 40); f.stock.ammo = (f.stock.ammo || 0) + 40;
          changeGoodwill(st, f, 5, "you sent ammo for their war"); changeGoodwill(st, foe, -2, "you armed their enemy");
          return `40 ammo sent to ${f.name}.`;
        } },
      { label: "Stay out of it", hint: `−2 goodwill with ${f.name}`, ai: () => 0, resolve: (st) => { changeGoodwill(st, f, -2, "you stayed out of their war"); return `You stay out of the war between ${f.name} and ${foe.known ? foe.name : "their enemy"}.`; } },
    ],
  };
}
// The autopilot's view of a war: Cautious always stays out; the others join a stronger side with friends, and only
// against a group that is no friend of yours.
function warJoinScore(state, w, f, foe) {
  const style = state.governor ? state.governor.personality : "balanced";
  if (style === "cautious") return -5;
  if (foe.goodwill >= 20 || foe.pact) return -5;
  const ours = strength(f) + playerStrength(state) * 0.5;
  const need = style === "aggressive" ? 1.0 : 1.4;
  return ours >= strength(foe) * need ? 5 : -2;
}

export function joinProblem(state, w, f) {
  if (!w || !warById(state, w.id)) return "That war is over.";
  if (!f || !f.alive) return "They are gone.";
  if (w.playerSide != null) return w.playerSide === f.id ? "You are already fighting beside them." : "You are already in this war on the other side.";
  if (w.a !== f.id && w.b !== f.id) return "They are not in that war.";
  if (attitude(f) === "Hostile") return `${f.name} will not fight beside you.`;
  if (f.goodwill < 0) return `${f.name} does not trust you enough (goodwill 0 needed).`;
  const foe = factionById(state, enemyIn(w, f));
  if (foe && isMember(state, foe)) return `${foe.name} is in your coalition.`;
  return "";
}

export function joinWar(state, warId, sideId) {
  const w = warById(state, warId);
  const f = factionById(state, Number(sideId));
  const why = joinProblem(state, w, f);
  if (why) return why;
  const foe = factionById(state, enemyIn(w, f));
  w.playerSide = f.id;
  state.diplo.stats.joined++;
  changeGoodwill(state, f, 10, "you joined their war");
  f.lastDiplomacy = day(state);
  if (foe) {
    foe.known = true;
    if (foe.goodwill > -60) changeGoodwill(state, foe, -60 - foe.goodwill, "you joined the war against them");
    else changeGoodwill(state, foe, 0);
    if (foe.pact) { foe.pact = null; log(state, `${foe.name} tore up its pact with you.`, "danger"); }
  }
  log(state, `You joined ${f.name}'s war against ${foe ? foe.name : "their enemy"}.`, "danger");
  return `You are at war with ${foe ? foe.name : "their enemy"}, beside ${f.name}.`;
}

// Leave a war you joined: your side is let down (−8), the enemy stays as it is.
export function leaveWar(state, warId) {
  const w = warById(state, warId);
  if (!w || w.playerSide == null) return "You are not in that war.";
  const f = factionById(state, w.playerSide);
  w.playerSide = null;
  if (f && f.alive) changeGoodwill(state, f, -8, "you left their war");
  return `You pull out of the war${f ? ` beside ${f.name}` : ""}.`;
}

// Broker a ceasefire: what it takes, and the odds (no dice; the UI shows it).
export function brokerInfo(state, w) {
  const out = { ok: false, why: "", chance: 0 };
  if (!w || !warById(state, w.id)) return { ...out, why: "That war is over." };
  const a = factionById(state, w.a), b = factionById(state, w.b);
  if (!a || !b) return { ...out, why: "They are gone." };
  if (!a.known || !b.known) return { ...out, why: "You need to know both sides." };
  if (!hasNetwork(state)) return { ...out, why: "You need a radio station." };
  if (!canRadioGroup(state, a) || !canRadioGroup(state, b)) return { ...out, why: "Both sides must be in radio reach." };
  if (attitude(a) === "Hostile" || attitude(b) === "Hostile") return { ...out, why: "Neither side may be hostile to you." };
  if (w.playerSide != null) return { ...out, why: "You are fighting in this war yourself." };
  const wait = DIPLO.BROKER_DAYS - (day(state) - w.brokerDay);
  if (wait > 0) return { ...out, why: `They will not hear another offer for ${wait} day${wait === 1 ? "" : "s"}.` };
  const speech = radioSpeech(state);
  const worn = ((w.exh[a.id] || 0) + (w.exh[b.id] || 0)) / 2;
  out.chance = clamp(0.2 + 0.035 * speech + (a.goodwill + b.goodwill) / 400 + worn / 200, 0.05, 0.9);
  out.ok = true;
  return out;
}

export function brokerCeasefire(state, warId) {
  const w = warById(state, warId);
  const info = brokerInfo(state, w);
  if (!info.ok) return info.why;
  const a = factionById(state, w.a), b = factionById(state, w.b);
  w.brokerDay = day(state);
  const h = hub(state);
  const talker = h ? [...atBase(state, h.id)].sort((x, y) => skill(y, "speech") - skill(x, "speech") || x.id - y.id)[0] : null;
  if (talker) gainXp(state, talker, "speech", USE.radio || 2);
  if (!state.rng.chance(info.chance)) {
    changeGoodwill(state, a, -3, "a failed ceasefire");
    changeGoodwill(state, b, -3, "a failed ceasefire");
    return `The talks failed (${Math.round(info.chance * 100)}% chance). ${a.name} and ${b.name} fight on.`;
  }
  makePeace(state, w, "brokered");
  const gifts = [];
  for (const f of [a, b]) {
    changeGoodwill(state, f, 8, "you brokered a ceasefire");
    f.lastDiplomacy = day(state);
    const k = SUPPLY_KEYS.filter((x) => available(f, x) >= supplyFew(x, 3) && x !== "water" && x !== "rawwater").sort((x, y) => need(f, x) - need(f, y))[0];
    if (!k) continue;
    const q = Math.max(1, Math.min(available(f, k), Math.round(40 / (SUPPLIES[k].value * Math.max(0.5, need(f, k))))));
    f.stock[k] -= q;
    h.stock[k] = (h.stock[k] || 0) + q;
    gifts.push(`${q} ${k} from ${f.name}`);
  }
  log(state, `You brokered a ceasefire between ${a.name} and ${b.name}.${gifts.length ? ` Thanks: ${gifts.join(", ")}.` : ""}`, "good");
  return `Ceasefire! ${a.name} and ${b.name} lay down their arms (${Math.round(info.chance * 100)}% chance).${gifts.length ? ` They thank you: ${gifts.join(", ")} (at the hub).` : ""}`;
}

// trade.js: selling arms to a group at war costs a little goodwill with its enemies (3 a day at most each).
export function armsSold(state, f, ammo, weapons) {
  if (!atWar(state, f) || (ammo < 20 && !weapons)) return;
  const d = ensureDiplo(state), today = day(state);
  for (const w of warsOf(state, f)) {
    const foe = factionById(state, enemyIn(w, f));
    if (!foe || !foe.alive || !foe.known) continue;
    const k = `${foe.id}:${today}`;
    if ((d.armsGw[k] || 0) >= 3) continue;
    d.armsGw[k] = (d.armsGw[k] || 0) + 1;
    changeGoodwill(state, foe, -1, "you arm their enemy");
  }
}
// factions.js: groups do not expand onto land reserved for your outpost after a peace.
export const reservedForYou = (state, tile) => !!state.diplo && (state.diplo.reserved[tile] || 0) >= day(state);
// factions.js launchRaid: a group does not raid its pact partners; it prefers its war enemies.
export function raidWeight(state, f, o) {
  if (!state.diplo) return 1;
  if (pactBetween(state, f, o) || sameBloc(state, f, o)) return 0; // blocs.js: never a member of their own bloc
  if (isMember(state, f) && isMember(state, o)) return 0;
  return warBetween(state, f, o) ? 0 : 1; // the war raids (warRaid) are the raids between enemies
}
// factions.js resolveRaidOnFaction: an ordinary raid between groups sours things between them.
export function raidSoured(state, a, b) {
  if (a && b) changeRelation(state, a, b, -12);
}

// ---------- the AI governor (autopilot.js) ----------
// Aggressive: sells ammo over the radio to a group at war when the hub has plenty (once every 8 days).
// Returns a log text or "".
export function autoWarTrade(state, style, deal) {
  if (style !== "aggressive" || !hasNetwork(state) || typeof deal !== "function") return "";
  const d = ensureDiplo(state);
  if (d.autoSell != null && day(state) - d.autoSell < 8) return "";
  const h = hub(state);
  const spare = Math.floor(totalRounds(h.stock) - Math.max(1, atBase(state, h.id).length) * 25);
  if (spare < 30) return "";
  for (const f of state.factions) {
    if (!f.alive || !f.known || !atWar(state, f) || !canRadioGroup(state, f) || attitude(f) === "Hostile") continue;
    const want = ["meds", "food", "fuel", "parts", "scrap"].filter((k) => available(f, k) >= 3).sort((x, y) => need(f, x) - need(f, y))[0];
    if (!want) continue;
    const payQty = Math.min(spare, 120);
    const r = deal(state, f, want, payQty);
    if (r) { d.autoSell = day(state); return r; }
  }
  return "";
}

// ---------- prisoners (the combat side calls these) ----------
// prisonerTaken(state, f, s): you took one of their people (a knocked-out enemy). They resent it: −5 goodwill
// (−2 if hostile already). Returns the line for the log.
export function prisonerTaken(state, f, s = null) {
  if (!f) return "";
  f.prisonersHeld = (f.prisonersHeld || 0) + 1;
  f.known = true;
  changeGoodwill(state, f, attitude(f) === "Hostile" ? -2 : -5, "you hold their people");
  return `${s && s.name ? s.name : "One of them"} of ${f.name} is your prisoner.`;
}
// What they would pay to get a prisoner back: { ok, offer: { key: qty }, value, text }. No dice.
export function askRansom(state, f, s = null) {
  if (!f || !f.alive) return { ok: false, offer: {}, value: 0, text: "Nobody is left to pay for them." };
  if (!(f.prisonersHeld > 0)) return { ok: false, offer: {}, value: 0, text: `You hold none of ${f.name}'s people.` };
  const base = 30 + (s && s.skillTotal ? s.skillTotal : 0);
  const value = base * (attitude(f) === "Hostile" ? 0.6 : 1) * (atWar(state, f) ? 1.3 : 1);
  const offer = {};
  let left = value;
  for (const k of SUPPLY_KEYS.filter((x) => x !== "water" && x !== "rawwater" && available(f, x) > 0).sort((x, y) => need(f, x) - need(f, y))) {
    if (left <= 0) break;
    const unit = buyPrice(state, f, k, 0, 1);
    const q = Math.min(available(f, k), Math.ceil(left / unit));
    if (q <= 0) continue;
    offer[k] = q;
    left -= q * unit;
  }
  const ok = Object.keys(offer).length > 0;
  const what = Object.entries(offer).map(([k, q]) => `${q} ${keyWord(k)}`).join(", ");
  return { ok, offer, value: Math.round(value), text: ok ? `${f.name} would pay ${what} to have them back.` : `${f.name} has nothing to pay with.` };
}
// They pay and get their person back (+3 goodwill). opts.baseId: where the ransom goes (default the hub).
export function payRansom(state, f, s = null, opts = {}) {
  const q = askRansom(state, f, s);
  if (!q.ok) return q.text;
  const base = (opts.baseId != null && state.bases.find((b) => b.id === opts.baseId)) || hub(state);
  for (const [k, n] of Object.entries(q.offer)) {
    f.stock[k] = Math.max(0, (f.stock[k] || 0) - n);
    base.stock[k] = (base.stock[k] || 0) + n;
  }
  f.prisonersHeld = Math.max(0, f.prisonersHeld - 1);
  f.pop += 1;
  changeGoodwill(state, f, 3, "you returned their person for a ransom");
  return `${f.name} paid ${Object.entries(q.offer).map(([k, n]) => `${n} ${k}`).join(", ")} to ${base.name} and took their person home.`;
}
// Let a prisoner go for nothing: +8 goodwill (+4 if hostile).
export function releasePrisoner(state, f, s = null) {
  if (!f) return "";
  if (f.prisonersHeld > 0) { f.prisonersHeld -= 1; if (f.alive) f.pop += 1; }
  changeGoodwill(state, f, attitude(f) === "Hostile" ? 4 : 8, "you let their person go");
  return `You let ${s && s.name ? s.name : "the prisoner"} go back to ${f.name}.`;
}
// A rescue raid of yours on a group's base (to free your own people): they resent it (−15), and their enemies
// think better of you (+3).
export function rescueRaidDone(state, f, won = true) {
  if (!f) return;
  changeGoodwill(state, f, won ? -15 : -8, "your raid on their base");
  if (!state.diplo) return;
  for (const w of warsOf(state, f)) {
    const foe = factionById(state, enemyIn(w, f));
    if (foe && foe.alive && foe.known) changeGoodwill(state, foe, 3, "you hit their enemy");
  }
}
export { changeGoodwill };
