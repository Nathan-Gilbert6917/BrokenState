// The AI groups' bases as base objects (docs/adr/0001-ai-parity.md): f.homes[tile] for every tile in f.bases,
// { id, tile, fid, name, type: "hub" (the main base) | "outpost", camp, stock, armory, buildings, construction }, in the
// shape of yours (world.js the hub, jobs.js an outpost).
//   - stock: the main base's is f.stock itself (the same object: everything that reads a group's stores reads its main
//     base's). An outpost's is its own. Each day the outposts' stores come in to the main base before the day's work
//     (gatherStores: every daily system works on f.stock) and go out again after it (spreadStores), each outpost the
//     share of the group's goods its people are of the group (members.js placeMembers): a supply run each way, as a
//     player could run them (round 2 Q4). Between days what is at a base is what is there: a raid, an assault or a
//     horde takes it from that base (stockAt), never from the others.
//   - armory: what the group owns and nobody carries is kept at the main base (loadouts.js spareKit); its people carry
//     their own kit wherever they live. An outpost's armory list stays empty.
//   - buildings: real buildings (buildings.js addBuilding) for what the group has built there (groupworks.js works,
//     WORKS_BUILDING), kept in step every day and as a job of theirs finishes. A group that does not build (the hardcore
//     military) has a built-up base's (BUILT_UP).
// Losing a base (loseBase): the base object goes with the tile (its stores to whoever takes it, or left there); losing
// the main base, the next base becomes the main one and f.stock its stores.
import { BUILDINGS, addBuilding } from "./buildings.js";
import { peekNextId, setNextId } from "./world.js";
import { tileLabel } from "./parties.js";
import { hospitalTypes } from "./medical.js";
import { groupsBuild } from "./groupworks.js";
import { membersAt, homeMembers, MEMBER } from "./members.js";
import { weightOf } from "./groupcare.js";
import { SUPPLIES } from "./data.js";
import { BED_WORKS_BUILDING } from "./data-beds.js"; // beds as furniture: their hall a Lodge, each piece itself (beds.js)

// A works count of theirs as your building (groupworld.js PLAYER_WORKS the other way round). The storage works
// (groupworks.js storageWork: a storage box, crates, a shed, the storehouse, a warehouse) are your storage buildings, so
// basestorage.js storageOf counts their room at that base.
export const WORKS_BUILDING = { ...BED_WORKS_BUILDING, walls: "walls", farms: "farm_plot", pens: "animal_pen", water: "well", beds: "bunkhouse", bench: "workbench", shop: "machine_shop", reload: "reload_bench", store: "storehouse", storebox: "storebox", crates: "crates", shed: "shed", warehouse: "warehouse", radio: "radio", garage: "garage", gate: "gate", kitchen: "kitchen", still: "still", freezer: "freezer" };
// What a base that is not built up by hand holds (the hardcore military: groupworks.js groupsBuild false); its storehouse
// (2000 kg on top of the main house's 1200: basestorage.js) keeps an army base's stores in.
export const BUILT_UP = { walls: 6, farms: 2, water: 1, beds: 2, bench: 1, store: 1, gate: 1 };

const nextId = (state) => (state.memberSeq = Math.max(state.memberSeq || MEMBER.ID0, MEMBER.ID0) + 1);
function newHome(state, f, tile, main) {
  return { id: nextId(state), tile, fid: f.id, name: `${f.name} at ${tileLabel(state, tile)}`, type: main ? "hub" : "outpost", group: true, stock: main ? f.stock : {}, armory: [], buildings: [], construction: [] };
}
// The group's base objects, made and kept in step with f.bases (the main base's stock is f.stock).
export function homesOf(state, f) {
  if (!f || !Array.isArray(f.bases)) return {};
  const H = f.homes || (f.homes = {});
  f.bases.forEach((tile, i) => {
    let h = H[tile];
    if (!h) h = H[tile] = newHome(state, f, tile, i === 0);
    h.type = i === 0 ? "hub" : "outpost";
    if (!h.real) h.camp = !!(f.works && f.works[tile] && f.works[tile].camp); // a base of yours they took keeps its own (a camp of yours: buildings.js isCamp)
    if (i === 0 && h.stock !== f.stock) {
      // The main base changed (a flight, a base moved to the front): f.stock (always the same object) is its stores now,
      // with what was kept there added.
      if (!f.stock) f.stock = {};
      for (const [k, q] of goods(h.stock)) f.stock[k] = (f.stock[k] || 0) + q;
      h.stock = f.stock;
    } else if (i > 0 && h.stock === f.stock) h.stock = {}; // a former main base moved down the list
  });
  // A base no longer theirs that no code took away by loseBase: its stores were carried home.
  for (const t of Object.keys(H)) {
    if (f.bases.includes(Number(t))) continue;
    const h = H[t];
    if (h.stock !== f.stock) for (const [k, q] of Object.entries(h.stock)) if (typeof q === "number" && q > 0) f.stock[k] = (f.stock[k] || 0) + q;
    delete H[t];
  }
  return H;
}
export const homeAt = (state, f, tile) => (f && f.bases && f.bases.includes(tile) ? homesOf(state, f)[tile] : null);
// The stores at one of their bases (the main base's: f.stock).
export const stockAt = (state, f, tile) => { const h = homeAt(state, f, tile); return h ? h.stock : f.stock; };

// ---------- the daily supply runs ----------
const goods = (st) => Object.entries(st).filter(([, q]) => typeof q === "number" && q > 0);
export function gatherStores(state, f) {
  const H = homesOf(state, f);
  for (const t of f.bases.slice(1)) {
    const h = H[t];
    if (!h) continue;
    for (const [k, q] of goods(h.stock)) { f.stock[k] = (f.stock[k] || 0) + q; h.stock[k] = 0; }
  }
}
// The supply run out (spreadStores): what each outpost takes from `stock` (the main base's), its people's share of every
// supply and rounds key, from what is left at the main base as the run goes round. Pure: { [tile]: { key: n } }.
function spreadPlan(state, f, stock) {
  /** @type {Record<number, Record<string, number>>} */
  const plan = {};
  const H = homesOf(state, f);
  if (f.bases.length < 2) return plan;
  const all = Math.max(1, homeMembers(f).length);
  const left = { ...stock };
  for (const t of f.bases.slice(1)) {
    if (!H[t]) continue;
    const share = membersAt(f, t).length / all;
    if (!(share > 0)) continue;
    const take = (plan[t] = {});
    for (const [k, q] of goods(left)) {
      if (!SUPPLIES[k] && !k.includes(":")) continue; // supplies and rounds by key; a counter (jars) stays at home
      const n = Math.floor(q * share);
      if (n > 0) { left[k] -= n; take[k] = n; }
    }
  }
  return plan;
}
export function spreadStores(state, f) {
  const H = homesOf(state, f);
  if (f.bases.length < 2) return;
  const plan = spreadPlan(state, f, f.stock);
  for (const t of f.bases.slice(1)) {
    const take = plan[t];
    if (!take) continue;
    for (const [k, n] of Object.entries(take)) { f.stock[k] -= n; H[t].stock[k] = (H[t].stock[k] || 0) + n; }
  }
}
// What each base will hold tonight, after the supply run out (spreadStores), read while the stores are gathered at the
// main base for the day's work (groupworks.js nextWork: the storage a base wants). Pure: { [tile]: stock }.
export function stockTonight(state, f) {
  const H = homesOf(state, f);
  /** @type {Record<number, Record<string, number>>} */
  const out = {};
  if (!f.bases.length) return out;
  const plan = spreadPlan(state, f, f.stock);
  const main = { ...f.stock };
  for (const t of f.bases.slice(1)) {
    const st = { ...((H[t] && H[t].stock) || {}) };
    for (const [k, n] of Object.entries(plan[t] || {})) { main[k] -= n; st[k] = (st[k] || 0) + n; }
    out[t] = st;
  }
  out[f.bases[0]] = main;
  return out;
}

// ---------- buildings ----------
// The buildings the group's works at a base stand for ({ type: count }; a base that is not built up by hand: BUILT_UP).
export function worksBuildings(state, f, tile) {
  const w = groupsBuild(state, f) ? (f.works && f.works[tile]) || {} : { ...BUILT_UP, sickbay: weightOf(f, "sickbayBuilt", 2) };
  const out = {};
  for (const [k, type] of Object.entries(WORKS_BUILDING)) if (BUILDINGS[type] && (w[k] || 0) > 0) out[type] = (out[type] || 0) + Math.round(w[k]);
  const tier = Math.round(w.sickbay || 0);
  if (tier > 0) { const types = hospitalTypes(); const k = types[Math.min(tier, types.length) - 1]; if (k) out[k] = 1; }
  return out;
}
// The buildings at each base made to match what the group has built there (a building of yours: addBuilding).
export function syncBuildings(state, f) {
  const H = homesOf(state, f);
  for (const tile of f.bases) {
    const h = H[tile];
    if (h.real) continue; // a base of yours they hold: its buildings are what you built
    const goal = worksBuildings(state, f, tile);
    const have = {};
    for (const b of h.buildings) have[b.type] = (have[b.type] || 0) + 1;
    for (const [type, n] of Object.entries(goal)) for (let i = have[type] || 0; i < n; i++) {
      const keep = peekNextId();
      const b = addBuilding(h, type);
      setNextId(keep);
      b.id = nextId(state);
    }
    // Pulled down, burnt or given up: what is no longer theirs there goes (the newest first).
    for (const [type, n] of Object.entries(have)) {
      let extra = n - (goal[type] || 0);
      for (let i = h.buildings.length - 1; extra > 0 && i >= 0; i--) if (h.buildings[i].type === type) { h.buildings.splice(i, 1); extra--; }
    }
  }
}

// ---------- a base lost ----------
// The group gives up or loses `tile`: the base object leaves its list. Returns it (its stores, its buildings) for
// whoever takes the place, or null. A lost main base takes the group's main stores with it: the next base becomes the
// main one (its own stores the group's now).
export function loseBase(state, f, tile) {
  const H = homesOf(state, f);
  const h = H[tile] || null;
  f.bases = f.bases.filter((t) => t !== tile);
  delete H[tile];
  if (h && h.stock === f.stock) {
    // The main base: its stores fall with it (h keeps them, as they were); f.stock, the same object, is emptied and
    // becomes the next base's stores (the new main base).
    h.stock = { ...f.stock };
    for (const k of Object.keys(f.stock)) if (typeof f.stock[k] === "number") f.stock[k] = 0;
    const next = f.bases.length ? H[f.bases[0]] : null;
    if (next) { for (const [k, q] of goods(next.stock)) f.stock[k] = (f.stock[k] || 0) + q; next.stock = f.stock; next.type = "hub"; }
  }
  return h;
}
// A base comes to the group (an expansion, a capture, a peace): its base object, with stores brought along.
export function gainBase(state, f, tile, stock = null, obj = null) {
  if (!f.bases.includes(tile)) f.bases.push(tile);
  if (obj) { const H = f.homes || (f.homes = {}); obj.fid = f.id; obj.group = true; obj.real = true; H[tile] = obj; } // a base of yours, taken: its own buildings (never rebuilt from works)
  const h = homesOf(state, f)[tile];
  if (stock) for (const [k, q] of goods(stock)) h.stock[k] = (h.stock[k] || 0) + q;
  return h;
}
