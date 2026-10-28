// Drinking un-purified water: a base's and a team's setting, and the card that asks (the user's request 2026-10-28:
// "When out of purified water you get the popup to allow your survivors to drink unpurified water. This setting can
// be controlled from the base UI and team UI").
//
// Each base and each team keeps its own setting (base.rawDrink, p.rawDrink; RAW_DRINK):
//   ask    (the default) the first time they would drink un-purified water as it is (their purified water gone), a
//          card asks: let them drink it, or purified water only. While it waits they hold off (the thirst gauges
//          fall); left unanswered TRAY_HOURS (as the card tray, cardrules.js) it takes its default, Let them drink
//          it: thirst kills faster than the worm. The answer becomes the setting.
//   yes    they drink it when the purified water is gone (the worm's eggs and sickness as before, worm.js).
//   no     purified water only: they go thirsty, and a base without purified water is out of water (economy.js
//          thirst: health, the parched mood) however much un-purified water it holds. Crops still get it.
// Water made safe as it is drunk is not "as it is": a team with a water filter, at a fed camp fire or carrying
// purification tablets drinks its un-purified water whatever the setting (worm.js teamTreatsWater). At a base the
// boiler, the filters and the tablets purify the stock at midnight (worm.js purifyDaily); what is left un-purified is
// drunk as it is.
// Where it applies: a base's hourly drinks (needs.js baseHour) and its midnight reckoning (economy.js baseDaily, which
// holds back only for "no": a question still waiting holds back the hours' drinks, not the day's); a team's water and
// the packs its people carry (needs.js teamNeedsHour). Not on a personal errand (their own pack, packed purified first).
// The settings are on the base's Overview (ui/needs.js rawDrinkRow) and the team panel's Eating card (teamNeedsBlock).
import { addCard, log } from "./world.js";
import { TRAY_HOURS, autoAnswer } from "./cardrules.js";

export const RAW_DRINK = {
  ask: { name: "Ask", desc: "Ask the first time the purified water runs out and only un-purified water is left (a card; left unanswered it lets them drink it)." },
  yes: { name: "Allow", desc: "When the purified water is gone they drink un-purified water rather than go thirsty: it can carry the worm's eggs and make them sick." },
  no: { name: "Never", desc: "Purified water only: without it they go thirsty (thirst costs health within a day or two). A water boiler, water filters or purification tablets make un-purified water safe." },
};
export const rawDrinkOf = (o) => (o && RAW_DRINK[o.rawDrink] ? o.rawDrink : "ask");
// Sets a base's or a team's setting. Returns the log line ("" when nothing changed).
export function setRawDrink(state, o, kind, name) {
  if (!o || !RAW_DRINK[kind] || rawDrinkOf(o) === kind) return "";
  o.rawDrink = kind;
  return `${name}: un-purified water ${kind === "yes" ? "allowed when the purified water is gone" : kind === "no" ? "never drunk (purified water only)" : "asked about when the purified water runs out"}.`;
}

const asking = (state, where, id) => (state.cards || []).find((c) => c.rawFor && c.rawFor.kind === where && c.rawFor.id === id) || null;

// May they drink un-purified water as it is now? Call it only when they would (no purified water left for the drink).
// "ask": the card comes (once while it waits) and they hold off. o: the base or the team; where: "base" | "team".
export function mayDrinkRaw(state, o, where, name) {
  const k = rawDrinkOf(o);
  if (k !== "ask") return k === "yes";
  if (!asking(state, where, o.id)) {
    addCard(state, {
      title: "Out of purified water",
      where: name,
      rawFor: { kind: where, id: o.id, at: state.hour },
      text: `${name} has no purified water left, only un-purified water (from a well, rain or a river). Drunk as it is, it can carry the worm's eggs and make people sick; a water boiler, water filters or purification tablets make it safe. Until you answer they hold off and go thirsty. This sets ${where === "base" ? "the base's" : "the team's"} water rule (${where === "base" ? "the Overview" : "the team panel"}, Un-purified water).`,
      choices: [
        { label: "Let them drink it", default: true, hint: "The worm and sickness risk, as the water carries it", resolve: (st) => { o.rawDrink = "yes"; return `${name} drinks un-purified water when the purified water is gone.`; } },
        { label: "Purified water only", hint: "They go thirsty until there is purified water", resolve: (st) => { o.rawDrink = "no"; return `${name} drinks purified water only.`; } },
      ],
    });
    log(state, `${name} is out of purified water: drink the un-purified water? (a card asks)`, "warn");
  }
  return false;
}

// Hourly (needs.js needsHour): a question left unanswered TRAY_HOURS takes its default (the card tray does the same in
// the browser; this keeps a run without a player, or with the tray's clock running, the same); one whose base or
// team is gone is dropped (cardrules.js trayStale).
export function rawAskHour(state) {
  for (const c of [...(state.cards || [])]) if (c.rawFor && state.hour - c.rawFor.at >= TRAY_HOURS) autoAnswer(state, c);
}
