// The weather in a battle (src/sim/wxsight.js, src/ui/battlewx.js; the user's request 2026-10-23: "Add rain and fog
// effect during raid … when it is foggy or raining in the world map that is when it is foggy or raining in a raid. Fog
// reduces visibility on the world map too"):
//   1. the battle's weather is the State Map's over its tile (weatherAt, kept as b.wx); in fog every unit on every side
//      (yours, raiders, the dead) sees WX_SIGHT.fog tiles less by day, in a fight in the open and in a raid; in clear
//      weather nobody's sight changes; the battle log says so; the same seed, the same weather and sight;
//   2. someone who comes onto the map later (stealthTurn) is cut too, once; the night's cap stays on top;
//   3. the overlay picks rain (a storm heavier), fog, snow or nothing by the weather; draws bounded particles, paints
//      its fog puff once, nothing at Off, fewer at Light; and in the battle view (drawCombat on stub canvases) it draws
//      the fog over a foggy fight with no error.
// Usage: node tools/battlewxtest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, registerCombatHandler, sightRange } from "../src/sim/combat.js";
import { stealthTurn } from "../src/sim/stealth.js";
import { weatherAt } from "../src/sim/weather.js";
import { WX_SIGHT, WX_SIGHT_MIN, wxSightWord, fogEyes } from "../src/sim/wxsight.js";
import * as WX from "../src/ui/battlewx.js";

const SEED = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
registerCombatHandler("bwx", () => {});
const world = () => { const st = createWorld({ seed: SEED, factionCount: 6 }); st.started = true; st.hour = 24 * 3 + 12; return st; };

// The first daytime hour (08:00–16:00) and land tile with this weather.
function findWx(st, key, days = 120) {
  const land = st.tiles.filter((t) => t.terrain !== "water" && t.terrain !== "lake");
  for (let d = 2; d < days; d++) for (const hr of [10, 12, 14]) {
    st.hour = d * 24 + hr;
    for (const t of land) if (weatherAt(st, t.id).key === key) return { tile: t.id, hour: st.hour };
  }
  return null;
}
const fight = (st, tile, kind = "raiders") => {
  const h = hub(st), ids = atBase(st, h.id).slice(0, 3).map((s) => s.id);
  return createBattle(st, { tile, baseId: h.id, fighterIds: ids, enemy: { kind, count: 3, power: 3, name: "T" }, ambush: null, canRetreat: false, handler: "bwx", context: {} });
};
const raid = (st, tile) => {
  const h = hub(st), ids = atBase(st, h.id).slice(0, 3).map((s) => s.id);
  return createBattle(st, { mode: "raid", tile, baseId: h.id, fighterIds: ids, canRetreat: true, ambush: null, handler: "bwx", enemy: { kind: "mixed", count: 0, power: 3, groups: [{ kind: "raiders", count: 2, power: 3 }, { kind: "zombies", count: 2, power: 3 }] }, raid: { heat0: 0 }, context: {} });
};
const sides = (b) => new Set(b.units.map((u) => u.side));

// ---------- 1. fog cuts everyone's sight; clear does not ----------
console.log("Fog cuts sight for every side; clear weather does not");
const st = world();
const fogAt = findWx(st, "fog"), clearAt = findWx(st, "clear"), rainAt = findWx(st, "rain");
check(fogAt && clearAt && rainAt, `found fog (${fogAt && `tile ${fogAt.tile} hour ${fogAt.hour}`}), clear and rain by day on seed ${SEED}`);
const at = (w) => { st.hour = w.hour; return w.tile; };
{
  const tile = at(clearAt);
  const bc = fight(st, tile);
  check(bc.wx === "clear" && !bc.wxSight && bc.units.every((u) => u.fogCut == null), "a clear day: b.wx clear, no cut, nobody's sight touched");
  const day = new Map(bc.units.filter((u) => u.side === "player").map((u) => [u.sid, u.daySight]));
  st.combat = null;
  const ft = at(fogAt);
  const bf = fight(st, ft, "raiders");
  check(bf.wx === "fog" && bf.wxSight === WX_SIGHT.fog, `fog over the tile: b.wx fog, sight −${WX_SIGHT.fog}`);
  const mine = bf.units.filter((u) => u.side === "player"), theirs = bf.units.filter((u) => u.side === "enemy");
  check(mine.length && theirs.length && bf.units.every((u) => u.fogCut === WX_SIGHT.fog), `every unit cut by ${WX_SIGHT.fog} (${mine.length} yours, ${theirs.length} theirs)`);
  check(mine.every((u) => day.has(u.sid) && u.daySight === day.get(u.sid) - WX_SIGHT.fog), `your people's day sight ${[...day.values()].join("/")} → ${mine.map((u) => u.daySight).join("/")}`);
  check(bf.units.every((u) => u.sight <= u.daySight) && mine.every((u) => sightRange(bf, u) <= u.daySight + 6), "their sight now no more than the cut day sight (the night's cap on top)");
  check(bf.log.some((l) => l.text.includes(wxSightWord(bf))) && wxSightWord(bf) === `Fog: sight −${WX_SIGHT.fog}`, `the battle log says "${wxSightWord(bf)}"`);
  // The dead too.
  st.combat = null;
  const bz = fight(st, ft, "zombies");
  const dead = bz.units.filter((u) => u.side === "enemy");
  check(dead.length && dead.every((u) => u.fogCut === WX_SIGHT.fog && u.daySight === 9 - WX_SIGHT.fog), `the dead see ${9 - WX_SIGHT.fog} instead of 9`);
  // A raid in the fog: both sides.
  st.combat = null;
  const br = raid(st, ft);
  const rs = sides(br);
  check(br.wx === "fog" && rs.has("player") && rs.has("enemy") && br.units.every((u) => u.fogCut > 0), `a raid in the fog: every unit cut (${[...rs].join(", ")}; ${br.units.length} units)`);
  // Rain: no cut to sight.
  st.combat = null;
  const rb = fight(st, at(rainAt));
  check(rb.wx === "rain" && !rb.wxSight && rb.units.every((u) => u.fogCut == null), "rain: no cut to sight (the overlay only)");
  // The same seed, the same weather and sight.
  const st2 = world();
  st2.hour = fogAt.hour;
  const bf2 = fight(st2, fogAt.tile, "raiders");
  check(bf2.wx === "fog" && bf2.units.map((u) => u.daySight).join() === bf.units.map((u) => u.daySight).join(), "the same seed and hour: the same fog and the same sight");
}

// ---------- 2. newcomers, once; the floor ----------
console.log("Newcomers and the floor");
{
  st.combat = null;
  const b = fight(st, at(fogAt), "zombies");
  const z = { ...b.units.find((u) => u.side === "enemy"), id: 9999, sight: 9, daySight: undefined, fogCut: undefined, nightEyes: false };
  b.units.push(z);
  stealthTurn(b);
  check(z.fogCut === WX_SIGHT.fog && z.daySight === 9 - WX_SIGHT.fog && z.sight <= z.daySight, `one of the dead walking in later is cut at the turn (${z.daySight})`);
  const before = b.units.map((u) => u.daySight).join();
  stealthTurn(b); fogEyes(b, z);
  check(b.units.map((u) => u.daySight).join() === before, "only once: another turn changes nobody's day sight");
  const weak = { sight: 5 };
  fogEyes(b, weak);
  check(weak.daySight === WX_SIGHT_MIN && weak.fogCut === 5 - WX_SIGHT_MIN, `never below ${WX_SIGHT_MIN} (5 → ${weak.daySight}, cut ${weak.fogCut})`);
}

// ---------- 3. the overlay ----------
console.log("The overlay");
{
  // A recording context: counts what is drawn.
  const rec = () => {
    const n = { stroke: 0, line: 0, fillRect: 0, drawImage: 0, ellipse: 0 };
    const grad = () => ({ addColorStop() {} });
    const ctx = {
      n, globalAlpha: 1, fillStyle: "", strokeStyle: "", lineWidth: 1,
      save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() { n.line++; }, stroke() { n.stroke++; }, ellipse() { n.ellipse++; },
      fillRect() { n.fillRect++; }, drawImage() { n.drawImage++; }, createRadialGradient: grad,
    };
    return ctx;
  };
  WX.setWxCanvas((w, h) => ({ width: w, height: h, getContext: () => rec() }));
  const fake = (wx, o = {}) => ({ wx, w: 30, h: 20, tileId: null, units: [], ...o });
  const kinds = ["rain", "storm", "fog", "snow", "blizzard", "clear", "overcast", "frost", "heat"].map((k) => [k, WX.wxFxFor(null, fake(k)).kind]);
  check(kinds.map(([k, v]) => `${k}:${v}`).join() === "rain:rain,storm:rain,fog:fog,snow:snow,blizzard:snow,clear:null,overcast:null,frost:null,heat:null", `picks by the weather: ${kinds.map(([k, v]) => `${k}→${v}`).join(", ")}`);
  WX.setWxLevel("full", false);
  const draw = (b, now = 5000, cw = 1600, ch = 900) => { const ctx = rec(); const k = WX.drawBattleWx(ctx, cw, ch, null, b, now); return { k, n: ctx.n, s: { ...WX.wxStats } }; };
  const r = draw(fake("rain")), s = draw(fake("storm"));
  check(r.k === "rain" && r.n.line > 50 && r.n.stroke >= 2 && r.n.drawImage === 0, `rain: ${r.s.drops} streaks in ${r.n.stroke} strokes, ${r.s.splashes} splashes, no fog banks`);
  check(s.s.drops > r.s.drops, `a storm heavier (${s.s.drops} streaks against ${r.s.drops})`);
  const f1 = draw(fake("fog")), puffs = WX.wxStats.puffs, f2 = draw(fake("fog"), 9000);
  check(f1.k === "fog" && f1.n.drawImage === WX.WX_FX.BANKS && f1.n.line === 0, `fog: ${f1.n.drawImage} banks, no streaks`);
  check(puffs === 1 && WX.wxStats.puffs === 1 && f2.n.drawImage === f1.n.drawImage, "the fog's puff painted once, not again the next frame");
  const nf = draw(fake("fog", { night: true }));
  check(WX.wxStats.puffs === 2 && nf.n.drawImage === f1.n.drawImage, "by night the fog in the night's colour (a new puff)");
  const sn = draw(fake("snow")), bz = draw(fake("blizzard"));
  check(sn.k === "snow" && sn.n.fillRect >= sn.s.flakes && bz.s.flakes > sn.s.flakes && bz.n.drawImage > 0, `snow: ${sn.s.flakes} flakes; a blizzard ${bz.s.flakes} in a fog (${bz.n.drawImage} banks)`);
  check(draw(fake("clear")).k === "" && draw(fake("overcast")).n.fillRect === 0, "clear or overcast: nothing drawn");
  const big = draw(fake("storm"), 1e9, 3840, 2160);
  check(big.s.drops <= 512 && big.n.line <= 512, `bounded at any size and time (${big.s.drops} streaks on a 4K screen)`);
  WX.setWxLevel("low");
  const lo = draw(fake("rain")), lf = draw(fake("fog"));
  check(lo.s.drops < r.s.drops && lo.s.splashes === 0 && lf.n.drawImage < f1.n.drawImage, `Light: ${lo.s.drops} streaks, no splashes, ${lf.n.drawImage} fog banks`);
  WX.setWxLevel("off");
  check(draw(fake("rain")).k === "" && draw(fake("fog")).n.fillRect === 0, "Off: nothing drawn");
  WX.setWxLevel("full", true);
  const c1 = rec(), c2 = rec();
  WX.drawBattleWx(c1, 1600, 900, null, fake("rain"), 1000); WX.drawBattleWx(c2, 1600, 900, null, fake("rain"), 7000);
  check(c1.n.line === c2.n.line, "Reduce motion: held still");
  WX.setWxLevel("full", false);

  // The battle view: a foggy fight drawn through ui/combat.js and ui/isoview.js on stub canvases.
  const ISO = await import("../src/ui/isoview.js");
  const UI = await import("../src/ui/combat.js");
  let nan = 0;
  const silent = (cv) => new Proxy({ globalAlpha: 1, createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }), putImageData: (img) => { cv.img = img; }, measureText: (t) => ({ width: String(t).length * 6 }) }, {
    get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; }),
    set: (o, k, v) => { if (typeof v === "number" && !Number.isFinite(v)) nan++; o[k] = v; return true; },
  });
  const cvs = (w, h) => { const cv = { width: w, height: h, toDataURL: () => "data:," }; const g = silent(cv); cv.getContext = () => g; return cv; };
  globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
  globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
  ISO.setIsoCanvas(cvs);
  UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent({}) });
  st.combat = null;
  st.hour = fogAt.hour;
  const b = raid(st, fogAt.tile);
  st.combat = b;
  const f0 = WX.wxStats.frames;
  let err = "";
  try { UI.drawCombat(st, 1e6); UI.drawCombat(st, 1e6 + 40); } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" "); }
  check(!err && !nan && WX.wxStats.frames === f0 + 2 && WX.wxStats.kind === "fog", `a raid in the fog drawn twice with the fog over it, no error or NaN${err ? ` (${err})` : ""} (frames ${WX.wxStats.frames - f0}, ${WX.wxStats.kind}, NaN ${nan})`);
  // The hover card over one of your people says it.
  st.combat = null;
  const bf = fight(st, fogAt.tile, "raiders");
  st.combat = bf;
  const me = bf.units.find((u) => u.side === "player");
  UI.renderCombatPanel(st); // the new battle taken in (the hover cleared)
  UI.cui.hover = { x: me.x, y: me.y };
  const html = String(UI.renderCombatPanel(st) || "") + String(UI.renderRaidCards(st) || "");
  check(html.includes(`(Fog: sight −${WX_SIGHT.fog})`), `the hover card over ${me.name}: "sees ${Math.round(sightRange(bf, me))} tiles (Fog: sight −${WX_SIGHT.fog})"`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
