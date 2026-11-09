-- AI chat "Find players": add a max_valid_bet filter, 2026-11-09.
-- ai_players could only filter "valid bet >= X", so "who did not reach 1M turnover" came back
-- as every player in the tier. Patches the live definition in place; grants are kept.
do $$
declare
  v_def text;
begin
  select pg_get_functiondef('public.ai_players(jsonb)'::regprocedure) into v_def;
  if position('v_max_vb' in v_def) > 0 then
    return;
  end if;
  v_def := replace(v_def,
    $s$v_min_vb numeric := (p->>'min_valid_bet')::numeric;$s$,
    $s$v_min_vb numeric := (p->>'min_valid_bet')::numeric;
  v_max_vb numeric := (p->>'max_valid_bet')::numeric;$s$);
  v_def := replace(v_def,
    $s$and (v_min_vb  is null or coalesce(per.vb,0)  >= v_min_vb)$s$,
    $s$and (v_min_vb  is null or coalesce(per.vb,0)  >= v_min_vb)
      and (v_max_vb  is null or coalesce(per.vb,0)  <= v_max_vb)$s$);
  if position('coalesce(per.vb,0)  <= v_max_vb' in v_def) = 0 then
    raise exception 'ai_players patch did not apply';
  end if;
  execute v_def;
end $$;
