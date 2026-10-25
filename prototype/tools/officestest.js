// Office buildings of every kind, with named firms (the user's request 2026-10-25, issue #27 of the interiors epic #7:
// "add office building varients"; src/sim/data-offices.js, officeplans.js, officelayout.js, shops.js):
// - the data: every office kind is a site type with its raid rooms, a building, its storeys and 4–10 firms of its own
//   (a look, weights by setting, a plan); the office tower has firms; the new pieces have their drawings
// - each kind laid out for its kind, over many seeds and every firm: its signature rooms and pieces (a dentist's
//   operatories with dental chairs, a doctor's exam rooms, a tower's lobby turnstiles and lift bank and its floors
//   varying, two stair runs on every floor of a tower of 6+, the executive suite's safe and liquor cabinet, city hall's
//   council chambers with the dais and the seats facing it, the courthouse's courtroom with its bench, jury box,
//   witness stand and gallery, its holding cell's bars and the screening entrance, a call center's headset desks, a tech
//   office's benches, beanbags, pool table and phone booths, a TV studio's cameras and news desk...); every floor one
//   walk and every container reachable; the same building the same layout every visit
// - loot per cell of floor within ±10% of the old office tower's (reported per kind)
// - an older save: its office towers keep their old plan, a tower without a firm too; none of the new places
// - where they stand: as points of interest by the setting (storefronts in the towns, business parks in the suburbs,
//   tech offices and call centers in the cities, stations in the towns), in the crawls, city hall in every town's and
//   city's crawl and the courthouse in every city's and a county seat's; their rates over 300 seeded towns and cities;
//   two office buildings on a tile or a crawl block never the same kind (nor firm)
// - their signs of survival on the new layouts only
// Usage: node tools/officestest.js [seed]
import { createWorld } from "../src/sim/world.js";
import { LOCATIONS } from "../src/sim/data.js";
import { AREA_SETS, AREAS, CELL, boxLoot } from "../src/sim/combat.js";
import { SITES, BUILDINGS, STOREYS_BY_TYPE, MAX_STOREYS, assemble } from "../src/sim/buildingmaps.js";
import { FRANCHISES, PLACE_W } from "../src/sim/data-shops.js";
import { OFFICE_KINDS as KINDS, OFFICE_FIRMS, OFFICE_W, COUNTY_SEAT } from "../src/sim/data-offices.js";
import { SHOP, OFFICE_KINDS, settingOf, shopExtras, shopPlaces, civicPlaces, franchiseById } from "../src/sim/shops.js";
import { OFFICE_STYLES } from "../src/sim/officelayout.js";
import { FURNITURE_KINDS, itemKey } from "../src/sim/data-furniture.js";
import { GEAR, supValue } from "../src/sim/data.js";
import { rollScenes } from "../src/sim/interiorscenes.js";
import { Rng } from "../src/sim/rng.js";
import { hub, atBase } from "../src/sim/world.js";
import { launchExpedition } from "../src/sim/parties.js";
import * as CC from "../src/sim/citycrawl.js";
import { cellsOf, keyOf } from "../src/sim/citygrid.js";

const seed = Number(process.argv[2] || 42);
const QUICK = !!process.env.BS_QUICK;
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };
const section = (t) => console.log(`\n${t}`);
const KEYS = ["storefront", "bizpark", "offices", "cityhall", "courthouse", "callcenter", "techoffice", "station"];
const FIRM_OF = (key) => (key === "offices" ? "office" : key);
const NEW_PIECES = ["dentalchair", "turnstile", "liftdoor", "judgebench", "jurybox", "witnessstand", "dais", "podium", "headsetdesk", "beanbag", "camera", "studiolight", "newsdesk", "sorter", "plotter", "screener", "liquorcab", "phonebooth"];
const make = (key, s, o = {}) => {
  const fr = FRANCHISES[FIRM_OF(key)], rng = new Rng(7000 + s * 104729 + key.length * 31);
  const variant = o.variant === undefined ? fr[s % fr.length].id : o.variant;
  const spec = BUILDINGS[key].make(rng, { variant, kind: key === "offices" ? "office" : null, legacy: !!o.legacy, storeyBonus: o.bonus || 0 });
  return { spec, m: assemble(rng, spec, { key, name: key, legacy: !!o.legacy, noDecor: !!o.noDecor }) };
};
const grid = (m, f) => (m.floors ? m.floors[f].cells : m.cells);
const inner = (m, a) => { const out = []; for (let y = a.y0 + 1; y < a.y0 + a.h - 1; y++) for (let x = a.x0 + 1; x < a.x0 + a.w - 1; x++) out.push([x, y, grid(m, a.f || 0)[y * m.w + x]]); return out; };
const kinds = (m, a) => new Set(inner(m, a).map(([, , c]) => c.k));
const count = (m, a, k) => inner(m, a).filter(([, , c]) => c.k === k).length;
const walk = (m, f, sx, sy) => {
  const g = grid(m, f), seen = new Uint8Array(m.w * m.h), q = [sy * m.w + sx];
  seen[q[0]] = 1;
  while (q.length) { const i = q.pop(), x = i % m.w, y = (i / m.w) | 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= m.w || ny >= m.h) continue; const j = ny * m.w + nx; if (!seen[j] && (CELL[g[j].k].walk || g[j].k === "door")) { seen[j] = 1; q.push(j); } } }
  return seen;
};

// ---------- 1. the data ----------
section("The kinds, their firms and their pieces");
{
  for (const k of Object.keys(KINDS)) {
    check(!!LOCATIONS[k] && Array.isArray(AREA_SETS[k]) && AREA_SETS[k].every((a) => AREAS[a]), `${k}: a site type with its raid rooms`);
    check(!!SITES[k] && SITES[k].length === 1 && !!BUILDINGS[k] && !!STOREYS_BY_TYPE[k], `${k}: its building and its storeys`);
  }
  for (const [k, list] of Object.entries(OFFICE_FIRMS)) check(list.length >= 4 && list.length <= 10, `${k}: ${list.length} firms (4–10)`);
  const names = Object.values(OFFICE_FIRMS).flat().map((f) => f.name);
  check(new Set(names).size === names.length, `${names.length} firms, every name its own`);
  check(OFFICE_FIRMS.storefront.some((f) => f.plan.office === "dentist") && OFFICE_FIRMS.storefront.some((f) => f.plan.office === "doctor") && ["insurance", "law", "accounts", "realty", "travel"].every((o) => OFFICE_FIRMS.storefront.some((f) => f.plan.office === o)), "storefront firms of every kind: insurance, law, accounts, real estate, travel, a dentist, a doctor");
  check(["tv", "radio", "paper"].every((m) => OFFICE_FIRMS.station.some((f) => f.plan.media === m)), "stations: TV, radio and the paper");
  check(NEW_PIECES.every((k) => FURNITURE_KINDS[k]), `the ${NEW_PIECES.length} new pieces are in the catalogue`);
  check(NEW_PIECES.filter((k) => itemKey(k)).every((k) => GEAR[itemKey(k)]), "every liftable one has its item");
  check(OFFICE_KINDS.length === Object.keys(OFFICE_W).length && OFFICE_KINDS.every((k) => PLACE_W[k]), `the office kinds placed by their own rolls (${OFFICE_KINDS.join(", ")})`);
}

// ---------- 2. laid out for their kind ----------
section("Laid out for their kind");
const N = QUICK ? 8 : 24;
const errs = {}, seen = {};
const err = (k, msg) => { (errs[k] = errs[k] || []).push(msg); };
const saw = (k, n = 1) => { seen[k] = (seen[k] || 0) + n; };
let built = 0;
const floorKindsSeen = new Set();
for (const key of KEYS) for (let s = 0; s < N; s++) {
  const { spec, m } = make(key, s), tag = `${key} ${s}`, fr = FRANCHISES[FIRM_OF(key)][s % FRANCHISES[FIRM_OF(key)].length];
  built++;
  const R = m.rooms.filter((a) => !a.outdoor);
  const byName = (re) => R.filter((a) => re.test(a.name));
  const has = (re, k) => byName(re).some((a) => kinds(m, a).has(k));
  // Every floor one walk from the stairs (or the front door), every container reachable.
  const floors = m.floors ? m.floors.length : 1;
  for (let f = 0; f < floors; f++) {
    const g = grid(m, f);
    const start = f === 0 ? R.find((a) => a.f === 0 && a.entry) || R.find((a) => (a.f || 0) === 0) : null;
    const st = f > 0 ? (m.stairs || []).find(([x, y]) => g[y * m.w + x].k === "stairs") : null;
    const open = start ? inner(m, start).find(([, , c]) => CELL[c.k].walk) : null;
    const [sx, sy] = st || (open ? [open[0], open[1]] : [0, 0]);
    const w = walk(m, f, sx, sy);
    for (const a of R.filter((q) => (q.f || 0) === f)) {
      for (const [x, y, c] of inner(m, a)) if ((CELL[c.k].walk || c.k === "door") && c.k !== "void" && !w[y * m.w + x]) { err("walk", `${tag} f${f} ${a.name} ${x},${y}`); break; }
    }
    for (const c of m.containers.filter((q) => (q.f || 0) === f)) if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => w[(c.y + dy) * m.w + c.x + dx])) err("reach", `${tag} ${c.label}`);
  }
  if (key === "storefront") {
    const o = fr.plan.office;
    if (o === "dentist") { const ops = byName(/^Operatory/); if (!ops.length || !ops.every((a) => kinds(m, a).has("dentalchair"))) err("dentist", tag); else saw("operatories", ops.length); }
    else if (o === "doctor") { if (!byName(/^Exam room/).some((a) => kinds(m, a).has("exambed"))) err("doctor", tag); }
    else {
      if (byName(/office/i).filter((a) => a.role === "office" && kinds(m, a).has("desk")).length < 2) err("privoffices", tag);
      if (!has(/^File room/, "filing")) err("fileroom", tag);
    }
    if (!R.some((a) => a.entry && (kinds(m, a).has("counter") || kinds(m, a).has("chair")))) err("frontdesk", tag);
    if (!has(/^Kitchenette/, "fridge")) err("kitchenette", tag);
  }
  if (key === "bizpark") {
    for (const [re, k, e] of [[/^Lobby/, "counter", "glasslobby"], [/^Open-plan/, "desk", "openplan"], [/^Meeting/, "table", "meeting"], [/^Training/, "podium", "training"], [/^Mail room/, "sorter", "mailroom"], [/^Break room/, "fridge", "breakroom"], [/^IT closet/, "serverrack", "itcloset"]]) if (!has(re, k)) err(e, tag);
  }
  if (key === "offices") {
    const lobby = R.find((a) => a.f === 0 && a.entry);
    if (!lobby || !kinds(m, lobby).has("turnstile")) err("turnstiles", tag); else saw("turnstile", count(m, lobby, "turnstile"));
    if (!lobby || !kinds(m, lobby).has("liftdoor")) err("liftbank", tag);
    if (!byName(/^Lift lobby/).length || !byName(/^Lift lobby/).every((a) => kinds(m, a).has("liftdoor"))) err("liftlobbies", tag);
    if (!has(/^Loading bay/, "crate") && !has(/^Loading bay/, "palletrack")) err("loadingbay", tag);
    if (spec.storeys >= 6) {
      if ((m.runs || []).length !== 2) err("tworuns", `${tag}: ${(m.runs || []).length} runs`);
      for (let f = 0; f < spec.storeys - 1; f++) { const st = (m.runs || []).filter((r) => grid(m, f)[r.y * m.w + r.x].k === "stairs").length; if (st < 2) { err("tworuns", `${tag} floor ${f}: ${st}`); break; } }
      saw("tall");
    }
    const top = R.filter((a) => a.f === spec.storeys - 1);
    const suite = top.find((a) => /^Executive suite/.test(a.name));
    if (!suite || !kinds(m, suite).has("liquorcab") || !m.containers.some((c) => c.area === suite.id && c.kind === "safe" && c.lockKind === "safe")) err("execsuite", tag);
    if (!top.some((a) => /^Roof plant/.test(a.name))) err("roofplant", tag);
    for (const k of spec.floorKinds || []) floorKindsSeen.add(k);
    if (spec.storeys >= 6 && new Set((spec.floorKinds || []).slice(1, -1)).size < 2) err("floorsvary", tag);
    for (const k of ["boardroom", "canteen", "fitness", "serverroom"]) if (R.some((a) => a.office === k)) saw(`tower ${k}`);
  }
  if (key === "cityhall") {
    const ch = byName(/^Council chambers/)[0];
    if (!ch || !kinds(m, ch).has("dais") || !kinds(m, ch).has("podium") || count(m, ch, "chair") < 8) err("council", `${tag}: ${ch ? [...kinds(m, ch)].join("/") + " " + count(m, ch, "chair") : "none"}`);
    else { // the seats face the dais (north)
      const seats = inner(m, ch).filter(([, y, c]) => c.k === "chair" && y > ch.y0 + 4);
      if (!seats.every(([, , c]) => c.fc === "n")) err("councilfacing", tag); else saw("council seats", seats.length);
    }
    if (!has(/^Clerk's office/, "counter") || !has(/^Clerk's office/, "stanchion")) err("clerk", tag);
    if (!has(/^Mayor's office/, "desk")) err("mayor", tag);
    if (!has(/Records|Archives/, "filing")) err("records", tag);
  }
  if (key === "courthouse") {
    const cts = byName(/^Courtroom/);
    if (!cts.length || !cts.every((a) => ["judgebench", "jurybox", "witnessstand"].every((k) => kinds(m, a).has(k)) && (kinds(m, a).has("pew") || count(m, a, "chair") >= 6))) err("courtroom", `${tag}: ${cts.map((a) => [...kinds(m, a)].join("/")).join(" | ")}`);
    else saw("courtrooms", cts.length);
    if (!has(/^Holding cell/, "bars")) err("holdingcell", tag);
    const scr = R.find((a) => a.entry);
    if (!scr || !kinds(m, scr).has("screener") || !kinds(m, scr).has("scanner")) err("screening", tag);
    if (!has(/^Evidence room/, "evlocker")) err("evidence", tag);
    if (!has(/^Law library/, "bookshelf")) err("lawlibrary", tag);
  }
  if (key === "callcenter") {
    const hd = R.reduce((n, a) => n + count(m, a, "headsetdesk"), 0);
    if (hd < 8) err("headsetdesks", `${tag}: ${hd}`); else saw("headset desks", hd);
    if (!has(/^Break room/, "vending")) err("bigbreak", tag);
    if (!has(/^Main call floor/, "secdesk")) err("supervisors", tag);
  }
  if (key === "techoffice") {
    if (!has(/^Open-plan floor/, "desk")) err("benches", tag);
    if (!R.some((a) => kinds(m, a).has("beanbag"))) err("beanbags", tag);
    if (!has(/^Games corner/, "pooltable")) err("pooltable", tag);
    if (!has(/^Phone booths/, "phonebooth")) err("phonebooths", tag);
    if (!has(/^Server room/, "serverrack")) err("serverroom", tag);
    if (!byName(/^Kitchen/).some((a) => count(m, a, "fridge") >= 2)) err("drinks", tag);
  }
  if (key === "station") {
    const media = fr.plan.media;
    if (media === "tv" && !(has(/^Studio/, "camera") && has(/^Studio/, "newsdesk") && has(/^Studio/, "studiolight"))) err("tvstudio", tag);
    if (media === "radio" && !has(/^Broadcast booth/, "secdesk")) err("radiobooth", tag);
    if (media === "paper" && !has(/^Press room/, "machine")) err("press", tag);
    if (!has(/^Newsroom/, "desk")) err("newsroom", tag);
    if (!byName(/^(Control room|Layout room)/).length) err("control", tag);
  }
}
const LABEL = {
  walk: "every floor one walk", reach: "every container reachable", dentist: "a dentist's operatories each with a dental chair", doctor: "a doctor's exam rooms with exam beds",
  privoffices: "a front office's 2+ private offices", fileroom: "its file room", frontdesk: "a storefront's front desk and chairs", kitchenette: "its kitchenette",
  glasslobby: "a business park's lobby", openplan: "open plan", meeting: "a meeting room", training: "a training room with a podium", mailroom: "a mail room with a sorter", breakroom: "a break room", itcloset: "an IT closet",
  turnstiles: "a tower's lobby turnstiles", liftbank: "its lift bank", liftlobbies: "every floor's lift lobby", loadingbay: "its loading bay", tworuns: "two stair runs on every floor of a tower of 6+",
  execsuite: "the executive suite's safe and liquor cabinet", roofplant: "the roof plant", floorsvary: "a tall tower's floors vary",
  council: "city hall's council chambers: the dais, the podium, the seats", councilfacing: "the seats face the dais", clerk: "the clerk's counter and queue posts", mayor: "the mayor's office", records: "records",
  courtroom: "every courtroom: the bench, the jury box, the witness stand, the gallery", holdingcell: "the holding cell's bars", screening: "the screening entrance's walk-through scanner and X-ray tunnel", evidence: "the evidence room's lockers", lawlibrary: "the law library",
  headsetdesks: "a call center's headset desks", bigbreak: "its break room's vending machines", supervisors: "its supervisors' platform",
  benches: "a tech office's benches", beanbags: "beanbags", pooltable: "the games corner's pool table", phonebooths: "phone booths", serverroom: "a server room", drinks: "a kitchen of fridges",
  tvstudio: "a TV studio's cameras, news desk and lights", radiobooth: "a radio booth's console", press: "a paper's press", newsroom: "a newsroom", control: "a control room",
};
for (const [k, msg] of Object.entries(LABEL)) check(!errs[k], `${msg} (${built} buildings)${errs[k] ? `: ${errs[k].length} bad, e.g. ${errs[k].slice(0, 3).join("; ")}` : ""}`);
console.log(`  seen: ${Object.entries(seen).map(([k, n]) => `${k} ${n}`).join(", ")}; tower floors: ${[...floorKindsSeen].join(", ")}`);
check(["canteen", "fitness", "it", "exec", "open", "top"].every((k) => floorKindsSeen.has(k)), "the tower's floors: open plan, executive, canteen, fitness, IT, the top floor");
check(KEYS.every((k) => (seen.tall || 0) > 0 && OFFICE_STYLES), "towers of 6+ storeys built");
{
  const sig = (m) => (m.floors || [{ cells: m.cells }]).map((F) => F.cells.map((c) => c.k).join(",")).join("|");
  check(KEYS.every((k) => sig(make(k, 3).m) === sig(make(k, 3).m)), "the same building lays out the same every visit");
  check(KEYS.filter((k) => sig(make(k, 3).m) !== sig(make(k, 4).m)).length === KEYS.length, "two of a kind lay out differently");
  check(make("offices", 2).spec.storeys <= MAX_STOREYS && make("offices", 2, { bonus: 2 }).spec.storeys <= MAX_STOREYS, `a tower's storeys within MAX_STOREYS (${MAX_STOREYS})`);
}

// ---------- 3. loot per cell ----------
section("Loot per cell of floor against the old office tower");
{
  const value = (def) => { let v = 0; for (const [k, [p, lo, hi]] of Object.entries(def.loot)) v += Math.min(0.95, p) * ((lo + hi) / 2) * supValue(k); for (const [k, p] of def.gear) v += p * ((GEAR[k] && GEAR[k].value) || 0); return v; };
  const S = QUICK ? 40 : 200;
  const perCell = (key, o) => {
    let v = 0, cells = 0;
    for (let s = 0; s < S; s++) {
      const { spec, m } = make(key, s, o);
      for (const c of m.containers) { const a = m.rooms.find((r) => r.id === c.area); if (a && a.type) v += value(boxLoot(a.type, c.kind)); }
      cells += (spec.bw - 2) * (spec.bh - 2) * (spec.storeys || 1);
    }
    return v / cells;
  };
  const base = perCell("offices", { variant: null });
  const rows = [], off = [];
  for (const key of KEYS) { const v = perCell(key, {}), r = v / base - 1; rows.push(`${key} ${(r * 100).toFixed(0)}%`); if (Math.abs(r) > 0.1) off.push(`${key} ${v.toFixed(2)} against ${base.toFixed(2)}`); }
  console.log(`  the old tower: ${base.toFixed(2)} a cell; ${rows.join(", ")}`);
  check(!off.length, `every kind's loot per cell within ±10% of the old office tower's (${S} seeds each: ${off.join("; ") || rows.join(", ")})`);
}

// ---------- 4. an older save ----------
section("An older save, a tower without a firm");
{
  let newer = 0;
  for (let s = 0; s < 6; s++) for (const o of [{ legacy: true }, { variant: null }]) {
    const { m } = make("offices", s, { ...o, noDecor: true });
    for (const F of m.floors || [{ cells: m.cells }]) for (const c of F.cells) if (NEW_PIECES.includes(c.k)) newer++;
    if (m.rooms.some((a) => a.office)) newer++;
  }
  check(!newer, `an older save's tower, and a tower with no firm, keep the old plan (${newer} new pieces or styled rooms)`);
  const st = createWorld({ seed, factionCount: 3 });
  st.officesLegacy = true;
  const t = st.tiles.find((x) => settingOf(st, x) === "city");
  let any = 0;
  for (let k = 0; k < 200; k++) for (const p of shopExtras({ ...st, seed: 5000 + k }, { ...t, loc: null }, [], true, 4)) if (OFFICE_KINDS.includes(p.kind)) any++;
  check(!any && !civicPlaces(st, t.id, true, "city", () => true).length, "an older save gets none of the new places (POIs, city hall)");
}

// ---------- 5. where they stand: the rates ----------
section("Where they stand: as points of interest, in the crawls; 300 towns and cities");
{
  const st = createWorld({ seed, factionCount: 3 });
  const pick = { city: st.tiles.find((t) => settingOf(st, t) === "city"), suburb: st.tiles.find((t) => settingOf(st, t) === "suburb"), town: st.tiles.find((t) => settingOf(st, t) === "town") };
  const share = { city: {}, suburb: {}, town: {} }, tiles = 3000;
  for (const [set, t] of Object.entries(pick)) {
    if (!t) continue;
    for (let k = 0; k < tiles; k++) for (const p of shopExtras({ ...st, seed: 300000 + k }, { ...t, loc: null }, [], true, 4)) if (OFFICE_KINDS.includes(p.kind)) {
      share[set][p.kind] = (share[set][p.kind] || 0) + 1;
      const f = franchiseById(p.kind, p.v);
      if (!f || !(f.w[set] > 0)) share[set].wrongfirm = (share[set].wrongfirm || 0) + 1;
    }
  }
  const pct = (set, k) => (100 * (share[set][k] || 0)) / tiles;
  for (const set of ["city", "suburb", "town"]) console.log(`  a ${set} tile: an office building ${(OFFICE_KINDS.reduce((a, k) => a + pct(set, k), 0)).toFixed(1)}% (${OFFICE_KINDS.map((k) => `${k} ${pct(set, k).toFixed(1)}%`).join(", ")})`);
  check(pct("town", "storefront") > pct("city", "storefront") * 0.9 && pct("town", "storefront") > pct("town", "callcenter") * 5, "storefront offices most in the towns");
  check(pct("suburb", "bizpark") > pct("city", "bizpark") && pct("suburb", "bizpark") > pct("town", "bizpark") * 3, "business parks in the suburbs");
  check(pct("city", "techoffice") > pct("town", "techoffice") * 5 && pct("city", "callcenter") + pct("suburb", "callcenter") > pct("town", "callcenter") * 5, "tech offices and call centers in the cities and suburbs");
  check(pct("town", "station") > pct("city", "station") * 2, "TV and radio stations and the paper in the towns");
  check(["city", "suburb", "town"].every((s) => !share[s].wrongfirm), "every office POI a firm that stands in its setting");
  // 300 seeded towns and cities: city hall in every one, the courthouse in every city and a county seat.
  let halls = 0, courts = 0, cityCourts = 0;
  for (let k = 0; k < 300; k++) {
    const s2 = { ...st, seed: 9000 + k }, town = k % 3 !== 0;
    const civ = civicPlaces(s2, 100 + k, true, town ? "town" : "city", () => true);
    if (civ.includes("cityhall")) halls++;
    if (civ.includes("courthouse")) { if (town) courts++; else cityCourts++; }
    if (civicPlaces(s2, 100 + k, false, town ? "town" : "city", () => true).length) halls = -1e9;
  }
  console.log(`  300 towns and cities: city hall in ${halls}, a courthouse in ${cityCourts} of 100 cities and ${courts} of 200 towns (${(courts / 2).toFixed(0)}%, county seats ${COUNTY_SEAT * 100}%)`);
  check(halls === 300 && cityCourts === 100 && Math.abs(courts / 200 - COUNTY_SEAT) < 0.1, "city hall in every town and city (on its civic block only), the courthouse in every city and in the county seats");
  // The crawl: a city's and a town's blocks; the office places, never two of a kind on a block, the civic block's.
  const W = createWorld({ seed: seed + 5, factionCount: 3 }), h = hub(W);
  const crawl = { city: {}, town: {} };
  let blocks = { city: 0, town: 0 }, twice = 0, over = 0, civicSeen = { city: 0, town: 0 }, sameFirm = 0, pairs = 0;
  const crawls = { city: 0, town: 0 };
  for (const type of ["town", "city"]) for (const tile of W.tiles.filter((t) => t.loc && t.loc.type === type && t.id !== h.tile).slice(0, 2)) { // two crews of two: the hub's people
    const res = launchExpedition(W, { memberIds: atBase(W, h.id).slice(0, 2).map((x) => x.id), dest: tile.id, mission: "scavenge", stance: "normal", vehicleId: null, supplies: { food: 2, water: 2 } });
    if (res.error) continue;
    const p = res.party;
    p.path = [tile.id]; p.idx = 0; p.dest = tile.id; p.phase = "engaged";
    CC.startCrawl(W, p);
    crawls[type]++;
    const c = p.crawl, offices = [];
    for (const [x, y] of cellsOf(c.grid)) {
      const blk = CC.genBlock(W, c, keyOf(x, y));
      blocks[type]++;
      const keys = blk.places.map((pl) => pl.key);
      if (new Set(keys).size !== keys.length) twice++;
      if (blk.places.length > CC.CRAWL.PLACES[1]) over++;
      for (const pl of blk.places) {
        if (pl.key === "cityhall") civicSeen[type]++;
        if (OFFICE_KINDS.includes(pl.key) || pl.key === "offices") { crawl[type][pl.key] = (crawl[type][pl.key] || 0) + 1; offices.push(pl); }
      }
    }
    for (let i = 0; i < offices.length; i++) for (let j = i + 1; j < offices.length; j++) { pairs++; if (offices[i].key === offices[j].key && offices[i].v && offices[i].v === offices[j].v) sameFirm++; }
    c.blocks = {};
  }
  for (const type of ["city", "town"]) console.log(`  ${type} crawls (${crawls[type]}, ${blocks[type]} blocks): ${Object.entries(crawl[type]).map(([k, n]) => `${k} ${n}`).join(", ")}; city hall ${civicSeen[type]}`);
  check(!twice && !over, `never two of a kind on a block, never past its most (${twice}, ${over})`);
  check(crawls.city > 0 && crawls.town > 0 && civicSeen.city === crawls.city && civicSeen.town === crawls.town, "city hall stands once in each crawl, on its civic block");
  console.log(`  two office buildings in one crawl the same kind and firm: ${sameFirm} of ${pairs} pairs (${pairs ? ((100 * sameFirm) / pairs).toFixed(1) : 0}%)`);
  check(pairs > 20 && sameFirm / pairs < 0.1, "two office buildings in a crawl are rarely the same kind and firm");
  // The crawl's office roll on its own dice: the shops' places as they were.
  const t0 = W.tiles.find((t) => t.loc && t.loc.type === "city");
  let same = 0, n = 0;
  for (let j = 0; j < 200; j++) {
    const cell = `${j % 9},${Math.floor(j / 9) % 9}`, has = (k) => !!BUILDINGS[k];
    const a = shopPlaces(W, t0.id, cell, [], 4, 3, "city", has);
    const saved = SHOP.CRAWL.office; SHOP.CRAWL.office = undefined;
    const b = shopPlaces(W, t0.id, cell, [], 4, 3, "city", has);
    SHOP.CRAWL.office = saved;
    n++; if (JSON.stringify(a.filter((k) => !OFFICE_KINDS.includes(k))) === JSON.stringify(b)) same++;
  }
  check(same === n, `the shops' crawl rolls are as they were with the office roll on its own dice (${same} of ${n})`);
}

// ---------- 6. signs of survival ----------
section("Their signs of survival, on the new layouts only");
{
  const SC = { offices: "officehold", bizpark: "officehold", courthouse: "heldcell", cityhall: "councilshelter", station: "lastbroadcast" };
  const got = {}, old = {};
  for (const [key, kind] of Object.entries(SC)) for (let s = 0; s < (QUICK ? 30 : 60); s++) {
    const fr = FRANCHISES[FIRM_OF(key)];
    const mk = key === "station" ? { variant: fr[s % 2].id } : {};
    const S = rollScenes(make(key, s, mk).m, new Rng(900 + s), key);
    if (S && S.list.some((x) => x.kind === kind)) got[key] = (got[key] || 0) + 1;
    if (key === "offices") { const L = rollScenes(make(key, s, { legacy: true }).m, new Rng(900 + s), key); if (L && L.list.some((x) => x.kind === kind)) old[key] = (old[key] || 0) + 1; }
  }
  check(Object.keys(SC).every((k) => got[k] > 0) && !Object.keys(old).length, `the scenes turn up on the new layouts, none on an older save's (${Object.entries(SC).map(([k, v]) => `${k} ${v} ${got[k] || 0}`).join(", ")})`);
}

console.log(`\n${passes} passed, ${fails} failed.`);
process.exit(fails ? 1 : 0);
