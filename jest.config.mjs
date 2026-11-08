export default {
  preset: 'ts-jest/presets/default-esm',
  testEnvironment: 'node',
  testPathIgnorePatterns: ['/node_modules/', ...(process.env.RUN_INTEGRATION_TESTS === '1' ? [] : ['\\.integration\\.test\\.ts$'])],
  extensionsToTreatAsEsm: ['.ts', '.mts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.m?js$': '$1',
  },
  transform: {
    '^.+\\.m?[tj]s$': ['ts-jest', {
      useESM: true,
    }],
  },
};
