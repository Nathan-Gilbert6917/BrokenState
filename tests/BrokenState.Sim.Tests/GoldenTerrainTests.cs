using System;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.Json;
using BrokenState.Sim.Core;
using BrokenState.Sim.World;
using Xunit;

namespace BrokenState.Sim.Tests
{
    /// <summary>
    /// Exact parity of the terrain pass with the prototype. tests/golden/*.json, written by
    /// `node prototype/tools/hexgolden.js`, hold the noise terrain of every tile no later prototype pass overwrote
    /// ("?" where a river, city or suburb did) and a digest (FNV-1a 64 over every tile's elevation rounded to 6
    /// decimals, then the terrain letters); the 64 × 42 file holds the elevations too, for a tile-by-tile report.
    /// </summary>
    public class GoldenTerrainTests
    {
        private static string GoldenDir => Path.Combine(AppContext.BaseDirectory, "golden");

        private static char Letter(Terrain t) => t switch
        {
            Terrain.Water => 'w', Terrain.Plains => 'p', Terrain.Forest => 'f', Terrain.Hills => 'h',
            Terrain.Mountain => 'm', Terrain.Suburb => 's', Terrain.City => 'c', _ => '?',
        };

        private static double Rounded(double e)
        {
            double v = JsMath.Round(e * 1e6) / 1e6;
            return v == 0 ? 0 : v; // JavaScript's toFixed prints -0 as "0.000000"
        }

        /// <summary>The tool's digest: rounded elevations joined by commas, "|", the terrain letters with the golden's "?" kept.</summary>
        private static string Digest(WorldMap map, string goldenTerrain)
        {
            var sb = new StringBuilder();
            for (int i = 0; i < map.Tiles.Length; i++)
            {
                if (i > 0) sb.Append(',');
                sb.Append(Rounded(map.Tiles[i].Elev).ToString("F6", CultureInfo.InvariantCulture));
            }
            sb.Append('|');
            for (int i = 0; i < map.Tiles.Length; i++) sb.Append(goldenTerrain[i] == '?' ? '?' : Letter(map.Tiles[i].Terrain));
            ulong h = 0xcbf29ce484222325UL;
            foreach (char c in sb.ToString()) { h ^= c; h *= 0x100000001b3UL; }
            return h.ToString("x16");
        }

        private static (JsonDocument doc, WorldMap map) Load(string file)
        {
            var doc = JsonDocument.Parse(File.ReadAllText(Path.Combine(GoldenDir, file)));
            var root = doc.RootElement;
            var cfg = new MapConfig { Seed = root.GetProperty("seed").GetInt32(), Width = root.GetProperty("width").GetInt32(), Height = root.GetProperty("height").GetInt32() };
            return (doc, WorldGen.TerrainOnly(cfg));
        }

        [Fact]
        public void TheDensityMap64x42MatchesTileByTile()
        {
            var (doc, map) = Load("terrain-64x42-seed12345.json");
            using (doc)
            {
                var root = doc.RootElement;
                var elev = root.GetProperty("elev");
                string terrain = root.GetProperty("terrain").GetString()!;
                Assert.Equal(map.Tiles.Length, elev.GetArrayLength());
                Assert.Equal(map.Tiles.Length, terrain.Length);
                int known = 0;
                for (int i = 0; i < map.Tiles.Length; i++)
                {
                    Assert.True(Math.Abs(Rounded(map.Tiles[i].Elev) - elev[i].GetDouble()) < 1e-9, $"tile {i}: elev {map.Tiles[i].Elev} vs golden {elev[i].GetDouble()}");
                    if (terrain[i] == '?') continue;
                    Assert.True(terrain[i] == Letter(map.Tiles[i].Terrain), $"tile {i}: terrain {map.Tiles[i].Terrain} vs golden '{terrain[i]}'");
                    known++;
                }
                Assert.True(known > map.Tiles.Length / 2, "most tiles should still carry their noise terrain");
                Assert.Equal(root.GetProperty("digest").GetString(), Digest(map, terrain));
            }
        }

        [Fact]
        public void TheTestMap300x150MatchesByDigest()
        {
            var (doc, map) = Load("terrain-300x150-seed12345.json");
            using (doc)
            {
                var root = doc.RootElement;
                string terrain = root.GetProperty("terrain").GetString()!;
                Assert.Equal(map.Tiles.Length, terrain.Length);
                int mismatches = 0;
                for (int i = 0; i < map.Tiles.Length; i++) if (terrain[i] != '?' && terrain[i] != Letter(map.Tiles[i].Terrain)) mismatches++;
                Assert.True(mismatches == 0, $"{mismatches} tiles differ from the prototype's noise terrain");
                Assert.Equal(root.GetProperty("digest").GetString(), Digest(map, terrain));
            }
        }
    }
}
