// The HD sprite designs next to the game's sprites at in-game scale (design/hd/index.html). Loads each set that
// exists (people.js, dead.js, items.js) and skips the ones it cannot import.
import { survivorCanvas, enemyCanvas, zombieCanvas, armoredCanvas } from "../../src/ui/sprites.js";
import { partySpriteCanvas, soloSpriteCanvas, cyclistSpriteCanvas, groupPartyCanvas, hordeSpriteCanvas, herdSpriteCanvas, hiveSpriteCanvas, skullCanvas, markerSpriteCanvas, iconCanvas } from "../../src/ui/mapsprites.js";
import { randomAppearance } from "../../src/sim/appearance.js";
import { Rng } from "../../src/sim/rng.js";
import { toCanvas } from "./hdcore.js";

const UNIT_H = 30; // isoview.js: a standing unit in art px
const ZOOMS = [1, 2, 3, 4];
const main = document.getElementById("panels");
const dpr = window.devicePixelRatio || 1;

function cell(cv, drawW, drawH, label) {
  const f = document.createElement("figure");
  const c = document.createElement("canvas");
  c.width = Math.ceil(drawW * dpr); c.height = Math.ceil(drawH * dpr);
  c.style.width = `${drawW}px`; c.style.height = `${drawH}px`;
  const ctx = c.getContext("2d");
  ctx.imageSmoothingEnabled = false;
  if (cv) ctx.drawImage(cv, 0, 0, c.width, c.height);
  f.appendChild(c);
  const cap = document.createElement("figcaption"); cap.textContent = label; f.appendChild(cap);
  return f;
}
function section(title, note) {
  const d = document.createElement("div"); d.className = "row";
  const h = document.createElement("h2"); h.textContent = title; d.appendChild(h);
  if (note) { const p = document.createElement("p"); p.textContent = note; d.appendChild(p); }
  main.appendChild(d);
  return d;
}
function rowOf(parent, title) {
  if (title) { const h = document.createElement("h3"); h.textContent = title; parent.appendChild(h); }
  const r = document.createElement("div"); r.className = "cells"; parent.appendChild(r);
  return r;
}
// A current / HD pair at each zoom.
function pairs(parent, items) {
  for (const S of ZOOMS) {
    const r = rowOf(parent, `zoom ${S}× (unit ${UNIT_H * S} px tall)`);
    const h = UNIT_H * S, w = h * (22 / 26);
    for (const it of items) {
      const box = document.createElement("div"); box.className = "pair";
      box.appendChild(cell(it.cur, w, h, "current"));
      box.appendChild(cell(it.hd ? toCanvas(it.hd, 2) : null, w, h, it.label));
      r.appendChild(box);
    }
  }
}
async function load(name) { try { return await import(`./${name}.js`); } catch (e) { console.warn(name, e); return null; } }
function fail(parent, name, what) { const p = document.createElement("p"); p.className = "err"; p.textContent = `${name}.js: ${what}`; parent.appendChild(p); }

const people = await load("people");
{
  const sec = section("Survivors and hostile people", "Six seeded survivors with gear, then raiders, soldiers and zealots in a group colour.");
  if (!people || !people.paintSurvivorHD) fail(sec, "people", "not loaded or no paintSurvivorHD export");
  else {
    const items = [];
    const gear = [["machete", "padding"], ["huntrifle", null], ["pistol", "scrapvest"], ["bat", null], ["ar", "tacvest"], ["compbow", "sportspads"]];
    for (let i = 0; i < 6; i++) {
      const app = randomAppearance(new Rng(100 + i * 7));
      const [wk, ak] = gear[i];
      let hd = null; try { hd = people.paintSurvivorHD(app, wk, ak); } catch (e) { console.warn(e); }
      items.push({ cur: survivorCanvas(app, wk, ak), hd, label: `HD ${wk}` });
    }
    if (people.paintEnemyHD) for (const [kit, col, wk, ak, seed] of [["raiders", "#a63a32", "nailbat", null, 3], ["raiders", "#2d5fa8", "shotgun", "tirevest", 8], ["soldiers", "#3f7a3a", "ar", "vest", 2], ["zealots", "#d9b23a", "machete", null, 5]]) {
      let hd = null; try { hd = people.paintEnemyHD(kit, col, wk, ak, seed); } catch (e) { console.warn(e); }
      items.push({ cur: enemyCanvas(kit, col, wk, ak, seed), hd, label: `HD ${kit}` });
    }
    pairs(sec, items);
  }
}
const dead = await load("dead");
{
  const sec = section("The dead", "Walkers, a runner, a bloated one, a brute and the armoured dead, with the default look settings.");
  if (!dead || !dead.paintZombieHD) fail(sec, "dead", "not loaded or no paintZombieHD export");
  else {
    const items = [];
    for (const [v, seed] of [["walker", 1], ["walker", 2], ["walker", 9], ["runner", 4], ["bloated", 5], ["brute", 6]]) {
      let hd = null; try { hd = dead.paintZombieHD(v, seed); } catch (e) { console.warn(e); }
      items.push({ cur: zombieCanvas(v, seed), hd, label: `HD ${v}` });
    }
    if (dead.paintArmoredDeadHD) for (const [k, seed] of [["soldier", 2], ["riot", 3]]) {
      let hd = null; try { hd = dead.paintArmoredDeadHD(k, seed); } catch (e) { console.warn(e); }
      items.push({ cur: armoredCanvas(k, seed), hd, label: `HD ${k}` });
    }
    pairs(sec, items);
    if (dead.paintSpecialHD) {
      const r = rowOf(sec, "special dead (HD only), zoom 3×");
      for (const k of ["spitter", "screamer", "crawler", "shepherd", "carrier", "swarm", "boneback", "climber", "flinger", "sower", "nightmare"]) {
        let p = null; try { p = dead.paintSpecialHD(k); } catch (e) { console.warn(e); }
        if (!p) continue;
        const h = UNIT_H * 3 * (p.h / 52), w = h * (p.w / p.h);
        r.appendChild(cell(toCanvas(p, 2), w, h, k));
      }
    }
  }
}
const items = await load("items");
{
  const sec = section("Items", "The inventory shows item icons at about 24 CSS px in a row and 32 px in a tile; today they are emoji.");
  if (!items || !items.paintItemHD) fail(sec, "items", "not loaded or no paintItemHD export");
  else {
    const keys = (items.SHEET || []).map((c) => c.label).filter(Boolean);
    for (const px of [24, 32, 64]) {
      const r = rowOf(sec, `${px} px`);
      for (const k of keys) {
        let p = null; try { p = items.paintItemHD(k); } catch (e) { console.warn(e); }
        if (!p) continue;
        r.appendChild(cell(toCanvas(p, 2), px, px * (p.h / p.w), k));
      }
    }
  }
}

const map = await load("map");
{
  const sec = section("State map: parties, hordes, hives and markers", "A party is 22–30 world px wide (× the camera zoom, 1–3); a team of one draws 1.3 world px per sprite px. Each pair: the game's sprite, then the HD one at the same footprint, at zoom 1×, 2× and 3×.");
  if (!map) fail(sec, "map", "not loaded");
  else {
    const tryHD = (fn, ...a) => { try { return map[fn] ? map[fn](...a) : null; } catch (e) { console.warn(fn, e); return null; } };
    const list = [
      ["truck", partySpriteCanvas("convoy", "#4f8fd6"), tryHD("paintTruckHD", "#4f8fd6"), 30],
      ["walkers", partySpriteCanvas("walkers", "#4f8fd6", 3), tryHD("paintWalkersHD", "#4f8fd6", 3, false), 22],
      ["raid", partySpriteCanvas("raid", "#4f8fd6", 4), tryHD("paintWalkersHD", "#4f8fd6", 4, true), 22],
      ["boat", partySpriteCanvas("boat", "#4f8fd6"), tryHD("paintBoatHD", "#4f8fd6", false), 30],
      ["solo", soloSpriteCanvas("walkers", "#4f8fd6", 1), tryHD("paintSoloHD", { color: "#4f8fd6" }, 1, "", ""), 16 * 1.3],
      ["cyclist", cyclistSpriteCanvas("#4f8fd6", 1), tryHD("paintCyclistHD", "#4f8fd6", 1), 16 * 1.3],
      ["raider truck", groupPartyCanvas("raider", "truck", "#a63a32", 3), tryHD("paintRaiderTruckHD", "#a63a32"), 28],
      ["humvee", groupPartyCanvas("military", "truck", "#3f7a3a", 3), tryHD("paintHumveeHD", "#3f7a3a"), 28],
      ["horde 6", hordeSpriteCanvas(6), tryHD("paintHordeHD", 6, {}), 28],
      ["horde 10", hordeSpriteCanvas(10), tryHD("paintHordeHD", 10, {}), 32],
      ["herd", herdSpriteCanvas("deer", 3), tryHD("paintHerdHD", "deer", 3), 28],
      ["hive 2", hiveSpriteCanvas(2), tryHD("paintHiveHD", 2), 28],
      ["skull", skullCanvas(), tryHD("paintSkullHD"), 12],
      ["cache", markerSpriteCanvas("cache"), tryHD("paintCacheMarkerHD", false), 20],
      ["grave", markerSpriteCanvas("grave"), tryHD("paintGraveMarkerHD", 0), 20],
      ["wreck", markerSpriteCanvas("wreck"), tryHD("paintWreckMarkerHD", false), 24],
    ];
    for (const Z of [1, 2, 3]) {
      const r = rowOf(sec, `zoom ${Z}×`);
      for (const [label, cur, hd, w0] of list) {
        const w = w0 * Z;
        const box = document.createElement("div"); box.className = "pair";
        const ch = cur ? w * (cur.height / cur.width) : w;
        box.appendChild(cell(cur, w, ch, "current"));
        const hcv = hd ? toCanvas(hd, 2) : null;
        box.appendChild(cell(hcv, w, hcv ? w * (hcv.height / hcv.width) : w, `HD ${label}`));
        r.appendChild(box);
      }
    }
  }
}
