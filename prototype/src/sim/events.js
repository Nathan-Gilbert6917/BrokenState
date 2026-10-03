// Travel events: choice cards rolled per tile, and the escort table for trade-route convoys.
import { TERRAIN, GEAR, LOCATIONS } from "./data.js";
import { log, hub, skill, hurt, isNight, factionById, snapshot, makeSurvivor, newId, day, combatPower } from "./world.js";
import {
  partyMembers, bestSkill, partyTile, STANCES, tileLabel, partyCapacity, cargoLoad, unitsThatFit, partySpeed,
  carried, takeSupply, addGearToCargo, leaveVehicle, startReturn, wipeIfEmpty, cardStale,
} from "./parties.js";
import { partyFuel, useFuel, partyVehicle, breakdownChance } from "./vehicles.js";
import { attitude, changeGoodwill, isAggressiveType } from "./factions.js";
import { rollConflict } from "./conflicts.js";

// ---------- helpers ----------
function check(state, p, key, dc) {
  const s = bestSkill(state, p, key);
  const chance = Math.max(0.05, Math.min(0.95, (s + 10 - dc + 1) / 10));
  return { ok: state.rng.chance(chance), chance, skill: s };
}
const pct = (c) => `${Math.round(c * 100)}%`;
function hint(state, p, key, dc) {
  const s = bestSkill(state, p, key);
  const chance = Math.max(0.05, Math.min(0.95, (s + 10 - dc + 1) / 10));
  return `${key[0].toUpperCase() + key.slice(1)} check, ${pct(chance)}`;
}
function injureRandom(state, p, min, max, cause) {
  const m = partyMembers(state, p);
  if (!m.length) return "";
  const v = state.rng.pick(m);
  hurt(state, v, state.rng.int(min, max), partyTile(p), cause);
  wipeIfEmpty(state, p); // the last one: the team ends as a wiped team (cargo at a death site, vehicle marked)
  return v.alive ? `${v.name.split(" ")[0]} was hurt.` : `${v.name} was killed.`;
}
// A delay in real hours whatever the pace: progress builds up at the stance's speed per hour, so the same
// "4 hours" costs a rushed team 4 hours too (not 3).
function delay(p, hours) {
  p.progress -= hours * partySpeed(p);
}
function addCargo(state, p, key, qty) {
  const room = Math.max(0, partyCapacity(state, p) - cargoLoad(p.cargo));
  const take = Math.min(unitsThatFit(room, key), qty);
  p.cargo.supplies[key] = (p.cargo.supplies[key] || 0) + take;
  return take < qty ? `${take} ${key} (no room for the rest)` : `${take} ${key}`;
}
// A choice that costs carried supplies (packed or found). `disabled` is read from what the team carries each
// time the card is shown, and the cost is checked again and paid when the choice is made: an old card can
// never take stock below zero.
function paid(p, cost, choice) {
  const short = () => Object.entries(cost).find(([k, q]) => carried(p, k) < q);
  const run = choice.resolve;
  return {
    ...choice,
    get disabled() { return !!short(); },
    resolve: (s) => {
      const miss = short();
      if (miss) return `The team no longer has ${miss[1]} ${miss[0]} to spare. Nothing was done.`;
      for (const [k, q] of Object.entries(cost)) takeSupply(p, k, q);
      return run(s);
    },
  };
}
// Same for fuel burned from the tank and the cans (vehicles.js partyFuel).
function burns(state, p, fuel, choice) {
  const run = choice.resolve;
  return {
    ...choice,
    get disabled() { return partyFuel(state, p) < fuel; },
    resolve: (s) => {
      if (partyFuel(s, p) < fuel) return `The team no longer has ${fuel} fuel. Nothing was done.`;
      useFuel(s, p, fuel);
      return run(s);
    },
  };
}
function factionNear(state, tileId, filter, radius = 3) {
  return state.factions.find((f) => f.alive && filter(f) && f.bases.some((b) => state.grid.distance(b, tileId) <= radius));
}

// ---------- event table ----------
const EVENTS = [
  // Hazards
  {
    id: "blocked", weight: 3, when: (st, p, t) => p.vehicle && t.road,
    card: (st, p, t) => ({
      title: "Blocked highway",
      text: `Wrecked cars choke the road near ${tileLabel(st, t.id)}.`,
      choices: [
        { label: "Clear a path (4 hours, noisy)", resolve: (s) => { delay(p, 4); return s.rng.chance(0.3) ? `The noise drew the dead. ${injureRandom(s, p, 10, 30, "clearing a blocked road")}` : "The road is clear."; } },
        burns(st, p, 3, { label: "Detour off-road (costs 3 fuel)", hint: "Burns extra fuel but avoids the noise", resolve: () => "A long detour through the fields." }),
        { label: "Squeeze through", hint: hint(st, p, "mechanics", 8), resolve: (s) => check(s, p, "mechanics", 8).ok ? "The truck scrapes through." : (delay(p, 3), "The truck gets stuck for hours before you free it.") },
      ],
    }),
  },
  // (Vehicle breakdowns are rolled from the vehicle's condition: breakdownCard below.)
  {
    id: "storm", weight: 2, when: () => true,
    card: (st, p) => ({
      title: "Storm",
      text: "A violent storm rolls in.",
      choices: [
        { label: "Shelter and wait (6 hours)", resolve: () => { delay(p, 6); return "You wait it out in a barn."; } },
        { label: "Push through", resolve: (s) => s.rng.chance(0.4) ? `Someone takes a fall. ${injureRandom(s, p, 5, 20, "in a storm")}` : "Soaked, but fine." },
      ],
    }),
  },
  {
    id: "ankle", weight: 1, when: (st, p, t) => !p.vehicle && (t.terrain === "hills" || t.terrain === "forest" || t.terrain === "mountain"),
    card: (st, p) => ({
      title: "Bad footing",
      text: "Loose rock gives way under one of the team.",
      choices: [
        paid(p, { meds: 1 }, { label: "Treat it (1 meds)", resolve: () => { delay(p, 1); return "Wrapped and walking."; } }),
        { label: "Keep moving", resolve: (s) => injureRandom(s, p, 8, 18, "after a fall") },
      ],
    }),
  },
  // Zombies
  {
    id: "pack", weight: 5, when: (st, p, t) => t.infection > 0.2,
    card: (st, p, t) => {
      const n = Math.round(4 + t.infection * 14 + (isNight(st) ? 4 : 0));
      return {
        title: "The dead ahead",
        text: `About ${n} infected shamble across your path${isNight(st) ? " in the dark" : ""}.`,
        choices: [
          { label: "Sneak around", hint: hint(st, p, "stealth", 7 + Math.round(t.infection * 4)), resolve: (s) => check(s, p, "stealth", 7 + Math.round(t.infection * 4)).ok ? (delay(p, 1), "You slip past unseen.") : `They spot you. ${injureRandom(s, p, 10, 30, "fleeing the dead")}` },
          {
            label: "Fight (uses ammo)", hint: "Safe with ammo and shooters, loud", resolve: (s) => {
              const ammo = takeSupply(p, "ammo", n * 2);
              const power = partyMembers(s, p).reduce((a, m) => a + combatPower(m), 0) * (ammo >= n ? 1 : 0.5);
              return power > n * 0.6 ? `Cleared, using ${ammo} ammo.` : `A messy fight. ${injureRandom(s, p, 15, 40, "fighting the dead")}`;
            },
          },
          { label: "Go the long way (3 hours)", resolve: () => { delay(p, 3); return "A safe but slow detour."; } },
        ],
      };
    },
  },
  {
    id: "bitten", weight: 1, when: (st, p, t) => t.infection > 0.4 && partyMembers(st, p).length > 1,
    card: (st, p) => {
      const v = st.rng.pick(partyMembers(st, p));
      return {
        title: "Bitten",
        text: `${v.name} hides a bite on their forearm. It is already turning dark.`,
        survivorIds: [v.id], // the card is dropped if they die or leave the team before it is answered
        choices: [
          paid(p, { meds: 2 }, { label: "Amputate and treat (2 meds)", hint: hint(st, p, "medicine", 10), resolve: (s) => { if (check(s, p, "medicine", 10).ok) { v.health = Math.max(10, v.health - 50); return `${v.name.split(" ")[0]} survives, badly weakened.`; } hurt(s, v, 999, partyTile(p), "after a bite"); wipeIfEmpty(s, p); return `${v.name} did not survive.`; } }),
          { label: "End it quickly", resolve: (s) => { hurt(s, v, 999, partyTile(p), "after a bite, by their own team"); s.survivors.filter((x) => x.alive).forEach((x) => (x.mood = Math.max(0, x.mood - 8))); wipeIfEmpty(s, p); return `The team buries ${v.name}.`; } },
          { label: "Hope it is not infected", resolve: (s) => { if (s.rng.chance(0.75)) { hurt(s, v, 999, partyTile(p), "after turning"); if (wipeIfEmpty(s, p)) return `${v.name} turned in the night.`; return `${v.name} turned in the night. ${injureRandom(s, p, 10, 35, "when a friend turned")}`; } return "Against all odds, the fever breaks."; } },
        ],
      };
    },
  },
  {
    id: "nest", weight: 2, when: (st, p, t) => st.grid.within(t.id, 2).some((id) => st.tiles[id].nest),
    card: (st, p, t) => {
      const nestId = st.grid.within(t.id, 2).find((id) => st.tiles[id].nest);
      return {
        title: "A nest",
        text: "The team finds a nest: a building packed with sleeping dead. Hordes are born here.",
        choices: [
          burns(st, p, 5, { label: "Burn it (5 fuel)", hint: hint(st, p, "stealth", 10), resolve: (s) => { if (check(s, p, "stealth", 10).ok) { s.tiles[nestId].nest = false; log(s, "A nest was destroyed.", "good"); return "The nest burns. Infection here will slowly fade."; } return `It catches, but they wake. ${injureRandom(s, p, 20, 50, "burning a nest")}`; } }),
          { label: "Mark it and move on", resolve: () => "Noted on the map." },
        ],
      };
    },
  },
  // Humans
  {
    id: "traders", weight: 2, when: () => true,
    card: (st, p) => ({
      title: "Stranded traders",
      text: "A pair of traders sit beside a broken cart. Their mule is dead.",
      choices: [
        { label: "Help them (2 hours)", resolve: (s) => { delay(p, 2); const fr = s.factions.find((f) => f.alive && f.type === "traders"); if (fr) changeGoodwill(s, fr, 5, "you helped their people"); return `Grateful, they share: ${addCargo(s, p, "meds", 2)}.`; } },
        paid(p, { food: 10 }, { label: "Trade (10 food for 3 parts)", resolve: (s) => `Traded. ${addCargo(s, p, "parts", 3)}.` }),
        { label: "Rob them", resolve: (s) => { const fr = s.factions.find((f) => f.alive && f.type === "traders"); if (fr) changeGoodwill(s, fr, -12, "you robbed their people"); s.survivors.filter((x) => x.alive).forEach((x) => (x.mood = Math.max(0, x.mood - 4))); return `You take what they have: ${addCargo(s, p, "parts", 3)}, ${addCargo(s, p, "food", 6)}.`; } },
        { label: "Leave them", resolve: () => "You walk on." },
      ],
    }),
  },
  {
    id: "loner", weight: 2, when: () => true,
    card: (st, p) => {
      const s0 = makeSurvivor(st, 0.85);
      return {
        title: "A survivor alone",
        text: `${s0.name} has been living in a hunting stand. They ask to come with you. Strongest skill: ${Object.entries(s0.skills).sort((a, b) => b[1] - a[1])[0].join(" ")}.`,
        choices: [
          { label: "Take them along", resolve: (s) => { s0.location = { kind: "party", partyId: p.id }; s.survivors.push(s0); p.members.push(s0.id); s.stats.peopleSaved += 1; return `${s0.name} joins the team.`; } },
          { label: "Point them toward the hub", resolve: (s) => { if (s.rng.chance(0.6)) { s0.location = { kind: "base", baseId: hub(s).id }; s.survivors.push(s0); s.stats.peopleSaved += 1; return `${s0.name} made it to the hub.`; } return `${s0.name} never arrived.`; } },
          { label: "Leave them", resolve: () => "You move on." },
        ],
      };
    },
  },
  {
    id: "patrol", weight: 3, when: (st, p, t) => typeof t.owner === "number" && attitude(factionById(st, t.owner)) !== "Hostile",
    card: (st, p, t) => {
      const f = factionById(st, t.owner);
      f.known = true;
      return {
        title: `${f.name} patrol`,
        text: `A ${f.name} patrol stops you. They are ${attitude(f).toLowerCase()}, but watchful.`,
        choices: [
          { label: "Share news and move on", resolve: (s) => { changeGoodwill(s, f, 2); f.lastDiplomacy = day(s); for (const b of f.bases) p.seen.set(b, snapshot(s, b)); return `They mark their bases on your map.`; } },
          paid(p, { food: 5 }, { label: "Offer 5 food as a gift", resolve: (s) => { changeGoodwill(s, f, 6, "a gift"); f.lastDiplomacy = day(s); return "They appreciate it."; } }),
        ],
      };
    },
  },
  // Discoveries
  {
    id: "truck", weight: 3, when: (st, p, t) => t.road,
    card: (st, p, t) => ({
      title: "Abandoned supply truck",
      text: "A delivery truck sits on its rims, back door still shut.",
      choices: [
        { label: "Search it (2 hours)", resolve: (s) => { delay(p, 2); const k = s.rng.pick(["food", "fuel", "scrap", "meds", "ammo"]); const q = { food: 12, fuel: 8, scrap: 15, meds: 3, ammo: 30 }[k]; return s.rng.chance(0.2) ? `Something was waiting inside. ${injureRandom(s, p, 10, 30, "searching a truck")}` : `Found ${addCargo(s, p, k, q)}.`; } },
        { label: "Leave it", resolve: () => "Not worth the risk." },
      ],
    }),
  },
  {
    id: "radio", weight: 1, when: () => true,
    card: (st, p) => {
      const f = st.rng.pick(st.factions.filter((f) => f.alive));
      return {
        title: "Radio signal",
        text: "A looping broadcast on an old scanner gives directions to a settlement.",
        choices: [{ label: "Note it", resolve: (s) => { if (!f) return "Static."; for (const b of f.bases) p.seen.set(b, snapshot(s, b)); return `The team notes where ${f.name} is. It goes on the map when they return.`; } }],
      };
    },
  },
  {
    id: "military", weight: 1, when: (st, p, t) => t.infection > 0.3,
    card: (st, p) => ({
      title: "Crashed military vehicle",
      text: "A Humvee lies on its side in a ditch. Bodies in uniform still sit inside, and the dead are thick around it.",
      choices: [
        {
          label: "Search it", hint: hint(st, p, "stealth", 11), resolve: (s) => {
            const ok = check(s, p, "stealth", 11).ok;
            const g = s.rng.pick(["ar", "plate", "nvg", "milradio"]);
            // The find needs carry space like anything else; with none it stays in the wreck.
            const fits = addGearToCargo(s, p, { key: g, name: GEAR[g].name, quality: 1 });
            const found = fits ? GEAR[g].name : `${GEAR[g].name} (no room to carry it: left there)`;
            return ok ? `Found: ${found}, ${addCargo(s, p, "ammo", 30)}.` : `Found ${found}, but ${injureRandom(s, p, 20, 50, "at a crashed Humvee")}`;
          },
        },
        { label: "Leave it", resolve: () => "Too many of them." },
      ],
    }),
  },
  {
    id: "cache", weight: 2, when: (st, p, t) => t.terrain === "forest" || t.terrain === "hills",
    card: (st, p) => ({
      title: "Prepper cache",
      text: "A hidden hatch under leaves. Someone planned for this.",
      choices: [{ label: "Open it", resolve: (s) => `Inside: ${addCargo(s, p, "food", 8)}, ${addCargo(s, p, "meds", 2)}, ${addCargo(s, p, "ammo", 20)}.` }],
    }),
  },
  // Crew
  {
    id: "argument", weight: 2, when: (st, p) => partyMembers(st, p).length >= 2,
    card: (st, p) => {
      const [a, b] = st.rng.shuffle([...partyMembers(st, p)]);
      return {
        title: "Tempers flare",
        text: `${a.name.split(" ")[0]} and ${b.name.split(" ")[0]} are at each other's throats over rations.`,
        survivorIds: [a.id, b.id],
        choices: [
          { label: "Step in", hint: hint(st, p, "leadership", 7), resolve: (s) => check(s, p, "leadership", 7).ok ? "Calm returns." : (sulk(a, 10), sulk(b, 10), "It ends badly. Both are sulking.") },
          { label: "Let them sort it out", resolve: (s) => { if (s.rng.chance(0.3)) { hurt(s, b, 10, partyTile(p), "in a fight"); wipeIfEmpty(s, p); return "Punches are thrown."; } return "It blows over."; } },
        ],
      };
    },
  },
  {
    id: "coward", weight: 2, when: (st, p) => partyMembers(st, p).some((m) => m.traits.includes("coward")) && p.phase === "out",
    card: (st, p) => {
      const c = partyMembers(st, p).find((m) => m.traits.includes("coward"));
      const alone = partyMembers(st, p).length === 1;
      return {
        title: "Cold feet",
        text: `${c.name} wants to turn back. "We are going to die out here."`,
        survivorIds: [c.id],
        choices: [
          { label: "Convince them", hint: hint(st, p, "leadership", 8), resolve: (s) => check(s, p, "leadership", 8).ok ? "They steady themselves." : (sulk(c, 15), "They come, but they are shaking.") },
          {
            label: alone ? "Turn back for home" : "Let them go home alone",
            hint: alone ? "They are the whole team: it turns around with everything it carries" : "The rest of the team goes on without them",
            resolve: (s) => {
              // The only one out here: going home means the whole team turns around (vehicle, supplies and cargo
              // go back with them; a team is never left with nobody in it).
              if (partyMembers(s, p).length <= 1) {
                const why = startReturn(s, p);
                return why ? `${c.name} wants to go home, but cannot. ${why}` : `${c.name} turns around and heads for home.`;
              }
              p.members = p.members.filter((id) => id !== c.id);
              if (s.rng.chance(0.7)) { c.location = { kind: "base", baseId: hub(s).id }; return `${c.name} made it home.`; }
              hurt(s, c, 999, partyTile(p), "walking home alone");
              return `${c.name} never made it home.`;
            },
          },
        ],
      };
    },
  },
];
// Mood never drops below zero.
function sulk(s, by) {
  s.mood = Math.max(0, (s.mood || 0) - by);
}

export function rollTravelEvent(state, p, tileId) {
  const t = state.tiles[tileId];
  // A horde on the tile always forces an encounter.
  const horde = state.hordes.find((h) => h.tile === tileId);
  if (horde) return guarded(state, p, hordeCard(state, p, horde), tileId);
  // Worn vehicles break down more often.
  const v = p.vehicle ? partyVehicle(state, p) : null;
  if (v && state.rng.chance(breakdownChance(v))) return guarded(state, p, breakdownCard(state, p, v), tileId);
  const owner = typeof t.owner === "number" ? factionById(state, t.owner) : null;
  let chance = 0.05 + t.infection * 0.1 + TERRAIN[t.terrain].traffic * 0.4 + (owner && attitude(owner) === "Hostile" ? 0.12 : 0) + (owner && attitude(owner) !== "Hostile" ? 0.06 : 0);
  chance *= STANCES[p.stance].events * (isNight(state) ? 1.2 : 1);
  if (state.bases.some((b) => b.tile === tileId)) return null;
  // Conflicts with other people (or a surge of the dead): see conflicts.js. Roadblocks and ambushes live there.
  const conflict = rollConflict(state, p, tileId);
  if (conflict) return conflict;
  if (!state.rng.chance(chance)) return null;
  const options = EVENTS.filter((e) => e.when(state, p, t));
  if (!options.length) return null;
  const ev = state.rng.weighted(options, (e) => e.weight);
  return guarded(state, p, ev.card(state, p, t), tileId);
}

// Every travel card belongs to its team: it is dropped when the team is gone or the person it is about has
// died or left (parties.js cardStale, pruneCards), and if it is answered anyway its choices do nothing.
function guarded(state, p, card, tileId) {
  card.where = tileLabel(state, tileId);
  card.partyId = p.id;
  for (const c of card.choices) {
    const run = c.resolve; // set on the choice itself (not a copy), so a live `disabled` getter stays live
    c.resolve = (s) => (cardStale(s, card) ? "Too late: the team is no longer there." : run(s));
  }
  return card;
}

function breakdownCard(state, p, v) {
  // The card can be answered after the vehicle was left behind (a second breakdown card the same hour).
  const here = (s) => p.vehicle && partyVehicle(s, p) === v;
  const gone = `The ${v.name} is no longer with the team.`;
  return {
    title: "Breakdown",
    text: `The ${v.name} coughs and dies. Condition ${Math.round(v.condition)}%, fuel ${Math.round(v.fuel)}.`,
    partyId: p.id,
    choices: [
      { label: "Repair it on the spot", hint: `${hint(state, p, "mechanics", 9)}. Success: 2 hours. Failure: 8 hours and more wear`, resolve: (s) => !here(s) ? gone : check(s, p, "mechanics", 9).ok ? (delay(p, 2), "Fixed in two hours.") : (delay(p, 8), (v.condition = Math.max(1, v.condition - 10)), "It takes most of the day to get it running, and it is worse for wear.") },
      {
        label: "Use a spare part", hint: "1 part: quick fix, +10 condition",
        get disabled() { return carried(p, "parts") < 1; }, // what the team carries now, not when the card was made
        resolve: (s) => {
          if (!here(s)) return gone;
          if (carried(p, "parts") < 1) return "No spare part left. Nothing was done.";
          takeSupply(p, "parts", 1);
          v.condition = Math.min(100, v.condition + 10);
          delay(p, 1);
          return "Back on the road quickly.";
        },
      },
      {
        label: "Abandon it", hint: "Leave it here (it is marked on the map) and continue on foot. Cargo the team cannot carry stays in it", resolve: (s) => {
          if (!here(s)) return gone;
          const left = leaveVehicle(s, p, partyTile(p), "broke down");
          return `The ${v.name} is left by the road. The team walks on.${left ? ` Left in it: ${left}.` : ""}`;
        },
      },
    ],
  };
}

function hordeCard(state, p, horde) {
  const drive = () => p.vehicle && partyFuel(state, p) >= 4; // a vehicle needs fuel in it to outrun anything
  return {
    title: `Horde of ${horde.size}`,
    text: `A horde of about ${horde.size} is moving across ${tileLabel(state, horde.tile)}, right in your path.`,
    partyId: p.id,
    choices: [
      { label: "Hide and let it pass (6 hours)", hint: hint(state, p, "stealth", 6 + Math.round(horde.size / 25)), resolve: (s) => { delay(p, 6); return check(s, p, "stealth", 6 + Math.round(horde.size / 25)).ok ? "The horde passes by." : `Something gives you away. ${injureRandom(s, p, 20, 60, "hiding from a horde")}`; } },
      {
        label: "Outrun it",
        get hint() { return drive() ? "By vehicle: safe, uses 4 fuel" : p.vehicle ? "Less than 4 fuel: the vehicle cannot outrun it. On foot: risky" : "On foot: risky"; },
        resolve: (s) => {
          if (drive()) { useFuel(s, p, 4); return "The vehicle tears through and away."; }
          const dry = p.vehicle ? "The tank is all but dry, so the team runs for it on foot and comes back for the vehicle after. " : "";
          return s.rng.chance(0.5) ? `${dry}You run until your lungs burn, and make it.` : `${dry}Not everyone is fast enough. ${injureRandom(s, p, 30, 80, "running from a horde")}`;
        },
      },
      {
        label: "Fight", hint: "Very dangerous", resolve: (s) => {
          const power = partyMembers(s, p).reduce((a, m) => a + combatPower(m), 0);
          horde.size = Math.max(0, horde.size - Math.round(power * 2));
          // Too few left to be a horde: it is gone from the map.
          if (horde.size < 5 && s.hordes.includes(horde)) s.hordes.splice(s.hordes.indexOf(horde), 1);
          takeSupply(p, "ammo", 40);
          const first = injureRandom(s, p, 30, 80, "fighting a horde");
          return `${first} ${injureRandom(s, p, 20, 60, "fighting a horde")}`.trim();
        },
      },
    ],
  };
}

// ---------- trade-route convoys: escort table from the design doc ----------
const ESCORT_MULT = {
  light:    { zombie: 0.6, small: 1.5, large: 1.0 },
  standard: { zombie: 1.0, small: 1.0, large: 1.0 },
  heavy:    { zombie: 1.5, small: 0.4, large: 1.6 },
};

export function convoyLegEvent(state, p, tileId) {
  // Supply runs between your own bases use the same table: the escort tier comes from the crew size
  // and their stance scales how often something happens.
  const supply = p.routeKind === "supply";
  const route = supply ? null : state.routes.find((r) => r.id === p.routeId);
  const escort = supply ? p.escort : route && route.escort;
  if (!ESCORT_MULT[escort]) return;
  const m = ESCORT_MULT[escort];
  const sm = supply ? STANCES[p.stance]?.events ?? 1 : 1;
  const t = state.tiles[tileId];
  const rng = state.rng;
  const members = partyMembers(state, p);
  const power = members.reduce((a, s) => a + combatPower(s), 0) + (p.supplies.ammo > 10 ? 2 : 0);
  const where = tileLabel(state, tileId);
  if (rng.chance((0.02 + t.infection * 0.05) * m.zombie * sm)) {
    if (power > 6 + t.infection * 8) log(state, `Convoy fought off the dead near ${where}.`, "info");
    else {
      log(state, `The dead swarmed the convoy near ${where}. ${injureRandom(state, p, 15, 50, "defending the convoy")}`, "danger");
    }
    p.supplies.ammo = Math.max(0, (p.supplies.ammo || 0) - 6);
    return;
  }
  const hostileNear = factionNear(state, tileId, (f) => attitude(f) === "Hostile", 4);
  if (rng.chance((0.02 + (hostileNear ? 0.03 : 0)) * m.small * sm)) {
    if (power >= 8) log(state, `Small-time raiders eyed the convoy near ${where} and backed off.`, "info");
    else {
      for (const k of Object.keys(p.cargo.supplies)) p.cargo.supplies[k] = Math.floor(p.cargo.supplies[k] * 0.7);
      log(state, `Raiders hit the convoy near ${where} and took part of the cargo.`, "danger");
    }
    return;
  }
  const aggressive = factionNear(state, tileId, (f) => isAggressiveType(f) && attitude(f) === "Hostile", 5);
  if (aggressive && rng.chance(0.03 * m.large * sm)) {
    const att = aggressive.pop * 0.3;
    if (power > att) log(state, `${aggressive.name} sent a war party against the convoy near ${where}. The escort held.`, "good");
    else {
      for (const k of Object.keys(p.cargo.supplies)) p.cargo.supplies[k] = 0;
      log(state, `${aggressive.name} ambushed the convoy near ${where} with a large force. Cargo lost. ${injureRandom(state, p, 30, 80, `when ${aggressive.name} hit the convoy`)} ${injureRandom(state, p, 20, 70, `when ${aggressive.name} hit the convoy`)}`, "death");
    }
  }
}

