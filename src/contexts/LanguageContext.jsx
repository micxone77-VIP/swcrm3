// src/contexts/LanguageContext.jsx
// App-wide language switch (English / Chinese). Wrap the app once in
// LanguageProvider (done in App.jsx), then any component calls useLanguage()
// to get { lang, setLang, t }.
//
// t('namespace.key') looks up src/lib/i18n.js's translations object for the
// current language. If a key is missing in the current language, it falls
// back to the other language, then to the key itself, so a missing
// translation never crashes the page — it just shows something instead of
// blowing up.
import { createContext, useContext, useState, useEffect } from 'react'
import { translations } from '../lib/i18n'

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
    if (value === undefined) value = lookup(translations[lang === 'zh' ? 'en' : 'zh'])
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
