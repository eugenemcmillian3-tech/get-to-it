-- GET TO IT — Phase 7 schema
-- A template library and goal organization.
--
-- The public library lives in code (`src/lib/templates/library.ts`), so using a
-- static template never touches the database and never needs an AI call. This
-- migration adds the two things the database does need to own:
--   * private personal templates, one row per person, protected by RLS;
--   * goal category and archive state, so goals can be searched and filtered.
--
-- Personal templates deliberately have no columns for saved work, reflections or
-- AI answers: there is nowhere to put private content even if a caller wanted
-- to copy it.

do $$
begin
  create type public.goal_category as enum (
    'launch',
    'job',
    'content',
    'learn',
    'personal',
    'business'
  );
exception
  when duplicate_object then null;
end $$;

-- Personal templates -----------------------------------------------------

create table if not exists public.goal_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 3 and 120),
  description text not null
    check (char_length(btrim(description)) between 3 and 1000),
  desired_outcome text not null
    check (char_length(btrim(desired_outcome)) between 5 and 2000),
  category public.goal_category,
  -- [{ title, estimated_minutes, example_deliverable }] — titles and times only.
  steps jsonb not null default '[]'::jsonb
    check (jsonb_typeof(steps) = 'array' and jsonb_array_length(steps) <= 12),
  -- Provenance only: deleting the goal this came from leaves the template alone.
  source_goal_id uuid references public.goals (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Goal organization ------------------------------------------------------

alter table public.goals
  add column if not exists category public.goal_category;

alter table public.goals
  add column if not exists archived_at timestamptz;

alter table public.goals
  add column if not exists template_id uuid
    references public.goal_templates (id) on delete set null;

create index if not exists goals_user_archived_created_idx
  on public.goals (user_id, archived_at, created_at desc);

create index if not exists goals_user_category_idx
  on public.goals (user_id, category);

create index if not exists goal_templates_user_created_idx
  on public.goal_templates (user_id, created_at desc);

-- Timestamps -------------------------------------------------------------

drop trigger if exists goal_templates_set_updated_at on public.goal_templates;
create trigger goal_templates_set_updated_at
  before update on public.goal_templates
  for each row execute function public.set_updated_at();

-- Row Level Security -----------------------------------------------------
-- Same rule as every other table: a person sees and changes only their own
-- templates, and nothing else can reach them.

alter table public.goal_templates enable row level security;

drop policy if exists "templates are private to their owner" on public.goal_templates;
create policy "templates are private to their owner"
  on public.goal_templates for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.goal_templates from anon;
grant select, insert, update, delete on public.goal_templates to authenticated;
