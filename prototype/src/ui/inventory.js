// RPG-style inventory screen (paper doll) and the "Loot the bodies" screen after a won battle.
// Rules live in sim/inventory.js; this file only draws and turns clicks / drags into moveItem calls.
// ui.inv = { sid, loot: bool, body: index }  ui.invSel = selected location string  ui.invMsg = last message.
// Click an item to select it, then click a slot, pocket, pack cell or the storage box to move it there
// (click the selected item again to send it across: onto the person, or into storage). Drag and drop works too.
import { GEAR, SUPPLIES, SKILL_NAMES } from "../sim/data.js";
import { survivorById, atBase, baseById, gearEffect, combatPower } from "../sim/world.js";
import { partyMembers, partyCapacity, cargoLoad, poolLoad, partyLoad } from "../sim/parties.js";
import { wornLoad, maxLoad, personLoad, bandName } from "../sim/load.js";
import { bandChip, BANDS_HELP } from "./loadview.js";
import { itemDur, durUnit } from "../sim/crafting.js";
import { worthTier } from "../sim/valuation.js";
import {
  EQUIP_SLOTS, SLOT_NAMES, POCKETS, ensureInv, packOf, packSize, armorPower, itemAt, parseLoc, moveItem, quickMove, toStorage,
  personPlace, battlePlace, storageFor, battleBodies, bodyHolder, bodyEmpty, takeSupply, takeAllBody, takeAllBodies, itemLoad, allItems,
} from "../sim/inventory.js";
import { survivorURL, spriteImg, canvasURL, unitCanvas } from "./sprites.js";
import { cui } from "./combat.js";
import { shortName } from "./names.js";
import { useItemOn, useText } from "../sim/comforts.js";
import { partyVehicle, vehicleLabel, isBike } from "../sim/vehicles.js";
import { raidMove, raidItemAt, parseRaidLoc, raidTakeAll, stashAll, personalLoad, trunkInfo, atVehicle, raidParty, quickTarget, matesOf, hauled, haulBudget, HAUL, supplyFit } from "../sim/raidloot.js";
import { combatAct } from "../sim/combat.js";
import { SEARCH } from "../sim/search.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => esc(shortName(s)); // first name, with a last initial when two people share it

// ---------- item tiles ----------
const GUNS = new Set(["pistol", "shotgun", "huntrifle", "ar", "pipegun", "revolver", "leverrifle", "carbine"]);
const TOOL_ICON = { bandagekit: "✚", surgkit: "✚", milradio: "📻", nvg: "🥽", crowbar: "🔧", waterfilter: "💧", bicycle: "🚲",
  guitar: "🎸", harmonica: "🎵", cards: "🃏", photos: "🖼", pipebomb: "💣", molotov: "🔥", flare: "🎆", smokegren: "💨", cuffs: "⛓", gamecall: "📯",
  camonet: "⛺", ghillie: "🌿", stove: "⛺", scentmask: "🫙", ragboots: "🥾" };
// By trade category (data.js CATEGORIES): valuables and treats at a glance.
const CAT_ICON = { jewelry: "💍", smokes: "🚬", liquor: "🍾", treats: "🍫", gadgets: "📱", collectibles: "🪙", household: "🧻", defence: "🚧", bow: "🏹" };
const SLOT_ICON = { weapon: "🗡", tool: "🧰", head: "⛑", armor: "🦺", arms: "🧤", legs: "🦵", backpack: "🎒" };
const SUPPLY_ICON = { food: "🥫", water: "💧", rawwater: "🪣", fuel: "⛽", meds: "✚", ammo: "⁍", parts: "⚙", scrap: "🔩" };
function icon(key) {
  const d = GEAR[key];
  if (GUNS.has(key)) return "🔫";
  return TOOL_ICON[key] || CAT_ICON[d.cat] || SLOT_ICON[d.slot] || (d.book ? "📖" : "▪");
}

// Hover text for an item, with the skill-gap rule for the person who would use it.
export function itemTip(item, s = null) {
  const d = GEAR[item.key];
  const kgTxt = `${Math.round(itemLoad(item) * 10) / 10} kg${item.contents && item.contents.some(Boolean) ? " with what is inside" : ""}`;
  const bits = [`${d.name} (${SLOT_NAMES[d.slot] || d.slot}${d.small ? ", fits a pocket" : d.bulky ? ", cargo only" : ""}, ${kgTxt})`];
  if (d.slot === "weapon") bits.push(`power ${d.power}${d.req ? `, needs ${SKILL_NAMES[d.skill]} ${d.req} for full use` : ""}`);
  else if (["armor", "head", "arms", "legs"].includes(d.slot)) bits.push(`armor ${d.power} (adds up across body, head, arms and legs)`);
  else if (d.slot === "backpack") bits.push(`${packSize(item)} pack slots, +${d.carry || 0} kg max load${d.ease ? `, spreads the weight: the wearer's load counts ${Math.round(d.ease * 100)}% lighter for their load band` : ""}`);
  else if (d.book) bits.push(d.book.skill ? `book: teaches ${SKILL_NAMES[d.book.skill]} up to ${d.book.max}, ${d.book.hours} hours to read (Read role at a base, from the armory)` : `book: +${d.book.mood} mood an hour read, ${d.book.hours} hours`); // skills.js
  else if (d.valuable) bits.push("a valuable: good for nothing but trade");
  else if (d.use) bits.push(`used up: ${useText(item.key)} (select it, then Use)`); // sim/comforts.js
  else if (d.comfort) bits.push(d.comfort.team ? `comfort: +${d.comfort.team} mood a day for everyone at the base or on the team that has it` : `keepsake: +${d.comfort.self} mood a day to whoever carries it`);
  else if (d.heat) bits.push("camp kit: less Heat for the team that carries it (see the team's Heat)"); // sim/fieldheat.js
  else if (d.defence) bits.push("base defence: works from a base's armory (see the base's horde defences)"); // sim/defences.js
  else if (d.throw) bits.push("thrown in battle (Throw button), from a pocket, the pack, the cargo or the armory");
  else if (d.power) bits.push(`power ${d.power}${d.req && d.skill ? `, needs ${SKILL_NAMES[d.skill]} ${d.req}` : ""}`);
  if (s && d.skill && d.req) {
    const e = gearEffect(s, item);
    if (e.gap > 0) bits.push(e.usable ? `${s.name.split(" ")[0]} is ${e.gap} below the skill: weaker${e.damageChance ? ", may damage it" : ""}` : `${s.name.split(" ")[0]} cannot use it`);
  }
  bits.push(`worth: ${worthTier(item)}`); // a rough tier: the price depends on who you trade with (sim/valuation.js)
  if ((item.quality || 1) < 1) bits.push(`condition ${Math.round(item.quality * 100)}%`);
  const dur = itemDur(item);
  if (dur != null) bits.push(d.tabs ? `${dur} of ${d.dur} tablets left` : `makeshift: ${dur} of ${d.dur} ${durUnit(item.key)} left`);
  if (item.contents) bits.push(`holds ${item.contents.filter(Boolean).length} of ${item.contents.length} items`);
  return `${bits.join(". ")}.${d.desc ? ` ${d.desc}` : ""}`;
}

function tile(item, loc, s, drag = true) {
  const d = GEAR[item.key];
  const dur = itemDur(item);
  const frac = dur != null ? dur / d.dur : item.quality || 1;
  const col = frac > 0.6 ? "var(--good)" : frac > 0.3 ? "var(--accent)" : "var(--danger)";
  const unusable = s && d.skill && d.req && !gearEffect(s, item).usable;
  return `<div class="itile${unusable ? " bad" : ""}"${drag ? ` draggable="true" data-drag="${loc}"` : ""}${tip(itemTip(item, s))}>
    <span class="iico">${icon(item.key)}</span><span class="iname">${esc(item.name)}</span><span class="ikg">${Math.round(itemLoad(item) * 10) / 10}</span>
    ${item.contents ? `<span class="icount">${item.contents.filter(Boolean).length}/${item.contents.length}</span>` : ""}
    <i class="idur"><b style="width:${Math.round(Math.max(0.05, Math.min(1, frac)) * 100)}%;background:${col}"></b></i></div>`;
}

// One slot box (equipment, pocket or pack cell). Clicks select / drop; drops land on data-drop.
function slotBox(state, ui, loc, label, s, readonly) {
  const item = itemAt(state, loc);
  const sel = ui.invSel === loc ? " sel" : "";
  const act = readonly ? "" : ` data-action="inv-click" data-loc="${loc}" data-drop="${loc}"`;
  return `<div class="islot${sel}${item ? "" : " empty"}"${act}${item ? "" : tip(`${label}: empty`)}><span class="islab">${label}</span>${item ? tile(item, loc, s, !readonly) : ""}</div>`;
}

// The paper doll: portrait in the middle, hands / off hand / pack on the left, head / body / arms / legs on the
// right, pockets and pack below. holder = survivor or body; prefix = "s:<id>" or "body:<i>".
function doll(state, ui, holder, prefix, portrait, { readonly = false, user = null, weightLine = null } = {}) {
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
    weight = `<div class="small"${tip(`${team ? `Wears ${Math.round(worn * 10) / 10} kg and carries ${Math.round((pl.load - worn) * 10) / 10} kg of the team's supplies and cargo (shared so everyone is equally burdened)` : `Wears and carries ${Math.round(worn * 10) / 10} kg`}, of a ${max} kg max load (40, 28 with a Bad Back, + the pack and Packrat). On foot: pace ${Math.round(pl.speed * 100)}%, food and water ${Math.round(pl.eat * 100)}% on the move. ${BANDS_HELP}`)}>${Math.round(pl.load)}/${max} kg ${bandChip(pl.band)}</div>`;
  }
  return `<div class="doll">
      <div class="dollside">${box("weapon")}${box("tool")}${box("backpack")}</div>
      <div class="dollport">${portrait}<div class="small muted"${tip("Armor from every worn piece (body, head, arms, legs) adds up, to a cap of 5.5. Each point cuts damage taken by 6%.")}>Armor ${Math.round(arm * 10) / 10}</div>${weight}</div>
      <div class="dollside">${box("head")}${box("armor")}${box("arms")}${box("legs")}</div>
    </div>
    <div class="invlabel"${tip("Pockets hold small things: knives, pistols, kits, radios, goggles. Nothing in a pocket is in use until it is moved to a hand.")}>Pockets</div>
    <div class="invgrid">${Array.from({ length: POCKETS }, (_, i) => slotBox(state, ui, `${prefix}:pocket:${i}`, "", user, readonly)).join("")}</div>
    <div class="invlabel"${tip("A pack holds anything but another pack or something bulky. Wear a backpack to get pack slots and a higher max load. Everything in it still weighs what it weighs.")}>Pack${pk ? ` (${pk.filter(Boolean).length}/${pk.length})` : ""}</div>
    ${pk ? `<div class="invgrid">${pk.map((_, i) => slotBox(state, ui, `${prefix}:pack:${i}`, "", user, readonly)).join("")}</div>` : `<div class="small muted">No backpack, no pack slots.</div>`}`;
}

// Storage at a place: the base armory or the team's cargo, as a drop box with item tiles.
function storageBox(state, ui, place, user) {
  const st = storageFor(state, place);
  if (!st) return "";
  const loc = `${st.o}:${st.id}:list`;
  let head;
  if (st.o === "cargo") {
    const cap = partyCapacity(state, st.party), load = poolLoad(st.party);
    const v = partyVehicle(state, st.party); // a car or bikes: the cargo rides in it (on a raid map its trunk is opened at the vehicle, sim/raidloot.js)
    head = `<div class="spread"><b${tip(v ? `The team's cargo rides in the ${vehicleLabel(v).toLowerCase()}${isBike(v) ? " (15 kg a rack; the rest is shared out among the people)" : ""}. Drag things from a survivor into it, or out of it onto them. On a raid map the vehicle waits in its zone: walk to it to load or unload.` : "Found cargo the team carries, by weight (a pack also weighs what is in it). It is shared out with the packed supplies among the team (sim/load.js). Moving things between the cargo and the people weighs nothing extra: it is the same team.")}>${v ? `${esc(vehicleLabel(v))} (team cargo)` : "Team cargo"}</b><span class="small ${load > cap ? "danger" : "muted"}"${tip("Supplies and cargo against what the team can carry on top of what it wears (and its vehicle)")}>load ${Math.round(load)}/${Math.round(cap)} kg</span></div>
      <div class="bar"><i style="width:${Math.min(100, (load / Math.max(1, cap)) * 100)}%;background:${load > cap * 0.9 ? "var(--danger)" : "var(--info)"}"></i></div>`;
  } else head = `<div class="spread"><b${tip("Gear stored at this base. Equip it on anyone here.")}>Armory</b><span class="small muted">${st.list.length} items</span></div>`;
  const tiles = st.list.map((it, i) => {
    const l = `${loc}:${i}`;
    return `<div class="islot store${ui.invSel === l ? " sel" : ""}" data-action="inv-click" data-loc="${l}" data-drop="${loc}"${tip(`Weighs ${Math.round(itemLoad(it) * 10) / 10} kg`)}>${tile(it, l, user)}</div>`;
  }).join("");
  const sup = st.o === "cargo" ? Object.entries(st.party.cargo.supplies).filter(([, v]) => v >= 1).map(([k, v]) => `${Math.floor(v)} ${k}`).join(", ") : "";
  return `${head}<div class="istore" data-action="inv-click" data-loc="${loc}" data-drop="${loc}"${tip(`Drop or click here to put the selected item in ${st.name}`)}>${tiles || `<span class="small muted">Empty. Drop items here.</span>`}</div>
    ${sup ? `<div class="small muted">Found supplies: ${esc(sup)}</div>` : ""}`;
}

// People who can swap items with each other here, as tabs.
function whoTabs(state, ui, people, sid) {
  if (people.length < 2) return "";
  return `<div class="invwho">${people.map((p) => `<button class="mini ${p.id === sid ? "active" : ""}" data-action="inv-who" data-id="${p.id}"${tip(`Show ${p.name}'s inventory. Combat power ${combatPower(p).toFixed(1)}.`)}>${first(p)}</button>`).join("")}</div>`;
}

function selBar(state, ui, place) {
  if (!ui.invSel) return "";
  const item = itemAt(state, ui.invSel);
  if (!item) return "";
  const from = parseLoc(ui.invSel);
  const st = storageFor(state, place);
  return `<div class="invsel small">Selected: <b>${esc(item.name)}</b>. Click a slot, pocket or pack cell to move it there.
    ${st && from.o !== "armory" && from.o !== "cargo" ? `<button class="mini" data-action="inv-store"${tip(`Put it in ${st.name}`)}>${from.o === "body" ? "Take" : st.o === "armory" ? "Unequip to armory" : "Put in cargo"}</button>` : ""}
    ${GEAR[item.key] && GEAR[item.key].use && from.o !== "body" && ui.inv && !ui.inv.loot ? `<button class="mini" data-action="inv-use"${tip(`${survivorById(state, ui.inv.sid)?.name.split(" ")[0] || "They"} ${GEAR[item.key].useVerb || "use"} it now: ${useText(item.key)}. Used up.`)}>Use</button>` : ""}
    <button class="mini" data-action="inv-cancel">Cancel</button></div>`;
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
  const s = survivorById(state, ui.inv.sid);
  if (!s) { ui.inv = null; return null; }
  const place = personPlace(s);
  const people = placePeople(state, place);
  const readonly = !place;
  const body = doll(state, ui, s, `s:${s.id}`, spriteImg(survivorURL(s, state.seed), 7), { readonly, user: s });
  return `<div class="box wide invbox">
    <div class="spread"><h1>Inventory: ${esc(s.name)}</h1><span class="muted">${esc(placeName(state, place))}</span></div>
    ${ui.invMsg ? `<div class="result small">${esc(ui.invMsg)}</div>` : ""}
    ${readonly ? `<div class="small warn">${esc(s.name.split(" ")[0])} is out of reach: nothing can be changed.</div>` : ""}
    <div class="invcols">
      <div class="invcol">${whoTabs(state, ui, people, s.id)}${body}</div>
      <div class="invcol">${readonly ? "" : storageBox(state, ui, place, s)}</div>
    </div>
    ${selBar(state, ui, place)}
    <div class="small muted" style="margin-top:0.5rem">Click an item, then click where it should go (or drag it). Click a selected item again to send it across: onto ${esc(s.name.split(" ")[0])}, or into storage. A full slot swaps.</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary" data-action="inv-close">Close</button></div>
  </div>`;
}

function bodyPortrait(state, b, body) {
  if (body.sid != null) {
    const s = survivorById(state, body.sid);
    return s ? spriteImg(survivorURL(s, state.seed), 7) : "";
  }
  const u = b.units.find((x) => x.id === body.uid);
  return u ? spriteImg(canvasURL(unitCanvas(state, b, u, cui.salt)), 7, "transform:rotate(-8deg)") : "";
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
      ${h ? doll(state, ui, h, `body:${bi}`, bodyPortrait(state, b, body), { user: s }) : ""}
      <div class="invlabel"${tip("Supplies go straight to the team's found cargo (or the base stock). Click to take.")}>Supplies</div>
      <div class="invgrid">${sups.length ? sups.map(([k, v]) => {
        // Any part of the stack: click for all of it, or 1 / half (sim/inventory.js takeSupply want).
        const n = Math.floor(v), nm = SUPPLIES[k].name.toLowerCase();
        const part = (m, label) => `<button class="mini" data-action="loot-sup" data-i="${bi}" data-key="${k}" data-n="${m}"${tip(`Take ${m} ${nm} (${(SUPPLIES[k].weight * m).toFixed(1)} kg)`)}>${label}</button>`;
        return `<div><div class="islot" data-action="loot-sup" data-i="${bi}" data-key="${k}"${tip(`Take all ${n} ${nm} (${(SUPPLIES[k].weight * v).toFixed(1)} kg), as many as fit`)}><div class="itile"><span class="iico">${SUPPLY_ICON[k] || "▪"}</span><span class="iname">${n} ${esc(SUPPLIES[k].name)}</span></div></div>${n > 1 ? `<div class="row" style="gap:0.15rem;margin-top:0.1rem">${part(1, "1")}${n > 3 ? part(Math.floor(n / 2), "½") : ""}</div>` : ""}</div>`;
      }).join("") : `<span class="small muted">None</span>`}</div>`;
  }
  const you = s ? doll(state, ui, s, `s:${s.id}`, spriteImg(survivorURL(s, state.seed), 7), { user: s }) : `<div class="small muted">Nobody left standing to carry anything.</div>`;
  const r = b.result;
  const got = [...Object.entries(r.loot.supplies).filter(([, n]) => n >= 1).map(([k, n]) => `${Math.floor(n)} ${k}`), ...r.loot.gear.map((g) => g.name)];
  return `<div class="box wide invbox loot">
    <div class="spread"><h1>Loot the bodies</h1><span class="muted">${esc(b.place)} · ${esc(placeName(state, place))}</span></div>
    ${ui.invMsg ? `<div class="result small">${esc(ui.invMsg)}</div>` : ""}
    <div class="invcols three">
      <div class="invcol"><div class="ibodies">${list}</div>${bodyHtml}</div>
      <div class="invcol">${whoTabs(state, ui, people, s ? s.id : null)}${you}</div>
      <div class="invcol">${storageBox(state, ui, place, s)}<div class="small muted" style="margin-top:0.5rem">Taken so far: ${got.length ? esc(got.join(", ")) : "nothing"}</div></div>
    </div>
    ${selBar(state, ui, place)}
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
  if (!cui.lootReq) return;
  const r = cui.lootReq;
  cui.lootReq = null;
  if (!state.combat || !state.combat.raid || state.combat.over) return;
  ui.inv = { raid: true, uid: r.uid, box: r.box };
  ui.invSel = null;
  ui.invMsg = "";
}

const kg = (x) => `${Math.round(x * 10) / 10}`;
function supTile(ui, loc, k, n, extra = "") {
  const sup = SUPPLIES[k];
  if (!sup) return "";
  return `<div class="islot store${ui.invSel === loc ? " sel" : ""}" data-action="inv-click" data-loc="${loc}"${tip(`${Math.floor(n)} ${sup.name.toLowerCase()}, ${kg(sup.weight * n)} kg (${sup.weight} kg each). Take any part of the stack: click it to pick how many (1 to all), then click where they go. Shift+click: all that fit, straight across. Drag: all that fit (Shift when you drop: half, Ctrl: one).${extra}`)}>
    <div class="itile" draggable="true" data-drag="${loc}"><span class="iico">${SUPPLY_ICON[k] || "▪"}</span><span class="iname">${Math.floor(n)} ${esc(sup.name)}</span><span class="ikg">${kg(sup.weight * n)}</span></div></div>`;
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
  if (!b || !b.raid || b.over) { ui.inv = null; return null; }
  const u = b.units.find((x) => x.id === ui.inv.uid && x.side === "player" && !x.dead && !x.left);
  const s = u && survivorById(state, u.sid);
  if (!u || !s) { ui.inv = null; return null; }
  const R = b.raid;
  const box = ui.inv.box != null ? R.containers.find((c) => c.id === ui.inv.box && c.contents) : null;
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
    const w = sups.reduce((a, [k, v]) => a + SUPPLIES[k].weight * v, 0) + box.contents.gear.reduce((a, g) => a + itemLoad(g), 0);
    mid = `<div><div class="spread"><b${tip(box.drop ? "What a fallen teammate carried. Take it home for them." : "")}>${esc(box.label)}</b><span class="small muted">${n} thing${n === 1 ? "" : "s"} · ${kg(w)} kg</span></div>
      <div class="istore" data-action="inv-click" data-loc="${bl}:list" data-drop="${bl}:list"${tip("Drop here to leave it in the container")}>${sups.map(([k, v]) => supTile(ui, `${bl}:sup:${k}`, k, v)).join("")}${gearTiles(ui, box.contents.gear, bl, s) || (sups.length ? "" : `<span class="small muted">Empty.</span>`)}</div>
      ${box.quick ? `<div class="small warn" style="margin-top:0.3rem"${tip(`Rummaged through in a hurry (Quick search): only part of what is inside turned up. A full search turns up the rest, if there is more: ${SEARCH.ap} action, quiet.`)}>Rummaged in a hurry: a full search may turn up more.</div>` : ""}
      <div class="row" style="margin-top:0.4rem"><button class="mini" data-action="rl-takeall"${tip(`Everything that fits on ${first}: supplies carried, small things in pockets, the rest in the pack or carried.`)} ${n ? "" : "disabled"}>Take all</button>${box.quick ? `<button class="mini" data-action="rl-full"${tip(`${first} goes through it properly: ${SEARCH.ap} action, quiet. Whatever the rummage missed turns up here.`)} ${u.ap >= SEARCH.ap && !b.over && b.phase === "player" ? "" : "disabled"}>Search it in full (${SEARCH.ap} action)</button>` : ""}</div></div>`;
  }
  // The vehicle.
  let right = "";
  if (trunk) {
    const tl = `trunk:${p.id}`;
    const keys = [...new Set([...Object.keys(p.cargo.supplies), ...Object.keys(p.supplies)])].filter((k) => SUPPLIES[k]);
    const sups = keys.map((k) => [k, Math.floor(Math.max(0, p.cargo.supplies[k] || 0)) + Math.floor(Math.max(0, p.supplies[k] || 0))]).filter(([, v]) => v >= 1);
    right = `<div${mid ? ' style="margin-top:0.9rem"' : ""}><div class="spread"><b${tip(trunk.bike ? "The bikes' racks: 15 kg each. What does not fit on them is shared out among the people." : "The team's supplies and cargo ride in the car. It also has to take home everything your people carry, so their loads count against what it has left.")}>${esc(trunk.name)}</b><span class="small ${trunk.space < 2 ? "warn" : "muted"}">${kg(trunk.cap - Math.max(0, trunk.space))}/${kg(trunk.cap)} kg · ${kg(Math.max(0, trunk.space))} free</span></div>
      ${loadBar(trunk.cap - Math.max(0, trunk.space), trunk.cap)}
      <div class="istore" data-action="inv-click" data-loc="${tl}:list" data-drop="${tl}:list"${tip("Drop here to put it in the vehicle")}>${sups.map(([k, v]) => supTile(ui, `${tl}:sup:${k}`, k, v, " From the vehicle: the team's packed supplies and what it found.")).join("")}${gearTiles(ui, p.cargo.gear, tl, s) || (sups.length ? "" : `<span class="small muted">Empty.</span>`)}</div>
      <div class="row" style="margin-top:0.4rem"><button class="mini" data-action="rl-stash"${tip(`Everything ${first} carries loose goes in the vehicle (what fits). What is worn, held, in pockets and the pack stays on them.`)} ${hsup.length || (u.haul && u.haul.gear.length) ? "" : "disabled"}>Unload what ${first} carries</button></div></div>`;
  } else if (p && R.vehicleZone >= 0) {
    right = `<div${mid ? ' style="margin-top:0.9rem"' : ""}><b>Vehicle</b><div class="small muted" style="margin-top:0.3rem">Parked in the entry zone. Walk ${first} there (or next to it) and press N to load it.</div></div>`;
  }
  const around = mid || right ? `<div class="invcol">${mid}${right}</div>` : "";
  const cols = [left, mateCol, around].filter(Boolean);
  const found = [...Object.entries(R.found).filter(([, n]) => n >= 1).map(([k, n]) => `${Math.floor(n)} ${k}`), ...R.foundGear.map((g) => g.name)];
  const SL = ui.invSel ? parseRaidLoc(ui.invSel) : null;
  const sel = SL ? (SL.slot === "sup" ? SUPPLIES[SL.i]?.name : SL.o === "s" ? itemAt(state, ui.invSel)?.name : raidItemAt(state, b, ui.invSel)?.name) || "" : "";
  return `<div class="box wide invbox${cols.length > 2 ? " loot" : ""}">
    <div class="spread"><h1>${box ? "Search" : "Vehicle"}: ${esc(s.name)}</h1><span class="muted">${esc(b.place)}</span></div>
    <div class="result small"${ui.invMsg ? "" : ' style="visibility:hidden"'}>${ui.invMsg ? esc(ui.invMsg) : "&nbsp;"}</div>
    <div class="invcols${cols.length > 2 ? " three" : ""}">${cols.join("")}</div>
    ${SL && SL.slot === "sup" ? qtyBar(state, ui, b, u) : sel ? `<div class="invsel small">Selected: <b>${esc(sel)}</b>. Click where it should go: a slot, a pocket or pack cell, Carried${mates.length ? ", a teammate" : ""}${box ? ", the container" : ""}${trunk ? ", the vehicle" : ""}. <button class="mini" data-action="inv-cancel">Cancel</button></div>` : ""}
    <div class="small muted" style="margin-top:0.5rem">Drag things where they should go (or click one, then where). Click a thing twice to send it across. The first ${HAUL.free} kg a turn are free to haul, then ${HAUL.per} kg an action; handing things to a teammate next to you is free.${found.length ? ` Found so far: ${esc(found.join(", "))}.` : ""}</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary" data-action="inv-close">Done</button></div>
  </div>`;
}

// One person in the search window: their slots (paper doll), their weight against their max, what they carry loose.
function personCol(state, ui, b, u, s, isMe) {
  const first = esc(s.name.split(" ")[0]);
  const me = personalLoad(state, u);
  const p = raidParty(state, b);
  const weightLine = `<div class="small ${me.room < 0 ? "danger" : ""}"${tip(`Worn and held ${kg(me.worn)} kg${me.share ? `, their share of the team's packed supplies and cargo ${kg(me.share)} kg (on foot the team shares it out)` : ""}, carried loose ${kg(me.haul)} kg, of a ${me.max} kg max load (40, 28 with a Bad Back, + the pack and Packrat). ${BANDS_HELP}`)}><b>${kg(me.load)}/${me.max} kg</b> · ${kg(Math.max(0, me.room))} kg free</div>${loadBar(me.load, me.max)}`;
  const dollHtml = doll(state, ui, s, `s:${s.id}`, spriteImg(survivorURL(s, state.seed), isMe ? 6 : 5), { user: s, weightLine });
  const hl = `haul:${u.id}`;
  const hsup = Object.entries(u.haul ? u.haul.sup : {}).filter(([, v]) => v >= 1);
  return `${dollHtml}<div class="invlabel"${tip(`Finds ${first} carries loose (bags, arms). They count against ${first}'s max load and come home with ${first}; if ${first} bleeds out they drop where ${first} falls.${p && b.raid.vehicleZone >= 0 ? ` Put them in the vehicle to keep them safe and free ${first} up.` : ""}`)}>Carried (${kg(me.haul)} kg)</div>
    <div class="istore" data-action="inv-click" data-loc="${hl}:list" data-drop="${hl}:list"${tip(`Drop here: ${first} carries it`)}>${hsup.map(([k, v]) => supTile(ui, `${hl}:sup:${k}`, k, v)).join("")}${gearTiles(ui, u.haul ? u.haul.gear : [], hl, s) || (hsup.length ? "" : `<span class="small muted">Nothing. Drop finds here.</span>`)}</div>`;
}

// ---------- splitting a supply stack (sim/raidloot.js raidMove qty, supplyFit) ----------
// A selected stack shows how many to move: ui.invQty (null: all of it). 1, −, the number, +, half, all; and how many
// fit where a second click sends them. Then a click on a place moves that many (as many of them as fit).
const stackOf = (state, ui, b, loc) => supplyFit(state, ui.inv.uid, loc, loc).have; // a move onto itself: just the count
export const pickedQty = (ui, have) => Math.max(1, Math.min(have, ui.invQty == null ? have : ui.invQty));
function whereTo(state, b, u, to) {
  const T = parseRaidLoc(to), first = esc(u.name.split(" ")[0]);
  if (T.o === "haul") return T.id === u.id ? `on ${first} (carried)` : "on the teammate";
  if (T.o === "trunk") return "in the vehicle";
  if (T.o === "rbox") return "back in the container";
  return "there";
}
function qtyBar(state, ui, b, u) {
  const sel = ui.invSel;
  const k = parseRaidLoc(sel).i;
  const have = stackOf(state, ui, b, sel);
  if (!have || !SUPPLIES[k]) return "";
  const q = pickedQty(ui, have);
  const to = quickTarget(state, b, u.id, sel, ui.inv.box);
  const f = supplyFit(state, u.id, sel, to);
  const name = esc(SUPPLIES[k].name.toLowerCase());
  const b1 = (v, label, t, off = false) => `<button class="mini" data-action="rl-qty" data-v="${v}"${tip(t)} ${off ? "disabled" : ""}>${label}</button>`;
  const fitTxt = f.n ? `${f.n} fit ${whereTo(state, b, u, to)} now (${kg(f.n * SUPPLIES[k].weight)} kg)` : esc(f.err || "none fit there now");
  return `<div class="invsel small">Selected: <b>${have} ${name}</b>. Take
    ${b1("one", "1", "Just one", q === 1)}${b1("dec", "−", "One fewer", q <= 1)}
    <input type="number" class="qty" min="1" max="${have}" step="1" value="${q}" data-action="rl-qtyset" style="width:3.6em"${tip(`How many of the ${have} to move (1 to all)`)}>
    ${b1("inc", "+", "One more", q >= have)}${b1("half", "½", `Half (${Math.max(1, Math.floor(have / 2))})`)}${b1("all", `All ${have}`, "The whole stack (as many of it as fit)", q === have)}${f.n && f.n < have ? b1("fit", `What fits (${f.n})`, `As many as fit ${whereTo(state, b, u, to)} now`, q === f.n) : ""}
    <span class="muted"${tip("Only what fits moves: each person's max load, the vehicle's room, and the hauling time left this turn. The rest stays where it is.")}>· ${fitTxt}.</span>
    Then click where they go (or the stack again: ${whereTo(state, b, u, to)}). <button class="mini" data-action="inv-cancel">Cancel</button></div>`;
}

// ev: Shift+click on a supply stack sends all of it that fits straight across.
function raidClick(state, ui, loc, ev = null) {
  const b = state.combat;
  const uid = ui.inv.uid;
  const sel = ui.invSel;
  const L = parseRaidLoc(loc);
  const has = (str) => { const x = parseRaidLoc(str); return x.slot === "sup" || (x.o === "s" ? !!itemAt(state, str) : !!raidItemAt(state, b, str)); };
  const qtyOf = (str) => (parseRaidLoc(str).slot === "sup" && str === sel ? pickedQty(ui, stackOf(state, ui, b, str)) : Infinity);
  if (ev && ev.shiftKey && L.slot === "sup" && sel !== loc) {
    ui.invMsg = raidMove(state, uid, loc, quickTarget(state, b, uid, loc, ui.inv.box));
    ui.invSel = null;
    return;
  }
  const pick = (str) => { ui.invSel = str; ui.invQty = null; }; // a new stack: all of it until changed
  if (!sel) { if (L.slot !== "list" && has(loc)) pick(loc); return; }
  if (sel === loc) {
    ui.invMsg = raidMove(state, uid, loc, quickTarget(state, b, uid, loc, ui.inv.box), qtyOf(loc));
    ui.invSel = null;
    return;
  }
  // A thing in a list clicked as a target means that list; another thing in the same list is picked instead.
  const F = parseRaidLoc(sel);
  if (L.o !== "s" && F.o === L.o && F.id === L.id) { if (L.slot !== "list" && has(loc)) pick(loc); else ui.invSel = null; return; }
  ui.invMsg = raidMove(state, uid, sel, L.o === "s" ? loc : `${L.o}:${L.id}:list`, qtyOf(sel));
  ui.invSel = null;
}

// ---------- actions (wired in main.js) ----------
function clickLoc(state, ui, loc, ev = null) {
  if (ui.inv && ui.inv.raid) return raidClick(state, ui, loc, ev);
  const sel = ui.invSel;
  const to = parseLoc(loc);
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

// half (Shift on the drop): half a supply stack; one (Ctrl): one of it. Dragging the selected stack moves the number
// picked for it (the selection bar); any other stack: all of it that fits.
export function invDrop(state, ui, from, to, half = false, one = false) {
  if (!ui.inv) return;
  if (ui.inv.raid) {
    if (!/^(s|rbox|haul|trunk):\d+:/.test(from)) return; // a drag of selected text, not of a thing
    const T = parseRaidLoc(to), F = parseRaidLoc(from);
    let qty = Infinity;
    if (F.slot === "sup") {
      const n = stackOf(state, ui, state.combat, from);
      if (one) qty = 1;
      else if (half) qty = Math.max(1, Math.floor(n / 2));
      else if (from === ui.invSel && n) qty = pickedQty(ui, n);
    }
    ui.invMsg = raidMove(state, ui.inv.uid, from, T.o === "s" ? to : `${T.o}:${T.id}:list`, qty);
    ui.invSel = null;
    return;
  }
  const t = parseLoc(to);
  ui.invMsg = moveItem(state, from, (t.o === "armory" || t.o === "cargo") ? `${t.o}:${t.id}:list` : to);
  ui.invSel = null;
}

export const INV_ACTIONS = {
  "inv-open": (state, ui, d) => { ui.inv = { sid: Number(d.id), loot: false }; ui.invSel = null; ui.invMsg = ""; },
  "inv-close": (state, ui) => { ui.inv = null; ui.invSel = null; ui.invMsg = ""; },
  "inv-who": (state, ui, d) => { ui.inv.sid = Number(d.id); ui.invSel = null; },
  "inv-click": (state, ui, d, ev) => clickLoc(state, ui, d.loc, ev),
  "inv-cancel": (state, ui) => { ui.invSel = null; },
  "inv-store": (state, ui) => { if (ui.invSel) ui.invMsg = toStorage(state, ui.invSel); ui.invSel = null; },
  "inv-use": (state, ui) => { if (ui.invSel && ui.inv) ui.invMsg = useItemOn(state, ui.inv.sid, ui.invSel); ui.invSel = null; }, // sim/comforts.js
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
  "rl-takeall": (state, ui) => {
    if (!ui.inv || !ui.inv.raid || ui.inv.box == null) return;
    const r = raidTakeAll(state, ui.inv.uid, ui.inv.box);
    ui.invMsg = `${r.got.length ? `Took ${r.got.join(", ")}.` : "Nothing taken."}${r.left ? (r.outOfTime ? " Out of time for the rest this turn: end the turn and come back." : ` ${r.left} thing${r.left === 1 ? "" : "s"} did not fit.`) : ""}`;
    ui.invSel = null;
  },
  // How many of the selected supply stack to move (qtyBar).
  "rl-qty": (state, ui, d) => {
    if (!ui.inv || !ui.inv.raid || !ui.invSel || parseRaidLoc(ui.invSel).slot !== "sup") return;
    const have = stackOf(state, ui, state.combat, ui.invSel);
    if (!have) return;
    const q = pickedQty(ui, have);
    const fit = () => supplyFit(state, ui.inv.uid, ui.invSel, quickTarget(state, state.combat, ui.inv.uid, ui.invSel, ui.inv.box)).n || 1;
    ui.invQty = { one: 1, dec: q - 1, inc: q + 1, half: Math.floor(have / 2), all: have, fit: d.v === "fit" ? fit() : q }[d.v] ?? q;
    ui.invQty = Math.max(1, Math.min(have, ui.invQty));
  },
  // The full search of a container only rummaged through (sim/search.js): 1 action, the rest turns up.
  "rl-full": (state, ui) => {
    const b = state.combat;
    if (!ui.inv || !ui.inv.raid || ui.inv.box == null || !b) return;
    const err = combatAct(state, { type: "search", unit: ui.inv.uid, box: ui.inv.box, open: true });
    const box = b.raid && b.raid.containers.find((c) => c.id === ui.inv.box);
    const n = box && box.contents ? box.contents.gear.length + Object.values(box.contents.sup).filter((v) => v >= 1).length : 0;
    ui.invMsg = err || `Searched in full: ${n ? `${n} thing${n === 1 ? "" : "s"} in it now` : "nothing more"}.`;
    ui.invSel = null;
  },
  "rl-mate": (state, ui, d) => { if (ui.inv && ui.inv.raid) { ui.inv.mate = Number(d.id); ui.invSel = null; } },
  "rl-stash": (state, ui) => {
    if (!ui.inv || !ui.inv.raid) return;
    const r = stashAll(state, ui.inv.uid);
    ui.invMsg = `${r.put.length ? `Put ${r.put.join(", ")} in the vehicle.` : "Nothing put in."}${r.left ? ` ${r.left} thing${r.left === 1 ? "" : "s"} did not fit.` : ""}`;
    ui.invSel = null;
  },
};

// Typed in (wired in main.js with the other change handlers): the number of a stack to move (qtyBar).
export const INV_CHANGE = {
  "rl-qtyset": (state, ui, el) => {
    if (!ui.inv || !ui.invSel) return;
    const have = stackOf(state, ui, state.combat, ui.invSel);
    ui.invQty = Math.max(1, Math.min(have || 1, Math.floor(Number(el.value) || 1)));
  },
};
