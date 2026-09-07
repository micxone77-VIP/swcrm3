import { useMemo, useState } from 'react'
import './VipConcierge.css'

const CATEGORIES = [
  ['all', '▦', 'All', 'All services'],
  ['wellness', '♨', 'Wellness', 'Spa & Massage'],
  ['beauty', '✦', 'Beauty', 'Hair · Nail · Lash · Makeup'],
  ['grooming', '✂', 'Grooming', 'For him'],
  ['dining', '♜', 'Dining', 'Private Chef · Meal Prep'],
  ['home', '⌂', 'Home', 'Cleaning · Interior'],
  ['fitness', '⌁', 'Fitness', 'Personal Training'],
  ['laundry', '◇', 'Laundry', 'Pickup & Delivery'],
  ['celebration', '♢', 'Celebration', 'Birthday · Anniversary'],
  ['photo', '◉', 'Photography', 'Single · Couple · Family'],
  ['staycation', '▱', 'Staycation', 'Hotels · Getaway'],
]

const PROVIDERS = [
  { name:'Sentuh', category:['wellness','beauty'], service:'Massage · Spa · Beauty · Wellness', home:'House Call', coverage:'KL / Selangor', booking:'App / WhatsApp', phone:'+60 3-2787 9191', website:'https://sentuh.my/house-call/', rating:'4.8', reviews:'500+', tag:'Recommended', monogram:'se', tone:'gold' },
  { name:'Snooze', category:['wellness'], service:'Massage · Manicure · Pedicure', home:'House Call', coverage:'KL / Selangor / PJ', booking:'Online / WhatsApp', phone:'+60 17-300 3370', website:'https://www.snooze.my/', rating:'4.8', reviews:'200+', tag:'Recommended', monogram:'sn', tone:'blue' },
  { name:'Effortless', category:['beauty'], service:'Hair · Nail · Lash · Makeup · Home Beauty', home:'House Call', coverage:'Klang Valley', booking:'Website / WhatsApp', phone:'+60 12-274 6188', website:'https://www.effortless.com.my/', rating:'4.7', reviews:'300+', tag:'Recommended', monogram:'ef', tone:'rose' },
  { name:'Raptor Montefiore', category:['grooming'], service:'Mobile Barber · Men Grooming · Beard Care', home:'House Call', coverage:'KL / Selangor', booking:'Website / WhatsApp', phone:'+60 17-573 5809', website:'https://raptormontefiore.com/mobile-barber-service', rating:'4.8', reviews:'200+', tag:'Top Pick', monogram:'rm', tone:'black' },
  { name:'makansquad', category:['dining','home'], service:'Private Chef · Meal Prep · Events · Dinner', home:'House Call', coverage:'Klang Valley', booking:'Website / WhatsApp', phone:'+60 11-1161 7632', website:'https://makansquad.my/en/', rating:'4.9', reviews:'400+', tag:'Recommended', monogram:'ms', tone:'amber' },
  { name:'MyFitSquad', category:['fitness'], service:'Personal Training · Yoga · HIIT · Wellness', home:'House Call', coverage:'KL / Selangor / Putrajaya', booking:'WhatsApp', phone:'+60 11-2434 9125', website:'https://docsquad.my/en/fitness/home-training/', rating:'4.8', reviews:'200+', tag:'Recommended', monogram:'mf', tone:'teal' },
  { name:'KinesioFitness', category:['fitness'], service:'1-to-1 Training · Home / Condo Gym', home:'House Call', coverage:'KL / Selangor', booking:'Website / WhatsApp', phone:'Contact provider', website:'https://www.kinesiofitness.com.my/', rating:'4.7', reviews:'100+', tag:'Premium', monogram:'kf', tone:'green' },
  { name:'dobiQueen', category:['laundry'], service:'Laundry · Dry Cleaning · Pickup & Delivery', home:'Pickup & Delivery', coverage:'KL / PJ / Selangor', booking:'Online / WhatsApp', phone:'+60 3-8084 3737', website:'https://www.dobiqueen.my/', rating:'4.7', reviews:'300+', tag:'Recommended', monogram:'dq', tone:'pink' },
  { name:'Partylicious', category:['celebration'], service:'Birthday · Anniversary · Kids Setup · Events', home:'House Call', coverage:'KL / Selangor', booking:'WhatsApp', phone:'+60 10-8366 329', website:'https://www.partylicious.com.my/', rating:'4.9', reviews:'500+', tag:'Recommended', monogram:'pa', tone:'rose' },
  { name:'Amazing Baby', category:['photo','celebration'], service:'Newborn · Kids · Family · Photoshoot', home:'Studio / Enquiry', coverage:'Klang Valley', booking:'WhatsApp / Website', phone:'+60 16-714 0669', website:'https://amazingbaby.com.my/en/book-a-shoot', rating:'4.9', reviews:'600+', tag:'Premium', monogram:'ab', tone:'peach' },
  { name:'YoloFoods', category:['dining'], service:'Healthy Meal Delivery · Diet Food · Meal Prep', home:'Delivery', coverage:'Klang Valley', booking:'Website / App', phone:'+60 3-2935 9425', website:'https://yolofoods.com/', rating:'4.6', reviews:'300+', tag:'Recommended', monogram:'yo', tone:'orange' },
  { name:'Therapeutic Massage', category:['wellness'], service:'Therapeutic Massage · Recovery · Wellness', home:'House Call', coverage:'KL / Selangor', booking:'Website / WhatsApp', phone:'Contact provider', website:'https://www.therapeuticmassage.com.my/', rating:'4.8', reviews:'200+', tag:'Premium', monogram:'tm', tone:'slate' },
  { name:'Helping Malaysia', category:['home'], service:'Home Cleaning · Deep Cleaning · Interior', home:'House Call', coverage:'KL / Selangor / PJ', booking:'Website / App', phone:'+60 3-9212 9303', website:'https://www.helping.my/', rating:'4.6', reviews:'400+', tag:'Recommended', monogram:'hm', tone:'cyan' },
  { name:'Shangri-La Kuala Lumpur', category:['staycation'], service:'Hotels · Family Getaway · VIP Experience', home:'Physical Location', coverage:'Kuala Lumpur', booking:'Website / Concierge', phone:'+60 3-2074 3900', website:'https://www.shangri-la.com/kualalumpur/shangrila/', rating:'4.8', reviews:'1K+', tag:'Featured', monogram:'sk', tone:'navy' },
]

const MODE_OPTIONS = ['All Service Modes','House Call','Pickup & Delivery','Delivery','Physical Location','Studio / Enquiry']
const LOCATION_OPTIONS = ['All Locations','Kuala Lumpur','Petaling Jaya','Selangor','Putrajaya','Klang Valley']

function matchesLocation(p, location) {
  if (location === 'All Locations') return true
  if (location === 'Kuala Lumpur') return /KL|Kuala Lumpur|Klang Valley/.test(p.coverage)
  if (location === 'Petaling Jaya') return /PJ|Petaling Jaya|Klang Valley/.test(p.coverage)
  if (location === 'Selangor') return /Selangor|Klang Valley/.test(p.coverage)
  if (location === 'Putrajaya') return /Putrajaya/.test(p.coverage)
  return /Klang Valley/.test(p.coverage)
}

export default function VipConcierge() {
  const [category, setCategory] = useState('all')
  const [location, setLocation] = useState('All Locations')
  const [mode, setMode] = useState('All Service Modes')
  const [vipLevel, setVipLevel] = useState('All VIP Levels')
  const [sort, setSort] = useState('Recommended')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    let list = PROVIDERS.filter(p => {
      const categoryMatch = category === 'all' || p.category.includes(category)
      const locationMatch = matchesLocation(p, location)
      const modeMatch = mode === 'All Service Modes' || p.home === mode
      const text = `${p.name} ${p.service} ${p.coverage}`.toLowerCase()
      return categoryMatch && locationMatch && modeMatch && text.includes(query.toLowerCase().trim())
    })
    if (sort === 'Rating') list = [...list].sort((a,b) => Number(b.rating) - Number(a.rating))
    if (sort === 'Name') list = [...list].sort((a,b) => a.name.localeCompare(b.name))
    return list
  }, [category, location, mode, query, sort])

  function whatsapp(phone, name) {
    const digits = phone.replace(/\D/g, '')
    if (!digits) return '#'
    const message = encodeURIComponent(`Hi, I would like to enquire about a VIP booking with ${name}.`)
    return `https://wa.me/${digits}?text=${message}`
  }

  return (
    <div className="vip-concierge">
      <section className="vc-hero">
        <div className="vc-hero-content">
          <div className="vc-brand-row"><span className="vc-crown">♛</span><span>SUREWIN</span><small>VIP LIFESTYLE</small></div>
          <h1>SUREWIN VIP<br /><span>LIFESTYLE CONCIERGE</span></h1>
          <p>Premium services, arranged for your VIP.</p>
          <div className="vc-proof-row">
            <div><strong>◇</strong><span><b>Trusted Partners</b><small>Quality Assured</small></span></div>
            <div><strong>♧</strong><span><b>Convenient Booking</b><small>Call / WhatsApp / Online</small></span></div>
            <div><strong>⌖</strong><span><b>Wide Coverage</b><small>KL / Selangor / Beyond</small></span></div>
            <div><strong>☆</strong><span><b>Curated for VIP</b><small>Live Better, Effortlessly</small></span></div>
          </div>
        </div>
        <div className="vc-hero-side"><div className="vc-city">KUALA LUMPUR<br /><span>&amp; SELANGOR</span></div><div className="vc-script">Your Lifestyle<br />Our Priority</div></div>
      </section>

      <div className="vc-category-bar">
        {CATEGORIES.map(([key, icon, label, sub]) => (
          <button key={key} className={category === key ? 'active' : ''} onClick={() => setCategory(key)}>
            <span className="vc-cat-icon">{icon}</span><b>{label}</b><small>{sub}</small>
          </button>
        ))}
      </div>

      <div className="vc-filters">
        <label><span>⌖</span><select value={location} onChange={e => setLocation(e.target.value)}>{LOCATION_OPTIONS.map(x => <option key={x}>{x}</option>)}</select></label>
        <label><span>⚙</span><select value={mode} onChange={e => setMode(e.target.value)}>{MODE_OPTIONS.map(x => <option key={x}>{x}</option>)}</select></label>
        <label><span>♛</span><select value={vipLevel} onChange={e => setVipLevel(e.target.value)}>{['All VIP Levels','Gold','Platinum','Diamond','Black'].map(x => <option key={x}>{x}</option>)}</select></label>
        <label><span>☷</span><select value={sort} onChange={e => setSort(e.target.value)}>{['Recommended','Rating','Name'].map(x => <option key={x}>{x}</option>)}</select></label>
        <label className="vc-search"><span>⌕</span><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search provider or service..." /></label>
      </div>

      <div className="vc-results-head"><span>Showing <b>{filtered.length}</b> curated partners</span><span className="vc-vip-level">VIP level: <b>{vipLevel}</b></span></div>

      <div className="vc-grid">
        {filtered.map(p => (
          <article className="vc-card" key={p.name}>
            <div className={`vc-card-cover ${p.tone}`}><div className="vc-pattern">✦</div><span className="vc-tag">{p.tag}</span></div>
            <div className="vc-card-body">
              <div className="vc-provider-head"><div className={`vc-logo ${p.tone}`}>{p.monogram}</div><div><h3>{p.name}</h3><div className="vc-rating">★ {p.rating} <small>({p.reviews})</small></div></div></div>
              <p className="vc-service">{p.service}</p>
              <dl>
                <div><dt>⌂</dt><dd><b>Service</b><span>{p.home}</span></dd></div>
                <div><dt>⌖</dt><dd><b>Coverage</b><span>{p.coverage}</span></dd></div>
                <div><dt>◎</dt><dd><b>Booking</b><span>{p.booking}</span></dd></div>
                <div><dt>☎</dt><dd><b>Contact</b><span>{p.phone}</span></dd></div>
              </dl>
              <div className="vc-actions">
                <a href={whatsapp(p.phone, p.name)} target="_blank" rel="noreferrer" className="vc-btn vc-wa">WhatsApp</a>
                <a href={p.website} target="_blank" rel="noreferrer" className="vc-btn vc-web">Visit Website</a>
              </div>
            </div>
          </article>
        ))}
      </div>

      {!filtered.length && <div className="vc-empty"><strong>No partners match these filters.</strong><span>Try another category, service mode or location.</span></div>}

      <section className="vc-cta">
        <div className="vc-cta-icon">◉</div><div><h2>Need Personal Assistance?</h2><p>Our concierge team is here to help you arrange the perfect experience.</p></div>
        <a href="https://wa.me/60100000000?text=Hi%20SureWin%20VIP%20Concierge%2C%20I%20need%20help%20arranging%20a%20VIP%20service." target="_blank" rel="noreferrer">Contact VIP Concierge <span>→</span></a>
        <div className="vc-cta-points"><span>✓ Curated Partners</span><span>✓ Hassle-Free Booking</span><span>✓ Exclusive for SureWin VIP</span></div>
      </section>

      <footer className="vc-footer"><div><span className="vc-footer-brand">SUREWIN</span><small>MORE THAN REWARDS</small></div><nav><span>PEOPLE</span><span>PRIVILEGES</span><span>POSSIBILITIES</span></nav><small>VIP Lifestyle Concierge · Internal Directory</small></footer>
    </div>
  )
}
