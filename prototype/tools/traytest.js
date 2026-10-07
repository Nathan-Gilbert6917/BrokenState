// Pause rules, the card tray and the 5× speed (sim/cardrules.js, ui/pacing.js), without a browser.
// Usage: node tools/traytest.js [days] [seeds...]     (default 60 days, seeds 1 2 3)
// - kinds: every card the autopilot runs raise gets a kind; the known cards land in the right one
// - defaults: never a disabled choice, one that needs the map or a fight; Orders → Hold here, Storm → Shelter…
// - the tray in a browser-like loop (autopilot off after a few days): pausing cards stop the clock, the others wait,
//   take their default after TRAY_HOURS with a log line, their teams hold still, stale cards leave quietly
// - options: the switches, saved and sanitized; the speeds and keys 1–5; drop to 1× at 3× and 5×
// - pacing: clock stops per in-game day before (every card) and after (the default rules), from autopilot runs
// - 5× on the Huge map: the time one in-game hour takes to simulate (a hitch every 4 s at 5×)
import { readFileSync } from "node:fs";
import { createWorld, tickHour, day, hub, atBase, log } from "../src/sim/world.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { launchExpedition, ordersCard, partyTile, onTheMove } from "../src/sim/parties.js";
import { hordeCard } from "../src/sim/events.js";
import { perkCard } from "../src/sim/skills.js";
import { extract } from "../src/sim/scavenge.js";
import { endTrade } from "../src/sim/trade.js";
import { attitude } from "../src/sim/factions.js";
import { PAUSE_KINDS, DEFAULT_PAUSE, TRAY_HOURS, cardKind, defaultChoice, usableChoices, autoAnswer, trayStale } from "../src/sim/cardrules.js";
import {
  SPEEDS, MAX_SPEED, speedForKey, initPacing, pacingOptions, cardUp, trayCards, pileCount, trayEsc, pacingFrame, beforeHour, afterHour, afterRefresh,
  trayHTML, trayCardFrame, pacingOptionsHTML, pauseWhyHTML, pacingHelp, PACE_ACTIONS,
} from "../src/ui/pacing.js";

const args = process.argv.slice(2);
const DAYS = Number(args[0] || 60);
const SEEDS = args.length > 1 ? args.slice(1).map(Number) : [1, 2, 3];
let passed = 0, failed = 0;
function check(ok, what) {
  if (ok) passed++;
  else { failed++; console.log(`  FAIL ${what}`); }
}
const section = (t) => console.log(`\n== ${t}`);
const KINDS = new Set([...PAUSE_KINDS.map((k) => k.key), "always"]);
const off = (st, c) => (typeof c.disabled === "function" ? c.disabled(st) : !!c.disabled);

// ---------- options and speeds ----------
section("Options and speeds");
{
  const o = { pacing: { pause: { combat: false, trade: "yes" }, drop: 3 } };
  const p = pacingOptions(o);
  check(p.pause.combat === false && p.pause.trade === DEFAULT_PAUSE.trade && p.drop === true, "bad switches fall back to the defaults, good ones stay");
  check(PAUSE_KINDS.every((k) => typeof p.pause[k.key] === "boolean"), "every kind has a switch");
  check(DEFAULT_PAUSE.combat && DEFAULT_PAUSE.raid && DEFAULT_PAUSE.death && DEFAULT_PAUSE.contact && DEFAULT_PAUSE.hostile && DEFAULT_PAUSE.horde && DEFAULT_PAUSE.orders && !DEFAULT_PAUSE.trade && !DEFAULT_PAUSE.other, "defaults: the big moments pause, trade visitors and other cards wait in the tray");
  check(JSON.stringify(SPEEDS) === "[0.5,1,2,3,5]" && MAX_SPEED === 5, "speeds 0.5 1 2 3 5, 5× the fastest normal speed");
  check(["Digit1", "Digit2", "Digit3", "Digit4", "Digit5"].map(speedForKey).join() === "0.5,1,2,3,5" && speedForKey("Numpad5") === 5 && speedForKey("Digit6") == null && speedForKey("KeyA") == null, "keys 1–5 pick the speeds");
  const saved = [];
  const opts = { autosave: true };
  initPacing(opts, (x) => saved.push(JSON.stringify(x)));
  const w = createWorld({ seed: 5, factionCount: 4 });
  PACE_ACTIONS["pace-opt"](w, {}, { k: "other" });
  check(opts.pacing.pause.other === true && saved.length === 1 && JSON.parse(saved[0]).pacing.pause.other === true, "a switch flips and is saved with the options");
  PACE_ACTIONS["pace-opt"](w, {}, { k: "other" });
  PACE_ACTIONS["pace-opt"](w, {}, { k: "nonsense" });
  check(opts.pacing.pause.other === false && saved.length === 2, "flips back; an unknown switch does nothing");
  const html = pacingOptionsHTML();
  check(PAUSE_KINDS.every((k) => html.includes(k.label)) && html.includes("Drop to 1×") && !/undefined|NaN/.test(html), "Options → Pause for… lists every switch and the drop to 1×");
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  // The speed keys go through the key table (ui/keymap.js time.speed1–5) to SPEEDS.
  check(/time\\.speed\(\[1-5\]\)/.test(main) && /SPEEDS\[Number\(speed\[1\]\) - 1\]/.test(main) && /PACE_ACTIONS/.test(main) && /"tray-rules"/.test(main) && /cardUp\(state, ui\) \|\| !!state\.engagement/.test(main), "main.js: speed keys, tray actions and the pause rule in blocked()");
  check(/beforeHour\(state, ui\)[\s\S]{0,200}tickHour\(state\);\s*\n\s*afterHour\(state, ui\)/.test(main), "main.js: the tray's hour runs around each tick");
  const ui = readFileSync(new URL("../src/ui/ui.js", import.meta.url), "utf8");
  check(/\[5, "5×"/.test(ui) && /cardUp\(state, ui\)\) return \["card"/.test(ui), "ui.js: a 5× button; the card window follows the pause rules");
  const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");
  check(readme.includes("| 1–5 |") && /card tray/i.test(readme) && /Pause for…/.test(readme), "README: keys 1–5, the card tray and the pause rules");
  const help = pacingHelp();
  check(help.includes(`${TRAY_HOURS} in-game hours`) && !/undefined|NaN/.test(help), "Help topic: pause rules and the card tray");
}

// ---------- kinds and defaults on known cards ----------
section("Kinds and defaults");
const W = createWorld({ seed: 7, factionCount: 5 });
W.started = true;
const H = hub(W);
const crew = atBase(W, H.id).filter((s) => !s.leader).slice(0, 2);
const dest = W.tiles.find((t) => t.terrain !== "water" && W.grid.distance(t.id, H.tile) === 4).id;
const team = launchExpedition(W, { memberIds: crew.map((s) => s.id), dest, mission: "move", stance: "normal", supplies: { food: 6, water: 6 } }).party;
check(!!team, "a team to test with");
{
  const oc = ordersCard(W, team, "");
  check(cardKind(W, oc) === "orders" && defaultChoice(W, oc).label === "Hold here", "Orders card: kind orders, default Hold here");
  const hc = hordeCard(W, team, { size: 30, tile: partyTile(team), mix: null });
  check(cardKind(W, hc) === "combat" && /^Hide/.test(defaultChoice(W, hc).label), "Horde in the path: combat, default Hide");
  W.cards.length = 0;
  perkCard(W, crew[0], "scavenging", 3);
  const pk = W.cards.pop();
  if (pk) check(cardKind(W, pk) === "other" && defaultChoice(W, pk).label === "Decide later", "Perk point: other, default Decide later");
  const mk = (title, choices, extra = {}) => ({ title, text: "", choices, ...extra });
  const ok = [{ label: "OK", resolve: () => "" }];
  check(cardKind(W, mk("The leader is dead", [{ label: "Mara (Leadership 3)", resolve: () => "" }])) === "death", "The leader is dead: death");
  check(cardKind(W, mk(`Raiders heading for ${H.name}`, [{ label: "Prepare defenses", resolve: () => "" }])) === "raid", "Raiders heading for: raid");
  check(cardKind(W, mk("Raid defense", ok)) === "raid" && cardKind(W, mk("Overrun", ok)) === "raid", "raid reports: raid");
  check(cardKind(W, mk(`Horde heading for ${H.name}`, [{ label: "Man the defences", resolve: () => "" }])) === "horde", "Horde heading for: horde");
  check(cardKind(W, mk("Iron Jackals asks you to join their war", [{ label: "Not this time", resolve: () => "" }])) === "hostile", "a war call: hostile");
  check(cardKind(W, mk("Storm", [{ label: "Shelter and wait (6 hours)", resolve: () => "" }, { label: "Push through", resolve: () => "" }], { partyId: team.id })) === "other", "a road event: other");
  check(cardKind(W, mk("Trade caravan at Elm", ok, { isCaravan: true })) === "trade" && cardKind(W, mk("On the radio: X", ok, { radioFrom: 1 })) === "trade", "caravans and radio offers: trade");
  check(cardKind(W, mk("x", ok, { kind: "conflict" })) === "combat", "a conflict: combat");
  check(cardKind(W, mk("x", ok, { battle: true })) === "always", "a card over a battle always pauses");
  check(cardKind(W, mk("x", [{ label: "Move to another tile…", uiAction: { type: "move" }, resolve: () => "" }])) === "always", "a card whose answers need the map always pauses");
  check(cardKind(W, mk("x", [{ label: "Fight", fight: {}, resolve: () => "" }])) === "always", "a card with nothing but a fight always pauses");
  const dis = mk("x", [{ label: "OK", disabled: true, resolve: () => "" }, { label: "Leave it", resolve: () => "" }, { label: "Fight", fight: {}, resolve: () => "" }]);
  check(defaultChoice(W, dis).label === "Leave it", "never a disabled choice");
  const storm = mk("Storm", [{ label: "Push through", resolve: () => "" }, { label: "Shelter and wait (6 hours)", resolve: () => "" }]);
  check(defaultChoice(W, storm).label === "Shelter and wait (6 hours)", "Storm: Shelter and wait");
  const marked = mk("x", [{ label: "Leave it", resolve: () => "" }, { label: "Help", default: true, resolve: () => "" }]);
  check(defaultChoice(W, marked).label === "Help", "an explicit default wins");
  const odds = mk("x", [{ label: "Sneak around", hint: "Stealth 60%", resolve: () => "" }, { label: "Treat it (1 meds)", resolve: () => "" }]);
  check(defaultChoice(W, odds).label === "Treat it (1 meds)", "no gamble when there is a sure thing");
  // Stale: a card about a person or group that is gone.
  check(trayStale(W, mk("x", ok, { moraleFor: 999999 })) !== "" && trayStale(W, mk("x", ok, { radioFrom: 999999 })) !== "" && trayStale(W, mk("x", ok, { visitorId: 999999 })) !== "", "cards about a person, group or visitor that is gone are out of date");
  check(trayStale(W, mk("x", ok, { partyId: team.id })) === "", "a card about a team still out is not");
  // autoAnswer: resolves, logs, never throws.
  W.cards.length = 0;
  let ran = 0;
  const c1 = mk("Test card", [{ label: "Fight", fight: {}, resolve: () => { ran = 2; return ""; } }, { label: "Leave it", resolve: () => { ran = 1; return "You leave it."; } }]);
  W.cards.push(c1);
  const line = autoAnswer(W, c1);
  check(ran === 1 && !W.cards.includes(c1) && /took its default: Leave it\. You leave it\./.test(line) && W.log[0].text === line, "auto-answer: the default runs, the card goes, a log line says so");
  const c2 = mk("Broken card", [{ label: "OK", resolve: () => { throw new Error("boom"); } }]);
  W.cards.push(c2);
  const err = console.error;
  console.error = () => {};
  let threw = false;
  try { autoAnswer(W, c2); } catch { threw = true; }
  console.error = err;
  check(!threw && !W.cards.includes(c2), "a choice that throws is dropped, never stops the game");
  const c3 = mk("Gone", ok, { radioFrom: 999999 });
  W.cards.push(c3);
  autoAnswer(W, c3);
  check(!W.cards.includes(c3) && /no longer applies: the group is gone/.test(W.log[0].text), "a stale card is dropped with a log line");
}

// ---------- a team holds while its card waits ----------
section("A team holds while its card waits");
{
  initPacing({}, () => {});
  const ui = { started: true, speed: 1, lastSpeed: 1, trayOpen: null };
  W.cards.length = 0;
  const card = { title: "Storm", text: "", partyId: team.id, choices: [{ label: "Shelter and wait (6 hours)", resolve: () => "" }, { label: "Push through", resolve: () => "" }] };
  W.cards.push(card);
  pacingFrame(W, ui);
  check(onTheMove(team) && !cardUp(W, ui) && trayCards(W).includes(card), "a road card for a team on the move waits in the tray");
  const idx0 = team.idx;
  for (let i = 0; i < 4; i++) { beforeHour(W, ui); tickHour(W); afterHour(W, ui); W.cards = W.cards.filter((c) => c === card); }
  check(team.idx === idx0 && W.cards.includes(card), `the team holds where it is while it waits (4 hours: tile ${idx0} → ${team.idx})`);
  W.cards.length = 0;
  for (let i = 0; i < 4; i++) { beforeHour(W, ui); tickHour(W); afterHour(W, ui); W.cards.length = 0; }
  check(team.idx > idx0 || !onTheMove(team), "answered, it moves on");
}

// ---------- the tray in a browser-like loop ----------
section("The tray in a browser-like loop");
{
  // Every switch off: every card that can wait goes to the tray (the hardest test of it).
  initPacing({ pacing: { pause: Object.fromEntries(PAUSE_KINDS.map((k) => [k.key, false])), drop: true } }, () => {});
  const st = createWorld({ seed: 11, factionCount: 6 });
  st.started = true;
  setAutopilot(st, true, "aggressive"); // a few days of the governor so teams are out and about
  while (day(st) <= 6 && !st.gameOver) tickHour(st);
  setAutopilot(st, false);
  st.autoCombat = true; // battles by the numbers (no map in a test)
  const ui = { started: true, speed: 5, lastSpeed: 5, trayOpen: null };
  let pausing = 0, trayIn = 0, autoLines = 0, held = 0, heldMoved = 0, maxTray = 0, crashes = 0, stuck = 0;
  const seenIds = new Set();
  let lines = 0; // log lines of cards that answered themselves or were dropped (state.log keeps only 200)
  const unshift = st.log.unshift.bind(st.log);
  st.log.unshift = (...a) => { for (const l of a) if (/took its default|no longer applies/.test(l.text)) lines++; return unshift(...a); };
  for (let h = 0; h < 24 * 6 && !st.gameOver; h++) {
    let guard = 0;
    for (; guard < 60; guard++) {
      pacingFrame(st, ui);
      if (cardUp(st, ui)) {
        const c = st.cards[0];
        if (!seenIds.has(c.tray.id)) { seenIds.add(c.tray.id); pausing++; }
        // The player answers: the default (any enabled choice would do).
        const ch = defaultChoice(st, c) || usableChoices(st, c)[0];
        st.cards.shift();
        if (ch) { try { ch.resolve(st); } catch (e) { crashes++; console.log("   ", c.title, e.message); } }
        continue;
      }
      if (st.engagement) { extract(st); continue; }
      if (st.trade) { endTrade(st); continue; }
      if (st.combat) { st.combat = null; continue; }
      break;
    }
    if (guard >= 60) stuck++;
    for (const c of trayCards(st)) if (!seenIds.has(c.tray.id)) { seenIds.add(c.tray.id); trayIn++; }
    maxTray = Math.max(maxTray, trayCards(st).length);
    // Teams with a card in the tray that are on the move should not move this hour.
    const watch = [];
    for (const c of trayCards(st)) { const p = st.parties.find((x) => x.id === c.partyId); if (p && onTheMove(p) && !watch.some((w) => w.p === p)) watch.push({ p, tile: partyTile(p), idx: p.idx }); }
    try {
      beforeHour(st, ui);
      tickHour(st);
      afterHour(st, ui);
    } catch (e) { crashes++; console.log("    tick:", e.message); }
    for (const w of watch) {
      if (!st.parties.includes(w.p) || !trayCards(st).some((c) => c.partyId === w.p.id)) continue; // answered or gone
      held++;
      if (w.p.idx > w.idx) heldMoved++;
    }
    if (ui.speed === 0) ui.speed = 1; // an event pause: the player runs the clock again
  }
  autoLines = lines;
  console.log(`  6 days, autopilot off, every switch off: ${pausing} cards stopped the clock, ${trayIn} went to the tray (most at once ${maxTray}), ${autoLines} answered themselves or were dropped, ${held} team-hours held`);
  check(crashes === 0, "no errors in the loop");
  check(stuck === 0, "nothing keeps the clock stopped for good");
  check(trayIn > 0 && autoLines > 0, "cards went to the tray and answered themselves after their time");
  check(trayCards(st).every((c) => st.hour - c.tray.at <= TRAY_HOURS), `no tray card waits past ${TRAY_HOURS} hours`);
  check(heldMoved === 0, `teams with a card in the tray hold where they are (${held} team-hours, ${heldMoved} moved)`);
  // The tray's HTML and the card frame.
  const fake = { title: "Storm", text: "A violent storm rolls in.", choices: [{ label: "Shelter and wait (6 hours)", resolve: () => "" }, { label: "Push through", resolve: () => "" }] };
  st.cards.push(fake);
  pacingFrame(st, ui);
  const html = trayHTML(st, ui);
  check(/data-action="tray-open" data-id="\d+"/.test(html) && html.includes("Storm") && html.includes(`${TRAY_HOURS}h`) && /tray-defaults/.test(html) && /tray-rules/.test(html) && !/undefined|NaN|null/.test(html), "the tray: a chip with icon, title and hours left; ✓ all and ⚙");
  check(!cardUp(st, ui) && pileCount(st) === st.cards.filter((c) => !trayCards(st).includes(c)).length, "a tray card does not put a window up");
  PACE_ACTIONS["tray-open"](st, ui, { id: String(fake.tray.id) });
  check(cardUp(st, ui) && st.cards[0] === fake, "clicking a chip opens that card (first in the pile)");
  const framed = trayCardFrame(st, ui, `<div class="box"><h1>Storm</h1></div>`);
  check(/class="tray-note"/.test(framed) && /tray-close/.test(framed) && /Shelter and wait/.test(framed), "the opened card says when it answers itself and has Back to the tray");
  check(trayEsc(st, ui) && !cardUp(st, ui) && st.cards.includes(fake), "Esc puts it back in the tray, unanswered");
  PACE_ACTIONS["tray-defaults"](st, ui, {});
  check(!st.cards.includes(fake) && trayCards(st).length === 0, "✓ all answers the tray with its defaults");
  ui.pauseWhy = "Mara died";
  check(pauseWhyHTML(ui).includes("Mara died"), "the paused banner says why");
}

// ---------- drop to 1× and the event pauses ----------
section("Drop to 1× and stops without a card");
{
  initPacing({}, () => {});
  const st = createWorld({ seed: 13, factionCount: 5 });
  st.started = true;
  const ui = { started: true, speed: 5, lastSpeed: 5, trayOpen: null };
  pacingFrame(st, ui);
  beforeHour(st, ui);
  st.cards.push({ title: "Storm", text: "", choices: [{ label: "Shelter and wait (6 hours)", resolve: () => "" }] });
  afterHour(st, ui);
  check(ui.speed === 1 && ui.flash && /Storm/.test(ui.flash.text), "5×: a tray card drops the clock to 1×");
  ui.speed = 2;
  beforeHour(st, ui);
  st.cards.push({ title: "Storm 2", text: "", choices: [{ label: "Shelter and wait (6 hours)", resolve: () => "" }] });
  afterHour(st, ui);
  check(ui.speed === 2, "2× stays 2×");
  st.cards.length = 0;
  ui.speed = 3;
  beforeHour(st, ui);
  const victim = st.survivors.find((s) => s.alive && !s.leader);
  victim.alive = false;
  afterHour(st, ui);
  check(ui.speed === 0 && ui.lastSpeed === 1 && /died/.test(ui.pauseWhy || ""), "a death stops the clock (Space goes back at 1×)");
  ui.speed = 1;
  pacingFrame(st, ui);
  check(ui.pauseWhy == null, "the reason goes once the clock runs");
  const f = st.factions.find((x) => !x.known);
  if (f) {
    beforeHour(st, ui);
    f.known = true;
    afterHour(st, ui);
    check(ui.speed === 0 && /first contact/.test(ui.pauseWhy || ""), "a first contact stops the clock");
    ui.speed = 1;
    f.goodwill = 0;
    beforeHour(st, ui);
    f.goodwill = -80;
    afterHour(st, ui);
    check(ui.speed === 0 && /turned hostile/.test(ui.pauseWhy || "") && attitude(f) === "Hostile", "a group turning hostile stops the clock");
  }
  // Alerts: a new red alert slows, a new horde alert near a base stops.
  ui.speed = 5;
  ui.alertList = [];
  afterRefresh(st, ui);
  ui.alertList = [{ key: "starve:1", kind: "starve", tone: "danger", text: "The hub is out of food" }];
  afterRefresh(st, ui);
  check(ui.speed === 1, "a new red alert drops 5× to 1×");
  ui.alertList.push({ key: "horde:9", kind: "horde", tone: "warn", text: "Horde of 40, 5 tiles from the hub" });
  afterRefresh(st, ui);
  check(ui.speed === 0 && /Horde of 40/.test(ui.pauseWhy || ""), "a new horde near a base stops the clock");
  // Switched off: nothing.
  const o2 = { pacing: { pause: { death: false, horde: false }, drop: false } };
  initPacing(o2, () => {});
  ui.speed = 5;
  beforeHour(st, ui);
  st.survivors.find((s) => s.alive && !s.leader).alive = false;
  st.cards.push({ title: "Storm 3", text: "", choices: [{ label: "Shelter and wait (6 hours)", resolve: () => "" }] });
  afterHour(st, ui);
  ui.alertList.push({ key: "horde:10", kind: "horde", tone: "danger", text: "Horde of 50" });
  afterRefresh(st, ui);
  check(ui.speed === 5, "with the switches off: no stop and no drop");
  initPacing({}, () => {});
}

// ---------- every card of real runs ----------
section(`Every card in ${SEEDS.length} autopilot runs of ${DAYS} days (before and after)`);
{
  const totals = { days: 0, cards: 0, stopsBefore: 0, stopsAfter: 0, pausing: 0, tray: 0, events: 0, byKind: {}, titles: {}, noDefault: 0, badDefault: [] };
  for (const seed of SEEDS) {
    const st = createWorld({ seed, factionCount: 8 });
    st.started = true;
    const hoursBefore = new Set(), hoursAfter = new Set();
    const cards = st.cards;
    const seen = new WeakSet();
    let tick = 0; // the hour being simulated (cards and stops of one tick count as one stop)
    st.cards = new Proxy(cards, {
      set(t, prop, v, r) {
        if (v && typeof v === "object" && v.choices && !seen.has(v)) {
          seen.add(v);
          let kind = "?";
          try { kind = cardKind(st, v); } catch (e) { kind = "error"; }
          totals.cards++;
          totals.byKind[kind] = (totals.byKind[kind] || 0) + 1;
          const tk = `${kind}: ${String(v.title).replace(/\d+/g, "#").slice(0, 40)}`;
          totals.titles[tk] = (totals.titles[tk] || 0) + 1;
          hoursBefore.add(tick);
          if (kind === "always" || DEFAULT_PAUSE[kind]) { hoursAfter.add(tick); totals.pausing++; } else totals.tray++;
          const d = defaultChoice(st, v);
          if (!d) totals.noDefault++;
          else if (d.uiAction || d.fight || off(st, d)) totals.badDefault.push(v.title);
        }
        return Reflect.set(t, prop, v, r);
      },
    });
    setAutopilot(st, true, "balanced");
    while (day(st) <= DAYS && !st.gameOver) {
      const alive = new Set(st.survivors.filter((s) => s.alive).map((s) => s.id));
      const known = new Set(st.factions.filter((f) => f.known).map((f) => f.id));
      const hostile = new Set(st.factions.filter((f) => f.known && attitude(f) === "Hostile").map((f) => f.id));
      tick = st.hour;
      tickHour(st);
      const died = st.survivors.some((s) => alive.has(s.id) && !s.alive && !s.left);
      const met = st.factions.some((f) => f.known && !known.has(f.id));
      const turned = st.factions.some((f) => f.known && known.has(f.id) && f.alive !== false && attitude(f) === "Hostile" && !hostile.has(f.id));
      if (died || met || turned) { totals.events++; hoursAfter.add(tick); }
    }
    const nd = Math.max(1, day(st) - 1);
    totals.days += nd;
    totals.stopsBefore += hoursBefore.size;
    totals.stopsAfter += hoursAfter.size;
  }
  check(!totals.byKind["?"] && !totals.byKind.error, "every card gets a kind");
  check(Object.keys(totals.byKind).every((k) => KINDS.has(k)), `kinds are known ones (${Object.keys(totals.byKind).join(", ")})`);
  check(totals.badDefault.length === 0, `no default is disabled, needs the map or is a fight (${totals.badDefault.slice(0, 3).join(", ")})`);
  const per = (n) => (n / totals.days).toFixed(2);
  const gap = (n, speed) => { const s = (totals.days * 24 * 20) / speed / Math.max(1, n); return s >= 60 ? `${(s / 60).toFixed(1)} min` : `${Math.round(s)} s`; };
  console.log(`  ${totals.days} campaign-days, ${totals.cards} cards (${per(totals.cards)} a day): ${totals.pausing} would stop the clock, ${totals.tray} would wait in the tray; ${totals.noDefault} with no default (always stop)`);
  console.log(`  by kind: ${Object.entries(totals.byKind).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k} ${n}`).join(", ")}; stops with no card (death, contact, turned hostile): ${totals.events}`);
  console.log(`  clock stops a day: before ${per(totals.stopsBefore)} (every card), after ${per(totals.stopsAfter)} (default rules)`);
  console.log(`  real time between stops: before ${gap(totals.stopsBefore, 1)} at 1×, ${gap(totals.stopsBefore, 3)} at 3×; after ${gap(totals.stopsAfter, 1)} at 1×, ${gap(totals.stopsAfter, 3)} at 3×, ${gap(totals.stopsAfter, 5)} at 5×`);
  const top = Object.entries(totals.titles).sort((a, b) => b[1] - a[1]).slice(0, 18);
  console.log(`  most common: ${top.map(([k, n]) => `${k} ×${n}`).join(" | ")}`);
  check(totals.stopsAfter < totals.stopsBefore, "the default rules stop the clock less often than every card did");
}

// ---------- 5× on the Huge map ----------
section("5× on the Huge map");
{
  const st = createWorld({ seed: 21, factionCount: 12, size: "huge" });
  st.started = true;
  setAutopilot(st, true, "balanced");
  for (let i = 0; i < 24; i++) tickHour(st); // warm up
  const times = [];
  for (let i = 0; i < 72; i++) { const t0 = performance.now(); tickHour(st); times.push(performance.now() - t0); }
  times.sort((a, b) => a - b);
  const avg = times.reduce((a, b) => a + b, 0) / times.length, p95 = times[Math.floor(times.length * 0.95)], max = times[times.length - 1];
  console.log(`  one in-game hour on Huge: ${avg.toFixed(1)} ms average, ${p95.toFixed(1)} ms p95, ${max.toFixed(1)} ms worst; at 5× that is one hour every 4 s (${(0.25).toFixed(2)} ticks a second)`);
  check(avg < 250, "an hour simulates well inside the 4 s it has at 5× (the loop runs at most 12 a frame and drops a backlog)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
