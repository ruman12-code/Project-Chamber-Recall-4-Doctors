import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// The tablet page. Built to a folder of plain files that the laptop
// serves over the chamber's own network. Everything is bundled in: the
// tablet fetches nothing from the internet, because there is none.
export default defineConfig({
  root: resolve(__dirname, 'src/tablet'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'out/tablet'),
    emptyOutDir: true,
  },
});
