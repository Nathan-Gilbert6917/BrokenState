// The Display and confirmation options as they are stored (ui/saves.js loadOptions reads them through here; ui/display.js
// applies them, ui/confirm.js keeps noAsk). No imports and no DOM: the headless tools load it with saves.js.
//   cbPalette    colour-blind-safe colours (ui/palette.js)       bigText   larger text on the map canvas
//   calm         reduce motion (no map animations, glides, pulsing badges or sliding cards)
//   minimap      the minimap in the map's corner (M), minimapSize s / m / l
//   devTools     the Dev button in the top bar and the ` key (ui.dev; off for players)
//   mapAnim      the map's animations (Display → Map animations; ui/render.js)
//   noAsk        { kind: true } for the questions with "Don't ask again" ticked (ui/confirm.js)
//   battleMarks  full / low / off: blood, brass, scorch and glass left on a battle's ground (ui/battlemarks.js)
//   battleEdge   full / low / off: the ground running past a battle map's edges into the fog (ui/battleedge.js)
//   nightShade   the State Map's night: off / light / dark (ui/nightfx.js)
//   edgeWarn     red pulses at the screen's edge for an attack off screen (ui/edgefx.js), heartbeat: a soft heartbeat
//                in the ambience while a base of yours is under attack (off by default)
export const NIGHT_SHADES = ["off", "light", "dark"];
export const MINIMAP_SIZES = { s: { label: "Small", rem: 11 }, m: { label: "Medium", rem: 15 }, l: { label: "Large", rem: 21 } };
export const DISPLAY_DEFAULTS = { cbPalette: false, bigText: false, calm: false, minimap: true, minimapSize: "m", devTools: false, battleMarks: "full", battleEdge: "full", nightShade: "dark", edgeWarn: true, heartbeat: false };
export const BATTLE_LOOK_LEVELS = { full: "Full", low: "Light", off: "Off" }; // battleMarks, battleEdge
const BOOLS = ["cbPalette", "bigText", "calm", "minimap", "devTools", "mapAnim", "edgeWarn", "heartbeat"];

// o: the options being built; v: what was stored (or nothing). Fills the defaults, then takes the stored values that
// make sense.
export function readDisplayOptions(o, v = null) {
  for (const [k, d] of Object.entries(DISPLAY_DEFAULTS)) if (!(k in o)) o[k] = d;
  if (!o.noAsk || typeof o.noAsk !== "object") o.noAsk = {};
  if (!v || typeof v !== "object") return o;
  for (const k of BOOLS) if (typeof v[k] === "boolean") o[k] = v[k];
  if (MINIMAP_SIZES[v.minimapSize]) o.minimapSize = v.minimapSize;
  for (const k of ["battleMarks", "battleEdge"]) if (Object.hasOwn(BATTLE_LOOK_LEVELS, v[k])) o[k] = v[k];
  if (NIGHT_SHADES.includes(v.nightShade)) o.nightShade = v.nightShade;
  if (v.noAsk && typeof v.noAsk === "object") {
    o.noAsk = {};
    for (const [k, on] of Object.entries(v.noAsk)) if (on === true && /^[a-z][a-z-]{0,30}$/.test(k)) o.noAsk[k] = true;
  }
  return o;
}
