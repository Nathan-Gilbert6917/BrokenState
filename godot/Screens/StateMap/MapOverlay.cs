using System;
using Godot;
using BrokenState.Sim.Core;
using BrokenState.Sim.World;

namespace BrokenState.App.Screens;

/// <summary>
/// What sits on top of the tiles: the settlement markers, the hovered and selected hex outlines, and the distance
/// overlay (every tile within DistanceRadius of the selected one labelled with its hex distance: the check that the
/// grid's maths matches the prototype's, board card core.hexgrid). Picking goes through the sim's HexLayout, never
/// the TileMapLayer, so what the player clicks is what the sim calls that tile.
/// </summary>
public partial class MapOverlay : Node2D
{
    [Export] public int DistanceRadius { get; set; } = 6;
    [Export] public Color HoverColor { get; set; } = new(1f, 1f, 1f, 0.9f);
    [Export] public Color SelectColor { get; set; } = new(1f, 0.85f, 0.2f);
    [Export] public Color CityColor { get; set; } = new(0.95f, 0.3f, 0.25f);
    [Export] public Color TownColor { get; set; } = new(0.98f, 0.75f, 0.3f);

    /// <summary>The tile under the cursor (-1 off the map) and the clicked tile.</summary>
    public int Hover { get; private set; } = -1;
    public int Selected { get; private set; } = -1;

    public event Action<int>? HoverChanged;
    public event Action<int>? SelectedChanged;

    private WorldMap? _map;
    private HexLayout? _layout;
    private Font _font = ThemeDB.FallbackFont;

    public void Show(WorldMap map, HexLayout layout)
    {
        _map = map;
        _layout = layout;
        Hover = -1;
        Selected = -1;
        QueueRedraw();
    }

    public override void _Process(double delta)
    {
        if (_map == null || _layout == null) return;
        var m = GetGlobalMousePosition();
        int id = _layout.FromPixel(_map.Grid, m.X, m.Y);
        if (id == Hover) return;
        Hover = id;
        HoverChanged?.Invoke(id);
        QueueRedraw();
    }

    public override void _UnhandledInput(InputEvent e)
    {
        if (e is InputEventMouseButton { ButtonIndex: MouseButton.Left, Pressed: true } && _map != null)
        {
            Selected = Hover;
            SelectedChanged?.Invoke(Selected);
            QueueRedraw();
            GetViewport().SetInputAsHandled();
        }
    }

    public override void _Draw()
    {
        if (_map == null || _layout == null) return;
        float r = (float)(_layout.TileWidth * 0.18);
        foreach (var s in _map.Settlements())
        {
            var c = Centre(s.CenterId);
            bool city = s.Kind == SettlementKind.City;
            DrawCircle(c, city ? r * 1.6f : r, city ? CityColor : TownColor);
            DrawCircle(c, city ? r * 1.6f : r, Colors.Black, false, 1.5f);
        }
        if (Selected >= 0)
        {
            foreach (int id in _map.Grid.Within(Selected, DistanceRadius))
            {
                if (id == Selected) continue;
                int d = _map.Grid.Distance(Selected, id);
                var c = Centre(id);
                string label = d.ToString();
                var size = _font.GetStringSize(label, HorizontalAlignment.Center, -1, 16);
                DrawString(_font, new Vector2(c.X - size.X / 2, c.Y + size.Y / 3), label, HorizontalAlignment.Left, -1, 16, new Color(1, 1, 1, 0.85f));
            }
            DrawPolyline(Outline(Selected), SelectColor, 3f);
        }
        if (Hover >= 0 && Hover != Selected) DrawPolyline(Outline(Hover), HoverColor, 2f);
    }

    private Vector2 Centre(int id)
    {
        var (x, y) = _layout!.ToPixel(_map!.Grid, id);
        return new Vector2((float)x, (float)y);
    }

    private Vector2[] Outline(int id)
    {
        var corners = _layout!.Corners(_map!.Grid.X(id), _map.Grid.Y(id));
        var pts = new Vector2[7];
        for (int i = 0; i < 6; i++) pts[i] = new Vector2((float)corners[i].X, (float)corners[i].Y);
        pts[6] = pts[0];
        return pts;
    }
}
