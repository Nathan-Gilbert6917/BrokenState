// Children and families on screen (sim/family.js):
// - familyChip: a chip on a People tab card (expecting, children);
// - familyBlock: the survivor screen's Family line (partner, children, parents, expecting, the chance of a child);
// - childrenPeople: the People tab's children at each base (an age stage icon, age, parents, chores);
// - rosterChildren: the roster's Children table under the survivors.
// Children are not survivors: no role, gear or survivor screen; a parent's name opens theirs.
import { baseById, survivorById, day } from "../sim/world.js";
import { TRAITS, SKILL_NAMES } from "../sim/data.js";
import {
  FAMILY, STAGES, childrenOf, stageOf, ageOf, daysToAdult, familyOfPerson, familyOn, conceiveInfo, birthRisk,
} from "../sim/family.js";
import { appearanceURL, spriteImg } from "./sprites.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => String(s.name).split(" ")[0];
const pct = (v) => `${Math.round(v * 1000) / 10}%`;
const SIZE = { baby: 1.0, child: 1.25, youth: 1.45 };

// A parent's name: a link to their survivor screen (a † when they are gone).
const personLink = (p) => (p && p.id != null && p.alive !== undefined ? `<a class="link" data-action="survivor" data-id="${p.id}">${esc(p.name)}</a>${p.alive ? "" : " †"}` : esc(p ? p.name : "?"));
function parentsText(state, c) {
  const list = (c.parents || []).map((id, i) => survivorById(state, id) || { name: (c.parentNames || [])[i] || "?", alive: false });
  return list.length ? list.map(personLink).join(" & ") : `<span class="muted">unknown</span>`;
}
// "Child · 52 days old · grows up in 60 days"
export function childAgeText(state, c) {
  const st = STAGES[stageOf(c)];
  const left = daysToAdult(c);
  return `${st.name} · ${ageOf(state, c)} day${ageOf(state, c) === 1 ? "" : "s"} old · grows up in ${left} day${left === 1 ? "" : "s"}`;
}
function childTip(state, c) {
  const st = stageOf(c);
  const lines = [`${c.name}: ${childAgeText(state, c)}.`, STAGES[st].desc, `Eats ${FAMILY.food[st]} of a ration a day.`];
  if (c.chores) lines.push(`Chores so far: ${c.chores} food from the fields and the kitchen.`);
  if (c.hungry) lines.push(`Hungry for ${c.hungry} day${c.hungry === 1 ? "" : "s"}: not growing while there is nothing to eat.`);
  const seen = Object.entries(c.seen || {}).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k]) => SKILL_NAMES[k] || k);
  if (seen.length) lines.push(`Picking up ${seen.join(" and ")} from watching the work here.`);
  lines.push("Children never go on teams, stand guard or fight: they shelter in raids and horde attacks.");
  return lines.join(" ");
}
// One child as a small card (People tab).
export function childCard(state, c) {
  const st = stageOf(c);
  return `<div class="card surv child"${tip(childTip(state, c))}>
    <div class="spread"><b>${spriteImg(appearanceURL(c.appearance), SIZE[st])}${STAGES[st].icon} ${esc(c.name)}</b><span class="small muted">${esc(childAgeText(state, c))}</span></div>
    <div class="small">Parents: ${parentsText(state, c)}${c.hungry ? ` · <span class="danger">Hungry</span>` : ""}</div>
    <div>${c.traits.map((t) => `<span class="chip trait"${tip(TRAITS[t] ? TRAITS[t].desc : "")}>${esc(TRAITS[t] ? TRAITS[t].name : t)}</span>`).join("")}${c.chores ? `<span class="chip"${tip("Food from helping in the fields and the kitchen so far")}>Chores ${c.chores}</span>` : ""}</div>
  </div>`;
}
// The People tab: the children at each base (and any with the exiles).
export function childrenPeople(state) {
  const kids = childrenOf(state);
  if (!kids.length) return "";
  const groups = new Map();
  for (const c of kids) { const k = c.baseId; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  let out = "";
  for (const [baseId, list] of groups) {
    const b = baseId != null ? baseById(state, baseId) : null;
    const name = b ? `Children at ${b.name}` : "Children with the exiles";
    out += `<h3${tip("Children eat less, share beds, lift everyone's mood a little and grow up in a year into survivors who join the work.")}>${esc(name)} (${list.length})</h3>${list.map((c) => childCard(state, c)).join("")}`;
  }
  return out;
}

// ---------- adults ----------
// A chip on a People tab card: expecting, or how many children.
export function familyChip(state, s) {
  if (!s || !s.alive) return "";
  const f = familyOfPerson(state, s);
  const bits = [];
  if (f.expecting) bits.push(`<span class="chip good"${tip(`Expecting a child${f.expecting.other ? ` with ${f.expecting.other.name}` : ""}, due around day ${f.expecting.due}${f.expecting.late ? ". The last weeks: works at 85%." : "."}`)}>🤰 Due day ${f.expecting.due}</span>`);
  else if (f.expectingBy) bits.push(`<span class="chip good"${tip(`${f.expectingBy.name} is expecting their child, due around day ${f.expectingBy.expecting.due}`)}>🍼 Due day ${f.expectingBy.expecting.due}</span>`);
  if (f.kids.length) bits.push(`<span class="chip"${tip(`Children: ${f.kids.map((c) => `${c.name} (${STAGES[stageOf(c)].name.toLowerCase()})`).join(", ")}`)}>👪 ${f.kids.length}</span>`);
  return bits.join("");
}
// The survivor screen's Family card.
export function familyBlock(state, s) {
  const f = familyOfPerson(state, s);
  const rows = [];
  if (f.partner) rows.push(["Partner", personLink(f.partner)]);
  if (f.expecting) rows.push(["Expecting", `due around day ${f.expecting.due} (in ${Math.max(0, f.expecting.due - day(state))} days)${f.expecting.other ? ` with ${first(f.expecting.other)}` : ""}${f.expecting.late ? ` · <span class="warn">the last weeks: works at ${Math.round(FAMILY.lateWork * 100)}%</span>` : ""}`]);
  else if (f.expectingBy) rows.push(["Expecting", `${personLink(f.expectingBy)} is due around day ${f.expectingBy.expecting.due}`]);
  if (f.kids.length) rows.push(["Children", f.kids.map((c) => `<span${tip(childTip(state, c))}>${STAGES[stageOf(c)].icon} ${esc(c.name)}</span>`).join(", ")]);
  if (f.grown.length) rows.push(["Grown up", f.grown.map(personLink).join(", ")]);
  if (f.parents.length) rows.push(["Parents", f.parents.map(personLink).join(" & ")]);
  if (s.born != null) rows.push(["Born", `day ${s.born}`]);
  const chance = chanceLine(state, s, f);
  if (!rows.length && !chance) return "";
  return `<h3>Family</h3><div class="card small"><div class="kv">${rows.map(([k, v]) => `<div class="muted">${esc(k)}</div><div>${v}</div>`).join("")}</div>${chance}</div>`;
}
// For a couple at home: how likely a child is now, and why.
function chanceLine(state, s, f) {
  if (!familyOn(state) || !f.partner || f.expecting || f.expectingBy || !s.location || s.location.kind !== "base") return "";
  const o = f.partner;
  if (!o.location || o.location.kind !== "base" || o.location.baseId !== s.location.baseId) return `<div class="muted">A child: only while both live at the same base.</div>`;
  const base = baseById(state, s.location.baseId);
  if (!base) return "";
  const info = conceiveInfo(state, s, o, base);
  const risk = birthRisk(state, base, s);
  const t = `Each day at home together: ${pct(info.p)} (${pct(FAMILY.conceive)} at best). ${info.factors.map(([k, v]) => `${k} ×${v}`).join(", ") || "Nothing holds it back."} A birth here: ${pct(risk.hard)} chance of a hard one (a medic halves it, a hospital halves it again)${risk.medic ? "; a medic is here" : ""}${risk.hospital ? "; a hospital is here" : ""}. Up to ${info.kidCap} children for the adults here; a free bed needed.`;
  return `<div class="muted"${tip(t)}>A child: ${info.why ? esc(info.why) : `${pct(info.p)} a day`} ⓘ</div>`;
}

// ---------- the roster ----------
export function rosterChildren(state) {
  const kids = childrenOf(state);
  if (!kids.length) return "";
  const rows = kids.slice().sort((a, b) => (b.grown || 0) - (a.grown || 0)).map((c) => {
    const st = stageOf(c);
    const b = c.baseId != null ? baseById(state, c.baseId) : null;
    return `<tr${tip(childTip(state, c))}><td class="ro-name">${spriteImg(appearanceURL(c.appearance), SIZE[st] * 0.8)}${STAGES[st].icon} ${esc(c.name)}</td><td>${esc(STAGES[st].name)}</td><td>${ageOf(state, c)} d</td><td>${daysToAdult(c)} d</td><td>${esc(b ? b.name : "With the exiles")}</td><td>${parentsText(state, c)}</td><td>${c.traits.map((t) => esc(TRAITS[t] ? TRAITS[t].name : t)).join(", ")}</td><td>${c.chores || ""}${c.hungry ? ` <span class="danger">Hungry</span>` : ""}</td></tr>`;
  }).join("");
  return `<h3${tip("Children are not on the roster's work: they grow up in a year and then join it.")}>Children (${kids.length})</h3>
    <table class="t ro-table"><thead><tr><th>Name</th><th>Stage</th><th>Age</th><th>Grows up in</th><th>Where</th><th>Parents</th><th>Traits</th><th>Chores (food)</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------- help ----------
export function familyHelp() {
  return `Two adults who live at the same base and are close friends (opinion ${FAMILY.coupleAt}+) may become a couple (a line in the diary); partners from the hub event count too. A couple at home together may then expect a child: at best ${pct(FAMILY.conceive)} a day, less when food is under 30 days, beds are few, the base is under threat (a raid warning or a horde on its way) or they are low or hurt, and never with no free bed, under 10 days of food, on short rations, or when the base already has its share of children (one per ${FAMILY.perAdults} adults, at least ${FAMILY.minKids}). The survivor screen's <b>Family</b> card shows the chance and why.<br>
    A pregnancy lasts ${FAMILY.carry} days (two seasons); the last ${FAMILY.late} days they work at ${Math.round(FAMILY.lateWork * 100)}%. The birth is at a base (someone away on a team gives birth when back, or after ${FAMILY.overdueAway} days wherever they are). A hard birth (${pct(FAMILY.hard)}, halved by a medic and again by a hospital) costs the parent ${FAMILY.hardHp} health and a med; very rarely the baby does not live. A couple waits ${FAMILY.rest} days before the next.<br>
    Children are not survivors: they never go on teams, stand guard, fight, take jobs or get traded. They grow up over a year: ${STAGES.baby.icon} baby (to ${FAMILY.baby} days), ${STAGES.child.icon} child, ${STAGES.youth.icon} youngster (from ${FAMILY.youth} days), and at ${FAMILY.adult} days a survivor with low skills, a third of the better parent's in each, plus what they helped with and saw done at their base. They eat a quarter, half and three quarters of a ration (in the base's food use), and drink the same share; a baby sleeps with a parent, older children two to a bed. With nothing in store the parents go hungry for them, and a child does not grow on a day without food. From ${FAMILY.baby} days they help in the fields and the kitchen (${FAMILY.chores.child}–${FAMILY.chores.youth} food a day at a base with farm plots or a kitchen).<br>
    Mood: expecting +${FAMILY.moodExpect} a day, their own child at the same base +${FAMILY.moodParent}, children about the base +${FAMILY.moodBase} for everyone. They shelter in raids and horde attacks; only a base that falls touches them (they leave with its people for your nearest base, ${pct(FAMILY.flightLoss)} lost on the way). Losing a child costs the parents ${FAMILY.lossParent} mood and ${FAMILY.griefDays} days of grief, everyone at the base ${FAMILY.lossBase}. Children are listed on the People tab and under the roster. Turn the whole thing off with the new-run screen's <b>Children</b> box.`;
}
