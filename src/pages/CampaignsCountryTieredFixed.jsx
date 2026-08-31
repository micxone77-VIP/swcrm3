import CampaignsCountryTiered from './CampaignsCountryTiered'

export default function CampaignsCountryTieredFixed() {
  return (
    <>
      <style>{`
        /* Keep the legacy campaign cards/detail tracking, but expose only the
           dedicated Tiered Deposit Reward creator for new campaigns. */
        .campaigns-legacy-list > div:nth-child(2) > div:first-child > div:last-child > button,
        .campaigns-legacy-list > div:nth-child(2) > div:nth-child(2) span[style*="cursor: pointer"] {
          display: none !important;
        }
      `}</style>
      <div className="campaigns-legacy-list">
        <CampaignsCountryTiered />
      </div>
    </>
  )
}
