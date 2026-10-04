// The Calder Coalition: allied groups you invite into an alliance, what members do for you, the seasonal council,
// and the alliance victory.
//
// Joining
// - A group can be invited (Groups tab or the radio panel) when it is alive, known, in radio reach (or one of your
//   teams is at its gates), not at war with a member, its goodwill toward you is 50+ and it has a pact with you,
//   and either you have done a job for it or the council votes it in (with members, each member votes yes when its
//   relations with the group are 10+; a majority carries it).
// - A group that qualifies may also ask to join (3% a day): a card (Welcome them / Not now).
// - A member leaves when its goodwill falls below 20, its pact with you is gone, or it goes to war with another
//   member (then the one that started it is expelled).
//
// What members do
// - Share sightings: every day each member reports every horde within 12 tiles of its bases and every hive and
//   hive build site within 15 (they go on your map), and the land within 3 tiles of its bases.
// - Help against break-ins: a raid on one of your bases faces extra defenders from each member with a base within
//   20 tiles (strength × 0.15 each, up to half your own defence); a horde heading for your base is harried once on
//   the way by members within 20 tiles (it loses 15% for each, at most 30%).
// - Hive assaults: members with a base within 15 tiles of a hive you storm (and a group whose hive job you took)
//   send fighters: 1 per 10 people (1–3 each); every fighter keeps one of the brood off your squad (at most 40%
//   of the brood, at least 6 left) (hives.js assaultHive).
// - No member raids you or another member, and members do not go to war with each other.
//
// The council meets at the start of every season (days 15, 43, 71, ...) once you have a member. It asks one thing:
// supplies for a member that is short (send: +6 with them, +3 with the others; refuse: −4 with all), a job from a
// member (a job offer from the council: accept or refuse, −3 with all), or a ruling between two members who quarrel
// over land or water (side with one: +6 with it, −8 with the other and −10 between them; or a compromise: a Speech
// check of 25% + 4% a point + goodwill / 400; it works: +3 with both and +5 between them, it fails: −3 with both).
//
// Alliance victory: the coalition (you and its members) controls more than half of the state's land (land tiles
// within CONTROL_RANGE of one of your bases or a member's base), every group still alive is a member, and no hive
// stands or is being built (hives.js hivesSecured). world.js checkGameOver ends the run with the coalition's victory.
import { day, log, hub, factionById, addCard, atBase, skill, snapshot, alive } from "./world.js";
import { attitude, changeGoodwill, strength, baseDefense } from "./factions.js";
import { tileLabel, partyTile } from "./parties.js";
import { canRadioGroup, radioSpeech, radioDeal, dealQuote } from "./radio.js";
import { available, need } from "./trade.js";
import { hivesSecured, hiveStats } from "./hives.js";
import { reduceHorde } from "./hordes.js";
import { gainXp, USE } from "./skills.js";
import { diploRng, relation, changeRelation, warsOf, enemyIn, warBetween, autoWarTrade } from "./diplomacy.js";
import { jobsDoneFor, activeJobs, makeJob, offerCard as jobOfferCard, autoJobsDaily } from "./jobs.js";

export const ALLIANCE = {
  NAME: "The Calder Coalition", GOODWILL: 50, LEAVE_GOODWILL: 20, VOTE_REL: 10, ASK_CHANCE: 0.03,
  SHARE_HORDES: 12, SHARE_HIVES: 15, SHARE_LAND: 3, RAID_RANGE: 20, RAID_SHARE: 0.15, HORDE_CUT: 0.15,
  HIVE_RANGE: 15, CONTROL_RANGE: 6, LAND_NEEDED: 0.5, COUNCIL_EVERY: 28, COUNCIL_FIRST: 15,
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

export function ensureAlliance(state) {
  if (!state.alliance) state.alliance = { name: ALLIANCE.NAME, members: [], founded: null, joined: {}, history: [], lastAsk: {}, councils: 0, stats: { joined: 0, left: 0, councils: 0, granted: 0, refused: 0 } };
  return state.alliance;
}
export const isMember = (state, f) => !!f && !!state.alliance && state.alliance.members.includes(f.id);
export const allianceMembers = (state) => (state.alliance ? state.alliance.members.map((id) => factionById(state, id)).filter((f) => f && f.alive) : []);

// ---------- joining ----------
const reachable = (state, f) => canRadioGroup(state, f) || state.parties.some((p) => p.owner === "player" && f.bases.includes(partyTile(p)) && (p.phase === "waiting" || p.phase === "engaged"));
// The council's vote on a candidate: { yes, no, passes } (no members: no vote).
export function councilVote(state, f) {
  const ms = allianceMembers(state).filter((m) => m !== f);
  const yes = ms.filter((m) => relation(state, m, f) >= ALLIANCE.VOTE_REL).length;
  return { yes, no: ms.length - yes, passes: ms.length > 0 && yes * 2 > ms.length };
}
// Why this group cannot join now ("" = it can). Each condition, in the order the player meets them.
export function inviteProblem(state, f) {
  if (!f || !f.alive) return "They are gone.";
  if (isMember(state, f)) return `${f.name} is already in the coalition.`;
  if (!f.known) return "You have not met them.";
  if (!reachable(state, f)) return `${f.name} is out of radio reach (or send a team to their gates).`;
  if (attitude(f) === "Hostile") return `${f.name} is hostile.`;
  if (f.goodwill < ALLIANCE.GOODWILL) return `${f.name} needs goodwill ${ALLIANCE.GOODWILL} (now ${Math.round(f.goodwill)}).`;
  if (!f.pact) return `${f.name} needs a pact with you first.`;
  const foe = allianceMembers(state).find((m) => warBetween(state, m, f));
  if (foe) return `${f.name} is at war with ${foe.name}, a member.`;
  if (jobsDoneFor(state, f) < 1) {
    const v = councilVote(state, f);
    if (!v.passes) return v.yes + v.no ? `Do a job for ${f.name}, or win the council's vote (${v.yes} of ${v.yes + v.no} members would say yes).` : `Do a job for ${f.name} first.`;
  }
  return "";
}
export function inviteToAlliance(state, f) {
  const why = inviteProblem(state, f);
  if (why) return why;
  const A = ensureAlliance(state);
  A.members.push(f.id);
  A.joined[f.id] = day(state);
  if (A.founded == null) A.founded = day(state);
  A.stats.joined++;
  A.history.unshift({ day: day(state), text: `${f.name} joined.` });
  f.lastDiplomacy = day(state);
  changeGoodwill(state, f, 5, "they joined your coalition");
  for (const m of allianceMembers(state)) if (m !== f) changeRelation(state, m, f, 10);
  log(state, `${f.name} joined ${A.name}. ${A.members.length} member${A.members.length === 1 ? "" : "s"} now.`, "good");
  return `${f.name} joined ${A.name}.`;
}
function leave(state, f, why) {
  const A = ensureAlliance(state);
  A.members = A.members.filter((id) => id !== f.id);
  A.stats.left++;
  A.history.unshift({ day: day(state), text: `${f.name} left (${why}).` });
  if (f.alive) log(state, `${f.name} left ${A.name}: ${why}.`, "danger");
}
export function expel(state, f) {
  if (!isMember(state, f)) return "They are not a member.";
  leave(state, f, "you expelled them");
  changeGoodwill(state, f, -15, "you threw them out of the coalition");
  return `${f.name} is out of the coalition.`;
}

// ---------- daily ----------
export function allianceDaily(state) {
  const A = ensureAlliance(state);
  // Members who leave.
  for (const id of [...A.members]) {
    const f = factionById(state, id);
    if (!f || !f.alive) { A.members = A.members.filter((x) => x !== id); A.history.unshift({ day: day(state), text: `${f ? f.name : "A member"} is gone.` }); continue; }
    if (f.goodwill < ALLIANCE.LEAVE_GOODWILL) leave(state, f, "it no longer trusts you");
    else if (!f.pact) leave(state, f, "there is no pact with you any more");
    else if (allianceMembers(state).some((m) => m !== f && warsOf(state, f).some((w) => w.a === f.id && enemyIn(w, f) === m.id))) leave(state, f, "it attacked another member");
  }
  const ms = allianceMembers(state);
  shareSightings(state, ms);
  hordeHelp(state, ms);
  askToJoin(state);
  council(state, ms);
}

function shareSightings(state, ms) {
  if (!ms.length) return;
  const g = state.grid;
  const tiles = new Set();
  for (const f of ms) {
    for (const b of f.bases) for (const id of g.within(b, ALLIANCE.SHARE_LAND)) tiles.add(id);
    for (const h of state.hordes) if (f.bases.some((b) => g.distance(b, h.tile) <= ALLIANCE.SHARE_HORDES)) tiles.add(h.tile);
    for (const hv of state.hives || []) if (f.bases.some((b) => g.distance(b, hv.tile) <= ALLIANCE.SHARE_HIVES)) tiles.add(hv.tile);
    for (const s of state.hiveSites || []) if (f.bases.some((b) => g.distance(b, s.tile) <= ALLIANCE.SHARE_HIVES)) tiles.add(s.tile);
  }
  for (const id of tiles) {
    const cur = state.knowledge[id];
    if (cur && cur.hour >= state.hour) continue;
    const snap = snapshot(state, id);
    snap.via = "ally"; // a report, not your own eyes (jobs.js scout jobs do not count it)
    state.knowledge[id] = snap;
  }
}

// A horde on its way to one of your bases is harried once by members within 20 tiles.
function hordeHelp(state, ms) {
  if (!ms.length) return;
  const g = state.grid;
  for (const h of [...state.hordes]) {
    if (h.role !== "attack" || h.allyHarried || !h.goal || h.goal.baseId == null) continue;
    const base = state.bases.find((b) => b.id === h.goal.baseId);
    if (!base || g.distance(h.tile, base.tile) > 6) continue;
    const helpers = ms.filter((f) => f.bases.some((b) => g.distance(b, base.tile) <= ALLIANCE.RAID_RANGE));
    if (!helpers.length) continue;
    h.allyHarried = true;
    const cut = Math.round(h.size * Math.min(0.3, ALLIANCE.HORDE_CUT * helpers.length));
    const before = h.size;
    reduceHorde(state, h, cut);
    log(state, `${helpers.map((f) => f.name).join(" and ")} harried the horde heading for ${base.name}: ${cut} of the ${before} dead cut down on the way.`, "good");
  }
}

// factions.js resolveRaidOnPlayer: members with a base within 20 tiles send fighters.
export function allianceRaidHelp(state, base, attacker) {
  const ms = allianceMembers(state).filter((f) => f !== attacker && f.bases.some((b) => state.grid.distance(b, base.tile) <= ALLIANCE.RAID_RANGE));
  if (!ms.length) return { power: 0, names: [] };
  const own = baseDefense(state, base);
  const power = Math.min(Math.max(own, 10) * 0.5, ms.reduce((a, f) => a + strength(f) * ALLIANCE.RAID_SHARE, 0));
  return { power, names: ms.map((f) => f.name) };
}

// hives.js assaultHive: fighters from members near the hive and from a group whose hive job you took.
export function hiveAllies(state, hive) {
  const g = state.grid;
  const out = { fighters: 0, names: [] };
  const groups = new Set(allianceMembers(state).filter((f) => f.bases.some((b) => g.distance(b, hive.tile) <= ALLIANCE.HIVE_RANGE)));
  for (const j of activeJobs(state)) if (j.type === "hive" && j.data.hiveId === hive.id) { const f = factionById(state, j.fid); if (f && f.alive) groups.add(f); }
  for (const f of groups) {
    const n = clamp(Math.round(f.pop / 10), 1, 3);
    out.fighters += n;
    out.names.push(`${f.name} (${n})`);
  }
  return out;
}
// The brood the squad faces after the allies take their share (at most 40% off, at least 6 left).
export const broodAfterAllies = (count, fighters) => Math.max(Math.min(count, 6), count - Math.min(fighters, Math.floor(count * 0.4)));

// A group that qualifies asks to join.
function askToJoin(state) {
  const A = ensureAlliance(state);
  const rng = diploRng(state);
  for (const f of state.factions) {
    if (!f.alive || isMember(state, f) || inviteProblem(state, f)) continue;
    if (state.cards.some((c) => c.allianceAsk === f.id)) continue;
    if (A.lastAsk[f.id] != null && day(state) - A.lastAsk[f.id] < 20) continue;
    if (!rng.chance(ALLIANCE.ASK_CHANCE)) continue;
    A.lastAsk[f.id] = day(state);
    addCard(state, {
      title: `${f.name} asks to join the coalition`, allianceAsk: f.id,
      text: `${f.name} (${attitude(f).toLowerCase()}, goodwill ${Math.round(f.goodwill)}) want to join ${A.name}. Members share what they see, send fighters against raids and hordes coming for your bases, join your hive assaults, and sit in the seasonal council.`,
      choices: [
        { label: "Welcome them", hint: "They join the coalition", ai: () => 5, resolve: (st) => inviteToAlliance(st, f) },
        { label: "Not now", hint: "They may ask again in a few weeks", ai: () => 0, resolve: () => `You keep ${f.name} waiting.` },
      ],
    });
  }
}

// ---------- the council ----------
export const nextCouncilDay = (state) => { const d = day(state); const k = Math.max(0, Math.ceil((d - ALLIANCE.COUNCIL_FIRST) / ALLIANCE.COUNCIL_EVERY)); const n = ALLIANCE.COUNCIL_FIRST + k * ALLIANCE.COUNCIL_EVERY; return n < d ? n + ALLIANCE.COUNCIL_EVERY : n; };
function council(state, ms) {
  const d = day(state);
  if (!ms.length || d < ALLIANCE.COUNCIL_FIRST || (d - ALLIANCE.COUNCIL_FIRST) % ALLIANCE.COUNCIL_EVERY !== 0) return;
  const A = ensureAlliance(state);
  if (A.lastCouncil === d) return;
  A.lastCouncil = d;
  A.stats.councils++;
  const rng = diploRng(state);
  const kinds = ["supplies", "job"];
  if (ms.length >= 2) kinds.push("ruling", "ruling");
  for (let i = 0; i < 4; i++) {
    const card = councilCard(state, rng.pick(kinds), ms);
    if (card) { addCard(state, card); return; }
  }
  A.history.unshift({ day: d, text: "The council met. Nothing was asked of you." });
}

const everyone = (state, ms, n, why) => { for (const m of ms) changeGoodwill(state, m, n, why); };
export function councilCard(state, kind, ms = allianceMembers(state)) {
  const A = ensureAlliance(state);
  const rng = diploRng(state);
  const h = hub(state);
  if (kind === "supplies") {
    const opts = [];
    for (const f of ms) for (const k of ["food", "meds", "ammo", "fuel"]) if (need(f, k) >= 1.3) opts.push({ f, k });
    if (!opts.length) return null;
    const { f, k } = rng.pick(opts);
    const qty = { food: 30, meds: 8, ammo: 60, fuel: 10 }[k];
    const others = ms.filter((m) => m !== f);
    return {
      title: `The council: ${f.name} needs ${k}`, council: "supplies",
      text: `${A.name} meets for the season. ${f.name} is short of ${k} and the council asks you to send ${qty} ${k} from ${h.name}.`,
      choices: [
        { label: `Send ${qty} ${k}`, hint: `${h.name} has ${Math.floor(h.stock[k] || 0)}. +6 goodwill with ${f.name}, +3 with the other members`, disabled: (st) => (hub(st).stock[k] || 0) < qty,
          ai: (st) => ((hub(st).stock[k] || 0) >= qty * 3 ? 4 : -1), resolve: (st) => {
            if ((hub(st).stock[k] || 0) < qty) return `${h.name} no longer has ${qty} ${k}.`;
            hub(st).stock[k] -= qty; f.stock[k] = (f.stock[k] || 0) + qty;
            changeGoodwill(st, f, 6, "the council's request"); everyone(st, others, 3, "the council's request");
            A.stats.granted++; A.history.unshift({ day: day(st), text: `You sent ${qty} ${k} to ${f.name}.` });
            return `${qty} ${k} sent to ${f.name}.`;
          } },
        { label: "Refuse", hint: "−4 goodwill with every member", ai: () => 0, resolve: (st) => { everyone(st, ms, -4, "you refused the council"); A.stats.refused++; A.history.unshift({ day: day(st), text: `You refused to send ${k} to ${f.name}.` }); return "You refuse. The council is not pleased."; } },
      ],
    };
  }
  if (kind === "job") {
    for (const f of rng.shuffle([...ms])) {
      if (activeJobs(state).filter((j) => j.fid === f.id).length >= 2) continue;
      const job = makeJob(state, f, "council");
      if (!job) continue;
      const card = jobOfferCard(state, job);
      card.title = `The council: a job for ${f.name}`;
      card.council = "job";
      // Refusing the council costs more than refusing one group.
      const no = card.choices.find((c) => c.label === "Decline");
      if (no) {
        const base = no.resolve;
        no.hint = "−1 goodwill with them, −3 with every member";
        no.resolve = (st) => { const t = base(st); everyone(st, ms, -3, "you refused the council"); A.stats.refused++; return t; };
      }
      card.choices = card.choices.filter((c) => c.label !== "Maybe later");
      A.history.unshift({ day: day(state), text: `The council asked you to take a job for ${f.name}.` });
      return card;
    }
    return null;
  }
  if (kind === "ruling" && ms.length >= 2) {
    const [a, b] = rng.shuffle([...ms]).slice(0, 2);
    const what = rng.pick(["a stretch of farmland between them", "a well both claim", "salvage rights at a site between their bases", "a quarrel over stolen livestock"]);
    const speech = radioSpeech(state);
    const chance = clamp(0.25 + speech * 0.04 + (a.goodwill + b.goodwill) / 400, 0.05, 0.9);
    const side = (st, win, lose) => {
      changeGoodwill(st, win, 6, "your ruling"); changeGoodwill(st, lose, -8, "your ruling against them"); changeRelation(st, win, lose, -10);
      A.history.unshift({ day: day(st), text: `You ruled for ${win.name} against ${lose.name} (${what}).` });
      return `You ruled for ${win.name}. ${lose.name} will remember it.`;
    };
    return {
      title: `The council: ${a.name} and ${b.name} quarrel`, council: "ruling",
      text: `${a.name} and ${b.name} bring ${what} to the council and ask you to rule.`,
      choices: [
        { label: `Side with ${a.name}`, hint: `+6 with ${a.name}, −8 with ${b.name}, and it sours things between them`, ai: (st) => (a.goodwill <= b.goodwill ? 1 : 0.5), resolve: (st) => side(st, a, b) },
        { label: `Side with ${b.name}`, hint: `+6 with ${b.name}, −8 with ${a.name}, and it sours things between them`, ai: (st) => (b.goodwill < a.goodwill ? 1 : 0.5), resolve: (st) => side(st, b, a) },
        { label: `Propose a compromise (${Math.round(chance * 100)}%)`, hint: "A Speech check (your best talker at the hub): it works: +3 with both and they make up; it fails: −3 with both",
          ai: () => chance * 4, resolve: (st) => {
            const t = h ? [...atBase(st, h.id)].sort((x, y) => skill(y, "speech") - skill(x, "speech") || x.id - y.id)[0] : null;
            if (t) gainXp(st, t, "speech", USE.radio || 2);
            if (st.rng.chance(chance)) {
              changeGoodwill(st, a, 3, "a fair compromise"); changeGoodwill(st, b, 3, "a fair compromise"); changeRelation(st, a, b, 5);
              A.history.unshift({ day: day(st), text: `Your compromise settled ${a.name} and ${b.name}'s quarrel.` });
              return "Both sides accept the compromise.";
            }
            changeGoodwill(st, a, -3, "a compromise nobody liked"); changeGoodwill(st, b, -3, "a compromise nobody liked");
            A.history.unshift({ day: day(st), text: `Your compromise between ${a.name} and ${b.name} pleased neither.` });
            return "Neither side likes the compromise.";
          } },
      ],
    };
  }
  return null;
}

// ---------- victory ----------
// Land the coalition controls: land tiles within CONTROL_RANGE of your bases or a member's base.
export function controlledLand(state) {
  const g = state.grid;
  const centres = [...state.bases.map((b) => b.tile), ...allianceMembers(state).flatMap((f) => f.bases)];
  let land = 0, held = 0;
  const mark = new Uint8Array(state.tiles.length);
  for (const c of centres) for (const id of g.within(c, ALLIANCE.CONTROL_RANGE)) mark[id] = 1;
  for (const t of state.tiles) {
    if (t.terrain === "water") continue;
    land++;
    if (mark[t.id]) held++;
  }
  return { held, land, pct: land ? held / land : 0 };
}
// Progress toward both victories, for the Goals panel and the tools.
export function goalsProgress(state) {
  const st = state.hives ? hiveStats(state) : { destroyed: 0 };
  const hivesLeft = (state.hives || []).length;
  const building = (state.hiveSites || []).filter((s) => s.started != null).length;
  const sites = (state.hiveSites || []).length;
  const groups = state.factions.filter((f) => f.alive);
  const ms = allianceMembers(state);
  const land = controlledLand(state);
  const hivesOk = hivesSecured(state);
  const landOk = land.pct > ALLIANCE.LAND_NEEDED;
  const allIn = ms.length > 0 && groups.every((f) => isMember(state, f));
  return {
    hives: { destroyed: st.destroyed || 0, left: hivesLeft, building, sites, ok: hivesOk },
    alliance: { land, landOk, members: ms.length, groups: groups.length, outside: groups.filter((f) => !isMember(state, f)).map((f) => f.id), allIn, hivesLeft, hivesOk, ok: landOk && allIn && hivesOk },
  };
}
export function allianceVictory(state) {
  if (!state.alliance || !state.alliance.members.length || !alive(state).length) return false;
  return goalsProgress(state).alliance.ok;
}

// ---------- the AI governor (autopilot.js autopilotDaily) ----------
// Every style: their caravans fetch the deliveries the hub can spare, and every group that qualifies is invited
// into the coalition. Aggressive: sells ammo over the radio to groups at war (diplomacy.js autoWarTrade).
// (Joining wars is decided on the war card: Cautious always stays out.) Returns a line for the log or "".
export function autoDiplomacyDaily(state, style) {
  const out = [];
  const picked = autoJobsDaily(state);
  if (picked) out.push(picked);
  for (const f of state.factions) if (f.alive && !isMember(state, f) && !inviteProblem(state, f)) out.push(inviteToAlliance(state, f));
  const sold = autoWarTrade(state, style, (st, f, want, payQty) => {
    const q = dealQuote(st, f, { wantKey: want, wantQty: 1, payKey: "ammo", payQty });
    const wantQty = Math.min(q.maxWant || 0, 20);
    if (wantQty < 2) return "";
    const r = radioDeal(st, f, { wantKey: want, wantQty, payKey: "ammo", payQty });
    return r.ok ? `Sold ${payQty} ammo to ${f.name} (at war) for ${wantQty} ${want}.` : "";
  });
  if (sold) out.push(sold);
  return out.join(" ");
}
