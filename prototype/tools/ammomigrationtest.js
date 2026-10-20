// Old saves and rounds by calibre (src/sim/ammo.js migrateAmmo, save.js deserializeState; docs/weapons-overhaul-plan.md
// section 20, R1): a save from before has generic "ammo" in its bases' stocks and its teams' supplies and cargo; loaded,
// every such stock holds the same total as rounds split across the calibres of the guns that holder owns (the people
// there, its armory or cargo), 9mm and 12 gauge when it has none, and no generic ammo is left in it. Loading again
// changes nothing. Checked on a world made old by hand (every kind of holder, a fight saved half-way) and on every save
// in the corpus (tools/saves/: the totals before, read without migrations, against the totals after).
// Usage: node tools/ammomigrationtest.js
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createWorld, makeSurvivor, hub, tickHour } from "../src/sim/world.js";
import { saveToString, loadFromString, deserializeState, decodeGraph, checkSave } from "../src/sim/save.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { createBattle, registerCombatHandler } from "../src/sim/combat.js";
import { newItem } from "../src/sim/inventory.js";
import { ROUND_KEYS, totalRounds, roundsIn, setRounds, gunCals, calOf, roundOf } from "../src/sim/ammo.js";
import { SUPPLIES } from "../src/sim/data.js";

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL ${msg}`); } return ok; };
registerCombatHandler("ammomig", () => {});
const calsIn = (rec) => [...new Set(ROUND_KEYS.filter((k) => (rec[k] || 0) >= 1).map((k) => roundOf(k).cal))].sort();
const generic = (rec) => Math.floor((rec && rec.ammo) || 0);
const showCals = (rec) => JSON.stringify(Object.fromEntries(ROUND_KEYS.filter((k) => (rec[k] || 0) >= 1).map((k) => [k, rec[k]])));

// An old world: every holder of yours back to generic ammo, the mark gone.
function makeOld(state, amounts) {
  for (const [rec, n] of amounts) { setRounds(rec, 0); rec.ammo = n; }
  for (const s of state.survivors) { for (let i = 0; i < (s.pockets || []).length; i++) if (s.pockets[i] && ROUND_KEYS.includes(s.pockets[i].key)) s.pockets[i] = null; }
  delete state.ammoCal;
}

// 1. A world made old by hand.
{
  console.log("A world from before");
  const st = createWorld({ seed: 31, factionCount: 4 });
  const h = hub(st);
  const people = st.survivors.filter((s) => s.alive);
  for (const s of people) s.gear.weapon = null;
  people[0].gear.weapon = newItem("pistol"); people[1].gear.weapon = newItem("huntrifle"); people[2].gear.weapon = newItem("pistol");
  people[3].gear.weapon = newItem("shotgun"); people[4].gear.weapon = newItem("machete"); people[5].gear.weapon = newItem("knife");
  people[1].gear.weapon.load = "bogus";
  // A team of the shotgun alone; an outpost with nobody armed.
  h.stock.food += 50; h.stock.water += 50;
  const res = launchExpedition(st, { memberIds: [people[3].id], dest: h.tile, mission: "move", stance: "normal", supplies: { food: 3, water: 3 } });
  check(!res.error, `a team set out (${res.error || "ok"})`);
  const p = res.party;
  const out = { id: 990001, tile: st.tiles.find((t) => t.id !== h.tile && t.terrain !== "water").id, type: "outpost", name: "Old Outpost", stock: { food: 5 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(out);
  makeOld(st, [[h.stock, 240], [p.supplies, 37], [p.cargo.supplies, 13], [out.stock, 50]]);
  const before = { hub: generic(h.stock), sup: generic(p.supplies), cargo: generic(p.cargo.supplies), out: generic(out.stock) };
  const loaded = loadFromString(saveToString(st));
  const h2 = loaded.bases.find((b) => b.id === h.id), p2 = loaded.parties.find((x) => x.id === p.id), o2 = loaded.bases.find((b) => b.id === out.id);
  check(loaded.ammoCal >= 1, "the save is marked migrated");
  check(totalRounds(h2.stock) === before.hub && !generic(h2.stock), `the hub keeps its ${before.hub} rounds, by calibre (${showCals(h2.stock)})`);
  const hubCals = Object.keys(gunCals(loaded.survivors.filter((s) => s.alive && s.location.kind === "base" && s.location.baseId === h.id), h2.armory)).sort();
  check(JSON.stringify(calsIn(h2.stock)) === JSON.stringify(hubCals), `split across the calibres of the guns there (${calsIn(h2.stock).join(", ")} for ${hubCals.join(", ")})`);
  check(roundsIn(h2.stock, "9mm") > roundsIn(h2.stock, "308"), "two pistols get more of it than one rifle");
  check(totalRounds(p2.supplies) === before.sup && totalRounds(p2.cargo.supplies) === before.cargo && roundsIn(p2.supplies, "12ga") === before.sup && roundsIn(p2.cargo.supplies, "12ga") === before.cargo, `the shotgunner's team: ${before.sup} + ${before.cargo} shells`);
  check(totalRounds(o2.stock) === before.out && roundsIn(o2.stock, "9mm") === 25 && roundsIn(o2.stock, "12ga") === 25, "a base with no guns: 9mm and 12 gauge, half each");
  check(loaded.survivors.find((s) => s.id === people[1].id).gear.weapon.load == null, "an unknown load on a gun is cleared");
  const again = loadFromString(saveToString(loaded));
  const h3 = again.bases.find((b) => b.id === h.id);
  check(showCals(h3.stock) === showCals(h2.stock), "saved and loaded again: nothing moves");
  for (let i = 0; i < 3; i++) tickHour(again);
  check(!generic(again.bases.find((b) => b.id === h.id).stock), "and hours later no generic ammo has come back");
}

// 2. A fight saved half-way.
{
  console.log("A fight saved half-way");
  const st = createWorld({ seed: 32, factionCount: 4 });
  const h = hub(st);
  const s = makeSurvivor(st);
  s.gear.weapon = newItem("revolver");
  s.location = { kind: "base", baseId: h.id };
  st.survivors.push(s);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: [s.id], enemy: { kind: "zombies", count: 2, power: 2 }, ambush: null, canRetreat: true, handler: "ammomig", context: {} });
  makeOld(st, [[h.stock, 60]]);
  for (const u of st.combat.units) delete u.load;
  const loaded = loadFromString(saveToString(st));
  const b = loaded.combat;
  check(b && b.pools[0] === loaded.bases.find((x) => x.id === h.id).stock, "the battle's pool is still the base's stock");
  check(totalRounds(b.pools[0]) === 60 && !generic(b.pools[0]), `its 60 rounds migrated in place (${showCals(b.pools[0])})`);
  const u = b.units.find((x) => x.sid === s.id);
  check(u && calOf(u.weapon) === "357" && roundsIn(b.pools[0], "357") > 0, "the revolver's calibre is among them: it can fire on");
}

// 3. The corpus: every old save, the totals before and after.
{
  console.log("The save corpus");
  const DIR = join(dirname(fileURLToPath(import.meta.url)), "saves");
  const files = existsSync(DIR) ? readdirSync(DIR).filter((f) => /\.bsave(\.gz)?$/.test(f)) : [];
  const readText = (file) => { const bytes = readFileSync(join(DIR, file)); return bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8"); };
  let n = 0;
  for (const file of files) {
    const save = JSON.parse(readText(file));
    if (!checkSave(save).ok) continue;
    const raw = decodeGraph(save.state);
    const st = deserializeState(save);
    n++;
    const mine = (state) => [
      ...state.bases.map((b) => [`base ${b.id}`, b.stock]),
      ...state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && p.kind !== "caravan").flatMap((p) => [[`team ${p.id}`, p.supplies], [`cargo ${p.id}`, p.cargo && p.cargo.supplies]]),
    ];
    const was = new Map(mine(raw).map(([k, r]) => [k, r ? Math.floor((r.ammo || 0)) + ROUND_KEYS.reduce((a, x) => a + Math.floor(r[x] || 0), 0) : 0]));
    // (2026-10-20: an old save's guns and magazines are loaded once with real rounds out of the stores of their place,
    // itemacts.js loadUpAll: what went into them is counted with the stock it came out of)
    const inItems = (it, seen = new Set()) => { if (!it || typeof it !== "object" || seen.has(it)) return 0; seen.add(it); let n = 0; if (it.loaded) n += Array.isArray(it.loaded.stack) ? it.loaded.stack.reduce((a, x) => a + (x.n || 0), 0) : it.loaded.n || 0; if (Array.isArray(it.stack)) n += it.stack.reduce((a, x) => a + (x.n || 0), 0); for (const c of Array.isArray(it.contents) ? it.contents : []) n += inItems(c, seen); if (it.mods) for (const m of Object.values(it.mods)) n += inItems(m, seen); return n; };
    const heldAt = (state, key) => (state.survivors || []).filter((x) => x && x.alive && x.location && ((x.location.kind === "base" && `base ${x.location.baseId}` === key) || (x.location.kind === "party" && `team ${x.location.partyId}` === key))).reduce((a, x) => a + [...Object.values(x.gear || {}), ...(x.pockets || [])].reduce((b, it) => b + inItems(it), 0), 0);
    let same = true, left = false, bad = "";
    for (const [k, r] of mine(st)) {
      if (!was.has(k) || !r) continue;
      const before = Math.max(0, was.get(k)), after = totalRounds(r) + (st.physOutV && !raw.physOutV ? heldAt(st, k) - heldAt(raw, k) : 0);
      if (before !== after && !bad) { same = false; bad = `${k}: ${before} → ${after}`; }
      if (generic(r) !== 0) left = true;
    }
    check(same, `${file}: every stock of yours keeps its total${bad ? ` (${bad})` : ""}`);
    check(!left, `${file}: no generic ammo left in them`);
    check(st.ammoCal >= 1, `${file}: marked migrated`);
  }
  check(n > 0 || !files.length, `${n} corpus saves checked`);
  if (!files.length) console.log("  (no corpus saves found)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
