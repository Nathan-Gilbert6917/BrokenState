// The third side in a battle: people on the map who are neither your team nor its enemies (wanderers.js brings them).
//   neutral  - survivors who keep to themselves. They stay where they are (hidden in a raid's building) until the
//              dead or armed strangers come near; then they defend themselves when armed, not badly hurt and not
//              outnumbered (or cornered), else they run for the map edge. They call out when your people find them.
//   military - a squad of soldiers. They fight the dead and armed people who are up and fighting (aware enemy humans),
//              never you, unless you attack them: then every soldier on the map turns on you.
// Attacking a neutral turns its own group on you (they defend themselves); the soldiers do not care about that.
// A third-side unit has side "third", team "neutral" | "military" and tgroup (its index in b.third). Once turned it
// becomes side "enemy" and the usual enemy AI runs it (tgroup stays, so the aftermath can count it).
// Hooks in combat.js (all marked "thirdside.js"): who fights whom (foesOf), the turn queue, the AI's plan, a hit by
// your people (damage), overwatch, placing them (createBattle setup.third, createRaid groups with a side) and the
// result (result.third). A battle with no third side takes exactly the old paths.
import { enemyUnit, active, los, WEAPONS, say, registerOccupantSide } from "./combat.js";

export const THIRD = {
  THREAT_DEAD: 7,      // the dead this close (tiles) are a threat to neutrals
  THREAT_PEOPLE: 9,    // armed strangers who are up and fighting, this close
  SEE: 10,             // your people this close, in sight: the group is met (and calls out once)
  BRAVE_HP: 0.5,       // a neutral defends itself only above this share of its health
  OUTNUMBER: 1.5,      // ... and only while the threats are no more than this many per armed member of its group
  RING: { neutral: "#e9d98f", military: "#8fd19b" }, // ground rings (ui/combat.js, ui/isoview.js)
};
// Armed strangers a neutral group fears (enemy kits): loose survivors and raiders. Faction guards leave them alone.
const PREDATORS = new Set(["survivors", "raiders"]);

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const adj = (a, t) => Math.max(Math.abs(a.x - t.x), Math.abs(a.y - t.y)) === 1;
export const isThird = (u) => !!u && u.side === "third";
export const thirdRing = (t) => THIRD.RING[t.team] || THIRD.RING.neutral;

// ---------- placing ----------
// The group record for a wanderers.js group g ({ side, name, factionId, wid, people }), made on first use.
function groupIndex(b, g) {
  const list = b.third || (b.third = []);
  let i = list.findIndex((x) => x.src === g);
  if (i < 0) {
    i = list.length;
    list.push({ src: g, team: g.side === "military" ? "military" : "neutral", name: g.name || (g.side === "military" ? "the soldiers" : "the survivors"), factionId: g.factionId ?? null, wid: g.wid ?? null, start: 0, hostile: false, met: false, called: false });
  }
  return i;
}

// Turns a unit made by combat.js enemyUnit into a member of group g (the k-th). Used by createRaid and createBattle,
// and by building interiors (buildingmaps.js) for the neutral and military occupants interiorOccupants returns.
export function thirdSideUnit(b, u, g, k = 0) {
  const gi = groupIndex(b, g);
  const rec = b.third[gi];
  u.side = "third";
  u.team = rec.team;
  u.tgroup = gi;
  u.aware = false;
  if (g.factionId != null) u.factionId = g.factionId;
  const who = g.people && g.people[k];
  if (who) {
    if (who.name) { u.name = who.name; u.short = who.name.split(" ").map((w) => w[0]).join("").slice(0, 2).toUpperCase(); }
    const w = who.weapon && WEAPONS[who.weapon] ? who.weapon : rec.team === "neutral" ? "fists" : null;
    if (w) { u.weapon = w; u.weaponName = WEAPONS[w].name; }
    if (who.hp) { u.hp = Math.min(u.maxHp, who.hp); }
  }
  rec.start += 1;
  // A neutral's body is its own (wanderers.js people), not a raider's kit.
  if (rec.team === "neutral") u.kit = "survivors";
  return u;
}

// A field battle's third side (createBattle, setup.third: [{ side, kind, count, power, name, factionId, people }]):
// placed in the middle of the map, between your people and the enemy's line, in cover. pick(n, test, score) is
// createBattle's own cell picker; W is the map width.
export function placeThird(b, groups, rng, pick, W) {
  for (const g of groups || []) {
    const n = Math.max(0, Math.min(8, Math.round(g.count || 0)));
    for (let k = 0; k < n; k++) {
      const u = enemyUnit(b, rng, g.kind || "survivors", g.power || 3, k + 1);
      thirdSideUnit(b, u, g, k);
      const c = pick(1, (x) => x >= Math.round(W * 0.35) && x <= Math.round(W * 0.62), (x, y) => (g.side === "military" ? 0 : 1) * rng.next())[0]
        || pick(1, (x) => x >= Math.round(W * 0.25), () => rng.next())[0];
      if (!c) continue;
      u.x = c[0]; u.y = c[1];
      // Soldiers fighting the dead are already at it; survivors being robbed already know.
      u.aware = true;
      b.units.push(u);
    }
  }
}

// A building's interior (buildingmaps.js placeOccupantGroups, from wanderers.js interiorOccupants): the neutral
// survivors and the military squad inside, in their room, unaware, their own alert group. Registered as this module
// loads (combat.js keeps the table on first use, so the circular imports do not matter).
function placeOccupants(state, b, grp, place) {
  const rng = state.rng;
  const pod = place.pod();
  const home = place.room ? [place.room.x0 + Math.floor(place.room.w / 2), place.room.y0 + Math.floor(place.room.h / 2)] : null;
  (grp.people || []).slice(0, 12).forEach((p, k) => {
    const u = enemyUnit(b, rng, p.kit || (grp.side === "military" ? "soldiers" : "survivors"), p.power || grp.power || 3, k + 1);
    thirdSideUnit(b, u, grp, k);
    u.pod = pod;
    const c = rng.pick(place.cells());
    if (!c) return;
    u.x = c[0]; u.y = c[1]; u.home = home || [c[0], c[1]];
    b.units.push(u);
  });
}
registerOccupantSide("neutral", placeOccupants);
registerOccupantSide("military", placeOccupants);

// ---------- who fights whom ----------
// What a third-side unit fights: soldiers the dead and armed people up and fighting; neutrals what threatens them now.
export function thirdFoes(b, u) {
  if (u.team === "military") {
    return b.units.filter((o) => o !== u && active(o) && ((o.side === "enemy" && (o.kind === "zombie" || o.aware)) || (o.wild && o.side !== "third" && o.side !== "player")));
  }
  return b.units.filter((o) => active(o) && o.side === "enemy" && (o.kind === "zombie"
    ? dist(o, u) <= THIRD.THREAT_DEAD
    : o.aware && PREDATORS.has(o.kit) && dist(o, u) <= THIRD.THREAT_PEOPLE));
}

// Does enemy human e go after third-side unit o? Soldiers once e is up and fighting; neutrals when e is a predator.
export const enemyTargetsThird = (o, e) => (o.team === "military" ? !!e.aware : PREDATORS.has(e.kit));

// Overwatch and any other "may a shoot b" check involving the third side: false when neither would fight the other.
export function hostilePair(b, a, t) {
  if (a.side !== "third" && t.side !== "third") return true;
  if (a.side === "third") return thirdFoes(b, a).includes(t);
  // t is third: the dead go for anyone; enemy people by enemyTargetsThird; your people never on their own.
  if (a.side === "player") return false;
  return a.kind === "zombie" || enemyTargetsThird(t, a);
}

// ---------- the AI's plan for a third-side unit (combat.js aiUnit) ----------
// "hold" (stay put this turn), "flee" (run for the edge) or "fight" (the usual AI against thirdFoes).
export function thirdPlan(b, u) {
  const g = b.third && b.third[u.tgroup];
  if (g && !g.met && b.units.some((p) => p.side === "player" && active(p) && dist(p, u) <= THIRD.SEE && los(b, p.x, p.y, u.x, u.y))) {
    g.met = true;
    if (!g.called) {
      g.called = true;
      say(b, g.team === "military" ? `Soldiers wave your people off: "Civilians! Stay out of our line of fire."` : `${cap(g.name)} call out from cover: "Don't shoot! We're not with anyone."`, "info");
    }
  }
  const foes = thirdFoes(b, u);
  if (!foes.length) return "hold";
  u.aware = true;
  if (u.team === "military") return "fight";
  const armed = u.weapon && u.weapon !== "fists";
  const mates = b.units.filter((o) => o.side === "third" && o.tgroup === u.tgroup && active(o) && o.weapon !== "fists").length;
  if (armed && foes.some((f) => adj(u, f))) return "fight"; // cornered
  if (armed && u.hp >= u.maxHp * THIRD.BRAVE_HP && foes.length <= Math.max(1, mates) * THIRD.OUTNUMBER) return "fight";
  return "flee";
}

// ---------- your people attack them ----------
// combat.js damage(), before the hit lands: a unit of yours hitting a third-side unit turns its side on you (the
// soldiers: every soldier on the map; neutrals: their own group).
export function thirdSideHit(b, t, by) {
  if (!t || t.side !== "third" || !by || by.side !== "player") return;
  const g = b.third && b.third[t.tgroup];
  const military = t.team === "military";
  const turned = b.units.filter((o) => o.side === "third" && (military ? o.team === "military" : o.tgroup === t.tgroup));
  for (const o of turned) {
    o.side = "enemy";
    o.aware = true;
    o.pod = 900 + o.tgroup; // their own group for the alarm (alertPod)
    o.ow = false;
    const r = b.third && b.third[o.tgroup];
    if (r) r.hostile = true;
  }
  if (g) say(b, military ? "You fired on the soldiers. The whole squad turns its guns on you!" : `${cap(g.name)} fight back!`, "danger");
}

// ---------- the result ----------
// result.third (endBattle, endRaid): one line per group: { team, name, factionId, wid, start, alive, dead, fled,
// hostile, met }.
export function thirdResult(b) {
  if (!b.third || !b.third.length) return null;
  return b.third.map((g, i) => {
    const mine = b.units.filter((u) => u.tgroup === i);
    return {
      team: g.team, name: g.name, factionId: g.factionId, wid: g.wid, start: g.start, hostile: g.hostile,
      met: g.met || mine.some((u) => !u.dead && b.units.some((p) => p.side === "player" && !p.dead && dist(p, u) <= THIRD.SEE)),
      alive: mine.filter((u) => !u.dead).length, dead: mine.filter((u) => u.dead).length, fled: mine.filter((u) => u.fled).length,
    };
  });
}

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
