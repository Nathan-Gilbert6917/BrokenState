// @ts-check
// The AI groups' jails, their prisoners, the work they get out of them and the trades between groups (jailhouse).
//
// - Jails: the same three tiers as yours (prisoners.js JAIL: makeshift cells 2, holding cells 3, a jailhouse 8 per
//   base), built at a group's main base as a work (groupworks.js nextWork "jail", after water, fields and quarters:
//   STEPS has each step's scrap, parts and crew-days). Raiders, the military, the fortress and any group at war build
//   makeshift cells early, expecting prisoners; the others once they hold someone; communes last of all. A full jail
//   is upgraded (holding cells, then a jailhouse once they are 15+ strong). f.jails[tile] = the tier. Old saves (no
//   state.groupJails) and groups without a record count as holding cells everywhere with no limit; the hardcore
//   military holds its people in a jailhouse block.
// - What they hold: your people (conflicts.js captives, s.location.kind "captive") and other groups' people
//   (f.prisoners: { id, from: a group id, power, since, s: the very person }). Both count against the room
//   (groupRoom). Groups take prisoners from each other in raids they win (nonlethal.js raidPrisoners: a share of the
//   beaten by the winner's type, NL_TAKE, through groupCapture; a war raid's captives, groupfight.js applySide through
//   capturePeople; raiders grabbing a group's people on the road, jobs.js rescueJob). Every record is a person: a
//   prisoner going home (freeHeld, goHome: a rescue, a peace, a ransom, an exchange) goes back into their group's list
//   as themselves, never as a head count. This is the one model of prisoners between groups.
// - No room (jailOf full, by type: groupcare.js GROUP_PRIORITIES jail): raiders, expansionists and traders sell the extra one to a group with room (unsold:
//   raiders and expansionists kill them, traders let them go; your people: kept over the room for YOURS.days for you
//   to ransom them (ransom.js talks; a sale is tried each day), then killed by raiders and expansionists, let go by
//   traders), the military, the fortress and communes let them go, zealots kill them. Your captive's fate comes on a card.
// - Labour (jailOf share and mood): every prisoner works for them, a share of a worker by type (raiders lean hardest) × a stand-in for
//   their mood (raiders treat theirs worst: low output, but they feed them little): food and scrap a day, and their
//   building goes faster (f.prisonWork, groupworks.js). Your people held are worked too: health and mood fall a day by
//   captor (jailOf health and captiveMood; raiders grimmest), the broken die of it, and escapes and turning follow (conflicts.js captivesDaily).
// - Guards (GUARDS, groupJailGuards): a group puts guards on its jail while it holds anyone, by its head count × its
//   leaning to prisoners and patrols (groupcare.js GROUP_PRIORITIES), fewer while hungry or at war, at most one more
//   than it holds and GUARDS.max: a big, well-run group 2–4, a band of a handful none. Each counts as one average
//   guard of yours (prisoners.js JAIL_GUARD: the same diminishing stack). The rescue raid's map posts them at the cell
//   (rescueraid.js) and the rescue card names them (conflicts.js).
// - Escapes (captiveEscape, prisonerEscape): the jail's tier and guards as for yours (prisoners.js cellEscape): the
//   cell rate, × the work detail on worked days (jailOf escapeWork, the type's share of days), a captive's Stealth
//   × the tier's bonus. Holding cells, raiders: 3.7% a day with no guard, 0.49% with one, 0.15% with two.
// - Trades a day (TRADE): ransom back (their own group buys them, not at war, with what it can spare), exchange (two
//   groups each holding the other's swap one for one), sale (raiders sell people as labour to raiders and
//   expansionists; the military and the fortress buy only to free them, which their group remembers), recruitment
//   (held long, one may join their captors). Relations between the groups move with it (diplomacy.js), and notable
//   trades go out as radio news. Your captives can be sold on too: a card says where they are now (their factionId
//   and tile change, so rescue missions follow).
// - groupJailTier(f, tile, state): the rescue raid's base map (a chain-link cage, barred cells or a jailhouse block:
//   prisoners.js JAIL block).
import { DAY_VALUE, takeFood, addFoodsTo, giveFood, foodIn } from "./foods.js"; // food by type (foods.js)
import { day, log, addCard, factionById, hub, skill, hurt, newId, checkGameOver } from "./world.js";
import { SUPPLIES, supValue } from "./data.js";
import { JAIL_TIERS, PRISON, cellEscape, guardTighten, groupGuardStrength } from "./prisoners.js";
import { allCaptives, CAPTIVE_TOOL } from "./conflicts.js";
import { changeRelation, relation, warBetween, atWar, news, knownAs } from "./diplomacy.js";
import { available } from "./trade.js";
import { spendAmmo } from "./rounds.js"; // rounds paid by calibre
import { roundsText } from "./ammo.js"; // and named so in the news
import { tileLabel } from "./parties.js";
import { openNegotiation, dealFor, talksOf, groupMemberWorth } from "./ransom.js"; // rescue: buying your people back; the value rule
import { weightOf } from "./groupcare.js"; // the type profiles
import { captivesFrom, takeQuietly, homeAgain, fighterScore, removeMember } from "./members.js"; // prisoners between groups are people
import { stripAll } from "./inventory.js";
import { keepItem } from "./arsenal.js";

export const GROUP_JAIL = {
  // The step up to each tier (groupworks.js job "jail"): what it costs and crew-days of work.
  STEPS: [null, { name: "makeshift cells", cost: { scrap: 3 }, work: 2 }, { name: "holding cells", cost: { scrap: 6, parts: 1 }, work: 4 }, { name: "a jailhouse", cost: { scrap: 12, parts: 2 }, work: 7 }],
  JAILHOUSE_POP: 15,
  // Each type's jail habits are its GROUP_PRIORITIES jail row (groupcare.js; jailOf): early / late (when it builds its
  // cells: raiders, the military and the fortress early, communes last), full (no room for one more: sell / kill /
  // release), unsold (a sale that finds no buyer), buyer (buys people: as labour, or to free them), share and mood
  // (labour: a worker's share per prisoner × their mood stand-in, prisoners.js moodWork's curve), eat (food a prisoner
  // eats a day: raiders feed theirs least), health and captiveMood (your people held and worked, a day: raiders
  // grimmest), escapeWork (× the cell's escape on worked days: out on the work detail they try more; was × a flat 1%
  // work rate, which put a raider's captive at 1.3% a day before Stealth). DFLT: an unknown type's.
  DFLT: { early: false, late: false, full: "release", unsold: null, buyer: null, share: 0.4, mood: 40, eat: 0.6, health: -0.3, captiveMood: -0.5, escapeWork: 1.1 },
  // Labour: food and scrap a worker-share brings in a day.
  WORK: { food: 1.1, scrap: 0.25 },
  // Your people held and worked: the health floor, the chance a day of dying once worn below dyingAt, × turning
  // (recruited) once their mood is below broken.
  CAPTIVE: { floor: 8, dyingAt: 12, death: 0.04, broken: 20, brokenTurn: 1.5, stealth: 0.001 },
  // Trades a day: chances, the price of one (value + perPower × power, in what the buyer can spare), relations.
  TRADE: { ransom: 0.04, exchange: 0.06, sale: 0.03, sellYours: 0.012, recruitDays: 30, recruit: 0.012, value: 15, perPower: 4, ransomRel: 3, exchangeRel: 2, enemySaleRel: -6, freeRel: 6, enemyRel: -15 },
  // Your person when nobody will buy them: their price to a buyer (value + perSkill × their best three skills), and the
  // days their captors keep them over their room for you to ransom them (ransom.js) before they kill or free them.
  YOURS: { value: 20, perSkill: 2, days: 6 },
  // The jail's guards while anyone is held (groupJailGuards): pop × perPop × the type's prisoners and patrol weights,
  // × hungry (food under 3 days a head) and × war, rounded; at most one more than held and max (the hardcore military: max).
  GUARDS: { perPop: 0.1, hungry: 0.7, war: 0.7, max: 4 },
  // Buying one of their own back (groupJailsDaily ransom; ransom.js groupMemberWorth, the same value rule as yours):
  // only when the person is worth the price to them and the pay leaves keepDays of food a head.
  RANSOM_KEEP_DAYS: 3,
};
const G = GROUP_JAIL;
// A type's jail habits (groupcare.js GROUP_PRIORITIES jail).
export const jailOf = (f) => weightOf(f, "jail", G.DFLT);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const first = (s) => String(s.name).split(" ")[0];

// ---------- jails ----------
// This world's groups keep their prisoners in jails (a new world sets state.groupJails); older saves: no limit.
export const jailsOn = (state) => !!state && !!state.groupJails;
export function jailsOf(state, f) {
  if (jailsOn(state) && !f.jails) f.jails = {};
  return f.jails || null;
}
// The jail tier at a group's base (0 none, 1 makeshift, 2 holding cells, 3 jailhouse). For the rescue raid's map too.
// state left out: a group with no jail record counts as built up (holding cells).
export function groupJailTier(f, tile, state = null) {
  if (!f) return 0;
  if (f.hcMilitary) return 3;
  const j = state ? jailsOf(state, f) : f.jails;
  if (!j) return 2;
  return j[tile] || 0;
}
export const groupJail = (f, tile, state = null) => JAIL_TIERS[groupJailTier(f, tile, state)] || null;
// The prisoners a group can hold (all its bases): Infinity in an older save.
export function groupJailCap(state, f) {
  if (!jailsOn(state)) return Infinity;
  return f.bases.reduce((a, t) => a + ((JAIL_TIERS[groupJailTier(f, t, state)] || { cap: 0 }).cap), 0);
}
// Your people they hold (not those still waiting on their fate: location.fresh) and other groups' people.
export const yoursHeldBy = (state, f) => allCaptives(state).filter((s) => s.location.factionId === f.id && !s.location.fresh);
export const groupPrisoners = (f) => f.prisoners || (f.prisoners = []);
export const groupHeld = (state, f) => groupPrisoners(f).length + yoursHeldBy(state, f).length;
export const groupRoom = (state, f) => Math.max(0, groupJailCap(state, f) - groupHeld(state, f));
// The jail a group keeps its prisoners in: its main base's (where your captives are taken: conflicts.js takeCaptive).
export const mainJailTier = (state, f) => Math.max(0, ...f.bases.map((t) => groupJailTier(f, t, state)));

// The next jail step a group would build (groupworks.js nextWork): { tile, type: "jail", why, def } or null.
// late: the pass after fields (communes build theirs only then).
export function jailWork(state, f, late = false) {
  if (!jailsOn(state) || !f.bases.length || f.hcMilitary) return null;
  if (!!jailOf(f).late !== late) return null;
  const tile = f.bases[0];
  const tier = groupJailTier(f, tile, state);
  if (tier >= 3) return null;
  const held = groupHeld(state, f), cap = groupJailCap(state, f);
  const step = (why) => ({ tile, type: "jail", why, def: G.STEPS[tier + 1] });
  if (tier === 0 && held > 0) return step("prisoners to hold");
  if (tier === 0 && (jailOf(f).early || atWar(state, f))) return step("expecting prisoners");
  if (tier > 0 && held >= cap && (tier < 2 || f.pop >= G.JAILHOUSE_POP)) return step("the jail is full");
  return null;
}
// A jail step finished (groupworks.js groupWorksDaily).
export function jailBuilt(state, f, tile) {
  const j = jailsOf(state, f);
  if (j) j[tile] = Math.min(3, (j[tile] || 0) + 1);
}

// ---------- labour ----------
const moodMult = (m) => { const L = PRISON.LABOUR; return clamp(L.moodBase + (L.moodPer * m) / 100, L.moodMin, L.moodMax); };
// Work a group gets from its prisoners today (worker-shares): each × the type's share × its mood stand-in.
export function groupLabour(state, f) {
  const n = groupHeld(state, f);
  return n * jailOf(f).share * moodMult(jailOf(f).mood);
}

// ---------- guards ----------
// The guards on a group's jail (GUARDS): none while it holds nobody.
export function groupJailGuards(state, f) {
  if (!f || !f.alive) return 0;
  const held = groupPrisoners(f).length + allCaptives(state).filter((s) => s.location.factionId === f.id).length; // yours just taken too
  if (!held) return 0;
  const U = G.GUARDS;
  if (f.hcMilitary) return U.max;
  const hungry = (f.stock && foodIn(f.stock) < f.pop * 3) ? U.hungry : 1;
  const n = Math.round(f.pop * U.perPop * weightOf(f, "prisoners") * weightOf(f, "patrol") * hungry * (atWar(state, f) ? U.war : 1));
  return clamp(n, 0, Math.min(U.max, held + 1));
}

// ---------- escapes ----------
// A group's prisoner (not yours): worked every day, in their jail (none: as a makeshift cage), by its guards: the cell
// rate or the work detail's (watched while the guards can watch them all), whichever is higher.
export function prisonerEscape(state, f, tile) {
  const J = groupJail(f, tile, state) || JAIL_TIERS[1]; // no jail of theirs there (held over their room): as a makeshift cage, the rescue map's too
  const n = groupJailGuards(state, f), Gs = groupGuardStrength(n);
  const watched = n * J.watch >= groupHeld(state, f);
  const work = Math.max(cellEscape(J, Gs), (watched ? PRISON.LABOUR.escapeGuarded * guardTighten(J, Gs) : PRISON.LABOUR.escapeUnguarded) * J.labour);
  return work * (jailOf(f).mood < PRISON.LABOUR.lowMood ? PRISON.LABOUR.lowMoodMult : 1);
}
// Your captive's chance a day (conflicts.js captivesDaily): the cell's escape by the jail's tier and guards (prisoners.js
// cellEscape), × on worked days (the type's share) jailOf escapeWork (raiders' prisoners try hardest), + their
// Stealth × the tier's bonus + a pin, lockpicks or the keys kept hidden (rescue: conflicts.js CAPTIVE_TOOL +0.5% / +1%
// / +1.5%, as in holding cells; × the tier's bonus over the cells': ×1.2 in makeshift cells, ×0.88 in a jailhouse),
// those two less with each guard past the first (guardTighten). Holding cells, raiders, Stealth 0: 3.7% a day with no
// guard, 0.49% with one, 0.15% with two, 0.07% with three (it was 1.3% with any number: a flat 1% work-detail rate).
export function captiveEscape(state, s, f) {
  const J = groupJail(f, s.location.tile, state) || JAIL_TIERS[1]; // no jail there: as a makeshift cage (rescueraid.js jailTier too)
  const share = jailOf(f).share;
  const Gs = groupGuardStrength(groupJailGuards(state, f));
  const worked = 1 + share * (jailOf(f).escapeWork - 1);
  const tool = (CAPTIVE_TOOL && CAPTIVE_TOOL[s.location.tool]) || 0;
  const extra = (skill(s, "stealth") * G.CAPTIVE.stealth * J.bonus + tool * (J.bonus / (JAIL_TIERS[2] ? JAIL_TIERS[2].bonus : 1.25))) * guardTighten(J, Gs);
  return cellEscape(J, Gs) * worked + extra;
}
// A day of being worked (conflicts.js captivesDaily): health and mood down by captor; true when it killed them.
export function captiveDecline(state, s, f) {
  const C = G.CAPTIVE;
  s.mood = Math.max(0, s.mood + jailOf(f).captiveMood);
  const dh = jailOf(f).health;
  if (dh < 0) s.health = Math.max(Math.min(s.health, C.floor), s.health + dh);
  if (s.health < C.dyingAt && dh < 0 && state.rng.chance(C.death)) {
    hurt(state, s, 999, null, `worked to death by ${f.name}`);
    state.stats.groupJail = state.stats.groupJail || {};
    state.stats.groupJail.workedToDeath = (state.stats.groupJail.workedToDeath || 0) + 1;
    return true;
  }
  return false;
}
// Turning: × this while broken (conflicts.js captivesDaily's recruit chance).
export const captiveTurnMult = (s) => (s.mood < G.CAPTIVE.broken ? G.CAPTIVE.brokenTurn : 1);

// ---------- taking prisoners ----------
const bump = (state, k, n = 1) => { const st = state.stats.groupJail || (state.stats.groupJail = {}); st[k] = (st[k] || 0) + n; };
// A group took n of victim's people (their head count already lowered by the caller): held while there is room,
// the rest by type (jailOf full): sold, killed or let go. Returns how many it holds; out.killed: how many it killed.
// Only people who are there are taken: a prisoner is always a person's record, never a head with nobody behind it
// (the caller's count of the rest stands as its losses).
export function groupCapture(state, captor, victim, n, out = null) {
  if (!captor || !victim || n <= 0) return 0;
  let held = 0;
  // The very people (members.js: the caller took them off the head count): stripped as yours are (conflicts.js
  // takeCaptive), their kit the captors' (arsenal.js keepItem).
  const people = Array.isArray(victim.people) || victim.pop > 0 ? captivesFrom(state, victim, n) : [];
  for (const s of people) {
    const rec = { id: newId(), from: victim.id, power: state.rng.int(2, 4), since: day(state) };
    if (!takeQuietly(state, victim, s)) continue;
    for (const it of stripAll(s)) keepItem(state, captor, it, "stolen");
    rec.s = s; rec.power = Math.max(1, Math.min(5, Math.round(fighterScore(s) / 4) || rec.power));
    if (groupRoom(state, captor) > 0) { groupPrisoners(captor).push(rec); held++; bump(state, "taken"); continue; }
    if (fullFate(state, captor, rec) && out) out.killed = (out.killed || 0) + 1;
  }
  return held;
}
// These very people of the victim's taken by the captor in a fight by the numbers (groupfight.js): out of the
// victim's list (members.js removeMember: off its head count), stripped as yours are (the kit the captor's), into the
// captor's jail as there is room, else its full-jail rule (fullFate). Returns those held.
export function capturePeople(state, captor, victim, people) {
  let held = 0;
  for (const s of people || []) {
    if (!s || s.alive === false || !removeMember(state, victim, s, "taken")) continue;
    for (const it of stripAll(s)) keepItem(state, captor, it, "stolen");
    s.location = { kind: "held" };
    const rec = { id: newId(), from: victim.id, power: Math.max(1, Math.min(5, Math.round(fighterScore(s) / 4) || 3)), since: day(state), s };
    if (Array.isArray(captor.bases) && groupRoom(state, captor) > 0) { groupPrisoners(captor).push(rec); held++; bump(state, "taken"); continue; }
    if (fullFate(state, captor, rec)) { s.alive = false; s.health = 0; }
  }
  return held;
}
// A prisoner of another group's out of a jail into group g's list (their own group, or captors they turned to): the
// very person (members.js homeAgain). Nobody is added by a number: a record with no living person behind it brings
// nobody home.
function goHome(state, g, rec) {
  if (!g || !rec || !rec.s || rec.s.alive === false) return false;
  const s = rec.s;
  rec.s = null;
  return homeAgain(state, g, s);
}
// The people of group fromId held in f's jail (records with the very person: the rescue jobs' captives, jobs.js).
export const heldFrom = (f, fromId) => (f ? groupPrisoners(f).filter((r) => r.from === fromId && r.s && r.s.alive !== false) : []);
// Out of f's jail and home to their own group g, as themselves (a rescue, a peace): those of g's held there, or only
// the ones whose ids are given. Returns the people who went home.
export function freeHeld(state, f, g, ids = null) {
  const out = [];
  if (!f || !g || !g.alive) return out;
  for (const rec of heldFrom(f, g.id)) {
    if (ids && !ids.includes(rec.s.id)) continue;
    const s = rec.s;
    f.prisoners.splice(f.prisoners.indexOf(rec), 1);
    if (goHome(state, g, rec)) out.push(s);
  }
  if (out.length) bump(state, "freed", out.length);
  return out;
}
// No room for one more of another group's people: true when they kill them.
function fullFate(state, f, rec) {
  const how = jailOf(f).full || "release";
  const from = factionById(state, rec.from);
  if (how === "sell" && sellTo(state, f, rec)) return false;
  if (how === "kill" || (how === "sell" && jailOf(f).unsold === "kill")) { if (rec.s) { rec.s.alive = false; rec.s.health = 0; } bump(state, "killedFull"); return true; }
  if (from && from.alive) { goHome(state, from, rec); changeRelation(state, f, from, 1); }
  bump(state, "releasedFull");
  return false;
}
// A save from nonlethal's head counts (f.held = { group id: n }): old saves need not load (docs/adr/0001-ai-parity.md),
// and a count is nobody: it is dropped, never turned into prisoners or people from nowhere.
export function migrateHeld(state) {
  for (const f of state.factions || []) if (f.held) delete f.held;
}
// A buyer for a prisoner of f's: a group with room that buys people (jailOf buyer), not the prisoner's own group, not at war
// with f, with something to pay.
function buyerFor(state, f, fromId, price) {
  // Labour buyers deal with anyone not their enemy; the military and the fortress buy people free from anyone.
  const list = state.factions.filter((o) => o.alive && o !== f && o.id !== fromId && jailOf(o).buyer && o.bases.length &&
    groupRoom(state, o) > 0 && !warBetween(state, f, o) && (jailOf(o).buyer === "free" || relation(state, f, o) > G.TRADE.enemyRel - 30) && payWith(o, price));
  if (!list.length) return null;
  return list.sort((a, b) => relation(state, f, b) - relation(state, f, a) || a.id - b.id)[0];
}
// What o can pay `value` with: { key, qty } or null.
function payWith(o, value) {
  for (const key of ["ammo", "food", "scrap", "meds", "fuel", "parts"]) {
    const qty = Math.ceil(value / (key === "food" ? DAY_VALUE : supValue(key))); // food: days of it (foods.js)
    if (available(o, key) >= qty) return { key, qty };
  }
  return null;
}
const priceOf = (rec) => G.TRADE.value + G.TRADE.perPower * (rec.power || 3);
// Returns what was paid as words for the news ("70 rounds of 9mm FMJ", "3 days of food", "12 scrap").
function pay(from, to, terms) {
  if (terms.key === "food") { addFoodsTo(to.stock, takeFood(from.stock, terms.qty).items); return `${terms.qty} days of food`; } // foods.js: days of food as the items they hold
  if (terms.key === "ammo") { // rounds.js: the very rounds, by calibre
    const keys = spendAmmo(from.stock, terms.qty).keys;
    for (const [k, n] of Object.entries(keys)) to.stock[k] = (to.stock[k] || 0) + n;
    return roundsText(keys);
  }
  from.stock[terms.key] = Math.max(0, (from.stock[terms.key] || 0) - terms.qty);
  to.stock[terms.key] = (to.stock[terms.key] || 0) + terms.qty;
  return `${terms.qty} ${terms.key}`;
}
// Sold on: to a buyer as labour (into its jail) or to the military to be freed. False: nobody buys.
function sellTo(state, f, rec) {
  const price = priceOf(rec);
  const buyer = buyerFor(state, f, rec.from, price);
  if (!buyer) return false;
  const terms = payWith(buyer, price);
  const paid = pay(buyer, f, terms);
  const from = factionById(state, rec.from);
  const list = groupPrisoners(f);
  if (list.includes(rec)) list.splice(list.indexOf(rec), 1);
  if (jailOf(buyer).buyer === "free") {
    if (from && from.alive) { goHome(state, from, rec); changeRelation(state, buyer, from, G.TRADE.freeRel); }
    bump(state, "boughtFree");
    news(state, `${cap(knownAs(state, buyer))} bought one of ${knownAs(state, from)}'s people from ${knownAs(state, f)} and set them free.`, "info", [buyer, f, from]);
    return true;
  }
  groupPrisoners(buyer).push({ ...rec, since: day(state) });
  if (from && from.alive && relation(state, buyer, from) <= G.TRADE.enemyRel) changeRelation(state, f, from, G.TRADE.enemySaleRel); // sold to their enemies
  bump(state, "sold");
  news(state, `${cap(knownAs(state, f))} sold a prisoner of ${knownAs(state, from)} to ${knownAs(state, buyer)} for ${paid}.`, "info", [buyer, f, from]);
  return true;
}
const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);

// ---------- your people: taken, and no room ----------
// Every hour (world.js): your people just taken (conflicts.js takeCaptive marks them fresh) are jailed where there is
// room; otherwise their captors deal with them by type (jailOf full) and a card tells you.
export function groupJailsHour(state) {
  if (state.resolving || !hub(state)) return;
  for (const s of allCaptives(state)) {
    if (!s.location.fresh) continue;
    const f = factionById(state, s.location.factionId);
    if (!f || !f.alive) { delete s.location.fresh; continue; }
    if (!jailsOn(state) || groupRoom(state, f) > 0) { delete s.location.fresh; continue; }
    noRoomForYours(state, s, f);
  }
}
function homeFree(state, s, f, title, text, kind = "good") {
  const h = hub(state);
  s.location = { kind: "base", baseId: h.id };
  s.role = "rest";
  log(state, text, kind);
  addCard(state, { title, text, choices: [{ label: "OK", resolve: () => "" }] });
}
function noRoomForYours(state, s, f) {
  const how = jailOf(f).full || "release";
  bump(state, "yoursFull");
  if (how === "release") {
    homeFree(state, s, f, `${f.name} let ${first(s)} go`, `${f.name} have nowhere to keep prisoners, so they let ${s.name} go. ${first(s)} is back at ${hub(state).name}.`);
    return;
  }
  if (how === "kill") {
    hurt(state, s, 999, null, `at the hands of ${f.name}, who had nowhere to keep them`);
    const text = `${f.name} had nowhere to keep ${s.name}. Word comes that they killed ${first(s)}.`;
    log(state, text, "death");
    addCard(state, { title: `${s.name} is dead`, text, choices: [{ label: "OK", resolve: () => "" }] });
    checkGameOver(state);
    return;
  }
  // Sell: to a group with room; else they keep them over their room for a few days (YOURS.days) for you to buy back
  // (ransom.js: Negotiate on the People tab, or the governor's ransom), tried again for a sale each day, and when the
  // days run out with no talks or deal under way raiders and expansionists kill them, traders let them go.
  const value = yoursValue(s);
  const buyer = buyerFor(state, f, null, value);
  if (buyer) { sellYours(state, s, f, buyer, value); return; }
  delete s.location.fresh;
  s.location.overflow = day(state) + G.YOURS.days;
  const fate = jailOf(f).unsold === "kill" ? `they will kill ${first(s)}` : `they will let ${first(s)} go`;
  const text = `${f.name} have no cell for ${s.name} and nobody will buy them. Buy ${first(s)} back within ${G.YOURS.days} days (ransom talks: Negotiate) or ${fate}.`;
  log(state, text, "danger");
  addCard(state, {
    title: `${f.name} have no cell for ${first(s)}`, kind: "groupOverflow", factionId: f.id, text,
    choices: [
      { label: "Negotiate", hint: "Ask their price (by radio, or an envoy rides out): ransom.js", ai: () => 0, resolve: (st) => openNegotiation(st, s.id) },
      { label: "OK", hint: "Decide later (the People tab's Negotiate)", ai: () => 1, resolve: () => "" },
    ],
  });
}
const yoursValue = (s) => G.YOURS.value + G.YOURS.perSkill * Object.values(s.skills || {}).sort((a, b) => b - a).slice(0, 3).reduce((a, v) => a + v, 0);
// Held over their room past the days given (noRoomForYours): no talks or deal with you under way: killed or let go.
function overflowDue(state, s, f) {
  if (s.location.overflow == null || day(state) < s.location.overflow) return false;
  if (groupRoom(state, f) > 0 || dealFor(state, f) || talksOf(state).some((t) => t.factionId === f.id)) { if (groupRoom(state, f) > 0) delete s.location.overflow; return false; }
  if (jailOf(f).unsold === "kill") {
    hurt(state, s, 999, null, `at the hands of ${f.name}: no ransom came`);
    const text = `No ransom came, and ${f.name} had no cell for ${s.name}. Word comes that they killed ${first(s)}.`;
    log(state, text, "death");
    addCard(state, { title: `${s.name} is dead`, text, choices: [{ label: "OK", resolve: () => "" }] });
    bump(state, "yoursKilled");
    checkGameOver(state);
  } else {
    homeFree(state, s, f, `${f.name} let ${first(s)} go`, `${f.name} had no cell for ${s.name} and let them go. ${first(s)} is back at ${hub(state).name}.`);
    bump(state, "yoursReleased");
  }
  return true;
}
// Your captive sold on to another group: their factionId and tile change (rescue missions follow), and a card.
function sellYours(state, s, f, buyer, value) {
  const terms = payWith(buyer, value);
  const paid = terms ? pay(buyer, f, terms) : "";
  const tile = buyer.bases[0];
  s.location = { ...s.location, kind: "captive", factionId: buyer.id, tile, soldDay: day(state) }; // a hidden tool (rescue) goes with them
  delete s.location.fresh; delete s.location.overflow;
  if (jailOf(buyer).buyer === "free") {
    bump(state, "yoursFreed");
    homeFree(state, s, buyer, `${buyer.name} free ${first(s)}`, `${buyer.name} bought ${s.name} from ${f.name} and set them free. ${first(s)} is back at ${hub(state).name}.`);
    return;
  }
  bump(state, "yoursSold");
  const text = `${s.name} was sold to ${buyer.name} at ${tileLabel(state, tile)}${paid ? ` for ${paid}` : ""}.`;
  log(state, text, "danger");
  addCard(state, { title: `${first(s)} was sold`, text: `${text} A rescue or a ransom now has to go there.`, choices: [{ label: "OK", resolve: () => "" }] });
  news(state, `${cap(knownAs(state, f))} sold one of your people to ${knownAs(state, buyer)}.`, "danger", [f, buyer]);
}

// ---------- every day ----------
// After the groups' own day (world.js, before conflicts.js captivesDaily): their prisoners work, escape, are bought
// back, swapped, sold or turned; your people can be sold on.
export function groupJailsDaily(state) {
  const T = G.TRADE, rng = state.rng;
  migrateHeld(state); // nonlethal.js head counts from an older save
  for (const f of state.factions) {
    if (!f.alive) continue;
    const list = groupPrisoners(f);
    const yours = yoursHeldBy(state, f);
    if (!list.length && !yours.length) { f.prisonWork = 0; continue; }
    // Labour: food and scrap, and their building (groupworks.js reads f.prisonWork).
    const work = groupLabour(state, f);
    f.prisonWork = Math.round(work * 100) / 100;
    const eat = (list.length + yours.length) * jailOf(f).eat;
    { const net = work * G.WORK.food - eat; if (net > 0) giveFood(state, f, net, "fields"); else if (net < 0) takeFood(f.stock, -net, { state }); } // foods.js: the prisoners' field work, their meals
    f.stock.scrap = (f.stock.scrap || 0) + work * G.WORK.scrap;
    for (const rec of [...list]) {
      if (!list.includes(rec)) continue;
      const from = factionById(state, rec.from);
      // Escape: by their jail (all of them are worked).
      if (rng.chance(prisonerEscape(state, f, f.bases[0]))) { list.splice(list.indexOf(rec), 1); if (from && from.alive) goHome(state, from, rec); bump(state, "escaped"); continue; }
      // Ransom back: their own group buys them, not at war.
      if (from && from.alive && !warBetween(state, f, from) && rng.chance(T.ransom)) {
        const terms = payWith(from, priceOf(rec));
        // The value rule (ransom.js groupMemberWorth, as yours): worth the price to them, and not out of their last days of food.
        if (terms && groupMemberWorth(from, rec.power) >= priceOf(rec) && (terms.key !== "food" || foodIn(from.stock) - terms.qty >= from.pop * G.RANSOM_KEEP_DAYS)) {
          const paid = pay(from, f, terms);
          list.splice(list.indexOf(rec), 1);
          goHome(state, from, rec);
          changeRelation(state, f, from, T.ransomRel);
          bump(state, "ransomed");
          if (f.known || from.known) news(state, `${cap(knownAs(state, from))} paid ${paid} to ${knownAs(state, f)} for one of their people.`, "info", [f, from]);
          continue;
        }
      }
      // Exchange: their group holds one of f's people too: one for one.
      if (from && from.alive && rng.chance(T.exchange)) {
        const back = groupPrisoners(from).find((x) => x.from === f.id);
        if (back) {
          list.splice(list.indexOf(rec), 1);
          groupPrisoners(from).splice(groupPrisoners(from).indexOf(back), 1);
          goHome(state, from, rec);
          goHome(state, f, back);
          changeRelation(state, f, from, T.exchangeRel);
          bump(state, "exchanged");
          if (f.known || from.known) news(state, `${cap(knownAs(state, f))} and ${knownAs(state, from)} swapped prisoners, one for one.`, "info", [f, from]);
          continue;
        }
      }
      // Sale: raiders and their like sell people as labour (or to the military, who free them).
      if (jailOf(f).full === "sell" && rec.since !== day(state) && rng.chance(T.sale) && sellTo(state, f, rec)) continue; // not one bought today
      // Turned: held long, one joins them.
      if (day(state) - rec.since >= T.recruitDays && rng.chance(T.recruit * weightOf(f, "recruit"))) { list.splice(list.indexOf(rec), 1); goHome(state, f, rec); bump(state, "turned"); } // groupcare.js GROUP_PRIORITIES recruit
    }
    // Your people sold on (raiders and the like), where someone has room: held over their room (overflow), a buyer is
    // looked for every day, and the days for a ransom run out (overflowDue).
    for (const s of yours) {
      if (s.location.overflow != null && overflowDue(state, s, f)) continue;
      if (jailOf(f).full !== "sell" || s.location.soldDay === day(state) || !(s.location.overflow != null || rng.chance(T.sellYours))) continue; // not one bought today
      const value = yoursValue(s);
      const buyer = buyerFor(state, f, null, value);
      if (buyer) sellYours(state, s, f, buyer, value);
    }
  }
}

// A group collapses (factions.js collapseFaction): the other groups' people it held walk home.
export function freeOnCollapse(state, f) {
  for (const rec of f.prisoners || []) { const from = factionById(state, rec.from); if (from && from.alive) goHome(state, from, rec); }
  f.prisoners = [];
}

// ---------- for the UI (ui/diplomacy.js) ----------
// "holds 3 prisoners (jailhouse)" when you know it: a prisoner of theirs told you (questioning), or you have seen
// their main base (a scout's snapshot of it). "" otherwise, or in an older save.
export function jailText(state, f) {
  if (!jailsOn(state) || !f.alive || !f.bases.length) return "";
  const known = !!f.intel || !!(state.knowledge && state.knowledge[f.bases[0]] && state.knowledge[f.bases[0]].factionBase === f.id);
  if (!known) return "";
  const J = JAIL_TIERS[mainJailTier(state, f)];
  const n = groupHeld(state, f);
  const yours = yoursHeldBy(state, f).length;
  const g = groupJailGuards(state, f);
  return `${J ? J.name.toLowerCase() : "no jail"}${n ? `, holds ${n} prisoner${n === 1 ? "" : "s"}${yours ? ` (${yours} of yours)` : ""}, ${g ? `${g} guard${g === 1 ? "" : "s"} on it` : "nobody guards it"}` : ", nobody held"}`;
}
