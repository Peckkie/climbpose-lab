import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`         → dist/ (static site to deploy)
// `npm run build:single`  → dist-single/index.html (one file, opens by double-click)
export default defineConfig(({ mode }) => mode === 'single'
  ? { base: './', plugins: [viteSingleFile()], build: { outDir: 'dist-single', target: 'es2022' } }
  : { base: './', build: { outDir: 'dist', target: 'es2022' } });
