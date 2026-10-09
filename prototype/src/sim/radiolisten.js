// Listening in on radio traffic: the groups' own channels (radio.js radioNetworks), tuned with "Listen in".
//
// - Channels. Every group with a base talks on its own network (radio.js GROUP_NET_RANGE around each of its bases).
//   Each day (radio.js radioDaily, after the groups' own day) its traffic is written down (channelTraffic, kept
//   LISTEN.KEEP_DAYS days): caravans and convoys setting out (route, destination, rough day of arrival), its
//   scavengers out, raids and war parties on the way (target, rough day), its war parties against the hives (which
//   hive, how it went: factions.js groupHiveWar, read from f.hiveFights / hivesBurned / hiveKills), its wars, what
//   its stores are short of or full of (trade.js market lists, every LISTEN.STORES_EVERY days), rumours of places
//   (survey.js rumourFromNews, every LISTEN.RUMOUR_EVERY days) and how it talks about you (every LISTEN.TALK_EVERY).
// - Listen in (a 1-hour team order "listen", orders.js; at a base a button in the Groups tab's radio header): a
//   receiver (radio.js baseReceives / teamReceives) tunes to one of the networks whose coverage it stands in
//   (several in range: the player picks one). The channel is remembered (p.tuned / base.tuned: "player" or a
//   group's id); switching is the same action. The action catches up on the last LISTEN.CATCHUP_DAYS days of the
//   channel at once; after that, while tuned and in range, the receiver picks up the day's traffic each day.
// - Odds. Each line is caught or missed by the world's dice (skills.js hash01: no draw from state.rng), per
//   listener and day: ODDS[kind] × (0.7 + 0.03 × the listener's best Scouting), at most 90%. A military group's
//   channel is encrypted: × 0.6 unless the listener has a Military encrypted radio. The catch-up counts × 1.25.
//   A line once heard (by any of your receivers) is not heard again.
// - Heard lines go to the log ("📻 Heard on X's channel: …") and the listener's list (p.heard / base.heard, newest
//   first, LISTEN.HEARD_MAX). A raid or war party heading for one of your bases is a warning card (Prepare
//   defenses / Noted) before the lookouts see it.
// - Your own network gives what it always did (your teams' reports, the news): tuning to it adds nothing.
// - Being caught: a group whose channel one of your receivers is tuned to (and in range of) notices now and then:
//   LISTEN.CAUGHT a day (about 7% a week), −5 goodwill and a line in the log.
// - The governor (state.autopilot): once a week it tunes the hub to the channel of the group that raided it last
//   (else the nearest hostile group in range); the warning card's choices carry its scores (ai).
import { day, log, hub, atBase, baseById, addCard, skill, snapshot, localId } from "./world.js";
import { networksAt, networkById, netCovers, baseReceives, teamReceives, teamMilRadio, hasMilRadio, PLAYER_NET } from "./radio.js";
import { partyTile, tileLabel, bestSkill, travelHours } from "./parties.js";
import { hash01 } from "./skills.js";
import { attitude, changeGoodwill, groupHiveTarget } from "./factions.js";
import { rumourFromNews } from "./survey.js";
import { warsOf } from "./diplomacy.js";
import { noteHeard } from "./intelnotes.js"; // what you hear of a group (the State Map's estimates of its bases)

export const LISTEN = {
  HOURS: 1, KEEP_DAYS: 4, CATCHUP_DAYS: 3, CATCHUP_BONUS: 1.25, HEARD_MAX: 6,
  SKILL_BASE: 0.7, SKILL_STEP: 0.03, CAP: 0.9, ENCRYPTED: 0.6,
  STORES_EVERY: 3, TALK_EVERY: 4, RUMOUR_EVERY: 5,
  CAUGHT: 0.01, CAUGHT_GW: -5, AUTO_EVERY: 7,
};
// Base odds of catching a line of each kind (before Scouting).
export const ODDS = { raidYou: 0.7, raid: 0.55, caravan: 0.5, scav: 0.35, hive: 0.6, war: 0.5, stores: 0.45, rumour: 0.3, talk: 0.4 };
export const ODDS_LABEL = {
  raidYou: "a raid on your base", raid: "raids and war parties", caravan: "caravans and convoys", scav: "scavengers out", hive: "war parties against the hives",
  war: "their wars", stores: "their stores", rumour: "rumours of places", talk: "talk about you",
};
export const hearOdds = (kind, scouting = 0, encrypted = false, bonus = 1) =>
  Math.min(LISTEN.CAP, (ODDS[kind] ?? 0.4) * (LISTEN.SKILL_BASE + LISTEN.SKILL_STEP * Math.max(0, scouting)) * (encrypted ? LISTEN.ENCRYPTED : 1) * bonus);

function chan(state) {
  const c = state.radioChan || (state.radioChan = { traffic: {}, got: {}, memo: {} });
  c.traffic = c.traffic || {}; c.got = c.got || {}; c.memo = c.memo || {};
  return c;
}
const fname = (f, unknown = "a group you have not met") => (f ? (f.known ? f.name : unknown) : "someone");
// The day a party on the move gets where it is going (by its path from here, no weather).
function arrivalDay(state, q) {
  const rest = q.path.slice(q.idx);
  const h = rest.length > 1 ? travelHours(state, rest, { vehicle: !!q.vehicle, speed: q.vehicle ? 1 : 0.9, progress: q.progress || 0, weather: false, maxHours: 24 * 20 }).hours : 0;
  return Math.floor((state.hour + h) / 24);
}
const whenText = (state, d) => (d <= day(state) ? "today" : d === day(state) + 1 ? "tomorrow" : `around day ${d}`);

// ---------- the channels: what each group says on the air today ----------
export function channelTraffic(state, today = day(state)) {
  const c = chan(state);
  const lid = (id) => localId(state, id); // ids feed the dice (hearChannel) and the day sums below: world-local only
  for (const f of state.factions) {
    if (!f.alive || !f.bases || !f.bases.length) { delete c.traffic[f.id]; continue; }
    const list = (c.traffic[f.id] = (c.traffic[f.id] || []).filter((x) => today - x.day < LISTEN.KEEP_DAYS));
    const put = (item) => {
      const i = list.findIndex((x) => x.key === item.key);
      if (i >= 0) list[i] = { ...list[i], ...item, day: today };
      else list.push({ ...item, day: today });
    };
    for (const q of state.parties) {
      if (q.owner !== f.id || !q.path || q.returning) continue;
      const dest = q.path[q.path.length - 1];
      if (q.kind === "raid" && q.phase === "out" && q.target) {
        const arrive = arrivalDay(state, q), when = whenText(state, arrive);
        if (q.target.kind === "player") {
          const b = baseById(state, q.target.baseId);
          if (!b) continue;
          put({ key: `raid:${lid(q.id)}`, kind: "raidYou", baseId: b.id, partyId: q.id, strength: Math.round(q.strength || 0), arrive,
            text: `a war party (strength about ${Math.round(q.strength || 0)}) is on its way to your ${b.name}, there ${when}.` });
        } else {
          const o = state.factions.find((x) => x.id === q.target.factionId);
          put({ key: `raid:${lid(q.id)}`, kind: "raid", strength: Math.round(q.strength || 0), text: `a war party is on its way to ${o ? `${fname(o)}'s base at ` : ""}${tileLabel(state, q.target.tile)}, there ${when}.` });
        }
      } else if ((q.kind === "convoy" || q.kind === "caravan") && q.phase === "out") {
        const mine = q.baseId != null ? baseById(state, q.baseId) : null;
        const to = mine ? null : state.factions.find((x) => x.id === (q.targetFaction ?? q.toFaction));
        const where = mine ? `your ${mine.name}` : to ? `${fname(to)} at ${tileLabel(state, dest)}` : tileLabel(state, dest);
        put({ key: `cv:${lid(q.id)}`, kind: "caravan", text: `a ${q.kind === "convoy" ? "trade convoy" : "caravan"} set out from ${tileLabel(state, q.path[0])} for ${where}, there ${whenText(state, arrivalDay(state, q))}.` });
      } else if (q.kind === "scav" && q.scav && q.phase === "out") {
        put({ key: `sc:${lid(q.id)}`, kind: "scav", text: `their scavengers are headed for ${tileLabel(state, q.scav.site)}.` });
      }
    }
    // Their war parties against the hives (factions.js groupHiveWar): what changed since yesterday.
    const m = c.memo[f.id];
    const now = { fights: f.hiveFights || 0, burned: f.hivesBurned || 0, kills: f.hiveKills || 0 };
    if (m && now.fights > m.fights) {
      const burned = now.burned > m.burned;
      const cut = Math.max(0, now.kills - m.kills);
      const target = groupHiveTarget(state, f);
      const name = burned ? m.hive || "a hive" : (target && target.name) || m.hive || "a hive";
      put({ key: `hive:${lid(f.id)}:${now.fights}`, kind: "hive", text: burned ? `their fighters stormed ${name} and burned it out.` : `their fighters stormed ${name} and were driven off${cut ? `, after cutting down about ${cut} of its brood` : ""}.` });
    }
    const target = groupHiveTarget(state, f);
    c.memo[f.id] = { ...now, hive: target ? target.name : null };
    // Their wars (diplomacy.js).
    for (const w of state.diplo ? warsOf(state, f) : []) {
      const o = state.factions.find((x) => x.id === (w.a === f.id ? w.b : w.a));
      if (o) put({ key: `war:${w.id}:${lid(f.id)}`, kind: "war", text: `they talk of their war with ${fname(o)}.` });
    }
    // Their stores (this week's market lists, trade.js; only once they are drawn up).
    if (f.market && (today + lid(f.id)) % LISTEN.STORES_EVERY === 0) {
      const wants = (f.market.wants || []).slice(0, 2).map((x) => x.key), spare = (f.market.surplus || []).slice(0, 2).map((x) => x.key);
      if (wants.length || spare.length) put({ key: `st:${lid(f.id)}:${today}`, kind: "stores", wants, spare, text: `their stores: ${wants.length ? `short of ${wants.join(" and ")}` : "nothing short"}; ${spare.length ? `plenty of ${spare.join(" and ")}` : "nothing to spare"}.` });
    }
    if ((today + lid(f.id) * 7) % LISTEN.RUMOUR_EVERY === 0) put({ key: `ru:${lid(f.id)}:${today}`, kind: "rumour", text: "" }); // the place is named when it is heard
    if ((today + lid(f.id) * 3) % LISTEN.TALK_EVERY === 0) put({ key: `tk:${lid(f.id)}:${today}`, kind: "talk", text: talkText(f, today) });
  }
  for (const k of Object.keys(c.got)) if (today - c.got[k] > 20) delete c.got[k];
  return c.traffic;
}
function talkText(f, today) {
  const a = attitude(f);
  const grudge = f.grudgeUntil != null && f.grudgeUntil >= today ? " They still want payback for their caravan." : "";
  if (a === "Hostile") return `they talk about you with contempt: easy pickings, they say.${grudge}`;
  if (a === "Allied") return "they call you friends, and mean it.";
  if (a === "Friendly") return `they speak well of you.${grudge}`;
  return `they talk about you warily: nobody is sure what you are after.${grudge}`;
}

// ---------- listeners ----------
// { key, holder, isBase, tile, tuned, scouting, mil } for a base or a team that can receive.
function listenerOf(state, holder, isBase) {
  if (isBase) {
    const best = Math.max(0, ...atBase(state, holder.id).map((s) => skill(s, "scouting")));
    return { key: `b${localId(state, holder.id)}`, holder, isBase, tile: holder.tile, tuned: holder.tuned, scouting: best, mil: hasMilRadio(holder) };
  }
  return { key: `p${localId(state, holder.id)}`, holder, isBase, tile: partyTile(holder), tuned: holder.tuned, scouting: bestSkill(state, holder, "scouting"), mil: teamMilRadio(state, holder) };
}
function tunedListeners(state) {
  const out = [];
  for (const b of state.bases) if (b.tuned != null && baseReceives(state, b)) out.push(listenerOf(state, b, true));
  for (const p of state.parties) if (p.owner === "player" && p.tuned != null && teamReceives(state, p)) out.push(listenerOf(state, p, false));
  return out;
}

// One line heard: the log, the listener's list, a warning card for a raid on you.
function hear(state, L, f, item) {
  const c = chan(state);
  c.got[item.key] = day(state);
  let text = item.text;
  if (item.kind === "rumour") {
    const r = rumourFromNews(state, f.name, `listen-${item.key}`, 1); // survey.js: a hidden place, if there is one to tell of
    text = r ? `they speak of a place out in the state.${r}` : "they talk of places out in the state, nothing you can place.";
  }
  const line = { day: day(state), net: f.id, name: f.name, text };
  L.holder.heard = [line, ...(L.holder.heard || [])].slice(0, LISTEN.HEARD_MAX);
  log(state, `📻 Heard on ${f.name}'s channel: ${text}`, item.kind === "raidYou" ? "danger" : "info");
  // intelnotes.js: what it tells of the group (the State Map's estimates of its bases, intelest.js).
  if (item.kind === "stores") noteHeard(state, f.id, "stores", { wants: item.wants || [], spare: item.spare || [] });
  if (item.strength) noteHeard(state, f.id, "force", { strength: item.strength });
  if (item.kind === "raidYou") raidHeardCard(state, f, item);
  return line;
}
function raidHeardCard(state, f, item) {
  const base = baseById(state, item.baseId);
  if (!base || state.cards.some((c) => c.radioRaid === item.partyId)) return;
  addCard(state, {
    title: `Heard on the radio: ${f.name} are coming for ${base.name}`,
    radioRaid: item.partyId,
    text: `On ${f.name}'s channel: a war party (strength about ${item.strength}) is on its way to ${base.name}, there ${whenText(state, item.arrive ?? day(state))}. Your lookouts have not seen them yet; when they do, the usual warning comes (tribute, retreat, defend in person).`,
    choices: [
      { label: "Prepare defenses", ai: () => 1, hint: `Everyone at ${base.name} takes a post until the raid is over (building and repairs stop there meanwhile)`, resolve: (st) => { const b = baseById(st, base.id); if (!b) return "That base is gone."; b.alert = true; return `${b.name} prepares for the attack.`; } },
      { label: "Noted", ai: () => 0, hint: "Nothing changes; keep an ear on their channel", resolve: () => `You keep an ear on ${f.name}'s channel.` },
    ],
  });
}
// The channel's lines not heard yet, from day `since`, each rolled once for this listener (the world's dice).
function hearChannel(state, L, f, since, salt, bonus = 1) {
  const c = chan(state);
  const out = [];
  const enc = f.type === "military" && !L.mil;
  for (const item of [...(c.traffic[f.id] || [])]) {
    if (item.day < since || c.got[item.key] != null) continue;
    if (hash01(state.seed, "listen", salt, L.key, item.key, day(state)) >= hearOdds(item.kind, L.scouting, enc, bonus)) continue;
    out.push(hear(state, L, f, item));
  }
  return out;
}

// ---------- Listen in ----------
// Why a base or a team cannot listen in here (null: it can). netId: the channel picked (null: any).
export function listenProblem(state, holder, isBase, netId = null) {
  if (!holder) return "Nobody to listen.";
  if (!(isBase ? baseReceives(state, holder) : teamReceives(state, holder))) return isBase ? "No receiver here: a radio station, a Military encrypted radio or a hand-crank radio in the armory." : "The team carries no receiver (a hand-crank radio or a Military encrypted radio).";
  const nets = networksAt(state, isBase ? holder.tile : partyTile(holder));
  if (!nets.length) return "Static: no radio network reaches this spot.";
  if (netId != null && !nets.some((n) => String(n.id) === String(netId))) return "That channel does not reach this spot.";
  return null;
}
// Tune a receiver to a network in range and catch up on its last few days. { ok, text, heard: [lines] }.
export function listenIn(state, holder, netId = null, isBase = false) {
  const why = listenProblem(state, holder, isBase, netId);
  if (why) return { ok: false, text: `Listen in: ${why}`, heard: [] };
  const tile = isBase ? holder.tile : partyTile(holder);
  const nets = networksAt(state, tile);
  const net = netId != null ? nets.find((n) => String(n.id) === String(netId)) : nets.length === 1 ? nets[0] : nets.find((n) => n.kind === "group") || nets[0];
  const was = holder.tuned;
  holder.tuned = net.id;
  holder.tunedDay = day(state);
  const who = isBase ? holder.name : "The team";
  if (net.kind === "player") return { ok: true, text: `${who} tuned to your own network: your teams' reports and the news, as always.`, heard: [] };
  const f = net.faction;
  if (!f.known) { // a voice you had not heard: they are known now, their base marked
    f.known = true;
    f.heard = true;
    if (f.bases[0] != null) state.knowledge[f.bases[0]] = snapshot(state, f.bases[0]);
  }
  channelTraffic(state); // today's traffic so far
  const L = listenerOf(state, holder, isBase);
  const got = hearChannel(state, L, f, day(state) - LISTEN.CATCHUP_DAYS + 1, "catch", LISTEN.CATCHUP_BONUS);
  const verb = was === net.id ? "listened in again on" : was != null ? "switched to" : "tuned to";
  return { ok: true, text: `${who} ${verb} ${f.name}'s channel. ${got.length ? `Caught ${got.length} thing${got.length === 1 ? "" : "s"} from the last ${LISTEN.CATCHUP_DAYS} days (in the log).` : `Nothing of note in the last ${LISTEN.CATCHUP_DAYS} days of their traffic.`}`, heard: got };
}

// ---------- daily ----------
export function listenDaily(state) {
  const today = day(state);
  channelTraffic(state, today);
  const tunedTo = new Set();
  for (const L of tunedListeners(state)) {
    if (L.tuned === PLAYER_NET) continue;
    const net = networkById(state, L.tuned);
    if (!net || !netCovers(state, net, L.tile)) continue;
    tunedTo.add(net.faction);
    hearChannel(state, L, net.faction, today, "day");
  }
  // Now and then they notice someone on their channel.
  for (const f of tunedTo) {
    if (!f.known || hash01(state.seed, "listen-caught", localId(state, f.id), today) >= LISTEN.CAUGHT) continue;
    changeGoodwill(state, f, LISTEN.CAUGHT_GW, "listening in on their channel");
    log(state, `${f.name} caught on that you listen in on their channel (goodwill ${LISTEN.CAUGHT_GW}).`, "danger");
  }
  if (state.autopilot) autoTune(state, today);
}

// The governor: the hub listens to the group that raided it last (else the nearest hostile group in range; none: it
// leaves the set alone).
export function autoTune(state, today = day(state)) {
  const h = hub(state);
  if (!h || !baseReceives(state, h)) return null;
  if (h.tuned != null && h.tunedDay != null && today - h.tunedDay < LISTEN.AUTO_EVERY) return null;
  const nets = networksAt(state, h.tile).filter((n) => n.kind === "group" && (n.faction.raidedYou != null || attitude(n.faction) === "Hostile")); // a threat only
  if (!nets.length) return null;
  const g = state.grid;
  const near = (f) => Math.min(...f.bases.map((b) => g.distance(b, h.tile)));
  const score = (f) => (f.raidedYou != null ? 1000 + f.raidedYou : 0) + (attitude(f) === "Hostile" ? 500 : 0) - near(f);
  const best = nets.map((n) => n.faction).sort((a, b) => score(b) - score(a) || a.id - b.id)[0];
  const r = listenIn(state, h, best.id, true);
  return r.ok ? r.text : null;
}

// The group networks one of your receivers is tuned to (the map draws their coverage in the group's colour).
export function tunedNetworks(state) {
  const ids = new Set();
  for (const b of state.bases) if (b.tuned != null && b.tuned !== PLAYER_NET) ids.add(b.tuned);
  for (const p of state.parties) if (p.owner === "player" && p.tuned != null && p.tuned !== PLAYER_NET) ids.add(p.tuned);
  return [...ids].map((id) => networkById(state, id)).filter((n) => n && n.faction && n.faction.known);
}
