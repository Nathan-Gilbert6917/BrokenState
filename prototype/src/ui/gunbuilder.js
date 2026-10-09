// The gun builder (docs/weapons-overhaul-plan.md section 9): a big drawing of the gun (ui/gunart.js) with a leader line
// from each slot on it to a box in a lane above or below; click a box for the parts within reach that fit that slot
// (with what each one changes), fit one or take one off; the stats as the battle uses them (sim/gunstats.js gunStats),
// before → after while the mouse is on a part; the ammo it is loaded with (item.load) and how reliable it is.
// Opened from the inventory (Modify on a selected gun, ⚙ on the gun in hand, ⚙ on a gun in the armory), the base's
// Armory tab; never during a battle (the raid's search window is read-only).
// ui.gunb = { loc, slot, hover, sid, msg }: loc the gun's inventory location ("s:12:weapon", "armory:3:list:5",
// "cargo:7:list:2"), slot the box picked, hover the part row under the mouse (its location, or "remove"), sid the person
// whose inventory it was opened from.
//
// The sim calls go through a thin adapter: the economy agent's gunmods.js fitAt / stripAt / slotsOf / fitsSlot (slots
// with nesting: a mount adds a sight, a rail a grip, a light and a bipod) when they are there, else today's gunmods.js
// (ATTACH mounts: sight, muzzle, magazine, under the barrel) through sim/inventory.js fitModAt / unfitModAt.
import { GEAR } from "../sim/data.js";
import { rigPouches } from "../sim/inventory.js"; // magazines in rig pouches (section 16)
import { typeName } from "../sim/rounds.js"; // a magazine's load
import { WEAPONS } from "../sim/combat.js";
import * as GM from "../sim/gunmods.js";
import * as DGM from "../sim/data-gunmods.js";
import { gunStats } from "../sim/gunstats.js";
import { CALIBERS, AMMO_TYPES, ammoPen } from "../sim/data-ammo.js";
import { itemAt, parseLoc, placeOfLoc, storageFor, ensureInv, packOf, itemLoad, fitModAt, unfitModAt } from "../sim/inventory.js";
import { survivorById, atBase, baseById } from "../sim/world.js";
import { partyMembers } from "../sim/parties.js";
import { worthTier } from "../sim/valuation.js";
import { itemDur, itemDurMax } from "../sim/crafting.js"; // condition: item.dur of item.durMax (plan section 25)
import { repairInfoAt, repairAt } from "../sim/repair.js"; // the Repair button: the base's bench queue, or a field kit on the road
import { gunURL, anchorOf, platformOf, isGunKey, ART_W, ART_H } from "./gunart.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const r1 = (x) => Math.round(x * 10) / 10;
const r2 = (x) => Math.round(x * 100) / 100;
const sgn = (v, d = 1) => { const n = d === 1 ? r1(v) : r2(v); return `${n > 0 ? "+" : n < 0 ? "−" : "±"}${Math.abs(n)}`; };

export const SLOT_NAMES = { optic: "Sight", mount: "Mount", muzzle: "Muzzle", mag: "Magazine", under: "Under the barrel", stock: "Stock", grip: "Grip", rail: "Rail", tactical: "Light / laser", bipod: "Bipod", sling: "Sling" };
const TOP = new Set(["optic", "mount", "tactical", "rail"]); // the top lane; the rest below the gun
// Platforms whose failures are misfires (the round is lost, no jam to clear: section 14).
const MISFIRE = new Set(["revolver", "dbl", "bolt", "lever", "pump"]);

// ---------- the adapter ----------
const modDefOf = (key) => (typeof GM.modDef === "function" ? GM.modDef(key) : GM.ATTACH && GM.ATTACH[key]) || null;
// The slot a part goes in (its definition's slot, or today's mount).
export const slotOfPart = (key) => { const a = modDefOf(key); return a ? a.slot || a.mount || null : null; };
const isPart = (it) => !!(it && it.key && (typeof GM.isGunmod === "function" ? GM.isGunmod(it.key) : modDefOf(it.key)));
// The richer sim (slots per platform, nesting) is there.
export const richSim = () => typeof GM.fitAt === "function" && typeof GM.stripAt === "function" && typeof GM.slotsOf === "function";
// A gun item takes parts at all.
export const takesParts = (gun) => !!(gun && isGunKey(gun.key) && slotsOf(gun).length);

// The slots a gun has now (nested ones only while their parent is fitted), in the sim's order.
export function slotsOf(gun) {
  if (!gun || !WEAPONS[gun.key]) return [];
  if (typeof GM.slotsOf === "function") {
    const r = GM.slotsOf(gun);
    if (Array.isArray(r)) return r.map((s) => (typeof s === "string" ? s : s && s.slot)).filter(Boolean);
  }
  // Today's gunmods.js: the mounts some attachment fits this gun on, any slot with a part in it, and the slots a fitted
  // part opens (adds), each after its parent.
  const mounts = GM.MOUNTS || ["optic", "muzzle", "mag", "under"];
  const out = mounts.filter((m) => (gun.mods && gun.mods[m]) || Object.values(GM.ATTACH || {}).some((a) => (a.slot || a.mount) === m && a.fits && a.fits.includes(gun.key)));
  const addSlot = (sl) => {
    if (!out.includes(sl)) out.push(sl);
    const m = gun.mods && gun.mods[sl];
    const a = m && modDefOf(m.key);
    if (a && Array.isArray(a.adds)) for (const c of a.adds) addSlot(c);
  };
  for (const sl of [...out]) addSlot(sl);
  if (gun.mods) for (const [sl, m] of Object.entries(gun.mods)) if (m) addSlot(sl);
  return out;
}
// Does this part fit this slot of this gun (whatever is in the slot now comes off)?
export function partFits(gun, slot, part) {
  if (!gun || !part || part === gun || !isPart(part)) return false;
  if (typeof GM.fitsSlot === "function") {
    const r = GM.fitsSlot(gun, slot, part);
    return r === true || r === "" || !!(r && r.ok === true);
  }
  return slotOfPart(part.key) === slot && !(typeof GM.modFitReason === "function" && GM.modFitReason(gun, part));
}
// The slot whose fitted part adds this one (a sight on a mount), or null.
export function parentSlot(gun, slot) {
  if (!gun || !gun.mods) return null;
  for (const [s, m] of Object.entries(gun.mods)) {
    const a = m && modDefOf(m.key);
    if (s !== slot && a && Array.isArray(a.adds) && a.adds.includes(slot)) return s;
  }
  return null;
}
// The gun as it would be with part in slot (null: taken off; whatever only the old part added comes off with it).
export function withPart(gun, slot, part) {
  const mods = { ...(gun.mods || {}) };
  const old = mods[slot];
  const keep = new Set(part && modDefOf(part.key) && modDefOf(part.key).adds || []);
  const drop = (s) => { const m = mods[s]; delete mods[s]; const a = m && modDefOf(m.key); if (a && a.adds) for (const c of a.adds) if (!keep.has(c)) drop(c); };
  if (old) drop(slot);
  if (part) mods[slot] = part;
  return { ...gun, mods };
}
export function fitPart(state, gunLoc, slot, partLoc, sid = null) {
  if (typeof GM.fitAt === "function") return GM.fitAt(state, gunLoc, slot, partLoc, sid);
  return fitModAt(state, gunLoc, partLoc);
}
export function stripPart(state, gunLoc, slot, sid = null) {
  if (typeof GM.stripAt === "function") return GM.stripAt(state, gunLoc, slot, sid);
  return unfitModAt(state, gunLoc, slot, sid);
}

// Who and what storage share the gun's place: { people (the holder first), st }; null for a body's gun.
function reach(state, gunLoc, sid) {
  const loc = parseLoc(gunLoc);
  if (loc.o === "body") return null;
  const place = placeOfLoc(state, gunLoc);
  if (!place) return null;
  const [kind, idStr] = place.split(":");
  const id = Number(idStr);
  const party = kind === "party" ? state.parties.find((x) => x.id === id) : null;
  const people = kind === "base" ? atBase(state, id) : party ? partyMembers(state, party) : [];
  const first = loc.o === "s" ? loc.id : sid;
  return { place, people: [...people].sort((a, b) => (b.id === first ? 1 : 0) - (a.id === first ? 1 : 0)), st: storageFor(state, place) };
}
const firstName = (s) => s.name.split(" ")[0];
// The loose parts within reach that fit a slot: pockets and packs of everyone at the gun's place (its holder first),
// then the armory or the team's cargo. [{ loc, item, where }].
export function partsInReach(state, gunLoc, slot, sid = null) {
  const gun = itemAt(state, gunLoc);
  const r = gun ? reach(state, gunLoc, sid) : null;
  if (!r) return [];
  const out = [];
  for (const s of r.people) {
    ensureInv(s);
    s.pockets.forEach((it, i) => { if (partFits(gun, slot, it)) out.push({ loc: `s:${s.id}:pocket:${i}`, item: it, where: `${firstName(s)}'s pocket` }); });
    (packOf(s) || []).forEach((it, i) => { if (partFits(gun, slot, it)) out.push({ loc: `s:${s.id}:pack:${i}`, item: it, where: `${firstName(s)}'s pack` }); });
    (rigPouches(s) || []).forEach((it, i) => { if (partFits(gun, slot, it)) out.push({ loc: `s:${s.id}:rig:${i}`, item: it, where: `${firstName(s)}'s rig` }); }); // a spare magazine in a pouch (sim/inventory.js)
  }
  if (r.st) r.st.list.forEach((it, i) => { if (partFits(gun, slot, it)) out.push({ loc: `${r.st.o}:${r.st.id}:list:${i}`, item: it, where: r.st.o === "armory" ? "the armory" : "the team's cargo" }); });
  return out;
}

// ---------- the numbers ----------
// The stats panel's numbers for a gun item (gunStats, with the weight, worth, earshot and penetration of its load).
export function statsOf(gun) {
  const s = gunStats(gun) || { aim: 0, close: 0, opt: 0, fall: 0, dmg: [0, 0], cap: 0, noise: 0, jam: 0, pen: 0 };
  const w = WEAPONS[gun.key] || {};
  const cal = s.cal || w.cal || null;
  const load = gun.load && gun.load !== "auto" ? gun.load : null;
  const type = load || (CALIBERS[cal] ? CALIBERS[cal].base : null);
  return {
    ...s, cal, load: gun.load ?? null, type,
    kg: itemLoad(gun), worth: worthTier(gun),
    earshot: w.noise ? (9 + 2 * w.noise) * ((s.noise || 0) / w.noise) : 0, // stealth.js: a raid's alert radius
    pen: s.pen || (cal ? ammoPen(cal, type) : 0),
    jam: Number(s.jam) || 0,
  };
}
const avg = (d) => (d[0] + d[1]) / 2;
// Condition as a bar: what is left (green to red), the uses lost off its maximum by repairs as a darker band at the end
// (repair.js: item.durBase, the maximum before its first repair; else a new one's). "" for a gun that does not wear.
export function conditionHtml(gun) {
  const d = GEAR[gun.key];
  const cur = itemDur(gun), max = itemDurMax(gun);
  if (cur == null || !d || !max) return "";
  const full = Math.max(d.dur, max);
  const f = cur / max;
  const col = f > 0.6 ? "var(--good)" : f > 0.3 ? "var(--accent)" : "var(--danger)";
  const lost = Math.max(0, (gun.durBase ?? d.dur) - max);
  return `<tr${tip(`Condition: ${cur} of ${max} uses left${lost ? `; its maximum is down ${lost} from the ${gun.durBase ?? d.dur} it had (repairs wear the maximum down; it never comes back)` : ""}. A worn gun jams more often.`)}><td>Condition</td><td class="n" data-stat="cond" data-v="${cur}/${max}"><span class="gbcond"><b style="width:${r2((cur / full) * 100)}%;background:${col}"></b>${lost ? `<i style="left:${r2((max / full) * 100)}%;width:${r2((lost / full) * 100)}%"></i>` : ""}</span> ${cur}/${max}</td></tr>`;
}
// [key, label, value text, number, better: 1 up / −1 down / 0, help]
function rows(s) {
  return [
    ["aim", "Aim", sgn(s.aim), s.aim, 1, "Added to the shooter's aim (40 + 2.5 a Shooting level)."],
    ["close", "Up close", sgn(s.close), s.close, 1, "Aim within 2.5 tiles."],
    ["opt", "Best range", `${r1(s.opt)} tiles`, s.opt, 1, "No aim lost out to here."],
    ["fall", "Fall-off", `−${r2(s.fall)} a tile`, s.fall, -1, "Aim lost each tile beyond the best range."],
    ...(s.reach ? [["reach", "Round's reach", `${r1(s.reach)} tiles, then −${r2(s.drop)} more a tile`, s.reach, 1, "A light round (5.56, 7.62×39, .22) drops past this, whatever the sight; no part pushes the best range past it."]] : []),
    ["dmg", "Damage", `${s.dmg[0]}–${s.dmg[1]}`, avg(s.dmg), 1, "A hit's damage before armour and cover."],
    ["cap", "Magazine", s.cap ? `${s.cap} rounds` : "—", s.cap, 1, "Rounds loaded; Reload (I) fills it in battle."],
    ["noise", "Noise", s.noise ? `${r2(s.noise)} · heard ~${Math.round(s.earshot)} tiles` : "silent", s.noise, -1, "A shot's noise (the dead and the unaware hear it; Heat in a raid)."],
    ["kg", "Weight", `${r1(s.kg)} kg`, s.kg, -1, "With the parts on it."],
    ["worth", "Worth", s.worth, null, 0, "A rough tier: the price depends on who you trade with."],
    ["pen", "Penetration", s.pen ? `${r1(s.pen)}${s.type && AMMO_TYPES[s.type] ? ` (${AMMO_TYPES[s.type].name})` : ""}` : "—", s.pen, 1, "Against armour: the loaded round's penetration."],
  ];
}
// "jams 0.5% a shot · ~1 in 200" (gunStats jam: % a shot).
export function reliabilityText(gun, s = statsOf(gun)) {
  const mis = MISFIRE.has(platformOf(gun.key));
  const j = s.jam;
  if (!(j > 0)) return mis ? "never misfires" : "never jams";
  return `${mis ? "misfires" : "jams"} ${r2(j)}% a shot · ~1 in ${Math.max(1, Math.round(100 / j)).toLocaleString("en-US")}`;
}
// What swapping a part changes, in short ("+4 aim · −8 close · ×0.4 noise").
export function deltaText(a, b, max = 9) {
  const bits = [];
  const d = (k, label, dd = 1) => { const v = b[k] - a[k]; if (Math.abs(v) > 1e-6) bits.push(`${sgn(v, dd)} ${label}`); };
  d("aim", "aim"); d("close", "close"); d("opt", "range");
  if (Math.abs(b.fall - a.fall) > 1e-6) bits.push(`${sgn(b.fall - a.fall, 2)} fall-off`);
  if (Math.abs(avg(b.dmg) - avg(a.dmg)) > 0.4) bits.push(`${sgn(avg(b.dmg) - avg(a.dmg))} dmg`);
  d("cap", "rounds");
  if (a.noise && Math.abs(b.noise / a.noise - 1) > 0.005) bits.push(`noise ×${r2(b.noise / a.noise)}`);
  if (Math.abs(b.jam - a.jam) > 1e-6) bits.push(`${sgn(b.jam - a.jam, 2)}% jam`);
  if (Math.abs(b.kg - a.kg) > 0.05) bits.push(`${sgn(b.kg - a.kg)} kg`);
  return bits.slice(0, max).join(" · ");
}

// The load choices for a gun's calibre: [value, label] ("" = the standard round, "auto" = whatever is to hand).
export function loadChoices(gun) {
  const cal = (WEAPONS[gun.key] || {}).cal;
  const c = CALIBERS[cal];
  if (!c) return [];
  return [["", `${c.name} ${AMMO_TYPES[c.base] ? AMMO_TYPES[c.base].name : c.base} (standard)`], ...c.types.filter((t) => t !== c.base && AMMO_TYPES[t]).map((t) => [t, `${c.name} ${AMMO_TYPES[t].name}`]), ["auto", "Best to hand"]];
}

// ---------- the drawing and its slot boxes ----------
export const VIEW = { W: 720, H: 340, IMG_W: ART_W * 8, IMG_H: ART_H * 8, IX: (720 - ART_W * 8) / 2, IY: 72, BOX_W: 98, BOX_H: 56, TOP_Y: 6, GAP: 4 };
VIEW.BOT_Y = VIEW.IY + VIEW.IMG_H + 10;
// Box x positions for one lane (sorted by anchor x): as close over the anchor as the others let them be.
function laneXs(list) {
  const n = list.length;
  const bw = n * (VIEW.BOX_W + VIEW.GAP) > VIEW.W ? (VIEW.W - VIEW.GAP * (n - 1)) / n : VIEW.BOX_W;
  const max = VIEW.W - bw - 2;
  const xs = list.map((it) => Math.max(2, Math.min(max, it.px - bw / 2)));
  for (let i = 1; i < n; i++) xs[i] = Math.max(xs[i], xs[i - 1] + bw + VIEW.GAP);
  if (n && xs[n - 1] > max) { xs[n - 1] = max; for (let i = n - 2; i >= 0; i--) xs[i] = Math.min(xs[i], xs[i + 1] - bw - VIEW.GAP); }
  return { xs, bw };
}
// The layout: [{ slot, ax, ay (anchor, view px), x, y, w, h, top, parent }].
export function slotLayout(gun, slots = slotsOf(gun)) {
  const fitted = {};
  if (gun.mods) for (const [s, m] of Object.entries(gun.mods)) if (m) fitted[s] = true;
  const pts = slots.map((slot) => {
    const [gx, gy] = anchorOf(gun.key, slot, fitted);
    return { slot, px: VIEW.IX + gx * 8 + 4, py: VIEW.IY + gy * 8 + 4, top: TOP.has(slot), parent: parentSlot(gun, slot) };
  });
  const out = [];
  for (const top of [true, false]) {
    const lane = pts.filter((p) => p.top === top).sort((a, b) => a.px - b.px || a.slot.localeCompare(b.slot));
    const { xs, bw } = laneXs(lane);
    lane.forEach((p, i) => out.push({ ...p, x: xs[i], y: top ? VIEW.TOP_Y : VIEW.BOT_Y, w: bw, h: VIEW.BOX_H }));
  }
  return out;
}
const pc = (v, of) => `${r2((v / of) * 100)}%`;

// ---------- the window ----------
const GB_CSS = `.gbwrap{position:relative;width:100%;aspect-ratio:720/340;margin:0.3rem 0 0.5rem;background:radial-gradient(ellipse at 50% 50%,rgba(255,255,255,0.06),transparent 70%);border-radius:8px}
.gbwrap img.gbimg{position:absolute;image-rendering:pixelated;pointer-events:none}
.gbwrap svg{position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;overflow:visible}
.gbwrap line{stroke:var(--accent);stroke-width:1.5;opacity:0.85}.gbwrap line.nest{stroke-dasharray:5 4;opacity:0.7}.gbwrap circle{fill:var(--accent)}
.gbslot{position:absolute;display:flex;flex-direction:column;justify-content:center;align-items:flex-start;gap:1px;padding:2px 6px;font-size:0.72rem;line-height:1.15;text-align:left;overflow:hidden;background:rgba(27,30,35,0.92)}
.gbslot .gbsn{color:var(--muted);text-transform:uppercase;letter-spacing:0.04em;font-size:0.64rem}.gbslot .gbpn{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.gbslot.empty .gbpn{font-weight:400;font-style:italic;color:var(--muted)}.gbslot .gbdl{color:var(--good);font-size:0.66rem;white-space:nowrap;overflow:hidden;max-width:100%}
.gbslot.on{border-color:var(--accent);background:#3a2e17}
.gbcols{display:grid;grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:0.9rem}
.gbrow{display:flex;align-items:center;justify-content:space-between;gap:0.5rem;padding:0.25rem 0.4rem;border:1px solid var(--line);border-radius:6px;margin-bottom:0.25rem}
.gbrow.hov{border-color:var(--accent)}.gbrow .gbd{color:var(--muted);font-size:0.75rem}
.gbstats{width:100%;border-collapse:collapse;font-size:0.85rem}.gbstats td{padding:0.12rem 0.3rem;border-bottom:1px solid var(--line)}.gbstats td.n{text-align:right;white-space:nowrap}
.gbcond{position:relative;display:inline-block;width:5rem;height:0.5rem;background:var(--panel-2);border:1px solid var(--line);border-radius:3px;vertical-align:middle;overflow:hidden}.gbcond b{position:absolute;left:0;top:0;bottom:0}.gbcond i{position:absolute;top:0;bottom:0;background:#0c0d10;background-image:repeating-linear-gradient(45deg,transparent 0 2px,rgba(255,255,255,0.08) 2px 4px)}
.gbstats .up{color:var(--good)}.gbstats .down{color:var(--danger)}
@media (max-width:700px){.gbcols{grid-template-columns:1fr}}`;
function ensureCss() {
  if (typeof document === "undefined" || !document.head || typeof document.getElementById !== "function" || document.getElementById("gbcss")) return;
  const el = document.createElement("style");
  el.id = "gbcss";
  el.textContent = GB_CSS;
  document.head.appendChild(el);
}

// Where the gun is, in words.
function whereText(state, loc) {
  const L = parseLoc(loc);
  if (L.o === "s") { const s = survivorById(state, L.id); return s ? `${firstName(s)}'s ${L.slot === "weapon" ? "hands" : L.slot}` : ""; }
  if (L.o === "armory") { const b = baseById(state, L.id); return b ? `${b.name}'s armory` : "the armory"; }
  if (L.o === "cargo") return "the team's cargo";
  return "";
}

export function gunBuilderModal(state, ui) {
  const g = ui.gunb;
  if (!g) return null;
  const gun = itemAt(state, g.loc);
  if (state.combat || !gun || !isGunKey(gun.key) || parseLoc(g.loc).o === "body") { ui.gunb = null; return null; }
  ensureCss();
  const slots = slotsOf(gun);
  if (g.slot && !slots.includes(g.slot)) g.slot = null;
  const lay = slotLayout(gun, slots);
  const now = statsOf(gun);
  // The stats as they would be with the part under the mouse (or with the selected slot's part taken off).
  let after = null, afterWhat = "";
  if (g.slot && g.hover) {
    if (g.hover === "remove") { after = statsOf(withPart(gun, g.slot, null)); afterWhat = `without the ${gun.mods && gun.mods[g.slot] ? gun.mods[g.slot].name : "part"}`; }
    else { const part = itemAt(state, g.hover); if (part && partFits(gun, g.slot, part)) { after = statsOf(withPart(gun, g.slot, part)); afterWhat = `with the ${part.name}`; } }
  }
  const V = VIEW;
  const boxes = lay.map((b) => {
    const part = gun.mods && gun.mods[b.slot];
    const dl = part ? deltaText(statsOf(withPart(gun, b.slot, null)), now, 2) : "";
    const t = part ? `${SLOT_NAMES[b.slot] || b.slot}: ${part.name}${dl ? ` (${dl})` : ""}. Click to swap it or take it off.` : `${SLOT_NAMES[b.slot] || b.slot}: empty. Click for the parts within reach that fit.`;
    return `<button class="gbslot${part ? "" : " empty"}${g.slot === b.slot ? " on" : ""}" data-action="gb-slot" data-slot="${b.slot}" style="left:${pc(b.x, V.W)};top:${pc(b.y, V.H)};width:${pc(b.w, V.W)};height:${pc(b.h, V.H)}"${tip(t)}><span class="gbsn">${esc(SLOT_NAMES[b.slot] || b.slot)}</span><span class="gbpn">${part ? esc(part.name) : "empty socket"}</span>${dl ? `<span class="gbdl">${esc(dl)}</span>` : ""}</button>`;
  }).join("");
  const lines = lay.map((b) => {
    const par = b.parent && lay.find((x) => x.slot === b.parent);
    const bx = b.x + b.w / 2, by = b.top ? b.y + b.h : b.y;
    if (par) { // a nested slot: a dotted line from its parent's box
      const px = par.x + par.w / 2, py = par.top ? par.y + par.h : par.y;
      return `<line class="nest" data-slot="${b.slot}" x1="${r1(px)}" y1="${r1(py)}" x2="${r1(bx)}" y2="${r1(by)}"/><circle cx="${r1(b.px)}" cy="${r1(b.py)}" r="2.5"/>`;
    }
    return `<line data-slot="${b.slot}" x1="${r1(b.px)}" y1="${r1(b.py)}" x2="${r1(bx)}" y2="${r1(by)}"/><circle cx="${r1(b.px)}" cy="${r1(b.py)}" r="3.5"/>`;
  }).join("");
  const img = `<img class="gbimg" src="${gunURL(gun, slots)}" alt="${esc(gun.name)}" style="left:${pc(V.IX, V.W)};top:${pc(V.IY, V.H)};width:${pc(V.IMG_W, V.W)};height:${pc(V.IMG_H, V.H)}">`;
  // The stats panel.
  const statRows = rows(now).map(([k, label, txt, num, better, help], i) => {
    let aft = "";
    if (after) {
      const a = rows(after)[i];
      const changed = a[2] !== txt;
      const cls = !changed || !better || a[3] == null || num == null ? "" : (a[3] - num) * better > 0 ? "up" : "down";
      aft = `<td class="n ${cls}">${changed ? `→ ${esc(a[2])}` : ""}</td>`;
    }
    return `<tr${tip(help)}><td>${label}</td><td class="n" data-stat="${k}" data-v="${num == null ? esc(txt) : r2(num)}">${esc(txt)}</td>${after ? aft : ""}</tr>`;
  }).join("");
  const rel = reliabilityText(gun, now);
  const relAfter = after ? reliabilityText(gun, after) : "";
  const loads = loadChoices(gun);
  const loadSel = loads.length ? `<div class="row small" style="margin-top:0.4rem;gap:0.4rem"${tip("The round this gun is loaded with (item.load): its damage, penetration, noise and reliability. In battle Reload can switch it when another kind of this calibre is to hand. 'Best to hand' takes the best kind the team carries.")}><span class="muted">Ammo</span><select data-action="gb-load">${loads.map(([v, l]) => `<option value="${v}"${(gun.load || "") === v ? " selected" : ""}>${esc(l)}</option>`).join("")}</select></div>` : "";
  const statsHtml = `<div><div class="spread"><b>Stats</b><span class="small muted">${after ? `now → ${esc(afterWhat)}` : "hover a part to compare"}</span></div>
    <table class="gbstats">${conditionHtml(gun)}${statRows}<tr${tip("How often a shot jams (gas and magazine-fed guns: Unjam clears it) or misfires (revolvers, bolt, lever, pump and double guns: the round is lost). Worse with wear, dirty guns, cheap rounds, bad weather and some parts.")}><td>Reliability</td><td class="n" data-stat="jam" data-v="${r2(now.jam)}">${esc(rel)}</td>${after ? `<td class="n ${after.jam < now.jam ? "up" : after.jam > now.jam ? "down" : ""}">${relAfter !== rel ? `→ ${esc(relAfter)}` : ""}</td>` : ""}</tr></table>
    ${loadSel}</div>`;
  // The parts for the picked slot.
  let listHtml;
  if (g.slot) {
    const cur = gun.mods && gun.mods[g.slot];
    const cands = partsInReach(state, g.loc, g.slot, g.sid);
    const rowsHtml = cands.map((c) => {
      const d = deltaText(now, statsOf(withPart(gun, g.slot, c.item)));
      return `<div class="gbrow${g.hover === c.loc ? " hov" : ""}" data-gbhover="${esc(c.loc)}"><span><b>${esc(c.item.name)}</b>${c.item.load ? ` <span class="gbd">${esc(typeName(c.item.load))}</span>` : ""} <span class="gbd">${esc(c.where)}</span><br><span class="gbd">${esc(d || "no change")}</span></span><button class="mini" data-action="gb-fit" data-slot="${g.slot}" data-part="${esc(c.loc)}"${tip(`Fit the ${c.item.name}${cur ? ` (the ${cur.name} comes off and goes where it came from)` : ""}.`)}>Fit</button></div>`;
    }).join("");
    const kids = cur && modDefOf(cur.key) && modDefOf(cur.key).adds ? modDefOf(cur.key).adds.filter((s) => gun.mods && gun.mods[s]) : [];
    const removeRow = cur ? `<div class="gbrow${g.hover === "remove" ? " hov" : ""}" data-gbhover="remove"><span><b>Remove the ${esc(cur.name)}</b><br><span class="gbd">${esc(deltaText(now, statsOf(withPart(gun, g.slot, null))) || "no change")}${kids.length ? ` · ${kids.map((s) => gun.mods[s].name).join(", ")} come${kids.length === 1 ? "s" : ""} off first` : ""}</span></span><button class="mini" data-action="gb-strip" data-slot="${g.slot}"${tip("Take it off: into the armory or the team's cargo where there is one, else a pocket or the pack.")}>Remove</button></div>` : "";
    listHtml = `<div><div class="spread"><b>${esc(SLOT_NAMES[g.slot] || g.slot)}</b><button class="mini" data-action="gb-slot" data-slot=""${tip("Close the list")}>✕</button></div>
      ${removeRow}${rowsHtml || `<div class="small muted" style="margin:0.3rem 0">No part within reach fits this socket. Parts must be on someone here (a pocket or the pack) or in ${parseLoc(g.loc).o === "cargo" || (placeOfLoc(state, g.loc) || "").startsWith("party") ? "the team's cargo" : "the armory"}. Gun stores, police stations, the National Guard and soldiers' guns have them; traders sell some.</div>`}</div>`;
  } else {
    listHtml = `<div class="small muted">Click a slot on the gun to see the parts within reach that fit it, with what each one changes. Hover a part to compare the stats. Fitting and taking parts off takes no time.${slots.length ? "" : " This gun takes no parts."}</div>`;
  }
  const plat = platformOf(gun.key);
  const platName = DGM.PLATFORMS && DGM.PLATFORMS[plat] && DGM.PLATFORMS[plat].name;
  return `<div class="box wide gbbox">
    <div class="spread"><h1>Gun builder: ${esc(gun.name)}</h1><span class="muted">${esc(whereText(state, g.loc))}${platName ? ` · ${esc(platName)}` : ""}</span></div>
    ${repairRow(state, g)}
    ${g.msg ? `<div class="result small">${esc(g.msg)}</div>` : ""}
    <div class="gbwrap">${img}<svg viewBox="0 0 ${V.W} ${V.H}" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">${lines}</svg>${boxes}</div>
    <div class="gbcols"><div>${listHtml}</div>${statsHtml}</div>
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary" data-action="gb-close">Done</button></div>
  </div>`;
}

// The compact version for the item's hover text (ui/inventory.js itemTip): its slots and what is in them.
export function gunTipText(gun) {
  if (!gun || !isGunKey(gun.key)) return "";
  const slots = slotsOf(gun);
  const s = statsOf(gun);
  const bits = [];
  if (slots.length) bits.push(`slots: ${slots.map((x) => `${(SLOT_NAMES[x] || x).toLowerCase()} (${gun.mods && gun.mods[x] ? gun.mods[x].name : "empty"})`).join(", ")}; Modify (⚙) to change them`);
  if (s.cal && CALIBERS[s.cal]) bits.push(`loaded with ${s.load === "auto" ? "the best to hand" : `${CALIBERS[s.cal].name} ${AMMO_TYPES[s.type] ? AMMO_TYPES[s.type].name : s.type}`}`);
  bits.push(reliabilityText(gun, s));
  return bits.join(". ");
}

// ---------- actions (wired in main.js) ----------
// The gun at ui.gunb.loc moved in its list (a part taken out of the same armory before it): find it again.
function relocate(state, ui, gun) {
  const g = ui.gunb;
  if (!g || itemAt(state, g.loc) === gun) return;
  const L = parseLoc(g.loc);
  const st = L.o === "armory" || L.o === "cargo" ? storageFor(state, `${L.o === "armory" ? "base" : "party"}:${L.id}`) : null;
  const i = st ? st.list.indexOf(gun) : -1;
  const was = g.loc;
  g.loc = i >= 0 ? `${L.o}:${L.id}:list:${i}` : g.loc;
  if (ui.invSel === was) ui.invSel = g.loc;
}
// The Repair button (sim/repair.js): at a base the gun goes on the bench queue and is mended where it is; on the road a
// field repair kit does it now. "" for a gun that cannot be repaired here at all.
function repairRow(state, g) {
  let r;
  try { r = repairInfoAt(state, g.loc); } catch { return ""; }
  if (!r || (!r.kind && !r.ok)) return "";
  const queueable = r.base && (r.ok || (!r.who && /Craft role/.test(r.reason || "")));
  const ok = queueable || (!r.base && r.ok);
  return `<div class="row small" style="margin-top:0.4rem;gap:0.4rem"><button class="mini" data-action="gb-repair" ${ok ? "" : "disabled"}${tip(`${r.base ? "Repair at the bench" : "Field repair with a repair kit"}: ${r.preview || r.reason || ""}`)}>Repair${r.kind ? ` (max ${Math.round(r.oldMax)} → ${Math.round(r.newMax)})` : ""}</button>${ok ? "" : `<span class="muted">${esc(r.reason || "")}</span>`}</div>`;
}
export const GB_ACTIONS = {
  // d.loc: the gun; d.slot: open with that slot's list; d.sid: whose inventory.
  "gb-open": (state, ui, d) => {
    if (state.combat) { ui.invMsg = "Not during a battle: change parts after the fight."; return; }
    const gun = itemAt(state, d.loc);
    if (!gun || !isGunKey(gun.key)) return;
    const sid = d.sid != null && d.sid !== "" ? Number(d.sid) : ui.inv && ui.inv.sid != null ? ui.inv.sid : parseLoc(d.loc).o === "s" ? parseLoc(d.loc).id : null;
    ui.gunb = { loc: d.loc, slot: d.slot || null, hover: null, sid, msg: "" };
  },
  "gb-close": (state, ui) => { ui.gunb = null; },
  "gb-slot": (state, ui, d) => { if (ui.gunb) { ui.gunb.slot = d.slot && ui.gunb.slot !== d.slot ? d.slot : null; ui.gunb.hover = null; } },
  "gb-fit": (state, ui, d) => {
    const g = ui.gunb;
    if (!g || state.combat) return;
    const gun = itemAt(state, g.loc);
    if (!gun) return;
    g.msg = fitPart(state, g.loc, d.slot || g.slot, d.part, g.sid);
    relocate(state, ui, gun);
    g.hover = null;
  },
  "gb-repair": (state, ui) => {
    const g = ui.gunb;
    if (!g || state.combat) return;
    const gun = itemAt(state, g.loc);
    if (!gun) return;
    g.msg = repairAt(state, g.loc);
    relocate(state, ui, gun);
  },
  "gb-strip": (state, ui, d) => {
    const g = ui.gunb;
    if (!g || state.combat) return;
    const gun = itemAt(state, g.loc);
    if (!gun) return;
    g.msg = stripPart(state, g.loc, d.slot || g.slot, g.sid);
    relocate(state, ui, gun);
    g.hover = null;
  },
  // The part row under the mouse (main.js mouseover on [data-gbhover]); returns true when it changed.
  "gb-hover": (state, ui, d) => { if (!ui.gunb) return false; const v = d && d.v ? d.v : null; if (ui.gunb.hover === v) return false; ui.gunb.hover = v; return true; },
};
export const GB_CHANGE = {
  // The round it is loaded with (item.load: a type key, null for the standard round, "auto").
  "gb-load": (state, ui, el) => {
    const gun = ui.gunb && itemAt(state, ui.gunb.loc);
    if (!gun) return;
    const v = String(el.value || "");
    const ok = v === "" || v === "auto" || loadChoices(gun).some(([x]) => x === v);
    if (!ok) return;
    if (v === "") delete gun.load; else gun.load = v;
    ui.gunb.msg = `The ${gun.name} is loaded with ${(loadChoices(gun).find(([x]) => x === v) || ["", "the standard round"])[1].replace(/ \(standard\)$/, "")}${v === "auto" ? "" : " rounds"} when there are any.`;
  },
};

// The Help topic (ui/ui.js helpText).
export const GUNBUILDER_HELP = `<b>Gun builder:</b> select a gun in the inventory and press <i>Modify</i> (or the ⚙ on the gun in someone's hands or in
  the armory; the base's Armory tab has it too). It shows the gun large, with a line from each slot on it (sight, mount,
  muzzle, magazine, under the barrel, stock, grip, rail, light or laser, bipod, sling: the ones that gun has) to a box
  saying what is fitted there. Click a box for every part within reach that fits that slot (on anyone at the same base or
  on the same team, in a pocket or the pack, or in the armory or the team's cargo), each with what it changes, and Fit
  it; Remove takes the fitted one off (into the armory or the cargo, else a pocket or the pack). Some parts open more
  slots: a scope mount gives a sight slot, a rail handguard a grip, a light and a bipod (their boxes appear with a dotted
  line once it is on). Hover a part to see the stats change, before → after: aim, aim up close, best range and fall-off,
  damage, magazine, noise (and how far a shot is heard), weight, worth, the loaded round's penetration, and reliability
  (how often it jams or misfires). The Ammo list picks the round it is loaded with. Not during a battle.`;
