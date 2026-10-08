// AI blocs: alliances between the groups (user, 2026-10-08: "AI groups can form alliances and declare war on each
// other and you"). They use the systems you use, driven by their type (groupcare.js GROUP_PRIORITIES ally, raid), and
// decide on what they know (groupworld.js f.knows), not on the true state. One pass a day (diplomacy.js
// diplomacyDaily, after relations and pacts), hashed dice only (skills.js hash01): the world's dice are not touched.
//
// Who allies with whom (typesFit): traders, communes and fortresses with each other readily (1), with the military
// (1); the military with the order-keeping types (military, fortress, traders, communes: 1; expansionists 0.3);
// expansionists with expansionists (0.7), fortresses and traders (0.35), communes (0.2); raiders only with raiders
// (0.8: loose gangs); zealots only with zealots (0.8). Never across those lines.
// Forming (BLOC.FORM a day × fit × √(ally a × ally b)): two groups outside any bloc and outside your coalition, with
// relations at least blocRel by type (GROUP_PRIORITIES; the higher of the two: communes and traders 18, fortress 22, military 25,
// expansionists 28, zealots 12, raiders −26), nearest bases within BLOC.RANGE tiles, not at war with each other, and a
// shared threat (sharedThreat, read from their knowledge): a common war enemy; you (both at war with you, or both
// hostile to you (goodwill PLAYER_FOE_GW or worse) and both knowing a base of yours, or the coalition holding
// COALITION_LAND of the state with neither in it and neither friendly: a bloc against the Calder Coalition); a third
// group both are FOE_REL or worse with and whose base each knows within THREAT_RANGE; raiders: shared prey (a
// peaceful group both know within THREAT_RANGE); order-keeping types: a hive within THREAT_RANGE of both. A group
// outside joins a bloc (BLOC.JOIN a day × ally) that fits every member, likes every member enough and shares its foe;
// at most BLOC.MAX members.
// What members do:
// - Defend each other (blocHelpFor, factions.js resolveRaidOnFaction): a raid on a member draws every other member
//   with a base within HELP_RANGE of the base hit, each sending what it can spare (spareShare: SPARE of its strength,
//   −0.1 a war it is in, less its share of wounded, × its ally weight up to 1; raider gangs half that), at most
//   HELP_CAP × the member's own strength + 4. Held: +2 relations with each helper; broken: a helper may lose one.
//   Your assault on a member's base meets ASSAULT_MAX at most extra fighters from members within ASSAULT_RANGE
//   (conquest.js assaultForce). A coalition at your side does the same for you (blocPlayerHelp).
// - Raid jointly (jointRaid): a war raid (diplomacy.js warRaid), an ordinary raid on a group that is the bloc's foe,
//   or a raid in a war on you (playerwars.js) draws members within JOINT_RANGE that share the foe, JOINT × their raid
//   weight of the time each: JOINT_SHARE of what they can spare joins the party's strength. A failed raid may cost
//   each of them one; a won one +2 relations with the leader.
// - Go to war together (blocWarJoin, from diplomacy.js startWar): the defender's members WAR_JOIN × ally, the
//   attacker's WAR_JOIN_ATT × raid; a member that does not come snubs it (−8 relations).
// - Share intel: every day the members' f.knows are merged (the freshest look at each base wins) and the latest
//   scouting of you.
// - Trade first with each other: groupcare.js hungerTrade buys food from a member first, without the markup; trade
//   convoys (factions.js) go to a member 60% of the time.
// - Grow closer: +COHESION relations a day between members (raider gangs a third of it); −FOE_SOUR a day with the foe.
//   A bloc against the coalition: −COALITION_SOUR a day with every coalition member.
// Breaking:
// - Relations: a pair BREAK under its forming line: the member that likes the others least leaves.
// - Betrayal (betray): a member found out stealing from another (groupworld.js stealFromGroup), or a hungry raider
//   turning on a weaker gang-mate (GANG_BETRAY a day, ×4 when short of food: it raids them): −40 relations with the
//   victim, −15 with the others, out of the bloc.
// - Interests diverge: no shared threat for IDLE days (the danger is past), or a member's bases drift beyond RANGE + 6
//   of every other member's; a member that joins your coalition leaves. Under two members the bloc is gone.
// You and the blocs:
// - A bloc whose foe is hostile to you (or a hive), whose members all know you, none hostile and on average
//   INVITE_GW+ goodwill, asks you to stand with it (INVITE a day, every INVITE_GAP days at most, one of them in radio
//   reach or a base of yours within 8 tiles): yes and its members send fighters against raids on your bases within
//   20 tiles (PLAYER_HELP of their strength each, up to half your defence), +5 goodwill each, and its foe −10; no: −2.
//   You may leave (−8 each). Striking at a member (a raid, theft, an execution of theirs) breaks it (−15 each).
// - A blow against any member (a raid, an assault) costs you a third of it with every other member (they are allies).
// - A bloc against you (foe: you) comes into your wars together (playerwars.js: members join a war declared on you,
//   and one you declare on a member).
// Colours: each bloc a colour (BLOC_COLORS) ringed round its members' bases on the map.
import { day, log, hub, factionById, addCard } from "./world.js";
import { hash01 } from "./skills.js";
import { attitude, changeGoodwill, strength } from "./factions.js";
import { ensureDiplo, relation, changeRelation, warsOf, enemyIn, warBetween, news, knownAs, baseDistance, allyWar, DIPLO } from "./diplomacy.js";
import { weightOf, woundedOf } from "./groupcare.js";
import { knowsOf, knownBase } from "./groupworld.js";
import { isMember, allianceMembers, controlledLand } from "./alliance.js";
import { canRadioGroup } from "./radio.js";
import { spawnAiParty } from "./parties.js";
import { atWarWithYou, pwarOf } from "./playerwars.js";

export const BLOC = {
  REL: 20, // an unknown type's (each type's: groupcare.js GROUP_PRIORITIES blocRel)
  BREAK: 25, FORM: 0.025, JOIN: 0.03, MAX: 4, RANGE: 22, THREAT_RANGE: 18, FOE_REL: -30, IDLE: 45,
  COHESION: 0.4, GANG_COHESION: 0.13, FOE_SOUR: 0.2, COALITION_SOUR: 0.15,
  HELP_RANGE: 16, SPARE: 0.3, HELP_CAP: 1.0, GANG_HELP: 0.5, JOINT_RANGE: 18, JOINT: 0.35, JOINT_SHARE: 0.8,
  WAR_JOIN: 0.6, WAR_JOIN_ATT: 0.35, SNUB: -8, GANG_BETRAY: 0.004, BETRAY_VICTIM: -40, BETRAY_OTHERS: -15,
  PLAYER_FOE_GW: -30, COALITION_LAND: 0.3, INVITE_GW: 35, INVITE: 0.03, INVITE_GAP: 60, LEAVE_GW: -8, ACCEPT_GW: 5, FOE_GW: -10,
  PLAYER_HELP: 0.12, PLAYER_RANGE: 20, STRUCK_GW: -15, BLOW_SHARE: 0.33, ASSAULT_RANGE: 10, ASSAULT_MAX: 4,
};
// Not blue (yours) and not too close to the groups' own colours.
export const BLOC_COLORS = ["#ffd166", "#06d6a0", "#ef476f", "#e9ff70", "#f4a261", "#cdb4db", "#ff99c8", "#fb8500"];
const ORDER = new Set(["military", "fortress", "traders", "commune"]);
const h = (state, ...k) => hash01(state.seed, "blocs", ...k);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const dist = (state, a, b) => state.grid.distance(a, b);

// ---------- state and lookups ----------
// News of the blocs: on the radio (diplomacy.js news) and in the blocs' own record (the Affairs screen, the tools).
function blocNews(state, text, kind, fs) {
  const d = ensureBlocs(state);
  d.blocLog.unshift({ day: day(state), text, heard: canHear(state, fs) });
  if (d.blocLog.length > 40) d.blocLog.length = 40;
  return news(state, text, kind, fs);
}
const canHear = (state, fs) => (fs || []).some((f) => f && f.known);
export function ensureBlocs(state) {
  const d = ensureDiplo(state);
  if (!d.blocs) {
    d.blocs = [];
    d.blocSeq = 1;
    d.blocEnded = [];
    d.blocLog = [];
    d.blocStats = { formed: 0, broken: 0, joined: 0, left: 0, betrayals: 0, helps: 0, joint: 0, warJoins: 0, snubs: 0, invites: 0, withYou: 0, shared: 0 };
  }
  return d;
}
const blocList = (state) => (state.diplo && state.diplo.blocs) || [];
export const blocOf = (state, f) => (f ? blocList(state).find((b) => b.members.includes(f.id)) || null : null);
export const blocById = (state, id) => blocList(state).find((b) => b.id === Number(id)) || null;
export const sameBloc = (state, a, b) => !!a && !!b && a !== b && !!blocOf(state, a) && blocOf(state, a) === blocOf(state, b);
export const blocMembers = (state, bloc) => (bloc ? bloc.members.map((id) => factionById(state, id)).filter((f) => f && f.alive) : []);
export const blocMates = (state, f) => blocMembers(state, blocOf(state, f)).filter((m) => m !== f);
export const blocColorOf = (state, f) => { const b = blocOf(state, f); return b ? b.color : null; };
export const blocTitle = (b) => (b ? `the ${b.name}` : "");
const isGang = (b, state) => blocMembers(state, b).every((m) => m.type === "raider");

// Can these two types ever ally, and how readily (0 = never)?
export function typesFit(a, b) {
  const A = a.type, B = b.type;
  if (A === "raider" || B === "raider") return A === B ? 0.8 : 0;
  if (A === "zealot" || B === "zealot") return A === B ? 0.8 : 0;
  if (A === "military" || B === "military") { const o = A === "military" ? B : A; return ORDER.has(o) ? 1 : o === "expansionist" ? 0.3 : 0; }
  if (A === "expansionist" || B === "expansionist") { const o = A === "expansionist" ? B : A; return o === "expansionist" ? 0.7 : o === "fortress" || o === "traders" ? 0.35 : 0.2; }
  return 1;
}
const relLine = (a, b) => Math.max(weightOf(a, "blocRel", BLOC.REL), weightOf(b, "blocRel", BLOC.REL));
const eligible = (state, f) => f && f.alive && !f.outsider && f.bases.length && !isMember(state, f) && !f.hcNoGrow;

// ---------- threats (read from what they know) ----------
const nearest = (state, f, tile) => (f.bases.length ? Math.min(...f.bases.map((b) => dist(state, b, tile))) : Infinity);
const knowsYou = (state, f) => Object.values(knowsOf(state, f).bases).some((k) => k.kind === "player");
// Do they know a base of c's within reach of their own?
const nearKnown = (state, f, c) => c.bases.some((t) => knownBase(state, f, t) && nearest(state, f, t) <= BLOC.THREAT_RANGE);
function coalitionLooms(state, f) {
  return allianceMembers(state).length > 0 && f.goodwill < 10 && controlledLand(state).pct >= BLOC.COALITION_LAND;
}
// Does the foe threaten this group too?
export function threatApplies(state, f, foe) {
  if (!foe || !f || !f.alive) return false;
  if (foe.kind === "player") return !!hub(state) && (atWarWithYou(state, f) || (f.goodwill <= BLOC.PLAYER_FOE_GW && knowsYou(state, f)) || coalitionLooms(state, f));
  if (foe.kind === "hive") { const hv = (state.hives || []).find((x) => x.id === foe.id); return !!hv && nearest(state, f, hv.tile) <= BLOC.THREAT_RANGE; }
  const c = factionById(state, foe.id);
  if (!c || !c.alive || c === f) return false;
  if (warBetween(state, f, c)) return true;
  if (foe.why === "prey") return f.type === "raider" && nearKnown(state, f, c);
  return relation(state, f, c) <= BLOC.FOE_REL && nearKnown(state, f, c);
}
// The threat two groups share, or null: { kind: "group" | "player" | "hive", id, why }.
export function sharedThreat(state, a, b) {
  for (const w of warsOf(state, a)) {
    const e = enemyIn(w, a);
    if (e !== b.id && warsOf(state, b).some((v) => enemyIn(v, b) === e)) return { kind: "group", id: e, why: "war" };
  }
  if (hub(state)) {
    if (atWarWithYou(state, a) && atWarWithYou(state, b)) return { kind: "player", id: "player", why: "war" };
    if (a.goodwill <= BLOC.PLAYER_FOE_GW && b.goodwill <= BLOC.PLAYER_FOE_GW && knowsYou(state, a) && knowsYou(state, b)) return { kind: "player", id: "player", why: "hostile" };
    if (coalitionLooms(state, a) && coalitionLooms(state, b)) return { kind: "player", id: "player", why: "coalition" };
  }
  let best = null, bw = 0;
  for (const c of state.factions) {
    if (!c.alive || c === a || c === b || c.outsider || !c.bases.length) continue;
    const ra = relation(state, a, c), rb = relation(state, b, c);
    if (ra > BLOC.FOE_REL || rb > BLOC.FOE_REL) continue;
    if (!nearKnown(state, a, c) || !nearKnown(state, b, c)) continue;
    if (-ra - rb > bw) { bw = -ra - rb; best = c; }
  }
  if (best) return { kind: "group", id: best.id, why: "foe" };
  if (a.type === "raider" && b.type === "raider") {
    const prey = state.factions.filter((c) => c.alive && c !== a && c !== b && !c.outsider && (c.type === "traders" || c.type === "commune" || c.type === "fortress") && nearKnown(state, a, c) && nearKnown(state, b, c))
      .sort((x, y) => x.pop - y.pop || x.id - y.id)[0];
    if (prey) return { kind: "group", id: prey.id, why: "prey" };
  }
  if (weightOf(a, "ally") >= 0.9 && weightOf(b, "ally") >= 0.9) {
    const hv = (state.hives || []).find((x) => nearest(state, a, x.tile) <= BLOC.THREAT_RANGE && nearest(state, b, x.tile) <= BLOC.THREAT_RANGE);
    if (hv) return { kind: "hive", id: hv.id, why: "hive" };
  }
  return null;
}
// The bloc's threat today: its foe while two members still share it, else any threat two members share.
function blocThreat(state, bloc) {
  const ms = blocMembers(state, bloc);
  if (bloc.foe && ms.filter((m) => threatApplies(state, m, bloc.foe)).length >= 2) return bloc.foe;
  for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) { const t = sharedThreat(state, ms[i], ms[j]); if (t) return t; }
  return null;
}
export function foeText(state, foe) {
  if (!foe) return "no one in particular";
  if (foe.kind === "player") return foe.why === "coalition" ? "the Calder Coalition" : "you";
  if (foe.kind === "hive") { const hv = (state.hives || []).find((x) => x.id === foe.id); return hv ? hv.name : "a hive"; }
  return knownAs(state, factionById(state, foe.id));
}

// ---------- names ----------
const WORD = { raider: "Syndicate", zealot: "Covenant", military: "Alliance", expansionist: "Compact", fortress: "League", traders: "Concord", commune: "Accord" };
const PLACES = ["Northern", "Southern", "Eastern", "Western", "Central", "Upland", "Lowland", "River", "Highway", "Prairie", "Ridge", "Lakeside"];
function blocName(state, founder, foe) {
  const t = state.tiles[founder.bases[0]];
  const W = state.grid.width || 1, H = state.grid.height || 1;
  const dx = t ? t.x / W - 0.5 : 0, dy = t ? t.y / H - 0.5 : 0;
  const first = dy < -0.17 ? "Northern" : dy > 0.17 ? "Southern" : dx < -0.17 ? "Western" : dx > 0.17 ? "Eastern" : "Central";
  const word = foe && foe.kind === "player" && foe.why === "coalition" ? "Front" : WORD[founder.type] || "League";
  const d = ensureBlocs(state);
  const used = new Set([...d.blocs, ...d.blocEnded].map((b) => b.name));
  for (const p of [first, ...PLACES]) if (!used.has(`${p} ${word}`)) return `${p} ${word}`;
  return `${first} ${word} ${d.blocSeq}`;
}

// ---------- forming, joining, leaving ----------
export function formBloc(state, fs, foe) {
  const d = ensureBlocs(state);
  const bloc = { id: d.blocSeq++, name: "", color: BLOC_COLORS[(d.blocSeq - 2) % BLOC_COLORS.length], members: fs.map((f) => f.id), founded: day(state), foe: foe || null, lastThreat: day(state), player: null, lastInvite: -999, helps: 0, joint: 0 };
  bloc.name = blocName(state, fs[0], foe);
  d.blocs.push(bloc);
  d.blocStats.formed++;
  for (let i = 0; i < fs.length; i++) for (let j = i + 1; j < fs.length; j++) changeRelation(state, fs[i], fs[j], 5);
  const against = foe ? ` against ${foeText(state, foe)}` : "";
  blocNews(state, `${cap(knownAs(state, fs[0]))} and ${knownAs(state, fs[1])} formed ${blocTitle(bloc)}${against}.`, foe && foe.kind === "player" ? "danger" : "info", fs);
  if (foe && foe.kind === "player" && hub(state) && fs.some((f) => f.known)) log(state, `${blocTitle(bloc)[0].toUpperCase() + blocTitle(bloc).slice(1)} stands against ${foe.why === "coalition" ? "your coalition" : "you"}: ${fs.map((f) => knownAs(state, f)).join(" and ")}.`, "danger");
  return bloc;
}
export function joinBloc(state, bloc, f) {
  const d = ensureBlocs(state);
  if (blocOf(state, f) || bloc.members.length >= BLOC.MAX) return false;
  for (const m of blocMembers(state, bloc)) changeRelation(state, m, f, 5);
  bloc.members.push(f.id);
  d.blocStats.joined++;
  blocNews(state, `${cap(knownAs(state, f))} joined ${blocTitle(bloc)}.`, "info", [f, ...blocMembers(state, bloc)]);
  return true;
}
export function leaveBloc(state, f, why = "", quiet = false) {
  const bloc = blocOf(state, f);
  if (!bloc) return false;
  const d = ensureBlocs(state);
  bloc.members = bloc.members.filter((id) => id !== f.id);
  d.blocStats.left++;
  if (!quiet) blocNews(state, `${cap(knownAs(state, f))} left ${blocTitle(bloc)}${why ? ` (${why})` : ""}.`, "info", [f, ...blocMembers(state, bloc)]);
  if (blocMembers(state, bloc).length < 2) dissolve(state, bloc, "", true);
  return true;
}
function dissolve(state, bloc, why, quiet = false) {
  const d = ensureBlocs(state);
  const i = d.blocs.indexOf(bloc);
  if (i < 0) return;
  const ms = blocMembers(state, bloc);
  d.blocs.splice(i, 1);
  d.blocStats.broken++;
  d.blocEnded.unshift({ id: bloc.id, name: bloc.name, color: bloc.color, founded: bloc.founded, ended: day(state), why: why || "too few members" });
  if (d.blocEnded.length > 20) d.blocEnded.length = 20;
  if (bloc.player && hub(state)) log(state, `${cap(blocTitle(bloc))} is no more: your place at its side ends with it.`, "info");
  blocNews(state, `${cap(blocTitle(bloc))} has broken up${why ? `: ${why}` : ""}.`, "info", ms);
}
// A member turns on another: out of the bloc, and nobody there forgets it. raid: it hits the victim's base as well.
export function betray(state, f, victim, why = "betrayal", raid = false) {
  const bloc = blocOf(state, f);
  if (!bloc || !bloc.members.includes(victim.id)) return false;
  const d = ensureBlocs(state);
  const others = blocMembers(state, bloc).filter((m) => m !== f && m !== victim);
  changeRelation(state, f, victim, BLOC.BETRAY_VICTIM);
  for (const m of others) changeRelation(state, f, m, BLOC.BETRAY_OTHERS);
  d.blocStats.betrayals++;
  bloc.members = bloc.members.filter((id) => id !== f.id);
  blocNews(state, `${cap(knownAs(state, f))} betrayed ${knownAs(state, victim)} (${why}) and is out of ${blocTitle(bloc)}.`, "danger", [f, victim]);
  if (raid && f.bases.length && victim.bases.length) {
    const tile = victim.bases.slice().sort((a, b) => nearest(state, f, a) - nearest(state, f, b) || a - b)[0];
    spawnAiParty(state, f, "raid", f.bases[0], tile, { strength: Math.max(4, strength(f) * 0.35), target: { kind: "faction", factionId: victim.id, tile } });
  }
  if (blocMembers(state, bloc).length < 2) dissolve(state, bloc, `${knownAs(state, f)} turned on ${knownAs(state, victim)}`);
  return true;
}

// ---------- the daily pass ----------
export function blocsDaily(state) {
  const d = ensureBlocs(state);
  const today = day(state);
  for (const bloc of [...d.blocs]) {
    if (!d.blocs.includes(bloc)) continue;
    // The dead, those gone into your coalition.
    for (const id of [...bloc.members]) {
      const f = factionById(state, id);
      if (!f || !f.alive) bloc.members = bloc.members.filter((x) => x !== id);
      else if (isMember(state, f)) leaveBloc(state, f, "it joined your coalition");
      if (!d.blocs.includes(bloc)) break;
    }
    if (!d.blocs.includes(bloc)) continue;
    let ms = blocMembers(state, bloc);
    if (ms.length < 2) { dissolve(state, bloc, "too few members are left"); continue; }
    // A pair that has fallen out: the one that likes the others least goes.
    const sour = [];
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) if (relation(state, ms[i], ms[j]) < relLine(ms[i], ms[j]) - BLOC.BREAK) sour.push([ms[i], ms[j]]);
    if (sour.length) {
      const like = (f) => ms.filter((m) => m !== f).reduce((a, m) => a + relation(state, f, m), 0);
      const [x, y] = sour[0];
      leaveBloc(state, like(x) <= like(y) ? x : y, "a falling-out");
      if (!d.blocs.includes(bloc)) continue;
      ms = blocMembers(state, bloc);
    }
    // Drifted apart: a member far from every other member.
    const far = ms.find((m) => ms.every((o) => o === m || baseDistance(state, m, o) > BLOC.RANGE + 6));
    if (far) { leaveBloc(state, far, "its land lies too far from the others"); if (!d.blocs.includes(bloc)) continue; ms = blocMembers(state, bloc); }
    // The threat that holds them together.
    const t = blocThreat(state, bloc);
    if (t) { bloc.foe = t; bloc.lastThreat = today; }
    else if (today - (bloc.lastThreat ?? bloc.founded) >= BLOC.IDLE) { dissolve(state, bloc, "with the danger past, its members went their own ways"); continue; }
    // Closer to each other, colder to the foe.
    const gang = isGang(bloc, state);
    for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) changeRelation(state, ms[i], ms[j], gang ? BLOC.GANG_COHESION : BLOC.COHESION);
    if (bloc.foe && bloc.foe.kind === "group") { const c = factionById(state, bloc.foe.id); if (c && c.alive) for (const m of ms) changeRelation(state, m, c, -BLOC.FOE_SOUR); }
    if (bloc.foe && bloc.foe.kind === "player") for (const c of allianceMembers(state)) for (const m of ms) changeRelation(state, m, c, -BLOC.COALITION_SOUR);
    shareIntel(state, ms);
    // A hungry raider turns on a weaker gang-mate.
    if (gang) for (const f of ms) {
      const hungry = (f.stock.food || 0) < f.pop * 2;
      const prey = ms.filter((m) => m !== f && strength(m) < strength(f)).sort((a, b) => strength(a) - strength(b) || a.id - b.id)[0];
      if (!prey || f.pop < 8 || h(state, f.name, today, "betray") >= BLOC.GANG_BETRAY * (hungry ? 4 : 1)) continue;
      betray(state, f, prey, hungry ? "short of food, it raided its own" : "it wanted what they had", true);
      break;
    }
    if (!d.blocs.includes(bloc)) continue;
    inviteYou(state, bloc, today);
  }
  formAndJoin(state, today);
}

function formAndJoin(state, today) {
  const d = ensureBlocs(state);
  const live = state.factions.filter((f) => eligible(state, f));
  // Joining a bloc already standing.
  for (const f of live) {
    if (blocOf(state, f)) continue;
    for (const bloc of d.blocs) {
      const ms = blocMembers(state, bloc);
      if (ms.length >= BLOC.MAX || !ms.length) continue;
      if (ms.some((m) => !typesFit(f, m) || relation(state, f, m) < relLine(f, m) || warBetween(state, f, m))) continue;
      if (!ms.some((m) => baseDistance(state, f, m) <= BLOC.RANGE)) continue;
      if (!threatApplies(state, f, bloc.foe)) continue;
      if (h(state, f.name, bloc.name, today, "join") >= BLOC.JOIN * weightOf(f, "ally")) continue;
      joinBloc(state, bloc, f);
      break;
    }
  }
  // Two groups outside any bloc.
  for (let i = 0; i < live.length; i++) {
    const a = live[i];
    if (blocOf(state, a)) continue;
    for (let j = i + 1; j < live.length; j++) {
      const b = live[j];
      if (blocOf(state, b) || blocOf(state, a)) continue;
      const fit = typesFit(a, b);
      if (!fit || relation(state, a, b) < relLine(a, b) || baseDistance(state, a, b) > BLOC.RANGE || warBetween(state, a, b)) continue;
      if (h(state, a.name, b.name, today, "form") >= BLOC.FORM * fit * Math.sqrt(weightOf(a, "ally") * weightOf(b, "ally"))) continue;
      const t = sharedThreat(state, a, b);
      if (!t) continue;
      formBloc(state, [a, b], t);
    }
  }
}

// Every member knows what any of them knows (the freshest look at each base), and the latest scouting of you.
export function shareIntel(state, ms) {
  if (ms.length < 2) return 0;
  const best = {};
  let scouted = null;
  for (const m of ms) {
    for (const [t, k] of Object.entries(knowsOf(state, m).bases)) if (!best[t] || k.day > best[t].day) best[t] = k;
    if (m.scoutedYou != null && (scouted == null || m.scoutedYou > scouted)) scouted = m.scoutedYou;
  }
  let n = 0;
  for (const m of ms) {
    const K = knowsOf(state, m).bases;
    for (const [t, k] of Object.entries(best)) {
      if (m.bases.includes(Number(t)) || (k.kind === "group" && k.id === m.id)) continue; // their own base
      if (!K[t] || K[t].day < k.day) { K[t] = { ...k }; n++; }
    }
    if (scouted != null && (m.scoutedYou == null || m.scoutedYou < scouted)) m.scoutedYou = scouted;
  }
  if (n) ensureBlocs(state).blocStats.shared += n;
  return n;
}

// ---------- help, joint raids, wars ----------
// What a member can spare for another's fight: a share of its strength (see the header).
export function spareShare(state, m, bloc = blocOf(state, m)) {
  const wars = warsOf(state, m).length + (atWarWithYou(state, m) ? 1 : 0);
  const hurt = woundedOf(m) / Math.max(1, m.pop);
  const gang = bloc && isGang(bloc, state) ? BLOC.GANG_HELP : 1;
  return Math.max(0, BLOC.SPARE - 0.1 * wars - hurt) * Math.min(1, weightOf(m, "ally") + 0.2) * gang;
}
// What the whole bloc could send a member (diplomacy.js declareWars weighs it).
export function blocSpare(state, f) {
  const b = blocOf(state, f);
  if (!b) return 0;
  return blocMates(state, f).reduce((a, m) => a + strength(m) * spareShare(state, m, b), 0);
}
// A raid on a member's base at this tile: { power, helpers }.
export function blocHelpFor(state, target, tile, attacker = null) {
  const b = blocOf(state, target);
  if (!b || state.noBlocs) return { power: 0, helpers: [] };
  const helpers = [];
  let power = 0;
  for (const m of blocMembers(state, b)) {
    if (m === target || m === attacker || m.pop < 8 || nearest(state, m, tile) > BLOC.HELP_RANGE) continue;
    const p = strength(m) * spareShare(state, m, b);
    if (p < 1) continue;
    helpers.push(m);
    power += p;
  }
  power = Math.min(power, strength(target) * BLOC.HELP_CAP + 4);
  if (helpers.length) { ensureBlocs(state).blocStats.helps++; b.helps = (b.helps || 0) + 1; }
  return { power, helpers };
}
// After the fight: thanks when it held; a helper may lose one when it did not.
export function blocHelpAfter(state, help, held, target) {
  if (!help || !help.helpers.length) return;
  for (const m of help.helpers) {
    if (held) changeRelation(state, m, target, 2);
    else if (m.pop > 4 && h(state, m.name, target.name, state.hour, "hloss") < 0.4) m.pop -= 1;
  }
  if (target.known || help.helpers.some((m) => m.known)) {
    const names = help.helpers.map((m) => knownAs(state, m)).join(" and ");
    blocNews(state, `${cap(names)} came to the aid of ${knownAs(state, target)}, ${blocTitle(blocOf(state, target)) || "their ally"}${held ? ": the raid was beaten off" : ", but the raiders got in"}.`, held ? "good" : "info", [target, ...help.helpers]);
  }
}
// Members who march with a raid of f's on this tile against foeRef ({ kind: "group", id } or { kind: "player" }):
// { power, ids } or null.
export function jointRaid(state, f, tile, foeRef) {
  const b = blocOf(state, f);
  if (!b || state.noBlocs) return null;
  const ids = [];
  let power = 0;
  const today = day(state);
  for (const m of blocMembers(state, b)) {
    if (m === f || m.pop < 8 || nearest(state, m, tile) > BLOC.JOINT_RANGE) continue;
    const shares = foeRef.kind === "player" ? (pwarOf(state, m) && pwarOf(state, m) === pwarOf(state, f)) : threatApplies(state, m, { kind: "group", id: foeRef.id, why: "foe" });
    if (!shares) continue;
    if (h(state, m.name, f.name, today, state.hour, "joint") >= BLOC.JOINT * weightOf(m, "raid")) continue;
    const p = strength(m) * spareShare(state, m, b) * BLOC.JOINT_SHARE;
    if (p < 1) continue;
    ids.push(m.id);
    power += p;
  }
  if (!ids.length) return null;
  ensureBlocs(state).blocStats.joint++;
  b.joint = (b.joint || 0) + 1;
  return { power, ids };
}
// After a joint raid: won (the raiders got in) or not.
export function jointAfter(state, party, won) {
  if (!party || !party.joint || !party.joint.length) return;
  const lead = factionById(state, party.owner);
  for (const id of party.joint) {
    const m = factionById(state, id);
    if (!m || !m.alive) continue;
    if (won) { if (lead) changeRelation(state, m, lead, 2); }
    else if (m.pop > 4 && h(state, m.name, party.id % 997, "jloss") < 0.5) m.pop -= 1;
  }
}
// diplomacy.js startWar: a war on a member brings the bloc in.
export function blocWarJoin(state, w, a, b) {
  if (state.noBlocs || !state.diplo || !state.diplo.blocs) return;
  const d = ensureBlocs(state);
  const today = day(state);
  const room = () => state.diplo.wars.length < DIPLO.MAX_WARS + 2;
  const busy = (m) => state.diplo.wars.filter((x) => x.a === m.id || x.b === m.id).length >= 2;
  for (const [side, foe, odds, wt] of [[b, a, BLOC.WAR_JOIN, "ally"], [a, b, BLOC.WAR_JOIN_ATT, "raid"]]) {
    for (const m of blocMates(state, side)) {
      if (m === foe || warBetween(state, m, foe) || busy(m) || !room() || sameBloc(state, m, foe)) continue;
      if (h(state, m.name, foe.name, today, "warjoin") < odds * Math.min(1, weightOf(m, wt) + 0.3)) {
        allyWar(state, m, foe, "bloc");
        d.blocStats.warJoins++;
        blocNews(state, `${cap(knownAs(state, m))} stands by ${knownAs(state, side)}, ${blocTitle(blocOf(state, m))}: it is at war with ${knownAs(state, foe)} too.`, "danger", [m, side, foe]);
      } else if (side === b) {
        changeRelation(state, m, side, BLOC.SNUB); // it did not come
        d.blocStats.snubs++;
      }
    }
  }
}
// conquest.js assaultForce: fighters from the member's bloc at its walls (members within ASSAULT_RANGE, 1 per 10 of
// what they can spare, at most ASSAULT_MAX in all). { fighters, names }.
export function blocAssaultHelp(state, f, tile) {
  const b = blocOf(state, f);
  const out = { fighters: 0, names: [] };
  if (!b || state.noBlocs) return out;
  for (const m of blocMates(state, f)) {
    if (m.pop < 8 || nearest(state, m, tile) > BLOC.ASSAULT_RANGE) continue;
    const n = Math.round((m.pop * spareShare(state, m, b)) / 3);
    if (n < 1) continue;
    out.fighters += n;
    out.names.push(m.name);
  }
  out.fighters = Math.min(BLOC.ASSAULT_MAX, out.fighters);
  return out;
}

// ---------- you and the blocs ----------
// A bloc's members at your side: fighters against a raid on your base (factions.js resolveRaidOnPlayer).
export function blocPlayerHelp(state, base, attacker, own) {
  const out = { power: 0, names: [] };
  if (state.noBlocs) return out;
  for (const b of blocList(state)) {
    if (!b.player) continue;
    for (const m of blocMembers(state, b)) {
      if (m === attacker || m.pop < 8 || nearest(state, m, base.tile) > BLOC.PLAYER_RANGE) continue;
      out.power += strength(m) * BLOC.PLAYER_HELP;
      out.names.push(m.name);
    }
  }
  out.power = Math.min(out.power, Math.max(own, 10) * 0.5);
  return out;
}
function inviteYou(state, bloc, today) {
  if (bloc.player || !hub(state) || !bloc.foe || bloc.foe.kind === "player") return;
  if (today - (bloc.lastInvite ?? -999) < BLOC.INVITE_GAP) return;
  const ms = blocMembers(state, bloc);
  if (!ms.length || ms.some((m) => !m.known || attitude(m) === "Hostile" || atWarWithYou(state, m))) return;
  if (ms.reduce((a, m) => a + m.goodwill, 0) / ms.length < BLOC.INVITE_GW) return;
  if (bloc.foe.kind === "group") { const c = factionById(state, bloc.foe.id); if (!c || !c.alive || (attitude(c) !== "Hostile" && !atWarWithYou(state, c))) return; }
  const g = state.grid;
  if (!ms.some((m) => canRadioGroup(state, m) || state.bases.some((b) => m.bases.some((x) => g.distance(x, b.tile) <= 8)))) return;
  if (state.cards.some((c) => c.blocInvite === bloc.id)) return;
  if (h(state, bloc.name, today, "invite") >= BLOC.INVITE) return;
  bloc.lastInvite = today;
  ensureBlocs(state).blocStats.invites++;
  addCard(state, blocInviteCard(state, bloc));
}
export function blocInviteCard(state, bloc) {
  const ms = blocMembers(state, bloc);
  const foe = foeText(state, bloc.foe);
  return {
    title: `${cap(blocTitle(bloc))} asks you to stand with them`, blocInvite: bloc.id,
    text: `${ms.map((m) => m.name).join(" and ")} have joined in ${blocTitle(bloc)} against ${foe}. They ask you to stand with them: their fighters would come to your bases when raiders do (those within ${BLOC.PLAYER_RANGE} tiles), and ${foe} would count you among its enemies.`,
    choices: [
      { label: `Stand with ${blocTitle(bloc)}`, hint: `+${BLOC.ACCEPT_GW} goodwill with each member; their fighters help defend your bases; ${foe} −${-BLOC.FOE_GW} goodwill. Striking at a member later breaks it (−${-BLOC.STRUCK_GW} each)`,
        ai: (st) => (st.governor && st.governor.personality === "cautious" ? 0.5 : 2), resolve: (st) => standWithBloc(st, bloc.id) },
      { label: "Not now", hint: "−2 goodwill with each member", ai: () => 0, resolve: (st) => { for (const m of blocMembers(st, bloc)) changeGoodwill(st, m, -2, "you would not stand with them"); return `You keep out of ${blocTitle(bloc)}.`; } },
    ],
  };
}
export function standWithBloc(state, id) {
  const b = blocById(state, id);
  if (!b) return "That bloc is gone.";
  if (b.player) return "You already stand with them.";
  b.player = { since: day(state) };
  ensureBlocs(state).blocStats.withYou++;
  for (const m of blocMembers(state, b)) { changeGoodwill(state, m, BLOC.ACCEPT_GW, "you stand with their bloc"); m.lastDiplomacy = day(state); }
  if (b.foe && b.foe.kind === "group") { const c = factionById(state, b.foe.id); if (c && c.alive) changeGoodwill(state, c, BLOC.FOE_GW, `you stand with ${blocTitle(b)} against them`); }
  log(state, `You stand with ${blocTitle(b)}.`, "good");
  return `You stand with ${blocTitle(b)}: their fighters will come when your bases near them are raided.`;
}
export function leaveBlocSide(state, id) {
  const b = blocById(state, id);
  if (!b || !b.player) return "You are not at their side.";
  b.player = null;
  for (const m of blocMembers(state, b)) changeGoodwill(state, m, BLOC.LEAVE_GW, "you left their bloc");
  return `You leave ${blocTitle(b)}'s side.`;
}
// playerwars.js noteGrievance: you struck at a member (a raid, theft, an execution of theirs). amount < 0.
export function playerStruck(state, f, amount) {
  const b = blocOf(state, f);
  if (!b || state.noBlocs) return;
  if (b.player) {
    b.player = null;
    for (const m of blocMembers(state, b)) changeGoodwill(state, m, BLOC.STRUCK_GW, "you turned on their bloc");
    log(state, `You struck at ${f.name}: ${blocTitle(b)} counts you as a friend no longer.`, "danger");
    return;
  }
  if (amount > -10) return;
  for (const m of blocMates(state, f)) changeGoodwill(state, m, Math.round(amount * BLOC.BLOW_SHARE), "your blow against their ally");
}
