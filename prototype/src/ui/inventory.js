// RPG-style inventory screen (paper doll) and the "Loot the bodies" screen after a won battle.
// Rules live in sim/inventory.js; this file only draws and turns clicks / drags into moveItem calls.
// ui.inv = { sid, loot: bool, body: index }  ui.invSel = selected location string  ui.invMsg = last message.
// Click an item to select it, then click a slot, pocket, pack cell or the storage box to move it there
// (click the selected item again to send it across: onto the person, or into storage). Drag and drop works too.
import { finishOf, FINISH_NAME, GUN_FINISH } from "../sim/data-finish.js"; // a gun's finish in its tooltip
import { keyWord } from "../sim/water.js"; // supplies as words: "9mm FMJ", "rounds"
import { GEAR, SUPPLIES, SKILL_NAMES, supWeight } from "../sim/data.js";
import { survivorById, atBase, baseById, gearEffect, combatPower } from "../sim/world.js";
import { partyMembers, partyCapacity, cargoLoad, poolLoad, partyLoad } from "../sim/parties.js";
import { wornLoad, maxLoad, personLoad, bandName, feelFactor } from "../sim/load.js";
import { packFood, packWater, packKg, PACK } from "../sim/eating.js"; // the food and water everyone carries
import { bandChip, BANDS_HELP } from "./loadview.js";
import { itemDur, itemDurMax, durUnit } from "../sim/crafting.js";
import { worthTier } from "../sim/valuation.js";
import {
  EQUIP_SLOTS, SLOT_NAMES, POCKETS, ensureInv, packOf, packSize, ensurePack, isCarryable, armorPower, itemAt, parseLoc, moveItem, quickMove, toStorage,
  personPlace, battlePlace, storageFor, battleBodies, bodyHolder, bodyEmpty, takeSupply, takeAllBody, takeAllBodies, itemLoad, allItems,
  breakDownInfo, breakDownAt, setFireMark, modChoices, fitModAt, unfitModAt, salvageInfo, salvageAt, salvageYield, salvageText, placeOfLoc,
} from "../sim/inventory.js";
import { repairKind, repairInfo, fieldRepairInfo, repairPreview, queueRepair, fieldRepair, cancelRepair, repairJobStatus } from "../sim/repair.js"; // gear repairs at the bench
import { ATTACH, MOUNTS, MOUNT_NAMES, takesMods, modsText, attachText, fitsText, modFitReason, modLabel } from "../sim/gunmods.js"; // gun attachments
import { isJunk, armoryJunk, burnablesWood, breakDownJunk, boilerJunkOn, BURN } from "../sim/woodcutting.js"; // break down for firewood; what the boiler may burn
import { survivorURL, spriteImg, canvasURL, unitCanvas } from "./sprites.js";
import { figureSpinImg } from "./figures.js"; // the survivor as a low-poly figure turning through 360°, to see all that is on them
import { cui } from "./combat.js";
import { shortName } from "./names.js";
import { useItemOn, useText } from "../sim/comforts.js";
import { partyFleet, vehicleLabel, isBike } from "../sim/vehicles.js";
import { raidMove, raidItemAt, parseRaidLoc, raidTakeAll, stashAll, personalLoad, trunkInfo, atVehicle, raidParty, quickTarget, matesOf, hauled, haulBudget, HAUL, supplyFit } from "../sim/raidloot.js";
import { combatAct, INV_AP, HANDOVER_AP, handoverRefusal, handoverTargets } from "../sim/combat.js"; // INV_AP: a move in the fight's inventory window (combatAct "inv"); HANDOVER_AP: one to the survivor next to you (combatAct "handover")
import { lootLayer } from "../sim/raidloot.js";
import { groundPile, fieldReady, pileCount } from "../sim/ground.js"; // bodies searched where they fell, things on the ground
import { SEARCH } from "../sim/search.js";
import { ask } from "./confirm.js"; // breaking down anything above junk asks first (one confirmation style)
import { itemArtHtml } from "./itemart.js"; // every other item's own drawing on its tile
import { isGunKey, gunIconHtml } from "./gunart.js"; // a gun (not a bow or a blade): the gun builder opens on it; its picture on its tile
import { gunTipText, slotOfPart, SLOT_NAMES as PART_SLOT_NAMES } from "./gunbuilder.js"; // the gun builder (ui/gunbuilder.js)
import { isHelmet, isHelmetPart, helmetSlots, helmetChoices, helmetFitReason, fitHelmetAt, stripHelmetAt, helmetLabel, HELMET_ATTACH, MOUNT_NAMES as HELM_MOUNTS } from "../sim/helmets.js"; // helmet mounts: visors, night vision, a light, ear protection
import { rigOf, pouchesOf, isCarrier, insertsOf } from "../sim/inventory.js"; // rigs and plate carriers (section 16)
import { POUCH_NAMES, POUCH_ICON, MAGAZINES } from "../sim/data-kit.js";
import { battleKg, bandFor } from "../sim/carrykit.js"; // the battle load band (R17)
import { roundName, calName } from "../sim/rounds.js";
import { stackLabel, isRoundItem, isBulk, amountOf, countOf, boxesIn, bulkRecord, roundCap, stackMax } from "../sim/itemstack.js"; // stacks in a slot (2026-10-10)
import { splitAt, openAt, boxAt } from "../sim/inventory.js";
import { itemKeyOf, roomOn, stockToPerson, bodyToPerson, supRoom, suppliesOnto, SUP_PLACES, PLACE_WORDS } from "../sim/supitems.js"; // supplies out of the stores as items you hold (2026-10-16); onto a place of theirs (2026-10-18)
import { isRoundKey } from "../sim/rounds.js"; // rounds out of the stores: boxed or loose
import { holdSection } from "./carry.js"; // the team's supplies this person carries (pockets, pack, arms), the ground
import { bagRefusal } from "../sim/carry.js"; // Carry in arms (the search window): a bag, a rig or a case into the arms
import { isGunCase, caseText, openCaseAt } from "../sim/gunsafes.js"; // gun cases: opened for free at a base or a camp
import { registerStackScreen, openStack, closeStack, stackPanel, chosenQty, supplyIcon, splitCount, STACK_ACTIONS, STACK_CHANGE } from "./stackmove.js"; // how many of a supply stack, and where
import { lootFit } from "../sim/stacks.js";
import { armoryView } from "./armoryview.js"; // the storage box's items grouped by type, cards or compact rows
import { itemShortTip, tipAttrs, roundsBadge } from "./itemlabels.js"; // the short hover tip (Shift: the full one), the rounds badge on a gun
import { rowName, rowCount, supplyName, supplyCount } from "../sim/itemnames.js"; // row names: "magazine", rounds "— loose", the count on the right

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => esc(shortName(s)); // first name, with a last initial when two people share it

// ---------- item tiles ----------
// Guns: any ranged weapon that is not a bow (combat.js WEAPONS; the overhaul's new guns too).
const TOOL_ICON = { bandagekit: "✚", surgkit: "✚", milradio: "📻", nvg: "🥽", crowbar: "🔧", waterfilter: "💧", bicycle: "🚲",
  guitar: "🎸", harmonica: "🎵", cards: "🃏", photos: "🖼", pipebomb: "💣", molotov: "🔥", flare: "🎆", smokegren: "💨", flashbang: "💥", cuffs: "⛓", gamecall: "📯",
  camonet: "⛺", ghillie: "🌿", stove: "⛺", scentmask: "🫙", ragboots: "🥾" };
// By trade category (data.js CATEGORIES): valuables and treats at a glance.
const CAT_ICON = { jewelry: "💍", smokes: "🚬", liquor: "🍾", treats: "🍫", gadgets: "📱", collectibles: "🪙", household: "🧻", defence: "🚧", bow: "🏹" };
const SLOT_ICON = { weapon: "🗡", tool: "🧰", head: "⛑", armor: "🦺", arms: "🧤", legs: "🦵", backpack: "🎒", rig: "🦺", insert: "▭" };
export const SUPPLY_ICON = { food: "🥫", water: "💧", rawwater: "🪣", wood: "🪵", fuel: "⛽", meds: "✚", ammo: "⁍", parts: "⚙", scrap: "🔩", carparts: "🛞", gunparts: "🔧", electronics: "🔌" };
// A gun's tile shows the gun itself (ui/gunart.js gunThumb: as fitted, in its finish), a row of its own over its name.
const gunTile = (item) => (isGunKey(item.key) ? (() => { const h = gunIconHtml(item, 1.05); return h ? `<span class="iico igunrow">${h}</span>` : ""; })() : "");
function icon(key) {
  const d = GEAR[key];
  if (isGunKey(key)) return "🔫";
  if (d.supKey) return supplyIcon(d.supKey); // a supply out of the stores (sim/supitems.js): its stock tile's icon
  return TOOL_ICON[key] || CAT_ICON[d.cat] || SLOT_ICON[d.slot] || (d.book ? "📖" : "▪");
}

// Hover text for an item, with the skill-gap rule for the person who would use it.
export function itemTip(item, s = null) {
  const d = GEAR[item.key];
  const kgTxt = `${Math.round(itemLoad(item) * 10) / 10} kg${item.contents && item.contents.some(Boolean) ? " with what is inside" : ""}`;
  const bits = [`${d.name} (${SLOT_NAMES[d.slot] || d.slot}${d.small ? ", fits a pocket" : d.bulky ? ", cargo only" : ""}, ${kgTxt})`];
  if (d.slot === "weapon") bits.push(`power ${d.power}${d.req ? `, needs ${SKILL_NAMES[d.skill]} ${d.req} for full use` : ""}`);
  if (d.slot === "weapon" && item.mods) bits.push(modsText(item)); // sim/gunmods.js: what is fitted and the net effect
  if (isHelmet(item.key)) bits.push(`${item.mods ? `fitted: ${helmetLabel(item).replace(/^[^(]*\(|\)$/g, "")}; ` : ""}mounts: ${helmetSlots(item).map((m) => HELM_MOUNTS[m].toLowerCase()).join(", ") || "none (a full shell)"}`); // sim/helmets.js
  if (isHelmetPart(item.key) && !GEAR[item.key].ears) bits.push(`helmet part (${HELM_MOUNTS[HELMET_ATTACH[item.key].mount].toLowerCase()}): select a helmet and fit it`);
  if (d.slot === "weapon" && isGunKey(item.key)) { const g = gunTipText(item); if (g) bits.push(g); } // ui/gunbuilder.js: its slots, its load, how reliable
  if (MAGAZINES[item.key]) bits.push(`magazine: ${MAGAZINES[item.key].cap} rounds${MAGAZINES[item.key].cals ? ` of ${MAGAZINES[item.key].cals.map(calName).join(", ")}` : ""}${item.load ? `, loaded with ${roundName(MAGAZINES[item.key].cal, item.load)}` : " of the gun's own load"}; fits ${fitsText(item.key)}. A spare in a rig pouch or a pocket reloads in 1 action, from the pack in 2; fit one in the gun builder (⚙ Modify on the gun)`);
  else if (ATTACH[item.key]) bits.push(`gun attachment (${MOUNT_NAMES[ATTACH[item.key].mount].toLowerCase()}): ${attachText(item.key)}; fits ${fitsText(item.key)}; fit it in the gun builder (⚙ Modify on the gun)`);
  else if (d.slot === "rig" || (d.pouches && d.slot === "armor")) bits.push(`${d.slot === "rig" ? "chest rig" : `armor ${d.power} with pouches`}: ${pouchText(d.pouches)}; +${d.carry || 0} kg max load${isCarrier(item) ? `; plates: ${Object.entries(insertsOf(item)).map(([k, p]) => `${k} ${p ? p.name.toLowerCase() : "empty"}`).join(", ")}` : ""}`);
  else if (d.slot === "insert") bits.push("a plate for a plate carrier's front or back pocket");
  else if (slotOfPart(item.key)) bits.push(`gun part (${(PART_SLOT_NAMES[slotOfPart(item.key)] || slotOfPart(item.key)).toLowerCase()}): fit it in the gun builder (⚙ Modify on the gun)`);
  else if (["armor", "head", "arms", "legs"].includes(d.slot)) bits.push(`armor ${d.power} (adds up across body, head, arms and legs)`);
  else if (d.slot === "backpack") bits.push(`${packSize(item)} pack slots, +${d.carry || 0} kg max load${d.ease ? `, spreads the weight: the wearer's load counts ${Math.round(d.ease * 100)}% lighter for their load band` : ""}`);
  else if (d.book) bits.push(d.book.skill ? `${d.craftBook ? "craft book" : "book"}: teaches ${SKILL_NAMES[d.book.skill]} up to ${d.book.max}, ${d.book.hours} hours to read (Read role at a base, from the armory)` : `book: +${d.book.mood} mood an hour read, ${d.book.hours} hours`); // skills.js; a craft book's unlocks are in its description (blueprints.js)
  else if (d.valuable) bits.push("a valuable: good for nothing but trade");
  else if (d.use) bits.push(`used up: ${useText(item.key)} (select it, then Use)`); // sim/comforts.js
  else if (d.groom) bits.push(`toiletry: +${d.groom} mood a day to whoever carries it, or to everyone with none of their own where it is kept (a base's armory, a team's cargo); a day of use a day each`); // sim/comforts.js
  else if (d.comfort) bits.push(d.comfort.team ? `comfort: +${d.comfort.team} mood a day for everyone at the base or on the team that has it` : `keepsake: +${d.comfort.self} mood a day to whoever carries it`);
  else if (d.heat) bits.push("camp kit: less Heat for the team that carries it (see the team's Heat)"); // sim/fieldheat.js
  else if (d.defence) bits.push("base defence: works from a base's armory (see the base's horde defences)"); // sim/defences.js
  else if (d.throw) bits.push("thrown in battle (Throw button), from a pocket, the pack, the cargo or the armory");
  else if (d.power) bits.push(`power ${d.power}${d.req && d.skill ? `, needs ${SKILL_NAMES[d.skill]} ${d.req}` : ""}`);
  if (s && d.skill && d.req) {
    const e = gearEffect(s, item);
    if (e.gap > 0) bits.push(e.usable ? `${s.name.split(" ")[0]} is ${e.gap} below the skill: weaker${e.damageChance ? ", may damage it" : ""}` : `${s.name.split(" ")[0]} cannot use it`);
  }
  { const f = finishOf(item); if (f && (GUN_FINISH[item.key] || []).length > 1) bits.push(`finish: ${FINISH_NAME[f] || f}`); } // sim/data-finish.js
  bits.push(`worth: ${worthTier(item)}`); // a rough tier: the price depends on who you trade with (sim/valuation.js)
  if ((item.quality || 1) < 1) bits.push(`condition ${Math.round(item.quality * 100)}%`);
  const dur = itemDur(item);
  if (dur != null) bits.push(d.tabs ? `${dur} of ${d.dur} tablets left` : d.count ? `${dur} of ${d.dur} left` : d.groom ? `${dur} of ${d.dur} days of use left` : `${d.makeshift ? "makeshift: " : ""}${dur} of ${itemDurMax(item)} ${durUnit(item.key)} left before it breaks`);
  if (item.contents) bits.push(`holds ${item.contents.filter(Boolean).length} of ${item.contents.length} items`);
  return `${bits.join(". ")}.${d.desc ? ` ${d.desc}` : ""}`;
}

const pouchText = (P) => { const n = {}; for (const k of P || []) n[k] = (n[k] || 0) + 1; return Object.entries(n).map(([k, c]) => `${c} ${String(POUCH_NAMES[k] || k).toLowerCase()}${c > 1 ? "s" : ""}`).join(", ") || "no pouches"; };
export function tile(item, loc, s, drag = true) {
  const d = GEAR[item.key];
  const dur = itemDur(item);
  const frac = dur != null ? dur / itemDurMax(item) : item.quality || 1;
  const col = frac > 0.6 ? "var(--good)" : frac > 0.3 ? "var(--accent)" : "var(--danger)";
  const unusable = s && d.skill && d.req && !gearEffect(s, item).usable;
  return `<div class="itile${unusable ? " bad" : ""}"${drag ? ` draggable="true" data-drag="${loc}"` : ""}${tipAttrs(itemShortTip(item, loc, s), itemTip(item, s))}>
    ${gunTile(item) || `<span class="iico">${itemArtHtml(item.key) || icon(item.key)}</span>`}<span class="iname">${esc(rowName(item))}</span>${roundsBadge(item, loc)}<span class="ikg">${Math.round(itemLoad(item) * 10) / 10}</span>
    ${item.contents ? `<span class="icount">${item.contents.filter(Boolean).length}/${item.contents.length}</span>` : rowCount(item) ? `<span class="icount">${rowCount(item)}</span>` : ""}
    <i class="idur"><b style="width:${Math.round(Math.max(0.05, Math.min(1, frac)) * 100)}%;background:${col}"></b></i></div>`;
}

// One slot box (equipment, pocket or pack cell). Clicks select / drop; drops land on data-drop.
function slotBox(state, ui, loc, label, s, readonly) {
  const item = itemAt(state, loc);
  const sel = ui.invSel === loc ? " sel" : "";
  const act = readonly ? (item ? ` data-loc="${loc}"` : "") : ` data-action="inv-click" data-loc="${loc}" data-drop="${loc}"`; // read-only: still right-clicked for the item menu (ui/itemmenu.js)
  return `<div class="islot${sel}${item ? "" : " empty"}"${act}${item ? "" : tip(`${label}: empty`)}><span class="islab">${label}</span>${item ? tile(item, loc, s, !readonly) : ""}${!readonly && /:weapon$/.test(loc) ? gearCog(state, ui, item, loc) : ""}</div>`;
}
// ⚙ on a gun: the gun builder (ui/gunbuilder.js). Not on a body, not in the loot or search windows, not in a battle.
function gearCog(state, ui, item, loc) {
  if (!item || !isGunKey(item.key) || state.combat || !ui.inv || ui.inv.loot || ui.inv.raid || /^body:/.test(loc)) return "";
  return `<button class="mini gbcog" data-action="gb-open" data-loc="${loc}" style="position:absolute;right:2px;top:2px;padding:0 0.25rem;line-height:1.2"${tip(`Modify the ${item.name}: the gun builder (sights, muzzle, magazine, stock, grip and the rest; the ammo it is loaded with)`)}>⚙</button>`;
}

// The paper doll: portrait in the middle, hands / off hand / pack on the left, head / body / arms / legs on the
// right, pockets and pack below. holder = survivor or body; prefix = "s:<id>" or "body:<i>".
// "Food on them": the pack of food and water everyone carries (sim/eating.js), counted in their load.
const foodLine = (s) => `<div class="small muted" data-imenu="ration:${s.id}"${tip(`Their pack of food and water (sim/eating.js: about ${PACK.food} days of each, topped up from the stores at a base each morning; eaten away from the stores). Counted in the load above. Right-click: eat or drink from it now.`)}>Food on them: ${Math.round(packFood(s) * 10) / 10} d · water ${Math.round(packWater(s) * 10) / 10} (${Math.round(packKg(s) * 10) / 10} kg)</div>`;
export function doll(state, ui, holder, prefix, portrait, { readonly = false, user = null, weightLine = null } = {}) {
  ensureInv(holder);
  const box = (slot) => slotBox(state, ui, `${prefix}:${slot}`, SLOT_NAMES[slot], user, readonly);
  const pk = packOf(holder);
  const arm = armorPower(holder);
  // What they wear and carry (sim/load.js); with a team, their share of its supplies and cargo too.
  let weight = weightLine || "";
  if (holder.traits && !weightLine) {
    const worn = wornLoad(holder), max = maxLoad(holder);
    const place = personPlace(holder);
    const team = place && place.startsWith("party:") ? state.parties.find((x) => x.id === Number(place.split(":")[1])) : null;
    const mine = team ? partyLoad(state, team).foot.people.find((x) => x.sid === holder.id) : null;
    const pl = mine || personLoad(holder, worn);
    weight = `<div class="small"${tip(`${team ? `Wears ${Math.round(worn * 10) / 10} kg and carries ${Math.round((pl.load - worn) * 10) / 10} kg of the team's supplies and cargo (shared so everyone is equally burdened)` : `Wears and carries ${Math.round(worn * 10) / 10} kg`}, of a ${max} kg max load (40, 28 with a Bad Back, 48 with a Strong Back, + the pack and Packrat). On foot: pace ${Math.round(pl.speed * 100)}%, food and water ${Math.round(pl.eat * 100)}% on the move. ${BANDS_HELP}`)}>${Math.round(pl.load)}/${max} kg ${bandChip(pl.band)}</div>`;
  }
  return `<div class="doll">
      <div class="dollside">${box("weapon")}${box("tool")}${box("rig")}${box("backpack")}${box("carry")}</div>
      <div class="dollport">${portrait}<div class="small muted"${tip("Armor from every worn piece (body, head, arms, legs) adds up, to a cap of 5.5. Each point cuts damage taken by 6%.")}>Armor ${Math.round(arm * 10) / 10}</div>${weight}${holder.traits ? foodLine(holder) : ""}${battleLine(holder)}</div>
      <div class="dollside">${box("head")}${box("armor")}${insertBoxes(state, ui, holder, prefix, user, readonly)}${box("arms")}${box("legs")}</div>
    </div>
    <div class="invlabel"${tip("Pockets hold small things: knives, pistols, kits, radios, goggles. Nothing in a pocket is in use until it is moved to a hand.")}>Pockets</div>
    <div class="invgrid">${Array.from({ length: POCKETS }, (_, i) => slotBox(state, ui, `${prefix}:pocket:${i}`, "", user, readonly)).join("")}</div>
    ${rigBoxes(state, ui, holder, prefix, user, readonly)}
    <div class="invlabel"${tip("A pack holds anything but another pack or something bulky. Wear a backpack to get pack slots and a higher max load. Everything in it still weighs what it weighs.")}>Pack${pk ? ` (${pk.filter(Boolean).length}/${pk.length})` : ""}</div>
    ${pk ? `<div class="invgrid">${pk.map((_, i) => slotBox(state, ui, `${prefix}:pack:${i}`, "", user, readonly)).join("")}</div>` : `<div class="small muted">No backpack, no pack slots.</div>`}${carriedBagBoxes(state, ui, holder, prefix, user, readonly)}`;
}

// A bag carried in the arms (In arms slot, sim/carry.js): its weight, the hands-full rule, and its contents to take
// things out of (or put in). Put it on by moving it to Backpack (or Rig) when that is free.
function carriedBagBoxes(state, ui, holder, prefix, user, readonly) {
  const bag = holder.gear && holder.gear.carry;
  if (!bag) return "";
  const cells = packSize(bag) ? ensurePack(bag) : null;
  return `<div class="invlabel warn"${tip(`Carried in the arms, not worn: ${Math.round(itemLoad(bag) * 10) / 10} kg with what is in it, on top of the load. Hands full: no shooting, blows with a weapon, reloading, throwing or treating until it is set down (free in a fight). Move it to Backpack to wear it (if the back is free), or take things out of it here.`)}>In arms: ${esc(bag.name)} (${Math.round(itemLoad(bag) * 10) / 10} kg${cells ? `, ${cells.filter(Boolean).length}/${cells.length}` : ""})</div>
    ${cells ? `<div class="invgrid">${cells.map((_, i) => slotBox(state, ui, `${prefix}:bag:${i}`, "", user, readonly)).join("")}</div>` : ""}`;
}
// The rig's pouches (a chest rig, a tactical vest's, a plate carrier's): one box a pouch, labelled by kind.
function rigBoxes(state, ui, holder, prefix, user, readonly) {
  const rig = rigOf(holder);
  if (!rig) return "";
  const P = pouchesOf(rig);
  return `<div class="invlabel"${tip(`The ${rig.name}'s pouches: ${pouchText(P)}. Rifle and pistol pouches take magazines (and speedloaders, stripper clips), a grenade pouch anything thrown, a radio pouch a radio, an admin pouch small things up to 0.5 kg (meds, a flashlight, tablets), a pocket pouch anything a pocket takes (a knife, a pistol, a phone, meds, boxes or a handful of rounds, a magazine). A magazine from a pouch reloads in 1 action (2 from the pack); a grenade or meds from a pouch take 1 as from a pocket.`)}>Rig (${esc(rig.name)})</div>
    <div class="invgrid">${P.map((k, i) => slotBox(state, ui, `${prefix}:rig:${i}`, `${POUCH_ICON[k] || ""} ${POUCH_NAMES[k] || k}`, user, readonly)).join("")}</div>`;
}
// A plate carrier's plate pockets (front, back) under the body slot, with their durability bars.
function insertBoxes(state, ui, holder, prefix, user, readonly) {
  const c = holder && holder.gear && holder.gear.armor;
  if (!isCarrier(c)) return "";
  return ["front", "back"].map((side) => slotBox(state, ui, `${prefix}:insert:${side}`, side === "front" ? "Front plate" : "Back plate", user, readonly)).join("");
}
// The battle load band (sim/carrykit.js, R17): how the kit carried moves them in a fight.
function battleLine(holder) {
  if (!holder || !holder.traits) return "";
  const kg = battleKg(holder), B = bandFor(kg * feelFactor(holder)); // felt: an assault pack's frame, a bad back
  const what = B.mob === 5 && !B.dash ? "full speed" : `${B.mob} tiles an action${B.dash ? `, a dash ${B.mob * 2 + B.dash}` : ""}`;
  return `<div class="small muted"${tip(`In a fight they carry ${Math.round(kg * 10) / 10} kg (worn, held, pockets, rig, pack and the rounds in their magazines): Light up to 18 kg moves 5 tiles an action, Medium up to 28 still 5 but a dash (both actions) 9, Heavy up to 38 4, more 3. Enemies are slowed by their kit the same way.`)}>Fight: ${esc(B.name)} (${esc(what)})</div>`;
}
// A team's supplies as one stock for the tiles: what it found (the cargo) and what it packed, by key. A move draws on
// the found cargo first, then the packed supplies (teamHolders: the order sim/supitems.js suppliesOnto takes them).
const teamPool = (p) => { const out = {}; for (const pool of [p.cargo && p.cargo.supplies, p.supplies]) for (const [k, v] of Object.entries(pool || {})) if (SUPPLIES[k] && v > 0) out[k] = (out[k] || 0) + v; return out; };
const teamHolders = (p) => [p.cargo || (p.cargo = { supplies: {}, gear: [] }), p];
// Storage at a place: the base armory or the team's cargo, as a drop box with item tiles.
export function storageBox(state, ui, place, user) {
  const st = storageFor(state, place);
  if (!st) return "";
  const loc = `${st.o}:${st.id}:list`;
  let head;
  if (st.o === "cargo") {
    const cap = partyCapacity(state, st.party), load = poolLoad(st.party);
    const v = partyFleet(state, st.party); // a car or bikes (or several: sim/vehicles.js fleets): the cargo rides in it (on a raid map its trunk is opened at the vehicle, sim/raidloot.js)
    head = `<div class="spread"><b${tip(v ? `The team's cargo rides in the ${vehicleLabel(v).toLowerCase()}${isBike(v) ? " (15 kg a rack; the rest is shared out among the people)" : ""}. Drag things from a survivor into it, or out of it onto them. On a raid map the vehicle waits in its zone: walk to it to load or unload.` : "Found cargo the team carries, by weight (a pack also weighs what is in it). It is shared out with the packed supplies among the team (sim/load.js). Moving things between the cargo and the people weighs nothing extra: it is the same team.")}>${v ? `${esc(vehicleLabel(v))} (team cargo)` : "Team cargo"}</b><span class="small ${load > cap ? "danger" : "muted"}"${tip("Supplies and cargo against what the team can carry on top of what it wears (and its vehicle)")}>load ${Math.round(load)}/${Math.round(cap)} kg</span></div>
      <div class="bar"><i style="width:${Math.min(100, (load / Math.max(1, cap)) * 100)}%;background:${load > cap * 0.9 ? "var(--danger)" : "var(--info)"}"></i></div>`;
  } else {
    // Junk with firewood in it (sim/woodcutting.js): the bulk button breaks it all down (marked "keep" stays).
    const b = baseById(state, st.id);
    const junk = b ? armoryJunk(b) : [];
    const bulk = junk.length ? ` <button class="mini" data-action="inv-burnjunk" data-base="${st.id}"${tip(`Break down every piece of junk with firewood in it (wooden, paper or cloth things worth ${BURN.junkValue} or less, not marked Keep): ${junk.length} item${junk.length === 1 ? "" : "s"}, +${burnablesWood(junk)} firewood into ${b.name}'s stores.`)}>Break down junk for firewood (+${burnablesWood(junk)})</button>` : "";
    head = `<div class="spread"><b${tip("Gear stored at this base. Equip it on anyone here.")}>Armory</b><span class="small muted">${st.list.length} items${bulk}</span></div>${b ? repairsBox(state, b) : ""}`;
  }
  // The supplies kept here, as stacks with their weight (firewood too: 0.1 kg each): the team's supplies (what it packed
  // and what it found, one stock for the tiles: teamPool; the user's request 2026-10-18: the packed rounds in the truck
  // dragged onto a survivor before a raid, not a line of text), the base's stores.
  const pool = st.o === "cargo" ? teamPool(st.party) : ((baseById(state, st.id) || {}).stock || {});
  // Stack tiles (ui/stackmove.js): movable where something can take them (INV_STACK_DESTS), else just shown.
  const sups = Object.entries(pool).filter(([k, v]) => SUPPLIES[k] && v >= 1);
  const supKg = sups.reduce((a, [k, v]) => a + supWeight(k) * v, 0);
  const packedOf = (k) => (st.o === "cargo" ? Math.floor(Math.max(0, (st.party.supplies || {})[k] || 0)) : 0);
  const supHtml = sups.length ? `<div class="invlabel"${tip(st.o === "cargo" ? "The team's supplies, by weight: what it packed at the start and what it found on the way (one pool: shared out among the people, or riding in the vehicle). Drag a stack onto a member's pockets, rig or pack (rounds boxed or loose), or click it and say how many." : "The base's stores: food, water, firewood, fuel, meds, rounds by calibre and type, parts")}>${st.o === "cargo" ? "Supplies" : "In the stores"} (${kg(supKg)} kg)</div>
    <div class="istore supgrid">${sups.map(([k, v]) => { const l = `${st.o}:${st.id}:sup:${k}`; const pk = packedOf(k); const extra = pk > 0 && pk < Math.floor(v) ? ` ${pk} packed at the start, ${Math.floor(v) - pk} found on the way.` : pk > 0 ? " Packed at the start." : st.o === "cargo" ? " Found on the way." : ""; return supTile(ui, l, k, v, extra, invDests(state, ui, l).length > 0); }).join("")}</div>` : "";
  return `${head}${storageGroups(state, ui, st, loc, user)}
    ${supHtml}`;
}
// The stored items grouped by type, as cards or compact rows (ui/armoryview.js), inside the drop box. Each keeps the
// tile's clicks and drags: data-action="inv-click" data-loc (the item), data-drop (the list), data-drag; the ⚙ on a gun.
function storageGroups(state, ui, st, loc, user) {
  const entries = st.list.map((item, i) => ({ item, loc: `${loc}:${i}`, bad: !!(user && GEAR[item.key] && GEAR[item.key].skill && GEAR[item.key].req && !gearEffect(user, item).usable) }));
  const cell = (e, inner, cls) => `<div class="islot store ${cls}${ui.invSel === e.loc ? " sel" : ""}" data-action="inv-click" data-loc="${e.loc}" data-drop="${loc}"${tip(`Weighs ${Math.round(itemLoad(e.item) * 10) / 10} kg`)}><div class="ain" draggable="true" data-drag="${e.loc}"${tipAttrs(itemShortTip(e.item, e.loc, user, state), itemTip(e.item, user))}>${inner}</div>${gearCog(state, ui, e.item, e.loc)}</div>`;
  const wrap = (inner) => `<div class="istore agroups" data-action="inv-click" data-loc="${loc}" data-drop="${loc}"${tip(`Drop or click here to put the selected item in ${st.name}`)}>${inner}</div>`;
  return armoryView(entries, { ns: "store", cell, wrap, state, empty: "Empty. Drop items here." });
}

// People who can swap items with each other here, as tabs.
function whoTabs(state, ui, people, sid) {
  if (people.length < 2) return "";
  return `<div class="invwho">${people.map((p) => `<button class="mini ${p.id === sid ? "active" : ""}" data-action="inv-who" data-id="${p.id}"${tip(`Show ${p.name}'s inventory. Combat power ${combatPower(p).toFixed(1)}.`)}>${first(p)}</button>`).join("")}</div>`;
}

// Split / Open / Take out on a stack (itemstack.js): half of it into a spot of its own; a stack of boxes opened into
// loose rounds; a handful out of an ammo can, carton or bag.
function stackButtons(item, from) {
  if (from.o === "body") return "";
  const out = [];
  if (amountOf(item) > 1 && (countOf(item) > 1 || (isRoundItem(item) && !isBulk(item)))) out.push(`<button class="mini" data-action="inv-split"${tip(`Split the stack: half of it (${Math.ceil(amountOf(item) / 2)}) into a spot of its own beside it`)}>Split</button>`);
  if (isRoundItem(item) && !item.loose) out.push(`<button class="mini" data-action="inv-openbox"${tip(`Open the box${boxesIn(item) > 1 ? "es" : ""}: loose rounds (up to ${roundCap({ loose: true })} a slot; the rest stays boxed beside them). Box packs them back. Drop loose rounds on loose ones of the same load to stack them`)}>Open box</button>`);
  if (isRoundItem(item) && item.loose) out.push(`<button class="mini" data-action="inv-boxrounds"${tip(`Pack the loose rounds into boxes (up to ${roundCap({ key: item.key })} a slot, five boxes; the last may be part full): boxed rounds go in a pocket or a pack like loose ones. Drop them on boxes of the same load to fill those`)}>Box</button>`);
  if (isBulk(item) && Object.keys(bulkRecord(item)).length) out.push(`<button class="mini" data-action="inv-openbox"${tip(`Take a handful out (up to ${roundCap({ loose: true })} loose rounds) into a spot beside it`)}>Take out a handful</button>`);
  return out.join(" ");
}
// ⓘ Details: the selected item's whole description (the hover tip is short; Shift over it shows this too).
const detailsButton = (ui, item) => `<button class="mini${ui.invDetails === ui.invSel ? " active" : ""}" data-action="inv-details"${tip("The whole description of the selected item (or hold Shift while hovering it)")}>ⓘ Details</button> `;
const detailsBlock = (state, ui, item) => (ui.invDetails && ui.invDetails === ui.invSel ? `<div class="invdetails small muted">${esc(itemTip(item, ui.inv && ui.inv.sid != null ? survivorById(state, ui.inv.sid) : null))}</div>` : "");
export function selBar(state, ui, place) {
  if (!ui.invSel) return "";
  const item = itemAt(state, ui.invSel);
  if (!item) return "";
  const from = parseLoc(ui.invSel);
  const st = storageFor(state, place);
  return `<div class="invsel small">Selected: <b>${esc(rowName(item))}${rowCount(item) ? ` ${rowCount(item)}` : ""}</b>. Click a slot, pocket or pack cell to move it there${countOf(item) > 1 || isRoundItem(item) ? " (onto the same thing: the stacks merge)" : ""}.
    ${stackButtons(item, from)}
    ${st && from.o !== "armory" && from.o !== "cargo" ? `<button class="mini" data-action="inv-store"${tip(`Put it in ${st.name}`)}>${from.o === "body" ? "Take" : st.o === "armory" ? "Unequip to armory" : "Put in cargo"}</button>` : ""}
    ${GEAR[item.key] && GEAR[item.key].use && from.o !== "body" && ui.inv && !ui.inv.loot ? `<button class="mini" data-action="inv-use"${tip(`${survivorById(state, ui.inv.sid)?.name.split(" ")[0] || "They"} ${GEAR[item.key].useVerb || "use"} it now: ${useText(item.key)}. Used up.`)}>Use</button>` : ""}
    ${burnButtons(state, ui, item, from)}
    ${isGunCase(item) && from.o !== "body" ? `<button class="mini" data-action="inv-opencase"${tip(`Inside: ${caseText(item)}${item.locked ? " (locked: prised open with a blade or a crowbar)" : ""}. Opening it here is free: the gun goes into ${st ? st.name : "storage"}, the rounds into the stores.`)}>${item.locked ? "Prise open" : "Open"} case</button>` : ""}
    ${ui.inv && !ui.inv.loot && !ui.inv.raid && from.o !== "body" ? repairButtons(state, ui, item, from, place) : ""}
    ${detailsButton(ui, item)}<button class="mini" data-action="inv-cancel">Cancel</button>
    ${ui.inv && !ui.inv.loot && !ui.inv.raid && from.o !== "body" && !state.combat ? modBar(state, ui, item) + helmetBar(state, ui, item) : ""}${detailsBlock(state, ui, item)}</div>`;
}
// Gun parts (the gun builder, ui/gunbuilder.js): on a gun, Modify opens it; on a loose part, Modify for each gun on the
// person whose inventory is open that takes it (the builder opens on that gun at the part's slot).
function modBar(state, ui, item) {
  if (isGunKey(item.key)) {
    return `<div class="row small" style="flex-wrap:wrap;gap:0.25rem;margin-top:0.3rem"><button class="mini" data-action="gb-open" data-loc="${ui.invSel}"${tip(`The gun builder: the ${item.name} drawn large, a line to each slot (sight, muzzle, magazine and the rest), the parts within reach that fit each one with what they change, the ammo it is loaded with and how reliable it is.`)}>⚙ Modify</button>${item.mods ? `<span class="muted">${esc(modLabel(item))}</span>` : ""}</div>`;
  }
  const slot = slotOfPart(item.key);
  if (slot) {
    const s = survivorById(state, ui.inv.sid);
    if (!s) return "";
    const locs = [`s:${s.id}:weapon`, ...s.pockets.map((_, i) => `s:${s.id}:pocket:${i}`), ...(packOf(s) || []).map((_, i) => `s:${s.id}:pack:${i}`)];
    const guns = locs.map((l) => [l, itemAt(state, l)]).filter(([, g]) => g && g !== item && isGunKey(g.key) && !modFitReason(g, item));
    const btns = guns.map(([l, g]) => `<button class="mini" data-action="gb-open" data-loc="${l}" data-slot="${slot}"${tip(`Open the gun builder on ${s.name.split(" ")[0]}'s ${g.name} at its ${(PART_SLOT_NAMES[slot] || slot).toLowerCase()}: fit the ${item.name} there${g.mods && g.mods[slot] ? ` (the ${g.mods[slot].name} comes off)` : ""}.`)}>⚙ ${esc(g.name)}</button>`);
    return `<div class="row small" style="flex-wrap:wrap;gap:0.25rem;margin-top:0.3rem"><span class="muted">Gun part (${esc((PART_SLOT_NAMES[slot] || slot).toLowerCase())}); fits ${esc(fitsText(item.key))}.</span> ${btns.join(" ") || `<span class="muted">${esc(first(s))} has no gun it fits.</span>`}</div>`;
  }
  return "";
}
// A helmet's mounts (sim/helmets.js): a box per mount with what is on it (× takes it off) or the parts within reach
// that fit it; a loose helmet part: fit it to the helmet the person wears. No time; not in a fight.
function helmetBar(state, ui, item) {
  const box = (label, body) => `<span class="chip" style="display:inline-flex;gap:0.2rem;align-items:center"><span class="muted">${esc(label)}:</span> ${body}</span>`;
  if (isHelmet(item.key)) {
    const choices = helmetChoices(state, ui.invSel, ui.inv && ui.inv.sid);
    const slots = helmetSlots(item);
    const boxes = slots.map((m) => {
      const on = item.mods && item.mods[m];
      if (on) return box(HELM_MOUNTS[m], `${esc(on.name)} <button class="mini" data-action="inv-helmstrip" data-mount="${m}"${tip(`Take the ${on.name} off the ${item.name} (into storage, or carried)`)}>×</button>`);
      const fit = choices.filter((c) => HELMET_ATTACH[c.item.key].mount === m);
      return box(HELM_MOUNTS[m], fit.length ? fit.map((c) => `<button class="mini" data-action="inv-helmfit" data-part="${c.loc}"${tip(`Fit the ${c.item.name} to the ${item.name}`)}>${esc(c.item.name)}</button>`).join(" ") : `<span class="muted">empty</span>`);
    });
    return `<div class="row small" style="flex-wrap:wrap;gap:0.25rem;margin-top:0.3rem"><span class="muted">Helmet mounts:</span> ${boxes.join(" ") || `<span class="muted">none: a full shell (only earplugs in a pocket protect the ears)</span>`}</div>`;
  }
  if (isHelmetPart(item.key) && ui.inv) {
    const s = survivorById(state, ui.inv.sid);
    const h = s && s.gear && s.gear.head;
    if (!h || !isHelmet(h.key) || h === item) return "";
    const why = helmetFitReason(h, item);
    return `<div class="row small" style="flex-wrap:wrap;gap:0.25rem;margin-top:0.3rem"><button class="mini" data-action="inv-helmon" ${why ? "disabled" : ""}${tip(why || `Fit the ${item.name} to ${first(s)}'s ${h.name}`)}>Fit to ${esc(h.name)}</button></div>`;
  }
  return "";
}
// A gun in a storage list moves up when something before it is taken out: find it again.
function reselect(state, ui, item) {
  if (itemAt(state, ui.invSel) === item) return;
  const l = parseLoc(ui.invSel);
  const st = l.o === "armory" || l.o === "cargo" ? storageFor(state, `${l.o === "armory" ? "base" : "party"}:${l.id}`) : null;
  const i = st ? st.list.indexOf(item) : -1;
  ui.invSel = i >= 0 ? `${l.o}:${l.id}:list:${i}` : null;
}

// The selected item's firewood (sim/inventory.js breakDownAt): "Break down for firewood (+N)" (asks first for anything
// that is not junk: ui/confirm.js), and in an armory the water boiler's mark (may burn / keep).
// Repair (sim/repair.js) and Salvage (sim/inventory.js salvageAt) for the selected item: at a base the repair goes in
// its queue (the bench, the crafters), in the field it takes a field repair kit; the tooltip is the preview (the new
// maximum, what it takes, how long, who).
function repairButtons(state, ui, item, from, place) {
  const out = [];
  const base = place && place.startsWith("base:") ? baseById(state, Number(place.split(":")[1])) : null;
  if (repairKind(item)) {
    const info = base ? repairInfo(state, base, item) : fieldRepairInfo(state, ui.invSel);
    const queueable = base && (info.ok || (!info.who && /Craft role/.test(info.reason)));
    out.push(`<button class="mini" data-action="inv-repair" ${queueable || (!base && info.ok) ? "" : "disabled"}${tip(`${base ? "Repair at the bench" : "Field repair with a repair kit"}: ${repairPreview(info)}`)}>Repair${info.kind ? ` (max ${Math.round(info.oldMax)} → ${Math.round(info.newMax)})` : ""}</button>`);
    if (base) {
      const fk = fieldRepairInfo(state, ui.invSel);
      if (fk.ok) out.push(`<button class="mini" data-action="inv-fieldrepair"${tip(`Now, with a field repair kit: ${repairPreview(fk)}`)}>Repair with a kit</button>`);
    }
  }
  const sv = salvageInfo(state, ui.invSel);
  if (salvageYield(item)) out.push(`<button class="mini" data-action="inv-salvage" ${sv.ok ? "" : "disabled"}${tip(sv.ok ? `Take the ${item.name} apart for parts: ${salvageText(sv.got)}${item.mods ? " (its attachments come off into storage)" : ""}. It is gone. Asks first.` : sv.reason)}>Salvage (${esc(salvageText(sv.got))})</button>`);
  return out.join(" ");
}
// The base's repair queue (sim/repair.js): what is at the bench, how far along, why it waits; Cancel puts it back in the armory.
function repairsBox(state, base) {
  const q = base.gearRepairs || [];
  if (!q.length) return "";
  return `<div class="small" style="margin-top:0.3rem"><b${tip("Gear queued for repair: it stays in use, and people on the Craft role with the skill mend it while it is at the base (urgent ones first, before the craft queue).")}>Repairs</b> ${q.map((j) => {
    const why = repairJobStatus(state, base, j);
    return `<span class="chip"${tip(why || `${Math.floor(j.progress)} of ${j.hours} work-hours done`)}>${esc(j.item.name)} ${why ? `<span class="muted">(${esc(why)})</span>` : `${Math.round((j.progress / j.hours) * 100)}%`} <button class="mini" data-action="inv-cancelrepair" data-base="${base.id}" data-id="${j.id}"${tip("Cancel the repair (what was paid comes back, half once started)")}>×</button></span>`;
  }).join(" ")}</div>`;
}
function burnButtons(state, ui, item, from) {
  const bd = breakDownInfo(state, ui.invSel);
  if (!(bd.wood > 0) || from.o === "body") return "";
  const junk = isJunk(item);
  const btn = `<button class="mini" data-action="inv-breakdown" ${bd.ok ? "" : "disabled"}${tip(bd.ok ? `Break the ${item.name} down for firewood: +${bd.wood} firewood, by its weight (${kg(bd.wood * SUPPLIES.wood.weight)} kg of its ${kg(GEAR[item.key].weight || 0)} kg burns; ${bd.place.startsWith("base") ? "into the base's stores" : "into the team's cargo: the camp fire burns it"}). The ${item.name} is gone. No time: it is kindling.${junk ? "" : " It is worth more than junk: asks first."}` : bd.reason)}>Break down for firewood (+${bd.wood})</button>`;
  if (from.o !== "armory") return btn;
  const b = baseById(state, from.id);
  const mark = item.fire === "burn" ? "burn" : item.fire === "keep" ? "keep" : "";
  const now = mark === "burn" ? "marked: the boiler may burn it" : mark === "keep" ? "marked: kept from the fire" : junk ? (boilerJunkOn(b) ? "junk: the boiler may burn it" : "junk (the base keeps junk from the boiler)") : "not burned unless marked";
  const next = mark === "" ? (junk ? "keep" : "burn") : mark === "burn" ? "keep" : "";
  const label = next === "burn" ? "Boiler may burn it" : next === "keep" ? "Keep from the fire" : "Clear the mark";
  return `${btn} <button class="mini" data-action="inv-firemark" data-mark="${next}"${tip(`The water boiler burns firewood first, then what the base allows from the armory (cheap junk while "Boiler may burn spare wooden items and paper" is on, and anything marked to burn), then fuel. Now: ${now}.`)}>${label}</button>`;
}

// People who can trade items at a place, the place's name.
function placePeople(state, place) {
  if (!place) return [];
  const [kind, id] = place.split(":");
  if (kind === "base") return atBase(state, Number(id));
  const p = state.parties.find((x) => x.id === Number(id));
  return p ? partyMembers(state, p) : [];
}
function placeName(state, place) {
  if (!place) return "";
  const [kind, id] = place.split(":");
  if (kind === "base") { const b = baseById(state, Number(id)); return b ? `at ${b.name}` : ""; }
  return "with the team";
}

// ---------- the screens ----------
export function inventoryModal(state, ui) {
  if (!ui.inv) return null;
  if (ui.inv.loot) return lootModal(state, ui);
  if (ui.inv.raid) return raidModal(state, ui);
  if (ui.inv.peek) return peekModal(state, ui);
  const s = survivorById(state, ui.inv.sid);
  if (!s) { ui.inv = null; return null; }
  const place = personPlace(s);
  const people = placePeople(state, place);
  const readonly = !place;
  const body = doll(state, ui, s, `s:${s.id}`, figureSpinImg(state, s, 7), { readonly, user: s });
  return `<div class="box wide invbox">
    <div class="spread"><h1>Inventory: ${esc(s.name)}</h1><span class="muted">${esc(placeName(state, place))}</span></div>
    ${ui.invMsg ? `<div class="result small">${esc(ui.invMsg)}</div>` : ""}
    ${readonly ? `<div class="small warn">${esc(s.name.split(" ")[0])} is out of reach: nothing can be changed.</div>` : ""}
    <div class="invcols">
      <div class="invcol">${whoTabs(state, ui, people, s.id)}${body}${readonly ? "" : holdSection(state, ui, s)}</div>
      <div class="invcol">${readonly ? "" : storageBox(state, ui, place, s)}</div>
    </div>
    ${selBar(state, ui, place)}${stackPanel(state, ui, "inv")}
    <div class="small muted" style="margin-top:0.5rem">Click an item, then click where it should go (or drag it). Click a selected item again to send it across: onto ${esc(s.name.split(" ")[0])}, or into storage. A full slot swaps. Drag the figure (or roll the wheel over it) to turn it by hand; ↻ Spin lets it turn by itself again. Right-click an item for what can be done with it (equip, reload, unload, modify, repair, eat, drink, use...).</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary" data-action="inv-close">Close</button></div>
  </div>`;
}

// A survivor's kit seen from the battle (ui/combat.js 🎒, Shift+B): the paper doll as it stands now. The tabs: everyone
// of yours in the fight. For the one whose turn it is, with an action left, it is their inventory to sort (2026-10-17
// user request): a click-then-click or a drag between a pocket, the pack, a rig pouch, the hands and the off hand
// goes through combatAct "inv" (sim/combat.js invAct) for INV_AP, as do Split, Open box and Box on a stack; the AP pips
// on the bar follow. Armour, the helmet, the rig and the pack stay as worn. Otherwise (not their turn, no action left,
// down) it is read-only, greyed with the reason. ui.inv = { sid, peek: true }.
// { u, ok, why }: can this survivor's unit sort its kit now?
export function peekCan(state, sid) {
  const b = state.combat;
  const u = b && !b.over ? b.units.find((x) => x.sid === sid && x.side === "player") : null;
  if (!u) return { u: null, ok: false, why: "They are not in the fight." };
  if (b.phase !== "player") return { u, ok: false, why: "Wait for the enemy turn to finish: nothing moves until then." };
  if (u.dead || u.down || u.left || u.fled || u.off || u.away) return { u, ok: false, why: `${u.name.split(" ")[0]} cannot sort their kit now.` };
  if (!(u.ap >= INV_AP)) return { u, ok: false, why: `No action left: ${u.name.split(" ")[0]}'s kit stays as it is until next turn.` };
  return { u, ok: true, why: "" };
}
// The hand-over window (ui.inv.mate: the teammate's survivor id): { u, t, ok, why }, can the acting unit (sid) trade
// with the mate now (sim/combat.js handoverRefusal: right next to them, in their view cone, up)?
export function handCan(state, sid, mateSid) {
  const c = peekCan(state, sid);
  if (!c.ok) return { ...c, t: null };
  const b = state.combat;
  const t = b.units.find((x) => x.sid === mateSid && x.side === "player") || null;
  const why = t ? handoverRefusal(b, c.u, t) : "They are not in the fight.";
  return { u: c.u, t, ok: !why, why };
}
// A move (or op: "split" | "open" | "box" on `from`) in the fight's inventory window, through the sim (1 action).
// In the hand-over window a move between the two survivors goes through combatAct "handover" (HANDOVER_AP, the acting
// unit's); within the acting unit's own kit through "inv" as before; the mate's own kit does not move.
function fightMove(state, ui, from, to, op = "move") {
  const c = peekCan(state, ui.inv.sid);
  if (!c.ok) { ui.invMsg = c.why; ui.invSel = null; return; }
  const b = state.combat;
  const n = b.log.length;
  const F = parseLoc(from), T = to ? parseLoc(to) : null;
  const mine = (L) => L.o === "s" && L.id === ui.inv.sid;
  let err, cost = INV_AP;
  const ap0 = c.u.ap;
  if (ui.inv.mate != null && (!mine(F) || (T && !mine(T)))) {
    const h = handCan(state, ui.inv.sid, ui.inv.mate);
    if (!h.ok) { ui.invMsg = h.why; ui.invSel = null; return; }
    const m = survivorById(state, ui.inv.mate);
    if (!T || (!mine(F) && !mine(T))) { ui.invMsg = `${m ? m.name.split(" ")[0] : "Their"}'s own kit stays as it is: only what changes hands between them moves (${HANDOVER_AP} action).`; ui.invSel = null; return; }
    cost = HANDOVER_AP;
    err = combatAct(state, { type: "handover", unit: c.u.id, to: h.t.id, from, toLoc: to });
  } else err = combatAct(state, { type: "inv", unit: c.u.id, from, to, op });
  const said = !err && b.log.length > n ? b.log[b.log.length - 1].text : "";
  if (!err && ap0 - c.u.ap > 0) cost = ap0 - c.u.ap; // (loose rounds onto a magazine from the pack: both)
  ui.invMsg = err || `${said || "Done."} (${cost} action${cost === 1 ? "" : "s"}; ${c.u.ap} left)`;
  ui.invSel = null;
}
// The selected item's line in the fight's window: Split / Open box / Box (1 action each), Cancel. mate: the hand-over
// window's other survivor (the stack buttons only on the acting unit's own things).
function peekBar(state, ui, ok, mate = null) {
  if (!ui.invSel) return "";
  const item = itemAt(state, ui.invSel);
  if (!item) return "";
  const from = parseLoc(ui.invSel);
  const own = from.o === "s" && from.id === ui.inv.sid;
  const who = mate ? (own ? `${esc(mate.name.split(" ")[0])}'s` : "their own") : "";
  return `<div class="invsel small">Selected: <b>${esc(rowName(item))}${rowCount(item) ? ` ${rowCount(item)}` : ""}</b>${mate && !own ? ` (${esc(mate.name.split(" ")[0])}'s)` : ""}. ${ok ? `Click ${mate ? `${who} ` : "a "}pocket, pack cell, rig pouch, the hands or the off hand to move it there (${mate ? HANDOVER_AP : INV_AP} action${mate ? `, ${esc(survivorById(state, ui.inv.sid).name.split(" ")[0])}'s` : ""})${countOf(item) > 1 || isRoundItem(item) ? "; onto the same thing: the stacks merge" : ""}${isRoundItem(item) && item.loose ? "; onto a spare magazine of the gun: it is loaded with them (1 action from a pocket or the rig, both from the pack)" : ""}.` : ""}
    ${ok && own ? stackButtons(item, from) : ""}
    ${detailsButton(ui, item)}<button class="mini" data-action="inv-cancel">Cancel</button>${detailsBlock(state, ui, item)}</div>`;
}
// The hand-over window (ui/combat.js Hand over, Alt+H; sim/combat.js handoverTargets, combatAct "handover"): the acting
// unit's paper doll and the mate's side by side. A thing clicked (or dragged) from one to the other costs the acting
// unit HANDOVER_AP a move, either way; the mate spends nothing. Tabs on the right: the other mates in reach.
// ui.inv = { sid, peek: true, mate }.
function handModal(state, ui) {
  const b = state.combat;
  const s = survivorById(state, ui.inv.sid), m = survivorById(state, ui.inv.mate);
  if (!b || b.over || !s || !m) { ui.inv = null; return null; }
  const h = handCan(state, s.id, m.id);
  const u = h.u;
  const mates = u ? handoverTargets(b, u).map((t) => survivorById(state, t.sid)).filter(Boolean) : [];
  const tabs = mates.length > 1 ? `<div class="invwho">${mates.map((p) => `<button class="mini ${p.id === m.id ? "active" : ""}" data-action="inv-mate" data-id="${p.id}"${tip(`Trade with ${p.name} instead (right next to ${esc(s.name.split(" ")[0])}, in their view cone).`)}>${first(p)}</button>`).join("")}</div>` : "";
  const head = h.ok
    ? `<div class="small"${tip(`A thing given to ${m.name} or taken from them: click it, then the pocket, pack cell, rig pouch, the hands or the off hand it goes to (or drag it), ${HANDOVER_AP} action a move for ${s.name.split(" ")[0]} either way; ${m.name.split(" ")[0]} spends nothing. A full slot swaps when the thing there fits back. Both count what moved at once: a gun in the hands, rounds, a magazine. Armour, the helmet, the rig and the pack stay as worn on both. ${s.name.split(" ")[0]}'s own kit moves here too (1 action, as in the Inventory window); ${m.name.split(" ")[0]}'s own kit does not.`)}>${esc(s.name.split(" ")[0])}'s turn, <b>${u.ap} action${u.ap === 1 ? "" : "s"}</b> left: each thing handed to ${esc(m.name.split(" ")[0])} or taken from them costs ${esc(s.name.split(" ")[0])} ${HANDOVER_AP} action; ${esc(m.name.split(" ")[0])} spends nothing. Drag a figure to turn it.</div>`
    : `<div class="small warn">${esc(h.why)} Look only. Drag a figure to turn it.</div>`;
  const label = (p, what) => `<div class="invlabel"${tip(what)}>${esc(p.name)}</div>`;
  return `<div class="box wide invbox">
    <div class="spread"><h1>Hand over: ${esc(s.name)} and ${esc(m.name)}</h1><span class="muted">${esc(b.place)}</span></div>
    ${head}
    ${ui.invMsg ? `<div class="result small">${esc(ui.invMsg)}</div>` : ""}
    <div class="invcols">
      <div class="invcol">${label(s, `${s.name}: the one acting (their actions pay for every move here).`)}${doll(state, ui, s, `s:${s.id}`, figureSpinImg(state, s, 7), { readonly: !h.ok, user: s })}</div>
      <div class="invcol">${tabs}${label(m, `${m.name}: right next to ${s.name.split(" ")[0]}, in their view cone. Things go to and from their pockets, pack, rig pouches and hands; their own kit stays as it is.`)}${doll(state, ui, m, `s:${m.id}`, figureSpinImg(state, m, 7), { readonly: !h.ok, user: m })}</div>
    </div>
    ${peekBar(state, ui, h.ok, m)}
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="mini" data-action="inv-mate" data-id=""${tip(`${esc(s.name.split(" ")[0])}'s own kit alone (the Inventory window)`)}>Own kit</button><button class="primary" data-action="inv-close"${tip("Back to the battle (Esc)")}>Close</button></div>
  </div>`;
}
function peekModal(state, ui) {
  if (ui.inv.mate != null) return handModal(state, ui);
  const b = state.combat;
  const s = survivorById(state, ui.inv.sid);
  if (!b || b.over || !s) { ui.inv = null; return null; }
  const people = b.units.filter((u) => u.side === "player" && u.sid != null && u.vol == null).map((u) => survivorById(state, u.sid)).filter(Boolean);
  const c = peekCan(state, s.id);
  const u = c.u;
  const where = u ? (u.dead ? "dead" : u.left ? "got away" : u.down ? "down" : `${Math.round(u.hp)} hp`) : "";
  const head = c.ok
    ? `<div class="small"${tip("Pockets, the pack's slots, the rig's pouches, the hands and the off hand: click an item, then where it goes (or drag it), 1 action a move. Split, Open box and Box on a stack of rounds cost the same. Loose rounds dropped onto a spare magazine of the gun load it: 1 action with the rounds in a pocket or the rig, both actions from the pack (a box: open it first). Armour, the helmet, the rig and the pack stay as worn (a plate: the Plate order). What moved counts at once: a gun in the hands, a magazine in a pocket (a 1-action reload), boxes of rounds.")}>${esc(s.name.split(" ")[0])}'s turn, <b>${u.ap} action${u.ap === 1 ? "" : "s"}</b> left: each move here costs ${INV_AP}. Drag the figure to turn it.</div>`
    : `<div class="small warn">${esc(c.why)} Look only. Drag the figure to turn it.</div>`;
  return `<div class="box wide invbox">
    <div class="spread"><h1>Inventory: ${esc(s.name)}</h1><span class="muted">${esc(b.place)}${where ? ` · ${esc(where)}` : ""}</span></div>
    ${head}
    ${ui.invMsg ? `<div class="result small">${esc(ui.invMsg)}</div>` : ""}
    <div class="invcols"><div class="invcol">${whoTabs(state, ui, people, s.id)}${doll(state, ui, s, `s:${s.id}`, figureSpinImg(state, s, 7), { readonly: !c.ok, user: s })}</div></div>
    ${peekBar(state, ui, c.ok)}
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary" data-action="inv-close"${tip("Back to the battle (Esc)")}>Close</button></div>
  </div>`;
}

function bodyPortrait(state, b, body) {
  if (body.sid != null) {
    const s = survivorById(state, body.sid);
    return s ? figureSpinImg(state, s, 7) : "";
  }
  const u = b.units.find((x) => x.id === body.uid);
  return u ? spriteImg(canvasURL(unitCanvas(state, b, u, cui.salt)), 7, "transform:rotate(-8deg)") : "";
}

// A pile (sim/ground.js groundLeftovers): what lay on the ground, or was left on a body searched in the battle.
function pileGrid(state, ui, body, bi, s) {
  const cells = (body.loose || []).map((it, i) => (it ? slotBox(state, ui, `body:${bi}:loose:${i}`, "", s, false) : "")).join("");
  return `<div class="invlabel"${tip(body.uid == null ? "Things that lay on the ground when the fight ended." : "What was left on this body when it was searched in the fight.")}>${body.uid == null ? "On the ground" : "Left on the body"}</div><div class="invgrid">${cells || `<span class="small muted">Nothing.</span>`}</div>`;
}

function lootModal(state, ui) {
  const b = state.combat;
  if (!b || !b.over || !b.bodies) { ui.inv = null; return null; }
  const place = battlePlace(b);
  const bodies = battleBodies(state);
  const people = placePeople(state, place);
  if (ui.inv.body == null || !bodies[ui.inv.body]) ui.inv.body = bodies.findIndex((x) => !bodyEmpty(state, x));
  let s = survivorById(state, ui.inv.sid);
  if (!s || !people.includes(s)) { s = people[0] || null; ui.inv.sid = s ? s.id : null; }
  const bi = ui.inv.body;
  const body = bodies[bi];
  const list = bodies.map((x, i) => {
    const h = bodyHolder(state, x);
    const n = (h ? allItems(h).length : 0) + Object.values(x.supplies).filter((v) => v > 0).length;
    return `<button class="ibody ${i === bi ? "active" : ""}" data-action="loot-body" data-i="${i}"${tip(n ? `${n} thing${n === 1 ? "" : "s"} to take` : "Nothing left")}><span>${esc(x.name)}${x.sid != null ? " (yours)" : ""}</span><span class="small ${n ? "" : "muted"}">${n || "empty"}</span></button>`;
  }).join("");
  let bodyHtml = `<div class="small muted">No bodies to search.</div>`;
  if (body) {
    const h = bodyHolder(state, body);
    const sups = Object.entries(body.supplies).filter(([, v]) => v > 0);
    bodyHtml = `<div class="spread"><b>${esc(body.name)}</b><button class="mini" data-action="loot-takebody" data-i="${bi}"${tip("Take everything from this body that fits: supplies first, then items, most valuable first. Items go to the team's cargo (or the base armory).")}>Take all</button></div>
      ${body.sid != null ? `<div class="small muted">Your fallen. Whatever you leave stays at their death site.</div>` : ""}
      ${body.pile ? pileGrid(state, ui, body, bi, s) : h ? doll(state, ui, h, `body:${bi}`, bodyPortrait(state, b, body), { user: s }) : ""}
      <div class="invlabel"${tip("Supplies go straight to the team's found cargo (or the base stock). Click a stack to choose how many (the panel at the bottom), or drag it to the cargo.")}>Supplies</div>
      <div class="istore supgrid">${sups.length ? sups.map(([k, v]) => supTile(ui, `body:${bi}:sup:${k}`, k, v, " It goes to the team's found cargo (or the base's stores).")).join("") : `<span class="small muted">None</span>`}</div>`;
  }
  const you = s ? doll(state, ui, s, `s:${s.id}`, figureSpinImg(state, s, 7), { user: s }) : `<div class="small muted">Nobody left standing to carry anything.</div>`;
  const r = b.result;
  const got = [...Object.entries(r.loot.supplies).filter(([, n]) => n >= 1).map(([k, n]) => `${Math.floor(n)} ${keyWord(k)}`), ...r.loot.gear.map((g) => g.name)];
  return `<div class="box wide invbox loot">
    <div class="spread"><h1>Loot the bodies</h1><span class="muted">${esc(b.place)} · ${esc(placeName(state, place))}</span></div>
    ${ui.invMsg ? `<div class="result small">${esc(ui.invMsg)}</div>` : ""}
    <div class="invcols three">
      <div class="invcol"><div class="ibodies">${list}</div>${bodyHtml}</div>
      <div class="invcol">${whoTabs(state, ui, people, s ? s.id : null)}${you}</div>
      <div class="invcol">${storageBox(state, ui, place, s)}<div class="small muted" style="margin-top:0.5rem">Taken so far: ${got.length ? esc(got.join(", ")) : "nothing"}</div></div>
    </div>
    ${selBar(state, ui, place)}${stackPanel(state, ui, "loot")}
    <div class="small muted" style="margin-top:0.5rem">Click an item on a body, then a slot on your survivor or the cargo box (or drag it). Click it twice to take it straight away. Everything taken adds its weight to the team, on a person or in the cargo. Whatever you leave stays where they fell: a death site that scavengers strip over the next days.</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end">
      <button data-action="loot-takeall"${tip("Take everything that fits from every body")}>Take everything</button>
      <button class="primary" data-action="loot-done"${tip("Back to the battle result")}>Done</button></div>
  </div>`;
}

// ---------- the search window (a raid: sim/raidloot.js) ----------
// ui.inv = { raid: true, uid (the searching unit), box (container id, or null for the vehicle alone) }.
// The survivor on the left (their slots and what they carry loose), the container and, at the vehicle, its trunk.
// Opened from the battle (ui/combat.js sets cui.lootReq; takeLootReq turns it into ui.inv).
export function takeLootReq(state, ui) {
  if (cui.invReq != null) { // 🎒 a survivor's kit, asked for from the battle panel (ui/combat.js cb-inv): read-only
    const sid = cui.invReq;
    cui.invReq = null;
    if (state.combat && !state.combat.over && !(ui.inv && (ui.inv.loot || ui.inv.raid)) && survivorById(state, sid)) { ui.inv = { sid, peek: true }; ui.invSel = null; ui.invMsg = ""; }
  }
  if (cui.handReq) { // 🤲 Hand over (ui/combat.js): the acting survivor's kit and the mate's side by side (handModal)
    const { sid, mate } = cui.handReq;
    cui.handReq = null;
    if (state.combat && !state.combat.over && !(ui.inv && (ui.inv.loot || ui.inv.raid)) && survivorById(state, sid) && survivorById(state, mate)) { ui.inv = { sid, peek: true, mate }; ui.invSel = null; ui.invMsg = ""; }
  }
  if (!cui.lootReq) return;
  const r = cui.lootReq;
  cui.lootReq = null;
  if (!state.combat || state.combat.over) return;
  fieldReady(state.combat, state); // sim/ground.js: a field battle's loot layer (bodies, the ground)
  if (!lootLayer(state.combat)) return;
  ui.inv = { raid: true, uid: r.uid, box: r.box };
  ui.invSel = null;
  ui.invMsg = "";
}

const kg = (x) => `${Math.round(x * 10) / 10}`;
// A supply stack as a tile (the search window, the bodies, the stores). movable: click it for the stack mover
// (ui/stackmove.js), drag it to drop it somewhere (a popover asks how many).
// The count on the right of a supply tile: "×27", or the two parts of a split stack ("12 + 15").
const supCount = (ui, loc, n) => { const sc = splitCount(invSplits(ui), loc, n); return sc === `${Math.floor(n)}` ? supplyCount(n) : sc; };
function supTile(ui, loc, k, n, extra = "", movable = true) {
  const sup = SUPPLIES[k];
  if (!sup) return "";
  const how = movable ? " Click it to choose how many (1 to all) and where (the mouse wheel over it: one more or fewer, Shift: ten); Shift+click: all that fit, straight across. Drag it where it goes and say how many (Shift when you drop: half, Ctrl: one)." : "";
  const ns = ui.inv && ui.inv.raid ? "raid" : loc.startsWith("body:") ? "loot" : "inv"; // its stack mover screen (the wheel)
  return `<div class="islot store stack${ui.invSel === loc ? " sel" : ""}${movable ? "" : " still"}"${movable ? ` data-action="inv-click" data-loc="${loc}" data-stack="${loc}" data-smns="${ns}"` : ""}${tip(`${Math.floor(n)} ${sup.name.toLowerCase()}, ${kg(sup.weight * n)} kg (${sup.weight} kg each).${how}${extra}`)}>
    <div class="itile"${movable ? ` draggable="true" data-drag="${loc}"` : ""}><span class="iico">${supplyIcon(k)}</span><span class="iname">${esc(supplyName(k))}</span><span class="icount">${supCount(ui, loc, n)}</span><span class="ikg">${kg(sup.weight * n)}</span></div></div>`;
}
function gearTiles(ui, list, prefix, user) {
  return list.map((it, i) => {
    const l = `${prefix}:gear:${i}`;
    return `<div class="islot store${ui.invSel === l ? " sel" : ""}" data-action="inv-click" data-loc="${l}">${tile(it, l, user)}</div>`;
  }).join("");
}
const loadBar = (load, cap) => `<div class="bar"><i style="width:${Math.min(100, (load / Math.max(1, cap)) * 100)}%;background:${load > cap * 0.9 ? "var(--danger)" : "var(--info)"}"></i></div>`;

function raidModal(state, ui) {
  const b = state.combat;
  const R = lootLayer(b);
  if (!b || !R || b.over) { ui.inv = null; return null; }
  const u = b.units.find((x) => x.id === ui.inv.uid && x.side === "player" && !x.dead && !x.left);
  const s = u && survivorById(state, u.sid);
  if (!u || !s) { ui.inv = null; return null; }
  const box = ui.inv.box != null ? R.containers.find((c) => c.id === ui.inv.box && c.contents) : null;
  // The ground under the survivor (sim/ground.js): put things down there (free), pick them up again (hauling).
  const ground = groundPile(b, u.x, u.y, u.f || 0);
  ui.inv.ground = ground.id;
  const p = raidParty(state, b);
  const trunk = p && atVehicle(b, u) ? trunkInfo(state, b) : null;
  const first = esc(s.name.split(" ")[0]);
  // The survivor: their slots, then what they carry loose; how much more they can haul this turn.
  const me = personalLoad(state, u);
  const hsup = Object.entries(u.haul ? u.haul.sup : {}).filter(([, v]) => v >= 1);
  const done = hauled(b, u), budget = haulBudget(b, u);
  const freeLeft = Math.max(0, HAUL.free - done);
  const timeLine = `<div class="small ${budget < 1 ? "warn" : "muted"}"${tip(`Hauling takes time. Each turn the first ${HAUL.free} kg ${first} takes out of a container or the vehicle (or loads into the vehicle) are free; then every ${HAUL.per} kg costs one of their actions. One heavy thing can always be lifted with the actions they have left. Putting things back and handing them to a teammate is free.`)}>Haul this turn: <b>${kg(budget)} kg</b> left${freeLeft ? ` (${kg(freeLeft)} of it free)` : ""}${u.ap > 0 ? ` · ${u.ap} action${u.ap === 1 ? "" : "s"} left, ${HAUL.per} kg each` : budget < 0.5 ? ": end the turn to haul more" : ""}</div>`;
  const left = `<div class="invcol">${personCol(state, ui, b, u, s, true)}${timeLine}</div>`;
  // Teammates right next to them: hand things over (sim/raidloot.js matesOf).
  const mates = matesOf(b, u);
  let mateCol = "";
  if (mates.length) {
    if (!mates.some((x) => x.id === ui.inv.mate)) ui.inv.mate = mates[0].id;
    const m = mates.find((x) => x.id === ui.inv.mate);
    const ms = survivorById(state, m.sid);
    const tabs = `<div class="invwho">${mates.map((x) => `<button class="mini ${x.id === m.id ? "active" : ""}" data-action="rl-mate" data-id="${x.id}"${tip(`${x.name}${x.down ? " (down)" : ""}: right next to ${first}, so things can be handed over (free).`)}>${esc(x.name.split(" ")[0])}${x.down ? " ✚" : ""}</button>`).join("")}</div>`;
    mateCol = ms ? `<div class="invcol"><div class="invlabel"${tip("Teammates right next to the searcher. Drag things between them: handing over takes no time, but each one's max load still holds. A downed teammate can be relieved of what they carry.")}>Hand over${m.down ? ` <span class="warn">(${esc(m.name.split(" ")[0])} is down)</span>` : ""}</div>${tabs}${personCol(state, ui, b, m, ms, false)}</div>` : "";
  }
  // The container.
  let mid = "";
  if (box) {
    const bl = `rbox:${box.id}`;
    const sups = Object.entries(box.contents.sup).filter(([, v]) => v >= 1);
    const n = box.contents.gear.length + sups.length;
    const w = sups.reduce((a, [k, v]) => a + supWeight(k) * v, 0) + box.contents.gear.reduce((a, g) => a + itemLoad(g), 0);
    mid = `<div><div class="spread"><b${tip(box.kind === "ground" ? "Things on the ground here. Taking them is hauling (the first kg a turn free); putting things down is free." : box.drop ? "What a fallen teammate carried. Take it home for them." : "")}>${esc(box.label)}</b><span class="small muted">${n} thing${n === 1 ? "" : "s"} · ${kg(w)} kg</span></div>
      <div class="istore" data-action="inv-click" data-loc="${bl}:list" data-drop="${bl}:list"${tip("Drop here to leave it in the container")}>${sups.map(([k, v]) => supTile(ui, `${bl}:sup:${k}`, k, v)).join("")}${gearTiles(ui, box.contents.gear, bl, s) || (sups.length ? "" : `<span class="small muted">Empty.</span>`)}</div>
      ${box.quick ? `<div class="small warn" style="margin-top:0.3rem"${tip(`Rummaged through in a hurry (Quick search): only part of what is inside turned up. A full search turns up the rest, if there is more: ${SEARCH.ap} action, quiet.`)}>Rummaged in a hurry: a full search may turn up more.</div>` : ""}
      <div class="row" style="margin-top:0.4rem"><button class="mini" data-action="rl-takeall"${tip(`Everything that fits on ${first}: supplies carried, small things in pockets, the rest in the pack or carried.`)} ${n ? "" : "disabled"}>Take all</button>${box.quick ? `<button class="mini" data-action="rl-full"${tip(`${first} goes through it properly: ${SEARCH.ap} action, quiet. Whatever the rummage missed turns up here.`)} ${u.ap >= SEARCH.ap && !b.over && b.phase === "player" ? "" : "disabled"}>Search it in full (${SEARCH.ap} action)</button>` : ""}</div></div>`;
  }
  // The ground under them (unless that is what is open).
  let gnd = "";
  if (ground !== box) {
    const gl = `rbox:${ground.id}`;
    const sups = Object.entries(ground.contents.sup).filter(([, v]) => v >= 1);
    const n = pileCount(ground);
    gnd = `<div${mid ? ' style="margin-top:0.9rem"' : ""}><div class="spread"><b${tip(`Drop things here to put them on the ground where ${first} stands (free). They stay there for anyone to pick up (Ground, ${"Shift+X"}); after a won fight they are part of the loot.`)}>On the ground here</b><span class="small muted">${n} thing${n === 1 ? "" : "s"}</span></div>
      <div class="istore" data-action="inv-click" data-loc="${gl}:list" data-drop="${gl}:list"${tip("Drop here to put it on the ground")}>${sups.map(([k, v]) => supTile(ui, `${gl}:sup:${k}`, k, v)).join("")}${gearTiles(ui, ground.contents.gear, gl, s) || (sups.length ? "" : `<span class="small muted">Nothing. Drag things here to put them down.</span>`)}</div>
      ${n ? `<div class="row" style="margin-top:0.4rem"><button class="mini" data-action="rl-takeall" data-box="${ground.id}"${tip(`Pick up everything that fits on ${first} (hauling time).`)}>Pick up all</button></div>` : ""}</div>`;
  }
  // The vehicle.
  let right = "";
  if (trunk) {
    const tl = `trunk:${p.id}`;
    const keys = [...new Set([...Object.keys(p.cargo.supplies), ...Object.keys(p.supplies)])].filter((k) => SUPPLIES[k]);
    const sups = keys.map((k) => [k, Math.floor(Math.max(0, p.cargo.supplies[k] || 0)) + Math.floor(Math.max(0, p.supplies[k] || 0))]).filter(([, v]) => v >= 1);
    right = `<div${mid || gnd ? ' style="margin-top:0.9rem"' : ""}><div class="spread"><b${tip(trunk.bike ? "The bikes' racks: 15 kg each. What does not fit on them is shared out among the people." : "The team's supplies and cargo ride in the car. It also has to take home everything your people carry, so their loads count against what it has left.")}>${esc(trunk.name)}</b><span class="small ${trunk.space < 2 ? "warn" : "muted"}">${kg(trunk.cap - Math.max(0, trunk.space))}/${kg(trunk.cap)} kg · ${kg(Math.max(0, trunk.space))} free</span></div>
      ${loadBar(trunk.cap - Math.max(0, trunk.space), trunk.cap)}
      <div class="istore" data-action="inv-click" data-loc="${tl}:list" data-drop="${tl}:list"${tip("Drop here to put it in the vehicle")}>${sups.map(([k, v]) => supTile(ui, `${tl}:sup:${k}`, k, v, " From the vehicle: the team's packed supplies and what it found.")).join("")}${gearTiles(ui, p.cargo.gear, tl, s) || (sups.length ? "" : `<span class="small muted">Empty.</span>`)}</div>
      <div class="row" style="margin-top:0.4rem"><button class="mini" data-action="rl-stash"${tip(`Everything ${first} carries loose goes in the vehicle (what fits). What is worn, held, in pockets and the pack stays on them.`)} ${hsup.length || (u.haul && u.haul.gear.length) ? "" : "disabled"}>Unload what ${first} carries</button></div></div>`;
  } else if (p && R.vehicleZone >= 0) {
    right = `<div${mid ? ' style="margin-top:0.9rem"' : ""}><b>Vehicle</b><div class="small muted" style="margin-top:0.3rem">Parked in the entry zone. Walk ${first} there (or next to it) and press N to load it.</div></div>`;
  }
  const around = mid || gnd || right ? `<div class="invcol">${mid}${gnd}${right}</div>` : "";
  const cols = [left, mateCol, around].filter(Boolean);
  const found = [...Object.entries(R.found).filter(([, n]) => n >= 1).map(([k, n]) => `${Math.floor(n)} ${keyWord(k)}`), ...R.foundGear.map((g) => g.name)];
  const SL = ui.invSel ? parseRaidLoc(ui.invSel) : null;
  const sel = SL ? (SL.slot === "sup" ? SUPPLIES[SL.i]?.name : SL.o === "s" ? itemAt(state, ui.invSel)?.name : raidItemAt(state, b, ui.invSel)?.name) || "" : "";
  // sim/carry.js: a bag, a rig or a case off the ground, a body or a container straight into the arms (hands full).
  const selItem = SL && SL.slot !== "sup" && SL.o !== "s" ? raidItemAt(state, b, ui.invSel) : null;
  const armsWhy = selItem && isCarryable(selItem) ? bagRefusal(state, b, u, selItem) : null;
  const armsBtn = armsWhy == null ? "" : ` <button class="mini" data-action="rl-carry"${tip(armsWhy || `${first} carries the ${selItem.name} in their arms, whole, with what is in it (${Math.round(itemLoad(selItem) * 10) / 10} kg; hauling time). Hands full: no shooting, blows with a weapon, reloading, throwing or treating until it is set down (Drop carried: free).`)} ${armsWhy ? "disabled" : ""}>Carry in arms</button>`;
  if (SL && SL.slot === "sup" && (!ui.stack || ui.stack.ns !== "raid")) openStack(ui, "raid"); // a stack picked another way: the mover opens on it
  const selLine = (what) => `<div class="invsel small">Selected: <b>${esc(what)}</b>. Nowhere to move it from here. <button class="mini" data-action="inv-cancel">Cancel</button></div>`;
  return `<div class="box wide invbox${cols.length > 2 ? " loot" : ""}">
    <div class="spread"><h1>${box ? (box.kind === "ground" ? "On the ground" : "Search") : trunk ? "Vehicle" : "On the ground"}: ${esc(s.name)}</h1><span class="muted">${esc(b.place)}</span></div>
    <div class="result small"${ui.invMsg ? "" : ' style="visibility:hidden"'}>${ui.invMsg ? esc(ui.invMsg) : "&nbsp;"}</div>
    <div class="invcols${cols.length > 2 ? " three" : ""}">${cols.join("")}</div>
    ${SL && SL.slot === "sup" ? stackPanel(state, ui, "raid") || selLine(sel) : sel ? `<div class="invsel small">Selected: <b>${esc(sel)}</b>. Click where it should go: a slot, a pocket or pack cell, Carried${mates.length ? ", a teammate" : ""}${box ? ", the container" : ""}, the ground${trunk ? ", the vehicle" : ""}.${armsBtn} <button class="mini" data-action="inv-cancel">Cancel</button></div>` : ""}
    <div class="small muted" style="margin-top:0.5rem">Drag things where they should go (or click one, then where). Click a thing twice to send it across. The first ${HAUL.free} kg a turn are free to haul, then ${HAUL.per} kg an action; handing things to a teammate next to you is free.${found.length ? ` Found so far: ${esc(found.join(", "))}.` : ""}</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary" data-action="inv-close">Done</button></div>
  </div>`;
}

// One person in the search window: their slots (paper doll), their weight against their max, what they carry loose.
function personCol(state, ui, b, u, s, isMe) {
  const first = esc(s.name.split(" ")[0]);
  const me = personalLoad(state, u);
  const p = raidParty(state, b);
  const weightLine = `<div class="small ${me.room < 0 ? "danger" : ""}"${tip(`Worn and held ${kg(me.worn)} kg${me.share ? `, their share of the team's packed supplies and cargo ${kg(me.share)} kg (on foot the team shares it out)` : ""}, carried loose ${kg(me.haul)} kg, of a ${me.max} kg max load (40, 28 with a Bad Back, 48 with a Strong Back, + the pack and Packrat). ${BANDS_HELP}`)}><b>${kg(me.load)}/${me.max} kg</b> · ${kg(Math.max(0, me.room))} kg free</div>${loadBar(me.load, me.max)}`;
  const dollHtml = doll(state, ui, s, `s:${s.id}`, spriteImg(survivorURL(s, state.seed), isMe ? 6 : 5), { user: s, weightLine });
  const hl = `haul:${u.id}`;
  const hsup = Object.entries(u.haul ? u.haul.sup : {}).filter(([, v]) => v >= 1);
  return `${dollHtml}<div class="invlabel"${tip(`Finds ${first} carries loose (bags, arms). They count against ${first}'s max load and come home with ${first}; if ${first} bleeds out they drop where ${first} falls.${p && lootLayer(b).vehicleZone >= 0 ? ` Put them in the vehicle to keep them safe and free ${first} up.` : ""}`)}>Carried (${kg(me.haul)} kg)</div>
    <div class="istore" data-action="inv-click" data-loc="${hl}:list" data-drop="${hl}:list"${tip(`Drop here: ${first} carries it`)}>${hsup.map(([k, v]) => supTile(ui, `${hl}:sup:${k}`, k, v)).join("")}${gearTiles(ui, u.haul ? u.haul.gear : [], hl, s) || (hsup.length ? "" : `<span class="small muted">Nothing. Drop finds here.</span>`)}</div>`;
}

// ---------- splitting a supply stack: the stack mover (ui/stackmove.js) ----------
// A picked stack opens the mover docked at the bottom of the window (how many, where, what fits); a dropped one opens
// it as a popover at the drop. A click on a destination while a stack is picked moves the amount chosen there.
const stackOf = (state, ui, b, loc) => supplyFit(state, ui.inv.uid, loc, loc).have; // a move onto itself: just the count
// A stack split in two (ui/stackmove.js) is the window's note, kept while the window is open; the wheel picks a stack.
const invSplits = (ui) => (ui.inv ? (ui.inv.splits ||= {}) : null);
const pickStack = (state, ui, at) => { ui.invSel = at; };
const listOf = (str) => { const T = parseRaidLoc(str); return `${T.o}:${T.id}:list`; };
const raidUnit = (state, ui) => {
  const b = state.combat;
  return b && lootLayer(b) && !b.over && ui.inv && ui.inv.raid ? b.units.find((x) => x.id === ui.inv.uid && x.side === "player" && !x.dead && !x.left) || null : null;
};
// Where a stack can go in the search window: the searcher's arms, each teammate next to them, the vehicle (at it),
// the open container.
function raidDests(state, ui, b, u) {
  const out = [{ id: `stow:${u.id}`, label: `${u.name.split(" ")[0]} (pockets & pack)` }, { id: `haul:${u.id}:list`, label: `${u.name.split(" ")[0]} (carried)` }];
  for (const m of matesOf(b, u)) out.push({ id: `stow:${m.id}`, label: `${m.name.split(" ")[0]}${m.down ? " (down)" : ""} (pockets & pack)` }, { id: `haul:${m.id}:list`, label: `${m.name.split(" ")[0]}${m.down ? " (down)" : ""}` });
  const p = raidParty(state, b);
  const trunk = p && atVehicle(b, u) ? trunkInfo(state, b) : null;
  if (trunk) out.push({ id: `trunk:${p.id}:list`, label: trunk.bike ? "Bike racks" : trunk.name });
  const L = lootLayer(b);
  const box = ui.inv.box != null ? L.containers.find((c) => c.id === ui.inv.box && c.contents) : null;
  if (box) out.push({ id: `rbox:${box.id}:list`, label: box.label });
  const ground = ui.inv.ground != null ? L.containers.find((c) => c.id === ui.inv.ground && c.contents) : null; // sim/ground.js: the ground under them
  if (ground && ground !== box) out.push({ id: `rbox:${ground.id}:list`, label: "On the ground here" });
  return out;
}
function raidFrom(state, b, u, F) {
  if (F.o === "rbox") { const c = lootLayer(b).containers.find((x) => x.id === F.id); return c ? c.label : "The container"; }
  if (F.o === "trunk") { const t = trunkInfo(state, b); return t ? (t.bike ? "Bike racks" : t.name) : "The vehicle"; }
  const x = b.units.find((q) => q.id === F.id);
  return `Carried by ${x ? x.name.split(" ")[0] : "them"}`;
}
registerStackScreen("raid", {
  spec(state, ui) {
    const b = state.combat, u = raidUnit(state, ui), sel = ui.invSel;
    if (!u || !sel) return null;
    const F = parseRaidLoc(sel);
    if (F.slot !== "sup") return null;
    const have = stackOf(state, ui, b, sel);
    const dests = raidDests(state, ui, b, u).filter((d) => { const T = parseRaidLoc(d.id); return !(T.o === F.o && T.id === F.id); })
      .map((d) => { const f = supplyFit(state, u.id, sel, d.id); return { ...d, fit: f.n, err: f.err }; });
    const budget = haulBudget(b, u);
    return { key: F.i, have, at: sel, splits: invSplits(ui), from: raidFrom(state, b, u, F), dests, to: listOf(quickTarget(state, b, u.id, sel, ui.inv.box ?? ui.inv.ground)),
      hint: `Haul this turn: ${kg(budget)} kg left (the first ${HAUL.free} kg free, then ${HAUL.per} kg an action). Putting things back and handing them over are free.` };
  },
  move(state, ui, to, qty) { ui.invMsg = raidMove(state, ui.inv.uid, ui.invSel, to, qty); },
  cancel(state, ui) { ui.invSel = null; },
  pick: pickStack,
});
// Loot the bodies: a body's stack goes to the team's found cargo, or the base's stores (sim/inventory.js takeSupply).
registerStackScreen("loot", {
  spec(state, ui) {
    if (!ui.inv || !ui.inv.loot || !ui.invSel || !state.combat) return null;
    const L = parseLoc(ui.invSel);
    if (L.o !== "body" || L.slot !== "sup") return null;
    const f = lootFit(state, L.id, L.i);
    const body = battleBodies(state)[L.id];
    if (!f.have || !body) return null;
    const st = storageFor(state, battlePlace(state.combat));
    const label = !st ? "Nowhere" : st.o === "cargo" ? "Team cargo" : `${(baseById(state, st.id) || { name: "Base" }).name} stores`;
    const dests = [{ id: "take", label, fit: f.n, err: f.err }];
    const s = ui.inv.sid != null ? survivorById(state, ui.inv.sid) : null;
    if (s && itemKeyOf(L.i)) for (const [id, hand] of [["kit", false], ["hand", true]]) { const fit = Math.min(f.have, roomOn(s, L.i, { hand })); dests.push({ id, label: `${shortName(s)}: ${hand ? "off hand" : "pockets & pack"}`, fit, err: fit ? "" : hand ? "The off hand is full." : "No room in the pockets or pack." }); }
    return { key: L.i, have: f.have, at: ui.invSel, splits: invSplits(ui), from: body.name, dests, to: "take", verb: "Take" };
  },
  move(state, ui, to, qty) {
    const L = parseLoc(ui.invSel);
    const s = ui.inv.sid != null ? survivorById(state, ui.inv.sid) : null;
    ui.invMsg = (to === "kit" || to === "hand") && s ? bodyToPerson(state, L.id, L.i, qty, s, { hand: to === "hand" }) : takeSupply(state, L.id, L.i, qty);
  },
  cancel(state, ui) { ui.invSel = null; },
  pick: pickStack,
});
// The inventory window: a stack in the base's stores or the team's found supplies ("armory:<id>:sup:<key>",
// "cargo:<id>:sup:<key>"). Where it can go comes from INV_STACK_DESTS: hooks (state, ui, loc) → [{ id, label, fit,
// err, move(state, ui, qty) → message }]. None on dev: a team's supplies are one pool its people share (sim/load.js)
// and nobody holds a stack of their own yet; ux-carry's held supplies (pockets, pack, arms, the vehicle) plug in here.
export const INV_STACK_DESTS = [];
const invDests = (state, ui, loc) => INV_STACK_DESTS.flatMap((f) => f(state, ui, loc) || []);
// Out of the stores onto the person whose inventory is open (sim/supitems.js suppliesOnto, 2026-10-18 user request:
// "move x loose ammo or any other item in the stores into the pockets, rig, pack"): as the items that hold it, into the
// place of theirs picked in the mover (their pockets, their rig's admin and pocket pouches, their pack; the stacks of it
// they have there first; the fit counts the place's room and their max load), or into the off hand. Rounds go boxed or
// loose (the chips under the panel: ui.invLoose). A stack dropped on one of their slots opens the mover on that place.
INV_STACK_DESTS.push((state, ui, loc) => {
  const L = parseLoc(loc);
  const s = ui.inv && ui.inv.sid != null ? survivorById(state, ui.inv.sid) : null;
  if (!s || L.slot !== "sup" || !itemKeyOf(L.i)) return [];
  const st = storageFor(state, `${L.o === "armory" ? "base" : "party"}:${L.id}`);
  if (!st || personPlace(s) !== `${st.o === "armory" ? "base" : "party"}:${st.id}`) return [];
  const holders = st.o === "cargo" ? teamHolders(st.party) : [baseById(state, st.id)]; // a team: its found cargo, then its packed supplies
  const name = shortName(s), what = (SUPPLIES[L.i] || { name: L.i }).name.toLowerCase();
  const loose = isRoundKey(L.i) && !!ui.invLoose;
  const form = isRoundKey(L.i) ? (loose ? ", loose" : ", boxed") : "";
  const out = SUP_PLACES.filter((w) => w === "pocket" || (w === "rig" ? rigOf(s) : packOf(s))).map((w) => {
    const room = supRoom(s, L.i, w, loose);
    return { id: w, label: `${name}: ${PLACE_WORDS[w]}`, fit: room.n, err: room.why,
      move: (state2, ui2, qty) => { const r = suppliesOnto(state2, holders, L.i, qty, s, { where: w, loose }); return r.moved ? `${r.moved} ${what} → ${name}'s ${PLACE_WORDS[w]}${form}.${r.why ? ` ${r.why}` : ""}` : r.why || `No room for the ${what}.`; } };
  });
  const fit = roomOn(s, L.i, { hand: true });
  out.push({ id: "hand", label: `${name}: off hand`, fit, err: fit ? "" : `${name}'s off hand is full.`,
    move: (state2, ui2, qty) => { let n = 0; for (const h of holders) { if (!(qty - n >= 1)) break; n += stockToPerson(state2, h, L.i, qty - n, s, { hand: true }); } return n ? `${n} ${what} → ${name}'s off hand.` : `No room for the ${what}.`; } });
  return out;
});
// The boxed / loose chips under the mover for a stack of rounds (ui.invLoose; the amount picked is worked out again).
const looseChips = (ui) => `<span class="muted">Rounds go</span> <button class="mini${ui.invLoose ? "" : " active"}" data-action="inv-loose" data-v="0"${tip("As boxes (up to five boxes a slot)")}>boxed</button> <button class="mini${ui.invLoose ? " active" : ""}" data-action="inv-loose" data-v="1"${tip("Loose (up to 80 rounds a slot; a handful in an admin pouch)")}>loose</button>`;
registerStackScreen("inv", {
  spec(state, ui) {
    if (!ui.inv || ui.inv.raid || !ui.invSel) return null;
    const L = parseLoc(ui.invSel);
    if ((L.o !== "armory" && L.o !== "cargo") || L.slot !== "sup") return null;
    const st = storageFor(state, `${L.o === "armory" ? "base" : "party"}:${L.id}`);
    const pool = !st ? null : st.o === "cargo" ? teamPool(st.party) : (baseById(state, st.id) || {}).stock;
    const dests = invDests(state, ui, ui.invSel);
    if (!pool || !dests.length) return null;
    const to = (dests.find((d) => d.fit > 0) || dests[0]).id; // the first place with room (pockets, pack, rig, the off hand)
    const hint = isRoundKey(L.i) && dests.some((d) => SUP_PLACES.includes(d.id)) ? looseChips(ui) : "";
    return { key: L.i, have: Math.floor(pool[L.i] || 0), at: ui.invSel, splits: invSplits(ui), from: st.o === "cargo" ? "Team supplies" : `${baseById(state, st.id).name} stores`, dests, to, hint };
  },
  move(state, ui, to, qty) { const d = invDests(state, ui, ui.invSel).find((x) => x.id === to); if (d) ui.invMsg = d.move(state, ui, qty); },
  cancel(state, ui) { ui.invSel = null; },
  pick: pickStack,
});

// ev: Shift+click on a supply stack sends all of it that fits straight across.
function raidClick(state, ui, loc, ev = null) {
  const b = state.combat;
  const uid = ui.inv.uid;
  const sel = ui.invSel;
  const L = parseRaidLoc(loc);
  const has = (str) => { const x = parseRaidLoc(str); return x.slot === "sup" || (x.o === "s" ? !!itemAt(state, str) : !!raidItemAt(state, b, str)); };
  const qtyOf = (str) => (parseRaidLoc(str).slot === "sup" && str === sel ? chosenQty(state, ui, "raid") : Infinity);
  const done = () => { ui.invSel = null; closeStack(ui); };
  if (ev && ev.shiftKey && L.slot === "sup" && sel !== loc) {
    ui.invMsg = raidMove(state, uid, loc, quickTarget(state, b, uid, loc, ui.inv.box ?? ui.inv.ground));
    done();
    return;
  }
  const pick = (str) => { ui.invSel = str; if (parseRaidLoc(str).slot === "sup") openStack(ui, "raid"); else closeStack(ui); }; // a new stack: the mover opens on it
  if (!sel) { if (L.slot !== "list" && has(loc)) pick(loc); return; }
  if (sel === loc) {
    // The picked stack clicked again: the mover's amount to its destination (the vehicle, the arms...).
    const to = parseRaidLoc(sel).slot === "sup" && ui.stack && ui.stack.ns === "raid" && ui.stack.to ? ui.stack.to : quickTarget(state, b, uid, loc, ui.inv.box ?? ui.inv.ground);
    ui.invMsg = raidMove(state, uid, loc, to, qtyOf(loc));
    done();
    return;
  }
  // A thing in a list clicked as a target means that list; another thing in the same list is picked instead.
  const F = parseRaidLoc(sel);
  if (L.o !== "s" && F.o === L.o && F.id === L.id) { if (L.slot !== "list" && has(loc)) pick(loc); else done(); return; }
  // A stack clicked onto a person's slot: held there as an item (that slot, else their pockets and pack), else into
  // their arms (a bulky one, or no room).
  const T = F.slot === "sup" && L.o === "s" ? heldOfSurvivor(state, ui, b, L.id, sel, loc) : null;
  ui.invMsg = raidMove(state, uid, sel, T || (L.o === "s" ? loc : `${L.o}:${L.id}:list`), qtyOf(sel));
  done();
}
const haulOfSurvivor = (b, sid) => { const x = b.units.find((q) => q.side === "player" && q.sid === sid && !q.dead); return x ? `haul:${x.id}:list` : null; };
// Where a supply stack put on a person goes (sim/raidloot.js): the slot it was dropped on when it can be held there
// (slot: null to skip), else their pockets and pack ("stow:<uid>") when there is room, else their arms.
function heldOfSurvivor(state, ui, b, sid, from, slot) {
  const x = b.units.find((q) => q.side === "player" && q.sid === sid && !q.dead);
  if (!x) return null;
  if (slot && !supplyFit(state, ui.inv.uid, from, slot, 1).err) return slot;
  if (!supplyFit(state, ui.inv.uid, from, `stow:${x.id}`, 1).err) return `stow:${x.id}`;
  return `haul:${x.id}:list`;
}

// A supply stack clicked outside a raid: a body's (Loot the bodies) or the stores' (the inventory window).
function supClick(state, ui, loc, ev) {
  const L = parseLoc(loc);
  const ns = L.o === "body" ? "loot" : "inv";
  if (ns === "loot" && ev && ev.shiftKey) { ui.invMsg = takeSupply(state, L.id, L.i); ui.invSel = null; closeStack(ui); return; }
  if (ui.invSel === loc && ns === "loot") { ui.invMsg = takeSupply(state, L.id, L.i, chosenQty(state, ui, "loot")); ui.invSel = null; closeStack(ui); return; }
  if (ui.invSel === loc) { ui.invSel = null; closeStack(ui); return; }
  ui.invSel = loc;
  openStack(ui, ns);
}

// ---------- actions (wired in main.js) ----------
// The fight's inventory window (peekModal): pick, unpick, or move the picked item there through combatAct "inv".
function peekClick(state, ui, loc) {
  const sel = ui.invSel;
  if (!sel) { if (itemAt(state, loc)) ui.invSel = loc; return; }
  if (sel === loc) { ui.invSel = null; return; }
  fightMove(state, ui, sel, loc);
}
function clickLoc(state, ui, loc, ev = null) {
  if (ui.inv && ui.inv.raid) return raidClick(state, ui, loc, ev);
  if (ui.inv && ui.inv.peek) return peekClick(state, ui, loc);
  const sel = ui.invSel;
  const to = parseLoc(loc);
  if (to.slot === "sup") return supClick(state, ui, loc, ev); // a supply stack: the stack mover
  if (sel && parseLoc(sel).slot === "sup") {
    // A stack picked, then a place clicked: a body's stack is taken (the amount chosen), another item is picked instead.
    const F = parseLoc(sel);
    if (F.o === "body" && !(to.o === "body" && itemAt(state, loc))) ui.invMsg = takeSupply(state, F.id, F.i, chosenQty(state, ui, "loot"));
    ui.invSel = to.o === "body" && itemAt(state, loc) ? loc : null;
    closeStack(ui);
    return;
  }
  if (!sel) {
    if (itemAt(state, loc)) ui.invSel = loc;
    return;
  }
  if (sel === loc) {
    ui.invMsg = quickMove(state, loc, ui.inv.sid);
    ui.invSel = null;
    return;
  }
  const from = parseLoc(sel);
  // Clicking another item on a body, or another stored item while a stored one is picked: pick that instead.
  if (to.o === "body" || ((to.o === "armory" || to.o === "cargo") && (from.o === "armory" || from.o === "cargo") && to.i != null)) {
    ui.invSel = itemAt(state, loc) ? loc : null;
    return;
  }
  // A stored item clicked as a target means "into storage".
  const target = (to.o === "armory" || to.o === "cargo") ? `${to.o}:${to.id}:list` : loc;
  ui.invMsg = moveItem(state, sel, target);
  ui.invSel = null;
}

// A supply stack dropped: a popover at the drop asks how many (ui/stackmove.js; Enter moves, Esc cancels), unless
// Shift was held (half the stack, straight away) or Ctrl (one), or the stack is a single one. at: where it was dropped
// (dropPoint). Items move at once, as before.
export function invDrop(state, ui, from, to, half = false, one = false, at = null) {
  if (!ui.inv) return;
  const pop = at || { x: 0, y: 0 };
  if (ui.inv.raid) {
    if (!/^(s|rbox|haul|trunk):\d+:/.test(from)) return; // a drag of selected text, not of a thing
    const b = state.combat;
    const T = parseRaidLoc(to), F = parseRaidLoc(from);
    // A stack dropped on a person's slot: held there as an item (that slot, else their pockets and pack), else into
    // their arms (a bulky one, or no room: sim/raidloot.js).
    const dest = F.slot === "sup" && T.o === "s" ? heldOfSurvivor(state, ui, b, T.id, from, null) || to : T.o === "s" ? to : `${T.o}:${T.id}:list`;
    if (F.slot === "sup") {
      const n = stackOf(state, ui, b, from);
      if (one || half || n <= 1) { ui.invMsg = raidMove(state, ui.inv.uid, from, T.o === "s" ? heldOfSurvivor(state, ui, b, T.id, from, to) || dest : dest, one ? 1 : half ? Math.max(1, Math.floor(n / 2)) : Infinity); ui.invSel = null; closeStack(ui); return; }
      const D = parseRaidLoc(dest);
      if (D.o === F.o && D.id === F.id) return; // dropped back where it was
      ui.invSel = from;
      openStack(ui, "raid", { to: dest, pop });
      return;
    }
    ui.invMsg = raidMove(state, ui.inv.uid, from, dest, Infinity);
    ui.invSel = null;
    closeStack(ui);
    return;
  }
  if (ui.inv.peek) { if (/^s:\d+:/.test(from)) fightMove(state, ui, from, to); return; } // the fight's window: through the sim, 1 action
  const F = parseLoc(from);
  if (F.slot === "sup") {
    if (F.o !== "body") {
      // A stack out of the stores dropped on someone's slot: the mover opens on that place of theirs (their pockets, a
      // rig pouch, the pack, the off hand); elsewhere, on the first place with room.
      const T = parseLoc(to);
      if (T.o === "s" && ui.inv && !ui.inv.loot && survivorById(state, T.id)) ui.inv.sid = T.id;
      const where = T.o !== "s" ? null : T.slot === "pocket" ? "pocket" : T.slot === "rig" && T.i != null ? "rig" : T.slot === "pack" ? "pack" : T.slot === "tool" ? "hand" : null;
      if (invDests(state, ui, from).length) { ui.invSel = from; openStack(ui, "inv", { pop, to: where }); }
      return;
    }
    const n = lootFit(state, F.id, F.i).have;
    if (one || half || n <= 1) { ui.invMsg = takeSupply(state, F.id, F.i, one ? 1 : half ? Math.max(1, Math.floor(n / 2)) : Infinity); ui.invSel = null; closeStack(ui); return; }
    if (parseLoc(to).o === "body") return; // dropped back on a body
    ui.invSel = from;
    openStack(ui, "loot", { to: "take", pop });
    return;
  }
  const t = parseLoc(to);
  ui.invMsg = moveItem(state, from, (t.o === "armory" || t.o === "cargo") ? `${t.o}:${t.id}:list` : to);
  ui.invSel = null;
}

export const INV_ACTIONS = {
  ...STACK_ACTIONS, // the stack mover (ui/stackmove.js): sm-qty, sm-to, sm-go, sm-cancel
  "inv-open": (state, ui, d) => { ui.inv = { sid: Number(d.id), loot: false }; ui.invSel = null; ui.invMsg = ""; },
  "inv-close": (state, ui) => { ui.inv = null; ui.invSel = null; ui.invMsg = ""; },
  "inv-details": (state, ui) => { ui.invDetails = ui.invDetails === ui.invSel ? null : ui.invSel; }, // ⓘ Details on the selected item (itemlabels.js: the hover tip is short)
  "inv-who": (state, ui, d) => { ui.inv.sid = Number(d.id); ui.invSel = null; },
  "inv-mate": (state, ui, d) => { if (!ui.inv || !ui.inv.peek) return; if (d.id === "" || d.id == null) delete ui.inv.mate; else ui.inv.mate = Number(d.id); ui.invSel = null; ui.invMsg = ""; }, // the hand-over window: another mate in reach, or the acting one's own kit alone
  "inv-click": (state, ui, d, ev) => clickLoc(state, ui, d.loc, ev),
  "inv-cancel": (state, ui) => { ui.invSel = null; closeStack(ui); },
  "inv-loose": (state, ui, d) => { ui.invLoose = d.v === "1"; if (ui.stack) ui.stack.qty = null; }, // rounds out of the stores onto a person: boxed or loose (the mover's chips)
  "inv-store": (state, ui) => { if (ui.invSel) ui.invMsg = toStorage(state, ui.invSel); ui.invSel = null; },
  // Gun attachments (sim/inventory.js fitModAt / unfitModAt; sim/gunmods.js).
  "inv-fitmod": (state, ui, d) => { if (!ui.invSel) return; const gun = itemAt(state, ui.invSel); ui.invMsg = fitModAt(state, ui.invSel, d.mod); reselect(state, ui, gun); },
  "inv-unmod": (state, ui, d) => { if (ui.invSel && ui.inv) ui.invMsg = unfitModAt(state, ui.invSel, d.mount, ui.inv.sid); },
  "inv-fitto": (state, ui, d) => { if (ui.invSel) ui.invMsg = fitModAt(state, d.gun, ui.invSel); ui.invSel = d.gun; },
  // Helmet mounts (sim/helmets.js fitHelmetAt / stripHelmetAt).
  "inv-helmfit": (state, ui, d) => { if (!ui.invSel) return; const h = itemAt(state, ui.invSel); ui.invMsg = fitHelmetAt(state, ui.invSel, d.part, ui.inv && ui.inv.sid); reselect(state, ui, h); },
  "inv-helmstrip": (state, ui, d) => { if (ui.invSel) ui.invMsg = stripHelmetAt(state, ui.invSel, d.mount, ui.inv && ui.inv.sid); },
  "inv-helmon": (state, ui) => { if (!ui.invSel || !ui.inv) return; ui.invMsg = fitHelmetAt(state, `s:${ui.inv.sid}:head`, ui.invSel, ui.inv.sid); ui.invSel = null; },
  // (in the fight's window, peekModal, each goes through combatAct "inv" for INV_AP: fightMove)
  "inv-split": (state, ui) => { if (!ui.invSel) return; if (ui.inv && ui.inv.peek) fightMove(state, ui, ui.invSel, null, "split"); else ui.invMsg = splitAt(state, ui.invSel); }, // sim/inventory.js: half a stack into a spot of its own
  "inv-openbox": (state, ui) => { if (!ui.invSel) return; if (ui.inv && ui.inv.peek) fightMove(state, ui, ui.invSel, null, "open"); else ui.invMsg = openAt(state, ui.invSel); }, // a stack of boxes into loose rounds; a handful out of a bulk container
  "inv-boxrounds": (state, ui) => { if (!ui.invSel) return; if (ui.inv && ui.inv.peek) fightMove(state, ui, ui.invSel, null, "box"); else ui.invMsg = boxAt(state, ui.invSel); }, // loose rounds packed back into boxes
  "inv-use": (state, ui) => { if (ui.invSel && ui.inv) ui.invMsg = useItemOn(state, ui.inv.sid, ui.invSel); ui.invSel = null; }, // sim/comforts.js
  // Firewood (sim/inventory.js breakDownAt; sim/woodcutting.js breakDownJunk): anything above junk asks first (ui/confirm.js).
  // Repairs and salvage (sim/repair.js, sim/inventory.js salvageAt).
  "inv-repair": (state, ui) => {
    if (!ui.invSel) return;
    const loc = parseLoc(ui.invSel);
    const place = placeOfLoc(state, loc);
    const base = place && place.startsWith("base:") ? baseById(state, Number(place.split(":")[1])) : null;
    ui.invMsg = base ? queueRepair(state, base, ui.invSel) : fieldRepair(state, ui.invSel);
    if (base) ui.invSel = null;
  },
  "inv-fieldrepair": (state, ui) => { if (ui.invSel) ui.invMsg = fieldRepair(state, ui.invSel); },
  "inv-cancelrepair": (state, ui, d) => { const b = baseById(state, Number(d.base)); if (b) ui.invMsg = cancelRepair(state, b, Number(d.id)); },
  "inv-salvage": (state, ui, d = {}) => {
    if (!ui.invSel) return;
    const it = itemAt(state, ui.invSel);
    const info = salvageInfo(state, ui.invSel);
    if (it && info.ok && ask(ui, d, "inv-salvage", { kind: "salvage", title: `Take the ${it.name} apart for parts?`, text: `It is gone for good: ${salvageText(info.got)}.`, yes: "Take it apart" })) return;
    ui.invMsg = salvageAt(state, ui.invSel);
    ui.invSel = null;
  },
  "inv-breakdown": (state, ui, d = {}) => {
    if (!ui.invSel) return;
    const it = itemAt(state, ui.invSel);
    if (it && !isJunk(it) && ask(ui, d, "inv-breakdown", { kind: "breakdown", title: `Break the ${it.name} down for firewood?`, text: `It is gone for good: +${breakDownInfo(state, ui.invSel).wood} firewood. It is worth more than junk (it could be worn, traded or repaired).`, yes: "Break it down" })) return;
    ui.invMsg = breakDownAt(state, ui.invSel);
    ui.invSel = null;
  },
  "inv-opencase": (state, ui) => { if (ui.invSel) ui.invMsg = openCaseAt(state, ui.invSel); ui.invSel = null; }, // sim/gunsafes.js
  "inv-firemark": (state, ui, d) => { if (ui.invSel) ui.invMsg = setFireMark(state, ui.invSel, d.mark || null); },
  "inv-burnjunk": (state, ui, d) => { const b = baseById(state, Number(d.base)); if (b) ui.invMsg = breakDownJunk(state, b); ui.invSel = null; },
  "loot-open": (state, ui) => { ui.inv = { sid: null, loot: true, body: null }; ui.invSel = null; ui.invMsg = ""; },
  "loot-body": (state, ui, d) => { ui.inv.body = Number(d.i); ui.invSel = null; },
  "loot-sup": (state, ui, d) => { ui.invMsg = takeSupply(state, Number(d.i), d.key, d.n ? Number(d.n) : Infinity); }, // d.n: part of the stack
  "loot-takebody": (state, ui, d) => {
    const r = takeAllBody(state, Number(d.i));
    ui.invMsg = `${r.got.length ? `Took ${r.got.join(", ")}.` : "Nothing taken."}${r.left ? ` ${r.left} thing${r.left === 1 ? "" : "s"} did not fit.` : ""}`;
    ui.invSel = null;
  },
  "loot-takeall": (state, ui) => {
    const r = takeAllBodies(state);
    ui.invMsg = `${r.got.length ? `Took ${r.got.join(", ")}.` : "Nothing taken."}${r.left ? ` ${r.left} thing${r.left === 1 ? "" : "s"} did not fit.` : ""}`;
    ui.invSel = null;
  },
  "loot-done": (state, ui) => { ui.inv = null; ui.invSel = null; ui.invMsg = ""; },
  // The search window (sim/raidloot.js).
  "rl-takeall": (state, ui, d) => {
    const boxId = d && d.box != null ? Number(d.box) : ui.inv && ui.inv.box;
    if (!ui.inv || !ui.inv.raid || boxId == null) return;
    const r = raidTakeAll(state, ui.inv.uid, boxId);
    ui.invMsg = `${r.got.length ? `Took ${r.got.join(", ")}.` : "Nothing taken."}${r.left ? (r.outOfTime ? " Out of time for the rest this turn: end the turn and come back." : ` ${r.left} thing${r.left === 1 ? "" : "s"} did not fit.`) : ""}`;
    ui.invSel = null;
  },
  // The full search of a container only rummaged through (sim/search.js): 1 action, the rest turns up.
  "rl-full": (state, ui) => {
    const b = state.combat;
    if (!ui.inv || !ui.inv.raid || ui.inv.box == null || !b) return;
    const err = combatAct(state, { type: "search", unit: ui.inv.uid, box: ui.inv.box, open: true });
    const box = lootLayer(b) && lootLayer(b).containers.find((c) => c.id === ui.inv.box);
    const n = box && box.contents ? box.contents.gear.length + Object.values(box.contents.sup).filter((v) => v >= 1).length : 0;
    ui.invMsg = err || `Searched in full: ${n ? `${n} thing${n === 1 ? "" : "s"} in it now` : "nothing more"}.`;
    ui.invSel = null;
  },
  // Carry in arms (sim/carry.js): the selected bag, rig or case into the In arms slot (hands full until set down).
  "rl-carry": (state, ui) => {
    const b = state.combat;
    if (!ui.inv || !ui.inv.raid || !ui.invSel || !b) return;
    const u = b.units.find((x) => x.id === ui.inv.uid);
    const it = raidItemAt(state, b, ui.invSel);
    const why = u && it ? bagRefusal(state, b, u, it) : "Nothing selected.";
    ui.invMsg = why || raidMove(state, u.id, ui.invSel, `s:${u.sid}:carry`);
    ui.invSel = null;
  },
  "rl-mate": (state, ui, d) => { if (ui.inv && ui.inv.raid) { ui.inv.mate = Number(d.id); ui.invSel = null; } },
  "rl-stash": (state, ui) => {
    if (!ui.inv || !ui.inv.raid) return;
    const r = stashAll(state, ui.inv.uid);
    ui.invMsg = `${r.put.length ? `Put ${r.put.join(", ")} in the vehicle.` : "Nothing put in."}${r.left ? (r.outOfTime ? " No time to haul the rest this turn: end the turn and come back for it." : ` ${r.left} thing${r.left === 1 ? "" : "s"} did not fit.`) : ""}`;
    ui.invSel = null;
  },
};

// Typed in (wired in main.js with the other change handlers): the stack mover's slider and number box (sm-qtyset).
export const INV_CHANGE = {
  ...STACK_CHANGE,
};
