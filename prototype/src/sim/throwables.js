// Throwables that do more than make a noise (stealth.js THROWABLES lists them all; its throw action calls landEffect
// for the ones with fx). What is on the map lives on the battle: b.fires, b.smoke, b.flares = [{ x, y, r, turns }],
// counted down at the start of each player turn (a full round, burnRound).
//   blast (pipe bomb): 22–34 damage to everyone standing within a tile of where it lands, either side; the bang
//     wakes everything within 14 tiles and counts as gunfire noise (more of the dead on infected ground).
//   fire (Molotov): 12–18 to everyone within a tile, and the ground burns for 3 rounds: 8–14 to anyone who walks
//     into the flames or stands in them when a round ends.
//   smoke (smoke grenade): a cloud 2 tiles around for 3 rounds; a shot into or out of it is −30 to hit, and sounding
//     the retreat is +20 for anyone in it or within 2 tiles of it (combat.js escapeOdds).
//   flare (road flare): burns 4 rounds; your people see anything within 5 tiles of it whatever the dark, and aim
//     +10 at it in a night battle. Its glare is a lure too (stealth.js).
// The AI (combat.js autoPlayerTurn): a pipe bomb or a Molotov on three or more enemies bunched up and none of
// yours near, a smoke grenade when the retreat is about to be sounded.
import { say, fx, damage, active, alertNear, alertPod } from "./combat.js";

export const BLAST = { r: 1.5, dmg: [22, 34], wake: 14, noise: 4 };
export const FIRE = { r: 1.5, turns: 3, hit: [12, 18], burn: [8, 14] };
export const SMOKE = { r: 2, turns: 3, aim: 30, retreat: 20, near: 2 };
export const FLARE = { r: 5, turns: 4, aim: 10 };

const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);
const inAny = (list, x, y, extra = 0) => !!list && list.some((c) => dist(c.x, c.y, x, y) <= c.r + extra + 1e-6);

export const smokeAt = (b, x, y, extra = 0) => inAny(b.smoke, x, y, extra);
export const flareLit = (b, x, y) => inAny(b.flares, x, y);
export const fireAt = (b, x, y) => inAny(b.fires, x, y);

// Everyone standing (or down) within r of (x, y) who can still be hurt.
const caught = (b, x, y, r) => b.units.filter((t) => active(t) && dist(t.x, t.y, x, y) <= r + 1e-6);

function hurtAll(b, by, list, [lo, hi], what) {
  const parts = [];
  for (const t of list) {
    const eff = Math.round(damage(b, t, b.rng.int(lo, hi), by));
    if (by && by.xpT && t.side === "enemy") { by.xpT.hits++; if (t.dead) by.xpT.kills++; }
    parts.push(`${t.name} ${eff}${t.dead ? " (dead)" : t.down ? " (down)" : ""}`);
    fx(b, { type: "melee", from: [t.x, t.y], to: [t.x, t.y], hit: true, crit: false, dmg: eff, side: by ? by.side : "enemy", text: what });
    if (t.side === "enemy" && !t.dead && !t.aware) alertPod(b, t.pod, `${t.name} cries out!`);
  }
  return parts;
}

// A throwable with fx lands at (x, y). Returns extra text for the log line.
export function landEffect(b, u, T, x, y) {
  if (T.fx === "blast") {
    const parts = hurtAll(b, u, caught(b, x, y, BLAST.r), BLAST.dmg, "BOOM");
    b.noise = (b.noise || 0) + BLAST.noise;
    alertNear(b, x, y, BLAST.wake, "The blast wakes everything nearby.");
    return parts.length ? `The blast catches ${parts.join(", ")}.` : "The blast hits nobody.";
  }
  if (T.fx === "fire") {
    const parts = hurtAll(b, u, caught(b, x, y, FIRE.r), FIRE.hit, "FIRE");
    (b.fires || (b.fires = [])).push({ x, y, r: FIRE.r, turns: FIRE.turns });
    return `The ground burns for ${FIRE.turns} turns${parts.length ? `; caught in it: ${parts.join(", ")}` : ""}.`;
  }
  if (T.fx === "smoke") {
    (b.smoke || (b.smoke = [])).push({ x, y, r: SMOKE.r, turns: SMOKE.turns });
    return `Thick smoke for ${SMOKE.turns} turns: shots through it are −${SMOKE.aim}.`;
  }
  if (T.fx === "flare") {
    (b.flares || (b.flares = [])).push({ x, y, r: FLARE.r, turns: FLARE.turns });
    return "It lights up everything around it.";
  }
  return "";
}

// Walking into the flames (combat.js moveAlong). Returns true when the unit was burned.
export function fireStep(b, u, x, y) {
  if (!b.fires || !b.fires.length || !active(u) || !fireAt(b, x, y)) return false;
  burn(b, u, "walks into the flames");
  return true;
}
// The burn line first, then the damage (so a death reads after it).
function burn(b, u, what) {
  const raw = b.rng.int(FIRE.burn[0], FIRE.burn[1]);
  say(b, `${u.name} ${what} (${Math.round(raw * u.armor)}).`, u.side === "player" ? "danger" : "good");
  damage(b, u, raw, null);
}

// The start of each player turn: whoever stands in the flames burns, then fires, smoke and flares burn down.
export function burnRound(b) {
  if (b.fires && b.fires.length) for (const t of b.units) {
    if (!active(t) || !fireAt(b, t.x, t.y)) continue;
    burn(b, t, "burns");
  }
  for (const k of ["fires", "smoke", "flares"]) {
    if (!b[k] || !b[k].length) continue;
    for (const c of b[k]) c.turns -= 1;
    b[k] = b[k].filter((c) => c.turns > 0);
  }
}

// ---------- the AI's throws (combat.js autoPlayerTurn, the player side's AI) ----------
// The best spot for a pipe bomb or a Molotov: at least 3 enemies caught, none of yours within the radius + 1.
export function blastSpot(b, u, range, r) {
  const foes = b.units.filter((t) => t.side === "enemy" && active(t));
  const mine = b.units.filter((t) => t.side === "player" && active(t));
  let best = null;
  for (const f of foes) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = f.x + dx, y = f.y + dy;
      if (x < 0 || y < 0 || x >= b.w || y >= b.h) continue;
      const d = dist(u.x, u.y, x, y);
      if (d > range || d < 2) continue;
      if (mine.some((m) => dist(m.x, m.y, x, y) <= r + 1)) continue;
      const n = foes.filter((t) => dist(t.x, t.y, x, y) <= r + 1e-6).length;
      if (n >= 3 && (!best || n > best.n)) best = { x, y, n };
    }
  }
  return best;
}
