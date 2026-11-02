using System;
using System.Collections.Generic;
using BrokenState.Sim.Core;

namespace BrokenState.Sim.World
{
    /// <summary>A world size: the prototype's <c>worldsize.js</c> WORLD_SIZES row (the fields the map generator reads).</summary>
    public sealed class WorldSizeDef
    {
        public readonly string Key;
        public readonly string Label;
        public readonly int W;
        public readonly int H;
        public readonly int Cities;
        public readonly int Military;
        public readonly int OriginHives;
        public readonly int Hotspots;

        public WorldSizeDef(string key, string label, int w, int h, int cities, int military, int originHives, int hotspots)
        {
            Key = key; Label = label; W = w; H = h; Cities = cities; Military = military; OriginHives = originHives; Hotspots = hotspots;
        }
    }

    /// <summary>
    /// The prototype's world sizes (<c>sim/worldsize.js</c>): the presets, the 64 × 42 density unit every count scales
    /// by area from, and CustomDef for any other grid.
    /// </summary>
    public static class WorldSizes
    {
        /// <summary>The original State of Calder, the density unit: a count on it is scaled by AreaScale on every other size.</summary>
        public const int BaseW = 64, BaseH = 42;
        public const int MinW = 32, MaxW = 500, MinH = 24, MaxH = 300;
        /// <summary>Towns on the density map (mapgen.js TOWN_COUNT): 13 per 64 × 42.</summary>
        public const int TownsPerBase = 13;

        public static readonly WorldSizeDef Small = new WorldSizeDef("small", "Small", 150, 75, 6, 3, 5, 4);
        public static readonly WorldSizeDef Normal = new WorldSizeDef("normal", "Normal", 250, 150, 17, 11, 5, 13);
        public static readonly WorldSizeDef Large = new WorldSizeDef("large", "Large", 300, 200, 27, 18, 5, 22);
        public static readonly WorldSizeDef Huge = new WorldSizeDef("huge", "Huge", 500, 300, 65, 45, 5, 55);

        public static readonly IReadOnlyList<WorldSizeDef> Presets = new[] { Small, Normal, Large, Huge };

        public static double AreaScale(int w, int h) => (double)(w * h) / (BaseW * BaseH);

        public static WorldSizeDef? PresetFor(int w, int h)
        {
            foreach (var p in Presets) if (p.W == w && p.H == h) return p;
            return null;
        }

        /// <summary>The counts for any grid (worldsize.js customDef): a preset's own numbers when the grid is one.</summary>
        public static WorldSizeDef CustomDef(int w, int h)
        {
            var preset = PresetFor(w, h);
            if (preset != null) return preset;
            w = Math.Clamp(w, MinW, MaxW);
            h = Math.Clamp(h, MinH, MaxH);
            double a = AreaScale(w, h);
            bool big = a >= 1.2;
            int hotspots = big ? JsMath.RoundToInt(a - 0.5) : 0;
            return new WorldSizeDef("custom", "Custom", w, h,
                Math.Max(2, JsMath.RoundToInt(1.2 + 1.15 * a)), Math.Max(1, JsMath.RoundToInt(a * 0.8)),
                a < 0.8 ? 3 : a < 2 ? 4 : 5, hotspots);
        }

        /// <summary>Towns by area, as the prototype scales them (about 180 on Normal, 218 on 300 × 150).</summary>
        public static int TownsByArea(int w, int h) => JsMath.RoundToInt(TownsPerBase * AreaScale(w, h));
    }
}
