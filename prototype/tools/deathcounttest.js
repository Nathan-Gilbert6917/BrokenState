// The long-run tools' death count (tools/deathcount.js, used by campaign50.js and wintest.js): one death per survivor,
// classified by world.js killSurvivor's line. Someone who dies with the worm in them logs a second "died" line when
// they get up again (worm.js riseAtBase, roadRise): counting lines made every worm death two, and a horde death of a
// carrier one horde and one worm.
// Usage: node tools/deathcounttest.js [seed]
import { createWorld, hub, atBase, hurt } from "../src/sim/world.js";
import { catchWorm } from "../src/sim/worm.js";
import { desert } from "../src/sim/morale.js";
import { deathCounter, deathCause } from "./deathcount.js";

const seed = Number(process.argv[2] || 7);
let pass = 0, fail = 0;
const check = (ok, what) => { if (ok) pass++; else fail++; console.log(`  ${ok ? "ok  " : "FAIL"} ${what}`); return ok; };

const state = createWorld({ seed, factionCount: 4 });
state.started = true;
const h = hub(state);
const count = deathCounter(state);
// The new log lines since `top` (newest first, as state.log keeps them).
const since = (top) => { const out = []; for (let i = 0; i < state.log.length && state.log[i] !== top; i++) out.push(state.log[i]); return out; };
const lineCount = (fresh) => fresh.filter((l) => l.kind === "death" && / died /.test(l.text)).length; // the old way

console.log("The worm kills someone at the hub: they get up again (two death lines), one death");
const [a, b0, c0, d0] = atBase(state, h.id);
let b = b0, c = c0, d = d0; // (the living ones after a turns: a's rising may have killed one of them)
let top = state.log[0];
catchWorm(state, a, "drinking un-purified water at the test", "water");
hurt(state, a, 999, h.tile, "of the worm", { raw: true });
let fresh = since(top);
check(lineCount(fresh) >= 2, `the death and the rise are both "died" lines (${lineCount(fresh)})`);
let got = count(fresh);
check(got.length === 1 && got[0].s === a, "counted once");
check(got[0] && got[0].cause === "worm", `as the worm (${got[0] && got[0].cause}: "${got[0] && got[0].text}")`);

console.log("A carrier killed by a horde: one horde death, not a worm death too");
[b, c, d] = atBase(state, h.id).filter((x) => x.alive && x !== a);
top = state.log[0];
// (someone who catches it: an Iron Stomach shrugs eggs off now and then, by its own dice)
b = [b, c, d, ...atBase(state, h.id)].find((x) => x && x.alive && x !== a && catchWorm(state, x, "drinking un-purified water at the test", "water"));
[c, d] = atBase(state, h.id).filter((x) => x.alive && x !== a && x !== b);
hurt(state, b, 999, h.tile, "when the horde broke through");
fresh = since(top);
got = count(fresh);
check(lineCount(fresh) >= 2, `two "died" lines (${lineCount(fresh)})`);
check(got.length === 1 && got[0].cause === "horde", `one death, the horde (${got.map((x) => x.cause).join(", ")})`);

console.log("Nothing new: nothing counted again; someone who walks away is not a death");
check(count(since(state.log[0])).length === 0, "the same dead are not counted twice");
top = state.log[0];
desert(state, h, c, { haul: false });
got = count(since(top));
check(c.left && got.length === 0, "a deserter is not counted as a death");

console.log("An ordinary death: one line, one death");
top = state.log[0];
hurt(state, d, 999, h.tile, "of thirst", { raw: true });
got = count(since(top));
check(got.length === 1 && got[0].cause === "thirst", `thirst (${got.map((x) => x.cause).join(", ")})`);
check(deathCause("Tom Reyes died when Ann turned (the worm).") === "worm", "killed by someone turning counts as the worm");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
