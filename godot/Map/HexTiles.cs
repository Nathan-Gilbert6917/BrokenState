using System;
using Godot;
using BrokenState.Sim.World;

namespace BrokenState.App.Map;

/// <summary>
/// The placeholder tile set: one flat-colour pointy-top hex a tile kind, painted into an atlas at run time from the
/// prototype's terrain colours (sim Terrains), so nothing binary is committed. The TileSet is Godot's hexagon shape
/// with a horizontal offset axis and the Stacked layout: odd rows shifted right, the prototype's odd-r grid.
/// To use real art (the Art school's 48 × 56 hex template) load a PNG atlas in the same column order instead of
/// Paint(): everything else stays.
/// </summary>
public static class HexTiles
{
    /// <summary>The atlas columns, left to right.</summary>
    public enum Kind { Ocean, Lake, River, Plains, Forest, Hills, Mountain, Suburb, City, RuralPlains, RuralForest, RuralHills, RuralMountain }

    public static readonly int KindCount = Enum.GetValues<Kind>().Length;

    public static Color ColorOf(Kind kind) => kind switch
    {
        Kind.Ocean => Color.FromHtml(Terrains.OceanColor),
        Kind.Lake => Color.FromHtml(Terrains.LakeColor),
        Kind.River => Color.FromHtml(Terrains.Of(Terrain.Water).Color),
        Kind.Plains => Color.FromHtml(Terrains.Of(Terrain.Plains).Color),
        Kind.Forest => Color.FromHtml(Terrains.Of(Terrain.Forest).Color),
        Kind.Hills => Color.FromHtml(Terrains.Of(Terrain.Hills).Color),
        Kind.Mountain => Color.FromHtml(Terrains.Of(Terrain.Mountain).Color),
        Kind.Suburb => Color.FromHtml(Terrains.Of(Terrain.Suburb).Color),
        Kind.City => Color.FromHtml(Terrains.Of(Terrain.City).Color),
        Kind.RuralPlains => Rural(ColorOf(Kind.Plains)),
        Kind.RuralForest => Rural(ColorOf(Kind.Forest)),
        Kind.RuralHills => Rural(ColorOf(Kind.Hills)),
        Kind.RuralMountain => Rural(ColorOf(Kind.Mountain)),
        _ => Colors.Magenta,
    };

    /// <summary>A rural tile is its natural terrain, a shade lighter and warmer: farms round a settlement.</summary>
    private static Color Rural(Color c) => c.Lerp(new Color(0.93f, 0.85f, 0.55f), 0.22f);

    public static Kind KindOf(Tile t)
    {
        if (t.Terrain == Terrain.Water)
            return t.Water switch { WaterKind.Ocean => Kind.Ocean, WaterKind.Lake => Kind.Lake, _ => Kind.River };
        bool rural = t.Zone == Zone.Rural;
        return t.Terrain switch
        {
            Terrain.Plains => rural ? Kind.RuralPlains : Kind.Plains,
            Terrain.Forest => rural ? Kind.RuralForest : Kind.Forest,
            Terrain.Hills => rural ? Kind.RuralHills : Kind.Hills,
            Terrain.Mountain => rural ? Kind.RuralMountain : Kind.Mountain,
            Terrain.Suburb => Kind.Suburb,
            Terrain.City => Kind.City,
            _ => Kind.Plains,
        };
    }

    public static Vector2I AtlasCoords(Kind kind) => new((int)kind, 0);

    /// <summary>The whole TileSet: source id 0, one tile a kind at atlas (kind, 0).</summary>
    public static TileSet Build(Vector2I tileSize)
    {
        var source = new TileSetAtlasSource { Texture = Paint(tileSize), TextureRegionSize = tileSize };
        for (int i = 0; i < KindCount; i++) source.CreateTile(new Vector2I(i, 0));
        var tileSet = new TileSet
        {
            TileShape = TileSet.TileShapeEnum.Hexagon,
            TileOffsetAxis = TileSet.TileOffsetAxisEnum.Horizontal,
            TileLayout = TileSet.TileLayoutEnum.Stacked,
            TileSize = tileSize,
        };
        tileSet.AddSource(source, 0);
        return tileSet;
    }

    /// <summary>The atlas: KindCount hexes side by side, each a flat fill with a one-pixel darker rim.</summary>
    public static ImageTexture Paint(Vector2I tileSize)
    {
        int w = tileSize.X, h = tileSize.Y;
        var image = Image.CreateEmpty(w * KindCount, h, false, Image.Format.Rgba8);
        image.Fill(Colors.Transparent);
        for (int k = 0; k < KindCount; k++)
        {
            var fill = ColorOf((Kind)k);
            var rim = fill.Darkened(0.35f);
            int ox = k * w;
            for (int y = 0; y < h; y++)
                for (int x = 0; x < w; x++)
                {
                    if (!InsideHex(x + 0.5, y + 0.5, w, h, 0)) continue;
                    image.SetPixel(ox + x, y, InsideHex(x + 0.5, y + 0.5, w, h, 1.2) ? fill : rim);
                }
        }
        return ImageTexture.CreateFromImage(image);
    }

    /// <summary>Inside the pointy-top hex that fills a w × h tile, shrunk by `inset` pixels.</summary>
    private static bool InsideHex(double px, double py, double w, double h, double inset)
    {
        double dx = Math.Abs(px - w / 2), dy = Math.Abs(py - h / 2);
        double hw = w / 2 - inset, hh = h / 2 - inset * 1.15;
        if (dx > hw) return false;
        // The sloped edges: from the top corner (0, -h/2) to (w/2, -h/4).
        return dy <= hh - dx * (h / 4) / (w / 2);
    }
}
