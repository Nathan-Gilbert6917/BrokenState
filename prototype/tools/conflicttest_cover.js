// Coverage test: forces every conflict type many times and tries every option, then soaks captives
// for 60 days to see escapes, releases, recruitment and deaths. Checks for crashes and stuck teams.
// Usage: node tools/conflicttest_cover.js [iterations]
import { createWorld, tickHour, day, hub, atBase, alive, makeSurvivor } from "../src/sim/world.js";
import { launchExpedition, partyMembers, partyTile } from "../src/sim/parties.js";
import { triggerConflict, CONFLICT_TYPES, takeCaptive, allCaptives, rescueArrive } from "../src/sim/conflicts.js";
import { Rng } from "../src/sim/rng.js";

const iters = Number(process.argv[2] || 40);
let problems = 0;
const choiceUse = {};

function resolveAll(state, pick, depth = 0) {
  let n = 0;
  while (state.cards.length) {
    if (++n > 40) { problems++; console.log("card loop:", state.cards[0].title); state.cards.length = 0; return; }
    const c = state.cards.shift();
    const opts = c.choices.filter((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(state) : x.disabled));
    if (!opts.length) { if (c.kind === "conflict") { problems++; console.log("no enabled option:", c.title); } continue; }
    const ch = pick.pick(opts);
    if (c.kind === "conflict") choiceUse[`${c.conflict.type}: ${ch.label.replace(/\(.*\)/, "").trim()}`] = (choiceUse[`${c.conflict.type}: ${ch.label.replace(/\(.*\)/, "").trim()}`] || 0) + 1;
    const r = ch.resolve(state);
    if (typeof r !== "string") { problems++; console.log("resolve did not return text:", c.title, ch.label); }
  }
}

function refill(state) {
  while (atBase(state, hub(state).id).length < 6) {
    const n = makeSurvivor(state);
    n.location = { kind: "base", baseId: hub(state).id };
    state.survivors.push(n);
  }
  for (const s of atBase(state, hub(state).id)) s.health = Math.max(s.health, 80);
}

function newTeam(state, pick) {
  const h = hub(state);
  const pool = atBase(state, h.id);
  if (pool.length < 2) return null;
  const crew = pool.slice(0, pick.int(1, Math.min(4, pool.length)));
  const dest = state.tiles.find((t) => t.terrain !== "water" && state.grid.distance(t.id, h.tile) === 5).id;
  h.stock.food += 20; h.stock.water += 20; h.stock.ammo += 60; h.stock.scrap += 10; h.stock.meds += 1;
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", supplies: { food: 8, water: 8, ammo: 30, scrap: 10, meds: 1 } });
  if (res.error) { console.log("launch:", res.error); return null; }
  const p = res.party;
  p.idx = Math.min(2, p.path.length - 1); // a little way out
  return p;
}

for (const seed of [11, 12, 13]) {
  const state = createWorld({ seed, factionCount: 9 });
  const pick = new Rng(seed);
  for (const f of state.factions) f.known = pick.chance(0.5);
  try {
    for (const type of Object.keys(CONFLICT_TYPES)) {
      for (let i = 0; i < iters; i++) {
        // Keep enough people around.
        refill(state);
        const p = newTeam(state, pick);
        if (!p) { for (const q of [...state.parties]) if (q.owner === "player") state.parties.splice(state.parties.indexOf(q), 1); for (const s of alive(state)) if (s.location.kind === "party") s.location = { kind: "base", baseId: hub(state).id }; continue; }
        const fs = state.factions.filter((f) => f.alive);
        const f = pick.pick(fs);
        // Vary attitude and pacts.
        f.goodwill = pick.pick([-80, -45, 0, 30, 75]);
        f.pact = pick.pick([null, null, "nonaggression"]);
        triggerConflict(state, p, type, f ? f.id : null);
        resolveAll(state, pick);
        if (state.parties.includes(p) && p.phase === "engaged" && !state.trade && !state.engagement) { problems++; console.log(`stuck engaged after ${type}`); }
        // Bring everyone home.
        state.trade = null; state.engagement = null;
        for (const q of [...state.parties]) if (q.owner === "player") state.parties.splice(state.parties.indexOf(q), 1);
        for (const s of alive(state)) if (s.location.kind === "party") s.location = { kind: "base", baseId: hub(state).id };
      }
    }
    // Rescue missions: capture people, then send a team to each faction base.
    for (let i = 0; i < iters; i++) {
      const f = pick.pick(state.factions.filter((x) => x.alive));
      if (!f) break;
      f.goodwill = pick.pick([-80, -30, 0]);
      refill(state);
      const victim = atBase(state, hub(state).id).find((s) => !s.leader);
      if (!victim) break;
      takeCaptive(state, victim, f, null);
      const p = newTeam(state, pick);
      if (!p) continue;
      p.dest = f.bases[0];
      p.path = [f.bases[0]]; p.idx = 0; p.mission = "rescue";
      rescueArrive(state, p);
      resolveAll(state, pick);
      if (state.parties.includes(p) && p.phase === "engaged" && !state.trade && !state.engagement) { problems++; console.log("stuck after rescue"); }
      state.trade = null; state.engagement = null;
      for (const q of [...state.parties]) if (q.owner === "player") state.parties.splice(state.parties.indexOf(q), 1);
      for (const s of alive(state)) if (s.location.kind === "party") s.location = { kind: "base", baseId: hub(state).id };
    }
    // Captive soak: lock up several people and let 60 days pass.
    refill(state);
    const held = [];
    for (const f of state.factions.filter((x) => x.alive)) {
      refill(state);
      for (const s of atBase(state, hub(state).id).filter((x) => !x.leader).slice(0, 2)) { takeCaptive(state, s, f, null); held.push(s); }
      f.goodwill = pick.pick([-80, -20, 10, 40]);
    }
    const start = day(state);
    while (day(state) < start + 60 && !state.gameOver) {
      tickHour(state);
      hub(state).stock.food += 2;
      state.cards.length = 0;
      state.engagement = null;
      state.trade = null;
    }
    const still = allCaptives(state).length;
    console.log(`seed ${seed}: soak held ${held.length}, still held after 60 days ${still}, captive events`, state.stats.conflicts.captiveEvents);
  } catch (e) {
    problems++;
    console.log(`seed ${seed}: CRASH day ${day(state)}`, e.stack);
  }
  console.log(`seed ${seed}: conflicts`, Object.values(state.stats.conflicts.types).reduce((a, b) => a + b, 0), "captured", state.stats.conflicts.captured, "rescued", state.stats.conflicts.rescued);
}
console.log("\nChoices used:", Object.keys(choiceUse).length);
console.log(Object.entries(choiceUse).sort().map(([k, v]) => `  ${k}: ${v}`).join("\n"));
console.log(`Problems: ${problems}`);
if (problems) process.exitCode = 1;
