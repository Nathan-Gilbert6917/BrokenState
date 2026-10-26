// What a team's land order would bring (the user's request 2026-10-23: "For gathering LAND orders for Forage, Hunt,
// Fish, Cut Wood, Gather Stones when you select provide a input dialogue to set how many hours and estimated amount of
// yield depending on how many hours and the gear of the team/survivor(s) inventory and skills"). Nothing new in the sim:
// each job's own expectation (foraging.js expectForage, hunting.js expectHunt and expectFish, woodcutting.js
// expectWood, stone.js expectStone), for the hours asked, the team as it is (each person's skills, health and the tool
// or weapon they would use, the spare gear in the cargo), the land and the season, the clock from when it would start,
// and what the team can still carry. The box is ui/landorder.js; tools/landordertest.js.
//
// landEstimate(state, p, type, { tile, hours, startHour, qty }) →
//   { type, verb, unit, key, amount (kept), all (worked), kg, perHour, room, capped (by what fits), why (cannot),
//     crew: [{ name, gear, mult, skills }], notes: [..] }
// landEstimates(state, p, type, hoursList, opts) → [{ hours, amount }] for the box's comparison row.
import { SUPPLIES } from "./data.js";
import { skill } from "./world.js";
import { hasPerk } from "./skills.js";
import { partyMembers, partyTile, cargoRoom } from "./parties.js";
import { HUNT, MEAT_KG, partyHuntTeam, expectHunt, huntProblem, fishSpot, fishKit, expectFish, fishProblem, fisherMult, frozenAt, carriedItems, gameAbundance, gameLevel, gameWord } from "./hunting.js";
import { expectForage, forageProblem, foragerMult, forageKg, forageAbundance, forageLevel, forageWord, seasonForage } from "./foraging.js";
import { chopCrew, chopPower, expectWood, woodProblem, woodTime, woodAbundance, woodLevel, woodWord } from "./woodcutting.js";
import { quarryCrew, quarryPower, expectStone, stoneProblem, stoneAbundance, stoneWord } from "./stone.js";
import { clockText } from "./parties.js";

export const LAND_JOBS = ["forage", "hunt", "fish", "wood", "stone"];
export const isLandJob = (type) => LAND_JOBS.includes(type);
export const LAND_VERB = { forage: "Forage", hunt: "Hunt", fish: "Fish", wood: "Cut wood", stone: "Gather stone" };
// In half hours from 30 minutes (the user's request 2026-10-26: "Allow for doing gathering missions by 30 minutes instead
// of by hours ... Minimum is 30 min orders"); orders.js huntHours clamps to these.
export const LAND_HOURS = { min: HUNT.minHours, max: HUNT.maxHours, def: HUNT.defHours, step: 0.5, presets: [0.5, 1, 2, 4, 8, 12, 24] };
export const clampHours = (h) => Math.max(LAND_HOURS.min, Math.min(LAND_HOURS.max, Math.round((Number(h) || LAND_HOURS.def) / LAND_HOURS.step) * LAND_HOURS.step));
export const landHoursText = (h) => clockText(h); // "30m", "2h 30m", "8h"

const r1 = (x) => Math.round(x * 10) / 10;
const first = (s) => String(s.name).split(" ")[0];
const skillsText = (s, keys) => keys.map(([k, w]) => `${w} ${skill(s, k)}`).join(", ");
// Hours of daylight work in the span (woodTime 1: 7:00 to 18:00; dusk and night count for little); a half hour at the end counts half.
const daylightHours = (startHour, hours) => { let n = 0; for (let h = 1; h - 1 < hours - 1e-9; h++) if (woodTime(startHour + h) >= 1) n += Math.min(1, hours - h + 1); return n; };

export function landEstimate(state, p, type, { tile = partyTile(p), hours = LAND_HOURS.def, startHour = state.hour, qty = null } = {}) {
  hours = clampHours(hours);
  const members = partyMembers(state, p);
  const gear = (p.cargo && p.cargo.gear) || [];
  const room = cargoRoom(state, p);
  const out = { type, verb: LAND_VERB[type], hours, startHour, room, amount: 0, all: 0, kg: 0, perHour: 0, capped: false, why: "", crew: [], notes: [] };
  if (!members.length) { out.why = "nobody in the team."; return out; }
  const cap = (amount, unitKg) => {
    let kept = amount;
    if (qty != null && Number.isFinite(Number(qty)) && Number(qty) >= 0) kept = Math.min(kept, Number(qty));
    out.amount = r1(kept);
    out.kg = r1(kept * unitKg);
    out.perHour = hours ? kept / hours : 0;
    out.capped = out.all > out.amount + 0.5;
  };
  if (type === "forage") {
    out.why = forageProblem(state, p, tile);
    out.unit = "days of food"; out.key = "food";
    const e = expectForage(state, members, tile, hours, startHour, room);
    out.all = e.all;
    cap(e.rations, forageKg(state, startHour));
    out.crew = members.map((s) => ({ name: first(s), gear: "hands and a sack", mult: foragerMult(s), skills: `${skillsText(s, [["farming", "Farming"], ["scouting", "Scouting"]])}${hasPerk(s, "forager") ? ", Forager perk" : ""}` }));
    out.notes.push(`Wild food ${forageWord(forageAbundance(state, tile) * forageLevel(state, tile) * Math.min(1, seasonForage(state, startHour)))} here; the season ×${r1(seasonForage(state, startHour))}. Best by day; the land thins as it is picked.`);
  } else if (type === "hunt") {
    out.why = huntProblem(state, p, tile);
    out.unit = "days of food in raw meat"; out.key = "meat";
    const t = partyHuntTeam(state, p, members);
    if (t.why) { out.why = out.why || t.why; }
    const e = t.why ? null : expectHunt(state, t.team, tile, hours, startHour, t.loud, room);
    if (e) {
      out.all = e.all;
      cap(e.rations, MEAT_KG);
      out.shots = e.shots; out.arrows = e.arrows;
      out.notes.push(`About ${r1(e.big)} big game and ${r1(e.small)} small game${e.shots >= 0.5 ? `, ~${Math.round(e.shots)} shots (Heat; they can draw the dead)` : ""}${e.arrows >= 0.5 ? `, ~${Math.round(e.arrows)} arrows lost` : ""}.`);
    }
    const hs = new Map(t.hs.map((h) => [h.s.id, h]));
    out.crew = members.map((s) => {
      const h = hs.get(s.id);
      return { name: first(s), gear: h ? (h.item ? h.item.name : "a hunting weapon") : "no hunting weapon: beats the bush", mult: h ? h.big + 0.3 * h.small : 0, skills: `${skillsText(s, [["shooting", "Shooting"], ["scouting", "Scouting"], ["stealth", "Stealth"]])}${hasPerk(s, "hunter") ? ", Hunter perk" : ""}` };
    });
    out.notes.push(`Game ${gameWord(gameAbundance(state, tile) * gameLevel(state, tile))} here. Dawn and dusk are best, night poor. Fresh game weighs ${MEAT_KG} kg a day of food and spoils fast.`);
  } else if (type === "fish") {
    out.why = fishProblem(state, p, tile);
    out.unit = "days of food in fish"; out.key = "meat";
    const frozen = frozenAt(state, startHour);
    const kit = fishKit(members, gear, { frozen });
    const e = kit.power ? expectFish(state, kit, tile, hours, startHour, room) : { rations: 0, all: 0 };
    out.all = e.all;
    cap(e.rations, MEAT_KG);
    const used = new Set(kit.tools);
    const own = (s) => carriedItems(s).filter((it) => used.has(it));
    out.crew = members.map((s) => ({ name: first(s), gear: own(s).map((it) => it.name).join(", ") || "no tool of their own", mult: fisherMult(s), skills: `${skillsText(s, [["scouting", "Scouting"], ["stealth", "Stealth"]])}${hasPerk(s, "forager") ? ", Forager perk" : ""}` }));
    out.kit = `${kit.rods} rod${kit.rods === 1 ? "" : "s"}, ${kit.nets} net${kit.nets === 1 ? "" : "s"}, ${kit.spears} spear${kit.spears === 1 ? "" : "s"}${kit.ice ? ", an ice tool" : ""}: ${kit.used} of the team fishing`;
    const spot = fishSpot(state, tile);
    if (spot) out.notes.push(`Fishing in ${spot.name}${frozen ? kit.ice ? " through the ice (half the catch; no spears)" : ": frozen over and no ice tool" : ""}. Dawn and dusk are best. Quiet.`);
  } else if (type === "wood") {
    out.why = woodProblem(state, p, tile);
    out.unit = "wood"; out.key = "wood";
    const crew = chopCrew(members, gear);
    const e = expectWood(state, members, tile, hours, startHour, room, chopPower(crew));
    out.all = e.all;
    cap(e.wood, SUPPLIES.wood.weight);
    out.crew = crew.map((c) => ({ name: first(c.s), gear: c.tool ? c.tool.name : "bare hands (deadfall)", mult: c.mult, skills: skillsText(c.s, [["farming", "Farming"], ["mechanics", "Mechanics"]]) }));
    out.daylight = daylightHours(startHour, hours);
    out.notes.push(`Wood ${woodWord(woodAbundance(state, tile) * woodLevel(state, tile))} here. Daylight only: ${clockText(out.daylight)} of the ${clockText(hours)} in daylight. Loud (Heat); axes slip now and then.`);
  } else if (type === "stone") {
    out.why = stoneProblem(state, p, tile);
    out.unit = "stone"; out.key = "stone";
    const crew = quarryCrew(members, gear);
    const e = expectStone(state, tile, hours, startHour, room, quarryPower(crew));
    out.all = e.all;
    cap(e.stone, SUPPLIES.stone.weight);
    out.crew = crew.map((c) => ({ name: first(c.s), gear: c.tool ? c.tool.name : "bare hands", mult: c.mult, skills: skillsText(c.s, [["farming", "Farming"], ["mechanics", "Mechanics"]]) }));
    out.daylight = daylightHours(startHour, hours);
    out.notes.push(`Stone ${stoneWord(stoneAbundance(state, tile))} here (it never runs out). Daylight only: ${clockText(out.daylight)} of the ${clockText(hours)} in daylight. A pickaxe or a sledgehammer about doubles it.`);
  } else out.why = "not a land job.";
  return out;
}

export const landEstimates = (state, p, type, hoursList, opts = {}) => hoursList.map((hours) => ({ hours, amount: landEstimate(state, p, type, { ...opts, hours }).amount }));
