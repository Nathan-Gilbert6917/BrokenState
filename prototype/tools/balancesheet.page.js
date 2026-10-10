// The balance sheet page (tools/balancesheet.js inlines this file). Plain browser JS, no libraries, no network.
(function () {
  "use strict";
  const DATA = JSON.parse(document.getElementById("sheet-data").textContent);
  const TABLES = {};
  for (const t of DATA.tables) {
    t.byKey = {};
    for (const r of t.rows) t.byKey[r.key] = r;
    t.colById = {};
    for (const c of t.cols) t.colById[c.id] = c;
    TABLES[t.id] = t;
  }
  const STORE = "brokenstate-balance-sheet-v1";
  const TIER_NAME = { common: "common", uncommon: "uncommon", scarce: "scarce", rare: "rare", veryrare: "very rare" };

  // ---------- state ----------
  const state = {
    edits: {}, // "table|key|field" → value
    rarityOrder: DATA.rarityOrder.slice(),
    tab: DATA.tabs[0].id,
    hidden: {}, // table → { col: true/false } (overrides the default)
    sort: {}, // table → { col, dir }
    filter: {}, // table → text
    theme: null,
  };
  const keyOf = (t, k, f) => t + "|" + k + "|" + f;
  function load() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (e) { saved = null; }
    if (!saved || typeof saved !== "object") return;
    let dropped = 0;
    for (const [id, v] of Object.entries(saved.edits || {})) {
      const [t, k, f] = id.split("|");
      if (editable(t, k, f)) state.edits[id] = v; else dropped++;
    }
    if (Array.isArray(saved.rarityOrder) && sameSet(saved.rarityOrder, DATA.rarityOrder)) state.rarityOrder = saved.rarityOrder;
    for (const f of ["hidden", "sort", "filter"]) if (saved[f] && typeof saved[f] === "object") state[f] = saved[f];
    if (saved.tab && DATA.tabs.some((x) => x.id === saved.tab)) state.tab = saved.tab;
    if (saved.theme) state.theme = saved.theme;
    if (dropped) setTimeout(() => toast(dropped + " saved edit(s) no longer match an editable cell and were dropped."), 50);
    if (saved.generatedFrom && saved.generatedFrom !== DATA.generatedFrom && Object.keys(state.edits).length) setTimeout(() => toast("Edits were made on a sheet from " + saved.generatedFrom + "; this one is from " + DATA.generatedFrom + "."), 60);
  }
  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({ generatedFrom: DATA.generatedFrom, edits: state.edits, rarityOrder: state.rarityOrder, hidden: state.hidden, sort: state.sort, filter: state.filter, tab: state.tab, theme: state.theme }));
    } catch (e) { /* storage blocked: edits live until the page closes */ }
  }
  const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

  // ---------- values ----------
  function base(t, k, f) { const tb = TABLES[t]; const r = tb && tb.byKey[k]; return r ? r.v[f] : undefined; }
  function get(t, k, f) { const id = keyOf(t, k, f); return id in state.edits ? state.edits[id] : base(t, k, f); }
  function editable(t, k, f) { const tb = TABLES[t]; const r = tb && tb.byKey[k]; return !!(r && r.ed && r.ed[f]); }
  const CALC = makeCalc(get, DATA.S);
  function cellValue(t, r, c) {
    if (c.calc === "live") { const fn = CALC[t] && CALC[t][c.id]; if (!fn) return r.v[c.id]; try { return fn(r.key); } catch (e) { return null; } }
    return get(t, r.key, c.id);
  }
  function setEdit(t, k, f, v) {
    const id = keyOf(t, k, f), b = base(t, k, f);
    if (same(v, b) || (v === null && (b === null || b === undefined))) delete state.edits[id]; else state.edits[id] = v;
    save();
  }
  const same = (a, b) => (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) < 1e-9 : a === b);

  // ---------- formatting ----------
  function fmtNum(v) {
    if (typeof v !== "number" || !isFinite(v)) return "";
    if (Number.isInteger(v)) return String(v);
    const a = Math.abs(v);
    return String(Number(v.toFixed(a >= 100 ? 1 : a >= 1 ? 2 : 4)));
  }
  function fmt(c, v) {
    if (v === null || v === undefined || v === "") return "";
    if (c.type === "pct") return typeof v === "number" ? (v * 100).toFixed(0) + "%" : "";
    if (c.type === "bool") return v ? "yes" : "no";
    if (c.type === "num") return typeof v === "number" ? fmtNum(v) : String(v);
    return String(v);
  }
  const esc = (s) => String(s).replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[ch]));
  const tierHtml = (v) => (v ? '<span class="tier tier-' + esc(v) + '">' + esc(TIER_NAME[v] || v) + "</span>" : "");

  // ---------- rendering ----------
  const app = document.getElementById("app");
  function changeCount() { return Object.keys(state.edits).length + (orderChanged() ? 1 : 0); }
  const orderChanged = () => state.rarityOrder.join() !== DATA.rarityOrder.join();
  function render() {
    applyTheme();
    const tab = DATA.tabs.find((x) => x.id === state.tab) || DATA.tabs[0];
    const n = changeCount();
    app.innerHTML =
      '<div class="top"><h1>Broken State balance sheet</h1><span class="meta">from ' + esc(DATA.generatedFrom) + " · " + esc(DATA.generatedAt.slice(0, 16).replace("T", " ")) + '</span><span class="grow"></span>' +
      '<span>Changes <span id="chg" class="badge' + (n ? " on" : "") + '">' + n + "</span></span>" +
      '<button class="primary" data-act="export">Export changes</button><button data-act="import">Import changes</button><button data-act="reset">Reset all</button>' +
      '<button data-act="theme" title="Light / dark">◐</button></div>' +
      '<div class="tabs">' + DATA.tabs.map((x) => '<button data-tab="' + x.id + '" class="' + (x.id === tab.id ? "active" : "") + '">' + esc(x.title) + "</button>").join("") + "</div>" +
      '<div class="legend"><span><b style="color:var(--editable)">✎ blue</b>: editable (click)</span><span><b style="color:var(--calc)">ƒ green italic</b>: recomputed live</span><span><b style="color:var(--after)">↻ brown</b>: recomputed after apply (regenerate)</span><span><b>yellow</b>: edited (↺ undoes)</span></div>' +
      '<div class="layout"><div class="main">' + tab.tables.map((id, i) => tableHtml(TABLES[id], i === 0)).join("") + '</div><div class="side">' + rarityHtml() + "</div></div>";
    wire();
  }
  function visibleCols(t) {
    const h = state.hidden[t.id] || {};
    return t.cols.filter((c) => (c.id in h ? !h[c.id] : !c.hide));
  }
  function rowsOf(t) {
    const cols = visibleCols(t);
    const q = (state.filter[t.id] || "").toLowerCase().split(/\s+/).filter(Boolean);
    let rows = t.rows.map((r) => ({ r, vals: Object.fromEntries(cols.map((c) => [c.id, cellValue(t.id, r, c)])) }));
    if (q.length) rows = rows.filter(({ r, vals }) => {
      const hay = (r.key + " " + cols.map((c) => (c.type === "tier" ? TIER_NAME[vals[c.id]] || vals[c.id] : fmt(c, vals[c.id]))).join(" ")).toLowerCase();
      return q.every((w) => hay.includes(w));
    });
    const s = state.sort[t.id];
    if (s && (s.col === "__key" || t.colById[s.col])) {
      const c = t.colById[s.col];
      const val = (x) => (s.col === "__key" ? x.r.key : s.col in x.vals ? x.vals[s.col] : cellValue(t.id, x.r, c));
      const rank = (v) => (c && c.type === "tier" ? (state.rarityOrder.indexOf(v) + 1 || 99) : v);
      rows.sort((a, b) => {
        let va = rank(val(a)), vb = rank(val(b));
        const na = va === null || va === undefined || va === "", nb = vb === null || vb === undefined || vb === "";
        if (na || nb) return na === nb ? 0 : na ? 1 : -1; // blanks last either way
        if (typeof va === "boolean") va = va ? 1 : 0;
        if (typeof vb === "boolean") vb = vb ? 1 : 0;
        const d = typeof va === "number" && typeof vb === "number" ? va - vb : String(va).localeCompare(String(vb), undefined, { numeric: true, sensitivity: "base" });
        return s.dir === "desc" ? -d : d;
      });
    }
    return { rows, cols };
  }
  function tableHtml(t, first) {
    const { rows, cols } = rowsOf(t);
    const s = state.sort[t.id] || {};
    const edits = Object.keys(state.edits).filter((id) => id.startsWith(t.id + "|")).length;
    const head = '<th class="key" data-sort="__key">key' + (s.col === "__key" ? '<span class="sort">' + (s.dir === "desc" ? "▼" : "▲") + "</span>" : "") + "</th>" +
      cols.map((c) => {
        const mk = c.calc === "live" ? '<span class="mk c">ƒ</span>' : c.calc === "after" ? '<span class="mk a">↻</span>' : c.src ? '<span class="mk e">✎</span>' : "";
        const tip = (c.desc ? c.desc + " · " : "") + (c.calc === "live" ? "recomputed live" : c.calc === "after" ? "recomputed after apply" : c.src ? "editable source value" : "read-only");
        return '<th class="' + (isText(c) ? "t" : "") + '" data-sort="' + c.id + '" title="' + esc(tip) + '">' + esc(c.label) + mk + (s.col === c.id ? '<span class="sort">' + (s.dir === "desc" ? "▼" : "▲") + "</span>" : "") + "</th>";
      }).join("");
    const body = rows.map(({ r, vals }) => "<tr>" + '<td class="key" title="' + esc(r.key) + '">' + esc(r.key) + "</td>" + cols.map((c) => cellHtml(t, r, c, vals[c.id])).join("") + "</tr>").join("");
    return '<section class="card" data-table="' + t.id + '"' + (first ? "" : ' style="border-radius:8px"') + "><h2>" + esc(t.title) + "</h2>" + (t.note ? '<p class="note">' + esc(t.note) + "</p>" : "") +
      '<div class="toolbar"><input type="search" placeholder="Filter rows…" data-filter="' + t.id + '" value="' + esc(state.filter[t.id] || "") + '"><button data-cols="' + t.id + '">Columns ▾</button>' +
      '<span class="count">' + rows.length + " of " + t.rows.length + " rows" + (edits ? " · " + edits + " edited" : "") + "</span></div>" +
      '<div class="scroll"><table><thead><tr>' + head + "</tr></thead><tbody>" + body + "</tbody></table></div></section>";
  }
  const isText = (c) => c.type === "text" || c.type === "enum";
  function cellHtml(t, r, c, v) {
    const cls = [];
    if (isText(c)) cls.push("t");
    if (c.type === "text" && typeof v === "string" && v.length > 40) cls.push("long");
    const where = r.ed && r.ed[c.id];
    const id = keyOf(t.id, r.key, c.id);
    const changed = id in state.edits;
    if (where) { cls.push("ed"); if (where[0] === "+") cls.push("ins"); }
    if (changed) cls.push("changed");
    if (c.calc === "live") cls.push("calc");
    if (c.calc === "after") { cls.push("after"); if (changeCount()) cls.push("stale"); }
    let inner = c.type === "tier" ? tierHtml(v) : esc(fmt(c, v));
    if (changed) inner += '<span class="undo" data-undo="' + esc(id) + '" title="Undo: back to ' + esc(fmt(c, base(t.id, r.key, c.id)) || "(none)") + '">↺</span>';
    const title = where ? (where[0] === "+" ? "Not set; an edit adds it at " + where.slice(1) : where) : c.calc === "after" && changeCount() ? "Recomputed after apply" : "";
    return '<td class="' + cls.join(" ") + '"' + (where ? ' data-cell="' + esc(id) + '"' : "") + (title ? ' title="' + esc(title) + '"' : "") + ">" + inner + "</td>";
  }
  function rarityHtml() {
    const t = TABLES.rarity;
    const desc = (f) => state.rarityOrder.every((k, i) => i === 0 || num(get("rarity", k, f)) <= num(get("rarity", state.rarityOrder[i - 1], f)));
    const warn = [];
    if (!desc("find")) warn.push("Round find weights do not fall from first to last.");
    if (!desc("gunFind")) warn.push("Gun find weights do not fall from first to last.");
    const items = state.rarityOrder.map((k, i) => {
      const moved = DATA.rarityOrder.indexOf(k) !== i;
      const inp = (f) => '<input type="text" inputmode="decimal" data-rar="' + k + '" data-f="' + f + '" value="' + esc(fmtNum(get("rarity", k, f))) + '" class="' + (keyOf("rarity", k, f) in state.edits ? "changed" : "") + '"' + (editable("rarity", k, f) ? "" : " disabled") + ">";
      return '<li draggable="true" data-tier="' + k + '" class="' + (moved ? "moved" : "") + '"><span class="handle" title="Drag to reorder">⋮⋮</span>' + tierHtml(k) + inp("find") + inp("gunFind") +
        '<span class="btns"><button class="small" data-up="' + i + '" title="Up">▲</button><button class="small" data-down="' + i + '" title="Down">▼</button></span></li>';
    }).join("");
    return '<div class="card"><h3>Order of rarity</h3><p class="note">' + esc(t.note) + " Most common first. Drag or use ▲▼; weights are each tier's own.</p>" +
      '<div class="rar-head"><span></span><span>tier</span><span>rounds</span><span>guns</span><span></span></div><ul class="rar-list">' + items + "</ul>" +
      (warn.length ? '<div class="warn">' + warn.map(esc).join("<br>") + "</div>" : "") +
      (orderChanged() ? '<div class="row" style="margin-top:6px"><button class="small" data-act="resetorder">Reset order</button></div>' : "") +
      "</div>" + changesHtml();
  }
  const num = (v) => (typeof v === "number" && isFinite(v) ? v : 0);
  function changesHtml() {
    const ids = Object.keys(state.edits);
    if (!ids.length && !orderChanged()) return '<div class="card"><h3>Changes</h3><p class="note">No changes yet. Click a blue value to edit it.</p></div>';
    const rows = ids.sort().map((id) => {
      const [t, k, f] = id.split("|");
      const c = TABLES[t].colById[f];
      return "<tr><td>" + esc(t) + "</td><td>" + esc(k) + "</td><td>" + esc(c ? c.label : f) + "</td><td>" + esc(fmt(c || {}, base(t, k, f)) || "–") + " → <b>" + esc(fmt(c || {}, state.edits[id])) + '</b></td><td><span class="undo" data-undo="' + esc(id) + '" style="cursor:pointer">↺</span></td></tr>';
    }).join("");
    return '<div class="card"><h3>Changes</h3><div class="scroll" style="max-height:40vh"><table class="changes"><tbody>' + rows +
      (orderChanged() ? '<tr><td colspan="3">rarity order</td><td colspan="2">' + esc(state.rarityOrder.join(" > ")) + "</td></tr>" : "") + "</tbody></table></div></div>";
  }

  // ---------- events ----------
  function wire() {
    app.querySelectorAll("[data-tab]").forEach((b) => (b.onclick = () => { state.tab = b.dataset.tab; save(); render(); }));
    app.querySelectorAll("[data-act]").forEach((b) => (b.onclick = () => ACTS[b.dataset.act]()));
    app.querySelectorAll("th[data-sort]").forEach((th) => (th.onclick = () => {
      const t = th.closest("[data-table]").dataset.table, col = th.dataset.sort;
      const s = state.sort[t];
      state.sort[t] = !s || s.col !== col ? { col, dir: "asc" } : s.dir === "asc" ? { col, dir: "desc" } : null;
      if (!state.sort[t]) delete state.sort[t];
      save(); rerenderTable(t);
    }));
    app.querySelectorAll("[data-filter]").forEach((inp) => (inp.oninput = () => {
      state.filter[inp.dataset.filter] = inp.value; save();
      const pos = inp.selectionStart; rerenderTable(inp.dataset.filter);
      const again = app.querySelector('[data-filter="' + inp.dataset.filter + '"]'); again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* */ }
    }));
    app.querySelectorAll("[data-cols]").forEach((b) => (b.onclick = (ev) => { ev.stopPropagation(); colsPopover(b, b.dataset.cols); }));
    app.querySelectorAll("td[data-cell]").forEach((td) => (td.onclick = (ev) => { if (ev.target.dataset.undo) return; startEdit(td); }));
    app.querySelectorAll("[data-undo]").forEach((u) => (u.onclick = (ev) => { ev.stopPropagation(); delete state.edits[u.dataset.undo]; save(); render(); }));
    wireRarity();
  }
  function rerenderTable(id) {
    const sec = app.querySelector('[data-table="' + id + '"]');
    if (!sec) return render();
    const tab = DATA.tabs.find((x) => x.id === state.tab);
    const tmp = document.createElement("div");
    tmp.innerHTML = tableHtml(TABLES[id], tab.tables[0] === id);
    const scroll = sec.querySelector(".scroll"), top = scroll ? scroll.scrollTop : 0, left = scroll ? scroll.scrollLeft : 0;
    sec.replaceWith(tmp.firstChild);
    const ns = app.querySelector('[data-table="' + id + '"] .scroll');
    if (ns) { ns.scrollTop = top; ns.scrollLeft = left; }
    wire();
  }
  // After an edit: every table of the tab (computed columns read other tables), the side panel and the counter.
  function refresh() {
    const tab = DATA.tabs.find((x) => x.id === state.tab);
    for (const id of tab.tables) rerenderTable(id);
    const side = app.querySelector(".side");
    if (side) { side.innerHTML = rarityHtml(); wire(); }
    const chg = document.getElementById("chg");
    if (chg) { const n = changeCount(); chg.textContent = n; chg.className = "badge" + (n ? " on" : ""); }
  }
  function startEdit(td) {
    if (td.classList.contains("editing")) return;
    const [t, k, f] = td.dataset.cell.split("|");
    const c = TABLES[t].colById[f];
    const cur = get(t, k, f);
    let el;
    if (c.type === "tier" || c.type === "enum" || c.type === "bool") {
      el = document.createElement("select");
      const opts = c.type === "tier" ? state.rarityOrder.map((x) => [x, TIER_NAME[x] || x]) : c.type === "bool" ? [["true", "yes"], ["false", "no"]] : (c.options || []).map((x) => [x, x]);
      if (cur === null || cur === undefined) opts.unshift(["", "(none)"]);
      el.innerHTML = opts.map(([v, l]) => '<option value="' + esc(v) + '">' + esc(l) + "</option>").join("");
      el.value = cur === null || cur === undefined ? "" : String(cur);
    } else {
      el = document.createElement("input");
      el.type = "text";
      if (c.type !== "text") el.inputMode = "decimal";
      el.value = cur === null || cur === undefined ? "" : String(cur);
    }
    td.classList.add("editing");
    td.innerHTML = "";
    td.appendChild(el);
    el.focus();
    if (el.select) el.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) {
        const raw = el.value.trim();
        let v;
        if (raw === "") v = null;
        else if (c.type === "bool") v = raw === "true";
        else if (c.type === "tier" || c.type === "enum" || c.type === "text") v = raw;
        else { v = Number(raw.replace(",", ".")); if (!isFinite(v)) { td.classList.add("bad"); setTimeout(refresh, 300); return; } }
        if (v === null && base(t, k, f) !== null && base(t, k, f) !== undefined) { toast("A value can be changed, not removed: undo (↺) to go back."); refresh(); return; }
        setEdit(t, k, f, v);
      }
      refresh();
    };
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
      else if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
      else if (ev.key === "Tab") { ev.preventDefault(); const next = nextCell(td, ev.shiftKey); finish(true); if (next) { const n2 = app.querySelector('td[data-cell="' + cssEsc(next) + '"]'); if (n2) startEdit(n2); } }
    });
    el.addEventListener("blur", () => finish(true));
    if (el.tagName === "SELECT") el.addEventListener("change", () => finish(true));
  }
  const cssEsc = (s) => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, "\\$&"));
  function nextCell(td, back) {
    const all = Array.from(td.closest("tbody").querySelectorAll("td[data-cell]"));
    const i = all.indexOf(td);
    const n = all[i + (back ? -1 : 1)];
    return n ? n.dataset.cell : null;
  }
  function colsPopover(btn, id) {
    closePop();
    const t = TABLES[id];
    const vis = new Set(visibleCols(t).map((c) => c.id));
    const pop = document.createElement("div");
    pop.className = "pop";
    pop.innerHTML = '<div class="row"><button class="small" data-all>All</button><button class="small" data-none>None</button><button class="small" data-def>Defaults</button></div>' +
      t.cols.map((c) => '<label><input type="checkbox" data-c="' + c.id + '"' + (vis.has(c.id) ? " checked" : "") + "> " + esc(c.label) + (c.calc === "live" ? " ƒ" : c.calc === "after" ? " ↻" : c.src ? " ✎" : "") + "</label>").join("");
    document.body.appendChild(pop);
    const r = btn.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(window.innerWidth - 240, r.left + window.scrollX)) + "px";
    pop.style.top = r.bottom + window.scrollY + 4 + "px";
    const setAll = (f) => { state.hidden[id] = Object.fromEntries(t.cols.map((c) => [c.id, f(c)])); save(); rerenderTable(id); pop.querySelectorAll("[data-c]").forEach((x) => (x.checked = !state.hidden[id][x.dataset.c])); };
    pop.querySelector("[data-all]").onclick = () => setAll(() => false);
    pop.querySelector("[data-none]").onclick = () => setAll(() => true);
    pop.querySelector("[data-def]").onclick = () => { delete state.hidden[id]; save(); rerenderTable(id); pop.querySelectorAll("[data-c]").forEach((x) => (x.checked = !t.colById[x.dataset.c].hide)); };
    pop.querySelectorAll("[data-c]").forEach((cb) => (cb.onchange = () => { state.hidden[id] = state.hidden[id] || {}; state.hidden[id][cb.dataset.c] = !cb.checked; save(); rerenderTable(id); }));
    pop.onclick = (ev) => ev.stopPropagation();
    setTimeout(() => document.addEventListener("click", closePop, { once: true }), 0);
  }
  function closePop() { document.querySelectorAll(".pop").forEach((p) => p.remove()); }
  function wireRarity() {
    const list = app.querySelector(".rar-list");
    if (!list) return;
    list.querySelectorAll("[data-up]").forEach((b) => (b.onclick = () => moveTier(+b.dataset.up, +b.dataset.up - 1)));
    list.querySelectorAll("[data-down]").forEach((b) => (b.onclick = () => moveTier(+b.dataset.down, +b.dataset.down + 1)));
    list.querySelectorAll("input[data-rar]").forEach((inp) => (inp.onchange = () => {
      const v = Number(inp.value.trim().replace(",", "."));
      if (inp.value.trim() === "" || !isFinite(v)) { toast("A weight is a number."); refresh(); return; }
      setEdit("rarity", inp.dataset.rar, inp.dataset.f, v);
      refresh();
    }));
    let from = null;
    list.querySelectorAll("li").forEach((li) => {
      li.ondragstart = (ev) => { from = state.rarityOrder.indexOf(li.dataset.tier); try { ev.dataTransfer.setData("text/plain", li.dataset.tier); } catch (e) { /* */ } };
      li.ondragover = (ev) => { ev.preventDefault(); li.classList.add("drag-over"); };
      li.ondragleave = () => li.classList.remove("drag-over");
      li.ondrop = (ev) => { ev.preventDefault(); li.classList.remove("drag-over"); if (from !== null) moveTier(from, state.rarityOrder.indexOf(li.dataset.tier)); from = null; };
    });
  }
  function moveTier(i, j) {
    if (j < 0 || j >= state.rarityOrder.length || i === j) return;
    const o = state.rarityOrder.slice();
    const [x] = o.splice(i, 1);
    o.splice(j, 0, x);
    state.rarityOrder = o;
    save();
    refresh();
  }

  // ---------- export / import ----------
  const patch = () => buildPatch(DATA, state.edits, state.rarityOrder, base);
  function download(name, text) {
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
    } catch (e) { toast("Download blocked: copy the text instead."); }
  }
  function modal(html) {
    const bg = document.createElement("div");
    bg.className = "modal-bg";
    bg.innerHTML = '<div class="modal">' + html + "</div>";
    bg.onclick = (ev) => { if (ev.target === bg) bg.remove(); };
    document.body.appendChild(bg);
    return bg;
  }
  const ACTS = {
    export() {
      const p = patch();
      const text = JSON.stringify(p, null, 2);
      const name = "balance-patch-" + DATA.generatedFrom + "-" + new Date().toISOString().slice(0, 10) + ".json";
      if (p.changes.length || orderChanged()) download(name, text);
      const m = modal("<h2>Export changes</h2><p class=\"note\">" + p.changes.length + " change(s)" + (orderChanged() ? " and a new rarity order" : "") + ". Downloaded as <b>" + esc(name) +
        "</b>; or copy the text below and send it back. Applied with <code>node tools/applybalance.js patch.json</code> (add <code>--dry</code> to preview).</p><textarea readonly id=\"exp\"></textarea>" +
        '<div class="row"><button class="primary" data-x="copy">Copy</button><button data-x="dl">Download again</button><button data-x="close">Close</button></div>');
      const ta = m.querySelector("#exp");
      ta.value = text;
      ta.focus(); ta.select();
      m.querySelector('[data-x="copy"]').onclick = () => { ta.select(); let ok = false; try { ok = document.execCommand("copy"); } catch (e) { ok = false; } if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => toast("Copied."), () => toast(ok ? "Copied." : "Select the text and copy it.")); else toast(ok ? "Copied." : "Select the text and copy it."); };
      m.querySelector('[data-x="dl"]').onclick = () => download(name, text);
      m.querySelector('[data-x="close"]').onclick = () => m.remove();
    },
    import() {
      const m = modal('<h2>Import changes</h2><p class="note">Paste an exported patch, or pick its file. Its changes replace the current ones.</p><textarea id="imp" placeholder="{ &quot;version&quot;: 1, &quot;changes&quot;: [...] }"></textarea>' +
        '<div class="row"><input type="file" accept=".json,application/json" id="impf"><button class="primary" data-x="go">Import</button><button data-x="close">Cancel</button></div><div id="impmsg" class="warn"></div>');
      const ta = m.querySelector("#imp");
      m.querySelector("#impf").onchange = (ev) => { const f = ev.target.files[0]; if (!f) return; const rd = new FileReader(); rd.onload = () => (ta.value = String(rd.result)); rd.readAsText(f); };
      m.querySelector('[data-x="close"]').onclick = () => m.remove();
      m.querySelector('[data-x="go"]').onclick = () => {
        const res = importPatch(ta.value);
        if (res.error) { m.querySelector("#impmsg").textContent = res.error; return; }
        m.remove();
        render();
        toast("Imported " + res.applied + " change(s)" + (res.skipped ? ", skipped " + res.skipped + " (no such editable cell)" : "") + (res.stale ? ", " + res.stale + " whose 'from' differs from this sheet" : "") + (res.order ? ", rarity order" : "") + ".");
      };
    },
    reset() {
      if (!changeCount()) return toast("Nothing to reset.");
      if (!confirm("Reset all " + changeCount() + " change(s)?")) return;
      state.edits = {}; state.rarityOrder = DATA.rarityOrder.slice(); save(); render();
    },
    resetorder() { state.rarityOrder = DATA.rarityOrder.slice(); save(); refresh(); },
    theme() {
      const dark = state.theme ? state.theme === "dark" : window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
      state.theme = dark ? "light" : "dark"; save(); applyTheme();
    },
  };
  function importPatch(text) {
    let p;
    try { p = JSON.parse(text); } catch (e) { return { error: "Not JSON: " + e.message }; }
    const r = readPatch(DATA, p, editable, base);
    if (r.error) return r;
    state.edits = r.edits;
    const order = !!r.order && r.order.join() !== DATA.rarityOrder.join();
    state.rarityOrder = r.order || DATA.rarityOrder.slice();
    save();
    return { applied: r.applied, skipped: r.skipped, stale: r.stale, order };
  }
  function applyTheme() { if (state.theme) document.documentElement.dataset.theme = state.theme; else delete document.documentElement.dataset.theme; }
  let toastTimer = null;
  function toast(msg) {
    document.querySelectorAll(".toast").forEach((x) => x.remove());
    const d = document.createElement("div");
    d.className = "toast"; d.textContent = msg; document.body.appendChild(d);
    clearTimeout(toastTimer); toastTimer = setTimeout(() => d.remove(), 4000);
  }

  load();
  render();
  // For tools and tests: the page's state and its patch.
  window.balanceSheet = { DATA, state, get, base, cellValue: (t, k, c) => cellValue(t, TABLES[t].byKey[k], TABLES[t].colById[c]), setEdit: (t, k, f, v) => { setEdit(t, k, f, v); refresh(); }, patch, importPatch: (txt) => { const r = importPatch(txt); render(); return r; }, render, moveTier };
})();
