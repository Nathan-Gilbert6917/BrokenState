// Barbed wire on the battle maps (the user's request of 2026-10-19: "barbed wire which slows down people and can be
// cut to bypass if you have a multi-tool or some other kind of tool like that can cut through").
//
//   Where it comes from: a base's Barbed wire fence and Concertina wire (buildings.js, the Defenses tab) laid as lines
//   on its battle map (fort.js buildFort: rings outside the wall; interior.js: lines in front of the yard without a
//   wall; deploy.js: columns in front of the wall line), and the armory's rolls of barbed wire (defences.js
//   armoryDefence, as before). A cell of wire is CELL "wire"; razor wire is the same cell with c.razor.
//   The dead (combat.js moveAlong, as before): one that steps in loses the rest of its turn; razor wire cuts it too
//   (WIRE.RAZOR_DEAD).
//   The living (wireStep, from moveAlong: your people, raiders, the third side): someone who steps into wire with
//   nothing to cut it is snagged: the move ends there, the rest of the turn is lost and the barbs cut them
//   (WIRE.SNAG, razor WIRE.RAZOR). Someone carrying a cutter (CUTTERS: a multitool, a field repair kit's pliers, an
//   axe, a hatchet or a machete) cuts a way through instead: the cell is open ground from then on, the move ends there,
//   no cuts and the next action kept.
//   Cut wire (cutTargets, cutAct; combatAct "cutwire"): one of yours with a cutter clears a cell of wire right next to
//   them (not diagonally) for WIRE.AP action, a little noise (WIRE.NOISE).
//   The human enemy carries a cutter by its kit (WIRE.KIT: kitCutter, own dice) or with a cutting weapon in hand.
import { survivorById } from "./world.js";
import { allCarried } from "./inventory.js";
import { GEAR } from "./data.js";
import { hash01 } from "./skills.js";

export const WIRE = {
  AP: 1, NOISE: 0.5, RADIUS: 2,
  SNAG: [2, 5], RAZOR: [5, 9], RAZOR_DEAD: [6, 12],
  // The chance a human of this kit carries something that cuts wire (pliers, snips, a bolt cutter), besides a cutting weapon.
  KIT: { raiders: 0.3, zealots: 0.2, guards: 0.35, militia: 0.4, fighters: 0.35, escorts: 0.4, contractors: 0.5, survivalists: 0.5, preppers: 0.6, soldiers: 0.7, looters: 0.25 },
};
// What cuts wire, by item key, and how it is said.
export const CUTTERS = {
  multitool: "snips it with a multitool", repairkit: "cuts it with the repair kit's pliers",
  fireaxe: "hacks through it with the fire axe", hatchet: "chops through it with the hatchet",
  machete: "hacks through it with the machete", sawmachete: "hacks through it with the saw-blade machete",
  sheetmachete: "hacks through it with the sheet-metal machete", sheethatchet: "chops through it with the sheet-metal hatchet",
};
export const CUTTER_NAMES = Object.keys(CUTTERS).map((k) => (GEAR[k] ? GEAR[k].name.toLowerCase() : k));
const usable = (it) => !!it && !!CUTTERS[it.key] && !(Number.isFinite(it.dur) && it.dur <= 0);
export const isWire = (c) => !!c && c.k === "wire";

// The key of the first cutter a person carries, or 0 (combat.js playerUnit, refitUnit: u.cutter).
export const cutterKeyOf = (s) => { const it = s ? allCarried(s).find(usable) : null; return it ? it.key : 0; };
// The cutter a unit has: { key, how } or null. Yours (and anyone with a survivor behind them): anything they carry
// (asked of the person when state is given, else the unit's u.cutter key); the human enemy: their weapon, or the kit's
// snips (u.cutter 1, kitCutter). The dead never.
export function cutterOf(state, u) {
  if (!u || u.kind === "zombie") return null;
  const s = u.sid != null && state ? survivorById(state, u.sid) : null;
  const key = s ? cutterKeyOf(s) : u.cutter;
  if (key && CUTTERS[key]) return { key, how: CUTTERS[key] };
  if (s) return null;
  if (u.weapon && CUTTERS[u.weapon]) return { key: u.weapon, how: CUTTERS[u.weapon] };
  return u.cutter ? { key: "snips", how: "cuts it with a pair of snips" } : null;
}
export const kitCutter = (kind, seed, id) => (WIRE.KIT[kind] && hash01(seed, "wirecut", id) < WIRE.KIT[kind] ? 1 : 0);

const roll = (b, [lo, hi], ...salt) => lo + Math.floor(hash01(b.rng.state, "wire", b.turn, ...salt) * (hi - lo + 1));
// Turns a cell of wire into open ground (cut through, rolled aside).
function clearWire(c) {
  c.k = "open";
  delete c.razor;
  c.cutWire = true;
}

// One of the living steps into wire (combat.js moveAlong). Returns true when the move stops there (always: cut through
// or snagged). h: { say, damage, fx }.
export function wireStep(state, b, u, x, y, h) {
  const c = b.cells[y * b.w + x];
  if (!isWire(c) || u.kind === "zombie") return false;
  const first = u.name.split(" ")[0];
  const what = c.razor ? "razor wire" : "barbed wire";
  const cut = cutterOf(state, u);
  if (cut) {
    clearWire(c);
    h.say(b, `${u.name} ${cut.how.replace(/\bit\b/, `the ${what}`)} and pushes through.`, u.side === "player" ? "info" : "danger");
    return true;
  }
  const dmg = roll(b, c.razor ? WIRE.RAZOR : WIRE.SNAG, x, y, u.id);
  const eff = Math.round(h.damage(b, u, dmg, null, false, { how: "wire" }));
  u.ap = 0;
  if (h.fx) h.fx(b, { type: "melee", from: [x, y], to: [x, y], hit: true, crit: false, dmg: eff, side: u.side, text: "SNAG" });
  h.say(b, `${u.name} is snagged on the ${what} (${eff}): ${first} spends the rest of the turn tearing free.`, u.side === "player" ? "danger" : "good");
  return true;
}

// The wire one of yours could cut from where they stand: [{ x, y, c }] right next to them (not diagonally).
export function cutTargets(b, u) {
  const out = [];
  if (!u) return out;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = u.x + dx, y = u.y + dy;
    if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
    const c = b.cells[y * b.w + x];
    if (isWire(c)) out.push({ x, y, c });
  }
  return out;
}
// Why one of yours cannot cut wire now ("" when they can).
export function cutRefusal(state, b, u) {
  if (!u) return "Nobody picked.";
  if (!cutterOf(state, u)) return `${u.name.split(" ")[0]} has nothing to cut wire with (a ${CUTTER_NAMES.slice(0, -1).join(", a ")} or a ${CUTTER_NAMES[CUTTER_NAMES.length - 1]}).`;
  if (!cutTargets(b, u).length) return "Stand right next to the wire (not diagonally).";
  if ((u.ap || 0) < WIRE.AP) return "No actions left.";
  return "";
}
// Cut wire (combatAct "cutwire" { unit, x, y }): the cell next to them is open ground. Returns an error or "".
export function cutAct(state, b, u, act, h) {
  const why = cutRefusal(state, b, u);
  if (why) return why;
  const t = cutTargets(b, u).find((p) => p.x === act.x && p.y === act.y) || (act.x == null ? cutTargets(b, u)[0] : null);
  if (!t) return "Pick the wire right next to them.";
  const cut = cutterOf(state, u), what = t.c.razor ? "razor wire" : "barbed wire";
  clearWire(t.c);
  u.ap -= WIRE.AP;
  if (b.raid) b.raid.noise = (b.raid.noise || 0) + WIRE.NOISE;
  if (h.alertNear) h.alertNear(b, t.x, t.y, WIRE.RADIUS, "The snap of cut wire is heard.", u);
  h.say(b, `${u.name} ${cut.how.replace(/\bit\b/, `the ${what}`)}: a way through.`, "info");
  return "";
}
