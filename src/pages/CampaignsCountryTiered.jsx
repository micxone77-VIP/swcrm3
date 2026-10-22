// Campaigns page: one Campaign creator only. CampaignsUnifiedCreator is the single creator
// (all campaign types + shared Country/Tier/Manual targeting); Campaigns holds the campaign cards/detail workflow.
// Do not add separate shortcut buttons for individual campaign types here.
import Campaigns from './Campaigns'
import CampaignsUnifiedCreator from './CampaignsUnifiedCreator'

export default function CampaignsCountryTiered(){
  return <>
    <CampaignsUnifiedCreator />
    <Campaigns />
  </>
}
