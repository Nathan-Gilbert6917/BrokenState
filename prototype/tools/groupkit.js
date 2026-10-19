// Test helper: a group's best mechanic is one of its people (groupworks.js groupSkill; docs/adr/0001-ai-parity.md), so a
// test that wants "a commune's Mechanics 3" sets it on them: every member at an effective n (traits and gear count).
import { ensureMembers, syncMembers, membersOf } from "../src/sim/members.js";
import { skill } from "../src/sim/world.js";

export function setGroupSkill(state, f, key, n) {
  ensureMembers(state, f); syncMembers(state, f);
  for (const s of membersOf(f)) { s.skills[key] = n; s.skills[key] = Math.max(0, 2 * n - skill(s, key)); }
}
export const setMech = (state, f, n) => setGroupSkill(state, f, "mechanics", n);
