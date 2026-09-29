import { defineConfig, type Plugin } from 'vite';
import { resolve } from 'node:path';

// The native host loads index.html over file://, where Chromium refuses to
// execute ES module scripts (CORS). The bundle is a single self-contained IIFE,
// so demoting the tag to a classic script is safe and makes file:// work.
function classicEntryScript(): Plugin {
  return {
    name: 'anomaly:classic-entry-script',
    enforce: 'post',
    generateBundle(_options, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type === 'asset' && file.fileName.endsWith('.html')) {
          const html = String(file.source).replace(
            /<script type="module"(\s+crossorigin)?/g,
            '<script defer'
          );
          file.source = html;
        }
      }
    },
  };
}

export default defineConfig({
  root: 'src',
  base: './',
  plugins: [classicEntryScript()],
  build: {
    outDir: resolve(process.cwd(), 'renderer'),
    emptyOutDir: true,
    sourcemap: true,
    target: 'es2022',
    rollupOptions: {
      input: resolve(process.cwd(), 'src/index.html'),
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name]-[hash].js',
      },
    },
    modulePreload: false,
  },
  server: {
    port: 3000,
  },
});
