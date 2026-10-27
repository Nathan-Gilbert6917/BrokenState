// The weapon models in the figures' hands, every weapon, as a gallery page (issue #77): the 3D survivor figure holding
// each weapon at three headings (SE, SW, NW) beside its 2D art (the gun builder's drawing for a gun, the item icon
// for the rest), grouped by weapon class; a raider and a soldier (an AI group's kit) with a few of them; the figure
// lying dead with its weapon beside it; and, with --before, the same figures painted by another checkout's
// ui/figures.js (origin/dev in a worktree) for the change. Pure Node: the painters' pixel grids go to PNGs through
// tools/pngout.js, no browser. The page is self-contained (the pictures as data URLs, light and dark, phone width),
// for publishing as an artifact; nothing is committed.
// Usage (from prototype/): node tools/weaponsheet.js [outdir] [--before <other checkout>/prototype] [--battle <png>]
//   outdir/weaponsheet.html, outdir/weapons.json (the list: key, name, class, hold, model length). --battle: a battle-map
//   screenshot (tools/weaponmapshot.cjs) embedded at the top.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { GEAR } from "../src/sim/data.js";
import { KITS } from "../src/sim/combat.js";
import * as F from "../src/ui/figures.js";
import { weaponModel, HOLDS } from "../src/ui/weaponmodels.js";
import { itemPixels } from "../src/ui/itemart.js";
import { paintGun, isGunKey } from "../src/ui/gunart.js";
import { specOf, norm } from "../src/ui/gunpaint.js";
import { rgbaOf, pngOf } from "./pngout.js";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
const outDir = resolve(args.find((a, i) => !a.startsWith("--") && (i === 0 || !args[i - 1].startsWith("--"))) || join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "shots", "weapons"));
const beforeDir = opt("--before"), battlePng = opt("--battle");
mkdirSync(outDir, { recursive: true });

const UP = 3;
const png = (p, up = UP) => `data:image/png;base64,${pngOf(rgbaOf(p), p.w, p.h, up).toString("base64")}`;
const LOOKS = {
  survivor: { build: "average", skin: "#eac3a2", hairStyle: "short", hair: "#6b4526", facial: "stubble", topStyle: "jacket", top: "#3d4a5c", pants: "#3a3a3a", accessory: "cap", accent: "#b8322a" },
  heavy: { build: "heavy", skin: "#7d5233", hairStyle: "buzz", hair: "#1d1a17", facial: "beard", topStyle: "flannel", top: "#5a6b3a", pants: "#4f4a3a", accessory: "none", accent: "#d9b23a" },
};
const HEADINGS = [["SE", 0], ["SW", 90], ["NW", 180]];

// ---- the weapons, grouped by class ----
const keys = new Set(Object.keys(GEAR).filter((k) => GEAR[k].slot === "weapon"));
for (const kit of Object.values(KITS)) for (const w of kit.weapons) keys.add(w);
const kitsOf = (k) => Object.entries(KITS).filter(([, kit]) => kit.weapons.includes(k)).map(([n]) => n);
function classOf(k) {
  const g = GEAR[k] || {}, m = weaponModel(k), hold = m ? m.hold : null;
  if (isGunKey(k)) {
    const s = norm(specOf(k).key);
    if (s.kind === "pistol" || s.kind === "revolver") return "Pistols and revolvers";
    if (s.kind === "smg") return "Submachine guns";
    if (s.kind === "mg") return "Machine guns";
    if (s.kind === "launcher" || g.cat === "explosive") return "Launchers";
    if (g.cat === "shotgun") return "Shotguns";
    return g.cat === "automatic" ? "Assault and battle rifles" : "Rifles and carbines";
  }
  if (g.cat === "bow") return "Bows and crossbows";
  if (hold === "spear") return "Spears";
  if (hold === "sword" || hold === "sabre") return "Swords";
  if (hold === "shoulder") return "Clubs, axes and long tools";
  return g.small ? "Knives" : "Machetes and hand tools";
}
const ORDER = ["Pistols and revolvers", "Submachine guns", "Assault and battle rifles", "Rifles and carbines", "Shotguns", "Machine guns", "Launchers", "Knives", "Machetes and hand tools", "Swords", "Clubs, axes and long tools", "Spears", "Bows and crossbows"];
const list = [...keys].map((k) => ({ key: k, name: (GEAR[k] && GEAR[k].name) || k, cls: classOf(k), hold: weaponModel(k) ? weaponModel(k).hold : null, len: weaponModel(k) ? +weaponModel(k).len.toFixed(1) : 0, kits: kitsOf(k) }))
  .sort((a, b) => ORDER.indexOf(a.cls) - ORDER.indexOf(b.cls) || a.name.localeCompare(b.name));
writeFileSync(join(outDir, "weapons.json"), JSON.stringify(list, null, 1));

// ---- the other checkout's painter (the pictures before the change) ----
let before = null;
if (beforeDir) {
  const u = pathToFileURL(resolve(beforeDir, "src/ui/figures.js")).href;
  before = (await import(u)).paintBoxFigure;
}
const BEFORE_KEYS = ["ar", "shotgun", "huntrifle", "sniper", "pistol", "revolver", "machete", "knife", "hatchet", "sledge", "fireaxe", "katana", "spear", "compbow", "xbow", "at4"];

// ---- the pictures ----
const art2d = (k) => {
  if (isGunKey(k)) return { src: png(paintGun(k), 2), w: 64 * 2, h: 24 * 2 };
  const q = itemPixels(k);
  return q ? { src: png(q, 4), w: q.w * 4, h: q.h * 4 } : null;
};
const fig = (app, look, armor, yaw) => { const p = F.paintBoxFigure(app, look, armor, yaw); return { src: png(p), w: p.w * UP, h: p.h * UP }; };
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/"/g, "&quot;");
const img = (o, alt = "", cls = "fig") => (o ? `<img class="${cls}" src="${o.src}" width="${o.w}" height="${o.h}" alt="${esc(alt)}">` : "");

const cards = [];
for (const w of list) {
  const heads = HEADINGS.map(([n, yaw]) => `<figure><div class="tile">${img(fig(LOOKS.survivor, w.key, "vest", yaw), `${w.name} ${n}`)}</div><figcaption>${n}</figcaption></figure>`).join("");
  const icon = art2d(w.key);
  const bef = before && BEFORE_KEYS.includes(w.key) ? `<div class="before"><span class="lbl">before</span>${[0, 90].map((yaw) => { const p = before(LOOKS.survivor, w.key, "vest", yaw); return `<div class="tile">${img({ src: png(p), w: p.w * UP, h: p.h * UP }, `${w.name} before`)}</div>`; }).join("")}</div>` : "";
  cards.push({ cls: w.cls, html: `<article class="card" id="${esc(w.key)}">
  <header><h3>${esc(w.name)}</h3><span class="key">${esc(w.key)}</span><span class="hold">${esc(w.hold)}</span></header>
  <div class="row">${heads}<figure class="art"><div class="iconbox">${img(icon, `${w.name} 2D art`, "icon")}</div><figcaption>2D art</figcaption></figure>${bef}</div>
  ${w.kits.length ? `<p class="kits">Carried by: ${esc(w.kits.join(", "))}</p>` : ""}
</article>` });
}
// A raider and a soldier with a few weapons (ui/figures.js enemyApp is private: the same looks built here from the kits' rolls).
const { enemyLookOf } = await import("../src/ui/sprites.js");
const { shade } = await import("../src/ui/itemart/kit.js");
function enemyApp(kit, color, seed) {
  const k = enemyLookOf(kit, seed), fc = color;
  if (kit === "soldiers") return { build: "average", skin: k.skin, hairStyle: "buzz", hair: k.hair, facial: k.facial, topStyle: "jacket", top: k.olive, pants: shade(k.olive, -0.1), accessory: "none", accent: fc, helmet: "milhelmet", armband: fc };
  return { build: "average", skin: k.skin, hairStyle: k.hairStyle, hair: k.hair, facial: k.facial, topStyle: k.topStyle, top: k.jacket, pants: k.pants, accessory: k.acc, accent: fc };
}
const people = [
  ["A raider", enemyApp("raiders", "#a63a32", 5), "vest", ["sawnoff", "machete", "revolver44", "nailbat", "uzi", "sks"]],
  ["A soldier (an AI group's kit)", enemyApp("soldiers", "#2f5d8a", 11), "plate", ["m4", "ar", "smg", "lmg", "sniper", "carbine"]],
  ["A heavy build with wood and steel", LOOKS.heavy, null, ["leverrifle", "dbshotgun", "ak", "fal", "m1a", "pump20"]],
];
const peopleHtml = people.map(([title, app, armor, ws]) => `<article class="card wide"><header><h3>${esc(title)}</h3></header><div class="row">${ws.map((k) => `<figure><div class="tile">${img(fig(app, k, armor, 0), k)}${img(fig(app, k, armor, 90), k)}</div><figcaption>${esc(GEAR[k].name)}</figcaption></figure>`).join("")}</div></article>`).join("");
// Fitted parts and the fallen.
const fitted = [["m4|black|optic=acog,muzzle=can_l", "M4, ACOG and suppressor"], ["ar|black|mag=drum", "AR, drum"], ["carbine|black|optic=scope4,stock=precision,bipod=bipod", "Carbine, scope, precision stock, bipod"], ["pistol|black|muzzle=can_s", "Pistol, suppressor"], ["ak|black|", "AK, black polymer"], ["shotgun|black|under=weaponlight", "Pump, weapon light"]];
const fittedHtml = `<article class="card wide"><header><h3>Fitted parts and finishes on the model</h3></header><div class="row">${fitted.map(([l, n]) => `<figure><div class="tile">${img(fig(LOOKS.survivor, l, "vest", 0), n)}${img(fig(LOOKS.survivor, l, "vest", 90), n)}</div><figcaption>${esc(n)}</figcaption></figure>`).join("")}</div></article>`;
const dead = ["shotgun", "ar", "machete", "sledge"].map((k) => { const p = F.paintBoxFigure({ ...LOOKS.survivor, down: { pose: "dead", pool: true } }, k, "vest", 0); return `<figure><div class="tile">${img({ src: png(p), w: p.w * UP, h: p.h * UP }, k)}</div><figcaption>${esc(GEAR[k].name)}</figcaption></figure>`; }).join("");
const deadHtml = `<article class="card wide"><header><h3>Fallen: the weapon dropped beside the hand</h3></header><div class="row">${dead}</div><p class="kits">Until the body is searched; a downed survivor who is alive shows none.</p></article>`;

const battle = battlePng && existsSync(battlePng) ? `<section class="battle"><h2>On the battle map</h2><img src="data:image/png;base64,${readFileSync(battlePng).toString("base64")}" alt="Armed figures on the battle map"></section>` : "";
const counts = ORDER.map((c) => [c, list.filter((w) => w.cls === c).length]);
const holdCounts = HOLDS.map((h) => `${h} ${list.filter((w) => w.hold === h).length}`).join(" · ");

const html = `<title>Broken State Weapon Models</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;700&family=Source+Sans+3:wght@400;600&family=IBM+Plex+Mono:wght@400;500&display=swap">
<style>
/* layout: a field manual of the arsenal: a sticky class index over a grid of cards, the figures on the map's own ground */
:root { --bg: #f1efe8; --fg: #1f2320; --muted: #5d655c; --panel: #e6e3d8; --line: #cbc8bb; --accent: #8a6a1e; --tile: #4f6238; --tile2: #5a6d3f; --before: #d9d2bf;
  --display: "Barlow Condensed", "Arial Narrow", sans-serif; --body: "Source Sans 3", "Segoe UI", sans-serif; --mono: "IBM Plex Mono", Menlo, monospace; }
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --bg: #1b1e1c; --fg: #e4e2d8; --muted: #9ea699; --panel: #262a27; --line: #3a403b; --accent: #d1b05a; --tile: #3f5030; --tile2: #4a5c38; --before: #30332c; color-scheme: dark; } }
:root[data-theme="dark"] { --bg: #1b1e1c; --fg: #e4e2d8; --muted: #9ea699; --panel: #262a27; --line: #3a403b; --accent: #d1b05a; --tile: #3f5030; --tile2: #4a5c38; --before: #30332c; color-scheme: dark; }
body { background: var(--bg); color: var(--fg); font-family: var(--body); line-height: 1.45; padding-left: max(16px, env(safe-area-inset-left, 0px)); padding-right: max(16px, env(safe-area-inset-right, 0px)); padding-block: 0 48px; }
.wrap { max-width: 1180px; margin: 0 auto; }
h1, h2, h3 { font-family: var(--display); font-weight: 700; text-wrap: balance; margin: 0; letter-spacing: 0.01em; }
h1 { font-size: clamp(2rem, 5vw, 3.2rem); line-height: 1; padding-top: 28px; }
h2 { font-size: 1.6rem; margin: 36px 0 12px; border-bottom: 2px solid var(--accent); padding-bottom: 4px; }
h3 { font-size: 1.25rem; font-weight: 500; }
.lead { max-width: 65ch; color: var(--muted); margin: 10px 0 0; }
.lead b { color: var(--fg); font-weight: 600; }
nav.idx { position: sticky; top: env(safe-area-inset-top, 0px); background: var(--bg); padding: 10px 0; border-bottom: 1px solid var(--line); margin-top: 18px; z-index: 5; display: flex; flex-wrap: wrap; gap: 6px 10px; font-family: var(--mono); font-size: 0.78rem; }
nav.idx a { color: var(--fg); text-decoration: none; padding: 2px 8px; border: 1px solid var(--line); border-radius: 999px; }
nav.idx a:hover, nav.idx a:focus-visible { border-color: var(--accent); outline: none; }
nav.idx a small { color: var(--muted); }
.stats { font-family: var(--mono); font-size: 0.78rem; color: var(--muted); margin: 8px 0 0; }
.grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 1fr)); gap: 14px; }
.card { background: var(--panel); border: 1px solid var(--line); padding: 10px 12px 8px; min-width: 0; }
.card.wide { grid-column: 1 / -1; }
.card header { display: flex; align-items: baseline; flex-wrap: wrap; gap: 4px 10px; margin-bottom: 8px; }
.key { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); }
.hold { margin-left: auto; font-family: var(--mono); font-size: 0.72rem; letter-spacing: 0.06em; text-transform: uppercase; color: var(--accent); border: 1px solid var(--accent); padding: 0 6px; border-radius: 3px; }
.row { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px; }
figure { margin: 0; display: flex; flex-direction: column; align-items: center; gap: 3px; min-width: 0; }
figcaption { font-family: var(--mono); font-size: 0.7rem; color: var(--muted); letter-spacing: 0.04em; }
.tile { background: var(--tile); background-image: linear-gradient(45deg, var(--tile2) 25%, transparent 25%, transparent 75%, var(--tile2) 75%); background-size: 12px 12px; padding: 4px; display: flex; gap: 2px; border-radius: 3px; }
img { image-rendering: pixelated; display: block; max-width: 100%; height: auto; }
img.fig { width: 72px; }
.iconbox { background: var(--before); padding: 6px; display: flex; align-items: center; justify-content: center; min-height: 64px; border-radius: 3px; }
img.icon { max-height: 48px; width: auto; }
.before { display: flex; align-items: flex-end; gap: 4px; padding: 4px; border: 1px dashed var(--line); border-radius: 3px; }
.before .tile { filter: saturate(0.6); }
.before .lbl { writing-mode: vertical-rl; transform: rotate(180deg); font-family: var(--mono); font-size: 0.68rem; color: var(--muted); letter-spacing: 0.08em; text-transform: uppercase; }
.kits { font-size: 0.82rem; color: var(--muted); margin: 8px 0 0; }
.battle img { width: 100%; height: auto; border: 1px solid var(--line); }
@media (max-width: 600px) { nav.idx { position: static; } img.fig { width: 56px; } .card header { gap: 2px 8px; } }
</style>
<div class="wrap">
<h1>Broken State weapon models</h1>
<p class="lead">Every weapon a survivor, a raider or an AI group's survivor can hold, as its own low-poly model in the 3D figure's hands (<b>${list.length} weapons</b>, issue #77). Each card: the figure at the view's SE, SW and NW headings, the weapon's 2D art beside it, and the pose class it is held in. Guns are built from their own gun-builder drawing's spec, so proportions and colours are the drawing's; melee weapons, bows and launchers from a table with the item icons' colours.</p>
<p class="stats">Pose classes: ${holdCounts}</p>
<nav class="idx">${counts.map(([c, n]) => `<a href="#${esc(c.toLowerCase().replace(/[^a-z]+/g, "-"))}">${esc(c)} <small>${n}</small></a>`).join("")}<a href="#people">People</a>${battle ? `<a href="#battle">Battle map</a>` : ""}</nav>
${battle.replace('<section class="battle">', '<section class="battle" id="battle">')}
<h2 id="people">A raider, a soldier, a heavy build; fitted parts; the fallen</h2>
<div class="grid">${peopleHtml}${fittedHtml}${deadHtml}</div>
${ORDER.map((c) => `<h2 id="${esc(c.toLowerCase().replace(/[^a-z]+/g, "-"))}">${esc(c)} <small class="key">${list.filter((w) => w.cls === c).length}</small></h2><div class="grid">${cards.filter((x) => x.cls === c).map((x) => x.html).join("\n")}</div>`).join("\n")}
<p class="kits">Rendered by <code>prototype/tools/weaponsheet.js</code> through the game's own figure painter (<code>src/ui/figures.js</code>, <code>src/ui/weaponmodels.js</code>); the "before" strips by origin/dev's painter.</p>
</div>
`;
writeFileSync(join(outDir, "weaponsheet.html"), html);
console.log(`${join(outDir, "weaponsheet.html")}: ${list.length} weapons, ${(html.length / 1048576).toFixed(1)} MB${before ? ", with before shots" : ""}${battle ? ", with the battle shot" : ""}`);
