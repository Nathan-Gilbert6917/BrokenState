// npm run dist: Windows builds in dist/, all bundling a snapshot of the game (index.html, styles.css, src/)
// taken now, so run this again after changing the game. `npm start` always uses the live files instead.
//   dist/Broken State-win32-x64/             the unpacked app ("Broken State.exe" plus its files)
//   dist/Broken State <version> Setup.exe    installer (Start Menu + desktop shortcuts, uninstaller)
//   dist/Broken State <version> Portable.exe one file, no install (unpacks itself to %TEMP% on each launch)
//   dist/latest.yml                          what installed copies read to find the newest version (updater.js)
// Saves are in %APPDATA%\Broken State whichever one runs.
//   npm run dist -- --game=<folder>   package another copy of the game folder (default ../prototype)
//   npm run dist -- --folder-only     skip the installer and the portable exe
//   npm run dist -- --stage-only      only lay out what the game ships (build/prototype) and stop: a look at it
//   npm run release                   the same, then uploads it as a GitHub release ("updates" in package.json), which
//                                     installed copies pick up by themselves. Raise "version" first; needs GH_TOKEN set
//                                     to a GitHub token that can write to that repo.
const fs = require("fs");
const path = require("path");

const DESKTOP = path.resolve(__dirname, "..");
const gameArg = process.argv.find((a) => a.startsWith("--game="));
const GAME = gameArg ? path.resolve(gameArg.slice(7)) : path.resolve(DESKTOP, "..", "prototype");
const STAGE = path.join(DESKTOP, "build", "prototype");

const PUBLISH = process.argv.includes("--publish");

// Every module the page loads: the module scripts index.html names and what each imports (import ... from, export
// ... from, import "...", import("...")), followed file to file. Only these ship: not the modules only the tools use
// (sim/ladder.js: the balance sheet's), nor the editor's type file (sim/types.d.ts). A specifier that names no file
// (the JSDoc's import("./types")) is skipped.
const IMPORT = /\b(?:import|export)\s[^;]*?\bfrom\s*["']([^"']+)["']|\bimport\s*["']([^"']+)["']|\bimport\(\s*["']([^"']+)["']\s*\)/g;
function pageModules(game, html) {
  const seen = new Set();
  const todo = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)].map((m) => path.join(game, m[1]));
  while (todo.length) {
    const f = todo.pop();
    if (seen.has(f) || !fs.existsSync(f)) continue;
    seen.add(f);
    for (const m of fs.readFileSync(f, "utf8").matchAll(IMPORT)) {
      const spec = m[1] || m[2] || m[3];
      if (spec.startsWith(".")) todo.push(path.resolve(path.dirname(f), spec));
    }
  }
  return [...seen];
}
// The files index.html links: its stylesheets and the favicon. Not the manifest or the home-screen icons (only a
// browser installing the web app reads them), nor sw.js (src/pwa.js never registers it in the desktop app).
const pageLinks = (html) => [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]).filter((t) => /\brel="(?:stylesheet|icon)"/.test(t)).map((t) => t.match(/\bhref="([^"]+)"/)).filter(Boolean).map((m) => m[1]);
function copyInto(game, stage, file) {
  const to = path.join(stage, path.relative(game, file));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(file, to);
}

(async () => {
  if (PUBLISH && !process.env.GH_TOKEN) throw new Error('npm run release needs GH_TOKEN: a GitHub token that can write releases to the repo in package.json "updates".');
  // 1. A clean copy of only what the game loads at runtime: index.html, what it links (every stylesheet: touch.css
  // and responsive.css apply only to touch screens and small windows, pad.css only while a controller is in use) and
  // the modules it imports. Not the tools, the README, the dev server or the web app's files.
  fs.rmSync(path.join(DESKTOP, "build"), { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  const html = fs.readFileSync(path.join(GAME, "index.html"), "utf8");
  const shipped = [path.join(GAME, "index.html"), ...pageLinks(html).map((h) => path.join(GAME, h)), ...pageModules(GAME, html)];
  for (const f of shipped) {
    if (!fs.existsSync(f)) throw new Error(`index.html needs ${path.relative(GAME, f)}, which is not there`);
    copyInto(GAME, STAGE, f);
  }
  // The build's stamp: the commit the snapshot is from (the error screen's report, src/ui/crash.js).
  try {
    const git = (...a) => require("child_process").execFileSync("git", ["-C", GAME, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = git("status", "--porcelain", "--", ".") ? "+changes" : "";
    fs.writeFileSync(path.join(STAGE, "build.json"), JSON.stringify({ commit: git("rev-parse", "--short", "HEAD") + dirty, date: new Date().toISOString().slice(0, 10) }));
  } catch { /* not a git checkout: no stamp */ }
  for (const d of ["assets", "audio", "img", "fonts"]) if (fs.existsSync(path.join(GAME, d))) fs.cpSync(path.join(GAME, d), path.join(STAGE, d), { recursive: true }); // none today: the art and sounds are drawn and made in code
  const kb = shipped.reduce((a, f) => a + fs.statSync(f).size, 0) / 1024;
  console.log(`Staged ${shipped.length} files of the game (${Math.round(kb)} KB) in ${STAGE}`);
  if (process.argv.includes("--stage-only")) return;

  // 2. Package: the app code goes into resources/app.asar, the game into resources/prototype (main.js looks there).
  const { packager } = require("@electron/packager");
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
    // The app needs main.js, updater.js, package.json, icons/icon.png (the window's) and perf/driver.js (--perf);
    // icon.ico is the exe's and the installer's, set on them here, never read at runtime.
    ignore: [/^\/dist($|\/)/, /^\/build($|\/)/, /^\/scripts($|\/)/, /^\/perf\/browser-bench\.js$/, /^\/package-lock\.json$/, /^\/icons\/icon\.ico$/],
    appCopyright: "Broken State prototype",
    win32metadata: { CompanyName: "Broken State", FileDescription: "Broken State", ProductName: "Broken State", InternalName: "Broken State" },
  });
  fs.rmSync(path.join(DESKTOP, "build"), { recursive: true, force: true });
  console.log(`\nBuilt: ${out}\nRun:   "${path.join(out, pkg.productName + ".exe")}"`);
  if (process.argv.includes("--folder-only")) return;

  // 3. Wrap that folder as an installer and as a single portable exe (electron-builder, from the packaged app as is).
  const builder = require("electron-builder");
  const files = await builder.build({
    prepackaged: out,
    projectDir: DESKTOP,
    targets: builder.Platform.WINDOWS.createTarget(["nsis", "portable"], builder.Arch.x64),
    publish: PUBLISH ? "always" : "never",
    config: {
      appId: "com.brokenstate.game",
      productName: pkg.productName,
      directories: { output: path.join(DESKTOP, "dist") },
      win: { icon: path.join(DESKTOP, "icons", "icon.ico"), signAndEditExecutable: false },
      nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true,
        perMachine: false,
        createDesktopShortcut: true,
        createStartMenuShortcut: true,
        shortcutName: pkg.productName,
        installerIcon: path.join(DESKTOP, "icons", "icon.ico"),
        uninstallerIcon: path.join(DESKTOP, "icons", "icon.ico"),
        artifactName: "${productName} ${version} Setup.${ext}",
      },
      portable: { artifactName: "${productName} ${version} Portable.${ext}" },
      publish: [{ ...pkg.updates, releaseType: "release" }], // published straight away, not left as a draft
    },
  });
  if (PUBLISH) console.log(`\nPublished ${pkg.version} to https://github.com/${pkg.updates.owner}/${pkg.updates.repo}/releases`);
  console.log(`\n${files.filter((f) => f.endsWith(".exe")).map((f) => `Built: ${f}`).join("\n")}`);
})().catch((e) => { console.error(e); process.exit(1); });
