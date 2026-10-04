// Counts which event cards and key log lines appear over a long headless run.
import { createWorld, tickHour, day } from "../src/sim/world.js";
import { HUB_EVENTS } from "../src/sim/hubevents.js";
const counts = {};
let raidsOnPlayer = 0, helpCalls = 0;
const hubEvents = {}, recruits = {}, warnings = { first: 0, second: 0 }; // hubevents.js, recruits.js, morale.js
for (const seed of [1, 2, 3, 4, 5]) {
  const state = createWorld({ seed, factionCount: 8 });
  // Put the hub under pressure: make every group aware of it.
  while (day(state) <= 90 && !state.gameOver) {
    tickHour(state);
    while (state.cards.length) {
      const c = state.cards.shift();
      counts[c.title.replace(/[A-Z][a-z]+ [A-Z][a-z]+|\d+/g, "#")] = (counts[c.title.replace(/[A-Z][a-z]+ [A-Z][a-z]+|\d+/g, "#")] || 0) + 1;
      if (c.title.startsWith("Raiders heading")) raidsOnPlayer++;
      if (c.title.includes("asks for help")) helpCalls++;
      if (c.hubEvent) hubEvents[c.hubEvent] = (hubEvents[c.hubEvent] || 0) + 1;
      if (c.recruit) recruits[c.recruit.source] = (recruits[c.recruit.source] || 0) + 1;
      if (c.moraleFor != null) warnings[/close to leaving/.test(c.title) ? "second" : "first"]++;
      const ch = (c.choices.find((x) => x.label === "Return home") || c.choices.find((x) => !(typeof x.disabled === "function" ? x.disabled(state) : x.disabled)));
      ch && ch.resolve(state);
    }
    state.engagement = null;
    state.trade = null;
  }
  console.log(`seed ${seed}: day ${day(state)}, alive ${state.survivors.filter((s) => s.alive).length}, game over ${state.gameOver}`);
}
console.log({ raidsOnPlayer, helpCalls });
console.log(counts);
console.log("Hub events (hubevents.js):", Object.keys(HUB_EVENTS).map((id) => `${id} ${hubEvents[id] || 0}`).join(", "));
console.log("Recruit cards by source (recruits.js):", JSON.stringify(recruits), " Morale warning cards:", JSON.stringify(warnings));
