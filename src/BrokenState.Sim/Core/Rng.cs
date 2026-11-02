using System;
using System.Collections.Generic;

namespace BrokenState.Sim.Core
{
    /// <summary>
    /// Seeded random number generator: mulberry32, the prototype's <c>sim/rng.js</c> bit for bit, so a seed draws the
    /// same numbers here as it does there (tests/BrokenState.Sim.Tests RngTests). The prototype keeps its state as a
    /// JavaScript number that grows past 32 bits; every operation reads it modulo 2^32, so a uint here is the same
    /// generator (a saved prototype state is this state modulo 2^32).
    /// </summary>
    public sealed class Rng
    {
        /// <summary>The position in the sequence (saved with the game).</summary>
        public uint State;

        public Rng(int seed) { State = unchecked((uint)seed); }
        public Rng(uint state) { State = state; }

        /// <summary>0 ≤ x &lt; 1.</summary>
        public double Next()
        {
            unchecked
            {
                uint t = State += 0x6d2b79f5u;
                t = (t ^ (t >> 15)) * (t | 1u);
                t ^= t + (t ^ (t >> 7)) * (t | 61u);
                return (t ^ (t >> 14)) / 4294967296.0;
            }
        }

        /// <summary>min ≤ x &lt; max.</summary>
        public double Range(double min, double max) => min + Next() * (max - min);

        /// <summary>An integer min ≤ x ≤ max (inclusive).</summary>
        public int Int(int min, int max) => (int)Math.Floor(Range(min, max + 1));

        public bool Chance(double p) => Next() < p;

        public T Pick<T>(IReadOnlyList<T> items) => items[(int)Math.Floor(Next() * items.Count)];

        /// <summary>In place, Fisher–Yates from the end as the prototype does.</summary>
        public IList<T> Shuffle<T>(IList<T> items)
        {
            for (int i = items.Count - 1; i > 0; i--)
            {
                int j = (int)Math.Floor(Next() * (i + 1));
                T tmp = items[i];
                items[i] = items[j];
                items[j] = tmp;
            }
            return items;
        }

        public T Weighted<T>(IReadOnlyList<T> items, Func<T, double> weight)
        {
            double total = 0;
            for (int i = 0; i < items.Count; i++) total += weight(items[i]);
            double roll = Next() * total;
            for (int i = 0; i < items.Count; i++)
            {
                roll -= weight(items[i]);
                if (roll <= 0) return items[i];
            }
            return items[items.Count - 1];
        }
    }

    /// <summary>JavaScript's number helpers where C# rounds differently.</summary>
    public static class JsMath
    {
        /// <summary>JavaScript Math.round: halves go up (toward +∞); C#'s Math.Round goes to even.</summary>
        public static double Round(double x) => Math.Floor(x + 0.5);
        public static int RoundToInt(double x) => (int)Math.Floor(x + 0.5);
    }
}
