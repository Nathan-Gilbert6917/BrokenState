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
import { Rng } from "./rng.js";
import { log, addCard, day, hub, atBase, factionById, combatPower, hurt, makeSurvivor, baseById, skill } from "./world.js";
import { partyMembers, partyTile, wipeIfEmpty, weighTeam, tileLabel, MISSIONS } from "./parties.js";
import { attitude, changeGoodwill } from "./factions.js";
import { warsOf, enemyIn, relation, changeRelation } from "./diplomacy.js";
import { jobsDoneFor } from "./jobs.js";
import { isMember, reachVia } from "./alliance.js";
import { issueKit, removeFromArsenal, addToArsenal, takeArsenalRounds, unitPower, arsenalWorthy } from "./arsenal.js";
import { allItems, newItem } from "./inventory.js";
import { SUPPLIES, GEAR } from "./data.js";
import { blocOf } from "./blocs.js";
import { hiveAt } from "./hives.js";
import { hiveTier } from "./hivetech.js";
import { crawlEstimate } from "./hivecrawl.js";
import { assaultForce, teamAssaultOdds } from "./conquest.js";
import { battlePending } from "./combat.js";
import { calOf } from "./ammo.js";
import { baseKey } from "./rounds.js";


export const VOL = {
  MAX: 4, TEAM_MAX: 6,                       // per request; volunteers with one team at a time
  SPAN: { min: 2, max: 30, def: 7 },         // days
  GW_MIN: 30, GW_LEAVE: 20, HOME_MIN: 8,     // goodwill to be asked at all, below which they are called home; people a group keeps at home
  TRAVEL: 1.2, TRAVEL_MIN: 2, TRAVEL_MAX: 72, // hours a tile from their nearest base to the team
  BRING: { days: 8, ammo: 30 },              // a day's food and water each for up to `days` of the span; rounds a gun
  QUALITY: { military: 1.15, fortress: 1.1, raider: 1, expansionist: 1, zealot: 1, traders: 0.95, commune: 0.9 },
  SHOOT: { military: 4, fortress: 3, raider: 2, expansionist: 2, zealot: 1, traders: 1, commune: 0 },
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
  // Groups lending each other fighters.
  LEND: { chance: 0.08, rel: 30, pop: 14, days: [3, 7], lose: 0.15, rel_up: 4 },
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
const supplyValue = (key, qty) => (SUPPLIES[key] ? (SUPPLIES[key].value || 1) * qty : 0);
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
  if (opts.offer && opts.offer.qty > 0 && SUPPLIES[opts.offer.key]) add(`your offer: ${opts.offer.qty} ${SUPPLIES[opts.offer.key].name.toLowerCase()}`, supplyValue(opts.offer.key, opts.offer.qty) / P.goodsPer);
  if (opts.favour) add("a favour owed (they will ask one of you)", P.favour);
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
  if ((b.stock[offer.key] || 0) < offer.qty) return `${b.name} has only ${Math.floor(b.stock[offer.key] || 0)} ${offer.key}.`;
  return "";
}

// Ask. Returns { ok, text, people }. The reply goes in the log as well.
export function askVolunteers(state, f, p, opts = {}) {
  const V = ensureVols(state);
  const q = askQuote(state, f, p, opts);
  if (q.refuse) return { ok: false, text: q.refuse, people: [] };
  const offer = opts.offer && opts.offer.qty > 0 && SUPPLIES[opts.offer.key] ? opts.offer : null;
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
    b.stock[offer.key] -= offer.qty;
    f.stock[offer.key] = (f.stock[offer.key] || 0) + offer.qty;
  }
  if (opts.favour) f.volFavour = { day: day(state) };
  if (!offer && !opts.favour) changeGoodwill(state, f, -VOL.ASK_GW, "you asked them for people");
  const req = { id: V.nextAsk++, fid: f.id, partyId: p.id, n: q.n, days: q.days, mission: m.kind, label: m.label, day: day(state) };
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
  let s;
  try { s = makeSurvivor(state, VOL.QUALITY[f.type] || 1); } finally { state.rng = keep; }
  s.skills.shooting = Math.min(20, (s.skills.shooting || 0) + (VOL.SHOOT[f.type] || 0));
  s.role = "volunteer";
  const lent = [];
  if (lo) {
    if (lo.weapon && removeFromArsenal(f, lo.weapon, "lent")) { s.gear.weapon = lo.weapon; lent.push(lo.weapon); }
    for (const [slot, it] of Object.entries(lo.armour || {})) if (it && s.gear[slot] === null && removeFromArsenal(f, it, "lent")) { s.gear[slot] = it; lent.push(it); }
  }
  if (!s.gear.weapon && GEAR.knife) s.gear.weapon = newItem("knife");
  s.vol = { fid: f.id, group: f.name, req: req.id, mission: req.mission, label: req.label, since: state.hour, until: state.hour + eta + req.days * 24, days: req.days, lent, fought: 0 };
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
  }
  if (gone.length) sendHomeAll(state, gone);
  if (state.autopilot && state.hour % 3 === 0) autoAskVolunteers(state);
}
const busy = (state, p) => battlePending(state, p.id) || !!(p.hiveCrawl && !p.hiveCrawl.done) || !!(p.crawl && !p.crawl.done) || !!(state.combat && state.combat.setup && state.combat.setup.partyId === p.id);
function join(state, s, p) {
  const V = ensureVols(state);
  if (!p.members.includes(s.id)) p.members.push(s.id);
  s.location = { kind: "party", partyId: p.id };
  V.stats.joined++;
  // What they bring: a day's food and water each day of the span (up to BRING.days), rounds for their gun.
  const days = Math.min(VOL.BRING.days, s.vol.days || VOL.SPAN.def);
  p.supplies.food = (p.supplies.food || 0) + days;
  p.supplies.water = (p.supplies.water || 0) + days;
  const f = factionById(state, s.vol.fid);
  if (f && s.gear.weapon && GEAR[s.gear.weapon.key] && GEAR[s.gear.weapon.key].ammo) {
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
    const f = factionById(state, s.vol.fid);
    const L = s.location;
    const p = L && L.partyId != null ? state.parties.find((x) => x.id === L.partyId) : null;
    if (p) { p.members = p.members.filter((id) => id !== s.id); teams.add(p); }
    if (f && f.alive) {
      for (const it of allItems(s)) if (arsenalWorthy(it)) addToArsenal(state, f, it, "back");
      f.pop += 1;
      if (s.vol.fought) changeGoodwill(state, f, VOL.BACK, `${first(s)} came home safe after fighting beside you`);
    }
    V.people = V.people.filter((x) => x !== s);
    V.stats.home++;
    const k = `${s.vol.group}|${why}`;
    if (!byKey.has(k)) byKey.set(k, { group: s.vol.group, why, names: [] });
    byKey.get(k).names.push(first(s));
  }
  for (const g of byKey.values()) log(state, `${listNames(g.names)} (${g.group}) went home: ${g.why}.`, "info");
  for (const p of teams) { if (state.parties.includes(p)) { wipeIfEmpty(state, p); if (state.parties.includes(p)) try { weighTeam(state, p); } catch { /* */ } } }
}
// world.js killSurvivor: a volunteer died. In a fight: they knew the risk; otherwise you let them die.
export function volunteerFell(state, s, tileId, cause) {
  const V = ensureVols(state);
  const f = factionById(state, s.vol.fid);
  const fight = !!(state.combat || state.resolving) || /fight|battle|shot|brood|hive|horde|scaveng|raid|crawl|core|ambush|killed|bled|left behind|attack|retreat|the dead/i.test(cause || "");
  V.stats.died++;
  s.diedDay = day(state);
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
  choices.push({ label: "Decline", hint: `−${declineCost(f, ask)} goodwill with ${f.name}${ask.owed ? " (you owe them a favour)" : ""}`, ai: () => (st.accept < 1 ? 1.5 : 0.5), resolve: (s2) => answerAsk(s2, ask.id, null) });
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
      loan.fights++;
      const hurtNames = [], deadNames = [];
      for (const s of people) {
        if (!rng.chance(VOL.AI.hurt)) continue;
        hurt(state, s, rng.int(VOL.AI.dmg[0], VOL.AI.dmg[1]), null, `fighting beside ${f.name} (${loan.label})`);
        if (s.alive) hurtNames.push(first(s)); else { deadNames.push(first(s)); loan.dead.push(s.name); V.stats.lentDied++; }
      }
      // The share of the fight: from the group's stores, by the people still with them.
      const live = people.filter((s) => s.alive).length;
      loan.share = loan.share || {};
      for (const [k, q] of Object.entries(VOL.AI.share)) { const got = Math.min(Math.max(0, Math.floor(f.stock[k] || 0)), q * live); if (got > 0) { f.stock[k] -= got; loan.share[k] = (loan.share[k] || 0) + got; } }
      log(state, `Your people with ${f.name} fought in ${loan.label}${hurtNames.length ? `: ${listNames(hurtNames)} hurt` : ""}${deadNames.length ? `${hurtNames.length ? ";" : ":"} ${listNames(deadNames)} killed` : ""}${!hurtNames.length && !deadNames.length ? ", unhurt" : ""}.`, deadNames.length ? "death" : "info");
    }
    if (d >= loan.until) endLoan(state, loan, people.filter((s) => s.alive), "");
  }
}
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
  if (base && loan.share) for (const [k, q] of Object.entries(loan.share)) if (q > 0) { base.stock[k] = (base.stock[k] || 0) + q; got.push(`${q} ${k}`); }
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
    if (from && from.alive) from.pop += L.n - lost;
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
      marginal = power / Math.max(0.1, est.strength) < S.hive;
    } else {
      const f = state.factions.find((x) => x.alive && x.bases.includes(p.dest));
      if (!f) continue;
      marginal = teamAssaultOdds(state, p, assaultForce(state, f, p.dest, p)) < S.assault;
    }
    p.volAsked = day(state);
    if (!marginal) continue;
    const offer = S.offer && h && (h.stock.food || 0) >= 80 ? { key: "food", qty: 20 } : null;
    const cands = state.factions.filter((f) => f.alive && f.known && !groupProblem(state, f));
    let best = null;
    for (const n of [2, 1]) {
      for (const f of cands) {
        const q = askQuote(state, f, p, { n, days: VOL.SPAN.def, offer });
        if (!q.refuse && q.yes && (!best || q.points > best.q.points)) best = { f, q, n };
      }
      if (best) break;
    }
    if (best) askVolunteers(state, best.f, p, { n: best.n, days: VOL.SPAN.def, offer });
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
<b>With your team.</b> Volunteers are real people, armed and armoured from their group's arsenal. They walk from their base to the team and join it wherever it is, bringing a day's food and water a day of the span (up to ${VOL.BRING.days}) and rounds for their guns. They carry, eat the team's food, count in every fight by the numbers and go into a hive crawl with the team (a coalition member that sent volunteers does not also thin the brood from outside). They go home when the span runs out (never in the middle of a fight or a crawl), when the team comes home or is disbanded, when none of your people is left with them, or when their group's goodwill falls below ${VOL.GW_LEAVE}. They keep what they carry; what came from their arsenal goes back.<br>
<b>In a battle</b> they fight on your side in their own colour (a violet ring and a VOL tag) but take <b>no orders</b>: their group's AI moves them at the end of your turn. They keep near your people and hold their fire while nobody has noticed you, then take cover, shoot, reload, and tend and drag the downed. They follow the Evac and the retreat, and leave when your people are all out; with your people down and nobody out, they fight on.<br>
<b>When they die.</b> One who falls in a fight costs ${-VOL.DEATH.fight} goodwill (they knew the risk; the group mourns), one who dies any other way (hunger, thirst, the worm) ${-VOL.DEATH.other}. Home safe after fighting beside you: +${VOL.BACK} each. The group remembers its dead when you ask again.<br>
<b>When they ask you.</b> A group at war, with a horde near its base or a hive crawl coming may call on the radio for 1–3 of your people for a few days: send the fittest, choose who, or decline (−${VOL.AI.decline} goodwill, three times that if you owe them a favour). Your people are then <b>with them</b> (the roster says so) and out of your orders: their strength adds to the group's, each day their fight may come, and anyone may be hurt or killed. They come back at the end with a share of what was taken and the group's thanks. Groups lend each other fighters the same way.`;
