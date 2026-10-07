// Adds a save made by a build of the game to the save corpus (tools/saves/, loaded by tools/savecorpustest.js), so
// every later build is checked against it: an old campaign must always load and play on.
// Usage: node tools/makesave.js [options]           (one command: a save from the code as it is now)
//   --root <prototype folder>   the build whose code makes the save (default: this one). An older build: export it
//                               first, e.g. git archive <commit> prototype | tar -x -C <scratch folder>
//   --commit <hash>             the commit it is from (default: git rev-parse of --root, when it is a checkout)
//   --note "<text>"             why this save is in the corpus (what it brackets: "before firewood x30")
//   --name <file name>          default: <date>-<commit>-<mode>[-ironman]
//   --days 12  --seed 7  --size small  --mode normal|hardcore  --ironman  --style balanced  --out tools/saves
// The world is made the way the game makes one (createWorld, started, the starting roles), played by the autopilot
// for --days in-game days (cards answered by it), then written with open cards left out, gzipped
// (<name>.bsave.gz: a .bsave the game's Load from file also reads). Small map, short run: the files stay small.
// The line in tools/saves/corpus.json says which build made it and why it is there.
import { writeFileSync, readFileSync, existsSync, mkdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const HERE = dirname(fileURLToPath(import.meta.url));
const arg = (name, dflt = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? dflt : process.argv[i + 1];
};
const flag = (name) => process.argv.includes(`--${name}`);

const root = resolve(arg("root", join(HERE, "..")));
const days = Number(arg("days", 12));
const seed = Number(arg("seed", 7));
const size = arg("size", "small");
const mode = arg("mode", "normal");
const style = arg("style", "balanced");
const ironman = flag("ironman");
const outDir = resolve(arg("out", join(HERE, "saves")));
const note = arg("note", "");
let commit = arg("commit", "");
if (!commit) {
  try {
    commit = execFileSync("git", ["-C", root, "rev-parse", "--short", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = execFileSync("git", ["-C", root, "status", "--porcelain", "--", "src"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    if (dirty) commit += "+changes";
  } catch { commit = "unknown"; }
}
const today = new Date().toISOString().slice(0, 10);
const name = arg("name", `${today}-${commit.replace(/[^\w]+/g, "")}-${mode}${ironman ? "-ironman" : ""}`);

// The build's own modules (an older build has the same entry points: world.js, autopilot.js, save.js).
const mod = (p) => import(pathToFileURL(join(root, "src", "sim", p)).href);
const W = await mod("world.js");
const A = await mod("autopilot.js");
const S = await mod("save.js");

const t0 = performance.now();
const st = W.createWorld({ seed, factionCount: 4, size, mode }); // a build from before sizes or modes ignores them
st.started = true;
if (ironman) st.ironman = { id: `iron${Date.now().toString(36)}`, since: Date.now() };
if (W.assignStartingRoles) W.assignStartingRoles(st);
A.setAutopilot(st, true, style);
while (W.day(st) <= days && !st.gameOver) W.tickHour(st);
let guard = 0;
while (st.cards.length && !st.gameOver && guard++ < 48) W.tickHour(st); // the autopilot answers what is open
const json = S.saveToString(st, { dropCards: true });
const gz = gzipSync(json, { level: 9 });
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
const file = `${name}.bsave.gz`;
writeFileSync(join(outDir, file), gz);

// The corpus list: one line per file (a file made again replaces its line).
const listFile = join(outDir, "corpus.json");
let list = [];
try { list = JSON.parse(readFileSync(listFile, "utf8")); } catch { list = []; }
const save = JSON.parse(json);
const line = {
  file, commit, made: today, note, v: save.v, game: save.game, mode: st.mode || "normal", size: st.worldSize || "normal",
  ironman, seed, day: W.day(st), survivors: st.survivors.filter((s) => s.alive).length, gameOver: !!st.gameOver,
  json: json.length, gzip: gz.length,
};
list = [...list.filter((e) => e.file !== file), line].sort((a, b) => String(a.file).localeCompare(String(b.file)));
writeFileSync(listFile, `${JSON.stringify(list, null, 2)}\n`);
console.log(`${file}: build ${commit}, day ${line.day}, ${line.survivors} alive${st.gameOver ? " (game over)" : ""}, ${line.mode}, ${line.size} map; JSON ${(json.length / 1024).toFixed(0)} KB, gzip ${(gz.length / 1024).toFixed(0)} KB (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
