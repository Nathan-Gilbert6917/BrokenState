// npm run dist: Windows builds in dist/, all bundling a snapshot of the game (index.html, styles.css, src/)
// taken now, so run this again after changing the game. `npm start` always uses the live files instead.
//   dist/Broken State-win32-x64/             the unpacked app ("Broken State.exe" plus its files)
//   dist/Broken State <version> Setup.exe    installer (Start Menu + desktop shortcuts, uninstaller)
//   dist/Broken State <version> Portable.exe one file, no install (unpacks itself to %TEMP% on each launch)
//   dist/latest.yml                          what installed copies read to find the newest version (updater.js)
// Saves are in %APPDATA%\Broken State whichever one runs.
//   npm run dist -- --game=<folder>   package another copy of the game folder (default ../prototype)
//   npm run dist -- --folder-only     skip the installer and the portable exe
//   npm run release                   the same, then uploads it as a GitHub release ("updates" in package.json), which
//                                     installed copies pick up by themselves. Raise "version" first; needs GH_TOKEN set
//                                     to a GitHub token that can write to that repo.
const fs = require("fs");
const path = require("path");
const { packager } = require("@electron/packager");

const DESKTOP = path.resolve(__dirname, "..");
const gameArg = process.argv.find((a) => a.startsWith("--game="));
const GAME = gameArg ? path.resolve(gameArg.slice(7)) : path.resolve(DESKTOP, "..", "prototype");
const STAGE = path.join(DESKTOP, "build", "prototype");

const PUBLISH = process.argv.includes("--publish");

(async () => {
  if (PUBLISH && !process.env.GH_TOKEN) throw new Error('npm run release needs GH_TOKEN: a GitHub token that can write releases to the repo in package.json "updates".');
  // 1. A clean copy of what the game needs at runtime (not the tools, README or dev server).
  fs.rmSync(path.join(DESKTOP, "build"), { recursive: true, force: true });
  fs.mkdirSync(STAGE, { recursive: true });
  // Everything index.html links, so the bundled copy loads as the live one does (touch.css and responsive.css apply only
  // to touch screens and small windows, pad.css only while a controller is in use; the manifest and icons/ only matter
  // to a browser installing the web app). Not sw.js: the web app's offline cache, which src/pwa.js never registers in the desktop app.
  for (const f of ["index.html", "styles.css", "title.css", "touch.css", "responsive.css", "pad.css", "manifest.webmanifest"]) if (fs.existsSync(path.join(GAME, f))) fs.copyFileSync(path.join(GAME, f), path.join(STAGE, f));
  fs.cpSync(path.join(GAME, "src"), path.join(STAGE, "src"), { recursive: true });
  // The build's stamp: the commit the snapshot is from (the error screen's report, src/ui/crash.js).
  try {
    const git = (...a) => require("child_process").execFileSync("git", ["-C", GAME, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const dirty = git("status", "--porcelain", "--", ".") ? "+changes" : "";
    fs.writeFileSync(path.join(STAGE, "build.json"), JSON.stringify({ commit: git("rev-parse", "--short", "HEAD") + dirty, date: new Date().toISOString().slice(0, 10) }));
  } catch { /* not a git checkout: no stamp */ }
  for (const d of ["assets", "audio", "img", "fonts", "icons"]) if (fs.existsSync(path.join(GAME, d))) fs.cpSync(path.join(GAME, d), path.join(STAGE, d), { recursive: true });

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
