import CampaignsCountryTiered from './CampaignsCountryTiered'

// CampaignsCountryTiered already contains the shared country/tier targeting
// creator plus the full legacy campaign creator with all supported campaign types.
// Do not hide the legacy creation controls: all campaign types must remain available.
export default function CampaignsCountryTieredFixed() {
  return <CampaignsCountryTiered />
}
