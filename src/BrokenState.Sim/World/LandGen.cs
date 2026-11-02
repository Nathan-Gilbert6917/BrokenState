using System;
using System.Collections.Generic;
using BrokenState.Sim.Core;

namespace BrokenState.Sim.World
{
    /// <summary>
    /// The land: noise terrain, the ocean, the lakes and the rivers (the first part of the prototype's
    /// <c>mapgen.js landMap</c>, plus the rebuild's ocean and lakes).
    ///
    /// Parity with the prototype: <see cref="TerrainPass(WorldMap, Rng)"/> draws the three noise fields and decides every
    /// tile's terrain exactly as landMap does, so a seed gives the same elevations and terrain (the golden test). The
    /// ocean and the lakes spend no dice: they are read off the elevation field. The rivers follow the prototype's
    /// rule (downhill from the northern highlands with a southward pull and a little jitter) but not its dice: the
    /// prototype draws its jitter inside a sort comparator, which depends on the JavaScript engine's sort, so from the
    /// rivers on a map is the prototype's in kind, not tile for tile.
    /// </summary>
    public static class LandGen
    {
        // mapgen.js landMap: the noise cells and the terrain thresholds.
        public const double ElevCell1 = 9, ElevCell2 = 4.5, MoistCell = 8;
        public const double MountainAbove = 0.78, HillsAbove = 0.63, ForestAbove = 0.56;

        /// <summary>Pass 1: elevation and moisture noise to terrain (plains, forest, hills, mountain). Exact prototype parity.</summary>
        public static void TerrainPass(WorldMap map, Rng rng)
        {
            int w = map.Grid.Width, h = map.Grid.Height;
            var n1 = new ValueNoise(rng, w, h, ElevCell1);
            var n2 = new ValueNoise(rng, w, h, ElevCell2);
            var m1 = new ValueNoise(rng, w, h, MoistCell);
            for (int id = 0; id < map.Grid.Size; id++)
            {
                var t = map.Tiles[id];
                int x = t.X, y = t.Y;
                double north = 1 - y / (double)(h - 1);
                double elev = n1.At(x, y) * 0.65 + n2.At(x, y) * 0.35 + north * 0.38 - 0.12;
                double moist = m1.At(x, y);
                t.Elev = elev;
                t.Moist = moist;
                if (elev > MountainAbove) t.Terrain = Terrain.Mountain;
                else if (elev > HillsAbove) t.Terrain = Terrain.Hills;
                else if (moist > ForestAbove) t.Terrain = Terrain.Forest;
                else t.Terrain = Terrain.Plains;
            }
        }

        /// <summary>
        /// Pass 2: the ocean along the south edge. In the coast band (OceanDepth tiles up from the edge) a tile is sea
        /// where its elevation, pulled down the closer it lies to the edge, falls under OceanLevel; so low ground makes
        /// bays and high ground headlands, and the coast wanders. Only sea joined to the edge is ocean; a pocket cut off
        /// from it is a lake (of LakeMinSize or more) or stays land. No dice.
        /// </summary>
        public static void Ocean(WorldMap map, MapConfig cfg)
        {
            if (cfg.OceanDepth <= 0) return;
            var grid = map.Grid;
            int h = grid.Height;
            var sea = new bool[grid.Size];
            for (int id = 0; id < grid.Size; id++)
            {
                var t = map.Tiles[id];
                int up = h - 1 - t.Y;
                if (up >= cfg.OceanDepth) continue;
                double falloff = 1 - up / (double)cfg.OceanDepth; // 1 on the edge, 0 at OceanDepth
                if (t.Elev - 0.6 * falloff < cfg.OceanLevel) sea[id] = true;
            }
            // Flood from the south edge: what the sea reaches is ocean.
            var ocean = new bool[grid.Size];
            var queue = new Queue<int>();
            for (int x = 0; x < grid.Width; x++)
            {
                int id = grid.Id(x, h - 1);
                if (sea[id] && !ocean[id]) { ocean[id] = true; queue.Enqueue(id); }
            }
            var nbrs = new List<int>(6);
            while (queue.Count > 0)
            {
                int cur = queue.Dequeue();
                grid.NeighborsInto(cur, nbrs);
                foreach (int n in nbrs) if (sea[n] && !ocean[n]) { ocean[n] = true; queue.Enqueue(n); }
            }
            for (int id = 0; id < grid.Size; id++)
            {
                if (!ocean[id]) continue;
                var t = map.Tiles[id];
                t.Terrain = Terrain.Water;
                t.Water = WaterKind.Ocean;
            }
            // Cut-off pockets: lakes when big enough.
            for (int id = 0; id < grid.Size; id++) if (sea[id] && !ocean[id]) sea[id] = true; else sea[id] = false;
            Pools(map, sea, cfg.LakeMinSize);
        }

        /// <summary>
        /// Pass 3: lakes within LakeBand tiles of the north, east and west edges, wherever the land lies below
        /// LakeLevel, in pools of LakeMinSize or more (smaller hollows stay land). No dice.
        /// </summary>
        public static void Lakes(WorldMap map, MapConfig cfg)
        {
            if (cfg.LakeBand <= 0) return;
            var grid = map.Grid;
            var low = new bool[grid.Size];
            for (int id = 0; id < grid.Size; id++)
            {
                var t = map.Tiles[id];
                if (t.IsWater) continue;
                bool inBand = t.Y < cfg.LakeBand || t.X < cfg.LakeBand || t.X >= grid.Width - cfg.LakeBand;
                if (inBand && t.Elev < cfg.LakeLevel) low[id] = true;
            }
            Pools(map, low, cfg.LakeMinSize);
        }

        /// <summary>Turns the connected pools of marked tiles of at least minSize into lakes.</summary>
        private static void Pools(WorldMap map, bool[] marked, int minSize)
        {
            var grid = map.Grid;
            var seen = new bool[grid.Size];
            var pool = new List<int>();
            var queue = new Queue<int>();
            var nbrs = new List<int>(6);
            for (int start = 0; start < grid.Size; start++)
            {
                if (!marked[start] || seen[start]) continue;
                pool.Clear();
                seen[start] = true;
                queue.Enqueue(start);
                while (queue.Count > 0)
                {
                    int cur = queue.Dequeue();
                    pool.Add(cur);
                    grid.NeighborsInto(cur, nbrs);
                    foreach (int n in nbrs) if (marked[n] && !seen[n]) { seen[n] = true; queue.Enqueue(n); }
                }
                if (pool.Count < minSize) continue;
                foreach (int id in pool)
                {
                    var t = map.Tiles[id];
                    t.Terrain = Terrain.Water;
                    t.Water = WaterKind.Lake;
                }
            }
        }

        /// <summary>
        /// Pass 4: rivers (mapgen.js landMap "Rivers run from the northern highlands toward the south edge"). 3–4 per
        /// 64 tiles of width unless RiverCount is set; sources in the hills and mountains of the top 30% of the map, at
        /// least 12 apart; each walks up to 100 steps, never upward on the map, to the neighbour with the lowest
        /// elevation − 0.08 when it lies further south + jitter × 0.08, and ends at the south edge, in the sea or a lake,
        /// or when it has nowhere left to go.
        /// </summary>
        public static void Rivers(WorldMap map, MapConfig cfg, Rng rng)
        {
            var grid = map.Grid;
            int w = grid.Width, h = grid.Height;
            int count = cfg.RiverCount > 0 ? cfg.RiverCount : JsMath.RoundToInt((3 + (rng.Chance(0.5) ? 1 : 0)) * (w / (double)WorldSizes.BaseW));
            var highs = new List<Tile>();
            foreach (var t in map.Tiles)
                if (t.Y < h * 0.3 && (t.Terrain == Terrain.Hills || t.Terrain == Terrain.Mountain)) highs.Add(t);
            var sources = new List<int>();
            var nbrs = new List<int>(6);
            var opts = new List<Tile>(6);
            for (int r = 0; r < count && highs.Count > 0; r++)
            {
                var apart = new List<Tile>();
                foreach (var t in highs)
                {
                    if (t.River) continue;
                    bool ok = true;
                    foreach (int s in sources) if (grid.Distance(s, t.Id) < 12) { ok = false; break; }
                    if (ok) apart.Add(t);
                }
                var cur = rng.Pick(apart.Count > 0 ? apart : highs);
                sources.Add(cur.Id);
                for (int step = 0; step < 100; step++)
                {
                    if (cur.IsWater && !cur.River) break; // the sea or a lake: the river ends here
                    cur.Terrain = Terrain.Water;
                    cur.Water = WaterKind.River;
                    if (cur.Y >= h - 1) break;
                    grid.NeighborsInto(cur.Id, nbrs);
                    opts.Clear();
                    foreach (int n in nbrs) { var t = map.Tiles[n]; if (t.Y >= cur.Y && !t.River) opts.Add(t); }
                    if (opts.Count == 0) break;
                    // The lowest neighbour, a southward pull and jitter; one draw an option, in neighbour order (not the
                    // prototype's comparator draws).
                    Tile? best = null;
                    double bestScore = double.PositiveInfinity;
                    foreach (var t in opts)
                    {
                        double score = t.Elev + (t.Y > cur.Y ? -0.08 : 0) + rng.Next() * 0.08;
                        if (score < bestScore) { bestScore = score; best = t; }
                    }
                    cur = best!;
                }
            }
        }
    }
}
