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
// cannot be repaired; makeshift weapons and tools 1–3 scrap, and 30 firewood for wooden ones.
//
// The lost maximum: a repair restores the item to its current maximum, and the maximum drops by
//   restored × max(0.08, 0.25 − 0.01 × skill)            (× 2 with a field kit, × 0.7 at a master workbench)
// (a Mechanics 12 repair loses 13% of what it restores, Mechanics 3 22%). It never rises again. An item whose maximum
// is below 20% of its full durability (GEAR dur) is worn out: it cannot be repaired (it works until it breaks; salvage
// it for parts: inventory.js salvageAt). item.durBase: the maximum before its first repair (valuation.js prices a
// lowered maximum down).
import { GEAR, SKILL_NAMES } from "./data.js";
import { atBase, skill, log, newId } from "./world.js";
import { benchTier } from "./buildings.js";
import { itemDur, itemDurMax, wear } from "./crafting.js";
import { burnShare } from "./woodcutting.js";
import { itemAt, removeAt, parseLoc, placeOfLoc, storageFor, unlistFromSites } from "./inventory.js";
import { gainXp, USE } from "./skills.js";

export const REPAIR = {
  LOSS_BASE: 0.25, LOSS_PER_SKILL: 0.01, LOSS_MIN: 0.08, KIT_LOSS: 2, KIT_RESTORE: 0.5, MASTER_LOSS: 0.7,
  WORN_OUT: 0.2,     // a maximum under 20% of full durability: worn out
  GUN_STEP: 0.2,     // a gun part per 20% of full durability restored
  WOOD: 30,          // firewood for a wooden handle or stock (3 kg)
  AUTO_BELOW: 0.6,   // the autopilot repairs gear below 60% of its maximum
};
// Materials of the armour pieces (section 17), where GEAR has none of its own (armour.js may add GEAR material / ac).
const MATERIAL = {
  vest: "soft", tacvest: "soft", softinsert: "soft", plate: "ceramic", ceramicplate: "ceramic", steelplate: "steel", scrapvest: "steel",
  tirevest: "padding", sportspads: "padding", padding: "padding", shinguards: "padding",
  kneeguards: "hard", riotarms: "hard", riotlegs: "hard", bikehelmet: "hard", footballhelmet: "hard", riothelmet: "hard", milhelmet: "hard", rivethelmet: "hard",
};
const AC = { vest: 2, tacvest: 2, softinsert: 2, steelplate: 4, ceramicplate: 5, plate: 5, scrapvest: 3, milhelmet: 3, riothelmet: 2, riotarms: 2, riotlegs: 2 };
export const materialOf = (key) => (GEAR[key] && GEAR[key].material) || MATERIAL[key] || null;
export const acOf = (key) => (GEAR[key] && Number.isFinite(GEAR[key].ac) ? GEAR[key].ac : AC[key] || 0);
const ARMOUR = ["armor", "head", "arms", "legs"];
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
};

// The kind of repair an item takes ({ kind, def }), { refuse: why }, or null (it does not wear, or it is used up
// rather than mended: med kits, water filters, makeshift gun parts, the repair kits themselves).
export function repairKind(item) {
  const d = item && GEAR[item.key];
  if (!d || !d.dur || d.tabs || d.groom || d.count) return null;
  if (d.medKit || d.water || d.throw || d.use || d.cat === "gunmod" || item.key === "repairkit" || item.key === "kevlarkit") return null;
  const k = (kind) => ({ kind, def: REPAIR_KINDS[kind] });
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
  const loss = round1(restore * lossRate(skillLevel, opts));
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
    for (const [k, v] of Object.entries(out.inputs.supplies)) if (have(base, k) < v) { out.reason = `Needs ${v} ${k} (have ${Math.floor(have(base, k))}).`; break; }
    if (!out.reason) for (const [k, v] of Object.entries(out.inputs.gear)) if (base.armory.filter((it) => it && it.key === k).length < v) { out.reason = `Needs a ${GEAR[k].name.toLowerCase()} in the armory.`; break; }
  }
  out.ok = !out.reason;
  return out;
}
// The preview line: "Max durability 45 → 41; restores 12; 1 gun part, 1 scrap; 2 h; Ana (Mechanics 6)".
export function repairPreview(info) {
  if (!info.kind) return info.reason;
  const ins = [...Object.entries(info.inputs.supplies).map(([k, v]) => `${v} ${k === "gunparts" ? "gun part" + (v === 1 ? "" : "s") : k === "parts" ? "machine part" + (v === 1 ? "" : "s") : k === "wood" ? "firewood" : k}`),
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
// base.gearRepairs: [{ id, item, hours, progress, paid, gearPaid, from }]. Queueing pays the inputs and takes the item
// out of where it was (off the person, out of the armory) into the job; finished, it goes to the armory.
export const repairQueue = (base) => base.gearRepairs || (base.gearRepairs = []);
export const MAX_REPAIR_QUEUE = 8;
// Queues a repair of the item at loc at this base. Returns a message.
export function queueRepair(state, base, loc) {
  const item = itemAt(state, loc);
  if (!item) return "Nothing there.";
  if (parseLoc(loc).o === "body") return "Take it first.";
  if (placeOfLoc(state, loc) !== `base:${base.id}`) return "Only things at this base can be repaired here.";
  if (repairQueue(base).length >= MAX_REPAIR_QUEUE) return `The repair queue is full (${MAX_REPAIR_QUEUE}).`;
  const info = repairInfo(state, base, item);
  const noCrafter = info.reason && /Craft role/.test(info.reason) && !info.who;
  if (!info.ok && !noCrafter) return info.reason;
  if (noCrafter) { // queued anyway: it waits for a crafter (the inputs still have to be here)
    for (const [k, v] of Object.entries(info.inputs.supplies)) if (have(base, k) < v) return `Needs ${v} ${k} (have ${Math.floor(have(base, k))}).`;
    for (const [k, v] of Object.entries(info.inputs.gear)) if (base.armory.filter((it) => it && it.key === k).length < v) return `Needs a ${GEAR[k].name.toLowerCase()} in the armory.`;
  }
  for (const [k, v] of Object.entries(info.inputs.supplies)) base.stock[k] = (base.stock[k] || 0) - v;
  const gearPaid = [];
  for (const [k, v] of Object.entries(info.inputs.gear)) for (let i = 0; i < v; i++) gearPaid.push(...base.armory.splice(base.armory.findIndex((it) => it && it.key === k), 1));
  removeAt(state, loc);
  unlistFromSites(state, item);
  repairQueue(base).push({ id: newId(), item, hours: info.hours, progress: 0, paid: { ...info.inputs.supplies }, gearPaid });
  return `${item.name} queued for repair at ${base.name} (${info.hours} h)${noCrafter ? ": nobody on the Craft role can do it yet" : ""}.`;
}
// Cancels a queued repair: the item goes to the armory; untouched, everything paid comes back, started, half.
export function cancelRepair(state, base, id) {
  const q = repairQueue(base);
  const job = q.find((j) => j.id === id);
  if (!job) return "That repair is gone.";
  const full = job.progress <= 0;
  for (const [k, v] of Object.entries(job.paid || {})) base.stock[k] = (base.stock[k] || 0) + (full ? v : Math.ceil(v / 2));
  if (full) base.armory.push(...(job.gearPaid || []));
  base.armory.push(job.item);
  q.splice(q.indexOf(job), 1);
  return `Cancelled the repair of the ${job.item.name}: it is in the armory.`;
}
// Why a queued repair is not moving ("" when it is).
export function repairJobStatus(state, base, job) {
  const rk = repairKind(job.item);
  if (!rk || !rk.def) return "Nothing to repair";
  if (benchTier(base) < (rk.def.soft || GEAR[job.item.key].makeshift ? 1 : 2)) return "Needs a bench here";
  if (!repairers(state, base, job.item).length) return `No crafter with ${SKILL_NAMES[rk.def.skill]} ${minFor(job.item, rk.def)}+`;
  return "";
}
// Hourly (world.js, before craftingHour): the crafters work the first repair they can; a base whose crafters repaired
// this hour does no crafting this hour (base.gearRepairHour). Finished: the item is repaired by the best of them and goes
// to the armory.
export function repairHour(state) {
  for (const base of state.bases) {
    const q = base.gearRepairs;
    if (!q || !q.length) continue;
    const job = q.find((j) => !repairJobStatus(state, base, j));
    if (!job) continue;
    const team = repairers(state, base, job.item);
    const sk = REPAIR_KINDS[repairKind(job.item).kind].skill;
    job.progress += team.reduce((a, s) => a + 1 + 0.03 * skill(s, sk), 0);
    base.gearRepairHour = state.hour;
    if (job.progress < job.hours) continue;
    q.splice(q.indexOf(job), 1);
    const r = repairItem(state, base, job.item, team[0]);
    base.armory.push(job.item);
    log(state, `${r.msg} It is in ${base.name}'s armory.`, "good");
  }
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
  return repairItem(state, null, item, info.who, { kit: true }).msg;
}

// ---------- the autopilot ----------
// Queues one repair a day per base (autopilot.js governBase): worn gear below 60% of its maximum, the best fighters'
// first (their weapon, then body armour, head, arms, legs, while the armory holds a spare for that slot; then the
// armory's guns and armour), when the inputs are here and leave a little over (machine parts: 2 kept for buildings).
export function planRepairs(state, base) {
  if (!base || repairQueue(base).length >= 2 || base.gearRepairDay === Math.floor(state.hour / 24)) return "";
  const people = atBase(state, base.id).slice().sort((a, b) => (skill(b, "shooting") - skill(a, "shooting")) || a.id - b.id);
  const cands = [];
  // What people wear or hold only while the armory has a spare for that slot (the repair takes it off them for hours).
  const spare = (slot) => base.armory.some((it) => it && GEAR[it.key] && GEAR[it.key].slot === slot);
  for (const s of people) for (const slot of ["weapon", "armor", "head", "arms", "legs"]) if (s.gear && s.gear[slot] && spare(slot)) cands.push(`s:${s.id}:${slot}`);
  base.armory.forEach((it, i) => { if (it && GEAR[it.key] && (GEAR[it.key].slot === "weapon" || ARMOUR.includes(GEAR[it.key].slot))) cands.push(`armory:${base.id}:list:${i}`); });
  for (const loc of cands) {
    const it = itemAt(state, loc);
    const max = itemDurMax(it);
    if (!max || itemDur(it) >= REPAIR.AUTO_BELOW * max) continue;
    const info = repairInfo(state, base, it);
    if (!info.ok) continue;
    const s = info.inputs.supplies;
    if ((s.parts || 0) && (base.stock.parts || 0) - s.parts < 2) continue;
    if ((s.scrap || 0) && (base.stock.scrap || 0) - s.scrap < 6) continue;
    if ((s.fuel || 0) && (base.stock.fuel || 0) - s.fuel < 4) continue;
    if ((s.wood || 0) && (base.stock.wood || 0) - s.wood < 150) continue;
    base.gearRepairDay = Math.floor(state.hour / 24);
    return queueRepair(state, base, loc);
  }
  return "";
}
