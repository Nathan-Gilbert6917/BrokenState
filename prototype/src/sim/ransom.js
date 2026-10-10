// Ransom: buying your captives back from any group, raiders included (conflicts.js captives; tools/rescuetest.js).
//
// Talks: by radio when your network reaches one of their bases (radio.js canRadioGroup), else an envoy rides out and
// their answer comes back in 4 + 2 hours a tile from the hub (state.rescueTalks). The People tab's Negotiate opens
// them for everyone that group holds.
// The price (ransomOffer): each captive is worth RANSOM.BASE + RANSOM.PER_SKILL a point of their three best skills
// (×1.5 for your leader), × how they feel about you (Hostile 1.5, Neutral 1, Friendly 0.7, Allied 0.5; plus up to 30%
// more the further below −30 goodwill they are), zealots ×1.3. It is paid in what they want (WANTS: raiders want guns,
// ammo, meds, fuel and food; zealots food, meds and water...): wanted goods count ×1.25 their value, anything else
// ×0.8, and raiders and expansionists take nothing but what they want. Guns come out of the hub's armory.
// Zealots below −20 goodwill want half again; below −40 they refuse unless you pay double.
// Haggle once (Speech: the hub's best talker, or the envoy): success takes 20% off, failure puts 10% on and costs 2
// goodwill. A prisoner exchange (prisoners.js): your prisoners at a base for theirs, each worth 25 + 3 a point of
// their three best skills + 4 × their power, their own people ×1.5 to them; the rest of the price (if any) in goods.
// The handover:
//   friendly or neutral groups that do not raid (not hostile): the goods go from the hub at once, and they bring
//   your people to your gates (2 hours a tile).
//   raiders, expansionists, zealots and anyone hostile: at a meeting point on the road between you (state.rescueDeals,
//   DEAL_DAYS to turn up). You send a handover team with the goods (and the prisoners) in its cargo (sendHandover:
//   your best fighters, 3 by default). At the meeting point: Make the exchange, or Back out (goodwill −5).
//   Betrayal (betrayChance): raiders 15%, expansionists and zealots 12%, anyone else 4%, × their handover party's
//   strength over your team's (0.35–2), 2–40%: they ambush the handover (a battle on the road, they have the drop on
//   you, your people tied up behind their line: rescueraid.js "rescueRoad"). Win: the captives and the goods are
//   yours; lose or run: they keep both.
// The value rule (VALUE, captiveValue, ransomVerdict): what the captive is worth to you (skills, a medic, a leader, a
// master of anything, health, how few you are) against the price. The governor (autopilotRescue, autoRescuePlan) and,
// for the cards, a hub leader with Trading (ransomDelegated): pay when they are worth it and the hub can pay out of
// what it can spare (never out of its last days of food and water); else a prisoner exchange that covers it; else a
// rescue raid (the Rescue mission) when its best fighters would beat the base and its jail guards (55%+) for someone
// worth it; else decline. The offer card left in the tray lapses as Decline unless those decide (then the value
// rule's answer). A team at their gates pays out of what it carries only by the same rule (teamPayOk). The groups
// buying back their own people from each other weigh them the same way (groupMemberWorth, groupjails.js).
import { SUPPLIES, FACTION_TYPES, GEAR } from "./data.js";
import { totalRounds, spendAmmo, isRoundKey } from "./rounds.js"; // a ransom's "ammo" paid as rounds by calibre
import { keyWord } from "./water.js";
import { log, addCard, day, hub, factionById, survivorById, skill, combatPower, atBase, newId } from "./world.js";
import { attitude, changeGoodwill, isAggressiveType } from "./factions.js";
import { captivesOf, allCaptives, freeCaptive, isCaptive, payPlan } from "./conflicts.js";
import { canRadioGroup } from "./radio.js";
import { launchExpedition, partyMembers, partyTile, tileLabel, awaitOrders, planPath, wipeIfEmpty } from "./parties.js";
import { prisonersOf, teamPace, handOver } from "./prisoners.js";
import { registerCombatHandler, startCombat, winOdds, WEAPONS } from "./combat.js";
import { afterRescueBattle, tacticalPossible, groupArmory, kindOf } from "./rescueraid.js";
import { assaultForce } from "./conquest.js";
import { itemValue } from "./valuation.js";
import { thirstAhead } from "./weather.js";
import { groupJailGuards } from "./groupjails.js"; // the guards on the jail a raid would meet
import { payoutFloor, payoutBreaks } from "./upkeep.js"; // the pay-out reserve: food and water are never paid below it

export const RANSOM = {
  BASE: 40, PER_SKILL: 3, LEADER: 1.5, ZEALOT: 1.3,
  ATT: { Hostile: 1.5, Neutral: 1, Friendly: 0.7, Allied: 0.5 }, GRUDGE: { from: -30, per: 0.005, max: 0.3 },
  WANTS: {
    raider: ["guns", "ammo", "meds", "fuel", "food"], expansionist: ["guns", "ammo", "fuel", "food", "meds"], zealot: ["food", "meds", "water"],
    military: ["fuel", "meds", "parts", "ammo"], fortress: ["ammo", "parts", "meds", "food"], traders: ["scrap", "parts", "fuel", "meds"], commune: ["food", "meds", "parts", "scrap"],
  },
  ONLY_WANTS: ["raider", "expansionist"], WANT: 1.25, OTHER: 0.8, GUNS_SHARE: 0.5, KEEP: { food: 10, water: 10, ammo: 20, meds: 1, fuel: 4 },
  ZEALOT_PRICY: -20, ZEALOT_MORE: 1.5, ZEALOT_REFUSE: -40,
  HAGGLE: { cut: 0.2, raise: 0.1, goodwill: -2, dc: { Hostile: 13, Neutral: 10, Friendly: 7, Allied: 5 }, zealot: 2 },
  PRISONER: { base: 25, perSkill: 3, perPower: 4, own: 1.5 }, EXCHANGE_MIN: 0.8,
  MEET: ["raider", "expansionist", "zealot"], DEAL_DAYS: 6, ENVOY: { base: 4, perTile: 2 }, RETURN_PER_TILE: 2,
  BETRAY: { raider: 0.17, expansionist: 0.13, zealot: 0.12, other: 0.04, ratio: [0.35, 2], min: 0.02, max: 0.4 },
  BACK_OUT: -5, DONE_GW: 3, BETRAYED_GW: -20, CREW: 3,
  // Governor: what it keeps back (a head) and the odds it wants before it storms a base for someone.
  AUTO: { keepFood: 12, keepWater: 12, keepAmmo: 60, keepMeds: 3, keepFuel: 10, share: 0.5, raidOdds: 0.55, worth: 75, squad: 5 },
  BETRAY_OFF: false, BETRAY_FORCE: false, // tools/rescuetest.js switches
  // What a captive is worth to you (captiveValue), against the price (ransomVerdict): base + perSkill a point of their
  // three best skills; + medic (Medicine `rare`+), + lead (Leadership `rare`+), + rare for any skill at `top`+; × leader
  // (the group's leader); × their health (health / 100, at least `weak`); × few when you are `small` people or fewer.
  // The governor, a leader with Trading at the hub, or the card left in the tray when those decide: pay when the worth
  // is at least `pay` × the price and the hub can pay out of what it can spare (AUTO keep: never out of its last 12
  // days of food and water a head), else a rescue raid (AUTO raidOdds against the base and its jail guards, for
  // someone worth AUTO.worth or a leader), else decline. teamDays: a team at their gates keeps this many days of food
  // and water a head for the road home. groupBase / groupPerPower / groupBig / groupSmall: what one of a group's own
  // people is worth to it (groupMemberWorth: × 0.9 for a group of groupBig+, × 1.3 under groupSmall).
  VALUE: { base: 30, perSkill: 4, medic: 25, lead: 15, rare: 6, top: 9, rareBonus: 15, leader: 1.6, weak: 0.6, small: 6, few: 1.3, pay: 1, teamDays: 2,
    groupBase: 12, groupPerPower: 6, groupBig: 25, groupSmall: 10, groupBigMult: 0.9, groupSmallMult: 1.3 },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const first = (s) => s.name.split(" ")[0];
const names = (list) => list.map(first).join(", ");
const pct = (c) => `${Math.round(c * 100)}%`;
const skillChance = (s, dc) => clamp((s + 10 - dc + 1) / 10, 0.05, 0.95);

export const dealsOf = (state) => state.rescueDeals || (state.rescueDeals = []);
export const returnsOf = (state) => state.rescueReturns || (state.rescueReturns = []);
export const talksOf = (state) => state.rescueTalks || (state.rescueTalks = []);
export const dealFor = (state, f) => dealsOf(state).find((d) => d.factionId === f.id) || null;

// ---------- the price ----------
const top3 = (s) => Object.keys(s.skills || {}).map((k) => skill(s, k)).sort((a, b) => b - a).slice(0, 3).reduce((a, v) => a + v, 0);
export const captiveWorth = (s) => Math.round((RANSOM.BASE + RANSOM.PER_SKILL * top3(s)) * (s.leader ? RANSOM.LEADER : 1));
export const wantsOf = (f) => RANSOM.WANTS[f.type] || ["food", "meds", "ammo"];

// ---------- what they are worth to you (the value rule) ----------
// A captive of yours (RANSOM.VALUE): skills, the rare ones (a medic, a leader, a master of anything), health, and how
// few of you there are.
export function captiveValue(state, s) {
  const V = RANSOM.VALUE;
  let v = V.base + V.perSkill * top3(s);
  if (skill(s, "medicine") >= V.rare) v += V.medic;
  if (skill(s, "leadership") >= V.rare) v += V.lead;
  if (Object.keys(s.skills || {}).some((k) => skill(s, k) >= V.top)) v += V.rareBonus;
  if (s.leader) v *= V.leader;
  v *= clamp((s.health ?? 100) / 100, V.weak, 1);
  const people = state.survivors.filter((x) => x.alive && !isCaptive(x)).length;
  if (people <= V.small) v *= V.few;
  return Math.round(v);
}
// One of a group's own people held by another (groupjails.js prisoner records: power 2–4): worth to their group.
export function groupMemberWorth(f, power = 3) {
  const V = RANSOM.VALUE;
  const pop = (f && f.pop) || 0;
  return (V.groupBase + V.groupPerPower * power) * (pop >= V.groupBig ? V.groupBigMult : pop < V.groupSmall ? V.groupSmallMult : 1);
}
// Ransom decisions handed over: the dev autopilot, or the hub's leader with Trading (steward.js).
export function ransomDelegated(state) {
  if (state.autopilot) return true;
  const h = hub(state);
  return !!(h && h.steward && h.steward.on && h.steward.areas && h.steward.areas.trade);
}
// Pay, raid or decline (the value rule): { kind: "pay" | "raid" | "decline", worth, price, why, odds? }.
// price: the asking price (default: their offer); the hub pays (autoCanPay: its spare, its last days of food and water kept).
export function ransomVerdict(state, f, captives, price = null) {
  const offer = ransomOffer(state, f, captives);
  const ask = price ?? (offer.refused ? offer.doubled : offer.value);
  const worth = captives.reduce((a, s) => a + captiveValue(state, s), 0);
  if (worth >= ask * RANSOM.VALUE.pay && autoCanPay(state, f, ask)) return { kind: "pay", worth, price: ask, why: `${names(captives)} worth about ${worth} to you, the price ${ask}` };
  const raid = raidOdds(state, f, captives);
  if (raid && raid.odds >= RANSOM.AUTO.raidOdds && (Math.max(...captives.map((s) => captiveValue(state, s))) >= RANSOM.AUTO.worth || captives.some((x) => x.leader))) return { kind: "raid", worth, price: ask, odds: raid.odds, why: `${pct(raid.odds)} against ${raid.count} at their base (${raid.jail} on the jail) for ${names(captives)}` };
  return { kind: "decline", worth, price: ask, why: worth < ask ? `${names(captives)} worth about ${worth} to you, the price ${ask}` : `the hub cannot spare ${ask} without going short` };
}
// The hub's best squad against the base where they are held: { odds, count, jail } or null (fewer than 3 fit).
function raidOdds(state, f, captives) {
  const h = hub(state);
  if (!h || !captives.length) return null;
  const squad = atBase(state, h.id).filter((x) => x.health >= 50).sort((a, b) => combatPower(b) - combatPower(a)).slice(0, RANSOM.AUTO.squad);
  if (squad.length < 3) return null;
  const tile = f.bases.includes(captives[0].location.tile) ? captives[0].location.tile : f.bases[0];
  const force = assaultForce(state, f, tile, null);
  const odds = winOdds(squad.reduce((a, x) => a + combatPower(x), 0) / Math.max(0.1, force.count * force.power * force.fortified), { kind: force.kind, count: force.count, people: squad.length });
  return { odds, count: force.count, jail: groupJailGuards(state, f) };
}
// A team at their gates paying from what it carries (conflicts.js rescue and trade-visit cards; the governor): worth
// the price, and the team keeps VALUE.teamDays of food and water a head for the road home.
export function teamPayOk(state, p, f, captives, value) {
  const plan = payPlan(p, value);
  if (!plan || !captives.length) return false;
  const n = Math.max(1, partyMembers(state, p).length);
  const left = (k) => (p.supplies[k] || 0) + (p.cargo.supplies[k] || 0) - (plan[k] || 0);
  if (left("food") < n * RANSOM.VALUE.teamDays || left("water") + left("rawwater") < n * RANSOM.VALUE.teamDays) return false;
  return captives.reduce((a, s) => a + captiveValue(state, s), 0) >= value * RANSOM.VALUE.pay;
}
export function ransomOffer(state, f, captives) {
  const att = attitude(f);
  const grudge = Math.min(RANSOM.GRUDGE.max, Math.max(0, (RANSOM.GRUDGE.from - f.goodwill) * RANSOM.GRUDGE.per));
  let value = captives.reduce((a, s) => a + captiveWorth(s), 0) * (RANSOM.ATT[att] ?? 1) * (1 + grudge) * (f.type === "zealot" ? RANSOM.ZEALOT : 1);
  let refused = false, doubled = 0;
  if (f.type === "zealot" && f.goodwill < RANSOM.ZEALOT_PRICY) value *= RANSOM.ZEALOT_MORE;
  if (f.type === "zealot" && f.goodwill < RANSOM.ZEALOT_REFUSE) { refused = true; doubled = Math.round(value * 2); }
  value = Math.round(value);
  return { value, refused, doubled, att, wants: wantsOf(f), meet: meetsOnRoad(f) };
}
export const meetsOnRoad = (f) => RANSOM.MEET.includes(f.type) || attitude(f) === "Hostile";

// Goods worth `value` to them out of a stock and an armory: { supplies, gear, worth } or null if short. keep: what
// stays back (a key each).
export function goodsPlan(f, stock, armory, value, keep = RANSOM.KEEP) {
  const wants = wantsOf(f);
  const only = RANSOM.ONLY_WANTS.includes(f.type);
  const rate = (k) => (wants.includes(k) ? RANSOM.WANT : RANSOM.OTHER);
  const plan = { supplies: {}, gear: [], worth: 0 };
  let left = value;
  const spare = (k) => Math.max(0, Math.floor((stock[k] || 0) - (keep[k] || 0) - (plan.supplies[k] || 0)));
  const takeKey = (k, cap) => {
    if (!SUPPLIES[k] || left <= 0) return;
    if (k === "ammo") { // rounds by calibre (2026-10-09): any rounds over the reserve, the cheapest first, by key (their store keeps one count)
      const per = SUPPLIES.ammo.value * rate(k);
      const copy = { ...stock };
      for (const [kk, qq] of Object.entries(plan.supplies)) if (isRoundKey(kk)) copy[kk] = (copy[kk] || 0) - qq;
      const q = Math.min(Math.max(0, totalRounds(copy) - (keep.ammo || 0)), Math.ceil(Math.min(left, cap) / per));
      if (q <= 0) return;
      const g = spendAmmo(copy, q).keys;
      let n = 0;
      for (const [kk, qq] of Object.entries(g)) if (kk !== "ammo" && qq > 0) { plan.supplies[kk] = (plan.supplies[kk] || 0) + qq; n += qq; }
      plan.worth += n * per;
      left -= n * per;
      return;
    }
    const per = SUPPLIES[k].value * rate(k);
    const q = Math.min(spare(k), Math.ceil(Math.min(left, cap) / per));
    if (q <= 0) return;
    plan.supplies[k] = (plan.supplies[k] || 0) + q;
    plan.worth += q * per;
    left -= q * per;
  };
  // Guns first (for those who want them), up to half the price.
  if (wants.includes("guns")) {
    const guns = (armory || []).filter((it) => it && GEAR[it.key] && GEAR[it.key].slot === "weapon" && WEAPONS[it.key] && !WEAPONS[it.key].melee).sort((a, b) => itemValue(a) - itemValue(b));
    let budget = value * RANSOM.GUNS_SHARE;
    for (const it of guns) {
      const v = itemValue(it) * RANSOM.WANT;
      if (v <= 0 || v > budget || left <= 0) continue;
      plan.gear.push(it); plan.worth += v; left -= v; budget -= v;
    }
  }
  const keys = wants.filter((k) => k !== "guns");
  for (const k of keys) takeKey(k, value * 0.45); // spread over what they want
  for (const k of keys) takeKey(k, Infinity);
  if (!only) for (const k of ["scrap", "parts", "food", "water", "ammo", "meds", "fuel"]) if (!wants.includes(k)) takeKey(k, Infinity);
  if (left > 0.5) return null;
  plan.worth = Math.round(plan.worth);
  return plan;
}
export const goodsText = (g) => [...Object.entries(g.supplies).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${keyWord(k) === k ? SUPPLIES[k].name.toLowerCase() : keyWord(k)}`), ...g.gear.map((it) => it.name)].join(", ") || "nothing";

// ---------- prisoners in exchange ----------
export function prisonerWorth(pr, f) {
  const s = pr.s || { skills: {} };
  const v = RANSOM.PRISONER.base + RANSOM.PRISONER.perSkill * top3(s) + RANSOM.PRISONER.perPower * (pr.power || 3);
  return Math.round(v * (pr.factionId === f.id ? RANSOM.PRISONER.own : 1));
}
// Your prisoners at a base, their own people first: as many as it takes to cover the price.
export function exchangeOffer(state, f, captives, price = null) {
  const offer = ransomOffer(state, f, captives);
  const want = price ?? (offer.refused ? offer.doubled : offer.value);
  const pool = prisonersOf(state).filter((p) => p.at && p.at.kind === "base").sort((a, b) => (b.factionId === f.id) - (a.factionId === f.id) || prisonerWorth(b, f) - prisonerWorth(a, f));
  const out = [];
  let worth = 0;
  for (const p of pool) { if (worth >= want) break; out.push(p); worth += prisonerWorth(p, f); }
  if (!out.length) return null;
  return { prisoners: out, worth, price: want, covers: worth >= want * RANSOM.EXCHANGE_MIN, rest: Math.max(0, Math.round(want - worth)) };
}

// ---------- the talks ----------
function speaker(state, channel) {
  const h = hub(state);
  const ppl = h ? atBase(state, h.id) : [];
  return ppl.sort((a, b) => skill(b, "speech") - skill(a, "speech"))[0] || null;
}
const hubArmory = (state) => (hub(state) ? hub(state).armory || [] : []);

// Opens the talks for everyone this group holds (the People tab's Negotiate): the offer card by radio, or an envoy.
export function openNegotiation(state, sid) {
  const s = survivorById(state, Number(sid));
  if (!s || !isCaptive(s)) return "They are not held by anyone.";
  const f = factionById(state, s.location.factionId);
  if (!f || !f.alive) return "Nobody holds them any more.";
  if (dealFor(state, f)) return `A deal with ${f.name} is already agreed: send the handover team.`;
  if (talksOf(state).some((t) => t.factionId === f.id)) return `An envoy is already on the way to ${f.name}.`;
  if (!hub(state)) return "You have no base to talk from.";
  const ids = captivesOf(state, f.id).map((x) => x.id);
  if (canRadioGroup(state, f)) { addCard(state, negotiationCard(state, f, ids, { channel: "radio" })); return ""; }
  const hours = envoyHours(state, f);
  addCard(state, {
    title: `Ransom: ${f.name}`, factionId: f.id,
    text: `Your radio does not reach ${f.name}. An envoy could ride out to ask their price for ${names(ids.map((id) => survivorById(state, id)))}: an answer in about ${hours} hours.`,
    choices: [
      { label: "Send an envoy", hint: `Their demands come back in about ${hours} hours`, ai: () => 3, resolve: (st) => { talksOf(st).push({ factionId: f.id, captiveIds: ids, due: st.hour + hours }); log(st, `An envoy rides out to ${f.name} about ${names(ids.map((id) => survivorById(st, id)))}.`, "info"); return "The envoy rides out."; } },
      { label: "Not now", hint: "", ai: () => 0, resolve: () => "" },
    ],
  });
  return "";
}
const envoyHours = (state, f) => RANSOM.ENVOY.base + RANSOM.ENVOY.perTile * Math.min(...f.bases.map((b) => state.grid.distance(b, hub(state).tile)));

// The offer card: their price, haggle, a prisoner exchange, agree (opts.channel: "radio" | "envoy"; opts.value: a
// price already haggled; opts.haggled). Returned, not added.
export function negotiationCard(state, f, captiveIds, opts = {}) {
  const captives = captiveIds.map((id) => survivorById(state, id)).filter((s) => s && isCaptive(s) && s.location.factionId === f.id);
  const base = ransomOffer(state, f, captives);
  const value = opts.value ?? (base.refused ? base.doubled : base.value);
  const offer = { ...base, value };
  const h = hub(state);
  const plan = h ? goodsPlan(f, h.stock, h.armory, value) : null;
  const ex = exchangeOffer(state, f, captives, value);
  const exPlan = ex && ex.covers ? (ex.rest > 0 && h ? goodsPlan(f, h.stock, h.armory, ex.rest) : { supplies: {}, gear: [], worth: 0 }) : null;
  // The exchange by the value rule: it covers the price and your people are worth the goods it still takes.
  const exOk = (st) => !!(ex && ex.covers && exPlan) && captives.reduce((a, x) => a + captiveValue(st, x), 0) >= ex.rest;
  const where = offer.meet ? "a meeting point on the road (you send a team with the goods)" : `your gates (they bring ${captives.length === 1 ? "them" : "everyone"} home)`;
  const talk = speaker(state, opts.channel);
  const dc = (RANSOM.HAGGLE.dc[offer.att] ?? 10) + (f.type === "zealot" ? RANSOM.HAGGLE.zealot : 0);
  const hc = talk ? skillChance(skill(talk, "speech") + (skill(talk, "leadership") > skill(talk, "speech") + 2 ? 1 : 0), dc) : 0.05;
  const how = opts.channel === "envoy" ? "Your envoy is back" : "Over the radio";
  const text = `${how}: ${f.name} hold ${names(captives)}. They want goods worth about ${value}${offer.refused ? " (zealots: double, or they will not deal at all)" : ""}, in ${offer.wants.join(", ")}${RANSOM.ONLY_WANTS.includes(f.type) ? " and nothing else" : ""}. The handover: ${where}.${opts.haggled ? " (Haggled.)" : ""}`;
  const choices = [
    {
      label: offer.refused ? `Agree to pay double (${value})` : `Agree: ${plan ? goodsText(plan) : `${value} worth`}`,
      hint: plan ? `Pay ${goodsText(plan)} for ${names(captives)}. Handed over at ${where}${offer.meet ? `. Raiders may betray a handover (${pct(RANSOM.BETRAY[f.type] ?? RANSOM.BETRAY.other)} with an even team; fewer against a strong one)` : ""}` : `The hub cannot spare that much of what they want (about ${value} worth in ${offer.wants.join(", ")})`,
      disabled: () => !(hub(state) && goodsPlan(f, hub(state).stock, hub(state).armory, value)),
      ai: (st) => (ransomVerdict(st, f, captives.filter(isCaptive), value).kind === "pay" ? 6 : -5), // the value rule: worth it and affordable
      // Left in the tray: declined, unless ransom decisions are handed over (ransomDelegated): then the value rule.
      get default() { return ransomDelegated(state) && ransomVerdict(state, f, captives.filter(isCaptive), value).kind === "pay" && !!(hub(state) && goodsPlan(f, hub(state).stock, hub(state).armory, value)); },
      resolve: (st) => {
        const hh = hub(st);
        const pl = hh ? goodsPlan(f, hh.stock, hh.armory, value) : null;
        if (!pl) return "The hub can no longer pay that.";
        return agree(st, f, captives.filter(isCaptive), pl, [], value);
      },
    },
  ];
  if (!opts.haggled) choices.push({
    label: "Haggle",
    hint: `Speech check, ${pct(hc)} (${talk ? first(talk) : "nobody"} talks; they are ${offer.att.toLowerCase()}): ${Math.round(RANSOM.HAGGLE.cut * 100)}% off, or ${Math.round(RANSOM.HAGGLE.raise * 100)}% on and goodwill ${RANSOM.HAGGLE.goodwill}. Only once`,
    ai: (st) => (hc >= 0.6 ? 6.5 : 1),
    resolve: (st) => {
      const won = st.rng.chance(hc);
      if (!won) changeGoodwill(st, f, RANSOM.HAGGLE.goodwill, "you haggled over your people");
      const v2 = Math.round(value * (won ? 1 - RANSOM.HAGGLE.cut : 1 + RANSOM.HAGGLE.raise));
      addCard(st, negotiationCard(st, f, captiveIds, { ...opts, value: v2, haggled: true }));
      return won ? `They grumble and come down to ${v2}.` : `They do not like it: now it is ${v2}.`;
    },
  });
  if (ex && ex.prisoners.length) choices.push({
    label: `Offer a prisoner exchange: ${ex.prisoners.map((p) => first(p)).join(", ")}`,
    hint: ex.covers ? `Your prisoner${ex.prisoners.length > 1 ? "s" : ""} (${ex.prisoners.map((p) => `${p.name}, ${p.group}`).join("; ")}) are worth about ${ex.worth} to them${ex.rest > 0 ? `; the rest in goods: ${exPlan ? goodsText(exPlan) : "the hub cannot spare it"}` : ""}` : `Your prisoners are worth only about ${ex.worth} to them: not enough`,
    disabled: () => !(ex.covers && exPlan),
    ai: (st) => (exOk(st) ? 7 : -5),
    get default() { return ransomDelegated(state) && exOk(state) && ransomVerdict(state, f, captives.filter(isCaptive), value).kind !== "pay"; },
    resolve: (st) => agree(st, f, captives.filter(isCaptive), exPlan || { supplies: {}, gear: [], worth: 0 }, ex.prisoners.map((p) => p.id), value),
  });
  // Declined (the card left in the tray takes it unless ransom decisions are handed over): they stay where they are,
  // as before the talks (raiders with no cell for them still count down: groupjails.js overflowDue).
  choices.push({
    label: "Decline", hint: "Break off the talks: they stay held. Left unanswered, the talks lapse this way (unless the governor or the hub's leader with Trading decides ransoms)", ai: () => 0,
    get default() { if (!ransomDelegated(state)) return true; const v = ransomVerdict(state, f, captives.filter(isCaptive), value); return v.kind !== "pay" && !exOk(state); },
    resolve: (st) => { const still = captives.filter(isCaptive); if (still.length) log(st, `You declined ${f.name}'s price for ${names(still)}. ${still.length === 1 ? "They stay" : "They all stay"} with ${f.name}.`, "info"); return ""; },
  });
  return { title: `Ransom: ${f.name}`, text, factionId: f.id, offer, choices };
}

// The price agreed: a meeting point (a deal), or the goods go now and they bring them home.
function agree(state, f, captives, plan, prisonerIds, value) {
  if (!captives.length) return "Nobody is held any more.";
  const h = hub(state);
  if (meetsOnRoad(f)) {
    const tile = meetingPoint(state, f);
    const deal = { id: newId(), factionId: f.id, captiveIds: captives.map((s) => s.id), supplies: { ...plan.supplies }, gear: [...plan.gear], prisonerIds: [...prisonerIds], tile, until: day(state) + RANSOM.DEAL_DAYS, value };
    dealsOf(state).push(deal);
    log(state, `${f.name} agree: ${names(captives)} for ${goodsText(plan)}${prisonerIds.length ? ` and ${prisonerIds.length} prisoner${prisonerIds.length > 1 ? "s" : ""}` : ""}, handed over at ${tileLabel(state, tile)} within ${RANSOM.DEAL_DAYS} days.`, "info");
    addCard(state, dealCard(state, deal));
    return `Agreed: the handover at ${tileLabel(state, tile)}.`;
  }
  pay(state, f, h.stock, h.armory, plan);
  for (const id of prisonerIds) handOver(state, id);
  const hours = RANSOM.RETURN_PER_TILE * Math.min(...f.bases.map((b) => state.grid.distance(b, h.tile))) + 2;
  for (const s of captives) returnsOf(state).push({ sid: s.id, factionId: f.id, due: state.hour + hours });
  changeGoodwill(state, f, RANSOM.DONE_GW, "a ransom paid");
  log(state, `Ransom paid to ${f.name}: ${goodsText(plan)}${prisonerIds.length ? ` and ${prisonerIds.length} prisoner${prisonerIds.length > 1 ? "s" : ""}` : ""}. They bring ${names(captives)} home in about ${hours} hours.`, "good");
  return `Paid. ${names(captives)} ${captives.length === 1 ? "is" : "are"} on the way home.`;
}
// Goods into their stores (guns into their armory or arsenal).
function pay(state, f, stock, armory, plan) {
  for (const [k, q] of Object.entries(plan.supplies)) { stock[k] = Math.max(0, (stock[k] || 0) - q); f.stock[k] = (f.stock[k] || 0) + q; }
  for (const it of plan.gear) {
    const i = armory ? armory.indexOf(it) : -1;
    if (i >= 0) armory.splice(i, 1);
    const list = f.arsenal && Array.isArray(f.arsenal.items) ? f.arsenal.items : groupArmory(state, f);
    list.push(it);
  }
}
// On the road between the hub and their base, about halfway (never on a base).
export function meetingPoint(state, f) {
  const h = hub(state);
  const home = [...f.bases].sort((a, b) => state.grid.distance(a, h.tile) - state.grid.distance(b, h.tile))[0];
  const found = planPath(state, h.tile, home, false);
  const path = found && found.path ? found.path : [];
  const ok = (t) => !state.bases.some((b) => b.tile === t) && !state.factions.some((g) => g.bases.includes(t));
  const mid = path.filter(ok);
  if (mid.length) return mid[Math.floor(mid.length / 2)];
  return state.grid.within(home, 3).find((t) => ok(t) && state.tiles[t].terrain !== "water") ?? home;
}
function dealCard(state, deal) {
  const f = factionById(state, deal.factionId);
  return {
    title: `Handover agreed: ${f ? f.name : "their"} people`, dealId: deal.id,
    text: `${f ? f.name : "They"} will hand over ${names(deal.captiveIds.map((id) => survivorById(state, id)).filter(Boolean))} at ${tileLabel(state, deal.tile)} for ${goodsText({ supplies: deal.supplies, gear: deal.gear })}${deal.prisonerIds.length ? ` and ${deal.prisonerIds.length} prisoner${deal.prisonerIds.length > 1 ? "s" : ""}` : ""}. Send a team with the goods within ${RANSOM.DEAL_DAYS} days (by day ${deal.until}). A strong team makes a betrayal less likely.`,
    choices: [
      { label: "Send the handover team", hint: `Your ${RANSOM.CREW} best fighters at the hub, the goods in their cargo`, ai: () => 6, resolve: (st) => { const r = sendHandover(st, deal); return typeof r === "string" ? r : `${names(partyMembers(st, r.party))} set out for ${tileLabel(st, deal.tile)}.`; } },
      { label: "Later", hint: "Send them from this card later: the deal stands until its day (the Groups tab lists it)", ai: () => 0, resolve: () => "" },
    ],
  };
}

// ---------- the handover team ----------
export function sendHandover(state, deal, opts = {}) {
  const h = hub(state);
  const f = factionById(state, deal.factionId);
  if (!h || !f || !f.alive) return "Nobody to hand them over to.";
  if (state.parties.some((p) => p.dealId === deal.id)) return "The handover team is already on its way.";
  for (const [k, q] of Object.entries(deal.supplies)) if ((h.stock[k] || 0) < q) return `Not enough ${SUPPLIES[k].name.toLowerCase()} at the hub for the deal.`;
  // The governor (opts.reserve) never pays food or water out of the hub's pay-out reserve (upkeep.js PAYOUT): the
  // handover waits (until the deal runs out) while the stores are that low.
  if (opts.reserve && payoutBreaks(state, h, deal.supplies)) return "The hub cannot spare the food or water the deal costs now.";
  if (deal.gear.some((it) => !(h.armory || []).includes(it))) return "A gun the deal names is no longer in the hub's armory.";
  const n = opts.crew ?? RANSOM.CREW;
  const crew = atBase(state, h.id).filter((s) => !s.inBed && s.health >= 40).sort((a, b) => combatPower(b) - combatPower(a) || a.id - b.id).slice(0, n);
  if (!crew.length) return "Nobody at the hub can go.";
  const days = 3;
  const have = (k) => Math.max(0, Math.floor((h.stock[k] || 0) - (deal.supplies[k] || 0)));
  const supplies = { food: Math.min(have("food"), days * crew.length), water: Math.min(have("water"), Math.ceil(days * crew.length * thirstAhead(state, days))), ammo: Math.min(have("ammo"), 15 * crew.length), meds: Math.min(have("meds"), 1) };
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: deal.tile, mission: "handover", stance: "normal", supplies, quiet: true });
  if (res.error) return res.error;
  const p = res.party;
  p.dealId = deal.id;
  for (const [k, q] of Object.entries(deal.supplies)) { h.stock[k] -= q; p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) + q; }
  for (const it of deal.gear) { h.armory.splice(h.armory.indexOf(it), 1); p.cargo.gear.push(it); }
  for (const id of deal.prisonerIds) { const pr = prisonersOf(state).find((x) => x.id === id); if (pr) pr.at = { kind: "party", partyId: p.id }; }
  teamPace(state, p);
  log(state, `${names(crew)} set out for ${tileLabel(state, deal.tile)} with the ransom for ${f.name}.`, "info");
  return { party: p };
}
// Their party at the meeting point.
function handoverParty(state, f, p, deal) {
  const n = partyMembers(state, p).length;
  const count = clamp(Math.round(1 + n * 0.9 + (deal.captiveIds.length || 1) * 0.5), 3, 8);
  return { kind: kindOf(f), count, power: Math.round((2.2 + (FACTION_TYPES[f.type] ? FACTION_TYPES[f.type].arms : 1) * 1.6) * 10) / 10, factionId: f.id, name: `${f.name} handover party` };
}
export function betrayChance(state, p, f, deal) {
  const B = RANSOM.BETRAY;
  const mine = (p.members || []).map((id) => survivorById(state, id)).filter((s) => s && s.alive).reduce((a, s) => a + combatPower(s), 0);
  const e = handoverParty(state, f, p, deal);
  const ratio = clamp((e.count * e.power) / Math.max(1, mine), B.ratio[0], B.ratio[1]);
  return clamp((B[f.type] ?? B.other) * ratio, B.min, B.max);
}
// parties.js arrive: the team at the meeting point.
export function handoverArrive(state, p) {
  const deal = dealsOf(state).find((d) => d.id === p.dealId);
  const f = deal ? factionById(state, deal.factionId) : null;
  const held = deal ? deal.captiveIds.map((id) => survivorById(state, id)).filter((s) => s && isCaptive(s) && f && s.location.factionId === f.id) : [];
  if (!deal || !f || !f.alive || !held.length) {
    if (deal) dealsOf(state).splice(dealsOf(state).indexOf(deal), 1);
    awaitOrders(state, p, !f || !f.alive ? "Nobody came: their group is gone." : "Nobody came: they no longer hold anyone of yours.", { failed: true });
    return "";
  }
  p.phase = "engaged";
  const risk = betrayChance(state, p, f, deal);
  addCard(state, {
    title: `The handover: ${f.name}`, partyId: p.id, where: tileLabel(state, partyTile(p)),
    text: `${handoverParty(state, f, p, deal).count} of ${f.name} wait at the meeting point with ${names(held)}, hands tied. They want ${goodsText({ supplies: deal.supplies, gear: deal.gear })}${deal.prisonerIds.length ? " and their people" : ""}.`,
    choices: [
      { label: "Make the exchange", hint: `Hand over the goods${deal.prisonerIds.length ? " and the prisoners" : ""}, take your people. About ${pct(risk)} they try something`, ai: () => 6,
        resolve: (st) => {
          const betray = RANSOM.BETRAY_FORCE || (!RANSOM.BETRAY_OFF && st.rng.chance(betrayChance(st, p, f, deal)));
          if (betray) { addCard(st, betrayalCard(st, p, f, deal)); return ""; }
          return completeHandover(st, p, f, deal);
        } },
      { label: "Back out", hint: `No exchange; goodwill ${RANSOM.BACK_OUT}. The deal is off`, ai: () => 0,
        resolve: (st) => { dealsOf(st).splice(dealsOf(st).indexOf(deal), 1); changeGoodwill(st, f, RANSOM.BACK_OUT, "you backed out of a handover"); awaitOrders(st, p, "The team backed out of the handover."); return "You back out."; } },
    ],
  });
  return "";
}
function completeHandover(state, p, f, deal) {
  const held = deal.captiveIds.map((id) => survivorById(state, id)).filter((s) => s && isCaptive(s) && s.location.factionId === f.id);
  for (const [k, q] of Object.entries(deal.supplies)) { const t = Math.min(q, Math.floor(p.cargo.supplies[k] || 0)); p.cargo.supplies[k] -= t; f.stock[k] = (f.stock[k] || 0) + t; }
  for (const it of deal.gear) { const i = p.cargo.gear.indexOf(it); if (i >= 0) { p.cargo.gear.splice(i, 1); (f.arsenal && Array.isArray(f.arsenal.items) ? f.arsenal.items : groupArmory(state, f)).push(it); } }
  for (const id of deal.prisonerIds) handOver(state, id);
  for (const s of held) freeCaptive(state, s, p);
  dealsOf(state).splice(dealsOf(state).indexOf(deal), 1);
  changeGoodwill(state, f, RANSOM.DONE_GW, "a fair handover");
  const st = state.stats.conflicts || (state.stats.conflicts = { types: {}, outcomes: {}, captured: 0, rescued: 0, joined: 0, captiveEvents: {} });
  st.outcomes["ransom-handover"] = (st.outcomes["ransom-handover"] || 0) + 1;
  const text = `The exchange is made: ${names(held)} ${held.length === 1 ? "is" : "are"} back with the team.`;
  log(state, `${text} (${f.name})`, "good");
  awaitOrders(state, p, text);
  return text;
}
function betrayalCard(state, p, f, deal) {
  const e = handoverParty(state, f, p, deal);
  const mine = partyMembers(state, p);
  const odds = winOdds(mine.reduce((a, s) => a + combatPower(s), 0) / Math.max(0.1, e.count * e.power * 1.4), { ...e, people: mine.length, ambush: "enemy" });
  return {
    title: `Betrayal at the handover`, partyId: p.id, where: tileLabel(state, partyTile(p)),
    text: `As the goods change hands, ${f.name}'s people go for their guns: they mean to keep the goods and ${deal.captiveIds.length === 1 ? "your person" : "your people"}. They have the drop on you.`,
    choices: [
      { label: tacticalPossible(state) ? "Fight back (on the road map)" : "Fight back", fight: { odds, enemy: e, ambush: "enemy" }, hint: `About ${pct(odds)} to win. Win: your people and the goods are yours. Lose: they keep both`, ai: () => (odds >= 0.4 ? 5 : 1),
        resolve: (st) => {
          p.phase = "engaged";
          startCombat(st, { tile: partyTile(p), partyId: p.id, enemy: { ...e }, ambush: "enemy", canRetreat: true, handler: "handoverAmbush", layout: "rescueRoad", context: { partyId: p.id, factionId: f.id, dealId: deal.id, captiveIds: [...deal.captiveIds], mode: "road" } });
          return "";
        } },
      { label: "Run for it", hint: "They keep the goods and your people; the team gets away", ai: () => (odds < 0.4 ? 3 : 0),
        resolve: (st) => { lostHandover(st, p, f, deal); awaitOrders(st, p, "The team ran. They kept the goods."); return "You run."; } },
    ],
  };
}
// They keep the goods (and the prisoners walking with the team go back to them).
function lostHandover(state, p, f, deal) {
  for (const [k, q] of Object.entries(deal.supplies)) { const t = Math.min(q, Math.floor((p.cargo.supplies[k] || 0))); p.cargo.supplies[k] = (p.cargo.supplies[k] || 0) - t; f.stock[k] = (f.stock[k] || 0) + t; }
  for (const it of deal.gear) { const i = p.cargo.gear.indexOf(it); if (i >= 0) { p.cargo.gear.splice(i, 1); (f.arsenal && Array.isArray(f.arsenal.items) ? f.arsenal.items : groupArmory(state, f)).push(it); } }
  for (const id of deal.prisonerIds) { const pr = prisonersOf(state).find((x) => x.id === id); if (pr && pr.at.kind === "party" && pr.at.partyId === p.id) handOver(state, id); }
  const i = dealsOf(state).indexOf(deal);
  if (i >= 0) dealsOf(state).splice(i, 1);
  changeGoodwill(state, f, RANSOM.BETRAYED_GW, "they betrayed a handover");
  log(state, `${f.name} betrayed the handover and kept the goods.`, "danger");
}
registerCombatHandler("handoverAmbush", (state, result, setup, battle) => {
  const c = setup.context;
  const p = state.parties.find((x) => x.id === c.partyId);
  const f = factionById(state, c.factionId);
  const deal = dealsOf(state).find((d) => d.id === c.dealId);
  let text;
  if (result.tactical && battle) text = afterRescueBattle(state, result, setup, battle).text;
  else if (result.outcome === "victory" && f) {
    const held = c.captiveIds.map((id) => survivorById(state, id)).filter((s) => s && isCaptive(s) && s.location.factionId === f.id);
    for (const s of held) { if (p && state.parties.includes(p)) freeCaptive(state, s, p); }
    text = held.length ? `They are beaten: ${names(held)} ${held.length === 1 ? "is" : "are"} free.` : "They are beaten.";
  } else text = result.outcome === "retreat" ? "The team broke away." : "The team was beaten.";
  if (f) f.pop = Math.max(0, f.pop - Math.ceil((result.enemiesKilled || 0) * 0.6));
  if (f && deal) {
    if (result.outcome === "victory") { const i = dealsOf(state).indexOf(deal); if (i >= 0) dealsOf(state).splice(i, 1); changeGoodwill(state, f, RANSOM.BETRAYED_GW, "they betrayed a handover"); text += " The goods stay with the team."; }
    else if (p && state.parties.includes(p)) { lostHandover(state, p, f, deal); text += " They kept the goods."; }
    else { const i = dealsOf(state).indexOf(deal); if (i >= 0) dealsOf(state).splice(i, 1); }
  }
  log(state, `Betrayal at the handover: ${text}`, result.outcome === "victory" ? "good" : "danger");
  if (p && state.parties.includes(p) && !wipeIfEmpty(state, p)) awaitOrders(state, p, text);
});

// ---------- every hour (world.js) ----------
export function ransomHour(state) {
  // People brought home by a friendly group.
  for (const r of [...returnsOf(state)]) {
    if (state.hour < r.due) continue;
    returnsOf(state).splice(returnsOf(state).indexOf(r), 1);
    const s = survivorById(state, r.sid);
    const h = hub(state);
    if (!s || !isCaptive(s) || !h) continue;
    s.location = { kind: "base", baseId: h.id };
    s.role = "rest";
    s.mood = Math.min(100, s.mood + 15);
    const st = state.stats.conflicts;
    if (st) st.rescued += 1;
    const f = factionById(state, r.factionId);
    log(state, `${f ? f.name : "Their captors"} brought ${s.name} home, as agreed.`, "good");
  }
  // Envoys back with their demands.
  for (const t of [...talksOf(state)]) {
    if (state.hour < t.due) continue;
    talksOf(state).splice(talksOf(state).indexOf(t), 1);
    const f = factionById(state, t.factionId);
    if (!f || !f.alive) continue;
    const ids = t.captiveIds.filter((id) => { const s = survivorById(state, id); return s && isCaptive(s) && s.location.factionId === f.id; });
    if (ids.length) addCard(state, negotiationCard(state, f, ids, { channel: "envoy" }));
  }
  // Deals nobody turned up for.
  for (const d of [...dealsOf(state)]) {
    const f = factionById(state, d.factionId);
    const gone = !f || !f.alive || !d.captiveIds.some((id) => { const s = survivorById(state, id); return s && isCaptive(s); });
    if (!gone && (day(state) <= d.until || state.parties.some((p) => p.dealId === d.id))) continue;
    dealsOf(state).splice(dealsOf(state).indexOf(d), 1);
    if (!gone && f) { changeGoodwill(state, f, RANSOM.BACK_OUT, "nobody came to the handover"); log(state, `Nobody went to the handover with ${f.name}: the deal is off.`, "danger"); }
  }
}

// ---------- the governor ----------
function autoKeep(state) {
  const h = hub(state);
  const n = h ? atBase(state, h.id).length : 0;
  const A = RANSOM.AUTO;
  // At least the pay-out reserve (upkeep.js PAYOUT: everyone fed there, prisoners and guests too).
  return { food: Math.max(A.keepFood * n, Math.ceil(payoutFloor(state, h, "food"))), water: Math.max(A.keepWater * n, Math.ceil(payoutFloor(state, h, "water"))), ammo: A.keepAmmo, meds: A.keepMeds, fuel: A.keepFuel, scrap: 20, parts: 2 };
}
function spareValue(state) {
  const h = hub(state);
  if (!h) return 0;
  const keep = autoKeep(state);
  return Object.keys(SUPPLIES).reduce((a, k) => a + Math.max(0, (h.stock[k] || 0) - (keep[k] || 0)) * SUPPLIES[k].value, 0);
}
export function autoCanPay(state, f, value) {
  const h = hub(state);
  if (!h) return false;
  const plan = goodsPlan(f, h.stock, h.armory, value, autoKeep(state));
  return !!plan && plan.worth <= spareValue(state) * RANSOM.AUTO.share * 2 + 1 && value <= spareValue(state) * RANSOM.AUTO.share * 1.6;
}
// What the governor would do for this captive: { kind: "ransom" | "exchange" | "raid" | "wait", why }.
export function autoRescuePlan(state, s) {
  if (!s || !isCaptive(s)) return null;
  const f = factionById(state, s.location.factionId);
  if (!f || !f.alive || !hub(state)) return null;
  const held = captivesOf(state, f.id);
  // The value rule (ransomVerdict): pay when they are worth the price and the hub can spare it; a prisoner exchange
  // when it covers the price; else a raid when the squad would beat the base and its jail guards; else decline.
  const v = ransomVerdict(state, f, held);
  if (v.kind === "pay") return { kind: "ransom", why: `pay ${f.name} about ${v.price} for ${names(held)} (worth about ${v.worth} to you)` };
  const ex = exchangeOffer(state, f, held, v.price);
  if (ex && ex.covers && (ex.rest <= 0 || (autoCanPay(state, f, ex.rest) && v.worth >= ex.rest))) return { kind: "exchange", why: `trade ${ex.prisoners.length} prisoner${ex.prisoners.length > 1 ? "s" : ""} for ${names(held)}` };
  if (v.kind === "raid") return { kind: "raid", why: v.why, odds: v.odds };
  return { kind: "wait", why: `declined: ${v.why}` };
}
// The governor's day (autopilot.js): ransoms agreed and handover teams sent. Rescue raids go through its mission
// planner (autopilot.js: the Rescue mission when autoRescuePlan says "raid"). Returns a line or "".
export function autopilotRescue(state) {
  if (!state.autopilot || !hub(state)) return "";
  const out = [];
  for (const d of [...dealsOf(state)]) {
    if (state.parties.some((p) => p.dealId === d.id)) continue;
    const r = sendHandover(state, d, { reserve: true });
    out.push(typeof r === "string" ? `handover for ${factionById(state, d.factionId)?.name}: ${r}` : `the handover team set out for ${tileLabel(state, d.tile)}`);
  }
  const seen = new Set();
  for (const s of allCaptives(state)) {
    const f = factionById(state, s.location.factionId);
    if (!f || seen.has(f.id) || dealFor(state, f) || talksOf(state).some((t) => t.factionId === f.id) || returnsOf(state).some((r) => r.factionId === f.id)) continue;
    seen.add(f.id);
    const plan = autoRescuePlan(state, s);
    if (!plan || (plan.kind !== "ransom" && plan.kind !== "exchange")) continue;
    const ids = captivesOf(state, f.id).map((x) => x.id);
    if (!canRadioGroup(state, f)) { talksOf(state).push({ factionId: f.id, captiveIds: ids, due: state.hour + envoyHours(state, f) }); out.push(`an envoy to ${f.name}`); continue; }
    const card = negotiationCard(state, f, ids, { channel: "radio" });
    const ch = [...card.choices].filter((c) => !(typeof c.disabled === "function" ? c.disabled(state) : c.disabled) && !/^Haggle/.test(c.label)).sort((a, b) => (b.ai ? b.ai(state) : 0) - (a.ai ? a.ai(state) : 0))[0];
    if (!ch || (ch.ai && ch.ai(state) <= 0)) continue;
    out.push(`${f.name}: ${ch.resolve(state)}`);
    const d = dealFor(state, f);
    if (d) {
      // The deal card it just raised is the governor's to answer: send the team now.
      const i = state.cards.findIndex((c) => c.dealId === d.id);
      if (i >= 0) state.cards.splice(i, 1);
      const r = sendHandover(state, d, { reserve: true });
      if (typeof r === "string") out.push(r);
    }
  }
  return out.join("; ");
}
