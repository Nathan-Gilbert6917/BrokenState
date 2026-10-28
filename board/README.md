# Broken State: the rebuild board

A planning board for rebuilding Broken State in Godot or Unity, built from this prototype: 121 cards in build order
(vertical slice first), each with a priority (P0 must have to P3 much work for little fun), its data, backend and UI
tasks, a C# data sketch, what it needs and unlocks, how it connects to other cards in each engine, beginner notes and
doc links. Tabs: **Board**, **Vertical slice**, **Infrastructure** (the stack, repo layout, Godot vs Unity), **Learn**
(learning path, glossary, using the prototype as the spec) and **Art school** (lessons for 2D sprites, 3D models, hex
map tiles, raid tiles and animation, with a pixel studio, a sprite-sheet player and a 3D-to-sprite camera).

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
    art.js            the Art school's tools
    app-head.html     the web-app tags for dist/index.html
  public/             manifest.webmanifest, sw.js (network first, the cache offline), icons/
  tools/make-icons.cjs  draws public/icons (NODE_PATH=$(npm root -g) node board/tools/make-icons.cjs)
```

`node board/build.js` writes `board/dist/` (git-ignored): `index.html` (the app), `artifact.html` (the same page
without the document wrapper, for the Claude artifact), the manifest, the service worker and the icons. The build fails
on a missing card, a reference to an unknown card, a card with no priority, or a card that needs one later in the build
order. To look at it locally: `cd board/dist && python3 -m http.server 8000`, then http://localhost:8000.

To add a card: give it a number and id in `card-order.md` under its lane, write it in the card format of
`card-brief.md` into a file in `data/cards/`, add its priority to `fixups.json`, and build.
