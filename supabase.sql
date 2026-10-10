create table if not exists public.loan_tracker_public_state (
  id text primary key check (id = 'main'),
  state jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.loan_tracker_public_state enable row level security;
grant select, insert, update on table public.loan_tracker_public_state to anon;

drop policy if exists "Public app can use the main tracker row" on public.loan_tracker_public_state;
create policy "Public app can use the main tracker row"
on public.loan_tracker_public_state
for all
to anon
using (id = 'main')
with check (id = 'main');
