-- Migration 0006: allow a participant to delete (unmatch) their match.
-- Cascades to messages and exchanges (both FK match_id ON DELETE CASCADE),
-- so the conversation is removed for both sides. Existing likes remain, so the
-- unmatched user won't reappear in the swipe queue (already-liked exclusion).
drop policy if exists matches_delete on public.matches;
create policy matches_delete on public.matches
  for delete to authenticated using (user_a = auth.uid() or user_b = auth.uid());
