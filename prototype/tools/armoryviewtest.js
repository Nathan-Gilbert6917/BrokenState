// Headless test of the armory list (ui/armoryview.js): items grouped by type (guns by class), cards by default and
// compact rows on the toggle, the find box and the type chips, folding, the base Armory tab's "Everything here" with who
// has each thing, and that the inventory window's storage box keeps its clicks, drags, drops and the gun's ⚙.
// Usage: node tools/armoryviewtest.js [seed]
const ctx2d = new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => ({ data: new Uint8ClampedArray(4) })), set: (t, k, v) => ((t[k] = v), true) });
globalThis.document = globalThis.document || { createElement: () => ({ width: 0, height: 0, getContext: () => ctx2d, toDataURL: () => "data:image/png;base64,AAAA" }) };
const store = {};
globalThis.localStorage = { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } };

const { createWorld, hub, atBase } = await import("../src/sim/world.js");
const { makeItem } = await import("../src/sim/crafting.js");
const { reloadGunAt } = await import("../src/sim/itemacts.js");
const AV = await import("../src/ui/armoryview.js");
const { inventoryModal, INV_ACTIONS } = await import("../src/ui/inventory.js");
const { renderModal } = await import("../src/ui/ui.js");

const SEED = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const section = (t) => console.log(t);
const act = (k, d = {}, st = null, ui = {}) => AV.ARMV_ACTIONS[k](st, ui, d);

section("Groups");
{
  const g = (k) => AV.itemGroup(makeItem(k));
  check(g("pistol").g === "guns" && g("pistol").sub === "pistol", "a pistol: Guns, pistols");
  check(g("revolver44").sub === "revolver" && g("service38").sub === "revolver", "revolvers have their own class");
  check(g("smg").sub === "smg" && g("ump45").sub === "smg" && g("p90").sub === "smg", "the 9mm, .45 and 5.7 automatics are SMGs");
  check(g("ak").sub === "assault" && g("fal").sub === "assault" && g("lmg").sub === "mg" && g("m240").sub === "mg", "assault and battle rifles; machine guns");
  check(g("huntrifle").sub === "rifle" && g("shotgun").sub === "shotgun" && g("compbow").sub === "bow" && g("m79").sub === "launcher", "rifles, shotguns, bows, launchers");
  check(g("knife").g === "melee" && g("bat").g === "melee", "blades and bats: Melee");
  check(g("mag_glock_17").g === "mags" && g("speedloader").g === "mags", "magazines and speedloaders");
  check(g("a_308_fmj").g === "ammo" && g("brass").g === "ammo", "rounds and reloading kit: Ammo");
  check(g("milhelmet").g === "armour" && g("vest").g === "armour" && g("ceramicplate").g === "armour" && g("riotvisor").g === "armour", "helmets, vests, plates, visors: Armour");
  check(g("backpack").g === "bags" && g("chestrig").g === "bags" && g("riflecase").g === "bags", "packs, rigs, cases: Bags");
  check(g("flashlight").g === "lights" && g("binoculars").g === "lights" && g("nvg").g === "lights", "lights, binoculars, night vision");
  check(g("bandagekit").g === "medical" && g("tourniquet").g === "medical", "medical");
  check(g("crowbar").g === "tools" && g("milradio").g === "tools", "tools and radios");
  check(g("suppressor").g === "attach" && g("reddot").g === "attach", "gun parts");
  check(g("frag").g === "throw" && g("barbedwire").g === "defence" && g("medbook").g === "books" && g("goldring").g === "trade" && g("ghillie").g === "clothing", "throwables, defences, books, valuables, camp kit");
}

section("Stat line");
{
  const gun = makeItem("pistol");
  // gun-mags' count (ui/itemlabels.js): { text, cls, tip, n, cap }; an item nowhere holds what is in it.
  check(/^0\/\d+$/.test(AV.gunRoundsLabel(gun).text), `an unloaded pistol: ${AV.gunRoundsLabel(gun).text}`);
  gun.loaded = { n: 7, key: "a_9mm_fmj" };
  check(AV.gunRoundsLabel(gun).text.startsWith("7/"), `loaded: ${AV.gunRoundsLabel(gun).text}`);
  check(AV.gunRoundsLabel(makeItem("knife")) == null, "a knife has no rounds");
  const worn = makeItem("milhelmet");
  worn.dur = Math.round(worn.dur / 2);
  check(AV.statBits(worn).some(([t]) => /%$/.test(t)), `a worn helmet shows its condition (${AV.statBits(worn).map(([t]) => t).join(", ")})`);
}

section("The base Armory tab");
{
  AV.resetArmoryView();
  const st = createWorld({ seed: SEED, factionCount: 5 });
  st.started = true;
  const h = hub(st);
  const people = atBase(st, h.id);
  h.armory.length = 0;
  h.armory.push(makeItem("shotgun"), makeItem("pistol"), makeItem("knife"), makeItem("milhelmet"), makeItem("mag_glock_17"), makeItem("bandagekit"), makeItem("ak"));
  st.cards = [];
  const ui = { started: true, baseView: { id: h.id, tab: "armory" } };
  let html = renderModal(st, ui) || "";
  check(/class="agroup/.test(html) && !/<span class="chip"[^>]*>Pump/.test(html), "grouped, not the old chip list");
  const heads = [...html.matchAll(/class="ahead" data-action="armv-fold" data-ns="base" data-g="(\w+)"/g)].map((m) => m[1]).join(",");
  check(heads === "guns,mags,melee,armour,medical", `groups in order (${heads})`);
  check(/class="asub">Pistols/.test(html) && /class="asub">Shotguns/.test(html) && /class="asub">Assault and battle rifles/.test(html), "guns by class");
  check((html.match(/class="acard[ "]/g) || []).length === 7 && /<img class="igun apicimg"/.test(html), "a card each, guns with their picture");
  check(/data-action="armv-view"/.test(html) && /data-action="armv-q"/.test(html) && /data-keep="armv-q-base"/.test(html), "the view toggle and the find box (keeps its focus)");
  check(/data-action="armv-type"[^>]*data-g="guns"/.test(html), "type chips");
  const sg = h.armory.findIndex((x) => x.key === "shotgun");
  check(new RegExp(`data-action="gb-open" data-loc="armory:${h.id}:list:${sg}"`).test(html), "the gun's ⚙ stays");
  // The cards' rounds are the real count (2026-10-20: what is in the gun; the stored pistol reloaded from the base's 9mm
  // stores, itemacts.js reloadGunAt), its names and short tips.
  h.stock.a_9mm_fmj = 40;
  html = renderModal(st, ui) || "";
  check(![...html.matchAll(/class="irounds (\w+)"[^>]*>(\d+)\/(\d+)</g)].some((m) => m[1] === "full"), "rounds in the stores alone load no stored gun");
  reloadGunAt(st, `armory:${h.id}:list:${h.armory.findIndex((x) => x.key === "pistol")}`);
  html = renderModal(st, ui) || "";
  const rds = [...html.matchAll(/class="irounds (\w+)"[^>]*>(\d+)\/(\d+)</g)].map((m) => m.slice(1));
  check(rds.some(([c, n, cap]) => c === "full" && n === cap && Number(n) > 0), `a stored pistol with 9mm in the stores shows real rounds, not 0/N (${rds.map((r) => `${r[1]}/${r[2]}`).join(" ")})`);
  check(/class="aname">9mm pistol magazine \(\d+\)</.test(html) || /class="aname">[^<]*magazine/.test(html), "a magazine card says magazine (itemnames.js rowName)");
  check(/data-tip-full="/.test(html) && /Shift: full details/.test(html), "cards carry the short tip, the full one behind Shift");
  check(people.length ? new RegExp(`data-action="armv-pick" data-loc="armory:${h.id}:list:\\d" data-sid="${people[0].id}"`).test(html) : true, "a click opens it in the inventory");
  // Compact.
  act("armv-view");
  html = renderModal(st, ui) || "";
  check(AV.armoryCompact() && store["bs.armoryView"] === "compact" && (html.match(/class="arow[ "]/g) || []).length === 7 && !/class="acard[ "]/.test(html), "compact rows, remembered in the browser");
  act("armv-view");
  check(!AV.armoryCompact() && store["bs.armoryView"] === "cards", "and back to cards");
  // Find.
  AV.ARMV_INPUT["armv-q"](st, ui, { value: "pump", dataset: { ns: "base" } });
  html = renderModal(st, ui) || "";
  check((html.match(/class="acard[ "]/g) || []).length === 1 && /Nothing matches|class="acard/.test(html), "the find box: one match for 'pump'");
  AV.ARMV_INPUT["armv-q"](st, ui, { value: "9mm", dataset: { ns: "base" } });
  html = renderModal(st, ui) || "";
  const n9 = (html.match(/class="acard[ "]/g) || []).length;
  check(n9 >= 2, `by calibre: '9mm' finds the pistol and its magazine (${n9})`);
  act("armv-clear", { ns: "base" });
  // Type chip.
  act("armv-type", { ns: "base", g: "guns" });
  html = renderModal(st, ui) || "";
  check((html.match(/class="acard[ "]/g) || []).length === 3, "the Guns chip: only the three guns");
  act("armv-type", { ns: "base", g: "guns" });
  // Fold.
  act("armv-fold", { ns: "base", g: "guns" });
  html = renderModal(st, ui) || "";
  check((html.match(/class="acard[ "]/g) || []).length === 4 && /agroup folded/.test(html), "a folded group keeps its header, not its cards");
  act("armv-foldall", { ns: "base", open: "1" });
  // Everything here: who has what.
  if (people.length) {
    act("armv-scope", { ns: "base", scope: "all" });
    html = renderModal(st, ui) || "";
    const carried = people.reduce((a, s) => a + Object.values(s.gear).filter(Boolean).length, 0);
    check(!carried || /class="awho"/.test(html), "Everything here: what people carry, with who has it");
    act("armv-scope", { ns: "base", scope: "stored" });
    // The pick opens the inventory with it selected.
    const u2 = {};
    act("armv-pick", { loc: `armory:${h.id}:list:0`, sid: String(people[0].id) }, st, u2);
    check(u2.inv && u2.inv.sid === people[0].id && u2.invSel === `armory:${h.id}:list:0`, "armv-pick: the inventory opens with the item selected");
  }
  // Empty.
  const saved = h.armory.splice(0);
  html = renderModal(st, ui) || "";
  check(/Gear your teams bring home/.test(html) && !/class="armbar"/.test(html), "empty: the old line, no tool bar");
  h.armory.push(...saved);
}

section("The inventory window's storage box");
{
  AV.resetArmoryView();
  const st = createWorld({ seed: SEED, factionCount: 5 });
  st.started = true;
  const h = hub(st);
  const s = atBase(st, h.id)[0];
  h.armory.length = 0;
  h.armory.push(makeItem("shotgun"), makeItem("knife"), makeItem("crowbar"));
  const ui = { inv: { sid: s.id, loot: false }, invSel: null, invMsg: "" };
  let html = inventoryModal(st, ui) || "";
  for (let i = 0; i < 3; i++) check(new RegExp(`data-action="inv-click" data-loc="armory:${h.id}:list:${i}" data-drop="armory:${h.id}:list"`).test(html) && html.includes(`draggable="true" data-drag="armory:${h.id}:list:${i}"`), `item ${i}: click, drop and drag kept`);
  check(new RegExp(`class="istore agroups" data-action="inv-click" data-loc="armory:${h.id}:list" data-drop="armory:${h.id}:list"`).test(html), "the box itself is still the drop target");
  check(new RegExp(`data-action="gb-open" data-loc="armory:${h.id}:list:0"`).test(html), "the shotgun's ⚙");
  // A click selects, a second click on it sends it across (sim/inventory.js quickMove), as before.
  const kn = h.armory.findIndex((x) => x.key === "knife");
  INV_ACTIONS["inv-click"](st, ui, { loc: `armory:${h.id}:list:${kn}` });
  html = inventoryModal(st, ui) || "";
  check(new RegExp(`class="islot store acard sel" data-action="inv-click" data-loc="armory:${h.id}:list:${kn}"`).test(html), "the selected card is marked");
  INV_ACTIONS["inv-click"](st, ui, { loc: `armory:${h.id}:list:${kn}` });
  check(!h.armory.some((x) => x.key === "knife"), `clicked twice: the knife goes onto ${s.name.split(" ")[0]}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
