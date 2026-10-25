// A site's buildings picked before the raid map is made (sim/poiraid.js raidBuildings, buildingPickWanted,
// buildingPickCard, buildingPickFor; sim/parties.js the scavenge order; sim/scavenge.js startScavenge; sim/combat.js
// createRaid), the user's request 2026-10-25: "When raiding a tile and there is a street and buildings you can go to
// show the options before loading the raid map and not provide the options when you load into the map."
// - a tile without POIs that has buildings (open plains: a farmhouse and a barn): the scavenge order puts up the card
//   first and no battle is made; its choices are each building and the street, then Not now
// - picking a building makes the raid map for it: inside it, nothing to choose on the map (no "Where do you go in?"
//   over it, ui/combat.js renderRaidCards), the raid plan still offered and its rebuild (another side) keeping it; the
//   street the same on the street map; Not now: no battle, the team waits
// - the site POI picked on the POI card with no building (p.poi): the same card, the pick going into that POI
// - the autopilot (a team that gets no card): the dice pick one before the map (buildingPickFor), the map opens on it
// - headless (no browser): no card, the hour-by-hour search as before
// Usage: node tools/buildingpicktest.js [seed]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, giveOrder } from "../src/sim/parties.js";
import { poisOf, isSitePoi, knownPois } from "../src/sim/pois.js";
import { raidBuildings, buildingPickWanted, buildingPickFor } from "../src/sim/poiraid.js";
import { planOpen, setEntry } from "../src/sim/raidplan.js";

const seed = Number(process.argv[2] || 42);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const t0 = performance.now();

// Headless first (before the browser's stand-ins below): no card, the search as it always was.
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.started = true; st.cards.length = 0; st.crashNext = 1e9; return st; };
// A team of two from the hub, put on `tile` waiting for orders (the trip itself is not the test).
function teamAt(st, tile) {
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "move", stance: "normal", supplies: { food: 6, water: 6, ammo: 20 } });
  if (res.error) throw new Error(`launch: ${res.error}`);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.progress = 0; p.dest = tile; p.phase = "waiting"; p.plan = null; p.orders = [];
  st.cards.length = 0;
  return p;
}
// Open plains with no places of its own: its farmhouse and barn (buildingmaps.js SITES.plains) and the street.
function plainsTile(st) {
  const h = hub(st);
  const t = st.tiles.find((x) => !x.loc && x.terrain === "plains" && x.id !== h.tile && !st.bases.some((b) => b.tile === x.id) && !st.factions.some((f) => f.bases.includes(x.id)) && st.grid.distance(x.id, h.tile) <= 6);
  if (t) t.pois = []; // no places on it: the raid goes to the tile itself (poiraid.js poiTileRaid false)
  return t;
}
const cardOf = (st, p) => st.cards.find((c) => c.partyId === p.id && /where do you go in/.test(c.title));
const setOf = (p) => p.task || p.phase;

console.log("Headless: no card, no map");
{
  const st = W();
  const t = plainsTile(st);
  if (check(!!t && !!raidBuildings(st, t), "a plains tile without places, with buildings to choose from")) {
    const p = teamAt(st, t.id);
    check(!buildingPickWanted(st, p, t.id), "no browser: no card");
    giveOrder(st, p, "scavenge");
    check(!cardOf(st, p) && !st.combat && !!st.engagement && st.engagement.partyId === p.id, "the hour-by-hour search starts as before");
    st.engagement = null;
  }
}

// The browser (the stand-ins raidscreentest.js uses): the raid is played on its map.
const silent = () => new Proxy({ createImageData: (w, h) => ({ data: new Uint8ClampedArray(w * h * 4) }), measureText: (t) => ({ width: String(t).length * 6 }) }, { get: (o, k) => (k in o ? o[k] : () => {}) });
const cvs = (w, h) => ({ width: w, height: h, getContext: () => silent(), toDataURL: () => "data:image/png;base64,x" });
globalThis.document = { createElement: () => cvs(0, 0), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const ISO = await import("../src/ui/isoview.js");
const UI = await import("../src/ui/combat.js");
ISO.setIsoCanvas(cvs);
UI.initCombatUI({ clientWidth: 1600, clientHeight: 900, width: 0, height: 0, getContext: () => silent() });

console.log("A tile without places: the card before the map");
{
  const st = W();
  const t = plainsTile(st);
  const opts = t ? raidBuildings(st, t) : null;
  if (check(!!opts && opts.length >= 3, `the buildings: ${opts ? opts.map((o) => o.name).join(", ") : "none"}`)) {
    const p = teamAt(st, t.id);
    check(buildingPickWanted(st, p, t.id), "the browser, driven by hand: the card is wanted");
    giveOrder(st, p, "scavenge");
    const card = cardOf(st, p);
    check(!!card && !st.combat && p.phase === "waiting", "the scavenge order puts up the card and no raid map is made yet");
    if (card) {
      const picks = card.choices.filter((c) => c.building != null);
      check(picks.length === opts.length && opts.every((o) => picks.some((c) => c.building === o.id)) && picks[picks.length - 1].building === "street", `a choice per building and the street last (${picks.map((c) => c.label).join(" · ")})`);
      check(card.choices.some((c) => c.cancel) && picks.every((c) => c.hint && c.hint.length > 20), "each with what it holds and its map; and Not now");
      // Not now: nothing made, the team waits.
      card.choices.find((c) => c.cancel).resolve(st);
      check(!st.combat && p.phase === "waiting" && !cardOf(st, p), "Not now: no raid, the team waits");
      // Again, and a building this time.
      st.cards.length = 0;
      giveOrder(st, p, "scavenge");
      const c2 = cardOf(st, p);
      const b0 = c2 && c2.choices.find((c) => c.building != null && c.building !== "street");
      if (check(!!b0, "the card again")) {
        b0.resolve(st);
        const b = st.combat;
        check(!!b && b.raid && b.raid.interior && b.raid.interior.id === b0.building && b.setup.raid.building === b0.building, `picking it makes the raid map inside it (${b && b.raid.interior ? b.raid.interior.name : "none"}, ${b && b.w} × ${b && b.h})`);
        check(!!b && !b.raid.choose && !/Where do you go in/.test(UI.renderRaidCards(st) + UI.renderCombatScreen(st)) && !b.log.some((l) => /Several buildings stand here/.test(l.text)), "nothing to choose on the map: no card over it, no line in the log");
        check(!!b && planOpen(b), "the raid plan is still offered before going in");
        check(p.poiBuilding === undefined && p.poi === undefined, "the pick is cleared once used");
        if (b) {
          const sides = (b.setup.plan && b.setup.plan.sides) || [];
          const other = sides.find((s) => s !== b.setup.plan.side) || "east";
          setEntry(st, other);
          check(!!st.combat && st.combat.raid.interior && st.combat.raid.interior.id === b0.building && !st.combat.raid.choose, "another side to come in from: the same building, still nothing to choose");
        }
        st.combat = null;
      }
      // The street.
      p.phase = "waiting"; p.task = null; st.cards.length = 0;
      giveOrder(st, p, "scavenge");
      const c3 = cardOf(st, p);
      const sc = c3 && c3.choices.find((c) => c.building === "street");
      if (check(!!sc, "the card a third time")) {
        sc.resolve(st);
        const b = st.combat;
        check(!!b && !b.raid.interior && !b.raid.choose && b.setup.raid.building === "street", "the street: the street map, nothing to choose on it");
        st.combat = null;
      }
    }
  }
}

console.log("The site picked on the POI card with no building");
{
  const st = W();
  const h = hub(st);
  const m = st.tiles.find((x) => x.loc && (x.loc.type === "farm" || x.loc.type === "ranch") && isSitePoi(x, 0) && knownPois(st, x).includes(0) && x.id !== h.tile && !st.factions.some((f) => f.bases.includes(x.id)));
  if (check(!!m && !!raidBuildings(st, m, 0), `a farm site (${m ? m.loc.type : "none"}) with its buildings`)) {
    const p = teamAt(st, m.id);
    p.poi = 0; // the site, as the POI card or the walk there leaves it, with no building
    check(buildingPickWanted(st, p, m.id), "the card is wanted");
    giveOrder(st, p, "scavenge");
    const card = cardOf(st, p);
    check(!!card && !st.combat && p.poi === undefined, "the card first, no raid map yet (the place kept on the card)");
    const b0 = card && card.choices.find((c) => c.building != null && c.building !== "street");
    if (b0) {
      b0.resolve(st);
      const b = st.combat;
      check(!!b && b.setup.raid.poi === 0 && b.raid.interior && b.raid.interior.id === b0.building && b.raid.poiDice === `poi0:${b0.building}` && !b.raid.choose, `the raid goes into the site's ${b0.building} (${b && b.raid.poiDice})`);
      st.combat = null;
    }
    const other = poisOf(m).findIndex((x, i) => i > 0 && x);
    if (other > 0) { const q = teamAt(st, m.id); q.poi = other; check(!buildingPickWanted(st, q, m.id), "another place on that tile (one building): no card"); }
  }
}

console.log("The autopilot: the dice pick before the map");
{
  const st = W();
  const t = plainsTile(st);
  const opts = t ? raidBuildings(st, t) : null;
  if (opts) {
    const p = teamAt(st, t.id);
    st.autopilot = true;
    check(!buildingPickWanted(st, p, t.id), "no card for the autopilot");
    const want = buildingPickFor(st, t.id, opts);
    check(opts.some((o) => o.id === want) && want === buildingPickFor(st, t.id, opts), `its own dice by the tile and the hour (${want})`);
    giveOrder(st, p, "scavenge");
    const b = st.combat;
    check(!cardOf(st, p) && !!b && b.setup.raid.building === want && (want === "street" ? !b.raid.interior : b.raid.interior && b.raid.interior.id === want) && !b.raid.choose, `the map opens on the pick (${want}), nothing to choose there`);
    // Over a few hours the dice pick each of them in turn, the street too.
    const seen = new Set();
    for (let hr = 0; hr < 48; hr++) { st.hour++; seen.add(buildingPickFor(st, t.id, opts)); }
    check(seen.size === opts.length, `over two days every choice comes up (${[...seen].join(", ")})`);
    st.combat = null;
    st.autopilot = false;
  }
}

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
