// @ts-check
// Rounds by calibre and type: the one ammo API every system uses (docs/weapons-overhaul-plan.md sections 1, 6, 20 R1:
// every calibre and type is its own supply, common rounds included, so a 9mm gun cannot fire 5.56).
//
// Holders of rounds:
// - a stock record ({ a_9mm_fmj: 120, … }: a base's stock, a team's supplies and cargo, a battle's pools, a body's or
//   a container's finds, a caravan's goods). Keys are data-ammo.js ammoKey(cal, type), data.js SUPPLIES entries.
// - a box item (data-ammo.js AMMO_GEAR, the same key; item.dur = rounds left) in a survivor's pockets or pack. A box
//   put in a base's armory or a team's cargo is opened into the stock (settleBase / settleParty).
// - the battle (b.pools plus the boxes the fighters carry: roundsOf / takeBattleRounds).
// The old generic "ammo" key is an abstract count: the AI groups' stores (f.stock.ammo), what a plan or a deal asks for
// ("40 ammo"), the by-the-numbers figures. Generic ammo that lands in one of your holders (a find, a gift, a deal) is
// settled into the rounds that fit the guns there (settleRec, every hour and when a fight starts); generic ammo taken
// from one (negative) comes out of the rounds the guns there need least. totalRounds counts both, so a figure read in
// between is right.
import { CALIBERS, AMMO_TYPES, ammoKey, AMMO_MIX, KIND_MIX, KIT_AMMO, STARTER_AMMO, ROUND_SUPPLIES } from "./data-ammo.js";
import { SUPPLIES, GEAR } from "./data.js";
import { WEAPONS } from "./combat.js";
import { hash01 } from "./skills.js";
import { SITE_TAGS, AREA_TAGS } from "./loot.js";

// ---------- keys ----------
/** every round supply key (a_<cal>_<type>) */
export const ROUND_KEYS = Object.keys(ROUND_SUPPLIES);
/** @param {string} k */
export const isRoundKey = (k) => !!ROUND_SUPPLIES[k];
/** @param {string} k @returns {{ cal: string, type: string } | null} */
export const roundOf = (k) => (ROUND_SUPPLIES[k] ? ROUND_SUPPLIES[k].round : null);
// The calibre a weapon shoots (null: melee, bows, acid, anything that takes no rounds).
/** @param {string | null | undefined} wkey */
export function calOf(wkey) {
  const w = wkey ? WEAPONS[wkey] : null;
  return w && w.ammo > 0 && w.cal && CALIBERS[w.cal] ? w.cal : null;
}
/** @param {string} cal */
export const baseType = (cal) => (CALIBERS[cal] ? CALIBERS[cal].base : "fmj");
/** @param {string} cal */
export const baseKey = (cal) => ammoKey(cal, baseType(cal));
// A type this calibre has (else its common round).
/** @param {string} cal @param {string | null | undefined} type */
export const typeFor = (cal, type) => (type && CALIBERS[cal] && CALIBERS[cal].types.includes(type) ? type : baseType(cal));
/** @param {string} cal @param {string | null | undefined} [type] */
export const keyFor = (cal, type) => ammoKey(cal, typeFor(cal, type));
/** @param {string} cal "12 gauge" */
export const calName = (cal) => (CALIBERS[cal] ? CALIBERS[cal].name : cal);
/** @param {string} cal @param {string | null | undefined} [type] "9mm hollow point" */
export const roundName = (cal, type) => `${CALIBERS[cal] ? CALIBERS[cal].name : cal} ${(AMMO_TYPES[typeFor(cal, type)] || {}).name || ""}`.trim();
/** @param {string | null | undefined} type "hollow point" */
export const typeName = (type) => (type && AMMO_TYPES[type] ? AMMO_TYPES[type].name : "");
// The types a calibre has, its common round first.
/** @param {string} cal */
export const typesOf = (cal) => (CALIBERS[cal] ? [CALIBERS[cal].base, ...CALIBERS[cal].types.filter((t) => t !== CALIBERS[cal].base)] : []);
// A type's effects (data-ammo.js AMMO_TYPES), {} for a common round or none.
/** @param {string | null | undefined} type */
export const typeFx = (type) => (type && AMMO_TYPES[type]) || {};

// ---------- stock records ----------
const num = (v) => (Number.isFinite(v) ? v : 0);
// Rounds of a calibre (any type; or of one type) in a stock record; with no calibre, every round. Generic ammo is not
// counted here (totalRounds counts it).
/** @param {Record<string, number> | null | undefined} rec @param {string | null} [cal] @param {string | null} [type] */
export function roundsIn(rec, cal = null, type = null) {
  if (!rec) return 0;
  if (cal && type) return Math.max(0, Math.floor(num(rec[keyFor(cal, type)])));
  let n = 0;
  for (const k of ROUND_KEYS) {
    const q = rec[k];
    if (!(q > 0)) continue;
    if (cal && ROUND_SUPPLIES[k].round.cal !== cal) continue;
    n += Math.floor(q);
  }
  return n;
}
// Every round in a record, generic ammo included (a figure the old "stock.ammo" reads become).
/** @param {Record<string, number> | null | undefined} rec */
export const totalRounds = (rec) => (rec ? Math.max(0, roundsIn(rec) + Math.floor(num(rec.ammo))) : 0);
// Several records together (a team's supplies and cargo).
/** @param {...(Record<string, number> | null | undefined)} recs */
export const totalIn = (...recs) => recs.reduce((a, r) => a + totalRounds(r), 0);
/** @param {Record<string, number>} rec @param {string} key @param {number} n */
export function addRounds(rec, key, n) {
  if (!rec || !(n > 0) || !ROUND_SUPPLIES[key]) return 0;
  rec[key] = num(rec[key]) + n;
  return n;
}
// Takes up to n rounds of a calibre from a record: of one type when given (strict), else its common round first, then
// the other types by value (cheapest first). Returns what was taken.
/** @param {Record<string, number>} rec @param {string} cal @param {string | null} type @param {number} n @param {boolean} [strict] */
export function takeRounds(rec, cal, type, n, strict = true) {
  if (!rec || !(n > 0)) return 0;
  const keys = type && strict ? [keyFor(cal, type)] : orderFor(cal, type);
  let got = 0;
  for (const k of keys) {
    const q = Math.min(n - got, Math.max(0, Math.floor(num(rec[k]))));
    if (q > 0) { rec[k] -= q; got += q; }
    if (got >= n) break;
  }
  return got;
}
// A calibre's keys in the order a gun draws them with no type asked for: that type first, its common round, the rest
// cheapest first.
/** @param {string} cal @param {string | null} [type] */
function orderFor(cal, type = null) {
  const keys = typesOf(cal).map((t) => ammoKey(cal, t)).sort((a, b) => (a === baseKey(cal) ? -1 : b === baseKey(cal) ? 1 : SUPPLIES[a].value - SUPPLIES[b].value));
  if (type) { const k = keyFor(cal, type); return [k, ...keys.filter((x) => x !== k)]; }
  return keys;
}
// Generic rounds out of a record (a cost, a gift, a deal paid in "ammo", by-the-numbers shooting with no gun to say
// which): generic ammo first, then the calibres in `keep` last (the guns there need them), cheapest first. Returns
// what was taken: { n, keys: { key: q } }.
/** @param {Record<string, number>} rec @param {number} n @param {Record<string, number> | null} [keep] calibres to keep (weights) */
export function spendAmmo(rec, n, keep = null) {
  const out = { n: 0, keys: /** @type {Record<string, number>} */ ({}) };
  if (!rec || !(n > 0)) return out;
  const g = Math.min(n, Math.max(0, Math.floor(num(rec.ammo))));
  if (g > 0) { rec.ammo -= g; out.n += g; out.keys.ammo = g; }
  const order = ROUND_KEYS.filter((k) => rec[k] >= 1).sort((a, b) => {
    const ka = keep && keep[ROUND_SUPPLIES[a].round.cal] ? 1 : 0, kb = keep && keep[ROUND_SUPPLIES[b].round.cal] ? 1 : 0;
    return ka - kb || SUPPLIES[a].value - SUPPLIES[b].value || num(rec[b]) - num(rec[a]) || (a < b ? -1 : 1);
  });
  for (const k of order) {
    if (out.n >= n) break;
    const q = Math.min(n - out.n, Math.floor(num(rec[k])));
    if (q > 0) { rec[k] -= q; out.n += q; out.keys[k] = (out.keys[k] || 0) + q; }
  }
  return out;
}
// Splits n generic rounds into round keys by weights ({ key: w }; largest remainder, so it is exact and the same every
// time). Returns { key: q }.
/** @param {number} n @param {Record<string, number>} mix */
export function splitByMix(n, mix) {
  /** @type {Record<string, number>} */
  const out = {};
  const keys = Object.keys(mix).filter((k) => ROUND_SUPPLIES[k] && mix[k] > 0).sort();
  n = Math.floor(n);
  if (!(n > 0) || !keys.length) return out;
  const tot = keys.reduce((a, k) => a + mix[k], 0);
  let left = n;
  const rem = keys.map((k) => { const x = (n * mix[k]) / tot; const q = Math.floor(x); out[k] = q; left -= q; return [k, x - q]; });
  rem.sort((a, b) => /** @type {number} */ (b[1]) - /** @type {number} */ (a[1]) || (a[0] < b[0] ? -1 : 1));
  for (let i = 0; left > 0; i = (i + 1) % rem.length, left--) out[rem[i][0]] += 1;
  for (const k of Object.keys(out)) if (!out[k]) delete out[k];
  return out;
}
/** @param {Record<string, number>} rec @param {number} n @param {Record<string, number>} mix */
export function addAmmo(rec, n, mix) {
  const parts = splitByMix(n, mix);
  for (const [k, q] of Object.entries(parts)) addRounds(rec, k, q);
  return parts;
}
// Generic ammo in a record of yours turned into rounds: added by `mix` (the guns there), or (negative: taken
// generically) out of the rounds those guns need least. A record with none is left as it is (no "ammo" key is added).
/** @param {Record<string, number>} rec @param {Record<string, number>} mix round key weights @param {Record<string, number> | null} [keep] calibre weights */
export function settleRec(rec, mix, keep = null) {
  if (!hasGeneric(rec)) return;
  const g = Math.trunc(num(rec.ammo));
  rec.ammo = num(rec.ammo) - g; // 0 (a fraction stays); the key is kept so `stock.ammo += n` elsewhere stays a number
  if (g > 0) addAmmo(rec, g, mix);
  else spendAmmo(rec, -g, keep);
}
// Has this record whole generic rounds to settle (or owe)?
/** @param {any} rec */
export const hasGeneric = (rec) => !!rec && typeof rec === "object" && Math.abs(num(rec.ammo)) >= 1;

// ---------- guns and their calibres ----------
// The calibres the guns among these people and items shoot, weighted by rounds a shot ({ "9mm": 2, "556": 2 }).
/** @param {any[]} people survivors @param {any[]} [items] loose items (an armory, a team's cargo) */
export function gunCals(people, items = []) {
  /** @type {Record<string, number>} */
  const out = {};
  const add = (it) => { const c = it ? calOf(it.key) : null; if (c) out[c] = (out[c] || 0) + Math.max(1, WEAPONS[it.key].ammo || 1); };
  for (const s of people || []) if (s && s.gear) add(s.gear.weapon);
  for (const it of items || []) add(it);
  return out;
}
// Common rounds for these calibres as split weights ({ a_9mm_fmj: 2 }). No guns: 9mm and 12 gauge, half each.
/** @param {Record<string, number>} cals */
export function mixForCals(cals) {
  /** @type {Record<string, number>} */
  const out = {};
  for (const [c, w] of Object.entries(cals || {})) if (w > 0 && CALIBERS[c]) out[baseKey(c)] = (out[baseKey(c)] || 0) + w;
  return Object.keys(out).length ? out : { a_9mm_fmj: 1, a_12ga_buck: 1 };
}
const peopleAt = (state, baseId) => (state.survivors || []).filter((s) => s.alive && s.location && s.location.kind === "base" && s.location.baseId === baseId);
const membersOf = (state, p) => (p.members || []).map((id) => (state.survivors || []).find((s) => s.id === id)).filter((s) => s && s.alive);
// The calibres a base's or a team's guns shoot (the people there and the guns in its armory or cargo).
/** @param {any} state @param {any} base */
export const baseCals = (state, base) => gunCals(peopleAt(state, base.id), base.armory || []);
/** @param {any} state @param {any} p */
export const partyCals = (state, p) => gunCals(membersOf(state, p), (p.cargo && p.cargo.gear) || []);
// Rounds in a record that fit these calibres (the reserves, the autopilot's "ammo we can use").
/** @param {Record<string, number>} rec @param {Record<string, number>} cals */
export const usableIn = (rec, cals) => Object.keys(cals || {}).reduce((a, c) => a + roundsIn(rec, c), 0);

// Box items opened into a record (an armory's, a cargo's boxes: they are stock there). Returns rounds moved.
/** @param {any[]} list @param {Record<string, number>} rec */
export function unbox(list, rec) {
  if (!Array.isArray(list) || !rec) return 0;
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i];
    if (!it || !ROUND_SUPPLIES[it.key]) continue;
    const q = Math.max(0, Math.floor(num(it.dur ?? (GEAR[it.key] ? GEAR[it.key].dur : 0))));
    addRounds(rec, it.key, q);
    n += q;
    list.splice(i, 1);
  }
  return n;
}
// A base's generic ammo and armory boxes into rounds (the guns there say which).
/** @param {any} state @param {any} base */
export function settleBase(state, base) {
  if (!base || !base.stock) return;
  unbox(base.armory, base.stock);
  if (hasGeneric(base.stock)) { const cals = baseCals(state, base); settleRec(base.stock, mixForCals(cals), cals); }
}
// A team's (yours or a group's party: the same rule, it shoots what it carries).
/** @param {any} state @param {any} p */
export function settleParty(state, p) {
  if (!p || !p.supplies) return;
  if (p.cargo) unbox(p.cargo.gear, p.cargo.supplies || (p.cargo.supplies = {}));
  if (!hasGeneric(p.supplies) && !(p.cargo && hasGeneric(p.cargo.supplies))) return;
  const cals = partyCals(state, p);
  const mix = mixForCals(cals);
  settleRec(p.supplies, mix, cals);
  if (p.cargo) settleRec(p.cargo.supplies, mix, cals);
}
// Every holder of yours: the bases, your teams (the AI groups' teams keep generic ammo), the staging camp, route
// convoys. Called every hour (world.js tickHour), when a world is made and when an old save loads (migrateAmmo).
/** @param {any} state */
export function settleAll(state) {
  for (const b of state.bases || []) settleBase(state, b);
  for (const p of state.parties || []) if (p.owner === "player" || p.owner == null) settleParty(state, p);
  if (state.staging && hasGeneric(state.staging.stores)) settleRec(state.staging.stores, mixForCals({}), null);
}
// An old save: every generic ammo stock of yours becomes rounds split across the calibres of the guns that holder
// owns (fallback 9mm / 12 gauge), the same total (tools/ammomigrationtest.js).
/** @param {any} state */
export function migrateAmmo(state) {
  settleAll(state);
  for (const s of state.survivors || []) {
    const w = s.gear && s.gear.weapon;
    if (w && w.load != null && !(calOf(w.key) && CALIBERS[calOf(w.key)].types.includes(w.load)) && w.load !== "auto") w.load = null;
  }
}

// ---------- finds ----------
// The ammo theme of a site type or a raid area (data-ammo.js AMMO_MIX): its first theme tag that has one.
const THEMES = ["military", "police", "prison", "guns", "hunt", "farm", "crime"];
/** @param {string | null | undefined} siteOrArea @param {boolean} [area] */
export function themeOf(siteOrArea, area = false) {
  const tags = siteOrArea ? (area ? AREA_TAGS[siteOrArea] : SITE_TAGS[siteOrArea]) || [] : [];
  for (const t of THEMES) if (tags.includes(t)) return t === "crime" ? "raider" : t;
  return "home";
}
const MIX_CACHE = new Map();
/** @param {string} theme @returns {Record<string, number>} round key weights */
export function themeMix(theme) {
  if (!MIX_CACHE.has(theme)) {
    /** @type {Record<string, number>} */
    const m = {};
    for (const [ct, w] of Object.entries(AMMO_MIX[theme] || AMMO_MIX.home)) { const k = `a_${ct}`; if (ROUND_SUPPLIES[k]) m[k] = w; }
    MIX_CACHE.set(theme, m);
  }
  return MIX_CACHE.get(theme);
}
// Picks a key by weights with a 0–1 roll.
/** @param {Record<string, number>} mix @param {number} r */
function pickBy(mix, r) {
  const keys = Object.keys(mix).sort();
  const tot = keys.reduce((a, k) => a + mix[k], 0);
  let x = r * tot;
  for (const k of keys) { x -= mix[k]; if (x < 0) return k; }
  return keys[keys.length - 1];
}
// A find of n rounds as a place of this theme holds them: a box or two of whatever turns up there (own dice: the
// world's random numbers are not touched). Returns { key: q }.
/** @param {string} theme @param {number} n @param {...any} salt */
export function findRounds(theme, n, ...salt) {
  /** @type {Record<string, number>} */
  const out = {};
  n = Math.floor(n);
  if (!(n > 0)) return out;
  const mix = themeMix(theme);
  // One box for a small find; a big one (an armory's crate) is two or three kinds.
  const parts = n >= 40 ? 3 : n >= 16 ? 2 : 1;
  let left = n;
  for (let i = 0; i < parts; i++) {
    const k = pickBy(mix, hash01("rounds", theme, n, i, ...salt));
    const q = i === parts - 1 ? left : Math.max(1, Math.round(n / parts));
    out[k] = (out[k] || 0) + q;
    left -= q;
  }
  return out;
}
// A site's (or raid area's) find into a record.
/** @param {Record<string, number>} rec @param {string} siteOrArea @param {number} n @param {boolean} area @param {...any} salt */
export function addFind(rec, siteOrArea, n, area, ...salt) {
  const parts = findRounds(themeOf(siteOrArea, area), n, siteOrArea, ...salt);
  for (const [k, q] of Object.entries(parts)) addRounds(rec, k, q);
  return parts;
}
// The mix an AI group's abstract stores come in (data-ammo.js KIND_MIX by its kind).
/** @param {string | null | undefined} kind */
export const kindMix = (kind) => themeMix(KIND_MIX[kind] || "guns");
// A transient holder of generic ammo (a visiting trader's goods, a caravan's) turned into rounds by a theme.
/** @param {Record<string, number>} rec @param {string} theme */
export function expandAmmo(rec, theme) {
  if (!rec || !(num(rec.ammo) >= 1)) return;
  const n = Math.floor(rec.ammo);
  rec.ammo = 0;
  addAmmo(rec, n, themeMix(theme));
}
// How many of a round key an AI group can spare out of its abstract ammo (its kind's mix share).
/** @param {number} avail @param {string} kind @param {string} key */
export function kindShare(avail, kind, key) {
  const mix = kindMix(kind);
  const tot = Object.values(mix).reduce((a, b) => a + b, 0);
  return mix[key] ? Math.floor((avail * mix[key]) / tot) : 0;
}

// ---------- boxes ----------
// A box item of a round key holding n rounds (a count stack: item.dur).
/** @param {string} key @param {number} n */
export function newBox(key, n) {
  const d = GEAR[key];
  if (!d) return null;
  return { key, name: d.name, quality: 1, dur: Math.max(1, Math.floor(n)) };
}
// The box items a survivor carries (pockets, then the pack).
/** @param {any} s */
export function boxesOf(s) {
  const out = [];
  if (!s) return out;
  for (const it of s.pockets || []) if (it && ROUND_SUPPLIES[it.key]) out.push(it);
  const pack = s.gear && s.gear.backpack;
  for (const it of (pack && pack.contents) || []) if (it && ROUND_SUPPLIES[it.key]) out.push(it);
  return out;
}
// Empty boxes thrown away (after a fight).
/** @param {any} s */
export function sweepBoxes(s) {
  if (!s) return;
  const empty = (it) => it && ROUND_SUPPLIES[it.key] && !(num(it.dur) >= 1);
  if (Array.isArray(s.pockets)) for (let i = 0; i < s.pockets.length; i++) if (empty(s.pockets[i])) s.pockets[i] = null;
  const pack = s.gear && s.gear.backpack;
  if (pack && Array.isArray(pack.contents)) for (let i = 0; i < pack.contents.length; i++) if (empty(pack.contents[i])) pack.contents[i] = null;
}

// ---------- the battle ----------
// A unit's loaded type (u.load: a type key; a unit from before has its calibre's common round).
/** @param {any} u */
export const loadOf = (u) => { const c = calOf(u && u.weapon); return c ? typeFor(c, u.load) : null; };
// Rounds of one key to hand for this unit: its own boxes, its side's other fighters' boxes, the pools.
/** @param {any} b @param {any} u @param {string} key */
function battleKeyRounds(b, u, key) {
  let n = 0;
  for (const o of b.units || []) if (o.side === u.side && o.boxes) for (const it of o.boxes) if (it && it.key === key) n += Math.max(0, Math.floor(num(it.dur)));
  for (const p of b.pools || []) n += Math.max(0, Math.floor(num(p[key])));
  return n;
}
// Rounds for this unit's gun (of its loaded type, or the type given; type "*": any type of the calibre). Enemies and
// the third side: their reserve is endless (only their magazine stops them).
/** @param {any} b @param {any} u @param {string | null} [type] */
export function roundsOf(b, u, type) {
  const cal = calOf(u.weapon);
  if (!cal) return 0;
  if (u.side !== "player") return Infinity;
  if (type === "*") return typesOf(cal).reduce((a, t) => a + battleKeyRounds(b, u, ammoKey(cal, t)), 0);
  return battleKeyRounds(b, u, keyFor(cal, type === undefined ? u.load : type));
}
// The types of this unit's calibre its side has rounds of: [{ type, name, n }], the loaded one first (agent D's reload
// chooser).
/** @param {any} b @param {any} u */
export function loadsFor(b, u) {
  const cal = calOf(u.weapon);
  if (!cal || u.side !== "player") return [];
  const cur = loadOf(u);
  return typesOf(cal).map((t) => ({ type: t, name: AMMO_TYPES[t].name, n: battleKeyRounds(b, u, ammoKey(cal, t)) }))
    .filter((x) => x.n > 0 || x.type === cur).sort((a, c) => (a.type === cur ? -1 : c.type === cur ? 1 : 0));
}
// n rounds of this unit's loaded type out of its own boxes, then its teammates', then the pools. Returns what was taken.
/** @param {any} b @param {any} u @param {number} n */
export function takeBattleRounds(b, u, n) {
  const cal = calOf(u.weapon);
  if (!cal || !(n > 0)) return 0;
  const key = keyFor(cal, u.load);
  let got = 0;
  const fromBox = (it) => { if (got >= n || !it || it.key !== key) return; const q = Math.min(n - got, Math.max(0, Math.floor(num(it.dur)))); it.dur -= q; got += q; };
  for (const it of u.boxes || []) fromBox(it);
  for (const o of b.units || []) if (o !== u && o.side === u.side && o.boxes) for (const it of o.boxes) fromBox(it);
  for (const p of b.pools || []) {
    if (got >= n) break;
    const q = Math.min(n - got, Math.max(0, Math.floor(num(p[key]))));
    if (q > 0) { p[key] -= q; got += q; }
  }
  return got;
}
// Every round the player's side has (the battle screen's "Ammo" figure).
/** @param {any} b */
export function sideRounds(b) {
  let n = 0;
  for (const p of b.pools || []) n += totalRounds(p);
  for (const o of b.units || []) if (o.side === "player" && o.boxes) for (const it of o.boxes) n += Math.max(0, Math.floor(num(it && it.dur)));
  return n;
}
// The load a fighter of yours takes the field with: the gun's own (item.load), else its common round; one the side has
// none of falls back to the common round, then to whatever of that calibre it has most of. Returns a type key or null.
/** @param {any} b @param {any} u @param {string | null | undefined} pref */
export function chooseLoad(b, u, pref) {
  const cal = calOf(u.weapon);
  if (!cal) return null;
  const want = pref && pref !== "auto" ? typeFor(cal, pref) : baseType(cal);
  if (u.side !== "player" || battleKeyRounds(b, u, ammoKey(cal, want)) > 0) return want;
  if (battleKeyRounds(b, u, baseKey(cal)) > 0) return baseType(cal);
  let best = want, most = 0;
  for (const t of typesOf(cal)) { const q = battleKeyRounds(b, u, ammoKey(cal, t)); if (q > most) { most = q; best = t; } }
  return best;
}
// An enemy's load (data-ammo.js KIT_AMMO by kit and calibre class), on dice of its own (the battle's are not used up).
/** @param {string} kind kit key @param {string} weapon @param {...any} salt */
export function enemyLoad(kind, weapon, ...salt) {
  const cal = calOf(weapon);
  if (!cal) return null;
  const k = KIT_AMMO[kind] || KIT_AMMO.raiders;
  const cls = cal === "12ga" ? "shotgun" : ["9mm", "45acp", "357", "22lr"].includes(cal) ? "pistol" : "rifle";
  const w = k[cls] || {};
  /** @type {Record<string, number>} */
  const mix = {};
  for (const [t, p] of Object.entries(w)) { const tt = typeFor(cal, t); mix[tt] = (mix[tt] || 0) + p; }
  if (!Object.keys(mix).length) return baseType(cal);
  return pickBy(mix, hash01("eload", kind, weapon, ...salt));
}
// How well a type does against what is in front of it (pickLoad and the by-the-numbers edge): AP and slugs against
// armour, hollow and soft points against the unarmoured.
/** @param {string} type @param {boolean} armoured */
export function typeScore(type, armoured) {
  const t = typeFx(type);
  const dmg = t.dmg || 1;
  if (armoured) return dmg * (type === "ap" || type === "api" ? 1.12 : type === "slug" || type === "match" ? 1.05 : (t.soft || 1) > 1 ? 0.92 : 1);
  return dmg * (t.soft || 1);
}
// Is this unit armoured (people in body armour, the armoured dead, a Boneback, a Brute)?
/** @param {any} t */
export const armoured = (t) => !!t && ((t.kind === "human" && ((t.armorKey && GEAR[t.armorKey] && GEAR[t.armorKey].power >= 2) || (t.wornArmor != null && t.wornArmor <= 0.85))) || ["soldier", "riot", "boneback", "brute"].includes(t.ztype));
// A hit with no armour in the way (until per-hit locations land: the target wears none): people with no body armour,
// the ordinary dead.
/** @param {any} t */
export const unarmoured = (t) => !!t && (t.kind === "human" ? (t.side === "player" ? (t.wornArmor ?? 1) >= 1 : !t.armorKey) : (t.armor ?? 1) >= 1 && !["soldier", "riot", "boneback", "brute"].includes(t.ztype));
// Hollow and soft points (AMMO_TYPES soft) on a hit with no armour in the way: × soft instead of × dmg (shotOdds already
// counts dmg). 1 for anything else (melee, a common round, an armoured target).
/** @param {any} t @param {any} hit damage()'s hit: { how, ammo, cal } */
export function softMult(t, hit) {
  if (!hit || hit.how !== "shot" || !hit.ammo || !unarmoured(t)) return 1;
  const fx = typeFx(hit.ammo);
  return (fx.soft || 1) / (fx.dmg || 1);
}
// The best type to load against the foes in sight (the AI's reload, both sides; section 6): the mean score over aware
// foes, ties to the loaded type, then the common round. Only types the side has rounds of.
/** @param {any} b @param {any} u @param {any[]} [foes] */
export function pickLoad(b, u, foes = []) {
  const cal = calOf(u.weapon);
  if (!cal) return null;
  const cur = loadOf(u);
  const opts = u.side === "player" ? loadsFor(b, u).filter((x) => x.n >= (WEAPONS[u.weapon].ammo || 1)).map((x) => x.type) : [cur];
  if (!opts.length) return cur;
  const seen = (foes || []).filter((f) => f && !f.dead);
  if (!seen.length) return opts.includes(cur) ? cur : opts.includes(baseType(cal)) ? baseType(cal) : opts[0];
  const score = (t) => seen.reduce((a, f) => a + typeScore(t, armoured(f)), 0) / seen.length;
  let best = opts.includes(cur) ? cur : opts[0], bs = score(best) + 1e-6;
  for (const t of opts) { const s = score(t) + (t === baseType(cal) ? 1e-7 : 0); if (s > bs + 0.01) { best = t; bs = s; } }
  return best;
}

// ---------- by the numbers ----------
// Shots by the numbers out of a record: each gunner perHead rounds of their gun's calibre (their gun's load first,
// then the common round, then the rest), everyone else (no gun) perHead of any rounds, cheapest first (as the old
// generic rule). Returns { n, used: { key: q }, byCal: { cal: q } }.
/** @param {Record<string, number>} rec @param {any[]} people @param {number} perHead */
export function drawShots(rec, people, perHead) {
  const out = { n: 0, used: /** @type {Record<string, number>} */ ({}), byCal: /** @type {Record<string, number>} */ ({}) };
  if (!rec || !(perHead > 0)) return out;
  const cals = gunCals(people);
  let loose = 0;
  for (const s of people || []) {
    const w = s && s.gear && s.gear.weapon;
    const cal = w ? calOf(w.key) : null;
    if (!cal) { loose += perHead; continue; }
    const before = snapshot(rec, cal);
    const got = takeRounds(rec, cal, w.load && w.load !== "auto" ? w.load : null, perHead, false);
    diffInto(before, rec, out.used);
    out.n += got;
    out.byCal[cal] = (out.byCal[cal] || 0) + got;
  }
  if (loose > 0) {
    const g = spendAmmo(rec, loose, cals);
    out.n += g.n;
    for (const [k, q] of Object.entries(g.keys)) out.used[k] = (out.used[k] || 0) + q;
  }
  return out;
}
const snapshot = (rec, cal) => typesOf(cal).map((t) => [ammoKey(cal, t), num(rec[ammoKey(cal, t)])]);
function diffInto(before, rec, used) {
  for (const [k, q] of before) { const d = q - num(rec[k]); if (d > 0) used[k] = (used[k] || 0) + d; }
}
// Puts drawn rounds back (a fight broken off early refunds what was not fired).
/** @param {Record<string, number>} rec @param {Record<string, number>} used @param {number} n */
export function refundShots(rec, used, n) {
  let left = Math.floor(n);
  for (const k of Object.keys(used || {}).sort()) {
    if (left <= 0) break;
    const q = Math.min(left, used[k]);
    if (k === "ammo") rec.ammo = num(rec.ammo) + q; else addRounds(rec, k, q);
    left -= q;
  }
}
// The share of a team's gunners with rounds for their guns: the armed factor's per-calibre check. ammo: a record
// (rounds by key; generic counts for anyone) or a number (the old rule: any rounds for anyone). For each calibre,
// enough when the rounds of it reach need(gunners of it); people with no gun need any rounds, need(their count).
/** @param {any[]} gunners survivors who shoot rounds (no bows) @param {Record<string, number> | number} ammo @param {(n: number) => number} need @param {(s: any) => number} power */
export function gunsArmed(gunners, ammo, need, power) {
  if (typeof ammo !== "object" || ammo == null) return null;
  /** @type {Record<string, any[]>} */
  const groups = {};
  for (const s of gunners) { const w = s.gear && s.gear.weapon; const c = (w && calOf(w.key)) || "*"; (groups[c] = groups[c] || []).push(s); }
  let tot = 0, ok = 0;
  for (const [c, list] of Object.entries(groups)) {
    const have = c === "*" ? totalRounds(ammo) : roundsIn(ammo, c) + Math.floor(num(ammo.ammo));
    const f = have >= need(list.length) ? 1 : 0;
    for (const s of list) { const p = power(s); tot += p; ok += p * f; }
  }
  return { tot, ok };
}
// R8: typed rounds count in a fight by the numbers: the rounds drawn, scored against the enemy (armoured people:
// soldiers, riot police; the armoured dead) as pickLoad does, as a small multiplier on your side's power (0.95–1.06).
/** @param {Record<string, number>} used @param {any} enemy setup.enemy */
export function ammoEdge(used, enemy) {
  const arm = !!enemy && (enemy.kind === "soldiers" || enemy.kind === "guards" || (enemy.mix && (enemy.mix.soldier || enemy.mix.riot)));
  let n = 0, s = 0;
  for (const [k, q] of Object.entries(used || {})) {
    const r = ROUND_SUPPLIES[k] ? ROUND_SUPPLIES[k].round : null;
    if (!r || !(q > 0)) continue;
    n += q; s += q * typeScore(r.type, arm) / typeScore(baseType(r.cal), arm);
  }
  return n ? Math.max(0.95, Math.min(1.06, s / n)) : 1;
}

// ---------- packing and starting ----------
// The rounds a team takes from home for its guns (parties.js launchExpedition: a plan's "N ammo" packed as rounds that
// fit): each member's share of n out of their calibre (their gun's load first, then its common round, then the rest),
// what is left of n in the calibres the team has most guns of; nothing for a team with no guns but generic ammo it
// asked for, which comes out cheapest first. Takes from `from` and returns { key: q }.
/** @param {Record<string, number>} from @param {any[]} members @param {number} n */
export function packRounds(from, members, n) {
  /** @type {Record<string, number>} */
  const out = {};
  n = Math.floor(n);
  if (!from || !(n > 0)) return out;
  const gunners = (members || []).filter((s) => s && s.gear && s.gear.weapon && calOf(s.gear.weapon.key));
  if (!gunners.length) {
    const g = spendAmmo(from, n);
    for (const [k, q] of Object.entries(g.keys)) if (k !== "ammo") out[k] = q; else out.ammo = q;
    return out;
  }
  const take = (cal, type, q) => {
    const before = snapshot(from, cal);
    const got = takeRounds(from, cal, type, q, false);
    diffInto(before, from, out);
    return got;
  };
  // Generic ammo at home (not yet settled) goes along as it is: it settles in the team.
  const gen = Math.min(n, Math.max(0, Math.floor(num(from.ammo))));
  if (gen > 0) { from.ammo -= gen; out.ammo = gen; }
  let left = n - gen;
  const share = Math.floor(left / gunners.length);
  for (const s of gunners) { const w = s.gear.weapon; left -= take(calOf(w.key), w.load && w.load !== "auto" ? w.load : null, share); }
  // The rest: round-robin over the gunners while any of their calibres has rounds.
  for (let guard = 0; left > 0 && guard < 50; guard++) {
    let moved = 0;
    for (const s of gunners) { if (left <= 0) break; const w = s.gear.weapon; const q = take(calOf(w.key), null, Math.min(left, Math.max(1, Math.ceil(left / gunners.length)))); left -= q; moved += q; }
    if (!moved) break;
  }
  return out;
}
// Adds a packed record into a team's supplies (packRounds' result).
/** @param {Record<string, number>} to @param {Record<string, number>} rec */
export function addRecord(to, rec) {
  for (const [k, q] of Object.entries(rec || {})) if (q > 0) to[k] = num(to[k]) + q;
}
// A starting colonist's gun (section 6, R11): now and then a typed load and a box of it (never AP, API or match). Sets
// item.load; returns the box item (the caller puts it in their pockets or the stock) or null. rng's position is read,
// never moved (the gunmods.js randomStarterMods rule).
/** @param {any} rng @param {any} item @param {string | number} [salt] */
export function starterLoad(rng, item, salt = "") {
  const cal = item ? calOf(item.key) : null;
  if (!cal) return null;
  const seed = rng && Number.isFinite(rng.state) ? rng.state : 0;
  const r = hash01(seed, salt, item.key, "starterload");
  let x = 0;
  for (const [p, type, n] of STARTER_AMMO[cal] || []) {
    x += p;
    if (r < x && CALIBERS[cal].types.includes(type) && !["ap", "api", "match"].includes(type)) {
      item.load = type;
      return newBox(ammoKey(cal, type), n);
    }
  }
  item.load = null;
  return null;
}
// Stows a box in a survivor's pockets (a free pocket), else returns false.
/** @param {any} s @param {any} box */
export function pocketBox(s, box) {
  if (!s || !box || !Array.isArray(s.pockets)) return false;
  const i = s.pockets.findIndex((x) => !x);
  if (i < 0) return false;
  s.pockets[i] = box;
  return true;
}

// ---------- tools ----------
// Test helper (the tools that used to set stock.ammo): n rounds split across the calibres of these weapon keys (or the
// fallback 9mm / 12 gauge), common rounds.
/** @param {Record<string, number>} rec @param {number} n @param {string[]} [weapons] */
export function giveRounds(rec, n, weapons = []) {
  /** @type {Record<string, number>} */
  const cals = {};
  for (const k of weapons) { const c = calOf(k); if (c) cals[c] = (cals[c] || 0) + 1; }
  return addAmmo(rec, n, mixForCals(cals));
}
// Sets a record's rounds to exactly n, split like giveRounds (every round key and generic ammo cleared first).
/** @param {Record<string, number>} rec @param {number} n @param {string[]} [weapons] */
export function setRounds(rec, n, weapons = []) {
  for (const k of ROUND_KEYS) if (k in rec) delete rec[k];
  delete rec.ammo;
  return giveRounds(rec, n, weapons);
}
// Per-calibre breakdown of a record for a tooltip: "9mm 120 (HP 20), 12 gauge 30".
/** @param {Record<string, number>} rec */
export function roundsLine(rec) {
  const parts = [];
  for (const cal of Object.keys(CALIBERS)) {
    const n = roundsIn(rec, cal);
    if (!n) continue;
    const typed = typesOf(cal).slice(1).map((t) => [t, roundsIn(rec, cal, t)]).filter(([, q]) => q > 0).map(([t, q]) => `${AMMO_TYPES[t].name} ${q}`);
    parts.push(`${CALIBERS[cal].name} ${n}${typed.length ? ` (${typed.join(", ")})` : ""}`);
  }
  const g = Math.floor(num(rec && rec.ammo));
  if (g > 0) parts.push(`${g} unsorted`);
  return parts.join(", ") || "none";
}
