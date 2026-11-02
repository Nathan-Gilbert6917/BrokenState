using Godot;
using BrokenState.Sim.World;

namespace BrokenState.App.Map;

/// <summary>
/// The StateMap scene's generation properties as an inspector-editable resource (board card world.mapgen: "world
/// sizes as data"). Map/Presets/*.tres are saved sets; the scene's Settings export picks one. ToConfig() hands the
/// engine-free sim its MapConfig: the sim never sees a Godot type.
/// </summary>
[GlobalClass]
public partial class MapSettings : Resource
{
    [ExportGroup("World")]
    [Export] public int Seed { get; set; } = 12345;
    [Export(PropertyHint.Range, "32,500")] public int Width { get; set; } = 300;
    [Export(PropertyHint.Range, "24,300")] public int Height { get; set; } = 150;

    [ExportGroup("Settlements")]
    /// <summary>0 = by area as the prototype (20 on 300 × 150).</summary>
    [Export(PropertyHint.Range, "0,80")] public int CityCount { get; set; } = 0;
    /// <summary>0 = by area as the prototype (218 on 300 × 150).</summary>
    [Export(PropertyHint.Range, "0,800")] public int TownCount { get; set; } = 0;
    [Export(PropertyHint.Range, "1,4")] public int CapitalRadius { get; set; } = 4;
    [Export(PropertyHint.Range, "1,4")] public int CityRadiusMin { get; set; } = 2;
    [Export(PropertyHint.Range, "1,4")] public int CityRadiusMax { get; set; } = 3;
    [Export(PropertyHint.Range, "0,4")] public int SuburbRing { get; set; } = 2;
    [Export(PropertyHint.Range, "0,4")] public int RuralRing { get; set; } = 2;
    [Export(PropertyHint.Range, "0,3")] public int TownSuburbMin { get; set; } = 1;
    [Export(PropertyHint.Range, "0,3")] public int TownSuburbMax { get; set; } = 2;
    [Export(PropertyHint.Range, "4,60")] public int MinCitySpacing { get; set; } = 24;
    [Export(PropertyHint.Range, "2,30")] public int MinTownSpacing { get; set; } = 8;
    [Export(PropertyHint.Range, "2,30")] public int TownCitySpacing { get; set; } = 9;

    [ExportGroup("Water")]
    /// <summary>0 = by width as the prototype (3–4 per 64 tiles of width).</summary>
    [Export(PropertyHint.Range, "0,60")] public int RiverCount { get; set; } = 0;
    [Export(PropertyHint.Range, "0,30")] public int OceanDepth { get; set; } = 6;
    [Export(PropertyHint.Range, "-0.5,0.5,0.01")] public double OceanLevel { get; set; } = 0.0;
    [Export(PropertyHint.Range, "0,60")] public int LakeBand { get; set; } = 15;
    [Export(PropertyHint.Range, "-0.2,0.8,0.01")] public double LakeLevel { get; set; } = 0.25;
    [Export(PropertyHint.Range, "1,20")] public int LakeMinSize { get; set; } = 3;

    [ExportGroup("Roads")]
    [Export] public bool LoopRoads { get; set; } = true;
    [Export(PropertyHint.Range, "4,40")] public int LoopMaxDistance { get; set; } = 16;
    [Export(PropertyHint.Range, "1.0,4.0,0.1")] public double LoopDetour { get; set; } = 1.8;

    public MapConfig ToConfig() => new()
    {
        Seed = Seed, Width = Width, Height = Height,
        CityCount = CityCount, TownCount = TownCount, CapitalRadius = CapitalRadius,
        CityRadiusMin = CityRadiusMin, CityRadiusMax = CityRadiusMax, SuburbRing = SuburbRing, RuralRing = RuralRing,
        TownSuburbMin = TownSuburbMin, TownSuburbMax = TownSuburbMax,
        MinCitySpacing = MinCitySpacing, MinTownSpacing = MinTownSpacing, TownCitySpacing = TownCitySpacing,
        RiverCount = RiverCount, OceanDepth = OceanDepth, OceanLevel = OceanLevel,
        LakeBand = LakeBand, LakeLevel = LakeLevel, LakeMinSize = LakeMinSize,
        LoopRoads = LoopRoads, LoopMaxDistance = LoopMaxDistance, LoopDetour = LoopDetour,
    };
}
