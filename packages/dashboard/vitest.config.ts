import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ductum/ui-contract': path.resolve(__dirname, '../api/src/lib/ui-contract-types.ts'),
      '@ductum/operator-contract': path.resolve(__dirname, '../core/src/operator-contract-types.ts'),
      '@ductum/public-redaction': path.resolve(__dirname, '../core/src/public-redaction.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/tests/setup.ts'],
    css: false,
    fileParallelism: false,
  },
})
