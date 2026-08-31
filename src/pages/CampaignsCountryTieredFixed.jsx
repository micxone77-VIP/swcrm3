import CampaignsCountryTiered from './CampaignsCountryTiered'

export default function CampaignsCountryTieredFixed() {
  return (
    <>
      <style>{`
        /* The legacy Campaigns component is retained for cards/detail tracking,
           but its old generic create flow must not compete with the dedicated
           Tiered Deposit Reward creator above it. */
        .campaigns-legacy-list > div > div:first-child > div:last-child > button:last-child,
        .campaigns-legacy-list > div > div:nth-child(2) span[style*="cursor: pointer"] {
          display: none !important;
        }
      `}</style>
      <div className="campaigns-legacy-list">
        <CampaignsCountryTiered />
      </div>
    </>
  )
}
