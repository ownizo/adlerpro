import { defineConfig } from 'vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import viteTsConfigPaths from 'vite-tsconfig-paths'
import tailwindcss from '@tailwindcss/vite'
import netlify from '@netlify/vite-plugin-tanstack-start'

// Per-deploy brand flag. This monorepo builds several Netlify sites from the
// same bundle; the My Cover Vault site sets SITE_NAME/URL to "mycovervault".
// Any other deploy (osmeusseguros, admin, pro…) resolves to `false`, so their
// output is unchanged. Injected as a build-time constant so it is available
// during SSR and in the client bundle without a runtime lookup.
const IS_MYCOVERVAULT =
  /mycovervault/i.test(process.env.URL ?? '') ||
  /mycovervault/i.test(process.env.SITE_NAME ?? '') ||
  /mycovervault/i.test(process.env.DEPLOY_PRIME_URL ?? '')

const config = defineConfig({
  define: {
    __IS_MYCOVERVAULT__: JSON.stringify(IS_MYCOVERVAULT),
  },
  plugins: [
    viteTsConfigPaths({
      projects: ['./tsconfig.json'],
    }),
    tailwindcss(),
    netlify(),
    tanstackStart(),
    viteReact(),
  ],
})

export default config
