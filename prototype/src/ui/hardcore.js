// No base in the panels: hardcore before the first hub (sim/hardcore-start.js) and the exiles after losing every base
// (sim/conquest.js). The survivors are teams on the road building a staging camp (sim/staging.js), so the top bar, the
// Bases tab, the Goals card, the alerts and the tile panel show the team and the camp (what it still needs, how far
// the work is) instead of a base.
import { SUPPLIES } from "../sim/data.js";
import { partyMembers, partyTile, carried, planPath, partySpeed, tileLabel, teamName } from "../sim/parties.js";
import { thirstAt } from "../sim/weather.js";
import { roadTeam, hubSites } from "../sim/hardcore-start.js";
import { stagingView, needText, ESTABLISH_LABEL, STAGING, STAGES, waterText, establishProblem, strikeProblem } from "../sim/staging.js";
import { BUILDINGS, isCamp, tierUpJob, tierUpType, gatherCap } from "../sim/buildings.js";
import { atBase } from "../sim/world.js";
import { fireLit } from "../sim/fieldheat.js";
import { RAW } from "../sim/water.js";
import { MODES, isHardcore } from "../sim/hardcore.js";
import { landFoodHint, landFoodOptions, FORAGE } from "../sim/foraging.js"; // food from the land when the team runs low

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const r1 = (v) => Math.round((v || 0) * 10) / 10;
const pct = (f) => `${Math.round((f || 0) * 100)}%`;
const NEED_KEYS = ["scrap", "parts", "buildmat", "food", "water"]; // sim/staging.js stagingRows
const clamp01 = (f) => Math.max(0, Math.min(1, f || 0));
// A construction bar with its % written on it. cap: the lighter part, as far as the materials in the stores allow.
export function buildBar(f, { cap = null, done = false, text = "" } = {}) {
  const w = (x) => `${Math.round(clamp01(x) * 100)}%`;
  return `<div class="buildbar${done ? " done" : ""}">${cap != null && cap > f ? `<i class="cap" style="width:${w(cap)}"></i>` : ""}<i style="width:${w(f)}"></i><span>${esc(text || `${pct(f)} built`)}</span></div>`;
}
// Camp → Shelter → Base as steps: the ones behind you ticked, the one you are at lit.
export function stageSteps(stage) {
  return `<span class="stagesteps">${STAGES.map((s, i) => `<span class="${i < stage ? "past" : i === stage ? "now" : ""}">${i < stage ? "✓ " : ""}${esc(s)}</span>`).join("<b>→</b>")}</span>`;
}
// The camp's needs against its stores, and (with a team) what that team carries toward each.
function suppliesTable(state, v, p = null) {
  const rows = v.camp ? v.rows : NEED_KEYS.filter((k) => v.needs[k]).map((k) => ({ key: k, need: v.needs[k], have: 0, short: v.needs[k], ok: false }));
  const carry = (k) => (p ? n0(k === "food" ? carried(p, "food") + carried(p, "preserved") : k === "water" ? carried(p, "water") + carried(p, RAW) : carried(p, k)) : 0);
  const head = `<div class="muted">Supply</div><div class="muted">${v.camp ? "At the camp" : "Needed"}</div>${p ? `<div class="muted"${tip("What this team carries now. Food and water: it keeps two days of each for the road and unloads the rest.")}>Team has</div>` : ""}`;
  const body = rows.map((r) => {
    const c = carry(r.key), fills = !r.ok && c >= r.short;
    return `<div>${v.camp ? (r.ok ? "✓ " : "✗ ") : ""}${esc(SUPPLIES[r.key].name)}</div>
      <div class="${r.ok ? "good" : "warn"}">${v.camp ? `${r.have} / ${r.need}${r.ok ? "" : ` <span class="muted">(${r.short} more)</span>`}` : r.need}</div>
      ${p ? `<div class="${r.ok ? "muted" : fills ? "good" : c ? "" : "muted"}">${c}</div>` : ""}`;
  }).join("");
  return `<div class="suptable${p ? " three" : ""}">${head}${body}</div>`;
}

export const modeLabel = (state) => (MODES[isHardcore(state) ? "hardcore" : "normal"] || MODES.normal).label;

// The view plus the team the panels follow: hardcore's road team (you are with it), else the first team on the road.
function view(state) {
  const v = stagingView(state);
  if (!v) return null;
  const p = roadTeam(state) || v.teams[0] || null;
  return { ...v, p, people: p ? partyMembers(state, p).length : 0, tile: p ? partyTile(p) : null, title: v.first ? "Your first hub" : "A new hub" };
}
// Days of food and water the team carries at today's thirst.
function teamDays(state, p) {
  const n = Math.max(1, partyMembers(state, p).length);
  return { food: (carried(p, "food") + carried(p, "preserved")) / n, water: (carried(p, "water") + carried(p, "rawwater")) / (n * thirstAt(state)) }; // both kinds (sim/water.js)
}
// The top bar's stock slot while there is no base: what the team carries.
export function roadStock(state) {
  const v = view(state);
  if (!v || !v.p) return null;
  const d = teamDays(state, v.p);
  const cell = (k, extra = "") => `<span${tip(`${SUPPLIES[k].name} the team carries (packed and found). ${extra}`)}><b>${SUPPLIES[k].name}</b>${n0(carried(v.p, k) + (k === "food" ? carried(v.p, "preserved") : 0))}</span>`;
  const head = v.first ? `Hardcore: no hub yet. Your ${v.people} survivors are a team on the road; you are with them, so they always take orders.` : "You have no base left: your people are on the road.";
  const campCell = `<span class="muted"${tip(`Give a team the order ${ESTABLISH_LABEL} where your home should stand: a camp (the barest base) with its step up into a shelter queued (${needText(v.needs)} brought in, then ${BUILDINGS.camp_up.hours} work-hours by its builders).`)}>No camp yet</span>`;
  return `<span class="${v.first ? "warn" : "danger"}"${tip(`${head} ${ESTABLISH_LABEL} sets up a camp you build up into your hub.`)}>On the road</span>` +
    cell("food", `About ${r1(d.food)} days for the team.`) + cell("water", `About ${r1(d.water)} days for the team at today's thirst.`) + cell("scrap") + cell("parts") + cell("ammo") + cell("meds") + campCell;
}

// The three stages and what the next one takes (sim/staging.js tierInfo), with a bar while the step up is building.
export function stageRows(t) {
  if (!t) return "";
  const q = t.queued, f = q && q.hours ? q.progress / q.hours : 0;
  return `<div${tip("Your home grows in three stages: a staging camp, a shelter you can live at (tier 0), then a base (the hub). Each step takes materials and work.")}>Stage</div><div>${stageSteps(t.stage)}</div>${t.next ? `<div>Next: ${esc(t.next)}</div><div class="muted">${q ? buildBar(f, { text: `${t.next} ${pct(f)} built` }) : esc(t.needs)}</div>` : ""}`;
}

// The team panel's card while you have no base (ui/expedition.js): is there a camp yet, how far it is built, what it
// still needs against what this team carries, and what the team should do about it.
export function campStatusCard(state, p) {
  const v = view(state);
  if (!v) return "";
  const at = partyTile(p);
  const heading = p.mission === "establish" && (p.phase === "out" || p.phase === "back") && p.path && p.path.length ? p.path[p.path.length - 1] : null;
  const why = heading == null ? establishProblem(state, at) : null;
  const line = heading != null ? `On the way to set up camp ${esc(tileLabel(state, heading))}.`
    : why ? `Not here: ${esc(why)}` : `Give the order <b>${ESTABLISH_LABEL}</b> (Orders, below) to set up camp right here (${STAGING.PITCH.hours} hour, nothing carried): a camp is the barest base, and your people live there from the start.`;
  return `<div class="card small attn campcard">
    <div class="spread"><b>No base yet</b>${stageSteps(-1)}</div>
    <div style="margin-top:0.3rem">${line} Building it up into a shelter takes these brought in, then ${BUILDINGS.camp_up.hours} work-hours by its builders:</div>
    ${suppliesTable(state, v, p)}
  </div>`;
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
  const spots = v.tile != null ? hubSites(state, v.tile, 4).slice(0, 3) : [];
  const spotRows = spots.map((s) => `<div class="row small"><a class="link" data-action="center" data-tile="${s.id}"${tip("Center the map here")}>${esc(tileLabel(state, s.id))}</a><span class="muted">water: ${esc(waterText(state, s.id))} · ${s.sites} site${s.sites === 1 ? "" : "s"} around</span></div>`).join("");
  const intro = `No base ${v.first ? "yet" : "left"}: your ${v.people || ""} survivors are on the road. Pick a good spot (beside a river or lake: there is no spring; sites around, few of the dead) and give a team the order <b>${ESTABLISH_LABEL}</b>: a camp (the barest base: your people live there from the start) with its step up into a shelter queued: ${esc(needText(v.needs))} brought in, then ${BUILDINGS.camp_up.hours} work-hours by its builders (Camp → Shelter → Base).`;
  return `<div class="card attn">
    <div class="spread"><h2 style="margin:0">${v.title}</h2><span class="muted small">${v.first ? "Hardcore" : "On the road"}</span></div>
    <div class="small" style="margin-top:0.3rem">${intro}</div>
    ${d ? `<div class="kv small" style="margin-top:0.4rem"><div${tip("Days the team's food and water last at today's rate. Thirst kills in a few days: rivers and lakes (Fetch water) and shops, diners and churches have water. Workers at the camp eat from its stores once theirs run out.")}>Team lasts</div><div class="${Math.min(d.food, d.water) < 2 ? "danger" : ""}">food ${r1(d.food)} days · water ${r1(d.water)} days</div></div>` : ""}
    ${v.p && d && d.food < 3 ? landFoodRows(state, v.p) : ""}
    ${spots.length ? `<div class="small muted" style="margin-top:0.4rem"${tip("Spots within 4 tiles of the team rated for a hub: water beside or near, sites to scavenge around, few of the dead and no hive close by.")}>Good spots nearby:</div>${spotRows}` : ""}
    <div class="row" style="margin-top:0.5rem">${v.p ? `<button class="primary" data-action="xp-open" data-id="${v.p.id}"${tip("People, gear, supplies and orders")}>Team panel</button><button data-action="center" data-tile="${v.tile}"${tip("Center the map on the team")}>Locate team</button>` : ""}</div>
  </div>`;
}

// Food from the land around the road team when its food runs low (under 3 days): forage, hunt and fish, here and
// within 2 tiles, with what each would bring in 8 hours (sim/foraging.js landFoodOptions).
function landFoodRows(state, p) {
  const seen = new Set();
  const opts = landFoodOptions(state, p, { range: 2, walk: false, hours: FORAGE.defHours }).filter((o) => o.rations >= 1 && !seen.has(`${o.kind}:${o.dist === 0}`) && seen.add(`${o.kind}:${o.dist === 0}`)).slice(0, 4);
  if (!opts.length) return "";
  const name = { forage: "Forage", hunt: "Hunt", fish: "Fish" };
  return `<div class="kv small" style="margin-top:0.4rem"><div${tip("Food from the land: what 8 hours would bring here or a short walk away (the season, the land, the team's skills and weapons). Give the order from the team panel (Land), or right-click the tile.")}>Food nearby</div><div>${opts.map((o) => `${name[o.kind]} ${o.dist === 0 ? "here" : `${o.dir} (${o.dist})`} ~${Math.round(o.rations)}`).join(" · ")}</div></div>`;
}

// One line for the Goals card (ui/diplomacy.js) while there is no base.
export function firstHubGoal(state) {
  const v = view(state);
  if (!v) return "";
  const what = v.first ? "found your hub" : "found a new hub";
  return `<div class="warn"${tip(`Everything else waits for a home. ${ESTABLISH_LABEL}: a camp (the barest base) whose step up into a shelter needs ${needText(v.needs)} and ${BUILDINGS.camp_up.hours} work-hours.`)}>✗ First: ${what} (${ESTABLISH_LABEL} on a good spot)</div>`;
}

// Alerts (ui/alerts.js): the team running out of food or water on the road, the camp's needs, dangers and neglect.
export function roadAlerts(state, out) {
  const v = view(state);
  if (!v) { campAlerts(state, out); return; }
  const go = v.p ? { team: v.p.id } : null;
  if (v.p) {
    const d = teamDays(state, v.p);
    if (d.water < 1.5) out.push({ key: `roadwater:${v.p.id}`, kind: "roadwater", icon: "💧", tone: "danger", text: d.water < 0.05 ? "The team is out of water" : `The team has water for ${r1(d.water)} days`, tip: "Thirst kills in a few days. Fetch water beside a river or lake (team panel), or search a shop, diner, church or campground. Click to open the team panel.", go });
    if (d.food < 1.5) {
      const hint = landFoodHint(state, v.p); // "forage or hunt nearby: forest to the east, about 5 food in 8h of foraging"
      out.push({ key: `roadfood:${v.p.id}`, kind: "roadfood", icon: "🥫", tone: d.food < 0.05 ? "danger" : "warn", text: `${d.food < 0.05 ? "The team is out of food" : `The team has food for ${r1(d.food)} days`}${hint ? `: ${hint.replace(/, about.*$/, "")}` : ""}`, tip: `${hint ? `${hint[0].toUpperCase()}${hint.slice(1)}. ` : ""}Forage, hunt or fish (team panel: the Land orders), or search farms, groceries and diners. Click to open the team panel.`, go });
    }
  }
  out.push({ key: "firsthub:0", kind: "firsthub", icon: "🏚", tone: "info", text: v.first ? "No hub yet: establish a base" : "No base left: establish one", tip: `Give a team the order ${ESTABLISH_LABEL} on a good spot (water near, sites around): a camp built up into a shelter (${needText(v.needs)} brought in, then the work). Click to open the team panel.`, go });
}
// Camps left alone (sim/staging.js): nobody there for days, looters after STAGING.ABANDON, gone after STAGING.GONE.
export function campAlerts(state, out) {
  for (const b of state.bases) {
    if (!isCamp(b)) continue;
    const away = (state.hour - (b.lastPresent ?? state.hour)) / 24;
    if (away < 3) continue;
    out.push({ key: `campalone:${b.id}`, kind: "campalone", icon: "🏕", tone: away >= STAGING.ABANDON ? "danger" : "warn", text: `Nobody at ${b.name} for ${Math.floor(away)} days`, tip: `An empty camp does nothing. After ${STAGING.ABANDON} days alone scavengers may loot it (part of its stores and of its step up); empty and bare for ${STAGING.GONE} days it is gone. Strike it from its base window if you do not want it. Click to open it.`, go: { base: b.id } });
  }
}

// The tile panel's "From hub" row while there is no base: the walk from the team, and how the tile would do as a hub.
export function fromTeamRow(state, id) {
  const v = view(state);
  if (!v || !v.p) return null;
  const res = v.tile === id ? { cost: 0, path: [id] } : planPath(state, v.tile, id, false);
  const walk = res ? `${res.path.length - 1} tiles · ~${Math.ceil(res.cost / Math.max(0.3, partySpeed(v.p)))}h on foot` : "No route over land";
  const t = state.tiles[id];
  const spot = t.terrain !== "water" && true ? hubSites(state, id, 0)[0] : null;
  const note = spot ? `<div${tip("How this tile would do for your camp and shelter: water beside or near (there is no spring: a camp drinks only from a river or lake beside it, or what is carried in), sites to scavenge around, few of the dead.")}>As a home</div><div>${spot.sites} site${spot.sites === 1 ? "" : "s"} around</div><div>Water</div><div class="${spot.water >= 3 ? "good" : spot.water ? "warn" : "danger"}">${esc(waterText(state, id))}</div>` : "";
  return `<div>From the team</div><div>${walk}</div>${note}`;
}

// The tile panel's card for a camp on this tile ("" elsewhere): its stage, the step up's bar, who is there, and the
// buttons (its base window; Strike camp).
export function stagingTileCard(state, id) {
  const b = state.bases.find((x) => x.tile === id && isCamp(x));
  if (!b) return "";
  const job = tierUpJob(b);
  const f = job && job.hours ? job.progress / job.hours : 0;
  const people = atBase(state, b.id);
  const why = strikeProblem(state, b);
  return `<div class="card attn small campcard"${tip("A camp: the barest base (sim/staging.js). Its people live there; manage its stores, teams and vehicles in its base window, build it up from Construction, or strike it.")}>
    <div class="spread"><b>${esc(b.name)}</b>${stageSteps(0)}</div>
    ${job ? buildBar(f, { cap: job.paid ? gatherCap(job) : null, text: `${BUILDINGS[job.type].name}: ${pct(f)}` }) : `<div class="muted">A plain camp: nothing building (Construction: ${esc(BUILDINGS[tierUpType(b)].name)}).</div>`}
    <div class="muted" style="margin-top:0.2rem">${people.length} there${people.length ? `: ${esc(people.map((s) => s.name.split(" ")[0]).join(", "))}` : ""} · fire ${fireLit(b) ? "lit" : "out"} · water: ${esc(waterText(state, b.tile))}</div>
    <div class="row" style="margin-top:0.3rem"><button class="mini primary" data-action="openbase" data-id="${b.id}"${tip("Open the camp's base window: stores, people and teams, vehicles, construction")}>Open camp</button><button class="mini" data-action="strikecamp" data-base="${b.id}" ${why ? "disabled" : ""}${tip(why || "Strike the camp: its people form a team with what they can carry (water and food first), the rest is left here as a cache, and the camp is gone.")}>Strike camp</button></div>
  </div>`;
}
