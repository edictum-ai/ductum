import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@ductum/ui-contract': path.resolve(__dirname, '../api/src/lib/ui-contract-types.ts'),
      '@ductum/operator-contract': path.resolve(__dirname, '../core/src/operator-contract-types.ts'),
      '@ductum/public-redaction': path.resolve(__dirname, '../core/src/public-redaction.ts'),
    },
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5176,
    proxy: {
      '/api': {
        target: 'http://localhost:4100',
        changeOrigin: true,
      },
    },
  },
})
