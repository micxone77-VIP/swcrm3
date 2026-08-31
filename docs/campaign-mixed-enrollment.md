# Campaign Mixed Enrollment

Campaigns can target multiple VIP tiers automatically and add manual User IDs. Tier enrollment is handled by the database trigger; manual IDs are resolved against `vip_members`, deduplicated, and stored in `campaign_players.enrollment_source` as `manual`, `tier`, or `both`.
