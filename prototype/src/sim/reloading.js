// @ts-check
// The reloading bench (docs/weapons-overhaul-plan.md section 12, built on section 27's round keys; wave 2, agent C2).
//
// The building: an ammo bench upgraded in place (buildings.js reload_bench, from: "ammo_bench", the bunkhouse →
// barracks pattern: one bench of the up to three a base has, queued by its id, its plot and operator kept). It is still
// an "ammo" station: with no standing order to work on (or none it can make) it makes the common rounds of the guns
// at the base from scrap exactly like the old bench (buildings.js RECIPES.ammo, ammo.js benchRounds), so the ammo
// economy does not change. Quiet: it counts RELOAD.HEAT of a station's Heat (buildings.js mannedStations).
//
// Inputs are supplies (data-ammo.js RELOAD_SUPPLIES; their item forms, a bag, a can, a box, are opened into the stock
// at a base like a box of rounds): a round's brass (or hull), a primer, its powder charges (POWDER_PER10 by class),
// lead (a scrap per 20 bullets: ceil(n / 20) a day) and for AP a machine part per 20 (steel cores; a machine shop at
// the base). The dies wear: a gun part per RELOAD.WEAR rounds (base.reload.wear). When the smokeless powder or the
// factory primers run out the bench uses black powder (made at the bench: crafting.js) and match-head primers.
//
// Standing orders (base.reload.orders: { id, key, n, on, by }): "keep at least n rounds of this calibre and type" (a
// factory key; its handloads count). Each day an operator works the order that is furthest short (by share) and that
// they can make: Mechanics at the recipe's minimum (data-ammo.js LOADS), the inputs for a round at least. Rate: the
// recipe's rounds a day × (1 + 0.04 × Mechanics), no more than the order is short, no more than the inputs allow.
//
// Handloads (data-ammo.js HAND_SUPPLIES: a_9mm_hp_hand): a typed round, or any round with black powder or match
// primers, is a handload, a supply key of its own, so its make goes wherever the rounds go (stocks, packs, cargo,
// trade, a battle's pools). A common round (FMJ, 00 buck) loaded with smokeless powder and factory primers goes into
// the factory key. The make of each handload key is a colony-wide average (state.handloads[key] = { hq, bp, mp, lo }):
// hq = 0.6 + 0.03 × Mechanics (at most 1), bp / mp the share with black powder / match primers, lo the share loaded
// below Mechanics 8. In a fight (gunfire.js): a handload jams × (2.5 − 1.5 × hq) × (1 + 0.5 × bp) × (1 + 2 × mp),
// shoots RELOAD_FX.AIM × lo worse and black powder is RELOAD_FX.BLACK_NOISE louder a shot (stealth.js shotNoise).
//
// Brass (noteBrass, pickUpBrass): after a won fight on a battle map about RELOAD.BRASS of your side's fired rounds
// (revolvers: all of them, they stay in the cylinder) come back as brass into the team's or the base's stock (the
// battle's first pool, as with arrows); none after a loss or a retreat. By calibre in b.brassBy (the log line); one
// generic brass in the stock.
//
// The other groups (AI parity): their fights leave them brass (arsenal.js takeArsenalRounds → groupBrass); a group
// with a workshop and the inputs loads rounds into its one ammo count each day (groupReloadDaily), and buys powder
// and primers from a trading or military group when short (the hunger trade's pattern). Arms dealers and the
// traders' and soldiers' groups keep powder and primers to sell (merchantReload, groupReloadDaily).
import { LOAD_CLASS, POWDER_PER10, loadRecipe, handKey, CALIBERS, ammoKey, RELOAD_FX } from "./data-ammo.js";
import { SUPPLIES, supValue } from "./data.js";
import { count, countAll } from "./buildings.js";
import { withBuildmat, siteShort, payCost } from "./buildmats.js"; // the upgrade's building materials (made on site from scrap when short)
import { atBase, skill, log, newId, day } from "./world.js";
import { WEAPON_PLATFORM } from "./data-gunmods.js";
import { baseCals, partyCals, calOf, nextHand, armoured, kindMix } from "./ammo.js";
import { roundsIn, baseType, withHand, GENERIC_KEYS, roundOf, isLaunchRound } from "./rounds.js";
import { hash01 } from "./skills.js";
import { buildLock } from "./blueprints.js";
import { relation, warsOf } from "./diplomacy.js";
import { note } from "./ledger.js"; // the conservation test's ledger (off in play)

export const RELOAD = {
  UP: { cost: withBuildmat({ parts: 1, gunparts: 3, scrap: 20 }), hours: 24, req: { mechanics: 3 } }, // the upgrade (buildings.js reload_bench); its building materials made on site from scrap when short (buildmats.js)
  HEAT: 0.25,          // × a station's Heat while it runs
  RATE_PER: 0.04,      // + a day's rounds per Mechanics point
  LEAD: 20,            // bullets a scrap
  CORES: 20,           // AP bullets a machine part
  WEAR: 500,           // rounds a gun part (the dies)
  BRASS: 0.6,          // of your side's fired rounds back as brass after a won fight
  REVOLVER: 1,         // a revolver's: all of them
  HQ: [0.6, 0.03],     // hq = 0.6 + 0.03 × Mechanics
  ORDER_MAX: 9999,
  // The governor (autoReloadOrders): keep at least these.
  AUTO: { hp: 100, slug: 25, ap: 60 },
  // Its trade wants (reloadNeeds): powder charges and primers to keep with a reloading bench.
  STOCK: { powder: 300, primers: 300 },
  // The other groups.
  GROUP: { perHead: 1.2, max: 40, buyEvery: 10, buyBrass: 30, keepScrap: 1, want: { powder: 150, primers: 150 }, markup: 1.25, pc: 1.6, // pc: charges a round (their mix)
           rel: -50, // a seller not at war with them and not a bitter enemy (traders deal with most)
           brass: 0.3, // of the rounds their fights spend, back as brass
           stock: { traders: { powder: [2, 6], primers: [2, 6] }, military: { powder: [3, 8], primers: [3, 8] } } }, // per head they keep to sell (restocked toward it)
  // Pulling rounds (user, 2026-10-08: the rounds of calibres nobody uses pile up): a bullet puller takes rounds apart
  // into their case, powder, a reusable primer (PRIMER of them) and lead (a scrap per LEAD bullets). RATE a day,
  // Mechanics MIN; by calibre class the case and the charges (rimfire: no case or primer to reuse; .50 BMG: 10 charges).
  PULL: { RATE: 60, MIN: 1, PRIMER: 0.8, KEEP: 20, CHARGE: { pistol: 1, rifle: 2.5, shotgun: 100 / 60, "22lr": 0.3, "50bmg": 10 },
          GROUP: { below: 100, share: 0.02, max: 30, keepHead: 10 } }, // a group pulls when short of brass: up to max a day, share of the unused-calibre ammo, keeping keepHead a head
  // Merchant caravans (visitors.js merchantGoods): an arms dealer's powder and primers, anyone else's now and then.
  MERCHANT: { on: true, arms: { powder: [100, 300], primers: [100, 400], brass: [0, 200] }, other: { p: 0.25, powder: [0, 100], primers: [0, 100] } },
};

const num = (v) => (Number.isFinite(v) ? v : 0);
const mech = (s) => (s ? skill(s, "mechanics") : 0);

// ---------- recipes ----------
// The class of a calibre the bench loads (pistol, rifle, shotgun), or null.
/** @param {string} cal */
export const loadClass = (cal) => LOAD_CLASS[cal] || null;
// Every (calibre, type) the bench can load, grouped by calibre in CALIBERS order: [{ cal, types: [{ type, key, min, rate }] }].
export const CAL_ORDER = ["9mm", "57x28", "38spl", "45acp", "357", "44mag", "12ga", "20ga", "556", "223", "300blk", "762x39", "308", "3030"]; // pistols, the shotgun, rifles (Object.keys puts "308" first); every LOAD_CLASS calibre (ar-platform's .38, .223 and .300 BLK too)
export function recipeList() {
  const out = [];
  for (const cal of CAL_ORDER) {
    if (!LOAD_CLASS[cal] || !CALIBERS[cal]) continue;
    const types = [];
    for (const type of [CALIBERS[cal].base, ...CALIBERS[cal].types.filter((t) => t !== CALIBERS[cal].base)]) {
      const r = loadRecipe(cal, type);
      if (r) types.push({ type, key: ammoKey(cal, type), min: r[0], rate: r[1], ap: type === "ap" });
    }
    out.push({ cal, types });
  }
  return out;
}
// What 10 rounds of it take: { brass, primers, powder (charges), scrap, parts (AP) }.
/** @param {string} cal @param {string} type */
export function inputsPer10(cal, type) {
  const c = loadClass(cal);
  const out = { brass: 10, primers: 10, powder: Math.round((c ? POWDER_PER10[c] : 10) * 10) / 10, scrap: 10 / RELOAD.LEAD };
  if (type === "ap") out.parts = 10 / RELOAD.CORES;
  return out;
}
// Rounds a day for this operator (Mechanics) of a recipe.
/** @param {number} rate @param {number} m */
export const dayRate = (rate, m) => Math.floor(rate * (1 + RELOAD.RATE_PER * Math.max(0, m)));
// Handload quality from the loader's Mechanics.
/** @param {number} m */
export const handHq = (m) => Math.min(1, RELOAD.HQ[0] + RELOAD.HQ[1] * Math.max(0, m));
// Is the round's handload key for (cal, type)? Its factory key's partner.
/** @param {string} key a factory key */
export const handOf = (key) => { const ks = withHand(key); return ks.length > 1 ? ks[1] : null; };

// ---------- the building ----------
export const isReloadBench = (st) => !!st && st.type === "reload_bench";
export const reloadBenches = (base) => (base ? base.buildings.filter((b) => b.type === "reload_bench") : []);
export const hasReloadBench = (base) => reloadBenches(base).some((b) => !b.broken);
// Can this ammo bench be upgraded into a reloading bench now?
export function canUpgradeAmmoBench(state, base, id) {
  const b = base && base.buildings.find((x) => x.id === id && x.type === "ammo_bench");
  if (!b) return { ok: false, reason: "That ammo bench is gone" };
  if (b.broken) return { ok: false, reason: "Repair it first (Repairs tab)" };
  if (base.construction.some((c) => c.target === id)) return { ok: false, reason: "It is being upgraded already" };
  { const why = siteShort(base.stock, RELOAD.UP.cost, (k) => (SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k)); if (why) return { ok: false, reason: why }; }
  for (const [sk, lvl] of Object.entries(RELOAD.UP.req)) if (!atBase(state, base.id).some((s) => skill(s, sk) >= lvl)) return { ok: false, reason: `Needs a Mechanics ${lvl}+ survivor here` };
  const lock = buildLock(state, base, "reload_bench");
  if (lock) return { ok: false, reason: lock, locked: true };
  return { ok: true };
}
export function queueReloadUpgrade(state, base, id) {
  const chk = canUpgradeAmmoBench(state, base, id);
  if (!chk.ok) return chk.reason;
  const pay = payCost(base.stock, RELOAD.UP.cost);
  base.construction.push({ id: newId(), type: "reload_bench", target: id, cost: pay.paid, progress: 0, hours: RELOAD.UP.hours + pay.hours });
  return `Ammo bench → reloading bench queued at ${base.name}.`;
}

// ---------- orders ----------
/** @param {any} base */
export const reloadOf = (base) => { const R = base.reload || (base.reload = { orders: [], wear: 0 }); if (!R.pulls) R.pulls = []; return R; };
export const reloadOrders = (base) => (base && base.reload ? base.reload.orders : []);
export const pullOrders = (base) => (base && base.reload && base.reload.pulls) || [];
// Adds or sets a "keep at least n" order for a calibre and type. by: "player" (the UI) or "ai" (the governor).
export function setReloadOrder(state, base, key, n, by = "player") {
  const r = SUPPLIES[key] && SUPPLIES[key].round;
  if (!r || r.hand || !loadRecipe(r.cal, r.type)) return "The bench cannot load that.";
  const R = reloadOf(base);
  const q = Math.max(0, Math.min(RELOAD.ORDER_MAX, Math.floor(Number(n) || 0)));
  let o = R.orders.find((x) => x.key === key);
  if (!o) { o = { id: newId(), key, n: q, on: true, by }; R.orders.push(o); }
  else { o.n = q; o.by = by; o.on = true; }
  return `Reloading: keep at least ${q} ${SUPPLIES[key].name} at ${base.name}.`;
}
export function removeReloadOrder(state, base, id) {
  const R = reloadOf(base);
  const i = R.orders.findIndex((x) => x.id === Number(id));
  if (i < 0) return "That order is gone.";
  const o = R.orders.splice(i, 1)[0];
  return `Reloading order for ${SUPPLIES[o.key].name} removed.`;
}
export function toggleReloadOrder(state, base, id) {
  const o = reloadOrders(base).find((x) => x.id === Number(id));
  if (!o) return "That order is gone.";
  o.on = !o.on;
  o.by = "player";
  return `Reloading order for ${SUPPLIES[o.key].name} ${o.on ? "resumed" : "paused"}.`;
}
// Rounds of an order's calibre and type at the base (its handloads too).
export const orderHave = (base, o) => { const r = SUPPLIES[o.key].round; return roundsIn(base.stock, r.cal, r.type); };

// What one round of a recipe can be made from here: { ok, n (rounds the inputs allow), reason }.
function inputsFor(state, base, cal, type) {
  const st = base.stock;
  const pc = (POWDER_PER10[loadClass(cal) || "pistol"] || 10) / 10;
  const powder = Math.floor(num(st.powder) / pc + 1e-6) + Math.floor(num(st.blackpowder) / pc + 1e-6);
  const primers = Math.floor(num(st.primers)) + Math.floor(num(st.matchprimers));
  const lead = Math.floor(num(st.scrap)) * RELOAD.LEAD;
  let n = Math.min(Math.floor(num(st.brass)), primers, powder, lead);
  let reason = !(st.brass >= 1) ? "no brass" : primers < 1 ? "no primers" : powder < 1 ? "no powder" : lead < 1 ? "no scrap (lead)" : "";
  if (type === "ap") {
    if (!count(base, "machine_shop")) return { n: 0, reason: "AP needs a machine shop here" };
    n = Math.min(n, Math.floor(num(st.parts)) * RELOAD.CORES);
    if (!reason && !(st.parts >= 1)) reason = "AP needs machine parts (steel cores)";
  }
  const R = reloadOf(base);
  if (R.wear >= RELOAD.WEAR && !(num(st.gunparts) >= 1)) return { n: 0, reason: "worn dies: needs a gun part" };
  return { n: Math.max(0, n), reason };
}
// Every order's status for this operator today (the UI): [{ order, n (rounds it would make), reason, have, short }].
export function reloadRows(state, base, op) {
  const m = mech(op);
  /** @type {{ order: any, n: number, reason: string, have: number, short: number, cal?: string, type?: string }[]} */
  const rows = [];
  for (const o of reloadOrders(base)) {
    const r = SUPPLIES[o.key] && SUPPLIES[o.key].round;
    const rec = r && loadRecipe(r.cal, r.type);
    if (!rec) { rows.push({ order: o, n: 0, reason: "cannot be loaded", have: 0, short: 0 }); continue; }
    const have = orderHave(base, o), short = o.n - have;
    let n = 0, reason = "";
    if (!o.on) reason = "paused";
    else if (short <= 0) reason = `stocked: ${have} of ${o.n}`;
    else if (!op) reason = "no operator";
    else if (m < rec[0]) reason = `needs Mechanics ${rec[0]} (the operator has ${m})`;
    else {
      const inp = inputsFor(state, base, r.cal, r.type);
      n = Math.min(dayRate(rec[1], m), short, inp.n);
      if (n < 1) { n = 0; reason = inp.reason || "short of inputs"; }
    }
    rows.push({ order: o, n, reason, have, short: Math.max(0, short), cal: r.cal, type: r.type });
  }
  return rows;
}
// The best job for this operator today: the order furthest short (by share) it can work, { order, cal, type, n }, or null.
export function reloadJob(state, base, op) {
  let best = null, bestShort = 0;
  for (const r of reloadRows(state, base, op)) {
    const s = r.short / Math.max(1, r.order.n);
    if (r.n >= 1 && s > bestShort) { bestShort = s; best = { order: r.order, cal: r.cal, type: r.type, n: r.n }; }
  }
  return best;
}

// Would a reloading bench here work an order today (the governor staffs it: autopilot.js stationWorth)? The best
// Mechanics at the base as its operator.
export function reloadWanted(state, base) {
  if (!hasReloadBench(base) || !(reloadOrders(base).length || pullOrders(base).length)) return false;
  const op = atBase(state, base.id).filter((s) => !s.inBed).sort((a, b) => mech(b) - mech(a))[0];
  return !!(op && (reloadJob(state, base, op) || pullJob(state, base, op)));
}

// ---------- the day's work (buildings.js stationStatus / runStations) ----------
// A reloading bench's status today when it works an order: the station status shape with job set; null when it has
// none to work (it runs as an ammo bench: the common rounds from scrap, under its station order).
export function reloadStatus(state, base, st, op) {
  if (!op || !isReloadBench(st) || (base.orders && base.orders[st.id] && base.orders[st.id].mode === "off")) return null; // its station order Off: off altogether
  const job = reloadJob(state, base, op);
  if (!job) {
    const pj = pullJob(state, base, op); // nothing to load: pull the rounds marked for it (their parts feed the loading)
    if (!pj) return null;
    const pio = pullIO(base, pj);
    return { op, running: true, reason: `Pulling ${SUPPLIES[pj.key].name}`, recipe: "ammo", out: pio.out, in: pio.in, reload: pj };
  }
  const io = jobIO(base, job);
  return { op, running: true, reason: `Loading ${SUPPLIES[job.order.key].name}`, recipe: "ammo", out: io.out, in: io.in, reload: job };
}
// What a job takes and makes: { in: { brass, primers, powder, blackpowder, matchprimers, scrap, parts }, out: { key: n },
// split: { factory, hand, bp, mp } }.
function jobIO(base, job) {
  const st = base.stock, n = job.n;
  const pc = (POWDER_PER10[loadClass(job.cal) || "pistol"] || 10) / 10;
  const smokeless = Math.min(n, Math.floor(num(st.powder) / pc + 1e-6));
  const black = n - smokeless;
  const factoryP = Math.min(n, Math.floor(num(st.primers)));
  const match = n - factoryP;
  const charges = (q, have) => Math.min(num(have), Math.ceil(q * pc - 1e-6)); // a shotgun load is 1⅔ charges: never more than there is
  const inp = { brass: n, primers: factoryP, powder: charges(smokeless, st.powder), scrap: Math.ceil(n / RELOAD.LEAD) };
  if (black > 0) inp.blackpowder = charges(black, st.blackpowder);
  if (match > 0) inp.matchprimers = match;
  if (job.type === "ap") inp.parts = Math.ceil(n / RELOAD.CORES);
  for (const k of Object.keys(inp)) if (!(inp[k] > 0)) delete inp[k];
  const degraded = Math.max(black, match);
  const isBase = job.type === baseType(job.cal);
  const hand = isBase ? degraded : n, factory = n - hand;
  const fk = ammoKey(job.cal, job.type), hk = handKey(job.cal, job.type);
  const out = {};
  if (factory > 0) out[fk] = factory;
  if (hand > 0) out[hk] = hand;
  return { in: inp, out, split: { factory, hand, bp: hand ? Math.min(1, black / hand) : 0, mp: hand ? Math.min(1, match / hand) : 0 } };
}
// Runs a job: inputs out of the stock, rounds in, the dies' wear, the handloads' make noted. Returns the rounds made.
export function runReload(state, base, st, status) {
  const job = status.reload;
  if (!job) return 0;
  if (job.pull) return runPull(state, base, job);
  const io = jobIO(base, job);
  for (const [k, v] of Object.entries(io.in)) base.stock[k] = num(base.stock[k]) - v;
  const hk = handKey(job.cal, job.type);
  if (io.split.hand > 0) noteMake(state, hk, num(base.stock[hk]), io.split.hand, mech(status.op), io.split.bp, io.split.mp);
  for (const [k, v] of Object.entries(io.out)) base.stock[k] = num(base.stock[k]) + v;
  const R = reloadOf(base);
  R.wear = num(R.wear) + job.n;
  while (R.wear >= RELOAD.WEAR && num(base.stock.gunparts) >= 1) { base.stock.gunparts -= 1; R.wear -= RELOAD.WEAR; }
  R.made = num(R.made) + job.n;
  R.last = { day: day(state), key: job.order.key, n: job.n, hand: io.split.hand };
  return job.n;
}
// The colony's average make of a handload key, weighted by the rounds of it there were (w0) and the new ones (n).
export function noteMake(state, hk, w0, n, m, bp = 0, mp = 0) {
  const H = state.handloads || (state.handloads = {});
  const cur = H[hk];
  const add = { hq: handHq(m), bp, mp, lo: m < RELOAD_FX.AIM_BELOW ? 1 : 0 };
  const w = cur ? Math.max(0, w0) : 0;
  const mix = (a, b) => Math.round(((a * w + b * n) / Math.max(1, w + n)) * 1000) / 1000;
  H[hk] = cur ? { hq: mix(cur.hq, add.hq), bp: mix(cur.bp, add.bp), mp: mix(cur.mp, add.mp), lo: mix(cur.lo, add.lo) } : add;
  return H[hk];
}

// ---------- pulling rounds ----------
// What one pulled round of a key gives: { brass, powder (charges), primers } (scrap: a LEAD-th of a bullet).
/** @param {string} key */
export function pullYield(key) {
  const r = roundOf(key);
  if (!r) return null;
  const P = RELOAD.PULL, c = r.cal;
  const charge = P.CHARGE[c] ?? P.CHARGE[LOAD_CLASS[c] || "rifle"];
  const rim = c === "22lr";
  return { brass: rim ? 0 : 1, powder: charge, primers: rim ? 0 : P.PRIMER };
}
// "Pull rounds of this key down to keep" (a factory or a handload key; any calibre). by: "player" or "ai".
export function setPullOrder(state, base, key, keep, by = "player") {
  if (!roundOf(key)) return "Not a round.";
  if (isLaunchRound(key)) return "Grenades and rockets are not pulled apart at a reloading bench.";
  const R = reloadOf(base);
  const q = Math.max(0, Math.min(RELOAD.ORDER_MAX, Math.floor(Number(keep) || 0)));
  let o = R.pulls.find((x) => x.key === key);
  if (!o) { o = { id: newId(), key, keep: q, on: true, by }; R.pulls.push(o); }
  else { o.keep = q; o.by = by; o.on = true; }
  return `Pull ${SUPPLIES[key].name} down to ${q} at ${base.name}: their brass, powder and primers for the bench.`;
}
export function removePullOrder(state, base, id) {
  const R = reloadOf(base);
  const i = R.pulls.findIndex((x) => x.id === Number(id));
  if (i < 0) return "That order is gone.";
  const o = R.pulls.splice(i, 1)[0];
  return `Pulling ${SUPPLIES[o.key].name} stopped.`;
}
// Every pull order's status for this operator today: [{ order, n, reason, have }].
export function pullRows(state, base, op) {
  const m = mech(op);
  return pullOrders(base).map((o) => {
    const have = Math.floor(num(base.stock[o.key]));
    let n = 0, reason = "";
    if (!o.on) reason = "paused";
    else if (have <= o.keep) reason = `down to ${have} (keeps ${o.keep})`;
    else if (!op) reason = "no operator";
    else if (m < RELOAD.PULL.MIN) reason = `needs Mechanics ${RELOAD.PULL.MIN}`;
    else n = Math.min(dayRate(RELOAD.PULL.RATE, m), have - o.keep);
    return { order: o, n, reason, have };
  });
}
// The pull job today (the order with most above its keep), or null. Loading comes first (reloadStatus).
export function pullJob(state, base, op) {
  let best = null;
  for (const r of pullRows(state, base, op)) if (r.n >= 1 && (!best || r.have - r.order.keep > best.over)) best = { order: r.order, key: r.order.key, n: r.n, pull: true, over: r.have - r.order.keep };
  return best;
}
// Any work for this operator today: loading first, then pulling (production.js keeps them at the bench for it).
export const reloadWork = (state, base, op) => reloadJob(state, base, op) || pullJob(state, base, op);
// What a pull job takes and gives.
function pullIO(base, job) {
  const y = pullYield(job.key), n = job.n, R = reloadOf(base);
  const out = {};
  if (y.brass) out.brass = n * y.brass;
  out.powder = Math.floor(n * y.powder + 1e-6);
  if (y.primers) out.primers = Math.floor(n * y.primers + 1e-6);
  const lead = num(R.lead) + n / RELOAD.LEAD;
  if (Math.floor(lead + 1e-9) > 0) out.scrap = Math.floor(lead + 1e-9);
  return { in: { [job.key]: n }, out, lead: lead - (out.scrap || 0) };
}
function runPull(state, base, job) {
  const io = pullIO(base, job), R = reloadOf(base);
  for (const [k, v] of Object.entries(io.in)) base.stock[k] = num(base.stock[k]) - v;
  for (const [k, v] of Object.entries(io.out)) base.stock[k] = num(base.stock[k]) + v;
  R.lead = io.lead;
  R.pulled = num(R.pulled) + job.n;
  R.last = { day: day(state), key: job.key, n: job.n, pull: true };
  return job.n;
}

// ---------- in a fight (gunfire.js) ----------
// The make of a handload key (no record: the worst, a Mechanics 0 loader's).
export const HAND_DEFAULT = { hq: RELOAD.HQ[0], bp: 0, mp: 0, lo: 1 };
export const handMake = (state, hk) => (state && state.handloads && state.handloads[hk]) || HAND_DEFAULT;
// The handload marks on a unit of yours for the round it fires next (ammo.js nextHand): u.loadCond "hand", u.loadHq,
// u.loadBp, u.loadMp (gunfire.js ammoJam), u.loadAim (combat.js shotOdds), u.loadBp (stealth.js shotNoise). A factory
// round clears them (only the ones set here: a test's "old" rounds stay).
export function noteHandLoad(b, u) {
  if (!b || !u || !(u.side === "player" || u.who)) return; // anyone's handloads mark their shots (docs/adr/0001-ai-parity.md)
  const hk = nextHand(b, u);
  if (!hk) {
    if (u.handLoad) { u.loadCond = "factory"; delete u.loadHq; delete u.loadBp; delete u.loadMp; delete u.loadAim; u.handLoad = false; }
    return;
  }
  const m = (b.handQ && b.handQ[hk]) || HAND_DEFAULT;
  u.loadCond = "hand"; u.loadHq = m.hq; u.loadBp = m.bp; u.loadMp = m.mp; u.loadAim = RELOAD_FX.AIM * m.lo; u.handLoad = true;
}
// The battle's copy of the colony's handload makes (once a battle: gunfire.js noteJamWeather).
export function noteHandQ(state, b) {
  if (!b || b.handQ != null) return;
  b.handQ = state && state.handloads ? JSON.parse(JSON.stringify(state.handloads)) : {};
}
export const revolver = (key) => key === "revolver" || WEAPON_PLATFORM[key] === "revolver";
// Rounds of yours fired (combat.js spendShot): the brass that could be picked up.
export function noteBrass(b, u, n) {
  const cal = calOf(u && u.weapon);
  if (!cal || !LOAD_CLASS[cal] || !(n > 0) || !u || u.side !== "player") return;
  const q = n * (revolver(u.weapon) ? RELOAD.REVOLVER : RELOAD.BRASS);
  b.brass = num(b.brass) + q;
  const by = b.brassBy || (b.brassBy = {});
  by[cal] = num(by[cal]) + q;
}
// After the fight: the brass picked up when the field is yours, into the battle's first pool. Returns the log lines.
// Also notes the armoured enemies met (the governor's AP order: state.metArmour).
export function pickUpBrass(state, b, won) {
  if (state && !state.metArmour && (b.units || []).some((u) => u.side === "enemy" && armoured(u))) state.metArmour = day(state);
  const n = won ? Math.floor(num(b.brass) + 1e-9) : 0;
  b.brassBack = n;
  if (n > 0 && b.pools && b.pools[0]) b.pools[0].brass = num(b.pools[0].brass) + n;
  if (!n) return [];
  const by = Object.entries(b.brassBy || {}).filter(([, q]) => q >= 1).sort((a, c) => c[1] - a[1]).map(([c, q]) => `${CALIBERS[c].name} ${Math.floor(q)}`);
  return [`Picked up ${n} fired case${n === 1 ? "" : "s"} for the reloading bench${by.length > 1 ? ` (${by.join(", ")})` : ""}.`];
}

// ---------- the governor (autopilot.js governBase) ----------
// The calibre of the guns of a class at the base with the most guns (null: none).
function mainCal(state, base, cls) {
  const cals = baseCals(state, base);
  return Object.entries(cals).filter(([c]) => LOAD_CLASS[c] === cls).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([c]) => c)[0] || null;
}
// The orders the governor keeps at a base with a reloading bench: 100 HP of the main pistol calibre, 25 slugs with
// any shotgun, 60 AP of the main rifle calibre once armoured enemies have been met; otherwise the bench makes the
// common rounds. The player's own orders (by: "player") stand; the governor's that no longer apply go.
export function autoReloadOrders(state, base) {
  if (!hasReloadBench(base)) return [];
  const want = {};
  const p = mainCal(state, base, "pistol");
  if (p && loadRecipe(p, "hp")) want[ammoKey(p, "hp")] = RELOAD.AUTO.hp;
  if (baseCals(state, base)["12ga"]) want[ammoKey("12ga", "slug")] = RELOAD.AUTO.slug;
  const r = mainCal(state, base, "rifle");
  if (state.metArmour && r && loadRecipe(r, "ap")) want[ammoKey(r, "ap")] = RELOAD.AUTO.ap;
  const R = reloadOf(base);
  const out = [];
  // Pull the rounds of calibres no gun here (or on a team from here) shoots, down to a trade reserve: their parts
  // feed the loading of the calibres it needs.
  const used = { ...baseCals(state, base) };
  for (const p of state.parties || []) if (p.owner === "player" && p.homeBaseId === base.id) Object.assign(used, partyCals(state, p));
  const pull = {};
  for (const k of GENERIC_KEYS) if (num(base.stock[k]) > RELOAD.PULL.KEEP && !used[roundOf(k).cal]) pull[k] = RELOAD.PULL.KEEP; // never a launcher's grenades or rockets
  R.pulls = R.pulls.filter((o) => o.by === "player" || pull[o.key] != null);
  for (const [k, n] of Object.entries(pull)) {
    const o = R.pulls.find((x) => x.key === k);
    if (o && (o.by === "player" || o.keep === n)) continue;
    setPullOrder(state, base, k, n, "ai");
    out.push(`pull:${k}`);
  }
  R.orders = R.orders.filter((o) => o.by === "player" || want[o.key] != null);
  for (const [k, n] of Object.entries(want)) {
    const o = R.orders.find((x) => x.key === k);
    if (o && o.by === "player") continue;
    if (o && o.n === n) continue;
    setReloadOrder(state, base, k, n, "ai");
    out.push(k);
  }
  return out;
}
// The governor upgrades an ammo bench into a reloading bench once the base has inputs to load with (brass, powder
// and primers for a few days' work) and can pay without its gun parts falling under 3.
export function autoReloadBench(state, base) {
  if (countAll(base, "reload_bench") || base.construction.some((c) => c.type === "reload_bench")) return "";
  const st = base.stock;
  if (!(num(st.brass) >= 100 && num(st.powder) + num(st.blackpowder) >= 100 && num(st.primers) + num(st.matchprimers) >= 100 && num(st.gunparts) >= RELOAD.UP.cost.gunparts + 3)) return "";
  const b = base.buildings.find((x) => x.type === "ammo_bench" && !x.broken);
  if (!b || !canUpgradeAmmoBench(state, base, b.id).ok) return "";
  return queueReloadUpgrade(state, base, b.id);
}
// The governor's trade wants for the bench's inputs (autopilot.js needs: 1.2+ is bought, 0.6- is sold): with a
// reloading bench powder and primers are bought below RELOAD.STOCK (1.9 under a quarter of it), never sold; brass is
// kept. Without one they are trade goods (0.5: sold), unless there is an ammo bench to upgrade (kept: 0.9).
export function reloadNeeds(state, base) {
  const st = base.stock;
  if (!hasReloadBench(base) && !base.construction.some((c) => c.type === "reload_bench")) return countAll(base, "ammo_bench") ? { brass: 0.9, powder: 0.9, primers: 0.9, blackpowder: 0.9, matchprimers: 0.9 } : { brass: 0.5, powder: 0.5, primers: 0.5, blackpowder: 0.9, matchprimers: 0.9 }; // an ammo bench: kept for the upgrade
  const lvl = (have, target) => (have < target / 4 ? 1.9 : have < target ? 1.4 : 0.9);
  return { brass: 0.9, powder: lvl(num(st.powder), RELOAD.STOCK.powder), primers: lvl(num(st.primers), RELOAD.STOCK.primers), blackpowder: 0.9, matchprimers: 0.9 };
}
// How many the governor asks for in one deal (autopilot.js caps).
export const reloadCaps = (state, base) => ({ powder: Math.max(0, RELOAD.STOCK.powder - num(base.stock.powder)), primers: Math.max(0, RELOAD.STOCK.primers - num(base.stock.primers)), brass: 0 });

// ---------- the other groups ----------
const h = (...p) => hash01(...p);
// Brass back from a group's fights (arsenal.js takeArsenalRounds: the rounds they spend).
export function groupBrass(f, n) {
  if (!f || !f.stock || !(n > 0)) return;
  f.stock.brass = num(f.stock.brass) + Math.floor(n * RELOAD.GROUP.brass);
}
// A group's day (arsenal.js arsenalDaily): sellers restock; a group with a workshop buys what it lacks every
// buyEvery days and loads rounds from its brass, powder, primers and scrap into its ammo count. Returns the rounds made.
// A group's reloading bench by your bench's code (docs/adr/0001-ai-parity.md): its best mechanic at home operates it,
// on the calibre its guns are shortest of (rounds against guns, its common load), as many rounds as your operator would
// make (dayRate at the recipe's Mechanics, inputsFor), through runReload (the same inputs, factory or handload keys,
// the dies' wear). Powder and primers: a trading or military group's own when it is made (its creation seed), then
// bought from another group (groupBuyReload) and pulled from rounds it cannot use (groupPull); none from nowhere.
export function groupReloadDaily(state, f, workshop) {
  if (!f || !f.stock || !f.alive) return 0;
  const G = RELOAD.GROUP, d = day(state);
  const sell = G.stock[f.type];
  if (sell && !f.reloadSeeded) { for (const k of ["powder", "primers"]) f.stock[k] = Math.max(num(f.stock[k]), Math.round(f.pop * sell[k][0] * 10)); f.reloadSeeded = true; }
  if (!workshop) return 0;
  groupPull(state, f);
  if (num(f.stock.brass) >= G.buyBrass && (num(f.stock.powder) < Math.min(G.want.powder, num(f.stock.brass) * G.pc) / 2 || num(f.stock.primers) < Math.min(G.want.primers, num(f.stock.brass)) / 2) && (f.reloadDeal == null || d - f.reloadDeal >= G.buyEvery)) groupBuyReload(state, f, d);
  const home = f.homes ? Object.values(f.homes).find((h) => h && h.type === "hub" && h.stock === f.stock) : null;
  if (!home) return 0;
  const people = (f.people || []).filter((s) => s.alive !== false && s.location && s.location.kind === "member" && s.location.partyId == null && (s.health ?? 100) >= 60);
  const op = people.sort((a, b) => mech(b) - mech(a) || a.id - b.id)[0] || null;
  if (!op) return 0;
  // The calibre short the most: its rounds in the stores against the guns on the books that shoot it.
  const guns = {};
  for (const it of (f.arsenal && f.arsenal.items) || []) { const c = calOf(it && it.key); if (c && CALIBERS[c]) guns[c] = (guns[c] || 0) + 1; }
  let cal = null, worst = Infinity;
  for (const [c, n] of Object.entries(guns)) {
    const t = baseType(c), rec = loadRecipe(c, t);
    if (!rec || mech(op) < rec[0]) continue;
    const have = Object.entries(f.stock).filter(([k]) => { const r = roundOf(k); return r && r.cal === c; }).reduce((a, [, q]) => a + num(q), 0);
    const per = have / n;
    if (per < worst) { worst = per; cal = c; }
  }
  if (!cal) return 0;
  const type = baseType(cal), rec = loadRecipe(cal, type);
  const inp = inputsFor(state, home, cal, type);
  const n0 = Math.min(G.max, dayRate(rec[1], mech(op)), inp.n);
  if (!(n0 >= 1)) return 0;
  const n = runReload(state, home, null, { reload: { cal, type, n: n0, order: { key: ammoKey(cal, type) } }, op });
  f.reloaded = num(f.reloaded) + n;
  note(state, "bench", n); // ledger.js (a test switch)
  return n;
}
// A group short of brass pulls rounds of the calibres its guns do not shoot (coarse: its one ammo count, by its kind's
// mix of calibres against the calibres of the guns in its arsenal), into brass, powder, primers and scrap. Returns n.
export function groupPull(state, f) {
  const P = RELOAD.PULL, G = P.GROUP;
  if (!f || !f.stock || num(f.stock.brass) >= G.below) return 0;
  const guns = {};
  for (const it of (f.arsenal && f.arsenal.items) || []) { const c = calOf(it && it.key); if (c) guns[c] = true; }
  if (!Object.keys(guns).length) return 0;
  // Their rounds by key (docs/adr/0001-ai-parity.md): the calibres none of their guns shoot, a share of them pulled.
  const keys = Object.keys(f.stock).filter((k) => { const r = roundOf(k); return r && !guns[r.cal] && num(f.stock[k]) >= 1; });
  const unused = keys.reduce((a, k) => a + Math.floor(num(f.stock[k])), 0);
  if (!(unused > 0)) return 0;
  const n = Math.floor(Math.min(G.max, unused * G.share));
  if (!(n >= 1)) return 0;
  let left = n, charge = 0;
  for (const k of keys) { if (left <= 0) break; const q = Math.min(left, Math.floor(num(f.stock[k]))); f.stock[k] -= q; left -= q; charge += q * pullYield(k).powder; }
  f.stock.brass = num(f.stock.brass) + n;
  f.stock.powder = num(f.stock.powder) + Math.floor(charge);
  f.stock.primers = num(f.stock.primers) + Math.floor(n * P.PRIMER);
  f.stock.scrap = num(f.stock.scrap) + Math.floor(n / RELOAD.LEAD);
  f.pulled = num(f.pulled) + n;
  return n;
}
// Powder and primers bought from a trading or military group not at war with them (the hunger trade's pattern), as
// much as their brass would load (at most G.want), paid in scrap at worth × markup out of half the scrap they can spare
// (above G.keepScrap a head, at least 10).
export function groupBuyReload(state, f, d = day(state)) {
  const G = RELOAD.GROUP;
  const wars = new Set(warsOf(state, f).flatMap((w) => [w.a, w.b]));
  const sellers = (state.factions || []).filter((o) => o.alive && o !== f && !o.outsider && o.stock && G.stock[o.type] && !wars.has(o.id) && relation(state, f, o) > G.rel && (num(o.stock.powder) >= 20 || num(o.stock.primers) >= 20));
  if (!sellers.length) return null;
  const o = sellers.sort((a, b) => num(b.stock.powder) + num(b.stock.primers) - num(a.stock.powder) - num(a.stock.primers) || a.id - b.id)[0];
  const got = {};
  let owed = 0;
  for (const k of ["powder", "primers"]) {
    const cap = Math.min(G.want[k], num(f.stock.brass) * (k === "powder" ? G.pc : 1));
    const q = Math.max(0, Math.min(Math.floor(cap - num(f.stock[k])), Math.floor(num(o.stock[k]) / 2)));
    if (q > 0) { got[k] = q; owed += q * supValue(k) * G.markup; }
  }
  if (!Object.keys(got).length) return null;
  const spare = Math.floor(Math.max(0, num(f.stock.scrap) - Math.max(10, f.pop * G.keepScrap)) / 2);
  const q = Math.min(spare, Math.ceil(owed / SUPPLIES.scrap.value));
  if (q <= 0) return null;
  const paid = { scrap: q }, paidV = q * SUPPLIES.scrap.value;
  const share = Math.min(1, paidV / owed);
  for (const [k, q] of Object.entries(got)) { const g = Math.floor(q * share); got[k] = g; o.stock[k] -= g; f.stock[k] = num(f.stock[k]) + g; }
  for (const [k, q] of Object.entries(paid)) { f.stock[k] -= q; o.stock[k] = num(o.stock[k]) + q; }
  f.reloadDeal = d;
  return { from: o, got, paid };
}
// A merchant caravan's powder, primers and brass (visitors.js merchantGoods), on dice of their own.
export function merchantReload(state, v) {
  const M = RELOAD.MERCHANT;
  if (!v || !v.stock || !M.on) return;
  const roll = (k, [lo, hi]) => lo + Math.floor(h(state.seed, "mreload", v.serial, k) * (hi - lo + 1));
  if (v.spec === "arms") { for (const k of ["powder", "primers", "brass"]) v.stock[k] = roll(k, M.arms[k]); return; }
  if (h(state.seed, "mreloadany", v.serial) < M.other.p) for (const k of ["powder", "primers"]) v.stock[k] = roll(k, M.other[k]);
}
