// The AI groups' loadouts (docs/adr/0001-ai-parity.md): what each of a group's people carries, handed out of the
// group's spare kit through the rules your governor uses (equip.js equipPeople / equipTools: the best piece for the
// best fighter, only real upgrades, gun parts onto the guns in hand, rigs, plates and spare magazines into pouches;
// a med kit to their best Medicine). Then the small fighting kit a person of yours could carry the same way
// (inventory.js stow: pockets, rig pouches, a pack): a tourniquet and ear protection each, the throwables and the
// taser or pepper spray shared out, a launcher to the best shooter with room for it.
// When: kitOut every day at home (factions.js factionsDaily) for everyone at a base; a party keeps what its people
// carried out (parties.js). Never as a fight is set up: a fight is fought with what they have on them.
// The registry (f.arsenal.items) keeps every item the group owns, carried or not; spare is what nobody carries.
import { GEAR } from "./data.js";
import { stow, allCarried } from "./inventory.js";
import { equipPeople, equipTools } from "./equip.js";
import { ensureArsenal, isThrowKey, isKitThrowKey, isNonlethalKey, isSelfAidKey, isLauncherKey, addToArsenal } from "./arsenal.js";
import { ensureMembers, homeMembers, fighterScore, isWounded, carriers, stripRegistry, HOME_SHARE } from "./members.js";
import { isEarKey } from "./helmets.js";
import { WEAPONS } from "./combat.js";
import { carriedSpots } from "./inventory.js";
import { calOf, gunLoads, settleGroup } from "./ammo.js";
import { keyFor, typeFor } from "./rounds.js";
import { isRoundItem, roundItems } from "./itemstack.js";
import { MAGAZINES } from "./data-kit.js";
import { isMag, magFitsGun, usesInternal, fittedMag, SHELLS } from "./mags.js";

export const LOADOUT = {
  THROWS: 2, // throwables a person at most (shared out one at a time, best fighters first)
};

// What the group owns that nobody carries.
export function spareKit(f) {
  const A = f && f.arsenal;
  if (!A) return [];
  const held = carriers(f);
  return A.items.filter((it) => it && !held.has(it));
}
export function kitOut(state, f) {
  if (!f || f.alive === false || f.outsider) return [];
  const A = ensureArsenal(state, f);
  if (!A) return [];
  ensureMembers(state, f);
  const people = homeMembers(f).sort((a, b) => (isWounded(a) - isWounded(b)) || fighterScore(b) - fighterScore(a) || a.id - b.id);
  if (!people.length) return [];
  // Their rounds back into the stores first (the gun's, the magazines', the loose ones in their pockets: a day's run).
  settleGroup(state, f); // ammo.js: their stores' rounds by calibre (a new world's generic ammo becomes their guns')
  if (!f.roundsSeeded) seedRounds(f); // their starting rounds (a group's starting holdings: ADR 0001), once
  for (const s of people) collectRounds(f, s, f.stock);
  // Everyone at home hands the group's kit back, and it is dealt out again (an AI's choice a player could make: the
  // best of it to the best of them today, a med kit to whoever is their best Medicine now).
  for (const s of people) stripRegistry(f, s);
  const spare = spareKit(f);
  const own = new Set(A.items);
  const handed = [];
  for (const x of equipPeople(spare, people)) handed.push(x);
  for (const x of equipTools(spare, people, { medic: (s) => (s.skills.medicine || 0) >= 5 })) handed.push(x);
  const fighters = people.filter((s) => !isWounded(s));
  // One each, best fighters first: a tourniquet, ear protection.
  for (const want of [isSelfAidKey, (k) => isEarKey(k)]) {
    for (const s of fighters) {
      if (allCarried(s).some((it) => it && want(it.key))) continue;
      const it = spare.find((x) => want(x.key));
      if (!it) break;
      if (stow(s, it)) { spare.splice(spare.indexOf(it), 1); handed.push({ s, item: it }); }
    }
  }
  // Throwables and a taser or a spray: shared out, one a round.
  for (const want of [(k) => isThrowKey(k) || isKitThrowKey(k), isNonlethalKey]) {
    const cap = want === isNonlethalKey ? 1 : LOADOUT.THROWS;
    let gave = true;
    while (gave) {
      gave = false;
      for (const s of fighters) {
        if (allCarried(s).filter((it) => it && want(it.key)).length >= cap) continue;
        const it = spare.find((x) => want(x.key));
        if (!it) break;
        if (stow(s, it)) { spare.splice(spare.indexOf(it), 1); handed.push({ s, item: it }); gave = true; }
      }
    }
  }
  // A launcher: in the pack of the best shooter with room, else in the hands of one whose own weapon goes into the
  // off hand (a sidearm: launchers.js fitLauncher fights with it besides).
  for (const it of spare.filter((x) => isLauncherKey(x.key) && GEAR[x.key] && GEAR[x.key].slot === "weapon")) {
    const byAim = fighters.slice().sort((a, b) => (b.skills.shooting || 0) - (a.skills.shooting || 0) || a.id - b.id);
    const s = byAim.find((p) => !allCarried(p).some((x) => x && isLauncherKey(x.key)) && (packRoom(p) || sidearmable(p)));
    if (!s) break;
    if (packRoom(p0(s)) && stow(s, it)) { spare.splice(spare.indexOf(it), 1); handed.push({ s, item: it }); continue; }
    if (sidearmable(s)) { const own = s.gear.weapon; s.gear.tool = own; s.gear.weapon = it; spare.splice(spare.indexOf(it), 1); handed.push({ s, item: it }); }
  }
  // Anything a swap put back that the group did not own yet (a person's own knife) is theirs now.
  for (const it of spare) if (it && !own.has(it)) addToArsenal(state, f, it, "own");
  // Their rounds: every gun loaded first, then the spare magazines, then a handful loose, best fighters first; out of
  // the stores, as far as they go (an empty store, empty guns).
  for (const pass of ["gun", "mags", "loose"]) for (const s of fighters) armRounds(f, s, f.stock, pass);
  return handed;
}

// A party forming (parties.js spawnAiParty, after members.js sendMembers): the launchers held by people who stay home
// are handed to the party's best shooters, as you would hand one to the team going out. A raid takes every one;
// any other party leaves a share at home (members.js HOME_SHARE). The launcher moves with the rounds it is loaded with.
export function kitParty(state, f, go, kind = "raid", party = null) {
  if (!f || !Array.isArray(go) || !go.length) return [];
  const goingIds = new Set(go.map((s) => s.id));
  const stay = homeMembers(f).filter((s) => !goingIds.has(s.id));
  const held = [];
  for (const s of stay) for (const c of carriedSpots(s)) if (c.item && isLauncherKey(c.item.key) && GEAR[c.item.key] && GEAR[c.item.key].slot === "weapon") held.push({ s, c });
  const total = held.length + go.reduce((n, s) => n + allCarried(s).filter((x) => x && isLauncherKey(x.key)).length, 0);
  const keep = kind === "raid" ? 0 : Math.floor(total * HOME_SHARE);
  const out = [];
  let give = Math.max(0, held.length - keep);
  const byAim = go.filter((s) => !isWounded(s)).sort((a, b) => (b.skills.shooting || 0) - (a.skills.shooting || 0) || a.id - b.id);
  for (const { s: from, c } of held) {
    if (give <= 0) break;
    const to = byAim.find((p) => !allCarried(p).some((x) => x && isLauncherKey(x.key)) && (packRoom(p) || sidearmable(p)));
    if (!to) {
      // Nobody going has room for it: the one who carries it goes instead of the party's weakest fighter.
      const weak = go.filter((p) => !allCarried(p).some((x) => x && isLauncherKey(x.key))).sort((a, b) => fighterScore(a) - fighterScore(b) || b.id - a.id)[0];
      if (!weak) break;
      const at = weak.location;
      weak.location = { ...from.location };
      from.location = at;
      go[go.indexOf(weak)] = from;
      if (party && Array.isArray(party.memberIds)) party.memberIds = go.map((x) => x.id);
      out.push({ s: from, item: c.item });
      give--;
      continue;
    }
    const it = c.item;
    c.take();
    if (from.gear.weapon == null && from.gear.tool && WEAPONS[from.gear.tool.key]) { from.gear.weapon = from.gear.tool; from.gear.tool = null; } // their sidearm back in hand
    if (packRoom(to) && stow(to, it)) { out.push({ s: to, item: it }); give--; continue; }
    if (sidearmable(to)) { to.gear.tool = to.gear.weapon; to.gear.weapon = it; out.push({ s: to, item: it }); give--; continue; }
    stow(from, it); // no room after all: it stays
  }
  return out;
}

// ---------- their rounds (docs/adr/0001-ai-parity.md: physical rounds for every side) ----------
// A group's starting rounds, added once when it is made (its starting holdings, as your crew starts with its guns
// loaded and a magazine or two): every gun it owns full, every magazine full, a handful loose, of the gun's common round.
export function seedRounds(f) {
  f.roundsSeeded = true;
  const items = (f.arsenal && f.arsenal.items) || [];
  for (const gun of items) {
    if (!gun || !WEAPONS[gun.key] || !calOf(gun.key)) continue;
    const key = keyFor(calOf(gun.key), typeFor(calOf(gun.key), gun.load || null));
    const internal = usesInternal(gun.key, gun);
    const n = capOf(gun) + (SHELLS.GUNS[gun.key] ? LOOSE.shells : internal ? LOOSE.internal * capOf(gun) : LOOSE.box * capOf(gun));
    f.stock[key] = (f.stock[key] || 0) + n;
  }
  for (const it of items) {
    if (!isMag(it)) continue;
    const m = MAGAZINES[it.key];
    const key = keyFor(m.cal, typeFor(m.cal, it.load || null));
    f.stock[key] = (f.stock[key] || 0) + m.cap;
  }
}
export const LOOSE = { box: 1, internal: 2, shells: 18 }; // loose rounds carried besides: a magazine's worth, twice an internal magazine, shells
const capOf = (gun) => { const w = WEAPONS[gun.key]; const fit = fittedMag(gun); return Math.max(1, fit && MAGAZINES[fit.key] ? MAGAZINES[fit.key].cap : (w && w.cap) || 1); };
// Everything of rounds a person carries goes back into the stock: the gun's record, each magazine's stack, the round
// items in their pockets, rig and pack.
export function collectRounds(f, s, stock) {
  const add = (k, n) => { if (k && n > 0) stock[k] = (stock[k] || 0) + n; };
  const gun = s.gear && s.gear.weapon;
  if (gun && gun.loaded) { const r = gun.loaded; if (Array.isArray(r.stack)) for (const x of r.stack) add(x.k, x.n); else add(r.key, r.n); delete gun.loaded; }
  for (const c of carriedSpots(s)) {
    const it = c.item;
    if (!it) continue;
    if (Array.isArray(it.stack)) { for (const x of it.stack) add(x.k, x.n); delete it.stack; }
    if (isRoundItem(it)) { add(it.key, Math.floor(Number(it.dur) || 0)); c.take(); }
  }
  if (s.carried) for (const [k, q] of Object.entries(s.carried)) if (/^a_/.test(k)) { add(k, q); delete s.carried[k]; }
}
// The round key this gun loads from the stock: its own load while there are any, else the one it takes most of.
function keyForGun(gun, stock) {
  const cal = calOf(gun.key);
  if (!cal) return null;
  const own = keyFor(cal, typeFor(cal, gun.load || null));
  if ((stock[own] || 0) >= 1) return own;
  let best = null, most = 0;
  for (const l of gunLoads(gun.key)) { const k = keyFor(cal, l); if ((stock[k] || 0) > most) { most = stock[k]; best = k; } }
  return best || own;
}
export function armRounds(f, s, stock, pass) {
  const gun = s.gear && s.gear.weapon;
  if (!gun || !WEAPONS[gun.key] || !calOf(gun.key)) return;
  const key = keyForGun(gun, stock);
  const take = (n) => { const q = Math.max(0, Math.min(Math.floor(n), Math.floor(stock[key] || 0))); if (q > 0) stock[key] -= q; return q; };
  if (pass === "gun") {
    if (gun.loaded) return;
    const n = take(capOf(gun));
    if (n > 0) gun.loaded = { n, key, stack: [{ k: key, n }] };
    return;
  }
  if (pass === "mags") {
    for (const it of allCarried(s)) {
      if (!isMag(it) || !magFitsGun(gun.key, it.key) || Array.isArray(it.stack)) continue;
      const n = take(MAGAZINES[it.key].cap);
      it.stack = n > 0 ? [{ k: key, n }] : [];
    }
    return;
  }
  const internal = usesInternal(gun.key, gun);
  const want = SHELLS.GUNS[gun.key] ? LOOSE.shells : internal ? LOOSE.internal * capOf(gun) : LOOSE.box * capOf(gun);
  const n = take(want);
  let left = n;
  for (const it of roundItems(key, n, true)) { const q = Math.floor(Number(it.dur) || 0); if (!stow(s, it)) break; left -= q; }
  if (left > 0) stock[key] = (stock[key] || 0) + left; // no room on them: back in the stores
}
const p0 = (s) => s;
const packRoom = (s) => { const pk = s.gear.backpack; return !!(pk && Array.isArray(pk.contents) && pk.contents.includes(null)); };
// Their weapon can go in the off hand (a handgun or a light weapon) and the off hand is free.
const sidearmable = (s) => !s.gear.tool && (!s.gear.weapon || (GEAR[s.gear.weapon.key] && (GEAR[s.gear.weapon.key].cat === "pistol" || GEAR[s.gear.weapon.key].cat === "melee")));
