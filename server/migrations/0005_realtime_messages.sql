-- Migration 0005: enable Supabase Realtime on messages so chat is live.
-- (postgres_changes still respects RLS, so users only receive rows they can select.)
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
