// Wars with you: a group (with its bloc) declares war on you with a war goal, or you declare war on a group; raids
// come oftener and harder, sieges at the base they want, your caravans and teams are hunted near their land; peace
// comes on terms (offered by radio or an envoy, taken or refused by type) or when a side is worn out. Until now a
// group simply turned hostile and raided; that stays as it was, and a war is the formal, harder step beyond it (user,
// 2026-10-08: raids and wars should force impactful decisions without overwhelming). Decisions read what the group
// knows (groupworld.js f.knows) and its type (groupcare.js GROUP_PRIORITIES warlike, peaceful, raid, expand). Dice are
// hashed (skills.js hash01) except the raids' own sizing (factions.js raidSize).
//
// Grievances (f.griev: raid, theft, execution, prisoners, growth, arms): every loss of goodwill you cause is filed by
// its reason (factions.js changeGoodwill → noteGrievance): your raids and assaults on them, theft, executions of their
// people, holding their people, your bases spreading toward their land, arming their enemies. They fade 1% a day; a
// peace settles 60% of them. Their prisoners in your jails count 8 each, your bases they know within LAND_NEAR tiles 10.
// Declaring (once a day, a group at a time): from day FROM, with no other war declared on you and GAP days since the
// last one began; a group not in your coalition, no pact with you, not under a ceasefire with you or COOLDOWN days from
// its last war with you, hostile (goodwill GW or worse; a peaceful type also needs PEACEFUL_GRIEV of grievance), with
// MIN_FIT fit people, knowing a base of yours within RANGE tiles and strong enough for it by what it knows (its strength
// and what its bloc could spare ≥ the era's raid preparation × the defence it last saw there). The chance a day: BASE ×
// warlike × (1 + grievance / 40) × 1.4 when its spies saw rich stores × 1.3 when it is hungry.
// The war goal (warGoalFor, the highest score): revenge (raids + 1.5 × executions + prisoners + half the theft),
// loot (rich stores seen 20, or 10 at half RICH; hungry 12; half the theft; 8 × raid), territory (an outpost of yours
// within LAND_NEAR of their land: 15 + growth + 8 × expand: that base is its target), conversion (zealots: 30), or
// eliminating a rival (expansionists and the military: 40 × the coalition's share of the land, +10 when you are
// stronger). The casus belli: their biggest grievance (8+), else the goal's own reason (a spy report of rich stores,
// your growth, the faith, your power).
// Allies: members of its bloc who share it (at war with you or hostile, not your coalition) come in with it.
// During a war: every belligerent stays hostile (goodwill −45 at most) and pactless; a war raid of theirs sets out
// every RAID_GAP days (one out at a time; not held back by the eras' pace of raids, but it pushes that pace back for
// everyone else), sized like any raid on what they know and joined by bloc members (blocs.js jointRaid); one on the
// base they want is a siege (SIEGE_HOURS at the walls instead of 8, prepared with ladders, a ram, explosives they hold).
// Your caravans near their land are robbed CARAVAN × as often (caravanraids.js, peaceful types too), and their patrols
// meet your teams TEAM × as often within TEAM_RANGE tiles (conflicts.js). Desertion pressure as in a war between groups.
// Score: a raid of theirs held +2 you, broken in +2 them, overrun +3, a base taken +5 (the base they wanted: their goal
// met); a base of theirs you take +4 you.
// Weariness (exh, 0–100+): theirs EXH_DAY a day (+EXH_HUNGRY short of food, half that short of ammo), + EXH_LOSS × the
// share of their people lost, + EXH_DESERT a deserter, + EXH_HELD a raid of theirs you held, + EXH_BASE a base you took,
// all × (0.6 + 0.4 × peaceful); yours YOU_DAY a day, + YOU_DEATH a death among your people, + YOU_BASE a base lost,
// + YOU_BROKEN a break-in.
// Peace: every OFFER_GAP days (from OFFER_FROM) they send word (by radio when you are in reach, else an envoy): worn out
// (TIRED+) and not ahead by more than 3, they sue for peace (a ceasefire, your captives back, tribute to you when you
// lead by LEAD); ahead by LEAD, their goal met or you worn out, they offer peace on their terms (demandTerms by goal:
// loot: TRIBUTE + 5% of the hub's food, ammo, meds and scrap; territory: the base they want; revenge: their prisoners
// back and half the tribute; conversion: a tithe of 15% of the hub's food and one of your people (the least content)
// goes over to them; a rival: your outpost nearest them and three quarters of the tribute). You can offer terms any
// time (once every TALK_GAP days): a ceasefire, tribute, their prisoners back, an outpost, their own demand, or demand
// tribute or a base of theirs; they take it by termsChance (no dice shown wrong: the number is the chance). Worn out
// past BROKEN (or down to 6 people) they withdraw; after LONG days LONG_PEACE a day ends it in a white peace.
// After a peace: CEASEFIRE days of no raids from them, goodwill at least PEACE_GW (aggressive types drift back toward
// hostility as a tribute fades: factions.js boughtGw), COOLDOWN days before they may declare again.
// You declaring war (declareByPlayer, the group's card): goal tribute, land (a base of theirs) or to break them; the
// group turns hostile (−60), its pact and trade route go, its bloc comes in on its side, groups friendly with it −4,
// infamy +INFAMY unless it was a hostile aggressive group. The same weariness and terms; they sue when worn out.
import { day, log, hub, factionById, addCard, alive, atBase, supplyValue, playerStrength, baseById, checkGameOver } from "./world.js";
import { SUPPLIES } from "./data.js";
import { hash01 } from "./skills.js";
import { attitude, changeGoodwill, strength, isAggressiveType, launchRaidOnBase, playerRaidWeight, nearestOwnBase, RAIDS } from "./factions.js";
import { noteStrife, SPLINTER } from "./splinters.js"; // a war on you they lost stirs strife (splinter bands)
import { ensureDiplo, knownAs, relation, DIPLO } from "./diplomacy.js";
import { weightOf, fitPeople } from "./groupcare.js";
import { knowsOf } from "./groupworld.js";
import { blocOf, blocMates, blocSpare, threatApplies, jointRaid, playerStruck, blocTitle } from "./blocs.js";
import { isMember, controlledLand } from "./alliance.js";
import { prisonersOf, tradeBack } from "./prisoners.js";
import { captivesOf } from "./conflicts.js";
import { captureBase, occupyPlayerBase, ensureConquest, CONQUEST } from "./conquest.js";
import { canRadioGroup } from "./radio.js";
import { raidPrep } from "./eras.js";
import { hcGroupRaidsQuiet } from "./hardcore-groups.js";
import { tileLabel } from "./parties.js";
import { keyWord } from "./water.js";

export const PW = {
  FROM: 40, GAP: 80, MAX: 1, COOLDOWN: 120, RANGE: 30, GW: -40, PEACEFUL_GRIEV: 25, BASE: 0.015, MIN_FIT: 10,
  RICH: 1500, LAND_NEAR: 9, GRIEV_FADE: 0.99, GRIEV_MAX: 200, PRISONER: 8, NEAR_BASE: 10, SETTLE: 0.4,
  RAID_GAP: [9, 15], FIRST_RAID: [2, 6], SIEGE_HOURS: 12, ALLY_RAID: 0.35, TEAM: 1.6, TEAM_RANGE: 7, CARAVAN: 2, CARAVAN_RANGE: 2,
  OFFER_FROM: 10, OFFER_GAP: 10, TALK_GAP: 5, TIRED: 45, BROKEN: 85, LEAD: 5, LONG: 100, LONG_PEACE: 0.04,
  EXH_DAY: 0.3, EXH_HUNGRY: 0.3, EXH_LOSS: 80, EXH_DESERT: 3, EXH_HELD: 6, EXH_BASE: 12,
  YOU_DAY: 0.25, YOU_DEATH: 4, YOU_BASE: 12, YOU_BROKEN: 5,
  CEASEFIRE: 60, WHITE_CEASEFIRE: 40, TRIBUTE: 0.2, THEIR_TRIBUTE: 0.2, TITHE: 0.15, PEACE_GW: -30, HOSTILE_GW: -45, DECLARE_GW: -50, YOU_DECLARE_GW: -60,
  INFAMY: 8, FRIENDS_GW: -4, CEDE_VALUE: 400, CONVERT_VALUE: 150,
};
export const GRIEVANCES = ["raid", "execution", "prisoners", "theft", "growth", "arms"];
// A reason for lost goodwill → its grievance (the first that matches; "word of …" is news of what you did to others).
const GRIEV_RE = [
  ["execution", /execut|mistreat/i],
  ["prisoners", /hold their people|held their people|for ransom/i],
  ["theft", /\brob|stole|steal|theft/i],
  ["raid", /raid|attack|storm|broke into|broke out|fired on|beat off|ambush/i],
  ["growth", /expansion near/i],
  ["arms", /arm(ed)? their enem|war against them/i],
];
const h = (state, ...k) => hash01(state.seed, "pwars", ...k);
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const nearest = (state, f, tile) => (f.bases.length ? Math.min(...f.bases.map((b) => state.grid.distance(b, tile))) : Infinity);

// ---------- state and lookups ----------
export function ensurePwars(state) {
  const d = ensureDiplo(state);
  if (!d.pwars) {
    d.pwars = [];
    d.pwarSeq = 1;
    d.pwarEnded = [];
    d.ceasefire = {};
    d.pwarPeace = {};
    d.lastPwar = null;
    d.pwarStats = { declared: 0, byYou: 0, peace: 0, terms: 0, weary: 0, white: 0, gone: 0, raids: 0, sieges: 0, held: 0, broken: 0, basesLost: 0, basesTaken: 0, offers: 0, accepted: 0, refused: 0, gaveIn: 0 };
  }
  return d;
}
const pwarList = (state) => (state.diplo && state.diplo.pwars) || [];
export const pwarById = (state, id) => pwarList(state).find((w) => w.id === Number(id)) || null;
// The war f is in with you (as the main enemy or an ally of it), or null.
export const pwarOf = (state, f) => (f ? pwarList(state).find((w) => w.fid === f.id || w.allies.includes(f.id)) || null : null);
export const atWarWithYou = (state, f) => !!pwarOf(state, f);
export const pwarEnemies = (state) => pwarList(state).flatMap((w) => [w.fid, ...w.allies]).map((id) => factionById(state, id)).filter((f) => f && f.alive);
export const ceasefireWith = (state, f) => !!f && !!state.diplo && !!state.diplo.ceasefire && (state.diplo.ceasefire[f.id] ?? -1) >= day(state);
export const ceasefireUntil = (state, f) => (state.diplo && state.diplo.ceasefire ? state.diplo.ceasefire[f.id] ?? null : null);
const belligerents = (state, w) => [w.fid, ...w.allies].map((id) => factionById(state, id)).filter((f) => f && f.alive);
const mainOf = (state, w) => factionById(state, w.fid);

// ---------- grievances ----------
// factions.js changeGoodwill: you cost them goodwill for this reason.
export function noteGrievance(state, f, amount, reason) {
  if (!f || !(amount < 0) || !reason || /^word of/i.test(reason)) return;
  const m = GRIEV_RE.find(([, re]) => re.test(reason));
  if (!m) return;
  const g = f.griev || (f.griev = {});
  g[m[0]] = Math.min(PW.GRIEV_MAX, (g[m[0]] || 0) - amount);
  if (m[0] === "raid" || m[0] === "theft" || m[0] === "execution") playerStruck(state, f, amount); // blocs.js: their allies feel it
}
// Their prisoners in your jails.
export const theirPrisoners = (state, f) => prisonersOf(state).filter((p) => p.factionId === f.id && p.at && p.at.kind === "base");
// Your bases they know within LAND_NEAR tiles of theirs.
function knownNear(state, f) {
  return Object.entries(knowsOf(state, f).bases).filter(([t, k]) => k.kind === "player" && state.bases.some((b) => b.tile === Number(t)) && nearest(state, f, Number(t)) <= PW.LAND_NEAR).map(([t]) => Number(t));
}
// Every grievance with today's prisoners and nearby bases counted in: { raid, …, total }.
export function grievanceOf(state, f) {
  const g = { ...(f.griev || {}) };
  for (const k of GRIEVANCES) g[k] = g[k] || 0;
  g.prisoners += PW.PRISONER * Math.max(theirPrisoners(state, f).length, f.prisonersHeld || 0);
  g.growth += PW.NEAR_BASE * knownNear(state, f).length;
  g.total = GRIEVANCES.reduce((a, k) => a + g[k], 0);
  return g;
}

// ---------- the war goal and its reason ----------
const baseAt = (state, tile) => state.bases.find((b) => b.tile === tile) || null;
// Your outpost nearest their land (not the hub), or null.
function outpostNearest(state, f) {
  return state.bases.filter((b) => b.type !== "hub").sort((a, b) => nearest(state, f, a.tile) - nearest(state, f, b.tile) || a.id - b.id)[0] || null;
}
// Their base nearest your hub that is not their last one (what they could cede), or null.
function theirBaseNearest(state, f) {
  if (f.bases.length < 2) return null;
  const hb = hub(state);
  const ref = hb ? hb.tile : f.bases[0];
  return f.bases.slice(1).sort((a, b) => state.grid.distance(a, ref) - state.grid.distance(b, ref) || a - b)[0] ?? null;
}
export function warGoalFor(state, f) {
  const g = grievanceOf(state, f);
  const mine = Object.entries(knowsOf(state, f).bases).filter(([t, k]) => k.kind === "player" && baseAt(state, Number(t))).map(([t, k]) => ({ tile: Number(t), k, base: baseAt(state, Number(t)) }));
  const rich = mine.slice().sort((a, b) => (b.k.value || 0) - (a.k.value || 0) || a.tile - b.tile)[0] || null;
  const richV = rich ? rich.k.value || 0 : 0;
  const near = mine.filter((x) => x.base.type !== "hub" && nearest(state, f, x.tile) <= PW.LAND_NEAR).sort((a, b) => nearest(state, f, a.tile) - nearest(state, f, b.tile) || a.tile - b.tile)[0] || null;
  const hungry = (f.stock.food || 0) < f.pop * 3;
  const land = controlledLand(state).pct;
  const scores = {
    revenge: g.raid + 1.5 * g.execution + g.prisoners + 0.5 * g.theft,
    loot: (richV >= PW.RICH ? 20 : richV >= PW.RICH / 2 ? 10 : 0) + (hungry ? 12 : 0) + 0.5 * g.theft + 8 * weightOf(f, "raid"),
    territory: near ? 15 + g.growth + 8 * weightOf(f, "expand") : 0,
    conversion: weightOf(f, "cbConversion", 0), // groupcare.js GROUP_PRIORITIES: zealots
    rival: weightOf(f, "cbRival", 0) ? weightOf(f, "cbRival", 0) * land + (playerStrength(state) > strength(f) ? 10 : 0) : 0, // expansionists, the military
  };
  const goal = Object.keys(scores).reduce((a, b) => (scores[b] > scores[a] ? b : a));
  const top = GRIEVANCES.filter((k) => g[k] >= 8).sort((a, b) => g[b] - g[a])[0];
  const cb = top || (goal === "loot" ? (richV >= PW.RICH / 2 ? "rich" : "hunger") : goal === "territory" ? "growth" : goal === "conversion" ? "faith" : goal === "rival" ? "rival" : "hate");
  return { goal, cb, target: goal === "territory" && near ? near.tile : null, richTile: rich ? rich.tile : null, scores, grievance: g };
}
const baseName = (state, tile) => { const b = baseAt(state, tile); return b ? b.name : tile != null ? tileLabel(state, tile) : "your base"; };
export function goalText(state, w) {
  switch (w.goal) {
    case "loot": return "plunder: your stores";
    case "territory": return `to take ${baseName(state, w.target)}`;
    case "revenge": return "revenge";
    case "conversion": return "to convert your people to their faith";
    case "rival": return "to break you as a rival";
    case "tribute": return "tribute from them";
    case "land": return "a base of theirs";
    case "break": return "to break them";
  }
  return w.goal;
}
export function cbText(state, w) {
  switch (w.cb) {
    case "raid": return "your raids on them";
    case "execution": return "the executions of their people";
    case "prisoners": return "the people of theirs you hold";
    case "theft": return "what you stole from them";
    case "growth": return "your bases spreading toward their land";
    case "arms": return "the arms you sold their enemies";
    case "rich": return `their spies' report of rich stores at ${baseName(state, w.richTile)}`;
    case "hunger": return "their hunger";
    case "faith": return "the faith";
    case "rival": return "your power in the state";
    case "yours": return "your own choice";
  }
  return "old hatred";
}

// ---------- declaring ----------
// Why f will not declare war on you today ("" = it might).
export function declareProblem(state, f) {
  if (!f || !f.alive || f.outsider || !f.bases.length) return "gone";
  if (!hub(state)) return "you have no hub";
  if (isMember(state, f)) return "a coalition member";
  if (f.pact) return "a pact with you";
  if (atWarWithYou(state, f)) return "already at war with you";
  if (ceasefireWith(state, f)) return "a ceasefire";
  const d = ensurePwars(state);
  if (d.pwarPeace[f.id] != null && day(state) - d.pwarPeace[f.id] < PW.COOLDOWN) return "a recent peace";
  const b = blocOf(state, f);
  if (b && b.player) return "its bloc stands with you";
  if (f.goodwill > PW.GW) return "not hostile enough";
  if (!isAggressiveType(f) && grievanceOf(state, f).total < PW.PEACEFUL_GRIEV) return "no grievance worth a war";
  if (fitPeople(f) < PW.MIN_FIT) return "too few to fight";
  const known = Object.entries(knowsOf(state, f).bases).filter(([t, k]) => k.kind === "player" && baseAt(state, Number(t)) && nearest(state, f, Number(t)) <= PW.RANGE);
  if (!known.length) return "it knows no base of yours in reach";
  const weakest = Math.min(...known.map(([, k]) => k.def || 0));
  if (strength(f) + blocSpare(state, f) < raidPrep(state) * weakest) return "too weak for you, by what it knows";
  return "";
}
export function declareChance(state, f) {
  if (declareProblem(state, f)) return 0;
  const g = grievanceOf(state, f);
  const goal = warGoalFor(state, f);
  const rich = goal.richTile != null && (knowsOf(state, f).bases[goal.richTile] || {}).value >= PW.RICH;
  return PW.BASE * weightOf(f, "warlike") * (1 + g.total / 40) * (rich ? 1.4 : 1) * ((f.stock.food || 0) < f.pop * 3 ? 1.3 : 1);
}
function declarations(state) {
  if (state.noPlayerWars || !hub(state) || state.gameOver || hcGroupRaidsQuiet(state)) return;
  const d = ensurePwars(state), today = day(state);
  if (today < PW.FROM || d.pwars.filter((w) => w.by === "them").length >= PW.MAX) return;
  if (d.lastPwar != null && today - d.lastPwar < PW.GAP) return;
  for (const f of state.factions) {
    const c = declareChance(state, f);
    if (c > 0 && h(state, f.name, today, "declare") < c) { declareOnPlayer(state, f); return; }
  }
}
function newWar(state, f, by, goal, cb, target = null, richTile = null) {
  const d = ensurePwars(state), today = day(state);
  const w = {
    id: d.pwarSeq++, fid: f.id, by, goal, cb, target, richTile, start: today, allies: [], score: { them: 0, you: 0 }, exh: { them: 0, you: 0 },
    pop0: f.pop, lastPop: f.pop, deserted: f.deserted || 0, lastAlive: alive(state).length, lastBases: state.bases.length,
    nextRaid: today + PW.FIRST_RAID[0] + Math.floor(h(state, f.name, today, "first") * (PW.FIRST_RAID[1] - PW.FIRST_RAID[0] + 1)),
    lastOffer: today, lastTalk: -99, raids: 0, held: 0, broken: 0, sieges: 0, goalMet: false, offers: 0,
  };
  d.pwars.push(w);
  return w;
}
const toHostile = (state, f, to, why) => { if (f.goodwill > to) changeGoodwill(state, f, to - f.goodwill, why); if (f.pact) f.pact = null; };
// Its bloc members who share the war come in with it.
function callAllies(state, w, f) {
  const out = [];
  for (const m of blocMates(state, f)) {
    if (!m.alive || m.outsider || isMember(state, m) || m.pact || atWarWithYou(state, m)) continue;
    if (w.by === "them" && !(threatApplies(state, m, { kind: "player", id: "player" }) || m.goodwill <= -20)) continue;
    w.allies.push(m.id);
    m.known = true;
    toHostile(state, m, PW.HOSTILE_GW, `${f.name}'s war on you`);
    out.push(m);
  }
  return out;
}
export function declareOnPlayer(state, f, goalOverride = null) {
  if (!f || !f.alive || atWarWithYou(state, f)) return null;
  const d = ensurePwars(state);
  const g = warGoalFor(state, f);
  if (goalOverride) g.goal = goalOverride;
  const w = newWar(state, f, "them", g.goal, g.cb, g.goal === "territory" ? g.target ?? outpostNearest(state, f)?.tile ?? null : null, g.richTile);
  if (w.goal === "territory" && w.target == null) w.goal = "loot";
  d.lastPwar = day(state);
  d.pwarStats.declared++;
  f.known = true;
  toHostile(state, f, PW.DECLARE_GW, "they declared war on you");
  const allies = callAllies(state, w, f);
  const text = `${f.name} declared war on you over ${cbText(state, w)}. Their goal: ${goalText(state, w)}.${allies.length ? ` ${allies.map((m) => m.name).join(" and ")} of ${blocTitle(blocOf(state, f))} fight beside them.` : ""}`;
  record(state, text, "danger");
  if (hub(state)) addCard(state, declarationCard(state, w));
  return w;
}
// You declare war on a group. goal: "tribute" | "land" | "break".
export function playerDeclareProblem(state, f) {
  if (!f || !f.alive) return "They are gone.";
  if (!f.known) return "You have not met them.";
  if (!hub(state)) return "You need a hub to wage a war from.";
  if (atWarWithYou(state, f)) return `You are already at war with ${f.name}.`;
  if (isMember(state, f)) return `${f.name} is in your coalition: expel them first.`;
  if (ceasefireWith(state, f)) return `You agreed a ceasefire with ${f.name} until day ${ceasefireUntil(state, f)}.`;
  return "";
}
export function declareByPlayer(state, f, goal = "tribute") {
  const why = playerDeclareProblem(state, f);
  if (why) return why;
  if (!["tribute", "land", "break"].includes(goal)) goal = "tribute";
  if (goal === "land" && f.bases.length < 2) goal = "tribute"; // a group with one base cannot hand one over
  const d = ensurePwars(state);
  const bandits = isAggressiveType(f) && attitude(f) === "Hostile";
  const w = newWar(state, f, "you", goal, "yours");
  d.pwarStats.byYou++;
  playerStruck(state, f, -10); // blocs.js: you turned on their bloc, if you stood with it
  toHostile(state, f, PW.YOU_DECLARE_GW, "you declared war on them");
  f.lastDiplomacy = day(state);
  if (!bandits) { const C = ensureConquest(state); C.infamy = Math.min(CONQUEST.INFAMY.max, C.infamy + PW.INFAMY); }
  for (const o of state.factions) if (o.alive && o !== f && o.known && !blocOf(state, o)?.members.includes(f.id) && relation(state, o, f) >= 28) changeGoodwill(state, o, PW.FRIENDS_GW, `you made war on their friends ${f.name}`);
  const allies = callAllies(state, w, f);
  record(state, `You declared war on ${f.name} (your goal: ${goalText(state, w)}).${allies.length ? ` ${allies.map((m) => m.name).join(" and ")} of ${blocTitle(blocOf(state, f))} stand with them.` : ""}`, "danger");
  return `You are at war with ${f.name}.${allies.length ? ` ${allies.map((m) => m.name).join(" and ")} join them.` : ""}`;
}
// News of your wars: always in the log (it is your war), and in the Affairs list.
function record(state, text, kind) {
  const d = ensureDiplo(state);
  d.news.unshift({ day: day(state), text, heard: true });
  if (d.news.length > 60) d.news.length = 60;
  log(state, text, kind);
}

// ---------- the daily pass ----------
export function pwarsDaily(state) {
  const d = ensurePwars(state);
  for (const f of state.factions) if (f.griev) for (const k of Object.keys(f.griev)) { f.griev[k] *= PW.GRIEV_FADE; if (f.griev[k] < 0.05) delete f.griev[k]; }
  for (const w of [...d.pwars]) warDay(state, w);
  declarations(state);
}
function warDay(state, w) {
  const today = day(state);
  const f = mainOf(state, w);
  if (!f || !f.alive) return endPwar(state, w, "gone", `${f ? f.name : "Your enemy"} is gone: the war is over.`);
  if (!state.bases.length) return endPwar(state, w, "gone", `With no base left to you, ${f.name}'s war on you is over.`);
  w.allies = w.allies.filter((id) => { const m = factionById(state, id); return m && m.alive; });
  for (const x of belligerents(state, w)) { if (x.goodwill > PW.HOSTILE_GW) x.goodwill = PW.HOSTILE_GW; if (x.pact) x.pact = null; }
  // Weariness.
  let e = PW.EXH_DAY;
  if ((f.stock.food || 0) < f.pop * 2) e += PW.EXH_HUNGRY;
  if ((f.stock.ammo || 0) < f.pop * 3) e += PW.EXH_HUNGRY / 2;
  const des = (f.deserted || 0) - (w.deserted || 0);
  if (des > 0) e += des * PW.EXH_DESERT;
  w.deserted = f.deserted || 0;
  if (f.pop < w.lastPop) e += ((w.lastPop - f.pop) / Math.max(1, w.pop0)) * PW.EXH_LOSS;
  w.lastPop = f.pop;
  w.exh.them += e * tireOf(f);
  const n = alive(state).length, nb = state.bases.length;
  w.exh.you += PW.YOU_DAY + Math.max(0, w.lastAlive - n) * PW.YOU_DEATH + Math.max(0, w.lastBases - nb) * PW.YOU_BASE;
  w.lastAlive = n;
  w.lastBases = nb;
  // A war raid.
  if (today >= w.nextRaid) {
    const p = warRaidOnYou(state, w);
    w.nextRaid = today + (p ? PW.RAID_GAP[0] + Math.floor(h(state, f.name, today, "gap") * (PW.RAID_GAP[1] - PW.RAID_GAP[0] + 1)) : 2);
  }
  // Word from them.
  const age = today - w.start;
  const lead = w.score.them - w.score.you;
  if (age >= PW.OFFER_FROM && today - w.lastOffer >= PW.OFFER_GAP && hub(state) && !state.cards.some((c) => c.pwarId === w.id)) {
    if (w.exh.them >= PW.TIRED && lead <= 3) { w.lastOffer = today; w.offers++; ensurePwars(state).pwarStats.offers++; addCard(state, sueCard(state, w)); }
    else if (w.by === "them" && (w.goalMet || w.exh.you >= PW.TIRED || lead >= PW.LEAD)) { w.lastOffer = today; w.offers++; ensurePwars(state).pwarStats.offers++; addCard(state, demandCard(state, w)); }
    else if (w.by === "you" && lead >= PW.LEAD) { w.lastOffer = today; w.offers++; ensurePwars(state).pwarStats.offers++; addCard(state, sueCard(state, w)); }
  }
  // Worn out, or too long.
  if (w.exh.them >= PW.BROKEN || f.pop <= DIPLO.SUE_POP) return endPwar(state, w, "weary", `${f.name} is worn out by the war and pulls back: a ceasefire.`, [{ kind: "ceasefire", days: PW.WHITE_CEASEFIRE }]);
  if (age >= PW.LONG && h(state, f.name, today, "long") < PW.LONG_PEACE) return endPwar(state, w, "white", `After ${age} days, ${f.name} and you let the war die down: a ceasefire, nothing gained.`, [{ kind: "ceasefire", days: PW.WHITE_CEASEFIRE }]);
}
export const tireOf = (f) => 0.6 + 0.4 * weightOf(f, "peaceful");

// A war raid on one of your bases: by the main enemy or an ally, on a base they know, the base they want first.
export function warRaidOnYou(state, w) {
  if (state.parties.some((p) => p.pwarId === w.id && !p.returning)) return null; // one out at a time
  const today = day(state);
  const bel = belligerents(state, w).filter((x) => fitPeople(x) >= 8 && x.bases.length && !ceasefireWith(state, x));
  if (!bel.length) return null;
  const allies = bel.filter((x) => x.id !== w.fid);
  const main = bel.find((x) => x.id === w.fid);
  const x = !main || (allies.length && h(state, w.id, today, "who") < PW.ALLY_RAID) ? allies[Math.floor(h(state, w.id, today, "ally") * allies.length)] || main : main;
  if (!x) return null;
  const K = knowsOf(state, x).bases;
  const g = state.grid;
  const cands = state.bases.filter((b) => K[b.tile] && K[b.tile].kind === "player").map((b) => {
    const from = nearestOwnBase(state, x, b.tile);
    const dd = g.distance(from, b.tile);
    return { b, dd, w: dd > RAIDS.REACH ? 0 : playerRaidWeight(state, x, b, dd) * (b.tile === w.target ? 3 : 1) };
  }).filter((c) => c.w > 0);
  if (!cands.length) return null;
  let r = h(state, w.id, today, "tgt") * cands.reduce((a, c) => a + c.w, 0);
  const pick = cands.find((c) => (r -= c.w) <= 0) || cands[cands.length - 1];
  const siege = pick.b.tile === w.target;
  const p = launchRaidOnBase(state, x, pick.b, { prepared: true });
  if (!p) return null;
  p.pwarId = w.id;
  if (siege) { p.siegeLen = PW.SIEGE_HOURS; w.sieges++; ensurePwars(state).pwarStats.sieges++; }
  const j = jointRaid(state, x, pick.b.tile, { kind: "player", id: "player" });
  if (j) { p.strength += j.power; p.joint = j.ids; }
  w.raids++;
  ensurePwars(state).pwarStats.raids++;
  return p;
}
// factions.js resolveRaidOnPlayer: a raid by a group at war with you has ended (res.outcome).
export function pwarRaidDone(state, party, res) {
  const f = factionById(state, party.owner);
  const w = pwarOf(state, f);
  if (!w || !res) return;
  const S = ensurePwars(state).pwarStats;
  const o = res.outcome;
  if (o === "held") { w.score.you += 2; w.held++; S.held++; const m = mainOf(state, w); if (m) w.exh.them += PW.EXH_HELD * tireOf(m); }
  else if (o === "broken") { w.score.them += 2; w.broken++; S.broken++; w.exh.you += PW.YOU_BROKEN; }
  else if (o === "overrun") w.score.them += 3;
  else if (o === "taken" || o === "razed") {
    w.score.them += 5;
    S.basesLost++;
    if (party.target && party.target.tile === w.target) w.goalMet = true;
  }
}
// conquest.js captureBase: you took a base of f's.
export function pwarBaseTaken(state, f, tile) {
  const w = pwarOf(state, f);
  if (!w) return;
  w.score.you += 4;
  const m = mainOf(state, w);
  w.exh.them += PW.EXH_BASE * tireOf(m || f);
  ensurePwars(state).pwarStats.basesTaken++;
  if (w.by === "you" && w.goal === "land") w.goalMet = true;
}
// conflicts.js: a group at war with you meets your teams oftener, further out.
export const pwarTeamMult = (state, f) => (atWarWithYou(state, f) ? PW.TEAM : 1);
export const pwarTeamRange = (state, f) => (atWarWithYou(state, f) ? PW.TEAM_RANGE : 5);

// ---------- terms ----------
// A term: { kind: "ceasefire", days } | { kind: "tribute", payer, goods } | { kind: "prisoners", payer, n } |
// { kind: "cede", payer, tile } | { kind: "convert", goods }. payer: "you" or "them".
function share(stock, frac) {
  const out = {};
  for (const k of ["food", "ammo", "meds", "scrap"]) { const q = Math.floor((stock[k] || 0) * frac); if (q > 0) out[k] = q; }
  return out;
}
const ceasefireTerm = (days = PW.CEASEFIRE) => ({ kind: "ceasefire", days });
// What they want of you to stop, by their goal.
export function demandTerms(state, w) {
  const f = mainOf(state, w), hb = hub(state);
  const t = [];
  if (!f || !hb) return [ceasefireTerm()];
  switch (w.goal) {
    case "territory": { const b = baseAt(state, w.target); if (b && b.type !== "hub") t.push({ kind: "cede", payer: "you", tile: b.tile }); else t.push({ kind: "tribute", payer: "you", goods: share(hb.stock, PW.TRIBUTE) }); break; }
    case "revenge": { const n = theirPrisoners(state, f).length; if (n) t.push({ kind: "prisoners", payer: "you", n }); t.push({ kind: "tribute", payer: "you", goods: share(hb.stock, PW.TRIBUTE / 2) }); break; }
    case "conversion": t.push({ kind: "convert", goods: { food: Math.floor((hb.stock.food || 0) * PW.TITHE) } }); break;
    case "rival": { const b = outpostNearest(state, f); if (b) t.push({ kind: "cede", payer: "you", tile: b.tile }); t.push({ kind: "tribute", payer: "you", goods: share(hb.stock, PW.TRIBUTE * 0.75) }); break; }
    case "loot": t.push({ kind: "tribute", payer: "you", goods: share(hb.stock, PW.TRIBUTE + 0.05) }); break;
    default: break; // a war you started: they only want it over
  }
  t.push(ceasefireTerm());
  return t;
}
// What they offer when they are the ones worn out (or holding you off in a war you started).
export function sueTerms(state, w) {
  const f = mainOf(state, w);
  const t = [];
  if (!f) return [ceasefireTerm()];
  const lead = w.score.them - w.score.you;
  const caps = captivesOf(state, f.id).length;
  if (caps && lead <= 3) t.push({ kind: "prisoners", payer: "them", n: caps });
  const yours = w.by === "you";
  if (lead <= -PW.LEAD || (yours && (w.goal === "tribute" || w.goal === "break") && lead <= 0)) t.push({ kind: "tribute", payer: "them", goods: share(f.stock, PW.THEIR_TRIBUTE) });
  if (yours && (w.goal === "land" || w.goal === "break") && lead <= -PW.LEAD) { const tile = theirBaseNearest(state, f); if (tile != null) t.push({ kind: "cede", payer: "them", tile }); }
  t.push(ceasefireTerm(lead > 0 ? PW.WHITE_CEASEFIRE : PW.CEASEFIRE));
  return t;
}
const goodsWords = (g) => Object.entries(g || {}).filter(([, q]) => q > 0).map(([k, q]) => `${q} ${keyWord(k)}`).join(", ") || "nothing";
const goodsValue = (g) => Object.entries(g || {}).reduce((a, [k, q]) => a + q * ((SUPPLIES[k] && SUPPLIES[k].value) || 1), 0);
export function termsText(state, w, terms) {
  const f = mainOf(state, w);
  const who = f ? f.name : "they";
  return terms.map((t) => {
    switch (t.kind) {
      case "ceasefire": return `a ceasefire for ${t.days} days`;
      case "tribute": return t.payer === "you" ? `you pay ${goodsWords(t.goods)}` : `${who} pay ${goodsWords(t.goods)}`;
      case "prisoners": return t.payer === "you" ? `you send their ${t.n} prisoner${t.n === 1 ? "" : "s"} home` : `${who} let your ${t.n} captive${t.n === 1 ? "" : "s"} go`;
      case "cede": return t.payer === "you" ? `you hand over ${baseName(state, t.tile)}` : `${who} hand over their base at ${tileLabel(state, t.tile)}`;
      case "convert": return `their preachers at your hub: a tithe of ${goodsWords(t.goods)}, and the least content of your people may go with them`;
    }
    return t.kind;
  }).join("; ");
}
// What a set of terms costs you in supply value (the autopilot weighs it).
export function termsCost(state, terms) {
  return terms.reduce((a, t) => a + (t.kind === "tribute" ? (t.payer === "you" ? goodsValue(t.goods) : -goodsValue(t.goods)) : t.kind === "cede" ? (t.payer === "you" ? PW.CEDE_VALUE : -PW.CEDE_VALUE) : t.kind === "convert" ? PW.CONVERT_VALUE + goodsValue(t.goods) : t.kind === "prisoners" && t.payer === "you" ? 20 * t.n : 0), 0);
}
// Can these terms be kept today? ("" = yes).
export function termsProblem(state, w, terms) {
  const f = mainOf(state, w), hb = hub(state);
  if (!pwarById(state, w.id)) return "That war is over.";
  if (!f || !f.alive) return "They are gone.";
  for (const t of terms) {
    if (t.kind === "tribute" && t.payer === "you") { if (!hb || Object.entries(t.goods).some(([k, q]) => (hb.stock[k] || 0) < q)) return `${hb ? hb.name : "Your hub"} does not have it.`; }
    if (t.kind === "cede" && t.payer === "you") { const b = baseAt(state, t.tile); if (!b || b.type === "hub") return "That base is not yours to give."; }
    if (t.kind === "cede" && t.payer === "them" && (!f.bases.includes(t.tile) || f.bases.length < 2)) return "That base is not theirs to give.";
    if (t.kind === "prisoners" && t.payer === "you" && theirPrisoners(state, f).length < t.n) return "You no longer hold them.";
  }
  return "";
}
// The chance they take your terms (see the header): type, weariness, the score, what the terms give their goal.
export function termsChance(state, w, terms) {
  const f = mainOf(state, w);
  if (!f) return 0;
  const lead = w.score.them - w.score.you;
  let p = 0.08 + 0.22 * weightOf(f, "peaceful") + Math.max(0, w.exh.them) / 100 - Math.max(0, lead) / 25 + Math.max(0, -lead) / 40 - Math.max(0, w.exh.you - w.exh.them) / 200;
  for (const t of terms) {
    if (t.kind === "tribute" && t.payer === "you") p += 0.12 + Math.min(0.25, goodsValue(t.goods) / 1500) + (w.goal === "loot" ? 0.2 : 0);
    else if (t.kind === "prisoners" && t.payer === "you") p += 0.06 * t.n + (w.goal === "revenge" ? 0.25 : 0);
    else if (t.kind === "cede" && t.payer === "you") p += 0.3 + (w.goal === "territory" && t.tile === w.target ? 0.3 : 0) + (w.goal === "rival" ? 0.2 : 0);
    else if (t.kind === "convert") p += w.goal === "conversion" ? 0.5 : 0.1;
    else if (t.kind === "tribute" && t.payer === "them") p -= 0.25;
    else if (t.kind === "cede" && t.payer === "them") p -= 0.45;
    else if (t.kind === "prisoners" && t.payer === "them") p -= 0.04 * t.n;
  }
  if (w.goal === "conversion" && !terms.some((t) => t.kind === "convert")) p *= 0.15; // zealots: the faith or nothing
  if (w.goal === "rival" && !terms.some((t) => t.kind === "cede" && t.payer === "you")) p *= 0.5;
  if (w.by === "you") p += 0.1; // they did not want this war
  return clamp(p, 0.02, 0.95);
}
// The terms you can put to them (the group's card): [{ key, label, terms, chance, text, why }].
export function termOptions(state, w) {
  const f = mainOf(state, w), hb = hub(state);
  if (!f || !hb) return [];
  const out = [];
  const add = (key, label, terms) => out.push({ key, label, terms, chance: termsChance(state, w, terms), text: termsText(state, w, terms), why: termsProblem(state, w, terms) });
  add("ceasefire", "Ceasefire", [ceasefireTerm()]);
  if (w.by === "them") add("demand", "Their terms", demandTerms(state, w));
  add("tribute", "Pay tribute", [{ kind: "tribute", payer: "you", goods: share(hb.stock, PW.TRIBUTE * 0.6) }, ceasefireTerm()]);
  const n = theirPrisoners(state, f).length;
  if (n) add("prisoners", `Return ${n} prisoner${n === 1 ? "" : "s"}`, [{ kind: "prisoners", payer: "you", n }, ceasefireTerm()]);
  const ob = w.goal === "territory" && baseAt(state, w.target) ? baseAt(state, w.target) : outpostNearest(state, f);
  if (ob && ob.type !== "hub") add("cede", `Cede ${ob.name}`, [{ kind: "cede", payer: "you", tile: ob.tile }, ceasefireTerm()]);
  add("their-tribute", "Demand tribute", [{ kind: "tribute", payer: "them", goods: share(f.stock, PW.THEIR_TRIBUTE) }, ceasefireTerm()]);
  const tb = theirBaseNearest(state, f);
  if (tb != null) add("their-base", `Demand ${tileLabel(state, tb)}`, [{ kind: "cede", payer: "them", tile: tb }, ceasefireTerm()]);
  return out;
}
// How the word goes: by radio when you can reach them, else an envoy under a white flag.
export const talkVia = (state, f) => (f && canRadioGroup(state, f) ? "radio" : "envoy");
export function talkWait(state, w) { return Math.max(0, PW.TALK_GAP - (day(state) - w.lastTalk)); }
// You put terms to them (the group's card). Returns the outcome text.
export function offerTerms(state, warId, key) {
  const w = pwarById(state, warId);
  if (!w) return "That war is over.";
  const f = mainOf(state, w);
  const opt = termOptions(state, w).find((o) => o.key === key);
  if (!opt) return "They will not hear that.";
  if (opt.why) return opt.why;
  const wait = talkWait(state, w);
  if (wait > 0) return `${f.name} will not hear another offer for ${wait} day${wait === 1 ? "" : "s"}.`;
  w.lastTalk = day(state);
  const via = talkVia(state, f) === "radio" ? "by radio" : "by an envoy under a white flag";
  if (h(state, w.id, day(state), key, "talk") >= opt.chance) {
    ensurePwars(state).pwarStats.refused++;
    const no = `${f.name} refused your terms (${opt.text}), sent ${via} (${Math.round(opt.chance * 100)}% chance). The war goes on.`;
    log(state, no, "info");
    return no;
  }
  ensurePwars(state).pwarStats.accepted++;
  const done = settle(state, w.id, opt.terms, `${f.name} accepted your terms, sent ${via}`);
  return done;
}
// Apply terms and end the war. Returns the text.
export function settle(state, warId, terms, lead = "Peace") {
  const w = pwarById(state, warId);
  if (!w) return "That war is already over.";
  const why = termsProblem(state, w, terms);
  if (why) return why;
  const f = mainOf(state, w), hb = hub(state);
  const bits = [];
  for (const t of terms) {
    if (t.kind === "tribute" && t.payer === "you") { for (const [k, q] of Object.entries(t.goods)) { const n = Math.min(q, Math.floor(hb.stock[k] || 0)); hb.stock[k] -= n; f.stock[k] = (f.stock[k] || 0) + n; } bits.push(`you paid ${goodsWords(t.goods)}`); }
    else if (t.kind === "tribute" && t.payer === "them") { for (const [k, q] of Object.entries(t.goods)) { const n = Math.min(q, Math.floor(f.stock[k] || 0)); f.stock[k] -= n; hb.stock[k] = (hb.stock[k] || 0) + n; } bits.push(`${f.name} paid ${goodsWords(t.goods)} to ${hb.name}`); }
    else if (t.kind === "prisoners" && t.payer === "you") { const ps = theirPrisoners(state, f).slice(0, t.n); for (const p of ps) tradeBack(state, p.id); bits.push(`${ps.length} of their people went home`); }
    else if (t.kind === "prisoners" && t.payer === "them") { const cs = captivesOf(state, f.id); for (const s of cs) { s.location = { kind: "base", baseId: hb.id }; s.role = "rest"; s.mood = Math.min(100, (s.mood || 50) + 15); } if (cs.length) bits.push(`${cs.map((s) => s.name).join(", ")} came home`); }
    else if (t.kind === "cede" && t.payer === "you") { const b = baseAt(state, t.tile); const name = b.name; occupyPlayerBase(state, b, f, { garrison: 4, outcome: "ceded", ceded: true }); bits.push(`you handed over ${name}`); }
    else if (t.kind === "cede" && t.payer === "them") { captureBase(state, f, t.tile, null, { people: 0, ceded: true }); bits.push(`${f.name} handed over their base at ${tileLabel(state, t.tile)}`); }
    else if (t.kind === "convert") { const food = Math.min(t.goods.food || 0, Math.floor(hb.stock.food || 0)); hb.stock.food -= food; f.stock.food = (f.stock.food || 0) + food; const who = convert(state, f, hb); bits.push(`their preachers took ${food} food${who ? ` and ${who.name} went with them` : ""}`); }
  }
  const cf = terms.find((t) => t.kind === "ceasefire");
  const text = `${lead}: ${bits.length ? `${bits.join("; ")}; ` : ""}a ceasefire for ${cf ? cf.days : PW.CEASEFIRE} days.`;
  endPwar(state, w, "terms", text, terms);
  checkGameOver(state);
  return text;
}
// The least content at the hub (not the leader) goes over to them.
function convert(state, f, hb) {
  const s = atBase(state, hb.id).filter((x) => !x.leader).sort((a, b) => (a.mood || 0) - (b.mood || 0) || a.id - b.id)[0];
  if (!s || atBase(state, hb.id).length <= 2) return null;
  s.alive = false; s.left = true; s.station = null; s.inBed = false; s.joinedGroup = f.id;
  f.pop += 1;
  log(state, `${s.name} followed ${f.name}'s preachers out of ${hb.name}.`, "death");
  return s;
}
export function endPwar(state, w, how, text, terms = []) {
  const d = ensurePwars(state);
  const i = d.pwars.indexOf(w);
  if (i < 0) return;
  d.pwars.splice(i, 1);
  const today = day(state);
  const cf = terms.find((t) => t.kind === "ceasefire");
  for (const x of belligerents(state, w)) {
    d.pwarPeace[x.id] = today;
    if (cf) d.ceasefire[x.id] = today + cf.days;
    if (x.goodwill < PW.PEACE_GW) changeGoodwill(state, x, PW.PEACE_GW - x.goodwill, "the peace");
    if (isAggressiveType(x)) x.boughtGw = Math.max(x.boughtGw || 0, x.goodwill - PW.HOSTILE_GW); // drifts back toward hostility (factions.js), held off by the ceasefire
    if (x.griev) for (const k of Object.keys(x.griev)) x.griev[k] *= 1 - PW.SETTLE;
  }
  d.pwarEnded.unshift({ id: w.id, fid: w.fid, by: w.by, goal: w.goal, cb: w.cb, start: w.start, end: today, how, terms: terms.map((t) => t.kind), score: { ...w.score }, exh: { them: Math.round(w.exh.them), you: Math.round(w.exh.you) }, raids: w.raids, allies: [...w.allies] });
  if (d.pwarEnded.length > 20) d.pwarEnded.length = 20;
  d.pwarStats.peace++;
  if (how in d.pwarStats) d.pwarStats[how]++;
  // splinters.js: a war on you they lost (worn out, or paying for the peace) stirs strife.
  const main = factionById(state, w.fid);
  if (main && (how === "weary" || (how === "terms" && terms.some((t) => t.payer === "them")))) noteStrife(main, SPLINTER.WAR_LOST, "war");
  for (const c of [...state.cards]) if (c.pwarId === w.id) state.cards.splice(state.cards.indexOf(c), 1);
  record(state, text, how === "gone" ? "info" : "good");
}

// ---------- cards ----------
// The autopilot's view of giving in: the cost against the hub's worth and how the war goes, by its style.
function giveInScore(state, w, terms, offered = false) {
  const style = state.governor ? state.governor.personality : "balanced";
  if (termsProblem(state, w, terms)) return -9;
  const hb = hub(state);
  const worth = Math.max(200, hb ? supplyValue(hb.stock) : 200);
  const cost = termsCost(state, terms) / worth;
  const hurting = w.exh.you >= PW.TIRED || w.score.them - w.score.you >= PW.LEAD;
  const limit = (style === "cautious" ? 0.25 : 0) + (hurting ? 0.15 : 0) + (offered ? 0.08 : 0);
  return cost <= limit ? 2 : -1;
}
export function declarationCard(state, w) {
  const f = mainOf(state, w);
  const demand = demandTerms(state, w);
  const allies = w.allies.map((id) => factionById(state, id)).filter(Boolean);
  return {
    title: `${f.name} declares war on you`, pwarId: w.id,
    text: `${f.name} (${f.type}) has declared war on you over ${cbText(state, w)}. Their goal: ${goalText(state, w)}.${allies.length ? ` ${allies.map((m) => m.name).join(" and ")} fight beside them.` : ""} Expect their raids oftener and harder${w.target != null ? `, a siege at ${baseName(state, w.target)}` : ""}, and your caravans and teams hunted near their land. It ends on terms (theirs, or yours from their card in the Groups tab) or when a side is worn out.`,
    choices: [
      { label: "Brace for war", hint: "Put your bases on guard; offer terms from their card in the Groups tab whenever you like", ai: () => 1, resolve: () => `You are at war with ${f.name}.` },
      { label: "Give them what they want", hint: `${cap(termsText(state, w, demand))}. The war ends before it starts`, disabled: (st) => !!termsProblem(st, w, demand),
        ai: (st) => giveInScore(st, w, demand), resolve: (st) => { ensurePwars(st).pwarStats.gaveIn++; return settle(st, w.id, demandTerms(st, w), `You gave in to ${f.name}`); } },
    ],
  };
}
export function sueCard(state, w) {
  const f = mainOf(state, w);
  const terms = sueTerms(state, w);
  const via = talkVia(state, f) === "radio" ? "over the radio" : "by an envoy under a white flag";
  const offerOnly = terms.length === 1;
  return {
    title: offerOnly ? `${f.name} offers a ceasefire` : `${f.name} sues for peace`, pwarId: w.id,
    text: `Word comes ${via}: ${f.name} ${offerOnly ? "would stop the fighting" : "are worn out and offer"}: ${termsText(state, w, terms)}. (Score ${w.score.you}–${w.score.them} to you; weariness theirs ${Math.round(w.exh.them)}, yours ${Math.round(w.exh.you)}.)`,
    choices: [
      { label: "Accept", hint: cap(termsText(state, w, terms)), disabled: (st) => !!termsProblem(st, w, terms), ai: (st) => (st.governor && st.governor.personality === "aggressive" && w.by === "you" && offerOnly ? 0 : 5),
        resolve: (st) => { ensurePwars(st).pwarStats.accepted++; return settle(st, w.id, terms, `You made peace with ${f.name}`); } },
      { label: "Fight on", hint: "They may ask again in a while", ai: () => 1, resolve: () => `You fight on against ${f.name}.` },
    ],
  };
}
export function demandCard(state, w) {
  const f = mainOf(state, w);
  const terms = demandTerms(state, w);
  const via = talkVia(state, f) === "radio" ? "over the radio" : "by an envoy under a white flag";
  return {
    title: `${f.name} offer peace on their terms`, pwarId: w.id,
    text: `Word comes ${via}: ${f.name} will stop${w.goalMet ? " now they have what they came for" : ""} if ${termsText(state, w, terms)}. (Score ${w.score.you}–${w.score.them} to you; weariness theirs ${Math.round(w.exh.them)}, yours ${Math.round(w.exh.you)}.)`,
    choices: [
      { label: "Accept their terms", hint: cap(termsText(state, w, terms)), disabled: (st) => !!termsProblem(st, w, terms), ai: (st) => giveInScore(st, w, terms, true),
        resolve: (st) => { ensurePwars(st).pwarStats.accepted++; return settle(st, w.id, demandTerms(st, w), `You accepted ${f.name}'s terms`); } },
      { label: "Refuse", hint: "The war goes on; you can offer your own terms from their card", ai: () => 0.5, resolve: (st) => { ensurePwars(st).pwarStats.refused++; return `You refuse ${f.name}'s terms.`; } },
    ],
  };
}

// Help → Blocs and wars (ui/help.js).
export const BLOCS_WARS_HELP = `<b>Blocs.</b> Groups that like each other and share a threat (a common enemy, you, a hive nearby, prey for raiders) ally into a bloc, by their type: traders, communes and fortresses readily, the military with order-keeping groups, expansionists with a few, raiders only in loose gangs of raiders, zealots only with zealots. Members send what they can spare to a raid on another (it shows in the news: "came to the aid of…"), raid together, share everything their scouts saw, buy food from each other first and grow closer every day. A bloc breaks when two members fall out, when one betrays another (a theft found out, a hungry raider turning on its gang), or when the danger that brought them together has passed; a member that joins your coalition leaves it. Each bloc has a colour: a dashed ring of it round its members' bases on the map. A bloc whose enemy is hostile to you may ask you to stand with it (its fighters then help defend your bases near them); a bloc can also form against you, or against your coalition when it holds a third of the state.<br><br>
<b>Wars with you.</b> A hostile group may declare war on you (rarely: one war at a time, months apart). It has a goal, from what it knows and what you did: loot (its spies saw rich stores), one of your outposts near its land, revenge (your raids on it, executions, its people in your jails), conversion (zealots) or breaking you as a rival (when your coalition holds much of the state). While it lasts its raids come oftener (about every ${PW.RAID_GAP[0]}–${PW.RAID_GAP[1]} days, joined by its bloc), the base it wants is besieged (${PW.SIEGE_HOURS} hours at the walls), and your caravans and teams near its land are hunted. Every raid you hold and base of theirs you take counts for you; their losses, hunger and deserters wear them down, your dead and lost bases wear you down. Every ${PW.OFFER_GAP} days or so they send word by radio or envoy: worn out, they sue for peace (a ceasefire, your captives back, tribute when you are clearly ahead); ahead, they offer peace on their terms (tribute, the base they want, their prisoners back, a tithe and a convert). You can offer terms yourself from their card in the Groups tab (the % is the chance they agree: their type, weariness, the score and how well the terms answer their goal). A side worn out past ${PW.BROKEN} pulls back. After a peace: ${PW.CEASEFIRE} days of ceasefire (no raids from them), and no new war from them for ${PW.COOLDOWN} days. You can declare war on a group too (its card: for tribute, for land, or to break it): it turns hostile, its bloc joins it, its friends think less of you.`;
