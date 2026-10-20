// Repairing gear (docs/weapons-overhaul-plan.md sections 21 and 25): Tarkov-like, every repair costs some of the
// item's maximum durability for good.
//
// Condition: one field for all gear (section 25): item.dur (uses left) up to item.durMax (crafting.js itemDur /
// itemDurMax; GEAR dur when the item has no maximum of its own). A gun's quality (0.4–1) is its make, not its wear:
// a repair never changes it. Armour durability points are the same dur / durMax (armour.js wears them per hit).
//
// Where: at a base with a bench (buildings.js family "bench"): a crafting bench repairs makeshift and soft things only
// (padding, soft armour, packs, camp kit, fishing gear, bows), a workbench everything, a master workbench everything
// for 30% less lost maximum. Anywhere with a field repair kit (GEAR repairkit, 5 uses): half what a bench restores,
// twice the lost maximum, no other inputs. Who: people on the Craft role at the base (the repair queue below; a field
// kit: the team's best), with the right skill: Mechanics for guns, hard armour, plates and tools, Crafting for soft
// goods. Gates: guns Mechanics 3, armour of AC 4+ Mechanics 5. What it takes (REPAIR_KINDS): a gun 1 gun part per 20%
// of its full durability restored and 1 scrap; soft armour a Kevlar repair kit and 2 scrap; makeshift padding 3
// scrap; helmets and hard pieces 1 machine part and 2 scrap; steel plates 4 scrap and 1 fuel (welding); ceramic plates
// cannot be repaired; makeshift weapons and tools 1–3 scrap, and 30 wood for wooden ones.
//
// The lost maximum: a repair restores the item to its current maximum, and the maximum drops by
//   restored × max(0.08, 0.25 − 0.01 × skill)            (× 2 with a field kit, × 0.7 at a master workbench)
// (a Mechanics 12 repair loses 13% of what it restores, Mechanics 3 22%). It never rises again. An item whose maximum
// is below 20% of its full durability (GEAR dur) is worn out: it cannot be repaired (it works until it breaks; salvage
// it for parts: inventory.js salvageAt). item.durBase: the maximum before its first repair (valuation.js prices a
// lowered maximum down).
import { keyWord } from "./water.js"; // supplies as words: "9mm FMJ", "rounds"
import { GEAR, SKILL_NAMES } from "./data.js";
import { atBase, skill, log, newId } from "./world.js";
import { benchTier } from "./buildings.js";
import { itemDur, itemDurMax, wear } from "./crafting.js";
import { burnShare } from "./woodcutting.js";
import { itemAt, parseLoc, placeOfLoc, storageFor, salvageAt } from "./inventory.js";
import { itemValue } from "./valuation.js";
import { gainXp, USE } from "./skills.js";
import { driftOf } from "./gunmods.js"; // budget sights off zero (re-zeroed at a workbench: rezeroHour)

export const REPAIR = {
  LOSS_BASE: 0.25, LOSS_PER_SKILL: 0.01, LOSS_MIN: 0.08, KIT_LOSS: 2, KIT_RESTORE: 0.5, MASTER_LOSS: 0.7,
  WORN_OUT: 0.2,     // a maximum under 20% of full durability: worn out
  GUN_STEP: 0.2,     // a gun part per 20% of full durability restored
  WOOD: 30,          // wood for a wooden handle or stock (3 kg)
  AUTO_BELOW: 0.6,   // the autopilot repairs gear below 60% of its maximum
};
// Materials of the armour pieces (section 17), where GEAR has none of its own (armour.js may add GEAR material / ac).
const MATERIAL = {
  vest: "soft", tacvest: "soft", softinsert: "soft", plate: "soft", ceramicplate: "ceramic", steelplate: "steel", scrapvest: "steel",
  tirevest: "padding", sportspads: "padding", padding: "padding", shinguards: "padding",
  kneeguards: "hard", riotarms: "hard", riotlegs: "hard", bikehelmet: "hard", footballhelmet: "hard", riothelmet: "hard", milhelmet: "hard", rivethelmet: "hard",
};
const AC = { vest: 2, tacvest: 2, softinsert: 2, steelplate: 4, ceramicplate: 5, plate: 2, scrapvest: 3, milhelmet: 3, riothelmet: 2, riotarms: 2, riotlegs: 2 };
export const materialOf = (key) => (GEAR[key] && GEAR[key].material) || MATERIAL[key] || null;
export const acOf = (key) => (GEAR[key] && Number.isFinite(GEAR[key].ac) ? GEAR[key].ac : AC[key] || 0);
const ARMOUR = ["armor", "head", "arms", "legs", "insert"]; // insert: a plate carrier's plates (data-kit.js)
const WOODEN = ["bat", "fireaxe", "sledge", "spear", "machete"]; // a wooden handle or haft (besides what burns: GEAR burnShare)
const GUN_CATS = ["pistol", "shotgun", "rifle", "automatic"];

// The kinds of repair: skill and its minimum, what it takes, work-hours, and whether a crafting bench (tier 1) will do.
// in: supplies; gearIn: items from the armory; perGun: gun parts by the share restored.
export const REPAIR_KINDS = {
  gun:     { name: "gun",                 skill: "mechanics", min: 3, in: { scrap: 1 }, perGun: true, hours: 2 },
  zipgun:  { name: "makeshift gun",       skill: "mechanics", min: 2, in: { scrap: 2 }, hours: 2, soft: true },
  bow:     { name: "bow",                 skill: "crafting",  min: 2, in: { scrap: 1 }, hours: 1, soft: true },
  melee:   { name: "weapon or tool",      skill: "mechanics", min: 1, in: { scrap: 1 }, hours: 1 },
  makeshift: { name: "makeshift weapon",  skill: "mechanics", min: 0, in: { scrap: 1 }, hours: 1, soft: true },
  soft:    { name: "soft armour",         skill: "crafting",  min: 3, in: { scrap: 2 }, gearIn: { kevlarkit: 1 }, hours: 3, soft: true },
  padding: { name: "makeshift padding",   skill: "crafting",  min: 0, in: { scrap: 3 }, hours: 1, soft: true },
  hard:    { name: "hard armour",         skill: "mechanics", min: 3, in: { parts: 1, scrap: 2 }, hours: 2 },
  hardmk:  { name: "makeshift helmet",    skill: "mechanics", min: 1, in: { scrap: 2 }, hours: 1, soft: true },
  steel:   { name: "steel plate",         skill: "mechanics", min: 3, in: { scrap: 4, fuel: 1 }, hours: 4 },
  camp:    { name: "camp kit",            skill: "crafting",  min: 1, in: { scrap: 1 }, hours: 1, soft: true },
  fish:    { name: "fishing gear",        skill: "crafting",  min: 0, in: { scrap: 1 }, hours: 1, soft: true },
  cart:    { name: "cart wheel",          skill: "mechanics", min: 1, in: { parts: 1, scrap: 1 }, hours: 2 }, // carts.js: a wheel, its axle and bearings (a broken cart drags)
  recharge: { name: "battery swap",       skill: "mechanics", min: 0, in: {}, gearIn: { batteries: 1 }, hours: 0.5, soft: true }, // electronic ear protection, a team headset (data-helmets.js recharge: nothing off the maximum)
};

// The kind of repair an item takes ({ kind, def }), { refuse: why }, or null (it does not wear, or it is used up
// rather than mended: med kits, water filters, makeshift gun parts, the repair kits themselves).
export function repairKind(item) {
  const d = item && GEAR[item.key];
  if (!d || !d.dur || d.tabs || d.groom || d.count) return null;
  if (d.medKit || d.water || d.throw || d.use || d.cat === "gunmod" || item.key === "repairkit" || item.key === "kevlarkit") return null;
  if (d.ears && d.slot === "pack") return null; // earplugs (hearing.js settleEars): a strip of pairs, used up a pair a fight
  const k = (kind) => ({ kind, def: REPAIR_KINDS[kind] });
  if (d.noRepair) return { refuse: d.noRepair }; // a cracked ballistic visor (data-helmets.js)
  if (d.recharge) return k("recharge"); // new batteries (data-helmets.js)
  if (d.cart) return k("cart"); // carts.js: a wheelbarrow, a hand cart
  if (ARMOUR.includes(d.slot)) {
    const mat = materialOf(item.key) || (d.makeshift ? "padding" : "hard");
    if (mat === "ceramic") return { refuse: `Ceramic plates cannot be repaired: the ${item.name} has to be replaced.` };
    if (mat === "soft") return k("soft");
    if (mat === "padding") return k("padding");
    if (mat === "steel") return k("steel");
    return k(d.makeshift ? "hardmk" : "hard");
  }
  if (d.slot === "weapon") {
    if (d.cat === "bow") return k(d.makeshift ? "zipgun" : "bow");
    if (GUN_CATS.includes(d.cat)) return k(d.makeshift ? "zipgun" : "gun");
    return k(d.makeshift ? "makeshift" : "melee");
  }
  if (d.fish) return k("fish");
  if (d.heat || d.cat === "camp" || d.cat === "clothing" || d.slot === "backpack") return k("camp");
  return k(d.makeshift ? "makeshift" : "melee");
}
// The skill minimum for this item: the kind's, Mechanics 5 for armour of AC 4 or more.
const minFor = (item, def) => (ARMOUR.includes(GEAR[item.key].slot) && acOf(item.key) >= 4 ? Math.max(def.min, 5) : def.min);
// The share of what is restored that comes off the maximum, by the repairer's skill (a field kit: twice; a master
// workbench: 30% less).
export function lossRate(skillLevel, { kit = false, tier = 2 } = {}) {
  const r = Math.max(REPAIR.LOSS_MIN, REPAIR.LOSS_BASE - REPAIR.LOSS_PER_SKILL * Math.max(0, skillLevel || 0));
  return r * (kit ? REPAIR.KIT_LOSS : 1) * (!kit && tier >= 3 ? REPAIR.MASTER_LOSS : 1);
}
const round1 = (v) => Math.round(v * 10) / 10;
// Is it worn out (its maximum under 20% of full)?
export const wornOut = (item) => {
  const d = item && GEAR[item.key];
  return !!(d && d.dur && itemDurMax(item) < REPAIR.WORN_OUT * d.dur - 1e-9);
};
// What one repair would do: { restore, oldMax, newMax, dur, loss } (restore = what comes back; newMax = the max after).
export function repairMath(item, skillLevel, opts = {}) {
  const max = itemDurMax(item), dur = itemDur(item);
  const gap = Math.max(0, max - dur);
  const restore = opts.kit ? Math.ceil(gap * REPAIR.KIT_RESTORE - 1e-9) : gap;
  const loss = GEAR[item.key] && GEAR[item.key].recharge ? 0 : round1(restore * lossRate(skillLevel, opts)); // a battery swap wears nothing out
  const newMax = round1(Math.max(1, max - loss));
  return { restore, oldMax: max, newMax, dur: Math.min(newMax, dur + restore), loss: round1(max - newMax) };
}
// What it takes: { supplies, gear } (gun parts by the share restored).
export function repairInputs(item, kind, restore) {
  const def = REPAIR_KINDS[kind];
  const supplies = { ...def.in };
  if (def.perGun) supplies.gunparts = Math.max(1, Math.ceil(restore / (REPAIR.GUN_STEP * GEAR[item.key].dur) - 1e-9));
  if (kind === "melee" || kind === "makeshift") {
    supplies.scrap = Math.min(3, 1 + Math.floor((GEAR[item.key].value || 0) / 20));
    if (burnShare(item.key) >= 0.3 || WOODEN.includes(item.key)) supplies.wood = REPAIR.WOOD; // a new handle
  }
  return { supplies, gear: { ...(def.gearIn || {}) } };
}
const have = (base, k) => (k === "wood" || k === "fuel" || k === "scrap" ? Math.max(0, base.stock[k] || 0) : Math.max(0, base.stock[k] || 0));
const benchName = (t) => (t >= 3 ? "master workbench" : t === 2 ? "workbench" : t === 1 ? "crafting bench" : "no bench");
// The people at a base who could do this repair: on the Craft role (not in bed) with the skill, best first.
export function repairers(state, base, item) {
  const rk = repairKind(item);
  if (!rk || !rk.def) return [];
  const min = minFor(item, rk.def);
  return atBase(state, base.id).filter((s) => s.role === "craft" && !s.inBed && skill(s, rk.def.skill) >= min)
    .sort((a, b) => skill(b, rk.def.skill) - skill(a, rk.def.skill) || a.id - b.id);
}

// Everything the Repair button shows: { ok, reason, kind, skill, min, restore, oldMax, newMax, inputs, hours, who,
// tier, kit }. base: where (null in the field: a kit only). by: who does it (default: the best repairer there).
// opts.kit: with a field repair kit.
export function repairInfo(state, base, item, { by = null, kit = false } = {}) {
  const out = { ok: false, reason: "", kind: null, skill: null, min: 0, restore: 0, oldMax: 0, newMax: 0, inputs: { supplies: {}, gear: {} }, hours: 0, who: null, tier: 0, kit };
  const d = item && GEAR[item.key];
  if (!d) { out.reason = "Nothing to repair."; return out; }
  const rk = repairKind(item);
  if (!rk) { out.reason = d.dur ? `The ${item.name} is used up, not mended.` : `The ${item.name} does not wear.`; return out; }
  if (rk.refuse) { out.reason = rk.refuse; return out; }
  const def = rk.def;
  out.kind = rk.kind; out.skill = def.skill; out.min = minFor(item, def); out.hours = def.hours;
  out.tier = base ? benchTier(base) : 0;
  if (wornOut(item)) { out.reason = `The ${item.name} is worn out (its maximum is under ${Math.round(REPAIR.WORN_OUT * 100)}% of new): it cannot be repaired. Salvage it for parts.`; return out; }
  if (itemDur(item) >= itemDurMax(item)) { out.reason = `The ${item.name} needs no repair.`; return out; }
  const who = by || (base ? repairers(state, base, item)[0] || null : null);
  out.who = who;
  const lvl = who ? skill(who, def.skill) : 0;
  const m = repairMath(item, lvl, { kit, tier: out.tier });
  out.restore = m.restore; out.oldMax = m.oldMax; out.newMax = m.newMax;
  if (!kit) out.inputs = repairInputs(item, rk.kind, m.restore);
  if (!kit) {
    if (!base) out.reason = "Repairs need a bench at a base (or a field repair kit).";
    else if (out.tier < 1) out.reason = "Needs a crafting bench (or better) at this base, or a field repair kit.";
    else if (out.tier < 2 && !def.soft && !d.makeshift) out.reason = `A crafting bench only mends makeshift and soft things: the ${item.name} needs a workbench.`;
  }
  if (!out.reason && who && skill(who, def.skill) < out.min) out.reason = `Needs ${SKILL_NAMES[def.skill]} ${out.min}+ (${who.name.split(" ")[0]} has ${skill(who, def.skill)}).`;
  if (!out.reason && !who) out.reason = base ? `Needs someone on the Craft role here with ${SKILL_NAMES[def.skill]} ${out.min}+.` : "Nobody to do it.";
  if (!out.reason && !kit && base) {
    for (const [k, v] of Object.entries(out.inputs.supplies)) if (have(base, k) < v) { out.reason = `Needs ${v} ${keyWord(k)} (have ${Math.floor(have(base, k))}).`; break; }
    if (!out.reason) for (const [k, v] of Object.entries(out.inputs.gear)) if (base.armory.filter((it) => it && it.key === k).length < v) { out.reason = `Needs a ${GEAR[k].name.toLowerCase()} in the armory.`; break; }
  }
  out.ok = !out.reason;
  return out;
}
// The preview line: "Max durability 45 → 41; restores 12; 1 gun part, 1 scrap; 2 h; Ana (Mechanics 6)".
export function repairPreview(info) {
  if (!info.kind) return info.reason;
  const ins = [...Object.entries(info.inputs.supplies).map(([k, v]) => `${v} ${k === "gunparts" ? "gun part" + (v === 1 ? "" : "s") : k === "parts" ? "machine part" + (v === 1 ? "" : "s") : k === "wood" ? "wood" : k}`),
    ...Object.entries(info.inputs.gear).map(([k]) => GEAR[k].name.toLowerCase())];
  const who = info.who ? `${info.who.name.split(" ")[0]} (${SKILL_NAMES[info.skill]} ${skill(info.who, info.skill)})` : `someone with ${SKILL_NAMES[info.skill]} ${info.min}+`;
  return `Max durability ${Math.round(info.oldMax)} → ${Math.round(info.newMax)}, restores ${Math.round(info.restore)}; ${info.kit ? "1 use of a field repair kit" : ins.join(", ") || "nothing"}; ${info.kit ? "on the spot" : `${info.hours} h at the ${benchName(info.tier)}`}; ${who}.${info.reason ? ` ${info.reason}` : ""}`;
}

// Repairs the item now (the math only: inputs are paid by the queue or the kit). by: who (their skill sets the loss).
// Returns { restored, oldMax, newMax, msg }.
export function repairItem(state, base, item, by, { kit = false, tier = null } = {}) {
  const rk = repairKind(item);
  if (!rk || !rk.def) return { restored: 0, oldMax: 0, newMax: 0, msg: "Nothing to repair." };
  const t = tier ?? (base ? benchTier(base) : 0);
  const m = repairMath(item, by ? skill(by, rk.def.skill) : 0, { kit, tier: t });
  if (item.durBase == null) item.durBase = itemDurMax(item);
  item.durMax = m.newMax;
  item.dur = m.dur;
  item.repairs = (item.repairs || 0) + 1;
  if (by && state) gainXp(state, by, rk.def.skill, USE.repair);
  const msg = `${by ? `${by.name.split(" ")[0]} repaired` : "Repaired"} the ${item.name}${kit ? " with a field kit" : ""}: ${Math.round(m.dur)} of ${Math.round(m.newMax)} (max ${Math.round(m.oldMax)} → ${Math.round(m.newMax)}).`;
  return { restored: m.restore, oldMax: m.oldMax, newMax: m.newMax, msg };
}

// ---------- the base's repair queue ----------
// base.gearRepairs: [{ id, item, hours, progress, paid, gearPaid, urgent, away }]. Queueing pays the inputs; the item
// stays where it is (worn, held or in the armory: nobody is stripped of their gear) and the crafters work on it while
// it is at the base (in the evenings, between trips). A team that takes it away pauses the job; away for
// REPAIR.AWAY_HOURS, or broken, the job is dropped (half the inputs back). urgent: the autopilot's urgent repairs
// (planRepairs) go first.
export const repairQueue = (base) => base.gearRepairs || (base.gearRepairs = []);
export const MAX_REPAIR_QUEUE = 8;
REPAIR.AWAY_HOURS = 240;
const stats = (state) => state.repairStats || (state.repairStats = { bench: 0, field: 0, paid: {} });
// Is the item at this base: in its armory, or worn, held or carried by someone there?
export function atBaseItem(state, base, item) {
  if (!item) return false;
  if (base.armory.includes(item)) return true;
  return atBase(state, base.id).some((s) => Object.values(s.gear || {}).includes(item) || (s.pockets || []).includes(item) || ((s.gear && s.gear.backpack && s.gear.backpack.contents) || []).includes(item));
}
// Queues a repair of the item at loc at this base. Returns a message. opts.urgent: ahead of the others.
export function queueRepair(state, base, loc, { urgent = false } = {}) {
  const item = itemAt(state, loc);
  if (!item) return "Nothing there.";
  if (parseLoc(loc).o === "body") return "Take it first.";
  if (placeOfLoc(state, loc) !== `base:${base.id}`) return "Only things at this base can be repaired here.";
  if (repairQueue(base).some((j) => j.item === item)) return `The ${item.name} is already queued for repair.`;
  if (repairQueue(base).length >= MAX_REPAIR_QUEUE) return `The repair queue is full (${MAX_REPAIR_QUEUE}).`;
  const info = repairInfo(state, base, item);
  const noCrafter = info.reason && /Craft role/.test(info.reason) && !info.who;
  if (!info.ok && !noCrafter) return info.reason;
  if (noCrafter) { // queued anyway: it waits for a crafter (the inputs still have to be here)
    for (const [k, v] of Object.entries(info.inputs.supplies)) if (have(base, k) < v) return `Needs ${v} ${keyWord(k)} (have ${Math.floor(have(base, k))}).`;
    for (const [k, v] of Object.entries(info.inputs.gear)) if (base.armory.filter((it) => it && it.key === k).length < v) return `Needs a ${GEAR[k].name.toLowerCase()} in the armory.`;
  }
  const rs = stats(state);
  for (const [k, v] of Object.entries(info.inputs.supplies)) { base.stock[k] = (base.stock[k] || 0) - v; rs.paid[k] = (rs.paid[k] || 0) + v; }
  const gearPaid = [];
  for (const [k, v] of Object.entries(info.inputs.gear)) for (let i = 0; i < v; i++) { gearPaid.push(...base.armory.splice(base.armory.findIndex((it) => it && it.key === k), 1)); rs.paid[k] = (rs.paid[k] || 0) + 1; }
  rs.bench++;
  const job = { id: newId(), item, hours: info.hours, progress: 0, paid: { ...info.inputs.supplies }, gearPaid };
  const q = repairQueue(base);
  if (urgent) { job.urgent = true; const at = q.findIndex((j) => !j.urgent); q.splice(at < 0 ? q.length : at, 0, job); }
  else q.push(job);
  return `${item.name} queued for repair at ${base.name} (${info.hours} h; it stays in use, mended while it is here)${noCrafter ? ": nobody on the Craft role can do it yet" : ""}.`;
}
// Cancels a queued repair: untouched, everything paid comes back; started, half (the kit is used up).
export function cancelRepair(state, base, id) {
  const q = repairQueue(base);
  const job = q.find((j) => j.id === id);
  if (!job) return "That repair is gone.";
  const full = job.progress <= 0;
  for (const [k, v] of Object.entries(job.paid || {})) base.stock[k] = (base.stock[k] || 0) + (full ? v : Math.ceil(v / 2));
  if (full) base.armory.push(...(job.gearPaid || []));
  q.splice(q.indexOf(job), 1);
  return `Cancelled the repair of the ${job.item.name}.`;
}
// Why a queued repair is not moving ("" when it is).
export function repairJobStatus(state, base, job) {
  const rk = repairKind(job.item);
  if (!rk || !rk.def) return "Nothing to repair";
  if (!atBaseItem(state, base, job.item)) return "Not here (out with a team)";
  if (benchTier(base) < (rk.def.soft || GEAR[job.item.key].makeshift ? 1 : 2)) return "Needs a bench here";
  if (!repairers(state, base, job.item).length) return `No crafter with ${SKILL_NAMES[rk.def.skill]} ${minFor(job.item, rk.def)}+`;
  return "";
}
// Hourly (world.js, before craftingHour): the crafters work the first repair they can (urgent ones first); a base
// whose crafters repaired this hour does no crafting this hour (base.gearRepairHour). Finished: the item is repaired
// where it is, by the best of them.
export function repairHour(state) {
  for (const base of state.bases) {
    const q = base.gearRepairs;
    if (!q || !q.length) continue;
    for (const j of [...q]) { // gone for good: broken, or away too long
      if (atBaseItem(state, base, j.item)) { delete j.away; continue; }
      if (j.away == null) j.away = state.hour;
      if ((j.item.dur ?? 1) <= 0 || state.hour - j.away >= REPAIR.AWAY_HOURS) { j.progress = Math.max(j.progress, 0.001); cancelRepair(state, base, j.id); }
    }
    const job = q.find((j) => j.urgent && !repairJobStatus(state, base, j)) || q.find((j) => !repairJobStatus(state, base, j));
    if (!job) continue;
    const team = repairers(state, base, job.item);
    const sk = REPAIR_KINDS[repairKind(job.item).kind].skill;
    job.progress += team.reduce((a, s) => a + 1 + 0.03 * skill(s, sk), 0);
    base.gearRepairHour = state.hour;
    if (job.progress < job.hours) continue;
    q.splice(q.indexOf(job), 1);
    log(state, repairItem(state, base, job.item, team[0]).msg, "good");
  }
}

// ---------- re-zeroing budget sights (user pick 2026-10-10) ----------
// A budget sight, magnifier or set of rings drifts off zero a fight at a time (gunmods.js driftOf). At a base with a
// workbench (tier 2+) and someone home, every morning (REZERO_HOUR) the guns kept there (the armory, the residents'
// hands, pockets and packs) have their budget sights re-zeroed: free, an hour at the bench; their wear (dur) stays.
export const REZERO_HOUR = 7;
export function rezeroHour(state) {
  if ((state.hour || 0) % 24 !== REZERO_HOUR) return 0;
  let total = 0;
  for (const base of state.bases || []) {
    if (benchTier(base) < 2) continue;
    const home = atBase(state, base.id);
    if (!home.length) continue;
    const guns = [...(base.armory || [])];
    for (const s of home) guns.push(s.gear && s.gear.weapon, ...(s.pockets || []), ...((s.gear && s.gear.backpack && s.gear.backpack.contents) || []));
    let n = 0;
    for (const g of guns) for (const m of Object.values((g && g.mods) || {})) if (m && driftOf(m) > 0) { m.zero = 0; n++; }
    else if (m && m.zero) m.zero = 0;
    if (n) log(state, `${base.name}: ${n} budget sight${n === 1 ? "" : "s"} re-zeroed at the workbench.`, "info");
    total += n;
  }
  return total;
}

// ---------- a field repair kit ----------
// The kit a team or a person at a place can use: in someone's pockets or pack, or in the cargo / armory. Returns the
// kit item and a function that wears it, or null.
function findKit(state, place) {
  const st = storageFor(state, place);
  const [kind, idStr] = String(place).split(":");
  const people = (state.survivors || []).filter((s) => s.alive && s.location && (kind === "base" ? s.location.kind === "base" && s.location.baseId === Number(idStr) : s.location.kind === "party" && s.location.partyId === Number(idStr)));
  for (const s of people) {
    const spots = [...(s.pockets || []).map((it, i) => [it, () => { s.pockets[i] = null; }]), ...((s.gear && s.gear.backpack && s.gear.backpack.contents) || []).map((it, i) => [it, () => { s.gear.backpack.contents[i] = null; }])];
    for (const [it, drop] of spots) if (it && it.key === "repairkit") return { kit: it, drop };
  }
  if (st) for (const it of st.list) if (it && it.key === "repairkit") return { kit: it, drop: () => st.list.splice(st.list.indexOf(it), 1) };
  return null;
}
// What a field repair of the item at loc would do (repairInfo with kit: true and the best person there).
export function fieldRepairInfo(state, loc) {
  const item = itemAt(state, loc);
  const place = placeOfLoc(state, loc);
  const info = repairInfo(state, null, item, { kit: true, by: bestAt(state, place, item) });
  if (info.ok && !findKit(state, place)) { info.ok = false; info.reason = "Needs a field repair kit here."; }
  return info;
}
function bestAt(state, place, item) {
  const rk = repairKind(item);
  if (!rk || !rk.def || !place) return null;
  const [kind, idStr] = place.split(":");
  const people = (state.survivors || []).filter((s) => s.alive && s.location && (kind === "base" ? s.location.kind === "base" && s.location.baseId === Number(idStr) : s.location.kind === "party" && s.location.partyId === Number(idStr)));
  return people.sort((a, b) => skill(b, rk.def.skill) - skill(a, rk.def.skill) || a.id - b.id)[0] || null;
}
// Repairs the item at loc with a field kit (one use of it): now, half the restore, twice the lost maximum. Returns a message.
export function fieldRepair(state, loc) {
  const info = fieldRepairInfo(state, loc);
  if (!info.ok) return info.reason;
  const item = itemAt(state, loc);
  const k = findKit(state, placeOfLoc(state, loc));
  if (wear(k.kit, 1)) k.drop();
  const rs = stats(state);
  rs.field++; rs.paid.repairkit = (rs.paid.repairkit || 0) + 1;
  return repairItem(state, null, item, info.who, { kit: true }).msg;
}

// ---------- the buttons (ui/inventory.js, the gun builder) ----------
// What the Repair button on the item at loc would do: at a base the bench queue (repairInfo), in the field a kit
// (fieldRepairInfo). { ...repairInfo, base, field, preview }.
export function repairInfoAt(state, loc) {
  const place = placeOfLoc(state, loc);
  const base = place && place.startsWith("base:") ? (state.bases || []).find((b) => b.id === Number(place.split(":")[1])) || null : null;
  const item = itemAt(state, loc);
  const info = base ? repairInfo(state, base, item) : fieldRepairInfo(state, loc);
  return { ...info, base, field: !base, preview: repairPreview(info) };
}
// Presses it: queues the repair at the base's bench, or repairs with a field kit on the road. Returns the message.
export function repairAt(state, loc) {
  const r = repairInfoAt(state, loc);
  return r.base ? queueRepair(state, r.base, loc) : fieldRepair(state, loc);
}

// ---------- the autopilot ----------
// Which gear to mend first: how much it is needed × how much it is used × how worn it is.
//   need: worn or held by a fighter (their weapon or armour worn in a fight or on the road in the last 30 days, or on
//         the Guard or Hunt role) 3, by anyone else here 2, the only one of its kind here (the only rifle, the only
//         vest) in the armory 2, a spare 0;
//   use:  worn in the last 14 days (item.lastUsed: crafting.js wearSlot / wearHeld) 2, in the last 45 days 1;
//   wear: below 35% of its maximum urgent (×3), below 60% (×1.5), up to 85% only for a fighter's gear in daily use.
// Spares nobody uses are never repaired by the autopilot (a spare gun is salvaged for gun parts when an urgent gun
// needs them).
export const AUTO = { URGENT: 0.35, LOW: REPAIR.AUTO_BELOW, TOP: 0.85, FIGHTER_DAYS: 30, RECENT: 14, LATELY: 45, URGENT_QUEUE: 4 };
const today = (state) => Math.floor(state.hour / 24);
const cond = (it) => { const m = itemDurMax(it); return m ? itemDur(it) / m : 1; };
const kindOf = (it) => { const d = GEAR[it.key]; return d.slot === "weapon" ? `w:${d.cat}` : `s:${d.slot}`; };
const SLOTS_WORN = ["weapon", "armor", "head", "arms", "legs", "tool"];
// A fighter: their weapon or armour worn in the last 30 days (a fight, the road), or on the Guard or Hunt role.
export function isFighter(state, s) {
  if (!s || !s.gear) return false;
  if (s.role === "guard" || s.role === "hunt") return true;
  return ["weapon", "armor", "head", "arms", "legs"].some((k) => s.gear[k] && s.gear[k].lastUsed != null && today(state) - s.gear[k].lastUsed <= AUTO.FIGHTER_DAYS);
}
// The candidates at a base, best first: [{ loc, item, s, score, cond, urgent, need, used }].
export function repairCandidates(state, base) {
  const people = atBase(state, base.id);
  const queued = new Set(repairQueue(base).map((j) => j.item));
  const kinds = {};
  const all = [];
  for (const s of people) for (const slot of SLOTS_WORN) { const it = s.gear && s.gear[slot]; if (it) all.push({ loc: `s:${s.id}:${slot}`, item: it, s }); }
  base.armory.forEach((it, i) => { if (it) all.push({ loc: `armory:${base.id}:list:${i}`, item: it, s: null }); });
  for (const x of all) if (GEAR[x.item.key]) kinds[kindOf(x.item)] = (kinds[kindOf(x.item)] || 0) + 1;
  const out = [];
  for (const x of all) {
    const it = x.item;
    if (!GEAR[it.key] || queued.has(it) || !itemDurMax(it)) continue;
    const rk = repairKind(it);
    if (!rk || (!rk.def && !rk.refuse)) continue;
    const c = cond(it);
    if (c >= AUTO.TOP) continue;
    const fighter = x.s && isFighter(state, x.s);
    const need = x.s ? (fighter ? 3 : 2) : kinds[kindOf(it)] === 1 ? 2 : 0;
    const age = it.lastUsed == null ? Infinity : today(state) - it.lastUsed;
    const used = age <= AUTO.RECENT ? 2 : age <= AUTO.LATELY ? 1 : 0;
    if (need === 0 && used === 0) continue; // a spare nobody uses
    if (c >= AUTO.LOW && !(need >= 3 && used >= 2)) continue; // no over-repair: 60–85% only for a fighter's gear in daily use
    const urgent = c < AUTO.URGENT && need >= 2;
    const score = (need + used) * (c < AUTO.URGENT ? 3 : c < AUTO.LOW ? 1.5 : 0.5) + (1 - c);
    out.push({ loc: x.loc, item: it, s: x.s, score, cond: c, urgent, need, used });
  }
  return out.sort((a, b) => b.score - a.score || a.cond - b.cond || a.loc.localeCompare(b.loc));
}
// Inputs held back from crafts and builds while an urgent repair waits for them (autopilot.js waterHold): this hour's.
export const repairHold = (state, base, k) => (base.repairHold && base.repairHold.hour >= state.hour - 1 ? base.repairHold[k] || 0 : 0);
// The bench tier an urgent repair here needs and the base lacks (0: none). autopilot.js buildWishes.
export function benchWanted(state, base) {
  let want = 0;
  for (const c of repairCandidates(state, base)) {
    const rk = repairKind(c.item);
    if (!c.urgent || !rk.def) continue;
    want = Math.max(want, rk.def.soft || GEAR[c.item.key].makeshift ? 1 : 2);
  }
  return want > benchTier(base, true) ? want : 0;
}
// The skill a crafter needs for the first repair waiting here with nobody on the Craft role able to do it, or null
// (autopilot.js planRoles: a crafter for it). { skill, min, urgent }.
export function repairCrafterWanted(state, base) {
  for (const j of repairQueue(base)) {
    const rk = repairKind(j.item);
    if (!rk || !rk.def || !atBaseItem(state, base, j.item)) continue;
    if (repairers(state, base, j.item).length) return null;
    return { skill: rk.def.skill, min: minFor(j.item, rk.def), urgent: !!j.urgent };
  }
  return null;
}
// A spare gun in the armory to take apart for gun parts: not the only one of its kind here, the cheapest first.
// A gun in the armory that has a twin (in the armory or carried by someone here), the cheapest: the one to take apart
// for parts (an urgent gun repair here; the governor's broken well waiting for scrap, autopilot.js waterSalvage).
export function spareGun(state, base) {
  const isGun = (it) => it && GEAR[it.key] && GEAR[it.key].slot === "weapon" && ["pistol", "shotgun", "rifle", "automatic"].includes(GEAR[it.key].cat);
  const guns = base.armory.filter((it) => isGun(it) && !repairQueue(base).some((j) => j.item === it));
  const n = (k) => base.armory.filter((g) => g && g.key === k).length + atBase(state, base.id).filter((s) => s.gear && s.gear.weapon && s.gear.weapon.key === k).length;
  return guns.filter((g) => n(g.key) > 1).sort((a, b) => itemValue(a) - itemValue(b))[0] || null;
}
// The autopilot's repairs at a base (autopilot.js governBase, hourly): the best candidates first; urgent pieces
// (below 35%) as soon as the inputs are there, several a day (up to AUTO.URGENT_QUEUE waiting); the rest one a day
// while the stores keep a reserve. A fighter's urgent piece that cannot be mended (a ceramic plate, a vest with no
// Kevlar kit here, worn out) is swapped for a like one in better shape from the armory. An urgent gun short of gun
// parts: a spare gun is taken apart for them. Inputs an urgent repair is short of are held back from crafts and builds
// (repairHold). Returns the last message.
export function planRepairs(state, base) {
  if (!base) return "";
  const q = repairQueue(base);
  let msg = "";
  const hold = { hour: state.hour };
  for (const c of repairCandidates(state, base)) {
    const urgentQueued = q.filter((j) => j.urgent).length;
    if (c.urgent ? urgentQueued >= AUTO.URGENT_QUEUE || q.length >= MAX_REPAIR_QUEUE : q.length >= 2 || base.gearRepairDay === today(state)) continue;
    const info = repairInfo(state, base, c.item);
    const waits = c.urgent && !info.ok && !info.who && /Craft role/.test(info.reason); // queued: a crafter is put on it
    if (!info.ok && !waits) {
      if (c.urgent && c.s && /cannot be repaired|Kevlar|worn out|bench/i.test(info.reason)) { const m = rotateWorn(state, base, c); if (m) msg = m; }
      if (c.urgent && /^Needs \d+ /.test(info.reason)) {
        for (const [k, v] of Object.entries(info.inputs.supplies)) if (have(base, k) < v) hold[k] = Math.max(hold[k] || 0, v);
        if (have(base, "gunparts") < (info.inputs.supplies.gunparts || 0)) { const g = spareGun(state, base); if (g) msg = salvageAt(state, `armory:${base.id}:list:${base.armory.indexOf(g)}`); }
      }
      continue;
    }
    const s = info.inputs.supplies;
    if (!c.urgent) {
      if ((s.parts || 0) && (base.stock.parts || 0) - s.parts < 2) continue;
      if ((s.scrap || 0) && (base.stock.scrap || 0) - s.scrap < 6) continue;
      if ((s.fuel || 0) && (base.stock.fuel || 0) - s.fuel < 4) continue;
      if ((s.wood || 0) && (base.stock.wood || 0) - s.wood < 150) continue;
    }
    const r = queueRepair(state, base, c.loc, { urgent: c.urgent });
    if (/queued/.test(r)) { msg = r; if (!c.urgent) base.gearRepairDay = today(state); }
  }
  base.repairHold = Object.keys(hold).length > 1 ? hold : null;
  return msg;
}
// A fighter's urgent piece that cannot be mended here, swapped for a like piece (same slot, as good) in better shape
// from the armory.
function rotateWorn(state, base, c) {
  const slot = GEAR[c.item.key].slot;
  const alt = base.armory.filter((it) => it && GEAR[it.key] && GEAR[it.key].slot === slot && (GEAR[it.key].power || 0) >= (GEAR[c.item.key].power || 0) - 0.3 && cond(it) >= AUTO.LOW)
    .sort((a, b) => (GEAR[b.key].power || 0) - (GEAR[a.key].power || 0) || cond(b) - cond(a))[0];
  if (!alt || !c.s || c.s.gear[slot] !== c.item) return "";
  base.armory.splice(base.armory.indexOf(alt), 1);
  base.armory.push(c.item);
  c.s.gear[slot] = alt;
  return `${c.s.name.split(" ")[0]} swaps the worn ${c.item.name} for the ${alt.name} from the armory.`;
}
// A team on the road (autopilot.js, once a day): a member's urgent weapon or armour mended with a field repair kit the
// team carries, two a day at most a team.
export function autoFieldRepairs(state) {
  for (const p of state.parties) {
    if (p.owner !== "player") continue;
    let n = 0;
    for (const s of (state.survivors || []).filter((x) => x.alive && x.location && x.location.kind === "party" && x.location.partyId === p.id)) {
      for (const slot of ["weapon", "armor", "head", "arms", "legs"]) {
        const it = s.gear && s.gear[slot];
        if (n >= 2 || !it || !itemDurMax(it) || cond(it) >= AUTO.URGENT) continue;
        const loc = `s:${s.id}:${slot}`;
        if (!fieldRepairInfo(state, loc).ok) continue;
        fieldRepair(state, loc);
        n++;
      }
    }
  }
}

// ---------- the stock of parts and kits the autopilot keeps (its trades buy below these) ----------
// Reorder levels by base: gun parts 2 + 1 per 3 guns here; machine parts 3 + 1 per generator, well, ammo bench and
// machine shop; car parts 2 + 2 per car here or out with a team from here; electronics 1 + the radio station and 1
// per 2 night-vision / thermal sights and radios; Kevlar kits 1 per 3 soft vests; field repair kits 2 at a base that
// sends teams out (the hub), 1 elsewhere. A repair waiting short of one raises its target by what it lacks (urgent).
export const PART_SUPPLIES = ["gunparts", "parts", "carparts", "electronics"];
export const PART_KITS = ["kevlarkit", "repairkit"];
const ELEC = new Set(["nvg", "thermal", "thermalscope", "milradio", "handradio", "peq"]);
const memo = new WeakMap();
// Every item at a base: the armory and what the people here wear, hold and carry.
function itemsAt(state, base) {
  const out = base.armory.filter(Boolean);
  for (const s of atBase(state, base.id)) {
    out.push(...Object.values(s.gear || {}).filter(Boolean), ...(s.pockets || []).filter(Boolean));
    if (s.gear && s.gear.backpack && s.gear.backpack.contents) out.push(...s.gear.backpack.contents.filter(Boolean));
  }
  return out;
}
// { targets, have, urgent } for the base, worked out once an hour.
export function partPlan(state, base) {
  const m = memo.get(base);
  if (m && m.hour === state.hour) return m;
  const items = itemsAt(state, base);
  const n = (pred) => items.filter((it) => GEAR[it.key] && pred(it, GEAR[it.key])).length;
  const guns = n((it, d) => d.slot === "weapon" && GUN_CATS.includes(d.cat));
  const vests = n((it) => materialOf(it.key) === "soft");
  const cars = (state.vehicles || []).filter((v) => v.type !== "bike" && ((v.loc.kind === "base" && v.loc.baseId === base.id) || (v.loc.kind === "party" && (state.parties || []).some((p) => p.id === v.loc.partyId && p.homeBaseId === base.id)))).length;
  // Broken ones too: a broken well or generator needs its part more, not less (the reorder level used to drop as
  // the wells broke, so the parts a repair waited on could be sold).
  const cnt = (t) => base.buildings.filter((b) => b.type === t).length;
  const targets = {
    gunparts: 2 + Math.floor(guns / 3),
    parts: 3 + cnt("generator") + cnt("well") + cnt("ammo_bench") + cnt("reload_bench") + cnt("machine_shop"),
    carparts: 2 + 2 * cars,
    electronics: 1 + (base.radio ? 1 : 0) + Math.floor(n((it) => ELEC.has(it.key)) / 2),
    kevlarkit: Math.ceil(vests / 3),
    repairkit: base.type === "hub" ? 2 : 1,
  };
  const urgent = {};
  for (const c of repairCandidates(state, base)) {
    if (c.cond >= AUTO.LOW) continue;
    const info = repairInfo(state, base, c.item);
    if (info.ok || !info.kind) continue;
    for (const [k, v] of Object.entries(info.inputs.supplies)) if (PART_SUPPLIES.includes(k) && have(base, k) < v) urgent[k] = (urgent[k] || 0) + v;
    for (const [k, v] of Object.entries(info.inputs.gear)) if (base.armory.filter((it) => it && it.key === k).length < v) urgent[k] = (urgent[k] || 0) + v;
  }
  for (const [k, v] of Object.entries(urgent)) targets[k] = (targets[k] || 0) + v;
  const haveOf = {};
  for (const k of PART_SUPPLIES) haveOf[k] = Math.floor(Math.max(0, base.stock[k] || 0));
  for (const k of PART_KITS) haveOf[k] = items.filter((it) => it.key === k).length;
  const out = { hour: state.hour, targets, have: haveOf, urgent };
  memo.set(base, out);
  return out;
}
// How many of a part or kit the base is short of its reorder level (0: none).
export const partDeficit = (state, base, k) => { const p = partPlan(state, base); return Math.max(0, (p.targets[k] || 0) - (p.have[k] || 0)); };
// The autopilot's need (autopilot.js needs: 1.2+ is bought, 0.6- is sold) for the part kinds: wanted below the
// reorder level (1.9: a repair waits on them, or under half of it; 1.4 otherwise), never sold (0.9 at or above it).
// Machine parts keep the governor's own need and only gain the urgency.
export function partNeeds(state, base) {
  const p = partPlan(state, base);
  const out = {};
  for (const k of PART_SUPPLIES) {
    const short = p.have[k] < p.targets[k];
    out[k] = short ? (p.urgent[k] || p.have[k] < p.targets[k] / 2 ? 1.9 : 1.4) : 0.9;
  }
  return out;
}
// Kits the base should buy from a trader now: [key] (each wanted once a deal).
export const kitWants = (state, base) => PART_KITS.filter((k) => partDeficit(state, base, k) > 0);
