// Achievements per run (the user's request 2026-10-25: "add achievements per run"). A table of feats the run's own
// systems already keep the facts for (ACHIEVEMENTS), earned once a run and kept in the save as state.ach = { [id]: day }.
// Each new run starts with none; an older save without state.ach simply has none yet. A record across runs is the hall
// of fame's (halloffame.js), which reads achievementsOf.
//
// Recording only: the checks read the world and never touch state.rng or change play (a seed plays out the same with
// or without them: tools/achievementstest.js). Earning one writes state.ach and a log line ("🏆 Achievement: …"), and
// the UI shows a toast for it (ui/achievements.js). Two ways in:
//   achievementsDaily  once a day at midnight (world.js hourOfWorld): a light pass over what the run keeps anyway
//                      (the day, the people, their records and skills, the bases, the memorial wall, the coalition,
//                      the counters in state.stats, Crashlanding's stage); also at every ending (achievementsEnd).
//   earnAch            at the event itself, for what leaves no trace to read later: the first radio deal
//                      (radiotrade.js), a found car driven home (foundcars.js driveHome), a lost convoy recovered
//                      (convoyrecover.js, or one vehicle with its cargo: parties.js recoverVehicle), and a battle's end (achievementsBattle,
//                      combat.js finishCombat: a military site raided, a Broodmother put down on the map).
// A row's modes: the run modes (runMode) it can be earned in (all when absent); hidden: shown as "???" until earned.
import { day, log, alive, hub } from "./world.js";
import { seasonOfDay } from "./weather.js";
import { isShelter, isCamp, hasWall, piecesOf } from "./buildings.js";
import { birthsTotal } from "./family.js";
import { MILESTONES } from "./skills.js";
import { SKILLS } from "./data.js";
import { allianceMembers } from "./alliance.js";
import { firstHubPending } from "./hardcore-start.js";

export const MASTER_LEVEL = MILESTONES[MILESTONES.length - 1]; // 15: the last perk milestone (SKILL_MAX 20 takes years past it)
export const ACH = { pop1: 25, pop2: 50, kills: 1000, noDeath: 100, love: 100, road: 30 };

/** @type {{ id: string, name: string, desc: string, icon: string, group: string, hidden?: boolean, modes?: string[] }[]} */
export const ACHIEVEMENTS = [
  // Survival
  { id: "day30", group: "Survival", icon: "🌅", name: "A month on", desc: "Survive 30 days." },
  { id: "day100", group: "Survival", icon: "📅", name: "A hundred days", desc: "Survive 100 days." },
  { id: "day365", group: "Survival", icon: "🗓", name: "A year and a day", desc: "Survive 365 days." },
  { id: "winter", group: "Survival", icon: "❄", name: "Through the winter", desc: "See the first winter out to spring." },
  { id: "nodeath", group: "Survival", icon: "🕊", name: "Nobody lost", desc: `${ACH.noDeath} days in a row with no death in the group.` },
  // Growth
  { id: "shelter", group: "Growth", icon: "🛖", name: "A roof at last", desc: "Your first camp becomes a shelter.", modes: ["hardcore", "crash"] },
  { id: "mainhub", group: "Growth", icon: "🏠", name: "A real hub", desc: "Your hub becomes a Main hub.", modes: ["hardcore", "crash"] },
  { id: "outpost", group: "Growth", icon: "🏕", name: "Outpost", desc: "A base of yours becomes an outpost." },
  { id: "pop25", group: "Growth", icon: "👥", name: "A village", desc: `${ACH.pop1} people alive at once.` },
  { id: "pop50", group: "Growth", icon: "🏘", name: "A town again", desc: `${ACH.pop2} people alive at once.` },
  { id: "child", group: "Growth", icon: "👶", name: "New life", desc: "The first child is born in the group." },
  { id: "master", group: "Growth", icon: "🎓", name: "Master of a craft", desc: `A survivor grows to skill ${MASTER_LEVEL} in anything (not one who came with it).` },
  // Building
  { id: "radio", group: "Building", icon: "📻", name: "On the air", desc: "A radio station at one of your bases." },
  { id: "ring", group: "Building", icon: "🧱", name: "Walled in", desc: "A ring wall closes round one of your bases." },
  { id: "solar", group: "Building", icon: "☀", name: "Power from the sun", desc: "A solar panel array built." },
  { id: "grid", group: "Building", icon: "💡", name: "Lights in the dark", desc: "A base's power grid running at midnight." },
  // Combat
  { id: "hive", group: "Combat", icon: "🔥", name: "Burn it out", desc: "Your people destroy a hive." },
  { id: "held", group: "Combat", icon: "🛡", name: "Held the walls", desc: "A raid or a horde beaten back from one of your bases." },
  { id: "kills", group: "Combat", icon: "💀", name: "A thousand dead", desc: `Your people put down ${ACH.kills.toLocaleString("en-US")} of the dead.` },
  { id: "military", group: "Combat", icon: "🎖", name: "Raid the armoury", desc: "Win a raid on a military site." },
  { id: "brood", group: "Combat", icon: "🕷", name: "Broodkiller", desc: "Put down a Broodmother on the battle map." },
  // World
  { id: "radiotrade", group: "World", icon: "📡", name: "Deal on the air", desc: "Make a first trade over the radio." },
  { id: "coalition", group: "World", icon: "🤝", name: "Not alone", desc: "A group joins your Calder Coalition." },
  { id: "carhome", group: "World", icon: "🚗", name: "Drive it home", desc: "Drive a found car home." },
  { id: "convoy", group: "World", icon: "🚚", name: "Nothing left behind", desc: "Recover a lost team's convoy: its vehicles back on the road with what was left in them." },
  // Victory
  { id: "winhives", group: "Victory", icon: "🏆", name: "Every hive is ash", desc: "Win the hive victory." },
  { id: "wincoalition", group: "Victory", icon: "🏛", name: "The state is ours", desc: "Win with the Calder Coalition." },
  // Modes
  { id: "road", group: "Mode", icon: "🎒", name: "Life on the road", desc: `Survive ${ACH.road} days with no base yet.`, modes: ["hardcore"] },
  { id: "bunker", group: "Mode", icon: "🏔", name: "The bunker", desc: "Find your unit's bunker.", modes: ["crash"] },
  // Hidden
  { id: "love", group: "Hidden", icon: "💞", name: "Till death", desc: `Two of your people become partners and both live ${ACH.love} days more together.`, hidden: true },
  { id: "founders", group: "Hidden", icon: "⭐", name: "All of us", desc: "Win with every founder still alive.", hidden: true },
];
export const ACH_BY_ID = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

// The run's mode as the new-run screen names it (hardcore.js MODES): Crashlanding and Custom are normal runs with
// state.crash / state.custom.
/** @param {any} state */
export const runMode = (state) => (state.mode === "hardcore" ? "hardcore" : state.crash ? "crash" : state.custom ? "custom" : "normal");
/** @param {any} state @param {{ modes?: string[] }} a */
export const achInMode = (state, a) => !a.modes || a.modes.includes(runMode(state));
// The rows this run can earn (its mode's), in table order.
/** @param {any} state */
export const achievementsFor = (state) => ACHIEVEMENTS.filter((a) => achInMode(state, a));

// The founders: the people the run began with. relations.js sets s.joined on the first midnight (day 2 of a normal
// run, later in a Crashlanding one: its calendar starts in year 4), so the founders are those with the earliest
// joined day there is (everyone, before that first midnight; someone who came after it and before the next is not
// one). Children born in the group are never founders.
/** @param {any} state */
export function foundersOf(state) {
  const pool = (state.survivors || []).filter((s) => !s.parents && !s.vol && !s.loan);
  const first = Math.min(...pool.map((s) => (s.joined == null ? Infinity : s.joined)));
  return pool.filter((s) => (first === Infinity ? true : s.joined != null && s.joined <= first)); // none joined yet: the first day, everyone
}

// The earned list, oldest first: [{ id, day }] (the UI and the hall of fame read it). Unknown ids (a row taken out of
// the table) are left out.
/** @param {any} state @returns {{ id: string, day: number }[]} */
export function achievementsOf(state) {
  const A = (state && state.ach) || {};
  return Object.entries(A).filter(([id]) => ACH_BY_ID[id]).map(([id, d]) => ({ id, day: Number(d) || 0 })).sort((a, b) => a.day - b.day || ACHIEVEMENTS.indexOf(ACH_BY_ID[a.id]) - ACHIEVEMENTS.indexOf(ACH_BY_ID[b.id]));
}
/** @param {any} state @param {string} id */
export const hasAch = (state, id) => !!(state && state.ach && state.ach[id] != null);

// Earn one: once a run, in its mode only. Returns true when it was earned just now.
/** @param {any} state @param {string} id */
export function earnAch(state, id) {
  const a = ACH_BY_ID[id];
  if (!a || !state || state.achOff || state.preview || hasAch(state, id) || !achInMode(state, a)) return false;
  (state.ach || (state.ach = {}))[id] = day(state);
  log(state, `🏆 Achievement: ${a.name}. ${a.desc}`, "good");
  return true;
}

// ---------- the daily pass ----------
// What each check reads; true earns it. Cheap: no tile scans, one pass over the people and the bases.
/** @param {any} state */
function facts(state) {
  const d = day(state);
  const people = alive(state);
  const mine = state.bases || [];
  let killsZ = 0, hives = 0;
  for (const s of state.survivors || []) { const r = s.rec; if (r) { killsZ += Number(r.killsZ) || 0; hives += Number(r.hives) || 0; } }
  const h = hub(state);
  const mem = state.memorial || [];
  const lastDeath = mem.length ? Math.max(...mem.map((m) => Number(m.died) || 0)) : 1;
  const C = state.crash;
  const st = state.stats || {};
  const hs = (state.hiveInfo && state.hiveInfo.stats) || {};
  return {
    day30: d >= 30,
    day100: d >= 100,
    day365: d >= 365,
    winter: d >= 2 && seasonOfDay(d - 2).key === "winter" && seasonOfDay(d - 1).key !== "winter",
    nodeath: d - lastDeath >= ACH.noDeath,
    shelter: !!h && !isCamp(h),
    mainhub: !!h && !isShelter(h),
    outpost: mine.some((b) => b.type === "outpost" && !isShelter(b)),
    pop25: people.length >= ACH.pop1,
    pop50: people.length >= ACH.pop2,
    child: birthsTotal(state) > 0,
    master: people.some((s) => s.skillFloor && SKILLS.some((k) => (s.skills[k] || 0) >= MASTER_LEVEL && (s.skillFloor[k] || 0) < MASTER_LEVEL)), // grown to it, not joined with it (skills.js skillFloor)
    radio: mine.some((b) => b.radio),
    ring: mine.some((b) => piecesOf(b, ["wall"]).length > 0 && hasWall(b)),
    solar: mine.some((b) => (b.buildings || []).some((x) => x.type === "solar_array")),
    grid: state.hour % 24 === 0 && mine.some((b) => b.power && b.power.served && b.power.served.length > 0),
    hive: hives > 0,
    held: (st.raidsRepelled || 0) > 0 || (hs.held || 0) > 0 || (hs.repelled || 0) > 0,
    kills: killsZ >= ACH.kills,
    coalition: allianceMembers(state).length > 0,
    winhives: !!state.hivesWon,
    wincoalition: !!state.allianceWon,
    road: d >= ACH.road && !mine.length && firstHubPending(state),
    bunker: !!C && (C.found != null || ["found", "joined", "command"].includes(C.stage)),
    love: partnersLasted(state, d),
    founders: !!state.victory && foundersAlive(state),
  };
}
// Two living partners together for ACH.love days (relations.js makePartners notes r.pDay; a pair from before that
// counts from the day they met).
/** @param {any} state @param {number} d */
function partnersLasted(state, d) {
  for (const [k, r] of Object.entries(state.rel || {})) {
    if (!r || !r.p) continue;
    const since = r.pDay ?? r.met ?? d;
    if (d - since < ACH.love) continue;
    const [a, b] = k.split(":").map(Number);
    const sa = state.survivors.find((s) => s.id === a), sb = state.survivors.find((s) => s.id === b);
    if (sa && sb && sa.alive && sb.alive) return true;
  }
  return false;
}
/** @param {any} state */
function foundersAlive(state) {
  const f = foundersOf(state);
  return f.length > 0 && f.every((s) => s.alive);
}

/** Once a day at midnight (world.js hourOfWorld). Returns the ids earned. @param {any} state */
export function achievementsDaily(state) {
  if (!state || state.preview || state.achOff) return [];
  const got = [];
  const F = facts(state);
  for (const a of ACHIEVEMENTS) if (F[a.id] && earnAch(state, a.id)) got.push(a.id);
  return got;
}
// At an ending (world.js checkGameOver, crashstart.js crashJoin): the whole pass, so the victory, the founders and
// what the last day brought are in before the end screen and the hall of fame read the list.
/** @param {any} state */
export const achievementsEnd = (state) => achievementsDaily(state);

// A battle's end (combat.js finishCombat, after the service record): a raid won on a military site; a Broodmother put
// down by your people on the map.
/** @param {any} state @param {any} setup @param {any} result @param {any} battle */
export function achievementsBattle(state, setup, result, battle) {
  if (!state || !setup || !result) return;
  const won = result.outcome === "victory" || result.outcome === "extracted";
  if (won && setup.mode === "raid") {
    const tile = battle && battle.tileId != null ? battle.tileId : typeof setup.tile === "object" && setup.tile ? setup.tile.id : setup.tile;
    const t = tile != null && state.tiles ? state.tiles[tile] : null;
    const kind = setup.raid && setup.raid.kind;
    if ((t && t.loc && t.loc.type === "military") || kind === "military") earnAch(state, "military");
  }
  if (battle && battle.units && battle.units.some((u) => u.boss === "broodmother" && u.dead && u.killedBy === "player")) earnAch(state, "brood");
}
