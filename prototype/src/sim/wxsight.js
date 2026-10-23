// The weather in a battle (the user's request 2026-10-23: "Add rain and fog effect during raid … when it is foggy or
// raining in the world map that is when it is foggy or raining in a raid. Fog reduces visibility on the world map
// too"): the battle's weather is the State Map's over the battle's tile (weather.js weatherAt, as the battle is made:
// no dice, the same seed the same weather), kept as b.wx. Fog and a blizzard cut how far everyone sees by WX_SIGHT
// tiles off their day's sight (u.daySight; the night's caps come on top of it as before: stealth.js senses,
// ailights.js, vision.js), never below WX_SIGHT_MIN. Every unit on every side alike (docs/adr/0001-ai-parity.md): your
// people, the enemy's, the third side, volunteers and the dead. Under the ground (a hive's caves) there is no weather.
// The rain, the fog and the snow drawn over the battle view are ui/battlewx.js's (drawing only).
// Hooks: stealth.js stealthSetup (wxSightSetup, as the battle is made) and stealthTurn (fogEyes for anyone who came
// onto the map since: reinforcements, the dead walking in, a Carrier's risen).
import { weatherAt } from "./weather.js";

export const WX_SIGHT = { fog: 4, blizzard: 3 }; // tiles off the day's sight (13 for a person, 9 for the dead)
export const WX_SIGHT_MIN = 4; // nobody's day sight is cut below this
const UNDERGROUND = new Set(["hivechamber", "hivecore"]); // stealth.js: a hive's caves, their own dark
const NAMES = { fog: "Fog", blizzard: "Blizzard" };

// The world tile whose weather a battle has: its own (b.tileId), or a base's map's base's tile (the base map view and
// a base's wall map are made with no tile of their own: sim/basemap.js openBaseMap). null: none (the tools' bare
// battles).
export function battleTile(state, b) {
  if (!b) return null;
  if (b.tileId != null) return b.tileId;
  const id = b.setup ? b.setup.baseId ?? (b.setup.context ? b.setup.context.baseId : null) : null;
  const base = id != null && state && Array.isArray(state.bases) ? state.bases.find((x) => x.id === id) : null;
  return base ? base.tile : null;
}
// The weather key over the battle's tile now ("clear" with no world or no tile: the tools' bare battles).
export function battleWxKey(state, b) {
  const tile = battleTile(state, b);
  if (!state || !state.tiles || tile == null) return "clear";
  if (b.setup && UNDERGROUND.has(b.setup.layout)) return "clear";
  try { return weatherAt(state, tile).key || "clear"; } catch { return "clear"; }
}
// The battle's weather and its cut to sight, once as the battle is made (b.wx, b.wxSight), and the cut put on every
// unit on the map. Returns the cut (0: none).
export function wxSightSetup(state, b) {
  if (b.wx == null) {
    b.wx = battleWxKey(state, b);
    b.wxSight = WX_SIGHT[b.wx] || 0;
  }
  if (b.wxSight) for (const u of b.units) fogEyes(b, u);
  return b.wxSight || 0;
}
// One unit's day sight cut by the battle's fog (once: u.fogCut keeps what was taken off). Its sight now is capped by
// the new day sight (at night the dark's cap is lower still and stays).
export function fogEyes(b, u) {
  if (!b.wxSight || u.fogCut != null || u.sight == null) return;
  if (u.daySight == null) u.daySight = u.sight;
  const day = Math.max(Math.min(u.daySight, WX_SIGHT_MIN), u.daySight - b.wxSight);
  u.fogCut = u.daySight - day;
  u.daySight = day;
  u.sight = Math.min(u.sight, day);
}
// "Fog: sight −4" (the battle log, a unit's hover line), or "".
export const wxSightWord = (b) => (b && b.wxSight ? `${b.wxFog || NAMES[b.wx] || "Weather"}: sight −${b.wxSight}` : ""); // wxFog: rain fog (seasonfx.js)
