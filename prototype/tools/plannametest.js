// One field for every plan's id and name (issue #40 of the round-2 epic #39; the user's request 2026-10-26: "Uniform
// plans to store plan names"). For every BUILDINGS key over SEEDS seeds and the three settings (rural, town, city):
//   - a spec with a named plan carries spec.vid (a string id) and spec.vname (its name), and planId / planName
//     (buildingmaps.js, planname.js) read exactly them; one id has one name within its type;
//   - the assembled map carries them as map.vid / map.vname and map.plan.vid / map.plan.vname (a compound's too: a
//     mall's variant, a prison's or a campus's site layout), and buildingPlan (what the readers ask without building
//     the map) gives the map's plan, or null for a mall, a prison, a jail, a campus, a farm, a ranch or a stadium (only their map knows it);
//   - buildingOptions shows a site's buildings by their plan's name (option.vname, option.vid; its name says it);
//   - a POI with its plan pinned (poi.lay: #32's layouts; poi.hv: #38's hotels) is named by it and its building is it;
//   - an older save (roomsLegacy) is unchanged: its buildings' cells and rooms hash as they did before #40 (GOLDEN,
//     taken on origin/dev 016f555 with `node tools/plannametest.js --golden`).
// Usage: node tools/plannametest.js [seeds per setting, default 24; BS_QUICK=1: 8] [--golden]
import { createWorld } from "../src/sim/world.js";
import { BUILDINGS, buildingMap, buildingSpec, buildingOptions, buildingPlan, planId, planName } from "../src/sim/buildingmaps.js";
import { poisOf, poiName } from "../src/sim/pois.js";
import { poiPlace } from "../src/sim/poiraid.js";
import { layoutName } from "../src/sim/buildvariants.js";
import { hotelVariantName } from "../src/sim/data-hotels.js";
import { SETTINGS as CANON, settingAt, whereOf } from "../src/sim/settings.js";
import { hash01 } from "../src/sim/skills.js";

const GOLDEN_MODE = process.argv.includes("--golden");
const SEEDS = Number(process.argv.slice(2).find((a) => /^\d+$/.test(a))) || (process.env.BS_QUICK ? 8 : 24);
const SETTINGS = ["rural", "town", "city"];
const MAPS = 2; // maps built a setting (the rest of the seeds: specs only)
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) passes++; else { fails++; console.log(`  FAIL: ${msg}`); } return ok; };

const state = createWorld({ seed: 4242, factionCount: 4 });
state.roomsLegacy = false;
const tileId = Object.values(state.tiles).find((t) => t.terrain === "plains" && !t.loc).id;
const named = (spec) => !!(spec && (spec.vid != null || spec.vname || spec.variant || spec.variantId || (spec.layout && typeof spec.layout === "object")));

// ---------- an older save, unchanged ----------
// A hash of a map's cells (kind and floor) and rooms (name and rectangle): what a player in an older save walks.
const mapHash = (m) => {
  let h = 0;
  const mix = (s) => { h = Math.floor(hash01(h, s) * 2 ** 31); };
  const grids = m.floors ? m.floors.map((f) => f.cells) : [m.cells];
  for (const g of grids) for (let i = 0; i < g.length; i += 7) mix(`${g[i].k}${g[i].f || ""}`);
  for (const r of m.rooms) mix(`${r.name}${r.x0},${r.y0},${r.w},${r.h},${r.f || 0}`);
  return h.toString(36);
};
const old = { ...state, roomsLegacy: true };
const legacyHash = (key) => {
  const out = [];
  for (let s = 0; s < 2; s++) {
    try { out.push(mapHash(buildingMap(old, tileId, { id: `pnold${s}`, key, name: BUILDINGS[key].name, setting: "town" }, null))); } catch (e) { out.push("err"); }
  }
  return out.join(".");
};
if (GOLDEN_MODE) {
  const g = {};
  for (const key of Object.keys(BUILDINGS)) g[key] = legacyHash(key);
  console.log(JSON.stringify(g));
  process.exit(0);
}
// Taken on origin/dev 016f555 (before #40): `node tools/plannametest.js --golden`.
const GOLDEN = {
  house: "t7fmm4.zs92h", farmhouse: "rke16l.si50ex", cabin: "8o2xr6.1zgwnf", lodge: "lvdsmd.sglgl8",
  ranger: "ax2xe7.tje23s", grocery: "ic9fvw.1kyhwb", corner: "5pdxrm.namlhe", pharmacy: "3hfl8z.bghzq5",
  gunstore: "8aexz9.adkebh", pawnshop: "r46boj.ybbla4", sportshop: "iudpda.5cxuh5", electronics: "pfhegg.ao0m85",
  radioshop: "x6k8md.jx89z9", bookstore: "mdghjy.m9guv6", petstore: "faio24.7k185r", garden: "czpeuk.erjvr4",
  clothing: "xkt9iu.uh6at3", liquor: "aqrhmj.ttblq2", restaurant: "nb0rav.xrkwf5", pizza: "5cirqb.k1wxv8",
  bar: "ama0ev.upf0b8", dealer: "ibprfj.oqu3s2", bank: "yem1ec.edwdu0", library: "ol9og4.69m3th",
  vet: "kjvf2b.vrua7w", hardware: "19pxir.p16pdg", feedstore: "ymiba.e65eeo", diner: "5cirqb.k1wxv8",
  gasstation: "we8cqp.okolom", truckstop: "sek2ad.jum61u", supermarket: "dpu5y7.kb0jc5", deptstore: "bdw70s.c6ve6l",
  clinic: "2ps33g.1mhuym", infirmary: "ees7w7.yiu5nt", hospital: "ujs0cg.yewn4j", police: "5cp4m9.xzu7j0",
  school: "m8imm.3slc1q", offices: "720m7k.5r8ez8", lab: "qvy7dz.jos18z", barracks: "qwl7oj.o2udid",
  armorybldg: "23i56i.ji1nqd", cellblock: "mqf8l3.iydfc5", messhall: "wbyj33.eujbqv", control: "rpnwwi.1cwo6t",
  radio: "2oxnmm.dm08wt", terminal: "caiw54.b4i0bg", firestation: "43rs5x.exg21j", hq: "tzxy62.nedb6c",
  aidstation: "nu99av.nh7yhb", gatehouse: "fhq2ki.pddix0", tower: "puqohh.kj0xek", flightops: "m7t1j9.6g6r3",
  warehouse: "nvvbog.ka0vs5", factory: "we63nu.voe1ga", hangar: "h4fhln.p698rc", motorpool: "an7evh.7x0wri",
  autoshop: "2gj4yr.zchxoh", garage: "hmjlu9.lqgw97", workshop: "f0d0fs.n05gci", machineshed: "kwi5le.rxjy22",
  barn: "vzlzoa.z9w6iq", church: "sod8jz.m987qq", motel: "u8chh1.vq6r5p", apartments: "3li2af.w89k5q",
  hotel: "8kubcg.gv687h", storefront: "3yhj5e.vg9lqz", bizpark: "59zwei.3ph4r1", cityhall: "qtiy83.6cdm7c",
  courthouse: "67qaym.vi948h", callcenter: "66bn0a.rbd9z1", techoffice: "sl21n9.d6hkwj", station: "czr43g.wuj6pj",
  neighbourhood: "fe06p8.vr2fri", prison: "d4zcv4.r0zc7t", jail: "rszou3.de2216", campus: "qmd1a2.mtvvug",
  dorm: "8rtws5.b5g76v", lecturehall: "9v39x9.kjesbe", sciencehall: "t6m0xn.shtrbf", univlibrary: "2cw74c.l0jk24",
  studentunion: "gsmjz5.17qh37", dininghall: "yc6h7h.wdvgd4", athletics: "pxeny6.2vooz1", admin: "3r69mb.8940kf",
  security: "vl2xus.j740ff", maintenance: "rot6ab.hbmex6", theatre: "jvc0vm.85r2t1", parkgarage: "3thkpm.5uhgs",
  chapel: "sod8jz.m987qq", healthcentre: "2ps33g.1mhuym", milbunker: "nyawtc.af1chb",
  mountainbunker: "nv1cg2.twqldz", govbunker: "rrmjr6.xvw2l1", shelter: "b8hpej.x7xxhr", prepper: "s64ew2.y9ewyj",
  regionalmall: "oi0i0e.9jy7uk", stripmall: "d84s7v.ihjhex", outlet: "yjmtk6.9xi056", cinema: "bjwb7c.sk046q",
  arcade: "4fx8nr.y9hjfs", mallservices: "bs9jxr.dewn7z", mallrestrooms: "1ipqw3.h4grrs",
  vacantunit: "35skdb.ugnhfp",
  // The types added after #40 (#49, #51, #52, #53, #54, #55, #59, #60, #62), taken on dev 2026-10-26 (issue #72) with --golden;
  // the ones above unchanged.
  museum: "ke8s5b.pz59ra", furnstore: "wssqkg.nxwpsq", laundromat: "mo1wwg.wq8gck", thrift: "ywi6w1.1rwe60", bakery: "20n5w4.8fd645",
  butcher: "3n9nu1.949674", deli: "ucjk23.45xld2", radiotower: "28y5ut.mslivu", datacenter: "3g8k4u.50550s", amusement: "7qyzj9.ru5nqy",
  sawmill: "we63nu.voe1ga", mine: "8o2xr6.1zgwnf", quarry: "f0d0fs.n05gci", zoo: "7usmeq.iqdnyh",
  shed: "1k3a9.gzr8t8", farmstand: "nxejvs.k902he", farmbldg: "v4t9tu.8hd4q", farm: "wofdf1.qkaa4n", ranch: "i3oa7h.j50fwa",
  stadium: "6xdfuq.no2qt1", // issue #57, taken on its branch with --golden (2026-10-26)
};

// ---------- every type ----------
const rows = [];
for (const key of Object.keys(BUILDINGS)) {
  const errs = [], names = new Map();
  let plans = 0, specs = 0, maps = 0;
  for (const setting of SETTINGS) for (let s = 0; s < SEEDS; s++) {
    const opt = { id: `pn${setting}${s}`, key, name: BUILDINGS[key].name, setting };
    let spec;
    try { spec = buildingSpec(state, tileId, opt); } catch (e) { errs.push(`${opt.id}: ${e.message}`); continue; }
    specs++;
    const bad = (msg) => errs.push(`${opt.id}: ${msg}`);
    if (named(spec) && !BUILDINGS[key].compound) {
      plans++;
      if (typeof spec.vid !== "string" || !spec.vid) bad(`no spec.vid (${planName(spec)})`);
      if (typeof spec.vname !== "string" || !spec.vname) bad(`no spec.vname (${planId(spec)})`);
      if (planId(spec) !== spec.vid || planName(spec) !== spec.vname) bad("planId / planName do not read spec.vid / spec.vname");
      if (names.has(spec.vid) && names.get(spec.vid) !== spec.vname) bad(`id ${spec.vid} named "${names.get(spec.vid)}" and "${spec.vname}"`);
      names.set(spec.vid, spec.vname);
    }
    if (s >= MAPS) continue;
    let m;
    try { m = buildingMap(state, tileId, opt, null); } catch (e) { bad(`map: ${e.message}`); continue; }
    maps++;
    const B = BUILDINGS[key], whole = B.compound || B.complex || B.campus || B.farmstead || B.venue, P = buildingPlan(state, tileId, opt); // venue: a stadium (issue #57), its venue drawn among its map's dice as a mall's
    if (whole && P) bad(`buildingPlan names a ${key}'s plan (${P.vid}) without its map`);
    if (m.plan.vid != null && (m.vid !== m.plan.vid || m.vname !== m.plan.vname || !m.vname)) bad(`map carries ${m.vid}/${m.vname}, plan ${m.plan.vid}/${m.plan.vname}`);
    if (!whole && ((P && P.vid) || null) !== (m.vid || null)) bad(`buildingPlan says ${P && P.vid}, the map is ${m.vid}`);
    if (!whole && P && P.vname !== m.vname) bad(`buildingPlan names ${P.vname}, the map ${m.vname}`);
    if (whole && m.vid == null) bad("a whole-site map with no plan id");
  }
  rows.push({ key, plans, specs, ids: names.size, maps });
  check(!errs.length, `${key}: ${errs.length} problems (${errs.slice(0, 3).join("; ")})`);
}

console.log(`\nPlans by type (${SEEDS} seeds a setting, ${SETTINGS.join("/")}; specs with a named plan / specs, distinct ids):`);
for (const r of rows) if (r.plans) console.log(`  ${r.key.padEnd(15)} ${String(r.plans).padStart(3)}/${r.specs}  ${String(r.ids).padStart(3)} ids`);
console.log(`  no named plan: ${rows.filter((r) => !r.plans).map((r) => r.key).join(", ")}`);
check(rows.filter((r) => r.plans).length >= 40, `${rows.filter((r) => r.plans).length} types with named plans (want the epic's 40+)`);

// ---------- buildingOptions: a site's buildings by their plan's name ----------
{
  let sites = 0, shown = 0, wrong = 0;
  const bad = [];
  for (const t of Object.values(state.tiles)) {
    if (!t.loc || sites >= 60) continue;
    const opts = buildingOptions(t, state);
    if (!opts) continue;
    sites++;
    for (const o of opts) {
      if (o.id === "street" || BUILDINGS[o.key].compound) continue;
      const P = buildingPlan(state, t.id, o), n = P && P.vname;
      if (!n) continue;
      shown++;
      if (o.vname !== n || o.vid !== P.vid || !o.name.toLowerCase().includes(n.toLowerCase())) { wrong++; if (bad.length < 3) bad.push(`${t.loc.type} ${o.key}: "${o.name}" for ${n}`); }
    }
  }
  check(sites > 0 && shown > 0, `buildingOptions: ${sites} sites, ${shown} options with a named plan`);
  check(!wrong, `buildingOptions: ${wrong} options not shown by their plan's name (${bad.join("; ")})`);
  console.log(`\nbuildingOptions: ${shown} options with a named plan at ${sites} sites`);
}

// ---------- a POI with its plan pinned is named by it ----------
{
  let lay = 0, hv = 0, wrong = 0;
  const bad = [];
  for (const t of Object.values(state.tiles)) {
    const ps = poisOf(t);
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!p || p.site || (!p.lay && !p.hv)) continue;
      const place = poiPlace(t, i);
      if (!place) continue;
      const P = buildingPlan(state, t.id, place), n = P && P.vname;
      if (p.lay) { lay++; if (!P || P.vid !== p.lay || (!p.v && poiName(t, i) !== layoutName(place.key, p.lay)) || (!p.v && poiName(t, i) !== n)) { wrong++; if (bad.length < 3) bad.push(`${p.kind} ${p.lay}: "${poiName(t, i)}", plan ${P && P.vid} ${n}`); } }
      else { hv++; if (!n || n !== hotelVariantName(p.hv) || !poiName(t, i).includes(n)) { wrong++; if (bad.length < 3) bad.push(`${p.kind} ${p.hv}: "${poiName(t, i)}", plan ${n}`); } }
    }
  }
  check(lay > 0, "no POI has a layout");
  check(!wrong, `${wrong} POIs not named by their plan, or built as another (${bad.join("; ")})`);
  console.log(`POIs with their plan pinned: ${lay} layouts, ${hv} hotels`);
}

// ---------- the setting vocabulary (settings.js) ----------
{
  const seen = new Set();
  for (const t of Object.values(state.tiles)) seen.add(settingAt(state, t));
  check([...seen].every((s) => CANON.includes(s)), `settingAt gives only ${CANON.join(", ")} (got ${[...seen].join(", ")})`);
  for (const s of ["centre", "city", "suburb", "town", "rural"]) check(seen.has(s), `a world has ${s} tiles`);
  const site = Object.values(state.tiles).find((t) => t.loc && t.loc.type === "military");
  if (site) check(whereOf(state, site).site === "military", "whereOf gives a site's type apart from its setting");
  console.log(`Settings in the world: ${[...seen].join(", ")}`);
}

// ---------- an older save, unchanged ----------
{
  const diff = [];
  for (const key of Object.keys(BUILDINGS)) { const h = legacyHash(key); if (GOLDEN[key] !== undefined && GOLDEN[key] !== h) diff.push(key); }
  check(Object.keys(GOLDEN).length >= Object.keys(BUILDINGS).length - 5, `the older save's golden hashes cover ${Object.keys(GOLDEN).length} types (none for ${Object.keys(BUILDINGS).filter((k) => GOLDEN[k] === undefined).join(", ")}: add them from --golden)`);
  check(!diff.length, `an older save's buildings changed: ${diff.join(", ")}`);
}

console.log(`\n${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
