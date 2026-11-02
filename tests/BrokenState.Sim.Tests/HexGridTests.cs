using System;
using System.Linq;
using BrokenState.Sim.Core;
using Xunit;

namespace BrokenState.Sim.Tests
{
    /// <summary>The grid is the prototype's (values from prototype/src/sim/hex.js on a 10 × 8 grid).</summary>
    public class HexGridTests
    {
        private readonly HexGrid _g = new HexGrid(10, 8);

        [Fact]
        public void NeighboursOnEvenAndOddRowsInThePrototypesOrder()
        {
            Assert.Equal(new[] { 24, 13, 12, 22, 32, 33 }, _g.Neighbors(23)); // even row (y = 2)
            Assert.Equal(new[] { 35, 25, 24, 33, 44, 45 }, _g.Neighbors(34)); // odd row (y = 3)
        }

        [Fact]
        public void NeighboursAtTheEdgesAreClipped()
        {
            Assert.Equal(new[] { 1, 10 }, _g.Neighbors(0));
            Assert.Equal(new[] { 69, 78 }, _g.Neighbors(79));
            Assert.Equal(new[] { 8, 18, 19 }, _g.Neighbors(9));
        }

        [Fact]
        public void DistanceMatchesAndIsSymmetric()
        {
            Assert.Equal(13, _g.Distance(0, 79));
            Assert.Equal(2, _g.Distance(23, 34));
            Assert.Equal(7, _g.Distance(5, 75));
            Assert.Equal(7, _g.Distance(12, 67));
            for (int a = 0; a < _g.Size; a += 7) for (int b = 0; b < _g.Size; b += 5) Assert.Equal(_g.Distance(a, b), _g.Distance(b, a));
        }

        [Fact]
        public void NeighboursAreAtDistanceOne()
        {
            for (int id = 0; id < _g.Size; id++) foreach (int n in _g.Neighbors(id)) Assert.Equal(1, _g.Distance(id, n));
        }

        [Fact]
        public void WithinListsThePrototypesTilesInOrder()
        {
            Assert.Equal(new[] { 13, 14, 15, 23, 24, 25, 26, 32, 33, 34, 35, 36, 43, 44, 45, 46, 53, 54, 55 }, _g.Within(34, 2));
        }

        [Fact]
        public void WithinAndRingSizesOnTheOpenMap()
        {
            var big = new HexGrid(60, 60);
            int c = big.Id(30, 31);
            for (int r = 0; r <= 8; r++)
            {
                Assert.Equal(1 + 3 * r * (r + 1), big.Within(c, r).Count);
                Assert.Equal(r == 0 ? 1 : 6 * r, big.Ring(c, r).Count);
                Assert.All(big.Within(c, r), id => Assert.True(big.Distance(c, id) <= r));
            }
        }

        [Fact]
        public void CubeConversionsRoundTrip()
        {
            Assert.Equal(new HexCoord(2, 2), _g.Cube(23));
            Assert.Equal(-4, _g.Cube(23).S);
            Assert.Equal(new HexCoord(3, 3), _g.Cube(34));
            Assert.Equal(70, _g.FromCube(-3, 7));
            Assert.Equal(-1, _g.FromCube(40, 0));
            for (int id = 0; id < _g.Size; id++) { var h = _g.Cube(id); Assert.Equal(id, _g.FromCube(h.Q, h.R)); }
        }

        [Fact]
        public void BeyondStepsPastTheSecondTile()
        {
            Assert.Equal(46, _g.Beyond(23, 34));
            Assert.Equal(11, _g.Beyond(34, 23));
        }

        [Fact]
        public void PixelConversionsMatchThePrototype()
        {
            var (x, y) = _g.ToPixel(23, 26);
            Assert.Equal(135.09996299037243, x, 9);
            Assert.Equal(78, y, 9);
            (x, y) = _g.ToPixel(34, 26);
            Assert.Equal(202.64994448555862, x, 9);
            Assert.Equal(117, y, 9);
            Assert.Equal(32, _g.FromPixel(100, 100, 26));
            Assert.Equal(0, _g.FromPixel(5, 5, 26));
            Assert.Equal(-1, _g.FromPixel(-30, -30, 26));
            for (int id = 0; id < _g.Size; id++) { var (px, py) = _g.ToPixel(id, 26); Assert.Equal(id, _g.FromPixel(px, py, 26)); }
        }

        [Fact]
        public void LineRunsFromAToBOverDistancePlusOneTiles()
        {
            var line = _g.Line(0, 79);
            Assert.Equal(0, line.First());
            Assert.Equal(79, line.Last());
            Assert.Equal(_g.Distance(0, 79) + 1, line.Count);
            for (int i = 1; i < line.Count; i++) Assert.Equal(1, _g.Distance(line[i - 1], line[i]));
            Assert.Equal(new[] { 23 }, _g.Line(23, 23));
        }

        [Fact]
        public void LayoutOfARegularHexIsThePrototypesToPixel()
        {
            var layout = HexLayout.Regular(26);
            for (int id = 0; id < _g.Size; id++)
            {
                var (ax, ay) = _g.ToPixel(id, 26);
                var (bx, by) = layout.ToPixel(_g, id);
                Assert.Equal(ax, bx, 9);
                Assert.Equal(ay, by, 9);
            }
        }

        [Fact]
        public void GodotTileLayoutPicksTheTileUnderEveryCentreAndNearIt()
        {
            // Godot's 48 × 56 hex tile (slightly taller than regular), centre of (0, 0) at (24, 28).
            var layout = new HexLayout(48, 56, 24, 28);
            Assert.Equal(48 / Math.Sqrt(3), layout.HexSize, 9);
            for (int id = 0; id < _g.Size; id++)
            {
                var (px, py) = layout.ToPixel(_g, id);
                Assert.Equal(id, layout.FromPixel(_g, px, py));
                Assert.Equal(id, layout.FromPixel(_g, px + 10, py - 8));
                Assert.Equal(id, layout.FromPixel(_g, px - 10, py + 8));
            }
            Assert.Equal((24, 28), layout.ToPixel(0, 0));
            Assert.Equal((48 + 24 + 24, 28 + 42), layout.ToPixel(1, 1));
            Assert.Equal(-1, layout.FromPixel(_g, -40, -40));
        }
    }
}
