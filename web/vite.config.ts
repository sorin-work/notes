/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { serviceWorker } from './build/service-worker';

// Tells one build from the next. An open tab compares its own with /version.json.
const buildId = process.env.BUILD_ID || new Date().toISOString();

export default defineConfig({
  plugins: [react(), serviceWorker(buildId)],
  define: { __BUILD_ID__: JSON.stringify(buildId) },
  server: {
    port: 5181,
    proxy: {
      '/api': {
        target: process.env.API_URL ?? 'http://localhost:4401',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Keep the Markdown renderer and React in their own long-cached files.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router', '@tanstack/react-query'],
          markdown: ['react-markdown', 'remark-gfm'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
  },
});
