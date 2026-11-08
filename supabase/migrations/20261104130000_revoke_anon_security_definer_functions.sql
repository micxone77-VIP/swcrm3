-- Close 16 SECURITY DEFINER functions to logged-out visitors (Supabase advisor 0028).
-- PUBLIC must go too: 11 of them were open through PUBLIC, not only through anon.
-- authenticated and service_role keep their own explicit grants.
-- Undo: GRANT EXECUTE ON FUNCTION ... TO anon; for the function that needs it.
REVOKE EXECUTE ON FUNCTION public.close_tasks_on_contact() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_last_active_dates(integer) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.notify_campaign_ended() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_vip_portal_request_event() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.settle_leaderboard_campaign(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_campaign_auto_enrollment() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_campaign_player_after_enrollment() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_campaign_player_performance(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_campaign_player_performance(uuid, text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_campaign_players_for_snapshot() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_campaign_reward_payout_from_player() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_vip_last_contacted() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.sync_vip_snapshot_vip_id() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_settle_leaderboard_campaign() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_sync_campaign_players_from_snapshot() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.trg_sync_new_campaign_player_performance() FROM PUBLIC, anon;
