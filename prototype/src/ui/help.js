// Help (the menu's Help tab, ui/settings.js): one topic at a time, picked from a list on the left. The topics are
// the paragraphs of the game's help text (ui/ui.js helpText, one per bold title) plus the map's layers and legend,
// which used to be spelled out in the Layers popup on the map. Small "?" buttons around the UI (data-action
// "help-open" data-sec="<topic id>") open the menu at a topic. Windows and panels (folding, resizing, map only)
// comes from ui/layout.js.
import { LAYERS } from "../sim/markers.js";
import { helpText } from "./ui.js";
import { windowsHelp } from "./layout.js";
import { HIVE_BIRTH_HELP } from "../sim/hivebirth.js";
import { FESTIVAL_HELP } from "../sim/festival.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "topic";

// The little color chip next to a layer (the Layers popup and the help): a CSS background, or a glyph.
export const LAYER_SWATCH = {
  pois: { bg: "linear-gradient(90deg,#e2826f 0 25%,#e2b85c 25% 50%,#9cc46e 50% 75%,#b79be6 75%)" },
  territory: { bg: "rgba(110,160,230,0.6)" },
  teams: { glyph: "!", bg: "#ffd166" },
  hordes: { bg: "#8f2a2a" },
  deaths: { glyph: "✝", bg: "#c8ccd2" },
  vehicles: { bg: "#c9a227" },
  finds: { glyph: "◆", bg: "#c8ccd2" },
  infection: { bg: "rgba(210,40,40,0.75)" },
  weather: { bg: "linear-gradient(135deg,#e8f1ff,#7d9cc0)" },
  known: { bg: "repeating-linear-gradient(135deg,rgba(165,240,230,0.85) 0 2px,rgba(30,60,58,0.9) 2px 5px)" },
  coalition: { bg: "linear-gradient(90deg,rgba(79,143,214,0.55) 0 50%,rgba(150,200,110,0.55) 50%)", border: "#f3d27a" },
};
export function swatch(k) {
  const s = LAYER_SWATCH[k];
  if (!s) return `<i class="sw none"></i>`;
  return `<i class="sw" style="background:${s.bg}${s.border ? `;box-shadow:inset 0 0 0 1.5px ${s.border}` : ""}">${s.glyph || ""}</i>`;
}

// What each layer shows, in full (the popup keeps one short line per layer). A layer added later without an entry
// here shows its own description from sim/markers.js.
const LAYER_HELP = {
  pois: "Towns and sites with their names. A site is a building for its type on a plate colored by its zone; the more faded, the less loot was left when you last saw it. Skulls under a name show its danger when zoomed in; small sites become dots when zoomed out. The ruins of a razed base (yours or a group's) stand in its place, named \"Ruins of …\".",
  territory: "Land held by you and by the groups you know, tinted in their color. Their bases are compounds in that color. Tiles your teams claimed (Claim this tile) are a lighter blue; hover one for Claimed by you (day N) and its well.",
  teams: "Your teams (! waiting for orders, ? an estimated position out of radio contact), plus the raiders, convoys, caravans and scavengers of other groups you can see. Their parties look like the group: bikers, humvees, robed zealots, caravans; scavengers carry a stuffed sack.",
  hordes: "Hordes you see now (size on the badge), faded \"N?\" badges where one was last seen, known hives with their dark-red land and red-skull ring, and hives being built.",
  deaths: "Graves where your people died, with what was left on them.",
  vehicles: "Vehicles you left behind: a red can needs fuel, smoke means damaged.",
  finds: "Caches, wrecked cars and abandoned camps your teams spotted, with how long ago.",
  infection: "A red wash over the land: the redder, the more infected. Hives radiate it; it fades once the hive is gone. Also the I key.",
  weather: "Today's weather as a wash over the land: snow, rain, fog and heat.",
  known: "Teal hatching where your people looked hard for hidden places and finds: the spots a Survey covered hour by hour, what a Look around took in, the sites they searched. Brighter (with a faint teal wash) for the last 30 days, fainter before; a thin teal line runs round the searched ground. Unhatched land is where nobody has looked yet: survey there. A team's looks reach the map with its report (radio contact or home). The tile panel says on which day a tile was searched. Off by default.",
  coalition: "The land the coalition controls (you and its members: the land the alliance victory counts), each tile in the color of the nearest base's owner: blue for you, a member's color for its land, with a border in that color where another owner's land begins, and a thin gold line round the coalition's land as a whole (rivers and lakes inside it do not count as land). The layer's line shows the share held against the goal: more than 50% (with every group still standing in the coalition) wins. Other groups' land is on the Territory layer. Off by default.",
};

// The symbols on the map (formerly the text under the layer list).
const ZONE = (c, t) => `<span style="color:${c}">${t}</span>`;
const LEGEND = [
  [`<i class="sw" style="background:#4d8fd6"></i>`, "Your bases", "Blue walled town = your hub; blue cabin = an outpost. Walls and buildings show on them."],
  [`<i class="sw" style="background:rgba(110,160,230,0.6)"></i>`, "Other groups", "Compounds in a group's color are its bases. Its convoys and raids look like the group (bikers, humvees, robed zealots, caravans…); its scavengers carry a stuffed sack. A group's wagon or truck beside your base is its caravan."],
  [swatch("pois"), "Sites", `A building per type on a plate colored by zone: ${ZONE("#e2826f", "city")}, ${ZONE("#e2b85c", "town")}, ${ZONE("#9cc46e", "countryside")}, ${ZONE("#b79be6", "landmark")}. The more faded, the less loot as you last saw it (rich, some, little, picked clean). Small sites are dots when zoomed out.`],
  [`<i class="sw" style="background:#c8ccd2">☠</i>`, "Danger", "Skulls under a site's name, shown up close."],
  [`<i class="sw" style="background:#8f2a2a"></i>`, "Hordes", "A crowd of the dead, its size on the badge; a faded \"N?\" is where one was last seen. A grey brute with a concrete fist at its head is a Wallbreaker."],
  [`<i class="sw" style="background:#c0392b"></i>`, "Hives", "A red glowing mound. Its land is tinted dark red (sites there show at least 3 skulls); the ring around it is brighter, with red skulls: much tougher dead."],
  [`<i class="sw" style="background:#6b4a3a"></i>`, "Hive being built", "A raw mound with bones and a red bar: the dead gathered, of 1,000. It grows with the dead massed there; the line under it says how many days until the hive stands, as far as you know (a \"?\" when your last look is old). A dashed red ring: a gathering you marked."],
  [`<i class="sw" style="background:#4a3f36;box-shadow:inset 0 0 0 1.5px #a0603a"></i>`, "Ruins", "Charred wall stubs, a lone chimney and rubble on a smouldering rim: a base burned to the ground in a raid, named \"Ruins of …\" (a torn blue rag: it was yours). The tile panel shows who burned it, the salvage left, the danger and the 5 scrap a new outpost there needs; founding one replaces the ruins."],
  [swatch("known"), "Known area", "Teal hatching (Known area layer): ground your people searched, brighter for the last 30 days, with a thin teal line round it. Unhatched ground has not been looked over for hidden places."],
  [swatch("coalition"), "Coalition land", "A wash in each owner's color with a border where another owner's land begins (Coalition land layer), and a thin gold line round all of the coalition's land; the layer's line shows the share held against the 50% goal."],
  [`<i class="sw" style="background:#7a3a3a"></i>`, "Hive growths", "Small structures of flesh and bone beside a hive: a bubbling pit, amber egg sacs, a field of bones, a warren with red eyes, a grey brute in a pit, green acid bladders, a shrieking tower, a burrow with grasping hands, an arch of ribs (the Wallbreaker den), a glowing magenta vat. Faint while growing, grey once their hive is gone. Burn the growth to take it away from the hive."],
  [`<i class="sw" style="background:#c8ccd2">✝</i>`, "Markers", "On a ring: a grave = death site, your vehicle (red can = needs fuel, smoke = damaged), a wreck, a cache, a camp. Dots when zoomed out."],
  [`<i class="sw" style="background:#c8ccd2">▲</i>`, "Siege", "Tents and a banner by a base."],
  [`<i class="sw ring"></i>`, "Radio coverage", "Dashed circles: a station reaches 12 tiles (24 with a Military encrypted radio in the base's armory), a linked relay 6. Red = a relay not linked or off the air. Dotted circles in a group's colour: that group's radio network, drawn while one of your teams or bases is tuned to it (Listen in on radio traffic)."],
  [`<i class="sw" style="background:#ffd166">!</i>`, "Waiting", "A team waiting for orders."],
  [`<i class="sw" style="background:#c8ccd2">?</i>`, "Estimated", "A team's estimated position (out of radio contact)."],
  [`<i class="sw" style="background:linear-gradient(90deg,#d8dee8 0 33%,#7b8494 33% 66%,#1b1e23 66%)"></i>`, "Bright, dim, dark", "Bright tiles are live (around your bases, near a team in radio range); dim tiles show the last report with its age; dark tiles have no intel."],
];

function layersTopic() {
  const rows = Object.entries(LAYERS).map(([k, l]) => `<tr><td>${swatch(k)}</td><td><b>${esc(l.name)}</b></td><td>${esc(LAYER_HELP[k] || l.desc)}</td></tr>`).join("");
  return `Tick a layer in the map's <b>Layers</b> box to show it (▾ folds the box away). <table class="helptable">${rows}</table>`;
}
function legendTopic() {
  return `What the things drawn on the map mean. <table class="helptable">${LEGEND.map(([sw, name, text]) => `<tr><td>${sw}</td><td><b>${esc(name)}</b></td><td>${text}</td></tr>`).join("")}</table>`;
}

// The topics in order: the game's help paragraphs, with the map layers and legend right after "Map".
export function helpTopics() {
  const out = [];
  const seen = new Set();
  const add = (title, html) => {
    let id = slug(title);
    while (seen.has(id)) id += "-2";
    seen.add(id);
    out.push({ id, title, html });
  };
  for (const raw of helpText().split(/<br>\s*(?:<br>\s*)?/)) {
    const chunk = raw.trim();
    if (!chunk) continue;
    // "<b>Title:</b> text" → the title alone; "<b>Dev tools</b> (…): text" keeps its bold title in the text.
    const m = /^<b>([^<]+?)(:?)<\/b>(:?)\s*/.exec(chunk);
    const title = m ? m[1].trim().replace(/:$/, "") : "More";
    add(title, m && (m[2] || m[3]) ? chunk.slice(m[0].length).replace(/^[a-z]/, (c) => c.toUpperCase()) : chunk);
    if (out[out.length - 1].id === "map") { add("Map layers", layersTopic()); add("Map legend", legendTopic()); }
    if (out[out.length - 1].id === "keys-on-the-map") add("Windows and panels", windowsHelp()); // ui/layout.js
    if (out[out.length - 1].id === "hives-and-hordes") add("Hives being born", HIVE_BIRTH_HELP); // sim/hivebirth.js
    if (out[out.length - 1].id === "food-and-the-winter") add("The harvest festival", FESTIVAL_HELP); // sim/festival.js
  }
  if (!seen.has("map-layers")) { add("Map layers", layersTopic()); add("Map legend", legendTopic()); }
  if (!seen.has("windows-and-panels")) add("Windows and panels", windowsHelp());
  if (!seen.has("hives-being-born")) add("Hives being born", HIVE_BIRTH_HELP);
  if (!seen.has("the-harvest-festival")) add("The harvest festival", FESTIVAL_HELP);
  return out;
}

// The Help tab: the topic list and the topic picked (sec: a topic id; an unknown one shows the first).
export function helpTab(sec) {
  const topics = helpTopics();
  const i = Math.max(0, topics.findIndex((t) => t.id === sec));
  const cur = topics[i];
  const step = (j, label) => (topics[j] ? `<button data-action="set-help" data-sec="${topics[j].id}">${label}</button>` : "<span></span>");
  return `<div class="helpwrap">
    <div class="helpnav">${topics.map((t, j) => `<button data-action="set-help" data-sec="${t.id}" class="${j === i ? "active" : ""}">${esc(t.title)}</button>`).join("")}</div>
    <div class="helpbody"><h2>${esc(cur.title)}</h2><div class="text">${cur.html}</div>
      <div class="spread">${step(i - 1, `◂ ${topics[i - 1] ? esc(topics[i - 1].title) : ""}`)}${step(i + 1, `${topics[i + 1] ? esc(topics[i + 1].title) : ""} ▸`)}</div></div>
  </div>`;
}
