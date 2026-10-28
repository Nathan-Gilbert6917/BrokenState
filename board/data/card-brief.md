# Brief for every card-writing agent

Read board/data/card-order.md first: it has the
game, the shared architecture (engine-free C# sim + thin Godot/Unity bridge, JSON content, art keys), the
vertical-slice definition and the full card list with IDs and order. Use ONLY those IDs in dependsOn/connections.

Ground each card in the real prototype: skim docs/agents/features.md, the relevant docs/features/<area>.md
sections, and the header comment (first ~40 lines) of the key prototype modules (prototype/src/sim/*.js). Do NOT
read whole 3000–8000-line files; use grep/head. The prototype's numbers (map sizes, rates, counts) are useful
"fullScope" facts. Don't spend long: breadth over depth.

The reader is a NEW game developer. Explain concepts plainly (what a state machine is, why A*, what a Resource
or ScriptableObject is, signals vs C# events, etc.) without being condescending. Be concrete and practical.

## Output
Write a JSON array (valid JSON, UTF-8, no comments) to
board/data/cards/<GROUP_LETTER>.json
and check it parses (`node -e "JSON.parse(require('fs').readFileSync(process.argv[1]))" <file>`).
One object per assigned card, with exactly these fields:

{
  "id": "core.clock",                       // from card-order.md
  "title": "Game clock & tick scheduler",
  "summary": "1–2 sentences: what this is in Broken State",
  "whyHere": "1–2 sentences: why it sits at this point in the build order / what it unblocks",
  "subsystems": ["3–8 short subsystem names"],
  "sliceScope": "For slice cards: the minimum version for the vertical slice. For post-slice cards: the smallest useful first version to build when you reach it.",
  "fullScope": "What the full game has (from the prototype), 1–3 sentences with real numbers where handy",
  "protoRefs": ["prototype/src/sim/world.js", "docs/features/campaign.md"],   // 1–5 paths that exist
  "tasks": {
    "data":    ["2–5 concrete tasks: records/JSON content/schemas to define"],
    "backend": ["2–6 concrete tasks: sim logic, written & unit-tested engine-free"],
    "ui":      ["1–4 tasks: placeholder UI/presentation only (art is human-made later)"]
  },
  "dataModel": "A short C# sketch (records/classes/enums, ~4–12 lines) of the key data. Use \\n for new lines.",
  "dependsOn": ["ids that must exist first"],
  "connections": [   // 2–5 of the most important links to OTHER cards
    {"to": "data.save", "why": "why they talk", "how": "how, in the engine-free sim (C# interface/event/command/ID)",
     "godot": "how the Godot side wires it (signals, autoloads, nodes…)",
     "unity": "how the Unity side wires it (MonoBehaviour, ScriptableObject, events…)"}
  ],
  "godot": {"approach": "2–4 sentences on implementing the engine-facing part in Godot 4 .NET",
            "keyApis": ["Node names / classes, e.g. TileMapLayer, AStar2D, Control, Resource"],
            "docs": [{"t": "title", "u": "https://docs.godotengine.org/en/stable/..."}]},   // 2–4 links
  "unity": {"approach": "2–4 sentences for Unity 6",
            "keyApis": ["e.g. ScriptableObject, Tilemap, UI Toolkit, NavMesh"],
            "docs": [{"t": "title", "u": "https://docs.unity3d.com/Manual/..."}]},         // 2–4 links
  "learn": [{"t": "title", "u": "url"}],     // 0–3 general learning resources (redblobgames, gameprogrammingpatterns.com, Microsoft Learn, GDC talks…)
  "newb": ["3–5 beginner insights: concepts, why it's done this way, mental models"],
  "pitfalls": ["2–4 common mistakes to avoid"],
  "test": "how to know it works: the unit tests and the manual check",
  "size": "S | M | L | XL"   // S ≈ a weekend, M ≈ 1–2 weeks, L ≈ 3–6 weeks, XL ≈ 2+ months for one hobbyist
}

Doc links: use real, stable official URLs only (docs.godotengine.org/en/stable/…, docs.unity3d.com/Manual/… or
/ScriptReference/…, docs.unity3d.com/Packages/…, learn.microsoft.com/…, redblobgames.com, gameprogrammingpatterns.com).
Prefer section index pages you are confident exist over guessed deep pages. If WebFetch is available, spot-check a
few links you are unsure of; drop any you cannot stand behind. Keep each string tight: this goes on cards.
When done, reply with only: the file path, the number of cards, and any card you think belongs in another lane
or a missing dependency you noticed (one line each). Do not modify the repository.
