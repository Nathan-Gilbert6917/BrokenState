// @ts-check
// Museums (the user's request 2026-10-26, "museum": issue #58 of the round-2 epic #39). A building type of its own,
// `museum`, with thirteen variants, each with two plans of its own: from a local history museum in an old house to a
// city centre's natural history museum of three storeys. Their plans (MUSEUM_PLANS; museumPlan: buildingmaps.js
// BUILDINGS.museum), their rooms furnished for their kind on roomlayout.js's placement helpers (MUSEUM_STYLES, by the plan
// leaf's mus mark: lanes kept clear, backs to the walls, the lootable pieces the containers), the variants registered with
// the shared picker (variantpick.js, #41) and their signs of survival (interiorscenes.js registerScene).
//
// The variants (sizes from data-buildingsize.js REAL_SIZE.museum.sizes, a row a variant, a cell a metre, outer walls
// included; storeys from the row; the size class by #42's sizeClassOf on the row's middle):
//   art          an art museum (huge): galleries round an atrium or a sculpture court, the gift shop, the café, the
//                conservation lab, the loading dock, archives and storage, security, offices.
//   natural      a natural history museum (huge): the dinosaur hall (skeletons on their mounts), halls of mammals, birds,
//                minerals and fossils, a discovery room, the café and the gift shop, the collection stores.
//   science      a science centre (large): hands-on halls, the planetarium, a maker lab, classrooms, the café.
//   military     a military museum (large): the vehicle hall (Humvees, Army trucks, an MRAP, field guns: deactivated), the
//                galleries of arms and uniforms in their cases, the arms vault (a working antique or two locked away).
//   localhist    a local history museum in an old house (small): period rooms (the parlour, the kitchen, the bedroom), the
//                exhibit room, the archive upstairs.
//   county       a county or regional museum (small): one or two exhibit halls, a reading room, the store.
//   children     a children's museum (medium): play halls (climbing frames), a water and sand room, a craft room, a
//                little theatre.
//   aviation     an aviation museum (large): hangars of aircraft (a fighter, a helicopter, a transport), the gallery, the
//                restoration shop.
//   car          a car museum (medium): showroom halls of cars, the restoration garage, the gift shop.
//   railway      a railway museum (medium): the engine shed (handcars and a rail bus on the tracks), the station building
//                (the ticket office, the waiting room), the workshop.
//   maritime     a maritime museum (medium): the boat hall, ship models in their cases, the navigation gallery, the
//                lighthouse lens room.
//   presidential a presidential library (large): the replica Oval Office, the galleries, the research room and the
//                archive stacks, the auditorium.
//   wax          a wax museum (medium): rooms of wax figures behind rope barriers, the photo studio.
// Which variant (museumVariant): o.plan pins one ("art" or "art/atrium"; o.variant too); else the picker reads the
// setting (museumSetting: a city centre's tile class, the coast, a suburb or a highway; else the layouts' rural / town /
// city): the big ones in and next to city centres, the small ones in towns.
// Loot (combat.js AREAS from data-museums.js MUSEUM_AREAS; BOX_LOOT for the exhibit vehicles): curiosities in the
// galleries' cases (coins, stamps, a watch, pearls, silver), the gift shop's snacks, books and bags, the café's food and
// coffee, the conservation lab's chemicals and tools, the archives' and stores' crates, the dock's timber and tools,
// security's torches and radios; the military museum's arms vault is locked and its cases (locks.js "relic") now and then
// hold a working antique: a revolver, a lever-action rifle, a single-barrel shotgun, a sabre. The liftable art (a
// sculpture, a framed painting, a marble bust, an antique vase, a suit of armour, a ship model) is worth carrying home
// (data-furniture.js FURNITURE_VALUE).
// Older saves: no older save had a museum (buildingmaps.js NEW_KEYS), and only a new world places one (placement.js).
import { registerVariants, pickVariant } from "./variantpick.js"; // the shared picker (issue #41)
import { registerScene, SCENES } from "./interiorscenes.js";
import { REAL_SIZE } from "./data-buildingsize.js";

export const MUSEUM = {
  // Each variant's weight by setting (museumSetting): the big ones by a city's centre, the small ones in towns.
  W: {
    art:          { centre: 3, city: 1, suburb: 0.2, any: 0.1 },
    natural:      { centre: 3, city: 0.5, any: 0.05 },
    science:      { centre: 1.5, city: 2, suburb: 0.8, any: 0.1 },
    military:     { centre: 0.8, city: 1.5, suburb: 0.6, town: 0.3, highway: 0.6, any: 0.1 },
    localhist:    { centre: 0, town: 3, rural: 2, coast: 1, suburb: 0.4, any: 0.5 },
    county:       { centre: 0, town: 2, rural: 1, coast: 0.5, suburb: 0.6, highway: 0.3, any: 0.5 },
    children:     { centre: 0.6, city: 1.2, suburb: 1.5, town: 0.8, any: 0.2 },
    aviation:     { centre: 0.3, city: 1, suburb: 0.8, highway: 1.2, rural: 0.3, any: 0.1 },
    car:          { centre: 0.1, city: 1, suburb: 1, town: 0.6, highway: 1, rural: 0.2, any: 0.2 },
    railway:      { centre: 0.1, city: 0.6, suburb: 0.8, town: 0.8, highway: 0.6, rural: 0.5, any: 0.2 },
    maritime:     { city: 0.8, coast: 3, town: 0.4, any: 0.1 },
    presidential: { centre: 1, city: 0.6, suburb: 0.3, any: 0.05 },
    wax:          { centre: 0.6, city: 1, suburb: 0.5, town: 0.6, highway: 0.3, any: 0.2 },
  },
  SHELTER_COTS: [4, 9],     // the gallery used as a shelter (the scene)
  RELIC: ["relic", 0.85],   // the military museum's arms vault: its cases locked this often (locks.js LOCKS.relic)
  SHOWCASE: ["showcase", 0.3], // a gallery's cases of valuables (locks.js LOCKS.showcase)
};

// Each variant's name (spec.vname; spec.vid "<variant>/<plan>": planname.js, issue #40).
export const MUSEUM_NAMES = {
  art: "Art museum", natural: "Natural history museum", science: "Science centre", military: "Military museum",
  localhist: "Local history museum", county: "County museum", children: "Children's museum", aviation: "Aviation museum",
  car: "Car museum", railway: "Railway museum", maritime: "Maritime museum", presidential: "Presidential library", wax: "Wax museum",
};
const X = (...parts) => ({ split: "x", parts });
const Y = (...parts) => ({ split: "y", parts });
// A room: its role (buildingmaps.js ROLES), its style's mus mark, its overrides (name, type, maxBoxes, entry, hub...).
const R = (role, mus, o = {}) => ({ role, mus, ...o });
const RR = ["*", { role: "restroom" }];
const rest = (w = 2) => [w, { role: "restroom" }];
const flipX = (node, on) => (on && node.split === "x" ? { ...node, parts: node.parts.slice().reverse() } : node);

// The rooms most museums share.
const gallery = (name, o = {}) => R("dining", "gallery", { name, type: "musgallery", fl: "hardwood", hub: true, maxBoxes: 4, boxLock: MUSEUM.SHOWCASE, ...o }); // its cases locked now and then (locks.js showcase)
const atrium = (name = "Atrium", o = {}) => R("foyer", "atrium", { name, type: "musgallery", entry: true, hub: true, fl: "tile", maxBoxes: 2, ...o });
const giftshop = (name = "Gift shop", o = {}) => R("sales", "giftshop", { name, type: "musgift", hub: false, fl: "tile", maxBoxes: 6, ...o });
const cafe = (name = "Café") => R("cafeteria", "muscafe", { name, type: "muscafe", hub: false, maxBoxes: 3 });
const lab = (name = "Conservation lab") => R("lab", "conslab", { name, type: "muslab", maxBoxes: 4 });
const store = (name = "Collection store", o = {}) => R("storage", "musstore", { name, type: "musstore", maxBoxes: 5, ...o });
const archive = (name = "Archives") => R("storage", "archive", { name, type: "musstore", fl: "conc", maxBoxes: 6 });
const dock = (name = "Loading dock") => R("storage", "musdock", { name, type: "musdock", fl: "conc", maxBoxes: 4 });
const security = (name = "Security") => R("office", "mussec", { name, type: "mussec", maxBoxes: 3 });
const office = (name = "Offices") => R("office", "musoffice", { name, type: "office", fl: "carpet", maxBoxes: 2 });
const staffroom = (name = "Staff room") => R("breakroom", "musstaff", { name, type: "libstaff", maxBoxes: 2 });
const hall = (name = "Hall", o = {}) => R("hall", "mushall", { name, hub: true, fl: "tile", ...o });
const stairhall = (name = "Stair hall") => R("hall", "mushall", { name, hub: true, fl: "tile" });
const classroom = (name = "Education room") => R("classroom", "musclass", { name, type: "office", maxBoxes: 2 });
const theatre = (name = "Auditorium") => R("dayroom", "musaud", { name, type: null, hub: false });

// ======================================================================================
// The plans: each (rng, d) → the spec's program, upper and exits; d = { bw, bh, n } (the footprint and storeys rolled).
// Every floor keeps the same columns, so the stairs stand in the same rooms all the way up.
// ======================================================================================
const PLANS = {
  art: {
    // The atrium between two wings of galleries, the service column at one side.
    atrium(rng, d) {
      const flip = rng.chance(0.5);
      const cols = (a, mid, b, svc) => flipX(X(a, mid, b, svc), flip);
      const mid = (top) => [14, Y(["*", top], [6, X(RR, RR)])];
      const svc = (low) => [8, Y([8, stairhall("Service stair")], ["*", low])];
      const ground = cols(["*", Y(["*", gallery("European paintings")], ["*", gallery("Sculpture gallery", { mus: "sculpture" })], [8, giftshop()])],
        mid(atrium("Atrium", { mus: "atriumart" })),
        ["*", Y(["*", gallery("American art")], ["*", gallery("Prints and drawings")], [8, cafe()])],
        svc(Y(["*", dock()], ["*", security()], ["*", lab()])));
      const upper = (f, r, ctx) => (ctx && ctx.top
        ? cols(["*", Y(["*", gallery("Modern art")], ["*", archive("Paintings store")], [8, office()])], mid(hall("Upper atrium", { mus: "mezz" })),
          ["*", Y(["*", gallery("Photography")], ["*", lab("Paper conservation")], [8, staffroom()])], svc(Y(["*", store("Frame store")], ["*", office("Curators' offices")])))
        : cols(["*", Y(["*", gallery(`Gallery ${f}A`)], ["*", gallery("Decorative arts", { mus: "decor" })], [8, classroom()])], mid(hall("Upper atrium", { mus: "mezz" })),
          ["*", Y(["*", gallery(`Gallery ${f}B`)], ["*", gallery("Asian art", { mus: "decor" })], [8, office()])], svc(Y(["*", store()], ["*", office("Registrar")]))));
      return { program: ground, upper, stairs: { roles: ["foyer", "hall"], n: 2 },
        exits: [{ side: "back", roles: ["storage"], chance: 1, roller: true, width: 2, lock: 0.5, name: "Loading dock" }, { side: flip ? "left" : "right", roles: ["hall"], chance: 0.7, lock: 0.5, name: "Fire exit" }] };
    },
    // A front band of the lobby, the gift shop and the café, an enfilade of galleries round the sculpture court behind.
    court(rng, d) {
      const fd = 9;
      const ring = (inner) => ["*", X(["*", Y(["*", gallery("East galleries")], ["*", gallery("Old masters")])], [16, inner], ["*", Y(["*", gallery("West galleries")], ["*", gallery("Antiquities", { mus: "decor" })])])];
      const ground = Y([fd, X(["*", giftshop()], [16, atrium("Lobby", { mus: "atriumart" })], ["*", cafe()])],
        ring(R("hall", "sculpture", { name: "Sculpture court", type: "musgallery", hub: true, fl: "stone", maxBoxes: 2 })),
        [7, X(["*", dock()], ["*", lab()], ["*", store()], ["*", security()], rest(3))]);
      const upper = (f, r, ctx) => Y([fd, X(["*", office()], [16, hall("Upper lobby", { mus: "mezz" })], ["*", ctx && ctx.top ? staffroom() : classroom()])],
        ["*", X(["*", Y(["*", gallery(`Gallery ${f}A`)], ["*", gallery("Modern art")])], [16, hall("Court gallery", { mus: "mezz" })], ["*", Y(["*", gallery(`Gallery ${f}B`)], ["*", gallery("Works on paper")])])],
        [7, X(["*", archive()], ["*", lab("Paintings conservation")], ["*", store("Frame store")], ["*", office("Curators' offices")], rest(3))]);
      return { program: ground, upper, stairs: { roles: ["foyer", "hall"], n: 2 },
        exits: [{ side: "back", roles: ["storage"], chance: 1, roller: true, width: 2, lock: 0.5, name: "Loading dock" }, { side: "left", roles: ["dining"], chance: 0.6, lock: 0.5, name: "Fire exit" }] };
    },
  },
  natural: {
    // The dinosaur hall through the middle (its skeletons two storeys tall), the halls either side.
    hall(rng, d) {
      const flip = rng.chance(0.5);
      const side = (a, b, c) => ["*", Y(["*", a], ["*", b], [9, c])];
      const ground = flipX(X(side(gallery("Hall of mammals", { mus: "natgal" }), gallery("Hall of birds", { mus: "natgal" }), giftshop("Museum shop")),
        [22, Y([7, atrium("Rotunda", { mus: "atriumnat" })], ["*", R("hall", "dinohall", { name: "Dinosaur hall", type: "musgallery", hub: true, fl: "stone", maxBoxes: 3 })], [5, X(RR, RR)])],
        side(gallery("Minerals and gems", { mus: "gems" }), gallery("Ocean life", { mus: "natgal" }), cafe()),
        [8, Y([8, stairhall("Service stair")], ["*", dock()], ["*", lab("Preparation lab")], ["*", security()])]), flip);
      const upper = (f, r, ctx) => flipX(X(side(gallery(ctx && ctx.top ? "Human origins" : "Hall of reptiles", { mus: "natgal" }), gallery("Fossil gallery", { mus: "natgal" }), classroom("Discovery room")),
        [22, Y([7, hall("Rotunda gallery", { mus: "mezz" })], ["*", R("hall", "dinomezz", { name: "Dinosaur hall balcony", hub: true, fl: "stone" })], [5, X(RR, RR)])],
        side(store("Bird skins store"), gallery(ctx && ctx.top ? "Meteorites" : "Insect hall", { mus: "gems" }), office("Curators' offices")),
        [8, Y([8, stairhall("Service stair")], ["*", store("Collection store")], ["*", archive("Field notes archive")], ["*", staffroom()])]), flip);
      return { program: ground, upper, stairs: { roles: ["foyer", "hall"], n: 2 },
        exits: [{ side: "back", roles: ["storage"], chance: 1, roller: true, width: 2, lock: 0.5, name: "Loading dock" }, { side: flip ? "left" : "right", roles: ["hall"], chance: 0.8, lock: 0.5, name: "Fire exit" }] };
    },
    // Halls round a great entrance hall at the front, the dinosaur hall across the back.
    great(rng, d) {
      const front = [14, X(["*", gallery("Hall of mammals", { mus: "natgal" })], [20, atrium("Great hall", { mus: "atriumnat" })], ["*", gallery("Minerals and gems", { mus: "gems" })])];
      const back = ["*", X([8, Y(["*", giftshop("Museum shop")], ["*", cafe()])], ["*", R("hall", "dinohall", { name: "Dinosaur hall", type: "musgallery", hub: true, fl: "stone", maxBoxes: 3 })], [8, Y([8, stairhall("Service stair")], ["*", lab("Preparation lab")])])];
      const svc = [6, X(["*", dock()], ["*", store()], ["*", security()], rest(3), rest(3))];
      const upper = (f, r, ctx) => Y([14, X(["*", gallery(ctx && ctx.top ? "Human origins" : "Hall of birds", { mus: "natgal" })], [20, hall("Great hall gallery", { mus: "mezz" })], ["*", gallery("Ocean life", { mus: "natgal" })])],
        ["*", X([8, Y(["*", classroom("Discovery room")], ["*", office()])], ["*", R("hall", "dinomezz", { name: "Dinosaur hall balcony", hub: true, fl: "stone" })], [8, Y([8, stairhall("Service stair")], ["*", archive("Field notes archive")])])],
        [6, X(["*", store("Collection store")], ["*", store("Spirit store")], ["*", staffroom()], rest(3), rest(3))]);
      return { program: Y(front, back, svc), upper, stairs: { roles: ["foyer", "hall"], n: 2 },
        exits: [{ side: "back", roles: ["storage"], chance: 1, roller: true, width: 2, lock: 0.5, name: "Loading dock" }] };
    },
  },
  science: {
    // Two hands-on halls either side of the lobby, the planetarium and the maker lab behind.
    halls(rng, d) {
      const flip = rng.chance(0.5);
      const ground = Y(["*", flipX(X(["*", R("dining", "handson", { name: "Forces and motion", type: "musplay", hub: true, maxBoxes: 4 })], [12, Y(["*", atrium("Lobby", { mus: "atriumsci" })], [5, X(RR, RR)])],
        ["*", R("dining", "handson", { name: "Light and sound", type: "musplay", hub: true, maxBoxes: 4 })], [8, Y([8, stairhall("Stair hall")], ["*", security()])]), flip)],
        [10, X(["*", theatre("Planetarium")], ["*", R("workshop", "makerlab", { name: "Maker lab", type: "muslab", maxBoxes: 4 })], ["*", cafe()], ["*", giftshop("Science shop")], ["*", dock()])]);
      const upper = (f) => Y(["*", flipX(X(["*", R("dining", "handson", { name: f % 2 ? "Human body" : "Weather and climate", type: "musplay", hub: true, maxBoxes: 4 })], [12, Y(["*", hall("Upper lobby", { mus: "mezz" })], [5, X(RR, RR)])],
        ["*", R("dining", "handson", { name: f % 2 ? "Space" : "Electricity", type: "musplay", hub: true, maxBoxes: 4 })], [8, Y([8, stairhall("Stair hall")], ["*", office()])]), flip)],
        [10, X(["*", classroom()], ["*", classroom("Chemistry lab")], ["*", lab("Exhibit workshop")], ["*", store("Exhibit store")], ["*", staffroom()])]);
      return { program: ground, upper, stairs: { roles: ["foyer", "hall"], n: 2 }, exits: [{ side: "back", roles: ["storage"], chance: 1, roller: true, width: 2, lock: 0.4, name: "Loading dock" }] };
    },
    // One open exhibit floor behind a glass front, the dome of the planetarium at one end.
    open(rng, d) {
      const ground = X(["*", Y([8, X(["*", giftshop("Science shop")], [12, atrium("Lobby", { mus: "atriumsci" })], ["*", cafe()])],
        ["*", R("dining", "handson", { name: "Exhibit floor", type: "musplay", hub: true, maxBoxes: 8 })], [6, X(["*", classroom()], ["*", R("workshop", "makerlab", { name: "Maker lab", type: "muslab", maxBoxes: 4 })], rest(3), rest(3))])],
        [14, Y(["*", theatre("Planetarium")], [8, X(["*", stairhall("Stair hall")], ["*", dock()])])]);
      const upper = () => X(["*", Y([8, X(["*", office()], [12, hall("Gallery", { mus: "mezz" })], ["*", security()])],
        ["*", R("dining", "handson", { name: "Upper exhibit floor", type: "musplay", hub: true, maxBoxes: 6 })], [6, X(["*", classroom("Lab classroom")], ["*", store("Exhibit store")], rest(3), rest(3))])],
        [14, Y(["*", R("office", "musoffice", { name: "Observatory deck", type: "office", maxBoxes: 1 })], [8, X(["*", stairhall("Stair hall")], ["*", staffroom()])])]);
      return { program: ground, upper, stairs: { roles: ["foyer", "hall"] }, exits: [{ side: "back", roles: ["storage"], chance: 1, roller: true, width: 2, lock: 0.4, name: "Loading dock" }] };
    },
  },
  military: {
    // The vehicle hall at one side, the galleries along the other, the arms vault behind them.
    hall(rng, d) {
      const flip = rng.chance(0.5);
      const ground = flipX(X(["*", R("hangarfloor", "vehhall", { name: "Vehicle hall", type: "musvehicle", hub: true, maxBoxes: 4, veh: "army" })],
        [16, Y([9, atrium("Lobby", { mus: "atriummil" })], ["*", gallery("Uniforms and medals", { mus: "arms", type: "musarms" })], ["*", gallery("Small arms gallery", { mus: "arms", type: "musarms" })],
          [7, X(["*", R("armory", "relics", { name: "Arms vault", type: "musarms", lock: ["door", 0.8], dk: "steel", boxLock: MUSEUM.RELIC, maxBoxes: 3 })], ["*", giftshop("Shop")])], [5, X(RR, RR)])],
        [8, Y([8, stairhall("Stair hall")], ["*", security()], ["*", store("Restoration store")])]), flip);
      const upper = () => flipX(X(["*", gallery("Vehicle hall balcony", { mus: "arms", type: "musarms" })],
        [16, Y([9, hall("Upper lobby", { mus: "mezz" })], ["*", gallery("Wars of the century", { mus: "arms", type: "musarms" })], ["*", archive("Service records")], [7, office()], [5, X(RR, RR)])],
        [8, Y([8, stairhall("Stair hall")], ["*", staffroom()], ["*", classroom("Veterans' room")])]), flip);
      return { program: ground, upper, stairs: { roles: ["foyer", "hall"] },
        exits: [{ side: "back", roles: ["hangarfloor"], chance: 1, roller: true, width: 3, lock: 0.5, name: "Vehicle doors" }] };
    },
    // An old armoury: the drill hall of vehicles and guns through the middle, the galleries round it, one storey.
    armoury(rng, d) {
      const ground = Y([9, X(["*", gallery("Uniforms and medals", { mus: "arms", type: "musarms" })], [14, atrium("Entrance", { mus: "atriummil" })], ["*", giftshop("Shop")])],
        ["*", X([9, Y(["*", gallery("Small arms gallery", { mus: "arms", type: "musarms" })], [7, R("armory", "relics", { name: "Arms vault", type: "musarms", lock: ["door", 0.8], dk: "steel", boxLock: MUSEUM.RELIC, maxBoxes: 3 })])],
          ["*", R("hangarfloor", "vehhall", { name: "Drill hall", type: "musvehicle", hub: true, maxBoxes: 4, veh: "army" })],
          [9, Y(["*", gallery("Artillery gallery", { mus: "arms", type: "musarms" })], ["*", archive("Service records")])])],
        [6, X(["*", security()], ["*", store("Restoration store")], ["*", office()], rest(3), rest(3))]);
      return { program: ground, exits: [{ side: "back", roles: ["storage"], chance: 0.8, lock: 0.5, name: "Back door" }, { side: "left", roles: ["hangarfloor"], chance: 1, roller: true, width: 3, lock: 0.6, name: "Vehicle doors" }] };
    },
  },
  localhist: {
    // An old two-storey house: the parlour and the dining room either side of the hall, the kitchen behind; upstairs the
    // bedroom kept as it was, the exhibit room and the archive.
    house(rng, d) {
      const flip = rng.chance(0.5);
      const ground = flipX(X(["*", Y(["*", R("living", "period", { name: "Parlour", type: "musgallery", maxBoxes: 2, fl: "hardwood", per: "parlour" })], ["*", R("kitchen", "period", { name: "Old kitchen", type: "musgallery", maxBoxes: 2, fl: "plank", per: "kitchen" })])],
        [4, Y(["*", atrium("Front hall", { mus: "frontdesk", fl: "hardwood", type: "musgift", maxBoxes: 1 })], [2, { role: "restroom" }])],
        ["*", Y(["*", gallery("Exhibit room", { hub: false, maxBoxes: 2 })], ["*", giftshop("Gift corner", { maxBoxes: 2 })])]), flip);
      const upper = () => flipX(X(["*", Y(["*", R("bedroom", "period", { name: "Bedroom as it was", type: "musgallery", maxBoxes: 2, fl: "hardwood", per: "bedroom" })], ["*", archive("Archive room")])],
        [4, hall("Landing", { fl: "hardwood" })], ["*", Y(["*", gallery("Photographs room", { hub: false, maxBoxes: 2 })], ["*", R("office", "musoffice", { name: "Curator's office", type: "office", maxBoxes: 1 })])]), flip);
      return { program: ground, upper, stairs: { roles: ["foyer", "hall"] }, exits: [{ side: "back", roles: ["kitchen", "storage"], chance: 0.6, lock: 0.6 }] };
    },
    // A cottage of rooms in a row off a side hall, the archive in the attic.
    cottage(rng, d) {
      const ground = X([3, hall("Side hall", { fl: "hardwood", entry: true })], ["*", Y(["*", R("living", "period", { name: "Front room", type: "musgallery", maxBoxes: 2, fl: "hardwood", per: "parlour" })],
        ["*", gallery("Exhibit room", { hub: false, maxBoxes: 2 })], ["*", R("kitchen", "period", { name: "Old kitchen", type: "musgallery", maxBoxes: 2, fl: "plank", per: "kitchen" })], [3, X(["*", giftshop("Gift corner", { maxBoxes: 1 })], rest(2))])]);
      const upper = () => X([3, hall("Attic stair", { fl: "plank" })], ["*", Y(["*", archive("Attic archive")], ["*", R("bedroom", "period", { name: "Bedroom as it was", type: "musgallery", maxBoxes: 2, fl: "hardwood", per: "bedroom" })])]);
      return { program: ground, upper, stairs: { roles: ["hall"] }, exits: [{ side: "back", roles: ["kitchen"], chance: 0.6, lock: 0.6 }] };
    },
  },
  county: {
    // One exhibit hall behind the front desk, the reading room and the store along the back.
    hall(rng, d) {
      return {
        program: Y([5, X(["*", giftshop("Front desk and shop", { maxBoxes: 2 })], [6, atrium("Entry", { mus: "frontdesk", type: "musgift", maxBoxes: 1 })], rest(3))],
          ["*", gallery("Exhibit hall", { maxBoxes: 3 })], [5, X(["*", R("dining", "readroom", { name: "Reading room", type: "libref", maxBoxes: 2, fl: "carpet" })], ["*", store("Collection store", { maxBoxes: 2 })], ["*", R("office", "musoffice", { name: "Office", type: "office", maxBoxes: 1 })])]),
        exits: [{ side: "back", roles: ["storage"], chance: 0.7, lock: 0.5 }],
      };
    },
    // Two halls either side of the entry, the pioneer cabin rebuilt inside one, the store behind.
    twin(rng, d) {
      const flip = rng.chance(0.5);
      return {
        program: Y(["*", flipX(X(["*", gallery("Pioneer hall", { mus: "pioneer", maxBoxes: 3 })], [6, Y(["*", atrium("Entry", { mus: "frontdesk", type: "musgift", maxBoxes: 1 })], [3, { role: "restroom" }])], ["*", gallery("Farm and industry hall", { mus: "tools", type: "musstore", maxBoxes: 2 })]), flip)],
          [5, X(["*", store("Collection store", { maxBoxes: 2 })], ["*", office()], ["*", giftshop("Shop", { maxBoxes: 2 })])]),
        exits: [{ side: "back", roles: ["storage"], chance: 0.7, lock: 0.5 }],
      };
    },
  },
  children: {
    // Play halls round the welcome desk, the water and sand room, the craft room and a little theatre.
    pods(rng, d) {
      const flip = rng.chance(0.5);
      const ground = Y(["*", flipX(X(["*", Y(["*", R("dining", "play", { name: "Climbing hall", type: "musplay", hub: true, maxBoxes: 3 })], ["*", R("dining", "waterplay", { name: "Water and sand room", type: "musplay", maxBoxes: 2 })])],
        [9, Y(["*", atrium("Welcome desk", { mus: "atriumkids", type: "musgift" })], [3, X(RR, RR)])],
        ["*", Y(["*", R("dining", "play", { name: "Pretend town", type: "musplay", hub: true, maxBoxes: 3, town: true })], ["*", R("classroom", "craft", { name: "Craft room", type: "musplay", maxBoxes: 2 })])]), flip)],
        [6, X(["*", theatre("Little theatre")], ["*", cafe("Snack bar")], ["*", giftshop("Toy shop")], ["*", store("Exhibit store")])]);
      const upper = () => Y(["*", flipX(X(["*", R("dining", "play", { name: "Toddler room", type: "musplay", hub: true, maxBoxes: 2 })], [9, Y(["*", hall("Upper hall")], [3, X(RR, RR)])], ["*", R("dining", "play", { name: "Science playground", type: "musplay", hub: true, maxBoxes: 3 })]), flip)],
        [6, X(["*", office()], ["*", staffroom()], ["*", classroom("Party room")])]);
      return { program: ground, upper, stairs: { roles: ["foyer", "hall"] }, exits: [{ side: "back", roles: ["storage"], chance: 0.6, lock: 0.5 }] };
    },
    // One big play hall, the theatre and the craft rooms along one side.
    hall(rng, d) {
      return {
        program: X(["*", Y([5, atrium("Welcome desk", { mus: "atriumkids", type: "musgift" })], ["*", R("dining", "play", { name: "Play hall", type: "musplay", hub: true, maxBoxes: 6, town: true })], [5, X(["*", cafe("Snack bar")], ["*", giftshop("Toy shop")], rest(3), rest(3))])],
          [9, Y(["*", theatre("Puppet theatre")], ["*", R("classroom", "craft", { name: "Craft room", type: "musplay", maxBoxes: 2 })], ["*", R("dining", "waterplay", { name: "Water room", type: "musplay", maxBoxes: 2 })], ["*", office()])]),
        exits: [{ side: "back", roles: ["office"], chance: 0.6, lock: 0.5, name: "Staff door" }],
      };
    },
  },
  aviation: {
    // One great hangar of aircraft behind the gallery block, the restoration shop at the side.
    hangar(rng, d) {
      const flip = rng.chance(0.5);
      return {
        program: Y([9, flipX(X(["*", gallery("Pioneers of flight", { mus: "aviagal" })], [12, atrium("Lobby", { mus: "atriumair" })], ["*", giftshop("Hangar shop")], ["*", cafe()], rest(3)), flip)],
          ["*", flipX(X(["*", R("hangarfloor", "vehhall", { name: "Main hangar", type: "musvehicle", hub: true, maxBoxes: 4, veh: "air" })], [12, Y(["*", R("workshop", "restore", { name: "Restoration shop", type: "musdock", maxBoxes: 4 })], ["*", store("Parts store")], [6, security()])]), flip)]),
        exits: [{ side: "back", roles: ["hangarfloor"], chance: 1, roller: true, width: 4, lock: 0.5, name: "Hangar doors" }],
      };
    },
    // Two hangars side by side, the jet age and the early years, joined by the gallery.
    twin(rng, d) {
      return {
        program: X(["*", R("hangarfloor", "vehhall", { name: "Jet age hangar", type: "musvehicle", hub: true, maxBoxes: 4, veh: "air" })],
          [12, Y([9, atrium("Lobby", { mus: "atriumair" })], ["*", gallery("Space gallery", { mus: "aviagal" })], ["*", giftshop("Hangar shop")], [6, X(["*", security()], rest(3))])],
          ["*", Y(["*", R("hangarfloor", "vehhall", { name: "Early years hangar", type: "musvehicle", hub: true, maxBoxes: 4, veh: "air" })], [8, X(["*", R("workshop", "restore", { name: "Restoration shop", type: "musdock", maxBoxes: 4 })], ["*", cafe()])])]),
        exits: [{ side: "back", roles: ["hangarfloor"], chance: 1, roller: true, width: 4, lock: 0.5, name: "Hangar doors" }],
      };
    },
  },
  car: {
    // Showroom halls either side of the lobby, the restoration garage behind.
    showroom(rng, d) {
      const flip = rng.chance(0.5);
      const ground = Y(["*", flipX(X(["*", R("sales", "vehhall", { name: "Classic cars", type: "musvehicle", hub: true, maxBoxes: 3, veh: "car" })], [10, Y(["*", atrium("Lobby", { mus: "atriumcar" })], [6, giftshop("Shop")])], ["*", R("sales", "vehhall", { name: "Racing cars", type: "musvehicle", hub: true, maxBoxes: 3, veh: "car" })]), flip)],
        [8, X(["*", R("bays", "restore", { name: "Restoration garage", type: "musdock", maxBoxes: 4 })], [8, stairhall("Stair hall")], ["*", store("Parts store")], ["*", office()], rest(3))]);
      const upper = () => Y(["*", flipX(X(["*", R("sales", "vehhall", { name: "Muscle cars", type: "musvehicle", hub: true, maxBoxes: 3, veh: "car" })], [10, Y(["*", hall("Upper lobby", { mus: "mezz" })], [6, cafe()])], ["*", gallery("Motoring gallery", { mus: "decor" })]), flip)],
        [8, X(["*", archive("Records room")], [8, stairhall("Stair hall")], ["*", staffroom()], ["*", security()], rest(3))]);
      return { program: ground, upper, stairs: { roles: ["hall"] }, exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.5, name: "Garage door" }] };
    },
    // One long hall of cars down the middle, the timeline gallery and the shop along one side.
    gallery(rng, d) {
      return {
        program: X([9, Y([6, atrium("Lobby", { mus: "atriumcar" })], ["*", gallery("Timeline gallery", { mus: "decor" })], ["*", giftshop("Shop")], [5, X(["*", cafe()], rest(2))])],
          ["*", Y(["*", R("sales", "vehhall", { name: "Car hall", type: "musvehicle", hub: true, maxBoxes: 5, veh: "car" })], [7, X(["*", R("bays", "restore", { name: "Restoration garage", type: "musdock", maxBoxes: 4 })], ["*", store("Parts store")], ["*", security()])])]),
        exits: [{ side: "back", roles: ["bays"], chance: 1, roller: true, width: 3, lock: 0.5, name: "Garage door" }],
      };
    },
  },
  railway: {
    // The old station building at the front, the engine shed behind on its tracks.
    station(rng, d) {
      return {
        program: Y([8, X(["*", R("dining", "waiting", { name: "Waiting room", type: "musgift", hub: true, maxBoxes: 2 })], [8, atrium("Ticket hall", { mus: "ticket" })], ["*", gallery("Railway gallery", { mus: "decor" })], ["*", giftshop("Station shop")])],
          ["*", R("hangarfloor", "vehhall", { name: "Engine shed", type: "musvehicle", hub: true, maxBoxes: 4, veh: "rail" })],
          [6, X(["*", R("workshop", "restore", { name: "Locomotive workshop", type: "musdock", maxBoxes: 4 })], ["*", store("Parts store")], ["*", office("Stationmaster's office")], rest(3))]),
        exits: [{ side: "back", roles: ["workshop"], chance: 0.8, lock: 0.5 }, { side: "left", roles: ["hangarfloor"], chance: 1, roller: true, width: 3, lock: 0.5, name: "Shed doors" }],
      };
    },
    // A roundhouse's long shed along the side, the galleries and the signal box beside it.
    shed(rng, d) {
      const flip = rng.chance(0.5);
      return {
        program: flipX(X(["*", R("hangarfloor", "vehhall", { name: "Locomotive shed", type: "musvehicle", hub: true, maxBoxes: 4, veh: "rail" })],
          [12, Y([7, atrium("Entrance", { mus: "ticket" })], ["*", gallery("Signals and track", { mus: "decor" })], ["*", R("dining", "waiting", { name: "Old waiting room", type: "musgift", hub: true, maxBoxes: 2 })], ["*", giftshop("Shop")], [5, X(["*", R("workshop", "restore", { name: "Carriage workshop", type: "musdock", maxBoxes: 3 })], rest(3))])]), flip),
        exits: [{ side: "back", roles: ["hangarfloor"], chance: 1, roller: true, width: 3, lock: 0.5, name: "Shed doors" }],
      };
    },
  },
  maritime: {
    // The boat hall through two storeys at one side, the galleries and the lens room above the lobby.
    harbour(rng, d) {
      const flip = rng.chance(0.5);
      const ground = flipX(X(["*", R("hangarfloor", "boathall", { name: "Boat hall", type: "musvehicle", hub: true, maxBoxes: 4 })],
        [12, Y([8, atrium("Lobby", { mus: "atriumsea" })], ["*", gallery("Ship models", { mus: "models" })], [6, giftshop("Ship's chandlery")], [4, X(RR, RR)])],
        [8, Y([7, stairhall("Stair hall")], ["*", R("workshop", "restore", { name: "Boat shop", type: "musdock", maxBoxes: 3 })], ["*", store()])]), flip);
      const upper = () => flipX(X(["*", gallery("Whaling gallery", { mus: "models" })],
        [12, Y([8, hall("Upper lobby", { mus: "mezz" })], ["*", gallery("Navigation gallery", { mus: "navigation" })], [6, cafe()], [4, X(RR, RR)])],
        [8, Y([7, stairhall("Stair hall")], ["*", R("dining", "lens", { name: "Lighthouse lens room", type: "musgallery", maxBoxes: 1 })], ["*", archive("Ships' logs archive")])]), flip);
      return { program: ground, upper, stairs: { roles: ["foyer", "hall"] }, exits: [{ side: "back", roles: ["hangarfloor"], chance: 1, roller: true, width: 3, lock: 0.5, name: "Boat doors" }] };
    },
    // A wharf shed: galleries along the front, the boat hall behind, the chandlery and the café on the quay side.
    wharf(rng, d) {
      const ground = Y([9, X(["*", gallery("Ship models", { mus: "models" })], [10, atrium("Lobby", { mus: "atriumsea" })], ["*", gallery("Navigation gallery", { mus: "navigation" })])],
        ["*", X(["*", R("hangarfloor", "boathall", { name: "Boat hall", type: "musvehicle", hub: true, maxBoxes: 4 })], [10, Y(["*", giftshop("Ship's chandlery")], ["*", cafe()], [7, stairhall("Stair hall")])])]);
      const upper = () => Y([9, X(["*", gallery("Shipwrecks gallery", { mus: "models" })], [10, hall("Upper lobby", { mus: "mezz" })], ["*", archive("Ships' logs archive")])],
        ["*", X(["*", gallery("Fishing fleet gallery", { mus: "navigation" })], [10, Y(["*", office()], ["*", R("workshop", "restore", { name: "Model workshop", type: "musdock", maxBoxes: 3 })], [7, stairhall("Stair hall")])])]);
      return { program: ground, upper, stairs: { roles: ["foyer", "hall"] }, exits: [{ side: "back", roles: ["hangarfloor"], chance: 1, roller: true, width: 3, lock: 0.5, name: "Boat doors" }] };
    },
  },
  presidential: {
    // The museum floor round the replica Oval Office, the archives and the research room behind.
    museum(rng, d) {
      const flip = rng.chance(0.5);
      const cols = (a, mid, b, svc) => flipX(X(a, mid, b, svc), flip);
      const mid = (top) => [12, Y(["*", top], [5, X(RR, RR)])];
      const svc = (low) => [8, Y([8, stairhall("Staff stair")], ["*", low])];
      const ground = cols(["*", Y(["*", gallery("Early life")], ["*", R("office", "oval", { name: "Oval Office replica", type: "musgallery", maxBoxes: 2, fl: "carpet" })], [8, giftshop("Museum store")])],
        mid(atrium("Entrance hall", { mus: "atriumpres" })),
        ["*", Y(["*", gallery("The campaign")], ["*", gallery("The presidency")], [8, theatre("Auditorium")])],
        svc(Y(["*", security()], ["*", dock()], ["*", cafe()])));
      const upper = (f, r, ctx) => cols(["*", Y(["*", R("dining", "research", { name: "Research room", type: "libref", maxBoxes: 4, fl: "carpet" })], ["*", archive("Presidential papers")], [8, office("Archivists' offices")])],
        mid(hall("Upper hall", { mus: "mezz" })), ["*", Y(["*", gallery(ctx && ctx.top ? "Gifts of state" : "The first family", { mus: "decor" })], ["*", archive("Audiovisual archive")], [8, staffroom()])],
        svc(Y(["*", store("Artifact store")], ["*", lab()])));
      return { program: ground, upper, stairs: { roles: ["foyer", "hall"], n: 2 }, exits: [{ side: "back", roles: ["storage"], chance: 1, roller: true, width: 2, lock: 0.6, name: "Loading dock" }] };
    },
    // A long hall of the presidency's years down the middle, the archive wing behind a courtyard of offices.
    timeline(rng, d) {
      const ground = Y([10, X(["*", giftshop("Museum store")], [14, atrium("Entrance hall", { mus: "atriumpres" })], ["*", theatre("Orientation theatre")])],
        ["*", X(["*", gallery("The presidency", { maxBoxes: 5 })], [10, R("office", "oval", { name: "Oval Office replica", type: "musgallery", maxBoxes: 2, fl: "carpet" })], ["*", gallery("Gifts of state", { mus: "decor" })])],
        [8, X(["*", archive("Presidential papers")], [8, stairhall("Staff stair")], ["*", security()], ["*", dock()])]);
      const upper = () => Y([10, X(["*", office()], [14, hall("Upper hall", { mus: "mezz" })], ["*", R("dining", "research", { name: "Research room", type: "libref", maxBoxes: 4, fl: "carpet" })])],
        ["*", X(["*", archive("Records stacks")], [10, staffroom()], ["*", archive("Photograph archive")])],
        [8, X(["*", lab()], [8, stairhall("Staff stair")], ["*", store("Artifact store")], ["*", office("Director's office")])]);
      return { program: ground, upper, stairs: { roles: ["foyer", "hall"] }, exits: [{ side: "back", roles: ["storage"], chance: 1, roller: true, width: 2, lock: 0.6, name: "Loading dock" }] };
    },
  },
  wax: {
    // Rooms of figures one after another off a winding hall, the photo studio at the end.
    rooms(rng, d) {
      const flip = rng.chance(0.5);
      const ground = flipX(X(["*", Y(["*", R("dining", "waxroom", { name: "Hollywood room", type: "musgallery", maxBoxes: 2, hub: true })], ["*", R("dining", "waxroom", { name: "Sports legends", type: "musgallery", maxBoxes: 2, hub: true })])],
        [4, Y([5, atrium("Ticket desk", { mus: "ticket" })], ["*", hall("Hall of fame")])],
        ["*", Y(["*", R("dining", "waxroom", { name: "World leaders", type: "musgallery", maxBoxes: 2, hub: true })], ["*", giftshop("Souvenir shop")])]), flip);
      const upper = () => flipX(X(["*", Y(["*", R("dining", "waxroom", { name: "Chamber of horrors", type: "musgallery", maxBoxes: 2, hub: true, dark: true })], ["*", R("office", "studio", { name: "Photo studio", type: "office", maxBoxes: 2 })])],
        [4, Y([5, hall("Stair hall")], ["*", hall("Upper hall")])], ["*", Y(["*", R("dining", "waxroom", { name: "Music stars", type: "musgallery", maxBoxes: 2, hub: true })], ["*", R("workshop", "waxshop", { name: "Wax workshop", type: "muslab", maxBoxes: 3 })])]), flip);
      return { program: ground, upper, stairs: { roles: ["foyer", "hall"] }, exits: [{ side: "back", roles: ["sales", "dining"], chance: 0.6, lock: 0.5 }] };
    },
    // One open floor of figures in bays behind ropes.
    floor(rng, d) {
      return {
        program: Y([6, X(["*", giftshop("Souvenir shop")], [8, atrium("Ticket desk", { mus: "ticket" })], ["*", R("office", "studio", { name: "Photo studio", type: "office", maxBoxes: 2 })])],
          ["*", R("dining", "waxroom", { name: "Figure hall", type: "musgallery", maxBoxes: 4, hub: true, big: true })],
          [6, X(["*", R("dining", "waxroom", { name: "Chamber of horrors", type: "musgallery", maxBoxes: 2, dark: true })], ["*", R("workshop", "waxshop", { name: "Wax workshop", type: "muslab", maxBoxes: 3 })], rest(3))]),
        upper: () => Y([6, X(["*", office()], [8, hall("Stair hall")], ["*", store("Figure store")])], ["*", R("dining", "waxroom", { name: "Royals and rulers", type: "musgallery", maxBoxes: 3, hub: true, big: true })], [6, X(["*", staffroom()], rest(3))]),
        stairs: { roles: ["foyer", "hall"] },
        exits: [{ side: "back", roles: ["workshop"], chance: 0.6, lock: 0.5 }],
      };
    },
  },
};

// ======================================================================================
// The variants, their pick, the spec
// ======================================================================================
export const MUSEUM_KEYS = Object.keys(PLANS);
/** The variants (each its size row and its plans). */
export const MUSEUM_VARIANTS = Object.fromEntries(MUSEUM_KEYS.map((v) => [v, { size: sizeRow(v), plans: Object.keys(PLANS[v]) }]));
/** A variant's size row (data-buildingsize.js REAL_SIZE.museum.sizes): { w, d, storeys } in metres. @param {string} v */
function sizeRow(v) { return /** @type {any} */ (REAL_SIZE.museum).sizes[v]; }
// The footprint class (buildingmaps.js spec.foot: the tests' size classes) for an area (librarylayout.js's rule).
function footOf(bw, bh) {
  const a = bw * bh;
  return a >= 1800 && bw >= 50 ? "huge" : a >= 700 && bw >= 30 ? "xl" : a > 360 ? "large" : a <= 190 ? "small" : "medium";
}
const mid = (r) => (r[0] + r[1]) / 2;
// The registry (variantpick.js): "museum" (the thirteen variants by MUSEUM.W; foot: the size class, #42's sizeClassOf),
// "museum:<variant>" (its plans, uniform).
registerVariants("museum", MUSEUM_KEYS.map((v) => ({ id: v, name: MUSEUM_NAMES[v], w: MUSEUM.W[v], foot: [mid(sizeRow(v).w), mid(sizeRow(v).d), mid(sizeRow(v).storeys)] })));
for (const v of MUSEUM_KEYS) registerVariants(`museum:${v}`, Object.keys(PLANS[v]).map((p) => ({ id: p, name: `${MUSEUM_NAMES[v]} (${p})` })), { sub: true });
/**
 * The setting the picker weighs a museum by: a city centre's (and the city crawl's heart: o.tileClass), the coast, a
 * suburb or a highway by its tile class (#42); else the layouts' three (o.lset: rural, town, city; buildvariants.js).
 * @param {{ tileClass?: string | null, lset?: string | null, setting?: string | null }} o
 */
export function museumSetting(o = {}) {
  const tc = o.tileClass || null;
  if (tc === "centre" || tc === "coast" || tc === "suburb" || tc === "highway") return tc;
  return o.lset || (tc === "scenic" ? "rural" : tc) || null;
}
/**
 * Which variant and plan a museum is: o.plan or o.variant pins one ("art", "art/court"), else the picker by the setting.
 * Rolls the building's dice.
 * @param {any} rng @param {{ plan?: any, variant?: string | null, tileClass?: string | null, lset?: string | null }} [o] @returns {{ variant: string, plan: string }}
 */
export function museumVariant(rng, o = {}) {
  const pin = typeof o.plan === "string" ? o.plan : o.variant || null;
  let [variant, plan] = pin && pin.includes("/") ? pin.split("/") : [pin, null];
  const set = museumSetting(o);
  variant = /** @type {any} */ (pickVariant("museum", rng, { plan: variant && PLANS[variant] ? variant : null, setting: set, r: () => rng.next() })).id;
  plan = /** @type {any} */ (pickVariant(`museum:${variant}`, rng, { plan: plan && PLANS[variant][plan] ? plan : null, r: () => rng.next() })).id;
  return { variant, plan };
}
/**
 * A museum's spec for buildingmaps.js assemble: the variant's footprint (REAL_SIZE.museum.sizes), storeys and plan from
 * the dice. o: as museumVariant takes it. The spec carries mus: { variant, plan }.
 * @param {any} rng @param {any} [o]
 */
export function museumPlan(rng, o = {}) {
  const { variant, plan } = museumVariant(rng, o);
  const S = sizeRow(variant);
  const bw = rng.int(S.w[0], S.w[1]), bh = rng.int(S.d[0], S.d[1]);
  const p = PLANS[variant][plan](rng, { bw, bh });
  const n = p.upper ? rng.int(S.storeys[0], S.storeys[1]) : 1; // a plan with no floors above: one storey
  return {
    bw, bh, front: { width: bw >= 30 ? 3 : 2 }, ground: ["localhist", "county"].includes(variant) ? "town" : "city",
    storeys: n, upper: n > 1 ? p.upper : null, foot: footOf(bw, bh), program: p.program, exits: p.exits || [], openDoors: 0.25,
    ...(p.stairs && n > 1 ? { stairs: p.stairs } : {}), mus: { variant, plan }, vid: `${variant}/${plan}`, vname: MUSEUM_NAMES[variant], real: true, // vid, vname (planname.js, issue #40) // real: drawn at its real size (buildingmaps.js realScale leaves it, every floor built)
  };
}

// ======================================================================================
// The rooms (MUSEUM_STYLES, by the plan leaf's mus mark)
// ======================================================================================
/** @typedef {any} Lay */
const full = (L) => L.boxes() >= L.target();
const P = (L, o = {}) => ({ ...o, plain: full(L) });
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function doorFronts(L) {
  const out = [];
  for (const [dx, dy] of L.room.doors || []) for (const [ex, ey] of D4) if (L.inRoom(dx + ex, dy + ey)) out.push([dx + ex, dy + ey]);
  return out;
}
const frontDoor = (L) => { const fr = doorFronts(L); return fr.length ? fr.sort((a, b) => b[1] - a[1])[0] : null; };
// Up to n of k against the walls (plain once the room has its share).
function some(L, k, n, opts = {}) { let m = 0; for (let i = 0; i < n; i++) if (L.wall(k, P(L, opts))) m++; return m; }
// Pieces of k on a grid off the walls, a cell or two apart (plinths, figures, skeletons), up to n; plain.
function grid(L, k, n, step = 3, o = {}) {
  const c = L.c, sz = (o.size || [1, 1]);
  let m = 0;
  for (let y = c.y0 + 2; y + sz[1] - 1 <= c.y1 - 2 && m < n; y += step) for (let x = c.x0 + 2; x + sz[0] - 1 <= c.x1 - 2 && m < n; x += step) {
    const cells = [];
    for (let yy = 0; yy < sz[1]; yy++) for (let xx = 0; xx < sz[0]; xx++) cells.push([x + xx, y + yy]);
    if (cells.some(([px, py]) => L.lane(px, py))) continue;
    if (L.place(k, cells, { plain: true, face: o.face || "s" })) m++;
  }
  return m;
}
// The front desk: a counter run near the door, a chair behind it.
function frontDesk(L, n = 2) {
  const d = frontDoor(L), near = d ? [d[0], d[1] - 2] : null;
  const first = L.wall("counter", P(L, { prefer: "middle", ...(near ? { near } : {}) })) || L.centre("counter", P(L));
  let last = first;
  for (let i = 1; i < n && last; i++) last = L.beside(last, "counter", P(L)) || last;
  if (first) L.around(first, "chair", 1);
  return first;
}
// A gallery's display cases: up to the room's share as containers, n in all.
function cases(L, n, opts = {}) {
  let m = 0;
  for (let i = 0; i < n; i++) if (L.wall("displaycase", P(L, { prefer: "middle", ...opts }))) m++;
  if (!L.has("displaycase") && !full(L)) L.need("displaycase");
  return m;
}
// Benches down the middle of a hall (the gallery's bench).
function benches(L, n = 1) { let m = 0; for (let i = 0; i < n; i++) if (L.centre("mallbench", { plain: true })) m++; return m; }
// Rows of seats facing a lectern (an auditorium, a planetarium), an aisle down the middle (librarylayout.js's way).
function seats(L, k = "audseat") {
  const c = L.c, d = doorFronts(L)[0], side = !d ? "n" : c.h >= c.w ? (d[1] > (c.y0 + c.y1) / 2 ? "n" : "s") : (d[0] > (c.x0 + c.x1) / 2 ? "w" : "e");
  L.wall("lectern", { sides: [side], prefer: "middle" });
  const ns = side === "n" || side === "s", len = ns ? c.w : c.h, depth = ns ? c.h : c.w, m = Math.floor(len / 2);
  for (let r = 3; r < depth - 1; r += 2) for (let a = 1; a < len - 1; a++) {
    if (Math.abs(a - m) < 1) continue;
    const x = ns ? c.x0 + a : side === "w" ? c.x0 + r : c.x1 - r, y = ns ? (side === "n" ? c.y0 + r : c.y1 - r) : c.y0 + a;
    L.place(k, [[x, y]], { face: side });
  }
}
// Rows of shelving (archives): a row every other line, broken where a lane crosses; containers at the ends.
function shelfRows(L, k = "mobileshelf", box = "mobileshelf") {
  const c = L.c, along = c.w >= c.h;
  for (let b = 1; b < (along ? c.h : c.w) - 1; b += 2) {
    let seg = [];
    const flush = () => { seg.forEach(([x, y], i) => { const want = (i === 0 || i === seg.length - 1) && !full(L); if (!(want && L.place(box, [[x, y]], { face: along ? "s" : "e" }))) { if (L.ok(x, y)) L.c.block(x, y, k); } }); seg = []; };
    for (let a = 1; a < (along ? c.w : c.h) - 1; a++) {
      const [x, y] = along ? [c.x0 + a, c.y0 + b] : [c.x0 + b, c.y0 + a];
      if (a % 9 === 0 || !L.ok(x, y)) { flush(); continue; }
      seg.push([x, y]);
    }
    flush();
  }
}
// The exhibit vehicles of a hall (its veh mark): aircraft, the Army's, cars, rail cars.
const VEH = {
  air: [{ body: "jet", len: 6, wide: 4, label: "fighter jet on display" }, { body: "helo", len: 5, wide: 2, label: "helicopter on display" }, { body: "cargoplane", len: 8, wide: 6, label: "transport plane on display" }],
  army: [{ body: "m35", len: 5, label: "Army truck on display" }, { body: "humvee", len: 4, label: "Humvee on display" }, { body: "mrap", len: 5, label: "MRAP on display" }],
  car: [{ kind: "car", len: 3, label: "classic car" }, { kind: "car", len: 4, label: "classic car" }],
};
// Each vehicle on its own spot: off the lanes (every way through the hall stays open), nearest the hall's middle, each
// end and side a cell from the walls and from the last one (civiclayout.js vehicleIn looks only by the doors).
function vehicles(L, which, most) {
  const list = VEH[which], c = L.c;
  let n = 0;
  for (let i = 0; i < most; i++) {
    const v = list[(L.variant(list.length, `veh${i}`) + i) % list.length];
    if (exhibit(L, { kind: v.kind || "truck", len: v.len, wide: v.wide || 2, body: v.body, box: which === "air" ? "exhibitplane" : "exhibitcar", label: v.label })) n++;
  }
  return n;
}
function exhibit(L, o) {
  const c = L.c, mx = (c.x0 + c.x1) / 2, my = (c.y0 + c.y1) / 2, cands = [];
  for (const ax of ["x", "y"]) {
    const [w, h] = ax === "x" ? [o.len, o.wide] : [o.wide, o.len];
    for (let y = c.y0 + 1; y + h - 1 <= c.y1 - 1; y++) for (let x = c.x0 + 1; x + w - 1 <= c.x1 - 1; x++) {
      let ok = true;
      for (let yy = y - 1; yy <= y + h && ok; yy++) for (let xx = x - 1; xx <= x + w && ok; xx++) {
        const inner = yy >= y && yy < y + h && xx >= x && xx < x + w;
        if (inner ? !c.free(xx, yy) || L.lane(xx, yy) : L.inRoom(xx, yy) && !c.free(xx, yy) && !L.lane(xx, yy)) ok = false;
      }
      if (ok) cands.push({ x, y, ax, d: Math.hypot(x + (w - 1) / 2 - mx, y + (h - 1) / 2 - my) + L.variant(4, `ex${x},${y}`) * 0.3 });
    }
  }
  cands.sort((a, b) => a.d - b.d);
  for (const cd of cands.slice(0, 60)) if (c.vehicle(cd.x, cd.y, { ...o, ax: cd.ax })) return true;
  return false;
}

export const MUSEUM_STYLES = {
  // ---------- the halls everyone walks through ----------
  atrium(L) { frontDesk(L, 3); L.wall("directory", { prefer: "corner" }); benches(L, 1); L.centre("statue", { plain: true }); L.fill(["displaycase"]); },
  atriumart(L) { frontDesk(L, 3); L.centre("sculpture", { plain: true }); benches(L, 2); some(L, "stanchion", 2, { prefer: "corner" }); L.fill(["displaycase"]); },
  atriumnat(L) { frontDesk(L, 3); grid(L, "fossil", 1, 4, { size: [2, 2] }); benches(L, 2); L.fill(["displaycase"]); },
  atriumsci(L) { frontDesk(L, 3); L.centre("globe"); benches(L, 1); some(L, "kiosk", 1); L.fill(["displaycase"]); },
  atriummil(L) { frontDesk(L, 2); grid(L, "cannon", 1, 4, { size: [2, 1] }); some(L, "armourstand", 2, { plain: true, prefer: "corner" }); L.fill(["displaycase"]); },
  atriumkids(L) { frontDesk(L, 2); some(L, "beanbag", 3, { prefer: "corner" }); L.fill(["shelf"]); },
  atriumair(L) { frontDesk(L, 3); benches(L, 1); some(L, "shipmodel", 1, { plain: true }); L.fill(["displaycase"]); },
  atriumcar(L) { frontDesk(L, 2); benches(L, 1); L.fill(["displaycase"]); },
  atriumsea(L) { frontDesk(L, 2); L.centre("shipmodel", { plain: true }); L.wall("globe", { prefer: "corner" }); L.fill(["displaycase"]); },
  atriumpres(L) { frontDesk(L, 3); L.centre("bust", { plain: true }); some(L, "stanchion", 4); benches(L, 1); L.fill(["displaycase"]); },
  frontdesk(L) { frontDesk(L, 2); L.fill(["shelf"]); },
  ticket(L) { frontDesk(L, 2); some(L, "stanchion", 3); L.fill(["displaycase"]); },
  mezz(L) { benches(L, 1); some(L, "bust", 1, { plain: true, prefer: "corner" }); some(L, "plant", 2, { prefer: "corner" }); },
  mushall(L) { some(L, "plant", 1, { prefer: "corner" }); },
  // ---------- the galleries ----------
  gallery(L) {
    // Framed paintings round the walls, a sculpture or two on its plinth in the middle, a bench to sit on, the cases of
    // smaller pieces (the containers: coins, medals, silver, jewellery).
    cases(L, 3);
    for (let i = 0; i < 12; i++) if (!L.wall("artwork", { plain: true })) break;
    grid(L, "sculpture", L.variant(2, "plinths") + 1, 4);
    benches(L, 1);
  },
  sculpture(L) { grid(L, "sculpture", 9, 3); some(L, "bust", 3, { plain: true }); cases(L, 2); benches(L, 1); },
  decor(L) { cases(L, 4); grid(L, "vase", 4, 3); some(L, "artwork", 4, { plain: true }); },
  natgal(L) { cases(L, 6); grid(L, "fossil", 1, 5, { size: [2, 2] }); benches(L, 1); },
  gems(L) { cases(L, 8); L.centre("displaycase"); benches(L, 1); },
  dinohall(L) { grid(L, "fossil", 4, 5, { size: [2, 2] }); some(L, "stanchion", 6); cases(L, 3); benches(L, 2); },
  dinomezz(L) { some(L, "stanchion", 4); benches(L, 1); },
  arms(L) {
    // Cases of medals and small arms (deactivated: the cases' table is curios, not guns), suits of armour, a field gun.
    cases(L, 6);
    some(L, "armourstand", 3, { plain: true, prefer: "corner" });
    grid(L, "cannon", 1, 5, { size: [2, 1] });
  },
  relics(L) { cases(L, 4); L.wall("gunrack", { plain: true }); L.fill(["displaycase"]); },
  aviagal(L) { cases(L, 4); some(L, "shipmodel", 2, { plain: true }); some(L, "artwork", 3, { plain: true }); benches(L, 1); },
  models(L) { cases(L, 4); grid(L, "shipmodel", 6, 3); benches(L, 1); },
  navigation(L) { cases(L, 3); some(L, "mapcase", 2, { prefer: "corner" }); L.centre("globe"); some(L, "shipmodel", 1, { plain: true }); },
  lens(L) { L.centre("statue", { plain: true }); cases(L, 1); },
  pioneer(L) { L.wall("woodstove", { prefer: "corner" }); cases(L, 3); some(L, "vase", 2, { plain: true }); tableSet(L, 2); },
  tools(L) { L.wall("workbench", P(L)); some(L, "toolchest", 1); L.fill(["crate", "shelf"]); },
  period(L) {
    // A room kept as it was, roped off at the door: the parlour's fireplace, piano and armchairs; the kitchen's wood stove
    // and table; the bedroom's bed and chest of drawers; a case of the family's things.
    const per = L.room.per;
    if (per === "parlour") { L.wall("fireplace", { prefer: "middle" }); L.wall("piano", { prefer: "corner" }); some(L, "armchair", 2, { prefer: "corner" }); some(L, "artwork", 2, { plain: true }); }
    else if (per === "kitchen") { L.wall("woodstove", { prefer: "corner" }); tableSet(L, 3); L.wall("cabinet", P(L)); }
    else { L.wall("bed", { prefer: "middle" }); L.wall("dresser", P(L)); L.wall("vase", { plain: true, prefer: "corner" }); }
    some(L, "stanchion", 2);
    cases(L, 1);
  },
  waxroom(L) {
    // Figures in groups behind rope barriers, a painted backdrop on the wall.
    const n = L.room.big ? 14 : 6;
    for (let i = 0; i < n; i++) if (!L.wall("waxfigure", { plain: true })) break;
    grid(L, "waxfigure", L.room.big ? 6 : 2, 3);
    some(L, "stanchion", 4);
    cases(L, 1);
  },
  oval(L) { L.wall("desk", { prefer: "middle" }); const s = L.centre("sofa"); if (s) L.facing(s, "sofa"); some(L, "armchair", 2, { prefer: "corner" }); some(L, "artwork", 2, { plain: true }); L.wall("bust", { plain: true, prefer: "corner" }); some(L, "stanchion", 2); cases(L, 1); },
  // ---------- the halls of exhibits that move ----------
  vehhall(L) {
    const which = L.room.veh || "car";
    if (which === "rail") { grid(L, "railcar", 6, 4, { size: [2, 1] }); some(L, "stanchion", 4); cases(L, 2); return; }
    vehicles(L, which, which === "air" ? 3 : 4);
    some(L, "stanchion", 4);
    cases(L, 2);
  },
  boathall(L) { grid(L, "boat", 6, 3, { size: [1, 2] }); some(L, "shipmodel", 2, { plain: true }); cases(L, 2); L.fill(["crate"]); },
  // ---------- the rooms for children and learning ----------
  handson(L) { grid(L, "kiosk", 4, 4, { size: [2, 1] }); some(L, "computer", 3, { plain: false }); L.centre("globe"); L.fill(["shelf"]); },
  play(L) { grid(L, "playplace", L.room.town ? 3 : 2, 4, { size: [2, 2] }); some(L, "beanbag", 4); some(L, "lowshelf", 3); L.fill(["shelf"]); },
  waterplay(L) { L.wall("sink", { prefer: "corner" }); grid(L, "playplace", 1, 4, { size: [2, 2] }); L.fill(["shelf"]); },
  craft(L) { for (let i = 0; i < 3; i++) if (!tableSet(L, 4)) break; L.wall("sink", { prefer: "corner" }); L.fill(["cabinet", "shelf"]); },
  musclass(L) { for (let i = 0; i < 3; i++) if (!tableSet(L, 4)) break; L.wall("whiteboard", { prefer: "middle" }); L.fill(["cabinet"]); },
  musaud(L) { seats(L); },
  makerlab(L) { L.wall("workbench", P(L)); L.wall("workbench", P(L)); some(L, "toolchest", 1); L.fill(["cabinet", "shelf"]); },
  // ---------- the money and the food ----------
  giftshop(L) {
    frontDesk(L, 2);
    some(L, "displaycase", 2);
    for (let i = 0; i < 2; i++) L.centre("shelf", P(L));
    L.fill(["shelf", "shelf", "displaycase"]);
  },
  muscafe(L) {
    const ws = L.walls();
    L.run(["counter", "coldcase", "counter", "espresso", "counter"], ws.length ? [ws[0].side] : ["n"], { plain: () => full(L) });
    for (let i = 0; i < 5; i++) if (!tableSet(L, 2)) break;
    L.fill(["cabinet", "shelf"]);
  },
  waiting(L) { for (let i = 0; i < 3; i++) if (!L.centre("pew")) break; L.wall("wallclock", { plain: true }); cases(L, 1); L.fill(["displaycase"]); },
  // ---------- behind the scenes ----------
  conslab(L) { L.wall("labbench", P(L)); L.wall("labbench", P(L)); L.wall("fumehood", { prefer: "corner" }); L.wall("sink", { prefer: "corner" }); L.centre("artwork", { plain: true }); L.fill(["cabinet", "labfreezer"]); },
  musstore(L) { shelfRows(L, "rack", "rack"); L.fill(["crate", "rack"]); },
  archive(L) { shelfRows(L, "mobileshelf", "mobileshelf"); L.wall("mapcase", P(L, { prefer: "corner" })); },
  musdock(L) { for (let i = 0; i < 3; i++) L.centre("crate", P(L)); L.wall("drum", P(L)); L.fill(["crate", "rack"]); },
  restore(L) { L.wall("workbench", P(L)); L.wall("toolchest", P(L)); L.wall("compressor", { prefer: "corner" }); L.fill(["shelf", "crate"]); },
  mussec(L) { const d = L.wall("secdesk", P(L)) || L.wall("desk", P(L)); if (d) L.around(d, "chair", 1); L.wall("screens", { prefer: "middle" }); L.wall("keyrack", { prefer: "corner" }); L.fill(["locker", "cabinet"]); },
  musoffice(L) { for (let i = 0; i < 3; i++) { const d = L.wall("desk", P(L, { prefer: "corner" })); if (!d) break; L.around(d, "chair", 1); } L.fill(["filing", "cabinet", "bookshelf"]); },
  musstaff(L) { const ws = L.walls(); L.run(["fridge", "counter", "sink", "microwave"], ws.length ? [ws[0].side] : ["n"], { plain: () => full(L) }); tableSet(L, 4); L.fill(["cabinet"]); },
  research(L) { for (let i = 0; i < 2; i++) { const t = L.centre("readtable"); if (!t) break; L.around(t, "chair", 4); } some(L, "microfilm", 2, { prefer: "corner" }); L.fill(["bookshelf", "cardcat"]); },
  readroom(L) { const t = L.centre("readtable"); if (t) L.around(t, "chair", 4); L.fill(["bookshelf", "filing"]); },
  studio(L) { L.wall("camera", { plain: true }); L.wall("studiolight", { plain: true }); L.wall("waxfigure", { plain: true }); L.fill(["cabinet"]); },
  waxshop(L) { L.wall("workbench", P(L)); some(L, "waxfigure", 2, { plain: true }); L.fill(["cabinet", "shelf"]); },
};
// A table and chairs round it.
function tableSet(L, chairs = 4, k = "table") { const t = L.centre(k); if (t) L.around(t, "chair", chairs); return t; }
// The museum style for a room (buildingmaps.js assemble): its plan leaf's mus mark. null: none.
/** @param {any} room */
export function museumStyle(room) {
  const style = room && room.mus && MUSEUM_STYLES[room.mus];
  return style || null;
}

// ======================================================================================
// The museums' signs of survival (interiorscenes.js registerScene; their own dice there, only on a museum laid out by
// these plans: when):
//   looted     a gallery's cases smashed and emptied, the looter who stayed too long among the glass;
//   shelter    a gallery or a hall used as a shelter: cots among the exhibits, the ones who never left;
//   vault      the collection store or the arms vault sealed from inside, its keeper with it;
//   closed     the director's notice at the front desk.
// ======================================================================================
const musRooms = (ctx, marks) => ctx.rng.shuffle(ctx.rooms.filter((r) => marks.includes(r.mus) && !r.scene && !r.locked));
const nearest = (cells, x, y) => cells.slice().sort((p, q) => Math.hypot(p[0] - x, p[1] - y) - Math.hypot(q[0] - x, q[1] - y));
const lower = (r) => String(r.name || "room").toLowerCase();
function looted(ctx) {
  const { rng } = ctx;
  for (const r of musRooms(ctx, ["gallery", "gems", "decor", "arms", "natgal"])) {
    const f = r.f || 0, free = rng.shuffle(ctx.freeIn(r));
    if (free.length < 4) continue;
    const [x, y] = free[0];
    ctx.body(f, x, y, { human: true });
    ctx.splatter(f, x, y, "human", 1);
    for (const [gx, gy] of free.slice(1, rng.int(3, 5))) { const c = ctx.at(f, gx, gy); if (c && c.k === "open") c.deco = { k: "glass", v: 0 }; }
    return ctx.done("musloot", r, x, y, `The cases in the ${lower(r)} are smashed and empty: whoever did it is still here among the glass.`);
  }
  return null;
}
function shelter(ctx) {
  const { rng } = ctx;
  for (const r of musRooms(ctx, ["gallery", "dinohall", "atrium", "atriumart", "atriumnat", "handson", "vehhall"])) {
    const f = r.f || 0, free = rng.shuffle(ctx.freeIn(r));
    if (free.length < 10) continue;
    const cots = Math.min(free.length - 2, rng.int(MUSEUM.SHELTER_COTS[0], MUSEUM.SHELTER_COTS[1]));
    for (const [x, y] of free.slice(0, cots)) ctx.piece(f, x, y, "cot");
    const dead = rng.int(0, 2);
    for (const [x, y] of free.slice(cots, cots + dead)) ctx.body(f, x, y, { human: true, quiet: true });
    const [cx, cy] = free[0];
    return ctx.done("musshelter", r, cx, cy, `The ${lower(r)} was a shelter: ${cots} cots among the exhibits${dead ? `, and ${dead} who never left` : ""}.`);
  }
  return null;
}
function vault(ctx) {
  const { rng } = ctx;
  for (const r of musRooms(ctx, ["musstore", "archive", "relics"])) {
    const f = r.f || 0, ds = r.doors || [];
    if (ds.length !== 1) continue;
    const [dx, dy] = ds[0], door = ctx.at(f, dx, dy);
    if (!door || !["idoor", "odoor"].includes(door.k)) continue;
    const free = ctx.inner(r).filter(([x, y]) => { const c = ctx.at(f, x, y); return c && c.k === "open" && !ctx.stair(x, y) && !ctx.used(f, x, y); });
    if (!free.length) continue;
    door.k = "door"; door.dk = "steel"; door.hp = door.mhp = 160;
    ctx.take(f, dx, dy);
    if (ctx.map.lockedDoors) ctx.map.lockedDoors.push({ x: dx, y: dy, f, area: r.id, kind: "door", dk: "steel" });
    if (f && rng.chance(SCENES.ALIVE)) return ctx.done("musvault", r, dx, dy, `The ${lower(r)} is sealed from inside: someone is still in there with the collection.`, { alive: true });
    const [x, y] = nearest(free, r.x0 + r.w / 2, r.y0 + r.h / 2)[0];
    ctx.body(f, x, y, { human: true, quiet: true, name: "The curator" });
    return ctx.done("musvault", r, dx, dy, `The ${lower(r)} sealed from inside: the curator shut themselves in with the collection and never came out.`);
  }
  return null;
}
function closed(ctx) {
  for (const r of musRooms(ctx, ["atrium", "atriumart", "atriumnat", "atriumsci", "atriummil", "atriumkids", "atriumair", "atriumcar", "atriumsea", "atriumpres", "frontdesk", "ticket"])) {
    const f = r.f || 0;
    const desk = ctx.inner(r).find(([x, y]) => (ctx.at(f, x, y) || {}).k === "counter");
    if (!desk) continue;
    const near = D4.map(([dx, dy]) => [desk[0] + dx, desk[1] + dy]).find(([x, y]) => ctx.free(f, x, y));
    if (near) { const c = ctx.at(f, near[0], near[1]); c.deco = { k: "papers", v: 0 }; ctx.take(f, near[0], near[1]); }
    const lines = [
      "THE MUSEUM IS CLOSED UNTIL FURTHER NOTICE. The collection has been secured. Please do not touch the exhibits. — The Director",
      "Staff: the paintings from the east galleries are in the store. Lock it behind you. Nobody in or out after dark.",
      "We took the children's group to the fairgrounds shelter. Water in the café. God help us.",
      "Everything here is irreplaceable. Take the food, leave the rest.",
    ];
    return ctx.done("musclosed", r, desk[0], desk[1], `A notice at the front desk: "${ctx.rng.pick(lines)}"`);
  }
  return null;
}
// Only on a museum laid out by these plans (when).
const isMuseumMap = (ctx) => ctx.rooms.some((r) => !!r.mus);
registerScene("musloot", { w: 4, place: looted, kinds: ["museum"], when: isMuseumMap });
registerScene("musshelter", { w: 3, place: shelter, kinds: ["museum"], when: isMuseumMap });
registerScene("musvault", { w: 3, place: vault, kinds: ["museum"], when: isMuseumMap });
registerScene("musclosed", { w: 4, place: closed, kinds: ["museum"], when: isMuseumMap });
