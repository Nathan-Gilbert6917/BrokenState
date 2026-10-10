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
import { ROUND_ECON, RARITY_FIND, roundTier } from "./data-ammo.js"; // a round's rarity tier (commonness)
import { CALIBERS, AMMO_TYPES, ammoKey, AMMO_MIX, KIND_MIX, KIT_AMMO, STARTER_AMMO, ROUND_SUPPLIES, RELOAD_SUPPLIES, HAND_SUPPLIES } from "./data-ammo.js";
import { SUPPLIES, GEAR } from "./data.js";
import { WEAPONS } from "./combat.js";
import { hash01 } from "./skills.js";
import { SITE_TAGS, AREA_TAGS } from "./loot.js";
import { BULK, BULK_FINDS } from "./data-stacks.js"; // bulk ammo containers, a find's boxed share (2026-10-10)
import { isBulk, loadsOf, sweepLoads, bulkRecord, roundItems, newBulk, fillBulk, boxSize } from "./itemstack.js"; // rounds loose, boxed, in bulk

// ---------- keys and stock records (rounds.js) ----------
export * from "./rounds.js";
import { factoryKey, foldRounds, sumRecs, ROUND_KEYS, GENERIC_KEYS, addAmmo, addRounds, baseKey, baseType, calName, hasGeneric, isRoundKey, keyFor, roundName, roundOf, roundsIn, settleRec, spendAmmo, splitByMix, takeRounds, totalIn, totalRounds, typeFor, typeFx, typeName, typesOf, withHand } from "./rounds.js";
const num = (v) => (Number.isFinite(v) ? v : 0);

// The calibre a weapon shoots (null: melee, bows, acid, anything that takes no rounds; a launcher too: its rounds are
// launchers.js's, never a gun's magazine, a plan's "ammo" or the bench's).
/** @param {string | null | undefined} wkey */
export function calOf(wkey) {
  const w = wkey ? WEAPONS[wkey] : null;
  return w && w.ammo > 0 && w.cal && CALIBERS[w.cal] && !w.launcher ? w.cal : null;
}


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
  for (const [c, w] of Object.entries(cals || {})) if (w > 0 && CALIBERS[c] && CALIBERS[c].common !== false) out[baseKey(c)] = (out[baseKey(c)] || 0) + w;
  return Object.keys(out).length ? out : { a_9mm_fmj: 1, a_12ga_buck: 1 };
}
const peopleAt = (state, baseId) => (state.survivors || []).filter((s) => s.alive && s.location && s.location.kind === "base" && s.location.baseId === baseId);
const membersOf = (state, p) => (p.members || []).map((id) => (state.survivors || []).find((s) => s.id === id) || (state.vols ? state.vols.people.find((s) => s.id === id) : null)).filter((s) => s && s.alive); // state.vols: volunteers with the team (volunteers.js)
// The calibres a base's or a team's guns shoot (the people there and the guns in its armory or cargo).
/** @param {any} state @param {any} base */
export const baseCals = (state, base) => gunCals(peopleAt(state, base.id), base.armory || []);
/** @param {any} state @param {any} p */
export const partyCals = (state, p) => gunCals(membersOf(state, p), (p.cargo && p.cargo.gear) || []);
// Rounds in a record that fit these calibres (the reserves, the autopilot's "ammo we can use").
/** @param {Record<string, number>} rec @param {Record<string, number>} cals */
export const usableIn = (rec, cals) => Object.keys(cals || {}).reduce((a, c) => a + roundsIn(rec, c), 0);

// The rounds a base or a team can shoot: those that fit the guns there (every round when there are no guns: what
// it could shoot once armed). The autopilot's and the reserves' "ammo" (the old stock.ammo reads).
/** @param {any} state @param {any} base */
export function baseAmmo(state, base) {
  if (!base || !base.stock) return 0;
  const cals = baseCals(state, base);
  return Object.keys(cals).length ? usableIn(base.stock, cals) + Math.max(0, Math.floor(num(base.stock.ammo))) : totalRounds(base.stock);
}
/** @param {any} state @param {any} p @param {boolean} [cargo] the found cargo too */
export function teamAmmo(state, p, cargo = true) {
  if (!p) return 0;
  const cals = partyCals(state, p);
  const recs = [p.supplies, cargo && p.cargo ? p.cargo.supplies : null];
  if (!Object.keys(cals).length) return recs.reduce((a, r) => a + totalRounds(r), 0);
  return recs.reduce((a, r) => a + (r ? usableIn(r, cals) + Math.max(0, Math.floor(num(r.ammo))) : 0), 0);
}
// The rounds a record can spare above `keep` rounds, the ones these guns need least first: { key: q } (a gift, a sale).
/** @param {Record<string, number>} rec @param {number} keep @param {Record<string, number> | null} [cals] */
export function spareRounds(rec, keep, cals = null) {
  const n = totalRounds(rec) - Math.max(0, keep || 0);
  if (!(n >= 1)) return {};
  const copy = { ...rec };
  const g = spendAmmo(copy, n, cals);
  return g.keys;
}
// n rounds out of a record, chosen without taking them: the calibres in `cals` first (most guns first, common round
// first), then the rest cheapest first. { key: q } (a deal's "N ammo" turned into the rounds that change hands).
/** @param {Record<string, number>} rec @param {number} n @param {Record<string, number> | null} [cals] */
export function chooseRounds(rec, n, cals = null) {
  /** @type {Record<string, number>} */
  const out = {};
  let left = Math.floor(n);
  if (!rec || !(left > 0)) return out;
  const order = [];
  for (const [c] of Object.entries(cals || {}).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))) for (const t of typesOf(c)) order.push(...withHand(ammoKey(c, t))); // handloads after their factory round
  for (const k of GENERIC_KEYS.filter((x) => !order.includes(x)).sort((a, b) => SUPPLIES[a].value - SUPPLIES[b].value || (a < b ? -1 : 1))) order.push(k);
  for (const k of order) {
    if (left <= 0) break;
    const q = Math.min(left, Math.max(0, Math.floor(num(rec[k]))));
    if (q > 0) { out[k] = q; left -= q; }
  }
  return out;
}
// A deal's generic ammo turned into rounds by key (a radio deal honoured at the gates, trade.js openCaravanTrade):
// what they give, chosen from their goods for your guns; what you give, the rounds your guns need least.
/** @param {Record<string, number>} side a deal's offer or ask @param {Record<string, number>} from the record it comes out of @param {Record<string, number>} cals @param {boolean} theirs */
export function dealRounds(side, from, cals, theirs) {
  const n = Math.floor(num(side && side.ammo));
  if (!(n > 0)) return side;
  const out = { ...side };
  delete out.ammo;
  const got = theirs ? chooseRounds(from, n, cals) : spendAmmo({ ...from, ammo: 0 }, n, cals).keys;
  for (const [k, q] of Object.entries(got)) if (k !== "ammo") out[k] = (out[k] || 0) + q;
  return out;
}
// The round key this holder's guns want most of a list on offer (a deal's "ammo" asked for as rounds that fit):
// the calibre with most guns whose any type is on offer, its common round first. null: nothing fits.
/** @param {Record<string, number>} cals @param {Record<string, number>} offer key → how many there */
export function wantedKey(cals, offer) {
  const order = Object.entries(cals || {}).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  for (const [c] of order) for (const t of typesOf(c)) { const k = ammoKey(c, t); if ((offer[k] || 0) >= 1) return k; }
  return null;
}

// Box items opened into a record (an armory's, a cargo's boxes: they are stock there). Returns rounds moved.
/** @param {any[]} list @param {Record<string, number>} rec */
export function unbox(list, rec) {
  if (!Array.isArray(list) || !rec) return 0;
  let n = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const it = list[i];
    if (isBulk(it)) { for (const [k, q] of Object.entries(bulkRecord(it))) { addRounds(rec, k, q); n += q; } list.splice(i, 1); continue; } // a bulk ammo container: its rounds into the stock (the empty can is not kept)
    if (!it || !(ROUND_SUPPLIES[it.key] || RELOAD_SUPPLIES[it.key])) continue; // boxes of rounds (stacks, loose); bags of brass, cans of powder, boxes of primers (reloading.js)
    const q = Math.max(0, Math.floor(num(it.dur ?? (GEAR[it.key] ? GEAR[it.key].dur : 0))));
    if (RELOAD_SUPPLIES[it.key]) rec[it.key] = num(rec[it.key]) + q; else { addRounds(rec, it.key, q); n += q; }
    list.splice(i, 1);
  }
  return n;
}
// n rounds paid out of a base's stock (a gift, a tribute, a council's request): the ones its guns need least first.
/** @param {any} state @param {any} base @param {number} n */
export const payAmmo = (state, base, n) => spendAmmo(base.stock, n, baseCals(state, base)).n;
// The same, returning the rounds by key that went ({ key: q }; roundsText names them).
/** @param {any} state @param {any} base @param {number} n */
export const payAmmoKeys = (state, base, n) => { const g = spendAmmo(base.stock, n, baseCals(state, base)).keys; delete g.ammo; return g; };
// "40 rounds (30 9mm FMJ and 10 .22 LR FMJ)": n rounds a base would pay (the ones its guns need least), for a card.
/** @param {any} state @param {any} base @param {number} n */
export function payWord(state, base, n) {
  const g = base ? payRoundsOf(state, base, n) : {};
  return Object.keys(g).length ? `${n} rounds (${roundsText(g)})` : `${n} rounds`;
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
  const goods = p.kind === "convoy" || p.kind === "caravan"; // a trade convoy's cargo is its load: kept as it is
  if (p.cargo && !goods) unbox(p.cargo.gear, p.cargo.supplies || (p.cargo.supplies = {}));
  const cals = partyCals(state, p);
  p.ammoCals = cals; // the calibres its guns shoot (parties.js takeSupply spends the others first)
  if (!hasGeneric(p.supplies) && !(p.cargo && !goods && hasGeneric(p.cargo.supplies))) return;
  const mix = mixForCals(cals);
  settleRec(p.supplies, mix, cals);
  if (p.cargo && !goods) settleRec(p.cargo.supplies, mix, cals);
}
// Every holder of yours: the bases (camps too), your teams (the AI groups' teams keep generic ammo), an old save's
// staging camp, route convoys. Called every hour (world.js tickHour), when a world is made and when an old save loads (migrateAmmo).
/** @param {any} state */
export function settleAll(state) {
  for (const b of state.bases || []) settleBase(state, b);
  for (const p of state.parties || []) if (p.owner === "player" || p.owner == null) settleParty(state, p);
  if (state.staging && state.staging.stores && hasGeneric(state.staging.stores)) settleRec(state.staging.stores, mixForCals({}), null); // an old save's staging camp (before staging.js migrateStaging)
  for (const f of state.factions || []) if (f.stock) foldRounds(f.stock); // an AI group keeps one ammo count
  for (const p of state.parties || []) if (p.owner !== "player" && p.owner != null && p.supplies) { foldRounds(p.supplies); if (p.cargo && p.cargo.supplies && !(p.kind === "caravan" && p.phase === "trading")) foldRounds(p.cargo.supplies); } // their teams too (a caravan at your gates keeps its rounds for the deal)
}
// An old save: every generic ammo stock of yours becomes rounds split across the calibres of the guns that holder
// owns (fallback 9mm / 12 gauge), the same total (tools/ammomigrationtest.js).
/** @param {any} state */
export function migrateAmmo(state) {
  settleAll(state);
  const b = state.combat; // a fight saved half-way: its pools (a raid's finds carried loose too)
  if (b && Array.isArray(b.pools)) {
    const cals = gunCals((b.units || []).filter((u) => u.side === "player").map((u) => (state.survivors || []).find((x) => x.id === u.sid)).filter(Boolean));
    for (const p of b.pools) settleRec(p, mixForCals(cals), cals);
  }
  for (const s of state.survivors || []) {
    const w = s.gear && s.gear.weapon;
    if (w && w.load != null && !(calOf(w.key) && CALIBERS[calOf(w.key)].types.includes(w.load)) && w.load !== "auto") w.load = null;
  }
}

// ---------- finds ----------
// The ammo theme of a site type or a raid area (data-ammo.js AMMO_MIX): its first theme tag that has one.
const THEMES = ["military", "police", "prison", "guns", "farm", "hunt", "crime"];
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
// A find already rolled as generic ammo ({ ammo: 12, food: 3 }) turned into rounds of a theme, in place (the old dice
// say how many; own dice say which).
/** @param {Record<string, number>} sup @param {string} theme @param {...any} salt */
export function sortFind(sup, theme, ...salt) {
  if (!sup || !(num(sup.ammo) >= 1)) return sup;
  const n = Math.floor(sup.ammo);
  delete sup.ammo;
  for (const [k, q] of Object.entries(findRounds(theme, n, ...salt))) addRounds(sup, k, q);
  return sup;
}
// A raid container's theme: the site's when it is a gun place (a police station's armory holds police rounds), else
// the area's.
/** @param {string | null | undefined} siteType @param {string} areaType */
export function raidTheme(siteType, areaType) {
  const st = themeOf(siteType);
  return ["military", "police", "prison", "guns"].includes(st) ? st : themeOf(areaType, true);
}
// A find handed out through a function that adds one key at a time (a team's cargo, where room may cut it short):
// add(key, q) returns what fitted. Returns the total that fitted.
/** @param {(key: string, q: number) => number} add @param {string} theme @param {number} n @param {...any} salt */
export function addFindVia(add, theme, n, ...salt) {
  let got = 0;
  for (const [k, q] of Object.entries(findRounds(theme, n, ...salt))) got += add(k, q) || 0;
  return got;
}
// A gun safe's or a gun case's rounds (gunsafes.js registerStashExtra): the generic ammo its table rolled, as the
// rounds for the guns in it (now and then a box of a typed load: hollow points, soft points, slugs), else what the
// site holds. ctx: { roll, tier, siteType }, out: { gear, sup } (changed in place).
/** @param {any} ctx @param {any} out */
export function stashRounds(ctx, out) {
  const n = Math.floor(num(out && out.sup && out.sup.ammo));
  if (!(n > 0)) return;
  delete out.sup.ammo;
  const cals = gunCals([], out.gear || []);
  if (!Object.keys(cals).length) { for (const [k, q] of Object.entries(findRounds(themeOf(ctx && ctx.siteType), n, "stash", ctx && ctx.tier))) addRounds(out.sup, k, q); return; }
  const r = ctx && typeof ctx.roll === "function" ? ctx.roll("ammotype") : 0.5;
  const parts = splitByMix(n, mixForCals(cals));
  for (const [k, q] of Object.entries(parts)) {
    const cal = roundOf(k).cal;
    const typed = r < 0.3 ? ["hp", "sp", "slug"].find((t) => CALIBERS[cal].types.includes(t) && t !== baseType(cal)) : null;
    addRounds(out.sup, typed ? ammoKey(cal, typed) : k, q);
  }
}
// An AI group's kind as an ammo theme (data-ammo.js KIND_MIX).
/** @param {string | null | undefined} kind */
export const kindTheme = (kind) => KIND_MIX[kind] || "guns";
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

// The rounds on one of the dead (combat.js enemyUnit's people: their gun's calibre and load; anyone else, the rounds a
// place of their kind holds, own dice). Returns { key: n }.
const KIT_THEME = { soldiers: "military", guards: "police", raiders: "raider", zealots: "home", fighters: "raider", militia: "hunt", survivors: "home" };
/** @param {any} u a battle unit @param {number} n */
export function bodyRounds(u, n) {
  n = Math.floor(n);
  if (!(n > 0)) return {};
  const cal = u ? calOf(u.weapon) : null;
  if (cal) return { [keyFor(cal, u.load)]: n };
  return findRounds(u && u.kit ? KIT_THEME[u.kit] || "home" : "home", n, "body", u ? u.id : 0, u ? u.name : "");
}

// ---------- loose, boxed and bulk finds (2026-10-10, user request: "find loose and boxed ammo") ----------
// How common a round is where rounds turn up, 0–1 (1: the most common round): a load's own rarity when the data gives
// one (AMMO_TYPES rarity, 0 common – 1 rare), else the round's own tier (data-ammo.js ROUND_ECON → RARITY_FIND), else
// its share of the finds in every place (data-ammo.js AMMO_MIX), so the finds' numbers drive it. Launcher rounds: 0 (never in bulk).
const COMMON = new Map();
/** @param {string} key @returns {number} */
export function commonness(key) {
  if (COMMON.has(key)) return COMMON.get(key);
  const r = roundOf(factoryKey(key));
  let c = 0;
  if (r && CALIBERS[r.cal] && CALIBERS[r.cal].common !== false) {
    const own = AMMO_TYPES[r.type] && AMMO_TYPES[r.type].rarity;
    if (Number.isFinite(own)) c = Math.max(0, Math.min(1, 1 - own));
    else if (ROUND_ECON[`${r.cal}_${r.type}`]) c = RARITY_FIND[roundTier(r.cal, r.type)] ?? 0; // the round's own tier (data-ammo.js ROUND_ECON, 2026-10-10): common 1, uncommon 0.45, scarce 0.18, rare 0.06, very rare 0.02
    else {
      const share = (k) => Object.values(AMMO_MIX).reduce((a, mix) => { const tot = Object.values(mix).reduce((x, y) => x + y, 0) || 1; return a + (mix[k.slice(2)] || 0) / tot; }, 0);
      const top = Math.max(...Object.keys(ROUND_SUPPLIES).map(share));
      c = top > 0 ? share(factoryKey(key)) / top : 0;
    }
  }
  COMMON.set(key, c);
  return c;
}
// A find's rounds in their forms, in place (sup: the find's supplies; gear: its items): of each kind, whole boxes of a
// share of it (BULK_FINDS.BOXED by theme, own dice) go into gear as stacks of boxes (up to five a slot), the rest stays
// loose in sup; now and then (BULK_FINDS.CHANCE by theme × commonness) a bulk container of the theme's rounds as well,
// part filled at times. Returns the items added. Own dice (hash01): the world's random numbers are not touched.
/** @param {Record<string, number>} sup @param {any[]} gear @param {string} theme @param {...any} salt */
export function formFinds(sup, gear, theme, ...salt) {
  const out = boxFinds(sup, gear, theme, ...salt);
  const bulk = Array.isArray(gear) ? bulkFind(theme, ...salt) : null;
  if (bulk) { gear.push(bulk); out.push(bulk); }
  return out;
}
// The same without the bulk container (a gun safe: its rounds in their boxes).
/** @param {Record<string, number>} sup @param {any[]} gear @param {string} theme @param {...any} salt */
export function boxFinds(sup, gear, theme, ...salt) {
  const out = [];
  if (!sup || !Array.isArray(gear)) return out;
  const share = BULK_FINDS.BOXED[theme] ?? BULK_FINDS.BOXED.home;
  for (const k of Object.keys(sup).sort()) {
    const q = Math.floor(num(sup[k]));
    if (!(q > 0) || !ROUND_SUPPLIES[k] || !GEAR[k] || ROUND_SUPPLIES[k].common === false) continue;
    const box = boxSize(k);
    const roll = hash01("boxed", theme, k, q, ...salt);
    const boxes = roll < share ? Math.floor((q * (0.5 + roll / Math.max(0.01, share) * 0.5)) / box) : 0;
    if (!(boxes > 0)) continue;
    const items = roundItems(k, boxes * box, false);
    sup[k] = q - boxes * box;
    if (!(sup[k] > 0)) delete sup[k];
    gear.push(...items);
    out.push(...items);
  }
  return out;
}
// A bulk container a place of this theme may hold (null: none): which round by the theme's mix, its odds × the round's
// commonness, the kind by BULK_FINDS.KIND (a can one kind, a carton that calibre, a bag that and one or two more of the
// mix), filled FULL of its cap (PARTIAL of them part used).
/** @param {string} theme @param {...any} salt */
export function bulkFind(theme, ...salt) {
  const mix = themeMix(theme);
  if (!Object.keys(mix).length) return null;
  const key = pickBy(mix, hash01("bulkkey", theme, ...salt));
  const odds = (BULK_FINDS.CHANCE[theme] ?? BULK_FINDS.CHANCE.home) * commonness(key);
  if (!(hash01("bulk", theme, ...salt) < odds)) return null;
  const kind = pickBy(BULK_FINDS.KIND, hash01("bulkkind", theme, ...salt));
  const cap = BULK[kind].cap;
  const [lo, hi] = BULK_FINDS.FULL;
  const full = hash01("bulkpart", theme, ...salt) < BULK_FINDS.PARTIAL ? lo + (hi - lo) * hash01("bulkfill", theme, ...salt) : 1;
  const n = Math.max(1, Math.floor(cap * full));
  const it = newBulk(kind);
  if (!it) return null;
  if (kind === "ammobag") {
    const keys = [key, pickBy(mix, hash01("bulkkey2", theme, ...salt)), pickBy(mix, hash01("bulkkey3", theme, ...salt))].filter((k, i, a) => a.indexOf(k) === i && commonness(k) > 0);
    keys.forEach((k, i) => fillBulk(it, k, i === keys.length - 1 ? n : Math.floor(n / keys.length)));
  } else if (kind === "ammocarton") {
    const cal = roundOf(key).cal, alt = keyFor(cal, null);
    fillBulk(it, key, Math.ceil(n * 0.8));
    fillBulk(it, alt !== key ? alt : key, n);
  } else fillBulk(it, key, n);
  return it;
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
  for (const it of (pack && pack.contents) || []) if (isBulk(it)) out.push(...loadsOf(it)); // an ammo can in the pack: its rounds are the pack's (a fight draws on them after the boxes)
  return out;
}
// Empty boxes thrown away (after a fight).
/** @param {any} s */
export function sweepBoxes(s) {
  if (!s) return;
  const empty = (it) => it && ROUND_SUPPLIES[it.key] && !(num(it.dur) >= 1);
  if (Array.isArray(s.pockets)) for (let i = 0; i < s.pockets.length; i++) if (empty(s.pockets[i])) s.pockets[i] = null;
  const pack = s.gear && s.gear.backpack;
  if (pack && Array.isArray(pack.contents)) for (let i = 0; i < pack.contents.length; i++) { if (empty(pack.contents[i])) pack.contents[i] = null; else if (isBulk(pack.contents[i])) sweepLoads(pack.contents[i]); }
  for (const holder of [s.gear && s.gear.rig, s.gear && s.gear.armor]) { const rp = holder && Array.isArray(holder.contents) ? holder.contents : null; if (rp) for (let i = 0; i < rp.length; i++) if (empty(rp[i])) rp[i] = null; } // loose rounds or a box spent in a rig's (or a vest's) pouch
}

// ---------- the battle ----------
// A unit's loaded type (u.load: a type key; a unit from before has its calibre's common round).
/** @param {any} u */
export const loadOf = (u) => { const c = calOf(u && u.weapon); return c ? typeFor(c, u.load) : null; };
// Rounds of one key to hand for this unit: its own boxes, its side's other fighters' boxes, the pools.
/** @param {any} b @param {any} u @param {string} key */
function battleKeyRounds(b, u, key) {
  let n = 0;
  for (const k of withHand(key)) { // the bench's handloads of it too (reloading.js)
    for (const o of b.units || []) if (o.side === u.side && o.boxes) for (const it of o.boxes) if (it && it.key === k) n += Math.max(0, Math.floor(num(it.dur)));
    for (const p of b.pools || []) n += Math.max(0, Math.floor(num(p[k])));
  }
  return n;
}
// The handload key the unit's next round comes from (takeBattleRounds' order: its own boxes, its teammates', the
// pools; in each the factory round first), or null for a factory round (or none). gunfire.js reads its make.
/** @param {any} b @param {any} u */
export function nextHand(b, u) {
  const cal = calOf(u && u.weapon);
  if (!cal) return null;
  const keys = withHand(keyFor(cal, u.load));
  if (keys.length < 2) return null;
  const [fk, hk] = keys;
  const box = (list) => { let f = 0, h = 0; for (const it of list || []) if (it && num(it.dur) >= 1) { if (it.key === fk) f++; else if (it.key === hk) h++; } return f ? "f" : h ? "h" : ""; };
  const own = box(u.boxes);
  if (own) return own === "h" ? hk : null;
  for (const o of b.units || []) if (o !== u && o.side === u.side && o.boxes) { const m = box(o.boxes); if (m) return m === "h" ? hk : null; }
  for (const p of b.pools || []) { if (num(p[fk]) >= 1) return null; if (num(p[hk]) >= 1) return hk; }
  return null;
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
  const keys = withHand(keyFor(cal, u.load)); // in each holder its factory rounds first, then the bench's handloads
  let got = 0;
  const fromBox = (it, key) => { if (got >= n || !it || it.key !== key) return; const q = Math.min(n - got, Math.max(0, Math.floor(num(it.dur)))); it.dur -= q; got += q; };
  const fromBoxes = (list) => { for (const key of keys) for (const it of list || []) fromBox(it, key); };
  fromBoxes(u.boxes);
  for (const o of b.units || []) if (o !== u && o.side === u.side && o.boxes) fromBoxes(o.boxes);
  for (const p of b.pools || []) for (const key of keys) {
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
  const cls = cal === "12ga" || cal === "20ga" ? "shotgun" : ["9mm", "45acp", "357", "22lr"].includes(cal) ? "pistol" : "rifle";
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
  return t.soft || dmg; // on the unarmoured a hit is the gun's dmg × soft (the type's dmg is inside soft: ammo.js softMult), not dmg × soft
}
// Is this unit armoured (people in body armour, the armoured dead, a Boneback, a Brute)?
/** @param {any} t */
export const armoured = (t) => !!t && ((t.kind === "human" && ((t.armorKey && GEAR[t.armorKey] && GEAR[t.armorKey].power >= 2) || (t.wornArmor != null && t.wornArmor <= 0.85))) || ["soldier", "riot", "boneback", "brute"].includes(t.ztype));
// × a shot's noise for the type loaded (stealth.js shotNoise): subsonic 0.75 (0.6 through a suppressor), +P 1.1.
/** @param {any} u @param {boolean} [suppressed] */
export function loadNoise(u, suppressed = false) {
  const t = typeFx(loadOf(u));
  return (suppressed && t.noiseSuppressed) || t.noise || 1;
}
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
    let got = takeRounds(rec, cal, w.load && w.load !== "auto" ? w.load : null, perHead, false);
    diffInto(before, rec, out.used);
    const g = Math.min(perHead - got, Math.max(0, Math.floor(num(rec.ammo)))); // generic ammo (another group's abstract stores) fits any gun
    if (g > 0) { rec.ammo -= g; got += g; out.used.ammo = (out.used.ammo || 0) + g; }
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
// The same over several records (a team's packed supplies and its cargo, a battle's pools), `total` rounds shared out
// whole between the people (the first ones get the odd rounds): each takes from the records in order. Returns
// { n, used: { key: q } } (used: the rounds by key, for the armed factor and ammoEdge).
/** @param {Record<string, number>[]} recs @param {any[]} people @param {number} total */
export function drawTeamShots(recs, people, total) {
  const out = { n: 0, used: /** @type {Record<string, number>} */ ({}) };
  total = Math.floor(total);
  if (!(total > 0) || !people || !people.length) return out;
  const per = Math.floor(total / people.length), odd = total - per * people.length;
  people.forEach((s, i) => {
    let want = per + (i < odd ? 1 : 0);
    for (const rec of recs) {
      if (!rec || want <= 0) continue;
      const d = drawShots(rec, [s], want);
      want -= d.n; out.n += d.n;
      for (const [k, q] of Object.entries(d.used)) out.used[k] = (out.used[k] || 0) + q;
    }
  });
  return out;
}
const snapshot = (rec, cal) => typesOf(cal).flatMap((t) => withHand(ammoKey(cal, t))).map((k) => [k, num(rec[k])]); // handloads too
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

// ---------- the ammo bench ----------
// n rounds made at a base (buildings.js runStations: the ammo bench): the common rounds of the calibres its guns shoot
// (the people there and its armory), most to the calibres furthest under 40 rounds a gun. No guns: 9mm and 12 gauge.
/** @param {any} state @param {any} base @param {number} n */
export function benchRounds(state, base, n) {
  const cals = baseCals(state, base);
  /** @type {Record<string, number>} */
  const mix = {};
  for (const [c, w] of Object.entries(cals)) mix[baseKey(c)] = w * Math.max(1, 40 * w - roundsIn(base.stock, c));
  return addAmmo(base.stock, n, Object.keys(mix).length ? mix : mixForCals({}));
}

// ---------- hunting (R9: the gun's loaded type) ----------
// What a load does for a hunter: soft points and hollow points drop big game cleaner, birdshot is for small game (and
// poor on a deer), a slug for big game.
export const HUNT_LOAD = { sp: { big: 1.1 }, hp: { big: 1.05 }, bird: { small: 1.3, big: 0.6 }, slug: { big: 1.1, small: 0.9 }, ap: { big: 0.95 }, match: { big: 1.05 }, subsonic: { big: 0.92 } };
// The rounds a hunter's gun has to hand: ammo a number (any rounds, the old rule) or a record (its calibre's rounds and
// any generic ammo).
/** @param {number | Record<string, number> | null | undefined} ammo @param {any} item */
export function huntRounds(ammo, item) {
  if (ammo == null) return Infinity;
  if (typeof ammo !== "object") return ammo;
  const cal = item ? calOf(item.key) : null;
  return cal ? roundsIn(ammo, cal) + Math.max(0, Math.floor(num(ammo.ammo))) : 0;
}
// The load a hunter's gun fires (item.load while there are rounds of it, else its common round) and its effect.
/** @param {any} item @param {number | Record<string, number> | null | undefined} ammo */
export function huntLoad(item, ammo) {
  const cal = item ? calOf(item.key) : null;
  if (!cal) return { type: null, big: 1, small: 1 };
  const t = typeFor(cal, item.load);
  const ok = t !== baseType(cal) && (typeof ammo !== "object" || ammo == null || roundsIn(ammo, cal, t) > 0);
  const fx = ok ? HUNT_LOAD[t] || {} : {};
  return { type: ok ? t : baseType(cal), big: fx.big || 1, small: fx.small || 1 };
}
// A hunter's shots out of records in order (a team's cargo then its packed supplies; a base's stock): the gun's load
// first, then its common round and the rest of its calibre; generic ammo last. Returns the rounds taken.
/** @param {(Record<string, number> | null | undefined)[]} recs @param {any} item @param {number} n */
export function takeHuntShots(recs, item, n) {
  const cal = item ? calOf(item.key) : null;
  let got = 0;
  for (const rec of recs) {
    if (!rec || got >= n) continue;
    if (cal) got += takeRounds(rec, cal, item.load && item.load !== "auto" ? item.load : null, n - got, false);
    const g = Math.min(n - got, Math.max(0, Math.floor(num(rec.ammo))));
    if (g > 0) { rec.ammo -= g; got += g; }
  }
  return got;
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
  rec.ammo = 0;
  return giveRounds(rec, n, weapons);
}
// Per-calibre breakdown of a record for a tooltip: "9mm 120 (HP 20), 12 gauge 30".
/** @param {Record<string, number>} rec */
export function roundsLine(rec) {
  const parts = [];
  for (const cal of Object.keys(CALIBERS)) {
    const n = roundsIn(rec, cal);
    if (!n) continue;
    const typed = typesOf(cal).slice(1).filter((t) => roundsIn(rec, cal, t) > 0).map((t) => `${AMMO_TYPES[t].name} ${roundsIn(rec, cal, t)}`);
    parts.push(`${CALIBERS[cal].name} ${n}${typed.length ? ` (${typed.join(", ")})` : ""}`);
  }
  const g = Math.floor(num(rec && rec.ammo));
  if (g > 0) parts.push(`${g} unsorted`);
  return parts.join(", ") || "none";
}

// ---------- every round together (2026-10-09, user request: "The ammo shown at the top should be a combined number of
// ammo and when hovering shows the breakdown of how much per caliber including arrows") ----------
// Records (a base's stock, a team's supplies and cargo) and loose box items (pockets, packs) as one breakdown: every
// calibre (launcher rounds too) with its types (a handload counted with its factory round), arrows and bolts, and any
// generic ammo not yet sorted. Returns { total, rows: [{ key, name, n, types: [{ type, name, n }] }] }, most first.
/** @param {(Record<string, number> | null | undefined)[]} recs @param {any[]} [boxes] box items */
export function ammoBreakdown(recs, boxes = []) {
  /** @type {Record<string, number>} */
  const byKey = {};
  let arrows = 0, loose = 0;
  const add = (k, q) => { const f = factoryKey(k); if (ROUND_SUPPLIES[f]) byKey[f] = (byKey[f] || 0) + q; };
  for (const r of recs || []) {
    if (!r) continue;
    for (const k of Object.keys(r)) {
      const q = Math.floor(num(r[k]));
      if (!(q > 0)) continue;
      if (k === "arrows") arrows += q;
      else if (k === "ammo") loose += q;
      else if (ROUND_SUPPLIES[k] || HAND_SUPPLIES[k]) add(k, q);
    }
  }
  for (const it of boxes || []) { if (!it || !ROUND_SUPPLIES[it.key]) continue; const q = Math.max(0, Math.floor(num(it.dur))); if (q > 0) add(it.key, q); }
  /** @type {Record<string, any>} */
  const cals = {};
  for (const [k, q] of Object.entries(byKey)) {
    const r = roundOf(k);
    if (!r) continue;
    const row = cals[r.cal] || (cals[r.cal] = { key: r.cal, name: calName(r.cal), n: 0, types: [] });
    row.n += q;
    row.types.push({ type: r.type, name: typeName(r.type), n: q });
  }
  const rows = Object.values(cals);
  for (const row of rows) row.types.sort((a, b) => b.n - a.n || (a.type < b.type ? -1 : 1));
  if (arrows > 0) rows.push({ key: "arrows", name: "Arrows and bolts", n: arrows, types: [] });
  if (loose > 0) rows.push({ key: "ammo", name: "Unsorted rounds", n: loose, types: [] });
  rows.sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1));
  return { total: rows.reduce((a, r) => a + r.n, 0), rows };
}
// The breakdown as a tooltip's text, one calibre a line: "9mm 120 (FMJ 100, hollow point 20)", "Arrows and bolts 40".
/** @param {{ rows: any[] }} bd @param {string} [sep] */
export function breakdownText(bd, sep = " · ") {
  if (!bd || !bd.rows.length) return "none";
  return bd.rows.map((r) => `${r.name} ${r.n}${r.types.length > 1 ? ` (${r.types.map((t) => `${t.name} ${t.n}`).join(", ")})` : r.types.length ? ` (${r.types[0].name})` : ""}`).join(sep);
}
// A base's ammo as the top bar shows it: its stock (rounds, arrows) and the boxes its people carry. Cached per hour
// and stock figure (the bar is drawn often).
const BAR_CACHE = new WeakMap();
/** @param {any} state @param {any} base */
export function baseAmmoBreakdown(state, base) {
  if (!base || !base.stock) return { total: 0, rows: [] };
  const people = peopleAt(state, base.id);
  let sig = `${state.hour}|${people.length}`;
  for (const k of Object.keys(base.stock)) if (ROUND_SUPPLIES[k] || HAND_SUPPLIES[k] || k === "arrows" || k === "ammo") sig += `|${k}:${Math.floor(num(base.stock[k]))}`;
  const c = BAR_CACHE.get(base);
  if (c && c.sig === sig) return c.bd;
  const bd = ammoBreakdown([base.stock], people.flatMap(boxesOf));
  BAR_CACHE.set(base, { sig, bd });
  return bd;
}
// A team's (its packed supplies, its cargo, the boxes its people carry).
/** @param {any} state @param {any} p */
export const teamAmmoBreakdown = (state, p) => (p ? ammoBreakdown([p.supplies, p.cargo && p.cargo.supplies], membersOf(state, p).flatMap(boxesOf)) : { total: 0, rows: [] });

// ---------- generic counts turned into rounds for your side (2026-10-09, user request: "All ammo should be based on
// caliber") ----------
// Rounds in a record as words for a card or a log line: "20 9mm FMJ and 10 12 gauge 00 buckshot" (generic ammo:
// "N rounds"). Arrows are not rounds (their own key).
/** @param {Record<string, number> | null | undefined} rec */
export function roundsText(rec) {
  const parts = [];
  for (const [k, q] of Object.entries(rec || {})) {
    if (!(q >= 1)) continue;
    if (k === "ammo") parts.push(`${Math.floor(q)} rounds`);
    else if (ROUND_SUPPLIES[k] || HAND_SUPPLIES[k]) parts.push(`${Math.floor(q)} ${(ROUND_SUPPLIES[k] || HAND_SUPPLIES[k]).name}`);
  }
  return parts.length <= 1 ? parts.join("") || "no rounds" : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}
// A supply record as words with the rounds named by calibre ("12 food, 20 9mm FMJ"), for cards and log lines.
/** @param {Record<string, number> | null | undefined} rec */
export function suppliesText(rec) {
  const parts = [];
  for (const [k, q] of Object.entries(rec || {})) {
    if (!(q >= 1)) continue;
    if (k === "ammo" || ROUND_SUPPLIES[k] || HAND_SUPPLIES[k]) parts.push(roundsText({ [k]: q }));
    else parts.push(`${Math.floor(q)} ${SUPPLIES[k] ? SUPPLIES[k].name.toLowerCase() : k}`);
  }
  return parts.join(", ") || "nothing";
}
// n generic rounds as common rounds of these calibres ({ key: q }; no guns: 9mm and 12 gauge, half each).
/** @param {number} n @param {Record<string, number>} [cals] */
export const calRounds = (n, cals = {}) => splitByMix(Math.floor(n), mixForCals(cals));
// A record's generic ammo turned into common rounds of these calibres, in place (a reward, a deal's side, a background
// saved before rounds went by calibre). Returns the rounds added.
/** @param {Record<string, number>} rec @param {Record<string, number>} [cals] */
export function calibrate(rec, cals = {}) {
  if (!rec || typeof rec !== "object" || !("ammo" in rec)) return {};
  const n = Math.floor(num(rec.ammo));
  delete rec.ammo;
  if (!(n >= 1)) return {};
  const parts = calRounds(n, cals);
  for (const [k, q] of Object.entries(parts)) addRounds(rec, k, q);
  return parts;
}
// The calibres of a holder of yours (a base or a team; anything else: none known, the fallback 9mm / 12 gauge).
/** @param {any} state @param {any} holder a base ({ stock }) or a team ({ supplies, members }) */
export const holderCals = (state, holder) => (!holder ? {} : holder.stock && holder.id != null && !holder.members ? baseCals(state, holder) : holder.members ? partyCals(state, holder) : {});
// n generic rounds given to a holder of yours, at once as the rounds for its guns (a reward, a gift, a deal's goods):
// into rec (default its stock / supplies). Returns { key: q } (roundsText says what).
/** @param {any} state @param {any} holder @param {number} n @param {Record<string, number> | null} [rec] */
export function giveRoundsTo(state, holder, n, rec = null) {
  const to = rec || (holder && (holder.stock || holder.supplies));
  if (!to || !(n >= 1)) return {};
  const parts = calRounds(n, holderCals(state, holder));
  for (const [k, q] of Object.entries(parts)) addRounds(to, k, q);
  return parts;
}
// n generic rounds a holder of yours would pay (a deal's "N ammo"): the rounds its guns need least, chosen without
// taking them ({ key: q }; short: what there is).
/** @param {any} state @param {any} holder @param {number} n */
export function payRoundsOf(state, holder, n) {
  const recs = holder ? (holder.stock && !holder.members ? [holder.stock] : [holder.cargo && holder.cargo.supplies, holder.supplies]) : [];
  /** @type {Record<string, number>} */
  const out = {};
  let left = Math.floor(n);
  const cals = holderCals(state, holder);
  for (const r of recs) {
    if (!r || left <= 0) continue;
    const g = spendAmmo({ ...r, ammo: 0 }, left, cals).keys;
    for (const [k, q] of Object.entries(g)) if (k !== "ammo" && q > 0) { out[k] = (out[k] || 0) + q; left -= q; }
  }
  return out;
}
// A deal's sides with generic ammo named by calibre for your side, in place: what you get, the rounds for your guns;
// what you give, the rounds your guns need least (short: the rest asked as the common rounds of your guns). give / get
// are the deal's records as seen from your side. Returns the deal.
/** @param {any} state @param {any} holder @param {{ give?: Record<string, number> | null, get?: Record<string, number> | null }} deal */
export function calibrateDeal(state, holder, deal) {
  if (!deal) return deal;
  const cals = holderCals(state, holder);
  if (deal.get && num(deal.get.ammo) >= 1) calibrate(deal.get, cals);
  if (deal.give && num(deal.give.ammo) >= 1) {
    const n = Math.floor(deal.give.ammo);
    const keys = payRoundsOf(state, holder, n);
    const got = Object.values(keys).reduce((a, q) => a + q, 0);
    delete deal.give.ammo;
    for (const [k, q] of Object.entries(keys)) deal.give[k] = (deal.give[k] || 0) + q;
    if (got < n) for (const [k, q] of Object.entries(calRounds(n - got, cals))) deal.give[k] = (deal.give[k] || 0) + q;
  }
  return deal;
}
// Rounds by key in a record clamped to `cap` rounds in all (the editors' caps); generic ammo first turned into common
// rounds of `cals`. Returns a new record of the round keys only (launcher rounds too).
/** @param {Record<string, number> | null | undefined} src @param {number} cap @param {Record<string, number>} [cals] */
export function capRounds(src, cap, cals = {}) {
  /** @type {Record<string, number>} */
  const out = {};
  if (!src || typeof src !== "object") return out;
  /** @type {Record<string, number>} */
  const rec = {};
  for (const [k, v] of Object.entries(src)) { const q = Math.round(Number(v)); if (q > 0 && (ROUND_SUPPLIES[k] || k === "ammo")) rec[k] = q; }
  calibrate(rec, cals);
  let left = Math.max(0, Math.floor(cap));
  for (const k of Object.keys(rec).filter((x) => ROUND_SUPPLIES[x]).sort()) {
    const q = Math.min(left, rec[k]);
    if (q > 0) { out[k] = q; left -= q; }
  }
  return out;
}
