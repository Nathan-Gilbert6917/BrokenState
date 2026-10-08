// Gun attachments (src/sim/gunmods.js): fitting rules (what fits which gun, one per mount, no suppressor on a revolver or
// a shotgun), gunMods sums, the odds in battle with a sight or a scope, a suppressor's noise in battle (and the
// carried oil filter kept working), hunting noise and the dead drawn, weight and value, save / load, looting a modded
// gun (an enemy's gun keeps its parts), trade prices, enemies' guns by their kit (their stats, a quieter suppressed
// shot, the tooltip name), starting guns' cheap parts, the inventory's fit / remove, the autopilot fitting from the
// armory, and the loot tables. The weapons overhaul (section 5): platforms and their slots, nesting (a mount carries a
// sight, a rail a grip, a light and a bipod; under and grip share the space), fit by calibre and by platform, the new
// parts' numbers (jams, a bipod braced, a sling on the move, night sights), the gun builder's sim calls (fitAt,
// stripAt, slotsOf, fitsSlot) and old saves' parts moved onto the slots.
// Usage: node tools/gunmodtest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { createBattle, registerCombatHandler, shotOdds, enemyUnit, WEAPONS, KITS } from "../src/sim/combat.js";
import { newItem, stow, itemLoad, enemyBody, modChoices, fitModAt, unfitModAt, itemAt } from "../src/sim/inventory.js";
import { wornLoad } from "../src/sim/load.js";
import {
  ATTACH, MOUNTS, NO_MODS, gunMods, fitMod, removeMod, modFitReason, modLabel, enemyMods, ENEMY_MODS, randomStarterMods,
  STARTER_MODS, fitFromPool, wearMuzzle, unitMods, takesMods, modFits, modsFor, slotsOf, fitsSlot, stripMod, migrateMods,
  baseSlots, PLATFORMS, WEAPON_PLATFORM, SLOTS, platformOf, situationalAim, fitAt, stripAt, mountFor,
} from "../src/sim/gunmods.js";
import { GUN_WEAPONS } from "../src/sim/data-guns.js";
import { shotNoise, STEALTH, SUPPRESSIBLE } from "../src/sim/stealth.js";
import { huntWeaponInfo, drawHordes, HUNT } from "../src/sim/hunting.js";
import { itemValue } from "../src/sim/valuation.js";
import { gearSellPrice, gearBuyPrice } from "../src/sim/trade.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { makeHorde } from "../src/sim/hordes.js";
import { GUNMOD_FINDS, AREA_GUNMODS, WARE_GUNMODS, SITE_MODS, AREA_MODS, WARE_MODS, ITEM_TAGS, SITE_TAGS, AREA_TAGS, fitsTags } from "../src/sim/loot.js";
import { CRAFTS } from "../src/sim/crafting.js";
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
  const fitsNone = Object.keys(ATTACH).filter((k) => !Object.keys(WEAPONS).some((w) => modFits(w, k)));
  check(Object.values(ATTACH).every((a) => SLOTS.includes(a.slot) && a.mount === a.slot) && Object.keys(WEAPONS).every((w) => !modsFor(w).length || (!WEAPONS[w].melee && WEAPONS[w].noise > 0)), "every attachment has a slot and fits only real guns (no bows, no melee)");
  check(fitsNone.every((k) => ["can22", "tacscope", "sidemount", "foldstock"].includes(k)), `every attachment fits a gun there is now (${fitsNone.join(", ") || "all"} wait for the roster's .22s, AKs and sniper rifles)`);
  const cans = Object.keys(ATTACH).filter((k) => (ATTACH[k].noise ?? 1) < 1);
  check(cans.every((k) => !modFits("revolver", k) && !modFits("pipegun", k)) && cans.filter((k) => modFits("shotgun", k)).join() === "can12", `no suppressor fits a revolver; only the rare shotgun can a shotgun (${cans.join(", ")})`);
  check(!!modFitReason(newItem("revolver"), newItem("pistolcan")) && !!modFitReason(newItem("shotgun"), newItem("riflecan")) && !!modFitReason(newItem("shotgun"), newItem("suppressor")), "fitting one to a revolver or a shotgun is refused");
  check(!modFits("huntrifle", "scope4x") && !modFits("pistol", "scope4x") && !modFits("shotgun", "scope4x"), "the 4× scope: not on the hunting rifle (scoped already), a pistol or a shotgun");
  check(["compbow", "xbow", "crossbow", "knife"].every((k) => !takesMods(k)) && modsFor("pipegun").join() === "sling", "bows and melee weapons take nothing, the pipe shotgun only a sling");
  check(SUPPRESSIBLE.every((k) => modFits(k, "suppressor")) && Object.keys(WEAPONS).filter((k) => modFits(k, "suppressor")).every((k) => SUPPRESSIBLE.includes(k)), "the oil filter fits exactly the guns the carried one worked on");
  const g = newItem("ar");
  const r1 = fitMod(g, newItem("reddot"));
  const r2 = fitMod(g, newItem("holo"));
  check(r1.ok && !r1.old && r2.ok && r2.old && r2.old.key === "reddot" && g.mods.optic.key === "holo", "one sight a gun: fitting a holo sight swaps the red dot out");
  fitMod(g, newItem("riflecan")); fitMod(g, newItem("foregrip")); fitMod(g, newItem("drum"));
  check(Object.keys(g.mods).sort().join() === "grip,mag,muzzle,optic", "one in each slot: sight, muzzle, magazine, grip");
  const laser = fitMod(g, newItem("laser"));
  check(laser.ok && !laser.old && g.mods.tactical.key === "laser" && g.mods.grip.key === "foregrip", "a laser (light / laser slot) and a foregrip (grip) both go on now");
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
  const cheap = (k) => !["riflecan", "pistolcan", "drum", "holo", "acog", "can556", "peq", "m203"].includes(k);
  check(["raiders", "survivors", "zealots"].every((k) => Object.keys(tally[k].parts).every(cheap)) && tally.raiders.modded > 0, "raiders, survivors and zealots: only cheap or makeshift parts");
  check(tally.guards.parts.laser > 0 && (tally.militia.parts.scope4x || 0) > 0 && tally.soldiers.modded / tally.soldiers.n > tally.raiders.modded / tally.raiders.n, "guards carry lasers, militia scopes; soldiers far more often than raiders");
  check(units.every((u) => !u.modItems || Object.values(u.modItems).every((m) => modFits(u.weapon, m.key))), "every part an enemy carries fits their gun");
  check(units.every((u) => !u.modItems || !u.modItems.optic || slotsOf({ key: u.weapon, name: u.weapon, mods: u.modItems }).includes("optic") && (baseSlots(u.weapon).includes("optic") || u.modItems.mount)), "a sight on a gun that needs a mount for one comes with its mount");
  const u0 = units.find((u) => u.modItems && Object.keys(u.modItems).join() === "optic" && u.modItems.optic.key === "reddot");
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
  check(sup && Math.abs(shotNoise(b, sup, WEAPONS[sup.weapon]) - WEAPONS[sup.weapon].noise * ATTACH[sup.modItems.muzzle.key].noise) < 1e-9 && ATTACH[sup.modItems.muzzle.key].noise < 0.75, `a suppressed enemy's shot is quieter (${sup && shotNoise(b, sup, WEAPONS[sup.weapon]).toFixed(2)} vs ${sup && WEAPONS[sup.weapon].noise}), so the alert is smaller`);
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

// 10b. The inventory screen (ui/inventory.js on stub canvases): the gun builder (ui/gunbuilder.js) replaced the fit /
// remove bar under a selected gun: Modify opens it; its Fit and Remove; a selected part opens it on the gun it fits; the tooltip.
{
  console.log("Inventory screen");
  const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, { get: (o, k) => (k in o ? o[k] : () => {}) });
  const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:," });
  globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  try {
    const UI = await import("../src/ui/inventory.js");
    const GB = await import("../src/ui/gunbuilder.js");
    const st = world();
    const h = hub(st);
    const s = atBase(st, h.id)[0];
    s.gear.weapon = gunWith("pistol", "reddot");
    s.pockets = s.pockets.map(() => null);
    h.armory.push(newItem("pistolcan"), newItem("drum"));
    const ui = { inv: { sid: s.id, loot: false }, invSel: `s:${s.id}:weapon`, invMsg: "" };
    const html = UI.inventoryModal(st, ui);
    check(new RegExp(`data-action="gb-open" data-loc="s:${s.id}:weapon"`).test(html), "a selected gun: Modify (the gun builder)");
    GB.GB_ACTIONS["gb-open"](st, ui, { loc: `s:${s.id}:weapon` });
    const choices = (sl) => GB.partsInReach(st, ui.gunb.loc, sl, s.id).map((c) => c.item.key);
    check(choices("muzzle").join() === "pistolcan" && !choices("mag").includes("drum"), "the builder offers the suppressor in the armory, nothing that does not fit");
    const tipTxt = UI.itemTip(s.gear.weapon, s);
    check(/fitted: Red dot sight/.test(tipTxt) && /\+4 aim/.test(tipTxt), `its tooltip lists the parts and the net effect (${tipTxt.match(/fitted:[^)]*\)/)?.[0]})`);
    const loc = GB.partsInReach(st, ui.gunb.loc, "muzzle", s.id)[0].loc;
    GB.GB_ACTIONS["gb-fit"](st, ui, { slot: "muzzle", part: loc });
    ui.invMsg = ui.gunb.msg;
    check(s.gear.weapon.mods.muzzle && s.gear.weapon.mods.muzzle.key === "pistolcan" && ui.invSel === `s:${s.id}:weapon`, `Fit puts it on (${ui.invMsg})`);
    GB.GB_ACTIONS["gb-strip"](st, ui, { slot: "optic" });
    ui.invMsg = ui.gunb.msg;
    check(!s.gear.weapon.mods.optic && h.armory.some((x) => x.key === "reddot"), `Remove takes it off into the armory (${ui.invMsg})`);
    ui.invSel = `armory:${h.id}:list:${h.armory.findIndex((x) => x.key === "reddot")}`;
    const html2 = UI.inventoryModal(st, ui);
    check(/data-action="gb-open" data-loc="s:\d+:weapon" data-slot="optic"/.test(html2), "a selected attachment: the gun builder on the gun in hand, at its slot");
    UI.INV_ACTIONS["inv-fitto"](st, ui, { gun: `s:${s.id}:weapon` });
    check(s.gear.weapon.mods.optic && s.gear.weapon.mods.optic.key === "reddot", "and it fits");
  } finally { delete globalThis.document; }
}

// 11. Loot tables.
{
  console.log("Loot");
  const all = [...Object.values(GUNMOD_FINDS), ...Object.values(AREA_GUNMODS), ...Object.values(WARE_GUNMODS), ...Object.values(SITE_MODS), ...Object.values(AREA_MODS), ...Object.values(WARE_MODS)].flatMap((t) => Object.keys(t.items));
  const crafted = Object.values(CRAFTS).map((r) => r.gear);
  check(all.every((k) => ATTACH[k] || ["repairkit", "kevlarkit"].includes(k)) && Object.keys(ATTACH).every((k) => all.includes(k) || crafted.includes(k)), `every attachment can be found, bought or crafted (${Object.keys(ATTACH).filter((k) => !all.includes(k) && !crafted.includes(k)).join(", ") || "all"})`);
  check(["bottlecan", "solventcan", "scrapscope", "recoilpad", "sling"].every((k) => crafted.includes(k)), "the makeshift ones are crafted: a bottle can, a solvent trap, a scrap scope, a recoil pad, a sling");
  check(Object.keys(ATTACH).every((k) => ITEM_TAGS[k]), "every attachment has theme tags");
  check(Object.entries(GUNMOD_FINDS).every(([t, f]) => Object.keys(f.items).every((k) => fitsTags(k, SITE_TAGS[t] || []))) && Object.entries(AREA_GUNMODS).every(([a, f]) => Object.keys(f.items).every((k) => fitsTags(k, AREA_TAGS[a] || []))), "every site and raid area holds only parts that fit its theme");
  check(["gunstore", "police", "military", "lodge", "mall"].every((t) => GUNMOD_FINDS[t]), "gun stores, police stations, the Guard, hunting lodges and malls hold them");
  check(KITS.soldiers.loot.includes("reddot") && KITS.raiders.loot.includes("comp") && KITS.guards.loot.includes("laser"), "bodies may carry a loose part (soldiers, raiders, guards)");
}

// 12. Platforms and slots (data-gunmods.js).
{
  console.log("Platforms");
  const guns = Object.keys(WEAPONS).filter((k) => GEAR[k] && !WEAPONS[k].melee && WEAPONS[k].noise > 0 && !WEAPONS[k].arrows && !WEAPONS[k].launcher); // (the M203: a launcher's data, and as an item a gun part)
  check(guns.every((k) => platformOf(k) && PLATFORMS[platformOf(k)]), `every gun has a platform (${guns.filter((k) => !platformOf(k)).join(", ") || "all"})`);
  check(Object.values(PLATFORMS).every((P) => P.slots.every((x) => SLOTS.includes(x))) && Object.values(WEAPON_PLATFORM).every((p) => PLATFORMS[p]), "every platform's slots are real slots, every weapon's platform is real");
  check(["under", "grip", "rail", "optic", "muzzle"].every((x) => baseSlots("ar").includes(x)), `the AR-15: room under the handguard for a grip or a launcher (${baseSlots("ar").join(", ")})`);
  check(!baseSlots("huntrifle").includes("optic") && !modFits("huntrifle", "acog") && modFits("huntrifle", "bipod") && modFits("huntrifle", "riflecan"), "the hunting rifle's scope is its own (no sight slot), but it takes a bipod and a suppressor");
  check(!baseSlots("leverrifle").includes("optic") && slotsOf({ key: "leverrifle", name: "L", mods: { mount: newItem("scopemount") } }).includes("optic"), "the lever-action needs a scope mount for a sight");
  // A built-in bipod (the light machine gun's, the .50's): in its numbers, never fitted.
  GEAR.testlmg = { ...GEAR.ar, name: "Test LMG" }; WEAPON_PLATFORM.testlmg = "m249"; GUN_WEAPONS.testlmg = { cal: "556" };
  const lmg = newItem("testlmg");
  check(gunMods(lmg).brace === 8 && !slotsOf(lmg).includes("bipod") && !!fitsSlot(lmg, newItem("bipod")), "a light machine gun's bipod is built in: +8 braced, no bipod slot");
  delete GEAR.testlmg; delete WEAPON_PLATFORM.testlmg; delete GUN_WEAPONS.testlmg;
}

// 13. Nesting: mounts and rails open slots; under and grip share the space.
{
  console.log("Nesting");
  const lever = newItem("leverrifle");
  check(/scope mount first/.test(fitsSlot(lever, newItem("reddot"))), `a red dot on a bare lever-action: "${fitsSlot(lever, newItem("reddot"))}"`);
  check(fitMod(lever, newItem("scopemount")).ok && fitMod(lever, newItem("reddot")).ok && lever.mods.optic.key === "reddot", "with a scope mount on, the sight fits");
  const swap = fitMod(lever, newItem("scopemount"));
  check(swap.ok && swap.old.key === "scopemount" && lever.mods.optic && swap.off.length === 1, "swapping the mount for another keeps the sight on it");
  const off = stripMod(lever, "mount");
  check(off.map((m) => m.key).join() === "reddot,scopemount" && !lever.mods, "stripping the mount takes the sight off first");
  // A rail on a Kalashnikov (a stand-in weapon on the ak platform until the roster's AK lands).
  GEAR.testak = { ...GEAR.ar, name: "Test AK" }; WEAPON_PLATFORM.testak = "ak"; GUN_WEAPONS.testak = { cal: "762x39" };
  const ak = newItem("testak");
  check(!!fitsSlot(ak, newItem("foregrip")) && /rail/.test(fitsSlot(ak, newItem("foregrip"))), `no grip on a bare AK: "${fitsSlot(ak, newItem("foregrip"))}"`);
  fitMod(ak, newItem("quadrail"));
  check(slotsOf(ak).includes("grip") && slotsOf(ak).includes("tactical") && slotsOf(ak).includes("bipod"), `a quad rail adds a grip, a light / laser and a bipod (${slotsOf(ak).join(", ")})`);
  check(fitMod(ak, newItem("foregrip")).ok && fitMod(ak, newItem("weaponlight")).ok && fitMod(ak, newItem("bipod")).ok, "and they fit");
  check(!!fitsSlot(ak, newItem("reddot")) && fitMod(ak, newItem("sidemount")).ok && fitMod(ak, newItem("acog")).ok, "a sight on an AK needs its side mount (an ACOG then fits)");
  check(modFits("testak", "can308") && !modFits("testak", "can556") && modFits("testak", "riflecan"), "suppressors by calibre: a 7.62×39 AK takes the .308 can, not the 5.56 one");
  const strip = stripMod(ak, "rail");
  check(strip.length === 4 && strip[strip.length - 1].key === "quadrail" && !ak.mods.grip && !ak.mods.tactical && !ak.mods.bipod && ak.mods.optic, `the rail comes off with what it carried, children first (${strip.map((m) => m.key).join(", ")})`);
  delete GEAR.testak; delete WEAPON_PLATFORM.testak; delete GUN_WEAPONS.testak;
  // Under and grip: one or the other on an AR.
  const ar = newItem("ar");
  fitMod(ar, newItem("foregrip"));
  check(/share it/.test(fitsSlot(ar, newItem("m203"))), `a launcher and a foregrip share the space under an AR's handguard ("${fitsSlot(ar, newItem("m203"))}")`);
  removeMod(ar, "grip");
  check(fitMod(ar, newItem("m203")).ok && !!fitsSlot(ar, newItem("anglegrip")), "the launcher fits once the grip is off, and then no grip does");
  check(gunMods(ar).launcher === "40mm", "a fitted M203 is a 40 mm launcher (section 13)");
}

// 14. Fit rules: muzzle devices by calibre, the rest by platform.
{
  console.log("Fit rules");
  check(modFits("pistol", "pistolcan") && modFits("pistol", "can9") && !modFits("revolver", "can9") && !modFits("revolver", "bottlecan") && modFits("revolver", "comp"), "a 9mm takes 9mm cans; a revolver no can at all (a compensator, yes)");
  check(modFits("ar", "can556") && modFits("carbine", "can556") && !modFits("huntrifle", "can556") && modFits("huntrifle", "can308") && !modFits("ar", "can308"), "rifle cans by calibre: 5.56 on the AR and carbine, .308 on the hunting rifle");
  check(modFits("shotgun", "choke") && modFits("shotgun", "can12") && !modFits("shotgun", "bottlecan") && modFits("pistol", "bottlecan"), "12 gauge: a choke and the shotgun can, never a bottle");
  check(modFits("pistol", "tritium") && !modFits("ar", "tritium") && modFits("ar", "acog") && !modFits("pistol", "acog") && modFits("revolver", "revgrip") && !modFits("ar", "revgrip"), "sights and grips by platform: tritium on pistols, an ACOG on the AR, rubber grips on a revolver");
  check(modFits("shotgun", "recoilpad") && modFits("huntrifle", "recoilpad") && !modFits("pistol", "recoilpad") && modFits("ar", "collapsible") && !modFits("shotgun", "collapsible"), "stocks by platform: a recoil pad on a shotgun or a bolt gun, a collapsible stock on the AR");
  check(["sling", "weaponlight", "laser"].every((k) => modFits("ar", k)) && modFits("pistol", "weaponlight") && !modFits("pistol", "sling"), "the any-gun parts need the slot: a pistol takes a light, not a sling");
}

// 15. The new numbers in gunMods.
{
  console.log("New parts' numbers");
  const m = gunMods(gunWith("ar", "can556", "sling", "bipod"));
  check(Math.abs(m.jam - 1.3) < 1e-9 && m.aim === 1 && m.moving === 1 && m.brace === 8 && Math.abs(m.noise - 0.55) < 1e-9, `an AR with a 5.56 can, a sling and a bipod: jams ×${m.jam}, aim +${m.aim}, +${m.brace} braced, +${m.moving} on the move, noise ×${m.noise}`);
  check(gunMods(gunWith("pistol", "tritium")).night === 6 && gunMods(gunWith("pistol", "weaponlight")).nightNear === 8 && gunMods(gunWith("pistol", "weaponlight")).light, "tritium +6 at night, a weapon light +8 at night within 6 tiles (and a light)");
  check(gunMods(gunWith("shotgun", "recoilpad")).aim === 3 && gunMods(gunWith("huntrifle", "recoilpad")).aim === 2, "a recoil pad: +3 on a shotgun, +2 on a rifle");
  const ml = newItem("ar"); fitMod(ml, newItem("mlok"));
  check(Math.abs(itemLoad(ml) - itemLoad(newItem("ar")) + 0.2) < 1e-9 && gunMods(ml).weight === -0.2, `an M-LOK handguard makes the gun lighter (${(itemLoad(ml) - itemLoad(newItem("ar"))).toFixed(2)} kg)`);
  // In battle: braced, on the move, at night.
  const st = world();
  const s = atBase(st, hub(st).id)[0];
  s.gear.weapon = gunWith("ar", "bipod", "sling");
  const b = baseBattle(st, { count: 1 });
  clearMap(b);
  const u = b.units.find((x) => x.side === "player"), t = b.units.find((x) => x.side === "enemy");
  u.x = 2; u.y = 6; t.x = 10; t.y = 6; t.aware = true; u.aim = 30;
  u.movedT = b.turn - 1;
  const still = shotOdds(b, u, t).chance;
  u.movedT = b.turn;
  const moved = shotOdds(b, u, t).chance;
  check(still - moved === 7 && situationalAim(b, u, 8) === 1, `a bipod braced: +8, on the move only the sling's +1 (${moved}% → ${still}%)`);
  s.gear.weapon = gunWith("pistol", "tritium", "weaponlight");
  const b2 = baseBattle(st, { count: 1 });
  clearMap(b2);
  const u2 = b2.units.find((x) => x.side === "player"), t2 = b2.units.find((x) => x.side === "enemy");
  u2.x = 2; u2.y = 6; t2.x = 6; t2.y = 6; t2.aware = true; u2.aim = 30;
  const day = shotOdds(b2, u2, t2).chance;
  b2.night = true;
  check(shotOdds(b2, u2, t2).chance - day === 14, `at night a tritium sight and a weapon light within 6 tiles: +14 (${day}% → ${shotOdds(b2, u2, t2).chance}%)`);
}

// 16. Old saves: the four mounts onto the slots.
{
  console.log("Old saves");
  const old = { key: "ar", name: "Assault rifle", quality: 1, mods: { under: newItem("laser"), optic: newItem("reddot") } };
  const before = gunMods(JSON.parse(JSON.stringify(old)));
  migrateMods(old);
  check(old.mods.tactical && old.mods.tactical.key === "laser" && !old.mods.under && old.mods.optic.key === "reddot", "a laser under the barrel moves to the light / laser slot");
  check(gunMods(old).aim === before.aim && gunMods(old).close === before.close, `the gun's numbers are unchanged (aim +${gunMods(old).aim}, +${gunMods(old).close} up close)`);
  const g2 = { key: "carbine", name: "Police carbine", quality: 1, mods: { under: newItem("foregrip") } };
  const g3 = { key: "huntrifle", name: "Hunting rifle", quality: 1, mods: { under: newItem("bipod") } };
  const g4 = { key: "leverrifle", name: "Lever-action rifle", quality: 1, mods: { optic: newItem("scope4x"), under: newItem("bipod") } };
  const g5 = { key: "revolver", name: ".357 revolver", quality: 1, mods: { optic: newItem("reddot"), under: newItem("laser") } };
  for (const g of [g2, g3, g4, g5]) migrateMods(g);
  check(g2.mods.grip.key === "foregrip" && g3.mods.bipod.key === "bipod" && !g2.mods.under && !g3.mods.under, "a foregrip moves to the grip slot, a bipod to the bipod slot");
  check(g4.mods.mount && g4.mods.mount.key === "scopemount" && g4.mods.optic.key === "scope4x" && g4.mods.bipod, "a lever-action's scope gets the mount it needs now");
  check(g5.mods.mount && g5.mods.optic.key === "reddot" && g5.mods.tactical.key === "laser", "so does a revolver's red dot (its laser: a laser grip)");
  check([old, g2, g3, g4, g5].every((g) => Object.values(g.mods).every((m) => !fitsSlot(g, m))), "every migrated part sits where it would fit now");
  migrateMods(g4);
  check(Object.keys(g4.mods).length === 3, "migrating twice changes nothing");
  // A whole save from before the slots (state.gunSlots missing): loaded, its guns are moved over.
  const st = world();
  const s = atBase(st, hub(st).id)[0];
  s.gear.weapon = { key: "shotgun", name: "Pump shotgun", quality: 1, mods: { under: newItem("laser"), optic: newItem("holo") } };
  hub(st).armory.push({ key: "ar", name: "Assault rifle", quality: 1, mods: { under: newItem("bipod") } });
  delete st.gunSlots;
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const w = back.survivors.find((x) => x.id === s.id).gear.weapon;
  const a = hub(back).armory.find((x) => x.key === "ar" && x.mods);
  check(back.gunSlots === 1 && w.mods.tactical.key === "laser" && w.mods.mount && w.mods.optic.key === "holo" && a.mods.bipod.key === "bipod" && !a.mods.under, "an old save loads with its guns' parts on the slots (a pump's holo sight on its new mount)");
}

// 17. The gun builder's sim calls (fitAt, stripAt on inventory locations).
{
  console.log("Gun builder calls");
  const st = world();
  const h = hub(st);
  const s = atBase(st, h.id)[0];
  s.gear.weapon = newItem("leverrifle");
  h.armory.push(newItem("scopemount"), newItem("scope4x"), newItem("pistolcan"));
  const gl = `s:${s.id}:weapon`;
  const at = (k) => `armory:${h.id}:list:${h.armory.findIndex((x) => x.key === k)}`;
  check(/scope mount first/.test(fitAt(st, gl, "optic", at("scope4x"))), "fitAt refuses a sight with no mount");
  check(/not the/.test(fitAt(st, gl, "muzzle", at("scope4x"))), "and a part in the wrong slot");
  fitAt(st, gl, "mount", at("scopemount"));
  fitAt(st, gl, "optic", at("scope4x"));
  check(s.gear.weapon.mods.mount && s.gear.weapon.mods.optic.key === "scope4x" && !h.armory.some((x) => x.key === "scope4x" || x.key === "scopemount"), "fitAt moves the parts from the armory onto the gun");
  check(/does not fit/.test(fitAt(st, gl, "muzzle", at("pistolcan"))), "a 9mm can on a .30-30 is refused");
  const msg = stripAt(st, gl, "mount");
  check(!s.gear.weapon.mods && h.armory.some((x) => x.key === "scope4x") && h.armory.some((x) => x.key === "scopemount"), `stripAt takes the mount and its sight back to the armory (${msg})`);
  check(slotsOf(s.gear.weapon).join() === baseSlots("leverrifle").join() && mountFor("leverrifle", "optic") === "scopemount", "slotsOf a bare gun is its base slots");
  const lv = newItem("leverrifle");
  check(fitsSlot(lv, "mount", newItem("scopemount")) === "" && /scope mount first/.test(fitsSlot(lv, "optic", newItem("reddot"))) && fitsSlot(lv, newItem("scopemount")) === "", "fitsSlot takes (gun, slot, part) as well as (gun, part)");
}

console.log(`\n${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fail ? 1 : 0);
