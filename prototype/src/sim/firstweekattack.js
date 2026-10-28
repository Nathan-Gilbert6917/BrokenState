// @ts-check
// The first week's attack (the user's request 2026-10-28: "Maybe add a scripted raid on the base of a nomad group or
// horde at the end of the week"): while the first-week guide is on (ui/guide.js, state.guide: started with the run, not
// brought back by hand from the menu), the week ends with one attack on your hub, so a new player meets a base defence
// with a week to get ready for it.
// - The warning: at the dawn of the guide's seventh day, a line in the log (fresh tracks round the base).
// - The attack: the first hour of the seventh night (FROM to TO) that the hub is ready (people at home, no fight, no
//   attack card waiting, no wave out). A band of raiders when the land within REACH tiles holds some (and, with the dead
//   about too, by the seed's dice), else a pack of the dead: sized to the people at home (RAIDERS, DEAD), and drawn out
//   of the land's pools as any wave is (deadpop.js drawFromTile, drawRaiders; docs/adr/0001: nothing is made), the base's
//   tile first. It comes as campattack.js scriptedWave: the usual card (Defend the camp: the base defence battle; or hide
//   / keep out of their way) and the usual settling, whatever the walls (a camp attack would be cut down at a hub's
//   walls by the numbers). Nothing within reach: a quiet night, nothing made.
// - Once a guide: state.guide.attack = { hour, base, kind: "raiders" | "dead", n } or { hour, quiet: true };
//   state.guide.warned = the hour of the warning. Plain data, saved with the guide; the guide's "Hold off the attack"
//   step reads them. The autopilot and the headless tools never start a guide, so they never meet it.
import { hub, homeAt, log } from "./world.js";
import { hash01 } from "./skills.js";
import { openDead, openRaiders, drawFromTile, drawRaiders } from "./deadpop.js";
import { scriptedWave } from "./campattack.js";
import { groundsWord } from "./campscout.js";

export const FIRST_ATTACK = {
  NIGHT: 7,          // the guide's night it comes on (its last)
  FROM: 21, TO: 3,   // the hours of that night it may come: the first one the hub is ready
  REACH: 2,          // tiles round the base the attackers are drawn from
  DEAD: [3, 8],      // a pack of the dead: the people at home + 2, within these
  RAIDERS: [2, 4],   // a raider band: half the people at home (rounded up), within these
  RAID_SHARE: 0.5,   // with both about, the seed's chance of raiders
};
const F = FIRST_ATTACK;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
/** The dawn that ends the guide's night n (06:00 of the day after its evening). @param {any} g @param {number} n */
export const nightDawn = (g, n) => (Math.floor(g.h0 / 24) + n) * 24 + 6;
// The hour window of the attack night: [21:00 of the seventh day, 03:00 after it).
const windowOf = (g) => { const dawn = nightDawn(g, F.NIGHT); return [dawn - 24 + (F.FROM - 6), dawn - (6 - F.TO)]; };
const pending = (state, base) => (state.cards || []).some((c) => c.campAttack === base.id || c.grounds === base.id);

/** Every hour (campscout.js groundsHour): the warning, then the attack. @param {any} state */
export function firstWeekHour(state) {
  const g = state.guide;
  if (!g || !g.on || g.keep || g.attack || state.gameOver || state.autopilot) return;
  const base = hub(state);
  const [from, to] = windowOf(g);
  if (g.warned == null && state.hour >= from - (F.FROM - 6) && state.hour < to && base) {
    g.warned = state.hour;
    log(state, `Fresh tracks round ${base.name} this morning, and something moved at the edge of the firelight last night: whoever is out there has been watching. Keep watch tonight.`, "danger");
  }
  if (state.hour < from) return;
  if (state.hour >= to || !base) { g.attack = { hour: state.hour, quiet: true }; return; } // the night passed (or no home to come at)
  const people = homeAt(state, base.id).length;
  if (!people || state.combat || pending(state, base) || (base.campAttack && base.campAttack.wave)) return; // not ready: the next hour
  const tiles = state.grid.within(base.tile, F.REACH).sort((a, b) => state.grid.distance(base.tile, a) - state.grid.distance(base.tile, b));
  const raidersNear = tiles.reduce((a, t) => a + openRaiders(state, t), 0), deadNear = tiles.reduce((a, t) => a + openDead(state, t), 0);
  const raid = raidersNear >= F.RAIDERS[0] && (deadNear < F.DEAD[0] || hash01(state.seed, "firstweek", base.id) < F.RAID_SHARE);
  const want = raid ? clamp(Math.ceil(people / 2), F.RAIDERS[0], F.RAIDERS[1]) : clamp(people + 2, F.DEAD[0], F.DEAD[1]);
  let got = 0;
  for (const t of tiles) { if (got >= want) break; got += raid ? drawRaiders(state, t, want - got) : drawFromTile(state, t, want - got); }
  if (!got) { g.attack = { hour: state.hour, quiet: true }; return; }
  const w = { g: 0, d: raid ? 0 : got, r: raid ? got : 0, rp: 0, poi: base.poi != null ? base.poi : null };
  g.attack = { hour: state.hour, base: base.id, kind: raid ? "raiders" : "dead", n: got };
  scriptedWave(state, base, w, {
    title: raid ? `The watchers come: raiders at ${base.name}` : `The dead come for ${base.name} in the night`,
    lead: raid ? "Whoever was watching the camp has come for it." : `Drawn by the fire and the noise of a week's work, the dead have been gathering in ${groundsWord(state, base.tile)}.`,
  });
}
