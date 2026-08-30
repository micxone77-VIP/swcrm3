// src/hooks/useUrlParam.js
// Keeps a piece of UI state (a filter, a tab, a date, a page number) synced to
// the URL's query string, instead of living only in React state.
//
// Why this exists: plain useState resets to its default every time a page
// component unmounts — which happens on every navigation away (e.g. clicking
// into a VIP's profile) and back. Filters, search text, selected tabs, and
// pagination all quietly reset, which is confusing when you've just set up a
// specific view and expect it to still be there when you return. Storing the
// value in the URL instead means React Router's own history keeps it — browser
// back/forward, a page refresh, and returning via a different route all just
// work, with no extra storage mechanism needed.
//
// Usage (drop-in replacement for useState in most cases):
//   const [search, setSearch] = useUrlParam('search', '')
//   const [tierF, setTierF]   = useUrlParam('tier', 'ALL')
//
// The default value is never written into the URL (keeps URLs clean when
// nothing's been changed from default) — only non-default values show up as
// query params.
import { useSearchParams } from 'react-router-dom'

// For the common case: one key, one default, works just like useState.
export function useUrlParam(key, defaultValue) {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get(key)
  const value = raw === null ? defaultValue : raw

  function setValue(newValOrUpdater) {
    setSearchParams(prev => {
      const prevRaw = prev.get(key)
      const prevValue = prevRaw === null ? defaultValue : prevRaw
      const newVal = typeof newValOrUpdater === 'function' ? newValOrUpdater(prevValue) : newValOrUpdater
      const next = new URLSearchParams(prev)
      const isDefault = newVal === defaultValue || newVal === '' || newVal === null || newVal === undefined
      if (isDefault) next.delete(key)
      else next.set(key, String(newVal))
      return next
    }, { replace: true })
  }

  return [value, setValue]
}

// Same idea, but for numeric values (page numbers, etc.) — handles the
// string<->number conversion that raw URL params otherwise require every time.
export function useUrlParamNumber(key, defaultValue) {
  const [raw, setRaw] = useUrlParam(key, String(defaultValue))
  const value = Number(raw)
  const current = Number.isFinite(value) ? value : defaultValue
  function setValue(newValOrUpdater) {
    const newVal = typeof newValOrUpdater === 'function' ? newValOrUpdater(current) : newValOrUpdater
    setRaw(String(newVal))
  }
  return [current, setValue]
}

// Same idea, but for booleans (toggles like "My VIPs only") — handles the
// 'true'/'false' string conversion.
export function useUrlParamBool(key, defaultValue) {
  const [raw, setRaw] = useUrlParam(key, defaultValue ? 'true' : 'false')
  const current = raw === 'true'
  function setValue(newValOrUpdater) {
    const newVal = typeof newValOrUpdater === 'function' ? newValOrUpdater(current) : newValOrUpdater
    setRaw(newVal ? 'true' : 'false')
  }
  return [current, setValue]
}

// IMPORTANT: when two or more URL-backed values must change together in one
// click (e.g. two mutually-exclusive toggles, or a filter change that should
// also reset pagination), do NOT call two separate useUrlParam setters in the
// same handler — each one reads its own snapshot of the current URL, so the
// second call won't see the first one's change yet and will silently discard
// it. This bit the tier/status/region filters on VIP Members: every one of
// them chained a second setPage(0) call and the page reset clobbered the
// actual filter change every time, even though the button looked selected.
//
// Use this instead for any handler that needs to change more than one key:
//   const { get, set } = useUrlParamsRaw()
//   set({ mine: 'true', unassigned: 'false' })   // both land in one navigation
export function useUrlParamsRaw() {
  const [searchParams, setSearchParams] = useSearchParams()
  function get(key, defaultValue) {
    const raw = searchParams.get(key)
    return raw === null ? defaultValue : raw
  }
  function set(updates, defaults = {}) {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev)
      Object.entries(updates).forEach(([key, val]) => {
        const isDefault = val === defaults[key] || val === '' || val === null || val === undefined
        if (isDefault) next.delete(key)
        else next.set(key, String(val))
      })
      return next
    }, { replace: true })
  }
  return { get, set }
}
