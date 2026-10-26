// @ts-check
// Library variants (the user's request 2026-10-25, issue #34 of the interiors epic #7: "add library variants with several
// layouts and sizes"; and later that day "for buildings with no to only a few varients create a dozen varients per
// building type"): thirteen kinds of library, each with plans of its own, from a one-room rural reading room to a city's
// central library of up to eight storeys. Their plans (LIBRARY_VARIANTS; libraryPlan: buildingmaps.js BUILDINGS.library
// calls it for a new save, and any other building can call it for a library of a size and a setting: #28's university
// library, #27's courthouse law library, #30's strip mall), their rooms furnished for their kind on roomlayout.js's
// placement helpers (LIBRARY_STYLES, by the plan leaf's lib mark: lanes kept clear, backs to the walls, a door's front
// never taken, the lootable pieces the containers), and their signs of survival (registered with interiorscenes.js).
//
// The variants (sizes at real-world scale, a cell a metre: LIBRARY.SIZE, outer walls included; #24's size table was not
// on dev when this was built, so each size is one const here). Each has two plans or more (LIBRARY_VARIANTS[v].plans, by
// the building's dice):
//   rural      a one-room reading room in a village (10–12 × 10–12 m, 1 storey): a desk by the door, shelves round the
//              walls, a reading table, a wood stove, a small kids' shelf. storefront: the room and a back strip (a back
//              room, a toilet); schoolhouse: an old one-room schoolhouse, its cloakroom porch at the front, the children's corner
//              (a story rug) in the schoolroom.
//   carnegie   a Carnegie library (19–25 × 17–20, 1–2 storeys): the circulation rotunda under its dome (a ring of counters,
//              the card catalogue, a globe), two wings of tall stacks. lr: the wings left and right of the rotunda; fb:
//              the rotunda at the front between the reading room and the reference room, the stacks behind. The
//              children's room and the meeting room: along the back on one storey, on the floor above on two (the engine
//              has no floors below the ground but a bunker's, so the ticket's lower level is the floor above: recorded
//              in docs/features/travel.md).
//   modern     a modern branch library (26–32 × 20–24, 1 storey, glass front): an open hall of low shelving, the
//              circulation counter, self-check stations and the book drop by the door, a children's area with a story-time
//              rug and beanbags, a teen space, a computer bank, study rooms, a meeting room, the workroom. left / right:
//              the children's area either side.
//   county     a county library (31–38 × 25–29, 2 storeys): the circulation hall, the adult stacks, the reference room,
//              the local-history room, the children's wing, technical services (the book-processing counters, its
//              loading door at the back), offices; upstairs more stacks, the genealogy archive (compact shelving),
//              the staff room. corridor: rooms either side of a corridor; hall: three columns off the circulation hall.
//   central    a city's central library (50–56 × 40–44, 4–8 storeys: buildingmaps.js MAX_STOREYS): the atrium with its
//              grand stair and the lift bank (an atrium gallery round the well above), a stairwell; the ground floor's
//              café, auditorium, periodicals room, the closed-stacks archive behind a steel door (compact mobile
//              shelving: the ticket's basement, on the ground floor for the reason above) and staff offices; the grand
//              reading room (long tables, green lamps), the map room and the music and media room on the first floor up;
//              the children's floor; floors of stacks by subject; the rare-books room behind a locked door on the top
//              floor with the administration and the staff room. centre: the atrium between two wings, the stairwell at
//              the side; side: the atrium at one side.
//   historic   a historic or private library, a mansion's or an athenaeum (23–28 × 20–25, 2–3 storeys): panelled rooms
//              with fireplaces, the reading hall with the gallery round it on the floor above (a walkway with railings
//              round the well: galleryvoid cells, "open to the hall below"), the rare-books room, the librarian's study,
//              the librarian's flat (on the top floor). centre: the hall between two wings of rooms; side: the hall at one
//              side.
//   bookmobile a bookmobile depot (14–18 × 12–14, 1 storey): the garage with the bookmobile (a van that is a container
//              of books: BOX_LOOT bookmobile) behind its roller door, the sorting room, the office. side: the garage to one
//              side; back: the garage behind the office.
//   house      a library in a converted house (12–15 × 11–13, 1–2 storeys): the front parlour the reading room, the
//              children's room, the kitchen workroom, the local-history room; upstairs the bedrooms as stacks, the
//              librarian's office. foursquare: two rooms either side of the stair hall; cottage: a side hall down its length.
//   children   a children's library (18–24 × 14–18, 1 storey): pods: the welcome desk between the picture-book room and the
//              story room (story rugs, beanbags, low shelves), the craft room, the family computers, the parents' corner;
//              hall: one big children's hall with the craft room, a puppet theatre (beanbags before its booth) and the
//              workroom behind.
//   law        a law library (16–22 × 14–18, 1–2 storeys: a county's, a courthouse's: #27): the reference desk, the law
//              reading room (carrels, tables, terminals), the reporters' and statutes' stacks, compact shelving, a
//              conference room, the law librarian; upstairs the treatises and carrels. reading: the reading room at the
//              front beside the stacks; stacks: the stacks behind a front band.
//   university a university research library (36–44 × 26–32, 3–5 storeys: a campus's, #28): the learning commons under the
//              atrium (the lift bank, the circulation desk), the computer lab, the café, research help and group study
//              rooms; the silent reading room; floors of stacks by subject and carrels; special collections behind a
//              locked door and its reading room on the top floor. commons: the atrium between the wings; tower: at one side.
//   archive    a historical society or archive (14–20 × 13–16, 2 storeys): the exhibit room's display cases, the research
//              room, the processing room, the director's office; the archive stacks of compact shelving behind a locked
//              door, the map and photograph store. house: an old house's rooms; vault: the exhibit hall in front of a vault.
//   strip      a library in a strip mall (9–12 × 20–25, 1 storey, a long narrow storefront): the front counter, self-check,
//              the stacks of low shelving, the children's corner, the workroom. deep: the children at the back; split:
//              the computers beside the front.
// Which variant (libraryVariant): o.variant names one ("carnegie", or "carnegie/fb" for a plan), else the place's
// franchise (data-shops.js FRANCHISES.library: each maps to its variants, plan.libs), else LIBRARY.ANY's weights.
// Loot (combat.js AREAS from data-shops.js AREA_DEFS and BOX_LOOT; tuned so the value per 100 m² stays near the old library's: librarytest): the stacks books (the "books" rooms), reference and
// technical rooms manuals and skill books ("libref"), the map room maps and survival books ("libmaps"), the rare-books
// room valuables ("librare"), the staff room snacks and first aid ("libstaff"), the computer bank electronics
// ("libtech"). Each room's containers are its area's share (roomlayout.js target: area / 10 up to its maxBoxes), so the
// total grows with the building's area (tools/librarytest.js reports it).
// Determinism and older saves: an older save (worldcfg.js legacyRooms) lays its library out as it always was
// (buildingmaps.js library: the old plan, its dice as before, so poi.cont's container ids line up); only a new save's
// libraries are these.
import { hash01 } from "./skills.js";
import { registerVariants, pickVariant, pickFrom, variantFor } from "./variantpick.js"; // the shared picker (issue #41)
import { registerScene, SCENES } from "./interiorscenes.js";
import { vehicleIn } from "./civiclayout.js";
import { FRANCHISES } from "./data-shops.js";

export const LIBRARY = {
  // Footprints in cells (about a metre each), [min, max], outer walls included; storeys.
  SIZE: {
    rural:      { w: [10, 12], h: [10, 12], storeys: [1, 1] },   // the issue's 8–12 m
    carnegie:   { w: [19, 25], h: [17, 20], storeys: [1, 2] },   // 15–25 × 15–20 (19 × 17 at least: the rotunda, two wings of stacks, the rooms behind)
    modern:     { w: [26, 32], h: [20, 24], storeys: [1, 1] },   // 25–40 × 20–30
    county:     { w: [31, 38], h: [25, 29], storeys: [2, 2] },   // 30–45 × 25–35
    central:    { w: [50, 56], h: [40, 44], storeys: [4, 8] },   // 50–80 × 40–60, 4–8 storeys
    historic:   { w: [23, 28], h: [20, 25], storeys: [2, 3] },   // 20–30
    bookmobile: { w: [14, 18], h: [12, 14], storeys: [1, 1] },
    strip:      { w: [9, 12],  h: [20, 25], storeys: [1, 1] },   // a strip mall's unit: narrow and deep
    house:      { w: [12, 15], h: [11, 13], storeys: [1, 2] },   // a converted house
    children:   { w: [18, 24], h: [14, 18], storeys: [1, 1] },
    law:        { w: [16, 22], h: [14, 18], storeys: [1, 2] },   // a courthouse's, a county's
    university: { w: [36, 44], h: [26, 32], storeys: [3, 5] },   // a campus's research library
    archive:    { w: [14, 20], h: [13, 16], storeys: [2, 2] },   // a historical society, an archive
  },
  // A library with no franchise (a test's, a site's from before franchises): its variant by these weights.
  ANY: { rural: 1, carnegie: 1, modern: 1, county: 1, central: 0.5, historic: 0.5, bookmobile: 0.5, strip: 0.7, house: 0.8, children: 0.6, law: 0.2, university: 0.15, archive: 0.4 },
  WELL: 2,          // a gallery's walkway round the well: this many cells from the walls (the railing on the next)
  STACK_GAP: 9,     // a run of stacks breaks for a cross aisle every this many cells
  SUBJECTS: ["History", "Science", "Literature", "Arts", "Social sciences", "Technology", "Philosophy and religion", "Languages"],
  // The scenes (interiorscenes.js): readers barricaded in the stacks, the library as a shelter, the archive sealed, the
  // librarian's last notice on the circulation desk.
  SHELTER_COTS: [4, 9],
};

// Each variant's name, the plan's name the game shows (spec.vname; spec.vid "<variant>/<plan>", the pin o.variant takes:
// planname.js, issue #40).
export const LIBRARY_NAMES = {
  rural: "Rural reading room", carnegie: "Carnegie library", modern: "Modern branch library", county: "County library", central: "Central library",
  historic: "Historic library", bookmobile: "Bookmobile depot", strip: "Strip-mall library", house: "Library in a converted house", children: "Children's library",
  law: "Law library", university: "University research library", archive: "Historical archive",
};
const X = (...parts) => ({ split: "x", parts });
const Y = (...parts) => ({ split: "y", parts });
// A room: its role (buildingmaps.js ROLES), its style's lib mark, its overrides (name, type, maxBoxes, entry, hub...).
const R = (role, lib, o = {}) => ({ role, lib, ...o });
const RR = ["*", { role: "restroom" }];
const rest = (w = 2) => [w, { role: "restroom" }];
/** @param {any} rng @param {number[]} r */
const roll = (rng, r) => rng.int(r[0], r[1]);
// A list's parts mirrored (a plan's left-right twin).
const flipX = (node, on) => (on && node.split === "x" ? { ...node, parts: node.parts.slice().reverse() } : node);

// The rooms most libraries share.
const stacks = (name = "Stacks", o = {}) => R("stock", "stacks", { name, type: "books", fl: "carpet", maxBoxes: 14, ...o });
const reading = (name = "Reading room", o = {}) => R("dining", "readroom", { name, type: "books", fl: "carpet", hub: false, maxBoxes: 4, ...o });
const children = (name = "Children's room", o = {}) => R("classroom", "children", { name, type: "books", fl: "carpet", maxBoxes: 4, ...o });
const meeting = (name = "Meeting room") => R("dining", "meeting", { name, type: "office", fl: "carpet", hub: false, maxBoxes: 2 });
const workroom = (name = "Workroom") => R("office", "workroom", { name, type: "office", maxBoxes: 1 });
const office = (name = "Staff offices") => R("office", "liboffice", { name, type: "office", maxBoxes: 1 });
const staffroom = (name = "Staff room") => R("breakroom", "staffroom", { name, type: "libstaff", maxBoxes: 3 });
const refroom = (name = "Reference room", o = {}) => R("dining", "refroom", { name, type: "libref", fl: "carpet", hub: false, maxBoxes: 6, ...o });
const compbank = (name = "Computer bank") => R("office", "compbank", { name, type: "libtech", fl: "carpet", maxBoxes: 4 });
const study = (name = "Study room") => R("dining", "studyroom", { name, type: "books", fl: "carpet", hub: false, maxBoxes: 1 });

// ======================================================================================
// The plans: each (rng, d) → the spec's program, upper and exits; d = { bw, bh, n } (the footprint and storeys rolled).
// ======================================================================================
const PLANS = {
  rural: {
    storefront(rng, d) {
      return {
        program: Y(["*", R("dining", "oneroom", { name: "Reading room", type: "books", entry: true, hub: true, fl: "wood", maxBoxes: 6 })],
          [2, X(["*", R("storage", "libstore", { name: "Back room", type: "books", maxBoxes: 2 })], rest(2))]),
        exits: [{ side: "back", roles: ["storage"], chance: 0.5, lock: 0.5 }],
      };
    },
    // A one-room schoolhouse turned reading room: the cloakroom porch at the front (the entry, a coat rack's worth of
    // pegs, the toilet beside it), the old classroom behind, the children's corner by the stove.
    schoolhouse(rng, d) {
      return {
        program: Y([3, flipX(X(["*", R("hall", "porch", { name: "Cloakroom", entry: true, hub: true, fl: "wood" })], rest(2)), rng.chance(0.5))],
          ["*", R("dining", "oneroom", { name: "Old schoolroom", type: "books", hub: true, fl: "wood", maxBoxes: 6, kids: true })]),
        exits: [{ side: "back", roles: ["dining"], chance: 0.4, lock: 0.5 }],
      };
    },
  },
  carnegie: {
    // The rotunda between two wings of stacks; on one storey the lower level's rooms along the back.
    lr(rng, d) {
      const rot = [7, Y(["*", R("foyer", "rotunda", { name: "Circulation rotunda", type: "books", entry: true, hub: true, fl: "tile", maxBoxes: 3 })], [4, refroom()])];
      const wing = (side) => ["*", stacks(`Stacks (${side} wing)`, { fl: "wood" })];
      const main = X(wing("west"), rot, ["*", Y(["*", stacks("Stacks (east wing)", { fl: "wood" })], [0.4, reading()])]);
      const back = d.n > 1 ? X(["*", workroom()], rest(2), ["*", R("storage", "libstore", { name: "Book store", type: "books", maxBoxes: 2 })])
        : X(["*", children()], ["*", meeting()], [4, workroom()], rest(2));
      return {
        program: Y(["*", flipX(main, rng.chance(0.5))], [d.n > 1 ? 4 : 5, back]),
        upper: () => Y(["*", X(["*", children()], [7, R("hall", "upperhall", { name: "Rotunda gallery", hub: true, fl: "wood" })], ["*", meeting()])],
          [4, X(["*", R("dining", "localhist", { name: "Local history room", type: "books", fl: "wood", hub: false, maxBoxes: 3 })], rest(2), ["*", office()])]),
        stairs: { roles: ["foyer", "hall"] },
        exits: [{ side: "back", roles: ["office", "restroom", "storage"], chance: 0.6, lock: 0.4 }],
      };
    },
    // The rotunda at the front between the reading room and the reference room, the stack hall behind.
    fb(rng, d) {
      const front = [0.35, X(["*", reading()], [7, R("foyer", "rotunda", { name: "Circulation rotunda", type: "books", entry: true, hub: true, fl: "tile", maxBoxes: 3 })], ["*", refroom()])];
      const stackHall = ["*", X(["*", stacks("Stacks", { fl: "wood" })], [5, R("hall", "stackaisle", { name: "Stack hall", hub: true, fl: "wood" })], ["*", stacks("Stacks", { fl: "wood" })])];
      const lower = d.n > 1 ? [] : [[4, X(["*", children()], ["*", meeting()], rest(2))]];
      return {
        program: Y(front, stackHall, ...lower),
        upper: () => Y([0.35, X(["*", children()], [7, R("hall", "upperhall", { name: "Rotunda gallery", hub: true, fl: "wood" })], ["*", meeting()])],
          ["*", X(["*", R("dining", "localhist", { name: "Local history room", type: "books", fl: "wood", hub: false, maxBoxes: 3 })], [5, R("hall", "stackaisle", { name: "Upper hall", hub: true, fl: "wood" })], ["*", Y(["*", office()], [3, { role: "restroom" }])])]),
        stairs: { roles: ["foyer", "hall"] },
        exits: [{ side: "back", roles: ["hall", "restroom"], chance: 0.5, lock: 0.5 }],
      };
    },
  },
  modern: {
    left(rng, d) { return modern(rng, d, false); },
    right(rng, d) { return modern(rng, d, true); },
  },
  county: {
    corridor(rng, d) {
      const fd = Math.max(8, Math.round((d.bh - 2) * 0.4));
      const tech = R("parts", "techserv", { name: "Technical services", type: "office", fl: "conc", maxBoxes: 4 });
      return {
        program: Y([fd, X(["*", stacks("Adult stacks")], [9, R("lobby", "circdesk", { name: "Circulation hall", type: "books", entry: true, hub: true, fl: "tile", maxBoxes: 2 })], ["*", refroom()])],
          [2, { role: "corridor" }],
          ["*", X(["*", children("Children's wing")], [7, R("dining", "localhist", { name: "Local history room", type: "books", hub: false, maxBoxes: 3 })], ["*", tech], [5, office("Offices")], rest(3))]),
        upper: () => Y([fd, X(["*", stacks("Adult stacks")], [9, R("hall", "upperhall", { name: "Upper hall", hub: true, fl: "carpet" })], ["*", stacks("Nonfiction stacks")])],
          [2, { role: "corridor" }],
          ["*", X(["*", R("storage", "genealogy", { name: "Genealogy archive", type: "libref", lock: ["door", 0.4], fl: "conc", maxBoxes: 6 })], [6, staffroom()], [4, study()], [4, study()], ["*", office("Offices")], rest(3))]),
        stairs: { roles: ["corridor"], n: 2, ends: true },
        exits: [{ side: "back", roles: ["parts"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Loading door" }, { side: rng.chance(0.5) ? "left" : "right", roles: ["corridor"], chance: 0.6, lock: 0.4 }],
      };
    },
    hall(rng, d) {
      const tech = R("parts", "techserv", { name: "Technical services", type: "office", fl: "conc", maxBoxes: 4 });
      const flip = rng.chance(0.5);
      return {
        program: flipX(X(["*", Y(["*", stacks("Adult stacks")], [8, refroom()])],
          [11, Y(["*", R("lobby", "circdesk", { name: "Circulation hall", type: "books", entry: true, hub: true, fl: "tile", maxBoxes: 2 })], [7, R("dining", "localhist", { name: "Local history room", type: "books", hub: false, maxBoxes: 3 })])],
          ["*", Y(["*", children("Children's wing")], [5, X(["*", office("Offices")], rest(3))], ["*", tech])]), flip),
        upper: () => flipX(X(["*", Y(["*", stacks("Nonfiction stacks")], [8, R("storage", "genealogy", { name: "Genealogy archive", type: "libref", lock: ["door", 0.4], fl: "conc", maxBoxes: 6 })])],
          [11, Y(["*", R("hall", "upperhall", { name: "Upper hall", hub: true, fl: "carpet" })], [7, staffroom()])],
          ["*", Y(["*", stacks("Fiction stacks")], [5, X(["*", office("Offices")], rest(3))], ["*", X(["*", study()], ["*", study()])])]), flip),
        stairs: { roles: ["lobby", "hall"], n: 2 },
        exits: [{ side: "back", roles: ["parts"], chance: 1, roller: true, width: 2, lock: 0.3, name: "Loading door" }],
      };
    },
  },
  central: {
    centre(rng, d) { return central(rng, d, "centre"); },
    side(rng, d) { return central(rng, d, "side"); },
  },
  historic: {
    centre(rng, d) { return historic(rng, d, "centre"); },
    side(rng, d) { return historic(rng, d, "side"); },
  },
  bookmobile: {
    side(rng, d) {
      const garage = [8, R("bays", "bmgarage", { name: "Bookmobile garage", type: "garage", maxBoxes: 1 })];
      const rest2 = ["*", Y([5, X(["*", R("office", "bmoffice", { name: "Office", type: "office", entry: true, hub: true, maxBoxes: 2 })], rest(3))], ["*", R("storage", "sorting", { name: "Sorting room", type: "books", maxBoxes: 4 })])];
      return {
        program: flipX(X(garage, rest2), rng.chance(0.5)),
        exits: [{ side: "front", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.3, name: "Garage door" }, { side: "back", roles: ["storage"], chance: 0.5, lock: 0.5 }],
      };
    },
    back(rng, d) {
      return {
        program: Y([5, X(["*", R("office", "bmoffice", { name: "Office", type: "office", entry: true, hub: true, maxBoxes: 2 })], rest(3), ["*", R("storage", "sorting", { name: "Sorting room", type: "books", maxBoxes: 4 })])],
          ["*", R("bays", "bmgarage", { name: "Bookmobile garage", type: "garage", maxBoxes: 1 })]),
        exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.3, name: "Garage door" }],
      };
    },
  },
  house: {
    // A converted house, two-up two-down round its stair hall: the front parlour the reading room, the dining room the
    // children's room, the kitchen the workroom, the back sitting room the local-history room; upstairs the bedrooms as
    // stacks and the librarian's office.
    foursquare(rng, d) {
      const flip = rng.chance(0.5);
      return {
        program: flipX(X(["*", Y(["*", R("dining", "oneroom", { name: "Front parlour", type: "books", entry: true, hub: true, fl: "hardwood", maxBoxes: 5 })], ["*", R("office", "workroom", { name: "Kitchen workroom", type: "office", fl: "lino", maxBoxes: 2 })])],
          [3, Y(["*", R("hall", "porch", { name: "Stair hall", hub: true, fl: "hardwood" })], [3, { role: "restroom" }])],
          ["*", Y(["*", children("Children's room", { fl: "hardwood" })], ["*", R("dining", "localhist", { name: "Local history room", type: "books", fl: "hardwood", hub: false, maxBoxes: 3 })])]), flip),
        upper: () => flipX(X(["*", Y(["*", stacks("Upstairs stacks", { fl: "hardwood", maxBoxes: 6 })], ["*", office("Librarian's office")])], [3, Y(["*", R("hall", "porch", { name: "Landing", hub: true, fl: "hardwood" })], [3, { role: "restroom" }])],
          ["*", Y(["*", stacks("Fiction stacks", { fl: "hardwood", maxBoxes: 6 })], ["*", study("Quiet room")])]), flip),
        stairs: { roles: ["hall"] },
        exits: [{ side: "back", roles: ["office"], chance: 0.7, lock: 0.4, name: "Kitchen door" }],
      };
    },
    // A cottage with a side hall down its length: the rooms in a row off it, front to back.
    cottage(rng, d) {
      const flip = rng.chance(0.5);
      return {
        program: flipX(X([3, R("hall", "porch", { name: "Side hall", entry: true, hub: true, fl: "hardwood" })],
          ["*", Y(["*", R("dining", "oneroom", { name: "Parlour reading room", type: "books", fl: "hardwood", maxBoxes: 5 })], ["*", children("Children's room", { fl: "hardwood" })], ["*", X(["*", R("office", "workroom", { name: "Kitchen workroom", type: "office", fl: "lino", maxBoxes: 2 })], rest(2))])]), flip),
        upper: () => flipX(X([3, R("hall", "porch", { name: "Upper hall", hub: true, fl: "hardwood" })], ["*", Y(["*", stacks("Attic stacks", { fl: "wood", maxBoxes: 6 })], ["*", office("Librarian's office")])]), flip),
        stairs: { roles: ["hall"] },
        exits: [{ side: "back", roles: ["office", "restroom"], chance: 0.7, lock: 0.4, name: "Back door" }],
      };
    },
  },
  children: {
    // A children's library: the welcome desk between the picture-book room and the story room, the craft room, the
    // family computers, the parents' corner and the family restroom behind.
    pods(rng, d) {
      return {
        program: Y(["*", X(["*", children("Picture-book room", { lib: "kidsarea", maxBoxes: 5 })], [7, R("lobby", "circdesk", { name: "Welcome desk", type: "books", entry: true, hub: true, fl: "carpet", maxBoxes: 2 })], ["*", children("Story room", { lib: "kidsarea", maxBoxes: 3 })])],
          [6, X(["*", R("classroom", "craft", { name: "Craft room", type: "books", fl: "lino", maxBoxes: 3 })], ["*", compbank("Family computers")], ["*", reading("Parents' corner", { maxBoxes: 2 })], rest(3))]),
        exits: [{ side: "back", roles: ["classroom", "restroom"], chance: 0.6, lock: 0.4 }],
      };
    },
    // One big children's hall (low shelving, the story rug, the desk) with the craft room, the puppet theatre and the
    // workroom behind.
    hall(rng, d) {
      return {
        program: Y(["*", R("lobby", "kidshall", { name: "Children's hall", type: "books", entry: true, hub: true, fl: "carpet", maxBoxes: 8 })],
          [6, flipX(X(["*", R("classroom", "craft", { name: "Craft room", type: "books", fl: "lino", maxBoxes: 3 })], ["*", R("dayroom", "puppet", { name: "Puppet theatre", type: null, fl: "carpet", hub: false })], [5, workroom()], rest(3)), rng.chance(0.5))]),
        exits: [{ side: "back", roles: ["office", "restroom"], chance: 0.6, lock: 0.4 }],
      };
    },
  },
  law: {
    // A law library (a courthouse's, a law school's, a county's): the reference desk between the reading room (carrels,
    // tables, the terminals) and the reporters' and statutes' stacks; behind, the conference room, compact shelving of
    // old reporters and the law librarian's office. Upstairs the treatises and more carrels.
    reading(rng, d) {
      return {
        program: Y(["*", flipX(X(["*", R("dining", "lawread", { name: "Law reading room", type: "libref", fl: "carpet", hub: false, maxBoxes: 4 })], [7, R("lobby", "circdesk", { name: "Reference desk", type: "libref", entry: true, hub: true, fl: "carpet", maxBoxes: 2 })], ["*", stacks("Reporters and statutes", { maxBoxes: 8 })]), rng.chance(0.5))],
          [5, X(["*", meeting("Conference room")], ["*", R("storage", "genealogy", { name: "Compact stacks", type: "libref", fl: "conc", lock: ["door", 0.3], maxBoxes: 5 })], [4, office("Law librarian")], rest(2))]),
        upper: () => Y(["*", X(["*", R("dining", "carrels", { name: "Carrels", type: "libref", fl: "carpet", hub: false, maxBoxes: 2 })], [7, R("hall", "upperhall", { name: "Upper hall", hub: true, fl: "carpet" })], ["*", stacks("Treatises", { maxBoxes: 8 })])],
          [5, X(["*", office("Offices")], rest(2), ["*", study()])]),
        stairs: { roles: ["lobby", "hall"] },
        exits: [{ side: "back", roles: ["office", "restroom"], chance: 0.5, lock: 0.6 }],
      };
    },
    // The stacks behind a front band of the desk and the reading room.
    stacks(rng, d) {
      return {
        program: Y([6, flipX(X(["*", R("lobby", "circdesk", { name: "Reference desk", type: "libref", entry: true, hub: true, fl: "carpet", maxBoxes: 2 })], ["*", R("dining", "lawread", { name: "Law reading room", type: "libref", fl: "carpet", hub: false, maxBoxes: 4 })]), rng.chance(0.5))],
          ["*", X(["*", stacks("Reporters", { maxBoxes: 8 })], [5, R("hall", "stackaisle", { name: "Stack aisle", hub: true, fl: "carpet" })], ["*", stacks("Statutes and codes", { maxBoxes: 8 })])]),
        upper: () => Y([6, X(["*", meeting("Conference room")], ["*", office("Law librarian")])], ["*", X(["*", stacks("Treatises", { maxBoxes: 8 })], [5, R("hall", "stackaisle", { name: "Upper aisle", hub: true, fl: "carpet" })], ["*", R("dining", "carrels", { name: "Carrels", type: "libref", fl: "carpet", hub: false, maxBoxes: 2 })])]),
        stairs: { roles: ["hall"] },
        exits: [{ side: "back", roles: ["hall"], chance: 0.5, lock: 0.6 }],
      };
    },
  },
  university: {
    commons(rng, d) { return university(rng, d, "commons"); },
    tower(rng, d) { return university(rng, d, "tower"); },
  },
  archive: {
    // A historical society in an old house: the exhibit room and the research room at the front, the processing room
    // and the director's office behind; upstairs the archive stacks behind a locked door and the accessions store.
    house(rng, d) {
      return {
        program: Y(["*", flipX(X(["*", R("dining", "exhibit", { name: "Exhibit room", type: "books", entry: true, hub: true, fl: "hardwood", maxBoxes: 3 })], ["*", R("dining", "localhist", { name: "Research room", type: "books", fl: "hardwood", hub: false, maxBoxes: 3 })]), rng.chance(0.5))],
          [5, X(["*", R("office", "workroom", { name: "Processing room", type: "office", maxBoxes: 3 })], [4, office("Director's office")], rest(2))]),
        upper: () => Y(["*", X(["*", R("storage", "closedstacks", { name: "Archive stacks", type: "libref", fl: "conc", lock: ["door", 0.5], maxBoxes: 5 })], ["*", R("storage", "genealogy", { name: "Map and photograph store", type: "libmaps", fl: "conc", maxBoxes: 3 })])],
          [5, X(["*", R("storage", "libstore", { name: "Accessions store", type: "books", maxBoxes: 2 })], [5, R("hall", "upperhall", { name: "Landing", hub: true, fl: "hardwood" })], rest(2))]),
        stairs: { roles: ["hall", "office"] },
        exits: [{ side: "back", roles: ["office", "restroom"], chance: 0.6, lock: 0.5 }],
      };
    },
    // An archive building: the exhibit hall and the reading room across the front, the vault of compact shelving behind
    // a steel door; upstairs the processing room, offices and the collection stacks.
    vault(rng, d) {
      return {
        program: Y([6, X(["*", R("foyer", "exhibit", { name: "Exhibit hall", type: "books", entry: true, hub: true, fl: "tile", maxBoxes: 3 })], ["*", R("dining", "localhist", { name: "Reading room", type: "books", fl: "carpet", hub: false, maxBoxes: 3 })])],
          ["*", R("storage", "closedstacks", { name: "Archive vault", type: "libref", fl: "conc", dk: "steel", lock: ["door", 0.5], maxBoxes: 6 })]),
        upper: () => Y([6, X(["*", R("office", "workroom", { name: "Processing room", type: "office", maxBoxes: 3 })], ["*", office("Offices")])], ["*", stacks("Collection stacks", { maxBoxes: 8 })]),
        stairs: { roles: ["foyer"] },
        exits: [{ side: "back", roles: ["storage"], chance: 0.5, lock: 0.7 }],
      };
    },
  },
  strip: {
    deep(rng, d) {
      return {
        program: Y(["*", R("lobby", "stripfront", { name: "Library", type: "books", entry: true, hub: true, fl: "carpet", maxBoxes: 4 })], ["*", stacks("Stacks", { lib: "lowstacks" })],
          [6, children("Children's corner")], [3, X(["*", workroom()], rest(2))]),
        exits: [{ side: "back", roles: ["office"], chance: 1, lock: 0.5, name: "Service door" }],
      };
    },
    split(rng, d) {
      return {
        program: Y([8, flipX(X(["*", R("lobby", "stripfront", { name: "Library", type: "books", entry: true, hub: true, fl: "carpet", maxBoxes: 3 })], [4, compbank("Computers")]), rng.chance(0.5))],
          ["*", stacks("Stacks", { lib: "lowstacks" })], [4, X(["*", children("Children's corner")], [3, workroom()])], [3, X(["*", R("storage", "libstore", { name: "Storeroom", type: "books", maxBoxes: 2 })], rest(2))]),
        exits: [{ side: "back", roles: ["storage"], chance: 1, lock: 0.5, name: "Service door" }],
      };
    },
  },
};

// A modern branch: the children's area on one side of the open hall (flip: the other), the teen space and the computer
// bank on the other, the meeting room, study rooms, the workroom and the restrooms along the back.
function modern(rng, d, flip) {
  const kids = [9, children("Children's area", { lib: "kidsarea", maxBoxes: 4 })];
  const hall = ["*", R("lobby", "openhall", { name: "Open hall", type: "books", entry: true, hub: true, fl: "carpet", maxBoxes: 10 })];
  const teen = [8, Y(["*", R("dayroom", "teen", { name: "Teen space", type: "books", fl: "carpet", hub: false, maxBoxes: 2 })], ["*", compbank()])];
  return {
    program: Y(["*", flipX(X(kids, hall, teen), flip)], [6, X(["*", meeting()], [4, study()], [4, study()], ["*", workroom()], rest(3), rest(3))]),
    exits: [{ side: "back", roles: ["office"], chance: 0.8, lock: 0.4, name: "Staff door" }],
  };
}

// The central library: four columns on every floor (the atrium, two wings, the stairwell), so the atrium's stair and the
// stairwell's stand in the same rooms all the way up.
function central(rng, d, kind) {
  const subj = rng.shuffle(LIBRARY.SUBJECTS.slice());
  const cols = (atrium, a, b, stair) => (kind === "centre" ? X(a, atrium, b, stair) : X(stair, a, b, atrium));
  const atriumCol = (top) => [12, Y(["*", top], [6, X(RR, RR)])];
  const stairCol = (low) => [6, Y(["*", R("hall", "stairwell", { name: "Stairwell", hub: true, fl: "conc" })], [8, low])];
  const ground = cols(atriumCol(R("foyer", "atrium", { name: "Atrium", type: "books", entry: true, hub: true, fl: "tile", maxBoxes: 3 })),
    ["*", Y(["*", R("cafeteria", "cafe", { name: "Café", type: "kitchen", hub: false, maxBoxes: 2 })], ["*", R("dayroom", "auditorium", { name: "Auditorium", type: null, hub: false })])],
    ["*", Y(["*", R("dining", "periodicals", { name: "Periodicals room", type: "books", fl: "carpet", hub: false, maxBoxes: 5 })],
      ["*", R("storage", "closedstacks", { name: "Closed stacks", type: "books", fl: "conc", lock: ["door", 0.6], dk: "steel", maxBoxes: 12 })], [6, office()])],
    stairCol(R("storage", "libstore", { name: "Receiving", type: "books", maxBoxes: 2 })));
  const gallery = () => R("foyer", "atriumgal", { name: "Atrium gallery", hub: true, fl: "tile" });
  const upper = (f, r, ctx) => {
    const top = ctx && ctx.top;
    if (f === 1 && !top) return cols(atriumCol(gallery()),
      ["*", R("dining", "grandread", { name: "Grand reading room", type: "books", fl: "wood", hub: false, maxBoxes: 8 })],
      ["*", Y(["*", R("dining", "maproom", { name: "Map room", type: "libmaps", fl: "wood", hub: false, maxBoxes: 5 })], ["*", R("office", "media", { name: "Music and media room", type: "libtech", fl: "carpet", maxBoxes: 4 })], [6, office()])],
      stairCol(R("storage", "libstore", { name: "Book lift room", type: "books", maxBoxes: 1 })));
    if (f === 2 && !top) return cols(atriumCol(gallery()),
      ["*", children("Children's library", { lib: "kidsarea", maxBoxes: 8 })],
      ["*", Y(["*", children("Story room", { lib: "kidsarea", maxBoxes: 3 })], ["*", compbank("Children's computers")], [6, X(["*", study("Homework room")], ["*", study("Homework room")])])],
      stairCol(R("storage", "libstore", { name: "Storeroom", type: "books", maxBoxes: 1 })));
    const s1 = subj[(2 * f) % subj.length], s2 = subj[(2 * f + 1) % subj.length];
    if (top) return cols(atriumCol(gallery()),
      ["*", Y(["*", stacks(`Stacks: ${s1}`)], ["*", R("storage", "rarebooks", { name: "Rare books room", type: "librare", fl: "wood", lock: ["door", 0.85], dk: "steel", boxLock: ["case", 0.5], maxBoxes: 2 })])],
      ["*", Y(["*", office("Administration")], ["*", staffroom()], [6, office()])],
      stairCol(R("storage", "libstore", { name: "Storeroom", type: "books", maxBoxes: 1 })));
    return cols(atriumCol(gallery()),
      ["*", stacks(`Stacks: ${s1}`)],
      ["*", Y(["*", stacks(`Stacks: ${s2}`)], ["*", R("dining", "carrels", { name: "Study carrels", type: "books", fl: "carpet", hub: false, maxBoxes: 2 })], [6, office()])],
      stairCol(R("storage", "libstore", { name: "Storeroom", type: "books", maxBoxes: 1 })));
  };
  return {
    program: ground, upper,
    stairs: { roles: ["foyer", "hall"], n: 2 },
    exits: [{ side: "back", roles: ["storage"], chance: 1, roller: true, width: 2, lock: 0.4, name: "Loading bay" }, { side: kind === "centre" ? "right" : "left", roles: ["hall"], chance: 0.8, lock: 0.5, name: "Fire exit" }],
  };
}

// A university research library: the learning commons (the circulation and help desks under the atrium's stair, the
// lift bank) between two wings, a stairwell at the side, as the central library's columns; the computer lab and the
// café, the research help desk and group study rooms on the ground floor; the silent reading room; floors of stacks by
// subject and carrels; special collections (behind a locked door) and their reading room on the top floor. commons:
// the atrium between the wings; tower: at one side, the lab and the café the other way round.
function university(rng, d, kind) {
  const subj = rng.shuffle(LIBRARY.SUBJECTS.slice());
  const cols = (atrium, a, b, stair) => (kind === "commons" ? X(a, atrium, b, stair) : X(stair, b, a, atrium));
  const atriumCol = (top) => [10, Y(["*", top], [5, X(RR, RR)])];
  const stairCol = () => [5, Y(["*", R("hall", "stairwell", { name: "Stairwell", hub: true, fl: "conc" })], [6, R("storage", "libstore", { name: "Storeroom", type: "books", maxBoxes: 1 })])];
  const gallery = () => R("foyer", "atriumgal", { name: "Atrium gallery", hub: true, fl: "tile" });
  const groups = () => ["*", X(["*", study("Group study")], ["*", study("Group study")])];
  const ground = cols(atriumCol(R("foyer", "atrium", { name: "Learning commons", type: "books", entry: true, hub: true, fl: "tile", maxBoxes: 3 })),
    ["*", Y(["*", compbank("Computer lab")], ["*", R("cafeteria", "cafe", { name: "Café", type: "kitchen", hub: false, maxBoxes: 2 })])],
    ["*", Y(["*", refroom("Research help")], groups(), [6, office()])], stairCol());
  const upper = (f, r, ctx) => {
    if (ctx && ctx.top) return cols(atriumCol(gallery()),
      ["*", Y(["*", R("storage", "rarebooks", { name: "Special collections", type: "librare", fl: "wood", lock: ["door", 0.8], dk: "steel", boxLock: ["case", 0.5], maxBoxes: 2 })], ["*", reading("Special collections reading room", { fl: "wood" })])],
      ["*", Y(["*", office("Archives office")], ["*", staffroom()], [6, office()])], stairCol());
    if (f === 1) return cols(atriumCol(gallery()),
      ["*", R("dining", "grandread", { name: "Silent reading room", type: "books", fl: "carpet", hub: false, maxBoxes: 6 })],
      ["*", Y(["*", R("dining", "carrels", { name: "Study carrels", type: "books", fl: "carpet", hub: false, maxBoxes: 2 })], groups(), [6, office()])], stairCol());
    const s1 = subj[(2 * f) % subj.length], s2 = subj[(2 * f + 1) % subj.length];
    return cols(atriumCol(gallery()), ["*", stacks(`Stacks: ${s1}`)], ["*", Y(["*", stacks(`Stacks: ${s2}`)], ["*", R("dining", "carrels", { name: "Study carrels", type: "books", fl: "carpet", hub: false, maxBoxes: 2 })], [6, office()])], stairCol());
  };
  return {
    program: ground, upper,
    stairs: { roles: ["foyer", "hall"], n: 2 },
    exits: [{ side: "back", roles: ["storage"], chance: 0.8, lock: 0.5, name: "Loading door" }, { side: kind === "commons" ? "right" : "left", roles: ["hall"], chance: 0.8, lock: 0.5, name: "Fire exit" }],
  };
}

// A historic library: the reading hall (the gallery round its well above) behind the entrance hall, panelled rooms either
// side (centre) or down one side (side); the librarian's flat on the top floor.
function historic(rng, d, kind) {
  const flip = rng.chance(0.5);
  const panelled = (name, o = {}) => R("dining", "panelled", { name, type: "books", fl: "hardwood", hub: false, maxBoxes: 3, ...o });
  const rare = R("storage", "rarebooks", { name: "Rare books room", type: "librare", fl: "hardwood", lock: ["door", 0.7], boxLock: ["case", 0.5], maxBoxes: 2 });
  const hall = (inner) => [11, Y([5, R("foyer", "entryhall", { name: "Entrance hall", type: "books", entry: true, hub: true, fl: "tile", maxBoxes: 1 })], ["*", inner])];
  const upHall = (inner) => [11, Y([5, R("hall", "upperhall", { name: "Upper landing", hub: true, fl: "hardwood" })], ["*", inner])];
  const flat = (wing) => Y(["*", { role: "living", name: "Librarian's flat: living room", flat: true }], ["*", X(["*", { role: "kitchen", name: "Librarian's flat: kitchen", flat: true }], [3, { role: "bath", name: "Librarian's flat: bath", flat: true }])], ["*", { role: "bedroom", name: "Librarian's flat: bedroom", flat: true }]);
  const reading = R("dining", "readhall", { name: "Reading hall", type: "books", fl: "hardwood", hub: true, maxBoxes: 6 });
  const gallery = R("hall", "gallery", { name: "Gallery", type: "books", fl: "hardwood", hub: true, maxBoxes: 4 });
  const attic = R("storage", "libstore", { name: "Attic stacks", type: "books", fl: "wood", maxBoxes: 4 });
  let ground, upper;
  if (kind === "centre") {
    ground = X(["*", Y(["*", panelled("Panelled reading room")], ["*", R("office", "libstudy", { name: "Librarian's study", type: "office", fl: "hardwood", maxBoxes: 2 })])], hall(reading),
      ["*", Y(["*", panelled("Portrait room")], ["*", rare], [3, { role: "restroom" }])]);
    upper = (f, r, ctx) => (f === 1
      ? X(["*", Y(["*", panelled("Map room", { lib: "maproom", type: "libmaps", maxBoxes: 3 })], ["*", panelled("Study")])], upHall(gallery), ["*", ctx && ctx.top ? flat() : Y(["*", panelled("Music room")], ["*", panelled("Smoking room")])])
      : X(["*", Y(["*", attic], ["*", R("storage", "libstore", { name: "Box room", type: "books", maxBoxes: 2 })])], upHall(R("storage", "libstore", { name: "Attic stacks", type: "books", fl: "wood", maxBoxes: 4 })), ["*", flat()]));
  } else {
    ground = flipX(X(hall(reading), ["*", Y(["*", panelled("Panelled reading room")], ["*", rare], ["*", R("office", "libstudy", { name: "Librarian's study", type: "office", fl: "hardwood", maxBoxes: 2 })], [3, { role: "restroom" }])]), flip);
    upper = (f, r, ctx) => (f === 1
      ? flipX(X(upHall(gallery), ["*", ctx && ctx.top ? flat() : Y(["*", panelled("Map room", { lib: "maproom", type: "libmaps", maxBoxes: 3 })], ["*", panelled("Study")], ["*", panelled("Portrait room")])]), flip)
      : flipX(X(upHall(attic), ["*", flat()]), flip));
  }
  return {
    program: ground, upper,
    stairs: { roles: ["foyer", "hall"] },
    exits: [{ side: "back", roles: ["office", "restroom", "storage"], chance: 0.6, lock: 0.5 }],
  };
}

// ======================================================================================
// The variants, their pick, the spec
// ======================================================================================
/** The variants (each a size and its plans). */
export const LIBRARY_VARIANTS = Object.fromEntries(Object.entries(PLANS).map(([v, plans]) => [v, { size: LIBRARY.SIZE[v], plans: Object.keys(plans) }]));
export const LIBRARY_KEYS = Object.keys(PLANS);
// The footprint class (buildingmaps.js spec.foot, the tests' size classes) for an area.
function footOf(bw, bh) {
  const a = bw * bh;
  return a >= 1800 && bw >= 50 ? "huge" : a >= 700 ? "xl" : a > 360 ? "large" : a <= 190 ? "small" : "medium";
}
/**
 * Which variant (and plan) a library is: o.variant a variant ("county") or a variant and its plan ("county/hall"), else
 * a franchise of data-shops.js FRANCHISES.library (its plan.libs weights), else LIBRARY.ANY. Rolls the building's dice.
 * @param {any} rng @param {{ variant?: string | null, plan?: string | null }} [o] @returns {{ variant: string, plan: string }}
 */
export function libraryVariant(rng, o = {}) {
  const id = o.variant || null;
  // variantpick.js (issue #41): a weights table (a franchise's plan.libs, LIBRARY.ANY) walked as Rng.weighted walks it,
  // in the table's own order (pickFrom on its "library" entries); a variant's plan ("library:<variant>") by one draw.
  const pickW = (w) => {
    const e = pickFrom(Object.keys(w).filter((k) => PLANS[k] && w[k] > 0).map((k) => ({ ...variantFor("library", k), id: k, w: { any: w[k] } })), rng, { r: rng.next() }, { le: true });
    return e ? e.id : undefined; // none: the carnegie below, the draw still made, as before
  };
  let variant = null, plan = o.plan || null;
  if (id && id.includes("/")) [variant, plan] = id.split("/");
  else {
    const fr = id ? (FRANCHISES.library || []).find((f) => f.id === id) : null;
    if (fr && fr.plan && fr.plan.libs) variant = pickW(fr.plan.libs);
    else if (id && PLANS[id]) variant = id;
    else variant = pickW(LIBRARY.ANY);
  }
  if (!PLANS[variant]) variant = "carnegie";
  plan = /** @type {any} */ (pickVariant(`library:${variant}`, rng, { plan: plan && PLANS[variant][plan] ? plan : null, r: () => rng.next() })).id;
  return { variant, plan };
}
// The registry (variantpick.js): "library" (the thirteen variants, by LIBRARY.ANY's weights), "library:<variant>" (its
// plans, uniform).
registerVariants("library", Object.keys(PLANS).map((v) => ({ id: v, name: LIBRARY_NAMES[v] || v, w: { any: LIBRARY.ANY[v] || 0 } })));
for (const v of Object.keys(PLANS)) registerVariants(`library:${v}`, Object.keys(PLANS[v]).map((p) => ({ id: p, name: `${LIBRARY_NAMES[v] || v} (${p})` })));
/**
 * A library's spec for buildingmaps.js assemble: the variant's footprint, storeys and plan from the dice. o: { variant,
 * plan } as libraryVariant takes them; w, h: a footprint to fit (another building's room for one: a strip mall's unit, a
 * campus's library), else the variant's own size; storeys: a fixed count. The spec carries lib: { variant, plan }.
 * @param {any} rng @param {{ variant?: string | null, plan?: string | null, w?: number, h?: number, storeys?: number }} [o]
 */
export function libraryPlan(rng, o = {}) {
  const { variant, plan } = libraryVariant(rng, o);
  const S = LIBRARY.SIZE[variant];
  const bw = o.w || roll(rng, S.w), bh = o.h || roll(rng, S.h);
  const n = Math.max(1, Math.min(S.storeys[1], o.storeys || roll(rng, S.storeys)));
  const p = PLANS[variant][plan](rng, { bw, bh, n });
  return {
    bw, bh, front: { width: variant === "rural" || variant === "strip" ? 1 : 2 }, ground: variant === "rural" ? "rural" : variant === "central" ? "city" : "town",
    storeys: n, upper: n > 1 ? p.upper || null : null, foot: footOf(bw, bh), program: p.program, exits: p.exits || [], openDoors: variant === "modern" || variant === "strip" ? 0.3 : 0.1,
    ...(p.stairs ? { stairs: p.stairs } : {}), lib: { variant, plan }, vid: `${variant}/${plan}`, vname: LIBRARY_NAMES[variant] || "Library", real: true, // vid, vname: the plan's id and name (planname.js, issue #40) // real: drawn at its real size (buildingmaps.js realScale leaves it, every floor built: #24)
  };
}

// ======================================================================================
// The rooms (LIBRARY_STYLES, by the plan leaf's lib mark)
// ======================================================================================
/** @typedef {any} Lay */
const full = (L) => L.boxes() >= L.target();
const P = (L, o = {}) => ({ ...o, plain: full(L) });
// The cells along the room's wall inside it, either way.
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
// A piece of shelving that is not searched (the stock between the ones that are): blocked off the lanes.
const shelving = (L, x, y, k) => L.ok(x, y) && L.c.block(x, y, k);
// A spot that leaves every shelf an aisle (L.wall's avoid): the piece has a free cell beside it, and takes no shelf's
// last free side (two shelves meeting in a corner, a piece in front of a shelf).
const SHELVES = new Set(["bookstack", "lowshelf", "mobileshelf", "bookshelf", "cardcat", "mapcase", "displaycase"]);
const noStrand = (L) => (cells) => {
  const c = L.c, mine = new Set(cells.map(([x, y]) => `${x},${y}`));
  const openSide = (x, y) => D4.some(([dx, dy]) => !mine.has(`${x + dx},${y + dy}`) && L.inRoom(x + dx, y + dy) && (c.free(x + dx, y + dy) || L.lane(x + dx, y + dy)));
  if (!cells.some(([x, y]) => openSide(x, y))) return true;
  for (const [x, y] of cells) for (const [dx, dy] of D4) {
    const nx = x + dx, ny = y + dy;
    if (mine.has(`${nx},${ny}`) || !SHELVES.has(c.kindAt(nx, ny)) || !L.inRoom(nx, ny)) continue;
    if (!openSide(nx, ny)) return true;
  }
  return false;
};
// Pieces of k round the walls while any fits (bookshelves round a room), containers up to the room's share, the rest plain.
function wallRound(L, k, most = 40, opts = {}) {
  let n = 0;
  for (; n < most; n++) if (!L.wall(k, P(L, { avoid: noStrand(L), ...opts }))) break;
  return n;
}
// Up to n of k against the walls.
function some(L, k, n, opts = {}) { let m = 0; for (let i = 0; i < n; i++) if (L.wall(k, P(L, { avoid: noStrand(L), ...opts }))) m++; return m; }
/**
 * Rows of shelving with a one-cell aisle between them and round them (the stacks): a row every `step` cells from the
 * room's second row (or column) to its last but one, each run broken where a lane crosses and every STACK_GAP cells (a
 * cross aisle), so every shelf has an aisle beside it and every aisle joins the walk round the room. The ends of a run
 * and every `every` cells are containers of `box` while the room has its share to come, the rest `k` not searched.
 * axis "x": the rows run along x; "y": along y; o.pair: two rows back to back between the aisles (compact shelving).
 * @param {Lay} L
 */
function stackRows(L, o = {}) {
  const c = L.c, k = o.k || "bookstack", box = o.box || k, every = o.every || 4;
  const axis = o.axis || (c.w >= c.h ? "y" : "x");
  const along = axis === "x" ? c.w : c.h, across = axis === "x" ? c.h : c.w;
  const at = (a, b) => (axis === "x" ? [c.x0 + a, c.y0 + b] : [c.x0 + b, c.y0 + a]);
  const rows = [];
  for (let b = 1; b < across - 1; b += o.pair ? 3 : 2) { rows.push(b); if (o.pair && b + 1 < across - 1) rows.push(b + 1); }
  let cells = 0;
  for (const b of rows) {
    let seg = [];
    const flush = () => {
      seg.forEach(([x, y], i) => {
        const want = (i === 0 || i === seg.length - 1 || i % every === every - 1) && !full(L);
        if (want && L.place(box, [[x, y]], { face: axis === "x" ? "s" : "e" })) { cells++; return; }
        if (shelving(L, x, y, k)) cells++;
      });
      seg = [];
    };
    for (let a = 1; a < along - 1; a++) {
      const [x, y] = at(a, b);
      if (a % LIBRARY.STACK_GAP === 0 || !L.ok(x, y)) { flush(); continue; }
      seg.push([x, y]);
    }
    flush();
  }
  return cells;
}
// Reading tables (2 × 1) off the walls with chairs either side, up to n.
function readTables(L, n, chairs = 4, k = "readtable") {
  let m = 0;
  for (let i = 0; i < n; i++) { const t = L.centre(k); if (!t) break; L.around(t, "chair", chairs); m++; }
  return m;
}
// A table and chairs round it.
function tableSet(L, chairs = 4, k = "table") { const t = L.centre(k); if (t) L.around(t, "chair", chairs); return t; }
// A desk with its chair, against a wall (near: a point to be near).
function deskAt(L, opts = {}) { const d = L.wall("desk", P(L, opts)); if (d) L.around(d, "chair", 1); return d; }
// The room's door cells (inside: the cell in front of each).
function doorFronts(L) {
  const c = L.c, out = [];
  for (const [dx, dy] of L.room.doors || []) for (const [ex, ey] of D4) if (L.inRoom(dx + ex, dy + ey)) out.push([dx + ex, dy + ey]);
  return out;
}
const frontDoor = (L) => { const fr = doorFronts(L); return fr.length ? fr.sort((a, b) => b[1] - a[1])[0] : null; };
// A story-time rug (decor.js's rug, its colours bright) on an open patch of the floor, beanbags round it.
function storyRug(L, bags = 3) {
  const c = L.c, rw = Math.min(4, c.w - 2), rh = Math.min(3, c.h - 2);
  if (rw < 2 || rh < 2) return 0;
  let best = null, bd = Infinity;
  const mx = (c.x0 + c.x1) / 2, my = (c.y0 + c.y1) / 2;
  for (let y = c.y0 + 1; y + rh - 1 <= c.y1 - 1; y++) for (let x = c.x0 + 1; x + rw - 1 <= c.x1 - 1; x++) {
    let ok = true;
    for (let yy = y; yy < y + rh && ok; yy++) for (let xx = x; xx < x + rw; xx++) if (!c.free(xx, yy)) { ok = false; break; }
    if (!ok) continue;
    const d = Math.hypot(x + rw / 2 - mx, y + rh / 2 - my) + hash01(c.seed, "rug", L.room.id, x, y) * 0.5;
    if (d < bd) { bd = d; best = [x, y]; }
  }
  if (!best) return 0;
  const [rx, ry] = best, v = 3 + L.variant(3, "rugv");
  for (let y = ry; y < ry + rh; y++) for (let x = rx; x < rx + rw; x++) {
    const e = (y === ry ? 1 : 0) | (y === ry + rh - 1 ? 2 : 0) | (x === rx ? 4 : 0) | (x === rx + rw - 1 ? 8 : 0);
    c.cell(x, y).deco = { k: "rug", v, e, story: true };
  }
  let n = 0;
  for (const [x, y] of [[rx - 1, ry + 1], [rx + rw, ry + 1], [rx + 1, ry - 1], [rx + 2, ry + rh]]) if (n < bags && L.place("beanbag", [[x, y]])) n++;
  return n;
}
// The well of a gallery: the floor cut away over the hall below (galleryvoid) inside a walkway of LIBRARY.WELL cells, a
// railing round it; never the stairs or a cell beside them, never a door's front (block's guard keeps every walkable
// cell joined: where the well would cut the walkway it stays floor).
function well(L) {
  const c = L.c, m = LIBRARY.WELL;
  const x0 = c.x0 + m, x1 = c.x1 - m, y0 = c.y0 + m, y1 = c.y1 - m;
  if (x1 - x0 < 2 || y1 - y0 < 2) return 0;
  const nearStairs = (x, y) => { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const k = c.kindAt(x + dx, y + dy); if (k === "stairs" || k === "ladder") return true; } return false; };
  const fronts = new Set(doorFronts(L).map(([x, y]) => `${x},${y}`));
  let n = 0;
  for (let y = y0 + 1; y <= y1 - 1; y++) for (let x = x0 + 1; x <= x1 - 1; x++) if (!nearStairs(x, y) && !fronts.has(`${x},${y}`) && c.free(x, y) && c.block(x, y, "galleryvoid")) n++;
  if (!n) return 0;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!(x === x0 || x === x1 || y === y0 || y === y1) || nearStairs(x, y) || fronts.has(`${x},${y}`)) continue;
    if (!D4.concat([[1, 1], [1, -1], [-1, 1], [-1, -1]]).some(([dx, dy]) => c.kindAt(x + dx, y + dy) === "galleryvoid")) continue;
    if (c.free(x, y)) c.block(x, y, "railing");
  }
  return n;
}
// The lift bank: two lift doors side by side against a wall (the lifts are dead without power).
function liftBank(L) {
  const a = L.wall("liftdoor", { prefer: "middle" });
  if (a) L.beside(a, "liftdoor");
  return a;
}
// A counter run with its till by the door (a circulation desk): n counters along the wall nearest the front door, else
// off the walls in a row.
function circDesk(L, n = 3) {
  const d = frontDoor(L);
  const near = d ? [d[0], d[1] - 2] : null;
  const first = L.wall("counter", P(L, { prefer: "middle", ...(near ? { near } : {}) })) || L.centre("counter", P(L, near ? { near } : {}));
  let last = first;
  for (let i = 1; i < n && last; i++) last = L.beside(last, "counter", P(L)) || last;
  if (first) L.around(first, "chair", 1);
  return first;
}
// The book return by the front door, inside.
function bookDrop(L) { const d = frontDoor(L); return d ? L.wall("bookreturn", P(L, { near: d })) : L.wall("bookreturn", P(L)); }

export const LIBRARY_STYLES = {
  // ---------- the rural reading room ----------
  oneroom(L) {
    const d = frontDoor(L);
    deskAt(L, d ? { near: d } : {}) || L.need("desk");
    L.wall("woodstove", { prefer: "corner" }) || L.need("woodstove");
    readTables(L, 1, 4) || tableSet(L, 4);
    some(L, "lowshelf", 2, { prefer: "corner" });
    if (L.room.kids) storyRug(L, 2); // the schoolroom's children's corner
    wallRound(L, "bookshelf", 30);
  },
  porch(L) { L.wall("cardcat", P(L, { prefer: "corner" })); },
  craft(L) {
    for (let i = 0; i < 3; i++) if (!tableSet(L, 4)) break;
    L.wall("sink", { prefer: "corner" });
    L.fill(["cabinet", "shelf"]);
  },
  puppet(L) {
    // The puppet stage (a lectern as its booth) on the far wall, beanbags in rows before it.
    const c = L.c, d = doorFronts(L)[0], side = !d ? "n" : d[1] > (c.y0 + c.y1) / 2 ? "n" : "s";
    L.wall("lectern", { sides: [side], prefer: "middle" }) || L.need("lectern");
    for (let r = 2; r < c.h - 1; r += 2) for (let a = 1; a < c.w - 1; a += 2) L.place("beanbag", [[c.x0 + a, side === "n" ? c.y0 + r : c.y1 - r]], { face: side });
  },
  kidshall(L) {
    circDesk(L, 2);
    bookDrop(L);
    storyRug(L, 4);
    for (let i = 0; i < 2; i++) tableSet(L, 3);
    stackRows(L, { k: "lowshelf", every: 3 });
  },
  lawread(L) {
    for (let i = 0; i < 10; i++) { const p = L.wall("carrel"); if (!p) break; L.around(p, "chair", 1); }
    readTables(L, Math.max(1, Math.floor((L.c.w * L.c.h) / 24)), 4);
    for (let i = 0; i < 2; i++) { const p = L.wall("computer", P(L)); if (p) L.around(p, "chair", 1); }
    wallRound(L, "bookshelf", 12);
  },
  exhibit(L) {
    for (let i = 0; i < 6; i++) if (!L.wall("displaycase", { prefer: "middle" })) break;
    for (let i = 0; i < 2; i++) L.centre("displaycase", { plain: true });
    if (!L.has("displaycase")) L.need("displaycase", { plain: true });
    L.wall("cardcat", P(L, { prefer: "corner" }));
    L.fill(["bookshelf"]);
  },
  libstore(L) { L.wall("booktruck", P(L)); L.fill(["shelf", "crate", "bookshelf"]); },
  kidsnook(L) { storyRug(L, 2); wallRound(L, "lowshelf", 10); tableSet(L, 2); },
  // ---------- the Carnegie ----------
  rotunda(L) {
    // The circulation desk in a ring under the dome: counters round the room's middle, a gap toward the door.
    const c = L.c, cx = Math.floor((c.x0 + c.x1) / 2), cy = Math.floor((c.y0 + c.y1) / 2);
    for (const [dx, dy] of [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]]) L.place("counter", [[cx + dx, cy + dy]], P(L, { face: dy > 0 ? "s" : dy < 0 ? "n" : dx > 0 ? "e" : "w" }));
    L.place("chair", [[cx, cy]], { face: "s" });
    if (!L.has("counter")) circDesk(L, 3); // the stairs or the ways through take the middle: a desk by the door instead
    if (!some(L, "cardcat", 4, { prefer: "corner" })) L.need("cardcat", P(L));
    L.wall("globe", { prefer: "corner" }) || L.centre("globe");
    bookDrop(L);
  },
  stacks(L) { stackRows(L, { k: "bookstack", every: 4 }); },
  lowstacks(L) { stackRows(L, { k: "lowshelf", every: 3 }); },
  readroom(L) {
    readTables(L, Math.max(1, Math.floor((L.c.w * L.c.h) / 16)), 4);
    some(L, "armchair", 2, { prefer: "corner" });
    wallRound(L, "bookshelf", 16);
  },
  refroom(L) {
    some(L, "cardcat", 2, { prefer: "corner" });
    L.wall("microfilm", P(L, { prefer: "corner" }));
    readTables(L, Math.max(1, Math.floor((L.c.w * L.c.h) / 20)), 4);
    wallRound(L, "bookshelf", 20);
  },
  children(L) {
    storyRug(L, 3);
    for (let i = 0; i < 2; i++) tableSet(L, 3);
    wallRound(L, "lowshelf", 16);
  },
  kidsarea(L) { LIBRARY_STYLES.children(L); L.wall("computer", P(L, { prefer: "corner", avoid: noStrand(L) })); },
  meeting(L) {
    const t = L.centre("readtable") || L.centre("table");
    if (t) L.around(t, "chair", 6);
    L.wall("lectern", { prefer: "middle" });
    L.fill(["cabinet"]);
  },
  workroom(L) {
    deskAt(L, { prefer: "corner" });
    L.wall("copier", { prefer: "corner" });
    L.wall("booktruck", P(L));
    L.fill(["shelf", "cabinet", "filing"]);
  },
  liboffice(L) {
    deskAt(L, { prefer: "corner" }) || L.need("desk");
    deskAt(L, { prefer: "corner" });
    L.wall("bookshelf", P(L, { prefer: "corner" }));
    L.fill(["filing", "cabinet"]);
  },
  staffroom(L) {
    const ws = L.walls();
    L.run(["fridge", "counter", "sink", "microwave", "counter"], ws.length ? [ws[0].side] : ["n"], { plain: () => full(L) });
    L.wall("medcab", P(L, { prefer: "corner" })) || L.need("medcab", P(L));
    tableSet(L, 4);
    L.fill(["cabinet"]);
  },
  upperhall(L) { L.wall("globe", { prefer: "corner" }); L.wall("armchair", { prefer: "corner" }); },
  stackaisle(L) { L.wall("cardcat", P(L, { prefer: "corner" })); L.wall("booktruck", P(L)); },
  localhist(L) {
    some(L, "microfilm", 2, { prefer: "corner" });
    L.wall("cardcat", P(L, { prefer: "corner" }));
    readTables(L, 1, 4);
    wallRound(L, "bookshelf", 14);
  },
  // ---------- the modern branch ----------
  openhall(L) {
    circDesk(L, 3);
    const d = frontDoor(L);
    for (let i = 0; i < 2; i++) L.wall("selfcheck", d ? { near: d } : {});
    bookDrop(L);
    // Low shelving in rows over the back of the hall, a reading corner of armchairs at the front.
    stackRows(L, { k: "lowshelf", every: 3 });
    some(L, "armchair", 2, { prefer: "corner" });
  },
  teen(L) {
    L.wall("sofa", { prefer: "middle" });
    some(L, "beanbag", 2, { prefer: "corner" });
    some(L, "computer", 2, { prefer: "corner" });
    wallRound(L, "lowshelf", 6);
  },
  compbank(L) {
    for (let i = 0; i < 12; i++) { const p = L.wall("computer", P(L)); if (!p) break; L.around(p, "chair", 1); }
    for (let i = 0; i < 4; i++) { const p = L.centre("computer", P(L)); if (!p) break; L.around(p, "chair", 1); }
    if (!L.has("computer")) L.need("computer");
    L.wall("printer", P(L, { prefer: "corner" }));
  },
  studyroom(L) { tableSet(L, 4) || L.wall("carrel"); L.wall("whiteboard", { prefer: "middle" }); },
  carrels(L) { for (let i = 0; i < 16; i++) { const p = L.wall("carrel"); if (!p) break; L.around(p, "chair", 1); } L.fill(["bookshelf"]); },
  // ---------- the county library ----------
  circdesk(L) {
    circDesk(L, 4);
    const d = frontDoor(L);
    L.wall("selfcheck", d ? { near: d } : {});
    bookDrop(L);
    some(L, "cardcat", 2, { prefer: "corner" });
    some(L, "lowshelf", 4);
  },
  techserv(L) {
    // The book-processing area: a counter run along the longest wall, book carts, shelves and crates of new stock.
    const ws = L.walls();
    L.run(["counter", "counter", "counter", "counter"], ws.length ? [ws[0].side] : ["n"], { plain: () => full(L) });
    for (let i = 0; i < 3; i++) L.centre("booktruck", P(L));
    deskAt(L, { prefer: "corner" });
    L.fill(["shelf", "crate"]);
  },
  genealogy(L) {
    stackRows(L, { k: "mobileshelf", every: 4, pair: true });
    L.wall("microfilm", P(L, { prefer: "corner" }));
  },
  // ---------- the central library ----------
  atrium(L) {
    liftBank(L);
    circDesk(L, 4);
    const d = frontDoor(L);
    for (let i = 0; i < 2; i++) L.wall("selfcheck", d ? { near: d } : {});
    bookDrop(L);
    some(L, "sofa", 2, { prefer: "corner" });
  },
  atriumgal(L) { liftBank(L); well(L); },
  stairwell(L) { L.wall("liftdoor", { prefer: "corner" }); },
  grandread(L) {
    // Long tables in rows down the room, chairs both sides, the green lamps on them (the reading table's drawing);
    // shelves of reference books round the walls, the card catalogue by the door, a globe.
    const c = L.c, along = c.w >= c.h;
    const step = 4;
    for (let b = 2; b < (along ? c.h : c.w) - 2; b += step) for (let a = 2; a + 1 < (along ? c.w : c.h) - 2; a += 3) {
      const cells = along ? [[c.x0 + a, c.y0 + b], [c.x0 + a + 1, c.y0 + b]] : [[c.x0 + b, c.y0 + a], [c.x0 + b, c.y0 + a + 1]];
      const t = L.place("readtable", cells, { face: along ? "s" : "e" });
      if (t) L.around(t, "chair", 4);
    }
    if (!L.has("readtable")) L.need("readtable");
    const d = frontDoor(L) || (doorFronts(L)[0] || null);
    some(L, "cardcat", 2, d ? { near: d } : {});
    L.wall("globe", { prefer: "corner" });
    wallRound(L, "bookshelf", 40);
  },
  periodicals(L) {
    some(L, "armchair", 4, { prefer: "corner" });
    for (let i = 0; i < 2; i++) tableSet(L, 4);
    wallRound(L, "lowshelf", 24);
  },
  closedstacks(L) { stackRows(L, { k: "mobileshelf", every: 4, pair: true }); },
  rarebooks(L) {
    for (let i = 0; i < 8; i++) if (!L.wall("displaycase", P(L))) break;
    if (!L.has("displaycase")) L.need("displaycase");
    readTables(L, 1, 2);
    wallRound(L, "bookshelf", 12);
  },
  maproom(L) {
    for (let i = 0; i < 4; i++) if (!L.wall("mapcase", P(L))) break;
    if (!L.has("mapcase")) L.need("mapcase", P(L));
    L.centre("maptable");
    L.wall("globe", { prefer: "corner" }) || L.centre("globe");
    L.fill(["mapcase", "bookshelf"]);
  },
  media(L) {
    for (let i = 0; i < 6; i++) { const p = L.wall("computer", P(L)); if (!p) break; L.around(p, "chair", 1); }
    if (!L.has("computer")) L.need("computer");
    some(L, "armchair", 2, { prefer: "corner" });
    wallRound(L, "lowshelf", 10);
  },
  cafe(L) {
    const ws = L.walls();
    L.run(["counter", "coldcase", "counter", "counter"], ws.length ? [ws[0].side] : ["n"], { plain: () => full(L) });
    for (let i = 0; i < 6; i++) if (!tableSet(L, 2)) break;
    L.fill(["shelf", "cabinet"]);
  },
  auditorium(L) {
    // The lectern on the wall opposite the doors, rows of seats facing it with an aisle down the middle and round the sides.
    const c = L.c, d = doorFronts(L)[0], side = !d ? "n" : c.h >= c.w ? (d[1] > (c.y0 + c.y1) / 2 ? "n" : "s") : (d[0] > (c.x0 + c.x1) / 2 ? "w" : "e");
    L.wall("lectern", { sides: [side], prefer: "middle" }) || L.need("lectern");
    const ns = side === "n" || side === "s", len = ns ? c.w : c.h, depth = ns ? c.h : c.w, mid = Math.floor(len / 2);
    for (let r = 3; r < depth - 1; r += 2) for (let a = 1; a < len - 1; a++) {
      if (Math.abs(a - mid) < 1) continue; // the centre aisle
      const x = ns ? c.x0 + a : side === "w" ? c.x0 + r : c.x1 - r, y = ns ? (side === "n" ? c.y0 + r : c.y1 - r) : c.y0 + a;
      L.place("audseat", [[x, y]], { face: side });
    }
  },
  // ---------- the historic library ----------
  entryhall(L) { L.wall("cardcat", P(L, { prefer: "corner" })); L.wall("globe", { prefer: "corner" }); },
  readhall(L) {
    L.wall("fireplace", { prefer: "middle" });
    readTables(L, Math.max(1, Math.floor((L.c.w * L.c.h) / 24)), 4);
    some(L, "armchair", 2, { prefer: "corner" });
    wallRound(L, "bookshelf", 30);
  },
  gallery(L) { well(L); wallRound(L, "bookshelf", 30); },
  panelled(L) {
    L.wall("fireplace", { prefer: "middle" });
    const a = L.wall("armchair", { prefer: "corner" });
    if (a) L.wall("armchair", { near: a.cells[0] });
    readTables(L, 1, 2) || tableSet(L, 2);
    L.wall("globe", { prefer: "corner" });
    wallRound(L, "bookshelf", 14);
  },
  libstudy(L) {
    deskAt(L, { prefer: "middle" }) || L.need("desk");
    L.wall("fireplace", { prefer: "middle" });
    L.wall("armchair", { prefer: "corner" });
    L.fill(["bookshelf", "filing"]);
  },
  // ---------- the bookmobile depot ----------
  bmgarage(L) {
    vehicleIn(L, { kind: "truck", len: 4, body: "bookmobile", box: "bookmobile" });
    L.wall("toolchest", P(L, { prefer: "corner" }));
    L.fill(["shelf", "crate"]);
  },
  sorting(L) {
    for (let i = 0; i < 2; i++) tableSet(L, 2);
    for (let i = 0; i < 3; i++) L.wall("booktruck", P(L));
    L.fill(["shelf", "crate", "bookshelf"]);
  },
  bmoffice(L) { deskAt(L, { prefer: "corner" }) || L.need("desk"); L.fill(["filing", "cabinet"]); },
  // ---------- the strip-mall library ----------
  stripfront(L) {
    circDesk(L, 2);
    const d = frontDoor(L);
    L.wall("selfcheck", d ? { near: d } : {});
    bookDrop(L);
    stackRows(L, { k: "lowshelf", every: 3 });
  },
};
// The library style for a room (buildingmaps.js assemble): its plan leaf's lib mark. null: none.
/** @param {any} room */
export function libraryStyle(room) {
  const style = room && room.lib && LIBRARY_STYLES[room.lib];
  return style ? (L) => { style(L); keepAisles(L); } : null;
}
// After a room's style: each shelf's aisle kept clear (a free cell beside it held, as the lanes are), so decor.js's
// plants and lamps never box a shelf in.
function keepAisles(L) {
  const c = L.c;
  for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) {
    if (!SHELVES.has(c.kindAt(x, y)) || !L.inRoom(x, y)) continue;
    const side = D4.map(([dx, dy]) => [x + dx, y + dy]).filter(([nx, ny]) => L.inRoom(nx, ny));
    if (side.some(([nx, ny]) => L.lane(nx, ny))) continue;
    const open = side.find(([nx, ny]) => c.free(nx, ny));
    if (open) c.keep(open[0], open[1]);
  }
}

// ======================================================================================
// The libraries' signs of survival (interiorscenes.js registerScene; their own dice there, only on a library laid out by
// these plans: when):
//   readers    readers barricaded in the stacks: book carts and shelving shoved across the aisles at the stacks' door,
//              the readers who held out behind them (dead, or alive upstairs: area.scene.alive), the dead in front;
//   shelter    the library used as a shelter: cots in rows in a reading room, a soup kitchen in the meeting room or the
//              café (a stove, a water barrel, tins on the floor), the ones who never left;
//   sealed     the archive sealed: the closed stacks', the genealogy archive's or the rare-books room's door locked
//              steel, someone shut in with the books;
//   notice     the librarian's last notice on the circulation desk (papers on it; the note you read when you see the room).
// ======================================================================================
const NEXT4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const libRooms = (ctx, marks) => ctx.rng.shuffle(ctx.rooms.filter((r) => marks.includes(r.lib) && !r.scene && !r.locked));
const nearest = (cells, x, y) => cells.slice().sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
const lower = (r) => String(r.name || "room").replace(/ \d+$/, "").replace(/^Stacks: /, "stacks: ").toLowerCase();
function readers(ctx) {
  const { rng } = ctx;
  for (const r of libRooms(ctx, ["stacks", "lowstacks", "closedstacks"])) {
    const f = r.f || 0, ds = r.doors || [];
    if (!ds.length) continue;
    const [dx, dy] = ds[0];
    const free = ctx.freeIn(r), near = nearest(free, dx, dy).filter(([x, y]) => Math.abs(x - dx) + Math.abs(y - dy) <= 3);
    if (near.length < 2 || free.length < 6) continue;
    // Across the aisles by the door: book carts and shelving shoved in, half cover (crawled over, vaulted).
    for (const [x, y] of near.slice(0, rng.int(2, 3))) ctx.piece(f, x, y, rng.pick(["booktruck", "lowshelf", "chair", "table"]));
    const behind = nearest(ctx.freeIn(r), dx, dy).reverse();
    if (f && rng.chance(SCENES.ALIVE)) return ctx.done("readers", r, dx, dy, `Book carts and shelving shoved across the aisles of the ${lower(r)}: someone is still holding out behind them.`, { alive: true });
    const n = Math.min(behind.length, rng.int(1, 3));
    for (const [x, y] of behind.slice(0, n)) { ctx.body(f, x, y, { human: true }); ctx.splatter(f, x, y, "human", 1); }
    const front = ctx.freeIn(r).length ? nearest(ctx.freeIn(r), dx, dy).slice(0, rng.int(1, 3)) : [];
    for (const [x, y] of front) { ctx.body(f, x, y, {}); ctx.blood(f, x, y, "zombie", 1); }
    return ctx.done("readers", r, dx, dy, `Readers barricaded themselves in the ${lower(r)}: book carts and shelving across the aisles, ${n} of them behind it${front.length ? `, ${front.length} of the dead in front` : ""}.`);
  }
  return null;
}
function shelter(ctx) {
  const { rng } = ctx;
  const halls = libRooms(ctx, ["readroom", "grandread", "periodicals", "readhall", "oneroom"]);
  for (const r of halls) {
    const f = r.f || 0, free = rng.shuffle(ctx.freeIn(r));
    if (free.length < 8) continue;
    const cots = Math.min(free.length - 2, rng.int(LIBRARY.SHELTER_COTS[0], LIBRARY.SHELTER_COTS[1]));
    for (const [x, y] of free.slice(0, cots)) ctx.piece(f, x, y, "cot");
    const left = free.slice(cots);
    const dead = rng.int(0, 2);
    for (const [x, y] of left.slice(0, dead)) ctx.body(f, x, y, { human: true, quiet: true });
    // The soup kitchen: the meeting room or the café on the same floor (else this room's far end).
    const k = ctx.rooms.find((q) => (q.f || 0) === f && ["meeting", "cafe"].includes(q.lib) && !q.scene && !q.locked);
    const kf = k ? ctx.freeIn(k) : left.slice(dead);
    if (kf.length >= 3) {
      const [sx, sy] = kf[0];
      ctx.piece(f, sx, sy, "woodstove");
      ctx.piece(f, kf[1][0], kf[1][1], "barrel");
      for (const [x, y] of kf.slice(2, 5)) { const c = ctx.at(f, x, y); if (c && c.k === "open") c.deco = { k: "tins", v: 0 }; }
    }
    const [cx, cy] = free[0];
    return ctx.done("libshelter", r, cx, cy, `The ${lower(r)} was a shelter: ${cots} cots in rows${k ? `, a soup kitchen in the ${lower(k)}` : ""}${dead ? `, and ${dead} who never left` : ""}.`);
  }
  return null;
}
function sealedArchive(ctx) {
  const { rng } = ctx;
  for (const r of libRooms(ctx, ["closedstacks", "genealogy", "rarebooks"])) {
    const f = r.f || 0, ds = r.doors || [];
    if (ds.length !== 1) continue;
    const [dx, dy] = ds[0], door = ctx.at(f, dx, dy);
    if (!door || !["idoor", "odoor"].includes(door.k)) continue;
    const free = ctx.inner(r).filter(([x, y]) => { const c = ctx.at(f, x, y); return c && c.k === "open" && !ctx.stair(x, y) && !ctx.used(f, x, y); }); // the shelving's aisles (beside the containers too)
    if (!free.length) continue;
    door.k = "door"; door.dk = "steel"; door.hp = door.mhp = 160; // a locked steel door (buildingmaps.js BMAP.DOOR.locked)
    ctx.take(f, dx, dy);
    if (ctx.map.lockedDoors) ctx.map.lockedDoors.push({ x: dx, y: dy, f, area: r.id, kind: "door", dk: "steel" });
    if (f && rng.chance(SCENES.ALIVE)) return ctx.done("archivesealed", r, dx, dy, `The ${lower(r)} is sealed from inside: someone is still in there with the books.`, { alive: true });
    const [x, y] = nearest(free, r.x0 + r.w / 2, r.y0 + r.h / 2)[0];
    ctx.body(f, x, y, { human: true, quiet: true, name: "The archivist" });
    return ctx.done("archivesealed", r, dx, dy, `The ${lower(r)} sealed from inside: the archivist shut themselves in with the books and never came out.`);
  }
  return null;
}
function lastNotice(ctx) {
  for (const r of libRooms(ctx, ["rotunda", "openhall", "circdesk", "atrium", "stripfront", "oneroom", "bmoffice"])) {
    const f = r.f || 0;
    const desk = ctx.inner(r).find(([x, y]) => ["counter", "desk"].includes((ctx.at(f, x, y) || {}).k));
    if (!desk) continue;
    const near = NEXT4.map(([dx, dy]) => [desk[0] + dx, desk[1] + dy]).find(([x, y]) => ctx.free(f, x, y));
    if (near) { const c = ctx.at(f, near[0], near[1]); c.deco = { k: "papers", v: 0 }; ctx.take(f, near[0], near[1]); }
    const lines = [
      "LIBRARY CLOSED UNTIL FURTHER NOTICE. All loans extended. Please return books when it is safe. — The Librarian",
      "We are sheltering in the reading room. Knock three times. Do not bring anyone who has been bitten.",
      "Gone to the county shelter with the children's group. Take what you need, but please, not the books.",
      "No more room. Fines are waived. God keep you all.",
    ];
    return ctx.done("lastnotice", r, desk[0], desk[1], `A notice taped to the circulation desk, in the librarian's hand: "${ctx.rng.pick(lines)}"`);
  }
  return null;
}
// Only on a library laid out by these plans (when).
const isLibraryMap = (ctx) => ctx.rooms.some((r) => !!r.lib);
registerScene("readers", { w: 4, place: readers, kinds: ["library"], when: isLibraryMap });
registerScene("libshelter", { w: 3, place: shelter, kinds: ["library"], when: isLibraryMap });
registerScene("archivesealed", { w: 3, place: sealedArchive, kinds: ["library"], when: isLibraryMap });
registerScene("lastnotice", { w: 4, place: lastNotice, kinds: ["library"], when: isLibraryMap });
