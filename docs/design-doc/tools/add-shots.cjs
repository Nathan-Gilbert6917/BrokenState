// One-off: point the map-layer screenshots at their JPEG copies and add the tile-design finals to the manifest.
const fs = require("fs");
const path = require("path");
const file = path.resolve(__dirname, "..", "sprites", "manifest.json");
const m = JSON.parse(fs.readFileSync(file, "utf8"));
for (const e of m) if (e.category === "shot" && e.file.endsWith(".png")) e.file = e.file.replace(/\.png$/, ".jpg");
const ADD = {
  "final-normal-close": "Map detail at close zoom (Normal world): style B decals with style A water",
  "final-normal-mid": "Map detail at mid zoom (Normal world)",
  "final-normal-far": "Map detail at far zoom (Normal world)",
  "final-normal-fade": "Decals fading out as the camera zooms away",
  "final-huge-far": "A Huge world at far zoom",
  "final-huge-city-close": "City hexes up close on a Huge world",
  "final-winter-city-close": "The same city in winter, decals snow-capped",
  "comparison-sheet": "The four tile styles compared (A pixel, B decals, C painterly, D tactical); B with A's water was chosen",
};
for (const [key, label] of Object.entries(ADD)) {
  if (m.some((e) => e.id === `shot/${key}`)) continue;
  m.push({ id: `shot/${key}`, category: "shot", key, label, file: `sprites/shot/${key}.jpg`, source: `docs/tile-designs/${key}.png` });
}
fs.writeFileSync(file, JSON.stringify(m, null, 1));
console.log(m.length, "entries");
