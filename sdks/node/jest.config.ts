import type { Config } from 'jest'

const config: Config = {
  preset:          'ts-jest',
  testEnvironment: 'node',
  testMatch:       ['**/__tests__/**/*.test.ts'],
  globals: {
    'ts-jest': { tsconfig: './tsconfig.json' },
  },
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts'],
}

export default config
