// The hive crawl window (sim/hivecrawl.js): the map of the chambers seen so far (unknown passages fogged), the warmth
// and the hive's Alert, the team, what is in front of it (the brood, a swarm, the core) or what it can do in its chamber
// and the passages out with their drafts. The window warms as the team nears the core: its tint and vignette go from a
// cold grey-blue to orange-red, with the pulse and the drone (ui/hivecrawlsfx.js). The team's lights (on or off), its
// road flares, and what it has heard or lit beyond a passage (Listen, Flare) show on the passages and the map.
// 3 open, 1 wall and four mouths (2026-10-13): the map draws the walls of the chambers the team has been in (the T of
// each) and all four mouths; leaving is a walk to one of them (Leave by this mouth there), no button walks you out.
import { keyWord } from "../sim/water.js"; // supplies as words: "9mm FMJ", "rounds"
import { partyMembers, carried } from "../sim/parties.js";
import { hourOfDay, day, isNight } from "../sim/world.js";
import { BOSS_NAMES } from "../sim/hiveconst.js";
import {
  HCRAWL, ROOM_KINDS, activeHiveCrawl, chamberThreat, roomHeat, crawlHive, denOf, roomById, warmthOf, warmthText, soundOf, soundText, alertName, roomName, broodLeft, exitsOf, draftWord,
  encounterOptions, roomActions, roomAct, resolveHiveEnc, moveTo, canMoveOn, isMouth, mouthsOf, mouthSide, mouthBy, wayOut,
  draftMissHere, teamLights, lightsOn, setLights, flaresOf, listenAt, listenOdds, throwFlare, heardText,
} from "../sim/hivecrawl.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
import { teamAmmoBreakdown, breakdownText } from "../sim/ammo.js"; // the Ammo figure: every round and arrow, by calibre on hover
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
  const title = c.name ? c.name[0].toUpperCase() + c.name.slice(1) : "The hive";
  return `<div class="box wide hivecrawl" data-warmth="${w}" style="${style}"><h1>${esc(title)} · ${esc(roomName(room))}<span class="muted small" style="font-weight:normal"> — ${room.layer ? `${room.layer} chamber${room.layer === 1 ? "" : "s"} in` : "the mouth"}</span></h1>
    ${hud(state, p, c, den, room, w)}${msg}
    <div class="grid2" style="gap:0.7rem;align-items:start">
      <div>${mapSvg(state, p, c, den)}</div>
      <div>${c.enc ? encounterCard(state, p, c, den) : roomCard(state, p, c, den, room, w)}</div>
    </div>
    <h3 style="margin-top:0.6rem">This crawl</h3><div class="elog" id="elog" style="height:6.5rem">${c.log.slice(-20).map((l) => `<div class="k-${l.k}">${esc(l.text)}</div>`).join("")}</div>
  </div>`;
}

// The team's lights (on or off: a button) and its road flares.
function lightsRow(state, p, c) {
  const n = teamLights(state, p), on = lightsOn(state, p, c), fl = flaresOf(state, p).length;
  const L = HCRAWL.LIGHT;
  const t = n ? `${n} of ${partyMembers(state, p).length} carry a light. On: the drafts out of your chamber are read in the light (misread ${Math.round(L.draft * 100)}% as often), but the brood sees it (Alert +${L.move} a move, creeping past ${L.sneak} harder). In a fight in the dark of the hive a light lets its carrier see ${L.lit} tiles past its own reach; without one, ${L.dark} tiles.` : `Nobody carries a light (a headlamp, flashlight, torch, lantern: the planner's Lights line packs them). In a fight in the dark of the hive they see ${L.dark} tiles, and the drafts are harder to read.`;
  return `<div class="row small" style="gap:0.4rem;margin-top:0.25rem;align-items:center"><span${tip(t)}>${n ? `Lights <b style="color:${on ? "#ffd27a" : "#889"}">${on ? "on" : "off"}</b> (${n})` : `<span class="muted">No lights</span>`}</span>${n ? `<button class="mini" data-action="hc-lights" data-id="${p.id}" data-on="${on ? 0 : 1}"${tip(on ? "Douse the lights: the brood sees you less, the drafts are harder to read" : "Lights on: the drafts are easier to read; the brood sees you")}>${on ? "Douse" : "Light up"}</button>` : ""}<span${tip(`Road flares: thrown down a passage, one lights the chamber beyond for a moment: its kind, its brood and the true draft (Alert +${HCRAWL.FLARE.alert}). Found at gas stations, police and fire stations, campgrounds; made at a workbench.`)}>· Flares <b>${fl}</b></span></div>`;
}

// The chamber's brood activity and its own heat (sim/hivecrawl.js HCRAWL.THREAT, HCRAWL.HEAT).
function chamberLine(state, c, room) {
  const th = chamberThreat(state, c.hiveId, room.id);
  const own = Math.round((c.heat || {})[room.id] || 0), heat = Math.round(roomHeat(state, c, room, th.mult));
  const color = th.level >= 4 ? "var(--danger)" : th.level === 3 ? "#c9a24a" : "var(--good)";
  return `<div class="small"><span style="color:${color}"${tip(`How much of the brood stirs in this chamber (the hive's own: the same every visit). It multiplies the heat here (the hive's Alert and the noise you have made in this chamber): ×${th.mult}. A little noise in a seething chamber is worse than a lot in a torpid one.`)}>Brood activity: <b>${esc(th.name)}</b> (×${th.mult})</span> · <span${tip(`The noise you have made in this chamber (walking in, fights, fire, searching), fading ${HCRAWL.HEAT.decay} an hour; lying still cools it. A stealthy team leaves less. The heat here, (Alert ${Math.round(c.alert)} + ${own}) × ${th.mult} = ${heat}, decides whether the brood has seen you, creeping past, a swarm pouring in from ${HCRAWL.ALERT.converge} and a patrol finding you lying still.`)}>Heat here: <b>${heat}</b>${own ? ` <span class="muted">(${own} your own)</span>` : ""}</span></div>`;
}

function hud(state, p, c, den, room, w) {
  const snd = soundOf(den, room);
  const members = partyMembers(state, p);
  const clockTxt = `Day ${day(state)} ${String(hourOfDay(state)).padStart(2, "0")}:00${isNight(state) ? " · night" : ""}`;
  const found = [...Object.entries(c.tally.supplies).filter(([, v]) => v > 0).map(([k, v]) => `${v} ${keyWord(k)}`), ...c.tally.gear];
  return `<div class="grid2" style="gap:0.6rem;margin-bottom:0.5rem">
    <div>
      <div class="spread small"><span${tip(`How warm the air is here: the core is the hottest place in the hive. ${den.depth} chambers from the mouth to the core by the shortest way; the deepest you have been: ${c.deepest}.`)}>Warmth <b style="color:${warmColor(w)}">${w}</b>: ${esc(warmthText(w))}</span><span>${clockTxt}</span></div>
      <div class="heat" style="margin:0.25rem 0 0.35rem;background:linear-gradient(90deg, ${warmColor(0)}, ${warmColor(50)}, ${warmColor(100)})"><i style="left:${Math.min(99, w)}%"></i></div>
      <div class="small"${tip("The Hivemind's beat: louder the nearer the core, through the walls. Beside the core's wall it is loud even where no door opens on your side; the warmth only rises along a way that leads in.")}>Sound <b style="color:${warmColor(snd)}">${snd}</b>: ${esc(soundText(snd))}</div>
      <div class="heat" style="margin:0.25rem 0 0.35rem;background:linear-gradient(90deg, #2a3040, #8a7aa0, #e0d0ff)"><i style="left:${Math.min(99, snd)}%"></i></div>
      <div class="small"${tip(`The hive's Alert: the noise you have made (fights, fire, a failed sneak), fading ${HCRAWL.ALERT.decay} an hour; lying still lets it fall faster. From ${HCRAWL.ALERT.converge} the brood converges on you and fills the chambers behind you again; from ${HCRAWL.ALERT.block} it packs the mouths.`)}>Alert: <b>${alertName(c.alert)}</b> (${Math.round(c.alert)})</div>
      <div class="heat" style="margin:0.25rem 0 0.2rem"><i style="left:${Math.min(99, c.alert)}%"></i></div>
      ${chamberLine(state, c, room)}
      <div class="small muted">${c.kills} of the brood killed this crawl${c.lost.length ? ` · <span class="danger">lost ${esc(c.lost.join(", "))}</span>` : ""}</div>
    </div>
    <div>
      ${members.map((m) => `<div class="row small" style="gap:0.4rem"><span style="width:6.5rem;overflow:hidden;white-space:nowrap">${esc(m.name.split(" ")[0])}</span><div style="flex:1">${bar(m.health, m.health < 40 ? "var(--danger)" : m.health < 70 ? "#c9a24a" : "var(--good)")}</div><span class="muted" style="width:2rem;text-align:right">${Math.round(m.health)}</span></div>`).join("")}
      <div class="small" style="margin-top:0.25rem"><span${tip(`Every round and arrow the team has, by calibre: ${breakdownText(teamAmmoBreakdown(state, p), "; ")}`)}>Ammo ${teamAmmoBreakdown(state, p).total}</span> · Meds ${Math.floor(carried(p, "meds"))} · Fuel ${Math.floor(carried(p, "fuel"))}${c.hadVehicle ? " · <span class=\"muted\">the vehicle waits at the mouth</span>" : ""}</div>
      ${lightsRow(state, p, c)}
      <div class="small" style="margin-top:0.2rem">${found.length ? found.slice(0, 10).map((f) => `<span class="chip">${esc(f)}</span>`).join("") : "<span class='muted'>Nothing found yet.</span>"}</div>
    </div>
  </div>`;
}

// The chambers the team knows: where it has been (coloured by warmth, its kind's initial), the passages it has seen
// out of them (fogged "?"), the walls of each chamber it has been in (3 open, 1 wall: the T of each; on the rim the
// outside) and the den's four mouths (known from outside). A passage out of the team's chamber is a button.
function mapSvg(state, p, c, den) {
  // The round grid (sim/hivecrawl.js genDen): each chamber where it lies, the mouths just outside the rim. A den from
  // before the grid: the mouth on the left, its layers to the right.
  const g = !!den.grid;
  const cols = g ? den.size + 2 : den.depth + 1, rows = g ? den.size + 2 : Math.max(2, den.width);
  const dx = g ? Math.max(30, Math.min(46, 520 / cols)) : Math.max(34, Math.min(64, 520 / cols)), dy = g ? dx : 34;
  const Wd = 30 + (cols - 1) * dx + 30, Hd = 24 + (rows - 1) * dy + 24;
  const pos = (r) => (g ? [30 + (r.x + 1) * dx, 24 + (r.y + 1) * dy] : [30 + r.layer * dx, 24 + r.slot * dy + (r.layer % 2 ? 6 : 0)]);
  const mouths = new Set(mouthsOf(den));
  const show = (id) => c.visited[id] || c.seen[id] || (g && mouths.has(id));
  const here = roomById(den, c.at);
  const exits = new Set(here.links);
  let lines = "", walls = "", nodes = "";
  for (const r of den.rooms) {
    if (!show(r.id)) continue;
    for (const id of r.links) {
      if (id < r.id || !show(id) || !(c.visited[id] || c.visited[r.id])) continue;
      const o = roomById(den, id);
      const [x1, y1] = pos(r), [x2, y2] = pos(o);
      lines += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c.visited[id] && c.visited[r.id] ? "#8a6a5a" : "#4a4f58"}" stroke-width="${c.visited[id] && c.visited[r.id] ? 3 : 2}" ${c.visited[id] && c.visited[r.id] ? "" : 'stroke-dasharray="4 3"'}/>`;
    }
  }
  if (g) { // the walls of the chambers the team has been in: every side with no passage through it
    const at = new Map(den.rooms.filter((r) => !mouths.has(r.id)).map((r) => [`${r.x}_${r.y}`, r]));
    const done = new Set(), h = dx * 0.46;
    const ends = [[-1, -1, 1, -1], [1, -1, 1, 1], [-1, 1, 1, 1], [-1, -1, -1, 1]]; // N, E, S, W: the side's two corners
    for (const r of den.rooms) {
      if (!c.visited[r.id] || mouths.has(r.id)) continue;
      const [x, y] = pos(r);
      [[0, -1], [1, 0], [0, 1], [-1, 0]].forEach(([sx, sy], d) => {
        const o = at.get(`${r.x + sx}_${r.y + sy}`);
        if (r.links.some((id) => { const n = roomById(den, id); return n && n.x === r.x + sx && n.y === r.y + sy; })) return;
        const k = o ? [r.id, o.id].sort().join("|") : `${r.id}:${d}`;
        if (done.has(k)) return;
        done.add(k);
        const [ax, ay, bx, by] = ends[d];
        walls += `<line x1="${x + ax * h}" y1="${y + ay * h}" x2="${x + bx * h}" y2="${y + by * h}" stroke="#9a6650" stroke-width="3.5" stroke-linecap="round"/>`;
      });
    }
  }
  for (const r of den.rooms) {
    if (!show(r.id)) continue;
    const [x, y] = pos(r);
    const v = !!c.visited[r.id], cur = r.id === c.at, ex = exits.has(r.id) && !c.enc, m = mouths.has(r.id);
    const w = warmthOf(den, r);
    const h = !v && c.heard ? c.heard[r.id] : null; // heard or lit from a passage (Listen, Flare)
    const initial = (k) => (k === "core" ? "★" : ROOM_KINDS[k] ? ROOM_KINDS[k].short : "?");
    const label = v || m ? initial(r.kind) : h ? `${initial(h.kind)}${h.q === "exact" ? "" : "?"}` : "?";
    const title = v ? `${roomName(r)} (warmth ${w})${broodLeft(state, crawlHive(state, c), r) && r.kind !== "core" ? `: ${broodLeft(state, crawlHive(state, c), r)} of the brood` : ""}${m ? ", a way out" : ""}` : m ? `${roomName(r)}: a way in and out, not been in` : h ? `${h.by === "flare" ? "Lit by a flare" : "Heard"}: ${heardText(h)}${h.q === "vague" ? " (a guess)" : ""}` : "Not explored";
    const glow = h && h.by === "flare" ? `<circle cx="${x}" cy="${y}" r="16" fill="rgba(255,70,40,0.28)"/>` : "";
    const circle = `${glow}<circle cx="${x}" cy="${y}" r="${cur ? 13 : 11}" fill="${v ? warmColor(w, 0.95) : m ? "#2c3a44" : h ? "#3a3036" : "#23262c"}" stroke="${cur ? "#fff" : v ? "#2a1a14" : m ? "#9ab8c8" : h ? (h.by === "flare" ? "#ff6a3a" : "#c9a24a") : "#6a707a"}" stroke-width="${cur ? 3 : 1.5}" ${v ? "" : 'stroke-dasharray="3 2"'}/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="11" fill="${v ? "#1a0e0a" : m ? "#cfe0ea" : h ? "#f0d8b0" : "#aab"}" style="pointer-events:none;font-weight:bold">${label}</text>`;
    nodes += ex ? `<g data-action="hc-move" data-id="${p.id}" data-room="${r.id}" style="cursor:pointer"><title>${esc(title)} — go there</title>${circle}</g>` : `<g><title>${esc(title)}</title>${circle}</g>`;
  }
  const rim = g ? `<circle cx="${30 + (den.size / 2 + 0.5) * dx}" cy="${24 + (den.size / 2 + 0.5) * dy}" r="${(den.size / 2) * dx}" fill="none" stroke="#3a3036" stroke-width="1.5" stroke-dasharray="5 4"/>` : ""; // the den's rim
  return `<svg class="hc-map" viewBox="0 0 ${Wd} ${Hd}" style="width:100%;max-height:${g ? 24 : 16}rem;background:rgba(0,0,0,0.25);border-radius:6px">${rim}${lines}${walls}${nodes}</svg>
    <div class="small muted" style="margin-top:0.2rem">${g ? `Four mouths (M), one on each side of the rim: in by one, out by any. Every chamber opens on three sides, the fourth is wall (the thick lines). The core lies deep in the middle, its walls open on only one or two sides: follow the beat to find it, the drafts to find the way in.` : "The mouth on the left; the core lies somewhere to the right."} Letters: the kind of chamber (M a mouth, T tunnel, G gallery, N nursery, E eggs, B bones, W worm pool, R root, C collapse); ? not explored; a letter with ? heard through the wall, ringed red lit by a flare.</div>`;
}

function roomCard(state, p, c, den, room, w) {
  const K = ROOM_KINDS[room.kind] || {};
  const hive = crawlHive(state, c);
  const n = broodLeft(state, hive, room);
  const free = canMoveOn(state, c);
  const exits = exitsOf(state, p);
  const miss = draftMissHere(state, p, c);
  const flares = flaresOf(state, p).length;
  const acts = roomActions(state, p);
  // The way out (leaving is a walk): at a mouth, Leave by this mouth (a room action); at an entrance, into its mouth;
  // elsewhere how far the nearest mouth you know is.
  const gate = !isMouth(den, room.id) ? mouthBy(den, room) : null;
  const way = !gate && !isMouth(den, room.id) ? wayOut(state, c) : null;
  const outRow = gate
    ? `<div class="row" style="margin-top:0.6rem;justify-content:flex-end"><button class="primary" data-action="hc-move" data-id="${p.id}" data-room="${gate}" ${free ? "" : "disabled"}${tip(free ? `Into ${mouthSide(den, gate) ? `the ${mouthSide(den, gate)} mouth` : "the mouth"} (${HCRAWL.MOVE_HOURS} h); its brood is in the way if it is there. Then Leave by this mouth.` : "The brood is still in this chamber: fight it, creep past, or go back the way you came.")}>Leave by the ${esc(mouthSide(den, gate) || "hive's")} mouth ▸</button></div>`
    : way ? `<div class="small muted" style="margin-top:0.5rem;text-align:right"${tip("Leaving is a walk: chamber by chamber to any of the four mouths, then Leave by this mouth. A chamber you cleared and made noise in may have filled again; the brood you crept past is still there.")}>The way out: ${way.length} chamber${way.length === 1 ? "" : "s"} to ${esc(mouthSide(den, way[way.length - 1]) ? `the ${mouthSide(den, way[way.length - 1])} mouth` : "the mouth")} by the way you know.</div>` : "";
  return `<div class="card" style="margin:0;border-color:${warmColor(w, 0.6)}"><b>${esc(roomName(room))}</b><div class="small" style="margin:0.2rem 0">${esc(K.text || "")} The air is ${esc(warmthText(w))}; ${esc(soundText(soundOf(den, room)))}.${n && c.slipped[room.id] ? ` The ${n} of the brood you crept past are still here.` : ""}</div>
    <div class="row" style="gap:0.35rem;flex-wrap:wrap">${acts.map((a) => `<button${a.id === "out" ? ' class="primary"' : ""} data-action="hc-act" data-id="${p.id}" data-act="${a.id}" ${a.disabled ? "disabled" : ""}${tip(a.tip)}>${esc(a.label)}</button>`).join("")}</div></div>
    <h3 style="margin-top:0.5rem">Passages</h3>
    <div class="small muted" style="margin-bottom:0.25rem"${tip(`Your best scout reads the drafts. A team without a good scout misreads one now and then${lightsOn(state, p, c) ? "; your lights help" : teamLights(state, p) ? "; your lights are off" : "; a light would help"}. A passage lit by a flare reads true.`)}>Drafts read right about ${Math.round((1 - miss) * 100)}% of the time${lightsOn(state, p, c) ? " (in your lights)" : ""}.</div>
    ${exits.map((x) => {
      const r = x.room;
      const name = x.mouth ? `${r ? roomName(r) : "The mouth"} (a way out)` : r ? roomName(r) : "An unexplored passage";
      const back = x.back ? " (the way you came)" : "";
      const dcol = x.draft === "warmer" ? warmColor(85) : x.draft === "colder" ? warmColor(5) : "#999";
      const dis = !free && !x.back;
      const h = !x.visited ? x.heard : null;
      const heard = h ? `<div class="small" style="color:${h.by === "flare" ? "#ff8a5a" : h.q === "vague" ? "#999" : "#d9b46a"}">${h.by === "flare" ? "🔥 Lit" : "👂 Heard"}: ${esc(heardText(h))}${h.q === "vague" ? " (a guess)" : h.q === "rough" ? " (roughly)" : ""}</div>` : "";
      const lo = !x.visited ? listenOdds(state, p, c, roomById(den, x.id)) : null;
      const canListen = !x.visited && !(h && (h.by === "listen" || h.q === "exact"));
      const listen = !x.visited ? `<button class="mini" data-action="hc-listen" data-id="${p.id}" data-room="${x.id}" ${canListen ? "" : "disabled"}${tip(canListen ? `Listen at the passage (${HCRAWL.LISTEN.hours} h): your best listener's (Scouting + Stealth) / 2 = ${lo.skill} + d10 against ${lo.dc}. About ${Math.round(lo.rough * 100)}% to make out what lies beyond and roughly how many (${Math.round(lo.exact * 100)}% exactly); else a guess${lo.fumble > 0 ? `, and ${Math.round(lo.fumble * 100)}% a noise that warns them (Alert +${HCRAWL.LISTEN.alert})` : ""}.` : "You have listened there.")}>Listen</button>` : "";
      const flare = !x.visited && !(h && h.by === "flare") ? `<button class="mini" data-action="hc-flare" data-id="${p.id}" data-room="${x.id}" ${flares ? "" : "disabled"}${tip(flares ? `Throw a road flare down it (${flares} left): the chamber beyond lit, its kind and its brood as they are, and the true draft. The brood sees the glare: Alert +${HCRAWL.FLARE.alert}.` : "No road flares.")}>Flare</button>` : "";
      return `<div class="row small" style="gap:0.4rem;margin:0.15rem 0;align-items:flex-start"><button data-action="hc-move" data-id="${p.id}" data-room="${x.id}" ${dis ? "disabled" : ""}${tip(dis ? "The brood is still in this chamber: fight it, creep past, or go back the way you came." : `About ${HCRAWL.MOVE_HOURS} h through the tunnels. ${x.visited ? "You have been there: you go quietly (no Alert), but a chamber you made noise in may have filled again." : `Alert +${HCRAWL.ALERT.move}${lightsOn(state, p, c) ? ` (+${HCRAWL.LIGHT.move} with your lights on)` : ""}.`}${x.mouth ? " Into the mouth: its brood is in the way if it is there; then Leave by this mouth." : ""}`)}>Go ▸</button><span style="flex:1">${x.dir ? `<span class="muted">${esc(x.dir[0].toUpperCase() + x.dir.slice(1))}:</span> ` : ""}${esc(name)}${back}${heard}</span><span style="color:${dcol}"${tip("The draft: does the air that way come warmer (nearer the core along the passages) or colder?")}>${esc(draftWord(x.draft))}</span><span class="muted"${tip("The Hivemind's beat that way: louder, fainter or the same. It carries through the walls, so it says how near the core is, not that a passage leads in.")}>${x.sound === "louder" ? "🔊 louder" : x.sound === "fainter" ? "🔈 fainter" : "🔉 same"}</span>${listen}${flare}</div>`;
    }).join("")}
    ${outRow}`;
}

function encounterCard(state, p, c, den) {
  const e = c.enc;
  if (e.fighting) return `<div class="card attn"><b>Fighting</b></div>`;
  const opts = encounterOptions(state, p);
  const room = roomById(den, e.room) || roomById(den, c.at);
  const title = e.kind === "core" ? `The core: the ${BOSS_NAMES.hivemind}` : e.kind === "swarm" ? "The brood converges" : e.kind === "turned" ? "One of you turned" : `The brood in ${roomName(room).toLowerCase()}`;
  const n = e.enemy ? e.enemy.count : broodLeft(state, crawlHive(state, c), room);
  const text = e.kind === "core" ? `A hill of flesh fills the end of the chamber and beats like a heart: the ${BOSS_NAMES.hivemind}. The ${BOSS_NAMES.hive} squats at its foot among the last of the brood. It never moves; kill it and the hive dies. Fire burns it and keeps its brood in the walls; a flashbang or a grenade stuns it.` : `${n} of the brood${e.spotted ? ", and they have seen you" : ""}. ${(ROOM_KINDS[room.kind] || {}).text || ""}`;
  return `<div class="card attn"><b>${esc(title)}</b>
    <div class="small" style="margin:0.25rem 0 0.5rem">${esc(text)}</div>
    <div class="choices">${opts.map((o) => `<button data-action="hc-enc" data-id="${p.id}" data-ch="${o.id}" ${o.disabled ? "disabled" : ""}>${esc(o.label)}<span class="hint">${esc(o.tip)}</span></button>`).join("")}</div></div>`;
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
  "hc-listen": run((state, p, d) => listenAt(state, p, d.room)),
  "hc-flare": run((state, p, d) => throwFlare(state, p, d.room)),
  "hc-lights": run((state, p, d) => setLights(state, p, d.on === "1" || d.on === 1)),
};
