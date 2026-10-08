// Intel on the air: what the groups overhear of your radio traffic and of each other's, what they do with it, and
// what you can do about it (radio discipline, decoys, scouts caught and questioned). One pass a day (radio.js
// radioDaily, after listenDaily); dice: skills.js hash01 only. Hidden bases themselves: hiding.js.
//
// Your traffic (playerAir: state.intel.air, kept INTEL.KEEP_DAYS days). While you have a network on the air (radio.js
// playerNetwork), what you say on it is written down each day:
//   - calls to a group (radio.js f.radio: greet and news "call", a caravan asked for or a deal "trade", a call for help
//     "distress", a group's offer you answered "trade"): the station that carried it can be traced (the linked
//     transmitter nearest to them: its base; a plain "call" caught is traced INTEL.DF of the time), a trade names the base the goods go to (radio.js tradeBase) and what its
//     stores hold, a call for help the base in trouble;
//   - deals booked over the radio (radiotrade.js bookDeal, "trade"): the base and its stores;
//   - your trade caravans and convoys on the road while inside your coverage (they report in, "caravan"): where from,
//     where to, when they get there (radiolisten.js arrivalDay) and the road they take;
//   - the coalition's chatter (alliance.js), every INTEL.COALITION_EVERY days ("coalition"): the hub;
//   - decoys you put out (broadcastDecoy, below).
//   A base running silent (hiding.js) is never named on the air: its deals, its caravans and its station say nothing
//   that leads to it (a call through its station cannot be traced).
// Who listens (aiListen): every group with a base and INTEL.AI.MIN_POP people keeps an ear on one channel (g.ear =
// { net, day }: "player" or a group's id), picked every INTEL.AI.RETUNE days among the networks whose coverage one of
// its bases stands in (radio.js netCovers, as for your receivers): yours by INTEL.TUNE (more when hostile, at war with
// you or raid-minded), a group's by INTEL.TUNE (more for a rival or an enemy at war). Someone is on the set a day
// INTEL.AI.DAILY × its profile's listen (groupcare.js GROUP_PRIORITIES), at most INTEL.AI.DAILY_MAX, and hears that
// day's traffic (as your tuned receivers do: a one-off call has one chance, a caravan reporting in one a day). Each
// line is caught or missed once per group and day by radiolisten.js oddsFrom: INTEL.ODDS[kind] (your traffic) or ODDS (a group's) ×
// (0.7 + 0.03 × Scouting: INTEL.AI.SCOUTING × listen), × 0.6 when it is encrypted and they have no military set (your
// network is encrypted while a Military encrypted radio stands in it; a military group has one), × INTEL.DISCIPLINE
// on your lines while you keep radio discipline (state.radioDiscipline "windows"), × radiolisten.js silentMult on a
// group's channel that keeps its own.
// What they do with it (heardYou / heardGroup): a base named: they know it (groupworld.js learnBase, k.via "radio"),
// stores heard of: k.heard (factions.js playerRaidWeight × INTEL.HEARD_PULL for INTEL.HEARD_DAYS days); your caravan
// on the road: a group that would rob it (aggressive, or at war with you, and hostile enough: caravanraids.js
// wouldRaid) lies in wait (g.lying = { partyId, tile, until }) where the road passes nearest to its bases, when that is
// within INTEL.AMBUSH.REACH tiles: a convoy is hunted INTEL.AMBUSH.RANGE tiles further out and INTEL.AMBUSH.MULT × as
// often (caravanraids.js aiRaidsHour), a team on the caravan mission meets them INTEL.AMBUSH.MULT × as often and spots
// them first × INTEL.AMBUSH.SPOT (conflicts.js). Sprung: "They knew we were coming". From a group's channel: a caravan
// or a raid heading for your base names it; a group's caravan is waited for by a gang that would rob it (parties.js:
// INTEL.AMBUSH.AI_RANGE tiles further, × INTEL.AMBUSH.MULT); a raid on the listener itself: it is braced
// (g.bracedFor, factions.js: + INTEL.BRACED × its strength to its defence). Every line of a group's also gives away
// where it is said from: its bases that are not hidden.
// A raid that comes for a base they know only from the radio says so on the warning card (factions.js raidWarning).
//
// Counter-intel (yours):
//   - Radio discipline (setDiscipline): "open" or "windows" (short scheduled windows): × INTEL.DISCIPLINE on every line
//     the groups might catch; the groups' calls to you come INTEL.OFFERS × as often (radio.js radioDaily).
//   - Encryption: a Military encrypted radio at a base on your network (radio.js hasMilRadio).
//   - Decoys (broadcastDecoy, once every INTEL.DECOY.EVERY days, a network needed): "caravan", a rich caravan that is
//     not there (a road from the hub toward a group you trade with): a gang that bites waits by the road for nothing
//     and loses INTEL.DECOY.WASTE days of raiding; "base", an outpost that is not there (a tile INTEL.DECOY.DIST from
//     the hub, toward the nearest hostile group), weak and rich by the talk: a group that bites may send its next raid
//     there (factions.js launchRaid: kind "decoy") and finds empty ground. Fooled, a group trusts nothing it hears of
//     yours for INTEL.DECOY.DISTRUST days (g.distrustYou: decoys and caravans ignored). You hear of it when you can
//     see the spot (coverage or the live view).
//   - Scouts at your walls (groupworld.js scoutYou): chase off, capture (a prisoner you can question), kill, feed them
//     false information (scoutFalse: they go home believing the base INTEL.SCOUT.FALSE_DEF × as strong and
//     INTEL.SCOUT.FALSE_VALUE × as rich; Speech decides), or let them watch.
//   - Questioning a prisoner (prisoners.js gatherIntel) tells what their group knows of your bases (knowsLine).
// AI parity: the groups listen as you do (above); some run silent (GROUP_PRIORITIES silent: their channel × silentMult;
// their hidden outposts are off their network, radio.js groupNetwork) and hide outposts (hiding.js). Abstract: the
// groups put out no decoys and do not feed your scouts false information; their listener is a number by type, not
// a person.
import { day, log, hub, baseById, localId, factionById, atBase, skill } from "./world.js";
import { hash01 } from "./skills.js";
import { playerNetwork, groupNetwork, netCovers, radioNodes, tradeBase, hasNetwork, inCoverage } from "./radio.js";
import { oddsFrom, ODDS, arrivalDay, silentMult } from "./radiolisten.js";
import { learnBase, knowsOf } from "./groupworld.js";
import { weightOf } from "./groupcare.js";
import { attitude, isAggressiveType, changeGoodwill } from "./factions.js";
import { relation, warBetween } from "./diplomacy.js";
import { atWarWithYou } from "./playerwars.js";
import { wouldRaid } from "./caravanraids.js";
import { allianceMembers } from "./alliance.js";
import { radioDeals } from "./radiotrade.js";
import { tileLabel, planPath, partyTile } from "./parties.js";
import { hidingDaily } from "./hiding.js";

export const INTEL = {
  KEEP_DAYS: 4, GOT_DAYS: 20, COALITION_EVERY: 6,
  // Base odds of a group catching a line of your traffic (before Scouting, encryption and discipline).
  ODDS: { call: 0.25, trade: 0.55, distress: 0.6, caravan: 0.5, coalition: 0.4 },
  // A call caught: the share of the time they also fix where the transmitter stands (a greeting names no base).
  DF: 0.5,
  AI: { MIN_POP: 5, SCOUTING: 4, RETUNE: 7, DAILY: 0.6, DAILY_MAX: 0.9 },
  TUNE: { YOU: 1, GROUP: 0.5, HOSTILE: 1.5, WAR: 2, RAID: 0.5, RIVAL_REL: -20 },
  DISCIPLINE: 0.5, OFFERS: 0.5, AI_SILENT: 0.5,
  HEARD_PULL: 1.4, HEARD_DAYS: 20,
  AMBUSH: { REACH: 8, RANGE: 4, MULT: 4, SPOT: 0.5, SLACK: 2, AI_RANGE: 2 },
  BRACED: 0.3,
  DECOY: { EVERY: 10, DIST: [5, 9], WASTE: 6, DISTRUST: 40, FAKE_DEF: 4, FAKE_VALUE: 900, DAYS: 3 },
  SCOUT: { FALSE_BASE: 0.4, FALSE_SPEECH: 0.05, FALSE_MAX: 0.9, FALSE_DEF: 2.5, FALSE_VALUE: 0.3, KILL_FOUND: 0.5, KILL_GW: -10 },
};
export const DISCIPLINES = {
  open: { name: "Open", desc: "Talk whenever there is something to say." },
  windows: { name: "Scheduled windows", desc: `Short, scheduled windows only: the groups catch ${Math.round(INTEL.DISCIPLINE * 100)}% as much of what you say, and they call you ${Math.round(INTEL.OFFERS * 100)}% as often.` },
};
// What each kind of radio call puts on the air (radio.js f.radio cooldown marks).
const CALL_KINDS = { greet: "call", news: "call", caravan: "trade", offer: "trade", help: "distress" };

export function intelOf(state) {
  const I = state.intel || (state.intel = {});
  I.air = I.air || [];
  I.got = I.got || {};
  I.stats = I.stats || {};
  I.found = I.found || {};
  I.unseen = I.unseen || {};
  I.decoys = I.decoys || [];
  return I;
}
const bump = (state, k, n = 1) => { const S = intelOf(state).stats; S[k] = (S[k] || 0) + n; };
const h = (state, ...k) => hash01(state.seed, "intel", ...k);
const lid = (state, id) => localId(state, id);
export const discipline = (state) => (DISCIPLINES[state.radioDiscipline] ? state.radioDiscipline : "open");
export function setDiscipline(state, v) {
  state.radioDiscipline = DISCIPLINES[v] ? v : "open";
  return `Radio discipline: ${DISCIPLINES[discipline(state)].name}. ${DISCIPLINES[discipline(state)].desc}`;
}
// Your network carries encrypted traffic: a Military encrypted radio at a base on it.
export const playerEncrypted = (state) => radioNodes(state).some((n) => n.linked && !n.offline && n.military);
const distrusts = (state, g, d = day(state)) => g.distrustYou != null && g.distrustYou >= d;

// ---------- your traffic ----------
// The base whose transmitter carried a call to f (the linked node nearest to them); null when it runs silent.
function dfBase(state, f) {
  const nodes = radioNodes(state).filter((n) => n.linked && !n.offline);
  if (!nodes.length || !f.bases.length) return null;
  const g = state.grid;
  const near = (t) => Math.min(...f.bases.map((b) => g.distance(b, t)));
  const n = nodes.sort((a, b) => near(a.tile) - near(b.tile) || a.base.id - b.base.id)[0];
  return n.base.silent ? null : n.base;
}
const named = (list) => [...new Set(list.filter((b) => b && !b.silent).map((b) => b.id))];
export function playerAir(state, d = day(state)) {
  const I = intelOf(state);
  const list = (I.air = I.air.filter((x) => d - x.day < INTEL.KEEP_DAYS));
  const put = (item) => {
    const i = list.findIndex((x) => x.key === item.key);
    if (i >= 0) list[i] = { ...list[i], ...item, day: d };
    else list.push({ ...item, day: d });
  };
  const net = playerNetwork(state);
  if (!net) return list;
  // Decoys go out with the day's traffic: a decoy outpost once (put out since the last pass), a decoy caravan
  // "reports in" each day until it would have arrived.
  for (const x of list) if (x.fake && (x.pending || (x.kind === "caravan" && d <= x.arrive))) { x.day = d; x.pending = false; }
  for (const f of state.factions) {
    if (!f.alive || !f.radio) continue;
    for (const [k, at] of Object.entries(f.radio)) {
      const kind = CALL_KINDS[k];
      if (!kind || at == null || at < d - 1) continue;
      const subj = kind === "trade" ? tradeBase(state, f) : kind === "distress" ? raidTargetOrHub(state) : null;
      put({ key: `call:${lid(state, f.id)}:${k}:${at}`, kind, to: f.id, bases: named([dfBase(state, f), subj]), rich: kind === "trade" });
    }
  }
  for (const deal of radioDeals(state)) if (deal.day >= d - 1) put({ key: `deal:${lid(state, deal.id)}`, kind: "trade", to: deal.factionId, bases: named([baseById(state, deal.baseId)]), rich: true });
  for (const p of state.parties) {
    if (p.owner !== "player" || !(p.teamMission === "caravan" || p.kind === "convoy") || !p.path || p.path.length < 2) continue;
    if (p.phase !== "out" && p.phase !== "back") continue;
    if (!netCovers(state, net, partyTile(p))) continue; // out of coverage: it does not report in
    const from = baseById(state, p.homeBaseId), to = state.bases.find((b) => b.tile === p.path[p.path.length - 1]);
    if ((from && from.silent) || (to && to.silent)) continue; // a silent base's teams keep quiet
    put({ key: `cv:${lid(state, p.id)}`, kind: "caravan", partyId: p.id, bases: named([from, to]), arrive: arrivalDay(state, p) });
  }
  const h0 = hub(state);
  if (h0 && allianceMembers(state).length && d % INTEL.COALITION_EVERY === 0) put({ key: `co:${d}`, kind: "coalition", bases: named([h0]) });
  return list;
}
function raidTargetOrHub(state) {
  const r = state.parties.find((q) => q.kind === "raid" && !q.returning && q.target && q.target.kind === "player");
  return (r && baseById(state, r.target.baseId)) || hub(state);
}

// ---------- the groups' ears ----------
const covers = (state, g, net) => !!net && g.bases.some((t) => netCovers(state, net, t));
const netOf = (state, id) => (id === "player" ? playerNetwork(state) : groupNetwork(state, factionById(state, id)));
function tune(state, g, d) {
  const E = g.ear;
  if (E && d - E.day < INTEL.AI.RETUNE && covers(state, g, netOf(state, E.net))) return E;
  const T = INTEL.TUNE;
  const cands = [];
  if (covers(state, g, playerNetwork(state))) {
    cands.push({ net: "player", w: T.YOU + (attitude(g) === "Hostile" ? T.HOSTILE : 0) + (atWarWithYou(state, g) ? T.WAR : 0) + weightOf(g, "raid") * T.RAID });
  }
  for (const o of state.factions) {
    if (o === g || !o.alive || o.outsider || !covers(state, g, groupNetwork(state, o))) continue;
    cands.push({ net: o.id, w: T.GROUP + (state.diplo && warBetween(state, g, o) ? T.WAR : 0) + (state.diplo && relation(state, g, o) < T.RIVAL_REL ? T.HOSTILE : 0) });
  }
  if (!cands.length) { g.ear = null; return null; }
  let r = h(state, "tune", g.name, d) * cands.reduce((a, c) => a + c.w, 0);
  const pick = cands.find((c) => (r -= c.w) < 0) || cands[cands.length - 1];
  g.ear = { net: pick.net, day: d };
  return g.ear;
}
const scoutingOf = (g) => INTEL.AI.SCOUTING * weightOf(g, "listen");
export function aiListen(state, g, d = day(state)) {
  if (!g.alive || g.outsider || !g.bases || !g.bases.length || (g.pop || 0) < INTEL.AI.MIN_POP) return 0;
  const E = tune(state, g, d);
  if (!E) return 0;
  if (h(state, "onset", g.name, d) >= Math.min(INTEL.AI.DAILY_MAX, INTEL.AI.DAILY * weightOf(g, "listen"))) return 0;
  const I = intelOf(state);
  const gk = lid(state, g.id);
  let n = 0;
  if (E.net === "player") {
    const enc = playerEncrypted(state) && g.type !== "military";
    const mult = discipline(state) === "windows" ? INTEL.DISCIPLINE : 1;
    for (const item of I.air) {
      if (item.day !== d) continue; // today's traffic (a caravan reporting in is on the air again each day)
      const key = `${gk}|${item.key}|${item.day}`;
      if (I.got[key] != null) continue;
      I.got[key] = d;
      if (h(state, "hear", g.name, item.key, d) >= oddsFrom(INTEL.ODDS[item.kind] ?? 0.4, scoutingOf(g), enc) * mult) continue;
      heardYou(state, g, item, d);
      n++;
    }
    return n;
  }
  const o = factionById(state, E.net);
  const chan = o && state.radioChan && state.radioChan.traffic ? state.radioChan.traffic[o.id] || [] : [];
  const enc = o && o.type === "military" && g.type !== "military";
  for (const item of chan) {
    if (item.day !== d) continue;
    const key = `${gk}|g${item.key}|${item.day}`;
    if (I.got[key] != null) continue;
    I.got[key] = d;
    if (h(state, "hearg", g.name, item.key, d) >= oddsFrom(ODDS[item.kind] ?? 0.4, scoutingOf(g), enc) * silentMult(o)) continue;
    heardGroup(state, g, o, item, d);
    n++;
  }
  return n;
}

// A base of yours learned from the radio. Returns true when it was new to them.
function learnVia(state, g, b, d, rich) {
  const was = knowsOf(state, g).bases[b.tile];
  const fresh = !was || was.fake;
  const k = learnBase(state, g, b.tile, d);
  if (!k) return false;
  if (fresh || was.via === "radio") k.via = "radio";
  if (rich) k.heard = d;
  if (fresh) { bump(state, "learnedByRadio"); if (b.type === "hub") bump(state, "hubByRadio"); }
  return fresh;
}
export function heardYou(state, g, item, d = day(state)) {
  bump(state, "heard");
  g.overheard = (g.overheard || 0) + 1;
  if (item.fake && distrusts(state, g, d)) return;
  if (item.fakeTile != null) { fakeBase(state, g, item.fakeTile, d); return; }
  if (item.kind === "call" && h(state, "df", g.name, item.key) >= INTEL.DF) return; // heard, but not where from
  for (const id of item.bases || []) { const b = baseById(state, id); if (b && !b.silent) learnVia(state, g, b, d, item.rich); }
  if (item.kind === "caravan") planAmbush(state, g, item, d);
}
function heardGroup(state, g, o, item, d) {
  bump(state, "heardGroups");
  for (const t of groupNetwork(state, o)?.nodes.map((n) => n.tile) || []) if (!knowsOf(state, g).bases[t]) learnBase(state, g, t, d); // where it is said from (its hidden outposts are off the air)
  const yours = item.baseId != null ? baseById(state, item.baseId) : null;
  if (yours && !yours.silent) learnVia(state, g, yours, d, false);
  if (item.kind === "caravan" && item.partyId != null && isAggressiveType(g) && wouldRaid(state, g, { owner: o.id, type: "caravan" })) {
    const q = state.parties.find((x) => x.id === item.partyId);
    if (q && q.path && !(g.lying && g.lying.until >= d)) {
      const at = nearestOnPath(state, g, q.path.slice(q.idx || 0));
      if (at && at.dist <= INTEL.AMBUSH.REACH) { g.lying = { partyId: q.id, tile: at.tile, until: arrivalDay(state, q) + INTEL.AMBUSH.SLACK, day: d, ai: true }; bump(state, "ambushesOnGroups"); }
    }
  }
  if (item.kind === "raid" && item.targetFaction === g.id && item.partyId != null) { g.bracedFor = item.partyId; bump(state, "braced"); }
}
function nearestOnPath(state, g, path) {
  let best = null;
  const gr = state.grid;
  for (const t of path) {
    const dd = Math.min(...g.bases.map((b) => gr.distance(b, t)));
    if (!best || dd < best.dist) best = { tile: t, dist: dd };
  }
  return best;
}
// Would this group fall on a caravan or convoy of yours? (caravanraids.js aiRaidsHour's groups; conflicts.js meets.)
export const huntsYou = (state, g) => (isAggressiveType(g) || atWarWithYou(state, g)) && wouldRaid(state, g, { owner: "player", type: "convoy" });
function planAmbush(state, g, item, d) {
  if (!huntsYou(state, g) || (g.lying && g.lying.until >= d)) return;
  const q = item.fake ? null : state.parties.find((x) => x.id === item.partyId);
  const path = item.fake ? item.path : q && q.path ? q.path.slice(q.idx || 0) : null;
  if (!path || !path.length) return;
  const at = nearestOnPath(state, g, path);
  if (!at || at.dist > INTEL.AMBUSH.REACH) return;
  g.lying = { partyId: item.fake ? null : q.id, tile: at.tile, until: (item.arrive ?? d + 2) + INTEL.AMBUSH.SLACK, day: d, fake: !!item.fake };
  bump(state, item.fake ? "decoysBitten" : "ambushes");
}
// Lying in wait for this party today? (caravanraids.js, conflicts.js, parties.js.)
export const lyingFor = (state, g, p) => !!(g && p && g.lying && g.lying.partyId === p.id && g.lying.until >= day(state));
// The ambush came off (or failed): the hint, and they go home.
export function ambushSprung(state, g, p, took = true) {
  if (!lyingFor(state, g, p)) return;
  bump(state, took ? "ambushTook" : "ambushFailed");
  g.lying = null;
  if (p.owner === "player") log(state, `They knew we were coming: ${g.known ? g.name : "the raiders"} were waiting by the road near ${tileLabel(state, partyTile(p))}. Someone must have been listening to our radio.`, "danger");
}

// ---------- decoys ----------
export function decoyProblem(state) {
  if (!hasNetwork(state)) return "Needs a radio station on the air.";
  const I = intelOf(state);
  if (I.decoyDay != null && day(state) - I.decoyDay < INTEL.DECOY.EVERY) return `A decoy went out on day ${I.decoyDay}: another from day ${I.decoyDay + INTEL.DECOY.EVERY} (too many and they stop believing any of it).`;
  if (!hub(state)) return "No hub to talk from.";
  return null;
}
// kind: "caravan" | "base". Returns a line for the player.
export function broadcastDecoy(state, kind) {
  const why = decoyProblem(state);
  if (why) return why;
  const I = intelOf(state);
  const d = day(state);
  const h0 = hub(state);
  const g = state.grid;
  if (kind === "caravan") {
    const partner = state.factions.filter((f) => f.alive && f.known && f.bases.length && attitude(f) !== "Hostile")
      .sort((a, b) => g.distance(a.bases[0], h0.tile) - g.distance(b.bases[0], h0.tile) || a.id - b.id)[0];
    const dest = partner ? partner.bases[0] : decoyTile(state);
    const r = dest != null ? planPath(state, h0.tile, dest, false) : null;
    if (!r) return "No road to talk about: the decoy needs somewhere a caravan could go.";
    I.decoyDay = d;
    const arrive = d + Math.max(1, Math.ceil(r.path.length / 10));
    I.air.push({ key: `decoy:cv:${d}`, kind: "caravan", fake: true, path: r.path, arrive, bases: [], day: d, pending: true });
    I.decoys.push({ kind: "caravan", day: d, tile: dest });
    bump(state, "decoys");
    log(state, `📻 False traffic: a rich caravan "leaving ${h0.name} for ${partner ? partner.name : tileLabel(state, dest)}, there around day ${arrive}". Nobody is going.`, "info");
    return `The decoy is on the air: a rich caravan that does not exist, on the road toward ${partner ? partner.name : tileLabel(state, dest)} around day ${arrive}. A gang that falls for it waits by the road for nothing.`;
  }
  const t = decoyTile(state);
  if (t == null) return "Nowhere to place an outpost that is not there.";
  I.decoyDay = d;
  I.air.push({ key: `decoy:b:${d}`, kind: "trade", fake: true, fakeTile: t, bases: [], day: d, pending: true });
  I.decoys.push({ kind: "base", day: d, tile: t });
  bump(state, "decoys");
  log(state, `📻 False traffic: talk of a well-stocked, lightly held outpost at ${tileLabel(state, t)}. There is nothing there.`, "info");
  return `The decoy is on the air: an outpost at ${tileLabel(state, t)} that does not exist, rich and weakly held by the talk. A group that believes it may send its next raid there instead.`;
}
// A tile for a decoy outpost: land, nobody's base, INTEL.DECOY.DIST from the hub, toward the nearest hostile group.
function decoyTile(state) {
  const h0 = hub(state);
  if (!h0) return null;
  const g = state.grid;
  const [lo, hi] = INTEL.DECOY.DIST;
  const foes = state.factions.filter((f) => f.alive && f.bases.length && attitude(f) === "Hostile");
  const taken = new Set([...state.bases.map((b) => b.tile), ...state.factions.flatMap((f) => (f.alive ? f.bases : []))]);
  const cands = g.within(h0.tile, hi).filter((t) => g.distance(t, h0.tile) >= lo && !taken.has(t) && state.tiles[t].terrain !== "water");
  if (!cands.length) return null;
  const toward = (t) => (foes.length ? Math.min(...foes.flatMap((f) => f.bases.map((b) => g.distance(b, t)))) : 0);
  return cands.sort((a, b) => toward(a) - toward(b) || h(state, "decoy", a) - h(state, "decoy", b))[0];
}
function fakeBase(state, g, tile, d) {
  if (distrusts(state, g, d) || state.bases.some((b) => b.tile === tile)) return;
  knowsOf(state, g).bases[tile] = { kind: "player", id: null, fake: true, def: INTEL.DECOY.FAKE_DEF, walls: 0, value: INTEL.DECOY.FAKE_VALUE, day: d, via: "radio" };
  bump(state, "decoysBitten");
}
const seenSpot = (state, tile) => (state.live && state.live.has(tile)) || inCoverage(state, tile);
// factions.js launchRaid: their raid went for the decoy outpost and found nothing.
export function decoyRaid(state, f, tile) {
  const d = day(state);
  delete knowsOf(state, f).bases[tile];
  f.distrustYou = d + INTEL.DECOY.DISTRUST;
  f.decoyWaste = (f.decoyWaste || 0) + INTEL.DECOY.WASTE;
  bump(state, "decoysWorked");
  if (seenSpot(state, tile)) log(state, `A war party of ${f.known ? f.name : "a group you have not met"} marched on ${tileLabel(state, tile)} and found empty ground: the false traffic drew them off.`, "good");
}
// Ambushes that ran out (each day): a decoy caravan never came.
function lyingDaily(state, d) {
  for (const g of state.factions) {
    const L = g.lying;
    if (!L) continue;
    if (L.until >= d && (L.fake || state.parties.some((p) => p.id === L.partyId))) continue;
    g.lying = null;
    if (!L.fake) continue;
    g.distrustYou = d + INTEL.DECOY.DISTRUST;
    g.raidCooldown = (g.raidCooldown || 0) + INTEL.DECOY.WASTE;
    bump(state, "decoysWorked");
    if (seenSpot(state, L.tile)) log(state, `${g.known ? g.name : "Raiders"} waited by the road near ${tileLabel(state, L.tile)} for a caravan that never came: the false traffic drew them out.`, "good");
  }
}

// ---------- scouts and prisoners ----------
// Feed a scout caught at the walls false information (groupworld.js scoutYou). Speech at the base decides.
export const falseOdds = (state, base) => Math.min(INTEL.SCOUT.FALSE_MAX, INTEL.SCOUT.FALSE_BASE + INTEL.SCOUT.FALSE_SPEECH * Math.max(0, ...atBase(state, base.id).map((s) => skill(s, "speech"))));
export function scoutFalse(state, f, base) {
  const d = day(state);
  const k = learnBase(state, f, base.tile, d);
  if (!k) return "They were gone.";
  const ok = h(state, "false", f.name, lid(state, base.id), d) < falseOdds(state, base);
  if (!ok) { f.scoutedYou = d; bump(state, "falseFailed"); return `The watcher did not swallow it: ${f.known ? f.name : "they"} know what ${base.name} really holds.`; }
  k.def = Math.round(k.def * INTEL.SCOUT.FALSE_DEF);
  k.value = Math.round((k.value || 0) * INTEL.SCOUT.FALSE_VALUE);
  k.misled = true;
  bump(state, "falseFed");
  return `Your people let the watcher see what they wanted seen: rifles at every loophole, empty storerooms. ${f.known ? f.name : "They"} now think ${base.name} far stronger and poorer than it is (until they look again).`;
}
// Kill the scout: they learn nothing; one of theirs gone; they may find out.
export function scoutKilled(state, f, base) {
  if (!f.alive) return "They were gone.";
  f.pop = Math.max(0, f.pop - 1);
  bump(state, "scoutsKilled");
  if (h(state, "killfound", f.name, lid(state, base.id), day(state)) < INTEL.SCOUT.KILL_FOUND) {
    changeGoodwill(state, f, INTEL.SCOUT.KILL_GW, "you killed their scout");
    return `Your people shot the watcher in the treeline. ${f.known ? f.name : "Their group"} found the body (goodwill ${INTEL.SCOUT.KILL_GW}).`;
  }
  return "Your people shot the watcher in the treeline. Nobody came looking.";
}
// What a group knows of your bases, in words (a prisoner of theirs talks: prisoners.js gatherIntel).
export function knowsLine(state, f) {
  if (!f || !f.alive) return "";
  const K = knowsOf(state, f).bases;
  const mine = state.bases.filter((b) => K[b.tile] && K[b.tile].kind === "player");
  const not = state.bases.filter((b) => !mine.includes(b));
  const fakes = Object.entries(K).filter(([t, k]) => k.fake && !state.bases.some((b) => b.tile === Number(t)));
  const how = (k) => (k.via === "radio" ? "heard of it on your radio" : "scouted it");
  const parts = mine.map((b) => { const k = K[b.tile]; return `${b.name} (${how(k)}, day ${k.day}${k.misled ? "; they think it far stronger than it is" : ""})`; });
  let s = mine.length ? `What ${f.name} know of you: ${parts.join("; ")}.` : `${f.name} know of none of your bases.`;
  if (mine.length && not.length) s += ` Nothing of ${not.map((b) => b.name).join(", ")}.`;
  if (fakes.length) s += ` They believe you hold ${fakes.length === 1 ? "an outpost" : "outposts"} at ${fakes.map(([t]) => tileLabel(state, Number(t))).join(", ")} (your decoy).`;
  if (f.lying && f.lying.until >= day(state)) s += ` They have fighters waiting by the road near ${tileLabel(state, f.lying.tile)} for a caravan.`;
  return s;
}

// ---------- daily ----------
export function intelDaily(state) {
  const d = day(state);
  const I = intelOf(state);
  hidingDaily(state); // hiding.js: comings and goings, the groups' hidden outposts you find
  playerAir(state, d);
  for (const g of state.factions) aiListen(state, g, d);
  lyingDaily(state, d);
  for (const k of Object.keys(I.got)) if (d - I.got[k] > INTEL.GOT_DAYS) delete I.got[k];
  I.decoys = I.decoys.filter((x) => d - x.day <= INTEL.DECOY.DISTRUST);
}
// factions.js playerRaidWeight: stores they heard of lately pull a raid.
export function heardPull(state, f, b) {
  const k = f.knows && f.knows.bases[b.tile];
  return k && k.heard != null && day(state) - k.heard <= INTEL.HEARD_DAYS ? INTEL.HEARD_PULL : 1;
}
// factions.js launchRaidOnBase: a base they know only from the radio.
export const knownByRadio = (state, f, b) => { const k = f.knows && f.knows.bases[b.tile]; return !!(k && k.via === "radio"); };
