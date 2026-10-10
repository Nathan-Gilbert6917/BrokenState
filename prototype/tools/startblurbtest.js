// The run's opening (2026-10-09, the user: "remove the list of orders, just show the blurb and start the team paused
// and waiting for orders"): a Hardcore run opens on a plain blurb card (hardcore-start.js introCard: the title, what
// they grabbed, one Begin button, no orders on it), the team stands waiting for orders with no orders card (the
// alerts' "Waiting for orders" row, the team panel's orders), the game starts paused (main.js begin: speed 0, and an
// order never unpauses it), the guide points at the team panel, and the autopilot gives the first order from the
// waiting state. A Normal start opens on no card at all.
// Usage: node tools/startblurbtest.js
import { readFileSync } from "node:fs";
import { createWorld, tickHour } from "../src/sim/world.js";
import { partyTile, orderOptions } from "../src/sim/parties.js";
import { roadTeam, INTRO_TITLE } from "../src/sim/hardcore-start.js";
import { cardKind, defaultChoice } from "../src/sim/cardrules.js";
import { cardUp, cardPauses } from "../src/ui/pacing.js";
import { setAutopilot, autopilotResolve } from "../src/sim/autopilot.js";
import { renderModal, renderRight } from "../src/ui/ui.js";
import { computeAlerts } from "../src/ui/alerts.js";
import { guideSteps, startGuide } from "../src/ui/guide.js";
import { saveToString, loadFromString } from "../src/sim/save.js";

let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const hc = (seed) => createWorld({ seed, factionCount: 7, mode: "hardcore" });
const freshUi = () => ({ started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView: null, expedition: null, diary: null, roster: null, help: false, scale: 1, armed: { parties: new Map(), builds: new Set(), crafts: new Set() } });

section("Hardcore: the run opens on the blurb, one button, no orders");
for (const seed of [11, 42, 77, 303]) {
  const st = hc(seed);
  const p = roadTeam(st);
  const tag = `seed ${seed}`;
  if (!check(!!p, `${tag}: a team on the road`)) continue;
  const intro = st.cards.find((c) => c.intro);
  check(!!intro && st.cards[0] === intro && intro.title === INTRO_TITLE, `${tag}: the first card is "${INTRO_TITLE}"`);
  if (!intro) continue;
  check(/^Calder is falling\./.test(intro.text) && intro.text.includes(st.hardcore.start.grabbed[0]), `${tag}: the blurb tells what they grabbed`);
  check(intro.choices.length === 1 && intro.choices[0].label === "Begin" && !intro.choices[0].uiAction, `${tag}: one Begin button (${intro.choices.map((c) => c.label).join(", ")})`);
  check(!intro.isOrders && intro.partyId == null, `${tag}: not an orders card, not about the team`);
  check(!st.cards.some((c) => c.isOrders || c.partyId === p.id), `${tag}: no orders card for the team`);
  const html = renderModal(st, freshUi()) || "";
  const buttons = (html.match(/data-action="choice"/g) || []).length;
  check(html.includes(INTRO_TITLE) && buttons === 1 && html.includes(">Begin"), `${tag}: the popup on screen has the title and one button (${buttons})`);
  const orderLabels = orderOptions(st, p).map((o) => o.label).filter(Boolean);
  check(!orderLabels.some((l) => html.includes(`>${l}<`)), `${tag}: none of the team's orders on the popup`);
  // Pause rules: it always shows (never waits in the tray), and Begin is its answer.
  check(cardKind(st, intro) === "always" && defaultChoice(st, intro) === intro.choices[0], `${tag}: it always pops up, Begin its answer`);
  const ui = freshUi();
  check(cardUp(st, ui) && cardPauses(intro), `${tag}: it is up over the map and stops the clock`);
  // The team: waiting for orders, the alert row, the panel's orders.
  check(p.phase === "waiting" && p.dest === partyTile(p) && !p.task && !(p.orders || []).length, `${tag}: the team waits for orders where it stands`);
  const al = computeAlerts(st);
  check(al.some((a) => a.kind === "wait" && a.go && a.go.team === p.id && /^Waiting for orders/.test(a.text)), `${tag}: the alerts show "Waiting for orders"`);
  const panel = renderRight(st, { ...freshUi(), expedition: p.id }) || "";
  check(/data-action="xp-order"/.test(panel), `${tag}: the team panel has its orders`);
  // Begin closes it: nothing else happens, nothing is left up.
  st.cards.shift();
  const said = intro.choices[0].resolve(st);
  check(said === "" && p.phase === "waiting" && !st.cards.some((c) => c.partyId === p.id), `${tag}: Begin closes it; the team still waits, no card raised`);
  check(!st.cards.some((c) => c.intro), `${tag}: no blurb left after Begin`);
  // Saves (a card waiting cannot be saved): once it is closed the world saves and loads waiting.
  st.cards.length = 0;
  const ld = loadFromString(saveToString(st));
  const lp = roadTeam(ld);
  check(!!lp && lp.phase === "waiting" && !ld.cards.length, `${tag}: a save after Begin keeps the team waiting`);
}

section("Paused at the start: main.js begin stops the clock, an order never unpauses it");
{
  const main = readFileSync(new URL("../src/main.js", import.meta.url), "utf8");
  const begin = main.slice(main.indexOf("  begin: () => {"), main.indexOf("  restart: () =>"));
  check(begin.length > 0 && /ui\.started = true;/.test(begin) && /ui\.speed = 0;/.test(begin), "begin starts the game with the speed at 0 (paused)");
  const xp = readFileSync(new URL("../src/ui/expedition.js", import.meta.url), "utf8");
  check(/giving an order never unpauses it/.test(xp), "the convention holds: an order given while paused starts when you unpause");
  check(!/ui\.speed = (ui\.lastSpeed|1)/.test(begin), "begin does not set the clock running");
}

section("The guide's road list points at the team panel, not a card's choices");
{
  const st = hc(42);
  const g = startGuide(st, true);
  check(g && g.kind === "road", "a hubless start picks the road list");
  const act = new Proxy({}, { get: () => () => {} });
  for (const s of guideSteps(g).filter((x) => ["team", "water", "camp", "needs", "found"].includes(x.id))) {
    const sels = s.show(st, freshUi(), act) || [];
    check(sels.length > 0 && sels.every((x) => !/data-action="choice"/.test(x)) && sels.some((x) => /xp-|#right/.test(x)), `${s.id}: ${sels.join(" ")}`);
  }
}

section("The autopilot: closes the blurb and gives the first order from the waiting state");
for (const seed of [9000, 9013]) {
  const st = hc(seed);
  st.started = true;
  setAutopilot(st, true, "balanced");
  const p = roadTeam(st);
  autopilotResolve(st);
  check(!st.cards.some((c) => c.intro), `seed ${seed}: the blurb is closed`);
  check(!st.log.some((l) => /The day Calder fell →/.test(l.text)), `seed ${seed}: closed quietly (no "→ Begin" line)`);
  let moved = false, h = 0;
  for (; h < 24 && !moved; h++) {
    tickHour(st);
    const q = st.parties.find((x) => x.id === p.id);
    moved = !q || q.phase !== "waiting" || !!q.task || (q.orders || []).length > 0 || !!st.staging;
  }
  check(moved, `seed ${seed}: the team has its first order within ${h} hour${h === 1 ? "" : "s"}`);
  let err = null;
  try { for (let i = 0; i < 24 * 3 && !st.gameOver; i++) { autopilotResolve(st); tickHour(st); } } catch (e) { err = e; }
  check(!err, `seed ${seed}: three days under the autopilot${err ? `: ${err.message}` : ""}`);
}

section("Normal: a start with a hub opens on no card");
{
  const st = createWorld({ seed: 42, factionCount: 7 });
  check(st.mode === "normal" && !st.cards.length, `no card at the start (${st.cards.map((c) => c.title).join(", ")})`);
  check(!st.parties.some((p) => p.owner === "player"), "no team on the road");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
