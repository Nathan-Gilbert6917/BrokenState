using System;
using System.Collections.Generic;
using BrokenState.Sim.Core;

namespace BrokenState.Sim.World
{
    /// <summary>
    /// The main roads between the cities and towns (the prototype's <c>mapgen.js</c> "roads": highways). A minimum
    /// spanning tree over every settlement centre (Prim's, by hex distance), each edge routed by A* over the terrain's
    /// road cost: an existing road 0.4, flat ground 1, forest 2, hills 3, a river 7 (a bridge), a lake 12 (a long
    /// bridge), a mountain 9, the ocean never. Then loops: each settlement gets a straight road to its two nearest
    /// neighbours within LoopMaxDistance when no road between them is within distance × LoopDetour + 2 steps.
    ///
    /// TODO (board card world.mapgen): streets and spurs from the sites inside a settlement to the nearest road, dirt
    /// roads to some countryside sites, and truck stops along the highways (mapgen.js ~lines 566–600).
    /// </summary>
    public static class Roads
    {
        public static double StepCost(WorldMap map, int from, int to)
        {
            var t = map.Tiles[to];
            if (t.Water == WaterKind.Ocean) return double.PositiveInfinity;
            if (t.Water == WaterKind.Lake) return 12;
            if (t.Terrain == Terrain.Water) return 7;
            if (t.Terrain == Terrain.Mountain) return 9;
            if (t.Road) return 0.4;
            switch (t.Terrain)
            {
                case Terrain.Forest: return 2;
                case Terrain.Hills: return 3;
                default: return 1; // plains, suburb, city
            }
        }

        public static void Lay(WorldMap map, MapConfig cfg)
        {
            var grid = map.Grid;
            var centres = new List<int>();
            foreach (var s in map.Settlements()) centres.Add(s.CenterId);
            if (centres.Count < 2) { foreach (int c in centres) map.Tiles[c].Road = true; return; }

            Func<int, int, double> cost = (a, b) => StepCost(map, a, b);
            void RoadTo(int from, int to)
            {
                var res = HexPath.Find(grid, from, to, cost, double.PositiveInfinity, 0.4);
                if (res != null) LayPath(map, res.Path);
            }

            // Prim's: every pending settlement remembers its nearest connected one (the prototype's speed-up for Huge maps).
            var pending = new List<(int p, int c, int d)>();
            for (int i = 1; i < centres.Count; i++) pending.Add((centres[i], centres[0], grid.Distance(centres[i], centres[0])));
            while (pending.Count > 0)
            {
                int at = 0;
                for (int i = 1; i < pending.Count; i++) if (pending[i].d < pending[at].d) at = i;
                var best = pending[at];
                RoadTo(best.c, best.p);
                pending.RemoveAt(at);
                for (int i = 0; i < pending.Count; i++)
                {
                    int d = grid.Distance(pending[i].p, best.p);
                    if (d < pending[i].d) pending[i] = (pending[i].p, best.p, d);
                }
            }

            if (!cfg.LoopRoads) return;
            Func<int, int, double> roadOnly = (a, b) => map.Tiles[a].RoadLinks.Contains(b) ? 1 : double.PositiveInfinity;
            foreach (int s in centres)
            {
                // The two nearest other settlements.
                int n1 = -1, n2 = -1, d1 = int.MaxValue, d2 = int.MaxValue;
                foreach (int o in centres)
                {
                    if (o == s) continue;
                    int d = grid.Distance(s, o);
                    if (d < d1) { n2 = n1; d2 = d1; n1 = o; d1 = d; }
                    else if (d < d2) { n2 = o; d2 = d; }
                }
                foreach (int o in new[] { n1, n2 })
                {
                    if (o < 0) continue;
                    int d = grid.Distance(s, o);
                    if (d <= cfg.LoopMaxDistance && HexPath.Find(grid, s, o, roadOnly, d * cfg.LoopDetour + 2, 1) == null) RoadTo(s, o);
                }
            }
        }

        private static void LayPath(WorldMap map, List<int> path)
        {
            for (int i = 0; i < path.Count; i++)
            {
                var t = map.Tiles[path[i]];
                t.Road = true;
                if (t.Terrain == Terrain.Water) t.Bridge = true;
                if (i > 0)
                {
                    var prev = map.Tiles[path[i - 1]];
                    if (!prev.RoadLinks.Contains(t.Id)) prev.RoadLinks.Add(t.Id);
                    if (!t.RoadLinks.Contains(prev.Id)) t.RoadLinks.Add(prev.Id);
                }
            }
        }
    }
}
