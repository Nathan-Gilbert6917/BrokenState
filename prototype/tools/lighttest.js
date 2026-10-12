// Headless checks for lights (src/sim/lights.js): the ladder (each heavier and brighter), which light a person has
// working (a headlamp anywhere, the others in the off hand), packing them from the armory on the way out (the planner's
// Lights line and the trips' kit: the lightest that works, off hands full get a headlamp or nothing, a failed launch
// puts them back, the weight counts in the estimate), night battles (sight and how far off the light is noticed, by
// light), surveys at night (the best light carried), and where they come from (finds, crafting).
// Usage: node tools/lighttest.js [seed]
import { darkSight } from "../src/sim/vision.js"; // night sight by the hour (the user's request 2026-10-12)
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { launchExpedition } from "../src/sim/parties.js";
import { createBattle, registerCombatHandler } from "../src/sim/combat.js";
import { detectRange, STEALTH } from "../src/sim/stealth.js";
import { newItem } from "../src/sim/inventory.js";
import { LIGHTS, LIGHT_KEYS, lightOf, packLights, lightsPreview } from "../src/sim/lights.js";
import { lookContext } from "../src/sim/survey.js";
import { LIGHT_FINDS } from "../src/sim/loot.js";
import { CRAFTS } from "../src/sim/crafting.js";
import { packTripKit } from "../src/sim/kit.js";

const seed = Number(process.argv[2] || 42);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else { fail++; console.log(`  FAIL ${what}`); } return ok; };
registerCombatHandler("lt", () => {});
const world = () => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; return st; };
const bare = (s) => { s.gear.tool = null; s.pockets = (s.pockets || []).map(() => null); return s; };

console.log("The ladder");
{
  const order = ["headlamp", "flashlight", "torch", "lantern", "spotlight"];
  check(order.every((k) => GEAR[k] && LIGHTS[k]), "five lights, each an item");
  check(order.every((k, i) => i === 0 || GEAR[k].weight >= GEAR[order[i - 1]].weight), `heavier up the ladder (${order.map((k) => GEAR[k].weight).join(", ")} kg)`);
  check(order.every((k, i) => i === 0 || LIGHTS[k].sight >= LIGHTS[order[i - 1]].sight), `brighter up the ladder (sees ${order.map((k) => LIGHTS[k].sight).join(", ")})`);
  check(order.every((k) => LIGHTS[k].sight > STEALTH.NIGHT_SIGHT && LIGHTS[k].sight < 13), "every light beats the dark, none is daylight");
  check(LIGHTS.flashlight.sight === STEALTH.LIGHT_SIGHT && LIGHTS.flashlight.seen === STEALTH.LIGHT_DETECT, "the flashlight keeps its old numbers (9 tiles, seen 3 further)");
  check(LIGHT_KEYS[0] === "headlamp" && LIGHT_KEYS[LIGHT_KEYS.length - 1] === "spotlight", "packed lightest first");
}

console.log("Which light works");
{
  const st = world();
  const s = bare(atBase(st, hub(st).id)[0]);
  check(lightOf(s) === null, "nothing carried: no light");
  s.pockets[0] = newItem("flashlight");
  check(lightOf(s) === null, "a flashlight in a pocket does not light the way");
  s.pockets[0] = newItem("headlamp");
  check(lightOf(s) === "headlamp", "a headlamp in a pocket does (strapped on)");
  s.gear.tool = newItem("spotlight");
  check(lightOf(s) === "spotlight", "the brighter of a headlamp and an off-hand spotlight");
}

console.log("Packing from the armory");
{
  const st = world();
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 3).map(bare);
  crew[2].gear.tool = newItem("bandagekit"); // off hand full
  h.armory = h.armory.filter((it) => !it || !LIGHTS[it.key]);
  h.armory.push(newItem("spotlight"), newItem("flashlight"), newItem("lantern"));
  const pv = lightsPreview(h, crew);
  check(pv.names.length === 2 && pv.kg === Math.round((GEAR.flashlight.weight + GEAR.lantern.weight) * 10) / 10, `preview: ${pv.names.join(", ")} (${pv.kg} kg); the full off hand gets nothing`);
  const got = packLights(h, crew);
  check(got.length === 2 && lightOf(crew[0]) === "flashlight" && lightOf(crew[1]) === "lantern" && !lightOf(crew[2]), `lightest first: ${got.join(", ")}`);
  check(h.armory.filter((it) => it && LIGHTS[it.key]).map((it) => it.key).join() === "spotlight", "the spotlight stays in the armory");
  h.armory.push(newItem("headlamp"));
  check(packLights(h, crew).length === 1 && lightOf(crew[2]) === "headlamp", "a headlamp for the one whose off hand is full");
}

console.log("Launching with lights");
{
  const st = world();
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 2).map(bare);
  h.armory = h.armory.filter((it) => !it || !LIGHTS[it.key]);
  h.armory.push(newItem("spotlight"), newItem("spotlight"));
  const tile = st.tiles.find((t) => t.terrain === "plains" && st.grid.distance(t.id, h.tile) === 6).id;
  // A failed launch puts them back.
  const bad = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "move", stance: "normal", supplies: { food: 99999 }, lights: true });
  check(!!bad.error && h.armory.filter((it) => it && it.key === "spotlight").length === 2 && !crew.some(lightOf), `a failed launch (${bad.error}) leaves the lights in the armory`);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "move", stance: "normal", supplies: { food: 4, water: 4 }, lights: true });
  check(!res.error && crew.every((s) => lightOf(s) === "spotlight") && !h.armory.some((it) => it && it.key === "spotlight"), "the team leaves with a spotlight each");
  check(st.log.some((l) => /takes lights from the armory/.test(l.text)), "the log says so");
  const st2 = world();
  const h2 = hub(st2), c2 = atBase(st2, h2.id).slice(0, 2).map(bare);
  h2.armory = h2.armory.filter((it) => !it || !LIGHTS[it.key]);
  h2.armory.push(newItem("spotlight"), newItem("spotlight"));
  const res2 = launchExpedition(st2, { memberIds: c2.map((s) => s.id), dest: tile, mission: "move", stance: "normal", supplies: { food: 4, water: 4 } });
  check(!res2.error && !c2.some(lightOf), "no Lights option: nothing packed");
  const a = res.party.burden.total, b = res2.party.burden.total;
  check(Math.abs(a - b - 2 * GEAR.spotlight.weight) < 1e-6, `the lights are carried weight (${a} kg against ${b})`);
  // The trips' kit (autopilot and crews) brings a light each too.
  const st3 = world();
  const h3 = hub(st3), c3 = atBase(st3, h3.id).slice(0, 2).map(bare);
  h3.armory = h3.armory.filter((it) => !it || !LIGHTS[it.key]);
  h3.armory.push(newItem("headlamp"), newItem("torch"));
  const kit = packTripKit(st3, h3, c3, "scavenge");
  check(c3.every(lightOf) && kit.includes("Headlamp") && kit.includes("Torch"), `a trip's kit: ${kit.join(", ")}`);
}

console.log("Night battles");
{
  const raid = (tool) => {
    const st = world();
    const h = hub(st);
    st.hour = 22;
    const crew = atBase(st, h.id).slice(0, 2).map(bare);
    if (tool) crew[0].gear.tool = newItem(tool);
    if (tool === "headlamp") { crew[0].gear.tool = null; crew[0].pockets[0] = newItem("headlamp"); }
    const tile = st.tiles.find((t) => t.loc && t.loc.type === "town" && t.id !== h.tile).id;
    const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: tile, mission: "scavenge", stance: "normal", supplies: { food: 6, water: 6 } }).party;
    p.path = [tile]; p.idx = 0; p.phase = "engaged";
    const b = createBattle(st, { mode: "raid", tile, partyId: p.id, canRetreat: true, ambush: null, handler: "lt", enemy: { kind: "raiders", count: 2, power: 3 }, raid: { heat0: 0 }, context: {} });
    for (let y = 3; y <= 7; y++) for (let x = 8; x <= 14; x++) b.cells[y * b.w + x].k = "open"; // no cover between them (vision.js: behind cover they are only heard)
    b.losCache.fill(0);
    return { b, me: b.units.find((u) => u.sid === crew[0].id), guard: b.units.find((u) => u.side === "enemy") };
  };
  const dark = raid(null);
  const front = (g) => ({ ...g, face: [1, 0], x: 10, y: 5, light: null }); // (a guard's own flashlight: vision.js enemyLight, visiontest.js)
  const at = (u) => ({ ...u, x: 12, y: 5, sneak: 0, ghost: false });
  const r0 = detectRange(dark.b, front(dark.guard), at(dark.me));
  check(dark.b.night && dark.me.sight === darkSight(dark.b) && !dark.me.light, `in the dark: sees ${dark.me.sight} (22:00), noticed from ${r0}`);
  for (const k of Object.keys(LIGHTS)) {
    const r = raid(k);
    const rr = detectRange(r.b, front(r.guard), at(r.me));
    const reach = Math.max(darkSight(r.b), LIGHTS[k].round ? LIGHTS[k].pool : LIGHTS[k].sight); // vision.js: a beam ahead, a pool all round, the dark's own
    check(r.me.light === k && r.me.sight === Math.min(r.me.daySight, reach) && rr === r0 + LIGHTS[k].seen, `${k}: sees ${r.me.sight}, noticed from ${rr} (+${LIGHTS[k].seen})`);
  }
}

console.log("Surveys at night");
{
  const st = world();
  const s = bare(atBase(st, hub(st).id)[0]);
  check(!lookContext(st, [s]).lamp, "no light: the dark's odds");
  s.pockets[0] = newItem("headlamp");
  s.pockets[1] = newItem("spotlight");
  const ctx = lookContext(st, [s]);
  check(ctx.lamp === LIGHTS.spotlight.survey && ctx.lampKey === "spotlight", `the best light carried counts (×${ctx.lamp}, ${ctx.lampKey})`);
}

console.log("Where they come from");
{
  const found = new Set(Object.values(LIGHT_FINDS).flatMap((f) => Object.keys(f.items)));
  check(["headlamp", "lantern", "spotlight"].every((k) => found.has(k)), "headlamps, lanterns and spotlights are found");
  check(Object.keys(LIGHTS).filter((k) => k !== "tacflash").every((k) => CRAFTS[k]), "every light can be made (but the military flashlight: issue kit, found)");
  check(found.has("tacflash") && found.has("windlight"), "military and wind-up flashlights are found");
  check(CRAFTS.torch.in.wood >= 1 && CRAFTS.torch.field, "a torch from firewood, anywhere");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
