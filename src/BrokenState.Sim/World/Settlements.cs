using System;
using System.Collections.Generic;
using BrokenState.Sim.Core;

namespace BrokenState.Sim.World
{
    /// <summary>
    /// How the settlement tiles are set: how many cities and towns there are, where they go, and which tiles become
    /// city, suburb and rural around each.
    ///
    /// The rings (the rebuild's rule, concentric): a city's centre and every tile within its radius are city tiles
    /// (Zone.City); the SuburbRing tiles outside that are suburbs (Zone.Suburb); the RuralRing tiles outside the
    /// suburbs keep their natural terrain as Zone.Rural. Calder City, the capital, takes CapitalRadius (4); every other
    /// city rolls CityRadiusMin–CityRadiusMax. A town is a suburb centre with a suburb ring of TownSuburbMin–
    /// TownSuburbMax and the rural ring outside it. Water is never built on; a mountain inside a city is levelled as the
    /// prototype does.
    ///
    /// Where they go (the prototype's <c>mapgen.js</c> rules): Calder City in the southern band (y &gt; 60% of the map,
    /// 5 rows from the bottom, 10 columns from the sides); each other city at least MinCitySpacing from the rest
    /// (falling back to ¾ and ½ of it), 8 columns and 5 rows from the edge, on plains, forest or hills; towns on
    /// buildable land 2 tiles from the edge, TownCitySpacing from every city, with 4 buildable neighbours, each the
    /// best of 8 random candidates by distance from what stands already, then MinTownSpacing from the next.
    /// Counts: CityCount, or the size's cities (WorldSizes.CustomDef); TownCount, or 13 per 64 × 42 of area.
    ///
    /// TODO (board card world.mapgen): names from the prototype's pools and uniqueness forms (mapgen.js lines 38–80,
    /// settlementName / uniqueName ~lines 276–315); the sites inside a settlement (police, auto shop, shops,
    /// satellites: mapgen.js "towns" ~line 397 and URBAN_SITES ~line 100); landmarks and countryside sites.
    /// </summary>
    public static class Settlements
    {
        public static void Place(WorldMap map, MapConfig cfg, Rng rng)
        {
            Cities(map, cfg, rng);
            Towns(map, cfg, rng);
        }

        private static void Cities(WorldMap map, MapConfig cfg, Rng rng)
        {
            var grid = map.Grid;
            int w = grid.Width, h = grid.Height;
            int count = cfg.CityCount > 0 ? cfg.CityCount : WorldSizes.CustomDef(w, h).Cities;
            if (count <= 0) return;

            // Calder City sits in the south.
            var south = new List<Tile>();
            foreach (var t in map.Tiles)
                if (t.Y > h * 0.6 && t.Y < h - 5 && t.X > 10 && t.X < w - 10 && t.Terrain != Terrain.Water && t.Terrain != Terrain.Mountain) south.Add(t);
            if (south.Count == 0) foreach (var t in map.Tiles) if (t.Y > h / 2 && !t.IsWater) south.Add(t);
            if (south.Count == 0) return;
            AddCity(map, cfg, rng.Pick(south), "Calder City", cfg.CapitalRadius, true);

            // The rest, each far from the others (24, then 18, then 12 on the prototype).
            int[] spacings = { cfg.MinCitySpacing, cfg.MinCitySpacing * 3 / 4, cfg.MinCitySpacing / 2 };
            for (int k = 1; k < count; k++)
            {
                foreach (int minD in spacings)
                {
                    var cands = new List<Tile>();
                    foreach (var t in map.Tiles)
                    {
                        if (t.X < 8 || t.X >= w - 8 || t.Y < 5 || t.Y >= h - 5) continue;
                        if (t.SettlementId >= 0 || t.IsWater) continue;
                        if (t.Terrain != Terrain.Plains && t.Terrain != Terrain.Forest && t.Terrain != Terrain.Hills) continue;
                        bool far = true;
                        foreach (var c in map.Cities) if (grid.Distance(t.Id, c.CenterId) < minD) { far = false; break; }
                        if (far) cands.Add(t);
                    }
                    if (cands.Count == 0) continue;
                    int radius = rng.Int(cfg.CityRadiusMin, cfg.CityRadiusMax);
                    AddCity(map, cfg, rng.Pick(cands), $"City {k + 1}", radius, false);
                    break;
                }
            }
        }

        private static void AddCity(WorldMap map, MapConfig cfg, Tile center, string name, int radius, bool capital)
        {
            var grid = map.Grid;
            int suburbOut = radius + cfg.SuburbRing, ruralOut = suburbOut + cfg.RuralRing;
            foreach (int id in grid.Within(center.Id, ruralOut))
            {
                var t = map.Tiles[id];
                if (t.IsWater) continue;
                int d = grid.Distance(center.Id, id);
                if (d <= radius) { t.Terrain = Terrain.City; t.Zone = Zone.City; t.SettlementId = center.Id; }
                else if (d <= suburbOut) { if (t.SettlementId >= 0) continue; t.Terrain = Terrain.Suburb; t.Zone = Zone.Suburb; t.SettlementId = center.Id; }
                else if (t.Zone == Zone.Wild && t.SettlementId < 0) { t.Zone = Zone.Rural; t.SettlementId = center.Id; }
            }
            center.Settlement = SettlementKind.City;
            map.Cities.Add(new Settlement(center.Id, name, SettlementKind.City, radius, capital));
        }

        private static void Towns(WorldMap map, MapConfig cfg, Rng rng)
        {
            var grid = map.Grid;
            int w = grid.Width, h = grid.Height;
            int count = cfg.TownCount > 0 ? cfg.TownCount : WorldSizes.TownsByArea(w, h);
            var nbrs = new List<int>(6);
            bool Open(Tile t) => map.Buildable(t) && !t.IsUrban;
            var cands = new List<Tile>();
            foreach (var t in map.Tiles)
            {
                if (!Open(t) || t.X < 2 || t.X >= w - 2 || t.Y < 2 || t.Y >= h - 2) continue;
                bool far = true;
                foreach (var c in map.Cities) if (grid.Distance(c.CenterId, t.Id) < cfg.TownCitySpacing) { far = false; break; }
                if (!far) continue;
                grid.NeighborsInto(t.Id, nbrs);
                int open = 0;
                foreach (int n in nbrs) if (Open(map.Tiles[n])) open++;
                if (open >= 4) cands.Add(t);
            }
            var refs = new List<int>();
            foreach (var c in map.Cities) refs.Add(c.CenterId);
            for (int i = 0; i < count && cands.Count > 0; i++)
            {
                var t = PickSpread(grid, rng, cands, refs, 8);
                int radius = rng.Int(cfg.TownSuburbMin, cfg.TownSuburbMax);
                AddTown(map, cfg, t, $"Town {i + 1}", radius);
                refs.Add(t.Id);
                cands.RemoveAll(c => grid.Distance(c.Id, t.Id) < cfg.MinTownSpacing);
            }
        }

        private static void AddTown(WorldMap map, MapConfig cfg, Tile center, string name, int radius)
        {
            var grid = map.Grid;
            int ruralOut = radius + cfg.RuralRing;
            foreach (int id in grid.Within(center.Id, ruralOut))
            {
                var t = map.Tiles[id];
                if (t.IsWater || t.Terrain == Terrain.Mountain) continue;
                int d = grid.Distance(center.Id, id);
                if (d <= radius) { if (t.SettlementId >= 0 && id != center.Id) continue; t.Terrain = Terrain.Suburb; t.Zone = Zone.Suburb; t.SettlementId = center.Id; }
                else if (t.Zone == Zone.Wild && t.SettlementId < 0) { t.Zone = Zone.Rural; t.SettlementId = center.Id; }
            }
            center.Settlement = SettlementKind.Town;
            map.Towns.Add(new Settlement(center.Id, name, SettlementKind.Town, radius));
        }

        /// <summary>The best of a few random candidates: the one farthest from refs (prototype pickSpread).</summary>
        private static Tile PickSpread(HexGrid grid, Rng rng, List<Tile> cands, List<int> refs, int samples)
        {
            Tile? best = null;
            int bestD = -1;
            for (int i = 0; i < samples; i++)
            {
                var c = rng.Pick(cands);
                int d = 999;
                foreach (int r in refs) d = Math.Min(d, grid.Distance(r, c.Id));
                if (d > bestD) { best = c; bestD = d; }
            }
            return best!;
        }
    }
}
