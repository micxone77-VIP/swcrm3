// src/contexts/LanguageContext.jsx
// App-wide language switch (English / Chinese). Wrap the app once in
// LanguageProvider (done in App.jsx), then any component calls useLanguage()
// to get { lang, setLang, t }.
import { createContext, useContext, useState, useEffect } from 'react'
import { translations } from '../lib/i18n'
import { retentionTranslations } from '../lib/retentionTranslations'

const LanguageContext = createContext(null)

export function LanguageProvider({ children }) {
  const [lang, setLang] = useState(() => {
    try { return localStorage.getItem('crm_lang') || 'zh' } catch { return 'zh' }
  })

  useEffect(() => {
    try { localStorage.setItem('crm_lang', lang) } catch { /* ignore */ }
  }, [lang])

  function t(key, vars) {
    const parts = key.split('.')
    const lookup = (dict) => {
      let node = dict
      for (const p of parts) {
        node = node?.[p]
        if (node === undefined) return undefined
      }
      return node
    }
    let value = lookup(translations[lang])
    if (value === undefined) value = lookup(retentionTranslations[lang])
    if (value === undefined) value = lookup(translations[lang === 'zh' ? 'en' : 'zh'])
    if (value === undefined) value = lookup(retentionTranslations[lang === 'zh' ? 'en' : 'zh'])
    if (value === undefined) return key
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => { value = value.replace(`{${k}}`, v) })
    }
    return value
  }

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  )
}

export function useLanguage() {
  const ctx = useContext(LanguageContext)
  if (!ctx) throw new Error('useLanguage must be used within a LanguageProvider')
  return ctx
}
