// Gun attachments (src/sim/gunmods.js): fitting rules (what fits which gun, one per mount, no suppressor on a revolver or
// a shotgun), gunMods sums, the odds in battle with a sight or a scope, a suppressor's noise in battle (and the
// carried oil filter kept working), hunting noise and the dead drawn, weight and value, save / load, looting a modded
// gun (an enemy's gun keeps its parts), trade prices, enemies' guns by their kit (their stats, a quieter suppressed
// shot, the tooltip name), starting guns' cheap parts, the inventory's fit / remove, the autopilot fitting from the
// armory, and the loot tables.
// Usage: node tools/gunmodtest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { createBattle, registerCombatHandler, shotOdds, enemyUnit, WEAPONS, KITS } from "../src/sim/combat.js";
import { newItem, stow, itemLoad, enemyBody, modChoices, fitModAt, unfitModAt, itemAt } from "../src/sim/inventory.js";
import { wornLoad } from "../src/sim/load.js";
import {
  ATTACH, MOUNTS, NO_MODS, gunMods, fitMod, removeMod, modFitReason, modLabel, enemyMods, ENEMY_MODS, randomStarterMods,
  STARTER_MODS, fitFromPool, wearMuzzle, unitMods, takesMods,
} from "../src/sim/gunmods.js";
import { shotNoise, STEALTH, SUPPRESSIBLE } from "../src/sim/stealth.js";
import { huntWeaponInfo, drawHordes, HUNT } from "../src/sim/hunting.js";
import { itemValue } from "../src/sim/valuation.js";
import { gearSellPrice, gearBuyPrice } from "../src/sim/trade.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { makeHorde } from "../src/sim/hordes.js";
import { GUNMOD_FINDS, AREA_GUNMODS, WARE_GUNMODS, ITEM_TAGS, SITE_TAGS, AREA_TAGS, fitsTags } from "../src/sim/loot.js";
import { Rng } from "../src/sim/rng.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const t0 = Date.now();
registerCombatHandler("gm", () => {});
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; return st; };
const gunWith = (key, ...mods) => { const g = newItem(key); for (const m of mods) fitMod(g, newItem(m)); return g; };
function baseBattle(st, { count = 2, kind = "raiders", power = 3, fighters = 1 } = {}) {
  const h = hub(st);
  const ids = atBase(st, h.id).slice(0, fighters).map((s) => s.id);
  st.combat = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: ids, enemy: { kind, count, power, name: "Test" }, ambush: "player", canRetreat: false, handler: "gm", context: {} });
  return st.combat;
}
function clearMap(b) { for (const c of b.cells) c.k = "open"; b.losCache.fill(0); b.reach.fill(1); }

// 1. The attachments and what fits.
{
  console.log("Fitting rules");
  check(Object.keys(ATTACH).every((k) => GEAR[k] && GEAR[k].cat === "gunmod" && GEAR[k].weight > 0 && GEAR[k].value > 0 && GEAR[k].desc && GEAR[k].small), "every attachment is a small gunmod item with a weight, a value and a description");
  check(Object.values(ATTACH).every((a) => MOUNTS.includes(a.mount) && a.fits.length && a.fits.every((k) => WEAPONS[k] && !WEAPONS[k].melee && WEAPONS[k].noise > 0)), "every attachment has a mount and fits only real guns (no bows, no melee)");
  const cans = Object.keys(ATTACH).filter((k) => (ATTACH[k].noise ?? 1) < 1);
  check(cans.every((k) => !ATTACH[k].fits.includes("revolver") && !ATTACH[k].fits.includes("shotgun") && !ATTACH[k].fits.includes("pipegun")), `no suppressor fits a revolver or a shotgun (${cans.join(", ")})`);
  check(!!modFitReason(newItem("revolver"), newItem("pistolcan")) && !!modFitReason(newItem("shotgun"), newItem("riflecan")) && !!modFitReason(newItem("shotgun"), newItem("suppressor")), "fitting one to a revolver or a shotgun is refused");
  check(!ATTACH.scope4x.fits.includes("huntrifle") && !ATTACH.scope4x.fits.includes("pistol") && !ATTACH.scope4x.fits.includes("shotgun"), "the 4× scope: not on the hunting rifle (scoped already), a pistol or a shotgun");
  check(["compbow", "xbow", "crossbow", "knife", "pipegun"].every((k) => !takesMods(k)), "bows, melee weapons and the pipe shotgun take nothing");
  check(SUPPRESSIBLE.every((k) => ATTACH.suppressor.fits.includes(k)) && ATTACH.suppressor.fits.length === SUPPRESSIBLE.length, "the oil filter fits exactly the guns the carried one worked on");
  const g = newItem("ar");
  const r1 = fitMod(g, newItem("reddot"));
  const r2 = fitMod(g, newItem("holo"));
  check(r1.ok && !r1.old && r2.ok && r2.old && r2.old.key === "reddot" && g.mods.optic.key === "holo", "one sight a gun: fitting a holo sight swaps the red dot out");
  fitMod(g, newItem("riflecan")); fitMod(g, newItem("foregrip")); fitMod(g, newItem("drum"));
  check(Object.keys(g.mods).sort().join() === "mag,muzzle,optic,under", "one on each mount: sight, muzzle, magazine, under the barrel");
  const laser = fitMod(g, newItem("laser"));
  check(laser.ok && laser.old.key === "foregrip" && g.mods.under.key === "laser", "a laser and a foregrip share the under-barrel mount");
  const off = removeMod(g, "mag");
  check(off && off.key === "drum" && !g.mods.mag, "removing gives the attachment back");
  check(modLabel(gunWith("pistol", "reddot", "pistolcan")) === "9mm pistol (red dot, suppressor)", `the name reads with its parts (${modLabel(gunWith("pistol", "reddot", "pistolcan"))})`);
}

// 2. gunMods sums.
{
  console.log("gunMods");
  check(gunMods(newItem("pistol")) === NO_MODS && gunMods(null) === NO_MODS && gunMods(newItem("knife")) === NO_MODS, "a bare gun, nothing or a knife: neutral");
  const m = gunMods(gunWith("pistol", "reddot", "pistolcan", "extmag", "laser"));
  check(m.aim === 5 && m.close === 6 && m.opt === -1 && Math.abs(m.dmg - 0.95) < 1e-9 && m.cap === 9 && m.capMult === 1 && Math.abs(m.noise - 0.35) < 1e-9, `9mm with red dot, can, extended mag, laser: aim ${m.aim}, close ${m.close}, opt ${m.opt}, dmg ×${m.dmg}, +${m.cap} rounds, noise ×${m.noise}`);
  const w = ["reddot", "pistolcan", "extmag", "laser"].reduce((a, k) => a + GEAR[k].weight, 0), v = ["reddot", "pistolcan", "extmag", "laser"].reduce((a, k) => a + GEAR[k].value, 0);
  check(Math.abs(m.weight - w) < 1e-9 && m.value === v, `weight +${m.weight.toFixed(2)} kg and value +${m.value} are the parts'`);
  const d = gunMods(gunWith("ar", "drum", "brake"));
  check(d.capMult === 2 && d.aim === 1 && Math.abs(d.noise - 1.3) < 1e-9, `AR with a drum and a brake: magazine ×${d.capMult}, aim ${d.aim}, noise ×${d.noise}`);
  // The magazine branch's formula: round(cap × capMult) + cap.
  const mag = (key, item) => Math.round(30 * gunMods(item).capMult) + gunMods(item).cap;
  check(mag("ar", gunWith("ar", "drum")) === 60 && Math.round(15 * gunMods(gunWith("pistol", "extmag")).capMult) + gunMods(gunWith("pistol", "extmag")).cap === 24, "magazines: a drum 30 → 60, an extended 9mm magazine 15 → 24");
  const bad = newItem("revolver"); bad.mods = { muzzle: newItem("pistolcan") }; // a save edited by hand
  check(gunMods(bad).noise === 1, "a part on a gun it does not fit counts for nothing");
}

// 3. The odds in battle.
{
  console.log("Battle odds");
  const st = world();
  const s = atBase(st, hub(st).id)[0];
  s.gear.weapon = newItem("carbine"); s.skills.shooting = 10;
  const b = baseBattle(st, { count: 1 });
  clearMap(b);
  const u = b.units.find((x) => x.side === "player"), t = b.units.find((x) => x.side === "enemy");
  u.x = 2; u.y = 6; t.x = 8; t.y = 6; t.aware = true;
  check(u.gm === NO_MODS && u.weaponName === "Police carbine", "a bare carbine: no attachments, its plain name");
  const bare = shotOdds(b, u, t).chance;
  s.gear.weapon = gunWith("carbine", "reddot");
  // A new battle with the sight on.
  const b2 = baseBattle(st, { count: 1 });
  clearMap(b2);
  const u2 = b2.units.find((x) => x.side === "player"), t2 = b2.units.find((x) => x.side === "enemy");
  u2.x = 2; u2.y = 6; t2.x = 8; t2.y = 6; t2.aware = true;
  const dot = shotOdds(b2, u2, t2).chance;
  check(dot === Math.min(95, bare + 4), `a red dot: +4 to hit at 6 tiles (${bare}% → ${dot}%)`);
  check(u2.weaponName === "Police carbine (red dot)", `the battle panel shows the gun with its parts (${u2.weaponName})`);
  // A 4× scope: better far off, worse up close.
  const far = (item) => { s.gear.weapon = item; const bb = baseBattle(st, { count: 1 }); clearMap(bb); const a = bb.units.find((x) => x.side === "player"), e = bb.units.find((x) => x.side === "enemy"); a.aim = 40; a.x = 1; a.y = 6; e.aware = true; e.x = 19; e.y = 6; const f = shotOdds(bb, a, e).chance; e.x = 3; const c = shotOdds(bb, a, e).chance; return { f, c }; };
  const plain = far(newItem("carbine")), scoped = far(gunWith("carbine", "scope4x"));
  check(scoped.f > plain.f + 10 && scoped.c === plain.c - 8, `a 4× scope: at 18 tiles ${plain.f}% → ${scoped.f}%, at 2 tiles ${plain.c}% → ${scoped.c}% (−8)`);
  const can = far(gunWith("carbine", "riflecan"));
  const o1 = (() => { s.gear.weapon = newItem("carbine"); const bb = baseBattle(st, { count: 1 }); const a = bb.units.find((x) => x.side === "player"), e = bb.units.find((x) => x.side === "enemy"); return shotOdds(bb, a, e).dmg; })();
  const o2 = (() => { s.gear.weapon = gunWith("carbine", "riflecan"); const bb = baseBattle(st, { count: 1 }); const a = bb.units.find((x) => x.side === "player"), e = bb.units.find((x) => x.side === "enemy"); return shotOdds(bb, a, e).dmg; })();
  check(can.f < plain.f && o2[1] < o1[1], `a rifle suppressor costs a little: at 18 tiles ${plain.f}% → ${can.f}%, damage ${o1.join("–")} → ${o2.join("–")}`);
}

// 4. Noise in battle: a fitted suppressor, a brake, the carried oil filter.
{
  console.log("Battle noise");
  const st = world();
  const s = atBase(st, hub(st).id)[0];
  const noiseOf = (item, carried = null) => {
    s.gear.weapon = item; s.pockets = s.pockets.map(() => null);
    if (carried) stow(s, newItem(carried));
    const b = baseBattle(st, { count: 1 });
    const u = b.units.find((x) => x.side === "player");
    return { n: shotNoise(b, u, WEAPONS[u.weapon]), u, b };
  };
  const bare = noiseOf(newItem("ar")).n;
  const can = noiseOf(gunWith("ar", "riflecan"));
  check(can.n <= bare / 2 && can.u.suppressor && can.u.supFitted, `a fitted rifle suppressor: ${bare} → ${can.n} noise a shot (half or less)`);
  const p9 = noiseOf(gunWith("pistol", "pistolcan")).n;
  check(Math.abs(p9 - GEAR.pistol.noise * 0.35) < 1e-9, `a 9mm suppressor: ${GEAR.pistol.noise} → ${p9}`);
  const brake = noiseOf(gunWith("ar", "brake")).n;
  check(brake > bare, `a muzzle brake is louder (${bare} → ${brake})`);
  const oil = noiseOf(gunWith("pistol", "suppressor"));
  const n1 = oil.n;
  check(n1 === GEAR.pistol.noise * 0.5 && oil.u.suppressor.dur === GEAR.suppressor.dur - 1, `a fitted oil filter halves it and wears a shot (${oil.u.suppressor.dur} of ${GEAR.suppressor.dur} left)`);
  oil.u.suppressor.dur = 1;
  const gun = oil.u.item;
  shotNoise(oil.b, oil.u, WEAPONS.pistol);
  check(!gun.mods && !oil.u.suppressor && unitMods(oil.u).noise === 1, "shot out, the oil filter is gone from the gun and the next shot is loud again");
  const carried = noiseOf(newItem("pistol"), "suppressor");
  check(carried.n === GEAR.pistol.noise * STEALTH.SUPPRESS && !carried.u.supFitted, "an oil filter only carried still halves a 9mm's shot (old saves)");
  const both = noiseOf(gunWith("ar", "brake"), "suppressor");
  check(!both.u.suppressor && both.n === brake, "a carried oil filter does nothing for a gun with something on its muzzle");
  // Earshot in a raid: a suppressed shot alerts a smaller circle (combat.js fire: (9 + 2 × noise) × the share).
  check((9 + 2 * 3) * (can.n / 3) < 9, `a suppressed rifle shot is heard ${((9 + 2 * 3) * (can.n / 3)).toFixed(1)} tiles off in a raid, not ${9 + 2 * 3}`);
}

// 5. Hunting.
{
  console.log("Hunting");
  const bare = huntWeaponInfo(newItem("huntrifle")), quiet = huntWeaponInfo(gunWith("huntrifle", "riflecan")), loud = huntWeaponInfo(gunWith("huntrifle", "brake"));
  check(quiet.ammo && quiet.loud && Math.abs(quiet.noise - bare.noise * 0.4) < 1e-9 && quiet.big === bare.big, `a suppressed hunting rifle still hunts with ammo, its shots ${bare.noise} → ${quiet.noise.toFixed(2)} noise (Heat × the same)`);
  check(loud.noise > bare.noise, "a brake makes a hunt louder");
  const st = world();
  const tile = hub(st).tile;
  const near = st.grid.neighbors(tile).find((n) => n !== tile);
  st.hordes = [];
  for (let i = 0; i < 20; i++) makeHorde(st, { tile: near, size: 5, role: "roam" });
  const draws = (q) => { let n = 0; for (let i = 0; i < 100; i++) { for (const h of st.hordes) { h.target = null; } n += drawHordes(st, tile, q); } return n / (100 * st.hordes.length); };
  const dLoud = draws(1), dQuiet = draws(quiet.quiet);
  check(st.hordes.length >= 10 && Math.abs(dLoud - HUNT.drawChance) < 0.03 && dQuiet < dLoud * 0.55, `the dead drawn by the shots: ${(dLoud * 100).toFixed(1)}% a horde bare, ${(dQuiet * 100).toFixed(1)}% suppressed`);
  const oil = gunWith("pistol", "suppressor");
  oil.mods.muzzle.dur = 2;
  check(!wearMuzzle(oil, 1) && oil.mods.muzzle.dur === 1 && wearMuzzle(oil, 1) && !oil.mods, "a hunt wears an oil filter a shot at a time, and it is gone when shot out");
}

// 6. Weight, value, trade.
{
  console.log("Weight, value, trade");
  const bare = newItem("ar"), modded = gunWith("ar", "holo", "drum");
  check(Math.abs(itemLoad(modded) - itemLoad(bare) - GEAR.holo.weight - GEAR.drum.weight) < 1e-9, `a gun weighs its parts too (${itemLoad(bare)} → ${itemLoad(modded).toFixed(2)} kg)`);
  check(Math.abs(itemValue(modded) - itemValue(bare) - itemValue(newItem("holo")) - itemValue(newItem("drum"))) < 1e-9, `and is worth them (${itemValue(bare)} → ${itemValue(modded)})`);
  const st = world();
  const s = atBase(st, hub(st).id)[0];
  s.gear.weapon = bare; s.pockets = s.pockets.map(() => null);
  const w0 = wornLoad(s);
  s.gear.weapon = modded;
  check(Math.abs(wornLoad(s) - w0 - GEAR.holo.weight - GEAR.drum.weight) < 1e-9, "a survivor's load counts the gun's parts");
  const f = st.factions.find((x) => x.type === "traders") || st.factions[0];
  const sb = gearSellPrice(st, f, bare, 0, { pool: [] }), sm = gearSellPrice(st, f, modded, 0, { pool: [] });
  const bb = gearBuyPrice(st, f, bare, 0, { pool: [] }), bm = gearBuyPrice(st, f, modded, 0, { pool: [] });
  check(sm > sb && bm > bb && Math.abs(sm / sb - itemValue(modded) / itemValue(bare)) < 1e-9, `a modded gun sells for more (${sb.toFixed(1)} → ${sm.toFixed(1)}) and costs more (${bb.toFixed(1)} → ${bm.toFixed(1)})`);
  check(gearSellPrice(st, f, newItem("reddot"), 0, { pool: [] }) > 0, "a loose attachment trades on its own");
}

// 7. Save and load.
{
  console.log("Save and load");
  const st = world();
  const s = atBase(st, hub(st).id)[0];
  s.gear.weapon = gunWith("pistol", "reddot", "suppressor");
  s.gear.weapon.mods.muzzle.dur = 5;
  hub(st).armory.push(gunWith("shotgun", "choke", "tubeext"));
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const s2 = back.survivors.find((x) => x.id === s.id);
  const sg = hub(back).armory.find((x) => x.key === "shotgun" && x.mods);
  check(s2.gear.weapon.mods.optic.key === "reddot" && s2.gear.weapon.mods.muzzle.dur === 5 && sg && sg.mods.muzzle.key === "choke" && sg.mods.mag.key === "tubeext", "fitted parts (and an oil filter's wear) survive a save and load");
}

// 8. Enemies' guns: by kit, their stats, quieter shots, the name, looted with the gun.
{
  console.log("Enemies' guns");
  const st = world();
  const b = baseBattle(st, { count: 1 });
  const rng = new Rng(seed);
  const tally = {};
  const units = [];
  for (const kit of Object.keys(ENEMY_MODS)) {
    tally[kit] = { n: 0, modded: 0, parts: {} };
    for (let i = 0; i < 400; i++) {
      const u = enemyUnit(b, rng, kit, 8, i);
      units.push(u);
      tally[kit].n++;
      if (u.modItems) { tally[kit].modded++; for (const m of Object.values(u.modItems)) tally[kit].parts[m.key] = (tally[kit].parts[m.key] || 0) + 1; }
    }
  }
  console.log(`    ${Object.entries(tally).map(([k, t]) => `${k} ${Math.round((t.modded / t.n) * 100)}%`).join(", ")}`);
  check(tally.soldiers.modded / tally.soldiers.n > 0.5 && tally.soldiers.parts.holo && tally.soldiers.parts.reddot && tally.soldiers.parts.scope4x && tally.soldiers.parts.riflecan, "soldiers: most guns carry a part (holo and red dot sights, scopes, suppressors)");
  const cheap = (k) => !["riflecan", "pistolcan", "drum", "holo"].includes(k);
  check(["raiders", "survivors", "zealots"].every((k) => Object.keys(tally[k].parts).every(cheap)) && tally.raiders.modded > 0, "raiders, survivors and zealots: only cheap or makeshift parts");
  check(tally.guards.parts.laser > 0 && (tally.militia.parts.scope4x || 0) > 0 && tally.soldiers.modded / tally.soldiers.n > tally.raiders.modded / tally.raiders.n, "guards carry lasers, militia scopes; soldiers far more often than raiders");
  check(units.every((u) => !u.modItems || Object.values(u.modItems).every((m) => !modFitReason({ key: u.weapon, name: u.weapon }, m))), "every part an enemy carries fits their gun");
  const u0 = units.find((u) => u.modItems && u.modItems.optic && u.modItems.optic.key === "reddot" && !u.modItems.muzzle && !u.modItems.under && !u.modItems.mag);
  check(u0 && u0.gm.aim === 4 && u0.weaponName.includes("(red dot"), `an enemy's red dot counts in their stats and their name (${u0 && u0.weaponName})`);
  if (u0) {
    clearMap(b);
    const me = b.units.find((x) => x.side === "player");
    u0.x = 2; u0.y = 6; me.x = 8; me.y = 6; b.units.push(u0);
    const withDot = shotOdds(b, u0, me).chance;
    const plain = { ...u0, gm: NO_MODS };
    check(withDot === Math.min(95, shotOdds(b, plain, me).chance + 4), `their shots with it: ${shotOdds(b, plain, me).chance}% → ${withDot}%`);
  }
  const sup = units.find((u) => u.suppressor && u.modItems && u.modItems.muzzle);
  check(sup && shotNoise(b, sup, WEAPONS[sup.weapon]) < WEAPONS[sup.weapon].noise / 2, `a suppressed enemy's shot is quieter (${sup && shotNoise(b, sup, WEAPONS[sup.weapon]).toFixed(2)} vs ${sup && WEAPONS[sup.weapon].noise}), so the alert is smaller`);
  check(units.every((u) => "ammoType" in u), "every enemy keeps a place for its loaded round (u.ammoType, for the ammo overhaul)");
  // Looted with the gun.
  const looted = units.filter((u) => u.modItems).slice(0, 30).map((u) => ({ u, keys: Object.values(u.modItems).map((m) => m.key).sort().join(), body: enemyBody(rng, u, KITS[u.kit]) }));
  check(looted.every(({ body, keys, u }) => body.gear.weapon && body.gear.weapon.key === u.weapon && Object.values(body.gear.weapon.mods || {}).map((m) => m.key).sort().join() === keys), "an enemy's body: the gun comes with every part it carried");
  const swapped = enemyUnit(b, rng, "soldiers", 8, 999);
  if (swapped.modItems) { swapped.weapon = swapped.weapon === "ar" ? "shotgun" : "ar"; }
  check(unitMods(swapped) === NO_MODS || !swapped.modItems, "a unit handed another gun later loses the old gun's parts in its odds");
  // A whole battle against soldiers runs with the parts on.
  const st3 = world(seed + 1);
  const b3 = baseBattle(st3, { count: 6, kind: "soldiers", power: 8, fighters: 3 });
  check(b3.units.some((u) => u.side === "enemy" && u.modItems), "a battle against soldiers fields guns with parts");
}

// 9. Starting guns.
{
  console.log("Starting guns");
  let guns = 0, withParts = 0, parts = 0, cheapOnly = true, fits = true;
  for (let sd = 1; sd <= 40; sd++) {
    const st = createWorld({ seed: sd, factionCount: 4 });
    for (const s of st.survivors) {
      const g = s.gear.weapon;
      if (!g || !takesMods(g.key)) continue;
      guns++;
      const list = Object.values(g.mods || {});
      if (list.length) withParts++;
      parts += list.length;
      if (list.some((m) => !STARTER_MODS.includes(m.key))) cheapOnly = false;
      if (list.some((m) => modFitReason(g, m))) fits = false;
    }
  }
  check(withParts > guns * 0.4 && withParts < guns * 0.95, `starting guns sometimes come with parts (${withParts} of ${guns} guns, ${parts} parts over 40 worlds)`);
  check(cheapOnly && fits, "only from the cheap list (never a scope, a drum or a proper suppressor), and every part fits its gun");
  const a = createWorld({ seed: 7, factionCount: 4 }), b = createWorld({ seed: 7, factionCount: 4 });
  const sig = (st) => st.survivors.map((s) => modLabel(s.gear.weapon)).join("|");
  check(sig(a) === sig(b), "the same seed gives the same parts");
  const g = newItem("pistol"), r = new Rng(3);
  const before = r.state;
  randomStarterMods(r, g, "x");
  check(r.state === before, "drawing them moves none of the run's dice");
  check(STARTER_MODS.every((k) => GEAR[k].value <= 25), "the starter list is all low-value parts");
  let hcGuns = 0, hcParts = 0, hcOk = true;
  for (let sd = 1; sd <= 40; sd++) {
    const st = createWorld({ seed: sd, factionCount: 4, mode: "hardcore" });
    for (const s of st.survivors) {
      const g = s.gear.weapon;
      if (!g || !takesMods(g.key)) continue;
      hcGuns++;
      const list = Object.values(g.mods || {});
      hcParts += list.length;
      if (list.some((m) => !STARTER_MODS.includes(m.key) || modFitReason(g, m))) hcOk = false;
    }
  }
  check(hcGuns > 0 && hcParts > 0 && hcOk, `hardcore starts too: ${hcParts} cheap parts on ${hcGuns} guns over 40 runs`);
}

// 10. The inventory: fit and remove; the autopilot.
{
  console.log("Inventory and autopilot");
  const st = world();
  const h = hub(st);
  const s = atBase(st, h.id)[0];
  s.gear.weapon = newItem("pistol");
  s.pockets = s.pockets.map(() => null);
  stow(s, newItem("reddot"));
  h.armory.push(newItem("pistolcan"), newItem("riflecan"), newItem("choke"));
  const gunLoc = `s:${s.id}:weapon`;
  const choices = modChoices(st, gunLoc, s.id).map((c) => c.item.key).sort();
  check(choices.join() === "pistolcan,reddot", `only fitting parts within reach are offered (${choices.join(", ")})`);
  const dotLoc = modChoices(st, gunLoc, s.id).find((c) => c.item.key === "reddot").loc;
  const msg = fitModAt(st, gunLoc, dotLoc);
  check(s.gear.weapon.mods.optic.key === "reddot" && !s.pockets.some((x) => x && x.key === "reddot"), `fitted from a pocket (${msg})`);
  const canLoc = modChoices(st, gunLoc, s.id).find((c) => c.item.key === "pistolcan").loc;
  fitModAt(st, gunLoc, canLoc);
  check(s.gear.weapon.mods.muzzle.key === "pistolcan" && !h.armory.some((x) => x.key === "pistolcan"), "fitted from the armory");
  check(/does not fit/.test(fitModAt(st, gunLoc, `armory:${h.id}:list:${h.armory.findIndex((x) => x.key === "choke")}`)), "a choke on a pistol is refused");
  unfitModAt(st, gunLoc, "muzzle", s.id);
  check(!s.gear.weapon.mods.muzzle && h.armory.some((x) => x.key === "pistolcan"), "removed, it goes to the armory");
  check(itemAt(st, gunLoc).mods.optic.key === "reddot", "the rest stays on");
  // The autopilot's pick from the armory.
  const pool = [newItem("reddot"), newItem("scope4x"), newItem("riflecan"), newItem("drum"), newItem("choke")];
  const ar = newItem("ar"), shotgun = newItem("shotgun");
  const done = fitFromPool(pool, [ar, null, shotgun, newItem("knife")]);
  check(done.length >= 3 && ar.mods.muzzle.key === "riflecan" && shotgun.mods.muzzle.key === "choke" && done.every((x) => !modFitReason(x.gun, x.mod)) && !pool.some((p) => done.some((x) => x.mod === p)), `the autopilot fits what helps (${done.map((x) => `${x.mod.key} on ${x.gun.key}`).join(", ")})`);
}

// 10b. The inventory screen (ui/inventory.js on stub canvases): the bar under a selected gun, the buttons, the tooltip.
{
  console.log("Inventory screen");
  const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, { get: (o, k) => (k in o ? o[k] : () => {}) });
  const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
  globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  try {
    const UI = await import("../src/ui/inventory.js");
    const st = world();
    const h = hub(st);
    const s = atBase(st, h.id)[0];
    s.gear.weapon = gunWith("pistol", "reddot");
    s.pockets = s.pockets.map(() => null);
    h.armory.push(newItem("pistolcan"), newItem("drum"));
    const ui = { inv: { sid: s.id, loot: false }, invSel: `s:${s.id}:weapon`, invMsg: "" };
    const html = UI.inventoryModal(st, ui);
    check(/data-action="inv-unmod" data-mount="optic"/.test(html) && /Fit 9mm suppressor/.test(html) && !/Fit Drum/.test(html), "a selected gun: Remove for its red dot, Fit for the suppressor in the armory, nothing that does not fit");
    const tipTxt = UI.itemTip(s.gear.weapon, s);
    check(/fitted: Red dot sight/.test(tipTxt) && /\+4 aim/.test(tipTxt), `its tooltip lists the parts and the net effect (${tipTxt.match(/fitted:[^)]*\)/)?.[0]})`);
    const loc = (/data-action="inv-fitmod" data-mod="([^"]+)"/.exec(html) || [])[1];
    UI.INV_ACTIONS["inv-fitmod"](st, ui, { mod: loc });
    check(s.gear.weapon.mods.muzzle && s.gear.weapon.mods.muzzle.key === "pistolcan" && ui.invSel === `s:${s.id}:weapon`, `Fit puts it on (${ui.invMsg})`);
    UI.INV_ACTIONS["inv-unmod"](st, ui, { mount: "optic" });
    check(!s.gear.weapon.mods.optic && h.armory.some((x) => x.key === "reddot"), `Remove takes it off into the armory (${ui.invMsg})`);
    ui.invSel = `armory:${h.id}:list:${h.armory.findIndex((x) => x.key === "reddot")}`;
    const html2 = UI.inventoryModal(st, ui);
    check(/data-action="inv-fitto" data-gun="s:\d+:weapon"/.test(html2), "a selected attachment: Fit to the gun in hand");
    UI.INV_ACTIONS["inv-fitto"](st, ui, { gun: `s:${s.id}:weapon` });
    check(s.gear.weapon.mods.optic && s.gear.weapon.mods.optic.key === "reddot", "and it fits");
  } finally { delete globalThis.document; }
}

// 11. Loot tables.
{
  console.log("Loot");
  const all = [...Object.values(GUNMOD_FINDS), ...Object.values(AREA_GUNMODS), ...Object.values(WARE_GUNMODS)].flatMap((t) => Object.keys(t.items));
  check(all.every((k) => ATTACH[k]) && Object.keys(ATTACH).every((k) => all.includes(k) || ["suppressor"].includes(k)), "every attachment can be found or bought (the oil filter is crafted and sold)");
  check(Object.keys(ATTACH).every((k) => ITEM_TAGS[k]), "every attachment has theme tags");
  check(Object.entries(GUNMOD_FINDS).every(([t, f]) => Object.keys(f.items).every((k) => fitsTags(k, SITE_TAGS[t] || []))) && Object.entries(AREA_GUNMODS).every(([a, f]) => Object.keys(f.items).every((k) => fitsTags(k, AREA_TAGS[a] || []))), "every site and raid area holds only parts that fit its theme");
  check(["gunstore", "police", "military", "lodge", "mall"].every((t) => GUNMOD_FINDS[t]), "gun stores, police stations, the Guard, hunting lodges and malls hold them");
  check(KITS.soldiers.loot.includes("reddot") && KITS.raiders.loot.includes("comp") && KITS.guards.loot.includes("laser"), "bodies may carry a loose part (soldiers, raiders, guards)");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
