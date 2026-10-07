// npm run dist: a portable Windows build in dist/Broken State-win32-x64/ ("Broken State.exe" plus its files;
// copy the whole folder anywhere, no installer). It bundles a snapshot of the game (index.html, styles.css,
// src/) taken now, so run this again after changing the game. `npm start` always uses the live files instead.
//   npm run dist -- --game=<folder>   package another copy of the game folder (default ../prototype)
const fs = require("fs");
const path = require("path");
const { packager } = require("@electron/packager");

const DESKTOP = path.resolve(__dirname, "..");
const gameArg = process.argv.find((a) => a.startsWith("--game="));
const GAME = gameArg ? path.resolve(gameArg.slice(7)) : path.resolve(DESKTOP, "..", "prototype");
const STAGE = path.join(DESKTOP, "build", "prototype");

(async () => {
  // 1. A clean copy of what the game needs at runtime (not the tools, README or dev server).
  fs.rmSync(path.join(DESKTOP, "build"), { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  for (const f of ["index.html", "styles.css", "title.css"]) if (fs.existsSync(path.join(GAME, f))) fs.copyFileSync(path.join(GAME, f), path.join(STAGE, f));
  fs.cpSync(path.join(GAME, "src"), path.join(STAGE, "src"), { recursive: true });
  // The build's stamp: the commit the snapshot is from (the error screen's report, src/ui/crash.js).
  try {
    const git = (...a) => require("child_process").execFileSync("git", ["-C", GAME, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = git("status", "--porcelain", "--", ".") ? "+changes" : "";
    fs.writeFileSync(path.join(STAGE, "build.json"), JSON.stringify({ commit: git("rev-parse", "--short", "HEAD") + dirty, date: new Date().toISOString().slice(0, 10) }));
  } catch { /* not a git checkout: no stamp */ }
  for (const d of ["assets", "audio", "img", "fonts"]) if (fs.existsSync(path.join(GAME, d))) fs.cpSync(path.join(GAME, d), path.join(STAGE, d), { recursive: true });

  // 2. Package: the app code goes into resources/app.asar, the game into resources/prototype (main.js looks there).
  const pkg = require(path.join(DESKTOP, "package.json"));
  const [out] = await packager({
    dir: DESKTOP,
    out: path.join(DESKTOP, "dist"),
    name: pkg.productName,
    executableName: pkg.productName,
    platform: "win32",
    arch: "x64",
    electronVersion: require("electron/package.json").version,
    icon: path.join(DESKTOP, "icons", "icon.ico"),
    asar: true,
    overwrite: true,
    prune: true,
    extraResource: [STAGE],
    ignore: [/^\/dist($|\/)/, /^\/build($|\/)/, /^\/scripts($|\/)/, /^\/perf\/browser-bench\.js$/, /^\/package-lock\.json$/],
    appCopyright: "Broken State prototype",
    win32metadata: { CompanyName: "Broken State", FileDescription: "Broken State", ProductName: "Broken State", InternalName: "Broken State" },
  });
  fs.rmSync(path.join(DESKTOP, "build"), { recursive: true, force: true });
  console.log(`\nBuilt: ${out}\nRun:   "${path.join(out, pkg.productName + ".exe")}"`);
})().catch((e) => { console.error(e); process.exit(1); });
