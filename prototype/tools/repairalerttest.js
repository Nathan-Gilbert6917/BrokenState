// A breakdown repaired on the road says when the team is running again (sim/repairwait.js, sim/events.js breakdownCard,
// ui/alerts.js "fixed"): exactly one log line and one alert when the repair's wait is over (2 hours, 8 on a failed
// check, 1 with a spare part), the team moving again; clicking it opens the team and centres on it; a new one flashes
// over the stack. Other delays tell nothing; a team or vehicle gone during the wait tells nothing; a save made during
// the wait keeps it (and an old save without the marker is fine); bikes are "fixed"; a second breakdown repaired during
// the wait joins the first (one alert for both). The chime (ui/audio.js "repaired", ui/soundcues.js worldCues): once per
// alert, wherever the camera is, in the Card chimes group, silent when muted. Options → Good news alerts (ui/alerts.js
// GOOD_NEWS, ui/saves.js goodNews): off, no row, flash or chime for good news (the log keeps the line); warnings and
// dangers unaffected; the switch is kept in the options store.
// node tools/repairalerttest.js [seed]
import { createWorld, tickHour, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, planPath, partyTile, removeParty, leaveVehicle, partySpeed } from "../src/sim/parties.js";
import { rollTravelEvent } from "../src/sim/events.js";
import { vehiclesAtBase, createVehicle, setPartyVehicles } from "../src/sim/vehicles.js";
import { markRepair } from "../src/sim/repairwait.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { computeAlerts, renderAlerts, ALERT_ACTIONS, initAlerts, GOOD_NEWS } from "../src/ui/alerts.js";
import { worldCues } from "../src/ui/soundcues.js";
import { groupOf } from "../src/ui/soundgroups.js";

const SEED = Number(process.argv[2] || 42);
let fails = 0, passed = 0;
const check = (ok, msg) => { if (ok) passed++; else { fails++; console.log(`  FAIL: ${msg}`); } return !!ok; };
const section = (name) => console.log(name);

function mk(seed = SEED) {
  const state = createWorld({ seed, factionCount: 7 });
  state.started = true;
  state.autoCombat = true;
  state.noWanderers = true;
  Object.assign(hub(state).stock, { food: 300, water: 300, fuel: 100, meds: 20, ammo: 300, parts: 10, scrap: 100 });
  return state;
}
const crewOf = (state, n) => atBase(state, hub(state).id).slice(0, n);
const carOf = (state, i = 0) => { const v = vehiclesAtBase(state, hub(state).id).filter((x) => x.type !== "bike")[i]; v.fuel = 30; v.condition = 100; return v; };
const quiet = (state, p) => { state.hordes.length = 0; if (p) p.lastConflict = state.hour; };
const dropEvents = (state) => { for (let i = state.cards.length - 1; i >= 0; i--) if (!state.cards[i].isOrders) state.cards.splice(i, 1); };
function far(state, from, vehicle) {
  let best = null;
  for (const t of state.tiles) {
    const d = state.grid.distance(from, t.id);
    if (d < 12 || d > 16 || t.terrain === "water" || state.bases.some((b) => b.tile === t.id)) continue;
    if (planPath(state, from, t.id, vehicle)) { best = t.id; break; }
  }
  return best;
}
function send(state, ids, opts) {
  const dest = far(state, hub(state).tile, opts.mode ?? true);
  const res = launchExpedition(state, { memberIds: ids, dest, mission: "move", stance: "normal", supplies: { food: 8, water: 8 }, ...opts });
  if (res.error) throw new Error(`launch: ${res.error}`);
  return res.party;
}
const fixedAlerts = (state) => computeAlerts(state).filter((a) => a.kind === "fixed");
const fixedLogs = (state) => state.log.filter((l) => /running again|is fixed|are fixed/.test(l.text));
// One hour: quiet road, event cards thrown away unanswered (their delays never apply).
function tick(state, p) { quiet(state, p); tickHour(state); if (state.combat) state.combat = null; dropEvents(state); }
// A breakdown card for this team (for vehicle v if given), rolled on its tile with a worn vehicle.
function breakdown(state, p, v = null) {
  for (let i = 0; i < 6000; i++) {
    quiet(state, p);
    const c = rollTravelEvent(state, p, partyTile(p));
    if (c && c.title === "Breakdown" && (!v || c.vehicleId === v.id)) return c;
  }
  return null;
}
// Answer a choice with the dice set (ok: the mechanics check passes or fails).
function answer(state, card, re, ok = true) {
  const ch = card.choices.find((x) => re.test(x.label));
  const orig = state.rng.chance;
  state.rng.chance = () => ok;
  try { return ch.resolve(state); } finally { state.rng.chance = orig; }
}
// The hours the wait should take: the repair's own, after anything the team already owed (an earlier delay is paid first).
const owedHours = (p) => Math.ceil(p.delayWhy.left / partySpeed(p) - 1e-9);
// Ticks until the news comes (at most n hours); returns the hours it took, or -1.
function untilNews(state, p, n) {
  const before = fixedLogs(state).length;
  for (let h = 1; h <= n; h++) {
    tick(state, p);
    if (fixedLogs(state).length > before) return h;
  }
  return -1;
}
// A team on the road, a few hours out, its vehicle worn enough to break down.
function onRoad(state, opts = {}) {
  const crew = crewOf(state, opts.n || 2);
  const car = opts.vehicleId ? null : carOf(state);
  const p = send(state, crew.map((s) => s.id), { vehicleId: opts.vehicleId ?? car.id, ...(opts.launch || {}) });
  for (let i = 0; i < 2; i++) tick(state, p);
  check(state.parties.includes(p) && p.phase === "out", "test setup: the team is on its way");
  return { p, car };
}

// ---------------------------------------------------------------------------------------------------------
section("Repair on the spot, success: one alert two hours later, the team moving again");
{
  const state = mk();
  const { p, car } = onRoad(state);
  car.condition = 5;
  const c = breakdown(state, p);
  if (check(!!c, "test setup: a Breakdown card")) {
    dropEvents(state);
    p.progress = Math.max(0, p.progress || 0); // nothing owed from before (a roadblock met on the way): the repair's own two hours
    const ui = { started: true };
    renderAlerts(state, ui);
    check(/Fixed in two hours/.test(answer(state, c, /Repair it on the spot/, true)), "the repair succeeded");
    check(owedHours(p) === 2, `two hours (${owedHours(p)})`);
    check(p.delayWhy && p.delayWhy.kind === "repair" && p.delayWhy.vehicleIds.includes(car.id), "the delay is marked as a repair of this vehicle");
    const idx0 = p.idx;
    tick(state, p);
    check(fixedLogs(state).length === 0 && fixedAlerts(state).length === 0, "no news an hour in");
    check(p.idx === idx0, "the team has not moved during the repair");
    tick(state, p);
    const logs = fixedLogs(state), al = fixedAlerts(state);
    check(logs.length === 1, `one log line after two hours (${logs.length})`);
    check(al.length === 1, `one alert after two hours (${al.length})`);
    const text = logs[0] ? logs[0].text : "";
    console.log(`  log: ${text}`);
    console.log(`  alert: ${al[0] ? al[0].text : "-"}`);
    check(new RegExp(`the ${car.name} is running again \\(condition \\d+%\\)\\. Moving on to `).test(text), `the wording: "${text}"`);
    check(!p.delayWhy, "the marker is cleared");
    check((p.progress || 0) >= 0 && p.phase === "out", "the team is moving again");
    check(al[0] && al[0].go && al[0].go.team === p.id && al[0].event === true && al[0].tone === "good", "the alert opens the team, is news, and is good news");
    renderAlerts(state, ui);
    check(ui.flash && /running again/.test(ui.flash.text), "a new one flashes over the stack");
    // Click: opens the team panel and centres on it; news goes once clicked.
    const calls = [];
    const act = { "xp-open": (d) => calls.push(["open", d.id]), center: (d) => calls.push(["center", d.tile]) };
    ALERT_ACTIONS["al-go"](state, ui, { key: al[0].key }, act);
    check(calls.some((x) => x[0] === "open" && x[1] === p.id) && calls.some((x) => x[0] === "center" && x[1] === partyTile(p)), "clicking it opens and centres on the team");
    renderAlerts(state, ui);
    check(!(ui.alertList || []).some((a) => a.kind === "fixed"), "clicked: gone from the stack");
    // Once: no more news over the following hours; the alert ages out after a day.
    for (let i = 0; i < 6 && state.parties.includes(p); i++) tick(state, p);
    check(fixedLogs(state).length === 1, "still exactly one log line hours later");
    const idxAfter = p.idx;
    check(idxAfter > idx0 || !state.parties.includes(p) || p.phase !== "out", `the team drove on (tile ${idx0} -> ${idxAfter})`);
  }
}

section("Repair on the spot, failure: eight hours and more wear");
{
  const state = mk(SEED + 1);
  const { p, car } = onRoad(state);
  car.condition = 30;
  const c = breakdown(state, p);
  if (check(!!c, "test setup: a Breakdown card")) {
    dropEvents(state);
    const cond = car.condition;
    const before = p.progress;
    answer(state, c, /Repair it on the spot/, false);
    check(car.condition === Math.max(1, cond - 10), "the failure's wear");
    const want = owedHours(p);
    check(want === 8 + Math.ceil(Math.max(0, -before) / partySpeed(p) - 1e-9), `eight hours, after what was owed (${want}, progress before ${before.toFixed(2)})`);
    const h = untilNews(state, p, 12);
    check(h === want, `the news after ${want} hours (${h})`);
    check(fixedAlerts(state).length === 1, "one alert");
    check(new RegExp(`condition ${Math.round(car.condition)}%`).test(fixedLogs(state)[0]?.text || ""), "the condition now");
  }
}

section("Spare part: one hour");
{
  const state = mk(SEED + 2);
  const { p, car } = onRoad(state);
  p.supplies.carparts = 1;
  car.condition = 5;
  const c = breakdown(state, p);
  if (check(!!c, "test setup: a Breakdown card")) {
    dropEvents(state);
    check(/Back on the road/.test(answer(state, c, /spare part/)), "the part was used");
    const want = owedHours(p);
    check(want >= 1 && want <= 2, `one hour (after what was owed: ${want})`);
    const h = untilNews(state, p, 4);
    check(h === want, `the news after ${want} hours (${h})`);
    check(fixedAlerts(state).length === 1, "one alert");
  }
}

section("Other delays tell nothing; neither does abandoning the vehicle");
{
  const state = mk(SEED + 3);
  const { p, car } = onRoad(state);
  p.progress -= 6 * partySpeed(p); // "Shelter and wait (6 hours)" and the like: delay() with no marker
  for (let i = 0; i < 8; i++) tick(state, p);
  check(fixedLogs(state).length === 0 && fixedAlerts(state).length === 0, "a plain delay: no news");
  car.condition = 5;
  const c = breakdown(state, p);
  if (check(!!c, "test setup: a Breakdown card")) {
    dropEvents(state);
    answer(state, c, /Abandon/);
    for (let i = 0; i < 4 && state.parties.includes(p); i++) tick(state, p);
    check(fixedLogs(state).length === 0 && !p.delayWhy, "abandoned: no news, no marker");
  }
}

section("The vehicle lost, or the team gone, during the wait: no news, nothing breaks");
{
  const state = mk(SEED + 4);
  const { p, car } = onRoad(state);
  car.condition = 5;
  const c = breakdown(state, p);
  if (check(!!c, "test setup: a Breakdown card")) {
    dropEvents(state);
    answer(state, c, /Repair it on the spot/, false);
    tick(state, p);
    leaveVehicle(state, p, partyTile(p), "broke down"); // left behind during the wait (a second card's Abandon, say)
    for (let i = 0; i < 10 && state.parties.includes(p); i++) tick(state, p);
    check(fixedLogs(state).length === 0 && fixedAlerts(state).length === 0, "vehicle gone: no news");
    check(!p.delayWhy, "the marker is dropped once the wait is over");
  }
  const state2 = mk(SEED + 5);
  const r = onRoad(state2);
  r.car.condition = 5;
  const c2 = breakdown(state2, r.p);
  if (check(!!c2, "test setup: a Breakdown card")) {
    dropEvents(state2);
    answer(state2, c2, /Repair it on the spot/, true);
    removeParty(state2, r.p); // merged into another team, or home: gone
    let threw = null;
    try { for (let i = 0; i < 4; i++) tick(state2, null); } catch (e) { threw = e; }
    check(!threw, `the team gone: nothing breaks (${threw && threw.message})`);
    check(fixedLogs(state2).length === 0 && fixedAlerts(state2).length === 0, "the team gone: no news");
  }
}

section("Save and load during the wait");
{
  const state = mk(SEED + 6);
  const { p, car } = onRoad(state);
  car.condition = 5;
  const c = breakdown(state, p);
  if (check(!!c, "test setup: a Breakdown card")) {
    dropEvents(state);
    answer(state, c, /Repair it on the spot/, false);
    const want = owedHours(p);
    for (let i = 0; i < 3; i++) tick(state, p);
    const save = JSON.parse(JSON.stringify(serializeState(state, { dropCards: true })));
    const st2 = deserializeState(save);
    const p2 = st2.parties.find((x) => x.id === p.id);
    check(p2 && p2.delayWhy && p2.delayWhy.kind === "repair" && p2.delayWhy.vehicleIds.includes(car.id), "the marker is saved");
    const h = untilNews(st2, p2, 10);
    check(h === want - 3, `loaded: the news on time, ${want - 3} hours on (${h})`);
    check(fixedAlerts(st2).length === 1, "loaded: one alert");
    // An old save (no marker): the wait runs out as ever, with nothing to tell.
    const st3 = deserializeState(JSON.parse(JSON.stringify(save)));
    const p3 = st3.parties.find((x) => x.id === p.id);
    delete p3.delayWhy;
    let threw = null;
    try { for (let i = 0; i < 8; i++) tick(st3, p3); } catch (e) { threw = e; }
    check(!threw && fixedLogs(st3).length === 0, "an old save without the marker: fine, no news");
  }
}

section("Bikes: \"the bike is fixed\"");
{
  const state = mk(SEED + 7);
  const h = hub(state);
  for (const v of vehiclesAtBase(state, h.id).filter((x) => x.type === "bike")) state.vehicles.splice(state.vehicles.indexOf(v), 1);
  const bikes = createVehicle(state, "bike", { kind: "base", baseId: h.id }, { count: 2, condition: 100 });
  const crew = crewOf(state, 2);
  const res = launchExpedition(state, { memberIds: crew.map((s) => s.id), dest: far(state, h.tile, "bike"), mission: "move", stance: "normal", vehicleId: bikes.id, supplies: { food: 6, water: 6 } });
  if (check(!res.error, `test setup: launched on bikes (${res.error})`)) {
    const p = res.party;
    for (let i = 0; i < 2; i++) tick(state, p);
    bikes.condition = 5;
    const c = breakdown(state, p);
    if (check(!!c, "test setup: a Breakdown card for the bikes")) {
      dropEvents(state);
      answer(state, c, /Repair it on the spot/, true);
      const want = owedHours(p);
      const hrs = untilNews(state, p, 4);
      const text = fixedLogs(state)[0]?.text || "";
      console.log(`  log: ${text}`);
      check(hrs === want && want >= 2 && /the bike is fixed \(condition \d+%\)/.test(text), `bikes: "${text}" after ${hrs} hours`);
    }
  }
}

section("Two vehicles: a second breakdown repaired during the wait joins the first");
{
  const state = mk(SEED + 8);
  const crew = crewOf(state, 2);
  const a = carOf(state, 0);
  const b = createVehicle(state, a.type === "van" ? "suv" : "van", { kind: "base", baseId: hub(state).id }, { fuel: 30, condition: 100 });
  if (check(!!a && !!b, "test setup: two cars at the hub")) {
    const p = send(state, crew.map((s) => s.id), { vehicleId: a.id });
    setPartyVehicles(state, p, [a, b]);
    for (let i = 0; i < 2; i++) tick(state, p);
    a.condition = b.condition = 5;
    const c1 = breakdown(state, p, a), c2 = breakdown(state, p, b);
    if (check(!!c1 && !!c2, "test setup: a Breakdown card for each")) {
      dropEvents(state);
      answer(state, c1, /Repair it on the spot/, true);
      tick(state, p);
      answer(state, c2, /Repair it on the spot/, true);
      check(p.delayWhy && p.delayWhy.vehicleIds.length === 2, "one marker for both");
      // The second repair starts when the first is done (an hour of it left): its two hours after that one.
      const want = Math.ceil(p.delayWhy.left / partySpeed(p) - 1e-9);
      check(want >= 3, `the second waits for the rest of the first (${p.delayWhy.left.toFixed(2)} owed)`);
      const hrs = untilNews(state, p, 8);
      const logs = fixedLogs(state);
      console.log(`  log: ${logs[0]?.text}`);
      check(hrs === want, `the news once both are done: ${want} hours after the second was answered (${hrs})`);
      check(logs.length === 1 && fixedAlerts(state).length === 1, "one alert for both");
      check(new RegExp(`the ${a.name} \\(\\d+%\\) and the ${b.name} \\(\\d+%\\) are running again`).test(logs[0]?.text || ""), "both named");
      for (let i = 0; i < 4 && state.parties.includes(p); i++) tick(state, p);
      check(fixedLogs(state).length === 1, "no second alert");
    }
  }
}

section("Groups' teams get no marker (no alerts there)");
{
  const state = mk(SEED + 9);
  const ai = { id: 999999, owner: state.factions[0].id, path: [0, 1], idx: 0, progress: 0, phase: "out", stance: "normal" };
  markRepair(state, ai, { id: 1, name: "Truck" }, 2, 0);
  check(!ai.delayWhy, "an AI team: no marker");
}

// A world where a repair's news just came (the alert up for the first time). Returns { state, p }.
function justFixed(seed) {
  const state = mk(seed);
  const { p, car } = onRoad(state);
  car.condition = 5;
  const c = breakdown(state, p);
  dropEvents(state);
  p.progress = Math.max(0, p.progress || 0);
  answer(state, c, /Repair it on the spot/, true);
  const h = untilNews(state, p, 4);
  check(h === 2, `test setup: the news came (${h})`);
  return { state, p };
}

section("The chime: once per alert, wherever the camera is, even with a card up");
{
  const state = mk(SEED + 10);
  const { p, car } = onRoad(state);
  car.condition = 5;
  const c = breakdown(state, p);
  if (check(!!c, "test setup: a Breakdown card")) {
    dropEvents(state);
    p.progress = Math.max(0, p.progress || 0);
    const ui = { started: true }, mem = {};
    renderAlerts(state, ui);
    worldCues(state, ui, mem); // the world first heard: quiet
    answer(state, c, /Repair it on the spot/, true);
    const heard = [];
    for (let i = 0; i < 4; i++) {
      tick(state, p);
      if (i === 1) state.cards.push({ title: "A peddler at the gate", choices: [] }); // a card comes up in the same hour
      renderAlerts(state, ui);
      heard.push(...worldCues(state, ui, mem).map((x) => x.name));
      heard.push(...worldCues(state, ui, mem).map((x) => x.name)); // the next frame: nothing again
    }
    check(heard.filter((n) => n === "repaired").length === 1, `one chime for the alert (${heard.join(", ") || "none"})`);
    check(!heard.includes("good"), "not the plain Good news chime as well");
    check(groupOf("repaired") === "ui.cards", "in the Card chimes group (Settings → Sound mixer)");
    const AU = await import("../src/ui/audio.js");
    check(!!AU.VOICES.repaired && AU.SOUND_NAMES.includes("repaired") && /Repair done/.test(AU.soundOptionsHtml({ sound: {} })), "a voice of its own, in Settings → Sound's Hear list");
    // A second repair on the same team the same day: heard again (each repair is news of its own).
    car.condition = 5;
    const c2 = breakdown(state, p);
    if (c2) {
      dropEvents(state);
      p.progress = Math.max(0, p.progress || 0);
      answer(state, c2, /Repair it on the spot/, true);
      const again = [];
      for (let i = 0; i < 3; i++) { tick(state, p); renderAlerts(state, ui); again.push(...worldCues(state, ui, mem).map((x) => x.name)); }
      check(again.filter((n) => n === "repaired").length === 1, `a second repair: heard again, once (${again.join(", ") || "none"})`);
    }
  }
}

section("The chime on a stub sound card: played, silent when muted, once from the whole frame");
{
  const AU = await import("../src/ui/audio.js");
  const node = (extra = {}) => ({ connect(d) { return d; }, disconnect() {}, ...extra });
  const param = (v = 0) => ({ value: v, setValueAtTime() { return this; }, linearRampToValueAtTime() { return this; }, exponentialRampToValueAtTime() { return this; }, setTargetAtTime() { return this; }, cancelScheduledValues() { return this; } });
  const src = (extra) => node({ start() {}, stop() {}, ...extra });
  const ctx = {
    sampleRate: 8000, currentTime: 0, state: "running", destination: node(), resume: () => Promise.resolve(), suspend: () => Promise.resolve(),
    createGain: () => node({ gain: param(1) }), createBiquadFilter: () => node({ type: "", frequency: param(350), Q: param(1) }),
    createOscillator: () => src({ type: "", frequency: param(440), setPeriodicWave() {} }), createBufferSource: () => src({ buffer: null, loop: false, playbackRate: param(1) }),
    createBuffer: (ch, len, rate) => { const d = Array.from({ length: ch }, () => new Float32Array(len)); return { duration: len / rate, numberOfChannels: ch, getChannelData: (i) => d[i], copyToChannel(a, i) { d[i].set(a); } }; },
    createStereoPanner: () => node({ pan: param() }), createWaveShaper: () => node({ curve: null, oversample: "none" }), createConvolver: () => node({ buffer: null }),
    createPeriodicWave: () => ({}), createDelay: () => node({ delayTime: param() }),
    createDynamicsCompressor: () => node({ threshold: param(-24), knee: param(30), ratio: param(12), attack: param(0.003), release: param(0.25), reduction: 0 }),
  };
  const on = {};
  globalThis.window = { AudioContext: function AC() { return ctx; }, addEventListener: (ev, f) => { (on[ev] ||= []).push(f); } };
  globalThis.document = { hidden: false, hasFocus: () => true, addEventListener: (ev, f) => { (on["doc:" + ev] ||= []).push(f); }, getElementById: () => null };
  try {
    const opts = { sound: { master: 0.7, sfx: 0.8, amb: 0.5 } };
    AU.initAudio(opts, () => {});
    for (const f of on.pointerdown || []) f({}); // the first gesture makes the context
    const gains = [];
    const keep = AU.VOICES.repaired.play;
    let threw = null;
    AU.VOICES.repaired.play = (c, out, t, o) => { gains.push(o.gain); try { keep(c, out, t, o); } catch (e) { threw = e; } };
    const played = AU.sfx("repaired");
    check(played !== false && gains.length === 1 && !threw, `played on the stub without an error (${threw && threw.message})`);
    ctx.currentTime += 5;
    opts.sound.mute = true;
    const muted = AU.sfx("repaired");
    check(muted === false && gains.length === 1, "muted: not played");
    opts.sound.mute = false;
    ctx.currentTime += 5;
    AU.VOICES.repaired.play = keep;
    // Through the whole frame: a new repair alert on the map is played by audioFrame, wherever the camera is.
    const { state } = justFixed(SEED + 11);
    const ui = { started: true };
    let frameErr = null, n = 0;
    AU.VOICES.repaired.play = () => { n++; };
    try {
      const ui0 = { started: true, alertList: [] };
      AU.audioFrame(state, ui0, 1000); // first heard: quiet
      renderAlerts(state, ui);
      ui0.alertList = ui.alertList;
      AU.audioFrame(state, ui0, 2000);
      AU.audioFrame(state, ui0, 3000);
    } catch (e) { frameErr = e; }
    AU.VOICES.repaired.play = keep;
    if (frameErr) console.log(`  (audioFrame on the stub: ${frameErr.message}; the frame check is skipped)`);
    else check(n === 1, `audioFrame plays the chime once (${n})`);
  } finally { delete globalThis.window; delete globalThis.document; }
}

section("Options → Good news alerts off: no row, flash or chime; the log keeps the line; warnings and dangers unaffected");
{
  check([...GOOD_NEWS].sort().join() === "built,caravan,fixed,trip", `good news: ${[...GOOD_NEWS].join(", ")}`);
  const opts = { goodNews: false };
  initAlerts(opts);
  try {
    const { state, p } = justFixed(SEED + 12);
    check(fixedLogs(state).length === 1, "the log line is still there");
    check(fixedAlerts(state).length === 0 && !!p.repairNews, "no alert row");
    const ui = { started: true }, mem = {};
    renderAlerts(state, ui);
    worldCues(state, ui, mem);
    check(!(ui.alertList || []).some((a) => a.kind === "fixed") && !(ui.flash && /running again/.test(ui.flash.text)), "no row in the stack, no flash");
    const hb = hub(state);
    hb.stock.food = 0; hb.hungerDays = 1; // starving: a danger
    const list = computeAlerts(state);
    check(list.some((a) => a.kind === "starve" && a.tone === "danger"), "a danger alert still shows");
    check(!list.some((a) => GOOD_NEWS.has(a.kind) && a.tone === "good"), "no good news among them");
    opts.goodNews = true;
    const all = computeAlerts(state);
    check(all.some((a) => a.kind === "fixed") && all.filter((a) => !(GOOD_NEWS.has(a.kind) && a.tone === "good")).map((a) => a.key).join() === list.map((a) => a.key).join(), "on again: the news is back; everything else identical either way");
    opts.goodNews = false;
    // The chime with it off: a fresh repair is not heard.
    const r = justFixed(SEED + 13);
    const ui2 = { started: true }, mem2 = {};
    worldCues(r.state, { started: true, alertList: [] }, mem2); // the world first heard before the alert is drawn
    renderAlerts(r.state, ui2);
    const cues = worldCues(r.state, ui2, mem2);
    check(!cues.some((x) => x.name === "repaired"), "no chime");
    // Switched back on: the news that came while it was off shows (still live) but as already seen: no flash, no chime.
    ui2.flash = null;
    opts.goodNews = true;
    renderAlerts(r.state, ui2);
    const back = worldCues(r.state, ui2, mem2).concat(worldCues(r.state, ui2, mem2));
    check((ui2.alertList || []).some((a) => a.kind === "fixed"), "on again: the live row is back");
    check(!ui2.flash && !back.some((x) => x.name === "repaired" || x.name === "good"), `on again: no flash, no chime for the old news (${back.map((x) => x.name).join(", ") || "silent"})`);
    // A fresh repair after it is back on is heard and flashed as ever.
    const p3 = r.p, car3 = r.state.vehicles.find((v) => v.id === p3.vehicleId);
    car3.condition = 5;
    const c3 = breakdown(r.state, p3);
    if (check(!!c3, "test setup: another Breakdown card")) {
      dropEvents(r.state);
      p3.progress = Math.max(0, p3.progress || 0);
      answer(r.state, c3, /Repair it on the spot/, true);
      const heard = [];
      let flashed = false;
      for (let i = 0; i < 3; i++) { tick(r.state, p3); renderAlerts(r.state, ui2); if (ui2.flash && /running again/.test(ui2.flash.text)) flashed = true; heard.push(...worldCues(r.state, ui2, mem2).map((x) => x.name)); }
      check(flashed && heard.filter((n) => n === "repaired").length === 1, `a new repair once it is on: flashed and chimed once (${heard.join(", ") || "none"})`);
    }
  } finally { initAlerts(null); }
}

section("The switch in Options, kept in the options store");
{
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
  try {
    const { loadOptions, DEFAULT_OPTIONS } = await import("../src/ui/saves.js");
    const { settingsModal, openSettings, SETTINGS_ACTIONS } = await import("../src/ui/settings.js");
    check(DEFAULT_OPTIONS.goodNews === true && loadOptions().goodNews === true, "on by default");
    const state = mk(SEED + 14);
    const ui = { started: true, scale: 1, speed: 0, slot: null, settings: null };
    openSettings(ui, "options");
    const options = loadOptions();
    const api = { options, desktop: false, autosaveInfo: () => ({}) };
    const html = settingsModal(state, ui, api);
    check(/data-action="set-opt" data-k="goodNews" data-tip="[^"]*repaired[^"]*log[^"]*">✔ Good news alerts/.test(html), "Options shows Good news alerts, ticked, with a tip saying what it covers and that the log keeps them");
    SETTINGS_ACTIONS["set-opt"](state, ui, { k: "goodNews" }, api);
    check(options.goodNews === false && /✗ Good news alerts/.test(settingsModal(state, ui, api)), "clicked: off");
    check(loadOptions().goodNews === false, "kept: a reload of the options has it off");
    SETTINGS_ACTIONS["set-opt"](state, ui, { k: "goodNews" }, api);
    check(loadOptions().goodNews === true, "and on again");
  } finally { delete globalThis.localStorage; }
}

console.log(`\n${passed} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
