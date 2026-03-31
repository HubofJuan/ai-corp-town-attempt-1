import type { JestConfigWithTsJest } from 'ts-jest';

const jestConfig: JestConfigWithTsJest = {
  preset: 'ts-jest/presets/default-esm',
  testMatch: [
    '**/__tests__/**/*.test.ts',
    '**/convex/**/*.test.ts',
    '**/src/**/*.test.ts',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/benchmarks/'],
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'convex/**/*.ts',
    'src/**/*.ts',
    '!convex/_generated/**',
    '!**/*.d.ts',
    '!**/*.test.ts',
  ],
  coverageReporters: ['text', 'lcov', 'html'],
  moduleNameMapper: {
    '^convex/(.*)$': '<rootDir>/node_modules/convex/dist/esm/$1/index.js',
  },
};

export default jestConfig;
