// Gun parts as drawings (user 2026-10-10: fitted parts on the gun in battle; new attachments need only a category):
//   - PART_ART: every part look, look name -> (p, [x, y] anchor, ctx) painter on the big drawing (64 × 24; ui/gunart.js
//     adds its hand-drawn looks to this same object; the data-driven ones are compiled here, "p:<part key>");
//   - lookOf(part, slot): a part's look: its GEAR look, MOD_LOOK (the hand-drawn ones by key), else a data-driven look
//     from PART_SPEC (ui/gunspecs.js: { kind, ...size, colour }) or, for a part nobody drew, its kind guessed from its
//     slot and the words in its key and name (a "budget red dot", a "9mm suppressor", a "weapon light / laser combo");
//   - PART_KINDS: the kinds, each a painter with its sizes and colours as options (o) and its small drawing (mini) for
//     the gun held in battle and dropped (ui/gunpaint.js paintMini);
//   - gunLook / weaponLook: a gun item (or a battle unit's gun) as { key, finish, looks } and as one short string, the
//     cache key of the sprites that show it (ui/sprites.js, ui/downsprites.js); held(p, look, form, R) paints it small.
// Optics draw up from their anchor, muzzle devices right, magazines, grips, lights and bipods down, stocks left.
import { GEAR } from "../sim/data.js";
import { ATTACH } from "../sim/gunmods.js";
import { finishOf, unitFinish } from "../sim/data-finish.js";
import { C, R, H, dots, grip, magShape, stockShape, STOCKS, MAGS, LOOK_STOCK, LOOK_MAG, paintMini, isGunKey } from "./gunpaint.js";
import { PART_SPEC } from "./gunspecs.js";

/** @type {Record<string, Function>} */
export const PART_ART = {};
const col = (c, d) => (c == null ? d : C[c] || c);

// ---------- the kinds ----------
// o: the part's spec (PART_SPEC) with its kind's defaults. mini: what the small drawing shows (gunpaint.js paintMini).
const scopeShape = (p, [x, y], len, bell, c, lens = C.glass) => {
  R(p, x - len, y - 3, x + len, y - 2, c);
  R(p, x - len - 1, y - 4, x - len + 1, y - 1, c);
  R(p, x + len - 1, y - 3 - bell, x + len + 1, y - 1, c);
  p.set(x + len + 1, y - 2, lens); p.set(x, y - 4, c); p.set(x, y - 5 + (bell > 1 ? 0 : 1), c);
  p.set(x - Math.floor(len / 2), y - 1, C.dark); p.set(x + Math.floor(len / 2), y - 1, C.dark);
};
export const PART_KINDS = {
  // sights
  dot:       { slot: "optic", mini: "dot", d: { len: 2, col: "gun", lens: "red" }, draw: (p, [x, y], o) => { const c = col(o.col); H(p, x - o.len, x + o.len, y - 1, C.dark); R(p, x - o.len, y - 3, x + o.len, y - 2, c); p.set(x + o.len, y - 3, col(o.lens)); p.set(x - o.len, y - 3, C.glass); } },
  holo:      { slot: "optic", mini: "dot", d: { len: 3, col: "gun" }, draw: (p, [x, y], o) => { R(p, x - o.len, y - 4, x + o.len, y - 1, col(o.col)); R(p, x - o.len + 1, y - 3, x + o.len - 2, y - 2, C.glass); p.set(x - 1, y - 3, C.red); } },
  mini:      { slot: "optic", mini: "dot", d: { len: 2, col: "gun" }, draw: (p, [x, y], o) => { R(p, x - o.len, y - 2, x + o.len - 1, y - 1, col(o.col)); p.set(x + o.len - 1, y - 2, C.red); } },
  prism:     { slot: "optic", mini: "prism", d: { len: 4, col: "gun" }, draw: (p, [x, y], o) => { const c = col(o.col); R(p, x - o.len, y - 3, x + o.len - 1, y - 1, c); R(p, x + o.len - 1, y - 4, x + o.len, y - 1, c); p.set(x + o.len, y - 3, C.glass); p.set(x - 1, y - 4, C.red); } },
  scope:     { slot: "optic", mini: "scope", d: { len: 5, bell: 1, col: "gun" }, draw: (p, a, o) => scopeShape(p, a, o.len, o.bell, col(o.col), col(o.lens, C.glass)) },
  magnifier: { slot: "optic", mini: "dot", d: { len: 2, col: "gun" }, draw: (p, [x, y], o) => { const c = col(o.col); R(p, x - o.len - 6, y - 3, x - 6 + o.len, y - 2, c); R(p, x - 7, y - 1, x - 6, y - 1, C.dark); p.set(x - 6 + o.len + 1, y - 3, C.glass); } }, // behind the red dot, on its flip mount
  thermal:   { slot: "optic", mini: "scope", d: { col: "olive" }, draw: (p, [x, y], o) => { R(p, x - 5, y - 4, x + 4, y - 1, col(o.col)); R(p, x + 5, y - 3, x + 6, y - 2, "#a04040"); dots(p, x - 4, x + 3, y - 4, C.oliveL); } },
  irons:     { slot: "optic", mini: null, d: { col: "gun" }, draw: (p, [x, y], o) => { R(p, x - 1, y - 2, x + 1, y - 1, col(o.col)); p.clear(x, y - 2); } },
  mount:     { slot: "mount", mini: null, d: { len: 4 }, draw: (p, [x, y], o) => { H(p, x - o.len, x + o.len, y - 1, C.dark); dots(p, x - o.len, x + o.len, y - 1, C.hi); } },
  // muzzle devices
  can:       { slot: "muzzle", mini: "can", d: { len: 7, rows: 4, col: "gun" }, draw: (p, [x, y], o) => { const c = col(o.col); R(p, x + 1, y - 1, x + o.len, y + o.rows - 2, c); H(p, x + 2, x + o.len - 1, y - 1, C.hi); if (o.bands) for (let i = 3; i < o.len; i += 3) R(p, x + i, y - 1, x + i, y + o.rows - 2, C.dark); } },
  brake:     { slot: "muzzle", mini: "brake", d: { len: 3, col: "gun" }, draw: (p, [x, y], o) => { R(p, x + 1, y - 1, x + o.len, y + 2, col(o.col)); for (let i = 2; i < o.len + 1; i += 2) { p.set(x + i, y - 1, C.dark); p.set(x + i, y + 2, C.dark); } } },
  comp:      { slot: "muzzle", mini: "brake", d: { len: 2, col: "gun" }, draw: (p, [x, y], o) => { R(p, x + 1, y - 1, x + o.len, y + 1, col(o.col)); p.set(x + o.len, y - 1, C.dark); } },
  choke:     { slot: "muzzle", mini: null, d: { len: 2, col: "metal" }, draw: (p, [x, y], o) => R(p, x + 1, y, x + o.len, y + 1, col(o.col)) },
  fh:        { slot: "muzzle", mini: null, d: { len: 3, col: "gun" }, draw: (p, [x, y], o) => { R(p, x + 1, y - 1, x + o.len, y + 2, col(o.col)); p.clear(x + 2, y - 1); } },
  // under the barrel and on the rails
  vgrip:     { slot: "grip", mini: "grip", d: { len: 5, col: "gun" }, draw: (p, [x, y], o) => R(p, x - 1, y + 1, x + 1, y + o.len, col(o.col)) },
  agrip:     { slot: "grip", mini: "grip", d: { col: "gun" }, draw: (p, [x, y], o) => { for (let i = 0; i < 3; i++) H(p, x - 2 + i, x + 1 + i, y + 1 + i, col(o.col)); } },
  stop:      { slot: "grip", mini: null, d: { col: "gun" }, draw: (p, [x, y], o) => R(p, x, y + 1, x + 1, y + 2, col(o.col)) }, // a hand stop
  laser:     { slot: "tactical", mini: "laser", d: { col: "gun", beam: "red" }, draw: (p, [x, y], o) => { R(p, x - 2, y + 1, x + 2, y + 2, col(o.col)); p.set(x + 2, y + 1, col(o.beam)); } },
  light:     { slot: "tactical", mini: "light", d: { len: 2, col: "gun" }, draw: (p, [x, y], o) => { const c = col(o.col); R(p, x - o.len, y, x + o.len, y + 1, c); R(p, x + o.len + 1, y - 1, x + o.len + 1, y + 2, c); p.set(x + o.len + 1, y, "#f4f0c8"); p.set(x + o.len + 1, y + 1, "#f4f0c8"); } },
  combo:     { slot: "tactical", mini: "laser", d: { col: "tanD", beam: "red" }, draw: (p, [x, y], o) => { R(p, x - 3, y - 1, x + 2, y + 1, col(o.col)); p.set(x + 2, y - 1, C.glass); p.set(x + 2, y + 1, col(o.beam)); } },
  bipod:     { slot: "bipod", mini: "bipod", d: { len: 6, col: "gun" }, draw: (p, [x, y], o) => { const c = col(o.col); H(p, x - 1, x + 1, y + 1, c); for (let i = 1; i <= o.len; i++) { p.set(x - 1 - Math.floor(i / 2), y + 1 + i, c); p.set(x + 1 + Math.floor(i / 2), y + 1 + i, c); } } },
  launcher:  { slot: "under", mini: "gl", d: { len: 6, col: "olive" }, draw: (p, [x, y], o) => { R(p, x - o.len - 1, y + 1, x + o.len - 1, y + 3, col(o.col)); H(p, x - o.len - 1, x + o.len - 1, y + 1, C.oliveL); p.set(x - o.len + 1, y + 4, C.gun); } },
  rail:      { slot: "rail", mini: null, d: { len: 6 }, draw: (p, [x, y], o) => { R(p, x - o.len, y - 1, x + o.len, y + 1, C.dark); dots(p, x - o.len, x + o.len, y - 1, C.hi); dots(p, x - o.len + 1, x + o.len - 1, y + 1, C.hi); } },
  // shells on the receiver's side (a pump's side saddle): from the receiver's sight anchor down
  saddle:    { slot: "rail", mini: "saddle", d: { n: 4 }, draw: (p, [x, y], o, ctx) => { const a = (ctx && ctx.art && (ctx.art.anchors.mount || ctx.art.anchors.optic)) || [x, y]; const x0 = a[0] - o.n, y0 = a[1] + 2; R(p, x0, y0, x0 + o.n * 2 - 1, y0 + 2, C.dark); for (let i = 0; i < o.n; i++) { p.set(x0 + i * 2, y0, C.shell); p.set(x0 + i * 2, y0 + 1, C.shell); p.set(x0 + i * 2, y0 + 2, C.brass); } } },
  sling:     { slot: "sling", mini: null, d: { col: "sling" }, draw: (p, [x, y], o) => { for (let i = 0; i <= 12; i++) p.set(x - i, y + 2 + Math.round(3 * Math.sin((Math.PI * i) / 12)), col(o.col)); p.set(x, y + 1, C.metal); } },
  // stocks and magazines: gunpaint.js STOCKS / MAGS by o.t
  stock:     { slot: "stock", mini: "stock", d: { t: "tele" }, draw: (p, a, o) => (STOCKS[o.t] || STOCKS.tele).draw(p, a, o.col || o.c || "gun") },
  mag:       { slot: "mag", mini: "mag", d: { t: "stick", n: 8, w: 4, curve: 3 }, draw: (p, a, o) => (MAGS[o.t] || MAGS.stick).draw(p, a, o) },
  grips:     { slot: "grip", mini: null, d: { col: "wood", n: 9 }, draw: (p, [x, y], o) => grip(p, x + 1, y - 1, o.n, 4, col(o.col), 3) }, // a revolver's grips
};

// ---------- a part nobody drew: its kind from its slot and its words ----------
/** @param {string} key @param {string} [slot] */
export function guessPart(key, slot) {
  const a = ATTACH[key] || {}, g = GEAR[key] || {};
  const s = slot || a.slot || a.mount || "";
  const t = `${key} ${g.name || ""} ${a.short || ""}`.toLowerCase();
  if (s === "optic") {
    if (/thermal/.test(t)) return { kind: "thermal" };
    if (/magnif/.test(t)) return { kind: "magnifier" };
    if (/lpvo|1-[468]|1–[468]/.test(t)) return { kind: "scope", len: 6, bell: 1 };
    if (/acog|prism/.test(t)) return { kind: "prism" };
    if (/scope|\d+(\.\d+)?x|x\d/.test(t)) return { kind: "scope", len: /long|tac|sniper|\b(1[0-9]|2[0-9])x/.test(t) ? 8 : /hunt|9x|3-9/.test(t) ? 7 : 5, bell: /long|tac|sniper|hunt|9x/.test(t) ? 2 : 1 };
    if (/holo|eotech/.test(t)) return { kind: "holo" };
    if (/rmr|micro|mini|pistol|slide/.test(t)) return { kind: "mini" };
    if (/iron|tritium|night sight|ghost/.test(t)) return { kind: "irons" };
    return { kind: "dot", col: /budget|cheap|clone|china|chinese/.test(t) ? "grey" : undefined };
  }
  if (s === "mount") return { kind: "mount" };
  if (s === "muzzle") {
    if (/can|suppress|silenc|moderat/.test(t)) return { kind: "can", len: /22|9mm|\b9\b|45|pistol|smg/.test(t) ? 5 : /308|7\.62|762|12|shot|50|338/.test(t) ? 9 : 7, rows: /22/.test(t) ? 3 : 4, bands: /oil|solvent/.test(t) };
    if (/brake/.test(t)) return { kind: "brake" };
    if (/comp/.test(t)) return { kind: "comp" };
    if (/choke/.test(t)) return { kind: "choke" };
    if (/flash|hider/.test(t)) return { kind: "fh" };
    return { kind: "brake" };
  }
  if (s === "mag") return { kind: "mag", t: /drum/.test(t) ? "drum" : "stick", n: 9 };
  if (s === "stock") {
    if (/brace/.test(t)) return { kind: "stock", t: "brace" };
    if (/fold/.test(t)) return { kind: "stock", t: "folder" };
    if (/crane|sopmod/.test(t)) return { kind: "stock", t: "crane" };
    if (/skelet|wire/.test(t)) return { kind: "stock", t: "wire" };
    if (/precision|sniper|prs|adjustable cheek/.test(t)) return { kind: "stock", t: "sniper", col: "gun" };
    if (/wood/.test(t)) return { kind: "stock", t: "wood", col: "wood" };
    if (/fixed|a2/.test(t)) return { kind: "stock", t: "a2" };
    return { kind: "stock", t: "tele" };
  }
  if (s === "bipod" || /bipod/.test(t)) return { kind: "bipod" };
  if (/saddle|shell carrier|shell holder/.test(t)) return { kind: "saddle" };
  if (/launcher|m203|40 ?mm|grenade/.test(t)) return { kind: "launcher" };
  if (/combo|peq|dbal|laser.*light|light.*laser/.test(t)) return { kind: "combo" };
  if (/laser/.test(t)) return { kind: "laser" };
  if (/light|lamp|torch/.test(t)) return { kind: "light" };
  if (/angled|afg/.test(t)) return { kind: "agrip" };
  if (/stop/.test(t)) return { kind: "stop" };
  if (/grip/.test(t) && s !== "grip") return { kind: "vgrip" };
  if (s === "grip" || s === "under") return { kind: "vgrip" };
  if (s === "tactical") return { kind: "light" };
  if (s === "rail" || /rail|m-?lok|keymod|handguard/.test(t)) return { kind: "rail" };
  if (s === "sling") return { kind: "sling" };
  return null;
}
// A part's drawing spec: PART_SPEC's, else its guess. { kind, ...options with the kind's defaults }.
export function partSpecOf(key, slot) {
  const s = PART_SPEC[key] || guessPart(key, slot);
  if (!s || !PART_KINDS[s.kind]) return null;
  const o = { ...PART_KINDS[s.kind].d };
  for (const [k, v] of Object.entries(s)) if (v !== undefined) o[k] = v;
  return o;
}
// The data-driven look of a part: "p:<key>", compiled into PART_ART once.
function partLook(key, slot) {
  const name = `p:${key}`;
  if (PART_ART[name]) return name;
  const o = partSpecOf(key, slot);
  if (!o) return null;
  const K = PART_KINDS[o.kind];
  PART_ART[name] = (p, a, ctx) => K.draw(p, a, o, ctx);
  PART_MINI[name] = o.kind === "stock" ? { stock: (STOCKS[o.t] || STOCKS.tele).mini, len: (STOCKS[o.t] || STOCKS.tele).len }
    : o.kind === "mag" ? { mag: (MAGS[o.t] || MAGS.stick).mini, n: o.n }
    : K.mini ? { kind: K.mini, len: o.len, col: o.col ? col(o.col) : null } : null;
  return name;
}

// ---------- looks by key ----------
// The hand-drawn looks by part key (the attachments of today, gunmods.js ATTACH, and of the plan's table).
export const MOD_LOOK = {
  reddot: "reddot", holo: "holo", scope4x: "scope4", laser: "laser", foregrip: "vgrip", bipod: "bipod", pistolcan: "can_s",
  riflecan: "can_l", suppressor: "oilfilter", brake: "brake", comp: "comp", choke: "choke", extmag: "extmag", drum: "drum", tubeext: "tube_ext",
  tritium: "tritium", rmr: "rmr", acog: "acog", lpvo: "lpvo", tacscope: "scope25", thermalscope: "thermal", scrapscope: "scrapscope",
  scopemount: "mount", sidemount: "mount", quadrail: "rail", mlok: "rail", can22: "can_s", can9: "can_s", can556: "can_l", can308: "can_l",
  can12: "can_l", bottlecan: "bottle", solventcan: "can_l", flashhider: "fh", recoilpad: "pad", collapsible: "collapsible", precision: "precision",
  foldstock: "fold", vertgrip: "vgrip", anglegrip: "agrip", revgrip: "revgrip", weaponlight: "light", peq: "peq", sling: "sling", m203: "m203",
  huntscope: "scope9", scope9x: "scope9",
};
export const SLOT_LOOK = { optic: "reddot", mount: "mount", muzzle: "can_s", mag: "stick30", stock: "collapsible", grip: "vgrip", under: "vgrip", tactical: "light", bipod: "bipod", rail: "rail", sling: "sling" };
// The small drawing of each hand-drawn look (gunpaint.js paintMini): { kind } a part's, { stock } / { mag } a stock or
// magazine kind (gunpaint.js STOCKS / MAGS minis). Looks not listed draw nothing small (irons, a mount, a sling).
/** @type {Record<string, any>} */
export const PART_MINI = {
  reddot: { kind: "dot" }, holo: { kind: "dot" }, rmr: { kind: "dot" }, acog: { kind: "prism" }, lpvo: { kind: "scope" }, scope4: { kind: "scope" },
  scope9: { kind: "scope", len: 7 }, scope25: { kind: "scope", len: 8, col: C.olive }, thermal: { kind: "scope", col: C.olive }, scrapscope: { kind: "scope", col: C.pipe },
  can_s: { kind: "can", len: 6 }, can_l: { kind: "can", len: 8 }, oilfilter: { kind: "can", len: 8, col: C.blue }, bottle: { kind: "can", len: 8, col: C.bottle },
  brake: { kind: "brake" }, comp: { kind: "brake" }, brake_ak: { kind: "brake" }, brake_big: { kind: "brake", len: 6 },
  vgrip: { kind: "grip" }, agrip: { kind: "grip" }, revgrip: null, laser: { kind: "laser" }, light: { kind: "light" }, peq: { kind: "laser" },
  bipod: { kind: "bipod" }, m203: { kind: "gl" },
  collapsible: { stock: "tele", len: 12 }, precision: { stock: "fixed", len: 13 }, fold: { stock: "wire", len: 11 }, stock_ar: { stock: "fixed", len: 10 },
  extmag: { mag: "box" }, drum: { mag: "drum" }, stick10: { mag: "box" }, stick20: { mag: "stick" }, stick30: { mag: "stick" }, stick40: { mag: "long" }, tube_ext: null,
};
for (const [look, [t, len]] of Object.entries(LOOK_STOCK)) if (!(look in PART_MINI)) PART_MINI[look] = { stock: t, len };
for (const [look, t] of Object.entries(LOOK_MAG)) if (!(look in PART_MINI)) PART_MINI[look] = { mag: t };

/** A part's look on a gun ({ key } or a key) in a slot. @param {any} part @param {string} [slot] */
export function lookOf(part, slot) {
  const key = typeof part === "string" ? part : part && part.key;
  const g = key && GEAR[key];
  if (g && g.look && (PART_ART[g.look] || g.look in PART_MINI)) return g.look;
  if (MOD_LOOK[key]) return MOD_LOOK[key];
  if (/^mag/.test(String(key))) { const n = Number((/(\d+)/.exec(key) || [])[1]); if (n) return n >= 50 ? "drum" : n > 30 ? "stick40" : n > 20 ? "stick30" : n > 10 ? "stick20" : "stick10"; } // magazine items (section 15)
  return (key && (PART_SPEC[key] || ATTACH[key] || (GEAR[key] && GEAR[key].cat === "gunmod")) && partLook(key, slot)) || SLOT_LOOK[slot] || "reddot";
}
// The parts on an item as looks ({ slot: look }): any slot of item.mods.
export function looksOf(item) {
  const out = {};
  if (item && item.mods) for (const [slot, m] of Object.entries(item.mods)) if (m && m.key) out[slot] = lookOf(m, slot);
  return out;
}

// ---------- a gun as it looks: its finish and its parts ----------
// The gun a battle unit holds: its item (yours; an arsenal enemy's), else the kit gun with the parts it was given.
export const unitGun = (u) => (!u || !u.weapon || u.weapon === "fists" ? null : u.item && u.item.key === u.weapon ? u.item : u.arsItem && u.arsItem.key === u.weapon ? u.arsItem
  : { key: u.weapon, mods: u.gmWeapon === u.weapon ? u.modItems || null : null, finish: unitFinish(u) });
/** { key, finish, looks } of a gun item (null for no gun). @param {any} item */
export function gunLook(item) {
  if (!item || !item.key || !isGunKey(item.key)) return null;
  return { key: item.key, finish: finishOf(item), looks: looksOf(item) };
}
// One string for the sprites' caches: "key", or "key|finish|slot=look,..." (the first finish is left out).
export function weaponLook(item) {
  if (!item) return null;
  if (typeof item === "string") return item;
  const g = gunLook(item);
  if (!g) return item.key || null;
  const first = finishOf({ key: g.key });
  const parts = Object.entries(g.looks).filter(([, l]) => PART_MINI[l]).sort(([a], [b]) => (a < b ? -1 : 1)).map(([s, l]) => `${s}=${l}`).join(",");
  const f = g.finish && g.finish !== first ? g.finish : "";
  return f || parts ? `${g.key}|${f}|${parts}` : g.key;
}
export function parseLook(look) {
  const [key, finish = "", parts = ""] = String(look).split("|");
  const looks = {};
  for (const kv of parts ? parts.split(",") : []) { const [s, l] = kv.split("="); if (s && l) looks[s] = l; }
  return { key, finish: finish || null, looks };
}
// The gun painted small: "held" (in the hand of a 22 × 26 sprite whose body's right edge is R) or "dropped" (a body's
// 26 × 14 grid). Returns the muzzle's grid pixel { mx, my } (the tip of a fitted suppressor or brake), or false.
export function held(p, look, form, R0 = 14) {
  const { key, finish, looks } = parseLook(look);
  return paintMini(p, key, form, R0, { finish, looks, partMini: (l) => PART_MINI[l] || null });
}
export { magShape, stockShape };
