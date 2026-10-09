// Diplomacy screens: the Goals card, the Jobs list and the coalition line in the Groups tab, the extras in each
// group's card and in the radio panel (wants and surplus, wars, invite), and the Diplomacy window with four tabs:
// Jobs, Market board, World affairs (wars, pacts, relations between groups) and Coalition (members, council,
// both victories). Handlers: DIPLO_ACTIONS / DIPLO_CHANGE, registered by main.js. Rules: sim/jobs.js,
// sim/diplomacy.js, sim/alliance.js, sim/trade.js (market lists).
import { crawlProgressLine } from "../sim/hivecrawl.js"; // the Goals card: how deep your crawls got
import { SUPPLIES, SUPPLY_KEYS } from "../sim/data.js";
import { day, factionById, hub } from "../sim/world.js";
import { attitude } from "../sim/factions.js";
import { worksText } from "../sim/groupworks.js"; // barestart: what the group has built
import { arsenalText, arsenalKnown } from "../sim/arsenal.js"; // what they fight with
import { jailText } from "../sim/groupjails.js"; // jailhouse: their jail and who they hold, once you know it
import { tileLabel } from "../sim/parties.js";
import { canRadioGroup, hasNetwork } from "../sim/radio.js";
import { firstHubGoal } from "./hardcore.js";
import { marketOf, marketBoard, priceTrend, LOT } from "../sim/trade.js";
import {
  ensureJobs, JOB_TYPES, jobById, jobTile, acceptJob, declineJob, abandonJob, requestPickup, pickupProblem, rewardText, acceptProblem, jobsOf,
} from "../sim/jobs.js";
import {
  ensureDiplo, relation, relWord, warsOf, enemyIn, brokerInfo, brokerCeasefire, joinWar, joinProblem, leaveWar, warById, pactsOf, knownAs,
} from "../sim/diplomacy.js";
import {
  ensureAlliance, isMember, allianceMembers, inviteProblem, inviteToAlliance, inviteBloc, expel, goalsProgress, councilVote, nextCouncilDay, ALLIANCE, controlRadius,
} from "../sim/alliance.js";
import { bandsOf, knownBands, bandInfo, militaryStatus } from "../sim/hardcore-groups.js";
import { ask } from "./confirm.js";
import { volAskButton } from "./volunteers.js"; // ask a group for volunteers (sim/volunteers.js) // joining or leaving a war, expelling a member, giving up a job ask first
import { ensureBlocs, blocOf, blocMembers, blocTitle, foeText, leaveBlocSide, BLOC, previewVote, voteText, blocCarrier } from "../sim/blocs.js"; // AI blocs
import {
  ensurePwars, pwarOf, goalText, cbText, termOptions, offerTerms, talkWait, talkVia, declareByPlayer, playerDeclareProblem, ceasefireUntil, ceasefireWith, PW,
} from "../sim/playerwars.js"; // wars with you

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const p1 = (v) => (Math.round((v || 0) * 10) / 10).toFixed(1);
const pct = (v) => `${Math.round((v || 0) * 100)}%`;
const attColor = (a) => ({ Hostile: "var(--danger)", Neutral: "var(--muted)", Friendly: "var(--good)", Allied: "var(--accent)" }[a]);
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;
const ARROW = { up: `<span class="good"${tip("Up since last week")}>▲</span>`, down: `<span class="danger"${tip("Down since last week")}>▼</span>`, same: `<span class="muted"${tip("About the same as last week")}>–</span>` };
const nameOf = (state, id) => { const f = factionById(state, id); return f ? (f.known ? f.name : knownAs(state, f)) : "?"; };
const TERMS = { land: "land ceded", tribute: "tribute", white: "white peace", none: "—" };
const REASON = { land: "land", resources: "food and ammo", hive: "hive ground", pact: "a pact", bloc: "its bloc" };
const HOW = { terms: "peace on terms", weary: "worn out: a ceasefire", white: "a ceasefire, nothing gained", gone: "they are gone" };
const swatch = (c) => `<span class="swatch" style="background:${c}"></span>`;

// ---------- Groups tab ----------
// Goals (both victories), then the buttons to the Diplomacy window and the Jobs list.
export function groupsDiploHeader(state) {
  const g = goalsProgress(state);
  const J = ensureJobs(state);
  const offers = J.list.filter((j) => j.status === "offered").length;
  const active = J.list.filter((j) => j.status === "active").length;
  const wars = ensureDiplo(state).wars.length;
  return `${goalsCard(state, g, true)}
    <div class="row" style="margin-bottom:0.5rem">
      <button data-action="dp-open" data-tab="jobs"${tip("Jobs offered and under way")}>Jobs (${active}${offers ? ` + ${offers} offered` : ""})</button>
      <button data-action="dp-open" data-tab="market"${tip("What every group in radio reach wants and has spare, best price first, with arrows against last week")}>Market board</button>
      <button data-action="dp-open" data-tab="affairs"${tip("Wars, pacts and how the groups feel about each other; broker a ceasefire or join a war")}>World affairs${wars ? ` (${wars} war${wars === 1 ? "" : "s"})` : ""}</button>
      <button data-action="dp-open" data-tab="coalition"${tip(`${ALLIANCE.NAME}: members, invitations, the council`)}>Coalition</button>
    </div>
    ${blocsAndWarsBlock(state)}
    ${jobsBlock(state, true)}`;
}

// The blocs between groups you know of and the wars with you, in the Groups tab (sim/blocs.js, sim/playerwars.js).
function blocsAndWarsBlock(state) {
  const D = ensurePwars(state);
  ensureBlocs(state);
  const wars = D.pwars.map((w) => { const f = factionById(state, w.fid); return f ? `<div class="danger"${tip(`Score ${w.score.you}–${w.score.them} to you · weariness theirs ${Math.round(w.exh.them)}, yours ${Math.round(w.exh.you)} (they sue for peace from ${PW.TIRED}, pull out at ${PW.BROKEN})`)}>⚔ <b>${esc(f.name)}</b> ${w.by === "you" ? "(you declared it)" : "declared war on you"} on day ${w.start}: ${esc(goalText(state, w))}${w.allies.length ? `, with ${w.allies.map((id) => esc(nameOf(state, id))).join(" and ")}` : ""}</div>` : ""; }).join("");
  const blocs = state.diplo.blocs.filter((b) => blocMembers(state, b).some((m) => m.known)).map((b) => `<div${tip(`Founded day ${b.founded}. Members defend each other, raid together, share what they know and trade with each other first.${b.player ? " You stand with them: their fighters help defend your bases near them." : ""}`)}>${swatch(b.color)}<b>${esc(cap(blocTitle(b)))}</b>: ${blocMembers(state, b).map((m) => esc(nameOf(state, m.id))).join(", ")} <span class="muted">against ${esc(foeText(state, b.foe))}</span>${b.player ? ` <span class="good">(you stand with them)</span>` : ""}</div>`).join("");
  if (!wars && !blocs) return "";
  return `<div class="card small"><div class="spread"><b${tip("Wars declared on you (or by you) and the alliances between groups. Help: Blocs and wars.")}>⚔ Blocs and wars</b><a class="link" data-action="dp-open" data-tab="affairs">details</a></div>${wars}${blocs}</div>`;
}
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);

function goalsCard(state, g, compact) {
  const a = g.alliance, h = g.hives;
  const ok = (b) => (b ? `<span class="good">✓</span>` : `<span class="muted">✗</span>`);
  const hiveLine = `${ok(h.ok)} Hives: ${h.destroyed} destroyed, <b>${h.left}</b> left${h.building ? `, ${h.building} being built` : ""}${h.sites > h.building ? ` (${h.sites - h.building} site${h.sites - h.building === 1 ? "" : "s"} picked)` : ""}`;
  // Eras (sim/eras.js): the year, and the clocks each victory has to run after its conditions are met.
  const e = g.era;
  // Hardcore (sim/hardcore-outbreak.js): the first year after the fall comes before year 1 of the eras.
  const fall = e.fall && e.fall.before
    ? `<div class="danger"${tip(`Calder has just fallen. The outbreak is spreading out from its first hives: into the cities and towns first, then the open country, and new hives are rising. In about ${e.fall.left} days (day ${e.fall.normalStart}) it will have run its first course and the years below begin: the threats grow from then on, and neither victory can come before day ${e.winDay}.`)}>The fall · the outbreak is spreading (${e.fall.left} days to go)</div>` : "";
  const eraLine = `${fall}<div${tip(`${e.era.desc} Threats grow every year from year 3. Neither victory can come before year ${e.winFrom} (day ${e.winDay}).`)}>Year <b>${e.year}</b> · ${esc(e.era.name)}${e.winOpen ? "" : ` <span class="muted">(no victory before year ${e.winFrom})</span>`}</div>`;
  const clearLine = h.ok ? `<div${tip("After the last hive falls the state has to stay clear of hives for a season: a hive that rises again sets this back to zero.")}>${ok(e.clear >= e.clearNeed)} Kept clear: <b>${e.clear}</b> of ${e.clearNeed} days</div>` : "";
  const accordLine = `<div${tip(`The Calder Accord: once the coalition (you and at least one member) holds over half the land, it has to keep it for a year of the late game (the clock starts in year ${e.winFrom}). Every day that holds counts; a day it does not takes two back. Groups outside the coalition do not count against it: break them, take their land, or leave them be. The coalition must also have stood for ${e.seasonsNeed} seasons since it was founded.`)}>${ok(e.accord >= e.accordNeed && e.seasons >= e.seasonsNeed)} Accord held: <b>${e.accord}</b> of ${e.accordNeed} days${e.winOpen ? "" : ` <span class="muted">(counts from year ${e.winFrom})</span>`} · coalition age ${e.seasons} of ${e.seasonsNeed} seasons</div>`;
  const ADV = { invite: ["good", "invite them"], court: ["muted", "win them over"], defeat: ["danger", "defeat them"], find: ["muted", "find them first"] };
  const outRow = (o) => {
    const f = factionById(state, o.id);
    const [cls, word] = ADV[o.advice];
    const act = o.advice === "invite" ? `<button class="mini" data-action="al-invite" data-id="${o.id}"${tip("Invite them into the coalition now")}>Invite</button>`
      : o.known && f && f.bases.length ? `<button class="mini" data-action="job-locate" data-tile="${f.bases[f.bases.length - 1]}"${tip(o.advice === "defeat" ? "Find their bases: right-click one for Assault their base" : "Find them on the map")}>Locate</button>` : "";
    const why = o.advice === "defeat" ? `hostile: take their ${o.bases} base${o.bases === 1 ? "" : "s"} (about ${o.defenders} defenders at the weakest)` : o.advice === "court" ? o.why : o.advice === "find" ? "you have not met them: scout, scan the airwaves" : "they would join now";
    return `<div><span class="${cls}">● ${esc(o.name)}: ${word}</span>${compact ? "" : ` <span class="muted">(${esc(why)})</span>`} ${act}</div>`;
  };
  const lost = a.lost || [];
  return `<div class="card small"${tip(`Two ways to win, each its own path, neither before year ${e.winFrom}. Destroy every hive (none left standing or being built) and keep the state clear for a season. Or win with the coalition: it has at least one member and holds more than half the land (your bases' reach, your members' bases and the tiles your teams claimed; hives or not), and keeps that up for a year of the late game (the Calder Accord). Groups that will not join do not block it: break them (Assault their base), claim the land up to their gates, or leave them be.`)}>
    <div class="spread"><b>🏁 Goals</b>${compact ? `<a class="link" data-action="dp-open" data-tab="coalition">details</a>` : ""}</div>
    ${firstHubGoal(state)}
    ${eraLine}
    <div style="margin-top:0.2rem"><b>Destroy every hive</b></div>
    <div>${hiveLine}</div>
    ${crawlProgressLine(state) ? `<div class="muted"${tip("The hive crawl (Help: The hive crawl): each hive your teams have been inside, the deepest chamber reached of its depth; ★ its core found, ☆ heard or lit from a passage. The State Map's hive tile has the rest.")}>⛏ Crawled: ${esc(crawlProgressLine(state))}</div>` : ""}
    ${state.autopilot && state.governor && state.governor.campaign && state.governor.campaign.line ? `<div class="muted"${tip("The AI governor's hive campaign (sim/autopilot.js): the hive it works toward, the ammo stockpiled, fires set, allies, and what it waits for")}>🤖 ${esc(state.governor.campaign.line)}</div>` : ""}
    ${clearLine}
    <div style="margin-top:0.3rem"><b>${esc(ALLIANCE.NAME)}</b></div>
    <div class="row"><span style="width:12rem">${ok(a.landOk)} Land held: <b>${pct(a.land.pct)}</b> of ${pct(ALLIANCE.LAND_NEEDED)}+</span><div style="flex:1;min-width:5rem">${bar(a.land.pct * 100, a.landOk ? "var(--good)" : "var(--accent)")}</div></div>
    <div>${ok(a.membersOk)} Members: <b>${a.members}</b> of ${a.groups} group${a.groups === 1 ? "" : "s"} still standing <span class="muted">(one is enough; the rest need not join)</span>${a.outsiders.length ? `; outside:` : ""}</div>
    ${accordLine}
    ${a.outsiders.length ? `<div style="margin-left:0.8rem">${a.outsiders.slice(0, compact ? 4 : 20).map(outRow).join("")}${compact && a.outsiders.length > 4 ? `<div class="muted">and ${a.outsiders.length - 4} more</div>` : ""}</div>` : ""}
    ${lost.length ? `<div class="danger" style="margin-top:0.2rem">Retake: ${lost.map((o) => `${esc(o.name)} <span class="muted">(${esc(nameOf(state, o.factionId))}, since day ${o.day})</span> <button class="mini" data-action="job-locate" data-tile="${o.tile}">Locate</button>`).join(" · ")}</div>` : ""}
    ${a.infamy >= 10 ? `<div${tip("Rises with every base you take (2 from a hostile raider-type group, 15 from anyone else, 10 more for finishing them), fades 0.1 a day. Above 20 peaceful groups slowly lose goodwill toward you, and they want more goodwill before they join the coalition.")}>Infamy: <b class="${a.infamy > 20 ? "danger" : ""}">${a.infamy}</b>${a.infamy > 20 ? " (peaceful groups are wary of you)" : ""}</div>` : ""}
    ${compact ? "" : `<div class="muted" style="margin-top:0.2rem">Land held: land tiles within ${controlRadius(state, "stronghold")} of your hub or a base you took from a group, ${controlRadius(state, "outpost")} of an outpost (${controlRadius(state, "outpost", true)} with walls) or a member's base, plus the tiles your teams claimed (Claim this tile) (${a.land.held} of ${a.land.land}${a.land.claimed ? `, ${a.land.claimed} claimed` : ""}).</div>`}
  </div>`;
}

// The jobs under way and offered. compact: the Groups tab (no finished jobs).
function jobsBlock(state, compact) {
  const J = ensureJobs(state);
  const active = J.list.filter((j) => j.status === "active");
  const offers = J.list.filter((j) => j.status === "offered");
  const done = compact ? [] : J.list.filter((j) => j.status !== "active" && j.status !== "offered").slice(-12).reverse();
  const head = `<h3${tip("Groups post jobs over the radio (in reach) or at their gates (your team there). Accept one and it goes on the map and into the planner's targets. Missing a deadline or turning a job down costs a little goodwill.")}>Jobs</h3>`;
  if (!active.length && !offers.length && !done.length) return `${head}<div class="muted small">No jobs yet. Groups in radio reach post work now and then; a team at a group's gates may hear of some.</div>`;
  return `${head}${active.map((j) => jobRow(state, j)).join("")}${offers.map((j) => jobRow(state, j)).join("")}
    ${done.length ? `<div class="small muted" style="margin-top:0.4rem">${done.map((j) => `<div>Day ${j.endDay ?? j.expires}: ${esc(j.title)}: <span class="${j.status === "done" ? "good" : j.status === "failed" ? "danger" : "muted"}">${j.status === "done" ? "done" : j.status === "failed" ? "failed" : j.status === "void" ? "called off" : j.status}</span>${j.why ? ` (${esc(j.why)})` : ""}</div>`).join("")}</div>` : ""}`;
}

export function jobProgress(state, j) {
  const d = j.data;
  switch (j.type) {
    case "horde": { const h = state.hordes.find((x) => x.id === d.hordeId); return h ? `Horde of ${h.size} (was ${d.size0}) at ${tileLabel(state, h.tile)}${j.engaged ? " · your team has engaged it" : ""}` : "The horde is gone"; }
    case "escort": return d.stage === "waiting" ? `Their caravan waits at ${tileLabel(state, j.target)} for your team` : d.stage === "moving" ? `On the road: your team alongside ${d.road ? pct(d.near / d.road) : "0%"} of the hours (need 50%)` : "Arrived";
    case "deliver": return `${d.qty - d.left} of ${d.qty} ${d.key} handed over`;
    case "rescue": return `${d.count} held at ${tileLabel(state, j.target)} by ${nameOf(state, d.holder)}`;
    case "hive": return `${tileLabel(state, j.target)}${j.engaged ? " · your squad has been at the hive" : ""}`;
    case "scout": return `${d.seen || 0} of ${d.total || 19} tiles reported (need ${pct(d.need)})`;
    case "retrieve": return d.atHub ? "In your stores: ask them to fetch it" : d.carrier != null ? "Your team carries it: take it to their base" : `Waiting at ${tileLabel(state, d.site)}`;
  }
  return "";
}

function jobRow(state, j) {
  const f = factionById(state, j.fid);
  const T = JOB_TYPES[j.type];
  const tile = jobTile(state, j);
  const offered = j.status === "offered";
  const left = offered ? j.expires - day(state) : j.deadline - day(state);
  const pick = j.status === "active" && (j.type === "deliver" || (j.type === "retrieve" && j.data.atHub)) ? pickupProblem(state, j) : null;
  const why = offered ? acceptProblem(state, j) : "";
  return `<div class="card small${offered ? " attn" : ""}">
    <div class="spread"><b>${T.icon} ${esc(T.name)}</b><span class="muted">${esc(f ? f.name : "?")} · ${offered ? `offer ends in ${Math.max(0, left)} day${left === 1 ? "" : "s"}` : `${Math.max(0, left)} day${left === 1 ? "" : "s"} left (day ${j.deadline})`}</span></div>
    <div>${esc(j.desc)}</div>
    ${offered ? "" : `<div class="muted">${esc(jobProgress(state, j))}</div>`}
    <div class="muted">Reward: ${esc(rewardText(state, j.reward))}</div>
    <div class="row" style="margin-top:0.3rem">
      ${offered ? `<button class="primary mini" data-action="job-accept" data-id="${j.id}" ${why ? "disabled" : ""}${tip(why || `${T.days} days from now`)}>Accept</button><button class="mini" data-action="job-decline" data-id="${j.id}"${tip("−1 goodwill")}>Decline</button>` : ""}
      ${tile != null ? `<button class="mini" data-action="job-locate" data-tile="${tile}"${tip("Center the map on it")}>Locate</button>` : ""}
      ${!offered && tile != null ? `<button class="mini" data-action="job-plan" data-tile="${tile}" data-mission="${planMission(state, j)}"${tip("Open the trip planner with this as the target")}>Plan a trip…</button>` : ""}
      ${pick !== null ? `<button class="mini" data-action="job-pickup" data-id="${j.id}" ${pick ? "disabled" : ""}${tip(pick || "Their caravan comes to your trade base and takes it from the stores")}>Ask them to fetch it</button>` : ""}
      ${!offered ? `<button class="mini" data-action="job-abandon" data-id="${j.id}"${tip("Counts as failing it (goodwill)")}>Give up</button>` : ""}
    </div>
  </div>`;
}
// The mission the planner opens with for a job's target.
function planMission(state, j) {
  if (j.type === "deliver") return "trade";
  if (j.type === "hive") return "hive";
  if (j.type === "horde") return "cull";
  if (j.type === "scout") return "recon";
  if (j.type === "retrieve") return j.data.carrier != null || j.data.atHub ? "trade" : "recon";
  return "move";
}

// One group's extras in its Groups tab card: wars and pacts, the coalition, wants and surplus, jobs.
export function groupCardExtras(state, f) {
  if (!f.alive) return "";
  const m = marketOf(state, f);
  const wars = warsOf(state, f);
  const jobs = jobsOf(state, f);
  const member = isMember(state, f);
  const inv = member ? "" : inviteProblem(state, f);
  const mil = militaryStatus(state, f); // hardcore mode: the Guard's stand against the hive (sim/hardcore-groups.js)
  return `<div class="small" style="margin-top:0.25rem">
    ${mil ? `<div class="${mil.share > 0.55 ? "muted" : "danger"}"${tip("Hardcore: the Guard fights the hive near its base. Its hordes grind the soldiers down; sorties and shelling buy time, ammo and meds from you help, and destroying the hive saves them.")}>🪖 Against the hive: ${esc(mil.word)} (${pct(mil.share)} of its soldiers left)</div>` : ""}
    ${wars.length ? `<div class="danger">⚔ At war with ${wars.map((w) => esc(nameOf(state, enemyIn(w, f)))).join(", ")}${wars.some((w) => w.playerSide === f.id) ? " (you fight beside them)" : wars.some((w) => w.playerSide != null) ? " (you fight against them)" : ""}</div>` : ""}
    ${pactsOf(state, f).length ? `<div class="muted">Pacts with ${pactsOf(state, f).map((o) => esc(nameOf(state, o.id))).join(", ")}</div>` : ""}
    ${member ? `<div class="good">🤝 Member of ${esc(ALLIANCE.NAME)}</div>` : ""}
    ${blocLine(state, f)}
    ${playerWarBlock(state, f)}
    ${f.wormLost ? `<div class="muted"${tip("The worm (Help: The dead and the worm): a group on infected ground loses people to it as a base of yours would catch it; after its first loss a base boils its water and loses far fewer. Heard on the radio and kept in the chronicle.")}>Lost ${f.wormLost} to the worm${f.wormBoilers && Object.keys(f.wormBoilers).length ? "; they boil their water now" : ""}</div>` : ""}
    ${worksText(state, f) ? `<div class="muted"${tip("What they have built at their bases (their bases start bare, as yours does): wells and fields for their food, quarters for their people, walls when they feel threatened (what an assault on them faces), then a workshop and a storehouse.")}>🏗 ${esc(worksText(state, f))}</div>` : ""}
    ${arsenalLine(state, f)}
    ${jailText(state, f) ? `<div class="muted"${tip("Their jail and the prisoners in it (your people among them), known from a prisoner of theirs you questioned or from seeing their base. Makeshift cells hold 2 and leak, holding cells 3, a jailhouse 8 and are hard to break out of: a rescue meets the same. They work their prisoners (raiders hardest) and buy, sell and swap them with other groups.")}>⛓ ${esc(jailText(state, f))}</div>` : ""}
    ${marketLine(m)}
    ${jobs.length ? `<div>${jobs.map((j) => `${JOB_TYPES[j.type].icon} ${esc(JOB_TYPES[j.type].name)} (${j.status === "offered" ? "offered" : "under way"})`).join(" · ")}</div>` : ""}
  </div>
  <div class="row" style="margin-top:0.25rem">${member ? "" : `<button class="mini" data-action="al-invite" data-id="${f.id}" ${inv ? "disabled" : ""}${tip(inviteTip(state, f, inv))}>Invite to the coalition</button>`}${declareRow(state, f)}</div>`;
}
// Their bloc (sim/blocs.js): its colour, the members, its foe; leave it if you stand with it.
function blocLine(state, f) {
  const b = blocOf(state, f);
  if (!b) return "";
  const others = blocMembers(state, b).filter((m) => m !== f);
  return `<div${tip(`A bloc: its members defend each other (each sends what it can spare to a raid on another), raid together, share what they scout and trade with each other first. It breaks when they fall out, when one betrays another, or when the danger that brought them together is gone. Founded day ${b.founded}.`)}>${swatch(b.color)}🛡 ${esc(cap(blocTitle(b)))}${others.length ? ` with ${others.map((m) => esc(nameOf(state, m.id))).join(", ")}` : ""} <span class="muted">against ${esc(foeText(state, b.foe))}</span>${b.player ? ` <span class="good">· you stand with them</span> <button class="mini" data-action="bloc-leave" data-id="${b.id}"${tip(`Leave their side: ${BLOC.LEAVE_GW} goodwill with each member`)}>Leave their side</button>` : ""}${blocInviteButton(state, b)}</div>`;
}
// "Invite the whole bloc" (sim/alliance.js inviteBloc): sent through a member that meets your terms; the tip shows
// how the bloc would vote today (sim/blocs.js previewVote).
const VOTE_RULE = "Each member votes agree, decline or break off (by its goodwill to you, its type, its ties to the others and the wars). Most agrees: the bloc joins together, those that broke off leave it. Otherwise the invited group joins alone only if it agreed.";
function blocVoteTip(state, b, carrier) {
  const v = previewVote(state, b, carrier);
  const outcome = v.carries ? "the bloc would join together" : v.votes.some((x) => x.f === carrier && x.vote === "agree") ? `the bloc would stay out; ${carrier.name} would join alone` : "the bloc would stay out";
  return `If you asked today: ${voteText(state, v)}: ${outcome}. ${VOTE_RULE}`;
}
function blocInviteButton(state, b) {
  if (state.noBlocs || (b.foe && b.foe.kind === "player")) return "";
  const ms = blocMembers(state, b);
  if (!ms.some((m) => m.known) || ms.every((m) => isMember(state, m))) return "";
  const carrier = blocCarrier(state, b, inviteProblem);
  const why = carrier ? "" : `No member can take your invitation yet. ${VOTE_RULE}`;
  return ` <button class="mini" data-action="al-invite-bloc" data-id="${b.id}" ${carrier ? "" : "disabled"}${tip(why || `Through ${carrier.name}. ${blocVoteTip(state, b, carrier)}`)}>Invite the whole bloc</button>`;
}
// The invite button's tip for one group: its bloc votes on it.
function inviteTip(state, f, inv) {
  if (inv) return inv;
  const b = state.noBlocs ? null : blocOf(state, f);
  return b && blocMembers(state, b).length > 1 ? `Invite them into ${ALLIANCE.NAME}: ${blocTitle(b)} votes on it. ${blocVoteTip(state, b, f)}` : `Invite them into ${ALLIANCE.NAME}`;
}
// A war with you (sim/playerwars.js): the goal, the reason, the score, weariness, and the terms you can offer.
function playerWarBlock(state, f) {
  const w = pwarOf(state, f);
  if (!w) {
    const until = ceasefireUntil(state, f);
    return ceasefireWith(state, f) ? `<div class="muted"${tip("No raids from them on your bases until the ceasefire ends.")}>🕊 Ceasefire with you until day ${until}</div>` : "";
  }
  const main = factionById(state, w.fid);
  if (main !== f) return `<div class="danger">⚔ At war with you beside ${esc(main ? main.name : "their ally")} (${esc(goalText(state, w))})</div>`;
  const wait = talkWait(state, w);
  const via = talkVia(state, f) === "radio" ? "by radio" : "by an envoy under a white flag";
  const opts = termOptions(state, w);
  return `<div class="danger"${tip(`Score: +2 for each of their raids you hold (their weariness +${PW.EXH_HELD}), +4 for each base of theirs you take; +2 to them for a break-in, +3 an overrun, +5 a base taken. Weariness rises with their losses, hunger and deserters (theirs) or your dead and lost bases (yours). Worn out (${PW.TIRED}+) they sue for peace; past ${PW.BROKEN} they pull back.`)}>⚔ <b>At war with you</b> since day ${w.start}${w.by === "you" ? " (you declared it)" : ""}: ${w.by === "you" ? "your goal" : "their goal"} ${esc(goalText(state, w))}${w.by === "them" ? `, over ${esc(cbText(state, w))}` : ""}${w.allies.length ? `; ${w.allies.map((id) => esc(nameOf(state, id))).join(" and ")} fight beside them` : ""}.
      Score ${w.score.you}–${w.score.them} to you · weariness theirs ${Math.round(w.exh.them)}, yours ${Math.round(w.exh.you)} · ${w.raids} war raid${w.raids === 1 ? "" : "s"}${w.sieges ? ` (${w.sieges} siege${w.sieges === 1 ? "" : "s"})` : ""}</div>
    <div class="row small" style="flex-wrap:wrap;gap:0.2rem;margin-top:0.2rem"><span class="muted"${tip(`Sent ${via}. They answer by their type, how worn out they are, the score and what the terms give their goal: the % is the chance they agree. One offer every ${PW.TALK_GAP} days.`)}>Offer terms${wait ? ` (in ${wait} day${wait === 1 ? "" : "s"})` : ""}:</span>
      ${opts.map((o) => `<button class="mini" data-action="pw-terms" data-id="${w.id}" data-key="${o.key}" ${o.why || wait ? "disabled" : ""}${tip(o.why || `${cap(o.text)}. ${Math.round(o.chance * 100)}% they agree.`)}>${esc(o.label)} (${Math.round(o.chance * 100)}%)</button>`).join("")}</div>`;
}
// Declare war on them (with a goal), or why you cannot.
function declareRow(state, f) {
  if (pwarOf(state, f)) return "";
  const why = playerDeclareProblem(state, f);
  if (!f.known || !f.alive) return "";
  return `<select class="mini" data-action="pw-goal" data-id="${f.id}"${tip("Your war goal: tribute (they pay when worn out), land (they hand over a base), or to break them (no terms short of their surrender)")}>${[["tribute", "for tribute"], ["land", "for land"], ["break", "to break them"]].map(([k, l]) => `<option value="${k}" ${(declareGoal[f.id] || "tribute") === k ? "selected" : ""}>${l}</option>`).join("")}</select>
    <button class="mini" data-action="pw-declare" data-id="${f.id}" ${why ? "disabled" : ""}${tip(why || `${f.name} turn hostile (goodwill ${PW.YOU_DECLARE_GW}), the pact and any trade route end, their bloc comes in on their side, groups friendly with them think less of you${isAggressive(f) && attitude(f) === "Hostile" ? "" : ` and infamy +${PW.INFAMY}`}. Their raids come oftener; peace by terms or weariness.`)}>Declare war</button>`;
}
const declareGoal = {}; // the goal picked in each group's card (the UI only)
const isAggressive = (f) => f.type === "raider" || f.type === "expansionist" || f.type === "zealot";
// Their arsenal (sim/arsenal.js): a rough read, the exact list when they are friendly, have a pact with you, or you
// fought them or watched their camp in the last month.
function arsenalLine(state, f) {
  const t = arsenalText(state, f);
  if (!t) return "";
  const exact = arsenalKnown(state, f);
  return `<div class="muted"${tip(exact ? "What they fight with, piece by piece: friends tell you, and a fight or a look at their camp shows you (for a month). Everything they scavenge, buy, steal or pick up off a battlefield is theirs to use; what they lose is gone." : "A rough read of their arms. Friendly groups and pact partners tell you exactly; so does a fight with them or watching their camp (for a month).")}>🔫 ${esc(t)}</div>`;
}
// Hardcore mode (sim/hardcore-groups.js): bands on the road you have met or seen, and how many you have not.
export function bandsSection(state) {
  const all = bandsOf(state);
  if (!all.length) return "";
  const known = knownBands(state);
  const unknown = all.length - known.length;
  const cards = known.map((b) => {
    const i = bandInfo(state, b);
    return `<div class="card small">
      <div class="spread"><b><span class="swatch" style="background:${b.color}"></span>${esc(b.name)}</b><span style="color:${attColor(i.attitude)}">${i.attitude}</span></div>
      <div class="muted">${esc(i.label)} · about ${i.pop} people · no base yet</div>
      <div>${esc(i.seen)}${i.dest ? ` · ${esc(i.dest)}` : ""}</div>
      <div class="row" style="margin-top:0.25rem"><button class="mini" data-action="center" data-tile="${i.tile}"${tip("Center the map where they were last seen")}>Locate</button></div>
    </div>`;
  }).join("");
  return `<h3${tip("Groups that have not founded their hub yet: they walk to a site their kind likes and settle within a few weeks. Meet one with a team to talk; what they think of you then carries over to the group.")}>On the road</h3>${cards}${unknown ? `<div class="muted small">${unknown} band${unknown === 1 ? " is" : "s are"} on the road somewhere, not yet met.</div>` : ""}`;
}

// Wants and surplus, one line each (this week's lists).
function marketLine(m) {
  const w = m.wants.map((x) => `${x.qty} ${x.key} <span class="muted">(${p1(x.price)})</span>`).join(", ");
  const s = m.surplus.map((x) => `${x.qty} ${x.key} <span class="muted">(${p1(x.price)})</span>`).join(", ");
  return `<div${tip(`This week's lists (day ${m.day}), from their stock: what they want (they pay per unit, before Speech) and what they have spare (they charge per unit).`)}><span class="muted">Wants:</span> ${w || "nothing much"}</div><div><span class="muted">Spare:</span> ${s || "nothing"}</div>`;
}

// ---------- radio panel ----------
export function radioDiploBlock(state, f) {
  if (!f || !f.alive) return "";
  const m = marketOf(state, f);
  const wars = warsOf(state, f);
  const member = isMember(state, f);
  const inv = member ? "" : inviteProblem(state, f);
  const rows = (list, side) => list.map((x) => `<tr><td>${esc(SUPPLIES[x.key].name)}</td><td>${x.qty}</td><td>${p1(x.price)} ${ARROW[priceTrend(f, x.key, side)]}</td></tr>`).join("");
  return `<div class="grid2" style="margin-top:0.5rem">
    <div><h3${tip(`This week's list (day ${m.day}): what they would buy, the most wanted first, and the price per unit for a lot of the usual size (before Speech).`)}>They want</h3>
      ${m.wants.length ? `<table class="t"><tr><th>Good</th><th>Qty</th><th>Pays</th></tr>${rows(m.wants, "pay")}</table>` : `<div class="muted small">Nothing they are short of.</div>`}</div>
    <div><h3${tip("What they can spare and what they charge per unit.")}>They have spare</h3>
      ${m.surplus.length ? `<table class="t"><tr><th>Good</th><th>Qty</th><th>Charges</th></tr>${rows(m.surplus, "ask")}</table>` : `<div class="muted small">Nothing to spare.</div>`}</div>
  </div>
  <div class="small" style="margin-top:0.4rem">
    ${f.atWar ? `<div class="danger"${tip("At war: they pay 35% more for ammo and meds, 30% more for weapons and armor, and keep twice their reserve (less to trade). Selling arms to one side costs a little goodwill with the other.")}>⚔ At war with ${wars.map((w) => esc(nameOf(state, enemyIn(w, f)))).join(", ")}: ammo and meds fetch 35% more here.</div>` : ""}
    ${member ? `<div class="good">🤝 Member of ${esc(ALLIANCE.NAME)}</div>` : ""}
    ${arsenalLine(state, f)}
  </div>
  <div class="row" style="margin-top:0.3rem">
    <button class="mini" data-action="dp-open" data-tab="market"${tip("Every group in reach, best price first")}>Market board</button>
    <button class="mini" data-action="dp-open" data-tab="affairs"${tip("Wars and pacts between the groups")}>World affairs</button>
    ${member ? "" : `<button class="mini" data-action="al-invite" data-id="${f.id}" ${inv ? "disabled" : ""}${tip(inviteTip(state, f, inv))}>Invite to the coalition</button>`}
    ${volAskButton(state, f)}
  </div>`;
}

// ---------- the Diplomacy window ----------
const TABS = [["jobs", "Jobs"], ["market", "Market board"], ["affairs", "World affairs"], ["coalition", "Coalition & goals"]];
export function diplomacyModal(state, ui) {
  const d = ui.diplo || { tab: "jobs" };
  const body = d.tab === "market" ? marketTab(state, ui) : d.tab === "affairs" ? affairsTab(state) : d.tab === "coalition" ? coalitionTab(state) : jobsBlock(state, false);
  return `<div class="box wide"><h1>🤝 Diplomacy</h1>
    <div class="tabs">${TABS.map(([k, l]) => `<button data-action="dp-tab" data-tab="${k}" class="${d.tab === k ? "active" : ""}">${l}</button>`).join("")}</div>
    ${ui.diploMsg ? `<div class="result">${esc(ui.diploMsg)}</div>` : ""}
    ${body}
    <div class="row" style="margin-top:0.8rem;justify-content:flex-end"><button class="primary" data-action="dp-close">Close</button></div></div>`;
}

function marketTab(state, ui) {
  const key = SUPPLIES[ui.marketKey] ? ui.marketKey : "meds";
  const side = ui.marketSide === "buy" ? "buy" : "sell";
  const rows = marketBoard(state, key, side);
  const sel = `<select data-action="mk-good">${SUPPLY_KEYS.map((k) => `<option value="${k}" ${k === key ? "selected" : ""}>${esc(SUPPLIES[k].name)}</option>`).join("")}</select>`;
  const h = hub(state);
  const sideBtn = (v, l, t) => `<button class="mini ${side === v ? "active" : ""}" data-action="mk-side" data-v="${v}"${tip(t)}>${l}</button>`;
  return `<div class="row small">Good: ${sel} ${sideBtn("sell", "Best to sell to", "Who pays you most per unit")} ${sideBtn("buy", "Best to buy from", "Who charges least per unit")}
      <span class="muted">${esc(h ? h.name : "")} has ${Math.floor((h && h.stock[key]) || 0)} ${esc(key)} · prices per unit for a lot of ${LOT[key] || 10}, before Speech</span></div>
    ${!hasNetwork(state) ? `<div class="muted small" style="margin-top:0.4rem">You need a radio station to hear the market.</div>` : rows.length ? `<table class="t" style="margin-top:0.4rem">
      <tr><th>Group</th><th${tip("What they pay you per unit")}>They pay</th><th${tip("What they charge per unit")}>They charge</th><th>Want</th><th>Spare</th><th></th></tr>
      ${rows.map((r) => `<tr><td><span class="swatch" style="background:${r.f.color}"></span>${esc(r.f.name)}${r.atWar ? ` <span class="danger"${tip("At war: ammo and meds 35% dearer both ways, weapons and armor 30%")}>⚔</span>` : ""}</td>
        <td>${p1(r.pay)} ${side === "sell" ? ARROW[r.trend] : ARROW[priceTrend(r.f, key, "pay")]}</td><td>${p1(r.ask)} ${side === "buy" ? ARROW[r.trend] : ARROW[priceTrend(r.f, key, "ask")]}</td>
        <td>${r.want || "—"}</td><td>${r.spare || "—"}</td><td><button class="mini" data-action="dp-radio" data-id="${r.f.id}"${tip("Open their radio panel to make a deal")}>Radio…</button></td></tr>`).join("")}</table>` :
      `<div class="muted small" style="margin-top:0.4rem">No group you know is in radio reach (or every one in reach is hostile).</div>`}
    <h3>Shortages and news</h3>${newsList(state, 6)}`;
}

function newsList(state, n) {
  const list = ensureDiplo(state).news.filter((x) => x.heard).slice(0, n);
  return list.length ? `<div class="small">${list.map((x) => `<div><span class="muted">Day ${x.day}</span> ${esc(x.text)}</div>`).join("")}</div>` : `<div class="muted small">Nothing heard yet${hasNetwork(state) ? "" : " (news comes over the radio)"}.</div>`;
}

function affairsTab(state) {
  const D = ensureDiplo(state);
  const known = state.factions.filter((f) => f.alive && f.known);
  const wars = D.wars.filter((w) => { const a = factionById(state, w.a), b = factionById(state, w.b); return (a && a.known) || (b && b.known); });
  const warRow = (w) => {
    const a = factionById(state, w.a), b = factionById(state, w.b);
    const info = brokerInfo(state, w);
    const side = (f) => {
      const why = joinProblem(state, w, f);
      return `<button class="mini" data-action="war-join" data-id="${w.id}" data-side="${f.id}" ${why ? "disabled" : ""}${tip(why || `Fight beside ${f.name}: ${esc(nameOf(state, enemyIn(w, f)))} turns hostile and may raid you; a share of the tribute and any land if you win`)}>Join ${esc(nameOf(state, f.id))}</button>`;
    };
    return `<div class="card small">
      <div class="spread"><b>⚔ ${esc(nameOf(state, w.a))} vs ${esc(nameOf(state, w.b))}</b><span class="muted">since day ${w.start} · over ${REASON[w.reason] || w.reason}</span></div>
      <div>Score ${Math.round(w.score[w.a] || 0)} – ${Math.round(w.score[w.b] || 0)} · weariness ${Math.round(w.exh[w.a] || 0)} / ${Math.round(w.exh[w.b] || 0)} · ${w.raids} raid${w.raids === 1 ? "" : "s"}${w.playerSide != null ? ` · <b>you fight beside ${esc(nameOf(state, w.playerSide))}</b>` : ""}</div>
      <div class="row" style="margin-top:0.3rem">
        ${w.playerSide == null ? `<button class="mini" data-action="war-broker" data-id="${w.id}" ${info.ok ? "" : "disabled"}${tip(info.ok ? `Speech check by radio: ${pct(info.chance)}. Success: a ceasefire, +8 goodwill with both and a thank-you. Failure: −3 with both` : info.why)}>Broker a ceasefire${info.ok ? ` (${pct(info.chance)})` : ""}</button>${a ? side(a) : ""}${b ? side(b) : ""}` :
          `<button class="mini" data-action="war-leave" data-id="${w.id}"${tip("Pull out: −8 goodwill with your side; the enemy stays as it is")}>Leave the war</button>`}
      </div></div>`;
  };
  const relCell = (a, b) => {
    if (a === b) return `<td class="muted">·</td>`;
    const r = relation(state, a, b);
    const color = r <= -42 ? "var(--danger)" : r < 0 ? "#e8a33d" : r >= 28 ? "var(--good)" : "var(--muted)";
    const war = warsOf(state, a).some((w) => enemyIn(w, a) === b.id);
    return `<td style="color:${color}"${tip(`${a.name} and ${b.name}: ${Math.round(r)} (${relWord(r)})${war ? ", at war" : ""}`)}>${war ? "⚔" : Math.round(r)}</td>`;
  };
  const P = ensurePwars(state);
  const B = ensureBlocs(state);
  const pwRow = (w) => {
    const f = factionById(state, w.fid);
    return `<div class="card small"><div class="spread"><b class="danger">⚔ ${esc(f ? f.name : "?")} vs you</b><span class="muted">since day ${w.start}${w.by === "you" ? " · you declared it" : ""}</span></div>
      <div>${w.by === "you" ? "Your goal" : "Their goal"}: ${esc(goalText(state, w))}${w.by === "them" ? ` · over ${esc(cbText(state, w))}` : ""}${w.allies.length ? ` · with ${w.allies.map((id) => esc(nameOf(state, id))).join(", ")}` : ""}</div>
      <div>Score ${w.score.you}–${w.score.them} to you · weariness theirs ${Math.round(w.exh.them)}, yours ${Math.round(w.exh.you)} · ${w.raids} war raid${w.raids === 1 ? "" : "s"} (${w.held} held, ${w.broken} broken in)${w.sieges ? ` · ${w.sieges} siege${w.sieges === 1 ? "" : "s"}` : ""}</div>
      <div class="muted">Offer terms from their card in the Groups tab.</div></div>`;
  };
  const visibleBlocs = B.blocs.filter((b) => blocMembers(state, b).some((m) => m.known));
  const blocRow = (b) => `<div class="card small"><div class="spread"><b>${swatch(b.color)}${esc(cap(blocTitle(b)))}</b><span class="muted">since day ${b.founded}</span></div>
    <div>${blocMembers(state, b).map((m) => `${swatch(m.color)}${esc(nameOf(state, m.id))}`).join(" · ")}</div>
    <div class="muted">Against ${esc(foeText(state, b.foe))} · helped a member ${b.helps || 0} time${b.helps === 1 ? "" : "s"} · raided together ${b.joint || 0} time${b.joint === 1 ? "" : "s"}${b.player ? ` · <span class="good">you stand with them</span>` : ""}</div></div>`;
  const pwEnded = P.pwarEnded.slice(0, 6).map((e) => `<div>Days ${e.start}–${e.end}: ${esc(nameOf(state, e.fid))} vs you (${esc(goalText(state, e))}): ${HOW[e.how] || e.how}${e.terms.length > 1 ? ` (${e.terms.filter((k) => k !== "ceasefire").join(", ")})` : ""}</div>`).join("");
  const blocNews = B.blocLog.filter((x) => x.heard).slice(0, 8).map((x) => `<div><span class="muted">Day ${x.day}</span> ${esc(x.text)}</div>`).join("");
  return `<h3${tip("A war on you has a goal (loot, a base of yours, revenge, conversion, to break a rival) and a reason from what you did to them. Their raids come oftener, with sieges at the base they want; your caravans and teams near their land are hunted. It ends on terms, theirs or yours, or when a side is worn out.")}>Wars with you</h3>
    ${P.pwars.length ? P.pwars.map(pwRow).join("") : `<div class="muted small">Nobody is at war with you.</div>`}
    ${pwEnded ? `<div class="small muted">${pwEnded}</div>` : ""}
    <h3${tip("Groups that share a threat (a common enemy, you, a hive, prey) and like each other ally by their type: traders, communes and fortresses readily, the military with order-keeping types, raiders only in loose gangs with raiders, zealots only with their own. Members defend each other, raid together, share what they know and trade first with each other. A bloc breaks when its members fall out, one betrays another, or the danger has passed.")}>Blocs</h3>
    ${visibleBlocs.length ? visibleBlocs.map(blocRow).join("") : `<div class="muted small">No blocs you know of.</div>`}
    ${blocNews ? `<div class="small">${blocNews}</div>` : ""}
    <h3${tip("Groups at war raid each other and lay sieges; most wars end in terms (land or tribute) or a white peace. A group at war pays more for ammo, meds and weapons and has less to trade.")}>Wars between groups</h3>
    ${wars.length ? wars.map(warRow).join("") : `<div class="muted small">No wars you know of.</div>`}
    ${D.ended.length ? `<div class="small muted">${D.ended.slice(0, 6).filter((e) => { const a = factionById(state, e.a), b = factionById(state, e.b); return (a && a.known) || (b && b.known); }).map((e) => `<div>Days ${e.start}–${e.end}: ${esc(nameOf(state, e.a))} vs ${esc(nameOf(state, e.b))}: ${TERMS[e.terms] || e.terms}</div>`).join("")}</div>` : ""}
    <h3${tip("How the groups you know feel about each other (−100 to 100). Below −42 they may go to war; 28+ they may sign a pact. Neighbours rub each other the wrong way.")}>Relations between groups</h3>
    ${known.length >= 2 ? `<table class="t small"><tr><th></th>${known.map((f) => `<th${tip(f.name)}><span class="swatch" style="background:${f.color}"></span></th>`).join("")}</tr>
      ${known.map((a) => `<tr><td><span class="swatch" style="background:${a.color}"></span>${esc(a.name)}</td>${known.map((b) => relCell(a, b)).join("")}</tr>`).join("")}</table>` : `<div class="muted small">You need to know at least two groups.</div>`}
    <h3>Pacts</h3>
    ${D.pacts.filter((p) => factionById(state, p.a)?.known || factionById(state, p.b)?.known).map((p) => `<div class="small">${esc(nameOf(state, p.a))} ↔ ${esc(nameOf(state, p.b))} <span class="muted">since day ${p.since}</span></div>`).join("") || `<div class="muted small">No pacts you know of.</div>`}
    <h3>Heard on the radio</h3>${newsList(state, 10)}`;
}

function coalitionTab(state) {
  const A = ensureAlliance(state);
  const ms = allianceMembers(state);
  const others = state.factions.filter((f) => f.alive && f.known && !isMember(state, f));
  return `${goalsCard(state, goalsProgress(state), false)}
    <h3${tip(`Invite a group when it is in radio reach (its base within your radio coverage + 6 tiles: your stations and the linked relays at your bases; or a team at its gates, a base of yours within ${ALLIANCE.NEIGHBOUR} tiles, a member within ${ALLIANCE.MEMBER_RELAY}), its goodwill is ${ALLIANCE.GOODWILL}+, it has a pact with you and you did a job for it (or the council votes it in). Members share sightings, send fighters against raids and hordes coming for your bases, join your hive assaults and sit in the council each season.`)}>${esc(A.name)}</h3>
    ${ms.length ? `<table class="t small"><tr><th>Member</th><th>Goodwill</th><th>Since</th><th>Bases</th><th></th></tr>${ms.map((f) => `<tr><td><span class="swatch" style="background:${f.color}"></span>${esc(f.name)}</td><td style="color:${attColor(attitude(f))}">${Math.round(f.goodwill)}</td><td>day ${A.joined[f.id] ?? "?"}</td><td>${f.bases.length}</td>
      <td><button class="mini" data-action="job-locate" data-tile="${f.bases[0]}">Locate</button> <button class="mini" data-action="al-expel" data-id="${f.id}"${tip("Throw them out: −15 goodwill")}>Expel</button></td></tr>`).join("")}</table>
      <div class="small muted">Next council: day ${nextCouncilDay(state)} (every ${ALLIANCE.COUNCIL_EVERY} days, at the start of a season).</div>` : `<div class="muted small">No members yet.</div>`}
    <h3>Invite</h3>
    ${others.length ? `<table class="t small"><tr><th>Group</th><th>Goodwill</th><th>Pact</th><th>Jobs done</th><th>Council vote</th><th></th></tr>${others.map((f) => {
      const why = inviteProblem(state, f);
      const v = councilVote(state, f);
      return `<tr><td><span class="swatch" style="background:${f.color}"></span>${esc(f.name)}</td><td style="color:${attColor(attitude(f))}">${Math.round(f.goodwill)}</td><td>${f.pact ? "yes" : "no"}</td>
        <td>${ensureJobs(state).list.filter((j) => j.fid === f.id && j.status === "done").length}</td><td>${v.yes + v.no ? `${v.yes} of ${v.yes + v.no}` : "—"}</td>
        <td><button class="mini" data-action="al-invite" data-id="${f.id}" ${why ? "disabled" : ""}${tip(inviteTip(state, f, why))}>Invite</button>${why ? ` <span class="muted">${esc(why)}</span>` : ""}</td></tr>`;
    }).join("")}</table>` : `<div class="muted small">Every group you know is already in.</div>`}
    ${blocsToInvite(state)}
    ${A.history.length ? `<h3>Coalition record</h3><div class="small">${A.history.slice(0, 10).map((h) => `<div><span class="muted">Day ${h.day}</span> ${esc(h.text)}</div>`).join("")}</div>` : ""}`;
}

// The blocs you could invite whole (sim/blocs.js): each with its members and the vote it would hold today.
function blocsToInvite(state) {
  if (state.noBlocs) return "";
  const list = (ensureBlocs(state).blocs || []).filter((b) => blocInviteButton(state, b));
  if (!list.length) return "";
  return `<h4${tip(VOTE_RULE)}>Blocs</h4>${list.map((b) => `<div class="small">${swatch(b.color)}${esc(cap(blocTitle(b)))}: ${blocMembers(state, b).map((m) => esc(nameOf(state, m.id))).join(", ")}${blocInviteButton(state, b)}</div>`).join("")}`;
}

// ---------- handlers (main.js registers them) ----------
export const DIPLO_ACTIONS = {
  "dp-open": (state, ui, d) => { ui.diplo = { tab: d.tab || "jobs" }; ui.diploMsg = ""; },
  "dp-tab": (state, ui, d) => { ui.diplo = { tab: d.tab || "jobs" }; ui.diploMsg = ""; },
  "dp-close": (state, ui) => { ui.diplo = null; ui.diploMsg = ""; },
  // These close the window and use main.js's own handlers (actions): the planner, the map, the radio panel.
  "job-plan": (state, ui, d, actions) => { ui.diplo = null; if (actions && actions.plan) actions.plan(d); },
  "job-locate": (state, ui, d, actions) => { ui.diplo = null; if (actions && actions.center) actions.center(d); },
  "dp-radio": (state, ui, d, actions) => { ui.diplo = null; if (actions && actions["rd-open"]) actions["rd-open"](d); },
  "job-accept": (state, ui, d) => { ui.diploMsg = acceptJob(state, Number(d.id)); dropOfferCard(state, d.id); },
  "job-decline": (state, ui, d) => { ui.diploMsg = declineJob(state, Number(d.id)); dropOfferCard(state, d.id); },
  "job-abandon": (state, ui, d) => {
    if (ask(ui, d, "job-abandon", { kind: "giveup", title: "Give up this job?", text: "It counts as failing it: the group that offered it thinks less of you (goodwill), and the reward is lost.", yes: "Give it up" })) return;
    ui.diploMsg = abandonJob(state, Number(d.id));
  },
  "job-pickup": (state, ui, d) => { ui.diploMsg = requestPickup(state, Number(d.id)); },
  "mk-side": (state, ui, d) => { ui.marketSide = d.v === "buy" ? "buy" : "sell"; },
  "war-broker": (state, ui, d) => { ui.diploMsg = brokerCeasefire(state, Number(d.id)); },
  "war-join": (state, ui, d) => {
    const w = warById(state, Number(d.id)), foe = w ? enemyIn(w, factionById(state, Number(d.side))) : null;
    if (ask(ui, d, "war-join", { kind: "war", title: `Join the war beside ${nameOf(state, Number(d.side))}?`, text: `${foe != null ? nameOf(state, foe) : "Their enemy"} turns hostile and may raid you. If your side wins you get a share of the tribute and any land; leaving later costs goodwill with your side.`, yes: "Join the war" })) return;
    ui.diploMsg = joinWar(state, Number(d.id), Number(d.side));
  },
  "war-leave": (state, ui, d) => {
    if (ask(ui, d, "war-leave", { kind: "war", title: "Leave the war?", text: "Your side thinks less of you (goodwill −8); the enemy stays as it is.", yes: "Leave the war" })) return;
    ui.diploMsg = leaveWar(state, Number(d.id));
  },
  "pw-declare": (state, ui, d) => {
    const f = factionById(state, Number(d.id));
    if (!f) return;
    const goal = declareGoal[f.id] || "tribute";
    if (ask(ui, d, "pw-declare", { kind: "war", title: `Declare war on ${f.name}?`, text: `${f.name} turn hostile and raid you oftener until a peace; their bloc comes in on their side; their friends think less of you. Your goal: ${goal === "land" ? "a base of theirs" : goal === "break" ? "to break them" : "tribute"}.`, yes: "Declare war" })) return;
    ui.diploMsg = declareByPlayer(state, f, goal); // the log has it too
  },
  "pw-terms": (state, ui, d) => { ui.diploMsg = offerTerms(state, Number(d.id), d.key); }, // the log has it too
  "bloc-leave": (state, ui, d) => {
    if (ask(ui, d, "bloc-leave", { kind: "war", title: "Leave their side?", text: `Their fighters stop coming to your bases, and each member thinks less of you (${BLOC.LEAVE_GW}).`, yes: "Leave" })) return;
    ui.diploMsg = leaveBlocSide(state, Number(d.id));
  },
  "al-invite-bloc": (state, ui, d) => { ui.diploMsg = inviteBloc(state, Number(d.id)); },
  "al-invite": (state, ui, d) => { const f = factionById(state, Number(d.id)); const msg = f ? inviteToAlliance(state, f) : ""; if (ui.radioWith != null) ui.radioMsg = msg; else ui.diploMsg = msg; },
  "al-expel": (state, ui, d) => {
    const f = factionById(state, Number(d.id));
    if (!f || ask(ui, d, "al-expel", { kind: "expel", title: `Expel ${f.name} from the coalition?`, text: `They leave the coalition and its land count at once, and think much less of you (goodwill −15).`, yes: "Expel them" })) return;
    ui.diploMsg = expel(state, f);
  },
};
export const DIPLO_CHANGE = {
  "mk-good": (state, ui, el) => { if (SUPPLIES[el.value]) ui.marketKey = el.value; },
  "pw-goal": (state, ui, el) => { const id = Number(el.dataset && el.dataset.id); if (Number.isFinite(id) && ["tribute", "land", "break"].includes(el.value)) declareGoal[id] = el.value; },
};
// The offer's card goes once the job is answered from the list.
function dropOfferCard(state, id) {
  const i = state.cards.findIndex((c) => c.jobId === Number(id));
  if (i >= 0) state.cards.splice(i, 1);
}
// For the map (render.js): active jobs with a place, as { tile, icon, label }.
export function jobPins(state) {
  if (!state.jobs) return [];
  const out = [];
  for (const j of state.jobs.list) {
    if (j.status !== "active") continue;
    const tile = jobTile(state, j);
    if (tile == null) continue;
    out.push({ tile, icon: JOB_TYPES[j.type].icon, label: `${JOB_TYPES[j.type].name} (${factionById(state, j.fid)?.name || "?"})` });
  }
  return out;
}
// For the planner's "Move to a site" list (ui/plan.js): the targets of your jobs, as { tile, name, job }.
export function jobTargets(state) {
  return jobPins(state).map((p) => ({ tile: p.tile, name: `${p.icon} Job: ${p.label} at ${tileLabel(state, p.tile)}`, job: true }));
}
// A line at the top of the planner when the target is a job of yours.
export function plannerJobNote(state, tile) {
  const js = (state.jobs ? state.jobs.list : []).filter((j) => j.status === "active" && jobTile(state, j) === tile);
  return js.length ? `<div class="small good" style="margin:-0.3rem 0 0.4rem">${js.map((j) => `${JOB_TYPES[j.type].icon} A job for ${esc(factionById(state, j.fid)?.name || "?")}: ${esc(JOB_TYPES[j.type].name)} (by day ${j.deadline}). ${esc(jobProgress(state, j))}`).join("<br>")}</div>` : "";
}
export { jobById, warById, canRadioGroup };
