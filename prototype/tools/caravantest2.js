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
import { FOODS } from "../src/sim/foods.js";
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
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
import { allCarried } from "../src/sim/inventory.js";
import { factionVehicles } from "../src/sim/vehicles.js";
import { digest } from "./digest.js";
import { defaultChoice } from "../src/sim/cardrules.js";

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
  Object.assign(h.stock, { ammo: Math.max(h.stock.ammo || 0, 300), water: Math.max(h.stock.water || 0, 100) }); setFood(h, Math.max(food(h) || 0, 100));
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
  const add = (s, g) => { for (const [k, q] of Object.entries(s || {})) sup[k] = (sup[k] || 0) + (FOODS[k] ? q || 0 : Math.floor(q || 0)); items.push(...(g || [])); }; // food by type: items, fractions kept
  add(p.cargo.supplies, p.cargo.gear);
  for (const v of st.vehicles) if (v.loc.kind === "abandoned" && v.loc.tile === tile && v.cargo) add(v.cargo.supplies, v.cargo.gear);
  const site = st.deathSites.find((d) => d.tile === tile);
  if (site) for (const it of site.items) { if (it.kind === "supply") sup[it.key] = (sup[it.key] || 0) + it.qty; else items.push(it.item); }
  return { sup, items };
}

// ======================================================================================
section("Escorts: the cargo's wish, capped by the sender's means");
{
  // The wish: a share of what they could send.
  check(E.escortWant(0) === 0.15 && Math.abs(E.escortWant(750) - 0.65) < 1e-9 && E.escortWant(2000) === 1, `the wish rises with the cargo (0 → ${E.escortWant(0)}, 750 → ${E.escortWant(750)}, 2000 → ${E.escortWant(2000)})`);
  const rich = { guards: 8, power: 4.6, kit: "contractors", vehicles: ["truck", "hummer"] }, poor = { guards: 2, power: 3.0, kit: "guards", vehicles: [] };
  const cheapRich = E.escortFrom(150, rich), dearRich = E.escortFrom(1500, rich), dearPoor = E.escortFrom(1500, poor), midRich = E.escortFrom(500, rich);
  const show = (e) => `${e.guards} of ${e.could.guards}${e.vehicle ? ` + ${e.vehicle}` : ""} (${e.tier})`;
  console.log(`  a rich company: cheap cargo ${show(cheapRich)}, mid ${show(midRich)}, rich ${show(dearRich)}; a poor one, rich cargo: ${show(dearPoor)}`);
  check(cheapRich.guards <= 2 && !cheapRich.vehicle, "cheap cargo: a token guard, even from a rich sender");
  check(dearRich.guards === 8 && dearRich.vehicle === "hummer" && dearRich.tier === "armoured" && dearRich.scout === 1 && dearRich.gunner === 1, "rich cargo: all it can spare, its Humvee, a scout");
  check(midRich.vehicle === "truck" && midRich.guards > cheapRich.guards && midRich.guards < 8, "in between: some of them and the pickup");
  check(dearPoor.guards === 2 && !dearPoor.vehicle && dearPoor.tier === "light", "a poor sender with rich cargo: everything it has, still weak");
  check(E.escortFrom(1500, { ...rich, vehicles: ["truck", "hummer", "mrap"] }).vehicle === "mrap", "its best armoured vehicle (an MRAP)");
  check(E.escortFrom(1500, { ...rich, vehicles: ["truck"] }).vehicle === "truck", "no armoured vehicle: the pickup");
  // A merchant company's means: its own dice, richer over the years.
  const stc = world();
  const c0 = Array.from({ length: 300 }, (_, i) => E.companyFor(stc, i + 1, 10)), c3 = Array.from({ length: 300 }, (_, i) => E.companyFor(stc, i + 1, 1100));
  const avg = (l, f) => l.reduce((a, x) => a + f(x), 0) / l.length;
  const own = (l, k) => l.filter((c) => c.vehicles.includes(k)).length / l.length;
  console.log(`  companies, day 10: ${avg(c0, (c) => c.guards).toFixed(1)} guards, power ${avg(c0, (c) => c.power).toFixed(2)}, pickup ${Math.round(own(c0, "truck") * 100)}%, Humvee ${Math.round(own(c0, "hummer") * 100)}%, MRAP ${Math.round(own(c0, "mrap") * 100)}%; year 3: ${avg(c3, (c) => c.guards).toFixed(1)}, ${avg(c3, (c) => c.power).toFixed(2)}, ${Math.round(own(c3, "truck") * 100)}%, ${Math.round(own(c3, "hummer") * 100)}%, ${Math.round(own(c3, "mrap") * 100)}%`);
  check(c0.every((c) => c.guards >= 2 && c.guards <= 8) && new Set(c0.map((c) => c.guards)).size >= 6, "hired guns 2–8 at first");
  check(avg(c3, (c) => c.guards) > avg(c0, (c) => c.guards) && avg(c3, (c) => c.power) > avg(c0, (c) => c.power) && own(c3, "hummer") > own(c0, "hummer"), "the companies grow richer over the years");
  check(JSON.stringify(E.companyFor(stc, 7, 50)) === JSON.stringify(E.companyFor(stc, 7, 50)), "a company's means are its own dice (the same serial, the same company)");
  check(["guards", "escorts", "contractors"].every((k) => KITS[k] && KITS[k].weapons.every((w) => GEAR[w])) && KITS.contractors.armor.includes("plate") && KITS.contractors.weapons.includes("ar"), "their battle kits exist (combat.js KITS), plate and automatic rifles for the best");
  // Guns and armour count 1.5×.
  const plain = { stock: { f_beans: 500 }, wares: [] }, guns = { stock: { f_beans: 500 }, wares: [{ key: "ar", name: "AR", quality: 1 }] }, tools = { stock: { f_beans: 500 }, wares: [{ key: "lantern", name: "Lantern", quality: 1 }] }; // 100 days of canned beans
  check(E.escortValue(guns.stock, guns.wares) - E.escortValue(plain.stock, plain.wares) === Math.round(GEAR.ar.value * 1.5) && Math.abs(E.escortValue(tools.stock, tools.wares) - E.escortValue(plain.stock, plain.wares) - GEAR.lantern.value) < 1e-6, "guns count 1.5×, tools at their worth");
  // Merchants spawned: every speciality fills the wagons; the escort is the wish × the company.
  const st = world();
  tick(st, 24);
  for (const sp of Object.keys(V.MERCHANT_SPECS)) {
    const m = V.spawnVisitor(st, "merchants", { spec: sp });
    if (!check(!!m, `a ${sp} caravan`)) continue;
    const S = V.MERCHANT_SPECS[sp];
    check(m.spec === sp && m.wares.filter((it) => S.gear.includes(it.key)).length >= 2 + (S.extra ? S.extra[0] : 0), `${sp}: ${S.name} (${V.goodsText(m)})`);
    const e = m.escort;
    check(e && e.company && e.guards <= e.company.guards && e.guards === Math.max(1, Math.min(e.company.guards, Math.round(e.company.guards * E.escortWant(e.value)))) /* the raw wish: e.want is rounded to 0.01 (0.7453 shows 0.75, 2 × it rounds to 1, not 2) */ && m.guards === Math.max(1, e.guards) && m.size === m.guards + 2, `${sp}: worth ${e.value}, wish ${Math.round(e.want * 100)}% of ${e.company.guards} → ${E.escortWords(e)}`);
    st.visitors.splice(st.visitors.indexOf(m), 1);
  }
  const big = { guards: 8, power: 4.6, kit: "contractors", vehicles: ["truck", "hummer"] };
  const forced = { light: V.spawnVisitor(st, "merchants", { cargoValue: 100, company: big }), armed: V.spawnVisitor(st, "merchants", { cargoValue: 500, company: { ...big, power: 3.8, kit: "escorts" } }), armoured: V.spawnVisitor(st, "merchants", { cargoValue: 1400, company: big }) };
  check(forced.light.escort.tier === "light" && forced.armed.escort.tier === "armed" && forced.armoured.escort.tier === "armoured", `the escort follows the cargo (${["light", "armed", "armoured"].map((k) => E.escortShort(forced[k].escort)).join(", ")})`);
  check(V.vStrength(forced.armoured) === forced.armoured.size * forced.armoured.power + forced.armoured.escort.vehPower && V.vStrength(forced.light) === forced.light.size * forced.light.power, "the vehicle adds to their strength");
  check(V.vStrength(forced.light) < V.vStrength(forced.armed) && V.vStrength(forced.armed) < V.vStrength(forced.armoured), `strength: ${Math.round(V.vStrength(forced.light))} < ${Math.round(V.vStrength(forced.armed))} < ${Math.round(V.vStrength(forced.armoured))}`);
  const tip = V.visitorTipLines(st, forced.armoured.tile, new Set([forced.armoured.tile]));
  check(tip.some((l) => /Escort: 8 hired guns/.test(l.text) && /Humvee with an M2/.test(l.text)), `the tooltip says the escort in words (${tip.map((l) => l.text).join(" | ").slice(0, 200)})`);
  const enemy = C.escortEnemy(forced.armoured);
  check(enemy.kind === "contractors" && enemy.count === forced.armoured.guards && enemy.vehicleBody === "humvee" && enemy.turret === "m2hb" && enemy.escort, "their battle: the escort's kit, every guard, the Humvee and its M2");
  // A group's caravan: its spare fighters, the cargo's wish; a military group's Humvee.
  const g = st.factions.find((x) => x.alive && x.bases.length && x.pop >= 20) || st.factions.find((x) => x.alive && x.bases.length);
  const cap = E.groupCapacity(st, g);
  const ge = (v) => E.groupEscort(st, g, v);
  check(cap.guards + cap.home === Math.floor(g.pop * E.ESCORT.FIGHTERS) && cap.home >= cap.guards * 0.9, `${g.name} (${g.pop} people): ${cap.guards} fighters to spare, ${cap.home} kept at home`);
  check(ge(100).guards <= Math.max(1, Math.round(cap.guards * 0.25)) && ge(2000).guards === cap.guards, `a group: ${ge(100).guards} for cheap cargo, all ${ge(2000).guards} it can spare for rich`);
  const was = g.atWar;
  g.atWar = 1;
  check(E.groupCapacity(st, g).guards <= cap.guards, "at war: more stay home");
  g.atWar = was;
  const mil = { ...g, type: "military", vehicles: undefined, id: g.id };
  const mcap = E.groupCapacity(st, mil);
  check(mcap.vehicles.includes("hummer") && E.groupEscort(st, mil, 2000).vehicle === "hummer" && E.groupEscort(st, mil, 2000).vehicleId != null, "a military group sends its Humvee with rich cargo");
  // A spread of real caravans: the wish against the means.
  const n = {}, rows = [];
  for (let i = 0; i < 300; i++) { const m = V.spawnVisitor(st, "merchants"); if (m) { n[m.escort.tier] = (n[m.escort.tier] || 0) + 1; rows.push(m.escort); st.visitors.splice(st.visitors.indexOf(m), 1); } }
  const richRows = rows.filter((e) => e.value >= 1000);
  const lightRich = richRows.filter((e) => e.tier === "light").length, heavyRich = richRows.filter((e) => e.tier === "armoured").length;
  console.log(`  300 caravans: ${JSON.stringify(n)}; rich cargo (1000+ worth, ${richRows.length}): ${lightRich} lightly guarded (a poor company), ${heavyRich} armoured`);
  check(n.light && n.armed && n.armoured, "all three labels come");
  check(lightRich > 0 && heavyRich > lightRich, "a rich cargo is mostly well guarded, now and then lightly (a poor company)");
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
    const m = V.spawnVisitor(st, "merchants", { cargoValue: 1300, company: { guards: 6, power: 4.6, kit: "contractors", vehicles: ["hummer"] } }); // an armoured escort with a Humvee
    if (!m) continue;
    // A weak escort for this test (the battle is not the point): two guards left, poor shots.
    m.guards = 2; m.size = 4; m.power = 1.2;
    place(m, partyTile(p));
    m.phase = "travel";
    const stock0 = Object.fromEntries(Object.entries(m.stock).filter(([, q]) => q >= 1).map(([k, q]) => [k, FOODS[k] ? q - 1e-6 : Math.floor(q)]));
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
        check(Object.entries(stock0).every(([k, n]) => (got.sup[k] || 0) >= n - 1e-6) && got.items.includes(item), `everything it carried is the team's (missing ${JSON.stringify(Object.entries(stock0).filter(([k, n]) => (got.sup[k] || 0) < n - 1e-6).map(([k, n]) => [k, n, got.sup[k] || 0]))}, item ${got.items.includes(item)})`);
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
  // A tile the team walks to in 3 steps (not one 3 tiles off across a river, 7 steps round by the bridge: seed 63's
  // world since the start moved away from towns), and no road encounter on the way (a group's Roadblock there held
  // the team up while the caravan left): the chase is what is checked.
  const direct = (t) => { const r = planPath(st2, partyTile(p2), t, false); return !!r && r.path.length === 4; };
  const off = st2.grid.within(partyTile(p2), 3).find((t) => st2.grid.distance(t, partyTile(p2)) === 3 && st2.tiles[t].terrain !== "water" && direct(t));
  p2.lastConflict = st2.hour;
  place(m, off); m.phase = "travel";
  m.goal = { kind: "site", tile: off }; // standing still for the test
  st2.live.add(off);
  const ch = C.caravanOrderChoices(st2, p2).find((c) => /^Intercept/.test(c.label));
  check(!!ch, "Intercept for a caravan in sight a few tiles off");
  if (ch) {
    ch.resolve(st2);
    check(p2.intercept && p2.dest === off && p2.phase === "out", "the team goes after it");
    let card = null;
    // The team's other cards on the way (the dead ahead on an infected tile) answered by their default, as the tray does.
    const answer = () => { for (const c of st2.cards.filter((x) => x.partyId === p2.id && !x.isOrders && !/on the road/.test(x.title))) { st2.cards.splice(st2.cards.indexOf(c), 1); const d = defaultChoice(st2, c); if (d && d.resolve) d.resolve(st2); } };
    for (let i = 0; i < 30 && !card; i++) { tick(st2); card = st2.cards.find((c) => c.partyId === p2.id && /on the road/.test(c.title)); if (!card) answer(); }
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
  // Unseen, word gets out anyway now and then (C.RUMOUR.CHANCE), a few days later.
  st.caravanRumours = [];
  for (let i = 0; i < 300; i++) { st.hour++; C.consequences(st, { ...c, key: `t${i}`, name: "the Test caravan", by: "Scavenge team (Ana)" }, [], []); }
  const nr = st.caravanRumours.length;
  check(nr >= 25 && nr <= 70, `traced after all about 15% of the time (${nr} of 300)`);
  check(st.caravanRumours.every((r) => r.at >= st.hour - 300 + 24 && r.at <= st.hour + 24 * 4), "a day to four later");
  const rep1 = V.merchantRep(st);
  st.caravanRumours = [{ ...st.caravanRumours[0], at: st.hour }];
  C.caravanRaidsHour(st);
  check(V.merchantRep(st) === Math.max(-100, rep1 - 45) && st.log.slice(0, 6).some((l) => /^Word got around that Scavenge team \(Ana\) robbed the Test caravan/.test(l.text)) && !st.caravanRumours.length, `traced: the consequences, and you hear of it (${V.merchantRep(st)})`);
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
  const food0 = food(r) || 0, meds0 = r.stock.meds || 0, wares0 = (r.wares || []).length;
  const mf = food(m) || 0, mm = Math.floor(m.stock.meds || 0), gear = m.wares.slice();
  const won = C.groupRobs(st, r, c, 999, 1);
  check(won && !st.visitors.includes(m), "won by the numbers: the caravan is gone");
  // Each item goes where the group keeps what it takes (arsenal.js keepItem, docs/adr/0001-ai-parity.md): fighting kit
  // (a gun, armour, a crowbar) onto its books, the rest onto its shelf; nothing is lost.
  const kept = (it) => (r.wares || []).includes(it) ? "shelf" : r.arsenal && r.arsenal.items.includes(it) ? "books" : null;
  const onShelf = gear.filter((it) => kept(it) === "shelf").length, onBooks = gear.filter((it) => kept(it) === "books").length;
  check(Math.abs((food(r) || 0) - food0 - mf) < 1e-6 && (r.stock.meds || 0) === meds0 + mm && gear.every(kept) && (r.wares || []).length === wares0 + onShelf, `everything into their stock, onto their shelf or their books (+${mf} food, +${mm} meds, ${gear.length} items: ${onShelf} on the shelf, ${onBooks} fighting kit)`);
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
  const crew = atBase(st, h.id).slice(0, 3);
  const q = { id: 9e9, owner: "player", kind: "convoy", members: crew.map((s) => s.id), path: [near], idx: 0, phase: "out", supplies: {}, cargo: { supplies: { ammo: 50 }, gear: [{ key: "pistol", name: "9mm pistol", quality: 1 }] } };
  setFood(q, 2); setFood(q.cargo, 40); // days of ration bars (tools/foodkit.js)
  for (const s of crew) s.location = { kind: "party", partyId: q.id };
  st.parties.push(q);
  r.goodwill = -90;
  const cv = C.roadCaravans(st, { player: true }).find((x) => x.ref === q);
  check(!!cv && C.wouldRaid(st, r, cv), "and your convoys, when hostile");
  const f0 = food(r);
  const hp0 = crew.map((s) => s.health), band0 = r.people.filter((s) => s.alive).map((s) => s.health);
  // (By your by-the-numbers rules the odds stop at 97%: the band may be beaten off; it tries again until it wins.)
  let robbed = false;
  const load = q.cargo; // (a convoy with nobody left afterwards is wiped: parties.js wipeParty gives it a fresh cargo)
  for (let i = 0; i < 10 && !robbed && st.parties.includes(q); i++) robbed = C.groupRobs(st, r, cv, 999, 1);
  check(robbed && food(load) < 1e-6 && load.supplies.ammo === 0 && !load.gear.length && Math.abs(food(r) - f0 - 40) < 1e-6, `your convoy loses its whole load (food left ${food(load)}, the group +${food(r) - f0})`);
  // docs/adr/0001-ai-parity.md: your convoy's people fought it, and the fight's rounds landed on them as on the band's
  // (groupfight.js applyYours; it was one of them hurt by a hash, the rest untouched).
  const touched = crew.filter((s, i) => !s.alive || s.health < hp0[i] || (s.location && s.location.kind === "captive"));
  const bandHit = r.people.filter((s) => s.alive).map((s) => s.health).filter((v, i) => v < band0[i]).length + Math.max(0, band0.length - r.people.filter((s) => s.alive).length);
  check(touched.length > 0, `your convoy's people take the fight's wounds (${crew.map((s, i) => `${s.name.split(" ")[0]} ${hp0[i]} → ${s.alive ? Math.round(s.health) : "dead"}`).join(", ")}; the band's people hit: ${bandHit})`);
  check(st.log.slice(0, 8).some((l) => /ambushed your convoy/.test(l.text) && /(hurt|died|taken)\./.test(l.text)), `the log says who was hurt (${(st.log.find((l) => /ambushed your convoy/.test(l.text)) || {}).text})`);
  if (st.parties.includes(q)) st.parties.splice(st.parties.indexOf(q), 1);
  for (const s of crew) if (s.alive && s.location && s.location.kind === "party") s.location = { kind: "base", baseId: h.id };
  // A band beaten off by your convoy: what their dead carried is the convoy's (the field is yours), nothing lost.
  {
    const crew2 = atBase(st, h.id).filter((s) => s.alive).slice(0, 4);
    for (const s of crew2) { s.health = 100; s.skills.shooting = 12; }
    const q2 = { id: 9e9 + 2, owner: "player", kind: "convoy", members: crew2.map((s) => s.id), path: [near], idx: 0, phase: "out", supplies: {}, cargo: { supplies: {}, gear: [] } };
    for (const s of crew2) s.location = { kind: "party", partyId: q2.id };
    st.parties.push(q2);
    const cv2 = C.roadCaravans(st, { player: true }).find((x) => x.ref === q2);
    let off = null;
    for (let i = 0; i < 40 && !off && st.parties.includes(q2); i++) {
      const alive0 = new Set(r.people.filter((s) => s.alive)), kit0 = new Map([...alive0].map((s) => [s, allCarried(s).length]));
      const onTile = () => st.deathSites.filter((d) => d.tile === near).reduce((a, d) => a + d.items.filter((x) => x.kind === "gear").length, 0);
      const g0 = q2.cargo.gear.length + onTile();
      if (!C.groupRobs(st, r, cv2, 2, 1)) { const dead = [...alive0].filter((s) => !r.people.includes(s)); if (dead.length) off = { dead, kit: dead.reduce((a, s) => a + kit0.get(s), 0), got: q2.cargo.gear.length + onTile() - g0 }; }
      st.hour++;
    }
    check(!!off && off.got > 0 && off.dead.every((s) => !allCarried(s).length), `beaten off with their dead on the road: your convoy takes what they carried (${off ? `${off.dead.length} dead, ${off.kit} pieces, +${off.got} in the cargo or left on the tile` : "never beaten off"})`);
    if (st.parties.includes(q2)) st.parties.splice(st.parties.indexOf(q2), 1);
    for (const s of crew2) if (s.alive && s.location && s.location.kind === "party") s.location = { kind: "base", baseId: h.id };
  }
  // A group's caravan near a raider base (parties.js aiPartyHour: gangAmbush).
  const g = st.factions.find((x) => x.alive && x !== r && x.bases.length && x.type !== "raider");
  if (g) {
    // Its truck (escorts.js q.escort.vehicleId: one of the group's records) with something left in it (vehicles.js
    // carryCargo: your vehicles' model, docs/adr/0001-ai-parity.md 5.15).
    const truck = { id: `f${g.id}-test-truck`, type: "truck", name: "Pickup truck", fuel: 12, condition: 70, owner: g.id, cargo: { supplies: { parts: 3 }, gear: [] } };
    factionVehicles(g).push(truck);
    const cq = { id: 9e9 + 1, owner: g.id, kind: "caravan", path: [near], idx: 0, phase: "out", strength: 1, escort: { guards: 1, power: 3, vehicle: "truck", vehicleId: truck.id }, goods: { supplies: { scrap: 5 }, gear: [{ key: "vest", name: "Vest", quality: 1 }] } };
    setFood(cq.goods, 25); // days of ration bars (tools/foodkit.js)
    st.parties.push(cq);
    const rf = food(r), rp = r.stock.parts || 0, rv = factionVehicles(r).length;
    r.pop = Math.max(r.pop, 40);
    let ok = false;
    for (let i = 0; i < 6 && !ok; i++) { ok = C.gangAmbush(st, r, cq); st.hour++; } // 5% of the time a strong gang is still beaten off
    check(ok && Math.abs(food(r) - rf - 25) < 1e-6 && cq.goods.gear.length === 0 && ((r.wares || []).some((it) => it.key === "vest") || (r.arsenal && r.arsenal.items.some((it) => it.name === "Vest"))), `a gang's ambush on a group's caravan takes everything (the vest to their fighters: arsenal.js; ok ${ok}, food +${food(r) - rf})`);
    check(ok && !factionVehicles(g).includes(truck) && factionVehicles(r).length === rv + 1 && factionVehicles(r).some((v) => v.type === "truck" && !v.cargo) && (r.stock.parts || 0) === rp + 3, `its truck is the gang's now, and what was in it is in their stores (parts ${rp} → ${r.stock.parts || 0}; it used to vanish with the caravan)`);
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
  const m = V.spawnVisitor(st, "merchants", { cargoValue: 1300, company: { guards: 6, power: 4.6, kit: "contractors", vehicles: ["hummer"] } });
  check(!!m && !!m.escort, "an armoured caravan on the road");
  const save = saveToString(st);
  const esc = JSON.stringify(m.escort), spec = m.spec, nw = m.wares.length;
  tick(st, 24 * 10);
  const loaded = loadFromString(save); // after the original played on: the saved id counter comes back with it
  const lm = loaded.visitors.find((v) => v.serial === m.serial);
  check(lm && JSON.stringify(lm.escort) === esc && lm.spec === spec && lm.wares.length === nw, "the escort, the speciality and the wares come back");
  tick(loaded, 24 * 10);
  const d = (s) => digest({ st: s, lines: [], id0: 0, id1: Number.MAX_SAFE_INTEGER });
  st.chronicle.ms = loaded.chronicle.ms = 0;
  check(d(st) === d(loaded), "both play on the same for 10 days");
}

// ======================================================================================
section("Long runs with the autopilot");
{
  // Whether the groups rob a caravan in one world is luck (one seed went 3 robberies → 0 when an unrelated fight's dice
  // changed), so: 8 worlds (seed + 58 … seed + 65) of RUN_DAYS each, and the groups must rob caravans in at least
  // ROB_BAR of them. Measured on seeds 100–107 at 120 days: 5 of 8 on dev f6ce385, 3 of 8 with the balance batch in
  // (a bar of 4 sat on the edge of the dice); at 200 days 7 of 8, so the runs are 200 days long.
  const RUN_DAYS = 200, SEEDS = 8, ROB_BAR = 4;
  let robbing = 0, bad = false;
  for (let i = 0; i < SEEDS; i++) {
    const st = world(seed + 58 + i);
    setAutopilot(st, true, "balanced");
    while (day(st) < RUN_DAYS && !st.gameOver) tickHour(st);
    const s = st.stats.caravanRaids || {};
    console.log(`  seed ${seed + 58 + i}, ${RUN_DAYS} days: ${JSON.stringify(s)}; merchants ${V.visitorInfo(st).stats.merchants}, robbed ${V.visitorInfo(st).stats.robbed}`);
    bad ||= st.bases.some((b) => Object.values(b.stock).some((q) => !Number.isFinite(q))) || st.factions.some((f) => Object.values(f.stock).some((q) => !Number.isFinite(q)));
    if ((s.byGroups || 0) > 0) robbing++;
  }
  check(!bad, "no NaN in stocks");
  check(robbing >= ROB_BAR, `the groups rob caravans (in ${robbing} of ${SEEDS} worlds; at least ${ROB_BAR})`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
