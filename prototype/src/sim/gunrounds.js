// @ts-check
// How many rounds are in a gun or a magazine out of a fight, for the inventory's rounds badge and the short hover tip
// (2026-10-10, user: "Guns should show quickly how many rounds are in them when in the inventory view"; "the starting
// gun magazines were empty").
//
// The rounds a team has are counted where rounds are counted (the stores: a base's stock, a team's supplies and
// cargo; the boxes and loose rounds people carry), and a gun is loaded from them at the start of every fight (combat.js
// playerUnit: "every gun carried starts the fight loaded"; mags.js: the spares the same, "out of a fight loading them
// is free"). So out of a fight the magazine of a gun of yours holds what it will hold when the fight starts:
//   - a gun (or a spare magazine) of your people (worn, carried, in a base's armory or a team's cargo): filled from the
//     rounds of its load to hand there, in turn (the gun in the hands first, then the other guns, then the spares, so
//     two pistols and 20 rounds show 15/15 and 5/15, not 15/15 twice), plus any rounds kept on the gun itself
//     (gunload.js it.loaded: a picked start gun, one taken off a body);
//   - a gun in a fight (the search window): the rounds in it now (the unit's magazine); a spare magazine of the gun
//     in the hands, carried by one of yours in a fight: what the unit's entry holds now (mags.js magEntryAt: a swap
//     emptied it, loose rounds dropped onto it loaded it);
//   - anything else (on a body, on the ground, in a container, a trader's): what is in it (it.loaded), else empty.
// A gun found in a building or a raid container (foundFill) comes with a believable few rounds in it, on dice of its
// own (no draw from the world's random numbers): the found rounds are real (they join the team's like a body's gun's).
// The badge is kept honest when people leave the stores behind (2026-10-18, user: the team window showed every gun and
// magazine full, "but when I load into a raid some guns and magazines have 0/x"): a team forming at a base, or a person
// joining one there, takes the rounds its guns and magazines show out of the base's stock as the team's own
// (loadoutRounds; teamform.js formTeam / addMember), so the magazines in the fight hold what the badge said at home.
import { GEAR } from "./data.js";
import { CALIBERS } from "./data-ammo.js";
import { MAGAZINES } from "./data-kit.js";
import { WEAPONS, magCap, magShown } from "./combat.js";
import { calOf, gunLoads } from "./ammo.js";
import { keyFor, typeFor, withHand, roundOf, loadId, baseType, roundName, typesOf } from "./rounds.js";
import { isMag, magLoad, magCalsOf, standardMag, fittedMag, usesInternal, magFitsGun, magEntryAt, loadedIn } from "./mags.js";
import { magCapOf } from "./gunmods.js";
import { parseLoc, carriedSpots, personPlace, battleBodies } from "./inventory.js";
import { survivorById, baseById } from "./world.js";
import { hash01 } from "./skills.js";
import { stackN, topKey, loadOfKey } from "./roundstack.js"; // physical rounds in a fight (mags.js, 2026-10-18)

const num = (v) => (Number.isFinite(v) ? v : 0);

// ---------- what it is ----------
// A gun that fires rounds from a magazine (not a bow, a launcher, a mounted gun or a blade).
/** @param {any} item */
export function isRoundGun(item) {
  const w = item && WEAPONS[item.key];
  const cal = item && calOf(item.key);
  return !!(w && w.cap > 0 && !w.launcher && !w.mounted && !w.mount && cal && CALIBERS[cal]);
}
// Rounds the gun holds as fitted (its magazine, an internal one's tube or cylinder).
/** @param {any} item */
export const gunCapacity = (item) => (isRoundGun(item) ? magCap({ weapon: item.key, item }) : 0);
// Rounds a magazine item holds.
/** @param {any} item */
export const magCapacity = (item) => (isMag(item) ? magCapOf(item.key) || MAGAZINES[item.key].cap : 0);
// The gun's magazine as words, never "empty" (the user saw "magazine (empty)" on every gun without a fitted one: the
// gun's own standard magazine is in it, it is simply not a separate part): "Bolt-action magazine (5)", "a 5-round
// internal magazine".
/** @param {any} gun */
export function magazineText(gun) {
  if (!isRoundGun(gun)) return "";
  const fit = fittedMag(gun);
  if (fit) return fit.name;
  const cap = gunCapacity(gun);
  if (usesInternal(gun.key, gun)) return `${cap}-round internal magazine`;
  const std = standardMag(gun.key);
  return std && GEAR[std] ? `${GEAR[std].name}, standard` : `${cap}-round magazine`;
}

// ---------- where the rounds come from ----------
// The rounds to hand at a location: { pools (supply records), boxes (round items carried), mine (your people's), s
// (the person carrying it, or null), list (the storage list it is in, or null) }.
/** @param {any} state @param {string | null | undefined} loc */
export function roundsAt(state, loc) {
  const none = { pools: [], boxes: [], mine: false, s: null, list: null, place: null };
  if (!state || !loc) return none;
  const L = parseLoc(loc);
  const placePools = (place) => {
    if (!place) return [];
    const [kind, id] = place.split(":");
    if (kind === "base") { const b = baseById(state, Number(id)); return b ? [b.stock || {}] : []; }
    const p = (state.parties || []).find((x) => x.id === Number(id));
    return p ? [p.supplies || {}, (p.cargo && p.cargo.supplies) || {}] : [];
  };
  if (L.o === "s") {
    const s = survivorById(state, L.id);
    if (!s || !s.alive) return none;
    const place = personPlace(s);
    return { pools: placePools(place), boxes: boxesCarried(s), mine: true, s, list: null, place };
  }
  if (L.o === "armory") { const b = baseById(state, L.id); return b ? { ...none, pools: [b.stock || {}], mine: true, list: b.armory || [], place: `base:${L.id}` } : none; }
  if (L.o === "cargo") {
    const p = (state.parties || []).find((x) => x.id === L.id);
    return p ? { ...none, pools: placePools(`party:${L.id}`), mine: true, list: (p.cargo && p.cargo.gear) || [], place: `party:${L.id}` } : none;
  }
  return none;
}
// The round items a person carries (pockets, rig pouches, the pack): what their gun draws on first in a fight.
/** @param {any} s */
function boxesCarried(s) {
  return carriedSpots(s).map((x) => x.item).filter((it) => it && roundOf(it.key) && GEAR[it.key] && GEAR[it.key].count);
}
// Rounds of one supply key (and its handloads) in these pools and boxes, less what is already claimed.
function countKey(at, key, claimed) {
  let n = 0;
  for (const k of withHand(key)) {
    for (const p of at.pools) n += Math.max(0, Math.floor(num(p[k])));
    for (const it of at.boxes) if (it.key === k) n += Math.max(0, Math.floor(num(it.dur)));
  }
  return Math.max(0, n - (claimed.get(key) || 0));
}
// The load a gun takes the field with (ammo.js chooseLoad, out of a fight): its own (item.load), else its calibre's
// common round; one there is none of falls back to the common round, then to what there is most of.
function gunLoadAt(item, at, claimed) {
  const cal = calOf(item.key);
  const pref = item.load && item.load !== "auto" ? typeFor(cal, item.load) : baseType(cal);
  if (countKey(at, keyFor(cal, pref), claimed) > 0) return pref;
  if (countKey(at, keyFor(cal, baseType(cal)), claimed) > 0) return baseType(cal);
  let best = pref, most = 0;
  for (const id of gunLoads(item.key)) { const q = countKey(at, keyFor(cal, id), claimed); if (q > most) { most = q; best = id; } }
  return best;
}
// The same for a magazine item (its own load, else the common round of a calibre it holds, else what there is most of).
function magLoadAt(item, at, claimed, dflt = null) {
  const cal = MAGAZINES[item.key].cal;
  const pref = magLoad(item, cal, dflt);
  if (countKey(at, keyFor(cal, pref), claimed) > 0) return pref;
  let best = pref, most = 0;
  for (const c of magCalsOf(item.key)) for (const t of typesOf(c)) { const id = loadId(cal, c, t); const q = countKey(at, keyFor(cal, id), claimed); if (q > most) { most = q; best = id; } }
  return best;
}
// What one gun or magazine holds (its record first, then from the stores to hand, claiming them).
function fillOne(item, at, claimed, magDflt = null) {
  const gun = isRoundGun(item);
  const cap = gun ? gunCapacity(item) : magCapacity(item);
  const cal = gun ? calOf(item.key) : MAGAZINES[item.key].cal;
  const rec = item.loaded && num(item.loaded.n) > 0 ? Math.floor(item.loaded.n) : Array.isArray(item.stack) ? stackN(item.stack) : 0; // rounds kept on it (a gun put down; a magazine with its stack)
  if (!at.mine) {
    const r = gun && item.loaded ? roundOf(item.loaded.key) : null;
    const load = r ? loadId(cal, r.cal, r.type) : gun ? typeFor(cal, item.load && item.load !== "auto" ? item.load : null) : magLoad(item, cal, null);
    return { n: Math.min(cap, rec), cap, cal, load, src: rec > 0 ? "in it" : "empty", key: keyFor(cal, load), got: 0 };
  }
  if (!gun && item.unloaded && !(rec > 0)) return { n: 0, cap, cal, load: magLoad(item, cal, magDflt), src: "unloaded" }; // itemacts.js: kept empty until loaded again
  if (!gun && rec > 0) return { n: Math.min(cap, rec), cap, cal, load: loadOfKey(cal, topKey(item.stack)) || magLoad(item, cal, magDflt), src: "in it", key: keyFor(cal, magLoad(item, cal, magDflt)), got: 0 }; // a magazine with rounds of its own (a stack kept from a fight)
  const load = gun ? gunLoadAt(item, at, claimed) : magLoadAt(item, at, claimed, magDflt);
  const key = keyFor(cal, load);
  const want = Math.max(0, cap - rec);
  const got = Math.min(want, countKey(at, key, claimed)); // got: claimed from the rounds to hand (the stores and the person's own boxes)
  claimed.set(key, (claimed.get(key) || 0) + got);
  return { n: Math.min(cap, rec + got), cap, cal, load, src: "ready", key, got };
}
// Fills every gun and magazine at a location in turn: Map(item → { n, cap, cal, load, src }).
/** @param {any[]} items @param {ReturnType<typeof roundsAt>} at */
function fillAll(items, at) {
  const claimed = new Map();
  const out = new Map();
  const guns = items.filter(isRoundGun), mags = items.filter(isMag);
  for (const it of guns) out.set(it, fillOne(it, at, claimed));
  const held = at.s && at.s.gear && isRoundGun(at.s.gear.weapon) ? at.s.gear.weapon : null; // a spare with no load of its own takes the held gun's (mags.js fitMags)
  const heldLoad = held && out.get(held) ? out.get(held).load : null;
  for (const it of mags) out.set(it, fillOne(it, at, claimed, held && heldLoad && magFitsGun(held.key, it.key) ? heldLoad : null));
  return out;
}
// Where an item is now, as an inventory location (a living person's slot, a base's armory, a team's cargo), or null.
// The index is kept for a moment (one screen's drawing) and checked against the item before it is used.
let INDEX = { state: null, at: 0, map: new Map() };
/** @param {any} state @param {any} item */
export function locate(state, item) {
  const now = Date.now();
  const hit = INDEX.state === state && now - INDEX.at < 250 ? INDEX.map.get(item) : undefined;
  if (hit != null && stillAt(state, hit, item)) return hit; // a cached "nowhere" is never trusted: an item put somewhere since would be missed for a moment, and what happens would hang on how fast the machine runs
  const map = new Map();
  for (const s of state.survivors || []) if (s && s.alive && s.gear) for (const x of carriedSpots(s)) map.set(x.item, x.loc);
  for (const b of state.bases || []) (b.armory || []).forEach((it, i) => it && map.set(it, `armory:${b.id}:list:${i}`));
  for (const p of state.parties || []) ((p.cargo && p.cargo.gear) || []).forEach((it, i) => it && map.set(it, `cargo:${p.id}:list:${i}`));
  INDEX = { state, at: now, map };
  return map.get(item) ?? null;
}
function stillAt(state, loc, item) {
  const L = parseLoc(loc);
  if (L.o === "armory") { const b = baseById(state, L.id); return !!b && (b.armory || [])[L.i] === item; }
  if (L.o === "cargo") { const p = (state.parties || []).find((x) => x.id === L.id); return !!p && ((p.cargo && p.cargo.gear) || [])[L.i] === item; }
  if (L.o === "s") { const s = survivorById(state, L.id); return !!s && s.alive && carriedSpots(s).some((x) => x.item === item); }
  return false;
}
// The items that share the rounds at a location, in the order they are loaded: a person's held gun, their other guns,
// then the spares (pockets, rig, pack); a storage list in its order.
function sharers(at) {
  if (at.s) return carriedSpots(at.s).map((x) => x.item);
  return at.list || [];
}

// ---------- the loadout a team takes ----------
// The rounds these people's guns and magazines would be loaded with out of these pools (a base's stock), by supply key:
// what the badge shows them holding at the base (fillAll, in turn: each person's held gun first, then their other guns,
// then the spares), less what their own boxes cover (a gun draws on the boxes in its holder's pockets, rig and pack
// first), person by person out of the same stores (a short stock loads the first picked first, as the fight would).
// `less`: rounds of the stores already spoken for (the supplies and the round picks the team takes besides). A team
// forming at a base or a person joining one takes these out of the stock as the team's own rounds (teamform.js), so the
// fight's magazines hold what the window showed. Returns { key: n } (handloads under their own keys), nothing touched.
/** @param {any[]} people @param {Record<string, number>[]} pools @param {Record<string, number>} [less] @returns {Record<string, number>} */
export function loadoutRounds(people, pools, less = {}) {
  /** @type {Record<string, number>} */
  const work = {};
  for (const p of pools || []) for (const [k, q] of Object.entries(p || {})) if (roundOf(k) && num(q) > 0) work[k] = num(work[k]) + Math.floor(num(q));
  for (const [k, q] of Object.entries(less || {})) if (work[k] && num(q) > 0) work[k] = Math.max(0, work[k] - Math.floor(num(q)));
  /** @type {Record<string, number>} */
  const out = {};
  for (const s of people || []) {
    if (!s || !s.alive || !s.gear) continue;
    const at = { pools: [work], boxes: boxesCarried(s), mine: true, s, list: null, place: null };
    const all = fillAll(sharers(at), at);
    /** @type {Map<string, number>} */
    const need = new Map(); // claimed by base key, less the person's own boxes of it
    for (const r of all.values()) if (r && r.got > 0) need.set(r.key, (need.get(r.key) || 0) + r.got);
    for (const [key, q] of need) {
      let left = q;
      for (const k of withHand(key)) for (const it of at.boxes) if (it.key === k) left -= Math.max(0, Math.floor(num(it.dur)));
      for (const k of withHand(key)) {
        if (left <= 0) break;
        const take = Math.min(left, Math.max(0, Math.floor(num(work[k]))));
        if (take > 0) { work[k] -= take; out[k] = num(out[k]) + take; left -= take; }
      }
    }
  }
  return out;
}

// ---------- the answer ----------
// The rounds in a gun or a magazine item, or null for anything else:
//   { n, cap, cal, load (a rounds.js load id), src: "ready" (your people's: loaded from the stores to hand) | "in it"
//     (rounds kept on it) | "empty" | "fight" (in the hands in a fight now), roundName (".308 / 7.62 NATO soft point") }
// loc: where it is (an inventory location string: "s:3:weapon", "armory:0:list:4", "body:2:weapon"...).
/** @param {any} state @param {any} item @param {string | null} [loc] */
export function gunRounds(state, item, loc = null) {
  if (!isRoundGun(item) && !isMag(item)) return null;
  if (!loc && state) loc = locate(state, item); // gunRoundsLabel(item): found where it is (a person, an armory, a cargo)
  const b = state && state.combat;
  if (b && !b.over && isRoundGun(item)) { // in a fight: the unit holding it has the count
    const u = (b.units || []).find((x) => x.side === "player" && !x.dead && x.item === item && x.magW === x.weapon);
    if (u) { const cal = calOf(u.weapon); return { n: Math.max(0, Math.floor(magShown(b, u))), cap: u.magMax || gunCapacity(item), cal, load: typeFor(cal, u.load), src: "fight", roundName: roundName(cal, u.load) }; }
  }
  if (b && !b.over && isMag(item) && Array.isArray(item.stack)) { // in a fight: the rounds in it (mags.js: physical)
    const cal = MAGAZINES[item.key].cal;
    const load = loadOfKey(cal, topKey(item.stack)) || magLoad(item, cal, null);
    return { n: stackN(item.stack), cap: magCapacity(item), cal, load, src: "fight", roundName: roundName(cal, load) };
  }
  if (b && !b.over && isMag(item) && loc) { // in a fight: one of the gun's spares as the unit counts it now (a save from before)
    const L = parseLoc(loc);
    const s = L.o === "s" ? survivorById(state, L.id) : null;
    const u = s ? (b.units || []).find((x) => x.side === "player" && !x.dead && x.sid === s.id) : null;
    const m = u ? magEntryAt(u, carriedSpots(s), loc) : null;
    if (m) { const cal = calOf(u.weapon); return { n: Math.max(0, Math.floor(loadedIn(b, u, m))), cap: m.cap, cal, load: m.load, src: "fight", roundName: roundName(cal, m.load) }; }
  }
  const at = roundsAt(state, loc);
  let r;
  if (at.mine) {
    const list = sharers(at);
    const all = fillAll(list.includes(item) ? list : [...list, item], at);
    r = all.get(item);
  } else r = fillOne(item, at, new Map());
  return r ? { ...r, roundName: roundName(r.cal, r.load) } : null;
}
// "4/5" (a gun or a magazine), or "" for anything else.
/** @param {any} state @param {any} item @param {string | null} [loc] */
export function roundsText(state, item, loc = null) {
  const r = gunRounds(state, item, loc);
  return r ? `${r.n}/${r.cap}` : "";
}

// ---------- found guns ----------
// FOUND: a gun found lying in a building or a raid container is empty this often; otherwise it has 1 to its capacity
// rounds of its common load in it (most of them a few, now and then a full one).
export const FOUND = { empty: 0.35 };
// Puts a believable few rounds in a found gun (on its own dice: hash01 of the salt). Returns the gun.
/** @param {any} gun @param {...any} salt */
export function foundFill(gun, ...salt) {
  if (!isRoundGun(gun) || gun.loaded) return gun;
  const cap = gunCapacity(gun);
  const r = hash01("foundfill", gun.key, ...salt);
  if (r < FOUND.empty || !(cap > 0)) return gun;
  const f = (r - FOUND.empty) / (1 - FOUND.empty); // 0–1
  const n = Math.max(1, Math.min(cap, Math.ceil(cap * f * f + 0.0001))); // squared: mostly a few, rarely full
  gun.loaded = { n, key: keyFor(calOf(gun.key), null) };
  return gun;
}

// The person a location's item is on ("Tobias"), or the place ("the armory", "the cargo", "a body"): who has it.
/** @param {any} state @param {string | null} loc */
export function holderName(state, loc) {
  if (!state || !loc) return "";
  const L = parseLoc(loc);
  if (L.o === "s") { const s = survivorById(state, L.id); return s ? s.name : ""; }
  if (L.o === "armory") { const b = baseById(state, L.id); return b ? `${b.name}'s armory` : "the armory"; }
  if (L.o === "cargo") return "the team's cargo";
  if (L.o === "body") { const body = battleBodies(state)[L.id]; return body ? `${body.name || "a body"} (a body)` : "a body"; }
  return "";
}
