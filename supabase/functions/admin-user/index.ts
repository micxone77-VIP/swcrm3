// Supabase Edge Function: admin-user
// Handles: create user, set password, delete user
// Requires service role key (server-side only — never exposed to browser)
// Caller must be authenticated as admin role

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const supabaseUrl     = Deno.env.get('SUPABASE_URL')!
  const serviceRoleKey  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const anonKey         = Deno.env.get('SUPABASE_ANON_KEY')!

  // ── Verify caller is authenticated and is admin ──────────────────────────
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
  }

  const callerClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await callerClient.auth.getUser()
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
  }

  const { data: callerProfile } = await callerClient
    .from('profiles').select('role').eq('id', user.id).single()
  if (callerProfile?.role !== 'admin') {
    return new Response(JSON.stringify({ error: 'Forbidden — admin only' }), { status: 403, headers: corsHeaders })
  }

  // ── Admin client with service role ───────────────────────────────────────
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  let body: Record<string, unknown>
  try { body = await req.json() } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders })
  }

  const { action } = body

  // ── CREATE USER ──────────────────────────────────────────────────────────
  if (action === 'create') {
    const { username, password, full_name, role, permissions } = body as {
      username: string; password: string; full_name: string; role: string; permissions: string[]
    }
    if (!username || !password || !full_name) {
      return new Response(JSON.stringify({ error: 'username, password and full_name are required' }), { status: 400, headers: corsHeaders })
    }

    const fakeEmail = `${username.toLowerCase()}@swcrm.internal`

    // Check username not already taken
    const { data: existing } = await admin
      .from('profiles').select('id').eq('username', username.toLowerCase()).maybeSingle()
    if (existing) {
      return new Response(JSON.stringify({ error: `Username "${username}" is already taken` }), { status: 409, headers: corsHeaders })
    }

    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email:         fakeEmail,
      password,
      email_confirm: true,
      user_metadata: { full_name, role: role || 'host' },
    })
    if (authErr) {
      return new Response(JSON.stringify({ error: authErr.message }), { status: 400, headers: corsHeaders })
    }

    const { error: profileErr } = await admin.from('profiles').upsert({
      id:                   authData.user.id,
      email:                fakeEmail,
      username:             username.toLowerCase(),
      full_name,
      role:                 role || 'host',
      permissions:          permissions || [],
      must_change_password: true,
      is_active:            true,
      created_at:           new Date().toISOString(),
    }, { onConflict: 'id' })

    if (profileErr) {
      return new Response(JSON.stringify({ error: 'Auth user created but profile failed: ' + profileErr.message }), { status: 500, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ ok: true, id: authData.user.id }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── SET PASSWORD ─────────────────────────────────────────────────────────
  if (action === 'set-password') {
    const { user_id, new_password } = body as { user_id: string; new_password: string }
    if (!user_id || !new_password) {
      return new Response(JSON.stringify({ error: 'user_id and new_password are required' }), { status: 400, headers: corsHeaders })
    }

    const { error: pwErr } = await admin.auth.admin.updateUserById(user_id, { password: new_password })
    if (pwErr) {
      return new Response(JSON.stringify({ error: pwErr.message }), { status: 400, headers: corsHeaders })
    }

    // Clear must_change_password flag when admin explicitly sets a new password
    await admin.from('profiles').update({ must_change_password: false }).eq('id', user_id)

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  // ── DELETE USER ──────────────────────────────────────────────────────────
  if (action === 'delete') {
    const { user_id } = body as { user_id: string }
    if (!user_id) {
      return new Response(JSON.stringify({ error: 'user_id is required' }), { status: 400, headers: corsHeaders })
    }

    await admin.from('profiles').update({ is_active: false }).eq('id', user_id)
    const { error: delErr } = await admin.auth.admin.deleteUser(user_id)
    if (delErr) {
      return new Response(JSON.stringify({ error: delErr.message }), { status: 400, headers: corsHeaders })
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: corsHeaders })
})
