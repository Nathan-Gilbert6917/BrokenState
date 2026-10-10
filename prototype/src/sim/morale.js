// Morale at a base: crowding (scaled by how far over its beds a base is), the leader's lift (capped below the
// crowding penalty), warnings before desertion (a log line and a card), and desertion itself (the deserter keeps
// what they carry and may take a few supplies; some come back later, recruits.js).
//
// Daily mood at a base (economy.js baseDaily calls baseMoraleDaily once per base):
//   - beds: +1 when everyone has a bed; crowded: -(2 + 8 × over) a day, up to -16, where over = (people - beds) / beds
//     (11 in 10 beds: -2.8; 15 in 10: -6; 20 in 10: -10);
//   - leader at the base: +0.15 × Leadership, but while the base is crowded at most half the crowding penalty, so a
//     good leader softens crowding and never cancels it;
//   - warnings: below 30 mood "X talks about leaving" (log line, and a card for the worst case at that base each
//     day), below 20 "X is close to leaving" (log line and card); a warning is re-armed once mood is back to 40;
//   - desertion: below 15 mood, only after the second warning was given on an earlier night, 8% a day (+0.6% per
//     point below 15). Leaders never desert.
import { keyWord } from "./water.js";
import { breakMult } from "./traits.js"; // Iron Will
import { log, addCard, day, skill, atBase, residents, checkGameOver } from "./world.js";
import { baseBeds } from "./buildings.js";
import { allItems } from "./inventory.js";
import { onLeave, noteMood } from "./relations.js";
import { buzzWork } from "./comforts.js";
import { needsWork } from "./needs.js";
import { nearSnap } from "./mentalbreaks.js";
import { totalRounds, spendAmmo } from "./rounds.js"; // rounds by calibre
import { talkXp } from "./skills.js";

export const CROWD = { base: 2, perOver: 8, cap: 16, leaderShare: 0.5, roomy: 1 };
export const LEADER_LIFT = 0.15; // mood a day per point of the leader's Leadership
export const MOOD = { warn1: 30, warn2: 20, desert: 15, rearm: 40, chance: 0.08, perPoint: 0.006 };
export const GIFT = { food: 4, meds: 1 }; // "a gift from the stores" on a warning card
export const GIFT_MOOD = 20, GIFT_MOOD_GREEDY = 30, REST_DAYS = 3, REST_NOW = 5, TALK_OK = 25, TALK_FAIL = 5;

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const firstName = (s) => s.name.split(" ")[0];
const r1 = (v) => Math.round(v * 10) / 10;

// How full a base is: people living there per bed (1 = every bed taken, 2 = twice as many people as beds).
// health.js (illness spread) can read this.
export function crowding(state, base) {
  return residents(state, base.id).length / Math.max(1, baseBeds(base));
}

export function crowdLevel(ratio) {
  if (ratio <= 0.85) return { key: "roomy", name: "Room to spare", tone: "good" };
  if (ratio <= 1) return { key: "full", name: "Full", tone: "good" };
  if (ratio <= 1.25) return { key: "crowded", name: "Crowded", tone: "warn" };
  if (ratio <= 1.6) return { key: "overcrowded", name: "Overcrowded", tone: "danger" };
  if (ratio <= 2) return { key: "packed", name: "Packed", tone: "danger" };
  return { key: "crisis", name: "Crisis", tone: "danger" };
}

// Mood a day from beds and the leader at a base (people = how many live there; default: the residents now).
export function crowdInfo(state, base, people = residents(state, base.id).length) {
  const beds = baseBeds(base);
  const over = Math.max(0, people - beds) / Math.max(1, beds);
  const penalty = over > 0 ? Math.min(CROWD.cap, CROWD.base + CROWD.perOver * over) : 0;
  // The group's leader where they live; elsewhere the base's own leader while at the base (steward.js leaderId).
  const here = atBase(state, base.id);
  const leader = here.find((s) => s.leader && s.alive) || (base.steward && base.steward.leaderId != null ? here.find((s) => s.id === base.steward.leaderId && s.alive) : null) || null;
  const rawLift = leader ? skill(leader, "leadership") * LEADER_LIFT : 0;
  const lift = penalty > 0 ? Math.min(rawLift, penalty * CROWD.leaderShare) : rawLift;
  const net = (penalty > 0 ? -penalty : CROWD.roomy) + lift;
  const ratio = people / Math.max(1, beds);
  return { people, beds, over, ratio, penalty: r1(penalty), rawLift: r1(rawLift), lift: r1(lift), net: r1(net), leader, level: crowdLevel(ratio) };
}

// Mood and work (suggestions #4): how much of a normal day's work someone does at this mood, before illness
// (health.js workFactor multiplies the two). Points between are straight lines: 0 → 70%, 20 → 80%, 45 → 100%,
// 80 → 100%, 100 → 110%. Grieving costs up to 20% more (relations.js: 20% × bond), and on a break (relations.js)
// they do nothing that day. Builders, crafters, farmers, station operators, medics and base scavengers all use it.
export const MOOD_WORK = [[0, 0.7], [20, 0.8], [45, 1], [80, 1], [100, 1.1]];
export function moodCurve(mood) {
  const m = clamp(Number.isFinite(mood) ? mood : 60, 0, 100);
  for (let i = 1; i < MOOD_WORK.length; i++) {
    const [x1, y1] = MOOD_WORK[i], [x0, y0] = MOOD_WORK[i - 1];
    if (m <= x1) return y0 + ((y1 - y0) * (m - x0)) / (x1 - x0);
  }
  return MOOD_WORK[MOOD_WORK.length - 1][1];
}
export function moodWork(s) {
  if (!s || s.mood == null) return 1;
  if (s.onBreak) return 0;
  const grief = s.grief ? 1 - 0.2 * Math.min(1, s.grief.bond || 0) : 1;
  const late = s.expecting && s.expecting.late ? 0.85 : 1; // family.js FAMILY.lateWork: the last weeks of a pregnancy
  return Math.round(moodCurve(s.mood) * grief * late * buzzWork(s) * needsWork(s) * 1000) / 1000; // a coffee buzz or a hangover (comforts.js); hunger and thirst below 50 (needs.js)
}

// What the People tab shows next to someone's mood.
export function moodRisk(s) {
  if (!s || !s.alive) return null;
  const w = s.moodWarn || 0;
  if (nearSnap(s)) return { level: 3, text: "May break down", tone: "danger" }; // mentalbreaks.js: days at rock bottom
  if (s.mood < MOOD.desert && w >= 2) return { level: 3, text: "May walk out any night", tone: "danger" };
  if (s.mood < MOOD.warn2 || w >= 2) return { level: 2, text: "Close to leaving", tone: "danger" };
  if (s.mood < MOOD.warn1 || w >= 1) return { level: 1, text: "Talks about leaving", tone: "warn" };
  if (s.mood < MOOD.rearm) return { level: 0, text: "Unhappy", tone: "muted" };
  return null;
}
export const MOOD_RISK_TIP = `Below ${MOOD.warn1} mood someone talks about leaving (first warning), below ${MOOD.warn2} they are close to it (second warning), and below ${MOOD.desert} they may walk out any night once the second warning has been given. Under 10 mood for 3 days running, at home or on the road, they may break down: run off, go for someone, take their own life, set a fire, wreck the stores, walk out into the dead or shut down for days. Rest, a bed, food, a good leader and room to sleep lift mood; crowding, short rations, hunger and thirst lower it.`;

// The person best placed to talk someone round: the leader if they are at that base, else the best Speech there.
export function talker(state, base, s) {
  const here = atBase(state, base.id).filter((o) => o !== s && o.alive);
  const leader = here.find((o) => o.leader);
  const best = here.sort((a, b) => skill(b, "speech") - skill(a, "speech"))[0] || null;
  const score = (o) => (o ? (o.leader ? Math.max(skill(o, "speech"), skill(o, "leadership")) : skill(o, "speech")) : 0);
  const who = leader && (!best || score(leader) >= score(best)) ? leader : best;
  return { who, score: score(who), chance: who ? clamp(0.3 + 0.035 * score(who), 0.3, 0.95) : 0 };
}

// ---------- daily ----------
export function baseMoraleDaily(state, base, people, mouths) {
  const d = day(state);
  const ci = crowdInfo(state, base, mouths.length);
  for (const s of mouths) s.mood = clamp(s.mood + ci.net, 0, 100);
  // A few days' rest given on a warning card: back to their old role afterwards (if still resting).
  for (const s of people) {
    if (s.restUntil != null && d >= s.restUntil) {
      if (s.role === "rest" && s.restPrev) s.role = s.restPrev;
      delete s.restUntil;
      delete s.restPrev;
    }
  }
  // Warnings before desertion. warnNights: nights since the second warning (desertion needs at least one).
  const warned = [];
  for (const s of people) {
    if (!s.alive || s.leader) continue;
    if ((s.moodWarn || 0) >= 2) s.warnNights = (s.warnNights || 0) + 1;
    if (s.mood >= MOOD.rearm) { s.moodWarn = 0; continue; }
    if ((s.moodWarn || 0) >= 2 && s.mood >= MOOD.warn1) s.moodWarn = 1; // eased off, but not over it
    if (s.mood < MOOD.warn2 && (s.moodWarn || 0) < 2) {
      s.moodWarn = 2;
      s.moodWarnDay = d;
      s.warnNights = 0;
      log(state, `${s.name} is close to leaving ${base.name} (mood ${Math.round(s.mood)}): they have started packing a bag.`, "danger");
      warned.push(s);
    } else if (s.mood < MOOD.warn1 && !(s.moodWarn > 0)) {
      s.moodWarn = 1;
      s.moodWarnDay = d;
      log(state, `${s.name} talks about leaving ${base.name} (mood ${Math.round(s.mood)}).`, "danger");
      warned.push(s);
    }
  }
  // One card a day per base: the worst case among those just warned (others are in the log).
  const open = (s) => state.cards.some((c) => c.moraleFor === s.id);
  const pick = warned.filter((s) => !open(s)).sort((a, b) => (b.moodWarn - a.moodWarn) || (a.mood - b.mood))[0];
  if (pick) addCard(state, warningCard(state, base, pick));
  // Desertion.
  const rng = state.rng;
  for (const s of people) {
    if (!s.alive || s.leader || s.mood >= MOOD.desert) continue;
    if ((s.moodWarn || 0) < 2 || !((s.warnNights || 0) >= 1)) continue;
    if (rng.chance((MOOD.chance + MOOD.perPoint * (MOOD.desert - s.mood)) * breakMult(s))) desert(state, base, s); // Iron Will (traits.js): half as likely
  }
}

// ---------- desertion ----------
// What a deserter takes from the base's stock besides everything they carry: a few days' food and water, maybe meds
// and ammo; Greedy takes twice as much (and is likelier to take meds and ammo), a Coward half the food and water.
// Never more than a quarter of what the base has of any one supply.
export function desertionHaul(state, base, s) {
  const rng = state.rng;
  const greedy = s.traits.includes("greedy");
  const mult = greedy ? 2 : s.traits.includes("coward") ? 0.5 : 1;
  const want = { food: Math.round(rng.int(2, 4) * mult), water: Math.round(rng.int(2, 3) * mult) };
  if (rng.chance(greedy ? 0.8 : 0.4)) want.meds = rng.int(1, 2) * (greedy ? 2 : 1);
  if (rng.chance(greedy ? 0.8 : 0.4)) want.ammo = rng.int(5, 12) * (greedy ? 2 : 1);
  const took = {};
  for (const [k, q] of Object.entries(want)) {
    const n = Math.min(q, Math.floor(Math.max(0, k === "ammo" ? totalRounds(base.stock) : base.stock[k] || 0) * 0.25));
    if (n > 0 && k === "ammo") Object.assign(took, spendAmmo(base.stock, n).keys); // rounds.js: any calibre, the cheapest first (by key: named where it is told)
    else if (n > 0) { base.stock[k] -= n; took[k] = n; }
  }
  return took;
}

const itemText = (g) => (g.contents && g.contents.some(Boolean) ? `${g.name} (with ${g.contents.filter(Boolean).map((x) => x.name).join(", ")})` : g.name);
const listText = (parts) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`);

// opts.why: the log line's first half (a mental break, being cast out: mentalbreaks.js); opts.haul false: nothing from
// the stores.
export function desert(state, base, s, opts = {}) {
  s.alive = false;
  s.left = true;
  s.station = null;
  s.inBed = false;
  const items = allItems(s).map(itemText);
  const took = opts.haul === false ? {} : desertionHaul(state, base, s);
  const parts = [...items, ...Object.entries(took).map(([k, q]) => `${q} ${keyWord(k)}`)]; // rounds named by calibre
  log(state, `${opts.why || `${s.name} lost hope and walked away from ${base.name} in the night`}${parts.length ? `, taking ${listText(parts)}` : " with nothing but the clothes on their back"}.`, "death");
  (state.deserters || (state.deserters = [])).push({ id: s.id, baseId: base.id, day: day(state), took });
  onLeave(state, s, base); // relations.js: friends and a partner take it hard
  for (let i = state.cards.length - 1; i >= 0; i--) if (state.cards[i].moraleFor === s.id) state.cards.splice(i, 1);
  checkGameOver(state);
  return { items, took };
}

// ---------- the warning card ----------
function warningCard(state, base, s) {
  const second = (s.moodWarn || 0) >= 2;
  const t = talker(state, base, s);
  const name = firstName(s);
  const why = [];
  const ci = crowdInfo(state, base);
  if (ci.penalty > 0) why.push(`${base.name} is ${ci.level.name.toLowerCase()} (${ci.people} people in ${ci.beds} beds)`);
  if (base.rationing) why.push("everyone is on short rations");
  if (base.hungerDays) why.push("there is no food");
  if (base.thirstDays) why.push("the water has run out");
  const greedy = s.traits.includes("greedy");
  const live = () => s.alive && s.location.kind === "base" && s.location.baseId === base.id;
  const gone = () => `${s.name} is no longer at ${base.name}.`;
  // Lifted back over a threshold: the warnings re-arm (the daily check does the same).
  const reset = () => { if (s.mood >= MOOD.rearm) s.moodWarn = 0; else if (s.mood >= MOOD.warn1 && s.moodWarn >= 2) s.moodWarn = 1; };
  const has = () => Object.entries(GIFT).every(([k, q]) => (base.stock[k] || 0) >= q);
  return {
    title: second ? `${s.name} is close to leaving` : `${s.name} talks about leaving`,
    text: `${s.name} (mood ${Math.round(s.mood)}) ${second ? `has started packing a bag. Below ${MOOD.desert} mood they may walk out any night, taking what they carry and some supplies.` : `talks about leaving ${base.name}.`}${why.length ? ` On their mind: ${why.join("; ")}.` : ""}`,
    moraleFor: s.id,
    choices: [
      {
        label: t.who ? `Talk to them (${firstName(t.who)}, ${t.who.leader ? "leader" : "Speech"} ${t.score})` : "Talk to them",
        hint: t.who ? `${Math.round(t.chance * 100)}% to get through: mood +${TALK_OK} (else +${TALK_FAIL})` : "Nobody else is here to talk to them",
        disabled: () => !t.who,
        ai: () => t.chance * TALK_OK + 2,
        resolve: (st) => {
          if (!live()) return gone();
          const tt = t.who && t.who.alive && t.who.location.kind === "base" && t.who.location.baseId === base.id ? t : talker(st, base, s);
          if (!tt.who) return `Nobody is left at ${base.name} to talk to ${name}.`;
          const ok = st.rng.chance(tt.chance);
          talkXp(st, tt.who, ok); // skills.js: Speech for the talker
          s.mood = clamp(s.mood + (ok ? TALK_OK : TALK_FAIL), 0, 100);
          noteMood(st, s, ok ? TALK_OK : TALK_FAIL, `Talked to by ${firstName(tt.who)}`);
          reset();
          return ok ? `${firstName(tt.who)} sits up half the night with ${name}. They agree to stay (mood ${Math.round(s.mood)}).` : `${firstName(tt.who)} tries, but ${name} only shrugs (mood ${Math.round(s.mood)}).`;
        },
      },
      {
        label: `Give them ${REST_DAYS} days' rest`,
        hint: `Off work for ${REST_DAYS} days (the Rest role: +6 mood a day), +${REST_NOW} now; then back to their role`,
        ai: () => 16,
        resolve: (st) => {
          if (!live()) return gone();
          if (s.role !== "rest") s.restPrev = s.role;
          s.role = "rest";
          s.station = null;
          s.restUntil = day(st) + REST_DAYS;
          s.mood = clamp(s.mood + REST_NOW, 0, 100);
          noteMood(st, s, REST_NOW, "Given time off");
          reset();
          return `${name} takes ${REST_DAYS} days off.`;
        },
      },
      {
        label: `A gift from the stores (${GIFT.food} food, ${GIFT.meds} meds)`,
        hint: `Mood +${greedy ? GIFT_MOOD_GREEDY : GIFT_MOOD}${greedy ? " (Greedy: a gift goes a long way)" : ""}`,
        disabled: (st) => !has(st),
        ai: () => ((base.stock.food || 0) >= 40 && (base.stock.meds || 0) >= 6 ? 22 : -1),
        resolve: (st) => {
          if (!live()) return gone();
          if (!has(st)) return `${base.name} no longer has that to give.`;
          for (const [k, q] of Object.entries(GIFT)) base.stock[k] -= q;
          s.mood = clamp(s.mood + (greedy ? GIFT_MOOD_GREEDY : GIFT_MOOD), 0, 100);
          noteMood(st, s, greedy ? GIFT_MOOD_GREEDY : GIFT_MOOD, "A gift from the stores");
          reset();
          return `${name} takes the gift (mood ${Math.round(s.mood)}).`;
        },
      },
      { label: "Let them be", hint: "Nothing changes: they decide for themselves", ai: () => 0, resolve: () => (live() ? `You leave ${name} to think it over.` : gone()) },
    ],
  };
}
