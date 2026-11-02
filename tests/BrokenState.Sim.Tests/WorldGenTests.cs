using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using BrokenState.Sim.World;
using Xunit;
using Xunit.Abstractions;

namespace BrokenState.Sim.Tests
{
    /// <summary>The whole generator on the default 300 × 150 test map and the 64 × 42 density unit.</summary>
    public class WorldGenTests
    {
        private readonly ITestOutputHelper _out;
        public WorldGenTests(ITestOutputHelper output) { _out = output; }

        private static readonly Lazy<WorldMap> Default = new Lazy<WorldMap>(() => WorldGen.Generate(new MapConfig()));

        [Fact]
        public void TheDefaultIs300x150WithThePrototypesCounts()
        {
            var sw = Stopwatch.StartNew();
            var map = Default.Value;
            _out.WriteLine($"300 x 150 built in {sw.ElapsedMilliseconds} ms (first call) with {map.Cities.Count} cities and {map.Towns.Count} towns");
            Assert.Equal(300, map.Grid.Width);
            Assert.Equal(150, map.Grid.Height);
            Assert.Equal(20, map.Cities.Count);             // worldsize.js customDef(300, 150).cities
            Assert.Equal(218, WorldSizes.TownsByArea(300, 150));
            Assert.InRange(map.Towns.Count, 150, 218);      // every town the land has room for
            Assert.Equal("Calder City", map.Capital!.Name);
            Assert.True(map.Capital.Capital);
        }

        [Fact]
        public void CalderCityIsInTheSouthWithRadiusFourAndItsRings()
        {
            var map = Default.Value;
            var c = map.Capital!;
            var centre = map.Tiles[c.CenterId];
            Assert.True(centre.Y > map.Grid.Height * 0.6);
            Assert.Equal(4, c.Radius);
            AssertRings(map, c, 4, map.Config.SuburbRing, map.Config.RuralRing);
        }

        [Fact]
        public void EveryOtherCityRollsRadiusTwoOrThreeAndKeepsItsDistance()
        {
            var map = Default.Value;
            foreach (var c in map.Cities.Skip(1))
            {
                Assert.InRange(c.Radius, 2, 3);
                AssertRings(map, c, c.Radius, map.Config.SuburbRing, map.Config.RuralRing);
                foreach (var o in map.Cities) if (o != c) Assert.True(map.Grid.Distance(c.CenterId, o.CenterId) >= 12);
            }
        }

        [Fact]
        public void TownsAreSuburbCentresWithRingsAndSpacing()
        {
            var map = Default.Value;
            foreach (var t in map.Towns)
            {
                var centre = map.Tiles[t.CenterId];
                Assert.Equal(SettlementKind.Town, centre.Settlement);
                Assert.Equal(Terrain.Suburb, centre.Terrain);
                Assert.InRange(t.Radius, 1, 2);
                foreach (int id in map.Grid.Within(t.CenterId, t.Radius))
                {
                    var tile = map.Tiles[id];
                    if (tile.IsWater || tile.Terrain == Terrain.Mountain || tile.SettlementId != t.CenterId) continue;
                    Assert.Equal(Terrain.Suburb, tile.Terrain);
                }
                foreach (var o in map.Towns) if (o != t) Assert.True(map.Grid.Distance(t.CenterId, o.CenterId) >= 8);
                foreach (var c in map.Cities) Assert.True(map.Grid.Distance(t.CenterId, c.CenterId) >= 9);
            }
        }

        [Fact]
        public void RuralTilesKeepTheirNaturalTerrain()
        {
            var map = Default.Value;
            int rural = 0;
            foreach (var t in map.Tiles)
            {
                if (t.Zone != Zone.Rural) continue;
                rural++;
                Assert.True(t.SettlementId >= 0);
                Assert.NotEqual(Terrain.City, t.Terrain);
                Assert.NotEqual(Terrain.Suburb, t.Terrain);
            }
            Assert.True(rural > 0);
        }

        [Fact]
        public void TheOceanLiesAlongTheSouthEdgeAndLakesNearTheOthers()
        {
            var map = Default.Value;
            int h = map.Grid.Height, w = map.Grid.Width;
            int southOcean = 0;
            for (int x = 0; x < w; x++) if (map.At(x, h - 1).Water == WaterKind.Ocean) southOcean++;
            Assert.True(southOcean > w / 2, $"only {southOcean} of {w} south-edge tiles are ocean");
            foreach (var t in map.Tiles)
            {
                if (t.Water == WaterKind.Ocean) Assert.True(h - 1 - t.Y < map.Config.OceanDepth);
                if (t.Water == WaterKind.Lake) Assert.True(t.Y < map.Config.LakeBand || t.X < map.Config.LakeBand || t.X >= w - map.Config.LakeBand || h - 1 - t.Y < map.Config.OceanDepth);
                if (t.Water != WaterKind.None) Assert.Equal(Terrain.Water, t.Terrain);
            }
            _out.WriteLine($"ocean {map.Tiles.Count(t => t.Water == WaterKind.Ocean)}, lake {map.Tiles.Count(t => t.Water == WaterKind.Lake)}, river {map.Tiles.Count(t => t.River)} tiles");
        }

        [Fact]
        public void RiversRunFromTheNorthernHighlandsDownhillOnTheMap()
        {
            var map = Default.Value;
            var rivers = map.Tiles.Where(t => t.River).ToList();
            Assert.True(rivers.Count > 100);
            Assert.Contains(rivers, t => t.Y < map.Grid.Height * 0.3);
            // Every river tile has a river, sea or lake neighbour, or sits on the south edge: rivers do not break.
            foreach (var t in rivers)
            {
                bool joined = t.Y == map.Grid.Height - 1 || map.Grid.Neighbors(t.Id).Any(n => map.Tiles[n].IsWater);
                Assert.True(joined, $"river tile {t.Id} stands alone");
            }
        }

        [Fact]
        public void EverySettlementIsOnTheRoadNetwork()
        {
            var map = Default.Value;
            var centres = map.Settlements().Select(s => s.CenterId).ToList();
            var seen = new HashSet<int> { centres[0] };
            var queue = new Queue<int>(); queue.Enqueue(centres[0]);
            while (queue.Count > 0)
                foreach (int n in map.Tiles[queue.Dequeue()].RoadLinks) if (seen.Add(n)) queue.Enqueue(n);
            foreach (int c in centres) Assert.Contains(c, seen);
            foreach (var t in map.Tiles)
            {
                if (t.Road) Assert.NotEqual(WaterKind.Ocean, t.Water);
                if (t.Road && t.IsWater) Assert.True(t.Bridge);
                foreach (int n in t.RoadLinks) { Assert.Equal(1, map.Grid.Distance(t.Id, n)); Assert.Contains(t.Id, map.Tiles[n].RoadLinks); }
            }
            _out.WriteLine($"{map.Tiles.Count(t => t.Road)} road tiles, {map.Tiles.Count(t => t.Bridge)} bridges");
        }

        [Fact]
        public void TheSameSeedBuildsTheSameMapAndAnotherSeedAnother()
        {
            var a = WorldGen.Generate(new MapConfig { Width = 64, Height = 42, Seed = 7 });
            var b = WorldGen.Generate(new MapConfig { Width = 64, Height = 42, Seed = 7 });
            var c = WorldGen.Generate(new MapConfig { Width = 64, Height = 42, Seed = 8 });
            Assert.Equal(Fingerprint(a), Fingerprint(b));
            Assert.NotEqual(Fingerprint(a), Fingerprint(c));
            Assert.Equal(a.RngState, b.RngState);
            Assert.Equal(2, a.Cities.Count); // the density map draws Calder City and the second city
            Assert.InRange(a.Towns.Count, 5, 13);
        }

        [Fact]
        public void CountsCanBeSetByHand()
        {
            var map = WorldGen.Generate(new MapConfig { Width = 150, Height = 75, Seed = 3, CityCount = 3, TownCount = 10 });
            Assert.Equal(3, map.Cities.Count);
            Assert.Equal(10, map.Towns.Count);
        }

        [Fact]
        public void ABadSizeIsRefused()
        {
            Assert.Throws<ArgumentOutOfRangeException>(() => WorldGen.Generate(new MapConfig { Width = 10, Height = 10 }));
        }

        private static void AssertRings(WorldMap map, Settlement c, int radius, int suburb, int rural)
        {
            foreach (int id in map.Grid.Within(c.CenterId, radius + suburb + rural))
            {
                var t = map.Tiles[id];
                if (t.IsWater) continue;
                int d = map.Grid.Distance(c.CenterId, id);
                if (d <= radius) { Assert.Equal(Terrain.City, t.Terrain); Assert.Equal(Zone.City, t.Zone); Assert.Equal(c.CenterId, t.SettlementId); }
                else if (t.SettlementId != c.CenterId) continue; // another settlement's ground
                else if (d <= radius + suburb) { Assert.Equal(Terrain.Suburb, t.Terrain); Assert.Equal(Zone.Suburb, t.Zone); }
                else Assert.Equal(Zone.Rural, t.Zone);
            }
        }

        private static string Fingerprint(WorldMap map) =>
            string.Concat(map.Tiles.Select(t => (char)('A' + (int)t.Terrain + 8 * (int)t.Zone + (t.Road ? 40 : 0)))) + "|" + string.Join(",", map.Settlements().Select(s => s.CenterId));
    }
}
