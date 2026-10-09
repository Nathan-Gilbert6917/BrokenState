// The hive crawl window (sim/hivecrawl.js): the map of the chambers seen so far (unknown passages fogged), the warmth
// and the hive's Alert, the team, what is in front of it (the brood, a swarm, the core) or what it can do in its chamber
// and the passages out with their drafts. The window warms as the team nears the core: its tint and vignette go from a
// cold grey-blue to orange-red, with the pulse and the drone (ui/hivecrawlsfx.js).
import { partyMembers, carried } from "../sim/parties.js";
import { hourOfDay, day, isNight } from "../sim/world.js";
import { BOSS_NAMES } from "../sim/hiveconst.js";
import {
  HCRAWL, ROOM_KINDS, activeHiveCrawl, crawlHive, denOf, roomById, warmthOf, warmthText, alertName, roomName, broodLeft, exitsOf, draftWord, draftMiss,
  encounterOptions, roomActions, roomAct, resolveHiveEnc, moveTo, leaveHive, stepOut, canMoveOn,
} from "../sim/hivecrawl.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const bar = (v, color) => `<div class="bar"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></div>`;
// Warmth 0–100 → a colour from cold slate to ember red.
export function warmColor(w, a = 1) {
  const t = Math.max(0, Math.min(1, w / 100));
  const stops = [[70, 96, 120], [150, 110, 70], [215, 110, 40], [220, 50, 35]];
  const f = t * (stops.length - 1), i = Math.min(stops.length - 2, Math.floor(f)), k = f - i;
  const c = stops[i].map((v, j) => Math.round(v + (stops[i + 1][j] - v) * k));
  return `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

// The window (ui.js pickModal), or "" when no crawl is open.
export function hiveCrawlModal(state, ui) {
  const p = activeHiveCrawl(state);
  if (!p) return "";
  const c = p.hiveCrawl;
  const hive = crawlHive(state, c);
  const den = denOf(state, hive);
  const room = roomById(den, c.at);
  const w = warmthOf(den, room);
  const msg = ui.hcMsg && ui.hcMsgKey === `${p.id}:${c.started}` ? `<div class="result" style="margin:0.4rem 0">${esc(ui.hcMsg)}</div>` : "";
  // The warmth on the window: a tint and a vignette that redden toward the core.
  const style = `background:linear-gradient(180deg, ${warmColor(w, 0.10 + w / 600)}, rgba(0,0,0,0) 55%), var(--panel);box-shadow:inset 0 0 ${30 + w * 0.9}px ${warmColor(w, 0.18 + w / 280)}, 0 10px 40px rgba(0,0,0,0.5);border-color:${warmColor(w, 0.8)}`;
  return `<div class="box wide hivecrawl" data-warmth="${w}" style="${style}"><h1>${esc(c.name)} · ${esc(roomName(room))}<span class="muted small" style="font-weight:normal"> — ${room.layer ? `${room.layer} chamber${room.layer === 1 ? "" : "s"} in` : "the mouth"}</span></h1>
    ${hud(state, p, c, den, room, w)}${msg}
    <div class="grid2" style="gap:0.7rem;align-items:start">
      <div>${mapSvg(state, p, c, den)}</div>
      <div>${c.enc ? encounterCard(state, p, c, den) : c.leaving ? leavingCard(p) : roomCard(state, p, c, den, room, w)}</div>
    </div>
    <h3 style="margin-top:0.6rem">This crawl</h3><div class="elog" id="elog" style="height:6.5rem">${c.log.slice(-20).map((l) => `<div class="k-${l.k}">${esc(l.text)}</div>`).join("")}</div>
  </div>`;
}

function hud(state, p, c, den, room, w) {
  const members = partyMembers(state, p);
  const clockTxt = `Day ${day(state)} ${String(hourOfDay(state)).padStart(2, "0")}:00${isNight(state) ? " · night" : ""}`;
  const found = [...Object.entries(c.tally.supplies).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${k}`), ...c.tally.gear];
  return `<div class="grid2" style="gap:0.6rem;margin-bottom:0.5rem">
    <div>
      <div class="spread small"><span${tip(`How warm the air is here: the core is the hottest place in the hive. ${den.depth} chambers from the mouth to the core by the shortest way; the deepest you have been: ${c.deepest}.`)}>Warmth <b style="color:${warmColor(w)}">${w}</b>: ${esc(warmthText(w))}</span><span>${clockTxt}</span></div>
      <div class="heat" style="margin:0.25rem 0 0.35rem;background:linear-gradient(90deg, ${warmColor(0)}, ${warmColor(50)}, ${warmColor(100)})"><i style="left:${Math.min(99, w)}%"></i></div>
      <div class="small"${tip(`The hive's Alert: the noise you have made (fights, fire, a failed sneak), fading ${HCRAWL.ALERT.decay} an hour; lying still lets it fall faster. From ${HCRAWL.ALERT.converge} the brood converges on you and fills the chambers behind you again; from ${HCRAWL.ALERT.block} it packs the mouth.`)}>Alert: <b>${alertName(c.alert)}</b> (${Math.round(c.alert)})</div>
      <div class="heat" style="margin:0.25rem 0 0.2rem"><i style="left:${Math.min(99, c.alert)}%"></i></div>
      <div class="small muted">${c.kills} of the brood killed this crawl${c.lost.length ? ` · <span class="danger">lost ${esc(c.lost.join(", "))}</span>` : ""}</div>
    </div>
    <div>
      ${members.map((m) => `<div class="row small" style="gap:0.4rem"><span style="width:6.5rem;overflow:hidden;white-space:nowrap">${esc(m.name.split(" ")[0])}</span><div style="flex:1">${bar(m.health, m.health < 40 ? "var(--danger)" : m.health < 70 ? "#c9a24a" : "var(--good)")}</div><span class="muted" style="width:2rem;text-align:right">${Math.round(m.health)}</span></div>`).join("")}
      <div class="small" style="margin-top:0.25rem">Ammo ${Math.floor(carried(p, "ammo"))} · Meds ${Math.floor(carried(p, "meds"))} · Fuel ${Math.floor(carried(p, "fuel"))}${c.hadVehicle ? " · <span class=\"muted\">the vehicle waits at the mouth</span>" : ""}</div>
      <div class="small" style="margin-top:0.2rem">${found.length ? found.slice(0, 10).map((f) => `<span class="chip">${esc(f)}</span>`).join("") : "<span class='muted'>Nothing found yet.</span>"}</div>
    </div>
  </div>`;
}

// The chambers the team knows: where it has been (coloured by warmth, its kind's initial) and the passages it has seen
// out of them (fogged "?"). A passage out of the team's chamber is a button.
function mapSvg(state, p, c, den) {
  const cols = den.depth + 1, rows = Math.max(2, den.width);
  const dx = Math.max(34, Math.min(64, 520 / cols)), dy = 34;
  const Wd = 30 + (cols - 1) * dx + 30, Hd = 24 + (rows - 1) * dy + 24;
  const pos = (r) => [30 + r.layer * dx, 24 + r.slot * dy + (r.layer % 2 ? 6 : 0)];
  const show = (id) => c.visited[id] || c.seen[id];
  const here = roomById(den, c.at);
  const exits = new Set(here.links);
  let lines = "", nodes = "";
  for (const r of den.rooms) {
    if (!show(r.id)) continue;
    for (const id of r.links) {
      if (id < r.id || !show(id) || !(c.visited[id] || c.visited[r.id])) continue;
      const o = roomById(den, id);
      const [x1, y1] = pos(r), [x2, y2] = pos(o);
      lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c.visited[id] && c.visited[r.id] ? "#8a6a5a" : "#4a4f58"}" stroke-width="${c.visited[id] && c.visited[r.id] ? 3 : 2}" ${c.visited[id] && c.visited[r.id] ? "" : 'stroke-dasharray="4 3"'}/>`;
    }
  }
  for (const r of den.rooms) {
    if (!show(r.id)) continue;
    const [x, y] = pos(r);
    const v = !!c.visited[r.id], cur = r.id === c.at, ex = exits.has(r.id) && !c.enc && !c.leaving;
    const w = warmthOf(den, r);
    const label = v ? (r.kind === "core" ? "★" : (ROOM_KINDS[r.kind] ? ROOM_KINDS[r.kind].name[0] : "?")) : "?";
    const title = v ? `${roomName(r)} (warmth ${w})${broodLeft(state, crawlHive(state, c), r) && r.kind !== "core" ? `: ${broodLeft(state, crawlHive(state, c), r)} of the brood` : ""}` : "Not explored";
    const circle = `<circle cx="${x}" cy="${y}" r="${cur ? 13 : 11}" fill="${v ? warmColor(w, 0.95) : "#23262c"}" stroke="${cur ? "#fff" : v ? "#2a1a14" : "#6a707a"}" stroke-width="${cur ? 3 : 1.5}" ${v ? "" : 'stroke-dasharray="3 2"'}/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" fill="${v ? "#1a0e0a" : "#aab"}" style="pointer-events:none;font-weight:bold">${label}</text>`;
    nodes += ex ? `<g data-action="hc-move" data-id="${p.id}" data-room="${r.id}" style="cursor:pointer"><title>${esc(title)} — go there</title>${circle}</g>` : `<g><title>${esc(title)}</title>${circle}</g>`;
  }
  return `<svg class="hc-map" viewBox="0 0 ${Wd} ${Hd}" style="width:100%;max-height:16rem;background:rgba(0,0,0,0.25);border-radius:6px">${lines}${nodes}</svg>
    <div class="small muted" style="margin-top:0.2rem">The mouth on the left; the core lies somewhere to the right. Letters: the kind of chamber (T tunnel, G gallery, N nursery, E eggs, B bones, W worm pool, R root, C collapse); ? not explored.</div>`;
}

function roomCard(state, p, c, den, room, w) {
  const K = ROOM_KINDS[room.kind] || {};
  const hive = crawlHive(state, c);
  const n = broodLeft(state, hive, room);
  const free = canMoveOn(state, c);
  const exits = exitsOf(state, p);
  const miss = draftMiss(state, p);
  const acts = roomActions(state, p);
  return `<div class="card" style="margin:0;border-color:${warmColor(w, 0.6)}"><b>${esc(roomName(room))}</b><div class="small" style="margin:0.2rem 0">${esc(K.text || "")} The air is ${esc(warmthText(w))}.${n && c.slipped[room.id] ? ` The ${n} of the brood you crept past are still here.` : ""}</div>
    <div class="row" style="gap:0.35rem;flex-wrap:wrap">${acts.map((a) => `<button data-action="hc-act" data-id="${p.id}" data-act="${a.id}" ${a.disabled ? "disabled" : ""}${tip(a.tip)}>${esc(a.label)}</button>`).join("")}</div></div>
    <h3 style="margin-top:0.5rem">Passages</h3>
    <div class="small muted" style="margin-bottom:0.25rem"${tip("Your best scout reads the drafts. A team without a good scout misreads one now and then.")}>Drafts read right about ${Math.round((1 - miss) * 100)}% of the time.</div>
    ${exits.map((x) => {
      const r = x.room;
      const name = r ? roomName(r) : "An unexplored passage";
      const back = x.back ? " (the way you came)" : "";
      const dcol = x.draft === "warmer" ? warmColor(85) : x.draft === "colder" ? warmColor(5) : "#999";
      const dis = !free && !x.back;
      return `<div class="row small" style="gap:0.4rem;margin:0.15rem 0"><button data-action="hc-move" data-id="${p.id}" data-room="${x.id}" ${dis ? "disabled" : ""}${tip(dis ? "The brood is still in this chamber: fight it, creep past, or go back the way you came." : `About ${HCRAWL.MOVE_HOURS} h through the tunnels. Alert +${HCRAWL.ALERT.move}.`)}>Go ▸</button><span style="flex:1">${esc(name)}${back}</span><span style="color:${dcol}">${esc(draftWord(x.draft))}</span></div>`;
    }).join("")}
    <div class="row" style="margin-top:0.6rem;justify-content:flex-end"><button class="primary" data-action="hc-leave" data-id="${p.id}"${tip(`Back out the way you came, a chamber an hour (${c.trail.length - 1} to the mouth). A chamber that filled again, or one you crept past, is in the way.`)}>Leave the hive${c.trail.length > 1 ? ` (${c.trail.length - 1} chamber${c.trail.length === 2 ? "" : "s"})` : ""}</button></div>`;
}

function encounterCard(state, p, c, den) {
  const e = c.enc;
  if (e.fighting) return `<div class="card attn"><b>Fighting</b></div>`;
  const opts = encounterOptions(state, p);
  const room = roomById(den, e.room) || roomById(den, c.at);
  const title = e.kind === "core" ? `The core: the ${BOSS_NAMES.hivemind}` : e.kind === "swarm" ? "The brood converges" : e.kind === "turned" ? "One of you turned" : `The brood in ${roomName(room).toLowerCase()}`;
  const n = e.enemy ? e.enemy.count : broodLeft(state, crawlHive(state, c), room);
  const text = e.kind === "core" ? `A hill of flesh fills the end of the chamber and beats like a heart: the ${BOSS_NAMES.hivemind}. The ${BOSS_NAMES.hive} squats at its foot among the last of the brood. It never moves; kill it and the hive dies.` : `${n} of the brood${e.spotted ? ", and they have seen you" : ""}. ${(ROOM_KINDS[room.kind] || {}).text || ""}`;
  return `<div class="card attn"><b>${esc(title)}</b>
    <div class="small" style="margin:0.25rem 0 0.5rem">${esc(text)}</div>
    <div class="choices">${opts.map((o) => `<button data-action="hc-enc" data-id="${p.id}" data-ch="${o.id}" ${o.disabled ? "disabled" : ""}>${esc(o.label)}<span class="hint">${esc(o.tip)}</span></button>`).join("")}</div></div>`;
}

function leavingCard(p) {
  return `<div class="card"><b>On the way out</b><div class="small">Back toward the mouth.</div>
    <div class="row" style="margin-top:0.4rem"><button class="primary" data-action="hc-go" data-id="${p.id}">Keep going</button></div></div>`;
}

// Actions (main.js wires them like the city crawl's): d.id is the team.
const partyOf = (state, d) => state.parties.find((x) => x.id === Number(d.id));
const run = (fn) => (state, ui, d) => {
  const p = partyOf(state, d);
  if (!p || !p.hiveCrawl) return;
  const key = `${p.id}:${p.hiveCrawl.started}`;
  const msg = fn(state, p, d, ui);
  ui.hcMsg = typeof msg === "string" ? msg : "";
  ui.hcMsgKey = key;
};
export const HIVE_CRAWL_ACTIONS = {
  "hc-move": run((state, p, d) => moveTo(state, p, d.room)),
  "hc-act": run((state, p, d) => roomAct(state, p, d.act)),
  "hc-enc": run((state, p, d) => resolveHiveEnc(state, p, d.ch, { map: true })),
  "hc-leave": run((state, p) => leaveHive(state, p)),
  "hc-go": run((state, p) => stepOut(state, p)),
};
