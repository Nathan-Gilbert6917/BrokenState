using System;
using BrokenState.Sim.Core;

namespace BrokenState.Sim.World
{
    /// <summary>
    /// The prototype's value noise (<c>mapgen.js makeNoise</c>): a lattice of random values `cell` tiles apart,
    /// smoothstep-interpolated. The lattice is drawn from the map's dice in row order, so building the three fields in
    /// the prototype's order from the same seed gives the same numbers (the golden terrain test holds it to that).
    /// </summary>
    public sealed class ValueNoise
    {
        private readonly double[] _g;
        private readonly int _gw;
        private readonly double _cell;

        public ValueNoise(Rng rng, int w, int h, double cell)
        {
            _cell = cell;
            _gw = (int)Math.Ceiling(w / cell) + 2;
            int gh = (int)Math.Ceiling(h / cell) + 2;
            _g = new double[_gw * gh];
            for (int i = 0; i < _g.Length; i++) _g[i] = rng.Next();
        }

        public double At(int x, int y)
        {
            double fx = x / _cell, fy = y / _cell;
            int ix = (int)Math.Floor(fx), iy = (int)Math.Floor(fy);
            double tx = Smooth(fx - ix), ty = Smooth(fy - iy);
            double top = V(ix, iy) * (1 - tx) + V(ix + 1, iy) * tx;
            double bot = V(ix, iy + 1) * (1 - tx) + V(ix + 1, iy + 1) * tx;
            return top * (1 - ty) + bot * ty;
        }

        private double V(int a, int b) => _g[b * _gw + a];
        private static double Smooth(double t) => t * t * (3 - 2 * t);
    }
}
