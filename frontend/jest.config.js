module.exports = {
    testEnvironment: 'node',
    transform: {
      '^.+\\.tsx?$': 'ts-jest'
    },
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts']
};
  