// Makeshift picks (docs/prompts/battle-inventory.md Session F, the user's ask "craft for makeshift picks to pick locks:
// break easy and low chance of working but is quiet, be stackable"; sim/locks.js MAKESHIFT_PICK / picksOf / wearPicks,
// crafting.js CRAFTS.makeshiftpick / craftItem, data-stacks.js STACK_MAX):
// - the item and the recipe: small, makeshift, no dur, stacks to 10; 1 scrap, 1 hour, no skill, no book, field;
// - a base craft makes a stack of 3 that joins a stack already in the armory; a craft order counts the picks;
// - a field craft puts the stack on a member (onto their stack first) and takes the scrap;
// - picksOf prefers the crowbar and lockpicks, falls back to the stack, is null with neither; barOf never pries with them;
// - the odds: the real picks' roll from 30%, lower than the crowbar's at every Stealth, floor 5% and cap 95%;
// - a safe, a steel security door and a gun cabinet refuse them with a reason; a key and force still work;
// - every attempt is quiet (Heat +1, no b.noise, nothing woken) and snaps one pick half the time, open or not; the
//   stack goes at 0 and picking with it; the lock panel says "Pick (makeshift)" with the picks left;
// - the raid bot picks with them; the hour-by-hour search's picker uses them and they snap there too;
// - a mid-fight save keeps the stack.
// Usage: node tools/makeshiftpicktest.js [seed]
import { createWorld, hub, atBase, survivorById, skill } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { STACK_MAX } from "../src/sim/data-stacks.js";
import { stackMax, countOf, withCount } from "../src/sim/itemstack.js";
import { CRAFTS, canCraft, queueCraft, craftingHour, craftQueue, fieldCraftOptions, fieldCraft, craftOutputText, craftItem } from "../src/sim/crafting.js";
import { addCraftOrder, craftOrderHave, craftOrders } from "../src/sim/production.js";
import { craftLock } from "../src/sim/blueprints.js";
import { newItem, allCarried, ensureInv } from "../src/sim/inventory.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { createBattle, combatAct, CELL, registerCombatHandler, unitAt } from "../src/sim/combat.js";
import { startScavenge, searchHour } from "../src/sim/scavenge.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import * as L from "../src/sim/locks.js";

const seed = Number(process.argv[2] || 7);
let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const near = (a, b) => Math.abs(a - b) < 1e-9;
const pct = (v) => `${Math.round(v * 100)}%`;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
registerCombatHandler("mptest", () => {});

const W = (k = 0) => { const st = createWorld({ seed: seed * 100 + k, factionCount: 6 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
const stackOf = (n) => withCount(newItem("makeshiftpick", 1), n);
const picksOn = (s) => allCarried(s).filter((it) => it.key === "makeshiftpick");
const stripTools = (s) => { for (const k of Object.keys(s.gear || {})) if (s.gear[k] && (s.gear[k].key === "crowbar" || (GEAR[s.gear[k].key] || {}).pry)) s.gear[k] = null; s.pockets = (s.pockets || []).map((it) => (it && (it.key === "crowbar" || it.key === "makeshiftpick") ? null : it)); };

// A raid on a site with a crew of 3 from the hub, no enemies on the map.
function raid(k = 0, types = ["police", "pharmacy", "gunstore", "warehouse", "store"]) {
  for (let i = 0; i < 60; i++) {
    const st = W(k * 7 + i);
    const h = hub(st);
    const tile = st.tiles.find((t) => t.loc && t.id !== h.tile && types.includes(t.loc.type));
    if (!tile) continue;
    const crew = atBase(st, h.id).slice(0, 3);
    for (const s of crew) { s.traits = []; stripTools(s); }
    const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 6, water: 6, ammo: 30, meds: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.phase = "engaged";
    const setup = { mode: "raid", tile: tile.id, partyId: p.id, canRetreat: true, ambush: null, handler: "mptest", enemy: { kind: "zombies", count: 0, power: 2, groups: [] }, raid: { heat0: 5 }, context: {} };
    st.combat = createBattle(st, setup);
    const b = st.combat;
    if (b.raid.choose) b.raid.choose = null;
    b.units = b.units.filter((u) => u.side === "player");
    b.night = false;
    if (b.raid.containers.filter((c) => c.kind !== "body" && !c.lock && !(L.LOCKS[c.lockKind] || {}).tier).length < 2) continue;
    return { st, b, p, crew };
  }
  throw new Error("no raid map");
}
const player = (b) => b.units.find((u) => u.side === "player" && !u.dead && !u.left);
function standNext(b, u, x, y) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= b.w || ny >= b.h || !CELL[b.cells[ny * b.w + nx].k].walk || unitAt(b, nx, ny)) continue;
    u.x = nx; u.y = ny;
    return true;
  }
  return false;
}
// A plain container (no gun safe) next to the unit.
const boxNear = (b, u) => b.raid.containers.find((c) => c.kind !== "body" && !(c.lock && L.LOCKS[c.lock.kind].tier) && standNext(b, u, c.x, c.y));

// ======================================================================================
console.log("The item and the recipe");
{
  const d = GEAR.makeshiftpick, r = CRAFTS.makeshiftpick;
  check(d && d.small && d.makeshift && !d.dur && d.weight <= 0.05 && d.value <= 2 && d.cat && /snap/.test(d.desc), "GEAR.makeshiftpick: small, makeshift, no dur, 0.02 kg, cheap, says it snaps");
  check(STACK_MAX.makeshiftpick === 10 && stackMax("makeshiftpick") === 10, `stacks to 10 in one slot (${stackMax("makeshiftpick")})`);
  check(r && r.gear === "makeshiftpick" && r.n === 3 && r.in.scrap === 1 && Object.keys(r.in).length === 1 && r.hours === 1 && r.min === 0 && r.field === true, "the recipe: 3 a craft from 1 scrap, 1 hour, no skill, in the field");
  check(craftLock({ known: [] }, "makeshiftpick") === "", "no book or blueprint locks it");
  check(/3 a craft/.test(craftOutputText("makeshiftpick")) && /up to 10/.test(craftOutputText("makeshiftpick")) && /locks/.test(craftOutputText("makeshiftpick")), `the recipe's output text says what it is (${craftOutputText("makeshiftpick")})`);
  const it = craftItem(r, 0.7);
  check(it.key === "makeshiftpick" && countOf(it) === 3 && it.quality === 1 && it.dur == null, "craftItem: a stack of 3 at full quality (so stacks merge), no dur");
  check(L.MAKESHIFT_PICK.base < L.PICK.base && L.MAKESHIFT_PICK.snap >= 0.4 && L.MAKESHIFT_PICK.no.includes("safe") && L.MAKESHIFT_PICK.no.includes("vault"), `MAKESHIFT_PICK: base ${L.MAKESHIFT_PICK.base} below ${L.PICK.base}, snap ${L.MAKESHIFT_PICK.snap}, not a safe or a vault`);
}

// ======================================================================================
console.log("Crafted at a base: a stack of 3 that joins the stack in the armory");
{
  const st = W(1);
  const h = hub(st);
  const ppl = atBase(st, h.id);
  ppl.forEach((s) => { s.role = "idle"; s.inBed = false; });
  ppl[0].role = "craft";
  h.stock.scrap = 10;
  h.armory = h.armory.filter((it) => !it || it.key !== "makeshiftpick");
  const chk = canCraft(st, h, "makeshiftpick");
  check(chk.ok, `can be queued with 1 scrap and anyone on Craft (${chk.reason || "ok"})`);
  const msg = queueCraft(st, h, "makeshiftpick");
  check(/Makeshift picks/.test(msg) && h.stock.scrap === 9, `queued: 1 scrap paid (${msg})`);
  const run = () => { let n = 0; while (craftQueue(h).length && n < 50) { craftingHour(st); st.hour++; n++; } return n; };
  const hrs = run();
  const stacks = () => h.armory.filter((it) => it && it.key === "makeshiftpick");
  check(hrs >= 1 && hrs <= 3 && stacks().length === 1 && countOf(stacks()[0]) === 3, `an hour or so later a stack of 3 is in the armory (${hrs} h, ${stacks().length} stack${stacks().length === 1 ? "" : "s"} of ${stacks().map(countOf).join("/")})`);
  queueCraft(st, h, "makeshiftpick"); run();
  check(stacks().length === 1 && countOf(stacks()[0]) === 6, `a second craft joins the stack: one stack of 6 (${stacks().map(countOf).join("/")})`);
  // A craft order counts the picks, not the stacks.
  craftOrders(h).length = 0;
  addCraftOrder(st, h, "makeshiftpick", 9);
  check(craftOrderHave(h, craftOrders(h)[0]) === 6, `a craft order counts the picks in the stack (${craftOrderHave(h, craftOrders(h)[0])})`);
  // The limit holds: a stack of 10 plus 3 is two stacks.
  stacks()[0].n = 9;
  queueCraft(st, h, "makeshiftpick"); run();
  const all = stacks().map(countOf);
  check(stacks().length === 2 && all.reduce((a, v) => a + v, 0) === 12 && Math.max(...all) === 10, `past 10 the rest is a stack of its own (${all.join("/")})`);
}

// ======================================================================================
console.log("Crafted in the field: onto a member, then onto their stack");
{
  const st = W(2);
  const h = hub(st);
  const ppl = atBase(st, h.id).slice(0, 2);
  ppl.forEach((s) => { ensureInv(s); stripTools(s); });
  const party = { id: 999901, members: ppl.map((s) => s.id), supplies: { scrap: 2, water: 4, food: 10 }, cargo: { supplies: {}, gear: [] } };
  st.parties.push(party);
  ppl.forEach((s) => (s.location = { kind: "party", partyId: party.id }));
  const opt = fieldCraftOptions(st, party).find((o) => o.key === "makeshiftpick");
  check(opt && opt.ok, `offered to a team with a scrap (${opt ? opt.reason || "ok" : "not offered"})`);
  const msg = fieldCraft(st, party, "makeshiftpick");
  const have = () => ppl.flatMap(picksOn);
  check(/3 makeshift picks/.test(msg) && party.supplies.scrap === 1 && have().length === 1 && countOf(have()[0]) === 3, `made 3 for a scrap, kept by a member (${msg})`);
  const msg2 = fieldCraft(st, party, "makeshiftpick");
  check(party.supplies.scrap === 0 && have().length === 1 && countOf(have()[0]) === 6, `a second craft joins that stack: 6 in one (${msg2})`);
  const msg3 = fieldCraft(st, party, "makeshiftpick");
  check(/Needs 1 scrap/.test(msg3) && have().length === 1 && countOf(have()[0]) === 6, `no scrap: refused (${msg3})`);
}

// ======================================================================================
console.log("Who picks with what: the crowbar first, else the stack");
{
  const st = W(3);
  const s = atBase(st, hub(st).id)[0];
  ensureInv(s); stripTools(s);
  check(L.picksOf(s) === null && L.barOf(s) === null, "nothing: no picks, no bar");
  s.pockets[0] = stackOf(3);
  check(L.picksOf(s) === s.pockets[0] && L.isMakeshiftPicks(L.picksOf(s)) && L.makeshiftPicksOf(s) === s.pockets[0], "a stack in a pocket: makeshift picks");
  check(L.barOf(s) === null, "makeshift picks pry nothing (barOf null)");
  s.gear.tool = newItem("crowbar");
  check(L.picksOf(s) === s.gear.tool && !L.isMakeshiftPicks(L.picksOf(s)) && L.crowbarOf(s) === s.gear.tool && L.barOf(s) === s.gear.tool, "with the crowbar and lockpicks too: those first, and they pry");
  s.gear.tool.dur = 0;
  check(L.picksOf(s) === s.pockets[0], "a worn-out crowbar's picks: the stack again");
  s.gear.tool = null;
  s.pockets[0].n = 0;
  check(L.picksOf(s) === null, "an emptied stack (n 0) is no picks");
  s.pockets[0] = null;
  // In the pack too.
  s.gear.backpack = newItem("backpack");
  s.gear.backpack.contents[0] = stackOf(2);
  check(L.picksOf(s) === s.gear.backpack.contents[0], "a stack in the pack counts");
  check(L.makeshiftPickable("lockbox") && L.makeshiftPickable("door") && L.makeshiftPickable("cage") && L.makeshiftPickable("car") && !L.makeshiftPickable("safe") && !L.makeshiftPickable("vault") && !L.makeshiftPickable("gunsafe1") && !L.makeshiftPickable("gunsafe2"), "what a bent wire can work: boxes, doors, cages, cars; not a safe, a steel door or a gun safe");
}

// ======================================================================================
console.log("Odds: lower than the real picks, floors and caps, safes refuse");
{
  const { st, b, crew } = raid(1);
  const u = player(b);
  const s = crew.find((c) => c.id === u.sid);
  ensureInv(s); stripTools(s);
  s.pockets[0] = stackOf(5);
  s.skills.stealth = 0;
  for (const [kind, def] of Object.entries(L.LOCKS)) {
    if (def.tier) continue; // gun safes below
    const lock = { kind, open: false, tries: 0 };
    for (const stealth of [0, 5, 10, 20]) {
      s.skills.stealth = stealth;
      const o = L.openOdds(st, b, u, lock);
      if (!L.makeshiftPickable(kind)) { check(!o.pick.ok && o.pick.makeshift && /beyond makeshift picks/.test(o.pick.why) && o.pick.label === "Pick (makeshift)", `${kind}: refused (${o.pick.why})`); continue; }
      const want = clamp(L.MAKESHIFT_PICK.base + L.PICK.perStealth * stealth - L.PICK.perDiff * (def.diff - 1), 0.05, 0.95);
      check(o.pick.ok && o.pick.makeshift && o.pick.label === "Pick (makeshift)" && o.pick.left === 5 && near(o.pick.chance, want), `${kind} (difficulty ${def.diff}), Stealth ${stealth}: ${pct(o.pick.chance)} (want ${pct(want)}), 5 left`);
      s.gear.tool = newItem("crowbar");
      const real = L.openOdds(st, b, u, lock);
      check(!real.pick.makeshift && real.pick.chance >= o.pick.chance && (real.pick.chance > o.pick.chance || real.pick.chance === 0.95 || o.pick.chance === 0.05), `${kind}, Stealth ${stealth}: the crowbar's picks do better (${pct(real.pick.chance)} vs ${pct(o.pick.chance)})`);
      s.gear.tool = null;
    }
  }
  s.skills.stealth = 0;
  check(near(L.openOdds(st, b, u, { kind: "cage" }).pick.chance, 0.05), `the floor holds: a gun cage at Stealth 0 is ${pct(L.openOdds(st, b, u, { kind: "cage" }).pick.chance)}`);
  s.skills.stealth = 20; u.quiet = true;
  check(near(L.openOdds(st, b, u, { kind: "lockbox" }).pick.chance, 0.95), `the cap holds: a lockbox at Stealth 20 with Quiet Hands is ${pct(L.openOdds(st, b, u, { kind: "lockbox" }).pick.chance)}`);
  u.quiet = false; s.skills.stealth = 0;
  // A safe: the key and the real picks still work.
  const so = L.openOdds(st, b, u, { kind: "safe" });
  check(!so.pick.ok && !so.force.ok, `a safe: no bent wire, no force (${so.pick.why})`);
  s.gear.tool = newItem("crowbar");
  check(L.openOdds(st, b, u, { kind: "safe" }).pick.ok, "the crowbar's picks still pick a safe");
  s.gear.tool = null;
  L.addKey(st, b.tileId, "test");
  check(L.openOdds(st, b, u, { kind: "safe" }).key.ok && L.openOdds(st, b, u, { kind: "vault" }).key.ok, "the site's key opens a safe and a steel door");
  st.keys.length = 0;
  // A gun cabinet (the cheap gun safe): beyond them too.
  const go = L.openOdds(st, b, u, { kind: "gunsafe1", mech: "key" });
  check(!go.pick.ok && go.pick.makeshift && /beyond makeshift picks/.test(go.pick.why), `a gun cabinet refuses them (${go.pick.why})`);
  // Without any picks the refusal names them.
  s.pockets[0] = null;
  check(/makeshift picks/.test(L.openOdds(st, b, u, { kind: "lockbox" }).pick.why), "no picks at all: the reason names makeshift picks as a way");
}

// ======================================================================================
console.log("Attempts: quiet, one pick snapping half the time, the stack gone at 0");
{
  const { st, b, crew } = raid(2);
  const u = player(b);
  const s = crew.find((c) => c.id === u.sid);
  ensureInv(s); stripTools(s);
  s.skills.stealth = 0;
  const N = 10;
  s.pockets[0] = stackOf(N);
  const box = boxNear(b, u);
  check(!!box, "test setup: a container next to the unit");
  box.lock = { kind: "locker", open: false, tries: 0 };
  box.searched = false; box.contents = null;
  let wakes = 0;
  const H = { say() {}, alertNear() { wakes++; }, fx() {} };
  let tries = 0, snaps = 0, heatOk = true, noiseOk = true, apOk = true, opened = 0, snapOnOpen = 0, snapOnMiss = 0;
  const UI = await import("../src/ui/locks.js").catch(() => null); // the lock panel (headless: no DOM needed to build the HTML)
  let panelOk = false;
  if (UI) {
    b.phase = "player"; b.over = false; u.ap = 2;
    const html = UI.lockPanel(st, b, u);
    panelOk = /Pick \(makeshift\)/.test(html) && new RegExp(`${N} left`).test(html) && /snaps one pick/.test(html);
  }
  check(panelOk, "the lock panel offers Pick (makeshift) with the odds and the picks left");
  while (L.makeshiftPicksOf(s) && tries < 200) {
    const before = countOf(L.makeshiftPicksOf(s));
    box.lock.open = false;
    u.ap = 2; b.turn++;
    const h0 = b.raid.heat, n0 = b.noise || 0;
    const err = L.openLock(st, b, u, { type: "open", unit: u.id, target: `c${box.id}`, method: "pick" }, H);
    if (err) { check(false, `attempt refused: ${err}`); break; }
    tries++;
    if (b.raid.heat - h0 !== L.PICK.heat) heatOk = false;
    if ((b.noise || 0) !== n0) noiseOk = false;
    if (u.ap !== 1) apOk = false;
    const after = L.makeshiftPicksOf(s) ? countOf(L.makeshiftPicksOf(s)) : 0;
    if (after === before - 1) { snaps++; if (box.lock.open) snapOnOpen++; else snapOnMiss++; }
    else if (after !== before) check(false, `a try took ${before - after} picks`);
    if (box.lock.open) opened++;
  }
  check(snaps === N && !L.makeshiftPicksOf(s) && !s.pockets[0], `every pick snapped in the end and the stack is gone (${snaps} snaps in ${tries} tries)`);
  check(tries > N && tries < 6 * N, `about half the tries snap one (${tries} tries for ${N} picks)`);
  check(snapOnOpen > 0 && snapOnMiss > 0 && opened > 0, `picks snap whether the lock opened or not (${snapOnOpen} on an open, ${snapOnMiss} on a miss; ${opened} opens)`);
  check(heatOk && noiseOk && wakes === 0 && apOk, "every try: Heat +1, no noise, nothing woken, 1 action");
  const o = L.openOdds(st, b, u, box.lock);
  check(!o.pick.ok && /makeshift picks/.test(o.pick.why), "no picks left: picking is refused");
  // Through the real combat action too (the dice are the battle's: the same try may snap or not).
  s.pockets[0] = stackOf(1);
  box.lock = { kind: "locker", open: false, tries: 0 };
  let n = 0;
  while (L.makeshiftPicksOf(s) && n < 50) { u.ap = 2; b.turn++; b.phase = "player"; b.over = false; const err = combatAct(st, { type: "open", unit: u.id, target: `c${box.id}`, method: "pick" }); if (err) { check(false, `combatAct: ${err}`); break; } box.lock.open = false; n++; }
  check(n >= 1 && !L.makeshiftPicksOf(s), `the open action snaps the last pick after ${n} tr${n === 1 ? "y" : "ies"}`);
  // The crowbar's picks wear as before (a use a try, no random snapping).
  s.gear.tool = newItem("crowbar");
  s.gear.tool.dur = 3;
  u.ap = 2; b.turn++;
  L.openLock(st, b, u, { type: "open", unit: u.id, target: `c${box.id}`, method: "pick" }, H);
  check(s.gear.tool && s.gear.tool.dur === 2, "the crowbar's picks still lose one use a try");
}

// ======================================================================================
console.log("The raid bot and the hour-by-hour search");
{
  const { st, b, crew } = raid(3);
  const u = player(b);
  const s = crew.find((c) => c.id === u.sid);
  ensureInv(s); stripTools(s);
  s.skills.stealth = 2;
  s.pockets[0] = stackOf(4);
  const box = boxNear(b, u);
  box.lock = { kind: "lockbox", open: false, tries: 0 };
  box.searched = false; box.botSkip = false;
  b.raid.heat = 10;
  const a = L.autoLock(st, b, u);
  check(a && a.type === "open" && a.method === "pick" && a.target === `c${box.id}`, `the bot picks a lockbox with makeshift picks (${a ? a.method : "nothing"})`);
  box.lock = { kind: "safe", open: false, tries: 0 };
  box.botSkip = false;
  const a2 = L.autoLock(st, b, u);
  check(!a2 && box.botSkip, "a safe with only makeshift picks: the bot gives it up");
}
{
  const st = W(4);
  const h = hub(st);
  const tile = st.tiles.find((t) => t.loc && ["police", "pharmacy", "gunstore"].includes(t.loc.type));
  const crew = atBase(st, h.id).slice(0, 2);
  crew.forEach((c) => { ensureInv(c); stripTools(c); });
  crew[0].pockets[0] = stackOf(10);
  crew[0].skills.stealth = 10;
  const res = launchExpedition(st, { memberIds: crew.map((c) => c.id), dest: tile.id, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 6, ammo: 60 } });
  const p = res.party;
  p.path = [tile.id]; p.idx = 0; p.dest = tile.id;
  let lines = 0, byPicks = 0, snapped = 0, noWay = 0;
  for (let k = 0; k < 60 && L.makeshiftPicksOf(crew[0]); k++) {
    tile.loot = 1;
    st.engagement = null;
    startScavenge(st, p);
    st.engagement.approach = "sneak";
    const line = searchHour(st) || "";
    if (/\ban? (evidence locker|gun cage|drug cabinet|safe|lockbox|locked locker|sealed crate)/i.test(line)) lines++;
    if (/Picked an? |held against the makeshift picks/.test(line)) byPicks++;
    if (/makeshift picks? snapped/.test(line)) snapped++;
    if (/could not be opened/.test(line)) noWay++;
    st.hour += 1;
    if (!partyMembers(st, p).length) break;
  }
  const left = L.makeshiftPicksOf(crew[0]) ? countOf(L.makeshiftPicksOf(crew[0])) : 0;
  check(lines > 0 && byPicks > 0 && noWay === 0, `the search hour's picker uses the makeshift picks at ${tile.loc.name} (${byPicks} of ${lines} locked finds worked with them, ${noWay} given up)`);
  check(snapped > 0 && left < 10, `and they snap there too (${snapped} hours with a snap, ${left} of 10 left)`);
}

// ======================================================================================
console.log("Saved mid-fight: the stack stays");
{
  const { st, b, crew } = raid(5);
  const u = player(b);
  const s = crew.find((c) => c.id === u.sid);
  ensureInv(s); stripTools(s);
  s.pockets[0] = stackOf(7);
  hub(st).armory.push(stackOf(4));
  const st2 = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const s2 = survivorById(st2, s.id);
  const picks2 = L.picksOf(s2);
  check(st2.combat && picks2 && L.isMakeshiftPicks(picks2) && countOf(picks2) === 7, `the stack of 7 is in the pocket after a save and load (${picks2 ? countOf(picks2) : 0})`);
  const arm = hub(st2).armory.find((it) => it && it.key === "makeshiftpick");
  check(arm && countOf(arm) === 4, "and the armory's stack of 4");
  const u2 = st2.combat.units.find((x) => x.id === u.id);
  const o = L.openOdds(st2, st2.combat, u2, { kind: "door" });
  check(o.pick.ok && o.pick.makeshift && o.pick.left === 7, "the loaded fight picks with them");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
