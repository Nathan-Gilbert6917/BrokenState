// The autopilot's play styles (src/sim/autopilot.js PERSONALITIES; the four newer ones added 2026-10-09 for the
// progression census: Diplomat, Hive hunter, Turtle, Expansionist). Checks that every style carries every knob the
// classic ones do, that a newer style shows the rest of the game its base style (state.governor.personality: the
// cards, diplomacy, prisoners, the retreat policy read it) while the governor uses its own knobs, that switching
// styles round-trips, and that short campaigns under each newer style run without a crash and play differently
// (the Turtle sends out fewer teams than the Expansionist, the Diplomat sends more envoys than Balanced).
// Usage: node tools/stylestest.js [days=100] [seeds=2]
//   BS_QUICK=1 in the environment (runtests.js --quick): 50-day campaigns on one seed unless the arguments say otherwise
//   (past day 40, when the envoys start: autopilot.js ENVOY_FROM).
import { createWorld, tickHour, day } from "../src/sim/world.js";
import { setAutopilot, setPersonality, autopilotPersonality, autopilotStats, PERSONALITIES, baseStyleOf } from "../src/sim/autopilot.js";
import { STYLE_POLICY } from "../src/sim/breakoff.js";

const QUICK = !!process.env.BS_QUICK;
const DAYS = Number(process.argv[2] || (QUICK ? 50 : 100));
const SEEDS = Number(process.argv[3] || (QUICK ? 1 : 2));
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };
const CLASSIC = ["cautious", "balanced", "aggressive"];
const NEWER = Object.keys(PERSONALITIES).filter((k) => !CLASSIC.includes(k));

console.log("The styles' knobs");
{
  const need = Object.keys(PERSONALITIES.balanced).filter((k) => k !== "lateConquer");
  for (const [k, P] of Object.entries(PERSONALITIES)) {
    const missing = need.filter((x) => P[x] === undefined);
    check(!missing.length, `${k}: every knob the Balanced style has${missing.length ? ` (missing ${missing.join(", ")})` : ""}`);
  }
  check(NEWER.length >= 2, `${NEWER.length} styles beyond the classic three (${NEWER.join(", ")})`);
  check(NEWER.every((k) => CLASSIC.includes(PERSONALITIES[k].base)), "each newer style leans on a classic one (base)");
  check(CLASSIC.every((k) => baseStyleOf(k) === k) && baseStyleOf("nonsense") === "balanced", "baseStyleOf: a classic style is its own base, an unknown one Balanced");
}

console.log("What the rest of the game sees");
{
  const st = createWorld({ seed: 3, factionCount: 6, size: "small" });
  st.started = true;
  for (const k of NEWER) {
    setAutopilot(st, false);
    setAutopilot(st, true, k);
    check(st.governor.personality === PERSONALITIES[k].base && autopilotPersonality(st) === k && STYLE_POLICY[st.governor.personality],
      `${k}: the governor plays ${PERSONALITIES[k].name}, the cards and the retreat policy see ${st.governor.personality}`);
  }
  setPersonality(st, "balanced");
  check(st.governor.personality === "balanced" && autopilotPersonality(st) === "balanced" && !st.governor.style, "back to Balanced: no newer style left behind");
  setPersonality(st, "turtle");
  check(st.governor.personality === "cautious" && autopilotPersonality(st) === "turtle", "setPersonality to the Turtle: Cautious to the rest of the game");
}

console.log(`Short campaigns (${DAYS} days, ${SEEDS} seeds, Normal map, 8 groups)`);
{
  const run = (seed, style) => {
    const st = createWorld({ seed, factionCount: 8 });
    st.started = true;
    setAutopilot(st, true, style);
    let envoys = 0, top = st.log[0], err = null;
    try {
      while (day(st) <= DAYS && !st.gameOver) {
        tickHour(st);
        for (let i = 0; i < st.log.length && st.log[i] !== top; i++) if (/an envoy to/.test(st.log[i].text)) envoys++;
        top = st.log[0];
      }
    } catch (e) { err = e.stack.split("\n").slice(0, 3).join(" | "); }
    const s = autopilotStats(st);
    return { err, launched: s.launched, outposts: st.bases.filter((b) => b.type === "outpost").length, envoys, fails: st.log.filter((l) => /autopilot error|governor error/i.test(l.text)).length };
  };
  const res = {};
  for (const style of ["balanced", ...NEWER]) {
    res[style] = [];
    for (let s = 1; s <= SEEDS; s++) res[style].push(run(400 + s, style));
    const r = res[style];
    check(r.every((x) => !x.err && !x.fails), `${style}: no crash, no governor error${r.find((x) => x.err) ? ` (${r.find((x) => x.err).err})` : ""} — trips ${r.map((x) => x.launched).join("/")}, outposts ${r.map((x) => x.outposts).join("/")}, envoys ${r.map((x) => x.envoys).join("/")}`);
  }
  const sum = (k, f) => res[k] ? res[k].reduce((a, x) => a + f(x), 0) : 0;
  if (res.turtle && res.expander) check(sum("turtle", (x) => x.launched) < sum("expander", (x) => x.launched), `the Turtle sends out fewer teams than the Expansionist (${sum("turtle", (x) => x.launched)} vs ${sum("expander", (x) => x.launched)})`);
  if (res.diplomat) check(sum("diplomat", (x) => x.envoys) >= sum("balanced", (x) => x.envoys), `the Diplomat sends at least as many envoys as Balanced (${sum("diplomat", (x) => x.envoys)} vs ${sum("balanced", (x) => x.envoys)})`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
