/**
 * Benchmark runner — no extra dependencies, uses Node.js perf_hooks.
 *
 * Usage:
 *   npm run benchmark
 *
 * Output is written to the console. To persist results, redirect stdout:
 *   npm run benchmark > benchmark-results/$(date +%F).txt
 */
import { performance } from 'perf_hooks';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Harness ────────────────────────────────────────────────────────────────

interface BenchResult {
  name: string;
  iters: number;
  totalMs: number;
  opsPerSec: number;
  usPerOp: number;
}

function bench(name: string, fn: () => void, iters = 10_000): BenchResult {
  // warmup — 10 % of iterations, min 10
  const warmup = Math.max(10, Math.floor(iters * 0.1));
  for (let i = 0; i < warmup; i++) fn();

  const start = performance.now();
  for (let i = 0; i < iters; i++) fn();
  const totalMs = performance.now() - start;

  const usPerOp = (totalMs / iters) * 1_000;
  const opsPerSec = Math.round(iters / (totalMs / 1_000));
  return { name, iters, totalMs, opsPerSec, usPerOp };
}

function printResults(suite: string, results: BenchResult[]): void {
  const nameWidth = Math.max(...results.map((r) => r.name.length), suite.length) + 2;
  const sep = '─'.repeat(nameWidth + 42);

  console.log(`\n${suite}`);
  console.log(sep);
  console.log(
    `${'Benchmark'.padEnd(nameWidth)}${'iters'.padStart(9)}  ${'μs/op'.padStart(10)}  ${'ops/s'.padStart(12)}`,
  );
  console.log(sep);

  for (const r of results) {
    console.log(
      `${r.name.padEnd(nameWidth)}${String(r.iters).padStart(9)}  ${r.usPerOp.toFixed(3).padStart(10)}  ${String(r.opsPerSec).padStart(12)}`,
    );
  }
  console.log(sep);
}

// ─── Run suites ─────────────────────────────────────────────────────────────

async function main() {
  console.log('Running benchmarks…\n');

  const suites: Array<{ label: string; file: string }> = [
    { label: 'Geometry utilities  (convex/util/geometry.ts)', file: './geometry.bench' },
    { label: 'MinHeap             (convex/util/minheap.ts)', file: './minheap.bench' },
  ];

  for (const suite of suites) {
    const mod = await import(suite.file);
    const results: BenchResult[] = [];
    mod.run((name: string, fn: () => void, iters?: number) => {
      const r = bench(name, fn, iters);
      results.push(r);
    });
    printResults(suite.label, results);
  }

  console.log('\nDone.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
