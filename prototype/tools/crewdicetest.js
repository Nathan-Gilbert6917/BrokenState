// The crew's own dice and the new-run screen's preview world (the user's requests 2026-10-24: "Dice for survivors should
// not be reliant on the map these two should be separate so make the survivors have their own dice"; "Do not start the
// map generation until you start the game, or want to select a tile or view the map prior to starting"; sim/world.js
// crewDice, crewRollOf, PREVIEW_MAP, isPreview; main.js newWorld, needsMap, realThen):
//   1. the starting crew (names, skills, traits and tiers, backgrounds, looks, gear, pockets, the leader) is the same
//      whatever the map size, the AI groups, the hives or the start, in Normal, Hardcore, Custom and Crashlanding;
//   2. a crewRoll gives another crew, and the same one each time; no crewRoll is crewRollOf(seed);
//   3. the world's own dice do not see the crew: the groups and the hub are the same with 1 survivor or 6;
//   4. a preview (createWorld preview) is flagged and on PREVIEW_MAP; the real world is not; the crew in it is the real
//      world's, as rolled and after edits carried by ui/newgame.js crewSnapshot (a rename, skills, the leader, a
//      Hardcore background picked);
//   5. a preview builds fast (the new-run screen's survivor changes are instant again).
// Usage: node tools/crewdicetest.js
import { createWorld, crewRollOf, PREVIEW_MAP, isPreview, localId } from "../src/sim/world.js";
import { crewSnapshot, crewWithBackground } from "../src/ui/newgame.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const t0 = Date.now();

const item = (v) => v && { key: v.key, q: v.q, dur: v.dur, mods: v.mods, loaded: v.loaded };
const crewSig = (st) => JSON.stringify(st.survivors.map((s) => ({
  name: s.name, skills: s.skills, traits: s.traits, tiers: s.traitTier, bg: s.background, look: s.appearance, leader: !!s.leader,
  gear: Object.fromEntries(Object.entries(s.gear).map(([k, v]) => [k, item(v)])), pockets: s.pockets.map(item),
})));
const diffKeys = (a, b) => {
  const A = JSON.parse(a), B = JSON.parse(b), out = new Set();
  if (A.length !== B.length) return ["count"];
  A.forEach((s, i) => { for (const k of Object.keys(s)) if (JSON.stringify(s[k]) !== JSON.stringify(B[i][k])) out.add(k); });
  return [...out];
};
const MODES = {
  normal: { mode: "normal", factionCount: 5 },
  hardcore: { mode: "hardcore", factionCount: 5 },
  custom: { mode: "normal", custom: { people: 4, groups: 5, hives: 3, cities: 2, towns: 10, military: 2 } },
  crash: { crash: true, factionCount: null },
};
const SEED = 23;

section("1. The crew is the same whatever the map");
for (const [m, o] of Object.entries(MODES)) {
  const base = createWorld({ seed: SEED, size: "small", ...o });
  const ref = crewSig(base);
  const vary = [["another size", { size: "custom", customW: 80, customH: 52 }], ["more hives", { hives: 9 }], ["another start", { start: { roll: 4242 } }]];
  if (m === "normal" || m === "hardcore") vary.push(["more groups", { factionCount: 9 }]);
  if (m === "custom") vary.push(["more groups", { custom: { ...o.custom, groups: 9 } }]);
  for (const [label, v] of vary) {
    const other = crewSig(createWorld({ seed: SEED, size: "small", ...o, ...v }));
    check(other === ref, `${m}, ${label}: the same crew (${diffKeys(ref, other).join(", ")})`);
  }
}

section("2. A crew roll of its own");
for (const m of ["normal", "hardcore"]) {
  const o = { seed: SEED, size: "small", ...MODES[m] };
  const a = crewSig(createWorld({ ...o, crewRoll: 777 })), b = crewSig(createWorld({ ...o, crewRoll: 777 }));
  const dflt = crewSig(createWorld(o)), named = crewSig(createWorld({ ...o, crewRoll: crewRollOf(SEED) }));
  check(a === b, `${m}: the same crewRoll, the same crew`);
  check(a !== dflt, `${m}: another crewRoll, another crew`);
  check(named === dflt, `${m}: no crewRoll is crewRollOf(seed)`);
}

section("3. The world's dice do not see the crew");
{
  const groups = (st) => JSON.stringify(st.factions.map((f) => [f.name, f.type, f.bases, f.pop]));
  const hubOf = (st) => JSON.stringify(st.bases[0] && [st.bases[0].tile, st.bases[0].name]);
  const one = createWorld({ seed: SEED, size: "small", factionCount: 5, startPeople: 1 });
  const six = createWorld({ seed: SEED, size: "small", factionCount: 5, startPeople: 6 });
  check(groups(one) === groups(six) && hubOf(one) === hubOf(six), "Normal: 1 survivor or 6, the same groups and hub");
  check(one.rng.state === six.rng.state, `Normal: the world's dice where they were (${one.rng.state} vs ${six.rng.state})`);
  const r1 = createWorld({ seed: SEED, size: "small", factionCount: 5, crewRoll: 5 }), r2 = createWorld({ seed: SEED, size: "small", factionCount: 5, crewRoll: 6 });
  check(groups(r1) === groups(r2) && r1.rng.state === r2.rng.state, "Normal: another crew roll, the same groups and world dice");
}

section("4. The preview's crew is the real world's");
for (const [m, o] of Object.entries(MODES)) {
  const opts = { seed: SEED, size: "large", ...o };
  const pv = createWorld({ ...opts, preview: true });
  check(isPreview(pv) && pv.grid.width === PREVIEW_MAP.W && pv.grid.height === PREVIEW_MAP.H, `${m}: the preview is flagged, on ${pv.grid.width} × ${pv.grid.height}`);
  const real = createWorld(opts);
  check(!isPreview(real) && real.grid.width > PREVIEW_MAP.W, `${m}: the real world is not a preview (${real.grid.width} × ${real.grid.height})`);
  check(crewSig(pv) === crewSig(real), `${m}: as rolled, the preview's crew is the real one (${diffKeys(crewSig(pv), crewSig(real)).join(", ")})`);
  if (m === "normal" || m === "hardcore") {
    const wanted = o.factionCount;
    check(pv.preview.groups === wanted, `${m}: the preview keeps the groups asked for (${pv.preview.groups})`);
  }
  // Edits on the screen, carried as the screen carries them (crewSnapshot), into the real world.
  const s0 = pv.survivors[0];
  s0.name = "Rowan Testwell";
  const k = Object.keys(s0.skills)[0];
  s0.skills[k] = Math.min(20, s0.skills[k] + 3);
  if (pv.survivors[1]) { pv.survivors.forEach((s) => (s.leader = false)); pv.survivors[1].leader = true; }
  let crew = crewSnapshot(pv);
  const bgAt = pv.survivors.length - 1, bgKey = pv.survivors[bgAt].background === "trucker" ? "farmer" : "trucker"; // the last one (the rename and the skills are the first's)
  if (m === "hardcore") crew = crewWithBackground(pv, pv.survivors[bgAt].id, bgKey) || crew;
  const pv2 = createWorld({ ...opts, crew, preview: true }), real2 = createWorld({ ...opts, crew });
  check(crewSig(pv2) === crewSig(real2), `${m}: after edits, the preview's crew is the real one (${diffKeys(crewSig(pv2), crewSig(real2)).join(", ")})`);
  check(real2.survivors[0].name === "Rowan Testwell" && real2.survivors[0].skills[k] === s0.skills[k], `${m}: the rename and the skill went in`);
  if (m === "hardcore") check(real2.survivors[bgAt].background === bgKey, `hardcore: the picked background went in (${real2.survivors[bgAt].background}, wanted ${bgKey})`);
  check(localId(real2, real2.survivors[0].id) > 0, `${m}: the crew's ids are the world's own`);
}

section("5. A preview builds fast");
{
  for (const [m, o] of Object.entries(MODES)) createWorld({ seed: SEED, size: "huge", ...o, preview: true }); // the tiny land kept
  for (const [m, o] of Object.entries(MODES)) {
    const t = performance.now();
    for (let i = 0; i < 3; i++) createWorld({ seed: SEED, size: "huge", ...o, crewRoll: 100 + i, preview: true });
    const ms = (performance.now() - t) / 3;
    check(ms < 400, `${m}: a preview in ${ms.toFixed(0)} ms (under 400)`);
    console.log(`  ${m}: a preview in ${ms.toFixed(0)} ms`);
  }
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
