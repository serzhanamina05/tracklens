import { defineConfig } from 'vitest/config'

export default defineConfig({
  define: { __DATA_MODE__: JSON.stringify('aggregate') },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
})
