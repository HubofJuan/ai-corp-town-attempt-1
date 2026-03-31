import { MinHeap } from '../convex/util/minheap';

const compare = (a: number, b: number): boolean => a > b;

function buildHeap(size: number): ReturnType<typeof MinHeap<number>> {
  const heap = MinHeap(compare);
  for (let i = size; i > 0; i--) heap.push(i);
  return heap;
}

export function run(bench: (name: string, fn: () => void, iters?: number) => void): void {
  bench('push() — 100 items', () => buildHeap(100), 5_000);
  bench('push() — 1 000 items', () => buildHeap(1_000), 1_000);
  bench('push() — 10 000 items', () => buildHeap(10_000), 200);

  bench('peek() on 1 000-item heap', () => {
    const heap = buildHeap(1_000);
    heap.peek();
  }, 1_000);

  bench('pop() all from 100-item heap', () => {
    const heap = buildHeap(100);
    while (heap.length()) heap.pop();
  }, 5_000);

  bench('pop() all from 1 000-item heap', () => {
    const heap = buildHeap(1_000);
    while (heap.length()) heap.pop();
  }, 500);

  bench('push+pop interleaved — 500 ops', () => {
    const heap = MinHeap(compare);
    for (let i = 0; i < 250; i++) {
      heap.push(Math.random() * 1000);
      if (i % 2 === 0) heap.pop();
    }
  }, 2_000);
}
