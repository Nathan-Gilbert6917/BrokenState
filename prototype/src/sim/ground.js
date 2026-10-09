// Things on the ground in a battle, and the bodies searched where they fell (the user's asks: search bodies on the
// tactical map; put things on the ground and pick them up).
//
// It all lives in the loot layer of raidloot.js (lootLayer / fieldLayer): a raid's own (b.raid.containers), or in a
// field battle b.fieldLoot, made on first use. Two kinds of container are added there:
//   a pile on the ground  { kind: "ground", drop: true, x, y, f, contents: { sup, gear } }: one a cell, made when
//                         something is put down there (dropToGround, or the search window's ground column). drop: it
//                         holds things already found (raidloot.js tally), like the pile a fallen teammate leaves.
//   a body (field battles) { kind: "body", uid, contents }: a dead person (any side: yours, the enemy's, a third
//                         side's) or one of the dead that carried something (walking loot, the risen, a dead soldier
//                         or riot cop in their kit), searched in the battle. A raid's dead are its body containers
//                         already (combat.js damage): searched there like any container.
// Moving things is the search window's (raidloot.js raidMove, ui/inventory.js): what a survivor takes off a body or the
// ground is hauling (HAUL: the first 8 kg a turn free, then 12 kg an action), putting something down is free.
//
// Costs: searching a body the first time is SEARCH.ap (1 action, as a container in a raid); looking again is free.
// Dropping is free. Picking up: the hauling time. From the unit's own cell or one next to it.
//
// A body searched in the battle is rolled with exactly what the battle's end would have rolled for it (deadBodyOf: the
// enemy's kit, their launcher, a blast's wear, the walking dead's things; your fallen's own things and what they
// carried loose), once; what is left on it is that body's loot after the battle (groundEnd, groundLeftovers): nothing
// is rolled twice, nothing taken is still on it.
// The end of a field battle (combat.js endBattle):
//   groundEnd        before the bodies are settled: each survivor who lives brings home what they carry loose (the
//                    team's cargo or the base); the haul of one who did not lies where they fell; a body put in the
//                    car takes what is left on it along (carriers.js endBodies: e.box); a body that rose and was put
//                    down again is the risen one's.
//   groundLeftovers  a win: every pile and every body searched with something left is a "body" of the loot screen
//                    (inventory.js pile bodies: their things loose); then, as every body, what nobody takes stays
//                    at a death site on the tile. A retreat or a defeat: it all stays there now (a death site).
// A raid's piles go the raid's way (raidloot.js raidHome): what nobody picked up is left behind.
//
// The API for other modules (the carrying model, ux-carry): dropToGround(b, u, item | supplyKey, count) puts a thing
// (already taken off whoever had it) on the unit's cell; dropAt(state, uid, loc, qty) moves it there from an inventory
// location; pickUpFromGround(state, b, u, cellOrPile, item?, arms?) takes one thing, or all that fits, from a pile on
// or next to the unit (arms: a bag, a rig or a case straight into the arms, carry.js; the In arms slot). groundAt /
// pilesNear / pileCount read it. carry.js puts the loads set down from the arms here (groundDropCell) and takes them
// back (Pick up load, the end of a won fight).
//
// AI parity: an enemy (or a third side's) fighter with no gun in hand standing on or next to a pile with a gun in it
// takes it up (aiGrabGun, 1 action), the very item: if they fall it is on their body again.
import { GEAR, SUPPLIES } from "./data.js";
import { lootLayer, fieldLayer, raidMove, raidTakeAll, quickTarget, haulOf } from "./raidloot.js";
import { survivorById, baseById } from "./world.js";
import { ensureInv, allItems, stripAll, enemyBody, packSize, storageFor, battlePlace, leaveBodies } from "./inventory.js";
import { walkingBody, turnedBody } from "./carriers.js";
import { launcherBody } from "./launchers.js";
import { SEARCH } from "./search.js";
import { ARMORED } from "./deadsoldiers.js";
import { KITS, WEAPONS, say, fx, unitById, loadMag, active, playerUnit } from "./combat.js";
import { gunOut, gunLeavesTeam, gunIn, unloadInto, stockFor, teamGuns } from "./gunload.js"; // the rounds in a gun, kept on it
import { fireStuff } from "./launchers.js"; // fire on what lies on the ground
import { fireAt } from "./throwables.js";
import { bagRefusal } from "./carry.js"; // Carry in arms: the one check for a bag going into the arms

export const GROUND = { reach: 1 };
const cheb = (a, x, y) => Math.max(Math.abs(a.x - x), Math.abs(a.y - y));
const near = (u, c) => (c.f || 0) === (u.f || 0) && cheb(u, c.x, c.y) <= GROUND.reach;
export const isPile = (c) => !!c && c.kind === "ground";
// How many things (an item, a supply stack) a container holds.
export const pileCount = (c) => (c && c.contents ? c.contents.gear.length + Object.values(c.contents.sup).filter((v) => v >= 1).length : 0);
const settle = (c) => { const n = pileCount(c); c.searched = !n; c.partial = !!n; return c; };
export const settlePile = settle; // carry.js: a pile a load was taken back from

// ---------- piles ----------
export const groundPiles = (b) => (lootLayer(b) ? lootLayer(b).containers.filter(isPile) : []);
export function groundAt(b, x, y, f = 0) {
  const L = lootLayer(b);
  return L ? L.containers.find((c) => isPile(c) && c.x === x && c.y === y && (c.f || 0) === f) || null : null;
}
// The pile on a cell, made (empty) when there is none.
export function groundPile(b, x, y, f = 0) {
  let p = groundAt(b, x, y, f);
  if (!p) {
    p = { id: b.nextId++, x, y, f, kind: "ground", drop: true, area: null, searched: true, partial: false, label: "On the ground", contents: { sup: {}, gear: [] } };
    fieldLayer(b).containers.push(p);
  }
  return p;
}
// The piles with something in them on or next to the unit (its own cell first).
export const pilesNear = (b, u) => groundPiles(b).filter((c) => pileCount(c) && near(u, c)).sort((a, c) => cheb(u, a.x, a.y) - cheb(u, c.x, c.y));

// Puts a thing on the ground where the unit stands: an item already taken off whoever had it, or `count` of a supply
// (its key). Returns the pile (null: nothing to put down).
export function dropToGround(b, u, what, count = 1) {
  if (!b || !u) return null;
  const p = groundPile(b, u.x, u.y, u.f || 0);
  if (typeof what === "string") {
    if (!SUPPLIES[what] || !(count > 0)) return null;
    p.contents.sup[what] = (p.contents.sup[what] || 0) + count;
  } else if (what && GEAR[what.key]) p.contents.gear.push(what);
  else return null;
  return settle(p);
}
// Puts what is at an inventory location of the battle's search window ("s:<sid>:<slot>[:<i>]", "haul:<uid>:…") on the
// unit's cell (free; qty: part of a supply stack). Returns the message ("" when nothing moved).
export function dropAt(state, uid, loc, qty = Infinity) {
  const b = state.combat;
  const u = b && unitById(b, uid);
  if (!u || u.side !== "player" || b.over) return "";
  fieldReady(b, state);
  const p = groundPile(b, u.x, u.y, u.f || 0);
  const msg = raidMove(state, uid, loc, `rbox:${p.id}:list`, qty);
  settle(p);
  return msg;
}
// Takes one thing (item) or all that fits from a pile on or next to the unit: { got: [names], left, msg }. arms: the
// item (a bag, a rig, a case) goes into the unit's arms (carry.js: hands full until it is set down), not the pack.
export function pickUpFromGround(state, b, u, where, item = null, arms = false) {
  const out = { got: [], left: 0, msg: "" };
  if (!b || !u) return out;
  fieldReady(b, state);
  const pile = isPile(where) ? where : where ? groundAt(b, where.x, where.y, where.f ?? (u.f || 0)) : pilesNear(b, u)[0];
  if (!pile || !pileCount(pile)) { out.msg = "Nothing on the ground there."; return out; }
  if (!near(u, pile)) { out.msg = `${u.name.split(" ")[0]} has to be on it or next to it.`; return out; }
  if (item) {
    const i = pile.contents.gear.indexOf(item);
    if (i < 0) { out.msg = "That is not there any more."; return out; }
    const from = `rbox:${pile.id}:gear:${i}`;
    if (arms) { const why = bagRefusal(state, b, u, item); if (why) { out.msg = why; return out; } }
    out.msg = raidMove(state, u.id, from, arms ? `s:${u.sid}:carry` : quickTarget(state, b, u.id, from, pile.id));
    if (!pile.contents.gear.includes(item)) out.got.push(item.name);
  } else {
    const r = raidTakeAll(state, u.id, pile.id);
    out.got = r.got; out.left = r.left;
  }
  settle(pile);
  out.left = pileCount(pile);
  return out;
}

// A field battle: everyone of yours carries their finds loose (raidloot.js u.haul), and found ammo and meds count at
// once (one of the battle's supply pools, as on a raid: raidCarrySetup); a weapon or armour put on from a body or the
// ground counts at once (combat.js refitUnit, from u.fit: what playerUnit gives for what they wear now, as rescueraid.js).
export function fieldReady(b, state = null) {
  if (!b || b.raid) return;
  fieldLayer(b);
  for (const u of b.units) {
    if (u.side !== "player") continue;
    if (!u.haul) { haulOf(u); b.pools.push(u.haul.sup); }
    const s = state && !u.fit && u.sid != null ? survivorById(state, u.sid) : null;
    if (s && s.alive) { const id = b.nextId; const f0 = playerUnit(b, s); b.nextId = id; u.fit = { aim: f0.aim, dmgMult: f0.dmgMult, armor: f0.armor, medicine: f0.medicine }; }
  }
}

// ---------- bodies ----------
export const bodyBoxOf = (b, t) => { const L = lootLayer(b); return t && L ? L.containers.find((c) => c.kind === "body" && c.uid === t.id) || null : null; };
// Can this one's body be searched ("" when it can)? Dead, on the map (not carried, risen, in the car, burnt): people of
// any side; of the dead only those that carried something. Or living and down (knocked out, surrendered, tied, wounded)
// and not one of yours: the enemy's or a third side's (the user's ask), in a field battle or a raid.
export const downedFoe = (t) => !!t && !t.dead && !!t.down && t.side !== "player" && t.kind === "human" && !t.left && !t.fled;
export function bodyRefusal(b, t) {
  if (downedFoe(t)) return t.off || t.carriedBy != null ? "They are not there." : "";
  if (!t || !t.dead) return "Only the dead and the downed can be searched.";
  if (t.burnt) return "Burnt: nothing left on it.";
  if (t.off || t.inVehicle || t.carriedBy != null) return "That body is not there.";
  if (t.ztype === "swarm" || t.ztype === "sleeper") return "Nothing to search.";
  if (t.kind === "zombie") {
    if (t.turned && t.turned.sid != null) return "One of yours, risen: what they had is with their things (their death site).";
    if (!(t.walking || t.turned || (t.ztype && ARMORED.includes(t.ztype)))) return "Just one of the dead: nothing on it worth the time.";
  }
  return "";
}
// Dead or downed on or next to the unit who can be searched (not yet, or something left on them). In a raid only the
// living (its dead are containers already: combat.js damage).
export function bodiesNear(b, u) {
  if (!b) return [];
  syncBodies(b);
  return b.units.filter((t) => t !== u && !bodyRefusal(b, t) && (!b.raid || downedFoe(t)) && (t.f || 0) === (u.f || 0) && cheb(u, t.x, t.y) <= GROUND.reach)
    .filter((t) => { const c = bodyBoxOf(b, t); return !c || pileCount(c); })
    .sort((a, c) => (bodyBoxOf(b, a) ? 1 : 0) - (bodyBoxOf(b, c) ? 1 : 0) || cheb(u, a.x, a.y) - cheb(u, c.x, c.y));
}

// What a body has on it, rolled as the battle's end rolls it (combat.js endBattle): an item list and supplies. A rig's
// pouches and a pack's slots are emptied out into the list, so each magazine or thing can be taken by itself.
export function deadBodyOf(state, b, t) {
  const rng = state.rng;
  let body;
  if (t.side === "player") {
    const s = survivorById(state, t.sid);
    const held = s && s.gear ? s.gear.weapon : null;
    body = { gear: s ? stripAll(ensureInv(s)) : [], sup: {} };
    for (const it of body.gear) if (it === held) gunOut(b, t, it); else gunLeavesTeam(b, it); // gunload.js: what is in their guns goes with them
    if (t.haul) { // what they carried loose
      body.gear.push(...t.haul.gear.splice(0));
      for (const [k, v] of Object.entries(t.haul.sup)) if (v > 0) { body.sup[k] = v; t.haul.sup[k] = 0; }
    }
    return spill(body);
  }
  if (t.walking) body = walkingBody(state, b, t);
  else if (t.turned) body = turnedBody(rng, t);
  else body = launcherBody(b, t, enemyBody(rng, t, KITS[t.kit] || (t.kind === "zombie" ? null : KITS.raiders)));
  const gear = allItems(body);
  const sup = {};
  for (const [k, v] of Object.entries(body.supplies || {})) if (v >= 1) sup[k] = Math.floor(v);
  return spill({ gear, sup });
}
function spill(c) {
  const out = [];
  for (const it of c.gear) {
    if (!it) continue;
    out.push(it);
    const d = GEAR[it.key];
    if (Array.isArray(it.contents) && d && (packSize(it) || d.pouches)) it.contents.forEach((x, i) => { if (x) { out.push(x); it.contents[i] = null; } });
  }
  return { gear: out, sup: c.sup };
}

// The first search of a body (SEARCH.ap) rolls what is on it; after that it opens for free. Returns "" or why not.
// Someone alive and down is searched the same way: what was on them is in the container (theirs to take), and they are
// left with nothing in their hands (stripped: if they get up again, they fight bare-handed).
export function searchBody(state, b, u, t) {
  if (!b) return "Nothing to search.";
  const why = bodyRefusal(b, t);
  if (why) return why;
  if (b.raid && !downedFoe(t)) return "In a raid the dead are searched like any container (Search).";
  if ((t.f || 0) !== (u.f || 0) || cheb(u, t.x, t.y) > GROUND.reach) return "Stand on or next to the body to search it.";
  fieldReady(b, state);
  if (bodyBoxOf(b, t)) return "";
  if ((u.ap || 0) < SEARCH.ap) return "No actions left this turn.";
  u.ap -= SEARCH.ap;
  const live = downedFoe(t);
  const box = { id: b.nextId++, x: t.x, y: t.y, f: t.f || 0, kind: "body", uid: t.id, area: null, searched: false, partial: false, label: live ? `${t.name} (searched)` : `${t.name}'s body`, live, byHand: true, contents: deadBodyOf(state, b, t) };
  fieldLayer(b).containers.push(settle(box));
  if (live) stripUnit(t);
  const n = pileCount(box);
  say(b, `${u.name} searches ${live ? t.name : t.side === "player" ? `${t.name}'s body` : `the body of ${t.name}`}: ${n ? `${n} thing${n === 1 ? "" : "s"} on ${live ? "them" : "it"}` : "nothing useful"}.`, n ? "good" : "info");
  if (!n) fx(b, { type: "loot", to: [t.x, t.y], text: "empty" });
  return "";
}
// A downed foe searched: nothing left in their hands or on them that fights (their things are in the container).
function stripUnit(t) {
  t.weapon = "fists"; t.weaponName = "Fists"; t.arsItem = null; t.modItems = null; t.gmWeapon = "fists"; t.item = null;
  t.mag = null; t.magW = null; t.mags = null; t.magsW = null;
  if (t.armorKey) { t.armorKey = null; t.armor = 1; t.wornArmor = 1; }
  t.throwables = {}; delete t.gl; t.medKit = null; t.isMedicKit = false; t.arsArmour = []; t.searchedLive = true;
}
// Bodies searched where they lie keep up with them: dragged (stealth.js), carried and put down (carriers.js), burnt
// (the things with it). A raid's own body containers move by themselves; the downed searched there are ours.
export function syncBodies(b) {
  const L = lootLayer(b);
  if (!L) return;
  L.containers = L.containers.filter((c) => {
    if (c.kind !== "body" || c.uid == null || !(L.field || c.byHand)) return true;
    const t = unitById(b, c.uid);
    if (!t) return true;
    if (t.burnt) return false;
    if ((t.dead || t.down) && !t.off) { c.x = t.x; c.y = t.y; c.f = t.f || 0; }
    return true;
  });
}

// ---------- the AI ----------
// An enemy or a third side's fighter with no gun (fists, a blade) on or next to a pile with a gun in it picks it up (1
// action): the very item, so it is on their body if they fall. Returns true when it did.
export function aiGrabGun(b, u) {
  if (!b || !u || u.side === "player" || u.kind !== "human" || !active(u) || (u.ap || 0) < 1 || u.arsItem) return false;
  const w = WEAPONS[u.weapon];
  if (w && !w.melee) return false;
  for (const p of groundPiles(b)) {
    if (!pileCount(p) || !near(u, p)) continue;
    const gun = p.contents.gear.find((it) => { const g = WEAPONS[it.key]; return g && !g.melee && !g.launcher && !g.mount && !g.mounted && GEAR[it.key] && GEAR[it.key].slot === "weapon"; });
    if (!gun) continue;
    p.contents.gear.splice(p.contents.gear.indexOf(gun), 1);
    settle(p);
    u.weapon = gun.key; u.weaponName = gun.name; u.arsItem = gun; u.mag = null; u.magW = null;
    u.modItems = null; u.gmWeapon = null; u.mags = null; u.magsW = null;
    loadMag(u, gunIn(b, u, gun)); // gunload.js: what was in it, never a free full magazine (else empty: they Reload)
    u.ap -= 1;
    say(b, `${u.name} snatches up the ${gun.name} lying on the ground!`, "danger");
    return true;
  }
  return false;
}

// ---------- the end of a field battle ----------
// Before the bodies are settled (combat.js endBattle, before carriers.js endBodies). See the head of the file.
export function groundEnd(state, b, outcome) {
  if (!b || b.raid) return;
  syncBodies(b);
  const L = b.fieldLoot;
  // What each of yours carries loose: home with the living, on the ground where the others fell.
  const st = storageFor(state, battlePlace(b));
  const home = (b.fieldHome = { supplies: {}, gear: [] });
  for (const u of b.units) {
    if (u.side !== "player" || !u.haul) continue;
    const h = u.haul;
    const s = survivorById(state, u.sid);
    const any = h.gear.length || Object.values(h.sup).some((v) => v > 0);
    if (!any) continue;
    if (s && s.alive && !u.dead && !u.lostBehind && !u.nlTaken && st) {
      for (const it of h.gear) st.list.push(it);
      home.gear.push(...h.gear);
      for (const [k, v] of Object.entries(h.sup)) {
        if (!(v > 0)) continue;
        if (st.o === "cargo") st.party.cargo.supplies[k] = (st.party.cargo.supplies[k] || 0) + v;
        else { const base = baseById(state, st.id); if (base) base.stock[k] = (base.stock[k] || 0) + v; }
        home.supplies[k] = (home.supplies[k] || 0) + v;
      }
    } else {
      const p = groundPile(b, u.x, u.y, u.f || 0);
      p.contents.gear.push(...h.gear);
      for (const [k, v] of Object.entries(h.sup)) if (v > 0) p.contents.sup[k] = (p.contents.sup[k] || 0) + v;
      settle(p);
    }
    h.gear.length = 0;
    for (const k of Object.keys(h.sup)) h.sup[k] = 0;
  }
  // gunload.js: the guns that came home with rounds in them (picked up, handed over) are unloaded into the stores.
  const living = b.units.filter((u) => u.side === "player" && !u.dead && !u.lostBehind && !u.nlTaken).map((u) => survivorById(state, u.sid)).filter((s) => s && s.alive);
  if (st) unloadInto(st, teamGuns(living, st.list), stockFor(state, st));
  if (!L) return;
  for (const c of L.containers.slice()) {
    if (c.kind !== "body" || c.uid == null) continue;
    const t = unitById(b, c.uid);
    if (!t) continue;
    if (t.inVehicle && t.side !== "player" && t.kind === "human") { t.box = c; L.containers.splice(L.containers.indexOf(c), 1); continue; } // carriers.js endBodies: into the car with it
    if (t.roseAs != null) { // it got up: put down again, the body is the risen one's; still walking, what was left lies here
      const z = unitById(b, t.roseAs);
      if (z && z.dead && !z.burnt && !z.off) { c.uid = z.id; c.x = z.x; c.y = z.y; c.f = z.f || 0; }
      else c.uid = null;
      continue;
    }
    if (!t.dead) { // searched alive: a prisoner after a win keeps what you left on them (their loot, not rolled again); else it lies there
      if (t.down && !t.off && outcome === "victory") c.label = `${t.name} (prisoner)`;
      else { c.uid = null; c.kind = "ground"; c.label = "On the ground"; }
      continue;
    }
    if (t.off || t.inVehicle) c.uid = null; // carried off, in the car: what was left stays where it was searched
  }
}
// Has this one's body been searched in the battle (its loot is the container's, not rolled again)?
export const searchedInBattle = (b, t) => !!(b && bodyBoxOf(b, t) && (!b.raid || bodyBoxOf(b, t).byHand));

// ---------- fire ----------
// A pile on a burning cell (throwables.js b.fires), once a turn while it burns (carriers.js burnUnderFire, at the start
// of each side's turn): launchers.js fireStuff (what burns is gone, the rest worn by the heat, rounds cook off).
// In a raid and a field battle alike. Returns how many piles it reached.
export function groundFire(b) {
  if (!b || !b.fires || !b.fires.length) return 0;
  let n = 0;
  for (const p of groundPiles(b)) {
    if (!pileCount(p) || p.fireTurn === b.turn || !fireAt(b, p.x, p.y) || (p.f || 0) !== (b.floor || 0)) continue;
    p.fireTurn = b.turn;
    const r = fireStuff(p.contents.gear, p.contents.sup, b.dseed ?? 0, b.turn || 0, p.id);
    p.contents.gear = r.gear;
    settle(p);
    if (r.lost) say(b, `The fire takes what lies on the ground (${r.lost} thing${r.lost === 1 ? "" : "s"} burnt).`, "info");
    n++;
  }
  return n;
}

// After a win: every pile and searched body with something left, as a loot-screen body (its things loose). Else they
// stay where they are: a death site on the tile. Returns the bodies (a win) or [].
export function groundLeftovers(state, b, outcome) {
  const L = b && !b.raid ? b.fieldLoot : null;
  if (!L) return [];
  const out = [];
  let ground = null; // every pile on the ground is one "On the ground" entry
  for (const c of L.containers) {
    if (!pileCount(c)) continue;
    let pile;
    if (isPile(c) && ground) {
      pile = ground;
      pile.loose.push(...c.contents.gear);
      for (const [k, v] of Object.entries(c.contents.sup)) if (v > 0) pile.supplies[k] = (pile.supplies[k] || 0) + v;
    } else {
      pile = ensureInv({ name: isPile(c) ? "On the ground" : c.label, kind: "pile", pile: true, uid: isPile(c) ? null : c.uid ?? null, supplies: { ...c.contents.sup }, loose: c.contents.gear.slice() });
      if (isPile(c)) ground = pile;
    }
    // Left over, not found: it is not counted as found until it is taken (raidloot.js tally).
    for (const g of c.contents.gear) { const i = L.foundGear.indexOf(g); if (i >= 0) L.foundGear.splice(i, 1); }
    for (const [k, v] of Object.entries(c.contents.sup)) if (v > 0 && L.found[k]) { L.found[k] = Math.max(0, L.found[k] - v); if (!L.found[k]) delete L.found[k]; }
    c.contents.gear = []; c.contents.sup = {};
    settle(c);
    if (!out.includes(pile)) out.push(pile);
  }
  if (outcome === "victory") return out;
  if (out.length) leaveBodies(state, { bodies: out, tileId: b.tileId, setup: b.setup });
  return [];
}
// What the field battle found and brought home (the result's loot line): what came off bodies and piles less what was
// left lying, plus nothing twice.
export function fieldFinds(b, loot) {
  const L = b && !b.raid ? b.fieldLoot : null;
  if (!L) return loot;
  for (const [k, v] of Object.entries(L.found)) if (v >= 1) loot.supplies[k] = (loot.supplies[k] || 0) + Math.floor(v);
  for (const g of L.foundGear) if (!loot.gear.includes(g)) loot.gear.push(g);
  return loot;
}

// ---------- the battle's acts (combat.js combatAct) ----------
// { type: "searchBody", unit, target }: search the dead one on or next to the unit (1 action the first time).
// { type: "pickUp", unit, x?, y?, item?, arms? }: all that fits (or the item at that index) from the pile on that cell,
//   else the nearest pile on or next to the unit. The hauling time it takes. arms: the item into the arms (a bag).
// { type: "drop", unit, loc, qty? }: put what is at the inventory location on the unit's cell (free).
// The search window moves things one by one without these (raidloot.js raidMove).
export function groundAct(state, b, u, act) {
  if (act.type === "searchBody") return searchBody(state, b, u, unitById(b, act.target));
  if (act.type === "pickUp") {
    const where = act.x != null ? { x: act.x, y: act.y, f: u.f || 0 } : null;
    const pile = where ? groundAt(b, where.x, where.y, where.f) : pilesNear(b, u)[0];
    const item = pile && act.item != null ? pile.contents.gear[act.item] || null : null;
    const r = pickUpFromGround(state, b, u, pile || where, item, !!act.arms);
    if (!r.got.length) return r.msg || "Nothing there fits.";
    say(b, `${u.name} picks up ${r.got.join(", ")}${r.left ? " (the rest stays on the ground)" : ""}.`, "info");
    return "";
  }
  if (act.type === "drop") {
    const p = groundAt(b, u.x, u.y, u.f || 0);
    const before = pileCount(p) + (p ? p.contents.gear.length + Object.values(p.contents.sup).reduce((a, v) => a + Math.max(0, v), 0) : 0);
    const msg = dropAt(state, u.id, act.loc, act.qty ?? Infinity);
    const q = groundAt(b, u.x, u.y, u.f || 0);
    const after = pileCount(q) + (q ? q.contents.gear.length + Object.values(q.contents.sup).reduce((a, v) => a + Math.max(0, v), 0) : 0);
    if (after <= before) return msg || "Nothing to put down.";
    say(b, `${u.name} puts it down: ${msg}`, "info");
    return "";
  }
  return "Unknown action.";
}
