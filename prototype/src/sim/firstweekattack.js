// @ts-check
// The first week's attack (the user's requests 2026-10-28: "add a scripted raid on the base of a nomad group or horde
// at the end of the week"; "this only occurs if you have the first week guide set on the run and you accomplished doing
// all the other subquests that make sense to allow for the raid"; "If the attack happens at night have it be a zombie
// horde if it is in the day have it be a nomad group. And don't base it off an AI group just spawn in a horde or nomad
// group to attack. The attack can happen anytime on the 7th day after the prerequisites are finished").
// - Only while the first-week guide is on (ui/guide.js, state.guide: started with the run, not brought back by hand from
//   the menu, never beside the autopilot), and only once the guide's steps it waits for are done (ui/guide.js GUIDE_READY:
//   the camp, work priorities, a team out, a raid, a team home, the shack placed, a lookout or a defence; none a tool can
//   hold up): the guide marks that hour in g.ready (guideCheck).
// - Its hour: once ready, an hour picked by the seed between then (no sooner than the seventh dawn) and LAST hours
//   before the eighth (g.attackAt), with a warning in the log as it is picked. Not ready by then: no attack.
// - The attack: at that hour, or the first one after it that the hub is ready (people at home, no fight, no attack card
//   waiting, no wave out), until the window closes:
//   - BY DAY (06:00 to 20:00): A NOMAD BAND, made for it (nomads.js spawnNomads: looters, hostile), on the tile beside
//     the base, as many as half the fit people at home + 1 (NOMADS). Its own card: Defend (the base defence battle against
//     the band's people, nomads.js nomadEnemy) or Hide (they carry off HIDE_TAKE of the stores into their own). Beaten
//     off, its dead come off the band (under its minimum it breaks up); getting in, it carries off LOST_TAKE. Either way
//     the band moves on (bandRaidEnd) and lives on as any band.
//   - BY NIGHT: A HORDE OF THE DEAD, made for it: 2 + the armed fit people at home + half the unarmed (DEAD; fit: health
//     FIT or more), as campattack.js scriptedWave (the camp-attack card, its text the horde's own). The ones left standing stay on the land round the base (settleWave puts them on the tile).
// - Once a guide: state.guide.attackAt (the hour picked), .warned, .attack = { hour, base, kind: "nomads" | "dead", n,
//   band? } or { hour, quiet: true } (the window closed with the hub never ready). Plain data, saved with the guide; the
//   guide shows its "Hold off the attack" step from the hour it comes. The autopilot and the headless tools never start
//   a guide, so they never meet it.
import { hub, homeAt, log, addCard, isNight } from "./world.js";
import { hash01 } from "./skills.js";
import { scriptedWave } from "./campattack.js";
import { groundsWord } from "./campscout.js";
import { spawnNomads, bandAtBase, bandRaidEnd, nomadEnemy, nomadById, tierOf } from "./nomads.js";
import { fightNow } from "./defences.js";
import { registerCombatHandler } from "./combat.js";

export const FIRST_ATTACK = {
  NIGHT: 7,          // the guide's day it comes on (its last), and the night after it
  LAST: 3,           // hours before the eighth dawn: the last hour it may be picked for or come
  NOMADS: [3, 4],    // a nomad band: half the fit people at home + 1, within these (the playtest 2026-10-28: 2 was a non-event, 5 too many for an unarmed crew)
  HIDE_TAKE: 0.25,   // the share of the stores a band carries off while you hide
  LOST_TAKE: 0.35,   // the share it carries off when it gets in
  DEAD: [3, 6],      // a horde of the dead: 2 + the armed fit people at home + half the unarmed ones, within these (the playtest: people + 3 overran a worn, mostly unarmed crew)
  FIT: 50,           // health a defender needs to count
};
const F = FIRST_ATTACK;
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const cap1 = (s) => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
/** The dawn that ends the guide's night n (06:00 of the day after its evening). @param {any} g @param {number} n */
export const nightDawn = (g, n) => (Math.floor(g.h0 / 24) + n) * 24 + 6;
// The window: [the seventh dawn, LAST hours before the eighth).
const windowOf = (g) => { const end = nightDawn(g, F.NIGHT); return [end - 24, end - F.LAST]; };
const pending = (state, base) => (state.cards || []).some((c) => c.campAttack === base.id || c.grounds === base.id || c.firstWeek === base.id);

/** Every hour (campscout.js groundsHour): the hour picked, then the attack. @param {any} state */
export function firstWeekHour(state) {
  const g = state.guide;
  if (!g || !g.on || g.keep || g.attack || state.gameOver || state.autopilot) return;
  const base = hub(state);
  const [from, to] = windowOf(g);
  if (state.hour >= to) { if (g.attackAt != null) g.attack = { hour: state.hour, quiet: true }; return; } // picked, but the hub never ready for it
  if (g.ready == null || !base || state.hour < from) return; // the steps of days 1 to 6 not all done (ui/guide.js), no home, or not day 7 yet
  if (g.attackAt == null) {
    const start = Math.max(state.hour, from);
    g.attackAt = start + Math.floor(hash01(state.seed, "firstweek", g.h0) * Math.max(1, to - start));
    g.warned = state.hour;
    log(state, `Fresh tracks round ${base.name}, and too many crows over ${groundsWord(state, base.tile)}: something is coming before the week is out. Put someone on Guard and hand out what weapons you have.`, "danger");
  }
  if (state.hour < g.attackAt) return;
  const home = homeAt(state, base.id), people = home.length;
  const fit = home.filter((s) => (s.health ?? 100) >= F.FIT), armed = fit.filter((s) => s.gear && (s.gear.weapon || s.gear.sidearm)).length;
  if (!people || state.combat || pending(state, base) || (base.campAttack && base.campAttack.wave)) return; // not ready: the next hour
  if (!isNight(state)) {
    // By day: a nomad band, made for it, beside the base.
    const n = clamp(Math.ceil(fit.length / 2) + 1, F.NOMADS[0], F.NOMADS[1]);
    const band = spawnNomads(state, { tier: 1, tile: base.tile, pop: n });
    if (band) {
      band.goodwill = Math.min(band.goodwill, -50);
      band.known = true;
      bandAtBase(state, band, base);
      g.attack = { hour: state.hour, base: base.id, kind: "nomads", band: band.id, n };
      addCard(state, nomadCard(state, band, base, n));
      return;
    }
  }
  // By night (or no band could be made): a horde of the dead, made for it.
  const n = clamp(2 + armed + Math.floor((fit.length - armed) / 2), F.DEAD[0], F.DEAD[1]);
  g.attack = { hour: state.hour, base: base.id, kind: "dead", n };
  scriptedWave(state, base, { g: 0, d: n, r: 0, rp: 0, poi: base.poi != null ? base.poi : null }, {
    title: `A horde of the dead comes for ${base.name}`,
    text: `Drawn by the fire and the noise of a week's work, a horde of ${n} dead has gathered in ${groundsWord(state, base.tile)} after dark, and now it comes for ${base.name}.`,
  });
}

// ---------- the nomads' raid ----------
/** The card: Defend or Hide. @param {any} state @param {any} b the band @param {any} base @param {number} n */
function nomadCard(state, b, base, n) {
  const tier = tierOf(b).name.toLowerCase();
  return {
    title: `Nomads at ${base.name}: ${cap1(b.name)}`, firstWeek: base.id, raidReport: { baseId: base.id },
    text: `${cap1(b.name)}, ${n} ${tier} on the road, have been following your tracks for days. Now they come over the edge of the camp in broad daylight for its stores.`,
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
