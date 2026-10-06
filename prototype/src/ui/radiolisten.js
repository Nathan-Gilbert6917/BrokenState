// Listening in on radio traffic (sim/radiolisten.js): the team panel's Radio card (Listen in, a chooser of the
// networks in range with their colours, what was heard), the Teams tab line, the bases' sets in the Groups tab's
// radio header, and their handlers (LISTEN_ACTIONS, registered by main.js).
import { baseById, log } from "../sim/world.js";
import { partyTile } from "../sim/parties.js";
import { networksAt, networkById, netCovers, baseReceives, teamReceives, teamListens, PLAYER_NET } from "../sim/radio.js";
import { LISTEN, ODDS, ODDS_LABEL, listenProblem, listenIn, hearOdds } from "../sim/radiolisten.js";
import { startOrder, queueOrder, queueEndTile } from "../sim/orders.js";
import { commandable, NO_RADIO, HAND_RADIO, HAND_RADIO_TIP } from "../sim/plans.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const swatch = (color) => `<i style="display:inline-block;width:0.7em;height:0.7em;border-radius:2px;background:${esc(color || "#888")};margin-right:0.25em;vertical-align:-0.05em"></i>`;
const parseNet = (v) => (v === PLAYER_NET || v == null || v === "" ? v || null : Number(v));

export const LISTEN_TIP = `Listen in (${LISTEN.HOURS}h): tune the receiver to one radio network whose coverage you stand in (a group's own sets reach: military 24 tiles, traders and fortresses 12, communes, zealots and expansionists 8, raiders 6, around each of their bases). It catches up on the last ${LISTEN.CATCHUP_DAYS} days of their traffic, then picks up what they say each day while tuned and in range: caravans setting out, raids and war parties (a warning when one is coming for you), their fights with the hives, their wars, their stores, rumours of places, how they talk about you. Each line is caught or missed by the dice, better with Scouting; a military channel is encrypted (a Military encrypted radio helps). Now and then a group notices (−5 goodwill).`;
export const oddsText = (scouting = 0) => Object.keys(ODDS).map((k) => `${ODDS_LABEL[k]} ${Math.round(hearOdds(k, scouting) * 100)}%`).join(", ");

// What a holder heard on the channels, newest first.
export function heardLines(holder, max = LISTEN.HEARD_MAX) {
  const list = (holder && holder.heard) || [];
  if (!list.length) return "";
  return list.slice(0, max).map((h) => `<div class="small">${h.name ? `<span class="muted">Day ${h.day} · heard on ${esc(h.name)}'s channel:</span> ` : ""}${esc(h.text)}</div>`).join("");
}
function tunedText(state, holder, tile) {
  if (holder.tuned == null) return "not tuned";
  const n = networkById(state, holder.tuned);
  if (!n) return "tuned to a channel gone off the air";
  return `tuned to ${swatch(n.color)}${esc(n.name)}${netCovers(state, n, tile) ? "" : ` <span class="warn">(out of range here)</span>`}`;
}

// The team panel's Radio card (in contact): Listen in, one button per network in range.
export function listenBlock(state, p, queueing = false) {
  if (!teamReceives(state, p) && p.tuned == null && !(p.heard && p.heard.length)) return "";
  const at = queueing ? queueEndTile(state, p) : partyTile(p);
  const nets = networksAt(state, at);
  const why = queueing ? null : listenProblem(state, p, false);
  const btn = (n) => `<button class="mini" data-action="xp-listen" data-id="${p.id}" data-net="${esc(n.id)}" ${why ? "disabled" : ""}${tip(why ? `Listen in: ${why}` : `${n.kind === "player" ? "Your own network: your teams' reports and the news, as always." : `${n.name}'s channel.`} ${LISTEN_TIP}`)}>${swatch(n.color)}${p.tuned === n.id ? "Listen again" : "Listen in"}: ${esc(n.name)} (${LISTEN.HOURS}h)</button>`;
  const buttons = !teamReceives(state, p) ? `<span class="muted">No receiver with the team any more.</span>`
    : nets.length ? nets.map(btn).join("")
    : `<button class="mini" disabled${tip(`Listen in: Static: no radio network reaches ${queueing ? "where the queue ends" : "this spot"}. ${LISTEN_TIP}`)}>Listen in (${LISTEN.HOURS}h)</button>`;
  return `<div class="card small" style="margin-top:0.4rem"><div class="spread"><b${tip(LISTEN_TIP)}>📻 Radio traffic</b><span class="muted">${tunedText(state, p, partyTile(p))}</span></div>
    <div class="row" style="flex-wrap:wrap;margin-top:0.3rem">${buttons}</div>
    ${heardLines(p, 4)}</div>`;
}

// Out of contact (the team panel) and the Teams tab: what the team's receiver hears.
export function teamRadioLine(state, p, full = false) {
  if (!p || p.owner !== "player" || p.kind === "convoy") return "";
  if (commandable(state, p) && !full) return "";
  if (!p.radioHear && !(full && p.heard && p.heard.length)) return "";
  const nets = networksAt(state, partyTile(p));
  const what = teamListens(state, p) ? HAND_RADIO : "Listening: hears a radio network, cannot call in";
  const inRange = nets.length ? ` · in range of ${nets.map((n) => `${swatch(n.color)}${esc(n.name)}`).join(", ")}` : "";
  const tuned = p.tuned != null ? ` · ${tunedText(state, p, partyTile(p))}` : "";
  if (!full) return `<div class="small muted"${tip(HAND_RADIO_TIP)}>📻 ${what}${tuned}${p.heard && p.heard.length ? ` · heard: ${esc(p.heard[0].text)}` : ""}</div>`;
  return `<div class="card small muted"${tip(HAND_RADIO_TIP)}>📻 ${what}.${inRange}${tuned}${p.heard && p.heard.length ? heardLines(p, 4) : p.tuned == null ? " Not tuned to a channel: Listen in once the team is in contact (its next orders card)." : " Nothing heard yet."}</div>`;
}

// The Groups tab's radio header: every base with a receiver, its channel and a Listen in per network in range.
export function baseListenSection(state) {
  const bases = state.bases.filter((b) => baseReceives(state, b));
  if (!bases.length) return "";
  return `<div style="margin-top:0.4rem"><div class="muted"${tip(LISTEN_TIP)}>Listening in: a base with a radio (a station, a Military encrypted radio, or a hand-crank radio there) can tune to any radio network whose coverage it stands in.</div>${bases.map((b) => {
    const nets = networksAt(state, b.tile);
    const busy = b.listenHour === state.hour;
    const btn = (n) => `<button class="mini" data-action="bl-listen" data-id="${b.id}" data-net="${esc(n.id)}" ${busy ? "disabled" : ""}${tip(busy ? "Someone is at the set already this hour" : `${n.kind === "player" ? "Your own network." : `${n.name}'s channel.`} ${LISTEN_TIP}`)}>${swatch(n.color)}${esc(n.name)}</button>`;
    return `<div style="margin-top:0.3rem"><b>${esc(b.name)}</b> <span class="muted">${tunedText(state, b, b.tile)}</span>
      <div class="row" style="flex-wrap:wrap">${nets.length ? `<span class="small muted">Listen in (${LISTEN.HOURS}h):</span> ${nets.map(btn).join("")}` : `<span class="small muted">Static: no network reaches ${esc(b.name)}.</span>`}</div>
      ${heardLines(b, 3)}</div>`;
  }).join("")}</div>`;
}

export const LISTEN_ACTIONS = {
  // Team order (sim/orders.js "listen"): starts now when the team is waiting or working on the spot, else queued.
  "xp-listen": (state, ui, d) => {
    const p = state.parties.find((q) => q.id === Number(d.id));
    if (!p) return;
    if (!commandable(state, p)) { ui.xpMsg = NO_RADIO; return; }
    const o = { type: "listen", net: parseNet(d.net) };
    const now = (p.phase === "waiting" || p.phase === "task") && !(ui.xpQueue && ui.expedition === p.id);
    const msg = now ? startOrder(state, p, o) : queueOrder(state, p, o);
    ui.xpMsg = msg || "";
    if (msg) log(state, msg, "info");
  },
  // A base's set: tuned at once (an hour of someone's time; once an hour).
  "bl-listen": (state, ui, d) => {
    const b = baseById(state, Number(d.id));
    if (!b || b.listenHour === state.hour) return;
    const r = listenIn(state, b, parseNet(d.net), true);
    if (r.ok) b.listenHour = state.hour;
    ui.radioMsg = r.text;
    log(state, `📻 ${r.text}`, "info");
  },
};
