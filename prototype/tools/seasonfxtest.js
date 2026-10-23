// Seasonal weather in play (src/sim/seasonfx.js; the user's request 2026-10-23: "in winter the ground is covered in
// snow and slows people. ice can form and has a chance to trip people. In spring it rains more often and show rain fog
// can occur to that limit visibility range and rain obscures some sounds and renders some distractions null"; and the
// same day "when night and foggy the vision is really reduced"):
//   1. snow: a winter battle's ground (seasonground.js) costs more a step, the dead's too, the AI's distances too; the
//      conditions line and the move preview say so;
//   2. ice: laid on a freezing, wet map; a step onto it slips at about SLIP (sneaking about half), the dead too, a fall
//      ends the move and the turn; the same dice give the same slips;
//   3. spring rains more often than before (the weather stream: rain or storm days by season);
//   4. fog: rain fog on some rain days (more in spring and at dawn), a battle in it is cut by wxsight.js like a fog bank; at night in
//      fog sight is below both the night and the fog alone, and a light helps, but less than in a clear night;
//   5. rain: a gunshot is heard less far, a quiet noise not at all;
//   6. a noise lure is drowned out in the rain (a flare still works), and the decoys the dead follow skip it.
// Usage: node tools/seasonfxtest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, registerCombatHandler, reachable, distField, moveAlong, alertNear, sightRange, canSeeAt } from "../src/sim/combat.js";
import * as S from "../src/sim/seasonfx.js";
import { SNOW } from "../src/sim/seasonground.js";
import * as W from "../src/sim/weather.js";
import { nightEyes, darkSight } from "../src/sim/vision.js";
import { throwAt } from "../src/sim/stealth.js";
import { stimuli } from "../src/sim/decoys.js";
import { LIGHTS } from "../src/sim/lights.js";
import { WX_SIGHT, WX_SIGHT_MIN, wxSightWord } from "../src/sim/wxsight.js";

const SEED = Number(process.argv[2] || 7);
let passes = 0, fails = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return !!ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
registerCombatHandler("sfx", () => {});
const st = createWorld({ seed: SEED, factionCount: 6 });
st.started = true;
const h = hub(st);
const people = atBase(st, h.id).slice(0, 2).map((s) => s.id);
const fight = (tile = h.tile) => createBattle(st, { tile, baseId: h.id, fighterIds: people, enemy: { kind: "zombies", count: 2, power: 3, name: "T" }, ambush: null, canRetreat: false, handler: "sfx", context: {} });
// A flat open field on the battle's own map (its weather kept): nothing in the way.
function flatten(b) {
  for (const c of b.cells) { c.k = "open"; c.f = "grass"; delete c.h; delete c.t; delete c.hp; delete c.mhp; delete c.ter; delete c.wet; delete c.wl; delete c.ice; delete c.indoor; delete c.gnd; delete c.sd; }
  b.reach.fill(1); b.losCache.fill(0); b.fires = []; b.smoke = []; b.flares = []; b.soft = undefined; delete b.climbX; b.lures = [];
  const u = b.units.find((x) => x.side === "player"), z = b.units.find((x) => x.side === "enemy");
  b.units.filter((x) => x !== u && x !== z).forEach((o, i) => { o.x = 0; o.y = b.h - 1 - i; o.off = true; });
  u.x = 5; u.y = 10; z.x = 15; z.y = 3;
  return { u, z, cell: (x, y) => b.cells[y * b.w + x] };
}
const dayOf = (key) => { for (let d = 1; d < 400; d++) if (W.seasonOfDay(d).key === key && W.seasonOfDay(d).dayOfSeason === 10) return d; return 0; };

// ---------- 1. snow ----------
section("Snow: slows everyone (seasonground.js's cost), the words are ours; a frozen step is ice's");
{
  st.hour = dayOf("winter") * 24 + 13;
  let b = null;
  for (let d = dayOf("winter"); d < dayOf("winter") + 20 && !(b && b.ground && b.ground.snow); d++) { st.hour = d * 24 + 13; b = fight(); }
  check(!!(b && b.ground && b.ground.snow > 0 && b.cells.some((c) => c.gnd === "snow")), `a winter battle has snow on the ground (b.ground ${JSON.stringify(b && b.ground)}: seasonground.js)`);
  const keep = b.cells.map((c) => ({ gnd: c.gnd, sd: c.sd }));
  const { u, z, cell } = flatten(b);
  void keep;
  const lie = (x, y, sd = 0.5) => { Object.assign(cell(x, y), { gnd: "snow", sd }); };
  lie(6, 10); lie(16, 3);
  const cost = (who, x, y) => reachable(b, who, 20).dist[y * b.w + x];
  check(Math.abs(cost(u, 6, 10) - (1 + SNOW.COST)) < 1e-6, `a step into snow: 1 + ${SNOW.COST} (moves +${Math.round(SNOW.COST * 100)}%)`);
  check(Math.abs(cost(z, 16, 3) - (1 + SNOW.COST)) < 1e-6, "the dead wade it too");
  lie(6, 10, 0.9);
  check(Math.abs(cost(u, 6, 10) - (1 + SNOW.DEEP_COST)) < 1e-6, `deep snow: 1 + ${SNOW.DEEP_COST}`);
  delete cell(6, 10).gnd;
  check(cost(u, 6, 10) === 1, "no snow on the cell: 1");
  lie(6, 10);
  b._fields = null;
  const field = distField(b, [[u.x, u.y]], u)[10 * b.w + 6];
  check(Math.abs(field - (1 + SNOW.COST)) < 1e-6, `the AI's distances count it: ${field}`);
  check(/snow \+/.test(S.pathWord(b, u, [[6, 10], [7, 10]])), `the move preview "${S.pathWord(b, u, [[6, 10], [7, 10]])}"`);
  check(S.conditions(b).some((c) => /^(Deep snow|Snow): moves \+\d+%$/.test(c.text)), `the conditions line: ${S.conditions(b).map((c) => c.text).join(" · ")}`);
  // Summer: no snow, a step is 1.
  st.hour = dayOf("summer") * 24 + 13;
  const b2 = fight();
  const f2 = flatten(b2);
  check(!(b2.ground && b2.ground.snow) && reachable(b2, f2.u, 20).dist[10 * b2.w + 6] === 1, "summer: no snow, a step is 1");
}

// ---------- 2. ice ----------
section("Ice: it forms when freezing and wet; a step onto it slips about 10%, the same dice the same slips");
{
  let found = null;
  for (let d = dayOf("winter") - 9; d < dayOf("winter") + 18 && !found; d++) {
    st.hour = d * 24 + 6;
    const b = fight();
    if (b.sfx && b.sfx.ice) found = b;
  }
  check(!!found, `a freezing winter morning lays ice (${found ? found.sfx.ice : 0} cells: frozen puddles, the road, frozen ponds)`);
  const b = found || fight();
  b.sfx = { ...(b.sfx || {}) };
  const { u, z, cell } = flatten(b);
  cell(6, 10).ice = true;
  const cost = reachable(b, u, 20).dist[10 * b.w + 6];
  check(Math.abs(cost - (1 + S.SEASONFX.ICE.COST)) < 1e-6, `a step onto ice: 1 + ${S.SEASONFX.ICE.COST}`);
  check(/Ice<\/b>: 10% to slip/.test(S.cellWord(b, cell(6, 10), u)), `the hover: "${S.cellWord(b, cell(6, 10), u).replace(/<[^>]+>/g, "")}"`);
  const trials = (who, n, x0, y0) => {
    let slips = 0;
    const seq = [];
    for (let i = 0; i < n; i++) {
      who.x = x0; who.y = y0; who.ap = 2; who.hp = who.maxHp; who.down = false; who.dead = false; delete who.slipT;
      moveAlong(b, who, [[6, 10], [7, 10]]);
      const fell = who.ap === 0;
      if (fell) slips++;
      seq.push(fell ? 1 : 0);
      if (fell && !(who.x === 6 && who.y === 10)) return { slips: -1, seq };
    }
    return { slips, seq };
  };
  const N = 3000;
  b.dseed = 12345; b.diceN = 0;
  const a = trials(u, N, 5, 10);
  check(a.slips > 0 && Math.abs(a.slips / N - S.SEASONFX.ICE.SLIP) < 0.02, `a person: ${a.slips} slips in ${N} steps onto ice (${(a.slips / N * 100).toFixed(1)}%), every fall where the ice is`);
  b.dseed = 12345; b.diceN = 0;
  const a2 = trials(u, N, 5, 10);
  check(a2.seq.join("") === a.seq.join(""), "the same battle dice: the same slips, step for step");
  u.sneaking = true;
  const c = trials(u, N, 5, 10);
  u.sneaking = false;
  check(Math.abs(c.slips / N - S.SEASONFX.ICE.SLIP * S.SEASONFX.ICE.CAREFUL) < 0.015, `sneaking (careful feet): ${(c.slips / N * 100).toFixed(1)}%`);
  z.aware = true;
  const zz = trials(z, N, 5, 10);
  check(Math.abs(zz.slips / N - S.SEASONFX.ICE.SLIP) < 0.02, `the dead slip too: ${(zz.slips / N * 100).toFixed(1)}%`);
  cell(6, 10).ice = false;
  const none = trials(u, 200, 5, 10);
  check(none.slips === 0, "dry ground: no slips");
}

// ---------- 3. spring rain ----------
section("Spring rains more often");
{
  const tally = {};
  for (let seed = 1; seed <= 40; seed++) {
    const s = { seed, hour: 0, grid: { width: 64, height: 42 }, tiles: [], bases: [] };
    for (let d = 0; d < W.YEAR_DAYS * 3; d++) {
      const r = W.regionOnDay(s, d + 1), k = W.seasonOfDay(d).key;
      const t = tally[k] || (tally[k] = { n: 0, rain: 0 });
      t.n++; if (r.key === "rain" || r.key === "storm") t.rain++;
    }
  }
  const pct = (k) => (tally[k].rain / tally[k].n) * 100;
  // Before (2026-10-23) spring had rain or a storm on 30% of days, autumn 31%, summer 21%.
  check(pct("spring") >= 33 && pct("spring") > pct("autumn") && pct("spring") > pct("summer"), `rain or storm days: spring ${pct("spring").toFixed(1)}% (30% before), autumn ${pct("autumn").toFixed(1)}%, summer ${pct("summer").toFixed(1)}%, winter ${pct("winter").toFixed(1)}%`);
}

// ---------- 4. fog ----------
section("Fog: rain fog on some rain days caps sight; night in fog is darker than either");
let fogB = null;
{
  // Rain fog: how often on a rain hour, by season and at dawn.
  const seen = { spring: [0, 0], autumn: [0, 0], dawn: [0, 0], noon: [0, 0] };
  for (let d = 2; d < W.YEAR_DAYS * 2; d++) for (const hr of [6, 13]) {
    const hour = d * 24 + hr;
    const w = W.weather(st, hour, h.tile);
    if (w.key !== "rain" && w.key !== "storm") continue;
    const f = W.rainFog(st, h.tile, hour) ? 1 : 0, k = W.seasonOfDay(d).key;
    if (seen[k]) { seen[k][0] += f; seen[k][1]++; }
    const t = hr === 6 ? seen.dawn : seen.noon;
    t[0] += f; t[1]++;
  }
  const p = (a) => (a[1] ? a[0] / a[1] : 0);
  check(p(seen.spring) > p(seen.autumn) && p(seen.dawn) > p(seen.noon) && p(seen.noon) > 0, `rain fog on rain hours: spring ${(p(seen.spring) * 100).toFixed(0)}%, autumn ${(p(seen.autumn) * 100).toFixed(0)}%; at dawn ${(p(seen.dawn) * 100).toFixed(0)}%, at noon ${(p(seen.noon) * 100).toFixed(0)}%`);
  check(W.rainFog(st, h.tile, 100) === W.rainFog(st, h.tile, 100), "the same hour, the same answer (no dice of the game's)");
  for (let d = dayOf("spring") - 9; d < W.YEAR_DAYS * 3 && !fogB; d++) for (const hr of [6, 7, 8, 12, 15]) {
    st.hour = d * 24 + hr;
    if (!W.rainFog(st, h.tile, st.hour)) continue;
    fogB = fight();
    break;
  }
  check(!!(fogB && fogB.sfx && fogB.sfx.fog && fogB.sfx.fogWhy === "Rain fog" && fogB.wxSight === WX_SIGHT.fog && fogB.wx === "rain"), `a battle in rain fog (the rain's weather, wxsight.js's cut ${fogB ? fogB.wxSight : "?"}): ${fogB ? JSON.stringify(fogB.sfx) : "none found"}`);
  const b = fogB;
  const { u } = flatten(b);
  b.night = false;
  u.face = [1, 0];
  const cut = u.sight;
  check(u.fogCut === WX_SIGHT.fog && sightRange(b, u) === cut && cut === u.daySight, `by day in rain fog everyone sees ${cut} tiles: wxsight.js's cut of ${u.fogCut}, the same code as a fog bank (${cut + u.fogCut} in the clear)`);
  check(canSeeAt(b, u, 5 + cut, 10) && !canSeeAt(b, u, 5 + cut + 2, 10), `a cell ${cut} off is seen, ${cut + 2} off is not`);
  check(b.units.filter((x) => x.side !== "player" && x.sight != null).every((x) => x.fogCut != null || x.daySight <= WX_SIGHT_MIN), "the enemy and the dead are cut the same");
  const fog = b.sfx.fog;
  check(wxSightWord(b) === `Rain fog: sight −${WX_SIGHT.fog}`, `the hover word: "${wxSightWord(b)}"`);
  check(S.conditions(b).some((c) => c.text === `Rain fog: sight ${cut}`), `the conditions line: ${S.conditions(b).map((c) => c.text).join(" · ")}`);
  // Night in fog.
  b.night = true; b.hour = 23;
  u.light = null; u.nvg = false;
  const reach = () => Math.max(...nightEyes(b, u).cones.map((c) => c.r));
  const nightFog = reach();
  delete b.sfx.fog;
  const nightOnly = reach();
  b.sfx.fog = fog;
  check(nightFog < nightOnly && nightFog < cut && nightFog === S.SEASONFX.FOG.NIGHT, `the dark ahead: ${nightFog} in night fog, below the night alone (${nightOnly}, ${darkSight(b)} at 23:00) and the fog alone (${cut})`);
  check(canSeeAt(b, u, 5 + S.SEASONFX.FOG.NIGHT, 10) && !canSeeAt(b, u, 5 + S.SEASONFX.FOG.NIGHT + 1, 10), `down the cone: ${S.SEASONFX.FOG.NIGHT} tiles seen, ${S.SEASONFX.FOG.NIGHT + 1} not`);
  u.light = "flashlight"; u.lightOff = false;
  const litFog = reach();
  delete b.sfx.fog;
  const litClear = reach();
  b.sfx.fog = fog;
  check(litFog > nightFog && litFog < litClear && Math.abs(litFog - LIGHTS.flashlight.sight * S.SEASONFX.FOG.LIGHT) < 1e-6, `a flashlight helps in night fog (${litFog} tiles), but half as much as in a clear night (${litClear})`);
  u.light = null; u.nvg = true; u.nvgOff = false;
  const nvFog = reach();
  delete b.sfx.fog;
  const nvClear = reach();
  b.sfx.fog = fog;
  check(nvFog > nightFog && nvFog < nvClear, `night vision: ${nvFog} in fog, ${nvClear} in a clear night`);
  u.nvg = false;
  const z = b.units.find((x) => x.side === "enemy");
  check(sightRange(b, z) <= S.SEASONFX.FOG.NIGHT, `the dead (no front) see ${sightRange(b, z)} in night fog`);
  check(S.conditions(b).some((c) => c.text === `Night fog: sight ${S.SEASONFX.FOG.NIGHT}`), `the conditions line at night: ${S.conditions(b).map((c) => c.text).join(" · ")}`);
  b.night = false;
}

// ---------- 5. rain: sounds ----------
section("Rain: noise carries less, a quiet one not at all");
{
  const b = fogB || fight();
  const { u, z } = flatten(b);
  b.sfx = { rain: "rain" };
  const wake = (radius, d, rain = true) => {
    b.sfx = rain ? { rain: "rain" } : { snow: 0 };
    z.aware = false; z.x = 5 + d; z.y = 3; z.pod = 99;
    alertNear(b, 5, 3, radius, "test");
    return z.aware;
  };
  const shot = 11; // a pistol's earshot, 9 + 2 × noise (combat.js)
  check(wake(shot, 8, false) && !wake(shot, 8) && wake(shot, 6), `a gunshot (${shot} tiles): heard 8 off in the dry, not in the rain (×${S.SEASONFX.HEAR.rain}: ${S.muffle(b, 5, 3, shot)}); 6 off still`);
  check(wake(4, 2, false) && !wake(4, 2), `a quiet noise (4 tiles: a scuff): heard 2 off in the dry, not at all in the rain`);
  b.sfx = { rain: "storm" };
  check(S.muffle(b, 5, 3, shot) === Math.round(shot * S.SEASONFX.HEAR.storm * 100) / 100, `a storm: ×${S.SEASONFX.HEAR.storm} (${S.muffle(b, 5, 3, shot)} tiles)`);
  b.cells[3 * b.w + 5].f = "floor";
  check(S.muffle(b, 5, 3, shot) === shot, "indoors the rain changes nothing");
  b.cells[3 * b.w + 5].f = "grass";
  b.sfx = { rain: "rain" };
  check(S.conditions(b).some((c) => c.text === "Rain: sounds carry less"), "the conditions line: Rain: sounds carry less");
  void u;
}

// ---------- 6. noise lures in the rain ----------
section("Rain: a noise lure is drowned out, a flare still works");
{
  const b = fogB || fight();
  const { u, z } = flatten(b);
  const lure = (key, rain) => {
    b.sfx = rain ? { rain: "rain" } : { snow: 0 };
    b.lures = [];
    z.aware = false; delete z.investigate; z.x = 12; z.y = 10;
    throwAt(b, u, key, 10, 10);
    return !!z.investigate;
  };
  check(lure("bottle", false), "a bottle in the dry: the dead go to look");
  check(!lure("bottle", true), "a bottle in the rain: nothing turns toward it");
  check(S.drownWhy(b, { radius: 6, sense: ["noise"] }, 10, 10) === "Rain drowns it out" && S.drownWhy(b, { radius: 10, sense: ["light", "heat"] }, 10, 10) === "", `the words: "${S.drownWhy(b, { radius: 6, sense: ["noise"] }, 10, 10)}" (a flare: none)`);
  check(!lure("noisemaker", true) && stimuli(b).length === 0, "a noise maker in the rain: drowned, and no decoy the aware dead follow");
  check(lure("flare", true) && stimuli(b).length === 1, "a road flare in the rain: its light still pulls them");
  check(lure("firecracker", true), "firecrackers carry even in the rain (13 × 0.6 tiles)");
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
process.exit(fails ? 1 : 0);
