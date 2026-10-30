# Broken State: the rebuild board

A planning board for rebuilding Broken State in Godot or Unity, built from this prototype: 121 cards in build order
(vertical slice first), each with a priority (P0 must have to P3 much work for little fun), its data, backend and UI
tasks, a C# data sketch, what it needs and unlocks, how it connects to other cards in each engine, beginner notes and
doc links. Tabs: **Board**, **Vertical slice**, **Infrastructure** (the stack, repo layout, Godot vs Unity), **Learn**
(learning path, glossary, using the prototype as the spec) and **Art school** (lessons for 2D sprites, 3D models, hex
map tiles, raid tiles and animation, with the pixel studio, a sprite-sheet player and a 3D-to-sprite camera).

## The pixel studio

The Art school's studio is an Aseprite-like pixel editor made for a phone first (the user's request 2026-10-29): draw,
change and animate sprites on the game's templates (16 × 16 icon, 48 × 52 character with the feet on the pivot, 48 × 56
hex, 32 × 16 iso floor, 32 × 50 iso wall cell) or any size up to 256 × 256, with layers, frames, tags and onion skin.

- **Phone first.** One finger draws, two fingers pinch to zoom and pan; the tools, colours and timeline sit in strips
  under the canvas with the panels (Layers, Palette, Frames, Preview, Canvas, File) as a sheet above them; **Full
  screen** fixes the studio to the whole screen. On a desktop the same studio spreads out (tools left, panels right)
  and takes the keyboard (B pencil, E eraser, G fill, L line, U rectangle, O ellipse, M select, V move, I pick, H pan,
  X swap colours, [ ] brush size, , . frames, Ctrl+Z / Ctrl+Y, Ctrl+C / X / V).
- **Tools.** Pencil (sizes 1–4, pixel-perfect), eraser, fill (contiguous or global), line, rectangle, ellipse,
  rectangle select with move / cut / copy / paste / flip / rotate, move with wrap for tiles, eyedropper, pan; mirror X
  and Y; undo and redo (100 steps); a Clear button that asks first (this frame on the layer, this frame, or the whole sprite;
  the user's request 2026-10-29). Transparent pixels show a checkerboard of darker and lighter squares 4 × 4 sprite
  pixels a side (a 16 × 16 sprite shows 4 × 4 squares, hard-edged like Aseprite's), a size set in the Canvas panel, and the
  pixel grid is off until turned on there (the user's requests 2026-10-30). Layers with visibility, lock, opacity, merge and flatten. Frames with their own
  durations in ms, tags with a direction, playback of the sprite or a tag, onion skin, the animation preview and the
  tiled preview that lays a tile out the way the engine will.
- **Aseprite's files.** Imports and exports `.aseprite` / `.ase` (layers, cels, durations, tags, the palette; indexed
  and greyscale files are read as RGBA, groups are flattened out, tilemaps are skipped with a note) and its palettes:
  `.gpl` (GIMP, with Aseprite's RGBA channels), `.pal` (JASC), `.act` (Adobe), `.hex` (Lospec) and a PNG strip. Also
  imports a PNG (one frame, a row of frames by frame size, or Aseprite's sheet JSON beside it), and exports a PNG sheet
  with Aseprite's JSON, the current frame at any scale, and a GIF of the animation.
- **Kept on the device.** Every sprite autosaves (as `.aseprite` bytes in the browser's IndexedDB; localStorage when
  that is not there), and the File panel lists them: open, rename, duplicate, delete.
- **A fresh studio.** **Open a new studio** (the button by the studio's heading, or the top strip's window icon; the
  user's request 2026-10-29) puts a second studio over the whole page, starting from a start screen: create a new sprite
  with its width (x) and height (y) in pixels, a name, frames and an optional template; import an `.aseprite` file or
  an image; or open a saved sprite. Its Close (or Escape) removes it, and the page's own studio carries on where it was.

The format code is `src/formats.js` (no DOM; `node board/tools/formats-test.js` round-trips every format) and the
editor `src/studio.js` + `src/studio.css`; `NODE_PATH=$(npm root -g) node board/tools/studio-smoke.cjs [--shots dir]`
drives the built page in headless Chromium at a phone's size and a desktop's.

## Open it, and put it on your phone

**https://nathan-gilbert6917.github.io/BrokenState/board/**, published by `.github/workflows/pages.yml` with the game
on every push to `dev`.

It is an installable web app: once it has been opened once it also opens offline.

- **iPhone / iPad (Safari):** open the link, Share → *Add to Home Screen* → Add.
- **Android (Chrome):** open the link, ⋮ → *Add to Home screen* (or *Install app*).
- **Desktop Chrome / Edge:** the install icon at the right of the address bar.

The same page is also a Claude artifact (https://claude.ai/artifact/7z1fLsd2L5pckPfdLy5Efd), where Claude can update it.

**Progress** (a card's To do / Doing / Done and its ticked tasks) is kept where you use the board: in the Claude
artifact's database, and in each installed app's own storage on that device. **Move progress** above the board copies
it as a short code to paste into the board on the other side.

## How it is made

```
board/
  build.js            builds dist/ from data/ and src/ (node board/build.js; --check validates only)
  data/
    card-order.md     the lanes and every card's number, id and title: the build order
    cards/*.json      the cards, one array a file (A infrastructure, data and core; B survivors, base, items;
                      C travel and world; D slice combat; E deep tactics and gear; F placeholder UI and controller;
                      G meta, art, release; H the living hub; I the dead, defence, groups;
                      J the free-movement option)
    card-brief.md     the format of a card: every field and what goes in it
    fixups.json       changes made while merging the cards: order swaps, added or removed dependencies, extra tasks,
                      lanes, and every card's priority [P0–P3, value, effort (null: from its size), why]
    guide.json        the Infrastructure and Learn tabs
    art-school.json   the Art school's lessons; presets.json its studio templates and palette
  src/
    template.html     the page (styles, board, drawer, the four other tabs)
    formats.js        Aseprite's file formats for the studio: .aseprite, palettes, sheet JSON, GIF (no DOM)
    studio.js         the pixel studio; studio.css its styles
    art.js            the Art school page: lessons, the studio's mount, the sheet player, the 3D camera
    app-head.html     the web-app tags for dist/index.html
  public/             manifest.webmanifest, sw.js (network first, the cache offline), icons/
  tools/make-icons.cjs  draws public/icons (NODE_PATH=$(npm root -g) node board/tools/make-icons.cjs)
  tools/formats-test.js  the format round trips (node board/tools/formats-test.js)
  tools/studio-smoke.cjs the studio driven in headless Chromium at a phone's and a desktop's size
```

`node board/build.js` writes `board/dist/` (git-ignored): `index.html` (the app), `artifact.html` (the same page
without the document wrapper, for the Claude artifact), the manifest, the service worker and the icons. The build fails
on a missing card, a reference to an unknown card, a card with no priority, or a card that needs one later in the build
order. To look at it locally: `cd board/dist && python3 -m http.server 8000`, then http://localhost:8000.

To add a card: give it a number and id in `card-order.md` under its lane, write it in the card format of
`card-brief.md` into a file in `data/cards/`, add its priority to `fixups.json`, and build.
