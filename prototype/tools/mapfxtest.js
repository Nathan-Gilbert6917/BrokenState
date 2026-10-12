// Headless checks for the State Map's night and the screen-edge warnings (src/ui/nightfx.js, src/ui/edgepulse.js,
// src/ui/attackwatch.js; the hooks in render.js, main.js and ui/edgefx.js): the night curve (0 at noon, 1 at midnight,
// easing through dusk and dawn, the Night darkness setting), the shade drawn by the renderer at night only and never
// in the timelapse, the lights (your hub lit, an empty base dark, a team's lamp, floodlights), where a point off screen
// shows on the edge (and nothing for a point on screen), badges on one edge kept apart, the attack sources from a test
// world (a besieged base, a team in a fight, an ambush card, a raid and a horde coming, no second pulse for a base
// already attacked), the pulse tracker (one per source, the cap, fading, the cooldown, a source on screen kept quiet),
// a battle's shots at your people, the Display options (defaults, stored, the rows and handlers), and that the world
// plays the same with and without all of it running (no dice, no state).
// Usage: node tools/mapfxtest.js [seed]
import { createWorld, hub, atBase, tickHour, makeSurvivor, setNextId } from "../src/sim/world.js";
import { launchExpedition, partyTile } from "../src/sim/parties.js";
import { addBuilding } from "../src/sim/buildings.js";
import { newItem } from "../src/sim/inventory.js";
import { saveToString } from "../src/sim/save.js";
import { nightLevel, shadeAlpha, mapHour, NIGHT_LEVELS, NIGHT, setNightShade, nightShade, drawNight, mapLights, nightStats } from "../src/ui/nightfx.js";
import { edgePoint, makePulseTracker, spreadOut, PULSE, GAP } from "../src/ui/edgepulse.js";
import { mapAttackSources, battleHitSources, baseUnderAttack, HOLD_MS } from "../src/ui/attackwatch.js";
import { readDisplayOptions, DISPLAY_DEFAULTS, NIGHT_SHADES } from "../src/ui/displayopts.js";
import { readFileSync } from "node:fs";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log(`  FAIL ${what}`); } return ok; };
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; return st; };
const src = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

console.log("The night curve");
{
  check(nightLevel(12) === 0 && nightLevel(0) === 1 && nightLevel(24) === 1 && nightLevel(3) === 1 && nightLevel(9) === 0, "0 at noon and through the day, 1 at midnight and through the night");
  check(near(nightLevel(20), 0.5) && near(nightLevel(6), 0.5), "the sim's night begins and ends (20:00, 06:00) halfway through dusk and dawn");
  let up = true, down = true;
  for (let h = NIGHT.duskFrom - 0.5; h < NIGHT.duskTo + 0.5; h += 0.05) if (nightLevel(h + 0.05) < nightLevel(h) - 1e-12) up = false;
  for (let h = NIGHT.dawnFrom - 0.5; h < NIGHT.dawnTo + 0.5; h += 0.05) if (nightLevel(h + 0.05) > nightLevel(h) + 1e-12) down = false;
  check(up && down, "darker all through dusk (19:00–21:00), lighter all through dawn (05:00–07:00)");
  check(NIGHT.duskTo - NIGHT.duskFrom === 2 && NIGHT.dawnTo - NIGHT.dawnFrom === 2 && nightLevel(19) === 0 && nightLevel(21) === 1 && nightLevel(5) === 1 && nightLevel(7) === 0, "each fade takes 2 hours");
  let all = true;
  for (let h = 0; h < 24; h += 0.1) { const v = nightLevel(h); if (!(v >= 0 && v <= 1)) all = false; }
  check(all && nightLevel(-1) === nightLevel(23), "always 0–1, wraps round the day");
  check(shadeAlpha(1, "off") === 0 && shadeAlpha(1, "light") < shadeAlpha(1, "dark") && shadeAlpha(1, "dark") >= 0.55 && shadeAlpha(1, "dark") <= 0.65, `Off none, Light lighter than Dark, Dark ${Math.round(shadeAlpha(1, "dark") * 100)}% at full night (55–65%)`);
  check(shadeAlpha(0, "dark") === 0 && near(shadeAlpha(0.5, "dark"), NIGHT_LEVELS.dark.alpha / 2) && shadeAlpha(1, "nonsense") === shadeAlpha(1, "dark"), "by day nothing; halfway half; an unknown setting counts as Dark");
  check(near(mapHour({ hour: 24 * 3 + 19 }, 0.5), 19.5) && mapHour({ hour: 5 }, 2) < 6, "the map's hour: the clock and the minutes of the coming hour");
}

console.log("The shade on the map (headless: no offscreen canvas, the plain shade)");
{
  const st = world();
  let fills = [], nan = 0;
  const ctx = new Proxy({}, {
    get: (o, k) => (k in o ? o[k] : (...a) => { if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) nan++; if (k === "fillRect") fills.push(o.fillStyle); }),
    set: (o, k, v) => ((o[k] = v), true),
  });
  const draw = (hour, extra = {}) => { st.hour = hour; fills = []; return drawNight(ctx, { state: st, cw: 1920, ch: 1080, S: 1, ox: 0, oy: 0, boost: 1, G: null, frac: 0, timelapse: false, ...extra }); };
  setNightShade("dark");
  check(draw(12) === 0 && fills.length === 0, "noon: nothing drawn");
  const a = draw(24 + 1);
  check(a >= 0.55 && a <= 0.65 && fills.length === 1 && /^rgba\(6,10,30,0\.6\d\)$/.test(fills[0]), `01:00: one deep blue-black fill (${fills[0]})`);
  check(draw(24 + 1, { timelapse: true }) === 0 && fills.length === 0, "never in the timelapse");
  const dusk = draw(20);
  check(dusk > 0 && dusk < a, `dusk lighter than night (${dusk} vs ${a})`);
  setNightShade("light");
  const light = draw(25);
  check(light > 0 && light < a && nightShade() === "light", `Light: ${light}`);
  setNightShade("off");
  check(draw(25) === 0 && fills.length === 0, "Off: nothing drawn");
  setNightShade("bogus");
  check(nightShade() === "dark", "an unknown setting falls back to Dark");
  check(!nan && nightStats.draws >= 3, "no NaN, the draws counted");
  // The renderer: the hook after the cached layers, the hour not in the chunk cache key.
  const r = src("src/ui/render.js");
  const keyLine = (r.match(/const key = `\$\{F\.tint\}[^\n]*/) || [""])[0];
  check(/drawNight\(ctx, \{ state, cw, ch: chh, S, ox, oy/.test(r) && r.indexOf("drawNight(ctx") > r.indexOf("drawFronts(ctx") && r.indexOf("drawNight(ctx") < r.indexOf("drawLabels(labels"), "render.js draws the shade after the ground and fronts, before the bases, teams, labels and selection");
  check(keyLine && !/hour/i.test(keyLine) && !/night/i.test(keyLine), "the hour is not in the map's cache key");
}

console.log("Lights");
{
  const st = world();
  const h = hub(st);
  const ls = mapLights(st, null, 1);
  const [hx, hy] = st.grid.toPixel(h.tile, 26);
  check(ls.some((L) => Math.hypot(L[0] - hx, L[1] - hy) < 10 && L[2] > 30), "the hub with people home is lit");
  const out = createWorld({ seed, factionCount: 6 });
  for (const s of out.survivors) s.location = { kind: "party", partyId: -1 };
  check(!mapLights(out, null, 1).some((L) => Math.hypot(L[0] - hx, L[1] - hy) < 10), "a base with nobody home is dark");
  addBuilding(h, "floodlights");
  h.stock.fuel = 10;
  check(mapLights(st, null, 1).some((L) => L[4] === "214,232,255" && L[2] > 50), "floodlights with fuel: a wide cold light");
  h.stock.fuel = 0;
  check(!mapLights(st, null, 1).some((L) => L[4] === "214,232,255"), "no fuel, no floodlights");
  // A team with a lantern, in radio contact.
  const crew = atBase(st, h.id).slice(0, 2);
  crew[0].gear.tool = newItem("lantern");
  const dest = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 3).id;
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 0, meds: 0 } });
  const p = res && res.party;
  if (check(!!p, "a team set off")) {
    p.radioLive = true;
    const [px, py] = st.grid.toPixel(partyTile(p), 26);
    check(mapLights(st, null, 1).some((L) => Math.hypot(L[0] - px, L[1] - py) < 2 && L[3] > 0.5), "a team carrying a lantern glows where the map shows it");
    p.radioLive = false;
    check(mapLights(st, null, 1).some((L) => Math.hypot(L[0] - px, L[1] - py) < 2), "out of radio range it still shows where it is (orders reach it): its light too");
  }
}

console.log("Off screen: which edge, where along it");
{
  const R = { x0: 0, y0: 0, x1: 1000, y1: 600 };
  check(edgePoint(500, 300, R) === null && edgePoint(0, 0, R) === null && edgePoint(1000, 600, R) === null && edgePoint(10, 590, R) === null, "points on screen (edges included): nothing");
  const l = edgePoint(-200, 300, R), r = edgePoint(1500, 300, R), t = edgePoint(500, -50, R), b = edgePoint(500, 900, R);
  check(l && l.edge === "left" && near(l.t, 0.5) && l.x === 0 && l.y === 300, "straight left: the left edge, halfway down");
  check(r && r.edge === "right" && near(r.t, 0.5) && r.x === 1000, "straight right: the right edge");
  check(t && t.edge === "top" && near(t.t, 0.5) && t.y === 0 && b && b.edge === "bottom" && b.y === 600, "above and below: the top and bottom edges");
  const q = edgePoint(-500, 0, R); // from the middle (500, 300) toward (-500, 0): crosses x = 0 at y = 150
  check(q && q.edge === "left" && near(q.y, 150) && near(q.t, 0.25), "toward the point from the middle of the screen (left edge at y 150)");
  const c = edgePoint(-500, -300, R); // straight at the top-left corner
  check(c && c.edge === "left" && near(c.t, 0.06) && near(c.y, 36), "toward a corner: kept just off it");
  check(edgePoint(NaN, 5, R) === null, "no position: nothing");
  const P = (key, x, y, edge = "left") => ({ key, src: { off: { edge, x, y } } });
  const at = spreadOut([P("a", 0, 300), P("b", 0, 305), P("c", 0, 600), P("d", 400, 0, "top")]);
  check(at.get("a")[1] === 300 && at.get("b")[1] === 300 + GAP && at.get("c")[1] === 600 && at.get("d")[0] === 400, "badges on one edge closer than the gap are pushed apart, the others left alone");
}

console.log("What counts as an attack (attackwatch.js)");
{
  const st = world();
  const h = hub(st);
  const f = st.factions[0];
  check(mapAttackSources(st).length === 0, "a quiet world: no sources");
  // A raid besieging the hub.
  st.parties.push({ id: 990001, owner: f.id, kind: "raid", phase: "siege", target: { kind: "player", baseId: h.id }, path: [h.tile], idx: 0, strength: 6 });
  // A horde the lookouts saw coming for the hub (already attacked: no second pulse), and an outpost with a raid on the way.
  const ht = st.grid.neighbors(st.grid.neighbors(h.tile)[0])[0];
  st.hordes.push({ id: 990002, tile: ht, size: 40, target: h.tile, goal: { baseId: h.id, tile: h.tile }, role: "attack", warned: true });
  const otile = st.tiles.find((t) => t.terrain !== "water" && !t.loc && st.grid.distance(t.id, h.tile) === 6).id;
  const out = { id: 990003, name: "Test Outpost", type: "outpost", tier: 1, tile: otile, buildings: [], stock: {} };
  st.bases.push(out);
  st.parties.push({ id: 990004, owner: f.id, kind: "raid", phase: "go", warned: true, target: { kind: "player", baseId: out.id }, path: [otile, otile], idx: 0, strength: 4 });
  // A team of yours in a fight (its battle waiting) and another with an ambush card over it.
  const crew = atBase(st, h.id);
  const mk = (ids) => launchExpedition(st, { memberIds: ids, dest: otile, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2, ammo: 0, meds: 0 } }).party;
  const t1 = mk([crew[0].id]), t2 = mk([crew[1].id]);
  st.combatQueue = [{ partyId: t1.id, tile: partyTile(t1), enemy: { kind: "raiders", count: 3 } }];
  st.cards.push({ kind: "conflict", partyId: t2.id, conflict: { type: "ambush" }, title: "Ambush", choices: [] });
  const s = mapAttackSources(st);
  const by = (k) => s.find((x) => x.key === k);
  check(by(`base:${h.id}`) && by(`base:${h.id}`).tile === h.tile && /under attack$/.test(by(`base:${h.id}`).label) && by(`base:${h.id}`).label.startsWith(h.name), `the besieged hub: "${by(`base:${h.id}`)?.label}"`);
  check(!by(`near:${h.id}`), "no second pulse for the horde coming at a base already under attack");
  check(by(`near:${out.id}`) && /A raid closing on Test Outpost/.test(by(`near:${out.id}`).label), `a raid seen coming: "${by(`near:${out.id}`)?.label}"`);
  check(by(`team:${t1.id}`) && /in a fight$/.test(by(`team:${t1.id}`).label) && by(`team:${t1.id}`).tile === partyTile(t1), `a team whose battle waits: "${by(`team:${t1.id}`)?.label}"`);
  check(by(`team:${t2.id}`) && /ambushed$/.test(by(`team:${t2.id}`).label), `a team with an ambush card: "${by(`team:${t2.id}`)?.label}"`);
  check(s.every((x, i) => i === 0 || s[i - 1].pri <= x.pri) && s[0].kind === "base", "worst first: bases under attack, then fights, then what is coming");
  check(baseUnderAttack(s) && !baseUnderAttack(s.filter((x) => x.kind !== "base")), "a base under attack (the heartbeat)");
  check(new Set(s.map((x) => x.key)).size === s.length, "one source per place");
  // The horde alone (the siege lifted): now it pulses for the hub.
  st.parties = st.parties.filter((p) => p.id !== 990001);
  const s2 = mapAttackSources(st);
  check(s2.some((x) => x.key === `near:${h.id}` && /horde of 40/i.test(x.label)) && !s2.some((x) => x.key === `base:${h.id}`), "the siege over: the horde coming for the hub pulses");
  // Another group's raid on another group: not yours.
  st.parties.push({ id: 990005, owner: f.id, kind: "raid", phase: "siege", target: { kind: "faction", factionId: st.factions[1].id, tile: st.factions[1].bases[0] }, path: [st.factions[1].bases[0]], idx: 0 });
  check(!mapAttackSources(st).some((x) => x.key.startsWith("base:")), "a siege between other groups: nothing");
}

console.log("The pulse tracker (one per source, cap, fade, cooldown)");
{
  const T = makePulseTracker();
  const off = { edge: "left", t: 0.5, x: 0, y: 100 };
  const S = (k, pri = 1, o = off) => ({ key: k, pri, off: o, label: k });
  let shown = T.step([S("a", 2), S("b", 0), S("c", 1), S("d", 1), S("e", 1), S("f", 1)], 0);
  check(shown.length === PULSE.cap && PULSE.cap === 4 && shown[0].key === "b" && shown[1].key === "c", `at most ${PULSE.cap}, the most urgent first (${shown.map((x) => x.key).join(" ")})`);
  shown = T.step([S("b", 0), S("b", 0)], 100);
  check(shown.filter((x) => x.key === "b").length === 1, "one pulse per source, however often it is listed");
  check(shown.find((x) => x.key === "b").fresh && shown.some((x) => x.fading != null), "a new pulse is fresh; the sources gone start fading");
  T.step([S("b", 0)], 100 + PULSE.fadeMs + 1);
  check(T.size === 1, "faded out after fadeMs");
  shown = T.step([S("b", 0), S("a", 2)], 2000);
  check(!shown.some((x) => x.key === "a"), "a source back within the cooldown does not pulse again (no spam)");
  shown = T.step([S("b", 0), S("a", 2)], 2000 + PULSE.cooldownMs + 1000);
  check(shown.some((x) => x.key === "a"), "after the cooldown it does");
  // Fading and back: kept, not born again.
  const born = shown.find((x) => x.key === "a").born;
  T.step([S("b", 0)], 30000); T.step([S("b", 0)], 30300);
  shown = T.step([S("b", 0), S("a", 2)], 30400);
  const a = shown.find((x) => x.key === "a");
  check(a && a.born === born && a.fading == null && a.alpha === 1, "back while fading: the same pulse, at full strength");
  check(!shown.find((x) => x.key === "b").fresh || 30400 - shown.find((x) => x.key === "b").born < PULSE.freshMs, "the strong beat only while fresh");
  // On screen: kept quiet, not shown, and looking away does not start a new pulse.
  shown = T.step([S("b", 0, null), S("a", 2)], 31000);
  check(!shown.some((x) => x.key === "b") && T.size === 2, "a source on screen: no pulse shown, still tracked");
  shown = T.step([S("b", 0), S("a", 2)], 31100);
  check(shown.find((x) => x.key === "b") && shown.find((x) => x.key === "b").born < 31000, "looking away again: the same pulse");
  // Fading pulses sort last and lose alpha.
  shown = T.step([S("a", 2)], 32000); shown = T.step([S("a", 2)], 32000 + PULSE.fadeMs / 2);
  const fb = shown.find((x) => x.key === "b");
  check(fb && fb.alpha > 0.4 && fb.alpha < 0.6 && shown[shown.length - 1].key === "b", "fading: half way, half strength, listed last");
}

console.log("In battle: shots at your people");
{
  const units = [
    { id: 1, side: "player", name: "Ann Lee", x: 3, y: 4 },
    { id: 2, side: "player", name: "Bo Diaz", x: 8, y: 1 },
    { id: 3, side: "enemy", name: "Raider", x: 10, y: 10 },
  ];
  const b = { units, fx: [], fxSeq: 0 };
  const fx = (e) => { e.seq = ++b.fxSeq; b.fx.push(e); };
  const mem = {};
  check(battleHitSources(b, mem, 0).length === 0, "a quiet battle: nothing");
  fx({ type: "shot", from: [10, 10], to: [3, 4], hit: false, side: "enemy" });
  fx({ type: "shot", from: [3, 4], to: [10, 10], hit: true, side: "player" });
  fx({ type: "move", from: [10, 10], to: [9, 9], side: "enemy" });
  let s = battleHitSources(b, mem, 100);
  check(s.length === 1 && s[0].key === "unit:1" && s[0].label === "Ann under fire" && s[0].unit === units[0], `a shot at Ann: "${s[0] && s[0].label}"; your own shots and moves: nothing`);
  fx({ type: "melee", from: [9, 1], to: [8, 1], hit: true, side: "enemy" });
  s = battleHitSources(b, mem, 200);
  check(s.length === 2 && s[0].key === "unit:2" && s[0].label === "Bo hit", "a blow that lands: \"Bo hit\", first");
  check(battleHitSources(b, mem, 300).length === 2, "seen events are not counted again, the warnings held");
  check(battleHitSources(b, mem, 200 + HOLD_MS + 1).length === 0, `gone ${HOLD_MS / 1000} s after the last shot`);
  units[0].dead = true;
  fx({ type: "shot", from: [10, 10], to: [3, 4], hit: true, side: "enemy" });
  check(battleHitSources(b, mem, 9000).length === 0, "a dead unit: nothing");
  const b2 = { units, fx: [{ type: "shot", to: [8, 1], side: "enemy", seq: 5 }], fxSeq: 5 };
  check(battleHitSources(b2, mem, 9100).length === 0, "a new battle: what happened before it was first seen is not replayed");
}

console.log("The Display options");
{
  const o = readDisplayOptions({});
  check(o.nightShade === "dark" && o.edgeWarn === true && o.heartbeat === false && DISPLAY_DEFAULTS.nightShade === "dark", "defaults: Night darkness Dark, screen-edge warnings on, heartbeat off");
  const v = readDisplayOptions({}, { nightShade: "light", edgeWarn: false, heartbeat: true });
  check(v.nightShade === "light" && v.edgeWarn === false && v.heartbeat === true, "stored values read back");
  const bad = readDisplayOptions({}, { nightShade: "pitch", edgeWarn: "no", heartbeat: 1 });
  check(bad.nightShade === "dark" && bad.edgeWarn === true && bad.heartbeat === false && NIGHT_SHADES.join() === "off,light,dark", "junk ignored");
  const d = src("src/ui/display.js"), m = src("src/main.js");
  check(/data-action="dsp-night"/.test(d) && /"dsp-night": \(ui, el\)/.test(d) && /box\("edgeWarn"/.test(d) && /box\("heartbeat"/.test(d) && /setNightShade\(OPT\.nightShade\)/.test(d), "Settings → Display: Night darkness, Screen-edge warnings, Heartbeat; applied");
  check(/initEdgeFx\(\$\("mapwrap"\), \$\("cbmapwrap"\)/.test(m) && /edgeFrame\(state, ui, now, /.test(m), "main.js starts the edge warnings and runs them every frame");
  const readme = src("README.md");
  check(readme.includes("tools/mapfxtest.js") && /Night darkness/.test(readme) && /Screen-edge warnings/.test(readme), "the README lists the tool and the options");
}

console.log("No dice, no state: the world plays the same with it all running");
{
  const run = (watch) => {
    setNextId(5_000_000); // ids are process-wide: both runs start from the same one
    const st = world(seed + 1);
    const h = hub(st);
    for (let i = 0; i < 3; i++) { const s = makeSurvivor(st); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); }
    const T = makePulseTracker(), mem = {};
    const ctx = new Proxy({}, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => ((o[k] = v), true) });
    for (let i = 0; i < 72; i++) {
      tickHour(st);
      if (watch) {
        const s = mapAttackSources(st).map((x) => ({ ...x, off: edgePoint(x.tile * 3, 5, { x0: 0, y0: 0, x1: 100, y1: 100 }) }));
        T.step(s, i * 250);
        mapLights(st, null, 1, 0.5);
        setNightShade("dark");
        drawNight(ctx, { state: st, cw: 800, ch: 600, S: 1, ox: 0, oy: 0, boost: 1, G: null, frac: 0.3, timelapse: false });
        battleHitSources({ units: [], fx: [], fxSeq: 0 }, mem, i);
      }
    }
    st.cards = [];
    const o = JSON.parse(saveToString(st));
    if (o.state && o.state.chronicle) delete o.state.chronicle.ms; // sim/chronicle.js keeps its own run time (wall clock), not dice
    return JSON.stringify(o);
  };
  const a = run(false), b = run(true);
  check(a.length > 1000 && a === b, `72 hours with and without the warnings, lights and shade: the same save (${a.length} chars)`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
