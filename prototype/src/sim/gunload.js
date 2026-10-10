// The rounds in a gun's magazine, kept on the gun (the user's rule: "only the ammo that was in the gun; keep track of
// ammo in guns, and all guns are loaded at the start of battle").
//
// In a fight the gun in a fighter's hands counts its rounds on the unit (combat.js u.mag; your side's are part of the
// team's rounds, the pools: mags.js "physical magazines, virtual rounds"). A gun nobody holds in a fight carries what
// is in it on the item: it.loaded = { n, key } (key: the round's supply key, a_<calibre>_<type>). It is written when
// the gun leaves a fighter:
//   your people: out of the hands (refitUnit: put away, dropped, handed over), the rounds that were in it (magIn, never
//     more than the team has of them) taken out of the team's rounds; a gun they carried into the fight that leaves
//     them unfired (dropped from a pocket) goes out loaded (it was: every gun starts the fight loaded), its rounds
//     taken the same way;
//   the enemy and the third side: a body (searched in the fight or looted after it: inventory.js enemyBody, ground.js),
//     a gun thrown down by one who gave up (nonlethal.js): the rounds left in it (their reserve is endless, the
//     magazine is what is in the gun).
// Taken up again (gunIn): exactly those rounds are in the magazine (u.mag), your side's added to the team's rounds (the
// fighter's haul pool), never a free full one. A gun with no record: one carried into the fight by your people is
// loaded (u.startGuns, playerUnit); anything else (a gun found in a container) is empty: Reload.
// Out of the fight (settleLoaded, the loot screen's taken): a gun that comes to your people is unloaded into their
// stores (the team's cargo or the base), so the rounds are counted once, where rounds are counted. A gun left lying (a
// death site) keeps its rounds on it.
import { SUPPLIES } from "./data.js";
import { WEAPONS, magIn, magCap } from "./combat.js";
import { calOf, roundsOf, takeBattleRounds, gunTakes } from "./ammo.js";
import { keyFor, roundOf, loadId } from "./rounds.js";
import { allCarried } from "./inventory.js";
import { baseById } from "./world.js";

const isGun = (it) => !!(it && WEAPONS[it.key] && calOf(it.key));
// The load a round key is in a gun of calibre `cal` (rounds.js loads: another calibre it takes "223:fmj"; null: none).
const typeOfKey = (key, cal, wkey = null) => { const r = key && cal ? roundOf(key) : null; return r && (!wkey || gunTakes(wkey, r.cal)) ? loadId(cal, r.cal, r.type) : null; };
// The record for what is in this unit's gun now (its own count of rounds; the type it is loaded with).
function record(u, n) {
  const cal = calOf(u.weapon);
  return cal ? { n: Math.max(0, Math.floor(n)), key: keyFor(cal, u.load) } : null;
}

// An enemy's (or a third side's) gun off its body or thrown down: the rounds left in it. Returns the item.
export function enemyGunLoaded(u, item) {
  if (!u || !isGun(item) || item.key !== u.weapon) return item;
  const r = record(u, magIn(u));
  if (r) item.loaded = r;
  return item;
}

// One of your people's gun leaves their hands (combat.js refitUnit, before the unit takes the new one): what is in it
// goes with it, out of the team's rounds. Returns the record.
export function gunOut(b, u, item) {
  if (!b || !u || !isGun(item) || item.key !== u.weapon) return null;
  const want = u.side === "player" ? Math.min(magIn(u), Math.max(0, roundsOf(b, u))) : magIn(u);
  const n = u.side === "player" ? takeBattleRounds(b, u, want) : want;
  const r = record(u, n);
  if (r) item.loaded = r;
  forget(b, item);
  return r;
}
// A gun one of your people carried into the fight (not in the hands) leaves them unfired: loaded, the rounds out of the
// team's (a magazine's worth of its standard load). A bag, a case or a rig leaving them: each gun in it the same.
export function gunLeavesTeam(b, item) {
  if (b && item && !isGun(item) && Array.isArray(item.contents)) { for (const g of bagGuns(item)) gunLeavesTeam(b, g); return null; }
  if (!b || !isGun(item) || item.loaded || !startGun(b, item)) return null;
  const probe = { weapon: item.key, load: null, side: "player", item, boxes: [] };
  const cap = magCap(probe);
  const n = takeBattleRounds(b, probe, Math.min(cap, Math.max(0, roundsOf(b, probe))));
  item.loaded = record(probe, n);
  forget(b, item);
  return item.loaded;
}
const startGun = (b, item) => b.units.some((o) => o.side === "player" && Array.isArray(o.startGuns) && o.startGuns.includes(item));
function forget(b, item) { for (const o of b.units) if (Array.isArray(o.startGuns)) { const i = o.startGuns.indexOf(item); if (i >= 0) o.startGuns.splice(i, 1); } }

// A gun taken into a fighter's hands: how many rounds are in its magazine (null: loaded full, one carried into the
// fight), u.load set to what is in it. Your side's rounds join the team's (the unit's haul, one of the pools).
export function gunIn(b, u, item) {
  if (!b || !u || !isGun(item)) return 0;
  const cal = calOf(item.key);
  if (item.loaded) {
    const { n, key } = item.loaded;
    delete item.loaded;
    const t = typeOfKey(key, cal, item.key);
    if (t) u.load = t;
    if (u.side === "player" && n > 0 && SUPPLIES[key]) {
      const pool = u.haul ? u.haul.sup : b.pools && b.pools[0];
      if (u.haul && !b.pools.includes(u.haul.sup)) b.pools.push(u.haul.sup);
      if (pool) pool[key] = (pool[key] || 0) + n;
    }
    return n;
  }
  if (startGun(b, item)) { forget(b, item); return null; }
  return 0;
}

// Out of a fight: every gun with rounds in it that came to your people (worn, carried, in the storage) is unloaded
// into the stores of that place. place: storageFor's { o, id, list, party? } and the base (stock) or the party.
export function unloadInto(st, items, stock) {
  let n = 0;
  if (!stock) return 0; // nowhere to put the rounds: they stay in the gun
  for (const it of items || []) {
    if (!it || !it.loaded) continue;
    const { n: q, key } = it.loaded;
    delete it.loaded;
    if (q > 0 && SUPPLIES[key] && stock) { stock[key] = (stock[key] || 0) + q; n += q; }
  }
  return n;
}
// Everything inside a container, at any depth (a bag's slots, a case, a pouch): the guns among them.
const inside = (it, out = [], seen = new Set()) => { if (it && Array.isArray(it.contents) && !seen.has(it)) { seen.add(it); for (const c of it.contents) if (c) { out.push(c); inside(c, out, seen); } } return out; };
export const bagGuns = (bag) => inside(bag).filter(isGun);
// What a person carries with a bag in the arms opened up (carry.js s.gear.carry: its contents are carried too, and
// every gun carried into a fight starts it loaded: combat.js playerUnit startGuns).
export const carriedWithBag = (s) => (s && s.gear ? [...allCarried(s), ...inside(s.gear.carry)] : []);
// The guns of these people and of a storage list, with what they hold (a pack's contents: allCarried; a bag carried in
// the arms or lying in the list: its contents too).
export const teamGuns = (people, list = []) => [...people.flatMap((s) => carriedWithBag(s)), ...list, ...list.flatMap((it) => inside(it))].filter((it) => it && it.loaded);
// The supply record a storage place's rounds go to (inventory.js storageFor: a team's cargo, a base's stock).
export function stockFor(state, st) {
  if (!st) return null;
  if (st.o === "cargo") { const p = st.party; p.cargo = p.cargo || { supplies: {}, gear: [] }; return p.cargo.supplies || (p.cargo.supplies = {}); }
  const base = baseById(state, st.id);
  return base ? base.stock : null;
}
