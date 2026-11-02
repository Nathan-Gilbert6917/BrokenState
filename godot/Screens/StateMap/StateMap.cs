using System;
using System.Diagnostics;
using System.Globalization;
using System.Linq;
using Godot;
using BrokenState.App.Map;
using BrokenState.Sim.Core;
using BrokenState.Sim.World;

namespace BrokenState.App.Screens;

/// <summary>
/// The State Map scene: generates the State of Calder from its Settings (a MapSettings resource) through the sim's
/// WorldGen and paints it on a hexagonal TileMapLayer; the panel in the corner sets the seed, size and counts and
/// regenerates. Board cards: core.hexgrid, core.mapgen, world.mapgen, ui.statemap (slice scope).
/// </summary>
public partial class StateMap : Node2D
{
    /// <summary>The generation properties; Map/Presets/*.tres are ready-made sets.</summary>
    [Export] public MapSettings? Settings { get; set; }
    /// <summary>The tile texture size: the Art school's hex template is 48 × 56 (a regular hex would be 48 × 55.4).</summary>
    [Export] public Vector2I TileSize { get; set; } = new(48, 56);

    public WorldMap? Map { get; private set; }
    public HexLayout Layout { get; private set; } = new(48, 56, 24, 28);

    private TileMapLayer _tiles = null!;
    private RoadOverlay _roads = null!;
    private MapOverlay _overlay = null!;
    private MapCamera _camera = null!;
    private VBoxContainer _controls = null!;
    private SpinBox _seed = null!, _width = null!, _height = null!, _cities = null!, _towns = null!;
    private OptionButton _preset = null!;
    private Label _stats = null!, _tileInfo = null!;

    public override void _Ready()
    {
        _tiles = GetNode<TileMapLayer>("Tiles");
        _roads = GetNode<RoadOverlay>("Roads");
        _overlay = GetNode<MapOverlay>("Overlay");
        _camera = GetNode<MapCamera>("Camera");
        _controls = GetNode<VBoxContainer>("Ui/Panel/Controls");
        Settings ??= new MapSettings();
        _tiles.TileSet = HexTiles.Build(TileSize);
        Layout = new HexLayout(TileSize.X, TileSize.Y, TileSize.X / 2.0, TileSize.Y / 2.0);
        BuildUi();
        _overlay.HoverChanged += _ => ShowTile(_overlay.Selected >= 0 ? _overlay.Selected : _overlay.Hover);
        _overlay.SelectedChanged += ShowTile;
        Generate();
    }

    /// <summary>Builds the map from Settings (as the panel last set them) and shows it.</summary>
    public void Generate()
    {
        var cfg = Settings!.ToConfig();
        var sw = Stopwatch.StartNew();
        try { Map = WorldGen.Generate(cfg); }
        catch (ArgumentOutOfRangeException ex) { _stats.Text = ex.Message; return; }
        long genMs = sw.ElapsedMilliseconds;
        Paint(Map);
        _roads.Show(Map, Layout);
        _overlay.Show(Map, Layout);
        var (w, h) = Layout.MapSize(Map.Grid);
        _camera.FitTo(new Rect2(0, 0, (float)w, (float)h));
        CheckLayoutAgainstTileMap(Map);
        int roads = Map.Tiles.Count(t => t.Road), rivers = Map.Tiles.Count(t => t.River);
        int ocean = Map.Tiles.Count(t => t.Water == WaterKind.Ocean), lakes = Map.Tiles.Count(t => t.Water == WaterKind.Lake);
        _stats.Text = $"{Map.Grid.Width} × {Map.Grid.Height}, seed {cfg.Seed}: {Map.Cities.Count} cities, {Map.Towns.Count} towns, " +
                      $"{roads} road tiles, {rivers} river, {lakes} lake, {ocean} ocean tiles. Built in {genMs} ms, painted in {sw.ElapsedMilliseconds - genMs} ms.";
        _tileInfo.Text = "Hover a tile; click to select it and see the hex distances around it.";
    }

    private void Paint(WorldMap map)
    {
        _tiles.Clear();
        foreach (var t in map.Tiles) _tiles.SetCell(new Vector2I(t.X, t.Y), 0, HexTiles.AtlasCoords(HexTiles.KindOf(t)));
    }

    /// <summary>
    /// The sim's HexLayout and Godot's TileMapLayer must agree on where every cell's centre is, or the overlays and
    /// picking drift off the tiles. A warning in the Output panel means the TileSet's layout or offset axis is not the
    /// prototype's odd-r (see HexTiles.Build).
    /// </summary>
    private void CheckLayoutAgainstTileMap(WorldMap map)
    {
        foreach (var (x, y) in new[] { (0, 0), (1, 0), (0, 1), (1, 1), (map.Grid.Width - 1, map.Grid.Height - 1), (7, 3) })
        {
            var godot = _tiles.MapToLocal(new Vector2I(x, y));
            var (px, py) = Layout.ToPixel(x, y);
            if (Math.Abs(godot.X - px) > 0.51 || Math.Abs(godot.Y - py) > 0.51)
                GD.PushWarning($"Hex layout mismatch at ({x}, {y}): TileMapLayer centre {godot}, sim layout ({px:F1}, {py:F1}).");
        }
    }

    private void ShowTile(int id)
    {
        if (Map == null || id < 0) { _tileInfo.Text = ""; return; }
        var t = Map.Tiles[id];
        var parts = new System.Collections.Generic.List<string>
        {
            $"Tile {t.Id} ({t.X}, {t.Y})",
            Terrains.Of(t.Terrain).Name + (t.Water != WaterKind.None ? $" ({t.Water})" : ""),
            $"elev {t.Elev.ToString("F3", CultureInfo.InvariantCulture)}, moist {t.Moist.ToString("F2", CultureInfo.InvariantCulture)}",
        };
        if (t.Zone != Zone.Wild) parts.Add(t.Zone.ToString().ToLowerInvariant() + " zone");
        if (t.SettlementId >= 0)
        {
            var s = Map.Settlements().First(x => x.CenterId == t.SettlementId);
            parts.Add(s.Name + (t.Settlement != SettlementKind.None ? " (centre)" : ""));
        }
        if (t.Bridge) parts.Add("bridge"); else if (t.Road) parts.Add($"road ({t.RoadLinks.Count} links)");
        if (_overlay.Selected >= 0 && _overlay.Hover >= 0 && _overlay.Hover != _overlay.Selected)
            parts.Add($"distance from selected: {Map.Grid.Distance(_overlay.Selected, _overlay.Hover)}");
        _tileInfo.Text = string.Join(" · ", parts);
    }

    // ---------- the panel ----------

    private void BuildUi()
    {
        var s = Settings!;
        _controls.AddChild(new Label { Text = "State of Calder", ThemeTypeVariation = "HeaderMedium" });
        _seed = Row("Seed", new SpinBox { MinValue = int.MinValue, MaxValue = int.MaxValue, Step = 1, Value = s.Seed, CustomMinimumSize = new Vector2(140, 0) });
        var random = new Button { Text = "Random seed" };
        random.Pressed += () => { _seed.Value = Random.Shared.Next(1, 1_000_000_000); Apply(); Generate(); };
        _controls.AddChild(random);

        _preset = Row("Preset", new OptionButton());
        _preset.AddItem("Custom");
        foreach (var p in WorldSizes.Presets) _preset.AddItem($"{p.Label} {p.W} × {p.H}");
        _preset.AddItem($"Density unit {WorldSizes.BaseW} × {WorldSizes.BaseH}");
        _preset.ItemSelected += idx =>
        {
            if (idx == 0) return;
            if (idx <= WorldSizes.Presets.Count) { var p = WorldSizes.Presets[(int)idx - 1]; _width.Value = p.W; _height.Value = p.H; }
            else { _width.Value = WorldSizes.BaseW; _height.Value = WorldSizes.BaseH; }
        };
        _width = Row("Width", new SpinBox { MinValue = WorldSizes.MinW, MaxValue = WorldSizes.MaxW, Step = 1, Value = s.Width });
        _height = Row("Height", new SpinBox { MinValue = WorldSizes.MinH, MaxValue = WorldSizes.MaxH, Step = 1, Value = s.Height });
        _width.ValueChanged += _ => SyncPreset();
        _height.ValueChanged += _ => SyncPreset();
        SyncPreset();
        _cities = Row("Cities (0 = by area)", new SpinBox { MinValue = 0, MaxValue = 80, Step = 1, Value = s.CityCount });
        _towns = Row("Towns (0 = by area)", new SpinBox { MinValue = 0, MaxValue = 800, Step = 1, Value = s.TownCount });

        var generate = new Button { Text = "Generate" };
        generate.Pressed += () => { Apply(); Generate(); };
        _controls.AddChild(generate);
        _controls.AddChild(new Label { Text = "Drag: middle or right mouse · wheel: zoom · WASD / arrows: pan · click: select", AutowrapMode = TextServer.AutowrapMode.Word, CustomMinimumSize = new Vector2(300, 0) });
        _stats = new Label { AutowrapMode = TextServer.AutowrapMode.Word, CustomMinimumSize = new Vector2(300, 0) };
        _controls.AddChild(_stats);
        _tileInfo = new Label { AutowrapMode = TextServer.AutowrapMode.Word, CustomMinimumSize = new Vector2(300, 0) };
        _controls.AddChild(_tileInfo);
        _controls.AddChild(new Label { Text = "Rings, water and roads: Settings in the inspector (Map/Presets).", AutowrapMode = TextServer.AutowrapMode.Word, CustomMinimumSize = new Vector2(300, 0), Modulate = new Color(1, 1, 1, 0.6f) });
    }

    private T Row<T>(string label, T control) where T : Control
    {
        var row = new HBoxContainer();
        row.AddChild(new Label { Text = label, CustomMinimumSize = new Vector2(150, 0) });
        control.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
        row.AddChild(control);
        _controls.AddChild(row);
        return control;
    }

    private void SyncPreset()
    {
        int w = (int)_width.Value, h = (int)_height.Value;
        var p = WorldSizes.PresetFor(w, h);
        _preset.Selected = p != null ? WorldSizes.Presets.ToList().IndexOf(p) + 1 : (w == WorldSizes.BaseW && h == WorldSizes.BaseH ? WorldSizes.Presets.Count + 1 : 0);
    }

    /// <summary>The panel's values into Settings (the resource in memory; the .tres file is not written).</summary>
    private void Apply()
    {
        var s = Settings!;
        s.Seed = (int)_seed.Value;
        s.Width = (int)_width.Value;
        s.Height = (int)_height.Value;
        s.CityCount = (int)_cities.Value;
        s.TownCount = (int)_towns.Value;
    }
}
