using System.Collections.Generic;

namespace BrokenState.Sim.World
{
    /// <summary>The prototype's seven terrain types (<c>sim/data.js</c> TERRAIN), in its order.</summary>
    public enum Terrain { Water, Plains, Forest, Hills, Mountain, Suburb, City }

    /// <summary>What a Water tile is. The prototype has rivers only (tile.river); lakes and the ocean are the rebuild's.</summary>
    public enum WaterKind { None, River, Lake, Ocean }

    /// <summary>
    /// The settlement zoning laid over the terrain (the prototype keeps a zone on a site, <c>loc.zone</c>: urban, town,
    /// rural, special). City and Suburb tiles also carry that terrain; a Rural tile keeps its natural terrain and is the
    /// ring of farms and countryside round a city or town; Wild is everything else.
    /// </summary>
    public enum Zone { Wild, Rural, Suburb, City }

    public enum SettlementKind { None, City, Town }

    /// <summary>Per-terrain facts: the prototype's name, map colour, walk and vehicle hours a tile and traffic.</summary>
    public sealed class TerrainInfo
    {
        public readonly Terrain Terrain;
        public readonly string Name;
        /// <summary>The State Map colour as "#rrggbb" (prototype data.js), the placeholder tile's fill.</summary>
        public readonly string Color;
        public readonly double Walk;
        public readonly double Vehicle;
        public readonly double Traffic;

        public TerrainInfo(Terrain terrain, string name, string color, double walk, double vehicle, double traffic)
        {
            Terrain = terrain; Name = name; Color = color; Walk = walk; Vehicle = vehicle; Traffic = traffic;
        }

        public bool Passable => !double.IsInfinity(Walk);
    }

    public static class Terrains
    {
        private const double Inf = double.PositiveInfinity;

        public static readonly IReadOnlyDictionary<Terrain, TerrainInfo> Info = new Dictionary<Terrain, TerrainInfo>
        {
            { Terrain.Water, new TerrainInfo(Terrain.Water, "Water", "#2c4f6b", Inf, Inf, 0) },
            { Terrain.Plains, new TerrainInfo(Terrain.Plains, "Farmland", "#7d8a4f", 1, 0.5, 0.05) },
            { Terrain.Forest, new TerrainInfo(Terrain.Forest, "Forest", "#3f5e3a", 1, 0.5, 0.02) },
            { Terrain.Hills, new TerrainInfo(Terrain.Hills, "Hills", "#7a7152", 1, 0.5, 0.02) },
            { Terrain.Mountain, new TerrainInfo(Terrain.Mountain, "Mountains", "#6d6a66", 1, Inf, 0.01) },
            { Terrain.Suburb, new TerrainInfo(Terrain.Suburb, "Suburbs", "#8a8378", 1, 0.5, 0.12) },
            { Terrain.City, new TerrainInfo(Terrain.City, "City", "#5f5a57", 1, 0.5, 0.2) },
        };

        /// <summary>Colours for the water kinds the prototype does not have (the river keeps the prototype's Water colour).</summary>
        public const string OceanColor = "#1f3b55";
        public const string LakeColor = "#2f5f80";

        /// <summary>Road travel: hours a tile on foot and by car (prototype data.js ROAD_COST).</summary>
        public const double RoadWalk = 1, RoadVehicle = 0.25;

        public static TerrainInfo Of(Terrain t) => Info[t];
        public static bool IsUrban(Terrain t) => t == Terrain.City || t == Terrain.Suburb;
        public static bool IsWoods(Terrain t) => t == Terrain.Forest || t == Terrain.Hills;
    }
}
