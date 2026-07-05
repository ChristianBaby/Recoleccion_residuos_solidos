import type { Config } from 'jest'
import nextJest from 'next/jest.js'

const createJestConfig = nextJest({
  // Ruta a la app Next.js para cargar next.config.ts y archivos .env en el entorno de tests
  dir: './',
})

const config: Config = {
  coverageProvider: 'v8',
  testEnvironment: 'jsdom',
  setupFiles: ['<rootDir>/jest.setup.ts'],
  testMatch: ['<rootDir>/src/**/__tests__/**/*.test.ts'],
  moduleNameMapper: {
    // Alias de tsconfig.json: "@/*" -> "./src/*"
    '^@/(.*)$': '<rootDir>/src/$1',
  },
}

// createJestConfig se exporta así para que next/jest pueda cargar la configuración async de Next.js
export default createJestConfig(config)
