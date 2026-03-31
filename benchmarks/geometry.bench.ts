import { performance } from 'perf_hooks';
import {
  distance,
  manhattanDistance,
  normalize,
  vectorLength,
  orientationDegrees,
  pathPosition,
  compressPath,
} from '../convex/util/geometry';
import type { Path, PathComponent } from '../convex/util/types';

export function run(bench: (name: string, fn: () => void, iters?: number) => void): void {
  const p0 = { x: 0, y: 0 };
  const p1 = { x: 3, y: 4 };
  const vec = { dx: 3, dy: 4 };

  const twoPointPath: Path = [
    [0, 0, 0, 1, 0],
    [0, 10, 0, 1, 10],
  ];

  const longPath: Path = Array.from({ length: 50 }, (_, i) => [
    i,
    i,
    0,
    1,
    i,
  ] as [number, number, number, number, number]);

  const denseStraightLine: PathComponent[] = Array.from({ length: 100 }, (_, i) => ({
    position: { x: 0, y: i },
    facing: { dx: 0, dy: 1 },
    t: i,
  }));

  const densePathWithTurn: PathComponent[] = [
    ...Array.from({ length: 50 }, (_, i) => ({
      position: { x: 0, y: i },
      facing: { dx: 0, dy: 1 },
      t: i,
    })),
    ...Array.from({ length: 50 }, (_, i) => ({
      position: { x: i + 1, y: 50 },
      facing: { dx: 1, dy: 0 },
      t: 50 + i + 1,
    })),
  ];

  bench('distance()', () => distance(p0, p1));
  bench('manhattanDistance()', () => manhattanDistance(p0, p1));
  bench('vectorLength()', () => vectorLength(vec));
  bench('normalize()', () => normalize(vec));
  bench('orientationDegrees()', () => orientationDegrees(vec));
  bench('pathPosition() — 2-point path, mid', () => pathPosition(twoPointPath, 5));
  bench('pathPosition() — 50-point path, mid', () => pathPosition(longPath, 25), 5_000);
  bench('compressPath() — 100-point straight line', () => compressPath(denseStraightLine), 2_000);
  bench('compressPath() — 100-point path with turn', () => compressPath(densePathWithTurn), 2_000);
}
