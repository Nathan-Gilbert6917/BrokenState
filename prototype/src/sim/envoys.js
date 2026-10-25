// Envoys (the user's request 2026-10-21: "before radios are set up between groups when you select to communicate you
// must send a convoy of at least one survivor to give the message in person. AI groups must do this for you as
// well ... Radios should be a mid to late game communication"). Word between two parties with no working radio link
// (radio.js canRadioGroup: your coverage + 6 reaching their base AND a set of their own; between groups, groupsLinked)
// goes in person, and the answer comes back the same way.
//
// Your messages (communicate; the Diplomacy window's Envoys tab and a group's card: Communicate…)
// - aid (goods for standing), trade (goods for goods), a pact (non-aggression or trade), an invitation to the coalition,
//   a request for aid (goods) or military aid (they harry the next raid on you), news or a warning (a horde near
//   them: it helps standing a little), a request to recover your convoy (convoyrecover.js: their party drives your
//   abandoned vehicles to a base or a tile of yours, the fee carried as aid is). A pending request of theirs is answered
//   on its card (answerNow puts it first).
// - With a radio link the answer is instant (as the radio's calls always were). Goods still have to be carried: aid
//   and a trade are agreed over the air and an envoy takes the goods (handed over when it gets there); aid you ask
//   for comes by their caravan (caravans.js sendCaravan, a gift).
// - Without one an envoy goes: a team of yours (parties.js mission "envoy") of at least one survivor, a vehicle if you
//   like, the goods in its cargo by the carry rules, food and water for the trip there and back (estimateTrip × PACK).
//   It walks the map at the team's pace and meets the road like any team (events.js travel cards, conflicts.js road
//   fights and contact, the weather); its people are away from the base (no work, no walls).
// - Locked to its errand (envoyLocked): no orders, no queue, no turning home, no changing the team; a card that would
//   leave it waiting for orders sends it on instead (envoyCarryOn).
// - On arrival they answer (aiAnswer) and what happens at their table happens then (deliver): your goods into their
//   stores, theirs into the envoy's cargo, their feelings toward you (coalition.js remember for a member, goodwill
//   otherwise). You learn the answer only when the envoy is home (envoyHome): the log line, the Envoys tab, and what
//   needs both sides to know is sealed then (the pact signed, the coalition joined, their news on your map).
// - Killed on the way out: the message never arrives, nobody answers, and it is no refusal. Killed on the way back:
//   they answered and what happened at their table stands (goods handed over, their feelings); what they gave is lost
//   with the envoy (its death site), the agreement lapses (the signed word never got home) and you never learn the
//   answer. Either way, once the trip is OVERDUE × the planned time + OVERDUE_H hours late, "No word from our envoy".
// - Lost out of your radio coverage (decided 2026-10-22: "Fix the envoy message for lost team"): nothing is said when
//   it happens (parties.js unheardEnvoy: no death lines, no "whole team was lost", no death site or vehicle marked on
//   the map: envoyLostQuiet keeps the names on the message). "No word from our envoy" at the overdue hour is the first
//   you hear of it and gives them up for lost by name (noteOverdue). In your radio coverage its radio reports at once,
//   as any team's (p.radioLive). Your memorial wall and the grief of their friends still come when they die (the
//   people at home do not hear it, but the game keeps one record of a death).
//
// Their messages
// - A coalition ask (coalition.js) from a member with no radio link: its envoy (an AI party, kind "envoy", on the map
//   with its errand, interceptable: caravanraids.js roadCaravans) carries it to your hub, and the card comes up only
//   when it arrives (envoyAiArrive: askCard built again for that member). A trade's goods ride with it. Answered, it
//   goes home with your answer and the goods you sent; the asker's books (remember, noteAnswer) change when it is home
//   (coalition.js withSink / replaySink). Killed on the way: no ask (no refusal); on the way back: they never hear
//   your answer (nothing tallied) and your goods are lost with it.
// - Between members (AI ↔ AI, coarsely): what your answer does between the asker and another member that neither
//   your radio nor the asker's reaches goes by courier, an AI envoy from the asker to that member (kind "word"),
//   applied when it arrives.
// - The seasonal council: members with no radio link send delegates to your hub (councilByDelegates); the council
//   sits when every delegate is in or lost, or after COUNCIL_WAIT days, with those present (alliance.js holdCouncil),
//   and the delegates go home once its business is done. Their goodwill moves at the table: they were there.
// - Their envoys never start a fight (conflicts.js enemyParty); raiders and the dead on the road take them like any
//   caravan (parties.js aiPartyHour).
//
// The AI's answer (aiAnswer): chance p = 0.5 + (standing + ODDS.base[kind] + ODDS.type[type] + needs) / 100, kept
// to 2–98%, against hash dice (seed, the message's number): standing is coalition.js standing for a member, goodwill
// otherwise; needs: a trade's value to them (each good × supValue × their need, 0.5–2) got against given; a request
// for aid, how much they have spare and need it; military aid, the coalition, a pact, their own war or a horde. A
// gift is always taken, a pact signed by the radio's rules (trade.js proposePact), an invitation accepted when they
// would join (alliance.js inviteProblem, in person). A hostile group hears nothing.
import { day, log, hub, baseById, factionById, snapshot, survivorById, addCard, atBase } from "./world.js";
import { attitude, changeGoodwill } from "./factions.js";
import { canRadioGroup, groupNetwork, netCovers, tradeBase, refusal, offerCard, inCoverage } from "./radio.js";
import { launchExpedition, estimateTrip, spawnAiParty, removeParty, partyTile, partyMembers, planPath, startReturn, tileLabel, carryCapacity, supplyLoad, teamName } from "./parties.js";
import { vehicleById, travelMode, isCar } from "./vehicles.js";
import { hash01 } from "./skills.js";
import { need, available, groupStockKey, proposePact } from "./trade.js";
import { supValue, SUPPLIES, FACTION_TYPES } from "./data.js";
import { moveFoodUnits, foodIn, addFood, FOODS } from "./foods.js";
import { useSupply, supplyAmt, isRoundKey } from "./rounds.js";
import { payRoundsOf, suppliesText } from "./ammo.js";
import { isMember, allianceMembers, inviteProblem, inviteToAlliance, holdCouncil, ensureAlliance, joinAskCard, shareSightings } from "./alliance.js";
import { standing, remember, withSink, replaySink, askCard, raiseArrived, noteTheirAnswer } from "./coalition.js";
import { warsOf, warById, enemyIn, warCard, pactBetween, warBetween, ensureDiplo, knownAs, news as diploNews, startWar, makePeace } from "./diplomacy.js";
import { sendCaravan } from "./caravans.js";
import { note } from "./ledger.js";
import { RAW } from "./water.js";
import { loanQuote, sendLoan, opQuote, joinOp, noteOpAnswer, planOp, opById, proposalCard, loansHour, OPS } from "./loans.js"; // volunteers on loan, joint operations
import { ensureVols, askById, askCard as volAskCard, VOL } from "./volunteers.js";
import { jobById, jobArrived, offerCard as jobOfferCard } from "./jobs.js";
import { blocById, blocInviteCard } from "./blocs.js";
import { pwarById, sueCard, demandCard, declareOnPlayer, offerTerms } from "./playerwars.js";
import { withTalk } from "./talk.js"; // the sending group's side waits for its envoy home
import { negotiationCard } from "./ransom.js"; // a ransom's price, once the envoy is home
import { keepAnswer, keepDelivered, keepHome } from "./loans.js"; // loaned people who want to stay
import { recoverProblem, recoverAnswer, recoverFee, sendRecovery, recoverDest } from "./convoyrecover.js"; // Recover our convoy (call-time only)

export const ENVOY = {
  PACK: 1.3, PACK_MIN: 1,      // food and water packed: the round trip's (estimateTrip) × PACK, at least PACK_MIN day a head more
  OVERDUE: 1.5, OVERDUE_H: 24, // "no word" once the planned round trip × OVERDUE + OVERDUE_H hours have gone by
  AI_HEADS: 2,                 // the people in a group's envoy
  COUNCIL_WAIT: 5,             // days the council waits for its delegates
  HARRY_DAYS: 14, HARRY: 0.7, HARRY_RANGE: 20, // military aid: the next raid on a base of yours within range is cut to 70%
  GAIN: { aidPer: 15, aidMin: 2, aidMax: 15, trade: 3, warn: 4, news: 1, askAid: -3, askMil: -4 },
  ODDS: {
    base: { trade: 0, askaid: -15, askmil: -25 },
    type: { traders: { trade: 15 }, commune: { askaid: 10 }, fortress: { askmil: 5 }, military: { askmil: 10 }, raider: { all: -20 }, zealot: { all: -15 }, expansionist: { all: -10 } },
    member: 20, pact: 10, war: -25, horde: -15,
  },
  KEEP: 40, // finished messages kept for the list
};
// What can be sent, and the goods an envoy may carry or ask for (food in days, rounds as "ammo" of any calibre).
export const KINDS = {
  aid: { label: "Offer aid", carry: true, desc: "Goods for nothing but their thanks: standing with them." },
  trade: { label: "Offer a trade", carry: true, desc: "Your goods for theirs: they weigh what they get by what they need." },
  pact: { label: "Propose a pact", desc: "Non-aggression, or a trade pact (goodwill 20+)." },
  invite: { label: "Invite to the coalition", desc: "Goodwill 50+, a pact and a job done for them (or the council's vote)." },
  askaid: { label: "Ask for aid", desc: "Some of their goods for nothing: they give what they can spare, and it costs a little standing." },
  askmil: { label: "Ask for military aid", desc: `Their fighters harry the next raid on a base of yours within ${ENVOY.HARRY_RANGE} tiles of them (its strength × ${ENVOY.HARRY}) for ${ENVOY.HARRY_DAYS} days.` },
  news: { label: "Send news or a warning", desc: "What you know of the dead near them: a warning of a horde near their land helps standing a little; they tell you what they see in return." },
  volunteers: { label: "Request volunteers", desc: "Some of their people to live and work at a base of yours for a span of days (loans.js): at work, on your teams, in your fights. They weigh it by standing, their kind, their own headcount and trouble, the purpose and what you offer." },
  recover: { label: "Recover our convoy", carry: true, favour: true, desc: "They send a party to the tile where your vehicles stand abandoned, get them and their cargo out and drive them to your nearest base, a base you pick or a tile you pick. For a fee in the goods they need, by the distance and what the convoy is worth, paid on agreement (convoyrecover.js). Only a group you stand well with takes the job." },
  jointop: { label: "Propose a joint operation", desc: "A hive, a crawl, a group's base, a horde or a place to raid, together: their fighters meet your team at a rendezvous on a day and join it (loans.js). A share of the loot makes them likelier to come." },
  // Sent from elsewhere (hidden from the composer): peace terms (playerwars.js offerTerms), a ransom's price (ransom.js),
  // keeping loaned people who want to stay (loans.js askToKeep).
  terms: { label: "Offer peace terms", hidden: true, war: true, desc: "Your terms, under a white flag." },
  ransom: { label: "Ask their price for your people", hidden: true, war: true, desc: "What they want for the people they hold." },
  keep: { label: "Ask to keep their people", hidden: true, desc: "Some of their people on loan want to stay with you." },
};
export const GOODS = ["food", "water", "meds", "ammo", "fuel", "scrap", "parts"];
export const GET_GOODS = ["food", "water", "meds", "fuel", "scrap", "parts"];
export const ENVOY_LOCKED = "The envoy is on its errand: it carries its message there and the answer home, and takes no other orders.";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const WORD = { food: "days of food", water: "water", meds: "meds", ammo: "rounds", fuel: "fuel", scrap: "scrap", parts: "machine parts" };
const goodsText = (g) => Object.entries(g || {}).filter(([, q]) => q > 0).map(([k, q]) => `${Math.round(q)} ${WORD[k] || k}`).join(", ") || "nothing";

// ---------- state ----------
// state.envoys (made when first read: an old save has none). msgs: { id, from ("you" | group id), to, kind, payload,
// via ("radio" | "envoy"), status ("travelling" | "delivered" | "returned" | "lost"), partyId, sent, overdueAt,
// delivered, returned, answer ({ yes, text }: yours to see once it is home), noted (the "no word" line), ... }.
export function ensureEnvoys(state) {
  if (!state.envoys) state.envoys = { seq: 1, msgs: [], council: null, harry: {}, stats: { sent: 0, delivered: 0, returned: 0, lost: 0, theirs: 0 } };
  return state.envoys;
}
export const msgById = (state, id) => (state.envoys ? state.envoys.msgs.find((m) => m.id === id) : null) || null;
function newMsg(state, m) {
  const E = ensureEnvoys(state);
  const msg = { id: E.seq++, status: "travelling", sent: state.hour, partyId: null, overdueAt: null, delivered: null, returned: null, answer: null, payload: {}, ...m };
  E.msgs.push(msg);
  if (msg.from === "you") E.stats.sent++; else E.stats.theirs++;
  return msg;
}
const nameOf = (state, id) => (id === "you" ? "you" : (factionById(state, id) || {}).name || "a group");

// ---------- links ----------
// Between two groups: either one's network (radio.js groupNetwork: its stations and linked masts) covers a base of the
// other's, and both have one.
export function groupsLinked(state, a, b) {
  if (!a || !b || a === b) return !!a && a === b;
  const na = groupNetwork(state, a), nb = groupNetwork(state, b);
  if (!na || !nb) return false;
  return b.bases.some((t) => netCovers(state, na, t)) || a.bases.some((t) => netCovers(state, nb, t));
}
// How word reaches a group from you: "radio" or "envoy".
export const commsWith = (state, f) => (canRadioGroup(state, f) ? "radio" : "envoy");
// A team of yours on an envoy's errand.
export const envoyLocked = (p) => !!p && p.owner === "player" && p.envoy != null;
// An ask on its way to you (coalition.js: one open at a time).
export const askInFlight = (state) => !!state.envoys && state.envoys.msgs.some((m) => m.kind === "ask" && m.to === "you" && m.status === "travelling");

// ---------- the AI's answer ----------
const valueTo = (f, goods) => Object.entries(goods || {}).reduce((a, [k, q]) => a + q * (supValue(k) || 0) * clamp(need(f, k), 0.5, 2), 0);
const standOf = (state, f) => (isMember(state, f) ? standing(state, f) : f.goodwill);
const hordeNear = (state, f, r = 12) => state.hordes.find((h) => f.bases.some((b) => state.grid.distance(b, h.tile) <= r)) || null;
// { yes, p, why }: p the chance (null: a rule, no dice).
export function aiAnswer(state, f, kind, payload = {}, salt = 0) {
  if (!f || !f.alive) return { yes: false, p: null, why: "nobody is left to answer" };
  if (attitude(f) === "Hostile" && !(KINDS[kind] && KINDS[kind].war)) return { yes: false, p: null, why: `${f.name} would not hear you` };
  if (kind === "terms" || kind === "ransom") return { yes: true, p: null, why: "" }; // heard: the answer is theirs at the table (deliver)
  if (kind === "keep") return keepAnswer(state, f, payload); // loans.js: by standing and their kind
  if (kind === "aid" || kind === "news") return { yes: true, p: null, why: "" };
  if (kind === "pact") {
    const k = payload.pact === "trade" ? "trade" : "nonaggression";
    const needed = k === "trade" ? 20 : FACTION_TYPES[f.type] && FACTION_TYPES[f.type].attitude === "Aggressive" ? -15 : -10; // trade.js proposePact's lines
    if (f.pact === k || (k === "nonaggression" && f.pact === "trade")) return { yes: false, p: null, why: "you already have that pact" };
    return f.goodwill >= needed ? { yes: true, p: null, why: "" } : { yes: false, p: null, why: `they want goodwill ${needed} for it (now ${Math.round(f.goodwill)})` };
  }
  if (kind === "invite") { const why = inviteProblem(state, f, true); return { yes: !why, p: null, why }; }
  if (kind === "recover") return recoverAnswer(state, f, payload, hash01(state.seed || 1, "envoy", salt, kind, f.name)); // convoyrecover.js
  if (kind === "volunteers" || kind === "jointop") { // loans.js: volunteers.js askQuote's points and more
    const o = kind === "jointop" ? opById(state, payload.opId) : null;
    if (kind === "jointop" && !o) return { yes: false, p: null, why: "there is no such operation" };
    const q = kind === "jointop" ? opQuote(state, f, o) : loanQuote(state, f, payload);
    const worst = [...(q.parts || [])].sort((a, b) => a.v - b.v)[0];
    return { yes: !!q.yes, p: null, points: q.points, why: q.yes ? "" : q.refuse || (worst ? `${worst.label} weighs against it` : "they said no") };
  }
  const T = ENVOY.ODDS.type[f.type] || {};
  let needs = 0;
  if (kind === "trade") {
    for (const [k, q] of Object.entries(payload.get || {})) if (available(f, k) < q) return { yes: false, p: null, why: `they cannot spare ${q} ${WORD[k] || k}` };
    const got = valueTo(f, payload.give), gave = valueTo(f, payload.get);
    if (!(got > 0) || !(gave > 0)) return { yes: false, p: null, why: "nothing to trade" };
    needs = clamp((got / gave - 1) * 100, -60, 40);
  } else if (kind === "askaid") {
    const k = payload.key, q = Math.max(0, Number(payload.qty) || 0);
    if (!GET_GOODS.includes(k) || q < 1) return { yes: false, p: null, why: "nothing asked for" };
    if (available(f, k) < q) return { yes: false, p: null, why: `they cannot spare ${q} ${WORD[k]}` };
    needs = (1 - clamp(need(f, k), 0, 2)) * 40 - (q * (supValue(k) || 0)) / 10;
  } else if (kind === "askmil") {
    needs = (isMember(state, f) ? ENVOY.ODDS.member : 0) + (f.pact ? ENVOY.ODDS.pact : 0) + (warsOf(state, f).length ? ENVOY.ODDS.war : 0) + (hordeNear(state, f, 8) ? ENVOY.ODDS.horde : 0);
  } else return { yes: false, p: null, why: "they do not follow you" };
  const s = standOf(state, f) + (ENVOY.ODDS.base[kind] || 0) + (T[kind] || 0) + (T.all || 0) + needs;
  const p = clamp(0.5 + s / 100, 0.02, 0.98);
  const yes = hash01(state.seed || 1, "envoy", salt, kind, f.name) < p;
  return { yes, p, why: yes ? "" : "they said no" };
}

// ---------- what happens at their table (deliver) and at home (sealed) ----------
function credit(state, f, key, label, v, kind) {
  if (!v) return;
  if (isMember(state, f)) remember(state, f, "you", key, label, v, kind); // coalition.js: a quarter for good, the rest fading
  else changeGoodwill(state, f, v, label.toLowerCase());
}
// The goods an envoy carries (packed: the keys as packed: food in days, rounds by calibre) into their stores.
function handOver(state, f, p, packed) {
  for (const [k, q] of Object.entries(packed || {})) {
    if (!(q > 0)) continue;
    if (k === "food") { moveFoodUnits(p.cargo, f, Math.min(q, foodIn(p.cargo.supplies)), { state }); continue; }
    const got = Math.min(q, Math.max(0, p.cargo.supplies[k] || 0));
    if (!(got > 0)) continue;
    p.cargo.supplies[k] -= got;
    const tk = isRoundKey(k) ? k : groupStockKey(k, f);
    f.stock[tk] = (f.stock[tk] || 0) + got;
    if (isRoundKey(k)) note(state, "from you", got); // ledger.js: rounds into the AI side
  }
}
// Their goods into the envoy's cargo (a trade's other side, the aid you asked for).
function takeFrom(state, f, p, goods) {
  for (const [k, q] of Object.entries(goods || {})) {
    if (!(q > 0)) continue;
    if (k === "food") { moveFoodUnits(f, p.cargo, q, { state }); continue; }
    const tk = groupStockKey(k, f);
    const got = Math.min(q, Math.max(0, f.stock[tk] || 0));
    f.stock[tk] = (f.stock[tk] || 0) - got;
    p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + got;
  }
}
// The message delivered: their answer (msg.answer, decided now unless the radio already did) and what it does there.
function deliver(state, msg, f, p) {
  const P = msg.payload || {};
  const a = msg.answer || aiAnswer(state, f, msg.kind, P, msg.id);
  msg.answer = { yes: !!a.yes, why: a.why || "", text: "" };
  msg.delivered = state.hour;
  msg.status = "delivered";
  ensureEnvoys(state).stats.delivered++;
  f.lastDiplomacy = day(state);
  const yes = msg.answer.yes;
  let text = "";
  if (msg.kind === "aid") {
    if (yes) {
      const v = clamp(Math.round(valueTo(f, P.goods) / ENVOY.GAIN.aidPer), ENVOY.GAIN.aidMin, ENVOY.GAIN.aidMax);
      if (p) handOver(state, f, p, msg.packed);
      credit(state, f, "aid", "Sent aid", v, "aid");
      text = `${f.name} took the aid (${goodsText(P.goods)}) with thanks.`;
    } else text = `${f.name} turned your envoy away: ${a.why}.`;
  } else if (msg.kind === "trade") {
    if (yes) {
      if (p) { handOver(state, f, p, msg.packed); takeFrom(state, f, p, P.get); }
      credit(state, f, "trade", "Traded with them", ENVOY.GAIN.trade, "trade");
      text = `${f.name} agreed to the trade: ${goodsText(P.give)} for ${goodsText(P.get)}.`;
    } else text = `${f.name} would not trade (${a.why}).`;
  } else if (msg.kind === "pact") {
    text = yes ? `${f.name} agreed to a ${P.pact === "trade" ? "trade" : "non-aggression"} pact.` : `${f.name} would not sign: ${a.why}.`;
  } else if (msg.kind === "invite") {
    text = yes ? `${f.name} accepted your invitation to ${ensureAlliance(state).name}.` : `${f.name} would not join: ${a.why}`;
  } else if (msg.kind === "askaid") {
    if (yes) {
      if (p) takeFrom(state, f, p, { [P.key]: P.qty });
      credit(state, f, "askaid", "Asked a favour", ENVOY.GAIN.askAid, "favour");
      text = `${f.name} gave ${P.qty} ${WORD[P.key]}.`;
    } else text = `${f.name} would not give ${P.qty} ${WORD[P.key]} (${a.why}).`;
  } else if (msg.kind === "askmil") {
    if (yes) {
      ensureEnvoys(state).harry[f.id] = day(state) + ENVOY.HARRY_DAYS;
      credit(state, f, "askmil", "Asked for their fighters", ENVOY.GAIN.askMil, "favour");
      text = `${f.name} will harry the next raid on a base of yours near them (for ${ENVOY.HARRY_DAYS} days).`;
    } else text = `${f.name} will not send fighters (${a.why}).`;
  } else if (msg.kind === "volunteers") {
    const loan = yes ? sendLoan(state, f, P, msg.id) : null;
    if (yes && !loan) { msg.answer.yes = false; msg.answer.why = "they could not get anyone to you"; }
    noteTheirAnswer(state, f, !!loan);
    if (!loan) ensureVols(state).refused[f.id] = day(state);
    text = loan ? `${f.name} send ${loan.n} of theirs to ${(baseById(state, loan.baseId) || {}).name} for ${loan.days} days.` : `${f.name} will send nobody (${msg.answer.why}).`;
  } else if (msg.kind === "jointop") {
    const o = opById(state, P.opId);
    const party = yes && o ? joinOp(state, f, o, msg.id) : null;
    if (yes && !party) { msg.answer.yes = false; msg.answer.why = "they could not get anyone there"; }
    if (o && !party) noteOpAnswer(state, f, o, false);
    noteTheirAnswer(state, f, !!party);
    text = party ? `${f.name} join the operation: ${o.groups.find((g) => g.fid === f.id).n} of theirs at ${tileLabel(state, o.tile)} on day ${o.day}.` : `${f.name} will not join the operation (${msg.answer.why}).`;
  } else if (msg.kind === "terms") { // playerwars.js: they weigh your terms at their table; a peace there is made
    text = offerTerms(state, P.warId, P.key, true);
    msg.answer.yes = /accepted/.test(text);
  } else if (msg.kind === "ransom") { // ransom.js: their price, to haggle over when the envoy is home
    text = `${f.name} named their price for your people.`;
  } else if (msg.kind === "keep") { // loans.js: may their people stay with you?
    text = keepDelivered(state, f, P, msg.answer.yes);
  } else if (msg.kind === "recover") { // convoyrecover.js: the fee handed over, their party on its way
    const party = yes ? sendRecovery(state, f, msg) : null;
    if (yes && !party) { msg.answer.yes = false; msg.answer.why = "they could not get a party there"; }
    if (party && p) handOver(state, f, p, msg.packed);
    text = party ? `${f.name} took the job: their party goes for your convoy at ${tileLabel(state, msg.payload.tile)}.` : `${f.name} will not recover your convoy (${msg.answer.why}).`;
  } else if (msg.kind === "news") {
    if (yes) {
      const h = hordeNear(state, f);
      if (h) credit(state, f, "warned", "Warned them of a horde", ENVOY.GAIN.warn, "aid");
      else credit(state, f, "news", "Kept them informed", ENVOY.GAIN.news, "aid");
      text = h ? `${f.name} heard your warning of a horde of about ${h.size} near ${tileLabel(state, h.tile)}, and told you what they see.` : `${f.name} heard your news and told you what they see.`;
    } else text = `${f.name} would not hear your news (${a.why}).`;
  }
  msg.answer.text = text;
  return msg.answer;
}
// The answer home: what needs both sides is sealed (the pact signed, the coalition joined, their news on your map).
function sealHome(state, msg, f) {
  const a = msg.answer;
  if (!a || !f || !f.alive) return a ? a.text : "";
  let extra = "";
  if (a.yes && msg.kind === "pact") extra = ` ${proposePact(state, f, msg.payload.pact === "trade" ? "trade" : "nonaggression")}`;
  if (a.yes && msg.kind === "invite") extra = ` ${inviteToAlliance(state, f, true)}`;
  if (msg.kind === "ransom" && hub(state)) { // the price comes home: the talks' card (ransom.js)
    const ids = (msg.payload.ids || []).filter((id) => { const s = survivorById(state, id); return s && s.alive && s.location && s.location.kind === "captive" && s.location.factionId === f.id; });
    if (ids.length) addCard(state, negotiationCard(state, f, ids, { channel: "envoy" }));
  }
  if (msg.kind === "keep") extra = ` ${keepHome(state, f, msg.payload, a.yes)}`;
  if (a.yes && msg.kind === "news") {
    const g = state.grid, tiles = new Set();
    for (const b of f.bases) for (const id of g.within(b, 3)) tiles.add(id);
    for (const h of state.hordes) if (f.bases.some((b) => g.distance(b, h.tile) <= 10)) tiles.add(h.tile);
    for (const id of tiles) { const cur = state.knowledge[id]; if (!cur || cur.hour <= state.hour) state.knowledge[id] = snapshot(state, id); }
    extra = ` ${tiles.size} tiles around their land are on your map.`;
  }
  return `${a.text}${extra}`;
}

// ---------- your messages ----------
// Why this message cannot go ("" when it can). base: where it goes from (and its goods come out of).
export function messageProblem(state, f, kind, payload = {}, base = hub(state)) {
  if (!f || !f.alive || !f.bases.length) return "They are gone.";
  if (!f.known) return "You have not met them.";
  if (!KINDS[kind]) return "Pick what to send.";
  if (attitude(f) === "Hostile" && !(KINDS[kind] && KINDS[kind].war)) return `${f.name} are hostile: they would not hear an envoy.`;
  if (!base) return "You have no base to send from.";
  const has = (k, q) => (k === "food" ? foodIn(base.stock) : k === "ammo" ? supplyAmt(base.stock, "ammo") : k === "water" ? base.stock.water || 0 : base.stock[k] || 0) >= q;
  const pos = (g) => Object.entries(g || {}).filter(([, q]) => q > 0);
  if (kind === "aid") { if (!pos(payload.goods).length) return "Pick the goods to give."; const s = pos(payload.goods).find(([k, q]) => !GOODS.includes(k) || !has(k, q)); if (s) return `${base.name} has not ${s[1]} ${WORD[s[0]] || s[0]}.`; }
  if (kind === "trade") {
    if (!pos(payload.give).length || !pos(payload.get).length) return "Pick what you give and what you want.";
    const s = pos(payload.give).find(([k, q]) => !GOODS.includes(k) || !has(k, q)); if (s) return `${base.name} has not ${s[1]} ${WORD[s[0]] || s[0]}.`;
    if (pos(payload.get).some(([k]) => !GET_GOODS.includes(k))) return "Ask for food, water, meds, fuel, scrap or parts.";
  }
  if (kind === "askaid" && (!GET_GOODS.includes(payload.key) || !(payload.qty >= 1))) return "Pick what to ask for.";
  if (kind === "recover") { const why = recoverProblem(state, f, payload, base); if (why) return why; } // convoyrecover.js
  if (kind === "pact" && !["nonaggression", "trade"].includes(payload.pact)) return "Pick the pact.";
  if (kind === "invite" && isMember(state, f)) return `${f.name} is already in the coalition.`;
  if (kind === "invite" && (f.outsider || f.nomad)) return `${f.name} join nothing.`;
  if (kind === "volunteers") {
    if (!baseById(state, payload.baseId)) return "Pick the base they come to.";
    if (!(payload.n >= 1) || !(payload.days >= 1)) return "How many, and for how long?";
    const o = payload.offer;
    if (o && o.qty > 0 && !has(o.key, o.qty)) return `${base.name} has not ${o.qty} ${WORD[o.key] || o.key} to offer.`;
  }
  if (kind === "jointop") {
    const o = payload.opId != null ? opById(state, payload.opId) : null;
    if (payload.opId != null && (!o || o.status === "done" || o.status === "off")) return "That operation is over.";
    if (o && o.groups.some((g) => g.fid === f.id && g.status !== "refused")) return `${f.name} are already asked.`;
    if (!o && (!OPS[payload.op] || payload.target == null)) return "Pick the operation and its target.";
  }
  return "";
}
// The base of theirs an envoy goes to: the nearest to where it sets out.
const destOf = (state, f, home) => [...f.bases].sort((a, b) => state.grid.distance(home.tile, a) - state.grid.distance(home.tile, b) || a - b)[0];
// The envoy's trip as planned (the picker): { dest, path, hoursOut, hoursBack, food, water, fuel, load, cap, why }.
export function envoyPlan(state, { fid, kind, payload = {}, memberIds = [], vehicleId = null, fromBaseId = null }) {
  const f = factionById(state, fid);
  const home = fromBaseId != null ? baseById(state, fromBaseId) : hub(state);
  const out = { dest: null, path: [], hoursOut: 0, hoursBack: 0, food: 0, water: 0, fuel: 0, load: 0, cap: 0, why: "" };
  if (!f || !f.alive || !f.bases.length || !home) { out.why = "There is nobody to send to."; return out; }
  out.dest = destOf(state, f, home);
  const ids = [...new Set(memberIds)].filter((id) => { const s = survivorById(state, id); return s && s.alive && s.location && s.location.kind === "base" && s.location.baseId === home.id; });
  if (!ids.length) { out.why = "Pick at least one survivor at the base to go."; return out; }
  const v = vehicleId ? vehicleById(state, vehicleId) : null;
  if (vehicleId && (!v || v.loc.kind !== "base" || v.loc.baseId !== home.id)) { out.why = "That vehicle is not at the base."; return out; }
  const est = estimateTrip(state, { memberIds: ids, dest: out.dest, vehicle: travelMode(v), stance: "normal", homeBaseId: home.id, fuel: v ? (v.fuel || 0) + (home.stock.fuel || 0) : 0, v });
  if (!est) { out.why = v ? "No route there for the vehicle. Try on foot." : "No route there over land."; return out; }
  const n = ids.length;
  Object.assign(out, { path: est.path, hoursOut: est.hoursOut, hoursBack: est.hoursBack, food: Math.ceil(est.food * ENVOY.PACK + ENVOY.PACK_MIN * n), water: Math.ceil(est.water * ENVOY.PACK + ENVOY.PACK_MIN * n), fuel: v && isCar(v) ? Math.max(0, est.fuel - Math.floor(v.fuel || 0)) : 0 });
  const members = ids.map((id) => survivorById(state, id));
  const goods = kind === "aid" || kind === "recover" ? payload.goods : kind === "trade" ? payload.give : null;
  const back = kind === "trade" ? payload.get : kind === "askaid" ? { [payload.key]: payload.qty } : null;
  const asSup = (g) => Object.fromEntries(Object.entries(g || {}).filter(([, q]) => q > 0).map(([k, q]) => [k === "ammo" ? "a_9mm" : k, q])); // rounds weigh about as one another
  out.load = supplyLoad({ food: out.food, water: out.water, fuel: out.fuel }) + Math.max(supplyLoad(asSup(goods)), supplyLoad(asSup(back)));
  out.cap = carryCapacity(state, members, v);
  if (out.load > out.cap + 1e-9) out.why = `Too much to carry: ${Math.ceil(out.load)} kg for ${Math.floor(out.cap)} kg. Send more people, take a vehicle, or send less.`;
  else if ((home.stock.fuel || 0) < out.fuel) out.why = `Not enough fuel at ${home.name} for the drive (${out.fuel}).`;
  else if (foodIn(home.stock) < out.food + ((goods && goods.food) || 0)) out.why = `Not enough food at ${home.name} for the trip (${out.food} days).`;
  else if ((home.stock.water || 0) + (home.stock[RAW] || 0) < out.water + ((goods && goods.water) || 0)) out.why = `Not enough water at ${home.name} for the trip (${out.water}).`;
  return out;
}
// Send a message. opts: { fid, kind, payload, memberIds, vehicleId, fromBaseId }. With a radio link the answer is
// instant (goods still go by envoy, or by their caravan); without one an envoy goes. Returns { ok, text, msg, party }.
export function communicate(state, opts) {
  const f = factionById(state, opts.fid);
  const home = opts.fromBaseId != null ? baseById(state, opts.fromBaseId) : hub(state);
  const kind = opts.kind;
  let P = opts.payload || {};
  if (kind === "recover" && f) P = { tile: P.tile, dest: recoverDest(state, P.tile, P.dest), goods: recoverFee(state, f, P.tile, P.dest, home).goods }; // the fee as it stands now (convoyrecover.js)
  const why = messageProblem(state, f, kind, P, home);
  if (why) return { ok: false, text: why };
  if (kind === "jointop") { // loans.js: the operation, and this group asked to it
    const o = P.opId != null ? opById(state, P.opId) : planOp(state, { op: P.op, target: P.target, tile: P.tile ?? null, dayAt: P.dayAt ?? null, share: P.share || 0, n: P.n || 3 });
    const g = o.groups.find((x) => x.fid === f.id);
    if (g) g.status = "asked"; else o.groups.push({ fid: f.id, status: "asked" });
    P = { ...P, opId: o.id };
  }
  if (commsWith(state, f) === "radio") {
    const a = aiAnswer(state, f, kind, P, `r${ensureEnvoys(state).seq}`);
    if (!KINDS[kind].carry) {
      const msg = newMsg(state, { from: "you", to: f.id, kind, payload: P, via: "radio", answer: a });
      if (kind === "askaid" && a.yes) {
        const base = tradeBase(state, f);
        const c = base && sendCaravan(state, f, base, { goods: { supplies: { [P.key]: P.qty }, gear: [] }, gift: true }); // caravans.js: the goods come by their caravan
        if (!c) msg.answer = { yes: false, why: "they cannot get a caravan to you" };
      }
      deliver(state, msg, f, null);
      if (kind === "askaid" && msg.answer.yes) msg.answer.text = `${f.name} send ${P.qty} ${WORD[P.key]} by caravan.`;
      const text = sealHome(state, msg, f);
      msg.status = "returned"; msg.returned = state.hour;
      log(state, `On the radio, ${f.name}: ${text}`, msg.answer.yes ? "good" : "info");
      return { ok: true, text: `On the radio: ${text}`, msg };
    }
    if (!a.yes) { newMsg(state, { from: "you", to: f.id, kind, payload: P, via: "radio", answer: { ...a, text: `${f.name} said no on the radio: ${a.why}.` }, status: "returned", returned: state.hour }); return { ok: true, text: `On the radio, ${f.name} said no: ${a.why}.` }; }
    return launchEnvoy(state, f, home, kind, P, opts, { ...a, text: "" }, "radio");
  }
  return launchEnvoy(state, f, home, kind, P, opts, null, "envoy");
}
function launchEnvoy(state, f, home, kind, P, opts, answer, via) {
  const plan = envoyPlan(state, { ...opts, fid: f.id, fromBaseId: home.id });
  if (plan.why) return { ok: false, text: plan.why };
  const fuel = plan.fuel;
  const res = launchExpedition(state, { dest: plan.dest, mission: "envoy", stance: "normal", memberIds: opts.memberIds, vehicleId: opts.vehicleId || null, fromBaseId: home.id, supplies: { food: plan.food, water: plan.water, ...(fuel ? { fuel } : {}) }, quiet: true });
  if (res.error) return { ok: false, text: res.error };
  const p = res.party;
  const msg = newMsg(state, { from: "you", to: f.id, kind, payload: P, via, answer, partyId: p.id, base: plan.dest, home: home.id });
  msg.overdueAt = state.hour + Math.round((plan.hoursOut + plan.hoursBack + 6) * ENVOY.OVERDUE) + ENVOY.OVERDUE_H;
  msg.due = state.hour + Math.round(plan.hoursOut + plan.hoursBack + 6);
  p.envoy = msg.id;
  p.envoyTag = `✉ ${KINDS[kind].label.replace(/^(Offer|Propose|Send|Ask for) /, "")} · ${f.name}`;
  // The goods out of the base into its cargo (food in days, rounds by calibre: the ones your guns need least).
  const goods = kind === "aid" || kind === "recover" ? P.goods : kind === "trade" ? P.give : null;
  msg.packed = {};
  for (const [k, q] of Object.entries(goods || {})) {
    if (!(q > 0)) continue;
    if (k === "food") { const got = moveFoodUnits(home, p.cargo, q, { state }); msg.packed.food = got.units; continue; }
    if (k === "ammo") { for (const [kk, qq] of Object.entries(payRoundsOf(state, home, q))) { useSupply(home.stock, kk, qq); p.cargo.supplies[kk] = (p.cargo.supplies[kk] || 0) + qq; msg.packed[kk] = (msg.packed[kk] || 0) + qq; } continue; }
    const got = Math.min(q, Math.max(0, home.stock[k] || 0));
    home.stock[k] -= got;
    p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + got;
    msg.packed[k] = got;
  }
  const who = partyMembers(state, p).map((s) => s.name.split(" ")[0]).join(", ");
  const days = Math.max(1, Math.round((plan.hoursOut + plan.hoursBack) / 24));
  log(state, `${who} set${partyMembers(state, p).length === 1 ? "s" : ""} out as envoy${partyMembers(state, p).length === 1 ? "" : "s"} to ${f.name} at ${tileLabel(state, plan.dest)} (${KINDS[kind].label.toLowerCase()}${goods ? `: ${suppliesText(msg.packed) || goodsText(goods)}` : ""}). There in about ${Math.round(plan.hoursOut)}h; their answer comes home with them in about ${days} day${days === 1 ? "" : "s"}.`, "info");
  return { ok: true, text: via === "radio" ? `${f.name} agreed on the radio; the envoy takes the goods.` : `The envoy sets out for ${f.name}.`, msg, party: p };
}
// The envoy at their base (parties.js arrive, mission "envoy").
export function envoyArrive(state, p) {
  const msg = msgById(state, p.envoy);
  const f = msg ? factionById(state, msg.to) : null;
  if (msg && f && f.alive && f.bases.length && !f.bases.includes(partyTile(p))) { // their base moved (lost, given up): on to the nearest
    const to = destOf(state, f, { tile: partyTile(p) }), res = planPath(state, partyTile(p), to, p.vehicle);
    if (res) { msg.base = to; p.dest = to; p.path = res.path; p.idx = 0; p.progress = Math.min(0, p.progress || 0); p.phase = "out"; return ""; }
  }
  if (msg && f && f.alive && f.bases.includes(partyTile(p))) {
    deliver(state, msg, f, p);
    log(state, `${teamName(state, p)} reached ${f.name} at ${tileLabel(state, partyTile(p))}. Their answer comes home with the envoy.`, "info");
  } else if (msg) { msg.undelivered = true; msg.status = "delivered"; msg.answer = { yes: false, why: "", text: `There was nobody left at ${tileLabel(state, partyTile(p))} to hear it.` }; }
  p.envoyBack = true;
  startReturn(state, p);
  return "";
}
// Home with the answer (parties.js returnHome, before the cargo is unloaded).
export function envoyHome(state, p, home) {
  const msg = msgById(state, p.envoy);
  if (!msg) return;
  const f = factionById(state, msg.to);
  const text = msg.answer ? sealHome(state, msg, f) : `The envoy came back without reaching ${nameOf(state, msg.to)}.`;
  msg.status = "returned";
  msg.returned = state.hour;
  msg.homeText = text;
  ensureEnvoys(state).stats.returned++;
  log(state, `Our envoy is back at ${home.name} from ${nameOf(state, msg.to)}: ${text}`, msg.answer && msg.answer.yes ? "good" : "info");
  p.envoy = null;
}
// Something left the envoy waiting for orders (a card, a fight's end): it carries on with its errand. True: handled.
export function envoyCarryOn(state, p, text) {
  const msg = msgById(state, p.envoy);
  if (!msg) { p.envoy = null; return false; }
  if (p.envoyStuck) { // asked again while turning for home: no way home (water in the way): the lock lifts, it waits for orders
    p.envoy = null;
    if (msg.status !== "returned") { msg.status = "lost"; msg.stranded = true; }
    return false;
  }
  p.envoyStuck = true;
  try { return carryOn(state, p, msg, text); } finally { delete p.envoyStuck; }
}
function carryOn(state, p, msg, text) {
  const tile = partyTile(p);
  if (text) log(state, `${teamName(state, p)}: ${text} The envoy goes on with its errand.`, "info");
  if (!p.envoyBack && msg.status === "travelling") {
    const res = planPath(state, tile, msg.base, p.vehicle) || planPath(state, tile, msg.base, false);
    if (res && res.path.length > 1) { p.task = null; p.phase = "out"; p.mission = "envoy"; p.dest = msg.base; p.path = res.path; p.idx = 0; p.progress = Math.min(0, p.progress || 0); return true; }
    if (tile === msg.base) { p.phase = "out"; p.mission = "envoy"; p.dest = tile; p.path = [tile]; p.idx = 0; envoyArrive(state, p); return true; }
    msg.undelivered = true; msg.status = "delivered"; msg.answer = { yes: false, why: "", text: `The envoy could not get through to ${nameOf(state, msg.to)}.` };
  }
  p.envoyBack = true;
  p.phase = "waiting"; // startReturn from here
  startReturn(state, p);
  return true;
}
// Put one of their pending requests first in the card queue (the Envoys tab's "Answer now").
export function answerNow(state, i) {
  const c = state.cards[i];
  if (!c) return "That request is gone.";
  state.cards.splice(i, 1);
  state.cards.unshift(c);
  return "";
}
// Their requests waiting for your answer: [{ i, card }] (coalition asks, the council, their calls).
export function pendingFrom(state, f) {
  return state.cards.map((card, i) => ({ i, card })).filter(({ card }) => (card.coalIds && card.coalIds[0] === f.id) || card.radioFrom === f.id || card.allianceAsk === f.id || (card.envoyFrom === f.id));
}

// ---------- their envoys ----------
// An AI envoy (kind "envoy") from f to a tile: its people away from home (members.js), food for the road.
function sendAiEnvoy(state, f, msg, toTile, goods = null) {
  const from = toTile == null ? null : [...f.bases].sort((a, b) => state.grid.distance(a, toTile) - state.grid.distance(b, toTile) || a - b)[0];
  if (from == null) return null;
  const arms = ((FACTION_TYPES[f.type] && FACTION_TYPES[f.type].arms) || 1) * (f.gear || 1);
  const p = spawnAiParty(state, f, "envoy", from, toTile, { strength: ENVOY.AI_HEADS * arms, target: msg.to === "you" ? { kind: "player", baseId: (hub(state) || {}).id, tile: toTile } : { kind: "envoy", factionId: msg.to, tile: toTile } });
  if (!p) return null;
  p.envoy = msg.id;
  p.homeTile = from;
  p.goods = goods || { supplies: {}, gear: [] };
  p.errand = msg.kind === "ask" ? `✉ ${msg.ask}` : msg.kind === "council" ? "✉ council" : msg.kind === "propose" ? "✉ joint op" : msg.kind === "card" ? `✉ ${CARD_TAG[msg.card] || "word"}` : msg.kind === "talk" ? `✉ ${msg.act}` : msg.kind === "news" ? "✉ news" : "✉ word";
  msg.partyId = p.id;
  return p;
}
// coalition.js raise: an ask from a member with no radio link goes by its envoy. True: routed (the card waits).
export function envoyAsk(state, card) {
  const asker = card && card.coalIds ? factionById(state, card.coalIds[0]) : null;
  const h = hub(state);
  if (!asker || !h || canRadioGroup(state, asker)) return false;
  const msg = newMsg(state, { from: asker.id, to: "you", kind: "ask", ask: card.coalKind, ids: [...card.coalIds], params: card.coalTrade || null, title: card.title });
  const goods = { supplies: {}, gear: [] };
  if (card.coalTrade) { // the goods it offers ride with it
    const { j, q } = card.coalTrade;
    if (j === "food") moveFoodUnits(asker, goods.supplies, q, { state });
    else { const tk = groupStockKey(j, asker), got = Math.min(q, Math.max(0, asker.stock[tk] || 0)); asker.stock[tk] -= got; goods.supplies[tk] = got; }
  }
  const p = sendAiEnvoy(state, asker, msg, h.tile, goods);
  if (!p) { putBack(state, asker, goods.supplies); msg.status = "lost"; msg.noRoute = true; }
  return true;
}
function putBack(state, f, sup) {
  for (const [k, q] of Object.entries(sup || {})) {
    if (!(q > 0)) continue;
    if (FOODS[k]) addFood(f, k, q, { state });
    else f.stock[k] = (f.stock[k] || 0) + q; // (the envoy's own goods: yours were noted when they came onto it)
    sup[k] = 0;
  }
}
// Arrived (parties.js aiPartyHour, at the end of its way): at the other end, or home.
export function envoyAiArrive(state, p) {
  const msg = msgById(state, p.envoy);
  const f = factionById(state, p.owner);
  if (p.phase === "back" || !msg) return aiHome(state, p, msg, f);
  msg.delivered = state.hour;
  if (msg.kind === "word") { // between members: what your answer did between them
    msg.status = "delivered";
    const to = factionById(state, msg.to);
    if (to && to.alive && to.bases.includes(partyTile(p))) replaySink(state, msg.calls);
    return goHome(state, p);
  }
  if (msg.kind === "talk") { // between two groups (groupWord): a pact, a war, a peace, applied as it is read
    msg.status = "delivered";
    const to = factionById(state, msg.to);
    if (f && f.alive && to && to.alive && to.bases.includes(partyTile(p)) && WORDS[msg.act]) WORDS[msg.act](state, f, to, msg.args || {});
    return goHome(state, p);
  }
  if (msg.kind === "council") { // a delegate at your hub
    msg.status = "delivered";
    const C = ensureEnvoys(state).council;
    if (!C || C.held) return goHome(state, p);
    p.phase = "wait";
    return;
  }
  if (msg.kind === "propose") { // loans.js: a joint operation they propose
    msg.status = "delivered";
    if (!f || !f.alive || !hub(state)) { msg.answered = true; return goHome(state, p); }
    const card = proposalCard(state, f, msg.prop, (st, yes, o) => { msg.accepted = !!yes; msg.opId = o ? o.id : null; });
    card.envoyMsg = msg.id;
    card.text = `${f.name}'s envoy has come to ${hub(state).name}. ${card.text} Their envoy takes your answer home; their fighters set out once they hear it.`;
    for (const ch of card.choices) wrapChoice(state, ch, msg, p);
    addCard(state, card);
    p.phase = "wait";
    return;
  }
  if (msg.kind === "card") { // any other word from them (cardFromGroup): the card, built again now
    msg.status = "delivered";
    if (msg.card === "declare") { msg.answered = true; if (f && f.alive) declareOnPlayer(state, f, (msg.args && msg.args.goal) || null, true); return goHome(state, p); } // a declaration: the war begins as it is read
    const build = CARDS[msg.card];
    const card = f && f.alive && hub(state) && build ? withTalk({ calls: [], goods: {}, from: null, fid: null, inPerson: true }, () => build(state, f, msg.args || {})) : null;
    if (!card) { msg.answered = true; msg.settled = true; return goHome(state, p); }
    card.envoyMsg = msg.id;
    card.envoyFrom = f.id;
    card.title = card.title.replace(/^On the radio: /, "Envoy from ");
    card.text = `${f.name}'s envoy has come to ${hub(state).name}. ${card.text.replace(/ call you on the radio with a job\./, " send an envoy with a job.").replace(/ call you\./, " send word.")} Their envoy takes your answer home: they hear it only when it gets there.`;
    for (const ch of card.choices) wrapChoice(state, ch, msg, p);
    addCard(state, card);
    p.phase = "wait";
    log(state, `${f.name}'s envoy reached ${hub(state).name}.`, "info");
    return;
  }
  if (msg.kind === "news") { // a member's sightings, carried (alliance.js shareSightings)
    msg.status = "delivered"; msg.answered = true;
    if (f && f.alive && isMember(state, f)) shareSightings(state, [f]);
    return goHome(state, p);
  }
  // An ask at your gates: the card, built again for its asker now.
  msg.status = "delivered";
  const ms = allianceMembers(state);
  const card = f && f.alive && isMember(state, f) && hub(state) ? askCard(state, msg.ask, ms, msg.ids, msg.params) : null;
  if (!card) { msg.answered = true; msg.settled = true; return goHome(state, p); }
  card.envoyMsg = msg.id;
  card.envoyFrom = f.id;
  card.text = `${f.name}'s envoy has come to ${hub(state).name}. ${card.text} Their envoy takes your answer home: they hear it only when it gets there.`;
  for (const ch of card.choices) wrapChoice(state, ch, msg, p);
  raiseArrived(state, card);
  p.phase = "wait";
  log(state, `${f.name}'s envoy reached ${hub(state).name} with a request.`, "info");
}
// A choice on a card their envoy brought: the asker's books wait for the envoy to get home (coalition.js withSink); the
// goods you give go with it, theirs come out of what it brought.
// Their goodwill (factions.js changeGoodwill on the sender) waits too, and whatever parties of theirs your answer sets
// moving (a caravan, fighters) are held until the envoy is home (msg.held), then set out (talk.js).
function wrapChoice(state, ch, msg, p) {
  const res = ch.resolve, dis = ch.disabled, ai = ch.ai;
  const sinkOf = () => ({ calls: [], goods: {}, from: p.goods.supplies, fid: p.owner, inPerson: true });
  ch.resolve = (st) => {
    const sink = sinkOf();
    const before = new Set(st.parties.map((q) => q.id));
    const t = withSink(sink, () => res(st));
    msg.calls = [...(msg.calls || []), ...sink.calls];
    const held = st.parties.filter((q) => q.owner === p.owner && !before.has(q.id));
    if (held.length) { st.parties = st.parties.filter((q) => !held.includes(q)); msg.held = [...(msg.held || []), ...held]; }
    for (const [k, q] of Object.entries(sink.goods)) if (q > 0) { p.goods.supplies[k] = (p.goods.supplies[k] || 0) + q; if (isRoundKey(k) || k === "ammo") note(st, "from you", q); } // ledger.js: your rounds onto their envoy, the AI side
    msg.answered = true;
    msg.answerLabel = ch.label;
    return `${t || ""} Their envoy sets off home with your answer.`.trim();
  };
  if (typeof dis === "function") ch.disabled = (st) => withSink(sinkOf(), () => dis(st));
  if (typeof ai === "function") ch.ai = (st) => withSink(sinkOf(), () => ai(st));
}
// Waiting at your gates (parties.js aiPartyHour, phase "wait"): home once answered, or once nothing is left to answer.
export function envoyAiWait(state, p) {
  const msg = msgById(state, p.envoy);
  if (!msg) return goHome(state, p);
  if (msg.kind === "council") {
    const C = ensureEnvoys(state).council;
    if (!C || (C.held && !state.cards.some((c) => c.council))) return goHome(state, p);
    return;
  }
  if (msg.answered) return goHome(state, p);
  if (!state.cards.some((c) => c.envoyMsg === msg.id)) { msg.answered = true; msg.unanswered = true; return goHome(state, p); } // the card went unanswered (a tool cleared it)
}
function goHome(state, p) {
  const f = factionById(state, p.owner);
  const home = f && f.alive && f.bases.length ? (f.bases.includes(p.homeTile) ? p.homeTile : [...f.bases].sort((a, b) => state.grid.distance(a, partyTile(p)) - state.grid.distance(b, partyTile(p)) || a - b)[0]) : null;
  const res = home != null ? planPath(state, partyTile(p), home, p.vehicle, f.id) || planPath(state, partyTile(p), home, false, f.id) : null;
  if (!res) { const msg = msgById(state, p.envoy); if (msg && msg.status !== "returned") { msg.status = "lost"; ensureEnvoys(state).stats.lost++; } removeParty(state, p); return; }
  p.homeTile = home;
  p.path = res.path; p.idx = 0; p.progress = 0; p.phase = "back";
  if (res.path.length <= 1) aiHome(state, p, msgById(state, p.envoy), f);
}
// Home: the answer known (the asker's books, word to the other members), the goods into their stores.
function aiHome(state, p, msg, f) {
  if (f && f.alive && p.goods) putBack(state, f, p.goods.supplies);
  if (msg && msg.status !== "returned") {
    msg.status = "returned";
    msg.returned = state.hour;
    ensureEnvoys(state).stats.returned++;
    if (msg.calls && f && f.alive) wordHome(state, f, msg.calls);
    if (msg.held && f && f.alive) { for (const q of msg.held) state.parties.push(q); msg.held = null; } // what your answer set moving sets out now
    if (msg.kind === "propose" && msg.accepted && f && f.alive) { const o = opById(state, msg.opId); if (o) joinOp(state, f, o); } // they heard your yes: their fighters set out
  }
  removeParty(state, p);
}
// The asker's books now; what concerns a member that neither your radio nor the asker's reaches goes by courier.
function wordHome(state, asker, calls) {
  const now = [], later = new Map();
  const reaches = (id) => { const o = factionById(state, id); return !o || !o.alive || o === asker || canRadioGroup(state, o) || groupsLinked(state, asker, o); };
  for (const c of calls) {
    const far = [c.f, c.other].find((id) => id !== "you" && !reaches(id));
    if (far == null) now.push(c);
    else (later.get(far) || later.set(far, []).get(far)).push(c);
  }
  replaySink(state, now);
  for (const [id, cs] of later) {
    const o = factionById(state, id);
    const msg = newMsg(state, { from: asker.id, to: id, kind: "word", calls: cs });
    if (!sendAiEnvoy(state, asker, msg, destOf(state, o, { tile: asker.bases[0] }))) { msg.status = "lost"; msg.noRoute = true; }
  }
}

// loans.js: a joint operation a group proposes: a card now by radio, else carried by its envoy. True: sent.
export function proposeRoute(state, f, prop) {
  const h = hub(state);
  if (!h) return false;
  if (canRadioGroup(state, f)) {
    addCard(state, proposalCard(state, f, prop, (st, yes, o) => { if (yes && o) joinOp(st, f, o); }));
    return true;
  }
  const msg = newMsg(state, { from: f.id, to: "you", kind: "propose", prop, title: `${f.name} propose a joint operation` });
  if (!sendAiEnvoy(state, f, msg, h.tile)) { msg.status = "lost"; msg.noRoute = true; return false; }
  return true;
}

// ---------- every other word from a group (the user's rule 2026-10-22: "All communication regardless if radios have not
// been established between the groups has to come by envoy regardless if it is a player or AI group") ----------
// A card a group sends you: with a radio link at once (as before), else carried by its envoy and built again when it
// arrives (the args are data: a save holds them). card: built now for the radio. Returns "radio", "envoy", "held" (one
// of the same already on its way), or null (no way to send it).
export const CARDS = {
  join: (st, f) => joinAskCard(st, f), // alliance.js: asking to join the coalition
  volask: (st, f, a) => { const ask = askById(st, a.askId); if (!ask) return null; ask.expires = st.hour + VOL.AI.expire; return volAskCard(st, ask); }, // volunteers.js: their call for your people
  offer: (st, f) => (refusal(st, f, true) ? null : offerCard(st, f)), // radio.js: a trade offer or request (a caravan, bring yours, meet halfway)
  job: (st, f, a) => { const j = jobArrived(st, jobById(st, a.jobId)); return j && j.status === "offered" ? jobOfferCard(st, j) : null; }, // jobs.js
  warjoin: (st, f, a) => { const w = warById(st, a.warId), foe = w ? factionById(st, enemyIn(w, f)) : null; return w && foe && w.playerSide == null ? warCard(st, w, f, foe) : null; }, // diplomacy.js: join their war
  bloc: (st, f, a) => { const b = blocById(st, a.blocId); return b && !b.player ? blocInviteCard(st, b) : null; }, // blocs.js: stand with their bloc
  sue: (st, f, a) => { const w = pwarById(st, a.warId); return w ? sueCard(st, w) : null; }, // playerwars.js: they sue for peace
  demand: (st, f, a) => { const w = pwarById(st, a.warId); return w ? demandCard(st, w) : null; }, // playerwars.js: peace on their terms
  recovery: (st, f, a) => ({ title: `${f.name}: your convoy`, text: `${f.name}: ${a.text}`, choices: [{ label: "Understood", ai: () => 1, resolve: () => "" }] }), // convoyrecover.js: word of the job (gone, lost, turned back)
};
const CARD_TAG = { join: "joining", volask: "volunteers", offer: "trade", job: "a job", warjoin: "their war", bloc: "their bloc", sue: "peace", demand: "terms", declare: "war", recovery: "your convoy" };
export function cardFromGroup(state, f, key, args = {}, card = null) {
  const h = hub(state);
  if (!f || !f.alive || !h) return null;
  if (canRadioGroup(state, f)) { const c = card || (CARDS[key] ? CARDS[key](state, f, args) : null); if (c) addCard(state, c); return "radio"; }
  const same = (m) => m.kind === "card" && m.from === f.id && m.card === key && m.status === "travelling" && JSON.stringify(m.args || {}) === JSON.stringify(args);
  if (state.envoys && state.envoys.msgs.some(same)) return "held";
  const msg = newMsg(state, { from: f.id, to: "you", kind: "card", card: key, args, title: card ? card.title : `${f.name}: ${CARD_TAG[key] || "word"}` });
  if (!sendAiEnvoy(state, f, msg, h.tile)) { msg.status = "lost"; msg.noRoute = true; return null; }
  return "envoy";
}
// Is word of this kind from them on its way, or at your gates unanswered (the callers' "one at a time")?
export const cardInFlight = (state, f, key) => !!state.envoys && state.envoys.msgs.some((m) => m.kind === "card" && m.from === f.id && m.card === key && (m.status === "travelling" || (m.status === "delivered" && !m.answered)));
// A war declared on you without a link (playerwars.js declareOnPlayer): carried, the war begins when it arrives.
export const carryDeclaration = (state, f, goal = null) => cardFromGroup(state, f, "declare", { goal });
// A member's sightings without a link (alliance.js shareSightings): a courier now and then.
export function newsFromMember(state, f) {
  if (!hub(state) || (state.envoys && state.envoys.msgs.some((m) => m.kind === "news" && m.from === f.id && m.status === "travelling"))) return;
  const msg = newMsg(state, { from: f.id, to: "you", kind: "news" });
  if (!sendAiEnvoy(state, f, msg, hub(state).tile)) { msg.status = "lost"; msg.noRoute = true; }
}
// Between two groups (AI ↔ AI): a pact, a war, a peace. With a link between them it happens now, else a courier from a
// to b carries it and it happens as it is read (coarse). True: done or under way (false: the same on its way already).
export const WORDS = {
  pact: (st, a, b) => {
    if (pactBetween(st, a, b) || warBetween(st, a, b)) return;
    const d = ensureDiplo(st);
    d.pacts.push({ a: Math.min(a.id, b.id), b: Math.max(a.id, b.id), since: day(st) });
    d.stats.pacts++;
    const an = knownAs(st, a);
    diploNews(st, `${an[0].toUpperCase()}${an.slice(1)} and ${knownAs(st, b)} signed a pact.`, "info", [a, b]);
  },
  war: (st, a, b, x) => { if (!warBetween(st, a, b) && !pactBetween(st, a, b)) startWar(st, a, b, x.reason || "land"); },
  peace: (st, a, b, x) => { const w = warById(st, x.warId); if (w) makePeace(st, w); },
};
export function groupWord(state, a, b, act, args = {}) {
  if (!a || !b || !WORDS[act]) return false;
  if (groupsLinked(state, a, b)) { WORDS[act](state, a, b, args); return true; }
  const pair = (m) => m.kind === "talk" && m.act === act && m.status === "travelling" && ((m.from === a.id && m.to === b.id) || (m.from === b.id && m.to === a.id));
  if (state.envoys && state.envoys.msgs.some(pair)) return false;
  const msg = newMsg(state, { from: a.id, to: b.id, kind: "talk", act, args });
  if (!sendAiEnvoy(state, a, msg, destOf(state, b, { tile: a.bases[0] }))) { msg.status = "lost"; msg.noRoute = true; return false; }
  return true;
}
// One of your people sent at once with a message (a ransom's price, peace terms): the best talker at the hub, on foot.
export function quickEnvoy(state, f, kind, payload) {
  const h = hub(state);
  if (!h) return { ok: false, text: "You have no base to send from." };
  const radio = commsWith(state, f) === "radio"; // by radio nobody goes (communicate answers at once)
  const who = radio ? null : [...atBase(state, h.id)].filter((s) => !s.loan && !s.vol && s.health >= 50).sort((x, y) => (y.skills.speech || 0) - (x.skills.speech || 0) || x.id - y.id)[0];
  if (!radio && !who) return { ok: false, text: `Nobody at ${h.name} fit to carry it.` };
  return communicate(state, { fid: f.id, kind, payload, memberIds: who ? [who.id] : [], fromBaseId: h.id });
}

// ---------- the council (alliance.js council) ----------
// Members with no radio link send delegates to your hub. True: sent (the council sits when they are in: envoysHour).
export function councilByDelegates(state, ms) {
  const h = hub(state);
  const far = ms.filter((f) => !canRadioGroup(state, f));
  if (!far.length || !h) return false;
  const E = ensureEnvoys(state);
  const ids = [];
  for (const f of far) {
    const msg = newMsg(state, { from: f.id, to: "you", kind: "council" });
    if (sendAiEnvoy(state, f, msg, h.tile)) ids.push(msg.id); else { msg.status = "lost"; msg.noRoute = true; }
  }
  E.council = { day: day(state), hour: state.hour, msgs: ids, near: ms.filter((f) => !far.includes(f)).map((f) => f.id), held: false };
  log(state, `The season's council is called: ${far.map((f) => f.name).join(", ")} send${far.length === 1 ? "s" : ""} delegates to ${h.name}; it sits when they are in.`, "info");
  ensureAlliance(state).history.unshift({ day: day(state), text: `The council was called; delegates from ${far.map((f) => f.name).join(", ")} set out.` });
  return true;
}
function councilHour(state) {
  const C = state.envoys && state.envoys.council;
  if (!C || C.held) return;
  const ms = C.msgs.map((id) => msgById(state, id)).filter(Boolean);
  const late = state.hour - C.hour >= ENVOY.COUNCIL_WAIT * 24;
  if (!late && ms.some((m) => m.status === "travelling")) return;
  C.held = true;
  C.heldHour = state.hour;
  const present = allianceMembers(state).filter((f) => C.near.includes(f.id) || ms.some((m) => m.from === f.id && m.status === "delivered"));
  const missing = ms.filter((m) => m.status !== "delivered").map((m) => nameOf(state, m.from));
  if (missing.length) log(state, `The council sits without ${missing.join(", ")}: their delegates never came.`, "danger");
  if (present.length && hub(state)) holdCouncil(state, present);
}

// ---------- hourly (parties.js movePartiesHour) ----------
export function envoysHour(state) {
  loansHour(state); // loans.js: volunteers on loan, joint operations
  const E = state.envoys;
  if (!E || !E.msgs.length) return;
  const d = day(state);
  for (const m of E.msgs) {
    if (m.status === "returned" || m.status === "lost") { noteOverdue(state, m); continue; }
    const p = m.partyId != null ? state.parties.find((q) => q.id === m.partyId) : null;
    if (!p) { m.status = "lost"; m.lostAt = state.hour; E.stats.lost++; noteOverdue(state, m); continue; } // killed, robbed, lost on the road: the message (or the answer) with it
    if (m.from === "you" && p.owner === "player" && (p.phase === "waiting") && !state.cards.some((c) => c.partyId === p.id)) envoyCarryOn(state, p, ""); // nothing holds it: on
    noteOverdue(state, m);
  }
  councilHour(state);
  // Military aid: their fighters harry the next raid on a base of yours near them.
  for (const [id, until] of Object.entries(E.harry || {})) {
    const f = factionById(state, Number(id));
    if (!f || !f.alive || until < d) { delete E.harry[id]; continue; }
    const raid = state.parties.find((q) => q.kind === "raid" && !q.harried && q.phase === "out" && q.owner !== f.id && q.target && q.target.kind === "player" && f.bases.some((b) => state.grid.distance(b, q.target.tile) <= ENVOY.HARRY_RANGE));
    if (!raid) continue;
    raid.strength *= ENVOY.HARRY;
    raid.harried = f.id;
    delete E.harry[id];
    log(state, `${f.name} harry the raiders heading for ${(baseById(state, raid.target.baseId) || {}).name || "your base"}, as they promised your envoy (strength now about ${Math.round(raid.strength)}).`, "good");
  }
  if (E.msgs.length > ENVOY.KEEP * 2) { const keep = E.msgs.filter((m) => m.status === "travelling" || m.status === "delivered"); const done = E.msgs.filter((m) => !keep.includes(m)).slice(-ENVOY.KEEP); E.msgs = [...done, ...keep].sort((a, b) => a.id - b.id); }
}
// "No word from our envoy": your message not home by its overdue hour, said once. One killed out of your radio
// coverage (envoyLostQuiet: no word of it then) is given up for lost now: the first you hear of it.
function noteOverdue(state, m) {
  if (m.from !== "you" || m.via === "radio" && m.partyId == null || m.noted || m.status === "returned" || m.overdueAt == null || state.hour < m.overdueAt) return;
  m.noted = true;
  const dead = (m.quietDead || []).map((n) => String(n).split(" ")[0]);
  const who = dead.length <= 1 ? dead.join("") : `${dead.slice(0, -1).join(", ")} and ${dead[dead.length - 1]}`;
  log(state, `No word from our envoy to ${nameOf(state, m.to)}. ${m.status === "lost" ? `They should have been back long ago${m.quiet ? `: ${who || "the envoy"} ${dead.length > 1 ? "are" : "is"} given up for lost` : ""}.` : "They are long overdue."}`, "danger");
}
// parties.js wipeParty, world.js killSurvivor: your envoy (or one of it) died out of your radio coverage. Nothing is
// said now; the message remembers it for its overdue hour (noteOverdue).
export function envoyLostQuiet(state, p, s = null) {
  const m = p && p.envoy != null ? msgById(state, p.envoy) : null;
  if (!m) return;
  if (s) (m.quietDead || (m.quietDead = [])).push(s.name);
  else m.quiet = true;
}

// ---------- what the player sees ----------
// The status in words: travelling, delivered (on the way back: awaiting return), overdue, lost, returned. A lost envoy
// shows as on its way until it is overdue (you do not know yet).
export function statusOf(state, m) {
  if (m.status === "returned") return "returned";
  const late = m.overdueAt != null && state.hour >= m.overdueAt;
  if (m.status === "lost") return m.from === "you" ? (late ? "lost" : m.delivered != null ? "awaiting return" : "travelling") : "lost";
  if (late) return "overdue";
  return m.status === "delivered" ? (m.from === "you" ? "awaiting return" : "delivered") : "travelling";
}
// The messages in flight and the latest done: [{ m, status, who, what, answer }] (yours: the answer once home).
export function messageList(state, n = 14) {
  if (!state.envoys) return [];
  const rows = state.envoys.msgs.filter((m) => m.from === "you" || (m.to === "you" && m.kind !== "word")).slice(-n).reverse();
  return rows.map((m) => {
    const status = statusOf(state, m);
    const mine = m.from === "you";
    const what = mine ? KINDS[m.kind] ? KINDS[m.kind].label : m.kind : m.kind === "council" ? "a delegate to the council" : m.kind === "propose" ? "a joint operation" : m.title ? m.title.replace(/^Coalition: /, "") : "a request";
    const answer = mine ? (status === "returned" ? (m.homeText || (m.answer && m.answer.text) || "") : "") : m.answerLabel ? `you answered: ${m.answerLabel}` : "";
    return { m, status, who: mine ? nameOf(state, m.to) : nameOf(state, m.from), mine, what, via: m.via || "envoy", answer, due: m.due ?? null };
  });
}

// The codex and help text.
export const envoysHelp = () => `<b>Envoys.</b> Groups talk by radio only when both have a working link: your station or a linked relay reaching their base (+6 tiles) and a set of their own (a station; the military's army sets). Starting bases have none, only military bases. Otherwise word goes in person: pick a message (aid, a trade, a pact, an invitation, a request for aid or fighters, news or a warning), then at least one survivor to carry it, a vehicle if you like and the goods. The envoy walks there and back at the team's pace with food and water for the trip, meets the road like any team, and takes no other orders. They answer when it arrives (by their standing with you, what they need and their kind); goods change hands there, and you learn the answer only when the envoy is home. Killed on the way there, the message never arrives (it is no refusal); killed on the way back, what was agreed at their table stands but you never hear it and what they gave is lost with it. ${ENVOY.OVERDUE}× late and you note "no word". The members of your coalition with no link send their asks the same way: the card comes when their envoy reaches your hub, and they hear your answer when it gets home; their envoys are on the map and can be intercepted. The season's council waits for their delegates. Radios are a mid-game build: the station needs the Radio Engineering Handbook studied, or the mid game (year ${5}).`;
