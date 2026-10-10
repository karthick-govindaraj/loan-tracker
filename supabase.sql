create table if not exists public.loan_tracker_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.loan_tracker_state enable row level security;
revoke all on table public.loan_tracker_state from anon;
grant select, insert, update on table public.loan_tracker_state to authenticated;

drop policy if exists "Users manage their own loan tracker" on public.loan_tracker_state;
create policy "Users manage their own loan tracker"
on public.loan_tracker_state
for all
to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
