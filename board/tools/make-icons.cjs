// Draws the board's app icons into board/public/icons (192, 512, a maskable 512 with the art inside the safe circle,
// and the 180 px Apple touch icon). Needs Playwright and Chromium, like prototype/tools/mapshot.cjs:
//   NODE_PATH=$(npm root -g) node board/tools/make-icons.cjs
const { chromium } = require("playwright");
const path = require("path"), fs = require("fs");
const out = path.join(__dirname, "..", "public", "icons");
// Three lanes of cards on the board's dark slate, in its lane colours (infrastructure green, slice blue, later purple).
function draw(size, inset) {
  const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d");
  g.fillStyle = "#19211d"; g.fillRect(0, 0, size, size);
  const s = size * (1 - 2 * inset), o = size * inset, u = s / 100;
  const rr = (x, y, w, h, r, col) => { g.fillStyle = col; g.beginPath(); g.roundRect(o + x * u, o + y * u, w * u, h * u, r * u); g.fill(); };
  const lanes = [["#5cc489", [12, 12, 12]], ["#6aa8ea", [14, 10]], ["#ad9bd6", [10, 14, 10, 8]]];
  lanes.forEach(([col, cards], i) => {
    const x = 9 + i * 28.5;
    rr(x, 12, 25, 76, 4, "#0f1411");
    rr(x, 12, 25, 4, 2, col);
    let y = 20;
    for (const h of cards) { rr(x + 2.5, y, 20, h, 2.5, i === 0 ? "#2c3832" : "#26302b"); if (i) rr(x + 5, y + 3, 9, 2.4, 1.2, col); y += h + 3; }
  });
  // a tick on the first lane's cards: done
  g.strokeStyle = "#5cc489"; g.lineWidth = 2.4 * u; g.lineCap = "round"; g.lineJoin = "round";
  for (const y of [20, 35, 50]) { g.beginPath(); g.moveTo(o + 17.5 * u, o + (y + 6.2) * u); g.lineTo(o + 20.5 * u, o + (y + 8.8) * u); g.lineTo(o + 25.5 * u, o + (y + 3.6) * u); g.stroke(); }
  return c.toDataURL("image/png");
}
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const [name, size, inset] of [["icon-192.png", 192, 0.04], ["icon-512.png", 512, 0.04], ["icon-maskable-512.png", 512, 0.14], ["apple-touch-icon.png", 180, 0.06]]) {
    const url = await p.evaluate(`(${draw})(${size}, ${inset})`);
    fs.writeFileSync(path.join(out, name), Buffer.from(url.split(",")[1], "base64"));
  }
  await b.close(); console.log("icons written to " + out);
})();
