// Applies a balance-sheet patch (docs/balance-sheet/index.html "Export changes") to the data files: every change
// { table, key, field, from, to } is found through tools/balancesheet.js FIELDS (its registry and path) and
// tools/balancesrc.js (the literal the game's value comes from: combat.js WEAPONS, data-guns.js, data.js GEAR,
// data-ammo.js, data-kit.js, data-stacks.js, mags.js, custompoints.js...), and that one literal is replaced in place
// (a field the source does not have yet is added to its entry). A change whose `from` is not the value in the source
// now is refused and reported (the files changed since the sheet was made: regenerate it). rarityOrder rewrites
// data-ammo.js RARITY when it differs. After writing, the game's modules are loaded again in a fresh node to check that
// every changed value is what the game now has.
// Usage: node tools/applybalance.js <patch.json> [--dry] [--root <prototype dir>]
//   --dry   reports what would change and writes nothing.
// Exit code 0: everything applied (or would be); 1: something refused or not verified; 2: a bad patch.
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { SourceTree, editAt, setStringArray, literal } from "./balancesrc.js";
import { FIELDS, fieldSrc, PROTO, SHEET_VERSION, insertable } from "./balancesheet.js";

const TIERS_FALLBACK = ["common", "uncommon", "scarce", "rare", "veryrare"];
const same = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b);

/** Applies a patch object to the source tree under `root`. Returns { applied, refused, skipped, files, lines }. */
export function applyPatch(patch, root = PROTO, { dry = false } = {}) {
  const tree = new SourceTree(root);
  const applied = [], refused = [], skipped = [];
  const rarity = rarityNow(tree);
  const order = Array.isArray(patch.rarityOrder) && patch.rarityOrder.length ? patch.rarityOrder : rarity;
  for (const ch of patch.changes || []) {
    const id = `${ch.table}.${ch.key}.${ch.field}`;
    if (!FIELDS[ch.table] || !FIELDS[ch.table][ch.field]) { refused.push({ id, why: "not an editable column" }); continue; }
    const src = fieldSrc(ch.table, ch.key, ch.field);
    let loc;
    try { loc = tree.locate(src.reg, src.path); } catch (e) { loc = null; }
    if (!loc) { refused.push({ id, why: `not found in the source (${src.reg} ${JSON.stringify(src.path)})` }); continue; }
    const to = ch.to;
    const tierCol = (ch.table === "guns" && ch.field === "rarity") || (ch.table === "rounds" && ch.field === "tier");
    if (tierCol ? !order.includes(to) : !(typeof to === "number" ? Number.isFinite(to) : typeof to === "string" || typeof to === "boolean")) {
      refused.push({ id, why: `bad value ${JSON.stringify(to)}` }); continue;
    }
    const where = `${loc.file.replace("src/sim/", "")}:${tree.lineOf(loc.file, loc.insert ? loc.parentOpen : loc.start)}`;
    if (loc.insert) {
      if (ch.from !== null && ch.from !== undefined) { refused.push({ id, why: `the source has no value here now (the patch says it was ${JSON.stringify(ch.from)})`, where }); continue; }
      if (!insertable(ch.table, ch.field)) { refused.push({ id, why: "this field cannot be added", where }); continue; }
    } else {
      if (!loc.ok) { refused.push({ id, why: `the source value is not a plain literal (${loc.text})`, where }); continue; }
      if (!same(loc.value, ch.from)) { refused.push({ id, why: `from ${JSON.stringify(ch.from)} but the source has ${JSON.stringify(loc.value)}`, where }); continue; }
      if (same(loc.value, to)) { skipped.push({ id, why: "already that value", where }); continue; }
    }
    tree.set(loc.file, editAt(tree, loc, to));
    applied.push({ id, from: loc.insert ? null : loc.value, to, where: (loc.insert ? "+" : "") + where });
  }
  // the order of rarity
  if (Array.isArray(patch.rarityOrder) && patch.rarityOrder.length) {
    const want = patch.rarityOrder;
    if (want.length !== rarity.length || !want.every((t) => rarity.includes(t))) refused.push({ id: "rarityOrder", why: `not the same tiers as data-ammo.js RARITY (${rarity.join(", ")})` });
    else if (want.join() !== rarity.join()) {
      tree.set("src/sim/data-ammo.js", setStringArray(tree, "RARITY", want));
      applied.push({ id: "rarityOrder", from: rarity.join(" > "), to: want.join(" > "), where: "data-ammo.js RARITY" });
    }
  }
  if (!dry) for (const f of tree.dirty) writeFileSync(join(root, f), tree.text(f));
  return { applied, refused, skipped, files: [...tree.dirty] };
}
function rarityNow(tree) {
  try {
    const loc = tree.locate("RARITY", []);
    const m = loc && loc.text.match(/"[^"]+"/g);
    return m ? m.map((s) => JSON.parse(s)) : TIERS_FALLBACK;
  } catch { return TIERS_FALLBACK; }
}
/** Loads the game under `root` in a fresh node and returns the values of these cells ([table, key, field]). */
export function probe(root, cells) {
  const dir = mkdtempSync(join(tmpdir(), "bsprobe-"));
  try {
    const f = join(dir, "cells.json");
    writeFileSync(f, JSON.stringify(cells));
    const r = spawnSync(process.execPath, [join(PROTO, "tools", "balancesheet.js"), "--probe", f, "--root", root], { encoding: "utf8", maxBuffer: 1 << 26 });
    if (r.status !== 0) throw new Error(`probe failed: ${r.stderr || r.stdout}`);
    return JSON.parse(r.stdout);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
/** The applied changes the game does not show after a reload: [{ id, want, got }]. */
export function verify(root, patch, applied) {
  const ids = new Set(applied.map((a) => a.id));
  const changes = (patch.changes || []).filter((c) => ids.has(`${c.table}.${c.key}.${c.field}`));
  const got = probe(root, changes.map((c) => [c.table, c.key, c.field]));
  const bad = [];
  changes.forEach((c, i) => { if (!same(got[i], c.to)) bad.push({ id: `${c.table}.${c.key}.${c.field}`, want: c.to, got: got[i] }); });
  return bad;
}

// ---------- the command line ----------
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const dry = args.includes("--dry");
  const ri = args.indexOf("--root");
  const root = resolve(ri >= 0 ? args[ri + 1] : PROTO);
  const file = args.find((a, i) => !a.startsWith("--") && args[i - 1] !== "--root");
  if (!file) { console.log("Usage: node tools/applybalance.js <patch.json> [--dry] [--root <prototype dir>]"); process.exit(2); }
  let patch;
  try { patch = JSON.parse(readFileSync(resolve(file), "utf8")); } catch (e) { console.log(`Cannot read ${file}: ${e.message}`); process.exit(2); }
  if (!patch || !Array.isArray(patch.changes)) { console.log("Not a balance patch (no changes list)."); process.exit(2); }
  if (patch.version !== SHEET_VERSION) { console.log(`Patch version ${patch.version}; this tool applies version ${SHEET_VERSION}.`); process.exit(2); }
  const res = applyPatch(patch, root, { dry });
  console.log(`${dry ? "Dry run: would apply" : "Applied"} ${res.applied.length} change(s) to ${root} (patch from ${patch.generatedFrom || "?"})`);
  for (const a of res.applied) console.log(`  ${a.id}: ${a.from === null ? "(none)" : literal(a.from)} -> ${literal(a.to)}   [${a.where}]`);
  if (res.skipped.length) { console.log(`Skipped ${res.skipped.length}:`); for (const s of res.skipped) console.log(`  ${s.id}: ${s.why}`); }
  if (res.refused.length) { console.log(`REFUSED ${res.refused.length}:`); for (const r of res.refused) console.log(`  ${r.id}: ${r.why}${r.where ? `   [${r.where}]` : ""}`); }
  console.log(`Files ${dry ? "that would change" : "changed"}: ${res.files.join(", ") || "none"}`);
  let bad = [];
  if (!dry && res.applied.length) {
    bad = verify(root, patch, res.applied.filter((a) => a.id !== "rarityOrder"));
    if (bad.length) { console.log(`NOT VERIFIED ${bad.length} (written, but the game has another value: something later overrides it):`); for (const b of bad) console.log(`  ${b.id}: wanted ${literal(b.want)}, the game has ${JSON.stringify(b.got)}`); }
    else console.log("Verified: the game loads every changed value. Regenerate the sheet: node tools/balancesheet.js; run tools/arsenalbalancetest.js.");
  }
  process.exit(res.refused.length || bad.length ? 1 : 0);
}

