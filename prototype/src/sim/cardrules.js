// Pause rules for event cards (ui/pacing.js uses these in the browser): what kind of moment each card is, which
// cards can wait in the tray while the clock runs, the answer a card takes by itself when it is left too long, and
// whether a card that waited is still about something that exists. Pure simulation data, no DOM; headless tools
// never call it (their cards are answered at once, as before), so it changes nothing in a census.
//
// Kinds (the Options → "Pause for…" switches; `always` cannot be switched off):
//   combat   a fight is offered or forced: conflicts, a horde in the team's path, hostile strangers, a hive
//   raid     a raid or a horde at a base: warnings of raiders on the way, raid and siege reports, a base lost
//   death    someone died (the leader card, a captive killed, a killing in a breakdown, a team lost)
//   contact  first contact with a group (ui/pacing.js pauses when a group becomes known; hardcore's band on the road)
//   hostile  a hostile act or a war: war calls, calls for help, a group's attack on a city
//   horde    a horde sighted near a base: "Horde heading for …" (and the map alerts, ui/pacing.js)
//   trade    trade visitors: caravans, radio offers, traders and travellers at the gate
//   orders   a team waiting for orders: Orders / Done / plan cards, a city crawl's offer
//   other    the rest: road events, hub events, recruits, perk points, morale, illness, crashes, jobs, reports
//   always   cannot wait: a card over a battle, a card whose only answers need the map, the run's opening blurb
import { cardStale, onTheMove, partySpeed } from "./parties.js";
import { log } from "./world.js";

// In-game hours a card waits in the tray before it takes its default answer. At 1× an hour is 20 seconds, so this
// is 2 minutes 40 seconds of real time (32 seconds at 5×).
export const TRAY_HOURS = 8;

// The switches in Options → Pause for…, in the order shown, with their defaults (the big moments on, the routine
// road and hub cards off).
export const PAUSE_KINDS = [
  { key: "combat", label: "Combat and engagements", icon: "⚔", def: true, tip: "A fight is offered or forced on a team: a group's ambush, roadblock or patrol, a horde in its path, armed strangers, a hive" },
  { key: "raid", label: "A raid or horde at a base", icon: "🛡", def: true, tip: "Raiders on their way to a base, a raid or siege report, a base lost" },
  { key: "death", label: "A death", icon: "✝", def: true, tip: "One of your people dies (the clock stops even when no card comes with it), the leader is dead, a team is lost" },
  { key: "contact", label: "First contact with a group", icon: "🤝", def: true, tip: "The first time you learn who a group is (the clock stops; any card that came with it waits as usual)" },
  { key: "hostile", label: "A hostile act or war", icon: "☠", def: true, tip: "A group turns hostile, asks you to join its war or calls for help" },
  { key: "horde", label: "A horde sighted near a base", icon: "🧟", def: true, tip: "A horde heading for a base, or a new horde or break-in alert near one" },
  { key: "trade", label: "Trade visitors", icon: "🐎", def: false, tip: "Trade caravans, radio offers, traders and travellers at the gate" },
  { key: "orders", label: "Team orders needed", icon: "❗", def: true, tip: "A team is waiting for orders: Orders and Done cards, plan check-ins, a city at the team's feet" },
  { key: "other", label: "Other cards", icon: "🃏", def: false, tip: "Road events, hub events, people asking to join, perk points, morale, illness, crashes, job offers and reports" },
];
export const KIND_BY_KEY = Object.fromEntries(PAUSE_KINDS.map((k) => [k.key, k]));
export const DEFAULT_PAUSE = Object.fromEntries(PAUSE_KINDS.map((k) => [k.key, k.def]));

// ---------- the kind of a card ----------
const DEATH_RE = /^(The leader is dead$|.+ is dead$|.+ killed .+|.+ rose$)/;
const RAID_RE = /^(Raiders heading for |Outsider raiders heading for |Heard on the radio: .+ are coming for |Raid on |Raid defense$|The horde is beaten$|Pulled out$|Overrun$|.+ driven off$|.+ has fallen$|.+ burned$|The caravan raid$|.+ come for their people$|Soldiers at the gate$|Evacuees from the base$)/;
const HORDE_RE = /^Horde heading for /;
const HOSTILE_RE = /^(.+ asks you to join their war$|.+ asks for help$|A call for help|.+ goes on the attack$|The strike on .+ has failed$)/;
const COMBAT_RE = /^(Horde of \d|A horde of \d|Raiders ahead|Raiders from outside|Robbers on the road|Strangers ahead|Armed strangers|A robbery$|Squatters with guns$|A military squad$|Soldiers (in|fighting)|Assault: |Rescue at |Held at |After the fight$|The fight with |The hive: |Hive growth: |.+ fighters lay down their arms$)/;
const TRADE_RE = /^(Trade caravan at |Traders on |On the radio: |A peddler at the gate$|Travellers at |Travellers from outside: )/;

// Choices the player can take without the map (a choice that opens a screen or asks for a tile cannot be auto-picked).
export const choiceOff = (state, c) => !c || (typeof c.disabled === "function" ? !!c.disabled(state) : !!c.disabled);
export const usableChoices = (state, card) => (card.choices || []).filter((c) => c && !c.uiAction && !choiceOff(state, c));

// The card's kind (one of PAUSE_KINDS' keys, or "always"). Worked out once when the card arrives.
export function cardKind(state, card) {
  const t = String(card.title || "");
  if (card.battle) return "always"; // raised over a fight (floorfolk.js): it shows during the battle
  if (card.intro) return "always"; // the run's opening blurb (hardcore-start.js introCard): it shows whatever the pause rules
  if (!defaultChoice(state, card)) return "always"; // every answer needs the map, is greyed out or is a fight
  if (card.isOrders || card.planCard) return card.quietArrival ? "other" : "orders"; // a plain move's arrival out of contact waits in the tray (parties.js quietArrival)
  if (DEATH_RE.test(t) || (/^The fight with /.test(t) && /whole team was lost/.test(card.text || ""))) return "death";
  if (card.raidReport || card.lostBase != null || card.radioRaid != null || RAID_RE.test(t)) return "raid";
  if (HORDE_RE.test(t) || card.hiveSite != null) return "horde"; // hivebirth.js: "The dead are massing near …"
  if (card.allianceAsk == null && HOSTILE_RE.test(t)) return "hostile";
  if (card.kind === "conflict" || card.gathering != null || (card.choices || []).some((c) => c && c.fight) || COMBAT_RE.test(t)) return "combat";
  if (card.hcBand != null) return "contact"; // hardcore: a band met on the road (hardcore-groups.js)
  if (card.isCaravan || card.radioFrom != null || TRADE_RE.test(t)) return "trade";
  return "other";
}

// The icon a tray chip shows: the kind's, or for the "other" cards what they are about.
export function cardIcon(card, kind) {
  if (kind && kind !== "other" && KIND_BY_KEY[kind]) return KIND_BY_KEY[kind].icon;
  if (card.recruit) return "🙋";
  if (card.perkFor) return "⭐";
  if (card.hubEvent) return "🏠";
  if (card.moraleFor != null || card.breakFor != null || card.snapFor != null) return "💬";
  if (card.outbreakBase != null) return "🦠";
  if (card.crashId != null) return "✈";
  if (card.convoyId != null) return "🪖"; // miltrucks.js: an abandoned Army convoy
  if (card.jobId != null || card.allianceAsk != null) return "📜";
  if (card.partyId != null) return "🚶";
  return "🃏";
}

// ---------- the default answer ----------
// The answer a card left in the tray takes by itself: a choice marked `default: true`, else the first choice whose
// label says "do nothing" (OK, Hold here, Leave it, Not now, Decide later…), then one that steps back from trouble
// (Return home, Pay the toll…), then the first that is not a gamble (no fight, no odds in its label or hint, no
// risky word), then the first that is not a fight. Never a disabled choice, one that needs the map or a fight: a
// card with nothing else cannot wait (null).
const SAFE_STEPS = [
  /^(OK$|Noted$|Note it$|Hold here$|Hold as you are$|Stop and wait for orders$|Decide later|Not now$|Not this time$|Maybe later$|Later\b|Leave (it|them|for)|Let (them|it) (be|go)\b|No, thank|No time for it$|Nothing to spare$|Ignore|Mark it|Keep your distance$|Stay out of it$|Watch from cover$|Back off$|Back away$|Go on your way$|Move on$|Good luck to them$|Refuse$|Send them (on|away)|Turn .+ away$)/i,
  /^(Shelter and wait|Go the long way|Wait|Lie low|Hide and let|Return home|Continue home|Come home|Go on to |Carry on$|Let them sort it out$|Hope it passes|Pay |Hand over|Give .+ supplies and part ways)/i,
];
const RISKY = /\b(fight|attack|rob|storm|charge|ambush|kill|execute|shoot|assault|raid|steal|firebomb|push through|keep moving|outrun|run for it|floor it|noisy|takedown|blow)\b|%/i;
const risky = (c) => !!c.fight || RISKY.test(String(c.label || "")) || RISKY.test(String(typeof c.hint === "string" ? c.hint : ""));

export function defaultChoice(state, card) {
  const opts = usableChoices(state, card);
  if (!opts.length) return null;
  const marked = opts.find((c) => c.default);
  if (marked) return marked;
  if (card.isOrders) { const hold = opts.find((c) => /^Hold here$/.test(c.label)); if (hold) return hold; }
  for (const re of SAFE_STEPS) {
    const c = opts.find((x) => re.test(String(x.label || "")) && !x.fight);
    if (c) return c;
  }
  return opts.find((c) => !risky(c)) || opts.find((c) => !c.fight) || null;
}

// ---------- still about something that exists? ----------
// Why a card that waited is out of date ("" when it is not): its team, person, group, visitor, base or job is gone.
export function trayStale(state, card) {
  if (card.partyId != null && cardStale(state, card)) return "the team is gone";
  const dead = (id) => { const s = (state.survivors || []).find((x) => x.id === id); return !s || !s.alive; };
  for (const k of ["moraleFor", "snapFor", "breakFor"]) if (card[k] != null && dead(card[k])) return "the person is gone";
  const fGone = (id) => { const f = (state.factions || []).find((x) => x.id === id); return !f || f.alive === false; };
  if (card.radioFrom != null && fGone(card.radioFrom)) return "the group is gone";
  if (card.allianceAsk != null && fGone(card.allianceAsk)) return "the group is gone";
  if (card.volAsk != null && !(state.vols && state.vols.asks.some((a) => a.id === card.volAsk))) return "they no longer ask"; // volunteers.js
  if (card.volWatch != null && !(state.vols && state.vols.loans.some((l) => l.id === card.volWatch))) return "your people are home"; // volunteers.js: the fight you could watch
  if (card.volVet != null && !(state.factions || []).some((f) => (f.volVets || []).some((v) => v.s && v.s.id === card.volVet && !v.out))) return "they are not there to ask"; // volunteers.js: an old hand asking to join
  if (card.visitorId != null && !(state.visitors || []).some((v) => v.id === card.visitorId)) return "they have gone";
  const bGone = (id) => !(state.bases || []).some((b) => b.id === id);
  if (card.outbreakBase != null && bGone(card.outbreakBase)) return "the base is gone";
  if (card.festivalBase != null && bGone(card.festivalBase)) return "the base is gone"; // festival.js
  if (card.raidReport && card.raidReport.baseId != null && bGone(card.raidReport.baseId)) return "the base is gone";
  if (card.recruit && card.recruit.baseId != null && card.recruit.partyId == null && bGone(card.recruit.baseId)) return "the base is gone";
  if (card.jobId != null && state.jobs && Array.isArray(state.jobs.list) && !state.jobs.list.some((j) => j.id === card.jobId)) return "the job is gone";
  return "";
}

// Drops a card that waited (out of date, or nothing it can take) with a log line. Returns true if it was dropped.
export function dropCard(state, card, why) {
  const i = state.cards.indexOf(card);
  if (i < 0) return false;
  state.cards.splice(i, 1);
  log(state, `"${card.title}"${card.where ? ` (${card.where})` : ""} was left unanswered and no longer applies: ${why}.`, "info");
  return true;
}

// Answers a card with its default choice (it waited TRAY_HOURS in the tray). A card out of date is dropped instead;
// an error in its choice drops it too (one line in the console), so a card can never stop the game.
// Returns the line written to the log, or "".
export function autoAnswer(state, card) {
  const i = state.cards.indexOf(card);
  if (i < 0) return "";
  const why = trayStale(state, card);
  if (why) { dropCard(state, card, why); return ""; }
  const c = defaultChoice(state, card);
  if (!c) { dropCard(state, card, "it had no answer to take by itself"); return ""; }
  state.cards.splice(i, 1);
  let text = "";
  try {
    text = String(c.resolve(state) || "");
  } catch (e) {
    if (typeof console !== "undefined") console.error("Broken State: a tray card's default answer failed", e);
    text = "";
  }
  if (Array.isArray(state.cards)) for (let j = state.cards.length - 1; j >= 0; j--) if (state.cards[j].partyId != null && cardStale(state, state.cards[j])) state.cards.splice(j, 1);
  const where = card.where ? ` (${card.where})` : "";
  const line = `Left unanswered for ${TRAY_HOURS} hours, "${card.title}"${where} took its default: ${c.label}.${text ? ` ${text}` : ""}`;
  log(state, line, "info");
  return line;
}

// A team whose card waits in the tray holds where it is (the event happened there): one hour of its progress is
// taken back before the hour runs, so it does not move on; it still eats and drinks. Teams resting, working or
// waiting are left alone.
export function holdTeam(state, card) {
  if (card.partyId == null) return false;
  const p = state.parties.find((x) => x.id === card.partyId);
  if (!p || p.owner !== "player" || !onTheMove(p)) return false;
  p.progress = (p.progress || 0) - partySpeed(p);
  return true;
}
