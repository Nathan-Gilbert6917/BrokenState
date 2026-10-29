// Art school: lessons from DATA.art and three hands-on tools: the pixel studio (src/studio.js, mounted here), the sprite-sheet
// player and the 3D-to-sprite camera. Built by build.js after formats.js and studio.js.
window.renderArt = function (H) {
  const { el, docs, bullets, store } = H;
  const A = DATA.art || {};
  const page = document.getElementById("art-page");
  const PRESETS = DATA.artPresets;
  const PALETTE = DATA.artPalette;

  // ---------- lessons ----------
  const tracks = A.tracks || [];
  let track = store.get("bs-art-track", tracks[0] ? tracks[0].id : "");
  const trackPane = el("div", { class: "trackpane" });
  const trackBtns = el("div", { class: "seg wide", role: "tablist", "aria-label": "Art tracks" });
  function renderTrack() {
    trackBtns.querySelectorAll("button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.t === track)));
    trackBtns.querySelectorAll("button").forEach(b => b.setAttribute("aria-pressed", String(b.dataset.t === track)));
    trackPane.textContent = "";
    const t = tracks.find(x => x.id === track) || tracks[0]; if (!t) return;
    const doneKey = "bs-art-done";
    const done = store.get(doneKey, {});
    trackPane.append(
      el("div", { class: "track-h" }, el("h3", { text: t.title }), t.for ? el("p", { text: t.for }) : null,
        el("button", { type: "button", class: "btn primary", onclick: () => practise(t.id), text: t.id === "models3d" ? "Try the 3D camera" : "Practise in the pixel studio" })),
      el("div", { class: "cols2" },
        t.spec && t.spec.length ? el("div", { class: "box" }, el("h4", { class: "bx", text: "Spec for Broken State" }),
          el("dl", { class: "spec" }, t.spec.map(r => el("div", {}, el("dt", { text: r.k }), el("dd", { text: r.v }))))) : null,
        el("div", { class: "box" }, el("h4", { class: "bx", text: "Practice" }),
          el("div", { class: "practice" }, (t.practice || []).map((p, i) => { const k = t.id + "|" + i; return el("label", {},
            el("input", { type: "checkbox", id: "pr-" + t.id + i, checked: done[k] ? true : null, onchange: e => { const d = store.get(doneKey, {}); if (e.target.checked) d[k] = 1; else delete d[k]; store.set(doneKey, d); } }), el("span", { text: p })); })),
          t.mistakes && t.mistakes.length ? el("h4", { class: "bx", text: "Beginner mistakes" }) : null, bullets(t.mistakes, "pits"))),
      el("div", { class: "lessons" }, (t.lessons || []).map((l, i) => el("details", { open: i === 0 ? true : null },
        el("summary", {}, el("span", { class: "mono", text: String(i + 1).padStart(2, "0") }), el("span", { text: l.t })),
        el("div", { class: "lesson-b" }, el("ol", {}, (l.steps || []).map(s => el("li", { text: s }))), l.tip ? el("p", { class: "tipline", text: l.tip }) : null, docs(l.links))))),
      t.engine ? el("div", { class: "eng" },
        el("div", { class: "g only-godot" }, el("h4", { text: "Into Godot" }), el("p", { text: t.engine.godot || "" })),
        el("div", { class: "u only-unity" }, el("h4", { text: "Into Unity" }), el("p", { text: t.engine.unity || "" }))) : null);
  }
  for (const t of tracks) trackBtns.append(el("button", { type: "button", role: "tab", "data-t": t.id, onclick: () => { track = t.id; store.set("bs-art-track", track); renderTrack(); }, text: t.title }));

  // ---------- pixel studio (src/studio.js) ----------
  const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim() || "#888";
  // The page's way of saving a file: the artifact's downloads capability when it is there, an ordinary download otherwise.
  async function saveFile({ filename, blob }) {
    if (!(window.claude && window.claude.use)) {
      const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 30000); return "Saved " + filename + ".";
    }
    const dl = await window.claude.use("downloads");
    if (!dl) throw new Error("Saving files is not available here.");
    try { await dl.save({ filename, data: blob }); return "Saved " + filename + "."; }
    catch (e) { throw new Error(e && e.code === "declined" ? "Not saved." : "Could not save " + filename + " here."); }
  }
  const studioHost = el("div", { class: "pxs-host" });
  let studio = null;   // the studio's api, mounted once the page is in the document

  // ---------- sheet player ----------
  const spCv = el("canvas", { class: "pv", width: 260, height: 260, "aria-label": "Sprite sheet playback" });
  const spSheet = el("canvas", { class: "pv sheetcv", width: 10, height: 10, "aria-label": "The sheet with its frame grid" });
  const spIn = { fw: el("input", { type: "number", id: "sp-fw", min: 1, value: 32 }), fh: el("input", { type: "number", id: "sp-fh", min: 1, value: 32 }),
    n: el("input", { type: "number", id: "sp-n", min: 0, value: 0 }), row: el("input", { type: "number", id: "sp-row", min: 0, value: 0 }), fps: el("input", { type: "number", id: "sp-fps", min: 1, max: 60, value: 8 }) };
  let spImg = null, spT = 0, spLast = 0;
  const spFile = el("input", { type: "file", id: "sp-file", accept: "image/png,image/gif,image/webp" });
  const spNote = el("p", { class: "note", text: "Load a sheet exported from Aseprite, Krita, Blender or the studio. Frames run left to right; set the frame size." });
  spFile.addEventListener("change", () => {
    const f = spFile.files && spFile.files[0]; if (!f) return;
    const img = new Image(); img.onload = () => { spImg = img; spNote.textContent = f.name + ": " + img.width + " × " + img.height + " px."; drawSheet(); }; img.src = URL.createObjectURL(f);
  });
  Object.values(spIn).forEach(i => i.addEventListener("input", drawSheet));
  const spToStudio = el("button", { type: "button", class: "btn", onclick: () => {
    if (!spImg || !studio) return; const fw = +spIn.fw.value || 1, fh = +spIn.fh.value || 1;
    if (fw > 256 || fh > 256) { spNote.textContent = "The studio takes frames up to 256 × 256 px."; return; }
    const c = document.createElement("canvas"); c.width = spImg.width; c.height = spImg.height; const x = c.getContext("2d", { willReadFrequently: true }); x.drawImage(spImg, 0, 0);
    const n = Math.max(1, +spIn.n.value || Math.floor(spImg.width / fw)), row = +spIn.row.value || 0, fps = +spIn.fps.value || 8;
    const doc = AseFormats.newDoc({ w: fw, h: fh, name: "imported", palette: PALETTE });
    doc.frames = []; doc.cels[0] = [];
    for (let k = 0; k < n; k++) { doc.frames.push({ duration: Math.round(1000 / fps) }); doc.cels[0].push({ data: new Uint8ClampedArray(x.getImageData(k * fw, row * fh, fw, fh).data), opacity: 255 }); }
    studio.openDoc(doc, { template: null }); studio.scrollIntoView();
  }, text: "Open frames in the studio" });
  function drawSheet() {
    if (!spImg) return; const fw = +spIn.fw.value || 1, fh = +spIn.fh.value || 1, sc = Math.max(1, Math.min(4, Math.floor(560 / spImg.width)));
    spSheet.width = spImg.width * sc; spSheet.height = spImg.height * sc; const x = spSheet.getContext("2d"); x.imageSmoothingEnabled = false;
    x.drawImage(spImg, 0, 0, spSheet.width, spSheet.height); x.strokeStyle = css("--hive"); x.lineWidth = 1;
    for (let gx = 0; gx <= spImg.width; gx += fw) { x.beginPath(); x.moveTo(gx * sc + .5, 0); x.lineTo(gx * sc + .5, spSheet.height); x.stroke(); }
    for (let gy = 0; gy <= spImg.height; gy += fh) { x.beginPath(); x.moveTo(0, gy * sc + .5); x.lineTo(spSheet.width, gy * sc + .5); x.stroke(); }
  }
  function spLoop(now) {
    if (location.hash === "#art" && spImg) {
      const fw = +spIn.fw.value || 1, fh = +spIn.fh.value || 1, n = +spIn.n.value || Math.max(1, Math.floor(spImg.width / fw)), fps = +spIn.fps.value || 8;
      if (now - spLast > 1000 / fps) { spT++; spLast = now; }
      const x = spCv.getContext("2d"); x.imageSmoothingEnabled = false; x.fillStyle = css("--sunk"); x.fillRect(0, 0, 260, 260);
      const sc = Math.max(1, Math.floor(Math.min(240 / fw, 240 / fh))), k = spT % n;
      x.drawImage(spImg, k * fw, (+spIn.row.value || 0) * fh, fw, fh, (260 - fw * sc) / 2, (260 - fh * sc) / 2, fw * sc, fh * sc);
      x.fillStyle = css("--muted"); x.font = "11px " + css("--mono"); x.fillText("frame " + (k + 1) + "/" + n, 6, 252);
    }
    requestAnimationFrame(spLoop);
  }

  // ---------- 3D to sprite camera ----------
  const camCv = el("canvas", { class: "pv wide", width: 640, height: 330, "aria-label": "A low-poly survivor rendered from eight directions" });
  const cam = { elev: 30, walk: true, px: 0, frames: 8 };
  const camSel = el("select", { id: "cam-elev", "aria-label": "Camera angle" },
    el("option", { value: "30", text: "2:1 pixel isometric (30°)" }), el("option", { value: "35.264", text: "True isometric (35.26°)" }), el("option", { value: "45", text: "Three-quarter (45°)" }), el("option", { value: "60", text: "Steep top-down (60°)" }));
  const camPx = el("select", { id: "cam-px", "aria-label": "Sprite size" }, el("option", { value: "0", text: "Smooth render" }), el("option", { value: "64", text: "Downscaled to 64 px tall" }), el("option", { value: "40", text: "Downscaled to 40 px tall" }));
  const camFr = el("select", { id: "cam-fr", "aria-label": "Walk frames" }, el("option", { value: "8", text: "8-frame walk" }), el("option", { value: "6", text: "6-frame walk" }), el("option", { value: "4", text: "4-frame walk" }));
  const camWalk = el("label", {}, el("input", { type: "checkbox", id: "cam-walk", checked: true, onchange: e => cam.walk = e.target.checked }), "Walk cycle");
  const camInfo = el("p", { class: "note mono" });
  camSel.addEventListener("change", () => { cam.elev = +camSel.value; camText(); }); camPx.addEventListener("change", () => cam.px = +camPx.value); camFr.addEventListener("change", () => cam.frames = +camFr.value);
  function camText() { camInfo.textContent = "Blender camera: Orthographic · Rotation X " + (90 - cam.elev).toFixed(2).replace(/\.00$/, "") + "° · Y 0° · Z 45° + 45° per direction (or rotate the model) · light fixed to the camera, not the model."; }
  // boxes: [cx, cy, cz, sx, sy, sz, colour, part]
  const BODY = [[-.11, 0, .42, .12, .14, .84, "#2c3832", "legL"], [.11, 0, .42, .12, .14, .84, "#2c3832", "legR"], [0, 0, 1.1, .4, .22, .56, "#2f6fb3", "torso"],
    [0, -.17, 1.12, .3, .12, .44, "#6b4f35", "pack"], [-.27, 0, 1.08, .1, .12, .5, "#d9a37a", "armL"], [.27, .02, 1.08, .1, .12, .5, "#d9a37a", "armR"],
    [0, 0, 1.53, .24, .24, .28, "#d9a37a", "head"], [0, -.02, 1.69, .26, .26, .07, "#6b4f35", "hair"], [.27, .3, 1.0, .05, .6, .07, "#17201c", "gun"]];
  function boxFaces(b, swing) {
    const [cx, cy, cz, sx, sy, sz, col, part] = b; const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    let v = [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].map(([a, b2, c]) => [cx + a * hx, cy + b2 * hy, cz + c * hz]);
    const pivotZ = part.startsWith("leg") ? .84 : part.startsWith("arm") ? 1.32 : null;
    if (pivotZ != null) { const ang = (part === "legL" || part === "armR" ? 1 : -1) * swing * (part.startsWith("leg") ? .5 : .35);
      v = v.map(([x, y, z]) => { const dz = z - pivotZ; return [x, y * Math.cos(ang) - dz * Math.sin(ang), pivotZ + y * Math.sin(ang) + dz * Math.cos(ang)]; }); }
    if (part === "gun") { const ang = -swing * .2; v = v.map(([x, y, z]) => { const dz = z - 1.1; return [x, y * Math.cos(ang) - dz * Math.sin(ang), 1.1 + y * Math.sin(ang) + dz * Math.cos(ang)]; }); }
    return [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 3, 7, 4]].map(f => ({ v: f.map(i => v[i]), col }));
  }
  function shade(hex, k) { const n = parseInt(hex.slice(1), 16); return "rgb(" + [n >> 16, (n >> 8) & 255, n & 255].map(c => Math.min(255, Math.round(c * k))).join(",") + ")"; }
  function drawFigure(g, ox, oy, scale, yaw, swing, bob) {
    const e = cam.elev * Math.PI / 180, ce = Math.cos(e), se = Math.sin(e);
    const view = ([x, y, z]) => { const c = Math.cos(yaw), s = Math.sin(yaw); const x1 = x * c - y * s, y1 = x * s + y * c, z1 = z + bob; return [x1, y1, z1]; };
    const proj = ([x, y, z]) => [ox + x * scale, oy + (-z * ce - y * se) * scale];
    // ground cell (1 m, on the grid's axes: fixed, the model turns on it)
    g.fillStyle = css("--panel"); g.strokeStyle = css("--rule"); g.beginPath();
    [[-.5, -.5], [.5, -.5], [.5, .5], [-.5, .5]].map(([x, y]) => { const c = Math.cos(Math.PI / 4), s = Math.sin(Math.PI / 4); return proj([x * c - y * s, x * s + y * c, 0]); }).forEach((p, i) => i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]));
    g.closePath(); g.fill(); g.stroke();
    const L = [-.45, -.55, .7]; const ln = Math.hypot(...L); const Ln = L.map(x => x / ln);
    const d = [0, -ce, se];
    const faces = [];
    for (const b of BODY) for (const f of boxFaces(b, swing)) {
      const p = f.v.map(view);
      const u = p[1].map((x, i) => x - p[0][i]), w = p[3].map((x, i) => x - p[0][i]);
      let n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]]; const nl = Math.hypot(...n) || 1; n = n.map(x => x / nl);
      const cen = p.reduce((a, q) => a.map((x, i) => x + q[i] / 4), [0, 0, 0]);
      const bc = (b[0]); const out = [cen[0] - 0, cen[1], cen[2]];
      if (n[0] * (out[0] - view([b[0], b[1], b[2]])[0]) + n[1] * (out[1] - view([b[0], b[1], b[2]])[1]) + n[2] * (out[2] - view([b[0], b[1], b[2]])[2] - 0) < 0) n = n.map(x => -x);
      if (n[0] * d[0] + n[1] * d[1] + n[2] * d[2] <= 0) continue;
      faces.push({ p, depth: cen[0] * d[0] + cen[1] * d[1] + cen[2] * d[2], k: .5 + .62 * Math.max(0, n[0] * Ln[0] + n[1] * Ln[1] + n[2] * Ln[2]), col: f.col });
    }
    faces.sort((a, b) => a.depth - b.depth);
    for (const f of faces) { g.fillStyle = shade(f.col, f.k); g.beginPath(); f.p.map(proj).forEach((q, i) => i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1])); g.closePath(); g.fill(); }
  }
  const DIRS = ["S", "SW", "W", "NW", "N", "NE", "E", "SE"];
  const off = document.createElement("canvas");
  let camT0 = 0;
  function camLoop(now) {
    if (location.hash === "#art") {
      const g = camCv.getContext("2d"); const W = camCv.width, Hh = camCv.height; g.fillStyle = css("--sunk"); g.fillRect(0, 0, W, Hh);
      const cols = W < 500 ? 4 : 8, rows = cols === 8 ? 1 : 2, cw = W / cols, ch = (Hh - 20) / rows;
      const fr = Math.floor(now / 100) % cam.frames, swing = cam.walk ? Math.sin(fr / cam.frames * Math.PI * 2) : 0, bob = cam.walk ? Math.abs(Math.cos(fr / cam.frames * Math.PI * 2)) * .03 : 0;
      for (let i = 0; i < 8; i++) {
        const cx = (i % cols) * cw, cy = Math.floor(i / cols) * ch, yaw = Math.PI + i * Math.PI / 4;
        if (cam.px) {
          const scale = cam.px / 1.9; off.width = Math.ceil(scale * 1.7); off.height = cam.px + 6; const o = off.getContext("2d"); o.clearRect(0, 0, off.width, off.height);
          drawFigure(o, off.width / 2, off.height - 4 - scale * .25, scale, yaw, swing, bob);
          g.imageSmoothingEnabled = false; const up = Math.max(1, Math.min(Math.floor((ch - 30) / off.height), Math.floor((cw - 4) / off.width))); g.drawImage(off, Math.round(cx + cw / 2 - off.width * up / 2), Math.round(cy + ch - 24 - off.height * up), off.width * up, off.height * up);
        } else drawFigure(g, cx + cw / 2, cy + ch - 34, (ch - 40) / 1.9, yaw, swing, bob);
        g.fillStyle = css("--muted"); g.font = "600 11px " + css("--mono"); g.textAlign = "center"; g.fillText(DIRS[i] + " · ." + DIRS[i].toLowerCase(), cx + cw / 2, cy + ch - 6); g.textAlign = "left";
      }
      g.fillStyle = css("--muted"); g.font = "11px " + css("--mono"); g.fillText(cam.walk ? "walk frame " + (fr + 1) + "/" + cam.frames + " at 10 fps" : "idle pose", 8, Hh - 6);
    }
    requestAnimationFrame(camLoop);
  }
  function fitCam() { const w = Math.min(640, (camCv.parentElement ? camCv.parentElement.clientWidth : 640) - 2); camCv.width = Math.max(300, w); camCv.height = camCv.width < 500 ? 420 : 300; camCv.style.width = camCv.width + "px"; }

  function practise(id) {
    if (id === "models3d") { document.getElementById("camtool").scrollIntoView({ behavior: "smooth", block: "start" }); return; }
    if (!studio) return;
    const map = { sprites2d: "char", worldtiles: "hex", raidtiles: "isofloor", animation: "char" };
    studio.newFromTemplate(map[id] || "icon16", { frames: id === "animation" ? 4 : 1 }); studio.scrollIntoView();
  }

  // ---------- page ----------
  const tl = (A.tools || []);
  page.append(...[
    el("div", { class: "intro" }, el("div", { class: "kicker", text: "Milestone M8 prep · learn while the game is built with placeholders" }), el("h2", { text: "Art school" }),
      el("p", { text: A.intro || "" })),
    A.styleChoices ? el("section", {}, el("h3", { text: "Pick one style first" }), el("div", { class: "tscroll" }, el("table", { class: "t" },
      el("thead", {}, el("tr", {}, ["Style", "Good at", "Hard part", "For Broken State"].map(h => el("th", { text: h })))),
      el("tbody", {}, A.styleChoices.map(r => el("tr", {}, el("td", { text: r.style }), el("td", { text: r.good }), el("td", { text: r.hard }), el("td", { text: r.fit }))))))) : null,
    el("section", { class: "tracks" }, el("h3", { text: "Five tracks" }), trackBtns, trackPane),
    el("section", { id: "studio", class: "tool pxs-section" }, el("div", { class: "tool-h" }, el("h3", { text: "Pixel studio" }),
      el("p", { text: "An Aseprite-like editor for the game's sprites and tiles, made for a phone: draw with one finger and pinch to zoom, add layers and frames, tag animations, and import or export Aseprite files, palettes, sheets and GIFs; your sprites are kept in this browser." })),
      studioHost),
    el("section", { class: "tool" }, el("div", { class: "tool-h" }, el("h3", { text: "Sprite sheet player" }), spNote),
      el("div", { class: "studio" },
        el("div", { class: "studio-l" }, el("div", { class: "ctl" }, spFile),
          el("div", { class: "nums" }, ...[["sp-fw", "Frame width", spIn.fw], ["sp-fh", "Frame height", spIn.fh], ["sp-n", "Frames (0 = whole row)", spIn.n], ["sp-row", "Row", spIn.row], ["sp-fps", "fps", spIn.fps]].map(([id, t, inp]) => el("label", { for: id }, t, inp))),
          el("div", { class: "tscroll sheetwrap" }, spSheet), spToStudio),
        el("div", { class: "studio-r" }, spCv))),
    el("section", { id: "camtool", class: "tool" }, el("div", { class: "tool-h" }, el("h3", { text: "From 3D model to iso sprites" }),
      el("p", { text: "A low-poly survivor, as you would build it in Blender, seen by an orthographic camera from the eight directions an iso game needs. Change the angle to see why 2:1 pixel tiles use 30°, and downscale to see what a sprite at game size keeps." })),
      el("div", { class: "ctl wrapctl" }, camSel, camPx, camFr, camWalk), el("div", { class: "cv-wrap" }, camCv), camInfo),
    tl.length ? el("section", {}, el("h3", { text: "Tools to install" }), el("div", { class: "tscroll" }, el("table", { class: "t" },
      el("thead", {}, el("tr", {}, ["Tool", "Cost", "Use it for"].map(h => el("th", { text: h })))),
      el("tbody", {}, tl.map(r => el("tr", {}, el("td", {}, r.u ? el("a", { href: r.u, target: "_blank", rel: "noopener", text: r.name }) : r.name), el("td", { text: r.cost }), el("td", { text: r.for }))))))) : null,
    el("section", { class: "cols2" },
      A.pipeline ? el("div", { class: "box" }, el("h3", { text: "From sketch to the game" }), el("ol", { class: "olist" }, A.pipeline.map(s => el("li", { text: s })))) : null,
      A.commissioning ? el("div", { class: "box" }, el("h3", { text: "If you hire artists" }), bullets(A.commissioning, "tips")) : null),
    A.learnLinks ? el("section", { class: "box" }, el("h3", { text: "Where to keep learning" }), docs(A.learnLinks)) : null].filter(Boolean));

  renderTrack(); camText();
  studio = window.PixelStudio ? window.PixelStudio.mount(studioHost, { el, store, presets: PRESETS, palette: PALETTE, formats: window.AseFormats, saveFile }) : null;
  window.addEventListener("resize", fitCam); window.addEventListener("hashchange", () => { if (location.hash === "#art") setTimeout(fitCam, 0); });
  setTimeout(fitCam, 0);
  requestAnimationFrame(spLoop); requestAnimationFrame(camLoop);
};
