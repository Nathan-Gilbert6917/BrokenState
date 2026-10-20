// The item right-click menu, Tarkov-style (user request 2026-10-18): right-click anything in an inventory view (the
// inventory window, the team inventory, the loot screen, the search window and the kit seen from a battle, the base's
// Armory tab, the team forming and meeting windows) for a small menu of what can be done with it there.
//   - every item: Inspect (its whole description in the menu), Equip / Put away / Take, Split and Open on stacks,
//     Repair, Salvage, Break down for firewood, the boiler's mark;
//   - a gun: Reload and Reload with (out of a fight: filled now, free, from what its holder carries, then the storage
//     and the stores here; in a fight the Reload order, with the round to hand to pick), Unload (its rounds out loose),
//     Remove magazine / Insert magazine (a gun with a detachable magazine: the magazine with its rounds, the chambered
//     round staying in the gun; in a fight for the place's actions), Modify (the gun builder; in a fight the parts the
//     fighter carries, an action a part), Repair; in a fight also Clear jam and the fire mode;
//   - a magazine: Load rounds / Load rounds with (the round), Unload rounds, Insert into a gun (out of a fight, free;
//     in a fight Load rounds, Unload and Insert magazine / Reload with it for the gun in the hands' spares, in actions);
//     a gun part: Fit to a gun;
//   - things used up: treats (Eat, Drink, Smoke), food and water (stacks in the stores, carried as items, the pack of
//     food and water: Eat, Drink),
//     meds and med kits (Treat wounds; in a fight Use meds), the dewormer (Take it, at a base).
// In a fight (the kit view 🎒 and the search window) also Draw / To the off hand and Split, as the kit view's own moves
// (combatAct "inv", INV_AP). In a fight each row says what it costs in actions (sim/itemacts.js ITEM_AP, MOD_AP; combat.js reloadCost) and is
// greyed out with the reason when it cannot be done (not your turn, not enough actions, hands full...).
// ui.imenu = { loc, x, y, sid (who uses it, when the view says: the base's Armory tab), open (a submenu row's id),
// info (Inspect shown) }. loc: an inventory location ("s:3:pocket:1", "armory:2:list:4", "cargo:5:sup:f_beans"), a
// search window's ("rbox:7:gear:0", "haul:12:sup:water", "trunk:5:gear:1") or "ration:<sid>" (the "Food on them" line).
// Drawn into #itemmenu over the windows (main.js refresh); closed by a click elsewhere, Esc, or a row that does
// something.
import { GEAR, SUPPLIES } from "../sim/data.js";
import { MAGAZINES } from "../sim/data-kit.js";
import { survivorById, baseById } from "../sim/world.js";
import { itemAt, parseLoc, storageFor, placeOfLoc, personPlace, quickMove, toStorage, moveItem, EQUIP_SLOTS, SLOT_NAMES, splitAt, openAt, salvageInfo, salvageYield, salvageText, breakDownInfo, setFireMark, packOf, rigPouches, ensureInv, battleBodies } from "../sim/inventory.js";
import { amountOf, countOf, isRoundItem, isBulk, bulkRecord } from "../sim/itemstack.js";
import { useItemOn, useText } from "../sim/comforts.js";
import { repairKind, repairInfoAt, repairAt } from "../sim/repair.js";
import { isJunk, boilerJunkOn } from "../sim/woodcutting.js";
import { isBox, isSealed, openPlan, lockWords } from "../sim/boxes.js"; // lock boxes and cases (2026-10-19)
import { openBoxWindow } from "./boxview.js";
import { isHelmet, isHelmetPart, helmetFitReason, fitHelmetAt } from "../sim/helmets.js";
import { modFitReason, fitsText } from "../sim/gunmods.js";
import { treatWorm, wormOf } from "../sim/worm.js";
import { treatAnywhere, isHurt } from "../sim/medical.js";
import { FOODS } from "../sim/foods.js";
import { calOf } from "../sim/ammo.js";
import { isMag, isStacked, magEntryAt, unloadMagPlan, reloadOptions, magOut, detachable, magFitsGun, removeMagPlan, insertChoices, roundSources, loadMagPlan, LOAD_AP } from "../sim/mags.js";
import { carriedSpots } from "../sim/inventory.js";
import { stackText, stackN } from "../sim/roundstack.js";
import { reloadCost, reloadRefusal, medsLeft, active, WEAPONS } from "../sim/combat.js";
import { raidMove, raidItemAt, parseRaidLoc, quickTarget, lootLayer } from "../sim/raidloot.js";
import {
  ITEM_AP, MOD_AP, magLoadChoices, gunLoadChoices, roundsToHand, unloadMagRefusal, unloadMagAt, loadMagRefusal, loadMagAt,
  unloadGunRefusal, unloadGunAt, isFoodKey, isDrinkKey, stackUseRefusal, useStack, packUseRefusal, usePack, battleUsePlan, heldKeyOf,
  reloadGunAt, reloadGunRefusal, removeMagAt, removeMagRefusal, insertMagAt, insertMagRefusal, magsForGun,
} from "../sim/itemacts.js"; // out of a fight a gun's and a magazine's rounds are physical (2026-10-20): Reload, Unload, Remove / Insert magazine, Load / Unload rounds
import { isRoundGun, gunCapacity } from "../sim/gunrounds.js";
import { gunStackOf } from "../sim/gunload.js";
import { INV_AP } from "../sim/combat.js"; // a move in a fighter's own kit (combatAct "inv")
import { packFood, packWater } from "../sim/eating.js";
import { cui, battleOrder, ammoToHand, unitModes, curMode, MODE_NAME } from "./combat.js";
import { isGunKey } from "./gunart.js";
import { slotOfPart, SLOT_NAMES as PART_SLOT_NAMES, GB_ACTIONS } from "./gunbuilder.js";
import { itemTip, INV_ACTIONS, INV_STACK_DESTS } from "./inventory.js";
import { shortName } from "./names.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => (s ? shortName(s) : "They");
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
const fight = (state) => !!(state.combat && !state.combat.over);
const RAID_O = new Set(["rbox", "haul", "trunk"]);

// ---------- what was right-clicked ----------
// The item at a location (any view), or null; a supply stack's { key, n } (stack), or null.
function itemOf(state, loc) {
  const L = parseLoc(loc);
  if (L.slot === "sup" || L.o === "ration") return null;
  if (RAID_O.has(L.o)) return state.combat ? raidItemAt(state, state.combat, loc) : null;
  return itemAt(state, loc);
}
function stackOf(state, loc) {
  const L = parseRaidLoc(loc);
  if (L.slot !== "sup" || !L.i) return null;
  const key = L.i;
  let rec = null;
  if (L.o === "armory") rec = (baseById(state, L.id) || {}).stock;
  else if (L.o === "cargo") { const p = state.parties.find((x) => x.id === L.id); rec = p && p.cargo ? p.cargo.supplies : null; }
  else if (L.o === "body") { const body = battleBodies(state)[L.id]; rec = body ? body.supplies : null; }
  else if (state.combat && L.o === "haul") { const u = state.combat.units.find((x) => x.id === L.id); rec = u && u.haul ? u.haul.sup : null; }
  else if (state.combat && L.o === "rbox") { const R = lootLayer(state.combat); const c = R && R.containers.find((x) => x.id === L.id); rec = c && c.contents ? c.contents.sup : null; }
  else if (state.combat && L.o === "trunk") { const p = state.parties.find((x) => x.id === L.id); rec = p ? { [key]: Math.max(0, (p.cargo && p.cargo.supplies[key]) || 0) + Math.max(0, p.supplies[key] || 0) } : null; }
  const n = rec ? Math.floor(Math.max(0, rec[key] || 0)) : 0;
  return SUPPLIES[key] && n >= 1 ? { key, n } : null;
}
// Who would use it: the one carrying it, else the one whose window it is (the searcher in a raid's window, the open
// inventory's person, the view's data-sid).
function userOf(state, ui, m) {
  const L = parseLoc(m.loc);
  if (L.o === "s" || L.o === "ration") return survivorById(state, L.id);
  const unitSid = (uid) => { const u = state.combat && state.combat.units.find((x) => x.id === uid); return u && u.sid != null ? survivorById(state, u.sid) : null; };
  if (L.o === "haul") return unitSid(L.id);
  if (m.sid != null) return survivorById(state, m.sid);
  if (ui.inv && ui.inv.raid) return unitSid(ui.inv.uid);
  return ui.inv && ui.inv.sid != null ? survivorById(state, ui.inv.sid) : null;
}
// The fighter of yours who is this survivor (in a fight), or null.
const fighterOf = (state, s) => (s && fight(state) ? state.combat.units.find((u) => u.side === "player" && u.sid === s.id && u.vol == null && !u.dead && !u.left) || null : null);

// Opens the menu (main.js contextmenu): d = the element's data (loc, sid; or imenu for the "Food on them" line).
// Returns true when there is something to show.
export function openItemMenu(state, ui, d, x, y) {
  const loc = d.imenu || d.loc;
  if (!loc || (!itemOf(state, loc) && !stackOf(state, loc) && !/^ration:/.test(loc))) return false;
  ui.imenu = { loc, x: Math.round(x), y: Math.round(y), sid: d.sid != null && d.sid !== "" ? Number(d.sid) : null, open: null, info: false };
  return true;
}
export const closeItemMenu = (ui) => { if (!ui.imenu) return false; ui.imenu = null; return true; };

// ---------- the rows ----------
// A row: { id, label, ap (actions in a fight: a number, 0 free; undefined out of a fight), why (greyed out: the reason),
// tip, run(state, ui) (returns a message, or nothing), sub (rows folded under it), keep (the menu stays open) }.
const row = (id, label, run, o = {}) => ({ id, label, run, ...o });
const say = (state, ui, msg) => {
  if (!msg) return;
  ui.invMsg = msg; // the window's message line (in a fight the search window's and the kit's too)
  if (!ui.inv && ui.baseView) ui.baseMsg = msg;
};
// The fight's checks before an order: your turn, the fighter able, the actions it costs.
function turnWhy(state, u, ap) {
  const b = state.combat;
  if (!u) return "Only your own fighters' things, in a fight.";
  if (b.phase !== "player") return "Wait for your turn.";
  if (!active(u)) return `${u.name.split(" ")[0]} cannot act.`;
  if (ap > 0 && u.ap < ap) return u.ap > 0 ? `Takes ${plural(ap, "action")}: ${plural(u.ap, "action")} left.` : "No actions left this turn.";
  return "";
}
// An order through the battle panel's path (ui/combat.js act); the message: the refusal, else the battle log's line.
const order = (state, a) => () => {
  const b = state.combat, n = b ? b.log.length : 0;
  if (!battleOrder(state, a)) return cui.msg;
  const l = b && b.log.length > n ? b.log[b.log.length - 1] : null;
  return l ? l.text : "";
};

function rowsFor(state, ui, m) {
  const loc = m.loc;
  const L = parseLoc(loc);
  const s = userOf(state, ui, m);
  const u = fighterOf(state, s);
  const inFight = fight(state);
  const out = [];
  if (L.o === "ration") return rationRows(state, s, u, inFight);
  const stack = stackOf(state, loc);
  if (stack) return stackRows(state, ui, m, stack, s, u, inFight);
  const item = itemOf(state, loc);
  if (!item) return out;
  const d = GEAR[item.key] || {};
  out.push(row("info", m.info ? "Inspect ▴" : "Inspect", () => { m.info = !m.info; }, { keep: true, tip: "Its whole description, here in the menu", ap: inFight ? 0 : undefined }));
  if (inFight) fightRows(state, ui, m, item, d, s, u, out);
  else calmRows(state, ui, m, item, d, s, out);
  return out;
}

// ---------- out of a fight ----------
function calmRows(state, ui, m, item, d, s, out) {
  const loc = m.loc;
  const L = parseLoc(loc);
  const body = L.o === "body";
  const looting = !!(ui.inv && ui.inv.loot);
  const place = placeOfLoc(state, L);
  const st = place ? storageFor(state, place) : null;
  const here = s && place && personPlace(s) === place; // the user is where the item is
  // Moving it.
  if (!ui.inv && s) out.push(row("open", "Open in inventory", (st2, ui2) => { ui2.inv = { sid: s.id, loot: false }; ui2.invSel = loc; ui2.invMsg = ""; }, { tip: `Open ${first(s)}'s inventory with it picked` }));
  if (body) {
    if (s) out.push(row("take", "Take", () => quickMove(state, loc, s.id), { tip: `Onto ${first(s)} where it fits, else into the team's cargo` }));
  } else if (L.o === "s") {
    const slot = d.slot;
    if (EQUIP_SLOTS.includes(slot) && L.slot !== slot && !["insert"].includes(L.slot)) {
      const on = itemAt(state, `s:${L.id}:${slot}`);
      out.push(row("equip", `Equip (${(SLOT_NAMES[slot] || slot).toLowerCase()})`, () => moveItem(state, loc, `s:${L.id}:${slot}`), { tip: on ? `Into the ${SLOT_NAMES[slot] || slot} slot: the ${on.name} there goes where this was` : `Into the ${SLOT_NAMES[slot] || slot} slot` }));
    }
    if (st) out.push(row("store", st.o === "armory" ? "Put in the armory" : "Put in the cargo", () => toStorage(state, loc), { tip: `Into ${st.name}` }));
  } else if ((L.o === "armory" || L.o === "cargo") && s) {
    out.push(row("equip", `Equip on ${first(s)}`, () => quickMove(state, loc, s.id), { why: here ? "" : `${first(s)} is not where it is.`, tip: `Onto ${first(s)}: its own slot, else a pouch, a pocket or the pack` }));
  }
  // A stack: split it, open a box, take a handful.
  if (!body) {
    if (amountOf(item) > 1 && (countOf(item) > 1 || (isRoundItem(item) && !isBulk(item)))) out.push(row("split", "Split the stack", () => splitAt(state, loc), { tip: `Half of it (${Math.ceil(amountOf(item) / 2)}) into a spot of its own beside it` }));
    if (isRoundItem(item) && !item.loose) out.push(row("openbox", "Open the box", () => openAt(state, loc), { tip: "Loose rounds out of the box (they are not packed back)" }));
    if (isBulk(item) && Object.keys(bulkRecord(item)).length) out.push(row("handful", "Take out a handful", () => openAt(state, loc), { tip: "A handful of loose rounds into a spot beside it" }));
  }
  // A gun (2026-10-20: its rounds are physical out of a fight too; loading it is free, out of what its holder carries,
  // then the storage and the stores here: sim/itemacts.js).
  if (calOf(item.key) && WEAPONS[item.key] && !WEAPONS[item.key].melee && isRoundGun(item)) {
    const cal = calOf(item.key);
    const inGun = stackN(gunStackOf(item)), cap = gunCapacity(item);
    const src = here && s && L.o === "s" ? `what ${first(s)} carries, then the storage and the stores here` : "the storage and the stores here";
    out.push(row("reload", "Reload", () => reloadGunAt(state, loc), { why: reloadGunRefusal(state, loc), tip: `${inGun}/${cap} in it now. Filled now, free, from ${src}${magOut(item) ? " (no magazine in it: only the chamber)" : ""}` }));
    const loads = gunLoadChoices(item);
    if (loads.length > 1) {
      const cur = item.load || "";
      const sub = [...loads, { id: "auto", name: "Best to hand (when a fight starts)" }].map((x) => {
        const n = x.id === "auto" ? null : roundsToHand(state, loc, cal, x.id);
        const on = x.id === "auto" ? cur === "auto" : cur === x.id || (!cur && x.id === loads[0].id);
        return row(`load:${x.id}`, `${on ? "✓ " : ""}${x.name}`, () => reloadGunAt(state, loc, x.id), { note: n == null ? "" : `${n}`, why: x.id === "auto" ? "" : reloadGunRefusal(state, loc, x.id), tip: n == null ? "Nothing loaded now: a fight's start tops it up with the best kind its holder has" : `${n} to hand: loaded now, and the round it takes the field with` });
      });
      out.push(row("reloadwith", "Reload with", null, { sub, why: body ? "Take it first." : "", tip: "Load a kind of round now (and take the field with it)" }));
    }
    out.push(row("unload", "Unload", () => unloadGunAt(state, loc), { why: unloadGunRefusal(state, loc), tip: `${inGun ? `Its ${inGun} rounds` : "Its rounds"} out as loose rounds onto ${s && L.o === "s" ? first(s) : "the stores here"}: it stays empty, also as a fight starts, until it is reloaded` }));
    if (detachable(item) || magOut(item)) {
      if (!magOut(item)) out.push(row("magout", "Remove magazine", () => removeMagAt(state, loc), { why: removeMagRefusal(state, loc), tip: `The magazine out with ${Math.max(0, inGun - 1)} round${inGun - 1 === 1 ? "" : "s"} in it${L.o === "s" ? `, onto ${s ? first(s) : "them"}` : ", into the storage"}; the round in the chamber stays in the gun` }));
      const mags = magsForGun(state, loc);
      if (mags.length) out.push(row("magin", magOut(item) ? "Insert magazine" : "Swap magazine", null, { tip: magOut(item) ? "A magazine into the gun, with the rounds in it" : "Another magazine in: the one in it comes out into its place", sub: mags.map((x) => row(`magin:${x.loc}`, `${x.item.name}`, () => insertMagAt(state, loc, x.loc), { note: `${stackN(x.item.stack)}/${MAGAZINES[x.item.key].cap}`, why: insertMagRefusal(state, loc, x.loc), tip: `${x.where}${x.item.stack && x.item.stack.length ? `: ${stackText(MAGAZINES[x.item.key].cal, x.item.stack)}` : ": empty"}` })) }));
      else if (magOut(item)) out.push(row("magin", "Insert magazine", null, { why: `No magazine for the ${item.name} ${L.o === "s" ? "on them or " : ""}in the storage here.` }));
    }
    if (isGunKey(item.key)) out.push(row("modify", "Modify", (st2, ui2) => { GB_ACTIONS["gb-open"](state, ui2, { loc, sid: s ? s.id : "" }); }, { why: body || looting ? "Take it first." : "", tip: "The gun builder: sights, muzzle, magazine, stock and the rest, with the parts within reach" }));
  } else if (calOf(item.key) && WEAPONS[item.key] && !WEAPONS[item.key].melee && isGunKey(item.key)) out.push(row("modify", "Modify", (st2, ui2) => { GB_ACTIONS["gb-open"](state, ui2, { loc, sid: s ? s.id : "" }); }, { why: body || looting ? "Take it first." : "", tip: "The gun builder" }));
  // A magazine: its rounds in and out (physical, free out of a fight), into a gun; a gun part: fit it.
  if (isMag(item) && !body) {
    const cal = MAGAZINES[item.key].cal;
    const n = stackN(item.stack), cap = MAGAZINES[item.key].cap;
    out.push(row("magload", "Load rounds", () => loadMagAt(state, loc), { why: loadMagRefusal(state, loc), tip: `${n}/${cap} in it now. Filled now, free, from ${here && s && L.o === "s" ? `what ${first(s)} carries, then the storage and the stores here` : "the storage and the stores here"} (on top of what is in it)` }));
    const choices = magLoadChoices(item);
    if (choices.length > 1) out.push(row("magwith", "Load rounds with", null, { sub: choices.map((x) => { const on = (item.load || null) === x.id; const k = roundsToHand(state, loc, cal, x.id); return row(`mag:${x.id}`, `${on ? "✓ " : ""}${x.name}`, () => loadMagAt(state, loc, x.id), { note: `${k}`, why: loadMagRefusal(state, loc, x.id), tip: `${k} to hand` }); }) }));
    out.push(row("magunload", "Unload rounds", () => unloadMagAt(state, loc), { why: unloadMagRefusal(state, loc), tip: `${n ? `Its ${n} rounds` : "Its rounds"} out as loose rounds onto ${L.o === "s" && s ? first(s) : "the stores here"}: it stays empty, also as a fight starts, until loaded again` }));
    const guns = (s && here ? gunsOn(state, s) : []).filter(([, g]) => isRoundGun(g) && (detachable(g) || magOut(g)) && magFitsGun(g.key, item.key));
    if (guns.length) out.push(row("magto", "Insert into", null, { sub: guns.map(([gl, g]) => row(`magto:${gl}`, `${g.name}${magOut(g) ? " (no magazine)" : ""}`, () => insertMagAt(state, gl, loc), { why: insertMagRefusal(state, gl, loc), tip: magOut(g) ? "Into the gun, with the rounds in it" : "Into the gun: the magazine in it comes out into this one's place" })) }));
  }
  const part = slotOfPart(item.key);
  if (part && s && !body && !looting) {
    const guns = gunsOn(state, s).filter(([gl, g]) => g !== item && !modFitReason(g, item));
    if (guns.length) out.push(row("fitto", "Fit to", null, { tip: `Fits ${fitsText(item.key)}`, sub: guns.map(([gl, g]) => row(`fit:${gl}`, g.name, (st2, ui2) => { GB_ACTIONS["gb-open"](state, ui2, { loc: gl, slot: part, sid: s.id }); }, { tip: `The gun builder on ${first(s)}'s ${g.name} at its ${(PART_SLOT_NAMES[part] || part).toLowerCase()}${g.mods && g.mods[part] ? ` (the ${g.mods[part].name} comes off)` : ""}` })) }));
  }
  if (isHelmetPart(item.key) && s && !body) {
    const h = s.gear && s.gear.head;
    if (h && isHelmet(h.key) && h !== item) out.push(row("helmfit", `Fit to the ${h.name}`, () => fitHelmetAt(state, `s:${s.id}:head`, loc, s.id), { why: helmetFitReason(h, item) || "" }));
  }
  // Used up: food or water carried (supitems.js), a treat, the dewormer, meds.
  const hk = heldKeyOf(item);
  if (hk && hk !== "meds" && s && !body) out.push(row("eat", `${isDrinkKey(hk) ? "Drink" : "Eat"}${L.o === "s" && L.id === s.id ? "" : ` (${first(s)})`}`, () => useStack(state, s.id, loc), { why: stackUseRefusal(state, s, loc), tip: isDrinkKey(hk) ? `Up to their fill (thirst ${Math.round(s.thirst ?? 100)})` : `Up to their fill (hunger ${Math.round(s.hunger ?? 100)}): whole ones` }));
  if (d.supKey === "meds" && s && !body) out.push(medRow(state, s, "with the meds to hand"));
  if (d.use && s && !body && !looting) out.push(row("use", `${verb(d)} it`, () => useItemOn(state, s.id, loc), { why: here ? "" : `${first(s)} cannot reach it.`, tip: `${first(s)}: ${useText(item.key)}. Used up.` }));
  if (item.key === "dewormer" && s && !body) {
    const base = s.location && s.location.kind === "base" ? baseById(state, s.location.baseId) : null;
    const w = wormOf(s);
    out.push(row("deworm", "Take the dewormer", () => treatWorm(state, base, s.id, "dewormer"), { why: !w || w.seen == null ? `Nobody knows ${first(s)} has the worm.` : !base ? "At a base (where they can rest it off)." : "", tip: "A sure cure while the worm is in the gut: it passes, and they are weak a few days" }));
  }
  if ((d.medKit || d.selfStab) && s && !body) out.push(medRow(state, s, `with the team's meds${d.medKit ? ` (the ${item.name} helps whoever treats)` : ""}`));
  if (isBox(item) && !body && !fight(state) && !RAID_O.has(L.o)) { // a box or a case: opened with the right tool, then its window (ui/boxview.js)
    const o = isSealed(item) ? openPlan(state, loc, s ? s.id : null) : { ok: true };
    const label = !isSealed(item) ? "Look inside" : !item.locked ? "Open" : o.ok && o.tool && o.tool.kind === "picks" ? `Pick the lock (${o.tool.item.name})` : o.ok && o.tool ? `Force it open (${o.tool.item.name})` : "Force it open";
    out.push(row("opencase", label, (st2, ui2) => openBoxWindow(state, ui2, loc, s ? s.id : null), { why: o.ok ? "" : o.why, tip: isSealed(item) ? `${item.locked ? `Locked with ${lockWords(item)}` : "Not locked"}. Free out of a fight; a window shows what is inside.` : "What is inside, to take out" }));
  }
  // Repair, salvage, firewood.
  if (!body && !looting && repairKind(item)) {
    let r = null;
    try { r = repairInfoAt(state, loc); } catch { r = null; }
    if (r) {
      const ok = (r.base && (r.ok || (!r.who && /Craft role/.test(r.reason || "")))) || (!r.base && r.ok);
      out.push(row("repair", `Repair${r.kind && r.newMax > 0 ? ` (max ${Math.round(r.oldMax)} → ${Math.round(r.newMax)})` : ""}`, () => repairAt(state, loc), { why: ok ? "" : r.reason || "Cannot be repaired here.", tip: `${r.base ? "At the bench" : "With a field repair kit"}: ${r.preview || ""}` }));
    }
  }
  if (!body && salvageYield(item)) {
    const sv = salvageInfo(state, loc);
    out.push(row("salvage", `Salvage (${salvageText(sv.got)})`, (st2, ui2) => { ui2.invSel = loc; INV_ACTIONS["inv-salvage"](state, ui2, {}); }, { why: sv.ok ? "" : sv.reason, tip: "Take it apart for parts. Asks first." }));
  }
  const bd = breakDownInfo(state, loc);
  if (!body && bd.wood > 0) {
    out.push(row("burn", `Break down for firewood (+${bd.wood})`, (st2, ui2) => { ui2.invSel = loc; INV_ACTIONS["inv-breakdown"](state, ui2, {}); }, { why: bd.ok ? "" : bd.reason, tip: isJunk(item) ? "Junk: kindling" : "Worth more than junk: asks first" }));
    if (L.o === "armory") {
      const b = baseById(state, L.id);
      const mark = item.fire === "burn" ? "burn" : item.fire === "keep" ? "keep" : "";
      const next = mark === "" ? (isJunk(item) ? "keep" : "burn") : mark === "burn" ? "keep" : "";
      const label = next === "burn" ? "Boiler may burn it" : next === "keep" ? "Keep from the fire" : "Clear the fire mark";
      out.push(row("firemark", label, () => setFireMark(state, loc, next || null), { tip: `Now: ${mark ? `marked ${mark}` : isJunk(item) ? (boilerJunkOn(b) ? "junk the boiler may burn" : "junk, kept from the boiler") : "not burned unless marked"}` }));
    }
  }
}
const verb = (d) => { const v = d.useVerb || "uses"; const w = v.replace(/s$/, ""); return w[0].toUpperCase() + w.slice(1); };
// The guns on a person (in the hands, pockets, rig, pack): [[loc, gun]].
function gunsOn(state, s) {
  ensureInv(s);
  const locs = [`s:${s.id}:weapon`, `s:${s.id}:tool`, ...s.pockets.map((_, i) => `s:${s.id}:pocket:${i}`), ...(rigPouches(s) || []).map((_, i) => `s:${s.id}:rig:${i}`), ...(packOf(s) || []).map((_, i) => `s:${s.id}:pack:${i}`)];
  return locs.map((l) => [l, itemAt(state, l)]).filter(([, g]) => g && isGunKey(g.key));
}
// Treat wounds with meds out of a fight (medical.js treatAnywhere: at a base its medic and stores, on a team its meds).
function medRow(state, s, how) {
  return row("treat", `Treat ${first(s)}'s wounds`, () => treatAnywhere(state, s.id), { why: isHurt(s) ? "" : `${first(s)} is not hurt.`, tip: `Health ${Math.floor(s.health)}: a treatment now ${how}` });
}

// ---------- in a fight ----------
function fightRows(state, ui, m, item, d, s, u, out) {
  const b = state.combat;
  const loc = m.loc;
  const L = parseRaidLoc(loc);
  const mine = u && ((L.o === "s" && L.id === u.sid) || (L.o === "haul" && L.id === u.id));
  const raid = !!(ui.inv && ui.inv.raid && lootLayer(b));
  // Moving it (the search window only: there, by its rules, free; hauling out of a container takes time).
  if (raid) {
    const uid = ui.inv.uid;
    if (L.o === "rbox" || L.o === "trunk") out.push(row("take", "Take", () => raidMove(state, uid, loc, quickTarget(state, b, uid, loc, ui.inv.box ?? ui.inv.ground)), { ap: 0, tip: "Onto the searcher where it fits (hauling: the first kg a turn free)" }));
    else if (ui.inv.ground != null) {
      if (L.o === "s" && EQUIP_SLOTS.includes(d.slot) && L.slot !== d.slot && mine) out.push(row("equip", `Equip (${(SLOT_NAMES[d.slot] || d.slot).toLowerCase()})`, () => raidMove(state, u.id, loc, `s:${u.sid}:${d.slot}`), { ap: 0, tip: "Into its slot (what is there goes where this was): it counts at once" }));
      out.push(row("drop", "Drop here", () => raidMove(state, uid, loc, `rbox:${ui.inv.ground}:list`), { ap: 0, tip: "On the ground where they stand: anyone can pick it up again" }));
    }
  }
  if (!mine) return;
  // The kit view (🎒): a move in their own kit, as a click there would (combatAct "inv", INV_AP; pockets, pack, rig
  // pouches, the hands and the off hand).
  if (!raid && L.o === "s") {
    const to = d.slot === "weapon" || d.slot === "tool" ? d.slot : null;
    if (to && L.slot !== to && ["pocket", "pack", "rig", "weapon", "tool"].includes(L.slot)) out.push(row("equip", to === "weapon" ? "Draw (to the hands)" : "To the off hand", order(state, { type: "inv", unit: u.id, from: loc, to: `s:${u.sid}:${to}` }), { ap: INV_AP, why: turnWhy(state, u, INV_AP), tip: "What is there now goes where this was" }));
    if (amountOf(item) > 1 && (countOf(item) > 1 || (isRoundItem(item) && !isBulk(item))) && ["pocket", "pack", "rig"].includes(L.slot)) out.push(row("split", "Split the stack", order(state, { type: "inv", unit: u.id, from: loc, op: "split" }), { ap: INV_AP, why: turnWhy(state, u, INV_AP) }));
  }
  const hk = heldKeyOf(item);
  if (hk && hk !== "meds" && L.o === "s") { const p = battleUsePlan(state, b, u, { what: "stack", loc }); out.push(row("eat", isDrinkKey(hk) ? "Drink" : "Eat", order(state, { type: "useItem", unit: u.id, what: "stack", loc }), { ap: p.ap, why: turnWhy(state, u, p.ap) || p.why, tip: isDrinkKey(hk) ? "A drink" : "A bite: about a meal at most" })); }
  const inHand = L.o === "s" && L.slot === "weapon" && u.item === item;
  const ranged = WEAPONS[item.key] && !WEAPONS[item.key].melee;
  if (inHand && ranged && calOf(item.key)) {
    const cost = reloadCost(b, u);
    const why = reloadRefusal(b, u);
    out.push(row("reload", "Reload", order(state, { type: "reload", unit: u.id }), { ap: cost, why: turnWhy(state, u, cost) || why || "", tip: isStacked(u) ? "The next loaded spare magazine, else the chamber's round by hand from the nearest place (up to 6)" : "" }));
    if (isStacked(u)) { // the picker (ui/combat.js reloadPicker): a magazine or rounds by hand, in the order they should fire
      const o = reloadOptions(b, u);
      if (o.mags.length + o.clips.length + o.rounds.length) out.push(row("reloadpick", "Reload: pick what to load…", () => { cui.ammoAsk = u.id; cui.msg = ""; }, { ap: 0, why: turnWhy(state, u, 1), tip: `${o.mags.length} magazine${o.mags.length === 1 ? "" : "s"} and ${o.rounds.length} stack${o.rounds.length === 1 ? "" : "s"} of rounds on ${first(s)}: the picker over the orders lists them (rounds up to ${o.per} a Reload, in the order picked)` }));
    }
    const kinds = ammoToHand(state, b, u);
    if (kinds.length > 1) out.push(row("reloadwith", "Reload with", null, { sub: kinds.map((x) => { const c = reloadCost(b, u, x.type); return row(`rl:${x.type}`, `${x.type === u.load ? "✓ " : ""}${x.short || x.name}`, order(state, { type: "reload", unit: u.id, ammo: x.type }), { ap: c, note: `${x.n}`, why: turnWhy(state, u, c) || reloadRefusal(b, u, x.type) || "", tip: `${x.name}: ${x.n} to hand` }); }) }));
    if (u.jam) { const ap = u.jam.ap || 1; out.push(row("unjam", "Clear the jam", order(state, { type: "unjam", unit: u.id }), { ap, why: turnWhy(state, u, ap) })); }
    const modes = unitModes(u);
    if (modes.length > 1) { const cur = curMode(u), next = modes[(modes.indexOf(cur) + 1) % modes.length]; out.push(row("mode", `Fire mode: ${MODE_NAME[next] || next}`, order(state, { type: "firemode", unit: u.id, mode: next }), { ap: 0, why: turnWhy(state, u, 0), tip: `Now ${MODE_NAME[cur] || cur}` })); }
    // The magazine out and in (2026-10-20 user request; sim/mags.js removeMagUnit, a swap into an empty gun).
    if (isStacked(u) && u.magMode === "box" && detachable(item) && !magOut(item)) { const p = removeMagPlan(b, u); out.push(row("magout", "Remove magazine", order(state, { type: "inv", unit: u.id, from: loc, op: "magout" }), { ap: p.cost, why: turnWhy(state, u, p.cost) || p.why, tip: `The magazine out with its rounds (${Math.max(0, (u.mag || 0) - 1)}) into a rig pouch or a pocket (1 action), else the pack (both); the round in the chamber stays in the gun` })); }
    if (isStacked(u) && magOut(item)) {
      const c = insertChoices(b, u);
      out.push(row("magin", "Insert magazine", null, { why: c.length ? "" : `No magazine for the ${u.weaponName || item.name} on them.`, tip: "A magazine they carry into the gun, with the rounds in it (a pouch or a pocket 1 action, the pack both)", sub: c.map((x) => row(`magin:${x.j}`, `${x.item.name} (${x.where === "pack" ? "pack" : x.where === "rig" ? "rig" : "pocket"})`, order(state, { type: "reload", unit: u.id, mag: x.j }), { ap: x.cost, note: `${x.n}/${x.cap}`, why: turnWhy(state, u, x.cost) || x.why || "" })) }));
    }
  }
  if (isGunKey(item.key) && L.o === "s") out.push(row("modify", "Modify", (st2, ui2) => { GB_ACTIONS["gb-open"](state, ui2, { loc, sid: u.sid }); }, { ap: MOD_AP, apNote: "a part", why: turnWhy(state, u, MOD_AP), tip: `The gun builder: only the parts ${first(s)} carries, ${MOD_AP} action a part fitted or taken off` }));
  if (repairKind(item)) out.push(row("repair", "Repair", null, { why: "Not in the middle of a fight.", tip: "A field repair kit or the bench, after the fight" }));
  if (isMag(item) && L.o === "s" && isStacked(u)) { // a spare's rounds out by hand (sim/mags.js unloadMagFrom; combatAct "inv" op "unload")
    const m = magEntryAt(u, carriedSpots(s), loc);
    const p = m ? unloadMagPlan(b, u, m) : { why: `Not one of the ${u.weaponName}'s magazines.` };
    const txt = Array.isArray(item.stack) && item.stack.length ? stackText(MAGAZINES[item.key].cal, item.stack) : "empty";
    out.push(row("magunload", "Unload", order(state, { type: "inv", unit: u.id, from: loc, op: "unload" }), { ap: INV_AP, why: turnWhy(state, u, INV_AP) || p.why || "", tip: `Every round in it (${txt}) out as loose rounds onto ${first(s)}, each kind its own stack. Loose rounds dropped onto it load it (up to 6 a time, any mix the gun takes).` }));
    if (m && m.where !== "gun") { // Load rounds: from the nearest stack of rounds it takes on them (a pocket or the rig 1 action, the pack both: mags.js LOAD_AP), up to 6
      const srcs = roundSources(u, m.key);
      const src = srcs.find((x) => x.where !== "pack") || srcs[0] || null;
      const sl = src ? (carriedSpots(s).find((x) => x.item === src.item) || {}).loc || null : null;
      const lp = src ? loadMagPlan(b, u, m, src.item, src.where) : { cost: LOAD_AP.hand, why: "No rounds for it on them." };
      out.push(row("magloadf", "Load rounds", sl ? order(state, { type: "inv", unit: u.id, from: sl, to: loc, op: "load" }) : null, { ap: lp.cost, why: turnWhy(state, u, lp.cost) || lp.why || (sl ? "" : "No rounds for it on them."), tip: src ? `Up to ${lp.n || 6} from the ${src.n} in ${src.where === "pack" ? "the pack" : src.where === "rig" ? "the rig" : "a pocket"} (${src.where === "pack" ? "both actions" : "1 action"}); or drop rounds onto it in the Inventory window` : "" }));
    }
    if (m && m.where !== "gun") out.push(row("magswap", magOut(u.item) ? "Insert magazine" : "Reload with it", order(state, { type: "reload", unit: u.id, mag: u.mags.indexOf(m) }), { ap: reloadCost(b, u, { mag: u.mags.indexOf(m) }), why: turnWhy(state, u, reloadCost(b, u, { mag: u.mags.indexOf(m) })) || reloadRefusal(b, u, { mag: u.mags.indexOf(m) }) || "", tip: `Swap it into the ${u.weaponName} (${txt}); the magazine in the gun goes here with what is in it` }));
  } else if (isMag(item)) out.push(row("magunload", "Load or unload rounds", null, { why: `In a fight only the magazines of the gun in ${first(s)}'s hands are loaded and unloaded (draw the gun it fits first).`, tip: `A spare magazine reloads in ${ITEM_AP[L.slot === "pack" ? "pack" : "pocket"]} action${L.slot === "pack" ? "s" : ""} from here` }));
  if (d.use) { const p = battleUsePlan(state, b, u, { what: "treat", loc }); out.push(row("use", `${verb(d)} it`, order(state, { type: "useItem", unit: u.id, what: "treat", loc }), { ap: p.ap, why: turnWhy(state, u, p.ap) || p.why, tip: `${useText(item.key)}. Used up.${p.ap > 1 ? " From the pack: 2 actions (1 from a pocket or the rig)." : ""}` })); }
  if (d.medKit || d.selfStab || d.cat === "medical" || d.supKey === "meds") out.push(battleMedRow(state, u));
}
function battleMedRow(state, u) {
  const b = state.combat;
  const why = turnWhy(state, u, 1) || (medsLeft(b) < 1 ? "No meds left." : u.hp >= u.maxHp ? "Not hurt." : "");
  return row("meds", "Use meds on themselves", order(state, { type: "meds", unit: u.id, target: u.id }), { ap: 1, why, tip: `1 meds: heal ${u.name.split(" ")[0]} (${Math.round(u.hp)}/${u.maxHp} hp). ${medsLeft(b)} meds left. Next to a teammate: Use meds in the battle panel.` });
}

// ---------- supply stacks and the pack of food and water ----------
function stackRows(state, ui, m, st, s, u, inFight) {
  const out = [];
  const L = parseRaidLoc(m.loc);
  const name = (SUPPLIES[st.key].name || st.key).toLowerCase();
  const movable = L.o === "body" || RAID_O.has(L.o) || INV_STACK_DESTS.some((f) => (f(state, ui, m.loc) || []).length);
  if (movable && ui.inv) out.push(row("move", "Move…", (st2, ui2) => { ui2.invSel = null; INV_ACTIONS["inv-click"](state, ui2, { loc: m.loc }, null); }, { ap: inFight ? 0 : undefined, keepSel: true, tip: "How many and where: the stack mover" }));
  if (isFoodKey(st.key) || isDrinkKey(st.key)) {
    const drink = isDrinkKey(st.key);
    const label = `${drink ? "Drink" : "Eat"}${s ? ` (${first(s)})` : ""}`;
    if (inFight) {
      if (L.o === "haul" && u && L.id === u.id) { const p = battleUsePlan(state, state.combat, u, { what: "stack", loc: m.loc }); out.push(row("eat", label, order(state, { type: "useItem", unit: u.id, what: "stack", loc: m.loc }), { ap: p.ap, why: turnWhy(state, u, p.ap) || p.why, tip: drink ? "A few gulps" : "A bite: about a meal at most" })); }
      else out.push(row("eat", label, null, { why: "In a fight: only what the fighter carries themselves." }));
    } else if (s) out.push(row("eat", label, () => useStack(state, s.id, m.loc), { why: stackUseRefusal(state, s, m.loc), tip: drink ? `Up to their fill (thirst ${Math.round(s.thirst ?? 100)})` : `${FOODS[st.key] ? FOODS[st.key].name : name}: up to their fill (hunger ${Math.round(s.hunger ?? 100)})` }));
  }
  if (st.key === "meds" && s) {
    if (inFight) { if (u) out.push(battleMedRow(state, u)); }
    else out.push(medRow(state, s, "with the meds here"));
  }
  return out;
}
function rationRows(state, s, u, inFight) {
  if (!s) return [];
  const out = [];
  for (const what of ["eat", "drink"]) {
    const label = what === "eat" ? `Eat from the pack (${Math.round(packFood(s) * 10) / 10} d)` : `Drink (${Math.round(packWater(s) * 10) / 10} water)`;
    if (inFight) {
      if (!u) continue;
      const p = battleUsePlan(state, state.combat, u, { what });
      out.push(row(what, label, order(state, { type: "useItem", unit: u.id, what }), { ap: p.ap, why: turnWhy(state, u, p.ap) || p.why, tip: what === "eat" ? "A bite out of the pack: about a meal at most (2 actions: it is in the pack)" : "A few gulps from the water they carry" }));
    } else out.push(row(what, label, () => usePack(state, s.id, what), { why: packUseRefusal(state, s, what), tip: what === "eat" ? `Up to their fill (hunger ${Math.round(s.hunger ?? 100)})` : `Up to their fill (thirst ${Math.round(s.thirst ?? 100)})` }));
  }
  return out;
}

// ---------- drawing ----------
const apText = (r) => (r.ap === undefined ? r.note || "" : `${r.note ? `${r.note} · ` : ""}${r.ap > 0 ? `${r.ap} AP${r.apNote ? ` ${r.apNote}` : ""}` : "free"}`);
const findRow = (rows, id) => { for (const r of rows) { if (r.id === id) return r; if (r.sub) { const x = findRow(r.sub, id); if (x) return x; } } return null; };
export function itemMenuHtml(state, ui) {
  const m = ui.imenu;
  if (!m) return "";
  const rows = rowsFor(state, ui, m);
  if (!rows.length) { ui.imenu = null; return ""; }
  const item = itemOf(state, m.loc), st = stackOf(state, m.loc);
  const s = userOf(state, ui, m), u = fighterOf(state, s);
  const title = item ? item.name : st ? `${SUPPLIES[st.key].name} ×${st.n}` : "Food and water on them";
  const sub = fight(state) && u ? `${u.name.split(" ")[0]}: ${plural(u.ap, "action")} left${state.combat.phase !== "player" ? " (enemy turn)" : ""}` : s && (!item || parseLoc(m.loc).o !== "s") ? `for ${first(s)}` : "";
  const btn = (r, depth) => {
    const off = !!r.why || (!r.run && !r.sub);
    const open = r.sub && m.open === r.id;
    const label = `${esc(r.label)}${r.sub ? ` <span class="muted">${open ? "▾" : "▸"}</span>` : ""}`;
    return `<button class="imrow${off && !r.sub ? " off" : ""}${depth ? " imsub" : ""}" data-action="im-run" data-id="${esc(r.id)}"${tip([r.why, r.tip].filter(Boolean).join(" — "))}><span>${label}</span><span class="imap">${esc(apText(r))}</span></button>${open ? r.sub.map((x) => btn(x, depth + 1)).join("") : ""}`;
  };
  const info = m.info && item ? `<div class="iminfo small muted">${esc(itemTip(item, s))}</div>` : "";
  return `<div class="imenu" style="left:${m.x}px;top:${m.y}px"><div class="imhead"><b>${esc(title)}</b>${sub ? `<span class="small muted">${esc(sub)}</span>` : ""}</div>${rows.map((r) => btn(r, 0)).join("")}${info}</div>`;
}

export const ITEMMENU_ACTIONS = {
  "im-run": (state, ui, d) => {
    const m = ui.imenu;
    if (!m) return;
    const r = findRow(rowsFor(state, ui, m), d.id);
    if (!r) return;
    if (r.sub) { m.open = m.open === r.id ? null : r.id; return; }
    if (r.why || !r.run) return;
    const msg = r.run(state, ui);
    say(state, ui, msg);
    if (!r.keep) { ui.imenu = null; if (!r.keepSel && ui.invSel === m.loc && !ui.ask) ui.invSel = null; }
  },
  "im-close": (state, ui) => { ui.imenu = null; },
};
