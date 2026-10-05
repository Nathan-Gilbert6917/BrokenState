// Builds docs/design-doc/index.html from the section fragments, the sprite manifest and template.html.
// Usage: node assemble.cjs <sectionsDir> [outFile]
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const SECTIONS = path.resolve(process.argv[2] || path.join(ROOT, "sections"));
const OUT = path.resolve(process.argv[3] || path.join(ROOT, "index.html"));

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "sprites", "manifest.json"), "utf8"));
const byId = new Map(manifest.map((m) => [m.id, m]));

// Ids the section writers guessed before the export existed, mapped to what was exported.
// Buildings have no drawings of their own: they show as features of the hub sprite or as battle-map cells.
const ALIAS = {
  "shot/1-wall-map-towers-fog-night": "shot/base-defence-walls-night", "shot/2-gate-battered-open": "shot/base-defence-gate",
  "shot/3-yard-map-redeploy": "shot/base-defence-yard-redeploy", "shot/4-yard-map-units-in-buildings": "shot/base-defence-yard-buildings",
  "shot/01-ruins": "shot/map-ruins", "shot/02-ruin-panel": "shot/map-ruin-panel", "shot/03-known-area": "shot/map-known-area", "shot/05-coalition": "shot/map-coalition",
  "base/hub": "base/plain", "base/hub-1": "base/walls-1", "base/hub-2": "base/walls-2", "base/hub-3": "base/walls-3",
  "base/hub-big": "base/outpost-big", "base/hub-full": "base/full", "base/outpost-1": "base/outpost-walls-1",
  "building/walls": "building/wall", "building/barricades": "building/barricade", "building/spike_pits": "building/spikes",
  "building/watchtower": "base/tower", "building/radio": "base/radio", "building/relay": "base/outpost-radio",
  "building/infirmary": "base/hospital-1", "building/field_hosp": "base/hospital-2", "building/clinic": "base/hospital-3", "building/hospital": "base/hospital-4",
  "building/farm_plot": "base/farms-1", "building/machine_shop": "base/workshop", "building/ammo_bench": "base/workshop",
  "building/med_station": "base/workshop", "building/kitchen": "base/workshop", "building/generator": "base/workshop", "building/still": "base/workshop",
  "item/barbedwire": "building/wire", "item/sandbags": "building/sandbag", "item/beartrap": "building/beartrap",
  "camp/abandoned": "camp/unlit", "ruin/theirs": "ruin/group", "misc/searchsmoke": "misc/smoke",
  "terrain/tree-spring": "terrain/autumn-spring", "terrain/tree-autumn": "terrain/autumn-autumn",
};
for (const k of ["truck", "sedan", "boat", "raft", "walkers", "scouts", "raid", "relief", "convoy", "supply", "cart", "supplycart"]) ALIAS[`party/${k}`] = `party/player-${k}`;
const lookup = (id) => byId.get(ALIAS[id] || id);

// Each image is embedded once; every <img> points at it by index and a script fills in the src.
const uris = [];
const uriIndex = new Map();
function uri(m) {
  if (!uriIndex.has(m.id)) {
    const file = path.join(ROOT, m.file);
    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
    uriIndex.set(m.id, uris.push(`data:${mime};base64,${fs.readFileSync(file).toString("base64")}`) - 1);
  }
  return uriIndex.get(m.id);
}
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const img = (m) => `<img data-i="${uri(m)}" alt="${esc(m.label)}">`;
const used = new Set();
const missing = new Set();

// Parts of the document and the section ids that belong to each.
const PARTS = [
  ["I", "The game", ["overview", "setting", "core-loop", "time", "new-game", "goals"]],
  ["II", "The State of Calder", ["state-map", "weather", "locations", "travel", "hunting"]],
  ["III", "The hub", ["survivors", "skills", "health", "morale", "work", "buildings", "production", "farming", "power", "items", "economy"]],
  ["IV", "The dead and the hostile", ["the-dead", "living-enemies", "hives", "hordes", "raids", "battles", "stealth", "base-defence", "prisoners", "conflicts"]],
  ["V", "Other survivors", ["groups", "relations", "diplomacy", "coalition", "conquest", "trade", "caravans", "radio", "visitors", "world-history"]],
  ["VI", "Playing it", ["actions", "controls", "presentation", "dev-tools"]],
  ["VII", "Appendix", ["sprite-catalogue", "changes", "roadmap"]],
];
const AGENT_PART = { world: "II", colony: "III", threats: "IV", factions: "V", actions: "VI" };

// Read every <section> from every fragment file.
const sections = new Map();
const extraByPart = {};
for (const f of fs.readdirSync(SECTIONS).filter((f) => f.endsWith(".html"))) {
  const html = fs.readFileSync(path.join(SECTIONS, f), "utf8");
  const agent = path.basename(f, ".html");
  for (const m of html.matchAll(/<section\b[^>]*\bid="([^"]+)"[^>]*>[\s\S]*?<\/section>/g)) {
    if (sections.has(m[1])) console.warn(`duplicate section id ${m[1]} in ${f}`);
    sections.set(m[1], m[0]);
    if (!PARTS.some((p) => p[2].includes(m[1]))) (extraByPart[AGENT_PART[agent] || "VII"] ||= []).push(m[1]);
  }
}

// Expand sprite references.
function expand(html) {
  // Cards: put the sprite at the top of the card.
  html = html.replace(/<article class="card"([^>]*?)\sdata-sprite="([^"]+)"([^>]*)>/g, (all, a, id, b) => {
    const m = lookup(id.trim());
    if (!m) { missing.add(id); return `<article class="card"${a}${b}>`; }
    used.add(m.id);
    return `<article class="card"${a}${b}><div class="sprite">${img(m)}</div>`;
  });
  // Galleries: a row of captioned sprites (screenshots get a wide grid).
  html = html.replace(/<div class="gallery"([^>]*?)\sdata-sprites="([^"]*)"([^>]*)>\s*<\/div>/g, (all, a, ids, b) => {
    const ms = [...new Set(ids.split(/[\s,]+/).filter(Boolean).map((id) => { const m = lookup(id); if (!m) missing.add(id); return m; }).filter(Boolean))];
    if (!ms.length) return "";
    ms.forEach((m) => used.add(m.id));
    const shots = ms.every((m) => m.category === "shot");
    return `<div class="gallery${shots ? " shots" : ""}"${a}${b}>${ms.map((m) => `<figure><div class="tile">${img(m)}</div><figcaption>${esc(m.label)}</figcaption></figure>`).join("")}</div>`;
  });
  // Wide tables scroll inside their own box.
  html = html.replace(/<table class="data"[\s\S]*?<\/table>/g, (t) => `<div class="tablewrap">${t}</div>`);
  return html;
}

// Sprite catalogue appendix, generated from the manifest.
const CAT_NAMES = {
  survivor: "Survivors", gear: "Survivors with gear", zombie: "The dead", special: "Special dead", boss: "Boss dead",
  human: "Hostile humans", party: "AI group parties on the map", outsider: "Outsiders on the map", horde: "Hordes",
  hive: "Hives", growth: "Hive growths", site: "Hive sites", base: "Your hub", factionbase: "AI group bases",
  poi: "Locations", camp: "Camps", ruin: "Ruins", siege: "Siege camps", marker: "Map markers", icon: "Map icons",
  building: "Buildings and defences", item: "Items", vehicle: "Vehicles", terrain: "Terrain detail", misc: "Map details",
  shot: "Screenshots",
};
function catalogue() {
  const cats = [...new Set(manifest.map((m) => m.category))];
  cats.sort((a, b) => (Object.keys(CAT_NAMES).indexOf(a) + 99 * !CAT_NAMES[a]) - (Object.keys(CAT_NAMES).indexOf(b) + 99 * !CAT_NAMES[b]));
  const blocks = cats.map((c) => {
    const ms = manifest.filter((m) => m.category === c);
    return `<h3>${esc(CAT_NAMES[c] || c)} <small>${ms.length}</small></h3><div class="gallery" data-sprites="${ms.map((m) => m.id).join(" ")}"></div>`;
  });
  return `<section id="sprite-catalogue" class="catalogue"><h2>Sprite catalogue</h2>
<p class="lede">Every sprite the game draws, grouped by what it is used for. None of these are image files in the game: each one is painted at runtime by the prototype's drawing code, and these images were rendered from that code.</p>
<p>Shown enlarged with crisp pixels on a patch of map ground. Re-render with <code>docs/design-doc/tools</code> after art changes.</p>
${blocks.join("\n")}</section>`;
}
sections.set("sprite-catalogue", catalogue());
sections.set("screens", `<section id="screens"><h2>The prototype in pictures</h2>
<p class="lede">Screens from a real game (seed 4242), played forward by the autopilot to day 41, then captured from the desktop build.</p>
<div class="gallery" data-sprites="shot/new-game shot/day-1-hub shot/state-map-hub shot/state-map-revealed shot/hive-closeup shot/base-view shot/battle shot/trade shot/diplomacy-affairs shot/diplomacy-market shot/diplomacy-jobs shot/radio"></div></section>`);
PARTS[0][2].splice(1, 0, "screens");

// Assemble parts.
let body = "";
let toc = "<ol>";
for (const [num, title, ids] of PARTS) {
  const all = [...ids, ...(extraByPart[num] || [])].filter((id) => sections.has(id));
  if (!all.length) continue;
  const pid = `part-${num.toLowerCase()}`;
  body += `<div class="part-head" id="${pid}"><div class="num">Part ${num}</div><h2>${esc(title)}</h2></div>\n`;
  toc += `<li class="part">${num} · ${esc(title)}</li>`;
  for (const id of all) {
    const html = expand(sections.get(id));
    body += html + "\n";
    const h2 = (html.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [, id])[1].replace(/<[^>]+>/g, "").trim();
    toc += `<li><a href="#${id}">${esc(h2)}</a></li>`;
  }
}
toc += "</ol>";
const leftovers = PARTS.flatMap((p) => p[2]).filter((id) => !sections.has(id));

// Masthead cast: a line-up of the most characteristic sprites.
const CAST = ["survivor/1", "survivor/2", "survivor/3", "zombie/walker", "zombie/runner", "zombie/bloated", "zombie/brute", "special/spitter", "special/screamer", "special/crawler", "boss/broodmother", "boss/wallbreaker"];
const cast = CAST.map((id) => byId.get(id)).filter(Boolean).map(img).join("");

let commit = "unknown";
try { commit = execSync("git rev-parse --short HEAD", { cwd: ROOT }).toString().trim(); } catch {}
const date = new Date().toISOString().slice(0, 10);
let out = fs.readFileSync(path.join(__dirname, "template.html"), "utf8")
  .replace("<!--TOC-->", toc).replace("<!--BODY-->", body).replace("<!--CAST-->", cast)
  .replace("<!--DATE-->", date).replace("<!--COMMIT-->", commit)
  .replace("<!--SPRITECOUNT-->", String(manifest.filter((m) => m.category !== "shot").length))
  .replace("<!--IMAGES-->", `<script>(()=>{const I=${JSON.stringify(uris)};document.querySelectorAll("img[data-i]").forEach(e=>{e.src=I[+e.dataset.i]})})();</script>`);
fs.writeFileSync(OUT, out);
console.log(`wrote ${OUT} (${(out.length / 1048576).toFixed(2)} MB), ${sections.size} sections, ${used.size} sprites referenced in text`);
if (missing.size) console.log("missing sprite ids:", [...missing].join(" "));
if (leftovers.length) console.log("planned sections not found:", leftovers.join(" "));
for (const [p, ids] of Object.entries(extraByPart)) console.log(`extra sections in part ${p}:`, ids.join(" "));
