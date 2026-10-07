// A save's one-line summary and the campaign it belongs to (the save list in ui/settings.js, the rotating autosaves'
// names in ui/saves.js). Pure: read from the world, nothing changed.
//   "Day 143 · 31 people · winter · at war with Iron Jackals"
// Day, people alive, the season, then the one thing that matters most right now: the run's end (won / fallen), a war
// you joined (the enemy; "+1" for each more), a group hostile to you, or a Hardcore band still on the road.
import { day, alive, hub } from "./world.js";
import { season } from "./weather.js";

const MAX = 72; // characters: the line fits the save list on a narrow window

// The campaign a world belongs to: its own id (main.js gives every new run one as it begins), or, for a world from
// before that (an older save, a headless tool), its seed.
export const campaignKey = (state) => (state && state.campaign) || `seed-${state ? state.seed : "?"}`;
export const newCampaignId = () => `c${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;

export function saveSummary(state) {
  const n = alive(state).length;
  const parts = [`Day ${day(state)}`, `${n} ${n === 1 ? "person" : "people"}`, season(state).name.toLowerCase()];
  const why = standing(state);
  if (why) parts.push(why);
  const line = parts.join(" · ");
  return line.length > MAX ? `${line.slice(0, MAX - 1)}…` : line;
}

function standing(state) {
  if (state.gameOver) return state.victory ? "won" : "fallen";
  const name = (id) => { const f = (state.factions || []).find((x) => x.id === id); return f && f.known ? f.name : "a group"; };
  const more = (list) => (list.length > 1 ? ` (+${list.length - 1})` : "");
  // Wars you joined (diplomacy.js joinWar: w.playerSide is your side; the other side is your enemy).
  const foes = ((state.diplo && state.diplo.wars) || []).filter((w) => w.playerSide != null).map((w) => (w.a === w.playerSide ? w.b : w.a));
  if (foes.length) return `at war with ${name(foes[0])}${more(foes)}`;
  // Groups hostile to you (factions.js attitude: goodwill −40 or below), the most hostile first.
  const hostile = (state.factions || []).filter((f) => f.known && f.alive !== false && f.goodwill <= -40).sort((a, b) => a.goodwill - b.goodwill);
  if (hostile.length) return `${hostile[0].name} hostile${more(hostile)}`;
  if (state.mode === "hardcore" && !hub(state)) return "on the road";
  return "";
}
