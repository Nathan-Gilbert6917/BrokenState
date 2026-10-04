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
import {
  EQUIP_SLOTS, SLOT_NAMES, POCKETS, ensureInv, packOf, packSize, armorPower, itemAt, parseLoc, moveItem, quickMove, toStorage,
  personPlace, battlePlace, storageFor, battleBodies, bodyHolder, bodyEmpty, takeSupply, takeAllBody, takeAllBodies, itemLoad, allItems,
} from "../sim/inventory.js";
import { survivorURL, spriteImg, canvasURL, unitCanvas } from "./sprites.js";
import { cui } from "./combat.js";
import { shortName } from "./names.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => esc(shortName(s)); // first name, with a last initial when two people share it

// ---------- item tiles ----------
const GUNS = new Set(["pistol", "shotgun", "huntrifle", "ar", "pipegun"]);
const TOOL_ICON = { bandagekit: "✚", surgkit: "✚", milradio: "📻", nvg: "🥽", crowbar: "🔧", waterfilter: "💧", bicycle: "🚲" };
const SLOT_ICON = { weapon: "🗡", tool: "🧰", head: "⛑", armor: "🦺", arms: "🧤", legs: "🦵", backpack: "🎒" };
const SUPPLY_ICON = { food: "🥫", water: "💧", fuel: "⛽", meds: "✚", ammo: "⁍", parts: "⚙", scrap: "🔩" };
function icon(key) {
  const d = GEAR[key];
  if (key === "crossbow") return "🏹";
  if (GUNS.has(key)) return "🔫";
  return TOOL_ICON[key] || SLOT_ICON[d.slot] || (d.book ? "📖" : "▪");
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
  else bits.push(`power ${d.power}${d.req && d.skill ? `, needs ${SKILL_NAMES[d.skill]} ${d.req}` : ""}`);
  if (s && d.skill && d.req) {
    const e = gearEffect(s, item);
    if (e.gap > 0) bits.push(e.usable ? `${s.name.split(" ")[0]} is ${e.gap} below the skill: weaker${e.damageChance ? ", may damage it" : ""}` : `${s.name.split(" ")[0]} cannot use it`);
  }
  bits.push(`value ${d.value}`);
  if ((item.quality || 1) < 1) bits.push(`condition ${Math.round(item.quality * 100)}%`);
  const dur = itemDur(item);
  if (dur != null) bits.push(`makeshift: ${dur} of ${d.dur} ${durUnit(item.key)} left`);
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
function doll(state, ui, holder, prefix, portrait, { readonly = false, user = null } = {}) {
  ensureInv(holder);
  const box = (slot) => slotBox(state, ui, `${prefix}:${slot}`, SLOT_NAMES[slot], user, readonly);
  const pk = packOf(holder);
  const arm = armorPower(holder);
  // What they wear and carry (sim/load.js); with a team, their share of its supplies and cargo too.
  let weight = "";
  if (holder.traits) {
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
    head = `<div class="spread"><b${tip("Found cargo the team carries, by weight (a pack also weighs what is in it). It is shared out with the packed supplies among the team (sim/load.js). Moving things between the cargo and the people weighs nothing extra: it is the same team.")}>Team cargo</b><span class="small ${load > cap ? "danger" : "muted"}"${tip("Supplies and cargo against what the team can carry on top of what it wears (and its vehicle)")}>load ${Math.round(load)}/${Math.round(cap)} kg</span></div>
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
      <div class="invgrid">${sups.length ? sups.map(([k, v]) => `<div class="islot" data-action="loot-sup" data-i="${bi}" data-key="${k}"${tip(`Take ${Math.floor(v)} ${SUPPLIES[k].name.toLowerCase()} (${(SUPPLIES[k].weight * v).toFixed(1)} kg)`)}><div class="itile"><span class="iico">${SUPPLY_ICON[k] || "▪"}</span><span class="iname">${Math.floor(v)} ${esc(SUPPLIES[k].name)}</span></div></div>`).join("") : `<span class="small muted">None</span>`}</div>`;
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

// ---------- actions (wired in main.js) ----------
function clickLoc(state, ui, loc) {
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

export function invDrop(state, ui, from, to) {
  if (!ui.inv) return;
  const t = parseLoc(to);
  ui.invMsg = moveItem(state, from, (t.o === "armory" || t.o === "cargo") ? `${t.o}:${t.id}:list` : to);
  ui.invSel = null;
}

export const INV_ACTIONS = {
  "inv-open": (state, ui, d) => { ui.inv = { sid: Number(d.id), loot: false }; ui.invSel = null; ui.invMsg = ""; },
  "inv-close": (state, ui) => { ui.inv = null; ui.invSel = null; ui.invMsg = ""; },
  "inv-who": (state, ui, d) => { ui.inv.sid = Number(d.id); ui.invSel = null; },
  "inv-click": (state, ui, d) => clickLoc(state, ui, d.loc),
  "inv-cancel": (state, ui) => { ui.invSel = null; },
  "inv-store": (state, ui) => { if (ui.invSel) ui.invMsg = toStorage(state, ui.invSel); ui.invSel = null; },
  "loot-open": (state, ui) => { ui.inv = { sid: null, loot: true, body: null }; ui.invSel = null; ui.invMsg = ""; },
  "loot-body": (state, ui, d) => { ui.inv.body = Number(d.i); ui.invSel = null; },
  "loot-sup": (state, ui, d) => { ui.invMsg = takeSupply(state, Number(d.i), d.key); },
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
};
