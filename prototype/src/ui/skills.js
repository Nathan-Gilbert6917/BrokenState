// Skills in the survivor screen (sim/skills.js): levels with XP progress, perk points, the skill tree (nodes per
// skill and milestone: taken / available / locked / passed over), and the Teach and Read settings for people on
// those roles. Actions: SKILL_ACTIONS (clicks) and SKILL_CHANGE (drop-downs), wired in main.js.
import { SKILLS, SKILL_NAMES, GEAR } from "../sim/data.js";
import { skill, survivorById, baseById, atBase } from "../sim/world.js";
import { assignStations } from "../sim/buildings.js";
import {
  skillProgress, pendingPerks, PERK_TREE, MILESTONES, hasPerk, perkReason, choosePerk, CAP_USE, CAP_STUDY, xpNeed,
  lessonOf, bestLesson, learnersFor, learnReason, teachRate, TEACH_GAP, MAX_LEARNERS, bookDef, bookHours, readReason, READ_HOURS, BOOK_XP,
} from "../sim/skills.js";

const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const tip = (t) => (t ? ` data-tip="${esc(t)}"` : "");
const first = (s) => esc(String(s.name).split(" ")[0]);
const n1 = (v) => (Math.round((v || 0) * 10) / 10).toString();
const bar = (pct, color, cls = "bar") => `<div class="${cls}"><i style="width:${Math.max(0, Math.min(100, pct))}%;background:${color}"></i></div>`;

const CURVE_TIP = `XP to the next level: 40 + 0.32 × level³ (49 at 3, 80 at 5, 360 at 10, 1,120 at 15). A full day of one job gives about 10 XP; XP from use is capped at ${CAP_USE} a day per skill, from teaching and books at ${CAP_STUDY}. Skills above 10 that go unused for 14 days slip by 2 XP a day (never below 10 nor below the level they joined with). Perk points at 5, 10 and 15.`;

// The Skills column: level, XP bar, today's XP and the perks taken in each skill.
export function skillsBlock(state, s) {
  const pend = pendingPerks(s);
  const rows = SKILLS.map((k) => {
    const p = skillProgress(s, k);
    const perks = (s.perks || []).filter((id) => Object.values(PERK_TREE[k] || {}).some((l) => l.some((x) => x.id === id)));
    const t = `${SKILL_NAMES[k]} ${p.level}${p.level !== p.raw ? ` (${p.raw} trained, traits ${p.level - p.raw >= 0 ? "+" : ""}${p.level - p.raw})` : ""}. ${p.maxed ? "At the top (20)." : `XP ${n1(p.xp)} of ${p.need} to ${p.raw + 1}.`} Today +${n1(p.today)}${p.capped ? " (daily use cap reached)" : ""}.${p.nextMs ? ` Next perk point at ${p.nextMs}.` : ""}${perks.length ? ` Perks: ${perks.map((id) => findPerk(id).name).join(", ")}.` : ""}`;
    return `<div class="skillrow"${tip(t)}>
      <span class="sk-name">${SKILL_NAMES[k]}</span>
      <div class="sk-bars">${bar(p.level * 5, "var(--accent)")}${bar(p.pct, p.capped ? "var(--muted)" : "var(--info)", "bar xpbar")}</div>
      <span class="sk-lv">${p.level}</span>
      <span class="sk-perk">${perks.length ? "★".repeat(perks.length) : ""}</span>
    </div>`;
  }).join("");
  return `<div><div class="spread"><h3${tip(CURVE_TIP)}>Skills</h3>${pend.length ? `<button class="mini primary" data-action="skilltree" data-id="${s.id}"${tip("Open the skill tree to spend them")}>★ ${pend.length} perk point${pend.length === 1 ? "" : "s"}</button>` : ""}</div>
    <div class="small muted">Gold: level · blue: XP to the next level · ★ perks taken</div>${rows}</div>`;
}

const findPerk = (id) => {
  for (const tiers of Object.values(PERK_TREE)) for (const list of Object.values(tiers)) for (const p of list) if (p.id === id) return p;
  return { name: id, desc: "" };
};

// The skill tree: a row per skill, a column per milestone, two perk nodes in each.
export function skillTree(state, s, ui) {
  const open = ui.skillTree === s.id;
  const pend = pendingPerks(s);
  const head = `<div class="spread"><h3>Skill tree</h3><button class="mini ${open ? "active" : ""}" data-action="skilltree" data-id="${s.id}"${tip("Perks at Skill 5, 10 and 15: one of two per milestone, for good")}>${open ? "Hide" : "Show"} skill tree${pend.length ? ` (★ ${pend.length})` : ""}</button></div>`;
  if (!open) return head;
  const rows = SKILLS.map((k) => {
    const lv = skill(s, k);
    const cells = MILESTONES.map((ms) => {
      const list = (PERK_TREE[k] && PERK_TREE[k][ms]) || [];
      const taken = list.find((p) => hasPerk(s, p.id));
      const point = pend.some((x) => x.skill === k && x.ms === ms);
      return `<div class="tier ${point ? "point" : ""}">${list.map((p) => {
        let cls, why;
        if (hasPerk(s, p.id)) { cls = "taken"; why = "Taken."; }
        else if (taken) { cls = "passed"; why = `Passed over: ${taken.name} was taken at ${SKILL_NAMES[k]} ${ms}.`; }
        else if (point && !perkReason(s, p.id)) { cls = "avail"; why = "Click to take it (one of the two, for good)."; }
        else { cls = "locked"; why = lv >= ms ? "Reached before they joined: no point for it (only their two best skills came with points)." : `Needs ${SKILL_NAMES[k]} ${ms} (now ${lv}).`; }
        const body = `<b>${esc(p.name)}</b>`;
        return cls === "avail"
          ? `<button class="perk avail" data-action="perk-pick" data-id="${s.id}" data-perk="${p.id}"${tip(`${p.name}: ${p.desc} ${why}`)}>${body}</button>`
          : `<div class="perk ${cls}"${tip(`${p.name}: ${p.desc} ${why}`)}>${body}</div>`;
      }).join("")}</div>`;
    }).join("");
    return `<div class="tree-row"><div class="tree-skill"><b>${SKILL_NAMES[k]}</b> <span class="muted">${lv}</span></div>${cells}</div>`;
  }).join("");
  return `${head}${ui.skillMsg ? `<div class="result small">${esc(ui.skillMsg)}</div>` : ""}
    <div class="skilltree"><div class="tree-row tree-head"><div></div>${MILESTONES.map((m) => `<div>Skill ${m}</div>`).join("")}</div>${rows}</div>
    <div class="small muted">Gold border: a perk point to spend · green: taken · grey: locked or passed over. Hover a perk for its exact effect.</div>`;
}

// Teach and Read: the settings for people on those roles, and the books they have read.
export function studyBlock(state, s) {
  const base = s.location && s.location.kind === "base" ? baseById(state, s.location.baseId) : null;
  const read = Object.entries(s.books || {}).filter(([k, h]) => bookDef(k) && h > 0);
  const readLine = read.length ? `<div class="small"><span class="muted">Books:</span> ${read.map(([k, h]) => `<span class="chip"${tip(GEAR[k].desc)}>${esc(GEAR[k].name)} ${n1(Math.min(h, bookDef(k).hours))}/${bookDef(k).hours}h</span>`).join("")}</div>` : "";
  let body = "";
  if (base && s.role === "teach") {
    const lesson = lessonOf(state, s);
    const k = lesson ? lesson.skill : (s.teach && s.teach.skill) || SKILLS[0];
    const ls = lesson ? lesson.learners : [];
    const cands = learnersFor(state, s, k);
    const learnerSel = (i) => {
      const cur = ls[i] != null ? ls[i] : "";
      return `<select data-action="teach-l" data-id="${s.id}" data-i="${i}"${tip(`Learner ${i + 1}: someone at ${base.name} whose ${SKILL_NAMES[k]} is ${TEACH_GAP}+ below ${first(s)}'s`)}><option value="">${i ? "Second learner…" : "Learner…"}</option>${cands.map((L) => `<option value="${L.id}" ${cur === L.id ? "selected" : ""}>${esc(L.name)} (${skill(L, k)})</option>`).join("")}</select>`;
    };
    const rate = teachRate(s, k);
    body = `<div class="card small"><b>Teaching</b> <span class="muted">(${lesson ? (lesson.set ? "as set" : "their own pick") : "nobody to teach"})</span>
      <div class="row" style="margin-top:0.3rem;flex-wrap:wrap;gap:0.3rem">
        <select data-action="teach-skill" data-id="${s.id}"${tip("The skill they teach")}>${SKILLS.map((x) => `<option value="${x}" ${x === k ? "selected" : ""}>${SKILL_NAMES[x]} ${skill(s, x)}</option>`).join("")}</select>
        ${Array.from({ length: MAX_LEARNERS }, (_, i) => learnerSel(i)).join("")}
      </div>
      <div class="muted" style="margin-top:0.2rem"${tip(`4 + 0.4 × ${SKILL_NAMES[k]} + 0.15 × (Leadership + Speech)${hasPerk(s, "mentor") ? ", × 1.5 Mentor" : ""}, × work factor; study XP is capped at ${CAP_STUDY} a day per skill`)}>Each learner +${n1(rate)} ${SKILL_NAMES[k]} XP a day${ls.length ? ` · ${ls.map((id) => { const L = survivorById(state, id); return L ? `${first(L)} ${skill(L, k)} (${n1(Math.max(0, xpNeed(L.skills[k] || 0) - ((L.xp && L.xp[k]) || 0)))} XP to ${(L.skills[k] || 0) + 1})` : ""; }).join(", ")}` : cands.length ? " · pick a learner" : ` · nobody here is ${TEACH_GAP}+ below them in ${SKILL_NAMES[k]}`}</div></div>`;
  } else if (base && s.role === "read") {
    const copies = {};
    for (const it of base.armory) if (it && bookDef(it.key)) copies[it.key] = (copies[it.key] || 0) + 1;
    const others = atBase(state, base.id).filter((o) => o !== s && o.role === "read" && o.reading);
    const keys = Object.keys(copies);
    const cur = s.reading && copies[s.reading] ? s.reading : "";
    body = `<div class="card small"><b>Reading</b> <span class="muted">${READ_HOURS} hours a day · skill books ${BOOK_XP} XP an hour</span>
      <div class="row" style="margin-top:0.3rem">${keys.length ? `<select data-action="read-book" data-id="${s.id}"${tip(`Books in ${base.name}'s armory (one reader per copy)`)}><option value="">Their own pick…</option>${keys.map((k) => {
        const b = bookDef(k);
        const why = readReason(s, k);
        const busy = others.filter((o) => o.reading === k).length >= copies[k];
        return `<option value="${k}" ${cur === k ? "selected" : ""}>${esc(GEAR[k].name)} — ${b.skill ? `${SKILL_NAMES[b.skill]} to ${b.max}` : "mood"}, ${n1(bookHours(s, k))}/${b.hours}h${why ? ` (${esc(why)})` : busy ? " (being read)" : ""}</option>`;
      }).join("")}</select>` : `<span class="muted">No books in ${esc(base.name)}'s armory. Teams find them in schools, universities, police stations, military bases and homes; traders sell some.</span>`}</div>
      ${s.reading && bookDef(s.reading) ? `<div class="muted" style="margin-top:0.2rem">Now: ${esc(GEAR[s.reading].name)} ${n1(bookHours(s, s.reading))}/${bookDef(s.reading).hours}h${readReason(s, s.reading) ? ` · ${esc(readReason(s, s.reading))}` : ""}</div>` : ""}</div>`;
  }
  if (base && !body) {
    const lesson = bestLessonText(state, s);
    body = `<div class="row small"><button class="mini" data-action="study-role" data-id="${s.id}" data-role="teach"${tip(`Put ${first(s)} on the Teach role: they teach one skill to up to ${MAX_LEARNERS} people here who are ${TEACH_GAP}+ below them, and do no other work.${lesson}`)}>Teach</button><button class="mini" data-action="study-role" data-id="${s.id}" data-role="read"${tip(`Put ${first(s)} on the Read role: ${READ_HOURS} hours a day with a book from ${base.name}'s armory, no other work.`)}>Read</button><span class="muted">Study roles</span></div>`;
  }
  return body || readLine ? `<h3>Study</h3>${body}${readLine}` : "";
}

function bestLessonText(state, s) {
  const l = bestLesson(state, s);
  if (!l || !l.learners.length) return ` Nobody here is ${TEACH_GAP}+ below them in any skill right now.`;
  return ` Best lesson now: ${SKILL_NAMES[l.skill]} to ${l.learners.map((id) => { const L = survivorById(state, id); return L ? L.name.split(" ")[0] : ""; }).join(" and ")}.`;
}

export const SKILL_ACTIONS = {
  "study-role": (state, ui, d) => {
    const s = survivorById(state, Number(d.id));
    if (!s || !s.alive || s.location.kind !== "base" || !["teach", "read"].includes(d.role)) return;
    s.role = d.role;
    s.station = null;
    assignStations(state, baseById(state, s.location.baseId));
  },
  skilltree: (state, ui, d) => { const id = Number(d.id); ui.skillTree = ui.skillTree === id ? null : id; ui.skillMsg = ""; },
  "perk-pick": (state, ui, d) => {
    const s = survivorById(state, Number(d.id));
    if (!s) return;
    ui.skillMsg = choosePerk(state, s, d.perk);
  },
};

export const SKILL_CHANGE = {
  "teach-skill": (state, ui, el) => {
    const s = survivorById(state, Number(el.dataset.id));
    if (!s || !SKILLS.includes(el.value)) return;
    s.teach = { skill: el.value, learners: learnersFor(state, s, el.value).slice(0, MAX_LEARNERS).map((L) => L.id) };
    ui.skillMsg = s.teach.learners.length ? "" : `Nobody at their base is ${TEACH_GAP}+ below ${s.name.split(" ")[0]} in ${SKILL_NAMES[el.value]}: they teach their own pick until someone is.`;
  },
  "teach-l": (state, ui, el) => {
    const s = survivorById(state, Number(el.dataset.id));
    if (!s) return;
    const lesson = lessonOf(state, s);
    const k = lesson ? lesson.skill : (s.teach && s.teach.skill) || SKILLS[0];
    const ls = lesson ? lesson.learners.slice() : [];
    const i = Number(el.dataset.i) || 0;
    const L = el.value ? survivorById(state, Number(el.value)) : null;
    if (L && learnReason(state, s, L, k)) { ui.skillMsg = learnReason(state, s, L, k); return; }
    if (L) { const j = ls.indexOf(L.id); if (j >= 0) ls.splice(j, 1); ls.splice(Math.min(i, ls.length), 0, L.id); }
    else ls.splice(i, 1);
    s.teach = { skill: k, learners: ls.slice(0, MAX_LEARNERS) };
  },
  "read-book": (state, ui, el) => {
    const s = survivorById(state, Number(el.dataset.id));
    if (!s) return;
    s.reading = el.value || null;
    s.readIdle = false;
  },
};
