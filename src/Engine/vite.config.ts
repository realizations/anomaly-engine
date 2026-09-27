import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  build: {
    outDir: '../renderer',
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: 'src/main.ts',
      output: {
        entryFileNames: 'main.js',
        assetFileNames: 'assets/[name].[ext]',
      },
    },
  },
  server: {
    port: 3000,
  },
});
