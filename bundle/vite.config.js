import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

// `actualmint-proxy` (Task 1) injects a plain, non-module <script> tag
// pointing at a fixed path, so the build output must be a single
// self-executing IIFE named `bundle.js` (plus whatever CSS it pulls in,
// as `bundle.css`) rather than Vite's default hashed, ESM-chunked output.
export default defineConfig(({ mode }) => ({
  plugins: [
    svelte({
      // The brief's src/index.js instantiates widgets with `new
      // PacingBars({ target, props })` (Svelte 4 style) rather than
      // Svelte 5's `mount()`; opt each component back into that
      // constructor API so it keeps working as specified.
      compilerOptions: { compatibility: { componentApi: 4 } },
    }),
  ],
  build: {
    outDir: 'dist',
    cssCodeSplit: false,
    rollupOptions: {
      input: 'src/index.js',
      output: {
        format: 'iife',
        entryFileNames: 'bundle.js',
        assetFileNames: 'bundle[extname]',
      },
    },
  },
  // Vitest shares this config. @sveltejs/vite-plugin-svelte recommends this
  // so that, if a test ever imports a .svelte file directly, module
  // resolution picks Svelte's client-compiled build rather than its
  // SSR build (the default under Node/jsdom).
  resolve: {
    conditions: mode === 'test' ? ['browser'] : [],
  },
  test: {
    environment: 'jsdom',
    globals: true,
  },
}));
