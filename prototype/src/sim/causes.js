// "Why did this happen?" (suggestions-4 #4): a short chain of causes for every death and every base you lose, put
// together at the moment it happens from the state and the recent diary (diary.js), so a loss reads as a lesson.
// Pure simulation, no DOM, no random numbers (recording never changes how a run plays out).
//
// A chain (why) = { k: the kind of cause (CAUSE_KINDS), h: the headline, f: [factor, ...] (at most MAX_FACTORS) }
//   factor = { t: plain text, d: the day it points at (optional: the Why panel links it to that diary day) }
// Names and places in the text are linked by the UI (diary.js findRefs), so the chain stores no ids or objects.
//
// Where it is kept (the save carries it as it is; a few hundred bytes a death):
//   - a death: on its memorial entry (relations.js onDeath), entry.why. world.js killSurvivor calls noteDeath.
//   - a lost base: state.losses = [{ id, name, tile, day, how, f (group id), why }], newest first, at most MAX_LOSSES.
//     world.js removeBase and conquest.js occupyPlayerBase / razePlayerBase call noteBaseLoss.
//   - base.lows = { water, food, scrap, meds, ammo, heat }: the day each stock ran out (causesDaily), so a chain can
//     say "no scrap since day 38". A key is dropped when the stock comes back.
// An older save's deaths have no chain: deathCause pieces one together from the memorial entry and the diary.
//
// For other modules (the run summary's "deaths by cause"): deathCause(state, survivorOrEntryOrId), deathsByCause(state),
// lossesOf(state), causeKind(state, causeText).
import { foodIn } from "./foods.js"; // days of food
import { day, baseById, factionById, atBase, residents, alive } from "./world.js";
import { diaryEntries } from "./diary.js";
import { fixtures, fixtureName, jobFor, fxDef, isBroken, isWaterFixture } from "./breakdowns.js";
import { count, pieceKind } from "./buildings.js";
import { CONDITIONS, conditionsOf } from "./health.js";
import { weatherOnDay } from "./weather.js";
import { attitude } from "./factions.js";
import { foodOutlook } from "./economy.js";
import { totalRounds } from "./rounds.js"; // rounds by calibre ("ammo": every round there)

export const MAX_FACTORS = 4;
export const MAX_LOSSES = 30;
export const LOOK_BACK = 10; // days of diary a chain reads back

// The kinds of death, in the order the run summary lists them.
export const CAUSE_KINDS = {
  thirst: "Thirst", hunger: "Hunger", cold: "Cold", illness: "Illness", wound: "Infected wounds", worm: "The worm",
  horde: "The dead", raid: "Raiders and other groups", fight: "Fights on the road", scavenge: "Scavenging",
  accident: "Accidents and weather", own: "Their own people", lost: "Lost far from home", other: "Other",
};

// ---------- the kind of a death, from the cause as the log wrote it ("of thirst at Millbrook") ----------
const ILLNESS_RX = () => new RegExp(`^of (${Object.values(CONDITIONS).map((c) => c.name.toLowerCase()).join("|")})\\b`);
const named = (list, text) => list.some((x) => x && x.name && text.includes(x.name));
export function causeKind(state, cause) {
  const c = String(cause || "").trim();
  if (/worm|body got up|got up again/.test(c)) return "worm";
  if (/\bof thirst\b/.test(c)) return "thirst";
  if (/\bof (hunger|starvation)\b/.test(c)) return "hunger";
  if (/\bof cold\b/.test(c)) return "cold";
  if (/infected wound/.test(c)) return "wound";
  if (ILLNESS_RX().test(c)) return "illness";
  if (/by their own hand|walking out into the dead|their own (people|team)|^attacked by|fistfight|^in a fight$/.test(c)) return "own";
  // "at the hands of X" / "in a fight with X at Y": one of your own (a mental break, a quarrel) or a group.
  if (/^(at the hands of|in a fight with) /.test(c) && named(state.survivors || [], c) && !named(state.factions || [], c)) return "own";
  if (/horde|the dead overran|dead surge|\bhive\b/.test(c)) return "horde";
  if (/^defending |was overrun|came for their people|shot at the gates|hit the convoy|^at the hands of /.test(c)) return "raid";
  if (/in a fight|left behind|carried out|running for it|running from/.test(c)) return "fight";
  if (/scaveng|raiding |extracting|bitten|fire escape|ambulance/.test(c)) return "scavenge";
  if (/blizzard|storm|drowned|\bfire\b|accident/.test(c)) return "accident";
  if (/errand|never came back|walking home alone|trying to get home/.test(c)) return "lost";
  return "other";
}

// ---------- small helpers ----------
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const first = (name) => String(name || "").split(/\s+/)[0];
const dayOf = (hour) => Math.floor(hour / 24) + 1;
const F = (t, d = null) => (d != null && d >= 1 ? { t, d } : { t });
const strip = (t) => String(t).replace(/^[^\w"(]+/u, "").trim(); // a leading "⚠ " or "☀️ "
function clip(t, n = 150) {
  t = strip(t);
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const stop = cut.lastIndexOf(". ");
  return stop > n * 0.5 ? cut.slice(0, stop + 1) : `${cut.replace(/\s+\S*$/, "")}…`;
}
const hasRef = (e, type, id) => id != null && (e.refs || "").split(",").some((r) => r.startsWith(`${type}${id}@`));

// Diary lines from day `to` back to day `from`, newest first, that pass test(e, dayNo) (e from diary.js decodeEntry).
// Lines of the autopilot's own notes (🤖) are left out.
function diaryLines(state, from, to, test, max = 2) {
  const out = [];
  for (let d = to; d >= Math.max(1, from) && out.length < max; d--) {
    const list = diaryEntries(state, d);
    for (let i = list.length - 1; i >= 0 && out.length < max; i--) {
      const e = list[i];
      if (e.robot || !test(e, d)) continue;
      out.push({ text: e.text, d, e });
    }
  }
  return out;
}
const quote = (x) => F(`Day ${x.d}: ${clip(x.text)}`, x.d);

// The weather over the last few days: the first day of the run of `keys` that ends today (or null).
function weatherRun(state, today, keys, back = 6) {
  let start = null;
  for (let d = today; d >= Math.max(1, today - back); d--) {
    const w = weatherOnDay(state, d);
    if (!keys.includes(w.key)) break;
    start = { d, name: w.name };
  }
  return start;
}

// ---------- what a base was like ----------
const STOCK_WORD = { water: "water", food: "food", scrap: "scrap", meds: "meds", ammo: "ammo", heat: "firewood or fuel" };
const stockOf = (base, k) => {
  const st = base.stock || {};
  if (k === "water") return (st.water || 0) + (st.rawwater || 0);
  if (k === "food") return foodIn(st); // days of food (foods.js)
  if (k === "heat") return (st.wood || 0) + (st.fuel || 0);
  if (k === "ammo") return totalRounds(st); // every round, any calibre (rounds.js)
  return st[k] || 0;
};
const lowSince = (base, k) => (base && base.lows && base.lows[k] != null ? base.lows[k] : null);
function lowFactor(base, k, today) {
  const d = lowSince(base, k);
  if (d == null || d >= today) return null;
  return F(`${base.name} had no ${STOCK_WORD[k]} in store since day ${d}.`, d);
}

// Broken fixtures (breakdowns.js) that pass test, with what kept them broken.
function brokenFactors(state, base, test, today) {
  const out = [];
  for (const fx of fixtures(base)) {
    if (!isBroken(fx) || !test(fx)) continue;
    const name = fixtureName(fx).toLowerCase();
    const job = jobFor(base, fx);
    const cost = (fxDef(fx) && fxDef(fx).repair && fxDef(fx).repair.cost) || {};
    const scrap = Math.floor(base.stock.scrap || 0);
    const since = lowSince(base, "scrap");
    let why;
    if (job) why = "the repair was still under way";
    else if ((cost.scrap || 0) > scrap) why = `not repaired: it needs ${cost.scrap} scrap and there was ${scrap}${since != null && since < today ? ` (none since day ${since})` : ""}`;
    else why = "nobody was set to repair it";
    out.push(F(`The ${name} at ${base.name} broke on day ${fx.broken.day} (${fx.broken.cause}); ${why}.`, fx.broken.day));
  }
  return out;
}

// The walls: their state (100% = no wear), or that there were none.
function wallsFactor(base) {
  const ws = fixtures(base).filter((fx) => fx.type === "walls" || fx.type === "gate" || pieceKind(fx.type) === "wall" || pieceKind(fx.type) === "gate");
  if (!ws.length) return F(`${base.name} had no walls built.`);
  const pct = Math.round(100 - ws.reduce((a, fx) => a + Math.min(100, fx.wear || 0), 0) / ws.length);
  const broken = ws.filter(isBroken).length;
  return F(`The walls were at ${pct}%${broken ? ` (${plural(broken, "section")} broken)` : ""}.`);
}

// Who was there to fight: people at the base, those living there who were out on a trip, guards, ammo.
// dying: the person who just died there (no longer counted alive).
function defendersFactors(state, base, dying = null) {
  const out = [];
  const here = atBase(state, base.id);
  if (dying && !here.includes(dying)) here.push(dying);
  const away = alive(state).filter((x) => x.location && x.location.kind === "party" && (state.parties.find((p) => p.id === x.location.partyId) || {}).homeBaseId === base.id);
  const n = here.length + away.length;
  const guards = here.filter((x) => x.role === "guard").length;
  const onGuard = guards ? `${plural(guards, "person was", "people were")} on guard duty` : "nobody was on guard duty";
  if (!here.length) return [F(`Nobody was at ${base.name}${away.length ? `: its ${plural(away.length, "person was", "people were")} away on a trip` : ""}.`)];
  out.push(F(away.length ? `${away.length} of the ${n} people living at ${base.name} ${away.length === 1 ? "was" : "were"} away on a trip; ${onGuard}.`
    : `${onGuard[0].toUpperCase()}${onGuard.slice(1)} (${plural(here.length, "person", "people")} there).`));
  const ammo = totalRounds(base.stock);
  if (ammo < here.length * 3) out.push(F(`Ammo was short: ${ammo} left for ${plural(here.length, "defender")}.`));
  return out;
}

// A group: when it turned hostile (the diary's "is now hostile toward you (reason)") and its earlier raids.
function factionFactors(state, f, today, baseName = null) {
  if (!f) return [];
  const out = [];
  const turned = diaryLines(state, today - 120, today, (e) => e.text.startsWith(`${f.name} is now hostile`), 1)[0];
  if (turned) {
    const m = /\(([^)]*)\)\.?$/.exec(turned.text);
    out.push(F(`${f.name} turned hostile on day ${turned.d}${m ? ` (${m[1]})` : ""}.`, turned.d));
  } else out.push(F(`${f.name} were ${attitude(f).toLowerCase()} toward you.`));
  const before = diaryLines(state, today - 30, today - 1, (e) => e.text.includes(f.name) && /drove off|broke into|overran|took the tribute/.test(e.text) && (!baseName || e.text.includes(baseName)), 1)[0];
  if (before) out.push(quote(before));
  return out;
}

// Today's line about the base (the horde at the walls, the raid), written before the death or the loss.
function eventToday(state, base, today, rx = /horde|overran|broke into|broke through|drove off|raid|came for|the dead/) {
  return diaryLines(state, today, today, (e) => e.text.includes(base.name) && rx.test(e.text) && !/\bdied\b/.test(e.text), 1)[0] || null;
}
const factionIn = (state, line) => {
  if (!line) return null;
  const r = (line.e.refs || "").split(",").find((x) => x.startsWith("f"));
  const m = r && /^f(\d+)@/.exec(r);
  return m ? factionById(state, Number(m[1])) : (state.factions || []).find((f) => f.name && line.text.includes(f.name)) || null;
};

// ---------- the fight going on ----------
// A fight by the numbers notes its odds here as it is settled (combat.js autoResolveCombat); a battle on the map is
// state.combat. Kept outside the state (never saved): only a death in the same hour, of that team or base, reads it.
// ammoOk: true, false (short of ammo: everyone at 60%), or, with bows on the team, the line naming what was short.
const fights = new WeakMap();
export function noteFight(state, setup, odds, people, ammoOk = true) {
  if (!state || !setup || !setup.enemy) return;
  fights.set(state, {
    hour: state.hour, partyId: setup.partyId ?? null, baseId: setup.baseId ?? null, enemy: String(setup.enemy.name || setup.enemy.kind || "enemies"),
    count: setup.enemy.count || 0, fortified: !!setup.enemy.fortified, ambush: setup.ambush || null, people, win: odds ? odds.win : null, ammoOk,
  });
}
function fightFactors(state, p, base) {
  const mine = (x) => (p && x.partyId === p.id) || (base && x.baseId === base.id);
  const f = fights.get(state);
  const out = [];
  if (f && f.hour === state.hour && mine(f)) {
    const odds = f.win != null ? `: about ${Math.round(f.win * 100)}% odds to win` : "";
    out.push(F(`${f.people} of yours against ${f.count} ${f.enemy.replace(/^the /i, "")}${f.fortified ? " behind their walls" : ""}${odds}.`));
    if (f.ambush === "enemy") out.push(F("They struck first (an ambush)."));
    if (!f.ammoOk) out.push(F("Ammo was short: everyone fought at 60%."));
    else if (typeof f.ammoOk === "string") out.push(F(f.ammoOk)); // with bows: the ammo, the arrows or both (combat.js)
  } else if (state.combat && state.combat.setup && mine(state.combat.setup)) {
    const e = state.combat.setup.enemy || {};
    out.push(F(`A battle on the map against ${e.count || "?"} ${String(e.name || e.kind || "enemies").replace(/^the /i, "")}.`));
  }
  return out;
}

// ---------- explainers, one per kind of death ----------
// ctx = { s, base, p, today, cause }. Each returns factors, most telling first.
const EXPLAIN = {
  thirst(state, { base, p, today }) {
    if (p) return teamSupplyFactors(state, p, today, "water");
    if (!base) return [];
    const out = [];
    const n = base.thirstDays || 0;
    if (n > 1) out.push(F(`${base.name} had been out of water for ${n} days (since day ${today - n + 1}).`, today - n + 1));
    else out.push(lowFactor(base, "water", today));
    out.push(...brokenFactors(state, base, (fx) => isWaterFixture(fx) || fx.type === "rain_catcher" || fx.type === "cistern", today));
    if (base.type !== "hub" && !count(base, "well") && !count(base, "rain_catcher")) out.push(F(`No well or rain catcher was built at ${base.name}.`));
    const dry = weatherRun(state, today, ["heat", "drought"]);
    if (dry) out.push(F(`${dry.name} since day ${dry.d}: everyone drank more and the wells gave less.`, dry.d));
    out.push(...diaryLines(state, today - LOOK_BACK, today, (e) => e.text.includes(base.name) && /water|\bwell\b|drought|rain catcher|filter|cistern/i.test(e.text) && !/is out of water|\bdied\b|broke \(/.test(e.text)).map(quote));
    return out;
  },
  hunger(state, { base, p, today }) {
    if (p) return teamSupplyFactors(state, p, today, "food");
    if (!base) return [];
    const out = [];
    const n = base.hungerDays || 0;
    if (n > 1) out.push(F(`${base.name} had been out of food for ${n} days (since day ${today - n + 1}).`, today - n + 1));
    else out.push(lowFactor(base, "food", today));
    try {
      const o = foodOutlook(state, base);
      out.push(F(`About ${Math.round((o.farm + o.scav) * 10) / 10} food a day came in at ${base.name} against ${Math.round(o.eat * 10) / 10} eaten.`));
    } catch { /* a base mid-change: skip the numbers */ }
    const cold = weatherRun(state, today, ["snow", "blizzard", "frost"]);
    if (cold) out.push(F(`${cold.name} since day ${cold.d}: nothing grew and everyone ate more.`, cold.d));
    out.push(...diaryLines(state, today - LOOK_BACK, today, (e) => e.text.includes(base.name) && /crop|frost|spoil|ration|stolen|took|drought|blight|lost/i.test(e.text) && !/is out of food|harvested|\bdied\b/.test(e.text)).map(quote));
    return out;
  },
  cold(state, { base, today }) {
    if (!base) return [];
    const out = [];
    const low = lowFactor(base, "heat", today);
    if (low) out.push(low);
    else out.push(F(`${base.name} had ${Math.floor(stockOf(base, "heat"))} firewood and fuel left.`));
    const cold = weatherRun(state, today, ["snow", "blizzard", "frost"]);
    if (cold) out.push(F(`${cold.name} since day ${cold.d}.`, cold.d));
    out.push(...diaryLines(state, today - LOOK_BACK, today, (e) => e.text.includes(base.name) && /firewood|fuel|cut wood|woodcutter|cold/i.test(e.text) && !/\bdied\b|to keep warm/.test(e.text)).map(quote));
    return out;
  },
  illness(state, { s, base, p, today, cause }) {
    const out = [];
    const name = (/^of (.+?)(?: at |$)/.exec(cause) || [])[1] || "";
    const c = conditionsOf(s).find((x) => CONDITIONS[x.key] && CONDITIONS[x.key].name.toLowerCase() === name) || null;
    if (c) {
      out.push(F(`${first(s.name)} came down with ${name} on day ${c.since}${c.why ? ` ${c.why}` : ""}.`, c.since));
      if (!(c.dosed > 0)) out.push(F(`It was never treated${base ? medsText(base, today) : p ? ` (the team had ${Math.floor((p.supplies && p.supplies.meds) || 0)} meds)` : ""}.`));
      else if (c.course && c.dosed < c.course) out.push(F(`Only ${c.dosed} of ${c.course} doses were given.`));
    }
    if (base && !residents(state, base.id).some((x) => x.role === "medic") && s.role !== "medic") out.push(F(`Nobody was on the Medic role at ${base.name}.`));
    out.push(...weakFactors(s));
    return out;
  },
  wound(state, { s, base, today }) {
    const out = [];
    const hurtLine = diaryLines(state, today - 20, today, (e) => hasRef(e, "s", s.id) && /got a deep cut|wound|hurt|bitten|infect/i.test(e.text) && !/\bdied\b/.test(e.text), 1)[0];
    if (hurtLine) out.push(quote(hurtLine));
    if (base) {
      if ((base.stock.meds || 0) < 1) out.push(F(`There were no meds at ${base.name}${lowSince(base, "meds") != null && lowSince(base, "meds") < today ? ` since day ${lowSince(base, "meds")}` : ""}.`, lowSince(base, "meds")));
      if (!residents(state, base.id).some((x) => x.role === "medic")) out.push(F(`Nobody was on the Medic role at ${base.name}.`));
    } else out.push(F("Away from a base an infected wound only gets worse."));
    out.push(...weakFactors(s));
    return out;
  },
  worm(state, { s, base, today, cause }) {
    const out = [];
    const w = s.worm;
    if (w) {
      out.push(F(`${first(s.name)} caught the worm on day ${w.since}${w.why ? ` ${w.why}` : ""}.`, w.since));
      if (w.seen == null) out.push(F("Nobody spotted it in time (a medic at the base spots it sooner)."));
      else if (!(w.treatedDay > 0)) out.push(F(`It was spotted on day ${w.seen} but never treated${base ? medsText(base, today) : ""}.`, w.seen));
      else out.push(F(`It was spotted on day ${w.seen} and last treated on day ${w.treatedDay}.`, w.treatedDay));
    } else if (/turned|got up|putting .* down/.test(cause)) {
      out.push(F("Someone with the worm turned, or a body with it got up, next to them."));
    }
    out.push(...diaryLines(state, today - LOOK_BACK, today, (e) => (hasRef(e, "s", s.id) || (base && e.text.includes(base.name))) && /worm|un-purified|raw meat|boil/i.test(e.text) && !/\bdied\b/.test(e.text), 1).map(quote));
    return out;
  },
  horde(state, { s, base, p, today }) {
    if (!base) return teamFightFactors(state, p, s, today);
    const out = [];
    const ev = eventToday(state, base, today, /horde|the dead|overran|broke through/);
    if (ev) out.push(quote(ev));
    out.push(...fightFactors(state, null, base));
    const seen = diaryLines(state, today - 5, today - 1, (e) => e.text.includes(base.name) && /horde/i.test(e.text), 1)[0];
    if (seen) out.push(quote(seen));
    out.push(wallsFactor(base), ...defendersFactors(state, base, s));
    return out;
  },
  raid(state, { s, base, p, today }) {
    if (!base) return teamFightFactors(state, p, s, today);
    const out = [];
    const ev = eventToday(state, base, today);
    if (ev) out.push(quote(ev));
    out.push(...fightFactors(state, null, base));
    const ff = factionFactors(state, factionIn(state, ev), today, base.name);
    out.push(wallsFactor(base), ...ff.slice(0, 1), ...defendersFactors(state, base, s));
    if (!base.alert) out.push(F("The base was not on alert (Prepare defenses on the warning card)."));
    out.push(...ff.slice(1));
    return out;
  },
  fight(state, { s, p, today }) { return teamFightFactors(state, p, s, today); },
  scavenge(state, { s, p, today }) { return teamFightFactors(state, p, s, today); },
  accident(state, { s, p, today }) {
    const out = [];
    const bad = weatherRun(state, today, ["storm", "blizzard"], 2);
    if (bad && p) out.push(F(`The team was out on the road in a ${bad.name.toLowerCase()}.`, bad.d));
    if (p) out.push(...teamFightFactors(state, p, s, today));
    return out;
  },
  own(state, { s, today }) {
    const out = [];
    if (s.mood != null && s.mood < 25) out.push(F(`${first(s.name)}'s mood was ${Math.round(s.mood)} out of 100.`));
    out.push(...diaryLines(state, today - LOOK_BACK, today, (e) => hasRef(e, "s", s.id) && /snapped|break|quarrel|fight|mood|grief|griev|rival|cannot stand|walked/i.test(e.text) && !/\bdied\b/.test(e.text)).map(quote));
    return out;
  },
  lost(state, { s, today }) {
    return diaryLines(state, today - 20, today, (e) => hasRef(e, "s", s.id) && /errand|left|alone|captive|prisoner/i.test(e.text) && !/\bdied\b/.test(e.text)).map(quote);
  },
  other() { return []; },
};

function medsText(base, today) {
  const meds = Math.floor(base.stock.meds || 0);
  const since = lowSince(base, "meds");
  if (meds >= 1) return "";
  return ` (no meds at ${base.name}${since != null && since < today ? ` since day ${since}` : ""})`;
}
function weakFactors(s) {
  const bits = [];
  if (s.hunger != null && s.hunger < 25) bits.push("hungry");
  if (s.thirst != null && s.thirst < 25) bits.push("thirsty");
  return bits.length ? [F(`${first(s.name)} was also ${bits.join(" and ")}, which made it worse.`)] : [];
}

// A team on the road: its trip, its supplies and what happened to it (lines naming the team or the dead).
function teamTrip(state, p, today) {
  if (!p || p.departed == null) return null;
  const left = dayOf(p.departed);
  const out = Math.max(0, (state.hour - p.departed) / 24);
  const plan = p.plannedHours ? p.plannedHours / 24 : null;
  const over = plan != null && p.etaBack != null ? out - plan : 0;
  const days = (x) => `${Math.round(x * 10) / 10} day${Math.round(x * 10) / 10 === 1 ? "" : "s"}`;
  return F(`The team left on day ${left}${plan ? ` for a trip of about ${days(plan)}` : ""}${over >= 0.5 ? `; it was ${days(over)} overdue` : ""}.`, left);
}
// Lines naming the team or one of its people (not its setting out: teamTrip says that).
function teamLines(state, p, s, today, rx, max = 2) {
  const ids = [s.id, ...((p && p.members) || [])];
  const about = (e) => hasRef(e, "p", p && p.id) || ids.some((id) => hasRef(e, "s", id));
  const from = p && p.departed != null ? Math.max(today - LOOK_BACK, dayOf(p.departed)) : today - LOOK_BACK; // this trip only
  return diaryLines(state, from, today, (e) => about(e) && rx.test(e.text) && !/\bdied\b|\bleft for\b|Arrives in|is home/.test(e.text), max).map(quote);
}
function teamSupplyFactors(state, p, today, what) {
  const out = [];
  const trip = teamTrip(state, p, today);
  if (trip) out.push(trip);
  const members = (p.members || []).length;
  out.push(F(`The team had run out of ${what}${members > 1 ? ` (${members} people on it)` : ""}.`));
  const dry = what === "water" && weatherRun(state, today, ["heat", "drought"]);
  if (dry) out.push(F(`${dry.name} since day ${dry.d}: everyone drank more.`, dry.d));
  out.push(...teamLines(state, p, { id: -1 }, today, /\b(hordes?|stranded|broke down|out of fuel|ambush(ed)?|cancel(led)?|halted|cut off|lost|storm|blizzard|river|turned back|no water|no food|short of)\b/i));
  return out;
}
function teamFightFactors(state, p, s, today) {
  const out = [...fightFactors(state, p, null)];
  if (p) {
    const n = (p.members || []).length;
    const weak = conditionsOf(s).filter((c) => CONDITIONS[c.key] && !CONDITIONS[c.key].mild).map((c) => CONDITIONS[c.key].name.toLowerCase());
    if (weak.length) out.push(F(`${first(s.name)} was already hurt or sick (${weak.join(", ")}).`));
    if (n && n <= 2) out.push(F(`The team was small: ${plural(n, "person", "people")}.`));
    const trip = teamTrip(state, p, today);
    if (trip) out.push(trip);
  }
  out.push(...teamLines(state, p, s, today, /\b(fight|ambush(ed)?|hordes?|raiders?|bitten|hurt|wounded|retreat(ed)?|ran for it|shot|left behind|overrun|the Alert)\b/i));
  return out;
}

// ---------- recording ----------
function where(state, s, tileId) {
  const L = s.location || {};
  const p = L.kind === "party" ? state.parties.find((q) => q.id === L.partyId) || null : null;
  const base = L.kind === "base" ? baseById(state, L.baseId) : tileId != null && !p ? state.bases.find((b) => b.tile === tileId) || null : null;
  return { base, p };
}
// Personal background any death can use: an illness or wound they already had, a recent line about them.
function personFactors(state, s, today, kind) {
  const out = [];
  if (kind !== "illness" && kind !== "wound" && kind !== "fight" && kind !== "scavenge") {
    const ill = conditionsOf(s).filter((c) => CONDITIONS[c.key] && !CONDITIONS[c.key].mild);
    if (ill.length) out.push(F(`${first(s.name)} was already weak: ${ill.map((c) => `${CONDITIONS[c.key].name.toLowerCase()} since day ${c.since}`).join(", ")}.`, ill[0].since));
  }
  return out;
}
function finish(kind, head, factors) {
  const seen = new Set();
  const f = [];
  for (const x of factors) {
    if (!x || !x.t || seen.has(x.t)) continue;
    seen.add(x.t);
    f.push(x);
    if (f.length >= MAX_FACTORS) break;
  }
  return { k: kind, h: head, f };
}

// The chain for a death, at the moment it happens. Never throws (a death must always go through).
export function explainDeath(state, s, tileId, cause) {
  const today = day(state);
  const kind = causeKind(state, cause);
  const head = `${s.name} died ${String(cause || "").trim()} on day ${today}.`;
  try {
    const { base, p } = where(state, s, tileId);
    const ctx = { s, base, p, today, cause: String(cause || "") };
    const f = [...(EXPLAIN[kind] || EXPLAIN.other)(state, ctx), ...personFactors(state, s, today, kind)];
    return finish(kind, head, f);
  } catch {
    return { k: kind, h: head, f: [] };
  }
}
// world.js killSurvivor, after onDeath: the chain goes on the memorial entry.
export function noteDeath(state, s, tileId, cause, entry) {
  if (!entry) return;
  entry.why = explainDeath(state, s, tileId, cause);
}

// ---------- lost bases ----------
// how: "taken" (a group keeps it), "retreat" (abandoned before their raid; they moved in), "razed", "dead" (overrun
// by a horde), "lost" (overrun by raiders or outsiders and left). Called before the people leave and the base goes.
const LOSS_HEAD = {
  taken: (b, f, d) => `${f ? f.name : "Raiders"} took ${b.name} on day ${d}.`,
  retreat: (b, f, d) => `${b.name} was abandoned before the raid; ${f ? f.name : "the raiders"} moved in on day ${d}.`,
  razed: (b, f, d) => `${f ? f.name : "Raiders"} burned ${b.name} to the ground on day ${d}.`,
  dead: (b, f, d) => `The dead overran ${b.name} on day ${d}.`,
  lost: (b, f, d) => `${b.name} was lost on day ${d}${f ? ` to ${f.name}` : ""}.`,
};
export function lossHow(cause) {
  return /dead/.test(cause || "") ? "dead" : "lost";
}
export function noteBaseLoss(state, base, how = "lost", f = null) {
  if (!state || !base) return null;
  const today = day(state);
  let why;
  try {
    const ev = eventToday(state, base, today);
    if (!f && how !== "dead") f = factionIn(state, ev);
    const out = [];
    if (how === "retreat") out.push(F(`Everyone was pulled out (Retreat on the raid warning card).`));
    if (ev && how !== "retreat") out.push(quote(ev));
    if (how !== "retreat") out.push(wallsFactor(base), ...defendersFactors(state, base));
    out.push(...brokenFactors(state, base, (fx) => fx.type === "walls" || fx.type === "gate" || pieceKind(fx.type) === "wall" || pieceKind(fx.type) === "gate", today));
    if (f) out.push(...factionFactors(state, f, today, base.name));
    const earlier = diaryLines(state, today - 20, today - 1, (e) => e.text.includes(base.name) && /horde|overran|broke into|broke through|drove off|raid/.test(e.text), 1)[0];
    if (earlier) out.push(quote(earlier));
    why = finish(how, (LOSS_HEAD[how] || LOSS_HEAD.lost)(base, f, today), out);
  } catch {
    why = { k: how, h: (LOSS_HEAD[how] || LOSS_HEAD.lost)(base, f, today), f: [] };
  }
  const rec = { id: base.id, name: base.name, tile: base.tile, day: today, how, why };
  if (f) rec.f = f.id;
  const L = state.losses || (state.losses = []);
  L.unshift(rec);
  if (L.length > MAX_LOSSES) L.length = MAX_LOSSES;
  return rec;
}
export const lossesOf = (state) => (state && state.losses) || [];

// ---------- daily: when each stock ran out ----------
export function causesDaily(state) {
  const today = day(state);
  for (const b of state.bases) {
    if (b.owner != null && b.owner !== "player") continue;
    const lows = b.lows || {};
    for (const k of Object.keys(STOCK_WORD)) {
      if (stockOf(b, k) < 1) { if (lows[k] == null) lows[k] = today; } else delete lows[k];
    }
    if (Object.keys(lows).length) b.lows = lows;
    else delete b.lows;
  }
}

// ---------- reading ----------
const memorial = (state) => (state && state.memorial) || [];
// x: a survivor, a memorial entry or a survivor id. Returns { name, day, kind, label, head, factors, recorded } or null.
// recorded false: an older save's death, its chain pieced together from the memorial entry and the diary.
export function deathCause(state, x) {
  if (x == null) return null;
  const id = typeof x === "number" ? x : x.id;
  const m = x.died != null && x.cause != null && x.record ? x : memorial(state).find((e) => e.id === id);
  if (!m) return null;
  const why = m.why || pieceTogether(state, m);
  return { name: m.name, day: m.died, place: m.place, kind: why.k, label: CAUSE_KINDS[why.k] || CAUSE_KINDS.other, head: why.h, factors: why.f, recorded: !!m.why };
}
export function deathsByCause(state) {
  const out = {};
  for (const m of memorial(state)) {
    const k = m.why ? m.why.k : causeKind(state, m.cause);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}
// An older death: the kind from its cause, and the diary's lines about them (or the place) in the days before.
function pieceTogether(state, m) {
  const kind = causeKind(state, m.cause);
  const head = `${m.name} died ${m.cause || ""} on day ${m.died}.`.replace(/\s+on day/, " on day");
  const f = [];
  try {
    const lines = diaryLines(state, m.died - 7, m.died, (e, d) => (hasRef(e, "s", m.id) || (m.place && e.text.includes(m.place) && e.kind !== "info")) && !/\bdied\b/.test(e.text) && (d < m.died || e.kind !== "death"), 3);
    f.push(...lines.map(quote));
  } catch { /* no diary */ }
  return finish(kind, head, f);
}
