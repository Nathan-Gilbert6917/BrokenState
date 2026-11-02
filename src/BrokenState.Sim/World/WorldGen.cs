using BrokenState.Sim.Core;

namespace BrokenState.Sim.World
{
    /// <summary>
    /// Builds the State of Calder from a MapConfig, in the prototype's order (<c>mapgen.js generateMap → landMap</c>):
    /// terrain, water, rivers, cities and towns, roads. The dice are a fresh Rng on the config's seed, as the
    /// prototype's world.js makes for its map, so the terrain pass draws the prototype's numbers.
    /// Not here yet (board cards core.mapgen and world.mapgen): names, the sites inside settlements, countryside sites,
    /// landmarks, infection, finds, hives, the town rings' hash dice, ponds.
    /// </summary>
    public static class WorldGen
    {
        public static WorldMap Generate(MapConfig config)
        {
            config.Validate();
            var map = new WorldMap(config.Clone());
            var rng = new Rng(config.Seed);
            LandGen.TerrainPass(map, rng);
            LandGen.Ocean(map, config);
            LandGen.Lakes(map, config);
            LandGen.Rivers(map, config, rng);
            Settlements.Place(map, config, rng);
            Roads.Lay(map, config);
            map.RngState = rng.State;
            return map;
        }

        /// <summary>The terrain pass alone (the golden parity test): a map with elevations and noise terrain, nothing else.</summary>
        public static WorldMap TerrainOnly(MapConfig config)
        {
            config.Validate();
            var map = new WorldMap(config.Clone());
            LandGen.TerrainPass(map, new Rng(config.Seed));
            return map;
        }
    }
}
