// Breaking off a fight resolved by the numbers (combat.js autoResolveCombat: the Auto-resolve button, headless
// tools, the autopilot and crews). The tactical battle has "Sound the retreat" (combat.js soundRetreat); this is the
// same order for a fight nobody plays on the map.
//
// A fight by the numbers is decided as before (one roll on the odds the card shows) and then plays out in ROUNDS
// rounds: the wounds of the fight land round by round (a fight that is won takes its knocks early, one that is lost
// keeps taking them to the last round), and after each of the first two rounds the team looks at how it is going. A team's
// "Retreat if it goes badly" policy (chosen on the card, or by the autopilot's style, or by a crew's role) decides
// whether it breaks off there:
//   never   - fight it out (the old resolution, unchanged in its odds and wounds)
//   most    - pull out when more than half of the team is down or badly hurt (health under BADLY, 50)
//   losing  - pull out when the fight turns against them (seen after round 1 in about half of the fights being lost,
//             nearly always by round 2; a false alarm now and then in a close fight that would have been won) or
//             anyone is down
//   blood   - pull out as soon as anyone is hurt (and on any sign of the above)
// Breaking off: everyone still standing runs (escapeChanceByNumbers: the tactical escape check, combat.js RETREAT,
// with the battle map's distances and pursuers estimated from what is left of the enemy), each downed teammate is
// carried by the one with the best odds (each carries one), the caught take the tactical blows (BLOW per enemy on
// them) and can go down; the downed carried out pull through like the tactical ones (50% + 2% a point of Medicine of
// the best medic who got out); the downed left behind are lost: killed, or taken prisoner by a group's people
// (CAPTURE). The enemy loses a share of its people for the rounds fought; there is no loot (only a won fight is
// searched), part of the ammo is not fired. The outcome is "retreat" (or "defeat" if nobody got out).
//
// Where it applies: a team's fight in the field (setup.partyId, a way out, not a raid, not a base defence):
// road conflicts, ambushes, rescues, outsider fights, group-base assaults. A base defence (defences.js, raids)
// does not use it: breakOff below is the helper for "abandon the base" there.
import { woundMult, fleetEscape } from "./traits.js"; // Tough, Frail, Fleet-Footed
import { RETREAT, downChance, loadPenalty } from "./combat.js";
import { battleKg } from "./carrykit.js"; // the kit carried (kg): the escape check's load penalty
import { hurt, isNight, skill, log, factionById, survivorById, localId } from "./world.js";
import { armorMult } from "./inventory.js";
import { absorbOffscreen } from "./armour.js"; // per-hit armour: what a wound by the numbers wears off the armour worn
import { Rng } from "./rng.js";
import { woundTrauma } from "./health.js";
import { fightXp, hash01 } from "./skills.js";
import { takeCaptive } from "./conflicts.js";
import { memberMedic, MEDIC } from "./medics.js"; // a medic's kit: the carried and the fallen pull through more often

export const RETREAT_POLICIES = {
  never:  { name: "Never",              short: "never",                desc: "Fight it out to the end, win or lose." },
  most:   { name: "When most are down", short: "when most are down",   desc: "Pull out only when more than half of the team is down or badly hurt." },
  losing: { name: "If losing",          short: "if losing",            desc: "Pull out when the fight turns against you, or anyone goes down." },
  blood:  { name: "At first blood",     short: "at first blood",       desc: "Pull out as soon as anyone is hurt. Safest, but gives up fights you would have won." },
};
export const POLICY_ORDER = ["never", "most", "losing", "blood"];
// The autopilot's (and a crew's, unless its role says otherwise) policy by style.
export const STYLE_POLICY = { cautious: "losing", balanced: "losing", aggressive: "most" };
// The tactical AI style a policy maps to, for fights a team plays on the map headless (a hive assault).
export const POLICY_STYLE = { never: "aggressive", most: "aggressive", losing: "balanced", blood: "cautious" };

export const BREAKOFF = {
  ROUNDS: 3,
  TURN_LOSS: [0.5, 0.95],  // a fight being lost: the chance it shows after round 1 / 2 (+ LOPSIDED × (1 − win chance) after round 1)
  LOPSIDED: 0.4,
  FALSE_ALARM: [0.25, 0.1], // a fight that would be won looks lost after round 1 / 2: this × (1 − win chance)
  BADLY: 50,               // health under this is badly hurt ("most")
  WEAR: 1,                 // breaking off: a blow still to come has partly landed, WEAR × (share of the team down)^1.5 (rollFight)
  TILES: [2, 5],           // distance to safety (tiles, as the tactical strip): field fights start near the way out
  // ... by the enemy (the map, tools/retreattest.js RT_PARTS=1, seeds 7, 9, 11: tiles a runner when the Cautious AI
  // pulls out): against the dead nearer still, a team holds its ground near where it came in while they come to it
  // (2.2-2.6; raiders 3.6-4.7, as TILES); soldiers are fought at range, from farther up the field (5.3-6.3); a mixed
  // fight farther yet (5-9, few retreats).
  TILES_BY: { zombies: [1, 3], soldiers: [3, 8], mixed: [4, 10] },
  AMBUSHED: 2, STRUCK_FIRST: -1, // they had the drop on you: farther; you struck first: closer
  PIN_DEAD: 0.25,          // each of the dead left per runner: this many on them (next to them; the map: 0.1-0.25 on a runner,
                           // the rest of them behind it, as chasers, when the Cautious AI pulls out; it was 0.35, 0.7 a runner)
  PIN_PEOPLE: 0.05,        // people rarely close to grappling range
  SHOOT: 0.35,             // shooters that see a runner: this share of the people left
  // ... × this by the end of round 1 / 2: people who have only just been engaged are spread over the field, behind
  // cover and mostly without a line on a runner yet (the map: about 0.4-0.75 shooters a runner when the Cautious AI
  // pulls out on turn 2-3, three quarters of the runners with nobody on them at all; 1.7 a runner by turn 5).
  SHOOT_CLOSE: [0.3, 1],
  CHASE: 0.5,              // the dead close behind: this share of the dead left
  CLOSE: [0.35, 0.5],      // how far the dead have closed in by the end of round 1 / 2 (× those on and behind a runner)
  PURSUERS: 16,            // at most this many of them can get at the runners (a battle map holds 20)
  PIN_MAX: 3,              // at most this many on one runner
  VEHICLE: 10, BIKE: 5,    // a car (bikes) waiting near the fight
  STEALTHY: 10,            // a team travelling stealthily slips away more easily
  CAPTURE: 0.5,            // a downed member left to a group's people is taken prisoner (else killed)
  KILLS_LOST: [0.1, 0.5],  // the share of the enemy down when a fight is lost (all of it when won)
  KILLS_WON: [0.35, 0.75], // the share down per round fought, when a fight that would be won is broken off
  // The blood a fight costs, calibrated on the battle map (tools/calibrate.js: the same fights played out by the AI on
  // both sides, no retreat): each member of a team that loses a fight fought out goes down LOST_DOWN of the time
  // (LOST_DOWN_DEAD against the dead: they do not stop); in a fight that is won WON_DOWN + WON_CLOSE × the chance it
  // had of going the other way (+ WON_DEAD against the dead). Of those still standing, WOUND (× more when it was
  // close or lost) take a wound of WOUND_RAW.
  LOST_DOWN: 0.8, LOST_DOWN_DEAD: 0.92, WON_DOWN: 0.05, WON_CLOSE: 0.42, WON_DEAD: 0, WOUND: 0.45, WOUND_RAW: [10, 40], WOUND_RAW_LOST: [20, 55],
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const first = (s) => s.name.split(" ")[0];
const humanShare = (kind) => (kind === "zombies" ? 0 : kind === "mixed" ? 0.5 : 1);
const randRound = (rng, x) => Math.floor(x + rng.next());
const roleById = (state, id) => (state.work && id != null ? state.work.roles.find((r) => r.id === id) || null : null); // work.js roleById

// ---------- which fights, which policy ----------
// A team's fight in the field with a way out: the ones a retreat by the numbers applies to (setup.breakOff true /
// false: a caller's say, e.g. the tools measuring it on a base's fighters).
export const breaksOff = (setup) => !!setup && setup.breakOff !== false && (setup.breakOff === true || setup.partyId != null && setup.baseId == null && setup.canRetreat !== false
  && setup.mode !== "raid" && setup.layout !== "baseDefence" && !setup.deploy);

export const validPolicy = (k) => (RETREAT_POLICIES[k] ? k : null);
// The policy a team fights by: its own (set on a card), its crew role's, the autopilot's style, else Never.
export function teamPolicy(state, p) {
  if (p && validPolicy(p.retreatPolicy)) return p.retreatPolicy;
  if (p && p.crewRole != null) {
    const role = roleById(state, p.crewRole);
    const c = role && role.crew;
    if (c) return validPolicy(c.retreat) || STYLE_POLICY[c.style || "balanced"] || "losing";
  }
  if (state.autopilot) return STYLE_POLICY[(state.governor && state.governor.personality) || "balanced"] || "losing";
  return "never";
}
// Where it came from, for the card ("set on this team", "the crew's role", "the autopilot's style").
export function policySource(state, p) {
  if (p && validPolicy(p.retreatPolicy)) return "team";
  if (p && p.crewRole != null && roleById(state, p.crewRole)) return "crew";
  if (state.autopilot) return "autopilot";
  return "default";
}
export function setTeamPolicy(state, p, key) {
  if (!p || !validPolicy(key)) return false;
  p.retreatPolicy = key;
  return true;
}
export function policyFor(state, setup) {
  if (!breaksOff(setup)) return "never";
  if (validPolicy(setup.retreatPolicy)) return setup.retreatPolicy;
  return teamPolicy(state, state.parties.find((x) => x.id === setup.partyId));
}
// A battle played on the map by the AI (a hive assault headless, defences.js fightNow): a policy set for the team or
// its crew as the AI's retreat style (combat.js retreatAdvice); otherwise the battle's usual style.
export function tacticalStyleFor(state, p) {
  const src = policySource(state, p);
  return src === "team" || src === "crew" ? POLICY_STYLE[teamPolicy(state, p)] : undefined;
}
// A crew role's policy (crews.js role.crew.retreat; empty = by its style).
export const crewPolicy = (c) => validPolicy(c && c.retreat) || STYLE_POLICY[(c && c.style) || "balanced"] || "losing";

// ---------- the escape check ----------
// The tactical check (combat.js escapeOdds) with the map's numbers given: 100 − 3 a tile (4.5 carrying) − 25 per
// enemy on them − (6 a shooter in sight + 4 a chaser, at most 35) − up to 30 for wounds − 0.5 a kg carried over 8 + 1 a
// point of Scouting (+ 10 Fleet-Footed) + 10 at night − 10 carrying; by the numbers also + 10 a car (+ 5 bikes) and + 10 a stealthy
// stance. 5–95; safe with nobody on them, nobody shooting or chasing and nobody to carry.
// m: { hp, maxHp?, load, scouting, mult, fleet? }. e: { tiles, pinned, shooters, chasers, night, carrying, vehicle, stealthy, smoke }
export function escapeChanceByNumbers(m, e) {
  const R = RETREAT;
  const tiles = Math.round(Math.min(R.MAX_TILES, Math.max(0, e.tiles || 0)));
  const threat = Math.min(R.THREAT_MAX, (e.shooters || 0) * R.SHOOTER + (e.chasers || 0) * R.CHASER);
  const parts = [];
  const add = (label, v) => { if (label && Math.round(v)) parts.push([label, Math.round(v)]); };
  add(`${tiles} tile${tiles === 1 ? "" : "s"} to safety`, -tiles * (e.carrying ? R.CARRY_TILE : R.PER_TILE));
  add(`${e.pinned || 0} on them`, -(e.pinned || 0) * R.PINNED);
  add("shooters and chasers", -threat);
  add("wounds", -R.WOUNDS * Math.max(0, 1 - m.hp / (m.maxHp || 100)));
  add("load carried", -loadPenalty(m.load)); // combat.js: the kg carried over 8
  add(`Scouting ${m.scouting || 0}`, R.SCOUTING * (m.scouting || 0));
  add("Fleet-Footed", m.fleet || 0); // traits.js
  add("night", e.night ? R.NIGHT : 0);
  add("smoke cover", e.smoke || 0);
  add("carrying", e.carrying ? -R.CARRY : 0);
  add(e.vehicle === "bike" ? "bikes close by" : "the vehicle close by", e.vehicle === true ? BREAKOFF.VEHICLE : e.vehicle === "bike" ? BREAKOFF.BIKE : 0);
  add("stealthy", e.stealthy ? BREAKOFF.STEALTHY : 0);
  const safe = !e.pinned && !threat && !e.carrying;
  const chance = safe ? 100 : clamp(100 + parts.reduce((a, p) => a + p[1], 0), R.MIN, R.MAX);
  const lostIfCaught = safe ? 0 : downChance(Math.max(1, e.pinned || 0), Math.max(0, m.hp) / Math.max(0.05, m.mult || 1));
  return { chance, safe, parts, lostIfCaught };
}

// ---------- the fight's model (plain data, no state: the real fight and the card's forecast both use it) ----------
// A member: { id, name, hp, mult (damage taken ×: Tough or Frail, armor), fleet (Fleet-Footed's escape bonus), load (kg carried), scouting, medicine }.
function memberOf(s) {
  const med = memberMedic(s); // medics.js: a med kit anywhere on them adds to their Medicine; kit: they are a medic
  return {
    id: s.id, name: s.name, hp: s.health, maxHp: 100,
    mult: woundMult(s) * armorMult(s), fleet: fleetEscape(s), // Tough, Frail; Fleet-Footed (traits.js)
    load: battleKg(s), scouting: skill(s, "scouting"), medicine: skill(s, "medicine") + med.bonus, kit: med.kit,
  };
}
// The fight as the model sees it. win: the chance to win fought to the end (the odds the card shows).
export function fightModel(state, people, { win, enemy, ambush = null, party = null, capture = 0 }) {
  return {
    members: people.filter((s) => s.alive).map(memberOf),
    win, enemy: { kind: enemy.kind, count: Math.max(1, Math.round(enemy.count || 1)) }, ambush,
    night: isNight(state), vehicle: party ? party.vehicle || false : false, stealthy: !!(party && party.stance === "stealthy"),
    capture,
  };
}

// The escape plan for the members still standing (with the downed to carry): every runner's odds and burden.
// rng draws the pursuers on each runner (who has the dead on them, who is in sight). close: how far the dead have
// closed in (BREAKOFF.CLOSE); seen: the share of the people who have a line on a runner (BREAKOFF.SHOOT_CLOSE).
function planEscape(rng, model, ms, enemyLeft, close = 1, seen = 1) {
  const standing = ms.filter((m) => !m.down);
  const downed = ms.filter((m) => m.down);
  enemyLeft = Math.min(BREAKOFF.PURSUERS, enemyLeft);
  const hs = humanShare(model.enemy.kind);
  const per = Math.max(1, standing.length);
  const plan = standing.map((m) => {
    const span = model.tiles || BREAKOFF.TILES_BY[model.enemy.kind] || BREAKOFF.TILES;
    const tiles = rng.int(span[0], span[1]) + (model.ambush === "enemy" ? BREAKOFF.AMBUSHED : model.ambush === "player" ? BREAKOFF.STRUCK_FIRST : 0);
    const e = {
      tiles: Math.max(0, tiles),
      pinned: Math.min(BREAKOFF.PIN_MAX, randRound(rng, ((enemyLeft * (1 - hs) / per) * BREAKOFF.PIN_DEAD + (enemyLeft * hs / per) * BREAKOFF.PIN_PEOPLE) * close)),
      shooters: randRound(rng, enemyLeft * hs * BREAKOFF.SHOOT * seen),
      chasers: randRound(rng, enemyLeft * (1 - hs) * BREAKOFF.CHASE * close),
      night: model.night, vehicle: model.vehicle, stealthy: model.stealthy,
    };
    return { m, e, carrying: null, ...escapeChanceByNumbers(m, e) };
  });
  // Each downed teammate goes with the free runner whose odds carrying them are best.
  for (const d of downed) {
    let best = null;
    for (const r of plan) {
      if (r.carrying) continue;
      const o = escapeChanceByNumbers(r.m, { ...r.e, carrying: true });
      if (!best || o.chance > best.o.chance) best = { r, o };
    }
    if (best) Object.assign(best.r, { carrying: d }, best.o);
  }
  return plan;
}

// Everyone standing runs for it: each rolls their escape (a carrier caught drops whoever they carried), the caught
// take the blows. Returns { escaped, caught, carried: [{ id, by, lives }], left: [{ id, captured }], lines }.
// Draws from rng; changes the members' hp and down flags only.
function runFor(rng, model, ms, enemyLeft, close = 1, seen = 1) {
  const plan = planEscape(rng, model, ms, enemyLeft, close, seen);
  // odds: each runner's chance and what it was made of (tools/retreattest.js compares them with the map's escapeOdds).
  const out = { escaped: [], caught: [], carried: [], left: [], blows: [], lines: [], odds: plan.map((r) => ({ id: r.m.id, chance: r.chance, carrying: r.carrying ? r.carrying.id : null, tiles: r.e.tiles, pinned: r.e.pinned, shooters: r.e.shooters, chasers: r.e.chasers, hp: r.m.hp })) };
  const carriedOut = [];
  for (const r of plan) {
    const m = r.m, t = r.carrying;
    if (r.safe || rng.chance(r.chance / 100)) {
      out.escaped.push(m.id);
      if (t) carriedOut.push({ t, by: m });
      out.lines.push(`${first(m)} ${r.safe ? "gets out" : `makes it out (${r.chance}%)`}${t ? `, carrying ${first(t)}` : ""}.`);
      continue;
    }
    let raw = 0;
    for (let i = 0; i < Math.max(1, r.e.pinned); i++) raw += rng.int(RETREAT.BLOW[0], RETREAT.BLOW[1]);
    m.hp -= raw * m.mult;
    out.caught.push(m.id);
    out.blows.push({ id: m.id, raw });
    if (m.hp <= 0) {
      m.down = true;
      out.lines.push(`${first(m)} is caught (${r.chance}% to get away) and dragged down: left behind.`);
    } else {
      out.escaped.push(m.id);
      out.lines.push(`${first(m)} is caught (${r.chance}% to get away) but tears free and gets out.`);
    }
    if (t) out.lines.push(`${first(t)} has to be dropped.`);
  }
  // The carried pull through like the tactical ones: 50% + 2% a point of Medicine of the best medic who got out.
  const medic = Math.max(0, ...ms.filter((m) => !m.down && out.escaped.includes(m.id)).map((m) => (m.medicine || 0) + (m.kit ? MEDIC.END_KIT : 0))); // medics.js: more for a medic with a kit
  const carriedIds = new Set(carriedOut.map((c) => c.t.id));
  for (const c of carriedOut) out.carried.push({ id: c.t.id, by: c.by.id, lives: rng.chance(0.5 + medic * 0.02) });
  for (const m of ms) if (m.down && !carriedIds.has(m.id)) out.left.push({ id: m.id, captured: model.capture > 0 && rng.chance(model.capture) });
  return out;
}

// Would this policy pull out now? look: { turning, hit, down, badly, n }.
export function wantsOut(policy, look) {
  if (policy === "most") return (look.down + look.badly) * 2 > look.n;
  if (policy === "losing") return look.turning || look.down > 0;
  if (policy === "blood") return look.turning || look.down > 0 || look.hit > 0;
  return false;
}

// One fight, start to end. Draws from rng in a fixed order (the fate, the wounds, then a look after each round), so a
// fight that is not broken off plays out exactly as it would with the policy Never.
// Returns { win, outcome, round (broken off after this round, or null), hits: [{ id, raw }], worn: [{ id, raw }] (broken
// off: the blows still to come, in part), members, run, killShare }.
export function rollFight(rng, model, policy = "never") {
  const R = BREAKOFF.ROUNDS;
  const ms = model.members.map((m) => ({ ...m, down: false, hit: false }));
  const n = ms.length;
  const w = clamp(model.win, 0.05, 0.95);
  const win = rng.chance(w);
  // The fight's blows, drawn up front (BREAKOFF.LOST_DOWN ...: calibrated on the battle map): who goes down, who is
  // wounded, in a shuffled order. A won fight takes its knocks early; a lost one keeps taking them, the last ones in
  // the last round (so a team that breaks off early is spared most of them).
  const B = BREAKOFF, dead = model.enemy.kind === "zombies";
  const pDown = win ? B.WON_DOWN + B.WON_CLOSE * (1 - w) + (dead ? B.WON_DEAD : 0) : dead ? B.LOST_DOWN_DEAD : B.LOST_DOWN;
  const pWound = Math.min(0.95, B.WOUND * (win ? 0.6 + (1 - w) : 1.5));
  const plan = [];
  for (const m of ms) {
    if (rng.chance(pDown)) plan.push({ m, raw: Math.ceil(m.hp / Math.max(0.05, m.mult)) + rng.int(0, 20) });
    else if (rng.chance(pWound)) { const [lo, hi] = win ? B.WOUND_RAW : B.WOUND_RAW_LOST; plan.push({ m, raw: rng.int(lo, hi) }); }
  }
  rng.shuffle(plan);
  // A won fight: its wounds come early and whoever falls, falls in the last round as it is decided (nobody breaks off
  // a fight they are winning because of it, as on the map). A lost one: spread over the rounds to the last.
  if (win) plan.sort((a, b) => (a.raw >= a.m.hp / a.m.mult ? 1 : 0) - (b.raw >= b.m.hp / b.m.mult ? 1 : 0));
  const H = plan.length;
  const wounds = win ? plan.filter((x) => x.raw < x.m.hp / x.m.mult).length : 0;
  const roundOf = (i) => (win ? (i >= wounds ? R - 1 : Math.floor((i * (R - 1)) / Math.max(1, wounds))) : Math.min(R - 1, Math.floor((i * R) / Math.max(1, H))));
  const hits = [];
  let i = 0, round = null;
  for (let r = 0; r < R; r++) {
    const look = rng.next(); // how the fight looks after this round
    for (; i < H && roundOf(i) === r; i++) {
      const { m, raw } = plan[i];
      if (m.down) continue;
      m.hp -= raw * m.mult;
      m.hit = true;
      if (m.hp <= 0) m.down = true;
      hits.push({ id: m.id, raw });
    }
    if (r === R - 1 || !ms.some((m) => !m.down)) break;
    const turning = win ? look < BREAKOFF.FALSE_ALARM[r] * (1 - w) : look < Math.min(1, BREAKOFF.TURN_LOSS[r] + (r === 0 ? BREAKOFF.LOPSIDED * (1 - w) : 0));
    const state = { turning, n, hit: ms.filter((m) => m.hit).length, down: ms.filter((m) => m.down).length, badly: ms.filter((m) => !m.down && m.hp < BREAKOFF.BADLY).length };
    if (wantsOut(policy, state)) { round = r; break; }
  }
  if (round == null) {
    const killShare = win ? 1 : rng.range(BREAKOFF.KILLS_LOST[0], BREAKOFF.KILLS_LOST[1]);
    if (win) medicSaves(rng, ms); // medics.js: a medic still standing saves some of the fallen
    return { win, outcome: win ? "victory" : "defeat", round: null, hits, members: ms, run: null, killShare };
  }
  // Worn down: the fight's blows land whole, so without this whoever still stands when the team breaks off is as
  // fresh as at the start, and a caught runner (one blow of 18-32, two or three with the dead on them) always tore
  // free: "When most are down" got 100% of its runners out where the map's Aggressive AI gets about 73%. On the map
  // those still standing have been shot at and clawed all along, more the more of the team has fallen (runners'
  // health: about 90 when the Cautious AI pulls out early, about 55 when the Aggressive one does). So a blow still to
  // come has partly landed: WEAR × (the share of the team down)^1.5 of it (still standing: at least 1 health left).
  // Kept apart from `hits` (the wounds of the rounds fought, the same as Never's up to here).
  const share = BREAKOFF.WEAR * (ms.filter((m) => m.down).length / n) ** 1.5;
  const worn = [];
  for (let j = i; j < H; j++) {
    const { m, raw } = plan[j];
    if (m.down) continue;
    const w = Math.min(Math.floor(raw * share), Math.ceil(m.hp / Math.max(0.05, m.mult)) - 1);
    if (w <= 0) continue;
    m.hp -= w * m.mult;
    m.hit = true;
    worn.push({ id: m.id, raw: w });
  }
  const k = win ? BREAKOFF.KILLS_WON : BREAKOFF.KILLS_LOST;
  const killShare = rng.range(k[0], k[1]) * ((round + 1) / R);
  const left = Math.max(0, model.enemy.count - Math.floor(model.enemy.count * killShare));
  const run = runFor(rng, model, ms, left, BREAKOFF.CLOSE[Math.min(round, BREAKOFF.CLOSE.length - 1)], BREAKOFF.SHOOT_CLOSE[Math.min(round, BREAKOFF.SHOOT_CLOSE.length - 1)]);
  return { win, outcome: run.escaped.length ? "retreat" : "defeat", round, hits, worn, members: ms, run, killShare };
}

// A won fight fought to the end (medics.js MEDIC.NUMBERS): each member who fell is saved, barely alive, by the best
// medic with a kit still standing (SAVE + PER_MED a point of their Medicine, at most MAX). Its own dice, read off the
// stream's state without drawing from it (skills.js hash01), so a fight with or without a medic goes on with exactly
// the same dice as before medics existed. Sets m.saved.
function medicSaves(rng, ms) {
  const medics = ms.filter((m) => !m.down && m.kit);
  if (!medics.length) return;
  const med = Math.max(...medics.map((m) => m.medicine || 0));
  const p = Math.min(MEDIC.NUMBERS.MAX, MEDIC.NUMBERS.SAVE + MEDIC.NUMBERS.PER_MED * med);
  const at = Number.isFinite(rng.state) ? rng.state : 0;
  for (const m of ms) if (m.down && hash01("medicsave", at, m.id) < p) m.saved = true;
}

// ---------- the real fight ----------
// combat.js autoResolveCombat: people (alive), win (the odds), ammoUsed and arrowsUsed (already taken from pools),
// refund(n, key) gives back the rounds (key "ammo") or arrows ("arrows") not fired. Applies wounds, deaths, the
// carried, the left behind (killed or taken), XP; returns the result.
export function fightByNumbers(state, setup, people, { win, ammoUsed, arrowsUsed = 0, refund, tile }) {
  const rng = state.rng;
  const party = setup.partyId != null ? state.parties.find((x) => x.id === setup.partyId) : null;
  const policy = policyFor(state, setup);
  const f = setup.enemy.factionId != null ? factionById(state, setup.enemy.factionId) : null;
  const capture = f && f.alive && f.bases && f.bases.length && setup.enemy.kind !== "zombies" ? BREAKOFF.CAPTURE : 0;
  const model = fightModel(state, people, { win, enemy: setup.enemy, ambush: setup.ambush, party, capture });
  const fight = rollFight(rng, model, policy);
  const cause = `in a fight with ${setup.enemy.name || setup.enemy.kind}`;
  const byId = new Map(people.map((s) => [s.id, s]));
  const hurtIds = new Set(), deadIds = [], captured = [], carriedIds = [];
  const broke = fight.round != null;
  const downNow = new Set(fight.members.filter((m) => m.down).map((m) => m.id));
  const saved = new Set(fight.members.filter((m) => m.saved).map((m) => m.id)); // medics.js: fell, but a medic kept them alive
  // Wounds of the rounds fought. Fought to the end, a fall is death (as it always was by the numbers); broken off,
  // the downed are carried or left (below) instead.
  for (const h of fight.hits) {
    const s = byId.get(h.id);
    if (!s || !s.alive || ((broke || saved.has(h.id)) && downNow.has(h.id))) continue;
    hurt(state, s, h.raw, tile, cause);
    if (s.alive) absorbOffscreen(s, h.raw, setup.enemy.kind, state);
    (s.alive ? hurtIds.add(s.id) : deadIds.push(s.id));
  }
  for (const id of saved) { // medics.js: barely alive, as the carried
    const s = byId.get(id);
    if (!s || !s.alive) continue;
    s.health = Math.min(s.health, rng.int(5, 15));
    woundTrauma(state, s, 30);
    hurtIds.add(s.id);
  }
  if (broke) {
    for (const b of [...fight.worn, ...fight.run.blows]) {
      const s = byId.get(b.id);
      if (!s || !s.alive || downNow.has(b.id)) continue;
      hurt(state, s, b.raw, tile, fight.worn.includes(b) ? cause : `${cause}, running for it`);
      if (s.alive) absorbOffscreen(s, b.raw, setup.enemy.kind, state);
      (s.alive ? hurtIds.add(s.id) : deadIds.push(s.id));
    }
    const barely = (s) => { s.health = Math.min(s.health, rng.int(5, 15)); woundTrauma(state, s, 30); hurtIds.add(s.id); };
    for (const c of fight.run.carried) {
      const s = byId.get(c.id);
      if (!s || !s.alive) continue;
      if (c.lives) { barely(s); carriedIds.push(s.id); }
      else { hurt(state, s, 9999, tile, `${cause}; carried out, but did not pull through`, { raw: true }); deadIds.push(s.id); }
    }
    for (const l of fight.run.left) {
      const s = byId.get(l.id);
      if (!s || !s.alive) continue;
      if (l.captured && f) { barely(s); hurtIds.delete(s.id); takeCaptive(state, s, f, party); captured.push(s.id); }
      else { hurt(state, s, 9999, tile, `${cause}; left behind`, { raw: true }); deadIds.push(s.id); }
    }
    // Rounds not fought: the ammo (and the arrows) for them was not fired.
    const back = Math.floor((ammoUsed * (BREAKOFF.ROUNDS - 1 - fight.round)) / BREAKOFF.ROUNDS);
    if (back > 0 && refund) { refund(back); ammoUsed -= back; }
    const kept = Math.floor((arrowsUsed * (BREAKOFF.ROUNDS - 1 - fight.round)) / BREAKOFF.ROUNDS);
    if (kept > 0 && refund) { refund(kept, "arrows"); arrowsUsed -= kept; }
  }
  const count = setup.enemy.count;
  const killed = Math.min(count, Math.floor(count * fight.killShare));
  fightXp(state, people, fight.outcome === "victory"); // skills.js: Shooting XP for everyone who fought
  const result = {
    outcome: fight.outcome,
    enemiesKilled: killed, enemiesLeft: count - killed,
    survivorsHurt: [...hurtIds].filter((id) => !deadIds.includes(id)), survivorsDead: deadIds, ammoUsed, arrowsUsed,
    loot: { supplies: {}, gear: [] },
    policy, rounds: broke ? fight.round + 1 : null,
  };
  if (broke) {
    const run = fight.run;
    const nm = (id) => { const s = survivorById(state, id); return s ? first(s) : "someone"; };
    result.carriedIds = carriedIds;
    result.captured = captured;
    result.retreatOrder = {
      by: "policy", policy, round: fight.round + 1, wouldWin: fight.win, escaped: run.escaped.slice(), caught: run.caught.slice(),
      carried: run.carried.filter((c) => c.lives).map((c) => c.id), dropped: run.left.map((l) => l.id), lines: run.lines.slice(),
      odds: run.odds,
    };
    const bits = [`broke off the fight after round ${fight.round + 1} (${RETREAT_POLICIES[policy].short})`];
    if (run.escaped.length) bits.push(`${run.escaped.length} got out`);
    if (carriedIds.length) bits.push(`carried out: ${carriedIds.map(nm).join(", ")}`);
    if (captured.length) bits.push(`taken: ${captured.map(nm).join(", ")}`);
    const lost = deadIds.filter((id) => run.left.some((l) => l.id === id) || run.carried.some((c) => c.id === id));
    if (lost.length) bits.push(`lost: ${lost.map(nm).join(", ")}`);
    result.summary = `The team ${bits.join("; ")}.`;
    log(state, `${party ? `${party.name || "The team"}: ` : ""}${result.summary}`, "danger");
  }
  return result;
}

// ---------- the card's forecast ----------
// The fight as the card would resolve it, run FORECAST_RUNS times on its own dice (state.rng is not touched).
// Returns { policy, win, retreat, lost, getAway (share of the team home alive after a retreat), deaths, deathsNever }.
const FORECAST_RUNS = 300;
export function fightForecast(state, p, people, { odds, enemy, ambush = null }, policy) {
  const members = people.filter((s) => s.alive);
  if (!members.length) return null;
  const pol = validPolicy(policy) || "never";
  const model = fightModel(state, members, { win: odds, enemy, ambush, party: p, capture: 0 });
  const seed = (members.reduce((a, s) => (a * 31 + localId(state, s.id)) >>> 0, 7) /* localId: ids are process-wide */ ^ Math.round(odds * 1000) ^ (enemy.count * 7919)) >>> 0;
  const tally = (pl) => {
    const rng = new Rng(seed);
    const t = { win: 0, retreat: 0, lost: 0, home: 0, deaths: 0 };
    for (let i = 0; i < FORECAST_RUNS; i++) {
      const r = rollFight(rng, model, pl);
      const n = r.members.length;
      let dead = 0;
      if (r.round == null) dead = r.members.filter((m) => m.down && !m.saved).length; // medics.js: saved by a medic
      else {
        dead = r.run.left.length + r.run.carried.filter((c) => !c.lives).length;
        t.home += (n - dead) / n;
      }
      t.deaths += dead;
      if (r.outcome === "victory") t.win++;
      else if (r.outcome === "retreat") t.retreat++;
      else t.lost++;
    }
    return t;
  };
  const t = tally(pol);
  const t0 = pol === "never" ? t : tally("never");
  const N = FORECAST_RUNS;
  return {
    policy: pol, win: t.win / N, retreat: t.retreat / N, lost: t.lost / N,
    getAway: t.retreat ? t.home / t.retreat : null, deaths: t.deaths / N, deathsNever: t0.deaths / N, winNever: t0.win / N,
  };
}
const pc = (x) => `${Math.round(x * 100)}%`;
export function getAwayText(share) {
  if (share == null) return "";
  return share >= 0.9 ? "nearly all get away" : share >= 0.65 ? "most get away" : share >= 0.4 ? "about half get away" : "few get away";
}
// "If losing: about 64% to win; if it turns, most get away (30% of the time); about 0.3 deaths a fight (0.5 fought out)."
export function forecastText(fc) {
  if (!fc) return "";
  const P = RETREAT_POLICIES[fc.policy];
  if (fc.policy === "never" || fc.retreat < 0.005) {
    return `${P.name}: about ${pc(fc.win)} to win, fought to the end${fc.policy === "never" ? "" : " (it should not come to a retreat)"}; about ${fc.deaths.toFixed(1)} deaths a fight.`;
  }
  return `${P.name}: about ${pc(fc.win)} to win; if it turns, ${getAwayText(fc.getAway)} (pulls out ${pc(fc.retreat)} of the time). About ${fc.deaths.toFixed(1)} deaths a fight (${fc.deathsNever.toFixed(1)} fought to the end).`;
}

// ---------- breaking off a fight of your own (for other resolvers: abandoning a base by the numbers) ----------
// people: the survivors in the fight; opts: {
//   downed: ids of those already down (carried if someone can),  enemy: { kind, count (left) },
//   tiles?: [min, max] distance to safety,  ambush?,  vehicle?, stealthy?, night? (default: the hour),
//   tile, cause,  capture?: the chance a downed one left behind is taken (with factionId), factionId?,
//   party?: the team they belong to (takeCaptive) }
// Rolls each runner's escape (escapeChanceByNumbers) with state.rng, applies the blows (hurt), the carried (pull
// through, 50% + 2% a point of the best medic's Medicine) and the left behind (taken or killed). Returns
// { escaped, caught, carried, dropped, dead, captured, lines } (survivor ids).
export function breakOff(state, people, opts = {}) {
  const rng = state.rng;
  const ms = people.filter((s) => s.alive).map(memberOf);
  const downed = new Set(opts.downed || []);
  for (const m of ms) if (downed.has(m.id)) m.down = true;
  const f = opts.factionId != null ? factionById(state, opts.factionId) : null;
  const model = {
    enemy: { kind: (opts.enemy && opts.enemy.kind) || "raiders", count: (opts.enemy && opts.enemy.count) || 0 },
    ambush: opts.ambush || null, night: opts.night ?? isNight(state), vehicle: opts.vehicle || false, stealthy: !!opts.stealthy,
    capture: f && f.alive ? opts.capture ?? BREAKOFF.CAPTURE : 0, tiles: opts.tiles || null,
  };
  const run = runFor(rng, model, ms, model.enemy.count);
  const byId = new Map(people.map((s) => [s.id, s]));
  const dead = [], captured = [];
  const cause = opts.cause || "running for it";
  for (const b of run.blows) {
    const s = byId.get(b.id);
    if (s && s.alive && !ms.find((m) => m.id === b.id).down) { hurt(state, s, b.raw, opts.tile, cause); if (s.alive) absorbOffscreen(s, b.raw, model.enemy.kind, state); }
    if (s && !s.alive) dead.push(s.id);
  }
  const barely = (s) => { s.health = Math.min(s.health, rng.int(5, 15)); woundTrauma(state, s, 30); };
  for (const c of run.carried) {
    const s = byId.get(c.id);
    if (!s || !s.alive) continue;
    if (c.lives) barely(s); else { hurt(state, s, 9999, opts.tile, `${cause}; carried out, but did not pull through`, { raw: true }); dead.push(s.id); }
  }
  for (const l of run.left) {
    const s = byId.get(l.id);
    if (!s || !s.alive) continue;
    if (l.captured && f) { barely(s); takeCaptive(state, s, f, opts.party || null); captured.push(s.id); }
    else { hurt(state, s, 9999, opts.tile, `${cause}; left behind`, { raw: true }); dead.push(s.id); }
  }
  return {
    escaped: run.escaped.filter((id) => !dead.includes(id)), caught: run.caught, carried: run.carried.filter((c) => c.lives).map((c) => c.id),
    dropped: run.left.map((l) => l.id), dead, captured, lines: run.lines, odds: run.odds,
  };
}
