// Every item's own icon (ui/itemart.js, the drawings in ui/itemart/*.js; user 2026-10-16: "All items should have their
// own unique sprites shown in the inventory"), headless on the painter's pixels:
// - every item that is not a gun (GEAR) and every supply (SUPPLIES) has its drawing; no drawing for a key that is not
//   an item; no key drawn by two families;
// - every drawing renders without errors, in colours (#rrggbb), and is big enough to read (at least 24 pixels);
// - no two items look the same: any two pictures differ in at least MIN_DIFF pixels (guns are checked by
//   tools/gunarttest.js);
// - the inventory shows them: a tile, a supply tile and an armory card carry the picture, not the emoji.
// Usage: node tools/itemarttest.js [--family name] (only that family's drawings: missing, failing and look-alikes)
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ data: new Uint8ClampedArray(4) })), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document = globalThis.document || { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, toDataURL: () => "data:image/png;base64,AAAA" }) };
const store = {};
globalThis.localStorage = globalThis.localStorage || { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };

const { GEAR, SUPPLIES } = await import("../src/sim/data.js");
const { isGunKey } = await import("../src/ui/gunpaint.js");
const IA = await import("../src/ui/itemart.js");

const MIN_DIFF = 6;
const fi = process.argv.indexOf("--family");
const only = fi > 0 ? process.argv[fi + 1] : null;
if (only && !IA.FAMILIES[only]) { console.log(`No family "${only}": ${Object.keys(IA.FAMILIES).join(", ")}`); process.exit(1); }

let pass = 0, fail = 0;
const check = (ok, what, detail = "") => { if (ok) pass++; else fail++; if (!ok || !only) console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${!ok && detail ? `\n       ${detail}` : ""}`); return ok; };
const list = (a, n = 40) => `${a.slice(0, n).join(", ")}${a.length > n ? ` … (${a.length})` : ""}`;

// Who draws what: [kind, key, family].
const drawn = [];
const famOf = {};
for (const [name, f] of Object.entries(IA.FAMILIES)) {
  for (const [kind, t] of [["gear", f.GEAR_ART || {}], ["supply", f.SUPPLY_ART || {}]]) {
    for (const k of Object.keys(t)) {
      const id = `${kind}:${k}`;
      if (famOf[id]) famOf[id] += `+${name}`; else famOf[id] = name;
      drawn.push([kind, k, name]);
    }
  }
}
const mine = (id) => !only || String(famOf[id] || "").split("+").includes(only);

console.log("Coverage");
const gearKeys = Object.keys(GEAR).filter((k) => !isGunKey(k));
const supKeys = Object.keys(SUPPLIES);
if (!only) {
  const missG = gearKeys.filter((k) => !IA.hasItemArt(k, "gear"));
  const missS = supKeys.filter((k) => !IA.hasItemArt(k, "supply"));
  check(!missG.length, `every item that is not a gun has its drawing (${gearKeys.length})`, list(missG));
  check(!missS.length, `every supply has its drawing (${supKeys.length})`, list(missS));
}
const strayG = drawn.filter(([kind, k]) => kind === "gear" && (!GEAR[k] || isGunKey(k))).map(([, k, f]) => `${f}:${k}`);
const strayS = drawn.filter(([kind, k]) => kind === "supply" && !SUPPLIES[k]).map(([, k, f]) => `${f}:${k}`);
check(!strayG.filter((s) => mine(`gear:${s.split(":")[1]}`)).length, "no drawing for a key that is not a non-gun item", list(strayG));
check(!strayS.filter((s) => mine(`supply:${s.split(":")[1]}`)).length, "no drawing for a key that is not a supply", list(strayS));
const twice = Object.entries(famOf).filter(([id, f]) => f.includes("+") && mine(id)).map(([id, f]) => `${id} (${f})`);
check(!twice.length, "no key drawn by two families", list(twice));

console.log("Drawings");
const pics = [];
const broken = [], badCol = [], small = [];
for (const [kind, k] of drawn) {
  const id = `${kind}:${k}`;
  const q = IA.itemPixels(k, kind);
  if (!q) { if (mine(id)) broken.push(id); continue; }
  const cols = new Set(q.px.filter(Boolean));
  if ([...cols].some((c) => !/^#[0-9a-f]{6}$/i.test(c)) && mine(id)) badCol.push(`${id} (${[...cols].filter((c) => !/^#[0-9a-f]{6}$/i.test(c)).join(" ")})`);
  const n = q.px.filter(Boolean).length;
  if (n < 24 && mine(id)) small.push(`${id} (${n})`);
  pics.push({ id, px: q.px });
}
check(!broken.length, `every drawing renders (${drawn.length})`, list(broken));
check(!badCol.length, "every colour is #rrggbb", list(badCol));
check(!small.length, "every drawing is big enough to read (24+ pixels)", list(small));

console.log("Unique");
const alike = [];
for (let i = 0; i < pics.length; i++) {
  const a = pics[i].px;
  for (let j = i + 1; j < pics.length; j++) {
    if (!mine(pics[i].id) && !mine(pics[j].id)) continue;
    const b = pics[j].px;
    let d = 0;
    for (let n = 0; n < a.length && d < MIN_DIFF; n++) if (a[n] !== b[n]) d++;
    if (d < MIN_DIFF) alike.push(`${pics[i].id} ~ ${pics[j].id} (${d})`);
  }
}
check(!alike.length, `no two items look the same (at least ${MIN_DIFF} pixels apart)`, list(alike, 60));

if (!only) {
  console.log("In the inventory");
  const { makeItem } = await import("../src/sim/crafting.js");
  const { tile } = await import("../src/ui/inventory.js");
  const { itemPic } = await import("../src/ui/armoryview.js");
  const html = tile(makeItem("crowbar"), "pack:0", null);
  check(/class="iart"/.test(html), "an item's tile shows its drawing");
  check(/igun/.test(tile(makeItem("pistol"), "pack:0", null)), "a gun's tile still shows the gun");
  check(/iart/.test(itemPic(makeItem("goldring"), 2.4)), "an armory card shows the drawing");
  check(/iart/.test(itemPic(makeItem("knife"), 1.1)), "an armory row shows the drawing");
  const { supplyIcon } = await import("../src/ui/stackmove.js");
  check(/iart/.test(supplyIcon("scrap")), "a supply's icon is its drawing");
  const a = IA.itemArtURL("crowbar"), b = IA.itemArtURL("crowbar");
  check(a && a === b, "the pictures are cached");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
