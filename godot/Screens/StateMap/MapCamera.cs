using Godot;

namespace BrokenState.App.Screens;

/// <summary>
/// The State Map's camera: drag with the middle or right mouse button, pan with WASD or the arrows, zoom with the
/// wheel toward the cursor; clamped to the map, the minimum zoom set so the whole map fits (the prototype's
/// ui/render.js: zoom 0.15–2.6, the minimum so the map fits).
/// </summary>
public partial class MapCamera : Camera2D
{
    [Export] public float ZoomMax { get; set; } = 4f;
    [Export] public float ZoomStep { get; set; } = 1.15f;
    [Export] public float PanSpeed { get; set; } = 1200f;

    private float _zoomMin = 0.05f;
    private Rect2 _bounds;
    private bool _dragging;

    /// <summary>Shows the whole map and makes that the furthest the camera zooms out.</summary>
    public void FitTo(Rect2 bounds)
    {
        _bounds = bounds;
        var view = GetViewportRect().Size;
        float fit = Mathf.Min(view.X / bounds.Size.X, view.Y / bounds.Size.Y) * 0.98f;
        _zoomMin = Mathf.Min(fit, 1f);
        Zoom = Vector2.One * fit;
        Position = bounds.GetCenter();
    }

    public override void _UnhandledInput(InputEvent e)
    {
        switch (e)
        {
            case InputEventMouseButton mb:
                if (mb.ButtonIndex == MouseButton.WheelUp && mb.Pressed) ZoomAt(mb.Position, ZoomStep);
                else if (mb.ButtonIndex == MouseButton.WheelDown && mb.Pressed) ZoomAt(mb.Position, 1 / ZoomStep);
                else if (mb.ButtonIndex is MouseButton.Middle or MouseButton.Right) _dragging = mb.Pressed;
                break;
            case InputEventMouseMotion mm when _dragging:
                Position -= mm.Relative / Zoom.X;
                break;
        }
    }

    public override void _Process(double delta)
    {
        var dir = Vector2.Zero;
        if (Input.IsKeyPressed(Key.W) || Input.IsKeyPressed(Key.Up)) dir.Y -= 1;
        if (Input.IsKeyPressed(Key.S) || Input.IsKeyPressed(Key.Down)) dir.Y += 1;
        if (Input.IsKeyPressed(Key.A) || Input.IsKeyPressed(Key.Left)) dir.X -= 1;
        if (Input.IsKeyPressed(Key.D) || Input.IsKeyPressed(Key.Right)) dir.X += 1;
        if (dir != Vector2.Zero) Position += dir.Normalized() * PanSpeed * (float)delta / Zoom.X;
        Clamp();
    }

    /// <summary>Zooms by factor keeping the map point under the cursor where it is.</summary>
    private void ZoomAt(Vector2 screenPos, float factor)
    {
        var view = GetViewportRect().Size;
        float before = Zoom.X;
        float after = Mathf.Clamp(before * factor, _zoomMin, ZoomMax);
        if (Mathf.IsEqualApprox(before, after)) return;
        var offset = screenPos - view / 2;
        var worldUnderCursor = Position + offset / before;
        Zoom = Vector2.One * after;
        Position = worldUnderCursor - offset / after;
        Clamp();
    }

    private void Clamp()
    {
        if (_bounds.Size == Vector2.Zero) return;
        var half = GetViewportRect().Size / (2 * Zoom.X);
        var min = _bounds.Position + half;
        var max = _bounds.End - half;
        Position = new Vector2(
            min.X <= max.X ? Mathf.Clamp(Position.X, min.X, max.X) : _bounds.GetCenter().X,
            min.Y <= max.Y ? Mathf.Clamp(Position.Y, min.Y, max.Y) : _bounds.GetCenter().Y);
    }
}
