// Help (the menu's Help tab, ui/settings.js): one topic at a time, picked from a list on the left. "Start here" comes
// first (the game in plain words, with links to the deeper topics; the first-week guide, ui/guide.js, points at it). The rest are
// the paragraphs of the game's help text (ui/ui.js helpText, one per bold title) plus the map's layers and legend,
// which used to be spelled out in the Layers popup on the map. Small "?" buttons around the UI (data-action
// "help-open" data-sec="<topic id>") open the menu at a topic. Windows and panels (folding, resizing, map only)
// comes from ui/layout.js.
import { LAYERS } from "../sim/markers.js";
import { helpText } from "./ui.js";
import { windowsHelp } from "./layout.js";
import { HIVE_BIRTH_HELP } from "../sim/hivebirth.js";
import { HIVE_CRAWL_HELP } from "../sim/hivecrawl.js"; // the hive crawl: from the mouth to the Hivemind
import { FESTIVAL_HELP } from "../sim/festival.js";
import { keysSheet } from "./controls.js"; // Help → Keys: the printable key sheet (the keys as they are set now)
import { keyLabel } from "./keymap.js";
import { tripsHelp } from "./trips.js"; // templates, Repeat trip and undo
import { soundHelp } from "./audio.js";
import { ledgerHelp } from "./ledger.js"; // the Ledger and the run summary
import { ERAS } from "../sim/eras.js"; // the year the victories open (Winning and losing)
import { familyHelp } from "./family.js"; // children and families (sim/family.js)
import { FAMILY } from "../sim/family.js";
import { savesHelpHtml } from "./savelist.js"; // autosaves, the save list and the error screen
import { WATCHLIST_HELP } from "./watchlist.js"; // the Watching panel and map notes
import { BULK_HELP } from "./rosterbulk.js"; // the roster's bulk actions
import { pacingHelp } from "./pacing.js";
import { displayHelp } from "./display.js"; // Minimap, Readability, Confirmations
import { GUNMODS_HELP } from "../sim/gunmods.js"; // sights, suppressors, magazines on guns
import { KIT_HELP } from "../sim/carrykit.js"; // magazines as items, rigs, plate carriers, weight in a fight
import { ROSTER_HELP } from "../sim/data-guns.js"; // the guns and melee weapons (the weapons overhaul)
import { MEDICS_HELP } from "../sim/medics.js"; // medics, the downed, dragging, finishing
import { TRAINING_HELP } from "../sim/training.js"; // the hospital trains medics
import { NL_HELP } from "../sim/nonlethal.js"; // tasers, pepper spray, pulled blows, surrender
import { CARAVAN_HELP } from "../sim/caravanraids.js"; // caravans on the road: escorts, robbing them, witnesses
import { RESCUE_HELP } from "../sim/rescueraid.js"; // getting captives back: the rescue raid, ransoms
import { BLOCS_WARS_HELP } from "../sim/playerwars.js"; // blocs between groups, wars with you

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
  fronts: { bg: "radial-gradient(circle,#3a4a78 0 45%,rgba(120,140,190,0.5) 70%,transparent 72%)" },
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
  weather: "The season and the statewide sky as a wash over the land (snow cover, rain, heat), with faint drifting clouds where weather fronts pass: dark for thunderstorms and rain belts, white for blizzards and snow squalls, grey for fog banks. A front's weather is only under it.",
  fronts: "The weather fronts drawn strongly: each one's edge (dashed: inside it, its weather), its name and an arrow to where it will be in 6 hours. Fronts come in from the map's edges (mostly the west) and cross it in hours to a couple of days; fog forms where it lies before dawn and burns off by midday. Hover a tile for the front over it. Off by default (Shift+W toggles it).",
  known: "Teal hatching where your people looked hard for hidden places and finds: the spots a Survey covered hour by hour, what a Look around took in, the sites they searched. Brighter (with a faint teal wash) for the last 30 days, fainter before; a thin teal line runs round the searched ground. Unhatched land is where nobody has looked yet: survey there. A team's looks reach the map with its report (radio contact or home). The tile panel says on which day a tile was searched. Off by default.",
  coalition: "The land the coalition controls (you and the members whose land counts: a year in the coalition and not at war; the land the alliance victory counts), each tile in the color of the nearest base's owner: blue for you, a member's color for its land, with a border in that color where another owner's land begins, and a thin gold line round the coalition's land as a whole (rivers and lakes inside it do not count as land). The layer's line shows the share held against the goal: more than 50% (with every group still standing in the coalition) wins. Other groups' land is on the Territory layer. Off by default.",
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
  [`<i class="sw" style="background:transparent;box-shadow:inset 0 0 0 2px #ffd166"></i>`, "Blocs", "A dashed ring in a bloc's colour round a group's base: it belongs to that bloc (Groups tab: Blocs and wars; Help: Blocs and wars)."],
  [`<i class="sw" style="background:#c8ccd2">✝</i>`, "Markers", "On a ring: a grave = death site, your vehicle (red can = needs fuel, smoke = damaged), a wreck, a cache, a camp. Dots when zoomed out."],
  [`<i class="sw" style="background:#c8ccd2">▲</i>`, "Siege", "Tents and a banner by a base."],
  [`<i class="sw ring"></i>`, "Radio coverage", "Dashed circles: a station reaches 12 tiles (24 with a Military encrypted radio in the base's armory), a linked relay 6 (a relay goes up at any base without a station, and chains coverage outward; groups whose base lies within coverage + 6 can be called and invited into the coalition). Red = a relay not linked or off the air. Dotted circles in a group's colour: that group's radio network, drawn while one of your teams or bases is tuned to it (Listen in on radio traffic)."],
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

// The codex (ui/codex.js) and the search box (ui/cmdpalette.js).
function codexHelp() {
  const k = (id, d) => `<b>${esc(keyLabel(id) || d)}</b>`;
  return `<b>Codex</b> (${k("win.codex", "C")}, or 📚 Codex in the top bar): every kind of the dead, every item, building, illness and injury, and the groups and outsiders you can meet, with the numbers from the game's own tables and a line on how to deal with each. An entry opens the first time your people meet the thing: a kind of the dead in a battle or in a horde you can see, an item once someone holds it or it is in a base's armory, a building once one is built or queued at one of your bases, an illness once someone has it (the worm once it has been spotted), a group once you know it. Until then it shows as <i>???</i> with its category. New entries are marked until you look at them; the search box at the top finds any opened entry by name.<br><br>
    <b>Search</b> (${k("win.palette", "Ctrl+K")}): a box in the middle of the screen that finds anything by a few letters of its name: your people (opens their screen), bases and outposts (centers the map and opens the base), teams (their panel), the other groups (their radio panel, or the map at their base), sites and towns you know, the buildings you can build at the selected base (its Construction tab), the menu (save, load, options, controls), the diary, roster and codex, the Help topics and the codex entries you have opened. ↑ ↓ pick, Enter goes, Esc closes. With nothing typed it lists what you picked last.`;
}

// "Start here" (first in the list, and what Help opens on): the game in plain words, with links to the deeper topics.
const see = (...ids) => ` <span class="muted">More:</span> ${ids.map(([id, t]) => `<a class="link" data-action="set-help" data-sec="${id}">${t}</a>`).join(", ")}.`;
function startHereTopic() {
  return `Broken State in a few lines. The <b>First-week guide</b> under the alerts on the right walks you through the first days (⚙ Menu → Game shows it again).<br><br>
    <b>Your people.</b> A handful of survivors in the State of Calder, years after the dead rose (in Hardcore, on the day it falls, with no home yet). Keep them fed, watered, healthy and in good spirits: everything else follows from that.${see(["goal", "Goal"], ["hardcore-mode", "Hardcore mode"])}<br><br>
    <b>Bases.</b> Your hub is home. The people there farm, build, guard, craft and treat the sick, by the job you give them or by work priorities. <i>Manage</i> on the Bases tab opens its screen: stock, Work, Farming, Construction and the rest. Food and water days are always in the top bar. Outposts come later.${see(["bases-manage", "Bases (Manage)"], ["food-and-the-winter", "Food and the winter"], ["water-and-the-summer", "Water and the summer"])}<br><br>
    <b>Teams.</b> Everything beyond the walls is done by teams. Click a site on the map, pick a mission (scavenge, recon, trade…), choose who goes and what they carry, and launch. They walk there, search, fight if they must and bring home what they found. Out of radio range they report when they get back.${see(["sending-a-team", "Sending a team"], ["team-panel", "Team panel"], ["raids-scavenging-a-site", "Raids"])}<br><br>
    <b>The State Map.</b> Bright land is what your people see now, dim land your last report of it, dark land unknown. Hordes of the dead roam it, hives breed them, and other groups hold towns of their own: trade with them, ally or fight.${see(["map", "Map"], ["map-legend", "Map legend"], ["groups", "Groups"])}<br><br>
    <b>Cards and alerts.</b> When something happens (a team meets strangers, a fight starts, someone falls ill) a card asks what to do. The big ones (a fight, a raid, a death, a team waiting for orders) stop the clock; the rest wait in the card tray at the top of the map while the clock runs, and take their safest answer if left for 8 hours (⚙ Menu → Options → Pause for… sets which stop it). The alerts on the right list what needs you now; click one to go there.${see(["time", "Time"], ["pause-rules-and-the-card-tray", "Pause rules and the card tray"], ["alerts", "Alerts"])}<br><br>
    <b>The clock.</b> A new game starts paused: look around and give your first orders, then press Space. 1–5 set the speed (5× for quiet stretches; it drops back to 1× when something happens); windows and the cards that stop the clock hold it while they are open.<br><br>
    <b>Winning and losing.</b> You win by destroying every hive, or by building a coalition with other groups that holds more than half the land for a year (a member's land counts after a year in the coalition, and not while it is at war); neither comes before year ${ERAS.WIN_FROM_YEAR}. You lose when the last of your people is dead or gone.${see(["eras-and-winning", "Eras and winning"], ["hives-and-hordes", "Hives and hordes"])}`;
}

// "Why?" on deaths and lost bases (sim/causes.js, ui/causes.js).
const WHY_HELP = `When someone dies or a base is lost, a <b>Why?</b> link sits on its line in the log and the diary, on the memorial wall, on the survivor screen of the dead and on the lost-base card. It opens a short chain of causes written down at the moment it happened: the immediate cause, then up to four things that led to it, drawn from the base, the team and the diary (a well that broke and the scrap that was missing to fix it, a trip that ran overdue, the walls and who was on guard, when a group turned hostile and why). Click a day to open the diary there, or a name or a place to go to it. Deaths from before this was added are pieced together from the diary.`;

// The topics in order: Start here, then the game's help paragraphs, with the map layers and legend right after "Map".
export function helpTopics() {
  const out = [];
  const seen = new Set();
  const add = (title, html) => {
    let id = slug(title);
    while (seen.has(id)) id += "-2";
    seen.add(id);
    out.push({ id, title, html });
  };
  add("Start here", startHereTopic());
  for (const raw of helpText().split(/<br>\s*(?:<br>\s*)?/)) {
    const chunk = raw.trim();
    if (!chunk) continue;
    // "<b>Title:</b> text" → the title alone; "<b>Dev tools</b> (…): text" keeps its bold title in the text.
    const m = /^<b>([^<]+?)(:?)<\/b>(:?)\s*/.exec(chunk);
    const title = m ? m[1].trim().replace(/:$/, "") : "More";
    add(title, m && (m[2] || m[3]) ? chunk.slice(m[0].length).replace(/^[a-z]/, (c) => c.toUpperCase()) : chunk);
    if (out[out.length - 1].id === "map") { add("Map layers", layersTopic()); add("Map legend", legendTopic()); }
    if (out[out.length - 1].id === "keys-on-the-map") add("Windows and panels", windowsHelp()); // ui/layout.js
    if (out[out.length - 1].id === "hives-and-hordes") { add("The hive crawl", HIVE_CRAWL_HELP); add("Hives being born", HIVE_BIRTH_HELP); } // sim/hivecrawl.js, sim/hivebirth.js
    if (out[out.length - 1].id === "food-and-the-winter") add("The harvest festival", FESTIVAL_HELP); // sim/festival.js
    if (out[out.length - 1].id === "sending-a-team") add("Templates, Repeat trip and Undo", tripsHelp()); // ui/trips.js
    if (out[out.length - 1].id === "alerts") add("Why did this happen?", WHY_HELP); // ui/causes.js
    if (out[out.length - 1].id === "saving") add("Autosaves and crashes", savesHelpHtml()); // ui/savelist.js
    if (out[out.length - 1].id === "time") add("Pause rules and the card tray", pacingHelp()); // ui/pacing.js
    if (out[out.length - 1].id === "inventory") add("Gun attachments", GUNMODS_HELP); // sim/gunmods.js
    if (out[out.length - 1].id === "gun-attachments") add("Guns and melee weapons", ROSTER_HELP); // sim/data-guns.js
    if (out[out.length - 1].id === "battles") add("Medics and the downed", MEDICS_HELP); // sim/medics.js
    if (out[out.length - 1].id === "medical") add("Training medics", TRAINING_HELP); // sim/training.js
    if (out[out.length - 1].id === "groups") { add("Caravans on the road", CARAVAN_HELP); add("Getting captives back", RESCUE_HELP); add("Blocs and wars", BLOCS_WARS_HELP); } // sim/caravanraids.js; sim/rescueraid.js, ransom.js; sim/blocs.js, playerwars.js
  }
  if (!seen.has("map-layers")) { add("Map layers", layersTopic()); add("Map legend", legendTopic()); }
  if (!seen.has("windows-and-panels")) add("Windows and panels", windowsHelp());
  if (!seen.has("templates-repeat-trip-and-undo")) add("Templates, Repeat trip and Undo", tripsHelp());
  if (!seen.has("why-did-this-happen")) add("Why did this happen?", WHY_HELP);
  add("Sound", soundHelp()); // ui/audio.js
  if (!seen.has("ledger-and-run-summary")) add("Ledger and run summary", ledgerHelp());
  if (FAMILY.enabled && !seen.has("children-and-families")) add("Children and families", familyHelp()); // children are off for now (sim/family.js FAMILY.enabled)
  if (!seen.has("autosaves-and-crashes")) add("Autosaves and crashes", savesHelpHtml());
  for (const t of [BULK_HELP, WATCHLIST_HELP]) add(t.title, t.html);
  if (!seen.has("pause-rules-and-the-card-tray")) add("Pause rules and the card tray", pacingHelp());
  for (const [title, html] of displayHelp()) if (!seen.has(slug(title))) add(title, html);
  if (!seen.has("the-hive-crawl")) add("The hive crawl", HIVE_CRAWL_HELP);
  if (!seen.has("hives-being-born")) add("Hives being born", HIVE_BIRTH_HELP);
  if (!seen.has("the-harvest-festival")) add("The harvest festival", FESTIVAL_HELP);
  if (!seen.has("gun-attachments")) add("Gun attachments", GUNMODS_HELP);
  if (!seen.has("guns-and-melee-weapons")) add("Guns and melee weapons", ROSTER_HELP);
  if (!seen.has("medics-and-the-downed")) add("Medics and the downed", MEDICS_HELP);
  if (!seen.has("training-medics")) add("Training medics", TRAINING_HELP);
  add("Non-lethal weapons and surrender", NL_HELP); // sim/nonlethal.js
  add("Magazines, rigs and plates", KIT_HELP); // sim/carrykit.js
  if (!seen.has("caravans-on-the-road")) add("Caravans on the road", CARAVAN_HELP);
  if (!seen.has("blocs-and-wars")) add("Blocs and wars", BLOCS_WARS_HELP);
  if (!seen.has("getting-captives-back")) add("Getting captives back", RESCUE_HELP);
  add("Keys", keysSheet()); // ui/controls.js
  add("Codex and search", codexHelp());
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
