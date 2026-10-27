// Normal and Hardcore told apart (issue #79, the user's requests 2026-10-27: "change how normal mode is to basically be
// what hardcore mode is right now but having a default 4 starting survivors and one vehicle but you can have up to 8
// starting survivors"; "Start like in hardcore with no hub but having tents and need to build a camp to start a base";
// "I want hardcore mode to actually be hardcore"; "do all the suggested hardcore changes except injuries are either
// permanent or not permanent just take longer to heal").
//   1. the split (sim/roadstart.js): Normal and Hardcore open on the road (no hub, tents carried, a car), Custom and
//      Crashlanding at a hub, a headless world's default as before; Normal 1–8 (4), Hardcore 1–4 (3);
//   2. Normal never meets the hard rules: every dial as set, healing, camp attacks and Heat as usual;
//   3. Hardcore's hard rules (sim/hardrules.js): the dials, slower healing (nothing permanent), the camp attack odds, the
//      Heat, raiders from the first days, the loot below a normal start, the car on fumes, the director;
//   4. the information hidden in Hardcore: threat estimates, the forecast meter;
//   5. the new-run screen and the endings: Hardcore is always Ironman, no Keep playing; the achievements by mode;
//   6. save and load keep the start.
// Usage: node tools/modesplittest.js
import { readFileSync } from "node:fs";
import { createWorld, tickHour, alive } from "../src/sim/world.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { isRoadStart, isHardcore } from "../src/sim/roadstart.js";
import { HARD, hardMult, directorMult, fogged } from "../src/sim/hardrules.js";
import { cfgOf, WORLD_CFG } from "../src/sim/worldcfg.js";
import { peopleRange, NORMAL_PEOPLE, START_PEOPLE, HUB_PEOPLE } from "../src/sim/hardcore.js";
import { hcNoRaiders } from "../src/sim/hardcore-groups.js";
import { healRatePerHour, activeHospital } from "../src/sim/medical.js";
import { tileThreatEstimate } from "../src/sim/threatknow.js";
import { threatBar } from "../src/ui/threatbar.js";
import { takeModeSet, stashModeSet } from "../src/ui/newgame.js";
import { ACH_BY_ID, achInMode, runMode } from "../src/sim/achievements.js";
import { isCustomRun } from "../src/sim/custommode.js";
import { isCrashRun } from "../src/sim/crashmode.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();
const SEED = 21;
const make = (o = {}) => createWorld({ seed: SEED, factionCount: 5, size: "small", ...o });
const normal = make({ mode: "normal", roadStart: true });
const hard = make({ mode: "hardcore", roadStart: true });

section("1. The split");
check(isRoadStart(normal) && !isHardcore(normal) && normal.start === "road", "Normal opens on the road and is not Hardcore");
check(isRoadStart(hard) && isHardcore(hard) && hard.start === "road", "Hardcore opens on the road");
check(!normal.bases.length && !hard.bases.length, "neither has a hub on day 1");
check(normal.survivors.length === 4 && NORMAL_PEOPLE.DEF === 4 && NORMAL_PEOPLE.MAX === 8, "Normal: four by default, up to eight");
check(hard.survivors.length === 3 && START_PEOPLE.MAX === 4, "Hardcore: three by default, up to four");
check(peopleRange("normal") === NORMAL_PEOPLE && peopleRange("hardcore") === START_PEOPLE && peopleRange("hub") === HUB_PEOPLE, "each screen mode its own range");
for (const n of [1, 8]) {
  const s = make({ mode: "normal", roadStart: true, startPeople: n });
  check(s.survivors.length === n && !s.bases.length, `Normal with ${n}: ${n} on the road`);
}
check(make({ mode: "normal", roadStart: true, startPeople: 12 }).survivors.length === 8, "Normal is capped at eight");
check(normal.vehicles.length === 1 && normal.vehicles[0].loc.kind === "party", "Normal: one vehicle, with the team");
const tentsIn = (s) => JSON.stringify(s.parties.map((p) => p.cargo || {})) + JSON.stringify(s.survivors.map((x) => x.inv || x.pack || x.gear || {}));
check(/tent/i.test(tentsIn(normal)), "Normal: the tents come along");
const hubW = make();
check(!isRoadStart(hubW) && hubW.start === "hub" && hubW.bases.length === 1 && hubW.survivors.length === 6, "a headless world's default is the hub start, as before");
const cust = make({ custom: { people: 5, groups: 3, hives: 3, cities: 1, towns: 4, military: 1 }, roadStart: false });
check(isCustomRun(cust) && !isRoadStart(cust) && cust.bases.length === 1, "Custom starts at a hub");
const crash = make({ crash: true, roadStart: true });
check(isCrashRun(crash) && !isRoadStart(crash), "Crashlanding is not a road start");
const hcDefault = make({ mode: "hardcore" });
check(isRoadStart(hcDefault), "a headless Hardcore world is a road start");

section("2. Normal never meets the hard rules");
check(Object.keys(WORLD_CFG).every((k) => WORLD_CFG[k].kind !== "mult" || cfgOf(normal, k) === WORLD_CFG[k].def), "Normal: every dial at its default");
check(["HEAL", "INFECT", "NOISE", "CAMP_ATTACK", "TIRED", "GRIEF", "RECRUIT"].every((k) => hardMult(normal, k) === 1), "Normal: every hard multiplier is 1");
check(directorMult(normal) === 1 && !fogged(normal, "threat") && !fogged(normal, "forecast"), "Normal: no director, no fog");

section("3. Hardcore's hard rules");
for (const [k, m] of Object.entries(HARD.DIALS)) if (!HARD.DIRECTOR.dials.includes(k)) check(Math.abs(cfgOf(hard, k) - m) < 1e-9, `Hardcore: ${k} ×${m}`);
check(cfgOf(hard, "lootAmmo") < 1 && cfgOf(hard, "lootMeds") < 1 && cfgOf(hard, "hunger") > 1 && cfgOf(hard, "wear") > 1, "less ammo and meds, more hunger and wear");
// Healing: slower, never stopped (the user: not permanent, just longer).
const healAt = (s) => {
  const st = make({ mode: s, roadStart: true });
  for (let i = 0; i < 24 * 4 && !st.bases.length; i++) tickHour(st);
  const base = st.bases[0] || hubW.bases[0];
  const who = st.survivors[0];
  who.health = 60; who.woundInfected = false;
  return base ? healRatePerHour(st, base, who, activeHospital(st, base), false) : null;
};
const hn = healRatePerHour(hubW, hubW.bases[0], Object.assign(hubW.survivors[0], { health: 60 }), activeHospital(hubW, hubW.bases[0]), false);
const hh = (() => { const st = make({ mode: "hardcore", roadStart: true }); const s = st.survivors[0]; s.health = 60; return healRatePerHour(st, hubW.bases[0], s, activeHospital(hubW, hubW.bases[0]), false); })();
check(hn > 0 && hh > 0 && Math.abs(hh / hn - HARD.HEAL) < 1e-6, `a wound heals at ${HARD.HEAL} of the usual speed in Hardcore (${hh.toFixed(3)} vs ${hn.toFixed(3)} an hour), and still heals`);
check(HARD.HEAL > 0 && HARD.HEAL < 1, "healing is slower, not stopped: nothing permanent");
check(healAt("normal") === null || healAt("normal") >= 0, "Normal's healing reads as usual");
check(!hcNoRaiders(hard) && hcNoRaiders(normal), "raiders walk from the first days in Hardcore, not in Normal");
const lootRatio = (s) => { const t = s.tiles.find((x) => x.lootNormal > 0); return t ? t.loot / t.lootNormal : null; };
check(Math.abs(lootRatio(normal) - 2) < 1e-6, "Normal's sites: twice a normal start's loot (the road start as it was)");
check(Math.abs(lootRatio(hard) - HARD.LOOT_START) < 1e-6, `Hardcore's sites: ${HARD.LOOT_START} of a normal start's loot`);
const fuelShare = (s) => { const v = s.vehicles[0]; return v ? v.fuel : null; };
check(fuelShare(hard) != null && fuelShare(normal) != null && fuelShare(hard) < fuelShare(normal), `Hardcore's car flees on fumes (${fuelShare(hard)} vs ${fuelShare(normal)})`);
const big = make({ mode: "hardcore", roadStart: true });
const dir0 = directorMult(big);
big.hour += 1;
for (let i = 0; i < 10; i++) big.survivors.push({ ...big.survivors[0], id: 1e6 + i, alive: true });
check(directorMult(big) > dir0 && directorMult(big) <= 1 + HARD.DIRECTOR.cap, `the threat grows with the group (${dir0.toFixed(2)} → ${directorMult(big).toFixed(2)})`);
check(cfgOf(big, "hordes") > cfgOf(hard, "hordes"), "the hordes grow with it");
try { for (let i = 0; i < 24 * 3; i++) { tickHour(hard); hard.cards.length = 0; } check(true, "a Hardcore run ticks three days"); } catch (e) { check(false, `a Hardcore run ticks three days: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); }
try { for (let i = 0; i < 24 * 3; i++) { tickHour(normal); normal.cards.length = 0; } check(true, "a Normal run ticks three days"); } catch (e) { check(false, `a Normal run ticks three days: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); }

section("4. The information hidden in Hardcore");
check(tileThreatEstimate(hard, hard.survivors[0] && hard.parties[0] ? hard.parties[0].tile ?? 0 : 0) === null, "no threat estimate on a tile");
check(/No forecast/.test(threatBar(hard)) && !/No forecast/.test(threatBar(normal)), "no forecast meter in Hardcore, the meter in Normal");

section("5. The screen and the endings");
const ui = { mode: "normal", ironman: false, freeEdit: true, startPeople: 4, pointsMax: 90, startVehicle: true, fleet: [], modeSets: {} };
stashModeSet(ui); takeModeSet(ui, "hardcore");
check(ui.ironman === true && ui.freeEdit === false, "choosing Hardcore ticks Ironman (and takes Customize off)");
stashModeSet(ui); takeModeSet(ui, "normal");
check(ui.ironman === false, "leaving it puts Ironman back as it was");
const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
const uiSrc = readFileSync(new URL("../src/ui/ui.js", import.meta.url), "utf8");
check(/if \(ui\.mode === "hardcore"\) \{ el\.checked = true; ui\.ironman = true; return; \}/.test(main), "main.js: the Ironman box cannot be unticked in Hardcore");
check(/keepplaying: \(\) => \{ if \(state\.victory && !isHardcore\(state\)\)/.test(main) && /isHardcore\(state\) \? `<span class="small muted"/.test(uiSrc), "no Keep playing after a Hardcore ending");
check(/roadStart: roadScreenMode\(ui\.mode\)/.test(main), "main.js: Normal and Hardcore are built as road starts");
check(runMode(hard) === "hardcore" && runMode(normal) === "normal", "the run's mode is the screen's");
check(achInMode(normal, ACH_BY_ID.road) && achInMode(hard, ACH_BY_ID.road) && !achInMode(hubW, ACH_BY_ID.road), "Life on the road: any road start");
check(achInMode(hard, ACH_BY_ID.hcyear) && !achInMode(normal, ACH_BY_ID.hcyear) && achInMode(hard, ACH_BY_ID.hcvillage), "Hardcore's own feats");

section("6. Save and load");
const back = loadFromString(saveToString(normal));
check(back.start === "road" && isRoadStart(back) && !isHardcore(back), "a Normal road start loads as one");
const old = JSON.parse(saveToString(hubW));
const backHub = loadFromString(saveToString(hubW));
check(backHub.start === "hub" && !isRoadStart(backHub) && old, "a hub start loads as one");
check(alive(back).length === alive(normal).length, "its people come back");

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
