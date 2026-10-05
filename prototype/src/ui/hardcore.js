// No base in the panels: hardcore before the first hub (sim/hardcore-start.js) and the exiles after losing every base
// (sim/conquest.js). The survivors are teams on the road building a staging camp (sim/staging.js), so the top bar, the
// Bases tab, the Goals card, the alerts and the tile panel show the team and the camp (what it still needs, how far
// the work is) instead of a base.
import { SUPPLIES } from "../sim/data.js";
import { partyMembers, partyTile, carried, planPath, partySpeed, tileLabel, teamName } from "../sim/parties.js";
import { thirstAt } from "../sim/weather.js";
import { roadTeam, hubSites } from "../sim/hardcore-start.js";
import { stagingView, needText, ESTABLISH_LABEL, STAGING, storesText, isWorking, storeOf, stagesText, waterText } from "../sim/staging.js";
import { MODES, isHardcore } from "../sim/hardcore.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const r1 = (v) => Math.round((v || 0) * 10) / 10;
const pct = (f) => `${Math.round((f || 0) * 100)}%`;
const bar = (f, color) => `<div class="bar" style="height:6px;background:rgba(255,255,255,0.08);border-radius:3px;margin-top:0.3rem"><div style="height:100%;width:${Math.round(Math.max(0, Math.min(1, f)) * 100)}%;background:${color};border-radius:3px"></div></div>`;

export const modeLabel = (state) => (MODES[isHardcore(state) ? "hardcore" : "normal"] || MODES.normal).label;

// The view plus the team the panels follow: hardcore's road team (you are with it), else the first team on the road.
function view(state) {
  const v = stagingView(state);
  if (!v) return null;
  const p = roadTeam(state) || v.teams[0] || null;
  return { ...v, p, people: p ? partyMembers(state, p).length : 0, tile: p ? partyTile(p) : v.camp ? v.camp.tile : null, title: v.first ? "Your first hub" : "A new hub" };
}
// Days of food and water the team carries at today's thirst.
function teamDays(state, p) {
  const n = Math.max(1, partyMembers(state, p).length);
  return { food: (carried(p, "food") + carried(p, "preserved")) / n, water: carried(p, "water") / (n * thirstAt(state)) };
}
const missText = (rows) => rows.map((r) => `${r.short} ${r.key}`).join(", ");
const work3 = (v) => r1((v.camp ? v.camp.work : (v.first ? STAGING.HARDCORE : STAGING.EXILE).work) / (3 * (STAGING.DAY[1] - STAGING.DAY[0])));
// One line on the camp: built, missing, workers.
function campLine(v) {
  if (!v.camp) return `No camp yet: give a team the order ${ESTABLISH_LABEL} on a good spot.`;
  const c = v.camp;
  return `Staging camp ${pct(v.pct)} built${v.miss.length ? `; still needs ${missText(v.miss)}` : "; everything is in"}${v.workers ? `; ${v.workers} at work, about ${r1(v.left)} days left` : v.done ? "" : "; nobody at work"}.${c.looted ? ` Looted ${c.looted} time${c.looted === 1 ? "" : "s"}.` : ""}`;
}

// The top bar's stock slot while there is no base: what the team carries, and the camp.
export function roadStock(state) {
  const v = view(state);
  if (!v || !v.p) return null;
  const d = teamDays(state, v.p);
  const cell = (k, extra = "") => `<span${tip(`${SUPPLIES[k].name} the team carries (packed and found). ${extra}`)}><b>${SUPPLIES[k].name}</b>${n0(carried(v.p, k) + (k === "food" ? carried(v.p, "preserved") : 0))}</span>`;
  const head = v.first ? `Hardcore: no hub yet. Your ${v.people} survivors are a team on the road; you are with them, so they always take orders.` : "You have no base left: your people are on the road.";
  const campCell = v.camp
    ? `<span class="${v.miss.length ? "warn" : "good"}"${tip(`${campLine(v)} Stores at the camp: ${storesText(v.camp) || "nothing yet"}.`)}>Camp ${pct(v.pct)}${v.miss.length ? ` · needs ${esc(missText(v.miss))}` : " · all in"}</span>`
    : `<span class="muted"${tip(`Give a team the order ${ESTABLISH_LABEL} where the hub should stand: a staging camp that needs ${needText(v.needs)} brought in, then about ${work3(v)} days of work for three.`)}>No camp yet</span>`;
  return `<span class="${v.first ? "warn" : "danger"}"${tip(`${head} ${ESTABLISH_LABEL} pitches a staging camp you build up into your hub.`)}>On the road</span>` +
    cell("food", `About ${r1(d.food)} days for the team.`) + cell("water", `About ${r1(d.water)} days for the team at today's thirst.`) + cell("scrap") + cell("parts") + cell("ammo") + cell("meds") + campCell;
}

// The camp's card body: stores against needs, the work, workers, dangers.
function campBody(state, v) {
  const c = v.camp;
  const rows = v.rows.map((r) => `<div>${esc(SUPPLIES[r.key].name)}</div><div class="${r.ok ? "good" : ""}">${r.have} / ${r.need}${r.ok ? " ✓" : ` <span class="muted">(${r.short} more)</span>`}</div>`).join("");
  const left = v.workers ? `${v.workers} at work · about ${r1(v.left)} days left` : v.done ? "the building is done" : `nobody at work (${r1(v.leftFor3)} days for three)`;
  const capped = !v.done && v.capPct < 1 ? ` · materials for ${pct(v.capPct)}` : "";
  return `<div class="kv small" style="margin-top:0.4rem">
      <div${tip("Where the camp stands. Click to center the map on it.")}>Camp</div><div><a class="link" data-action="center" data-tile="${c.tile}">${esc(tileLabel(state, c.tile))}</a> · day ${c.started}</div>
      ${rows}
      <div${tip(`Work: daylight hours (${STAGING.DAY[0]}:00–${STAGING.DAY[1]}:00), 1 an hour a worker (+3% a Mechanics point, less when hurt or sick). It goes on as far as the scrap and parts in the stores allow; the hub stands once the work is done and the stores hold everything.`)}>Built</div><div>${pct(v.pct)}${capped}</div>
      <div>Work</div><div class="${v.workers ? "good" : "muted"}">${esc(left)}</div>
      ${v.away >= 1 && !v.present ? `<div${tip(`Nobody at the camp. After ${STAGING.ABANDON} days alone it may be looted: part of the stores and of the barricade lost.`)}>Alone</div><div class="${v.away >= STAGING.ABANDON ? "danger" : "warn"}">${Math.floor(v.away)} day${Math.floor(v.away) === 1 ? "" : "s"}</div>` : ""}
      ${v.threats.length ? `<div${tip("People working on one spot draw the dead and raiders (Heat). Hordes nearby may walk in.")}>Threats</div><div class="danger">${esc(v.threats.join("; "))}</div>` : ""}
      ${stageRows(v.tier)}
      <div${tip("No spring at a camp: beside a river or lake the people there drink from it and haul water into the stores; anywhere else every drop is carried in (Fetch water at a shore, or found searching).")}>Water</div><div class="${v.riverside ? "good" : "warn"}">${esc(v.water)}${v.riverside ? " · they drink from it" : " · carried in"}</div>
      ${dangerRows(v.danger, v.fire, `data-camp="1"`)}
    </div>${bar(v.pct, v.done ? "#6fbf73" : "#d9a520")}`;
}
// The three stages and what the next one takes (sim/staging.js tierInfo).
export function stageRows(t) {
  if (!t) return "";
  return `<div${tip("Your home grows in three stages: a staging camp, a shelter you can live at (tier 0), then a base (the hub). Each step takes materials and work.")}>Stage</div><div>${esc(stagesText(t.stage))}</div>${t.next ? `<div>Next: ${esc(t.next)}</div><div class="muted">${esc(t.needs)}</div>` : ""}`;
}
// The camp's danger: Heat an hour by cause (the fire, the people, vehicles, shooting lately, the work), where it
// settles, and the fire toggle (sim/fieldheat.js CAMP_HEAT). attrs: what the toggle acts on.
export function dangerRows(d, lit, attrs) {
  if (!d) return "";
  const why = "A camp's Heat comes from what it does: its fire (light and smoke carry, most at night), the people there, vehicles parked there (raiders want them) and any shooting at or next to it lately (fading over a day or two). It settles where what it adds an hour meets what fades (3% an hour). The higher it sits, the likelier the dead or raiders find it.";
  return `<div${tip(why)}>Danger</div><div class="${d.empty ? "muted" : d.settles >= 60 ? "danger" : d.settles >= 35 ? "warn" : ""}">${d.empty ? esc(d.text) : `+${r1(d.gain)} Heat an hour, settles near ${Math.round(d.settles)} (now ${Math.round(d.heat)}): ${esc(d.text)}`}</div>
    <div${tip("The camp fire: warmth (far less cold sickness), hot food and boiled water (no stomach bugs from raw food), better spirits. Its light and smoke raise the camp's danger, most at night.")}>Fire</div><div>${lit ? "Lit" : "Out"} ${fireButton(lit, attrs)}</div>`;
}
export const fireButton = (lit, attrs) => `<button class="mini" data-action="campfire" ${attrs} data-lit="${lit ? 0 : 1}"${tip(lit ? "Put the fire out: darker and quieter (less danger, most at night), but cold, raw food and unboiled water, lower spirits." : "Light the fire: warmth, hot food, boiled water and better spirits, but its light and smoke draw attention, most at night.")}>${lit ? "Put it out" : "Light it"}</button>`;

// The Bases tab with no base: the staging camp's card (or how to start one, and the best spots near the team).
export function firstHubCard(state) {
  const v = view(state);
  if (!v) return "";
  const d = v.p ? teamDays(state, v.p) : null;
  const spots = !v.camp && v.tile != null ? hubSites(state, v.tile, 4).slice(0, 3) : [];
  const spotRows = spots.map((s) => `<div class="row small"><a class="link" data-action="center" data-tile="${s.id}"${tip("Center the map here")}>${esc(tileLabel(state, s.id))}</a><span class="muted">water: ${esc(waterText(state, s.id))} · ${s.sites} site${s.sites === 1 ? "" : "s"} around</span></div>`).join("");
  const intro = v.camp
    ? `Your people are building a staging camp into your ${v.first ? "first " : "new "}shelter (Camp → Shelter → Base). Bring what it still needs (as many trips as it takes; the order at the camp unloads and puts the team to work), and keep people working there: nobody there, no progress. The scrap and parts go into the building; the food and water become the shelter's stores.`
    : `No base ${v.first ? "yet" : "left"}: your ${v.people || ""} survivors are on the road. Pick a good spot (beside a river or lake: there is no spring; sites around, few of the dead) and give a team the order <b>${ESTABLISH_LABEL}</b>: a staging camp that needs ${esc(needText(v.needs))} brought in, then about ${work3(v)} days of work for three. It becomes a shelter you can live at (Camp → Shelter → Base), bare: no buildings, no vehicle.`;
  return `<div class="card attn">
    <div class="spread"><h2 style="margin:0">${v.title}</h2><span class="muted small">${v.first ? "Hardcore" : "On the road"}</span></div>
    <div class="small" style="margin-top:0.3rem">${intro}</div>
    ${v.camp ? campBody(state, v) : ""}
    ${d ? `<div class="kv small" style="margin-top:0.4rem"><div${tip("Days the team's food and water last at today's rate. Thirst kills in a few days: rivers and lakes (Fetch water) and shops, diners and churches have water. Workers at the camp eat from its stores once theirs run out.")}>Team lasts</div><div class="${Math.min(d.food, d.water) < 2 ? "danger" : ""}">food ${r1(d.food)} days · water ${r1(d.water)} days</div></div>` : ""}
    ${spots.length ? `<div class="small muted" style="margin-top:0.4rem"${tip("Spots within 4 tiles of the team rated for a hub: water beside or near, sites to scavenge around, few of the dead and no hive close by.")}>Good spots nearby:</div>${spotRows}` : ""}
    <div class="row" style="margin-top:0.5rem">${v.p ? `<button class="primary" data-action="xp-open" data-id="${v.p.id}"${tip("People, gear, supplies and orders")}>Team panel</button><button data-action="center" data-tile="${v.tile}"${tip("Center the map on the team")}>Locate team</button>` : ""}${v.camp ? `<button data-action="center" data-tile="${v.camp.tile}"${tip("Center the map on the staging camp")}>Locate camp</button>` : ""}</div>
  </div>`;
}

// One line for the Goals card (ui/diplomacy.js) while there is no base.
export function firstHubGoal(state) {
  const v = view(state);
  if (!v) return "";
  const what = v.first ? "found your hub" : "found a new hub";
  if (!v.camp) return `<div class="warn"${tip(`Everything else waits for a hub. ${ESTABLISH_LABEL}: a staging camp that needs ${needText(v.needs)}, then about ${work3(v)} days of work for three.`)}>✗ First: ${what} (${ESTABLISH_LABEL} on a good spot)</div>`;
  return `<div class="${v.miss.length ? "warn" : "good"}"${tip(campLine(v))}>${v.miss.length ? "✗" : "…"} First: ${what}: the staging camp is ${pct(v.pct)} built${v.miss.length ? ` (still missing ${esc(missText(v.miss))})` : v.workers ? ` (${r1(v.left)} days of work left)` : " (nobody at work)"}</div>`;
}

// Alerts (ui/alerts.js): the team running out of food or water on the road, the camp's needs, dangers and neglect.
export function roadAlerts(state, out) {
  const v = view(state);
  if (!v) return;
  const go = v.p ? { team: v.p.id } : v.camp ? { tile: v.camp.tile } : null;
  if (v.p) {
    const d = teamDays(state, v.p);
    // Working at the camp the team eats and drinks from its stores once its own run out (sim/staging.js).
    if (v.camp && isWorking(state, v.p)) {
      const n = Math.max(1, partyMembers(state, v.p).length);
      d.food += storeOf(v.camp, "food") / n;
      d.water += storeOf(v.camp, "water") / (n * thirstAt(state));
    }
    if (d.water < 1.5) out.push({ key: `roadwater:${v.p.id}`, kind: "roadwater", icon: "💧", tone: "danger", text: d.water < 0.05 ? "The team is out of water" : `The team has water for ${r1(d.water)} days`, tip: "Thirst kills in a few days. Fetch water beside a river or lake (team panel), or search a shop, diner, church or campground. Click to open the team panel.", go });
    if (d.food < 1.5) out.push({ key: `roadfood:${v.p.id}`, kind: "roadfood", icon: "🥫", tone: d.food < 0.05 ? "danger" : "warn", text: d.food < 0.05 ? "The team is out of food" : `The team has food for ${r1(d.food)} days`, tip: "Search farms, groceries and diners, hunt or fish. Click to open the team panel.", go });
  }
  if (!v.camp) {
    out.push({ key: "firsthub:0", kind: "firsthub", icon: "🏚", tone: "info", text: v.first ? "No hub yet: establish a base" : "No base left: establish one", tip: `Give a team the order ${ESTABLISH_LABEL} on a good spot (water near, sites around): a staging camp that needs ${needText(v.needs)} brought in, then the work. Click to open the team panel.`, go });
    return;
  }
  const c = v.camp;
  const campGo = { tile: c.tile };
  if (v.threats.length) out.push({ key: `campthreat:${c.id}`, kind: "campthreat", icon: "⚠", tone: "danger", text: `Staging camp in danger: ${v.threats[0]}`, tip: `${v.threats.join("; ")}. The people at the camp are a team on one spot: the dead and raiders find it. Fight, or pull out and come back later. Click to center the map on the camp.`, go: campGo });
  if (!v.present && v.away >= 3) out.push({ key: `campalone:${c.id}`, kind: "campalone", icon: "🏕", tone: v.away >= STAGING.ABANDON ? "danger" : "warn", text: `Nobody at the staging camp for ${Math.floor(v.away)} days`, tip: `Nobody there, no progress. After ${STAGING.ABANDON} days alone scavengers may loot it (part of the stores and of the barricade). Click to center the map on it.`, go: campGo });
  if (v.miss.length) out.push({ key: `campneeds:${missText(v.miss)}`, kind: "firsthub", icon: "🏚", tone: "info", text: `Staging camp needs ${missText(v.miss)}`, tip: `${campLine(v)} Bring it in and give the order at the camp (Unload and work on the camp). Click to center the map on the camp.`, go: campGo });
  else if (!v.workers && !v.done) out.push({ key: `campidle:${c.id}`, kind: "firsthub", icon: "🔨", tone: "good", text: "Everything is in: put a team to work on the camp", tip: `${campLine(v)} Give a team at the camp the order Work on the camp.`, go: campGo });
}

// The tile panel's "From hub" row while there is no base: the walk from the team, and how the tile would do as a hub.
export function fromTeamRow(state, id) {
  const v = view(state);
  if (!v || !v.p) return null;
  const res = v.tile === id ? { cost: 0, path: [id] } : planPath(state, v.tile, id, false);
  const walk = res ? `${res.path.length - 1} tiles · ~${Math.ceil(res.cost / Math.max(0.3, partySpeed(v.p)))}h on foot` : "No route over land";
  const t = state.tiles[id];
  const spot = t.terrain !== "water" && !(v.camp && v.camp.tile === id) ? hubSites(state, id, 0)[0] : null;
  const note = spot ? `<div${tip("How this tile would do for your camp and shelter: water beside or near (there is no spring: a camp drinks only from a river or lake beside it, or what is carried in), sites to scavenge around, few of the dead.")}>As a home</div><div>${spot.sites} site${spot.sites === 1 ? "" : "s"} around</div><div>Water</div><div class="${spot.water >= 3 ? "good" : spot.water ? "warn" : "danger"}">${esc(waterText(state, id))}</div>` : "";
  return `<div>From the team</div><div>${walk}</div>${note}`;
}

// The tile panel's card for the staging camp on this tile ("" elsewhere).
export function stagingTileCard(state, id) {
  const v = view(state);
  if (!v || !v.camp || v.camp.tile !== id) return "";
  const here = v.teams.filter((p) => partyTile(p) === id);
  return `<div class="card attn small"${tip("A staging camp: built up into your hub once the materials are in and the work is done (sim/staging.js).")}>
    <div class="spread"><b>Staging camp: ${esc(v.title.toLowerCase())}</b><span class="muted">${pct(v.pct)} built</span></div>
    ${campBody(state, v)}
    <div class="muted" style="margin-top:0.3rem">${here.length ? `Here: ${esc(here.map((p) => teamName(state, p)).join(", "))}. ` : ""}Stores: ${esc(storesText(v.camp) || "nothing yet")}.</div>
  </div>`;
}
