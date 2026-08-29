import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    assetsDir: 'assets',
  },
  server: {
    port: 5173,
  },
})
