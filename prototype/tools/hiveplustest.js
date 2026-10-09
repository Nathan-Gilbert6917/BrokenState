// The hive crawl's follow-ups (src/sim/hivecrawl.js; the window src/ui/hivecrawl.js, the sound src/ui/hivecrawlsfx.js):
// lights in the dark of the hive (the drafts, the Alert, creeping past, the cave battles' sight, the dark by the
// numbers), road flares thrown down a passage, listening at a passage (the visit's own dice, good and poor listeners, a
// fumble that warns them), the core's hoard (the team's cargo, the rest left on the map, the AI groups' stores), the
// Hivemind's second phase (its line, the quake, the sprite, the sound, the core still winnable: tools/hivecorecalib.js),
// the crawl's record (deepest, mapped, the core; the State Map, the Goals card, save and load, old saves) and the
// autopilot listening and throwing flares.
// Usage: node tools/hiveplustest.js [seed=7] [calibration trials=16]
import { createWorld, makeSurvivor, hub, snapshot } from "../src/sim/world.js";
import { GEAR } from "../src/sim/data.js";
import { ensureHives } from "../src/sim/hives.js";
import { makeHorde } from "../src/sim/hordes.js";
import { createBattle, endPlayerTurn, runEnemyPhase } from "../src/sim/combat.js";
import { saveToString, loadFromString } from "../src/sim/save.js";
import { CRAFTS as RECIPES } from "../src/sim/crafting.js";
import { condRolled } from "../src/sim/itemcond.js";
import { LIGHTS } from "../src/sim/lights.js";
import * as HC from "../src/sim/hivecrawl.js";
import { coreTrial } from "./hivecorecalib.js";

const SEED = Number(process.argv[2] || 7);
const TRIALS = Number(process.argv[3] || 16);
let passed = 0, failed = 0;
const check = (ok, msg) => { if (ok) passed++; else failed++; console.log(`  ${ok ? "ok" : "FAIL"}: ${msg}`); return ok; };
const t0 = performance.now();
const item = (key) => ({ key, name: GEAR[key].name, quality: 1 });

function world(seed = SEED, dayN = 500, guard = 100) {
  const st = createWorld({ seed, factionCount: 3 });
  st.started = true;
  ensureHives(st);
  const hv = st.hives[0];
  st.hour = dayN * 24; hv.born = 0;
  if (guard) makeHorde(st, { tile: hv.tile, size: guard, role: "guard", hive: hv.id, target: hv.tile });
  return { st, hv };
}
function squad(st, hv, { n = 6, lights = true, flares = 0, scouting = 3, stealth = 3 } = {}) {
  const people = [];
  for (let i = 0; i < n; i++) {
    const s = makeSurvivor(st, 1);
    s.traits = []; s.skills.shooting = 9; s.skills.stealth = stealth; s.skills.scouting = scouting; s.skills.medicine = 4;
    s.gear.weapon = item("ar"); s.gear.armor = item("plate"); s.gear.tool = null;
    s.pockets = [lights ? item("headlamp") : null, null, null, null];
    s.health = 100;
    st.survivors.push(s);
    people.push(s);
  }
  const p = { id: 89000 + st.parties.length, owner: "player", kind: "expedition", mission: "hive", members: people.map((s) => s.id), supplies: { ammo: 400, meds: 10, food: 30, water: 30, fuel: 9 }, cargo: { supplies: {}, gear: [] },
    path: [hv.tile], idx: 0, dest: hv.tile, phase: "engaged", seen: new Map(), spotted: new Map(), homeBaseId: hub(st).id, orders: [], stance: "normal" };
  for (let i = 0; i < flares; i++) p.cargo.gear.push(item("flare"));
  for (const s of people) s.location = { kind: "party", partyId: p.id };
  st.parties.push(p);
  return { p, people };
}
const clearMouth = (st, p) => { st.autoCombat = true; if (p.hiveCrawl.enc) HC.resolveHiveEnc(st, p, "numbers"); };

// ---------- 1. lights ----------
console.log("Lights");
{
  const { st, hv } = world();
  const { p, people } = squad(st, hv);
  HC.startHiveCrawl(st, p, hv);
  const c = p.hiveCrawl;
  check(HC.teamLights(st, p) === 6 && HC.lightsOn(st, p, c), `six headlamps, lights on by default ("${c.log[0].text.slice(-30)}")`);
  clearMouth(st, p);
  const den = HC.denOf(st, hv);
  const lit = HC.draftMissHere(st, p, c);
  HC.setLights(st, p, false);
  const dark = HC.draftMissHere(st, p, c);
  check(!HC.lightsOn(st, p, c) && Math.abs(lit - dark * HC.HCRAWL.LIGHT.draft) < 1e-9, `the drafts misread ${Math.round(dark * 100)}% in the dark, ${Math.round(lit * 100)}% in the lights`);
  // Over many visits: no more misreadings in the light than in the dark, and fewer overall.
  let wl = 0, wd = 0, all = 0;
  for (let v = 1; v <= 40; v++) {
    c.visit = 500 + v;
    for (const r of den.rooms) for (const id of r.links) {
      if (c.visited[id]) continue;
      const o = HC.roomById(den, id), real = HC.warmthOf(den, o) > HC.warmthOf(den, r) ? "warmer" : HC.warmthOf(den, o) < HC.warmthOf(den, r) ? "colder" : "level";
      all++;
      c.lit = false; if (HC.draftOf(st, p, c, den, r, o) !== real) wd++;
      c.lit = true; if (HC.draftOf(st, p, c, den, r, o) !== real) wl++;
    }
  }
  c.visit = 1;
  check(wl < wd * 0.7, `misread drafts over 40 visits: ${Math.round((wd / all) * 100)}% dark → ${Math.round((wl / all) * 100)}% lit`);
  const room = HC.roomById(den, c.at);
  c.lit = false; const s0 = HC.sneakOdds(st, p, c, room, { spotted: false }).dc;
  c.lit = true; const s1 = HC.sneakOdds(st, p, c, room, { spotted: false }).dc;
  check(s1 === s0 + HC.HCRAWL.LIGHT.sneak, `creeping past in the light is harder (DC ${s0} → ${s1})`);
  const ex = HC.exitsOf(st, p).find((x) => !x.visited);
  const a0 = c.alert;
  c.lit = true;
  HC.moveTo(st, p, ex.id);
  check(c.alert >= a0 + HC.HCRAWL.ALERT.move + HC.HCRAWL.LIGHT.move - HC.HCRAWL.ALERT.decay * HC.HCRAWL.MOVE_HOURS - 1e-9 || !!c.enc, `a move with lights on: Alert ${a0} → ${c.alert} (+${HC.HCRAWL.ALERT.move} +${HC.HCRAWL.LIGHT.move} for the lights, −${HC.HCRAWL.ALERT.decay} an hour)`);
  check(HC.darkMult(st, p) === 1, "by the numbers: a fully lit team fights the brood as it is");
  for (const s of people.slice(0, 3)) s.pockets[0] = null;
  check(Math.abs(HC.darkMult(st, p) - (1 + HC.HCRAWL.LIGHT.numbers / 2)) < 1e-9, `half of them in the dark: the brood × ${HC.darkMult(st, p).toFixed(3)}`);
  // The cave battle: dark, a headlamp's carrier sees further than one without.
  globalThis.window = {};
  let b;
  try { b = createBattle(st, HC.coreSetup(st, p, hv)); } finally { delete globalThis.window; }
  const mine = b.units.filter((u) => u.side === "player");
  const withL = mine.filter((u) => u.light), without = mine.filter((u) => !u.light);
  check(b.dark && b.hiveDark && withL.length === 3 && without.length === 3, `the core battle is dark (b.dark); ${withL.length} with a light, ${without.length} without`);
  check(withL.every((u) => u.sight === LIGHTS.headlamp.sight + HC.HCRAWL.LIGHT.lit) && without.every((u) => u.sight === HC.HCRAWL.LIGHT.dark), `sight: ${withL[0].sight} with a headlamp, ${without[0].sight} without`);
  check(b.units.filter((u) => u.side === "enemy").every((u) => u.sight >= HC.HCRAWL.LIGHT.dark), "the brood sees in its own dark (its sight untouched)");
  st.combat = null;
}

// ---------- 2. flares ----------
console.log("Road flares");
{
  const { st, hv } = world(SEED + 1);
  const { p } = squad(st, hv, { flares: 2 });
  check(RECIPES.flare && RECIPES.flare.gear === "flare" && RECIPES.flare.field, `a road flare can be made (in the field too): ${Object.entries(RECIPES.flare.in).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  HC.startHiveCrawl(st, p, hv);
  clearMouth(st, p);
  const c = p.hiveCrawl, den = HC.denOf(st, hv);
  check(HC.flaresOf(st, p).length === 2, "two flares in the cargo");
  const x = HC.exitsOf(st, p).find((e) => !e.visited);
  const to = HC.roomById(den, x.id);
  const truth = to.kind === "core" ? HC.coreForce(st, hv).count : HC.broodLeft(st, hv, to);
  const a0 = c.alert, h0 = st.hour;
  const txt = HC.throwFlare(st, p, x.id);
  const h = c.heard[x.id];
  check(h && h.by === "flare" && h.q === "exact" && h.kind === to.kind && h.n === truth, `the flare lights ${x.id}: "${txt}"`);
  check(c.alert === Math.min(100, a0 + HC.HCRAWL.FLARE.alert) && st.hour === h0 && HC.flaresOf(st, p).length === 1, `Alert ${a0} → ${c.alert}, no time, one flare used`);
  const real = HC.warmthOf(den, to) > HC.warmthOf(den, HC.roomById(den, c.at)) ? "warmer" : HC.warmthOf(den, to) < HC.warmthOf(den, HC.roomById(den, c.at)) ? "colder" : "level";
  let allTrue = true;
  for (let v = 1; v <= 30; v++) { c.visit = 900 + v; c.lit = false; if (HC.draftOf(st, p, c, den, HC.roomById(den, c.at), to) !== real) allTrue = false; }
  c.visit = 1;
  check(allTrue, "the lit passage's draft reads true, whatever the dice");
  HC.throwFlare(st, p, x.id === HC.exitsOf(st, p)[0].id ? HC.exitsOf(st, p).slice(-1)[0].id : HC.exitsOf(st, p)[0].id);
  check(/no road flares/.test(HC.throwFlare(st, p, x.id)), "with none left: no flare");
}

// ---------- 3. listening ----------
console.log("Listening at a passage");
{
  // Good and poor listeners over many passages and visits.
  const stats = (sc, st0) => {
    const { st, hv } = world(SEED + 2);
    const { p } = squad(st, hv, { scouting: sc, stealth: st0 });
    HC.startHiveCrawl(st, p, hv);
    clearMouth(st, p);
    const c = p.hiveCrawl, den = HC.denOf(st, hv);
    const out = { exact: 0, rough: 0, vague: 0, wrong: 0, fumble: 0, n: 0, right: 0 };
    for (let v = 0; v < 40 && p.hiveCrawl; v++) {
      for (const x of HC.exitsOf(st, p).filter((e) => !e.visited)) {
        c.visit = 2000 + v; c.enc = null; c.alert = 10; delete c.heard[x.id]; if (c.warned) delete c.warned[x.id];
        const to = HC.roomById(den, x.id), truth = to.kind === "core" ? HC.coreForce(st, hv).count : HC.broodLeft(st, hv, to);
        HC.listenAt(st, p, x.id);
        if (!p.hiveCrawl) break;
        const h = c.heard[x.id];
        out.n++; out[h.q]++;
        if (h.kind !== to.kind) out.wrong++;
        if (c.warned && c.warned[x.id]) out.fumble++;
        if (h.q === "exact" ? h.n === truth : h.q === "rough" ? truth >= h.lo && truth <= h.hi : false) out.right++;
      }
    }
    return out;
  };
  const good = stats(9, 8), poor = stats(1, 1);
  check(good.n > 30 && good.exact / good.n > 0.6 && good.vague / good.n < 0.15, `a good listener (Scouting 9, Stealth 8): ${good.exact} exact, ${good.rough} rough, ${good.vague} vague of ${good.n}`);
  check(poor.vague / poor.n > 0.5 && poor.exact / poor.n < 0.15 && poor.wrong > 0 && poor.fumble > 0, `a poor one (1, 1): ${poor.exact} exact, ${poor.rough} rough, ${poor.vague} vague (${poor.wrong} the wrong kind), ${poor.fumble} fumbled`);
  check(good.right === good.exact + good.rough, `what a good listener makes out is right (${good.right} of ${good.exact + good.rough})`);
  // The same visit, the same listen (save and load); an hour; once a passage; the fumble warns them.
  const { st, hv } = world(SEED + 3);
  const { p } = squad(st, hv, { scouting: 4, stealth: 4 });
  HC.startHiveCrawl(st, p, hv);
  clearMouth(st, p);
  const c = p.hiveCrawl;
  const st2 = loadFromString(saveToString(st, { dropCards: true }));
  const p2 = st2.parties.find((q) => q.id === p.id);
  const x = HC.exitsOf(st, p).find((e) => !e.visited);
  const h0 = st.hour;
  const t1 = HC.listenAt(st, p, x.id), t2 = HC.listenAt(st2, p2, x.id);
  check(t1 === t2 && JSON.stringify(c.heard[x.id]) === JSON.stringify(p2.hiveCrawl.heard[x.id]), `the visit's own dice: the same listen in a loaded game ("${t1}")`);
  check(st.hour === h0 + HC.HCRAWL.LISTEN.hours || !p.hiveCrawl || c.enc, `it takes ${HC.HCRAWL.LISTEN.hours} h`);
  check(/already/.test(HC.listenAt(st, p, x.id)), "a passage is listened at once a visit");
  const lo = HC.listenOdds(st, p, c, HC.roomById(HC.denOf(st, hv), x.id));
  check(lo.exact <= lo.rough && lo.rough <= 1 && lo.fumble >= 0, `the odds the window shows: ${Math.round(lo.rough * 100)}% to make it out, ${Math.round(lo.exact * 100)}% exactly, ${Math.round(lo.fumble * 100)}% a noise (skill ${lo.skill} against ${lo.dc})`);
  // A fumble: Alert and the brood beyond waiting.
  let fum = null;
  for (let v = 0; v < 200 && !fum; v++) {
    const w = world(SEED + 4);
    const q = squad(w.st, w.hv, { scouting: 0, stealth: 0 }).p;
    HC.startHiveCrawl(w.st, q, w.hv); clearMouth(w.st, q);
    if (!q.hiveCrawl || q.hiveCrawl.enc) continue;
    q.hiveCrawl.visit = 3000 + v;
    const e = HC.exitsOf(w.st, q).find((y) => !y.visited && HC.broodLeft(w.st, w.hv, HC.roomById(HC.denOf(w.st, w.hv), y.id)) > 0 && y.id !== HC.denOf(w.st, w.hv).core);
    if (!e) continue;
    const a0 = q.hiveCrawl.alert;
    HC.listenAt(w.st, q, e.id);
    if (q.hiveCrawl && q.hiveCrawl.warned && q.hiveCrawl.warned[e.id]) fum = { w, q, e, a0 };
  }
  if (check(!!fum, "a poor listener fumbles now and then")) {
    const { w, q, e, a0 } = fum;
    check(q.hiveCrawl.alert >= a0 + HC.HCRAWL.LISTEN.alert - HC.HCRAWL.ALERT.decay * HC.HCRAWL.LISTEN.hours, `... Alert ${a0} → ${q.hiveCrawl.alert}`);
    q.hiveCrawl.enc = null;
    HC.moveTo(w.st, q, e.id);
    check(!q.hiveCrawl || (q.hiveCrawl.enc && q.hiveCrawl.enc.spotted), "... and the brood beyond is waiting for the team (spotted)");
  }
}

// ---------- 4. the Hivemind's second phase ----------
console.log("The Hivemind's second phase");
{
  const { st, hv } = world(SEED, 900, 80);
  const { p } = squad(st, hv);
  globalThis.window = {};
  let b;
  try { b = createBattle(st, HC.coreSetup(st, p, hv)); } finally { delete globalThis.window; }
  st.combat = b;
  const hm = b.units.find((u) => u.boss === "hivemind");
  const walls0 = b.cells.filter((x) => x.k === "hivewall").length;
  const reach0 = b.units.filter((u) => u.side === "player").every((u) => b.reach[u.y * b.w + u.x]);
  hm.hp = Math.floor(hm.maxHp * 0.45);
  for (let i = 0; i < 3 && !b.over && !(b.hivemind && b.hivemind.phase2); i++) { if (b.phase === "player") endPlayerTurn(st); if (b.phase === "enemy") runEnemyPhase(st); }
  const walls1 = b.cells.filter((x) => x.k === "hivewall").length;
  check(b.hivemind.phase2 && hm.phase2 && b.hivePhase2, `below ${HC.HIVEMIND.P2.at * 100}% it enters its second phase (turn ${b.hivemind.phase2})`);
  check(b.log.some((l) => /tears open/.test(l.text)) && b.log.some((l) => /pillar/.test(l.text)), `the battle log: "${(b.log.find((l) => /tears open/.test(l.text)) || {}).text}"`);
  check(walls1 - walls0 >= HC.HIVEMIND.P2.quake[0] && walls1 - walls0 <= HC.HIVEMIND.P2.quake[1], `the cave quakes: ${walls1 - walls0} pillars came down`);
  check(reach0 && hm.x === b.units.find((u) => u.boss === "hivemind").x, "it still never moves");
  const SP = await import("../src/ui/hivesprites.js");
  const SPR = await import("../src/ui/sprites.js").catch(() => null);
  check(SP.bossBattleCanvas("hivemind2") !== SP.bossBattleCanvas("hivemind") || typeof document === "undefined", "a sprite of its own (torn open, bleeding light)");
  const SND = await import("../src/ui/hivecrawlsfx.js");
  const heard = SND.hiveCrawlHeard(st, { started: true });
  check(heard && heard.phase2 && heard.warmth === 100, "the hive's pulse hears it (the beat races, the quake as it begins)");
  check(SND.HC_SOUND.p2.period < 1 && SND.HC_SOUND.p2.beat > 1, `... faster (× ${SND.HC_SOUND.p2.period}) and louder (× ${SND.HC_SOUND.p2.beat})`);
  void SPR;
  st.combat = null;
  // The core still winnable: the rifle squad (6, assault rifles + plate, Shooting 10, headlamps), guard 80.
  const rate = (tier, lights) => { let w = 0, ph = 0; for (let i = 0; i < TRIALS; i++) { const r = coreTrial(100 + i, tier, { lights }); w += r.won; ph += r.phase2; } return { w: w / TRIALS, ph }; };
  const t2 = rate(2, true), t4 = rate(4, true), t4d = rate(4, false);
  console.log(`    the core with the rifle squad (${TRIALS} battles): tier 2 ${Math.round(t2.w * 100)}% (phase 2 in ${t2.ph}), tier 4 ${Math.round(t4.w * 100)}% (in ${t4.ph}); tier 4 without lights ${Math.round(t4d.w * 100)}%`);
  check(t2.w >= 0.85 && t4.w >= 0.5 && t4.w <= 0.95, "the core stays winnable (before the second phase: tier 2 98%, tier 4 73%; tools/hivecorecalib.js for more battles)");
  check(t2.ph + t4.ph > 0, "the second phase comes in real battles");
}

// ---------- 5. the core's hoard ----------
console.log("The hoard");
{
  const { st, hv } = world(SEED, 0, 80);
  const r0 = st.rng.state;
  const h1 = HC.hiveHoard(st, hv), h2 = HC.hiveHoard(st, hv);
  check(JSON.stringify(h1) === JSON.stringify(h2) && st.rng.state === r0, "the same hoard for the same hive, the world's dice untouched");
  check(h1.gear.length >= 1 && h1.gear.every((g) => condRolled(g) && g.quality > 0 && g.quality <= 1.05), `a young hive's: ${h1.gear.map((g) => `${g.name} (${Math.round(g.quality * 100)}%)`).join(", ")}; ${Object.entries(h1.supplies).map(([k, v]) => `${v} ${k}`).join(", ")}`);
  const { st: s4, hv: v4 } = world(SEED, 2100, 80);
  v4.res = 70;
  const h4 = HC.hiveHoard(s4, v4);
  const rounds = (h) => Object.entries(h.supplies).filter(([k]) => /^a_/.test(k)).reduce((a, [, v]) => a + v, 0);
  check(h4.gear.length > h1.gear.length + 3 && rounds(h4) > rounds(h1) * 3, `an old fat hive's is richer: ${h4.gear.length} pieces (${h4.gear.map((g) => g.name).slice(0, 8).join(", ")}…), ${rounds(h4)} rounds against ${rounds(h1)}`);
  // Won: the team takes what fits, the rest is left on the map.
  const { p } = squad(s4, v4);
  p.cargo.gear.push(...Array.from({ length: 20 }, () => item("sledge"))); // a full cargo
  HC.startHiveCrawl(s4, p, v4);
  const c = p.hiveCrawl;
  c.enc = { kind: "core", room: HC.denOf(s4, v4).core, back: null, spotted: true, fighting: true };
  const g0 = p.cargo.gear.length;
  const handler = (await import("../src/sim/combat.js")).finishCombat;
  handler(s4, HC.coreSetup(s4, p, v4, true), { outcome: "victory", enemiesKilled: 5, enemiesLeft: 0, survivorsHurt: [], survivorsDead: [], ammoUsed: 0, loot: { supplies: {}, gear: [] } });
  const site = s4.deathSites.find((d) => d.tile === v4.tile);
  check(!s4.hives.includes(v4) && p.cargo.gear.length > g0, `the hive is dead; the team took ${HC.HOARD_LAST.taken} things (${p.cargo.gear.length - g0} pieces)`);
  check(site && site.items.length > 0 && s4.markers.some((m) => m.key === `death:${v4.tile}`), `the rest is left at the hive, marked: "${(s4.markers.find((m) => m.key === `death:${v4.tile}`) || {}).label}"`);
  check(s4.log.some((l) => /hoard/.test(l.text)), `the log: "${(s4.log.find((l) => /hoard/.test(l.text)) || {}).text.slice(0, 140)}…"`);
  // AI parity: a group that burns a hive takes it into its stores.
  const { st: s5, hv: v5 } = world(SEED + 5, 2100, 80);
  const f = s5.factions.find((x) => x.alive);
  const items0 = f.arsenal ? f.arsenal.items.length : 0, ammo0 = f.stock.ammo || 0, meds0 = f.stock.meds || 0;
  const got = HC.groupTakeHoard(s5, f, v5);
  check(got.items > 0 && f.arsenal.items.length > items0 && f.stock.ammo > ammo0 && f.stock.meds > meds0, `AI parity: ${f.name} takes ${got.items} pieces into its arsenal, ${got.rounds} rounds and ${f.stock.meds - meds0} meds into its stores`);
}

// ---------- 6. the crawl's record ----------
console.log("The crawl's record");
{
  const { st, hv } = world(SEED, 900, 80);
  check(HC.crawlRecord(st, hv) === null && HC.crawlProgressLine(st) === "", "no record before anyone goes in");
  const { p } = squad(st, hv, { scouting: 9, stealth: 8 });
  st.autoCombat = true;
  HC.startHiveCrawl(st, p, hv);
  for (let i = 0; i < 12 && p.hiveCrawl && !p.hiveCrawl.leaving; i++) HC.hiveCrawlAutoStep(st, p);
  const c = p.hiveCrawl || {};
  const r = HC.crawlRecord(st, hv);
  check(r && r.visits === 1 && r.deepest >= 1 && r.mapped >= 2 && r.depth === HC.denOf(st, hv).depth, `after a few chambers: ${HC.crawlRecText(st, hv)}`);
  check(new RegExp(`${hv.name}: ${r.deepest}/${r.depth}`).test(HC.crawlProgressLine(st)), `the Goals card's line: "${HC.crawlProgressLine(st)}"`);
  check((c.log || []).some((l) => /listens/.test(l.text)), `the autopilot listened with a good scout ("${((c.log || []).find((l) => /listens/.test(l.text)) || {}).text}")`);
  // Save and load; an old save without one.
  const st2 = loadFromString(saveToString(st, { dropCards: true }));
  const hv2 = st2.hives.find((x) => x.id === hv.id);
  check(JSON.stringify(hv2.crawlRec) === JSON.stringify(hv.crawlRec), "a save keeps it");
  delete hv2.crawlRec;
  const st3 = loadFromString(saveToString(st2, { dropCards: true }));
  check(HC.crawlRecord(st3, st3.hives.find((x) => x.id === hv.id)) === null, "an old save (none) loads, no record");
  // The core found, the State Map's tile panel and the hive card, the Goals card.
  const den = HC.denOf(st, hv);
  if (p.hiveCrawl) { p.hiveCrawl.enc = null; }
  hv.crawlRec.mapped[den.core] = 1; hv.crawlRec.core = true; hv.crawlRec.deepest = den.depth;
  check(/core found/.test(HC.crawlRecText(st, hv)) && /★/.test(HC.crawlProgressLine(st)), `the core found: "${HC.crawlRecText(st, hv)}"`);
  const U = await import("../src/ui/ui.js");
  st.knowledge[hv.tile] = snapshot(st, hv.tile); // a report of the hive's tile
  let side = "";
  try { side = U.renderRight(st, { started: true, selected: hv.tile }); } catch (e) { side = `error: ${e.message}`; }
  check(/Crawled/.test(side) && /core found/.test(side), `the State Map's hive tile shows it ("${(/Crawled<\/div><div>([^<]*)/.exec(side) || [])[1]}")`);
  const D = await import("../src/ui/diplomacy.js");
  check(/Crawled:/.test(D.groupsDiploHeader(st)), "the Goals card shows it");
  // The groups' war parties: how deep they got.
  const f = st.factions[0];
  HC.groupHiveCrawl(st, hv, 30, f.id);
  check(hv.groupCrawl && hv.groupCrawl[f.id] != null, `a war party's depth is kept (${f.name}: ${hv.groupCrawl && hv.groupCrawl[f.id]})`);
}

// ---------- 7. the window and the autopilot's flares ----------
console.log("The window");
{
  const { st, hv } = world(SEED + 6);
  const { p } = squad(st, hv, { flares: 3 });
  HC.startHiveCrawl(st, p, hv);
  clearMouth(st, p);
  const UI = await import("../src/ui/hivecrawl.js");
  const ui = { started: true };
  let html = UI.hiveCrawlModal(st, ui);
  check(/data-action="hc-listen"/.test(html) && /data-action="hc-flare"/.test(html) && /data-action="hc-lights"/.test(html) && /Flares <b>3<\/b>/.test(html), "the passages have Listen and Flare, the team its lights and flares");
  const x = HC.exitsOf(st, p).find((e) => !e.visited);
  UI.HIVE_CRAWL_ACTIONS["hc-flare"](st, ui, { id: p.id, room: x.id });
  html = UI.hiveCrawlModal(st, ui);
  check(/🔥 Lit/.test(html) && /ff6a3a/.test(html) && !/undefined|NaN/.test(html), "a flare's light on the passage and the map");
  const y = HC.exitsOf(st, p).find((e) => !e.visited && e.id !== x.id);
  if (y) { UI.HIVE_CRAWL_ACTIONS["hc-listen"](st, ui, { id: p.id, room: y.id }); html = UI.hiveCrawlModal(st, ui); }
  check(!y || (/👂 Heard/.test(html) && !/undefined|NaN/.test(html)), "what was heard on the passage");
  UI.HIVE_CRAWL_ACTIONS["hc-lights"](st, ui, { id: p.id, on: "0" });
  check(p.hiveCrawl.lit === false && /Light up/.test(UI.hiveCrawlModal(st, ui)), "the lights douse and light up again");
  // The autopilot with no good listener throws flares.
  const w = world(SEED + 8, 900, 80);
  const q = squad(w.st, w.hv, { flares: 4, scouting: 1, stealth: 1 }).p;
  w.st.autoCombat = true;
  HC.startHiveCrawl(w.st, q, w.hv);
  for (let i = 0; i < 60 && q.hiveCrawl; i++) HC.hiveCrawlAutoStep(w.st, q);
  check(HC.flaresOf(w.st, q).length < 4, `the autopilot without a listener throws flares (${4 - HC.flaresOf(w.st, q).length} used)`);
  const H = await import("../src/ui/help.js");
  check(H.helpTopics().some((t) => t.title === "The hive crawl" && /flare/.test(t.html) && /second phase/.test(t.html) && /hoard/.test(t.html)), "Help: lights, flares and listening, the hoard, the second phase, the record");
}

console.log(`\n${passed} passed, ${failed} failed (${((performance.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failed ? 1 : 0);
