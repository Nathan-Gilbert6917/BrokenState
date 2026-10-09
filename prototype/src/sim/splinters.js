// Splinter bands: when a group is torn up inside, some of its people walk out together and set up on their own (user,
// 2026-10-08: "raider deserters forming a new splinter band"). Coarse and cheap: one pass a day for the world
// (factions.js factionsDaily, after the groups' own day), counts rather than people.
//
// Strife (f.strife): what a group's people hold against staying. Each day it fades to DECAY of itself and grows by
// PRESSURE × the desertion pressure (groupcare.js desertPressure: hunger, sleeping rough, recent losses, the wounded,
// a war, × the type's harshness), DESERTER for each of them who walked out alone that day (desertOne), BLOW × the share
// of them killed in fights since yesterday (noteFight keeps f.blows), and WAR_LOST for a lost war (diplomacy.js
// makePeace on land or tribute terms; playerwars.js a war on you that ended with them worn out or paying). A heavy
// fight may have taken their leader: the chance is the share killed × LEADER_FRONT (they lead from the front), and a
// group whose leader fell gains LEADER strife at once (f.leaderLost: the day; no leader is modelled, only the blow).
// A split (splitGroup): a group of at least MIN_POP whose strife is AT or more splits ODDS a day × its type's
// GROUP_PRIORITIES splinter × (strife / AT, at most 2), at most once every GAP days and never while the world has as many
// groups as its size allows (worldsize.js groups, the top of the range; CAP more). SHARE of the people (MIN_GO to all
// but KEEP) leave as a new group of the type's splinterAs (raiders and expansionists break off as a raider band, the
// military's deserters too; zealots as a new sect; fortress, traders and communes do not splinter, their unhappy leave
// one by one: groupcare.js desertOne). They set up at a free site RANGE tiles from the old group's main base (an
// abandoned base there is taken over), walk off with their own kit (one loadout a head, spread over the old group's
// best to worst) and SPARE of the spare kit a head's share, and their share of the stores (STOCK × the share of the
// people); the relation between the two is set to REL (feuding: a war may follow, diplomacy.js), and strife at the
// old group falls to AFTER × itself (the malcontents are gone). The new group is hostile to you like any gang
// (factions.js makeGang). Rolls are hashes (skills.js hash01): the world's dice are not touched.
// You hear of it (a log line, and the Affairs screen's news) when either group's radio is heard (radio.js
// canHearGroup), the new camp is in sight, or the old group is one you know with a base within HEAR tiles of yours.
// Expected (tools/splintertest.js rate measures it; 2026-10-08, six Normal worlds of 8 groups, a year each on the Balanced
// autopilot): 7 splits, about one a world-year (0 to 3 a world), five of them raider gangs and expansionists going
// raiding, one zealot sect; the triggers were a fallen leader (3), a lost war (2) and heavy losses (2).
import { day, log } from "./world.js";
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { weightOf, desertPressure, tickOf } from "./groupcare.js";
import { makeGang } from "./factions.js";
import { issueKit, removeFromArsenal, addToArsenal, arsenalShareTo } from "./arsenal.js";
import { relation, changeRelation, news } from "./diplomacy.js";
import { canHearGroup, canListen } from "./radio.js";
import { abandonedAt, occupyAbandoned } from "./groupworld.js";
import { stateSizeDef } from "./worldsize.js";
import { tileLabel } from "./parties.js";

export const SPLINTER = {
  DECAY: 0.96, PRESSURE: 0.06, DESERTER: 1, BLOW: 10, WAR_LOST: 5, LEADER: 5, LEADER_FRONT: 1.2,
  AT: 13, ODDS: 0.02, MIN_POP: 14, GAP: 180, CAP: 0,
  SHARE: [0.2, 0.32], MIN_GO: 4, KEEP: 9, SPARE: 0.5, STOCK: 1, RANGE: [3, 9], CLEAR: 3, CLEAR_YOU: 5,
  REL: -70, AFTER: 0.3, HEAR: 12,
  // Names for a new band (an unused one, else the type's own names: factions.js makeGang).
  NAMES: {
    raider: ["Turncoats", "Broken Spoke", "Ditch Kings", "Free Knives", "Burnt Bridge Crew", "Stray Dogs", "Gravel Saints", "Cut Loose"],
    zealot: ["True Flame", "Second Covenant", "The Unbowed", "Ember Sect", "Children of the Embers"],
  },
};
const h = (state, ...k) => hash01(state.seed, "splinter", ...k);

// ---------- strife ----------
export const strifeOf = (f) => (f && f.strife) || 0;
// A blow to a group (a lost war, a fallen leader): strife at once. why: what is said of it when it splits.
export function noteStrife(f, amount, why = null) {
  if (!f || f.outsider || !(amount > 0)) return;
  f.strife = strifeOf(f) + amount;
  if (why) f.strifeWhy = why;
}
// The day's strife (splinterDaily): fade, the pressure, the fights' dead (f.blows: the share killed, from noteFight)
// and perhaps the leader with them.
export function strifeDay(state, f, d = day(state)) {
  const S = SPLINTER;
  const blows = f.blows || 0;
  f.blows = 0;
  let s = strifeOf(f) * S.DECAY + S.PRESSURE * desertPressure(state, f) + S.BLOW * blows;
  if (blows > 0 && h(state, f.name, tickOf(f), "leader") < blows * S.LEADER_FRONT) {
    s += S.LEADER;
    f.leaderLost = d;
    f.strifeWhy = "leader";
  } else if (blows * S.BLOW >= 1) f.strifeWhy = "losses";
  f.strife = s < 0.01 ? 0 : Math.round(s * 1000) / 1000;
  return f.strife;
}

// ---------- the split ----------
const liveGroups = (state) => state.factions.filter((f) => f.alive && !f.outsider);
export const groupRoom = (state) => (stateSizeDef(state).groups || [0, 10])[1] + SPLINTER.CAP - liveGroups(state).length;
// Today's chance this group splits (0 when it cannot).
export function splitChance(state, f, d = day(state)) {
  const S = SPLINTER;
  const w = weightOf(f, "splinter", 0);
  if (!w || !f.alive || f.outsider || f.hcNoGrow || !f.bases.length || f.pop < S.MIN_POP || strifeOf(f) < S.AT) return 0;
  if (f.splitDay != null && d - f.splitDay < S.GAP) return 0;
  if (groupRoom(state) <= 0) return 0;
  return S.ODDS * w * Math.min(2, strifeOf(f) / S.AT);
}
// Where the new band sets up: a free site RANGE tiles from the old main base, away from every base (CLEAR, CLEAR_YOU
// from yours) and the hives; an abandoned base first (its works are theirs). null: nowhere (no split).
export function splinterSite(state, f) {
  const S = SPLINTER, g = state.grid, home = f.bases[0];
  const ok = (t) => {
    if (!t || t.hive || state.bases.some((b) => g.distance(b.tile, t.id) < S.CLEAR_YOU)) return false;
    if (!(t.loc && t.loc.type !== "city") && !abandonedAt(state, t.id)) return false;
    if (t.owner != null && t.owner !== f.id) return false;
    if ((state.hives || []).some((hv) => g.distance(hv.tile, t.id) < S.CLEAR)) return false;
    if ((state.hordes || []).some((hh) => hh.tile === t.id)) return false;
    return state.factions.every((o) => !o.alive || o.bases.every((b) => g.distance(b, t.id) >= S.CLEAR));
  };
  const cands = g.within(home, S.RANGE[1]).filter((id) => g.distance(id, home) >= S.RANGE[0]).map((id) => state.tiles[id]).filter(ok).sort((a, b) => a.id - b.id);
  if (!cands.length) return null;
  const left = cands.filter((t) => abandonedAt(state, t.id));
  const pool = left.length ? left : cands;
  return pool[Math.floor(h(state, f.name, tickOf(f), "site") * pool.length) % pool.length].id;
}
const WHY_TEXT = { leader: "after their leader fell", losses: "after the losses they took", war: "after the war they lost", hunger: "over empty bellies", deserters: "as more and more of them slipped away" };
const whyOf = (state, f) => f.strifeWhy || ((f.stock.food || 0) < f.pop * 2 ? "hunger" : "deserters");
// The split itself: returns the new group, or null.
export function splitGroup(state, f, d = day(state)) {
  const S = SPLINTER;
  const tile = splinterSite(state, f);
  if (tile == null) return null;
  const pop0 = f.pop;
  const share = S.SHARE[0] + (S.SHARE[1] - S.SHARE[0]) * h(state, f.name, tickOf(f), "share");
  const n = Math.max(S.MIN_GO, Math.min(pop0 - S.KEEP, Math.round(pop0 * share)));
  if (n < S.MIN_GO) return null;
  const type = weightOf(f, "splinterAs", "raider");
  const used = new Set(state.factions.map((x) => x.name));
  const names = (S.NAMES[type] || []).filter((x) => !used.has(x));
  const name = names.length ? names[Math.floor(h(state, f.name, tickOf(f), "name") * names.length) % names.length] : null;
  // Their own kit: n loadouts spread over the old group's best to worst, and a share of the spare kit.
  const kit = [];
  if (f.arsenal) {
    const issue = issueKit(state, f, pop0, "home");
    for (let j = 0; j < n; j++) {
      const lo = issue[Math.min(issue.length - 1, Math.floor(((j + 0.5) * issue.length) / n))];
      for (const it of lo ? [lo.weapon, ...Object.values(lo.armour)] : []) if (it && !kit.includes(it) && removeFromArsenal(f, it, "deserted")) kit.push(it);
    }
    arsenalShareTo(state, f, (S.SPARE * n) / pop0, kit);
  }
  // Their share of the stores.
  const stock = {};
  for (const [k, q] of Object.entries(f.stock)) {
    if (!(q > 0)) continue;
    const take = Math.floor(q * Math.min(1, (S.STOCK * n) / pop0));
    if (take > 0) { stock[k] = take; f.stock[k] -= take; }
  }
  f.pop -= n;
  if ((f.wounded || 0) > f.pop) f.wounded = f.pop;
  if (f.arsenal) f.arsenal.pop0 = f.pop;
  const why = whyOf(state, f);
  const ng = makeGang(state, tile, { type, pop: n, name, rng: new Rng(Math.floor(h(state, f.name, tickOf(f), "rng") * 2 ** 31)) });
  // makeGang gives a gang from beyond the border its stores and kit: this one has only what it walked off with.
  ng.stock = Object.fromEntries(Object.keys(ng.stock).map((k) => [k, 0]));
  for (const [k, q] of Object.entries(stock)) ng.stock[k] = q;
  if (ng.arsenal) {
    for (const it of [...ng.arsenal.items]) removeFromArsenal(ng, it, "none");
    ng.arsenal.stats = { in: {}, out: {} };
    ng.arsenal.seeded = 0;
    for (const it of kit) addToArsenal(state, ng, it, "deserter");
    ng.arsenal.pop0 = ng.pop;
  }
  ng.splitFrom = f.id;
  ng.splitDay = d;
  ng.strife = 0;
  occupyAbandoned(state, ng, tile); // groupworld.js: the works and stores left there are theirs
  changeRelation(state, f, ng, S.REL - relation(state, f, ng));
  f.splitDay = d;
  f.splits = (f.splits || 0) + 1;
  f.strife = Math.round(strifeOf(f) * S.AFTER * 1000) / 1000;
  f.strifeWhy = null;
  state.stats.splinters = (state.stats.splinters || 0) + 1;
  announce(state, f, ng, n, why);
  return ng;
}
// The word of it: a log line when you would hear (see the header), and the Affairs screen's news.
function announce(state, f, ng, n, why) {
  const g = state.grid;
  const neighbour = f.known && state.bases.some((b) => f.bases.concat(ng.bases).some((t) => g.distance(b.tile, t) <= SPLINTER.HEAR));
  const seen = state.live.has(ng.bases[0]);
  const heard = canHearGroup(state, f) || canHearGroup(state, ng) || seen || neighbour;
  if (heard) { ng.known = true; f.known = true; }
  const who = f.known ? f.name : "A group out in the dead lands";
  const text = `${who} has split ${WHY_TEXT[why] || ""}: ${n} of them walked out with their guns and set up as ${ng.name} at ${tileLabel(state, ng.bases[0])}. The two are at each other's throats.`;
  news(state, text, "danger", [f, ng]); // diplomacy.js: kept for the Affairs screen; on the air when you listen
  if (heard && !(canListen(state) && f.known)) log(state, text, "danger");
}

// Once a day for the world (factions.js factionsDaily, after the groups).
export function splinterDaily(state, d = day(state)) {
  for (const f of liveGroups(state)) {
    if (!f.bases.length) continue;
    strifeDay(state, f, d);
    const c = splitChance(state, f, d);
    if (c > 0 && h(state, f.name, tickOf(f), "split") < c) splitGroup(state, f, d);
  }
}
