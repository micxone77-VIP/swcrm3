// src/components/expense/CashVoucherImportButton.jsx — "Import Cash Voucher CSV" (Google Form responses)
import { useRef, useState } from 'react'
import { useAuth } from '../../hooks/useAuth'
import { useLanguage } from '../../contexts/LanguageContext'
import { importCashVoucherCsv } from '../../lib/cashVoucherImport'

export default function CashVoucherImportButton({ onDone }) {
  const { profile } = useAuth()
  const { lang } = useLanguage()
  const L2 = (en, zh) => (lang === 'zh' ? zh : en)
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState('')
  const [res, setRes] = useState(null)
  const [err, setErr] = useState(null)

  async function onFile(e) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(true); setErr(null); setRes(null)
    try {
      const text = await f.text()
      const r = await importCashVoucherCsv(text, { userId: profile?.id, onProgress: setStep })
      setRes(r); onDone && onDone(r)
    } catch (ex) {
      setErr(ex.message || String(ex))
    } finally { setBusy(false); setStep('') }
  }

  return (
    <>
      <input ref={ref} type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={onFile} />
      <button disabled={busy} onClick={() => ref.current?.click()} title={L2('Upload the Cash Voucher Claim Google Form responses (CSV). Safe to re-upload — duplicates are skipped.', '上传现金券申请表格回复（CSV）。可重复上传，重复记录会自动跳过。')}
        style={{ padding: '7px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--surface2)', color: 'var(--text)', fontSize: 13, fontWeight: 600, cursor: busy ? 'wait' : 'pointer' }}>
        {busy ? `⏳ ${step || L2('Importing…', '导入中…')}` : L2('📥 Import Cash Voucher CSV', '📥 导入现金券CSV')}
      </button>
      {(res || err) && (
        <div onClick={() => { setRes(null); setErr(null) }} style={{ position: 'fixed', right: 24, bottom: 24, zIndex: 60, maxWidth: 380, padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
          background: 'var(--surface)', border: `1px solid ${err ? '#f85149' : '#3fb950'}`, boxShadow: '0 8px 24px rgba(0,0,0,.4)', fontSize: 13, lineHeight: 1.6 }}>
          {err ? <div style={{ color: '#f85149', fontWeight: 700 }}>⚠️ {err}</div> : (
            <>
              <div style={{ fontWeight: 700, color: '#3fb950', marginBottom: 4 }}>✅ {L2('Cash Voucher import done', '现金券导入完成')}</div>
              <div>{L2(`New claims: ${res.inserted} · already imported: ${res.skipped}`, `新申请：${res.inserted} · 已存在：${res.skipped}`)}</div>
              {res.statusUpdated > 0 && <div>{L2(`Status updated: ${res.statusUpdated}`, `状态更新：${res.statusUpdated}`)}</div>}
              <div>{L2(`Dept Spending: ${res.expensesAdded} added · ${res.expensesLinked} matched to existing`, `部门开支：新增 ${res.expensesAdded} · 匹配已有 ${res.expensesLinked}`)}</div>
              <div>{L2(`VIP profiles filled: ${res.profilesFilled}`, `补充VIP资料：${res.profilesFilled}`)}</div>
              {res.unknown.length > 0 && <div style={{ color: '#d29922' }}>{L2(`Not in CRM (skipped): ${res.unknown.join(', ')}`, `CRM中无此玩家（已跳过）：${res.unknown.join(', ')}`)}</div>}
              <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>{L2('IC: last 4 digits only · bank numbers masked', 'IC仅保存后4位 · 银行账号已隐藏')}</div>
            </>
          )}
        </div>
      )}
    </>
  )
}
