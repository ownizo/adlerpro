// Vite config exclusivo para o build SPA da app Android (Capacitor).
//
// ISOLAMENTO TOTAL: não altera nem é importado por vite.config.ts.
// Output em dist-capacitor/ — completamente separado de dist/client/ (produção Netlify).
//
// Para construir:
//   VITE_API_BASE_URL=https://your-app.netlify.app npm run build:capacitor
//
// VITE_API_BASE_URL é a URL base do Netlify deployment (sem trailing slash).
// Todas as chamadas a /api/... serão prefixadas com este valor na app Android.
import { defineConfig } from 'vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'node:path'

export default defineConfig({
  // Setting root to src/one-app/ makes index.html land at dist-capacitor/index.html
  // (instead of dist-capacitor/src/one-app/index.html) — required by Capacitor's webDir.
  root: resolve(__dirname, 'src/one-app'),

  plugins: [
    viteTsConfigPaths({ projects: [resolve(__dirname, 'tsconfig.json')] }),
    tailwindcss(),
    viteReact(),
    // NOTE: NOT using tanstackStart() nor netlify() — this is a pure client SPA.
    // NOT using TanStackRouterVite — route tree is manually assembled in router.tsx.
  ],

  build: {
    outDir: resolve(__dirname, 'dist-capacitor'),
    emptyOutDir: true,
  },

  resolve: {
    alias: {
      // Swap one-api.ts → one-api.capacitor.ts so server functions are replaced
      // by Netlify Function calls. The production build is unaffected (no alias there).
      '@/lib/one-api': resolve(__dirname, 'src/lib/one-api.capacitor.ts'),
    },
  },

  define: {
    // Bake the Netlify base URL into the bundle at build time.
    // Must be set as an env var when running this config, e.g.:
    //   VITE_API_BASE_URL=https://my-site.netlify.app npm run build:capacitor
    'import.meta.env.VITE_API_BASE_URL': JSON.stringify(process.env['VITE_API_BASE_URL'] ?? ''),
  },
})
