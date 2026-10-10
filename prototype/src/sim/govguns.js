// @ts-check
// The governor buys guns (user, 2026-10-10: "the governor buys a gun from traders, arms dealers and radio deals when
// people who should be armed go unarmed").
//
// Who wants one (gunWant): at a base, everyone with no weapon they can use, and the guards and scavengers (the people
// who fight and go out) with nothing but a melee weapon or a bow; less the guns lying in its armory that one of them
// can use (equipFromArmory hands those out first) and the guns already on their way (a radio deal's caravan).
// Which (pickGunToBuy): of the guns on offer, one a needy person can use (world.js gearEffect), within the budget (the
// value of what the base can spare, as each trade reckons it: its usual reserves stay), worth the most a unit of price
// (power × quality ÷ price), × ROUNDS when the base has rounds for its calibre (data-ammo.js: any calibre it takes),
// one a deal. Where: a team's trade at a group's base (autopilot.js handleTrade), a group's caravan at your gates
// (caravans.js autoCaravanTrade), merchants and arms dealers from outside (visitors.js autoVisitorTrade), and by radio
// (radioGunDeal, every RADIO_EVERY days at most: a group whose caravan comes to the base brings it).
// AI parity: the AI groups buy too, coarsely (arsenal.js arsenalDaily, ARSENAL.BUY).
import { GEAR } from "./data.js";
import { atBase, gearEffect, day } from "./world.js";
import { isGun } from "./gundist.js";
import { gunCalsOf } from "./ammo.js";
import { roundsIn } from "./rounds.js";

export const GOV_GUNS = {
  off: false, // tests: the governor buys no guns
  ROLES: ["guard", "scavenge"], // these want a gun, not a club or a bow
  ROUNDS: 1.6, // a gun whose rounds the base has is worth this much more
  ROUNDS_MIN: 20, // rounds of its calibres to count as having them
  BUDGET: 0.6, // at most this share of the deal's budget on a gun
  RADIO_EVERY: 10, // days between radio gun deals
};
const usable = (s, it) => !!(it && gearEffect(s, it).usable);
const hasGun = (s) => !!(s.gear && s.gear.weapon && isGun(s.gear.weapon.key) && usable(s, s.gear.weapon));
const armed = (s) => !!(s.gear && s.gear.weapon && usable(s, s.gear.weapon));

// The people at a base who want a gun, and how many guns it wants: { n, needy }.
/** @param {any} state @param {any} base */
export function gunWant(state, base) {
  if (GOV_GUNS.off || !base) return { n: 0, needy: [] };
  const needy = atBase(state, base.id).filter((s) => !armed(s) || (GOV_GUNS.ROLES.includes(s.role) && !hasGun(s)));
  if (!needy.length) return { n: 0, needy };
  const loose = (base.armory || []).filter((it) => it && isGun(it.key) && needy.some((s) => usable(s, it))).length;
  const coming = incomingGuns(state, base);
  return { n: Math.max(0, needy.length - loose - coming), needy };
}
// Guns already bought and on their way to the base (a radio deal's caravan).
function incomingGuns(state, base) {
  let n = 0;
  for (const q of state.parties || []) {
    if (q && q.kind === "caravan" && q.deal && q.baseId === base.id && q.goods) n += (q.goods.gear || []).filter((g) => g && isGun(g.key)).length;
    else if (q && q.owner === "player" && q.homeBaseId === base.id && q.cargo) n += (q.cargo.gear || []).filter((g) => g && isGun(g.key)).length; // a team bringing one home
  }
  for (const d of state.radioDeals || []) if (d && d.baseId === base.id && d.get && Array.isArray(d.get.gear)) n += d.get.gear.filter((g) => g && isGun(g.key)).length;
  return n;
}
// The rounds a base has for a gun (any calibre it takes).
/** @param {any} base @param {string} key */
export const roundsFor = (base, key) => gunCalsOf(key).reduce((a, c) => a + roundsIn(base.stock, c), 0);
// The gun to buy from `list` for this base (null: none wanted, none fits, none affordable). price(item): what it
// costs; budget: what the base can spend on this deal; room: what the buyers can carry (kg).
/** @param {any} state @param {any} base @param {any[]} list @param {(it: any) => number} price @param {number} budget @param {number} [room] */
export function pickGunToBuy(state, base, list, price, budget, room = Infinity) {
  const want = gunWant(state, base);
  if (!want.n) return null;
  const T = tally(state);
  T.looks++; // (a deal where a gun was wanted: tools read it)
  if (!(budget > 0)) { T.why.budget++; return null; }
  let best = null, bestScore = 0;
  for (const it of list || []) {
    if (!it || !isGun(it.key) || !want.needy.some((s) => usable(s, it))) continue;
    if ((GEAR[it.key].weight || 1) > room) continue;
    const cost = price(it);
    if (!(cost > 0) || cost > budget * GOV_GUNS.BUDGET) continue;
    const score = ((GEAR[it.key].power || 1) * (it.quality ?? 1) * (roundsFor(base, it.key) >= GOV_GUNS.ROUNDS_MIN ? GOV_GUNS.ROUNDS : 1)) / cost;
    if (score > bestScore) { best = it; bestScore = score; }
  }
  if (!best) T.why[(list || []).some((it) => it && isGun(it.key)) ? "dear" : "none"]++;
  return best;
}
// The tally (state.govGuns: the 2-year autopilot report, tools/gunloottest.js): guns bought, what they cost, by
// where; looks: deals where a gun was wanted, why: why none was bought then (no budget, too dear, none on offer).
/** @param {any} state */
const tally = (state) => {
  const T = (state.govGuns = state.govGuns || { bought: 0, spend: 0, by: {}, day: null });
  if (T.looks == null) { T.looks = 0; T.why = { budget: 0, dear: 0, none: 0 }; }
  return T;
};
/** @param {any} state @param {any} item @param {number} cost @param {string} where */
export function noteGunBought(state, item, cost, where) {
  const T = tally(state);
  T.bought++;
  T.spend += Math.round(cost || 0);
  T.by[where] = (T.by[where] || 0) + 1;
  T.day = day(state);
}
// A radio gun deal for this base (autopilot.js stewardTrade): with a group whose caravan comes here, its gun on the
// shelf, paid with what the base has plenty of; deals are booked by trade.js executeTrade (radiotrade.js). deps: the
// trade functions (passed in: radio.js and trade.js import much of the game); spareValue(f, k): what the base's
// spare of k is worth to f. Returns a log text or "".
/** @param {any} state @param {any} base @param {any} needs @param {any} deps */
export function radioGunDeal(state, base, needs, deps) {
  const { hasNetwork, refusal, caravanEnRoute, tradeBase, deliveryRefusal, openRadioTrade, tradeContext, balanceWith, tradeVerdict, executeTrade, endTrade, gearBuyPrice, pendingDeal, ensureWares } = deps;
  if (GOV_GUNS.off || state.trade || !hasNetwork(state)) return "";
  const T = state.govGuns || {};
  if (T.radioDay != null && day(state) - T.radioDay < GOV_GUNS.RADIO_EVERY) return "";
  if (!gunWant(state, base).n) return "";
  const plenty = Object.keys(needs).filter((k) => needs[k] <= 0.5 && (base.stock[k] || 0) > 0).sort((a, b) => needs[a] - needs[b]);
  if (!plenty.length) return "";
  for (const f of [...state.factions].sort((a, b) => a.id - b.id)) {
    if (!f.alive || !f.known || refusal(state, f, true) || caravanEnRoute(state, f) || pendingDeal(state, f)) continue;
    if (tradeBase(state, f) !== base || deliveryRefusal(state, f, base)) continue;
    ensureWares(state, f);
    if (!(f.wares || []).some((it) => it && isGun(it.key))) continue;
    if (openRadioTrade(state, f, base.id, "deliver")) continue;
    const ctx = tradeContext(state);
    let text = "";
    if (ctx) {
      const budget = plenty.reduce((a, k) => a + deps.spareValue(f, k), 0); // what it can pay with (its usual reserves kept)
      const gun = pickGunToBuy(state, base, ctx.theirGear, (it) => gearBuyPrice(state, f, it, ctx.speech), budget);
      if (gun) {
        state.trade.askGear = [gun];
        for (const k of plenty) { if (tradeVerdict(state).ok) break; balanceWith(state, k); }
        if (tradeVerdict(state).ok) {
          const cost = gearBuyPrice(state, f, gun, ctx.speech);
          const res = executeTrade(state);
          if (/^Deal over the radio/.test(String(res))) {
            noteGunBought(state, gun, cost, "radio");
            state.govGuns.radioDay = day(state);
            text = `radio deal with ${f.name}: a ${gun.name} for ${base.name}`;
          }
        }
      }
    }
    if (state.trade) endTrade(state);
    if (text) return text;
  }
  return "";
}
