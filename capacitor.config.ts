import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.adlerrochefort.osmeusseguros',
  appName: 'Os Meus Seguros',
  webDir: 'dist-capacitor',

  server: {
    // Use https scheme so os cookies do Supabase (Secure flag) funcionam correctamente
    // no WebView Android. Sem isto, cookies com Secure=true são ignorados em http://localhost.
    androidScheme: 'https',
  },

  android: {
    // Não permitir conteúdo mixed (http) num contexto https — boa prática.
    allowMixedContent: false,
    // Desactivar capture do back button do sistema para não sair acidentalmente da app.
    captureInput: true,
  },

  plugins: {
    // Sem push notifications nem biometria nesta fase.
  },
};

export default config;
