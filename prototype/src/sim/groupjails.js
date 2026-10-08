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
//   (f.prisoners: { id, from: a group id, power, since }). Both count against the room (groupRoom). Groups take
//   prisoners from each other in raids they win (factions.js resolveRaidOnFaction: groupCapture; war raids keep their
//   own head count, diplomacy.js w.captives).
// - No room (FULL, by type): raiders, expansionists and traders sell the extra one to a group with room (your people:
//   a ransom asked of you at once if nobody buys; raiders kill on a refusal, traders let them go), the military, the
//   fortress and communes let them go, zealots kill them. Your captive's fate comes on a card.
// - Labour (WORK): every prisoner works for them, a share of a worker by type (raiders lean hardest) × a stand-in for
//   their mood (raiders treat theirs worst: low output, but they feed them little): food and scrap a day, and their
//   building goes faster (f.prisonWork, groupworks.js). Your people held are worked too: health and mood fall a day by
//   captor (CAPTIVE; raiders grimmest), the broken die of it, and escapes and turning follow (conflicts.js captivesDaily).
// - Escapes (captiveEscape, prisonerEscape): the jail's tier as for yours: cell rate on idle days, the work detail's
//   (× the tier's labour) on worked days, a captive's Stealth × the tier's bonus.
// - Trades a day (TRADE): ransom back (their own group buys them, not at war, with what it can spare), exchange (two
//   groups each holding the other's swap one for one), sale (raiders sell people as labour to raiders and
//   expansionists; the military and the fortress buy only to free them, which their group remembers), recruitment
//   (held long, one may join their captors). Relations between the groups move with it (diplomacy.js), and notable
//   trades go out as radio news. Your captives can be sold on too: a card says where they are now (their factionId
//   and tile change, so rescue missions follow).
// - groupJailTier(f, tile, state): the rescue raid's base map (a chain-link cage, barred cells or a jailhouse block:
//   prisoners.js JAIL block).
import { day, log, addCard, factionById, hub, skill, hurt, newId, checkGameOver } from "./world.js";
import { SUPPLIES } from "./data.js";
import { JAIL_TIERS, PRISON } from "./prisoners.js";
import { allCaptives } from "./conflicts.js";
import { changeRelation, relation, warBetween, atWar, news, knownAs } from "./diplomacy.js";
import { available } from "./trade.js";
import { tileLabel } from "./parties.js";

export const GROUP_JAIL = {
  // The step up to each tier (groupworks.js job "jail"): what it costs and crew-days of work.
  STEPS: [null, { name: "makeshift cells", cost: { scrap: 3 }, work: 2 }, { name: "holding cells", cost: { scrap: 6, parts: 1 }, work: 4 }, { name: "a jailhouse", cost: { scrap: 12, parts: 2 }, work: 7 }],
  EARLY: ["raider", "military", "fortress"], LATE: ["commune"], JAILHOUSE_POP: 15,
  // No room for one more: what they do (sell / kill / release).
  FULL: { raider: "sell", expansionist: "sell", traders: "sell", zealot: "kill", military: "release", fortress: "release", commune: "release" },
  // Who buys people: as labour, or to free them.
  BUYERS: { raider: "labour", expansionist: "labour", military: "free", fortress: "free" },
  // Labour: a worker's share per prisoner by type, × their mood stand-in (prisoners.js moodWork's curve); food and scrap
  // a worker-share brings in a day; food a prisoner eats (raiders feed theirs least).
  WORK: {
    share: { raider: 0.9, expansionist: 0.6, zealot: 0.5, traders: 0.4, fortress: 0.5, military: 0.4, commune: 0.3 },
    mood: { raider: 15, expansionist: 30, zealot: 25, traders: 40, fortress: 45, military: 50, commune: 60 },
    food: 1.1, scrap: 0.25, eat: { raider: 0.3, other: 0.6 },
  },
  // Your people held and worked: health and mood a day (raiders grimmest), the chance a day of dying once worn below
  // dyingAt, × their work-detail escapes, × turning (recruited) once their mood is below broken.
  CAPTIVE: {
    health: { raider: -1.2, expansionist: -0.6, zealot: -0.8, traders: -0.3, fortress: -0.2, military: -0.1, commune: 0 },
    mood: { raider: -2, other: -0.5 }, floor: 8, dyingAt: 12, death: 0.04,
    escapeWork: { raider: 1.4, other: 1.1 }, broken: 20, brokenTurn: 1.5, stealth: 0.001,
  },
  // Trades a day: chances, the price of one (value + perPower × power, in what the buyer can spare), relations.
  TRADE: { ransom: 0.04, exchange: 0.06, sale: 0.03, sellYours: 0.012, recruitDays: 30, recruit: 0.012, value: 15, perPower: 4, ransomRel: 3, exchangeRel: 2, enemySaleRel: -6, freeRel: 6, enemyRel: -15 },
  // Your person when nobody will buy them: the ransom asked of you (value + perSkill × their best three skills).
  YOURS: { value: 20, perSkill: 2 },
  RAID_TAKE: 2, // the most prisoners a group takes from a raid it wins (factions.js)
};
const G = GROUP_JAIL;
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
  if (G.LATE.includes(f.type) !== late) return null;
  const tile = f.bases[0];
  const tier = groupJailTier(f, tile, state);
  if (tier >= 3) return null;
  const held = groupHeld(state, f), cap = groupJailCap(state, f);
  const step = (why) => ({ tile, type: "jail", why, def: G.STEPS[tier + 1] });
  if (tier === 0 && held > 0) return step("prisoners to hold");
  if (tier === 0 && (G.EARLY.includes(f.type) || atWar(state, f))) return step("expecting prisoners");
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
  return n * (G.WORK.share[f.type] ?? 0.4) * moodMult(G.WORK.mood[f.type] ?? 40);
}

// ---------- escapes ----------
// A group's prisoner (not yours): worked every day, in their jail (none: the shed's rate).
export function prisonerEscape(state, f, tile) {
  const J = groupJail(f, tile, state) || { guarded: PRISON.ESCAPE.shed, labour: 1.5, bonus: 1.5 };
  const work = Math.max(J.guarded, PRISON.LABOUR.escapeGuarded * J.labour);
  return work * (G.WORK.mood[f.type] < PRISON.LABOUR.lowMood ? PRISON.LABOUR.lowMoodMult : 1);
}
// Your captive's chance a day (conflicts.js captivesDaily): idle days at the cell rate, worked days (the type's share)
// at the work detail's (× the tier's labour, × CAPTIVE escapeWork: raiders' prisoners try hardest), and their Stealth
// × the tier's bonus. Old saves (holding cells): about 1% a day, the old flat rate was 0.5% + Stealth.
export function captiveEscape(state, s, f) {
  const J = groupJail(f, s.location.tile, state) || { guarded: PRISON.ESCAPE.shed, labour: 1.5, bonus: 1.5 };
  const share = G.WORK.share[f.type] ?? 0.4;
  const work = Math.max(J.guarded, PRISON.LABOUR.escapeGuarded * J.labour) * (G.CAPTIVE.escapeWork[f.type] || G.CAPTIVE.escapeWork.other);
  return share * work + (1 - share) * J.guarded + skill(s, "stealth") * G.CAPTIVE.stealth * J.bonus;
}
// A day of being worked (conflicts.js captivesDaily): health and mood down by captor; true when it killed them.
export function captiveDecline(state, s, f) {
  const C = G.CAPTIVE;
  s.mood = Math.max(0, s.mood + (C.mood[f.type] ?? C.mood.other));
  const dh = C.health[f.type] ?? -0.3;
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
// the rest by type (FULL): sold, killed or let go.
export function groupCapture(state, captor, victim, n) {
  if (!captor || !victim || n <= 0) return 0;
  let held = 0;
  for (let i = 0; i < n; i++) {
    const rec = { id: newId(), from: victim.id, power: state.rng.int(2, 4), since: day(state) };
    if (groupRoom(state, captor) > 0) { groupPrisoners(captor).push(rec); held++; bump(state, "taken"); continue; }
    fullFate(state, captor, rec);
  }
  return held;
}
// No room for one more of another group's people.
function fullFate(state, f, rec) {
  const how = G.FULL[f.type] || "release";
  const from = factionById(state, rec.from);
  if (how === "sell" && sellTo(state, f, rec)) return;
  if (how === "kill") { bump(state, "killedFull"); return; }
  if (from && from.alive) { from.pop += 1; changeRelation(state, f, from, 1); }
  bump(state, "releasedFull");
}
// A buyer for a prisoner of f's: a group with room that buys people (BUYERS), not the prisoner's own group, not at war
// with f, with something to pay.
function buyerFor(state, f, fromId, price) {
  const list = state.factions.filter((o) => o.alive && o !== f && o.id !== fromId && G.BUYERS[o.type] && o.bases.length &&
    groupRoom(state, o) > 0 && !warBetween(state, f, o) && relation(state, f, o) > G.TRADE.enemyRel - 30 && payWith(o, price));
  if (!list.length) return null;
  return list.sort((a, b) => relation(state, f, b) - relation(state, f, a) || a.id - b.id)[0];
}
// What o can pay `value` with: { key, qty } or null.
function payWith(o, value) {
  for (const key of ["ammo", "food", "scrap", "meds", "fuel", "parts"]) {
    const qty = Math.ceil(value / SUPPLIES[key].value);
    if (available(o, key) >= qty) return { key, qty };
  }
  return null;
}
const priceOf = (rec) => G.TRADE.value + G.TRADE.perPower * (rec.power || 3);
function pay(from, to, terms) {
  from.stock[terms.key] = Math.max(0, (from.stock[terms.key] || 0) - terms.qty);
  to.stock[terms.key] = (to.stock[terms.key] || 0) + terms.qty;
}
// Sold on: to a buyer as labour (into its jail) or to the military to be freed. False: nobody buys.
function sellTo(state, f, rec) {
  const price = priceOf(rec);
  const buyer = buyerFor(state, f, rec.from, price);
  if (!buyer) return false;
  const terms = payWith(buyer, price);
  pay(buyer, f, terms);
  const from = factionById(state, rec.from);
  const list = groupPrisoners(f);
  if (list.includes(rec)) list.splice(list.indexOf(rec), 1);
  if (G.BUYERS[buyer.type] === "free") {
    if (from && from.alive) { from.pop += 1; changeRelation(state, buyer, from, G.TRADE.freeRel); }
    bump(state, "boughtFree");
    news(state, `${cap(knownAs(state, buyer))} bought one of ${knownAs(state, from)}'s people from ${knownAs(state, f)} and set them free.`, "info", [buyer, f, from]);
    return true;
  }
  groupPrisoners(buyer).push({ ...rec, since: day(state) });
  if (from && from.alive && relation(state, buyer, from) <= G.TRADE.enemyRel) changeRelation(state, f, from, G.TRADE.enemySaleRel); // sold to their enemies
  bump(state, "sold");
  news(state, `${cap(knownAs(state, f))} sold a prisoner of ${knownAs(state, from)} to ${knownAs(state, buyer)} for ${terms.qty} ${terms.key}.`, "info", [buyer, f, from]);
  return true;
}
const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);

// ---------- your people: taken, and no room ----------
// Every hour (world.js): your people just taken (conflicts.js takeCaptive marks them fresh) are jailed where there is
// room; otherwise their captors deal with them by type (FULL) and a card tells you.
export function groupJailsHour(state) {
  if (state.resolving || !hub(state)) return;
  for (const s of allCaptives(state)) {
    if (!s.location.fresh || s.location.ransomAsked) continue;
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
  const how = G.FULL[f.type] || "release";
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
  // Sell: to a group with room, else a ransom asked of you at once.
  const value = G.YOURS.value + G.YOURS.perSkill * Object.values(s.skills || {}).sort((a, b) => b - a).slice(0, 3).reduce((a, v) => a + v, 0);
  const buyer = buyerFor(state, f, null, value);
  if (buyer) { sellYours(state, s, f, buyer, value); return; }
  s.location.ransomAsked = true;
  addCard(state, ransomCard(state, s, f, value));
}
// The ransom asked at once for your captive (no room, nobody buys): what the hub can best pay with.
export function yoursRansom(state, value) {
  const h = hub(state);
  if (!h) return null;
  let best = null;
  for (const key of ["ammo", "food", "scrap", "meds", "fuel", "parts"]) {
    const qty = Math.ceil(value / SUPPLIES[key].value);
    const cover = (h.stock[key] || 0) / qty;
    if (!best || cover > best.cover) best = { key, qty, cover };
  }
  return best;
}
function ransomCard(state, s, f, value) {
  const t = yoursRansom(state, value);
  const refuse = f.type === "raider" ? `they kill ${first(s)}` : `they let ${first(s)} go anyway`;
  const live = (st) => st.survivors.includes(s) && s.alive && s.location.kind === "captive" && s.location.factionId === f.id;
  return {
    title: `${f.name} want a ransom for ${first(s)}`, kind: "groupRansom",
    text: `${f.name} have no room to keep ${s.name} and nobody will buy them. They ask ${t.qty} ${t.key} from ${hub(state).name}, now. Refuse and ${refuse}.`,
    choices: [
      { label: `Pay ${t.qty} ${t.key}`, hint: `From ${hub(state).name}'s stores (${Math.floor(hub(state).stock[t.key] || 0)} there).`,
        ai: (st) => ((hub(st).stock[t.key] || 0) >= t.qty ? 3 : -1),
        resolve: (st) => {
          if (!live(st)) return "Too late.";
          const h = hub(st);
          if ((h.stock[t.key] || 0) < t.qty) return `${h.name} has only ${Math.floor(h.stock[t.key] || 0)} ${t.key}.`;
          h.stock[t.key] -= t.qty;
          f.stock[t.key] = (f.stock[t.key] || 0) + t.qty;
          bump(st, "yoursRansomed");
          homeFree(st, s, f, `${first(s)} is home`, `You paid ${t.qty} ${t.key} to ${f.name}, and ${s.name} walked home to ${h.name}.`);
          return "";
        } },
      { label: "Refuse", hint: `Pay nothing: ${refuse}.`, ai: () => 0,
        resolve: (st) => {
          if (!live(st)) return "Too late.";
          if (f.type === "raider") {
            hurt(st, s, 999, null, `at the hands of ${f.name}: the ransom was refused`);
            log(st, `${f.name} killed ${s.name} when no ransom came.`, "death");
            checkGameOver(st);
            return `${s.name} is dead.`;
          }
          homeFree(st, s, f, `${f.name} let ${first(s)} go`, `${f.name} let ${s.name} go when no ransom came. ${first(s)} is back at ${hub(st).name}.`);
          return "";
        } },
    ],
  };
}
// Your captive sold on to another group: their factionId and tile change (rescue missions follow), and a card.
function sellYours(state, s, f, buyer, value) {
  const terms = payWith(buyer, value);
  if (terms) pay(buyer, f, terms);
  const tile = buyer.bases[0];
  s.location = { kind: "captive", factionId: buyer.id, tile, since: s.location.since };
  if (G.BUYERS[buyer.type] === "free") {
    bump(state, "yoursFreed");
    homeFree(state, s, buyer, `${buyer.name} free ${first(s)}`, `${buyer.name} bought ${s.name} from ${f.name} and set them free. ${first(s)} is back at ${hub(state).name}.`);
    return;
  }
  bump(state, "yoursSold");
  const text = `${s.name} was sold to ${buyer.name} at ${tileLabel(state, tile)}${terms ? ` for ${terms.qty} ${terms.key}` : ""}.`;
  log(state, text, "danger");
  addCard(state, { title: `${first(s)} was sold`, text: `${text} A rescue or a ransom now has to go there.`, choices: [{ label: "OK", resolve: () => "" }] });
  news(state, `${cap(knownAs(state, f))} sold one of your people to ${knownAs(state, buyer)}.`, "danger", [f, buyer]);
}

// ---------- every day ----------
// After the groups' own day (world.js, before conflicts.js captivesDaily): their prisoners work, escape, are bought
// back, swapped, sold or turned; your people can be sold on.
export function groupJailsDaily(state) {
  const T = G.TRADE, rng = state.rng;
  for (const f of state.factions) {
    if (!f.alive) continue;
    const list = groupPrisoners(f);
    const yours = yoursHeldBy(state, f);
    if (!list.length && !yours.length) { f.prisonWork = 0; continue; }
    // Labour: food and scrap, and their building (groupworks.js reads f.prisonWork).
    const work = groupLabour(state, f);
    f.prisonWork = Math.round(work * 100) / 100;
    const eat = (list.length + yours.length) * (f.type === "raider" ? G.WORK.eat.raider : G.WORK.eat.other);
    f.stock.food = Math.max(0, (f.stock.food || 0) + work * G.WORK.food - eat);
    f.stock.scrap = (f.stock.scrap || 0) + work * G.WORK.scrap;
    for (const rec of [...list]) {
      if (!list.includes(rec)) continue;
      const from = factionById(state, rec.from);
      // Escape: by their jail (all of them are worked).
      if (rng.chance(prisonerEscape(state, f, f.bases[0]))) { list.splice(list.indexOf(rec), 1); if (from && from.alive) from.pop += 1; bump(state, "escaped"); continue; }
      // Ransom back: their own group buys them, not at war.
      if (from && from.alive && !warBetween(state, f, from) && rng.chance(T.ransom)) {
        const terms = payWith(from, priceOf(rec));
        if (terms) {
          pay(from, f, terms);
          list.splice(list.indexOf(rec), 1);
          from.pop += 1;
          changeRelation(state, f, from, T.ransomRel);
          bump(state, "ransomed");
          if (f.known || from.known) news(state, `${cap(knownAs(state, from))} paid ${terms.qty} ${terms.key} to ${knownAs(state, f)} for one of their people.`, "info", [f, from]);
          continue;
        }
      }
      // Exchange: their group holds one of f's people too: one for one.
      if (from && from.alive && rng.chance(T.exchange)) {
        const back = groupPrisoners(from).find((x) => x.from === f.id);
        if (back) {
          list.splice(list.indexOf(rec), 1);
          groupPrisoners(from).splice(groupPrisoners(from).indexOf(back), 1);
          from.pop += 1;
          f.pop += 1;
          changeRelation(state, f, from, T.exchangeRel);
          bump(state, "exchanged");
          if (f.known || from.known) news(state, `${cap(knownAs(state, f))} and ${knownAs(state, from)} swapped prisoners, one for one.`, "info", [f, from]);
          continue;
        }
      }
      // Sale: raiders and their like sell people as labour (or to the military, who free them).
      if (G.FULL[f.type] === "sell" && rng.chance(T.sale) && sellTo(state, f, rec)) continue;
      // Turned: held long, one joins them.
      if (day(state) - rec.since >= T.recruitDays && rng.chance(T.recruit)) { list.splice(list.indexOf(rec), 1); f.pop += 1; bump(state, "turned"); }
    }
    // Your people sold on (raiders and the like), where someone has room.
    if (G.FULL[f.type] === "sell") {
      for (const s of yours) {
        if (!rng.chance(T.sellYours)) continue;
        const value = G.YOURS.value + G.YOURS.perSkill * Object.values(s.skills || {}).sort((a, b) => b - a).slice(0, 3).reduce((a, v) => a + v, 0);
        const buyer = buyerFor(state, f, null, value);
        if (buyer) sellYours(state, s, f, buyer, value);
      }
    }
  }
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
  return `${J ? J.name.toLowerCase() : "no jail"}${n ? `, holds ${n} prisoner${n === 1 ? "" : "s"}${yours ? ` (${yours} of yours)` : ""}` : ", nobody held"}`;
}
