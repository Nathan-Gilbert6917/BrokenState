using BrokenState.Sim.Core;
using Xunit;

namespace BrokenState.Sim.Tests
{
    /// <summary>The dice draw the prototype's numbers (values from `new Rng(seed).next()` in prototype/src/sim/rng.js).</summary>
    public class RngTests
    {
        [Fact]
        public void Seed12345DrawsThePrototypesSequence()
        {
            var rng = new Rng(12345);
            double[] expected = { 0.9797282677609473, 0.3067522644996643, 0.484205421525985, 0.817934412509203, 0.5094283693470061 };
            foreach (double e in expected) Assert.Equal(e, rng.Next(), 15);
        }

        [Fact]
        public void NegativeSeedWrapsLikeJavaScript()
        {
            Assert.Equal(0.48384718922898173, new Rng(-5).Next(), 15);
        }

        [Fact]
        public void IntIsInclusiveAndMatchesThePrototype()
        {
            Assert.Equal(2, new Rng(7).Int(2, 3));
            var rng = new Rng(99);
            for (int i = 0; i < 1000; i++) Assert.InRange(rng.Int(2, 3), 2, 3);
        }

        [Fact]
        public void JsRoundRoundsHalvesUp()
        {
            Assert.Equal(3, JsMath.RoundToInt(2.5));
            Assert.Equal(-2, JsMath.RoundToInt(-2.5));
            Assert.Equal(2, JsMath.RoundToInt(2.4999));
        }
    }
}
