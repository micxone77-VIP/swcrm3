// src/components/Sidebar.jsx — V3 with per-user permissions
import { NavLink, useNavigate, useLocation } from 'react-router-dom'
import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { useLanguage } from '../contexts/LanguageContext'
import NotificationBell from './NotificationBell'

// permKey = the key stored in profile.permissions[] to grant access to this page
// admin role always sees everything regardless of permissions
const NAV_GROUPS = [
  { key: 'command', label: 'Command Center', icon: '⚡', items: [
    { to: '/today',   label: 'Today',         icon: '🗓', permKey: 'today'   },
    { to: '/tasks',   label: 'My Tasks',      icon: '✅', permKey: 'tasks'   },
    { to: '/alerts',  label: 'Alerts',        icon: '🔔', permKey: 'alerts'  },
    { to: '/targets', label: 'Daily Targets', icon: '🎯', permKey: 'targets' },
  ] },
  { key: 'vip', label: 'VIP Operations', icon: '👑', items: [
    { to: '/vips',           label: 'All VIPs',       icon: '👥', permKey: 'vips'           },
    { to: '/at-risk',        label: 'Active Risk',    icon: '⚠️', permKey: 'at-risk'        },
    { to: '/active-tracker', label: 'Active Tracker', icon: '📡', permKey: 'active-tracker' },
    { to: '/follow-up',      label: 'Follow Up',      icon: '📞', permKey: 'follow-up'      },
    { to: '/birthdays',      label: 'Birthdays',      icon: '🎂', permKey: 'birthdays'      },
    { to: '/upgrades',       label: 'Upgrades',       icon: '⬆️', permKey: 'upgrades'       },
    { to: '/transfer',       label: 'Transfers',      icon: '🔄', permKey: 'transfer'       },
  ] },
  { key: 'retention', label: 'Retention', icon: '📉', items: [
    { to: '/retention',          label: 'Churn Analysis',    icon: '📉', permKey: 'retention'           },
    { to: '/retention-queue',    label: 'Daily Work Queue',  icon: '🎯', permKey: 'retention-queue'     },
    { to: '/churn',              label: 'Churn Urgency',     icon: '🚨', permKey: 'churn'               },
    { to: '/contacts',           label: 'Contact Log',       icon: '📝', permKey: 'contacts'            },
    { to: '/weekly-outcome',     label: 'Weekly Outcome',    icon: '📋', permKey: 'weekly-outcome'      },
    { to: '/retention-analytics',label: 'Retention Analytics',icon:'📊', permKey: 'retention-analytics' },
  ] },
  { key: 'campaigns', label: 'Campaigns', icon: '📢', items: [
    { to: '/campaigns',       label: 'Campaigns',  icon: '📢', permKey: 'campaigns'  },
    { to: '/lucky-spin-admin',label: 'Lucky Spin', icon: '🎰', permKey: 'lucky-spin' },
    { to: '/budget',          label: 'Budget',     icon: '💰', permKey: 'budget'     },
  ] },
  { key: 'analytics', label: 'Analytics', icon: '📈', items: [
    { to: '/analytics',     label: 'Analytics',      icon: '📈', permKey: 'analytics'      },
    { to: '/tier-analytics',label: 'Tier Analytics', icon: '🔬', permKey: 'tier-analytics' },
    { to: '/profiling',     label: 'Player Insights',icon: '🧠', permKey: 'profiling'      },
    { to: '/period-report', label: 'Reports',        icon: '📅', permKey: 'period-report'  },
    { to: '/monthly-report',label: 'Monthly PPT',    icon: '📊', permKey: 'monthly-report' },
  ] },
  { key: 'performance', label: 'Performance', icon: '🏆', items: [
    { to: '/kpi',             label: 'KPI',              icon: '🏆', permKey: 'kpi'              },
    { to: '/host-performance',label: 'Host Performance', icon: '📋', permKey: 'host-performance' },
    { to: '/ask',             label: 'Ask Data',         icon: '💬', permKey: 'ask'              },
  ] },
  { key: 'system', label: 'System', icon: '⚙️', items: [
    { to: '/wa-numbers', label: 'WA Numbers', icon: '📱', permKey: 'wa-numbers' },
    { to: '/users',      label: 'Users',      icon: '👥', permKey: 'users'      },
    { to: '/import',     label: 'Import',     icon: '📥', permKey: 'import'     },
    { to: '/export',     label: 'Export',     icon: '📤', permKey: 'export'     },
    { to: '/expenses',   label: 'Expenses',   icon: '💳', permKey: 'expenses'   },
    { to: '/boss',       label: 'Mgmt View',  icon: '👔', permKey: 'boss'       },
  ] },
]

// Export for use in ManageUsers permission checkboxes
export { NAV_GROUPS }

// Check if a user can see a given permKey
export function canAccess(profile, permKey) {
  if (!profile) return false
  if (profile.role === 'admin') return true   // admin always full access
  const perms = profile.permissions || []
  return Array.isArray(perms) ? perms.includes(permKey) : false
}

function NavItem({ to, icon, label }) {
  return <NavLink to={to} style={({ isActive }) => ({ display:'flex',alignItems:'center',gap:9,padding:'7px 12px',borderRadius:7,marginBottom:1,fontSize:13,fontWeight:isActive?600:400,color:isActive?'var(--text)':'var(--muted)',background:isActive?'rgba(255,106,0,.12)':'transparent',textDecoration:'none',transition:'background .15s, color .15s',borderLeft:isActive?'2px solid var(--brand)':'2px solid transparent' })}>
    <span style={{fontSize:14,width:18,textAlign:'center',flexShrink:0}}>{icon}</span><span>{label}</span>
  </NavLink>
}

function NavGroup({ group, profile, labelOverride }) {
  const location = useLocation()
  const hasActive = group.items.some(item => location.pathname === item.to || location.pathname.startsWith(item.to + '/'))
  const [open, setOpen] = useState(true)
  const visible = group.items.filter(n => canAccess(profile, n.permKey))
  if (!visible.length) return null
  return <div style={{marginBottom:4}}>
    <button onClick={() => setOpen(o=>!o)} style={{width:'100%',display:'flex',alignItems:'center',justifyContent:'space-between',padding:'5px 12px 5px 10px',borderRadius:7,border:'none',background:'transparent',cursor:'pointer',gap:8,marginBottom:2}}>
      <span style={{display:'flex',alignItems:'center',gap:7}}><span style={{fontSize:13}}>{group.icon}</span><span style={{fontSize:11,fontWeight:700,color:hasActive?'var(--text)':'var(--disabled)',letterSpacing:'.6px',textTransform:'uppercase'}}>{labelOverride || group.label}</span></span>
      <span style={{fontSize:9,color:'var(--disabled)',transform:open?'rotate(180deg)':'rotate(0deg)',transition:'transform .2s',display:'inline-block'}}>▾</span>
    </button>
    {open && <div style={{paddingLeft:4}}>{visible.map(n=><NavItem key={n.to} {...n}/>)}</div>}
  </div>
}

export default function Sidebar() {
  const { profile, signOut } = useAuth()
  const { lang, setLang, t } = useLanguage()
  const navigate = useNavigate()
  const role = profile?.role || 'readonly'
  const roleBadgeColor = {admin:'#3B82F6',host:'#22C55E',readonly:'#F59E0B'}[role] || '#F59E0B'
  const initial = (profile?.full_name || profile?.username || 'U')[0].toUpperCase()
  async function handleSignOut(){await signOut();navigate('/login')}
  const groups = NAV_GROUPS.map(group => group.key === 'retention' ? {
    ...group,
    label: t('retention.title'),
    items: group.items.map(item => ({...item,
      label: item.to === '/retention' ? t('retention.overview') : item.to === '/contacts' ? t('retention.contactLog') : item.to === '/retention-analytics' ? t('retention.analytics') : item.label,
    }))
  } : group)
  return <aside style={{width:248,minHeight:'100vh',background:'var(--surface)',borderRight:'1px solid var(--border)',display:'flex',flexDirection:'column',flexShrink:0}}>
    <div style={{padding:'18px 18px 14px',borderBottom:'1px solid var(--border)',display:'flex',alignItems:'center',justifyContent:'space-between'}}><div><div style={{fontSize:15,fontWeight:700,color:'var(--text)',display:'flex',alignItems:'center',gap:6}}><span style={{color:'var(--brand)',fontWeight:900}}>Sure</span>Win CRM</div><div style={{fontSize:11,color:'var(--muted)',marginTop:2}}>VIP Operations Command Center</div></div><NotificationBell/></div>
    <nav style={{flex:1,padding:'10px 8px',overflowY:'auto'}}>{groups.map(g=><NavGroup key={g.key} group={g} profile={profile}/>)}</nav>
    <div style={{padding:'12px 14px',borderTop:'1px solid var(--border)'}}><div style={{display:'flex',gap:5,marginBottom:10}}>{['en','zh'].map(l=><button key={l} onClick={()=>setLang(l)} style={{flex:1,background:lang===l?'var(--brand)':'var(--surface2)',color:lang===l?'#fff':'var(--muted)',border:`1px solid ${lang===l?'var(--brand)':'var(--border)'}`,borderRadius:6,padding:'5px 0',fontSize:11,fontWeight:700,cursor:'pointer'}}>{l==='en'?'EN':'中文'}</button>)}</div>
      <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10}}><div style={{width:34,height:34,borderRadius:'50%',background:'var(--brand-dim)',border:'2px solid var(--brand)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,fontWeight:700,color:'var(--brand)',flexShrink:0}}>{initial}</div><div style={{minWidth:0}}><div style={{fontSize:13,fontWeight:600,color:'var(--text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{profile?.full_name || profile?.username || 'User'}</div><span style={{display:'inline-block',fontSize:10,fontWeight:700,padding:'1px 7px',borderRadius:10,background:roleBadgeColor+'22',color:roleBadgeColor}}>{role}</span></div></div>
      <button onClick={handleSignOut} style={{width:'100%',background:'none',border:'1px solid var(--border)',color:'var(--muted)',padding:'7px',borderRadius:6,fontSize:12,cursor:'pointer'}}>Sign out</button>
    </div>
  </aside>
}
