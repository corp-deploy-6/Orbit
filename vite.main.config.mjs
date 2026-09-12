import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // node-pty is a native addon that dynamically requires its .node binary
      // at runtime; bundling it through Rollup breaks that lookup, so keep it
      // as a real require() instead.
      external: ['node-pty'],
    },
  },
});
