import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router'
import { IdentityProvider } from '../lib/identity-context'
import { CallbackHandler } from '../components/CallbackHandler'
import '../styles.css'
// Initialise i18n before any component renders
import '../lib/i18n'

// Inline, render-blocking script: reads the persisted UI theme from
// localStorage and sets the matching CSS variables on <html> before the page
// paints, so a personalised theme never flashes the default first.
const THEME_BOOTSTRAP = `(function(){try{var r=document.documentElement;var s=function(k,v){r.style.setProperty(k,v)};var raw=localStorage.getItem('adlerpro-ui-theme');if(!raw)return;var t=JSON.parse(raw);if(t.baseFontSize)r.style.fontSize=t.baseFontSize+'px';var m={fontFamily:'--ui-font-family',pageBg:'--ui-page-bg',surfaceBg:'--ui-surface-bg',textPrimary:'--ui-text-primary',textSecondary:'--ui-text-secondary',textMuted:'--ui-text-muted',accent:'--ui-accent',border:'--ui-border',menuText:'--ui-menu-text',menuActiveBg:'--ui-menu-active-bg',menuActiveText:'--ui-menu-active-text'};for(var k in m){if(t[k]!=null)s(m[k],t[k])}if(t.textPrimary){s('--color-primary',t.textPrimary)}if(t.textSecondary){s('--color-body',t.textSecondary);s('--color-muted',t.textSecondary)}if(t.textMuted){s('--color-label',t.textMuted);s('--color-label-light',t.textMuted)}if(t.border)s('--color-border',t.border);if(t.accent){s('--color-gold',t.accent);s('--color-gold-400',t.accent)}}catch(e){}})();`

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Os Meus Seguros' },
      { name: 'description', content: 'Portal seguro para clientes de corretagem de seguros empresariais' },
      { name: 'theme-color', content: '#111111' },
    ],
    links: [
      { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
      { rel: 'icon', type: 'image/png', sizes: '32x32', href: '/favicon.png' },
      { rel: 'icon', type: 'image/png', sizes: '192x192', href: '/favicon-192.png' },
      { rel: 'apple-touch-icon', sizes: '512x512', href: '/favicon-512.png' },
      {
        rel: 'preconnect',
        href: 'https://fonts.googleapis.com',
      },
      {
        rel: 'preconnect',
        href: 'https://fonts.gstatic.com',
        crossOrigin: 'anonymous',
      },
      {
        rel: 'preload',
        href: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;600;700&display=swap',
        as: 'style',
      },
      {
        rel: 'stylesheet',
        href: 'https://fonts.googleapis.com/css2?family=Montserrat:wght@300;400;600;700&display=swap',
      },
    ],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
})

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-PT">
      <head>
        {/* Apply the saved UI theme before first paint to avoid a flash. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootComponent() {
  return (
    <IdentityProvider>
      <CallbackHandler>
        <Outlet />
      </CallbackHandler>
    </IdentityProvider>
  )
}
