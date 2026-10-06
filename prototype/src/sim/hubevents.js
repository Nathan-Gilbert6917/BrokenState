// Hub events: decisions for the days at home. About one card every 3–5 days at a mid-size hub (10 people), fewer at
// a tiny one: a daily chance of 4% + 2.6% per person at the hub (8% to 40%), up to 30% more when the hub is
// overcrowded, never on two days running and never while another hub event is waiting. Which event comes is weighted
// by season, weather (weather.js), crowding and mood (morale.js) and the size of the hub. Every choice changes
// something real, and the card says what. The autopilot scores each choice with its `ai` function.
//
// Events: a fire in a building, a quarrel between two survivors, a peddler at the gate, a lost teenager (a recruit
// card, recruits.js), a wandering preacher, food stolen from the stores, a stray dog, storm damage (a leaking roof
// over the stores, a broken well pump), a request for a feast, someone asking to leave on a personal errand, and two
// survivors who have grown close (partners, relations.js), and remembering the dead (a memorial service).
import { BUILDINGS, count, assignStations } from "./buildings.js";
import { SUPPLIES } from "./data.js";
import { log, addCard, day, hub, baseById, atBase, residents, skill, hurt, killSurvivor, checkGameOver } from "./world.js";
import { weather, weatherOnDay, season } from "./weather.js";
import { crowdInfo, talker } from "./morale.js";
import { quarrelBoost, quarrelPair, coupleBoost, couplePair, makePartners, relEvent, memorialWeight, memorialCard } from "./relations.js";
import { makeCandidate, recruitCard } from "./recruits.js";
import { foodOutlook } from "./economy.js";
import { allItems } from "./inventory.js";
import { breakCard, fixtures, breakdownsDaily } from "./breakdowns.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const firstName = (s) => s.name.split(" ")[0];
const pct = (c) => `${Math.round(c * 100)}%`;
const moodAll = (list, v) => { for (const s of list) s.mood = clamp(s.mood + v, 0, 100); };
const here = (s, base) => s.alive && s.location.kind === "base" && s.location.baseId === base.id;

export const FIRE = { water: 15, burnable: ["bunkhouse", "ammo_bench", "med_station", "machine_shop", "garage", "watchtower", "rain_catcher"] };
export const DOG = { food: 0.5, mood: 0.5 };
export const WELL_DOWN = { days: 5, water: 6 };
export const ERRAND = { food: 3, water: 3, minDays: 3, maxDays: 5, lost: 0.08, find: 0.5, mood: 25, refuse: -12 };
export const THEFT = { share: 0.06, min: 4, max: 25, lockScrap: 4, lockDays: 30, easyDays: 20 };

// ---------- the context an event is weighed and written from ----------
function context(state, base) {
  const people = atBase(state, base.id);
  const ci = crowdInfo(state, base);
  const wxToday = weather(state);
  const d = day(state);
  const wxYesterday = d > 1 ? weatherOnDay(state, d - 1) : wxToday;
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
        text: `Smoke pours out of the ${name} at ${c.base.name}. ${c.n} people are here to fight it.${b.type === "bunkhouse" ? " Losing it means 6 fewer beds." : ""}`,
        choices: [
          {
            label: `Fight it with water and every hand (${FIRE.water} water)`,
            hint: `${pct(wetChance)} to save it (better with more people); 30% someone is burned (8–18 health)`,
            disabled: () => (c.base.stock.water || 0) < FIRE.water,
            ai: () => ((c.base.stock.water || 0) >= 40 ? 10 : 6),
            resolve: (s2) => {
              if (!standing()) return "The fire is out.";
              c.base.stock.water = Math.max(0, (c.base.stock.water || 0) - FIRE.water);
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
      const can = (dl) => Object.entries(dl.give).every(([k, q]) => (c.base.stock[k] || 0) >= q);
      const pool = DEALS.filter(can).length >= 2 ? DEALS.filter(can) : DEALS;
      const one = st.rng.pick(pool);
      const two = st.rng.pick(pool.filter((x) => x !== one));
      const txt = (o) => Object.entries(o).map(([k, q]) => `${q} ${k}`).join(", ");
      // How much the hub wants a supply: short of its target (by head count) = worth more.
      const target = { food: 15 * Math.max(1, c.n), ammo: 60, meds: 8, parts: 4, fuel: 15, scrap: 40, water: 30 };
      const want = (k) => clamp((target[k] || 20) / ((c.base.stock[k] || 0) + 1), 0.2, 3) * ((SUPPLIES[k] && SUPPLIES[k].value) || 1);
      const deal = (dl) => ({
        label: `Trade ${txt(dl.give)} for ${txt(dl.get)}`, hint: "A fair swap, done at the gate",
        disabled: () => !can(dl),
        ai: () => Object.entries(dl.get).reduce((a, [k, q]) => a + q * want(k), 0) - Object.entries(dl.give).reduce((a, [k, q]) => a + q * want(k), 0),
        resolve: () => {
          if (!can(dl)) return "You no longer have that to trade.";
          for (const [k, q] of Object.entries(dl.give)) c.base.stock[k] -= q;
          for (const [k, q] of Object.entries(dl.get)) c.base.stock[k] = (c.base.stock[k] || 0) + q;
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
            label: `Let them preach tonight (${feed} food for their meal)`,
            hint: "Everyone mood +5; anyone already unhappy (mood below 35) may follow them away (25% each, taking what they carry)",
            disabled: () => (c.base.stock.food || 0) < feed,
            ai: () => (low().length ? -3 : c.avgMood < 55 ? 6 : 2),
            resolve: (s2) => {
              c.base.stock.food = Math.max(0, (c.base.stock.food || 0) - feed);
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
          { label: `Feed them and send them on (${feed} food)`, hint: "Everyone mood +1", disabled: () => (c.base.stock.food || 0) < feed, ai: () => ((c.base.stock.food || 0) >= 30 ? 2 : -1), resolve: (s2) => { c.base.stock.food = Math.max(0, (c.base.stock.food || 0) - feed); moodAll(atBase(s2, c.base.id), 1); return "The preacher blesses the gate and walks on."; } },
          { label: "Send them away", hint: "Nothing happens", ai: () => 0, resolve: () => "The preacher walks on, still talking." },
        ],
      };
    },
  },

  theft: {
    name: "Theft from the stores",
    weight: (st, c) => ((c.base.stock.food || 0) >= 25 && c.n >= 4 ? 0.7 * (1 + Math.min(1.5, c.over)) * (c.avgMood < 40 ? 1.6 : 1) * ((c.base.storesLockedUntil || 0) > c.d ? 0.2 : 1) * ((c.base.theftEasyUntil || 0) > c.d ? 1.5 : 1) : 0),
    card: (st, c) => {
      const lost = clamp(Math.round((c.base.stock.food || 0) * THEFT.share), THEFT.min, THEFT.max);
      c.base.stock.food = Math.max(0, (c.base.stock.food || 0) - lost); // already gone when the card comes up
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
                c.base.stock.food = (c.base.stock.food || 0) + Math.floor(lost / 2);
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
          { label: "Toss it some scraps (1 food)", hint: "Everyone here mood +1 now; it wanders off", disabled: () => (c.base.stock.food || 0) < 1, ai: () => 1, resolve: (s2) => { c.base.stock.food -= 1; moodAll(atBase(s2, c.base.id), 1); return `${name} wolfs it down and trots off.`; } },
          { label: "Chase it off", hint: "Nothing happens", ai: () => 0, resolve: () => `${name} slinks away.` },
        ],
      };
    },
  },

  leak: {
    name: "Storm damage: a leaking roof",
    weight: (st, c) => (stormy(c) ? 2 : wet(c) ? 0.4 : 0),
    card: (st, c) => {
      const lose = Math.max(3, Math.round((c.base.stock.food || 0) * 0.08));
      const spoil = () => { const n = Math.min(lose, c.base.stock.food || 0); c.base.stock.food = Math.max(0, (c.base.stock.food || 0) - n); return n; };
      return {
        title: `Storm damage at ${c.base.name}`,
        text: `The roof over the food stores is leaking after the ${stormy(c) ? "storm" : "rain"}. About ${lose} food will spoil if nothing is done.`,
        choices: [
          { label: "Patch it properly (4 scrap)", hint: "Nothing is lost", disabled: () => (c.base.stock.scrap || 0) < 4, ai: () => 6, resolve: () => { c.base.stock.scrap -= 4; return "The roof is patched before anything spoils."; } },
          { label: "Throw a tarp over it (1 scrap)", hint: `60% it holds; otherwise ${lose} food spoils`, disabled: () => (c.base.stock.scrap || 0) < 1, ai: () => 3, resolve: (s2) => { c.base.stock.scrap -= 1; return s2.rng.chance(0.6) ? "The tarp holds." : `The tarp blows off in the night: ${spoil()} food spoiled.`; } },
          { label: "Leave it", hint: `${lose} food spoils`, ai: () => 0, resolve: () => `${spoil()} food spoiled in the wet.` },
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
          { label: `A real feast (2 food each, ${2 * c.n})`, hint: "Everyone here mood +10", disabled: () => (c.base.stock.food || 0) < 2 * n(), ai: () => (c.avgMood < 45 && c.foodDays > 30 ? 9 : 2), resolve: (s2) => { c.base.stock.food -= 2 * n(); moodAll(atBase(s2, c.base.id), 10); return "A night to remember (everyone mood +10)."; } },
          { label: `Something small (1 food each, ${c.n})`, hint: "Everyone here mood +5", disabled: () => (c.base.stock.food || 0) < n(), ai: () => (c.avgMood < 60 && c.foodDays > 15 ? 6 : 1), resolve: (s2) => { c.base.stock.food -= n(); moodAll(atBase(s2, c.base.id), 5); return "A modest meal and a few songs (everyone mood +5)."; } },
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
      const can = () => (c.base.stock.food || 0) >= ERRAND.food && (c.base.stock.water || 0) >= ERRAND.water;
      return {
        title: `${s.name} asks to leave for a few days`,
        text: `${s.name} wants to ${why}, and asks for ${ERRAND.minDays}–${ERRAND.maxDays} days away from ${c.base.name}.`,
        choices: [
          {
            label: `Let them go (${ERRAND.food} food, ${ERRAND.water} water for the road)`,
            hint: `Away ${ERRAND.minDays}–${ERRAND.maxDays} days (no work, does not eat here); back with mood +${ERRAND.mood}, ${pct(ERRAND.find)} chance they bring something back, ${pct(ERRAND.lost)} they never come back`,
            disabled: () => !can() || !here(s, c.base),
            ai: () => (s.mood < 50 && c.n >= 6 ? 6 : 2),
            resolve: (s2) => {
              if (!here(s, c.base)) return `${s.name} is no longer here.`;
              c.base.stock.food = Math.max(0, (c.base.stock.food || 0) - ERRAND.food); // never below zero, even taken when it was short
              c.base.stock.water = Math.max(0, (c.base.stock.water || 0) - ERRAND.water);
              s.location = { kind: "errand", baseId: c.base.id, until: day(s2) + s2.rng.int(ERRAND.minDays, ERRAND.maxDays) };
              s.station = null;
              return `${firstName(s)} sets off at dawn.`;
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
          { label: "A small party for them (4 food)", hint: "Both mood +10, everyone else here +3; they are partners now", disabled: () => (c.base.stock.food || 0) < 4, ai: () => ((c.base.stock.food || 0) >= 40 ? 5 : 1), resolve: (s2) => { if (!both()) return "Too late."; c.base.stock.food -= 4; moodAll([a, b], 10); moodAll(atBase(s2, c.base.id).filter((s) => s !== a && s !== b), 3); pair(s2); return "Toasts in tin cups."; } },
          { label: "Leave them to it", hint: "Both mood +5; they are partners now", ai: () => 3, resolve: () => { if (!both()) return "Too late."; moodAll([a, b], 5); pair(st); return "Life goes on."; } },
        ],
      };
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
      if ((base.stock.food || 0) >= DOG.food) {
        base.stock.food -= DOG.food;
        moodAll(residents(state, base.id), DOG.mood);
      } else {
        log(state, `${base.dog.name} the dog wandered off: there was nothing left to feed it at ${base.name}.`, "danger");
        delete base.dog;
      }
    }
    if (base.wellDown) {
      base.stock.water = Math.max(0, (base.stock.water || 0) - base.wellDown.water);
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
    s.location = { kind: "base", baseId: base.id };
    s.mood = clamp(s.mood + ERRAND.mood, 0, 100);
    let found = "";
    if (rng.chance(ERRAND.find)) {
      const [k, lo, hi] = rng.pick([["scrap", 3, 8], ["food", 3, 6], ["meds", 1, 2]]);
      const q = rng.int(lo, hi);
      base.stock[k] = (base.stock[k] || 0) + q;
      found = ` with ${q} ${k}`;
    }
    log(state, `${s.name} is back at ${base.name}${found}, in better spirits.`, "good");
  }
}
