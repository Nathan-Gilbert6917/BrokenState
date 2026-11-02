using System;

namespace BrokenState.Sim.World
{
    /// <summary>
    /// Everything the generator reads, as plain data (the Godot MapSettings resource maps onto it). The defaults are the
    /// prototype's numbers where the prototype has them (mapgen.js), and the rebuild's choices where it does not: the
    /// concentric city / suburb / rural rings, the ocean on the south edge and the lakes near the other edges.
    /// </summary>
    public sealed class MapConfig
    {
        /// <summary>The world's seed: the same seed and size build the same map.</summary>
        public int Seed = 12345;
        /// <summary>The grid in hexes. Presets: Small 150 × 75, Normal 250 × 150, Large 300 × 200, Huge 500 × 300; 64 × 42 is the density unit.</summary>
        public int Width = 300;
        public int Height = 150;

        // ---- settlements (Settlements.cs) ----
        /// <summary>How many cities; 0 = by area as the prototype (WorldSizes.CustomDef: 20 on 300 × 150).</summary>
        public int CityCount = 0;
        /// <summary>How many towns; 0 = by area as the prototype (13 per 64 × 42: 218 on 300 × 150).</summary>
        public int TownCount = 0;
        /// <summary>Calder City's radius of city tiles (the prototype's big city: 4).</summary>
        public int CapitalRadius = 4;
        /// <summary>Every other city rolls its radius of city tiles in this range.</summary>
        public int CityRadiusMin = 2;
        public int CityRadiusMax = 3;
        /// <summary>The ring of suburb tiles outside a city's core, in tiles.</summary>
        public int SuburbRing = 2;
        /// <summary>The ring of rural zone (natural terrain kept) outside the suburbs of a city or town, in tiles.</summary>
        public int RuralRing = 2;
        /// <summary>A town's suburb ring radius is rolled in this range (the prototype rolls 1 or 2).</summary>
        public int TownSuburbMin = 1;
        public int TownSuburbMax = 2;
        /// <summary>Cities are at least this far apart (falling back to ¾ and ½ of it when no tile is left: the prototype's 24, 18, 12).</summary>
        public int MinCitySpacing = 24;
        /// <summary>Towns are at least this far apart (prototype 8) and this far from a city's centre (prototype 9).</summary>
        public int MinTownSpacing = 8;
        public int TownCitySpacing = 9;

        // ---- water (LandGen.cs) ----
        /// <summary>How many rivers; 0 = by width as the prototype (3–4 per 64 tiles of width).</summary>
        public int RiverCount = 0;
        /// <summary>The ocean along the south edge reaches up to this many tiles inland where the land is low.</summary>
        public int OceanDepth = 6;
        /// <summary>Sea level: a tile in the coast band is sea when its elevation, pulled down toward the edge, is below it.</summary>
        public double OceanLevel = 0.0;
        /// <summary>Lakes form within this many tiles of the north, east and west edges…</summary>
        public int LakeBand = 15;
        /// <summary>…where the elevation is below this…</summary>
        public double LakeLevel = 0.25;
        /// <summary>…in pools of at least this many tiles.</summary>
        public int LakeMinSize = 3;

        // ---- roads (Roads.cs) ----
        /// <summary>Besides the spanning tree, a road straight to each settlement's two nearest neighbours when the detour is long.</summary>
        public bool LoopRoads = true;
        /// <summary>A loop road only to a neighbour at most this far (prototype 16)…</summary>
        public int LoopMaxDistance = 16;
        /// <summary>…when no road between them is within distance × this + 2 steps (prototype 1.8).</summary>
        public double LoopDetour = 1.8;

        public MapConfig Clone() => (MapConfig)MemberwiseClone();

        public void Validate()
        {
            if (Width < WorldSizes.MinW || Width > WorldSizes.MaxW || Height < WorldSizes.MinH || Height > WorldSizes.MaxH)
                throw new ArgumentOutOfRangeException(nameof(Width), $"The map must be {WorldSizes.MinW}–{WorldSizes.MaxW} × {WorldSizes.MinH}–{WorldSizes.MaxH} hexes, not {Width} × {Height}.");
            if (CityRadiusMin < 1 || CityRadiusMax < CityRadiusMin || CapitalRadius < 1) throw new ArgumentOutOfRangeException(nameof(CityRadiusMin));
            if (TownSuburbMin < 0 || TownSuburbMax < TownSuburbMin) throw new ArgumentOutOfRangeException(nameof(TownSuburbMin));
            if (SuburbRing < 0 || RuralRing < 0 || OceanDepth < 0 || LakeBand < 0 || LakeMinSize < 1) throw new ArgumentOutOfRangeException(nameof(SuburbRing));
        }
    }
}
