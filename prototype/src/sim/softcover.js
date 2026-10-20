// Soft cover (the user's picks 2026-10-20): bushes and tents hide people but stop no bullets.
//
//   Concealment: whoever stands in a bush or a tent (CONCEAL.IN), or right next to one (CONCEAL.NEXT: a bush on any of
//     the four sides; a tent only between them and the one looking, "behind" it), is hard to make out. Driven by the
//     cell kind (SOFT), so a tent of any size works the same.
//       - Seen only within a share of the viewer's sight (CONCEAL.*.see × combat.js sightRange: the night, a light,
//         optics and height are already in it), never closer than MIN_SEE; someone sneaking there is not seen at all
//         from further than CLEAR (as stealth's sneaking behind cover). combat.js canSee (concealHidden), for every
//         side: your fog of war, the AI's targets, overwatch.
//       - Noticed by the unaware (people and the dead) at × CONCEAL.*.notice of the range (stealth.js noticeRange);
//         sneaking there is unheard as behind cover (stealth.js detectRange).
//       - A shot at them from further than CLEAR is CONCEAL.*.aim harder (combat.js shotOdds: a line of the hit
//         breakdown and a note on the odds line). Both sides alike (docs/adr/0001-ai-parity.md): the AI's bestShot
//         reads the same odds, and its scoreCell counts a concealed spot (CONCEAL.SCORE a point of the aim taken off).
//       - Given away: a loud shot (a suppressed one or a bow keeps it) shows the shooter for that turn and the next
//         (u.firedT: markShot, combat.js fire / suppress), as does a light switched on at night. The aim penalty stays (the
//         leaves are still in the way).
//     No protection: a bush and a tent are no cover at all (combat.js CELL cover 0, no shield, no bipod rest), and a
//     shot that is taken is not stopped or weakened. Walking into one costs CONCEAL.MOVE tiles more (combat.js
//     reachable, distField).
//   Tents: TENT_FIGHT.HP hit points a cell. The dead tear a tent they walk through (tentStep: CLAW a step); a raider,
//     or anyone attacking a camp, with nobody of the defenders in sight slashes a tent next to them (tentAI: SLASH, one
//     action, AI_SLASH of the time, once a turn) or throws a Molotov onto one (AI_BURN of the time, the side's throw of
//     the turn, the whole turn). A cell at 0 is a torn tent (CELL torn: open, no concealment); fire (throwables.js
//     FIRE.fuel tent) burns a tent cell to rubble; a blast tears it (combat.js breakCell).
//   Wear after the fight: a base's tents are tagged with their map item at the start (softSetup: c.tent = "b:<id>",
//     the tent's building record), their hit points set from the record; afterwards (settleTents, combat.js
//     finishCombat) the share left is kept on the record (rec.tentHp, 0–100; missing is 100) and the next fight and
//     the Base map view start from it: a wrecked tent (0) lies torn. The campers mend them (mendTents, breakdowns.js
//     breakdownsDaily): TENT_FIGHT.MEND a day while anyone is at home, a wrecked one pitched again the same way.
import { CELL, active, say, fx, foesOf, canSee, sightRange, playerSees, los } from "./combat.js"; // (call-time only: the import cycle)
import { activeLight } from "./vision.js";
import { throwAt, THROWABLES } from "./stealth.js"; // (call-time only)
import { FIRE, fireAt } from "./throwables.js"; // (call-time only)
import { layoutOf, rectOf, itemByKey } from "./basemap.js"; // (call-time only)
import { log, atBase } from "./world.js";

export const SOFT = new Set(["bush", "tent"]);
export const CONCEAL = {
  IN: { aim: 20, see: 0.5, notice: 0.5 },    // standing in a bush or a tent
  NEXT: { aim: 10, see: 0.75, notice: 0.75 }, // right next to a bush, or behind a tent
  CLEAR: 1.5,   // from this close they are seen clearly: no penalty, no hiding
  MIN_SEE: 2,   // seen at least this close (a viewer of short sight)
  FACE: 0.35,   // a tent "between" them and the viewer: the same test as cover facing (combat.js coverAgainst)
  MOVE: 0.5,    // tiles more for a step into a bush or a tent
  SCORE: 0.25,  // the AI's cell score a point of aim a shooter loses at them (combat.js scoreCell)
};
export const TENT_FIGHT = { HP: 24, SLASH: [10, 16], CLAW: [6, 10], AI_SLASH: 0.5, AI_BURN: 0.35, MEND: 25 };

const NONE = Object.freeze({ level: 0, by: null });
const DIRS4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const kAt = (b, x, y) => (x >= 0 && y >= 0 && x < b.w && y < b.h ? b.cells[y * b.w + x].k : null);

// Does this battle have any soft cover? Worked out once (b.soft) and kept; every check below is skipped without it.
export function softOn(b) {
  if (!b || !b.cells) return false;
  if (b.soft === undefined) b.soft = b.cells.some((c) => SOFT.has(c.k) || c.k === "torn");
  return !!b.soft;
}

// The concealment of someone standing at (x, y) against a viewer at (ax, ay) (null: whoever, the chip): { level: 0 none
// | 1 next to | 2 in, by: "bush" | "tent" }. Only on the ground (a walkway or a roof stands over the leaves).
export function concealAt(b, x, y, ax = null, ay = null) {
  if (!softOn(b) || x < 0 || y < 0 || x >= b.w || y >= b.h) return NONE;
  const c = b.cells[y * b.w + x];
  if ((c.h ?? CELL[c.k].h ?? 0) > 0) return NONE;
  if (SOFT.has(c.k)) return { level: 2, by: c.k };
  let by = null;
  for (const [dx, dy] of DIRS4) {
    const k = kAt(b, x + dx, y + dy);
    if (!SOFT.has(k)) continue;
    if (k === "bush") return { level: 1, by: "bush" }; // a bush on any side
    if (ax == null) { by = "tent"; continue; }
    const d = dist(x, y, ax, ay) || 1;
    if (((ax - x) * dx + (ay - y) * dy) / d > CONCEAL.FACE) by = "tent"; // the tent between them
  }
  return by ? { level: 1, by } : NONE;
}
// A unit's concealment against a viewer at (ax, ay): none in a vehicle, on its turret, for a 2 × 2 boss, off the map.
export function concealOf(b, t, ax = null, ay = null) {
  if (!t || t.aboard || t.gunner || t.off || (t.size || 1) > 1) return NONE;
  return concealAt(b, t.x, t.y, ax, ay);
}
// Given away: a loud shot this turn or the last (u.firedT), a light switched on at night.
export const revealed = (b, t) => (t.firedT != null && t.firedT >= b.turn - 1) || (!!b.night && !!activeLight(t));
const levelOf = (cz) => (cz.level === 2 ? CONCEAL.IN : cz.level === 1 ? CONCEAL.NEXT : null);
const whyOf = (cz) => (cz.level === 2 ? (cz.by === "bush" ? "in the bushes" : "in a tent") : cz.by === "bush" ? "beside the bushes" : "behind a tent");

// Is t hidden from a by the leaves or the canvas (combat.js canSee)? Never from their own side.
export function concealHidden(b, a, t) {
  if (!a || !t || a.side === t.side || !softOn(b)) return false;
  const cz = concealOf(b, t, a.x, a.y);
  if (!cz.level || revealed(b, t)) return false;
  const d = dist(a.x, a.y, t.x, t.y);
  if (d < CONCEAL.CLEAR) return false;
  if (t.sneaking) return true;
  return d > Math.max(CONCEAL.MIN_SEE, sightRange(b, a) * levelOf(cz).see);
}
// The aim a shot at t (standing at tx, ty) from (ax, ay) loses to it (combat.js shotOdds): { aim, why } or null.
export function concealAim(b, t, tx, ty, ax, ay) {
  if (!softOn(b) || dist(ax, ay, tx, ty) < CONCEAL.CLEAR || !t || t.aboard || t.gunner || (t.size || 1) > 1) return null;
  const cz = concealAt(b, tx, ty, ax, ay);
  return cz.level ? { aim: levelOf(cz).aim, why: whyOf(cz) } : null;
}
// The AI's cell score for standing concealed at (x, y) against a shooter at (fx, fy) (combat.js scoreCell).
export function concealScore(b, x, y, fx0, fy0) {
  if (dist(x, y, fx0, fy0) < CONCEAL.CLEAR) return 0;
  const cz = concealAt(b, x, y, fx0, fy0);
  return cz.level ? levelOf(cz).aim * CONCEAL.SCORE : 0;
}
// × the range an unaware e notices mover at (stealth.js noticeRange).
export function noticeMult(b, e, mover) {
  if (!softOn(b) || !mover || !e || mover.side === e.side) return 1;
  const cz = concealOf(b, mover, e.x, e.y);
  return cz.level && !revealed(b, mover) ? levelOf(cz).notice : 1;
}
// Unseen, only heard (stealth.js detectRange): sneaking in or beside soft cover facing the guard.
export const concealSneak = (b, e, mover) => !!mover.sneaking && softOn(b) && concealOf(b, mover, e.x, e.y).level > 0;
// Tiles more for a step into this cell (combat.js reachable, distField).
export const softCost = (c) => (c && SOFT.has(c.k) ? CONCEAL.MOVE : 0);
// A loud shot gives the shooter away (combat.js fire, suppress).
export function markShot(b, a) { if (a) a.firedT = b.turn; }

// The squad strip's chip (ui/battlehud.js): [text, class, tip] or null.
export function concealChip(b, u) {
  const cz = concealOf(b, u);
  if (!cz.level) return null;
  const L = levelOf(cz);
  const where = cz.level === 2 ? (cz.by === "bush" ? "In the bushes" : "In a tent") : cz.by === "bush" ? "Beside bushes" : "Beside a tent (hidden from its far side)";
  const given = revealed(b, u) ? " Given away for now: a loud shot, or a light on at night." : "";
  return ["HIDDEN", "info", `${where}: seen only within ${Math.round(L.see * 100)}% of the usual sight (not at all while sneaking, from more than a tile off), noticed at ${Math.round(L.notice * 100)}% of the range, −${L.aim} to shots from more than a tile off. No protection: a shot that is taken goes through.${given}`];
}
// The hover's words for a cell (ui/combat.js).
export function softWord(c) {
  if (!c) return "";
  if (c.k === "bush") return `Bushes: whoever stands in them is hidden (seen within ${CONCEAL.IN.see * 100}% of the usual sight, −${CONCEAL.IN.aim} to shots), right next to them a little (${CONCEAL.NEXT.see * 100}%, −${CONCEAL.NEXT.aim}). They stop no bullets. +${CONCEAL.MOVE} tiles to push through.`;
  if (c.k === "tent") return `A tent: whoever is inside is hidden (seen within ${CONCEAL.IN.see * 100}% of the usual sight, −${CONCEAL.IN.aim} to shots), behind it a little (${CONCEAL.NEXT.see * 100}%, −${CONCEAL.NEXT.aim}). Canvas stops no bullets. +${CONCEAL.MOVE} tiles to crawl in. Raiders slash it and the dead tear through it; it burns.`;
  if (c.k === "torn") return "A torn tent: slashed open, it hides nobody. The camp mends it after the fight.";
  return "";
}

// ---------- tents in a fight ----------
const initTent = (c) => { if (c.mhp == null) { c.mhp = TENT_FIGHT.HP; c.hp = TENT_FIGHT.HP; } };
// A tent cell slashed to nothing: torn open (no concealment), its hit points gone; it keeps its tag (c.tent).
export function tearTent(b, c) {
  c.k = "torn";
  c.hp = 0;
}
// One slash (a person: SLASH) or claw (the dead: CLAW) at the tent cell (x, y). Returns the damage.
export function slashTent(b, u, x, y) {
  const c = b.cells[y * b.w + x];
  if (!c || c.k !== "tent") return 0;
  initTent(c);
  const [lo, hi] = u.kind === "zombie" ? TENT_FIGHT.CLAW : TENT_FIGHT.SLASH;
  const dmg = b.rng.int(lo, hi);
  c.hp = Math.max(0, c.hp - dmg);
  fx(b, { type: "melee", from: [u.x, u.y], to: [x, y], hit: true, crit: false, dmg, side: u.side, text: c.hp > 0 ? `-${dmg}` : "TORN" });
  if (c.hp <= 0) tearTent(b, c);
  return dmg;
}
// One of the dead walking into a tent tears it (combat.js moveAlong).
export function tentStep(b, u, x, y) {
  if (u.kind !== "zombie" || kAt(b, x, y) !== "tent") return;
  slashTent(b, u, x, y);
  if (kAt(b, x, y) === "torn" && playerSees(b, u)) say(b, `${u.name} tears through a tent.`, "info");
}
// An attacker on a camp's map with none of the defenders in sight (combat.js aiUnit, before its shooting): a Molotov onto
// a tent, or a slash at one next to it. Returns true when it acted. Cheap: only with tents on the map and nobody seen.
export function tentAI(b, u) {
  if (!softOn(b) || u.kind !== "human" || !active(u) || u.ap < 1 || u.side === (b.holders || "player") || u.side === "third" || u.slashT === b.turn) return false;
  if (b.anyTent === undefined) b.anyTent = b.cells.some((c) => c.k === "tent"); // once a battle (a tent is never pitched mid-fight)
  if (!b.anyTent) return false;
  // The cheap tests first: a Molotov to throw, or a tent right there (underfoot or next to them); then nobody in sight.
  let at = null;
  for (let dy = -1; dy <= 1 && !at; dy++) for (let dx = -1; dx <= 1 && !at; dx++) if (kAt(b, u.x + dx, u.y + dy) === "tent") at = [u.x + dx, u.y + dy];
  const burn = !!(u.throwables && u.throwables.molotov > 0 && b.enemyThrowTurn !== b.turn);
  if (!at && !burn) return false;
  if (foesOf(b, u).some((f) => canSee(b, u, f))) return false;
  // A Molotov carried (u.throwables: the enemy's kit): the side's throw of the turn, the whole turn.
  if (burn && b.rng.chance(TENT_FIGHT.AI_BURN)) {
    const range = THROWABLES.molotov.range, mine = b.units.filter((o) => o.side === u.side && active(o));
    let best = null;
    for (let y = 0; y < b.h; y++) for (let x = 0; x < b.w; x++) {
      if (b.cells[y * b.w + x].k !== "tent" || fireAt(b, x, y)) continue;
      const d = dist(u.x, u.y, x, y);
      if (d < 2 || d > range || mine.some((o) => dist(o.x, o.y, x, y) <= FIRE.r + 1)) continue;
      if (!best || d < best.d) best = { x, y, d };
    }
    if (best) {
      u.throwables.molotov -= 1;
      b.enemyThrowTurn = b.turn;
      u.ap = 0;
      u.slashT = b.turn;
      throwAt(b, u, "molotov", best.x, best.y, !los(b, u.x, u.y, best.x, best.y));
      return true;
    }
  }
  // A tent right there: one slash, one action.
  if (!at || !b.rng.chance(TENT_FIGHT.AI_SLASH)) return false;
  u.slashT = b.turn;
  u.ap -= 1;
  slashTent(b, u, at[0], at[1]);
  if (playerSees(b, u) || u.side === "player") say(b, `${u.name} slashes a tent${kAt(b, at[0], at[1]) === "torn" ? " open" : ""}.`, u.side === "player" ? "info" : "danger");
  return true;
}

// ---------- the base's tents before and after ----------
// Where a tent's share of hit points is kept (0–100; missing: 100): its building record's own (rec.tentHp). Every
// tent of yours is a record in base.buildings with its map key b:<id> (basemap.js pitchTent, the Makeshift tent built;
// the pt-int merge, 2026-10-20), so this is the one place; an old save's base.plan.tentHp is dropped on load (save.js).
function tentStore(base, key, it) {
  if (!it || !it.rec || it.rec.type !== "tent" || !String(key || "").startsWith("b:")) return null; // a standing tent (a queued one, c:<id>, is a site)
  const rec = it.rec;
  return { get: () => rec.tentHp ?? 100, set: (v) => { if (v >= 100) delete rec.tentHp; else rec.tentHp = v; } };
}
const baseOf = (state, b) => {
  const F = b.deployPlan && b.deployPlan.fort;
  if (!F || !b.tier || b.tier.map !== "fort" || b.tier.baseId == null) return null;
  return state.bases.find((x) => x.id === b.tier.baseId) || null;
};
// The start of a fight (combat.js createBattle): whether the map has soft cover (b.soft); a base's tents tagged with
// their map item and given their hit points from its record (a wrecked one lies torn).
export function softSetup(state, b) {
  b.soft = undefined;
  if (!softOn(b)) return;
  const base = baseOf(state, b);
  if (!base) return;
  const F = b.deployPlan.fort;
  for (const e of layoutOf(state, base)) {
    if (!e.at) continue;
    const r = rectOf(e.it, e.at), cells = [];
    for (let y = r.y0; y < r.y0 + r.h; y++) for (let x = r.x0; x < r.x0 + r.w; x++) {
      const mx = x + F.ox, my = y + F.oy;
      if (mx < 0 || my < 0 || mx >= b.w || my >= b.h) continue;
      const c = b.cells[my * b.w + mx];
      if (c.k === "tent") cells.push(c);
    }
    const st = cells.length ? tentStore(base, e.it.key, e.it) : null;
    if (!st) continue;
    const pct = Math.max(0, Math.min(100, st.get()));
    for (const c of cells) {
      c.tent = e.it.key;
      c.mhp = TENT_FIGHT.HP;
      c.hp = Math.round((TENT_FIGHT.HP * pct) / 100);
      if (c.hp <= 0) tearTent(b, c);
    }
  }
}
// After a fight on a base's map (combat.js finishCombat): each tent's share of hit points kept on its record; a word in
// the log for a tent slashed, wrecked or burned.
export function settleTents(state, b) {
  if (!b || b.drill || b.layout || !b.soft) return;
  const base = baseOf(state, b);
  if (!base) return;
  const by = new Map();
  for (const c of b.cells) if (c.tent) (by.get(c.tent) || by.set(c.tent, []).get(c.tent)).push(c);
  for (const [key, cells] of by) {
    const it = itemByKey(state, base, key);
    const st = tentStore(base, key, it);
    if (!st) continue;
    let hp = 0, burned = 0;
    for (const c of cells) { if (c.k === "tent") hp += Math.max(0, c.hp ?? TENT_FIGHT.HP); else if (c.k === "rubble") burned++; }
    const pct = Math.round((hp / (cells.length * TENT_FIGHT.HP)) * 100), was = st.get();
    if (pct >= was) continue;
    st.set(pct);
    const name = (it && it.label) || "A tent";
    log(state, pct <= 0 ? `${name} at ${base.name} was ${burned ? "burned" : "slashed to rags"} in the fight: the campers will pitch it again.` : `${name} at ${base.name} was ${burned ? "burned" : "slashed"} in the fight (${pct}% left): the campers will mend it.`, "danger");
  }
}
// The campers mend their tents (breakdowns.js breakdownsDaily): TENT_FIGHT.MEND a day while anyone is at home. A tent
// struck goes with its record (and its wear).
export function mendTents(state) {
  for (const base of state.bases || []) {
    const recs = (base.buildings || []).filter((r) => r.type === "tent" && r.tentHp != null);
    if (!recs.length || !atBase(state, base.id).length) continue;
    for (const r of recs) { const v = r.tentHp + TENT_FIGHT.MEND; if (v >= 100) delete r.tentHp; else r.tentHp = v; }
  }
}
