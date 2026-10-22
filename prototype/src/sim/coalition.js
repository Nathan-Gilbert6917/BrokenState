// Keeping the Calder Coalition together (the user's request, 2026-10-21: "balance the needs and wants of all the other
// groups ... like balancing relations in a Total War game mixed with Civilization"). alliance.js holds who is in; this
// holds how each member feels about it, and the asks that test it.
//
// Standing (Civ-style modifiers on top of the existing numbers)
// - A member's standing toward you is its goodwill (factions.js) plus named modifiers ("Sent aid +9, fading", "Refused
//   military aid −6"); between two members, their relation (diplomacy.js) plus theirs. standing / pairStanding;
//   standingParts / pairParts give the breakdown the Coalition standing tab shows.
// - Every act is split (remember): LAST of it goes into goodwill (or the relation) for good, the rest is a memory that
//   fades to nothing in its kind's days. The same kind on the same pair stacks, up to ±MOD_CAP.
// - Some last while a thing holds (conditions): you fight beside them in a war, your people are lent to them; between
//   members, border friction (bases within BORDER.range), trade (a pact between them), a common enemy. These build up a
//   little a day to their cap and fade once it stops. Incidents (a clash on the border, a joint patrol) come now and
//   then by hash dice, so the members drift apart on their own and the balance needs keeping.
//
// Asks (choice cards through the card system: cardrules.js pauses and auto-answers them; the default is to refuse)
// - One open at a time, every few days (GAP, shorter with more members), never on a council day. Kinds:
//   dispute: two members quarrel (the worst pair first): side with one (it up, the other down, they sour), split the
//     difference (small hits to both, they mend a little, more with Speech), or stay out of it (both down).
//   favour: a member asks for something at another's expense (your word on a claim, your scouts' reports, your gates
//     shut to the other's caravans): grant (up with it, down with the other, they sour) or refuse.
//   trade: a member short of something offers its surplus for it, a little over the value.
//   aid: a member short of something asks for it, for nothing but goodwill.
//   military: a member at war, with a horde at its walls or a hive crawl coming (volunteers.js groupNeed) asks for
//     fighters (your people lent: volunteers.js answerAsk), rounds, or (at war) that you join its war (diplomacy.js
//     joinWar).
//   expel: a member whose standing with another falls under its grudge line demands that one is thrown out
//     (alliance.js expel), or talks at your table (TALKS: food to both, they mend; the demand is not refused).
//     Refused DEMAND_MAX times, or once while things are past its quit line, it leaves.
// - Accepting costs goods or people; refusing costs standing, times the refusal fatigue.
//
// Refusal fatigue: a tally of accepts and refusals per member and for the coalition, each fading TALLY_FADE a day. The
// refusal hit is × fatigue (1 + FAT.OWN a refusal over the accepts with that member + FAT.ALL one with the coalition, at
// most FAT.MAX), and while a member's refusals outweigh the accepts its "Requests ignored" memory deepens NEGLECT a
// day for each one over. The council's asks and the groups' calls for volunteers count too (alliance.js, volunteers.js).
//
// Tolerance bands (by the member's type, ± a few by its own dice: band)
// - leave: under it a member may leave, a little likelier each day it stays under (LEAVE_P); under LEAVE_GOODWILL
//   (alliance.js, 20) it leaves at once, as before.
// - hostile: a member that leaves under it turns hostile (goodwill HOSTILE_GW, the pact torn up), and a warlike type
//   declares war on you (playerwars.js declareOnPlayer).
// - grudge: its standing with another member under it, it demands that member's expulsion; quit (QUIT_GAP under it) and
//   a refusal sends it out.
// Members leaving or expelled leave the land count and the victory's "no group outside" (alliance.js).
// Without a radio link (envoys.js, 2026-10-21): an ask is carried by the asker's envoy and its card comes up only when
// the envoy reaches your gates (raise → envoys.js envoyAsk; askCard's `focus` builds it again for that member then);
// while one is on its way no other ask is raised. Answered at your gates, what the answer does to the asker's books
// (remember, noteAnswer) waits in a sink until its envoy is home (withSink, replaySink), and the goods you send ride
// with the envoy (sendGoods; takeGoods takes theirs out of what the envoy brought).
// Dice: hash01 (skills.js) on the seed, the day and the groups' names, so the world's other streams are not shifted.
import { day, log, hub, factionById, addCard, atBase, skill, localId } from "./world.js";
import { changeGoodwill } from "./factions.js";
import { goodwillMult } from "./traits.js";
import { hash01, gainXp, USE } from "./skills.js";
import { relation, changeRelation, baseDistance, pactBetween, warsOf, enemyIn, joinWar, joinProblem, news, knownAs } from "./diplomacy.js";
import { ensureAlliance, allianceMembers, isMember, expel, leaveAlliance, nextCouncilDay, landCentres, ALLIANCE } from "./alliance.js";
import { lendable, groupNeed, answerAsk, makeAskQuiet } from "./volunteers.js";
import { declareOnPlayer, atWarWithYou } from "./playerwars.js";
import { weightOf } from "./groupcare.js";
import { radioSpeech } from "./radio.js";
import { need, available, groupStockKey } from "./trade.js";
import { supplyAmt, useSupply, isRoundKey } from "./rounds.js";
import { payRoundsOf, suppliesText } from "./ammo.js";
import { moveFoodUnits } from "./foods.js";
import { supValue } from "./data.js";
import { playerClaims } from "./claims.js";
import { note } from "./ledger.js";
import { foodIn } from "./foods.js";
import { talkSink, withTalk } from "./talk.js"; // an answer carried home by an envoy
import { envoyAsk, askInFlight } from "./envoys.js"; // asks carried in person without a radio link (call-time only)

export const BAL = {
  LAST: 0.25, MOD_CAP: 30,
  DAYS: { aid: 40, trade: 30, refused: 30, sided: 45, favour: 40, split: 30, fight: 50, expel: 60, kept: 45, incident: 40, neglect: 30 }, // a memory fades to nothing in this many days
  TALLY_FADE: 0.99, FAT: { OWN: 0.2, ALL: 0.05, MAX: 3 }, NEGLECT: 0.1, NEGLECT_CAP: 20,
  GAP: 10, GAP_MIN: 4, FIRST: 5,                 // days between asks: GAP − members (at least GAP_MIN) + 0–3
  LEAVE: 28, HOSTILE_GAP: 35, GRUDGE: -25, QUIT_GAP: 30, LEAVE_P: [0.04, 0.02, 0.02], // leave chance: base + per point under + per day under (≤ 0.5)
  TOL: { commune: -4, traders: -2, fortress: 2, military: 4, expansionist: 6, zealot: 8, raider: 10 }, // touchier types leave sooner
  DEMAND_MAX: 3, DEMAND_GAP: 12, HOSTILE_GW: -45, // playerwars.js PW.HOSTILE_GW (not read here: the modules import each other)
  BORDER: { range: 8, step: -0.12, cap: -12 }, TRADE: { step: 0.1, cap: 8 }, FOE: { rel: -30, step: 0.15, cap: 8 }, COND_FADE: 0.1,
  INCIDENT: { near: 0.012, far: 0.005, good: 0.006 },
  QTY: { food: 25, meds: 6, ammo: 60, fuel: 10, water: 30 }, // an ask's size
  GAIN: { aid: 12, aidOthers: 2, trade: 5, fighter: 4, fighterBase: 8, rounds: 6, war: 14, side: 10, sideLoss: -9, sidePair: -6, split: -3, splitPair: 4, out: -4, outPair: -3,
    favour: 10, favourLoss: -8, favourPair: -5, favourStood: 2, expelGain: 10, expelFriend: -5, refuse: { aid: -6, trade: -4, military: -7, favour: -6, expel: -8 } },
  BESIDE: 6, LENT: 4,
  TALKS: { food: 8, mend: 10, cost: -2 }, // an expulsion demand answered with talks: days of food to each side, + between them (and Speech / 2), − with the demander
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const sign = (v) => (v >= 0 ? `+${Math.round(v)}` : `−${Math.abs(Math.round(v))}`);
const dice = (state, ...k) => hash01(state.seed || 1, "coalition", ...k);
const SUP_WORD = { food: "food", meds: "meds", ammo: "rounds", fuel: "fuel", water: "water", scrap: "scrap", parts: "machine parts" };

// ---------- state ----------
// state.alliance.bal (made when first read: an old save starts with none).
export function ensureBalance(state) {
  const A = ensureAlliance(state);
  if (!A.bal) A.bal = { mods: [], rec: {}, all: { acc: 0, ref: 0, nAcc: 0, nRef: 0 }, next: null, low: {}, demands: {}, lastDemand: {}, seq: 1, stats: { asks: 0, accepted: 0, refused: 0, left: 0, hostile: 0, expelled: 0, incidents: 0 } };
  return A.bal;
}
const pairIds = (a, b) => (a.id < b.id ? [a.id, b.id] : [b.id, a.id]);
const modsOf = (state, aId, bId) => ensureBalance(state).mods.filter((m) => m.a === aId && m.b === bId);
export const youMods = (state, f) => modsOf(state, f.id, "you");
export const pairMods = (state, a, b) => { const [x, y] = pairIds(a, b); return modsOf(state, x, y); };
function addMod(state, aId, bId, key, label, v, days) {
  const B = ensureBalance(state);
  let m = B.mods.find((x) => x.a === aId && x.b === bId && x.key === key);
  if (!m) { m = { a: aId, b: bId, key, label, v: 0, fade: 0, day: day(state) }; B.mods.push(m); }
  m.v = clamp(m.v + v, -BAL.MOD_CAP, BAL.MOD_CAP);
  m.label = label;
  m.day = day(state);
  m.fade = days > 0 ? Math.abs(m.v) / days : 0;
  return m;
}
// ---------- an answer carried by an envoy (envoys.js) ----------
// sink (talk.js): { calls: [], goods: { key: q } (what you send rides with their envoy), from: { key: q } | null (what
// their envoy brought), fid, inPerson }. Inside withSink, remember and noteAnswer (and factions.js changeGoodwill on the
// sending group) are kept as calls for replaySink.
export const withSink = withTalk;
// The calls kept, made now. who(id): the group for an id (gone: the call is dropped).
export function replaySink(state, calls, who = (id) => factionById(state, id)) {
  for (const c of calls || []) {
    const f = who(c.f);
    if (!f || !f.alive) continue;
    if (c.op === "note") { noteAnswer(state, f, c.accepted); continue; }
    if (c.op === "gw") { changeGoodwill(state, f, c.amount, c.reason, c.exact); continue; } // factions.js: their goodwill, now they hear it
    const o = c.other === "you" ? "you" : who(c.other);
    if (o && (o === "you" || o.alive)) remember(state, f, o, c.key, c.label, c.v, c.kind);
  }
}
// What a group can hand over: out of what its envoy brought while answering at your gates, else its stores.
const spareOf = (st, f, k) => (talkSink() && talkSink().from ? (k === "food" ? foodIn(talkSink().from) : talkSink().from[groupStockKey(k, f)] || 0) : available(f, k));

// An act remembered: other is "you" or a member. LAST of v for good (goodwill or the relation), the rest fading over
// the kind's days. Returns the immediate change.
export function remember(state, f, other, key, label, v, kind = key) {
  if (!f || !v) return 0;
  const SINK = talkSink();
  if (SINK) { SINK.calls.push({ op: "remember", f: f.id, other: other === "you" ? "you" : other.id, key, label, v, kind }); return v; } // envoys.js: when the envoy is home
  const days = BAL.DAYS[kind] || 40;
  if (other === "you") {
    changeGoodwill(state, f, v * BAL.LAST, label.toLowerCase());
    addMod(state, f.id, "you", key, label, v * (1 - BAL.LAST) * goodwillMult(state, v), days);
  } else {
    changeRelation(state, f, other, v * BAL.LAST);
    const [x, y] = pairIds(f, other);
    addMod(state, x, y, key, label, v * (1 - BAL.LAST), days);
  }
  return v;
}
// What lasts while a thing holds (toward you): [{ label, v }].
function youConditions(state, f) {
  const out = [];
  if (state.diplo && state.diplo.wars.some((w) => w.playerSide === f.id)) out.push({ label: "You fight beside them", v: BAL.BESIDE });
  if (state.vols && state.vols.loans.some((l) => l.fid === f.id)) out.push({ label: "Your people fight with them", v: BAL.LENT });
  return out;
}
const sumMods = (ms) => ms.reduce((a, m) => a + m.v, 0);
export function standing(state, f) {
  return clamp(f.goodwill + sumMods(youMods(state, f)) + youConditions(state, f).reduce((a, c) => a + c.v, 0), -100, 100);
}
export function pairStanding(state, a, b) {
  return clamp(relation(state, a, b) + sumMods(pairMods(state, a, b)), -100, 100);
}
// The breakdown: [{ label, v, fading (days left, 0: while it holds), base }].
const modParts = (ms) => ms.filter((m) => Math.abs(m.v) >= 0.5).sort((p, q) => Math.abs(q.v) - Math.abs(p.v)).map((m) => ({ label: m.label, v: m.v, fading: m.fade > 0 ? Math.ceil(Math.abs(m.v) / m.fade) : 0 }));
export function standingParts(state, f) {
  return [{ label: "Goodwill", v: f.goodwill, base: true }, ...modParts(youMods(state, f)), ...youConditions(state, f).map((c) => ({ ...c, fading: 0 }))];
}
export function pairParts(state, a, b) {
  return [{ label: "Relations", v: relation(state, a, b), base: true }, ...modParts(pairMods(state, a, b))];
}

// ---------- the tally and fatigue ----------
const recOf = (state, f) => { const B = ensureBalance(state); return B.rec[f.id] || (B.rec[f.id] = { acc: 0, ref: 0, nAcc: 0, nRef: 0 }); };
export const recordOf = (state, f) => ({ tAcc: 0, tRef: 0, ...recOf(state, f) });
// Their answer to an ask of yours (loans.js: volunteers, a joint operation): on the record (tAcc / tRef), no fatigue.
export function noteTheirAnswer(state, f, yes) {
  if (!f || !isMember(state, f)) return;
  const r = recOf(state, f);
  if (yes) r.tAcc = (r.tAcc || 0) + 1; else r.tRef = (r.tRef || 0) + 1;
}
// One answer to a member's ask (any: these cards, the council's, a call for volunteers). Not a member: nothing.
export function noteAnswer(state, f, accepted) {
  if (!f || !isMember(state, f)) return;
  const SINK = talkSink();
  if (SINK) { SINK.calls.push({ op: "note", f: f.id, accepted: !!accepted }); return; } // envoys.js: tallied when the envoy is home
  const B = ensureBalance(state), r = recOf(state, f);
  if (accepted) { r.acc++; r.nAcc++; B.all.acc++; B.all.nAcc++; B.stats.accepted++; } else { r.ref++; r.nRef++; B.all.ref++; B.all.nRef++; B.stats.refused++; }
}
export function fatigue(state, f) {
  const B = ensureBalance(state), r = recOf(state, f);
  return Math.min(BAL.FAT.MAX, 1 + BAL.FAT.OWN * Math.max(0, r.ref - r.acc) + BAL.FAT.ALL * Math.max(0, B.all.ref - B.all.acc));
}
// A refusal: tallied, and its hit × fatigue (the fatigue before this one counts).
function refused(state, f, key, label, v) {
  const hit = v * fatigue(state, f);
  noteAnswer(state, f, false);
  remember(state, f, "you", key, label, hit, "refused");
  return hit;
}
const accepted = (state, f, key, label, v, kind) => { noteAnswer(state, f, true); return remember(state, f, "you", key, label, v, kind); };

// ---------- tolerance bands ----------
export function band(state, f) {
  const off = Math.round((dice(state, "band", f.name) - 0.5) * 6);
  const leave = Math.max(ALLIANCE.LEAVE_GOODWILL + 1, BAL.LEAVE + (BAL.TOL[f.type] || 0) + off);
  const grudge = BAL.GRUDGE + (BAL.TOL[f.type] || 0);
  return { leave, hostile: leave - BAL.HOSTILE_GAP, grudge, quit: grudge - BAL.QUIT_GAP, floor: ALLIANCE.LEAVE_GOODWILL };
}
// Risk flags for the tab: [{ kind: "leave" | "hostile" | "uneasy" | "grudge" | "quit", text }].
export function risks(state, f) {
  const s = standing(state, f), b = band(state, f), out = [];
  if (s < b.leave) out.push({ kind: "leave", text: s < b.floor ? "leaving" : "may leave" });
  else if (s < b.leave + 8) out.push({ kind: "uneasy", text: "uneasy" });
  if (s < b.hostile + 10) out.push({ kind: "hostile", text: "may turn hostile if it leaves" });
  for (const o of allianceMembers(state)) {
    if (o === f) continue;
    const p = pairStanding(state, f, o);
    if (p < b.grudge) out.push({ kind: "grudge", text: `wants ${o.name} out` });
    const n = ensureBalance(state).demands[`${f.id}|${o.id}`] || 0;
    if (n > 0 && (n >= BAL.DEMAND_MAX - 1 || p < b.quit)) out.push({ kind: "quit", text: `may quit over ${o.name}` });
  }
  return out;
}
// The daily test of one member (alliance.js allianceDaily, before its other reasons to leave). True: it left.
export function toleranceCheck(state, f) {
  const B = ensureBalance(state), s = standing(state, f), b = band(state, f), d = day(state);
  if (s < b.floor) { breakAway(state, f, "it no longer trusts you", s < b.hostile); return true; }
  if (s >= b.leave) { delete B.low[f.id]; return false; }
  if (B.low[f.id] == null) { B.low[f.id] = d; log(state, `${f.name} is unhappy in ${ensureAlliance(state).name} (standing ${Math.round(s)}, under ${b.leave}): they may leave.`, "danger"); }
  const p = Math.min(0.5, BAL.LEAVE_P[0] + BAL.LEAVE_P[1] * (b.leave - s) + BAL.LEAVE_P[2] * (d - B.low[f.id]));
  if (dice(state, "leave", f.name, d) < p) { breakAway(state, f, "it lost faith in the coalition", s < b.hostile); return true; }
  return false;
}
// A member walks out; hostile: it tears up the pact and turns hostile, and a warlike type declares war on you.
export function breakAway(state, f, why, hostile = false) {
  const B = ensureBalance(state);
  leaveAlliance(state, f, why);
  B.stats.left++;
  forget(state, f);
  if (!hostile) return;
  B.stats.hostile++;
  if (f.goodwill > BAL.HOSTILE_GW) changeGoodwill(state, f, BAL.HOSTILE_GW - f.goodwill, "they left the coalition in anger", true);
  if (f.pact) f.pact = null;
  if (!state.noPlayerWars && hub(state) && !atWarWithYou(state, f) && weightOf(f, "warlike") >= 1) declareOnPlayer(state, f);
}
// A member gone: its memories and demands go with it (the tally stays, for a return).
function forget(state, f) {
  const B = ensureBalance(state);
  B.mods = B.mods.filter((m) => m.a !== f.id && m.b !== f.id);
  delete B.low[f.id];
  for (const k of Object.keys(B.demands)) if (k.split("|").includes(String(f.id))) delete B.demands[k];
}

// ---------- daily ----------
// alliance.js allianceDaily, after the members who leave: memories fade, the tally fades, standing drifts, incidents,
// demands and asks.
export function coalitionDaily(state, ms) {
  const B = ensureBalance(state);
  const ids = new Set(ms.map((f) => f.id));
  B.mods = B.mods.filter((m) => ids.has(m.a) && (m.b === "you" || ids.has(m.b)));
  for (const m of B.mods) if (m.fade > 0) m.v = Math.abs(m.v) <= m.fade ? 0 : m.v - Math.sign(m.v) * m.fade;
  B.mods = B.mods.filter((m) => m.v !== 0);
  for (const r of [...Object.values(B.rec), B.all]) { r.acc *= BAL.TALLY_FADE; r.ref *= BAL.TALLY_FADE; }
  if (!ms.length) return;
  for (const f of ms) neglect(state, f);
  pairDrift(state, ms);
  if (!hub(state) || state.cards.some((c) => c.coalAsk) || askInFlight(state)) return; // envoys.js: an ask on its way counts as open
  if (expelDemand(state, ms)) return;
  const d = day(state);
  if (B.next == null) B.next = d + BAL.FIRST;
  if (d < B.next || nextCouncilDay(state) === d) return;
  B.next = d + Math.max(BAL.GAP_MIN, BAL.GAP - ms.length) + Math.floor(dice(state, "gap", d) * 4);
  const kinds = ["trade", "aid", "military", "military"];
  if (ms.length >= 2) kinds.push("dispute", "dispute", "favour");
  const order = [...kinds].sort((p, q) => dice(state, "kind", d, p, kinds.indexOf(p)) - dice(state, "kind", d, q, kinds.indexOf(q)));
  for (const k of order) { const card = askCard(state, k, ms); if (card) { raise(state, card); return; } }
}
function raise(state, card) {
  const B = ensureBalance(state);
  B.stats.asks++;
  if (envoyAsk(state, card)) return card; // envoys.js: no radio link with the asker: its envoy carries the ask (the card on arrival)
  card.coalAsk = B.seq++;
  addCard(state, card);
  return card;
}
// An ask that came by envoy, as a card at your gates (envoys.js): its number in the "one open at a time" rule.
export function raiseArrived(state, card) {
  card.coalAsk = ensureBalance(state).seq++;
  addCard(state, card);
  return card;
}
// While refusals outweigh the accepts with a member, "Requests ignored" deepens; once they do not, it fades.
function neglect(state, f) {
  const r = recOf(state, f), over = r.ref - r.acc;
  const B = ensureBalance(state);
  const m = B.mods.find((x) => x.a === f.id && x.b === "you" && x.key === "neglect");
  if (over >= 1) {
    const n = addMod(state, f.id, "you", "neglect", "Requests ignored", -BAL.NEGLECT * over, 0);
    n.v = Math.max(n.v, -BAL.NEGLECT_CAP);
  } else if (m && m.fade === 0) m.fade = Math.max(0.1, Math.abs(m.v) / BAL.DAYS.neglect);
}
// Between members: border friction, trade, a common enemy (building to a cap while they hold), and incidents.
function pairDrift(state, ms) {
  const d = day(state);
  for (const a of ms) for (const b of ms) {
    if (a.id >= b.id) continue;
    const near = baseDistance(state, a, b) <= BAL.BORDER.range;
    grow(state, a, b, "border", "Border friction", near, BAL.BORDER.step, BAL.BORDER.cap);
    grow(state, a, b, "trade", "Trade between them", pactBetween(state, a, b), BAL.TRADE.step, BAL.TRADE.cap);
    const foe = state.factions.find((e) => e.alive && e !== a && e !== b && !isMember(state, e) && ((relation(state, a, e) <= BAL.FOE.rel && relation(state, b, e) <= BAL.FOE.rel) || (warsOf(state, a).some((w) => enemyIn(w, a) === e.id) && warsOf(state, b).some((w) => enemyIn(w, b) === e.id))));
    grow(state, a, b, "foe", foe ? `A common enemy (${knownAs(state, foe)})` : "A common enemy", !!foe, BAL.FOE.step, BAL.FOE.cap);
    incident(state, a, b, near, d);
  }
}
function grow(state, a, b, key, label, holds, step, top) {
  const [x, y] = pairIds(a, b);
  const B = ensureBalance(state);
  let m = B.mods.find((z) => z.a === x && z.b === y && z.key === key);
  if (holds) {
    if (!m) { m = { a: x, b: y, key, label, v: 0, fade: 0, day: day(state) }; B.mods.push(m); }
    m.label = label;
    m.fade = 0;
    m.v = top < 0 ? Math.max(top, m.v + step) : Math.min(top, m.v + step);
  } else if (m && m.fade === 0) m.fade = BAL.COND_FADE;
}
const BAD = ["a clash between their patrols", "a quarrel over salvage at a site between them", "a caravan turned back at the gate", "stolen livestock"];
const GOOD = ["a joint patrol against the dead", "a shared harvest", "a wedding between their people"];
function incident(state, a, b, near, d) {
  const r = dice(state, "incident", a.name, b.name, d);
  const bad = near ? BAL.INCIDENT.near : BAL.INCIDENT.far;
  const B = ensureBalance(state);
  if (r < bad) {
    const what = BAD[Math.floor(dice(state, "what", a.name, b.name, d) * BAD.length)];
    const v = -(6 + Math.round(dice(state, "size", a.name, b.name, d) * 6));
    remember(state, a, b, `inc${d}`, cap(what), v, "incident");
    B.stats.incidents++;
    news(state, `${cap(knownAs(state, a))} and ${knownAs(state, b)} fell out over ${what}.`, "info", [a, b]);
  } else if (r < bad + BAL.INCIDENT.good) {
    const what = GOOD[Math.floor(dice(state, "what", a.name, b.name, d) * GOOD.length)];
    remember(state, a, b, `inc${d}`, cap(what), 5 + Math.round(dice(state, "size", a.name, b.name, d) * 4), "incident");
    news(state, `${cap(knownAs(state, a))} and ${knownAs(state, b)} grew closer: ${what}.`, "good", [a, b]);
  }
}

// ---------- the asks ----------
const lastAsked = (state, f) => ensureBalance(state).lastDemand[f.id];
// The worst pair under a member's grudge line: it demands the other's expulsion (once every DEMAND_GAP days).
function expelDemand(state, ms) {
  if (ms.length < 2) return false;
  const B = ensureBalance(state), d = day(state);
  let best = null;
  for (const a of ms) for (const b of ms) {
    if (a === b) continue;
    const p = pairStanding(state, a, b), g = band(state, a).grudge;
    if (p >= g) continue;
    if (lastAsked(state, a) != null && d - lastAsked(state, a) < BAL.DEMAND_GAP) continue;
    const depth = g - p + a.pop / 100;
    if (!best || depth > best.depth) best = { a, b, depth };
  }
  if (!best) return false;
  B.lastDemand[best.a.id] = d;
  raise(state, expelCard(state, best.a, best.b));
  return true;
}
// focus: the ids the ask is about ([asker] or [a, b]: envoys.js builds an ask again when its envoy arrives); params: a
// trade's { k, j, q } (what the envoy brought for it).
export function askCard(state, kind, ms = allianceMembers(state), focus = null, params = null) {
  if (kind === "dispute") return disputeCard(state, ms, focus);
  if (kind === "favour") return favourCard(state, ms, focus);
  if (kind === "trade") return tradeCard(state, ms, focus, params);
  if (kind === "aid") return aidCard(state, ms, focus);
  if (kind === "military") return militaryCard(state, ms, focus);
  if (kind === "expel" && focus) { const a = factionById(state, focus[0]), b = factionById(state, focus[1]); return a && b && isMember(state, a) && isMember(state, b) ? expelCard(state, a, b) : null; }
  if (kind === "expel") { // the worst pair (the tools; the daily demand waits for a grudge)
    let best = null;
    for (const a of ms) for (const b of ms) if (a !== b && (!best || pairStanding(state, a, b) < best.p)) best = { a, b, p: pairStanding(state, a, b) };
    return best ? expelCard(state, best.a, best.b) : null;
  }
  return null;
}
const style = (state) => { const g = state.governor; return g ? g.style || g.personality || "balanced" : "balanced"; };
// The governor's lean: more willing the closer a member is to its leave line.
const worry = (state, f) => { const s = standing(state, f), b = band(state, f); return s < b.leave + 10 ? 2 : s < b.leave + 25 ? 1 : 0; };
const bandHint = (state, f) => { const b = band(state, f); return `standing ${Math.round(standing(state, f))}, leaves under ${b.leave}`; };
const fatHint = (state, f) => { const x = fatigue(state, f); return x > 1.01 ? ` (×${x.toFixed(1)}: you refuse more than you grant)` : ""; };

const inFocus = (focus, ...fs) => !focus || fs.every((f, i) => f.id === focus[i]);
function disputeCard(state, ms, focus = null) {
  const pairs = [];
  for (const a of ms) for (const b of ms) if (a.id < b.id && (!focus || (focus.includes(a.id) && focus.includes(b.id)))) pairs.push({ a, b, p: pairStanding(state, a, b) });
  if (!pairs.length) return null;
  pairs.sort((x, y) => x.p - y.p || x.a.id - y.a.id);
  const { a, b } = pairs[0].p < 25 ? pairs[0] : pairs[Math.floor(dice(state, "pair", day(state)) * pairs.length)];
  const near = baseDistance(state, a, b) <= BAL.BORDER.range;
  const WHAT = near ? ["the farmland between their bases", "a well both claim", "where the border runs"] : ["salvage rights at a site between them", "a caravan one robbed of the other's goods", "a debt one says the other never paid"];
  const what = WHAT[Math.floor(dice(state, "what", a.name, b.name, day(state)) * WHAT.length)];
  const speech = radioSpeech(state);
  const mend = BAL.GAIN.splitPair + Math.round(speech / 2);
  const side = (st, win, lose) => {
    accepted(st, win, `backed${localId(st, lose.id)}`, `Backed them over ${lose.name}`, BAL.GAIN.side, "sided");
    refused(st, lose, `sided${localId(st, win.id)}`, `Sided with ${win.name}`, BAL.GAIN.sideLoss);
    remember(st, win, lose, "ruling", `Your ruling over ${what}`, BAL.GAIN.sidePair, "sided");
    return `You back ${win.name}. ${lose.name} will remember it.`;
  };
  const ai = (st, f, o) => (standing(st, f) < standing(st, o) ? 1 + worry(st, f) : 0.5);
  return {
    title: `Coalition: ${a.name} and ${b.name} quarrel`, coalIds: [a.id, b.id], coalKind: "dispute",
    text: `${a.name} and ${b.name} quarrel over ${what} and both look to you. (${a.name}: ${bandHint(state, a)}. ${b.name}: ${bandHint(state, b)}. Between them: ${Math.round(pairStanding(state, a, b))}.)`,
    choices: [
      { label: `Side with ${a.name}`, hint: `${sign(BAL.GAIN.side)} with ${a.name}, ${sign(BAL.GAIN.sideLoss * fatigue(state, b))} with ${b.name}${fatHint(state, b)}, ${sign(BAL.GAIN.sidePair)} between them`, ai: (st) => ai(st, a, b), resolve: (st) => side(st, a, b) },
      { label: `Side with ${b.name}`, hint: `${sign(BAL.GAIN.side)} with ${b.name}, ${sign(BAL.GAIN.sideLoss * fatigue(state, a))} with ${a.name}${fatHint(state, a)}, ${sign(BAL.GAIN.sidePair)} between them`, ai: (st) => ai(st, b, a), resolve: (st) => side(st, b, a) },
      { label: "Split the difference", hint: `${sign(BAL.GAIN.split)} with both, ${sign(mend)} between them (your best Speech at the hub helps)`, ai: () => 2.5,
        resolve: (st) => {
          const h = hub(st), t = h ? [...atBase(st, h.id)].sort((x, y) => skill(y, "speech") - skill(x, "speech") || x.id - y.id)[0] : null;
          if (t) gainXp(st, t, "speech", USE.radio || 2);
          remember(st, a, "you", "split", "A ruling nobody liked", BAL.GAIN.split, "split"); remember(st, b, "you", "split", "A ruling nobody liked", BAL.GAIN.split, "split");
          remember(st, a, b, "settled", "Settled a quarrel through you", mend, "split");
          return `You split ${what} between them. Neither is pleased, but they talk again.`;
        } },
      { label: "Stay out of it", hint: `${sign(BAL.GAIN.out * fatigue(state, a))} with ${a.name}, ${sign(BAL.GAIN.out * fatigue(state, b))} with ${b.name}, ${sign(BAL.GAIN.outPair)} between them`, ai: () => 0,
        resolve: (st) => { refused(st, a, "out", "Would not hear their quarrel", BAL.GAIN.out); refused(st, b, "out", "Would not hear their quarrel", BAL.GAIN.out); remember(st, a, b, "left", "Left to settle it alone", BAL.GAIN.outPair, "sided"); return "You stay out of it. They settle it badly between themselves."; } },
    ],
  };
}

const FAVOURS = [
  { ask: (o) => `your word behind their claim to the ground between them and ${o}`, did: "Backed their claim" },
  { ask: (o) => `what your scouts have seen of ${o}'s bases`, did: "Shared your scouts' reports" },
  { ask: (o) => `your gates shut to ${o}'s caravans for a season`, did: "Shut your gates to them" },
  { ask: (o) => `the salvage rights you hold near ${o}`, did: "Gave them your salvage rights" },
];
function favourCard(state, ms, focus = null) {
  const d = day(state);
  const opts = [];
  for (const a of ms) for (const b of ms) if (a !== b && inFocus(focus, a, b)) opts.push({ a, b, p: pairStanding(state, a, b) });
  if (!opts.length) return null;
  opts.sort((x, y) => x.p - y.p || dice(state, "fav", d, x.a.name, x.b.name) - dice(state, "fav", d, y.a.name, y.b.name));
  const { a, b } = opts[Math.floor(dice(state, "favpick", d) * Math.min(3, opts.length))];
  const F = FAVOURS[Math.floor(dice(state, "favkind", d, a.name) * FAVOURS.length)];
  return {
    title: `Coalition: ${a.name} want a favour`, coalIds: [a.id, b.id], coalKind: "favour",
    text: `${a.name} ask for ${F.ask(b.name)}. It would please them and sting ${b.name}. (${a.name}: ${bandHint(state, a)}. ${b.name}: ${bandHint(state, b)}.)`,
    choices: [
      { label: "Grant it", hint: `${sign(BAL.GAIN.favour)} with ${a.name}, ${sign(BAL.GAIN.favourLoss)} with ${b.name}, ${sign(BAL.GAIN.favourPair)} between them`, ai: (st) => (standing(st, a) < standing(st, b) ? 1 + worry(st, a) : 0.3),
        resolve: (st) => { accepted(st, a, "favour", F.did, BAL.GAIN.favour, "favour"); remember(st, b, "you", `favoured${localId(st, a.id)}`, `Favoured ${a.name} over them`, BAL.GAIN.favourLoss, "favour"); remember(st, a, b, "favour", `You favoured ${a.name}`, BAL.GAIN.favourPair, "favour"); return `You grant ${a.name}'s request. ${b.name} hear of it.`; } },
      { label: "Refuse", hint: `${sign(BAL.GAIN.refuse.favour * fatigue(state, a))} with ${a.name}${fatHint(state, a)}, ${sign(BAL.GAIN.favourStood)} with ${b.name}`, ai: (st) => 1 - worry(st, a) * 0.4,
        resolve: (st) => { refused(st, a, "nofavour", "Refused them a favour", BAL.GAIN.refuse.favour); remember(st, b, "you", "stood", "Stood by them", BAL.GAIN.favourStood, "favour"); return `You refuse ${a.name}.`; } },
    ],
  };
}

// Goods between the hub and a member (the council's way: food in days, rounds by calibre, a group's pooled keys).
function sendGoods(state, f, k, qty) {
  const h = hub(state);
  const rec = k === "ammo" ? payRoundsOf(state, h, qty) : { [k]: qty };
  const SINK = talkSink();
  const to = SINK ? SINK.goods : null; // envoys.js: onto their envoy, into their stores when it is home
  for (const [kk, q] of Object.entries(rec)) {
    if (kk === "food") { moveFoodUnits(h, to || f, q, { state }); continue; }
    useSupply(h.stock, kk, q);
    const tk = isRoundKey(kk) || kk === "ammo" ? kk : groupStockKey(kk, f);
    if (to) { to[tk] = (to[tk] || 0) + q; continue; } // the ledger's note when they are home (envoys.js)
    f.stock[tk] = (f.stock[tk] || 0) + q;
    if (isRoundKey(kk) || kk === "ammo") note(state, "from you", q); // ledger.js: rounds into the AI side
  }
  return rec;
}
function takeGoods(state, f, k, qty) {
  const h = hub(state);
  const SINK = talkSink();
  const from = SINK && SINK.from ? SINK.from : null; // envoys.js: out of what their envoy brought
  if (k === "food") { moveFoodUnits(from || f, h, qty, { state }); return; }
  const tk = groupStockKey(k, f);
  if (from) from[tk] = Math.max(0, (from[tk] || 0) - qty);
  else f.stock[tk] = Math.max(0, (f.stock[tk] || 0) - qty);
  h.stock[k] = (h.stock[k] || 0) + qty;
}
const hubHas = (state, k) => { const h = hub(state); return h ? supplyAmt(h.stock, k) : 0; };
const shortOf = (f) => Object.keys(BAL.QTY).filter((k) => need(f, k) >= 1.3);

function aidCard(state, ms, focus = null) {
  const opts = [];
  for (const f of ms) if (inFocus(focus, f)) for (const k of shortOf(f)) if (hubHas(state, k) >= BAL.QTY[k]) opts.push({ f, k });
  if (!opts.length) return null;
  const { f, k } = opts[Math.floor(dice(state, "aid", day(state)) * opts.length)];
  const qty = BAL.QTY[k], h = hub(state), others = ms.filter((m) => m !== f);
  return {
    title: `Coalition: ${f.name} ask for aid`, coalIds: [f.id], coalKind: "aid",
    text: `${f.name} are short of ${SUP_WORD[k]} and ask the coalition's leader for ${qty} ${SUP_WORD[k]}: nothing in return but their thanks. (${bandHint(state, f)}.)`,
    choices: [
      { label: `Send ${qty} ${SUP_WORD[k]}`, hint: `${h.name} has ${Math.floor(hubHas(state, k))}. ${sign(BAL.GAIN.aid)} with ${f.name}${others.length ? `, ${sign(BAL.GAIN.aidOthers)} with the other members` : ""}`, disabled: (st) => hubHas(st, k) < qty,
        ai: (st) => (hubHas(st, k) >= qty * 2 ? 1 + worry(st, f) + (style(st) === "diplomat" ? 2 : 0) : -1),
        resolve: (st) => {
          if (hubHas(st, k) < qty) return `${hub(st).name} no longer has ${qty} ${SUP_WORD[k]}.`;
          const sent = sendGoods(st, f, k, qty);
          accepted(st, f, "aid", "Sent aid", BAL.GAIN.aid, "aid");
          for (const o of others) remember(st, o, "you", "generous", "Generous to a member", BAL.GAIN.aidOthers, "aid");
          return `${suppliesText(sent)} sent to ${f.name}.`;
        } },
      { label: "Refuse", hint: `${sign(BAL.GAIN.refuse.aid * fatigue(state, f))} with ${f.name}${fatHint(state, f)}`, ai: () => 0.5, resolve: (st) => { refused(st, f, "noaid", "Refused them aid", BAL.GAIN.refuse.aid); return `You send nothing to ${f.name}.`; } },
    ],
  };
}

const GIVE = ["meds", "fuel", "scrap", "water", "parts", "food"];
function tradeCard(state, ms, focus = null, params = null) {
  if (params) { const f = ms.find((m) => inFocus(focus, m)); return f ? tradeOffer(state, f, params.k, params.j, params.q) : null; }
  const opts = [];
  for (const f of ms) if (inFocus(focus, f)) for (const k of shortOf(f)) {
    if (hubHas(state, k) < BAL.QTY[k] * 2) continue;
    const value = BAL.QTY[k] * supValue(k === "ammo" ? "ammo" : k) * 1.15;
    for (const j of GIVE) {
      if (j === k || !(supValue(j) > 0)) continue;
      const q = Math.ceil(value / supValue(j));
      if (available(f, j) >= q) opts.push({ f, k, j, q });
    }
  }
  if (!opts.length) return null;
  const { f, k, j, q } = opts[Math.floor(dice(state, "trade", day(state)) * opts.length)];
  return tradeOffer(state, f, k, j, q);
}
// f offers q of j for BAL.QTY[k] of k (coalTrade: what an envoy carries for it, envoys.js).
function tradeOffer(state, f, k, j, q) {
  const qty = BAL.QTY[k];
  return {
    title: `Coalition: ${f.name} offer a trade`, coalIds: [f.id], coalKind: "trade", coalTrade: { k, j, q },
    text: `${f.name} need ${SUP_WORD[k]} and offer ${q} ${SUP_WORD[j]} for ${qty} ${SUP_WORD[k]}, a little over the value. (${bandHint(state, f)}.)`,
    choices: [
      { label: `Trade ${qty} ${SUP_WORD[k]} for ${q} ${SUP_WORD[j]}`, hint: `${sign(BAL.GAIN.trade)} with ${f.name}`, disabled: (st) => hubHas(st, k) < qty || spareOf(st, f, j) < q,
        ai: (st) => (hubHas(st, k) >= qty * 2 ? 3 + worry(st, f) : -1),
        resolve: (st) => {
          if (hubHas(st, k) < qty || spareOf(st, f, j) < q) return "The goods are no longer there.";
          const sent = sendGoods(st, f, k, qty);
          takeGoods(st, f, j, q);
          accepted(st, f, "trade", "Traded when they needed it", BAL.GAIN.trade, "trade");
          return `${suppliesText(sent)} to ${f.name} for ${q} ${SUP_WORD[j]}.`;
        } },
      { label: "Refuse", hint: `${sign(BAL.GAIN.refuse.trade * fatigue(state, f))} with ${f.name}${fatHint(state, f)}`, ai: () => 0.5, resolve: (st) => { refused(st, f, "notrade", "Turned down their trade", BAL.GAIN.refuse.trade); return `You turn down ${f.name}'s trade.`; } },
    ],
  };
}

function militaryCard(state, ms, focus = null) {
  const opts = ms.filter((f) => inFocus(focus, f)).map((f) => ({ f, need: groupNeed(state, f) })).filter((o) => o.need);
  if (!opts.length) return null;
  const { f, need: nd } = opts[Math.floor(dice(state, "mil", day(state)) * opts.length)];
  const days = 4 + Math.floor(dice(state, "days", day(state), f.name) * 4);
  const pool = lendable(state);
  const war = nd.kind === "war" ? warsOf(state, f).find((w) => { const e = factionById(state, enemyIn(w, f)); return e && !isMember(state, e) && !joinProblem(state, w, f); }) : null;
  const choices = [];
  const first = (s) => String(s.name).split(" ")[0];
  for (const k of [1, 2]) {
    if (pool.length < k) continue;
    const gain = BAL.GAIN.fighterBase + BAL.GAIN.fighter * k;
    choices.push({ label: `Send ${k} fighter${k === 1 ? "" : "s"}: ${pool.slice(0, k).map(first).join(", ")}`, hint: `Away about ${days} days with ${f.name}, out of your orders, fighting by the numbers. ${sign(gain)} with them`,
      disabled: (st) => lendable(st).length < k,
      ai: (st) => { const home = hub(st) ? atBase(st, hub(st).id).length : 0; return home - k >= 10 ? 1.5 + worry(st, f) - k * 0.3 + (style(st) === "diplomat" ? 1.5 : 0) : -1; },
      resolve: (st) => {
        const ids = lendable(st).slice(0, k).map((s) => s.id);
        if (ids.length < k) return "Nobody fit to go.";
        const ask = makeAskQuiet(st, f, nd, k, days);
        const t = answerAsk(st, ask.id, ids);
        accepted(st, f, "fighters", "Sent fighters", gain, "fight");
        return t;
      } });
  }
  const R = BAL.QTY.ammo;
  choices.push({ label: `Send ${R} rounds`, hint: `By calibre, the ones your guns need least. ${sign(BAL.GAIN.rounds)} with ${f.name}`, disabled: (st) => hubHas(st, "ammo") < R,
    ai: (st) => (hubHas(st, "ammo") >= R * 4 ? 1.5 + worry(st, f) : -1),
    resolve: (st) => { if (hubHas(st, "ammo") < R) return "The rounds are gone."; const sent = sendGoods(st, f, "ammo", R); accepted(st, f, "rounds", "Sent rounds for their fight", BAL.GAIN.rounds, "fight"); return `${suppliesText(sent)} sent to ${f.name}.`; } });
  if (war) {
    const foe = factionById(state, enemyIn(war, f));
    choices.push({ label: `Join their war on ${foe.known ? foe.name : "their enemy"}`, hint: `${foe.known ? foe.name : "Their enemy"} turns hostile and may raid you. ${sign(BAL.GAIN.war)} with ${f.name}, and more while you fight beside them`,
      disabled: (st) => !!joinProblem(st, war, f), ai: () => -0.5,
      resolve: (st) => { const t = joinWar(st, war.id, f.id); if (/beside/.test(t)) accepted(st, f, "war", "Joined their war", BAL.GAIN.war, "fight"); return t; } });
  }
  choices.push({ label: "Refuse", hint: `${sign(BAL.GAIN.refuse.military * fatigue(state, f))} with ${f.name}${fatHint(state, f)}`, ai: () => 0.4,
    resolve: (st) => { refused(st, f, "nofight", "Left them to fight alone", BAL.GAIN.refuse.military); return `You send no help to ${f.name}.`; } });
  return {
    title: `Coalition: ${f.name} want military aid`, coalIds: [f.id], coalKind: "military",
    text: `${f.name} call on the coalition for ${nd.label}: fighters, rounds${war ? ", or your banner beside theirs" : ""}. (${bandHint(state, f)}.)`,
    choices,
  };
}

export function expelCard(state, a, b) {
  const B = ensureBalance(state);
  const key = `${a.id}|${b.id}`;
  const n = B.demands[key] || 0;
  const g = band(state, a);
  const friends = () => allianceMembers(state).filter((m) => m !== a && m !== b && pairStanding(state, m, b) >= 20);
  const last = n + 1 >= BAL.DEMAND_MAX || pairStanding(state, a, b) < g.quit;
  return {
    title: `Coalition: ${a.name} demand ${b.name}'s expulsion`, coalIds: [a.id, b.id], coalKind: "expel",
    text: `${a.name} will not sit in council with ${b.name} (between them: ${Math.round(pairStanding(state, a, b))}) and demand you throw them out.${n ? ` They have asked ${n} time${n === 1 ? "" : "s"} before.` : ""}${last ? ` Refuse and ${a.name} leave the coalition.` : ""} (${a.name}: ${bandHint(state, a)}. ${b.name}: ${bandHint(state, b)}.)`,
    choices: [
      { label: `Expel ${b.name}`, hint: `${b.name} leave (goodwill −15) and their land stops counting. ${sign(BAL.GAIN.expelGain)} with ${a.name}${friends().length ? `, ${sign(BAL.GAIN.expelFriend)} with their friends (${friends().map((m) => m.name).join(", ")})` : ""}`,
        ai: (st) => (last && a.pop > b.pop ? 1.2 : 0.1),
        resolve: (st) => {
          if (!isMember(st, b)) return `${b.name} are no longer in the coalition.`;
          const fr = friends();
          const t = expel(st, b);
          ensureBalance(st).stats.expelled++;
          forget(st, b);
          accepted(st, a, "expelled", `You threw out ${b.name}`, BAL.GAIN.expelGain, "expel");
          for (const m of fr) remember(st, m, "you", `expelled${localId(st, b.id)}`, `Threw out their friend ${b.name}`, BAL.GAIN.expelFriend, "expel");
          delete ensureBalance(st).demands[key];
          return t;
        } },
      { label: "Hold talks between them", hint: `${BAL.TALKS.food} days of food from ${hub(state) ? hub(state).name : "the hub"} to each side's table: ${sign(BAL.TALKS.mend + Math.round(radioSpeech(state) / 2))} between them (your best Speech helps), ${sign(BAL.TALKS.cost)} with ${a.name}; the demand stands, not counted as a refusal`,
        disabled: (st) => hubHas(st, "food") < BAL.TALKS.food * 2, ai: (st) => (hubHas(st, "food") >= BAL.TALKS.food * 8 ? 1 + (last ? 0.5 : 0) : -1),
        resolve: (st) => {
          if (!isMember(st, a) || !isMember(st, b)) return "One of them has left the coalition.";
          if (hubHas(st, "food") < BAL.TALKS.food * 2) return `${hub(st).name} cannot feed the talks.`;
          sendGoods(st, a, "food", BAL.TALKS.food); sendGoods(st, b, "food", BAL.TALKS.food);
          const h = hub(st), t = h ? [...atBase(st, h.id)].sort((x, y) => skill(y, "speech") - skill(x, "speech") || x.id - y.id)[0] : null;
          if (t) gainXp(st, t, "speech", USE.radio || 2);
          remember(st, a, b, "talks", "Talks at your table", BAL.TALKS.mend + Math.round(radioSpeech(st) / 2), "split");
          remember(st, a, "you", "talks", `Made them sit down with ${b.name}`, BAL.TALKS.cost, "split");
          return `${a.name} and ${b.name} sit down at your table. Things are calmer between them, for now.`;
        } },
      { label: "Refuse", hint: `${sign(BAL.GAIN.refuse.expel * fatigue(state, a))} with ${a.name}${fatHint(state, a)}${last ? `, and ${a.name} leave` : ` (${BAL.DEMAND_MAX - n - 1} more refusal${BAL.DEMAND_MAX - n - 1 === 1 ? "" : "s"} and they leave)`}`, ai: () => 0.6,
        resolve: (st) => {
          if (!isMember(st, a)) return `${a.name} are no longer in the coalition.`;
          const Bs = ensureBalance(st);
          refused(st, a, `kept${localId(st, b.id)}`, `Kept ${b.name} in the coalition`, BAL.GAIN.refuse.expel);
          Bs.demands[key] = (Bs.demands[key] || 0) + 1;
          if (Bs.demands[key] >= BAL.DEMAND_MAX || pairStanding(st, a, b) < band(st, a).quit) {
            breakAway(st, a, `you kept ${b.name} in`, standing(st, a) < band(st, a).hostile);
            return `You keep ${b.name}. ${a.name} walk out of the coalition.`;
          }
          return `You keep ${b.name}. ${a.name} will not forget it.`;
        } },
    ],
  };
}

// ---------- the land at stake ----------
// The coalition's land share if this member left today (the tab's "if they leave" line): alliance.js controlledLand's
// count without its bases.
export function landWithout(state, f) {
  const g = state.grid, mark = new Uint8Array(state.tiles.length), own = new Set(f ? f.bases : []);
  for (const c of landCentres(state)) if (!own.has(c.tile)) for (const id of g.within(c.tile, c.r)) mark[id] = 1;
  for (const id of playerClaims(state)) mark[id] = 1;
  let land = 0, held = 0;
  for (const t of state.tiles) { if (t.terrain === "water") continue; land++; if (mark[t.id]) held++; }
  return land ? held / land : 0;
}

// The codex and help text (a function: ALLIANCE is not there yet while the modules load).
export const coalitionHelp = () => `<b>Keeping the coalition together.</b> Each member's <b>standing</b> toward you is its goodwill plus what it remembers: aid sent, trades, fights fought beside it, favours, rulings, refusals. Each act moves standing at once; ${Math.round(BAL.LAST * 100)}% of it stays in their goodwill for good and the rest fades over a month or two. Between members the same: their relations plus border friction, trade, a common enemy and what you did between them; members drift apart on their own. Every few days a member asks something of you (a quarrel to rule on, a favour at another's expense, a trade, aid, fighters or rounds for a fight). Granting costs goods or people; refusing costs standing, and the more you refuse against what you grant, the harder each refusal lands (up to ×${BAL.FAT.MAX}) and the faster standing drains ("Requests ignored"). Each member has a band by its kind: under its leave line it may walk out (under ${ALLIANCE.LEAVE_GOODWILL} it goes at once), and far enough under it turns hostile (a warlike kind declares war). A member that cannot stand another demands its expulsion: expel it, hold talks at your table (food to both, they mend a little), or refuse; refuse ${BAL.DEMAND_MAX} times and it leaves. A member gone takes its land out of the victory count, and leaves a group outside the coalition. The Coalition standing tab shows it all.`;
