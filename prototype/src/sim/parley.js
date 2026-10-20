// Calling out in a raid (the user's request 2026-10-20): the other people on a raid's map - a neutral or friendly
// third side (thirdside.js), a hostile group's pod (side "enemy") - are groups you can talk to, and that talk to you.
//   the groups  - every human group on a raid's map (b.raid, not a rescue) gets a record in b.parley.groups (plain data,
//                 saved with the battle): a third-side group (key "t" + its b.third index) or an enemy pod ("p" + u.pod);
//                 its units carry u.pk, the key. Hostility 0..100 by who they are (an AI group's goodwill and type, a
//                 wanderer group's mood, raiders and squatters by kit, soldiers), a little seeded jitter; the stance by
//                 it (PARLEY.STANCE: friendly, neutral, hostile). Some hostile groups are treacherous: they show as
//                 friendly (shown, lie) until they turn.
//   a party     - one AI group's scavenging party on the site at most (siteParty, from scavenge.js raidEnemies: a real
//                 aiscav.js party searching this tile, else by hash dice a group with a base within PARTY.range; never
//                 where wanderers.js people already are):
//                 their own people (arsenal.js armFromArsenal), placed by placeParley (combat.js createRaid) away from
//                 the way in; friendly and neutral ones as a third side, hostile ones as an enemy pod.
//   a crawl     - a city crawl's place (citycrawl.js enterPlace) may hold several groups at once (crawlParties: up to
//                 CRAWL.max, a slot each by depth and storeys, by the place's own hash dice): an AI group's party,
//                 survivors scavenging, a raider crew; the hostile ones go after the others too.
//   their call  - a group that first sees one of yours may call out instead of opening fire (CALL by the shown
//                 stance): a third-side group in its plan (thirdside.js thirdPlan), an enemy pod alerted by sight
//                 (combat.js detect / notice: parleySpotted; not by noise or a shot). A hostile pod that calls goes into
//                 a standoff: converted to the third side (toThird: b.third gets a record with fromEnemy, the units keep
//                 their pod in u.pfrom), guns up, nobody firing, until the card is answered (STANDOFF_TURNS at most).
//   Call out    - a unit of yours that can see one of theirs (combat.js canSee, the same floor) shouts to their group,
//                 whatever its stance (combatAct {type:"callout"}, 1 action; the shout is heard shoutCost().radius tiles
//                 off: the dead and the unaware come, Heat +shoutCost().heat). An enemy pod called to goes into a standoff.
//   the stakes  - shoutCost: a shout's reach and Heat by the place's density (DENSE: city or countryside, a crawl's block,
//                 b.infection), and its risk: "high" when it tips the Heat a stage (combat.js raidTurn: a wave). The
//                 button's tip and the card (card.shout) show it; their call carries by the stance they show (LOUD).
//   the card    - a battle card (floorfolk.js pattern: card.battle, card.parley = the key; the raid bot answers by the
//                 choices' ai weights) with what they said and the options, each with its odds: hold your fire (a
//                 truce), let's both walk away (a group on its own ground: you have LEAVE_TURNS turns to be gone; else
//                 they head off the map), trade (after the raid: the trade window with their group, a swap with
//                 anyone else), join us (they leave the map; the recruit card after the raid), what do you know (the
//                 dead and the other groups on their floor marked, its places to search known), hand over what you
//                 found (to a hostile group: your haul goes, a truce), attack them (they flip and do not react until
//                 their turn), never mind. An ask is asked once a turn; a failed one with a hostile group may make them
//                 open fire (FIRE), a neutral one just refuses; a standoff's card comes back until it is settled.
//   allies      - Fight with us (or, when they called, Watch our backs; a truce with a friendly group offers it): the
//                 group is allied for the battle, still a third side (u.ally, b.third[].allied): it fights the dead and
//                 the hostile who are up and fighting as soldiers do (thirdside.js thirdFoes), the hostile go after it,
//                 nothing of yours shoots it and it never shoots yours. What it does beside you counts (rec.fought:
//                 its kills and hits on the dead and the hostile, its turns allied, your kills next to its people,
//                 parleyHarm from combat.js damage): Join's odds rise by it (foughtBonus, the hint says so), and after
//                 the battle its group's goodwill (capped) and memory (f.foughtWith; a wanderer group's g.fought, its
//                 mood: wanderers.js talkChance reads it). Treachery still applies; your attack ends it as any truce.
//   the odds    - base[option] + ODDS.speech × (Speech − 8) of the unit that spoke + perks (Smooth Talker +2 Speech,
//                 Silver Tongue, Charming) − hostility × h[option] (Join: Leadership too), 5–95%. A treacherous group
//                 takes a truce or a trade easily (it is a ploy); the speaker's Speech and Scouting may see through it.
//   who speaks  - the card names the speaker and its odds are theirs: the caller, or (their call) the best talker of
//                 yours who sees them; "Let <name> speak" (free; card.speakers, parleySpeak for the UI) re-raises it with
//                 another of yours who sees them. rec.speaker keeps who it was (plain data).
//   tells       - seeing through a lie (Speech + Scouting, a seeded roll per unit of yours: the speaker, or a watcher of
//                 a tell): the card warns, Hold your fire / Trade / Fight with us are marked risky. In a truce a
//                 treacherous group edges a step a turn toward your people (never within BETRAY.near + TELL.keep, never
//                 firing): parleyStatus.tell for a group seen through. A tell changes nothing true.
//   the haul    - an allied group that fought beside you (its fought points): Split what we found on its card, and its
//                 own card ("ask for a share", card.split) when one of yours gets out: SPLIT.share of what was found goes
//                 to them (rec.split; fighting-together points, goodwill); out with the haul and nothing shared: keptAll.
//   the bot     - botCallOut (combat.js autoRaidTurn): the best talker who sees a group calls out by a weighed rule
//                 (BOT), once a group a battle (rec.botCalled) but in a standoff; its cards answered at once.
//   names       - a group keeps the name the raid gave it (u.gname); two alike told apart (apart: their place, or "(2)").
//   a grudge    - a truce your people broke (a hit after it, Attack them after talking): that group will not talk again
//                 this battle, and its AI group (f.grudge) or wanderer group (g.grudge) remembers it GRUDGE_DAYS: its
//                 people's hostility +GRUDGE.hostility, a truce and a join less likely. Broken by them: no grudge.
//   aggression  - either side can break the peace at any time: your people hitting one of theirs flips the group
//                 (thirdside.js thirdSideHit: parleyHit records brokeTruce "player"); a treacherous group turns on you
//                 a few turns into the truce or when BETRAY.close of yours come within BETRAY.near tiles ("It was a
//                 trap!": aware, with full actions); a group that saw you still here after your time is up opens fire.
//   the badge   - parleyStatus: what your people see of a unit's group (Hostile, Unaware, Standoff, Truce, Peaceful,
//                 Leaving, Allied); parleyGroupsSeen: the groups seen, for the raid's strip.
//   after       - endRaid: the converted pods back to the enemy (parleyEnd), result.parley (parleyResult); scavenge.js
//                 afterRaid and citycrawl.js afterPlace: goodwill (a truce kept +, a truce broken by you −, more than an
//                 attack; people taken −; fighting side by side +; the haul shared +, kept all −), the recruit card, the
//                 swap card (also for a group Hostile toward you: factions.js attitude), the trade window queued once out.
// Every roll is a hash of the battle's own key (b.parley.seed), never the world's dice. A battle with no other human
// group takes exactly the old paths (no b.parley at all).
// THIS FILE IS THE CONTRACT the UI is written against (ui/combat.js, ui/isoview.js, ui/battlebar.js): keep the
// exported names and the shapes they return.
import { addCard, skill, survivorById, factionById, day } from "./world.js";
import { hash01, hasPerk, gainXp, USE } from "./skills.js";
import { changeGoodwill, attitude } from "./factions.js";
import { say, fx, active, activeAny, canSee, setFloor, alertNear, enemyUnit, unitById, moveAlong, CELL, RAID_HEAT } from "./combat.js";
import { carriedSpots } from "./inventory.js";
import { isCountStack } from "./itemstack.js";
import { stockKeyOf } from "./supitems.js";
import { itemValue } from "./valuation.js";
import { trunkVehicle } from "./raidloot.js";
import { armFromArsenal, keepItem } from "./arsenal.js";
import { thirdSideUnit, thirdSideHit } from "./thirdside.js";
import { groupById, siteRoll } from "./wanderers.js";
import { removeMember, memberById } from "./members.js";
import { offerRecruits, makeCandidate } from "./recruits.js";
import { openTrade } from "./trade.js";
import { partyMembers, partyTile, tileLabel, carriedAny, takeAny } from "./parties.js";
import { addCargo } from "./conflicts.js";
import { supValue } from "./data.js";
import { keyWord } from "./water.js";
import { gunLeavesTeam } from "./gunload.js";

export const PARLEY = {
  SHOUT: 6, // the noise of a shout (tiles), heard by the dead and the unaware: on the quietest ground; + DENSE.reach × density
  HEAT: 1, // a shout's Heat (b.noise), on the quietest ground; + DENSE.heat × density
  // A shout's stakes (shoutCost): the place's density 0..1, its tile (terrain; else other), a city crawl's block past the
  // first (perBlock), the dead in it (b.infection × infection). Risk "high": the shout tips the Heat a stage this turn (a
  // wave, combat.js raidTurn); "some": within `near` Heat of it after, or a stage that sends the dead already.
  DENSE: { terrain: { city: 0.55, suburb: 0.3 }, other: 0.1, perBlock: 0.1, infection: 0.35, reach: 4, heat: 9, near: 8 },
  LOUD: { hostile: 1, neutral: 0.5, friendly: 0 }, // their call: this much of a shout's reach and Heat, by the stance they show
  LEAVE_TURNS: 4, // walking away from a group on its own ground: turns you have to be out of its sight
  STANDOFF_TURNS: 2, // an unanswered standoff: their turns before they stop waiting
  CALL: { friendly: 0.9, neutral: 0.7, hostile: 0.35, treacherous: 0.85 }, // they call out when they first see you
  STANCE: { friendly: 30, neutral: 60 }, // hostility under 30 friendly, under 60 neutral, else hostile
  HOSTILITY: {
    base: 45, goodwill: 0.5, pact: -15, jitter: 8, // an AI group: base − goodwill × 0.5 + its type, ± jitter
    type: { traders: -10, commune: -10, military: 0, fortress: 0, expansionist: 5, raider: 10, zealot: 10 },
    mood: { friendly: 15, wary: 40, desperate: 50 }, survivors: 40, // a wanderer group by its mood; other neutrals
    soldiers: 30, soldiersGoodwill: 0.25, // a squad: 30 − their group's goodwill × 0.25
    kit: { raiders: 82, survivors: 72, zealots: 90, soldiers: 62 }, other: 75, squatters: 78, // an enemy pod with no group
  },
  TREACHERY: { raider: 0.35, zealot: 0.25, expansionist: 0.2, group: 0.1, loose: 0.3 }, // a hostile group's chance to fake it
  LIE: 20, // the hostility a treacherous group shows
  BETRAY: { after: [2, 4], near: 5, close: 2 }, // turns into the peace; or this many of yours within `near` tiles
  ODDS: {
    base: { truce: 0.95, walk: 0.95, trade: 0.85, join: 0.45, info: 0.85, ally: 0.7 },
    h: { truce: 0.007, walk: 0.005, trade: 0.008, join: 0.006, info: 0.006, ally: 0.009 }, // a point of hostility
    speech: 0.03, smooth: 2, silvertongue: 0.15, charming: 0.05, // a point of Speech over 8; perks
    lead: 0.02, truced: 0.1, mood: { desperate: 0.15, friendly: 0.1, wary: 0 }, // Join: Leadership over 8, after a truce, a wanderer's mood
    ploy: 0.35, // a treacherous group's truce, trade and alliance
    fought: 0.02, foughtMax: 0.25, // Join: a point of fighting side by side (this battle's and before), at most
    min: 0.05, max: 0.95,
  },
  // Fighting side by side (an allied group): its points, a kill and a hit of theirs on the dead or a hostile, a turn
  // allied, a kill of yours of something within FOUGHT.near tiles of them.
  FOUGHT: { kill: 2, hit: 0.5, turn: 0.5, help: 1, near: 7 },
  FIRE: { from: 55, max: 0.6 }, // a failed ask: (hostility − 55) / 45 × 0.6 they open fire
  SUSPECT: { per: 0.025, min: 0.05, max: 0.75 }, // seeing through a lie: (Speech + Scouting) × 0.025 (the speaker; a watcher of a tell)
  TELL: { keep: 1 }, // a treacherous group in a truce edges a step a turn toward your people, never nearer than BETRAY.near + keep
  GRUDGE_DAYS: 30, // a group whose truce your people broke remembers it this many days (f.grudge, g.grudge: { day })
  GRUDGE: { hostility: 20, odds: 0.15 }, // meanwhile: its people's hostility +20, a truce and a join 15% less likely
  PARTY: { chance: 0.25, range: 10, window: 72, count: [2, 4], power: 4 }, // an AI group's party on the site
  GOODWILL: { kept: 4, broke: -25, attack: -10, join: -6, fought: 1.5, foughtMax: 15, foughtKept: 30, split: 4, keptAll: -3 }, // after the raid (join: a person taken; fought: a point of fighting together, at most foughtMax a battle; foughtKept: the points a group remembers; split, keptAll: SPLIT)
  // A city crawl's place (citycrawl.js enterPlace): up to `max` groups on its map, a slot each (1, +1 from block `deep`,
  // +1 in a building of `tall` storeys) at `chance`; who: an AI group's party (one within `range` tiles), survivors
  // scavenging (friendly or neutral), a raider crew (hostile). The crawl's own dice (a hash of the place and the window).
  CRAWL: { max: 3, deep: 3, tall: 3, chance: 0.3, range: 12, kinds: { group: 0.4, survivors: 0.35, raiders: 0.25 }, perBlock: 0.3,
    names: { survivors: ["survivors scavenging here", "a band of scavengers", "a family on the move"], raiders: ["a raider crew", "a gang of looters", "armed strangers"] } },
  BARTER: 12, CUT: 0.85, // a swap with a group that has no trade window (or a Hostile one): this much value given, CUT of it back
  // Split what we found (an allied group that fought beside you: on its card, and its own card when one of yours gets
  // out): `share` of each supply found and found gear up to `share` of its worth goes to them; fighting together +fought
  // points (Join's odds, their memory), GOODWILL.split. Out with `min` worth or more found, nothing shared: GOODWILL.keptAll.
  // The bot: split at ai + aiPer × the points they fought for (at most aiMax), against keep.
  SPLIT: { share: 1 / 3, fought: 4, min: 10, ai: 0.3, aiPer: 0.05, aiMax: 0.9, keep: 0.5 },
  // The raid bot's own call (botCallOut): gain × the best talker's odds (a third side: Fight with us or What do you know;
  // an unaware hostile pod: a truce, only when it outnumbers yours lose × or more) − risk[shoutCost risk] ≥ min.
  BOT: { gain: { third: 1, pod: 1 }, risk: { low: 0, some: 0.15, high: 0.4 }, min: 0.3, lose: 1, hurt: 50 },
};

const clamp = (v, a, c) => Math.max(a, Math.min(c, v));
const pct = (c) => `${Math.round(c * 100)}%`;
const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const first = (n) => String(n || "").split(" ")[0];
const dist = (a, c) => Math.hypot(a.x - c.x, a.y - c.y);
const human = (u) => !!u && u.kind === "human" && !u.ztype;
const other = (u) => human(u) && (u.side === "third" || u.side === "enemy");
const on = (b) => !!b && !!b.raid && !b.rescue && !(b.setup && b.setup.drill); // parley runs on a raid's map
const roll = (b, ...k) => hash01(b.parley.seed, ...k);
const stanceOf = (h) => (h < PARLEY.STANCE.friendly ? "friendly" : h < PARLEY.STANCE.neutral ? "neutral" : "hostile");
const keyOf = (u) => u.pk || (u.side === "third" ? `t${u.tgroup}` : `p${u.pod}`);
const recOf = (b, u) => (b && b.parley && u ? b.parley.groups.find((g) => g.key === keyOf(u)) || null : null);
const recByKey = (b, key) => (b && b.parley ? b.parley.groups.find((g) => g.key === key) || null : null);
const unitsOf = (b, rec) => b.units.filter((u) => u.pk === rec.key);
const standing = (b, rec) => unitsOf(b, rec).filter((u) => activeAny(u) && !u.surr && !u.tied);
const shownOf = (rec) => (rec.treacherous && !rec.unmasked ? "friendly" : rec.stance);
const shownHostility = (rec) => (rec.treacherous && !rec.unmasked ? rec.lie : rec.hostility);
const NOUN = { raider: "raiders", expansionist: "fighters", zealot: "zealots", military: "soldiers", fortress: "guards", traders: "guards", commune: "militia" };
const KIT_NAME = { raiders: "the raiders", survivors: "armed survivors", zealots: "the zealots", soldiers: "the soldiers" };
const COLOR = { Hostile: "#ff8f85", Unaware: "#e0c46c", Standoff: "#f2a65a", Truce: "#8fc4e9", Peaceful: "#8fd19b", Leaving: "#c4b8a4", Allied: "#4fe08a" };
const foughtScore = (rec) => { const F = PARLEY.FOUGHT, x = rec.fought || {}; return (x.kills || 0) * F.kill + (x.hits || 0) * F.hit + (x.turns || 0) * F.turn + (x.helped || 0) * F.help + (x.split || 0); }; // split: SPLIT.fought

// An AI group's hostility toward you (0 friendly .. 100 hostile).
function factionHostility(f) {
  const H = PARLEY.HOSTILITY;
  return clamp(H.base - (f.goodwill || 0) * H.goodwill + (H.type[f.type] || 0) + (f.pact ? H.pact : 0), 0, 100);
}

// A grudge their group holds against you (your people broke a truce with theirs within GRUDGE_DAYS): true or false.
function grudgeOf(state, factionId, wid) {
  const f = factionId != null ? factionById(state, factionId) : null;
  const g = wid != null ? groupById(state, wid) : null;
  const d = day(state);
  return [f && f.grudge, g && g.grudge].some((x) => x && Number.isFinite(x.day) && d - x.day < PARLEY.GRUDGE_DAYS);
}

// ---------- the records ----------
function book(state, b) {
  if (!b.parley) b.parley = { seed: Math.floor(hash01(state.seed, "parley", b.tileId ?? 0, state.hour) * 4294967296), groups: [], pending: [], ground: groundOf(state, b) }; // ground: the tile's part of a shout's stakes (shoutCost)
  return b.parley;
}
function record(o) {
  return {
    key: o.key, name: o.name, factionId: o.factionId ?? null, wid: o.wid ?? null, tgroup: o.tgroup ?? null, pod: o.pod ?? null, team: o.team || null,
    stance: o.stance, hostility: o.hostility, treacherous: !!o.treacherous, lie: o.treacherous ? PARLEY.LIE : o.hostility, shown: o.treacherous ? "friendly" : o.stance,
    party: !!o.party, home: !!o.home, folk: !!o.folk, fromEnemy: false,
    truce: false, standoff: false, standoffAt: null, leaving: false, goes: null, leaveBy: null, betrayAt: null, ambush: null,
    calledOut: false, talks: 0, tried: {}, seen: false, trade: false, joining: false, told: false, gave: null,
    brokeTruce: null, turned: false, unmasked: false, betrayed: false, attacked: false, suspect: {},
    allied: false, fought: { kills: 0, hits: 0, turns: 0, helped: 0, split: 0 }, split: null, splitAsked: false, kept: false, botCalled: false,
    speaker: null, tellAt: null, grudge: !!o.grudge, base: o.name, // base: the name given (apart)
  };
}
// A record for the group of unit u (made the first time a group is met in the battle).
function newRecord(state, b, u, key) {
  const third = u.side === "third";
  const T = third && b.third ? b.third[u.tgroup] : null;
  const fid = T ? T.factionId : u.factionId;
  const f = fid != null ? factionById(state, fid) : null;
  const g = T && T.wid != null ? groupById(state, T.wid) : null;
  const H = PARLEY.HOSTILITY;
  let h;
  if (third) h = T && T.team === "military" ? H.soldiers - (f ? (f.goodwill || 0) * H.soldiersGoodwill : 0) : g ? H.mood[g.mood] ?? H.survivors : f ? factionHostility(f) : H.survivors;
  else h = f ? Math.max(PARLEY.STANCE.neutral, factionHostility(f)) : u.occupant === "hostile" ? H.squatters : H.kit[u.kit] ?? H.other;
  h += (roll(b, "jitter", key) - 0.5) * 2 * H.jitter;
  const grudge = grudgeOf(state, f ? f.id : null, T ? T.wid : null);
  if (grudge) h += PARLEY.GRUDGE.hostility;
  h = Math.round(third ? clamp(h, 0, PARLEY.STANCE.neutral - 1) : clamp(h, PARLEY.STANCE.neutral, 100)); // they are where they stand
  const stance = stanceOf(h);
  const tr = PARLEY.TREACHERY;
  const treacherous = stance === "hostile" && roll(b, "treachery", key) < (f ? tr[f.type] ?? tr.group : tr.loose);
  const name = T ? T.name : u.gname ? u.gname : f ? (f.known ? `${f.name} ${NOUN[f.type] || "people"}` : "armed strangers") : u.occupant === "hostile" ? "the squatters" : KIT_NAME[u.kit] || "armed strangers";
  return record({ key, name, factionId: f ? f.id : null, wid: T ? T.wid : null, tgroup: third ? u.tgroup : null, pod: third ? null : u.pod, team: T ? T.team : null, stance, hostility: h, treacherous, home: !third, folk: u.folk === "survivors", grudge });
}
// Every human group on the map has its record; its units are stamped with the key. A group met later with a name
// already taken: "(2)" after it (apart).
function ensureRecords(state, b) {
  if (!on(b)) return null;
  for (const u of b.units) {
    if (!other(u) || u.dead) continue;
    const key = keyOf(u);
    if (!b.parley || !recByKey(b, key)) {
      const P = book(state, b), rec = newRecord(state, b, u, key);
      const same = P.groups.filter((g) => g.base === rec.name).length;
      if (same) rec.name = `${rec.name} (${same + 1})`;
      P.groups.push(rec);
    }
    u.pk = key;
  }
  return b.parley || null;
}
// Two groups with one name told apart (the raid's strip, the cards): by where they hold (the area or room of their
// home, "the raiders at the store") when that tells them all apart, else "(2)", "(3)" after the second and on.
// rec.base keeps the name they were given.
function apart(b) {
  const areaOf = (rec) => {
    const u = unitsOf(b, rec)[0], at = u && (u.home || [u.x, u.y]);
    const a = at && (b.raid.areas || []).find((x) => x && x.name && at[0] >= x.x0 && at[0] < x.x0 + x.w && at[1] >= x.y0 && at[1] < x.y0 + x.h);
    return a ? a.name.toLowerCase() : null;
  };
  const by = new Map();
  for (const rec of b.parley.groups) { rec.base = rec.base || rec.name; by.set(rec.base, [...(by.get(rec.base) || []), rec]); }
  for (const list of by.values()) {
    if (list.length < 2) continue;
    const at = list.map(areaOf);
    const told = at.every((x) => x) && new Set(at).size === at.length;
    list.forEach((rec, i) => { rec.name = told ? `${rec.base} at the ${at[i]}` : i ? `${rec.base} (${i + 1})` : rec.base; });
  }
}

// ---------- placing (combat.js createRaid) ----------
// The AI group's party on a site (scavenge.js raidEnemies): a group for the roster, or null. A real scavenging party
// of theirs on this tile (aiscav.js) first; else, by hash dice, a group with a base within PARTY.range tiles.
export function siteParty(state, tileId) {
  const t = state.tiles[tileId];
  if (!t || t.hive || state.noParley || state.noWanderers) return null; // noParley, noWanderers: test switches
  if (state.bases.some((x) => x.tile === tileId) || state.factions.some((f) => f.alive && f.bases.includes(tileId))) return null;
  if (siteRoll(state, tileId).length) return null; // wanderers.js: people on the move already hold the site (the same dice)
  const Q = PARLEY.PARTY, H = PARLEY.HOSTILITY;
  const win = Math.floor(state.hour / Q.window);
  const scav = (state.parties || []).find((q) => q.kind === "scav" && q.owner !== "player" && q.scav && q.scav.site === tileId && q.phase === "search");
  let f = scav ? factionById(state, scav.owner) : null;
  if (!f) {
    if (hash01(state.seed, "parley-party", tileId, win) >= Q.chance) return null;
    const near = state.factions.filter((x) => x.alive && !x.outsider && x.bases.length).map((x) => ({ f: x, w: 1 - Math.min(...x.bases.map((id) => state.grid.distance(id, tileId))) / (Q.range + 1) })).filter((o) => o.w > 0);
    if (!near.length) return null;
    let r = hash01(state.seed, "parley-who", tileId, win) * near.reduce((a, o) => a + o.w, 0);
    f = near.find((o) => (r -= o.w) < 0)?.f || near[near.length - 1].f;
  }
  if (!f || !f.alive) return null;
  const n = scav ? clamp(Math.round(scav.strength || Q.count[0]), Q.count[0], Q.count[1]) : Q.count[0] + Math.floor(hash01(state.seed, "parley-n", tileId, win) * (Q.count[1] - Q.count[0] + 1));
  const h = Math.round(clamp(factionHostility(f) + (hash01(state.seed, "parley-mood", tileId, win) - 0.5) * 2 * H.jitter + (grudgeOf(state, f.id, null) ? PARLEY.GRUDGE.hostility : 0), 0, 100));
  const stance = stanceOf(h);
  const treacherous = stance === "hostile" && hash01(state.seed, "parley-lie", tileId, win) < (PARLEY.TREACHERY[f.type] ?? PARLEY.TREACHERY.group);
  const kind = f.type === "military" || f.type === "fortress" ? "soldiers" : f.type === "zealot" ? "zealots" : "raiders";
  return {
    kind, count: n, power: Q.power, name: f.known ? `${f.name} scavengers` : "scavengers from another group", factionId: f.id,
    ...(stance === "hostile" ? {} : { side: "neutral" }), parley: { stance, hostility: h, treacherous, scav: scav ? scav.id : null },
  };
}
// The groups on a city crawl's place (citycrawl.js enterPlace): [group] for the roster, 0..CRAWL.max of them, a mix
// of friendly, neutral and hostile (the hostile ones go after the others too: thirdside.js enemyTargetsThird).
export function crawlParties(state, tileId, placeId, n = 1, storeys = 1) {
  if (state.noParley || state.noWanderers) return [];
  const C = PARLEY.CRAWL, Q = PARLEY.PARTY, H = PARLEY.HOSTILITY;
  const win = Math.floor(state.hour / Q.window);
  const slots = Math.min(C.max, 1 + (n >= C.deep ? 1 : 0) + (storeys >= C.tall ? 1 : 0));
  const out = [], used = new Set();
  const nameAt = Math.floor(hash01(state.seed, "crawl-parley", tileId, placeId, win, "name") * 3); // the slots' names in turn: no two alike
  for (let i = 0; i < slots; i++) {
    const h = (k) => hash01(state.seed, "crawl-parley", tileId, placeId, win, i, k);
    if (h("is") >= C.chance) continue;
    const near = state.factions.filter((x) => x.alive && !x.outsider && x.bases.length && !used.has(x.id)).map((x) => ({ f: x, w: 1 - Math.min(...x.bases.map((id) => state.grid.distance(id, tileId))) / (C.range + 1) })).filter((o) => o.w > 0);
    const K = C.kinds, tot = (near.length ? K.group : 0) + K.survivors + K.raiders;
    let r = h("kind") * tot;
    const kind = near.length && (r -= K.group) < 0 ? "group" : (r -= K.survivors) < 0 ? "survivors" : "raiders";
    const count = Q.count[0] + Math.floor(h("n") * (Q.count[1] - Q.count[0] + 1));
    const power = Q.power + C.perBlock * (n - 1);
    let g;
    if (kind === "group") {
      let w = h("who") * near.reduce((a, o) => a + o.w, 0);
      const f = near.find((o) => (w -= o.w) < 0)?.f || near[near.length - 1].f;
      used.add(f.id);
      const hh = Math.round(clamp(factionHostility(f) + (h("mood") - 0.5) * 2 * H.jitter + (grudgeOf(state, f.id, null) ? PARLEY.GRUDGE.hostility : 0), 0, 100));
      const stance = stanceOf(hh);
      g = { kind: f.type === "military" || f.type === "fortress" ? "soldiers" : f.type === "zealot" ? "zealots" : "raiders", name: f.known ? `${f.name} scavengers` : "scavengers from another group", factionId: f.id,
        stance, hostility: hh, treacherous: stance === "hostile" && h("lie") < (PARLEY.TREACHERY[f.type] ?? PARLEY.TREACHERY.group) };
    } else if (kind === "survivors") {
      const hh = Math.round(10 + h("mood") * 45);
      g = { kind: "survivors", name: C.names.survivors[(i + nameAt) % C.names.survivors.length], stance: stanceOf(hh), hostility: hh, treacherous: false };
    } else {
      const hh = Math.round(75 + h("mood") * 17);
      g = { kind: "raiders", name: C.names.raiders[(i + nameAt) % C.names.raiders.length], stance: "hostile", hostility: hh, treacherous: h("lie") < PARLEY.TREACHERY.loose };
    }
    out.push({ kind: g.kind, count, power, name: g.name, ...(g.factionId != null ? { factionId: g.factionId } : {}), ...(g.stance === "hostile" ? {} : { side: "neutral" }),
      parley: { stance: g.stance, hostility: g.hostility, treacherous: g.treacherous, crawl: true } });
  }
  return out;
}
// Places the party groups (g.parley) on the raid's map: a knot of free cells away from the way in, on the ground floor.
export function placeParley(state, b, groups) {
  if (!on(b) || !groups || !groups.length) return;
  const rng = state.rng, W = b.w, H = b.h;
  const entry = b.raid.zones[0];
  const ex = entry.x0 + 1, ey = entry.y0 + 1;
  const inZone = (x, y) => b.raid.zones.some((z) => x >= z.x0 && x < z.x0 + z.w && y >= z.y0 && y < z.y0 + z.h);
  const anchors = []; // several groups (a crawl's place): apart from one another when there is room
  for (const g of groups) {
    const n = clamp(Math.round(g.count || 0), 1, 6);
    const taken = new Set(b.units.filter((u) => !u.dead && (u.f || 0) === (b.floor || 0)).map((u) => u.y * W + u.x));
    const free = [];
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const i = y * W + x, c = b.cells[i], C = CELL[c.k];
      if (!b.reach[i] || !C || !C.walk || taken.has(i) || inZone(x, y) || ["stairs", "ladder", "idoor", "odoor"].includes(c.k)) continue;
      if (Math.hypot(x - ex, y - ey) >= 10) free.push([x, y]);
    }
    const apart = free.filter(([x, y]) => anchors.every(([ax, ay]) => Math.hypot(x - ax, y - ay) >= 7));
    const at = rng.pick(apart.length ? apart : free);
    if (!at) continue;
    anchors.push(at);
    const cells = free.filter(([x, y]) => Math.hypot(x - at[0], y - at[1]) <= 4).sort((p, q) => Math.hypot(p[0] - at[0], p[1] - at[1]) - Math.hypot(q[0] - at[0], q[1] - at[1]));
    const pod = 1 + b.units.reduce((a, u) => Math.max(a, u.pod ?? -1), -1);
    let hn = b.units.filter((u) => u.kind === "human" && u.side !== "player").length;
    const made = [];
    for (let i = 0; i < n && i < cells.length; i++) {
      const u = enemyUnit(b, rng, g.kind, g.power, ++hn);
      u.x = cells[i][0]; u.y = cells[i][1]; u.aware = false; u.pod = pod; u.home = at.slice();
      if (g.factionId != null) { u.factionId = g.factionId; armFromArsenal(state, b, u, hn); } // arsenal.js: their own people
      Object.assign(u, { x: cells[i][0], y: cells[i][1], aware: false, pod, home: at.slice(), party: true }); // party: not a place's own (floorfolk.js leaves them where they are)
      if (g.side === "neutral") thirdSideUnit(b, u, g, i); // thirdside.js: friendly and neutral parties are a third side
      b.units.push(u);
      made.push(u);
    }
    if (!made.length) continue;
    const key = made[0].side === "third" ? `t${made[0].tgroup}` : `p${pod}`;
    const P = g.parley || {};
    const rec = record({ key, name: g.name, factionId: g.factionId, tgroup: made[0].side === "third" ? made[0].tgroup : null, pod: made[0].side === "third" ? null : pod, team: made[0].team || null, stance: P.stance || "neutral", hostility: P.hostility ?? 45, treacherous: !!P.treacherous, party: true, home: false, grudge: grudgeOf(state, g.factionId, null) });
    book(state, b).groups.push(rec);
    for (const u of made) u.pk = key;
  }
}
// The records for every other group on the map, once it is set up (combat.js createRaid).
export function parleySetup(state, b) {
  if (ensureRecords(state, b)) apart(b);
}

// ---------- peace and war ----------
// An enemy pod holds its fire: its standing units become a third side (b.third: fromEnemy), their pod kept.
function toThird(b, rec) {
  const list = b.units.filter((u) => u.pk === rec.key && u.side === "enemy" && activeAny(u) && !u.surr && !u.tied);
  if (!list.length) return false;
  const T = b.third || (b.third = []);
  // A third-side group that had turned on you: back on its own side (its record and its count kept, hostile noted).
  const own = rec.tgroup != null && T[rec.tgroup] && !T[rec.tgroup].fromEnemy ? T[rec.tgroup] : null;
  if (own) { for (const u of list) { u.side = "third"; u.team = own.team; u.aware = true; u.ow = false; u.hunker = false; } return true; }
  let gi = rec.tgroup;
  if (gi == null || !T[gi] || !T[gi].fromEnemy) {
    gi = T.length;
    T.push({ src: null, team: "neutral", name: rec.name, factionId: rec.factionId, wid: null, start: list.length, hostile: false, met: true, called: true, fromEnemy: true });
    rec.tgroup = gi;
  }
  T[gi].hostile = false;
  rec.fromEnemy = true;
  for (const u of list) { u.pfrom = u.pod; u.side = "third"; u.team = "neutral"; u.tgroup = gi; u.aware = true; u.ow = false; u.hunker = false; }
  return true;
}
// The group fights: its third-side units back to the enemy, aware (or not: you got the drop on them).
function toEnemy(b, rec, aware = true) {
  for (const u of b.units) {
    if (u.pk !== rec.key || u.side !== "third") continue;
    u.side = "enemy";
    u.aware = aware;
    u.pod = u.pfrom ?? 900 + u.tgroup; // their alert group (thirdside.js thirdSideHit numbers the same)
    delete u.pfrom;
    u.ow = false;
  }
  const T = b.third && rec.tgroup != null ? b.third[rec.tgroup] : null;
  if (T) T.hostile = true;
  hostile(rec, b);
}
function hostile(rec, b = null) {
  if (rec.treacherous) rec.unmasked = true; // the lie is out: shown as what it is from now on
  if (b) for (const u of b.units) if (u.pk === rec.key) delete u.ally;
  if (b && b.third && rec.tgroup != null && b.third[rec.tgroup]) b.third[rec.tgroup].allied = false;
  rec.allied = false;
  rec.turned = true; rec.truce = false; rec.standoff = false; rec.leaving = false; rec.goes = null; rec.leaveBy = null;
}
function turnHostile(b, rec, line) {
  toEnemy(b, rec, true);
  if (line) say(b, line, "danger");
}
// A truce (or the walk-away, a trade agreed, the haul handed over): a pod in a standoff stays on the third side.
function peace(b, rec) {
  toThird(b, rec);
  rec.standoff = false;
  rec.truce = true;
  if (rec.treacherous && rec.betrayAt == null) { const A = PARLEY.BETRAY.after; rec.betrayAt = b.turn + A[0] + Math.floor(roll(b, "betray", rec.key) * (A[1] - A[0] + 1)); }
}
// Fight with us: the group is allied for the battle (u.ally: thirdside.js thirdFoes, enemyTargetsThird; the third side
// still, so nothing of yours shoots them and they never shoot yours).
function ally(b, rec) {
  peace(b, rec);
  rec.allied = true;
  for (const u of standing(b, rec)) if (u.side === "third") u.ally = true;
  if (b.third && rec.tgroup != null && b.third[rec.tgroup]) b.third[rec.tgroup].allied = true;
}
// combat.js damage: a hit on the dead or a hostile (killed: it went down for good). An allied group's own counts for
// it; a kill of yours near an allied group's people counts as help.
export function parleyHarm(b, t, by, killed) {
  if (!b || !b.parley || !t || !by || t.side !== "enemy") return;
  const F = PARLEY.FOUGHT;
  if (by.ally && by.side === "third") {
    const rec = recOf(b, by);
    if (rec && rec.allied) { rec.fought.hits++; if (killed) rec.fought.kills++; }
    return;
  }
  if (by.side !== "player" || !killed) return;
  for (const rec of b.parley.groups) if (rec.allied && standing(b, rec).some((u) => (u.f || 0) === (t.f || 0) && dist(u, t) <= F.near)) rec.fought.helped++;
}

// thirdside.js thirdSideHit: your people hit one of theirs (the units it turned): the group is at war now.
export function parleyHit(b, turned, by) {
  if (!b || !b.parley || !by || by.side !== "player") return;
  for (const key of new Set((turned || []).map((u) => u.pk).filter(Boolean))) {
    const rec = recByKey(b, key);
    if (!rec) continue;
    if (rec.truce || rec.leaving || rec.standoff) rec.brokeTruce = rec.brokeTruce || "player";
    rec.attacked = true;
    hostile(rec, b);
  }
}
// thirdside.js thirdPlan: a group walking off the map runs for the edge.
// A treacherous group at peace edges toward your people (a tell: a step a turn, never within BETRAY.near + TELL.keep,
// never an attack), and holds.
export function parleyPlan(b, u) {
  const rec = b && b.parley ? recOf(b, u) : null;
  if (!rec) return null;
  if (rec.leaving && rec.goes === "them") return "flee";
  if (rec.treacherous && !rec.unmasked && (rec.truce || rec.leaving) && u.side === "third" && creep(b, u)) { rec.tellAt = b.turn; return "hold"; }
  return null;
}
function creep(b, u) {
  const mine = b.units.filter((p) => p.side === "player" && activeAny(p) && (p.f || 0) === (u.f || 0));
  if (!mine.length) return false;
  const near = (x, y) => Math.min(...mine.map((p) => Math.hypot(p.x - x, p.y - y)));
  const keep = PARLEY.BETRAY.near + PARLEY.TELL.keep;
  const d0 = near(u.x, u.y);
  let best = null;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const x = u.x + dx, y = u.y + dy;
    if (x < 1 || y < 1 || x >= b.w - 1 || y >= b.h - 1) continue;
    const i = y * b.w + x, C = CELL[b.cells[i].k];
    if (!C || !C.walk || !b.reach[i] || b.units.some((o) => !o.dead && (o.f || 0) === (u.f || 0) && o.x === x && o.y === y)) continue;
    const d = near(x, y);
    if (d < d0 && d >= keep && (!best || d < best.d)) best = { x, y, d };
  }
  if (!best) return false;
  moveAlong(b, u, [[best.x, best.y]]);
  return true;
}
const callChance = (rec) => (rec.treacherous && !rec.unmasked ? PARLEY.CALL.treacherous : PARLEY.CALL[rec.stance] ?? 0);
// thirdside.js thirdPlan: a third-side group has just seen unit p of yours. True when they call out (a card at the
// next tick); false: the old one line.
export function parleyMet(b, u, p) {
  const rec = b && b.parley ? recOf(b, u) : null;
  if (!rec || rec.calledOut || rec.folk || rec.brokeTruce === "player") return false;
  rec.calledOut = true;
  rec.seen = true;
  if (roll(b, "call", rec.key) >= callChance(rec)) return false;
  b.parley.pending.push({ key: rec.key, by: p.id });
  say(b, `${cap(rec.name)} call out to ${p.name}.`, "info");
  loudCall(b, rec, u);
  return true;
}
// Their call, as loud as the stance they show (PARLEY.LOUD: a hostile shout carries as yours does).
function loudCall(b, rec, u) {
  const frac = PARLEY.LOUD[shownOf(rec)] || 0;
  if (frac > 0) shout(null, b, u, "enemy", frac, `${cap(rec.name)}'s shouting carries: others heard it too.`);
}
// combat.js detect / notice: enemy person e has just seen unit p of yours. True when the alarm is not raised: their
// pod calls out instead (a standoff, the card at the next tick), or you got the drop on them this turn.
export function parleySpotted(b, e, p) {
  if (!b || !b.parley || !e || e.kind !== "human" || e.side !== "enemy") return false;
  const rec = recOf(b, e);
  if (!rec) return false;
  if (rec.ambush === b.turn) return true; // Attack them: they do not see it coming until their turn
  if (rec.calledOut || rec.turned || rec.brokeTruce === "player") return false;
  rec.calledOut = true; // one roll a group
  if (roll(b, "call", rec.key) >= callChance(rec)) return false;
  rec.seen = true;
  if (!toThird(b, rec)) return false;
  rec.standoff = true;
  rec.standoffAt = b.turn;
  b.parley.pending.push({ key: rec.key, by: p.id });
  say(b, `${e.name} spots ${p.name}, but ${rec.name} hold their fire and call out.`, "danger");
  loudCall(b, rec, e);
  return true;
}

// ---------- sight ----------
// Can unit a see unit t (the same floor; the floor swapped in for the check when it is not the one shown)?
function sees(b, a, t) {
  if ((a.f || 0) !== (t.f || 0)) return false;
  const view = b.floor || 0, f = a.f || 0;
  if (b.floors && f !== view) setFloor(b, f);
  const ok = canSee(b, a, t);
  if (b.floors && (b.floor || 0) !== view) setFloor(b, view);
  return ok;
}
const seesYou = (b, theirs) => b.units.some((p) => p.side === "player" && activeAny(p) && theirs.some((u) => sees(b, u, p)));
const seenByYou = (b, theirs) => b.units.some((p) => p.side === "player" && activeAny(p) && theirs.some((u) => sees(b, p, u)));

// ---------- the turn (combat.js: after a player's action, at the start of each player turn; the enemy phase) ----------
export function parleyTick(state, b) {
  if (!on(b) || b.over) return;
  const P = ensureRecords(state, b);
  if (!P) return;
  for (const rec of P.groups) if (!rec.seen) { const st = standing(b, rec); if (st.length && seenByYou(b, st)) rec.seen = true; }
  // A tell given (a treacherous group edging closer): whoever of yours watches them may see through it.
  for (const rec of P.groups) if (rec.treacherous && !rec.unmasked && rec.tellAt != null && b.turn - rec.tellAt <= 1) for (const p of speakersFor(state, b, rec)) seeThrough(state, b, rec, p);
  while (P.pending.length) {
    const c = P.pending.shift();
    const rec = recByKey(b, c.key);
    if (rec && standing(b, rec).length && !rec.turned) openCard(state, b, rec, { by: "them", speaker: null, saw: c.by }); // the best talker who sees them answers
  }
  // One of yours out, some still in: an allied group that fought beside you asks for its share (once).
  if (b.units.some((u) => u.side === "player" && u.left && !u.dead) && b.units.some((u) => u.side === "player" && activeAny(u)))
    for (const rec of P.groups) if (!rec.splitAsked && canSplit(b, rec) && standing(b, rec).length && !cardFor(state, rec.key)) { rec.splitAsked = true; splitCard(state, b, rec); }
}
// combat.js endPlayerTurn, before the enemy's actions are dealt: the betrayals, a standoff's patience, the time you had
// to get out, and whoever you got the drop on knowing it now.
export function parleyEnemyPhase(b) {
  if (!b || !b.parley || b.over) return;
  const B = PARLEY.BETRAY;
  for (const rec of b.parley.groups) {
    const theirs = standing(b, rec);
    if (!theirs.length) continue;
    if (rec.ambush != null) { for (const u of theirs) if (u.side === "enemy" && !u.aware) u.aware = true; rec.ambush = null; }
    if (rec.allied && theirs.some((u) => u.ally)) rec.fought.turns++;
    const calm = theirs.some((u) => u.side === "third") && (rec.truce || rec.leaving || rec.standoff);
    if (!calm) continue;
    if (rec.treacherous && !rec.unmasked) {
      const close = b.units.filter((p) => p.side === "player" && activeAny(p) && theirs.some((u) => (u.f || 0) === (p.f || 0) && dist(u, p) <= B.near)).length;
      if ((rec.betrayAt != null && b.turn >= rec.betrayAt) || close >= B.close) {
        rec.brokeTruce = rec.brokeTruce || "them";
        rec.betrayed = true;
        turnHostile(b, rec, `It was a trap! ${cap(rec.name)} open fire!`);
        continue;
      }
    }
    if (rec.standoff && rec.standoffAt != null && b.turn >= rec.standoffAt + PARLEY.STANDOFF_TURNS) { turnHostile(b, rec, `${cap(rec.name)} are done waiting for an answer.`); continue; }
    if (rec.leaving && rec.goes === "you" && rec.leaveBy != null && b.turn >= rec.leaveBy && seesYou(b, theirs)) turnHostile(b, rec, `Time is up: ${rec.name} see your people still here and open fire.`);
  }
}

// ---------- calling out (combat.js combatAct "callout") ----------
// Why unit u (yours) cannot call out to unit t now: "" when it can. (Needs an action, sight of t, a person in a group.)
export function callOutRefusal(state, b, u, t) {
  if (!b || !b.raid) return "Only on a raid.";
  if (!on(b)) return "Nobody here will talk.";
  if (!u || u.side !== "player" || !active(u)) return "That unit cannot act.";
  if (u.ap < 1) return "No action left.";
  if (!t || t === u || t.side === "player") return "Call out to whom?";
  if (!other(t)) return "There is nobody to talk to there.";
  if (!activeAny(t) || t.surr || t.tied) return `${first(t.name)} cannot answer now.`;
  if (t.folk === "survivors") return "They only talk through their barricade: go to their door.";
  if ((t.f || 0) !== (u.f || 0)) return "They are on another floor.";
  if (!sees(b, u, t)) return `${first(u.name)} cannot see ${first(t.name)}: you have to see them to call out.`;
  const rec = recOf(b, t);
  if (rec && rec.brokeTruce === "player") return `${cap(rec.name)} will not talk to you again: your people broke their word.`;
  if (rec && rec.leaving && rec.goes === "them") return `${cap(rec.name)} are on their way out.`;
  if (rec && cardFor(state, rec.key)) return `${cap(rec.name)} are talking to you already: answer them first.`;
  return "";
}

// The units u can call out to now: one per group, the nearest it can see.
export function callOutTargets(state, b, u) {
  if (!on(b) || !u || u.side !== "player" || !active(u) || u.ap < 1) return [];
  const best = new Map();
  for (const t of b.units) {
    if (!other(t) || !activeAny(t) || (t.f || 0) !== (u.f || 0)) continue;
    const k = keyOf(t), d = dist(u, t);
    if (best.has(k) && best.get(k).d <= d) continue;
    if (callOutRefusal(state, b, u, t)) continue;
    best.set(k, { t, d });
  }
  return [...best.values()].sort((p, q) => p.d - q.d).map((o) => o.t);
}

// The action: 1 action, a shout (the dead and the unaware hear it), the card. Returns "" or why not.
export function callOut(state, b, u, t) {
  const why = callOutRefusal(state, b, u, t);
  if (why) return why;
  ensureRecords(state, b);
  const rec = recOf(b, t);
  if (!rec) return "There is nobody to talk to there.";
  u.ap -= 1;
  u.hunker = false;
  rec.calledOut = true;
  rec.seen = true;
  if (toThird(b, rec)) { rec.turned = false; rec.standoff = true; rec.standoffAt = b.turn; } // an enemy pod, aware or not (or a group that turned): guns up, waiting for what you say
  say(b, `${u.name} calls out to ${rec.name}.`, "info");
  const cost = shout(state, b, u, "player", 1, `${first(u.name)}'s shout carries: others heard it too.`);
  openCard(state, b, rec, { by: "you", speaker: u.id, shout: cost });
  return "";
}

// ---------- a shout's stakes ----------
// How crowded the place is, 0..1 (PARLEY.DENSE): the tile's terrain, a city crawl's block, the dead in it.
const groundOf = (state, b) => { const D = PARLEY.DENSE, t = state && state.tiles && b.tileId != null ? state.tiles[b.tileId] : null; return t ? D.terrain[t.terrain] ?? D.other : D.other; };
function density(state, b) {
  const D = PARLEY.DENSE;
  const ground = state ? groundOf(state, b) : b.parley && b.parley.ground != null ? b.parley.ground : D.other; // b.parley.ground: their call (no state at hand)
  const crawl = b.setup && b.setup.context && b.setup.context.crawl;
  return clamp(ground + (crawl ? D.perBlock * Math.max(0, (crawl.block || 1) - 1) : 0) + (b.infection || 0) * D.infection, 0, 1);
}
// What a Call out shout would cost now (the button's tip, the card): { radius, heat, risk, density, wave, text }, null off a
// raid (state may be null: the tile's part from b.parley.ground).
//   radius  - tiles: the dead and the unaware within it come (combat.js alertNear)
//   heat    - the Heat it adds at the end of the turn (b.noise: combat.js raidTurn)
//   risk    - "low" | "some" | "high": high when it tips the Heat a stage this turn (a wave of the dead, while the raid's
//             spawn cap has room); some within DENSE.near Heat of the next stage after it, or a stage that sends the dead already
//   wave    - true when it would bring a wave (risk high)
export function shoutCost(state, b) {
  if (!b || !b.raid) return null;
  const D = PARLEY.DENSE, K = RAID_HEAT, R = b.raid;
  const d = density(state, b);
  const radius = Math.round(PARLEY.SHOUT + D.reach * d), heat = Math.round(PARLEY.HEAT + D.heat * d);
  const next = (R.heat || 0) + K.turn + (b.noise || 0) * K.noise + (b.infection || 0) * K.infection; // the turn's end without it
  const stage = Math.max(R.stage || 0, Math.min(3, Math.floor(next / K.stage)));
  const room = (R.spawnCap ?? 1) - (R.spawned || 0) > 0;
  const wave = room && stage < 3 && Math.floor((next + heat * K.noise) / K.stage) > stage;
  const risk = wave ? "high" : room && (stage >= 2 || (stage < 3 && K.stage * (stage + 1) - (next + heat * K.noise) <= D.near)) ? "some" : "low";
  return { radius, heat, risk, density: Math.round(d * 100) / 100, wave, text: `heard ${radius} tiles off, Heat +${heat}${wave ? ": enough to bring more of the dead" : risk === "some" ? ": the dead are close to stirring" : ""}` };
}
// A shout from unit u (frac of a full one): the noise, its Heat, the unaware near it woken. Returns its shoutCost (null: none).
function shout(state, b, u, side, frac, line) {
  const c = shoutCost(state, b);
  if (!c || !(frac > 0)) return null;
  const r = Math.max(1, Math.round(c.radius * frac)), heat = Math.round(c.heat * frac);
  fx(b, { type: "noise", x: u.x, y: u.y, r, side, kind: "shout" });
  b.noise = (b.noise || 0) + heat;
  alertNear(b, u.x, u.y, r, line);
  return frac === 1 ? c : { ...c, radius: r, heat };
}

// ---------- the raid bot's call (combat.js autoRaidTurn) ----------
// A group for the bot to call out to now, and who calls: { unit, target } or null. A third side your people have no
// word with yet, or an unaware hostile pod that outnumbers your people standing (BOT.lose; the badly hurt count half)
// - not one that is hostile and aware. Weighed: BOT.gain × the odds of the best talker of yours who sees them and has an
// action (a third side: Fight with us or What do you know; a pod: a truce) − BOT.risk[the shout's risk] ≥ BOT.min.
// Once a group a battle (rec.botCalled), again while it stands off; never on the way out but to a pod.
export function botCallOut(state, b, leaving = false) {
  if (!on(b) || !b.parley || b.over) return null;
  const W = PARLEY.BOT;
  const risk = W.risk[(shoutCost(state, b) || {}).risk] || 0;
  const ours = b.units.filter((p) => p.side === "player" && active(p)).reduce((a, p) => a + (p.hp < W.hurt ? 0.5 : 1), 0);
  for (const rec of b.parley.groups) {
    if ((rec.botCalled && !rec.standoff) || rec.brokeTruce === "player" || rec.joining || rec.leaving || cardFor(state, rec.key)) continue;
    const theirs = standing(b, rec);
    if (!theirs.length) continue;
    const third = theirs.some((u) => u.side === "third");
    let opts;
    if (third) { if (leaving || (!rec.standoff && (rec.truce || rec.allied || rec.talks > 0))) continue; opts = ["ally", "info"]; }
    else { if (theirs.some((u) => u.aware) || theirs.length < ours * W.lose) continue; opts = ["truce"]; }
    for (const p of speakersFor(state, b, rec)) {
      if (p.vol != null || !active(p) || p.ap < 1) continue; // volunteers.js: they act on their own
      const t = callOutTargets(state, b, p).find((x) => x.pk === rec.key);
      if (!t) continue;
      const odds = Math.max(...opts.map((o) => parleyOdds(state, b, rec, o, p)));
      if (W.gain[third ? "third" : "pod"] * odds - risk < W.min) break; // the best talker's odds, or none
      rec.botCalled = true;
      return { unit: p, target: t };
    }
  }
  return null;
}

// ---------- the odds ----------
// The chance an ask of this option works, by the group's hostility and the speaker's Speech (s: their survivor).
export function parleyOdds(state, b, rec, opt, speaker) {
  const O = PARLEY.ODDS;
  const s = speaker && speaker.sid != null ? survivorById(state, speaker.sid) : null;
  const sp = (s ? skill(s, "speech") : 4) + (hasPerk(s, "smooth") ? O.smooth : 0);
  const ploy = rec.treacherous && !rec.unmasked && (opt === "truce" || opt === "trade" || opt === "ally");
  const h = ploy ? rec.lie : rec.hostility;
  let c = (O.base[opt] ?? 0.5) + O.speech * (sp - 8) - h * (O.h[opt] ?? 0.006);
  if (ploy) c += O.ploy;
  if (hasPerk(s, "silvertongue")) c += O.silvertongue;
  if ((opt === "join" || opt === "truce") && hasPerk(s, "charming")) c += O.charming;
  if (rec.grudge && (opt === "join" || opt === "truce")) c -= PARLEY.GRUDGE.odds; // their group remembers a truce your people broke
  if (opt === "join") {
    c += O.lead * ((s ? skill(s, "leadership") : 4) - 8) + (rec.truce ? O.truced : 0);
    const g = rec.wid != null ? groupById(state, rec.wid) : null;
    if (g) c += O.mood[g.mood] || 0;
    c += foughtBonus(state, rec);
  }
  return clamp(c, O.min, O.max);
}
// Join: fighting side by side, this battle (rec.fought) and before (their group remembers: f.foughtWith, g.fought).
export function foughtBonus(state, rec) {
  const f = rec.factionId != null ? factionById(state, rec.factionId) : null;
  const g = rec.wid != null ? groupById(state, rec.wid) : null;
  const pts = foughtScore(rec) + ((f && f.foughtWith) || 0) + ((g && g.fought) || 0);
  return Math.min(PARLEY.ODDS.foughtMax, pts * PARLEY.ODDS.fought);
}
const fireChance = (rec) => clamp((rec.hostility - PARLEY.FIRE.from) / (100 - PARLEY.FIRE.from), 0, 1) * PARLEY.FIRE.max;

// ---------- the card ----------
const SAID = {
  them: { friendly: `"Hey! Easy — we're friendly."`, neutral: `"Stop there. Who are you with?"`, hostile: `"Drop what you're carrying and walk away."` },
  you: { friendly: `"We hear you. Nobody needs to get hurt."`, neutral: `"Close enough. Say what you want."`, hostile: `"Talk fast."` },
};
const cardFor = (state, key) => (state.cards || []).find((c) => c && c.battle && c.parley === key) || null;
// A unit's Speech as the odds use it (Smooth Talker's +2 in).
function speechOf(state, u) {
  const s = u && u.sid != null ? survivorById(state, u.sid) : null;
  return s ? skill(s, "speech") + (hasPerk(s, "smooth") ? PARLEY.ODDS.smooth : 0) : 4;
}
// Who of yours can speak to the group: those standing who see one of theirs, the best talkers first.
function speakersFor(state, b, rec) {
  const theirs = standing(b, rec);
  return b.units.filter((p) => p.side === "player" && activeAny(p) && theirs.some((t) => sees(b, p, t))).sort((p, q) => speechOf(state, q) - speechOf(state, p) || p.id - q.id);
}
// The speaker: the one asked for (the caller, or picked: Let them speak), else the best talker who sees them, else the
// one they saw, else the nearest of yours standing.
function speakerOf(state, b, rec, o) {
  const ok = (u) => u && u.side === "player" && activeAny(u);
  const u = o.speaker != null ? unitById(b, o.speaker) : null;
  if (ok(u)) return u;
  const best = speakersFor(state, b, rec)[0];
  if (best) return best;
  const saw = o.saw != null ? unitById(b, o.saw) : null;
  if (ok(saw)) return saw;
  const theirs = standing(b, rec);
  return b.units.filter((p) => p.side === "player" && activeAny(p)).sort((p, q) => Math.min(...theirs.map((t) => dist(p, t))) - Math.min(...theirs.map((t) => dist(q, t))))[0] || null;
}
// Seeing through a treacherous group's lie: once per unit of yours and group, Speech + Scouting (rec.suspect).
function seeThrough(state, b, rec, u) {
  if (!rec.treacherous || rec.unmasked || !u) return false;
  if (rec.suspect[u.id] == null) {
    const S = PARLEY.SUSPECT, s = u.sid != null ? survivorById(state, u.sid) : null;
    rec.suspect[u.id] = roll(b, "suspect", rec.key, u.id) < clamp((s ? skill(s, "speech") + skill(s, "scouting") : 4) * S.per, S.min, S.max);
  }
  return !!rec.suspect[u.id];
}
const seenThrough = (rec) => Object.values(rec.suspect || {}).some(Boolean);
// The card goes in front of the queue (after any other battle card): ui.js shows a battle card while it is first.
function putCard(state, card) {
  const old = state.cards.findIndex((c) => c && c.battle && c.parley === card.parley);
  if (old >= 0) state.cards.splice(old, 1);
  const i = state.cards.findIndex((c) => !(c && c.battle));
  state.cards.splice(i < 0 ? state.cards.length : i, 0, card);
}
function haulCount(b) {
  let n = 0;
  for (const u of b.units) if (u.side === "player" && u.haul) n += Object.values(u.haul.sup).filter((v) => v > 0).length + u.haul.gear.length;
  return n;
}
function openCard(state, b, rec, o) {
  const p = state.parties.find((x) => x.id === b.setup.partyId);
  const sp = speakerOf(state, b, rec, o);
  if (!sp) return null;
  rec.speaker = sp.id;
  const cands = speakersFor(state, b, rec);
  if (!cands.includes(sp)) cands.unshift(sp);
  const theirs = standing(b, rec);
  const n = theirs.length;
  const armed = theirs.filter((u) => u.weapon && u.weapon !== "fists").length;
  const shown = shownOf(rec);
  const hostileShown = shown === "hostile";
  const s = sp.sid != null ? survivorById(state, sp.sid) : null;
  void s;
  const wary = seeThrough(state, b, rec, sp); // the speaker sees through their lie
  const off = wary ? ` Something is off about them: they look at each other too much. ${first(sp.name)} does not trust it.` : "";
  const risky = (h) => (wary ? `Risky: ${first(sp.name)} does not trust them. ${h}` : h);
  const talker = ` Speaking: ${sp.name} (Speech ${speechOf(state, sp)}).`;
  const who = `${n === 1 ? "One of them" : `${n} of them`}${armed ? `, ${armed === n ? (n === 1 ? "armed" : "all armed") : `${armed} armed`}` : ", unarmed"}.`;
  const now = rec.standoff ? " Guns up on both sides; nobody fires while you answer." : rec.allied ? " They are fighting beside you." : rec.truce ? " There is a truce between you." : rec.leaving ? " You agreed to keep apart." : "";
  const heard = o.shout && !o.again && !o.switched ? o.shout : null;
  const lead = o.switched ? `${sp.name} steps up to talk to ${rec.name}.` : o.again ? `${cap(rec.name)} wait for your answer.` : o.by === "them" ? `${cap(rec.name)} call out to ${first(sp.name)}: ${SAID.them[shown]}` : `${sp.name} calls out to ${rec.name}. ${SAID.you[shown]}`;
  const odds = (opt) => parleyOdds(state, b, rec, opt, sp);
  const asked = (opt) => rec.tried[opt] === b.turn;
  const live = (fn) => (st) => {
    if (st.combat !== b || b.over) return "Too late: the fight is over.";
    if (!standing(b, rec).length) return `${cap(rec.name)} are gone.`;
    if (rec.brokeTruce === "player" && fn !== attackFn) return `${cap(rec.name)} will not talk to you again: your people broke their word.`;
    if (rec.turned && !unitsOf(b, rec).some((u) => u.side === "third") && fn !== attackFn) return `${cap(rec.name)} are past talking.`;
    b.rev = (b.rev || 0) + 1; // the battle screen draws it again
    return fn(st);
  };
  const choices = [];
  const shut = () => rec.brokeTruce === "player"; // they will not talk to you again (your people broke their word)
  const add = (opt, label, hint, ai, fn) => choices.push({ label, hint: asked(opt) ? `You asked that already this turn. ${hint}` : hint, disabled: () => asked(opt) || shut(), ai: (st) => (asked(opt) || shut() ? 0 : ai(st)), resolve: live(fn) });
  const f = rec.factionId != null ? factionById(state, rec.factionId) : null;
  const fireText = fireChance(rec) > 0 ? `; if not, ${pct(fireChance(rec))} they open fire` : "; if not, they just refuse";
  if (!rec.truce) add("truce", o.by === "them" ? (hostileShown ? "Talk them down" : "Answer them") : "Hold your fire", risky(`${pct(odds("truce"))}: a truce, both sides hold their fire (${first(sp.name)}'s Speech, how hostile they are)${fireText}`),
    () => (rec.standoff || hostileShown ? 1 : 0.5) * odds("truce"), (st) => ask(st, b, rec, "truce", sp, o));
  if (!rec.leaving) add("walk", "Let's both walk away", `${pct(odds("walk"))}: ${rec.home ? `this is their ground: your people have ${PARLEY.LEAVE_TURNS} turns to get out of their sight, then they shoot` : "they pack up and leave the map"}; nobody shoots meanwhile${fireText}`,
    () => (rec.home ? 0.15 : 0.3) * odds("walk"), (st) => ask(st, b, rec, "walk", sp, o));
  if (!rec.trade) add("trade", "Trade", risky(`${pct(odds("trade"))}: they will trade once you are out (${f && !b.setup.context?.crawl && attitude(f) !== "Hostile" ? `the trade window with ${f.name}` : "a swap of supplies"}); a truce meanwhile${fireText}`),
    () => 0, (st) => ask(st, b, rec, "trade", sp, o));
  if (!rec.allied && !rec.joining) add("ally", o.by === "them" ? "Watch our backs" : "Fight with us", risky(`${pct(odds("ally"))}: they fight the dead and the hostile groups alongside you for the rest of this fight (nobody of yours shoots them, they never shoot yours); fighting side by side counts with them after, and when you ask them to join${fireText}`),
    () => (hostileShown ? 0 : 0.7) * odds("ally"), (st) => ask(st, b, rec, "ally", sp, o));
  const fb = foughtBonus(state, rec);
  if (!rec.joining) add("join", "Join us", `${pct(odds("join"))}: they leave the map now and ask to join you once you are out (Speech and ${first(sp.name)}'s Leadership${fb > 0 ? `; fought beside you: +${pct(fb)}` : ""})${f ? `; ${f.name} will not like losing them` : ""}${fireText}`,
    () => (hostileShown ? 0 : 0.25) * odds("join"), (st) => ask(st, b, rec, "join", sp, o));
  if (!rec.told) add("info", "What do you know?", `${pct(odds("info"))}: what they know of their floor (the dead and other people marked on the map, the places to search)${fireText}`,
    () => 0.6 * odds("info"), (st) => ask(st, b, rec, "info", sp, o));
  if (canSplit(b, rec)) choices.push({ label: "Split what we found", hint: splitHint(state, rec), disabled: () => !canSplit(b, rec) || shut(), ai: () => splitAi(rec), resolve: live((st) => splitHaul(st, b, rec)) });
  const haul = haulCount(b);
  if (hostileShown && !rec.truce) choices.push({
    label: "Hand over what you found", hint: haul ? `Your people's haul (${haul} kind${haul === 1 ? "" : "s"} of things carried) goes to them; they let you be: a truce` : "Your people carry nothing they want",
    disabled: () => !haul || shut(), ai: () => (haul && !shut() && odds("truce") < 0.35 ? 0.3 : 0), resolve: live((st) => handOver(st, b, rec)),
  });
  const attackFn = (st) => attackThem(st, b, rec, sp);
  choices.push({ label: "Attack them", hint: `They are not ready for it: your people get the drop (they do not react until their turn)${(rec.truce || rec.leaving) && f ? `. Breaking your word costs goodwill with ${f.name}` : ""}`, ai: () => (hostileShown ? 0.02 : 0), resolve: live(attackFn) });
  // Let another of yours speak (free): the card again with the odds as they would have them.
  for (const x of cands.filter((x) => x !== sp).slice(0, 3)) {
    const sx = speechOf(state, x);
    choices.push({ label: `Let ${first(x.name)} speak`, hint: `${x.name}, Speech ${sx}: the odds as ${first(x.name)} would have them (free)`, disabled: () => shut(), ai: () => (sx >= speechOf(state, sp) + 4 && !shut() ? 2 : 0),
      resolve: live((st) => { openCard(st, b, rec, { ...o, speaker: x.id, switched: true }); return `${x.name} speaks for your people.`; }) });
  }
  choices.push({ label: "Never mind", hint: rec.standoff ? "Say nothing more: they stop waiting and go back to fighting" : "Leave it there", ai: () => 0.01, resolve: live(() => neverMind(b, rec)) });
  const card = {
    title: o.by === "them" && !o.again ? `${cap(rec.name)} call out` : `Talking to ${rec.name}`,
    text: `${lead} ${who}${now}${talker}${off}${heard ? ` The shout was ${heard.text}.` : ""}`.replace(/\s+/g, " ").trim(),
    where: b.place, partyId: p ? p.id : undefined, battle: true, parley: rec.key, choices,
    shout: heard || null, // plain data: what the Call out's shout cost (shoutCost), on the card it opened
    speaker: { id: sp.id, name: sp.name, speech: speechOf(state, sp) }, speakers: cands.map((x) => ({ id: x.id, name: x.name, speech: speechOf(state, x) })), // plain data: who talks, who could (parleySpeak)
  };
  putCard(state, card);
  return card;
}

// The UI's speaker switch (card.speakers): the group's card again with unit id speaking (free). "" or why not.
export function parleySpeak(state, key, id) {
  const b = state.combat;
  const rec = recByKey(b, key);
  const c = cardFor(state, key);
  if (!b || b.over || !rec || !c) return "Nobody is talking to them now.";
  if (rec.brokeTruce === "player") return `${cap(rec.name)} will not talk to you again: your people broke their word.`;
  const u = unitById(b, id);
  if (!u || u.side !== "player" || !activeAny(u) || !(c.speakers || []).some((x) => x.id === id)) return "They cannot speak for you now.";
  openCard(state, b, rec, { by: "you", speaker: id, switched: true });
  return "";
}

// One ask: the roll, the speaker's XP, the outcome; a standoff's card comes back while it is not settled.
function ask(st, b, rec, opt, sp, o) {
  rec.tried[opt] = b.turn;
  rec.talks += 1;
  const chance = parleyOdds(st, b, rec, opt, sp);
  const ok = roll(b, "ask", rec.key, opt, b.turn, rec.talks) < chance;
  const s = sp && sp.sid != null ? survivorById(st, sp.sid) : null;
  if (s) gainXp(st, s, "speech", USE.talk + (ok ? USE.talkWon : 0));
  if (s && opt === "join") gainXp(st, s, "leadership", USE.talk + (ok ? USE.talkWon : 0));
  let line;
  if (!ok) {
    if (roll(b, "fire", rec.key, b.turn, rec.talks) < fireChance(rec)) {
      turnHostile(b, rec, `${cap(rec.name)} have heard enough: they open fire!`);
      return `${cap(rec.name)} have heard enough. They open fire.`;
    }
    line = { ally: "They will fight their own fights, thanks.", truce: "They will not lower their guns.", walk: "They will not hear of it.", trade: "They want nothing of yours.", join: "They laugh at that.", info: "They tell you nothing." }[opt];
    say(b, `${cap(rec.name)}: ${line}`, "info");
  } else if (opt === "truce") {
    peace(b, rec);
    line = `${cap(rec.name)} lower their guns: a truce.`;
    say(b, line, "good");
  } else if (opt === "ally") {
    ally(b, rec);
    line = `${cap(rec.name)} will fight beside you: the dead and anyone hostile are fair game, for both of you.`;
    say(b, line, "good");
  } else if (opt === "walk") {
    peace(b, rec);
    rec.leaving = true;
    rec.goes = rec.home ? "you" : "them";
    if (rec.home) rec.leaveBy = b.turn + PARLEY.LEAVE_TURNS;
    line = rec.home ? `${cap(rec.name)} agree: you have ${PARLEY.LEAVE_TURNS} turns to be gone from their sight.` : `${cap(rec.name)} agree to leave you to it and pack up.`;
    say(b, line, "good");
  } else if (opt === "trade") {
    peace(b, rec);
    rec.trade = true;
    line = `${cap(rec.name)} will trade with you once you are out of here.`;
    say(b, line, "good");
  } else if (opt === "join") {
    peace(b, rec);
    rec.joining = true;
    for (const u of standing(b, rec)) { u.left = true; u.ap = 0; }
    if (b.third && rec.tgroup != null && b.third[rec.tgroup]) b.third[rec.tgroup].noCard = true; // wanderers.js: the recruit card is this
    line = `${cap(rec.name)} will come with you: they slip away to wait for you outside.`;
    say(b, line, "good");
  } else {
    rec.told = true;
    line = tell(b, rec);
    say(b, line, "good");
  }
  // A standoff's card comes back until it is settled; a truce with a friendly group offers to fight together.
  if (standing(b, rec).length && (rec.standoff || (ok && opt === "truce" && shownOf(rec) === "friendly" && !rec.allied))) openCard(st, b, rec, { ...o, again: true, switched: false, speaker: sp ? sp.id : o.speaker });
  return line;
}
// ---------- sharing the haul (PARLEY.SPLIT) ----------
// What your people found, by its base worth (b.raid.found, foundGear: what is still the team's).
function foundWorth(b) {
  const R = b.raid;
  if (!R) return 0;
  let v = 0;
  for (const [k, n] of Object.entries(R.found || {})) if (n > 0) v += n * supValue(k);
  for (const it of R.foundGear || []) v += itemValue(it);
  return v;
}
const foughtFor = (rec) => foughtScore(rec) - ((rec.fought && rec.fought.split) || 0); // the points they fought for (a share's not counted)
// A share for an allied group that fought beside you: once, while allied, with something found.
const canSplit = (b, rec) => !!b.raid && !!rec.allied && foughtFor(rec) > 0 && !rec.split && foundWorth(b) > 0;
const splitAi = (rec) => { const S = PARLEY.SPLIT; return Math.min(S.aiMax, S.ai + S.aiPer * foughtFor(rec)); };
function splitHint(state, rec) {
  const O = PARLEY.ODDS, fb = foughtBonus(state, rec);
  const up = Math.max(0, Math.min(O.foughtMax, fb + PARLEY.SPLIT.fought * O.fought) - fb);
  return `A third of what your people found goes to them (each supply found; the found gear up to a third of its worth); it counts with them as fighting together${up > 0 ? ` (Join +${pct(up)})` : ""}, and their group remembers it`;
}
// Split what we found: SPLIT.share of each supply found (from the loose haul, then pockets, the rig and packs, then the
// trunk), and the found gear, the dearest first, up to that share of its worth; to their group's stores when it has them.
function splitHaul(st, b, rec) {
  const R = b.raid, S = PARLEY.SPLIT;
  const f = rec.factionId != null ? factionById(st, rec.factionId) : null;
  const keep = f && f.alive ? f : null;
  const mine = b.units.filter((u) => u.side === "player" && !u.dead);
  const people = mine.map((u) => (u.sid != null ? survivorById(st, u.sid) : null)).filter(Boolean);
  const p = trunkVehicle(st, b) ? st.parties.find((x) => x.id === b.setup.partyId) : null;
  const trunk = p && p.cargo ? p.cargo : null;
  const stowed = (s) => carriedSpots(s).filter((x) => x.where === "pocket" || x.where === "rig" || x.where === "pack"); // never what is worn or in hand
  let worth = 0, kinds = 0;
  for (const [k, n] of Object.entries(R.found)) {
    const want = Math.round(n * S.share);
    if (!(want > 0)) continue;
    let got = 0;
    const take = (have, fn) => { const q = Math.min(Math.floor(have), want - got); if (q > 0) { fn(q); got += q; } };
    for (const u of mine) if (u.haul && got < want) take(u.haul.sup[k] || 0, (q) => { u.haul.sup[k] -= q; });
    for (const s of people) for (const x of stowed(s)) if (got < want && isCountStack(x.item) && stockKeyOf(x.item) === k) take(x.item.dur || 0, (q) => { x.item.dur -= q; if (!(x.item.dur >= 1)) x.take(); });
    if (trunk && trunk.supplies && got < want) take(trunk.supplies[k] || 0, (q) => { trunk.supplies[k] -= q; });
    if (!got) continue;
    R.found[k] -= got;
    if (!(R.found[k] > 0)) delete R.found[k];
    if (keep) keep.stock[k] = (keep.stock[k] || 0) + got;
    worth += got * supValue(k);
    kinds++;
  }
  let budget = (R.foundGear || []).reduce((a, it) => a + itemValue(it), 0) * S.share;
  const where = (it) => {
    for (const u of mine) { const i = u.haul ? u.haul.gear.indexOf(it) : -1; if (i >= 0) return () => u.haul.gear.splice(i, 1); }
    for (const s of people) { const x = stowed(s).find((y) => y.item === it); if (x) return x.take; }
    const i = trunk && trunk.gear ? trunk.gear.indexOf(it) : -1;
    return i >= 0 ? () => trunk.gear.splice(i, 1) : null;
  };
  for (const it of [...(R.foundGear || [])].sort((a, c) => itemValue(c) - itemValue(a))) {
    const v = itemValue(it), off = v <= budget ? where(it) : null;
    if (!off) continue;
    off();
    budget -= v; worth += v; kinds++;
    R.foundGear.splice(R.foundGear.indexOf(it), 1);
    gunLeavesTeam(b, it);
    if (keep) keepItem(st, keep, it, "taken");
  }
  rec.split = { worth: Math.round(worth), kinds };
  if (kinds) rec.fought.split = (rec.fought.split || 0) + S.fought;
  const line = kinds ? `Your people split what they found with ${rec.name}: a third of it goes with them.` : `${cap(rec.name)} wave it off: there is nothing at hand to share.`;
  say(b, line, kinds ? "good" : "info");
  return line;
}
function keepAll(b, rec) {
  rec.kept = true;
  const line = `${cap(rec.name)} say nothing more about it. They will remember.`;
  say(b, line, "info");
  return line;
}
// One of yours is out with the haul: an allied group that fought beside you asks for its share (a card, once).
function splitCard(state, b, rec) {
  const p = state.parties.find((x) => x.id === b.setup.partyId);
  const live = (fn) => (st) => (st.combat !== b || b.over ? "Too late: the fight is over." : !standing(b, rec).length ? `${cap(rec.name)} are gone.` : !rec.allied ? `${cap(rec.name)} are past sharing anything.` : ((b.rev = (b.rev || 0) + 1), fn(st)));
  const n = Object.values(b.raid.found).filter((v) => v > 0).length + b.raid.foundGear.length;
  putCard(state, {
    title: `${cap(rec.name)} ask for a share`,
    text: `"We fought for that too." ${cap(rec.name)} watch your people take out what you found (${n} kind${n === 1 ? "" : "s"} of things).`,
    where: b.place, partyId: p ? p.id : undefined, battle: true, parley: rec.key, split: true,
    choices: [
      { label: "Split what we found", hint: splitHint(state, rec), disabled: () => !canSplit(b, rec), ai: () => splitAi(rec), resolve: live((st) => splitHaul(st, b, rec)) },
      { label: "Keep it all", hint: `They fought beside you for nothing: their group remembers it${rec.factionId != null ? ` (goodwill ${PARLEY.GOODWILL.keptAll})` : ""}`, ai: () => PARLEY.SPLIT.keep, resolve: live(() => keepAll(b, rec)) },
    ],
  });
}
function neverMind(b, rec) {
  if (rec.standoff) { turnHostile(b, rec, `${cap(rec.name)} take that for an answer and raise their guns.`); return "They raise their guns."; }
  return "You leave it there.";
}
// Attack them: they flip (a third-side group by thirdSideHit: soldiers, every squad on the map), and do not react
// until their turn (rec.ambush: combat.js detect does not raise their alarm meanwhile).
function attackThem(st, b, rec, sp) {
  const theirs = standing(b, rec);
  const t0 = theirs.find((u) => u.side === "third");
  if (rec.truce || rec.leaving || rec.standoff || rec.talks > 0 || rec.speaker != null) rec.brokeTruce = rec.brokeTruce || "player"; // after talking: your word is broken
  rec.attacked = true;
  if (t0 && b.third && b.third[t0.tgroup] && !b.third[t0.tgroup].fromEnemy && sp) thirdSideHit(b, t0, sp);
  else toEnemy(b, rec, false);
  hostile(rec, b);
  for (const u of theirs) if (u.side === "enemy") u.aware = false;
  rec.ambush = b.turn;
  const line = `${sp ? first(sp.name) : "Your people"} give${sp ? "s" : ""} the word: ${rec.name} do not see it coming.`;
  say(b, line, "good");
  return line;
}
// Hand over what you found: everything your people carry by hand goes (to their group's stores when they have one).
function handOver(st, b, rec) {
  const R = b.raid;
  const gear = [];
  let kinds = 0;
  const f = rec.factionId != null ? factionById(st, rec.factionId) : null;
  for (const u of b.units) {
    if (u.side !== "player" || !u.haul) continue;
    const h = u.haul;
    for (const [k, v] of Object.entries(h.sup)) {
      if (!(v > 0)) continue;
      kinds++;
      if (R.found[k]) { R.found[k] = Math.max(0, R.found[k] - v); if (!R.found[k]) delete R.found[k]; }
      if (f && f.alive) f.stock[k] = (f.stock[k] || 0) + v;
      h.sup[k] = 0;
    }
    for (const it of h.gear.splice(0)) {
      kinds++;
      gear.push(it);
      const i = R.foundGear.indexOf(it);
      if (i >= 0) R.foundGear.splice(i, 1);
      gunLeavesTeam(b, it);
      if (f && f.alive) keepItem(st, f, it, "taken");
    }
  }
  rec.gave = { kinds, gear: gear.length };
  peace(b, rec);
  const line = `Your people set down what they found and back off. ${cap(rec.name)} let you be.`;
  say(b, line, "info");
  return line;
}
// What they know of their floor: the dead and the other people on it marked (last-seen ghosts), the places to search.
function tell(b, rec) {
  const theirs = standing(b, rec);
  const f = theirs.length ? theirs[0].f || 0 : b.floor || 0;
  const g = b.ghosts || (b.ghosts = {});
  const dead = b.units.filter((u) => u.side === "enemy" && u.kind === "zombie" && activeAny(u) && (u.f || 0) === f);
  const people = b.units.filter((u) => other(u) && activeAny(u) && u.pk !== rec.key && (u.f || 0) === f);
  for (const e of [...dead, ...people.filter((u) => u.side === "enemy")]) g[e.id] = [e.x, e.y, b.turn, f];
  const boxes = b.raid.containers.filter((c) => (c.f || 0) === f && c.kind !== "body" && c.kind !== "ground" && !c.searched && !c.barred);
  for (const c of boxes) c.known = true;
  const groups = [...new Set(people.map((u) => (recOf(b, u) || {}).name).filter(Boolean))];
  return `${cap(rec.name)} tell what they know: ${boxes.length} place${boxes.length === 1 ? "" : "s"} still to search, ${dead.length ? `${dead.length} of the dead about (marked on the map)` : "none of the dead about"}${groups.length ? `, and ${groups.join(" and ")} here too` : ""}.`;
}

// ---------- the badge ----------
// The group a unit belongs to, as seen by your people: null for your own, the dead, or anyone with no group.
// Returns { key, name, stance, shown, hostility, active, truce, leaving, standoff, allied, tell, label, color, leaveBy, goes }:
//   stance    - "friendly" | "neutral" | "hostile": what the group really is
//   shown     - the stance your people see (a treacherous group shows "friendly" until it turns)
//   hostility - 0..100, as shown
//   active    - true when the group is actively hostile: it shoots your people on sight now
//   label     - the indicator's word: "Hostile" | "Unaware" | "Standoff" | "Truce" | "Peaceful" | "Leaving" | "Allied"
//   allied    - fighting beside your people (Fight with us): the dead and the hostile are their foes too
//   tell      - a treacherous group giving itself away right now (edging closer in a truce), and one of yours saw
//               through it: the badge may say so (it changes nothing: they turn when they turn)
//   color     - the indicator's colour (red when active)
//   leaveBy   - turns your people have left to be out of their sight (a walk-away on their ground), else null
//   goes      - who leaves after a walk-away: "you" | "them" | null
export function parleyStatus(b, u) {
  if (!b || !b.raid || !u || !other(u) || u.dead) return null;
  return statusOf(b, recOf(b, u), u);
}
function statusOf(b, rec, u) {
  const third = u.side === "third";
  const active = u.side === "enemy" && !!u.aware;
  const truce = !!rec && third && rec.truce, standoff = !!rec && third && rec.standoff, leaving = !!rec && third && rec.leaving, allied = !!rec && third && rec.allied && !!u.ally;
  const tell = !!rec && rec.treacherous && !rec.unmasked && seenThrough(rec) && rec.tellAt != null && b.turn - rec.tellAt <= 1; // a tell your people have seen through
  const label = !third ? (u.aware ? "Hostile" : "Unaware") : standoff ? "Standoff" : leaving ? "Leaving" : allied ? "Allied" : truce ? "Truce" : "Peaceful";
  const stance = rec ? rec.stance : third ? "neutral" : "hostile";
  return {
    key: rec ? rec.key : keyOf(u), name: rec ? rec.name : third ? (b.third && b.third[u.tgroup] ? b.third[u.tgroup].name : "the survivors") : KIT_NAME[u.kit] || "armed strangers",
    stance, shown: rec ? shownOf(rec) : stance, hostility: rec ? shownHostility(rec) : third ? 40 : 80,
    active, truce, leaving, standoff, allied, tell, label, color: COLOR[label],
    leaveBy: leaving && rec.goes === "you" && rec.leaveBy != null ? Math.max(0, rec.leaveBy - b.turn) : null, goes: leaving ? rec.goes : null,
  };
}

// Every group your people have seen on this map (for the raid's top strip): [{ ...parleyStatus, count, seen }].
export function parleyGroupsSeen(b) {
  if (!b || !b.parley) return [];
  const out = [];
  for (const rec of b.parley.groups) {
    if (!rec.seen) continue;
    const st = standing(b, rec);
    if (!st.length) continue;
    const rep = st.find((u) => u.side === "enemy" && u.aware) || st.find((u) => u.side === "third") || st[0];
    out.push({ ...statusOf(b, rec, rep), count: st.length, seen: true });
  }
  return out;
}

// ---------- the end (combat.js endRaid) ----------
// The pods that held their fire are the enemy's again (the result counts them as theirs; a building's snapshot keeps them).
export function parleyEnd(b) {
  if (!b || !b.parley) return;
  for (const u of b.units) {
    if (u.pfrom == null || u.side !== "third") continue;
    u.side = "enemy"; u.pod = u.pfrom;
    delete u.pfrom; delete u.tgroup; delete u.team; delete u.ally;
  }
}
// result.parley: a line per group (plain, but joiners: the very people who agreed to come).
export function parleyResult(b) {
  if (!b || !b.parley) return null;
  const out = b.units.some((u) => u.side === "player" && u.left && !u.dead), worth = foundWorth(b);
  return b.parley.groups.map((rec) => {
    const mine = unitsOf(b, rec);
    return {
      key: rec.key, name: rec.name, factionId: rec.factionId, wid: rec.wid, team: rec.team, party: rec.party, home: rec.home, fromEnemy: rec.fromEnemy,
      stance: rec.stance, treacherous: rec.treacherous, seen: rec.seen, talked: rec.talks > 0, truce: rec.truce && !rec.turned,
      brokeTruce: rec.brokeTruce, betrayed: rec.betrayed, attacked: rec.attacked, trade: rec.trade && !rec.turned, joining: rec.joining, told: rec.told, gave: rec.gave,
      allied: rec.allied, fought: foughtScore(rec), foughtBy: { ...rec.fought },
      split: rec.split, kept: !!rec.kept, keptAll: out && !!rec.allied && foughtFor(rec) > 0 && !(rec.split && rec.split.kinds) && !rec.brokeTruce && worth >= PARLEY.SPLIT.min, // SPLIT: shared, or out with the haul after they fought
      start: mine.length, dead: mine.filter((u) => u.dead).length,
      joiners: rec.joining ? mine.filter((u) => u.left && !u.dead).map((u) => u.who || { name: u.name }) : [],
    };
  });
}

// ---------- after the raid (scavenge.js afterRaid, citycrawl.js afterPlace) ----------
// The groups remember: a truce kept, a truce you broke (worse than an attack), an attack, their people taken.
export function parleyGoodwill(state, result) {
  const G = PARLEY.GOODWILL;
  for (const r of (result && result.parley) || []) {
    const f = r.factionId != null ? factionById(state, r.factionId) : null;
    if (!f || !f.alive) continue;
    if (r.brokeTruce === "player") { changeGoodwill(state, f, G.broke, "you broke a truce with their people"); f.grudge = { day: day(state), name: r.name }; } // a grudge: PARLEY.GRUDGE_DAYS
    else if (r.attacked && r.team !== "military") changeGoodwill(state, f, G.attack, "you attacked their people"); // a squad's: wanderers.js
    else if (r.truce && r.talked) changeGoodwill(state, f, G.kept, "you kept the peace with their people");
    if (r.joining && r.joiners.length) changeGoodwill(state, f, G.join * r.joiners.length, "you took their people");
  }
  for (const r of (result && result.parley) || []) if (r.brokeTruce === "player" && r.wid != null) { const g = groupById(state, r.wid); if (g) g.grudge = { day: day(state) }; } // a wanderer group remembers too
  // The haul: shared with those who fought beside you, or kept from them (PARLEY.SPLIT).
  for (const r of (result && result.parley) || []) {
    const f = r.factionId != null ? factionById(state, r.factionId) : null;
    if (r.split && r.split.kinds && !r.brokeTruce && f && f.alive) changeGoodwill(state, f, G.split, "you shared what you found with their people");
    if (!r.keptAll) continue;
    if (f && f.alive) changeGoodwill(state, f, G.keptAll, "you kept all you found after their people fought beside you");
    const g = r.wid != null ? groupById(state, r.wid) : null;
    if (g) g.fought = Math.max(0, (g.fought || 0) - PARLEY.SPLIT.fought);
  }
  // Fighting side by side: their group's goodwill, and what it remembers (foughtBonus); a wanderer group's mood.
  for (const r of (result && result.parley) || []) {
    if (!(r.fought > 0) || r.brokeTruce) continue;
    const f = r.factionId != null ? factionById(state, r.factionId) : null;
    if (f && f.alive) {
      changeGoodwill(state, f, Math.min(G.foughtMax, r.fought * G.fought), "you fought side by side with their people");
      f.foughtWith = Math.min(G.foughtKept, (f.foughtWith || 0) + r.fought);
    }
    const g = r.wid != null ? groupById(state, r.wid) : null;
    if (g) {
      g.fought = Math.min(G.foughtKept, (g.fought || 0) + r.fought);
      g.met += 1; g.talked = true; g.lastMet = state.hour;
      if (g.mood === "wary" && r.fought >= PARLEY.FOUGHT.kill * 1.5) g.mood = "friendly";
    }
  }
}
// The recruit card for those who agreed to come; the swap card for a trade with anyone but a group's trade window
// (opts.crawl: no trade window in a city crawl either).
export function parleyAfterRaid(state, p, result, opts = {}) {
  if (!p || !state.parties.includes(p) || !partyMembers(state, p).length) return;
  for (const r of (result && result.parley) || []) {
    if (r.joining) joinCard(state, p, r);
    if (r.trade && !tradeGroup(state, r, opts)) { const f = r.factionId != null ? factionById(state, r.factionId) : null; barterCard(state, p, r, !opts.crawl && !!f && f.alive); } // shut: a Hostile group's
  }
}
// The group whose trade window opens for a trade agreed on the map: alive, and not Hostile toward you (factions.js
// attitude: its stores stay shut, its people there swap with you as agreed); none in a city crawl. Else null.
function tradeGroup(state, r, opts = {}) {
  const f = !opts.crawl && r.factionId != null ? factionById(state, r.factionId) : null;
  return f && f.alive && attitude(f) !== "Hostile" ? f : null;
}
// The trade window with a group whose people agreed to trade (trade.js openTrade queues it behind one already open).
export function parleyTrade(state, p, result) {
  if (!p || p.owner !== "player" || !state.parties.includes(p) || !partyMembers(state, p).length) return false;
  let opened = false;
  for (const r of (result && result.parley) || []) {
    if (!r.trade) continue;
    const f = tradeGroup(state, r);
    if (!f) continue;
    openTrade(state, p, f);
    opened = true;
  }
  return opened;
}
function joinCard(state, p, r) {
  const f = r.factionId != null ? factionById(state, r.factionId) : null;
  const g = r.wid != null ? groupById(state, r.wid) : null;
  const list = [];
  if (g) list.push(...g.people.filter((s) => !s.dead && s.alive !== false));
  else for (const s of r.joiners) {
    if (s && f && s.fid === f.id && memberById(state, s.id)) { // one of the group's people (members.js): the very person, with what they carry
      removeMember(state, f, s, "left");
      delete s.fid;
      s.mood = 50;
      list.push(s);
    } else { // made for the fight (fighters.js transient): a candidate with their name and their gun
      const c = makeCandidate(state, { quality: 0.8, minHealth: 40, gearChance: 0 });
      if (s && s.name) c.name = s.name;
      if (s && s.gear && s.gear.weapon) c.gear.weapon = s.gear.weapon;
      list.push(c);
    }
  }
  for (const s of list) { s.pending = true; delete s.gone; }
  if (!list.length) return null;
  const n = list.length;
  return offerRecruits(state, list, {
    source: "parley", partyId: p.id, title: n === 1 ? `${first(list[0].name)} wants to come along` : "They want to come along",
    intro: `${cap(r.name)} slipped away from the site as agreed and wait for you outside.`,
  });
}
function barterCard(state, p, r, shut = false) {
  const goods = ["food", "water", "meds", "scrap"];
  const val = (k) => carriedAny(p, k) * supValue(k);
  const V = PARLEY.BARTER;
  const mine = goods.filter((k) => val(k) >= V * 1.5).sort((a, c) => val(c) - val(a)).slice(0, 2);
  const want = [...goods].sort((a, c) => val(a) - val(c));
  const choices = [];
  for (const give of mine) {
    const get = want.find((k) => k !== give);
    const nGive = Math.ceil(V / supValue(give)), nGet = Math.max(1, Math.floor((V * PARLEY.CUT) / supValue(get)));
    choices.push({
      label: `${nGive} ${keyWord(give)} for ${nGet} ${keyWord(get)}`, hint: `You have plenty of ${keyWord(give)} and little ${keyWord(get)}`,
      resolve: (st) => {
        if (!st.parties.includes(p) || carriedAny(p, give) < nGive) return "You no longer have that to trade.";
        takeAny(p, give, nGive);
        const got = addCargo(st, p, get, nGet);
        return `You swap ${nGive} ${keyWord(give)} for ${got} ${keyWord(get)}.`;
      },
    });
  }
  choices.push({ label: "Nothing today", hint: "You part ways", resolve: () => "You part ways." });
  addCard(state, { title: `Trading with ${r.name}`, text: `${cap(r.name)} come out to trade, as agreed.${shut ? " Their group will not open its stores to you, but these ones keep their word." : ""} ${mine.length ? "They have a little of what you are short of." : "You have nothing they want."}`, where: tileLabel(state, partyTile(p)), partyId: p.id, choices });
}
