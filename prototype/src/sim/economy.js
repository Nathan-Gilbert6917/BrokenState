// Daily economy for every base (hub and outposts share the same rules), supply lines,
// trade routes and death-site looting.
import { TERRAIN, LOCATIONS, SUPPLIES } from "./data.js";
import {
  log, addCard, day, hub, atBase, alive, skill, hurt, survivorById, factionById, makeSurvivor,
} from "./world.js";
import { planPath, dispatchConvoy } from "./parties.js";
import { attitude } from "./factions.js";
import { farmSlots, baseBeds, runStations, assignStations } from "./buildings.js";
import { supplyReserve } from "./supply.js";
import { medicalDaily, fieldInfectionDaily } from "./medical.js";
import { toolBonus } from "./crafting.js";

export const ROLES = {
  farm:     { name: "Farm",     desc: "Grows food on the farm plots. Each plot fits 2 farmers at full output; extras work at 30%." },
  scavenge: { name: "Scavenge", desc: "Searches the ruins around this base. What they find depends on the site (a gas station gives fuel, a hospital meds)." },
  operate:  { name: "Operate",  desc: "Runs a workshop station (ammo, meds or parts). Loud: raises Heat." },
  build:    { name: "Build",    desc: "Works on the construction queue. More builders finish faster; Mechanics helps." },
  guard:    { name: "Guard",    desc: "Defends the base. Guards count 1.5× in fights." },
  rest:     { name: "Rest",     desc: "Recovers mood. Injured people heal either way." },
  medic:    { name: "Medic",    desc: "Staffs the infirmary or hospital (each tier needs 1–3 medics to run; unstaffed it works like no hospital). The best medic's Medicine speeds up healing for patients in beds; with no medic only slow natural healing and weak meds. Medics are never admitted as patients." },
  craft:    { name: "Craft",    desc: "Makes makeshift gear and supplies by hand from the craft queue (base Crafting tab). No station needed; Mechanics (or Medicine for kits) sets what they can make and how fast." },
};

// Farming and scavenging bonuses from where the base sits.
export function siteBonus(state, base) {
  const t = state.tiles[base.tile];
  const loc = t.loc ? t.loc.type : null;
  return {
    farm: loc === "farm" || t.terrain === "plains" ? 1.3 : t.terrain === "forest" ? 0.8 : t.terrain === "hills" ? 0.7 : 1,
    scav: loc ? 1.2 : t.terrain === "city" || t.terrain === "suburb" ? 1.2 : 0.8,
    table: loc ? LOCATIONS[loc].loot : { scrap: 3, food: 1 },
  };
}

export function farmOutput(state, base) {
  const farmers = atBase(state, base.id).filter((s) => s.role === "farm" && !s.inBed); // patients in a bed do not work
  const slots = farmSlots(base);
  const bonus = siteBonus(state, base).farm;
  return farmers.reduce((sum, s, i) => sum + (2.2 + skill(s, "farming") * 0.12) * bonus * (i < slots ? 1 : 0.3), 0);
}

export function scavengeOutput(state, base) {
  const people = atBase(state, base.id).filter((s) => s.role === "scavenge" && !s.inBed);
  const b = siteBonus(state, base);
  const total = people.reduce((sum, s) => sum + (2 + (skill(s, "scavenging") + toolBonus(s, "scavenging")) * 0.2) * b.scav, 0);
  // 60% scrap, the rest split by what the site holds.
  const out = { scrap: total * 0.6 };
  const keys = Object.keys(b.table).filter((k) => k !== "scrap");
  const w = keys.reduce((a, k) => a + b.table[k], 0) || 1;
  for (const k of keys) out[k] = (out[k] || 0) + (total * 0.4 * b.table[k]) / w / Math.max(1, SUPPLIES[k].value / 2) * (k === "ammo" ? 4 : 1);
  return out;
}

export function foodForecast(state, base) {
  return farmOutput(state, base) - atBase(state, base.id).length;
}

export function basesDaily(state) {
  for (const base of [...state.bases]) baseDaily(state, base);
  fieldInfectionDaily(state);
  shipFromOutposts(state);
  maybeStranger(state);
}

function baseDaily(state, base) {
  const rng = state.rng;
  const people = atBase(state, base.id);
  const st = base.stock;
  if (base.type === "hub") st.water = Math.min(80, (st.water || 0) + 14); // the well
  for (const s of people) if (s.role === "work") s.role = "scavenge";

  st.food += farmOutput(state, base);
  for (const [k, v] of Object.entries(scavengeOutput(state, base))) st[k] = (st[k] || 0) + v;
  for (const s of people) {
    if (s.role === "scavenge" && !s.inBed && rng.chance(0.04)) hurt(state, s, rng.int(10, 25), base.tile, `scavenging near ${base.name}`);
    if (s.role === "rest" || s.inBed) s.mood = Math.min(100, s.mood + (s.inBed ? 3 : 6));
  }
  assignStations(state, base);
  runStations(state, base);

  // Eating.
  st.food -= people.length;
  if (st.food < 0 && base.type === "hub") {
    st.food = 0;
    for (const s of people) {
      s.mood = Math.max(0, s.mood - 10);
      hurt(state, s, 6, base.tile, `of hunger at ${base.name}`);
    }
    log(state, `${base.name} is out of food.`, "danger");
  } else if (st.food >= 0) {
    for (const s of people) s.mood = Math.min(100, s.mood + 1);
  }
  // Beds.
  const crowd = people.length - baseBeds(base);
  for (const s of people) s.mood = Math.max(0, Math.min(100, s.mood + (crowd > 0 ? -3 : 1)));
  // Healing: passive healing runs hourly (medical.js); here the daily meds use and infected wounds.
  medicalDaily(state, base);
  // A leader at the base lifts morale.
  const leader = people.find((s) => s.leader);
  if (leader) for (const s of people) s.mood = Math.min(100, s.mood + skill(leader, "leadership") * 0.15);
  // Desertion when morale collapses.
  for (const s of people) {
    if (s.alive && !s.leader && s.mood < 15 && rng.chance(0.08)) {
      s.alive = false;
      s.left = true;
      log(state, `${s.name} lost hope and walked away from ${base.name} in the night.`, "death");
    }
  }
  for (const k of Object.keys(st)) st[k] = Math.round(st[k] * 10) / 10;
}

function maybeStranger(state) {
  const h = hub(state);
  if (!state.rng.chance(0.06)) return;
  const s = makeSurvivor(state, 0.85);
  const best = Object.entries(s.skills).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${v}`).join(", ");
  addCard(state, {
    title: "A stranger at the gate",
    text: `${s.name} has been surviving alone and asks to join ${h.name}. Best skills: ${best}. Trait: ${s.traits.join(", ")}.`,
    choices: [
      { label: "Let them in (costs 5 food now)", hint: "One more mouth to feed, one more pair of hands", resolve: (st2) => { s.location = { kind: "base", baseId: h.id }; st2.survivors.push(s); hub(st2).stock.food -= 5; st2.stats.peopleSaved += 1; return `${s.name} joined.`; } },
      { label: "Turn them away", hint: "No cost", resolve: () => `${s.name} walks on.` },
    ],
  });
}

// ---------- outposts and supply lines ----------
export function supplyLine(state, base) {
  const h = hub(state);
  const res = planPath(state, base.tile, h.tile, true) || planPath(state, base.tile, h.tile, false);
  if (!res) return { hours: Infinity, strength: 0, path: [] };
  let strength = Math.max(0.25, Math.min(1, 1 - res.cost / 40));
  const hostile = res.path.some((id) => {
    const o = state.tiles[id].owner;
    return typeof o === "number" && attitude(factionById(state, o)) === "Hostile";
  });
  const horde = res.path.some((id) => state.hordes.some((hh) => state.grid.distance(hh.tile, id) <= 1));
  if (hostile) strength *= 0.7;
  if (horde) strength *= 0.7;
  return { hours: Math.round(res.cost), strength, path: res.path, hostile, horde };
}

function shipFromOutposts(state) {
  const h = hub(state);
  for (const base of state.bases) {
    if (base.type !== "outpost") continue;
    const staff = atBase(state, base.id);
    const line = supplyLine(state, base);
    base.supplyLine = { hours: line.hours, strength: line.strength, hostile: line.hostile, horde: line.horde };
    if (base.stock.food < 0) {
      // The hub sends food, but the supply line loses some on the way.
      const need = -base.stock.food;
      const send = Math.min(h.stock.food, need / line.strength);
      h.stock.food -= send;
      base.stock.food += send * line.strength;
      if (base.stock.food < 0) {
        base.stock.food = 0;
        for (const s of staff) hurt(state, s, 5, base.tile, `of hunger at ${base.name}`);
      }
    }
    // Ship surplus to the hub, keeping a reserve (and anything a construction job could need).
    const keep = { food: staff.length * 3, ammo: staff.length * 6, scrap: base.construction.length ? 30 : 5, parts: base.construction.length ? 3 : 0, fuel: 10, meds: 2 };
    // Supply runs: keep what a run from here will send, and what a run to here will pick up.
    for (const [k, v] of Object.entries(supplyReserve(state, base))) keep[k] = (keep[k] || 0) + v;
    for (const k of Object.keys(base.stock)) {
      const surplus = base.stock[k] - (keep[k] || 0);
      if (surplus > 1) {
        base.stock[k] -= surplus;
        h.stock[k] = (h.stock[k] || 0) + surplus * line.strength;
      }
    }
    for (const k of Object.keys(base.stock)) base.stock[k] = Math.max(0, Math.round(base.stock[k] * 10) / 10);
  }
}

// ---------- trade routes ----------
export const ESCORTS = {
  light:    { name: "Light",    people: 1, desc: "Quiet: fewer zombie events, but raiders see an easy target" },
  standard: { name: "Standard", people: 3, desc: "Balanced" },
  heavy:    { name: "Heavy",    people: 5, desc: "Loud: deters small raids, draws zombies and big raids near aggressive groups" },
};

export function routesDaily(state) {
  const d = day(state);
  for (const r of state.routes) {
    if (!r.active) continue;
    const f = factionById(state, r.factionId);
    if (!f || !f.alive) {
      r.active = false;
      releaseEscorts(state, r);
      log(state, "A trade route ended: the partner group is gone.", "danger");
      continue;
    }
    const out = state.parties.some((p) => p.routeId === r.id);
    if (!out && d >= r.nextDay) {
      dispatchConvoy(state, r);
      r.nextDay = d + r.interval;
    }
  }
}

export function releaseEscorts(state, r) {
  for (const id of r.escortIds) {
    const s = survivorById(state, id);
    if (s && s.alive && s.location.kind === "route") s.location = { kind: "base", baseId: hub(state).id };
  }
}

// ---------- death sites ----------
export function deathSitesDaily(state) {
  const rng = state.rng;
  const d = day(state);
  for (const site of [...state.deathSites]) {
    const t = state.tiles[site.tile];
    let traffic = TERRAIN[t.terrain].traffic || 0.02;
    if (t.road) traffic += 0.2;
    if (typeof t.owner === "number") traffic += 0.2;
    if (t.loc && (t.loc.type === "town" || t.loc.type === "city")) traffic += 0.1;
    const age = d - site.day;
    const chance = Math.min(0.9, traffic * (1 + age / 8) + 0.02);
    if (!rng.chance(chance) || !site.items.length) continue;
    // Scavengers take the most valuable item first.
    site.items.sort((a, b) => b.value - a.value);
    const taken = site.items.shift();
    if (taken.kind === "gear") {
      const f = state.factions.filter((f) => f.alive).sort((a, b) =>
        Math.min(...a.bases.map((x) => state.grid.distance(x, site.tile))) - Math.min(...b.bases.map((x) => state.grid.distance(x, site.tile))))[0];
      if (f) f.lootedGear.push(taken.name);
    }
    if (state.live.has(site.tile)) log(state, `Someone looted ${taken.name} from the bodies at ${t.loc ? t.loc.name : "the death site"}.`, "danger");
    if (!site.items.length) state.deathSites.splice(state.deathSites.indexOf(site), 1);
  }
}

export { alive };
