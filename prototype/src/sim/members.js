// AI members (docs/adr/0001-ai-parity.md, the user's decision 2026-10-19): every person of an AI group is a survivor
// record, made by the same constructor as yours (world.js makeSurvivor), with skills, traits, health and an inventory.
//
// Where they live: f.people (a list per group, never state.survivors: nothing that loops over your people meets one).
// Each member: s.fid (the group), s.location = { kind: "member", fid, tile } at one of the group's bases (tile) or
// { kind: "member", fid, tile: null, partyId } out with one of its parties (parties.js). memberById finds any of them.
//
// f.pop stays the group's head count, read in some 300 places: it is kept equal to the living members (syncMembers).
// Code that still writes f.pop (growth, hunger, a fight by the numbers) is reconciled on the next sync: a rise brings
// newcomers (population growth is outside the parity rules: ADR 0001 out of scope), a drop takes people away (the
// wounded first, then by a hash), their kit going back to the group's spare (arsenal.js: f.arsenal.items is the
// registry of everything the group owns, carried or not). A fight on the battle map writes its losses onto the very
// people who fought (combat.js, settleMembers) and keeps f.pop in step itself.
//
// The dice: a member is made under the group's own dice (a hash of the seed, the group's name and how many people it
// has made), with the world's dice, the id counter, the people counter and the names given swapped and restored, so
// a seed's own crew and its world come out as they would without them. Ids come from their own range (ID0 up).
// What ticks for them: health (wounds, infection, healing: groupMedicalDaily) and skills (XP from fights). Needs,
// mood, sleep and relationships do not: they are treated as fed and rested (hunger and thirst full).
import { Rng } from "./rng.js";
import { hash01 } from "./skills.js";
import { makeSurvivor, peekNextId, setNextId } from "./world.js";
import { ensureInv, allCarried, carriedSpots } from "./inventory.js";

export const MEMBER = {
  ID0: 1e9, // member ids start here (yours count up from 1)
  PEOPLE0: 5e6, // the people counter's range for members (appearance.js and traits.js key their dice by it)
  // Skills by the group's ways (the volunteers' rule, volunteers.js VOL): quality × the rolled skills, then Shooting and
  // Melee raised by the type.
  QUALITY: { military: 1.15, fortress: 1.1, raider: 1, expansionist: 1, zealot: 1, traders: 0.95, commune: 0.9 },
  SHOOT: { military: 4, fortress: 3, raider: 2, expansionist: 2, zealot: 1, traders: 1, commune: 0 },
  MELEE: { military: 2, fortress: 2, raider: 3, expansionist: 1, zealot: 4, traders: 0, commune: 1 },
  WOUNDED_BELOW: 60, // a member under this health is wounded: does not fight, works less (groupcare.js woundedOf)
  WOUND_HEALTH: [25, 55], // a wound dealt by the numbers (woundMembers) leaves them at this health (a hash between)
};

// ---------- the index ----------
let REV = 0;
const INDEX = new WeakMap(); // state -> { rev, map }
const bump = () => { REV++; };
export function memberById(state, id) {
  if (id == null || !state || !state.factions) return undefined;
  let c = INDEX.get(state);
  if (!c || c.rev !== REV) {
    const map = new Map();
    for (const f of state.factions) for (const s of f.people || []) map.set(s.id, s);
    for (const g of state.transients || []) map.set(g.id, g);
    for (const band of [...((state.nomads && state.nomads.bands) || []), ...(state.visitors || [])]) for (const s of band.people || []) map.set(s.id, s); // bands.js
    c = { rev: REV, map };
    INDEX.set(state, c);
  }
  return c.map.get(id);
}
export const touchMembers = bump; // call after moving people between lists by hand

// ---------- making them ----------
const QUALITY = (f) => MEMBER.QUALITY[f.type] ?? 1;
// Runs fn with the group's own dice in the world's place, and every counter makeSurvivor moves put back after.
export function withGroupDice(state, f, tag, fn) {
  const keepRng = state.rng, keepId = peekNextId(), keepMade = state.peopleMade, keepNames = state.namesGiven;
  const k = (f.madePeople = (f.madePeople || 0) + 1);
  state.rng = new Rng(Math.floor(hash01(state.seed, "member", f.name, tag, k) * 4294967296));
  state.peopleMade = MEMBER.PEOPLE0 + Math.floor(hash01(state.seed, "memberface", f.name) * 1e5) * 100 + k;
  state.namesGiven = f.namesGiven || (f.namesGiven = []);
  try { return fn(k); } finally { state.rng = keepRng; setNextId(keepId); state.peopleMade = keepMade; state.namesGiven = keepNames; }
}
const nextMemberId = (state) => (state.memberSeq = Math.max(state.memberSeq || MEMBER.ID0, MEMBER.ID0) + 1);
// One new person of the group (not yet in its list: addMember). opts.quality overrides the type's.
export function makeMember(state, f, opts = {}) {
  const s = withGroupDice(state, f, opts.tag || "join", () => makeSurvivor(state, opts.quality ?? QUALITY(f)));
  s.id = nextMemberId(state);
  s.skills.shooting = Math.min(20, (s.skills.shooting || 0) + (MEMBER.SHOOT[f.type] || 0));
  s.skills.melee = Math.min(20, (s.skills.melee || 0) + (MEMBER.MELEE[f.type] || 0));
  s.fid = f.id;
  s.role = "member";
  s.location = { kind: "member", fid: f.id, tile: opts.tile ?? (f.bases && f.bases[0] != null ? f.bases[0] : null) };
  ensureInv(s);
  return s;
}
// addMember / removeMember move f.pop and the count last seen together (a change f.pop made since, not yet
// synced, still stands). syncMembers itself works through the quiet forms (put / drop) and settles both at the end.
export function addMember(state, f, s, tile = null) {
  put(f, s, tile);
  f.pop = Math.max(0, (f.pop || 0) + 1);
  f.popSeen = Math.max(0, (Number.isFinite(f.popSeen) ? f.popSeen : f.people.length - 1) + 1);
  return s;
}
function put(f, s, tile = null) {
  if (!Array.isArray(f.people)) f.people = [];
  s.fid = f.id;
  s.alive = true;
  if (!s.location || s.location.kind !== "member" || s.location.fid !== f.id) s.location = { kind: "member", fid: f.id, tile: tile ?? (f.bases && f.bases[0] != null ? f.bases[0] : null) };
  else if (tile != null) { s.location.tile = tile; delete s.location.partyId; }
  f.people.push(s);
  bump();
  return s;
}
function drop(f, s, why, opts = {}) {
  const i = f && Array.isArray(f.people) ? f.people.indexOf(s) : -1;
  if (i < 0) return false;
  f.people.splice(i, 1);
  bump();
  if (why === "died") { s.alive = false; s.health = 0; }
  if (opts.keepKit) stripRegistry(f, s);
  else forgetCarried(f, s); // what they carry leaves the group's books with them (it is never dealt out twice)
  return true;
}
// The group's items a person carries, off its registry (they stay on the person): f.arsenal.items, its revision.
function forgetCarried(f, s) {
  const A = f && f.arsenal;
  if (!A || !Array.isArray(A.items) || !A.items.length) return;
  const held = new Set(allCarried(s));
  if (!held.size) return;
  const keep = A.items.filter((it) => !held.has(it));
  if (keep.length === A.items.length) return;
  A.items.splice(0, A.items.length, ...keep);
  A.rev = (A.rev || 0) + 1;
}
// Takes a person out of the group's list (dead, taken prisoner, gone over to another group). Their kit stays on them;
// what of it the group still owns (the registry) is taken off them and kept as spare when keepKit (they left it at
// home, or the group buried them), else it leaves the registry with them (arsenal.js forgetItems).
export function removeMember(state, f, s, why = "gone", opts = {}) {
  const seen = Number.isFinite(f && f.popSeen) ? f.popSeen : (f && f.people ? f.people.length : 0);
  if (!drop(f, s, why, opts)) return false;
  f.pop = Math.max(0, (f.pop || 0) - 1);
  f.popSeen = Math.max(0, seen - 1);
  return true;
}
// What the group owns that this person carries, taken off them (it stays in the registry: spare at home).
export function stripRegistry(f, s) {
  const own = registrySet(f);
  if (!own.size) return [];
  const out = [];
  for (const c of carriedSpots(s)) if (own.has(c.item)) { c.take(); out.push(c.item); }
  // A rig's pouches and a pack's slots come off with the rig or the pack only when it is the group's: else just what is in them.
  return out;
}
const registrySet = (f) => new Set((f && f.arsenal && f.arsenal.items) || []);

// Taken prisoner by another group by the numbers (groupjails.js groupCapture): the caller has taken them off the head
// count already (f.pop), so this takes the very person out of the list quietly, with what they carry off the books.
// The n to take: those hurt first, then the weakest fighters (they gave up), at the place hit (f.lossAt) first.
export function captivesFrom(state, f, n) {
  ensureMembers(state, f);
  const at = f.lossAt;
  const list = membersOf(f).filter((s) => s.alive && atHome(s));
  list.sort((a, b) => (+(b.location.tile === at) - +(a.location.tile === at)) || (+isWounded(b) - +isWounded(a)) || fighterScore(a) - fighterScore(b) || a.id - b.id);
  return list.slice(0, Math.max(0, Math.round(n)));
}
export function takeQuietly(state, f, s) {
  if (!drop(f, s, "taken")) return false;
  f.popSeen = Math.max(0, (Number.isFinite(f.popSeen) ? f.popSeen : f.people.length + 1) - 1);
  s.location = { kind: "held" };
  return true;
}
// A person of a group's back in its list (a prisoner freed, ransomed, swapped; one who turned joins their captors).
export function homeAgain(state, f, s) {
  if (!f || !s || s.alive === false) return false;
  addMember(state, f, s);
  return true;
}
// A person goes over to another group (a splinter band, an heir, an ally) with what they carry: the old group's
// registry lets go of their kit (kept on them), the new one's takes it in.
export function moveMember(state, from, to, s, tile = null, { give = null, take = null } = {}) {
  const own = registrySet(from);
  const kit = allCarried(s).filter((it) => own.has(it));
  for (const it of kit) if (give) give(it);
  removeMember(state, from, s, "left");
  addMember(state, to, s, tile ?? (to.bases && to.bases[0] != null ? to.bases[0] : null));
  s.fid = to.id;
  s.location = { kind: "member", fid: to.id, tile: tile ?? (to.bases && to.bases[0] != null ? to.bases[0] : null) };
  for (const it of kit) if (take) take(it);
  return kit;
}

// ---------- the list ----------
export const membersOf = (f) => (f && Array.isArray(f.people) ? f.people : []);
export const atHome = (s) => !!s && s.alive && s.location && s.location.kind === "member" && s.location.partyId == null;
export const homeMembers = (f) => membersOf(f).filter(atHome);
export const membersAt = (f, tile) => membersOf(f).filter((s) => atHome(s) && s.location.tile === tile);
export const isWounded = (s) => !!s && s.health < MEMBER.WOUNDED_BELOW;
export const woundedMembers = (f) => membersOf(f).filter(isWounded).length;
// The group's fit people at home (not wounded, not out with a party), best fighters first (shooting, melee, health).
export const fighterScore = (s) => (s.skills.shooting || 0) * 2 + (s.skills.melee || 0) + s.health / 25;
// Who goes out with a party (parties.js spawnAiParty): n of the fit at home, best first, a home guard (HOME_SHARE of the
// people, every third from the second best, as arsenal.js issueKit kept kit back) staying. Their kit goes with them.
export const HOME_SHARE = 0.35;
export function sendMembers(state, f, p, n) {
  ensureMembers(state, f);
  syncMembers(state, f);
  const fit = fitAtHome(f);
  const guard = Math.ceil(membersOf(f).length * HOME_SHARE);
  let kept = 0;
  const out = [];
  fit.forEach((s, i) => { if (i % 3 === 1 && kept < guard) kept++; else out.push(s); });
  const go = out.slice(0, Math.max(0, Math.round(n)));
  for (const s of go) s.location = { kind: "member", fid: f.id, tile: null, partyId: p.id };
  p.memberIds = go.map((s) => s.id);
  bump();
  return go;
}
// The n of a group's people who fought a fight nobody played on the map: its party's (partyId), else the fittest at home.
export function groupFighters(state, f, partyId, n) {
  syncMembers(state, f);
  const out = partyId != null ? membersOf(f).filter((s) => s.alive && s.location && s.location.partyId === partyId) : [];
  for (const s of fitAtHome(f)) { if (out.length >= n) break; if (!out.includes(s)) out.push(s); }
  return out.slice(0, Math.max(0, Math.round(n)));
}
export const partyPeople = (f, p) => membersOf(f).filter((s) => s.location && s.location.partyId === p.id);
export const fitAtHome = (f) => homeMembers(f).filter((s) => !isWounded(s)).sort((a, b) => fighterScore(b) - fighterScore(a) || a.id - b.id);

// Every member a group should have and does not yet (a group made by code that writes only f.pop: a new world, a
// gang from beyond the border, a hardcore band founding a hub). Called before anything reads f.people.
export function ensureMembers(state, f) {
  if (!f || f.alive === false) return membersOf(f);
  if (!Array.isArray(f.people)) {
    f.people = [];
    const n = Math.max(0, Math.round(f.pop || 0));
    for (let i = 0; i < n; i++) put(f, makeMember(state, f, { tag: "start" }));
    f.popSeen = f.people.length;
    f.pop = f.people.length;
  }
  return f.people;
}

// The head count and the list made to agree. A rise in f.pop since the last sync: newcomers. A fall: people gone,
// the wounded first (hunger and wounds take the weakest), then by a hash (the same world, the same people).
export function syncMembers(state, f) {
  if (!f) return;
  if (f.alive === false) { if (Array.isArray(f.people) && f.people.length) { f.people.length = 0; bump(); } return; }
  ensureMembers(state, f);
  const seen = Number.isFinite(f.popSeen) ? f.popSeen : f.people.length;
  const want = Math.max(0, Math.round(f.pop || 0));
  let delta = want - seen;
  // People out with a party that is no more (parties.js: it came home, or fell on the road): the ones lost first.
  const live = new Set((state.parties || []).map((p) => p.id));
  const gonePartyOf = (s) => +(!!(s.alive && s.location && s.location.partyId != null && !live.has(s.location.partyId)));
  if (delta > 0) for (let i = 0; i < delta; i++) put(f, makeMember(state, f));
  else if (delta < 0) {
    const at = f.lossAt;
    f.lossAt = null;
    const stray = (s) => +(atHome(s) && (!(f.bases || []).includes(s.location.tile) || s.location.tile === at)); // at a base the group just lost, or the one hit: they fell there
    const order = f.people.slice().sort((a, b) => (gonePartyOf(b) - gonePartyOf(a)) || (stray(b) - stray(a)) || (isWounded(b) - isWounded(a)) || (+atHome(b) - +atHome(a)) || hash01(state.seed, "memberloss", f.name, a.id, seen) - hash01(state.seed, "memberloss", f.name, b.id, seen));
    for (const s of order.slice(0, -delta)) drop(f, s, "died", { keepKit: true });
  }
  // The rest of a party that is no more are home again.
  for (const s of f.people) if (gonePartyOf(s)) { delete s.location.partyId; s.location.tile = f.bases && f.bases[0] != null ? f.bases[0] : null; }
  // (Out of step with no change to apply, a list edited by hand without addMember / removeMember: the list is the truth.)
  f.pop = f.people.length;
  f.popSeen = f.pop;
}
export function syncAllMembers(state) {
  for (const f of state.factions || []) if (f.alive !== false && (Array.isArray(f.people) || f.pop > 0)) syncMembers(state, f);
}

// ---------- wounds by the numbers ----------
// n of the group's people come home wounded (a fight nobody watched): the fit ones at home, by a hash, put below
// WOUNDED_BELOW. Returns how many were wounded.
export function woundMembers(state, f, n, tag = "") {
  if (!(n > 0)) return 0;
  ensureMembers(state, f);
  const fit = membersOf(f).filter((s) => s.alive && !isWounded(s))
    .sort((a, b) => hash01(state.seed, "memberwound", f.name, tag, a.id) - hash01(state.seed, "memberwound", f.name, tag, b.id));
  const [lo, hi] = MEMBER.WOUND_HEALTH;
  let k = 0;
  for (const s of fit.slice(0, Math.round(n))) { s.health = Math.round(lo + (hi - lo) * hash01(state.seed, "memberhp", f.name, tag, s.id)); k++; }
  return k;
}

// ---------- what they carry ----------
export const carriedBy = (s) => (s ? allCarried(s) : []);
// Map item -> the member carrying it, for one group (registry items only when own is given).
export function carriers(f) {
  const out = new Map();
  for (const s of membersOf(f)) for (const it of allCarried(s)) out.set(it, s);
  return out;
}
// The member carrying an item, or null.
export function carrierOf(f, it) {
  for (const s of membersOf(f)) for (const c of carriedSpots(s)) if (c.item === it) return { s, c };
  return null;
}

// ---------- who lives where ----------
// The group's people over its bases by the old weighting (conquest.js peopleAt: its people shared over its bases,
// the main base counting HOME_WEIGHT), moved as little as possible: the surplus of a base goes to the bases short of
// people, and anyone at a base the group no longer holds goes to its main base. Out with a party: left alone.
export const HOME_WEIGHT = 2; // conquest.js CONQUEST.HOME_WEIGHT, intelnotes.js HOME_WEIGHT
export function placeMembers(state, f) {
  if (!f || !Array.isArray(f.people) || !f.bases || !f.bases.length) return;
  const home = f.people.filter(atHome);
  for (const s of home) if (!f.bases.includes(s.location.tile)) s.location.tile = f.bases[0];
  if (f.bases.length === 1) return;
  const w = f.bases.length - 1 + HOME_WEIGHT;
  const want = f.bases.map((t, i) => Math.max(1, Math.round((home.length * (i === 0 ? HOME_WEIGHT : 1)) / w)));
  // The main base takes what rounding leaves over (never below 1 anywhere while there are people).
  let sum = want.reduce((a, n) => a + n, 0);
  for (let i = want.length - 1; sum > home.length && i > 0; i--) while (want[i] > 1 && sum > home.length) { want[i]--; sum--; }
  want[0] = Math.max(0, want[0] + home.length - sum);
  const at = (t) => home.filter((s) => s.location.tile === t);
  const pool = [];
  f.bases.forEach((t, i) => { const here = at(t).sort((a, b) => hash01(state.seed, "memberplace", a.id) - hash01(state.seed, "memberplace", b.id)); pool.push(...here.slice(want[i])); });
  f.bases.forEach((t, i) => { let n = at(t).length; while (n < want[i] && pool.length) { pool.shift().location.tile = t; n++; } });
}
// How many of the group's people are at a base now (null: the group has no people list yet).
export const peopleHere = (f, tile) => (f && Array.isArray(f.people) ? f.people.filter((s) => atHome(s) && s.location.tile === tile).length : null);
// The same without the world (groupcare.js woundGroup): hashed on the group's name, its day and a running count.
export function woundMembersBy(f, n) {
  if (!(n > 0) || !Array.isArray(f.people)) return 0;
  const k = (f.woundSeq = (f.woundSeq || 0) + 1);
  const fit = f.people.filter((s) => s.alive && !isWounded(s)).sort((a, b) => hash01("memberwound", f.name, k, a.id) - hash01("memberwound", f.name, k, b.id));
  const [lo, hi] = MEMBER.WOUND_HEALTH;
  let w = 0;
  for (const s of fit.slice(0, Math.round(n))) { s.health = Math.round(lo + (hi - lo) * hash01("memberhp", f.name, k, s.id)); w++; }
  return w;
}
