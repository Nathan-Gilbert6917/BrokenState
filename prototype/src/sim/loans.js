// Volunteers lent to your bases, and joint operations (the user's request 2026-10-21: "You can send envoys or if you
// have radios a request for volunteers to be added to one of your bases as people temporally and can be used for work
// at the base or added to a team or joint operations to coordinate fighting hives doing city/town crawls, fighting
// another group or horde or just help raiding POIs"). Asked through envoys.js (by envoy, or at once by radio);
// volunteers.js is the lending itself (its points, its people model, its volunteers on a team).
//
// Volunteers to a base (KINDS.volunteers: base, how many, how long, a purpose, an offer of goods or a favour owed)
// - They decide by volunteers.js askQuote's points (goodwill, the coalition, a pact, jobs done, how many and how long,
//   their own war or a horde near them, short-handed, their dead with you lately, the offer, a favour), plus
//   LOAN.TYPE by their kind, the purpose's danger (LOAN.PURPOSE) and a member's standing beyond its goodwill
//   (coalition.js). Points ≥ 0: yes. A member's answer goes on coalition.js's record (noteTheirAnswer).
// - Yes: their very people walk to the base as a party of the group (kind "loan", on the map), by the AI parties' rules
//   (docs/adr/0001-ai-parity.md, the user's rule 2026-10-22): its people stay the group's members out with the party
//   (members.js partyId) with road rations out of the group's stock (eating.js PACK.food a head, eaten on the road:
//   factions.js), so a horde or an ambush on the road kills them by name (groupfight.js fightersOf the party) and
//   caravanraids.js robs it like a caravan. Lost on the way, they never come.
// - At the base they leave their group's list (members.js removeMember: f.pop without them) and are survivor records
//   in state.survivors with s.loan { fid, group, id, until, purpose }: one of yours in every way while here (the user's
//   rule 2026-10-22: "Loaned people count as a survivor in your base in all ways including eating, drinking, sleeping
//   ammo supply etc"): they eat and drink from its stores, sleep in its beds, take work roles, draw rounds and supplies,
//   go out on teams and fight on your orders, and the base may issue them its gear. The offer is paid when they arrive.
// - Their own kit: everything they arrived with is marked theirs (it.loanOwn = their id). It stays on them: nothing
//   moves it off (inventory.js moveItem), a team home does not unpack it (parties.js unloadAt), the governor's and the
//   roster's hand-outs never swap it out (equip.js, bulk.js, tripgear.js, carrykit.js, autopilot.js), no trade sells
//   it (trade.js), and a piece that still ends up in an armory or a team's cargo goes back onto them (ownKitHour).
//   Anything the base puts on them is the base's: when they leave (endLoan, returnBaseKit) it goes back into the
//   stores or the armory of the base they leave (a team's cargo when they leave a team), their packed rations too, and
//   they take home only what they came with.
// - The loan ends when its days are up, or they are recalled: their group hostile or under VOL.GW_LEAVE goodwill, at
//   war with you, at war itself or a horde near its base. They leave the base (or the team, once it is out of a fight),
//   members of their group again, and walk home as a party (rations from the base they leave) to a base of their
//   choosing (baseOfChoice: the nearest, else one under threat or short of hands). Home well (health LOAN.WELL_HP+
//   each): +LOAN.WELL standing.
// - Killed while on loan (world.js killSurvivor → loanFell): their group's standing falls by how: on a mission of the
//   purpose they came for LOAN.DEATH.op, in a fight LOAN.DEATH.fight, any other way (hunger, sickness, accidents)
//   LOAN.DEATH.other; they count in askQuote's "their dead with you lately". Their group mourns, not your memorial wall;
//   at a base their own kit goes home to their group, the base's stays.
// - Asking to stay (stayDaily, LOAN.STAY): each day each of them may come to want to stay with you for good, more by
//   their mood, their bonds with your people (bonds.js), the days with you and their group's trouble at home (a war, a
//   horde, hunger), less hurt. A card "<name> wants to stay with you" (one per group, for everyone of it who wants to):
//   - "Send a request to <group> to keep them" (only while someone wants to stay, and they have not said no): by radio,
//     else by envoy (envoys.js KINDS.keep). They decide by standing and their kind (keepAnswer). Yes: they are yours,
//     with no hit at standing KEEP.freeAt+, else a small one; no: they go home at the loan's end, unless you keep them
//     anyway (the card again: a bigger hit, a recall likelier).
//   - "Just let them join": dice by standing and kind: no reaction, a standing hit, or the hit and a recall of all
//     their other people on loan.
//   - "Send them home at the loan's end".
//   Those who join are ordinary survivors of yours (s.loan gone, the marks off their kit, s.joinedFrom); their group's
//   count already went down when they came (members.js removeMember).
//
// Joint operations (KINDS.jointop: a hive (assault or crawl), a city or town crawl, an assault on a group's base, a
// horde, a POI raid; a rendezvous tile and day, a share of the loot, how many they send)
// - Each group decides by the same points with the operation's danger (volunteers.js VOL.DANGER) and the share
//   (VOL.SHARE.points × share). Yes: a party of their people (kind "opparty", members out with it, road rations, as a
//   loan's) sets out for the rendezvous and waits there up to LOAN.WAIT days past the day.
// - Your team at the rendezvous on or after the day: every party waiting there joins it as volunteers (volunteers.js:
//   their group's AI moves them on the battle map, they take a simple order, they crawl a hive or a city with your
//   people, they count by the numbers; their days are the operation's), a party coming late joins while the team is
//   still there; one that never comes (killed on the way) is missed and the operation goes on with whoever came.
// - After (the user's rule 2026-10-22: "Joint operation allies need to be formed into a team and move back to a base of
//   their choosing"): they leave the team together as a party of their group (opTeamHome, kind "opparty" phase
//   "back") with what they carry, rations from the team and their loot share (volunteers.js settleShare into the
//   party's goods: robbed with it on the road), and walk to the base they choose (baseOfChoice). Each group that came
//   gets "Fought beside us" (coalition.js remember, kind "fight"); paying much less of the share than was due costs
//   standing (reneged). Nobody of yours at the rendezvous within the wait: their parties go home and you lose
//   LOAN.NOSHOW standing.
// - The groups propose joint operations too (aiProposalsDaily: a member or a friend with a hive or a big horde near its
//   land, now and then): a card by radio, or by their envoy (envoys.js "propose"); your answer goes back the same way,
//   and their party sets out once they have it.
// Dice: hash01 (the proposals, wanting to stay, how they take it), never the world's.
import { day, log, hub, baseById, factionById, newId, combatPower, addCard, survivorById } from "./world.js";
import { attitude, changeGoodwill } from "./factions.js";
import { planPath, partyTile, removeParty, tileLabel, partyMembers } from "./parties.js";
import { hash01 } from "./skills.js";
import { VOL, askQuote, groupTrouble, ensureVols } from "./volunteers.js";
import { syncMembers, fitAtHome, removeMember, addMember, partyPeople, membersOf, membersAt } from "./members.js";
import { allCarried, carriedSpots, stow, ensureInv, isCarrier, insertsOf, EQUIP_SLOTS, ownKit } from "./inventory.js";
import { putBack, isHeldSupply } from "./supitems.js";
import { addToArsenal } from "./arsenal.js";
import { isRoundItem } from "./itemstack.js";
import { isMember } from "./alliance.js";
import { standing, remember, noteAnswer } from "./coalition.js";
import { atWarWithYou } from "./playerwars.js";
import { supplyAmt, useSupply } from "./rounds.js";
import { moveFoodUnits, takeFood, foodIn, stockOf } from "./foods.js";
import { PACK } from "./eating.js";
import { payAmmoKeys } from "./ammo.js";
import { SUPPLIES, GEAR } from "./data.js";
import { relationsOf } from "./relations.js";
import { levelOf } from "./bonds.js";
import { proposeRoute, quickEnvoy, commsWith } from "./envoys.js"; // how a proposal reaches you, a request to keep their people (call-time only)

export const LOAN = {
  MAX: 6, SPAN: { min: 3, max: 30, def: 10 },
  TYPE: { commune: 0.5, military: 0.5, traders: 0, fortress: 0, expansionist: -0.5, raider: -1, zealot: -1 },
  PURPOSE: { work: 0, defence: 0.5, team: 0.5, poi: 0.5, horde: 1, crawl: 1.5, hive: 2, assault: 2 },
  DEATH: { op: -2, fight: -4, other: -10 }, WELL: 1, WELL_HP: 60,
  WAIT: 2, NOSHOW: -3, FOUGHT: 6, RENEGE: -6, OP_DAYS: 6, OP_MAX: 5,
  AI: { chance: 0.015, gap: 30, gw: 50, hive: 15, horde: 60, hordeRange: 8 },
  // Wanting to stay, a day: base + mood over 50 × mood + bonds (partner 3, close 2, friend 1, friendly 0.5, disliked
  // −0.5, rival −1 with your people) × bond (to ±bondCap) + days with you × day (to dayCap) + hurt (health under 50)
  // + home × each trouble at home (a war, a horde near, under 3 days of food a head); 0 … max. Not before minDays.
  STAY: { base: -0.012, mood: 0.0008, bond: 0.008, bondCap: 0.03, day: 0.0012, dayCap: 0.024, hurt: -0.01, home: 0.008, max: 0.08, minDays: 2 },
  // Keeping them. A request: (standing − ASK) / 10 + TYPE × 10 − 0.5 a person past the first − 1.5 in trouble at home
  // − 1 short-handed ≥ 0: yes (no hit at standing freeAt+, else small a person). Just letting them join: dice, no
  // reaction 0.3 + (standing − 40) / 100 + TYPE (0.05 … 0.85), a recall 0.15 − (standing − 40) / 200 − TYPE / 2
  // (0.03 … 0.5), else the hit (hit a person); kept anyway after a no: no reaction halved, a recall doubled (to 0.7),
  // anyway a person. Hits to cap.
  KEEP: { TYPE: { commune: 0.2, traders: 0.1, fortress: -0.05, military: -0.1, expansionist: -0.1, raider: -0.2, zealot: -0.25 }, ASK: 40, small: -1, freeAt: 60, hit: -4, anyway: -8, cap: -20 },
  CHOOSE: { threat: 8, short: 3 }, // baseOfChoice: tiles a base under threat (a raid on it, a horde within 3) or short of hands is worth
};
export const PURPOSES = { work: "work at the base", defence: "defend the base", team: "go out with your teams", poi: "raid places with you", horde: "meet a horde", crawl: "a city or town crawl", hive: "fight a hive", assault: "attack a group's base" };
export const OPS = { hive: { label: "Storm a hive (an assault or a crawl)", mission: "hive" }, crawl: { label: "A city or town crawl", mission: "crawl" }, assault: { label: "Attack a group's base", mission: "assault" }, horde: { label: "Meet a horde", mission: "cull" }, poi: { label: "Raid a place", mission: "scavenge" } };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const first = (s) => String(s.name).split(" ")[0];
const names = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);
function ensureLoans(state) {
  const V = ensureVols(state);
  if (!V.baseLoans) V.baseLoans = [];
  if (!V.ops) V.ops = [];
  if (V.opSeq == null) V.opSeq = 1;
  if (!V.proposed) V.proposed = {};
  return V;
}
export const loansOf = (state) => (state.vols && state.vols.baseLoans) || [];
export const opsOf = (state) => (state.vols && state.vols.ops) || [];
export const opById = (state, id) => opsOf(state).find((o) => o.id === id) || null;
export const isOnLoan = (s) => !!(s && s.loan);
export const loanLine = (state, s) => (s && s.loan ? `On loan from ${s.loan.group}: ${Math.max(0, Math.ceil((s.loan.until - state.hour) / 24))} days left (${PURPOSES[s.loan.purpose] || s.loan.purpose})${s.loan.wants != null && !s.loan.declined ? "; wants to stay with you" : ""}` : "");
// For a member: what it is worth to them beyond its goodwill (coalition.js standing's modifiers).
const standExtra = (state, f) => (isMember(state, f) ? standing(state, f) - f.goodwill : 0);
const standOf = (state, f) => (isMember(state, f) ? standing(state, f) : f.goodwill);
function credit(state, f, key, label, v, kind) {
  if (!v || !f || !f.alive) return;
  if (isMember(state, f)) remember(state, f, "you", key, label, v, kind);
  else changeGoodwill(state, f, v, label.toLowerCase());
}

// ---------- the answer ----------
// { yes, points, parts, refuse }: volunteers.js askQuote's (in person: no reach needed) plus their kind, the purpose's
// danger and a member's standing.
export function loanQuote(state, f, P = {}) {
  const n = clamp(Math.round(P.n || 1), 1, LOAN.MAX), days = clamp(Math.round(P.days || LOAN.SPAN.def), LOAN.SPAN.min, LOAN.SPAN.max);
  const q = askQuote(state, f, null, { n: Math.min(n, VOL.MAX), days, offer: P.offer || null, favour: !!P.favour, share: P.share || 0, inPerson: true });
  const out = { ...q, n, days, parts: [...q.parts] };
  if (!out.refuse && f.pop - n < VOL.HOME_MIN) out.refuse = `${f.name} cannot spare ${n}: they keep at least ${VOL.HOME_MIN} at home.`;
  if (out.refuse) return { ...out, yes: false };
  const add = (label, v) => { if (Math.abs(v) > 1e-9) out.parts.push({ label, v: Math.round(v * 100) / 100 }); };
  if (n > VOL.MAX) add(`${n} people`, -VOL.P.head * (n - VOL.MAX));
  add(`their kind (${f.type})`, LOAN.TYPE[f.type] || 0);
  const danger = P.op ? (VOL.DANGER[OPS[P.op] ? OPS[P.op].mission : P.op] ?? LOAN.PURPOSE[P.op] ?? 0) : LOAN.PURPOSE[P.purpose] || 0;
  add(P.op ? `the danger: ${OPS[P.op] ? OPS[P.op].label.toLowerCase() : P.op}` : `the purpose: ${PURPOSES[P.purpose] || "work"}`, -danger);
  add("standing beyond goodwill", standExtra(state, f) / VOL.P.gwDiv);
  out.points = Math.round(out.parts.reduce((a, x) => a + x.v, 0) * 100) / 100;
  out.yes = out.points >= 0;
  return out;
}

// ---------- their own kit (it.loanOwn: the id of the one it belongs to) ----------
export { ownKit }; // inventory.js: one of theirs on loan, and a piece they came with
// Everything on a person, a carried bag's contents too.
function kitOf(s) {
  ensureInv(s);
  const out = allCarried(s);
  const c = s.gear && s.gear.carry;
  if (c && Array.isArray(c.contents)) for (const it of c.contents) if (it) out.push(it);
  return out;
}
const markOwn = (s) => { for (const it of kitOf(s)) it.loanOwn = s.id; };
const clearMarks = (s) => { for (const it of kitOf(s)) if (it.loanOwn != null) delete it.loanOwn; };
// Takes the items `pred` picks off a person, wherever they are (pockets, pouches, the pack, a carried bag, plates, worn
// and held, in the arms), the insides before the containers. Returns them.
function pullItems(s, pred) {
  ensureInv(s);
  const g = s.gear, out = [];
  for (const c of carriedSpots(s)) if ((c.where === "pocket" || c.where === "rig" || c.where === "pack") && pred(c.item)) { c.take(); out.push(c.item); }
  if (g.carry && Array.isArray(g.carry.contents)) g.carry.contents.forEach((it, i) => { if (it && pred(it)) { g.carry.contents[i] = null; out.push(it); } });
  if (isCarrier(g.armor)) { const ins = insertsOf(g.armor); for (const k of Object.keys(ins)) if (ins[k] && pred(ins[k])) { out.push(ins[k]); ins[k] = null; } }
  for (const k of EQUIP_SLOTS) if (g[k] && pred(g[k])) { out.push(g[k]); g[k] = null; }
  if (s.loose) s.loose = s.loose.filter((it) => { if (it && pred(it)) { out.push(it); return false; } return true; });
  return out;
}
// What is inside a container that `pred` picks, taken out of it.
function pullInside(it, pred) {
  const out = [];
  if (it && Array.isArray(it.contents)) it.contents.forEach((x, i) => { if (x && pred(x)) { out.push(x); it.contents[i] = null; } });
  if (isCarrier(it)) { const ins = insertsOf(it); for (const k of Object.keys(ins)) if (ins[k] && pred(ins[k])) { out.push(ins[k]); ins[k] = null; } }
  return out;
}
// One of their own things back on them: in its slot if that is free, else stowed, else in their arms.
function putOn(s, it) {
  const slot = GEAR[it.key] && GEAR[it.key].slot;
  if (slot && EQUIP_SLOTS.includes(slot) && !s.gear[slot]) { s.gear[slot] = it; return; }
  if (!stow(s, it)) (s.loose || (s.loose = [])).push(it);
}
// They leave (endLoan): everything of the base's on them goes back to `holder` (the base they leave: supply items into
// its stores, the rest into its armory; a team's supplies and cargo when they leave a team), their packed rations
// too; their own things left in that armory or cargo are theirs again. Returns { back, own } (the names).
export function returnBaseKit(state, s, holder) {
  const shelf = holder ? holder.armory || (holder.cargo && holder.cargo.gear) || null : null;
  const own = (it) => it.loanOwn === s.id;
  const back = [], mine = [];
  const give = (it) => {
    back.push(it.name);
    if (isHeldSupply(it)) { if (holder) putBack(state, holder, it); return; } // supitems.js: water, food, meds, rounds into the stores
    if (shelf) shelf.push(it);
  };
  for (const it of pullItems(s, (x) => !own(x))) { for (const o of pullInside(it, own)) mine.push(o); give(it); }
  if (shelf) for (let i = shelf.length - 1; i >= 0; i--) if (shelf[i] && own(shelf[i])) mine.push(shelf.splice(i, 1)[0]);
  for (const it of mine) putOn(s, it);
  // eating.js: the pack of food and water they carry was filled from your stores.
  const r = s.ration;
  if (r && holder) {
    const st = stockOf(r);
    if (st && foodIn(st) > 0) moveFoodUnits(r, holder, foodIn(st), { state });
    if (st && st.water > 0) { const hs = stockOf(holder); hs.water = (hs.water || 0) + st.water; st.water = 0; }
  }
  return { back, own: mine.map((it) => it.name) };
}
// A piece of theirs in the armory of the base they live at or the cargo of the team they are on (a path that swapped
// it off them): back on them. Hourly (loansHour).
function ownKitHour(state) {
  for (const s of state.survivors) {
    if (!s.alive || !s.loan) continue;
    const L = s.location || {};
    const p = L.kind === "party" ? state.parties.find((x) => x.id === L.partyId) : null;
    const shelf = L.kind === "base" ? (baseById(state, L.baseId) || {}).armory : p && p.cargo ? p.cargo.gear : null;
    if (!Array.isArray(shelf) || !shelf.length) continue;
    for (let i = shelf.length - 1; i >= 0; i--) if (shelf[i] && shelf[i].loanOwn === s.id) putOn(s, shelf.splice(i, 1)[0]);
  }
}

// ---------- their people on the road: a party of the group ----------
// n of the group's fit people at home (they stay its members until they reach you).
function takePeople(state, f, n) {
  syncMembers(state, f);
  return fitAtHome(f).slice(0, Math.max(0, Math.min(n, (f.pop || 0) - VOL.HOME_MIN)));
}
// Old saves (before 2026-10-22): a party carrying its people as p.people, already off the group's list.
const legacyOf = (p) => Array.isArray(p.people) && p.people.length > 0;
const roadPeople = (state, f, p) => (legacyOf(p) ? p.people.filter((s) => s.alive) : f ? partyPeople(f, p).filter((s) => s.alive) : []);
function giveBack(state, f, people) {
  for (const s of people) {
    if (!s.alive) continue;
    delete s.loan;
    addMember(state, f, s);
    for (const it of allCarried(s)) if (it && !isRoundItem(it)) addToArsenal(state, f, it, "back"); // their kit on the group's books again
  }
}
// A party of these very people (kind "loan" or "opparty") on the map, from tile to tile, as the AI parties go
// (parties.js spawnAiParty): its people the group's members out with it (members.js partyId), road rations
// (PACK.food a head) out of `food` (a holder: the group's stock by default, the base or team they leave going home).
function walk(state, f, kind, people, from, to, extra = {}, food = null) {
  const res = planPath(state, from, to, false, f.id);
  if (!res) return null;
  const p = { id: newId(), owner: f.id, kind, path: res.path, idx: 0, progress: 0, vehicle: false, strength: Math.max(1, people.reduce((a, s) => a + combatPower(s), 0)), target: null, phase: "out", warned: false, errand: kind === "loan" ? "⚑ volunteers" : "⚔ joint op", heads: people.length, ...extra };
  state.parties.push(p);
  for (const s of people) {
    if (!membersOf(f).includes(s)) addMember(state, f, s);
    s.location = { kind: "member", fid: f.id, tile: null, partyId: p.id };
  }
  p.memberIds = people.map((s) => s.id);
  const src = food || f.stock;
  const have = src ? foodIn(stockOf(src)) : 0;
  if (have > 0) { const got = takeFood(src, Math.min(have, people.length * PACK.food), { eggs: false, state }); if (got.units > 0) p.rations = got.items; }
  return p;
}
// Road rations left when the party is done away from the group's bases: back in its stock (they are its food).
function rationsHome(f, p) {
  if (p.rations && f && f.alive && f.stock) for (const [k, q] of Object.entries(p.rations)) if (q > 0) f.stock[k] = (f.stock[k] || 0) + q;
  delete p.rations;
}
// The base a party of theirs heads for from `tile` (the user's rule 2026-10-22: "a base of their choosing"): the
// nearest, unless one under threat (a raid on its way to it, a horde within 3 tiles) or short of hands (under 0.6 of
// the bases' average) is within LOAN.CHOOSE tiles more. { tile, why } or null.
export function baseOfChoice(state, f, tile) {
  if (!f || !f.bases.length) return null;
  const g = state.grid, C = LOAN.CHOOSE;
  const counts = f.bases.map((b) => membersAt(f, b).length);
  const avg = counts.reduce((a, x) => a + x, 0) / counts.length;
  const rows = f.bases.map((b, i) => {
    const threat = (state.parties || []).some((q) => q.kind === "raid" && q.owner !== f.id && q.target && q.target.kind === "faction" && q.target.tile === b) || (state.hordes || []).some((h) => g.distance(h.tile, b) <= 3);
    const short = f.bases.length > 1 && counts[i] < avg * 0.6;
    return { tile: b, threat, short, score: g.distance(b, tile) - (threat ? C.threat : 0) - (short ? C.short : 0) };
  }).sort((a, b) => a.score - b.score || a.tile - b.tile);
  const r = rows[0];
  return { tile: r.tile, why: r.threat ? "a base of theirs under threat" : r.short ? "a base of theirs short of hands" : "their nearest base" };
}

// ---------- volunteers to a base ----------
// They said yes (envoys.js deliver, at their table): their people set out. Returns the loan, or null.
export function sendLoan(state, f, P, msgId = null) {
  const V = ensureLoans(state);
  const base = baseById(state, P.baseId) || hub(state);
  if (!base || !f.bases.length) return null;
  const people = takePeople(state, f, clamp(Math.round(P.n || 1), 1, LOAN.MAX));
  if (!people.length) return null;
  const loan = { id: newId(), fid: f.id, baseId: base.id, n: people.length, days: clamp(Math.round(P.days || LOAN.SPAN.def), LOAN.SPAN.min, LOAN.SPAN.max), purpose: PURPOSES[P.purpose] ? P.purpose : "work", offer: P.offer || null, favour: !!P.favour, ids: people.map((s) => s.id), status: "coming", partyId: null, msgId, sent: state.hour };
  const near = [...f.bases].sort((a, b) => state.grid.distance(a, base.tile) - state.grid.distance(b, base.tile) || a - b)[0];
  const p = walk(state, f, "loan", people, near, base.tile, { loanId: loan.id });
  if (!p) return null; // no way there: they stay home
  loan.partyId = p.id;
  V.baseLoans.push(loan);
  if (loan.favour) f.volFavour = { day: day(state) };
  return loan;
}
// The party at your base: they move in.
function loanArrive(state, p, loan, f) {
  const base = baseById(state, loan.baseId);
  if (!base || !f || !f.alive || loan.recall) { loan.status = "off"; return turnHome(state, p, f); }
  const legacy = legacyOf(p);
  const here = roadPeople(state, f, p);
  for (const s of here) {
    if (!legacy) removeMember(state, f, s, "on loan"); // off the group's list while here (f.pop without them), their kit off its books
    s.loan = { fid: f.id, group: f.name, id: loan.id, since: state.hour, until: state.hour + loan.days * 24, days: loan.days, purpose: loan.purpose, marked: true };
    delete s.fid; // one of yours while here (skills.js: their own perks and log lines); addMember gives it back at home
    s.location = { kind: "base", baseId: base.id };
    s.role = loan.purpose === "defence" ? "guard" : "farm";
    s.mood = s.mood ?? 60;
    markOwn(s); // what they came with is theirs
    state.survivors.push(s);
  }
  loan.ids = here.map((s) => s.id);
  loan.status = here.length ? "here" : "lost";
  loan.arrived = state.hour;
  p.people = [];
  rationsHome(f, p);
  removeParty(state, p);
  if (!here.length) return;
  // The offer, paid from the base now that they are here.
  const o = loan.offer;
  if (o && o.qty > 0 && supplyAmt(base.stock, o.key) >= o.qty) {
    if (o.key === "ammo") payAmmoKeys(state, base, o.qty);
    else if (o.key === "food") moveFoodUnits(base, f, o.qty, { state });
    else { useSupply(base.stock, o.key, o.qty); f.stock[o.key] = (f.stock[o.key] || 0) + o.qty; }
    if (o.key === "ammo") f.stock.ammo = (f.stock.ammo || 0) + o.qty;
  }
  log(state, `${names(here.map(first))} from ${f.name} arrived at ${base.name} on loan for ${loan.days} days (${PURPOSES[loan.purpose]}). They live and work there as your own; the kit they came with is theirs.`, "good");
}
const LEAVE_KEYS = ["station", "inBed", "work", "trip", "away", "walking", "leader", "moodWarn", "pending", "pinned"];
// The loan's people leave: off the base or the team, the base's things back where they came from, home on foot.
function endLoan(state, loan, why) {
  const f = factionById(state, loan.fid);
  const people = state.survivors.filter((s) => s.alive && s.loan && s.loan.id === loan.id);
  if (people.some((s) => s.location.kind === "party" && busyTeam(state, s.location.partyId))) return false; // not in the middle of a fight
  loan.status = "going";
  if (!f || !f.alive) { // their group is gone: they stay with you
    for (const s of people) { clearMarks(s); delete s.loan; s.joinedFrom = s.joinedFrom || (f ? f.name : "another group"); }
    loan.status = "done";
    return true;
  }
  const groups = new Map(); // tile → { holder, people }
  const back = [];
  for (const s of people) {
    let tile = null, holder = null;
    if (s.location.kind === "party") { const p = state.parties.find((x) => x.id === s.location.partyId); if (p) { tile = partyTile(p); holder = p; p.members = p.members.filter((id) => id !== s.id); } }
    else { const b = baseById(state, s.location.baseId); if (b) { tile = b.tile; holder = b; } }
    if (!holder) { holder = baseById(state, loan.baseId) || hub(state) || null; tile = holder ? holder.tile : null; }
    const r = returnBaseKit(state, s, holder);
    back.push(...r.back);
    state.survivors.splice(state.survivors.indexOf(s), 1);
    for (const k of LEAVE_KEYS) delete s[k];
    s.role = "member";
    clearMarks(s);
    delete s.loan;
    if (!groups.has(tile)) groups.set(tile, { holder, people: [] });
    groups.get(tile).people.push(s);
  }
  const well = people.length && people.every((s) => s.health >= LOAN.WELL_HP);
  let whereTo = "";
  for (const [tile, g] of groups) {
    giveBack(state, f, g.people); // their group's again, with their kit on its books
    const to = tile != null ? baseOfChoice(state, f, tile) : null;
    const p = to ? walk(state, f, "loan", g.people, tile, to.tile, { loanId: loan.id, phase: "back" }, g.holder) : null;
    if (p && !whereTo) whereTo = ` for ${to.why}`;
  }
  if (well) credit(state, f, "welltreated", "Their people came home well", LOAN.WELL, "aid");
  if (people.length) log(state, `${names(people.map(first))} of ${f.name} head home${whereTo}: ${why}.${back.length ? ` What the base gave them stays: ${[...new Set(back)].slice(0, 6).join(", ")}${back.length > 6 ? "…" : ""}.` : ""}`, "info");
  if (!state.parties.some((p) => p.loanId === loan.id)) loan.status = "done";
  dropStayCards(state, f);
  return true;
}
const busyTeam = (state, pid) => !!(state.combat && state.combat.setup && state.combat.setup.partyId === pid) || state.cards.some((c) => c.partyId === pid && c.kind === "conflict");
// Why their group calls them home now ("" for no reason).
function recallWhy(state, f) {
  if (!f || !f.alive) return "";
  if (attitude(f) === "Hostile" || f.goodwill < VOL.GW_LEAVE) return `${f.name} called them back`;
  if (atWarWithYou(state, f)) return `${f.name} are at war with you`;
  const t = groupTrouble(state, f);
  if (t.war) return `${f.name} need them at home: at war with ${t.war}`;
  if (t.horde) return `${f.name} need them at home: a horde of ${t.horde} near their base`;
  return "";
}
// world.js killSurvivor: one of theirs died on loan.
export function loanFell(state, s, tileId, cause) {
  const f = factionById(state, s.loan.fid);
  const p = s.location && s.location.kind === "party" ? state.parties.find((x) => x.id === s.location.partyId) : null;
  const fight = !!(state.combat || state.resolving) || /fight|battle|shot|brood|hive|horde|raid|crawl|ambush|killed|bled|attack|the dead/i.test(cause || "");
  const purposeMission = { hive: ["hive"], crawl: ["crawl", "scavenge"], assault: ["assault"], horde: ["cull"], poi: ["scavenge"], team: null, defence: null, work: null }[s.loan.purpose];
  const agreed = fight && (s.loan.purpose === "team" || s.loan.purpose === "defence" || (p && purposeMission && purposeMission.includes(p.mission)) || (!p && s.loan.purpose === "defence"));
  const v = agreed ? LOAN.DEATH.op : fight ? LOAN.DEATH.fight : LOAN.DEATH.other;
  if (f && f.alive) {
    (f.volFallen || (f.volFallen = [])).push({ name: s.name, day: day(state), how: fight ? "fight" : "other" });
    credit(state, f, `lost${s.id}`, agreed ? `${s.name} fell on a mission they agreed to` : fight ? `${s.name} fell in your fight` : `${s.name} died in your care`, v, "fight");
    log(state, agreed ? `${f.name} mourn ${s.name}, who fell on the work they came for.` : fight ? `${f.name} mourn ${s.name}, who fell fighting for you.` : `${f.name} blame you for ${s.name}'s death ${cause}.`, "danger");
    // Died at a base: their own things go home to their group (the base's stay: killSurvivor puts them in its armory).
    if (s.location && s.location.kind === "base") for (const it of pullItems(s, (x) => x.loanOwn === s.id)) if (!isRoundItem(it)) addToArsenal(state, f, it, "back");
  }
  clearMarks(s);
  const loan = loansOf(state).find((l) => l.id === s.loan.id);
  if (loan) loan.dead = (loan.dead || 0) + 1;
  // Their body leaves the roster: the group buried them (they are not on your memorial wall).
  const i = state.survivors.indexOf(s);
  if (i >= 0) state.survivors.splice(i, 1);
  s.diedDay = day(state);
}

// ---------- wanting to stay ----------
export const wantingToStay = (state, f) => state.survivors.filter((s) => s.alive && s.loan && f && s.loan.fid === f.id && s.loan.wants != null && !s.loan.declined);
// Their chance a day of coming to want to stay (LOAN.STAY).
export function stayChance(state, s, f) {
  const S = LOAN.STAY;
  const mood = ((s.mood ?? 60) - 50) * S.mood;
  let ties = 0;
  for (const x of relationsOf(state, s)) {
    if (!x.other.alive || x.other.loan || x.other.vol) continue;
    ties += { partner: 3, close: 2, friend: 1, friendly: 0.5, neutral: 0, disliked: -0.5, rival: -1 }[levelOf(x.rel)] || 0;
  }
  const bond = clamp(ties * S.bond, -S.bondCap, S.bondCap);
  const days = Math.min(S.dayCap, Math.max(0, (state.hour - (s.loan.since ?? state.hour)) / 24) * S.day);
  const hurt = s.health < 50 ? S.hurt : 0;
  const t = f ? groupTrouble(state, f) : {};
  const hungry = !!(f && f.pop > 0 && foodIn(f.stock) / Math.max(1, f.pop) < 3);
  const home = S.home * ((t.war ? 1 : 0) + (t.horde ? 1 : 0) + (hungry ? 1 : 0));
  return clamp(S.base + mood + bond + days + hurt + home, 0, S.max);
}
function stayDaily(state) {
  const d = day(state);
  for (const s of state.survivors) {
    if (!s.alive || !s.loan || s.loan.declined || s.loan.wants != null) continue;
    const f = factionById(state, s.loan.fid);
    if (!f || !f.alive || (state.hour - (s.loan.since ?? state.hour)) / 24 < LOAN.STAY.minDays) continue;
    if (hash01(state.seed || 1, "loanstay", s.id, d) < stayChance(state, s, f)) { s.loan.wants = d; log(state, `${s.name} of ${f.name} would like to stay with your people for good.`, "info"); }
  }
  if (!hub(state)) return;
  for (const f of state.factions) {
    if (!f.alive || state.cards.some((c) => c.loanStay === f.id)) continue;
    const ws = wantingToStay(state, f);
    if (ws.length && !ws.every((s) => s.loan.asked)) addCard(state, stayCard(state, f)); // asked: waiting for their answer
  }
}
function dropStayCards(state, f) {
  if (!f || wantingToStay(state, f).length) return;
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].loanStay === f.id) state.cards.splice(i, 1);
}
const peopleOf = (state, f, ids) => (ids || []).map((id) => survivorById(state, id)).filter((s) => s && s.alive && s.loan && s.loan.fid === f.id && !s.loan.declined);
// The card (one per group): everyone of it who wants to stay. The request goes only while they have not said no;
// after a no, keeping them anyway instead of just letting them join.
export function stayCard(state, f) {
  const ws = wantingToStay(state, f);
  const ids = ws.map((s) => s.id), n = ws.length;
  const refused = ws.some((s) => s.loan.refused);
  const who = names(ws.map(first));
  const via = commsWith(state, f) === "radio" ? "by radio: their answer at once" : "by envoy (your best talker at the hub): their answer when the envoy is home";
  const K = LOAN.KEEP;
  const choices = [];
  const unasked = ws.filter((s) => !s.loan.asked).map((s) => s.id); // a request already on its way covers the rest
  if (unasked.length && !refused) choices.push({ label: `Send a request to ${f.name} to keep ${unasked.length === 1 ? "them" : `all ${unasked.length}`}`, hint: `Asked ${via}. A yes: they are yours${standOf(state, f) >= K.freeAt ? ", no hard feelings" : `, a little standing (${K.small * unasked.length})`}; a no: they go home when the loan ends`, ai: () => 2, resolve: (st) => askToKeep(st, f, unasked) });
  if (n) choices.push(refused
    ? { label: "Keep them anyway", hint: `${f.name} said no: they take it worse (up to ${Math.max(K.cap, K.anyway * n)} standing, and may call the rest of their people home)`, ai: () => 0.2, resolve: (st) => justKeep(st, f, ids, true) }
    : { label: "Just let them join", hint: `No word to ${f.name}: they may let it pass, hold it against you (${Math.max(K.cap, K.hit * n)} standing), or call the rest of their people home`, ai: () => 0.5, resolve: (st) => justKeep(st, f, ids, false) });
  choices.push({ label: "Send them home at the loan's end", default: true, hint: `${n === 1 ? "They go" : "They all go"} home with ${f.name}'s people when the loan is up (a little sadder)`, ai: () => 1, resolve: (st) => sendHomeAtEnd(st, f, ids) });
  return {
    title: n === 1 ? `${ws[0].name} wants to stay with you` : `${n} of ${f.name}'s people want to stay with you`, loanStay: f.id,
    text: `${who} of ${f.name}, here on loan, ${n === 1 ? "asks" : "ask"} to stay with your people for good.${refused ? ` ${f.name} already said no: they want ${n === 1 ? "them" : "their people"} back when the loan ends.` : ""}`,
    choices,
  };
}
// "Send a request": by radio now, else your envoy (envoys.js KINDS.keep → keepAnswer, keepDelivered, keepHome).
export function askToKeep(state, f, ids) {
  const ws = peopleOf(state, f, ids);
  if (!ws.length) return "Nobody is left to ask about.";
  for (const s of ws) s.loan.asked = true;
  const r = quickEnvoy(state, f, "keep", { ids: ws.map((s) => s.id) });
  if (!r.ok) { for (const s of ws) if (s.loan) s.loan.asked = false; return r.text; }
  return r.text;
}
// Their answer (envoys.js aiAnswer): by standing and their kind (LOAN.KEEP).
export function keepAnswer(state, f, P = {}) {
  const K = LOAN.KEEP;
  const n = Math.max(1, (P.ids || []).length);
  const stand = standOf(state, f);
  const t = groupTrouble(state, f);
  const pts = (stand - K.ASK) / 10 + (K.TYPE[f.type] || 0) * 10 - 0.5 * (n - 1) - (t.war || t.horde ? 1.5 : 0) - ((f.pop || 0) < VOL.HOME_MIN + 4 ? 1 : 0);
  if (pts >= 0) return { yes: true, p: null, why: "" };
  return { yes: false, p: null, why: stand < K.ASK ? `they do not think well enough of you (${Math.round(stand)})` : t.war || t.horde ? "they need every hand at home" : "they will not give up their people" };
}
// At their table (envoys.js deliver): the words.
export function keepDelivered(state, f, P, yes) {
  const who = names(peopleOf(state, f, P.ids).map(first)) || "their people";
  return yes ? `${f.name} agreed to let ${who} stay with you.` : `${f.name} want ${who} back when the loan ends.`;
}
// Home with their answer (envoys.js sealHome; at once by radio): yes, they join you; no, they go home at the end
// (the card again: keep them anyway or let them go).
export function keepHome(state, f, P = {}, yes) {
  const ws = peopleOf(state, f, P.ids);
  if (!ws.length) return "";
  const K = LOAN.KEEP;
  if (yes) {
    const hit = standOf(state, f) >= K.freeAt ? 0 : K.small * ws.length;
    if (hit) credit(state, f, `kept${ws[0].id}`, "Kept some of their people (with their leave)", hit, "refused");
    joinYou(state, f, ws, "with their group's leave");
    return `${names(ws.map(first))} ${ws.length === 1 ? "is" : "are"} yours now.`;
  }
  for (const s of ws) { s.loan.refused = true; s.loan.asked = false; }
  if (hub(state) && !state.cards.some((c) => c.loanStay === f.id)) addCard(state, stayCard(state, f));
  return `${names(ws.map(first))} go${ws.length === 1 ? "es" : ""} home when the loan ends, unless you keep ${ws.length === 1 ? "them" : "them"} anyway.`;
}
// "Just let them join" (anyway: after they said no): dice by standing and their kind (LOAN.KEEP).
export function justKeep(state, f, ids, anyway = false) {
  const ws = peopleOf(state, f, ids);
  if (!ws.length) return "Nobody is left to keep.";
  const K = LOAN.KEEP, stand = standOf(state, f), tl = K.TYPE[f.type] || 0;
  let pNone = clamp(0.3 + (stand - 40) / 100 + tl, 0.05, 0.85);
  let pRecall = clamp(0.15 - (stand - 40) / 200 - tl / 2, 0.03, 0.5);
  if (anyway) { pNone /= 2; pRecall = Math.min(0.7, pRecall * 2); }
  const r = hash01(state.seed || 1, "loankeep", f.name, day(state), ws[0].id);
  const hit = Math.max(K.cap, (anyway ? K.anyway : K.hit) * ws.length);
  joinYou(state, f, ws, anyway ? `after ${f.name} said no` : `without asking ${f.name}`);
  ensureLoans(state).keepStats = ensureLoans(state).keepStats || { none: 0, hit: 0, recall: 0 };
  const S = ensureLoans(state).keepStats;
  if (r < pNone) { S.none++; log(state, `${f.name} let it pass.`, "info"); return `${f.name} let it pass.`; }
  credit(state, f, `took${ws[0].id}`, anyway ? "Kept their people after they said no" : "Kept their people without asking", hit, "refused");
  if (r >= 1 - pRecall) {
    S.recall++;
    for (const l of loansOf(state)) { if (l.fid !== f.id) continue; if (l.status === "here") endLoan(state, l, `${f.name} called them back`); else if (l.status === "coming") l.recall = true; }
    log(state, `${f.name} are angry that you kept their people (${hit} standing): they call the rest of their people home.`, "danger");
    return `${f.name} are angry (${hit} standing) and call the rest of their people home.`;
  }
  S.hit++;
  log(state, `${f.name} hold it against you that you kept their people (${hit} standing).`, "danger");
  return `${f.name} hold it against you (${hit} standing).`;
}
function sendHomeAtEnd(state, f, ids) {
  const ws = peopleOf(state, f, ids);
  for (const s of ws) { s.loan.declined = true; s.mood = Math.max(0, (s.mood ?? 60) - 5); }
  return ws.length ? `${names(ws.map(first))} will go home with ${f.name}'s people when the loan ends.` : "";
}
// They are yours: ordinary survivors (off the loan, their kit theirs to use as yours is). Their group's count already
// went down when they came (members.js removeMember at loanArrive).
function joinYou(state, f, ws, how) {
  for (const s of ws) {
    const loan = loansOf(state).find((l) => l.id === s.loan.id);
    clearMarks(s);
    delete s.loan;
    s.joinedFrom = f.name;
    if (loan) { loan.ids = (loan.ids || []).filter((id) => id !== s.id); loan.stayed = (loan.stayed || 0) + 1; }
  }
  const V = ensureVols(state);
  V.stats.loanStayed = (V.stats.loanStayed || 0) + ws.length;
  log(state, `${names(ws.map(first))} of ${f.name} stay${ws.length === 1 ? "s" : ""} with your people for good (${how}).`, "good");
  dropStayCards(state, f);
}

// ---------- joint operations ----------
// A new operation (the Envoys tab): { op, target, tile, day, share, n }. Returns the op.
export function planOp(state, { op, target, tile = null, dayAt = null, share = 0, n = 3, by = "you" }) {
  const V = ensureLoans(state);
  const t = tile != null ? tile : rendezvousFor(state, target);
  const o = { id: V.opSeq++, op: OPS[op] ? op : "hive", target, tile: t, day: dayAt != null ? dayAt : day(state) + 3, share: VOL.SHARE.choices.includes(share) ? share : 0, n: clamp(Math.round(n), 1, LOAN.OP_MAX), groups: [], status: "planned", by, reqs: [] };
  V.ops.push(o);
  return o;
}
// A tile next to the target your side of it (nearest your hub), on land; the target itself when none.
export function rendezvousFor(state, target) {
  const h = hub(state);
  if (target == null) return h ? h.tile : 0;
  const near = state.grid.neighbors(target).filter((id) => state.tiles[id] && state.tiles[id].terrain !== "water" && !state.factions.some((f) => f.bases.includes(id)));
  if (!near.length || !h) return target;
  return near.sort((a, b) => state.grid.distance(a, h.tile) - state.grid.distance(b, h.tile) || a - b)[0];
}
// Their answer (envoys.js aiAnswer for "jointop").
export function opQuote(state, f, o) {
  return loanQuote(state, f, { n: o.n, days: LOAN.OP_DAYS, share: o.share, op: o.op });
}
// They agreed (envoys.js deliver, or the radio): their party sets out for the rendezvous.
export function joinOp(state, f, o, msgId = null) {
  const g = o.groups.find((x) => x.fid === f.id) || (o.groups.push({ fid: f.id, status: "asked" }), o.groups[o.groups.length - 1]);
  g.msgId = msgId;
  const people = takePeople(state, f, o.n);
  if (!people.length) { g.status = "refused"; return null; }
  const from = [...f.bases].sort((a, b) => state.grid.distance(a, o.tile) - state.grid.distance(b, o.tile) || a - b)[0];
  const p = walk(state, f, "opparty", people, from, o.tile, { opId: o.id });
  if (!p) { g.status = "refused"; return null; }
  g.status = "coming"; g.partyId = p.id; g.n = people.length;
  return p;
}
export function noteOpAnswer(state, f, o, yes) {
  const g = o.groups.find((x) => x.fid === f.id) || (o.groups.push({ fid: f.id }), o.groups[o.groups.length - 1]);
  if (!yes) g.status = "refused";
}
// Their party at the rendezvous waits; your team there on or after the day: they join it as volunteers.
function opHour(state, o) {
  const d = day(state);
  if (o.status === "done" || o.status === "off") return;
  for (const g of o.groups) if ((g.status === "coming" || g.status === "waiting") && !state.parties.some((p) => p.id === g.partyId)) g.status = "lost"; // killed on the way
  if (d >= o.day) {
    const team = state.parties.find((p) => p.owner === "player" && p.kind !== "convoy" && p.envoy == null && partyTile(p) === o.tile && partyMembers(state, p).length && !busyTeam(state, p.id));
    if (team) for (const g of o.groups) if (g.status === "waiting") meet(state, o, g, team);
  }
  if (d > o.day + LOAN.WAIT) {
    for (const g of o.groups) {
      if (g.status !== "waiting" && g.status !== "coming") continue;
      const p = state.parties.find((x) => x.id === g.partyId), f = factionById(state, g.fid);
      g.status = "missed";
      if (p && f) opGoHome(state, p, f);
      if (o.status === "planned" && f) credit(state, f, "noshow", "You did not come to the rendezvous", LOAN.NOSHOW, "refused");
    }
    if (o.status === "planned") { o.status = "off"; log(state, `The joint operation at ${tileLabel(state, o.tile)} is off: nobody met at the rendezvous.`, "danger"); }
  }
  if (o.status === "met" && !(state.vols.people || []).some((s) => s.alive && s.vol && o.reqs.includes(s.vol.req))) {
    o.status = "done";
    for (const g of o.groups) if (g.status === "joined") credit(state, factionById(state, g.fid), `op${o.id}`, "Fought beside us", LOAN.FOUGHT, "fight");
    log(state, `The joint operation (${OPS[o.op].label.toLowerCase()}) is over: ${o.groups.filter((g) => g.status === "joined").map((g) => (factionById(state, g.fid) || {}).name).join(", ") || "nobody"} fought beside you.`, "good");
  }
}
// One party joins the team as volunteers (volunteers.js: they join it on the next hour, with food, water and rounds).
function meet(state, o, g, team) {
  const V = ensureVols(state);
  const f = factionById(state, g.fid), p = state.parties.find((x) => x.id === g.partyId);
  if (!f || !p) return;
  const legacy = legacyOf(p);
  const people = roadPeople(state, f, p);
  if (!people.length) return;
  const M = OPS[o.op].mission;
  const req = { id: V.nextAsk++, fid: f.id, partyId: team.id, n: people.length, days: LOAN.OP_DAYS, mission: M === "cull" || M === "crawl" ? "escort" : M, label: `the joint operation (${OPS[o.op].label.toLowerCase()})`, day: day(state), share: o.share, cargoStart: cargoOf(team), homeBaseId: team.homeBaseId, opId: o.id };
  (V.reqs || (V.reqs = [])).push(req);
  o.reqs.push(req.id);
  for (const s of people) {
    if (!legacy) removeMember(state, f, s, "volunteer"); // off the group's list while with your team (volunteers.js makeVolunteer's way)
    s.role = "volunteer";
    s.vol = { fid: f.id, group: f.name, req: req.id, mission: req.mission, label: req.label, since: state.hour, until: state.hour + LOAN.OP_DAYS * 24, days: LOAN.OP_DAYS, lent: allCarried(s).filter(Boolean), fought: 0, op: o.id };
    s.location = { kind: "coming", partyId: team.id, eta: state.hour };
    V.people.push(s);
  }
  p.people = [];
  rationsHome(f, p);
  removeParty(state, p);
  g.status = "joined";
  o.status = "met";
  o.teamId = team.id;
  log(state, `${f.name}'s fighters met your team at ${tileLabel(state, o.tile)} for the joint operation: their group's orders in a fight, beside yours.`, "good");
}
const cargoOf = (p) => { const out = {}; for (const [k, v] of Object.entries((p.cargo && p.cargo.supplies) || {})) if (Number.isFinite(v) && v > 0 && SUPPLIES[k]) out[k] = v; return out; };
// A party at the rendezvous with nobody to meet (or the operation over): home to the base it chooses.
function opGoHome(state, p, f) {
  const to = f && f.alive ? baseOfChoice(state, f, partyTile(p)) : null;
  const res = to ? planPath(state, partyTile(p), to.tile, false, f.id) : null;
  if (!res) return turnHome(state, p, f, true);
  p.path = res.path; p.idx = 0; p.progress = 0; p.phase = "back";
}
// After the operation (volunteers.js sendHomeAll): its volunteers of one group leave your team together, members of
// their group again (addMember done by the caller), as a party walking to the base they choose, with rations from the
// team (what they brought) and a hold for their loot share (p.goods: volunteers.js settleShare). Null: no way home
// (they are home already).
export function opTeamHome(state, f, people, team, opId = null) {
  const live = people.filter((s) => s.alive && membersOf(f).includes(s));
  if (!live.length || !f.alive || !team || !state.parties.includes(team)) return null;
  const tile = partyTile(team);
  const to = baseOfChoice(state, f, tile);
  if (!to) return null;
  const p = walk(state, f, "opparty", live, tile, to.tile, { phase: "back", opId, errand: "⚔ joint op · home" }, team);
  if (!p) { for (const s of live) s.location = { kind: "member", fid: f.id, tile: f.bases[0] ?? null }; return null; }
  p.goods = { supplies: {}, gear: [] };
  ensureLoans(state).opTeams = (ensureLoans(state).opTeams || 0) + 1;
  log(state, `${names(live.map(first))} of ${f.name} leave the team at ${tileLabel(state, tile)} together and walk to ${to.why} (${tileLabel(state, to.tile)}).`, "info");
  return p;
}

// ---------- their parties (parties.js aiPartyHour) ----------
// kind "loan" / "opparty" at the end of its way.
export function loanPartyArrive(state, p) {
  const f = factionById(state, p.owner);
  if (p.phase === "back") return turnHome(state, p, f, true);
  if (p.kind === "loan") { const loan = loansOf(state).find((l) => l.id === p.loanId); if (loan) return loanArrive(state, p, loan, f); return turnHome(state, p, f); }
  const o = opById(state, p.opId), g = o ? o.groups.find((x) => x.partyId === p.id) : null;
  if (!o || !g || o.status === "done" || o.status === "off" || g.status === "missed") return opGoHome(state, p, f);
  g.status = "waiting";
  p.phase = "wait";
}
// Home (arrived: home true) or turned back where they stand (the loan off): walk to their base, or, at it, they are home.
function turnHome(state, p, f, arrived = false) {
  if (!arrived && f && f.alive && !legacyOf(p)) {
    const to = baseOfChoice(state, f, partyTile(p));
    const res = to && to.tile !== partyTile(p) ? planPath(state, partyTile(p), to.tile, false, f.id) : null;
    if (res) { p.path = res.path; p.idx = 0; p.progress = 0; p.phase = "back"; return; }
  }
  if (f && f.alive) {
    if (legacyOf(p)) giveBack(state, f, p.people);
    else {
      const at = f.bases.includes(partyTile(p)) ? partyTile(p) : f.bases[0] ?? null;
      for (const s of partyPeople(f, p)) s.location = { kind: "member", fid: f.id, tile: at };
    }
    const G = p.goods; // a joint operation's loot share, carried home (robbed with the party on the way: caravanraids.js goodsOf)
    if (G) {
      for (const [k, q] of Object.entries(G.supplies || {})) if (q > 0) f.stock[k] = (f.stock[k] || 0) + q;
      for (const it of G.gear || []) addToArsenal(state, f, it, "share");
      delete p.goods;
    }
  }
  p.people = [];
  const loan = p.loanId != null ? loansOf(state).find((l) => l.id === p.loanId) : null;
  removeParty(state, p); // parties.js: rations left back in the stock at their base
  if (loan && loan.status === "going" && !state.parties.some((q) => q.loanId === loan.id)) loan.status = "done";
}

// ---------- hourly (envoys.js envoysHour) ----------
export function loansHour(state) {
  if (!state.vols) return;
  const V = state.vols;
  for (const loan of V.baseLoans || []) {
    if (loan.status === "coming" && !state.parties.some((p) => p.id === loan.partyId)) { loan.status = "lost"; continue; } // killed or robbed on the way: they never come
    if (loan.status === "going" && !state.parties.some((p) => p.loanId === loan.id)) loan.status = "done";
    if (loan.status !== "here") continue;
    const people = state.survivors.filter((s) => s.alive && s.loan && s.loan.id === loan.id);
    if (!people.length) { loan.status = "done"; continue; }
    for (const s of people) if (!s.loan.marked) { markOwn(s); s.loan.marked = true; } // an old save: what they carry now is theirs
    const f = factionById(state, loan.fid);
    const why = state.hour >= Math.min(...people.map((s) => s.loan.until)) ? "their time is up" : recallWhy(state, f);
    if (why) endLoan(state, loan, why);
  }
  ownKitHour(state);
  for (const o of V.ops || []) opHour(state, o);
  if (state.hour % 24 === 0) { aiProposalsDaily(state); stayDaily(state); }
  if ((V.baseLoans || []).length > 60) V.baseLoans = V.baseLoans.filter((l) => l.status !== "done" && l.status !== "lost" || l.sent > state.hour - 24 * 60);
}

// ---------- their proposals ----------
// A member, or a group friendly enough, with a hive or a big horde near its land proposes a joint operation now and
// then: a card (envoys.js carries it without a radio link).
function aiProposalsDaily(state) {
  const V = ensureLoans(state), d = day(state);
  if (!hub(state) || state.cards.some((c) => c.opProposal) || opsOf(state).some((o) => o.by !== "you" && o.status === "planned")) return;
  for (const f of state.factions) {
    if (!f.alive || !f.known || !f.bases.length || (!isMember(state, f) && f.goodwill < LOAN.AI.gw) || attitude(f) === "Hostile") continue;
    if (V.proposed[f.id] != null && d - V.proposed[f.id] < LOAN.AI.gap) continue;
    if (hash01(state.seed || 1, "opprop", f.name, d) >= LOAN.AI.chance) continue;
    const g = state.grid;
    const hive = (state.hives || []).find((h) => f.bases.some((b) => g.distance(b, h.tile) <= LOAN.AI.hive));
    const horde = !hive && (state.hordes || []).find((h) => h.size >= LOAN.AI.horde && f.bases.some((b) => g.distance(b, h.tile) <= LOAN.AI.hordeRange));
    if (!hive && !horde) continue;
    V.proposed[f.id] = d;
    const prop = { fid: f.id, op: hive ? "hive" : "horde", target: hive ? hive.tile : horde.tile, n: clamp(Math.round(f.pop / 8), 2, LOAN.OP_MAX), share: 0.1 };
    if (proposeRoute(state, f, prop)) return;
  }
}
// volunteers.js settleShare: the haul was spent before their share was paid.
export function reneged(state, f, req) {
  credit(state, f, "reneged", "Kept back their share of the haul", LOAN.RENEGE, "refused");
  log(state, `${f.name} got less than the share they were promised: they will remember it.`, "danger");
  void req;
}
// The card for a proposal: accept (an operation with them agreed) or decline. sent(st, yes): what happens to their
// side (their party sets out now by radio, or once their envoy is home).
export function proposalCard(state, f, prop, sent) {
  const o0 = { op: prop.op, target: prop.target, tile: rendezvousFor(state, prop.target), day: day(state) + 4 };
  return {
    title: `${f.name} propose a joint operation`, opProposal: f.id, envoyFrom: f.id,
    text: `${f.name} propose ${OPS[prop.op].label.toLowerCase()} at ${tileLabel(state, prop.target)} together: ${prop.n} of theirs at ${tileLabel(state, o0.tile)} on day ${o0.day}, for a ${Math.round(prop.share * 100)}% share of what is taken. Bring a team there; they join it and fight beside yours.`,
    choices: [
      { label: "Agree", hint: `Meet them at ${tileLabel(state, o0.tile)} on day ${o0.day} (a rendezvous marker on the map)`, ai: () => 1,
        resolve: (st) => { const o = planOp(st, { op: prop.op, target: prop.target, tile: o0.tile, dayAt: o0.day, share: prop.share, n: prop.n, by: f.id }); o.groups.push({ fid: f.id, status: "agreed" }); sent(st, true, o); noteAnswer(st, f, true); return `You agree to meet ${f.name} at ${tileLabel(st, o.tile)} on day ${o.day}.`; } },
      { label: "Decline", default: true, hint: "Nothing changes", ai: () => 1.2, resolve: (st) => { sent(st, false, null); noteAnswer(st, f, false); return `You decline ${f.name}'s proposal.`; } },
    ],
  };
}
