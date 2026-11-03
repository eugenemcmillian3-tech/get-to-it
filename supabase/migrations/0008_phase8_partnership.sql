-- GET TO IT — Phase 8 schema
-- One accountability partner, explicit sharing, short encouragement, and the
-- controls to end it.
--
-- Design rule: the partner never reads your tables. Everything a partner can
-- see comes from `partner_snapshot`, a security-definer function that returns
-- only fields you switched on. Row Level Security keeps the underlying rows
-- (shares, messages, goals, tasks, notes) out of their reach entirely, so
-- turning a flag off removes the data rather than hiding it in the browser.
--
-- Nothing about saved work, task notes, AI conversations, reflections or focus
-- sessions is ever read by any function here. Those tables are not mentioned
-- once in this file.

-- Invitations ------------------------------------------------------------
-- The token is generated here, single use, and expires after seven days.
-- Creating an invitation never looks up whether the address has an account, so
-- the response cannot be used to test for one.

create table if not exists public.partnership_invitations (
  id uuid primary key default gen_random_uuid(),
  inviter_id uuid not null references auth.users (id) on delete cascade,
  invitee_email text not null
    check (char_length(btrim(invitee_email)) between 3 and 254),
  -- 128 bits from two UUID v4s, hex only. Deliberately not pgcrypto, so the
  -- default also resolves inside functions that pin an empty search_path.
  token text not null unique
    default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  responded_at timestamptz
);

create unique index if not exists partnership_invitations_one_pending_idx
  on public.partnership_invitations (inviter_id)
  where (status = 'pending');

create index if not exists partnership_invitations_email_idx
  on public.partnership_invitations (lower(invitee_email))
  where (status = 'pending');

-- The partnership --------------------------------------------------------
-- Canonical ordering (user_a < user_b) makes the pair unique, and the partial
-- indexes make "one active partner" a database rule rather than a hope.

do $$
begin
  create type public.partnership_status as enum ('active', 'ended');
exception
  when duplicate_object then null;
end $$;

create table if not exists public.partnerships (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references auth.users (id) on delete cascade,
  user_b uuid not null references auth.users (id) on delete cascade,
  status public.partnership_status not null default 'active',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_by uuid references auth.users (id) on delete set null,
  check (user_a <> user_b),
  check (user_a::text < user_b::text)
);

create unique index if not exists partnerships_one_active_a_idx
  on public.partnerships (user_a) where (status = 'active');
create unique index if not exists partnerships_one_active_b_idx
  on public.partnerships (user_b) where (status = 'active');

-- What each person shares, per partnership. Every switch starts off.
create table if not exists public.partnership_shares (
  partnership_id uuid not null references public.partnerships (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  share_goal_title boolean not null default false,
  share_completion boolean not null default false,
  share_milestone boolean not null default false,
  share_checkin boolean not null default false,
  milestone text
    check (milestone is null or char_length(btrim(milestone)) between 1 and 300),
  checkin text
    check (checkin is null or char_length(btrim(checkin)) between 1 and 1000),
  updated_at timestamptz not null default now(),
  primary key (partnership_id, user_id)
);

-- Short encouragement only: no attachments, no threads beyond this one.
create table if not exists public.encouragement_messages (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid not null references public.partnerships (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null check (char_length(btrim(body)) between 1 and 300),
  created_at timestamptz not null default now()
);

create index if not exists encouragement_messages_partnership_idx
  on public.encouragement_messages (partnership_id, created_at desc);
create index if not exists encouragement_messages_sender_idx
  on public.encouragement_messages (sender_id, created_at desc);

-- Blocking stops future invitations in both directions and ends any active
-- partnership between the pair.
create table if not exists public.partnership_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  check (blocker_id <> blocked_id),
  unique (blocker_id, blocked_id)
);

-- Reports are stored for a person to read, not for an automated moderator:
-- there is no moderation queue and no review process to claim.
create table if not exists public.partnership_reports (
  id uuid primary key default gen_random_uuid(),
  partnership_id uuid references public.partnerships (id) on delete set null,
  reporter_id uuid references auth.users (id) on delete set null,
  reported_id uuid references auth.users (id) on delete set null,
  reason text not null
    check (reason in ('harassment', 'spam', 'impersonation', 'other')),
  note text check (note is null or char_length(btrim(note)) <= 500),
  created_at timestamptz not null default now()
);

create index if not exists partnership_reports_created_idx
  on public.partnership_reports (created_at desc);

drop trigger if exists partnership_shares_set_updated_at on public.partnership_shares;
create trigger partnership_shares_set_updated_at
  before update on public.partnership_shares
  for each row execute function public.set_updated_at();

-- Row Level Security -----------------------------------------------------
-- Reads only. Every write goes through a security-definer function below, so
-- the browser can never write a share flag, a message or a partnership row.

alter table public.partnership_invitations enable row level security;
alter table public.partnerships enable row level security;
alter table public.partnership_shares enable row level security;
alter table public.encouragement_messages enable row level security;
alter table public.partnership_blocks enable row level security;
alter table public.partnership_reports enable row level security;

drop policy if exists "inviters read their own invitations" on public.partnership_invitations;
create policy "inviters read their own invitations"
  on public.partnership_invitations for select to authenticated
  using (inviter_id = (select auth.uid()));

drop policy if exists "participants read their partnership" on public.partnerships;
create policy "participants read their partnership"
  on public.partnerships for select to authenticated
  using (
    user_a = (select auth.uid())
    or user_b = (select auth.uid())
  );

-- A person reads only their own sharing settings. The partner's settings and
-- text are reachable only through `partner_snapshot`.
drop policy if exists "people read their own sharing" on public.partnership_shares;
create policy "people read their own sharing"
  on public.partnership_shares for select to authenticated
  using (user_id = (select auth.uid()));

drop policy if exists "participants read encouragement" on public.encouragement_messages;
create policy "participants read encouragement"
  on public.encouragement_messages for select to authenticated
  using (
    exists (
      select 1
        from public.partnerships p
       where p.id = encouragement_messages.partnership_id
         and p.status = 'active'
         and (
           p.user_a = (select auth.uid())
           or p.user_b = (select auth.uid())
         )
    )
  );

drop policy if exists "people read their own blocks" on public.partnership_blocks;
create policy "people read their own blocks"
  on public.partnership_blocks for select to authenticated
  using (blocker_id = (select auth.uid()));

drop policy if exists "people read their own reports" on public.partnership_reports;
create policy "people read their own reports"
  on public.partnership_reports for select to authenticated
  using (reporter_id = (select auth.uid()));

revoke all on public.partnership_invitations from anon, authenticated;
revoke all on public.partnerships from anon, authenticated;
revoke all on public.partnership_shares from anon, authenticated;
revoke all on public.encouragement_messages from anon, authenticated;
revoke all on public.partnership_blocks from anon, authenticated;
revoke all on public.partnership_reports from anon, authenticated;

grant select on public.partnership_invitations to authenticated;
grant select on public.partnerships to authenticated;
grant select on public.partnership_shares to authenticated;
grant select on public.encouragement_messages to authenticated;
grant select on public.partnership_blocks to authenticated;
grant select on public.partnership_reports to authenticated;

-- Invitations ------------------------------------------------------------

create or replace function public.create_partnership_invitation(p_email text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_own text;
  v_token text;
  v_expires timestamptz;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if char_length(v_email) < 3
     or char_length(v_email) > 254
     or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    return jsonb_build_object('ok', false, 'code', 'invalid-email');
  end if;

  select lower(email) into v_own from auth.users where id = v_user;
  if v_email = v_own then
    return jsonb_build_object('ok', false, 'code', 'own-email');
  end if;

  if exists (
    select 1 from public.partnerships
     where status = 'active' and (user_a = v_user or user_b = v_user)
  ) then
    return jsonb_build_object('ok', false, 'code', 'already-partnered');
  end if;

  -- Clear anything expired so a person can try again after seven days.
  update public.partnership_invitations
     set status = 'cancelled', responded_at = now()
   where inviter_id = v_user
     and status = 'pending'
     and expires_at <= now();

  if exists (
    select 1 from public.partnership_invitations
     where inviter_id = v_user and status = 'pending' and expires_at > now()
  ) then
    return jsonb_build_object('ok', false, 'code', 'already-invited');
  end if;

  -- No lookup of the address: an invitation to an unknown email and one to a
  -- known email look exactly the same from here.
  v_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');

  insert into public.partnership_invitations (inviter_id, invitee_email, token)
  values (v_user, v_email, v_token)
  returning expires_at into v_expires;

  return jsonb_build_object('ok', true, 'token', v_token, 'expires_at', v_expires);
end;
$$;

create or replace function public.accept_partnership_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.partnership_invitations;
  v_low uuid;
  v_high uuid;
  v_id uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select lower(email) into v_email from auth.users where id = v_user;

  select * into v_inv
    from public.partnership_invitations
   where token = btrim(coalesce(p_token, ''))
     and status = 'pending'
     and expires_at > now();

  -- Unknown, used, expired, wrong account or self-addressed: one answer, so a
  -- forwarded token reveals nothing about whose it is.
  if not found
     or lower(v_inv.invitee_email) <> v_email
     or v_inv.inviter_id = v_user then
    return jsonb_build_object('ok', false, 'code', 'invalid-invitation');
  end if;

  if exists (
    select 1 from public.partnerships
     where status = 'active' and (user_a = v_user or user_b = v_user)
  ) then
    return jsonb_build_object('ok', false, 'code', 'already-partnered');
  end if;

  if exists (
    select 1 from public.partnerships
     where status = 'active'
       and (user_a = v_inv.inviter_id or user_b = v_inv.inviter_id)
  ) then
    return jsonb_build_object('ok', false, 'code', 'inviter-unavailable');
  end if;

  if exists (
    select 1 from public.partnership_blocks b
     where (b.blocker_id = v_user and b.blocked_id = v_inv.inviter_id)
        or (b.blocker_id = v_inv.inviter_id and b.blocked_id = v_user)
  ) then
    return jsonb_build_object('ok', false, 'code', 'blocked');
  end if;

  v_low := least(v_inv.inviter_id, v_user);
  v_high := greatest(v_inv.inviter_id, v_user);

  begin
    insert into public.partnerships (user_a, user_b)
    values (v_low, v_high)
    returning id into v_id;
  exception
    when unique_violation then
      return jsonb_build_object('ok', false, 'code', 'already-partnered');
  end;

  insert into public.partnership_shares (partnership_id, user_id)
  values (v_id, v_low), (v_id, v_high)
  on conflict do nothing;

  update public.partnership_invitations
     set status = 'accepted', responded_at = now()
   where id = v_inv.id;

  return jsonb_build_object('ok', true, 'partnership_id', v_id);
end;
$$;

create or replace function public.decline_partnership_invitation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_email text;
  v_inv public.partnership_invitations;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select lower(email) into v_email from auth.users where id = v_user;

  select * into v_inv
    from public.partnership_invitations
   where token = btrim(coalesce(p_token, ''))
     and status = 'pending'
     and expires_at > now();

  if not found
     or lower(v_inv.invitee_email) <> v_email
     or v_inv.inviter_id = v_user then
    return jsonb_build_object('ok', false, 'code', 'invalid-invitation');
  end if;

  update public.partnership_invitations
     set status = 'declined', responded_at = now()
   where id = v_inv.id;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.cancel_partnership_invitation(p_invitation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  update public.partnership_invitations
     set status = 'cancelled', responded_at = now()
   where id = p_invitation_id
     and inviter_id = v_user
     and status = 'pending';

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-invitation');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- Sharing, snapshots, encouragement, ending -------------------------------

create or replace function public.set_partnership_share(
  p_partnership_id uuid,
  p_goal_title boolean,
  p_completion boolean,
  p_milestone boolean,
  p_checkin boolean,
  p_milestone_text text,
  p_checkin_text text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_milestone text := nullif(btrim(coalesce(p_milestone_text, '')), '');
  v_checkin text := nullif(btrim(coalesce(p_checkin_text, '')), '');
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if not exists (
    select 1 from public.partnerships
     where id = p_partnership_id
       and status = 'active'
       and (user_a = v_user or user_b = v_user)
  ) then
    return jsonb_build_object('ok', false, 'code', 'no-partnership');
  end if;

  if coalesce(p_milestone, false) and v_milestone is null then
    return jsonb_build_object('ok', false, 'code', 'missing-milestone');
  end if;

  if coalesce(p_checkin, false) and v_checkin is null then
    return jsonb_build_object('ok', false, 'code', 'missing-checkin');
  end if;

  if v_milestone is not null and char_length(v_milestone) > 300 then
    return jsonb_build_object('ok', false, 'code', 'milestone-too-long');
  end if;

  if v_checkin is not null and char_length(v_checkin) > 1000 then
    return jsonb_build_object('ok', false, 'code', 'checkin-too-long');
  end if;

  insert into public.partnership_shares (
    partnership_id, user_id, share_goal_title, share_completion,
    share_milestone, share_checkin, milestone, checkin
  )
  values (
    p_partnership_id, v_user,
    coalesce(p_goal_title, false), coalesce(p_completion, false),
    coalesce(p_milestone, false), coalesce(p_checkin, false),
    case when coalesce(p_milestone, false) then v_milestone else null end,
    case when coalesce(p_checkin, false) then v_checkin else null end
  )
  on conflict (partnership_id, user_id) do update
    set share_goal_title = excluded.share_goal_title,
        share_completion = excluded.share_completion,
        share_milestone = excluded.share_milestone,
        share_checkin = excluded.share_checkin,
        -- Turning a switch off also removes the text behind it.
        milestone = excluded.milestone,
        checkin = excluded.checkin,
        updated_at = now();

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.my_partnership()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_p public.partnerships;
  v_partner uuid;
  v_name text;
  v_share public.partnership_shares;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_p
    from public.partnerships
   where status = 'active' and (user_a = v_user or user_b = v_user)
   limit 1;

  if not found then
    return jsonb_build_object('ok', true, 'partnership', null);
  end if;

  v_partner := case when v_p.user_a = v_user then v_p.user_b else v_p.user_a end;

  select coalesce(nullif(btrim(display_name), ''), 'Your partner')
    into v_name
    from public.profiles
   where id = v_partner;

  select * into v_share
    from public.partnership_shares
   where partnership_id = v_p.id and user_id = v_user;

  return jsonb_build_object(
    'ok', true,
    'partnership', jsonb_build_object(
      'id', v_p.id,
      'partner_name', coalesce(v_name, 'Your partner'),
      'started_at', v_p.started_at
    ),
    'share', jsonb_build_object(
      'goal_title', coalesce(v_share.share_goal_title, false),
      'completion', coalesce(v_share.share_completion, false),
      'milestone', coalesce(v_share.share_milestone, false),
      'checkin', coalesce(v_share.share_checkin, false),
      'milestone_text', v_share.milestone,
      'checkin_text', v_share.checkin
    )
  );
end;
$$;

create or replace function public.partner_snapshot(p_partnership_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_p public.partnerships;
  v_partner uuid;
  v_name text;
  v_share public.partnership_shares;
  v_goals jsonb;
  v_goals_total integer := 0;
  v_goals_done integer := 0;
  v_tasks_total integer := 0;
  v_tasks_done integer := 0;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_p
    from public.partnerships
   where id = p_partnership_id
     and status = 'active'
     and (user_a = v_user or user_b = v_user);

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-partnership');
  end if;

  v_partner := case when v_p.user_a = v_user then v_p.user_b else v_p.user_a end;

  select coalesce(nullif(btrim(display_name), ''), 'Your partner')
    into v_name
    from public.profiles
   where id = v_partner;

  select * into v_share
    from public.partnership_shares
   where partnership_id = v_p.id and user_id = v_partner;

  if not found then
    return jsonb_build_object(
      'ok', true,
      'partner_name', coalesce(v_name, 'Your partner'),
      'shared', jsonb_build_object()
    );
  end if;

  -- Counts only. No task titles, notes, saved work or timers.
  if v_share.share_completion then
    select count(*) into v_goals_total
      from public.goals
     where user_id = v_partner and archived_at is null;

    select count(*) into v_goals_done
      from public.goals g
     where g.user_id = v_partner
       and g.archived_at is null
       and exists (
         select 1 from public.tasks t
          where t.goal_id = g.id and t.status = 'completed'
       )
       and not exists (
         select 1 from public.tasks t
          where t.goal_id = g.id and t.status <> 'completed'
       );

    select count(*) into v_tasks_total
      from public.tasks t
      join public.goals g on g.id = t.goal_id
     where t.user_id = v_partner and g.archived_at is null;

    select count(*) into v_tasks_done
      from public.tasks t
      join public.goals g on g.id = t.goal_id
     where t.user_id = v_partner
       and g.archived_at is null
       and t.status = 'completed';
  end if;

  -- Titles only, and only the five most recent active goals.
  if v_share.share_goal_title then
    select coalesce(jsonb_agg(recent.title), '[]'::jsonb)
      into v_goals
      from (
        select g.title
          from public.goals g
         where g.user_id = v_partner and g.archived_at is null
         order by g.created_at desc
         limit 5
      ) as recent;
  end if;

  -- jsonb_strip_nulls means a switch that is off produces no key at all, so the
  -- partner's browser never receives the field name, let alone a value.
  return jsonb_build_object(
    'ok', true,
    'partner_name', coalesce(v_name, 'Your partner'),
    'shared', jsonb_strip_nulls(
      jsonb_build_object(
        'goal_titles', case when v_share.share_goal_title then coalesce(v_goals, '[]'::jsonb) else null end,
        'completion', case when v_share.share_completion then jsonb_build_object(
          'goals_total', v_goals_total,
          'goals_completed', v_goals_done,
          'tasks_total', v_tasks_total,
          'tasks_completed', v_tasks_done
        ) else null end,
        'milestone', case when v_share.share_milestone then v_share.milestone else null end,
        'checkin', case when v_share.share_checkin then v_share.checkin else null end,
        'updated_at', case
          when v_share.share_goal_title
            or v_share.share_completion
            or v_share.share_milestone
            or v_share.share_checkin
          then v_share.updated_at
          else null
        end
      )
    )
  );
end;
$$;

create or replace function public.send_encouragement(p_partnership_id uuid, p_body text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_day_start timestamptz := date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_today integer;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if not exists (
    select 1 from public.partnerships
     where id = p_partnership_id
       and status = 'active'
       and (user_a = v_user or user_b = v_user)
  ) then
    return jsonb_build_object('ok', false, 'code', 'no-partnership');
  end if;

  if char_length(v_body) < 1 or char_length(v_body) > 300 then
    return jsonb_build_object('ok', false, 'code', 'invalid-message');
  end if;

  if exists (
    select 1 from public.encouragement_messages
     where partnership_id = p_partnership_id
       and sender_id = v_user
       and created_at > now() - interval '5 seconds'
  ) then
    return jsonb_build_object('ok', false, 'code', 'slow-down');
  end if;

  select count(*) into v_today
    from public.encouragement_messages
   where partnership_id = p_partnership_id
     and sender_id = v_user
     and created_at >= v_day_start;

  if v_today >= 20 then
    return jsonb_build_object('ok', false, 'code', 'daily-limit', 'limit', 20);
  end if;

  insert into public.encouragement_messages (partnership_id, sender_id, body)
  values (p_partnership_id, v_user, v_body);

  return jsonb_build_object('ok', true, 'remaining', 20 - v_today - 1);
end;
$$;

create or replace function public.end_partnership(p_partnership_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  update public.partnerships
     set status = 'ended', ended_at = now(), ended_by = v_user
   where id = p_partnership_id
     and status = 'active'
     and (user_a = v_user or user_b = v_user);

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-partnership');
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.block_partner(p_partnership_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_p public.partnerships;
  v_partner uuid;
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_p
    from public.partnerships
   where id = p_partnership_id
     and status = 'active'
     and (user_a = v_user or user_b = v_user);

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-partnership');
  end if;

  v_partner := case when v_p.user_a = v_user then v_p.user_b else v_p.user_a end;

  insert into public.partnership_blocks (blocker_id, blocked_id)
  values (v_user, v_partner)
  on conflict (blocker_id, blocked_id) do nothing;

  update public.partnerships
     set status = 'ended', ended_at = now(), ended_by = v_user
   where id = v_p.id and status = 'active';

  -- Pending invitations between the two stop working as well.
  update public.partnership_invitations i
     set status = 'cancelled', responded_at = now()
   where i.status = 'pending'
     and (
       (i.inviter_id = v_user and lower(i.invitee_email) = (select lower(email) from auth.users where id = v_partner))
       or (i.inviter_id = v_partner and lower(i.invitee_email) = (select lower(email) from auth.users where id = v_user))
     );

  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.report_partner(
  p_partnership_id uuid,
  p_reason text,
  p_note text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := auth.uid();
  v_p public.partnerships;
  v_partner uuid;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if v_user is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  if coalesce(p_reason, '') not in ('harassment', 'spam', 'impersonation', 'other') then
    return jsonb_build_object('ok', false, 'code', 'invalid-reason');
  end if;

  if v_note is not null and char_length(v_note) > 500 then
    return jsonb_build_object('ok', false, 'code', 'note-too-long');
  end if;

  select * into v_p
    from public.partnerships
   where id = p_partnership_id
     and (user_a = v_user or user_b = v_user);

  if not found then
    return jsonb_build_object('ok', false, 'code', 'no-partnership');
  end if;

  v_partner := case when v_p.user_a = v_user then v_p.user_b else v_p.user_a end;

  insert into public.partnership_reports (partnership_id, reporter_id, reported_id, reason, note)
  values (v_p.id, v_user, v_partner, p_reason, v_note);

  -- Stored for the app owner to read. There is no automated moderation.
  return jsonb_build_object('ok', true, 'stored', true);
end;
$$;

revoke all on function public.create_partnership_invitation(text) from public, anon;
revoke all on function public.accept_partnership_invitation(text) from public, anon;
revoke all on function public.decline_partnership_invitation(text) from public, anon;
revoke all on function public.cancel_partnership_invitation(uuid) from public, anon;
revoke all on function public.set_partnership_share(uuid, boolean, boolean, boolean, boolean, text, text) from public, anon;
revoke all on function public.my_partnership() from public, anon;
revoke all on function public.partner_snapshot(uuid) from public, anon;
revoke all on function public.send_encouragement(uuid, text) from public, anon;
revoke all on function public.end_partnership(uuid) from public, anon;
revoke all on function public.block_partner(uuid) from public, anon;
revoke all on function public.report_partner(uuid, text, text) from public, anon;

grant execute on function public.create_partnership_invitation(text) to authenticated;
grant execute on function public.accept_partnership_invitation(text) to authenticated;
grant execute on function public.decline_partnership_invitation(text) to authenticated;
grant execute on function public.cancel_partnership_invitation(uuid) to authenticated;
grant execute on function public.set_partnership_share(uuid, boolean, boolean, boolean, boolean, text, text) to authenticated;
grant execute on function public.my_partnership() to authenticated;
grant execute on function public.partner_snapshot(uuid) to authenticated;
grant execute on function public.send_encouragement(uuid, text) to authenticated;
grant execute on function public.end_partnership(uuid) to authenticated;
grant execute on function public.block_partner(uuid) to authenticated;
grant execute on function public.report_partner(uuid, text, text) to authenticated;
