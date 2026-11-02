using Godot;
using BrokenState.Sim.Core;
using BrokenState.Sim.World;

namespace BrokenState.App.Screens;

/// <summary>
/// The roads, drawn as lines between the centres of linked tiles (the prototype's render.js draws them the same
/// way: ROAD_REACH, "a road runs to the next tile's center"); bridges in a paler colour. Redrawn only on a new map.
/// TODO (board card ui.statemap): a road TileMapLayer with spoke tiles once there is art for them.
/// </summary>
public partial class RoadOverlay : Node2D
{
    [Export] public Color RoadColor { get; set; } = new(0.26f, 0.22f, 0.18f);
    [Export] public Color BridgeColor { get; set; } = new(0.72f, 0.66f, 0.52f);
    [Export] public float RoadWidth { get; set; } = 5f;

    private WorldMap? _map;
    private HexLayout? _layout;

    public void Show(WorldMap map, HexLayout layout)
    {
        _map = map;
        _layout = layout;
        QueueRedraw();
    }

    public override void _Draw()
    {
        if (_map == null || _layout == null) return;
        foreach (var t in _map.Tiles)
        {
            if (!t.Road) continue;
            var (ax, ay) = _layout.ToPixel(t.X, t.Y);
            var a = new Vector2((float)ax, (float)ay);
            foreach (int n in t.RoadLinks)
            {
                if (n < t.Id) continue; // each link once
                var o = _map.Tiles[n];
                var (bx, by) = _layout.ToPixel(o.X, o.Y);
                var b = new Vector2((float)bx, (float)by);
                bool bridge = t.Bridge || o.Bridge;
                DrawLine(a, b, bridge ? BridgeColor : RoadColor, bridge ? RoadWidth * 1.4f : RoadWidth);
            }
            if (t.RoadLinks.Count == 0) DrawCircle(a, RoadWidth, RoadColor);
        }
    }
}
