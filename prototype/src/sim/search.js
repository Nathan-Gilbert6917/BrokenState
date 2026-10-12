// Searching a container on a raid map: the full search and the quick rummage (combat.js combatAct "search").
//
//   full search   1 action, always (by day or in the dark): everything inside shows in the search window. A
//                 container already gone through opens again for free. Locked: open it first (locks.js: a key, or
//                 1 action a pick attempt at the odds shown, or force), then search it.
//   quick search  no action (the survivor needs one left, and can rummage once a turn), so it fits between two
//                 moves. Only 30–50% of what is inside turns up (rolled each time, whole things: an item or a
//                 supply stack); the rest stays hidden until someone does a full search there (1 action). It is
//                 loud: Heat +5, and the unaware dead and guards within 7 tiles come to look (stealth.js noiseAt;
//                 indoors every wall or closed door between counts 3 tiles more, buildingmaps.js noiseDamp). In
//                 the dark without a light it is clumsier: 2 tiles more (9).
//                 Hands going fast in the dark of a drawer: 6% a rummage to cut a hand (broken glass, a rusty can, a
//                 needle): a few health (never down) and a cut that needs dressing (health.js "cut", milder than a
//                 wound's: it can get infected untreated). Less with Scavenging or Stealth (the better of the two:
//                 −2.5% of the chance a point, half at 20), +3 points in the dark without a light; never 10% (9% cap).
//                 No gloves in GEAR yet: when there are, they belong in quickHurtChance.
// What is hidden lives on the container (box.hidden = { sup, gear }) until the full search, so a save keeps it;
// box.quick marks a container rummaged but not searched through (its own marker on the map). The window never says
// how much is hidden: "a full search may turn up more".
//
// The raid bot (combat.js autoRaidTurn) searches in full, and rummages when pressed: Heat at SEARCH.bot.heat or more,
// an aware enemy within SEARCH.bot.near tiles, or on its way out. The hour-by-hour search (scavenge.js) is not this.
import { noiseAt } from "./stealth.js";
import { darkAt } from "./indoorlight.js"; // a raid's dark rooms
import { activeLight, nvgOn } from "./vision.js"; // the light switched on, night vision on
import { survivorById, skill } from "./world.js";
import { addCondition } from "./health.js";

export const SEARCH = {
  ap: 1, // a full search
  quick: {
    reveal: [0.3, 0.5], radius: 7, dark: 2, heat: 5,
    // A cut hand: chance a rummage = (base + dark) × (1 − perSkill × best of Scavenging/Stealth, up to skillCap), at
    // most max. hp: health lost (never below 1); sev: the cut's severity (health.js CONDITIONS.cut, a wound's 20–45).
    hurt: { base: 0.06, dark: 0.03, perSkill: 0.025, skillCap: 20, max: 0.09, hp: [2, 5], sev: [12, 25] },
  },
  bot: { heat: 40, near: 6 },
};

const things = (c) => (c ? c.gear.length + Object.values(c.sup).filter((v) => v >= 1).length : 0);
// Things in sight in a container (what the window shows).
export const shownCount = (box) => things(box && box.contents);
// Things still hidden (tests and the AI; the player's window does not show the number).
export const hiddenCount = (box) => things(box && box.hidden);

// After the contents are rolled (combat.js searchBox): hide all but 30–50% of the things. Returns the share shown.
export function hideSome(rng, box) {
  const c = box.contents;
  const list = [...c.gear.map((g) => ({ g })), ...Object.keys(c.sup).filter((k) => c.sup[k] >= 1).map((k) => ({ k }))];
  const [lo, hi] = SEARCH.quick.reveal;
  const share = lo + rng.next() * (hi - lo);
  // Rounded up or down by chance, so on average exactly that share shows (one thing: shown at that chance).
  const show = Math.min(list.length, Math.floor(share * list.length + rng.next()));
  rng.shuffle(list);
  const hidden = box.hidden || (box.hidden = { sup: {}, gear: [] });
  for (const t of list.slice(show)) {
    if (t.g) { c.gear.splice(c.gear.indexOf(t.g), 1); hidden.gear.push(t.g); }
    else { hidden.sup[t.k] = (hidden.sup[t.k] || 0) + c.sup[t.k]; delete c.sup[t.k]; }
  }
  box.quick = true;
  return { share, shown: show, total: list.length };
}

// The full search after a rummage: everything hidden shows. Returns how many things turned up.
export function revealHidden(box) {
  box.quick = false;
  const h = box.hidden;
  if (!h) return 0;
  const n = things(h);
  for (const [k, v] of Object.entries(h.sup)) if (v > 0) box.contents.sup[k] = (box.contents.sup[k] || 0) + v;
  box.contents.gear.push(...h.gear);
  box.hidden = null;
  return n;
}

// Why this unit cannot rummage through this container now ("" when it can).
export function quickRefusal(b, u, box) {
  if (!box) return "Stand next to something nobody has searched yet to rummage through it.";
  if (box.contents) return box.quick ? "Already rummaged: a full search (1 action) turns up the rest." : "Already searched: open it (free).";
  if ((u.ap || 0) < 1) return "No actions left this turn.";
  if (u.quickTurn === b.turn) return `${u.name.split(" ")[0]} has already rummaged this turn.`;
  return "";
}
// The containers next to the unit a quick search can go through (never opened, not locked).
export const quickable = (near) => near.filter((c) => !c.contents);

// Fumbling in the dark: night (or an unlit room of a raid's building: a barn by day; a room lit at night is not dark:
// indoorlight.js darkAt), and no light switched on (lights.js: a headlamp anywhere on them, or a light in the off hand)
// or night vision.
const inDark = (b, u) => (b.indoor ? darkAt(b, u.x, u.y, u.f) : !!b.night) && !activeLight(u) && !nvgOn(u);
// How far the rummage is heard (tiles), before walls.
export const quickRadius = (b, u) => SEARCH.quick.radius + (inDark(b, u) ? SEARCH.quick.dark : 0);

// The chance this unit cuts a hand rummaging now (0–SEARCH.quick.hurt.max).
export function quickHurtChance(state, b, u) {
  const H = SEARCH.quick.hurt;
  const s = u && u.sid != null ? survivorById(state, u.sid) : null;
  const sk = s ? Math.max(skill(s, "scavenging"), skill(s, "stealth")) : 0;
  const p = (H.base + (inDark(b, u) ? H.dark : 0)) * (1 - H.perSkill * Math.min(H.skillCap, sk));
  return Math.max(0, Math.min(H.max, p));
}
// "6%": the chance as the UI shows it.
export const quickHurtPct = (state, b, u) => `${Math.round(quickHurtChance(state, b, u) * 100)}%`;

const SHARPS = ["broken glass", "the lid of a rusty can", "a loose needle", "a jagged bit of tin", "a razor blade"];
// Roll the cut after a rummage. Returns { hp, what } when it happened (the caller says it in the battle log), else
// null. Never puts anyone down; the cut goes on the survivor (health.js) and stays after the raid.
export function quickHurt(state, b, u) {
  const rng = state.rng;
  if (!rng.chance(quickHurtChance(state, b, u))) return null;
  const H = SEARCH.quick.hurt;
  const what = rng.pick(SHARPS);
  const hp = Math.min(rng.int(H.hp[0], H.hp[1]), Math.max(0, Math.floor(u.hp) - 1));
  u.hp -= hp;
  const s = u.sid != null ? survivorById(state, u.sid) : null;
  if (s) addCondition(state, s, "cut", `on ${what}, rummaging in a hurry${b.place ? ` at ${b.place}` : ""}`, { sev: rng.int(H.sev[0], H.sev[1]), cause: "search" });
  return { hp, what };
}

// The noise of a rummage: Heat, and the unaware within earshot come to look. Returns how many turned to it.
export function quickNoise(b, u, box) {
  if (b.raid) b.raid.heat = Math.min(100, b.raid.heat + SEARCH.quick.heat);
  u.quickTurn = b.turn;
  return noiseAt(b, box.x, box.y, quickRadius(b, u), "rummage");
}

// The bot: is it pressed for time (rummage instead of a full search)?
export function botPressed(b, u, leaving) {
  if (leaving || b.raid.heat >= SEARCH.bot.heat) return true;
  const near = SEARCH.bot.near;
  return b.units.some((e) => e.side === "enemy" && e.aware && !e.dead && !e.down && !e.fled && Math.hypot(e.x - u.x, e.y - u.y) <= near);
}

// The bot's take after a rummage: only what the free hauling allows (HAUL.free), so it keeps its actions to move on.
export function takeFree(u, take) {
  const ap = u.ap;
  u.ap = 0;
  try { return take(); } finally { u.ap = ap; }
}
