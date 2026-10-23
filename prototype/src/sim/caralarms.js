// Car alarms on a battle or raid map (the user's request 2026-10-23: "Be able to set off car alarms to attract zombies
// to the alarm and away from you. Be able to set them off from afar as well by throwing something through the window.
// Add chance of alarm set off when smashing the window to try to loot a locked car or to hotwire it.").
//
// Which cars have one (foundcars.js carRecord, its own die "alarm": the car's other dice do not move): a civilian
// sedan, van or pickup, ALARM.HAS of them by model, and only with a live battery (a flat one cannot sound it: most of
// the cars left on the roads, COND.civil battery); never a burnt-out box truck or an Army vehicle. A group's own car in
// its motor pool (arsenal.js) by the same share (its battery is live). rec.alarm: null (none), "armed", "ringing",
// "off" (rang out or silenced: it never sounds again). An armed one blinks a red light on the dash: seen from next to
// the car (the car panel says whether it has one), or by anyone with eyes on it within LED tiles (ledSeen: the AI).
// A save from before has no rec.alarm: decided on the next look (carRecord), by the same die.
//
// What sets an armed one off:
//   alarm    "Set it off" (foundcars.js carAct "alarm"): from next to the car, 1 action: bang on the door, rock it.
//            Sure. Whoever does it stands next to the noise: the dead come there. Walk away.
//   smash    breaking the glass to get in (carAct "force" without a pry bar; locks.js openLock on a locked car's raid
//            box): SMASH a try, open or not. force: prying the door with a crowbar, FORCE a try. HOTWIRE a hotwire try.
//   search   rummaging through a car in a wreck pile or on the road (combat.js searchBox, AREAS def.alarm 0.15): the
//            same draw as before, now only on an armed car, at searchChance (def.alarm over the share of cars armed,
//            so about as often as before over all cars). Quiet Hands never sets one off.
//   throw    something thrown onto the car (stealth.js throwAt → throwAtCar): THROW[key] it breaks a window (rec.glass:
//            the doors open by reaching in; the breaking glass is heard GLASS tiles off); a broken window on an armed
//            one sets it off. Army glass and a burnt-out shell do not break. A blast (a pipe bomb, a frag grenade, a
//            flashbang) within BLAST tiles of a car shakes an armed one off (alarmsNear). Picking the lock never does.
// Ringing (soundAlarm, alarmTurn from stealth.js stealthTurn): a lure at the car's middle (b.lures: key "caralarm",
// alarm: the car's id, RADIUS, noise, decoy; not one of THROWABLES, so nobody can throw it) for TURNS enemy turns:
// the unaware (people and the dead that hear noise) go to look at the car (stealth.js pull), and the dead already
// after someone walk to it (decoys.js stimuli / lureTurn) unless someone they are after is within LURE.PULL_FREE; a
// Shepherd's pack hears nothing (herded). Heat +HEAT at once on a raid, +TURN_HEAT each enemy turn it rings. Then it
// rings out ("off"). Silence it: inside the car (carAct "silence"), 1 action: pull the fuse.
// The AI (decoys.js botDecoy, every side by one rule: docs/adr/0001-ai-parity.md): with no decoy to throw, a bottle or
// an empty magazine at an armed car it sees the light of (ledSeen), AI_KEEP+ tiles from all its people, that the dead
// pressing them hear. Not setting one off by hand: that pulls the dead onto the one who does it.
// Dice: foundcars.js carRoll (hash01), never the world's or the battle's random numbers.
import { carRecord, carRoll, COND } from "./foundcars.js"; // (call-time only: the modules load in a circle)
import { pull, THROWABLES } from "./stealth.js"; // the unaware go to look; how far a thing is thrown (call-time only)
import { say, fx, los } from "./combat.js"; // (call-time only)

export const ALARM = {
  // The share of civilian cars fitted with one (by model), before the battery: a live one only (COND.civil battery).
  HAS: { sedan: 0.5, van: 0.45, pickup: 0.4 },
  RADIUS: 16, // tiles: the siren carries further than anything thrown (firecrackers 13)
  TURNS: 8, // enemy turns it rings (cheap alarms cut out after a minute or so)
  HEAT: 10, TURN_HEAT: 1, // raid Heat when it starts, and each enemy turn it rings
  SMASH: 0.4, FORCE: 0.25, HOTWIRE: 0.2, // a try: breaking the glass to get in, prying the door, pulling the wires under the dash
  // The chance a thrown thing breaks a window when it lands on a car (anything else, and anything with fx, none).
  THROW: { bottle: 0.6, emptymag: 0.4, alarmclock: 0.45, pocketradio: 0.4, noisemaker: 0.3, firecracker: 0.1, handwarmer: 0.05, heatpack: 0.05 },
  GLASS: 8, // tiles: the unaware hear a window break (a lure where it broke)
  BLAST: 3, // tiles from a blast (a pipe bomb, a frag grenade, a flashbang) that shakes an armed alarm off
  LED: 8, // tiles: the blinking dash light is seen from (with eyes on the car; next to it, always)
};
const BLASTS = ["blast", "frag", "flash"]; // throwables.js fx that shake a car

// ---------- which cars have one ----------
// carRecord's decision for a new record (or an old save's): die is the car's own (foundcars.js roll).
export function fitAlarm(rec, die) {
  if (!rec || rec.mil || ALARM.HAS[rec.model] == null) return null;
  if (rec.cond && rec.cond.battery === "flat") return null;
  return die("alarm") < ALARM.HAS[rec.model] ? "armed" : null;
}
export const alarmOf = (rec) => (rec && rec.alarm) || null;
// The share of all civilian cars that are armed (for the search's odds): the models' mean share × a live battery.
export const armedShare = () => { const v = Object.values(ALARM.HAS); return (v.reduce((a, x) => a + x, 0) / v.length) * (1 - COND.civil.battery); };
// The chance searching an armed car sets it off, from the area's old chance for any car (combat.js AREAS def.alarm).
export const searchChance = (p) => Math.min(1, p / armedShare());
export const throwBreakChance = (key) => ALARM.THROW[key] || 0;
export const carMiddle = (rec) => [rec.x + Math.floor(rec.w / 2), rec.y + Math.floor(rec.h / 2)];
const nameOf = (rec) => rec.name.toLowerCase();

// The car on a cell (its id), or null.
export function carIdAt(b, x, y) {
  if (x < 0 || y < 0 || x >= b.w || y >= b.h) return null;
  const c = b.cells[y * b.w + x];
  return c && c.car && (c.k === "car" || c.k === "truck") && !c.car.escort ? c.car.id : null;
}
// A car's record: made on the first look when the state is at hand, else only one already made (null).
export const recOf = (state, b, id) => (id == null ? null : state ? carRecord(state, b, id) : (b.cars && b.cars[id]) || null);
// The car record under a raid container of kind "car" (the box covers its cells), or null.
export function carOfBox(state, b, box) {
  for (let y = box.y; y < box.y + (box.h || 1); y++) for (let x = box.x; x < box.x + (box.w || 1); x++) { const id = carIdAt(b, x, y); if (id != null) return recOf(state, b, id); }
  return null;
}
// Every car on the map: ids.
export function carIds(b) {
  const out = new Set();
  for (const c of b.cells) if (c.car && (c.k === "car" || c.k === "truck") && !c.car.escort) out.add(c.car.id);
  return [...out];
}
// Does this unit see an armed car's dash light: next to the car, or within LED tiles with eyes on its middle.
export function ledSeen(b, u, rec) {
  const gap = Math.max(rec.x - u.x, u.x - (rec.x + rec.w - 1), rec.y - u.y, u.y - (rec.y + rec.h - 1), 0);
  if (gap <= 1) return true;
  const [x, y] = carMiddle(rec);
  return Math.hypot(u.x - x, u.y - y) <= ALARM.LED && los(b, u.x, u.y, x, y);
}

// ---------- ringing ----------
// Sets an armed alarm ringing: the lure, the first pull, the Heat, the line, the fx. why: what set it off (said
// first). H: { say, fx } (combat.js's when left out). Returns true when it started ringing.
export function soundAlarm(state, b, rec, H, why = "") {
  if (alarmOf(rec) !== "armed") return false;
  const S = H || { say, fx };
  const [x, y] = carMiddle(rec);
  rec.alarm = "ringing";
  rec.alarmLeft = ALARM.TURNS;
  b.lures = b.lures || [];
  const lure = { x, y, key: "caralarm", alarm: rec.id, turns: ALARM.TURNS, radius: ALARM.RADIUS, id: b.nextId++, side: null, from: null, sense: ["noise"], decoy: true };
  b.lures.push(lure);
  const n = pull(b, lure, true);
  if (b.raid) b.raid.heat = Math.min(100, b.raid.heat + ALARM.HEAT);
  S.say(b, `${why ? `${why} ` : ""}The ${nameOf(rec)}'s alarm goes off: the horn whooping, the lights flashing${n ? `; ${n} of them turn toward it` : ""}.${b.raid ? ` Heat +${ALARM.HEAT}.` : ""}`, "danger");
  S.fx(b, { type: "alarm", to: [x, y], car: rec.id });
  return true;
}
// Rolls the chance an act at the car sets it off (chance: ALARM.SMASH / FORCE / HOTWIRE; roll: its die).
export function tripAlarm(state, b, rec, chance, roll, H, why = "") {
  if (alarmOf(rec) !== "armed" || !(roll < chance)) return false;
  return soundAlarm(state, b, rec, H, why);
}
function endAlarm(b, rec, lure, how) {
  if (lure && b.lures) { const i = b.lures.indexOf(lure); if (i >= 0) b.lures.splice(i, 1); }
  if (!rec) return;
  rec.alarm = "off";
  rec.alarmLeft = 0;
  const to = carMiddle(rec);
  if (how) say(b, how, "info");
  fx(b, { type: "alarmoff", to, car: rec.id });
}
const lureOf = (b, rec) => (b.lures || []).find((l) => l.key === "caralarm" && l.alarm === rec.id) || null;
// Silenced from inside the car (carAct "silence"): the fuse pulled, the wires yanked.
export function silenceAlarm(b, rec, u, H) {
  if (alarmOf(rec) !== "ringing") return false;
  endAlarm(b, rec, lureOf(b, rec), "");
  (H || { say }).say(b, `${u ? u.name : "Someone"} reaches under the ${nameOf(rec)}'s dash and yanks the alarm's wires: silence.`, "good");
  return true;
}
// The start of each enemy turn (stealth.js stealthTurn): a ringing alarm pulls again and adds its Heat; one with no
// turns left rings out. The lure and the record stay in step (lure.turns = rec.alarmLeft: the enemy turns it still
// pulls; at 0 it goes quiet as the next enemy turn starts).
export function alarmTurn(b) {
  for (const lure of [...(b.lures || [])]) {
    if (lure.key !== "caralarm") continue;
    const rec = b.cars && b.cars[lure.alarm];
    if (!rec || rec.alarm !== "ringing") { endAlarm(b, null, lure, ""); continue; }
    if (!(rec.alarmLeft > 0)) { endAlarm(b, rec, lure, `The ${nameOf(rec)}'s alarm whoops a last time and cuts out.`); continue; }
    pull(b, lure);
    if (b.raid) b.raid.heat = Math.min(100, b.raid.heat + ALARM.TURN_HEAT);
    rec.alarmLeft -= 1;
    lure.turns = rec.alarmLeft;
  }
}
// For the views: the cars ringing now, { id, x, y, w, h, left } (left: the enemy turns it still pulls).
export function ringingCars(b) {
  return Object.values(b.cars || {}).filter((r) => r && r.alarm === "ringing").map((r) => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, left: r.alarmLeft || 0 }));
}

// ---------- thrown at ----------
// Something thrown that came down on a car's cell (stealth.js throwAt, no fx): a window breaks or not (THROW[key], the
// car's die), and an armed alarm goes off when one does. Returns true when a window broke.
export function throwAtCar(state, b, u, key, x, y, H) {
  const rec = recOf(state, b, carIdAt(b, x, y));
  if (!rec || !state) return false;
  const S = H || { say, fx };
  const name = nameOf(rec);
  const what = key === "emptymag" ? "The magazine" : `The ${((THROWABLES[key] && THROWABLES[key].label) || "thing").replace(/^(an?|the) /, "")}`;
  if (rec.glass) { S.say(b, `${what} goes in through the ${name}'s broken window.`, "info"); return false; }
  const chance = rec.mil || rec.model === "boxtruck" ? 0 : throwBreakChance(key);
  rec.throws = (rec.throws || 0) + 1;
  if (!(carRoll(state, b, rec.id, "throw", rec.throws, u.id) < chance)) {
    S.say(b, `${what} ${key === "bottle" ? "bursts on" : "bounces off"} the ${name}'s ${rec.mil ? "armoured glass" : "windscreen"}: the glass holds.`, "info");
    return false;
  }
  breakGlass(b, rec);
  const [cx, cy] = carMiddle(rec);
  pull(b, { x: cx, y: cy, key: "glass", turns: 1, radius: ALARM.GLASS, side: null, sense: ["noise"] }); // the crash of it: the unaware look (not kept: it is over at once)
  S.fx(b, { type: "loot", to: [cx, cy], text: "smash", how: "glass" }); // ui/sfx-vehicles.js carLoot: breaking glass
  if (!soundAlarm(state, b, rec, S, `${what} smashes the ${name}'s side window.`)) S.say(b, `${what} smashes the ${name}'s side window${alarmOf(rec) ? "" : ": no alarm, only the crash of the glass"}.`, "info");
  return true;
}
// A window broken: the doors open by reaching in (foundcars.js isOpen), and the raid box on it with them.
export function breakGlass(b, rec) {
  rec.glass = true;
  const box = b.raid ? b.raid.containers.find((c) => c.kind === "car" && c.x === rec.x && c.y === rec.y && (c.w || 1) === rec.w && (c.h || 1) === rec.h) : null;
  if (box && box.lock && !box.lock.open) { box.lock.open = true; box.lock.how = "smash"; }
}
// A blast at (x, y) (stealth.js throwAt: a pipe bomb, a frag grenade, a flashbang): every armed car within BLAST
// tiles goes off. Without the state, only the cars someone has looked at already. Returns how many.
export function alarmsNear(state, b, x, y, fxKind) {
  if (!BLASTS.includes(fxKind)) return 0;
  const seen = new Set();
  let n = 0;
  const R = ALARM.BLAST;
  for (let yy = y - R; yy <= y + R; yy++) for (let xx = x - R; xx <= x + R; xx++) {
    const id = carIdAt(b, xx, yy);
    if (id == null || seen.has(id) || Math.hypot(xx - x, yy - y) > R + 1e-6) continue;
    seen.add(id);
    const rec = recOf(state, b, id);
    if (rec && soundAlarm(state, b, rec, null, "The blast shakes a car.")) n++;
  }
  return n;
}

// ---------- the AI (decoys.js botDecoy) ----------
// What a unit with no decoy to throw (a decoy is thrown as one: botDecoy's own rule) can throw at an armed car to pull the dead off its people: { key, x, y, n } (the
// car's middle) or null. dead: the dead pressing them (decoys.js); mine: its side's living people; keep, min: decoys.js
// LURE.AI_KEEP / AI_MIN; senses(o): does this one hear noise.
export function alarmThrowSpot(state, b, u, have, dead, mine, keep, min, hears) {
  const keys = Object.keys(ALARM.THROW).filter((k) => have[k] > 0 && THROWABLES[k] && !THROWABLES[k].decoy).sort((a, c) => throwBreakChance(c) - throwBreakChance(a));
  if (!keys.length) return null;
  const pulled = dead.filter(hears);
  if (pulled.length < min) return null;
  const ids = state ? carIds(b) : Object.keys(b.cars || {}).map(Number);
  let best = null;
  for (const id of ids) {
    const rec = recOf(state, b, id);
    if (alarmOf(rec) !== "armed" || !ledSeen(b, u, rec)) continue;
    const [x, y] = carMiddle(rec);
    if (mine.some((m) => Math.hypot(m.x - x, m.y - y) < keep)) continue;
    const n = pulled.filter((o) => Math.hypot(o.x - x, o.y - y) <= ALARM.RADIUS).length;
    if (n < min) continue;
    const d = Math.hypot(u.x - x, u.y - y);
    for (const key of keys) {
      if (d > THROWABLES[key].range + 0.01 || d < 2) continue;
      const sc = n * 10 + throwBreakChance(key) * 5 - d * 0.1;
      if (!best || sc > best.sc) best = { key, x, y, n, sc, car: id };
      break;
    }
  }
  return best;
}
