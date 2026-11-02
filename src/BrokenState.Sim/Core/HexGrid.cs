using System;
using System.Collections.Generic;

namespace BrokenState.Sim.Core
{
    /// <summary>Cube coordinates of a hex (q + r + s = 0).</summary>
    public readonly struct HexCoord : IEquatable<HexCoord>
    {
        public readonly int Q;
        public readonly int R;
        public int S => -Q - R;

        public HexCoord(int q, int r) { Q = q; R = r; }

        public bool Equals(HexCoord other) => Q == other.Q && R == other.R;
        public override bool Equals(object? obj) => obj is HexCoord h && Equals(h);
        public override int GetHashCode() => unchecked(Q * 397 ^ R);
        public override string ToString() => $"({Q}, {R}, {S})";
    }

    /// <summary>
    /// The State Map's hex grid: pointy-top hexes in "odd-r" offset rows (odd rows shifted half a hex right), tile id =
    /// y × width + x. A port of the prototype's <c>sim/hex.js</c> HexGrid: the same direction tables, the same cube
    /// conversion, so every neighbour list, distance and ring comes out in the same order.
    /// </summary>
    public sealed class HexGrid
    {
        // Prototype EVEN_DIRS / ODD_DIRS: east, north-east, north-west, west, south-west, south-east.
        private static readonly int[,] EvenDirs = { { 1, 0 }, { 0, -1 }, { -1, -1 }, { -1, 0 }, { -1, 1 }, { 0, 1 } };
        private static readonly int[,] OddDirs = { { 1, 0 }, { 1, -1 }, { 0, -1 }, { -1, 0 }, { 0, 1 }, { 1, 1 } };

        public int Width { get; }
        public int Height { get; }
        public int Size { get; }

        public HexGrid(int width, int height)
        {
            if (width <= 0 || height <= 0) throw new ArgumentOutOfRangeException(nameof(width), "A grid needs a positive width and height.");
            Width = width;
            Height = height;
            Size = width * height;
        }

        public int Id(int x, int y) => y * Width + x;
        public int X(int id) => id % Width;
        public int Y(int id) => id / Width;
        public bool InBounds(int x, int y) => x >= 0 && y >= 0 && x < Width && y < Height;

        /// <summary>The neighbours in the prototype's order (E, NE, NW, W, SW, SE), those off the map left out.</summary>
        public List<int> Neighbors(int id)
        {
            var list = new List<int>(6);
            NeighborsInto(id, list);
            return list;
        }

        /// <summary>Neighbors(id) into a list the caller keeps (cleared first): no allocation in hot loops.</summary>
        public void NeighborsInto(int id, List<int> into)
        {
            into.Clear();
            int x = id % Width, y = id / Width;
            bool odd = (y & 1) != 0;
            for (int k = 0; k < 6; k++)
            {
                int nx = x + (odd ? OddDirs[k, 0] : EvenDirs[k, 0]);
                int ny = y + (odd ? OddDirs[k, 1] : EvenDirs[k, 1]);
                if (nx >= 0 && ny >= 0 && nx < Width && ny < Height) into.Add(ny * Width + nx);
            }
        }

        /// <summary>The neighbour in direction k (0 E, 1 NE, 2 NW, 3 W, 4 SW, 5 SE), or -1 off the map.</summary>
        public int Neighbor(int id, int k)
        {
            int x = id % Width, y = id / Width;
            bool odd = (y & 1) != 0;
            int nx = x + (odd ? OddDirs[k, 0] : EvenDirs[k, 0]);
            int ny = y + (odd ? OddDirs[k, 1] : EvenDirs[k, 1]);
            return InBounds(nx, ny) ? ny * Width + nx : -1;
        }

        /// <summary>Offset to cube: q = x − (y − (y &amp; 1)) / 2, r = y.</summary>
        public HexCoord Cube(int id)
        {
            int x = id % Width, y = id / Width;
            return new HexCoord(x - (y - (y & 1)) / 2, y);
        }

        /// <summary>Tile id from cube coordinates, or -1 off the map.</summary>
        public int FromCube(int q, int r)
        {
            int x = q + (r - (r & 1)) / 2;
            return InBounds(x, r) ? Id(x, r) : -1;
        }

        /// <summary>Cube distance, without allocating (the sim asks it hundreds of thousands of times an hour).</summary>
        public int Distance(int a, int b)
        {
            int ay = a / Width, by = b / Width;
            int aq = a - ay * Width - (ay - (ay & 1)) / 2;
            int bq = b - by * Width - (by - (by & 1)) / 2;
            int dq = aq - bq, dr = ay - by;
            return (Math.Abs(dq) + Math.Abs(dr) + Math.Abs(dq + dr)) / 2;
        }

        /// <summary>Every tile within radius of center (the center itself included), row by row, left to right.</summary>
        public List<int> Within(int center, int radius)
        {
            var list = new List<int>();
            WithinInto(center, radius, list);
            return list;
        }

        public void WithinInto(int center, int radius, List<int> into)
        {
            into.Clear();
            int cy = center / Width, cq = center - cy * Width - (cy - (cy & 1)) / 2;
            int y0 = Math.Max(0, cy - radius), y1 = Math.Min(Height - 1, cy + radius);
            for (int y = y0; y <= y1; y++)
            {
                int dr = y - cy, off = (y - (y & 1)) / 2;
                int x0 = Math.Max(0, cq + Math.Max(-radius, -dr - radius) + off);
                int x1 = Math.Min(Width - 1, cq + Math.Min(radius, -dr + radius) + off);
                for (int x = x0; x <= x1; x++) into.Add(y * Width + x);
            }
        }

        /// <summary>The tiles at exactly radius from center (6 × radius on the open map), in Within's order.</summary>
        public List<int> Ring(int center, int radius)
        {
            var list = new List<int>();
            if (radius == 0) { list.Add(center); return list; }
            foreach (int id in Within(center, radius)) if (Distance(center, id) == radius) list.Add(id);
            return list;
        }

        /// <summary>The hexes from a to b inclusive, by cube interpolation and rounding (sight lines).</summary>
        public List<int> Line(int a, int b)
        {
            var list = new List<int>();
            int n = Distance(a, b);
            HexCoord ca = Cube(a), cb = Cube(b);
            if (n == 0) { list.Add(a); return list; }
            for (int i = 0; i <= n; i++)
            {
                double t = (double)i / n;
                // A nudge keeps the lerp off the hex edges, as the usual implementation does.
                double q = ca.Q + (cb.Q - ca.Q) * t + 1e-6;
                double r = ca.R + (cb.R - ca.R) * t + 1e-6;
                var h = RoundCube(q, r);
                int id = FromCube(h.Q, h.R);
                if (id >= 0 && (list.Count == 0 || list[list.Count - 1] != id)) list.Add(id);
            }
            return list;
        }

        /// <summary>The tile one step past b, coming from its neighbour a (a boat crossing a over b); -1 off the map.</summary>
        public int Beyond(int a, int b)
        {
            HexCoord ca = Cube(a), cb = Cube(b);
            return FromCube(2 * cb.Q - ca.Q, 2 * cb.R - ca.R);
        }

        /// <summary>Pixel centre of a tile for a regular pointy-top hex of size s (centre to corner), as the prototype draws it.</summary>
        public (double X, double Y) ToPixel(int id, double s)
        {
            int x = id % Width, y = id / Width;
            return (s * Math.Sqrt(3) * (x + 0.5 * (y & 1)), s * 1.5 * y);
        }

        /// <summary>The tile under a pixel for hex size s, or -1 off the map: fractional axial, rounded in cube space.</summary>
        public int FromPixel(double px, double py, double s)
        {
            double q = ((Math.Sqrt(3) / 3) * px - (1.0 / 3) * py) / s;
            double r = ((2.0 / 3) * py) / s;
            var h = RoundCube(q, r);
            return FromCube(h.Q, h.R);
        }

        public static HexCoord RoundCube(double q, double r)
        {
            double sFrac = -q - r;
            int rq = JsRound(q), rr = JsRound(r), rs = JsRound(sFrac);
            double dq = Math.Abs(rq - q), dr = Math.Abs(rr - r), ds = Math.Abs(rs - sFrac);
            if (dq > dr && dq > ds) rq = -rr - rs;
            else if (dr > ds) rr = -rq - rs;
            return new HexCoord(rq, rr);
        }

        private static int JsRound(double v) => (int)Math.Floor(v + 0.5);
    }
}
