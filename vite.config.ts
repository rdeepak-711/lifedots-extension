import { defineConfig } from 'vite'
import { crx } from '@crxjs/vite-plugin'
import manifest from './manifest.json' with { type: 'json' }

export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    // The year page is opened by the popup rather than referenced from the
    // manifest, so CRXJS does not discover it. Name it explicitly or it is
    // silently left out of the build.
    rollupOptions: { input: { year: 'src/year/index.html' } },
    outDir: 'dist',
    emptyOutDir: true,
    // Extensions are read by a store reviewer. Obfuscation is against policy and
    // minified-but-readable is explicitly allowed, so keep the output honest.
    minify: false,
    sourcemap: true,
  },
})
