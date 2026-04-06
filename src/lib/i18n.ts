import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import pt from '@/locales/pt.json'
import en from '@/locales/en.json'

export type LangCode = 'pt' | 'en'

const storedLang: LangCode =
  typeof window !== 'undefined'
    ? ((localStorage.getItem('lang') as LangCode) ?? 'pt')
    : 'pt'

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: {
      pt: { translation: pt },
      en: { translation: en },
    },
    lng: storedLang,
    fallbackLng: 'pt',
    interpolation: { escapeValue: false },
  })
}

export function setLang(lang: LangCode) {
  i18n.changeLanguage(lang)
  if (typeof window !== 'undefined') localStorage.setItem('lang', lang)
}

export default i18n
