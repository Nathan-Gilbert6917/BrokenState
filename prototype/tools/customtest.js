// Custom world setup from the new-run screen (sim/worldsize.js): a custom width × height (experimental), 0–50 AI
// groups and 0–10 starting hives, in Normal and Hardcore. Every corner builds, runs 20 days with the autopilot,
// saves and loads as the same size; the custom formula gives the presets' own counts at the presets' sizes, a
// custom Normal-sized map with no hive count is the Normal map, and the hive count is exact. Also times how long the
// biggest map takes to build and to play a day.
// Usage: node tools/customtest.js [days] (default 20)
import { createWorld, tickHour, alive, day } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { WORLD_SIZES, SIZE_KEYS, customDef, CUSTOM, GROUPS_MAX, HIVES_MAX, clampGroups, clampHives, stateSizeDef } from "../src/sim/worldsize.js";
import { newRunScreen } from "../src/ui/newgame.js";

const DAYS = Number(process.argv[2] || 20);
let fails = 0;
const check = (ok, msg) => {
  if (ok) return;
  fails++;
  if (fails <= 25) console.log("  FAIL:", msg);
};
const section = (t) => console.log(`\n== ${t}`);

section("The custom formula at the presets' sizes");
for (const k of SIZE_KEYS) {
  const p = WORLD_SIZES[k], c = customDef(p.w, p.h);
  for (const f of ["cities", "military", "originHives", "hotspots", "spotHives", "nearGroups", "hiveClear", "defGroups"]) {
    if (k === "normal" && f === "originHives") continue; // Normal uses HIVE.START_ORIGIN (the same 4)
    check((c[f] ?? null) === (p[f] ?? null), `${p.label}: custom ${f} ${c[f]} vs the preset's ${p[f]}`);
  }
}
check(customDef(1, 1).w === CUSTOM.MIN_W && customDef(1e6, 1e6).h === CUSTOM.MAX_H, "custom sizes clamped to their range");
check(clampGroups("normal", 99) === GROUPS_MAX && clampGroups("small", -3) === 0 && clampGroups("huge", "") === WORLD_SIZES.huge.defGroups, "groups clamped to 0–50");
check(clampHives("default") === null && clampHives(42) === HIVES_MAX && clampHives(-1) === 0 && clampHives(3) === 3, "hives clamped to 0–10, default kept");
console.log("  ok");

section("A custom 64 × 42 map is the Normal map; a set hive count is exact");
{
  const a = createWorld({ seed: 77, factionCount: 7 }), b = createWorld({ seed: 77, factionCount: 7, size: "custom", customW: 64, customH: 42 });
  check(a.tiles.every((t, i) => t.terrain === b.tiles[i].terrain && !!t.hive === !!b.tiles[i].hive && (t.loc?.name ?? null) === (b.tiles[i].loc?.name ?? null)), "custom 64×42 builds the Normal map");
  check(b.worldSize === "custom" && stateSizeDef(b).label === "Custom", "custom world is marked custom");
  const counts = [];
  for (const size of ["small", "normal", "huge"]) for (let n = 0; n <= HIVES_MAX; n++) {
    const w = createWorld({ seed: 5 + n, factionCount: 4, size, hives: n });
    check(w.hives.length === n, `${size}, ${n} hives asked: ${w.hives.length}`);
    if (size === "normal") counts.push(w.hives.length);
  }
  console.log(`  Normal map with 0..10 hives asked: ${counts.join(",")}`);
}

section(`Corners: size × groups × hives × mode, ${DAYS} days each with the autopilot`);
const corners = [
  { size: "custom", customW: CUSTOM.MIN_W, customH: CUSTOM.MIN_H, groups: 0, hives: 0 },
  { size: "custom", customW: CUSTOM.MIN_W, customH: CUSTOM.MIN_H, groups: GROUPS_MAX, hives: HIVES_MAX },
  { size: "custom", customW: 150, customH: 40, groups: 12, hives: null },
  { size: "small", groups: GROUPS_MAX, hives: 0 },
  { size: "normal", groups: 0, hives: HIVES_MAX },
  { size: "normal", groups: 1, hives: 1 },
  { size: "custom", customW: CUSTOM.MAX_W, customH: CUSTOM.MAX_H, groups: GROUPS_MAX, hives: HIVES_MAX },
];
for (const mode of ["normal", "hardcore"]) for (const c of corners) {
  const label = `${mode} ${c.size === "custom" ? `${c.customW}×${c.customH}` : c.size}, ${c.groups} groups, ${c.hives ?? "default"} hives`;
  try {
    const t0 = performance.now();
    const st = createWorld({ seed: 31, factionCount: c.groups, size: c.size, customW: c.customW, customH: c.customH, hives: c.hives, mode });
    const built = performance.now() - t0;
    if (c.size === "custom") check(st.grid.width === c.customW && st.grid.height === c.customH, `${label}: grid ${st.grid.width}×${st.grid.height}`);
    if (mode === "normal" && c.hives != null) check(st.hives.length === c.hives, `${label}: ${st.hives.length} hives`);
    if (mode === "normal") check(st.factions.length <= c.groups, `${label}: ${st.factions.length} groups`);
    const html = newRunScreen(st, { worldSize: c.size, customW: c.customW, customH: c.customH, factionCount: c.groups, hiveCount: c.hives, nrMsg: "" });
    check(html.includes('data-action="hivecount"') && html.includes('data-action="factioncount"') && (c.size !== "custom" || html.includes("Experimental")), `${label}: new-run screen`);
    st.started = true;
    setAutopilot(st, true);
    const t1 = performance.now();
    for (let i = 0; i < DAYS * 24 && !st.gameOver; i++) tickHour(st);
    const perDay = (performance.now() - t1) / DAYS;
    const ld = loadFromString(saveToString(st));
    check(ld.worldSize === st.worldSize && ld.grid.width === st.grid.width && ld.grid.height === st.grid.height, `${label}: loads as ${ld.worldSize} ${ld.grid.width}×${ld.grid.height}`);
    for (let i = 0; i < 24; i++) tickHour(ld);
    console.log(`  ${label}: built in ${built.toFixed(0)} ms, ${st.factions.length} groups placed, ${st.hives.length} hives on day ${day(st)}, ${alive(st).length} alive, ${perDay.toFixed(0)} ms a day`);
  } catch (e) {
    check(false, `${label}: ${e.stack.split("\n").slice(0, 4).join(" | ")}`);
  }
}

console.log(fails ? `\n${fails} FAILED` : "\nAll custom-setup checks passed.");
process.exit(fails ? 1 : 0);
