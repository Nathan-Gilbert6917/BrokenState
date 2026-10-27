// A crew card's 👁 Inventory on the new-run screen (the user's request 2026-10-25: "add a way to see each survivors
// inventory view with a button to reroll the gear inside pockets packs rigs etc"; ui/newgame.js crewInvViewer,
// carriedDice, rerollCarried, crew-inv; sim/hardcore-start.js rollGrab grabStuff regrabStuff, s.stuffRoll):
//   1. the 👁 Inventory button on every crew card, every mode (Crashlanding too) and under Customize;
//   2. the window: their name, every worn and held slot, and the pockets, the rig's pouches and the pack, matching
//      sim/inventory.js carriedSpots (repeats counted); empty ones say so; Done shuts it;
//   3. Hardcore: 🎲 Reroll what they carry changes the pocket and pack things alone (the bag, weapon and armor, a box of
//      rounds in a pocket, the off hand and everyone else's grab kept); the grabbed line names the new things;
//   4. no stuffRoll: the grab is what it was before the change (seeds' grabbed lines, cargo and carried things against
//      values taken from the code before it);
//   5. the same stuffRoll, the same things;
//   6. Normal: the reroll draws a new starting weapon, the vest kept; Customize: a random kit on their points;
//   7. off (greyed, why in its hover) in Ironman, Crashlanding, for a prepper and a custom background, and once started.
// Usage: node tools/crewinvtest.js
import { createWorld } from "../src/sim/world.js";
import { carriedSpots, SLOT_NAMES, packOf } from "../src/sim/inventory.js";
import { countOf, isRoundItem } from "../src/sim/itemstack.js";
import { CUSTOM_BG } from "../src/sim/custombg.js";
import { newRunScreen, crewInvViewer, carriedDice, rerollCarried, crewSnapshot, LOOK_ACTIONS } from "../src/ui/newgame.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const UI = (extra = {}) => ({ started: false, freeEdit: false, ironman: false, worldSize: "normal", factionCount: 5, nrMsg: "", ...extra });
const J = (x) => JSON.stringify(x);
const fnv = (str) => { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, "0"); };
// The road start (Normal since issue #79): Hardcore's hard rules change its car and loot on purpose (tools/modesplittest.js).
const HC = (seed, crew = null) => createWorld({ seed, factionCount: 5, mode: "normal", roadStart: true, startPeople: 4, crew });
const NM = (seed, crew = null) => createWorld({ seed, factionCount: 5, startPeople: 4, crew });
const keyOf = (it) => (it ? it.key : null);
const inside = (s) => [...s.pockets, ...(packOf(s) || [])].filter(Boolean);
const insideKeys = (s) => J([s.pockets.map(keyOf), (packOf(s) || []).map(keyOf)]);
const team = (st) => st.parties.find((p) => p.owner === "player");
// The window's chips for a place: { name: count } (×n read back).
function chipsAt(html, where) {
  const out = {};
  for (const m of html.matchAll(new RegExp(`<span class="chip" data-where="${where}"[^>]*>([^<]*)</span>`, "g"))) {
    const x = m[1].match(/^(.*?)(?: ×(\d+))?$/);
    out[x[1]] = (out[x[1]] || 0) + Number(x[2] || 1);
  }
  return out;
}
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// A worn or held slot's spot ("s:id:slot"; a pouch's is "s:id:rig:0", its where "rig" as the chest rig slot's is).
const worn = (x) => x.loc.split(":").length === 3;
// carriedSpots' things in a pocket, the rig's pouches or the pack: { name: count }.
function spotsAt(s, where) {
  const out = {};
  for (const x of carriedSpots(s)) if (!worn(x) && x.where === where) out[esc(x.item.name)] = (out[esc(x.item.name)] || 0) + countOf(x.item);
  return out;
}
const sameCounts = (html, s, where) => { const a = chipsAt(html, where === "rig" ? "pouch" : where), b = spotsAt(s, where); return Object.keys(a).length === Object.keys(b).length && Object.entries(b).every(([k, n]) => a[k] === n); };
// The world again with this crew, as main.js cardRebuild does it (crew null: as it stands, crewSnapshot).
const rebuilder = (mk, seed, calls) => (crew) => { calls.push(crew); return mk(seed, crew); };

section("1. 👁 Inventory on every crew card");
{
  const crash = createWorld({ seed: 7, factionCount: 7, crash: true });
  for (const [tag, st, ui] of [["Normal", NM(7), UI({ mode: "normal" })], ["Hardcore", HC(7), UI({ mode: "hardcore" })], ["Customize", NM(7), UI({ mode: "normal", freeEdit: true })], ["Ironman", HC(7), UI({ mode: "hardcore", ironman: true })], ["Crashlanding", crash, UI({ mode: "crash" })]]) {
    const h = newRunScreen(st, ui);
    check((h.match(/data-action="crew-inv" data-i="\d+"/g) || []).length === st.survivors.length && /👁 Inventory/.test(h), `${tag}: the button on each of the ${st.survivors.length} cards`);
  }
}

section("2. The window lists what they carry");
{
  const crash = createWorld({ seed: 7, factionCount: 7, crash: true });
  for (const [tag, st, mode] of [["Hardcore", HC(3), "hardcore"], ["Normal", NM(3), "normal"], ["Crashlanding", crash, "crash"]]) {
    st.survivors.forEach((s, i) => {
      const ui = UI({ mode });
      LOOK_ACTIONS["crew-inv"](st, ui, { i: String(i) });
      if (!check(ui.crewInv && ui.crewInv.i === i, `${tag} ${s.name}: 👁 Inventory opens on them`)) return;
      const h = crewInvViewer(st, ui);
      check(h.includes(`<h1>${s.name}</h1>`), `${tag} ${s.name}: titled with their name`);
      const slots = carriedSpots(s).filter(worn);
      check(slots.length ? slots.every((x) => h.includes(`<div>${SLOT_NAMES[x.where]}</div><div><span class="chip" data-where="${x.where}"`) && chipsAt(h, x.where)[esc(x.item.name)] === 1) : /Nothing worn or held\./.test(h), `${tag} ${s.name}: each worn and held slot with its thing (${slots.map((x) => `${x.where} ${x.item.name}`).join(", ")})`);
      check(["pocket", "rig", "pack"].every((w) => sameCounts(h, s, w)), `${tag} ${s.name}: pockets, rig and pack as carriedSpots has them (${["pocket", "rig", "pack"].map((w) => `${w} ${carriedSpots(s).filter((x) => !worn(x) && x.where === w).length}`).join(", ")})`);
      check(/data-tip="[^"]+ \(\d+(\.\d)? kg( each)?\)"/.test(h), `${tag} ${s.name}: a chip's hover has its description and weight`);
      check((s.gear.backpack ? h.includes(`Pack: ${s.gear.backpack.name}`) : /No bag\./.test(h)) && (/Rig: |No rig\./.test(h)) && (s.pockets.some(Boolean) || /Empty pockets\./.test(h)), `${tag} ${s.name}: the containers named, the empty ones said so`);
      check(/data-action="crew-inv-reroll"/.test(h) && /data-action="crew-inv-close"/.test(h), `${tag} ${s.name}: 🎲 Reroll and Done`);
      LOOK_ACTIONS["crew-inv-close"](st, ui, {});
      check(ui.crewInv === null, `${tag} ${s.name}: Done shuts it`);
    });
  }
  const ui = UI({ mode: "hardcore", started: true });
  LOOK_ACTIONS["crew-inv"](HC(3), ui, { i: "0" });
  check(!ui.crewInv, "not once started");
}

section("3. Hardcore: 🎲 Reroll what they carry");
{
  let boxSeen = false, toolSeen = false;
  for (const seed of [3, 7, 17, 25, 42]) { // 17 and 25: a box of rounds in a pocket; 3: a tool in the off hand
    const a = HC(seed);
    a.survivors.forEach((s, i) => {
      if (s.background === "prepper") return;
      const calls = [], ui = UI({ mode: "hardcore" });
      check(!carriedDice(a, ui, s).why, `seed ${seed} ${s.name}: the reroll is on`);
      const b = rerollCarried(a, ui, s, rebuilder(HC, seed, calls));
      const t = b.survivors[i];
      check(calls.length === 1 && Number.isFinite(calls[0][i].stuffRoll) && calls[0].every((c, j) => j === i || c.stuffRoll == null), `seed ${seed} ${s.name}: new dice for them alone (crew[i].stuffRoll)`);
      check(keyOf(t.gear.backpack) === keyOf(s.gear.backpack) && keyOf(t.gear.weapon) === keyOf(s.gear.weapon) && keyOf(t.gear.armor) === keyOf(s.gear.armor) && keyOf(t.gear.tool) === keyOf(s.gear.tool), `seed ${seed} ${s.name}: bag, weapon, armor and off hand kept (${keyOf(s.gear.backpack)}, ${keyOf(s.gear.weapon)}, ${keyOf(s.gear.armor)}, ${keyOf(s.gear.tool)})`);
      if (s.gear.backpack) check(insideKeys(t) !== insideKeys(s), `seed ${seed} ${s.name}: the pocket and pack things changed`);
      const boxes = (x) => J(x.pockets.filter((it) => it && isRoundItem(it)).map((it) => [it.key, it.dur]));
      check(boxes(t) === boxes(s), `seed ${seed} ${s.name}: a box of rounds in a pocket stays`);
      if (boxes(s) !== "[]") boxSeen = true;
      if (s.gear.tool) toolSeen = true;
      check(a.survivors.every((o, j) => j === i || insideKeys(o) === insideKeys(b.survivors[j])), `seed ${seed} ${s.name}: everyone else's things as they were`);
      check(a.factions.map((f) => f.name).join() === b.factions.map((f) => f.name).join() && J(team(a).supplies) === J(team(b).supplies) && J(a.hardcore.start.grabbed.filter((l, j) => j !== a.hardcore.start.grabbed.findIndex((x) => x.startsWith(s.name.split(" ")[0])))) === J(b.hardcore.start.grabbed.filter((l, j) => j !== b.hardcore.start.grabbed.findIndex((x) => x.startsWith(s.name.split(" ")[0])))), `seed ${seed} ${s.name}: the groups, the team's supplies and the other lines as they were`);
      const line = b.hardcore.start.grabbed.find((l) => l.startsWith(s.name.split(" ")[0])) || "";
      check(inside(t).filter((it) => !isRoundItem(it)).every((it) => line.toLowerCase().includes(it.name.toLowerCase())), `seed ${seed} ${s.name}: the grabbed line names the new things`);
      check(b.cards.some((c) => c.intro && c.text.includes(line)), `seed ${seed} ${s.name}: the opening card has it`);
    });
  }
  check(boxSeen && toolSeen, "the seeds had a box of rounds in a pocket and a tool in the off hand to keep");
}

section("4. No stuffRoll: the grab as before the change");
{
  // Taken from the code before the change (commit f14374b): grabbed lines, team cargo and supplies, pocket, pack and
  // off-hand keys, FNV-1a of their JSON.
  const BASE = { 3: ["db36d754", "c1bdf769", "93ae2bd4"], 7: ["16e264aa", "8aa80172", "c5f2c51d"], 11: ["e9c93b13", "54626033", "50cea511"], 42: ["ad9ff6ee", "551ef13c", "8842b4bd"] };
  for (const [seed, [g, c, k]] of Object.entries(BASE)) {
    const st = HC(Number(seed)), p = team(st);
    const carried = st.survivors.map((s) => [s.pockets.map(keyOf), ((s.gear.backpack && s.gear.backpack.contents) || []).map(keyOf), keyOf(s.gear.tool)]);
    check(fnv(J(st.hardcore.start.grabbed)) === g, `seed ${seed}: the grabbed lines as before`);
    check(fnv(J({ gear: p.cargo.gear.map((x) => x.key), sup: p.cargo.supplies, team: p.supplies })) === c, `seed ${seed}: the team's cargo and supplies as before`);
    check(fnv(J(carried)) === k, `seed ${seed}: the pocket, pack and off-hand things as before`);
    check(st.survivors.every((s) => !("stuffRoll" in s)), `seed ${seed}: no stuffRoll on anyone`);
  }
  const st = HC(7), crew = crewSnapshot(st);
  check(crew.every((c) => c.stuffRoll === null) && J(HC(7, crew).hardcore.start.grabbed) === J(st.hardcore.start.grabbed), "a rebuild with the crew as it stands: the same grabs");
}

section("5. The same stuffRoll, the same things");
{
  const st = HC(11), i = st.survivors.findIndex((s) => s.gear.backpack && s.background !== "prepper");
  const mk = (roll) => { const crew = crewSnapshot(st); crew[i].stuffRoll = roll; return HC(11, crew); };
  const a = mk(424242), b = mk(424242), c = mk(5150);
  check(insideKeys(a.survivors[i]) === insideKeys(b.survivors[i]) && J(a.hardcore.start.grabbed) === J(b.hardcore.start.grabbed), "the same dice: the same pocket and pack things, the same line");
  check(insideKeys(c.survivors[i]) !== insideKeys(a.survivors[i]), "other dice: other things");
  check(a.survivors[i].stuffRoll === 424242 && crewSnapshot(a)[i].stuffRoll === 424242 && J(HC(11, crewSnapshot(a)).survivors[i].pockets.map(keyOf)) === J(a.survivors[i].pockets.map(keyOf)), "kept on the survivor (s.stuffRoll) and through crewSnapshot, so a rebuild keeps them");
  const g = crewSnapshot(a);
  check(g[i].stuffRoll === 424242, "carried by crewSnapshot");
}

section("6. Normal: a new starting weapon; Customize: a random kit");
{
  let changed = 0, n = 0;
  for (const seed of [3, 7]) {
    const a = NM(seed);
    a.survivors.forEach((s, i) => {
      const calls = [], ui = UI({ mode: "normal" });
      const b = rerollCarried(a, ui, s, rebuilder(NM, seed, calls));
      const t = b.survivors[i];
      n++;
      if (keyOf(t.gear.weapon) !== keyOf(s.gear.weapon)) changed++;
      check(keyOf(t.gear.armor) === keyOf(s.gear.armor) && b.survivors.every((o, j) => j === i || keyOf(o.gear.weapon) === keyOf(a.survivors[j].gear.weapon)), `seed ${seed} ${s.name}: the vest kept, nobody else's weapon changed (${keyOf(s.gear.weapon)} → ${keyOf(t.gear.weapon)})`);
    });
  }
  check(changed === n, `Normal: the weapon changed every time (${changed} of ${n})`);
  const tip = carriedDice(NM(3), UI({ mode: "normal" }), NM(3).survivors[0]).tip || "";
  check(/new starting weapon/.test(tip) && /vest stays/.test(tip), "Normal: the hover says what it does");
  const c = NM(3), calls = [], ui = UI({ mode: "normal", freeEdit: true }), s = c.survivors[1];
  rerollCarried(c, ui, s, (crew) => { calls.push(crew); return c; });
  check(calls.length === 1 && calls[0] === null && s.startPoints && s.startGear, "Customize: a random kit on their points (the card's Gear), the world again with the crew as it stands");
}

section("7. Off where the dice are not yours");
{
  const off = (st, ui, s, tag, re) => {
    const d = carriedDice(st, ui, s), calls = [];
    const r = rerollCarried(st, ui, s, (crew) => { calls.push(crew); return st; });
    check(!!d.why && re.test(d.why) && r === st && !calls.length, `${tag}: off, its hover says why ("${d.why}")`);
    ui.crewInv = { i: st.survivors.indexOf(s) };
    check(/data-action="crew-inv-reroll" data-i="\d+" disabled/.test(crewInvViewer(st, ui)), `${tag}: the button greyed in the window`);
  };
  const h = HC(7);
  off(h, UI({ mode: "hardcore", ironman: true }), h.survivors[0], "Ironman", /Ironman/);
  const crash = createWorld({ seed: 7, factionCount: 7, crash: true });
  off(crash, UI({ mode: "crash" }), crash.survivors[0], "Crashlanding", /Crashlanding/);
  off(crash, UI({ mode: "crash", freeEdit: true }), crash.survivors[0], "Crashlanding under Customize", /Crashlanding/);
  const p = HC(42), prepper = p.survivors.find((s) => s.background === "prepper");
  if (check(!!prepper, "seed 42 has a prepper")) off(p, UI({ mode: "hardcore" }), prepper, "A prepper", /prepper/i);
  const cb = HC(7);
  cb.survivors[1].background = `${CUSTOM_BG.PREFIX}test`; // a custom background's key (sim/custombg.js isCustomBg)
  off(cb, UI({ mode: "hardcore" }), cb.survivors[1], "A custom background", /custom background/);
  const w = HC(7);
  off(w, UI({ mode: "hardcore", started: true }), w.survivors[0], "Once started", /started/);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
