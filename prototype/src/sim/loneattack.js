// Attacked alone (the user's request 2026-10-19): one of your people out of the walls on their own, set upon by the
// dead or by the worm's dead animals (deadbeasts.js), fought on the battle map by that one person with what they have
// on them, and nothing else: no stores to draw rounds from, no team at their back.
//   - A worker on a job trip (jobtrips.js: wood, forage, hunt, fish, scavenge, water) whose trip's trouble is the dead
//     (tripevents.js kind "dead") or the dead beasts of the land (kind "deadbeast": by deadbeasts.js beastMix). At a
//     base you run yourself the card "<name> was attacked by …" comes up (tripevents.js raiseCard → attackCard here);
//     the governor's and a leader's bases settle it by the numbers as before.
//   - A team moving on foot: now and then one of them drops back (a bootlace, a look at something in the ditch, a
//     call of nature) and the dead or the dead beasts come out at them before the rest can help (events.js "straggler",
//     stragglerCard here).
// The card's buttons: "Save and fight" (the fight opens and the game is saved as it stands: main.js choice →
// ui/settings.js saveBeforeFight; an Ironman game saves itself as every battle opens), "Fight" (the battle map: the
// one person, their own gear and the rounds in and on their gun: combat.js setup.afield), and the old way (by the
// numbers: the trip's own good sense, tripevents.js settle; a team's straggler fought out by the numbers: combat.js
// autoResolveCombat through setup.quick). The handlers (tripAttack, straggler) write the outcome back: the trip goes
// on, is cut short or ends with them; the team walks on, one lighter now and then.
// Numbers in LONE. The enemy of a lone fight (loneEnemy): 1–3 of the dead (more on infected ground), or 1–3 dead beasts
// of the tile's likeliest kind (packs of dogs and cats up to 3, the big ones up to 2), at the land's power (2 + 3 ×
// Infection, + a hive's toughness). Dice: the caller's (a trip's own Rng, a card's state.rng).
import { ZTYPES } from "./hiveconst.js";
import { beastMix } from "./deadbeasts.js";
import { startCombat, registerCombatHandler } from "./combat.js";
import { survivorById, log, hub } from "./world.js";
import { partyMembers, partyTile, tileLabel } from "./parties.js";
import { zombieToughness } from "./hives.js";
import { settleBattle } from "./tripevents.js";
import { namesText } from "./teamwork.js"; // a job trip's crew attacked together

export const LONE = {
  ROAD: 0.9,          // the straggler card's weight among a team's travel cards (× 1 + 2 × Infection)
  ROAD_MIN_INF: 0.08, // ... on ground at least this infected, or anywhere the dead beasts are
  DEAD: [1, 3],       // of the dead at once
  PACK: [1, 3],       // dead dogs and cats at once; the big beasts BIG
  BIG: [1, 2],
  BEAST_ODDS: 4,      // × the beasts' share of the tile's dead: the chance the attack is theirs (at most BEAST_MAX)
  BEAST_MAX: 0.6,
};
const first = (s) => String(s && s.name ? s.name : s || "").split(" ")[0];

// ---------- what comes at one person ----------
// { kind: "zombies", count, power, name, types?, mix?, beast? }. prefer: "dead" | "beast" | null (the dice decide).
export function loneEnemy(state, tileId, rng, prefer = null) {
  const t = state.tiles[tileId] || {};
  const inf = t.infection || 0;
  const power = Math.round((2 + inf * 3 + zombieToughness(state, tileId)) * 10) / 10;
  const bm = beastMix(state, tileId);
  const share = bm ? Object.values(bm).reduce((a, v) => a + v, 0) : 0;
  const beast = prefer === "beast" ? !!bm : prefer === "dead" ? false : !!bm && rng.chance(Math.min(LONE.BEAST_MAX, share * LONE.BEAST_ODDS));
  if (beast) {
    const kinds = Object.keys(bm);
    const kind = kinds.length === 1 ? kinds[0] : rng.weighted(kinds, (k) => bm[k]);
    const pack = kind === "deadhound" || kind === "deadcat";
    const [lo, hi] = pack ? LONE.PACK : LONE.BIG;
    const count = rng.int(lo, hi);
    return { kind: "zombies", count, power, name: beastWords(kind, count), types: { [kind]: count }, mix: { [kind]: 1 }, beast: kind };
  }
  const count = Math.min(LONE.DEAD[1], LONE.DEAD[0] + (rng.chance(0.5 + inf * 0.3) ? 1 : 0) + (rng.chance(0.25 + inf * 0.4) ? 1 : 0));
  return { kind: "zombies", count, power, name: count === 1 ? "one of the dead" : `${count} of the dead` };
}
export const beastWords = (kind, n) => { const w = ZTYPES[kind].name.toLowerCase(); return n === 1 ? `a ${w}` : `${n} ${w}s`; };

// ---------- the card ----------
// o: { where, title?, text, byNumbers: { label, hint, resolve }, setup (combat.js: the lone fight's setup; its handler
// writes the outcome back), tags (fields on the card: a trip's tripEv / tripEvAt, a team's partyId), crew? (a job trip's
// crew, teamwork.js: everyone attacked together, named on the card) }.
export function attackCard(state, s, enemy, o) {
  const many = Array.isArray(o.crew) && o.crew.length > 1;
  const name = many ? namesText(o.crew) : first(s);
  const fight = (st) => { startCombat(st, o.setup); return ""; };
  const what = many ? `${name}, together, each with what they carry` : `${name}, alone, with what they carry`;
  const choices = [
    { label: "Save and fight", hint: `The game is saved as the fight opens, then the battle map: ${what}.`, uiAction: { type: "saveFight", name: `Attacked: ${name}, ${o.where}` }, ai: () => 1, resolve: fight },
    { label: "Fight", hint: `The battle map: ${what}.`, ai: () => 1, resolve: fight },
    { label: o.byNumbers.label, hint: o.byNumbers.hint, default: true, ai: () => 5, resolve: o.byNumbers.resolve },
  ];
  return { title: o.title || `${name} ${many ? "were" : "was"} attacked by ${enemy.name}`, text: o.text, where: o.where, attack: { sid: s.id, enemy: enemy.name, ...(many ? { sids: o.crew.map((x) => x.id) } : {}) }, ...(o.tags || {}), choices };
}

// ---------- a worker on a job trip (tripevents.js raiseCard) ----------
// The setup of the worker's fight: at the trip's tile, the base's for the loot and the record, but afield: no stock
// to draw on, only what is on them (combat.js combatants: named fighters take part wherever they stand). crew (teamwork.js:
// "attacked together"): everyone of the crew on the map, each with what they carry; the dead already scaled to them.
export function tripAttackSetup(state, base, s, t, enemy, crew = [s]) {
  const ids = crew.map((x) => x.id);
  const many = ids.length > 1;
  return {
    tile: t.at, baseId: base.id, fighterIds: ids, afield: true, enemy,
    ambush: "enemy", canRetreat: true, handler: "tripAttack", context: { sid: s.id, baseId: base.id, at: t.ev.at, lone: !many, ...(many ? { sids: ids } : {}) },
    ...(many ? { intro: `${namesText(crew, true)} fight together, out on the land with what they carry.` } : {}),
  };
}
function onTripAttack(state, result, setup) {
  const c = setup.context;
  const s = survivorById(state, c.sid);
  const base = state.bases.find((b) => b.id === c.baseId);
  const t = s && s.trip;
  if (!base || !t || !t.ev || t.ev.at !== c.at) { const live = (c.sids || [c.sid]).map((id) => survivorById(state, id)).filter((x) => x && x.alive); if (live.length) log(state, `${namesText(live, true)} fought off ${setup.enemy.name}.`, "info"); return; }
  settleBattle(state, base, s, t, result, setup.enemy); // tripevents.js: the trip goes on, is cut short, or ended with them
}
registerCombatHandler("tripAttack", onTripAttack);

// ---------- a team on foot (events.js "straggler") ----------
export const stragglerFits = (state, p, t) => p.vehicle !== true && partyMembers(state, p).length >= 1 && ((t.infection || 0) >= LONE.ROAD_MIN_INF || !!beastMix(state, t.id));
export function stragglerCard(state, p, t) {
  const rng = state.rng;
  const members = partyMembers(state, p);
  const s = rng.pick(members);
  const enemy = loneEnemy(state, t.id, rng);
  const where = tileLabel(state, t.id);
  const why = rng.pick(["stopped to tie a boot", "stepped off the road for a call of nature", "went to look at something in the ditch", "dropped back to shift their pack", "lagged a bend behind"]);
  const came = enemy.beast ? `${enemy.name} came out of the ${t.terrain === "forest" ? "trees" : t.terrain === "hills" ? "rocks" : t.terrain === "city" || t.terrain === "suburb" ? "yards" : "grass"} at them` : `${enemy.name} came at them out of nowhere`;
  const text = `${s.name} ${why}${members.length > 1 ? " and fell behind" : ""}, and ${came}. ${members.length > 1 ? "The rest of the team is too far ahead to be there before it is over: it is " : "There is nobody else: it is "}${first(s)} alone, with what they have on them.`;
  const setup = {
    tile: t.id, partyId: p.id, fighterIds: [s.id], afield: true, enemy,
    ambush: "enemy", canRetreat: true, handler: "straggler", context: { sid: s.id, partyId: p.id, lone: true },
  };
  return attackCard(state, s, enemy, {
    where, text, setup, tags: { partyId: p.id },
    byNumbers: { label: "Leave it to them (by the numbers)", hint: "Fought out by the numbers: their own worth against it, no map.", resolve: (st) => { startCombat(st, { ...setup, quick: true }); return ""; } },
  });
}
function onStraggler(state, result, setup) {
  const c = setup.context;
  const s = survivorById(state, c.sid);
  const p = state.parties.find((x) => x.id === c.partyId);
  const who = s ? s.name : "One of the team";
  const dead = (result.survivorsDead || []).includes(c.sid) || !s || !s.alive;
  if (dead) { log(state, `${who} was lost to ${setup.enemy.name} on the road${p ? ` near ${tileLabel(state, partyTile(p))}` : ""}.`, "death"); return; }
  if (result.outcome === "victory") log(state, `${who} put down ${setup.enemy.name} alone${result.survivorsHurt && result.survivorsHurt.includes(c.sid) ? " and got hurt doing it" : ""}, and caught the team up.`, result.survivorsHurt && result.survivorsHurt.length ? "danger" : "good");
  else if (result.outcome === "retreat") log(state, `${who} ran from ${setup.enemy.name} and caught the team up.`, "info");
  else log(state, `${who} got away from ${setup.enemy.name}, hurt.`, "danger");
}
registerCombatHandler("straggler", onStraggler);

// The hub's name for a log line where nothing else fits.
export const homeName = (state) => { const h = hub(state); return h ? h.name : "home"; };
