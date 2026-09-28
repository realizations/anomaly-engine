import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'src',
  base: './',
  build: {
    outDir: resolve(process.cwd(), 'renderer'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: resolve(process.cwd(), 'src/index.html'),
    },
  },
  server: {
    port: 3000,
  },
});
