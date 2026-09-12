import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// https://vitejs.dev/config
export default defineConfig({
  root: `${__dirname}src/renderer`,
  build: {
    outDir: `${__dirname}.vite/renderer/main_window`,
  },
});
