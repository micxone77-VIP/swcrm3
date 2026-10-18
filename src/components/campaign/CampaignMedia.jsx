// src/components/campaign/CampaignMedia.jsx — 🖼️ campaign flyers / photos / PDFs
// Upload once, then Copy (image → clipboard, paste straight into WhatsApp Web) or Download any time.
// Storage: private bucket "campaign-media" (path = <campaign_id>/<time>_<name>), list in table campaign_media.
// compact = small strip (used on the follow-up tab); otherwise the full manager (upload, caption, delete).
import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { useLanguage } from '../../contexts/LanguageContext'
import { useAuth } from '../../hooks/useAuth'

const BUCKET = 'campaign-media'
const MAX = 25 * 1024 * 1024
const OK_TYPES = /^(image\/(jpeg|jpg|png|webp|gif)|application\/pdf|video\/(mp4|quicktime))$/
const isImg = m => /^image\//.test(m || '')
const kb = n => (n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB')

// Clipboard only accepts PNG images → convert other image types through a canvas
async function toPngBlob(blob) {
  if (blob.type === 'image/png') return blob
  const url = URL.createObjectURL(blob)
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url })
    const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight
    c.getContext('2d').drawImage(img, 0, 0)
    return await new Promise(res => c.toBlob(res, 'image/png'))
  } finally { URL.revokeObjectURL(url) }
}

export default function CampaignMedia({ campaign, compact = false }) {
  const { lang } = useLanguage()
  const { profile } = useAuth()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const canEdit = profile?.role === 'admin' || profile?.role === 'host'
  const [items, setItems] = useState(null)
  const [urls, setUrls] = useState({})
  const [busy, setBusy] = useState('')
  const [msg, setMsg] = useState('')
  const [delId, setDelId] = useState(null)
  const [drag, setDrag] = useState(false)
  const [view, setView] = useState(null)
  const fileRef = useRef(null)

  const flash = m => { setMsg(m); setTimeout(() => setMsg(x => (x === m ? '' : x)), 3500) }

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('campaign_media').select('*').eq('campaign_id', campaign.id).order('sort_order').order('created_at')
    if (error) { setMsg(error.message); setItems([]); return }
    setItems(data || [])
    if (data?.length) {
      const { data: signed } = await supabase.storage.from(BUCKET).createSignedUrls(data.map(d => d.path), 3600)
      const map = {}; (signed || []).forEach(s => { if (s.signedUrl) map[s.path] = s.signedUrl })
      setUrls(map)
    }
  }, [campaign.id])
  useEffect(() => { load() }, [load])

  async function upload(files) {
    const list = [...(files || [])]
    if (!list.length || !canEdit) return
    const bad = list.filter(f => !OK_TYPES.test(f.type) || f.size > MAX)
    if (bad.length) flash(L2(`Skipped ${bad.length} file(s) — only images, PDF or MP4 up to 25 MB.`, `已跳过 ${bad.length} 个文件 — 只支持图片、PDF或MP4，最大 25 MB。`))
    const good = list.filter(f => !bad.includes(f))
    let n = 0
    for (const f of good) {
      setBusy(L2(`Uploading ${f.name}…`, `正在上传 ${f.name}…`))
      const safe = (f.name || 'file').replace(/[^\w.-]+/g, '_').slice(-80)
      const path = `${campaign.id}/${Date.now()}_${safe}`
      const { error } = await supabase.storage.from(BUCKET).upload(path, f, { contentType: f.type, upsert: false })
      if (error) { flash(L2(`Upload failed: ${error.message}`, `上传失败：${error.message}`)); continue }
      const { error: e2 } = await supabase.from('campaign_media').insert({
        campaign_id: campaign.id, path, file_name: f.name || safe, mime: f.type, size_bytes: f.size,
        sort_order: (items?.length || 0) + n, uploaded_by: profile?.id || null, uploaded_by_name: profile?.full_name || null,
      })
      if (e2) { await supabase.storage.from(BUCKET).remove([path]); flash(e2.message); continue }
      n++
    }
    setBusy('')
    if (n) flash(L2(`✅ Uploaded ${n} file(s)`, `✅ 已上传 ${n} 个文件`))
    load()
  }

  // Ctrl+V a screenshot / image straight into the page (full mode only)
  useEffect(() => {
    if (compact || !canEdit) return
    const onPaste = e => {
      const files = [...(e.clipboardData?.files || [])].filter(f => isImg(f.type))
      if (files.length && !/input|textarea/i.test(document.activeElement?.tagName || '')) { e.preventDefault(); upload(files.map((f, i) => new File([f], f.name && f.name !== 'image.png' ? f.name : `pasted_${Date.now()}_${i}.png`, { type: f.type }))) }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  async function getBlob(it) {
    const { data, error } = await supabase.storage.from(BUCKET).download(it.path)
    if (error) throw error
    return data
  }
  async function copyImg(it) {
    try {
      if (!navigator.clipboard?.write || typeof window.ClipboardItem === 'undefined') throw new Error(L2('This browser cannot copy images — use Download.', '此浏览器无法复制图片 — 请用下载。'))
      setBusy(L2('Copying…', '复制中…'))
      const png = await toPngBlob(await getBlob(it))
      await navigator.clipboard.write([new window.ClipboardItem({ 'image/png': png })])
      flash(L2('📋 Image copied — paste it in WhatsApp (Ctrl+V)', '📋 图片已复制 — 在 WhatsApp 粘贴（Ctrl+V）'))
    } catch (e) { flash(e.message || String(e)) } finally { setBusy('') }
  }
  async function download(it) {
    try {
      setBusy(L2('Downloading…', '下载中…'))
      const blob = await getBlob(it)
      const a = document.createElement('a'); const u = URL.createObjectURL(blob)
      a.href = u; a.download = it.file_name || 'flyer'; document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(u), 4000)
    } catch (e) { flash(e.message || String(e)) } finally { setBusy('') }
  }
  async function downloadAll() { for (const it of items || []) { await download(it) } }
  async function del(it) {
    if (delId !== it.id) { setDelId(it.id); setTimeout(() => setDelId(d => (d === it.id ? null : d)), 4000); return }
    await supabase.storage.from(BUCKET).remove([it.path])
    const { error } = await supabase.from('campaign_media').delete().eq('id', it.id)
    if (error) return flash(error.message)
    setDelId(null); setItems(xs => xs.filter(x => x.id !== it.id))
  }
  async function saveCaption(it, caption) {
    if ((it.caption || '') === caption) return
    const { error } = await supabase.from('campaign_media').update({ caption: caption || null }).eq('id', it.id)
    if (error) return flash(error.message)
    setItems(xs => xs.map(x => (x.id === it.id ? { ...x, caption } : x)))
  }
  async function copyCaption(it) { await navigator.clipboard.writeText(it.caption || ''); flash(L2('Caption copied', '说明文字已复制')) }

  const btn = { padding: '5px 10px', borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer', border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', whiteSpace: 'nowrap' }
  const accent = { ...btn, background: 'var(--accent)', borderColor: 'var(--accent)', color: '#fff' }

  const thumb = (it, h) => {
    const u = urls[it.path]
    if (isImg(it.mime) && u) return <img src={u} alt={it.file_name} onClick={() => setView(it)} style={{ width: '100%', height: h, objectFit: 'cover', borderRadius: 8, cursor: 'zoom-in', background: '#000' }} />
    return (
      <div onClick={() => u && window.open(u, '_blank', 'noopener')} style={{ height: h, borderRadius: 8, background: 'var(--surface)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 34 }}>
        {/pdf/.test(it.mime) ? '📄' : /video/.test(it.mime) ? '🎬' : '📎'}
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{L2('Open', '打开')}</div>
      </div>
    )
  }

  const lightbox = view && (
    <div onClick={() => setView(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.85)', zIndex: 2000, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20, gap: 12 }}>
      <img src={urls[view.path]} alt={view.file_name} style={{ maxWidth: '92vw', maxHeight: '80vh', objectFit: 'contain', borderRadius: 8 }} />
      <div style={{ display: 'flex', gap: 8 }} onClick={e => e.stopPropagation()}>
        <button style={accent} onClick={() => copyImg(view)}>📋 {L2('Copy image', '复制图片')}</button>
        <button style={btn} onClick={() => download(view)}>⬇ {L2('Download', '下载')}</button>
        <button style={btn} onClick={() => setView(null)}>✕</button>
      </div>
    </div>
  )

  if (compact) {
    if (!items?.length) return null
    return (
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '8px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--surface)', margin: '10px 0' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--muted)' }}>🖼️ {L2('Flyers', '海报')}</span>
        {items.map(it => (
          <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--border)', borderRadius: 8, padding: 4, background: 'var(--surface2)' }}>
            <div style={{ width: 44 }}>{thumb(it, 44)}</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              {isImg(it.mime) && <button style={{ ...accent, padding: '2px 8px', fontSize: 11 }} onClick={() => copyImg(it)}>📋 {L2('Copy', '复制')}</button>}
              <button style={{ ...btn, padding: '2px 8px', fontSize: 11 }} onClick={() => download(it)}>⬇ {L2('Save', '下载')}</button>
            </div>
          </div>
        ))}
        {(busy || msg) && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{busy || msg}</span>}
        {lightbox}
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 16, fontWeight: 800 }}>🖼️ {L2('Flyers & media', '海报与素材')} {items ? `(${items.length})` : ''}</div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>{L2('Upload the campaign flyer / photos / PDF once — then 📋 Copy and paste straight into WhatsApp, or ⬇ Download.', '上传活动海报 / 图片 / PDF 一次 — 之后 📋 复制直接贴到 WhatsApp，或 ⬇ 下载。')}</div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {items?.length > 1 && <button style={btn} onClick={downloadAll}>⬇ {L2('Download all', '全部下载')}</button>}
          {canEdit && <button style={accent} onClick={() => fileRef.current?.click()}>⬆ {L2('Upload', '上传')}</button>}
          <input ref={fileRef} type="file" multiple accept="image/*,application/pdf,video/mp4,video/quicktime" style={{ display: 'none' }} onChange={e => { upload(e.target.files); e.target.value = '' }} />
        </div>
      </div>

      {(busy || msg) && <div style={{ fontSize: 13, margin: '0 0 10px', color: busy ? 'var(--muted)' : 'var(--text)' }}>{busy || msg}</div>}

      {canEdit && (
        <div onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)}
          onDrop={e => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files) }} onClick={() => fileRef.current?.click()}
          style={{ border: `2px dashed ${drag ? 'var(--accent)' : 'var(--border)'}`, borderRadius: 10, padding: '16px 12px', textAlign: 'center', color: 'var(--muted)', fontSize: 13, cursor: 'pointer', marginBottom: 14, background: drag ? 'rgba(255,107,0,.06)' : 'transparent' }}>
          {L2('Drag & drop files here, click to choose, or press Ctrl+V to paste an image · JPG / PNG / WEBP / GIF / PDF / MP4 · max 25 MB', '拖放文件到这里、点击选择，或按 Ctrl+V 粘贴图片 · JPG / PNG / WEBP / GIF / PDF / MP4 · 最大 25 MB')}
        </div>
      )}

      {items === null ? <div style={{ color: 'var(--muted)', padding: 20 }}>{L2('Loading…', '载入中…')}</div>
        : !items.length ? <div style={{ color: 'var(--muted)', padding: '10px 0' }}>{L2('No flyers yet.', '还没有海报。')}</div>
        : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))', gap: 14 }}>
            {items.map(it => (
              <div key={it.id} style={{ border: '1px solid var(--border)', borderRadius: 10, padding: 10, background: 'var(--surface2)', display: 'flex', flexDirection: 'column', gap: 8 }}>
                {thumb(it, 220)}
                <div style={{ fontSize: 12, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.file_name}>{it.file_name}</div>
                <div style={{ fontSize: 11, color: 'var(--muted)' }}>{kb(it.size_bytes || 0)} · {String(it.created_at).slice(0, 10)}{it.uploaded_by_name ? ' · ' + it.uploaded_by_name : ''}</div>
                <textarea defaultValue={it.caption || ''} disabled={!canEdit} rows={2} placeholder={L2('Caption to send with it (optional)', '一起发送的文字（可选）')}
                  onBlur={e => saveCaption(it, e.target.value.trim())}
                  style={{ width: '100%', boxSizing: 'border-box', fontSize: 12, padding: 6, borderRadius: 6, border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)', resize: 'vertical', fontFamily: 'inherit' }} />
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  {isImg(it.mime) && <button style={accent} onClick={() => copyImg(it)}>📋 {L2('Copy', '复制')}</button>}
                  <button style={btn} onClick={() => download(it)}>⬇ {L2('Download', '下载')}</button>
                  {it.caption && <button style={btn} onClick={() => copyCaption(it)}>📝 {L2('Copy text', '复制文字')}</button>}
                  {canEdit && <button onClick={() => del(it)} style={{ ...btn, marginLeft: 'auto', borderColor: delId === it.id ? '#f85149' : 'var(--border)', background: delId === it.id ? '#f85149' : 'var(--surface2)', color: delId === it.id ? '#fff' : 'var(--muted)' }}>{delId === it.id ? L2('Confirm?', '确认？') : '🗑'}</button>}
                </div>
              </div>
            ))}
          </div>
        )}
      {lightbox}
    </div>
  )
}
