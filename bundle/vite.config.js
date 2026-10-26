import { defineConfig } from 'vite';

// Minimal config for now: later tasks will add the Svelte plugin and a
// build entry point/output for the injected browser bundle. For this task,
// all we need is Vitest running its own tests under jsdom.
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
  },
});
