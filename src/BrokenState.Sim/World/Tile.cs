using System.Collections.Generic;

namespace BrokenState.Sim.World
{
    /// <summary>
    /// One hex of the State Map (the prototype's tile object in <c>mapgen.js landMap</c>: id, x, y, elev, terrain,
    /// road, roadLinks, river, bridge, loc…). Plain data, engine-free; ids are stable integers (y × width + x).
    /// </summary>
    public sealed class Tile
    {
        public readonly int Id;
        public readonly int X;
        public readonly int Y;

        /// <summary>The noise elevation the terrain was decided from; never changed by a later pass (the golden tests read it).</summary>
        public double Elev;
        /// <summary>The noise moisture (forest above 0.56). Kept for the map viewer; the prototype drops it.</summary>
        public double Moist;

        public Terrain Terrain;
        public WaterKind Water;
        public Zone Zone;

        public bool Road;
        public bool Bridge;
        /// <summary>The neighbouring tiles a road leads to from this one (both ends hold the link).</summary>
        public readonly List<int> RoadLinks = new List<int>(2);

        /// <summary>City or Town when this tile is a settlement's centre.</summary>
        public SettlementKind Settlement;
        /// <summary>The centre tile id of the city or town whose footprint (city, suburbs, rural ring) this tile is in; -1 for none.</summary>
        public int SettlementId = -1;

        public Tile(int id, int x, int y) { Id = id; X = x; Y = y; }

        public bool River => Water == WaterKind.River;
        public bool IsWater => Terrain == Terrain.Water;
        public bool IsUrban => Terrains.IsUrban(Terrain);
    }

    /// <summary>A city or town: its centre tile, name, kind and the radius of its core (city tiles, or a town's suburb ring).</summary>
    public sealed class Settlement
    {
        public readonly int CenterId;
        public readonly string Name;
        public readonly SettlementKind Kind;
        public readonly int Radius;
        public readonly bool Capital;

        public Settlement(int centerId, string name, SettlementKind kind, int radius, bool capital = false)
        {
            CenterId = centerId; Name = name; Kind = kind; Radius = radius; Capital = capital;
        }
    }
}
