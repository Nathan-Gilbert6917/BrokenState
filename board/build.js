// Builds the rebuild board (board/README.md) from board/data into board/dist:
//   dist/index.html      the installable web app (GitHub Pages: /BrokenState/board/)
//   dist/artifact.html   the same page without the document wrapper, for the Claude artifact
// plus the manifest, the service worker and the icons from board/public.
// `node board/build.js` builds; `--check` only validates. Exits 1 on a missing card, a reference to an unknown card,
// a card without a priority, or a card that needs a card later in the build order.
const fs = require("fs"), path = require("path");
const dir = __dirname, data = p => path.join(dir, "data", p), read = p => fs.readFileSync(p, "utf8"), json = p => JSON.parse(read(p));

const LANES = {
  L0: { tag: "L0", title: "Infrastructure", kind: "infra", phase: "slice", desc: "Engine, repo, tests and CI. Set up once, before any game code." },
  L1: { tag: "L1", title: "Slice · Data", kind: "slice", phase: "slice", desc: "The database layer: IDs, content definitions, world state, seeded RNG, saves." },
  L2: { tag: "L2", title: "Slice · Sim core", kind: "slice", phase: "slice", desc: "The backend's spine: clock, events, commands, hexes, map generation, cards." },
  L3: { tag: "L3", title: "Slice · Gameplay", kind: "slice", phase: "slice", desc: "Survivors, the base, travel, POIs and the tactical battle, each at its thinnest." },
  L4: { tag: "L4", title: "Slice · Placeholder UI", kind: "slice", phase: "slice", desc: "Functional screens with stand-in art, then the playtest that closes the slice." },
  L5: { tag: "M2", title: "Living hub", kind: "post", phase: "post", desc: "Depth for people and bases: skills, morale, bonds, medicine, food, crafting, power." },
  L6: { tag: "M3", title: "Wider world", kind: "post", phase: "post", desc: "Full-size Calder: rivers and roads, weather, vehicles, scavenging, city crawls." },
  L7: { tag: "M4", title: "Deep tactics & gear", kind: "post", phase: "post", desc: "Procedural interiors, stealth, doors and barricades, ballistics, armour, gun builder." },
  L8: { tag: "M5", title: "The dead & defence", kind: "post", phase: "post", desc: "Hordes, hives and the win condition, special dead, walls and sieges." },
  L9: { tag: "M6", title: "Other groups", kind: "post", phase: "post", desc: "AI groups under the same rules as you: diplomacy, trade, radio, war." },
  L10: { tag: "M7", title: "Campaign & meta", kind: "post", phase: "post", desc: "Game modes, victories, history, help, quality of life, balance, performance." },
  L11: { tag: "M8", title: "Human-made art, audio & release", kind: "art", phase: "post", desc: "Last: the artists' sprites and UI skin drop into the art keys, then music and shipping." },
  L12: { tag: "Later", title: "Far future", kind: "art", phase: "post", desc: "Only after the game has shipped on desktop. No phone or touch support is planned." },
};
const SIZE = { S: "S (a weekend)", M: "M (1–2 weeks)", L: "L (3–6 weeks)", XL: "XL (2+ months)" };

// The order and lanes: every "### Lnn" heading, then lines like "agent B: 19 surv.model — Survivors: …".
let lane = null; const order = [];
for (const line of read(data("card-order.md")).split("\n")) {
  const h = line.match(/^### (L\d+)\b/); if (h) { lane = h[1]; continue; }
  const m = line.match(/^(?:agent \w+: )?(\d+) ([a-z]+\.[a-z0-9-]+) — (.+?)(?:\s+\(agent \w+\))?$/);
  if (m && lane) order.push({ order: +m[1], id: m[2], title: m[3].trim(), lane });
}
// The cards (one JSON array a file, see data/card-brief.md), then the fixes made when they were merged.
const got = {};
for (const f of fs.readdirSync(data("cards")).filter(f => f.endsWith(".json")).sort()) for (const c of json(data("cards/" + f))) got[c.id] = c;
const fix = json(data("fixups.json"));
const problems = [], cards = [];
for (const o of order) {
  const c = got[o.id];
  if (!c) { problems.push("missing card " + o.id); continue; }
  const ln = (fix.lane || {})[o.id] || o.lane;
  cards.push({ ...c, id: o.id, order: (fix.order || {})[o.id] || o.order, lane: ln, phase: LANES[ln].phase, title: c.title || o.title });
}
for (const id of Object.keys(got)) if (!order.find(o => o.id === id)) problems.push("card not in card-order.md: " + id);
cards.sort((a, b) => a.order - b.order);
for (const c of cards) {
  const add = (fix.deps || {})[c.id]; if (add) c.dependsOn = [...new Set([...(c.dependsOn || []), ...add])];
  const rm = (fix.removeDeps || {})[c.id]; if (rm) c.dependsOn = (c.dependsOn || []).filter(d => !rm.includes(d));
  const t = (fix.tasks || {})[c.id]; if (t) for (const [k, v] of Object.entries(t)) (c.tasks = c.tasks || {})[k] = [...((c.tasks || {})[k] || []), ...v];
  const p = (fix.priority || {})[c.id];
  if (p) Object.assign(c, { priority: p[0], value: p[1], effort: p[2] || SIZE[c.size] || c.size, priorityWhy: p[3] });
  else problems.push("no priority: " + c.id);
}
const byId = Object.fromEntries(cards.map(c => [c.id, c]));
for (const c of cards) {
  for (const d of c.dependsOn || []) {
    if (!byId[d] || d === c.id) problems.push(c.id + " needs unknown card " + d);
    else if (byId[d].order > c.order) problems.push(c.id + " (#" + c.order + ") needs " + d + ", which comes later (#" + byId[d].order + ")");
  }
  for (const x of c.connections || []) if (!byId[x.to]) problems.push(c.id + " connects to unknown card " + x.to);
}
if (problems.length) { console.error(problems.join("\n")); process.exit(1); }

const presets = json(data("presets.json"));
const payload = JSON.stringify({ lanes: Object.keys(LANES).map(key => ({ key, ...LANES[key] })), cards, guide: json(data("guide.json")), art: json(data("art-school.json")),
  artPresets: presets.presets, artPalette: presets.palette }).replace(/</g, "\\u003c");
const page = read(path.join(dir, "src/template.html")).replace("/*__DATA__*/null", () => payload).replace("/*__ART__*/", () => read(path.join(dir, "src/art.js")));
console.log(cards.length + " cards in " + Object.keys(LANES).length + " lanes, " + Math.round(page.length / 1024) + " KB");
if (process.argv.includes("--check")) process.exit(0);

// The installable app: a full document with the web-app tags, and the service worker registered.
const head = read(path.join(dir, "src/app-head.html"));
const app = "<!doctype html>\n<html lang=\"en\">\n<head>\n" + head + "</head>\n<body>\n" + page +
  "\n<script>if (\"serviceWorker\" in navigator && (location.protocol === \"https:\" || location.hostname === \"localhost\")) navigator.serviceWorker.register(\"sw.js\").catch(() => {});</script>\n</body>\n</html>\n";
const out = path.join(dir, "dist");
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(path.join(dir, "public"), out, { recursive: true });
fs.writeFileSync(path.join(out, "index.html"), app);
fs.writeFileSync(path.join(out, "artifact.html"), page);
// A new cache name each build, so an installed app picks up the new board on its next start.
const sha = require("crypto").createHash("sha1").update(app);
for (const f of fs.readdirSync(path.join(dir, "public"), { recursive: true }).sort()) { const p = path.join(dir, "public", f); if (fs.statSync(p).isFile()) sha.update(fs.readFileSync(p)); }
const hash = sha.digest("hex").slice(0, 10);
fs.writeFileSync(path.join(out, "sw.js"), read(path.join(dir, "public/sw.js")).replace("__BUILD__", hash));
console.log("wrote " + path.relative(process.cwd(), out) + "/ (index.html, artifact.html, sw.js " + hash + ")");
