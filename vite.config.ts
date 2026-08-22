import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

// The renderer is built to a plain folder of files loaded over file://.
// There is no dev server in production and no network access of any kind.
export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, 'out/renderer'),
    emptyOutDir: true,
  },
});
