// The alerts stack on the right edge of the map (RimWorld style): things that want your attention now. Click one
// to jump to the place or open the right screen; 💤 snoozes it for a day, ✕ dismisses it until it clears and comes
// back. Also the map keys added with it (main.js calls mapHotkey before its own keys): tabs, next waiting team,
// bases, camera spots, the diary and the roster.
import { foodIn } from "../sim/foods.js"; // days of food (every kind)
import { day, alive, residents, survivorById, baseById } from "../sim/world.js";
import { foodOutlook, waterOutlook } from "../sim/economy.js";
import { useText, HEAT, woodFor } from "../sim/upkeep.js";
import { SUPPLIES } from "../sim/data.js";
import { waterUseText } from "./farming.js";
import * as Buildings from "../sim/buildings.js";
import { holdLimit } from "../sim/defences.js";
import { cellOf } from "../sim/work.js";
import { moodRisk } from "../sim/morale.js";
import { conditionsOf, autoWantsCondition, CONDITIONS, noMedsList, recentNews } from "../sim/health.js";
import { wormOf, WORM } from "../sim/worm.js";
import { partyTile, partyMembers, MISSIONS } from "../sim/parties.js";
import { needAlerts } from "../sim/needs.js";
import { contactable } from "../sim/orders.js";
import { commandable } from "../sim/plans.js";
import { selectedTeam } from "./teamsel.js"; // Shift+B: the selected team's inventory
import { isPlayerTeam } from "../sim/teaminv.js";
import { diaryEntries, diarySync, decodeRefs } from "../sim/diary.js";
import { camera } from "./render.js";
import { brokenAt, fixtureName, jobFor, fxDef } from "../sim/breakdowns.js";
import { freezerLine } from "../sim/power.js"; // freezer-parts: the freezer-off alert
import { activeCrashes, CRASH_KINDS, daysLeft } from "../sim/crashes.js";
import { knownLoc } from "../sim/discovery.js";
import { openDiary } from "./diary.js";
import { openRoster } from "./roster.js";
import { keyAction, keyLabel } from "./keymap.js"; // the key table (Menu → Controls)
import { openCodex } from "./codex.js";
import { visitorAlerts } from "./visitors.js";
import { roadAlerts } from "./hardcore.js";
import { baseFoodHint, landFoodHint } from "../sim/foraging.js";
import { woodShortfall } from "../sim/woodcutting.js";
import { carried } from "../sim/parties.js";
import { gatheringAlerts } from "../sim/hivebirth.js";
import { weatherAlerts } from "../sim/rivers.js"; // a frozen river by a base, a storm heading for the hub
import { tripAlerts } from "./trips.js"; // a team sent from the planner is home: repeat the trip?
import { pileCount } from "./pacing.js";
import { recentRepairs } from "../sim/repairwait.js";
import { fieldworkAlerts } from "./fieldworks.js"; // field works out on the bases' land // a breakdown repaired on the road: the team drives on
import { buildMapAlerts } from "./buildmap.js"; // Open the build map (sim/staging.js askLayout)
import { stallAlerts, noWorkAlerts } from "./activity.js"; // a job at a base unable to work for 2+ days; roles with no work (sim/noidle.js)

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const firstName = (name) => String(name || "").split(/\s+/)[0];
export const HORDE_ALERT_TILES = 6; // a horde you can see this close to a base is an alert
const SHOWN = 8;                    // alerts listed before "+N more"
const EVENT_HOURS = 24;             // "building finished" and the like stay up this long

// ---------- what needs attention ----------
// Each alert: { key, kind, icon, text, tip, tone (danger | warn | good | info), go: { team | base+tab | tile | surv } }.
const teamLabel = (state, p) => `${MISSIONS[p.teamMission || p.mission]?.name || "Team"} (${partyMembers(state, p).map((s) => firstName(s.name)).join(", ")})`;
const SECTIONS = {
  layout: buildMapAlerts, // ui/buildmap.js: a base new to you or just gone up a tier: Open the build map
  stalled: stallAlerts, // ui/activity.js: a job at a base that cannot work (no trees, nothing to build …) for 2+ days
  nowork: noWorkAlerts, // ui/activity.js: the roles at a base with no work, quiet (they help elsewhere meanwhile)
  road: roadAlerts, // no base (hardcore's first hub, the exiles): the team's food and water, a home to set up (Establish base); camps left alone (ui/hardcore.js)
  teams(state, out) {
    for (const p of state.parties) {
      if (p.owner !== "player" || p.kind === "convoy" || p.phase !== "waiting") continue;
      if (p.plan && p.plan.active === false) {
        out.push({ key: `plan:${p.id}`, kind: "plan", icon: "✅", tone: "good", text: `Plan finished: ${teamLabel(state, p)}`, tip: "This team has done every step of its plan and waits for orders. Click to open its panel.", go: { team: p.id } });
      } else {
        out.push({ key: `wait:${p.id}`, kind: "wait", icon: "❗", tone: "warn", text: `Waiting for orders: ${teamLabel(state, p)}`, tip: "This team is waiting for orders. Click to open its panel (Tab or N cycles through waiting teams).", go: { team: p.id } });
      }
    }
  },
  supplies(state, out) {
    for (const b of state.bases) {
      const n = residents(state, b.id).length;
      if (!n) continue;
      const food = foodIn(b.stock);
      if (b.hungerDays > 0 || food < 1) out.push({ key: `starve:${b.id}`, kind: "starve", icon: "🍽", tone: "danger", text: `${b.name} is out of food`, tip: "Everyone there goes hungry: they lose health every day and nobody heals. Bring food (supply run, trade) or move people. Click to open the base.", go: { base: b.id, tab: "farming" } });
      else {
        const o = foodOutlook(state, b);
        if (o.daysLeft < 5) {
          // Under 3 days: where food from the land is (sim/foraging.js): "hunt or forage nearby: forest to the east".
          const hint = o.daysLeft < 3 ? baseFoodHint(state, b) : "";
          out.push({ key: `food:${b.id}`, kind: "food", icon: "🥫", tone: o.daysLeft < 2 ? "danger" : "warn", text: `${b.name}: food for ${Math.max(0, Math.floor(o.daysLeft))} day${Math.floor(o.daysLeft) === 1 ? "" : "s"}${hint ? `: ${hint.replace(/ \(.*\)$/, "")}` : ""}`, tip: `About ${Math.floor(o.stock)} food in store; ${useText(o.use)} eaten a day${o.spoil >= 0.05 ? ` and ${Math.round(o.spoil * 10) / 10} spoiling` : ""}, not counting harvests to come.${hint ? ` ${hint[0].toUpperCase()}${hint.slice(1)}: put people on the Forage job (Work tab or their role), or send a team to hunt or forage.` : ""} Click to open the base's Farming tab.`, go: { base: b.id, tab: "farming" } });
        }
      }
      // Wood (sim/woodcutting.js): the cold within a month (or here) and less heat in store than it needs.
      const ws = woodShortfall(state, b);
      if (ws && (ws.cold || ws.toCold <= 28 || ws.pressing)) { // the water boiler (worm.js) and the Kitchen's stove (kitchen.js) burn wood in every season
        const hint = ws.why ? `${ws.why}: send a team to cut wood, or trade for it` : `a woodcutter brings in about ${ws.perDay} a day here`;
        out.push({ key: `wood:${b.id}`, kind: "wood", icon: "🪵", tone: ws.cold || ws.toCold <= 7 ? "danger" : "warn", text: `${b.name}: ${ws.cold ? "cold, and" : ws.pressing && ws.toCold > 28 ? (ws.boiler > 0 ? "the water boiler burns it:" : "the kitchen's stove burns it:") : "winter is coming:"} wood ${Math.floor(ws.have)} of ${ws.need}`, tip: `${ws.boiler > 0 ? `The water boiler burns ${ws.boiler} wood a day (${WORM.BOILER_WOOD_HEAD} a head) every day the water carries the worm's eggs; a cold boiler means unboiled water. ` : ""}${ws.kitchen > 0 ? `The kitchen's stove burns ${ws.kitchen} wood a day; without it the meals are cold. ` : ""}The cold ahead (about ${Math.round(ws.days)} freezing days${ws.cold ? "" : `, from about ${ws.toCold} days from now`}) needs about ${ws.need} wood for the ${ws.heads} fed here (${woodFor(HEAT.fuel)} a head a day, ${woodFor(HEAT.fuel) * SUPPLIES.wood.weight} kg; fuel covers what the wood does not, ${HEAT.fuel} a head). In store: ${Math.floor(ws.have)} wood and ${Math.floor(b.stock.fuel || 0)} fuel. Without them everyone is cold: mood and health a day, and illness. ${hint[0].toUpperCase()}${hint.slice(1)}: put people on Cut wood (Work tab). Click to open the base.`, go: { base: b.id, tab: "farming" } });
      }
      if (b.thirstDays > 0 || (b.stock.water || 0) + (b.stock.rawwater || 0) < 1) out.push({ key: `thirst:${b.id}`, kind: "thirst", icon: "🚱", tone: "danger", text: `${b.name} is out of water`, tip: "Thirst kills faster than hunger: everyone there loses health every day. Wells, rain catchers, filters or a supply run. Click to open the base.", go: { base: b.id, tab: "farming" } });
      else {
        const w = waterOutlook(state, b);
        if (w.daysLeft < 3) out.push({ key: `water:${b.id}`, kind: "water", icon: "💧", tone: w.daysLeft < 1.5 ? "danger" : "warn", text: `${b.name}: water for ${Math.max(0, Math.floor(w.daysLeft))} day${Math.floor(w.daysLeft) === 1 ? "" : "s"}`, tip: `${Math.floor(w.stock)} water in store, ${w.net} a day (in ${w.inflow}; drunk ${waterUseText(w.need)}${w.need.crops ? `, crops ${w.need.crops}` : ""}). Click to open the base's Farming tab.`, go: { base: b.id, tab: "farming" } });
      }
    }
  },
  // A team in the field running out of food (under 1.5 days; the no-base road team has its own, ui/hardcore.js): where
  // food from the land is nearby (sim/foraging.js).
  fieldfood(state, out) {
    if (!state.bases.length) return;
    for (const p of state.parties) {
      if (p.owner !== "player" || p.kind === "convoy" || p.phase === "back") continue;
      const n = partyMembers(state, p).length;
      if (!n) continue;
      const days = carried(p, "food") / n; // days of food (sim/foods.js)
      if (days >= 1.5) continue;
      const hint = landFoodHint(state, p);
      out.push({ key: `teamfood:${p.id}`, kind: "teamfood", icon: "🥫", tone: days < 0.5 ? "danger" : "warn", text: `${teamLabel(state, p)}: food for ${Math.round(days * 10) / 10} days${hint ? `: ${hint.replace(/, about.*$/, "")}` : ""}`, tip: `The team is running out of food: out of it, everyone loses health every hour.${hint ? ` ${hint[0].toUpperCase()}${hint.slice(1)}.` : ""} Forage, hunt or fish (team panel), search a farm, grocery or diner, or head home. Click to open the team panel.`, go: { team: p.id } });
    }
  },
  // sim/needs.js: people starving or parched on a team you are in touch with (or anywhere at a base), and bases out of
  // heating fuel in the cold.
  needs(state, out) {
    for (const p of state.parties) {
      if (p.owner !== "player" || !(p.kind === "convoy" || contactable(p))) continue;
      const low = needAlerts(state, partyMembers(state, p));
      if (low.length) out.push({ key: `needs:${p.id}:${low.length}`, kind: "needs", icon: "🍞", tone: low[0].tone, text: low.length === 1 ? low[0].text : `${low[0].text} +${low.length - 1}`, tip: `${low.map((x) => x.text).join("; ")}. The team eats and drinks from what it carries and found; forage, hunt or fish, or head home. Click to open the team panel.`, go: { team: p.id } });
    }
    for (const b of state.bases) {
      const low = needAlerts(state, residents(state, b.id));
      if (low.length) out.push({ key: `needsb:${b.id}:${low.length}`, kind: "needs", icon: "🍞", tone: low[0].tone, text: `${b.name}: ${low.length === 1 ? low[0].text : `${low.length} hungry or thirsty`}`, tip: `${low.map((x) => x.text).join("; ")}. Click to open the base.`, go: { base: b.id, tab: "farming" } });
      if (b.cold && residents(state, b.id).length) out.push({ key: `cold:${b.id}`, kind: "cold", icon: "🥶", tone: "danger", text: `${b.name} is cold: no heating fuel`, tip: `Below 0°C everyone burns ${b.heat ? `${b.heat.each} fuel a day each (${b.heat.need} a day here)` : "fuel to keep warm"}. Without it they lose mood and health every day and fall ill as if outdoors. Bring fuel (gas stations, truck stops, trade) or build a still. Click to open the base.`, go: { base: b.id, tab: "farming" } });
    }
  },
  stations(state, out) {
    const list = Buildings.stations, status = Buildings.stationStatus, B = Buildings.BUILDINGS;
    if (typeof list !== "function" || typeof status !== "function") return;
    for (const b of state.bases) {
      const idle = [];
      for (const st of list(b)) {
        const ss = status(state, b, st);
        if (ss && !ss.running) idle.push(`${(B && B[st.type] && B[st.type].name) || st.type} (${String(ss.reason || "idle").toLowerCase()})`);
      }
      if (idle.length) out.push({ key: `idle:${b.id}:${idle.length}`, kind: "idle", icon: "⚙", tone: "warn", text: `${idle.length === 1 ? "Station idle" : `${idle.length} stations idle`} at ${b.name}`, tip: `${idle.join("; ")}. Click to open the Workshops tab.`, go: { base: b.id, tab: "workshops" } });
    }
  },
  hordes(state, out) {
    const g = state.grid;
    for (const h of state.hordes) {
      // A watchtower's alarm (sim/defences.js towerWatch): its own alert, seen right now or not (the lookouts track it).
      const tower = state.bases.find((b) => b.towerWatch && b.towerWatch.ids.includes(h.id));
      if (tower) {
        const d = g.distance(h.tile, tower.tile), limit = holdLimit(state, tower, h.bosses || 0);
        const coming = (h.goal && h.goal.baseId === tower.id) || h.target === tower.tile;
        const up = residents(state, tower.id).filter((s) => cellOf(state, s, "guard").watch);
        const seen = state.live.has(h.tile), where = seen ? `${d} tile${d === 1 ? "" : "s"} out` : "out of sight"; // at night the tower sees a tile: the lookouts know it is out there
        out.push({ key: `tower:${tower.id}:${h.id}`, kind: "tower", icon: "🗼", tone: coming || h.size > limit ? "danger" : "warn", text: `Watchtower at ${tower.name}: horde of ${h.size}, ${where}${coming ? ", coming" : ""}`,
          tip: `The watchtower ${seen ? "sees" : "saw"} a horde of about ${h.size}${h.bosses ? " with a Wallbreaker" : ""} ${seen ? `${d} tile${d === 1 ? "" : "s"} from ${tower.name}` : `near ${tower.name} (out of sight now)`}${coming ? ", heading this way" : ""}. Its defences hold about ${Math.round(limit)}${h.size > limit ? ": it would break in" : ""}. ${up.length ? `Guard is moved up to priority 1 for ${up.map((s) => firstName(s.name)).join(", ")} (their backup job) until it has gone.` : "Anyone on work priorities there with Guard as a backup job moves it up to priority 1 until it has gone."} Click to see ${seen ? "the horde" : "the base"}.`, go: { tile: seen ? h.tile : tower.tile } });
        if (!(coming && h.size > limit) || !state.live.has(h.tile)) continue; // in place of the plain horde alert; a likely break-in keeps its own
      }
      if (!state.live.has(h.tile)) continue; // only hordes you can see now
      let best = null, dist = Infinity;
      for (const b of state.bases) {
        const dd = g.distance(h.tile, b.tile);
        if (dd < dist) { dist = dd; best = b; }
      }
      if (!best || dist > HORDE_ALERT_TILES) continue;
      const heading = state.bases.find((b) => (h.goal && h.goal.baseId === b.id) || h.target === b.tile);
      const target = heading || best;
      const limit = holdLimit(state, target, h.bosses || 0);
      if (heading && h.size > limit) {
        out.push({ key: `breakin:${h.id}`, kind: "breakin", icon: "🚨", tone: "danger", text: `Break-in likely at ${target.name}: horde of ${h.size}`, tip: `A horde of ${h.size}${h.bosses ? " with a Wallbreaker" : ""} is heading for ${target.name}, ${g.distance(h.tile, target.tile)} tiles out. Its defences hold about ${Math.round(limit)}: guards, barricades, pits and the decoy fire help. Click to see the horde.`, go: { tile: h.tile } });
      } else {
        out.push({ key: `horde:${h.id}`, kind: "horde", icon: "🧟", tone: heading ? "danger" : "warn", text: `Horde of ${h.size}, ${dist} tile${dist === 1 ? "" : "s"} from ${best.name}`, tip: `${heading ? `Heading for ${heading.name}. ` : ""}${target.name}'s defences hold about ${Math.round(limit)}. Click to see the horde.`, go: { tile: h.tile } });
      }
    }
  },
  sick(state, out) {
    const today = day(state);
    for (const b of state.bases) {
      const who = [];
      for (const s of residents(state, b.id)) {
        const bad = conditionsOf(s).filter((c) => autoWantsCondition(c) && (c.treatedDay ?? -99) < today - 1);
        if (bad.length || s.woundInfected) who.push(`${firstName(s.name)} (${[...bad.map((c) => (CONDITIONS[c.key] ? CONDITIONS[c.key].name : c.key).toLowerCase()), ...(s.woundInfected ? ["infected wound"] : [])].join(", ")})`);
      }
      if (who.length) out.push({ key: `sick:${b.id}:${who.length}`, kind: "sick", icon: "✚", tone: "warn", text: `${who.length} untreated at ${b.name}`, tip: `Sick or hurt and not treated for two days: ${who.join(", ")}. Meds, medics and the reserve are on the Medical tab. Click to open it.`, go: { base: b.id, tab: "medical" } });
    }
  },
  // sim/health.js: the sick with no meds where they are (a base out of meds, a team carrying none).
  nomeds(state, out) {
    for (const x of noMedsList(state)) {
      const names = x.who.map(({ s, c }) => `${firstName(s.name)} (${(CONDITIONS[c.key] ? CONDITIONS[c.key].name : c.key).toLowerCase()})`);
      if (x.base) out.push({ key: `nomeds:b${x.base.id}:${x.who.length}`, kind: "nomeds", icon: "💊", tone: "danger", text: `No meds at ${x.base.name}: ${x.who.length} sick`, tip: `${names.join(", ")} need${x.who.length === 1 ? "s" : ""} treatment and ${x.base.name} has no meds: untreated, illness lasts longer, worsens and can kill. Pharmacies, clinics and hospitals have the most; a med station makes them; traders sell them. Click to open the Medical tab.`, go: { base: x.base.id, tab: "medical" } });
      else if (x.party.kind === "convoy" || contactable(x.party)) out.push({ key: `nomeds:p${x.party.id}:${x.who.length}`, kind: "nomeds", icon: "💊", tone: "danger", text: `No meds: ${teamLabel(state, x.party)}`, tip: `${names.join(", ")} need${x.who.length === 1 ? "s" : ""} treatment and the team carries no meds. Rest by a fire, search a pharmacy or clinic, or head home. Click to open the team panel.`, go: { team: x.party.id } });
    }
  },
  // Who fell ill in the last day (one alert per base or team), and a contagious illness spreading at a base.
  ill(state, out) {
    const groups = new Map();
    for (const n of recentNews(state)) {
      const s = survivorById(state, n.id);
      if (!s || !s.alive) continue;
      const k = n.base != null ? `b${n.base}` : n.party != null ? `p${n.party}` : null;
      if (!k) continue;
      if (!groups.has(k)) groups.set(k, { n, list: [] });
      groups.get(k).list.push({ s, n });
    }
    for (const [k, g] of groups) {
      const b = g.n.base != null ? baseById(state, g.n.base) : null;
      const p = g.n.party != null ? state.parties.find((x) => x.id === g.n.party) : null;
      if (!b && !(p && (p.kind === "convoy" || contactable(p)))) continue;
      const what = g.list.map(({ s, n }) => `${firstName(s.name)} (${(CONDITIONS[n.key] ? CONDITIONS[n.key].name : n.key).toLowerCase()}${n.caught ? ", caught" : ""})`);
      const where = b ? b.name : teamLabel(state, p);
      const caught = g.list.filter((x) => x.n.caught).length;
      out.push({ key: `ill:${k}:${g.list.length}:${g.list[0].n.h}`, kind: "ill", icon: "🤒", tone: caught ? "danger" : "warn", text: g.list.length === 1 ? `${firstName(g.list[0].s.name)} fell ill${b ? ` at ${b.name}` : ""}` : `${g.list.length} fell ill: ${where}`, tip: `In the last day: ${what.join(", ")}.${caught ? ` ${caught} caught it from someone: it is spreading.` : ""} Click to see them${b ? " on the Medical tab" : ""}.`, go: b ? { base: b.id, tab: "medical" } : { team: p.id }, event: true });
    }
    for (const b of state.bases) {
      const people = residents(state, b.id);
      const sick = people.filter((s) => conditionsOf(s).some((c) => CONDITIONS[c.key] && CONDITIONS[c.key].spread && !c.mending));
      const caught = recentNews(state, 72).filter((n) => n.base === b.id && n.caught).length;
      if (sick.length < 2 || !caught) continue;
      out.push({ key: `spread:${b.id}`, kind: "spread", icon: "🦠", tone: "danger", text: `Illness spreading at ${b.name}: ${sick.length} contagious`, tip: `${sick.map((s) => firstName(s.name)).join(", ")} can pass it on (${caught} caught it in the last 3 days). Treat them (a treated illness barely spreads), quarantine them (the outbreak card), and ease the crowding. Click to open the Medical tab.`, go: { base: b.id, tab: "medical" } });
    }
  },
  // The worm (sim/worm.js): everyone known to carry it, at a base or on a team.
  worm(state, out) {
    for (const s of alive(state)) {
      const w = wormOf(s);
      if (!w || w.seen == null) continue;
      const base = s.location.kind === "base" ? baseById(state, s.location.baseId) : null;
      const brain = w.stage === "brain";
      const where = base ? `at ${base.name}` : s.location.kind === "party" ? "on a team" : "away";
      out.push({ key: `worm:${s.id}:${w.stage}`, kind: "worm", icon: "🪱", tone: brain ? "danger" : "warn", text: `${firstName(s.name)} has the worm${brain ? " in the brain" : ""}, day ${w.day} of about ${WORM.COURSE} (${where})`,
        tip: brain ? `${s.name}'s worm has reached the brain: in a day or two it kills them and they get up again. Only surgery in a staffed Clinic can save them.${w.locked ? " Locked away: nobody will be hurt." : ""}` : `${s.name} carries the worm in the gut: it hurts more every day and reaches the brain on day ${WORM.BRAIN_FROM}. A dewormer cures it for sure; a purge (${WORM.PURGE_MEDS} meds and a medic) usually does. ${base ? "Click for the Medical tab." : "Bring them to a base with meds and a medic."}`,
        go: base ? { base: base.id, tab: "medical" } : { surv: s.id } });
    }
  },
  mood(state, out) {
    for (const s of alive(state)) {
      const r = moodRisk(s);
      if (!r || r.level < 2) continue;
      out.push({ key: `desert:${s.id}`, kind: "desert", icon: "🎒", tone: "danger", text: `${firstName(s.name)}: ${r.text.toLowerCase()} (mood ${Math.floor(s.mood)})`, tip: `${s.name} may walk out soon. Rest, a bed, food, a gift or a talk with the leader help. Click to open their screen.`, go: { surv: s.id } });
    }
  },
  events(state, out) {
    // From the diary: lines of the last day that are news, not a state (a building finished, a caravan arrived).
    const today = day(state);
    for (const d of [today - 1, today]) {
      if (d < 1) continue;
      for (const e of diaryEntries(state, d)) {
        const at = (d - 1) * 24 + e.hour;
        if (e.robot || state.hour - at >= EVENT_HOURS) continue;
        const ref = decodeRefs(e.refs).find((r) => r.type === "b");
        let m;
        if ((m = /^(.+?) finished at (.+)\.$/.exec(e.text)) && Buildings.BUILDINGS && Object.values(Buildings.BUILDINGS).some((x) => x && x.name === m[1])) {
          out.push({ key: `built:${at}:${e.text}`, kind: "built", icon: "🔨", tone: "good", text: `${m[1]} finished at ${m[2]}`, tip: "Construction is done. Click to open the base's Buildings tab.", go: ref ? { base: ref.id, tab: "buildings" } : null, event: true });
        } else if (/^A caravan from .+ has arrived at /.test(e.text)) {
          out.push({ key: `caravan:${at}:${e.text}`, kind: "caravan", icon: "🐎", tone: "good", text: e.text.replace(/ with the goods you agreed on/, "").replace(/\. It stays until.*$/, ""), tip: `${e.text} Click to open the base (its Trade button is on the Bases tab).`, go: ref ? { base: ref.id, tab: "overview" } : null, event: true });
        }
      }
    }
  },
  // Broken buildings (breakdowns.js) and downed aircraft (crashes.js).
  explore(state, out) {
    for (const b of state.bases) {
      const broken = brokenAt(b);
      if (!broken.length) continue;
      const idle = broken.filter((fx) => !jobFor(b, fx));
      out.push({ key: `broken:${b.id}:${broken.map((fx) => fx.id).join(",")}`, kind: "broken", icon: "🔧", tone: idle.length ? "warn" : "info", text: `${broken.length === 1 ? `${fixtureName(broken[0])} broken` : `${broken.length} things broken`} at ${b.name}${idle.length ? "" : " (being fixed)"}`, tip: `${broken.map((fx) => `${fixtureName(fx)}: ${fxDef(fx).what}${jobFor(b, fx) ? " (being fixed)" : ""}`).join("; ")}. Click to open the Repairs tab.`, go: { base: b.id, tab: "repairs" } });
    }
    // freezer-parts: a walk-in freezer that is off (power.js base.freezerOn) while it is not broken (that is above).
    for (const b of state.bases) {
      if (b.freezerOn !== false || b.buildings.some((x) => x.type === "freezer" && x.broken)) continue;
      out.push({ key: `freezer:${b.id}`, kind: "broken", icon: "❄", tone: "warn", text: `Freezer off at ${b.name}: the food is thawing`, tip: `${freezerLine(state, b)}. Click to open the Workshops tab (the Power card).`, go: { base: b.id, tab: "workshops" } });
    }
    for (const c of activeCrashes(state)) {
      const def = CRASH_KINDS[c.kind];
      const left = daysLeft(state, c);
      const name = c.found && state.tiles[c.tile].loc ? state.tiles[c.tile].loc.name : `Downed ${def.name.toLowerCase()}`;
      out.push({ key: `crash:${c.id}:${c.found ? 1 : 0}`, kind: "crash", icon: def.icon, tone: left < 2 ? "warn" : "info", text: `${name}: ${c.found ? "found" : `search ${c.radius} tiles around ${knownLoc(state, c.center) ? state.tiles[c.center].loc.name : "the circle"}`}, ${left.toFixed(1)} days left`, tip: `${c.found ? "The wreck is on the map: raid it before other groups strip it." : "It came down somewhere in the circle on the map. Send a team to look around there (the planner's “Search the area” step)."} It burns out in about ${left.toFixed(1)} days. Click to see it.`, go: { tile: c.found ? c.tile : c.center } });
    }
  },
  gatherings(state, out) { out.push(...gatheringAlerts(state)); },
  fieldworks: fieldworkAlerts, // ui/fieldworks.js: a field work attacked, taken or destroyed; one that needs repair // sim/hivebirth.js: the dead massing for a hive you marked
  weather(state, out) { // a frozen river by a base (the dead can cross), a storm or blizzard front heading for the hub
    out.push(...weatherAlerts(state));
  },
  trips: tripAlerts,
  outsiders(state, out) { // raiders from outside near a base, merchants at one (ui/visitors.js)
    out.push(...visitorAlerts(state));
  },
  // A breakdown repaired on the road (sim/repairwait.js): the team's vehicle runs again and it drives on. News: it goes
  // once clicked (opens the team, centred) and by itself after a day.
  tunnels(state, out) { // sim/tunnels.js: tunnels the dead dug under a base's defences, open until filled
    for (const b of state.bases) {
      const list = b.tunnels || [];
      if (!list.length) continue;
      const left = list.filter((r) => !b.construction.some((c) => c.type === "filltunnel" && c.tunnel === r.id)).length;
      out.push({ key: `tunnels:${b.id}:${list.length}:${left}`, kind: "tunnels", icon: "🕳", tone: left ? "danger" : "warn", text: `${b.name}: ${list.length === 1 ? "a tunnel" : `${list.length} tunnels`} under the walls${left ? "" : " (filling)"}`,
        tip: `The dead dug ${list.length === 1 ? "a tunnel" : `${list.length} tunnels`} under the defences of ${b.name}. Until filled the walls hold less and the next horde can crawl through. ${left ? `Open the base map, click a hole and queue Fill tunnel (${left} not queued yet).` : "All of them are queued to be filled."} Click to open the base.`, go: { base: b.id, tab: "basemap" } });
    }
  },
  repairs(state, out) {
    for (const p of recentRepairs(state)) {
      const n = p.repairNews;
      out.push({ key: `fixed:${p.id}:${n.hour}`, kind: "fixed", icon: "🔧", tone: "good", text: n.text.replace(/ team \(/, " (").replace(/\. (Moving on|Heading home).*$/, "").replace(/\.$/, ""), tip: `${n.text} Click to open the team and centre on it.`, go: { team: p.id }, event: true });
    }
  },
  cards(state, out) {
    const n = pileCount(state); // cards that stop the clock (the tray shows the rest: ui/pacing.js)
    if (n > 1) out.push({ key: `cards:${n}`, kind: "cards", icon: "🃏", tone: "info", text: `${n} cards waiting`, tip: "Cards are answered one at a time: these are still in the pile. Close the screens on top to see the next one.", go: { cards: true } });
  },
};
const ORDER = ["breakin", "tunnels", "starve", "thirst", "desert", "outsiders", "tower", "horde", "gathering", "ice", "front", "nomeds", "spread", "food", "teamfood", "water", "worm", "sick", "ill", "fixed", "wait", "plan", "broken", "idle", "stalled", "nowork", "crash", "cards", "layout", "trip", "caravan", "built"];

// Good news (Options → "Good news alerts", options.goodNews, on by default): news that asks nothing of you. Off, these
// kinds are left out of the stack, so no row, flash or chime (ui/soundcues.js hears only what is shown); the log and the
// diary keep every line. Not in it: "plan" (a plan finished is the team's Waiting for orders), "firsthub" (a camp to put
// to work), and anything warn or danger.
export const GOOD_NEWS = new Set(["fixed", "built", "caravan", "trip"]);
let OPTS = null;
export function initAlerts(options) { OPTS = options || null; } // main.js: the options object (ui/saves.js)
export const goodNewsOn = () => !OPTS || OPTS.goodNews !== false;

export const isGoodNews = (a) => !!a && GOOD_NEWS.has(a.kind) && a.tone === "good";
// all: the good news too, whatever the switch says (renderAlerts: what is hidden still counts as seen).
export function computeAlerts(state, { all = false } = {}) {
  let out = [];
  for (const [name, fn] of Object.entries(SECTIONS)) {
    try { fn(state, out); } catch (err) { // one broken kind must not take the stack down
      if (!computeAlerts.warned) { computeAlerts.warned = true; console.warn(`Broken State: the ${name} alerts failed`, err); }
    }
  }
  if (!all && !goodNewsOn()) out = out.filter((a) => !isGoodNews(a));
  return out.sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}
export const ALERT_ORDER = ORDER; // the order the kinds are shown in (a kind missing from it would sort to the top)

// Dismissed (until the alert clears) and snoozed (for a day) keys, kept per run.
function mute(state, ui) {
  if (!ui.alertMute || ui.alertMute.state !== state) ui.alertMute = { state, dismissed: new Set(), snooze: new Map(), all: false, told: null };
  return ui.alertMute;
}

export function renderAlerts(state, ui) {
  if (!ui.started || state.gameOver || ui.timelapse) return "";
  diarySync(state);
  const m = mute(state, ui);
  // Good news hidden by Options → Good news alerts (off) is still seen here: told (no flash) and handed to the sounds as
  // heard (ui.alertHidden: ui/soundcues.js remembers it without a chime), so switching it back on shows what is still up
  // without flashing or chiming old news.
  const every = computeAlerts(state, { all: true });
  const on = goodNewsOn();
  const list = on ? every : every.filter((a) => !isGoodNews(a));
  ui.alertHidden = on ? [] : every.filter(isGoodNews);
  const keys = new Set(every.map((a) => a.key));
  for (const k of [...m.dismissed]) if (!keys.has(k)) m.dismissed.delete(k); // cleared: it may come back later
  for (const [k, until] of [...m.snooze]) if (state.hour >= until || !keys.has(k)) m.snooze.delete(k);
  // News that pops up as it happens (a repaired vehicle moving on): flashed once over the stack; what was already up when
  // the run was started or loaded is not, nor what came while good news was switched off.
  const pops = every.filter((a) => a.kind === "fixed");
  if (!m.told) m.told = new Set(pops.map((a) => a.key));
  for (const a of pops) if (!m.told.has(a.key)) { m.told.add(a.key); if (on) ui.flash = { text: `🔧 ${a.tip.replace(/ Click to .*$/, "")}`, at: performance.now() }; }
  const shown = list.filter((a) => !m.dismissed.has(a.key) && !m.snooze.has(a.key));
  const hidden = list.length - shown.length;
  ui.alertList = shown; // for the hotkeys and tests
  const flash = ui.flash && performance.now() - ui.flash.at < 4000 ? `<div class="al-flash">${esc(ui.flash.text)}</div>` : "";
  if (!shown.length && !hidden) return flash;
  const cut = m.all ? shown : shown.slice(0, SHOWN);
  const rows = cut.map((a) => `<div class="al al-${a.tone}">
      <button class="al-go" data-action="al-go" data-key="${esc(a.key)}"${tip(a.tip)}><span class="al-ico">${a.icon}</span>${esc(a.text)}</button>
      <button class="al-btn" data-action="al-snooze" data-key="${esc(a.key)}"${tip("Snooze: hide this for a day")}>💤</button><button class="al-btn" data-action="al-dismiss" data-key="${esc(a.key)}"${tip(a.event ? "Dismiss" : "Dismiss until it clears (it comes back if it happens again)")}>✕</button>
    </div>`).join("");
  const more = shown.length > cut.length ? `<button class="al-more" data-action="al-all"${tip("Show every alert")}>+${shown.length - cut.length} more</button>` :
    m.all && shown.length > SHOWN ? `<button class="al-more" data-action="al-all"${tip("Show fewer")}>Show fewer</button>` : "";
  const restore = hidden ? `<button class="al-more" data-action="al-restore"${tip("Show the alerts you snoozed or dismissed again")}>${hidden} hidden · show</button>` : "";
  return `${flash}${rows}${more}${restore}`;
}

function goTo(state, ui, a, act) {
  const g = a && a.go;
  if (!g) return;
  ui.diary = null;
  ui.roster = null;
  if (g.team != null) {
    const p = state.parties.find((x) => x.id === g.team);
    if (!p) return;
    act["xp-open"]({ id: p.id });
    act.center({ tile: partyTile(p) });
  } else if (g.base != null) {
    if (baseById(state, g.base)) act.openbase({ id: g.base, tab: g.tab || "overview" });
  } else if (g.tile != null) act.center({ tile: g.tile });
  else if (g.surv != null) { if (survivorById(state, g.surv)) ui.survivor = g.surv; }
  else if (g.cards) { ui.baseView = null; ui.survivor = null; ui.help = false; }
  else if (g.act && act[g.act]) act[g.act](g); // an action of its own (ui/trips.js: Repeat trip)
}

export const ALERT_ACTIONS = {
  "al-go": (state, ui, d, act) => {
    const a = computeAlerts(state).find((x) => x.key === d.key);
    goTo(state, ui, a, act);
    if (a && a.event) mute(state, ui).dismissed.add(a.key); // seen: news alerts go once clicked
  },
  "al-dismiss": (state, ui, d) => { mute(state, ui).dismissed.add(d.key); },
  "al-snooze": (state, ui, d) => { mute(state, ui).snooze.set(d.key, state.hour + 24); },
  "al-restore": (state, ui) => { const m = mute(state, ui); m.dismissed.clear(); m.snooze.clear(); },
  "al-all": (state, ui) => { const m = mute(state, ui); m.all = !m.all; },
};

// ---------- keys ----------
// Next (or, with Shift, previous) team waiting for orders: centers on it and opens its panel.
export function nextWaitingTeam(state, ui, act, back = false) {
  const waiting = state.parties.filter((p) => p.owner === "player" && p.kind !== "convoy" && p.phase === "waiting");
  if (!waiting.length) { ui.flash = { text: "No team is waiting for orders.", at: performance.now() }; return null; }
  const i = waiting.findIndex((p) => p.id === ui.expedition);
  const p = waiting[(i < 0 ? (back ? waiting.length - 1 : 0) : i + (back ? waiting.length - 1 : 1)) % waiting.length];
  act["xp-open"]({ id: p.id });
  act.center({ tile: partyTile(p) });
  return p;
}

// Camera spot n (1–9): save the view there, or go back to it. The keys (mapHotkey) and, on a phone or tablet, the
// 📷 Spots buttons (ui/responsive.js, main.js "cam-spot").
export function camSpot(state, ui, n, save) {
  if (save) {
    (ui.camSpots || (ui.camSpots = {}))[n] = { x: camera.x, y: camera.y, zoom: camera.zoom, seed: state.seed };
    ui.flash = { text: `Camera spot ${n} saved. ${keyLabel(`cam.go${n}`, 1) || "Its key"} brings you back here.`, at: performance.now() };
    return;
  }
  const spot = ui.camSpots && ui.camSpots[n];
  if (!spot || spot.seed !== state.seed) { ui.flash = { text: `No camera spot ${n} yet: ${keyLabel(`cam.save${n}`) || "its key"} saves the current view.`, at: performance.now() }; return; }
  camera.x = spot.x; camera.y = spot.y; camera.zoom = spot.zoom;
}

// Map keys added with the alerts (README controls), matched through the key table (ui/keymap.js: Menu → Controls
// rebinds them). Returns true when the key was used. modal: what window is up (ui.js modalKind); only the diary,
// roster and codex keys work with a window open, and only over one of those three (they close it, or switch).
const KEY_WINDOWS = { "win.diary": "diary", "win.roster": "roster", "win.codex": "codex" };
const openWindow = (ui, w) => (w === "diary" ? openDiary(ui) : w === "roster" ? openRoster(ui) : openCodex(ui));
export function mapHotkey(state, ui, e, act, modal) {
  const k = keyAction(e, "map");
  if (modal) {
    const w = KEY_WINDOWS[k];
    if (!w || !Object.values(KEY_WINDOWS).includes(modal)) return false;
    ui[modal] = null;
    if (w !== modal) openWindow(ui, w);
    return true;
  }
  if (!ui.started) return false;
  ui.flash = null;
  let m = /^cam\.(save|go)([1-9])$/.exec(k || "");
  if (m) { camSpot(state, ui, m[2], m[1] === "save"); return true; } // (Alt saves as well: some browsers keep Ctrl+1–9 for their tabs)
  if ((m = /^base\.([1-9])$/.exec(k || ""))) {
    const b = state.bases[Number(m[1]) - 1];
    if (!b) { ui.flash = { text: `You have ${state.bases.length} base${state.bases.length === 1 ? "" : "s"}: ${keyLabel("base.1", 1)}–${keyLabel(`base.${Math.max(1, Math.min(9, state.bases.length))}`, 1)}.`, at: performance.now() }; return true; }
    act.center({ tile: b.tile });
    return true;
  }
  const tabs = { "tab.bases": "bases", "tab.people": "people", "tab.groups": "groups", "tab.teams": "teams" };
  if (tabs[k]) { ui.tab = tabs[k]; return true; }
  if (k === "dev.autopilot") { act["dev-autopilot"](); return true; }
  if (k === "team.next" || k === "team.prev") { nextWaitingTeam(state, ui, act, k === "team.prev"); return true; }
  if (k === "team.inventory") { // the selected team's inventory (ui/teaminv.js), as its panel's 🎒 Team inventory
    const p = selectedTeam(state, ui);
    const why = !p ? "Select a team first (click it on the map, or its row in the Teams tab)." : !isPlayerTeam(p) ? "Only your own teams' kit can be looked at." : !(contactable(p) || commandable(state, p)) ? "No radio contact with that team: its kit can be seen when it is back in touch." : "";
    if (why) ui.flash = { text: why, at: performance.now() };
    else act["ti-open"]({ id: p.id, tab: "team" });
    return true;
  }
  if (KEY_WINDOWS[k]) { openWindow(ui, KEY_WINDOWS[k]); return true; }
  return false;
}
