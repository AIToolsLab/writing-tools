module.exports = {
    testEnvironment: 'jsdom',
    transform: {
      '^.+\\.tsx?$': ['ts-jest', {
        tsconfig: {
          jsx: 'react-jsx',
          esModuleInterop: true,
          types: ['jest', 'node']
        }
      }]
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    testMatch: ['**/__tests__/**/*.test.ts?(x)', '**/?(*.)+(spec|test).ts?(x)'],
    setupFilesAfterEnv: ['<rootDir>/src/test-setup.ts'],
    moduleNameMapper: {
      '^@/(.*)$': '<rootDir>/src/$1',
      '\\.(css|less|scss|sass)$': 'identity-obj-proxy'
    },
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    collectCoverageFrom: [
      'src/**/*.{ts,tsx}',
      '!src/**/*.d.ts',
      '!src/test-setup.ts'
    ],
    globals: {
      'ts-jest': {
        isolatedModules: true
      }
    }
};
