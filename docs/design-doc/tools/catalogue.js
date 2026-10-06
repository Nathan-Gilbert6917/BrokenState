// Sprite catalogue for the design document. Imports the prototype's own sprite modules (nothing is copied or
// changed), calls every paint function with every key it accepts, and collects the results in window.__sprites:
// [{ id, category, key, label, source, dataURL, w, h, nw, nh, scale }]. w/h: the exported PNG; nw/nh: the sprite's
// native size in its own pixels (scale = PNG px per sprite px; 1 for the battle map's vector drawings).
//
// Served from the repo root (export-sprites.cjs), so the game's modules are at /prototype/src/...
const ROOT = `${location.origin}/prototype/src`;
const S = await import(`${ROOT}/ui/sprites.js`);
const M = await import(`${ROOT}/ui/mapsprites.js`);
const H = await import(`${ROOT}/ui/hivesprites.js`);
const T = await import(`${ROOT}/ui/terraindeco.js`);
const L = await import(`${ROOT}/ui/locks.js`);
const D = await import(`${ROOT}/sim/data.js`);
const HC = await import(`${ROOT}/sim/hiveconst.js`);
const SIMC = await import(`${ROOT}/sim/combat.js`);
const ST = await import(`${ROOT}/sim/stealth.js`);

// ui/combat.js keeps drawObject / drawThrowable / FLOOR private. Load the same file as a blob module with its
// relative imports made absolute (so it shares the game's module instances) and an extra export line.
async function combatInternals() {
  let src = await (await fetch(`${ROOT}/ui/combat.js`)).text();
  src = src.replace(/from "\.\.\/sim\//g, `from "${ROOT}/sim/`).replace(/from "\.\//g, `from "${ROOT}/ui/`);
  src += "\nexport { drawObject as __drawObject, drawThrowable as __drawThrowable, FLOOR as __FLOOR };\n";
  const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
  return import(url);
}
const C = await combatInternals();

const UP = 4; // the game's pre-upscale factor for cached sprite canvases (sprites.js, mapsprites.js, hivesprites.js)
const out = [];
const seen = new Set();
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");

// Upscale factor so the larger side lands in 96..160 px.
function scaleFor(m) {
  if (m >= 96) return 1;
  let k = Math.max(1, Math.round(128 / m));
  while (k > 1 && k * m > 160) k--;
  while (k * m < 96 && (k + 1) * m <= 160) k++;
  return k;
}

// cv: a canvas/bitmap painted at `up` device px per sprite px (4 for the game's cached sprites, 1 for a native
// canvas); exported nearest-neighbour at scaleFor(native size).
function add(category, key, label, cv, source, up = UP) {
  key = slug(key);
  const id = `${category}/${key}`;
  if (seen.has(id)) throw new Error(`duplicate sprite id ${id}`);
  if (!cv) throw new Error(`no canvas for ${id}`);
  seen.add(id);
  const nw = Math.round(cv.width / up), nh = Math.round(cv.height / up);
  const k = scaleFor(Math.max(nw, nh));
  const o = document.createElement("canvas");
  o.width = nw * k; o.height = nh * k;
  const c = o.getContext("2d");
  c.imageSmoothingEnabled = false;
  c.drawImage(cv, 0, 0, cv.width, cv.height, 0, 0, o.width, o.height);
  out.push({ id, category, key, label, source, dataURL: o.toDataURL("image/png"), w: o.width, h: o.height, nw, nh, scale: k });
}
// A vector drawing made at its final size (the battle map's cells and thrown items).
function addVector(category, key, label, w, h, draw, source) {
  const o = document.createElement("canvas");
  o.width = w; o.height = h;
  draw(o.getContext("2d"), o);
  key = slug(key);
  const id = `${category}/${key}`;
  if (seen.has(id)) throw new Error(`duplicate sprite id ${id}`);
  seen.add(id);
  out.push({ id, category, key, label, source, dataURL: o.toDataURL("image/png"), w, h, nw: w, nh: h, scale: 1 });
}
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------------------------------------------------------------- survivors
const SURVIVORS = [
  ["1", "Average build, short hair, jacket", { build: "average", skin: "#d9a37c", hairStyle: "short", hair: "#3b2a1e", facial: "stubble", topStyle: "jacket", top: "#3d4a5c", pants: "#2b3442", accessory: "none", accent: "#b8322a" }],
  ["2", "Slim, ponytail, hoodie and cap", { build: "slim", skin: "#f6d7c3", hairStyle: "ponytail", hair: "#9a6a3a", facial: "none", topStyle: "hoodie", top: "#7a3b32", pants: "#4f4a3a", accessory: "cap", accent: "#2d5fa8" }],
  ["3", "Heavy, beard, flannel, beanie", { build: "heavy", skin: "#a06e46", hairStyle: "buzz", hair: "#1d1a17", facial: "beard", topStyle: "flannel", top: "#a4552b", pants: "#36452e", accessory: "beanie", accent: "#3f7a3a" }],
  ["4", "Slim, long hair, t-shirt, glasses", { build: "slim", skin: "#eac3a2", hairStyle: "long", hair: "#c9a25a", facial: "none", topStyle: "tshirt", top: "#2e5e6b", pants: "#22252b", accessory: "glasses", accent: "#1f1f22" }],
  ["5", "Average, mohawk, tank top, bandana", { build: "average", skin: "#7d5233", hairStyle: "mohawk", hair: "#a9442a", facial: "stache", topStyle: "tank", top: "#2f2f33", pants: "#3a3a3a", accessory: "bandana", accent: "#b8322a" }],
  ["6", "Heavy, curly hair, jacket, backpack", { build: "heavy", skin: "#5c3a24", hairStyle: "curly", hair: "#1d1a17", facial: "none", topStyle: "jacket", top: "#5a6b3a", pants: "#5b4632", accessory: "backpack", accent: "#d9b23a" }],
  ["7", "Average, bald, hoodie, headband", { build: "average", skin: "#c08a5f", hairStyle: "bald", hair: "#8a8a8a", facial: "stubble", topStyle: "hoodie", top: "#6b3f6b", pants: "#4a5a6a", accessory: "headband", accent: "#d97a2b" }],
  ["8", "Slim, grey hair, flannel", { build: "slim", skin: "#3f281a", hairStyle: "short", hair: "#e8e4dc", facial: "stache", topStyle: "flannel", top: "#33533b", pants: "#6a6656", accessory: "none", accent: "#7a4aa8" }],
];
for (const [k, label, app] of SURVIVORS) add("survivor", k, `Survivor: ${label}`, S.survivorCanvas(app), `survivorCanvas(appearance #${k})`);

// ---------------------------------------------------------------- gear on a survivor
// Weapons: only keys sprites.js draws (others leave the hands empty: listed as not drawn). Armor: the body piece
// (slot armor) or arm guards (slot arms) the battle sprite shows (inventory.js spriteArmorKey); keys without their own
// look are drawn as the generic vest.
const REF = SURVIVORS[0][2];
const bare = S.survivorCanvas(REF).toDataURL();
const ARMOR_OWN = new Set(["vest", "plate", "padding", "tirevest", "sportspads", "scrapvest"]);
const notDrawn = [];
for (const [key, g] of Object.entries(D.GEAR)) {
  if (g.slot === "weapon") {
    const cv = S.survivorCanvas(REF, key, null);
    if (cv.toDataURL() === bare) { notDrawn.push(key); continue; }
    add("gear", key, `${g.name} (in hand)`, cv, `survivorCanvas(app, "${key}", null)`);
  } else if (g.slot === "armor" || g.slot === "arms") {
    const own = ARMOR_OWN.has(key);
    add("gear", key, `${g.name} (worn)${own ? "" : " – drawn as the generic vest"}`, S.survivorCanvas(REF, null, key), `survivorCanvas(app, null, "${key}")`);
  }
}
window.__gearNotDrawn = notDrawn;

// ---------------------------------------------------------------- zombies (battle)
const ZD = { palette: "mixed", gore: "1", variants: "stats", eyes: "glow", clothes: "torn" };
const ZSEEDS = { walker: [5, 12, 30], runner: [3, 8, 21], bloated: [2, 14, 40], brute: [6, 9, 33] };
for (const v of S.ZOMBIE_VARIANTS) {
  ZSEEDS[v].forEach((seed, i) => add("zombie", i ? `${v}-${i + 1}` : v, `${cap(v)}${i ? ` (another look)` : ""}`, S.zombieCanvas(v, seed, ZD), `zombieCanvas("${v}", ${seed}, default look)`));
}
// The Zombies settings (sprites.js ZOMBIE_LOOK_OPTIONS) change the drawing: each option on the walker.
for (const [opt, def] of Object.entries(S.ZOMBIE_LOOK_OPTIONS)) {
  if (opt === "variants") continue; // which variants appear, not how they look
  for (const [val, name] of def.values) {
    if (val === ZD[opt]) continue;
    const look = { ...ZD, [opt]: val };
    add("zombie", `walker-${opt}-${val}`, `Walker, ${def.name}: ${name}`, S.zombieCanvas("walker", ZSEEDS.walker[0], look), `zombieCanvas("walker", ${ZSEEDS.walker[0]}, { ${opt}: "${val}" })`);
  }
}
// Gore and palette on a brute too (the variant with the most skin showing).
for (const val of ["0", "2"]) add("zombie", `brute-gore-${val}`, `Brute, Gore: ${val === "0" ? "None" : "Heavy"}`, S.zombieCanvas("brute", ZSEEDS.brute[0], { ...ZD, gore: val }), `zombieCanvas("brute", ${ZSEEDS.brute[0]}, { gore: "${val}" })`);

// ---------------------------------------------------------------- special dead and bosses
for (const k of ["spitter", "screamer", "crawler", "carrier", "swarm", "boneback", "climber", "flinger", "sower", "nightmare"]) add("special", k, HC.ZTYPES[k] ? HC.ZTYPES[k].name : cap(k), H.ztypeBattleCanvas(k), `ztypeBattleCanvas("${k}")`);
add("boss", "broodmother", "The Broodmother (hive queen, battle)", H.bossBattleCanvas("broodmother"), `bossBattleCanvas("broodmother")`);
add("boss", "wallbreaker", "The Wallbreaker (battle)", H.bossBattleCanvas("wallbreaker"), `bossBattleCanvas("wallbreaker")`);
add("boss", "wallbreaker-map", "The Wallbreaker walking with a horde (state map)", H.wallbreakerMapCanvas(), `wallbreakerMapCanvas()`);

// ---------------------------------------------------------------- enemy humans (battle)
const FC = { raider: "#d9534f", expansionist: "#e07b54", zealot: "#b065d6", military: "#93c83e", fortress: "#e6dfcc", traders: "#e8a33d", commune: "#5fc28a" };
const HUMANS = [
  ["raiders", "raiders", FC.raider, "shotgun", null, 7, "Raider (shotgun)"],
  ["raiders-2", "raiders", FC.raider, "machete", "vest", 23, "Raider (machete, vest)"],
  ["soldiers", "soldiers", FC.military, "ar", "vest", 4, "Soldier (assault rifle, vest)"],
  ["soldiers-plate", "soldiers", FC.military, "huntrifle", "plate", 19, "Soldier (hunting rifle, plate carrier)"],
  ["zealots", "zealots", FC.zealot, "machete", null, 5, "Zealot (machete)"],
  ["zealots-2", "zealots", FC.zealot, "shotgun", null, 31, "Zealot (shotgun)"],
  ["fighters", "fighters", FC.expansionist, "huntrifle", "vest", 11, "Fighter of another group (drawn in the raider outfit)"],
  ["guards", "guards", FC.fortress, "pistol", null, 16, "Guard (drawn in the raider outfit)"],
  ["militia", "militia", FC.commune, "pipespear", null, 27, "Militia (drawn in the raider outfit)"],
];
for (const [key, kit, color, w, a, seed, label] of HUMANS) add("human", key, label, S.enemyCanvas(kit, color, w, a, seed), `enemyCanvas("${kit}", "${color}", "${w}", ${a ? `"${a}"` : "null"}, ${seed})`);

// ---------------------------------------------------------------- AI group parties (state map)
const GTYPES = Object.keys(D.FACTION_TYPES);
const GKINDS = { convoy: "convoy (vehicle)", raid: "raid", scav: "scavengers with their haul", walk: "on foot" };
for (const t of GTYPES) for (const [k, kl] of Object.entries(GKINDS)) {
  const n = k === "raid" ? 4 : 3;
  add("party", `${t}-${k}`, `${D.FACTION_TYPES[t].label}: ${kl}`, M.groupPartyCanvas(t, k, FC[t], n), `groupPartyCanvas("${t}", "${k}", "${FC[t]}", ${n})`);
}
// Your parties (render.js partyLook): teams in your blue, trade convoys in route green, supply runs in teal.
const PLAYER = "#4f8fd6", ROUTE = "#c9e07a", SUPPLY = "#5cc8b4";
const PKINDS = [
  ["truck", PLAYER, 3, "Your team in a pickup truck"], ["sedan", PLAYER, 3, "Your team in a sedan"],
  ["walkers", PLAYER, 3, "Your team on foot (3)"], ["walkers-1", PLAYER, 1, "Your team on foot (1)", "walkers"], ["walkers-2", PLAYER, 2, "Your team on foot (2)", "walkers"],
  ["raid", PLAYER, 3, "Your raid team on foot (armed)"], ["scouts", PLAYER, 2, "Your recon team"], ["relief", PLAYER, 3, "Your relief squad"],
  ["boat", PLAYER, 3, "Your team crossing by boat"], ["raft", PLAYER, 3, "Your vehicle crossing on a raft"],
  ["convoy", ROUTE, 3, "Your trade-route convoy (vehicle)"], ["cart", ROUTE, 3, "Your trade-route convoy on foot (handcart)"],
  ["supply", SUPPLY, 3, "Your supply run (vehicle)"], ["supplycart", SUPPLY, 3, "Your supply run on foot (handcart)"],
];
for (const [key, color, n, label, kind] of PKINDS) add("party", `player-${key}`, label, M.partySpriteCanvas(kind || key, color, n), `partySpriteCanvas("${kind || key}", "${color}", ${n})`);

// ---------------------------------------------------------------- outsiders, hordes, siege
add("outsider", "raiders", "Outside raiders", M.outsiderPartyCanvas("raiders", "", 3), `outsiderPartyCanvas("raiders", "", 3)`);
add("outsider", "merchants", "Travelling merchants (wagon and oxen)", M.outsiderPartyCanvas("merchants", "", 3), `outsiderPartyCanvas("merchants")`);
for (const sub of ["scouts", "refugees", "wanderers"]) add("outsider", `explorers-${sub}`, `Explorers: ${sub}`, M.outsiderPartyCanvas("explorers", sub, 3), `outsiderPartyCanvas("explorers", "${sub}", 3)`);
add("outsider", "explorers-wanderers-1", "Explorers: a lone wanderer", M.outsiderPartyCanvas("explorers", "wanderers", 1), `outsiderPartyCanvas("explorers", "wanderers", 1)`);
add("horde", "small", "Horde, small (under 15 dead: 2 figures)", M.hordeSpriteCanvas(2), "hordeSpriteCanvas(2)");
add("horde", "medium", "Horde, medium (25–39 dead: 4 figures)", M.hordeSpriteCanvas(4), "hordeSpriteCanvas(4)");
add("horde", "large", "Horde, large (90+ dead: 7 figures)", M.hordeSpriteCanvas(7), "hordeSpriteCanvas(7)");
add("siege", "camp", "Siege camp beside a besieged base (attacker's color)", M.siegeCampCanvas(FC.raider), `siegeCampCanvas("${FC.raider}")`);

// ---------------------------------------------------------------- hives
const HIVE_LV = ["Hive (infection under 50%)", "Hive (infection 50–79%)", "Hive (infection 80%+)"];
for (let lv = 0; lv < 3; lv++) add("hive", String(lv), HIVE_LV[lv], M.hiveSpriteCanvas(lv), `hiveSpriteCanvas(${lv})`);
for (const [k, g] of Object.entries(HC.GROWTHS)) {
  add("growth", k, g.name, H.growthCanvas(k, false), `growthCanvas("${k}")`);
  add("growth", `${k}-withered`, `${g.name} (withered: its hive destroyed)`, H.growthCanvas(k, true), `growthCanvas("${k}", true)`);
}
add("site", "planned", "Hive build site (gathering)", H.siteSpriteCanvas(false), "siteSpriteCanvas(false)");
add("site", "started", "Hive build site (building started)", H.siteSpriteCanvas(true), "siteSpriteCanvas(true)");

// ---------------------------------------------------------------- your bases
const look = (o) => ({ kind: "hub", color: PLAYER, walls: 0, tower: false, radio: false, hosp: 0, farms: 0, workshop: false, big: false, ...o });
// One image per look feature and level (render.js baseLook maps buildings to features: walls = count of "walls"
// (0-3); tower = a watchtower; radio = a radio station, or a relay at an outpost; hosp = tier of the hospital family
// (infirmary 1, field_hosp 2, clinic 3, hospital 4); farms = farm_plot buildings (1-3 -> 1, 4+ -> 2); workshop = any
// workshop station (ammo_bench, med_station, machine_shop, kitchen, generator, still); big = 4+ buildings).
// The hub ignores `big`; the outpost shows farms 1 and 2 alike and hospital tiers 3 and 4 alike.
const BASES = [
  ["plain", "Hub, as founded (no features)", {}],
  ["walls-1", "Hub with walls built once (wall strength 1)", { walls: 1 }], ["walls-2", "Hub with walls built twice", { walls: 2 }], ["walls-3", "Hub with walls built three times (full)", { walls: 3 }],
  ["tower", "Hub with a watchtower", { tower: true }], ["radio", "Hub with a radio station (mast)", { radio: true }],
  ["workshop", "Hub with a workshop station (smoking chimney)", { workshop: true }],
  ["farms-1", "Hub with 1-3 farm plots built", { farms: 1 }], ["farms-2", "Hub with 4+ farm plots built", { farms: 2 }],
  ["hospital-1", "Hub with a makeshift infirmary (tent)", { hosp: 1 }], ["hospital-2", "Hub with a field hospital (bigger tent)", { hosp: 2 }],
  ["hospital-3", "Hub with a clinic", { hosp: 3 }], ["hospital-4", "Hub with a trauma hospital", { hosp: 4 }],
  ["full", "Hub, fully built", { walls: 3, tower: true, radio: true, hosp: 4, farms: 2, workshop: true, big: true }],
  ["outpost", "Outpost, as founded (no features)", { kind: "outpost" }],
  ["outpost-walls-1", "Outpost with walls built once", { kind: "outpost", walls: 1 }], ["outpost-walls-2", "Outpost with walls built twice", { kind: "outpost", walls: 2 }],
  ["outpost-walls-3", "Outpost fully walled", { kind: "outpost", walls: 3 }],
  ["outpost-tower", "Outpost with a watchtower", { kind: "outpost", tower: true }], ["outpost-radio", "Outpost with a radio relay or station", { kind: "outpost", radio: true }],
  ["outpost-workshop", "Outpost with a workshop station", { kind: "outpost", workshop: true }], ["outpost-farms", "Outpost with farm plots built", { kind: "outpost", farms: 1 }],
  ["outpost-hospital-1", "Outpost with a makeshift infirmary", { kind: "outpost", hosp: 1 }], ["outpost-hospital-2", "Outpost with a field hospital", { kind: "outpost", hosp: 2 }],
  ["outpost-hospital-3", "Outpost clinic or hospital (tiers 3-4 look alike)", { kind: "outpost", hosp: 3 }],
  ["outpost-big", "Outpost with 4+ buildings (a second house)", { kind: "outpost", big: true }],
  ["outpost-full", "Outpost, fully built", { kind: "outpost", walls: 3, tower: true, radio: true, hosp: 3, farms: 1, workshop: true, big: true }],
];
for (const [k, label, o] of BASES) add("base", k, label, M.baseSpriteCanvas(look(o)), `baseSpriteCanvas(${JSON.stringify(look(o))})`);
for (const t of GTYPES) add("factionbase", t, `${D.FACTION_TYPES[t].label} base`, M.factionBaseCanvas(t, FC[t]), `factionBaseCanvas("${t}", "${FC[t]}")`);

// ---------------------------------------------------------------- map locations
for (const [t, loc] of Object.entries(D.LOCATIONS)) {
  add("poi", t, loc.name, M.poiSpriteCanvas(t, "", 0), `poiSpriteCanvas("${t}")`);
  add("poi", `${t}-faded`, `${loc.name} (picked over: little left)`, M.poiSpriteCanvas(t, "", 2), `poiSpriteCanvas("${t}", "", 2)`);
}
add("poi", "military-depot", "Army depot (military site variant)", M.poiSpriteCanvas("military", "depot", 0), `poiSpriteCanvas("military", "depot")`);
add("poi", "town-faded1", "Town (picked over: some left)", M.poiSpriteCanvas("town", "", 1), `poiSpriteCanvas("town", "", 1)`);
add("poi", "town-faded3", "Town (picked clean)", M.poiSpriteCanvas("town", "", 3), `poiSpriteCanvas("town", "", 3)`);

// ---------------------------------------------------------------- camps, ruins, markers, icons, misc
const TENT = "#d2b36c";
add("camp", "lit", "A team's camp (tent and campfire)", M.campSpriteCanvas(TENT, true), `campSpriteCanvas("${TENT}", true)`);
add("camp", "unlit", "Abandoned camp (cold fire)", M.campSpriteCanvas(TENT, false), `campSpriteCanvas("${TENT}", false)`);
add("ruin", "group","Ruins of a razed base", M.ruinSpriteCanvas(false), "ruinSpriteCanvas(false)");
add("ruin", "yours", "Ruins of one of your bases (blue rag)", M.ruinSpriteCanvas(true), "ruinSpriteCanvas(true)");
const MARKERS = [
  ["death", "Death site (gear still there)", "death", {}], ["death-empty", "Death site (nothing left)", "death", { empty: true }],
  ["cache", "Supply cache", "cache", {}], ["cache-emptied", "Supply cache (emptied)", "cache", { emptied: true }],
  ["car", "Wrecked car", "car", {}], ["car-emptied", "Wrecked car (stripped)", "car", { emptied: true }],
  ["camp", "Abandoned camp", "camp", {}], ["camp-emptied", "Abandoned camp (picked through)", "camp", { emptied: true }],
  ["hive", "Hive marker", "hive", {}],
  ["vehicle-truck", "Your parked truck", "vehicle", { vehicle: "truck" }],
  ["vehicle-truck-fuel", "Your parked truck (needs fuel)", "vehicle", { vehicle: "truck", needsFuel: true }],
  ["vehicle-truck-damaged", "Your parked truck (badly damaged)", "vehicle", { vehicle: "truck", damaged: true }],
  ["vehicle-sedan", "Your parked sedan", "vehicle", { vehicle: "sedan" }],
  ["vehicle-sedan-fuel-damaged", "Your parked sedan (needs fuel, damaged)", "vehicle", { vehicle: "sedan", needsFuel: true, damaged: true }],
  ["vehicle-bike", "Your bicycles left on the ground", "vehicle", { vehicle: "bike" }],
  ["vehicle-bike-damaged", "Your bicycles (damaged)", "vehicle", { vehicle: "bike", damaged: true }],
];
for (const [k, label, type, opt] of MARKERS) add("marker", k, label, M.markerSpriteCanvas(type, PLAYER, opt), `markerSpriteCanvas("${type}", "${PLAYER}", ${JSON.stringify(opt)})`);
const ICONS = [
  ["alert", "Waiting for orders", "alert", "#ffd166"], ["alert-base", "Base alert", "alert", "#ff9f43"],
  ["unknown", "Estimated position (team out of radio contact)", "unknown", PLAYER],
  ["work", "Busy on the spot", "work", undefined], ["radio", "In radio contact", "radio", undefined], ["siege", "Siege (crossed swords)", "siege", undefined],
];
for (const [k, label, kind, color] of ICONS) add("icon", k, label, M.iconCanvas(kind, color), `iconCanvas("${kind}"${color ? `, "${color}"` : ""})`);
add("misc", "bridge", "Road bridge over a river", M.bridgeCanvas(), "bridgeCanvas()");
add("misc", "wake", "Boat wake", M.wakeCanvas(), "wakeCanvas()");
add("misc", "skull", "Danger skull (one per danger level under a site's name)", M.skullCanvas(), "skullCanvas()");
add("misc", "redskull", "Red skull (inside a hive's ring)", H.redSkullCanvas(), "redSkullCanvas()");
add("misc", "smoke", "Smoke column over a crash search circle", M.searchSmokeCanvas(), "searchSmokeCanvas()");

// ---------------------------------------------------------------- terrain decals (terraindeco.js)
// Atlas cell i: plain at src[((0 * n + i) * 2 + 0) * 4], snow-capped at ... + 1. Set sizes in makeSprites order.
const at = T.decoAtlas(1);
const SET_N = { tree: 3, autumn: 2, pine: 2, bush: 2, tuft: 2, rock: 3, crops: 4, fence: 1, hay: 1, deadtree: 1, car: 5, wreck: 2, rubble: 2, house: 4, burnt: 3, building: 4, ruin: 2, peak: 2, mound: 2, reeds: 1 };
const SET_AT = {};
{
  let i = 0;
  for (const k of T.DECO_SETS) { if (!(k in SET_N)) throw new Error(`terrain set ${k} unknown to the catalogue`); SET_AT[k] = i; i += SET_N[k]; }
  if (i !== at.sprites) throw new Error(`terrain sprite count ${i} != atlas ${at.sprites}`);
  if (T.SEASON_LOOK.winter[SET_AT.autumn] !== SET_AT.deadtree) throw new Error("terrain set layout changed");
}
const cell = (i, snow) => { const o = (i * 2 + (snow ? 1 : 0)) * 4; return [at.src[o], at.src[o + 1], at.src[o + 2], at.src[o + 3]]; };
function strip(list, snow) {
  const cells = list.map((i) => cell(i, snow));
  const w = cells.reduce((s, c) => s + c[2], 0) + (cells.length - 1) * 2, h = Math.max(...cells.map((c) => c[3]));
  const o = document.createElement("canvas");
  o.width = w; o.height = h;
  const c = o.getContext("2d");
  let x = 0;
  for (const [sx, sy, sw, sh] of cells) { c.drawImage(at.cv, sx, sy, sw, sh, x, h - sh, sw, sh); x += sw + 2; }
  return o;
}
const SET_LABEL = { tree: "Broadleaf trees", autumn: "Turning trees", pine: "Pines", bush: "Bushes", tuft: "Grass tufts", rock: "Rocks", crops: "Crop rows", fence: "Fence", hay: "Hay bale", deadtree: "Dead tree", car: "Parked cars", wreck: "Burnt-out wrecks", rubble: "Rubble", house: "Houses", burnt: "Burnt houses", building: "City buildings", ruin: "Ruined buildings", peak: "Mountain peaks", mound: "Hill mounds", reeds: "Reeds" };
const range = (k) => Array.from({ length: SET_N[k] }, (_, j) => SET_AT[k] + j);
for (const k of T.DECO_SETS) {
  if (k === "autumn") continue;
  add("terrain", `${k}-summer`, `${SET_LABEL[k]} (terrain detail)`, strip(range(k), false), `decoAtlas(1) set "${k}"`, 1);
  add("terrain", `${k}-winter`, `${SET_LABEL[k]} under snow`, strip(range(k), true), `decoAtlas(1) set "${k}", snow-capped`, 1);
}
// The turning broadleaf trees by season (SEASON_LOOK): green in spring and summer, gold and red in autumn, bare in winter.
for (const [season, snow] of [["spring", false], ["summer", false], ["autumn", false], ["winter", true]]) {
  const list = range("autumn").map((i) => T.SEASON_LOOK[season][i]);
  add("terrain", `autumn-${season}`, `Turning broadleaf trees in ${season}`, strip(list, snow), `SEASON_LOOK.${season} over set "autumn"`, 1);
}
// Water texture (rivers and lakes): a 64 x 64 crop of the 256 x 256 tile.
{
  const wc = D.TERRAIN.water.color, rgbOf = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const wt = T.waterTexture(1, rgbOf(wc), 0);
  const o = document.createElement("canvas");
  o.width = 64; o.height = 64;
  o.getContext("2d").drawImage(wt.cv, 0, 0, 64, 64, 0, 0, 64, 64);
  add("terrain", "water", "Water texture (rivers and lakes)", o, "waterTexture(1, TERRAIN.water.color)", 1);
}
// One hex of each terrain: its flat map color with a typical scatter of its decals (render.js HEX = 26).
{
  const R = 26, SQ = Math.sqrt(3), W = Math.ceil(R * SQ) + 2, Hh = R * 2 + 2;
  const SCATTER = {
    plains: [["crops", 0, -12, -4], ["crops", 1, 0, 6], ["tuft", 0, 12, -10], ["hay", 0, 10, 2], ["tree", 0, -14, 10]],
    forest: [["tree", 0, -10, -10], ["tree", 1, 4, -12], ["pine", 0, 12, -4], ["tree", 2, -14, 4], ["pine", 1, -2, 2], ["tree", 0, 10, 10], ["pine", 0, -6, 14]],
    hills: [["mound", 0, -8, -6], ["mound", 1, 6, 6], ["rock", 0, 12, -8], ["bush", 0, -12, 10]],
    mountain: [["peak", 0, -6, -6], ["peak", 1, 8, 6], ["rock", 1, -12, 12]],
    suburb: [["house", 0, -10, -8], ["house", 1, 8, -10], ["burnt", 0, -8, 8], ["house", 2, 10, 6], ["car", 1, 0, 0]],
    city: [["building", 0, -10, -8], ["building", 2, 8, -10], ["ruin", 0, -8, 9], ["building", 1, 9, 7], ["rubble", 0, 0, 1]],
    water: [],
  };
  const wt = T.waterTexture(1, [44, 79, 107], 0);
  for (const [t, def] of Object.entries(D.TERRAIN)) {
    const o = document.createElement("canvas");
    o.width = W; o.height = Hh;
    const c = o.getContext("2d");
    const cx = W / 2, cy = Hh / 2;
    c.beginPath();
    for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + (i * Math.PI) / 3; c.lineTo(cx + R * Math.cos(a), cy + R * Math.sin(a)); }
    c.closePath();
    c.save();
    c.clip();
    c.fillStyle = def.color;
    c.fillRect(0, 0, W, Hh);
    if (t === "water") c.drawImage(wt.cv, 0, 0, W, Hh, 0, 0, W, Hh);
    for (const [set, j, dx, dy] of SCATTER[t] || []) {
      const [sx, sy, sw, sh] = cell(SET_AT[set] + j, false);
      c.drawImage(at.cv, sx, sy, sw, sh, Math.round(cx + dx - sw / 2), Math.round(cy + dy - sh / 2), sw, sh);
    }
    c.restore();
    c.strokeStyle = "rgba(0,0,0,0.35)";
    c.lineWidth = 1;
    c.stroke();
    add("terrain", `hex-${t}`, `${def.name} hex (map color and terrain detail)`, o, `TERRAIN.${t}.color + terrain decals (composed for the doc)`, 1);
  }
}

// ---------------------------------------------------------------- battle map (ui/combat.js drawObject, vector)
const CS = 128;
const cbv = document.createElement("canvas");
C.initCombatUI(cbv);
const INDOOR = new Set(["shelf", "locker", "cabinet", "counter", "stairs", "loft", "bdoor", "doorway", "smashed"]);
const STRUCT = new Set(["wall", "window", "palisade", "gate", "breach", "tower", "walkway", "ladder", "stairs", "roof", "loft", "bdoor", "doorway", "smashed", "rubble", "barricade", "spikes", "trench", "wire", "beartrap", "sandbag", "well", "barrel", "hivewall"]);
function drawCell(k, floor, cell) {
  return (ctx, o) => {
    // drawObject paints on ui/combat.js's own context: draw there, then copy.
    cbv.width = CS; cbv.height = CS;
    const g = cbv.getContext("2d");
    g.clearRect(0, 0, CS, CS);
    g.fillStyle = C.__FLOOR[floor] || C.__FLOOR.grass;
    g.fillRect(0, 0, CS, CS);
    C.__drawObject(k, 0, 0, CS, 0.37, cell);
    ctx.drawImage(cbv, 0, 0);
  };
}
for (const [k, def] of Object.entries(SIMC.CELL)) {
  if (k === "open" || k === "door") continue;
  const floor = INDOOR.has(k) ? "floor" : k === "road" ? "road" : "grass";
  const cat = STRUCT.has(k) ? "building" : "battle";
  if (k === "gate") {
    addVector("building", "gate", "Gate (open, a leaf off its hinge)", CS, CS, drawCell("gate", "dirt", { k: "gate", hp: 10, mhp: 10 }), `drawObject("gate") (ui/combat.js)`);
    addVector("building", "gate-barred", "Gate (shut and barred)", CS, CS, drawCell("gate", "dirt", { k: "gate", bar: true, hp: 10, mhp: 10 }), `drawObject("gate", barred) (ui/combat.js)`);
    continue;
  }
  addVector(cat, k, `${def.name} (battle map cell)`, CS, CS, drawCell(k, floor, { k }), `drawObject("${k}") (ui/combat.js)`);
}
// Locked doors and containers on a raid map (ui/locks.js drawLocks).
for (const [k, label, kind] of [["door-locked", "Locked door (raid)", "door"], ["door-vault", "Steel security door (raid)", "vault"]]) {
  addVector("building", k, label, CS, CS, (ctx) => {
    ctx.fillStyle = C.__FLOOR.floor; ctx.fillRect(0, 0, CS, CS);
    L.drawLocks(ctx, { raid: { doors: [{ x: 0, y: 0, lock: { kind, open: false } }], containers: [] } }, 0, 0, CS);
  }, `drawLocks(door kind "${kind}") (ui/locks.js)`);
}
addVector("building", "lockbox", "Locked container on a raid (padlock over a cabinet)", CS, CS, (ctx) => {
  ctx.fillStyle = C.__FLOOR.floor; ctx.fillRect(0, 0, CS, CS);
  cbv.width = CS; cbv.height = CS;
  const g = cbv.getContext("2d"); g.clearRect(0, 0, CS, CS);
  C.__drawObject("cabinet", 0, 0, CS, 0.37, { k: "cabinet" });
  ctx.drawImage(cbv, 0, 0);
  L.drawLocks(ctx, { raid: { doors: [], containers: [{ x: 0, y: 0, lock: { kind: "lockbox", open: false }, searched: false }] } }, 0, 0, CS);
}, "drawObject(\"cabinet\") + drawLocks(container) (ui/locks.js)");
// Battle floors.
for (const [f, col] of Object.entries(C.__FLOOR)) addVector("terrain", `floor-${f}`, `Battle floor: ${f}`, 64, 64, (ctx) => { ctx.fillStyle = col; ctx.fillRect(0, 0, 64, 64); }, `FLOOR.${f} (ui/combat.js)`);

// Thrown items (ui/combat.js drawThrowable): THROWABLES keys plus the other items it draws.
const THROWN = [...new Set([...ST.THROW_KEYS, "bottle", "noisemaker", "firecracker", "flare", "molotov", "pipebomb", "smokegren", "gamecall"])];
for (const k of THROWN) {
  const g = D.GEAR[k];
  addVector("item", k, `${g ? g.name : cap(k)} (thrown, on the battle map)`, 144, 144, (ctx) => {
    cbv.width = 144; cbv.height = 144;
    const cg = cbv.getContext("2d"); cg.clearRect(0, 0, 144, 144);
    C.__drawThrowable(k, 72, 78, 260);
    ctx.drawImage(cbv, 0, 0);
  }, `drawThrowable("${k}") (ui/combat.js)`);
}

// ---------------------------------------------------------------- done
window.__sprites = out;
window.__spritesDone = true;
const byCat = {};
for (const e of out) (byCat[e.category] ||= []).push(e);
document.getElementById("out").innerHTML = Object.entries(byCat).map(([cat, list]) => `<div class="cat">${cat} (${list.length})</div><div class="grid">${list.map((e) => `<figure><img src="${e.dataURL}" title="${e.source.replace(/"/g, "&quot;")}"><figcaption>${e.id}<br>${e.label}</figcaption></figure>`).join("")}</div>`).join("") + `<p>Weapons not drawn on the sprite: ${notDrawn.join(", ")}</p>`;
