// Hub events: decisions for the days at home. About one card every 3–5 days at a mid-size hub (10 people), fewer at
// a tiny one: a daily chance of 4% + 2.6% per person at the hub (8% to 40%), up to 30% more when the hub is
// overcrowded, never on two days running and never while another hub event is waiting. Which event comes is weighted
// by season, weather (weather.js), crowding and mood (morale.js) and the size of the hub. Every choice changes
// something real, and the card says what. The autopilot scores each choice with its `ai` function.
//
// Events: a fire in a building, a quarrel between two survivors, a peddler at the gate, a lost teenager (a recruit
// card, recruits.js), a wandering preacher, food stolen from the stores, a stray dog, storm damage (a leaking roof
// over the stores, a broken well pump), a request for a feast, someone asking to leave on a personal errand, two
// survivors who have grown close (partners, relations.js), remembering the dead (a memorial service), rats in the food
// stores, the dead at the fence, a sick traveller at the gate, a cold snap in winter, music by the fire at night and a
// wreck below the walls to strip. Hardcore's first year adds hungry people at the gate, a deserter from the Guard, the
// emergency broadcast going quiet (once) and refugees from the city where the outbreak began.
import { foodIn, payFood, takeFood, addFood, addFoodUnits, gainGoods, foodText } from "./foods.js"; // the cards' food in days (a feast, scraps, a theft)
import { BUILDINGS, BEDS, count, assignStations } from "./buildings.js";
import { SUPPLIES, supValue } from "./data.js";
import { log, addCard, day, hub, baseById, atBase, residents, skill, hurt, killSurvivor, checkGameOver, factionById } from "./world.js";
import { weatherOnDay, season } from "./weather.js";
import { crowdInfo, talker } from "./morale.js";
import { talkXp } from "./skills.js";
import { quarrelBoost, quarrelPair, coupleBoost, couplePair, makePartners, relEvent, memorialWeight, memorialCard } from "./relations.js";
import { makeCandidate, recruitCard } from "./recruits.js";
import { foodOutlook } from "./economy.js";
import { allItems, newItem, START_DUR } from "./inventory.js";
import { breakCard, fixtures, breakdownsDaily } from "./breakdowns.js";
import { packErrand, unpackErrand } from "./needs.js";
import { waterIn, drawWater, RAW, keyWord } from "./water.js"; // purified and un-purified water
import { supplyAmt, useSupply, roundsIn } from "./rounds.js"; // "ammo": every round there, any calibre
import { calibrateDeal, suppliesText, baseAmmo } from "./ammo.js"; // a deal's rounds named by calibre
import { changeGoodwill } from "./factions.js";
import { tileLabel } from "./parties.js";
import { isHardcore } from "./hardcore.js"; // hardcore's year Calder falls: hub events of its own
import { hardcoreEraOffset, hcOutbreakCity } from "./hardcore-outbreak.js";
import { hcMilitary } from "./hardcore-groups.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const firstName = (s) => s.name.split(" ")[0];
const pct = (c) => `${Math.round(c * 100)}%`;
const moodAll = (list, v) => { for (const s of list) s.mood = clamp(s.mood + v, 0, 100); };
const here = (s, base) => s.alive && s.location.kind === "base" && s.location.baseId === base.id;

export const FIRE = { water: 15, burnable: ["bunkhouse", "barracks", "ammo_bench", "reload_bench", "med_station", "machine_shop", "garage", "watchtower", "rain_catcher", "craftbench", "workbench", "toolbench"] };
export const DOG = { food: 0.5, mood: 0.5 };
export const WELL_DOWN = { days: 5, water: 6 };
// An errand takes about a day's food and water a day away from the base (needs.js packErrand: food, water = the least it
// needs to set off) and eats it on the way (their hunger and thirst gauges); what is left comes back with them.
export const ERRAND = { food: 3, water: 3, minDays: 3, maxDays: 5, lost: 0.08, find: 0.5, mood: 25, refuse: -12 };
export const THEFT = { share: 0.06, min: 4, max: 25, lockScrap: 4, lockDays: 30, easyDays: 20 };
export const RATS = { share: 0.05, min: 3, max: 20, scrap: 2 };
export const FENCE = { shots: 3 }; // rounds a head of the dead, shooting from the wall
// A cold snap: three days' extra heating (upkeep.js HEAT: about 15 firewood or 0.1 fuel a head a day below freezing).
export const COLD = { wood: 45, fuel: 0.3, frostbite: 0.3 };
export const SALVAGE = { scrap: [6, 12], risk: 0.2 };
// Hardcore's first year (until the day a normal game would start), the first weeks most.
const hcYear = (st) => isHardcore(st) && day(st) <= hardcoreEraOffset(st);
const hcFade = (st, days) => Math.exp(-(day(st) - 1) / days);
export const HC_CROWD = { share: 0.05, little: 0.3, refused: 0.4 };
export const HC_DESERTER = { goodwill: 8 };
export const HC_SILENCE = { from: 10 }; // the broadcast stops no sooner than this day

// ---------- the context an event is weighed and written from ----------
function context(state, base) {
  const people = atBase(state, base.id);
  const ci = crowdInfo(state, base);
  // The base's day (weather.js: a storm front that sat over it counts for the day), today and yesterday.
  const d = day(state);
  const wxToday = weatherOnDay(state, d, base.tile);
  const wxYesterday = d > 1 ? weatherOnDay(state, d - 1, base.tile) : wxToday;
  const fo = foodOutlook(state, base) || {};
  return {
    base, people, n: people.length, over: ci.over, crowd: ci,
    avgMood: people.length ? people.reduce((a, s) => a + s.mood, 0) / people.length : 60,
    season: season(state).key, wx: wxToday.key, wxYesterday: wxYesterday.key,
    foodDays: fo.daysLeft == null || !isFinite(fo.daysLeft) ? 99 : fo.daysLeft,
    d,
  };
}
const stormy = (c) => ["storm", "blizzard"].includes(c.wx) || ["storm", "blizzard"].includes(c.wxYesterday);
const wet = (c) => ["rain", "snow"].includes(c.wx) || ["rain", "snow"].includes(c.wxYesterday);
const burnableAt = (base) => base.buildings.filter((b) => FIRE.burnable.includes(b.type));
const adults = (c) => c.people.filter((s) => !s.leader);

// ---------- the events ----------
export const HUB_EVENTS = {
  fire: {
    name: "Fire in a building",
    weight: (st, c) => (burnableAt(c.base).length ? 0.8 * (c.season === "summer" ? 1.4 : 1) * (["heat", "drought"].includes(c.wx) ? 2 : ["rain", "storm", "snow", "blizzard"].includes(c.wx) ? 0.4 : 1) * (1 + 0.5 * Math.min(1, c.over)) : 0),
    card: (st, c) => {
      const b = st.rng.pick(burnableAt(c.base));
      const name = BUILDINGS[b.type].name.toLowerCase();
      const wetChance = clamp(0.45 + 0.04 * c.n, 0.45, 0.95), dryChance = clamp(0.2 + 0.025 * c.n, 0.2, 0.6);
      const standing = () => c.base.buildings.includes(b);
      const lose = (s2) => {
        const i = c.base.buildings.indexOf(b);
        if (i >= 0) c.base.buildings.splice(i, 1);
        if (b.type === "watchtower") c.base.watchtower = count(c.base, "watchtower") > 0;
        assignStations(s2, c.base);
        return `The ${name} burned down.`;
      };
      const burn = (s2, risk) => {
        const ppl = atBase(s2, c.base.id);
        if (!ppl.length || !s2.rng.chance(risk)) return "";
        const v = s2.rng.pick(ppl);
        hurt(s2, v, s2.rng.int(8, 18), c.base.tile, `fighting a fire at ${c.base.name}`, { raw: true });
        return v.alive ? ` ${firstName(v)} was burned.` : "";
      };
      return {
        title: `Fire in the ${name}`,
        text: `Smoke pours out of the ${name} at ${c.base.name}. ${c.n} people are here to fight it.${BEDS[b.type] ? ` Losing it means ${BEDS[b.type]} fewer beds.` : ""}`,
        choices: [
          {
            label: `Fight it with water and every hand (${FIRE.water} water)`,
            hint: `${pct(wetChance)} to save it (better with more people); 30% someone is burned (8–18 health)`,
            disabled: () => waterIn(c.base.stock) < FIRE.water,
            ai: () => (waterIn(c.base.stock) >= 40 ? 10 : 6),
            resolve: (s2) => {
              if (!standing()) return "The fire is out.";
              drawWater(c.base.stock, FIRE.water, { rawFirst: true }); // un-purified first (water.js)
              const ok = s2.rng.chance(wetChance);
              return `${ok ? `The ${name} is saved, black and dripping.` : lose(s2)}${burn(s2, 0.3)}`;
            },
          },
          {
            label: "Beat it out with sand and blankets",
            hint: `No water used; ${pct(dryChance)} to save it; 50% someone is burned (8–18 health)`,
            ai: () => 4,
            resolve: (s2) => {
              if (!standing()) return "The fire is out.";
              const ok = s2.rng.chance(dryChance);
              return `${ok ? `Somehow the ${name} is saved.` : lose(s2)}${burn(s2, 0.5)}`;
            },
          },
          {
            label: "Let it burn and keep everyone clear",
            hint: `The ${name} is lost; nobody is hurt`,
            ai: () => (b.type === "rain_catcher" ? 5 : 0),
            resolve: (s2) => (standing() ? lose(s2) : "The fire is out."),
          },
        ],
      };
    },
  },

  quarrel: {
    name: "A quarrel",
    weight: (st, c) => (adults(c).length >= 3 ? 1 * (1 + 1.5 * Math.min(1.5, c.over)) * (c.avgMood < 40 ? 1.8 : 1) * quarrelBoost(st, adults(c)) : 0), // rivals quarrel more (relations.js)
    card: (st, c) => {
      const pool = adults(c);
      const [a, b] = quarrelPair(st, st.rng, pool); // a pair of rivals 70% of the time when there is one
      const topic = c.over > 0 ? "bunk space" : st.rng.pick(["who stands the night watch", "the last of the coffee", "a missing jacket", "how the food is shared", "an old grudge from before"]);
      const tk = talker(st, c.base, a);
      const mediator = tk.who && tk.who !== b ? tk : null;
      const both = () => here(a, c.base) && here(b, c.base);
      const gone = "The quarrel is over: one of them is no longer here.";
      return {
        title: `A quarrel at ${c.base.name}`,
        text: `${a.name} and ${b.name} are at each other's throats over ${topic}.`,
        choices: [
          { label: `Side with ${firstName(a)}`, hint: `${firstName(a)} mood +8, ${firstName(b)} mood -12; they think less of each other`, ai: () => -2, resolve: () => { if (!both()) return gone; moodAll([a], 8); moodAll([b], -12); relEvent(st, a, b, -10); return `${firstName(a)} has your backing. ${firstName(b)} will not forget it.`; } },
          { label: `Side with ${firstName(b)}`, hint: `${firstName(b)} mood +8, ${firstName(a)} mood -12; they think less of each other`, ai: () => -2, resolve: () => { if (!both()) return gone; moodAll([b], 8); moodAll([a], -12); relEvent(st, a, b, -10); return `${firstName(b)} has your backing. ${firstName(a)} will not forget it.`; } },
          {
            label: mediator ? `Mediate (${firstName(mediator.who)}, ${mediator.who.leader ? "leader" : "Speech"} ${mediator.score})` : "Mediate",
            hint: mediator ? `${pct(mediator.chance)}: both mood +6 and they patch it up; otherwise both mood -6 and it festers` : "Nobody else here can mediate",
            disabled: () => !mediator,
            ai: () => (mediator ? mediator.chance * 12 - (1 - mediator.chance) * 6 : -9),
            resolve: (s2) => {
              if (!both()) return gone;
              const ok = s2.rng.chance(mediator.chance);
              talkXp(s2, mediator.who, ok); // skills.js: Speech for the mediator
              moodAll([a, b], ok ? 6 : -6);
              relEvent(s2, a, b, ok ? 14 : -8);
              return ok ? `${firstName(mediator.who)} gets them to shake on it.` : `${firstName(mediator.who)} only makes it worse.`;
            },
          },
          {
            label: "Stay out of it", hint: "Both mood -5; 30% it comes to blows (one of them loses 4–12 health)", ai: () => -5.5,
            resolve: (s2) => {
              if (!both()) return gone;
              moodAll([a, b], -5);
              relEvent(s2, a, b, -8);
              if (s2.rng.chance(0.3)) {
                const v = s2.rng.pick([a, b]);
                hurt(s2, v, s2.rng.int(4, 12), c.base.tile, `in a fistfight at ${c.base.name}`);
                return `It comes to blows. ${firstName(v)} ${v.alive ? "gets the worst of it" : "does not get up again"}.`;
              }
              return "They sulk in opposite corners.";
            },
          },
        ],
      };
    },
  },

  peddler: {
    name: "A peddler at the gate",
    weight: (st, c) => 0.9 * (c.season === "winter" ? 0.5 : 1) * (stormy(c) ? 0.2 : 1),
    card: (st, c) => {
      const DEALS = [
        { give: { ammo: 20 }, get: { meds: 3 } }, { give: { food: 12 }, get: { parts: 1 } }, { give: { scrap: 10 }, get: { fuel: 4 } },
        { give: { ammo: 15 }, get: { food: 12 } }, { give: { meds: 2 }, get: { ammo: 20 } }, { give: { scrap: 8 }, get: { food: 8 } },
        { give: { food: 10 }, get: { scrap: 8 } },
      ];
      const can = (dl) => Object.entries(dl.give).every(([k, q]) => supplyAmt(c.base.stock, k) >= q);
      const pool = DEALS.filter(can).length >= 2 ? DEALS.filter(can) : DEALS;
      // Rounds by calibre (2026-10-09, user request): what you give is the rounds your guns need least, what you get the
      // common rounds of your guns (ammo.js calibrateDeal).
      const cal = (dl) => calibrateDeal(st, c.base, { give: { ...dl.give }, get: { ...dl.get } });
      const raw1 = st.rng.pick(pool);
      const one = cal(raw1), two = cal(st.rng.pick(pool.filter((x) => x !== raw1)));
      const txt = (o) => suppliesText(o);
      // How much the hub wants a supply: short of its target (by head count) = worth more.
      const target = { food: 15 * Math.max(1, c.n), ammo: 60, meds: 8, parts: 4, fuel: 15, scrap: 40, water: 30 };
      const want = (k) => (SUPPLIES[k] && SUPPLIES[k].round ? clamp(target.ammo / (baseAmmo(st, c.base) + 1), 0.2, 3) * supValue(k) : clamp((target[k] || 20) / (supplyAmt(c.base.stock, k) + 1), 0.2, 3) * ((SUPPLIES[k] && SUPPLIES[k].value) || 1)); // rounds: by the rounds that fit the guns here
      const deal = (dl) => ({
        label: `Trade ${txt(dl.give)} for ${txt(dl.get)}`, hint: "A fair swap, done at the gate",
        disabled: () => !can(dl),
        ai: () => Object.entries(dl.get).reduce((a, [k, q]) => a + q * want(k), 0) - Object.entries(dl.give).reduce((a, [k, q]) => a + q * want(k), 0),
        resolve: () => {
          if (!can(dl)) return "You no longer have that to trade.";
          for (const [k, q] of Object.entries(dl.give)) useSupply(c.base.stock, k, q); // rounds.js: "ammo" as any rounds
          gainGoods(st, c.base, dl.get, "travel"); // foods.js: "food" as the peddler's kind of food
          return `Traded ${txt(dl.give)} for ${txt(dl.get)}. The peddler moves on.`;
        },
      });
      return {
        title: "A peddler at the gate",
        text: `A lone trader with a handcart stops at ${c.base.name}. They will swap ${txt(one.get)} for ${txt(one.give)}, or ${txt(two.get)} for ${txt(two.give)}.`,
        choices: [deal(one), deal(two), { label: "Send them on", hint: "No trade", ai: () => 0, resolve: () => "The peddler shrugs and rattles off down the road." }],
      };
    },
  },

  teen: {
    name: "A lost teenager",
    weight: (st, c) => 0.5 * (c.season === "winter" ? 0.6 : 1),
    card: (st, c) => {
      const s = makeCandidate(st, { quality: 0.45, minHealth: 55, gearChance: 0.15 });
      const card = recruitCard(st, [s], {
        source: "teen", baseId: c.base.id, title: "A lost teenager at the gate", takeMood: 4, awayMood: -4,
        intro: `${s.name}, about fifteen, has been hiding in the ruins alone and asks to stay at ${c.base.name}. Taking them in lifts everyone (mood +4); turning them away weighs on everyone (mood -4).`,
      });
      return card;
    },
  },

  preacher: {
    name: "A wandering preacher",
    weight: (st, c) => (c.n >= 3 ? 0.6 * (c.avgMood < 45 ? 1.5 : 1) : 0),
    card: (st, c) => {
      const low = () => atBase(st, c.base.id).filter((s) => !s.leader && s.mood < 35);
      const feed = 2;
      return {
        title: "A wandering preacher",
        text: `A preacher in a dusty coat asks to speak to the people of ${c.base.name} tonight. They talk of a promised land to the north.`,
        choices: [
          {
            label: `Let them preach tonight (${feed} days of food for their meal)`,
            hint: "Everyone mood +5; anyone already unhappy (mood below 35) may follow them away (25% each, taking what they carry)",
            disabled: () => foodIn(c.base.stock) < feed,
            ai: () => (low().length ? -3 : c.avgMood < 55 ? 6 : 2),
            resolve: (s2) => {
              payFood(c.base, feed, s2);
              const unhappy = low();
              moodAll(atBase(s2, c.base.id), 5);
              const left = unhappy.filter(() => s2.rng.chance(0.25));
              for (const s of left) {
                const items = allItems(s).map((g) => g.name);
                s.alive = false; s.left = true; s.station = null; s.inBed = false;
                (s2.deserters || (s2.deserters = [])).push({ id: s.id, baseId: c.base.id, day: day(s2), took: {} });
                log(s2, `${s.name} followed the preacher out of ${c.base.name}${items.length ? `, taking ${items.join(", ")}` : ""}.`, "death");
              }
              if (left.length) checkGameOver(s2);
              return `The preacher's words carry through the night (everyone mood +5).${left.length ? ` By morning ${left.map((s) => s.name).join(" and ")} ${left.length === 1 ? "has" : "have"} gone with them.` : ""}`;
            },
          },
          { label: `Feed them and send them on (${feed} days of food)`, hint: "Everyone mood +1", disabled: () => foodIn(c.base.stock) < feed, ai: () => (foodIn(c.base.stock) >= 30 ? 2 : -1), resolve: (s2) => { payFood(c.base, feed, s2); moodAll(atBase(s2, c.base.id), 1); return "The preacher blesses the gate and walks on."; } },
          { label: "Send them away", hint: "Nothing happens", ai: () => 0, resolve: () => "The preacher walks on, still talking." },
        ],
      };
    },
  },

  theft: {
    name: "Theft from the stores",
    weight: (st, c) => (foodIn(c.base.stock) >= 25 && c.n >= 4 ? 0.7 * (1 + Math.min(1.5, c.over)) * (c.avgMood < 40 ? 1.6 : 1) * ((c.base.storesLockedUntil || 0) > c.d ? 0.2 : 1) * ((c.base.theftEasyUntil || 0) > c.d ? 1.5 : 1) : 0),
    card: (st, c) => {
      const lost = clamp(Math.round(foodIn(c.base.stock) * THEFT.share), THEFT.min, THEFT.max);
      const stolen = takeFood(c.base, lost, { eggs: false, state: st }).items; // already gone when the card comes up (the soonest to spoil first: what is easiest to grab)
      const pool = adults(c).length ? adults(c) : c.people;
      const culprit = st.rng.weighted(pool, (s) => (s.traits.includes("greedy") ? 3 : 1) * (s.mood < 35 ? 2 : 1));
      const sleuths = c.people.filter((s) => s !== culprit);
      const sleuth = sleuths.sort((a, b) => Math.max(skill(b, "scouting"), skill(b, "speech")) - Math.max(skill(a, "scouting"), skill(a, "speech")))[0] || null;
      const score = sleuth ? Math.max(skill(sleuth, "scouting"), skill(sleuth, "speech")) : 0;
      const chance = sleuth ? clamp(0.3 + 0.04 * score, 0.3, 0.9) : 0;
      return {
        title: `Food missing at ${c.base.name}`,
        text: `Someone has been helping themselves: ${lost} food is gone from the stores.`,
        choices: [
          {
            label: sleuth ? `Find out who (${firstName(sleuth)}, ${skill(sleuth, "scouting") >= skill(sleuth, "speech") ? "Scouting" : "Speech"} ${score})` : "Find out who",
            hint: sleuth ? `${pct(chance)}: half the food is found (${Math.floor(lost / 2)}), the thief mood -10 and everyone else +2; otherwise suspicion all round (everyone -2)` : "Nobody here to look into it",
            disabled: () => !sleuth,
            ai: () => chance * 8,
            resolve: (s2) => {
              const ppl = atBase(s2, c.base.id);
              if (s2.rng.chance(chance) && culprit.alive) {
                for (const [k, q] of Object.entries(stolen)) addFood(c.base, k, q / 2, { state: s2 });
                moodAll([culprit], -10);
                moodAll(ppl.filter((s) => s !== culprit), 2);
                return `It was ${culprit.name}. ${Math.floor(lost / 2)} food is found under their bunk.`;
              }
              moodAll(ppl, -2);
              return "Nobody owns up. People eye each other at dinner.";
            },
          },
          {
            label: `Lock up the stores (${THEFT.lockScrap} scrap)`,
            hint: `Theft is far less likely here for ${THEFT.lockDays} days`,
            disabled: () => (c.base.stock.scrap || 0) < THEFT.lockScrap,
            ai: () => ((c.base.stock.scrap || 0) >= 30 ? 5 : 1),
            resolve: (s2) => { c.base.stock.scrap -= THEFT.lockScrap; c.base.storesLockedUntil = day(s2) + THEFT.lockDays; return "A chain and a padlock go on the store room."; },
          },
          { label: "Let it go", hint: `The food stays lost, and it is more likely to happen again for ${THEFT.easyDays} days`, ai: () => 0, resolve: (s2) => { c.base.theftEasyUntil = day(s2) + THEFT.easyDays; return "You let it go."; } },
        ],
      };
    },
  },

  dog: {
    name: "A stray dog",
    weight: (st, c) => (c.base.dog ? 0 : 0.5),
    card: (st, c) => {
      const name = st.rng.pick(["Rusty", "Scout", "Biscuit", "Ranger", "Pepper", "Bear", "Lucky", "Moose"]);
      return {
        title: "A dog at the gate",
        text: `A thin, scruffy dog has been sniffing around ${c.base.name} for days. Someone has already named it ${name}.`,
        choices: [
          { label: `Take ${name} in`, hint: `Eats ${DOG.food} food a day; everyone here mood +${DOG.mood} a day while it stays (it wanders off if the food runs out)`, ai: () => (c.foodDays > 20 ? 5 : 0), resolve: (s2) => { c.base.dog = { name, since: day(s2) }; return `${name} has a home.`; } },
          { label: "Toss it some scraps (1 food)", hint: "Everyone here mood +1 now; it wanders off", disabled: () => foodIn(c.base.stock) < 1, ai: () => 1, resolve: (s2) => { payFood(c.base, 1, s2); moodAll(atBase(s2, c.base.id), 1); return `${name} wolfs it down and trots off.`; } },
          { label: "Chase it off", hint: "Nothing happens", ai: () => 0, resolve: () => `${name} slinks away.` },
        ],
      };
    },
  },

  leak: {
    name: "Storm damage: a leaking roof",
    weight: (st, c) => (stormy(c) ? 2 : wet(c) ? 0.4 : 0),
    card: (st, c) => {
      const lose = Math.max(3, Math.round(foodIn(c.base.stock) * 0.08));
      const spoil = () => Math.round(payFood(c.base, Math.min(lose, foodIn(c.base.stock)), st));
      return {
        title: `Storm damage at ${c.base.name}`,
        text: `The roof over the food stores is leaking after the ${stormy(c) ? "storm" : "rain"}. About ${lose} food will spoil if nothing is done.`,
        choices: [
          { label: "Patch it properly (4 scrap)", hint: "Nothing is lost", disabled: () => (c.base.stock.scrap || 0) < 4, ai: () => 6, resolve: () => { c.base.stock.scrap -= 4; return "The roof is patched before anything spoils."; } },
          { label: "Throw a tarp over it (1 scrap)", hint: `60% it holds; otherwise ${lose} days of food spoil`, disabled: () => (c.base.stock.scrap || 0) < 1, ai: () => 3, resolve: (s2) => { c.base.stock.scrap -= 1; return s2.rng.chance(0.6) ? "The tarp holds." : `The tarp blows off in the night: ${spoil()} days of food spoiled.`; } },
          { label: "Leave it", hint: `${lose} days of food spoil`, ai: () => 0, resolve: () => `${spoil()} days of food spoiled in the wet.` },
        ],
      };
    },
  },

  well: {
    name: "Storm damage: the well pump",
    weight: (st, c) => (c.base.type === "hub" && c.base.tier !== 0 && !c.base.wellDown ? (stormy(c) ? 1.5 : wet(c) ? 0.3 : 0) : 0),
    // The pump breaks (breakdowns.js): repair it properly, jury-rig it or leave it on the Repairs list; until then the
    // hub's well gives WELL_DOWN.water less a day.
    card: (st, c) => breakCard(st, c.base, fixtures(c.base).find((f) => f.type === "pump"), { pumpStorm: stormy(c) }),
  },

  feast: {
    name: "A request for a feast",
    weight: (st, c) => (c.n >= 3 ? 0.6 * (c.season === "autumn" ? 1.5 : 1) * (c.foodDays > 20 ? 1 : 0.2) * (c.avgMood < 50 ? 1.6 : 1) : 0),
    card: (st, c) => {
      const why = { spring: "the first green shoots", summer: "midsummer", autumn: "the harvest", winter: "the longest night" }[c.season] || "making it this far";
      const n = () => atBase(st, c.base.id).length;
      return {
        title: `A feast for ${why}?`,
        text: `People at ${c.base.name} want to mark ${why} with a proper meal.`,
        choices: [
          { label: `A real feast (2 food each, ${2 * c.n})`, hint: "Everyone here mood +10", disabled: () => foodIn(c.base.stock) < 2 * n(), ai: () => (c.avgMood < 45 && c.foodDays > 30 ? 9 : 2), resolve: (s2) => { payFood(c.base, 2 * n(), s2); moodAll(atBase(s2, c.base.id), 10); return "A night to remember (everyone mood +10)."; } },
          { label: `Something small (1 food each, ${c.n})`, hint: "Everyone here mood +5", disabled: () => foodIn(c.base.stock) < n(), ai: () => (c.avgMood < 60 && c.foodDays > 15 ? 6 : 1), resolve: (s2) => { payFood(c.base, n(), s2); moodAll(atBase(s2, c.base.id), 5); return "A modest meal and a few songs (everyone mood +5)."; } },
          { label: "Not now", hint: "Everyone here mood -2", ai: () => (c.foodDays < 15 ? 5 : 0), resolve: (s2) => { moodAll(atBase(s2, c.base.id), -2); return "Grumbling, people go back to work."; } },
        ],
      };
    },
  },

  errand: {
    name: "A personal errand",
    weight: (st, c) => (c.n >= 5 && adults(c).some((s) => s.health >= 60) ? 0.6 : 0),
    card: (st, c) => {
      const s = st.rng.pick(adults(c).filter((x) => x.health >= 60));
      const why = st.rng.pick(["look for their sister", "visit their family's graves", "check on their old house", "find out what happened to an old friend"]);
      const can = () => foodIn(c.base.stock) >= ERRAND.food && waterIn(c.base.stock) >= ERRAND.water;
      return {
        title: `${s.name} asks to leave for a few days`,
        text: `${s.name} wants to ${why}, and asks for ${ERRAND.minDays}–${ERRAND.maxDays} days away from ${c.base.name}.`,
        choices: [
          {
            label: `Let them go (about 1 food and 1 water a day for the road)`,
            hint: `Away ${ERRAND.minDays}–${ERRAND.maxDays} days (no work, does not eat here): they take about a day's food and water for each day and bring back what is left; back with mood +${ERRAND.mood}, ${pct(ERRAND.find)} chance they bring something back, ${pct(ERRAND.lost)} they never come back`,
            disabled: () => !can() || !here(s, c.base),
            ai: () => (s.mood < 50 && c.n >= 6 ? 6 : 2),
            resolve: (s2) => {
              if (!here(s, c.base)) return `${s.name} is no longer here.`;
              const days = s2.rng.int(ERRAND.minDays, ERRAND.maxDays);
              const pack = packErrand(s2, c.base, s, days); // needs.js: their own pack (eating.js) topped up to a day's food and water a day, never below zero
              s.location = { kind: "errand", baseId: c.base.id, until: day(s2) + days };
              s.station = null;
              return `${firstName(s)} sets off at dawn with ${foodText(pack)} and ${pack.water + (pack[RAW] || 0)} water.`;
            },
          },
          { label: "Ask them to stay", hint: `${firstName(s)} mood ${ERRAND.refuse}`, ai: () => 1, resolve: () => { moodAll([s], ERRAND.refuse); return `${firstName(s)} stays, unhappily.`; } },
        ],
      };
    },
  },

  couple: {
    name: "Two survivors grow close",
    weight: (st, c) => (adults(c).length >= 3 ? 0.35 * coupleBoost(st, adults(c)) : 0), // close friends become partners (relations.js)
    card: (st, c) => {
      const pool = adults(c);
      const [a, b] = couplePair(st, st.rng, pool); // the closest friends without a partner, when there are any
      const both = () => here(a, c.base) && here(b, c.base);
      const pair = (s2) => makePartners(s2, a, b); // partners: +1.5 mood a day together, grief if one dies
      return {
        title: `${firstName(a)} and ${firstName(b)} have grown close`,
        text: `${a.name} and ${b.name} have grown close. Everyone at ${c.base.name} has noticed.`,
        choices: [
          { label: "Clear them a corner of their own (3 scrap)", hint: "Both mood +15; they are partners now", disabled: () => (c.base.stock.scrap || 0) < 3, ai: () => ((c.base.stock.scrap || 0) >= 20 ? 6 : 1), resolve: () => { if (!both()) return "Too late."; c.base.stock.scrap -= 3; moodAll([a, b], 15); pair(st); return "A blanket on a line and a door that shuts. They are delighted."; } },
          { label: "A small party for them (4 food)", hint: "Both mood +10, everyone else here +3; they are partners now", disabled: () => foodIn(c.base.stock) < 4, ai: () => (foodIn(c.base.stock) >= 40 ? 5 : 1), resolve: (s2) => { if (!both()) return "Too late."; payFood(c.base, 4, s2); moodAll([a, b], 10); moodAll(atBase(s2, c.base.id).filter((s) => s !== a && s !== b), 3); pair(s2); return "Toasts in tin cups."; } },
          { label: "Leave them to it", hint: "Both mood +5; they are partners now", ai: () => 3, resolve: () => { if (!both()) return "Too late."; moodAll([a, b], 5); pair(st); return "Life goes on."; } },
        ],
      };
    },
  },

  rats: {
    name: "Rats in the stores",
    weight: (st, c) => (foodIn(c.base.stock) >= 20 ? 0.5 * ({ autumn: 1.4, winter: 0.4 }[c.season] || 1) * (c.base.dog ? 0.4 : 1) * (1 + 0.5 * Math.min(1, c.over)) : 0), // a dog keeps them down
    card: (st, c) => {
      const lose = clamp(Math.round(foodIn(c.base.stock) * RATS.share), RATS.min, RATS.max);
      const some = Math.max(1, Math.round(lose / 4));
      const gnaw = (s2, n) => Math.round(payFood(c.base, Math.min(n, foodIn(c.base.stock)), s2));
      const dog = c.base.dog;
      return {
        title: `Rats at ${c.base.name}`,
        text: `Droppings in the flour and gnawed sacks: rats have found the food stores at ${c.base.name}. Left alone they will spoil about ${lose} food.`,
        choices: [
          { label: `Set traps and block the holes (${RATS.scrap} scrap)`, hint: `Only about ${some} food is lost`, disabled: () => (c.base.stock.scrap || 0) < RATS.scrap, ai: () => ((c.base.stock.scrap || 0) >= 20 ? 6 : 3), resolve: (s2) => { c.base.stock.scrap -= RATS.scrap; return `Wire, tin and a few snap traps. ${gnaw(s2, some)} food was lost before it worked.`; } },
          ...(dog ? [{ label: `Let ${dog.name} at them`, hint: `Only about ${some} food is lost; everyone here mood +2`, ai: () => 7, resolve: (s2) => { if (!c.base.dog) return "The dog is gone. The rats stay."; moodAll(atBase(s2, c.base.id), 2); return `${dog.name} has the time of their life (everyone mood +2). ${gnaw(s2, some)} food was lost.`; } }] : []),
          { label: "Leave it", hint: `About ${lose} food is lost`, ai: () => 0, resolve: (s2) => `${gnaw(s2, lose)} food was spoiled by the rats.` },
        ],
      };
    },
  },

  fence: {
    name: "The dead at the fence",
    weight: (st, c) => { const inf = st.tiles[c.base.tile].infection || 0; return c.n >= 3 && inf > 0.05 ? 0.4 + inf * 1.2 : 0; }, // more of them on infected land
    card: (st, c) => {
      const inf = st.tiles[c.base.tile].infection || 0;
      const n = 3 + Math.round(inf * 8);
      const pool = adults(c).length ? adults(c) : c.people;
      const best = [...pool].sort((a, b) => skill(b, "melee") - skill(a, "melee"))[0];
      const m = skill(best, "melee");
      const risk = clamp(0.45 - 0.04 * m, 0.08, 0.45);
      const shots = n * FENCE.shots;
      return {
        title: `The dead at the fence`,
        text: `${n} of the dead have drifted up against the fence at ${c.base.name} in the night and are pressing at it, moaning. More may follow the noise.`,
        choices: [
          {
            label: `Put them down with blades through the fence (${firstName(best)}, Melee ${m})`, hint: `Quiet; everyone here mood +2; ${pct(risk)} ${firstName(best)} is hurt (5–15 health)`,
            ai: () => 4 - risk * 10,
            resolve: (s2) => {
              moodAll(atBase(s2, c.base.id), 2);
              if (!here(best, c.base) || !s2.rng.chance(risk)) return "One by one, through the wire. People sleep easier (mood +2).";
              hurt(s2, best, s2.rng.int(5, 15), c.base.tile, `putting down the dead at the fence of ${c.base.name}`);
              return best.alive ? `It is done, but ${firstName(best)} got a hand through the wire and came away hurt.` : `It is done, but ${best.name} was dragged against the wire and did not survive.`;
            },
          },
          { label: `Shoot them from the wall (${shots} rounds)`, hint: "Safe; everyone here mood +2", disabled: () => supplyAmt(c.base.stock, "ammo") < shots, ai: () => (supplyAmt(c.base.stock, "ammo") >= 150 ? 5 : 1), resolve: (s2) => { useSupply(c.base.stock, "ammo", shots); moodAll(atBase(s2, c.base.id), 2); return `A few minutes of shooting and it is quiet again (mood +2).`; } },
          { label: "Let them be", hint: "They drift off in a day or two; everyone here mood -3 (nobody sleeps)", ai: () => -3, resolve: (s2) => { moodAll(atBase(s2, c.base.id), -3); return "Two nights of moaning at the wire before they wander off (mood -3)."; } },
        ],
      };
    },
  },

  sick: {
    name: "A sick traveller",
    weight: (st, c) => 0.45 * (c.season === "winter" ? 1.6 : 1) * (stormy(c) ? 0.3 : 1),
    card: (st, c) => {
      const can = () => foodIn(c.base.stock) >= 2 && waterIn(c.base.stock) >= 2;
      return {
        title: "A sick traveller at the gate",
        text: `A traveller sways at the gate of ${c.base.name}, burning with fever and coughing into a rag. Not the worm, they swear: a chest fever, caught sleeping rough. They ask for medicine.`,
        choices: [
          {
            label: "Treat them (2 meds)", hint: "Everyone here mood +3; 50% they leave something in thanks", disabled: () => (c.base.stock.meds || 0) < 2, ai: () => ((c.base.stock.meds || 0) >= 8 ? 4 : -1),
            resolve: (s2) => {
              c.base.stock.meds -= 2;
              moodAll(atBase(s2, c.base.id), 3);
              if (!s2.rng.chance(0.5)) return "In two days the fever breaks and they walk on, thanking everyone (mood +3).";
              const [k, lo, hi, word] = s2.rng.pick([["scrap", 4, 8, "scrap"], ["parts", 1, 1, "machine part"], ["electronics", 1, 1, "electronics"], ["wood", 30, 60, "firewood"]]);
              const q = s2.rng.int(lo, hi);
              c.base.stock[k] = (c.base.stock[k] || 0) + q;
              return `In two days the fever breaks. They leave ${q} ${word} in thanks (mood +3).`;
            },
          },
          { label: "Give them food and water for the road (2 food, 2 water)", hint: "Everyone here mood +1", disabled: () => !can(), ai: () => (c.foodDays > 20 ? 2 : 0), resolve: (s2) => { if (!can()) return "There is nothing to spare now."; payFood(c.base, 2, s2); drawWater(c.base.stock, 2, { rawFirst: true }); moodAll(atBase(s2, c.base.id), 1); return "They take it with shaking hands and go."; } },
          { label: "Turn them away", hint: "Everyone here mood -2", ai: () => -1, resolve: (s2) => { moodAll(atBase(s2, c.base.id), -2); return "They stumble off down the road, still coughing (mood -2)."; } },
        ],
      };
    },
  },

  cold: {
    name: "A cold snap",
    weight: (st, c) => (c.season === "winter" && c.n >= 2 ? (["snow", "blizzard"].includes(c.wx) ? 1.2 : 0.5) : 0),
    card: (st, c) => {
      const n = () => atBase(st, c.base.id).length;
      const wood = COLD.wood * c.n, fuel = Math.ceil(COLD.fuel * c.n);
      return {
        title: `A cold snap at ${c.base.name}`,
        text: `A hard frost has settled over ${c.base.name} and will not lift. Water freezes in the buckets and people sleep in their coats.`,
        choices: [
          { label: `Keep the fires going day and night (${wood} firewood)`, hint: "Nobody suffers", disabled: () => (c.base.stock.wood || 0) < COLD.wood * n(), ai: () => ((c.base.stock.wood || 0) >= 3 * wood ? 6 : 2), resolve: () => { c.base.stock.wood -= Math.min(c.base.stock.wood || 0, COLD.wood * n()); return "The stoves roar for three days and the cold stays outside."; } },
          { label: `Burn fuel in the stoves (${fuel} fuel)`, hint: "Nobody suffers; fuel is dear", disabled: () => (c.base.stock.fuel || 0) < Math.ceil(COLD.fuel * n()), ai: () => ((c.base.stock.fuel || 0) >= 40 ? 3 : -2), resolve: () => { c.base.stock.fuel -= Math.min(c.base.stock.fuel || 0, Math.ceil(COLD.fuel * n())); return "The fuel goes up the chimney, and everyone stays warm."; } },
          {
            label: "Bundle up and bear it", hint: `Everyone here mood -4; ${pct(COLD.frostbite)} someone is frostbitten (4–10 health)`, ai: () => -4,
            resolve: (s2) => {
              const ppl = atBase(s2, c.base.id);
              moodAll(ppl, -4);
              if (!ppl.length || !s2.rng.chance(COLD.frostbite)) return "Three miserable days under every blanket there is (mood -4).";
              const v = s2.rng.pick(ppl);
              hurt(s2, v, s2.rng.int(4, 10), c.base.tile, `of the cold at ${c.base.name}`, { raw: true });
              return `Three miserable days (mood -4). ${firstName(v)} ${v.alive ? "has lost the feeling in two toes" : "did not wake up one morning"}.`;
            },
          },
        ],
      };
    },
  },

  music: {
    name: "Music at night",
    weight: (st, c) => (c.n >= 4 ? 0.4 * (c.avgMood < 50 ? 1.5 : 1) : 0),
    card: (st, c) => {
      const pool = adults(c).length ? adults(c) : c.people;
      const s = st.rng.pick(pool);
      const what = st.rng.pick(["an old guitar with four strings left", "a fiddle found in an attic", "a harmonica", "a battered accordion"]);
      const risk = clamp(0.1 + (st.tiles[c.base.tile].infection || 0) * 0.5, 0.1, 0.4);
      return {
        title: `Music at ${c.base.name}`,
        text: `${s.name} has turned up ${what} and wants to play by the fire tonight. People are already gathering. Sound carries a long way these days.`,
        choices: [
          {
            label: `Let ${firstName(s)} play`, hint: `Everyone here mood +5; ${pct(risk)} the music draws a few of the dead to the walls (someone hurt putting them down, 4–12 health)`,
            ai: () => 5 - risk * 10,
            resolve: (s2) => {
              const ppl = atBase(s2, c.base.id);
              moodAll(ppl, 5);
              if (!ppl.length || !s2.rng.chance(risk)) return "Old songs everyone half remembers, late into the night (mood +5).";
              const v = s2.rng.pick(ppl);
              hurt(s2, v, s2.rng.int(4, 12), c.base.tile, `putting down the dead drawn by music at ${c.base.name}`);
              return `A night to remember (mood +5), until the dead came to listen. ${firstName(v)} ${v.alive ? "was hurt putting them down" : "did not survive putting them down"}.`;
            },
          },
          { label: "Ask them to keep it down", hint: `${firstName(s)} mood -4`, ai: () => 0, resolve: () => { moodAll([s], -4); return `${firstName(s)} puts it away without a word.`; } },
        ],
      };
    },
  },

  salvage: {
    name: "A wreck near the walls",
    weight: (st, c) => (c.n >= 3 ? 0.4 : 0),
    card: (st, c) => {
      const ppl = () => atBase(st, c.base.id).filter((s) => s.health >= 40);
      return {
        title: `A wreck near ${c.base.name}`,
        text: `A pickup truck came off the road in the night and lies on its roof in the ditch below ${c.base.name}. Nobody climbed out of it.`,
        choices: [
          {
            label: "Strip it", hint: `${SALVAGE.scrap[0]}–${SALVAGE.scrap[1]} scrap and a car part, 50% some fuel left in the tank; ${pct(SALVAGE.risk)} the driver had the worm and gets up (4–14 health)`,
            disabled: () => !ppl().length, ai: () => 4,
            resolve: (s2) => {
              const scrap = s2.rng.int(...SALVAGE.scrap), fuel = s2.rng.chance(0.5) ? s2.rng.int(2, 5) : 0;
              c.base.stock.scrap = (c.base.stock.scrap || 0) + scrap;
              c.base.stock.carparts = (c.base.stock.carparts || 0) + 1;
              if (fuel) c.base.stock.fuel = (c.base.stock.fuel || 0) + fuel;
              let txt = `Stripped to the frame: ${scrap} scrap, a car part${fuel ? ` and ${fuel} fuel` : ""}.`;
              const hands = ppl();
              if (hands.length && s2.rng.chance(SALVAGE.risk)) {
                const v = s2.rng.pick(hands);
                hurt(s2, v, s2.rng.int(4, 14), c.base.tile, `stripping a wreck at ${c.base.name}`);
                txt += ` The driver was not finished: ${firstName(v)} ${v.alive ? "was hurt" : "was killed"} before they put it down.`;
              }
              return txt;
            },
          },
          { label: "Leave the wreck", hint: "Nothing happens", ai: () => 0, resolve: () => "The wreck rusts in the ditch." },
        ],
      };
    },
  },

  // ---------- hardcore: the year Calder falls (hardcore.js) ----------
  // Only in a hardcore run and only before the day a normal game would start (hcYear); most come in the first weeks.
  hc_crowd: {
    name: "Hungry people at the gate",
    weight: (st, c) => (hcYear(st) ? 1.2 * hcFade(st, 30) : 0),
    card: (st, c) => {
      const n = st.rng.int(4, 8);
      const steal = () => clamp(Math.round(foodIn(c.base.stock) * HC_CROWD.share), 2, 15);
      const night = (s2, chance) => {
        if (!s2.rng.chance(chance)) return "";
        const lost = Math.round(payFood(c.base, Math.min(steal(), foodIn(c.base.stock)), s2));
        return lost ? ` That night someone came over the fence: ${lost} food is gone.` : "";
      };
      return {
        title: `Hungry people at ${c.base.name}`,
        text: `${n} people from the houses down the road are at the gate of ${c.base.name}: a family with two children, an old couple, a man in a business suit gone grey with dirt. The shops are empty and the Guard never came. They ask for food.`,
        choices: [
          { label: `Feed them (${n} food)`, hint: "Everyone here mood +3", disabled: () => foodIn(c.base.stock) < n, ai: () => (c.foodDays > 25 ? 3 : -2), resolve: (s2) => { payFood(c.base, n, s2); moodAll(atBase(s2, c.base.id), 3); return "They eat at the gate and go on their way, thanking everyone (mood +3)."; } },
          { label: "Give them a little (2 food)", hint: `Everyone here mood +1; ${pct(HC_CROWD.little)} some come back at night for more`, disabled: () => foodIn(c.base.stock) < 2, ai: () => 1, resolve: (s2) => { payFood(c.base, 2, s2); moodAll(atBase(s2, c.base.id), 1); return `It is not much, and they know it (mood +1).${night(s2, HC_CROWD.little)}`; } },
          { label: "Turn them away", hint: `Everyone here mood -2; ${pct(HC_CROWD.refused)} some come back at night for what they were refused (about ${steal()} food)`, ai: () => -1.5, resolve: (s2) => { moodAll(atBase(s2, c.base.id), -2); return `They go, slowly, looking back (mood -2).${night(s2, HC_CROWD.refused)}`; } },
        ],
      };
    },
  },

  // A soldier who walked away from the strike on the city hive (hardcore-groups.js): a recruit card, and the Guard
  // thinks less of you if you take them in.
  hc_deserter: {
    name: "A deserter from the Guard",
    weight: (st, c) => { if (!hcYear(st)) return 0; const m = hcMilitary(st); return m && !m.fell && m.strike ? 0.7 : 0; },
    card: (st, c) => {
      const s = makeCandidate(st, { quality: 0.9, minHealth: 50, gearChance: 0 });
      s.gear.weapon = newItem("ar", Math.round(st.rng.range(0.5, 0.8) * 100) / 100, st.rng, START_DUR);
      const m = hcMilitary(st);
      const f = m ? factionById(st, m.id) : null;
      const card = recruitCard(st, [s], {
        source: "deserter_guard", baseId: c.base.id, title: "A deserter from the Guard",
        intro: `${s.name} walked away from the National Guard's column in the night, still in uniform, with a rifle and an empty magazine. "They're sending us into the city to die." They ask to stay at ${c.base.name}.${f && f.alive ? ` If ${f.name} hears of it, they will not thank you.` : ""}`,
      });
      if (f && f.alive) {
        for (const ch of card.choices.filter((x) => ["take", "takeOne", "send"].includes(x.kind))) {
          const run = ch.resolve;
          ch.hint = `${ch.hint}; ${f.name} goodwill -${HC_DESERTER.goodwill}`;
          ch.resolve = (s2) => { const out = run(s2); if (!s.pending && !s.gone && f.alive) changeGoodwill(s2, f, -HC_DESERTER.goodwill, "you took in a deserter"); return out; };
        }
      }
      return card;
    },
  },

  // The emergency broadcast stops (once a run): the moment the people at the hub understand nobody is coming.
  hc_silence: {
    name: "The radio goes quiet",
    weight: (st, c) => (hcYear(st) && c.d >= HC_SILENCE.from && !(st.hardcore && st.hardcore.silence) ? 1.5 : 0),
    card: (st, c) => {
      if (st.hardcore) st.hardcore.silence = c.d; // once a run, answered or not
      const tk = talker(st, c.base, null);
      return {
        title: "The radio goes quiet",
        text: `The emergency broadcast that has droned on every radio at ${c.base.name} since the fall stopped in the night, mid-sentence, and has not come back. Nobody says what everyone is thinking.`,
        choices: [
          {
            label: tk.who ? `Gather everyone and talk it through (${firstName(tk.who)}, ${tk.who.leader ? "leader" : "Speech"} ${tk.score})` : "Gather everyone and talk it through",
            hint: tk.who ? `${pct(tk.chance)}: everyone here mood +2, in this together; otherwise everyone mood -4` : "Nobody here to talk to them",
            disabled: () => !tk.who, ai: () => (tk.who ? tk.chance * 6 - (1 - tk.chance) * 4 : -9),
            resolve: (s2) => {
              const ok = s2.rng.chance(tk.chance);
              talkXp(s2, tk.who, ok);
              moodAll(atBase(s2, c.base.id), ok ? 2 : -4);
              return ok ? `${firstName(tk.who)} says it out loud: nobody is coming, so it is up to them. Heads nod (mood +2).` : "The words do not come out right. People drift off to their bunks (mood -4).";
            },
          },
          { label: "Let people grieve in their own way", hint: "Everyone here mood -4", ai: () => -4, resolve: (s2) => { moodAll(atBase(s2, c.base.id), -4); return "A quiet, heavy day (mood -4)."; } },
        ],
      };
    },
  },

  // People who walked out of the city where the outbreak began (hardcore-outbreak.js): a recruit card for two.
  hc_cityfolk: {
    name: "Refugees from the city",
    weight: (st, c) => (hcYear(st) ? 0.8 * hcFade(st, 45) : 0),
    card: (st, c) => {
      const city = hcOutbreakCity(st);
      const where = city != null ? tileLabel(st, city) : "the city";
      const list = [makeCandidate(st, { quality: 0.7, minHealth: 40, gearChance: 0.2 }), makeCandidate(st, { quality: 0.7, minHealth: 40, gearChance: 0.2 })];
      return recruitCard(st, list, {
        source: "cityfolk", baseId: c.base.id, title: `Refugees from ${where}`,
        intro: `${list[0].name} and ${list[1].name} walked out of ${where} the week it fell and have slept in ditches since. They saw the thing growing downtown, and what came out of it. They ask to stay at ${c.base.name}.`,
      });
    },
  },

  // Remembering the dead (relations.js): likelier after deaths nobody has marked yet, never in the week after a service.
  memorial: {
    name: "Remembering the dead",
    weight: (st, c) => (c.n >= 2 ? memorialWeight(st, c.base) : 0),
    card: (st, c) => memorialCard(st, c.base),
  },
};
export const HUB_EVENT_IDS = Object.keys(HUB_EVENTS);

// ---------- how often ----------
export function hubEventChance(state, base) {
  const n = atBase(state, base.id).length;
  const over = crowdInfo(state, base).over;
  return Math.min(0.45, clamp(0.04 + 0.026 * n, 0.08, 0.4) * (1 + 0.3 * Math.min(1, over)));
}
export function hubEventWeights(state, base) {
  const c = context(state, base);
  return Object.fromEntries(HUB_EVENT_IDS.map((id) => [id, Math.max(0, HUB_EVENTS[id].weight(state, c) || 0)]));
}
// One event's card for a base (also used by tools to force an event).
export function hubEventCard(state, id, base = hub(state)) {
  const c = context(state, base);
  const card = HUB_EVENTS[id].card(state, c);
  card.hubEvent = id;
  return card;
}

export function hubEventsDaily(state) {
  hubUpkeepDaily(state);
  breakdownsDaily(state); // breakdowns.js: wear, and what broke overnight
  const base = hub(state);
  if (!base || state.gameOver) return;
  const d = day(state);
  if (d < 3 || state.cards.some((c) => c.hubEvent)) return;
  if (base.lastHubEvent != null && base.lastHubEvent >= d - 1) return; // never two days running
  if (!state.rng.chance(hubEventChance(state, base))) return;
  const w = hubEventWeights(state, base);
  const ids = HUB_EVENT_IDS.filter((id) => w[id] > 0);
  if (!ids.length) return;
  const id = state.rng.weighted(ids, (x) => w[x]);
  const card = hubEventCard(state, id, base);
  addCard(state, card);
  base.lastHubEvent = d;
  const st = state.stats.hubEvents || (state.stats.hubEvents = {});
  st[id] = (st[id] || 0) + 1;
}

// ---------- lasting effects: the dog, a broken well, people away on errands ----------
export function hubUpkeepDaily(state) {
  const d = day(state);
  const rng = state.rng;
  for (const base of state.bases) {
    if (base.dog) {
      if (foodIn(base.stock) >= DOG.food) {
        payFood(base, DOG.food, state);
        moodAll(residents(state, base.id), DOG.mood);
      } else {
        log(state, `${base.dog.name} the dog wandered off: there was nothing left to feed it at ${base.name}.`, "danger");
        delete base.dog;
      }
    }
    if (base.wellDown) {
      drawWater(base.stock, base.wellDown.water, { rawFirst: true }); // the well's water that never came (un-purified first)
      if (d >= base.wellDown.until) { delete base.wellDown; log(state, `The well at ${base.name} is working properly again.`, "good"); }
    }
  }
  for (const s of state.survivors) {
    if (!s.alive || !s.location || s.location.kind !== "errand" || d < s.location.until) continue;
    const base = baseById(state, s.location.baseId) || hub(state);
    if (!base) continue;
    if (rng.chance(ERRAND.lost)) {
      killSurvivor(state, s, null, "far from home on a personal errand (never came back)");
      continue;
    }
    const back = unpackErrand(base, s, state); // needs.js: what is left of their food and water over their usual pack
    s.location = { kind: "base", baseId: base.id };
    s.mood = clamp(s.mood + ERRAND.mood, 0, 100);
    let found = back.food >= 0.1 || back.water ? ` (bringing back ${Math.round(back.food * 10) / 10} days of food and ${back.water} water they did not need)` : "";
    if (rng.chance(ERRAND.find)) {
      const [k, lo, hi] = rng.pick([["scrap", 3, 8], ["food", 3, 6], ["meds", 1, 2]]);
      const q = rng.int(lo, hi);
      if (k === "food") found = ` with ${foodText(addFoodUnits(state, base, "house", q))}${found}`; // foods.js: a larder in an empty house
      else { base.stock[k] = (base.stock[k] || 0) + q; found = ` with ${q} ${keyWord(k)}${found}`; }
    }
    log(state, `${s.name} is back at ${base.name}${found}, in better spirits.`, "good");
  }
}
