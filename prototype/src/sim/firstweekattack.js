// @ts-check
// The first week's attack (the user's requests 2026-10-28: "add a scripted raid on the base of a nomad group or horde
// at the end of the week"; "At the night of the 7th day have a scripted event to have a nomad or zombie horde raid occur
// in your base this only occurs if you have the first week guide set on the run and you accomplished doing all the other
// subquests that make sense to allow for the raid").
// - Only while the first-week guide is on (ui/guide.js, state.guide: started with the run, not brought back by hand from
//   the menu, never beside the autopilot), and only once its steps of days 1 to 6 are all done: the guide marks that
//   hour in g.ready (ui/guide.js guideCheck). Day 7's own steps (the shelter, the diary) are not needed. Not ready by the
//   end of the seventh night: no attack.
// - The warning: once ready, from the dawn of the guide's seventh day, a line in the log (fresh tracks round the base).
// - The attack: the first hour of the seventh night (FROM to TO) that the hub is ready (people at home, no fight, no
//   attack card waiting, no wave out). In this order:
//   1. NOMADS: the nearest band of drifters or looters within NOMAD_REACH that is not friendly to you (nomads.js
//      bandToRaid) has picked up your trail: it comes to the tile beside the base (bandAtBase) and a raiding party of
//      its people (half the people at home + 1, NOMADS, at most the band) comes in. Its own card: Defend (the base
//      defence battle against the band's own people, nomads.js nomadEnemy) or Hide (they carry off HIDE_TAKE of the
//      stores). Beaten off, its dead come off the band (under MIN_POP it breaks up); getting in, they carry off
//      LOST_TAKE. Either way the band moves on (bandRaidEnd).
//   2. A HORDE OF THE DEAD: the people at home + 2 (DEAD), drawn out of the land's pools within REACH tiles, the base's
//      tile first (deadpop.js drawFromTile: nothing made), as campattack.js scriptedWave: the usual camp-attack card.
//   3. The land's raiders within REACH (RAIDERS), the same way. Nothing at all: a quiet night.
// - Once a guide: state.guide.attack = { hour, base, kind: "nomads" | "dead" | "raiders", n, band? } or { hour, quiet:
//   true }; state.guide.warned = the hour of the warning. Plain data, saved with the guide; the guide's "Hold off the
//   attack" step reads them. The autopilot and the headless tools never start a guide, so they never meet it.
import { hub, homeAt, log, addCard, isNight } from "./world.js";
import { openDead, openRaiders, drawFromTile, drawRaiders } from "./deadpop.js";
import { scriptedWave } from "./campattack.js";
import { groundsWord } from "./campscout.js";
import { bandToRaid, bandAtBase, bandRaidEnd, nomadEnemy, nomadById, tierOf } from "./nomads.js";
import { fightNow } from "./defences.js";
import { registerCombatHandler } from "./combat.js";

export const FIRST_ATTACK = {
  NIGHT: 7,          // the guide's night it comes on (its last)
  FROM: 21, TO: 3,   // the hours of that night it may come: the first one the hub is ready
  NOMAD_REACH: 60,   // tiles: a band this near has picked up your trail over the week
  NOMADS: [2, 5],    // the raiding party: half the people at home + 1, within these, at most the band
  HIDE_TAKE: 0.25,   // the share of the stores a band carries off while you hide
  LOST_TAKE: 0.35,   // the share it carries off when it gets in
  REACH: 3,          // tiles round the base the dead (or the land's raiders) are drawn from
  DEAD: [3, 8],      // a horde of the dead: the people at home + 2, within these
  RAIDERS: [2, 4],   // the land's raiders: half the people at home (rounded up), within these
};
const F = FIRST_ATTACK;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const cap1 = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
/** The dawn that ends the guide's night n (06:00 of the day after its evening). @param {any} g @param {number} n */
export const nightDawn = (g, n) => (Math.floor(g.h0 / 24) + n) * 24 + 6;
// The hour window of the attack night: [21:00 of the seventh day, 03:00 after it).
const windowOf = (g) => { const dawn = nightDawn(g, F.NIGHT); return [dawn - 24 + (F.FROM - 6), dawn - (6 - F.TO)]; };
const pending = (state, base) => (state.cards || []).some((c) => c.campAttack === base.id || c.grounds === base.id || c.firstWeek === base.id);

/** Every hour (campscout.js groundsHour): the warning, then the attack. @param {any} state */
export function firstWeekHour(state) {
  const g = state.guide;
  if (!g || !g.on || g.keep || g.attack || state.gameOver || state.autopilot) return;
  const base = hub(state);
  const [from, to] = windowOf(g);
  if (state.hour >= to) { if (g.ready != null && base) g.attack = { hour: state.hour, quiet: true }; return; } // the night gone by: ready but never a quiet hour for it, a quiet night; never ready, no attack
  if (g.ready == null || !base) return; // the steps of days 1 to 6 not all done yet (ui/guide.js), or no home
  if (g.warned == null && state.hour >= from - (F.FROM - 6)) {
    g.warned = state.hour;
    log(state, `Fresh tracks round ${base.name} this morning, and something moved at the edge of the firelight last night: whoever is out there has been watching. Keep watch tonight.`, "danger");
  }
  if (state.hour < from) return;
  const people = homeAt(state, base.id).length;
  if (!people || state.combat || pending(state, base) || (base.campAttack && base.campAttack.wave)) return; // not ready: the next hour
  // 1. Nomads on your trail.
  const band = bandToRaid(state, base, F.NOMAD_REACH);
  if (band) {
    const n = Math.min(band.pop, clamp(Math.ceil(people / 2) + 1, F.NOMADS[0], F.NOMADS[1]));
    bandAtBase(state, band, base);
    g.attack = { hour: state.hour, base: base.id, kind: "nomads", band: band.id, n };
    addCard(state, nomadCard(state, band, base, n));
    return;
  }
  // 2. A horde of the dead from round about, else 3. the land's raiders.
  const tiles = state.grid.within(base.tile, F.REACH).sort((a, b) => state.grid.distance(base.tile, a) - state.grid.distance(base.tile, b));
  const deadNear = tiles.reduce((a, t) => a + openDead(state, t), 0), raidersNear = tiles.reduce((a, t) => a + openRaiders(state, t), 0);
  const raid = deadNear < F.DEAD[0] && raidersNear >= F.RAIDERS[0];
  const want = raid ? clamp(Math.ceil(people / 2), F.RAIDERS[0], F.RAIDERS[1]) : clamp(people + 2, F.DEAD[0], F.DEAD[1]);
  let got = 0;
  for (const t of tiles) { if (got >= want) break; got += raid ? drawRaiders(state, t, want - got) : drawFromTile(state, t, want - got); }
  if (!got) { g.attack = { hour: state.hour, quiet: true }; return; }
  const w = { g: 0, d: raid ? 0 : got, r: raid ? got : 0, rp: 0, poi: base.poi != null ? base.poi : null };
  g.attack = { hour: state.hour, base: base.id, kind: raid ? "raiders" : "dead", n: got };
  scriptedWave(state, base, w, {
    title: raid ? `The watchers come: raiders at ${base.name}` : `A horde of the dead comes for ${base.name}`,
    lead: raid ? "Whoever was watching the camp has come for it." : `Drawn by the fire and the noise of a week's work, the dead have been gathering in ${groundsWord(state, base.tile)}.`,
  });
}

// ---------- the nomads' raid ----------
/** The card: Defend or Hide. @param {any} state @param {any} b the band @param {any} base @param {number} n */
function nomadCard(state, b, base, n) {
  const tier = tierOf(b).name.toLowerCase();
  return {
    title: `The watchers come: ${cap1(b.name)} at ${base.name}`, firstWeek: base.id, raidReport: { baseId: base.id },
    text: `${cap1(b.name)}, ${b.pop} ${tier} on the road, have been following your trail all week. Tonight ${n} of them come over the edge of the camp for its stores.`,
    choices: [
      { label: "Defend the camp", default: true, hint: `A fight on ${base.name}'s map: whoever is home against ${n} of them. Beat them off and they leave with nothing.`, resolve: (st) => defendNomads(st, base.id) },
      { label: "Hide and let them take what they find", hint: `Everyone hides: they carry off about ${Math.round(F.HIDE_TAKE * 100)}% of the stores and go.`, resolve: (st) => hideNomads(st, base.id) },
    ],
  };
}
const raidOf = (state, baseId) => {
  const g = state.guide, a = g && g.attack;
  const base = (state.bases || []).find((x) => x.id === baseId);
  return { a, base, band: a && a.kind === "nomads" ? nomadById(state, a.band) : null };
};
/** Defend: the base defence battle against the band's people. @param {any} state @param {number} baseId */
export function defendNomads(state, baseId) {
  const { a, base, band } = raidOf(state, baseId);
  if (!base || !band) { if (base) log(state, `Whoever was out there round ${base.name} slipped away before the fight.`, "info"); return ""; }
  fightNow(state, {
    tile: base.tile, baseId: base.id, enemy: { ...nomadEnemy(state, band), count: a.n }, ambush: null, canRetreat: true, handler: "firstWeekRaid", layout: "baseDefence", downedLive: 0.4, deploy: true,
    context: { baseId: base.id, bandId: band.id, n: a.n, night: isNight(state) },
  });
  return "";
}
/** Hide: they carry off a share of the stores and go. @param {any} state @param {number} baseId */
export function hideNomads(state, baseId) {
  const { base, band } = raidOf(state, baseId);
  if (!base || !band) return "";
  const name = cap1(band.name), took = bandRaidEnd(state, band, 0, base, F.HIDE_TAKE);
  const text = `${base.name}'s people hid while ${name} went through the camp${took ? `: they carried off ${took}` : ""}.`;
  log(state, text, "danger");
  return text;
}
registerCombatHandler("firstWeekRaid", (state, result, setup) => {
  const c = setup.context;
  const base = (state.bases || []).find((x) => x.id === c.baseId);
  const band = nomadById(state, c.bandId);
  const name = band ? cap1(band.name) : setup.enemy.name;
  const won = result.outcome === "victory";
  const killed = won ? c.n : Math.min(c.n, result.enemiesKilled || 0);
  const took = bandRaidEnd(state, band, killed, base, won ? 0 : F.LOST_TAKE);
  if (won) log(state, `${base ? base.name : "The camp"} held: ${name} were beaten off${killed ? ` (${killed} of them killed)` : ""}.`, "good");
  else log(state, `${name} got into ${base ? base.name : "the camp"}${killed ? ` (${killed} of them killed)` : ""}${took ? ` and carried off ${took}` : ""}.`, "danger");
});
