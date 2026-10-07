// Headless checks for the roster's bulk actions (sim/bulk.js, ui/rosterbulk.js), the Watching panel (sim/watch.js,
// ui/watch.js) and map notes (sim/mapnotes.js, ui/mapnotes.js).
// Usage: node tools/rosterqoltest.js [seed]
// - Equip best available: upgrades only, from the person's own base's armory, nothing changes hands for anyone not
//   ticked, items are conserved, the weight rule holds, a pack keeps its contents, people away are skipped with why
// - Send to the hospital: who needs care, who is already at a running hospital, the nearest base with one, the walk
//   (a convoy on the road, not a teleport) and the arrival; no hospital anywhere says so
// - Move to base: the transfer convoy leaves and arrives; a base with no road food cannot send (and leaves no job
//   behind); old transfer jobs are cleared; people away are skipped
// - Roster: the bulk buttons, greyed out with a reason, the report, clean HTML with handlers
// - Watch list: pin and unpin from every kind, live status lines, the dead and gone greyed out, a horde out of sight
//   shows where it was last seen (never where it is), click goes there, the panel folds, saved and loaded, old saves
// - Map notes: add, edit, delete (twice), hide, the editor's state, the right-click menu, drawn on the map (calls
//   counted on a stub canvas), the tooltip, the redraw fingerprint, saved and loaded
import { createWorld, tickHour, hub, atBase, makeSurvivor, newId, killSurvivor } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { addBuilding } from "../src/sim/buildings.js";
import { newItem, ensureInv, packOf } from "../src/sim/inventory.js";
import { wornLoad, feelFactor } from "../src/sim/load.js";
import { planPath, launchExpedition, partyTile } from "../src/sim/parties.js";
import { supplyRuns } from "../src/sim/supply.js";
import { makeHorde } from "../src/sim/hordes.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { equipBest, weightOk, hospitalPlan, sendToHospital, moveToBase, needsCare, BULK } from "../src/sim/bulk.js";
import { itemScore } from "../src/sim/autopilot.js";
import { rosterModal, ROSTER_ACTIONS, ROSTER_CHANGE } from "../src/ui/roster.js";
import { bulkState } from "../src/ui/rosterbulk.js";
import { watchList, toggleWatch, isWatched, WATCH_MAX } from "../src/sim/watch.js";
import { renderWatch, watchStatus, watchPin, ctxWatch, WATCH_ACTIONS } from "../src/ui/watch.js";
import { mapNotes, addNote, notesAt, NOTE_KEYS, NOTE_TEXT_MAX } from "../src/sim/mapnotes.js";
import { drawMapNotes, noteTip, notesHash } from "../src/ui/mapnotes.js";
import { helpTopics } from "../src/ui/help.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const BAD = /\b(undefined|NaN|Infinity)\b|\[object [A-Za-z]+\]|\bnull\b/;
const htmlOk = (html, where, handlers = {}) => {
  const text = html.replace(/<[^>]*>/g, " ");
  check(!BAD.test(text), `${where}: no undefined / NaN / null in the text (${(BAD.exec(text) || [""])[0]})`);
  for (const a of html.matchAll(/(data-[\w-]+)="([^"]*)"/g)) if (BAD.test(a[2])) check(false, `${where}: bad attribute ${a[1]}="${a[2]}"`);
  const acts = [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
  const missing = acts.filter((a) => !handlers[a]);
  check(!missing.length, `${where}: every data-action has a handler (missing ${[...new Set(missing)].join(", ")})`);
};
const quiet = (st) => { st.cards.length = 0; };
const tick = (st, n) => { for (let i = 0; i < n; i++) { tickHour(st); quiet(st); } };
const addPerson = (st, base, role = "farm") => { const s = makeSurvivor(st, 1); s.traits = []; s.location = { kind: "base", baseId: base.id }; s.role = role; st.survivors.push(s); return s; };
// An outpost of ours 5–9 tiles from the hub on land with a walking road there.
function mkOutpost(st, stock = {}) {
  const h = hub(st), g = st.grid;
  const t = st.tiles.find((x) => x.terrain !== "water" && !x.loc && g.distance(x.id, h.tile) >= 5 && g.distance(x.id, h.tile) <= 9 && planPath(st, h.tile, x.id, false));
  const b = { id: newId(), tile: t.id, type: "outpost", name: "Test Outpost", stock: { food: 60, water: 60, fuel: 0, meds: 0, ammo: 10, parts: 0, scrap: 0, ...stock }, radio: false, watchtower: false, buildings: [], construction: [], armory: [] };
  st.bases.push(b);
  return b;
}
const W = () => { const st = createWorld({ seed, factionCount: 6 }); quiet(st); return st; };
const allItems = (st) => st.survivors.filter((s) => s.alive).reduce((a, s) => a + Object.values(s.gear).filter(Boolean).length, 0) + st.bases.reduce((a, b) => a + b.armory.length, 0);

// ---------- 1. Equip best available ----------
{
  console.log("Equip best available");
  const st = W();
  const h = hub(st);
  const ppl = atBase(st, h.id);
  const [a, b, c] = ppl;
  const other = ppl[3];
  for (const s of [a, b, c]) { ensureInv(s); s.gear.weapon = newItem("knife"); s.gear.armor = null; s.gear.head = null; s.skills.shooting = 12; }
  const otherBefore = JSON.stringify(other.gear);
  h.armory.push(newItem("ar"), newItem("huntrifle"), newItem("plate"), newItem("vest"), newItem("milhelmet"), newItem("crowbar"));
  a.role = "scavenge";
  const before = allItems(st);
  const res = equipBest(st, [a, b, c]);
  check(allItems(st) === before, `items are conserved (${before} before, ${allItems(st)} after)`);
  check(JSON.stringify(other.gear) === otherBefore, "someone not ticked keeps exactly what they had");
  check(res.changed.length >= 2, `at least two people got something (${res.changed.length})`);
  check([a, b, c].every((s) => itemScore(s, s.gear.weapon) >= itemScore(s, newItem("knife"))), "nobody's weapon got worse");
  const best = [a, b, c].sort((x, y) => itemScore(y, y.gear.weapon) - itemScore(x, x.gear.weapon))[0];
  check(best.gear.weapon.key === "ar", `the assault rifle went to someone (${best.gear.weapon.key})`);
  check(res.changed.every((ch) => ch.got.every((g) => g.was == null || itemScore(ch.s, g.item) > itemScore(ch.s, g.was))), "every swap is an upgrade");
  check(h.armory.filter((it) => it.key === "knife").length >= 2, "the old knives went back to the armory");
  check(a.gear.tool && a.gear.tool.key === "crowbar", "the crowbar went to the scavenger");
  check([a, b, c].every((s) => wornLoad(s) * feelFactor(s) <= BULK.KIT_FELT_MAX + 1e-9), "everyone's kit stays within a Medium load");
  // Nothing better: an empty result for them.
  const again = equipBest(st, [a, b, c]);
  check(again.changed.length === 0 && again.same.length === 3, "a second press changes nothing");
  // Weight: a bad back with a heavy pack does not take the plate carrier.
  const d = addPerson(st, h);
  ensureInv(d);
  d.traits = ["badback"];
  d.gear.backpack = newItem("rucksack");
  const pk = packOf(d);
  for (let i = 0; i < 4; i++) pk[i] = newItem("sledge");
  d.gear.armor = null;
  h.armory.length = 0;
  h.armory.push(newItem("plate"));
  check(!weightOk(d, "armor", h.armory[0]), "the weight rule refuses a plate carrier on a heavy load with a bad back");
  equipBest(st, [d]);
  check(!d.gear.armor && h.armory.length === 1, "and Equip best leaves it in the armory");
  // A new pack takes the old one's contents.
  const e = addPerson(st, h);
  ensureInv(e);
  e.gear.backpack = newItem("slingbag");
  packOf(e)[0] = newItem("bandagekit");
  h.armory.length = 0;
  h.armory.push(newItem("duffle"));
  equipBest(st, [e]);
  check(e.gear.backpack && e.gear.backpack.key === "duffle" && packOf(e).some((x) => x && x.key === "bandagekit"), "a bigger pack: the bandage kit moved into it");
  const sling = h.armory.find((x) => x.key === "slingbag");
  check(!!sling && !(sling.contents || []).some(Boolean), "the old pack went back empty");
  // People away are skipped with the reason.
  const out = W();
  const oh = hub(out);
  const crew = atBase(out, oh.id).slice(0, 2);
  const dest = out.tiles.find((t) => t.terrain !== "water" && out.grid.distance(t.id, oh.tile) === 3 && planPath(out, oh.tile, t.id, false));
  const lr = launchExpedition(out, { memberIds: crew.map((s) => s.id), dest: dest.id, mission: "move", stance: "normal", supplies: { food: 4, water: 4 } });
  check(!lr.error, `a team left (${lr.error || "ok"})`);
  oh.armory.push(newItem("ar"));
  const r2 = equipBest(out, crew);
  check(r2.changed.length === 0 && r2.away.length === 2 && /team/.test(r2.away[0].why), `people on a team are skipped: "${r2.away[0] && r2.away[0].why}"`);
}

// ---------- 2. Send to the hospital ----------
{
  console.log("Send to the hospital");
  const st = W();
  const h = hub(st);
  const op = mkOutpost(st);
  const hurtOp = addPerson(st, op);
  hurtOp.health = 45;
  const fine = addPerson(st, op);
  check(!needsCare(fine) && /does not need care/.test(hospitalPlan(st, fine).why), "someone in full health is not sent");
  check(/no base with a running hospital/.test(hospitalPlan(st, hurtOp).why), `no hospital anywhere: "${hospitalPlan(st, hurtOp).why}"`);
  addBuilding(h, "infirmary");
  const medic = atBase(st, h.id).find((s) => !s.leader);
  medic.role = "medic";
  const plan = hospitalPlan(st, hurtOp);
  check(plan.ok && plan.dest === h && plan.hours > 0, `the hub's infirmary is the destination (~${plan.hours}h)`);
  const hurtHub = atBase(st, h.id).find((s) => s !== medic && !s.leader);
  hurtHub.health = 50;
  const hp = hospitalPlan(st, hurtHub);
  check(!hp.ok && hp.here, `someone hurt at the hub stays: "${hp.why}"`);
  const res = sendToHospital(st, [hurtOp, fine, hurtHub]);
  check(res.sent.length === 1 && res.sent[0].ids[0] === hurtOp.id, "one convoy left, with the patient");
  check(res.stay.length === 2, "the other two stay, with why");
  check(hurtOp.location.kind === "party", "the patient is on the road now (not at the hub yet)");
  const job = supplyRuns(st).find((j) => j.transfer);
  check(!!job && job.atDest === "disband", "a one-off transfer job that disbands at the hospital");
  let hours = 0;
  while (hurtOp.alive && hurtOp.location.kind !== "base" && hours < 72) { tick(st, 1); hours++; }
  check(hurtOp.location.kind === "base" && hurtOp.location.baseId === h.id, `arrived at the hub after ${hours}h`);
  check(hours >= plan.hours - 1, `the walk took the road's time (${hours}h, planned ~${plan.hours}h)`);
}

// ---------- 3. Move to base ----------
{
  console.log("Move to base");
  const st = W();
  const h = hub(st);
  const op = mkOutpost(st);
  const movers = atBase(st, h.id).filter((s) => !s.leader).slice(0, 2);
  const res = moveToBase(st, movers, op.id);
  check(res.sent.length === 1 && movers.every((s) => s.location.kind === "party"), "two people left the hub as one convoy");
  const already = addPerson(st, op);
  const r2 = moveToBase(st, [already], op.id);
  check(!r2.sent.length && /already at/.test(r2.stay[0].why), "someone already there stays");
  let hours = 0;
  while (movers.some((s) => s.location.kind !== "base") && hours < 72) { tick(st, 1); hours++; }
  check(movers.every((s) => s.location.kind === "base" && s.location.baseId === op.id), `they joined the outpost after ${hours}h`);
  check(supplyRuns(st).some((j) => j.transfer && j.status === "disbanded"), "the finished transfer job is marked disbanded");
  // The next transfer clears the finished one; a base with no road food cannot send.
  op.stock.food = 0; op.stock.preserved = 0;
  const r3 = moveToBase(st, movers, h.id);
  check(!r3.sent.length && r3.failed.length === 1 && /food/.test(r3.failed[0].why), `no road food: nobody leaves ("${r3.failed[0] && r3.failed[0].why}")`);
  check(!supplyRuns(st).some((j) => j.transfer), "no transfer job is left behind (the finished one cleared, the failed one removed)");
  check(movers.every((s) => s.location.kind === "base" && s.location.baseId === op.id), "and they are still at the outpost");
}

// ---------- 4. The roster's buttons ----------
{
  console.log("Roster bulk buttons");
  const st = W();
  const h = hub(st);
  mkOutpost(st);
  const ui = { roster: true, rosterPrefs: { sort: "name", dir: 1, base: "all", role: "all", status: "all", sel: [], msg: "" } };
  const H = { ...ROSTER_ACTIONS, ...ROSTER_CHANGE, "ro-open": 1, role: 1 };
  let html = rosterModal(st, ui);
  htmlOk(html, "roster, nothing ticked", H);
  check(/data-action="ro-equip" disabled/.test(html) && /data-action="ro-hospital" disabled/.test(html) && /data-action="ro-bulkmove" disabled/.test(html), "nothing ticked: the bulk buttons are greyed out");
  const ppl = atBase(st, h.id);
  ui.rosterPrefs.sel = ppl.slice(0, 3).map((s) => s.id);
  h.armory.push(newItem("ar"));
  const bs = bulkState(st, ui.rosterPrefs);
  check(bs.equip.n === 3 && bs.move.n === 3 && bs.hospital.n === 0, `three ticked at the hub: equip and move on, hospital off (${bs.equip.n}/${bs.move.n}/${bs.hospital.n})`);
  check(/does not need care/.test(bs.hospital.tip), "the hospital button says why it is off");
  html = rosterModal(st, ui);
  htmlOk(html, "roster, three ticked", H);
  check(!/data-action="ro-equip" disabled/.test(html), "Equip best is on");
  ROSTER_ACTIONS["ro-equip"](st, ui, {});
  check(ui.rosterPrefs.report && /Equipped/.test(ui.rosterPrefs.report.title), `a report: "${ui.rosterPrefs.report && ui.rosterPrefs.report.title}"`);
  html = rosterModal(st, ui);
  htmlOk(html, "roster with a report", H);
  check(/class="result small ro-report"/.test(html) && /Assault rifle|AR-15|rifle/i.test(html), "the report lists the change");
  ROSTER_CHANGE["ro-bulkmove"](st, ui, { value: String(st.bases[1].id) });
  check(/on the way to Test Outpost/.test(ui.rosterPrefs.report.title), `moving: "${ui.rosterPrefs.report.title}"`);
  htmlOk(rosterModal(st, ui), "roster after a move", H);
  ROSTER_ACTIONS["ro-report-close"](st, ui, {});
  check(!ui.rosterPrefs.report, "✕ closes the report");
  const topics = helpTopics().map((t) => t.id);
  check(topics.includes("roster-bulk-actions") && topics.includes("watch-list-and-map-notes"), "Help has both topics");
}

// ---------- 5. Watch list ----------
const stubAct = (ui, calls) => ({
  center: (d) => { calls.push(["center", Number(d.tile)]); ui.selected = Number(d.tile); },
  "xp-open": (d) => { calls.push(["xp-open", Number(d.id)]); ui.expedition = Number(d.id); },
});
{
  console.log("Watch list");
  const st = W();
  const h = hub(st);
  const ui = { started: true };
  const calls = [];
  const act = stubAct(ui, calls);
  const H = { ...WATCH_ACTIONS };
  check(renderWatch(st, ui) === "", "nothing pinned, no notes: no panel");
  const s = atBase(st, h.id)[1];
  check(toggleWatch(st, "person", s.id, s.name) === true && isWatched(st, "person", s.id), "pin a person");
  check(/data-action="wt-pin"[^>]*class|wt-pin on/.test(watchPin(st, "person", s.id, s.name)), "the pin shows as on");
  toggleWatch(st, "base", h.id, h.name);
  const f = st.factions[0];
  f.known = true;
  toggleWatch(st, "group", f.id, f.name);
  // A horde two tiles from the hub, in sight.
  const ht = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 2);
  const horde = makeHorde(st, { tile: ht.id, size: 40, target: h.tile });
  st.live.add(ht.id);
  WATCH_ACTIONS["wt-pin"](st, ui, { kind: "horde", id: String(horde.id), name: "horde of 40" });
  // A team.
  const crew = atBase(st, h.id).slice(2, 4);
  const dest = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 4 && planPath(st, h.tile, t.id, false));
  const lr = launchExpedition(st, { memberIds: crew.map((x) => x.id), dest: dest.id, mission: "move", stance: "normal", supplies: { food: 6, water: 6 } });
  const team = st.parties.find((p) => p.id === lr.party?.id) || st.parties.find((p) => p.owner === "player" && p.members.includes(crew[0].id));
  toggleWatch(st, "team", team.id, "team");
  check(watchList(st).items.length === 5, "five pinned");
  let html = renderWatch(st, ui);
  htmlOk(html, "Watching panel", H);
  check((html.match(/class="wt-row /g) || []).length === 5, "a row each");
  const sp = watchStatus(st, watchList(st).items[0]);
  check(/HP \d+ · mood \d+/.test(sp.line) && new RegExp(h.name).test(sp.line), `person: "${sp.line}"`);
  const sb = watchStatus(st, watchList(st).items[1]);
  check(/food .* · water .*/.test(sb.line) && /horde of 40/.test(sb.line) && sb.tone === "danger", `base: "${sb.line}"`);
  const sg = watchStatus(st, watchList(st).items[2]);
  check(/(Hostile|Neutral|Friendly|Allied) \(-?\d+\)/.test(sg.line) && /people/.test(sg.line), `group: "${sg.line}"`);
  const sh = watchStatus(st, watchList(st).items[3]);
  check(/^40 · heading for /.test(sh.line) && /2 tiles from/.test(sh.line), `horde: "${sh.line}"`);
  tick(st, 1);
  const stm = watchStatus(st, watchList(st).items[4]);
  check(/no contact · arrives around day \d+/.test(stm.line) || /ETA \d+h/.test(stm.line), `team on the way: "${stm.line}"`);
  for (let i = 0; i < 24 && team.phase !== "waiting"; i++) tick(st, 1);
  const stw = watchStatus(st, watchList(st).items[4]);
  check(team.phase === "waiting" && /food \d+ · water \d+ · Heat \d+/.test(stw.line) && stw.tone === "warn", `team waiting: "${stw.line}"`);
  // Click goes there.
  WATCH_ACTIONS["wt-go"](st, ui, { kind: "base", id: String(h.id) }, act);
  check(calls.some((c) => c[0] === "center" && c[1] === h.tile), "a base row centers on it");
  WATCH_ACTIONS["wt-go"](st, ui, { kind: "person", id: String(s.id) }, act);
  check(ui.survivor === s.id, "a person row opens their screen");
  WATCH_ACTIONS["wt-go"](st, ui, { kind: "group", id: String(f.id) }, act);
  check(ui.tab === "groups", "a group row opens the Groups tab");
  // A horde out of sight: where it was last seen, not where it is.
  st.live.delete(horde.tile);
  const far = st.tiles.find((t) => t.terrain !== "water" && st.grid.distance(t.id, h.tile) === 12 && !st.live.has(t.id));
  horde.tile = far.id;
  const hidden = watchStatus(st, watchList(st).items[3]);
  check(/out of sight · last seen/.test(hidden.line) && hidden.go && hidden.go.tile === ht.id, `out of sight: "${hidden.line}" at the old tile`);
  // Gone: the person dies, the horde disappears from where you can see.
  killSurvivor(st, s, h.tile, "in a test");
  st.hordes.splice(st.hordes.indexOf(horde), 1);
  st.live.add(ht.id);
  html = renderWatch(st, ui);
  check(watchStatus(st, watchList(st).items[0]).gone && /died/.test(html), "the dead grey out");
  check(watchStatus(st, watchList(st).items[3]).gone, "a horde no longer where you can see it is gone");
  check((html.match(/class="wt-row gone"/g) || []).length >= 2, "both rows greyed");
  WATCH_ACTIONS["wt-remove"](st, ui, { kind: "person", id: String(s.id) });
  check(!isWatched(st, "person", s.id), "✕ drops the row");
  WATCH_ACTIONS["wt-collapse"](st, ui, { v: "1" });
  check(/data-action="wt-collapse" data-v="0"/.test(renderWatch(st, ui)) && !/wt-row/.test(renderWatch(st, ui)), "▾ folds it to a button");
  WATCH_ACTIONS["wt-collapse"](st, ui, { v: "0" });
  check(/wt-row/.test(renderWatch(st, ui, { folded: true })) === false, "map only folds it too");
  // The limit.
  for (let i = 0; i < WATCH_MAX + 2; i++) toggleWatch(st, "base", 100000 + i, "x");
  check(watchList(st).items.length === WATCH_MAX, `the list holds ${WATCH_MAX}`);
  // Saved and loaded; an older save has none.
  const keep = watchList(st).items.length;
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  check(back.watch && back.watch.items.length === keep, "saved with the campaign");
  delete back.watch;
  check(renderWatch(back, ui) === "" && !isWatched(back, "base", h.id), "an older save (no list) loads with nothing pinned");
  // The right-click menu and the pins in the panels.
  const menu = ctxWatch(st, h.tile);
  htmlOk(menu, "right-click menu extras", H);
  check(/📌 (Watch|Stop watching) /.test(menu) && /data-action="mn-add"/.test(menu), "the menu offers 📌 and Add note");
}

// ---------- 6. Map notes ----------
{
  console.log("Map notes");
  const st = W();
  const h = hub(st);
  const ui = { started: true };
  const calls = [];
  const act = stubAct(ui, calls);
  const H = { ...WATCH_ACTIONS };
  const t = st.tiles.find((x) => x.terrain !== "water" && st.grid.distance(x.id, h.tile) === 3);
  WATCH_ACTIONS["mn-add"](st, ui, { tile: String(t.id) });
  check(ui.noteEdit && ui.noteEdit.tile === t.id && ui.noteEdit.id == null, "Add note opens the editor for the tile");
  WATCH_ACTIONS["mn-icon"](st, ui, { icon: "bridge" });
  WATCH_ACTIONS["mn-save"](st, ui, { text: "  Bridge   to clear  " });
  const n = mapNotes(st).list[0];
  check(n && n.icon === "bridge" && n.text === "Bridge to clear" && !ui.noteEdit, "saved: icon and trimmed text, editor closed");
  check(notesAt(st, t.id).length === 1, "listed on its tile");
  addNote(st, t.id, "skull", "x".repeat(200));
  check(mapNotes(st).list[1].text.length === NOTE_TEXT_MAX, "text is capped");
  check(addNote(st, t.id, "nonsense", "").icon === "flag", "an unknown icon becomes a flag");
  check(NOTE_KEYS.length === 8, "eight icons");
  let html = renderWatch(st, ui);
  htmlOk(html, "Watching panel with notes", H);
  check((html.match(/class="wt-note"/g) || []).length === 3 && /Bridge to clear/.test(html), "the Notes section lists them");
  // Edit.
  const h0 = notesHash(st);
  WATCH_ACTIONS["mn-edit"](st, ui, { id: String(n.id) });
  check(ui.noteEdit && ui.noteEdit.id === n.id && ui.noteEdit.icon === "bridge", "✎ opens the editor on the note");
  WATCH_ACTIONS["mn-icon"](st, ui, { icon: "target" });
  WATCH_ACTIONS["mn-save"](st, ui, { text: "Clear the bridge" });
  check(n.icon === "target" && n.text === "Clear the bridge" && mapNotes(st).list.length === 3, "edited in place");
  check(notesHash(st) !== h0, "the map's redraw fingerprint changes");
  // Go, delete (twice), hide.
  WATCH_ACTIONS["mn-go"](st, ui, { id: String(n.id) }, act);
  check(calls.some((c) => c[0] === "center" && c[1] === t.id), "a note row centers on its tile");
  WATCH_ACTIONS["mn-del"](st, ui, { id: String(n.id) });
  check(mapNotes(st).list.length === 3 && /Delete\?/.test(renderWatch(st, ui)), "the first ✕ only arms it");
  WATCH_ACTIONS["mn-del"](st, ui, { id: String(n.id) });
  check(mapNotes(st).list.length === 2, "the second ✕ deletes it");
  // The tooltip and drawing.
  check(/💀/.test(noteTip(st, t.id)), "the tile's hover description lists its notes");
  const stub = new Proxy({}, { get: (o, k) => (k in o ? o[k] : typeof k === "string" && /^(arc|fill|stroke|fillText|fillRect|beginPath|save|restore)$/.test(k) ? (...a) => { o.calls = (o.calls || 0) + 1; } : k === "measureText" ? () => ({ width: 40 }) : undefined), set: (o, k, v) => { o[k] = v; return true; } });
  const opts = { toPixel: (id) => st.grid.toPixel(id, 26), zoom: 1.6, boost: 1, inView: () => true };
  check(drawMapNotes(stub, st, opts) === 2 && stub.calls > 0, `both notes drawn (${stub.calls} calls)`);
  check(drawMapNotes(stub, st, { ...opts, inView: () => false }) === 0, "off screen: nothing drawn");
  WATCH_ACTIONS["mn-hide"](st, ui, {});
  check(mapNotes(st).hidden && drawMapNotes(stub, st, opts) === 0 && noteTip(st, t.id) === "", "hidden: not drawn, not in the tooltip");
  check(/🚫 Hidden/.test(renderWatch(st, ui)), "the list says they are hidden");
  WATCH_ACTIONS["mn-hide"](st, ui, {});
  // The editor's Delete removes the note it is editing; Cancel just closes.
  const m2 = mapNotes(st).list[0];
  WATCH_ACTIONS["mn-edit"](st, ui, { id: String(m2.id) });
  WATCH_ACTIONS["mn-cancel"](st, ui, {});
  check(!ui.noteEdit && mapNotes(st).list.length === 2, "Cancel closes the editor, nothing changes");
  WATCH_ACTIONS["mn-edit"](st, ui, { id: String(m2.id) });
  WATCH_ACTIONS["mn-del"](st, ui, { id: String(m2.id) });
  check(!ui.noteEdit && mapNotes(st).list.length === 1, "the editor's Delete removes the note at once");
  // The right-click menu offers to edit a tile's notes.
  const menu = ctxWatch(st, t.id);
  check(/data-action="mn-edit"/.test(menu), "right-click a tile with a note: Edit note");
  // Saved and loaded.
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st))));
  check(back.mapNotes && back.mapNotes.list.length === 1 && back.mapNotes.list[0].tile === mapNotes(st).list[0].tile, "notes are saved with the campaign");
  delete back.mapNotes;
  check(drawMapNotes(stub, back, opts) === 0 && renderWatch(back, ui) === "", "an older save (no notes) draws none");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
