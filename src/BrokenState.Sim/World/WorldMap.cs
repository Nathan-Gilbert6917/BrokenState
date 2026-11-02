using System.Collections.Generic;
using BrokenState.Sim.Core;

namespace BrokenState.Sim.World
{
    /// <summary>A generated State of Calder: the grid, every tile, the settlements and the config that built it.</summary>
    public sealed class WorldMap
    {
        public readonly MapConfig Config;
        public readonly HexGrid Grid;
        public readonly Tile[] Tiles;
        public readonly List<Settlement> Cities = new List<Settlement>();
        public readonly List<Settlement> Towns = new List<Settlement>();
        /// <summary>The dice after the land was built (the prototype caches this with the land).</summary>
        public uint RngState;

        public WorldMap(MapConfig config)
        {
            Config = config;
            Grid = new HexGrid(config.Width, config.Height);
            Tiles = new Tile[Grid.Size];
            for (int id = 0; id < Grid.Size; id++) Tiles[id] = new Tile(id, Grid.X(id), Grid.Y(id));
        }

        public Tile this[int id] => Tiles[id];
        public Tile At(int x, int y) => Tiles[Grid.Id(x, y)];

        /// <summary>Calder City, the capital (the first city).</summary>
        public Settlement? Capital => Cities.Count > 0 ? Cities[0] : null;

        public IEnumerable<Settlement> Settlements()
        {
            foreach (var c in Cities) yield return c;
            foreach (var t in Towns) yield return t;
        }

        /// <summary>A tile a settlement may be put on: land, no river, no mountain, no settlement's footprint yet.</summary>
        public bool Buildable(Tile t) => t.Terrain != Terrain.Water && t.Terrain != Terrain.Mountain && t.SettlementId < 0;
    }
}
