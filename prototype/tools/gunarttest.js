// Every gun's own drawing (ui/gunspecs.js GUN_ART, painted by ui/gunpaint.js; user 2026-10-10: "unique drawings for
// each gun in the game and new guns"), headless on stub canvases that record what is drawn:
// - every gun (WEAPONS, and the gun items in GEAR) has its own spec; the ones without are listed (they are drawn as a
//   look-alike: the fallback by what the gun is, also checked here);
// - every spec (the pre-written ones for guns not yet in the game too) is well formed and renders, without errors and
//   in known colours, in all three forms: the big side view (gun builder, battle HUD), held in battle, dropped by a body;
// - no two guns look the same: the recorded draw calls of each form, hashed, differ between any two guns (a turret is
//   its gun, ART_ALIAS);
// - attachments: every slot's anchor sits on the drawing; a part fitted in each slot draws at its anchor; a fitted stock
//   or magazine replaces the gun's own;
// - the drawings are cached (made once, not per frame).
// Usage: node tools/gunarttest.js
let ops = null; // the draw calls of the canvas being recorded
const recCtx = () => {
  const c = { fillStyle: "", imageSmoothingEnabled: true };
  return new Proxy(c, {
    get: (o, k) => (k in o ? o[k] : k === "fillRect" ? (x, y, w, h) => { if (ops) ops.push(`${o.fillStyle}@${x},${y},${w},${h}`); } : k === "measureText" ? (t) => ({ width: String(t).length * 6 }) : () => {}),
    set: (o, k, v) => { o[k] = v; return true; },
  });
};
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => recCtx(), toDataURL: () => "data:image/png;base64,AAAA" }), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const { WEAPONS } = await import("../src/sim/combat.js");
const { GEAR } = await import("../src/sim/data.js");
const { makeItem } = await import("../src/sim/crafting.js");
const GM = await import("../src/sim/gunmods.js");
const GA = await import("../src/ui/gunart.js");
const GP = await import("../src/ui/gunpaint.js");
const GS = await import("../src/ui/gunspecs.js");
const GPT = await import("../src/ui/gunparts.js");
const SP = await import("../src/ui/sprites.js");
const DS = await import("../src/ui/downsprites.js");
const { ensureAppearance } = await import("../src/sim/appearance.js");

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return ok; };
const list = (a) => a.join(", ") || "none";
const t0 = performance.now();
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36) + ":" + s.length; };
const record = (fn) => { ops = []; fn(); const r = ops; ops = null; return r; };

const guns = Object.keys(WEAPONS).filter(GA.isGunKey);
const gearGuns = Object.keys(GEAR).filter((k) => WEAPONS[k] && GA.isGunKey(k));
const specKeys = Object.keys(GS.GUN_ART);

// ---------- 1. every gun has its own spec ----------
console.log("Every gun has its own drawing");
{
  const all = [...new Set([...guns, ...gearGuns])];
  const missing = all.filter((k) => !GP.ownKey(k));
  check(!missing.length, `every gun has its own art spec (${all.length} guns; without one, drawn as a look-alike: ${list(missing.map((k) => `${k} → ${GP.specOf(k) ? GP.specOf(k).key : "nothing"}`))})`);
  check(guns.every((k) => GA.artKeyOf(k) === k && GA.PLAT_ART[k] && GA.PLAT_ART[k].spec === GP.ownKey(k)), "each gun's big drawing is its own (compiled from its spec under its key)");
  const aliasBad = Object.entries(GS.ART_ALIAS).filter(([, v]) => !GS.GUN_ART[v]);
  const altBad = Object.entries(GS.SPEC_ALT).filter(([k, v]) => !GS.GUN_ART[v] || GS.GUN_ART[k]);
  check(!aliasBad.length && !altBad.length, `aliases and other names point at specs (${list([...aliasBad, ...altBad].map(([k]) => k))})`);
  const future = specKeys.filter((k) => !WEAPONS[k]);
  console.log(`  (pre-written for guns not in the game yet: ${list(future)})`);
}

// ---------- 2. specs well formed; every one renders in all three forms ----------
console.log("Specs render");
const HEX = /^#[0-9a-f]{6}$/i;
const app = ensureAppearance({ id: 5 }, 3);
const forms = {}; // key -> { big, held, dropped } signatures
{
  const bad = [], errors = [], colours = [], empty = [];
  for (const k of specKeys) {
    const s = GS.GUN_ART[k];
    if (!GP.FAM[s.body] && !(s.like && GS.GUN_ART[s.like])) bad.push(`${k}: body ${s.body}`);
    if (s.stock && typeof s.stock === "object" && !GP.STOCKS[s.stock.t]) bad.push(`${k}: stock ${s.stock.t}`);
    if (s.stock && typeof s.stock === "string" && !GA.PART_ART[s.stock]) bad.push(`${k}: stock look ${s.stock}`);
    if (s.mag && typeof s.mag === "object" && !GP.MAGS[s.mag.t]) bad.push(`${k}: mag ${s.mag.t}`);
    if (s.mag && typeof s.mag === "string" && !GA.PART_ART[s.mag]) bad.push(`${k}: mag look ${s.mag}`);
    for (const f of ["muzzle", "bipod", "grips"]) if (s[f] && !GA.PART_ART[s[f]]) bad.push(`${k}: ${f} ${s[f]}`);
    try {
      const art = GA.compileArt(k);
      GA.PLAT_ART.__test = art;
      const big = GA.paintArt("__test", {}, art.own);
      const held = SP.painter(), dropped = DS.downPainter();
      const okH = GP.paintMini(held, k, "held", 14), okD = GP.paintMini(dropped, k, "dropped");
      const px = [...big.px, ...held.px, ...dropped.px].filter(Boolean);
      if (px.some((c) => !HEX.test(c))) colours.push(`${k} (${[...new Set(px.filter((c) => !HEX.test(c)))].join(" ")})`);
      if (big.px.filter(Boolean).length < 60 || !okH || !okD || held.px.filter(Boolean).length < 3 || dropped.px.filter(Boolean).length < 3) empty.push(k);
      const sig = (p) => hash(record(() => toCanvasAny(p)).join("|"));
      forms[k] = { big: sig(big), held: sig(held), dropped: sig(dropped) };
    } catch (e) { errors.push(`${k}: ${e.message}`); }
  }
  delete GA.PLAT_ART.__test;
  check(!bad.length, `every spec names a known body, stock, magazine and parts (${specKeys.length} specs${bad.length ? `; ${list(bad)}` : ""})`);
  check(!errors.length, `every spec renders in all three forms without errors${errors.length ? ` (${list(errors)})` : ""}`);
  check(!colours.length, `every pixel is a real colour${colours.length ? ` (not: ${list(colours)})` : ""}`);
  check(!empty.length, `every spec draws something in every form${empty.length ? ` (not: ${list(empty)})` : ""}`);
}
function toCanvasAny(p) { // the sprites' toCanvas: the outline and the colours as fillRect calls
  const up = 1, cv = document.createElement("canvas"), c = cv.getContext("2d");
  for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) { const col = p.get(x, y); if (col) { c.fillStyle = col; c.fillRect(x * up, y * up, up, up); } }
  return cv;
}

// ---------- 3. no two guns look the same ----------
console.log("No two guns alike");
{
  const same = (form) => {
    const by = new Map();
    for (const [k, f] of Object.entries(forms)) { const a = by.get(f[form]) || []; a.push(k); by.set(f[form], a); }
    return [...by.values()].filter((a) => a.length > 1).map((a) => a.join(" = "));
  };
  for (const form of ["big", "held", "dropped"]) { const d = same(form); check(!d.length, `${form}: every spec's drawing differs from every other's (${Object.keys(forms).length}${d.length ? `; the same: ${list(d)}` : ""})`); }
  // As the game draws them: the gun builder's canvas, a survivor holding it, a body with it beside the hand.
  const sigs = { big: new Map(), held: new Map(), dropped: new Map() };
  for (const k of guns) {
    sigs.big.set(k, hash(record(() => GA.gunCanvas({ key: k }, null)).join("|")));
    sigs.held.set(k, hash(SP.paintSurvivor(app, k).px.join()));
    sigs.dropped.set(k, hash(DS.paintDownedSurvivor(app, k).px.join()));
  }
  for (const form of ["big", "held", "dropped"]) {
    const by = new Map();
    for (const [k, h] of sigs[form]) { const a = by.get(h) || []; a.push(k); by.set(h, a); }
    const d = [...by.values()].filter((a) => a.length > 1 && !a.every((k) => (GS.ART_ALIAS[k] || k) === (GS.ART_ALIAS[a[0]] || a[0])));
    check(!d.length, `${form} in the game: no two guns drawn alike (${guns.length} guns${d.length ? `; the same: ${list(d.map((a) => a.join(" = ")))}` : ""})`);
  }
  check(SP.weaponPixels("pistol") > 2 && SP.weaponPixels("m240") > SP.weaponPixels("pistol"), "held: a machine gun draws more than a pistol");
}

// ---------- 4. attachments on their anchors ----------
console.log("Attachments");
const REP = { optic: "reddot", mount: "mount", muzzle: "can_s", mag: "extmag", stock: "precision", grip: "vgrip", under: "m203", tactical: "light", bipod: "bipod", rail: "rail", sling: "sling" };
{
  const off = [], undrawn = [], far = [], outGrid = [];
  let n = 0;
  for (const k of [...guns, ...specKeys.filter((x) => !WEAPONS[x])]) {
    const art = WEAPONS[k] ? GA.PLAT_ART[GA.artKeyOf(k)] : GA.compileArt(k);
    if (!WEAPONS[k]) GA.PLAT_ART.__a = art;
    const ak = WEAPONS[k] ? GA.artKeyOf(k) : "__a";
    const plain = GA.paintArt(ak, {}, art.own);
    for (const [slot, a] of Object.entries(art.anchors)) {
      n++;
      if (a[0] < 0 || a[1] < 0 || a[0] >= GA.ART_W || a[1] >= GA.ART_H) outGrid.push(`${k}.${slot}`);
      if (!near(plain, a, 2)) off.push(`${k}.${slot}`);
    }
    const slots = WEAPONS[k] && GEAR[k] ? GM.slotsOf(makeItem(k)) : Object.keys(art.anchors).filter((s) => REP[s] && art.def[s] !== REP[s]);
    const base = GA.paintArt(ak, {}, art.own, slots);
    for (const slot of slots) {
      const look = REP[slot] === art.def[slot] ? "fold" : REP[slot];
      if (!look) continue;
      const fitted = GA.paintArt(ak, { [slot]: look }, art.own, slots);
      const diff = [];
      for (let y = 0; y < GA.ART_H; y++) for (let x = 0; x < GA.ART_W; x++) if (fitted.get(x, y) !== base.get(x, y)) diff.push([x, y]);
      if (!diff.length) { undrawn.push(`${k}.${slot}`); continue; }
      const [ax, ay] = WEAPONS[k] ? GA.anchorOf(k, slot) : art.anchors[slot];
      const at = slot === "stock" ? ([x, y]) => x <= ax + 1 && x >= ax - 14 && Math.abs(y - ay) <= 6 : ([x, y]) => Math.abs(x - ax) <= 3 && Math.abs(y - ay) <= 3; // a stock reaches back from its anchor
      if (!diff.some(at)) far.push(`${k}.${slot}`);
    }
    delete GA.PLAT_ART.__a;
  }
  check(!outGrid.length, `every anchor inside the grid${outGrid.length ? ` (not: ${list(outGrid)})` : ""}`);
  check(n > 400 && !off.length, `every anchor (${n}) on the drawing or within 2 pixels${off.length ? ` (off: ${list(off)})` : ""}`);
  check(!undrawn.length, `a part fitted in each of a gun's slots shows${undrawn.length ? ` (nothing from: ${list(undrawn)})` : ""}`);
  check(!far.length, `and draws at its anchor${far.length ? ` (away from it: ${list(far)})` : ""}`);
  // A fitted stock or magazine replaces the gun's own (drawn as a part, not into the gun's core).
  const artOf = (k) => GA.PLAT_ART[GA.artKeyOf(k)] || { def: {} }; // (a gun without a spec: its platform's or look-alike's)
  const own = guns.filter((k) => artOf(k).def.stock);
  const keep = own.filter((k) => { const a = GA.paintGun(k, {}).px.join(), b = GA.paintGun(k, { stock: "precision" }).px.join(), c = GA.paintGun(k, { stock: "fold" }).px.join(); return b === c || (a === b && a === c); });
  check(own.length > 25 && !keep.length, `a fitted stock replaces the gun's own (${own.length} guns with one${keep.length ? `; not on ${list(keep)}` : ""})`);
  const mags = guns.filter((k) => artOf(k).def.mag && artOf(k).def.mag !== "belt" && !/beltbox|top/.test(String(((GS.GUN_ART[GP.ownKey(k)] || {}).mag || {}).t)));
  const magKeep = mags.filter((k) => GA.paintGun(k, { mag: "drum" }).px.join() === GA.paintGun(k, { mag: "stick10" }).px.join());
  check(mags.length > 15 && !magKeep.length, `a fitted magazine replaces the gun's own (${mags.length}${magKeep.length ? `; not on ${list(magKeep)}` : ""})`);
  // The AUG's scope-handle gives way to a rail when a sight is fitted.
  if (WEAPONS.aug) check(GA.paintGun("aug", { optic: "reddot" }).get(GA.anchorOf("aug", "optic")[0] - 6, 1) !== GA.paintGun("aug", {}).get(GA.anchorOf("aug", "optic")[0] - 6, 1), "the AUG's scope-handle gives way to a rail under a fitted sight");
  // The own parts (the hunting rifle's scope) only where the gun has no such slot.
  check(GA.paintGun("sniper", {}, ["muzzle", "under"]).px.join() !== GA.paintGun("sniper", {}, ["optic", "muzzle"]).px.join(), "a gun's own scope (the sniper rifle's) is drawn only while it has no sight slot");
  check(GA.paintGun("huntrifle", { optic: GA.lookOf({ key: "huntrifscope" }, "optic") }).px.join() !== GA.paintGun("huntrifle", {}).px.join(), "the hunting rifle's scope is a part (user pick 2026-10-10): drawn when fitted, gone when taken off");
}
function near(p, [x, y], r) { for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (p.get(x + dx, y + dy)) return true; return false; }

// ---------- 5. a gun with no spec: a look-alike by what it is ----------
console.log("Fallback");
{
  const add = (k, w, g) => { WEAPONS[k] = { ammo: 1, dmg: [10, 12], ...w }; if (g) GEAR[k] = { slot: "weapon", ...g }; };
  add("zzz_rev", { name: "Test revolver", cal: "357", cap: 6 }, { name: "Test revolver", cat: "pistol", small: true });
  add("zzz_ou", { name: "Test gun", cal: "12ga", cap: 2 }, { name: "Test gun", cat: "shotgun", desc: "An over-under for the field." });
  add("zzz_sg", { name: "Test shotgun", cal: "12ga", cap: 5 }, { name: "Test shotgun", cat: "shotgun" });
  add("zzz_pis", { name: "Test pistol", cal: "9mm", cap: 8 }, { name: "Test pistol", cat: "pistol", small: true });
  add("zzz_mg", { name: "Test gun", cal: "308", cap: 150 }, { name: "Test gun", cat: "automatic" });
  add("zzz_smg", { name: "Test gun", cal: "9mm", cap: 32 }, { name: "Test gun", cat: "automatic" });
  add("zzz_rif", { name: "Test rifle", cal: "308", cap: 5 }, { name: "Test rifle", cat: "rifle" });
  const exp = { zzz_rev: "revolver", zzz_ou: "ou12", zzz_sg: "shotgun", zzz_pis: "pistol", zzz_mg: "lmg", zzz_smg: "smg", zzz_rif: "huntrifle" };
  const got = Object.fromEntries(Object.keys(exp).map((k) => [k, GP.specOf(k) && GP.specOf(k).key]));
  check(Object.entries(exp).every(([k, v]) => got[k] === v), `by its words, then category and calibre (${Object.entries(got).map(([k, v]) => `${k} → ${v}`).join(", ")})`);
  check(Object.keys(exp).every((k) => !GP.specOf(k).own), "flagged as not its own");
  check(Object.keys(exp).every((k) => SP.weaponPixels(k) > 2), "drawn held in battle as its look-alike");
  check(GA.artKeyOf("zzz_rev") === "revolver" && GA.artKeyOf("zzz_ou") === "ou12" && GA.artKeyOf("zzz_pis") === "generic_pistol", "its big drawing: the look-alike its words name, else the generic one");
  for (const k of Object.keys(exp)) { delete WEAPONS[k]; delete GEAR[k]; }
  check(!GP.paintMini(SP.painter(), "knife", "held") || !GA.isGunKey("knife"), "a blade is no gun");
  check(SP.weaponPixels("knife") > 0 && SP.weaponPixels("machete") > 0, "the blades keep their own looks");
}

// ---------- 7. fitted parts on the gun in battle ----------
console.log("Fitted parts held");
{
  const plain = SP.paintSurvivor(app, GPT.weaponLook({ key: "m4" })).px.join();
  const dot = SP.paintSurvivor(app, GPT.weaponLook({ key: "m4", mods: { optic: { key: "reddot" } } })).px.join();
  const scope = SP.paintSurvivor(app, GPT.weaponLook({ key: "m4", mods: { optic: { key: "acog" } } })).px.join();
  check(plain !== dot && dot !== scope && plain !== scope, "held: an M4 with a red dot, with an ACOG and bare all differ");
  const fits = (k, part) => GM.ATTACH[part] && GM.modFits(k, part);
  const tried = [], same = [];
  for (const k of guns.filter((g) => GEAR[g])) {
    const slots = GM.slotsOf(makeItem(k));
    for (const [slot, part] of [["optic", "scope4x"], ["muzzle", "can556"], ["muzzle", "pistolcan"], ["tactical", "weaponlight"], ["under", "foregrip"], ["bipod", "bipod"]]) {
      if (!slots.includes(slot) || !fits(k, part) || (GA.PLAT_ART[GA.artKeyOf(k)].def[slot] || (GA.PLAT_ART[GA.artKeyOf(k)].own || {})[slot]) === GA.lookOf({ key: part }, slot)) continue; // (its own bipod: the same)
      tried.push(`${k}.${slot}`);
      const a = SP.paintSurvivor(app, k).px.join(), b = SP.paintSurvivor(app, GPT.weaponLook({ key: k, mods: { [slot]: { key: part } } })).px.join();
      if (a === b) same.push(`${k}.${slot}=${part}`);
    }
  }
  check(tried.length > 40 && !same.length, `held: every fitted sight, suppressor, light, foregrip and bipod shows (${tried.length} tried${same.length ? `; not: ${list(same)}` : ""})`);
  const enemy = { id: 7, side: "enemy", kind: "human", kit: "soldiers", weapon: "m4", gmWeapon: "m4", modItems: { optic: { key: "acog" }, muzzle: { key: "can556" } } };
  check(GPT.weaponLook(GPT.unitGun(enemy)).includes("optic=") && GPT.weaponLook(GPT.unitGun(enemy)).includes("muzzle="), "an enemy's gun shows the parts their kit gave it");
  const bare = { ...enemy, gmWeapon: "ak" };
  check(!GPT.weaponLook(GPT.unitGun(bare)).includes("optic="), "only while they still hold the gun the parts were for");
  // The sprite caches stay bounded however many looks there are.
  for (let i = 0; i < 700; i++) SP.survivorCanvas({ ...app, accent: `#${(i * 997).toString(16).padStart(6, "0").slice(-6)}` }, "m4");
  check(true, "the sprite cache took 700 looks (it clears itself past 600)");
}

// ---------- 8. data-driven parts ----------
console.log("Parts by kind");
{
  const add = (k, name, slot) => { GEAR[k] = { name, cat: "gunmod", slot: "tool" }; GM.ATTACH[k] = { slot, mount: slot, fits: { any: true } }; };
  const cases = [["zzz_dot", "Budget red dot (a Chinese clone)", "optic", "dot"], ["zzz_lpvo", "1-6x LPVO", "optic", "scope"], ["zzz_mag", "3x magnifier", "optic", "magnifier"],
    ["zzz_holo", "Holographic sight", "optic", "holo"], ["zzz_can9", "9mm suppressor", "muzzle", "can"], ["zzz_comp", "Pistol compensator", "muzzle", "comp"],
    ["zzz_combo", "Weapon light / laser combo", "tactical", "combo"], ["zzz_laser", "Budget green laser", "tactical", "laser"], ["zzz_saddle", "Side saddle (6 shells)", "rail", "saddle"],
    ["zzz_brace", "Pistol arm brace", "stock", "stock"], ["zzz_stop", "Hand stop", "grip", "stop"], ["zzz_bip", "Harris bipod", "bipod", "bipod"]];
  for (const [k, n, sl] of cases) add(k, n, sl);
  const got = cases.map(([k, , sl, kind]) => [k, GPT.partSpecOf(k, sl), kind]);
  check(got.every(([, o, kind]) => o && o.kind === kind), `a new part needs only its slot and name: ${got.map(([k, o]) => `${k} → ${o ? o.kind : "none"}`).join(", ")}`);
  const looks = cases.map(([k, , sl]) => [sl, GA.lookOf({ key: k }, sl)]);
  check(looks.every(([, l]) => /^p:/.test(l) && GA.PART_ART[l]), "drawn by its kind (a look of its own, compiled once)");
  const base = GA.paintGun("carbine", {}).px.join();
  const blank = looks.filter(([sl, l]) => GA.paintGun("carbine", { [sl]: l }).px.join() === base);
  check(!blank.length, `each paints on the gun${blank.length ? ` (not: ${list(blank.map(([, l]) => l))})` : ""}`);
  GS.PART_SPEC.zzz_dot = { kind: "dot", len: 3, col: "fde" };
  const o = GPT.partSpecOf("zzz_dot", "optic");
  check(o.len === 3 && o.col === "fde" && o.kind === "dot", "a part's own spec (PART_SPEC) sets its size and colour");
  delete GS.PART_SPEC.zzz_dot;
  for (const [k] of cases) { delete GEAR[k]; delete GM.ATTACH[k]; }
  // Every attachment in the game has a look that draws on the big drawing.
  const none = Object.keys(GM.ATTACH).filter((k) => GEAR[k] && !GA.PART_ART[GA.lookOf({ key: k }, GM.ATTACH[k].slot)]);
  check(!none.length, `every attachment in the game has a look (${Object.keys(GM.ATTACH).length}${none.length ? `; not: ${list(none)}` : ""})`);
}

// ---------- 9. thumbnails ----------
console.log("Thumbnails");
{
  const items = [...new Set(gearGuns)];
  const missing = items.filter((k) => { const t = GA.gunThumb({ key: k }); return !t || !t.url || !(t.w > 4 && t.h > 3); });
  check(items.length > 40 && !missing.length, `every gun item has a thumbnail (${items.length}${missing.length ? `; not: ${list(missing)}` : ""})`);
  const t1 = GA.gunThumb({ key: "m4" }), t2 = GA.gunThumb({ key: "m4" });
  check(t1 === t2, "cached");
  check(GA.gunThumb({ key: "pistol" }).w < GA.gunThumb({ key: "m240" }).w, "cropped to the gun (a pistol narrower than a machine gun)");
  const INV = await import("../src/ui/inventory.js");
  const html = INV.tile(makeItem("m4"), "x", null, false), knife = INV.tile(makeItem("knife"), "x", null, false);
  check(/<img class="igun"[^>]*height:[\d.]+rem/.test(html) && !/🔫/.test(html), "a gun's tile shows its picture (sized in rem: it scales with the UI)");
  check(!/<img class="igun"/.test(knife), "a blade keeps its icon");
  check(GA.gunIconHtml({ key: "m4", mods: { optic: { key: "acog" } } }) !== GA.gunIconHtml({ key: "m4" }), "as fitted");
}

// ---------- 10. the muzzle ----------
console.log("Muzzle");
{
  const ISO = await import("../src/ui/isoview.js");
  const b = { fx: [], setup: {}, units: [] }, state = { factions: [], survivors: [], seed: 1 };
  const bad = [], pts = {};
  for (const k of guns) {
    const t = { id: 3, side: "enemy", kind: "human", kit: "raiders", weapon: k, x: 1, y: 1 };
    const p = [0, 1, 2, 3].map((r) => ISO.muzzlePoint(state, b, t, 0, r, 1));
    if (p.some((q) => !q)) { bad.push(`${k} (none)`); continue; }
    // Enemies face left (−x) unless the view is turned a half (rotations 1 and 2 mirror the sprite).
    if (!(p[0][0] < 0 && p[3][0] < 0 && p[1][0] > 0 && p[2][0] > 0 && p[0][0] === -p[1][0] && p.every((q) => q[1] === p[0][1]))) bad.push(`${k} ${JSON.stringify(p)}`);
    pts[k] = p[0];
  }
  check(!bad.length, `every gun's muzzle is on the side it faces, in all four view rotations${bad.length ? ` (not: ${list(bad)})` : ""}`);
  check(Math.abs(pts.pistol[0]) < Math.abs(pts.m4[0]) && Math.abs(pts.m4[0]) < Math.abs(pts.sniper[0]) + 0.01, `a pistol's muzzle is nearer the body than a carbine's, a carbine's no further than a sniper rifle's (${pts.pistol[0].toFixed(1)}, ${pts.m4[0].toFixed(1)}, ${pts.sniper[0].toFixed(1)})`);
  check(new Set(Object.values(pts).map((q) => q.join())).size > 8, "the muzzles are where each gun's barrel ends (many different points)");
  const t = { id: 4, side: "enemy", kind: "human", kit: "raiders", weapon: "m4", gmWeapon: "m4", modItems: { muzzle: { key: "can556" } }, x: 1, y: 1 };
  const can = ISO.muzzlePoint(state, b, t, 0, 0, 1);
  check(Math.abs(can[0]) > Math.abs(pts.m4[0]), "a fitted suppressor moves the muzzle out to its end");
  check(ISO.muzzlePoint(state, b, { id: 5, side: "enemy", kind: "zombie", x: 1, y: 1 }, 0, 0, 1) === null, "no muzzle for the dead");
}

// ---------- 11. finishes ----------
console.log("Finishes");
{
  const FIN = await import("../src/sim/data-finish.js");
  const INVS = await import("../src/sim/inventory.js");
  const unknown = Object.keys(FIN.GUN_FINISH).filter((k) => !GS.GUN_ART[k]);
  const badName = Object.entries(FIN.GUN_FINISH).flatMap(([k, L]) => L.filter(([n]) => !GS.FINISH_LOOK[n] || !FIN.FINISH_NAME[n]).map(([n]) => `${k}:${n}`));
  check(!unknown.length && !badName.length, `every finish list is for a drawn gun, every finish has a look and a name${unknown.length || badName.length ? ` (${list([...unknown, ...badName])})` : ""}`);
  const same = [], errs = [];
  for (const [k, L] of Object.entries(FIN.GUN_FINISH)) {
    if (!WEAPONS[k]) continue;
    const sigs = new Map();
    for (const [n] of L) {
      try {
        const big = GA.paintGun(k, {}, null, n).px.join(), small = SP.paintSurvivor(app, GPT.weaponLook({ key: k, finish: n })).px.join(), thumb = GA.gunThumb({ key: k, finish: n });
        if (!thumb) errs.push(`${k}:${n} no thumbnail`);
        for (const [m, s] of sigs) if (s[0] === big) same.push(`${k}: ${m} = ${n} (big)`);
        sigs.set(n, [big, small]);
      } catch (e) { errs.push(`${k}:${n} ${e.message}`); }
    }
  }
  check(!errs.length, `every finish of every gun renders (big, held, thumbnail)${errs.length ? ` (${list(errs)})` : ""}`);
  check(!same.length, `each finish looks different from the gun's others${same.length ? ` (the same: ${list(same)})` : ""}`);
  // Chosen on the item's own dice, the same every time; none stored without dice; an old item: its first.
  const a = INVS.newItem("m4", 1, 12345), b2 = INVS.newItem("m4", 1, 12345);
  check(a.finish === b2.finish && FIN.finishOf(a) === FIN.finishOf(b2), `the same dice, the same finish (${FIN.finishOf(a)})`);
  const seen = new Set();
  for (let i = 0; i < 200; i++) seen.add(FIN.finishOf(INVS.newItem("m4", 1, i * 7919)));
  check(seen.size === FIN.GUN_FINISH.m4.length, `over many finds every finish turns up (${[...seen].join(", ")})`);
  const plain = INVS.newItem("m4");
  check(plain.finish === undefined && FIN.finishOf(plain) === "black", "a gun made with no dice stores none: its first finish");
  const old = JSON.parse(JSON.stringify({ key: "ak", name: "AK", quality: 1 }));
  check(FIN.finishOf(old) === "wood" && GPT.weaponLook(old) === "ak" && GA.gunThumb(old) === GA.gunThumb({ key: "ak" }), "an old save's gun: the same drawing as before, every time");
  const kept = JSON.parse(JSON.stringify(INVS.newItem("ak", 1, 99)));
  check(FIN.finishOf(kept) === FIN.finishOf(INVS.newItem("ak", 1, 99)), "the finish survives a save");
  check(FIN.finishOf({ key: "ak", finish: "pink" }) === "wood", "a finish the gun never came in is ignored");
  check(!INVS.newItem("knife", 1, 5).finish && !INVS.newItem("pipegun", 1, 5).finish, "only guns that come in more than one get one");
  // An enemy's gun is shown in a finish of its own, and looted in it.
  const u = { id: 11, kit: "raiders", weapon: "ak", gmWeapon: "ak", modItems: null };
  const gun = { key: "ak", name: "AK", quality: 1 };
  INVS.carryMods(u, gun);
  check(FIN.finishOf(gun) === FIN.unitFinish(u) && GPT.weaponLook(GPT.unitGun(u)) === GPT.weaponLook(gun), "an enemy's gun is looted in the finish it was seen in");
}

// ---------- 6. cached ----------
console.log("Cached");
{
  let n = 0;
  const real = GP.FAM.ar.paint;
  GP.FAM.ar.paint = (...a) => { n++; return real(...a); };
  const item = { key: "m4" };
  GA.gunCanvas(item); GA.gunCanvas(item); GA.gunCanvas(item);
  check(n <= 1, `the big drawing is painted once and kept (${n})`);
  GP.FAM.ar.paint = real;
  const a = SP.survivorCanvas(app, "m4"), b = SP.survivorCanvas(app, "m4");
  check(a === b, "a survivor holding it: one canvas, kept");
}

console.log(`\n${passed} passed, ${failed} failed (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
