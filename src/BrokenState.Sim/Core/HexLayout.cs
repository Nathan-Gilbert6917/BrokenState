using System;

namespace BrokenState.Sim.Core
{
    /// <summary>
    /// Pixel layout of the grid for a tile texture of TileWidth × TileHeight pixels: the layout Godot's TileMapLayer
    /// uses for a hexagon tile set with a horizontal offset axis and the Stacked layout (odd rows shifted right), which
    /// is the prototype's odd-r layout. Columns are TileWidth apart, rows 0.75 × TileHeight apart, and the centre of
    /// tile (0, 0) sits at Origin (TileWidth / 2, TileHeight / 2 for Godot's map_to_local).
    /// A regular hex has TileHeight = TileWidth × 2 / √3; the prototype's HexGrid.ToPixel(id, s) is this layout with
    /// TileWidth = √3 s, TileHeight = 2 s and Origin (0, 0). Picking scales a pixel back to that regular hex and rounds
    /// in cube space, so a slightly squashed tile (48 × 56 instead of 48 × 55.4) still picks the right cell.
    /// </summary>
    public sealed class HexLayout
    {
        public double TileWidth { get; }
        public double TileHeight { get; }
        public double OriginX { get; }
        public double OriginY { get; }

        public HexLayout(double tileWidth, double tileHeight, double originX = 0, double originY = 0)
        {
            if (tileWidth <= 0 || tileHeight <= 0) throw new ArgumentOutOfRangeException(nameof(tileWidth));
            TileWidth = tileWidth;
            TileHeight = tileHeight;
            OriginX = originX;
            OriginY = originY;
        }

        /// <summary>The layout of a regular hex of size s (centre to corner), origin at the first tile's centre.</summary>
        public static HexLayout Regular(double s) => new HexLayout(Math.Sqrt(3) * s, 2 * s);

        /// <summary>Hex size (centre to corner) of the regular hex this layout's width stands for.</summary>
        public double HexSize => TileWidth / Math.Sqrt(3);

        public (double X, double Y) ToPixel(HexGrid grid, int id) => ToPixel(grid.X(id), grid.Y(id));

        public (double X, double Y) ToPixel(int x, int y) =>
            (OriginX + TileWidth * (x + 0.5 * (y & 1)), OriginY + 0.75 * TileHeight * y);

        /// <summary>The tile under a pixel, or -1 off the map.</summary>
        public int FromPixel(HexGrid grid, double px, double py)
        {
            double s = HexSize;
            double rx = px - OriginX;
            double ry = (py - OriginY) * (2 * s / TileHeight); // squash the tile height back to a regular hex's
            return grid.FromPixel(rx, ry, s);
        }

        /// <summary>The six corners of a tile's hex, clockwise from the top, for outlines.</summary>
        public (double X, double Y)[] Corners(int x, int y)
        {
            var (cx, cy) = ToPixel(x, y);
            double w = TileWidth / 2, h = TileHeight / 2;
            return new[]
            {
                (cx, cy - h), (cx + w, cy - h / 2), (cx + w, cy + h / 2),
                (cx, cy + h), (cx - w, cy + h / 2), (cx - w, cy - h / 2),
            };
        }

        /// <summary>The whole map's pixel size.</summary>
        public (double W, double H) MapSize(HexGrid grid) =>
            (TileWidth * (grid.Width + 0.5), 0.75 * TileHeight * (grid.Height - 1) + TileHeight);
    }
}
