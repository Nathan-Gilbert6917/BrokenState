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
// - Yes: their very people (members.js: off the group's list, with what they carry) walk to the base as a group's
//   party (kind "loan", on the map, robbed and killed like a caravan: parties.js aiPartyHour, caravanraids.js). Lost on
//   the way, they never come. At the base they are survivor records in state.survivors with s.loan { fid, group, id,
//   until, purpose }: they eat and drink from its stores, sleep in its beds (crowding too), take work roles, go out on
//   teams and fight on your orders like your own (they agreed to while they are here). The offer is paid from that
//   base when they arrive. Their kit is theirs: nothing can be taken off them (inventory.js moveItem refuses, a team
//   home does not unpack them); their rounds: they load from what they carry and, on a team, from its supplies like
//   anyone, and what they carry they take home.
// - The loan ends when its days are up, or they are recalled: their group hostile or under VOL.GW_LEAVE goodwill, at
//   war with you, at war itself or a horde near its base (they are needed at home). They leave the base (or the team,
//   once it is out of a fight) and walk home as a party; home, they are the group's people again with what they carry
//   (their kit back on its books). Home well (health LOAN.WELL_HP+ each): +LOAN.WELL standing.
// - Killed while on loan (world.js killSurvivor → loanFell): their group's standing falls by how: on a mission of the
//   purpose they came for LOAN.DEATH.op, in a fight LOAN.DEATH.fight, any other way (hunger, sickness, accidents)
//   LOAN.DEATH.other; they count in askQuote's "their dead with you lately". Their group mourns, not your memorial wall.
//
// Joint operations (KINDS.jointop: a hive (assault or crawl), a city or town crawl, an assault on a group's base, a
// horde, a POI raid; a rendezvous tile and day, a share of the loot, how many they send)
// - Each group decides by the same points with the operation's danger (volunteers.js VOL.DANGER) and the share
//   (VOL.SHARE.points × share). Yes: a party of their people (kind "opparty") sets out for the rendezvous and waits
//   there up to LOAN.WAIT days past the day.
// - Your team at the rendezvous on or after the day: every party waiting there joins it as volunteers (volunteers.js:
//   their group's AI moves them on the battle map, they take a simple order, they crawl a hive or a city with your
//   people, they count by the numbers; their days are the operation's), a party coming late joins while the team is
//   still there; one that never comes (killed on the way) is missed and the operation goes on with whoever came.
// - After: the loot share is volunteers.js settleShare (what the team's cargo gained while they were with it ×
//   the share, when the last of them leaves; paying much less than was due costs standing: reneged); each group that
//   came gets "Fought beside us" (coalition.js remember, kind "fight"). Nobody of yours at the rendezvous within the
//   wait: their parties go home and you lose LOAN.NOSHOW standing.
// - The groups propose joint operations too (aiProposalsDaily: a member or a friend with a hive or a big horde near its
//   land, now and then): a card by radio, or by their envoy (envoys.js "propose"); your answer goes back the same way,
//   and their party sets out once they have it.
// Dice: hash01 (the proposals), never the world's.
import { day, log, hub, baseById, factionById, newId, localId, combatPower } from "./world.js";
import { attitude, changeGoodwill } from "./factions.js";
import { planPath, partyTile, removeParty, tileLabel, partyMembers } from "./parties.js";
import { hash01 } from "./skills.js";
import { VOL, askQuote, groupTrouble, ensureVols } from "./volunteers.js";
import { syncMembers, fitAtHome, removeMember, addMember } from "./members.js";
import { allCarried } from "./inventory.js";
import { addToArsenal } from "./arsenal.js";
import { isRoundItem } from "./itemstack.js";
import { isMember } from "./alliance.js";
import { standing, remember, noteAnswer } from "./coalition.js";
import { atWarWithYou } from "./playerwars.js";
import { supplyAmt, useSupply } from "./rounds.js";
import { moveFoodUnits } from "./foods.js";
import { payAmmoKeys } from "./ammo.js";
import { SUPPLIES } from "./data.js";
import { proposeRoute } from "./envoys.js"; // how a proposal reaches you: radio or envoy (call-time only)

export const LOAN = {
  MAX: 6, SPAN: { min: 3, max: 30, def: 10 },
  TYPE: { commune: 0.5, military: 0.5, traders: 0, fortress: 0, expansionist: -0.5, raider: -1, zealot: -1 },
  PURPOSE: { work: 0, defence: 0.5, team: 0.5, poi: 0.5, horde: 1, crawl: 1.5, hive: 2, assault: 2 },
  DEATH: { op: -2, fight: -4, other: -10 }, WELL: 1, WELL_HP: 60,
  WAIT: 2, NOSHOW: -3, FOUGHT: 6, RENEGE: -6, OP_DAYS: 6, OP_MAX: 5,
  AI: { chance: 0.015, gap: 30, gw: 50, hive: 15, horde: 60, hordeRange: 8 },
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
export const loanLine = (state, s) => (s && s.loan ? `On loan from ${s.loan.group}: ${Math.max(0, Math.ceil((s.loan.until - state.hour) / 24))} days left (${PURPOSES[s.loan.purpose] || s.loan.purpose})` : "");
// For a member: what it is worth to them beyond its goodwill (coalition.js standing's modifiers).
const standExtra = (state, f) => (isMember(state, f) ? standing(state, f) - f.goodwill : 0);
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

// ---------- their people out of the group, and the party that carries them ----------
function takePeople(state, f, n) {
  syncMembers(state, f);
  const go = fitAtHome(f).slice(0, Math.max(0, Math.min(n, (f.pop || 0) - VOL.HOME_MIN)));
  for (const s of go) removeMember(state, f, s, "on loan");
  return go;
}
function giveBack(state, f, people) {
  for (const s of people) {
    if (!s.alive) continue;
    delete s.loan;
    addMember(state, f, s);
    for (const it of allCarried(s)) if (it && !isRoundItem(it)) addToArsenal(state, f, it, "back"); // their kit on the group's books again
  }
}
// A party of these very people (kind "loan" or "opparty") on the map, from tile to tile.
function walk(state, f, kind, people, from, to, extra = {}) {
  const res = planPath(state, from, to, false, f.id);
  if (!res) return null;
  const p = { id: newId(), owner: f.id, kind, path: res.path, idx: 0, progress: 0, vehicle: false, strength: Math.max(1, people.reduce((a, s) => a + combatPower(s), 0)), target: null, phase: "out", warned: false, people, errand: kind === "loan" ? "⚑ volunteers" : "⚔ joint op", ...extra };
  for (const s of people) s.location = { kind: "member", fid: f.id, tile: null, partyId: p.id };
  state.parties.push(p);
  return p;
}
const nearestBase = (state, f, tile) => [...f.bases].sort((a, b) => state.grid.distance(a, tile) - state.grid.distance(b, tile) || a - b)[0];

// ---------- volunteers to a base ----------
// They said yes (envoys.js deliver, at their table): their people set out. Returns the loan, or null.
export function sendLoan(state, f, P, msgId = null) {
  const V = ensureLoans(state);
  const base = baseById(state, P.baseId) || hub(state);
  if (!base || !f.bases.length) return null;
  const people = takePeople(state, f, clamp(Math.round(P.n || 1), 1, LOAN.MAX));
  if (!people.length) return null;
  const loan = { id: newId(), fid: f.id, baseId: base.id, n: people.length, days: clamp(Math.round(P.days || LOAN.SPAN.def), LOAN.SPAN.min, LOAN.SPAN.max), purpose: PURPOSES[P.purpose] ? P.purpose : "work", offer: P.offer || null, favour: !!P.favour, ids: people.map((s) => s.id), status: "coming", partyId: null, msgId, sent: state.hour };
  const p = walk(state, f, "loan", people, nearestBase(state, f, base.tile), base.tile, { loanId: loan.id });
  if (!p) { giveBack(state, f, people); return null; }
  loan.partyId = p.id;
  V.baseLoans.push(loan);
  if (loan.favour) f.volFavour = { day: day(state) };
  return loan;
}
// The party at your base: they move in.
function loanArrive(state, p, loan, f) {
  const base = baseById(state, loan.baseId);
  if (!base || !f || !f.alive) { loan.status = "off"; return goHome(state, p, f); }
  const here = p.people.filter((s) => s.alive);
  for (const s of here) {
    s.loan = { fid: f.id, group: f.name, id: loan.id, since: state.hour, until: state.hour + loan.days * 24, days: loan.days, purpose: loan.purpose };
    delete s.fid; // one of yours while here (skills.js: their own perks and log lines); addMember gives it back at home
    s.location = { kind: "base", baseId: base.id };
    s.role = loan.purpose === "defence" ? "guard" : "farm";
    s.mood = s.mood ?? 60;
    state.survivors.push(s);
  }
  loan.ids = here.map((s) => s.id);
  loan.status = "here";
  loan.arrived = state.hour;
  p.people = [];
  removeParty(state, p);
  // The offer, paid from the base now that they are here.
  const o = loan.offer;
  if (o && o.qty > 0 && supplyAmt(base.stock, o.key) >= o.qty) {
    if (o.key === "ammo") payAmmoKeys(state, base, o.qty);
    else if (o.key === "food") moveFoodUnits(base, f, o.qty, { state });
    else { useSupply(base.stock, o.key, o.qty); f.stock[o.key] = (f.stock[o.key] || 0) + o.qty; }
    if (o.key === "ammo") f.stock.ammo = (f.stock.ammo || 0) + o.qty;
  }
  log(state, `${names(here.map(first))} from ${f.name} arrived at ${base.name} on loan for ${loan.days} days (${PURPOSES[loan.purpose]}). They live and work there as your own; their kit is theirs.`, "good");
}
// The loan's people leave: off the base or the team, home on foot.
function endLoan(state, loan, why) {
  const f = factionById(state, loan.fid);
  const people = state.survivors.filter((s) => s.alive && s.loan && s.loan.id === loan.id);
  if (people.some((s) => s.location.kind === "party" && busyTeam(state, s.location.partyId))) return false; // not in the middle of a fight
  loan.status = "going";
  const byTile = new Map();
  for (const s of people) {
    let tile = null;
    if (s.location.kind === "party") { const p = state.parties.find((x) => x.id === s.location.partyId); if (p) { tile = partyTile(p); p.members = p.members.filter((id) => id !== s.id); } }
    else { const b = baseById(state, s.location.baseId); tile = b ? b.tile : null; }
    state.survivors.splice(state.survivors.indexOf(s), 1);
    s.station = null; s.inBed = false; s.role = "member";
    if (tile == null) tile = (baseById(state, loan.baseId) || hub(state) || {}).tile;
    (byTile.get(tile) || byTile.set(tile, []).get(tile)).push(s);
  }
  const well = people.length && people.every((s) => s.health >= LOAN.WELL_HP);
  if (!f || !f.alive) { for (const s of people) { delete s.loan; s.location = { kind: "base", baseId: loan.baseId }; state.survivors.push(s); } loan.status = "done"; return true; }
  for (const [tile, ps] of byTile) {
    const p = tile != null ? walk(state, f, "loan", ps, tile, nearestBase(state, f, tile), { loanId: loan.id, phase: "back" }) : null;
    if (!p) giveBack(state, f, ps);
  }
  if (well) credit(state, f, "welltreated", "Their people came home well", LOAN.WELL, "aid");
  if (people.length) log(state, `${names(people.map(first))} of ${f.name} head home: ${why}.`, "info");
  if (!state.parties.some((p) => p.loanId === loan.id)) loan.status = "done";
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
    credit(state, f, `lost${localId(state, s.id)}`, agreed ? `${s.name} fell on a mission they agreed to` : fight ? `${s.name} fell in your fight` : `${s.name} died in your care`, v, "fight");
    log(state, agreed ? `${f.name} mourn ${s.name}, who fell on the work they came for.` : fight ? `${f.name} mourn ${s.name}, who fell fighting for you.` : `${f.name} blame you for ${s.name}'s death ${cause}.`, "danger");
  }
  const loan = loansOf(state).find((l) => l.id === s.loan.id);
  if (loan) loan.dead = (loan.dead || 0) + 1;
  // Their body leaves the roster: the group buried them (they are not on your memorial wall).
  const i = state.survivors.indexOf(s);
  if (i >= 0) state.survivors.splice(i, 1);
  s.diedDay = day(state);
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
  const p = walk(state, f, "opparty", people, nearestBase(state, f, o.tile), o.tile, { opId: o.id });
  if (!p) { giveBack(state, f, people); g.status = "refused"; return null; }
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
  const M = OPS[o.op].mission;
  const req = { id: V.nextAsk++, fid: f.id, partyId: team.id, n: p.people.length, days: LOAN.OP_DAYS, mission: M === "cull" || M === "crawl" ? "escort" : M, label: `the joint operation (${OPS[o.op].label.toLowerCase()})`, day: day(state), share: o.share, cargoStart: cargoOf(team), homeBaseId: team.homeBaseId, opId: o.id };
  (V.reqs || (V.reqs = [])).push(req);
  o.reqs.push(req.id);
  for (const s of p.people.filter((x) => x.alive)) {
    s.role = "volunteer";
    s.vol = { fid: f.id, group: f.name, req: req.id, mission: req.mission, label: req.label, since: state.hour, until: state.hour + LOAN.OP_DAYS * 24, days: LOAN.OP_DAYS, lent: allCarried(s).filter(Boolean), fought: 0, op: o.id };
    s.location = { kind: "coming", partyId: team.id, eta: state.hour };
    V.people.push(s);
  }
  p.people = [];
  removeParty(state, p);
  g.status = "joined";
  o.status = "met";
  o.teamId = team.id;
  log(state, `${f.name}'s fighters met your team at ${tileLabel(state, o.tile)} for the joint operation: their group's orders in a fight, beside yours.`, "good");
}
const cargoOf = (p) => { const out = {}; for (const [k, v] of Object.entries((p.cargo && p.cargo.supplies) || {})) if (Number.isFinite(v) && v > 0 && SUPPLIES[k]) out[k] = v; return out; };
function opGoHome(state, p, f) {
  const home = f.bases.length ? nearestBase(state, f, partyTile(p)) : null;
  const res = home != null ? planPath(state, partyTile(p), home, false, f.id) : null;
  if (!res) { giveBack(state, f, p.people); p.people = []; removeParty(state, p); return; }
  p.path = res.path; p.idx = 0; p.progress = 0; p.phase = "back";
}

// ---------- their parties (parties.js aiPartyHour) ----------
// kind "loan" / "opparty" at the end of its way.
export function loanPartyArrive(state, p) {
  const f = factionById(state, p.owner);
  if (p.phase === "back") return goHome(state, p, f);
  if (p.kind === "loan") { const loan = loansOf(state).find((l) => l.id === p.loanId); if (loan) return loanArrive(state, p, loan, f); return goHome(state, p, f); }
  const o = opById(state, p.opId), g = o ? o.groups.find((x) => x.partyId === p.id) : null;
  if (!o || !g || o.status === "done" || o.status === "off" || g.status === "missed") return opGoHome(state, p, f);
  g.status = "waiting";
  p.phase = "wait";
}
function goHome(state, p, f) {
  if (f && f.alive) giveBack(state, f, p.people || []);
  p.people = [];
  const loan = p.loanId != null ? loansOf(state).find((l) => l.id === p.loanId) : null;
  removeParty(state, p);
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
    const f = factionById(state, loan.fid);
    const why = state.hour >= Math.min(...people.map((s) => s.loan.until)) ? "their time is up" : recallWhy(state, f);
    if (why) endLoan(state, loan, why);
  }
  for (const o of V.ops || []) opHour(state, o);
  if (state.hour % 24 === 0) aiProposalsDaily(state);
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
