// The AI groups' loadouts (docs/adr/0001-ai-parity.md): what each of a group's people carries, handed out of the
// group's spare kit through the rules your governor uses (equip.js equipPeople / equipTools: the best piece for the
// best fighter, only real upgrades, gun parts onto the guns in hand, rigs, plates and spare magazines into pouches;
// a med kit to their best Medicine). Then the small fighting kit a person of yours could carry the same way
// (inventory.js stow: pockets, rig pouches, a pack): a tourniquet and ear protection each, the throwables and the
// taser or pepper spray shared out, a launcher to the best shooter with room for it.
// When: kitOut every day at home (factions.js factionsDaily) for everyone at a base; a party forming packs for its job
// (packForJob: a raid its grenades, a party through the dead its decoys and flares, scavengers their packs and tools)
// and keeps what its people carried out (parties.js). Never as a fight is set up: a fight is fought with what they
// have on them. The job kit (arsenal.js isJobKitKey: decoys, flares, packs, a scavenger's tools) is not dealt at home:
// it stays at the base (its decoys for the walls: groupfight.js hordeAtGroup) until a party takes it out.
// The registry (f.arsenal.items) keeps every item the group owns, carried or not; spare is what nobody carries.
import { note, roundsIn } from "./ledger.js"; // the conservation test's ledger (off in play)
import { GEAR } from "./data.js";
import { stow, allCarried } from "./inventory.js";
import { equipPeople, equipTools } from "./equip.js";
import { ensureArsenal, isThrowKey, isKitThrowKey, isNonlethalKey, isSelfAidKey, isLauncherKey, addToArsenal, isJobKitKey, isDecoyKey, isPackKey, isScavToolKey, isMedKitKey } from "./arsenal.js";
import { skill } from "./world.js"; // who of a party takes a med kit, a crowbar, a hunting rifle
import { ensureMembers, homeMembers, fighterScore, isWounded, carriers, stripRegistry, HOME_SHARE } from "./members.js";
import { isEarKey, earGearOf, earSlotReason } from "./helmets.js";
import { WEAPONS } from "./combat.js";
import { carriedSpots } from "./inventory.js";
import { calOf, gunLoads, settleGroup } from "./ammo.js";
import { keyFor, typeFor } from "./rounds.js";
import { isRoundItem, roundItems } from "./itemstack.js";
import { MAGAZINES } from "./data-kit.js";
import { isMag, magFitsGun, fittedMag } from "./mags.js";
import { looseWant } from "./carrykit.js"; // loose rounds at hand: your rule

export const LOADOUT = {
  THROWS: 2, // throwables a person at most (shared out one at a time, best fighters first)
};

// What the group owns that nobody carries. A raid's ladders and ram are out with it (arsenal.js packRaidKit:
// it.withParty) until it is home: not spare.
export function spareKit(f) {
  const A = f && f.arsenal;
  if (!A) return [];
  const held = carriers(f);
  return A.items.filter((it) => it && !held.has(it) && it.withParty == null);
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
  if (!f.roundsSeeded) seedRounds(f, state); // their starting rounds (a group's starting holdings: ADR 0001), once
  for (const s of people) collectRounds(f, s, f.stock);
  // Everyone at home hands the group's kit back, and it is dealt out again (an AI's choice a player could make: the
  // best of it to the best of them today, a med kit to whoever is their best Medicine now). The job kit stays in the
  // stores until a party packs it (packForJob).
  for (const s of people) stripRegistry(f, s);
  const spare = spareKit(f).filter((it) => !isJobKitKey(it.key));
  const own = new Set(A.items);
  const handed = dealKit(spare, people);
  // Anything a swap put back that the group did not own yet (a person's own knife) is theirs now.
  for (const it of spare) if (it && !own.has(it)) addToArsenal(state, f, it, "own");
  // Their rounds: every gun loaded first, then the spare magazines, then a handful loose, best fighters first; out of
  // the stores, as far as they go (an empty store, empty guns).
  const fighters = people.filter((s) => !isWounded(s));
  for (const pass of ["gun", "mags", "loose"]) for (const s of fighters) armRounds(f, s, f.stock, pass);
  return handed;
}

// The day's deal out of a pile of kit (a plain list, changed in place: what is handed leaves it, what a swap takes
// off goes into it) onto people, best fighters first: kitOut at home, and the soldiers getting out of a fallen base
// with what they can carry (hardcore-groups.js militaryFalls). Returns [{ s, item }].
export function dealKit(spare, people) {
  const handed = [];
  for (const x of equipPeople(spare, people)) handed.push(x);
  for (const x of equipTools(spare, people, { medic: (s) => (s.skills.medicine || 0) >= 5 })) handed.push(x);
  const fighters = people.filter((s) => !isWounded(s));
  // One each, best fighters first: a tourniquet, ear protection (in the Ear pro slot as yours wear it: muffs and
  // headsets not under a full-shell helmet, plugs under any).
  for (const want of [isSelfAidKey, (k) => isEarKey(k)]) {
    for (const s of fighters) {
      if (want !== isSelfAidKey ? earGearOf(s) : allCarried(s).some((it) => it && want(it.key))) continue;
      const it = spare.find((x) => want(x.key));
      if (!it) break;
      if (want !== isSelfAidKey && wearEars(s, it)) { spare.splice(spare.indexOf(it), 1); handed.push({ s, item: it }); continue; }
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

// People getting out with what they can carry from a pile of kit (hardcore-groups.js militaryFalls: the soldiers
// leaving a fallen base's armory), by the kit-out's rule: a pack on each empty back first (the biggest first: room
// for the rest), then the day's deal (dealKit: upgrades only, what comes off goes onto the pile), then the job kit
// stowed (decoys, flares, a scavenger's tools: one of each kind each) as far as there is room. The pile is changed in
// place. Returns [{ s, item }].
export function grabKit(pile, people) {
  const out = [];
  const packs = pile.filter((it) => it && isPackKey(it.key)).sort((a, b) => ((GEAR[b.key].carry || 0) - (GEAR[a.key].carry || 0)) || String(a.aid || a.key).localeCompare(String(b.aid || b.key)));
  for (const s of people) {
    if (s.gear.backpack || !packs.length) continue;
    const it = packs.shift();
    s.gear.backpack = it;
    pile.splice(pile.indexOf(it), 1);
    out.push({ s, item: it });
  }
  // The deal without the packs left over (a swap of packs would leave what is in theirs behind).
  const rest = pile.filter((it) => it && !isPackKey(it.key));
  const keep = pile.filter((it) => it && isPackKey(it.key));
  out.push(...dealKit(rest, people));
  pile.splice(0, pile.length, ...rest, ...keep);
  for (const s of people) for (const it of pile.filter((x) => x && isJobKitKey(x.key) && !isPackKey(x.key))) {
    if (allCarried(s).some((x) => x && x.key === it.key)) continue;
    if (stow(s, it)) { pile.splice(pile.indexOf(it), 1); out.push({ s, item: it }); }
  }
  return out;
}

// ---------- packing for the job (docs/adr/0001-ai-parity.md: as you pack a team for its trip) ----------
// A party forming (parties.js spawnAiParty, after sendMembers and kitParty) packs for what it goes out to do, as your
// planner and your governor pack a team (parties.js launchExpedition: rounds for its guns, meds; kit.js packTripKit
// and packHiveKit: throwables, flares and decoys for the dead, a crowbar and a drill for a search; packSiegeKit for an
// assault), out of what the group holds, leaving home what home needs. Its people already carry the day's kit
// (kitOut: guns, armour, rigs and magazines, a tourniquet, a throwable or two). First a pack from the stores on every
// empty back (JOB_PACK: room for the rest, as your team leaves with its packs on), then by the job (JOB_KIT):
//   raid     a raid or a war party: grenades, bombs and Molotovs (LOADOUT.THROWS each), a flashbang or smoke each, a
//            tourniquet each, a med kit to its best Medicine, and a second helping of loose rounds for every gun (the
//            siege kit: arsenal.js packRaidKit; meds for the road: parties.js AI_PARTY_MEDS).
//   dead     horde or hive work, or a way through the dead (a horde on its path, land at JOB.DEAD_INF or thicker with
//            them: the dead kit on top of the job's own): a decoy and a Molotov each, JOB.FLARES road flares, a melee
//            weapon in the off hand of whoever holds a gun.
//   scav     scavengers and salvagers: the crowbar and lockpicks to their best Scavenging, makeshift picks, a drill or
//            a grinder for the safes, the packs above for the haul (their food for the trip: parties.js PACK rations).
//   hunt     a hunting weapon (a bow, a crossbow, a hunting rifle) in the hands of their best shot, loaded from the stores.
//   caravan  a caravan, a convoy or an escort: a med kit to its best Medicine and a tourniquet each (its guns are its
//            people's; meds for the road: AI_PARTY_MEDS).
// It comes out of what nobody carries first, then out of the pockets, rig pouches and packs of the people staying
// home (never what they wear or hold, but for an off-hand piece a party takes in the off hand: the med kit), and the
// home keeps `keep` of what the group owns of it: the decoys, Molotovs and flares the walls need (groupfight.js
// hordeAtGroup). Each piece is put where you would put it (inventory.js
// stow: pockets, rig pouches, the pack; a pack on the back, a med kit or a crowbar in the off hand) as far as there is
// room; nothing is made, and nothing is dropped: a piece with no room stays where it was. Home again, the daily kit-out
// takes it all back.
export const JOB = {
  KIND: { raid: "raid", fwraid: "raid", scav: "scav", salvage: "scav", caravan: "caravan", convoy: "caravan", hunt: "hunt", hive: "dead", horde: "dead" },
  DEAD_INF: 0.5, // aiscav.js: "the dead are thick here"
  FLARES: 2, // kit.js HIVE_KIT: a hive squad's two
  KEEP: 0.35, // of the decoys, Molotovs and flares the group owns, the home's share (members.js HOME_SHARE)
};
// Hunting weapons: the bows and the hunters' rifles (the single shots, the lever guns, the .22s, the varmint rifle).
export const HUNT_GUNS = ["huntrifle", "leverrifle", "rifle22", "singlerifle", "lever357", "lever44", "single44", "single556", "single223", "single300", "varmint223", "survival22"];
const isHuntKey = (k) => !!(GEAR[k] && GEAR[k].slot === "weapon" && WEAPONS[k] && (GEAR[k].cat === "bow" || HUNT_GUNS.includes(k)));
const isMeleeKey = (k) => !!(GEAR[k] && GEAR[k].slot === "weapon" && GEAR[k].cat === "melee" && WEAPONS[k]);
const bySkill = (key) => (s) => skill(s, key);
// to: "stow" (the default), "tool" (the off hand when it is free, else stowed), "back" (worn when the back is free),
// "side" (the off hand of one holding a gun), "hand" (in the hands, their own weapon to the off hand or stowed).
// each: so many a head going; n: so many for the party. keep: the home's share of the group's own. by: who first.
export const JOB_KIT = {
  raid: [
    { is: (k) => isThrowKey(k), each: LOADOUT.THROWS },
    { is: (k) => isKitThrowKey(k), each: 1 },
    { is: (k) => isSelfAidKey(k), each: 1 },
    { is: (k) => isMedKitKey(k), n: 1, to: "tool", by: bySkill("medicine") },
  ],
  dead: [
    { is: (k) => isDecoyKey(k) && k !== "flare", each: 1, keep: JOB.KEEP },
    { is: (k) => k === "molotov", each: 1, keep: JOB.KEEP },
    { is: (k) => k === "flare", n: JOB.FLARES, keep: JOB.KEEP },
    { is: (k) => isMeleeKey(k), each: 1, to: "side" },
  ],
  scav: [
    { is: (k) => k === "crowbar", n: 1, to: "tool", by: bySkill("scavenging") },
    { is: (k) => k === "makeshiftpick", n: 1, by: bySkill("scavenging") },
    { is: (k) => isScavToolKey(k) && (k === "powerdrill" || k === "anglegrinder"), n: 1 },
  ],
  hunt: [{ is: (k) => isHuntKey(k), n: 1, to: "hand", by: bySkill("shooting") }],
  caravan: [
    { is: (k) => isMedKitKey(k), n: 1, to: "tool", by: bySkill("medicine") },
    { is: (k) => isSelfAidKey(k), each: 1 },
  ],
};
export const JOB_PACK = { is: (k) => isPackKey(k), each: 1, to: "back" };
// (Each want's test is a function of its own: arsenal.js and this module import each other, so its predicates are
// read when a party packs, not when the modules load.)
// The jobs a party packs for: its kind's, and the dead's kit when its way runs through them (path: the tiles it walks).
export function jobsOf(state, kind, path = null) {
  const out = [];
  const main = JOB.KIND[kind];
  if (main) out.push(main);
  if (main !== "dead" && path && path.length) {
    const hordes = new Set((state.hordes || []).map((h) => h.tile));
    if (path.some((t) => hordes.has(t) || ((state.tiles[t] && state.tiles[t].infection) || 0) >= JOB.DEAD_INF)) out.push("dead");
  }
  return out;
}
// Packs the party's people (go) for its jobs. Returns [{ s, item }] of what was packed; party.jobs keeps the jobs.
export function packForJob(state, f, go, kind, party = null) {
  if (!f || f.outsider || !f.arsenal || !Array.isArray(go) || !go.length) return [];
  const jobs = jobsOf(state, kind, party && party.path);
  if (party) party.jobs = jobs;
  const goingIds = new Set(go.map((s) => s.id));
  const stay = homeMembers(f).filter((s) => !goingIds.has(s.id));
  const out = [];
  if (jobs.length) packWant(f, go, stay, JOB_PACK, out);
  for (const job of jobs) {
    for (const w of JOB_KIT[job] || []) packWant(f, go, stay, w, out);
    // A raid's second helping of rounds: a handful more loose for every gun, out of the stores (your team packs
    // rounds for its guns: ammo.js packRounds).
    if (job === "raid") for (const s of go.filter((p) => !isWounded(p))) armRounds(f, s, f.stock, "loose");
  }
  return out;
}
const STOWED = ["pocket", "rig", "pack"]; // what a person staying home can give up: never what they wear or hold
function packWant(f, go, stay, w, out) {
  const own = new Set(f.arsenal.items);
  const match = (it) => !!(it && GEAR[it.key] && w.is(it.key));
  const on = (s) => allCarried(s).filter(match).length;
  // The sources: spare first, then what the people staying home have stowed.
  const src = spareKit(f).filter(match).map((it) => ({ it, from: null }));
  for (const s of stay) for (const c of carriedSpots(s)) if (match(c.item) && own.has(c.item) && (STOWED.includes(c.where) || (w.to === "tool" && c.where === "tool"))) src.push({ it: c.item, from: { s, c } });
  if (!src.length) return;
  const homeHeld = stay.reduce((a, s) => a + on(s), 0) - src.filter((x) => x.from).length; // worn or held at home: not a source, but home's
  const total = src.length + homeHeld + go.reduce((a, s) => a + on(s), 0);
  const keepN = Math.ceil(total * (w.keep || 0));
  let atHome = src.length + homeHeld;
  const order = go.slice().sort((a, b) => (w.by ? w.by(b) - w.by(a) : 0) || (+isWounded(a) - +isWounded(b)) || fighterScore(b) - fighterScore(a) || a.id - b.id);
  const full = new Set();
  // One piece onto s: the next source the home can spare. False: none left, or no room on them.
  const give = (s) => {
    if (!src.length || atHome - 1 < keepN) return null;
    const x = src[0];
    if (x.from) x.from.c.take();
    if (putOn(f, s, x.it, w.to)) { src.shift(); atHome--; out.push({ s, item: x.it }); return true; }
    if (x.from) stow(x.from.s, x.it); // no room on them: it stays where it was
    full.add(s);
    return false;
  };
  if (w.each) {
    for (let pass = 0; pass < w.each; pass++) for (const s of order) {
      if (full.has(s) || on(s) > pass) continue;
      if (give(s) === null) return;
    }
    return;
  }
  for (const s of order) {
    while (go.reduce((a, p) => a + on(p), 0) < (w.n || 0) && !full.has(s)) { const r = give(s); if (r === null) return; if (!r) break; }
    if (go.reduce((a, p) => a + on(p), 0) >= (w.n || 0)) return;
  }
}
// Puts a packed piece where it goes on a person (JOB_KIT's to). False: no room for it there.
function putOn(f, s, it, to = "stow") {
  const g = s.gear;
  if (to === "back") { if (g.backpack) return false; g.backpack = it; return true; }
  if (to === "tool" && !g.tool) { g.tool = it; return true; }
  if (to === "side") {
    const gun = g.weapon && WEAPONS[g.weapon.key] && GEAR[g.weapon.key] && GEAR[g.weapon.key].cat !== "melee";
    if (!gun || g.tool) return false;
    g.tool = it;
    return true;
  }
  if (to === "hand") {
    const was = g.weapon;
    if (was && isHuntKey(was.key)) return false; // a hunter already
    g.weapon = it;
    if (was) {
      if (!g.tool && GEAR[was.key] && (GEAR[was.key].cat === "pistol" || GEAR[was.key].cat === "melee")) g.tool = was;
      else if (!stow(s, was)) { g.weapon = was; return false; }
    }
    armRounds(f, s, f.stock, "gun"); // loaded from the stores, and a handful loose (a bow: none to load)
    armRounds(f, s, f.stock, "loose");
    return true;
  }
  return !!stow(s, it);
}

// ---------- their rounds (docs/adr/0001-ai-parity.md: physical rounds for every side) ----------
// A group's starting rounds, added once when it is made (its starting holdings, as your crew starts with its guns
// loaded and a magazine or two): every gun it owns full, every magazine full, a handful loose, of the gun's common round.
export function seedRounds(f, state = null) {
  f.roundsSeeded = true;
  const r0 = roundsIn(f.stock);
  const items = (f.arsenal && f.arsenal.items) || [];
  for (const gun of items) {
    if (!gun || !WEAPONS[gun.key] || !calOf(gun.key)) continue;
    const key = keyFor(calOf(gun.key), typeFor(calOf(gun.key), gun.load || null));
    const n = capOf(gun) + looseWant(gun);
    f.stock[key] = (f.stock[key] || 0) + n;
  }
  for (const it of items) {
    if (!isMag(it)) continue;
    const m = MAGAZINES[it.key];
    const key = keyFor(m.cal, typeFor(m.cal, it.load || null));
    f.stock[key] = (f.stock[key] || 0) + m.cap;
  }
  note(state, "starting rounds", roundsIn(f.stock) - r0); // ledger.js: a creation seed
}
// Loose rounds carried besides (your rule: carrykit.js looseWant, CARRY.LOOSE and SHELLS.CARRY).
const capOf = (gun) => { const w = WEAPONS[gun.key]; const fit = fittedMag(gun); return Math.max(1, fit && MAGAZINES[fit.key] ? MAGAZINES[fit.key].cap : (w && w.cap) || 1); };
// The rounds a person carries, counted where they are (the gun's, the magazines', the loose ones), nothing moved.
export function carriedRounds(s) {
  let n = 0;
  const gun = s && s.gear && s.gear.weapon;
  if (gun && gun.loaded) { const r = gun.loaded; n += Array.isArray(r.stack) ? r.stack.reduce((a, x) => a + (x.n || 0), 0) : r.n || 0; }
  for (const c of carriedSpots(s)) {
    const it = c.item;
    if (!it) continue;
    if (it !== gun && it.loaded) { const r = it.loaded; n += Array.isArray(r.stack) ? r.stack.reduce((a, x) => a + (x.n || 0), 0) : r.n || 0; } // a gun in the off hand or the pack, loaded
    if (Array.isArray(it.stack)) for (const x of it.stack) n += x.n || 0;
    if (isRoundItem(it)) n += Math.floor(Number(it.dur) || 0);
  }
  if (s && s.carried) for (const [k, q] of Object.entries(s.carried)) if (/^a_/.test(k)) n += q;
  return n;
}
// Everything of rounds a person carries goes back into the stock: the gun's record, each magazine's stack, the round
// items in their pockets, rig and pack.
export function collectRounds(f, s, stock) {
  const add = (k, n) => { if (k && n > 0) stock[k] = (stock[k] || 0) + n; };
  const gun = s.gear && s.gear.weapon;
  if (gun && gun.loaded) { const r = gun.loaded; if (Array.isArray(r.stack)) for (const x of r.stack) add(x.k, x.n); else add(r.key, r.n); delete gun.loaded; }
  for (const c of carriedSpots(s)) {
    const it = c.item;
    if (!it) continue;
    if (it.loaded) { const r = it.loaded; if (Array.isArray(r.stack)) for (const x of r.stack) add(x.k, x.n); else add(r.key, r.n); delete it.loaded; } // any gun they carry (the off hand, the pack)
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
  const n = take(looseWant(gun));
  let left = n;
  // A stack of the same rounds on them takes what it can first (inventory.js stow → mergeOnto): with no room for the
  // rest, what did go onto that stack is theirs and only the rest goes back (a second helping: packForJob).
  for (const it of roundItems(key, n, true)) {
    const q = Math.floor(Number(it.dur) || 0);
    const ok = stow(s, it);
    left -= ok ? q : q - Math.floor(Number(it.dur) || 0);
    if (!ok) break;
  }
  if (left > 0) stock[key] = (stock[key] || 0) + left; // no room on them: back in the stores
}
const p0 = (s) => s;
// Ear protection put on: a helmet's ear mount (helmets.js), else the head slot when it is free. False: neither.
function wearEars(s, it) {
  if (s.gear.ears || earSlotReason(it, s)) return false; // helmets.js: the Ear pro slot, as yours wear it
  s.gear.ears = it;
  return true;
}
const packRoom = (s) => { const pk = s.gear.backpack; return !!(pk && Array.isArray(pk.contents) && pk.contents.includes(null)); };
// Their weapon can go in the off hand (a handgun or a light weapon) and the off hand is free.
const sidearmable = (s) => !s.gear.tool && (!s.gear.weapon || (GEAR[s.gear.weapon.key] && (GEAR[s.gear.weapon.key].cat === "pistol" || GEAR[s.gear.weapon.key].cat === "melee")));
