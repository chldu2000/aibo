import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { functionsMixins } from 'vite-plugin-functions-mixins';
import path from 'node:path';

export default defineConfig({
  plugins: [functionsMixins({ deps: ['m3-svelte'] }), tailwindcss(), svelte()],
  resolve: {
    alias: {
      $lib: path.resolve('./src/lib'),
    },
  },
  clearScreen: false,
  server: {
    // Keep the Tauri WebView and Vite on the same address family. macOS can
    // resolve `localhost` differently between Node and WebKit, leaving a
    // blank window when Vite only binds to ::1.
    host: '127.0.0.1',
    port: 1420,
    strictPort: true,
  },
  envPrefix: ['VITE_', 'TAURI_'],
});
