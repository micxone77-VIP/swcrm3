import CampaignsCountryTiered from './CampaignsCountryTiered'

const CAMPAIGN_CREATE_TYPES = [
  { key:'gold_bar', label:'🥇 Gold Bar' },
  { key:'pct_reward', label:'💰 % Reward' },
  { key:'fixed_reward', label:'🎁 Fixed Reward' },
  { key:'tiered_reward', label:'📊 Tiered % Reward' },
  { key:'dual_tier', label:'🎯 Deposit + Turnover Tiers' },
  { key:'leaderboard', label:'[TOP] Leaderboard' },
]

const TYPE_STYLE = {
  gold_bar: { color:'#ffd700', bg:'rgba(255,215,0,.10)' },
  pct_reward: { color:'#3fb950', bg:'rgba(63,185,80,.10)' },
  fixed_reward: { color:'#b9f2ff', bg:'rgba(185,242,255,.10)' },
  tiered_reward: { color:'#f0883e', bg:'rgba(240,136,62,.10)' },
  dual_tier: { color:'#c9a961', bg:'rgba(201,169,97,.10)' },
  leaderboard: { color:'#a78bfa', bg:'rgba(167,139,250,.10)' },
}

function openCampaignType(label) {
  // Campaigns owns the create modal state. Open its existing modal first,
  // then select the requested type from the existing Campaign Type Picker.
  const newCampaignButton = [...document.querySelectorAll('button')]
    .find(button => (button.textContent || '').trim().includes('New Campaign'))

  if (!newCampaignButton) return
  newCampaignButton.click()

  window.setTimeout(() => {
    const candidates = [...document.querySelectorAll('div')]
      .filter(el => (el.textContent || '').trim() === label)

    const pickerOption = candidates.find(el => {
      const style = window.getComputedStyle(el)
      return style.cursor === 'pointer'
    })

    pickerOption?.click()
  }, 80)
}

export default function CampaignsCountryTieredFixed() {
  return (
    <>
      <div style={{
        margin:'0 0 18px',
        padding:'14px 16px',
        background:'var(--surface)',
        border:'1px solid var(--border)',
        borderRadius:12,
      }}>
        <div style={{
          display:'flex',
          justifyContent:'space-between',
          alignItems:'center',
          gap:14,
          flexWrap:'wrap',
        }}>
          <div>
            <div style={{fontSize:15,fontWeight:800}}>🎯 Campaign Targeting</div>
            <div style={{fontSize:11,color:'var(--muted)',marginTop:3}}>
              Automatic = Country + VIP Tier. Manual User IDs are explicit exceptions.
            </div>
          </div>

          <div style={{display:'flex',gap:6,flexWrap:'wrap',justifyContent:'flex-end'}}>
            {CAMPAIGN_CREATE_TYPES.map(type => {
              const colors = TYPE_STYLE[type.key]
              return (
                <button
                  key={type.key}
                  type="button"
                  onClick={() => openCampaignType(type.label)}
                  style={{
                    background:colors.bg,
                    color:colors.color,
                    border:`1px solid ${colors.color}55`,
                    padding:'7px 10px',
                    borderRadius:7,
                    fontWeight:700,
                    fontSize:11,
                    cursor:'pointer',
                    whiteSpace:'nowrap',
                  }}
                  title={`Create ${type.label.replace(/^\S+\s*/, '')}`}
                >
                  ＋ {type.label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      <CampaignsCountryTiered />
    </>
  )
}
