using System;
using System.Collections.Generic;

namespace BrokenState.Sim.Core
{
    public sealed class PathResult
    {
        public readonly List<int> Path;
        public readonly double Cost;
        public PathResult(List<int> path, double cost) { Path = path; Cost = cost; }
    }

    /// <summary>
    /// A* over a HexGrid, the prototype's <c>hex.js findPath</c>: cost(from, to) is a step's cost, or +∞ when blocked;
    /// maxCost gives up past it; minStep is the cheapest step there is (the heuristic is distance × minStep, so it
    /// never overestimates). The per-tile scratch arrays are kept between searches and stamped with a search mark, so
    /// nothing is cleared between them; a search started inside another's cost function takes a second set.
    /// </summary>
    public static class HexPath
    {
        public static PathResult? Find(HexGrid grid, int start, int goal, Func<int, int, double> cost, double maxCost = double.PositiveInfinity, double minStep = 0.5)
        {
            if (start == goal) return new PathResult(new List<int> { start }, 0);
            var s = Take(grid.Size);
            uint mark = s.Mark;
            try
            {
                var open = new MinHeap();
                var nbrs = new List<int>(6);
                s.Seen[start] = mark; s.G[start] = 0; s.Came[start] = -1;
                open.Push(start, grid.Distance(start, goal));
                while (open.Count > 0)
                {
                    int cur = open.Pop();
                    if (cur == goal)
                    {
                        var path = new List<int> { cur };
                        for (int c = s.Came[cur]; c >= 0; c = s.Came[c]) path.Add(c);
                        path.Reverse();
                        return new PathResult(path, s.G[goal]);
                    }
                    double gc = s.G[cur];
                    // A tile already expanded at this cost offered every neighbour the same, so a later heap copy is skipped.
                    if (s.ExSeen[cur] == mark && s.Ex[cur] == gc) continue;
                    s.ExSeen[cur] = mark; s.Ex[cur] = gc;
                    grid.NeighborsInto(cur, nbrs);
                    for (int i = 0; i < nbrs.Count; i++)
                    {
                        int n = nbrs[i];
                        double step = cost(cur, n);
                        if (double.IsInfinity(step) || double.IsNaN(step)) continue;
                        double ng = gc + step;
                        if (ng > maxCost) continue;
                        double best = s.Seen[n] == mark ? s.G[n] : double.PositiveInfinity;
                        if (ng < best)
                        {
                            s.Seen[n] = mark; s.G[n] = ng; s.Came[n] = cur;
                            open.Push(n, ng + grid.Distance(n, goal) * minStep);
                        }
                    }
                }
                return null;
            }
            finally { Release(s); }
        }

        private sealed class Scratch
        {
            public readonly double[] G, Ex;
            public readonly int[] Came;
            public readonly uint[] Seen, ExSeen;
            public uint Mark;
            public Scratch(int size) { G = new double[size]; Ex = new double[size]; Came = new int[size]; Seen = new uint[size]; ExSeen = new uint[size]; }
        }

        private static readonly Stack<Scratch> Spare = new Stack<Scratch>();
        private static readonly object Gate = new object();

        private static Scratch Take(int size)
        {
            Scratch? s = null;
            lock (Gate) { if (Spare.Count > 0 && Spare.Peek().G.Length == size) s = Spare.Pop(); else if (Spare.Count > 0 && Spare.Peek().G.Length != size) Spare.Clear(); }
            s ??= new Scratch(size);
            if (++s.Mark == 0xffffffffu) { Array.Clear(s.Seen, 0, s.Seen.Length); Array.Clear(s.ExSeen, 0, s.ExSeen.Length); s.Mark = 1; }
            return s;
        }

        private static void Release(Scratch s)
        {
            lock (Gate) { if (Spare.Count < 4) Spare.Push(s); }
        }

        /// <summary>A binary min-heap of tile ids by priority (the prototype's MinHeap).</summary>
        private sealed class MinHeap
        {
            private readonly List<int> _items = new List<int>();
            private readonly List<double> _prio = new List<double>();
            public int Count => _items.Count;

            public void Push(int item, double p)
            {
                _items.Add(item); _prio.Add(p);
                int i = _items.Count - 1;
                while (i > 0)
                {
                    int parent = (i - 1) >> 1;
                    if (_prio[parent] <= _prio[i]) break;
                    Swap(i, parent);
                    i = parent;
                }
            }

            public int Pop()
            {
                int top = _items[0];
                int last = _items.Count - 1;
                int lastItem = _items[last]; double lastPrio = _prio[last];
                _items.RemoveAt(last); _prio.RemoveAt(last);
                if (_items.Count > 0)
                {
                    _items[0] = lastItem; _prio[0] = lastPrio;
                    int i = 0;
                    for (;;)
                    {
                        int l = i * 2 + 1, r = l + 1, m = i;
                        if (l < _items.Count && _prio[l] < _prio[m]) m = l;
                        if (r < _items.Count && _prio[r] < _prio[m]) m = r;
                        if (m == i) break;
                        Swap(i, m);
                        i = m;
                    }
                }
                return top;
            }

            private void Swap(int a, int b)
            {
                int it = _items[a]; double p = _prio[a];
                _items[a] = _items[b]; _prio[a] = _prio[b];
                _items[b] = it; _prio[b] = p;
            }
        }
    }
}
