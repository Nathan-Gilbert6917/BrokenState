// The colours that carry meaning (good / bad, friend / foe, the overlays) in one table, so Menu → Options → Display
// can swap them for a colour-blind-safe set (ui/display.js). Red against green is the pair most people with colour
// blindness cannot tell apart, so the safe set swaps green for sky blue and red for orange (the Okabe–Ito colours),
// and the map's red overlays (infection, hive land) for purple. The HTML uses the CSS variables in styles.css
// (--good, --danger, --warn…; `:root.cb` redefines them); canvas code reads PAL at draw time. No DOM here: the
// headless tools import it.
const NORMAL = {
  good: "#6cc48a", goodRgb: "108,196,138", // green: safe, healthy, a good chance, your extraction zone
  bad: "#e2685f", badRgb: "226,104,95",    // red: danger, wounds, a poor chance, a threat line
  mid: "#e0a84f",                          // amber: in between (a fair chance, half health)
  task: "#9be39b",                         // a team of yours at work (its ring on the map; waiting is yellow)
  infRgb: "220,40,40",                     // the Infection layer
  hiveRgb: "150,20,30", ringRgb: "200,25,25", ringEdgeRgb: "255,70,60", // a known hive's land and the ring round it
  foe: "#ff8a7f",                          // hordes (the minimap's dots, the ring under a horde)
};
const SAFE = {
  good: "#56b4e9", goodRgb: "86,180,233",
  bad: "#e69f00", badRgb: "230,159,0",
  mid: "#f0e442",
  task: "#cc79a7",
  infRgb: "190,60,220",
  hiveRgb: "110,30,150", ringRgb: "150,40,200", ringEdgeRgb: "205,120,255",
  foe: "#f5a623",
};
export const PAL = { ...NORMAL, safe: false };
// Three steps from good to bad (a hit chance, health): f at or above hi is good, at or above lo in between.
export const tier3 = (f, hi, lo) => (f >= hi ? PAL.good : f >= lo ? PAL.mid : PAL.bad);

// on: the colour-blind-safe set. Returns true when it changed (the map's cached chunks must be drawn again).
export function setPalette(on) {
  on = !!on;
  if (PAL.safe === on) return false;
  Object.assign(PAL, on ? SAFE : NORMAL, { safe: on });
  return true;
}
