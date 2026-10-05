// Prisoners: enemies knocked out in a won fight (stealth.js takedowns and Subdue) taken home.
//   On the road they walk with the team: on foot each slows it 10% (at least 60% of its pace; in a vehicle they
//   ride), they eat 1 food and 1 water a day from the team, and each tries to slip away (5% a day, 2% in a
//   vehicle). When the team gets home they go to that base's cells.
//   At a base: Holding cells (buildings.js "cells") hold 3 each; more prisoners than that sit in a shed. A day costs
//   1 food and 1 water each from that base's stores (the food times the cold and the water times the day's thirst,
//   weather.js: 1.3 in summer, 1.6 on a hot day, 0.9 in winter, as for anyone; upkeep.js counts them in the base's
//   food and water lines). Escapes a day: in a cell with someone on the Guard role 0.4%, unguarded 3%, in the shed
//   8%, unfed +4%; six unfed days in a row and they die.
//   What you can do with them (at a base):
//     question (every 3 days): Speech decides (45% + 3% a point of the best talker, zealots −25%, soldiers −15%,
//       hungry +10%, one who likes you +15%; 10–95%). The first answer gives their group's bases (and puts the
//       group on your map), its people and stock, every party it has out and the hives near it, as knowledge
//       snapshots; later answers the parties and hives again. Each questioning sours them (−6).
//     hold for ransom: their group (alive) is asked for goods worth 15 + 4 × their power; it answers in 2–4 days:
//       pays (40% + goodwill / 200, −15% for aggressive groups, 10–90%; only what it can spare), goodwill −4 and the
//       prisoner walks home; or refuses: goodwill −3 and a rescue raid is twice as likely for 10 days.
//     trade back: free, goodwill +10 with their group. Release: goodwill +4 (they go home).
//     recruit (slow): a prisoner treated well grows to like you, 1 a day × (1 + 4% a point of the best talker's
//       Speech + 3% a point of the leader's Leadership) × mood (the base's average mood / 55, 0.6–1.3) × their kind
//       (zealots 0.35, soldiers 0.6, a loner 1.2); hungry −2 a day. At 100 they ask to join (recruits.js card):
//       2–4 months. Held, opinion drifts up 0.2 a day (to 25).
//     execute: everyone at the base −6 mood (Brave or Tough −2), goodwill −20 with their group and −4 with every
//       other group you know.
//   Their group may come for them: a rescue raid each day with 1.2% per prisoner it has in a base (×1.5 for an
//   aggressive group, ×2 after a refused ransom, ×0.3 while friendly; it needs 6+ people and a base within 25
//   tiles). It arrives 10 hours after the warning: defend in person (the deploy battle), man the walls (by the
//   numbers: the base's defence ×1.3 against their strength), or hand them over (goodwill +3). Lost, they free
//   every prisoner of theirs there and carry off a tenth of the stores.
// Your own people taken captive by other groups are conflicts.js captives, not these.
import { SUPPLIES } from "./data.js";
import {
  log, addCard, day, baseById, atBase, factionById, makeSurvivor, skill, snapshot, mergeKnowledge, hurt, newId,
} from "./world.js";
import { partyMembers, carried, takeSupply, tileLabel } from "./parties.js";
import { count } from "./buildings.js";
import { changeGoodwill, attitude, strength, isAggressiveType, baseDefense } from "./factions.js";
import { raidTier } from "./defences.js";
import { available } from "./trade.js";
import { offerRecruits } from "./recruits.js";
import { addMood } from "./relations.js";
import { startCombat, registerCombatHandler } from "./combat.js";
import { raidForce } from "./conflicts.js";
import { thirstAt } from "./weather.js";
import { coldFactor } from "./upkeep.js";
import { eatFromStore } from "./storage.js";

export const PRISON = {
  CELL_CAP: 3, FOOD: 1, WATER: 1,
  ESCAPE: { guarded: 0.004, unguarded: 0.03, shed: 0.08, unfed: 0.04, road: 0.05, vehicle: 0.02 },
  ROAD_SLOW: 0.1, ROAD_MIN: 0.6, STARVE_DAYS: 6,
  QUESTION: { every: 3, base: 0.45, speech: 0.03, zealot: -0.25, soldiers: -0.15, hungry: 0.1, liked: 0.15, sour: -6 },
  RANSOM: { value: 15, perPower: 4, days: [2, 4], pay: 0.4, goodwillPaid: -4, goodwillRefused: -3, angryDays: 10 },
  TRADE_BACK: 10, RELEASE: 4, HAND_OVER: 3,
  RECRUIT: { base: 1, speech: 0.04, lead: 0.03, hungry: -2, holdDrift: 0.2, holdCap: 25, kind: { zealots: 0.35, soldiers: 0.6, none: 1.2 } },
  EXECUTE: { mood: -6, hardened: -2, goodwill: -20, others: -4 },
  RESCUE: { chance: 0.012, aggressive: 1.5, angry: 2, friendly: 0.3, minPop: 6, range: 25, hours: 10, manned: 1.3, steal: 0.1 },
};
const KIND_OF = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "soldiers", traders: "guards", commune: "militia" };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const first = (name) => String(name).split(" ")[0];
const listNames = (list) => list.map((p) => p.name).join(", ");

export const prisonersOf = (state) => state.prisoners || (state.prisoners = []);
export const prisonersAt = (state, baseId) => (state.prisoners || []).filter((p) => p.at.kind === "base" && p.at.baseId === baseId);
export const prisonersWith = (state, partyId) => (state.prisoners || []).filter((p) => p.at.kind === "party" && p.at.partyId === partyId);
export const cellCap = (base) => (base ? count(base, "cells") * PRISON.CELL_CAP : 0);
export const freeCells = (state, base) => (base ? Math.max(0, cellCap(base) - prisonersAt(state, base.id).length) : 0);
export const guarded = (state, base) => atBase(state, base.id).some((s) => s.role === "guard" && !s.inBed);
// Who is in a cell (the first ones caught) and who sits in the shed.
export function inCell(state, p) {
  if (p.at.kind !== "base") return false;
  const base = baseById(state, p.at.baseId);
  return prisonersAt(state, p.at.baseId).indexOf(p) < cellCap(base);
}

// ---------- taking prisoners ----------
// Records for the knocked out of a finished battle (combat.js endBattle / endRaid): a person each, with a name,
// skills and traits (a candidate if they are ever recruited).
export function captiveRecords(state, b, captives) {
  if (!captives || !captives.length) return [];
  const e = b.setup.enemy || {};
  return captives.map((u) => {
    const fid = u.factionId ?? e.factionId ?? null;
    const f = fid != null ? factionById(state, fid) : null;
    return makeRecord(state, { factionId: fid, group: f ? f.name : e.name || "strangers", kit: u.kit || "raiders", power: e.power || 3, unitName: u.name, tile: b.tileId });
  });
}
function makeRecord(state, o) {
  const s = makeSurvivor(state, 0.8);
  s.pending = true;
  s.health = state.rng.int(35, 75);
  s.mood = 30;
  return { id: newId(), name: s.name, s, factionId: o.factionId, group: o.group, kit: o.kit, power: o.power, unitName: o.unitName || "", tile: o.tile, at: null, caught: null, mode: "hold", opinion: 0, questioned: null, intelDone: false, ransom: null, unfed: 0, report: "" };
}

// Defenders who surrendered when you took their base (conquest.js): n prisoners of group f, held at that base.
// Their group's head count is the caller's (the base's people are counted out there).
export function takePrisonersAt(state, f, base, n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = makeRecord(state, { factionId: f.id, group: f.name, kit: KIND_OF[f.type], power: 3, tile: base.tile });
    p.at = { kind: "base", baseId: base.id };
    p.caught = day(state);
    prisonersOf(state).push(p);
    out.push(p);
  }
  if (out.length) state.stats.prisonersTaken = (state.stats.prisonersTaken || 0) + out.length;
  return out;
}

// The base a battle's prisoners would end up in.
function destination(state, setup) {
  if (setup.baseId != null) return baseById(state, setup.baseId);
  const p = setup.partyId != null ? state.parties.find((x) => x.id === setup.partyId) : null;
  return p ? baseById(state, p.homeBaseId) || state.bases.find((x) => x.type === "hub") : null;
}

// After every battle (combat.js finishCombat, before its handler): the knocked out go with the team, or straight
// into the cells when the fight was at a base. A battle by the numbers takes none, except the Aggressive autopilot
// that wants intel on a group (half the time, one, if a cell is free at home).
export function capturePrisoners(state, setup, result, battle) {
  let list = (result && result.prisoners) || [];
  if (!list.length && result && !result.tactical) list = numbersCapture(state, setup, result);
  if (!list.length) return [];
  // Left behind (never held, so their group's head count was never touched): goodwill for the mercy.
  const leave = (ps) => { for (const p of ps) { const f = factionById(state, p.factionId); if (f && f.alive) changeGoodwill(state, f, 2, "you let their people go after the fight"); } };
  if (battle && battle.leavePrisoners) {
    leave(list);
    log(state, `You left ${listNames(list)} tied up behind. Someone will find them.`, "info");
    return [];
  }
  const party = setup.partyId != null ? state.parties.find((x) => x.id === setup.partyId) : null;
  const base = setup.baseId != null ? baseById(state, setup.baseId) : null;
  let at = null;
  if (party && partyMembers(state, party).length) at = { kind: "party", partyId: party.id };
  else if (base && state.bases.includes(base)) at = { kind: "base", baseId: base.id };
  if (!at) return [];
  // The autopilot holds prisoners only where it has a free cell (its home base for a team).
  if (state.autopilot) {
    const room = freeCells(state, destination(state, setup));
    leave(list.slice(room));
    list = list.slice(0, room);
    if (!list.length) return [];
  }
  const all = prisonersOf(state);
  for (const p of list) {
    p.at = at;
    p.caught = day(state);
    all.push(p);
    const f = factionById(state, p.factionId);
    if (f) f.pop = Math.max(0, f.pop - 1);
  }
  state.stats.prisonersTaken = (state.stats.prisonersTaken || 0) + list.length;
  if (party) teamPace(state, party);
  const where = at.kind === "party" ? "They walk with the team, tied." : `They are locked up at ${base.name}.`;
  log(state, `Taken prisoner: ${listNames(list)} (${list[0].group}). ${where}`, "good");
  return list;
}

function numbersCapture(state, setup, result) {
  if (!state.autopilot || result.outcome !== "victory" || !setup.enemy || setup.enemy.kind === "zombies") return [];
  if (!state.governor || state.governor.personality !== "aggressive") return [];
  if (!wantsIntel(state, setup.enemy.factionId) || !freeCells(state, destination(state, setup))) return [];
  if (!state.rng.chance(0.5)) return [];
  const f = factionById(state, setup.enemy.factionId);
  return [makeRecord(state, { factionId: f.id, group: f.name, kind: KIND_OF[f.type], kit: KIND_OF[f.type], power: setup.enemy.power || 3, tile: setup.tile })];
}
// A group worth asking about: alive, and some of its bases not yet on your map.
export function wantsIntel(state, fid) {
  const f = fid != null ? factionById(state, fid) : null;
  if (!f || !f.alive) return false;
  return !f.known || f.bases.some((t) => !(state.knowledge[t] && state.knowledge[t].factionBase === f.id));
}

// Walking prisoners slow a team on foot (parties.js partySpeed reads p.prisonSpeed).
export function teamPace(state, party) {
  const n = prisonersWith(state, party.id).length;
  party.prisonSpeed = !n || party.vehicle === true ? 1 : Math.max(PRISON.ROAD_MIN, 1 - PRISON.ROAD_SLOW * n);
  if (party.prisonSpeed === 1) delete party.prisonSpeed;
}

// A team home (parties.js returnHome): its prisoners go to that base's cells.
export function prisonersHome(state, party, home) {
  const list = prisonersWith(state, party.id);
  if (!list.length || !home) return;
  for (const p of list) p.at = { kind: "base", baseId: home.id };
  delete party.prisonSpeed;
  const shed = prisonersAt(state, home.id).length - cellCap(home);
  log(state, `${listNames(list)} ${list.length === 1 ? "is" : "are"} locked up at ${home.name}${shed > 0 ? `; ${shed} sit${shed === 1 ? "s" : ""} in a shed (no free cell: build Holding cells)` : ""}.`, "info");
}

// A prisoner leaves your hands: back to their group (pop +1), with goodwill if given.
function goHome(state, p, goodwill = 0, why = "") {
  const i = (state.prisoners || []).indexOf(p);
  if (i >= 0) state.prisoners.splice(i, 1);
  const f = factionById(state, p.factionId);
  if (f && f.alive) {
    f.pop += 1;
    if (goodwill) changeGoodwill(state, f, goodwill, why);
  }
  refreshTeam(state, p);
}
function drop(state, p) {
  const i = (state.prisoners || []).indexOf(p);
  if (i >= 0) state.prisoners.splice(i, 1);
  refreshTeam(state, p);
}
function refreshTeam(state, p) {
  if (p.at && p.at.kind === "party") { const party = state.parties.find((x) => x.id === p.at.partyId); if (party) teamPace(state, party); }
}

// ---------- at a base: what you can do ----------
const byId = (state, id) => (state.prisoners || []).find((p) => p.id === Number(id));
const heldAt = (state, p) => (p && p.at.kind === "base" ? baseById(state, p.at.baseId) : null);
export const bestSpeaker = (state, base) => atBase(state, base.id).reduce((m, s) => (!m || skill(s, "speech") > skill(m, "speech") ? s : m), null);

export function questionOdds(state, p) {
  const base = heldAt(state, p);
  const sp = base ? bestSpeaker(state, base) : null;
  const Q = PRISON.QUESTION;
  return clamp(Q.base + (sp ? skill(sp, "speech") : 0) * Q.speech + (p.kit === "zealots" ? Q.zealot : 0) + (p.kit === "soldiers" ? Q.soldiers : 0) + (p.unfed ? Q.hungry : 0) + (p.opinion > 40 ? Q.liked : 0), 0.1, 0.95);
}
export const canQuestion = (state, p) => !!heldAt(state, p) && (p.questioned == null || day(state) - p.questioned >= PRISON.QUESTION.every);

export function questionPrisoner(state, id) {
  const p = byId(state, id);
  const base = heldAt(state, p);
  if (!p || !base) return "They are not held at a base.";
  if (!canQuestion(state, p)) return `${first(p.name)} was questioned on day ${p.questioned}. Try again in a few days.`;
  const chance = questionOdds(state, p);
  p.questioned = day(state);
  p.opinion += PRISON.QUESTION.sour;
  if (!state.rng.chance(chance)) return `${p.name} says nothing useful (${Math.round(chance * 100)}%).`;
  const intel = gatherIntel(state, p, !p.intelDone);
  p.intelDone = true;
  p.report = intel.text;
  log(state, `${p.name} talked: ${intel.text}`, "good");
  return `${p.name} talks. ${intel.text}`;
}

// What a prisoner knows, put on your map as knowledge snapshots. full: their group's bases and stock too.
export function gatherIntel(state, p, full = true) {
  const g = state.grid;
  const f = factionById(state, p.factionId);
  const tiles = new Set();
  const lines = [];
  const near = f && f.alive && f.bases.length ? f.bases[0] : p.tile;
  if (f && f.alive) {
    if (full) {
      for (const t of f.bases) tiles.add(t);
      f.known = true;
      f.intel = { day: day(state), pop: f.pop, food: Math.round(f.stock.food || 0), ammo: Math.round(f.stock.ammo || 0), scrap: Math.round(f.stock.scrap || 0), fuel: Math.round(f.stock.fuel || 0), meds: Math.round(f.stock.meds || 0) };
      lines.push(`${f.name} hold ${f.bases.map((t) => tileLabel(state, t)).join(", ")}: about ${f.pop} people, ${f.intel.food} food, ${f.intel.ammo} ammo, ${f.intel.meds} meds, ${f.intel.fuel} fuel.`);
    }
    const out = state.parties.filter((q) => q.owner === f.id && q.path);
    for (const q of out) tiles.add(q.path[Math.min(q.idx || 0, q.path.length - 1)]);
    lines.push(out.length ? `They have ${out.length} part${out.length === 1 ? "y" : "ies"} out (${out.map((q) => `${q.kind === "raid" ? "a raid" : q.kind === "caravan" ? "a caravan" : q.kind === "scav" ? "a scavenging party" : `a ${q.kind}`} near ${tileLabel(state, q.path[Math.min(q.idx || 0, q.path.length - 1)])}`).join("; ")}).` : "No patrols out right now.");
  } else if (full) lines.push(`${p.group} were on their own: no base to tell of.`);
  let hives = 0, hordes = 0;
  if (near != null) {
    for (const t of state.tiles) if (t.hive && g.distance(t.id, near) <= 10) { tiles.add(t.id); hives++; }
    for (const h of state.hordes) if (g.distance(h.tile, near) <= 8) { tiles.add(h.tile); hordes++; }
    lines.push(hives || hordes ? `They have seen ${hives ? `${hives} hive${hives === 1 ? "" : "s"}` : ""}${hives && hordes ? " and " : ""}${hordes ? `${hordes} horde${hordes === 1 ? "" : "s"}` : ""} near ${tileLabel(state, near)}.` : `No hives near ${tileLabel(state, near)}, they say.`);
  }
  mergeKnowledge(state, new Map([...tiles].map((t) => [t, snapshot(state, t)])));
  return { text: lines.join(" "), tiles: tiles.size };
}

// Ransom: what their group would pay (the good it can best spare).
export function ransomTerms(state, p) {
  const f = factionById(state, p.factionId);
  if (!f || !f.alive) return null;
  const value = PRISON.RANSOM.value + PRISON.RANSOM.perPower * (p.power || 3);
  let best = null;
  for (const key of ["ammo", "food", "meds", "scrap", "fuel", "parts"]) {
    const qty = Math.ceil(value / SUPPLIES[key].value);
    const spare = available(f, key);
    const score = Math.min(1, spare / qty);
    if (!best || score > best.score) best = { key, qty, score };
  }
  return best ? { key: best.key, qty: best.qty, value } : null;
}
export function askRansom(state, id) {
  const p = byId(state, id);
  const base = heldAt(state, p);
  if (!p || !base) return "They are not held at a base.";
  if (p.ransom) return `Already waiting for ${p.group}'s answer.`;
  const terms = ransomTerms(state, p);
  if (!terms) return `${p.group} are gone: nobody to pay for ${first(p.name)}.`;
  const [lo, hi] = PRISON.RANSOM.days;
  p.ransom = { asked: day(state), due: day(state) + state.rng.int(lo, hi), key: terms.key, qty: terms.qty };
  return `Word goes to ${p.group}: ${terms.qty} ${terms.key} for ${p.name}. An answer in a few days.`;
}
function ransomAnswer(state, p) {
  const f = factionById(state, p.factionId);
  const base = heldAt(state, p);
  const r = p.ransom;
  p.ransom = null;
  if (!f || !f.alive || !base) return;
  const R = PRISON.RANSOM;
  const chance = clamp(R.pay + f.goodwill / 200 - (isAggressiveType(f) ? 0.15 : 0), 0.1, 0.9);
  const can = Math.floor(Math.min(r.qty, available(f, r.key)));
  if (can >= Math.ceil(r.qty * 0.5) && state.rng.chance(chance)) {
    f.stock[r.key] = Math.max(0, (f.stock[r.key] || 0) - can);
    base.stock[r.key] = (base.stock[r.key] || 0) + can;
    goHome(state, p, R.goodwillPaid, "you ransomed their people");
    const text = `${f.name} paid ${can} ${r.key} for ${p.name}, who walks home.`;
    log(state, text, "good");
    addCard(state, { title: "Ransom paid", text, choices: [{ label: "OK", resolve: () => "" }] });
  } else {
    changeGoodwill(state, f, R.goodwillRefused, "you held their people for ransom");
    f.angryUntil = day(state) + R.angryDays;
    const text = `${f.name} will not pay for ${p.name}. They may come for their people instead.`;
    log(state, text, "danger");
    addCard(state, { title: "Ransom refused", text, choices: [{ label: "OK", resolve: () => "" }] });
  }
}

export function tradeBack(state, id) {
  const p = byId(state, id);
  if (!p || !heldAt(state, p)) return "They are not held at a base.";
  const f = factionById(state, p.factionId);
  if (!f || !f.alive) return releasePrisoner(state, id);
  goHome(state, p, PRISON.TRADE_BACK, "you returned their people");
  return `${p.name} goes back to ${f.name}, unharmed. They will remember it (goodwill +${PRISON.TRADE_BACK}).`;
}
export function releasePrisoner(state, id) {
  const p = byId(state, id);
  if (!p) return "Nobody to release.";
  const f = factionById(state, p.factionId);
  goHome(state, p, f && f.alive ? PRISON.RELEASE : 0, "you let their people go");
  return `${p.name} is let go${f && f.alive ? ` and heads back to ${f.name}` : ""}.`;
}
export function setMode(state, id, mode) {
  const p = byId(state, id);
  if (!p || !["hold", "recruit"].includes(mode)) return "";
  p.mode = mode;
  return mode === "recruit" ? `${first(p.name)} gets decent food, talk and a little trust. It will take months.` : `${first(p.name)} is just held.`;
}
export function executePrisoner(state, id) {
  const p = byId(state, id);
  const base = heldAt(state, p);
  if (!p || !base) return "They are not held at a base.";
  drop(state, p);
  const E = PRISON.EXECUTE;
  for (const s of atBase(state, base.id)) addMood(state, s, s.traits.includes("brave") || s.traits.includes("tough") ? E.hardened : E.mood, `${first(p.name)} was executed`);
  const f = factionById(state, p.factionId);
  if (f && f.alive) changeGoodwill(state, f, E.goodwill, "you executed one of their people");
  for (const o of state.factions) if (o !== f && o.alive && o.known) changeGoodwill(state, o, E.others, "word of an execution");
  state.stats.executions = (state.stats.executions || 0) + 1;
  log(state, `${p.name} of ${p.group} was executed at ${base.name}.`, "death");
  return `${p.name} is dead. Nobody at ${base.name} looks at each other for a while.`;
}

// Recruit progress a day (a prisoner on "recruit", fed).
export function recruitRate(state, p) {
  const base = heldAt(state, p);
  if (!base) return 0;
  const R = PRISON.RECRUIT;
  const people = atBase(state, base.id);
  const sp = bestSpeaker(state, base);
  const lead = people.find((s) => s.leader);
  const mood = people.length ? people.reduce((a, s) => a + s.mood, 0) / people.length : 50;
  const kind = p.factionId == null ? R.kind.none : R.kind[p.kit] || 1;
  return R.base * kind * (1 + (sp ? skill(sp, "speech") : 0) * R.speech + (lead ? skill(lead, "leadership") : 0) * R.lead) * clamp(mood / 55, 0.6, 1.3);
}

// ---------- every day ----------
export function prisonersDaily(state) {
  if (!(state.prisoners && state.prisoners.length)) return;
  const rng = state.rng;
  const today = day(state);
  const drink = Math.round(PRISON.WATER * thirstAt(state) * 100) / 100; // the day's thirst, as for anyone (weather.js)
  for (const p of [...state.prisoners]) {
    if (!state.prisoners.includes(p)) continue;
    let fed = false, escape = 0;
    if (p.at.kind === "party") {
      const party = state.parties.find((x) => x.id === p.at.partyId);
      if (!party) continue; // the hourly check frees them
      if (carried(party, "food") >= PRISON.FOOD && carried(party, "water") >= drink) { takeSupply(party, "food", PRISON.FOOD); takeSupply(party, "water", drink); fed = true; }
      escape = party.vehicle ? PRISON.ESCAPE.vehicle : PRISON.ESCAPE.road;
      teamPace(state, party);
    } else {
      const base = baseById(state, p.at.baseId);
      if (!base) continue;
      const food = (base.stock.food || 0) + (base.stock.preserved || 0);
      const eat = PRISON.FOOD * coldFactor(state); // more in the cold, as for anyone at a base (upkeep.js)
      if (food >= eat && (base.stock.water || 0) >= drink) {
        eatFromStore(base, eat); // fresh first, then preserved (its jars come back: storage.js)
        base.stock.water -= drink;
        fed = true;
      }
      escape = inCell(state, p) ? (guarded(state, base) ? PRISON.ESCAPE.guarded : PRISON.ESCAPE.unguarded) : PRISON.ESCAPE.shed;
      const R = PRISON.RECRUIT;
      if (fed && p.mode === "recruit") p.opinion += recruitRate(state, p);
      else if (fed && p.opinion < R.holdCap) p.opinion = Math.min(R.holdCap, p.opinion + R.holdDrift);
      if (p.ransom && today >= p.ransom.due) { ransomAnswer(state, p); if (!state.prisoners.includes(p)) continue; }
    }
    p.unfed = fed ? 0 : p.unfed + 1;
    if (!fed) { p.opinion += PRISON.RECRUIT.hungry; escape += PRISON.ESCAPE.unfed; }
    if (p.unfed >= PRISON.STARVE_DAYS) {
      drop(state, p);
      log(state, `${p.name}, a prisoner, starved to death.`, "death");
      continue;
    }
    if (rng.chance(escape)) {
      goHome(state, p);
      log(state, `${p.name} (${p.group}) slipped their bonds and escaped${p.at.kind === "base" ? ` from ${baseById(state, p.at.baseId).name}` : " from the team"}.`, "danger");
      continue;
    }
    if (p.at.kind === "base" && p.opinion >= 100) {
      const base = baseById(state, p.at.baseId);
      drop(state, p);
      const f = factionById(state, p.factionId);
      if (f && f.alive) changeGoodwill(state, f, -2, "one of their people changed sides");
      p.s.health = Math.max(p.s.health, 60);
      p.s.mood = 50;
      offerRecruits(state, [p.s], {
        source: "prisoner", baseId: base.id, title: `${first(p.name)} asks to join`,
        intro: `After ${today - p.caught} days at ${base.name}, ${p.name}, once of ${p.group}, asks to be one of you.`,
      });
      state.stats.prisonersRecruited = (state.stats.prisonersRecruited || 0) + 1;
    }
  }
  rescueRolls(state);
}

// ---------- rescue raids ----------
export function rescueChance(state, f, base) {
  const R = PRISON.RESCUE;
  if (!f || !f.alive || f.pop < R.minPop || !f.bases.length || !base) return 0;
  if (Math.min(...f.bases.map((t) => state.grid.distance(t, base.tile))) > R.range) return 0;
  const n = prisonersAt(state, base.id).filter((p) => p.factionId === f.id).length;
  if (!n) return 0;
  const att = attitude(f);
  return R.chance * n * (isAggressiveType(f) ? R.aggressive : 1) * (f.angryUntil && day(state) <= f.angryUntil ? R.angry : 1) * (att === "Friendly" || att === "Allied" ? R.friendly : 1);
}
function rescueRolls(state) {
  const rescues = state.rescues || (state.rescues = []);
  const pairs = new Map();
  for (const p of state.prisoners) if (p.at.kind === "base" && p.factionId != null) pairs.set(`${p.at.baseId}:${p.factionId}`, [p.at.baseId, p.factionId]);
  for (const [, [baseId, fid]] of pairs) {
    if (rescues.some((r) => r.baseId === baseId && r.factionId === fid)) continue;
    const base = baseById(state, baseId), f = factionById(state, fid);
    const c = rescueChance(state, f, base);
    if (c > 0 && state.rng.chance(c)) startRescue(state, f, base);
  }
}
export function startRescue(state, f, base) {
  const rescues = state.rescues || (state.rescues = []);
  const r = { id: newId(), factionId: f.id, baseId: base.id, strength: Math.round(Math.max(4, strength(f) * state.rng.range(0.25, 0.35)) * 10) / 10, arrive: state.hour + PRISON.RESCUE.hours, manned: false };
  rescues.push(r);
  log(state, `Lookouts at ${base.name} see ${f.name} fighters coming for their people.`, "danger");
  addCard(state, rescueCard(state, r));
  return r;
}
function rescueCard(state, r) {
  const f = factionById(state, r.factionId), base = baseById(state, r.baseId);
  const held = prisonersAt(state, base.id).filter((p) => p.factionId === f.id);
  const def = () => baseDefense(state, base);
  const pending = (st) => (st.rescues || []).includes(r) && st.bases.includes(base);
  return {
    title: `${f.name} come for their people`, kind: "rescue", rescueId: r.id,
    text: `About ${raidForce(f, r.strength).count} of ${f.name} (strength ${Math.round(r.strength)}) are heading for ${base.name} to free ${listNames(held)}. They arrive in about ${PRISON.RESCUE.hours} hours. Your defence there: about ${Math.round(def())}.`,
    choices: [
      {
        label: "Defend in person", hint: "Fight them on the base map now: place your defenders, then hold the walls. Lose and they take their people back.",
        ai: () => 0.5,
        resolve: (st) => {
          if (!pending(st)) return "They are gone.";
          st.rescues.splice(st.rescues.indexOf(r), 1);
          const force = raidForce(f, r.strength);
          startCombat(st, {
            tile: base.tile, baseId: base.id, enemy: { kind: KIND_OF[f.type] || "raiders", count: force.count, power: force.power, factionId: f.id, name: `${f.name} rescuers` },
            ambush: null, canRetreat: true, handler: "prisonRescue", layout: "baseDefence", deploy: true, // pulling out: they free their people and go
            context: { baseId: base.id, factionId: f.id, rescue: true },
          });
          return "";
        },
      },
      {
        label: "Man the walls", hint: `Everyone takes a post: the defence counts ${PRISON.RESCUE.manned}× (about ${Math.round(def() * PRISON.RESCUE.manned)} against ${Math.round(r.strength)}). Settled when they arrive.`,
        ai: (st) => (def() * PRISON.RESCUE.manned >= r.strength ? 2 : 1),
        resolve: (st) => { if (!pending(st)) return "They are gone."; r.manned = true; return `${base.name} mans the walls.`; },
      },
      {
        label: "Hand them over", hint: `Let ${listNames(held)} go to ${f.name} (goodwill +${PRISON.HAND_OVER}). No fight.`,
        ai: (st) => (def() * PRISON.RESCUE.manned < r.strength * 0.8 ? 3 : 0),
        resolve: (st) => {
          if (!pending(st)) return "They are gone.";
          st.rescues.splice(st.rescues.indexOf(r), 1);
          const list = prisonersAt(st, base.id).filter((p) => p.factionId === f.id);
          for (const p of list) goHome(st, p, 0);
          changeGoodwill(st, f, PRISON.HAND_OVER, "you handed their people back");
          return `${listNames(list) || "Nobody"} walk${list.length === 1 ? "s" : ""} out to ${f.name}. They turn for home.`;
        },
      },
    ],
  };
}
// They got in: every prisoner of theirs at the base goes free, and they take a share of the stores.
function rescueWon(state, f, base) {
  const list = prisonersAt(state, base.id).filter((p) => p.factionId === f.id);
  for (const p of list) goHome(state, p, 0);
  for (const k of Object.keys(base.stock)) base.stock[k] = Math.floor((base.stock[k] || 0) * (1 - PRISON.RESCUE.steal));
  return list;
}

registerCombatHandler("prisonRescue", (state, result, setup) => {
  const c = setup.context || {};
  const f = factionById(state, c.factionId), base = baseById(state, c.baseId);
  if (!f || !base) return;
  let text;
  if (result.outcome === "victory") {
    f.pop = Math.max(0, f.pop - Math.ceil((result.enemiesKilled || 0) * 0.7));
    changeGoodwill(state, f, -5, "you beat off their rescue");
    text = `${base.name} beat off ${f.name}'s rescue. Their people stay in the cells.`;
  } else {
    const freed = rescueWon(state, f, base);
    text = `${result.outcome === "retreat" ? "Your people pulled out. " : ""}${f.name} broke into ${base.name} and freed ${listNames(freed) || "nobody"}. They carried off a tenth of the stores.`;
  }
  log(state, text, result.outcome === "victory" ? "good" : "death");
  addCard(state, { title: "The rescue", text, choices: [{ label: "OK", resolve: () => "" }] });
});

// ---------- every hour ----------
export function prisonersHour(state) {
  if (state.prisoners && state.prisoners.length) {
    for (const p of [...state.prisoners]) {
      if (p.at.kind === "party" && !state.parties.some((x) => x.id === p.at.partyId)) {
        goHome(state, p);
        log(state, `${p.name}, a prisoner, got away in the confusion.`, "danger");
      } else if (p.at.kind === "base" && !baseById(state, p.at.baseId)) {
        goHome(state, p);
      }
    }
  }
  if (!(state.rescues && state.rescues.length)) return;
  for (const r of [...state.rescues]) {
    if (state.hour < r.arrive) continue;
    state.rescues.splice(state.rescues.indexOf(r), 1);
    const f = factionById(state, r.factionId), base = baseById(state, r.baseId);
    if (!f || !f.alive || !base) continue;
    if (!prisonersAt(state, base.id).some((p) => p.factionId === f.id)) { log(state, `${f.name} turn back: their people are no longer at ${base.name}.`, "info"); continue; }
    const def = baseDefense(state, base) * (r.manned ? PRISON.RESCUE.manned : 1);
    const att = r.strength * state.rng.range(0.8, 1.2);
    const rt = raidTier(state, base, def, att, 1, 1); // defences.js: the walls, then the yard
    let text;
    if (rt.yard >= 1) {
      f.pop = Math.max(0, f.pop - state.rng.int(1, 2));
      changeGoodwill(state, f, -5, "you beat off their rescue");
      text = `${base.name} drove off ${f.name}'s rescue ${rt.wall >= 1 ? "at the walls" : "in the yard"}.`;
    } else {
      const freed = rescueWon(state, f, base);
      const people = atBase(state, base.id);
      if (people.length) hurt(state, state.rng.pick(people), state.rng.int(15, 40), base.tile, `when ${f.name} came for their people`);
      text = `${f.name} got into ${base.name} and freed ${listNames(freed)}. They carried off a tenth of the stores.`;
    }
    log(state, text, rt.yard >= 1 ? "good" : "death");
    addCard(state, { title: "The rescue", text, choices: [{ label: "OK", resolve: () => "" }] });
  }
}

// ---------- the autopilot (autopilot.js autopilotDaily) ----------
// Questions each prisoner once (again every 10 days if their group is still a mystery), then by style: Cautious
// trades them back, Balanced asks a ransom (trades back when the group is gone or friendly), Aggressive keeps them
// on "recruit" while the base eats well, else ransoms. Starving prisoners are let go. Returns a log line or "".
export function autopilotPrisoners(state) {
  const list = (state.prisoners || []).filter((p) => p.at.kind === "base");
  if (!list.length) return "";
  const style = (state.governor && state.governor.personality) || "balanced";
  const done = [];
  for (const p of list) {
    if (!state.prisoners.includes(p)) continue;
    if (canQuestion(state, p) && (!p.intelDone || (wantsIntel(state, p.factionId) && day(state) - p.questioned >= 10))) done.push(questionPrisoner(state, p.id));
    if (p.unfed >= 2) { done.push(releasePrisoner(state, p.id)); continue; }
    const f = factionById(state, p.factionId);
    const att = f && f.alive ? attitude(f) : null;
    if (style === "cautious" || (att && (att === "Friendly" || att === "Allied"))) { if (p.intelDone || !f) done.push(tradeBack(state, p.id)); continue; }
    if (style === "aggressive") {
      const base = heldAt(state, p);
      const fat = base && (base.stock.food || 0) + (base.stock.preserved || 0) >= atBase(state, base.id).length * 10;
      if (fat || !f || !f.alive) { if (p.mode !== "recruit") done.push(setMode(state, p.id, "recruit")); continue; }
    }
    if (!f || !f.alive) { if (p.mode !== "recruit") done.push(setMode(state, p.id, "recruit")); continue; }
    if (p.intelDone && !p.ransom) done.push(askRansom(state, p.id));
  }
  return done.filter(Boolean).join(" ");
}

// ---------- for the UI ----------
export function prisonerView(state, p) {
  const base = heldAt(state, p);
  const f = factionById(state, p.factionId);
  return {
    p, base, faction: f && f.alive ? f : null, days: day(state) - (p.caught || day(state)),
    cell: inCell(state, p), guarded: base ? guarded(state, base) : false,
    question: { ok: canQuestion(state, p), odds: base ? questionOdds(state, p) : 0 },
    ransom: ransomTerms(state, p), rate: p.mode === "recruit" ? recruitRate(state, p) : 0,
    rescue: base && f ? rescueChance(state, f, base) : 0,
  };
}
