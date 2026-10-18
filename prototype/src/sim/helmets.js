// @ts-check
// Helmets, face shields and helmet mounts (docs/weapons-overhaul-plan.md section 18; data in data-helmets.js).
//
// - HELMETS: each helmet's face cover (built in: a motorcycle helmet's visor, a football helmet's cage, a riot helmet's
//   riot visor), its mounts and how much it muffles your hearing (hearing.js hearRange). Full-shell helmets (motorcycle,
//   riot, football) have no ear mount: with one on, only earplugs (a pocket item: foam, or the makeshift rag plugs a
//   crafter makes from a scrap, data.js ragplugs) protect the ears.
// - Attachments live in item.mods on the helmet (the field gun parts use: itemLoad, itemValue and saves carry them):
//   face (a ballistic or riot visor), nvg (night vision goggles, on a combat or high-cut helmet's shroud, or a hard
//   hat's hobbyist mount), light (a helmet light: a hands-free flashlight, lights.js lightOf), ears (ear muffs,
//   electronic defenders, a team headset), rail (a hard hat's NVG mount, which opens the nvg slot).
//   helmetFitReason / fitHelmetMod / removeHelmetMod on items; fitHelmetAt / stripHelmetAt / helmetChoices at
//   inventory locations (no time; not in the middle of a fight).
// - The face zone (armour.js armourHit): 35% of head hits land on the face. faceOf says what covers it there: nothing
//   with the visor up (u.visorUp, the free Visor toggle in battle) or a broken helmet.
// - Visor aim (combat.js shotOdds): a ballistic visor down −2 aim and a tile of sight (cracked: −4 until raised or
//   taken off); a ballistic or riot visor down in fogging weather (b.visorFog: freezing or rain) −3 more.
// - Enemies (combat.js enemyUnit): a helmet and ear protection by kit (HEAD_KIT, own dice); a group's people wear what
//   their group's arsenal holds (arsenal.js: helmets are armour pieces, ear protection is issued here, issueEars).
//   Bodies drop them (inventory.js enemyBody: dropHeadgear) at the condition they ended the fight in.
// - Loot (own dice: HEAD_FINDS each search hour, AREA_HEAD per raid container, WARE_HEAD on traders' tables): rolled
//   after the attachment tables (loot.js), only when those found nothing, so no other find changes.
import { GEAR } from "./data.js";
import { hash01 } from "./skills.js";
import { lootItem, itemAt, removeAt, parseLoc, placeOfLoc, storageFor, stow, ensureInv, packOf, personPlace } from "./inventory.js";
import { survivorById } from "./world.js";
import { siteSource, areaSource, traderSource } from "./itemcond.js";

// face: the built-in cover ("builtin": bites and blows only; "riot": also AC 1 against shots; "cage": bites and blows
// only, never fogs). mounts: the slots it has. muffle: tiles of hearing it costs (hearing.js).
/** @type {Record<string, { face: string | null, mounts: string[], muffle: number, fullShell?: boolean }>} */
export const HELMETS = {
  hardhat:        { face: null,      mounts: ["face", "rail", "light", "ears"], muffle: 0 },
  footballhelmet: { face: "cage",    mounts: [], muffle: -1, fullShell: true },
  bikehelmet:     { face: "builtin", mounts: [], muffle: -2, fullShell: true },
  riothelmet:     { face: "riot",    mounts: ["light"], muffle: -2, fullShell: true },
  milhelmet:      { face: null,      mounts: ["nvg", "light", "ears"], muffle: 0 },
  highcut:        { face: null,      mounts: ["face", "nvg", "light", "ears"], muffle: 0 },
  rivethelmet:    { face: null,      mounts: [], muffle: -1 },
};
export const MOUNT_NAMES = { face: "Face", nvg: "Night vision", light: "Light", ears: "Ears", rail: "Mount" };
export const MOUNT_ORDER = ["face", "rail", "nvg", "light", "ears"];
// What goes on a helmet: its mount, the helmets it fits (null: any helmet with that mount), the slots it opens.
/** @type {Record<string, { mount: string, fits: string[] | null, adds?: string[], face?: string }>} */
export const HELMET_ATTACH = {
  ballvisor:   { mount: "face", fits: ["highcut"], face: "ballistic" },
  riotvisor:   { mount: "face", fits: ["hardhat", "highcut"], face: "riot" },
  nvgmount:    { mount: "rail", fits: ["hardhat"], adds: ["nvg"] },
  nvg:         { mount: "nvg", fits: null }, // the goggles themselves (a thermal monocular is handheld: never on a helmet)
  helmetlight: { mount: "light", fits: null },
  earmuffs:    { mount: "ears", fits: null },
  eardef:      { mount: "ears", fits: null },
  commset:     { mount: "ears", fits: null },
};
// The face covers: × on bites and blows to the face; the fog (hearing.js / visorAim).
export const FACE = {
  SHARE: 0.35, // of head hits, this share land on the face (the rest on the crown)
  SOFT: { builtin: 0.4, riot: 0.4, cage: 0.4, ballistic: 0.3 }, // × a bite or a blow to the face
  BITE_WEAR: 0.2, // durability points a bite takes off the face cover
  RIOT_AC: 1, // a riot visor against a shot
  AIM: 2, CRACKED: 4, FOG: 3, SIGHT: 1, // a ballistic visor down; cracked; fogged (ballistic or riot); its tile of sight
  FOGS: ["ballistic", "riot"],
};
const nameOf = (k) => (GEAR[k] ? GEAR[k].name : k);
export const isHelmet = (key) => !!HELMETS[key];
export const isHelmetPart = (key) => !!HELMET_ATTACH[key];
export const isEarKey = (key) => !!(GEAR[key] && GEAR[key].ears);
const fitted = (item) => (item && item.mods ? Object.entries(item.mods).filter(([, m]) => m && HELMET_ATTACH[m.key]) : []);

// ---------- what fits ----------
// The mounts open on a helmet now: its own, and those its fitted parts open (a hard hat's NVG mount: the nvg slot).
export function helmetSlots(item) {
  const H = item && HELMETS[item.key];
  if (!H) return [];
  const out = new Set(H.mounts);
  for (const [, m] of fitted(item)) for (const a of HELMET_ATTACH[m.key].adds || []) out.add(a);
  return MOUNT_ORDER.filter((s) => out.has(s));
}
// Why this part cannot go on this helmet ("" when it can; whatever is on that mount now comes off).
export function helmetFitReason(helmet, part) {
  const a = part && HELMET_ATTACH[part.key];
  if (!helmet || !HELMETS[helmet.key]) return "No helmet to fit it to.";
  const hn = nameOf(helmet.key).toLowerCase();
  if (part && part.key === "thermal") return "A thermal monocular is held in the hand: it does not go on a helmet.";
  if (!a) return `The ${part ? part.name : "that"} does not go on a helmet.`;
  if (a.fits && !a.fits.includes(helmet.key)) return `The ${part.name} does not fit a ${hn}.`;
  const H = HELMETS[helmet.key];
  if (a.mount === "ears" && H.fullShell) return `The ${hn} is a full shell: no room for anything over the ears (earplugs still work).`;
  const open = new Set(H.mounts);
  for (const [slot, m] of fitted(helmet)) if (slot !== a.mount) for (const x of HELMET_ATTACH[m.key].adds || []) open.add(x);
  if (!open.has(a.mount)) {
    const opener = Object.keys(HELMET_ATTACH).find((k) => (HELMET_ATTACH[k].adds || []).includes(a.mount) && (!HELMET_ATTACH[k].fits || HELMET_ATTACH[k].fits.includes(helmet.key)));
    return `The ${hn} has no ${MOUNT_NAMES[a.mount].toLowerCase()} mount${opener ? `: fit a ${nameOf(opener).toLowerCase()} first` : ""}.`;
  }
  return "";
}
// Fits a part to a helmet: { ok, why, off } (off: what came off that mount, and what it carried).
export function fitHelmetMod(helmet, part) {
  const why = helmetFitReason(helmet, part);
  if (why) return { ok: false, why, off: [] };
  const slot = HELMET_ATTACH[part.key].mount;
  const off = removeHelmetMod(helmet, slot);
  helmet.mods = helmet.mods || {};
  helmet.mods[slot] = part;
  return { ok: true, why: "", off };
}
// Takes a mount's part off (and whatever sits on the slots it opened, those first). Returns them ([]: nothing there).
export function removeHelmetMod(helmet, slot) {
  if (!helmet || !helmet.mods || !helmet.mods[slot]) return [];
  const out = [];
  const m = helmet.mods[slot];
  for (const c of (HELMET_ATTACH[m.key] && HELMET_ATTACH[m.key].adds) || []) out.push(...removeHelmetMod(helmet, c));
  delete helmet.mods[slot];
  if (!Object.keys(helmet.mods).length) delete helmet.mods;
  out.push(m);
  return out;
}
export const helmetMods = (item) => Object.fromEntries(fitted(item));
export const helmetLabel = (item) => {
  const parts = fitted(item).map(([, m]) => (m.name || nameOf(m.key)).toLowerCase());
  return parts.length ? `${item.name} (${parts.join(", ")})` : item.name;
};

// ---------- at inventory locations ----------
// Who can reach a helmet at a location: { holder, st } (a body's helmet: take it first).
function reach(state, loc, sid) {
  const L = parseLoc(loc);
  if (L.o === "body") return null;
  const place = placeOfLoc(state, L);
  const holder = L.o === "s" ? survivorById(state, L.id) : sid != null ? survivorById(state, sid) : null;
  const near = holder && place && personPlace(holder) === place ? holder : null;
  return { holder: L.o === "s" ? holder : near, st: place ? storageFor(state, place) : null };
}
// Loose parts within reach that fit the helmet at helmLoc: [{ loc, item }].
export function helmetChoices(state, helmLoc, sid = null) {
  const helm = itemAt(state, helmLoc);
  const r = helm && isHelmet(helm.key) ? reach(state, helmLoc, sid) : null;
  if (!r) return [];
  const out = [];
  const fits = (it) => it && it !== helm && isHelmetPart(it.key) && !helmetFitReason(helm, it);
  if (r.holder) {
    ensureInv(r.holder);
    const pre = `s:${r.holder.id}`;
    r.holder.pockets.forEach((it, i) => { if (fits(it)) out.push({ loc: `${pre}:pocket:${i}`, item: it }); });
    (packOf(r.holder) || []).forEach((it, i) => { if (fits(it)) out.push({ loc: `${pre}:pack:${i}`, item: it }); });
    for (const slot of ["tool", "head"]) if (r.holder.gear[slot] !== helm && fits(r.holder.gear[slot])) out.push({ loc: `${pre}:${slot}`, item: r.holder.gear[slot] });
  }
  if (r.st) r.st.list.forEach((it, i) => { if (fits(it)) out.push({ loc: `${r.st.o}:${r.st.id}:list:${i}`, item: it }); });
  return out;
}
// Fits the part at partLoc to the helmet at helmLoc. What was on that mount goes to the place's storage, else onto
// the holder. Returns a message.
export function fitHelmetAt(state, helmLoc, partLoc, sid = null) {
  const helm = itemAt(state, helmLoc), part = itemAt(state, partLoc);
  if (!helm || !part) return "Nothing to fit.";
  if (helm === part) return "That is the helmet.";
  if (state.combat && !state.combat.over) return "Not in the middle of a fight.";
  const why = helmetFitReason(helm, part);
  if (why) return why;
  if (parseLoc(partLoc).o === "body" || parseLoc(helmLoc).o === "body") return "Take them off the body first.";
  if (placeOfLoc(state, helmLoc) !== placeOfLoc(state, partLoc)) return "The helmet and the part are not in the same place.";
  const r = reach(state, helmLoc, sid);
  const before = helm.mods ? { ...helm.mods } : null;
  removeAt(state, partLoc);
  const res = fitHelmetMod(helm, part);
  const placed = [];
  for (const [i, x] of res.off.entries()) {
    if (r && r.st) { r.st.list.push(x); placed.push(() => r.st.list.splice(r.st.list.indexOf(x), 1)); continue; }
    if (i === 0 && putAt(state, partLoc, x)) { placed.push(() => removeAt(state, partLoc)); continue; }
    if (r && r.holder && stow(r.holder, x)) { placed.push(() => unstow(r.holder, x)); continue; }
    for (const undo of placed) undo(); // no room for what came off: nothing changes
    if (before) helm.mods = before; else delete helm.mods;
    putAt(state, partLoc, part);
    return `No room for the ${x.name}: free a pocket or a pack slot first.`;
  }
  return `${part.name} fitted to the ${helm.name}${res.off.length ? ` (the ${res.off.map((x) => x.name).join(" and the ")} came off)` : ""}.`;
}
// Takes a mount's part off the helmet at helmLoc: into the place's storage, else onto the holder. Returns a message.
export function stripHelmetAt(state, helmLoc, mount, sid = null) {
  const helm = itemAt(state, helmLoc);
  if (!helm || !helm.mods || !helm.mods[mount]) return "Nothing fitted there.";
  if (state.combat && !state.combat.over) return "Not in the middle of a fight.";
  const r = reach(state, helmLoc, sid);
  if (!r) return "Take the helmet off the body first.";
  const before = { ...helm.mods };
  const list = removeHelmetMod(helm, mount);
  const what = list.map((x) => x.name).join(" and the ");
  if (r.st) { r.st.list.push(...list); return `${what} taken off the ${helm.name}: into ${r.st.name}.`; }
  if (r.holder) {
    const put = [];
    for (const x of list) { if (stow(r.holder, x)) put.push(x); else break; }
    if (put.length === list.length) return `${what} taken off the ${helm.name}: ${r.holder.name.split(" ")[0]} carries ${list.length > 1 ? "them" : "it"}.`;
    for (const x of put) unstow(r.holder, x);
  }
  helm.mods = before;
  return `No room for the ${list[list.length - 1].name}: free a pocket or a pack slot first.`;
}
// Puts an item back at an empty location (where a fitted part came from). False when it cannot go there.
function putAt(state, loc, x) {
  const L = parseLoc(loc);
  if (L.o === "armory" || L.o === "cargo") { const st = storageFor(state, placeOfLoc(state, L)); if (!st) return false; st.list.push(x); return true; }
  if (L.o !== "s") return false;
  const h = survivorById(state, L.id);
  if (!h) return false;
  ensureInv(h);
  if (L.slot === "pocket") { if (h.pockets[L.i] || !(GEAR[x.key] && GEAR[x.key].small)) return false; h.pockets[L.i] = x; return true; }
  if (L.slot === "pack") { const pk = packOf(h); if (!pk || pk[L.i]) return false; pk[L.i] = x; return true; }
  if (h.gear[L.slot] || !GEAR[x.key] || GEAR[x.key].slot !== L.slot) return false;
  h.gear[L.slot] = x;
  return true;
}
function unstow(h, item) {
  for (const k of Object.keys(h.gear)) if (h.gear[k] === item) { h.gear[k] = null; return; }
  const i = h.pockets.indexOf(item);
  if (i >= 0) { h.pockets[i] = null; return; }
  const pk = packOf(h);
  const j = pk ? pk.indexOf(item) : -1;
  if (j >= 0) pk[j] = null;
}

// ---------- on a person ----------
const headOf = (s) => (s && s.gear && s.gear.head) || null;
export const helmetOf = (s) => { const h = headOf(s); return h && isHelmet(h.key) ? h : null; };
// Night vision on the helmet (stealth.js: u.nvg; the off hand stays free).
export function helmetNvg(s) {
  const h = helmetOf(s);
  return !!(h && h.mods && h.mods.nvg && h.mods.nvg.key === "nvg" && helmetSlots(h).includes("nvg"));
}
// A light on the helmet (lights.js lightOf: a hands-free flashlight).
export function helmetLight(s) {
  const h = helmetOf(s);
  return !!(h && h.mods && h.mods.light && h.mods.light.key === "helmetlight");
}
// Everything a person carries (worn, the helmet's parts, pockets, pack).
function carried(s) {
  const out = [];
  if (!s || !s.gear) return out;
  for (const it of Object.values(s.gear)) if (it) out.push(it);
  const h = helmetOf(s);
  if (h && h.mods) for (const m of Object.values(h.mods)) if (m) out.push(m);
  for (const it of s.pockets || []) if (it) out.push(it);
  for (const it of packOf(s) || []) if (it) out.push(it);
  return out;
}
// The ear protection a person has working: on the head, on the helmet's ear mount, or earplugs carried (pockets or
// pack). The best of them: { key, item, cut, hear, elec, link } or null.
export function earGearOf(s) {
  let best = null;
  const h = headOf(s);
  const helm = helmetOf(s);
  for (const it of carried(s)) {
    const e = GEAR[it.key] && GEAR[it.key].ears;
    if (!e || (it.dur != null && it.dur <= 0)) continue;
    const plugs = !GEAR[it.key].slot || GEAR[it.key].slot === "pack";
    const onHead = it === h || (helm && helm.mods && helm.mods.ears === it);
    if (!plugs && !onHead) continue; // muffs and headsets only work worn
    const v = { key: it.key, item: it, cut: e.cut || 0, hear: e.hear || 0, elec: !!e.elec, link: !!e.link };
    if (!best || v.cut > best.cut || (v.cut === best.cut && v.hear > best.hear)) best = v;
  }
  return best;
}
export const earsOfKey = (key) => {
  const e = key && GEAR[key] && GEAR[key].ears;
  return e ? { key, item: null, cut: e.cut || 0, hear: e.hear || 0, elec: !!e.elec, link: !!e.link } : null;
};
// What covers the face of a battle unit now: { kind, item, cracked } or null (visor up, no helmet, a broken helmet).
// The helmet is the unit's head piece (armour.js u.pieces.head).
export function faceOf(t) {
  if (!t || t.visorUp) return null;
  const h = t.pieces && t.pieces.head;
  if (!h || !HELMETS[h.key] || h.shattered || (h.dur != null && h.dur <= 0)) return null;
  const m = h.mods && h.mods.face;
  if (m && HELMET_ATTACH[m.key]) return { kind: HELMET_ATTACH[m.key].face || "riot", item: m, cracked: !!(m.shattered || (m.dur != null && m.dur <= 0)) };
  const f = HELMETS[h.key].face;
  return f ? { kind: f, item: null, cracked: false } : null;
}
// Does the unit have a visor it could raise or lower?
export function hasVisor(t) {
  const h = t && t.pieces && t.pieces.head;
  if (!h || !HELMETS[h.key]) return false;
  return !!((h.mods && h.mods.face) || (HELMETS[h.key].face && HELMETS[h.key].face !== "cage"));
}
// The aim a lowered visor costs (combat.js shotOdds).
export function visorAim(a, b) {
  const f = faceOf(a);
  if (!f) return 0;
  let v = 0;
  if (f.kind === "ballistic") v -= f.cracked ? FACE.CRACKED : FACE.AIM;
  if (b && b.visorFog && FACE.FOGS.includes(f.kind)) v -= FACE.FOG;
  return v;
}
// The tile of sight a lowered ballistic visor costs (combat.js sightRange: u.vsight).
export function syncVisorSight(u) {
  const f = faceOf(u);
  u.vsight = f && f.kind === "ballistic" ? -FACE.SIGHT : 0;
}
// The free Visor toggle in battle (combatAct "visor"). Returns "" or why not.
export function visorRefusal(u) {
  return hasVisor(u) ? "" : "No visor to raise or lower.";
}
export function toggleVisor(b, u) {
  const why = visorRefusal(u);
  if (why) return why;
  u.visorUp = !u.visorUp;
  syncVisorSight(u);
  return "";
}

// ---------- enemies ----------
// A helmet and ear protection by kit (combat.js KITS): [key, chance] in turn (one helmet at most), and ear protection
// (only where the helmet leaves room: none under a full shell).
export const HEAD_KIT = {
  soldiers: { helm: [["highcut", 0.15], ["milhelmet", 0.6]], ears: [["commset", 0.3]] },
  contractors: { helm: [["highcut", 0.2], ["milhelmet", 0.5]], ears: [["commset", 0.2], ["eardef", 0.1]] },
  guards: { helm: [["riothelmet", 0.3]], ears: [["eardef", 0.1]] },
  raiders: { helm: [["bikehelmet", 0.15], ["hardhat", 0.1]], ears: [["earmuffs", 0.1]] },
  militia: { helm: [["hardhat", 0.1]], ears: [] },
  preppers: { helm: [["milhelmet", 0.6], ["highcut", 0.1]], ears: [["earmuffs", 0.2]] }, // nomads.js T3
  looters: { helm: [["bikehelmet", 0.1]], ears: [] },
};
// Rolls a kit's headgear on dice of its own: { helm, ears } (keys or null).
export function rollHeadKit(kind, ...seed) {
  const K = HEAD_KIT[kind];
  if (!K) return { helm: null, ears: null };
  let helm = null, acc = 0;
  const r = hash01("headkit", kind, ...seed);
  for (const [k, p] of K.helm) { acc += p; if (r < acc) { helm = k; break; } }
  let ears = null;
  acc = 0;
  const r2 = hash01("earkit", kind, ...seed);
  for (const [k, p] of K.ears) { acc += p; if (r2 < acc) { ears = k; break; } }
  if (ears && helm && HELMETS[helm].fullShell && GEAR[ears].slot !== "pack") ears = null;
  return { helm, ears };
}
// combat.js enemyUnit: the unit's helmet (u.helmKey: armour.js enemyPieces makes the piece) and ears (u.earKey).
export function kitHeadgear(u, kind, seed) {
  if (!u || u.kind !== "human") return;
  const k = rollHeadKit(kind, seed, u.id);
  u.helmKey = k.helm;
  u.earKey = k.ears;
  setEnemyEars(u);
}
export function setEnemyEars(u) {
  const e = earsOfKey(u.earKey);
  u.ears = e;
  u.earCut = e ? Math.min(0.4, e.cut / 10) : 0;
  u.link = !!(e && e.link);
  u.muffle = u.helmKey && HELMETS[u.helmKey] ? HELMETS[u.helmKey].muffle : 0;
  u.visor = !!(u.helmKey && GEAR[u.helmKey] && GEAR[u.helmKey].visor); // a riot helmet's visor against a flashbang (throwables.js flashCut)
}
// arsenal.js armFromArsenal: a group's fighter wears its group's ear protection (one item each while they last, never
// one another unit on this map has), and only its issued helmet (no kit helmet on top). b.arsUsed: what is issued.
export function issueEars(b, f, u) {
  u.helmKey = null;
  u.earKey = null;
  const head = (u.arsArmour || []).find((it) => it && isHelmet(it.key));
  if (head) u.helmKey = head.key;
  const used = (b.arsUsed = b.arsUsed || new Set());
  const ok = (it) => it && isEarKey(it.key) && !used.has(it) && !(it.dur != null && it.dur <= 0) && !(head && HELMETS[head.key].fullShell && GEAR[it.key].slot !== "pack");
  const it = ((f && f.arsenal && f.arsenal.items) || []).find(ok);
  if (it) { used.add(it); u.earKey = it.key; u.arsArmour = [...(u.arsArmour || []), it]; }
  setEnemyEars(u);
}
// The body of an enemy (inventory.js enemyBody): its kit helmet (not a group's issued one: that is the item itself) at
// the durability it ended the fight with (broken: none), and its ear protection. Own dice: no draw.
export function dropHeadgear(u, body, src) {
  if (!u || !body || u.arsFid != null) return;
  const p = u.pieces && u.pieces.head;
  if (u.helmKey && p && p.key === u.helmKey && GEAR[u.helmKey] && !(p.shattered || (p.dur != null && p.dur <= 0))) {
    const it = lootItem(u.helmKey, src, [u.id, "helm", u.name]);
    it.dur = Math.max(1, Math.min(it.dur ?? p.dur, p.dur));
    if (p.chip) it.chip = p.chip;
    if (!body.gear.head) body.gear.head = it; else stow(body, it, "");
  }
  if (u.earKey && GEAR[u.earKey]) earsOnBody(body, lootItem(u.earKey, src, [u.id, "ears", u.name]));
}
// Ear protection onto a body: on its helmet's ear mount, else on its head, else in a pocket or the pack.
export function earsOnBody(body, e) {
  const helm = body.gear.head;
  if (helm && isHelmet(helm.key) && !helmetFitReason(helm, e)) { fitHelmetMod(helm, e); return true; }
  if (stow(body, e, "")) return true;
  const i = (body.pockets || []).indexOf(null);
  if (i >= 0) { body.pockets[i] = e; return true; }
  return false;
}
// A group's starting headgear (arsenal.js starterKit): a helmet and ear protection by its kit for each of n people.
export function starterHeadgear(kind, n, make) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const k = rollHeadKit(kind, "ars", i);
    if (k.helm) { const it = make(k.helm, "h", i); if (it) out.push(it); }
    if (k.ears) { const it = make(k.ears, "e", i); if (it) out.push(it); }
  }
  return out;
}

// ---------- loot (own dice) ----------
const pick = (items, r) => {
  const tot = Object.values(items).reduce((a, v) => a + v, 0);
  let x = r * tot;
  for (const [k, v] of Object.entries(items)) { x -= v; if (x < 0) return k; }
  return Object.keys(items)[0] || null;
};
export const HEAD_FINDS = {
  hardware: { p: 0.06, items: { hardhat: 3, earmuffs: 2, earplugs: 2, helmetlight: 1, nvgmount: 0.3 } },
  factory: { p: 0.05, items: { hardhat: 3, earmuffs: 2, earplugs: 2 } },
  dam: { p: 0.04, items: { hardhat: 3, earmuffs: 1, earplugs: 1 } },
  quarry: { p: 0.05, items: { hardhat: 3, earmuffs: 2, earplugs: 1 } },
  warehouse: { p: 0.03, items: { hardhat: 2, earplugs: 1 } },
  gunstore: { p: 0.08, items: { earmuffs: 3, eardef: 2, earplugs: 3 } },
  police: { p: 0.05, items: { riotvisor: 2, eardef: 1, helmetlight: 1 } },
  military: { p: 0.05, items: { highcut: 0.6, commset: 1, ballvisor: 0.4, nvgmount: 0.3, helmetlight: 1, earplugs: 1 } },
  crash_mil: { p: 0.05, items: { highcut: 0.8, commset: 1, ballvisor: 0.4, helmetlight: 0.5 } },
  convoy: { p: 0.04, items: { commset: 1, helmetlight: 1, earplugs: 1 } },
  prison: { p: 0.02, items: { riotvisor: 1 } },
};
export const AREA_HEAD = {
  workshop: { p: 0.04, items: { hardhat: 2, earmuffs: 1, earplugs: 1, helmetlight: 0.5 } },
  warehouse: { p: 0.03, items: { hardhat: 2, earplugs: 1 } },
  gunshop: { p: 0.06, items: { earmuffs: 2, eardef: 1, earplugs: 2 } },
  armory: { p: 0.06, items: { riotvisor: 2, eardef: 1, helmetlight: 1 } },
  barracks: { p: 0.04, items: { highcut: 0.4, commset: 1, ballvisor: 0.3, nvgmount: 0.2, earplugs: 1 } },
  milwreck: { p: 0.04, items: { highcut: 0.5, commset: 1, ballvisor: 0.3 } },
};
export const WARE_HEAD = {
  traders: { p: 0.15, items: { earmuffs: 2, hardhat: 1, earplugs: 2, helmetlight: 1 } },
  military: { p: 0.2, items: { commset: 1, highcut: 0.5, ballvisor: 0.3, helmetlight: 1 } },
  fortress: { p: 0.1, items: { hardhat: 1, earmuffs: 1, riotvisor: 1 } },
  merchants: { p: 0.2, items: { eardef: 1, commset: 0.6, highcut: 0.3, earmuffs: 1, helmetlight: 1 } },
};
// One search hour's roll at a site (loot.js rollAnyModFind, after the attachment tables).
export function rollHeadFind(state, tileId, mult = 1, salt = "") {
  const t = state.tiles[tileId];
  const site = t && t.loc ? HEAD_FINDS[t.loc.type] : null;
  if (!site) return null;
  const loot = Math.max(0.1, Math.min(1, t.loot ?? 1));
  if (hash01(state.seed, "headfind", tileId, state.hour, salt) >= site.p * loot * mult) return null;
  const key = pick(site.items, hash01(state.seed, "headpick", tileId, state.hour, salt));
  return key ? lootItem(key, siteSource(t.loc.type), hash01(state.seed, "headdur", tileId, state.hour, salt)) : null;
}
// One raid container's roll (loot.js rollAreaMod, after the attachment tables).
export function rollAreaHead(state, tileId, areaType, salt = "") {
  const a = AREA_HEAD[areaType];
  if (!a || hash01(state.seed, "areahead", tileId, salt) >= a.p) return null;
  const key = pick(a.items, hash01(state.seed, "areaheadpick", tileId, salt));
  const t = state.tiles[tileId];
  return key ? lootItem(key, areaSource(areaType, t && t.loc ? t.loc.type : null), hash01(state.seed, "areaheaddur", tileId, salt)) : null;
}
// A trader's or merchant's table (loot.js gunmodWares).
export function headWares(state, type, name, salt = "") {
  const w = WARE_HEAD[type];
  if (!w || hash01(state.seed, "headware", name, salt) >= w.p) return [];
  const key = pick(w.items, hash01(state.seed, "headwarepick", name, salt));
  return key ? [lootItem(key, traderSource(type), hash01(state.seed, "headwareq", name, salt))] : [];
}
