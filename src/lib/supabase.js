import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!url || url === 'paste_your_project_url_here') {
  console.error('⚠️  Missing VITE_SUPABASE_URL in .env file')
}

export const supabase = createClient(url, key)
