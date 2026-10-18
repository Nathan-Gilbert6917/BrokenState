// The Calder Coalition: allied groups you invite into an alliance, what members do for you, the seasonal council,
// and the alliance victory.
//
// Joining
// - A group can be invited (Groups tab or the radio panel) when it is alive, known, in radio reach (reachVia: a base
//   of theirs within your radio coverage + 6, stations and linked relays at any of your bases; or one of your teams
//   at its gates, a base of yours within NEIGHBOUR 8 tiles, a member's within MEMBER_RELAY 12), not at war with a
//   member, its goodwill toward you is 50+ and it has a pact with you, and either you have done a job for it or the
//   council votes it in (with members, each member votes yes when its relations with the group are 10+; a majority
//   carries it).
// - A group that qualifies may also ask to join (3% a day): a card (Welcome them / Not now).
// - A group in an AI bloc brings the invitation to its bloc: the members vote, and the bloc may join together
//   (blocs.js blocJoinsCoalition; "Invite the whole bloc", inviteBloc, sends it through a member that qualifies).
// - A member leaves when its goodwill falls below 20, its pact with you is gone, or it goes to war with another
//   member (then the one that started it is expelled).
//
// What members do
// - Share sightings: every day each member reports every horde within 12 tiles of its bases and every hive and
//   hive build site within 15 (they go on your map), and the land within 3 tiles of its bases.
// - Help against break-ins: a raid on one of your bases faces extra defenders from each member with a base within
//   20 tiles (strength × 0.15 each, up to half your own defence); a horde heading for your base is harried once on
//   the way by members within 20 tiles (it loses 15% for each, at most 30%).
// - Hive assaults: members with a base within 15 tiles of a hive you storm (and a group whose hive job you took)
//   send fighters: 1 per 10 people (1–3 each); every fighter keeps one of the brood off your squad (at most 40%
//   of the brood, at least 6 left) (hives.js assaultHive).
// - No member raids you or another member, and members do not go to war with each other.
//
// The council meets at the start of every season (days 15, 43, 71, ...) once you have a member. It asks one thing:
// supplies for a member that is short (send: +6 with them, +3 with the others; refuse: −4 with all), a job from a
// member (a job offer from the council: accept or refuse, −3 with all), or a ruling between two members who quarrel
// over land or water (side with one: +6 with it, −8 with the other and −10 between them; or a compromise: a Speech
// check of 25% + 4% a point + goodwill / 400; it works: +3 with both and +5 between them, it fails: −3 with both).
//
// Alliance victory (its own way to win, next to destroying every hive): the coalition (you and its members) has at
// least one member and controls more than half of the state's land (LAND_NEEDED), and keeps that up for a year (the
// Calder Accord, eras.js: a year of the late game, from year 10, and the coalition must have stood 12 seasons). Groups outside the
// coalition now BLOCK it again (2026-10-13): join them, break them or take their land until they collapse.
// Land: land tiles within reach of a base: your hub and every base you took from another group STRONGHOLD_RANGE (9),
// an outpost CONTROL_RANGE (7, 8 with walls standing), a member's base CONTROL_RANGE; on other world sizes these scale
// with the square root of the area (Small 7 / 5, Large 11 / 9, Huge 14 / 11), so it takes about as many bases on any
// map; plus every tile your teams claimed (claims.js: a marker post on a tile bordering land you hold).
// A member's land counts (memberLand) only once it has been a member for LAND_AFTER days (a game year: the day it
// joined is kept in alliance.joined) and while it is not at war: with you, or with any group at all (a war on a
// member contests its land: help it end the war, or broker a peace). 2026-10-09 (the progression census): a
// coalition held half the land by year 3-5 from the moment its members joined, and won the day the victories opened.
// One definition everywhere the share is read: the victory and the Accord's clock, the Goals card, the Coalition map
// layer, and on the AI side the bandwagon goodwill and the closed state (factions.js: no new gangs, visitors.js: no
// band digs in), the blocs' fear of the coalition (blocs.js) and the rival war goal (playerwars.js). Only the
// governor's land planner (autopilot.js landOutpostSite, aimAt, the war council) reads the land with the members that
// will count by time alone (landCentres(state, true)): it does not found outposts over a new member's land.
// world.js checkGameOver ends the run with the coalition's victory (hives standing or not).
import { moveFoodUnits } from "./foods.js"; // food sent in days
import { day, log, hub, factionById, addCard, atBase, skill, snapshot, alive, RADIO_RANGE } from "./world.js";
import { attitude, changeGoodwill, strength, baseDefense } from "./factions.js";
import { tileLabel, partyTile } from "./parties.js";
import { canRadioGroup, radioSpeech, radioDeal, dealQuote, radioGreet, radioPact, radioCooldown, radioScan, hasNetwork, canListen, relaySpotFor, GROUP_REACH, RELAY_RANGE } from "./radio.js";
import { available, need, dealRoundKey } from "./trade.js";
import { hivesSecured, hiveStats } from "./hives.js";
import { count, isCamp } from "./buildings.js"; // a camp (staging.js) holds no land and wins nothing
import { worldScale } from "./worldsize.js";
import { inviteGoodwill, infamy, lostBases, assaultForce } from "./conquest.js";
import { reduceHorde } from "./hordes.js";
import { gainXp, USE } from "./skills.js";
import { diploRng, relation, changeRelation, warsOf, enemyIn, warBetween, autoWarTrade } from "./diplomacy.js";
import { jobsDoneFor, activeJobs, makeJob, offerCard as jobOfferCard, autoJobsDaily } from "./jobs.js";
import { eraProgress, ERAS, isLate } from "./eras.js";
import { playerClaims, claimedLand } from "./claims.js";
import { supplyAmt, useSupply } from "./rounds.js"; // "ammo": every round there, any calibre
import { payRoundsOf, suppliesText } from "./ammo.js"; // the council's "ammo" sent as rounds by calibre
import { volunteerGroupsAt, councilWar, councilVolCard } from "./volunteers.js"; // volunteers with your team: no double count at a hive or an assault
import { blocOf, blocById, blocMembers, blocTitle, blocJoinsCoalition, blocCarrier, blocVoteWait } from "./blocs.js"; // AI blocs vote on joining together
import { atWarWithYou } from "./playerwars.js";

export const ALLIANCE = {
  NAME: "The Calder Coalition", GOODWILL: 50, LEAVE_GOODWILL: 20, VOTE_REL: 10, ASK_CHANCE: 0.03,
  SHARE_HORDES: 12, SHARE_HIVES: 15, SHARE_LAND: 3, RAID_RANGE: 20, RAID_SHARE: 0.15, HORDE_CUT: 0.15,
  HIVE_RANGE: 15, MEMBER_RELAY: 12, NEIGHBOUR: 8, CONTROL_RANGE: 7, STRONGHOLD_RANGE: 9, WALLED_RANGE: 1, LAND_NEEDED: 0.6, COUNCIL_EVERY: 28, COUNCIL_FIRST: 15,
  LAND_AFTER: 112, // a member's land counts after a game year in the coalition (memberLand)
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

export function ensureAlliance(state) {
  if (!state.alliance) state.alliance = { name: ALLIANCE.NAME, members: [], founded: null, joined: {}, history: [], lastAsk: {}, councils: 0, stats: { joined: 0, left: 0, councils: 0, granted: 0, refused: 0 } };
  return state.alliance;
}
export const isMember = (state, f) => !!f && !!state.alliance && state.alliance.members.includes(f.id);
export const allianceMembers = (state) => (state.alliance ? state.alliance.members.map((id) => factionById(state, id)).filter((f) => f && f.alive) : []);

// ---------- joining ----------
// How an invitation reaches a group (the "in radio reach" condition), the first way that works, "" for none:
// - "radio": one of its bases lies within your radio coverage + GROUP_REACH (radio.js canRadioGroup: the stations'
//   range and RELAY_RANGE around every linked relay, at any of your bases, plus 6 for their own sets). A relay that
//   brings a group's base into that reach makes it invitable (radio.js relaySpotFor names the base for one);
// - "gates": one of your teams waits or trades at one of its bases;
// - "member": a member has a base within MEMBER_RELAY tiles of one of theirs (the member's radio carries it);
// - "neighbour": a base of yours within NEIGHBOUR tiles of one of theirs (you talk over the fence).
export function reachVia(state, f) {
  if (!f || !f.alive) return "";
  if (canRadioGroup(state, f)) return "radio";
  if (state.parties.some((p) => p.owner === "player" && f.bases.includes(partyTile(p)) && (p.phase === "waiting" || p.phase === "engaged"))) return "gates";
  if (allianceMembers(state).some((m) => m !== f && m.bases.some((b) => f.bases.some((x) => state.grid.distance(b, x) <= ALLIANCE.MEMBER_RELAY)))) return "member";
  if (state.bases.some((b) => f.bases.some((x) => state.grid.distance(b.tile, x) <= ALLIANCE.NEIGHBOUR))) return "neighbour";
  return "";
}
const reachable = (state, f) => reachVia(state, f) !== "";
// The "out of radio reach" line: every way in, and the base where a relay would do it when there is one.
function outOfReach(state, f) {
  const spot = relaySpotFor(state, f);
  const radio = spot ? `build a radio relay at ${spot.name} (it would bring them into your coverage)`
    : hasNetwork(state) ? `bring their base within ${GROUP_REACH} tiles of your radio coverage (a station reaches ${RADIO_RANGE} tiles, each linked relay ${RELAY_RANGE} more around its base)`
    : `build a radio station (${RADIO_RANGE} tiles, +${GROUP_REACH} for their own sets; relays at your other bases chain it ${RELAY_RANGE} tiles further each)`;
  return `${f.name} is out of radio reach (${radio}, send a team to their gates, hold a base within ${ALLIANCE.NEIGHBOUR} tiles of theirs, or win a member within ${ALLIANCE.MEMBER_RELAY} tiles of them).`;
}
// The council's vote on a candidate: { yes, no, passes } (no members: no vote).
export function councilVote(state, f) {
  const ms = allianceMembers(state).filter((m) => m !== f);
  const yes = ms.filter((m) => relation(state, m, f) >= ALLIANCE.VOTE_REL).length;
  return { yes, no: ms.length - yes, passes: ms.length > 0 && yes * 2 > ms.length };
}
// Why this group cannot join now ("" = it can). Each condition, in the order the player meets them.
export function inviteProblem(state, f) {
  if (!f || !f.alive) return "They are gone.";
  if (f.outsider || f.nomad) return `${f.name} are not one of the state's groups: they join nothing.`; // outsiders and nomads (visitors.js, nomads.js) never join the coalition
  if (isMember(state, f)) return `${f.name} is already in the coalition.`;
  if (!f.known) return "You have not met them.";
  if (!reachable(state, f)) return outOfReach(state, f);
  if (attitude(f) === "Hostile") return `${f.name} is hostile.`;
  const want = inviteGoodwill(state, f, ALLIANCE.GOODWILL); // conquest.js: peaceful groups want more from a conqueror
  if (f.goodwill < want) return `${f.name} needs goodwill ${want}${want > ALLIANCE.GOODWILL ? ` (${ALLIANCE.GOODWILL}, more because of the groups you have conquered)` : ""} (now ${Math.round(f.goodwill)}).`;
  if (!f.pact) return `${f.name} needs a pact with you first.`;
  const foe = allianceMembers(state).find((m) => warBetween(state, m, f));
  if (foe) return `${f.name} is at war with ${foe.name}, a member.`;
  const wait = blocVoteWait(state, f); // blocs.js: its bloc voted against joining lately
  if (wait) return `${cap(blocTitle(blocOf(state, f)))} voted against joining; ${f.name} will not hear another invitation for ${wait} day${wait === 1 ? "" : "s"}.`;
  if (jobsDoneFor(state, f) < 1) {
    const v = councilVote(state, f);
    if (!v.passes) return v.yes + v.no ? `Do a job for ${f.name}, or win the council's vote (${v.yes} of ${v.yes + v.no} members would say yes).` : `Do a job for ${f.name} first.`;
  }
  return "";
}
// An invitation to a member of an AI bloc goes to the whole bloc (blocs.js blocJoinsCoalition: it votes, and joins
// together, or the invited group joins alone, or nobody does).
export function inviteToAlliance(state, f) {
  const why = inviteProblem(state, f);
  if (why) return why;
  const bloc = state.noBlocs ? null : blocOf(state, f);
  if (bloc && blocMembers(state, bloc).length > 1) return blocJoinsCoalition(state, bloc, f);
  admitToAlliance(state, f);
  return `${f.name} joined ${ensureAlliance(state).name}.`;
}
// "Invite the whole bloc" (the Groups and coalition tabs): the invitation goes through a member that meets your terms.
export function inviteBloc(state, blocId) {
  const b = blocById(state, blocId);
  if (!b) return "That bloc is gone.";
  const f = blocCarrier(state, b, inviteProblem);
  if (!f) {
    const first = blocMembers(state, b).find((m) => !isMember(state, m));
    return `No member of ${blocTitle(b)} can take your invitation yet${first ? `: ${inviteProblem(state, first)}` : "."}`;
  }
  return inviteToAlliance(state, f);
}
// Into the coalition (an invitation it accepted, its bloc's vote). quiet: the bloc's vote has its own log line.
export function admitToAlliance(state, f, why = "they joined your coalition", quiet = false) {
  const A = ensureAlliance(state);
  if (A.members.includes(f.id)) return;
  A.members.push(f.id);
  A.joined[f.id] = day(state);
  if (A.founded == null) A.founded = day(state);
  A.stats.joined++;
  A.history.unshift({ day: day(state), text: `${f.name} joined.` });
  f.lastDiplomacy = day(state);
  changeGoodwill(state, f, 5, why);
  for (const m of allianceMembers(state)) if (m !== f) changeRelation(state, m, f, 10);
  if (!quiet) log(state, `${f.name} joined ${A.name}. ${A.members.length} member${A.members.length === 1 ? "" : "s"} now.`, "good");
}
function leave(state, f, why) {
  const A = ensureAlliance(state);
  A.members = A.members.filter((id) => id !== f.id);
  A.stats.left++;
  A.history.unshift({ day: day(state), text: `${f.name} left (${why}).` });
  if (f.alive) log(state, `${f.name} left ${A.name}: ${why}.`, "danger");
}
export function expel(state, f) {
  if (!isMember(state, f)) return "They are not a member.";
  leave(state, f, "you expelled them");
  changeGoodwill(state, f, -15, "you threw them out of the coalition");
  return `${f.name} is out of the coalition.`;
}

// ---------- daily ----------
export function allianceDaily(state) {
  const A = ensureAlliance(state);
  // Members who leave.
  for (const id of [...A.members]) {
    const f = factionById(state, id);
    if (!f || !f.alive) { A.members = A.members.filter((x) => x !== id); A.history.unshift({ day: day(state), text: `${f ? f.name : "A member"} is gone.` }); continue; }
    if (f.goodwill < ALLIANCE.LEAVE_GOODWILL) leave(state, f, "it no longer trusts you");
    else if (!f.pact) leave(state, f, "there is no pact with you any more");
    else if (allianceMembers(state).some((m) => m !== f && warsOf(state, f).some((w) => w.a === f.id && enemyIn(w, f) === m.id))) leave(state, f, "it attacked another member");
  }
  const ms = allianceMembers(state);
  shareSightings(state, ms);
  hordeHelp(state, ms);
  askToJoin(state);
  council(state, ms);
}

function shareSightings(state, ms) {
  if (!ms.length) return;
  const g = state.grid;
  const tiles = new Set();
  for (const f of ms) {
    for (const b of f.bases) for (const id of g.within(b, ALLIANCE.SHARE_LAND)) tiles.add(id);
    for (const h of state.hordes) if (f.bases.some((b) => g.distance(b, h.tile) <= ALLIANCE.SHARE_HORDES)) tiles.add(h.tile);
    for (const hv of state.hives || []) if (f.bases.some((b) => g.distance(b, hv.tile) <= ALLIANCE.SHARE_HIVES)) tiles.add(hv.tile);
    for (const s of state.hiveSites || []) if (f.bases.some((b) => g.distance(b, s.tile) <= ALLIANCE.SHARE_HIVES)) tiles.add(s.tile);
  }
  for (const id of tiles) {
    const cur = state.knowledge[id];
    if (cur && cur.hour >= state.hour) continue;
    const snap = snapshot(state, id);
    snap.via = "ally"; // a report, not your own eyes (jobs.js scout jobs do not count it)
    state.knowledge[id] = snap;
  }
}

// A horde on its way to one of your bases is harried once by members within 20 tiles.
function hordeHelp(state, ms) {
  if (!ms.length) return;
  const g = state.grid;
  for (const h of [...state.hordes]) {
    if (h.role !== "attack" || h.allyHarried || !h.goal || h.goal.baseId == null) continue;
    const base = state.bases.find((b) => b.id === h.goal.baseId);
    if (!base || g.distance(h.tile, base.tile) > 6) continue;
    const helpers = ms.filter((f) => f.bases.some((b) => g.distance(b, base.tile) <= ALLIANCE.RAID_RANGE));
    if (!helpers.length) continue;
    h.allyHarried = true;
    const cut = Math.round(h.size * Math.min(0.3, ALLIANCE.HORDE_CUT * helpers.length));
    const before = h.size;
    reduceHorde(state, h, cut);
    log(state, `${helpers.map((f) => f.name).join(" and ")} harried the horde heading for ${base.name}: ${cut} of the ${before} dead cut down on the way.`, "good");
  }
}

// factions.js resolveRaidOnPlayer: members with a base within 20 tiles send fighters.
export function allianceRaidHelp(state, base, attacker) {
  const ms = allianceMembers(state).filter((f) => f !== attacker && f.bases.some((b) => state.grid.distance(b, base.tile) <= ALLIANCE.RAID_RANGE));
  if (!ms.length) return { power: 0, names: [] };
  const own = baseDefense(state, base);
  const power = Math.min(Math.max(own, 10) * 0.5, ms.reduce((a, f) => a + strength(f) * ALLIANCE.RAID_SHARE, 0));
  return { power, names: ms.map((f) => f.name) };
}

// hives.js assaultHive: fighters from members near the hive and from a group whose hive job you took.
export function hiveAllies(state, hive) {
  const g = state.grid;
  const out = { fighters: 0, names: [] };
  const groups = new Set(allianceMembers(state).filter((f) => f.bases.some((b) => g.distance(b, hive.tile) <= ALLIANCE.HIVE_RANGE)));
  for (const j of activeJobs(state)) if (j.type === "hive" && j.data.hiveId === hive.id) { const f = factionById(state, j.fid); if (f && f.alive) groups.add(f); }
  for (const fid of volunteerGroupsAt(state, hive.tile, hive.id)) groups.delete(factionById(state, fid)); // volunteers.js: a group that sent people into the crawl fights there in person, not twice
  const extra = isLate(state) ? ERAS.ALLY_LATE : 0; // eras.js: one more each from the late game
  for (const f of groups) {
    const n = clamp(Math.round(f.pop / 10), 1, 3) + extra;
    out.fighters += n;
    out.names.push(`${f.name} (${n})`);
  }
  return out;
}
// Fighters the coalition sends when you storm a group's base (conquest.js assaultForce): every member with a base
// within HIVE_RANGE of it that is not on good terms with the defenders (relations under VOTE_REL) sends 1 per 10
// people (1–3), one more from the late game (eras.js: the coalition has grown into an army). Each keeps one defender
// off your squad (conquest.js: at most 40% of them).
export function assaultAllies(state, target, tile) {
  const g = state.grid;
  const out = { fighters: 0, names: [] };
  const extra = isLate(state) ? ERAS.ALLY_LATE : 0;
  const sent = volunteerGroupsAt(state, tile);
  for (const f of allianceMembers(state)) {
    if (f === target || !f.bases.some((b) => g.distance(b, tile) <= ALLIANCE.HIVE_RANGE)) continue;
    if (sent.has(f.id)) continue; // volunteers.js: its volunteers are in the assault team itself
    if (relation(state, f, target) >= ALLIANCE.VOTE_REL) continue;
    const n = clamp(Math.round(f.pop / 10), 1, 3) + extra;
    out.fighters += n;
    out.names.push(`${f.name} (${n})`);
  }
  return out;
}
// The brood the squad faces after the allies take their share (at most 40% off, at least 6 left).
export const broodAfterAllies = (count, fighters) => Math.max(Math.min(count, 6), count - Math.min(fighters, Math.floor(count * 0.4)));

// A group that qualifies asks to join.
function askToJoin(state) {
  const A = ensureAlliance(state);
  const rng = diploRng(state);
  for (const f of state.factions) {
    if (!f.alive || isMember(state, f) || inviteProblem(state, f)) continue;
    if (state.cards.some((c) => c.allianceAsk === f.id)) continue;
    if (A.lastAsk[f.id] != null && day(state) - A.lastAsk[f.id] < 20) continue;
    if (!rng.chance(ALLIANCE.ASK_CHANCE)) continue;
    A.lastAsk[f.id] = day(state);
    const bloc = state.noBlocs ? null : blocOf(state, f);
    const mates = bloc ? blocMembers(state, bloc).filter((m) => m !== f) : [];
    addCard(state, {
      title: `${f.name} asks to join the coalition`, allianceAsk: f.id,
      text: `${f.name} (${attitude(f).toLowerCase()}, goodwill ${Math.round(f.goodwill)}) want to join ${A.name}. Members share what they see, send fighters against raids and hordes coming for your bases, join your hive assaults, and sit in the seasonal council.${mates.length ? ` They stand in ${blocTitle(bloc)} with ${mates.map((m) => m.name).join(" and ")}: the bloc votes on it, and may come in together.` : ""}`,
      choices: [
        { label: "Welcome them", hint: mates.length ? `Their bloc votes: most agrees and the bloc joins together, else ${f.name} may join alone` : "They join the coalition", ai: () => 5, resolve: (st) => inviteToAlliance(st, f) },
        { label: "Not now", hint: "They may ask again in a few weeks", ai: () => 0, resolve: () => `You keep ${f.name} waiting.` },
      ],
    });
  }
}

// ---------- the council ----------
export const nextCouncilDay = (state) => { const d = day(state); const k = Math.max(0, Math.ceil((d - ALLIANCE.COUNCIL_FIRST) / ALLIANCE.COUNCIL_EVERY)); const n = ALLIANCE.COUNCIL_FIRST + k * ALLIANCE.COUNCIL_EVERY; return n < d ? n + ALLIANCE.COUNCIL_EVERY : n; };
function council(state, ms) {
  const d = day(state);
  if (!ms.length || !hub(state) || d < ALLIANCE.COUNCIL_FIRST || (d - ALLIANCE.COUNCIL_FIRST) % ALLIANCE.COUNCIL_EVERY !== 0) return;
  const A = ensureAlliance(state);
  if (A.lastCouncil === d) return;
  A.lastCouncil = d;
  A.stats.councils++;
  const rng = diploRng(state);
  const kinds = ["supplies", "job"];
  if (ms.length >= 2) kinds.push("ruling", "ruling");
  if (ms.length >= 2 && councilWar(state, ms)) kinds.push("volunteers"); // volunteers.js: a member at war asks for fighters
  for (let i = 0; i < 4; i++) {
    const card = councilCard(state, rng.pick(kinds), ms);
    if (card) { addCard(state, card); return; }
  }
  A.history.unshift({ day: d, text: "The council met. Nothing was asked of you." });
}

const everyone = (state, ms, n, why) => { for (const m of ms) changeGoodwill(state, m, n, why); };
export function councilCard(state, kind, ms = allianceMembers(state)) {
  const A = ensureAlliance(state);
  const rng = diploRng(state);
  const h = hub(state);
  if (kind === "supplies") {
    const opts = [];
    for (const f of ms) for (const k of ["food", "meds", "ammo", "fuel"]) if (need(f, k) >= 1.3) opts.push({ f, k });
    if (!opts.length) return null;
    const { f, k } = rng.pick(opts);
    const qty = { food: 30, meds: 8, ammo: 60, fuel: 10 }[k];
    const others = ms.filter((m) => m !== f);
    // Rounds go by calibre (2026-10-09, user request): the rounds your guns need least (ammo.js payRoundsOf), named.
    const sendOf = (st) => (k === "ammo" ? payRoundsOf(st, hub(st), qty) : { [k]: qty });
    const pre = sendOf(state), what = k === "ammo" ? (Object.keys(pre).length ? suppliesText(pre) : `${qty} rounds`) : `${qty} ${k}`;
    return {
      title: `The council: ${f.name} needs ${k === "ammo" ? "rounds" : k}`, council: "supplies",
      text: `${A.name} meets for the season. ${f.name} is short of ${k === "ammo" ? "ammunition" : k} and the council asks you to send ${what} from ${h.name}.`,
      choices: [
        { label: `Send ${what}`, hint: `${h.name} has ${Math.floor(supplyAmt(h.stock, k))}. +6 goodwill with ${f.name}, +3 with the other members`, disabled: (st) => supplyAmt(hub(st).stock, k) < qty,
          ai: (st) => (supplyAmt(hub(st).stock, k) >= qty * 3 ? 4 : -1), resolve: (st) => {
            if (supplyAmt(hub(st).stock, k) < qty) return `${h.name} no longer has ${qty} ${k}.`;
            const sent = sendOf(st); // rounds: by calibre, out of the stock by key (their store keeps one ammo count: settleAll folds them)
            for (const [kk, q] of Object.entries(sent)) { if (kk === "food") { moveFoodUnits(hub(st), f, q, { state: st }); continue; } useSupply(hub(st).stock, kk, q); f.stock[kk] = (f.stock[kk] || 0) + q; } // foods.js: days of food, the soonest to spoil first
            changeGoodwill(st, f, 6, "the council's request"); everyone(st, others, 3, "the council's request");
            A.stats.granted++; A.history.unshift({ day: day(st), text: `You sent ${suppliesText(sent)} to ${f.name}.` });
            return `${suppliesText(sent)} sent to ${f.name}.`;
          } },
        { label: "Refuse", hint: "−4 goodwill with every member", ai: () => 0, resolve: (st) => { everyone(st, ms, -4, "you refused the council"); A.stats.refused++; A.history.unshift({ day: day(st), text: `You refused to send ${k} to ${f.name}.` }); return "You refuse. The council is not pleased."; } },
      ],
    };
  }
  if (kind === "job") {
    for (const f of rng.shuffle([...ms])) {
      if (activeJobs(state).filter((j) => j.fid === f.id).length >= 2) continue;
      const job = makeJob(state, f, "council");
      if (!job) continue;
      const card = jobOfferCard(state, job);
      card.title = `The council: a job for ${f.name}`;
      card.council = "job";
      // Refusing the council costs more than refusing one group.
      const no = card.choices.find((c) => c.label === "Decline");
      if (no) {
        const base = no.resolve;
        no.hint = "−1 goodwill with them, −3 with every member";
        no.resolve = (st) => { const t = base(st); everyone(st, ms, -3, "you refused the council"); A.stats.refused++; return t; };
      }
      card.choices = card.choices.filter((c) => c.label !== "Maybe later");
      A.history.unshift({ day: day(state), text: `The council asked you to take a job for ${f.name}.` });
      return card;
    }
    return null;
  }
  if (kind === "volunteers") return councilVolCard(state, ms, ALLIANCE.VOTE_REL); // volunteers.js: the council votes on fighters for a member's war
  if (kind === "ruling" && ms.length >= 2) {
    const [a, b] = rng.shuffle([...ms]).slice(0, 2);
    const what = rng.pick(["a stretch of farmland between them", "a well both claim", "salvage rights at a site between their bases", "a quarrel over stolen livestock"]);
    const speech = radioSpeech(state);
    const chance = clamp(0.25 + speech * 0.04 + (a.goodwill + b.goodwill) / 400, 0.05, 0.9);
    const side = (st, win, lose) => {
      changeGoodwill(st, win, 6, "your ruling"); changeGoodwill(st, lose, -8, "your ruling against them"); changeRelation(st, win, lose, -10);
      A.history.unshift({ day: day(st), text: `You ruled for ${win.name} against ${lose.name} (${what}).` });
      return `You ruled for ${win.name}. ${lose.name} will remember it.`;
    };
    return {
      title: `The council: ${a.name} and ${b.name} quarrel`, council: "ruling",
      text: `${a.name} and ${b.name} bring ${what} to the council and ask you to rule.`,
      choices: [
        { label: `Side with ${a.name}`, hint: `+6 with ${a.name}, −8 with ${b.name}, and it sours things between them`, ai: (st) => (a.goodwill <= b.goodwill ? 1 : 0.5), resolve: (st) => side(st, a, b) },
        { label: `Side with ${b.name}`, hint: `+6 with ${b.name}, −8 with ${a.name}, and it sours things between them`, ai: (st) => (b.goodwill < a.goodwill ? 1 : 0.5), resolve: (st) => side(st, b, a) },
        { label: `Propose a compromise (${Math.round(chance * 100)}%)`, hint: "A Speech check (your best talker at the hub): it works: +3 with both and they make up; it fails: −3 with both",
          ai: () => chance * 4, resolve: (st) => {
            const t = h ? [...atBase(st, h.id)].sort((x, y) => skill(y, "speech") - skill(x, "speech") || x.id - y.id)[0] : null;
            if (t) gainXp(st, t, "speech", USE.radio || 2);
            if (st.rng.chance(chance)) {
              changeGoodwill(st, a, 3, "a fair compromise"); changeGoodwill(st, b, 3, "a fair compromise"); changeRelation(st, a, b, 5);
              A.history.unshift({ day: day(st), text: `Your compromise settled ${a.name} and ${b.name}'s quarrel.` });
              return "Both sides accept the compromise.";
            }
            changeGoodwill(st, a, -3, "a compromise nobody liked"); changeGoodwill(st, b, -3, "a compromise nobody liked");
            A.history.unshift({ day: day(st), text: `Your compromise between ${a.name} and ${b.name} pleased neither.` });
            return "Neither side likes the compromise.";
          } },
      ],
    };
  }
  return null;
}

// ---------- victory ----------
// A member's land and the coalition's share (see the header): { counts, from (the day it counts from by time), since
// (the day it joined), war (the group it is at war with, "you", or null), soon (it will count by time alone: not at
// war) }. A member without a join day (a save from before it was kept, a test) joins the count from today.
export function memberLand(state, f) {
  const A = ensureAlliance(state);
  if (!A.joined) A.joined = {};
  if (A.joined[f.id] == null) A.joined[f.id] = day(state);
  const since = A.joined[f.id], from = since + ALLIANCE.LAND_AFTER;
  const war = memberWar(state, f);
  return { counts: !war && day(state) >= from, from, since, war, soon: !war };
}
// The war that keeps a member's land from counting: "you", the group it fights, or null.
function memberWar(state, f) {
  if (atWarWithYou(state, f)) return "you";
  for (const w of warsOf(state, f)) { const e = factionById(state, enemyIn(w, f)); if (e && e.alive) return e; }
  return null;
}
// The members whose land counts today (soon: with those that only wait for their year).
export const countedMembers = (state, soon = false) => allianceMembers(state).filter((f) => { const m = memberLand(state, f); return soon ? m.soon : m.counts; });
// How far a base's land reaches (see the header), scaled by the world size.
export function controlRadius(state, kind, walled = false) {
  const r = kind === "stronghold" ? ALLIANCE.STRONGHOLD_RANGE : ALLIANCE.CONTROL_RANGE + (walled ? ALLIANCE.WALLED_RANGE : 0);
  return Math.max(3, Math.round(r * Math.sqrt(worldScale(state))));
}
export const baseRadius = (state, b) => controlRadius(state, b.type === "hub" || b.captured ? "stronghold" : "outpost", count(b, "walls") > 0);
// Every centre of coalition land with its radius: your bases and the members' bases.
// The land the coalition holds, as a mask over the tiles (1 = held). Gangs from beyond the border and raider bands
// do not dig in there (factions.js newGangs, visitors.js settleBands): the coalition's patrols see them off.
// soon: with the members whose land only waits for their year (the governor's land planner).
export function coalitionMask(state, soon = false) {
  const mark = new Uint8Array(state.tiles.length);
  for (const c of landCentres(state, soon)) for (const id of state.grid.within(c.tile, c.r)) mark[id] = 1;
  for (const id of playerClaims(state)) mark[id] = 1; // claims.js: tiles your teams claimed
  return mark;
}
export function landCentres(state, soon = false) {
  return [...state.bases.filter((b) => !isCamp(b)).map((b) => ({ tile: b.tile, r: baseRadius(state, b) })), ...countedMembers(state, soon).flatMap((f) => f.bases.map((t) => ({ tile: t, r: controlRadius(state, "outpost") })))];
}
// Land the coalition controls: land tiles within reach of your bases or a member's base, plus your claims
// (claims.js). `claims`: how many land tiles the claims add that no base's reach covered; `claimed`: all of them.
// soon: with the members whose land only waits for their year (the Goals card's "once every member counts").
export function controlledLand(state, soon = false) {
  // Cached for the day: checkGameOver asks every hour and the mark pass over every tile cost 9% of a huge map's
  // hour. A new base, claim or member, a member's land starting to count or a war (or the next day) recomputes it.
  const ms = countedMembers(state, soon);
  const key = `${Math.floor(state.hour / 24)}|${state.bases.length}|${state.bases.reduce((a, b) => a + b.tile, 0)}|${playerClaims(state).length}|${ms.map((f) => `${f.id}:${f.bases.length}:${f.bases[0]}`).join(",")}`;
  const prop = soon ? "landCacheSoon" : "landCache";
  const c = state[prop];
  if (c && c.key === key) return c.res;
  const res = controlledLandNow(state, soon);
  Object.defineProperty(state, prop, { value: { key, res }, writable: true, configurable: true, enumerable: false }); // not saved
  return res;
}
function controlledLandNow(state, soon) {
  const g = state.grid;
  let land = 0, held = 0, claims = 0;
  const mark = new Uint8Array(state.tiles.length);
  for (const c of landCentres(state, soon)) for (const id of g.within(c.tile, c.r)) mark[id] = 1;
  for (const id of playerClaims(state)) if (!mark[id] && state.tiles[id] && state.tiles[id].terrain !== "water") { mark[id] = 1; claims++; }
  for (const t of state.tiles) {
    if (t.terrain === "water") continue;
    land++;
    if (mark[t.id]) held++;
  }
  return { held, land, pct: land ? held / land : 0, claims, claimed: claimedLand(state) };
}
// Progress toward both victories, for the Goals panel and the tools. alliance.outsiders: each group still alive and
// outside the coalition with what to do about it: "invite" (it could join now), "court" (not yet: why), or
// "defeat" (hostile: take its bases), and the fewest defenders at one of its bases.
export function goalsProgress(state) {
  const st = state.hives ? hiveStats(state) : { destroyed: 0 };
  const hivesLeft = (state.hives || []).length;
  const building = (state.hiveSites || []).filter((s) => s.started != null).length;
  const sites = (state.hiveSites || []).length;
  const groups = state.factions.filter((f) => f.alive);
  const ms = allianceMembers(state);
  const land = controlledLand(state);
  const landSoon = controlledLand(state, true); // with the members that wait only for their year
  // Each member's land: counting, "counts from day N", or "not counted: at war" (memberLand).
  const memberRows = ms.map((f) => { const m = memberLand(state, f); return { id: f.id, name: f.name, bases: f.bases.length, counts: m.counts, from: m.from, since: m.since, war: m.war === "you" ? "you" : m.war ? m.war.name : null }; });
  const hivesOk = hivesSecured(state);
  const landOk = land.pct > ALLIANCE.LAND_NEEDED;
  const allIn = groups.every((f) => isMember(state, f));
  const membersOk = ms.length > 0;
  // What blocks the coalition's victory today (wintest's "what blocks the win", the Goals panel).
  const blocks = [];
  if (!membersOk) blocks.push("no member yet (invite a group)");
  if (!landOk) blocks.push(`land ${Math.round(land.pct * 100)}% of the ${Math.round(ALLIANCE.LAND_NEEDED * 100)}%+ needed (bases, members a year in and at peace, claims)`);
  if (!hivesOk) blocks.push(`${hivesLeft + building} hive${hivesLeft + building === 1 ? "" : "s"} standing or being built (all must be destroyed)`);
  if (groups.some((f) => !isMember(state, f))) blocks.push(`${groups.filter((f) => !isMember(state, f)).length} group(s) outside the coalition (invite, break or conquer them)`);
  const outsiders = groups.filter((f) => !isMember(state, f)).map((f) => {
    const why = inviteProblem(state, f);
    const hostile = attitude(f) === "Hostile";
    const smallest = f.bases.length ? Math.min(...f.bases.map((t) => assaultForce(state, f, t).count)) : 0;
    return { id: f.id, name: f.known ? f.name : "a group you have not met", known: f.known, bases: f.bases.length, pop: f.pop, why,
      advice: !why ? "invite" : !f.known ? "find" : hostile ? "defeat" : "court", hostile, defenders: smallest };
  });
  return {
    era: eraProgress(state), // eras.js: the year, the era, the Accord's and the containment's clocks
    hives: { destroyed: st.destroyed || 0, left: hivesLeft, building, sites, ok: hivesOk },
    alliance: { land, landSoon, memberLand: memberRows, landOk, members: ms.length, membersOk, groups: groups.length, outside: outsiders.map((o) => o.id), outsiders, allIn, hivesLeft, hivesOk, blocks,
      infamy: Math.round(infamy(state)), lost: lostBases(state).map((o) => ({ tile: o.tile, name: o.name, factionId: o.factionId, day: o.day })), ok: landOk && membersOk && hivesOk && allIn },
  };
}
// The Calder Accord's daily test (eras.js, world.js): the same as allianceVictory (at least one member, over half
// the land, no hive, no group outside). newcomer: kept for the tools (a gang from beyond
// the border less than ERAS.ACCORD.GRACE days in the state).
export const newcomer = (state, f) => f.arrived != null && day(state) - f.arrived < ERAS.ACCORD.GRACE;
export function accordHolds(state) {
  return allianceVictory(state);
}
// The coalition's victory today: you are alive with a base, at least one group is a member, and the coalition holds
// more than LAND_NEEDED of the land (bases' reach, the members whose land counts, and claims). Groups outside do not
// block it: conquest counts.
export function allianceVictory(state) {
  if (!alive(state).length || !state.bases.some((b) => !isCamp(b))) return false; // a camp is not a base for the victory
  // Nobody left to sign: when every group is gone (broken, conquered, collapsed), the state is yours alone.
  if (!allianceMembers(state).length && state.factions.some((f) => f.alive)) return false; // cheap check first
  // 2026-10-13: a total victory. No hive stands (or is being built) and no group is left outside the coalition: the
  // rest are members, or broken, conquered or collapsed. Members are allies, so they do not count against it.
  if (!hivesSecured(state) || state.factions.some((f) => f.alive && !isMember(state, f))) return false;
  return controlledLand(state).pct > ALLIANCE.LAND_NEEDED;
}

// ---------- the AI governor (autopilot.js autopilotDaily) ----------
// Every style: keeps in touch with every group it knows and can reach on the radio (a greeting whenever one is
// due: +2 goodwill, +1 with a hostile group, and they do not feel neglected), scans the airwaves once a week, signs
// the pact a group will sign (non-aggression, then trade: a member needs one), has their caravans fetch the
// deliveries the hub can spare, and invites every group that qualifies into the coalition. Aggressive: sells ammo
// over the radio to groups at war (diplomacy.js autoWarTrade). (Joining wars is decided on the war card: Cautious
// always stays out.) Returns a line for the log or "".
export function autoDiplomacyDaily(state, style) {
  const out = [];
  if (canListen(state) && day(state) % 7 === 0) radioScan(state); // a station, or a hand-crank radio listening
  for (const f of state.factions) {
    if (!f.alive || !f.known || !canRadioGroup(state, f)) continue;
    if (radioCooldown(state, f, "greet") === 0) radioGreet(state, f);
    if (attitude(f) === "Hostile" || f.pact === "trade") continue;
    const kind = f.goodwill >= 20 ? "trade" : !f.pact ? "nonaggression" : null;
    if (!kind) continue;
    const r = radioPact(state, f, kind);
    if (/signed/i.test(r)) out.push(`${r.replace(/\.$/, "")} (${f.name}).`);
  }
  const picked = autoJobsDaily(state);
  if (picked) out.push(picked);
  for (const f of state.factions) if (f.alive && !isMember(state, f) && !inviteProblem(state, f)) out.push(inviteToAlliance(state, f));
  const sold = autoWarTrade(state, style, (st, f, want, payQty) => {
    const pk = dealRoundKey(st, f, hub(st), payQty, false); // rounds by calibre: the ones the hub's guns need least
    const q = dealQuote(st, f, { wantKey: want, wantQty: 1, payKey: pk, payQty });
    const wantQty = Math.min(q.maxWant || 0, 20);
    if (wantQty < 2) return "";
    const r = radioDeal(st, f, { wantKey: want, wantQty, payKey: pk, payQty });
    return r.ok ? `Sold ${suppliesText({ [pk]: payQty })} to ${f.name} (at war) for ${wantQty} ${want}.` : "";
  });
  if (sold) out.push(sold);
  return out.join(" ");
}
