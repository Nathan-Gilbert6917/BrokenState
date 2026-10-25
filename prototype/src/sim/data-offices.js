// @ts-check
// Office buildings of every kind, with named firms (the user's request 2026-10-25, issue #27 of the interiors epic #7:
// "add office building varients"). Pure data that imports nothing, merged by data-shops.js into its tables (so every
// module that reads NEW_KINDS, AREA_DEFS, PLACE_W, FRANCHISES and ROWS takes these too: data.js LOCATIONS, loot.js
// SITE_TAGS and the find tables, combat.js AREA_SETS and AREAS, battlesize.js SIZES.SITE, shops.js the places, the
// map's sprites by the firm's look). The plans are officeplans.js, the rooms' styles officelayout.js.
//
// OFFICE_KINDS: the office variants new as site types (as data-shops.js NEW_KINDS: site, tags, areas, size, storeys):
//   storefront  a storefront office on a main street (1–2 storeys): an insurance agent, a lawyer, an accountant, a
//               real estate or a travel agent (a front desk and waiting chairs, private offices, a file room, a
//               kitchenette), a dentist (operatories with the dental chair) or a doctor's practice (exam rooms): the
//               firm's plan.office says which;
//   bizpark     a low-rise office in a business park (1–3 storeys): a glass lobby, open plan, meeting rooms, a training
//               room, a mail room, a break room, an IT closet, its parking lot;
//   cityhall    city hall (2–3 storeys): council chambers, the clerk's counter, records, the mayor's office, permits;
//   courthouse  the courthouse (2–3 storeys): courtrooms, judges' chambers, a holding cell, clerks, a law library, a
//               security screening entrance;
//   callcenter  a call center (1–2 storeys): rows of headset desks, the supervisors' platform, a big break room;
//   techoffice  a tech office (2–5 storeys): long bench desks, beanbags, a games corner, phone booths, a server room, a
//               kitchen of drinks;
//   station     a TV or radio station, or a newspaper (2 storeys): the newsroom, a studio, a control room, an archive,
//               the broadcast mast outside.
//   The office tower is the old `offices` building (site type "office"): its firms (OFFICE_FIRMS.office) lay it out as
//   a corporate tower (officeplans.js tower); a tower with no firm (one saved before them) keeps its old plan.
// OFFICE_AREAS: their raid rooms (combat.js AREAS, loot.js AREA_TAGS), as data-shops.js AREA_DEFS.
// OFFICE_W: where each stands (as data-shops.js PLACE_W: weights on a city block, a city's suburb, a town's ring, and
//   on the crawl's blocks). They roll on dice of their own (shops.js officeExtras, officePlaces) after the shops, so
//   the shops' rolls are as they were. City hall and the courthouse are not here: they stand once on a town's or a
//   city's crawl, on its civic block (OFFICE_CIVIC, shops.js civicPlaces).
// OFFICE_FIRMS: the named firms of each kind (as data-shops.js FRANCHISES: name, weights by setting, look, plan); plan
//   office (a storefront's kind), media (a station's: tv, radio, paper), storeys, fl (the front room's floor), room.
// OFFICE_BOX: the new pieces' own loot (combat.js BOX_LOOT). OFFICE_ROWS: the kinds' rows in the find tables.

/** @typedef {import("./data-shops.js").Look} Look */
const G = (city, suburb, town) => ({ city, suburb, town });
const L = (wall, trim, sign, text, accent, style = 0, roof = undefined) => ({ wall, trim, sign, text, accent, style, ...(roof ? { roof } : {}) });
const C = (city, town, deep = 0, from = 1, rich = 1, dead = 1, rare = false) => ({ city, town, deep, from, rich, dead, ...(rare ? { rare } : {}) });

// ---------- the new site types ----------
export const OFFICE_KINDS = {
  storefront: {
    site: { name: "Storefront office", glyph: "Of", cat: "town", danger: 1, loot: { scrap: 2, water: 1, food: 0.5, meds: 0.4, parts: 0.3 },
      gear: ["slingbag", "flashlight", "fireaxe"], richness: 0.45, known: "public" },
    tags: ["office", "shop", "home"],
    areas: ["office", "office", "kitchen", "store"], size: 0.4, storeys: [1, 2],
  },
  bizpark: {
    site: { name: "Business park", glyph: "Bp", cat: "urban", danger: 1, loot: { scrap: 3, water: 2, parts: 1, food: 1, meds: 0.4 },
      gear: ["slingbag", "fireaxe", "flashlight"], richness: 0.55, known: "public" },
    tags: ["office", "tech", "shop"],
    areas: ["office", "office", "kitchen", "techfloor"], size: 0.55, storeys: [1, 3],
  },
  cityhall: {
    site: { name: "City hall", glyph: "CH", cat: "town", danger: 1, loot: { scrap: 3, water: 2, food: 1, meds: 0.4 },
      gear: ["slingbag", "fireaxe", "flashlight", "pistol"], richness: 0.55, known: "public" },
    tags: ["office", "books", "school"],
    areas: ["office", "office", "civichall", "kitchen"], size: 0.6, storeys: [2, 3],
  },
  courthouse: {
    site: { name: "Courthouse", glyph: "Ct", cat: "town", danger: 2, loot: { scrap: 3, water: 2, ammo: 1, meds: 0.4 },
      gear: ["slingbag", "pistol", "baton", "cuffs", "shotgun"], richness: 0.6, known: "public" },
    tags: ["office", "books", "crime", "police"],
    areas: ["office", "courtoffice", "courtev", "office"], size: 0.6, storeys: [2, 3],
  },
  callcenter: {
    site: { name: "Call center", glyph: "Cc", cat: "urban", danger: 1, loot: { scrap: 3, water: 2, food: 2, parts: 1 },
      gear: ["slingbag", "flashlight"], richness: 0.5, known: "public" },
    tags: ["office", "tech", "kitchen"],
    areas: ["callfloor", "callfloor", "kitchen", "office"], size: 0.55, storeys: [1, 2],
  },
  techoffice: {
    site: { name: "Tech office", glyph: "Tc", cat: "urban", danger: 2, loot: { parts: 3, scrap: 2, water: 2, food: 1 },
      gear: ["slingbag", "flashlight", "handradio", "backpack"], richness: 0.6, known: "public" },
    tags: ["tech", "office", "shop"],
    areas: ["techfloor", "techfloor", "kitchen", "office"], size: 0.55, storeys: [2, 5],
  },
  station: {
    site: { name: "News station", glyph: "Tv", cat: "town", danger: 1, loot: { parts: 3, scrap: 2, water: 1, food: 0.5 },
      gear: ["handradio", "flashlight", "slingbag", "binoculars"], richness: 0.55, known: "public" },
    tags: ["tech", "office", "travel"],
    areas: ["studio", "studio", "office", "kitchen"], size: 0.5, storeys: [2, 2],
  },
};

// ---------- their raid rooms (combat.js AREAS; tags: loot.js AREA_TAGS) ----------
// About what an office room holds a container (AREAS.office), the kind's own leaning: a tech floor's electronics, a
// dentist's meds and tools, a studio's radios and cameras, the executive suite's valuables and its pistol, a
// courthouse's confiscated things. The per-piece tables are OFFICE_BOX.
export const OFFICE_AREAS = {
  techfloor: { tags: ["tech", "office", "shop"], def: { name: "Tech floor", boxes: ["cabinet", "shelf", "counter"],
    loot: { parts: [0.4, 1, 2], scrap: [0.35, 1, 3], water: [0.3, 1, 2], food: [0.2, 1, 2] }, gear: [["laptop", 0.05], ["phone", 0.04], ["camera", 0.012], ["batteries", 0.04], ["handradio", 0.01], ["slingbag", 0.02]] } },
  dental: { tags: ["medical", "office"], def: { name: "Dental surgery", boxes: ["cabinet", "shelf", "locker"],
    loot: { meds: [0.55, 1, 3], water: [0.2, 1, 2] }, gear: [["surgkit", 0.03], ["bandagekit", 0.04], ["knife", 0.015]] } },
  studio: { tags: ["tech", "office", "travel"], def: { name: "Studio", boxes: ["cabinet", "shelf", "counter"],
    loot: { parts: [0.45, 1, 3], scrap: [0.35, 1, 3], water: [0.2, 1, 2] }, gear: [["handradio", 0.06], ["camera", 0.04], ["batteries", 0.05], ["laptop", 0.025], ["phone", 0.02], ["flashlight", 0.03]] } },
  execsuite: { tags: ["office", "crime", "home"], def: { name: "Executive suite", boxes: ["cabinet", "cabinet", "shelf"],
    loot: { scrap: [0.35, 1, 3], water: [0.35, 1, 3] }, gear: [["whiskey", 0.1], ["watch", 0.04], ["goldring", 0.02], ["laptop", 0.05], ["phone", 0.04], ["pistol", 0.02], ["compact9", 0.015], ["cashbox", 0.03]] } },
  civichall: { tags: ["office", "books", "school"], def: { name: "Council chambers", boxes: ["cabinet", "shelf", "counter"],
    loot: { scrap: [0.4, 1, 3], water: [0.35, 1, 3], food: [0.15, 1, 2] }, gear: [["flashlight", 0.02], ["slingbag", 0.02]] } },
  courtoffice: { tags: ["office", "books", "crime"], def: { name: "Court offices", boxes: ["cabinet", "cabinet", "shelf"],
    loot: { scrap: [0.45, 1, 4], water: [0.3, 1, 3], meds: [0.04, 1, 1] }, gear: [["talkbook", 0.015], ["leadbook", 0.01], ["phone", 0.02], ["slingbag", 0.02]] } },
  courtev: { tags: ["crime", "police", "office"], def: { name: "Evidence room", boxes: ["locker", "cabinet", "shelf"],
    loot: { scrap: [0.25, 1, 2], meds: [0.15, 1, 2], ammo: [0.2, 4, 12] }, gear: [["knife", 0.05], ["pistol", 0.03], ["revolver", 0.015], ["compact9", 0.02], ["baton", 0.02], ["cuffs", 0.04]] } },
  callfloor: { tags: ["office", "tech", "kitchen"], def: { name: "Call floor", boxes: ["cabinet", "shelf", "counter"],
    loot: { scrap: [0.35, 1, 3], water: [0.3, 1, 2], food: [0.25, 1, 2], parts: [0.1, 1, 1] }, gear: [["phone", 0.02], ["slingbag", 0.02]] } },
};

// ---------- where each stands (shops.js) ----------
// Storefront offices on every main street, most in the towns; business parks in a city's suburbs; call centers and
// tech offices in the cities and their suburbs; a TV or radio station or the paper in the towns.
export const OFFICE_W = {
  storefront: { ...G(0.8, 0.6, 1.2),   crawl: C(0.8, 1.2, -0.05, 1, 0.9, 0.9) },
  bizpark:    { ...G(0, 1.2, 0.15),    crawl: C(0.2, 0.15, -0.1, 1, 0.95, 1) },
  callcenter: { ...G(0.4, 0.6, 0.05),  crawl: C(0.4, 0.05, 0, 1, 0.9, 1.1) },
  techoffice: { ...G(0.8, 0.5, 0.05),  crawl: C(0.7, 0.05, 0.1, 2, 1.05, 1) },
  station:    { ...G(0.15, 0.1, 0.6),  crawl: C(0.15, 0.7, 0, 1, 1, 1) },
};
// City hall and the courthouse (shops.js civicPlaces): on the civic block of a town's or a city's crawl (the block at
// its heart), city hall in every one, the courthouse in every city and in a county seat (COUNTY_SEAT of the towns).
export const OFFICE_CIVIC = {
  cityhall:   { crawl: C(0, 0, 0, 1, 1, 1.2, true) },
  courthouse: { crawl: C(0, 0, 0, 1, 1.1, 1.2, true) },
};
export const COUNTY_SEAT = 0.4;

// ---------- the firms ----------
// Colours as data-shops.js FRANCHISES: walls, the sign board, its letters, an accent; style the painter's shape (0 a
// flat front with an awning, 1 a sign on the roof, 2 a pylon sign by the door, 3 a big glass front).
export const OFFICE_FIRMS = {
  storefront: [
    { id: "caldermutual", name: "Calder Mutual Insurance", w: G(1, 0.8, 1), look: L("#e8e4d8", "#1f3550", "#1f3550", "#ffffff", "#d9a520", 0), plan: { office: "insurance", fl: "carpet" } },
    { id: "keystone", name: "Keystone Family Insurance", w: G(0.4, 0.8, 1), look: L("#b9a98a", "#6b5434", "#c8402f", "#ffffff", "#e8e4d8", 2), plan: { office: "insurance", fl: "carpet" } },
    { id: "halewhitcombe", name: "Hale & Whitcombe, Attorneys", w: G(1, 0.6, 0.8), look: L("#7a3b32", "#3a1c18", "#2d4a3c", "#e8e4d8", "#d9a520", 1), plan: { office: "law", fl: "hardwood", storeys: [1, 2] } },
    { id: "brandtlaw", name: "Brandt Law Office", w: G(0.6, 0.8, 1), look: L("#c9c2b0", "#5d6168", "#3c3a36", "#e8e4d8", "#8a8780", 0), plan: { office: "law", fl: "carpet" } },
    { id: "pruittlowe", name: "Pruitt & Lowe Accounting", w: G(1, 1, 0.8), look: L("#d9d4c8", "#3a6fb0", "#3a6fb0", "#ffffff", "#9cc46e", 3), plan: { office: "accounts", fl: "carpet" } },
    { id: "bluegate", name: "Bluegate Realty", w: G(0.8, 1, 1), look: L("#e8e4d8", "#2d4a5e", "#3a6fb0", "#ffffff", "#e8c04a", 2), plan: { office: "realty", fl: "tile" } },
    { id: "wanderway", name: "Wanderway Travel", w: G(1, 0.8, 0.6), look: L("#5d8aa8", "#2d4a5e", "#e8c04a", "#2d4a5e", "#e2826f", 0), plan: { office: "travel", fl: "tile" } },
    { id: "brightsmile", name: "Bright Smile Dental", w: G(1, 1, 0.6), look: L("#e8e4d8", "#2aa0a0", "#2aa0a0", "#ffffff", "#7fe6ff", 3), plan: { office: "dentist", fl: "lino" } },
    { id: "ostrander", name: "Dr. Ostrander, DDS", w: G(0.3, 0.6, 1), look: L("#b9a98a", "#5d6168", "#3a6fb0", "#ffffff", "#e8e4d8", 2), plan: { office: "dentist", fl: "lino" } },
    { id: "mercerpractice", name: "Mercer Family Practice", w: G(0.5, 0.8, 1), look: L("#c9c2b0", "#3f6b3a", "#3f6b3a", "#ffffff", "#e8e4d8", 0), plan: { office: "doctor", fl: "lino" } },
  ],
  bizpark: [
    { id: "lakeview", name: "Lakeview Business Park", w: G(0.6, 1, 0.6), look: L("#c9ced3", "#5d6168", "#2d4a5e", "#ffffff", "#5d8aa8", 3), plan: { storeys: [2, 3] } },
    { id: "northgate", name: "Northgate Corporate Center", w: G(0.8, 1, 0.3), look: L("#a7adb3", "#3c3a36", "#1f3550", "#ffffff", "#c9ced3", 1), plan: { storeys: [2, 3] } },
    { id: "cedarridge", name: "Cedar Ridge Office Park", w: G(0.3, 1, 1), look: L("#b9a98a", "#6b5434", "#3f6b3a", "#f0e6c8", "#9cc46e", 2), plan: { storeys: [1, 2] } },
    { id: "harmon", name: "Harmon Logistics", w: G(0.6, 0.8, 0.6), look: L("#d9d4c8", "#c8402f", "#c8402f", "#ffffff", "#2a2a2e", 0), plan: { storeys: [1, 2] } },
    { id: "pinecrest", name: "Pinecrest Commons", w: G(0.4, 1, 0.8), look: L("#c9c2b0", "#2d4a3c", "#2d4a3c", "#e8e4d8", "#d9a520", 3), plan: { storeys: [2, 3] } },
    { id: "valleyopark", name: "Calder Valley Office Park", w: G(0.5, 1, 0.8), look: L("#e8e4d8", "#5d6168", "#5b3a7a", "#ffffff", "#e8c04a", 2), plan: { storeys: [1, 3] } },
  ],
  // The tower's firms (the site type "office"; the crawl's tower, buildingmaps.js "offices", shares them: data-shops.js).
  office: [
    { id: "caldertrust", name: "Calder Trust Tower", w: G(1, 0.4, 0), look: L("#2d4a6e", "#1c2a3a", "#e8c04a", "#1c2a3a", "#c9ced3", 3), plan: { storeys: [7, 10] } },
    { id: "meridian", name: "Meridian Plaza", w: G(1, 0.6, 0.1), look: L("#3a5f6e", "#20363f", "#7fe6ff", "#20363f", "#e8e4d8", 3), plan: { storeys: [6, 9] } },
    { id: "ashford", name: "Ashford Financial Center", w: G(1, 0.4, 0), look: L("#2a2a2e", "#111114", "#d9a520", "#111114", "#c9ced3", 1), plan: { storeys: [7, 10] } },
    { id: "harlantower", name: "Harlan Tower", w: G(0.8, 0.6, 0.2), look: L("#5d6168", "#2a2a2e", "#c8402f", "#ffffff", "#c9ced3", 3), plan: { storeys: [6, 8] } },
    { id: "sterlingvance", name: "Sterling & Vance Building", w: G(1, 0.5, 0.1), look: L("#8a8780", "#4d4741", "#1f3550", "#ffffff", "#d9a520", 1), plan: { storeys: [6, 9] } },
    { id: "westbrook", name: "Westbrook Capital", w: G(0.8, 0.6, 0.1), look: L("#3d4a3c", "#232b23", "#e8e4d8", "#232b23", "#9cc46e", 3), plan: { storeys: [6, 8] } },
    { id: "unionfederal", name: "Union Federal Building", w: G(0.4, 0.8, 1), look: L("#c9c2b0", "#7d786c", "#5d6168", "#ffffff", "#8a8780", 0), plan: { storeys: [3, 5] } },
    { id: "commerceexch", name: "Commerce Exchange Building", w: G(0.3, 0.8, 1), look: L("#8e4f3c", "#4a2a20", "#3c3a36", "#e8e4d8", "#d9d0b8", 1), plan: { storeys: [3, 5] } },
  ],
  cityhall: [
    { id: "cityhall", name: "City Hall", w: G(1, 1, 0.4), look: L("#d9d4c8", "#8a8780", "#3c3a36", "#e8e4d8", "#d9a520", 1), plan: { storeys: [2, 3] } },
    { id: "townhall", name: "Town Hall", w: G(0.1, 0.6, 1), look: L("#8e4f3c", "#d9d0b8", "#3c3a36", "#e8e4d8", "#d9d0b8", 0), plan: { storeys: [2, 2] } },
    { id: "municipal", name: "Municipal Building", w: G(0.8, 1, 0.6), look: L("#a7adb3", "#5d6168", "#1f3550", "#ffffff", "#c9ced3", 3), plan: { storeys: [2, 3] } },
    { id: "civiccenter", name: "Civic Center", w: G(0.6, 0.8, 0.6), look: L("#c9c2b0", "#5d6168", "#2d4a3c", "#ffffff", "#e8c04a", 2), plan: { storeys: [2, 3] } },
  ],
  courthouse: [
    { id: "caldercounty", name: "Calder County Courthouse", w: G(0.6, 0.8, 1), look: L("#d9d0b8", "#8a8780", "#3c3a36", "#e8e4d8", "#d9a520", 0), plan: { storeys: [2, 3] } },
    { id: "district", name: "District Courthouse", w: G(1, 0.8, 0.6), look: L("#c9c2b0", "#5d6168", "#1f3550", "#ffffff", "#c9ced3", 1), plan: { storeys: [2, 3] } },
    { id: "hallofjustice", name: "Hall of Justice", w: G(1, 0.6, 0.2), look: L("#a7adb3", "#4d4741", "#3c3a36", "#e8e4d8", "#8a8780", 3), plan: { storeys: [3, 3] } },
    { id: "municourt", name: "Municipal Court", w: G(0.6, 0.8, 0.8), look: L("#8e4f3c", "#4a2a20", "#2d4a3c", "#e8e4d8", "#d9d0b8", 2), plan: { storeys: [2, 2] } },
  ],
  callcenter: [
    { id: "teleserve", name: "Teleserve Solutions", w: G(1, 1, 0.6), look: L("#c9ced3", "#3a6fb0", "#3a6fb0", "#ffffff", "#e8c04a", 3), plan: { storeys: [1, 2] } },
    { id: "dialpoint", name: "DialPoint Contact Center", w: G(1, 0.8, 0.4), look: L("#e8e4d8", "#c8402f", "#c8402f", "#ffffff", "#2a2a2e", 1), plan: { storeys: [2, 2] } },
    { id: "calderconnect", name: "Calder Connect", w: G(0.8, 1, 0.8), look: L("#a7adb3", "#1f3550", "#2d4a5e", "#ffffff", "#7fe6ff", 2), plan: { storeys: [1, 2] } },
    { id: "primeline", name: "Primeline Support", w: G(0.6, 1, 0.6), look: L("#d9d4c8", "#3f6b3a", "#3f6b3a", "#ffffff", "#e8c04a", 0), plan: { storeys: [1, 1] } },
    { id: "voicebridge", name: "VoiceBridge", w: G(1, 0.8, 0.3), look: L("#2a2a2e", "#111114", "#b06ae0", "#ffffff", "#7fe6ff", 3), plan: { storeys: [1, 2] } },
  ],
  techoffice: [
    { id: "granitesys", name: "Granite Systems", w: G(1, 0.8, 0.3), look: L("#5d6168", "#2a2a2e", "#c9ced3", "#2a2a2e", "#e2654f", 3), plan: { storeys: [3, 5] } },
    { id: "nimbuslabs", name: "Nimbus Labs", w: G(1, 1, 0.3), look: L("#e8e4d8", "#5d8aa8", "#5d8aa8", "#ffffff", "#7fe6ff", 3), plan: { storeys: [2, 4] } },
    { id: "brightwire", name: "Brightwire", w: G(1, 0.6, 0.2), look: L("#2a2a2e", "#111114", "#e8c04a", "#111114", "#9cc46e", 1), plan: { storeys: [3, 5] } },
    { id: "quantaworks", name: "Quanta Works", w: G(0.8, 1, 0.4), look: L("#c9ced3", "#5b3a7a", "#5b3a7a", "#ffffff", "#e88aa0", 2), plan: { storeys: [2, 3] } },
    { id: "copperleaf", name: "Copperleaf Software", w: G(0.8, 0.8, 0.6), look: L("#a2713f", "#5a3a20", "#2d4a3c", "#f0e6c8", "#c9873c", 0), plan: { storeys: [2, 3] } },
    { id: "hexdata", name: "Hexagon Data", w: G(1, 0.6, 0.2), look: L("#3a5f6e", "#20363f", "#9cc46e", "#20363f", "#e8e4d8", 3), plan: { storeys: [3, 5] } },
  ],
  station: [
    { id: "channel9", name: "Channel 9 News", w: G(1, 0.8, 0.8), look: L("#2d4a6e", "#1c2a3a", "#c8402f", "#ffffff", "#e8c04a", 1), plan: { media: "tv" } },
    { id: "valley12", name: "Valley 12 Eyewitness News", w: G(0.5, 0.8, 1), look: L("#e8e4d8", "#3a6fb0", "#3a6fb0", "#ffffff", "#c8402f", 2), plan: { media: "tv" } },
    { id: "radiocalder", name: "Radio Calder 1240 AM", w: G(0.6, 0.8, 1), look: L("#b9a98a", "#6b5434", "#c8402f", "#ffffff", "#e8c04a", 0), plan: { media: "radio" } },
    { id: "rivercountry", name: "River Country 98.5 FM", w: G(0.3, 0.8, 1), look: L("#7a5230", "#4a3424", "#e8a020", "#2a2a2a", "#3f6b3a", 2), plan: { media: "radio" } },
    { id: "caldercourier", name: "The Calder Courier", w: G(1, 0.6, 0.8), look: L("#d9d4c8", "#3c3a36", "#2a2a2e", "#e8e4d8", "#8a8780", 1), plan: { media: "paper" } },
    { id: "valleygazette", name: "The Valley Gazette", w: G(0.3, 0.6, 1), look: L("#8e4f3c", "#4a2a20", "#e8e4d8", "#4a2a20", "#d9a520", 0), plan: { media: "paper" } },
  ],
};

// ---------- the new pieces' loot (combat.js BOX_LOOT; kind@type in a room of that loot type only) ----------
// A headset desk's drawer: a snack, a phone, batteries; a news desk's: the anchor's things; a mail sorter: letters and
// parcels (scrap, now and then something worth having); a liquor cabinet: the executive's bottles; a tech office's
// kitchen fridge: drinks (the fridge's own row is the house's).
export const OFFICE_BOX = {
  headsetdesk:  { rest: 0.4, loot: { food: [0.12, 1, 1] }, gear: [["phone", 0.015], ["batteries", 0.02]] },
  newsdesk:     { rest: 0.5, loot: { scrap: [0.3, 1, 2] }, gear: [["phone", 0.04], ["watch", 0.01], ["camera", 0.02]] },
  sorter:       { rest: 0.3, loot: { scrap: [0.6, 1, 4], food: [0.08, 1, 2] }, gear: [["batteries", 0.03], ["phone", 0.015], ["flashlight", 0.02]] },
  liquorcab:    { rest: 0, loot: { water: [0.3, 1, 2] }, gear: [["whiskey", 0.55], ["silverware", 0.04]] },
  "fridge@techfloor": { rest: 0, loot: { water: [0.9, 3, 8], food: [0.35, 1, 3], preserved: [0.2, 1, 2] }, gear: [] },
  "evlocker@courtev": { rest: 0, loot: { meds: [0.18, 1, 2], ammo: [0.2, 4, 10] }, gear: [["knife", 0.06], ["pistol", 0.03], ["compact9", 0.025], ["revolver", 0.012], ["cuffs", 0.04], ["phone", 0.05], ["watch", 0.008]] },
};

// ---------- the new kinds' rows in the find tables (data-shops.js ROWS, by table) ----------
const P = (p, items) => ({ p, items });
export const OFFICE_ROWS = {
  SITE_FINDS: {
    storefront: P(0.08, { instcoffee: 2, batteries: 1, phone: 1, stamps: 1, candy: 1 }),
    bizpark: P(0.12, { instcoffee: 2, phone: 2, laptop: 1, batteries: 2, candy: 1 }),
    cityhall: P(0.08, { instcoffee: 2, stamps: 2, phone: 1, batteries: 1 }),
    courthouse: P(0.08, { instcoffee: 1, phone: 1, cigarettes: 1, lighters: 1 }),
    callcenter: P(0.12, { instcoffee: 2, candy: 2, phone: 2, batteries: 1, cigarettes: 1 }),
    techoffice: P(0.18, { laptop: 3, phone: 3, batteries: 2, camera: 1, console: 1, instcoffee: 1 }),
    station: P(0.16, { batteries: 3, pocketradio: 2, camera: 2, phone: 1, laptop: 1 }),
  },
  AREA_FINDS: {
    techfloor: P(0.12, { laptop: 2, phone: 2, batteries: 2, console: 0.5 }),
    studio: P(0.12, { batteries: 3, pocketradio: 2, camera: 1 }),
    execsuite: P(0.2, { watch: 2, cigars: 1.5, scotch: 1, goldchain: 0.5, coins: 1 }),
    callfloor: P(0.08, { candy: 2, instcoffee: 1, phone: 1 }),
    courtev: P(0.1, { watch: 1, phone: 2, cigarettes: 1, lighters: 1 }),
  },
  BOOK_SITES: {
    cityhall: { p: 0.06, books: ["leadbook", "talkbook", "magazines"] },
    courthouse: { p: 0.08, books: ["talkbook", "leadbook", "lockbook", "novel"] },
    storefront: { p: 0.03, books: ["talkbook", "magazines"] },
  },
  PARTS_MIX: { techoffice: { electronics: 0.85 }, station: { electronics: 0.8 }, techfloor: { electronics: 0.85 }, studio: { electronics: 0.8 } },
  SITE_MIX: { storefront: "house", bizpark: "shop", cityhall: "house", courthouse: "house", callcenter: "shop", techoffice: "shop", station: "house" },
  SITE_SOURCE: { storefront: "home", bizpark: "home", cityhall: "home", courthouse: "home", callcenter: "home", techoffice: "home", station: "home" },
  AREA_SOURCE: { techfloor: "home", dental: "shop", studio: "home", execsuite: "home", civichall: "home", courtoffice: "home", courtev: "home", callfloor: "home" },
  BOX_SITE: { courthouse: P(0.04, { cashbox: 2, firebox: 1 }), cityhall: P(0.03, { cashbox: 2 }) },
  BOX_AREA: { execsuite: P(0.06, { cashbox: 2, firebox: 1 }) },
  LOCK_ROOM: { courthouse: 0.5, cityhall: 0.3, techoffice: 0.2, station: 0.2 },
};
