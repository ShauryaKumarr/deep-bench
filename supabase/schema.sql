-- Deep Bench: answer stats ("only 2% of players named him").
-- Run this once in the Supabase dashboard: SQL Editor → New query → paste → Run.
-- It is safe to run again.
--
-- Players are anonymous: each browser sends a random device id, only so one browser counts
-- once per round. The table itself is closed to the public (row level security with no
-- policies); the game only reaches it through the two functions below.

create table if not exists public.picks (
  day        date        not null,
  round      smallint    not null check (round between 0 and 6),
  player     integer     not null check (player >= -1), -- index into players.json; -1 = no answer
  device     uuid        not null,
  created_at timestamptz not null default now(),
  primary key (day, round, device)
);

alter table public.picks enable row level security;
revoke all on table public.picks from anon, authenticated;

-- Records one round of one player's daily. Only the current team sheet counts (a day either
-- side of the server's date, for time zones), so old days can't be padded, and a browser's
-- first answer to a round is the one that sticks.
create or replace function public.record_pick(p_day date, p_round int, p_player int, p_device uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into picks (day, round, player, device)
  select p_day, p_round, p_player, p_device
  where p_day between current_date - 1 and current_date + 1
    and p_round between 0 and 6
    and p_player >= -1
  on conflict do nothing;
$$;

-- How many browsers gave each answer (or none, player -1) in each round of a day.
create or replace function public.day_stats(p_day date)
returns table (round smallint, player integer, n bigint)
language sql
stable
security definer
set search_path = public
as $$
  select round, player, count(*) from picks where day = p_day group by round, player;
$$;

revoke all on function public.record_pick(date, int, int, uuid) from public;
revoke all on function public.day_stats(date) from public;
grant execute on function public.record_pick(date, int, int, uuid) to anon, authenticated;
grant execute on function public.day_stats(date) to anon, authenticated;
