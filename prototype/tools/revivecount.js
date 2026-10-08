// How often the downed are revived in whole battles the AI plays on both sides (AI plays my side against raiders,
// soldiers and militia), and where the meds went: a short measurement for the medics' balance (sim/medics.js).
// Your side: 4 people, two with a med kit, MEDS meds in the pool; the enemy: COUNT people of POWER, one of them a medic.
// Prints, for each side: times down, revive tries and successes, stabilized, meds (or kit uses) spent healing the
// standing, meds left at the end; and raiders/zealots finishing your downed.
// Usage: node tools/revivecount.js [battles per kind, default 12] [meds, default 6] [enemies, default 4] [their power, default 3]
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { createBattle, registerCombatHandler, autoPlayerTurn, runEnemyPhase, endBattleNow, medsLeft } from "../src/sim/combat.js";
import * as MED from "../src/sim/medics.js";
import { newItem } from "../src/sim/inventory.js";

const N = Number(process.argv[2] || 12);
const MEDS = Number(process.argv[3] || 6);
const COUNT = Number(process.argv[4] || 4), POWER = Number(process.argv[5] || 3); // the enemy: how many, how strong
registerCombatHandler("revivecount", () => {});
const KINDS = ["raiders", "soldiers", "militia", "zealots"];
const zero = () => ({ battles: 0, won: 0, down: 0, revTry: 0, revived: 0, stab: 0, heals: 0, selfMeds: 0, medsLeft: 0, finished: 0, foeDown: 0, foeRevTry: 0, foeRevived: 0, foeHeals: 0, errors: 0 });
const all = {};
for (const kind of KINDS) {
  const t = (all[kind] = zero());
  for (let i = 0; i < N; i++) {
    try {
      const st = createWorld({ seed: 500 + i, factionCount: 4 });
      const h = hub(st);
      h.stock.ammo = 80; h.stock.meds = MEDS;
      const people = atBase(st, h.id).slice(0, 4);
      people.forEach((x, k) => { x.health = 100; if (k < 2) x.gear.tool = newItem(k ? "bandagekit" : "traumakit"); });
      const f = st.factions.find((x) => x.alive && x.bases && x.bases.length);
      const b = createBattle(st, { tile: h.tile, baseId: h.id, fighterIds: people.map((x) => x.id), enemy: { kind, count: COUNT, power: POWER, factionId: f.id, name: f.name }, ambush: null, canRetreat: true, handler: "revivecount", context: {} });
      st.combat = b;
      const es = b.units.filter((u) => u.side === "enemy" && u.kind === "human");
      if (es[0] && !MED.isMedic(es[0])) MED.makeEnemyMedic(es[0], "traumakit", 5);
      for (let turn = 0; turn < 40 && !b.over; turn++) { autoPlayerTurn(st, { retreat: false }); runEnemyPhase(st); }
      t.medsLeft += medsLeft(b);
      if (!b.over) endBattleNow(st, "defeat");
      if (b.result && b.result.outcome === "victory") t.won++;
      for (const l of b.log) {
        const s = l.text, mine = l.k === "good" || (l.k === "info" && /cannot bring/.test(s));
        if (/is down and bleeding/.test(s)) t.down++;
        if (/goes down, bleeding/.test(s)) t.foeDown++;
        if (/back on their feet/.test(s)) { if (l.k === "good") { t.revTry++; t.revived++; } else { t.foeRevTry++; t.foeRevived++; } }
        if (/cannot bring .* round/.test(s)) { if (mine) t.revTry++; else t.foeRevTry++; }
        if (/stabilizes |: stabilized\./.test(s) && l.k === "good") t.stab++;
        if (/treats .* with the/.test(s)) { if (l.k === "good") t.heals++; else t.foeHeals++; }
        if (/patches up their own wounds/.test(s)) t.selfMeds++;
        if (/finishes .* off|with a shot \(/.test(s) && l.k === "death") t.finished++;
      }
      t.battles++;
    } catch (e) { t.errors++; console.log(e.stack.split("\n").slice(0, 4).join(" ")); }
  }
}
const sum = zero();
for (const kind of KINDS) for (const k of Object.keys(sum)) sum[k] += all[kind][k];
const row = (name, t) => console.log(`${name.padEnd(9)} ${String(t.battles).padStart(3)} battles, won ${t.won} | yours: down ${t.down}, revive tries ${t.revTry}, revived ${t.revived}, stabilized ${t.stab}, medic heals ${t.heals}, plain self-heals ${t.selfMeds}, meds left ${(t.medsLeft / Math.max(1, t.battles)).toFixed(1)}/battle, finished by them ${t.finished} | theirs: down ${t.foeDown}, revive tries ${t.foeRevTry}, revived ${t.foeRevived}, medic heals ${t.foeHeals}${t.errors ? ` | ERRORS ${t.errors}` : ""}`);
console.log(`Revives in AI-played battles (meds ${MEDS}, ${N} a kind, ${COUNT} enemies of power ${POWER})`);
for (const kind of KINDS) row(kind, all[kind]);
row("all", sum);
process.exit(sum.errors ? 1 : 0);
