// A pool of worker threads for the slow headless tools (dettest, sameseedtest, pacing, sizetest): independent jobs
// (a seed, a seed and a style, a matchup) run side by side, one per core. Each worker is its own isolate with its own
// copy of every module, so a worker is a fresh process as far as the game's module state goes (world.js newId, the
// caches); a worker takes job after job, so it carries that state from one job to the next, as one process running
// the jobs in a row did. Results come back in job order, whatever order they finish in.
//   main thread:  const results = await pool(import.meta.url, jobs, { workers });   (null workers: one per core)
//   worker:       if (!isMainThread) serve((job) => ...result);   (the result must be structured-cloneable)
// workerCount(args) reads --workers N from a tool's arguments (--workers 1: one job after another, as before).
import { Worker, isMainThread, parentPort } from "node:worker_threads";
import { cpus } from "node:os";

export { isMainThread };
// The tool's own arguments, as given (read before the tool's code runs: tools/sizearg.js takes the size out of
// process.argv), handed to every worker so it parses them the same way (a worker's process.argv has none of them).
const ARGV = process.argv.slice(2);

export function workerCount(args, fallback = null) {
  const i = args.indexOf("--workers");
  const n = i >= 0 ? Number(args[i + 1]) : NaN;
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : fallback;
}
// The tool's arguments without "--workers N" (so positional arguments stay where they were).
export function withoutWorkers(args) {
  const i = args.indexOf("--workers");
  return i < 0 ? args : [...args.slice(0, i), ...args.slice(i + 2)];
}

// Runs every job through `file` (the tool's own import.meta.url) in up to `workers` threads. onResult(result, i) is
// called as each one finishes (progress dots). A job that throws, or a worker that dies, gives { error } for that job.
export function pool(file, jobs, { workers = null, onResult = null } = {}) {
  const n = Math.max(1, Math.min(jobs.length, workers || cpus().length));
  const out = new Array(jobs.length);
  let next = 0, finished = 0;
  return new Promise((resolve) => {
    if (!jobs.length) return resolve(out);
    const done = (i, result) => {
      out[i] = result;
      finished++;
      if (onResult) onResult(result, i);
      if (finished === jobs.length) resolve(out);
    };
    const start = () => {
      const w = new Worker(new URL(file), { argv: ARGV });
      let current = -1;
      const feed = () => {
        if (next < jobs.length) { current = next++; w.postMessage({ i: current, job: jobs[current] }); }
        else { current = -1; w.postMessage(null); }
      };
      w.on("message", (m) => { done(m.i, m.result); feed(); });
      w.on("error", (e) => { if (current >= 0) { done(current, { error: e && e.stack ? e.stack : String(e) }); current = -1; } });
      w.on("exit", () => { if (next < jobs.length) start(); }); // a worker that died: another takes the jobs left
      feed();
    };
    for (let k = 0; k < n; k++) start();
  });
}

// The worker's side: answers each job with handler(job) (sync or async) until the pool says there is no more; the
// promise settles then. A tool whose report follows at the top level ends the worker there:
//   if (!isMainThread) { await serve(handler); process.exit(0); }   (process.exit in a worker ends only the worker)
export function serve(handler) {
  return new Promise((resolve) => {
    parentPort.on("message", async (m) => {
      if (m == null) { parentPort.close(); resolve(); return; }
      let result;
      try { result = await handler(m.job); } catch (e) { result = { error: e && e.stack ? e.stack : String(e) }; }
      parentPort.postMessage({ i: m.i, result });
    });
  });
}
