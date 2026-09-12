// src/pages/LuckySpinAdmin.jsx
import { useState, useEffect, useCallback } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../hooks/useAuth'

const STATUS_COLORS = {
  pending:    { bg: '#FF8C0022', color: '#FF8C00', label: 'Pending' },
  processing: { bg: '#3B82F622', color: '#3B82F6', label: 'Processing' },
  completed:  { bg: '#22C55E22', color: '#22C55E', label: 'Completed' },
  cancelled:  { bg: '#EF444422', color: '#EF4444', label: 'Cancelled' },
}
const PRIZE_TYPE_COLORS = {
  cash:     { bg: '#FF6B0022', color: '#FF6B00' },
  cashback: { bg: '#8B5CF622', color: '#8B5CF6' },
  physical: { bg: '#22C55E22', color: '#22C55E' },
  voucher:  { bg: '#F59E0B22', color: '#F59E0B' },
}
const ALL_TIERS = ['gold', 'platinum', 'diamond', 'vip']

const BLANK_CAMPAIGN = {
  name: '', description: '', status: 'active',
  start_date: '', end_date: '',
  spin_interval: 'once', max_spins_per_day: 1,
  allowed_tiers: [],
}

const BLANK_PRIZE = {
  name_zh: '', name_en: '', name_bm: '',
  prize_type: 'cash', prize_value: '', probability: 1,
  stock: -1, turnover_multiplier: 0, color: '#FF6B00', is_active: true,
}

const BLANK_WHEEL = {
  // Text & Language
  title_zh: '', title_en: '', title_bm: '',
  subtitle_zh: '', subtitle_en: '', subtitle_bm: '',
  btn_zh: '立即抽奖', btn_en: 'SPIN NOW', btn_bm: 'PUSING SEKARANG',
  center_zh: '旋转', center_en: 'SPIN', center_bm: 'PUSING',
  segments: 8,
  default_lang: 'en',
  bottom_tagline: 'EXCLUSIVE FOR VIP MEMBERS',
  win_instruction_zh: '', win_instruction_en: '', win_instruction_bm: '',
  // Contact
  telegram_url: '', telegram_label: 'Telegram',
  whatsapp_url: '', whatsapp_label: 'WhatsApp',
  // Images
  bg_image: '', wheel_frame: '', win_banner: '', win_bg: '',
  // Layout
  wheel_x: 50.4, wheel_y: 48.2,
  wheel_diameter: 70, center_btn_size: 28, center_hole: 0,
  subtitle_height: 22, subtitle_width: 63,
  input_y: 76, input_height: 5.5, input_width: 67.5,
  btn_y: 79.6, btn_height: 7.5,
  poster_ratio: '', overall_size: 100, offset_x: 0, offset_y: 0,
  prize_position: 68,
  win_prize_name_pos: 26, win_prize_y: 53,
  show_subtitle: true, bottom_brand: true,
  // Colors
  color_text_large: '#d4a843', color_text_small: '#d4a843',
  color_segment: '#1a0a00', segment_opacity: 100,
  divider_color: '#d4a843', color_gold: '#d4a843', color_blue: '#3B82F6',
  // Effects
  fx_fog: true, fx_diamond_ring: true, fx_bg_diamonds: true,
  fx_ring_flash: true, fx_prize_glow: true, fx_btn_flow: false,
  input_style: 'minimal_gold',
  skin_mode: 'bg_image', skin_width: 480,
  wheel_top: 0, input_margin: 0,
  theme: 'dark_gold',
  show_crown: true, show_pointer: true, show_dividers: true,
  icon_size: 150, font_weight: 'extra_bold',
  scroll_mode: false, prefill_username: false,
  win_page_style: 'full_bg',
  center_style: 'transparent_frame',
}

function Modal({ title, onClose, children, wide }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', zIndex: 999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 28, width: '100%', maxWidth: wide ? 720 : 540, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: 'var(--text)' }}>{title}</h2>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--muted)', fontSize: 18, cursor: 'pointer', lineHeight: 1 }}>✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children, hint }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase', letterSpacing: '.05em' }}>{label}</div>
      {children}
      {hint && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{hint}</div>}
    </div>
  )
}

const inp = { background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 7, padding: '8px 12px', fontSize: 13, width: '100%', boxSizing: 'border-box' }

function WSection({ title, children, emoji }) {
  return (
    <div style={{ marginBottom: 20, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
      <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(255,107,0,0.06)', fontWeight: 700, fontSize: 13, color: 'var(--text)' }}>{emoji} {title}</div>
      <div style={{ padding: '16px 16px 4px' }}>{children}</div>
    </div>
  )
}

function Toggle({ value, onChange, label }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', marginBottom: 10 }}>
      <div onClick={() => onChange(!value)} style={{ width: 38, height: 22, borderRadius: 11, background: value ? 'var(--brand)' : 'var(--border)', position: 'relative', transition: 'background 0.2s', flexShrink: 0 }}>
        <div style={{ width: 16, height: 16, borderRadius: 8, background: '#fff', position: 'absolute', top: 3, left: value ? 19 : 3, transition: 'left 0.2s' }} />
      </div>
      <span style={{ fontSize: 13, color: 'var(--text)' }}>{label}</span>
    </label>
  )
}

// ── Campaign form fields (shared between Create & Edit) ──────────────────────
function CampaignFormFields({ form, setForm }) {
  return (
    <>
      <Field label="Campaign Name *">
        <input style={inp} placeholder="e.g. VIP Lucky Spin — October 2026" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
      </Field>
      <Field label="Description">
        <textarea style={{ ...inp, minHeight: 60, resize: 'vertical' }} placeholder="Brief description…" value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
      </Field>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Start Date">
          <input type="date" style={inp} value={form.start_date} onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))} />
        </Field>
        <Field label="End Date">
          <input type="date" style={inp} value={form.end_date} onChange={e => setForm(f => ({ ...f, end_date: e.target.value }))} />
        </Field>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <Field label="Spin Interval">
          <select style={inp} value={form.spin_interval} onChange={e => setForm(f => ({ ...f, spin_interval: e.target.value }))}>
            <option value="once">Once (per code)</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
          </select>
        </Field>
        {form.spin_interval === 'daily' && (
          <Field label="Max Spins / Day">
            <input type="number" min="1" style={inp} value={form.max_spins_per_day} onChange={e => setForm(f => ({ ...f, max_spins_per_day: e.target.value }))} />
          </Field>
        )}
      </div>
      <Field label="Status">
        <select style={inp} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="ended">Ended</option>
        </select>
      </Field>
      <Field label="Allowed Tiers (leave empty = all tiers)">
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {ALL_TIERS.map(tier => {
            const checked = form.allowed_tiers.includes(tier)
            return (
              <label key={tier} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', padding: '6px 12px', borderRadius: 7, border: `1px solid ${checked ? 'var(--brand)' : 'var(--border)'}`, background: checked ? 'rgba(255,107,0,0.1)' : 'var(--surface2)', fontSize: 12, fontWeight: checked ? 700 : 400, color: checked ? 'var(--brand)' : 'var(--muted)' }}>
                <input type="checkbox" checked={checked} onChange={e => setForm(f => ({ ...f, allowed_tiers: e.target.checked ? [...f.allowed_tiers, tier] : f.allowed_tiers.filter(t => t !== tier) }))} style={{ display: 'none' }} />
                {tier.charAt(0).toUpperCase() + tier.slice(1)}
              </label>
            )
          })}
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>Selected: {form.allowed_tiers.length === 0 ? 'All tiers' : form.allowed_tiers.join(', ')}</div>
      </Field>
    </>
  )
}

// ── Classify campaign into Active / Upcoming / Ended ─────────────────────────
function classifyCampaign(c) {
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const start = c.start_date ? new Date(c.start_date) : null
  const end   = c.end_date   ? new Date(c.end_date)   : null
  if (c.status === 'ended') return 'ended'
  if (end && end < today) return 'ended'
  if (c.status === 'draft' || (start && start > today)) return 'upcoming'
  return 'active'
}

// ── Date helpers ──────────────────────────────────────────────────────────────
function toDateInput(iso) {
  if (!iso) return ''
  return new Date(iso).toISOString().slice(0, 10)
}

export default function LuckySpinAdmin() {
  const { profile } = useAuth()
  const [tab, setTab] = useState('records')
  const [campaigns, setCampaigns] = useState([])
  const [selectedCampaign, setSelectedCampaign] = useState(null)
  const [records, setRecords] = useState([])
  const [codes, setCodes] = useState([])
  const [prizes, setPrizes] = useState([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [searchMember, setSearchMember] = useState('')
  const [updatingId, setUpdatingId] = useState(null)
  const [newCodeMember, setNewCodeMember] = useState('')
  const [newCodeMaxUses, setNewCodeMaxUses] = useState(1)
  const [codeMode, setCodeMode] = useState('auto')   // 'auto' | 'manual'
  const [manualCode, setManualCode] = useState('')
  const [generatingCode, setGeneratingCode] = useState(false)
  const [codeMsg, setCodeMsg] = useState('')
  const [note, setNote] = useState({})
  const [editNote, setEditNote] = useState(null)

  // Manual Record
  const [showManualRecord, setShowManualRecord] = useState(false)
  const [manualRecord, setManualRecord] = useState({ member_username: '', prize_id: '', code_used: '', status: 'pending', note: '' })
  const [addingRecord, setAddingRecord] = useState(false)
  const [recordMsg, setRecordMsg] = useState('')

  // Chase List / Members
  const [members, setMembers] = useState([])
  const [deposits, setDeposits] = useState([])   // all deposits for this campaign
  const [memberSearch, setMemberSearch] = useState('')
  const [newMemberUsername, setNewMemberUsername] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [memberMsg, setMemberMsg] = useState('')
  const [expandedMember, setExpandedMember] = useState(null)   // username of expanded row
  const [depositForm, setDepositForm] = useState({ date: new Date().toISOString().slice(0,10), amount: '', note: '' })
  const [addingDeposit, setAddingDeposit] = useState(false)
  const SPIN_TIERS = [
    { min: 40000, spins: 4 },
    { min: 25000, spins: 3 },
    { min: 15000, spins: 2 },
    { min: 5000,  spins: 1 },
    { min: 0,     spins: 0 },
  ]
  const getEarnedSpins = (total) => (SPIN_TIERS.find(t => total >= t.min) || { spins: 0 }).spins

  // Campaign tab: active | upcoming | ended
  const [campaignTab, setCampaignTab] = useState('active')

  // Create Campaign
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [createForm, setCreateForm] = useState(BLANK_CAMPAIGN)
  const [creating, setCreating] = useState(false)

  // Edit Campaign
  const [showEditModal, setShowEditModal] = useState(false)
  const [editCampaignForm, setEditCampaignForm] = useState(BLANK_CAMPAIGN)
  const [editingCampaign, setEditingCampaign] = useState(false)

  // Delete Campaign
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Prize editing
  const [editingPrize, setEditingPrize] = useState(null)
  const [prizeEdits, setPrizeEdits] = useState({})
  const [savingPrize, setSavingPrize] = useState(false)
  const [showAddPrize, setShowAddPrize] = useState(false)
  const [addPrizeForm, setAddPrizeForm] = useState(BLANK_PRIZE)
  const [addingPrize, setAddingPrize] = useState(false)

  // Wheel Settings
  const [ws, setWs] = useState(BLANK_WHEEL)
  const [savingWs, setSavingWs] = useState(false)
  const [wsSaveMsg, setWsSaveMsg] = useState('')

  // Deposit Milestones
  const [milestones, setMilestones] = useState([])
  const [savingMilestones, setSavingMilestones] = useState(false)
  const [milestoneSaveMsg, setMilestoneSaveMsg] = useState('')
  const [milestonePreview, setMilestonePreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [generatingCodes, setGeneratingCodes] = useState(false)
  const [selectedAllocUsernames, setSelectedAllocUsernames] = useState(new Set())
  // Exclusion list
  const [excludedUsernames, setExcludedUsernames] = useState([])
  const [exclusionInput, setExclusionInput] = useState('')
  const [savingExclusions, setSavingExclusions] = useState(false)
  const [exclusionSaveMsg, setExclusionSaveMsg] = useState('')

  useEffect(() => {
    supabase
      .from('vip_campaigns')
      .select('*')
      .eq('type', 'lucky_spin')
      .order('created_at', { ascending: false })
      .then(({ data }) => {
        if (data?.length) { setCampaigns(data); setSelectedCampaign(data[0]) }
        setLoading(false)
      })
  }, [])

  // When campaignTab changes, auto-select first campaign in that tab
  useEffect(() => {
    const inTab = campaigns.filter(c => classifyCampaign(c) === campaignTab)
    if (inTab.length && (!selectedCampaign || classifyCampaign(selectedCampaign) !== campaignTab)) {
      setSelectedCampaign(inTab[0])
    } else if (inTab.length === 0) {
      setSelectedCampaign(null)
    }
  }, [campaignTab, campaigns])

  // Load wheel_settings when campaign changes
  useEffect(() => {
    if (selectedCampaign) {
      setWs({ ...BLANK_WHEEL, ...(selectedCampaign.wheel_settings || {}) })
    }
  }, [selectedCampaign])

  // Load deposit_milestones when campaign changes
  useEffect(() => {
    if (selectedCampaign) {
      const ms = selectedCampaign.deposit_milestones
      setMilestones(Array.isArray(ms) && ms.length > 0 ? ms : [
        { threshold: 5000,  spins: 1 },
        { threshold: 15000, spins: 1 },
        { threshold: 25000, spins: 1 },
        { threshold: 40000, spins: 1 },
      ])
      setMilestonePreview(null)
      const ex = selectedCampaign.excluded_usernames
      const exArr = Array.isArray(ex) ? ex : []
      setExcludedUsernames(exArr)
      setExclusionInput(exArr.join('\n'))
    }
  }, [selectedCampaign])

  const loadRecords = useCallback(async () => {
    if (!selectedCampaign) return
    const { data } = await supabase.from('vip_campaign_records').select('*').eq('campaign_id', selectedCampaign.id).order('created_at', { ascending: false })
    setRecords(data || [])
  }, [selectedCampaign])

  const loadCodes = useCallback(async () => {
    if (!selectedCampaign) return
    const { data } = await supabase.from('vip_campaign_codes').select('*').eq('campaign_id', selectedCampaign.id).order('created_at', { ascending: false })
    setCodes(data || [])
  }, [selectedCampaign])

  const loadPrizes = useCallback(async () => {
    if (!selectedCampaign) return
    const { data } = await supabase.from('vip_campaign_prizes').select('*').eq('campaign_id', selectedCampaign.id).order('sort_order')
    setPrizes(data || [])
  }, [selectedCampaign])

  const loadMembers = useCallback(async () => {
    if (!selectedCampaign) return
    const { data } = await supabase.from('vip_campaign_members').select('*').eq('campaign_id', selectedCampaign.id).order('enrolled_at', { ascending: false })
    setMembers(data || [])
  }, [selectedCampaign])

  const loadDeposits = useCallback(async () => {
    if (!selectedCampaign) return
    const { data } = await supabase.from('vip_campaign_deposits').select('*').eq('campaign_id', selectedCampaign.id).order('deposit_date', { ascending: false })
    setDeposits(data || [])
  }, [selectedCampaign])

  useEffect(() => {
    if (!selectedCampaign) return
    loadRecords(); loadCodes(); loadPrizes(); loadMembers(); loadDeposits()
  }, [selectedCampaign, loadRecords, loadCodes, loadPrizes, loadMembers, loadDeposits])

  async function updateStatus(recordId, newStatus) {
    setUpdatingId(recordId)
    const { error } = await supabase.from('vip_campaign_records').update({ status: newStatus, handler: profile?.full_name || profile?.username || 'admin' }).eq('id', recordId)
    if (!error) setRecords(r => r.map(rec => rec.id === recordId ? { ...rec, status: newStatus } : rec))
    setUpdatingId(null)
  }

  async function saveNote(recordId) {
    const text = note[recordId] || ''
    const { error } = await supabase.from('vip_campaign_records').update({ note: text }).eq('id', recordId)
    if (!error) { setRecords(r => r.map(rec => rec.id === recordId ? { ...rec, note: text } : rec)); setEditNote(null) }
  }

  async function addManualRecord() {
    if (!selectedCampaign) return
    if (!manualRecord.member_username.trim()) { setRecordMsg('❌ Member username is required.'); return }
    if (!manualRecord.prize_id) { setRecordMsg('❌ Please select a prize.'); return }
    setAddingRecord(true)
    setRecordMsg('')
    const prize = prizes.find(p => p.id === manualRecord.prize_id)
    const payload = {
      campaign_id: selectedCampaign.id,
      member_username: manualRecord.member_username.trim(),
      prize_id: prize?.id || null,
      prize_snapshot: prize ? {
        name_en: prize.name_en || '',
        name_zh: prize.name_zh || '',
        name_bm: prize.name_bm || '',
        prize_type: prize.prize_type || '',
        prize_value: prize.prize_value || '',
      } : null,
      code_used: manualRecord.code_used.trim() || null,
      status: manualRecord.status,
      note: manualRecord.note.trim() || null,
      handler: profile?.full_name || profile?.username || 'admin',
      created_at: new Date().toISOString(),
    }
    const { error } = await supabase.from('vip_campaign_records').insert(payload)
    if (!error) {
      // If a code was provided and spin is not cancelled → increment used_count on that code
      const codeStr = manualRecord.code_used.trim().toUpperCase()
      if (codeStr && manualRecord.status !== 'cancelled') {
        const { data: codeRow } = await supabase
          .from('vip_campaign_codes')
          .select('id, used_count')
          .eq('campaign_id', selectedCampaign.id)
          .eq('code', codeStr)
          .maybeSingle()
        if (codeRow) {
          await supabase
            .from('vip_campaign_codes')
            .update({ used_count: (codeRow.used_count || 0) + 1 })
            .eq('id', codeRow.id)
        }
      }
      setRecordMsg('✅ Record added!')
      setManualRecord({ member_username: '', prize_id: '', code_used: '', status: 'pending', note: '' })
      loadRecords()
      loadCodes()
      setTimeout(() => { setRecordMsg(''); setShowManualRecord(false) }, 1500)
    } else {
      setRecordMsg('❌ ' + error.message)
    }
    setAddingRecord(false)
  }

  async function generateCode() {
    if (!selectedCampaign) return
    setGeneratingCode(true)
    setCodeMsg('')

    // Determine code string
    let code
    if (codeMode === 'manual') {
      code = manualCode.trim().toUpperCase()
      if (!code) { setCodeMsg('❌ Please enter a code.'); setGeneratingCode(false); return }
    } else {
      code = 'SPIN-' + Math.random().toString(36).substring(2, 8).toUpperCase()
    }

    // Check duplicate
    const { data: existing } = await supabase
      .from('vip_campaign_codes')
      .select('id')
      .eq('campaign_id', selectedCampaign.id)
      .eq('code', code)
    if (existing && existing.length > 0) {
      setCodeMsg(`❌ Code "${code}" already exists in this campaign.`)
      setGeneratingCode(false)
      return
    }

    const { error } = await supabase.from('vip_campaign_codes').insert({
      campaign_id: selectedCampaign.id,
      code,
      member_username: newCodeMember.trim() || null,
      max_uses: Number(newCodeMaxUses) || 1,
      created_by: profile?.full_name || 'admin',
    })

    if (!error) {
      setCodeMsg(`✅ Code "${code}" added!`)
      setNewCodeMember('')
      setManualCode('')
      setNewCodeMaxUses(1)
      loadCodes()
      setTimeout(() => setCodeMsg(''), 4000)
    } else {
      setCodeMsg('❌ ' + error.message)
    }
    setGeneratingCode(false)
  }

  async function deleteCode(id) {
    await supabase.from('vip_campaign_codes').delete().eq('id', id)
    setCodes(c => c.filter(x => x.id !== id))
  }

  async function togglePrize(prizeId, isActive) {
    await supabase.from('vip_campaign_prizes').update({ is_active: isActive }).eq('id', prizeId)
    setPrizes(p => p.map(pr => pr.id === prizeId ? { ...pr, is_active: isActive } : pr))
  }

  // ── Create Campaign ──────────────────────────────────────────────────────────
  async function createCampaign() {
    if (!createForm.name) return
    setCreating(true)
    const payload = {
      name: createForm.name,
      description: createForm.description,
      type: 'lucky_spin',
      status: createForm.status,
      start_date: createForm.start_date ? new Date(createForm.start_date).toISOString() : null,
      end_date: createForm.end_date ? new Date(createForm.end_date + 'T23:59:59').toISOString() : null,
      spin_interval: createForm.spin_interval,
      max_spins_per_day: createForm.spin_interval === 'daily' ? Number(createForm.max_spins_per_day) : 1,
      allowed_tiers: createForm.allowed_tiers,
      created_by: profile?.full_name || profile?.username || 'admin',
    }
    const { data, error } = await supabase.from('vip_campaigns').insert(payload).select().single()
    if (!error && data) {
      setCampaigns(c => [data, ...c])
      setSelectedCampaign(data)
      setCampaignTab(classifyCampaign(data))
      setShowCreateModal(false)
      setCreateForm(BLANK_CAMPAIGN)
    }
    setCreating(false)
  }

  // ── Edit Campaign ────────────────────────────────────────────────────────────
  function openEditModal() {
    if (!selectedCampaign) return
    setEditCampaignForm({
      name: selectedCampaign.name || '',
      description: selectedCampaign.description || '',
      status: selectedCampaign.status || 'active',
      start_date: toDateInput(selectedCampaign.start_date),
      end_date: toDateInput(selectedCampaign.end_date),
      spin_interval: selectedCampaign.spin_interval || 'once',
      max_spins_per_day: selectedCampaign.max_spins_per_day || 1,
      allowed_tiers: selectedCampaign.allowed_tiers || [],
    })
    setShowEditModal(true)
  }

  async function saveCampaignEdit() {
    if (!selectedCampaign || !editCampaignForm.name) return
    setEditingCampaign(true)
    const payload = {
      name: editCampaignForm.name,
      description: editCampaignForm.description,
      status: editCampaignForm.status,
      start_date: editCampaignForm.start_date ? new Date(editCampaignForm.start_date).toISOString() : null,
      end_date: editCampaignForm.end_date ? new Date(editCampaignForm.end_date + 'T23:59:59').toISOString() : null,
      spin_interval: editCampaignForm.spin_interval,
      max_spins_per_day: editCampaignForm.spin_interval === 'daily' ? Number(editCampaignForm.max_spins_per_day) : 1,
      allowed_tiers: editCampaignForm.allowed_tiers,
    }
    const { data, error } = await supabase.from('vip_campaigns').update(payload).eq('id', selectedCampaign.id).select().single()
    if (!error && data) {
      setCampaigns(c => c.map(x => x.id === data.id ? data : x))
      setSelectedCampaign(data)
      setCampaignTab(classifyCampaign(data))
      setShowEditModal(false)
    }
    setEditingCampaign(false)
  }

  // ── Delete Campaign ──────────────────────────────────────────────────────────
  async function deleteCampaign() {
    if (!selectedCampaign) return
    setDeleting(true)
    const { error } = await supabase.from('vip_campaigns').delete().eq('id', selectedCampaign.id)
    if (!error) {
      const remaining = campaigns.filter(c => c.id !== selectedCampaign.id)
      setCampaigns(remaining)
      const inTab = remaining.filter(c => classifyCampaign(c) === campaignTab)
      setSelectedCampaign(inTab[0] || remaining[0] || null)
      setShowDeleteConfirm(false)
    }
    setDeleting(false)
  }

  // ── Edit Prize ───────────────────────────────────────────────────────────────
  function startEditPrize(p) {
    setEditingPrize(p.id)
    setPrizeEdits({ probability: p.probability, prize_value: p.prize_value, stock: p.stock, turnover_multiplier: p.turnover_multiplier, name_en: p.name_en })
  }

  async function savePrize(prizeId) {
    setSavingPrize(true)
    const updates = {
      probability: Number(prizeEdits.probability),
      prize_value: prizeEdits.prize_value,
      stock: Number(prizeEdits.stock),
      turnover_multiplier: Number(prizeEdits.turnover_multiplier),
      name_en: prizeEdits.name_en,
    }
    const { error } = await supabase.from('vip_campaign_prizes').update(updates).eq('id', prizeId)
    if (!error) {
      setPrizes(p => p.map(pr => pr.id === prizeId ? { ...pr, ...updates } : pr))
      setEditingPrize(null)
    }
    setSavingPrize(false)
  }

  // ── Add Prize ────────────────────────────────────────────────────────────────
  async function addPrize() {
    if (!selectedCampaign || !addPrizeForm.name_en) return
    setAddingPrize(true)
    const maxOrder = prizes.reduce((m, p) => Math.max(m, p.sort_order || 0), 0)
    const payload = { ...addPrizeForm, campaign_id: selectedCampaign.id, sort_order: maxOrder + 1, probability: Number(addPrizeForm.probability), stock: Number(addPrizeForm.stock), turnover_multiplier: Number(addPrizeForm.turnover_multiplier) }
    const { data, error } = await supabase.from('vip_campaign_prizes').insert(payload).select().single()
    if (!error && data) { setPrizes(p => [...p, data]); setShowAddPrize(false); setAddPrizeForm(BLANK_PRIZE) }
    setAddingPrize(false)
  }

  // ── Upload Wheel Image to Supabase Storage ───────────────────────────────────
  async function uploadWheelImage(field, file) {
    if (!file || !selectedCampaign) return
    const ext = file.name.split('.').pop().toLowerCase()
    const path = `campaigns/${selectedCampaign.id}/${field}_${Date.now()}.${ext}`
    const { error: upErr } = await supabase.storage.from('lucky-spin-assets').upload(path, file, { upsert: true })
    if (upErr) { alert('Upload failed: ' + upErr.message); return }
    const { data } = supabase.storage.from('lucky-spin-assets').getPublicUrl(path)
    setWs(w => ({ ...w, [field]: data.publicUrl }))
  }

  // ── Save Wheel Settings ──────────────────────────────────────────────────────
  async function saveWheelSettings() {
    if (!selectedCampaign) return
    setSavingWs(true)
    setWsSaveMsg('')
    const { error } = await supabase.from('vip_campaigns').update({ wheel_settings: ws }).eq('id', selectedCampaign.id)
    if (!error) {
      setCampaigns(c => c.map(x => x.id === selectedCampaign.id ? { ...x, wheel_settings: ws } : x))
      setSelectedCampaign(prev => ({ ...prev, wheel_settings: ws }))
      setWsSaveMsg('✅ Saved!')
      setTimeout(() => setWsSaveMsg(''), 3000)
    } else {
      setWsSaveMsg('❌ Save failed: ' + error.message)
    }
    setSavingWs(false)
  }

  // ── Deposit Milestone Functions ──────────────────────────────────────────────
  async function saveMilestones() {
    if (!selectedCampaign) return
    setSavingMilestones(true)
    setMilestoneSaveMsg('')
    const sorted = [...milestones].sort((a, b) => a.threshold - b.threshold)
    const { error } = await supabase.from('vip_campaigns').update({ deposit_milestones: sorted }).eq('id', selectedCampaign.id)
    if (!error) {
      setCampaigns(c => c.map(x => x.id === selectedCampaign.id ? { ...x, deposit_milestones: sorted } : x))
      setSelectedCampaign(prev => ({ ...prev, deposit_milestones: sorted }))
      setMilestones(sorted)
      setMilestoneSaveMsg('✅ Milestones saved!')
      setTimeout(() => setMilestoneSaveMsg(''), 3000)
    } else {
      setMilestoneSaveMsg('❌ Save failed: ' + error.message)
    }
    setSavingMilestones(false)
  }

  async function runMilestonePreview() {
    if (!selectedCampaign || milestones.length === 0) return
    const startDate = toDateInput(selectedCampaign.start_date)
    const endDate   = toDateInput(selectedCampaign.end_date) || startDate
    if (!startDate) { alert('Campaign has no start date.'); return }
    setLoadingPreview(true)
    setMilestonePreview(null)

    // Fetch all active-day deposit rows for the campaign period
    const PAGE = 1000
    let all = [], from = 0
    while (true) {
      const { data, error } = await supabase
        .from('vip_daily_snapshots')
        .select('username, total_deposit, monthly_valid_bet')
        .gte('snapshot_date', startDate)
        .lte('snapshot_date', endDate)
        .range(from, from + PAGE - 1)
      if (error) { alert('VIP data fetch failed: ' + error.message); setLoadingPreview(false); return }
      all = all.concat((data || []).filter(r => (parseFloat(r.monthly_valid_bet) || 0) > 0))
      if (!data || data.length < PAGE) break
      from += PAGE
    }

    // Sum deposits per player
    const depositMap = {}
    all.forEach(r => {
      depositMap[r.username] = (depositMap[r.username] || 0) + (parseFloat(r.total_deposit) || 0)
    })

    // Tier filter — if campaign has allowed_tiers, fetch player tiers from vip_monthly_totals
    const allowedTiers = selectedCampaign.allowed_tiers || []
    let tierMap = {}
    if (allowedTiers.length > 0) {
      const monthStr = startDate.slice(0, 7)
      const { data: tierRows } = await supabase
        .from('vip_monthly_totals')
        .select('username, tier')
        .ilike('snapshot_month', monthStr + '%')
      ;(tierRows || []).forEach(r => { tierMap[r.username] = r.tier })
    }

    // Count existing codes per player for this campaign
    const { data: existingCodes } = await supabase
      .from('vip_campaign_codes')
      .select('member_username')
      .eq('campaign_id', selectedCampaign.id)
    const codeCountMap = {}
    ;(existingCodes || []).forEach(c => {
      if (c.member_username) codeCountMap[c.member_username] = (codeCountMap[c.member_username] || 0) + 1
    })

    // Build exclusion set (lowercase)
    const exSet = new Set((selectedCampaign.excluded_usernames || []).map(u => u.toLowerCase()))

    // Calculate spins earned per player based on milestones
    const sortedMs = [...milestones].sort((a, b) => a.threshold - b.threshold)
    const preview = Object.entries(depositMap)
      .map(([username, totalDeposit]) => {
        const spinsEarned = sortedMs.reduce((sum, m) => totalDeposit >= (m.threshold || 0) ? sum + (m.spins || 1) : sum, 0)
        const codesExisting = codeCountMap[username] || 0
        const excluded = exSet.has(username.toLowerCase())
        const playerTier = tierMap[username] || null
        const tierBlocked = allowedTiers.length > 0 && (!playerTier || !allowedTiers.includes(playerTier))
        return { username, totalDeposit, spinsEarned, codesExisting, excluded, tierBlocked, playerTier }
      })
      .filter(p => p.spinsEarned > 0)
      .sort((a, b) => {
        const aBlocked = a.excluded || a.tierBlocked ? 1 : 0
        const bBlocked = b.excluded || b.tierBlocked ? 1 : 0
        if (aBlocked !== bBlocked) return aBlocked - bBlocked
        return b.totalDeposit - a.totalDeposit
      })

    setMilestonePreview(preview)
    // Pre-select players who still need codes (excluding blocked)
    setSelectedAllocUsernames(new Set(
      preview.filter(p => !p.excluded && !p.tierBlocked && p.codesExisting < p.spinsEarned).map(p => p.username)
    ))
    setLoadingPreview(false)
  }

  async function generateMilestoneCodes() {
    if (!selectedCampaign || !milestonePreview) return
    const toGenerate = milestonePreview.filter(p => selectedAllocUsernames.has(p.username) && !p.excluded && !p.tierBlocked)
    if (toGenerate.length === 0) { alert('No eligible players selected.'); return }
    const totalCodes = toGenerate.reduce((s, p) => s + Math.max(0, p.spinsEarned - p.codesExisting), 0)
    if (!window.confirm(`Generate ${totalCodes} spin code${totalCodes !== 1 ? 's' : ''} for ${toGenerate.length} player${toGenerate.length !== 1 ? 's' : ''}?\n\nPlayers already with enough codes will be skipped.`)) return
    setGeneratingCodes(true)
    const inserts = []
    for (const p of toGenerate) {
      const needed = Math.max(0, p.spinsEarned - p.codesExisting)
      for (let i = 0; i < needed; i++) {
        const code = 'SPIN-' + Math.random().toString(36).substring(2, 8).toUpperCase()
        inserts.push({ campaign_id: selectedCampaign.id, code, member_username: p.username, max_uses: 1, created_by: profile?.full_name || 'admin' })
      }
    }
    if (inserts.length === 0) { alert('All selected players already have their codes.'); setGeneratingCodes(false); return }
    const { error } = await supabase.from('vip_campaign_codes').insert(inserts)
    if (error) { alert('Failed to generate codes: ' + error.message); setGeneratingCodes(false); return }
    await loadCodes()
    await runMilestonePreview()
    setGeneratingCodes(false)
    alert(`✅ Generated ${inserts.length} spin code${inserts.length !== 1 ? 's' : ''} successfully.`)
  }

  async function saveExclusions() {
    if (!selectedCampaign) return
    setSavingExclusions(true)
    setExclusionSaveMsg('')
    const parsed = exclusionInput.split(/[\n,]+/).map(u => u.trim().toLowerCase()).filter(Boolean)
    const unique  = [...new Set(parsed)]
    const { error } = await supabase.from('vip_campaigns').update({ excluded_usernames: unique }).eq('id', selectedCampaign.id)
    if (!error) {
      setCampaigns(c => c.map(x => x.id === selectedCampaign.id ? { ...x, excluded_usernames: unique } : x))
      setSelectedCampaign(prev => ({ ...prev, excluded_usernames: unique }))
      setExcludedUsernames(unique)
      setExclusionInput(unique.join('\n'))
      setExclusionSaveMsg('✅ Saved!')
      setTimeout(() => setExclusionSaveMsg(''), 3000)
    } else {
      setExclusionSaveMsg('❌ ' + error.message)
    }
    setSavingExclusions(false)
  }

  // ── ROI Calculations ─────────────────────────────────────────────────────────
  function calcROI() {
    const totalWeight = prizes.filter(p => p.is_active).reduce((s, p) => s + (p.probability || 0), 0)
    const totalSpins = records.length
    const completed = records.filter(r => r.status === 'completed').length
    const totalCost = prizes.reduce((sum, p) => {
      if (!p.is_active || p.prize_type !== 'cash') return sum
      const val = parseFloat(p.prize_value) || 0
      const prob = totalWeight > 0 ? (p.probability / totalWeight) : 0
      return sum + (val * prob * completed)
    }, 0)
    const estTurnover = prizes.reduce((sum, p) => {
      if (!p.is_active) return sum
      const val = parseFloat(p.prize_value) || 0
      const prob = totalWeight > 0 ? (p.probability / totalWeight) : 0
      const tm = p.turnover_multiplier || 0
      return sum + (val * prob * completed * tm)
    }, 0)
    return { totalSpins, completed, totalCost: Math.round(totalCost), estTurnover: Math.round(estTurnover), totalWeight }
  }

  // ── Derived data ─────────────────────────────────────────────────────────────
  const tabCounts = {
    active:   campaigns.filter(c => classifyCampaign(c) === 'active').length,
    upcoming: campaigns.filter(c => classifyCampaign(c) === 'upcoming').length,
    ended:    campaigns.filter(c => classifyCampaign(c) === 'ended').length,
  }
  const tabCampaigns = campaigns.filter(c => classifyCampaign(c) === campaignTab)

  const filteredRecords = records.filter(r => {
    const matchStatus = statusFilter === 'all' || r.status === statusFilter
    const matchMember = !searchMember || (r.member_username || '').toLowerCase().includes(searchMember.toLowerCase())
    return matchStatus && matchMember
  })

  if (loading) return <div style={{ padding: 40, color: 'var(--muted)' }}>Loading…</div>

  const TAB_BTN = (key, label) => {
    const active = tab === key
    return (
      <button key={key} onClick={() => setTab(key)} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: active ? 'var(--brand)' : 'transparent', color: active ? '#fff' : 'var(--muted)', fontWeight: active ? 700 : 400, fontSize: 13, cursor: 'pointer' }}>
        {label}
      </button>
    )
  }

  const roi = calcROI()

  return (
    <div style={{ padding: 24, maxWidth: 1100, margin: '0 auto' }}>

      {/* ── Header ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text)' }}>🎰 Lucky Spin Admin</h1>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 3 }}>Manage spin campaigns, prizes, codes & winner records</div>
        </div>
        <button onClick={() => { setCreateForm(BLANK_CAMPAIGN); setShowCreateModal(true) }} style={{ padding: '10px 20px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: 'pointer' }}>
          + New Campaign
        </button>
      </div>

      {/* ── Campaign Tabs: Active / Upcoming / Ended ── */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, background: 'var(--surface)', borderRadius: 10, padding: 4, width: 'fit-content', border: '1px solid var(--border)' }}>
        {[['active','🟢 Active'], ['upcoming','🔵 Upcoming'], ['ended','⚫ Ended']].map(([key, label]) => {
          const isActive = campaignTab === key
          return (
            <button key={key} onClick={() => setCampaignTab(key)} style={{ padding: '7px 16px', borderRadius: 7, border: 'none', background: isActive ? 'var(--brand)' : 'transparent', color: isActive ? '#fff' : 'var(--muted)', fontWeight: isActive ? 700 : 400, fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
              {label}
              <span style={{ background: isActive ? 'rgba(255,255,255,0.25)' : 'var(--surface2)', borderRadius: 10, padding: '1px 7px', fontSize: 11, fontWeight: 700 }}>{tabCounts[key]}</span>
            </button>
          )
        })}
      </div>

      {/* ── Campaign Selector ── */}
      {tabCampaigns.length > 0 ? (
        <div style={{ marginBottom: 16 }}>
          <select
            value={selectedCampaign?.id || ''}
            onChange={e => setSelectedCampaign(tabCampaigns.find(c => c.id === e.target.value) || null)}
            style={{ ...inp, maxWidth: 420, fontWeight: 600 }}
          >
            {tabCampaigns.map(c => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
      ) : (
        <div style={{ padding: '20px 0', color: 'var(--muted)', fontSize: 14 }}>
          No {campaignTab} campaigns.{' '}
          <button onClick={() => { setCreateForm(BLANK_CAMPAIGN); setShowCreateModal(true) }} style={{ color: 'var(--brand)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 14 }}>+ Create one</button>
        </div>
      )}

      {/* ── Campaign Info Banner ── */}
      {selectedCampaign && (() => {
        const classify = classifyCampaign(selectedCampaign)
        const classifyColor = classify === 'active' ? '#22C55E' : classify === 'upcoming' ? '#3B82F6' : '#6B7280'
        return (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '14px 20px', marginBottom: 20, display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, fontSize: 15, color: 'var(--text)', marginBottom: 4 }}>{selectedCampaign.name}</div>
              {selectedCampaign.description && <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{selectedCampaign.description}</div>}
              <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', fontSize: 12, color: 'var(--muted)' }}>
                <span>STATUS <strong style={{ color: classifyColor, marginLeft: 4 }}>{classify.toUpperCase()}</strong></span>
                <span>START <strong style={{ color: 'var(--text)', marginLeft: 4 }}>{selectedCampaign.start_date ? new Date(selectedCampaign.start_date).toLocaleDateString('en-MY') : '—'}</strong></span>
                <span>END <strong style={{ color: 'var(--text)', marginLeft: 4 }}>{selectedCampaign.end_date ? new Date(selectedCampaign.end_date).toLocaleDateString('en-MY') : '—'}</strong></span>
                <span>SPIN <strong style={{ color: 'var(--text)', marginLeft: 4 }}>{selectedCampaign.spin_interval || 'once'}{selectedCampaign.spin_interval === 'daily' ? ` · max ${selectedCampaign.max_spins_per_day}/day` : ''}</strong></span>
                <span>TIERS <strong style={{ color: 'var(--text)', marginLeft: 4 }}>{selectedCampaign.allowed_tiers?.length ? selectedCampaign.allowed_tiers.join(', ') : 'All'}</strong></span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
              <button onClick={openEditModal} title="Edit campaign" style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
                ✏ Edit
              </button>
              <button onClick={() => setShowDeleteConfirm(true)} title="Delete campaign" style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid #EF444440', background: '#EF444411', color: '#EF4444', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 5, fontWeight: 600 }}>
                🗑 Delete
              </button>
            </div>
          </div>
        )
      })()}

      {/* ── KPI Tiles ── */}
      {selectedCampaign && (() => {
        const pending    = records.filter(r => r.status === 'pending').length
        const processing = records.filter(r => r.status === 'processing').length
        const completed  = records.filter(r => r.status === 'completed').length
        return (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
            {[
              { label: 'Total Spins', val: records.length, color: 'var(--brand)' },
              { label: 'Pending',     val: pending,        color: '#FF8C00' },
              { label: 'Processing',  val: processing,     color: '#3B82F6' },
              { label: 'Completed',   val: completed,      color: '#22C55E' },
            ].map(({ label, val, color }) => (
              <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px' }}>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 26, fontWeight: 800, color }}>{val}</div>
              </div>
            ))}
          </div>
        )
      })()}

      {/* ── Sub-tabs ── */}
      {selectedCampaign && (
        <>
          <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
            {TAB_BTN('members',    '👥 Members')}
            {TAB_BTN('records',    '📋 Records')}
            {TAB_BTN('codes',      '🔑 Codes')}
            {TAB_BTN('prizes',     '🏆 Prizes')}
            {TAB_BTN('milestones', '💰 Milestones')}
            {TAB_BTN('roi',        '📊 ROI')}
            {TAB_BTN('wheel',      '🎡 Wheel Settings')}
          </div>

          {/* MEMBERS / CHASE LIST TAB */}
          {tab === 'members' && (() => {
            const filtered = members.filter(m =>
              !memberSearch || m.member_username.toLowerCase().includes(memberSearch.toLowerCase())
            )
            const todayStr = new Date().toISOString().slice(0, 10)

            // Group deposit rows by date → per-day totals + eligibility
            const getDayGroups = (deps) => {
              const byDate = {}
              deps.forEach(d => {
                if (!byDate[d.deposit_date]) byDate[d.deposit_date] = []
                byDate[d.deposit_date].push(d)
              })
              return Object.keys(byDate).sort().map(date => {
                const rows = byDate[date]
                const dayTotal = rows.reduce((s, r) => s + Number(r.deposit_amount), 0)
                const earnedSpins = getEarnedSpins(dayTotal)
                const isEligible = earnedSpins > 0
                // A day is "claimed" only when ALL its deposit rows are marked claimed
                const isClaimed = isEligible && rows.every(r => r.claim_status === 'claimed')
                const claimDate = rows.find(r => r.claim_date)?.claim_date || null
                const notes = rows.map(r => r.note).filter(Boolean).join('; ')
                return {
                  date,
                  dayTotal,
                  earnedSpins,
                  isEligible,
                  isClaimed,
                  claim_status: isClaimed ? 'claimed' : 'pending',
                  claim_date: claimDate,
                  rowIds: rows.map(r => r.id),
                  notes,
                }
              })
            }

            return (
              <div>
                {/* Enroll new member */}
                <div style={{ display: 'flex', gap: 10, marginBottom: 18, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: 200 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 4 }}>MEMBER USERNAME</div>
                    <input style={inp} placeholder="e.g. august719" value={newMemberUsername} onChange={e => setNewMemberUsername(e.target.value)} />
                  </div>
                  <button disabled={addingMember} onClick={async () => {
                    if (!newMemberUsername.trim()) return
                    setAddingMember(true); setMemberMsg('')
                    const { error } = await supabase.from('vip_campaign_members').insert({
                      campaign_id: selectedCampaign.id,
                      member_username: newMemberUsername.trim(),
                      created_by: profile?.full_name || profile?.username || 'admin',
                    })
                    if (!error) { setNewMemberUsername(''); loadMembers(); setMemberMsg('✅ Member enrolled!') }
                    else setMemberMsg(error.code === '23505' ? '⚠️ Already enrolled.' : '❌ ' + error.message)
                    setAddingMember(false)
                    setTimeout(() => setMemberMsg(''), 3000)
                  }} style={{ padding: '9px 20px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    + Enroll Member
                  </button>
                  <input style={{ ...inp, maxWidth: 200 }} placeholder="Search member…" value={memberSearch} onChange={e => setMemberSearch(e.target.value)} />
                  {memberMsg && <span style={{ fontSize: 13, fontWeight: 600, color: memberMsg.startsWith('✅') ? '#22C55E' : memberMsg.startsWith('⚠️') ? '#FF8C00' : '#EF4444' }}>{memberMsg}</span>}
                </div>

                {/* Tier legend */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center', marginRight: 4 }}>Daily target:</span>
                  {[['RM 5K', '1 spin','#FF8C00'],['RM 15K','2 spins','#3B82F6'],['RM 25K','3 spins','#8B5CF6'],['RM 40K','4 spins','#22C55E']].map(([dep,sp,col]) => (
                    <div key={dep} style={{ padding: '4px 12px', borderRadius: 20, border: `1px solid ${col}44`, background: `${col}15`, fontSize: 11, color: col, fontWeight: 600 }}>
                      {dep} → {sp}
                    </div>
                  ))}
                </div>

                {/* Members list */}
                {filtered.length === 0 ? (
                  <div style={{ padding: 40, textAlign: 'center', color: 'var(--muted)' }}>No members enrolled yet. Add a member above to start tracking.</div>
                ) : filtered.map(m => {
                  const rawDeps = deposits.filter(d => d.member_username === m.member_username)
                  const dayGroups = getDayGroups(rawDeps)

                  // Today's numbers (progress bar tracks TODAY)
                  const todayGroup = dayGroups.find(g => g.date === todayStr)
                  const todayTotal = todayGroup?.dayTotal || 0
                  const todaySpins = todayGroup?.earnedSpins || 0
                  const pct = Math.min(100, todayTotal >= 40000 ? 100 : todayTotal / 400)
                  const nextTier = SPIN_TIERS.slice().reverse().find(t => todayTotal < t.min)
                  const tierColor = todaySpins === 4 ? '#22C55E' : todaySpins === 3 ? '#8B5CF6' : todaySpins === 2 ? '#3B82F6' : todaySpins === 1 ? '#FF8C00' : 'var(--muted)'

                  // All-time totals (across all days)
                  const totalEarnedSpins = dayGroups.reduce((s, g) => s + g.earnedSpins, 0)
                  const eligibleDays = dayGroups.filter(g => g.isEligible)
                  const pendingDays = eligibleDays.filter(g => !g.isClaimed).length
                  const claimedDays = eligibleDays.filter(g => g.isClaimed).length
                  const issuedCodes = codes.filter(c => c.member_username === m.member_username)
                  const issuedSpins = issuedCodes.reduce((s, c) => s + (c.max_uses || 1), 0)
                  const remainingSpins = Math.max(0, totalEarnedSpins - issuedSpins)

                  const isExpanded = expandedMember === m.member_username

                  return (
                    <div key={m.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 10, overflow: 'hidden' }}>
                      {/* Member summary row */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', flexWrap: 'wrap' }}>
                        <div style={{ fontWeight: 700, color: 'var(--text)', minWidth: 110 }}>{m.member_username}</div>

                        {/* TODAY's progress bar */}
                        <div style={{ flex: 1, minWidth: 150 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--muted)', marginBottom: 3 }}>
                            <span style={{ fontWeight: 600, color: todayTotal > 0 ? 'var(--text)' : 'var(--muted)' }}>
                              Today: RM {todayTotal.toLocaleString()}
                            </span>
                            {nextTier
                              ? <span>need RM {(nextTier.min - todayTotal).toLocaleString()} more</span>
                              : todaySpins > 0 ? <span style={{ color: '#22C55E' }}>Max tier reached!</span> : null
                            }
                          </div>
                          <div style={{ height: 6, background: 'var(--surface2)', borderRadius: 3, overflow: 'hidden' }}>
                            <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg,#FF6B00,${tierColor})`, borderRadius: 3, transition: 'width .4s' }} />
                          </div>
                        </div>

                        {/* Today's spin badge */}
                        <div style={{ padding: '4px 12px', borderRadius: 20, background: todaySpins > 0 ? `${tierColor}22` : 'var(--surface2)', color: todaySpins > 0 ? tierColor : 'var(--muted)', fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap', border: `1px solid ${todaySpins > 0 ? tierColor+'44' : 'var(--border)'}` }}>
                          {todaySpins > 0 ? `🎰 ${todaySpins} spin${todaySpins > 1 ? 's' : ''} today` : '📅 No spins today'}
                        </div>

                        {/* All-time claim summary */}
                        {totalEarnedSpins > 0 && (
                          <div style={{ fontSize: 11, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            {claimedDays > 0 && <span style={{ background: '#22C55E22', color: '#22C55E', borderRadius: 5, padding: '2px 8px', fontWeight: 700 }}>✅ {claimedDays}d claimed</span>}
                            {pendingDays > 0 && <span style={{ background: '#FF8C0022', color: '#FF8C00', borderRadius: 5, padding: '2px 8px', fontWeight: 700 }}>⏳ {pendingDays}d pending</span>}
                          </div>
                        )}

                        <div style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                          Issued: <strong style={{ color: 'var(--text)' }}>{issuedSpins}</strong> &nbsp;|&nbsp; Left: <strong style={{ color: remainingSpins > 0 ? '#FF6B00' : 'var(--muted)' }}>{remainingSpins}</strong>
                        </div>

                        <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
                          <button onClick={() => setExpandedMember(isExpanded ? null : m.member_username)} style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}>
                            {isExpanded ? '▲ Hide' : '▼ Deposits'}
                          </button>
                          <button onClick={async () => { if (!window.confirm(`Remove ${m.member_username}?`)) return; await supabase.from('vip_campaign_members').delete().eq('id', m.id); loadMembers() }} style={{ padding: '5px 10px', borderRadius: 7, border: '1px solid #EF444444', background: 'transparent', color: '#EF4444', fontSize: 12, cursor: 'pointer' }}>✕</button>
                        </div>
                      </div>

                      {/* Deposit + Claim sub-panel */}
                      {isExpanded && (
                        <div style={{ borderTop: '1px solid var(--border)', background: 'var(--surface2)', padding: '12px 16px' }}>
                          {/* Add deposit form */}
                          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>DEPOSIT DATE</div>
                              <input type="date" style={{ ...inp, width: 150 }} value={depositForm.date} onChange={e => setDepositForm(f => ({ ...f, date: e.target.value }))} />
                            </div>
                            <div>
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>AMOUNT (RM)</div>
                              <input type="number" style={{ ...inp, width: 130 }} placeholder="e.g. 5000" value={depositForm.amount} onChange={e => setDepositForm(f => ({ ...f, amount: e.target.value }))} />
                            </div>
                            <div style={{ flex: 1, minWidth: 120 }}>
                              <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 3 }}>NOTE (optional)</div>
                              <input style={{ ...inp }} placeholder="e.g. Bank transfer" value={depositForm.note} onChange={e => setDepositForm(f => ({ ...f, note: e.target.value }))} />
                            </div>
                            <button disabled={addingDeposit || !depositForm.amount} onClick={async () => {
                              if (!depositForm.amount || Number(depositForm.amount) <= 0) return
                              setAddingDeposit(true)
                              const { error } = await supabase.from('vip_campaign_deposits').insert({
                                campaign_id: selectedCampaign.id,
                                member_username: m.member_username,
                                deposit_date: depositForm.date,
                                deposit_amount: Number(depositForm.amount),
                                note: depositForm.note.trim() || null,
                                created_by: profile?.full_name || profile?.username || 'admin',
                              })
                              if (!error) { setDepositForm(f => ({ ...f, amount: '', note: '' })); loadDeposits() }
                              setAddingDeposit(false)
                            }} style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontWeight: 700, fontSize: 12, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                              + Add Deposit
                            </button>
                          </div>

                          {/* Per-day table */}
                          {dayGroups.length === 0 ? (
                            <div style={{ fontSize: 12, color: 'var(--muted)', padding: '8px 0' }}>No deposits recorded yet.</div>
                          ) : (
                            <div style={{ overflowX: 'auto' }}>
                              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                                <thead>
                                  <tr style={{ background: 'var(--surface)', color: 'var(--muted)', fontSize: 10, fontWeight: 700, textTransform: 'uppercase' }}>
                                    <th style={{ textAlign: 'left', padding: '5px 10px' }}>Date</th>
                                    <th style={{ textAlign: 'right', padding: '5px 10px' }}>Day's Deposit</th>
                                    <th style={{ textAlign: 'center', padding: '5px 10px' }}>Eligibility</th>
                                    <th style={{ textAlign: 'center', padding: '5px 10px' }}>Claim Status</th>
                                    <th style={{ textAlign: 'left', padding: '5px 10px' }}>Claim Date</th>
                                    <th style={{ textAlign: 'left', padding: '5px 10px' }}>Note</th>
                                    <th style={{ padding: '5px 10px' }}></th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {[...dayGroups].reverse().map(g => {
                                    const isToday = g.date === todayStr
                                    const rowBg = isToday
                                      ? 'rgba(59,130,246,0.06)'
                                      : g.isEligible
                                        ? (g.isClaimed ? 'rgba(34,197,94,0.06)' : 'rgba(255,140,0,0.06)')
                                        : 'transparent'
                                    return (
                                      <tr key={g.date} style={{ borderTop: '1px solid var(--border)', background: rowBg }}>
                                        {/* Date */}
                                        <td style={{ padding: '8px 10px', fontWeight: 600, color: isToday ? '#3B82F6' : 'var(--text)', whiteSpace: 'nowrap' }}>
                                          {g.date}{isToday && <span style={{ marginLeft: 6, fontSize: 10, background: '#3B82F622', color: '#3B82F6', borderRadius: 4, padding: '1px 6px' }}>TODAY</span>}
                                        </td>
                                        {/* Daily deposit total */}
                                        <td style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 700, color: 'var(--text)' }}>
                                          RM {g.dayTotal.toLocaleString()}
                                        </td>
                                        {/* Eligibility */}
                                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                          {g.isEligible ? (
                                            <span style={{ background: '#FF8C0022', color: '#FF8C00', borderRadius: 5, padding: '2px 9px', fontWeight: 700, fontSize: 11, whiteSpace: 'nowrap' }}>
                                              🎰 {g.earnedSpins} spin{g.earnedSpins > 1 ? 's' : ''} earned
                                            </span>
                                          ) : (
                                            <span style={{ color: 'var(--border)', fontSize: 12 }}>—</span>
                                          )}
                                        </td>
                                        {/* Claim status dropdown */}
                                        <td style={{ padding: '8px 10px', textAlign: 'center' }}>
                                          {g.isEligible ? (
                                            <select
                                              value={g.claim_status}
                                              onChange={async e => {
                                                const newStatus = e.target.value
                                                const update = { claim_status: newStatus }
                                                if (newStatus === 'claimed' && !g.claim_date) {
                                                  update.claim_date = todayStr
                                                }
                                                if (newStatus === 'pending') update.claim_date = null
                                                // Update ALL deposit rows for this date
                                                await Promise.all(g.rowIds.map(id =>
                                                  supabase.from('vip_campaign_deposits').update(update).eq('id', id)
                                                ))
                                                loadDeposits()
                                              }}
                                              style={{ ...inp, padding: '3px 8px', fontSize: 11, width: 'auto',
                                                background: g.isClaimed ? 'rgba(34,197,94,0.12)' : 'rgba(255,140,0,0.12)',
                                                color: g.isClaimed ? '#22C55E' : '#FF8C00',
                                                border: `1px solid ${g.isClaimed ? '#22C55E44' : '#FF8C0044'}`,
                                                fontWeight: 700
                                              }}
                                            >
                                              <option value="pending">⏳ Pending</option>
                                              <option value="claimed">✅ Claimed & Paid</option>
                                            </select>
                                          ) : (
                                            <span style={{ color: 'var(--border)', fontSize: 12 }}>—</span>
                                          )}
                                        </td>
                                        {/* Claim date */}
                                        <td style={{ padding: '8px 10px' }}>
                                          {g.isEligible ? (
                                            <input
                                              type="date"
                                              value={g.claim_date || ''}
                                              onChange={async e => {
                                                const val = e.target.value || null
                                                await Promise.all(g.rowIds.map(id =>
                                                  supabase.from('vip_campaign_deposits').update({ claim_date: val }).eq('id', id)
                                                ))
                                                loadDeposits()
                                              }}
                                              style={{ ...inp, width: 140, padding: '3px 8px', fontSize: 11 }}
                                            />
                                          ) : (
                                            <span style={{ color: 'var(--border)', fontSize: 12 }}>—</span>
                                          )}
                                        </td>
                                        {/* Notes */}
                                        <td style={{ padding: '8px 10px', color: 'var(--muted)', maxWidth: 140 }}>{g.notes || <span style={{ color: 'var(--border)' }}>—</span>}</td>
                                        {/* Delete all rows for this date */}
                                        <td style={{ padding: '8px 10px', textAlign: 'right' }}>
                                          <button onClick={async () => {
                                            if (!window.confirm(`Delete all deposits for ${g.date}?`)) return
                                            await Promise.all(g.rowIds.map(id =>
                                              supabase.from('vip_campaign_deposits').delete().eq('id', id)
                                            ))
                                            loadDeposits()
                                          }} style={{ background: 'none', border: 'none', color: '#EF4444', cursor: 'pointer', fontSize: 12, padding: '2px 6px' }}>✕</button>
                                        </td>
                                      </tr>
                                    )
                                  })}
                                  {/* Total row */}
                                  <tr style={{ borderTop: '2px solid var(--border)', fontWeight: 700 }}>
                                    <td style={{ padding: '7px 10px', color: 'var(--muted)', fontSize: 11 }}>
                                      {dayGroups.length} day{dayGroups.length !== 1 ? 's' : ''} · {eligibleDays.length} eligible
                                    </td>
                                    <td style={{ padding: '7px 10px', textAlign: 'right', color: 'var(--brand)' }}>
                                      RM {rawDeps.reduce((s, d) => s + Number(d.deposit_amount), 0).toLocaleString()}
                                    </td>
                                    <td style={{ padding: '7px 10px', textAlign: 'center', color: 'var(--brand)', fontWeight: 700 }}>
                                      {totalEarnedSpins} total spin{totalEarnedSpins !== 1 ? 's' : ''}
                                    </td>
                                    <td colSpan={4} />
                                  </tr>
                                </tbody>
                              </table>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )
          })()}

          {/* RECORDS TAB */}
          {tab === 'records' && (() => {
            return (
              <div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                    <input placeholder="Search member…" value={searchMember} onChange={e => setSearchMember(e.target.value)} style={{ ...inp, maxWidth: 220 }} />
                    {['all','pending','processing','completed','cancelled'].map(s => (
                      <button key={s} onClick={() => setStatusFilter(s)} style={{ padding: '6px 14px', borderRadius: 20, border: `1px solid ${statusFilter === s ? 'var(--brand)' : 'var(--border)'}`, background: statusFilter === s ? 'rgba(255,107,0,0.12)' : 'transparent', color: statusFilter === s ? 'var(--brand)' : 'var(--muted)', fontSize: 12, fontWeight: statusFilter === s ? 700 : 400, cursor: 'pointer' }}>
                        {s === 'all' ? `All (${records.length})` : `${s.charAt(0).toUpperCase() + s.slice(1)} (${records.filter(r => r.status === s).length})`}
                      </button>
                    ))}
                    <button onClick={loadRecords} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}>↺ Refresh</button>
                  </div>
                  <button onClick={() => { setShowManualRecord(true); setRecordMsg('') }} style={{ padding: '7px 16px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap' }}>
                    + Manual Record
                  </button>
                </div>

                {/* ── Manual Record Modal ── */}
                {showManualRecord && (
                  <Modal title="✍️ Add Manual Spin Record" onClose={() => setShowManualRecord(false)}>
                    <Field label="Member Username *">
                      <input style={inp} placeholder="e.g. player123" value={manualRecord.member_username} onChange={e => setManualRecord(r => ({ ...r, member_username: e.target.value }))} />
                    </Field>
                    <Field label="Prize *">
                      <select style={inp} value={manualRecord.prize_id} onChange={e => setManualRecord(r => ({ ...r, prize_id: e.target.value }))}>
                        <option value="">— Select prize —</option>
                        {prizes.filter(p => p.is_active).map(p => (
                          <option key={p.id} value={p.id}>{p.name_en} ({p.prize_type})</option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Code Used" hint="The code the player used (optional)">
                      <input style={inp} placeholder="e.g. VIP-ABC123" value={manualRecord.code_used} onChange={e => setManualRecord(r => ({ ...r, code_used: e.target.value.toUpperCase() }))} />
                    </Field>
                    <Field label="Status">
                      <select style={inp} value={manualRecord.status} onChange={e => setManualRecord(r => ({ ...r, status: e.target.value }))}>
                        <option value="pending">Pending</option>
                        <option value="processing">Processing</option>
                        <option value="completed">Completed</option>
                      </select>
                    </Field>
                    <Field label="Note (optional)">
                      <input style={inp} placeholder="e.g. Manually recorded — spun on external platform" value={manualRecord.note} onChange={e => setManualRecord(r => ({ ...r, note: e.target.value }))} />
                    </Field>
                    {recordMsg && (
                      <div style={{ marginBottom: 12, fontSize: 13, fontWeight: 600, color: recordMsg.startsWith('✅') ? '#22C55E' : '#EF4444' }}>{recordMsg}</div>
                    )}
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                      <button onClick={() => setShowManualRecord(false)} style={{ padding: '10px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
                      <button onClick={addManualRecord} disabled={addingRecord} style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                        {addingRecord ? 'Saving…' : 'Add Record'}
                      </button>
                    </div>
                  </Modal>
                )}

                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Member','Prize','Code Used','Status','Handler','Date','Note','Actions'].map(h => (
                          <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRecords.length === 0 ? (
                        <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>No records found.</td></tr>
                      ) : filteredRecords.map(rec => {
                        const sc = STATUS_COLORS[rec.status] || STATUS_COLORS.pending
                        return (
                          <tr key={rec.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>{rec.member_username}</td>
                            <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--text)' }}>{rec.prize_snapshot?.name_en || rec.prize_snapshot?.name_zh || '—'}</td>
                            <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--muted)', fontFamily: 'monospace' }}>{rec.code_used || '—'}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ background: sc.bg, color: sc.color, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{sc.label}</span>
                            </td>
                            <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--muted)' }}>{rec.handler || '—'}</td>
                            <td style={{ padding: '10px 12px', fontSize: 11, color: 'var(--muted)' }}>{rec.created_at ? new Date(rec.created_at).toLocaleDateString('en-MY') : '—'}</td>
                            <td style={{ padding: '10px 12px', fontSize: 12, color: 'var(--muted)', maxWidth: 140 }}>
                              {editNote === rec.id ? (
                                <div style={{ display: 'flex', gap: 4 }}>
                                  <input value={note[rec.id] ?? rec.note ?? ''} onChange={e => setNote(n => ({ ...n, [rec.id]: e.target.value }))} style={{ ...inp, fontSize: 11, padding: '4px 8px' }} />
                                  <button onClick={() => saveNote(rec.id)} style={{ fontSize: 11, padding: '4px 8px', borderRadius: 5, border: 'none', background: 'var(--brand)', color: '#fff', cursor: 'pointer' }}>✓</button>
                                </div>
                              ) : (
                                <span onClick={() => { setEditNote(rec.id); setNote(n => ({ ...n, [rec.id]: rec.note || '' })) }} style={{ cursor: 'pointer' }}>{rec.note || <span style={{ color: 'var(--border)' }}>+ add</span>}</span>
                              )}
                            </td>
                            <td style={{ padding: '10px 12px' }}>
                              <select value={rec.status} disabled={updatingId === rec.id} onChange={e => updateStatus(rec.id, e.target.value)} style={{ ...inp, fontSize: 12, padding: '4px 8px', width: 'auto' }}>
                                {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{STATUS_COLORS[s].label}</option>)}
                              </select>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: 'var(--muted)' }}>{filteredRecords.length} of {records.length} records</div>
              </div>
            )
          })()}

          {/* CODES TAB */}
          {tab === 'codes' && (
            <div>
              {/* ── Mode toggle ── */}
              <div style={{ display: 'flex', gap: 0, marginBottom: 16, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 4, width: 'fit-content' }}>
                {[['auto','🎲 Auto Generate'],['manual','✏️ Enter Code']].map(([mode, label]) => (
                  <button key={mode} onClick={() => { setCodeMode(mode); setCodeMsg('') }}
                    style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: codeMode === mode ? 'var(--brand)' : 'transparent', color: codeMode === mode ? '#fff' : 'var(--muted)', fontWeight: codeMode === mode ? 700 : 400, fontSize: 13, cursor: 'pointer' }}>
                    {label}
                  </button>
                ))}
              </div>

              {/* ── Input fields ── */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
                <div style={{ display: 'grid', gridTemplateColumns: codeMode === 'manual' ? '1fr 1fr 100px auto' : '1fr 100px auto', gap: 12, alignItems: 'flex-end' }}>

                  {/* Manual code input — only visible in manual mode */}
                  {codeMode === 'manual' && (
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase' }}>Code *</div>
                      <input
                        placeholder="e.g. VIP-ABC123"
                        value={manualCode}
                        onChange={e => setManualCode(e.target.value.toUpperCase())}
                        style={{ ...inp, fontFamily: 'monospace', fontWeight: 700, letterSpacing: 1 }}
                      />
                    </div>
                  )}

                  {/* Member username */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase' }}>Member Username</div>
                    <input
                      placeholder="Leave blank = open code"
                      value={newCodeMember}
                      onChange={e => setNewCodeMember(e.target.value)}
                      style={inp}
                    />
                  </div>

                  {/* Max uses (spins) */}
                  <div>
                    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', marginBottom: 5, textTransform: 'uppercase' }}>Spins</div>
                    <input
                      type="number" min="1" max="10"
                      value={newCodeMaxUses}
                      onChange={e => setNewCodeMaxUses(e.target.value)}
                      style={{ ...inp, width: 90 }}
                    />
                  </div>

                  {/* Submit button */}
                  <div>
                    <button onClick={generateCode} disabled={generatingCode}
                      style={{ padding: '10px 20px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer', whiteSpace: 'nowrap', height: 40 }}>
                      {generatingCode ? '…' : codeMode === 'manual' ? '+ Add Code' : '+ Generate'}
                    </button>
                  </div>
                </div>

                {/* Feedback message */}
                {codeMsg && (
                  <div style={{ marginTop: 10, fontSize: 13, color: codeMsg.startsWith('✅') ? '#22C55E' : '#EF4444', fontWeight: 600 }}>
                    {codeMsg}
                  </div>
                )}

                {/* Hint */}
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--muted)' }}>
                  {codeMode === 'manual'
                    ? '✏️ Enter any code string (e.g. from an external system). Duplicate codes in the same campaign are rejected.'
                    : '🎲 A random SPIN-XXXXXX code will be generated automatically.'}
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Code','Member','Uses','Created By','Created At','Actions'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {codes.length === 0 ? (
                      <tr><td colSpan={6} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>No codes yet.</td></tr>
                    ) : codes.map(c => (
                      <tr key={c.id} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '10px 12px', fontFamily: 'monospace', fontWeight: 700, color: 'var(--brand)' }}>{c.code}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--text)' }}>{c.member_username || <span style={{ color: 'var(--muted)' }}>Open</span>}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>{c.used_count || 0} / {c.max_uses}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 12 }}>{c.created_by}</td>
                        <td style={{ padding: '10px 12px', color: 'var(--muted)', fontSize: 11 }}>{c.created_at ? new Date(c.created_at).toLocaleDateString('en-MY') : '—'}</td>
                        <td style={{ padding: '10px 12px' }}>
                          <button onClick={() => deleteCode(c.id)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #EF444440', background: '#EF444411', color: '#EF4444', fontSize: 12, cursor: 'pointer' }}>Delete</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* PRIZES TAB */}
          {tab === 'prizes' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
                <button onClick={() => { setAddPrizeForm(BLANK_PRIZE); setShowAddPrize(true) }} style={{ padding: '8px 18px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: 'pointer' }}>
                  + Add Prize
                </button>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['Prize','Type','Value','Probability','Stock','Turnover','Active','Actions'].map(h => (
                        <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {prizes.length === 0 ? (
                      <tr><td colSpan={8} style={{ padding: 30, textAlign: 'center', color: 'var(--muted)' }}>No prizes configured.</td></tr>
                    ) : prizes.map(p => {
                      const tc = PRIZE_TYPE_COLORS[p.prize_type] || PRIZE_TYPE_COLORS.cash
                      const isEditing = editingPrize === p.id
                      return (
                        <tr key={p.id} style={{ borderBottom: '1px solid var(--border)', background: isEditing ? 'rgba(255,107,0,0.04)' : 'transparent' }}>
                          <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>
                            {isEditing
                              ? <input value={prizeEdits.name_en} onChange={e => setPrizeEdits(x => ({ ...x, name_en: e.target.value }))} style={{ ...inp, fontSize: 12, padding: '4px 8px' }} />
                              : p.name_en}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <span style={{ background: tc.bg, color: tc.color, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{p.prize_type}</span>
                          </td>
                          <td style={{ padding: '10px 12px', color: 'var(--text)' }}>
                            {isEditing
                              ? <input value={prizeEdits.prize_value} onChange={e => setPrizeEdits(x => ({ ...x, prize_value: e.target.value }))} style={{ ...inp, fontSize: 12, padding: '4px 8px', width: 80 }} />
                              : p.prize_value}
                          </td>
                          <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                            {isEditing
                              ? <input type="number" min="0" value={prizeEdits.probability} onChange={e => setPrizeEdits(x => ({ ...x, probability: e.target.value }))} style={{ ...inp, fontSize: 12, padding: '4px 8px', width: 70 }} />
                              : p.probability}
                          </td>
                          <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                            {isEditing
                              ? <input type="number" value={prizeEdits.stock} onChange={e => setPrizeEdits(x => ({ ...x, stock: e.target.value }))} style={{ ...inp, fontSize: 12, padding: '4px 8px', width: 70 }} />
                              : p.stock === -1 ? '∞' : p.stock}
                          </td>
                          <td style={{ padding: '10px 12px', color: 'var(--muted)' }}>
                            {isEditing
                              ? <input type="number" min="0" value={prizeEdits.turnover_multiplier} onChange={e => setPrizeEdits(x => ({ ...x, turnover_multiplier: e.target.value }))} style={{ ...inp, fontSize: 12, padding: '4px 8px', width: 60 }} />
                              : `${p.turnover_multiplier}×`}
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            <button onClick={() => togglePrize(p.id, !p.is_active)} style={{ padding: '3px 10px', borderRadius: 5, border: 'none', background: p.is_active ? '#22C55E22' : '#EF444422', color: p.is_active ? '#22C55E' : '#EF4444', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                              {p.is_active ? 'On' : 'Off'}
                            </button>
                          </td>
                          <td style={{ padding: '10px 12px' }}>
                            {isEditing ? (
                              <div style={{ display: 'flex', gap: 6 }}>
                                <button onClick={() => savePrize(p.id)} disabled={savingPrize} style={{ padding: '4px 12px', borderRadius: 6, border: 'none', background: 'var(--brand)', color: '#fff', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>Save</button>
                                <button onClick={() => setEditingPrize(null)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', fontSize: 12, cursor: 'pointer' }}>✕</button>
                              </div>
                            ) : (
                              <button onClick={() => startEditPrize(p)} style={{ padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 12, cursor: 'pointer' }}>Edit</button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ROI TAB */}
          {tab === 'roi' && (() => {
            const { totalSpins, completed, totalCost, estTurnover, totalWeight } = roi
            const netROI = estTurnover - totalCost
            return (
              <div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 20 }}>
                  {[
                    { label: 'Total Spins',    val: totalSpins,               color: 'var(--brand)',  prefix: '' },
                    { label: 'Completed',      val: completed,                color: '#22C55E',       prefix: '' },
                    { label: 'Est. Turnover',  val: `RM ${estTurnover.toLocaleString()}`,  color: '#3B82F6', raw: true },
                    { label: 'Est. Prize Cost',val: `RM ${totalCost.toLocaleString()}`,    color: '#EF4444', raw: true },
                  ].map(({ label, val, color, raw }) => (
                    <div key={label} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: '16px 18px' }}>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 6 }}>{label}</div>
                      <div style={{ fontSize: raw ? 18 : 26, fontWeight: 800, color }}>{val}</div>
                    </div>
                  ))}
                </div>
                <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, padding: 16, marginBottom: 16, fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
                  <strong style={{ color: 'var(--text)' }}>Methodology:</strong> Prize cost = (probability / totalWeight) × prize value × completed spins, for cash prizes only. Turnover = same formula × turnover multiplier. Estimates only — actual results depend on spin outcomes.
                </div>
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)' }}>
                        {['Prize','Type','Count (est.)','Turnover (est.)','Cost (est.)'].map(h => (
                          <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {prizes.filter(p => p.is_active).map(p => {
                        const tc = PRIZE_TYPE_COLORS[p.prize_type] || PRIZE_TYPE_COLORS.cash
                        const prob = totalWeight > 0 ? (p.probability / totalWeight) : 0
                        const count = Math.round(prob * completed)
                        const val = parseFloat(p.prize_value) || 0
                        const estT = Math.round(val * prob * completed * (p.turnover_multiplier || 0))
                        const cost = p.prize_type === 'cash' ? Math.round(val * prob * completed) : 0
                        return (
                          <tr key={p.id} style={{ borderBottom: '1px solid var(--border)' }}>
                            <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text)' }}>{p.name_en}</td>
                            <td style={{ padding: '10px 12px' }}>
                              <span style={{ background: tc.bg, color: tc.color, borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>{p.prize_type}</span>
                            </td>
                            <td style={{ padding: '10px 12px', fontWeight: 700, color: 'var(--brand)' }}>{count}</td>
                            <td style={{ padding: '10px 12px', color: '#3B82F6', fontWeight: 600 }}>{estT > 0 ? `RM ${estT.toLocaleString()}` : '—'}</td>
                            <td style={{ padding: '10px 12px', color: cost > 0 ? '#EF4444' : 'var(--muted)', fontWeight: cost > 0 ? 700 : 400 }}>{cost > 0 ? `RM ${cost.toLocaleString()}` : '—'}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
                {selectedCampaign && (
                  <div style={{ marginTop: 16, fontSize: 12, color: 'var(--muted)' }}>
                    Campaign: <strong style={{ color: 'var(--text)' }}>{selectedCampaign.name}</strong>
                    {selectedCampaign.end_date && (
                      <> · Ends {new Date(selectedCampaign.end_date).toLocaleDateString('en-MY')}
                      <button
                        onClick={() => { setShowCreateModal(true); setCreateForm({ ...BLANK_CAMPAIGN, name: selectedCampaign.name + ' (New)', spin_interval: selectedCampaign.spin_interval || 'once', allowed_tiers: selectedCampaign.allowed_tiers || [] }) }}
                        style={{ marginLeft: 12, fontSize: 11, padding: '3px 10px', borderRadius: 5, background: 'rgba(255,107,0,0.12)', color: 'var(--brand)', border: '1px solid rgba(255,107,0,0.3)', cursor: 'pointer', fontWeight: 700 }}>
                        + Create Next Campaign
                      </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            )
          })()}

          {/* ── WHEEL SETTINGS TAB ── */}
          {tab === 'wheel' && (
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--text)' }}>🎡 Wheel Appearance Settings</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Configure how the spin wheel looks on the player portal. Changes save per campaign.</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {wsSaveMsg && <span style={{ fontSize: 13, color: wsSaveMsg.startsWith('✅') ? '#22C55E' : '#EF4444', fontWeight: 600 }}>{wsSaveMsg}</span>}
                  <button onClick={saveWheelSettings} disabled={savingWs} style={{ padding: '9px 22px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: savingWs ? 'not-allowed' : 'pointer', opacity: savingWs ? 0.7 : 1 }}>
                    {savingWs ? 'Saving…' : '💾 Save Settings'}
                  </button>
                </div>
              </div>

              {/* SECTION 1: Text & Language */}
              <WSection title="Text & Language" emoji="✏️">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Field label="Title (ZH)"><input style={inp} placeholder="幸运转盘" value={ws.title_zh} onChange={e => setWs(w => ({ ...w, title_zh: e.target.value }))} /></Field>
                  <Field label="Title (EN)"><input style={inp} placeholder="Lucky Spin" value={ws.title_en} onChange={e => setWs(w => ({ ...w, title_en: e.target.value }))} /></Field>
                  <Field label="Title (BM)"><input style={inp} placeholder="Pusing Nasib" value={ws.title_bm} onChange={e => setWs(w => ({ ...w, title_bm: e.target.value }))} /></Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Field label="Subtitle (ZH)"><input style={inp} value={ws.subtitle_zh} onChange={e => setWs(w => ({ ...w, subtitle_zh: e.target.value }))} /></Field>
                  <Field label="Subtitle (EN)"><input style={inp} value={ws.subtitle_en} onChange={e => setWs(w => ({ ...w, subtitle_en: e.target.value }))} /></Field>
                  <Field label="Subtitle (BM)"><input style={inp} value={ws.subtitle_bm} onChange={e => setWs(w => ({ ...w, subtitle_bm: e.target.value }))} /></Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Field label="Spin Button (ZH)"><input style={inp} value={ws.btn_zh} onChange={e => setWs(w => ({ ...w, btn_zh: e.target.value }))} /></Field>
                  <Field label="Spin Button (EN)"><input style={inp} value={ws.btn_en} onChange={e => setWs(w => ({ ...w, btn_en: e.target.value }))} /></Field>
                  <Field label="Spin Button (BM)"><input style={inp} value={ws.btn_bm} onChange={e => setWs(w => ({ ...w, btn_bm: e.target.value }))} /></Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Field label="Center Text (ZH)"><input style={inp} value={ws.center_zh} onChange={e => setWs(w => ({ ...w, center_zh: e.target.value }))} /></Field>
                  <Field label="Center Text (EN)"><input style={inp} value={ws.center_en} onChange={e => setWs(w => ({ ...w, center_en: e.target.value }))} /></Field>
                  <Field label="Center Text (BM)"><input style={inp} value={ws.center_bm} onChange={e => setWs(w => ({ ...w, center_bm: e.target.value }))} /></Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Field label="Win Instruction (ZH)"><input style={inp} value={ws.win_instruction_zh} onChange={e => setWs(w => ({ ...w, win_instruction_zh: e.target.value }))} /></Field>
                  <Field label="Win Instruction (EN)"><input style={inp} value={ws.win_instruction_en} onChange={e => setWs(w => ({ ...w, win_instruction_en: e.target.value }))} /></Field>
                  <Field label="Win Instruction (BM)"><input style={inp} value={ws.win_instruction_bm} onChange={e => setWs(w => ({ ...w, win_instruction_bm: e.target.value }))} /></Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Field label="Bottom Tagline"><input style={inp} value={ws.bottom_tagline} onChange={e => setWs(w => ({ ...w, bottom_tagline: e.target.value }))} /></Field>
                  <Field label="Default Language">
                    <select style={inp} value={ws.default_lang} onChange={e => setWs(w => ({ ...w, default_lang: e.target.value }))}>
                      <option value="en">English</option>
                      <option value="zh">Chinese (ZH)</option>
                      <option value="bm">Bahasa Malaysia</option>
                    </select>
                  </Field>
                  <Field label="Number of Segments">
                    <select style={inp} value={ws.segments} onChange={e => setWs(w => ({ ...w, segments: Number(e.target.value) }))}>
                      {[6,7,8,9,10,12].map(n => <option key={n} value={n}>{n} segments</option>)}
                    </select>
                  </Field>
                </div>
              </WSection>

              {/* SECTION 2: Contact */}
              <WSection title="Contact Links" emoji="📞">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="Telegram URL"><input style={inp} placeholder="https://t.me/yourusername" value={ws.telegram_url} onChange={e => setWs(w => ({ ...w, telegram_url: e.target.value }))} /></Field>
                  <Field label="Telegram Label"><input style={inp} placeholder="Telegram" value={ws.telegram_label} onChange={e => setWs(w => ({ ...w, telegram_label: e.target.value }))} /></Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="WhatsApp URL" hint="e.g. https://wa.me/60123456789"><input style={inp} placeholder="https://wa.me/60123456789" value={ws.whatsapp_url} onChange={e => setWs(w => ({ ...w, whatsapp_url: e.target.value }))} /></Field>
                  <Field label="WhatsApp Label"><input style={inp} placeholder="WhatsApp" value={ws.whatsapp_label} onChange={e => setWs(w => ({ ...w, whatsapp_label: e.target.value }))} /></Field>
                </div>
              </WSection>

              {/* SECTION 3: Images */}
              <WSection title="Images" emoji="🖼️">
                {(() => {
                  const imgFields = [
                    { key: 'bg_image',    label: '背景图 / Background',        hint: 'Full background of the spin page',           fit: 'cover'   },
                    { key: 'wheel_frame', label: '转盘外框 / Wheel Frame',      hint: 'Outer ring overlaid on wheel (transparent PNG recommended)', fit: 'contain' },
                    { key: 'win_banner',  label: '横幅 / Win Banner',           hint: 'Top banner shown on the win result page',     fit: 'contain' },
                    { key: 'win_bg',      label: '开奖背景 / Win Background',   hint: 'Full background of the win result page',      fit: 'cover'   },
                  ]
                  return (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                      {imgFields.map(({ key, label, hint, fit }) => (
                        <div key={key}>
                          <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text)', marginBottom: 2 }}>{label}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>{hint}</div>
                          {/* Thumbnail */}
                          {ws[key]
                            ? <img src={ws[key]} alt={label} style={{ display: 'block', width: '100%', height: 80, objectFit: fit, borderRadius: 8, border: '1px solid var(--border)', marginBottom: 8, background: '#000' }} onError={e => { e.target.style.display='none' }} />
                            : <div style={{ width: '100%', height: 80, borderRadius: 8, border: '1px dashed var(--border)', marginBottom: 8, background: 'var(--surface2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                <span style={{ fontSize: 11, color: 'var(--muted)' }}>No image</span>
                              </div>
                          }
                          {/* Buttons */}
                          <div style={{ display: 'flex', gap: 8 }}>
                            <label style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '7px 0', borderRadius: 7, background: 'linear-gradient(135deg,#7c3aed,#9333ea)', color: '#fff', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                              📤 上传图片
                              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { if (e.target.files[0]) uploadWheelImage(key, e.target.files[0]); e.target.value = '' }} />
                            </label>
                            {ws[key] && (
                              <button onClick={() => setWs(w => ({ ...w, [key]: '' }))} style={{ padding: '7px 14px', borderRadius: 7, border: '1px solid #EF4444', background: '#EF444415', color: '#EF4444', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
                                移除
                              </button>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                })()}
              </WSection>

              {/* SECTION 4: Layout & Positioning */}
              <WSection title="Layout & Positioning" emoji="📐">
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>All values are percentages (%) of the poster width unless stated otherwise.</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  <Field label="Wheel Center X (%)"><input type="number" style={inp} value={ws.wheel_x} onChange={e => setWs(w => ({ ...w, wheel_x: Number(e.target.value) }))} /></Field>
                  <Field label="Wheel Center Y (%)"><input type="number" style={inp} value={ws.wheel_y} onChange={e => setWs(w => ({ ...w, wheel_y: Number(e.target.value) }))} /></Field>
                  <Field label="Wheel Diameter (%)"><input type="number" style={inp} value={ws.wheel_diameter} onChange={e => setWs(w => ({ ...w, wheel_diameter: Number(e.target.value) }))} /></Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  <Field label="Center Button Size (%)"><input type="number" style={inp} value={ws.center_btn_size} onChange={e => setWs(w => ({ ...w, center_btn_size: Number(e.target.value) }))} /></Field>
                  <Field label="Center Hole (%)"><input type="number" style={inp} value={ws.center_hole} onChange={e => setWs(w => ({ ...w, center_hole: Number(e.target.value) }))} /></Field>
                  <Field label="Wheel Top Offset"><input type="number" style={inp} value={ws.wheel_top} onChange={e => setWs(w => ({ ...w, wheel_top: Number(e.target.value) }))} /></Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  <Field label="Subtitle Height (%)"><input type="number" style={inp} value={ws.subtitle_height} onChange={e => setWs(w => ({ ...w, subtitle_height: Number(e.target.value) }))} /></Field>
                  <Field label="Subtitle Width (%)"><input type="number" style={inp} value={ws.subtitle_width} onChange={e => setWs(w => ({ ...w, subtitle_width: Number(e.target.value) }))} /></Field>
                  <Field label="Prize Position (%)"><input type="number" style={inp} value={ws.prize_position} onChange={e => setWs(w => ({ ...w, prize_position: Number(e.target.value) }))} /></Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  <Field label="Input Y (%)"><input type="number" style={inp} value={ws.input_y} onChange={e => setWs(w => ({ ...w, input_y: Number(e.target.value) }))} /></Field>
                  <Field label="Input Height (%)"><input type="number" style={inp} value={ws.input_height} onChange={e => setWs(w => ({ ...w, input_height: Number(e.target.value) }))} /></Field>
                  <Field label="Input Width (%)"><input type="number" style={inp} value={ws.input_width} onChange={e => setWs(w => ({ ...w, input_width: Number(e.target.value) }))} /></Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  <Field label="Button Y (%)"><input type="number" style={inp} value={ws.btn_y} onChange={e => setWs(w => ({ ...w, btn_y: Number(e.target.value) }))} /></Field>
                  <Field label="Button Height (%)"><input type="number" style={inp} value={ws.btn_height} onChange={e => setWs(w => ({ ...w, btn_height: Number(e.target.value) }))} /></Field>
                  <Field label="Input Margin"><input type="number" style={inp} value={ws.input_margin} onChange={e => setWs(w => ({ ...w, input_margin: Number(e.target.value) }))} /></Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  <Field label="Overall Size (%)"><input type="number" style={inp} value={ws.overall_size} onChange={e => setWs(w => ({ ...w, overall_size: Number(e.target.value) }))} /></Field>
                  <Field label="Offset X"><input type="number" style={inp} value={ws.offset_x} onChange={e => setWs(w => ({ ...w, offset_x: Number(e.target.value) }))} /></Field>
                  <Field label="Offset Y"><input type="number" style={inp} value={ws.offset_y} onChange={e => setWs(w => ({ ...w, offset_y: Number(e.target.value) }))} /></Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  <Field label="Skin Width (px)"><input type="number" style={inp} value={ws.skin_width} onChange={e => setWs(w => ({ ...w, skin_width: Number(e.target.value) }))} /></Field>
                  <Field label="Poster Ratio" hint="Leave blank = auto"><input style={inp} placeholder="e.g. 9:16" value={ws.poster_ratio} onChange={e => setWs(w => ({ ...w, poster_ratio: e.target.value }))} /></Field>
                  <Field label="Win Prize Name Pos (%)"><input type="number" style={inp} value={ws.win_prize_name_pos} onChange={e => setWs(w => ({ ...w, win_prize_name_pos: Number(e.target.value) }))} /></Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>
                  <Field label="Win Prize Y (%)"><input type="number" style={inp} value={ws.win_prize_y} onChange={e => setWs(w => ({ ...w, win_prize_y: Number(e.target.value) }))} /></Field>
                </div>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap', marginTop: 4 }}>
                  <Toggle value={ws.show_subtitle} onChange={v => setWs(w => ({ ...w, show_subtitle: v }))} label="Show Subtitle" />
                  <Toggle value={ws.bottom_brand} onChange={v => setWs(w => ({ ...w, bottom_brand: v }))} label="Bottom Brand Tag" />
                </div>
              </WSection>

              {/* SECTION 5: Colors */}
              <WSection title="Colors" emoji="🎨">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  <Field label="Prize Text (Large)">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="color" value={ws.color_text_large} onChange={e => setWs(w => ({ ...w, color_text_large: e.target.value }))} style={{ width: 44, height: 36, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', background: 'none', padding: 2 }} />
                      <input style={{ ...inp, flex: 1 }} value={ws.color_text_large} onChange={e => setWs(w => ({ ...w, color_text_large: e.target.value }))} />
                    </div>
                  </Field>
                  <Field label="Prize Text (Small)">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="color" value={ws.color_text_small} onChange={e => setWs(w => ({ ...w, color_text_small: e.target.value }))} style={{ width: 44, height: 36, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', background: 'none', padding: 2 }} />
                      <input style={{ ...inp, flex: 1 }} value={ws.color_text_small} onChange={e => setWs(w => ({ ...w, color_text_small: e.target.value }))} />
                    </div>
                  </Field>
                  <Field label="Segment Base Color">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="color" value={ws.color_segment} onChange={e => setWs(w => ({ ...w, color_segment: e.target.value }))} style={{ width: 44, height: 36, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', background: 'none', padding: 2 }} />
                      <input style={{ ...inp, flex: 1 }} value={ws.color_segment} onChange={e => setWs(w => ({ ...w, color_segment: e.target.value }))} />
                    </div>
                  </Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12 }}>
                  <Field label="Divider Color">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="color" value={ws.divider_color} onChange={e => setWs(w => ({ ...w, divider_color: e.target.value }))} style={{ width: 44, height: 36, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', background: 'none', padding: 2 }} />
                      <input style={{ ...inp, flex: 1 }} value={ws.divider_color} onChange={e => setWs(w => ({ ...w, divider_color: e.target.value }))} />
                    </div>
                  </Field>
                  <Field label="Gold Accent Color">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="color" value={ws.color_gold} onChange={e => setWs(w => ({ ...w, color_gold: e.target.value }))} style={{ width: 44, height: 36, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', background: 'none', padding: 2 }} />
                      <input style={{ ...inp, flex: 1 }} value={ws.color_gold} onChange={e => setWs(w => ({ ...w, color_gold: e.target.value }))} />
                    </div>
                  </Field>
                  <Field label="Blue Accent Color">
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <input type="color" value={ws.color_blue} onChange={e => setWs(w => ({ ...w, color_blue: e.target.value }))} style={{ width: 44, height: 36, border: '1px solid var(--border)', borderRadius: 6, cursor: 'pointer', background: 'none', padding: 2 }} />
                      <input style={{ ...inp, flex: 1 }} value={ws.color_blue} onChange={e => setWs(w => ({ ...w, color_blue: e.target.value }))} />
                    </div>
                  </Field>
                </div>
                <Field label="Segment Opacity (%)" hint="0 = fully transparent, 100 = solid">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <input type="range" min="0" max="100" value={ws.segment_opacity} onChange={e => setWs(w => ({ ...w, segment_opacity: Number(e.target.value) }))} style={{ flex: 1 }} />
                    <span style={{ color: 'var(--text)', fontWeight: 700, minWidth: 36 }}>{ws.segment_opacity}%</span>
                  </div>
                </Field>
              </WSection>

              {/* SECTION 6: Effects & Visual */}
              <WSection title="Effects & Visual Switches" emoji="✨">
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 4, marginBottom: 12 }}>
                  <Toggle value={ws.fx_fog}          onChange={v => setWs(w => ({ ...w, fx_fog: v }))}          label="Fog Effect" />
                  <Toggle value={ws.fx_diamond_ring}  onChange={v => setWs(w => ({ ...w, fx_diamond_ring: v }))}  label="Diamond Ring" />
                  <Toggle value={ws.fx_bg_diamonds}   onChange={v => setWs(w => ({ ...w, fx_bg_diamonds: v }))}   label="BG Diamonds" />
                  <Toggle value={ws.fx_ring_flash}    onChange={v => setWs(w => ({ ...w, fx_ring_flash: v }))}    label="Ring Flash" />
                  <Toggle value={ws.fx_prize_glow}    onChange={v => setWs(w => ({ ...w, fx_prize_glow: v }))}    label="Prize Glow" />
                  <Toggle value={ws.fx_btn_flow}      onChange={v => setWs(w => ({ ...w, fx_btn_flow: v }))}      label="Button Flow" />
                  <Toggle value={ws.show_crown}       onChange={v => setWs(w => ({ ...w, show_crown: v }))}       label="Show Crown" />
                  <Toggle value={ws.show_pointer}     onChange={v => setWs(w => ({ ...w, show_pointer: v }))}     label="Show Pointer" />
                  <Toggle value={ws.show_dividers}    onChange={v => setWs(w => ({ ...w, show_dividers: v }))}    label="Show Dividers" />
                  <Toggle value={ws.scroll_mode}      onChange={v => setWs(w => ({ ...w, scroll_mode: v }))}      label="Scroll Mode" />
                  <Toggle value={ws.prefill_username} onChange={v => setWs(w => ({ ...w, prefill_username: v }))} label="Prefill Username" />
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Field label="Theme">
                    <select style={inp} value={ws.theme} onChange={e => setWs(w => ({ ...w, theme: e.target.value }))}>
                      <option value="dark_gold">Dark Gold VIP (Black & Gold)</option>
                      <option value="red_gold">Red Gold</option>
                      <option value="blue_gold">Blue Gold</option>
                      <option value="dark_blue">Dark Blue</option>
                      <option value="custom">Custom</option>
                    </select>
                  </Field>
                  <Field label="Skin Mode">
                    <select style={inp} value={ws.skin_mode} onChange={e => setWs(w => ({ ...w, skin_mode: e.target.value }))}>
                      <option value="bg_image">Use Background Image</option>
                      <option value="color">Color Only</option>
                      <option value="gradient">Gradient</option>
                    </select>
                  </Field>
                  <Field label="Input Style">
                    <select style={inp} value={ws.input_style} onChange={e => setWs(w => ({ ...w, input_style: e.target.value }))}>
                      <option value="minimal_gold">Minimal Gold Line</option>
                      <option value="outlined">Outlined Box</option>
                      <option value="filled">Filled Dark</option>
                    </select>
                  </Field>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
                  <Field label="Center Style">
                    <select style={inp} value={ws.center_style} onChange={e => setWs(w => ({ ...w, center_style: e.target.value }))}>
                      <option value="transparent_frame">Transparent + Outer Frame</option>
                      <option value="solid">Solid Color</option>
                      <option value="image">Custom Image</option>
                    </select>
                  </Field>
                  <Field label="Font Weight">
                    <select style={inp} value={ws.font_weight} onChange={e => setWs(w => ({ ...w, font_weight: e.target.value }))}>
                      <option value="normal">Normal</option>
                      <option value="bold">Bold</option>
                      <option value="extra_bold">Extra Bold</option>
                    </select>
                  </Field>
                  <Field label="Icon Size (%)">
                    <input type="number" style={inp} value={ws.icon_size} onChange={e => setWs(w => ({ ...w, icon_size: Number(e.target.value) }))} />
                  </Field>
                </div>
              </WSection>

              {/* SECTION 7: Win Page */}
              <WSection title="Win Page Configuration" emoji="🏆">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                  <Field label="Win Page Style">
                    <select style={inp} value={ws.win_page_style} onChange={e => setWs(w => ({ ...w, win_page_style: e.target.value }))}>
                      <option value="full_bg">Full Background Image</option>
                      <option value="card">Card Style</option>
                      <option value="overlay">Overlay</option>
                    </select>
                  </Field>
                </div>
                <div style={{ marginTop: 8, padding: '12px 14px', background: 'rgba(255,107,0,0.06)', borderRadius: 8, border: '1px solid rgba(255,107,0,0.15)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.6 }}>
                  <strong style={{ color: 'var(--text)' }}>💡 Win page position fields</strong> — Win banner URL, background, and prize text positions are configured in the Images and Layout sections above.
                </div>
              </WSection>

              {/* Save button at bottom */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, marginTop: 8, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
                {wsSaveMsg && <span style={{ fontSize: 13, color: wsSaveMsg.startsWith('✅') ? '#22C55E' : '#EF4444', fontWeight: 600 }}>{wsSaveMsg}</span>}
                <button onClick={saveWheelSettings} disabled={savingWs} style={{ padding: '10px 28px', borderRadius: 9, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontWeight: 700, fontSize: 14, cursor: savingWs ? 'not-allowed' : 'pointer', opacity: savingWs ? 0.7 : 1 }}>
                  {savingWs ? 'Saving…' : '💾 Save Wheel Settings'}
                </button>
              </div>
            </div>
          )}

          {/* ── MILESTONES TAB ── */}
          {tab === 'milestones' && (
            <div>
              {/* Milestone Configurator */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>💰 Deposit Milestone Config</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
                  Each milestone grants the player additional spin codes when their total campaign-period deposit reaches the threshold.
                  Milestones are cumulative — a player who deposits RM 40,000 earns all 4 tiers of spins.
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 14 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--border)' }}>
                      {['#', 'Deposit Threshold (RM)', 'Spins Granted', ''].map(h => (
                        <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {milestones.map((m, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                        <td style={{ padding: '8px 10px', fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>Tier {i + 1}</td>
                        <td style={{ padding: '8px 10px' }}>
                          <input
                            type="number" min="0" value={m.threshold}
                            onChange={e => setMilestones(ms => ms.map((x, j) => j === i ? { ...x, threshold: parseFloat(e.target.value) || 0 } : x))}
                            style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: 160 }}
                          />
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <input
                            type="number" min="1" value={m.spins}
                            onChange={e => setMilestones(ms => ms.map((x, j) => j === i ? { ...x, spins: parseInt(e.target.value) || 1 } : x))}
                            style={{ background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 13, width: 80 }}
                          />
                        </td>
                        <td style={{ padding: '8px 10px' }}>
                          <button onClick={() => setMilestones(ms => ms.filter((_, j) => j !== i))} style={{ background: '#EF444415', color: '#EF4444', border: '1px solid #EF444440', borderRadius: 6, padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontWeight: 700 }}>✕ Remove</button>
                        </td>
                      </tr>
                    ))}
                    {milestones.length === 0 && (
                      <tr><td colSpan={4} style={{ padding: 16, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>No milestones configured. Add one below.</td></tr>
                    )}
                  </tbody>
                </table>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <button
                    onClick={() => setMilestones(ms => [...ms, { threshold: 0, spins: 1 }])}
                    style={{ padding: '8px 16px', borderRadius: 8, border: '1px dashed var(--border)', background: 'transparent', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', fontWeight: 600 }}
                  >+ Add Milestone</button>
                  <div style={{ flex: 1 }} />
                  {milestoneSaveMsg && <span style={{ fontSize: 13, color: milestoneSaveMsg.startsWith('✅') ? '#22C55E' : '#EF4444', fontWeight: 600 }}>{milestoneSaveMsg}</span>}
                  <button onClick={saveMilestones} disabled={savingMilestones} style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: savingMilestones ? 'not-allowed' : 'pointer', opacity: savingMilestones ? 0.7 : 1 }}>
                    {savingMilestones ? 'Saving…' : '💾 Save Milestones'}
                  </button>
                </div>
              </div>

              {/* Excluded Players */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20, marginBottom: 20 }}>
                <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>🚫 Excluded Players</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                  Usernames listed here will appear in the preview but will be blocked from receiving spin codes.
                  Enter one username per line (or comma-separated). Case-insensitive.
                </div>
                <textarea
                  value={exclusionInput}
                  onChange={e => setExclusionInput(e.target.value)}
                  placeholder="e.g.&#10;player123&#10;vip_user&#10;john88"
                  rows={5}
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--surface2)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 13, fontFamily: 'monospace', resize: 'vertical' }}
                />
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 10 }}>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {excludedUsernames.length > 0 ? `${excludedUsernames.length} username${excludedUsernames.length !== 1 ? 's' : ''} excluded` : 'No exclusions set'}
                  </span>
                  <div style={{ flex: 1 }} />
                  {exclusionSaveMsg && <span style={{ fontSize: 13, color: exclusionSaveMsg.startsWith('✅') ? '#22C55E' : '#EF4444', fontWeight: 600 }}>{exclusionSaveMsg}</span>}
                  <button onClick={saveExclusions} disabled={savingExclusions} style={{ padding: '9px 22px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontWeight: 700, fontSize: 13, cursor: savingExclusions ? 'not-allowed' : 'pointer', opacity: savingExclusions ? 0.7 : 1 }}>
                    {savingExclusions ? 'Saving…' : '💾 Save Exclusions'}
                  </button>
                </div>
              </div>

              {/* Allocate Spins */}
              <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
                  <div>
                    <div style={{ fontWeight: 800, fontSize: 14, color: 'var(--text)', marginBottom: 4 }}>🎰 Allocate Spin Codes</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>
                      Preview which players qualify and auto-generate spin codes based on their campaign-period deposits.
                    </div>
                  </div>
                  <button onClick={runMilestonePreview} disabled={loadingPreview || milestones.length === 0} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid rgba(14,165,233,.3)', background: 'rgba(14,165,233,.12)', color: '#0ea5e9', fontWeight: 700, fontSize: 13, cursor: (loadingPreview || milestones.length === 0) ? 'not-allowed' : 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                    {loadingPreview ? '⏳ Loading…' : '📊 Preview Allocations'}
                  </button>
                </div>

                {milestonePreview === null && !loadingPreview && (
                  <div style={{ padding: '24px 0', textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
                    Click "Preview Allocations" to fetch VIP data for{' '}
                    <strong style={{ color: 'var(--text)' }}>
                      {toDateInput(selectedCampaign.start_date)} → {toDateInput(selectedCampaign.end_date) || toDateInput(selectedCampaign.start_date)}
                    </strong>{' '}
                    and calculate how many spins each player has earned.
                  </div>
                )}

                {milestonePreview !== null && (
                  <>
                    {/* Summary bar */}
                    <div style={{ display: 'flex', gap: 16, marginBottom: 14, padding: '10px 14px', background: 'rgba(255,107,0,0.06)', borderRadius: 9, border: '1px solid rgba(255,107,0,0.15)', fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
                      <span><strong style={{ color: 'var(--text)' }}>{milestonePreview.length}</strong> qualifying players</span>
                      <span><strong style={{ color: 'var(--text)' }}>{milestonePreview.reduce((s, p) => s + p.spinsEarned, 0)}</strong> total spins earned</span>
                      <span><strong style={{ color: '#22C55E' }}>{milestonePreview.filter(p => p.codesExisting >= p.spinsEarned).length}</strong> already have codes</span>
                      <span><strong style={{ color: '#FF8C00' }}>{milestonePreview.filter(p => p.codesExisting < p.spinsEarned).length}</strong> need new codes</span>
                      <button onClick={runMilestonePreview} disabled={loadingPreview} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'var(--muted)', cursor: 'pointer', fontSize: 12 }}>↺ Refresh</button>
                    </div>

                    {/* Select all / none */}
                    <div style={{ display: 'flex', gap: 10, marginBottom: 10, alignItems: 'center' }}>
                      <button onClick={() => setSelectedAllocUsernames(new Set(milestonePreview.filter(p => p.codesExisting < p.spinsEarned).map(p => p.username)))} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', cursor: 'pointer' }}>Select Needs Code</button>
                      <button onClick={() => setSelectedAllocUsernames(new Set(milestonePreview.map(p => p.username)))} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', cursor: 'pointer' }}>Select All</button>
                      <button onClick={() => setSelectedAllocUsernames(new Set())} style={{ fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', cursor: 'pointer' }}>Deselect All</button>
                      <span style={{ fontSize: 12, color: 'var(--muted)' }}>{selectedAllocUsernames.size} selected</span>
                    </div>

                    {/* Player table */}
                    <div style={{ overflowX: 'auto', marginBottom: 14 }}>
                      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                        <thead>
                          <tr style={{ borderBottom: '1px solid var(--border)' }}>
                            <th style={{ padding: '8px 10px', width: 32 }}></th>
                            {['Username', 'Period Deposit', 'Spins Earned', 'Codes Existing', 'Codes Needed', 'Status'].map(h => (
                              <th key={h} style={{ padding: '8px 10px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase' }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {milestonePreview.map(p => {
                            const needed = Math.max(0, p.spinsEarned - p.codesExisting)
                            const done = p.codesExisting >= p.spinsEarned
                            const sel = selectedAllocUsernames.has(p.username)
                            return (
                              <tr key={p.username} style={{ borderBottom: '1px solid var(--border)', opacity: (p.excluded || p.tierBlocked) ? 0.45 : done ? 0.6 : 1 }}>
                                <td style={{ padding: '8px 10px' }}>
                                  <input type="checkbox" checked={sel && !p.excluded && !p.tierBlocked} disabled={p.excluded || p.tierBlocked} onChange={e => {
                                    if (p.excluded || p.tierBlocked) return
                                    const next = new Set(selectedAllocUsernames)
                                    e.target.checked ? next.add(p.username) : next.delete(p.username)
                                    setSelectedAllocUsernames(next)
                                  }} />
                                </td>
                                <td style={{ padding: '8px 10px', fontWeight: 600, color: 'var(--text)', fontSize: 13 }}>{p.username}</td>
                                <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--text)' }}>RM {p.totalDeposit.toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                                <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 700, color: 'var(--brand)' }}>{p.spinsEarned}</td>
                                <td style={{ padding: '8px 10px', fontSize: 13, color: 'var(--muted)' }}>{p.codesExisting}</td>
                                <td style={{ padding: '8px 10px', fontSize: 13, fontWeight: 700, color: needed > 0 ? '#FF8C00' : '#22C55E' }}>{needed > 0 ? `+${needed}` : '—'}</td>
                                <td style={{ padding: '8px 10px' }}>
                                  {p.excluded
                                    ? <span style={{ background: '#EF444422', color: '#EF4444', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>🚫 Excluded</span>
                                    : p.tierBlocked
                                    ? <span style={{ background: 'rgba(150,150,150,0.15)', color: '#888', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>⛔ Wrong Tier{p.playerTier ? ` (${p.playerTier})` : ''}</span>
                                    : done
                                    ? <span style={{ background: '#22C55E22', color: '#22C55E', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>✅ Done</span>
                                    : <span style={{ background: '#FF8C0022', color: '#FF8C00', borderRadius: 5, padding: '2px 8px', fontSize: 11, fontWeight: 700 }}>⏳ Needs Code</span>
                                  }
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>

                    {/* Generate button */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                      <button onClick={generateMilestoneCodes} disabled={generatingCodes || selectedAllocUsernames.size === 0} style={{ padding: '10px 28px', borderRadius: 9, border: 'none', background: generatingCodes || selectedAllocUsernames.size === 0 ? 'var(--border)' : 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: generatingCodes || selectedAllocUsernames.size === 0 ? 'var(--muted)' : '#fff', fontWeight: 700, fontSize: 14, cursor: generatingCodes || selectedAllocUsernames.size === 0 ? 'not-allowed' : 'pointer' }}>
                        {generatingCodes ? '⏳ Generating…' : `🎰 Generate Codes for ${selectedAllocUsernames.size} Player${selectedAllocUsernames.size !== 1 ? 's' : ''}`}
                      </button>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </>
      )}

      {/* 🟠 CREATE CAMPAIGN MODAL */}
      {showCreateModal && (
        <Modal title="✨ Create New Lucky Spin Campaign" onClose={() => setShowCreateModal(false)}>
          <CampaignFormFields form={createForm} setForm={setCreateForm} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => setShowCreateModal(false)} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button disabled={creating || !createForm.name} onClick={createCampaign} style={{ padding: '9px 24px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: (!createForm.name || creating) ? 0.6 : 1 }}>
              {creating ? 'Creating…' : 'Create Campaign'}
            </button>
          </div>
        </Modal>
      )}

      {/* ✏ EDIT CAMPAIGN MODAL */}
      {showEditModal && (
        <Modal title="✏ Edit Campaign" onClose={() => setShowEditModal(false)}>
          <CampaignFormFields form={editCampaignForm} setForm={setEditCampaignForm} />
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => setShowEditModal(false)} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button disabled={editingCampaign || !editCampaignForm.name} onClick={saveCampaignEdit} style={{ padding: '9px 24px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: (!editCampaignForm.name || editingCampaign) ? 0.6 : 1 }}>
              {editingCampaign ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </Modal>
      )}

      {/* 🗑 DELETE CONFIRM MODAL */}
      {showDeleteConfirm && (
        <Modal title="🗑 Delete Campaign" onClose={() => setShowDeleteConfirm(false)}>
          <div style={{ color: 'var(--text)', marginBottom: 16, lineHeight: 1.6 }}>
            Are you sure you want to delete <strong>{selectedCampaign?.name}</strong>?<br />
            <span style={{ color: '#EF4444', fontSize: 13 }}>This will permanently delete the campaign and all its associated data (records, codes, prizes). This cannot be undone.</span>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
            <button onClick={() => setShowDeleteConfirm(false)} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button disabled={deleting} onClick={deleteCampaign} style={{ padding: '9px 24px', borderRadius: 8, border: 'none', background: '#EF4444', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: deleting ? 0.6 : 1 }}>
              {deleting ? 'Deleting…' : 'Yes, Delete'}
            </button>
          </div>
        </Modal>
      )}

      {/* 🏆 ADD PRIZE MODAL */}
      {showAddPrize && (
        <Modal title="+ Add Prize" onClose={() => setShowAddPrize(false)}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Name (EN) *">
              <input style={inp} placeholder="RM 168 Credit" value={addPrizeForm.name_en} onChange={e => setAddPrizeForm(f => ({ ...f, name_en: e.target.value }))} />
            </Field>
            <Field label="Name (ZH)">
              <input style={inp} placeholder="RM 168 积分" value={addPrizeForm.name_zh} onChange={e => setAddPrizeForm(f => ({ ...f, name_zh: e.target.value }))} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
            <Field label="Prize Type">
              <select style={inp} value={addPrizeForm.prize_type} onChange={e => setAddPrizeForm(f => ({ ...f, prize_type: e.target.value }))}>
                <option value="cash">Cash Credit</option>
                <option value="cashback">Cashback %</option>
                <option value="physical">Physical Prize</option>
                <option value="voucher">Voucher</option>
              </select>
            </Field>
            <Field label="Value">
              <input style={inp} placeholder="RM 168 / 8%" value={addPrizeForm.prize_value} onChange={e => setAddPrizeForm(f => ({ ...f, prize_value: e.target.value }))} />
            </Field>
            <Field label="Probability Weight">
              <input type="number" min="0" style={inp} value={addPrizeForm.probability} onChange={e => setAddPrizeForm(f => ({ ...f, probability: e.target.value }))} />
            </Field>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Field label="Stock (-1 = unlimited)">
              <input type="number" style={inp} value={addPrizeForm.stock} onChange={e => setAddPrizeForm(f => ({ ...f, stock: e.target.value }))} />
            </Field>
            <Field label="Turnover Multiplier">
              <input type="number" min="0" style={inp} placeholder="0 = no requirement" value={addPrizeForm.turnover_multiplier} onChange={e => setAddPrizeForm(f => ({ ...f, turnover_multiplier: e.target.value }))} />
            </Field>
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 8 }}>
            <button onClick={() => setShowAddPrize(false)} style={{ padding: '9px 20px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--muted)', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
            <button disabled={addingPrize || !addPrizeForm.name_en} onClick={addPrize} style={{ padding: '9px 24px', borderRadius: 8, border: 'none', background: 'linear-gradient(135deg,#FF6B00,#FF8C00)', color: '#fff', fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: (!addPrizeForm.name_en || addingPrize) ? 0.6 : 1 }}>
              {addingPrize ? 'Adding…' : 'Add Prize'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
