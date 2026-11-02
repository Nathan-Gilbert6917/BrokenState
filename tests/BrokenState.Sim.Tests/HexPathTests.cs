using BrokenState.Sim.Core;
using Xunit;

namespace BrokenState.Sim.Tests
{
    /// <summary>A* is the prototype's findPath (values from prototype/src/sim/hex.js on a 10 × 8 grid).</summary>
    public class HexPathTests
    {
        private readonly HexGrid _g = new HexGrid(10, 8);

        [Fact]
        public void UniformCostEqualsDistance()
        {
            var res = HexPath.Find(_g, 0, 79, (a, b) => 1);
            Assert.NotNull(res);
            Assert.Equal(13, res!.Cost);
            Assert.Equal(14, res.Path.Count);
            Assert.Equal(0, res.Path[0]);
            Assert.Equal(79, res.Path[^1]);
        }

        [Fact]
        public void AWallWithAGapGivesThePrototypesPath()
        {
            // Column 5 is blocked except on the bottom row.
            var res = HexPath.Find(_g, 0, 9, (a, b) => b % 10 == 5 && b < 70 ? double.PositiveInfinity : 1);
            Assert.NotNull(res);
            Assert.Equal(16, res!.Cost);
            Assert.Equal(new[] { 0, 1, 11, 22, 32, 43, 53, 64, 74, 75, 66, 56, 47, 37, 28, 18, 9 }, res.Path);
        }

        [Fact]
        public void MaxCostGivesUp()
        {
            Assert.Null(HexPath.Find(_g, 0, 79, (a, b) => 1, 5));
            Assert.NotNull(HexPath.Find(_g, 0, 79, (a, b) => 1, 13));
        }

        [Fact]
        public void StartIsGoal()
        {
            var res = HexPath.Find(_g, 7, 7, (a, b) => 1);
            Assert.Equal(0, res!.Cost);
            Assert.Equal(new[] { 7 }, res.Path);
        }

        [Fact]
        public void SearchesNestedInACostFunctionKeepTheirOwnScratch()
        {
            var inner = HexPath.Find(_g, 0, 9, (a, b) => HexPath.Find(_g, b, 79, (x, y) => 1) == null ? double.PositiveInfinity : 1);
            Assert.NotNull(inner);
            Assert.Equal(9, inner!.Cost);
        }
    }
}
