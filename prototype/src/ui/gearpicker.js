// The starting-gear catalogue (2026-10-27, the user's request: "Improve the UI to select gear to start with for
// survivors and backs of vehicles. Currently it's just a really long dropdown. I want sprite, cost, name, hover for
// description. Make it kinda like the RimWorld mod EdB Prepare Carefully but for handling starting equipment and gear and
// inventories"). A list you browse in place of the long <select>s: category chips (All first, then the categories its
// things are in, with how many), a find box (name, category, calibre), a sort (A–Z, points, kg: again flips it) and a
// scrolling list of rows, each a <button>: its picture (ui/itemart.js; a gun ui/gunart.js), its name with a gun's calibre
// and capacity, its kg and its points as the window prices it, its description in the hover. A row the window would
// refuse or that puts them over (no room, no spot it fits, over the points left, at the item cap) is dimmed with the
// reason in its hover; it is still a click, and the window's own rules (ui/startgear.js SG_CHANGE) say no with the reason.
//   entries  the window builds them ({ key, name, cat, catName, kg, pts, bit?, tip?, why?, on?, pic?, rank? }), so the same
//            list shows things (gearEntry), supplies and materials, or rounds by calibre (the vehicle's back window)
//   view     what the player set (chip, find text, sort, the back window's mode), per catalogue (ns: "gear" the worn
//            slots, "carry", "trunk"), for the session: kept here, not in the world, so a rebuild keeps it
//   pictures a style sheet of one class a picture (gearPic), so a long list is light to redraw
//   wiring   GP_ACTIONS (clicks) are in ui/startgear.js SG_ACTIONS, GP_INPUT (the find box as you type) in main.js's
//            PANEL_INPUT; the box is data-keep (ui/panelfold.js: focus and caret kept through a redraw), the list
//            data-keepscroll (its scroll kept while the same view is redrawn)
// Used by ui/startgear.js startGearEditor (a survivor's slots and what they carry) and vehicleSection (a vehicle's back).
// tools/gearpickertest.js.
import { GEAR } from "../sim/data.js";
import { gunInfo } from "../sim/startgear.js";
import { itemArtURL } from "./itemart.js";
import { isGunKey, gunThumb } from "./gunart.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const r1 = (v) => Math.round(v * 10) / 10;

// Item categories as the catalogues group them (anything else after these, by its own name).
export const CATS = [
  ["melee", "Melee"], ["pistol", "Pistols"], ["shotgun", "Shotguns"], ["rifle", "Rifles"], ["automatic", "Automatic weapons"], ["bow", "Bows and crossbows"],
  ["explosive", "Launchers, grenades and throwables"], ["armor", "Armour"], ["packs", "Packs and rigs"], ["medical", "Medical"], ["tools", "Tools"],
  ["electronics", "Electronics"], ["optics", "Optics"], ["ammo", "Ammunition (boxes)"], ["gunmod", "Magazines and gun parts"], ["camp", "Camp"],
  ["manuals", "Manuals"], ["books", "Books"], ["containers", "Cases"], ["defence", "Defences"],
];
export const CAT_NAME = Object.fromEntries(CATS);
export const catOrder = (c) => { const i = CATS.findIndex(([k]) => k === c); return i < 0 ? CATS.length : i; };
export const catName = (c) => CAT_NAME[c] || String(c || "other").replace(/^./, (x) => x.toUpperCase());
// A chip's short name ("Launchers, grenades and throwables" → "Launchers").
const chipName = (n) => n.split(/,| and | \(/)[0];

// ---------- the view (per catalogue, this session) ----------
const views = new Map();
/** @param {string} ns @returns {{ tab: string, q: string, sort: string, desc: boolean, mode: string }} */
export function pickerView(ns) {
  let v = views.get(ns);
  if (!v) { v = { tab: "", q: "", sort: "name", desc: false, mode: "" }; views.set(ns, v); }
  return v;
}
// Every view back to its default (the tools).
export function resetPickers() { views.clear(); }

// ---------- pictures ----------
// A thing's picture: a gun as it comes (ui/gunart.js), anything else its drawing (ui/itemart.js; kind "supply" a
// supply's); "" with neither (no canvas in node). Each picture is a class of one style sheet, made the first time it is
// asked for (a rule a picture: .gpa3 { background-image: url(data:…) }), so a list of hundreds of rows is a few hundred
// bytes a row and each picture is decoded once, not an <img> with its data URL in every row at every redraw.
const picIds = new Map();
let sheet = null;
const hasDoc = typeof document !== "undefined" && !!document.createElement && !!document.head;
function picClass(id, url) {
  if (picIds.has(id)) return picIds.get(id);
  let cls = "";
  if (url && hasDoc) {
    if (!sheet) { const el = document.createElement("style"); el.id = "gp-art"; document.head.appendChild(el); sheet = el; }
    cls = `gpa${picIds.size}`;
    sheet.appendChild(document.createTextNode(`.${cls}{background-image:url("${url}")}\n`));
  }
  picIds.set(id, cls);
  return cls;
}
export function gearPic(k, kind = "gear") {
  if (kind === "gear" && isGunKey(k)) { const t = gunThumb({ key: k }); const c = picClass(`gun:${k}`, t && t.url); if (c) return `<span class="gpart ${c}"></span>`; }
  const c = picClass(`${kind}:${k}`, itemArtURL(k, kind));
  return c ? `<span class="gpart ${c}"></span>` : "";
}

// ---------- entries ----------
// One thing of GEAR as a row: price(k) its points in this window; why its refusal or warning ("" none); on: what is there now.
export function gearEntry(k, price, why = "", on = false) {
  const d = GEAR[k], g = gunInfo(k), w = d.weight ?? 1;
  const kgs = `${w} kg${d.inserts ? " + plates" : ""}`;
  return {
    key: k, name: d.name, cat: d.cat || "other", catName: catName(d.cat || "other"), kg: w, kgText: kgs, pts: price(k),
    bit: g ? g.text : "", find: g ? `${g.calName} ${g.cal || ""}` : "",
    tip: `${d.name}${g ? ` (${g.text})` : ""}: ${d.desc || ""}${g ? ` ${g.long}` : ""} ${kgs}, ${price(k)} points.`,
    why, on,
  };
}

// ---------- the catalogue ----------
const SORTS = [["name", "A–Z", "By name"], ["pts", "Pts", "By points"], ["kg", "Kg", "By weight"]];
const MAX_ROWS = 800; // a list longer than that (no catalogue is yet): the rest behind a chip or the find box
/**
 * The catalogue's HTML.
 * @param {any[]} entries see above
 * @param {{ ns: string, act: string, attrs?: string, verb?: string, head?: string, empty?: string, modes?: [string, string, string][], kind?: string }} o
 *   act: the row's data-action (data-k: the entry's key, plus attrs); verb: what a click does, for the hover ("equip it");
 *   head: HTML for the tool bar (the × box); modes: [id, label, tip] tabs over the list (the back window: Things,
 *   Supplies, Rounds), the one shown pickerView(ns).mode; kind: "supply" for supplies' pictures.
 */
export function gearPicker(entries, o) {
  const ns = o.ns, v = pickerView(ns);
  const q = v.q.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
  const found = entries.filter((e) => !words.length || words.every((t) => `${e.name} ${e.catName} ${e.cat} ${e.bit || ""} ${e.find || ""}`.toLowerCase().includes(t)));
  const counts = new Map();
  for (const e of found) counts.set(e.cat, (counts.get(e.cat) || 0) + 1);
  const cats = [...counts.keys()].sort((a, b) => catOrder(a) - catOrder(b) || catNameOf(entries, a).localeCompare(catNameOf(entries, b)));
  const tab = v.tab && counts.has(v.tab) ? v.tab : ""; // a chip with nothing under it (another slot, a find): All
  const shown = found.filter((e) => !tab || e.cat === tab);
  const dir = v.desc ? -1 : 1;
  const byName = (a, b) => a.name.localeCompare(b.name);
  const cmp = v.sort === "pts" ? (a, b) => dir * (a.pts - b.pts) || byName(a, b) : v.sort === "kg" ? (a, b) => dir * (a.kg - b.kg) || byName(a, b) : (a, b) => dir * byName(a, b);
  // A–Z on All: under each category's head, the categories in their order (as the old drop-downs grouped them).
  const grouped = !tab && v.sort === "name" && cats.length > 1;
  const list = shown.slice().sort((a, b) => (a.rank || 0) - (b.rank || 0) || (grouped ? catOrder(a.cat) - catOrder(b.cat) || a.catName.localeCompare(b.catName) : 0) || cmp(a, b));
  const rows = [];
  let last = null;
  for (const e of list.slice(0, MAX_ROWS)) {
    if (grouped && e.cat !== last) { rows.push(`<div class="gpgrp">${esc(e.catName)}</div>`); last = e.cat; }
    const pic = e.pic != null ? e.pic : gearPic(e.key, o.kind || "gear");
    const t = `${e.tip || e.name}${e.why ? ` ${e.why}` : ""}${o.verb ? ` Click to ${o.verb}.` : ""}`;
    rows.push(`<button class="gprow${e.why ? " dim" : ""}${e.on ? " on" : ""}" data-action="${o.act}" data-k="${esc(e.key)}"${o.attrs ? ` ${o.attrs}` : ""}${tip(t)}><span class="gppic">${pic}</span><span class="gpname">${esc(e.name)}${e.bit ? ` <span class="gpbit">${esc(e.bit)}</span>` : ""}${!tab && !grouped ? ` <span class="gpcat">${esc(e.catName)}</span>` : ""}</span><span class="gpkg">${esc(e.kgText != null ? e.kgText : `${r1(e.kg)} kg`)}</span><span class="gppts">${e.pts} pts</span></button>`);
  }
  const more = list.length > MAX_ROWS ? `<div class="small muted gpmore">${list.length - MAX_ROWS} more: pick a category or type to find them.</div>` : "";
  const none = !list.length ? `<div class="small muted gpmore">${entries.length ? `Nothing matches${q ? ` "${esc(v.q)}"` : ""}.` : esc(o.empty || "Nothing to add.")}</div>` : "";
  const chip = (c, label, n) => `<button class="mini gpchip${tab === c ? " active" : ""}" data-action="gp-tab" data-ns="${ns}" data-c="${esc(c)}"${tip(c ? `Show only ${catNameOf(entries, c).toLowerCase()} (again: everything)` : "Show every category")}>${esc(label)} <span class="muted">${n}</span></button>`;
  const chips = cats.length > 1 || tab ? `<div class="gpchips">${chip("", "All", found.length)}${cats.map((c) => chip(c, chipName(catNameOf(entries, c)), counts.get(c))).join("")}</div>` : "";
  const sorts = SORTS.map(([s, label, t]) => `<button class="mini gpsort${v.sort === s ? " active" : ""}" data-action="gp-sort" data-ns="${ns}" data-s="${s}"${tip(`${t}${v.sort === s ? ` (${v.desc ? "down" : "up"}: click again to flip it)` : ""}`)}>${label}${v.sort === s ? (v.desc ? " ▼" : " ▲") : ""}</button>`).join("");
  const modes = o.modes && o.modes.length > 1 ? `<div class="gpmodes">${o.modes.map(([m, label, t]) => `<button class="mini${(v.mode || o.modes[0][0]) === m ? " active" : ""}" data-action="gp-mode" data-ns="${ns}" data-m="${m}"${tip(t)}>${esc(label)}</button>`).join("")}</div>` : "";
  const key = `gp-${ns}-${v.mode}-${tab}-${v.sort}-${v.desc ? 1 : 0}-${q}-${o.attrs || ""}`; // the same view redrawn keeps its scroll
  return `<div class="gpick">${modes}
    <div class="gpbar"><input class="gpq" type="search" placeholder="Find: name, type, calibre…" value="${esc(v.q)}" data-action="gp-q" data-ns="${ns}" data-keep="gp-q-${ns}" spellcheck="false" autocomplete="off"${tip("Type to find a thing by its name, its category (rifle, armour, medical…) or its calibre (9mm, 5.56…)")}>${v.q ? `<button class="mini" data-action="gp-clear" data-ns="${ns}"${tip("Clear the find box")}>×</button>` : ""}<span class="gpsorts">${sorts}</span>${o.head || ""}</div>
    ${chips}
    <div class="gplist" data-keepscroll="${esc(key)}">${rows.join("")}${more}${none}</div></div>`;
}
const catNameOf = (entries, c) => { const e = entries.find((x) => x.cat === c); return e ? e.catName : catName(c); };

// The current target's mode ("" the first).
export const pickerMode = (ns, modes) => { const m = pickerView(ns).mode; return modes.some(([id]) => id === m) ? m : modes[0][0]; };

// ---------- clicks and typing (ui/startgear.js SG_ACTIONS has the clicks, main.js PANEL_INPUT the typing) ----------
export const GP_ACTIONS = {
  "gp-tab": (state, ui, d) => { const v = pickerView(d.ns); v.tab = v.tab === d.c ? "" : d.c || ""; return false; },
  "gp-sort": (state, ui, d) => { const v = pickerView(d.ns); if (v.sort === d.s) v.desc = !v.desc; else { v.sort = SORTS.some(([s]) => s === d.s) ? d.s : "name"; v.desc = false; } return false; },
  "gp-clear": (state, ui, d) => { pickerView(d.ns).q = ""; return false; },
  "gp-mode": (state, ui, d) => { const v = pickerView(d.ns); if (v.mode !== d.m) { v.mode = d.m || ""; v.tab = ""; v.q = ""; } return false; },
};
// The find box as you type (main.js PANEL_INPUT: a redraw a key, the box keeping its focus). Not a change handler: a
// change fires as the box is taken out of the page by that redraw (its blur), and a redraw then would write over the one
// under way.
export const GP_INPUT = {
  "gp-q": (state, ui, el) => { pickerView(el.dataset.ns || "gear").q = String(el.value || "").slice(0, 40); return false; },
};
