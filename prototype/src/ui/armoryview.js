// The armory's stored gear as a list you can find things in (2026-10-10, the user: "very hard to find items in the
// badge list. Have them grouped by type and add image of item with a card and a way to see a compact view").
//   groups   every item falls in one type group (Guns, Magazines, Ammo, Melee, Armour...), guns again by class
//            (pistols, revolvers, SMGs, rifles, shotguns...); each group folds under its header, with its count
//   cards    the default: a card an item, its picture (a gun drawn as fitted, ui/gunart.js; a magazine or a part drawn
//            from its gun-builder look; the rest an icon), its name, one stat line (rounds in a gun, condition, how
//            many) and who has it (when the view shows what people carry too)
//   compact  dense rows: icon, name, stat line, weight. Remembered in this browser (localStorage, when it works)
//   finding  a find box (name, type, who), and type chips that show one group
// Used by the base's Armory tab (ui/ui.js baseArmory) and the storage box of the inventory windows (ui/inventory.js
// storageBox: the base armory, a team's cargo). The callers wrap each item (cell): the inventory window keeps its
// clicks, drags and drops (data-action="inv-click", data-loc, data-drop, data-drag), so nothing here moves anything.
import { GEAR } from "../sim/data.js";
import { WEAPONS } from "../sim/combat.js";
import { MAGAZINES, CLIPS, CALIBRE_CLIPS } from "../sim/data-kit.js";
import { LIGHTS } from "../sim/lights.js";
import { itemDur, itemDurMax } from "../sim/crafting.js";
import { itemLoad, SLOT_NAMES } from "../sim/inventory.js";
import { stackLabel, countOf, isRoundItem, amountOf } from "../sim/itemstack.js";
import { isHelmetPart } from "../sim/helmets.js";
import { isGunKey, gunIconHtml, PART_ART } from "./gunart.js";
import { lookOf } from "./gunparts.js";
import { painter, toCanvas } from "./sprites.js";
import { slotOfPart } from "./gunbuilder.js";
import { gunRoundsLabel } from "./itemlabels.js"; // the rounds in a gun or a magazine (gun-mags: the real count)
import { rowName } from "../sim/itemnames.js"; // row names: "… magazine", rounds "— loose"

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const kg1 = (x) => Math.round(x * 10) / 10;

// ---------- the groups ----------
// [id, name, icon], in the order they are listed.
export const ARMORY_GROUPS = [
  ["guns", "Guns", "🔫"], ["mags", "Magazines and loaders", "▮"], ["ammo", "Ammo", "⁍"], ["melee", "Melee", "🗡"],
  ["armour", "Armour and helmets", "🦺"], ["clothing", "Clothing and camp kit", "🧥"], ["bags", "Bags, rigs and cases", "🎒"],
  ["lights", "Lights and optics", "🔦"], ["medical", "Medical", "✚"], ["tools", "Tools and radios", "🧰"],
  ["attach", "Gun parts and attachments", "⚙"], ["throw", "Grenades and throwables", "💣"], ["defence", "Base defences", "🚧"],
  ["books", "Books", "📖"], ["trade", "Valuables and comforts", "💍"], ["other", "Other", "▪"],
];
const GROUP = Object.fromEntries(ARMORY_GROUPS.map(([id, name, icon], i) => [id, { id, name, icon, i }]));
// Guns by class, in this order.
export const GUN_SUBS = [["pistol", "Pistols"], ["revolver", "Revolvers"], ["smg", "SMGs and PDWs"], ["assault", "Assault and battle rifles"],
  ["mg", "Machine guns"], ["rifle", "Rifles"], ["shotgun", "Shotguns"], ["launcher", "Launchers"], ["bow", "Bows and crossbows"]];
const SUB_I = Object.fromEntries(GUN_SUBS.map(([k], i) => [k, i]));
const SUB_NAME = Object.fromEntries(GUN_SUBS);
const PISTOL_CALS = new Set(["9mm", "45acp", "57x28", "46x30", "22lr", "380", "40sw", "10mm", "32acp"]);
const TRADE_CATS = new Set(["jewelry", "collectibles", "gadgets", "liquor", "smokes", "treats", "household", "luxury", "toiletries"]);

// A gun's class (GUN_SUBS key): its trade category (data.js / data-guns.js cat), automatics split by calibre and size.
export function gunSub(key) {
  const d = GEAR[key] || {}, w = WEAPONS[key] || {};
  if (d.cat === "bow") return "bow";
  if (d.cat === "explosive" || w.launcher) return "launcher";
  if (d.cat === "pistol") return /revolver/i.test(`${key} ${d.name}`) ? "revolver" : "pistol";
  if (d.cat === "shotgun") return "shotgun";
  if (d.cat === "automatic") {
    if (PISTOL_CALS.has(w.cal) || /submachine|smg|pdw/i.test(d.name || "")) return "smg";
    if ((w.cap || 0) >= 100 || /machine gun/i.test(d.name || "")) return "mg";
    return "assault";
  }
  return "rifle";
}
// The group an item is listed in: { g: group id, sub: a gun's class or null }.
export function itemGroup(item) {
  const k = item && item.key, d = GEAR[k];
  if (!d) return { g: "other", sub: null };
  if (d.slot === "weapon") {
    if (d.cat === "melee" || !(isGunKey(k) || ["bow", "explosive", "pistol", "rifle", "shotgun", "automatic"].includes(d.cat))) return { g: "melee", sub: null };
    return { g: "guns", sub: gunSub(k) };
  }
  if (MAGAZINES[k] || CLIPS[k] || CALIBRE_CLIPS[k]) return { g: "mags", sub: null };
  if (d.cat === "ammo" || isRoundItem(item)) return { g: "ammo", sub: null };
  if (LIGHTS[k] || d.cat === "optics" || k === "nvg") return { g: "lights", sub: null };
  if (["armor", "head", "arms", "legs", "insert"].includes(d.slot) && (d.cat === "armor" || d.slot === "insert")) return { g: "armour", sub: null };
  if (isHelmetPart(k) || d.cat === "armor") return { g: "armour", sub: null };
  if (d.slot === "backpack" || d.slot === "rig" || d.cat === "packs" || d.cat === "containers") return { g: "bags", sub: null };
  if (d.cat === "gunmod" || slotOfPart(k)) return { g: "attach", sub: null };
  if (d.cat === "medical") return { g: "medical", sub: null };
  if (d.cat === "camp" || d.cat === "clothing") return { g: "clothing", sub: null };
  if (d.cat === "explosive" || d.throw) return { g: "throw", sub: null };
  if (d.cat === "defence" || d.defence) return { g: "defence", sub: null };
  if (d.cat === "books" || d.book) return { g: "books", sub: null };
  if (TRADE_CATS.has(d.cat) || d.valuable) return { g: "trade", sub: null };
  if (["tools", "electronics", "vehicle"].includes(d.cat) || d.slot === "tool" || d.slot === "head") return { g: "tools", sub: null };
  return { g: "other", sub: null };
}

// ---------- the stat line ----------
// The rounds in a gun or a magazine against what it holds ("7/10"): gun-mags' count (ui/itemlabels.js
// gunRoundsLabel, sim/gunrounds.js), which finds the rounds to hand where the item is (a base's stores for the
// armory), so a stored gun shows what it will hold in a fight, not "0/15". Re-exported for the callers and tests.
export { gunRoundsLabel };
// How worn it is, 0..1 (the tiles' bar: durability left, else quality).
export function itemFrac(item) {
  const dur = itemDur(item);
  const d = GEAR[item.key] || {};
  if (dur != null && !d.count && !d.tabs && !isRoundItem(item)) return Math.max(0, Math.min(1, dur / Math.max(1, itemDurMax(item))));
  return Math.max(0, Math.min(1, item.quality == null ? 1 : item.quality));
}
// The short facts under the name: [text, tip, cls?] triples. loc: where it is (the rounds to hand there), state: null
// for the live game.
export function statBits(item, loc = null, state = null) {
  const d = GEAR[item.key] || {};
  const out = [];
  const r = gunRoundsLabel(item, loc, state);
  if (r) out.push([r.text, r.tip, `irounds ${r.cls}`]);
  if (isRoundItem(item)) out.push([`${amountOf(item)} rds`, "Rounds in this stack"]);
  else if (item.contents) out.push([`${item.contents.filter(Boolean).length}/${item.contents.length} in`, "What it holds"]);
  else if (countOf(item) > 1) out.push([`×${countOf(item)}`, "How many in the stack"]);
  const dur = itemDur(item);
  if (dur != null && (d.count || d.tabs || d.groom) && !isRoundItem(item)) out.push([`${dur}/${d.dur} left`, d.tabs ? "Tablets left" : d.groom ? "Days of use left" : "Uses left"]);
  else if (!isRoundItem(item) && (dur != null || (item.quality != null && item.quality < 1))) out.push([`${Math.round(itemFrac(item) * 100)}%`, "Condition"]);
  if (item.fire === "burn") out.push(["🔥", "Marked: the boiler may burn it"]);
  else if (item.fire === "keep") out.push(["keep", "Marked: kept from the fire"]);
  return out;
}

// ---------- pictures ----------
const ICON = { bandagekit: "🩹", surgkit: "✚", traumakit: "✚", tourniquet: "🩸", dewormer: "💊", puritabs: "💊", earplugs: "👂",
  milradio: "📻", handradio: "📻", commset: "🎧", eardef: "🎧", earmuffs: "🎧", nvg: "🥽", thermal: "🥽", crowbar: "🔧", waterfilter: "💧",
  bicycle: "🚲", guitar: "🎸", harmonica: "🎵", cards: "🃏", photos: "🖼", pipebomb: "💣", frag: "💣", molotov: "🔥", flare: "🎆",
  smokegren: "💨", flashbang: "💥", cuffs: "⛓", gamecall: "📯", camonet: "⛺", ghillie: "🌿", woodghillie: "🌿", stove: "🔥", scentmask: "🫙",
  ragboots: "🥾", flashlight: "🔦", headlamp: "🔦", torch: "🔥", lantern: "🏮", spotlight: "🔦", binoculars: "🔭", monocular: "🔭",
  spotscope: "🔭", telescope: "🔭", ladder: "🪜", fishrod: "🎣", fishnet: "🎣", makeshiftrod: "🎣", powerdrill: "🛠", anglegrinder: "🛠",
  riflecase: "🧳", pistolcase: "🧳", ammocan: "🧰", brass: "⁍", powder: "🧂", primers: "⁍", bottle: "🍾", noisemaker: "🔔", alarmclock: "⏰" };
const CAT_ICON = { jewelry: "💍", smokes: "🚬", liquor: "🍾", treats: "🍫", gadgets: "📱", collectibles: "🪙", household: "🧻", toiletries: "🧼",
  luxury: "🎲", defence: "🚧", books: "📖", melee: "🗡", bow: "🏹", packs: "🎒" };
const SLOT_ICON = { head: "⛑", armor: "🦺", arms: "🧤", legs: "🦵", backpack: "🎒", rig: "🦺", insert: "▭" };
// Melee by what its name says it is.
const MELEE_ICON = [[/axe|hatchet|tomahawk/i, "🪓"], [/knife|bayonet|shiv|dagger|blade/i, "🔪"], [/sledge|hammer|mallet|maul/i, "🔨"],
  [/spear|pike|trident/i, "🔱"], [/bat|club|pipe|baton|stick|cane|tonfa|golf|cricket/i, "🏏"], [/crowbar|pry|wrench/i, "🔧"], [/saw/i, "🪚"], [/shovel|spade/i, "🪏"]];
export function itemEmoji(item) {
  const k = item.key, d = GEAR[k] || {};
  if (ICON[k]) return ICON[k];
  if (d.slot === "weapon" && d.cat === "melee") { const m = MELEE_ICON.find(([re]) => re.test(d.name || k)); return m ? m[1] : "🗡"; }
  if (d.slot === "insert" || (d.cat === "armor" && /plate|insert/i.test(d.name || ""))) return "🛡";
  return CAT_ICON[d.cat] || SLOT_ICON[d.slot] || (d.book ? "📖" : GROUP[itemGroup(item).g].icon);
}
// A magazine or a gun part drawn from its gun-builder look (ui/gunart.js PART_ART), cropped; cached by key.
const partCache = new Map();
function partThumb(key) {
  if (partCache.has(key)) return partCache.get(key);
  let t = null;
  try {
    const slot = MAGAZINES[key] ? "mag" : slotOfPart(key);
    const look = slot ? lookOf({ key }, slot) : null;
    const draw = look && PART_ART[look];
    if (draw) {
      const W = 48, H = 40, p = painter(W, H);
      draw(p, [22, 16], { art: null, key: null });
      let x0 = W, y0 = H, x1 = -1, y1 = -1;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (p.get(x, y)) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 >= 0) {
        const w = x1 - x0 + 3, h = y1 - y0 + 3, q = painter(w, h);
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const c = p.get(x, y); if (c) q.set(x - x0 + 1, y - y0 + 1, c); }
        const cv = toCanvas(q, 3);
        const url = cv && typeof cv.toDataURL === "function" ? cv.toDataURL("image/png") : "";
        if (url) t = { url, w, h };
      }
    }
  } catch { t = null; } // a look that needs its gun's art: the icon instead
  if (partCache.size > 300) partCache.clear();
  partCache.set(key, t);
  return t;
}
// A cartridge, drawn (no emoji fits a round): brass case, a coloured tip by type (AP black, soft point grey, a shell red).
function roundSvg(item) {
  const k = String(item.key || "");
  const tipCol = /_ap\b|_ap$/.test(k) ? "#2a2a2a" : /_sp|_hp|soft/.test(k) ? "#9aa3ad" : /_rubber|_bean/.test(k) ? "#3f6fb0" : /_sub/.test(k) ? "#5b7a3a" : "#b9783b";
  const shell = /12g|20g|shell|buck|slug/.test(k);
  if (shell) return `<svg class="asvg" viewBox="0 0 16 16"><rect x="5" y="2" width="6" height="10" rx="1" fill="#b8332f"/><rect x="4.5" y="11" width="7" height="3" fill="#d4a845"/></svg>`;
  return `<svg class="asvg" viewBox="0 0 16 16"><path d="M6 6 Q8 0 10 6 Z" fill="${tipCol}"/><rect x="6" y="6" width="4" height="8" fill="#d4a845"/><rect x="5.5" y="13" width="5" height="1.5" fill="#a07a2a"/></svg>`;
}
// The picture for an item: h = its height in rem (cards ~2.4, rows ~1.1).
export function itemPic(item, h = 2.4) {
  const { g } = itemGroup(item);
  if (g === "guns" && isGunKey(item.key)) { const html = gunIconHtml(item, Math.min(h, 2.2), "igun apicimg"); if (html) return html; }
  if (g === "mags" || g === "attach") {
    const t = partThumb(item.key);
    if (t) return `<img class="igun apicimg" src="${t.url}" alt="" style="height:${Math.min(h * 0.85, Math.max(h * 0.45, t.h * 0.17)).toFixed(2)}rem;width:auto">`;
  }
  if (g === "ammo" && isRoundItem(item)) return roundSvg(item);
  return `<span class="aemo">${itemEmoji(item)}</span>`;
}

// ---------- the view's state (this session; the view mode in this browser) ----------
const VIEW_KEY = "bs.armoryView";
let compact = null;
const queries = {}; // ns → the find box's text
const types = {}; // ns → the group shown alone ("" all)
const scopes = {}; // ns → "stored" | "all"
const folded = new Set(); // `${ns}:${group}`
export function armoryCompact() {
  if (compact == null) { try { compact = typeof localStorage !== "undefined" && localStorage.getItem(VIEW_KEY) === "compact"; } catch { compact = false; } }
  return compact;
}
export function setArmoryCompact(on) {
  compact = !!on;
  try { if (typeof localStorage !== "undefined") localStorage.setItem(VIEW_KEY, compact ? "compact" : "cards"); } catch { /* storage blocked: this session only */ }
}
export const armoryQuery = (ns) => queries[ns] || "";
export const armoryScope = (ns) => scopes[ns] || "stored";
export const armoryType = (ns) => types[ns] || "";
export function resetArmoryView() { compact = null; for (const o of [queries, types, scopes]) for (const k of Object.keys(o)) delete o[k]; folded.clear(); }

// The words an item is found by: its name, its group and class, its calibre, who has it.
function findText(e) {
  const { g, sub } = itemGroup(e.item);
  const d = GEAR[e.item.key] || {}, w = WEAPONS[e.item.key] || {};
  return `${rowName(e.item)} ${stackLabel(e.item)} ${d.name || ""} ${GROUP[g].name} ${sub ? SUB_NAME[sub] : ""} ${w.cal || ""} ${d.cat || ""} ${e.who || ""}`.toLowerCase();
}
const matches = (e, q) => !q || q.split(/\s+/).filter(Boolean).every((t) => e.find.includes(t));
const sortKey = (a, b) => (a.sub == null ? 0 : SUB_I[a.sub]) - (b.sub == null ? 0 : SUB_I[b.sub]) || a.name.localeCompare(b.name) || b.frac - a.frac || (a.who || "").localeCompare(b.who || "");

// ---------- the view ----------
// entries: [{ item, loc, who? (who has it: "Ann, hands"), whoTip? }]
// opts:
//   ns        which view ("base", "store"): its find box, type and folds are its own
//   cell(e, inner, cls)  the HTML around one item (its clicks, drags, tip); default a plain div
//   tipOf(item)          the hover text (default none)
//   empty     the text when there is nothing at all
//   scopeBar  extra HTML for the tool bar (the base tab's Stored / Everything here)
//   wrap(html)  the HTML around the groups (the inventory's drop box); default a div
//   state     the game, for the rounds in guns and magazines (the stores to hand); default the live one
export function armoryView(entries, opts = {}) {
  const ns = opts.ns || "base";
  const isCompact = armoryCompact();
  const q = armoryQuery(ns).trim().toLowerCase();
  const only = armoryType(ns);
  const all = entries.map((e) => {
    const { g, sub } = itemGroup(e.item);
    return { ...e, g, sub, name: rowName(e.item), frac: itemFrac(e.item), find: findText(e) };
  });
  const found = all.filter((e) => matches(e, q));
  const byGroup = new Map();
  for (const e of found) { if (!byGroup.has(e.g)) byGroup.set(e.g, []); byGroup.get(e.g).push(e); }
  const counts = new Map();
  for (const e of found) counts.set(e.g, (counts.get(e.g) || 0) + 1);
  const cell = opts.cell || ((e, inner, cls) => `<div class="${cls}"${tip(opts.tipOf ? opts.tipOf(e.item) : "")}>${inner}</div>`);
  // The tool bar: find box, view toggle, fold all, the type chips.
  const chip = (id, label, n) => `<button class="mini achip${only === id ? " active" : ""}" data-action="armv-type" data-ns="${ns}" data-g="${id}"${tip(id ? `Show only ${GROUP[id].name.toLowerCase()} (click again for everything)` : "Show every type")}>${label} <span class="muted">${n}</span></button>`;
  const groupsHere = ARMORY_GROUPS.filter(([id]) => counts.get(id));
  const anyFolded = groupsHere.some(([id]) => folded.has(`${ns}:${id}`));
  const bar = `<div class="armbar">
    <input class="armq" type="search" placeholder="Find: name, type, calibre${opts.scopeBar ? ", who" : ""}…" value="${esc(armoryQuery(ns))}" data-action="armv-q" data-ns="${ns}" data-keep="armv-q-${ns}" spellcheck="false" autocomplete="off"${tip("Type to find gear by its name, its type (rifle, magazine, helmet...), its calibre (9mm, 556...) or who has it")}>
    ${q ? `<button class="mini" data-action="armv-clear" data-ns="${ns}"${tip("Clear the find box")}>×</button>` : ""}
    ${opts.scopeBar || ""}
    <button class="mini" data-action="armv-foldall" data-ns="${ns}" data-open="${anyFolded ? "1" : ""}"${tip(anyFolded ? "Open every group" : "Fold every group to its header")}>${anyFolded ? "Open all" : "Fold all"}</button>
    <button class="mini armview" data-action="armv-view" data-ns="${ns}"${tip(isCompact ? "Show cards: a picture of each item, bigger (remembered in this browser)" : "Show compact rows: more on screen at once (remembered in this browser)")}>${isCompact ? "▦ Cards" : "☰ Compact"}</button>
  </div>
  ${groupsHere.length > 1 || only ? `<div class="armchips">${chip("", "All", found.length)}${groupsHere.map(([id, name, icon]) => chip(id, `${icon} ${esc(name.split(/,| and /)[0])}`, counts.get(id))).join("")}</div>` : ""}`;
  // The groups.
  const itemHtml = (e) => {
    const bits = statBits(e.item, e.loc, opts.state || null);
    const stat = bits.map(([t, tt, cls]) => `<span${cls ? ` class="${cls}"` : ""}${tip(tt)}>${esc(t)}</span>`).join(" · ");
    const col = e.frac > 0.6 ? "var(--good)" : e.frac > 0.3 ? "var(--accent)" : "var(--danger)";
    const who = e.who ? `<span class="awho"${tip(e.whoTip || "")}>${esc(e.who)}</span>` : "";
    if (isCompact) {
      return cell(e, `<span class="apic sm g-${e.g}">${itemPic(e.item, 1.05)}</span><span class="aname">${esc(e.name)}</span>${who}<span class="astat">${stat}</span><span class="akg">${kg1(itemLoad(e.item))} kg</span>`, `arow${e.bad ? " bad" : ""}`);
    }
    return cell(e, `<span class="apic g-${e.g}">${itemPic(e.item, 2.3)}</span><span class="ainfo"><span class="aname">${esc(e.name)}</span><span class="astat">${stat || `<span class="muted">${kg1(itemLoad(e.item))} kg</span>`}</span>${who}</span><i class="idur"><b style="width:${Math.round(Math.max(0.05, e.frac) * 100)}%;background:${col}"></b></i>`, `acard${e.bad ? " bad" : ""}`);
  };
  const sections = ARMORY_GROUPS.filter(([id]) => byGroup.has(id) && (!only || only === id)).map(([id, name, icon]) => {
    const list = byGroup.get(id).sort(sortKey);
    const open = q || only === id || !folded.has(`${ns}:${id}`);
    let body = "";
    if (open) {
      if (id === "guns") {
        const subs = GUN_SUBS.filter(([s]) => list.some((e) => e.sub === s));
        // Cards: the classes side by side (a class of one or two takes no line of its own); rows: one under another.
        body = subs.map(([s, sn]) => { const L = list.filter((e) => e.sub === s); return `<div class="asubblk"><div class="asub">${esc(sn)} <span class="muted">${L.length}</span></div><div class="${isCompact ? "arows" : "acards"}">${L.map(itemHtml).join("")}</div></div>`; }).join("");
        if (!isCompact) body = `<div class="asubs">${body}</div>`;
      } else body = `<div class="${isCompact ? "arows" : "acards"}">${list.map(itemHtml).join("")}</div>`;
    }
    const kgSum = list.reduce((a, e) => a + itemLoad(e.item), 0);
    return `<div class="agroup${open ? "" : " folded"}"><button class="ahead" data-action="armv-fold" data-ns="${ns}" data-g="${id}"${tip(open ? "Fold this group" : "Open this group")}><span class="acaret">${open ? "▾" : "▸"}</span> ${icon} ${esc(name)} <span class="acount">${list.length}</span><span class="akgsum">${kg1(kgSum)} kg</span></button>${body}</div>`;
  }).join("");
  const none = !entries.length ? `<span class="small muted">${esc(opts.empty || "Empty.")}</span>` : !sections ? `<span class="small muted">Nothing matches${q ? ` "${esc(armoryQuery(ns))}"` : ""}.</span>` : "";
  const inner = `${sections}${none}`;
  return `${entries.length ? bar : ""}${opts.wrap ? opts.wrap(inner) : `<div class="agroups">${inner}</div>`}`;
}

// ---------- clicks and typing (wired in main.js) ----------
export const ARMV_ACTIONS = {
  "armv-view": () => setArmoryCompact(!armoryCompact()),
  "armv-fold": (state, ui, d) => { const k = `${d.ns}:${d.g}`; if (folded.has(k)) folded.delete(k); else folded.add(k); },
  "armv-foldall": (state, ui, d) => { for (const [id] of ARMORY_GROUPS) { const k = `${d.ns}:${id}`; if (d.open) folded.delete(k); else folded.add(k); } },
  "armv-type": (state, ui, d) => { types[d.ns] = types[d.ns] === d.g ? "" : d.g || ""; },
  "armv-clear": (state, ui, d) => { queries[d.ns] = ""; },
  "armv-scope": (state, ui, d) => { scopes[d.ns] = d.scope === "all" ? "all" : "stored"; },
  // The base tab: an item clicked opens the inventory window (ui/inventory.js) on someone here with it selected.
  "armv-pick": (state, ui, d) => { if (d.sid == null || d.sid === "" || !d.loc) return; ui.inv = { sid: Number(d.sid), loot: false }; ui.invSel = d.loc; ui.invMsg = ""; },
};
export const ARMV_INPUT = {
  "armv-q": (state, ui, el) => { queries[el.dataset.ns || "base"] = String(el.value || "").slice(0, 40); },
};
