import CampaignsCountryTiered from './CampaignsCountryTiered'

// One Campaign creator only. CampaignsCountryTiered provides the unified
// creator (all campaign types + shared Country/Tier/Manual targeting) and
// the existing campaign cards/detail workflow. Do not add separate shortcut
// buttons for individual campaign types here.
export default function CampaignsCountryTieredFixed() {
  return <CampaignsCountryTiered />
}
