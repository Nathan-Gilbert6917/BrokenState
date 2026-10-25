// Hardcore mode, your start (sim/hardcore-start.js): the spawn, what the three grabbed as they fled, the low supplies,
// founding the first hub through a staging camp (sim/staging.js: the order, the materials over trips, the days of
// work, the hub; neglect, striking it, a team lost there), the hubless views, the starting people (1–4: food by
// background, a small team's skills and loaded seats, armed strangers sized to the team), saves before, during and
// after the camp, and the autopilot founding one.
// Usage: node tools/hcstarttest.js [autopilot games] [days] (default 8 games, 40 days)
import { stockTools } from "./toolset.js"; // every tool a build or recipe can need (toolreqs.js)
import { FOODS, foodIn } from "../src/sim/foods.js";
import { food, setFood, addDays, clearFood, jarred, setJarred, kindsOf } from "./foodkit.js"; // days of food by type (sim/foods.js)
import { totalRounds, foldRounds } from "../src/sim/ammo.js"; // rounds by calibre
// A record with its rounds counted together as "ammo" (the archetypes give ammo as one figure); no "ammo" key with none.
const asGeneric = (rec) => { const r = { ...rec }; foldRounds(r); if (!r.ammo) delete r.ammo; return r; };
import { createWorld, tickHour, hub, day, alive, atBase, hurt, makeSurvivor, newId, baseVision } from "../src/sim/world.js";
import { BUILDINGS, isShelter, tierName, SHELTER, CAMP, baseWalls, baseBeds, farmSlots, canBuild, queueBuild, addBuilding, plotCap, tierUpJob, tierUpType, gatherRows, gatherStalled } from "../src/sim/buildings.js";
import { waterProduction, waterNeed } from "../src/sim/economy.js";
import { foodUse, mouthsAt, useText } from "../src/sim/upkeep.js";
import { structuresOf } from "../src/sim/interior.js";
import { wallHold } from "../src/sim/defences.js";
import { setFire, noteGunfire, CAMP_HEAT, teamFire, campSite, heatGain, fireLit, shelterHeat } from "../src/sim/fieldheat.js";
import { startOrder } from "../src/sim/orders.js";
import { rainWater } from "../src/sim/weather.js";
import { fromTeamRow } from "../src/ui/hardcore.js";
import { GEAR, SUPPLIES, TRAITS, SKILLS as SKILLS_ALL } from "../src/sim/data.js";
import { partyTile, partyMembers, orderOptions, giveOrder, orderMove, carried, MISSIONS, planPath, launchExpedition } from "../src/sim/parties.js";
import { packSize } from "../src/sim/inventory.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { HC_START, BACKGROUNDS, playerTile, roadTeam, firstHubPending, hubSites, applyArchetype, rollGrab, teamFoodCap, smallTeamSkills, emptySeats } from "../src/sim/hardcore-start.js";
import { VEHICLE_TYPES, partyVehicle, isCar } from "../src/sim/vehicles.js";
import {
  STAGING, ESTABLISH_LABEL, needText, establishProblem, establishOption, strikeCamp,
  tierInfo, waterSource, waterText,
} from "../src/sim/staging.js";
import { renderTopbar, renderLeft, renderRight, renderModal } from "../src/ui/ui.js";
import { computeAlerts, renderAlerts } from "../src/ui/alerts.js";
import { diaryModal, openDiary } from "../src/ui/diary.js";
import { rosterModal, openRoster } from "../src/ui/roster.js";
import { settingsModal, openSettings } from "../src/ui/settings.js";
import { newRunScreen } from "../src/ui/newgame.js";
import { loadOptions } from "../src/ui/saves.js";
import { isTentBag, TENTS } from "../src/sim/tents.js"; // the hardcore start's tent bags
import { assignedRole } from "../src/sim/noidle.js"; // noidle: a job with no work, its people helping elsewhere

// Setting up a camp takes an hour (staging.js STAGING.PITCH): skipped here, the camp (a base) stands at once.
// Establish base at once, and the player places its shelter shack from the Build list (the user's request 2026-10-23:
// the step up is not queued for you).
const establishNow = (st, p) => { p.pitched = true; const r = giveOrder(st, p, "establish"); for (const c of st.bases) if (c.camp && !tierUpJob(c)) queueBuild(st, c, tierUpType(c)); return r; };

const apGames = Number(process.argv[2] || 8), apDays = Number(process.argv[3] || 40);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const hc = (seed, extra = {}) => createWorld({ seed, factionCount: 7, mode: "hardcore", ...extra });

// ---------- spawn ----------
section("Spawn: three survivors on the road, no hub, a reasonable place");
const SEEDS = [11, 23, 42, 77, 101, 202, 303, 404, 505, 606, 707, 808];
const worlds = SEEDS.map((s) => hc(s));
let spawnsClose = 0;
for (const st of worlds) {
  const g = st.grid;
  const p = roadTeam(st);
  const tag = `seed ${st.seed}`;
  if (!check(!!p, `${tag}: a team on the road`)) continue;
  const tile = st.tiles[partyTile(p)];
  check(st.mode === "hardcore" && st.bases.length === 0 && !hub(st), `${tag}: no base`);
  check(partyMembers(st, p).length === HC_START.CREW && st.survivors.length === HC_START.CREW, `${tag}: ${HC_START.CREW} survivors, all on the team`);
  check(st.survivors.filter((s) => s.leader).length === 1, `${tag}: one leader`);
  check(playerTile(st) === tile.id, `${tag}: playerTile is the team's tile`);
  check(tile.terrain !== "water" && tile.terrain !== "mountain" && tile.terrain !== "city" && !tile.loc && !tile.hive, `${tag}: open land (${tile.terrain}${tile.loc ? `, ${tile.loc.type}` : ""})`);
  check(g.distance(tile.id, st.originId) >= HC_START.SPAWN.origin[1], `${tag}: away from the outbreak origin (${g.distance(tile.id, st.originId)})`);
  check(st.cityIds.every((c) => g.distance(tile.id, c) >= HC_START.SPAWN.city[1]), `${tag}: not in a city centre`);
  check(st.factions.every((f) => !f.bases.includes(tile.id)), `${tag}: not on a group's base`);
  const e = HC_START.SPAWN.edge[1];
  check(tile.x >= g.width * e && tile.x < g.width * (1 - e) && tile.y >= g.height * e && tile.y < g.height * (1 - e), `${tag}: not in a corner (${tile.x},${tile.y})`);
  const near = st.tiles.filter((t) => (t.loc || t.terrain === "city") && g.distance(t.id, tile.id) <= HC_START.SPAWN.poi[1]);
  const close = near.filter((t) => g.distance(t.id, tile.id) <= HC_START.SPAWN.poi[0]);
  check(near.length > 0, `${tag}: a town, city or POI within ${HC_START.SPAWN.poi[0]} tiles (${close.length}; within ${HC_START.SPAWN.poi[1]}: ${near.length}: ${near.slice(0, 3).map((t) => t.loc ? t.loc.type : "city").join(", ")})`);
  spawnsClose += close.length > 0 ? 1 : 0;
  check(hubSites(st, tile.id, 6).length > 0, `${tag}: somewhere to found a hub nearby`);
  check(!!waterSource(st, tile.id, HC_START.SPAWN.water[1]), `${tag}: a river or lake within ${HC_START.SPAWN.water[1]} tiles (${waterText(st, tile.id)})`);
  check(st.vehicles.filter((v) => v.loc.kind === "party" && v.loc.partyId === p.id).length === 1 && p.vehicle === true && isCar(partyVehicle(st, p)), `${tag}: one car, the team's`);
  check(st.cards.length >= 1 && st.cards[0].intro && !st.cards[0].isOrders && st.cards[0].choices.length === 1 && /Calder is falling/.test(st.cards[0].text), `${tag}: the run opens on the blurb (one button, no orders on it)`);
  check(p.phase === "waiting" && !st.cards.some((c) => c.isOrders || c.partyId === p.id), `${tag}: the team waits for orders with no orders card`);
}

check(spawnsClose >= worlds.length - 1, `the strict rule (a site within ${HC_START.SPAWN.poi[0]} tiles) held on ${spawnsClose} of ${worlds.length} seeds`);

// ---------- what they grabbed ----------
section("What they grabbed: bags or pockets, household things, very low supplies");
let bags = 0, pocketsOnly = 0, armed = 0, unarmed = 0;
const bagKinds = new Set(), weaponKinds = new Set(), itemKinds = new Set();
for (const st of worlds) {
  const p = roadTeam(st);
  if (!p) continue;
  for (const s of partyMembers(st, p)) {
    if (s.gear.backpack) { bags++; bagKinds.add(s.gear.backpack.key); } else pocketsOnly++;
    if (s.gear.weapon) { armed++; weaponKinds.add(s.gear.weapon.key); } else unarmed++;
    for (const it of s.pockets.filter(Boolean)) { itemKinds.add(it.key); check(GEAR[it.key] && GEAR[it.key].small, `seed ${st.seed}: ${it.key} in a pocket is small`); }
    if (s.gear.backpack) {
      const c = s.gear.backpack.contents || [];
      check(c.length === packSize(s.gear.backpack), `seed ${st.seed}: ${s.gear.backpack.key} has its slots`);
      for (const it of c.filter(Boolean)) { itemKinds.add(it.key); check(!!GEAR[it.key] && !packSize(it) && !GEAR[it.key].bulky, `seed ${st.seed}: ${it.key} fits in a pack`); }
    }
    for (const k of ["weapon", "tool", "backpack"]) if (s.gear[k]) check(GEAR[s.gear[k].key] && GEAR[s.gear[k].key].slot === k, `seed ${st.seed}: ${s.gear[k].key} in its slot`);
    check(!s.gear.armor || (HC_START.ARCHETYPES[s.background] || {}).armor, `seed ${st.seed}: body armor only on a background that wears it (${s.background})`);
  }
  // The others carried 1–3 days for three (TEAM_MIN..TEAM_MAX; food up to a farmer's, a hunter's or a trucker's own
  // max: teamFoodCap); a prepper's five days (PREPPER.FOOD / WATER) come on top.
  const sup = p.supplies, n = partyMembers(st, p).length, P = HC_START.PREPPER;
  const prep = partyMembers(st, p).some((x) => x.background === "prepper");
  const pf = prep ? P.FOOD : 0, pw = prep ? P.WATER : 0;
  const lo = HC_START.TEAM_MIN * n, hi = HC_START.TEAM_MAX * n, fhi = teamFoodCap(partyMembers(st, p)); // per head (3–9 for three)
  const fd = food(p); // days of food, typed as a house's kitchen food (sim/foods.js: whole items by the dice, about a day either way)
  check(fd >= lo + pf - 1 && fd <= fhi + pf + 1 && sup.water >= lo + pw && sup.water <= hi + pw, `seed ${st.seed}: the others' 1–3 days${prep ? " plus the prepper's five" : ""} (${fd.toFixed(1)} days of food, ${sup.water} water)`);
  check(fd / n <= 5 + (pf + 1) / n && sup.water / n <= 3 + pw / n, `seed ${st.seed}: no more than 3 days each (5 food for a farmer's team) beyond a prepper's bag`);
  check(!sup.fuel && !sup.scrap && !sup.parts && (sup.ammo || 0) <= 72 + (prep ? P.AMMO : 0) && (sup.meds || 0) <= 6 + (prep ? P.MEDS : 0), `seed ${st.seed}: no fuel, scrap or parts in the packs, little ammo (${sup.ammo || 0}) or meds beyond the bags`);
  check(Object.values(sup).every((v) => Number.isFinite(v) && v >= 0), `seed ${st.seed}: clean supply numbers`);
}
check(bags > 0 && pocketsOnly > 0, `some fled with a bag, some with only pockets (${bags} bags, ${pocketsOnly} pockets only)`);
check(armed > 0 && unarmed > 0, `some grabbed a weapon, some did not (${armed} armed: ${[...weaponKinds].join(", ")})`);
check(bagKinds.size >= 2 && itemKinds.size >= 8, `the rolls vary (${bagKinds.size} kinds of bag, ${itemKinds.size} kinds of thing)`);

// ---------- the prepper ----------
section("The prepper: when one of the three is a prepper, they fled with a duffle bag packed for five days (2026-10-06)");
{
  const P = HC_START.PREPPER;
  // The backgrounds are drawn by seed: the worlds with a prepper among the three, topped up to six from further seeds.
  const prepWorlds = worlds.filter((st) => st.hardcore.start.prepper != null);
  for (let seed = 1000; prepWorlds.length < 6 && seed < 1200; seed++) { const st = hc(seed); if (st.hardcore.start.prepper != null) prepWorlds.push(st); }
  check(prepWorlds.length >= 6, `${prepWorlds.length} starts with a prepper found`);
  check(!!GEAR.duffle && GEAR.duffle.slot === "backpack" && GEAR.duffle.slots > GEAR.hikingpack.slots && GEAR.duffle.carry > GEAR.hikingpack.carry, `the duffle bag is a pack bigger than a hiking pack (${GEAR.duffle && GEAR.duffle.slots} slots, +${GEAR.duffle && GEAR.duffle.carry} kg)`);
  check(!!TRAITS.prepper && !Object.keys(TRAITS).includes("prepper"), "the Prepper trait resolves for the roster but is never rolled at birth (not enumerable)");
  check(P.FOOD === 15 && P.WATER === 15, `the bag holds five days for three: ${P.FOOD} food, ${P.WATER} water`);
  let withTrait = 0, guns = 0, knives = 0, ammoOk = 0, preppersAt = new Set();
  const kitKinds = new Set();
  for (const st of prepWorlds) {
    const p = roadTeam(st);
    const hc0 = st.hardcore.start;
    const pr = st.survivors.find((s) => s.id === hc0.prepper);
    if (!check(!!pr && partyMembers(st, p).includes(pr) && pr.background === "prepper", `seed ${st.seed}: the start names the prepper on the team`)) continue;
    preppersAt.add(st.survivors.indexOf(pr));
    const bag = pr.gear.backpack;
    check(!!bag && bag.key === P.BAG, `seed ${st.seed}: ${pr.name.split(" ")[0]} carries the ${P.BAG}`);
    const inBag = (bag && bag.contents || []).filter(Boolean);
    const onThem = [pr.gear.tool, pr.gear.weapon, ...inBag].filter(Boolean);
    for (const it of onThem) kitKinds.add(it.key);
    check(pr.gear.tool && pr.gear.tool.key === "waterfilter", `seed ${st.seed}: the water filter is in their hand`);
    check(P.KIT.every((k) => onThem.some((it) => it.key === k)), `seed ${st.seed}: the whole kit is on them (${P.KIT.join(", ")})`);
    const extras = inBag.filter((it) => !P.KIT.includes(it.key)).length;
    check(extras >= P.EXTRA_N[0] && extras <= P.EXTRA_N[1] && inBag.every((it) => !packSize(it) && !GEAR[it.key].bulky), `seed ${st.seed}: ${extras} extras from the prepper's list, everything fits a pack`);
    const w = pr.gear.weapon;
    check(!!w && (w.key === "knife" || P.GUNS[w.key]), `seed ${st.seed}: a knife or a gun (${w && w.key})`);
    if (w && P.GUNS[w.key]) { guns++; if (totalRounds(p.supplies) >= P.AMMO) ammoOk++; } else knives++;
    const traited = pr.traits.includes("prepper");
    if (traited) withTrait++;
    check(traited ? pr.traits.length <= P.MAX_TRAITS : pr.traits.length >= P.MAX_TRAITS, `seed ${st.seed}: the trait when a slot allows (${pr.traits.join(", ")})`);
    const line = st.log.find((l) => /was a prepper/.test(l.text));
    check(!!line && line.text.startsWith(pr.name.split(" ")[0]) && Math.floor(line.hour / 24) === 0 && (traited || /no room for the trait/.test(line.text)), `seed ${st.seed}: day 1's log names the prepper (${line ? line.text.slice(0, 60) : "no line"}…)`);
    check(hc0.grabbed[0].startsWith(pr.name.split(" ")[0]) && /packed by the door: 15 days of food, 15 water/.test(hc0.grabbed[0]) && /15 days of food, 15 water/.test(st.cards[0].text), "the opening blurb tells the bag's contents first");
    check(/15 days of food, 15 water/.test(st.cards[0].text), "the opening blurb tells the bag's contents");
    check(p.supplies.meds >= P.MEDS, `seed ${st.seed}: the bag's meds are pooled (${p.supplies.meds})`);
    check(!p.burden || p.burden.band <= 1, `seed ${st.seed}: the team still walks (load band ${p.burden && p.burden.band})`);
  }
  check(guns === ammoOk && guns + knives === prepWorlds.length, `across ${prepWorlds.length} preppers: ${guns} guns (each with ${P.AMMO}+ rounds), ${knives} knives`);
  check(withTrait > 0, `the trait fits some (${withTrait} of ${prepWorlds.length})`);
  check(preppersAt.size >= 2, `the prepper is not always the same one of the three (slots ${[...preppersAt].sort().join(", ")})`);
  check(kitKinds.size >= P.KIT.length + 3, `the kits vary beyond the fixed part (${kitKinds.size} kinds)`);
  // Deterministic by seed, and it survives a save.
  const pseed = prepWorlds[0].seed;
  const a = hc(pseed), b = hc(pseed);
  const who = (st) => { const pr = st.survivors.find((s) => s.id === st.hardcore.start.prepper); return JSON.stringify([pr.name, pr.traits, pr.gear, roadTeam(st).supplies]); };
  check(who(a) === who(b), "same seed, same prepper and kit");
  a.cards.length = 0; // the opening card is answered before a save
  const ld = loadFromString(saveToString(a));
  const prA = a.survivors.find((s) => s.id === a.hardcore.start.prepper), prL = ld.survivors.find((s) => s.id === ld.hardcore.start.prepper);
  check(!!prL && prL.name === prA.name && prL.traits.join() === prA.traits.join() && prL.gear.backpack.key === P.BAG && JSON.stringify(prL.gear.backpack.contents) === JSON.stringify(prA.gear.backpack.contents) && prL.gear.tool.key === "waterfilter", "a save brings the prepper, the trait and the bag's contents back");
  check(JSON.stringify(roadTeam(ld).supplies) === JSON.stringify(roadTeam(a).supplies), "and the pooled five days");
  check(ld.log.some((l) => /was a prepper/.test(l.text)), "and the log line");
}
// ---------- who they were, and the car ----------
section("Who they were: three backgrounds, no two alike; one car between them with a tank at least half full");
{
  const A = HC_START.ARCHETYPES;
  check(Object.keys(A).length >= 10 && ["prepper", "veteran", "student", "office", "bluecollar"].every((k) => A[k]) && Object.keys(BACKGROUNDS).join() === Object.keys(A).join(), `${Object.keys(A).length} backgrounds: ${Object.values(A).map((x) => x.name).join(", ")}`);
  for (const [k, a] of Object.entries(A)) {
    check(Object.keys(a.cars).every((t) => VEHICLE_TYPES[t] && VEHICLE_TYPES[t].motor), `${k}: its cars exist (${Object.keys(a.cars).join(", ")})`);
    check(Object.keys(a.trunk.gear || {}).every((g) => GEAR[g]) && Object.keys(a.trunk).filter((x) => x !== "gear" && x !== "n").every((x) => SUPPLIES[x] || x === "food" || x === "preserved"), `${k}: everything in its trunk exists (food: days of it, typed when packed)`);
    check(Object.keys(a.skills).every((x) => SKILLS_ALL.includes(x)) && Object.keys(a.traits || {}).every((t) => TRAITS[t]), `${k}: its skills and traits exist`);
  }
  check(["suv", "hummer", "van"].every((t) => VEHICLE_TYPES[t] && VEHICLE_TYPES[t].motor && VEHICLE_TYPES[t].tank > 0 && VEHICLE_TYPES[t].payload > 0), "the SUV, the Hummer and the work van are cars (vehicles.js)");
  const seen = {}, carKinds = {}, owners = {};
  const many = [...worlds, ...Array.from({ length: 24 }, (_, i) => hc(2000 + i))];
  for (const st of many) {
    const p = roadTeam(st), m = partyMembers(st, p), hc0 = st.hardcore.start;
    const kinds = m.map((x) => x.background);
    check(kinds.every((k) => A[k]) && new Set(kinds).size === m.length, `seed ${st.seed}: three backgrounds, no two alike (${kinds.join(", ")})`);
    for (const k of kinds) seen[k] = (seen[k] || 0) + 1;
    check(m.every((x) => hc0.backgrounds[x.id] === x.background), `seed ${st.seed}: the start records who each was`);
    const v = partyVehicle(st, p);
    const owner = st.survivors.find((x) => x.id === hc0.carOwner);
    if (!check(!!v && v.id === hc0.car && !!owner && m.includes(owner), `seed ${st.seed}: the team's car and its owner`)) continue;
    carKinds[v.type] = (carKinds[v.type] || 0) + 1;
    owners[owner.background] = (owners[owner.background] || 0) + 1;
    check(!!A[owner.background].cars[v.type], `seed ${st.seed}: a ${v.type} for a ${owner.background} (${Object.keys(A[owner.background].cars).join(" / ")})`);
    const T = VEHICLE_TYPES[v.type];
    check(v.fuel >= T.tank * HC_START.CAR.FUEL[0] - 1e-9 && v.fuel <= T.tank && v.condition >= HC_START.CAR.CONDITION[0] && v.condition <= HC_START.CAR.CONDITION[1], `seed ${st.seed}: the tank at least half full (${v.fuel} of ${T.tank}), condition ${v.condition}`);
    const TR = A[owner.background].trunk;
    const cs = asGeneric(Object.fromEntries(Object.entries(p.cargo.supplies).filter(([k]) => !FOODS[k]))); // ammo.js: the rounds in the back, counted as the old "ammo"; food by type apart
    const fd = foodIn(p.cargo.supplies), flo = ((TR.food || [0])[0] || 0) + ((TR.preserved || [0])[0] || 0), fhi = ((TR.food || [0, 0])[1] || 0) + ((TR.preserved || [0, 0])[1] || 0);
    check(Object.entries(cs).every(([k, q]) => TR[k] && q >= TR[k][0] && q <= TR[k][1]) && Object.keys(TR).filter((k) => SUPPLIES[k] && TR[k][0] > 0).every((k) => cs[k] >= TR[k][0]) && fd >= flo - 1 && fd <= fhi + 1, `seed ${st.seed}: the supplies in the back are the owner's (${JSON.stringify(cs)}, ${fd.toFixed(1)} days of food)`);
    const back = p.cargo.gear.filter((g) => !isTentBag(g)); // tents.js: the tent bags each one got (TENTS.HARDCORE) ride in the back too
    check(back.every((g) => TR.gear && TR.gear[g.key]) && back.length >= TR.n[0] && back.length <= TR.n[1], `seed ${st.seed}: the things in the back are the owner's (${back.map((g) => g.key).join(", ")})`);
    check(p.cargo.gear.filter(isTentBag).length === m.length * TENTS.HARDCORE, `seed ${st.seed}: and a one-person tent bag for each of them`);
    const line = hc0.grabbed[hc0.grabbed.length - 1];
    check(new RegExp(`^${owner.name.split(" ")[0]} got everyone into their ${v.name}`, "i").test(line) && /tank \d+% full/.test(line) && /in the back/.test(line) && st.cards[0].text.includes(line), `seed ${st.seed}: the opening blurb says whose car and what is in the back`);
    check(st.log.some((l) => /set off in .*: tank \d+% full/.test(l.text) && Math.floor(l.hour / 24) === 0), `seed ${st.seed}: day 1's log says they set off in it`);
    check(m.every((x) => new RegExp(`${x.name.split(" ")[0]} \\(${A[x.background].name.toLowerCase()}`).test(st.cards[0].text)), `seed ${st.seed}: the card names each one's background`);
    check(!p.burden || p.burden.band <= 2, `seed ${st.seed}: the car is not overloaded (load band ${p.burden && p.burden.band})`);
  }
  console.log(`  backgrounds over ${many.length} starts: ${JSON.stringify(seen)}; cars: ${JSON.stringify(carKinds)}; owners: ${JSON.stringify(owners)}`);
  check(Object.keys(A).every((k) => seen[k] > 0), "every background turns up");
  check(Object.keys(carKinds).length >= 4 && (carKinds.truck || 0) > (carKinds.sedan || 0) * 0.3, `several kinds of car (${Object.keys(carKinds).join(", ")})`);
  // A background bumps the skills it says, on a fresh survivor.
  const st0 = hc(31);
  const fresh = makeSurvivor(st0, 1);
  const before = { ...fresh.skills };
  applyArchetype(st0, fresh, "nurse");
  check(fresh.background === "nurse" && fresh.skills.medicine >= Math.min(20, before.medicine + A.nurse.skills.medicine[0]), `a nurse's Medicine: ${before.medicine} → ${fresh.skills.medicine}`);
  // Deterministic, and the car survives a save.
  const a = hc(909), b = hc(909);
  const car = (st) => { const v = partyVehicle(st, roadTeam(st)); return JSON.stringify([v.type, v.fuel, v.condition, roadTeam(st).cargo, st.survivors.map((x) => x.background)]); };
  check(car(a) === car(b), "same seed, same backgrounds and car");
  a.cards.length = 0;
  const ld = loadFromString(saveToString(a));
  check(car(ld) === car(a) && ld.hardcore.start.car === a.hardcore.start.car && roadTeam(ld).vehicle === true, "a save brings the backgrounds, the car and its cargo back");
}
{
  const a = hc(4242), b = hc(4242);
  const sig = (st) => JSON.stringify(st.survivors.map((s) => [s.name, s.gear, s.pockets])) + JSON.stringify(roadTeam(st).supplies) + partyTile(roadTeam(st));
  check(sig(a) === sig(b), "same seed, same start (spawn, gear and supplies)");
  const n = createWorld({ seed: 4242, factionCount: 7 });
  check(n.mode === "normal" && n.bases.length === 1 && n.survivors.length === 6 && hub(n) && !n.bases[0].buildings.some((b) => BUILDINGS[b.type].plot) && n.bases[0].stock.scrap > 0, "a normal world still starts with its hub and six survivors, bare (barestart: nothing on a plot, only its start layout; scrap for the first ones)");
  // New-game crew edits: the first three colonists' names and the leader carry into a hardcore start.
  const crew = [{ name: "Ada Vance", skills: { scavenging: 12 } }, { name: "Bo Reyes", leader: true }, { name: "Cy Moss" }, { name: "Dee Six", leader: false }];
  const c = hc(4242, { crew });
  check(c.survivors.map((s) => s.name).join() === "Ada Vance,Bo Reyes,Cy Moss" && c.survivors[1].leader && c.survivors.filter((s) => s.leader).length === 1 && c.survivors[0].skills.scavenging === 12, "crew edits apply to the three (names, skills, leader)");
  const c2 = hc(4242, { crew: [{}, {}, {}, { leader: true }] });
  check(c2.survivors.filter((s) => s.leader).length === 1, "a leader from beyond the first three: someone still leads");
}

// ---------- founding the first hub: the staging camp ----------
section("The first hub: Establish base sets up a camp (the barest base); its builders build it up into the shelter, then a base");
// Ticks until done() or the hours run out; cards are cleared (conflicts, orders).
function run(st, hours, done = () => false, each = null) {
  for (let i = 0; i < hours && !done(); i++) {
    tickHour(st);
    st.cards.length = 0;
    if (st.engagement) st.engagement = null;
    if (each) each();
  }
}
const landNear = (st, from, d) => st.tiles.find((t) => t.terrain !== "water" && t.terrain !== "mountain" && !t.hive && st.grid.distance(t.id, from) === d && planPath(st, from, t.id, false));
const campOf = (st) => st.bases.find((b) => b.camp === true) || null;
{
  const st = hc(77);
  st.noWanderers = true;
  const p = roadTeam(st);
  p.cargo = { supplies: {}, gear: [] }; // the car's trunk emptied: this section counts the materials itself
  const opt = () => orderOptions(st, p).find((o) => o.mission === "establish");
  p.supplies.scrap = 0; p.supplies.wood = 0; p.supplies.stone = 0;
  check(opt() && opt().label === ESTABLISH_LABEL && /camp fire needs/.test(opt().disabled || ""), `the first camp's fire takes wood and stone carried (the user's request 2026-10-23): greyed out without (${opt() && opt().disabled})`);
  Object.assign(p.supplies, { wood: CAMP.fireCost.wood, stone: CAMP.fireCost.stone });
  check(opt() && opt().label === ESTABLISH_LABEL && !opt().disabled, `the order ${ESTABLISH_LABEL} is offered on open land carrying only the fire's wood and stone (${opt() && opt().disabled})`);
  check(orderOptions(st, p).some((o) => o.mission === "camp" && !o.disabled), "Set up camp is offered too (any team, anywhere)");
  check(!orderOptions(st, p).some((o) => o.mission === "outpost"), "no Build outpost with no base");
  check(/camp/.test(opt().desc) && opt().desc.includes(needText(STAGING.HARDCORE.needs)), "it says what the step up takes");
  const water = st.tiles.find((t) => t.terrain === "water" && !t.bridge);
  check(!!establishProblem(st, water.id), "not on water");
  const tile0 = partyTile(p);
  const people = partyMembers(st, p).map((s) => s.id);
  p.cargo.gear.push({ key: "crowbar", name: GEAR.crowbar.name, quality: 1 });
  Object.assign(p.cargo.supplies, { water: 40, parts: 1 }); setFood(p.cargo, 40);
  st.cards.length = 0;
  giveOrder(st, p, "establish");
  check(!st.bases.length && p.phase === "task" && p.task.type === "pitch", `the team sets up the camp first (${p.task && p.task.hours} hours: its fire and the clearing of its 5 × 5)`);
  run(st, Math.ceil(p.task.hours) + 2, () => st.bases.length > 0);
  const camp = campOf(st);
  check(!!camp && camp.tile === tile0 && camp.first && camp.type === "hub" && hub(st) === camp, "a camp stands on the team's tile: a base, your hub");
  check(!st.parties.includes(p) && people.every((id) => atBase(st, camp.id).some((s) => s.id === id)), "the team moved in: its people live at the camp");
  check(camp && camp.armory.some((it) => it.key === "crowbar") && food(camp) + jarred(camp) >= 30 && st.vehicles[0].loc.kind === "base" && st.vehicles[0].loc.baseId === camp.id, "its cargo is the camp's stores and armory, the car parked there");
  check(firstHubPending(st) && tierName(camp) === "Camp" && tierInfo(st).stage === 0 && tierInfo(st).next === "Shelter", "not founded yet: a camp, the next stage the shelter");
  check(!tierUpJob(camp) && st.log.some((l) => /Build list/.test(l.text)), "nothing queued on setting up: the log says to place the step up from the Build list (the user's request 2026-10-23)");
  queueBuild(st, camp, tierUpType(camp)); // the player picks the shelter shack from the Build list (ui/basemap.js openToPlace)
  const job = tierUpJob(camp);
  const needScrap = st.tiles[tile0].ruin ? STAGING.HARDCORE.needs.scrap - STAGING.RUIN_SCRAP : STAGING.HARDCORE.needs.scrap;
  check(job && job.type === "camp_up" && gatherRows(job).find((r) => r.key === "scrap").need === needScrap && gatherRows(job).find((r) => r.key === "buildmat").need === STAGING.HARDCORE.needs.buildmat && job.hours === STAGING.HARDCORE.work, `its step up, placed, is queued: ${needText(STAGING.HARDCORE.needs)}, ${job && job.hours} work-hours`);
  check(atBase(st, camp.id).every((s) => assignedRole(s) === "build"), `everyone on Build (${atBase(st, camp.id).map((s) => s.role).join(", ")} this hour: noidle.js, no materials yet)`); // their own job; with nothing to build they help elsewhere for the hour
  check(baseWalls(camp) === 0 && baseBeds(camp) === CAMP.beds && farmSlots(camp) === 0 && plotCap(camp, "building") === 0 && plotCap(camp, "utility") === 2, `a camp is barer than a shelter: walls 0, beds ${baseBeds(camp)}, no crop plot until one is dug, two utility plots`);
  // (BASE-03, 2026-10-12: the drying rack, bench, boiler and cook fire are camp buildings now; the watchtower still waits.)
  check(!canBuild(st, camp, "hub_up").ok && !canBuild(st, camp, "watchtower").ok && /shelter/.test(canBuild(st, camp, "watchtower").reason) && /once it is a base/.test(canBuild(st, camp, "well").reason), "the rest waits for the shelter or the base (and says so)");
  check(establishOption(st, null, landNear(st, tile0, 2).id) === null, "with a base (the camp): no Establish base");
  // Half the materials: the work goes as far as they allow and waits.
  Object.assign(camp.stock, { scrap: Math.ceil(needScrap / 2), buildmat: STAGING.HARDCORE.needs.buildmat / 2, wood: STAGING.HARDCORE.needs.wood / 2 + 300 }); // wood (the user's pick 2026-10-20): half the step up's and the fire's days
  const t1 = st.hour;
  run(st, 24 * 4, () => job.progress > 0 && gatherStalled(job));
  check(gatherStalled(job) && job.progress > 0 && job.progress < job.hours * 0.56, `half the materials: about half the work, then it waits (${Math.round((job.progress / job.hours) * 100)}% after ${st.hour - t1}h)`);
  // The rest comes in: the shelter stands.
  Object.assign(camp.stock, { scrap: (camp.stock.scrap || 0) + needScrap, buildmat: (camp.stock.buildmat || 0) + STAGING.HARDCORE.needs.buildmat, wood: (camp.stock.wood || 0) + STAGING.HARDCORE.needs.wood + 300 });
  const t2 = st.hour;
  run(st, 24 * 6, () => !campOf(st));
  const h = hub(st);
  check(!!h && h === camp && !h.camp && isShelter(h) && st.bases.length === 1, `the camp is built up into the shelter (after ${st.hour - t2}h more)`);
  check(h && /Holdout/.test(h.name), `named as a holdout (${h && h.name})`);
  check(h && h.buildings.length === 1 && h.buildings[0].type === "camp_up" && st.vehicles.length === 1 && st.vehicles[0].loc.baseId === h.id && st.vehicles[0].id === st.hardcore.start.car, "it starts bare: nothing but its shelter shack (the step up, standing where it went up); the car they fled in is parked there");
  check(!firstHubPending(st) && st.hardcore.start.foundedDay === day(st) && playerTile(st) === h.tile, "the first hub is done, playerTile is the hub");
  check(st.log.some((l) => /set up camp/.test(l.text) && l.kind === "good") && st.log.some((l) => /is a shelter now|camp is a shelter now/.test(l.text)), "the log (and so the timelapse) marks the camp and the founding");
  check(h && atBase(st, h.id).some((s) => assignedRole(s) === "farm"), "jobs assigned by skill, as a normal start (someone farms, helping elsewhere until a plot is dug)");
  check(establishOption(st, null, landNear(st, tile0, 2).id) === null, "with a base: no Establish base; later camps are outpost camps");
  try { for (let i = 0; i < 48; i++) tickHour(st); check(true, "the new hub runs"); } catch (e) { check(false, `the new hub runs: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); }
  // ---------- shelter → base ----------
  check(h && isShelter(h) && tierName(h) === "Shelter" && tierInfo(st).stage === 1 && tierInfo(st).next === "Base", "a shelter (tier 0), the next stage a base");
  check(h && baseWalls(h) === SHELTER.walls && baseBeds(h) === SHELTER.beds && farmSlots(h) === SHELTER.plots && baseVision(h) === SHELTER.vision, `a shelter is small: walls ${h && baseWalls(h)}, beds ${h && baseBeds(h)}, plots ${h && farmSlots(h)}, vision ${h && baseVision(h)}`);
  check(h && waterProduction(st, h).own === 0, "no well of its own");
  check(h && foodUse(st, h).heads === mouthsAt(st, h).heads && mouthsAt(st, h).residents === atBase(st, h.id).length && waterNeed(st, h).heads === mouthsAt(st, h).heads && Math.abs(foodUse(st, h).residents - mouthsAt(st, h).residents * foodUse(st, h).rate) < 1e-9,
    `the shelter's food and water go per head (${h && useText(foodUse(st, h))}; water ${h && waterNeed(st, h).total})`);
  check(h && structuresOf(h).map((s) => s.key).join() === "shack" && baseWalls(h) === 0 && wallHold(h) === wallHold({ ...h, tier: undefined }), `base battles: only a shack, and no wall it did not build (${h && structuresOf(h).map((s) => s.key).join()}; buildings.js WALL_TIERS)`);
  if (h) {
    h.construction.length = 0;
    Object.assign(h.stock, { scrap: 200, parts: 20, meds: 10, buildmat: 10, wood: 2000, stone: 100 }); // stone: the boiler's and the cook fire's (2026-10-23)
    stockTools(h); // a hammer, a saw, a shovel… (toolreqs.js): what a shelter may build is the subject here
    const ok = (k) => canBuild(st, h, k).ok;
    check(ok("rain_catcher") && ok("smoker") && ok("barricades") && ok("farm_plot") && ok("hub_up"), "a shelter builds a rain catcher, a drying rack, a barricade, a farm plot, and the step up into a base");
    check(ok("walls") && !ok("well") && !ok("storehouse") && !ok("radio"), "a wall (the Defenses tab: up to a timber palisade) but no well, storehouse or the rest at a shelter");
    check(ok("bunkhouse") && ok("infirmary"), "its one building plot (2026-10-12) takes a bunkhouse or an infirmary");
    check(ok("watchtower") && ok("boiler") && ok("water_barrel") && ok("crates") && ok("cookhouse"), "a shelter's two utility plots take the yard things");
    queueBuild(st, h, "farm_plot");
    check(canBuild(st, h, "farm_plot").ok && SHELTER.build.farm_plot === BUILDINGS.farm_plot.max, "as many farm plots as a base's soil takes (2026-10-22: no count by stage)");
    h.construction.length = 0;
    st.cards.length = 0; st.nameAsk = [];
    const html = renderModal(st, { ...freshUi(), baseView: { id: h.id, tab: "overview" } }) || "";
    check(/Shelter/.test(html) && /main house/i.test(html) && /data-action="campfire"/.test(html) && /Water source/.test(html), "the base panel shows the stage, the step up (button), the water source and the fire");
    check(/queued/.test(queueBuild(st, h, "hub_up")), "the Main house is queued");
    const t0 = st.hour;
    run(st, 24 * 10, () => !isShelter(h), () => { for (const s of atBase(st, h.id)) s.role = "build"; });
    check(!isShelter(h) && tierName(h) === "Main hub" && baseWalls(h) === 0 && baseVision(h) === 3 && waterProduction(st, h).own > 0 && canBuild(st, h, "walls").ok && tierInfo(st).stage === 2, `the builders build it up into a base in ${((st.hour - t0) / 24).toFixed(1)} days: a well, vision, every building (walls from the Defenses tab)`);
    check(!canBuild(st, h, "hub_up").ok && st.log.some((l) => /is a real base now/.test(l.text)), "once only, and the log says so");
  }
}
section("Camp danger: the camp's Heat (its fire, vehicles parked, shooting lately); the toggle; a team resting in the field");
{
  const st = hc(202);
  st.noWanderers = true;
  const p = roadTeam(st);
  Object.assign(p.cargo.supplies, { scrap: 4, water: 30 }); setFood(p.cargo, 30);
  st.cards.length = 0;
  establishNow(st, p);
  const camp = campOf(st);
  camp.stock.wood = 300; // a camp fire burns firewood from the store, and is lit again only with some (woodcutting.js canLight)
  const night = st.hour - (st.hour % 24) + 22, noon = st.hour - (st.hour % 24) + 36;
  const heat = (hour = night) => shelterHeat(st, camp, hour);
  check(camp.fire === true && heat().rows.some((r) => r.key === "fire"), `a new camp has its fire lit: ${heat().text}`);
  const lit = heat().total;
  setFire(st, camp, false);
  check(heat().total < lit && !heat().rows.some((r) => r.key === "fire"), `putting the fire out lowers it (${lit.toFixed(2)} → ${heat().total.toFixed(2)} at night)`);
  setFire(st, camp, true);
  check(heat(noon).total < heat(night).total, `the fire carries further at night (${heat(noon).total.toFixed(2)} by day, ${heat(night).total.toFixed(2)} at night)`);
  check(heat().rows.some((r) => r.key === "vehicle"), "the car parked there adds to it");
  const g0 = heat(st.hour).total;
  noteGunfire(st, camp.tile, 20);
  const g1 = heat(st.hour).total, g2 = heat(st.hour + 24).total;
  check(g1 > g0 + 1 && g2 < g1 && /shots/i.test(heat(st.hour).text), `shots raise it and fade (${g0.toFixed(2)} → ${g1.toFixed(2)} now, ${g2.toFixed(2)} a day on)`);
  // The fire's comforts at the camp: a team waiting on its tile sits by it.
  const lp = launchExpedition(st, { memberIds: atBase(st, camp.id).slice(0, 1).map((s) => s.id), dest: camp.tile, mission: "move", stance: "normal", fromBaseId: camp.id, supplies: {} });
  if (!lp.error) { const q = lp.party; q.phase = "waiting"; q.path = [camp.tile]; q.idx = 0; check(teamFire(st, q) === true, "a team waiting at the camp sits by its fire"); setFire(st, camp, false); check(teamFire(st, q) === false, "and without it when it is out"); }
  // A team resting in the field (the internal rest task the governor and plans use) keeps the camp danger model.
  const s2 = hc(303);
  const q = roadTeam(s2);
  startOrder(s2, q, { type: "camp", hours: 24 });
  const site = campSite(s2, q);
  check(site && site.kind === "team" && site.fire, "a team resting in the field: its own fire");
  const a = heatGain(s2, q, "camp", 22).gain;
  setFire(s2, q, false);
  const b = heatGain(s2, q, "camp", 22).gain;
  check(b < a && fireLit(q) === false, `its fire toggles too (${a.toFixed(2)} → ${b.toFixed(2)})`);
  check(CAMP_HEAT.fireNight > CAMP_HEAT.fireDay, "a fire carries further at night");
  const xp = renderRight(s2, { ...freshUi(), expedition: q.id });
  check(/data-action="campfire"/.test(xp) && /Camp danger/.test(xp), "the team panel shows the camp danger and the fire toggle");
}
section("Water must be found: no spring; a river beside, water carried in, rain catchers");
{
  const findSpot = (st, wet) => {
    const p = roadTeam(st);
    for (const id of st.grid.within(partyTile(p), 8)) {
      const t = st.tiles[id];
      if (t.terrain === "water" || t.terrain === "mountain" || t.hive || establishProblem(st, id)) continue;
      const w = waterSource(st, id);
      if (wet ? w && w.dist === 1 : !w) return id;
    }
    return null;
  };
  for (const wet of [false, true]) {
    let st = null, spot = null;
    for (const seed of [11, 23, 42, 77, 101, 202]) { st = hc(seed); spot = findSpot(st, wet); if (spot != null) break; }
    if (!check(spot != null, `a ${wet ? "riverside" : "dry"} spot to test`)) continue;
    st.noWanderers = true;
    const p = roadTeam(st);
    // The tile panel says it while choosing a spot.
    const row = fromTeamRow(st, spot === partyTile(p) ? st.grid.neighbors(spot).find((n) => st.tiles[n].terrain !== "water") : spot) || "";
    check(/Water/.test(row) && /(tile|tiles) away|No water source nearby/.test(row), "the tile panel rates the water when choosing a spot");
    p.path = [spot]; p.idx = 0; p.dest = spot; p.phase = "waiting";
    Object.assign(p.cargo.supplies, { scrap: 4 });
    st.cards.length = 0;
    establishNow(st, p);
    const camp = campOf(st);
    check(/Water: /.test((st.log.find((l) => /set up camp/.test(l.text)) || { text: "" }).text), "the camp's log line says where its water is");
    const prod = waterProduction(st, camp);
    if (wet) check(prod.own === 0 && prod.stream === SHELTER.river && waterText(st, camp.tile) === `${waterSource(st, camp.tile).kind} 1 tile away`, `beside a ${waterSource(st, camp.tile).kind}: its people haul ${prod.stream} a day: "${waterText(st, camp.tile)}"`);
    else check(prod.own === 0 && prod.stream === 0 && waterText(st, camp.tile) === "No water source nearby", `away from water: nothing comes in by itself: "${waterText(st, camp.tile)}"`);
  }
  // A shelter: no well; a river beside it hauled, rain catchers on wet days, water brought in.
  const st = hc(42);
  const p = roadTeam(st);
  const base = { id: newId(), tile: partyTile(p), type: "hub", tier: 0, fire: true, name: "Test Shelter", stock: { food: 20, water: 10, fuel: 0, meds: 0, ammo: 0, parts: 0, scrap: 0, preserved: 0, jars: 0 }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(base);
  const prod = waterProduction(st, base);
  const beside = st.grid.neighbors(base.tile).some((n) => st.tiles[n].terrain === "water");
  check(prod.own === 0 && prod.stream === (beside ? SHELTER.river : 0), `a shelter's water: no well, ${beside ? `the river ${SHELTER.river} a day` : "no river beside"} (own ${prod.own}, stream ${prod.stream})`);
  addBuilding(base, "rain_catcher");
  const saveHour = st.hour;
  let wetDay = null;
  for (let d = 0; d < 112 && wetDay == null; d++) if (rainWater(st, d) > 0) wetDay = d;
  st.hour = wetDay * 24 + 12;
  check(waterProduction(st, base).rain > 0, `a rain catcher fills on a wet day (${waterProduction(st, base).rain} on day ${wetDay + 1})`);
  st.hour = saveHour;
  st.bases.length = 0;
}
section("The camp's step up: days by builders, neglect, striking it, a team lost there");
{
  // Build time: everything delivered at once, three builders.
  const st = hc(303);
  st.noWanderers = true;
  const p = roadTeam(st);
  Object.assign(p.cargo.supplies, { scrap: 40, parts: 5, water: 45, buildmat: 4, wood: 500 }); setFood(p.cargo, 40); // wood: the step up's 200 and the fire's
  st.cards.length = 0;
  establishNow(st, p);
  const t0 = st.hour;
  run(st, 24 * 8, () => !campOf(st));
  const took = (st.hour - t0) / 24;
  check(!!hub(st) && !campOf(st) && took >= 0.2 && took <= 3, `built up into the shelter in ${took.toFixed(1)} days by three (${STAGING.HARDCORE.work} work-hours)`);
  // Neglect: everyone leaves; nobody there for ABANDON+ days and looters come.
  const s3 = hc(505);
  s3.noWanderers = true;
  const p3 = roadTeam(s3);
  Object.assign(p3.cargo.supplies, { scrap: 14, buildmat: 1, water: 30 }); setFood(p3.cargo, 30);
  s3.cards.length = 0;
  establishNow(s3, p3);
  const c3 = campOf(s3);
  run(s3, 24 * 2);
  const away = landNear(s3, c3.tile, 3);
  const lp = launchExpedition(s3, { memberIds: atBase(s3, c3.id).map((s) => s.id), dest: away.id, mission: "move", stance: "normal", fromBaseId: c3.id, supplies: { food: 10, water: 10 } });
  check(!lp.error, `everyone leaves the camp as a team (${lp.error || "ok"})`);
  const t3 = lp.party;
  run(s3, 24, () => t3.phase === "waiting");
  c3.stock.scrap = (c3.stock.scrap || 0) + 30;
  const job3 = tierUpJob(c3);
  const before = { scrap: c3.stock.scrap, prog: job3 ? job3.progress : 0 };
  run(s3, 24 * (STAGING.ABANDON + 8), () => false, () => { if (s3.parties.includes(t3)) { setFood(t3, 20); t3.supplies.water = 20; for (const s of partyMembers(s3, t3)) s.health = Math.max(s.health, 60); } });
  check(s3.bases.includes(c3) && c3.looted > 0 && c3.stock.scrap < before.scrap && (!job3 || job3.progress <= before.prog), `alone for ${STAGING.ABANDON}+ days the camp is looted (${c3.looted}×: scrap ${before.scrap} → ${c3.stock.scrap})`);
  check(s3.log.some((l) => /left alone too long/.test(l.text)), "the log says so");
  check(computeAlerts(s3).some((a) => a.kind === "campalone"), "an alert: nobody at the camp");
  // Striking it: back home, then Strike camp: the people form a team with what they can carry, the rest is a cache.
  if (s3.parties.includes(t3)) {
    orderMove(s3, t3, c3.tile);
    run(s3, 48, () => t3.phase === "waiting" && partyTile(t3) === c3.tile);
    giveOrder(s3, t3, "enter");
    check(!s3.parties.includes(t3) && atBase(s3, c3.id).length > 0, "back in the camp (Enter)");
    c3.stock.scrap += 400;
    const r = strikeCamp(s3, c3);
    check(!r.error && !s3.bases.includes(c3) && r.party && carried(r.party, "scrap") > 0 && s3.deathSites.some((d) => d.tile === c3.tile && d.items.some((i) => i.key === "scrap")), `struck: a team packs what it can carry, the rest is a cache on the tile (${r.error || r.text})`);
    check(r.party && orderOptions(s3, r.party).some((o) => o.mission === "establish" && !o.disabled), "after striking, a camp can go anywhere again");
  }
  // A camp whose people die there: the camp stays (empty) with its stores.
  const s4 = hc(606);
  s4.noWanderers = true;
  const p4 = roadTeam(s4);
  Object.assign(p4.cargo.supplies, { scrap: 10 });
  s4.cards.length = 0;
  establishNow(s4, p4);
  const c4 = campOf(s4);
  for (const s of atBase(s4, c4.id)) hurt(s4, s, 500, c4.tile, "in a test");
  run(s4, 2);
  check(!atBase(s4, c4.id).length && s4.bases.includes(c4), "the people died there: the camp and its stores remain");
}
// ---------- hubless views ----------
section("The views with no hub: render cleanly");
const BAD = /\b(undefined|NaN|Infinity)\b|\[object [A-Za-z]+\]|\bnull\b/;
const VOID = new Set(["input", "br", "img", "hr", "meta", "link"]);
function scan(html, where) {
  if (typeof html !== "string") return [`${where}: no html (${typeof html})`];
  const out = [];
  const text = html.replace(/<[^>]*>/g, " ");
  const m = BAD.exec(text);
  if (m) out.push(`${where}: "${m[0]}" near "${text.slice(Math.max(0, m.index - 60), m.index + 30).replace(/\s+/g, " ")}"`);
  for (const a of html.matchAll(/(data-[\w-]+|title|value)="([^"]*)"/g)) if (BAD.test(a[2])) out.push(`${where}: bad attribute ${a[1]}="${a[2].slice(0, 80)}"`);
  const stack = [];
  for (const t of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    const tag = t[2].toLowerCase();
    if (VOID.has(tag) || t[3]) continue;
    if (!t[1]) stack.push(tag);
    else if (stack.pop() !== tag) { out.push(`${where}: unbalanced </${tag}>`); break; }
  }
  if (stack.length) out.push(`${where}: unclosed <${stack.join("> <")}>`);
  return out;
}
function freshUi() { return { started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView: null, expedition: null, diary: null, roster: null, help: false, scale: 1, armed: { parties: new Map(), builds: new Set(), crafts: new Set() } }; }
function views(st, label) {
  const out = [];
  const p = roadTeam(st);
  const add = (where, fn) => { try { out.push([where, fn()]); } catch (e) { out.push([where, null]); check(false, `${label} ${where}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); } };
  add("top bar", () => renderTopbar(st, freshUi()));
  for (const tab of ["bases", "people", "groups", "teams"]) add(`left/${tab}`, () => renderLeft(st, { ...freshUi(), tab }));
  add("right/idle", () => renderRight(st, freshUi()));
  if (p) {
    add("right/team tile", () => renderRight(st, { ...freshUi(), selected: partyTile(p) }));
    add("right/team panel", () => renderRight(st, { ...freshUi(), expedition: p.id }));
  }
  const far = st.tiles.find((t) => t.loc && t.loc.type === "town");
  add("right/a town", () => renderRight(st, { ...freshUi(), selected: far.id }));
  add("right/water", () => renderRight(st, { ...freshUi(), selected: st.tiles.find((t) => t.terrain === "water").id }));
  add("modal/card", () => renderModal(st, freshUi()) || "");
  const s0 = alive(st)[0];
  if (s0) {
    const cards = st.cards.splice(0); // the survivor and inventory screens sit under any card
    add("modal/survivor", () => renderModal(st, { ...freshUi(), survivor: s0.id }) || "");
    add("modal/inventory", () => renderModal(st, { ...freshUi(), inv: { sid: s0.id } }) || "");
    add("modal/memorial", () => renderModal(st, { ...freshUi(), memorial: { baseId: null } }) || "");
    st.cards.push(...cards);
  }
  add("modal/planner", () => renderModal(st, { ...freshUi(), planner: { dest: far.id, mission: "scavenge", crew: new Set(), supplies: {} } }) || "");
  const ui1 = freshUi(); openDiary(ui1);
  add("diary", () => diaryModal(st, ui1));
  const ui2 = freshUi(); openRoster(ui2);
  add("roster", () => rosterModal(st, ui2));
  add("alerts", () => renderAlerts(st, freshUi()));
  const api = { options: loadOptions(), desktop: false, autosaveInfo: () => ({ error: "" }), refresh() {}, track() {}, thumb: () => "" };
  for (const tab of ["game", "about"]) { const ui = freshUi(); openSettings(ui, tab); add(`settings/${tab}`, () => settingsModal(st, ui, api)); }
  return out;
}
{
  const st = hc(42);
  st.started = true;
  let probs = [];
  for (const [where, html] of views(st, "day 1")) if (html != null) probs.push(...scan(html, where));
  check(!probs.length, `day 1, hubless: clean views (${probs.slice(0, 4).join(" | ")})`);
  const all = views(st, "day 1").map(([, h]) => h || "").join("\n");
  check(/On the road/.test(all) && /Your first hub/.test(all) && /No camp yet/.test(all) && all.includes(ESTABLISH_LABEL), "the top bar and the Bases tab show the team and how to start the hub");
  check(/First: found your hub/.test(all), "the Goals card puts the hub first");
  check(/From the team/.test(all), "the tile panel measures from the team");
  check(/No hub yet/.test(all), "the planner says there is no hub to send from");
  check(/Hardcore/.test(all), "the settings say Hardcore");
  const al = computeAlerts(st);
  check(al.some((a) => a.kind === "firsthub"), "an alert for the hub not founded yet");
  // Run hubless for two weeks (cards: hold), the team kept fed: every system that looks for a hub copes.
  const p0 = roadTeam(st);
  check(st.live.has(partyTile(p0)) && st.grid.neighbors(partyTile(p0)).every((n) => st.live.has(n)), "you see live around the team");
  const known0 = st.knowledge.filter(Boolean).length;
  const dest = st.tiles.filter((t) => t.terrain !== "water" && st.grid.distance(t.id, partyTile(p0)) === 6).find((t) => orderMove(st, p0, t.id) && p0.phase === "out");
  st.cards.length = 0;
  try {
    for (let i = 0; i < 24 * 14; i++) {
      tickHour(st);
      const p = roadTeam(st);
      if (p) { setFood(p, 20); p.supplies.water = 20; for (const s of partyMembers(st, p)) s.health = Math.max(s.health, 60); }
      while (st.cards.length) {
        const c = st.cards.shift();
        const ch = c.choices.find((x) => /^Hold|^OK$|^Leave|^Back off|^Mark it/.test(x.label)) || c.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled));
        if (ch) ch.resolve(st);
      }
      if (st.engagement) st.engagement = null;
    }
    check(!st.gameOver && alive(st).length > 0, `two weeks hubless (day ${day(st)}, ${alive(st).length} alive)`);
  } catch (e) { check(false, `two weeks hubless: ${e.stack.split("\n").slice(0, 4).join(" | ")}`); }
  probs = [];
  for (const [where, html] of views(st, "day 15")) if (html != null) probs.push(...scan(html, where));
  check(!probs.length, `day 15, hubless: clean views (${probs.slice(0, 4).join(" | ")})`);
  check(st.chronicle && Array.isArray(st.chronicle.frames) ? st.chronicle.frames.length >= 10 : true, "the timelapse kept recording");
  check(!!dest && st.knowledge.filter(Boolean).length > known0 + 10, `the team's own sight maps the land as it walks (${known0} → ${st.knowledge.filter(Boolean).length} tiles known)`);
  // With a camp (a base: sim/staging.js): its card on its tile, its Camp tab, the map tooltip.
  const pc = roadTeam(st);
  if (pc) {
    if (pc.phase !== "waiting") { pc.phase = "waiting"; pc.task = null; pc.path = [partyTile(pc)]; pc.idx = 0; }
    Object.assign(pc.cargo.supplies, { scrap: 12, parts: 1 });
    st.cards.length = 0;
    establishNow(st, pc);
    for (let i = 0; i < 6; i++) tickHour(st);
    st.cards.length = 0; st.nameAsk = [];
    const camp = campOf(st);
    probs = [];
    const cv = views(st, "camp");
    cv.push(["right/camp tile", renderRight(st, { ...freshUi(), selected: camp.tile })]);
    cv.push(["modal/camp tab", renderModal(st, { ...freshUi(), baseView: { id: camp.id, tab: "camp" } }) || ""]);
    for (const [where, html] of cv) if (html != null) probs.push(...scan(html, where));
    check(!probs.length, `with a camp: clean views (${probs.slice(0, 4).join(" | ")})`);
    const ah = cv.map(([, h]) => h || "").join("\n");
    check(/Open camp/.test(ah) && /Strike camp/.test(ah) && /shelter shack/i.test(ah), "the tile panel and the Camp tab show the camp: its step up, Open camp, Strike camp");
    const { tileTooltip } = await import("../src/ui/render.js");
    check(/\(camp\)/.test(tileTooltip(st, camp.tile)), "the map tooltip on the camp");
  }
  // New-run screen in both modes.
  for (const mode of ["hardcore", "normal"]) {
    const w = mode === "hardcore" ? hc(5) : createWorld({ seed: 5, factionCount: 7 });
    const html = newRunScreen(w, { ...freshUi(), started: false, worldSize: "normal", factionCount: 7 });
    check(!scan(html, mode).length && /data-action="gamemode"/.test(html) && new RegExp(`value="${mode}" selected`).test(html), `new-run screen (${mode}): the Mode select, clean`);
    check((html.match(/nrcard/g) || []).length === (mode === "hardcore" ? 3 : 6), `new-run screen (${mode}): ${mode === "hardcore" ? 3 : 6} colonists to edit`);
  }
}

// ---------- starting people ----------
section("Starting people (hardcore.js START_PEOPLE): 1, 2, 3 and 4 flee together; the default is the old start");
{
  const { START_PEOPLE, clampStartPeople } = await import("../src/sim/hardcore.js");
  check(START_PEOPLE.MIN === 1 && START_PEOPLE.MAX === 4 && START_PEOPLE.DEF === 3 && HC_START.CREW === 3, "1–4, three by default");
  check(clampStartPeople(0) === 1 && clampStartPeople(9) === 4 && clampStartPeople("2") === 2 && clampStartPeople("x") === 3 && clampStartPeople(2.6) === 3, "counts are clamped and rounded (junk: three)");
  const sizes = {};
  for (let n = 1; n <= 4; n++) {
    let foodPer = 0, games = 0;
    for (const seed of [11, 42, 77, 303, 505, 808]) {
      const st = hc(seed, { startPeople: n });
      const p = roadTeam(st);
      const tag = `${n} people, seed ${seed}`;
      if (!check(!!p, `${tag}: a team on the road`)) continue;
      const team = partyMembers(st, p);
      check(st.startPeople === n && st.hardcore.start.people === n && st.survivors.length === n && team.length === n && alive(st).length === n, `${tag}: ${n} on the team (${team.length}, ${st.survivors.length} in all)`);
      check(st.survivors.filter((s) => s.leader).length === 1 && new Set(team.map((s) => s.background)).size === n && team.every((s) => BACKGROUNDS[s.background]), `${tag}: one leader, ${n} background${n > 1 ? "s, no two alike" : ""}`);
      check(st.vehicles.filter((v) => v.loc.kind === "party" && v.loc.partyId === p.id).length === 1, `${tag}: one car`);
      const prep = team.some((s) => s.background === "prepper"), P = HC_START.PREPPER;
      const sup = p.supplies, lo = HC_START.TEAM_MIN * n, hi = HC_START.TEAM_MAX * n, pf = prep ? P.FOOD : 0, pw = prep ? P.WATER : 0;
      const fd = food(p); // days of food, typed (sim/foods.js: whole items by the dice, about a day either way)
      check(fd >= lo + pf - 1 && fd <= teamFoodCap(team) + pf + 1 && sup.water >= lo + pw && sup.water <= hi + pw, `${tag}: 1–3 days each (food by background)${prep ? " plus the prepper's bag" : ""} (${fd.toFixed(1)} days of food, ${sup.water} water)`);
      check(n === 1 ? /got out alone/.test(st.log.map((l) => l.text).join(" ")) : st.log.some((l) => new RegExp(`of you got out`).test(l.text)), `${tag}: the day-1 log counts them`);
      check(st.cards[0] && st.cards[0].intro && !st.cards[0].isOrders && /Calder is falling/.test(st.cards[0].text) && p.phase === "waiting", `${tag}: the opening blurb, the team waiting`);
      if (!prep) { foodPer += food(p) / n; games++; }
      try { for (let i = 0; i < 48; i++) { tickHour(st); st.cards.length = 0; } check(true, `${tag}: two days run`); } catch (e) { check(false, `${tag}: two days run: ${e.message}`); }
    }
    sizes[n] = games ? (foodPer / games).toFixed(1) : "-";
  }
  console.log(`  food a head at the start (no prepper): ${Object.entries(sizes).map(([n, v]) => `${n}: ${v}`).join(", ")}`);
  // The default: leaving it out, 3 and the old start build the same world.
  const a = hc(42), b = hc(42, { startPeople: 3 });
  check(JSON.stringify(a.survivors.map((s) => [s.name, s.background, s.skills])) === JSON.stringify(b.survivors.map((s) => [s.name, s.background, s.skills])) && JSON.stringify(roadTeam(a).supplies) === JSON.stringify(roadTeam(b).supplies) && a.rng.next() === b.rng.next(), "leaving it out is the same as 3");
  check(hc(42, { startPeople: 0 }).survivors.length === 1 && hc(42, { startPeople: 7 }).survivors.length === 4, "out of range: clamped to 1–4");
  // A normal start takes its own count (1–8, six when left out: hardcore.js NORMAL_PEOPLE).
  const nw = createWorld({ seed: 42, factionCount: 7, startPeople: 1 });
  check(nw.mode === "normal" && nw.survivors.length === 1 && nw.startPeople === 1 && createWorld({ seed: 42, factionCount: 7 }).survivors.length === 6, "a normal start takes its own count (six when left out)");
  // Saves: the count comes back, the save list has it, and a hardcore save from before it loads as three.
  const two = hc(77, { startPeople: 2 });
  two.cards.length = 0;
  const text = saveToString(two);
  const back = loadFromString(text);
  check(back.startPeople === 2 && JSON.parse(text).meta.startPeople === 2 && partyMembers(back, roadTeam(back)).length === 2, "a save keeps the count (and the save list shows it)");
  const old = hc(77);
  old.cards.length = 0;
  delete old.startPeople;
  check(loadFromString(saveToString(old)).startPeople === 3, "a hardcore save from before the choice loads as three");
  // Edited colonists carried into a smaller or bigger start (the new-run screen's crew, by index).
  const crew = [{ name: "Ada Test" }, { name: "Bo Test", leader: true }, { name: "Cy Test" }];
  const one = hc(42, { startPeople: 1, crew });
  check(one.survivors.length === 1 && one.survivors[0].name === "Ada Test" && one.survivors[0].leader, "a crew of three edited, one starts: the first, and the leader falls back to them");
  const four = hc(42, { startPeople: 4, crew });
  check(four.survivors.length === 4 && four.survivors[1].name === "Bo Test" && four.survivors[1].leader && four.survivors.filter((s) => s.leader).length === 1, "a crew of three edited, four start: the three and one more");
  // The new-run screen: the select, set to the count, in Hardcore; greyed out for a normal start.
  for (let n = 1; n <= 4; n++) {
    const w = hc(5, { startPeople: n });
    const html = newRunScreen(w, { ...freshUi(), started: false, worldSize: "normal", factionCount: 7, startPeople: n });
    const sel = /<select data-action="startpeople"([^>]*)>([\s\S]*?)<\/select>/.exec(html);
    check(!!sel && !/disabled/.test(sel[1]) && (sel[2].match(/<option/g) || []).length === 4 && new RegExp(`value="${n}" selected`).test(sel[2]), `new-run screen (hardcore, ${n}): Starting people, ${n} selected`);
    check((html.match(/nrcard/g) || []).length === n && !scan(html, `hardcore ${n}`).length, `new-run screen (hardcore, ${n}): ${n} colonist${n > 1 ? "s" : ""} to edit, clean`);
  }
  {
    const html = newRunScreen(createWorld({ seed: 5, factionCount: 7 }), { ...freshUi(), started: false, worldSize: "normal", factionCount: 7, startPeople: 2 });
    const sel = /<select data-action="startpeople"([^>]*)>([\s\S]*?)<\/select>/.exec(html);
    check(!!sel && !/disabled/.test(sel[1]) && /value="6" selected/.test(sel[2]) && (sel[2].match(/<option/g) || []).length === 8, "new-run screen (normal): Starting people 1–8, the world's six selected");
  }
}

// ---------- food by background, small teams, the road by team size (2026-10-07) ----------
section("Food by background; one or two get a skill bump and the empty seats loaded; armed strangers sized to the team (2026-10-07)");
{
  const A = HC_START.ARCHETYPES, C = HC_START;
  // What each background grabbed to eat (rollGrab, ARCHETYPES food over the common FOOD): in its own ranges; against
  // the same background with the common FOOD (its own odds of a bag kept), the food backgrounds grab more and the
  // ones who ran with other things less.
  const st0 = hc(31);
  const meanFood = {}, meanCommon = {};
  for (const k of Object.keys(A).filter((x) => x !== "prepper")) {
    const F = A[k].food || C.FOOD;
    let sum = 0, sumC = 0, inRange = true;
    for (let i = 0; i < 400; i++) {
      const s = makeSurvivor(st0, 1);
      const got = rollGrab(st0, s, A[k]);
      const r = s.gear.backpack ? F.pack : F.pockets;
      if (got.food < r[0] || got.food > r[1]) inRange = false;
      sum += got.food;
      sumC += rollGrab(st0, makeSurvivor(st0, 1), { ...A[k], food: undefined }).food;
    }
    meanFood[k] = sum / 400;
    meanCommon[k] = sumC / 400;
    check(inRange, `${k}: food in its own ranges (bag ${F.pack.join("–")}, pockets ${F.pockets.join("–")})`);
  }
  console.log(`  food grabbed, mean of 400 (with the common food): ${Object.entries(meanFood).map(([k, v]) => `${k} ${v.toFixed(2)} (${meanCommon[k].toFixed(2)})`).join(", ")}`);
  check(["farmer", "hunter", "trucker"].every((k) => meanFood[k] > meanCommon[k] + 0.3), "a farmer, a hunter and a trucker grab more food than they would have");
  check(["veteran", "nurse", "mechanic", "cop"].every((k) => meanFood[k] < meanCommon[k] - 0.2), "a veteran, a nurse, a mechanic and a cop grab less (they ran with ammo, a vest, meds or tools)");
  check(["student", "office", "bluecollar", "teacher"].every((k) => !A[k].food), "the others grab the common food");
  // Weighted over the backgrounds (their draw weights) a head grabs about what it did: a default team of three carries
  // about what it did.
  const wsum = Object.entries(A).filter(([k]) => k !== "prepper").reduce((a, [, x]) => a + x.w, 0);
  const avg = Object.entries(meanFood).reduce((a, [k, v]) => a + v * A[k].w, 0) / wsum;
  const avgC = Object.entries(meanCommon).reduce((a, [k, v]) => a + v * A[k].w, 0) / wsum;
  check(Math.abs(avg - avgC) < 0.3, `by the backgrounds' weights the food a head is about what it was (${avg.toFixed(2)} vs ${avgC.toFixed(2)})`);
  check(teamFoodCap([{ background: "farmer" }, { background: "cop" }, { background: "hunter" }]) === 5 + 3 + 4 && teamFoodCap([{ background: "office" }, { background: "nurse" }, { background: "teacher" }]) === 9, "the team's food cap: TEAM_MAX a head, a farmer's 5, a hunter's 4");
  // A fourth brings food by who they were: across seeds, the starts of four with a farmer, a hunter or a trucker
  // carry more a head than the ones without.
  const withF = [0, 0], without = [0, 0];
  for (let seed = 600; seed < 660; seed++) {
    const st = hc(seed, { startPeople: 4 });
    const m = partyMembers(st, roadTeam(st));
    if (m.some((s) => s.background === "prepper")) continue;
    const per = food(roadTeam(st)) / m.length;
    const into = m.some((s) => ["farmer", "hunter", "trucker"].includes(s.background)) ? withF : without;
    into[0] += per; into[1]++;
  }
  check(withF[1] > 0 && without[1] > 0 && withF[0] / withF[1] > without[0] / without[1], `four with a farmer, hunter or trucker carry more a head (${(withF[0] / Math.max(1, withF[1])).toFixed(2)} vs ${(without[0] / Math.max(1, without[1])).toFixed(2)})`);

  // One or two (HC_START.SMALL): + SKILL per empty seat in Scouting, Stealth and Medicine; the empty seats loaded.
  const S = C.SMALL;
  check(emptySeats(1) === 2 && emptySeats(2) === 1 && emptySeats(3) === 0 && emptySeats(4) === 0, "empty seats: 2 alone, 1 for a pair, none for three or four");
  for (const n of [1, 2]) {
    const people = Array.from({ length: n }, () => makeSurvivor(st0, 1));
    const before = people.map((s) => ({ ...s.skills }));
    check(smallTeamSkills(st0, people) === S.SKILLS, `${n}: the skills bumped are ${S.SKILLS.join(", ")}`);
    const seats = emptySeats(n);
    const ok = people.every((s, i) => S.SKILLS.every((k) => { const d = s.skills[k] - (before[i][k] || 0); return s.skills[k] === 20 || (d >= S.SKILL[0] * seats && d <= S.SKILL[1] * seats); })
      && Object.keys(s.skills).filter((k) => !S.SKILLS.includes(k)).every((k) => s.skills[k] === before[i][k]));
    check(ok, `${n}: +${S.SKILL[0] * seats}–${S.SKILL[1] * seats} in each, nothing else`);
  }
  for (const n of [3, 4]) {
    const people = Array.from({ length: n }, () => makeSurvivor(st0, 1));
    const before = JSON.stringify(people.map((s) => s.skills)), r0 = st0.rng.state;
    check(smallTeamSkills(st0, people) === null && JSON.stringify(people.map((s) => s.skills)) === before && st0.rng.state === r0, `${n}: no bump and no dice drawn`);
  }
  // Food by type (sim/foods.js): the car's food counted in days (every kind), the trunk's food and preserved food
  // together, a day either way for the dice that make whole items.
  const carGoods = (p) => { const cs = asGeneric(Object.fromEntries(Object.entries(p.cargo.supplies).filter(([k]) => !FOODS[k]))); const fd = foodIn(p.cargo.supplies); if (fd > 0) cs.food = fd; return cs; };
  const trunkDays = (T) => { const f = T.food || [0, 0], pr = T.preserved || [0, 0]; const out = { ...T }; delete out.preserved; if (T.food || T.preserved) out.food = [f[0] + pr[0] - 1, f[1] + pr[1] + 1]; return out; };
  const seatFood = { 1: [], 2: [] };
  for (const n of [1, 2, 3, 4]) for (const seed of [11, 42, 77, 303, 505, 808]) {
    const st = hc(seed, { startPeople: n });
    const p = roadTeam(st), seats = emptySeats(n);
    const owner = st.survivors.find((x) => x.id === st.hardcore.start.carOwner), TR = trunkDays(A[owner.background].trunk);
    const cs = carGoods(p), line = st.hardcore.start.grabbed[st.hardcore.start.grabbed.length - 1];
    const tag = `${n} people, seed ${seed}`;
    if (!seats) {
      check(Object.entries(cs).every(([k, q]) => TR[k] && q >= TR[k][0] && q <= TR[k][1]) && !/empty seat/.test(line) && !st.log.some((l) => /got out (alone|on their own):/.test(l.text)), `${tag}: only the owner's trunk in the back, no seats loaded`);
      continue;
    }
    const ok = Object.entries(S.SEAT).every(([k, [lo, hi]]) => { const q = cs[k] || 0, t = TR[k] || [0, 0]; return q >= lo * seats + t[0] && q <= hi * seats + t[1]; });
    check(ok, `${tag}: the empty seat${seats > 1 ? "s" : ""} loaded (${JSON.stringify(cs)})`);
    check(/on the empty seats?, what else they could grab: \d+ days of food/.test(line) && st.cards[0].text.includes(line), `${tag}: the opening blurb says what is on the seat${seats > 1 ? "s" : ""}`);
    check(st.log.some((l) => (n === 1 ? /got out alone: the kind who can look after themselves \(Scouting, Stealth and Medicine up\)/ : /got out on their own: the kind who can look after each other/).test(l.text)), `${tag}: day 1's log says why`);
    check(!p.burden || p.burden.band <= 2, `${tag}: the car is not overloaded (load band ${p.burden && p.burden.band})`);
    seatFood[n].push(Math.round((cs.food || 0) * 10) / 10);
  }
  console.log(`  food in the car, alone: ${seatFood[1].join(", ")}; a pair: ${seatFood[2].join(", ")}`);
  // Deterministic with the seed, and through a save.
  const a1 = hc(77, { startPeople: 1 }), b1 = hc(77, { startPeople: 1 });
  const sig1 = (st) => JSON.stringify([st.survivors.map((s) => s.skills), roadTeam(st).cargo.supplies, roadTeam(st).supplies]);
  check(sig1(a1) === sig1(b1), "same seed, same small start");
  a1.cards.length = 0;
  check(sig1(loadFromString(saveToString(a1))) === sig1(a1), "a save brings the bumped skills and the loaded seats back");

  // The road (wanderers.js HC_SMALL): in hardcore a team of one meets armed strangers half as often and only one of
  // them; a pair three quarters as often and never more than two. Three or more, and normal games: as before.
  const { WANDER, smallTeam, sized, hostileCard, rollWanderer } = await import("../src/sim/wanderers.js");
  const H = WANDER.HC_SMALL;
  const roads = {};
  for (const n of [1, 2, 3, 4]) {
    const st = hc(42, { startPeople: n });
    const p = roadTeam(st);
    const sm = smallTeam(st, p);
    check(n <= 2 ? sm === H[n] : sm === null, `${n}: ${sm ? `aggressive share ×${sm.share}, at most ${sm.max}` : "no small-team rule"}`);
    const sizes = [2, 3, 4, 5].map((x) => sized(st, p, x));
    check(n === 1 ? sizes.every((x) => x === 1) : n === 2 ? sizes.every((x) => x === 2) : sizes.every((x, i) => x === Math.max(2, Math.min(i + 2, n + WANDER.HOSTILE_OVER))), `${n}: bands of 2–5 stop it as ${sizes.join("/")}`);
    const c = hostileCard(st, p, 4, {});
    const fc = c.choices.find((x) => x.label === "Fight").fight;
    check(fc.enemy.count === sizes[2] && (n === 1 ? /^A ragged man steps out/.test(c.text) && fc.enemy.name === "the armed stranger" : /ragged people step out/.test(c.text)), `${n}: the hold-up card (${c.text.slice(0, 40)}…)`);
    // Many road rolls on city ground (the most meetings), hour by hour: the share of aggressive ones.
    const city = st.tiles.filter((t) => t.terrain === "city").map((t) => t.id);
    const was = st.wanderers ? { ...st.wanderers.stats } : {};
    for (let i = 0; i < 4000; i++) {
      p.lastWander = null;
      st.hour = 24 * 2 + i; // the dice are hash01 by hour and tile
      rollWanderer(st, p, city[i % city.length]);
      st.cards.length = 0;
    }
    const stats = st.wanderers.stats, met = {};
    for (const k of ["neutral", "hostile", "military"]) met[k] = (stats[`road-${k}`] || 0) - (was[`road-${k}`] || 0);
    roads[n] = met;
  }
  const share = (m) => m.hostile / Math.max(1, m.neutral + m.hostile + m.military);
  const all = (m) => m.neutral + m.hostile + m.military;
  console.log(`  road meetings on city ground by team size (neutral/aggressive/squads): ${Object.entries(roads).map(([n, m]) => `${n}: ${m.neutral}/${m.hostile}/${m.military} (aggressive ${Math.round(share(m) * 100)}%)`).join("; ")}`);
  check(share(roads[1]) < share(roads[2]) && share(roads[2]) < share(roads[3]) && Math.abs(share(roads[3]) - share(roads[4])) < 0.06, "aggressive meetings: fewer alone, fewer for a pair, the same for three and four");
  check(Math.abs(all(roads[1]) - all(roads[3])) / all(roads[3]) < 0.1, `as many people met in all (${all(roads[1])} alone, ${all(roads[3])} for three): the rest are neutrals and squads`);
  // A fight with one stranger works by the numbers.
  const st = hc(42, { startPeople: 1 });
  const p = roadTeam(st);
  st.cards.length = 0;
  hostileCard(st, p, 3, {}).choices.find((x) => x.label === "Fight").resolve(st);
  check(st.cards.some((x) => x.title === "After the fight") || !st.parties.includes(p) || !alive(st).length, "a fight with one armed stranger ends in the usual After the fight card");
  // A normal game is not touched: a team of one there still meets two.
  const nw = createWorld({ seed: 55, factionCount: 7 });
  const q = { id: 999, owner: "player", members: [atBase(nw, hub(nw).id)[0].id] };
  check(smallTeam(nw, q) === null && sized(nw, q, 3) === 2, "a normal game: no small-team rule (someone alone still meets two)");
}

// ---------- saves ----------
section("Saves: hubless, mid-build and after founding; an old save's staging camp");
{
  const st = hc(101);
  st.cards.length = 0;
  for (let i = 0; i < 30; i++) tickHour(st);
  st.cards.length = 0;
  const p0 = roadTeam(st);
  const text = saveToString(st);
  const ld = loadFromString(text);
  const p1 = roadTeam(ld);
  check(JSON.parse(text).meta.mode === "hardcore", "the save list knows it is hardcore");
  check(ld.mode === "hardcore" && firstHubPending(ld) && !!p1 && p1.hcStart && partyTile(p1) === partyTile(p0) && partyMembers(ld, p1).length === partyMembers(st, p0).length, "hubless: the team and the start come back");
  check(JSON.stringify(p1.supplies) === JSON.stringify(p0.supplies), "hubless: its supplies too");
  try { for (let i = 0; i < 24; i++) tickHour(ld); check(true, "the loaded hubless world runs"); } catch (e) { check(false, `the loaded hubless world runs: ${e.message}`); }
  // Mid-build: save, load, and both worlds finish the camp the same way.
  const p = roadTeam(ld);
  ld.cards.length = 0;
  ld.noWanderers = true;
  if (p) {
    if (p.phase !== "waiting") { p.phase = "waiting"; p.task = null; p.path = [partyTile(p)]; p.idx = 0; }
    Object.assign(p.cargo.supplies, { scrap: 40, parts: 5, water: 35, buildmat: 4, wood: 500 }); setFood(p.cargo, 30); // wood: the step up's 200 and the fire's
    establishNow(ld, p);
  }
  const jobOf = (w) => { const c = campOf(w); return c ? tierUpJob(c) : null; };
  for (let i = 0; i < 60 && jobOf(ld) && jobOf(ld).progress < jobOf(ld).hours * 0.3; i++) { tickHour(ld); ld.cards.length = 0; }
  if (campOf(ld)) campOf(ld).fire = false; // the fire state comes back too
  ld.cards.length = 0;
  const mid = loadFromString(saveToString(ld));
  const c0 = campOf(ld), c1 = campOf(mid);
  check(!!c0 && !!c1 && c1.tile === c0.tile && c1.camp === true && c1.tier === 0 && JSON.stringify(c1.stock) === JSON.stringify(c0.stock) && JSON.stringify(tierUpJob(c1)) === JSON.stringify(tierUpJob(c0)),
    `mid-build: the camp comes back (${c0 && tierUpJob(c0) ? Math.round((tierUpJob(c0).progress / tierUpJob(c0).hours) * 100) : "-"}% built, its stores and its step up's materials)`);
  check(!!c1 && c1.fire === false && atBase(mid, c1.id).length === atBase(ld, c0.id).length, "mid-build: its fire (out) and its people come back");
  const finish = (w) => { for (let i = 0; i < 24 * 8 && campOf(w); i++) { tickHour(w); w.cards.length = 0; } return hub(w); };
  const h = finish(ld), hm = finish(mid);
  check(!!h && !!hm && !h.camp && !hm.camp && h.name === hm.name && ld.hardcore.start.foundedHour === mid.hardcore.start.foundedHour, `the loaded world finishes the camp as the original does (${h && h.name}, hour ${ld.hardcore.start.foundedHour} / ${mid.hardcore.start.foundedHour})`);
  if (h) h.fire = false;
  ld.cards.length = 0;
  const l2 = loadFromString(saveToString(ld));
  check(!!hub(l2) && isShelter(hub(l2)) && hub(l2).fire === false && tierName(hub(l2)) === "Shelter", "after founding: the shelter (tier 0) and its fire (out) come back");
  check(!!h && hub(l2) && hub(l2).name === h.name && !firstHubPending(l2) && l2.staging === undefined && l2.hardcore.start.foundedDay === ld.hardcore.start.foundedDay && l2.mode === "hardcore", "after founding: the hub and the founding day come back");
  // A save from before camps were bases (state.staging, the team working there): it loads as the camp base that is your
  // hub, its stores its stock, its work the step up's progress, the team moved in.
  {
    const old = hc(404);
    old.noWanderers = true;
    const q = roadTeam(old);
    const tile = partyTile(q);
    old.cards.length = 0;
    old.staging = { id: 999999, tile, started: 1, startedHour: 0, needs: { scrap: 20, buildmat: 2 }, work: 20, progress: 5, stores: { scrap: 14, parts: 1, buildmat: 2, food: 12, preserved: 0, water: 9, rawwater: 3 }, first: true, lastPresent: old.hour, lastWorked: null, workers: 3, looted: 0, name: null, to: 0, fire: false };
    const back = loadFromString(saveToString(old)); // the old field written as it was; the load migrates it
    const bc = campOf(back);
    const bj = bc && tierUpJob(bc);
    check(!!bc && back.staging === undefined && bc.tile === tile && hub(back) === bc && bc.fire === false, `an old save's staging camp loads as the camp base that is your hub (${bc ? bc.name : "none"})`);
    check(bj && bj.type === "camp_up" && bj.paid.scrap === 14 && bj.paid.buildmat === 2 && Math.abs(bj.progress - 5) < 1e-9 && food(bc) >= 12 && bc.stock.rawwater >= 3, `its stores are the stock, the scrap and building materials and the work the step up's (${bj && JSON.stringify(bj.paid)}, ${bj && bj.progress}h)`);
    check(atBase(back, bc.id).length === partyMembers(old, q).length && !back.parties.some((x) => x.owner === "player"), "the team on its tile moved in");
    bc.stock.scrap = (bc.stock.scrap || 0) + 10; // the rest of its scrap brought in
    const hb = finish(back);
    check(!!hb && !hb.camp && isShelter(hb), "and is built up into the shelter");
  }
  check(createWorld({ seed: 9, factionCount: 7 }).mode === "normal" && loadFromString(saveToString(createWorld({ seed: 9, factionCount: 7 }))).mode === "normal", "a normal save stays normal");
}

// ---------- the autopilot ----------
section(`Autopilot: a hubless start sets up a camp, builds it up into the shelter and on toward a base (${apGames} games, ${apDays} days)`);
{
  const res = [];
  for (let i = 0; i < apGames; i++) {
    const st = hc(9000 + i * 13);
    st.started = true;
    setAutopilot(st, true, "balanced");
    let pitched = null, trips = 0, lastIn = 0, up = null, wet = null, thirst = 0, snared = null;
    try {
      while (day(st) <= apDays && !st.gameOver) {
        tickHour(st);
        const c = campOf(st);
        if (c && c.type === "hub" && pitched == null) { pitched = day(st); wet = !!waterSource(st, c.tile, 1); }
        if (c && c.type === "hub") { const j = tierUpJob(c); const s = (c.stock.scrap || 0) + (c.stock.buildmat || 0) + (j ? (j.paid.scrap || 0) + (j.paid.buildmat || 0) : 0); if (s > lastIn) trips++; lastIn = s; }
        if (up == null && hub(st) && !isShelter(hub(st))) up = day(st);
        if (snared == null && st.fieldworks && st.fieldworks.list.some((x) => x.kind === "snares" && x.owner === "player")) snared = day(st); // hc-food: the field-craft snare line
      }
    } catch (e) { check(false, `autopilot game ${i}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); }
    thirst = st.log.filter((l) => l.kind === "death" && /thirst|dehydrat/i.test(l.text)).length;
    res.push({ pitched, trips, founded: st.hardcore.start.foundedDay, up, wet, thirst, alive: alive(st).length, hub: hub(st), snared });
  }
  const founded = res.filter((r) => r.founded != null && r.founded <= 28).length;
  const living = res.filter((r) => r.alive > 0).length;
  const med = (a) => { a = a.filter((x) => x != null).sort((x, y) => x - y); return a.length ? a[a.length >> 1] : "-"; };
  console.log(`  camp set up on days ${res.map((r) => r.pitched ?? "-").join(", ")}; beside water ${res.filter((r) => r.wet).length}/${apGames}; deliveries ${res.map((r) => r.trips).join(", ")}`);
  console.log(`  shelter within 4 weeks: ${founded}/${apGames} (days ${res.map((r) => r.founded ?? "-").join(", ")}; median ${med(res.map((r) => r.founded))}); built up into a base: ${res.filter((r) => r.up != null).length}/${apGames} (days ${res.map((r) => r.up ?? "-").join(", ")}; median ${med(res.map((r) => r.up))})`);
  console.log(`  alive at day ${apDays}: ${living}/${apGames}; deaths from thirst ${res.reduce((a, r) => a + r.thirst, 0)}`);
  console.log(`  a snare line set (field craft, hc-food) on days ${res.map((r) => r.snared ?? "-").join(", ")}`);
  check(res.filter((r) => r.pitched != null && r.snared != null).length >= Math.ceil(res.filter((r) => r.pitched != null).length * 0.5), "most camps set a snare line (2 scrap, an hour: the governor's field craft in hardcore)");
  check(res.every((r) => r.pitched != null), "every game sets up a camp");
  check(res.filter((r) => r.wet).length >= Math.ceil(apGames * 0.6), "most camps go up beside a river or lake (no spring)");
  check(founded >= Math.ceil(apGames * 0.6), "most games found a shelter within four weeks");
  check(apDays < 30 || res.filter((r) => r.up != null).length >= 1, "some build it up into a base within the run (100 scrap, 5 building materials; a quarter of the games before 2026-10-24, when the camp had a cleared yard: the tile's own trees now wait to be felled for the sites)");
  check(living >= Math.ceil(apGames * 0.5), "most games are alive at the end");
  check(res.filter((r) => r.hub).every((r) => r.hub.type === "hub"), "what they found is a hub (a camp, then a shelter)");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
