// "Why?" test (src/sim/causes.js, ui/causes.js): every death and lost base gets a short chain of causes that names the
// real reasons. Dehydration at the hub with a broken pump and no scrap (the water run called off in the diary),
// starvation on the road on an overdue trip, a fight by the numbers (the odds), a raid death (walls, guards, a group that turned hostile), a death of the
// worm (caught, never spotted), a base overrun by the dead and one taken by a group (state.losses), an old save's death
// without a chain (pieced together from the diary), deaths by cause, the "Why?" links on the log and diary lines and
// the lost-base card, the panel, and a save/load round trip.
// Usage: node tools/causetest.js [seed]
import { createWorld, hub, atBase, makeSurvivor, newId, log, hurt, day } from "../src/sim/world.js";
import { basesDaily } from "../src/sim/economy.js";
import { recomputeOwnership, resolveRaidOnPlayer, changeGoodwill } from "../src/sim/factions.js";
import { launchExpedition, outpostName } from "../src/sim/parties.js";
import { teamNeedsHour } from "../src/sim/needs.js";
import { addBuilding, isPiece } from "../src/sim/buildings.js";
import { breakFixture, fixtures } from "../src/sim/breakdowns.js";
import { catchWorm } from "../src/sim/worm.js";
import { occupyPlayerBase } from "../src/sim/conquest.js";
import { autoResolveCombat } from "../src/sim/combat.js";
import { removeBase } from "../src/sim/world.js";
import { causesDaily, causeKind, deathCause, deathsByCause, lossesOf, MAX_FACTORS } from "../src/sim/causes.js";
import { diaryEntries } from "../src/sim/diary.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { lineWhy, whyModal, cardWhy, whyButton } from "../src/ui/causes.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const W = () => { const st = createWorld({ seed, factionCount: 6 }); st.started = true; st.visitorsOff = true; st.noWanderers = true; return st; };
const plain = (s) => { s.traits = []; s.conditions = []; s.perks = []; s.health = 100; s.mood = 70; s.hunger = 100; s.thirst = 100; s.worm = null; return s; };
const text = (c) => (c ? [c.head, ...c.factors.map((f) => f.t)].join(" | ") : "");
const show = (c) => console.log(`  ${c.head}\n${c.factors.map((f) => `    - ${f.t}`).join("\n")}`);
const sane = (c, what) => {
  check(c && c.factors.length <= MAX_FACTORS, `${what}: at most ${MAX_FACTORS} factors`);
  check(c && c.factors.every((f) => typeof f.t === "string" && f.t.length > 0 && f.t.length < 240), `${what}: short plain factors`);
};
const deathLine = (st, s) => {
  for (let d = day(st); d >= 1; d--) {
    const e = diaryEntries(st, d).find((x) => x.text.startsWith(`${s.name} died`));
    if (e) return { e, d };
  }
  return null;
};
function outpost(st, tile, people = 2) {
  const b = { id: newId(), tile, type: "outpost", name: outpostName(st, tile), stock: { food: 60, water: 40, fuel: 4, meds: 2, ammo: 40, parts: 1, scrap: 30, preserved: 0, jars: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(b);
  for (let i = 0; i < people; i++) { const s = plain(makeSurvivor(st, 0.9)); s.location = { kind: "base", baseId: b.id }; s.role = "rest"; st.survivors.push(s); }
  recomputeOwnership(st);
  return b;
}
const freeNear = (st, from, lo, hi) => st.grid.within(from, hi).find((t) => st.grid.distance(t, from) >= lo && st.tiles[t].terrain !== "water" && st.tiles[t].terrain !== "mountain" && !st.tiles[t].loc && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t));

// ---------- 1. dehydration at the hub: the pump broke, no scrap to fix it, the water run called off ----------
let st1, thirstDead;
{
  section("Dehydrated at the hub");
  const st = st1 = W();
  const h = hub(st);
  for (let i = 0; i < 24; i++) { const s = makeSurvivor(st, 0.9); s.location = { kind: "base", baseId: h.id }; st.survivors.push(s); } // more mouths than the well's water
  for (const s of atBase(st, h.id)) { plain(s); s.role = "rest"; s.station = null; }
  st.hour = 30 * 24;
  const pump = fixtures(h).find((fx) => fx.type === "pump");
  check(!!pump, "the hub has a well pump");
  breakFixture(st, h, pump, "worn out", { card: false });
  st.cards = [];
  h.stock.scrap = 0; h.stock.parts = 0;
  for (const fx of fixtures(h)) if (fx.type === "well") breakFixture(st, h, fx, "worn out", { card: false });
  h.repairs = [];
  causesDaily(st); // scrap 0 from day 31
  st.hour += 24;
  log(st, `Water team (A, B) turned back from the lake: a horde on the road. ${h.name} gets no water this week.`, "danger");
  for (let i = 0; i < 6 && !thirstDead; i++) {
    st.hour += 24;
    h.stock.water = 0; h.stock.rawwater = 0;
    for (const s of atBase(st, h.id)) s.health = Math.min(s.health, 4);
    basesDaily(st);
    causesDaily(st);
    thirstDead = st.survivors.find((s) => !s.alive && (st.memorial || []).some((m) => m.id === s.id && /thirst/.test(m.cause)));
  }
  check(!!thirstDead, "someone died of thirst");
  const c = thirstDead && deathCause(st, thirstDead);
  if (c) show(c);
  check(c && c.kind === "thirst" && c.label === "Thirst", "the kind is thirst");
  check(c && c.recorded, "the chain was recorded at the death");
  check(/broke on day 31/.test(text(c)) && /pump/i.test(text(c)), "it names the pump that broke and the day");
  check(/scrap/.test(text(c)) && /none since day 31/.test(text(c)), "and that there was no scrap to repair it (since day 31)");
  check(/turned back from the lake/.test(text(c)), "and the water run called off (from the diary)");
  check(c && c.factors.some((f) => f.d === 31), "a factor points at its day (diary link)");
  sane(c, "thirst");
  check(!!(h.lows && h.lows.scrap === 31), "base.lows keeps the day the scrap ran out");
  const dl = thirstDead && deathLine(st, thirstDead);
  check(dl && lineWhy(st, dl.e.text, dl.e.kind, dl.e.refs, dl.d) && lineWhy(st, dl.e.text, dl.e.kind, dl.e.refs, dl.d).s === thirstDead.id, "the diary's death line gets a Why? link for them");
  check(!lineWhy(st, `${h.name} is out of water.`, "danger", "", day(st)), "other lines get none");
  const m = st.memorial.find((x) => x.id === thirstDead.id);
  check(/data-action="why"/.test(whyButton(m)), "the memorial entry has a Why? link");
  const html = whyModal(st, { why: { s: thirstDead.id } });
  check(/Why did .* die\?/.test(html) && /data-action="why-day" data-d="31"/.test(html), "the panel shows the chain with day links");
  check(!/undefined|NaN/.test(html), "the panel has no undefined or NaN");
}

// ---------- 2. starvation on the road ----------
{
  section("Starved on the road");
  const st = W();
  const h = hub(st);
  st.hour = 20 * 24 + 8;
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 2).map(plain);
  const dest = st.tiles.find((t) => !t.loc && t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 3);
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: dest.id, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 0, water: 20 } }).party;
  p.departed = st.hour - 6 * 24; p.plannedHours = 48; p.etaBack = 24;
  log(st, `A storm caught ${crew[0].name} on the road; the team took shelter for two days.`, "danger");
  p.phase = "waiting"; p.path = [p.path[0]]; p.idx = 0;
  for (const s of crew) { s.hunger = 0; s.health = 0.01; }
  teamNeedsHour(st, p, crew);
  const dead = crew.find((s) => !s.alive);
  check(!!dead, "someone starved");
  const c = dead && deathCause(st, dead);
  if (c) show(c);
  check(c && c.kind === "hunger", "the kind is hunger");
  check(/left on day 15/.test(text(c)) && /overdue/.test(text(c)), "it names the trip and that the team was overdue");
  check(/run out of food/.test(text(c)), "and that the team ran out of food");
  check(/storm caught/.test(text(c)), "and the storm that held them up (from the diary)");
  sane(c, "hunger");
}

// ---------- 2b. killed in a fight by the numbers: the odds ----------
{
  section("Killed in a fight by the numbers");
  const st = W();
  const h = hub(st);
  st.hour = 40 * 24 + 10;
  const crew = atBase(st, h.id).filter((s) => !s.leader).slice(0, 1).map(plain);
  const dest = st.tiles.find((t) => !t.loc && t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 3);
  const p = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: dest.id, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 5, water: 5 } }).party;
  let dead = null;
  for (let i = 0; i < 20 && !dead; i++) {
    for (const s of crew) s.health = 3;
    autoResolveCombat(st, { tile: p.path[0], partyId: p.id, enemy: { kind: "raiders", count: 8, power: 3, name: "Iron raiders" }, ambush: "enemy", handler: "ct", context: {} });
    dead = crew.find((s) => !s.alive);
  }
  check(!!dead, "they were killed");
  const c = dead && deathCause(st, dead);
  if (c) show(c);
  check(c && c.kind === "fight", "the kind is a fight");
  check(/1 of yours against 8 Iron raiders: about \d+% odds to win/.test(text(c)), "it gives the numbers and the odds");
  check(/They struck first/.test(text(c)), "and that they struck first");
  sane(c, "fight");
}

// ---------- 3. killed in a raid on an outpost; the outpost is lost ----------
{
  section("Killed in a raid; the outpost lost");
  const st = W();
  const h = hub(st);
  st.hour = 80 * 24 + 10;
  const f = st.factions.find((x) => x.alive && x.type === "raider") || st.factions.find((x) => x.alive);
  f.known = true; f.goodwill = 0;
  changeGoodwill(st, f, -60, "you refused their tribute");
  st.hour += 24 * 3;
  const t = freeNear(st, h.tile, 4, 10);
  const o = outpost(st, t, 3);
  addBuilding(o, "walls");
  for (const fx of fixtures(o)) if (fx.type === "walls" || isPiece(fx.type)) fx.wear = 70; // the wall: a ring of pieces (buildings.js addRing)
  for (const s of atBase(st, o.id)) s.health = 5;
  // One of its people out on a trip.
  const away = plain(makeSurvivor(st, 0.9)); away.location = { kind: "base", baseId: h.id }; st.survivors.push(away);
  const dest = freeNear(st, h.tile, 2, 4);
  const trip = launchExpedition(st, { memberIds: [away.id], dest, mission: "move", stance: "normal", vehicleId: null, supplies: { food: 5, water: 5 } });
  if (trip && trip.party) trip.party.homeBaseId = o.id; // they live at the outpost
  check(trip && trip.party, `one of them is out on a trip (${trip && trip.error})`);
  const raid = { id: newId(), owner: f.id, kind: "raid", path: [t], idx: 0, strength: 400, siegeHours: 8, target: { kind: "player", baseId: o.id, tile: t } };
  st.parties.push(raid);
  const people = atBase(st, o.id);
  resolveRaidOnPlayer(st, raid);
  const dead = people.find((s) => !s.alive);
  check(!!dead, "someone was killed in the raid");
  const c = dead && deathCause(st, dead);
  if (c) show(c);
  check(c && c.kind === "raid", `the kind is raid (${c && c.kind})`);
  check(/walls were at 30%/.test(text(c)), "it says the walls were at 30%");
  check(/1 of the 4 people living at .* was away on a trip; nobody was on guard duty/.test(text(c)), "and who was away and on guard");
  check(new RegExp(`${f.name} turned hostile on day 81 \\(you refused their tribute\\)`).test(text(c)), "and when the group turned hostile, and why");
  sane(c, "raid");
  const L = lossesOf(st).find((x) => x.id === o.id);
  check(!!L, `the outpost's loss is recorded (${L ? L.how : "none"})`);
  if (L) {
    console.log(`  ${L.why.h}\n${L.why.f.map((x) => `    - ${x.t}`).join("\n")}`);
    check(L.f === f.id || /Raiders|took|burned|lost/.test(L.why.h), "it names who took it");
    check(L.why.f.some((x) => /walls/.test(x.t)) || L.how === "retreat", "and the walls");
    check(L.why.f.length <= MAX_FACTORS, "a short chain");
    const line = diaryEntries(st, day(st)).find((e) => (lineWhy(st, e.text, e.kind, e.refs, day(st)) || {}).b != null);
    check(!!line && lineWhy(st, line.text, line.kind, line.refs, day(st)).b === o.id, "the loss line in the diary gets a Why? link");
    check(/Why was .* lost\?/.test(whyModal(st, { why: { b: o.id, d: L.day } })), "the panel opens for the base");
  }
}

// ---------- 4. the worm ----------
{
  section("Died of the worm");
  const st = W();
  const h = hub(st);
  st.hour = 50 * 24 + 9;
  const s = plain(atBase(st, h.id).find((x) => !x.leader));
  catchWorm(st, s, "from un-purified water", "water");
  st.hour += 24 * 4;
  h.stock.meds = 0;
  causesDaily(st);
  st.hour += 24;
  s.health = 2;
  hurt(st, s, 5, h.tile, "of the worm", { raw: true });
  check(!s.alive, "they died");
  const c = deathCause(st, s);
  if (c) show(c);
  check(c && c.kind === "worm", "the kind is the worm");
  check(/caught the worm on day 51 from un-purified water/.test(text(c)), "it says when and how they caught it");
  check(/Nobody spotted it/.test(text(c)), "and that nobody spotted it");
  sane(c, "worm");
}

// ---------- 5. an outpost overrun by the dead, and one taken by a group (the hub's card) ----------
{
  section("Bases lost: overrun by the dead, taken by a group");
  const st = W();
  const h = hub(st);
  st.hour = 60 * 24 + 12;
  const o = outpost(st, freeNear(st, h.tile, 4, 10), 2);
  log(st, `A horde of 140 broke through the defences of ${o.name} (they stop about 30). About 110 of the dead are inside.`, "death");
  removeBase(st, o, "was overrun by the dead");
  const L = lossesOf(st)[0];
  check(L && L.id === o.id && L.how === "dead", "the overrun outpost is recorded as lost to the dead");
  if (L) console.log(`  ${L.why.h}\n${L.why.f.map((x) => `    - ${x.t}`).join("\n")}`);
  check(L && /The dead overran/.test(L.why.h), "the headline says the dead overran it");
  check(L && L.why.f.some((x) => /horde of 140/.test(x.t)), "and quotes the horde that broke in");
  check(L && L.why.f.some((x) => /no walls built/.test(x.t)), "and that it had no walls");
  const line = diaryEntries(st, day(st)).find((e) => /was overrun by the dead/.test(e.text));
  check(line && lineWhy(st, line.text, line.kind, line.refs, day(st)), "its log line gets a Why? link");

  const f = st.factions.find((x) => x.alive);
  f.known = true; f.goodwill = -70;
  const o2 = outpost(st, freeNear(st, h.tile, 4, 12), 1);
  occupyPlayerBase(st, o2, f, { garrison: 4, outcome: "overrun" });
  const L2 = lossesOf(st)[0];
  check(L2 && L2.id === o2.id && L2.how === "taken" && L2.f === f.id, "a base a group keeps is recorded as taken, with the group");
  check(L2 && new RegExp(`${f.name} took`).test(L2.why.h), "the headline names them");
  const card = st.cards.find((c) => c.lostBase === o2.tile);
  check(card && /Why was it lost\?/.test(cardWhy(st, card)), "the lost-base card has a Why? link");
  st.cards = [];
}

// ---------- 6. an old save's death, deaths by cause, kinds, save/load ----------
{
  section("Old saves, deaths by cause, save and load");
  const st = st1;
  const m = st.memorial.find((x) => x.id === thirstDead.id);
  const why = m.why;
  delete m.why;
  const c = deathCause(st, thirstDead.id);
  check(c && !c.recorded && c.kind === "thirst" && /died of thirst/.test(c.head), "an old death without a chain still gets its kind and headline");
  check(/before causes were recorded/.test(whyModal(st, { why: { s: thirstDead.id } })), "and the panel says it was pieced together");
  m.why = why;
  const by = deathsByCause(st);
  check(by.thirst >= 1, `deaths by cause counts thirst (${JSON.stringify(by)})`);
  const kinds = [
    ["of thirst on the road", "thirst"], ["of starvation on the road", "hunger"], ["of cold at Hub", "cold"], ["of flu", "illness"],
    ["of pneumonia", "illness"], ["of an infected wound at Hub", "wound"], ["of the worm, by their own team", "worm"],
    ["when the dead overran Hub", "horde"], ["fighting the horde at Hub", "horde"], ["defending Hub", "raid"], ["when Hub was overrun", "raid"],
    ["in a fight with Iron raiders", "fight"], ["while scavenging the mall", "scavenge"], ["the blizzard", "accident"], ["drowned crossing the river", "accident"],
    ["by their own hand at Hub", "own"], ["far from home on a personal errand (never came back)", "lost"],
  ];
  for (const [cause, k] of kinds) check(causeKind(st, cause) === k, `"${cause}" is ${k} (got ${causeKind(st, cause)})`);
  st.cards = []; // "The leader is dead" and the like: a card cannot be saved
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  const c2 = deathCause(back, thirstDead.id);
  check(c2 && c2.recorded && text(c2) === text(deathCause(st, thirstDead.id)), "the chain survives a save and load");
  check(!!(hub(back).lows && hub(back).lows.scrap === 31), "and so do the stock lows");
  const size = JSON.stringify(m.why).length;
  check(size < 1200, `a chain is small (${size} characters)`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
