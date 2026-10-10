// A breakdown fixed on the road (events.js breakdownCard: "Repair it on the spot", 2 hours or 8 on a failed check;
// "Use a spare part", 1 hour) holds the team up as a delay (negative progress). This says when that wait is over: a
// log line and a news alert (ui/alerts.js repairAlerts: click it to open the team and centre on it), e.g.
//   "Scout team (Ana, Ben): the SUV is running again (condition 54%). Moving on to Elm Street."
// p.delayWhy = { kind: "repair", vehicleIds, left, at } marks the wait (other delays, which share delay(), carry no
// marker and tell nothing). left: the progress still to make up before the repair is done, the delays already owed
// when it was answered included (they are paid first); each hour the team moves pays off its pace (repairPaid). The
// news comes when left is paid off and the team is moving again (progress back to zero or more, or a tile entered: a
// later delay, a held hour for a waiting card, holds it until the team really drives on), from movePartiesHour after the team's hour
// (repairWaitHour). A second breakdown repaired during the wait joins the same marker (one alert for both). A team
// gone (wiped, merged, home) takes its marker with it: no news; vehicles no longer with the team are left out of it,
// and with none left there is none. Player teams only (the AI's teams have no alerts and never get a marker).
// Saved with the team (plain fields); an old save without a marker simply has nothing to tell.
import { log } from "./world.js";
import { partySpeed, teamName, onTheMove, tileLabel } from "./parties.js";
import { partyVehicles, isBike } from "./vehicles.js";

export const REPAIR_NEWS_HOURS = 24; // the alert stays up this long (or until clicked or dismissed)

// owed: the progress the repair costs (its hours × the pace), the team's progress before it was taken off.
/** @param {any} state @param {any} p @param {any} v @param {number} hours @param {number} before */
export function markRepair(state, p, v, hours, before) {
  if (!p || p.owner !== "player" || !v) return;
  const was = p.delayWhy && p.delayWhy.kind === "repair" ? p.delayWhy : null;
  const ids = was ? was.vehicleIds.filter((id) => id !== v.id) : [];
  // What is owed already (a repair still under way, other delays) is paid first.
  const owed = Math.max(0, -(before || 0), was ? was.left : 0);
  p.delayWhy = { kind: "repair", vehicleIds: [...ids, v.id], left: hours * partySpeed(p) + owed, at: state.hour };
}

// The team's hour of moving (parties.js playerPartyHour): its pace pays off the wait. entered: it entered a tile this
// hour (moving again even if a road blockage met on the way leaves it owing progress at the end of the hour).
/** @param {any} p @param {number} speed @param {boolean} [entered] */
export function repairPaid(p, speed, entered = false) {
  const w = p && p.delayWhy;
  if (!w || w.kind !== "repair") return;
  w.left -= speed;
  if (entered && w.left <= 1e-6) w.moved = true;
}

const BUSY = new Set(["engaged", "task", "helping"]); // a fight, work on the spot, helping: told once it is over

/** @param {any} state @param {any} p @returns {string | null} the news, if it came this hour */
export function repairWaitHour(state, p) {
  const w = p && p.delayWhy;
  if (!w || w.kind !== "repair" || !state.parties.includes(p)) return null;
  if (w.left > 1e-6 || ((p.progress || 0) < 0 && !w.moved) || BUSY.has(p.phase)) return null;
  delete p.delayWhy;
  const vs = partyVehicles(state, p).filter((v) => w.vehicleIds.includes(v.id) && !v.destroyed);
  if (!vs.length) return null; // left behind, wrecked or handed over during the wait
  const text = repairNews(state, p, vs);
  log(state, text, "good");
  p.repairNews = { hour: state.hour, text, vehicleIds: vs.map((v) => v.id) };
  return text;
}

const vName = (v) => (isBike(v) ? "the bike" : `the ${v.name}`);
/** @param {any} state @param {any} p @param {any[]} vs */
export function repairNews(state, p, vs) {
  const bikes = vs.every(isBike);
  const one = vs.length === 1;
  const names = one ? `${vName(vs[0])} ${bikes ? "is fixed" : "is running again"} (condition ${Math.round(vs[0].condition)}%)`
    : `${vs.slice(0, -1).map((v) => `${vName(v)} (${Math.round(v.condition)}%)`).join(", ")} and ${vName(vs[vs.length - 1])} (${Math.round(vs[vs.length - 1].condition)}%) ${bikes ? "are fixed" : "are running again"}`;
  const go = !onTheMove(p) ? "" : p.phase === "back" ? " Heading home." : ` Moving on to ${tileLabel(state, p.path[p.path.length - 1])}.`;
  return `${teamName(state, p)}: ${names}.${go}`;
}

// The news still worth an alert (ui/alerts.js): player teams told within REPAIR_NEWS_HOURS.
/** @param {any} state */
export function recentRepairs(state) {
  return (state.parties || []).filter((p) => p.owner === "player" && p.repairNews && state.hour - p.repairNews.hour < REPAIR_NEWS_HOURS);
}
