import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const engine = process.env.ENGINE_URL ?? 'http://127.0.0.1:8000'

const proxy = {
  '/api': { target: engine, changeOrigin: true, ws: true },
}

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy,
    // The shared contract (field limits, presets) lives one level above the app.
    fs: { allow: ['..'] },
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true, proxy },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 5000,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
    restoreMocks: true,
  },
})
