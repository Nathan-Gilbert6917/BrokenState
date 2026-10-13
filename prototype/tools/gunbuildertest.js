// The gun builder (ui/gunbuilder.js, ui/gunart.js; docs/weapons-overhaul-plan.md section 9), headless on stub canvases:
// - every gun has a platform and a drawing; every platform of the plan's table (and of data-gunmods.js PLATFORMS once it
//   is filled) has one; every part look paints something;
// - every slot's anchor is on a painted pixel of its drawing (or within 2);
// - the window has one box and one leader line per slot, nested slots appear and go with their parent (dotted lines);
// - fitting a part from the armory and taking it off again round-trips it; the stats shown are gunStats';
// - hover before → after, the Ammo list (item.load), the condition bar, the entry points (Modify, the ⚙ on the gun in
//   hand and in the armory), never during a battle, the tooltip's compact version.
// Usage: node tools/gunbuildertest.js
const silent = () => new Proxy({ measureText: (t) => ({ width: String(t).length * 6 }) }, { get: (o, k) => (k in o ? o[k] : () => {}) });
globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => silent(), toDataURL: () => "data:image/png;base64,AAAA" }), getElementById: () => null };
globalThis.window = globalThis.window || { addEventListener() {}, devicePixelRatio: 1 };

const { createWorld, hub, atBase } = await import("../src/sim/world.js");
const { GEAR } = await import("../src/sim/data.js");
const { WEAPONS } = await import("../src/sim/combat.js");
const { makeItem } = await import("../src/sim/crafting.js");
const GM = await import("../src/sim/gunmods.js");
const DGM = await import("../src/sim/data-gunmods.js");
const { gunStats } = await import("../src/sim/gunstats.js");
const { ensureInv } = await import("../src/sim/inventory.js");
const GA = await import("../src/ui/gunart.js");
const GB = await import("../src/ui/gunbuilder.js");
const INV = await import("../src/ui/inventory.js");

let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } };
const t0 = performance.now();

// ---------- 1. platforms and drawings ----------
console.log("Platforms and drawings");
{
  const guns = Object.keys(WEAPONS).filter(GA.isGunKey);
  check(guns.length >= 8, `the guns (${guns.join(", ")})`);
  const noArt = guns.filter((k) => !GA.PLAT_ART[GA.artKeyOf(k)] || !GA.platformOf(k));
  check(!noArt.length, `every gun has a platform and a drawing${noArt.length ? ` (not: ${noArt.join(", ")})` : ""}`);
  const generic = guns.filter((k) => /^generic_/.test(GA.artKeyOf(k)) && (GA.LOCAL_PLATFORM[k] || (DGM.WEAPON_PLATFORM || {})[k]));
  check(!generic.length, `a gun with a platform never falls back to the generic drawing${generic.length ? ` (${generic.join(", ")})` : ""}`);
  const planPlats = ["glock", "p1911", "rimpistol", "revolver", "mp5", "ar15", "ar10", "m249", "ak", "bolt", "lever", "rimrifle", "pump", "semi12", "dbl", "amr", "zip"];
  const missing = [...new Set([...planPlats, ...Object.keys(DGM.PLATFORMS || {}), ...Object.values(DGM.WEAPON_PLATFORM || {})])].filter((p) => !GA.PLAT_ART[p]);
  check(!missing.length, `every platform of section 5 and of data-gunmods.js has a drawing${missing.length ? ` (not: ${missing.join(", ")})` : ""}`);
  check(GA.artKeyOf("sniper") === "sniper" && GA.PLAT_ART.sniper, "the sniper rifle (section 22) has its long-barrelled bolt drawing");
  check(GA.artKeyOf("zzz_newpistol") === "generic_pistol" || GA.artKeyOf("zzz_newpistol") === "generic_rifle", "an unknown gun gets a generic drawing");
  WEAPONS.zzz_smallgun = { name: "Test pistol", dmg: [10, 12], ammo: 1, cal: "9mm", cap: 8 };
  check(GA.artKeyOf("zzz_smallgun") === "generic_pistol", "a pistol-calibre gun without a platform: the generic pistol");
  WEAPONS.zzz_biggun = { name: "Test rifle", dmg: [10, 12], ammo: 1, cal: "308", cap: 10 };
  check(GA.artKeyOf("zzz_biggun") === "generic_rifle", "a rifle without a platform: the generic rifle");
  delete WEAPONS.zzz_smallgun; delete WEAPONS.zzz_biggun;
  // Every part look paints at least a pixel, inside the grid, on every drawing.
  const empty = [];
  for (const look of Object.keys(GA.PART_ART)) {
    const p = GA.paintGun("ar", {}), base = p.px.filter(Boolean).length;
    const q = GA.paintGun("ar", { optic: look });
    const r = GA.paintGun("ar", { muzzle: look });
    if (q.px.filter(Boolean).length === base && r.px.filter(Boolean).length === base && q.px.join() === p.px.join() && r.px.join() === p.px.join()) empty.push(look);
  }
  check(!empty.length, `every part look paints something (${Object.keys(GA.PART_ART).length} looks${empty.length ? `; nothing from ${empty.join(", ")}` : ""})`);
  const mods = Object.keys(GM.ATTACH).filter((k) => !GA.MOD_LOOK[k] && !(GEAR[k] && GEAR[k].look) && !GA.PART_ART[GA.lookOf({ key: k }, GM.ATTACH[k].slot)]); // (hand-drawn, or drawn by its kind: ui/gunparts.js, PART_SPEC)
  check(!mods.length, `every attachment has a look${mods.length ? ` (not: ${mods.join(", ")})` : ""}`);
  check(GA.lookOf({ key: "scope4x" }, "optic") === "scope4" && GA.lookOf({ key: "unknownpart" }, "muzzle") === "can_s", "a part's look by its key, else by its slot");
  const wp = GA.paintGun("pistol", { optic: "reddot", muzzle: "can_s" });
  check(wp.w === GA.ART_W && wp.h === GA.ART_H && wp.px.length === GA.ART_W * GA.ART_H, `the drawing is ${GA.ART_W} × ${GA.ART_H} (the sprites' painter, sized)`);
  check(GA.paintGun("ar", { stock: "precision" }).px.join() !== GA.paintGun("ar", {}).px.join(), "a fitted stock replaces the gun's own");
  check(GA.paintGun("sniper", {}, ["muzzle", "under"]).px.join() !== GA.paintGun("sniper", {}, ["optic", "muzzle"]).px.join(), "a gun's own scope (the sniper rifle's) is drawn only while it has no sight slot");
  check(GA.paintGun("huntrifle", { optic: GA.lookOf({ key: "huntrifscope" }, "optic") }).px.join() !== GA.paintGun("huntrifle", {}).px.join(), "the hunting rifle's scope is a part (user pick 2026-10-10): drawn when fitted, gone when taken off");
}

// ---------- 2. anchors on the drawing ----------
console.log("Anchors");
{
  const off = [];
  let n = 0;
  for (const [key, art] of Object.entries(GA.PLAT_ART)) {
    const p = GA.paintArt(key); // with its own parts (stock, magazine)
    for (const [s, a] of Object.entries(art.anchors)) { n++; if (!near(p, a)) off.push(`${key}.${s}`); }
  }
  function near(p, [x, y]) {
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (p.get(x + dx, y + dy)) return true;
    return false;
  }
  check(n > 150 && !off.length, `every anchor (${n}) is on a painted pixel or within 2${off.length ? ` (off: ${off.join(", ")})` : ""}`);
  const outOfGrid = Object.entries(GA.PLAT_ART).flatMap(([k, a]) => Object.entries(a.anchors).filter(([, [x, y]]) => x < 0 || y < 0 || x >= GA.ART_W || y >= GA.ART_H).map(([s]) => `${k}.${s}`));
  check(!outOfGrid.length, "every anchor is inside the grid");
  const lifted = GA.anchorOf("huntrifle", "optic", { mount: true })[1] === GA.anchorOf("huntrifle", "optic", {})[1] - 1;
  check(lifted, "a mount lifts the sight a pixel");
}

// ---------- 3. the window: boxes, lines, nesting ----------
console.log("The window");
const world = () => {
  const st = createWorld({ seed: 7, factionCount: 3 });
  const h = hub(st);
  const s = atBase(st, h.id)[0];
  ensureInv(s);
  s.pockets = s.pockets.map(() => null);
  return { st, h, s };
};
const countOf = (html, re) => (html.match(re) || []).length;
{
  const { st, h, s } = world();
  for (const key of ["pistol", "ar", "shotgun", "huntrifle", "revolver", "leverrifle", "carbine", "pipegun"]) {
    s.gear.weapon = makeItem(key);
    const ui = {};
    GB.GB_ACTIONS["gb-open"](st, ui, { loc: `s:${s.id}:weapon` });
    const html = GB.gunBuilderModal(st, ui) || "";
    const slots = GB.slotsOf(s.gear.weapon);
    const boxes = countOf(html, /class="gbslot/g), lines = countOf(html, /<line /g);
    const each = slots.every((sl) => countOf(html, new RegExp(`data-action="gb-slot" data-slot="${sl}"`, "g")) === 1 && countOf(html, new RegExp(`<line [^>]*data-slot="${sl}"`, "g")) === 1);
    check(boxes === slots.length && lines === slots.length && each, `${key}: one box and one line a slot (${slots.join(", ") || "none"}: ${boxes} boxes, ${lines} lines)`);
  }
  // Boxes in their lanes, inside the window, never overlapping.
  s.gear.weapon = makeItem("ar");
  const lay = GB.slotLayout(s.gear.weapon, ["optic", "mount", "tactical", "rail", "muzzle", "mag", "under", "grip", "stock", "bipod", "sling"]);
  const V = GB.VIEW;
  const inside = lay.every((b) => b.x >= 0 && b.x + b.w <= V.W + 0.5 && b.y >= 0 && b.y + b.h <= V.H);
  const overlap = lay.some((a) => lay.some((b) => a !== b && a.y === b.y && a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5));
  check(inside && !overlap && lay.filter((b) => b.top).length === 4, "eleven slots: top lane sight, mount, light, rail; the rest below; inside the window, none overlapping");
  check(lay.every((b) => b.top ? b.y + b.h <= V.IY : b.y >= V.IY + V.IMG_H), "boxes clear the drawing");
  // Nesting: a part that opens slots (the economy agent's scope mount on a lever-action, a quad rail on a Kalashnikov).
  {
    const rifle = makeItem("leverrifle");
    s.gear.weapon = rifle;
    const ui = {};
    GB.GB_ACTIONS["gb-open"](st, ui, { loc: `s:${s.id}:weapon` });
    const before = GB.slotsOf(rifle);
    const html0 = GB.gunBuilderModal(st, ui);
    check(!before.includes("optic") && !/data-slot="optic"/.test(html0), `a lever-action without a mount has no sight slot (${before.join(", ")})`);
    rifle.mods = { mount: GM.makeMod("scopemount") };
    const html1 = GB.gunBuilderModal(st, ui);
    const after = GB.slotsOf(rifle);
    check(after.includes("mount") && after.includes("optic") && after.indexOf("optic") > after.indexOf("mount"), `fitted, the mount opens a sight slot (${after.join(", ")})`);
    check(countOf(html1, /class="gbslot/g) === after.length && countOf(html1, /<line /g) === after.length && /<line class="nest" data-slot="optic"/.test(html1), "the nested sight has its box and a dotted line from the mount's box");
    check(GB.parentSlot(rifle, "optic") === "mount" && GB.slotLayout(rifle).find((b) => b.slot === "optic").parent === "mount", "its parent is the mount");
    delete rifle.mods;
    const html2 = GB.gunBuilderModal(st, ui);
    check(!/data-slot="optic"/.test(html2) && countOf(html2, /<line /g) === GB.slotsOf(rifle).length, "the mount off: the sight slot goes with it");
    const ar = makeItem("ak");
    ar.mods = { rail: GM.makeMod("quadrail") };
    s.gear.weapon = ar;
    const html3 = GB.gunBuilderModal(st, ui);
    check(["grip", "tactical"].every((sl) => new RegExp(`<line class="nest" data-slot="${sl}"`).test(html3)) && countOf(html3, /<line /g) === GB.slotsOf(ar).length, "a rail opens a grip and a light slot, each with a dotted line");
    const w = GB.withPart(ar, "rail", null);
    check(!w.mods.rail && !w.mods.grip, "the stats without the rail drop what only it carried");
  }
}

// ---------- 4. fit and strip; the stats ----------
console.log("Fit, remove and the stats");
{
  const { st, h, s } = world();
  const gun = makeItem("ar");
  h.armory.push(gun, GM.makeMod("reddot"), GM.makeMod("riflecan"), GM.makeMod("drum"), GM.makeMod("choke"), GM.makeMod("extmag"));
  const gunLoc = () => `armory:${h.id}:list:${h.armory.indexOf(gun)}`;
  const ui = {};
  GB.GB_ACTIONS["gb-open"](st, ui, { loc: gunLoc(), sid: s.id });
  check(ui.gunb && ui.gunb.loc === gunLoc(), "opens on a gun in the armory");
  GB.GB_ACTIONS["gb-slot"](st, ui, { slot: "optic" });
  let html = GB.gunBuilderModal(st, ui);
  const opts = [...html.matchAll(/data-action="gb-fit" data-slot="optic" data-part="([^"]+)"/g)].map((m) => m[1]);
  check(opts.length === 1 && /reddot|Red dot/.test(html), `the sight slot lists the red dot in the armory, nothing that does not fit (${opts.length})`);
  GB.GB_ACTIONS["gb-slot"](st, ui, { slot: "muzzle" });
  html = GB.gunBuilderModal(st, ui);
  check(/Rifle suppressor|riflecan/i.test(html) && !/data-part="[^"]*"[^>]*>Fit<\/button><\/div>[^]*Shotgun choke/.test(html) && !GB.partsInReach(st, ui.gunb.loc, "muzzle", s.id).some((c) => c.item.key === "choke"), "the muzzle slot: the rifle suppressor, never the shotgun choke");
  // A part in someone's pocket counts too.
  s.pockets[0] = GM.makeMod("brake");
  check(GB.partsInReach(st, ui.gunb.loc, "muzzle", s.id).some((c) => c.item.key === "brake" && /pocket/.test(c.where)), "a part in a pocket of someone here is within reach");
  const nArm = h.armory.length;
  const can = GB.partsInReach(st, ui.gunb.loc, "muzzle", s.id).find((c) => c.item.key === "riflecan");
  const before = GB.statsOf(gun);
  GB.GB_ACTIONS["gb-hover"](st, ui, { v: can.loc });
  html = GB.gunBuilderModal(st, ui);
  const after = GB.statsOf(GB.withPart(gun, "muzzle", can.item));
  check(/now → with the Rifle suppressor/.test(html) && /→ /.test(html) && after.noise < before.noise, "hovering it: the stats panel shows before → after (quieter)");
  GB.GB_ACTIONS["gb-fit"](st, ui, { part: can.loc, slot: "muzzle" });
  check(gun.mods && gun.mods.muzzle && gun.mods.muzzle.key === "riflecan" && !h.armory.some((x) => x.key === "riflecan") && h.armory.length === nArm - 1, `Fit: from the armory onto the gun (${ui.gunb.msg})`);
  check(itemAtLoc(st, ui.gunb.loc) === gun, "the window follows the gun when the armory list shifts");
  html = GB.gunBuilderModal(st, ui);
  check(/Remove the Rifle suppressor/.test(html), "the fitted part's slot offers Remove");
  // Displayed stats equal gunStats.
  const gs = gunStats(gun);
  const shown = Object.fromEntries([...html.matchAll(/data-stat="(\w+)" data-v="([^"]*)"/g)].map((m) => [m[1], m[2]]));
  const r2 = (x) => String(Math.round(x * 100) / 100);
  check(shown.aim === r2(gs.aim) && shown.close === r2(gs.close) && shown.opt === r2(gs.opt) && shown.fall === r2(gs.fall) && shown.cap === r2(gs.cap) && shown.jam === r2(gs.jam) && shown.dmg === r2((gs.dmg[0] + gs.dmg[1]) / 2) && shown.noise === r2(gs.noise),
    `the stats shown are gunStats' (aim ${shown.aim}/${gs.aim}, range ${shown.opt}/${gs.opt}, noise ${shown.noise}/${r2(gs.noise)}, magazine ${shown.cap}/${gs.cap})`);
  check(html.includes(`${gs.dmg[0]}–${gs.dmg[1]}`), "the damage range as gunStats gives it");
  // gunStats' jam is the battle's per-round chance (sim/gunfire.js jamChance): a new assault rifle 0.5%, × the rifle
  // suppressor's jam (section 5) now that one is fitted.
  const bare = gunStats({ key: "ar" }).jam;
  check(bare === 0.5 && gs.jam > bare && new RegExp(`jams ${String(Math.round(gs.jam * 100) / 100).replace(".", "\.")}% a shot · ~1 in ${Math.round(100 / gs.jam)}`).test(html), `the reliability line (an assault rifle: 0.5% a shot bare; with the suppressor ${gs.jam}%)`);
  GB.GB_ACTIONS["gb-strip"](st, ui, { slot: "muzzle" });
  check(!(gun.mods && gun.mods.muzzle) && h.armory.some((x) => x.key === "riflecan") && h.armory.length === nArm, `Remove: back into the armory (${ui.gunb.msg})`);
  // A magazine changes the magazine count; the drum the gunStats capacity.
  GB.GB_ACTIONS["gb-slot"](st, ui, { slot: "mag" });
  const drum = GB.partsInReach(st, ui.gunb.loc, "mag", s.id).find((c) => c.item.key === "drum");
  GB.GB_ACTIONS["gb-fit"](st, ui, { part: drum.loc, slot: "mag" });
  html = GB.gunBuilderModal(st, ui);
  check(/data-stat="cap" data-v="60"/.test(html) && gunStats(gun).cap === 60, "a drum: the magazine shown is 60, as gunStats says");
  // The Ammo list.
  check(/<select data-action="gb-load"[^>]*>/.test(html) && /5\.56 NATO armour-piercing/.test(html), "the Ammo list offers the calibre's rounds");
  GB.GB_CHANGE["gb-load"](st, ui, { value: "ap" });
  check(gun.load === "ap" && /<option value="ap" selected>/.test(GB.gunBuilderModal(st, ui)), `the Ammo list sets item.load (${ui.gunb.msg})`);
  GB.GB_CHANGE["gb-load"](st, ui, { value: "bogus" });
  check(gun.load === "ap", "an unknown kind is ignored");
  GB.GB_CHANGE["gb-load"](st, ui, { value: "" });
  check(gun.load === undefined, "the standard round clears it");
  // Condition: a bar, the lost maximum a darker band.
  gun.dur = 20; gun.durMax = 50;
  html = GB.gunBuilderModal(st, ui);
  check(/data-stat="cond" data-v="20\/50"/.test(html) && /<span class="gbcond"><b style="width:[\d.]+%[^"]*"><\/b><i style="left:/.test(html), "condition: a bar of what is left and a darker band for the maximum lost");
  // Never during a battle.
  st.combat = { fake: true };
  check(GB.gunBuilderModal(st, ui) === null && ui.gunb === null, "a battle closes it");
  const ui2 = {};
  GB.GB_ACTIONS["gb-open"](st, ui2, { loc: gunLoc() });
  check(!ui2.gunb && /Not during a battle/.test(ui2.invMsg || ""), "and it does not open during one");
  st.combat = null;
  // A body's gun is out of reach.
  const ui3 = { gunb: { loc: "body:0:weapon", slot: null } };
  check(GB.gunBuilderModal(st, ui3) === null, "no builder on a body's gun");
}

// ---------- 5. the entry points and the tooltip ----------
console.log("Entry points");
{
  const { st, h, s } = world();
  s.gear.weapon = makeItem("pistol");
  h.armory.push(makeItem("shotgun"), makeItem("knife"), GM.makeMod("reddot"));
  const ui = { inv: { sid: s.id, loot: false }, invSel: `s:${s.id}:weapon`, invMsg: "" };
  let html = INV.inventoryModal(st, ui);
  check(new RegExp(`data-action="gb-open" data-loc="s:${s.id}:weapon"[^>]*>⚙ Modify`).test(html), "a selected gun: Modify");
  check(new RegExp(`class="mini gbcog" data-action="gb-open" data-loc="s:${s.id}:weapon"`).test(html), "the ⚙ on the gun in hand");
  const sg = h.armory.findIndex((x) => x.key === "shotgun"), kn = h.armory.findIndex((x) => x.key === "knife");
  check(new RegExp(`data-action="gb-open" data-loc="armory:${h.id}:list:${sg}"`).test(html) && !new RegExp(`data-action="gb-open" data-loc="armory:${h.id}:list:${kn}"`).test(html), "the ⚙ on a gun in the armory, not on a knife");
  check(!/data-action="inv-unmod"|data-action="inv-fitmod"/.test(html), "the old fit / remove bar is gone");
  ui.invSel = `armory:${h.id}:list:${h.armory.findIndex((x) => x.key === "reddot")}`;
  html = INV.inventoryModal(st, ui);
  check(new RegExp(`data-action="gb-open" data-loc="s:${s.id}:weapon" data-slot="optic"`).test(html), "a selected part: ⚙ for the gun it fits, at its slot");
  const tip = INV.itemTip(s.gear.weapon, s);
  check(/slots: sight \(empty\)/.test(tip) && /Modify \(⚙\)/.test(tip) && /jams 0\.35% a shot/.test(tip) && /loaded with 9mm FMJ/.test(tip), `the tooltip's compact version (${tip.match(/slots:[^.]*/)?.[0]})`);
  // Not in the raid's search window (the loot screen goes through the same guard: gearCog).
  check(!/gbcog/.test(INV.inventoryModal(st, { inv: { sid: s.id, raid: true }, invSel: null }) || ""), "no ⚙ in the raid's search window");
  // The modal route and the actions in main.js; Esc and the keyboard.
  const fs = await import("node:fs");
  const uiSrc = fs.readFileSync(new URL("../src/ui/ui.js", import.meta.url), "utf8");
  const mainSrc = fs.readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  check(/if \(ui\.gunb\) return \["gunb", \(\) => gunBuilderModal\(state, ui\)\];\s*\/\/[^\n]*\n(\s*if \((?:ui\.inv && ui\.inv\.(?:team != null|form)|ui\.meet)\)[^\n]*\n)*\s*if \(ui\.inv\) return/.test(uiSrc), "ui.js pickModal opens it just above the inventory (and the team inventory: ui/teaminv.js; the Form a team window: ui/teamform.js; teams together on a tile: ui/teammeet.js, TEAM-05)");
  check(uiSrc.indexOf('if (ui.gunb) return ["gunb"') > uiSrc.indexOf("if (state.combat) return state.gameOver"), "after the battle's line: never over a battle");
  check(/Object\.entries\(GB_ACTIONS\)/.test(mainSrc) && /Object\.entries\(GB_CHANGE\)/.test(mainSrc) && /data-gbhover/.test(mainSrc) && /if \(ui\.gunb\) \{/.test(mainSrc) && /!!ui\.gunb/.test(mainSrc), "main.js: its actions, the Ammo list, the hover, Esc and the paused clock");
  check(/gb-open/.test(uiSrc) && /<b>Gun builder:<\/b>/.test(GB.GUNBUILDER_HELP), "the base's Armory tab has the ⚙; the Help topic");
}

// The Repair button (sim/repair.js repairInfoAt / repairAt): a worn gun in the armory, the bench queue.
console.log("Repair");
{
  const { st, h, s } = world();
  const gun = makeItem("ar");
  gun.dur = Math.max(1, Math.round(gun.dur * 0.4));
  h.armory.push(gun);
  const loc = `armory:${h.id}:list:${h.armory.indexOf(gun)}`;
  const ui = {};
  GB.GB_ACTIONS["gb-open"](st, ui, { loc, sid: s.id });
  const html = GB.gunBuilderModal(st, ui);
  const { repairInfoAt } = await import("../src/sim/repair.js");
  const r = repairInfoAt(st, loc);
  check(/data-action="gb-repair"/.test(html) && (r.ok || r.reason), `a worn gun: the Repair button (${r.ok ? "ok" : r.reason})`);
  const q0 = (h.gearRepairs || []).length;
  GB.GB_ACTIONS["gb-repair"](st, ui, {});
  check(typeof ui.gunb.msg === "string" && ui.gunb.msg.length > 0 && (!r.ok || (h.gearRepairs || []).length === q0 + 1), `pressed: the sim's answer ("${ui.gunb.msg}")`);
}

function itemAtLoc(st, loc) { const L = loc.split(":"); return L[0] === "armory" ? st.bases.find((b) => b.id === Number(L[1])).armory[Number(L[3])] : null; }

console.log(`\n${passed} passed, ${failed} failed. (${Math.round(performance.now() - t0)} ms)`);
process.exit(failed ? 1 : 0);
