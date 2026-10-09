// Selecting things on the State Map and the intel estimates of other groups' bases (src/ui/mapselect.js,
// src/sim/intelest.js, src/sim/intelnotes.js).
// Usage: node tools/mapselecttest.js [seed]
// - the estimate of a group's base: nothing known gives unknowns; a look from outside a range around the truth; a close
//   look (survey, optics) a narrower one; old looks wider; never the exact count without allies; radio stores, a
//   prisoner's word, allies; a base that changed hands out of sight keeps what you knew of the old holder
// - the hooks: a team's report carries its look home (world.js mergeKnowledge), the survey's close look
// - parties on the road: only in view, a range (wider at night), the selection state after clicks and the chips
// - your own base's card lists its buildings; the cards render without undefined / NaN
import { createWorld, tickHour, snapshot, mergeKnowledge, atBase } from "../src/sim/world.js";
import { spawnAiParty, launchExpedition, partyTile } from "../src/sim/parties.js";
import { baseIntel, partyIntel, rangeOf } from "../src/sim/intelest.js";
import { noteLook, noteHeard, withLook, surveyErr, peopleAtBase, ledger } from "../src/sim/intelnotes.js";
import { picksAt, clickPick, pickAction, pickCard, pickBar, ownBaseCard, groupBaseCard, syncPick } from "../src/ui/mapselect.js";
import { renderRight } from "../src/ui/ui.js";

const seed = Number(process.argv[2] || 42);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`passed: ${msg}`); } else { fails++; console.log(`failed: ${msg}`); } return ok; };
const W = (s = seed) => { const st = createWorld({ seed: s, factionCount: 6 }); st.cards.length = 0; return st; };
const width = (r) => (r ? r.hi - r.lo : Infinity);
const inR = (r, v) => !!r && r.lo <= v && v <= r.hi;
const BAD = /\b(undefined|NaN|Infinity)\b|\[object [A-Za-z]+\]/;

// ---------- the estimate of a group's base ----------
{
  const st = W();
  const fi = st.factions.findIndex((x) => x.alive), f = st.factions[fi], t = f.bases[0];
  const none = baseIntel(st, t, new Set());
  check(none && none.confidence === "none" && none.pop == null && none.gpop == null && none.walls == null && none.works == null && none.cars == null && none.arms == null && none.stores == null, "no intel: every estimate unknown");
  check(none.tips.length > 0, "no intel: a hint how to learn more");
  const html0 = groupBaseCard(st, t, f);
  check(/unknown/.test(html0) && !BAD.test(html0) && !html0.includes(`${peopleAtBase(f, t)} people`), "no intel: the card says unknown and shows no count");

  const truth = peopleAtBase(f, t);
  noteLook(st, t, "sight", 0.3);
  const sight = baseIntel(st, t, new Set());
  check(sight.pop && sight.pop.lo < sight.pop.hi && inR(sight.pop, truth), `seen from outside: a range ${sight.pop && `${sight.pop.lo}–${sight.pop.hi}`} holding the ${truth} there`);
  check(sight.works && !sight.works.some((w) => ["beds", "bench", "store", "jail"].includes(w.key)), "from outside: no quarters, workshop, storehouse or jail seen");
  check(sight.walls && sight.walls.goal >= 1, "from outside: the walls as a range of the goal");

  const st2 = W();
  const f2 = st2.factions[fi], t2 = f2.bases[0];
  noteLook(st2, t2, "survey", surveyErr(st2, { look: 1.6, night: null }));
  const surv = baseIntel(st2, t2, new Set());
  check(surv.pop && width(surv.pop) < width(sight.pop) && inR(surv.pop, truth), `a close look with a spotting scope is narrower (${width(surv.pop)} < ${width(sight.pop)})`);
  check(surv.worksFrom === "survey", "a close look sees the inside works");

  st2.hour += 24 * 20;
  const old = baseIntel(st2, t2, new Set());
  check(width(old.pop) > width(surv.pop) && inR(old.pop, truth), `20 days on the range is wider (${width(old.pop)} > ${width(surv.pop)})`);
  check(old.lastSeen && old.lastSeen.ago === 20 && old.tips.some((x) => /20 days/.test(x)), "20 days on: last looked 20 days ago");

  // radio: their stores and a war party
  noteHeard(st2, f2.id, "stores", { wants: ["ammo"], spare: ["food"] });
  noteHeard(st2, f2.id, "force", { strength: 14 });
  const heard = baseIntel(st2, t2, new Set());
  check(heard.heard && heard.heard.short[0] === "ammo" && heard.heard.plenty[0] === "food" && heard.sources.some((x) => x.src === "radio"), "their channel: short of and plenty of");
  check(heard.force && heard.force.strength === 14, "their channel: a war party's strength");

  // a prisoner of theirs
  const st3 = W();
  const f3 = st3.factions[fi];
  f3.intel = { day: 1, pop: f3.pop, food: 200, ammo: 10, scrap: 5, fuel: 3, meds: 1 };
  const cap = baseIntel(st3, f3.bases[0], new Set());
  check(cap.gpop && inR(cap.gpop, f3.pop) && cap.gpop.lo < cap.gpop.hi && cap.stores && cap.storesFrom === "captive", "a prisoner's word: the whole group as a range, its stores");
  check(cap.pop == null, "a prisoner's word: nothing of this base's walls or people");

  // allies tell you
  const st4 = W();
  const f4 = st4.factions[fi];
  f4.pact = "trade"; f4.known = true;
  const al = baseIntel(st4, f4.bases[0], new Set());
  check(al.ally && (al.confidence === "high" || al.confidence === "good") && al.stores && al.sources.some((x) => x.src === "ally"), `allies: confidence ${al.confidence}, their stores`);
  check(width(al.pop) <= width(surv.pop), "allies: at least as narrow as a close look");

  // never exact without allies: many bases, many looks
  let exact = 0, outside = 0, n = 0;
  for (const s of [1, 7, 42, 99, 1234]) {
    const w = W(s);
    for (const g of w.factions) for (const tile of g.bases) for (const [src, err] of [["sight", 0.3], ["sight", 0.45], ["survey", 0.2], ["survey", 0.125], ["visit", 0.12]]) {
      const L = ledger(w); delete L.bases[tile];
      noteLook(w, tile, src, err);
      const o = baseIntel(w, tile, new Set());
      n++;
      if (!o.pop || o.pop.lo >= o.pop.hi || (o.gpop && o.gpop.lo >= o.gpop.hi)) exact++;
      if (!inR(o.pop, peopleAtBase(g, tile)) || !inR(o.gpop, g.pop)) outside++;
    }
  }
  check(n > 50 && exact === 0, `never a bare count without allies (${n} looks)`);
  check(outside === 0, "the range always holds what was there when they looked");

  // a base changing hands out of sight keeps what you knew of the old holder
  const st5 = W();
  const a = st5.factions.find((x) => x.alive && x.bases.length >= 1), b = st5.factions.find((x) => x.alive && x !== a);
  const tt = a.bases[0];
  noteLook(st5, tt, "sight");
  const before = baseIntel(st5, tt, new Set(), a);
  a.bases = a.bases.filter((x) => x !== tt); b.bases.push(tt);
  const after = baseIntel(st5, tt, new Set(), a);
  check(after.fid === a.id && after.pop && after.pop.lo === before.pop.lo && after.pop.hi === before.pop.hi, "changed hands out of sight: still the old holder's estimate");
  const fresh = baseIntel(st5, tt, new Set());
  check(fresh.fid === b.id && fresh.pop == null, "the new holder: nothing known of them there");
}

// ---------- the hooks: a team's report, a survey's close look ----------
{
  const st = W();
  const f = st.factions.find((x) => x.alive), t = f.bases[0];
  const seen = new Map([[t, withLook(st, snapshot(st, t), t, "survey", 0.1)]]);
  check(!ledger(st).bases[t] || !ledger(st).bases[t].survey, "a team's look is not known before it reports");
  mergeKnowledge(st, seen, null);
  check(ledger(st).bases[t] && ledger(st).bases[t].survey && ledger(st).bases[t].survey.err === 0.1, "the report brings the close look home (mergeKnowledge)");
  const plain = withLook(st, snapshot(st, 0), 0);
  check(!plain.gb || plain.factionBase != null, "a tile with no group's base gets no look");
  // the world's sight: a group's base in view is looked at every hour
  st.bases[0].tile; // (vision is the bases' own)
  for (let i = 0; i < 2; i++) tickHour(st);
  const seenBases = Object.entries(ledger(st).bases).filter(([tile, r]) => r.sight && st.live.has(Number(tile)));
  const inView = st.factions.some((g) => g.alive && g.bases.some((x) => st.live.has(x)));
  check(!inView || seenBases.length > 0, `bases in view are looked at (${inView ? "one in view" : "none in view"})`);
}

// ---------- parties on the road, and selecting on the map ----------
{
  const st = W();
  const f = st.factions.find((x) => x.alive && x.bases.length);
  const h = st.bases[0];
  const p = spawnAiParty(st, f, "raid", f.bases[0], h.tile, { strength: 18, target: { kind: "player", baseId: h.id, tile: h.tile } });
  check(!!p, "a raid on the road");
  const tile = partyTile(p);
  check(partyIntel(st, p, new Set()) == null, "out of view: nothing to make out");
  st.hour = 24 * 3 + 12; // midday
  const day = partyIntel(st, p, new Set([tile]));
  check(day && day.size && day.size.lo < day.size.hi && day.kindLabel === "War party", `in view by day: about ${day && day.size.lo}–${day && day.size.hi}`);
  check(day.dest == null, "where it is going: unknown unless heard or called");
  st.hour = 24 * 3 + 23; // night
  const night = partyIntel(st, p, new Set([tile]));
  check(night.night && width(night.size) >= width(day.size), "at night the count is rougher");
  p.warned = true;
  check(/Coming for your/.test(partyIntel(st, p, new Set([tile])).dest || ""), "a raid your lookouts called: coming for your base");

  // selection
  st.live = new Set([tile]);
  const ui = { selected: -1, expedition: null, mapSel: null, xpMsg: "", moveParty: null, tab: "bases" };
  const picks = picksAt(st, tile);
  check(picks.some((x) => x.kind === "group" && x.id === p.id), "the raid is on its tile's pick list");
  clickPick(st, ui, tile);
  check(ui.mapSel && ui.mapSel.kind === "group" && ui.mapSel.id === p.id && ui.selected === tile && ui.expedition == null, "a click on its tile selects the raid");
  const card = pickCard(st, ui);
  check(card && /War party/.test(card) && /Size/.test(card) && !BAD.test(card), "the raid's card: kind, size, nothing undefined");
  const right = renderRight(st, ui);
  check(/On this tile/.test(right) && /War party/.test(right) && !BAD.test(right), "the right panel shows the raid with the On this tile row");
  clickPick(st, ui, tile);
  check(ui.mapSel == null && ui.selected === tile, "the same tile again: the tile itself");
  const tileHtml = renderRight(st, ui);
  check(/On this tile/.test(tileHtml) && !BAD.test(tileHtml), "the tile view keeps the On this tile row");
  clickPick(st, ui, tile);
  check(ui.mapSel && ui.mapSel.kind === "group", "and again: back to the raid");
  clickPick(st, ui, tile, true);
  check(ui.mapSel == null, "Shift+click: the tile");
  pickAction(st, ui, { tile: String(tile), kind: "group", id: String(p.id) });
  check(ui.mapSel && ui.mapSel.kind === "group", "the chip picks the raid");
  check(ui.selParty == null, "ui.selParty: none while a group's party is selected");
  // it moves on: the selection follows it while in view
  const next = p.path[p.idx + 1];
  if (next != null) {
    p.idx += 1;
    st.live = new Set([partyTile(p)]);
    syncPick(st, ui);
    check(ui.selected === partyTile(p) && ui.mapSel && ui.mapSel.tile === partyTile(p), "the selection follows the raid as it moves");
    st.live = new Set();
    syncPick(st, ui);
    check(ui.mapSel && ui.mapSel.gone && /Out of sight/.test(pickCard(st, ui)), "out of sight: the card says so");
  }
  // selecting another tile some other way drops it
  ui.selected = h.tile;
  syncPick(st, ui);
  check(ui.mapSel == null, "another tile selected: the party is dropped");

  // your team
  const crew = atBase(st, h.id).slice(0, 2);
  const res = launchExpedition(st, { memberIds: crew.map((s) => s.id), dest: h.tile, mission: "move", stance: "normal", supplies: { food: 2, water: 2 } });
  const team = st.parties.find((q) => q.owner === "player");
  if (check(!!team, `a team of yours (${res && (res.error || "launched")})`)) {
    team.phase = "waiting";
    const tt = partyTile(team);
    st.live = new Set([tt]);
    const ui2 = { selected: -1, expedition: null, mapSel: null, xpMsg: "", moveParty: null, tab: "bases" };
    clickPick(st, ui2, tt);
    check(ui2.expedition === team.id && ui2.mapSel && ui2.mapSel.kind === "team", "a click on your team's tile opens its panel");
    check(ui2.selParty === team.id, "ui.selParty: the selected team");
    clickPick(st, ui2, tt);
    check(ui2.expedition == null && ui2.selParty == null, "the same tile again: the tile, no team");
  }
}

// ---------- your own base's card ----------
{
  const st = W();
  const b = st.bases[0];
  const { BUILDINGS } = await import("../src/sim/buildings.js");
  if (!b.buildings.length) check(/Nothing built yet/.test(ownBaseCard(st, b)), "a bare base: nothing built yet");
  for (const k of ["walls", "walls", "well", "workshop"].filter((x) => BUILDINGS[x])) b.buildings.push({ id: 9000 + b.buildings.length, type: k });
  const names = new Set(b.buildings.map((x) => x.type));
  const html = ownBaseCard(st, b);
  check(b.buildings.length > 0 && [...names].every((k) => html.includes(BUILDINGS[k].name)), `own base card lists its buildings (${names.size} kinds)`);
  check(/data-action="openbase"/.test(html) && /data-tab="defence"/.test(html) && /data-tab="buildings"/.test(html) && !BAD.test(html), "own base card: the base screen's tabs");
  const ui = { selected: b.tile, expedition: null, mapSel: null, xpMsg: "", moveParty: null, tab: "bases" };
  const right = renderRight(st, ui);
  check(right.includes("mapsel-base") && !BAD.test(right), "the tile panel of your base shows the card");
  check(pickBar(st, { ...ui, selected: -1 }) === "", "no tile: no On this tile row");
}

// ---------- the range helper ----------
{
  const st = W();
  const r = rangeOf(st, 10, 0.05, ["x"], 1);
  check(r.lo < r.hi, "a small error still gives a range, never one number");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
