// The worm in a living person (lore: Help, The dead and the worm): the dead carry a tapeworm; a worm swarm's bite can
// leave it in someone (carriers.js, CARRIER.INFEST), and whoever has it gets up as one of the dead when they die,
// wherever and whenever that is (carriers.js riseOnMap; in a battle the body gets up where they fell).
// This is the whole of the condition for now: a flag on the survivor (s.worm = { day, from }). Every caller goes
// through these three functions, so the real staged condition and its treatment can replace the insides later.
import { day, log } from "./world.js";

// The worm gets into someone. cause: a short phrase for the log ("a worm swarm's bite"). Returns true if new.
export function catchWorm(state, s, cause = "the worm") {
  if (!s || !s.alive || s.worm) return false;
  s.worm = { day: day(state), from: String(cause) };
  log(state, `${s.name} has the worm (${cause}). It is in them now: if they die, they will get up.`, "danger");
  return true;
}
export const hasWorm = (s) => !!(s && s.worm);
export function clearWorm(s) {
  if (!s || !s.worm) return false;
  s.worm = null;
  return true;
}
