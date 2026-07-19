/**
 * Email brand chrome. Transactional emails render with Arial/Helvetica (web
 * fonts are unreliable in mail clients), so branding here is text + colour only.
 *
 * The Portuguese "Os Meus Seguros" brand is the default and reproduces exactly
 * what BaseLayout hard-coded before, so every existing send is unchanged. The
 * My Cover Vault brand is used by the English templates.
 */
export interface EmailBrand {
  name: string
  tagline: string
  /** Small uppercase line under the wordmark. */
  kicker: string
  /** Footer sign-off note. */
  footerNote: string
  footerName: string
}

export const EMAIL_BRAND_PT: EmailBrand = {
  name: 'Os Meus Seguros',
  tagline: 'by Adler & Rochefort',
  kicker: 'Gestão de Seguros',
  footerName: 'Adler & Rochefort · Mediadores de Seguros',
  footerNote:
    'Este email foi enviado automaticamente pelo sistema Os Meus Seguros. Para deixar de receber estas notificações, contacte o seu mediador.',
}

export const EMAIL_BRAND_MCV: EmailBrand = {
  name: 'My Cover Vault',
  tagline: 'by Adler & Rochefort',
  kicker: 'Insurance Management',
  footerName: 'Adler & Rochefort · Ownizo Unipessoal Lda. · ASF reg. 425591790/3',
  footerNote:
    'This email was sent automatically by My Cover Vault. To stop receiving these notifications, please contact your broker.',
}
