// Radio intel and hidden bases (sim/intel.js, sim/hiding.js): the groups overhear your radio traffic and act on it,
// you keep bases hidden and fight their intel (discipline, encryption, Run silent, decoys, scouts caught and
// questioned), and the groups do the same (AI parity). Prints the measured rates.
// Usage: node tools/inteltest.js [seed]
import { createWorld, day, hub, atBase, snapshot } from "../src/sim/world.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { addBuilding } from "../src/sim/buildings.js";
import { playerNetwork, groupNetwork, netCovers } from "../src/sim/radio.js";
import { prisonersAt, gatherIntel } from "../src/sim/prisoners.js";
import { baseHeat } from "../src/sim/hordes.js";
import { lyingFor } from "../src/sim/intel.js";
import * as I from "../src/sim/intel.js";
import * as H from "../src/sim/hiding.js";
import * as G from "../src/sim/groupworld.js";
import { worksAt } from "../src/sim/groupworks.js"; // ai-locks: a group's radio station

const seed = Number(process.argv[2] || 7);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else { failed++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n== ${t}`);
const pct = (v) => `${Math.round(v * 1000) / 10}%`;

// A world with a radio station at the hub and a hostile raider gang 8 tiles off (inside the station's 12).
function world(s = seed) {
  const st = createWorld({ seed: s, factionCount: 8 });
  st.started = true;
  const h = hub(st);
  h.radio = true;
  return st;
}
const free = (st, t) => st.tiles[t].terrain !== "water" && !st.bases.some((b) => b.tile === t) && !st.factions.some((f) => f.alive && f.bases.includes(t));
function ringTile(st, from, r, not = []) {
  return st.grid.within(from, r).filter((t) => st.grid.distance(t, from) === r && free(st, t) && !not.includes(t)).sort((a, b) => a - b)[0];
}
function gang(st, at = 8) {
  const h = hub(st);
  const g = st.factions.find((f) => f.alive);
  g.type = "raider";
  g.pop = 14;
  g.goodwill = -80;
  g.bases = [ringTile(st, h.tile, at)];
  g.known = true;
  g.ear = null;
  G.knowsOf(st, g);
  return g;
}
function outpost(st, tile, name = "Test outpost") {
  const h = hub(st);
  const b = { ...JSON.parse(JSON.stringify(h)), id: 900000 + st.bases.length, type: "outpost", name, tile, buildings: [], construction: [], stock: { food: 40, ammo: 60 }, armory: [], radio: false, tuned: null, heard: [], watch: null };
  st.bases.push(b);
  return b;
}
const nextDay = (st, n = 1) => { st.hour += 24 * n; };
const listenNow = (st, g, net = "player") => { g.ear = { net, day: day(st) }; };
// A new event each day (make), today's air rolled for g, until pred holds; returns the days it took.
function hearUntil(st, g, make, pred, days = 60) {
  for (let i = 0; i < days; i++) {
    make(i);
    I.playerAir(st, day(st));
    listenNow(st, g);
    I.aiListen(st, g, day(st));
    if (pred()) return i + 1;
    nextDay(st);
  }
  return null;
}

// ======================================================================================
section("Your traffic on the air");
{
  const st = world();
  const h = hub(st);
  const g = gang(st);
  const net = playerNetwork(st);
  check(!!net && netCovers(st, net, g.bases[0]), "the gang's base stands inside your network");
  const far = ringTile(st, h.tile, 11, [g.bases[0]]);
  const op = outpost(st, far, "Far outpost");
  delete G.knowsOf(st, g).bases[op.tile];
  // A radio deal booked for the outpost (radiotrade.js state.radioDeals), with another group.
  const o = st.factions.find((f) => f.alive && f !== g);
  (st.radioDeals = st.radioDeals || []).push({ id: 1, factionId: o.id, baseId: op.id, by: "them", give: { supplies: {}, gear: [] }, get: { supplies: {}, gear: [] }, day: day(st), due: day(st) + 10 });
  const air = I.playerAir(st, day(st));
  const deal = air.find((x) => x.key === "deal:1");
  check(deal && deal.kind === "trade" && deal.bases.includes(op.id) && deal.rich, "a radio deal goes on the air naming the outpost and its stores");
  // A convoy of yours on the road past the gang (it reports in while in coverage).
  const path = [h.tile, ...st.grid.neighbors(h.tile).filter((t) => free(st, t)).slice(0, 1)];
  let cur = path[1];
  for (let i = 0; i < 6; i++) { const nx = st.grid.neighbors(cur).filter((t) => free(st, t) && !path.includes(t)).sort((a, b) => st.grid.distance(a, g.bases[0]) - st.grid.distance(b, g.bases[0]))[0]; if (nx == null) break; path.push(nx); cur = nx; }
  const cv = { id: 880001, owner: "player", kind: "convoy", phase: "out", path, idx: 0, progress: 0, homeBaseId: h.id, members: [], cargo: { supplies: { food: 30 }, gear: [] } };
  st.parties.push(cv);
  const air2 = I.playerAir(st, day(st));
  const cvi = air2.find((x) => x.partyId === cv.id);
  check(cvi && cvi.kind === "caravan" && Number.isFinite(cvi.arrive) && cvi.bases.includes(h.id), "your convoy reports in: route, base and day of arrival on the air");
  // The gang catches the deal: it learns the outpost (by radio) and that its stores are worth a raid.
  const took = hearUntil(st, g, (i) => st.radioDeals.push({ id: 100 + i, factionId: o.id, baseId: op.id, by: "them", give: { supplies: {}, gear: [] }, get: { supplies: {}, gear: [] }, day: day(st), due: day(st) + 10 }), () => !!G.knownBase(st, g, op.tile));
  const k = G.knownBase(st, g, op.tile);
  check(took != null && k && k.via === "radio" && k.heard != null, `the gang overheard the deal and knows the outpost by radio (day ${took})`);
  check(I.heardPull(st, g, op) > 1, "stores heard of on the radio pull their raids (× HEARD_PULL)");
  // ...and the convoy's route: it lies in wait where the road passes nearest.
  g.lying = null;
  const cvNow = I.playerAir(st, day(st)).find((x) => x.partyId === cv.id);
  I.heardYou(st, g, cvNow, day(st));
  check(lyingFor(st, g, cv) && g.lying.until >= cvNow.arrive, `the gang lies in wait for the convoy near tile ${g.lying && g.lying.tile} until day ${g.lying && g.lying.until} (it arrives day ${cvNow.arrive})`);
  check(I.knowsLine(st, g).includes("heard of it on your radio"), "questioned, one of theirs would say they heard of the outpost on your radio");
  // A raid on a base known only from the radio warns of it (factions.js launchRaidOnBase / raidWarning).
  check(I.knownByRadio(st, g, op), "a raid on that base is flagged as known by radio");
  // A silent base is never named.
  op.silent = true;
  st.intel.air = [];
  (st.radioDeals).push({ id: 2, factionId: o.id, baseId: op.id, by: "them", give: { supplies: {}, gear: [] }, get: { supplies: {}, gear: [] }, day: day(st), due: day(st) + 10 });
  const air3 = I.playerAir(st, day(st));
  check(air3.find((x) => x.key === "deal:2").bases.length === 0, "a deal for a base running silent names no base");
  // The ambush comes off: the hint in the log.
  const logN = st.log.length;
  I.ambushSprung(st, g, cv, true);
  check(!g.lying && st.log.slice(-3).some((l) => /listening to our radio/.test(l.text || l)), "a sprung ambush says someone must have been listening");
  void logN;
}

// ======================================================================================
section("How often a group learns your hub by radio (a year of ordinary traffic)");
{
  // Each week a greeting to a group, every 10 days a deal (radio.js f.radio marks); the groups whose base is inside
  // your network listen as they would. No scouting here: everything they learn of the hub is from the radio.
  const run = (variant, seeds = Array.from({ length: 10 }, (_, i) => seed + i)) => {
    let groups = 0, learned = 0, days = 0, lines = 0;
    for (const s of seeds) {
      const st = world(s);
      const h = hub(st);
      const net = playerNetwork(st);
      const ears = st.factions.filter((f) => f.alive && f.bases.length && f.pop >= I.INTEL.AI.MIN_POP && f.bases.some((t) => netCovers(st, net, t)));
      if (variant === "encrypted") h.armory.push({ key: "milradio", name: "Military encrypted radio" }); // (the groups counted: those the station reaches without it)
      if (variant === "windows") I.setDiscipline(st, "windows");
      if (variant === "silent") h.silent = true;
      const partners = st.factions.filter((f) => f.alive && f.bases.length);
      for (const f of ears) delete G.knowsOf(st, f).bases[h.tile];
      const first = new Map();
      for (let d = 0; d < 365; d++) {
        nextDay(st);
        const today = day(st);
        const p = partners[d % partners.length];
        if (d % 7 === 0) (p.radio = p.radio || {}).greet = today;
        if (d % 10 === 3) (p.radio = p.radio || {}).caravan = today;
        I.intelDaily(st);
        for (const f of ears) if (!first.has(f) && G.knownBase(st, f, h.tile)) first.set(f, d + 1);
      }
      groups += ears.length; learned += first.size; days += [...first.values()].reduce((a, v) => a + v, 0);
      lines += ears.reduce((a, f) => a + (f.overheard || 0), 0);
    }
    return { groups, learned, share: groups ? learned / groups : 0, meanDay: learned ? Math.round(days / learned) : null, heard: lines };
  };
  const base = run("open"), enc = run("encrypted"), win = run("windows"), sil = run("silent");
  console.log(`  open:        ${base.learned}/${base.groups} groups in your coverage learned the hub by radio within a year (${pct(base.share)}), mean day ${base.meanDay}; lines caught ${base.heard}`);
  console.log(`  encrypted:   ${enc.learned}/${enc.groups} (${pct(enc.share)}), mean day ${enc.meanDay}; lines caught ${enc.heard}`);
  console.log(`  discipline:  ${win.learned}/${win.groups} (${pct(win.share)}), mean day ${win.meanDay}; lines caught ${win.heard}`);
  console.log(`  hub silent:  ${sil.learned}/${sil.groups} (${pct(sil.share)}); lines caught ${sil.heard}`);
  check(base.groups > 0 && base.learned > 0, "groups in your coverage learn the hub from your traffic");
  check(enc.heard < base.heard, "encryption cuts what they catch");
  check(win.heard < base.heard, "radio discipline cuts what they catch");
  check(base.meanDay == null || enc.meanDay == null || enc.meanDay >= base.meanDay * 0.8, "encrypted: they take about as long or longer to learn it");
  check(sil.learned === 0, "a hub running silent is never traced on the air");
}

// ======================================================================================
section("Hidden bases: passing parties and scouts");
{
  const st = world();
  const h = hub(st);
  const g = gang(st, 14);
  const t1 = ringTile(st, g.bases[0], 6, [h.tile]);
  const plain = outpost(st, t1, "Plain outpost");
  const near = st.grid.neighbors(t1).find((t) => st.tiles[t].terrain !== "water");
  const rate = (b, n = 600) => {
    let got = 0;
    const h0 = st.hour;
    for (let i = 0; i < n; i++) {
      st.hour = h0 + i * 24;
      delete G.knowsOf(st, g).bases[b.tile];
      if (G.partySaw(st, g, near)) got++;
    }
    st.hour = h0;
    return got / n;
  };
  const cPlain = H.concealOf(st, plain).value;
  const rPlain = rate(plain);
  plain.silent = true;
  addBuilding(plain, "camo");
  const cHid = H.concealOf(st, plain).value;
  const rHid = rate(plain);
  console.log(`  a party passing within sight learns the outpost: normal (concealment ${pct(cPlain)}) ${pct(rPlain)}, silent + camouflage (concealment ${pct(cHid)}) ${pct(rHid)}`);
  check(cHid > cPlain + 0.4, "Run silent and camouflage raise concealment");
  check(rHid < rPlain * 0.6, "a hidden outpost is learned far less often by passing parties");
  // Scouts that come looking.
  let miss = 0;
  for (let i = 0; i < 400; i++) if (H.missesBase(st, g, plain.tile, H.HIDE.SCOUT, "look", i)) miss++;
  console.log(`  a scout that comes looking misses it ${pct(miss / 400)} of the time (concealment × ${H.HIDE.SCOUT})`);
  check(miss / 400 > 0.3 && miss / 400 < 0.8, "scouts miss a hidden outpost now and then");
  // A known hidden base nothing confirms slips out of their knowledge.
  G.learnBase(st, g, plain.tile, day(st));
  let gone = null;
  for (let i = 0; i < 120 && gone == null; i++) { nextDay(st); H.forgetDaily(st, g, day(st)); if (!G.knownBase(st, g, plain.tile)) gone = i + 1; }
  check(gone != null && gone >= H.HIDE.FORGET_AFTER, `a hidden outpost unseen for a month slipped out of their knowledge (after ${gone} days)`);
  const op2 = outpost(st, ringTile(st, g.bases[0], 7, [h.tile, t1]), "Busy outpost");
  G.learnBase(st, g, op2.tile, day(st));
  for (let i = 0; i < 120; i++) { nextDay(st); H.forgetDaily(st, g, day(st)); }
  check(!!G.knownBase(st, g, op2.tile) || H.concealOf(st, op2).value >= H.HIDE.FORGET_MIN, "an outpost that is not hidden stays known");
  // Running silent: quieter, slower.
  const was = baseHeat(st, h);
  h.silent = true;
  check(baseHeat(st, h) <= was, `running silent lowers Heat (${was} → ${baseHeat(st, h)})`);
  h.silent = false;
}

// ======================================================================================
section("Scouts at the walls: caught, questioned, misled");
{
  const st = world();
  const h = hub(st);
  const g = gang(st);
  addBuilding(h, "lockup");
  const n0 = st.cards.length;
  G.scoutYou(st, g, h, day(st), true);
  const card = st.cards[n0];
  const labels = card ? card.choices.map((c) => c.label) : [];
  check(card && ["Chase them off", "Capture them", "Kill them", "Feed them false information", "Let them watch"].every((l) => labels.includes(l)), `the scout card: ${labels.join(" / ")}`);
  const pop0 = g.pop;
  const text = card.choices.find((c) => c.label === "Capture them").resolve(st);
  const pr = prisonersAt(st, h.id).find((p) => p.factionId === g.id);
  check(pr && pr.scout && g.pop === pop0 - 1, `captured: one of theirs in the cells (${text})`);
  // Questioned: what their group knows of you.
  const op = outpost(st, ringTile(st, h.tile, 6, g.bases), "Hill outpost");
  G.learnBase(st, g, h.tile, day(st)); G.knowsOf(st, g).bases[h.tile].via = "radio";
  delete G.knowsOf(st, g).bases[op.tile];
  const said = gatherIntel(st, pr, true).text;
  check(said.includes(`${h.name} (heard of it on your radio`) && said.includes(`Nothing of ${op.name}`), `interrogation reveals what they know: "${said.slice(said.indexOf("What"), said.indexOf("What") + 140)}…"`);
  // Feed false information: they think the hub far stronger and poorer.
  for (const s of atBase(st, h.id)) s.skills.speech = 10;
  const truth = G.learnBase(st, g, h.tile, day(st)).def;
  let misled = false;
  for (let i = 0; i < 20 && !misled; i++) { nextDay(st); I.scoutFalse(st, g, h); misled = !!G.knownBase(st, g, h.tile).misled; }
  check(misled && G.knownBase(st, g, h.tile).def >= truth * 2, `fed false information, they think the hub's defence ${G.knownBase(st, g, h.tile).def} (it is ${truth})`);
  check(I.knowsLine(st, g).includes("far stronger than it is"), "questioned later, they say it");
  // Kill: they learn nothing, one fewer.
  const p1 = g.pop;
  I.scoutKilled(st, g, h);
  check(g.pop === p1 - 1, "a scout killed: one of theirs gone");
}

// ======================================================================================
section("Decoys");
{
  const st = world();
  const h = hub(st);
  const g = gang(st);
  const said = I.broadcastDecoy(st, "base");
  const item = st.intel.air.find((x) => x.fakeTile != null);
  check(item && /does not exist/.test(said), "a decoy outpost goes on the air");
  I.heardYou(st, g, item, day(st));
  const fk = G.knowsOf(st, g).bases[item.fakeTile];
  check(fk && fk.fake && fk.kind === "player", `the gang believes in an outpost at tile ${item.fakeTile}`);
  check(/decoy/.test(I.knowsLine(st, g)), "questioned, they would name it");
  check(/another from day/.test(I.broadcastDecoy(st, "caravan")), "one decoy every INTEL.DECOY.EVERY days");
  I.decoyRaid(st, g, item.fakeTile);
  check(!G.knowsOf(st, g).bases[item.fakeTile] && g.distrustYou > day(st) && g.decoyWaste === I.INTEL.DECOY.WASTE, "their raid on it finds empty ground: days lost, and they distrust your traffic");
  // The decoy caravan: a gang waits for nothing.
  const st2 = world(seed + 5);
  const g2 = gang(st2, 6);
  const t2 = I.broadcastDecoy(st2, "caravan");
  const cvi = st2.intel.air.find((x) => x.fake && x.kind === "caravan");
  check(cvi && cvi.path.length > 1, `a decoy caravan goes on the air (${t2.slice(0, 80)}…)`);
  I.heardYou(st2, g2, cvi, day(st2));
  const lying = !!g2.lying;
  const cd = g2.raidCooldown || 0;
  if (lying) { nextDay(st2, cvi.arrive - day(st2) + I.INTEL.AMBUSH.SLACK + 1); I.intelDaily(st2); }
  check(!lying || (!g2.lying && g2.raidCooldown >= cd + I.INTEL.DECOY.WASTE && g2.distrustYou > day(st2)), `a gang that waited for the decoy caravan lost days of raiding (${lying ? "it bit" : "the road passed too far from it"})`);
  // Fooled once, they ignore decoys.
  const before = Object.keys(G.knowsOf(st, g).bases).length;
  I.heardYou(st, g, { ...item, key: "decoy:again" }, day(st));
  check(Object.keys(G.knowsOf(st, g).bases).length === before, "a group fooled lately ignores the next decoy");
}

// ======================================================================================
section("AI parity: the groups listen to each other, run silent and hide outposts");
{
  const st = world();
  const g = gang(st);
  const o = st.factions.find((f) => f.alive && f !== g && f.bases.length);
  o.type = "traders";
  o.bases = [ringTile(st, g.bases[0], 4, [hub(st).tile])];
  if (st.groupWorks) worksAt(o, o.bases[0]).radio = 1; // ai-locks: their channel is on the air from a radio station (traders: Mechanics 4)
  // A caravan of theirs on the road: the gang hears it and waits for it.
  const q = { id: 770001, owner: o.id, kind: "caravan", phase: "out", path: [o.bases[0], ...st.grid.neighbors(o.bases[0]).filter((t) => free(st, t)).slice(0, 2)], idx: 0, progress: 0, strength: 3 };
  st.parties.push(q);
  st.radioChan = { traffic: { [o.id]: [{ key: "cv:test", kind: "caravan", partyId: q.id, baseId: null, dest: q.path[2], text: "", day: day(st) }] }, got: {}, memo: {} };
  let heard = false;
  for (let i = 0; i < 40 && !heard; i++) { st.intel = undefined; g.lying = null; g.ear = { net: o.id, day: day(st) }; st.hour += 24; st.radioChan.traffic[o.id][0].day = day(st); I.aiListen(st, g, day(st)); heard = lyingFor(st, g, q); }
  check(heard, "a gang overhearing a group's caravan on its channel waits for it");
  // A raid on the listener: it is braced.
  st.radioChan.traffic[o.id] = [{ key: "raid:test", kind: "raid", partyId: 770002, targetFaction: g.id, text: "", day: day(st) }];
  let braced = false;
  for (let i = 0; i < 40 && !braced; i++) { st.intel = undefined; g.ear = { net: o.id, day: day(st) }; st.hour += 24; st.radioChan.traffic[o.id][0].day = day(st); I.aiListen(st, g, day(st)); braced = g.bracedFor === 770002; }
  check(braced, "a group that hears a raid coming for it stands ready");
  // Radio discipline by type: the military's channel says less in the clear.
  const mil = { type: "military" }, trd = { type: "traders" };
  const { silentMult } = await import("../src/sim/radiolisten.js");
  check(silentMult(mil) < silentMult(trd) && silentMult(trd) === 1, `run silent by type: military × ${silentMult(mil)}, traders × ${silentMult(trd)}`);
  // A hidden outpost: off their network, off your map until found.
  const hider = st.factions.find((f) => f.alive && f !== g && f !== o) || o;
  hider.type = "zealot";
  let tile = null;
  for (const t of st.grid.within(hider.bases[0], 6)) { if (!free(st, t)) continue; hider.bases.push(t); if (H.groupHides(st, hider, t)) { tile = t; break; } hider.bases.pop(); }
  check(tile != null, "a zealot group keeps an outpost hidden");
  if (tile != null) {
    H.hidingDaily(st);
    check(H.unseenOutpost(st, tile) && snapshot(st, tile).factionBase == null, "you have not found it: bare ground on your map");
    if (st.groupWorks) for (const t of [hider.bases[0], tile]) worksAt(hider, t).radio = 1; // ai-locks: on the air only from radio stations (radio.js groupNetwork)
    const hn = groupNetwork(st, hider);
    check(!!hn && hn.nodes.some((n) => n.tile === hider.bases[0]) && !hn.nodes.some((n) => n.tile === tile), "it keeps off their radio network (its station silent, the main base's on the air)");
    st.parties.push({ id: 660001, owner: "player", kind: "team", phase: "out", path: [st.grid.neighbors(tile)[0]], idx: 0 });
    H.hidingDaily(st);
    check(!H.unseenOutpost(st, tile) && snapshot(st, tile).factionBase === hider.id && st.log.slice(-3).some((l) => /hidden outpost/.test(l.text || l)), "a team walking past finds it, and it is on the map");
    st.parties.pop();
    let miss = 0;
    for (let i = 0; i < 300; i++) if (H.missesBase(st, g, tile, H.HIDE.PASS, "pass", i)) miss++;
    console.log(`  another group's party passing it misses the hidden outpost ${pct(miss / 300)} of the time`);
    check(miss > 100, "the other groups' parties miss it too");
  }
}

// ======================================================================================
section("The screens: the Defence tab's Concealment card, the radio header's Radio security");
{
  const st = world();
  const h = hub(st);
  const { concealCard, radioSecurity, INTEL_ACTIONS, INTEL_CHANGE } = await import("../src/ui/intel.js");
  const { defenceTab } = await import("../src/ui/defence.js");
  const clean = (html) => !/undefined|NaN|\[object/.test(html);
  const tab = defenceTab(st, h, {});
  check(tab.includes("Concealment") && tab.includes('data-action="hide-silent"') && clean(tab), "the Defence tab shows concealment and Run silent");
  const ui = {};
  INTEL_ACTIONS["hide-silent"](st, ui, { base: String(h.id), v: "1" });
  check(h.silent && /runs silent/.test(ui.defence.msg) && concealCard(st, h).includes("Running silent"), "Run silent from the tab");
  const rs = radioSecurity(st);
  check(rs.includes("Radio security") && rs.includes('data-action="intel-decoy"') && rs.includes('data-action="intel-discipline"') && clean(rs), "the radio header shows discipline and decoys");
  INTEL_CHANGE["intel-discipline"](st, ui, { value: "windows" });
  check(I.discipline(st) === "windows", "discipline from the header");
  INTEL_ACTIONS["intel-decoy"](st, ui, { v: "base" });
  check(/does not exist/.test(ui.radioMsg) && radioSecurity(st).includes("disabled"), "a decoy from the header, then the buttons wait");
}

// ======================================================================================
section("Save and load");
{
  const st = world();
  const h = hub(st);
  const g = gang(st);
  h.silent = true;
  I.setDiscipline(st, "windows");
  I.broadcastDecoy(st, "base");
  const item = st.intel.air.find((x) => x.fakeTile != null);
  I.heardYou(st, g, item, day(st));
  I.intelDaily(st);
  st.parties.push({ id: 5, owner: "player", kind: "convoy", phase: "out", path: [h.tile], idx: 0 });
  g.lying = { partyId: 5, tile: g.bases[0], until: day(st) + 3, day: day(st) };
  const back = deserializeState(JSON.parse(JSON.stringify(serializeState(st, { dropCards: true }))));
  const g2 = back.factions.find((f) => f.id === g.id);
  check(back.bases.find((b) => b.id === h.id).silent === true, "Run silent survives");
  check(I.discipline(back) === "windows", "radio discipline survives");
  check(g2.knows.bases[item.fakeTile] && g2.knows.bases[item.fakeTile].fake, "a decoy they believe in survives");
  check(g2.lying && g2.lying.until === g.lying.until && g2.ear && g2.ear.net === g.ear.net, "an ambush laid and the channel they listen to survive");
  check(JSON.stringify(back.intel.stats) === JSON.stringify(st.intel.stats) && back.intel.decoyDay === st.intel.decoyDay, "the intel record survives");
}

console.log(`\n${failed ? "failed" : "passed"}: ${passed} checks passed, ${failed} failed`);
if (failed) process.exitCode = 1;
