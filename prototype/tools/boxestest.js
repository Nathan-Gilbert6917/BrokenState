// Lock boxes and cases (src/sim/boxes.js, data-boxes.js; the window src/ui/boxview.js; 2026-10-19 user request): what a
// box holds (valuables, a gun, rounds, gear or nothing, each kind at its odds), weight as the only clue (the box's own
// plus everything inside), nothing about its contents shown before it is opened (tooltip, armory stat, worth), the lock
// and its tools (a cheap lock to picks, a blade, a pry bar or a power tool; a steel one to a pry bar or a power tool),
// opened from the right-click menu out of a fight (free, the tool carried or in the same storage) into a window of what
// is inside (Take, Take all), forced in a raid for actions and Heat, found at sites and in raid containers on their own
// dice, kept by a save.
// Usage: node tools/boxestest.js [seed]
globalThis.window = globalThis.window || {};
const silent = () => new Proxy(() => {}, { get: (t, k) => (k === "getImageData" ? () => ({ data: new Uint8ClampedArray(4) }) : k === "createImageData" ? (w, h) => ({ data: new Uint8ClampedArray(4 * w * h), width: w, height: h }) : silent()), apply: () => silent() });
globalThis.document = globalThis.document || { addEventListener() {}, getElementById() { return null; }, head: null, createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => silent(), toDataURL: () => "data:image/png;base64,AAAA" }) };
globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };
const { GEAR } = await import("../src/sim/data.js");
const { createWorld, makeSurvivor, hub } = await import("../src/sim/world.js");
const { newItem, itemLoad, itemAt } = await import("../src/sim/inventory.js");
const { itemValue, worthTier } = await import("../src/sim/valuation.js");
const { hash01 } = await import("../src/sim/skills.js");
const { serializeState, deserializeState } = await import("../src/sim/save.js");
const B = await import("../src/sim/boxes.js");
const { BOX_GEAR, BOX_HOLDS, BOX_FINDS, BOX_HELP } = await import("../src/sim/data-boxes.js");
const { openItemMenu, itemMenuHtml, ITEMMENU_ACTIONS } = await import("../src/ui/itemmenu.js");
const { itemTip } = await import("../src/ui/inventory.js");
const { statBits } = await import("../src/ui/armoryview.js");
const { boxViewHtml, BOX_ACTIONS, openBoxWindow } = await import("../src/ui/boxview.js");
const { hasItemArt } = await import("../src/ui/itemart.js");
const { ITEM_TAGS } = await import("../src/sim/loot.js");
const { caseTargets, caseOdds } = await import("../src/sim/locks.js");

const seed = Number(process.argv[2] || 5);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else fails++; console.log(`  ${ok ? "ok  " : "FAIL"} ${msg}`); return ok; };
const KINDS = Object.keys(BOX_GEAR);
const ALL = [...KINDS, "riflecase", "pistolcase"];
const fresh = () => { const st = createWorld({ seed, factionCount: 4 }); st.survivors = []; st.parties = []; return st; };
function person(state) {
  const s = makeSurvivor(state);
  s.traits = []; s.health = 100;
  for (const k of Object.keys(s.gear)) s.gear[k] = null;
  s.pockets = s.pockets.map(() => null);
  s.location = { kind: "base", baseId: hub(state).id };
  state.survivors.push(s);
  return s;
}
const roll = (...pre) => (...k) => hash01(seed, ...pre, ...k);

console.log("The boxes");
check(ALL.every((k) => GEAR[k] && GEAR[k].box && hasItemArt(k) && ITEM_TAGS[k] && GEAR[k].weight > 0 && GEAR[k].desc), "every box and case is an item with a lock, a contents table, an icon, theme tags, a weight and a description");
check(KINDS.every((k) => new RegExp(`${GEAR[k].weight} kg`).test(GEAR[k].desc)), "each new box's description says what it weighs empty");
check(Object.values(BOX_HOLDS).every((T) => Object.values(T.items || {}).length === 0 || Object.keys(T.items).every((k) => GEAR[k])) && Object.values(BOX_HOLDS).every((T) => Object.keys(T.ammo || {}).every((k) => k.startsWith("a_"))), "every thing a box can hold is a real item or round");
check(/weight/.test(BOX_HELP) && /pry bar/.test(BOX_HELP), "the Help topic explains the weight clue and the tools");

console.log("What is inside, and the weight");
for (const k of ALL) {
  const what = {}, kg = { empty: [], full: [] };
  let locked = 0;
  for (let i = 0; i < 600; i++) {
    const b = B.makeBox(k, roll("mk", k, i), k === "riflecase" ? "farm" : "town");
    const c = B.rollBoxContents(roll("mk", k, i), k, k === "riflecase" ? "farm" : "town");
    what[c.what] = (what[c.what] || 0) + 1;
    if (b.locked) locked++;
    (B.boxHolds(b) ? kg.full : kg.empty).push(itemLoad(b));
  }
  const T = BOX_HOLDS[GEAR[k].box.holds];
  const tot = Object.values(T.kinds).reduce((a, w) => a + w, 0);
  const ok = Object.entries(T.kinds).every(([w, n]) => Math.abs((what[w] || 0) / 600 - n / tot) < 0.07);
  check(ok && Math.abs(locked / 600 - GEAR[k].box.locked) < 0.07, `${GEAR[k].name}: holds ${Object.entries(what).map(([w, n]) => `${w} ${Math.round((n / 600) * 100)}%`).join(", ")}; ${Math.round((locked / 600) * 100)}% locked`);
  check(kg.empty.every((w) => Math.abs(w - GEAR[k].weight) < 1e-9) && kg.full.every((w) => w > GEAR[k].weight), `  an empty one weighs its own ${GEAR[k].weight} kg, a full one more (median ${kg.full.sort((a, b) => a - b)[kg.full.length >> 1]?.toFixed(2)} kg)`);
}
{
  const gunCases = [];
  for (let i = 0; i < 300; i++) gunCases.push(B.makeBox("riflecase", roll("rc", i), "farm"));
  const withGun = gunCases.filter((b) => (b.contents || []).some((c) => c && GEAR[c.key].slot === "weapon"));
  const without = gunCases.filter((b) => !withGun.includes(b));
  const heavy = (b) => itemLoad(b) > GEAR.riflecase.weight + 1.5;
  check(withGun.filter(heavy).length >= withGun.length * 0.95 && without.filter(heavy).length < without.length * 0.2, `a rifle case 1.5 kg over its own weight most likely holds a gun (${withGun.filter(heavy).length} of ${withGun.length} with one are; ${without.filter(heavy).length} of ${without.length} without)`);
  check(gunCases.some((b) => (b.contents || []).some((c) => c && ["fishrod", "camera", "spotscope", "binoculars"].includes(c.key))) && gunCases.some((b) => !B.boxHolds(b)), "a rifle case sometimes holds a fishing rod, a camera or optics, sometimes nothing");
}

console.log("Sealed until opened");
{
  const st = fresh(), h = hub(st), s = person(st);
  let b = null;
  for (let i = 0; i < 200 && !b; i++) { const x = B.makeBox("firebox", roll("fb", i), "town"); if (x.locked && B.boxHolds(x)) b = x; }
  h.armory.push(b);
  const loc = `armory:${h.id}:list:${h.armory.length - 1}`;
  const names = b.contents.map((c) => c.name);
  const tipTxt = itemTip(b, s);
  check(B.isSealed(b) && names.every((n) => !tipTxt.includes(n)) && /unknown until it is opened/.test(tipTxt) && /6 kg empty/.test(tipTxt), `its tooltip gives its weight and lock, not what is inside ("${tipTxt.slice(0, 90)}…")`);
  check(statBits(b).some(([t]) => t === "locked") && !statBits(b).some(([t]) => /in$/.test(t)), "the armory card says locked, not how many things are in it");
  check(Math.abs(itemValue(b) - itemValue({ ...b, contents: [] })) < 1e-9, `sealed it is worth the box alone (${worthTier(b)})`);
  // The right-click menu: no tool here, the row greyed out with the lock's tools.
  const ui = {};
  const rows = () => { ui.imenu = null; openItemMenu(st, ui, { loc, sid: s.id }, 10, 10); return [...itemMenuHtml(st, ui).matchAll(/<button class="imrow( off)?[^"]*" data-action="im-run" data-id="([^"]*)"[^>]*><span>(.*?)<\/span>/g)].map((m) => ({ id: m[2], off: !!m[1], label: m[3] })); };
  let r = rows().find((x) => x.id === "opencase");
  check(r && r.off && /Force it open/.test(r.label), `right-click: "${r && r.label}" greyed out without a pry bar or a power tool`);
  s.pockets[0] = newItem("knife");
  r = rows().find((x) => x.id === "opencase");
  check(r && r.off, "a knife will not open a steel lock");
  h.armory.unshift(newItem("prybar"));
  const loc2 = `armory:${h.id}:list:${h.armory.length - 1}`;
  ui.imenu = null; openItemMenu(st, ui, { loc: loc2, sid: s.id }, 10, 10);
  r = [...itemMenuHtml(st, ui).matchAll(/data-id="opencase"[^>]*><span>(.*?)<\/span>/g)][0];
  check(r && /Force it open \(Crowbar\)/.test(r[1]), `a crowbar in the armory does it: "${r && r[1]}"`);
  ITEMMENU_ACTIONS["im-run"](st, ui, { id: "opencase" });
  check(!b.locked && b.opened && b.forced === "pry" && ui.box && ui.box.item === b, "forced open: the lock broken, the window open on it");
  const html = boxViewHtml(st, ui);
  check(names.every((n) => html.includes(n)) && (html.match(/data-action="box-take"/g) || []).length === b.contents.length + Object.values(b.sup).filter((v) => v > 0).length && /Take all/.test(html), `the window lists what is inside with a Take each and Take all (${names.join(", ")})`);
  check(itemTip(b, s).includes(names[0]), "opened, its tooltip says what is in it");
  const n0 = h.armory.length;
  BOX_ACTIONS["box-take"](st, ui, { i: "0" });
  check(h.armory.length === n0 + 1 && h.armory[h.armory.length - 1].name === names[0] && b.contents.length === names.length - 1, `Take: the ${names[0]} into the armory`);
  BOX_ACTIONS["box-takeall"](st, ui, {});
  check(!B.boxHolds(b) && /Empty/.test(boxViewHtml(st, ui)), "Take all empties it; the window says so");
  BOX_ACTIONS["box-close"](st, ui, {});
  check(!ui.box && boxViewHtml(st, ui) === "", "Close");
}
{
  const st = fresh(), s = person(st);
  let b = null;
  for (let i = 0; i < 300 && !b; i++) { const x = B.makeBox("cashbox", roll("cb", i), "town"); if (x.locked && B.boxHolds(x)) b = x; }
  s.pockets[1] = newItem("makeshiftpick");
  s.gear.backpack = newItem("backpack");
  s.gear.backpack.contents = [b, null, null, null];
  const loc = `s:${s.id}:pack:0`;
  const o = B.openPlan(st, loc, s.id);
  check(o.ok && o.tool.kind === "picks", "a cash box's cheap lock: makeshift picks first (quiet)");
  const ui = {};
  openBoxWindow(st, ui, loc, s.id);
  const first = b.contents[0];
  BOX_ACTIONS["box-take"](st, ui, { i: "0" });
  check(!b.contents.includes(first) && [...s.pockets, ...s.gear.backpack.contents].includes(first), `carried, what comes out goes onto the one who carries it (${first.name})`);
}

console.log("In a raid");
{
  const st = fresh(), s = person(st);
  const b = B.makeBox("firebox", roll("raid"), "town");
  b.locked = true;
  s.gear.weapon = newItem("knife");
  const u = { side: "player", sid: s.id, ap: 2, haul: { gear: [b], sup: {} }, x: 0, y: 0 };
  const bat = { raid: { containers: [], heat: 0 } };
  const t = caseTargets(st, bat, u);
  check(t.length === 1 && t[0].item === b, "a box carried loose is in the raid panel's targets");
  let o = caseOdds(st, bat, u, b);
  check(!o.ok && /steel lock/.test(o.why), `a steel lock refuses a knife ("${o.why}")`);
  s.gear.weapon = newItem("fireaxe");
  o = caseOdds(st, bat, u, b);
  check(o.ok && o.ap === 2 && o.heat === 3 && o.kind === "pry", `a fire axe pries it: 2 actions, Heat +3 (${o.ap}, ${o.heat})`);
  const c = B.makeBox("cashbox", roll("raid2"), "town");
  c.locked = true;
  s.gear.weapon = newItem("knife");
  o = caseOdds(st, bat, u, c);
  check(o.ok && o.ap === 1 && o.heat === 1 && o.kind === "blade", "a cash box gives to a knife: 1 action, Heat +1");
}

console.log("Where they turn up");
{
  const st = fresh();
  const types = new Set(Object.values(st.tiles).filter((t) => t.loc).map((t) => t.loc.type));
  const site = Object.keys(BOX_FINDS.site).find((k) => types.has(k));
  const tile = Object.keys(st.tiles).find((id) => st.tiles[id].loc && st.tiles[id].loc.type === site);
  let n = 0, sealed = 0;
  for (let h = 0; h < 3000; h++) { st.hour = h; const it = B.rollBoxFind(st, tile, 1, "t"); if (it) { n++; if (B.isSealed(it)) sealed++; } }
  check(n > 0 && sealed === n, `a search at a ${site} turns up boxes now and then (${n} in 3000 hours), all sealed`);
  let a = 0;
  for (let i = 0; i < 500; i++) if (B.rollAreaBox(st, tile, "house", `h${i}`)) a++;
  check(a > 0, `a house's containers hold them (${a} of 500)`);
}

console.log("Saved");
{
  const st = fresh(), h = hub(st);
  const b = B.makeBox("gearcase", roll("save"), "town");
  b.locked = true;
  h.armory.push(b);
  const back = deserializeState(serializeState(st));
  const b2 = hub(back).armory[hub(back).armory.length - 1];
  check(b2 && b2.key === "gearcase" && b2.locked && !b2.opened && Math.abs(itemLoad(b2) - itemLoad(b)) < 1e-9, "a box keeps its lock, its seal and what is inside through a save");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
