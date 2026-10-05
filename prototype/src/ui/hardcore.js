// Hardcore mode in the panels (sim/hardcore-start.js): before the first hub the survivors are a team on the road, so
// the top bar, the Bases tab, the Goals card, the alerts and the tile panel show the team and what founding the
// hub still takes instead of a base.
import { SUPPLIES } from "../sim/data.js";
import { partyMembers, partyTile, carried, planPath, partySpeed, tileLabel } from "../sim/parties.js";
import { thirstAt } from "../sim/weather.js";
import { foundingView, FOUND_LABEL, foundNeedText, hubSites } from "../sim/hardcore-start.js";
import { MODES, isHardcore } from "../sim/hardcore.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const n0 = (v) => Math.floor((v || 0) + 1e-9);
const r1 = (v) => Math.round((v || 0) * 10) / 10;

export const modeLabel = (state) => (MODES[isHardcore(state) ? "hardcore" : "normal"] || MODES.normal).label;

// Days of food and water the team carries at today's thirst.
function teamDays(state, p) {
  const n = Math.max(1, partyMembers(state, p).length);
  return { food: (carried(p, "food") + carried(p, "preserved")) / n, water: carried(p, "water") / (n * thirstAt(state)) };
}
const missText = (v) => v.miss.map((m) => `${m.short} ${m.key}`).join(", ");

// The top bar's stock slot while there is no hub: what the team carries, and what the hub still needs.
export function roadStock(state) {
  const v = foundingView(state);
  if (!v) return null;
  const d = teamDays(state, v.p);
  const cell = (k, extra = "") => `<span${tip(`${SUPPLIES[k].name} the team carries (packed and found). ${extra}`)}><b>${SUPPLIES[k].name}</b>${n0(carried(v.p, k) + (k === "food" ? carried(v.p, "preserved") : 0))}</span>`;
  return `<span class="warn"${tip(`Hardcore: no hub yet. Your ${v.people} survivors are a team on the road; you are with them, so they always take orders. Found your hub (team orders: ${FOUND_LABEL}) once they carry ${foundNeedText()}.`)}>On the road</span>` +
    cell("food", `About ${r1(d.food)} days for the team.`) + cell("water", `About ${r1(d.water)} days for the team at today's thirst.`) + cell("scrap") + cell("parts") + cell("ammo") + cell("meds") +
    `<span class="${v.ready ? "good" : "muted"}"${tip(v.ready ? "The team carries what the first hub takes: give the order Found your hub here where you want it." : `What founding the hub still needs: ${missText(v)}.`)}>${v.ready ? "Hub: ready to found" : `Hub needs ${esc(missText(v))}`}</span>`;
}

// The Bases tab with no base yet: the first hub's checklist, the team's days of food and water, the best spots near it.
export function firstHubCard(state) {
  const v = foundingView(state);
  if (!v) return "";
  const d = teamDays(state, v.p);
  const rows = v.rows.map((r) => `<div>${esc(SUPPLIES[r.key].name)}</div><div class="${r.ok ? "good" : ""}">${r.have} / ${r.need}${r.ok ? " ✓" : ` <span class="muted">(${r.need - r.have} more)</span>`}</div>`).join("");
  const spots = hubSites(state, v.tile, 4).slice(0, 3);
  const spotRows = spots.map((s) => `<div class="row small"><a class="link" data-action="center" data-tile="${s.id}"${tip("Center the map here")}>${esc(tileLabel(state, s.id))}</a><span class="muted">${s.water >= 3 ? "water beside" : s.water ? "water near" : "no water near"} · ${s.sites} site${s.sites === 1 ? "" : "s"} around</span></div>`).join("");
  return `<div class="card attn">
    <div class="spread"><h2 style="margin:0">Your first hub</h2><span class="muted small">Hardcore</span></div>
    <div class="small" style="margin-top:0.3rem">No base yet: your ${v.people} survivors are on the road. Gather what the hub takes, then give the team the order <b>${FOUND_LABEL}</b> on a good spot. The scrap and parts go into the first shelters; the food, water and everything else the team carries become its stores. It starts bare: no buildings, no vehicle.</div>
    <div class="kv small" style="margin-top:0.4rem">${rows}
      <div${tip("Days the team's food and water last at today's rate. Thirst kills in a few days: rivers and lakes (Fetch water) and shops, diners and churches have water.")}>Lasts</div><div class="${Math.min(d.food, d.water) < 2 ? "danger" : ""}">food ${r1(d.food)} days · water ${r1(d.water)} days</div>
    </div>
    ${spots.length ? `<div class="small muted" style="margin-top:0.4rem"${tip("Spots within 4 tiles of the team rated for a hub: water beside or near, sites to scavenge around, few of the dead and no hive close by.")}>Good spots nearby:</div>${spotRows}` : ""}
    <div class="row" style="margin-top:0.5rem"><button class="primary" data-action="xp-open" data-id="${v.p.id}"${tip("People, gear, supplies and orders")}>Team panel</button><button data-action="center" data-tile="${v.tile}"${tip("Center the map on the team")}>Locate</button></div>
  </div>`;
}

// One line for the Goals card (ui/diplomacy.js) while the first hub is pending.
export function firstHubGoal(state) {
  const v = foundingView(state);
  if (!v) return "";
  return `<div class="${v.ready ? "good" : "warn"}"${tip(`Hardcore: everything else waits for a hub. Needs ${foundNeedText()} carried by the team.`)}>${v.ready ? "✓" : "✗"} First: found your hub${v.ready ? " (the team has what it takes)" : ` (still missing ${esc(missText(v))})`}</div>`;
}

// Alerts (ui/alerts.js): the first hub not founded, and the team running out of food or water on the road.
export function roadAlerts(state, out) {
  const v = foundingView(state);
  if (!v) return;
  const d = teamDays(state, v.p);
  if (d.water < 1.5) out.push({ key: `roadwater:${v.p.id}`, kind: "roadwater", icon: "💧", tone: "danger", text: d.water < 0.05 ? "The team is out of water" : `The team has water for ${r1(d.water)} days`, tip: "Thirst kills in a few days. Fetch water beside a river or lake (team panel), or search a shop, diner, church or campground. Click to open the team panel.", go: { team: v.p.id } });
  if (d.food < 1.5) out.push({ key: `roadfood:${v.p.id}`, kind: "roadfood", icon: "🥫", tone: d.food < 0.05 ? "danger" : "warn", text: d.food < 0.05 ? "The team is out of food" : `The team has food for ${r1(d.food)} days`, tip: "Search farms, groceries and diners, hunt or fish. Click to open the team panel.", go: { team: v.p.id } });
  out.push({ key: `firsthub:${v.ready ? 1 : 0}`, kind: "firsthub", icon: "🏚", tone: v.ready ? "good" : "info", text: v.ready ? "Ready to found your hub" : `No hub yet: needs ${missText(v)}`, tip: v.ready ? `The team carries what the first hub takes. Pick a good spot (water near, sites around) and give the order ${FOUND_LABEL}. Click to open the team panel.` : `Hardcore: found your first hub with ${foundNeedText()} carried. Click to open the team panel.`, go: { team: v.p.id } });
}

// The tile panel's "From hub" row while there is no hub: the walk from the team, and whether the hub could go here.
export function fromTeamRow(state, id) {
  const v = foundingView(state);
  if (!v) return null;
  const res = v.tile === id ? { cost: 0, path: [id] } : planPath(state, v.tile, id, false);
  const walk = res ? `${res.path.length - 1} tiles · ~${Math.ceil(res.cost / Math.max(0.3, partySpeed(v.p)))}h on foot` : "No route over land";
  const t = state.tiles[id];
  const spot = t.terrain !== "water" ? hubSites(state, id, 0)[0] : null;
  const note = spot ? `<div${tip("How this tile would do for your first hub: water beside or near, sites to scavenge around, few of the dead.")}>As a hub</div><div>${spot.water >= 3 ? "water beside" : spot.water ? "water near" : "no water near"} · ${spot.sites} site${spot.sites === 1 ? "" : "s"} around</div>` : "";
  return `<div>From the team</div><div>${walk}</div>${note}`;
}
