/*
 * For a detailed explanation regarding each configuration property and type check, visit:
 * https://jestjs.io/docs/en/configuration.html
 */

export default {
    clearMocks: true,
    moduleFileExtensions: ['js', 'json', 'ts'],
    rootDir: 'tests',
    testEnvironment: 'node',
    testMatch: ['**/__tests__/**/*.[jt]s?(x)', '**/?(*.)+(spec|test).[tj]s?(x)'],
    testPathIgnorePatterns: ['/node_modules/', '/dist/'],
    transform: {
        '^.+\\.(t|j)s$': ['@swc/jest']
    },
    extensionsToTreatAsEsm: ['.ts', '.tsx'],
    moduleNameMapper: {
        '^prool$': '<rootDir>/test-utils/prool-shim.ts',
        '^prool/instances$': '<rootDir>/test-utils/prool-shim.ts'
    },
    transformIgnorePatterns: [
        // "/node_modules/",
        // "\\.pnp\\.[^\\/]+$",
    ]
}
