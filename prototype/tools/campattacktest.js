// Attacks on a camp by the dead and raiders nearby (src/sim/campattack.js, issue #69, the heat epic #64 §5; the user's
// request 2026-10-26: "Higher zombie and Raider activity on the map and tile means more attacks against your camp.").
// Usage: node tools/campattacktest.js [seed]
//   1. the odds an hour: by the grounds' dead left, the tile's level, the noise, the night, running silent;
//   2. the trickle at 0 grounds: a low tile is hardly ever attacked, a high one steadily, faster when loud (dice played
//      hour by hour over weeks);
//   3. every attacker comes out of a pool (drawn while it is at the camp), the kills come off it, the rest go back;
//      a wave left hanging goes back;
//   4. raider bands by the raider level, out of the raiders' pool;
//   5. two bases on one tile share the trickle (one roll for the tile, not one a base);
//   6. a walled base that holds cuts a small wave down at the walls (no card);
//   7. the AI groups' homes: the same rules, the same pools, by the numbers;
//   8. the Camp tab's line and the forecast; save and load; the same dice for the same seed.
import { createWorld, hub, atBase } from "../src/sim/world.js";
import { launchExpedition, partyMembers } from "../src/sim/parties.js";
import { makeCamp } from "../src/sim/staging.js";
import { serializeState, deserializeState } from "../src/sim/save.js";
import { homesOf } from "../src/sim/groupbases.js";
import { membersAt } from "../src/sim/members.js";
import { threatForecastFresh } from "../src/sim/forecast.js";
import { popCap, raiderCap, openDead, openRaiders, poiRaiders, tileRaiders, drawFromTile, putBack, drawRaiders, putBackRaiders, killRaiders, noteNoise, recentKills } from "../src/sim/deadpop.js";
import {
  CAMP_ATTACK, attackOdds, attackEvery, attackMult, groundsRate, trickleRate, raidRate, trickleFree, campAttackHour,
  attackNow, settleWave, basesOn, nearbyView,
} from "../src/sim/campattack.js";

const SEED = Number(process.argv[2] || 42);
const QUICK = !!process.env.BS_QUICK;
let fails = 0, passes = 0;
const check = (ok, msg) => { if (ok) { passes++; console.log(`  ok   ${msg}`); } else { fails++; console.log(`  FAIL ${msg}`); } return !!ok; };
const section = (t) => console.log(`\n${t}`);
const t0 = Date.now();
const world = () => { const st = createWorld({ seed: SEED, factionCount: 6 }); st.started = true; st.noNewGangs = true; st.erasOff = true; st.noWanderers = true; st.cards.length = 0; return st; };
const free = (st, t) => { const x = st.tiles[t]; return x.terrain !== "water" && x.terrain !== "mountain" && !x.hive && x.owner == null && !st.factions.some((f) => f.bases.includes(t)) && !st.bases.some((b) => b.tile === t); };
// A free tile near the hub with a cap of at least `cap`.
function tileNear(st, cap = 30) {
  const h = hub(st);
  for (let r = 2; r <= 20; r++) { const t = st.grid.within(h.tile, r).find((id) => free(st, id) && popCap(st, id) >= cap); if (t != null) return t; }
  return null;
}
// A camp of yours on the tile (makeCamp, as a team's Set up camp), n people.
function campOn(st, tile, n = 3) {
  const h = hub(st);
  Object.assign(h.stock, { food: 300, water: 300, ammo: 400 });
  const res = launchExpedition(st, { memberIds: atBase(st, h.id).slice(0, n).map((s) => s.id), dest: tile, mission: "move", stance: "normal", supplies: { food: 6, water: 6, ammo: 60, wood: 20, stone: 8 } });
  if (res.error) throw new Error(res.error);
  const p = res.party;
  p.path = [tile]; p.idx = 0; p.dest = tile; p.progress = 0; p.phase = "waiting";
  const people = partyMembers(st, p);
  const b = makeCamp(st, p, tile);
  for (const s of people) { s.health = 100; delete s.trip; }
  st.cards.length = 0;
  return b;
}
// Set the tile's open ground to `n` (drawn out or put back).
function setOpen(st, tile, n) {
  const o = openDead(st, tile);
  if (o > n) drawFromTile(st, tile, o - n); else if (o < n) putBack(st, tile, null, n - o);
  return openDead(st, tile);
}
function setRaiders(st, tile, n) {
  const t = st.tiles[tile];
  for (let i = 0; i < ((t.pois && t.pois.length) || 0); i++) { const q = poiRaiders(st, tile, i); if (q) killRaiders(st, tile, i, q); } // the POIs' out of it: the open ground's only
  const o = openRaiders(st, tile);
  if (o > n) drawRaiders(st, tile, o - n); else if (o < n) putBackRaiders(st, tile, null, n - o);
  return tileRaiders(st, tile);
}
// Play the hourly dice for `hours` from `h0`: every card answered by putting the wave back (so the pools stay as they
// are). Returns the attacks at each base { [id]: n } and of each kind.
function playHours(st, hours, h0 = st.hour, opts = {}) {
  const count = {}, kinds = { dead: 0, raiders: 0 };
  for (let i = 0; i < hours; i++) {
    st.hour = h0 + i;
    if (opts.noise) noteNoise(st, opts.noise.tile, null, Math.max(0, opts.noise.level - (opts.noiseOf ? opts.noiseOf() : 0)));
    campAttackHour(st);
    for (const c of st.cards.splice(0)) {
      if (c.campAttack == null) continue;
      count[c.campAttack] = (count[c.campAttack] || 0) + 1;
      const b = st.bases.find((x) => x.id === c.campAttack);
      const w = b && b.campAttack && b.campAttack.wave;
      if (w) { if (w.r + w.rp) kinds.raiders++; else kinds.dead++; settleWave(st, b, w, 0, 0); }
    }
  }
  return { count, kinds };
}

// ---------- 1. the odds ----------
section("The odds an hour: the grounds, the tile's level, the noise, the night, the stance");
const st = world();
const tile = tileNear(st, 30);
const camp = campOn(st, tile);
const cap = popCap(st, tile);
{
  check(!!camp && camp.tier === 0 && basesOn(st, tile).some((x) => x.base === camp), `a camp on ${tile} (cap ${cap})`);
  setOpen(st, tile, Math.round(cap * 0.8));
  st.hour = 24 * 3 + 12; // midday
  const hi = trickleRate(st, tile);
  setOpen(st, tile, Math.round(cap * 0.15));
  const lo = trickleRate(st, tile);
  setOpen(st, tile, 0);
  check(hi > lo * 10 && lo > 0 && trickleRate(st, tile) === 0, `the trickle by the tile's level: high ${hi.toFixed(4)}/h, low ${lo.toFixed(5)}/h, none at 0`);
  setOpen(st, tile, Math.round(cap * 0.6));
  camp.grounds = { dead: 20, known: true, next: 0, waves: 0, killed: 0 };
  const g20 = groundsRate(st, camp);
  camp.grounds.dead = 3;
  const g3 = groundsRate(st, camp);
  camp.grounds.dead = 0;
  check(Math.abs(g20 - CAMP_ATTACK.GROUNDS_P) < 1e-9 && g3 < g20 && g3 > 0 && groundsRate(st, camp) === 0, `the grounds by the dead left: 20 → ${g20.toFixed(4)}/h (about every ${Math.round(1 / g20)} h), 3 → ${g3.toFixed(4)}/h, 0 → none`);
  check(trickleFree(st, tile) === openDead(st, tile), "with no grounds the whole open ground can trickle in");
  camp.grounds.dead = 10;
  check(trickleFree(st, tile) === openDead(st, tile) - 10, "a blind camp's grounds are not the trickle's (they live in the open ground)");
  delete camp.grounds;
  const x = basesOn(st, tile).find((e) => e.base === camp);
  const day = attackMult(st, x).mult;
  st.hour = 24 * 3 + 23;
  const night = attackMult(st, x).mult;
  check(Math.abs(night / day - CAMP_ATTACK.NIGHT / CAMP_ATTACK.DAY) < 1e-6, `the night: ×${(night / day).toFixed(2)} over the day`);
  const quiet = attackMult(st, x).mult;
  noteNoise(st, tile, null, 40);
  const loud = attackMult(st, x).mult;
  check(loud > quiet * 2, `the tile's noise (40): ×${(loud / quiet).toFixed(2)}`);
  camp.silent = true;
  const silent = attackMult(st, x).mult;
  delete camp.silent;
  check(Math.abs(silent / loud - CAMP_ATTACK.SILENT) < 1e-6, "running silent: fewer");
  const o = attackEvery(st, camp);
  check(o.every > 0 && isFinite(o.every) && o.target, `the odds together: an attack every ~${Math.round(o.every)} h on this tile now`);
}

// ---------- 2. the trickle at 0 grounds ----------
section("The trickle at 0 grounds: a low tile hardly ever, a high one steadily, faster when loud");
const DAYS = QUICK ? 30 : 60;
{
  const run = (fill, noise) => {
    const w = world();
    const c = campOn(w, tile);
    setOpen(w, tile, Math.round(popCap(w, tile) * fill));
    setRaiders(w, tile, 0);
    const n0 = openDead(w, tile);
    const r = playHours(w, DAYS * 24, w.hour, noise ? { noise: { tile, level: noise } } : {});
    return { n: r.count[c.id] || 0, kept: openDead(w, tile) === n0 };
  };
  const low = run(0.15, 0), high = run(0.75, 0), loud = run(0.75, 30), none = run(0, 0);
  console.log(`  ${DAYS} days at 0 grounds: low tile ${low.n}, high ${high.n}, high and loud ${loud.n}, empty ${none.n}`);
  check(low.n <= Math.max(2, DAYS / 15), `a low tile (15% of the cap): rarely (${low.n} in ${DAYS} days)`);
  check(high.n >= DAYS / 4 && high.n > low.n * 4, `a high tile (75%): a steady trickle (${high.n}, about every ${Math.round((DAYS * 24) / Math.max(1, high.n))} h)`);
  check(loud.n > high.n * 1.3, `faster when loud (${loud.n} against ${high.n})`);
  check(none.n === 0, "an empty open ground: none");
  check(high.kept && loud.kept, "the waves put back as they came: the pool unchanged (no dead from nowhere)");
}

// ---------- 3. out of a pool, kills off it ----------
section("Every attacker comes out of a pool; the kills come off it, the rest go back");
{
  const w = world();
  const c = campOn(w, tile);
  setOpen(w, tile, Math.round(popCap(w, tile) * 0.7));
  const o0 = openDead(w, tile), k0 = recentKills(w, tile);
  const wave = attackNow(w, c, { trickle: true });
  check(!!wave && wave.d > 0 && wave.g === 0 && openDead(w, tile) === o0 - wave.d, `the trickle's wave (${wave && wave.d}) is drawn out of the open ground (${o0} → ${openDead(w, tile)})`);
  const card = w.cards.find((x) => x.campAttack === c.id);
  check(!!card && /The dead come out of/.test(card.title) && /Nearby: the dead/.test(card.text), `a camp gets the card: "${card && card.title}"`);
  const killed = Math.max(1, wave.d - 2);
  settleWave(w, c, wave, killed, 0);
  check(openDead(w, tile) === o0 - killed && recentKills(w, tile) >= k0 + killed, `${killed} killed off the pool, ${wave.d - killed} back on the open ground (${openDead(w, tile)})`);
  // The grounds' part first, then the trickle.
  c.grounds = { dead: 12, known: true, next: 0, waves: 0, killed: 0, blind: true };
  w.cards.length = 0; c.campAttack.after = 0;
  const o1 = openDead(w, tile);
  const w2 = attackNow(w, c, { grounds: true, trickle: true });
  check(!!w2 && w2.g >= CAMP_ATTACK.GROUNDS_WAVE[0] && w2.g <= 12 && w2.d > 0 && openDead(w, tile) === o1 - w2.d, `grounds and trickle together: ${w2 && w2.g} off the grounds, ${w2 && w2.d} drawn from the tile`);
  const card2 = w.cards.find((x) => x.campAttack === c.id);
  for (const s of atBase(w, c.id)) s.health = 100;
  w.cards.splice(w.cards.indexOf(card2), 1);
  card2.choices.find((x) => x.default).resolve(w); // Defend: the base defence battle, played out headless
  const gone = 12 - c.grounds.dead, back = openDead(w, tile) - (o1 - w2.d);
  check(!w.combat && !(c.campAttack && c.campAttack.wave) && gone >= 0 && gone <= w2.g && c.grounds.waves === 1, `defended: the grounds ${12} → ${c.grounds.dead}; the drawn back or killed (open ground ${openDead(w, tile)})`);
  check(openDead(w, tile) <= o1 && back <= 0, `nothing from nowhere: the open ground ${o1} → ${openDead(w, tile)} (the grounds' kills and the drawn killed come off it; never more than before)`);
  // A wave left hanging (its card dropped): back to the pool the next hour.
  w.cards.length = 0; c.campAttack.after = 0; c.grounds.dead = 0;
  const o2 = openDead(w, tile);
  const w3 = attackNow(w, c, { trickle: true });
  w.cards.length = 0;
  w.hour++; campAttackHour(w);
  check(!!w3 && openDead(w, tile) >= o2 - (w.cards.length ? 10 : 0) && !(c.campAttack.wave && c.campAttack.wave === w3), `a wave whose card was dropped goes back (${o2} → ${openDead(w, tile)})`);
}

// ---------- 4. raiders ----------
section("Raider bands by the raider level, out of the raiders' pool");
{
  const w = world();
  const rc = raiderCap(w, tile);
  setRaiders(w, tile, rc);
  const hi = raidRate(w, tile);
  setRaiders(w, tile, Math.max(1, Math.round(rc * 0.2)));
  const lo = raidRate(w, tile);
  check(hi > lo * 10 && lo > 0, `the raiders' odds by their level: full ${hi.toFixed(4)}/h (about every ${Math.round(1 / hi / 24)} days at the base's ×1), low ${lo.toFixed(5)}/h`);
  const run = (n) => {
    const v = world();
    const c = campOn(v, tile);
    setOpen(v, tile, 0);
    setRaiders(v, tile, n);
    const r0 = tileRaiders(v, tile);
    const r = playHours(v, DAYS * 24);
    return { n: r.kinds.raiders, kept: tileRaiders(v, tile) === r0, c };
  };
  const full = run(rc), low = run(Math.max(1, Math.round(rc * 0.15)));
  console.log(`  ${DAYS} days: raiders at their cap ${full.n} bands, at 15% ${low.n}`);
  check(full.n >= 1 && full.n > low.n, `a high raider level finds the camp (${full.n}); a low one rarely (${low.n})`);
  check(full.kept, "the bands came out of the raiders' pool and went back");
  const v = world();
  const c = campOn(v, tile);
  setRaiders(v, tile, rc);
  const r0 = tileRaiders(v, tile);
  const wave = attackNow(v, c, { raiders: true });
  check(!!wave && wave.r + wave.rp >= CAMP_ATTACK.RAID_BAND[0] && wave.r + wave.rp <= CAMP_ATTACK.RAID_BAND[1] && tileRaiders(v, tile) === r0 - wave.r - wave.rp, `a band of ${wave && wave.r + wave.rp} drawn out (${r0} → ${tileRaiders(v, tile)})`);
  const card = v.cards.find((x) => x.campAttack === c.id);
  check(!!card && /^Raiders found/.test(card.title), `its card: "${card && card.title}"`);
  settleWave(v, c, wave, 0, 1);
  check(tileRaiders(v, tile) === r0 - 1, `one killed off the raiders, the rest back (${tileRaiders(v, tile)})`);
}

// ---------- 5. two bases share the trickle ----------
section("Two bases on one tile share the trickle (one roll for the tile)");
{
  const one = world();
  const a1 = campOn(one, tile);
  setOpen(one, tile, Math.round(popCap(one, tile) * 0.75)); setRaiders(one, tile, 0);
  const r1 = playHours(one, DAYS * 24);
  const two = world();
  const a2 = campOn(two, tile), b2 = campOn(two, tile);
  setOpen(two, tile, Math.round(popCap(two, tile) * 0.75)); setRaiders(two, tile, 0);
  const oa = attackOdds(two, a2), ob = attackOdds(two, b2);
  check((oa.trickle > 0) !== (ob.trickle > 0), `the odds: the trickle goes to one of them (${oa.trickle.toFixed(4)} / ${ob.trickle.toFixed(4)})`);
  const r2 = playHours(two, DAYS * 24);
  const n1 = r1.count[a1.id] || 0, n2 = (r2.count[a2.id] || 0) + (r2.count[b2.id] || 0);
  console.log(`  ${DAYS} days: one camp ${n1} attacks; two camps ${n2} between them (${r2.count[a2.id] || 0} + ${r2.count[b2.id] || 0})`);
  check(n2 <= n1 * 1.35 + 2, `not multiplied by the number of bases (${n2} against ${n1})`);
}

// ---------- 6. a walled base by the numbers ----------
section("A base past the camp stage that holds: a small wave cut down at the walls, no card");
{
  const w = world();
  const h = hub(w);
  for (const s of atBase(w, h.id)) { s.health = 100; delete s.trip; s.role = "guard"; }
  setOpen(w, h.tile, Math.max(10, openDead(w, h.tile)));
  const o0 = openDead(w, h.tile);
  const wave = attackNow(w, h, { trickle: true });
  const card = w.cards.find((x) => x.campAttack === h.id);
  const line = w.log.find((l) => /cut down at the walls/.test(l.text));
  check(!!wave && ((!card && !!line && openDead(w, h.tile) === o0 - wave.d) || !!card), card ? `the hub would not hold ${wave && wave.d}: a card` : `the hub: "${line && line.text}" (${o0} → ${openDead(w, h.tile)})`);
}

// ---------- 7. the AI side ----------
section("The AI groups' homes: the same rules, the same pools, by the numbers");
{
  const w = world();
  const f = w.factions.find((x) => x.alive && x.bases.length && membersAt(x, x.bases[0]).length);
  const t = f.bases[0], home = homesOf(w, f)[t];
  setOpen(w, t, Math.round(popCap(w, t) * 0.8)); setRaiders(w, t, 0);
  const x = basesOn(w, t).find((e) => e.base === home);
  check(!!x && x.f === f && attackOdds(w, home).trickle > 0, `${f.name}'s home on ${t}: the trickle's odds ${attackOdds(w, home).trickle.toFixed(4)}/h`);
  const o0 = openDead(w, t), k0 = recentKills(w, t);
  const wave = attackNow(w, home, { trickle: true });
  check(!!wave && openDead(w, t) <= o0 && openDead(w, t) >= o0 - wave.d && recentKills(w, t) > k0 && !w.cards.some((c) => c.campAttack === home.id), `a wave of ${wave && wave.d} fought by the numbers at once: ${o0 - openDead(w, t)} killed off the pool, no card`);
  const y = w, hy = home, top = Math.round(popCap(y, t) * 0.8);
  setOpen(y, t, top);
  const n0 = (hy.campAttack && hy.campAttack.n) || 0;
  for (let i = 0; i < DAYS * 24; i++) { y.hour++; campAttackHour(y); y.cards.length = 0; }
  const before = ((hy.campAttack && hy.campAttack.n) || 0) - n0;
  check(before >= DAYS / 6, `over ${DAYS} days: ${before} attacks on their home (a high tile), the pools paying for them (open ground ${openDead(y, t)} of ${top})`);
  check(openDead(y, t) < top, "their kills lower the tile's dead");
}

// ---------- 8. the Camp tab, the forecast, saves, the dice ----------
section("The Camp tab's line, the forecast, save and load, the same dice");
{
  const w = world();
  const c = campOn(w, tile);
  setOpen(w, tile, Math.round(popCap(w, tile) * 0.8));
  const v = nearbyView(w, c);
  check(/^the dead (low|medium|high|overrun), raiders \w+ · an attack (every ~\d+ (h|days)|hardly ever)$/.test(v.text), `the Camp tab: "Nearby: ${v.text}"`);
  const fc = threatForecastFresh(w);
  const items = fc.items.filter((it) => it.kind === "camp attack" && it.target && it.target.id === c.id);
  check(isFinite(v.every) && v.every < 7 * 24 ? items.length >= 1 : items.length === 0, `the 7-day forecast counts them: ${items.length} expected (${items[0] ? items[0].text : "none"})`);
  const before = openDead(w, tile);
  attackNow(w, c, { trickle: true });
  const s2 = deserializeState(JSON.parse(JSON.stringify(serializeState(w, { dropCards: true }))));
  const c2 = s2.bases.find((b) => b.id === c.id);
  check(!!c2 && JSON.stringify(c2.campAttack) === JSON.stringify(c.campAttack) && openDead(s2, tile) === openDead(w, tile), "saved and loaded: the wave out at the camp and the pool");
  s2.hour++; campAttackHour(s2); s2.cards.length = 0;
  check(!c2.campAttack.wave && openDead(s2, tile) >= before - 10 && openDead(s2, tile) >= openDead(w, tile), `its card dropped by the save: the wave back on the open ground (${openDead(w, tile)} → ${openDead(s2, tile)})`);
  const old = JSON.parse(JSON.stringify(serializeState(w, { dropCards: true })));
  for (const b of old.state.bases || []) delete b.campAttack;
  const s3 = deserializeState(old);
  check(!!s3.bases.find((b) => b.id === c.id) && !s3.bases.find((b) => b.id === c.id).campAttack, "an older save (no campAttack) loads");
  const a = world(), b = world();
  const ca = campOn(a, tile), cb = campOn(b, tile);
  setOpen(a, tile, Math.round(popCap(a, tile) * 0.7)); setOpen(b, tile, Math.round(popCap(b, tile) * 0.7));
  const ra = playHours(a, 20 * 24), rb = playHours(b, 20 * 24);
  check(JSON.stringify(Object.values(ra.count)) === JSON.stringify(Object.values(rb.count)) && JSON.stringify(ra.kinds) === JSON.stringify(rb.kinds) && openDead(a, tile) === openDead(b, tile), `the same seed, the same attacks (${JSON.stringify(Object.values(ra.count))} / ${JSON.stringify(Object.values(rb.count))})`);
}

console.log(`\n${passes} passed, ${fails} failed (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(fails ? 1 : 0);
