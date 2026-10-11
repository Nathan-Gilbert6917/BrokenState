// Volunteers: people lent between groups for a job or a span of days, both ways (AI parity).
//
// You ask an allied group (the radio panel, the Groups tab, a team's panel, the trip planner) for 1–4 volunteers to
// join one of your teams for a span of days (askVolunteers). The group decides by points (askQuote: no dice, so the
// dialog shows the answer before you ask): goodwill, a pact or the coalition, jobs you did for it, the danger of the
// team's mission (a hive crawl or an assault is a big ask), how many and for how long, its own trouble (at war, a
// horde near its base, short-handed), what you offer (goods from your hub, or a favour owed) and the volunteers it
// lost with you lately. Points >= 0: yes. A yes with nothing offered costs a little goodwill (a favour asked).
// Volunteers are real people (state.vols.people: survivors kept apart from yours, so no base, roster, leader or
// census counts them; world.js survivorById finds them): their own skills by the group's type, armed and armoured
// from the group's arsenal (arsenal.js issueKit: the pieces leave it while they are away and go back with them),
// bringing a day's food and water a day (up to BRING.days) and rounds for their guns into the team's supplies. They
// walk from the group's nearest base to the team (TRAVEL hours a tile) and join it wherever it is (not in a fight).
// With the team they count for its carry, eat its food, fight in its fights by the numbers and on the battle map,
// where their group's AI moves them (combat.js: u.vol, never your orders; they act at the end of your turn, follow
// the Evac and the retreat, leave with your people). They go home when the span runs out (not in the middle of a
// fight or a hive crawl), when the team comes home, settles, is disbanded or has none of your people left, when the
// group's goodwill falls below GW_LEAVE or it turns hostile. Their group's people are away meanwhile (f.pop).
// Deaths: one who falls in a fight costs DEATH.fight goodwill (they knew the risk; the group mourns), any other death
// (hunger, thirst, the worm, an accident) DEATH.other; the group remembers its dead (f.volFallen: fewer points for a
// while). Home safe after fighting beside you: BACK goodwill each. They keep what they carry.
// Hive crawls (hivecrawl.js) and assaults: volunteers in the team are real fighters there; alliance.js hiveAllies /
// assaultAllies leave out a group that sent volunteers to that team (no double count).
//
// AI groups ask too (aiAsksDaily): a group at war, with a horde near its base or a hive war coming asks you over the
// radio for 1–3 people for 3–7 days (a card: send 1..n of the fittest at the hub, choose who, or decline: DECLINE
// goodwill, ×3 when you owe them a favour). Your people lent are away (location "lent": "with X" on the roster), out of
// your orders; their power adds to the group's strength (f.volAid: factions.js strength and its hive war party); each
// day of the span their fight may come (AI.fight by the need) and each of them may be hurt or killed (coarse, by the
// numbers, as that group's fights are). Home at the end with a share of the group's stores for each fight, goodwill,
// or not at all. AI groups lend each other fighters the same way, coarse and cheap (aiLendDaily: a friend sends 1–3,
// the lender's people away, their power on the asker's strength, a few lost, relations up).
// The governor (autopilot) asks allies when a hive crawl or a base assault looks marginal (autoAskVolunteers, by its
// style's STYLES row) and answers the groups' asks by its style (the card's ai scores: Diplomat generous, Turtle stingy).
// Dice: state.volRng (its own, saved), never the world's.
import { giveFood, foodIn, DAY_VALUE, moveFoodUnits } from "./foods.js"; // food by type (foods.js)
import { keyWord } from "./water.js"; // supplies as words: "9mm FMJ", "rounds"
import { Rng } from "./rng.js";
import { log, addCard, day, hub, atBase, factionById, combatPower, hurt, makeSurvivor, baseById, skill } from "./world.js";
import { partyMembers, partyTile, wipeIfEmpty, weighTeam, tileLabel, MISSIONS } from "./parties.js";
import { attitude, changeGoodwill } from "./factions.js";
import { warsOf, enemyIn, relation, changeRelation } from "./diplomacy.js";
import { jobsDoneFor } from "./jobs.js";
import { isMember, reachVia } from "./alliance.js";
import { issueKit, removeFromArsenal, addToArsenal, takeArsenalRounds, unitPower, arsenalWorthy, kitOf } from "./arsenal.js";
import { allItems, newItem, stripAll } from "./inventory.js";
import { SUPPLIES, GEAR, supValue } from "./data.js";
import { blocOf } from "./blocs.js";
import { hiveAt } from "./hives.js";
import { hiveTier } from "./hivetech.js";
import { crawlEstimate } from "./hivecrawl.js";
import { assaultForce, teamAssaultOdds } from "./conquest.js";
import { battlePending, startCombat, registerCombatHandler } from "./combat.js";
import { calOf, payAmmoKeys, payWord, roundsText } from "./ammo.js"; // an offer in rounds: by calibre, the ones the guns need least
import { lightOf } from "./lights.js";
import { baseKey, supplyAmt } from "./rounds.js";


export const VOL = {
  MAX: 4, TEAM_MAX: 6,                       // per request; volunteers with one team at a time
  SPAN: { min: 2, max: 30, def: 7 },         // days
  GW_MIN: 30, GW_LEAVE: 20, HOME_MIN: 8,     // goodwill to be asked at all, below which they are called home; people a group keeps at home
  TRAVEL: 1.2, TRAVEL_MIN: 2, TRAVEL_MAX: 72, // hours a tile from their nearest base to the team
  BRING: { days: 8, ammo: 30 },              // a day's food and water each for up to `days` of the span; rounds a gun
  QUALITY: { military: 1.15, fortress: 1.1, raider: 1, expansionist: 1, zealot: 1, traders: 0.95, commune: 0.9 },
  SHOOT: { military: 4, fortress: 3, raider: 2, expansionist: 2, zealot: 1, traders: 1, commune: 0 },
  MELEE: { military: 2, fortress: 2, raider: 3, expansionist: 1, zealot: 4, traders: 0, commune: 1 }, // the Melee skill by the group's ways (zealots fight with spears)
  // The points of a request (askQuote); >= 0 is a yes.
  P: { gwDiv: 10, member: 2, trade: 1, nonaggression: 0.5, job: 0.5, jobMax: 1.5, head: 0.75, longFrom: 7, perDay: 0.1,
    war: 1.5, horde: 2, hordeSize: 30, hordeRange: 6, short: 1.5, shortPop: 14, favour: 1.5, goodsPer: 40, fallen: 1, fallenBad: 2, fallenDays: 60 },
  DANGER: { escort: 0, recon: 0, move: 0, trade: 0, scavenge: 0.5, sweep: 0.25, cull: 1, growth: 1, rescue: 1.5, assault: 2, hive: 2, hiveTier: 0.5 },
  ASK_GW: 2,                                  // goodwill a yes costs when nothing is offered
  REFUSED_WAIT: 3,                            // days before the same group hears you again after a no
  DEATH: { fight: -3, other: -10 }, BACK: 1,  // goodwill: a volunteer killed in a fight / any other way; home safe after a fight
  OFFER_KEYS: ["food", "water", "meds", "ammo", "fuel", "scrap"],
  // The groups' asks of you.
  AI: { chance: 0.05, favourChance: 0.15, gap: 25, favourGap: 10, gw: 25, n: [1, 3], days: [3, 7], expire: 48, decline: 3, accept: 2,
    fight: { hive: 0.35, war: 0.25, defence: 0.3 }, hurt: 0.35, dmg: [10, 40], share: { food: 4, ammo: 6, scrap: 2 }, back: 3, perFight: 1, mourn: 2, fit: 70 },
  // Old hands: who may ask to join you for good (noteVet), and the cost.
  VET: { trips: 3, days: 30, gw: 60, hp: 60, ask: 0.35, free: 80, cost: -5, keep: 6 },
  // A loot share promised in the request (settleShare): the choices, points a share is worth (× SHARE.points), goodwill.
  SHARE: { choices: [0, 0.1, 0.25], points: 6, gwPer: 60, gwMax: 3 },
  // Their group pulls a hurt volunteer out (between fights, a hive crawl's chambers included): under PULL.hp health.
  PULL: { hp: 50 },
  // A fight of your people lent out that you may watch on the map (watchCard): the enemy by the need.
  WATCH: { war: [4, 7], dead: [8, 14], deadPower: [2, 3], allies: [2, 5] },
  // The coalition's council votes to send volunteers to a member at war (councilVolCard): each member that votes yes
  // sends COUNCIL.n fighters for COUNCIL.days; voting no costs COUNCIL.no goodwill with the member at war.
  COUNCIL: { n: [1, 2], days: [4, 7], no: -2, send: 2 },
  // Groups lending each other fighters.
  LEND: { chance: 0.08, rel: 30, pop: 14, days: [3, 7], lose: 0.15, rel_up: 4, stay: 0.1 },
};
// The governor's styles (autopilot.js PERSONALITIES keys): people kept at the hub before lending, the most it lends
// to one ask, how readily it accepts (score), the squad-to-hive ratio (or assault odds) under which it asks allies.
export const STYLES = {
  cautious:   { keep: 12, lend: 1, accept: 1,   hive: 1.6, assault: 0.85, offer: true },
  balanced:   { keep: 10, lend: 2, accept: 2,   hive: 1.5, assault: 0.8,  offer: false },
  aggressive: { keep: 8,  lend: 2, accept: 2,   hive: 1.25, assault: 0.7, offer: false },
  diplomat:   { keep: 8,  lend: 3, accept: 5,   hive: 1.7, assault: 0.85, offer: true },
  hunter:     { keep: 9,  lend: 2, accept: 2,   hive: 1.4, assault: 0.75, offer: false },
  turtle:     { keep: 16, lend: 1, accept: 0.5, hive: 1.8, assault: 0.9,  offer: true },
  expander:   { keep: 8,  lend: 2, accept: 2,   hive: 1.3, assault: 0.75, offer: false },
};
const styleOf = (state) => { const g = state.governor; const k = g ? (g.style || g.personality) : "balanced"; return STYLES[k] || STYLES.balanced; };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const first = (s) => String(s.name).split(" ")[0];
const listNames = (xs) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

export function ensureVols(state) {
  if (!state.vols) state.vols = { people: [], asks: [], loans: [], aiLoans: [], lastAsk: {}, refused: {}, nextAsk: 1,
    stats: { asked: 0, agreed: 0, refused: 0, joined: 0, home: 0, died: 0, aiAsks: 0, lent: 0, lentDied: 0, lentHome: 0, declined: 0, aiLoans: 0 } };
  return state.vols;
}
export const volRng = (state) => state.volRng || (state.volRng = new Rng(((state.seed || 1) * 2654435761 + 0x5017) >>> 0));
export const isVolunteer = (s) => !!(s && s.vol);
export const volunteerById = (state, id) => (state.vols ? state.vols.people.find((s) => s.id === id) : undefined);
// Your own people on a team (no volunteers).
export const ownMembers = (state, p) => partyMembers(state, p).filter((s) => !s.vol);
export const volunteersWith = (state, p) => (state.vols ? state.vols.people.filter((s) => s.alive && s.location && s.location.kind === "party" && s.location.partyId === p.id) : []);
export const volunteersComing = (state, p) => (state.vols ? state.vols.people.filter((s) => s.alive && s.location && s.location.kind === "coming" && s.location.partyId === p.id) : []);
export const lentWith = (s) => (s && s.location && s.location.kind === "lent" ? s.location : null);
export const lentPeople = (state) => state.survivors.filter((s) => s.alive && lentWith(s));
// The groups with volunteers in one of your teams on this tile or crawling this hive (alliance.js: no double count).
export function volunteerGroupsAt(state, tile, hiveId = null) {
  const out = new Set();
  if (!state.vols) return out;
  for (const s of state.vols.people) {
    if (!s.alive || !s.location || s.location.kind !== "party") continue;
    const p = state.parties.find((x) => x.id === s.location.partyId);
    if (p && (partyTile(p) === tile || p.dest === tile || (hiveId != null && p.hiveCrawl && p.hiveCrawl.hiveId === hiveId))) out.add(s.vol.fid);
  }
  return out;
}

// ---------- what the team is out to do ----------
// { kind, label, danger } for the team's mission (the hive's tier makes a hive deeper and worse).
export function missionOf(state, p) {
  const m = p.hiveCrawl ? "hive" : p.mission;
  if (m === "hive") {
    const hv = hiveAt(state, p.hiveCrawl ? p.hiveCrawl.tile : p.dest);
    const tier = hv ? hiveTier(state, hv) : 0;
    return { kind: "hive", label: `a hive crawl${hv ? ` into ${hv.name}` : ""}`, danger: VOL.DANGER.hive + VOL.DANGER.hiveTier * tier };
  }
  if (m === "assault") { const f = state.factions.find((x) => x.alive && x.bases.includes(p.dest)); return { kind: "assault", label: `an assault${f ? ` on ${f.name}` : ""}`, danger: VOL.DANGER.assault }; }
  if (m === "move" || m === "trade" || m === "formed" || m === "recon") return { kind: "escort", label: m === "recon" ? "a recon trip" : "travelling with your team", danger: VOL.DANGER[m] || 0 };
  if (VOL.DANGER[m] != null) return { kind: m, label: (MISSIONS[m] ? MISSIONS[m].name : m).toLowerCase(), danger: VOL.DANGER[m] };
  return { kind: "escort", label: "travelling with your team", danger: 0 };
}

// ---------- asking a group ----------
// The groups you could ask now, with why not ("" when you can).
export function askableGroups(state) {
  return state.factions.filter((f) => f.alive && f.known).map((f) => ({ f, why: groupProblem(state, f) }));
}
export function groupProblem(state, f) {
  if (!f || !f.alive) return "They are gone.";
  if (!f.known) return "You have not met them.";
  if (attitude(f) === "Hostile") return `${f.name} is hostile.`;
  if (!reachVia(state, f)) return `${f.name} is out of reach: radio range, a team at their gates, a base near theirs or a coalition member near them.`;
  if (f.goodwill < VOL.GW_MIN) return `${f.name} would not lend people below goodwill ${VOL.GW_MIN} (now ${Math.round(f.goodwill)}).`;
  const V = ensureVols(state);
  const wait = V.refused[f.id] != null ? V.refused[f.id] + VOL.REFUSED_WAIT - day(state) : 0;
  if (wait > 0) return `${f.name} said no lately: ask again in ${wait} day${wait === 1 ? "" : "s"}.`;
  return "";
}
export function teamProblem(state, p) {
  if (!p || !state.parties.includes(p) || p.owner !== "player" || p.kind === "convoy") return "Pick one of your teams.";
  if (!ownMembers(state, p).length) return "That team has none of your people.";
  const n = volunteersWith(state, p).length + volunteersComing(state, p).length;
  if (n >= VOL.TEAM_MAX) return `That team already has ${n} volunteers (at most ${VOL.TEAM_MAX}).`;
  return "";
}
const supplyValue = (key, qty) => (key === "food" ? DAY_VALUE * qty : SUPPLIES[key] ? (supValue(key) || 1) * qty : 0); // food: days of it (foods.js)
const offerOk = (o) => !!(o && o.qty > 0 && (SUPPLIES[o.key] || o.key === "food"));
// The answer they would give: { yes, points, parts: [{ label, v }], refuse (an outright no), n, days }.
// opts: { n, days, offer: { key, qty } | null, favour }.
export function askQuote(state, f, p, opts = {}) {
  const n = clamp(Math.round(opts.n || 1), 1, VOL.MAX);
  const days = clamp(Math.round(opts.days || VOL.SPAN.def), VOL.SPAN.min, VOL.SPAN.max);
  const P = VOL.P;
  const out = { yes: false, points: 0, parts: [], refuse: "", n, days };
  out.refuse = groupProblem(state, f) || (p && state.parties.includes(p) ? teamProblem(state, p) : ""); // p may be the planner's trip before it leaves
  if (!out.refuse && f.pop - n < VOL.HOME_MIN) out.refuse = `${f.name} cannot spare ${n}: they keep at least ${VOL.HOME_MIN} at home (${Math.round(f.pop)} people).`;
  if (!out.refuse && p && volunteersWith(state, p).length + volunteersComing(state, p).length + n > VOL.TEAM_MAX) out.refuse = `At most ${VOL.TEAM_MAX} volunteers with one team.`;
  if (out.refuse) return out;
  const add = (label, v) => { if (Math.abs(v) > 1e-9) out.parts.push({ label, v: Math.round(v * 100) / 100 }); };
  add(`goodwill ${Math.round(f.goodwill)}`, (f.goodwill - 50) / P.gwDiv);
  if (isMember(state, f)) add("coalition member", P.member);
  if (f.pact === "trade") add("trade pact", P.trade); else if (f.pact) add("non-aggression pact", P.nonaggression);
  const jobs = jobsDoneFor(state, f);
  if (jobs) add(`${jobs} job${jobs === 1 ? "" : "s"} done for them`, Math.min(P.jobMax, jobs * P.job));
  const m = p ? missionOf(state, p) : { kind: "escort", label: "travelling with your team", danger: 0 };
  if (m.danger) add(`the danger: ${m.label}`, -m.danger);
  if (n > 1) add(`${n} people`, -P.head * (n - 1));
  if (days > P.longFrom) add(`${days} days`, -P.perDay * (days - P.longFrom));
  const trouble = groupTrouble(state, f);
  if (trouble.war) add(`at war with ${trouble.war}`, -P.war);
  if (trouble.horde) add(`a horde of ${trouble.horde} near their base`, -P.horde);
  if (f.pop < P.shortPop) add(`short-handed (${Math.round(f.pop)} people)`, -P.short);
  const d = day(state);
  const fallen = (f.volFallen || []).filter((x) => d - x.day <= P.fallenDays);
  if (fallen.length) add(`${fallen.length} of theirs died with your teams lately`, -fallen.reduce((a, x) => a + (x.how === "fight" ? P.fallen : P.fallenBad), 0));
  if (offerOk(opts.offer)) add(`your offer: ${opts.offer.key === "ammo" ? payWord(state, payBase(state, p), opts.offer.qty) : opts.offer.key === "food" ? `${opts.offer.qty} days of food` : `${opts.offer.qty} ${SUPPLIES[opts.offer.key].name.toLowerCase()}`}`, supplyValue(opts.offer.key, opts.offer.qty) / P.goodsPer);
  if (opts.favour) add("a favour owed (they will ask one of you)", P.favour);
  if (opts.share > 0) add(`a ${Math.round(opts.share * 100)}% share of the haul`, opts.share * VOL.SHARE.points);
  out.points = Math.round(out.parts.reduce((a, x) => a + x.v, 0) * 100) / 100;
  out.yes = out.points >= 0;
  return out;
}
// A group's own trouble: { war (the enemy's name), horde (its size), hive (a hive war coming) }.
export function groupTrouble(state, f) {
  const out = { war: "", horde: 0, hive: null };
  const w = warsOf(state, f)[0];
  if (w) { const e = factionById(state, enemyIn(w, f)); out.war = e ? (e.known ? e.name : "another group") : "another group"; }
  const g = state.grid;
  for (const h of state.hordes || []) if (h.size >= VOL.P.hordeSize && f.bases.some((b) => g.distance(b, h.tile) <= VOL.P.hordeRange)) out.horde = Math.max(out.horde, Math.round(h.size));
  return out;
}

// The hub's stock to pay an offer from (the team's home base when it has one).
const payBase = (state, p) => (p && baseById(state, p.homeBaseId)) || hub(state);
export function offerProblem(state, p, offer) {
  if (!offer || !offer.qty) return "";
  const b = payBase(state, p);
  if (!b) return "No base to pay from.";
  if (supplyAmt(b.stock, offer.key) < offer.qty) return `${b.name} has only ${Math.floor(supplyAmt(b.stock, offer.key))} ${offer.key === "ammo" ? "rounds" : offer.key}.`; // "ammo": every round there
  return "";
}

// Ask. Returns { ok, text, people }. The reply goes in the log as well.
export function askVolunteers(state, f, p, opts = {}) {
  const V = ensureVols(state);
  const q = askQuote(state, f, p, opts);
  if (q.refuse) return { ok: false, text: q.refuse, people: [] };
  const offer = offerOk(opts.offer) ? opts.offer : null;
  const op = offerProblem(state, p, offer);
  if (op) return { ok: false, text: op, people: [] };
  V.stats.asked++;
  const m = missionOf(state, p);
  if (!q.yes) {
    V.stats.refused++;
    V.refused[f.id] = day(state);
    const worst = [...q.parts].sort((a, b) => a.v - b.v)[0];
    const text = `${f.name} will not send ${q.n === 1 ? "anyone" : q.n} for ${m.label}${worst && worst.v < 0 ? ` (${worst.label} weighs against it)` : ""}.`;
    log(state, text, "info");
    return { ok: false, text, people: [] };
  }
  V.stats.agreed++;
  delete V.refused[f.id];
  if (offer) {
    const b = payBase(state, p);
    if (offer.key === "ammo") { const sent = payAmmoKeys(state, b, offer.qty); offer.paid = roundsText(sent); } // rounds by calibre: the ones the guns there need least (their store keeps one count)
    else if (offer.key === "food") moveFoodUnits(b, f, offer.qty, { state }); // foods.js: days of food, the soonest to spoil first
    else b.stock[offer.key] -= offer.qty;
    if (offer.key !== "food") f.stock[offer.key] = (f.stock[offer.key] || 0) + offer.qty;
  }
  if (opts.favour) f.volFavour = { day: day(state) };
  if (!offer && !opts.favour && !(opts.share > 0)) changeGoodwill(state, f, -VOL.ASK_GW, "you asked them for people"); // a share of the haul is something in return too
  const share = VOL.SHARE.choices.includes(opts.share) ? opts.share : 0;
  const req = { id: V.nextAsk++, fid: f.id, partyId: p.id, n: q.n, days: q.days, mission: m.kind, label: m.label, day: day(state), share, cargoStart: supplyOf(p), homeBaseId: p.homeBaseId };
  (V.reqs || (V.reqs = [])).push(req);
  const eta = travelHours(state, f, p);
  const people = [];
  const kit = issueKit(state, f, q.n, "field");
  for (let i = 0; i < q.n; i++) people.push(makeVolunteer(state, f, req, kit[i], eta));
  f.pop -= q.n;
  const text = `${f.name} send ${listNames(people.map((s) => s.name))} for ${m.label}: ${q.days} days. They reach the team in about ${eta} hours.`;
  log(state, text, "good");
  return { ok: true, text, people };
}
function travelHours(state, f, p) {
  const tile = partyTile(p);
  const d = f.bases.length ? Math.min(...f.bases.map((b) => state.grid.distance(b, tile))) : 10;
  return clamp(Math.round(d * VOL.TRAVEL), VOL.TRAVEL_MIN, VOL.TRAVEL_MAX);
}
// One of the group's people for your team: skills by its type, kit from its arsenal (the pieces leave it).
export function makeVolunteer(state, f, req, lo, eta) {
  const V = ensureVols(state);
  const keep = state.rng;
  state.rng = volRng(state); // the world's dice untouched (makeSurvivor draws its name, skills and traits)
  // One who came before goes again first (f.volVets: the same people come back, and may ask to stay one day).
  const vet = (f.volVets || []).filter((v) => !v.out && v.s && v.s.alive).sort((a, b) => b.trips - a.trips || a.s.id - b.s.id)[0];
  let s;
  if (vet) { state.rng = keep; s = vet.s; vet.out = true; s.health = Math.max(s.health, 80); }
  else {
    try { s = makeSurvivor(state, VOL.QUALITY[f.type] || 1); } finally { state.rng = keep; }
    s.skills.shooting = Math.min(20, (s.skills.shooting || 0) + (VOL.SHOOT[f.type] || 0));
    s.skills.melee = Math.min(20, (s.skills.melee || 0) + (VOL.MELEE[f.type] || 0));
  }
  s.role = "volunteer";
  const lent = [];
  if (lo) {
    if (lo.weapon && removeFromArsenal(f, lo.weapon, "lent")) { s.gear.weapon = lo.weapon; lent.push(lo.weapon); }
    for (const [slot, it] of Object.entries(lo.armour || {})) if (it && s.gear[slot] === null && removeFromArsenal(f, it, "lent")) { s.gear[slot] = it; lent.push(it); }
  }
  if (!s.gear.weapon && GEAR.knife) s.gear.weapon = newItem("knife");
  if (req.mission === "hive" && !s.gear.tool && !lightOf(s) && GEAR.flashlight) s.gear.tool = newItem("flashlight"); // a hive is dark (hivecrawl.js LIGHT): they bring a light of their own
  s.vol = { fid: f.id, group: f.name, req: req.id, mission: req.mission, label: req.label, since: state.hour, until: state.hour + eta + req.days * 24, days: req.days, lent, fought: 0, vet: !!vet };
  s.location = { kind: "coming", partyId: req.partyId, eta: state.hour + eta };
  V.people.push(s);
  return s;
}

// ---------- the hour ----------
export function volunteersHour(state) {
  if (state.hour % 24 === 0) volunteersDaily(state);
  if (!state.vols) { if (state.autopilot && state.hour % 3 === 0) autoAskVolunteers(state); return; }
  const V = state.vols;
  const gone = [];
  for (const s of [...V.people]) {
    if (!s.alive) continue;
    const L = s.location || { kind: "none" };
    const f = factionById(state, s.vol.fid);
    const p = L.partyId != null ? state.parties.find((x) => x.id === L.partyId) : null;
    if (!f || !f.alive) { stayWithYou(state, s, p); continue; }
    if (L.kind === "coming") {
      if (!p || p.owner !== "player" || !ownMembers(state, p).length) { gone.push([s, "the team they were to meet is gone"]); continue; }
      if (attitude(f) === "Hostile" || f.goodwill < VOL.GW_LEAVE) { gone.push([s, `${f.name} called them back`]); continue; }
      if (state.hour < L.eta || battlePending(state, p.id)) continue;
      join(state, s, p);
      continue;
    }
    if (L.kind !== "party" || !p || p.owner !== "player") { gone.push([s, L.kind === "base" ? "the job is done" : "the team is gone"]); continue; }
    if (!ownMembers(state, p).length) { gone.push([s, "none of your people are left with them"]); continue; }
    if (attitude(f) === "Hostile" || f.goodwill < VOL.GW_LEAVE) { gone.push([s, `${f.name} called them home`]); continue; }
    if (state.hour >= s.vol.until && !busy(state, p)) gone.push([s, "their time is up"]);
    else if (s.health < VOL.PULL.hp && !fighting(state, p)) { gone.push([s, `hurt (health ${Math.round(s.health)}): ${s.vol.group} pull them out`]); V.stats.pulled = (V.stats.pulled || 0) + 1; } // between fights, between a crawl's chambers too
  }
  if (gone.length) sendHomeAll(state, gone);
  noteHaul(state);
  if (state.autopilot && state.hour % 3 === 0) autoAskVolunteers(state);
}
const fighting = (state, p) => battlePending(state, p.id) || !!(state.combat && state.combat.setup && state.combat.setup.partyId === p.id) || !!state.resolving;
const busy = (state, p) => battlePending(state, p.id) || !!(p.hiveCrawl && !p.hiveCrawl.done) || !!(p.crawl && !p.crawl.done) || !!(state.combat && state.combat.setup && state.combat.setup.partyId === p.id);
function join(state, s, p) {
  const V = ensureVols(state);
  if (!p.members.includes(s.id)) p.members.push(s.id);
  s.location = { kind: "party", partyId: p.id };
  s.vol.joined = state.hour;
  V.stats.joined++;
  // What they bring: a day's food and water each day of the span (up to BRING.days), rounds for their gun.
  const days = Math.min(VOL.BRING.days, s.vol.days || VOL.SPAN.def);
  giveFood(state, p, days, "travel"); // foods.js: a day's food each day of the span, what travellers carry
  p.supplies.water = (p.supplies.water || 0) + days;
  const f = factionById(state, s.vol.fid);
  if (f && s.gear.weapon && calOf(s.gear.weapon.key)) { // a gun: rounds of its calibre
    const got = takeArsenalRounds(f, VOL.BRING.ammo);
    const cal = calOf(s.gear.weapon.key);
    const key = cal ? baseKey(cal) : "ammo"; // rounds of their own gun's calibre
    if (got > 0) p.supplies[key] = (p.supplies[key] || 0) + got;
  }
  try { weighTeam(state, p); } catch { /* the load is weighed again on the next move */ }
  log(state, `${s.name}, a volunteer from ${s.vol.group}, joined the team at ${tileLabel(state, partyTile(p))} (${days} days' food and water, their own ${s.gear.weapon ? s.gear.weapon.name : "fists"}). Their group's orders, not yours, in a fight.`, "good");
}
// Their group is gone: they stay with your people (into your roster, on the team they are with, or the hub).
function stayWithYou(state, s, p) {
  const V = ensureVols(state);
  V.people = V.people.filter((x) => x !== s);
  const name = s.vol.group;
  delete s.vol;
  s.role = "scavenge";
  if (p && state.parties.includes(p) && s.location.kind === "party") { /* stays on the team */ }
  else { const h = hub(state); s.location = h ? { kind: "base", baseId: h.id } : s.location; if (p) p.members = p.members.filter((id) => id !== s.id); }
  state.survivors.push(s);
  log(state, `With ${name} gone, ${s.name} stays with your people.`, "good");
}
// Home: off the team, their kit back to the arsenal (what they picked up is theirs), their people at home again.
function sendHomeAll(state, list) {
  const V = ensureVols(state);
  const byKey = new Map();
  const teams = new Set();
  for (const [s, why] of list) {
    const vol = s.vol; // noteVet takes it off
    const f = factionById(state, vol.fid);
    const L = s.location;
    const p = L && L.partyId != null ? state.parties.find((x) => x.id === L.partyId) : null;
    if (p) { p.members = p.members.filter((id) => id !== s.id); teams.add(p); }
    const joinedAt = vol.joined ?? state.hour;
    if (f && f.alive) {
      for (const it of stripAll(s)) if (arsenalWorthy(it)) addToArsenal(state, f, it, "back"); // the kit goes back; the rest was theirs
      f.pop += 1;
      if (vol.fought) changeGoodwill(state, f, VOL.BACK, `${first(s)} came home safe after fighting beside you`);
      noteVet(state, f, s, Math.max(0, (state.hour - joinedAt) / 24), why);
    }
    const reqId = vol.req;
    V.people = V.people.filter((x) => x !== s);
    settleShare(state, reqId);
    V.stats.home++;
    const k = `${vol.group}|${why}`;
    if (!byKey.has(k)) byKey.set(k, { group: vol.group, why, names: [] });
    byKey.get(k).names.push(first(s));
  }
  for (const g of byKey.values()) log(state, `${listNames(g.names)} (${g.group}) went home: ${g.why}.`, "info");
  for (const p of teams) { if (state.parties.includes(p)) { wipeIfEmpty(state, p); if (state.parties.includes(p)) try { weighTeam(state, p); } catch { /* */ } } }
}
// ---------- old hands (VOL.VET) ----------
// A volunteer home alive is one of the group's old hands: they go first next time, and after VET.trips trips or
// VET.days days with your teams (their group's goodwill VET.gw+, their health VET.hp+) they may ask to join you for
// good (VET.ask a trip home): a card. Welcome them: they are yours from then on, at the hub; their group lets them go
// for VET.cost goodwill (nothing when its goodwill is VET.free+, and then they bring a weapon from its arsenal, the
// best it can spare); else they come with what is their own (a knife).
function noteVet(state, f, s, days, why) {
  const vets = f.volVets || (f.volVets = []);
  let v = vets.find((x) => x.s === s);
  if (!v) { v = { s, trips: 0, days: 0 }; vets.push(v); }
  v.out = false;
  v.trips++;
  v.days += days;
  delete s.vol;
  s.location = { kind: "away", factionId: f.id };
  while (vets.length > VOL.VET.keep) vets.splice(vets.findIndex((x) => !x.out), 1);
  const rng = volRng(state);
  if (/^hurt|called|goodwill/.test(why || "") || f.goodwill < VOL.VET.gw || s.health < VOL.VET.hp) return;
  if (!(v.trips >= VOL.VET.trips || v.days >= VOL.VET.days) || !rng.chance(VOL.VET.ask) || !hub(state)) return;
  addCard(state, vetCard(state, f, v));
}
export function vetCard(state, f, v) {
  const s = v.s;
  const free = f.goodwill >= VOL.VET.free;
  return {
    title: `${s.name} asks to join you`, volVet: s.id,
    text: `${s.name} of ${f.name} has been out with your teams ${v.trips} time${v.trips === 1 ? "" : "s"} (${Math.round(v.days)} days) and asks to stay with your people for good.${free ? ` ${f.name} think well enough of you to let them go with their blessing and a weapon.` : ` ${f.name} would not like losing one of theirs.`}`,
    choices: [
      { label: "Welcome them", hint: free ? `They join your hub with a weapon from ${f.name}'s arsenal; no goodwill lost` : `They join your hub with a knife; ${-VOL.VET.cost} goodwill with ${f.name}`, ai: (st) => (hub(st) && atBase(st, hub(st).id).length < 30 ? 2 : 0), resolve: (st) => welcomeVet(st, f, v) },
      { label: "Not now", default: true, hint: "They stay with their group (and may ask again)", ai: () => 1, resolve: () => `${first(s)} goes back to ${f.name}.` },
    ],
  };
}
export function welcomeVet(state, f, v) {
  const s = v.s;
  const h = hub(state);
  if (!h || !f.volVets || !f.volVets.includes(v) || v.out || !s.alive) return `${first(s)} is not here to ask.`;
  f.volVets = f.volVets.filter((x) => x !== v);
  const free = f.goodwill >= VOL.VET.free;
  if (!free) changeGoodwill(state, f, VOL.VET.cost, `${s.name} left them for you`);
  f.pop = Math.max(0, f.pop - 1);
  const lo = free ? issueKit(state, f, 1, "field")[0] : null;
  if (lo && lo.weapon && removeFromArsenal(f, lo.weapon, "left with one of theirs")) s.gear.weapon = lo.weapon;
  if (!s.gear.weapon && GEAR.knife) s.gear.weapon = newItem("knife");
  s.location = { kind: "base", baseId: h.id };
  s.role = "scavenge";
  s.joinedFrom = f.name;
  state.survivors.push(s);
  ensureVols(state).stats.stayed = (ensureVols(state).stats.stayed || 0) + 1;
  log(state, `${s.name} left ${f.name} to join your people at ${h.name}${s.gear.weapon ? ` (with a ${s.gear.weapon.name})` : ""}.`, "good");
  return `${first(s)} is one of yours now.`;
}

// ---------- the loot share (VOL.SHARE) ----------
// A request may promise the group a share of the team's haul: what its cargo gained while their volunteers were with
// it (the last look, req.cargoLast, against the team's cargo when you asked) × the share, from the team's cargo (or
// its home base when the team is home already), when the last of them leaves; goodwill for it.
const supplyOf = (p) => { const out = {}; for (const [k, v] of Object.entries((p.cargo && p.cargo.supplies) || {})) if (Number.isFinite(v) && v > 0 && SUPPLIES[k]) out[k] = v; return out; };
function settleShare(state, reqId) {
  const V = ensureVols(state);
  const req = (V.reqs || []).find((r) => r.id === reqId);
  if (!req || V.people.some((s) => s.alive && s.vol && s.vol.req === reqId)) return;
  V.reqs = V.reqs.filter((r) => r !== req);
  const f = factionById(state, req.fid);
  if (!req.share || !f || !f.alive) return;
  const p = state.parties.find((x) => x.id === req.partyId);
  if (p) req.cargoLast = supplyOf(p);
  const from = p ? p.cargo.supplies : (baseById(state, req.homeBaseId) || hub(state) || {}).stock;
  if (!from) return;
  const got = [];
  let value = 0;
  for (const [k, q] of Object.entries(req.cargoLast || {})) {
    const gain = Math.max(0, q - ((req.cargoStart || {})[k] || 0));
    const give = Math.min(Math.floor(gain * req.share), Math.floor(from[k] || 0));
    if (give < 1) continue;
    from[k] -= give;
    f.stock[k] = (f.stock[k] || 0) + give;
    value += supplyValue(k, give);
    got.push(`${give} ${keyWord(k)}`);
  }
  V.stats.shared = (V.stats.shared || 0) + value;
  if (!got.length) return;
  changeGoodwill(state, f, Math.min(VOL.SHARE.gwMax, 1 + value / VOL.SHARE.gwPer), "their share of the haul");
  log(state, `${f.name}'s share of the haul (${Math.round(req.share * 100)}%): ${got.join(", ")}.`, "info");
}
// The hourly look at a team's cargo for the share.
function noteHaul(state) {
  const V = ensureVols(state);
  for (const r of V.reqs || []) { const p = state.parties.find((x) => x.id === r.partyId); if (p) { r.cargoLast = supplyOf(p); r.homeBaseId = p.homeBaseId; } }
}

// world.js killSurvivor: a volunteer died. In a fight: they knew the risk; otherwise you let them die.
export function volunteerFell(state, s, tileId, cause) {
  const V = ensureVols(state);
  const f = factionById(state, s.vol.fid);
  const fight = !!(state.combat || state.resolving) || /fight|battle|shot|brood|hive|horde|scaveng|raid|crawl|core|ambush|killed|bled|left behind|attack|retreat|the dead/i.test(cause || "");
  V.stats.died++;
  s.diedDay = day(state);
  if (f && f.volVets) f.volVets = f.volVets.filter((x) => x.s !== s);
  settleShare(state, s.vol.req);
  if (!f || !f.alive) return;
  (f.volFallen || (f.volFallen = [])).push({ name: s.name, day: day(state), how: fight ? "fight" : "other" });
  changeGoodwill(state, f, fight ? VOL.DEATH.fight : VOL.DEATH.other, fight ? `${s.name} fell beside your people` : `${s.name} died in your care`);
  log(state, fight ? `${f.name} mourn ${s.name}, who fell beside your people. They will remember.` : `${f.name} blame you for ${s.name}'s death ${cause}.`, "danger");
}
// combat.js finishCombat: the volunteers who were in it fought beside you.
export function volFought(state, people) { for (const s of people || []) if (s && s.vol && s.alive) s.vol.fought = (s.vol.fought || 0) + 1; }

// ---------- the day ----------
function volunteersDaily(state) {
  const V = ensureVols(state);
  // Healing on the road (yours heal by health.js; theirs here): 2 a day.
  for (const s of V.people) if (s.alive && s.health < 100) s.health = Math.min(100, s.health + 2);
  // The dead with no team left are dropped after a month.
  V.people = V.people.filter((s) => s.alive || (s.diedDay != null && day(state) - s.diedDay < 30));
  loansDaily(state);
  aiAsksDaily(state);
  aiLendDaily(state);
  for (const a of [...V.asks]) if (state.hour >= a.expires) expireAsk(state, a);
}

// ---------- the groups ask you ----------
// What a group needs people for now: { kind, label, tile } or null.
export function groupNeed(state, f) {
  const t = groupTrouble(state, f);
  if (t.war) return { kind: "war", label: `their war with ${t.war}` };
  if (t.horde) return { kind: "defence", label: `holding their base against a horde of ${t.horde}` };
  const g = state.grid;
  const hv = (state.hives || []).find((h) => f.bases.some((b) => g.distance(b, h.tile) <= 12));
  if (hv && f.hiveDay != null && f.hiveDay - day(state) <= 6 && f.pop >= 12) return { kind: "hive", label: `their crawl into ${hv.name}` };
  return null;
}
// The fittest people at the hub to lend: health AI.fit+, not the leader, not in bed, best fighters first.
export function lendable(state, base = hub(state)) {
  if (!base) return [];
  return atBase(state, base.id).filter((s) => s.health >= VOL.AI.fit && !s.leader && !s.inBed && !(s.expecting && s.expecting.late)).sort((a, b) => combatPower(b) - combatPower(a) || a.id - b.id);
}
function aiAsksDaily(state) {
  const V = ensureVols(state);
  if (V.asks.length || !hub(state)) return;
  const rng = volRng(state);
  const d = day(state);
  for (const f of state.factions) {
    if (!f.alive || !f.known || attitude(f) === "Hostile" || f.goodwill < VOL.AI.gw || !reachVia(state, f)) continue;
    const owed = !!f.volFavour;
    const last = V.lastAsk[f.id];
    if (last != null && d - last < (owed ? VOL.AI.favourGap : VOL.AI.gap)) continue;
    const need = groupNeed(state, f);
    if (!need) continue;
    if (!rng.chance(owed ? VOL.AI.favourChance : VOL.AI.chance)) continue;
    makeAsk(state, f, need, rng.int(VOL.AI.n[0], VOL.AI.n[1]), rng.int(VOL.AI.days[0], VOL.AI.days[1]));
    return; // one ask at a time
  }
}
// A group's ask of you (the card goes up). Returns the ask.
export function makeAsk(state, f, need, n, days) {
  const V = ensureVols(state);
  V.lastAsk[f.id] = day(state);
  const ask = { id: V.nextAsk++, fid: f.id, kind: need.kind, label: need.label, n, days, expires: state.hour + VOL.AI.expire, owed: !!f.volFavour };
  V.asks.push(ask);
  V.stats.aiAsks++;
  addCard(state, askCard(state, ask));
  return ask;
}
export const askById = (state, id) => (state.vols ? state.vols.asks.find((a) => a.id === id) : null) || null;
export const declineCost = (f, ask) => Math.round(VOL.AI.decline * (ask.owed ? 3 : 1) * (f.goodwill >= 50 ? 1 : 0.5));
export function askCard(state, ask) {
  const f = factionById(state, ask.fid);
  const pool = lendable(state);
  const st = styleOf(state);
  const choices = [];
  for (let k = 1; k <= ask.n; k++) {
    const who = pool.slice(0, k);
    choices.push({
      label: `Send ${k}${who.length >= k ? `: ${who.map(first).join(", ")}` : ""}`,
      hint: `Away ${ask.days} days with ${f.name}, out of your orders: their fights by the numbers. +${VOL.AI.accept} goodwill now; back with a share of what is taken${ask.owed ? "; the favour you owe is paid" : ""}`,
      disabled: (s2) => lendable(s2).length < k || !askById(s2, ask.id),
      ai: (s2) => { const home = hub(s2) ? atBase(s2, hub(s2).id).length : 0; const S = styleOf(s2); return k <= S.lend && home - k >= S.keep ? S.accept + (ask.owed ? 2 : 0) + (S.lend >= 3 ? 0.2 : -0.2) * k : -1; }, // a generous style sends all it can spare, the rest the fewest
      resolve: (s2) => answerAsk(s2, ask.id, lendable(s2).slice(0, k).map((s) => s.id)),
    });
  }
  choices.push({ label: "Choose who…", hint: "Pick the people yourself", uiAction: { type: "volpick", askId: ask.id }, ai: () => -5, resolve: () => "Pick who goes." });
  choices.push({ label: "Decline", default: true, hint: `−${declineCost(f, ask)} goodwill with ${f.name}${ask.owed ? " (you owe them a favour)" : ""}`, ai: () => (st.accept < 1 ? 1.5 : 0.5), resolve: (s2) => answerAsk(s2, ask.id, null) });
  return {
    title: `${f.name} ask for volunteers`, volAsk: ask.id,
    text: `${f.name} call on the radio: they need people for ${ask.label}. They ask for ${ask.n === 1 ? "one fighter" : `up to ${ask.n} fighters`} for about ${ask.days} days${ask.owed ? ", and remind you of the favour you owe them" : ""}. Whoever goes is with them, out of your orders, fights their fights and comes back with a share of what is taken, hurt, or not at all.`,
    choices,
  };
}
// The answer to a group's ask: ids to lend (null: decline). Returns the text.
export function answerAsk(state, askId, ids) {
  const V = ensureVols(state);
  const ask = askById(state, askId);
  if (!ask) return "They no longer ask.";
  const f = factionById(state, ask.fid);
  V.asks = V.asks.filter((a) => a !== ask);
  if (!f || !f.alive) return "They are gone.";
  if (!ids || !ids.length) {
    V.stats.declined++;
    changeGoodwill(state, f, -declineCost(f, ask), "you would not lend them people");
    if (ask.owed) delete f.volFavour;
    return `You decline. ${f.name} will remember it.`;
  }
  const h = hub(state);
  const people = ids.map((id) => state.survivors.find((s) => s.id === id)).filter((s) => s && s.alive && s.location.kind === "base").slice(0, ask.n);
  if (!people.length) return "Nobody could go.";
  const loan = { id: ask.id, fid: f.id, kind: ask.kind, label: ask.label, ids: people.map((s) => s.id), start: day(state), until: day(state) + ask.days, fights: 0, power: 0, baseId: h ? h.id : null, dead: [] };
  for (const s of people) {
    loan.baseId = s.location.baseId;
    s.location = { kind: "lent", fid: f.id, loanId: loan.id, baseId: loan.baseId, since: state.hour, until: loan.until };
    s.station = null;
    loan.power += combatPower(s);
  }
  f.volAid = (f.volAid || 0) + loan.power;
  V.loans.push(loan);
  V.stats.lent += people.length;
  changeGoodwill(state, f, VOL.AI.accept, "you lent them people");
  if (ask.owed) delete f.volFavour;
  const text = `${listNames(people.map(first))} leave${people.length === 1 ? "s" : ""} to join ${f.name} for ${ask.label}, about ${ask.days} days.`;
  log(state, text, "good");
  return text;
}
function expireAsk(state, ask) {
  const V = ensureVols(state);
  V.asks = V.asks.filter((a) => a !== ask);
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].volAsk === ask.id) state.cards.splice(i, 1);
  const f = factionById(state, ask.fid);
  if (f && f.alive) { changeGoodwill(state, f, -1, "you never answered their call"); log(state, `${f.name} gave up waiting for your answer.`, "info"); }
}
// Your people lent out: each day their fight may come; at the end they come home with a share.
export function loansDaily(state) {
  const V = ensureVols(state);
  const rng = volRng(state);
  const d = day(state);
  for (const loan of [...V.loans]) {
    const f = factionById(state, loan.fid);
    const people = loan.ids.map((id) => state.survivors.find((s) => s.id === id)).filter((s) => s && s.alive && lentWith(s) && lentWith(s).loanId === loan.id);
    if (!f || !f.alive) { endLoan(state, loan, people, `${f ? f.name : "the group"} is gone: they made their way home`); continue; }
    if (d < loan.until && rng.chance(VOL.AI.fight[loan.kind] || 0.2)) {
      // In the browser, not on autopilot: you may watch it on the map (watchCard); else by the numbers.
      if (typeof window !== "undefined" && !state.autopilot && !state.autoCombat && !state.cards.some((c) => c.volWatch === loan.id)) { addCard(state, watchCard(state, loan)); continue; }
      lentFightByNumbers(state, loan, f, people, rng);
    }
    if (d >= loan.until) endLoan(state, loan, people.filter((s) => s.alive), "");
  }
}
// A fight of your people lent out, by the numbers (each one VOL.AI.hurt to be hurt VOL.AI.dmg, which can kill).
export function lentFightByNumbers(state, loan, f, people, rng = volRng(state)) {
  const V = ensureVols(state);
  loan.fights++;
  const hurtNames = [], deadNames = [];
  for (const s of people) {
    if (!rng.chance(VOL.AI.hurt)) continue;
    hurt(state, s, rng.int(VOL.AI.dmg[0], VOL.AI.dmg[1]), null, `fighting beside ${f.name} (${loan.label})`);
    if (s.alive) hurtNames.push(first(s)); else { deadNames.push(first(s)); loan.dead.push(s.name); V.stats.lentDied++; }
  }
  fightShare(loan, f, people.filter((s) => s.alive).length); // the share of the fight from the group's stores
  log(state, `Your people with ${f.name} fought in ${loan.label}${hurtNames.length ? `: ${listNames(hurtNames)} hurt` : ""}${deadNames.length ? `${hurtNames.length ? ";" : ":"} ${listNames(deadNames)} killed` : ""}${!hurtNames.length && !deadNames.length ? ", unhurt" : ""}.`, deadNames.length ? "death" : "info");
}
// The share of a fight from the group's stores, by your people still with them.
function fightShare(loan, f, live) {
  loan.share = loan.share || {};
  for (const [k, q] of Object.entries(VOL.AI.share)) { const got = Math.min(Math.max(0, Math.floor(f.stock[k] || 0)), q * live); if (got > 0) { f.stock[k] -= got; loan.share[k] = (loan.share[k] || 0) + got; } }
}
const loanPeople = (state, loan) => loan.ids.map((id) => state.survivors.find((s) => s.id === id)).filter((s) => s && s.alive && lentWith(s) && lentWith(s).loanId === loan.id);
// ---------- watching their fight (VOL.WATCH) ----------
// The card: watch it on the battle map (your people and the group's fighters all moved by the AI, you only watch; the
// group's fighters are its own side, thirdside.js "military": they fight the enemy, never you), or let it play out.
export function watchCard(state, loan) {
  const f = factionById(state, loan.fid);
  const names = loanPeople(state, loan).map(first);
  return {
    title: `Your people with ${f ? f.name : "the group"} go into a fight`, volWatch: loan.id,
    text: `${listNames(names)} ${names.length === 1 ? "is" : "are"} with ${f ? f.name : "the group"} for ${loan.label}, and a fight is coming. You can watch it on the battle map (their group's orders: nobody takes yours), or let it play out.`,
    choices: [
      { label: "Watch the fight", hint: "The battle map: everyone on your side moved by the AI; speed controls work", fight: true, ai: () => -1, resolve: (st) => startWatch(st, loan.id) },
      { label: "Let it play out", default: true, hint: "Resolved by the numbers, as their group's fights are", ai: () => 1, resolve: (st) => { const L = ensureVols(st).loans.find((x) => x.id === loan.id); const g = L && factionById(st, L.fid); if (!L || !g || !g.alive) return "It is over."; lentFightByNumbers(st, L, g, loanPeople(st, L)); return "The fight is over."; } },
    ],
  };
}
// The setup of a watched fight: your lent people (setup.lentIds), the group's fighters as their own side, the enemy
// by the need (a war: the enemy group's fighters; a hive or a horde: the dead).
export function watchSetup(state, loan, rng = volRng(state)) {
  const f = factionById(state, loan.fid);
  const W = VOL.WATCH;
  const war = loan.kind === "war";
  const foe = war ? factionById(state, (warsOf(state, f)[0] && enemyIn(warsOf(state, f)[0], f))) : null;
  const enemy = war
    ? { kind: foe && foe.type === "military" ? "soldiers" : "raiders", count: rng.int(W.war[0], W.war[1]), power: Math.round((foe ? unitPower(foe) : 4) * 10) / 10, factionId: foe ? foe.id : null, name: foe ? `${foe.name}'s fighters` : "their enemies" }
    : { kind: "zombies", count: rng.int(W.dead[0], W.dead[1]), power: rng.int(W.deadPower[0], W.deadPower[1]), name: "the dead" };
  // Their group arms them for it: rounds for each one's gun from its stores, and a couple of meds.
  const pool = { meds: Math.min(2, Math.max(0, Math.floor(f.stock.meds || 0))) };
  for (const s of loanPeople(state, loan)) {
    const cal = s.gear.weapon && calOf(s.gear.weapon.key);
    if (!cal) continue;
    const got = takeArsenalRounds(f, VOL.BRING.ammo);
    if (got > 0) pool[baseKey(cal)] = (pool[baseKey(cal)] || 0) + got;
  }
  f.stock.meds = Math.max(0, (f.stock.meds || 0) - pool.meds);
  return {
    pool, tile: f.bases[0], lentIds: loan.ids.slice(), watch: { fid: f.id, group: f.name, loanId: loan.id }, enemy, ambush: null, canRetreat: true, handler: "lentFight", context: { loanId: loan.id },
    third: [{ side: "military", kind: kitOf(f), count: clamp(Math.round(f.pop / 6), W.allies[0], W.allies[1]), power: unitPower(f), name: f.name, factionId: f.id }],
  };
}
function startWatch(state, loanId) {
  const L = ensureVols(state).loans.find((x) => x.id === loanId);
  const f = L && factionById(state, L.fid);
  if (!L || !f || !f.alive || !loanPeople(state, L).length) return "It is over.";
  startCombat(state, watchSetup(state, L));
  return "You watch.";
}
// The watched fight's end (combat.js finishCombat): a fight like any other of theirs, its share and the log.
registerCombatHandler("lentFight", (state, result, setup) => {
  const L = ensureVols(state).loans.find((x) => x.id === (setup.context && setup.context.loanId));
  const f = L && factionById(state, L.fid);
  if (!L || !f) return;
  L.fights++;
  const dead = (result.survivorsDead || []).map((id) => state.survivors.find((s) => s.id === id)).filter(Boolean);
  for (const s of dead) { L.dead.push(s.name); ensureVols(state).stats.lentDied++; }
  fightShare(L, f, loanPeople(state, L).length);
  ensureVols(state).stats.watched = (ensureVols(state).stats.watched || 0) + 1;
  log(state, `Your people with ${f.name} ${result.outcome === "victory" ? "won their fight" : result.outcome === "retreat" ? "pulled out of their fight" : "lost their fight"}${dead.length ? `: ${listNames(dead.map(first))} killed` : ""}.`, dead.length ? "death" : "info");
});
function endLoan(state, loan, people, why) {
  const V = ensureVols(state);
  const f = factionById(state, loan.fid);
  V.loans = V.loans.filter((x) => x !== loan);
  if (f) f.volAid = Math.max(0, (f.volAid || 0) - loan.power);
  const base = baseById(state, loan.baseId) || hub(state);
  for (const s of people) {
    s.location = base ? { kind: "base", baseId: base.id } : s.location;
    s.hunger = Math.max(s.hunger ?? 70, 70);
    s.thirst = Math.max(s.thirst ?? 70, 70);
    V.stats.lentHome++;
  }
  const got = [];
  if (base && loan.share) for (const [k, q] of Object.entries(loan.share)) if (q > 0) { base.stock[k] = (base.stock[k] || 0) + q; got.push(`${q} ${keyWord(k)}`); }
  if (f && f.alive && !why) {
    changeGoodwill(state, f, VOL.AI.back + VOL.AI.perFight * loan.fights + (loan.dead.length ? VOL.AI.mourn : 0), loan.dead.length ? "your people fought and died beside them" : "your people fought beside them");
  }
  if (people.length || got.length || why) log(state, `${people.length ? listNames(people.map(first)) : "None of your people"} ${people.length === 1 ? "is" : "are"} back from ${f ? f.name : "the group"}${why ? ` (${why})` : ""}${got.length ? ` with ${got.join(", ")}` : ""}${loan.dead.length ? `. ${listNames(loan.dead)} did not come back` : ""}.`, people.length ? "good" : "death");
}

// ---------- groups lend each other ----------
export function aiLendDaily(state) {
  const V = ensureVols(state);
  const rng = volRng(state);
  const d = day(state);
  for (const L of [...V.aiLoans]) {
    if (d < L.until) continue;
    V.aiLoans = V.aiLoans.filter((x) => x !== L);
    const to = factionById(state, L.to), from = factionById(state, L.from);
    if (to) to.volAid = Math.max(0, (to.volAid || 0) - L.power);
    const lost = Math.min(L.n, Math.round(L.n * VOL.LEND.lose * rng.range(0, 2)));
    const stay = L.n - lost > 0 && to && to.alive && from && from.alive && rng.chance(VOL.LEND.stay) ? 1 : 0; // one of them stays with the group they helped (AI parity with your old hands)
    if (from && from.alive) from.pop += L.n - lost - stay;
    if (stay) { to.pop += 1; V.stats.aiStayed = (V.stats.aiStayed || 0) + 1; }
    if (to && from && to.alive && from.alive) changeRelation(state, to, from, VOL.LEND.rel_up);
  }
  for (const g of state.factions) {
    if (!g.alive || V.aiLoans.some((L) => L.to === g.id)) continue;
    const need = groupNeed(state, g);
    if (!need || !rng.chance(VOL.LEND.chance)) continue;
    const gb = blocOf(state, g);
    const friends = state.factions.filter((l) => l !== g && l.alive && l.pop >= VOL.LEND.pop && !groupNeed(state, l) && !V.aiLoans.some((x) => x.from === l.id)
      && (relation(state, g, l) >= VOL.LEND.rel || (gb && blocOf(state, l) === gb)) && !warsOf(state, l).some((w) => enemyIn(w, l) === g.id));
    if (!friends.length) continue;
    const l = friends.sort((a, b) => relation(state, g, b) - relation(state, g, a) || a.id - b.id)[0];
    const n = clamp(Math.floor(l.pop / 8), 1, 3);
    const power = n * unitPower(l);
    l.pop -= n;
    g.volAid = (g.volAid || 0) + power;
    V.aiLoans.push({ from: l.id, to: g.id, n, power, until: d + rng.int(VOL.LEND.days[0], VOL.LEND.days[1]), kind: need.kind });
    V.stats.aiLoans++;
    if (g.known && l.known && reachVia(state, g)) log(state, `Heard on the radio: ${l.name} sent ${n} fighter${n === 1 ? "" : "s"} to help ${g.name} with ${need.label}.`, "info");
  }
}

// ---------- the governor ----------
// A team of the governor's on its way to a hive or an assault whose odds look marginal asks the best ally it can for
// two volunteers (one if two is a no), offering food when its style offers and the hub has plenty.
export function autoAskVolunteers(state) {
  const S = styleOf(state);
  const h = hub(state);
  for (const p of state.parties) {
    if (p.owner !== "player" || p.kind === "convoy" || p.volAsked != null) continue;
    if (!["out", "waiting", "task"].includes(p.phase)) continue;
    const m = missionOf(state, p);
    if (m.kind !== "hive" && m.kind !== "assault") continue;
    if (volunteersWith(state, p).length || volunteersComing(state, p).length) continue;
    const power = ownMembers(state, p).reduce((a, s) => a + combatPower(s), 0);
    let marginal = false;
    if (m.kind === "hive") {
      const hv = hiveAt(state, p.hiveCrawl ? p.hiveCrawl.tile : p.dest);
      if (!hv) continue;
      const est = crawlEstimate(state, hv);
      marginal = !!p.apCrawlTrip || power / Math.max(0.1, est.strength) < S.hive; // a crawl trip goes because the core's odds are not there yet (autopilot.js hiveCandidate)
    } else {
      const f = state.factions.find((x) => x.alive && x.bases.includes(p.dest));
      if (!f) continue;
      marginal = teamAssaultOdds(state, p, assaultForce(state, f, p.dest, p)) < S.assault;
    }
    p.volAsked = day(state);
    const V = ensureVols(state);
    V.stats.autoChecked = (V.stats.autoChecked || 0) + 1;
    if (!marginal) continue;
    V.stats.autoMarginal = (V.stats.autoMarginal || 0) + 1;
    const offer = S.offer && h && foodIn(h.stock) >= 80 ? { key: "food", qty: 20 } : null;
    const cands = state.factions.filter((f) => f.alive && f.known && !groupProblem(state, f));
    let best = null;
    for (const n of [2, 1]) {
      for (const share of [0, 0.1]) { // a 10% share of the haul when nothing less will do
        for (const f of cands) {
          const q = askQuote(state, f, p, { n, days: VOL.SPAN.def, offer, share });
          if (!q.refuse && q.yes && (!best || q.points > best.q.points)) best = { f, q, n, share };
        }
        if (best) break;
      }
      if (best) break;
    }
    if (best) askVolunteers(state, best.f, p, { n: best.n, days: VOL.SPAN.def, offer, share: best.share });
    else V.stats.autoNoAlly = (V.stats.autoNoAlly || 0) + 1; // nobody in reach would say yes
  }
}

// ---------- text for the UI ----------
export function volLine(state, s) {
  if (!s || !s.vol) return "";
  const left = Math.max(0, Math.ceil((s.vol.until - state.hour) / 24));
  return `Volunteer from ${s.vol.group} (${s.vol.label}): their own orders in a fight · ${left} day${left === 1 ? "" : "s"} left`;
}
export function lentLine(state, s) {
  const L = lentWith(s);
  if (!L) return "";
  const f = factionById(state, L.fid);
  return `With ${f ? f.name : "another group"} (back ~day ${L.until})`;
}


// Help → Volunteers (ui/help.js).
export const VOLUNTEERS_HELP = `<b>Asking for volunteers.</b> An allied group can lend you 1–${VOL.MAX} of its people for one of your teams, for ${VOL.SPAN.min}–${VOL.SPAN.max} days: <b>Ask for volunteers…</b> on the group's card in the Groups tab or in the radio panel, <b>Ask allies for volunteers…</b> in a team's panel, or the Volunteers row of the trip planner (asked as the team leaves). You need to reach them (radio, a team at their gates, a base or a coalition member near theirs) and goodwill ${VOL.GW_MIN}+. They answer by points, shown before you ask: goodwill (every ${VOL.P.gwDiv} over 50 a point), the coalition +${VOL.P.member}, a trade pact +${VOL.P.trade} (non-aggression +${VOL.P.nonaggression}), jobs you did for them, the danger of the team's mission (a hive crawl −${VOL.DANGER.hive} and −${VOL.DANGER.hiveTier} a tier, an assault −${VOL.DANGER.assault}, a cull −${VOL.DANGER.cull}), −${VOL.P.head} for each person after the first, −${VOL.P.perDay} a day past ${VOL.P.longFrom}, their own trouble (at war −${VOL.P.war}, a horde near their base −${VOL.P.horde}, fewer than ${VOL.P.shortPop} people −${VOL.P.short}), volunteers of theirs who died with your teams lately, and what you offer: goods from the team's home base (a point for every ${VOL.P.goodsPer} of trade value) or a favour owed (+${VOL.P.favour}: they will call it in). Zero or more is a yes; a yes with nothing offered costs ${VOL.ASK_GW} goodwill. After a no they will not hear you for ${VOL.REFUSED_WAIT} days. A group always keeps ${VOL.HOME_MIN} at home.<br>
<b>With your team.</b> Volunteers are real people, armed and armoured from their group's arsenal. They walk from their base to the team and join it wherever it is, bringing a day's food and water a day of the span (up to ${VOL.BRING.days}) and rounds for their guns. They carry, eat the team's food, count in every fight by the numbers and go into a hive crawl with the team (volunteers for a hive bring a light of their own; the hoard in the core is yours, they keep what they carry; a coalition member that sent volunteers does not also thin the brood from outside). They go home when the span runs out (never in the middle of a fight or a crawl), when the team comes home or is disbanded, when none of your people is left with them, or when their group's goodwill falls below ${VOL.GW_LEAVE}. They keep what they carry; what came from their arsenal goes back.<br>
<b>In a battle</b> they fight on your side in their own colour (a violet ring and a VOL tag) but take <b>no orders</b>: their group's AI moves them at the end of your turn. They keep near your people and hold their fire while nobody has noticed you, then take cover, shoot, reload, and tend and drag the downed. They follow the Evac and the retreat, and leave when your people are all out; with your people down and nobody out, they fight on.<br>
<b>When they die.</b> One who falls in a fight costs ${-VOL.DEATH.fight} goodwill (they knew the risk; the group mourns), one who dies any other way (hunger, thirst, the worm) ${-VOL.DEATH.other}. Home safe after fighting beside you: +${VOL.BACK} each. The group remembers its dead when you ask again.<br>
<b>When they ask you.</b> A group at war, with a horde near its base or a hive crawl coming may call on the radio for 1–3 of your people for a few days: send the fittest, choose who, or decline (−${VOL.AI.decline} goodwill, three times that if you owe them a favour). Your people are then <b>with them</b> (the roster says so) and out of your orders: their strength adds to the group's, each day their fight may come, and anyone may be hurt or killed. They come back at the end with a share of what was taken and the group's thanks. Groups lend each other fighters the same way, and the coalition's council may vote to send a member at war fighters from every member (you vote on its card, and may send some of yours).<br>
<b>Watching their fight.</b> When a fight comes for your people lent out, a card lets you <b>watch it</b> on the battle map (everyone on your side and the group's own fighters moved by the AI; you only watch, the speed controls work) or let it play out by the numbers.<br>
<b>Orders.</b> In a battle you can give a volunteer one simple order from the Volunteers list: <b>Free</b> (their own judgement), <b>Hold here</b> (they shoot from where they stand), <b>Follow</b> the one of yours you have selected (they keep with them and shoot when there is a fair shot). They still act on their own within it.<br>
<b>A share of the haul.</b> The request can promise their group ${VOL.SHARE.choices.slice(1).map((v) => `${Math.round(v * 100)}%`).join(" or ")} of what the team's cargo gains while they are with it (the share × ${VOL.SHARE.points} in points), paid when the last of them leaves, for goodwill.<br>
<b>Hurt volunteers</b> under ${VOL.PULL.hp} health are pulled out by their group (never in the middle of a fight; between a hive crawl's chambers, yes).<br>
<b>Old hands.</b> Volunteers who came home alive go first the next time. After ${VOL.VET.trips} trips or ${VOL.VET.days} days with your teams, with their group's goodwill ${VOL.VET.gw}+, one may ask to join you for good: their group lets them go with a weapon when its goodwill is ${VOL.VET.free}+, else for ${-VOL.VET.cost} goodwill and with a knife. Groups' fighters sometimes stay with a group they helped.`;

// ---------- the coalition's council: volunteers for a member's war (VOL.COUNCIL) ----------
// alliance.js council: when a member is at war with a group outside the coalition, the council may vote on sending it
// volunteers. Each other member votes yes when its relations with the member at war are ALLIANCE.VOTE_REL+ and with
// its enemy below that; you vote on the card (yes and send some of yours, yes, or no). A majority of the votes (yours
// counted) carries it: every member that voted yes sends COUNCIL.n fighters (coarse: aiLoans), and yours go as people
// lent out (a war loan). Voting no costs COUNCIL.no goodwill with the member at war.
export function councilWar(state, ms) {
  for (const m of ms) for (const w of warsOf(state, m)) { const e = factionById(state, enemyIn(w, m)); if (e && e.alive && !isMember(state, e)) return { m, e }; }
  return null;
}
export function councilVolVotes(state, ms, m, e, rel = 10) {
  return ms.filter((x) => x !== m).map((x) => ({ f: x, yes: relation(state, x, m) >= rel && relation(state, x, e) < rel }));
}
export function councilVolCard(state, ms, rel = 10) {
  const w = councilWar(state, ms);
  if (!w) return null;
  const { m, e } = w;
  const votes = councilVolVotes(state, ms, m, e, rel);
  const yesAI = votes.filter((v) => v.yes).length;
  const total = votes.length + 1;
  const pool = lendable(state);
  const choices = [];
  for (const k of [1, 2]) {
    if (pool.length < k) continue;
    choices.push({ label: `Vote yes and send ${k}: ${pool.slice(0, k).map(first).join(", ")}`, hint: `${yesAI} of ${votes.length} other members would vote yes; your people go if it carries`,
      disabled: (st) => lendable(st).length < k,
      ai: (st) => { const S = styleOf(st); const home = hub(st) ? atBase(st, hub(st).id).length : 0; return k <= S.lend && home - k >= S.keep ? S.accept + 0.5 - k * 0.2 : -1; },
      resolve: (st) => councilVolVote(st, m, e, true, lendable(st).slice(0, k).map((s) => s.id), rel) });
  }
  choices.push({ label: "Vote yes", hint: "Send none of yours", ai: () => 1, resolve: (st) => councilVolVote(st, m, e, true, [], rel) });
  choices.push({ label: "Vote no", hint: `${-VOL.COUNCIL.no} goodwill with ${m.name}`, default: true, ai: (st) => (styleOf(st).accept < 1 ? 1.5 : 0.2), resolve: (st) => councilVolVote(st, m, e, false, [], rel) });
  return {
    title: `The council: volunteers for ${m.name}'s war`, council: "volunteers",
    text: `${m.name} is at war with ${e.known ? e.name : "another group"} and asks the coalition for fighters. The council votes: ${yesAI} of the ${votes.length} other member${votes.length === 1 ? "" : "s"} would send some. A majority of ${total} votes carries it.`,
    choices,
  };
}
export function councilVolVote(state, m, e, yes, ids, rel = 10) {
  const V = ensureVols(state);
  const ms = state.alliance ? state.alliance.members.map((id) => factionById(state, id)).filter((f) => f && f.alive) : [];
  if (!m.alive || !ms.includes(m)) return "The member is gone.";
  const votes = councilVolVotes(state, ms, m, e, rel);
  const yesN = votes.filter((v) => v.yes).length + (yes ? 1 : 0);
  const carries = yesN * 2 > votes.length + 1;
  if (!yes) changeGoodwill(state, m, VOL.COUNCIL.no, "you voted against sending them fighters");
  V.stats.councilVotes = (V.stats.councilVotes || 0) + 1;
  if (state.alliance) state.alliance.history.unshift({ day: day(state), text: `The council voted on volunteers for ${m.name}'s war: ${carries ? "carried" : "lost"} (${yesN} of ${votes.length + 1}).` });
  if (!carries) return `The vote fails (${yesN} of ${votes.length + 1}).`;
  const rng = volRng(state);
  const sent = [];
  for (const v of votes) {
    if (!v.yes || v.f.pop < VOL.LEND.pop) continue;
    const n = rng.int(VOL.COUNCIL.n[0], VOL.COUNCIL.n[1]);
    const power = n * unitPower(v.f);
    v.f.pop -= n;
    m.volAid = (m.volAid || 0) + power;
    V.aiLoans.push({ from: v.f.id, to: m.id, n, power, until: day(state) + rng.int(VOL.COUNCIL.days[0], VOL.COUNCIL.days[1]), kind: "war", council: true });
    sent.push(`${v.f.name} (${n})`);
  }
  let mine = "";
  if (ids && ids.length) {
    const ask = makeAskQuiet(state, m, { kind: "war", label: `the war with ${e.known ? e.name : "their enemy"} (the council's)` }, ids.length, rng.int(VOL.COUNCIL.days[0], VOL.COUNCIL.days[1]));
    mine = ` ${answerAsk(state, ask.id, ids)}`;
  }
  changeGoodwill(state, m, VOL.COUNCIL.send, "the council sent them fighters");
  log(state, `The council sends fighters to ${m.name}: ${sent.join(", ") || "none from the other members"}.${mine}`, "good");
  return `The vote carries (${yesN} of ${votes.length + 1}).${mine}`;
}
// An ask with no card (the council's): answered at once by councilVolVote.
function makeAskQuiet(state, f, need, n, days) {
  const V = ensureVols(state);
  const ask = { id: V.nextAsk++, fid: f.id, kind: need.kind, label: need.label, n, days, expires: state.hour + VOL.AI.expire, owed: false };
  V.asks.push(ask);
  return ask;
}
