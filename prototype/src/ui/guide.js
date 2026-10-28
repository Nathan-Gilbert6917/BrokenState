// The first-week guide (suggestions-4 #2): an opt-in checklist pinned under the alerts stack on the right of the map.
// A handful of steps a new player needs in the first days, each with a line on why it matters and a "Show me" that
// opens the right screen and pulses the button to press. Steps tick off from the state of the game (a team really
// out, a building really queued, the clock really past the first dawn), never by clicking them; a small toast says so.
// - Two lists, day by day (GUIDE_PHASES: Day 1 to Day 7, a few steps each, every day ending with "Get through the
//   Nth night", ticked at its dawn; the user's request 2026-10-28):
//   - the road start (Normal and Hardcore since issue #79, and Crashlanding: no base past a camp yet): 1 off the road
//     (the team, the clock, water, the camp fire's wood and stone, Establish base); 2 the camp at work (priorities, wood,
//     food, a water boiler); 3 into the ruins (a team out, a raid); 4 home, and the shelter shack placed; 5 its needs in, a farm plot;
//     6 a first defence; 7 the shelter founded, the diary, the attack held off;
//   - a hub start (Custom): 1 the stores, the clock, priorities; 2 a building, wood, a water boiler; 3 a team out, a raid; 4 home, food;
//     5 a farm plot; 6 a first defence; 7 the diary, the attack held off.
//   Which one is picked when the guide starts: no base past a camp yet = the road list. A step can read differently
//   on the road (ROAD_WORDS). The card shows today in full, an earlier day's open steps under "still to do", a later
//   day as one line (a click shows its steps: ui.guidePeek); the guide's day (guideDay) turns at each dawn.
// - state.guide = { kind: "base" | "road", on, keep, fold, done: { step id: hour }, h0, b0, p0, d0, w0, sent: [{ id,
//   who, mission }], wLow, woodLow, fLow, raided, ready, warned, attack, seen: { tip id: hour }, ended }. Saved with the world (sim/save.js writes
//   the whole state); an older save has none and shows nothing.
//   h0: the hour it started (the nights count from it); b0, p0, d0: buildings, farm plots and defences then; sent:
//   player teams seen leaving a base (for "bring them home" and a raid); wLow, fLow: the least water and food held so
//   far (for "find water", "food coming in"); woodLow: the least wood at the hub so far (for "wood coming in"; null
//   until there is a hub); raided: the hour a raid's map first came up; w0: water boilers then; ready: the hour the steps
//   the attack waits for (GUIDE_READY) were all done; attackAt, warned, attack, attackTold: the seventh day's attack
//   (sim/firstweekattack.js).
// - Off by itself once every step is done or at the dawn after the seventh night (not when brought back by hand from
//   the menu: keep), or with its ✕. The menu's Game tab brings it back or hides it (gd-toggle).
// - The new-run screen's "First-week guide" box (ui/newgame.js, ui.guide): on by default for the first campaign on
//   this machine (no saves, options.guideSeen unset), off after that (main.js begin).
// - New things (tips): the first time each kind of window comes up while the guide is on (the raid's plan, the raid
//   map, a base defence, someone asking to join, an encounter, a hub event…) a short note sits over it in its own layer
//   (#guidetip: the guide's card is under the windows and the battle), saying what it is and what to press, with a "?" to
//   its Help topic. The first alert of each kind (a team waiting, no work, food low, the worm…) gets a "New" line at the
//   top of the card. Each is told once a run: g.seen = { tip id: hour }.
// - The player's: it never pauses the clock, adds cards or touches the simulation itself; the autopilot and the
//   headless tools never start it. The one thing the game does for it: the seventh day's attack (sim/firstweekattack.js,
//   while the guide is on and once the steps it waits for are done (GUIDE_READY), g.ready: a warning, then at an hour of day 7 a
//   nomad band by day or a horde of the dead by night, made for it; the user's requests 2026-10-28), whose "Hold off the
//   attack" step on day 7 is hidden (st.hidden) until it comes (g.attack).
import { hub, alive } from "../sim/world.js";
import { partyTile, partyMembers, carried } from "../sim/parties.js";
import { teamWaterIn, waterIn } from "../sim/water.js";
import { foodIn } from "../sim/foods.js";
import { waterSource, ESTABLISH_LABEL } from "../sim/staging.js";
import { isCamp, tierUpJob, gatherRows, BUILDINGS, CAMP } from "../sim/buildings.js";
import { SUPPLIES } from "../sim/data.js";
import { roadTeam } from "../sim/hardcore-start.js";
import { nightDawn } from "../sim/firstweekattack.js"; // the dawn that ends the guide's night n; the seventh day's attack
import { tileActions, modalKind } from "./ui.js";
import { cardKind } from "../sim/cardrules.js";
import { listSaves } from "./saves.js";
import { sayFor, padHtml, PAD } from "./hints.js";
import { panelTab } from "./layout.js"; // the guide folded to a tab, as the other boxes over the map // a step's or a note's words for a finger or a controller (touch, pad: else devText)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

export const GUIDE = {
  DAYS: 7,          // off by itself after this day (unless brought back by hand)
  PULSE_MS: 12000,  // how long a "Show me" pulse lasts
  SENT_MAX: 8,      // teams remembered for "bring them home"
  WATER_GAIN: 3,    // water held above the lowest seen that counts as "found water"
  SITE_REACH: 8,    // how far from the hub "Show me" looks for a site to scavenge
  WOOD_GAIN: 30,    // wood at the hub above the lowest seen that counts as "wood coming in"
  FOOD_GAIN: 3,     // days of food held above the lowest seen that counts as "food coming in"
};

// ---------- what counts ----------
const mine = (state) => state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && partyMembers(state, p).length);
const buildingCount = (state) => state.bases.reduce((a, b) => a + (b.buildings || []).length, 0);
// Water the player holds anywhere: every team, the bases (camps too).
function waterHeld(state) {
  let w = 0;
  for (const p of mine(state)) w += teamWaterIn(p);
  for (const b of state.bases) w += waterIn(b.stock);
  return w;
}
const hubWood = (state) => { const h = hub(state); return h ? h.stock.wood || 0 : null; }; // null: no hub yet (the road)
// "20 scrap, 2 building materials and 200 wood"
const costText = (cost) => Object.entries(cost).map(([k, n]) => `${n} ${String(SUPPLIES[k] ? SUPPLIES[k].name : k).toLowerCase()}`).join(", ").replace(/, ([^,]*)$/, " and $1");
// "5 wood and 8 stone": the camp fire's cost.
const fireText = () => Object.entries(CAMP.fireCost).map(([k, n]) => `${n} ${k}`).join(" and ");
// A team of yours carrying the camp fire's wood and stone (sim/staging.js fireCostProblem).
const fireCarried = (state) => mine(state).some((p) => Object.entries(CAMP.fireCost).every(([k, n]) => carried(p, k) >= n));
// Food the player holds anywhere, in days: every team, the bases.
function foodHeld(state) {
  let f = 0;
  for (const p of mine(state)) f += carried(p, "food");
  for (const b of state.bases) f += foodIn(b.stock);
  return f;
}
// Buildings of some kinds at your bases, standing or queued.
const countAt = (state, test) => state.bases.reduce((a, b) => a + [...(b.buildings || []), ...(b.construction || [])].filter((x) => x && test(x.type)).length, 0);
const plotCount = (state) => countAt(state, (t) => t === "farm_plot");
const isDefence = (t) => !!(BUILDINGS[t] && BUILDINGS[t].tab === "defenses");
const guardsAt = (state) => alive(state).filter((s) => s.role === "guard" && s.location && s.location.kind === "base").length;
const atBaseAs = (state, roles) => alive(state).some((s) => roles.includes(s.role) && s.location && s.location.kind === "base");
// The guide's day: 1 until the first dawn, then one more each dawn, up to GUIDE.DAYS.
export const guideDay = (state, g) => Math.max(1, Math.min(GUIDE.DAYS, Math.floor((state.hour - 6) / 24) - Math.floor(g.h0 / 24) + 1));
const homeTeams = (state, g) => g.sent.filter((x) => !state.parties.some((p) => p.id === x.id));

// ---------- the steps ----------
// done(state, g, ui): true once it is done. show(state, ui, act): opens what it needs and returns the CSS selectors
// to pulse. Show-me helpers below.
const STEPS = {
  stores: {
    title: "Check your food and water", why: "Food and water run out first. The top bar's Needs button (hover it for every supply) and the base's Food and Farming tabs show how many days you have left. The well's raw water can carry the worm once the clean water is drunk: a water boiler (Construction) makes it safe.",
    done: (state, g, ui) => !!ui.baseView && ["farming", "overview", "food"].includes(ui.baseView.tab),
    show: (state, ui, act) => (openHub(state, ui, act, "farming") ? ["#tb-stock", '[data-action="basetab"][data-tab="farming"]'] : ["#tb-stock"]),
  },
  work: {
    title: "Put your people on work priorities", why: "On priorities everyone picks the most urgent job they are set for, hour by hour: farming, building, cutting wood, guarding when the dead come. One click sets everyone up. Anyone left on a fixed job with nothing to do helps elsewhere for the hour (the 💤 No work alert says who).",
    done: (state) => alive(state).some((s) => s.work && s.work.role != null),
    show: (state, ui, act) => (openHub(state, ui, act, "work") ? ['[data-action="weveryone"]', '[data-action="basetab"][data-tab="work"]'] : noCamp(state, ui, act)),
  },
  build: {
    title: "Queue a building", why: "Your hub starts bare: the main house with its well, a lodge with four beds, a two-person tent and eight crop plots, no wall, and nothing else is built. Anyone without a bed sleeps rough (mood every night, worse in the wet and the cold, and a chance of a chest cold). What goes up first is your call: a bunkhouse (six beds) or makeshift tents, a crafting bench for gear, farm plots, walls on the Defenses tab. Wood pays for most of it (you start with 1,000), with a little scrap and a part or two; most builds open the base map to place them (R turns them), and your builders do the work.",
    done: (state, g) => state.bases.some((b) => (b.construction || []).length) || buildingCount(state) > g.b0,
    show: (state, ui, act) => { openHub(state, ui, act, "construction"); return ['[data-action="queuebuild"]:not([disabled])']; },
  },
  wood: {
    title: "Keep wood coming in", why: "Wood builds, cooks, boils the water and heats the base when the cold comes, and nobody starts on it: the first builds eat the woodpile fast. Put someone on Cut wood (the role drop-down beside their name), or mark trees to fell on the base map; a team in the field can cut wood too.",
    done: (state, g) => alive(state).some((s) => s.role === "wood" && s.location && s.location.kind === "base") || (hubWood(state) ?? -Infinity) >= (g.woodLow ?? Infinity) + GUIDE.WOOD_GAIN, // a fixed woodcutter, or someone on priorities cutting this hour (work.js sets s.role to the hour's job)
    show: (state, ui, act) => (openHub(state, ui, act, "overview") ? ['[data-action="role"]', '[data-action="basetab"][data-tab="basemap"]'] : openTeam(state, ui, act) ? ['[data-action="xp-order"][data-type="wood"]'] : []), // no camp yet: the team's Cut wood
  },
  scavenge: {
    title: "Send a team to scavenge", why: "Scrap, parts, meds and ammo come from the ruins. Click a site, pick Scavenge / raid, choose who goes and launch: the planner packs their supplies. When they get there you pick the place to go into (one not found yet needs a survey first) and play the raid on its map.",
    pad: `Scrap, parts, meds and ammo come from the ruins. ${PAD.X} on a site opens its menu: pick Scavenge / raid, choose who goes and launch, and the planner packs their supplies. When they get there you pick the place to go into (one not found yet needs a survey first) and play the raid on its map.`,
    done: (state, g) => g.sent.length > 0,
    show: (state, ui, act) => showSite(state, ui, act),
  },
  clock: {
    title: "Start the clock", why: "A new game waits paused while you look around and give orders. Space (or ▶ Run on the banner) runs it; 0–5 pick the speed.",
    touch: "A new game waits paused while you look around and give orders. ▶ Run on the banner runs it; the speeds in the top bar pick how fast.",
    pad: `A new game waits paused while you look around and give orders. ${PAD.Menu} (or ▶ Run on the banner) runs it; LB RB pick the speed.`,
    done: (state, g) => state.hour > g.h0,
    show: (state, ui) => { closeWindows(ui); return ['#tb-speed [data-action="speed"][data-speed="1"]', '#banner [data-action="speed"]']; },
  },
  home: {
    title: "Bring a team home", why: "What a team finds is only yours to use once it is home: then it goes into the base's stores and armory (or the team keeps it for the next trip). Every team of yours reports what it sees as it goes and takes orders anywhere; Return home calls it in.",
    done: (state, g) => homeTeams(state, g).some((x) => x.who.some((id) => { const s = state.survivors.find((y) => y.id === id); return s && s.alive && s.location && s.location.kind === "base"; })),
    show: (state, ui, act, g) => {
      const out = g.sent.map((x) => state.parties.find((p) => p.id === x.id)).find(Boolean);
      if (!out) return showSite(state, ui, act); // nobody out yet: send one first
      openTeam(state, ui, act, out);
      ui.tab = "teams"; // the Teams tab lists it too, with its own Return home
      act["panel-toggle"]({ p: "left", v: "0" });
      return ['[data-action="xp-order"][data-type="home"]', '[data-action="gohome"]'];
    },
  },
  diary: {
    title: "Read the diary", why: "Every day of the run is written down: what happened while you looked away, who did what. J opens it.",
    touch: "Every day of the run is written down: what happened while you looked away, who did what. 📖 Diary in the top bar (⋯ on a phone) opens it.",
    pad: "Every day of the run is written down: what happened while you looked away, who did what. 📖 Diary in the top bar opens it.",
    done: (state, g, ui) => !!ui.diary,
    show: (state, ui) => { closeWindows(ui); return ['[data-action="dy-open"]']; },
  },
  raid: {
    title: "Raid a place", why: "When a team reaches a site, pick the place to go into (one not found yet needs a survey first) and play it turn by turn on its map: search the containers, keep the noise down (every turn and every noise raises Heat, and Heat brings the dead) and leave from a green exit with what you carry. Shift+A lets the AI play your side.",
    touch: "When a team reaches a site, pick the place to go into (one not found yet needs a survey first) and play it turn by turn on its map: search the containers, keep the noise down (every turn and every noise raises Heat, and Heat brings the dead) and leave from a green exit with what you carry. AI plays my side lets the AI play it.",
    done: (state, g) => g.raided != null || homeTeams(state, g).some((x) => x.mission === "scavenge"),
    show: (state, ui, act, g) => {
      const out = g.sent.map((x) => state.parties.find((p) => p.id === x.id)).find(Boolean);
      if (!out) return showSite(state, ui, act); // nobody out yet: send one first
      openTeam(state, ui, act, out);
      return ['[data-action="xp-order"][data-mission="scavenge"]', '[data-action="xp-order"][data-type="mission"]', '[data-action="xp-move"]'];
    },
  },
  food: {
    title: "Get food coming in", why: "What you carried from home runs out within days. Put someone on Forage, Hunt or Fish (the job drop-down beside their name: wild food within 2 tiles, game at dawn and dusk, fish on a river or lake), or send a team out to forage or hunt, or scavenge a grocery or a farm. The Food tab shows what you have by kind and how long it keeps.",
    done: (state, g) => atBaseAs(state, ["forage", "hunt", "fish"]) || foodHeld(state) >= (g.fLow ?? Infinity) + GUIDE.FOOD_GAIN, // on such a job this hour, or food held up on the least seen
    show: (state, ui, act) => (openHub(state, ui, act, "overview") ? ['[data-action="role"]', '[data-action="basetab"][data-tab="food"]'] : openTeam(state, ui, act) ? ['[data-action="xp-order"][data-type="forage"]'] : []),
  },
  farm: {
    title: "Dig a farm plot", get why() { return `Foraging and hunting thin the land out; crops are what feed a holdout through the winter. Queue a Farm plot on the Construction tab (${costText(BUILDINGS.farm_plot.cost)}, and a shovel at the base to dig it: scavenge one or craft a makeshift one), place it on good soil on the base map and put someone on Farm: crops take weeks to ripen, so the sooner the better.`; },
    done: (state, g) => plotCount(state) > (g.p0 || 0), // a plot more than the base started with
    show: (state, ui, act) => (openHub(state, ui, act, "construction") ? ['[data-action="queuebuild"][data-type="farm_plot"]', '[data-action="basetab"][data-tab="construction"]'] : noCamp(state, ui, act)),
  },
  boiler: {
    title: "Build a water boiler", get why() { return `Water from a river, a lake or a rain catcher is raw and can carry the worm. The camp fire boils a little at a time; a Water boiler (Construction tab: ${costText(BUILDINGS.boiler.cost)}, and a wrench or a toolkit at the base) boils everything the base draws before it is drunk, for a little wood a day a head.`; },
    done: (state, g) => countAt(state, (t) => t === "boiler") > (g.w0 || 0), // queued or standing, more than at the start
    show: (state, ui, act) => (openHub(state, ui, act, "construction") ? ['[data-action="queuebuild"][data-type="boiler"]', '[data-action="basetab"][data-tab="construction"]'] : noCamp(state, ui, act)),
  },
  hold: {
    title: "Hold off the attack", why: "Something has come for the camp: a band of nomads by day, a horde of the dead by night, a few more than your people. Defend opens the fight on the base's map: place your people (the wounded back, the guns where they can see the way in), then start it. Your first defence and someone on Guard help; hiding instead costs you some of the stores.",
    touch: "Something has come for the camp: a band of nomads by day, a horde of the dead by night, a few more than your people. Defend opens the fight on the base's map: place your people (the wounded back, the guns where they can see the way in), then Start the fight. Your first defence and someone on Guard help; hiding instead costs you some of the stores.",
    done: (state, g) => { const a = g.attack; if (!a || a.quiet) return false; const b = state.bases.find((x) => x.id === a.base); return !b || (!(b.campAttack && b.campAttack.wave) && !state.combat && !(state.cards || []).some((c) => c.campAttack === b.id || c.firstWeek === b.id)); }, // fought or hidden from, and over
    hidden: (g) => !(g.attack && !g.attack.quiet), // not shown (or counted) until it comes (sim/firstweekattack.js)
    show: (state, ui, act) => (openHub(state, ui, act, "construction") ? ['[data-action="cxtab"][data-tab="defenses"]', '[data-action="basetab"][data-tab="work"]'] : noCamp(state, ui, act)),
  },
  defence: {
    title: "Keep watch: a lookout or a first defence", get why() { return `The dead wander in, and raiders come for what you hold; something has been watching you all week, and it will come before the week is out. Put someone on Guard (the job drop-down beside their name): a guard meets trouble first and counts 1.5× in a fight. With the tools for it, the Construction tab's Defenses list has more: the ring wall's stake fence (${costText(BUILDINGS.walls.cost)}, a hammer and a saw), barbed wire, spike pits.`; },
    done: (state, g) => countAt(state, isDefence) > (g.d0 || 0) || guardsAt(state) > (g.gd0 || 0), // a defence queued or standing, or a guard more than at the start
    show: (state, ui, act) => (openHub(state, ui, act, "overview") ? ['[data-action="role"]', '[data-action="basetab"][data-tab="construction"]'] : noCamp(state, ui, act)),
  },

  // The road start (Normal and Hardcore): no base yet.
  team: {
    title: "Meet your team", why: "These are the people who got out with you, on the road with no home yet. Click the team on the map (or find it on the Teams tab) to open its panel: its orders, its people and everything they carry. What they carry is all you have for now: some food and water, a tent bag each.",
    done: (state, g, ui) => ui.expedition != null && state.parties.some((p) => p.id === ui.expedition && p.owner === "player"),
    show: (state, ui, act) => (openTeam(state, ui, act) ? ['[data-action="xp-move"]', "#right h2"] : []),
  },
  water: {
    title: "Find water", why: "Thirst kills in days, sooner than hunger. Look for a river or lake (Fetch water from the shore) or search a shop, diner or church on the way. Raw water can carry the worm: boil it on a lit camp fire, filter it or use tablets. Forage as you go to stretch the food.",
    done: (state, g) => state.bases.length > 0 || waterHeld(state) >= g.wLow + GUIDE.WATER_GAIN,
    show: (state, ui, act) => {
      const p = openTeam(state, ui, act);
      if (!p) return [];
      const w = waterSource(state, partyTile(p), 8);
      if (w) { act.center({ tile: w.tile }); }
      return ['[data-action="xp-order"][data-type="water"]', '[data-action="xp-move"]'];
    },
  },
  fire: {
    title: "Gather wood and stone for a camp fire", get why() { return `Every camp starts with a fire, and the team has to carry what it takes: ${fireText()}. The team panel's Land row has Cut wood… and Gather stone… (both by daylight; stone is easiest in hills and mountains). A few hours of each is plenty.`; },
    done: (state) => state.bases.length > 0 || fireCarried(state),
    show: (state, ui, act) => (openTeam(state, ui, act) ? ['[data-action="xp-order"][data-type="wood"]', '[data-action="xp-order"][data-type="stone"]'] : []),
  },
  camp: {
    title: `Set up your camp (${ESTABLISH_LABEL})`, why: `The camp is your first home: the barest base, your people in their tents round the fire. It grows into your hub where it stands, so pick the spot with care: beside a river or lake, with trees and sites to scavenge nearby and few of the dead. Take the team there and give the order ${ESTABLISH_LABEL}; the alert that follows opens the camp's build map to lay it out.`,
    done: (state) => state.bases.length > 0,
    show: (state, ui, act) => (openTeam(state, ui, act) ? ['[data-action="xp-order"][data-mission="establish"]', '[data-action="xp-move"]'] : []),
  },
  place: {
    title: "Place the shelter shack", get why() { return `The camp becomes a shelter once its Shelter shack stands, and it is yours to put where you want it: on the Camp tab press Place the shelter shack, then click its spot on the build map (R turns it; nothing is placed for you). It takes ${costText(BUILDINGS.camp_up.cost)}, gathered over the next days.`; },
    done: (state) => { const h = hub(state); return !!h && (!isCamp(h) || !!tierUpJob(h)); },
    show: (state, ui, act) => { const h = hub(state); if (h && isCamp(h)) { closeWindows(ui); act.openbase({ id: h.id, tab: "camp" }); return ['[data-action="tier-pick"]:not([disabled])', '[data-action="basetab"][data-tab="camp"]']; } return openTeam(state, ui, act) ? ['[data-action="xp-order"][data-mission="establish"]'] : []; },
  },
  needs: {
    title: "Bring in what the shelter needs", get why() { return `The shack takes ${costText(BUILDINGS.camp_up.cost)}. The builders make the building materials from scrap (${CAMP.matScrap} each); wood comes from your woodcutters and teams, scrap from the ruins. Whatever reaches the camp's stores goes into it as it comes in, and the Camp tab lists what is still missing.`; },
    done: (state) => { const h = hub(state); if (!h) return false; const job = isCamp(h) ? tierUpJob(h) : null; return !isCamp(h) || (!!job && gatherRows(job).every((r) => r.have + (h.stock[r.key] || 0) >= r.need - 1e-9)); }, // taken by the step up or waiting in the stores
    show: (state, ui, act) => { const h = hub(state); if (h && isCamp(h)) { closeWindows(ui); act.openbase({ id: h.id, tab: "camp" }); return [...(tierUpJob(h) ? [] : ['[data-action="tier-pick"]:not([disabled])']), '[data-action="tf-open"]', '[data-action="basetab"][data-tab="camp"]']; } return openTeam(state, ui, act) ? ['[data-action="xp-order"][data-mission="establish"]'] : []; },
  },
  found: {
    title: `Found your shelter by day ${GUIDE.DAYS}`, get why() { return `The week's goal, so there is no rush on day 1: water, food and a safe camp come first. With everything in, the camp's builders put the shack up (${BUILDINGS.camp_up.hours} work-hours; more hands and Mechanics go faster). When it stands the camp is a shelter: a roof, room to build, and later your hub.`; },
    done: (state) => state.bases.some((b) => b.type === "hub" && !isCamp(b)),
    show: (state, ui, act) => { const h = hub(state); if (h && isCamp(h)) { closeWindows(ui); act.openbase({ id: h.id, tab: "camp" }); return ['[data-action="basetab"][data-tab="camp"]', '[data-action="basetab"][data-tab="construction"]']; } return openTeam(state, ui, act) ? ['[data-action="xp-order"][data-mission="establish"]'] : []; },
  },
};
// Night n (1 to GUIDE.DAYS): each day of the week ends with one, ticked at its dawn. Night 1 keeps the id "night".
const ORDINAL = ["", "first", "second", "third", "fourth", "fifth", "sixth", "seventh"];
const NIGHT_WHY = [
  "",
  "Night runs from 20:00 to 06:00, and a team out sees only the tile it stands on. Your hub has no wall yet: its guards hold it through the night. A team in the field can set up camp (the barest base: its people rest there; a fire warms them and boils water, burns wood, and its light draws trouble).",
  "Everyone sleeps at night. Anyone without a bed or a tent sleeps rough: their mood drops every night, worse in the wet and the cold. A tired, unhappy holdout works slowly; the People tab shows how each one is.",
  "A team still out at dusk gets a choice: make camp and rest until morning, or push on tired and half blind. Teams that rest come home in better shape.",
  "A lit fire warms your people and boils the water, but its light can draw trouble at night. Its button puts it out when the dead are close.",
  "Watch the top bar's food and water days. People who go hungry or thirsty lose health every day and nobody heals until they eat and drink.",
  "If the dead come in the night, the people on Guard meet them first. Keep the wounded back and the gaps covered; a fight at the base opens its own map.",
  "The last night of your first week. Get through it and the week is yours: from here the alerts on the right keep telling you what needs you, and Help (?) has the rest.",
];
for (let n = 1; n <= GUIDE.DAYS; n++) {
  STEPS[n === 1 ? "night" : `night${n}`] = {
    title: `Get through the ${ORDINAL[n] || `${n}th`} night`, why: NIGHT_WHY[n] || NIGHT_WHY[NIGHT_WHY.length - 1],
    done: (state, g) => state.hour >= nightDawn(g, n),
    show: (state, ui, act) => {
      const p = state.bases.length ? null : openTeam(state, ui, act);
      if (p) return ['[data-action="xp-order"][data-mission="camp"]', '[data-action="campfire"]'];
      closeWindows(ui);
      ui.tab = "bases";
      act["panel-toggle"]({ p: "left", v: "0" });
      return ["#left .tabs + .card", "#tb-clock"];
    },
  };
}
// The same steps in the road's words (guideSteps): the night out or at the camp, wood for the shelter, a team sent
// from the camp.
const ROAD_WORDS = {
  night: { why: "Night runs from 20:00 to 06:00 and nobody sees far in the dark. At the camp the fire keeps your people warm and boils the water, but its light can draw the dead. Still on the road at dusk? Set up camp where you stand: a night's camp with the tents, struck again in the morning." },
  work: { title: "Put the camp on work priorities", why: "At the camp everyone starts on Build. On work priorities each person picks the most urgent job they are set for, hour by hour: the shelter, wood, water, wild food, a lookout when the dead come. One click sets everyone up; the Work tab sets who does what first." },
  wood: { get title() { return `Cut ${BUILDINGS.camp_up.cost.wood} wood for the shelter`; }, get why() { return `The shelter shack takes ${BUILDINGS.camp_up.cost.wood} wood, and the fire burns more every night: this ticks once the camp holds that much (or the shack has it). Put someone on Cut wood (the job drop-down beside their name) or mark trees to fell on the build map; a team out can cut wood and bring it home too.`; },
    done: (state) => { const h = hub(state); if (!h) return false; if (!isCamp(h)) return true; const need = BUILDINGS.camp_up.cost.wood, job = tierUpJob(h), row = job ? gatherRows(job).find((r) => r.key === "wood") : null; return (h.stock.wood || 0) + (row ? row.have : 0) >= need; } }, // the shack's wood in the stores or taken by it
  scavenge: {
    get why() { return `The shelter needs ${BUILDINGS.camp_up.cost.scrap} scrap and more, and scrap, parts, meds and ammo all come from the ruins. From the camp, click a site nearby, pick Scavenge / raid, choose who goes and launch; leave someone at the camp to work it. What they find is yours once they are back.`; },
    get pad() { return `The shelter needs ${BUILDINGS.camp_up.cost.scrap} scrap and more, and scrap, parts, meds and ammo all come from the ruins. ${PAD.X} on a site near the camp opens its menu: pick Scavenge / raid, choose who goes and launch; leave someone at the camp to work it. What they find is yours once they are back.`; },
  },
};
// The lists day by day (the user's request 2026-10-28: "is there something for each day up to the end of the first
// week? ... raids, setting work orders in the base etc; at the end of each day is get through the X night"): a few
// steps a day, each day ending with its night. Steps can be done in any order and on any day; the first one not done
// up to today is "next".
export const GUIDE_PHASES = {
  base: [
    { label: "Day 1", sub: "find your feet", ids: ["stores", "clock", "work", "night"] },
    { label: "Day 2", sub: "build and gather", ids: ["build", "wood", "night2"] },
    { label: "Day 3", sub: "into the ruins", ids: ["scavenge", "raid", "night3"] },
    { label: "Day 4", sub: "bring it home", ids: ["home", "food", "boiler", "night4"] },
    { label: "Day 5", sub: "food that lasts", ids: ["farm", "night5"] },
    { label: "Day 6", sub: "get ready", ids: ["defence", "night6"] },
    { label: "Day 7", sub: "look back on the week", ids: ["diary", "hold", "night7"] },
  ],
  road: [
    { label: "Day 1", sub: "off the road and through the night", ids: ["team", "clock", "water", "fire", "camp", "night"] },
    { label: "Day 2", sub: "set the camp to work", ids: ["work", "wood", "food", "night2"] },
    { label: "Day 3", sub: "into the ruins", ids: ["scavenge", "raid", "night3"] },
    { label: "Day 4", sub: "bring it home, plan the shelter", ids: ["home", "place", "boiler", "night4"] },
    { label: "Day 5", sub: "gather what the shelter needs", ids: ["needs", "farm", "night5"] },
    { label: "Day 6", sub: "get ready", ids: ["defence", "night6"] },
    { label: "Day 7", sub: "a roof at last", ids: ["found", "diary", "hold", "night7"] },
  ],
};
// What the attack waits for (sim/firstweekattack.js reads g.ready): the steps no missing tool can hold up (the
// playtest 2026-10-28: the boiler's wrench and the farm plot's shovel never turned up, and the attack never came).
export const GUIDE_READY = {
  base: ["stores", "clock", "work", "build", "scavenge", "raid", "home", "defence"],
  road: ["team", "clock", "water", "fire", "camp", "work", "scavenge", "raid", "home", "place", "defence"],
};
export const GUIDE_LISTS = Object.fromEntries(Object.entries(GUIDE_PHASES).map(([k, ph]) => [k, ph.flatMap((x) => x.ids)]));
const phasesOf = (g) => GUIDE_PHASES[g && g.kind] || GUIDE_PHASES.base;
// A step with its words (a getter's text read now) and its day (phase: an index into GUIDE_PHASES, day phase + 1).
const stepOf = (id, kind, phase) => ({ id, ...STEPS[id], ...(kind === "road" ? ROAD_WORDS[id] : null), phase });
// A step that is hidden (the attack before it comes) is left out: not shown, not counted.
export const guideSteps = (g) => phasesOf(g).flatMap((ph, i) => ph.ids.map((id) => stepOf(id, g && g.kind, i))).filter((st) => !(st.hidden && g && st.hidden(g)));
// Today's steps done of today's (the 🧭 First week button, the phone's chip, the card's count): { day, done, total }.
export function guideProgress(state, g) {
  const d = Math.min(guideDay(state, g), phasesOf(g).length);
  const ids = guideSteps(g).filter((st) => st.phase === d - 1).map((st) => st.id);
  return { day: d, done: ids.filter((id) => g.done[id] != null).length, total: ids.length };
}
export const guideStep = (id, kind = "base") => (STEPS[id] ? stepOf(id, kind, null) : null);

// ---------- show-me helpers ----------
function closeWindows(ui) {
  ui.baseView = null; ui.baseMsg = ""; ui.supplyForm = null;
  ui.diary = null; ui.roster = null; ui.survivor = null;
}
// The hub's screen at a tab (false when there is no hub).
function openHub(state, ui, act, tab) {
  const h = hub(state) || state.bases[0];
  closeWindows(ui);
  if (!h) return false;
  act.openbase({ id: h.id, tab });
  return true;
}
// No camp yet for a step that needs one: the team's Establish base comes first.
const noCamp = (state, ui, act) => (openTeam(state, ui, act) ? ['[data-action="xp-order"][data-mission="establish"]', '[data-action="xp-move"]'] : []);
// A team's panel (the road team, or the given one), centered, the right panel shown. Returns the team or null.
function openTeam(state, ui, act, p = null) {
  const team = p || roadTeam(state) || mine(state)[0];
  closeWindows(ui);
  if (!team) return null;
  act["xp-open"]({ id: team.id });
  act.center({ tile: partyTile(team) });
  act["panel-toggle"]({ p: "right", v: "0" });
  return team;
}
// The nearest site to the hub that a team could scavenge: its tile panel, with the Scavenge button to press. No base
// yet (the road): nothing is sent from a base (ui.js tileActions), so the team's panel, centered on the nearest site,
// with Move to walk there.
function showSite(state, ui, act) {
  const h = hub(state) || state.bases[0];
  const road = h ? null : openTeam(state, ui, act);
  if (h) { closeWindows(ui); ui.expedition = null; act["panel-toggle"]({ p: "right", v: "0" }); }
  const from = h ? h.tile : road ? partyTile(road) : null;
  const sels = road ? ['[data-action="xp-move"]'] : ['[data-action="plan"][data-mission="scavenge"]', '[data-action="pl-launch"]'];
  if (from == null) return sels;
  for (let r = 1; r <= GUIDE.SITE_REACH; r++) {
    const ring = state.grid.within(from, r).filter((id) => state.grid.distance(from, id) === r && state.tiles[id] && state.tiles[id].loc);
    const tile = road ? ring[0] : ring.find((id) => tileActions(state, id).some(([m]) => m === "scavenge"));
    if (tile != null) { act.center({ tile }); return sels; }
  }
  return sels;
}

// ---------- starting, checking, ending ----------
// A base past the camp stands (a hub start's hub, or the road's shelter founded): the road list is over.
const roadOver = (state) => state.bases.some((b) => !isCamp(b));
// A new guide for this world (main.js begin, or the menu). Nothing is made when it is off.
export function startGuide(state, on = true, { keep = false } = {}) {
  if (!on) return null;
  state.guide = {
    kind: roadOver(state) ? "base" : "road", on: true, keep: !!keep, fold: true, done: {}, // folded to its Next line until opened (the user's request 2026-10-24: the alerts' corner takes less of the map)
    h0: state.hour, b0: buildingCount(state), p0: plotCount(state), d0: countAt(state, isDefence), gd0: guardsAt(state), w0: countAt(state, (t) => t === "boiler"), sent: [], wLow: waterHeld(state), woodLow: hubWood(state), fLow: foodHeld(state), raided: null, seen: {}, ended: null,
  };
  return state.guide;
}
export const guideOn = (state) => !!(state && state.guide && state.guide.on);
// The new-run screen's box: on for the first campaign on this machine (no saves yet and never started one).
export const guideDefault = (options) => !(options && options.guideSeen) && !listSaves().length;

// Called on every redraw (main.js refresh, before the alerts): notes teams leaving and the water low, ticks off what is
// done (with a toast), and switches the guide off when all is done or the first week is over. Returns the steps just done.
export function guideCheck(state, ui) {
  const g = state && state.guide;
  if (!g || !g.on || !ui.started || state.gameOver) return [];
  if (!g.done) g.done = {};
  if (!g.sent) g.sent = [];
  if (!g.seen) g.seen = {}; // a save from before the tips
  const wood = hubWood(state);
  if (wood != null) g.woodLow = Math.min(g.woodLow ?? Infinity, wood); // from the first hour there is a hub (the road: the camp)
  noteAlert(state, ui, g);
  // Teams that set out from a base (any mission; on the road, from the camp), remembered by who is on them.
  for (const p of mine(state)) {
    if (p.homeBaseId == null || g.sent.some((x) => x.id === p.id)) continue;
    g.sent.push({ id: p.id, who: partyMembers(state, p).map((s) => s.id), mission: p.mission || null });
    if (g.sent.length > GUIDE.SENT_MAX) g.sent.shift();
  }
  if (g.kind === "road") g.wLow = Math.min(g.wLow ?? Infinity, waterHeld(state));
  g.fLow = Math.min(g.fLow ?? Infinity, foodHeld(state));
  if (g.raided == null && state.combat && state.combat.raid && !state.combat.drill) g.raided = state.hour; // a raid's map is up: a place raided
  const steps = guideSteps(g);
  const fresh = [];
  for (const st of steps) {
    if (g.done[st.id] != null) continue;
    let ok = false;
    try { ok = !!st.done(state, g, ui); } catch { ok = false; } // a step that cannot tell stays open
    if (ok) { g.done[st.id] = state.hour; fresh.push(st); }
  }
  const n = steps.filter((st) => g.done[st.id] != null).length;
  if (g.attack && !g.attack.quiet && g.attackTold == null) { // the attack has come: its step shows from now
    g.attackTold = state.hour;
    ui.guideSel = "hold";
    ui.flash = { text: `⚔ First week: ${g.attack.kind === "nomads" ? "nomads are at the camp" : "a horde of the dead is at the camp"}. A new step: Hold off the attack.`, at: now() };
  }
  // The steps it waits for done: the seventh day's attack may come (sim/firstweekattack.js reads g.ready).
  if (g.ready == null && (GUIDE_READY[g.kind] || GUIDE_READY.base).every((id) => g.done[id] != null)) g.ready = state.hour;
  if (fresh.length) {
    if (ui.guidePulse && fresh.some((st) => st.id === ui.guidePulse.step)) ui.guidePulse.until = 0;
    const pr = guideProgress(state, g), ph = phasesOf(g)[pr.day - 1];
    const dawn = fresh.some((st) => /^night\d*$/.test(st.id)); // a night just over: the new day says what it is about
    ui.flash = { text: `✔ First week: ${fresh.map((st) => st.title).join("; ")} (${ph.label}: ${dawn ? `${ph.sub}, ${pr.done} of ${pr.total} done` : `${pr.done} of ${pr.total}`})`, at: now() };
  }
  const over = !g.keep && state.hour >= nightDawn(g, GUIDE.DAYS); // the dawn after the seventh night
  if (n === steps.length) endGuide(state, ui, "done", "✔ First week: every step done, the seventh night behind you. The guide steps aside; the menu brings it back.");
  else if (over) endGuide(state, ui, n === steps.length ? "done" : "days", `The first week is over: the guide steps aside after day ${GUIDE.DAYS}.${g.ready == null ? " Some of the week's steps were left undone, so nothing came for the camp." : ""}${g.kind === "road" && g.done.found == null && isCamp(hub(state)) ? " No shelter yet: the camp's Camp tab shows what it still needs." : ""} The menu (Game tab) brings it back.`);
  return fresh;
}
function endGuide(state, ui, why, text) {
  const g = state.guide;
  g.on = false;
  g.ended = why;
  ui.guideTip = null;
  ui.guideNote = null;
  if (ui.guidePulse) ui.guidePulse.until = 0;
  if (text) ui.flash = { text, at: now() };
}

// ---------- new things: a note the first time each comes up ----------
// help: a Help topic id (ui/help.js helpTopics; guidetest checks they exist).
const CARD_TIP = "Cards that stop the clock wait for your answer; the rest go to the tray at the top of the map while the clock runs and take their safest answer if left 8 hours.";
export const POPUP_TIPS = {
  raidplan: { icon: "🗺", title: "Before you go in", text: "Your team has reached the site. Pick the side to go in from (a scout sent first tells you more; waiting for night makes you harder to see, and harder for you to see), or Leave to call it off. Team inventory sorts their kit before they go.", help: "choices-before-a-raid" },
  raid: { icon: "🔦", title: "The raid map", text: "Turn by turn: click one of your people, then a cell to move or a container to search (Shift+S); Space ends the turn. Every turn and every noise raises Heat, and Heat brings more of the dead. Leave from a green exit (X) with what you carry. Shift+A lets the AI play your side.", help: "raids-scavenging-a-site",
    touch: "Turn by turn: tap one of your people, then a cell to move or a container to search; End turn ends the turn. Every turn and every noise raises Heat, and Heat brings more of the dead. Leave from a green exit (Extract) with what you carry. AI plays my side lets the AI play your side.",
    pad: `Turn by turn: LB RB pick one of your people, ${PAD.A} on a cell moves or searches the container there, ${PAD.X} takes the orders bar; ${PAD.Y} ends the turn. Every turn and every noise raises Heat, and Heat brings more of the dead. Leave from a green exit (Extract) with what you carry.` },
  battle: { icon: "⚔", title: "A fight", text: "Turn by turn: click one of your people, then move, shoot or strike; Space ends the turn. Shift+A lets the AI play your side; Shift+R sounds the retreat.", help: "battles",
    touch: "Turn by turn: tap one of your people, then move, shoot or strike; End turn ends the turn. AI plays my side lets the AI play your side; Sound the retreat (🏳️) pulls everyone out.",
    pad: `Turn by turn: LB RB pick one of your people, ${PAD.A} moves, shoots or strikes at the cursor, ${PAD.X} takes the orders bar; ${PAD.Y} ends the turn.` },
  defence: { icon: "🛡", title: "Your base is attacked", text: "The fight is at your base: place your people, then start the fight (Enter). Keep the gaps covered and the wounded back. Shift+A lets the AI play your side; Shift+R falls back to the yard.", help: "defending-your-base",
    touch: "The fight is at your base: place your people, then Start the fight. Keep the gaps covered and the wounded back. AI plays my side lets the AI play your side; Fall back to the yard falls back.",
    pad: `The fight is at your base: place your people (${PAD.A} on one, then on a green cell), then ${PAD.Y} starts the fight. Keep the gaps covered and the wounded back.` },
  buildmap: { icon: "📐", title: "The base map", text: "Your base from above: place what is queued (R turns it), mark trees for the woodcutters to fell, move tents and storage. Builders work where things are placed.", help: "bases-manage",
    touch: "Your base from above: place what is queued (Turn turns it), mark trees for the woodcutters to fell, move tents and storage. Builders work where things are placed.",
    pad: "Your base from above: place what is queued (Turn turns it), mark trees for the woodcutters to fell, move tents and storage. Builders work where things are placed." },
  crawl: { icon: "🏙", title: "A city crawl", text: "A city is too big for one raid: pick the block to go in at, then go block by block. Each block's card shows its places and the ways on; slip away or walk out at the rim.", help: "raids-scavenging-a-site" },
  unpack: { icon: "🎒", title: "A team is home", text: "Put what they carried away into the base's stores and armory, or let them keep everything for the next trip.", help: "inventory" },
  poipick: { icon: "📍", title: "Which place?", text: "A tile can hold several places. Pick the one to go into; one not found yet needs a survey of the tile first.", help: "places-on-a-tile-surveys-and-raids" },
  recruit: { icon: "🙋", title: "Someone asks to join", text: "More hands work and fight, but they also eat, drink and need a bed, and a stranger can bring illness or trouble. Look them over before you say yes.", help: "traits" },
  conflict: { icon: "⚠", title: "An encounter", text: "Something stands in your team's way. Each answer shows its odds: slipping away or talking can avoid a fight; fighting opens a battle.", help: "groups" },
  hubevent: { icon: "🏠", title: "Life at the hub", text: `Quarrels, peddlers, a leaking roof: things happen at home too. ${CARD_TIP}`, help: "pause-rules-and-the-card-tray" },
  perk: { icon: "⭐", title: "A skill milestone", text: "Someone got better at what they do: pick a perk now, or Decide later and pick it on their survivor screen.", help: "traits" },
  morale: { icon: "💬", title: "Someone is unhappy", text: "Low mood leads to quarrels, breaks and people walking out. Answer here; beds, food, free time and a lighter load help for good.", help: "hunger-thirst-and-mood" },
  outbreak: { icon: "🦠", title: "Illness is spreading", text: "Several people are ill and it is catching. Keep them apart; a medic with meds treats them.", help: "medical" },
  band: { icon: "🚶", title: "Another band on the road", text: "Others got out too. Trade news, share food, ask for help or go on your way.", help: "groups" },
  visitors: { icon: "🧳", title: "Travellers", text: "People from outside the state come by. Hear them out: some trade, some want help, some are trouble.", help: "outsiders" },
  lone: { icon: "🩸", title: "Someone attacked alone", text: "One of yours is caught on their own. Fight it out on the map, or let it be settled by the numbers.", help: "battles" },
  newhome: { icon: "🏡", title: "A home of your own", text: "The shelter stands. Open the build map to lay it out; its Construction tab builds it up from here.", help: "bases-manage" },
  nightfall: { icon: "🌙", title: "Night falls", text: "Your team is still on the move as it gets dark. Making camp rests them until morning; pushing on gets there sooner, tired and in the dark.", help: "night-on-the-map" },
  horde: { icon: "🧟", title: "A horde is coming", text: "The dead are heading your way. Answer how to meet them; people with Guard set go to the walls.", help: "defending-against-hordes" },
  orders: { icon: "❗", title: "A team needs orders", text: "The team got where it was going and waits. Pick its next move here, or later from its panel (Tab cycles through the waiting teams).", help: "team-panel" },
  trade: { icon: "🤝", title: "A trade", text: "Someone offers to trade. Weigh what you give against what you are short of.", help: "trade-window" },
  parley: { icon: "📣", title: "Talking in a raid", text: "Another group is on this map. What you say decides whether they fight you, leave you be or join you.", help: "groups" },
  road: { icon: "🚶", title: "On the road", text: `A team in the field met something. Read each answer's odds. ${CARD_TIP}`, help: "sending-a-team" },
  card: { icon: "🃏", title: "A card", text: `Something happened and a card asks what to do. ${CARD_TIP}`, help: "pause-rules-and-the-card-tray" },
};
// The first alert of each kind: one line at the top of the guide's card. kinds: the alert kinds it covers (ui/alerts.js).
export const ALERT_TIPS = [
  { id: "a-wait", kinds: ["wait", "plan"], title: "A team waits for orders", text: "Click the alert (or press Tab) to open its panel: search, move on, camp or Return home.", help: "team-panel",
    touch: "Tap the alert (or ❗ Next team) to open its panel: search, move on, camp or Return home.",
    pad: `${PAD.Y} goes to it and opens its panel: search, move on, camp or Return home.` },
  { id: "a-cards", kinds: ["cards"], title: "Cards in the tray", text: "Cards that do not stop the clock wait in the tray at the top of the map. Open them when you like; left 8 hours they take their safest answer.", help: "pause-rules-and-the-card-tray" },
  { id: "a-nowork", kinds: ["nowork"], title: "No work for some roles", text: "They help elsewhere for the hour. Queue something for them, give them another job, or put them on work priorities.", help: "bases-manage" },
  { id: "a-stalled", kinds: ["stalled"], title: "A job cannot go on", text: "Something has kept a job from working for two days (no trees in reach, nothing to build…). Hover the alert to see why.", help: "bases-manage" },
  { id: "a-layout", kinds: ["layout"], title: "Open the build map", text: "A base new to you or just grown: lay out where things go on its map. U opens the selected base's map.", help: "bases-manage",
    touch: "A base new to you or just grown: lay out where things go on its map. The base window's Base map tab opens it.",
    pad: "A base new to you or just grown: lay out where things go on its map. The base window's Base map tab opens it." },
  { id: "a-food", kinds: ["food", "starve", "teamfood", "roadfood"], title: "Food is running low", text: "Farm, forage, hunt, or scavenge a grocery or a farm. The Food tab shows what you have by kind and how long it keeps.", help: "food-and-the-winter" },
  { id: "a-water", kinds: ["water", "thirst", "roadwater"], title: "Water is running low", text: "Thirst kills faster than hunger. Wells, rain catchers and filters keep it coming; a team can fetch it from a river or lake.", help: "water-and-the-summer" },
  { id: "a-needs", kinds: ["needs"], title: "Hungry or thirsty", text: "People who go without lose health every day and nobody heals. Hover the alert for who, and bring them food and water.", help: "hunger-thirst-and-mood" },
  { id: "a-wood", kinds: ["wood", "cold"], title: "Wood and the cold", text: "The heating, the water boiler and the kitchen burn wood. Put people on Cut wood or send a team to cut it, and have the pile in before the cold.", help: "wood" },
  { id: "a-worm", kinds: ["worm"], title: "The worm", text: "Raw water and the game of the dead carry its eggs. Boil the water, cook the food, and treat whoever has it.", help: "catching-the-worm-and-curing-it" },
  { id: "a-sick", kinds: ["sick", "ill", "nomeds", "spread"], title: "Someone is ill", text: "A medic with meds treats them and the badly ill rest. Some illness spreads: keep the sick apart.", help: "medical" },
  { id: "a-dead", kinds: ["horde", "tower", "breakin", "gathering"], title: "The dead near a base", text: "When they come, the people with Guard set go to the walls. Walls, a watchtower and lights help you hold.", help: "defending-against-hordes" },
  { id: "a-desert", kinds: ["desert"], title: "Someone may leave", text: "Their mood is low enough to walk out. Talk to them, give them rest, a bed and food; free time lifts it.", help: "hunger-thirst-and-mood" },
  { id: "a-broken", kinds: ["broken"], title: "Something broke", text: "A fixture or machine is down. A Mechanic with parts fixes it.", help: "machines-and-machine-parts" },
  { id: "a-trip", kinds: ["trip"], title: "Repeat the trip?", text: "A team you sent from the planner is home: one click sends it again the same way.", help: "templates-repeat-trip-and-undo" },
  { id: "a-camp", kinds: ["campalone"], title: "Nobody at the camp", text: "An empty camp does nothing, and left alone for days scavengers may loot it. Keep someone there.", help: "hardcore-mode" },
];
const ALERT_TIP = new Map(ALERT_TIPS.map((t) => [t.id, t]));
const helpBtn = (sec) => (sec ? `<button class="gd-btn" data-action="help-open" data-sec="${esc(sec)}"${tip("More in Help")}>?</button>` : "");

// What window is up that a note could be about: { id, ref } (ref: the card, or the battle's setup, which outlives the
// battle being made again as the raid's plan closes, so the note stays on that one while it is up), or null. Windows the player opens (the base, the diary…) get none.
function cardTip(state, c) {
  if (!c || c.intro) return null; // the Hardcore start's opening card says it all
  if (c.parley != null) return "parley";
  if (c.recruit) return "recruit";
  if (c.poiPick) return "poipick";
  if (c.hcBand != null) return "band";
  if (c.kind === "conflict") return "conflict";
  if (c.hubEvent) return "hubevent";
  if (c.perkFor != null) return "perk";
  if (c.moraleFor != null) return "morale";
  if (c.outbreakBase != null) return "outbreak";
  if (c.visitorId != null) return "visitors";
  if (c.attack) return "lone";
  if (c.mapBase != null) return "newhome";
  if (c.title === "Night falls") return "nightfall";
  const k = cardKind(state, c);
  if (k === "horde") return "horde";
  if (k === "orders") return "orders";
  if (k === "trade") return "trade";
  return c.partyId != null ? "road" : "card";
}
export function popupOf(state, ui) {
  if (!ui.started || ui.settings || ui.timelapse || state.gameOver) return null;
  const kind = modalKind(state, ui);
  const b = state.combat;
  const ref = b && (b.setup || b);
  if (kind === "raidplan") return { id: "raidplan", ref };
  if (kind === "card") { const c = state.cards[0]; const id = cardTip(state, c); return id ? { id, ref: c } : null; }
  if (kind === "unpack" || kind === "crawl") return { id: kind, ref: kind };
  if (kind || !b || b.over) return null;
  if (b.site) return null; // the camp's spot (sim/basemap.js openSiteView): its own panel says it all
  if (b.layout) return { id: "buildmap", ref };
  if (b.setup && b.setup.layout === "baseDefence" && !b.setup.drill) return { id: "defence", ref };
  return { id: b.raid && !b.drill ? "raid" : "battle", ref };
}

// The note over the windows (main.js writes it into #guidetip after the windows). Told once: marked seen when shown.
export function renderGuideTip(state, ui) {
  const g = state && state.guide;
  if (!g || !g.on) { ui.guideTip = null; return ""; }
  if (!g.seen) g.seen = {};
  const p = popupOf(state, ui);
  const cur = ui.guideTip;
  if (!p) { if (cur && !ui.settings) ui.guideTip = null; return ""; } // Help over it: kept for when Help closes
  if (!cur || cur.id !== p.id || cur.ref !== p.ref) {
    ui.guideTip = null;
    if (g.seen[p.id] != null || !POPUP_TIPS[p.id]) return "";
    g.seen[p.id] = state.hour;
    ui.guideTip = { id: p.id, ref: p.ref };
  }
  if (ui.guideTip.hide) return "";
  const t = POPUP_TIPS[p.id];
  const onMap = !modalKind(state, ui) && !!state.combat; // a battle's own map: the note goes top middle, clear of the squad list
  return `<div class="gdtip${onMap ? " onmap" : ""}"><div class="gd-head"><span class="gd-title">🧭 New: ${t.icon} ${esc(t.title)}</span>${helpBtn(t.help)}<button class="gd-btn" data-action="gd-tip-ok"${tip("Got it: hide this note")}>✕</button></div><div class="gd-why">${padHtml(esc(sayFor(t)))}</div></div>`;
}

// The first alert of a kind not told yet becomes the card's note (guideCheck; ui.alertList is the stack as last shown).
function noteAlert(state, ui, g) {
  const kinds = new Set((ui.alertList || []).map((a) => a && a.kind));
  if (ui.guideNote && !(ALERT_TIP.get(ui.guideNote) || { kinds: [] }).kinds.some((k) => kinds.has(k))) ui.guideNote = null; // the alert cleared
  if (ui.guideNote) return;
  const t = ALERT_TIPS.find((x) => g.seen[x.id] == null && x.kinds.some((k) => kinds.has(k)));
  if (!t) return;
  g.seen[t.id] = state.hour;
  ui.guideNote = t.id;
}
function noteHTML(g, ui) {
  const t = ui.guideNote && ALERT_TIP.get(ui.guideNote);
  if (!t) return "";
  return `<div class="gd-note"><div class="gd-head"><span class="gd-name"><b>New:</b> ${esc(t.title)}</span>${helpBtn(t.help)}<button class="gd-btn" data-action="gd-note-ok"${tip("Got it")}>✕</button></div><div class="gd-why">${padHtml(esc(sayFor(t)))}</div></div>`;
}

// ---------- the card under the alerts ----------
// Its own box over the map (#guide, under the alerts to start; ui/hudbar.js placeGuide), shown or hidden by the 🧭 First
// week button at the bottom left of the map (ui/layout.js layout.guide). Folded, a slim tab as the other boxes have
// (hidden under the bar, whose button is the tab).
export function guideTab(state, ui) {
  const g = state && state.guide;
  if (!g || !g.on || !ui.started || state.gameOver || state.combat || ui.timelapse) return "";
  const pr = guideProgress(state, g);
  return panelTab({ icon: "🧭", title: "First week", badges: [{ text: `Day ${pr.day} · ${pr.done}/${pr.total}`, tip: `Day ${pr.day}: ${pr.done} of ${pr.total} steps done` }], action: "panel-toggle", data: { p: "guide", v: "0" }, tip: "Show the first-week guide" });
}
export function renderGuide(state, ui) {
  const g = state && state.guide;
  if (!g || !g.on || !ui.started || state.gameOver || state.combat || ui.timelapse) return "";
  const note = noteHTML(g, ui);
  const steps = guideSteps(g);
  const phases = phasesOf(g);
  const today = guideDay(state, g), pr = guideProgress(state, g);
  const open = steps.filter((st) => g.done[st.id] == null);
  // Next: the step picked, else the first one open up to today, else the first one open.
  const cur = open.find((st) => st.id === ui.guideSel) || open.find((st) => st.phase < today) || open[0];
  const n = steps.length - open.length;
  const head = `<div class="gd-head"><span class="gd-title"${tip("The first-week guide: a few steps a day, each day ending with its night. Steps tick off by themselves as you do them, in any order and on any day. Show me opens the screen and pulses the button to press.")}>🧭 First week</span>
    <span class="gd-count"${tip(`Day ${pr.day}: ${pr.done} of ${pr.total} steps done · the week: ${n} of ${steps.length}`)}>Day ${pr.day} · ${pr.done}/${pr.total}</span>
    <button class="gd-btn" data-action="help-open" data-sec="start-here"${tip("Help: Start here, the game in a few lines")}>?</button>
    <button class="gd-btn" data-action="gd-fold"${tip(g.fold ? "Show the steps" : "Fold the guide to one line")}>${g.fold ? "▸" : "▾"}</button>
    <button class="gd-btn" data-action="gd-close"${tip("Hide the guide (⚙ Menu → Game brings it back)")}>✕</button></div>`;
  if (g.fold) return `<div class="guide folded">${head}${note}${cur ? `<div class="gd-next small">Next: ${esc(cur.title)}</div>` : ""}</div>`;
  const row = (st) => {
    if (g.done[st.id] != null) return `<div class="gd-step done"${tip(sayFor(st, "why"))}><span class="gd-mark">✔</span><span class="gd-name">${esc(st.title)}</span></div>`;
    const on = cur && st.id === cur.id;
    return `<div class="gd-step${on ? " cur" : ""}"><button class="gd-go" data-action="gd-pick" data-id="${st.id}"${tip(sayFor(st, "why"))}><span class="gd-mark">${on ? "▶" : "○"}</span>${esc(st.title)}</button>` +
      `<button class="gd-show" data-action="gd-show" data-id="${st.id}"${tip("Open the screen for this step and point at the button to press")}>Show me</button></div>` +
      (on ? `<div class="gd-why">${padHtml(esc(sayFor(st, "why")))}</div>` : "");
  };
  // A day: today in full; an earlier day only what is still open on it (one line once it is all done); a later day one
  // line, opened by a click (ui.guidePeek) to see what is coming.
  const days = phases.map((ph, i) => {
    const d = i + 1, its = steps.filter((st) => st.phase === i), left = its.filter((st) => g.done[st.id] == null);
    const peek = ui.guidePeek === d;
    const label = `<b>${esc(ph.label)}</b> · ${esc(ph.sub)}`;
    const line = (cls, extra, t) => `<button class="gd-phase gd-dayline${cls}${i ? "" : " first"}" data-action="gd-day" data-day="${d}"${tip(t)}>${peek ? "▾" : "▸"} ${label}${extra}</button>`;
    if (d === today) return `<div class="gd-phase today${i ? "" : " first"}">${label} <span class="gd-today">today</span>${left.length ? "" : " ✔"}</div>${its.map(row).join("")}`;
    if (d < today && left.length && !peek) return `<div class="gd-phase${i ? "" : " first"}">${label} <span class="gd-late">still to do</span></div>${left.map(row).join("")}`;
    if (d < today) return line(" past", left.length ? "" : " ✔", peek ? "Fold this day" : "Show this day's steps") + (peek ? its.map(row).join("") : "");
    return line(" later", its.length - left.length ? ` <span class="gd-late">${its.length - left.length}/${its.length}</span>` : "", peek ? "Fold this day" : "What this day is about: its steps, ready whenever you are") + (peek ? its.map(row).join("") : "");
  }).join("");
  return `<div class="guide">${head}${note}${days}</div>`;
}

// Pulses what "Show me" points at (main.js calls it after each redraw; the panels are HTML strings, so the class is
// put back on whatever was rebuilt). A new pulse restarts the animation on elements that kept the class.
export function guidePulse(ui, doc = typeof document !== "undefined" ? document : null) {
  if (!doc) return;
  const P = ui.guidePulse;
  const live = !!P && now() < P.until;
  const want = new Set();
  if (live) for (const s of P.sels) { try { for (const el of doc.querySelectorAll(s)) want.add(el); } catch { /* a bad selector pulses nothing */ } }
  for (const el of [...doc.querySelectorAll(".gd-pulse")]) if (!want.has(el) || (P && P.fresh)) el.classList.remove("gd-pulse");
  if (!live) { ui.guidePulse = null; return; }
  if (P.fresh) { P.fresh = false; void (doc.body && doc.body.offsetWidth); } // restart the animation
  for (const el of want) el.classList.add("gd-pulse");
}

// ---------- actions (main.js registers them: fn(state, ui, data, act)) ----------
export const GUIDE_ACTIONS = {
  "gd-show": (state, ui, d, act) => {
    const g = state.guide;
    const st = g && guideSteps(g).find((x) => x.id === d.id);
    if (!st) return;
    ui.guideSel = st.id;
    const sels = st.show(state, ui, act, g) || [];
    ui.guidePulse = { step: st.id, sels, until: now() + GUIDE.PULSE_MS, fresh: true };
  },
  "gd-pick": (state, ui, d) => { ui.guideSel = d.id; },
  "gd-day": (state, ui, d) => { ui.guidePeek = ui.guidePeek === Number(d.day) ? null : Number(d.day); }, // a day's line: its steps shown or folded
  "gd-fold": (state) => { if (state.guide) state.guide.fold = !state.guide.fold; },
  "gd-close": (state, ui) => { if (state.guide) endGuide(state, ui, "closed", "First-week guide hidden. ⚙ Menu → Game brings it back."); },
  "gd-tip-ok": (state, ui) => { ui.guideTip = ui.guideTip ? { ...ui.guideTip, hide: true } : null; }, // ✕ on a window's note: hidden until the next one
  "gd-note-ok": (state, ui) => { ui.guideNote = null; },
};

// The menu's Game tab (ui/settings.js): show the guide again (a fresh one for a save that never had it) or hide it.
export function guideMenuRow(state, ui) {
  if (!ui.started || state.gameOver) return "";
  const on = guideOn(state);
  return `<div class="setrow"><button data-action="gd-toggle"${tip(on ? "Hide the first-week checklist under the alerts" : "Show the first-week checklist under the alerts again: steps for a new holdout, with Show me buttons. Brought back by hand, it stays past day 7 until you hide it or finish it.")}>🧭 ${on ? "Hide" : "Show"} the first-week guide</button>
    <button class="mini" data-action="set-help" data-sec="start-here"${tip("Help: Start here")}>?</button></div>`;
}
export const GUIDE_MENU_ACTIONS = {
  "gd-toggle": (state, ui) => {
    const S = ui.settings;
    if (guideOn(state)) { endGuide(state, ui, "closed", ""); if (S) { S.msg = "The first-week guide is hidden."; S.err = false; } return; }
    const g = state.guide;
    const done = g ? guideSteps(g).every((st) => g.done[st.id] != null) : false;
    if (!g || done || (g.kind === "road" && roadOver(state))) startGuide(state, true, { keep: true }); // a fresh list (none yet, finished, or the road is over)
    else Object.assign(g, { on: true, keep: true, ended: null });
    if (S) { S.msg = "The first-week guide is back under the alerts."; S.err = false; }
  },
};
