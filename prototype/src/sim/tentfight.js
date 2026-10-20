// @ts-check
// Tents taken down and slashed in a fight (the user's request 2026-10-20: "take tents down in raids and steal them";
// the numbers in data-tents.js TENT_TAKE, the tents' hit points in softcover.js TENT_FIGHT).
//
// THE TENTS ON A BATTLE MAP (b.tents, plain data: a save keeps it). Every tent on a map is a record
//   { id, kind (data-tents.js TENT_TYPES), cells: [[x, y]], side (whose camp: "player" | "enemy" | null), owner, box,
//     item, goes, down }
//   and its cells carry c.tentId. owner says who loses it when it is taken: { base, rec } your base's tent record
//   (softcover.js softSetup), { fid } an AI group's camp (conquest.js, the bag off its shelf), { band: "nomad" |
//   "visitor", id } a band's camp (campsite.js), { tile, poi, i } a campsite's tent i (campsite.js). item: the bag it is
//   (a group's or a band's very item, kept on the record), box: the container that holds what is stored in it (a raid's
//   or a field battle's: campsite.js). A tent never registered (an old save's map) is found by its cells the first time
//   anyone looks (ensureTents: each run of tent cells one tent, its kind by its size).
//
// TAKE DOWN (combatAct "strike": strikeAct; the AI: aiStrike). A person (yours or theirs) right next to a standing tent
//   (on it or touching any of its cells, diagonally too) works at it with both actions (TENT_TAKE.AP) a go; after
//   TENT_TAKE.GOES[kind] goes (a couple of turns, the four-person tent three; two people share the work) it is down:
//   its cells are open ground (a burned cell stays rubble), and what it is now (takeResult):
//     a bag    its share of hit points over TENT_TAKE.WRECKED: the bag (its owner's very item where it has one), torn
//              ones damaged (item.tentHp: its share; pitched again it stands worn, tents.js pitchTentAtBase);
//     rags     at or under it, or any of it burned: scrap and tent canvas (TENT_TAKE.SCRAP, CANVAS), no bag;
//     poles    a makeshift tent: a little wood and scrap (TENT_TAKE.MAKESHIFT), never a bag.
//   Yours: the bag into the arms of whoever finished it (the In arms slot, carry.js: hands full until it is set down),
//   onto the ground there when their hands are full or the bag will not go; the rest on the ground. What was stored
//   in it (its container) stays where it stood as a pile to search (the container shrinks to one cell, open ground).
//   A little noise: TENT_TAKE.NOISE on the raid's noise, Heat +HEAT, the unaware within RADIUS turn toward it.
//   Theirs (AI parity, docs/adr/0001-ai-parity.md): an attacker on a camp with nobody of the defenders in sight, next
//   to one of the defenders' tents, takes it down TENT_TAKE.AI_TAKE of the time (softcover.js tentAI, the slash's
//   priority), going on once begun; the bag goes into their loot and they make off with it (basemap.js thiefTurn).
// SLASH (combatAct "slashtent": slashAct). One action: softcover.js slashTent at a tent cell next to them (the same
//   numbers as the AI's slash), heard TENT_TAKE.SLASH_RADIUS tiles off.
// THE END (settleTentsDown, combat.js finishCombat before the handler): every tent taken down is gone from its owner:
//   your base's record struck (its beds and storage with it; basemap.js strikeTent) and the bag back in the stores
//   unless the raiders who took it got away with it (or kept the field): then it is theirs (their group's or band's
//   shelf); an AI group or a band loses the bag off its shelf; a campsite its tent (campsite.js poiTentsDown). Your
//   people who took one carry it home as anything carried (the raid's extraction, the battle's end).
import { TENT_TYPES } from "./data-tents.js";
import { TENT_TAKE } from "./data-tents.js";
import { GEAR, SUPPLIES } from "./data.js";
import { CELL, active, say, fx, alertNear, foesOf, canSee, playerSees, unitById } from "./combat.js"; // call-time only (the import cycle)
import { slashTent, TENT_FIGHT } from "./softcover.js"; // call-time only
import { survivorById, factionById, log } from "./world.js"; // call-time only
import { lootItem, newItem } from "./inventory.js"; // call-time only
import { groundAt, groundPile, pickUpFromGround, fieldReady, settlePile } from "./ground.js"; // call-time only
import { lootLayer } from "./raidloot.js"; // call-time only
import { strikeTent } from "./basemap.js"; // call-time only
import { normalizeBins } from "./containers.js"; // call-time only
import { campTentGone } from "./campsite.js"; // call-time only: a campsite's tent gone for good

export { TENT_TAKE };
const NEXT8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const cellAt = (b, x, y) => (x >= 0 && y >= 0 && x < b.w && y < b.h ? b.cells[y * b.w + x] : null);
const isTentCell = (c) => !!c && (c.k === "tent" || c.k === "torn");
const first = (u) => String((u && u.name) || "").split(" ")[0];

// ---------- the record ----------
/**
 * A tent onto the battle's list: its cells tagged (c.tentId). spec: { kind, cells, side, owner, item, box }. Returns
 * the record.
 * @param {any} b @param {{ kind: string, cells: number[][], side?: string | null, owner?: any, item?: any, box?: number | null }} spec
 */
export function addTent(b, spec) {
  if (!b.tents) b.tents = [];
  const t = { id: b.tents.length + 1, kind: TENT_TYPES[spec.kind] ? spec.kind : "tent1", cells: spec.cells.map(([x, y]) => [x, y]), side: spec.side ?? null, owner: spec.owner || null, item: spec.item || null, box: spec.box ?? null, goes: 0, down: null };
  b.tents.push(t);
  for (const [x, y] of t.cells) { const c = cellAt(b, x, y); if (c) c.tentId = t.id; }
  return t;
}
/** The kind a run of w × h tent cells is (an unregistered tent): its footprint's. @param {number} w @param {number} h */
export const kindBySize = (w, h) => (w >= 3 && h >= 3 ? "tent4" : w >= 2 && h >= 2 ? "tent2" : "tent1");
// Every run of tent cells nobody registered becomes a tent (an old save's map, a map laid before this module): the
// runs found by their cells (4-connected), each cut into footprints of its size (a 3 × 3, a 2 × 2, then 1 × 2).
export function ensureTents(b) {
  if (!b || !b.cells) return [];
  if (!b.tents) b.tents = [];
  if (b.tentsScanned) return b.tents;
  b.tentsScanned = true;
  const seen = new Uint8Array(b.w * b.h);
  for (let i = 0; i < b.cells.length; i++) {
    const c = b.cells[i];
    if (seen[i] || !isTentCell(c) || c.tentId != null) continue;
    const run = [], q = [i];
    seen[i] = 1;
    while (q.length) {
      const j = q.pop(), x = j % b.w, y = (j / b.w) | 0;
      run.push([x, y]);
      for (const [dx, dy] of NEXT8.slice(0, 4)) {
        const nx = x + dx, ny = y + dy, n = cellAt(b, nx, ny);
        if (!n || seen[ny * b.w + nx] || !isTentCell(n) || n.tentId != null) continue;
        seen[ny * b.w + nx] = 1;
        q.push(ny * b.w + nx);
      }
    }
    const xs = run.map((p) => p[0]), ys = run.map((p) => p[1]);
    const w = Math.max(...xs) - Math.min(...xs) + 1, h = Math.max(...ys) - Math.min(...ys) + 1;
    addTent(b, { kind: run.length >= 9 ? kindBySize(w, h) : run.length >= 4 && w >= 2 && h >= 2 ? "tent2" : "tent1", cells: run, side: b.holders || null });
  }
  return b.tents;
}
/** The tent a cell belongs to (a standing one), or null. @param {any} b @param {number} x @param {number} y */
export function tentAt(b, x, y) {
  const c = cellAt(b, x, y);
  if (!isTentCell(c)) return null;
  if (c.tentId == null) ensureTents(b);
  const t = (b.tents || []).find((o) => o.id === c.tentId);
  return t && !t.down ? t : null;
}
/** Does unit u stand on or right next to (diagonally too) a cell of tent t? @param {any} t @param {any} u */
export const nextToTent = (t, u) => !!t && !!u && t.cells.some(([x, y]) => Math.max(Math.abs(x - u.x), Math.abs(y - u.y)) <= 1);
/** The standing tents u is on or next to: [{ t, x, y }] (x, y: its cell nearest them). @param {any} b @param {any} u */
export function tentsNear(b, u) {
  const out = [];
  if (!b || !u || !b.cells) return out;
  const seen = new Set();
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
    const t = tentAt(b, u.x + dx, u.y + dy);
    if (!t || seen.has(t.id)) continue;
    seen.add(t.id);
    out.push({ t, x: u.x + dx, y: u.y + dy });
  }
  return out;
}
/** Its state: { n cells, hp, mhp, share 0–1, burned (cells that burned to rubble), torn (cells torn) }. @param {any} b @param {any} t */
export function tentWear(b, t) {
  let hp = 0, burned = 0, torn = 0;
  for (const [x, y] of t.cells) {
    const c = cellAt(b, x, y);
    if (!c) continue;
    if (c.k === "tent") hp += Math.max(0, c.hp ?? TENT_FIGHT.HP);
    else if (c.k === "torn") torn++;
    else if (c.k === "rubble") burned++;
  }
  const mhp = t.cells.length * TENT_FIGHT.HP;
  return { n: t.cells.length, hp, mhp, share: mhp ? hp / mhp : 0, burned, torn };
}
/** Goes left to take tent t down. @param {any} t */
export const goesLeft = (t) => Math.max(0, (TENT_TAKE.GOES[t.kind] || 2) - (t.goes || 0));
/** "a two-person tent". @param {any} t */
export const tentWord = (t) => `${TENT_TYPES[t.kind] ? TENT_TYPES[t.kind].name.toLowerCase() : "tent"}`;

// ---------- what it is once down ----------
/**
 * What tent t gives taken down now: { kind: "bag" | "rags" | "poles", item (the bag), gear (rags: scrap is a supply,
 * canvas items), sup }. The bag is the owner's very item where it has one, else a new one of its kind; a torn tent's
 * bag carries its share (item.tentHp).
 * @param {any} b @param {any} t
 */
export function takeResult(b, t) {
  const w = tentWear(b, t);
  const T = TENT_TYPES[t.kind];
  if (!T || !T.bag) return { kind: "poles", item: null, gear: [], sup: { ...TENT_TAKE.MAKESHIFT } };
  if (w.burned > 0 || w.share <= TENT_TAKE.WRECKED) {
    const gear = [];
    for (let i = 0; i < (TENT_TAKE.CANVAS[t.kind] || 1); i++) gear.push(newItem("canvas"));
    return { kind: "rags", item: null, gear, sup: { scrap: TENT_TAKE.SCRAP[t.kind] || 1 } };
  }
  const item = t.item && typeof t.item === "object" && GEAR[t.item.key] ? t.item : lootItem(t.kind, "site", [b.turn || 0, "tentbag", t.id, b.tileId ?? 0]);
  const pct = Math.round(w.share * 100);
  if (pct < 100) item.tentHp = Math.min(item.tentHp ?? 100, pct); else if (item.tentHp == null) delete item.tentHp;
  return { kind: "bag", item, gear: [], sup: {} };
}
// The tent's cells open ground again (a burned one stays rubble), its container moved onto one cell as the pile of
// what was stored in it.
function clearTent(b, t) {
  for (const [x, y] of t.cells) {
    const c = cellAt(b, x, y);
    if (!c) continue;
    delete c.tentId; delete c.tent; delete c.hp; delete c.mhp;
    if (c.k === "tent" || c.k === "torn") c.k = "open";
  }
  b.soft = undefined; // softcover.js softOn: worked out again
  b.anyTent = undefined;
  if (b.losCache) b.losCache.fill(0);
  const L = lootLayer(b);
  const box = t.box != null && L ? L.containers.find((c) => c.id === t.box) : null;
  if (box) {
    const [x, y] = t.cells[0];
    box.x = x; box.y = y; delete box.w; delete box.h;
    box.down = true;
    box.label = `What was in the ${tentWord(t)}`;
  }
}
// Puts a thing on the ground at (x, y) (a pile of finds: it counts as found when taken, not as a teammate's drop).
function onGround(b, x, y, f, what, n = 1) {
  const had = groundAt(b, x, y, f);
  const p = groundPile(b, x, y, f);
  if (!had) p.drop = false; // a find, not a fallen teammate's things (raidloot.js tally)
  if (typeof what === "string") { if (SUPPLIES[what] && n > 0) p.contents.sup[what] = (p.contents.sup[what] || 0) + n; }
  else if (what && GEAR[what.key]) p.contents.gear.push(what);
  settlePile(p);
  return p;
}

// ---------- the order ----------
/** Why u cannot take a tent down now ("" when it can). @param {any} b @param {any} u */
export function strikeRefusal(b, u) {
  if (!u || !active(u)) return "That unit cannot act.";
  if (u.kind !== "human") return "Only people take tents down.";
  if (!tentsNear(b, u).length) return "Stand on or right next to a standing tent.";
  if (u.ap < TENT_TAKE.AP) return "Taking a tent down takes both actions a go.";
  return "";
}
/**
 * One go at taking a tent down (yours or the AI's): both actions; down after its goes. Returns "" or why not.
 * act: { type: "strike", unit, x?, y? } (a cell of the tent; one tent next to them: that one).
 * @param {any} state @param {any} b @param {any} u @param {{ x?: number, y?: number }} [act]
 */
export function strikeAct(state, b, u, act = {}) {
  const why = strikeRefusal(b, u);
  if (why) return why;
  const near = tentsNear(b, u);
  const o = act.x != null ? near.find((n) => n.t === tentAt(b, Number(act.x), Number(act.y))) : near.length === 1 ? near[0] : near.find((n) => n.t.workBy === u.id) || null;
  if (!o) return near.length > 1 ? "Several tents next to them: say which." : "Stand on or right next to a standing tent.";
  const t = o.t;
  u.ap -= TENT_TAKE.AP;
  u.hunker = false;
  u.face = [Math.sign(o.x - u.x), Math.sign(o.y - u.y)];
  t.goes = (t.goes || 0) + 1;
  t.workBy = u.id;
  b.noise = (b.noise || 0) + TENT_TAKE.NOISE;
  if (b.raid) b.raid.heat = Math.min(100, (b.raid.heat || 0) + TENT_TAKE.HEAT);
  const left = goesLeft(t);
  const seen = u.side === "player" || playerSees(b, u);
  if (left > 0) {
    fx(b, { type: "melee", from: [u.x, u.y], to: [o.x, o.y], hit: true, crit: false, dmg: 0, side: u.side, text: "PEGS" });
    if (seen) say(b, `${u.name} pulls the pegs on a ${tentWord(t)} (${left} more go${left === 1 ? "" : "es"} to take it down).`, u.side === "player" ? "info" : "danger");
    alertNear(b, o.x, o.y, TENT_TAKE.RADIUS, "The rattle of tent poles carries: the unaware nearby turn toward it.", u.side === "player" ? null : u);
    return "";
  }
  finishStrike(state, b, u, t);
  alertNear(b, o.x, o.y, TENT_TAKE.RADIUS, "The rattle of tent poles carries: the unaware nearby turn toward it.", u.side === "player" ? null : u);
  return "";
}
// The tent is down: its cells open, what it is now where it goes. Yours: the bag into the arms (or the ground); the
// AI's: into its loot, off with it.
function finishStrike(state, b, u, t) {
  const r = takeResult(b, t);
  clearTent(b, t);
  const [px, py] = t.cells.reduce((best, c) => (Math.hypot(c[0] - u.x, c[1] - u.y) < Math.hypot(best[0] - u.x, best[1] - u.y) ? c : best), t.cells[0]);
  t.down = { by: u.id, side: u.side, result: r.kind, turn: b.turn || 0 };
  const f = u.f || 0;
  fx(b, { type: "melee", from: [u.x, u.y], to: [px, py], hit: true, crit: false, dmg: 0, side: u.side, text: "DOWN" });
  for (const [k, n] of Object.entries(r.sup)) if (n > 0) onGround(b, px, py, f, k, n);
  for (const it of r.gear) onGround(b, px, py, f, it);
  const name = tentWord(t);
  if (u.side !== "player") {
    // The AI: the bag (or what there is) is theirs to carry off.
    if (r.item) {
      t.down.bag = r.item;
      u.tentLoot = [...(u.tentLoot || []), t.id];
      u.loot = u.loot || { sup: {}, gear: [], kg: 0, from: {} };
      u.loot.full = true; // off the map with it (basemap.js thiefTurn → leaveWithLoot)
      u.thief = true;
    }
    if (playerSees(b, u) || t.side === "player") say(b, `${u.name} takes down ${t.side === "player" ? "your" : "a"} ${name}${r.item ? " and bundles it up to carry off" : r.kind === "rags" ? ": nothing but rags" : ""}.`, "danger");
    return;
  }
  if (!r.item) {
    say(b, `${u.name} takes down the ${name}: ${r.kind === "rags" ? "slashed to rags, only scrap and canvas are left (on the ground)" : "its poles and tarp give a little wood and scrap (on the ground)"}.`, "info");
    return;
  }
  fieldReady(b, state);
  const pile = onGround(b, px, py, f, r.item);
  const s = u.sid != null ? survivorById(state, u.sid) : null;
  let inArms = false;
  if (s) {
    const got = pickUpFromGround(state, b, u, pile, r.item, true);
    inArms = !pile.contents.gear.includes(r.item);
    if (!inArms && got.msg) t.down.why = got.msg;
  }
  t.down.bag = r.item;
  const torn = r.item.tentHp != null && r.item.tentHp < 100 ? ` (torn: ${r.item.tentHp}% left)` : "";
  say(b, `${u.name} takes down the ${name} and rolls it into its bag${torn}: ${inArms ? `in ${first(u)}'s arms` : `on the ground (${first(u)}'s hands are full)`}.`, "good");
}

/** Why u cannot slash a tent now ("" when it can). @param {any} b @param {any} u */
export function slashRefusal(b, u) {
  if (!u || !active(u)) return "That unit cannot act.";
  if (u.kind !== "human") return "Only people slash tents.";
  if (!slashTargets(b, u).length) return "Stand on or right next to a standing (unslashed) tent.";
  if (u.ap < TENT_TAKE.SLASH_AP) return "No action left.";
  return "";
}
/** The tent cells u can slash: [{ x, y, t }] (its own cell first). @param {any} b @param {any} u */
export function slashTargets(b, u) {
  const out = [];
  if (!b || !u || !b.cells) return out;
  for (const [dx, dy] of [[0, 0], ...NEXT8]) {
    const x = u.x + dx, y = u.y + dy, c = cellAt(b, x, y);
    if (c && c.k === "tent") out.push({ x, y, t: tentAt(b, x, y) });
  }
  return out;
}
/** One slash at a tent cell next to them (one action). act: { type: "slashtent", unit, x?, y? }. @param {any} state @param {any} b @param {any} u @param {{ x?: number, y?: number }} [act] */
export function slashAct(state, b, u, act = {}) {
  const why = slashRefusal(b, u);
  if (why) return why;
  const list = slashTargets(b, u);
  const o = act.x != null ? list.find((c) => c.x === Number(act.x) && c.y === Number(act.y)) || list.find((c) => c.t && c.t === tentAt(b, Number(act.x), Number(act.y))) : list[0];
  if (!o) return "Stand on or right next to a standing (unslashed) tent.";
  u.ap -= TENT_TAKE.SLASH_AP;
  u.hunker = false;
  u.face = [Math.sign(o.x - u.x), Math.sign(o.y - u.y)];
  const dmg = slashTent(b, u, o.x, o.y);
  const c = cellAt(b, o.x, o.y);
  say(b, `${u.name} slashes the ${o.t ? tentWord(o.t) : "tent"}${c && c.k === "torn" ? " open" : ` (−${dmg})`}.`, "info");
  alertNear(b, o.x, o.y, TENT_TAKE.SLASH_RADIUS, "A blade through canvas: someone close by turns toward it.");
  return "";
}

// ---------- the AI ----------
/**
 * An attacker on a camp (softcover.js tentAI: nobody of the defenders in sight) takes down a tent of the defenders
 * right next to it: TENT_TAKE.AI_TAKE of the time, or on with one it began. Returns true when it acted.
 * @param {any} state @param {any} b @param {any} u
 */
export function aiStrike(state, b, u) {
  if (!u || u.kind !== "human" || !active(u) || u.ap < TENT_TAKE.AP || u.tentLoot) return false;
  const near = tentsNear(b, u).filter((n) => n.t.side !== u.side && n.t.owner); // somebody's tent (a base's, a camp's): one nobody owns is only slashed
  if (!near.length) return false;
  const going = near.find((n) => n.t.workBy === u.id && n.t.goes > 0);
  if (!going && !b.rng.chance(TENT_TAKE.AI_TAKE)) return false;
  const o = going || near[0];
  return strikeAct(state, b, u, { x: o.x, y: o.y }) === "";
}

// ---------- after the fight ----------
// Where a bag carried off goes: the raiders' group or band (its shelf), else nowhere (gone with them).
function shelfOfTaker(state, b, u) {
  const e = (b.setup && b.setup.enemy) || {};
  if (u && u.factionId != null) { const f = factionById(state, u.factionId); if (f && f.alive) return f.wares || (f.wares = []); }
  const band = e.band;
  if (band && band.id != null) {
    const list = band.kind === "visitor" ? state.visitors || [] : (state.nomads && state.nomads.bands) || [];
    const v = list.find((x) => x.id === band.id);
    if (v) return v.wares || (v.wares = []);
  }
  if (e.factionId != null) { const f = factionById(state, e.factionId); if (f && f.alive) return f.wares || (f.wares = []); }
  return null;
}
// An item off a shelf: the very one, else one of its kind.
function offShelf(list, item, kind) {
  if (!Array.isArray(list)) return false;
  let i = item ? list.indexOf(item) : -1;
  if (i < 0) i = list.findIndex((it) => it && it.key === kind && it.withParty == null);
  if (i < 0) return false;
  list.splice(i, 1);
  return true;
}
/**
 * The fight is over (combat.js finishCombat, before the handler): every tent taken down is gone from its owner.
 * Returns the lines said (tests).
 * @param {any} state @param {any} b @param {any} result
 */
export function settleTentsDown(state, b, result) {
  const out = [];
  if (!b || !Array.isArray(b.tents) || b.drill || b.layout) return out;
  const won = !!result && (result.outcome === "victory" || result.outcome === "extracted");
  for (const t of b.tents) {
    if (!t.down || t.settled) continue;
    t.settled = true;
    const O = t.owner || {};
    const taker = t.down.by != null ? unitById(b, t.down.by) : null;
    const theirs = t.down.side !== "player";
    // Carried off by the other side: they got away with it, or held the field.
    const gone = theirs && !!taker && !!t.down.bag && (taker.fled || (!taker.dead && !taker.down && !won));
    if (O.base != null) {
      const base = (state.bases || []).find((x) => x.id === O.base);
      const rec = base && (base.buildings || []).find((r) => r.id === O.rec && r.type === "tent");
      if (base && rec) {
        strikeTent(state, base, rec.id);
        if (base.bins) normalizeBins(state, base);
        const name = TENT_TYPES[t.kind] ? TENT_TYPES[t.kind].name : "A tent";
        if (gone) {
          const shelf = shelfOfTaker(state, b, taker);
          if (shelf && t.down.bag) shelf.push(t.down.bag);
          out.push(`${name} at ${base.name} was taken down and carried off by the raiders.`);
        } else if (t.down.bag && theirs) {
          base.armory.push(t.down.bag); // dropped where they fell: picked up again, in the stores (not pitched)
          out.push(`${name} at ${base.name} was taken down in the fight; its bag is back in the stores.`);
        } else out.push(`${name} at ${base.name} was taken down in the fight.`);
      }
    } else if (O.fid != null) {
      const f = factionById(state, O.fid);
      if (f) offShelf(f.wares, t.item, t.kind);
    } else if (O.band) {
      const list = O.band === "visitor" ? state.visitors || [] : (state.nomads && state.nomads.bands) || [];
      const v = list.find((x) => x.id === O.id);
      if (v) offShelf(v.wares, t.item, t.kind);
    }
    if (O.poi != null) campTentGone(state, O);
  }
  for (const line of out) log(state, line, "danger");
  return out;
}
