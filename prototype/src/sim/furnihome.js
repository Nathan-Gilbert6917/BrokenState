// @ts-check
// Extracting with a piece of furniture or an appliance in the arms (issue #18, the user's request 2026-10-25: "You
// cannot hold these items in your arms and be taken back unless you have a vehicle then it automatically gets added to
// the vehicle inventory if you extract with something in your arms. If you do not have a vehicle show a message saying
// whatever appliances, furniture etc you were carrying was dropped due to exhaustion.").
//
//   At a raid's end (combat.js endRaid → piecesAtExtraction, before endBodies and raidHome): every piece still in the
//     arms (furnicarry.js carriedPiece; a pair's one item counted once) of someone who got out (u.left, alive; a pair
//     both of them) goes:
//     - with a vehicle (the team's car or truck kept: someone left in it, endRaid's vehicleKept; bikes: a piece of at
//       most a rack's 15 kg, within the racks' room, raidloot.js trunkSpace) into its cargo (parties.js addGearToCargo, the room as furnicarry.js stowAct's:
//       homeRoom) with a line ("Dana and Lee heaved the refrigerator into the pickup."), and into the raid's loot;
//     - the car or truck too full for it: set down at the exit (placeNear: the free cells nearest where the carrier
//       left) with its own line ("The pickup is full: the stove stays by the door.");
//     - no vehicle (or bikes that cannot take it: a bike is no vehicle for a fridge): set down at the exit the same
//       way, and the message (exhaustText: "Exhausted, the team dropped what
//       it was carrying: a refrigerator, two chairs. …") in the raid's summary, the log (scavenge.js afterRaid) and so
//       the alerts (ui/alerts.js events, warn).
//     Set down at the exit of a point of interest, the piece is kept in the POI's ledger (poicont.js poi.cont.pieces:
//     pieceLedger / applyPieceLedger, every cell a piece left or was set on in a raid: furnicarry.js touchPiece), so
//     the next raid finds it standing by the door, to be lifted again (and the cell it was lifted off stays empty).
//     Anywhere else (a street fight, a raid on a tile with no POI) the map is gone with the raid: the piece is lost,
//     with the same message.
//     One of a pair out and the other not (down, left behind): the piece is set down where they parted (tetherRound,
//     then placeNear at the one still there), kept in the ledger as above.
//   A city crawl's place (setup.handler "crawl"): the team is still in the city, so a piece carried out of a building
//     stays in the arms (marked it.crawl); its weight slows the walk from block to block (crawlMoveHours: the hour ÷ the
//     slowest carrier's load band pace) and the crawl card lists it (crawlPieces). Leaving the city (citycrawl.js
//     finishCrawl) the same rule by the team's vehicle (piecesOut): into its cargo, else dropped from exhaustion and lost
//     (the rim is no building). A piece set down inside a place stays in its snapshot (citycrawl.js snapshotBuilding).
//   The warning before leaving (extractNote): the Extract button's tooltip (ui/combat.js) and the extract order's own
//     line say what will happen to the piece; the raid bot sets a piece down before it extracts without a vehicle
//     (combat.js autoRaidTurn).
//   Not here: the hour-by-hour search (scavenge.js searchHour / extract, Overrun and Swarming too) and a raid by the
//     numbers use no arms (nothing is lifted without a map), and a piece carried on the road (a fridge hauled home, or
//     a load set down at a raid's start, carry.js stageLoads, and handed back after) keeps #12's road rules.
//   AI parity (docs/adr/0001-ai-parity.md): other groups' raids carry a piece only when they came by vehicle
//     (grouppois.js raidPoiAsGroup opts.vehicle, given by aiscav.js from the party's vehicle): the one check, no card.
import { survivorById, log } from "./world.js";
import { itemLoad } from "./inventory.js";
import { addGearToCargo, cargoRoom, partyMembers, teamName } from "./parties.js";
import { isBike, isCar, partyVehicle, VEHICLE_TYPES } from "./vehicles.js";
import { personLoad, wornLoad } from "./load.js";
import { carriedPiece, endCarry, placeNear, tetherRound, isPieceItem, pieceKindOf, liftDef } from "./furnicarry.js"; // call-time only
import { trunkVehicle, trunkSpace, raidParty } from "./raidloot.js"; // call-time only
import { carRoom } from "./carriers.js"; // call-time only
import { say } from "./combat.js"; // call-time only

const first = (u) => String((u && u.name) || "").split(" ")[0];
const cap1 = (t) => t.charAt(0).toUpperCase() + t.slice(1);
const NUM = ["no", "a", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const plural = (w) => (/(s|sh|ch|x)$/.test(w) ? `${w}es` : `${w}s`);
// "a refrigerator, two chairs" (the names in the order they first come).
export function piecesText(names) {
  const n = new Map();
  for (const w of names) n.set(w, (n.get(w) || 0) + 1);
  return [...n].map(([w, k]) => (k === 1 ? `${/^[aeiou]/.test(w) ? "an" : "a"} ${w}` : `${NUM[k] || k} ${plural(w)}`)).join(", ");
}
// The message (the user's: "dropped due to exhaustion"). ledger: it stands at a POI's door, kept for the next visit.
export function exhaustText(names, ledger) {
  const one = names.length === 1;
  return `Exhausted, the team dropped what it was carrying: ${piecesText(names)}. ${ledger ? `${one ? "It stands" : "They stand"} by the door: come back with a vehicle to take ${one ? "it" : "them"}.` : `Nobody can come back for ${one ? "it" : "them"}: ${one ? "it is" : "they are"} lost.`}`;
}
const vehWord = (v) => (isBike(v) ? `the bicycle rack${(v.count || 1) > 1 ? "s" : ""}` : `the ${String(v.name || "vehicle").toLowerCase()}`);

// The team's vehicle on a raid map and the kg it takes now (furnicarry.js stowRefusal's room: the trunk, less the bodies
// in it; bikes: the racks): { v, room, name } or null without one.
export function homeRoom(state, b) {
  const v = trunkVehicle(state, b);
  if (!v) return null;
  const space = trunkSpace(state, b);
  return { v, room: Math.min(space == null ? Infinity : space, carRoom(state, b)), name: vehWord(v) };
}

// combat.js endRaid, before endBodies and raidHome. kept: the vehicle goes home (someone left in it). Returns
// { loaded, full, dropped (the pieces' names), ledger (set down at a POI's door, kept), text (the exhaustion message,
// "" without), fullText, lines, items (the ones loaded) }.
export function piecesAtExtraction(state, b, kept) {
  const R = b.raid;
  const res = { loaded: [], full: [], dropped: [], ledger: !!(R && R.poiMap), text: "", fullText: "", lines: [], items: [] };
  if (!R) return res;
  tetherRound(state, b); // a pair parted on the way out: set down where they parted
  const crawl = !!(b.setup && b.setup.handler === "crawl");
  const veh = kept ? homeRoom(state, b) : null;
  const p = raidParty(state, b);
  let room = veh ? veh.room : 0;
  const out = (x) => !!(x && x.left && !x.dead);
  for (const u of b.units) {
    if (u.side !== "player") continue;
    const P = carriedPiece(b, u);
    if (!P || P.carrier !== u) continue; // a pair's item once, from the one holding it
    const o = P.partner, name = P.def.name.toLowerCase();
    if (!out(u) || (o && !out(o))) { // one of them still on the map: set down there
      const at = !out(u) ? u : o;
      if (!placeNear(state, b, P, at.x, at.y)) endCarry(state, b, P);
      res.lines.push(`The ${name} is set down where ${o ? `${first(u)} and ${first(o)} parted` : `${first(u)} stood`}.`);
      continue;
    }
    const who = [u, o].filter(Boolean).map(first).join(" and ");
    if (crawl) { // citycrawl.js: still in the city; the walk out to the rim is the way out (piecesOut)
      P.item.crawl = true;
      if (o && o.sid != null) P.item.mate = o.sid; // citycrawl.js notePieces (issue #21): the other end, for the walk block to block
      endCarry(state, b, P);
      const s = survivorById(state, u.sid);
      if (s) s.gear.carry = P.item; // endCarry emptied the arms: the item stays in them, off the map
      continue;
    }
    const kg = itemLoad(P.item);
    if (veh && p && kg <= room + 1e-6 && (!isBike(veh.v) || kg <= VEHICLE_TYPES.bike.rack) && addGearToCargo(state, p, P.item)) { // bikes: on one rack
      room -= kg;
      endCarry(state, b, P);
      res.loaded.push(name);
      res.items.push(P.item); // endRaid: into the raid's loot
      res.lines.push(`${who} heaved the ${name} ${isBike(veh.v) ? "onto" : "into"} ${veh.name}.`);
      continue;
    }
    if (!placeNear(state, b, P, u.x, u.y)) endCarry(state, b, P); // at the exit; no free cell near it: lost
    if (veh && !isBike(veh.v)) res.full.push(name); else res.dropped.push(name); // a bike is no vehicle for a piece its racks cannot hold
  }
  if (res.full.length) {
    const many = res.full.length > 1;
    res.fullText = `${cap1(veh.name)} ${isBike(veh.v) ? "are" : "is"} full: ${many ? piecesText(res.full) : `the ${res.full[0]}`} ${res.ledger ? `stay${many ? "" : "s"} by the door` : `${many ? "are" : "is"} left by the door and lost`}.`;
    res.lines.push(res.fullText);
  }
  if (res.dropped.length) { res.text = exhaustText(res.dropped, res.ledger); res.lines.push(res.text); }
  for (const l of res.lines) say(b, l, l === res.text || l === res.fullText ? "warn" : "good");
  return res;
}

// The words before leaving (the Extract button's tooltip, the extract order's line): what becomes of the piece u
// carries when it extracts now; "" carrying none.
export function extractNote(state, b, u) {
  const P = b && u ? carriedPiece(b, u) : null;
  if (!P) return "";
  const name = P.def.name.toLowerCase();
  if (b.setup && b.setup.handler === "crawl") return `The ${name} comes out of the building with them: it slows the walk from block to block, and only a vehicle takes it home from the city.`;
  const veh = homeRoom(state, b);
  if (!veh) return `No vehicle: the ${name} will be dropped at the door (too exhausted to carry it home).`;
  const kg = itemLoad(P.item);
  if (isBike(veh.v) && (kg > VEHICLE_TYPES.bike.rack || kg > veh.room + 1e-6)) return `No vehicle for it: the ${name} does not go on ${veh.name} and will be dropped at the door (too exhausted to carry it home).`;
  if (kg > veh.room + 1e-6) return `No room for the ${name} in ${veh.name}: it will be set down at the door.`;
  return `The ${name} goes into ${veh.name} (if the vehicle goes home with the team).`;
}
// The raid bot (combat.js autoRaidTurn): never out with a piece and no vehicle to take it.
export const pieceGoesHome = (state, b, u) => { const P = carriedPiece(b, u); const veh = P ? homeRoom(state, b) : null; return !P || (!!veh && itemLoad(P.item) <= veh.room + 1e-6 && (!isBike(veh.v) || itemLoad(P.item) <= VEHICLE_TYPES.bike.rack)); };

// ---------- without a map: the walk out of a city ----------
// The pieces a team's people hold in their arms out of a crawl's buildings (it.crawl): [{ s, item, def }].
export function crawlPieces(state, p) {
  const out = [];
  for (const s of partyMembers(state, p)) {
    const it = s.gear && s.gear.carry;
    if (it && it.crawl && isPieceItem(it)) out.push({ s, item: it, def: liftDef(pieceKindOf(it)) });
  }
  return out;
}
// The hours a block's walk takes (citycrawl.js nextBlock): the hour ÷ the slowest piece carrier's pace (their load
// band, load.js personLoad: an overloaded carrier 0.55, so 2 hours).
export function crawlMoveHours(state, p, hours) {
  const L = crawlPieces(state, p);
  if (!L.length) return hours;
  const pace = Math.min(...L.map(({ s }) => personLoad(s, wornLoad(s)).speed));
  return Math.max(hours, Math.ceil(hours / Math.max(0.1, pace) - 1e-9));
}
// Out of the city (citycrawl.js finishCrawl): each piece into the team's vehicle (a car or truck; bikes: one within a
// rack's room), else dropped from exhaustion, lost. Logs the lines; returns { loaded, dropped, text }.
export function piecesOut(state, p) {
  const res = { loaded: [], dropped: [], text: "" };
  const v = partyVehicle(state, p);
  for (const { s, item, def } of crawlPieces(state, p)) {
    delete item.crawl;
    s.gear.carry = null;
    const name = def ? def.name.toLowerCase() : item.name.toLowerCase();
    const fits = !!v && (isCar(v) || (isBike(v) && itemLoad(item) <= VEHICLE_TYPES.bike.rack)) && itemLoad(item) <= cargoRoom(state, p) + 1e-6; // bikes: on one rack
    if (fits && addGearToCargo(state, p, item)) { res.loaded.push(name); log(state, `${first(s)} heaved the ${name} ${isBike(v) ? "onto" : "into"} ${vehWord(v)}.`, "good"); }
    else res.dropped.push(name);
  }
  if (res.dropped.length) { res.text = exhaustText(res.dropped, false); log(state, `${teamName(state, p)}: ${res.text}`, "warn"); }
  return res;
}

// ---------- a point of interest's ledger (poicont.js) ----------
// The cells a piece left or was set on (furnicarry.js touchPiece: b.raid.pieceCells) as they are now: [{ f, x, y,
// cell }] (the cell's own fields), for poi.cont.pieces[mapId].
const KEEP = ["k", "hp", "mhp", "moved", "frame", "dk", "roll", "t", "tOpen", "pc", "fc", "wart", "under", "boards", "held"];
const cellsOn = (b, f) => (b.floors ? b.floors[f] && b.floors[f].cells : f === 0 ? b.cells : null);
export function pieceLedger(b) {
  const T = b && b.raid && b.raid.pieceCells;
  if (!T || !T.length) return [];
  const out = [];
  for (const key of T) {
    const [f, x, y] = key.split(",").map(Number);
    const cells = cellsOn(b, f), c = cells && cells[y * b.w + x];
    if (!c) continue;
    const cell = {};
    for (const k of KEEP) if (c[k] !== undefined) cell[k] = JSON.parse(JSON.stringify(c[k]));
    out.push({ f, x, y, cell });
  }
  return out;
}
// The ledger's list with a raid's cells over it (the newer one wins on a cell).
export const mergePieceLedger = (old, now) => [...(old || []).filter((o) => !now.some((n) => n.f === o.f && n.x === o.x && n.y === o.y)), ...now];
// A revisit: the cells put back as the ledger kept them (poicont.js poiRaidStart). Returns how many.
export function applyPieceLedger(b, list) {
  if (!b || !Array.isArray(list) || !list.length) return 0;
  let n = 0;
  for (const o of list) {
    const cells = cellsOn(b, o.f), c = cells && cells[o.y * b.w + o.x];
    if (!c || !o.cell) continue;
    for (const k of KEEP) delete c[k];
    Object.assign(c, JSON.parse(JSON.stringify(o.cell)));
    n++;
  }
  if (n) { if (b.losCache) b.losCache.fill(0); if (b.floors) for (const F of b.floors) if (F.losCache) F.losCache.fill(0); }
  return n;
}
