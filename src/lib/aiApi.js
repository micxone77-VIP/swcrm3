// src/lib/aiApi.js
// Thin wrapper for calling the Cloudflare Pages Functions under /api/*.
// These endpoints require the caller's Supabase session token, which is how
// the backend verifies the request came from a logged-in CRM user rather
// than an outside party who found the URL.
import { supabase } from './supabase'

export async function callAI(endpoint, body) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.access_token) {
    throw new Error('Not logged in — please refresh and try again.')
  }
  const res = await fetch(`/api/${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
    },
    body: JSON.stringify(body),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(json.error || `Request failed (${res.status})`)
  }
  return json
}
