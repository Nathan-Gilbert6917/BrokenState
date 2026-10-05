// Hardcore mode, your start (sim/hardcore-start.js): the spawn, what the three grabbed as they fled, the low supplies,
// founding the first hub, the hubless views, saves before and after the hub, and the autopilot founding one.
// Usage: node tools/hcstarttest.js [autopilot games] (default 8)
import { createWorld, tickHour, hub, day, alive, atBase } from "../src/sim/world.js";
import { GEAR, SUPPLIES } from "../src/sim/data.js";
import { partyTile, partyMembers, orderOptions, giveOrder, orderMove, carried, MISSIONS } from "../src/sim/parties.js";
import { packSize } from "../src/sim/inventory.js";
import { setAutopilot } from "../src/sim/autopilot.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import {
  HC_START, playerTile, roadTeam, firstHubPending, foundMissing, foundProblem, foundingView, hubSites, FOUND_LABEL,
} from "../src/sim/hardcore-start.js";
import { renderTopbar, renderLeft, renderRight, renderModal } from "../src/ui/ui.js";
import { computeAlerts, renderAlerts } from "../src/ui/alerts.js";
import { diaryModal, openDiary } from "../src/ui/diary.js";
import { rosterModal, openRoster } from "../src/ui/roster.js";
import { settingsModal, openSettings } from "../src/ui/settings.js";
import { newRunScreen } from "../src/ui/newgame.js";
import { loadOptions } from "../src/ui/saves.js";

const apGames = Number(process.argv[2] || 8);
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(t);
const hc = (seed, extra = {}) => createWorld({ seed, factionCount: 7, mode: "hardcore", ...extra });

// ---------- spawn ----------
section("Spawn: three survivors on the road, no hub, a reasonable place");
const SEEDS = [11, 23, 42, 77, 101, 202, 303, 404, 505, 606, 707, 808];
const worlds = SEEDS.map((s) => hc(s));
for (const st of worlds) {
  const g = st.grid;
  const p = roadTeam(st);
  const tag = `seed ${st.seed}`;
  if (!check(!!p, `${tag}: a team on the road`)) continue;
  const tile = st.tiles[partyTile(p)];
  check(st.mode === "hardcore" && st.bases.length === 0 && !hub(st), `${tag}: no base`);
  check(partyMembers(st, p).length === HC_START.CREW && st.survivors.length === HC_START.CREW, `${tag}: ${HC_START.CREW} survivors, all on the team`);
  check(st.survivors.filter((s) => s.leader).length === 1, `${tag}: one leader`);
  check(playerTile(st) === tile.id, `${tag}: playerTile is the team's tile`);
  check(tile.terrain !== "water" && tile.terrain !== "mountain" && tile.terrain !== "city" && !tile.loc && !tile.hive, `${tag}: open land (${tile.terrain}${tile.loc ? `, ${tile.loc.type}` : ""})`);
  check(g.distance(tile.id, st.originId) >= HC_START.SPAWN.origin[1], `${tag}: away from the outbreak origin (${g.distance(tile.id, st.originId)})`);
  check(!g.neighbors(tile.id).some((n) => st.tiles[n].terrain === "city") && st.cityIds.every((c) => g.distance(tile.id, c) >= HC_START.SPAWN.city[1]), `${tag}: not in or next to a city`);
  check(st.factions.every((f) => !f.bases.includes(tile.id)), `${tag}: not on a group's base`);
  const e = HC_START.SPAWN.edge[1];
  check(tile.x >= g.width * e && tile.x < g.width * (1 - e) && tile.y >= g.height * e && tile.y < g.height * (1 - e), `${tag}: not in a corner (${tile.x},${tile.y})`);
  const town = st.tiles.some((t) => t.loc && t.loc.type === "town" && g.distance(t.id, tile.id) <= HC_START.SPAWN.townReach);
  const sites = st.tiles.filter((t) => t.loc && t.loc.type !== "city" && g.distance(t.id, tile.id) <= HC_START.SPAWN.siteReach).length;
  check(town || sites >= HC_START.SPAWN.sitesNear, `${tag}: a town or ${HC_START.SPAWN.sitesNear}+ sites within reach (town ${town}, sites ${sites})`);
  check(hubSites(st, tile.id, 6).length > 0, `${tag}: somewhere to found a hub nearby`);
  check(st.vehicles.length === 0 || st.vehicles.every((v) => v.loc.kind !== "party" && !(v.loc.kind === "base")), `${tag}: no vehicle of yours`);
  check(st.cards.length >= 1 && st.cards[0].isOrders && st.cards[0].partyId === p.id && /Calder is falling/.test(st.cards[0].text), `${tag}: the run opens on the team's orders card`);
}

// ---------- what they grabbed ----------
section("What they grabbed: bags or pockets, household things, very low supplies");
let bags = 0, pocketsOnly = 0, armed = 0, unarmed = 0;
const bagKinds = new Set(), weaponKinds = new Set(), itemKinds = new Set();
for (const st of worlds) {
  const p = roadTeam(st);
  if (!p) continue;
  for (const s of partyMembers(st, p)) {
    if (s.gear.backpack) { bags++; bagKinds.add(s.gear.backpack.key); } else pocketsOnly++;
    if (s.gear.weapon) { armed++; weaponKinds.add(s.gear.weapon.key); } else unarmed++;
    for (const it of s.pockets.filter(Boolean)) { itemKinds.add(it.key); check(GEAR[it.key] && GEAR[it.key].small, `seed ${st.seed}: ${it.key} in a pocket is small`); }
    if (s.gear.backpack) {
      const c = s.gear.backpack.contents || [];
      check(c.length === packSize(s.gear.backpack), `seed ${st.seed}: ${s.gear.backpack.key} has its slots`);
      for (const it of c.filter(Boolean)) { itemKinds.add(it.key); check(!!GEAR[it.key] && !packSize(it) && !GEAR[it.key].bulky, `seed ${st.seed}: ${it.key} fits in a pack`); }
    }
    for (const k of ["weapon", "tool", "backpack"]) if (s.gear[k]) check(GEAR[s.gear[k].key] && GEAR[s.gear[k].key].slot === k, `seed ${st.seed}: ${s.gear[k].key} in its slot`);
    check(!s.gear.armor, `seed ${st.seed}: nobody fled in body armor`);
  }
  const sup = p.supplies, n = partyMembers(st, p).length;
  check(sup.food >= HC_START.TEAM_MIN && sup.food <= HC_START.TEAM_MAX && sup.water >= HC_START.TEAM_MIN && sup.water <= HC_START.TEAM_MAX, `seed ${st.seed}: 1–3 days of food and water for three (${sup.food} food, ${sup.water} water)`);
  check(sup.food / n <= 3 && sup.water / n <= 3, `seed ${st.seed}: no more than 3 days each`);
  check(!sup.fuel && !sup.scrap && !sup.parts && (sup.ammo || 0) <= 36 && (sup.meds || 0) <= 3, `seed ${st.seed}: no fuel, scrap or parts, almost no ammo (${sup.ammo || 0}) or meds`);
  check(Object.values(sup).every((v) => Number.isFinite(v) && v >= 0), `seed ${st.seed}: clean supply numbers`);
}
check(bags > 0 && pocketsOnly > 0, `some fled with a bag, some with only pockets (${bags} bags, ${pocketsOnly} pockets only)`);
check(armed > 0 && unarmed > 0, `some grabbed a weapon, some did not (${armed} armed: ${[...weaponKinds].join(", ")})`);
check(bagKinds.size >= 2 && itemKinds.size >= 8, `the rolls vary (${bagKinds.size} kinds of bag, ${itemKinds.size} kinds of thing)`);
{
  const a = hc(4242), b = hc(4242);
  const sig = (st) => JSON.stringify(st.survivors.map((s) => [s.name, s.gear, s.pockets])) + JSON.stringify(roadTeam(st).supplies) + partyTile(roadTeam(st));
  check(sig(a) === sig(b), "same seed, same start (spawn, gear and supplies)");
  const n = createWorld({ seed: 4242, factionCount: 7 });
  check(n.mode === "normal" && n.bases.length === 1 && n.survivors.length === 6 && hub(n) && n.bases[0].buildings.length > 0, "a normal world still starts with its hub, six survivors and buildings");
  // New-game crew edits: the first three colonists' names and the leader carry into a hardcore start.
  const crew = [{ name: "Ada Vance", skills: { scavenging: 12 } }, { name: "Bo Reyes", leader: true }, { name: "Cy Moss" }, { name: "Dee Six", leader: false }];
  const c = hc(4242, { crew });
  check(c.survivors.map((s) => s.name).join() === "Ada Vance,Bo Reyes,Cy Moss" && c.survivors[1].leader && c.survivors.filter((s) => s.leader).length === 1 && c.survivors[0].skills.scavenging === 12, "crew edits apply to the three (names, skills, leader)");
  const c2 = hc(4242, { crew: [{}, {}, {}, { leader: true }] });
  check(c2.survivors.filter((s) => s.leader).length === 1, "a leader from beyond the first three: someone still leads");
}

// ---------- founding the first hub ----------
section("Founding the first hub: it takes what the team gathered, and it is the hub");
{
  const st = hc(77);
  const p = roadTeam(st);
  const opt = () => orderOptions(st, p).find((o) => o.mission === "outpost");
  check(opt() && opt().label === FOUND_LABEL && !!opt().disabled && /Still missing/.test(opt().disabled), `the order is offered but says what is missing ("${opt() && opt().disabled}")`);
  check(foundMissing(st, p).length === 4 && !!foundProblem(st, p), "everything is missing at the start");
  // Give it: refused, nothing happens.
  giveOrder(st, p, "outpost");
  check(st.bases.length === 0 && st.parties.includes(p) && p.phase === "waiting", "founding without the materials is refused");
  check(st.cards.some((c) => c.partyId === p.id && /Still missing/.test(c.text)), "the refusal says what is missing");
  // Gathered, short of one part.
  const F = HC_START.FOUND;
  p.cargo.supplies.scrap = F.scrap + 4; p.cargo.supplies.parts = F.parts - 1; p.cargo.supplies.food = F.food; p.cargo.supplies.water = F.water;
  check(foundMissing(st, p).length === 1 && foundMissing(st, p)[0].key === "parts", "one part short: only parts missing");
  p.cargo.supplies.parts = F.parts + 1;
  p.cargo.gear.push({ key: "crowbar", name: GEAR.crowbar.name, quality: 1 });
  check(!foundMissing(st, p).length && opt() && !opt().disabled, "with everything carried the order is open");
  const view = foundingView(st);
  check(view && view.ready && view.rows.every((r) => r.ok), "the founding view says ready");
  const people = partyMembers(st, p).map((s) => s.id);
  const before = { food: carried(p, "food"), water: carried(p, "water") };
  st.cards.length = 0;
  giveOrder(st, p, "outpost");
  const h = hub(st);
  check(!!h && st.bases.length === 1 && h.type === "hub" && !st.parties.includes(p), "the base it founds is the hub, and the team is gone");
  check(h && /Holdout/.test(h.name), `named as a holdout (${h && h.name})`);
  check(h && h.buildings.length === 0 && h.construction.length === 0 && st.vehicles.length === 0, "it starts bare: no buildings, no truck");
  check(h && h.stock.scrap === 4 && h.stock.parts === 1, `the scrap and parts are used (left: ${h && h.stock.scrap} scrap, ${h && h.stock.parts} parts)`);
  check(h && h.stock.food >= before.food - 1 && h.stock.water >= before.water - 1, "the food and water are its stores");
  check(h && h.armory.some((it) => it.key === "crowbar"), "the team's finds go to its armory");
  check(h && people.every((id) => atBase(st, h.id).some((s) => s.id === id)), "everyone lives there now");
  check(!firstHubPending(st) && st.hardcore.start.foundedDay === day(st) && playerTile(st) === h.tile, "the first hub is done, playerTile is the hub");
  check(st.cards.some((c) => c.title === "A place of your own"), "a card marks the day");
  check(h && atBase(st, h.id).some((s) => s.role === "farm"), "jobs assigned by skill, as a normal start (someone farms)");
  // Later bases: the normal rules (15 scrap, an outpost).
  check(!/Still missing/.test(MISSIONS.outpost.desc), "Build outpost keeps its normal text");
  try { for (let i = 0; i < 48; i++) tickHour(st); check(true, "the new hub runs"); } catch (e) { check(false, `the new hub runs: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); }
}

// ---------- hubless views ----------
section("The views with no hub: render cleanly");
const BAD = /\b(undefined|NaN|Infinity)\b|\[object [A-Za-z]+\]|\bnull\b/;
const VOID = new Set(["input", "br", "img", "hr", "meta", "link"]);
function scan(html, where) {
  if (typeof html !== "string") return [`${where}: no html (${typeof html})`];
  const out = [];
  const text = html.replace(/<[^>]*>/g, " ");
  const m = BAD.exec(text);
  if (m) out.push(`${where}: "${m[0]}" near "${text.slice(Math.max(0, m.index - 60), m.index + 30).replace(/\s+/g, " ")}"`);
  for (const a of html.matchAll(/(data-[\w-]+|title|value)="([^"]*)"/g)) if (BAD.test(a[2])) out.push(`${where}: bad attribute ${a[1]}="${a[2].slice(0, 80)}"`);
  const stack = [];
  for (const t of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)[^>]*?(\/?)>/g)) {
    const tag = t[2].toLowerCase();
    if (VOID.has(tag) || t[3]) continue;
    if (!t[1]) stack.push(tag);
    else if (stack.pop() !== tag) { out.push(`${where}: unbalanced </${tag}>`); break; }
  }
  if (stack.length) out.push(`${where}: unclosed <${stack.join("> <")}>`);
  return out;
}
const freshUi = () => ({ started: true, speed: 0, tab: "bases", selected: -1, survivor: null, baseView: null, expedition: null, diary: null, roster: null, help: false, scale: 1, armed: { parties: new Map(), builds: new Set(), crafts: new Set() } });
function views(st, label) {
  const out = [];
  const p = roadTeam(st);
  const add = (where, fn) => { try { out.push([where, fn()]); } catch (e) { out.push([where, null]); check(false, `${label} ${where}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); } };
  add("top bar", () => renderTopbar(st, freshUi()));
  for (const tab of ["bases", "people", "groups", "teams"]) add(`left/${tab}`, () => renderLeft(st, { ...freshUi(), tab }));
  add("right/idle", () => renderRight(st, freshUi()));
  if (p) {
    add("right/team tile", () => renderRight(st, { ...freshUi(), selected: partyTile(p) }));
    add("right/team panel", () => renderRight(st, { ...freshUi(), expedition: p.id }));
  }
  const far = st.tiles.find((t) => t.loc && t.loc.type === "town");
  add("right/a town", () => renderRight(st, { ...freshUi(), selected: far.id }));
  add("right/water", () => renderRight(st, { ...freshUi(), selected: st.tiles.find((t) => t.terrain === "water").id }));
  add("modal/card", () => renderModal(st, freshUi()) || "");
  const s0 = alive(st)[0];
  if (s0) {
    const cards = st.cards.splice(0); // the survivor and inventory screens sit under any card
    add("modal/survivor", () => renderModal(st, { ...freshUi(), survivor: s0.id }) || "");
    add("modal/inventory", () => renderModal(st, { ...freshUi(), inv: { sid: s0.id } }) || "");
    add("modal/memorial", () => renderModal(st, { ...freshUi(), memorial: { baseId: null } }) || "");
    st.cards.push(...cards);
  }
  add("modal/planner", () => renderModal(st, { ...freshUi(), planner: { dest: far.id, mission: "scavenge", crew: new Set(), supplies: {} } }) || "");
  const ui1 = freshUi(); openDiary(ui1);
  add("diary", () => diaryModal(st, ui1));
  const ui2 = freshUi(); openRoster(ui2);
  add("roster", () => rosterModal(st, ui2));
  add("alerts", () => renderAlerts(st, freshUi()));
  const api = { options: loadOptions(), desktop: false, autosaveInfo: () => ({ error: "" }), refresh() {}, track() {}, thumb: () => "" };
  for (const tab of ["game", "about"]) { const ui = freshUi(); openSettings(ui, tab); add(`settings/${tab}`, () => settingsModal(st, ui, api)); }
  return out;
}
{
  const st = hc(42);
  st.started = true;
  let probs = [];
  for (const [where, html] of views(st, "day 1")) if (html != null) probs.push(...scan(html, where));
  check(!probs.length, `day 1, hubless: clean views (${probs.slice(0, 4).join(" | ")})`);
  const all = views(st, "day 1").map(([, h]) => h || "").join("\n");
  check(/On the road/.test(all) && /Your first hub/.test(all) && /Hub needs/.test(all), "the top bar and the Bases tab show the team and what the hub needs");
  check(/First: found your hub/.test(all), "the Goals card puts the hub first");
  check(/From the team/.test(all), "the tile panel measures from the team");
  check(/No hub yet/.test(all), "the planner says there is no hub to send from");
  check(/Hardcore/.test(all), "the settings say Hardcore");
  const al = computeAlerts(st);
  check(al.some((a) => a.kind === "firsthub"), "an alert for the hub not founded yet");
  // Run hubless for two weeks (cards: hold), the team kept fed: every system that looks for a hub copes.
  const p0 = roadTeam(st);
  check(st.live.has(partyTile(p0)) && st.grid.neighbors(partyTile(p0)).every((n) => st.live.has(n)), "you see live around the team");
  const known0 = st.knowledge.filter(Boolean).length;
  const dest = st.tiles.filter((t) => t.terrain !== "water" && st.grid.distance(t.id, partyTile(p0)) === 6).find((t) => orderMove(st, p0, t.id) && p0.phase === "out");
  st.cards.length = 0;
  try {
    for (let i = 0; i < 24 * 14; i++) {
      tickHour(st);
      const p = roadTeam(st);
      if (p) { p.supplies.food = 20; p.supplies.water = 20; for (const s of partyMembers(st, p)) s.health = Math.max(s.health, 60); }
      while (st.cards.length) {
        const c = st.cards.shift();
        const ch = c.choices.find((x) => /^Hold|^OK$|^Leave|^Back off|^Mark it/.test(x.label)) || c.choices.find((x) => !x.uiAction && !(typeof x.disabled === "function" ? x.disabled(st) : x.disabled));
        if (ch) ch.resolve(st);
      }
      if (st.engagement) st.engagement = null;
    }
    check(!st.gameOver && alive(st).length > 0, `two weeks hubless (day ${day(st)}, ${alive(st).length} alive)`);
  } catch (e) { check(false, `two weeks hubless: ${e.stack.split("\n").slice(0, 4).join(" | ")}`); }
  probs = [];
  for (const [where, html] of views(st, "day 15")) if (html != null) probs.push(...scan(html, where));
  check(!probs.length, `day 15, hubless: clean views (${probs.slice(0, 4).join(" | ")})`);
  check(st.chronicle && Array.isArray(st.chronicle.frames) ? st.chronicle.frames.length >= 10 : true, "the timelapse kept recording");
  check(!!dest && st.knowledge.filter(Boolean).length > known0 + 10, `the team's own sight maps the land as it walks (${known0} → ${st.knowledge.filter(Boolean).length} tiles known)`);
  // New-run screen in both modes.
  for (const mode of ["hardcore", "normal"]) {
    const w = mode === "hardcore" ? hc(5) : createWorld({ seed: 5, factionCount: 7 });
    const html = newRunScreen(w, { ...freshUi(), started: false, worldSize: "normal", factionCount: 7 });
    check(!scan(html, mode).length && /data-action="gamemode"/.test(html) && new RegExp(`value="${mode}" selected`).test(html), `new-run screen (${mode}): the Mode select, clean`);
    check((html.match(/nrcard/g) || []).length === (mode === "hardcore" ? 3 : 6), `new-run screen (${mode}): ${mode === "hardcore" ? 3 : 6} colonists to edit`);
  }
}

// ---------- saves ----------
section("Saves: hubless and after founding");
{
  const st = hc(101);
  st.cards.length = 0;
  for (let i = 0; i < 30; i++) tickHour(st);
  st.cards.length = 0;
  const p0 = roadTeam(st);
  const text = saveToString(st);
  const ld = loadFromString(text);
  const p1 = roadTeam(ld);
  check(JSON.parse(text).meta.mode === "hardcore", "the save list knows it is hardcore");
  check(ld.mode === "hardcore" && firstHubPending(ld) && !!p1 && p1.hcStart && partyTile(p1) === partyTile(p0) && partyMembers(ld, p1).length === partyMembers(st, p0).length, "hubless: the team and the start come back");
  check(JSON.stringify(p1.supplies) === JSON.stringify(p0.supplies), "hubless: its supplies too");
  try { for (let i = 0; i < 24; i++) tickHour(ld); check(true, "the loaded hubless world runs"); } catch (e) { check(false, `the loaded hubless world runs: ${e.message}`); }
  // Found, save, load.
  const p = roadTeam(ld);
  ld.cards.length = 0;
  if (p) {
    Object.assign(p.cargo.supplies, { scrap: 40, parts: 5, food: 20, water: 20 });
    giveOrder(ld, p, "outpost");
  }
  ld.cards.length = 0;
  const h = hub(ld);
  const l2 = loadFromString(saveToString(ld));
  check(!!h && hub(l2) && hub(l2).name === h.name && !firstHubPending(l2) && l2.hardcore.start.foundedDay === ld.hardcore.start.foundedDay && l2.mode === "hardcore", "after founding: the hub and the founding day come back");
  check(createWorld({ seed: 9, factionCount: 7 }).mode === "normal" && loadFromString(saveToString(createWorld({ seed: 9, factionCount: 7 }))).mode === "normal", "a normal save stays normal");
}

// ---------- the autopilot ----------
section(`Autopilot: a hubless start founds a hub (${apGames} games)`);
{
  const res = [];
  for (let i = 0; i < apGames; i++) {
    const st = hc(9000 + i * 13);
    st.started = true;
    setAutopilot(st, true, "balanced");
    try {
      while (day(st) <= 30 && !st.gameOver) tickHour(st);
    } catch (e) { check(false, `autopilot game ${i}: ${e.stack.split("\n").slice(0, 3).join(" | ")}`); }
    res.push({ founded: st.hardcore.start.foundedDay, alive: alive(st).length, hub: hub(st) });
  }
  const founded = res.filter((r) => r.founded != null && r.founded <= 21).length;
  const living = res.filter((r) => r.alive > 0).length;
  console.log(`  founded within 3 weeks: ${founded}/${apGames} (days ${res.map((r) => r.founded ?? "-").join(", ")}); alive at day 30: ${living}/${apGames}`);
  check(founded >= Math.ceil(apGames * 0.6), "most games found a hub within three weeks");
  check(living >= 1, "not every game dies in the first month");
  check(res.filter((r) => r.hub).every((r) => r.hub.type === "hub"), "what they found is a hub");
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
