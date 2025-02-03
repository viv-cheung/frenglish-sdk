import path from 'path'
import { defineConfig } from 'vitest/config'
import { loadEnv } from 'vite'

export default defineConfig({
  resolve: {
    alias: {
      'src': path.resolve(__dirname, './src')
    }
  },
  test: {
    environment: 'happy-dom',
    silent: true,
    testTimeout: 30000, // 30s per test max
    include: [path.resolve(__dirname, 'tests/**/*.test.ts')],
    setupFiles: ['./tests/vitest.setup.ts'],
    pool: 'forks', // Needed to prevent SQLite3 from crashing 
    restoreMocks: true, // Undo the mocks after each test
    sequence: {
      // Set to TRUE for more robust testing
      // to do once in a while just in case
      shuffle: false
    },
    env: {
      // Explicitly load .env file
      ...loadEnv('', process.cwd(), ''),
      ...require('dotenv').config({ 
        path: path.resolve(__dirname, '.env')
      }).parsed
    },
  }
})