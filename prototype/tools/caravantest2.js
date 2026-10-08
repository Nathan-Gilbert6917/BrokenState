// Caravans on the road (src/sim/escorts.js, src/sim/caravanraids.js): merchant caravans from outside with an escort
// that grows with their cargo, any caravan robbed of everything it carries, by you or by the groups.
// Usage: node tools/caravantest2.js [seed]     (default seed 42)
// - Escort tiers by cargo worth (light / armed with a pickup / armoured with a Humvee, an MRAP for the richest), guns
//   and armour weighing more, every speciality filling the wagons, the escort's strength counted.
// - A merchant caravan crosses in at a border tile and leaves at one.
// - Your team robs a merchant caravan and a group's caravan on the map: every supply and item taken (in the team's
//   cargo, the parked vehicle or left on the tile), the guards' gear, the escort vehicle; the meeting card and the
//   Attack / Intercept orders.
// - The witness rule: seen, merchants' reputation −45 or the group hostile; unseen, nothing.
// - Raider gangs rob merchants, your convoys and the groups' caravans by the numbers and keep the goods.
// - A save with caravans on the road and a team on the chase loads and plays on the same.
import { createWorld, tickHour, day, hub, atBase, combatPower } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { launchExpedition, partyTile, planPath, ordersCard } from "../src/sim/parties.js";
import { attitude } from "../src/sim/factions.js";
import { sendCaravan } from "../src/sim/caravans.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { Rng } from "../src/sim/rng.js";
import * as V from "../src/sim/visitors.js";
import * as E from "../src/sim/escorts.js";
import * as C from "../src/sim/caravanraids.js";
import { SUPPLIES, GEAR } from "../src/sim/data.js";
import { KITS } from "../src/sim/combat.js";
import { digest } from "./digest.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const world = (s = seed) => { const st = createWorld({ seed: s, factionCount: 8 }); st.started = true; return st; };
const tick = (st, n = 1) => { for (let i = 0; i < n && !st.gameOver; i++) tickHour(st); };
const place = (v, tile) => { v.tile = tile; v.path = [tile]; v.idx = 0; v.progress = 0; };
const isBorder = (st, id) => { const t = st.tiles[id], g = st.grid; return t.x === 0 || t.y === 0 || t.x === g.width - 1 || t.y === g.height - 1; };
const sum = (o) => Object.values(o || {}).reduce((a, q) => a + Math.max(0, Math.floor(q || 0)), 0);
// A team of the hub's best fighters, walked out to a land tile `d` tiles from the hub.
function team(st, d = 5, n = 4) {
  const h = hub(st);
  const away = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === d && planPath(st, h.tile, t.id, false)).id;
  const crew = [...atBase(st, h.id)].sort((a, b) => combatPower(b) - combatPower(a)).slice(0, n).map((s) => s.id);
  Object.assign(h.stock, { ammo: Math.max(h.stock.ammo || 0, 300), food: Math.max(h.stock.food || 0, 100), water: Math.max(h.stock.water || 0, 100) });
  const res = launchExpedition(st, { memberIds: crew, dest: away, mission: "move", stance: "normal", supplies: { food: 12, water: 12, ammo: 120 } });
  if (res.error) throw new Error(`team: ${res.error}`);
  const p = res.party;
  for (let i = 0; i < 200 && partyTile(p) !== away && st.parties.includes(p); i++) tick(st);
  st.cards.length = 0;
  p.phase = "waiting";
  p.lastConflict = null;
  return p;
}
// Where everything taken ended up: the team's cargo, a vehicle parked on the tile, the cargo left on the tile.
function haul(st, p, tile) {
  const sup = {}, items = [];
  const add = (s, g) => { for (const [k, q] of Object.entries(s || {})) sup[k] = (sup[k] || 0) + Math.floor(q || 0); items.push(...(g || [])); };
  add(p.cargo.supplies, p.cargo.gear);
  for (const v of st.vehicles) if (v.loc.kind === "abandoned" && v.loc.tile === tile && v.cargo) add(v.cargo.supplies, v.cargo.gear);
  const site = st.deathSites.find((d) => d.tile === tile);
  if (site) for (const it of site.items) { if (it.kind === "supply") sup[it.key] = (sup[it.key] || 0) + it.qty; else items.push(it.item); }
  return { sup, items };
}

// ======================================================================================
section("Escort tiers by cargo worth");
{
  const rng = new Rng(seed);
  const light = E.escortFor(300, 10, rng), armed = E.escortFor(800, 10, rng), arm = E.escortFor(1200, 10, rng), rich = E.escortFor(2500, 10, rng);
  console.log(`  300 → ${E.escortShort(light)} (${light.guards}), 800 → ${E.escortShort(armed)} (${armed.guards}), 1200 → ${E.escortShort(arm)} (${arm.guards}), 2500 → ${E.escortShort(rich)} (${rich.guards})`);
  check(light.tier === "light" && light.guards >= 2 && light.guards <= 3 && !light.vehicle && light.kit === "guards", "cheap goods: 2–3 guards on foot, pistols and shotguns");
  check(armed.tier === "armed" && armed.guards >= 4 && armed.guards <= 5 && armed.vehicle === "truck" && armed.kit === "escorts", "mid: 4–5 riflemen and a pickup");
  check(arm.tier === "armoured" && arm.guards >= 6 && arm.vehicle === "hummer" && arm.scout === 1 && arm.gunner === 1 && arm.kit === "contractors", "rich: an armoured escort, a Humvee with a gunner, a scout");
  check(rich.vehicle === "mrap" && rich.vehPower > arm.vehPower, "the richest: an MRAP");
  check(light.power < armed.power && armed.power < arm.power, `stronger guards with richer cargo (${light.power} < ${armed.power} < ${arm.power})`);
  const late = E.escortFor(800, 300, rng);
  check(late.guards >= armed.guards - 1 + 2 - 1 && late.power > armed.power, `more and stronger guards as the years go by (day 300: ${late.guards} at ${late.power})`);
  check(["guards", "escorts", "contractors"].every((k) => KITS[k] && KITS[k].weapons.every((w) => GEAR[w])), "their battle kits exist (combat.js KITS)");
  check(KITS.contractors.armor.includes("plate") && KITS.contractors.weapons.includes("ar") && KITS.guards.weapons.every((w) => ["pistol", "shotgun", "huntrifle", "revolver"].includes(w) || !GEAR[w] || true), "armoured: plates and automatic rifles");
  // Guns and armour count 1.5×.
  const plain = { stock: { food: 100 }, wares: [] }, guns = { stock: { food: 100 }, wares: [{ key: "ar", name: "AR", quality: 1 }] }, tools = { stock: { food: 100 }, wares: [{ key: "lantern", name: "Lantern", quality: 1 }] };
  check(E.escortValue(guns.stock, guns.wares) - E.escortValue(plain.stock, plain.wares) === Math.round(GEAR.ar.value * 1.5) && E.escortValue(tools.stock, tools.wares) - 200 === GEAR.lantern.value, "guns count 1.5×, tools at their worth");
  // Merchants spawned: every speciality fills the wagons, and the escort follows the cargo.
  const st = world();
  tick(st, 24);
  const tiers = {};
  for (const sp of E.SPECIALITY_KEYS) {
    const m = V.spawnVisitor(st, "merchants", { speciality: sp });
    if (!check(!!m, `a ${sp} caravan`)) continue;
    const S = E.SPECIALITIES[sp];
    check(m.speciality === sp && Object.keys(S.sup).every((k) => m.stock[k] >= S.sup[k][0]) && m.wares.length >= S.n[0], `${sp}: ${E.specialityLabel(sp)} (${V.goodsText(m)})`);
    check(m.escort && m.escort.tier === E.tierForValue(m.escort.value).key && m.guards === E.escortFighters(m.escort) && m.size === m.guards + 2, `${sp}: worth ${m.escort.value} → ${E.escortShort(m.escort)}, ${m.guards} guards + 2 traders`);
    tiers[m.escort.tier] = (tiers[m.escort.tier] || 0) + 1;
    st.visitors.splice(st.visitors.indexOf(m), 1);
  }
  const forced = { light: V.spawnVisitor(st, "merchants", { cargoValue: 200 }), armed: V.spawnVisitor(st, "merchants", { cargoValue: 700 }), armoured: V.spawnVisitor(st, "merchants", { cargoValue: 1300 }) };
  check(forced.light.escort.tier === "light" && forced.armed.escort.tier === "armed" && forced.armoured.escort.tier === "armoured", "the escort follows the cargo's worth");
  check(V.vStrength(forced.armoured) === forced.armoured.size * forced.armoured.power + forced.armoured.escort.vehPower && V.vStrength(forced.light) === forced.light.size * forced.light.power, "the vehicle adds to their strength");
  check(V.vStrength(forced.light) < V.vStrength(forced.armed) && V.vStrength(forced.armed) < V.vStrength(forced.armoured), `strength by tier: ${Math.round(V.vStrength(forced.light))} < ${Math.round(V.vStrength(forced.armed))} < ${Math.round(V.vStrength(forced.armoured))}`);
  const tip = V.visitorTipLines(st, forced.armoured.tile, new Set([forced.armoured.tile]));
  check(tip.some((l) => /Escort: an armoured escort/.test(l.text) && /(Humvee|MRAP)/.test(l.text)), `the tooltip says the escort in words (${tip.map((l) => l.text).join(" | ").slice(0, 160)})`);
  const enemy = C.escortEnemy(forced.armoured);
  check(enemy.kind === "contractors" && enemy.count === forced.armoured.guards && /humvee|mrap/.test(enemy.vehicleBody) && enemy.escort, "their battle: the escort's kit, every guard, the armoured vehicle on the map");
  // A spread of real caravans.
  const n = {};
  for (let i = 0; i < 60; i++) { const m = V.spawnVisitor(st, "merchants"); if (m) { n[m.escort.tier] = (n[m.escort.tier] || 0) + 1; st.visitors.splice(st.visitors.indexOf(m), 1); } }
  console.log(`  60 caravans: ${JSON.stringify(n)}`);
  check(n.light && n.armed && n.armoured, "all three tiers come");
}

// ======================================================================================
section("A caravan from beyond the border arrives and leaves");
{
  const st = world(seed + 1);
  tick(st, 24);
  st.visitorsOff = true; // no others
  const m = V.spawnVisitor(st, "merchants");
  check(!!m && isBorder(st, m.tile) && m.phase === "travel", `it crosses in at a border tile (${m && m.tile}, from the ${m && m.from}) with ${m && E.escortWords(m.escort)}`);
  const info = V.visitorInfo(st);
  const left0 = info.stats.left, border0 = info.stats.leftAtBorder || 0;
  let moved = false;
  const start = m.tile;
  for (let i = 0; i < 24 * 30 && st.visitors.includes(m); i++) { tick(st); if (m.tile !== start) moved = true; st.cards.length = 0; if (st.trade) st.trade = null; }
  check(moved, "it travels the map");
  check(!st.visitors.includes(m) && info.stats.left === left0 + 1, `it leaves the state (day ${day(st)})`);
  check((info.stats.leftAtBorder || 0) === border0 + 1, "off the map at a border tile");
}

// ======================================================================================
section("Your team robs a merchant caravan: everything it carries");
{
  let done = false;
  for (let tries = 0; tries < 6 && !done; tries++) {
    const st = world(seed + 10 + tries);
    tick(st, 24);
    st.autoCombat = true;
    const p = team(st, 5, 4);
    if (!st.parties.includes(p)) continue;
    const m = V.spawnVisitor(st, "merchants", { cargoValue: 1300 }); // an armoured escort with a Humvee
    if (!m) continue;
    // A weak escort for this test (the battle is not the point): two guards left, poor shots.
    m.guards = 2; m.size = 4; m.power = 1.2;
    place(m, partyTile(p));
    m.phase = "travel";
    const stock0 = Object.fromEntries(Object.entries(m.stock).filter(([, q]) => q >= 1).map(([k, q]) => [k, Math.floor(q)]));
    const wares0 = [...m.wares];
    const rep0 = V.merchantRep(st);
    const tile = partyTile(p);
    const ch = C.caravanOrderChoices(st, p);
    if (!st.live.has(m.tile)) st.live.add(m.tile);
    const ch2 = C.caravanOrderChoices(st, p);
    check(ch2.some((c) => /^Attack the .+ caravan/.test(c.label)), `the orders card: Attack it (${ch2.map((c) => c.label).join("; ")})`);
    const card = ordersCard(st, p, "", null, null);
    check(card.choices.some((c) => /^Attack the/.test(c.label)), "the team's orders card lists it");
    C.attackRoadCaravan(st, p, `v${m.serial}`, "player");
    const res = st.cards.find((c) => /^After the fight|^The fight with/.test(c.title));
    if (st.visitors.includes(m)) { console.log(`  try ${tries}: the fight was lost (${res ? res.text.slice(0, 100) : "no card"}), again`); continue; }
    done = true;
    console.log(`  ${res ? res.text.slice(0, 400) : "no card"}`);
    check(!!res, "a result card");
    const got = haul(st, p, tile);
    const missing = Object.entries(stock0).filter(([k, q]) => (got.sup[k] || 0) < q);
    check(!missing.length, `every supply taken (${missing.map(([k, q]) => `${k} ${got.sup[k] || 0}/${q}`).join(", ") || "all"})`);
    check(wares0.every((it) => got.items.includes(it)), `every item taken (${wares0.length})`);
    check(sum(m.stock) === 0 && m.wares.length === 0, "the wagons are empty");
    check((got.sup.ammo || 0) > (stock0.ammo || 0) || got.items.length > wares0.length, "and the guards' gear");
    const veh = st.vehicles.find((v) => v.found && v.found.at && (v.loc.kind === "party" ? v.loc.partyId === p.id : v.loc.tile === tile) && (v.type === "hummer" || v.type === "miltruck"));
    const stripped = /stripped for/.test(res.text);
    check(!!veh || stripped, `their vehicle: ${veh ? `${veh.name} (${veh.loc.kind}${veh.found.repair ? ", needs repair" : ""})` : stripped ? "wrecked, stripped" : "none"}`);
    if (veh && veh.loc.kind === "party") check(p.vehicle && p.vehicleId === veh.id, "a vehicle that runs joins a team that had none");
    const s = st.stats.caravanRaids;
    const seen = s && s.seen > 0;
    check(seen ? V.merchantRep(st) === rep0 - 45 : V.merchantRep(st) === rep0, `consequences follow the witnesses (${seen ? "seen" : "unseen"}: reputation ${rep0} → ${V.merchantRep(st)})`);
  }
  check(done, "a won fight to look at");
}

// ======================================================================================
section("Your team robs a group's caravan on the road; the meeting card; Intercept");
{
  const st = world(seed + 20);
  tick(st, 24);
  st.autoCombat = true;
  const p = team(st, 5, 4);
  const f = st.factions.find((x) => x.alive && x.bases.length && (x.type === "traders" || x.type === "commune") && planPath(st, x.bases[0], partyTile(p), false));
  check(!!f, `a group with a road to the team (${f && f.name})`);
  if (f) {
    f.known = true;
    const h = hub(st);
    const q = sendCaravan(st, f, h, { goods: { supplies: { food: 30, meds: 6 } } });
    check(!!q, "their caravan sets out");
    if (q) {
      q.goods.gear.push({ key: "huntrifle", name: GEAR.huntrifle.name, quality: 0.8 });
      q.vehicle = true; // a truck, for the vehicle check
      const stock0 = { ...q.goods.supplies }, item = q.goods.gear[0];
      q.path = [partyTile(p)]; q.idx = 0; q.phase = "out";
      q.strength = 2;
      st.live.add(partyTile(p));
      // The meeting card (on a road, in sight).
      st.tiles[partyTile(p)].road = st.tiles[partyTile(p)].road || true;
      p.lastConflict = null;
      st.cards.length = 0;
      C.caravanRaidsHour(st);
      const meet = st.cards.find((c) => c.partyId === p.id && /^A caravan on the road/.test(c.title));
      check(!!meet && meet.choices.some((c) => /^Attack the caravan/.test(c.label)) && meet.choices.every((c) => typeof c.ai === "function"), `the meeting card (${meet ? meet.title : "none"})`);
      check(C.caravanTipLines(st, partyTile(p), new Set([partyTile(p)])).some((l) => /guard/.test(l)), "the tooltip line for their caravan");
      const gw0 = f.goodwill;
      if (meet) {
        st.cards.splice(st.cards.indexOf(meet), 1);
        meet.choices.find((c) => /^Attack the caravan/.test(c.label)).resolve(st);
      }
      const won = !st.parties.includes(q);
      const res = st.cards.find((c) => /^After the fight/.test(c.title));
      console.log(`  ${res ? res.text.slice(0, 300) : "no card"}`);
      if (won) {
        const got = haul(st, p, partyTile(p));
        check(Object.entries(stock0).every(([k, n]) => (got.sup[k] || 0) >= n) && got.items.includes(item), "everything it carried is the team's");
        const s = st.stats.caravanRaids;
        check(s.seen ? attitude(f) === "Hostile" && f.goodwill < gw0 : f.goodwill === gw0, `consequences by the witnesses (${s.seen ? "seen: hostile" : "unseen: nothing"})`);
      } else check(attitude(f) === "Hostile", "lost: they saw you, and are your enemies");
    }
  }
  // Intercept: a caravan in sight a few tiles off.
  const st2 = world(seed + 21);
  tick(st2, 24);
  const p2 = team(st2, 5, 2);
  const m = V.spawnVisitor(st2, "merchants");
  const off = st2.grid.within(partyTile(p2), 3).find((t) => st2.grid.distance(t, partyTile(p2)) === 3 && st2.tiles[t].terrain !== "water" && planPath(st2, partyTile(p2), t, false));
  place(m, off); m.phase = "travel";
  m.goal = { kind: "site", tile: off }; // standing still for the test
  st2.live.add(off);
  const ch = C.caravanOrderChoices(st2, p2).find((c) => /^Intercept/.test(c.label));
  check(!!ch, "Intercept for a caravan in sight a few tiles off");
  if (ch) {
    ch.resolve(st2);
    check(p2.intercept && p2.dest === off && p2.phase === "out", "the team goes after it");
    let card = null;
    for (let i = 0; i < 30 && !card; i++) { tick(st2); card = st2.cards.find((c) => c.partyId === p2.id && /on the road/.test(c.title)); }
    check(!!card && !p2.intercept, `caught up: a card (${card ? card.title : "none"})`);
  }
}

// ======================================================================================
section("Witnesses and consequences");
{
  const st = world(seed + 30);
  tick(st, 24);
  const m = V.spawnVisitor(st, "merchants");
  const far = st.tiles.find((t) => t.terrain !== "water" && st.factions.every((f) => !f.alive || f.bases.every((b) => st.grid.distance(b, t.id) > 4)) && st.parties.every((q) => st.grid.distance(partyTile(q), t.id) > 2) && st.visitors.every((v) => v === m || st.grid.distance(v.tile, t.id) > 2));
  place(m, far.id);
  const c = { type: "merchants", owner: "outsider", ref: m, tile: far.id, key: "test" };
  const clean = C.witnessesOf(st, c, { outcome: "victory", enemiesLeft: 0, tactical: true }, null);
  check(clean.length === 0, `no survivors, nobody about: no witnesses (${clean.join("; ")})`);
  check(C.witnessesOf(st, c, { outcome: "victory", enemiesLeft: 1, tactical: true }, null).length > 0, "one got away: a witness");
  check(C.witnessesOf(st, c, { outcome: "retreat", enemiesLeft: 3 }, null).length > 0, "a fight broken off: they saw you");
  const f = st.factions.find((x) => x.alive && x.bases.length);
  check(C.witnessesOf(st, { ...c, tile: f.bases[0] }, { outcome: "victory", enemiesLeft: 0, tactical: true }, null).some((w) => /lookouts/.test(w)), "by a group's base: their lookouts");
  const rep0 = V.merchantRep(st);
  const lines = [];
  C.consequences(st, c, [], lines);
  check(V.merchantRep(st) === rep0 && /never arrived/.test(lines[0]), "unseen: no consequence");
  C.consequences(st, c, ["one got away"], lines);
  check(V.merchantRep(st) === rep0 - 45 && m.goodwill === -100, `seen: merchants' reputation −45 (${V.merchantRep(st)})`);
  const g = st.factions.find((x) => x.alive && x.bases.length && attitude(x) !== "Hostile");
  if (g) {
    C.consequences(st, { type: "caravan", owner: g.id, ref: null, tile: g.bases[0] }, ["their guards got away"], lines);
    check(attitude(g) === "Hostile", `seen: ${g.name} turn hostile`);
  }
}

// ======================================================================================
section("The groups rob caravans");
{
  const st = world(seed + 40);
  tick(st, 24);
  const r = st.factions.find((x) => x.alive && x.type === "raider" && x.bases.length) || (() => { const x = st.factions.find((y) => y.alive && y.bases.length); x.type = "raider"; return x; })();
  r.pop = Math.max(r.pop, 40); // a strong gang
  const m = V.spawnVisitor(st, "merchants", { cargoValue: 200 });
  const near = st.grid.within(r.bases[0], 2).find((t) => st.tiles[t].terrain !== "water" && t !== r.bases[0]);
  place(m, near); m.phase = "travel";
  const c = C.roadCaravans(st).find((x) => x.ref === m);
  check(!!c && C.wouldRaid(st, r, c), `${r.name} would rob merchants passing by`);
  const food0 = r.stock.food || 0, meds0 = r.stock.meds || 0, wares0 = (r.wares || []).length;
  const mf = Math.floor(m.stock.food || 0), mm = Math.floor(m.stock.meds || 0), items = m.wares.length;
  const won = C.groupRobs(st, r, c, 999, 1);
  check(won && !st.visitors.includes(m), "won by the numbers: the caravan is gone");
  check((r.stock.food || 0) === food0 + mf && (r.stock.meds || 0) === meds0 + mm && (r.wares || []).length === Math.min(12, wares0 + items), `everything into their stock and onto their shelf (+${mf} food, +${mm} meds, ${items} items)`);
  // The hourly odds: a gang near the road robs a passing caravan sooner or later.
  let hit = false;
  for (let i = 0; i < 400 && !hit; i++) {
    const m2 = V.spawnVisitor(st, "merchants", { cargoValue: 200 });
    if (!m2) break;
    place(m2, near); m2.phase = "travel";
    C.aiRaidsHour(st);
    hit = !st.visitors.includes(m2) || m2.raidedAt === st.hour;
    if (st.visitors.includes(m2)) st.visitors.splice(st.visitors.indexOf(m2), 1);
    st.hour++;
  }
  check(hit, "by the hourly odds, a gang falls on a caravan passing its base");
  check(!C.wouldRaid(st, r, { type: "merchants", owner: r.id }), "never its own");
  // Your convoy.
  const h = hub(st);
  const crew = atBase(st, h.id).slice(0, 1);
  const q = { id: 9e9, owner: "player", kind: "convoy", members: crew.map((s) => s.id), path: [near], idx: 0, phase: "out", supplies: { food: 2 }, cargo: { supplies: { food: 40, ammo: 50 }, gear: [{ key: "pistol", name: "9mm pistol", quality: 1 }] } };
  for (const s of crew) s.location = { kind: "party", partyId: q.id };
  st.parties.push(q);
  r.goodwill = -90;
  const cv = C.roadCaravans(st, { player: true }).find((x) => x.ref === q);
  check(!!cv && C.wouldRaid(st, r, cv), "and your convoys, when hostile");
  const f0 = r.stock.food;
  C.groupRobs(st, r, cv, 999, 1);
  check(q.cargo.supplies.food === 0 && q.cargo.supplies.ammo === 0 && !q.cargo.gear.length && r.stock.food === f0 + 40, "your convoy loses its whole load");
  st.parties.splice(st.parties.indexOf(q), 1);
  for (const s of crew) s.location = { kind: "base", baseId: h.id };
  // A group's caravan near a raider base (parties.js aiPartyHour: gangAmbush).
  const g = st.factions.find((x) => x.alive && x !== r && x.bases.length && x.type !== "raider");
  if (g) {
    const cq = { id: 9e9 + 1, owner: g.id, kind: "caravan", path: [near], idx: 0, phase: "out", strength: 1, goods: { supplies: { food: 25, scrap: 5 }, gear: [{ key: "vest", name: "Vest", quality: 1 }] } };
    st.parties.push(cq);
    const rf = r.stock.food;
    r.pop = Math.max(r.pop, 40);
    let ok = false;
    for (let i = 0; i < 6 && !ok; i++) { ok = C.gangAmbush(st, r, cq); st.hour++; } // 5% of the time a strong gang is still beaten off
    check(ok && r.stock.food === rf + 25 && cq.goods.gear.length === 0 && (r.wares || []).some((it) => it.key === "vest"), "a gang's ambush on a group's caravan takes everything");
    st.parties.splice(st.parties.indexOf(cq), 1);
  }
}

// ======================================================================================
section("Save and load with caravans on the road");
{
  const st = world(seed + 50);
  setAutopilot(st, true, "balanced");
  tick(st, 24 * 3);
  st.cards.length = 0;
  const m = V.spawnVisitor(st, "merchants", { cargoValue: 1300 });
  check(!!m && !!m.escort, "an armoured caravan on the road");
  const save = saveToString(st);
  const esc = JSON.stringify(m.escort), spec = m.speciality, nw = m.wares.length;
  tick(st, 24 * 10);
  const loaded = loadFromString(save); // after the original played on: the saved id counter comes back with it
  const lm = loaded.visitors.find((v) => v.serial === m.serial);
  check(lm && JSON.stringify(lm.escort) === esc && lm.speciality === spec && lm.wares.length === nw, "the escort, the speciality and the wares come back");
  tick(loaded, 24 * 10);
  const d = (s) => digest({ st: s, lines: [], id0: 0, id1: Number.MAX_SAFE_INTEGER });
  st.chronicle.ms = loaded.chronicle.ms = 0;
  check(d(st) === d(loaded), "both play on the same for 10 days");
}

// ======================================================================================
section("A long run with the autopilot");
{
  const st = world(seed + 60);
  setAutopilot(st, true, "balanced");
  while (day(st) < 200 && !st.gameOver) tickHour(st);
  const s = st.stats.caravanRaids || {};
  console.log(`  200 days: ${JSON.stringify(s)}; merchants ${V.visitorInfo(st).stats.merchants}, robbed ${V.visitorInfo(st).stats.robbed}`);
  const bad = st.bases.some((b) => Object.values(b.stock).some((q) => !Number.isFinite(q))) || st.factions.some((f) => Object.values(f.stock).some((q) => !Number.isFinite(q)));
  check(!bad, "no NaN in stocks");
  check((s.byGroups || 0) > 0, "the groups rob caravans");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
