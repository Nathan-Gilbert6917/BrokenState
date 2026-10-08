// Bulk actions for the roster's ticked people (ui/rosterbulk.js): equip the best the armory has, send the hurt and
// sick to a hospital, move people to another base. Pure simulation, no DOM. Every rule is an existing one:
// - Equip uses the autopilot's gear choice (autopilot.js itemScore: a weapon by its power at their skill, armor by
//   its power, a pack by what it carries) and only takes from the armory of the base they are at, so nothing anyone
//   else holds changes hands. A piece is only taken when it is a real upgrade and the person's kit stays within a
//   Medium load (load.js), or gets no heavier.
// - Moving people is the supply run's transfer (supply.js, "Disband" at the destination): a one-off convoy on foot
//   with road food and water from the base they leave, that walks the road with its usual travel time and risks
//   and joins the other base when it gets there. Nobody is moved by magic.
// - The hospital is the medical rules' (medical.js): a base whose hospital runs (built and staffed) takes in the
//   people who need a bed; "Send to the hospital" walks the ones at a base without one to the nearest that has one.
import { GEAR } from "./data.js";
import { baseById, combatPower, gearEffect, skill, newId, survivorById, factionById } from "./world.js";
import { ensureInv, itemLoad, packSize, ensurePack } from "./inventory.js";
import { wornLoad, maxLoad, feelFactor, LOAD_BANDS } from "./load.js";
import { itemScore } from "./autopilot.js";
import { equipKit } from "./carrykit.js"; // carry kit: the best rig, plates into the carrier, spare magazines
import { activeHospital, bedReason } from "./medical.js";
import { conditionsOf } from "./health.js";
import { supplyRuns, dispatchSupplyRun, jobParty, planSupplyRun, deleteSupplyRun } from "./supply.js";

export const BULK = {
  KIT_FELT_MAX: LOAD_BANDS[1].upTo, // kg felt: worn kit stays at most Medium (room left for the trip's supplies)
  ARMOR_SLOTS: ["weapon", "armor", "head", "arms", "legs", "backpack"],
};
const first = (s) => String(s.name || "").split(" ")[0];
const slotOf = (key) => (GEAR[key] ? GEAR[key].slot : null);

// Why someone cannot be handled at a base ("" when they are at one).
export function awayReason(state, s) {
  if (!s) return "is gone";
  if (!s.alive) return s.left ? "has left the group" : "is dead";
  const l = s.location || {};
  if (l.kind === "base") return baseById(state, l.baseId) ? "" : "has no base";
  if (l.kind === "captive") { const f = factionById(state, l.factionId); return `is held by ${f && f.known ? f.name : "captors"}`; }
  if (l.kind === "party") {
    const p = state.parties.find((x) => x.id === l.partyId);
    return p && p.kind === "convoy" ? "is on the road with a convoy" : "is out on a team";
  }
  if (l.kind === "route") return "escorts a trade route";
  if (l.kind === "errand") return "is away on an errand";
  return "is away";
}
const baseOf = (state, s) => (s && s.alive && s.location && s.location.kind === "base" ? baseById(state, s.location.baseId) : null);

// ---------- equip best available ----------
const packStuffKg = (pack) => (pack && pack.contents ? pack.contents.filter(Boolean).reduce((a, c) => a + itemLoad(c), 0) : 0);
// Light enough: the felt kit stays within BULK.KIT_FELT_MAX and the person's max load, or gets no heavier than now.
// The old piece goes back to the armory; a pack's contents move into the new pack.
export function weightOk(s, slot, item) {
  const now = wornLoad(s), cur = s.gear[slot];
  const after = now - (cur ? itemLoad(cur) : 0) + itemLoad(item) /* an empty slot weighs nothing (itemKg of nothing is 1) */ + (slot === "backpack" ? packStuffKg(cur) : 0);
  if (after <= now + 1e-9) return true;
  const felt = after * feelFactor(s);
  return felt <= BULK.KIT_FELT_MAX + 1e-9 && after <= maxLoad(s) + 1e-9;
}
// A new pack takes the old one's contents along (when they fit): nothing is dumped into the armory inside it.
function movePackContents(oldPack, newPack) {
  const stuff = oldPack && oldPack.contents ? oldPack.contents.filter(Boolean) : [];
  if (!stuff.length) return true;
  if (packSize(newPack) < stuff.length) return false;
  const slots = ensurePack(newPack);
  if (slots.filter((x) => !x).length < stuff.length) return false;
  for (const it of stuff) slots[slots.indexOf(null)] = it;
  oldPack.contents = oldPack.contents.map(() => null);
  return true;
}
// Off-hand tools: who wants which (the autopilot's rule: a crowbar to a scavenger, a med kit to a medic or the best
// Medicine, anything else to whoever has the skill for it). Water filters work from the armory and stay there.
function toolWant(s, d) {
  if (d.bonus && d.bonus.scavenging) return s.role === "scavenge" ? 10 + skill(s, "scavenging") : -1;
  if (d.medKit) return (s.role === "medic" ? 20 : 0) + skill(s, "medicine");
  return d.skill ? skill(s, d.skill) : 0;
}

// Hands out the best the armory has to the people given (only those at a base, each from their own base's armory),
// the best fighters first, slot by slot. Returns { changed: [{ s, got: [{ slot, item, was }] }], same: [s], away:
// [{ s, why }] } and changes nothing for anyone not in `people`.
export function equipBest(state, people) {
  const out = { changed: [], same: [], away: [] };
  const byBase = new Map();
  for (const s of people) {
    const b = baseOf(state, s);
    if (!b) { out.away.push({ s, why: awayReason(state, s) }); continue; }
    if (!byBase.has(b)) byBase.set(b, []);
    byBase.get(b).push(s);
  }
  for (const [base, list] of byBase) {
    const got = new Map(list.map((s) => [s, []]));
    const crew = [...list].sort((a, b) => combatPower(b) - combatPower(a));
    for (const s of crew) ensureInv(s);
    for (const slot of BULK.ARMOR_SLOTS) {
      for (const s of crew) {
        const items = base.armory.filter((it) => slotOf(it.key) === slot && weightOk(s, slot, it));
        if (!items.length) continue;
        const best = items.sort((a, b) => itemScore(s, b) - itemScore(s, a))[0];
        const cur = s.gear[slot];
        if (itemScore(s, best) < itemScore(s, cur) + (cur ? 0.3 : 0.05)) continue; // only real upgrades (the autopilot's margin)
        if (slot === "backpack" && cur && !movePackContents(cur, best)) continue; // their things would not fit the new pack
        base.armory.splice(base.armory.indexOf(best), 1);
        if (cur) base.armory.push(cur);
        s.gear[slot] = best;
        got.get(s).push({ slot, item: best, was: cur || null });
      }
    }
    for (const x of equipKit(base.armory, crew)) if (x.s && got.has(x.s)) got.get(x.s).push({ slot: GEAR[x.item.key] && GEAR[x.item.key].slot === "rig" ? "rig" : "armor", item: x.item, was: x.was || null });
    for (const item of [...base.armory]) {
      const d = GEAR[item.key];
      if (!d || d.slot !== "tool" || d.water) continue;
      const free = crew.filter((s) => !s.gear.tool && (!d.skill || gearEffect(s, item).usable) && toolWant(s, d) >= 0 && weightOk(s, "tool", item));
      if (!free.length) continue;
      const s = free.sort((a, b) => toolWant(b, d) - toolWant(a, d))[0];
      base.armory.splice(base.armory.indexOf(item), 1);
      s.gear.tool = item;
      got.get(s).push({ slot: "tool", item, was: null });
    }
    for (const s of list) (got.get(s).length ? out.changed.push({ s, got: got.get(s) }) : out.same.push(s));
  }
  return out;
}
// One line per person for the roster's report: "Ann: Hunting rifle (was Pistol), Kevlar vest".
export const equipLine = (c) => `${first(c.s)}: ${c.got.map((g) => `${g.item.name}${g.was ? ` (was ${g.was.name})` : ""}`).join(", ")}`;

// ---------- moving between bases (the supply run's transfer) ----------
// Finished transfer jobs (their convoy arrived or was lost) are cleared from the Supply runs tab when the next
// transfer is set up; a transfer still on the road keeps its job (the convoy needs it to disband at the far end).
function clearOldTransfers(state) {
  const list = supplyRuns(state);
  for (const j of [...list]) if (j.transfer && !jobParty(state, j) && (j.status === "disbanded" || j.status === "done")) list.splice(list.indexOf(j), 1);
}
// Hours on the road from one base to another for these people (on foot), or null with no route.
export function transferHours(state, originId, destId, crewIds = []) {
  const plan = planSupplyRun(state, { originId, destId, crewIds, deliver: {}, atDest: "disband", stance: "normal" });
  return plan.error ? null : plan.hoursOut;
}
// Sends people from one base to another as a one-off convoy that disbands there. Returns { ok, msg, hours, partyId }.
export function transferPeople(state, ids, originId, destId) {
  const origin = baseById(state, originId), dest = baseById(state, destId);
  if (!origin || !dest) return { ok: false, msg: "That base is gone." };
  if (origin.id === dest.id) return { ok: false, msg: `Already at ${dest.name}.` };
  clearOldTransfers(state);
  const job = {
    id: newId(), runs: 0, status: "waiting", partyId: null, nextDay: null, transfer: true,
    originId: origin.id, destId: dest.id, crewIds: [...ids], vehicleId: null, deliver: [], pickup: [], atDest: "disband",
    repeat: 0, stance: "normal", allowPartial: false, paused: false, blocked: null, blockedSig: null,
  };
  supplyRuns(state).push(job);
  const msg = dispatchSupplyRun(state, job, true);
  const p = jobParty(state, job);
  if (!p) { deleteSupplyRun(state, job); return { ok: false, msg }; } // could not leave (no road food, no route): nothing waits for tomorrow
  return { ok: true, msg, hours: Math.ceil(p.plannedHours || 0), partyId: p.id };
}
// Groups people by the base they are at and sends each group on. Returns { sent: [{ from, ids, hours }], stay:
// [{ s, why }], failed: [{ from, why }] }.
export function moveToBase(state, people, destId) {
  const dest = baseById(state, destId);
  const out = { sent: [], stay: [], failed: [] };
  if (!dest) { for (const s of people) out.stay.push({ s, why: "has nowhere to go (that base is gone)" }); return out; }
  const groups = new Map();
  for (const s of people) {
    const b = baseOf(state, s);
    if (!b) { out.stay.push({ s, why: awayReason(state, s) }); continue; }
    if (b.id === dest.id) { out.stay.push({ s, why: `is already at ${dest.name}` }); continue; }
    if (!groups.has(b.id)) groups.set(b.id, []);
    groups.get(b.id).push(s);
  }
  for (const [from, list] of groups) {
    const r = transferPeople(state, list.map((s) => s.id), from, dest.id);
    if (r.ok) out.sent.push({ from, to: dest.id, ids: list.map((s) => s.id), hours: r.hours });
    else out.failed.push({ from, ids: list.map((s) => s.id), why: r.msg });
  }
  return out;
}

// ---------- send to the hospital ----------
// Needs care: hurt, an infected wound, or ill (health.js conditions; the worm counts).
export const needsCare = (s) => !!s && s.alive && (s.health < 100 || !!s.woundInfected || conditionsOf(s).length > 0);
// A base whose hospital runs (built and staffed enough for at least its lowest tier).
export const hospitalRuns = (state, b) => !!b && activeHospital(state, b).tier > 0;

// What "Send to the hospital" would do for one person: { ok, why, here, dest, hours }.
// ok: they would be walked to dest (hours on the road). here: they are already at a running hospital.
export function hospitalPlan(state, s) {
  if (!needsCare(s)) return { ok: false, why: s && s.alive ? "does not need care" : awayReason(state, s) };
  const b = baseOf(state, s);
  if (!b) return { ok: false, why: awayReason(state, s) };
  if (hospitalRuns(state, b)) {
    const bed = s.inBed ? "in a bed there" : bedReason(state, b, s) ? "waits for a free bed" : `not ill enough for a bed (admit line, Medical tab)`;
    return { ok: false, here: true, why: `is at ${b.name}'s ${activeHospital(state, b).name} (${bed})` };
  }
  let best = null;
  for (const d of state.bases) {
    if (d.id === b.id || !hospitalRuns(state, d)) continue;
    const h = transferHours(state, b.id, d.id, [s.id]);
    if (h != null && (!best || h < best.hours)) best = { dest: d, hours: h };
  }
  if (!best) return { ok: false, why: state.bases.some((d) => d.id !== b.id && hospitalRuns(state, d)) ? "has no road to a base with a hospital" : "has no base with a running hospital to go to" };
  return { ok: true, why: "", dest: best.dest, hours: Math.ceil(best.hours) };
}
// Sends everyone who can go to their nearest running hospital. Returns { sent: [{ from, to, ids, hours }], stay:
// [{ s, why }], failed: [{ from, why }] }.
export function sendToHospital(state, people) {
  const out = { sent: [], stay: [], failed: [] };
  const groups = new Map();
  for (const s of people) {
    const plan = hospitalPlan(state, s);
    if (!plan.ok) { out.stay.push({ s, why: plan.why }); continue; }
    const key = `${s.location.baseId}>${plan.dest.id}`;
    if (!groups.has(key)) groups.set(key, { from: s.location.baseId, to: plan.dest.id, list: [] });
    groups.get(key).list.push(s);
  }
  for (const g of groups.values()) {
    const ids = g.list.map((s) => s.id);
    const r = transferPeople(state, ids, g.from, g.to);
    if (r.ok) out.sent.push({ from: g.from, to: g.to, ids, hours: r.hours });
    else out.failed.push({ from: g.from, ids, why: r.msg });
  }
  return out;
}
export const nameList = (state, ids) => ids.map((id) => survivorById(state, id)).filter(Boolean).map(first).join(", ");
