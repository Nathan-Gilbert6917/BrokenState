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
  check(GA.paintGun("huntrifle", {}, ["muzzle", "under"]).px.join() !== GA.paintGun("huntrifle", {}, ["optic", "muzzle"]).px.join(), "the hunting rifle's own scope is drawn only while it has no sight slot");
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
