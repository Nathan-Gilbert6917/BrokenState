// Points of interest on the map and in the tile panel (src/ui/mapsprites.js, render.js, poiview.js, ui.js): every
// POI kind (sim/pois.js) and every LOCATIONS type has a sprite painter of its own (not the generic fallback), the
// painters draw without a DOM and on a stub canvas at their zone's size, a bare tile's top POI is drawn and named on
// the map once known and not before, the panel and the hover text list the known places and never count the hidden
// ones, the loot band follows the pool, and two parties on one tile are drawn on opposite sides of the hex.
// Usage: node tools/poispritetest.js [seed]   (a few seconds)
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { LOCATIONS } from "../src/sim/data.js";
import { lootBand, LOOT_BANDS } from "../src/sim/aiscav.js";
import { launchExpedition, partyTile } from "../src/sim/parties.js";
import { allPoiKinds, poisOf, poiKnown, knownPois, poiName, poiLootBand, poiPool, poiTake, inKnownZone, revealPois, setPoiReveal } from "../src/sim/pois.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log("  FAIL:", msg); } };
const section = (s) => console.log(`\n${s}`);
// A place's name in the panel's HTML: as it is, or escaped (a franchise's "Bait & Tackle", sim/shops.js).
const hasName = (html, name) => html.includes(name) || html.includes(name.replace(/&/g, "&amp;"));
const W = () => { const st = createWorld({ seed, factionCount: 8 }); st.started = true; st.cards.length = 0; return st; };

// A stub 2D context: records what is drawn (fillRect for the painters' signatures, fillText for the map's names,
// drawImage for the sprites, with the translation in force), everything else a no-op.
const drawn = [], images = [];
const noop = () => {};
function stubCtx(cv) {
  const off = { x: 0, y: 0 }, stack = [];
  const o = {
    measureText: (t) => ({ width: String(t).length * 5 }), getTransform: () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 }),
    createRadialGradient: () => ({ addColorStop: noop }), createLinearGradient: () => ({ addColorStop: noop }), createPattern: () => null,
    save: () => stack.push({ ...off }), restore: () => Object.assign(off, stack.pop() || { x: 0, y: 0 }), translate: (x, y) => { off.x += x; off.y += y; },
    fillRect: (x, y, w, h) => { if (cv) cv.ops.push(`${o.fillStyle}:${x},${y},${w},${h}`); },
    fillText: (s) => drawn.push(String(s)), strokeText: (s) => drawn.push(String(s)),
    drawImage: (img, ...a) => images.push({ cv: img, x: a.length >= 4 ? a[0] + off.x + a[2] / 2 : a[0] + off.x, w: a.length >= 4 ? a[2] : 0 }),
  };
  return new Proxy(o, { get: (t, k) => (k in t ? t[k] : noop), set: (t, k, v) => ((t[k] = v), true) });
}
const stubCanvas = () => { const cv = { width: 0, height: 0, ops: [] }; cv.getContext = () => stubCtx(cv); cv.toDataURL = () => "data:,"; return cv; };
const stubDocument = { createElement: () => stubCanvas(), getElementById: () => null };
globalThis.document = stubDocument;
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };
const MS = await import("../src/ui/mapsprites.js");
const MF = await import("../src/ui/mapfigures.js");

// ---------------------------------------------------------------------------------------------------------------
section("Painters without a DOM (poiSpriteCanvas gives null, nothing throws)");
{
  delete globalThis.document;
  const M0 = await import("../src/ui/mapsprites.js?nodom=1"); // a fresh instance: the sprite cache is per module
  let threw = null;
  try { for (const k of [...allPoiKinds(), ...Object.keys(LOCATIONS)]) M0.poiSpriteCanvas(k); } catch (e) { threw = e; }
  check(!threw, `every kind paints headlessly (${threw && threw.message})`);
  check(M0.poiSpriteCanvas("house") === null, "without a document there is no canvas (null), as the headless tools expect");
  globalThis.document = stubDocument;
}

// ---------------------------------------------------------------------------------------------------------------
section("Painters on a stub canvas: every POI kind and LOCATIONS type has its own, at its zone's size");
{
  const generic = MS.poiSpriteCanvas("nosuchkind");
  check(generic && generic.ops.length > 0, "a kind with no painter falls back to the generic building (and draws)");
  const sig = (cv) => cv.ops.join("|");
  const kinds = [...new Set([...allPoiKinds(), ...Object.keys(LOCATIONS)])];
  let own = 0, sized = 0, fadedOk = 0;
  // Canvas size in sprite pixels (UP = 4): town kinds 20 × 17, countryside 18 × 15 (city blocks 22 × 20, the big
  // places their own). The new POI kinds follow their zone.
  const WANT = { house: [20, 17], neighbourhood: [20, 17], garage: [20, 17], corner: [20, 17], pizza: [20, 17], farmstand: [18, 15], shed: [18, 15], blind: [18, 15], campsite: [18, 15], hikercamp: [18, 15], mineshack: [18, 15] };
  for (const k of kinds) {
    const cv = MS.poiSpriteCanvas(k);
    const mine = !!(cv && cv.ops.length && sig(cv) !== sig(generic));
    check(mine, `${k}: has a painter of its own (POI_PAINT)`);
    if (mine) own++;
    const w = cv.width / 4, h = cv.height / 4, want = WANT[k];
    if (want) { check(w === want[0] && h === want[1], `${k}: ${w} × ${h} (a ${LOCATIONS[k].cat} kind should be ${want.join(" × ")})`); if (w === want[0] && h === want[1]) sized++; }
    const f = MS.poiSpriteCanvas(k, "", 3);
    if (f && sig(f) !== sig(cv) && MS.poiSpriteCanvas(k, "", 3) === f) fadedOk++;
  }
  check(own === kinds.length, `${own} of ${kinds.length} kinds have their own painter`);
  check(sized === Object.keys(WANT).length, `${sized} of the ${Object.keys(WANT).length} new kinds are their zone's size`);
  check(fadedOk === kinds.length, `every kind fades when picked over, cached by band (${fadedOk} of ${kinds.length})`);
}

// ---------------------------------------------------------------------------------------------------------------
section("The loot band of a POI follows its pool (aiscav.js lootBand for the site POI)");
{
  const st = W();
  const site = st.tiles.find((t) => t.loc && poisOf(t)[0] && poisOf(t)[0].site && t.loc.type !== "city" && t.loc.type !== "town");
  check(poiLootBand(site, 0) === lootBand(site, site.loot), `the site POI's band is lootBand's (${LOOT_BANDS[poiLootBand(site, 0)]})`);
  const bare = st.tiles.find((t) => !t.loc && poisOf(t).length);
  check(poiLootBand(bare, 0) === 0, `a fresh POI is ${LOOT_BANDS[0].toLowerCase()} (${LOOT_BANDS[poiLootBand(bare, 0)]})`);
  const bands = [];
  while (poiPool(bare, 0) > 0) { bands.push(poiLootBand(bare, 0)); poiTake(bare, 0, 0.05); }
  bands.push(poiLootBand(bare, 0));
  check(bands.every((b, i) => i === 0 || b >= bands[i - 1]) && bands[bands.length - 1] === 3, `the band only falls as the pool drains: ${[...new Set(bands)].map((b) => LOOT_BANDS[b]).join(" → ")}`);
  check(poiLootBand(bare, 0, 0.9) === 0 && poiLootBand(bare, 0, 0) === 3, "a pool as last seen (a snapshot's) gives its band");
}

// ---------------------------------------------------------------------------------------------------------------
section("The map: a bare tile's top POI drawn and named once known, not before; the panel and the hover text");
const R = await import("../src/ui/render.js");
const UI = await import("../src/ui/ui.js");
const PV = await import("../src/ui/poiview.js");
R.initRenderer({ getContext: () => stubCtx(null), getBoundingClientRect: () => ({ width: 1600, height: 900 }), width: 0, height: 0 });
R.zoomAt(800, 450, 2.5 / R.camera.zoom);
const frame = (st, id) => { drawn.length = 0; images.length = 0; R.centerOn(st, id); R.redrawMap(true); R.render(st); };
const text = (html) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
{
  const st = W();
  const h = hub(st);
  const free = (t) => !st.bases.some((b) => b.tile === t.id) && !st.factions.some((f) => f.bases.includes(t.id)) && !t.hive;
  // A known-zone bare tile: its top POI is known from the start, so it is drawn and headed by its name.
  const kz = st.tiles.filter((t) => !t.loc && poisOf(t).length && inKnownZone(st, t) && poiKnown(st, t, 0) && free(t))
    .sort((a, b) => st.grid.distance(a.id, h.tile) - st.grid.distance(b.id, h.tile))[0];
  const name = poiName(kz, 0);
  check(PV.poiHeading(st, kz.id) === name, `a known-zone bare tile is headed by its top POI (${name})`);
  frame(st, kz.id);
  check(drawn.includes(name), `the map names it when zoomed in (${name})`);
  const panel = UI.renderRight(st, { selected: kz.id }), tip = R.tileTooltip(st, kz.id);
  check(panel.includes(`<h2>${name}</h2>`), "the tile panel's heading is the top POI's name");
  check(/Places/.test(panel), "the panel has a Places section");
  const known = knownPois(st, kz);
  for (const i of known) check(hasName(text(panel), poiName(kz, i)) && hasName(text(tip), poiName(kz, i)), `${poiName(kz, i)} is listed in the panel and the hover text`);
  const hidden = poisOf(kz).length - known.length;
  if (hidden) check(/possibly more unknown/i.test(panel) && /possibly more unknown/i.test(tip), "with a hidden remainder: \"possibly more unknown\"");
  else check(!/possibly more unknown/i.test(panel), "nothing hidden: no \"possibly more unknown\"");
  check(!/\b\d+ (more|hidden|unknown)\b/i.test(text(panel) + text(tip)), "the hidden count is never shown");
  // A tile in the unknown zone: nothing is known, nothing is named, "POIs unknown".
  // (quiet: no site, base or known place within 2 tiles, whose name would hide this one: a label that overlaps one
  // of higher priority is skipped, drawLabels)
  const quiet = (t) => st.grid.within(t.id, 2).every((id) => id === t.id || (!st.tiles[id].loc && !st.bases.some((b) => b.tile === id) && !poiKnown(st, st.tiles[id], 0)));
  const uz = st.tiles.filter((t) => !t.loc && poisOf(t).length && !inKnownZone(st, t) && !poiKnown(st, t, 0) && free(t) && quiet(t))
    .sort((a, b) => st.grid.distance(a.id, h.tile) - st.grid.distance(b.id, h.tile))[0];
  const uname = poiName(uz, 0);
  check(PV.poiHeading(st, uz.id) === null, "an unknown-zone bare tile is headed by its terrain");
  const upanel = UI.renderRight(st, { selected: uz.id }), utip = R.tileTooltip(st, uz.id);
  check(/POIs unknown/.test(upanel) && /POIs unknown/.test(utip), "the panel and the hover text say \"POIs unknown\"");
  check(!text(upanel).includes(`Places ${uname}`) && !/Places: /.test(utip), "its places are not named");
  frame(st, uz.id);
  const before = drawn.filter((s) => s === uname).length;
  // A survey finds everything there: now the top POI is drawn and named, and the panel lists the places.
  revealPois(st, null, uz, { all: true, stamp: "surveyed" });
  check(poiKnown(st, uz, 0), "a full survey makes the top POI known");
  frame(st, uz.id);
  const after = drawn.filter((s) => s === uname).length;
  check(after > before, `the map names it after the survey (${before} → ${after} "${uname}")`);
  const spanel = UI.renderRight(st, { selected: uz.id });
  check(spanel.includes(`<h2>${uname}</h2>`) && !/POIs unknown/.test(spanel) && !/possibly more unknown/i.test(spanel), "the panel is headed by it, lists everything and says nothing is hidden");
  check(/Surveyed/.test(spanel) && /in full on day/.test(spanel), "the survey's day stamp shows");
  // A site tile: its extras are listed under the site, the site keeps its name.
  const site = st.tiles.find((t) => t.loc && poisOf(t).length > 1 && poiKnown(st, t, 0) && knownPois(st, t).length > 1 && free(t));
  check(!!site, "a site tile with a known extra exists");
  if (site) {
    const sp = UI.renderRight(st, { selected: site.id });
    check(sp.includes(`<h2>${site.loc.name}</h2>`), `a site tile keeps its site's name (${site.loc.name})`);
    for (const i of knownPois(st, site)) if (i) check(hasName(text(sp), poiName(site, i)), `its extra ${poiName(site, i)} is listed`);
  }
  // The dev reveal shows everything.
  setPoiReveal(true);
  const rz = st.tiles.find((t) => !t.loc && poisOf(t).length && !inKnownZone(st, t) && t !== uz && free(t));
  check(PV.poiHeading(st, rz.id) === poiName(rz, 0) && !/POIs unknown/.test(UI.renderRight(st, { selected: rz.id })), "the dev reveal shows an unknown-zone tile's places");
  setPoiReveal(false);
  check(PV.poiHeading(st, rz.id) === null, "and hides them again");
}

// ---------------------------------------------------------------------------------------------------------------
section("Two parties on one tile are drawn on opposite sides of the hex");
{
  const st = W();
  const h = hub(st);
  const people = atBase(st, h.id).filter((s) => s.alive);
  const dest = st.grid.neighbors(h.tile).map((id) => st.tiles[id]).find((t) => t.terrain !== "water" && !st.bases.some((b) => b.tile === t.id));
  const launch = (ids) => launchExpedition(st, { memberIds: ids, dest: dest.id, mission: "move", stance: "normal", supplies: { food: 2, water: 2 } }).party;
  const a = launch(people.slice(0, 2).map((s) => s.id)), b = launch(people.slice(2, 4).map((s) => s.id));
  for (const p of [a, b]) { p.path = [dest.id]; p.idx = 0; p.phase = "waiting"; p.radioLive = true; }
  check(partyTile(a) === dest.id && partyTile(b) === dest.id, "two teams stand on one tile");
  const [cx] = st.grid.toPixel(dest.id, R.HEX);
  R.camera.zoom = 1; // besideBase's offsets are 13 world px a side at zoom 1
  // The teams' piece: two walkers in your blue, standing (frame 0) and heading east, the heading of a team that has not
  // moved (render.js partyLook, teamCanvas, headingOf; ui/mapfigures.js caches one canvas per look, heading and frame).
  const teamCv = MF.mapPartyCanvas("walkers", "#4f8fd6", 2, "", 315, 0);
  const near = () => images.filter((i) => i.cv === teamCv).map((i) => Math.round(i.x - cx));
  frame(st, dest.id);
  const xs = near();
  check(xs.length >= 2 && xs.some((x) => x < -5) && xs.some((x) => x > 5), `one is left of the hex's centre and one right (${xs.join(", ")})`);
  // One team alone stands in the middle.
  st.parties.splice(st.parties.indexOf(b), 1);
  for (const s of people.slice(2, 4)) s.location = { kind: "base", baseId: h.id };
  frame(st, dest.id);
  const one = near();
  check(one.length >= 1 && one.every((x) => Math.abs(x) < 5), `alone it stands on the tile's centre (${one.join(", ")})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
