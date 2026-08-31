# Campaign country + tier targeting

Automatic enrollment uses the intersection of selected campaign countries and selected VIP tiers. VIP country is derived from `vip_members.currency`: MYR → MY, SGD → SG, KHUSD → KH.

Manual User IDs are explicit exceptions: they bypass the automatic country/tier filter but still must exist in `vip_members` and not be excluded. Duplicate users are enrolled once and marked with `enrollment_source=both` when they match both paths.

Tiered Deposit Reward campaigns are stored as `campaign_type=fixed_reward` with `is_multi_level=true`, and each fixed Credit milestone is stored in `campaign_levels`.
