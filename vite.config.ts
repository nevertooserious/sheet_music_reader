import { defineConfig } from 'vite';

export default defineConfig({
  // GitHub Pages serves the app under /<repo>/; the deploy workflow sets BASE_PATH, local dev stays at the root.
  base: process.env.BASE_PATH || '/',
  server: {
    port: 5173,
    strictPort: true,
    host: '127.0.0.1',
  },
  optimizeDeps: {
    include: ['pdfjs-dist'],
  },
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
} as any);
