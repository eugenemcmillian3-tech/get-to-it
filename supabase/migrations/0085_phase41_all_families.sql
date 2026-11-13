-- GET TO IT — Phase 41: one program across every installed family.
--
-- Two families now exist, and comparing them inside one program must not become a
-- single blended score: the families measure different things, and an average of
-- their pass rates would be a number that answers no question. So a program may
-- register "all installed families", and the report keeps every family's numbers
-- and claim separate. There is no pooled mean score anywhere in the output.
--
-- What changes:
--   * `performance_programs.scope` is `one_family` or `all_families`, and
--     `family_keys` names exactly the families the program registered. A program
--     that claims every family must register every family that is installed at
--     registration time; a later-installed family is not silently added.
--   * Each trial records the family its task belongs to. The trigger derives it
--     from the installed family record and refuses a task from a family the
--     program did not register.
--   * The report returns a `families` array, one entry per registered family with
--     its own baseline, candidate, effect and claim verdict. The program's claim
--     is supported only when every family supports it on its own; the top-level
--     numbers are counts, not a combined score.

alter table public.performance_programs
  add column if not exists scope text not null default 'one_family'
    check (scope in ('one_family', 'all_families'));

alter table public.performance_programs
  add column if not exists family_keys text[] not null default '{}';

update public.performance_programs
   set family_keys = array[task_family]
 where cardinality(family_keys) = 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint c
     where c.conname = 'performance_programs_family_keys_check'
       and c.conrelid = 'public.performance_programs'::regclass
  ) then
    alter table public.performance_programs
      add constraint performance_programs_family_keys_check
      check (cardinality(family_keys) between 1 and 8);
  end if;
end;
$$;

-- 0083 pinned the distribution suite to task_family. A program across every family
-- registers the combined suite ("all") instead, so the check becomes scope-aware.
alter table public.performance_programs
  drop constraint if exists performance_programs_check;

alter table public.performance_programs
  drop constraint if exists performance_programs_scope_suite_check;

alter table public.performance_programs
  add constraint performance_programs_scope_suite_check
  check (
    (scope = 'all_families' and distribution ->> 'suite' = 'all')
    or (scope = 'one_family' and distribution ->> 'suite' = task_family)
  );

alter table public.performance_trials
  add column if not exists family_key text references public.performance_task_families (key);

update public.performance_trials t
   set family_key = f.key
  from public.performance_task_families f
 where t.family_key is null
   and t.task_key = any (f.task_keys);

alter table public.performance_trials alter column family_key set not null;

create index if not exists performance_trials_family_idx
  on public.performance_trials (program_id, family_key);

comment on column public.performance_trials.family_key is
  'The installed family the task belongs to, derived by the guard. Per-family reporting never has to guess it from a task key.';

comment on column public.performance_programs.scope is
  'one_family compares a single installed family; all_families registers every family installed at registration and reports each separately.';

-- ---------------------------------------------------------------------------
-- Registration: one family or every installed family
-- ---------------------------------------------------------------------------

create or replace function public.performance_programs_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_family public.performance_task_families;
  v_entries jsonb;
  v_entry jsonb;
  v_keys jsonb;
  v_family_keys text[] := '{}';
  v_key text;
  v_installed integer;
begin
  if new.scope = 'all_families' then
    if (new.distribution ->> 'suite') is distinct from 'all' then
      raise exception 'a program across every family registers the combined distribution';
    end if;
    v_entries := new.distribution -> 'families';
    if v_entries is null or jsonb_typeof(v_entries) <> 'array' then
      raise exception 'a program across every family must list the families it registers';
    end if;
    select count(*) into v_installed from public.performance_task_families;
    if jsonb_array_length(v_entries) <> v_installed then
      raise exception 'a program across every family must register all % installed families', v_installed;
    end if;
  else
    v_entries := jsonb_build_array(
      jsonb_build_object(
        'key', new.task_family,
        'version', new.distribution ->> 'version',
        'digest', new.distribution ->> 'digest',
        'task_keys', new.distribution -> 'task_keys'
      )
    );
  end if;

  for v_entry in select * from jsonb_array_elements(v_entries)
  loop
    v_key := v_entry ->> 'key';
    select * into v_family from public.performance_task_families f where f.key = v_key;
    if not found then
      raise exception 'the task family % is not installed', coalesce(v_key, '(none)');
    end if;
    if (v_entry ->> 'digest') is distinct from v_family.suite_digest then
      raise exception 'the registered suite digest for % does not match the installed family', v_key;
    end if;
    if (v_entry ->> 'version') is distinct from v_family.version then
      raise exception 'the registered suite version for % does not match the installed family', v_key;
    end if;
    if v_key = any (v_family_keys) then
      raise exception 'the registered distribution lists the family % twice', v_key;
    end if;
    v_family_keys := array_append(v_family_keys, v_key);

    v_keys := coalesce(v_entry -> 'task_keys', '[]'::jsonb);
    if jsonb_typeof(v_keys) <> 'array' or jsonb_array_length(v_keys) = 0 then
      raise exception 'the task distribution for % must list its task keys', v_key;
    end if;
    if exists (
      select 1
        from jsonb_array_elements_text(v_keys) as key
       where not (key = any (v_family.task_keys))
    ) then
      raise exception 'a registered task for % is not part of the installed family', v_key;
    end if;
    if (select count(distinct value) from jsonb_array_elements_text(v_keys)) <> jsonb_array_length(v_keys) then
      raise exception 'the task distribution for % lists the same task twice', v_key;
    end if;
  end loop;

  if new.scope = 'all_families' then
    if (select array_agg(x order by x) from unnest(v_family_keys) as x) <> (
      select array_agg(f.key order by f.key) from public.performance_task_families f
    ) then
      raise exception 'a program across every family must register every installed family exactly once';
    end if;
  elsif (new.distribution ->> 'suite') is distinct from new.task_family then
    raise exception 'the registered suite does not match the task family';
  end if;

  if (select coalesce(sum(jsonb_array_length(e.value -> 'task_keys')), 0)
        from jsonb_array_elements(v_entries) e)
     <> jsonb_array_length(new.distribution -> 'task_keys') then
    raise exception 'the combined task list must match the registered families';
  end if;

  if (select count(*) from jsonb_array_elements_text(new.distribution -> 'task_keys')) * new.trials > 2400 then
    raise exception 'the registered trial plan is larger than one comparison may hold';
  end if;

  new.family_keys := v_family_keys;

  if tg_op = 'INSERT' then
    if new.status = 'closed' then
      raise exception 'a comparison cannot be inserted as closed';
    end if;
    if new.status = 'registered'
       and (new.fingerprint is null or new.registered_at is null or new.registered_by is null) then
      raise exception 'registration records the fingerprint, the person and the time';
    end if;
    return new;
  end if;

  if old.status = 'closed' then
    raise exception 'a closed comparison cannot be changed';
  end if;

  if old.status = 'registered' then
    if new.status = 'closed' then
      if new.closed_at is null then
        raise exception 'closing a comparison records when it closed';
      end if;
      if new.title is distinct from old.title
         or new.question is distinct from old.question
         or new.scope is distinct from old.scope
         or new.task_family is distinct from old.task_family
         or new.family_keys is distinct from old.family_keys
         or new.distribution is distinct from old.distribution
         or new.inclusion_rules is distinct from old.inclusion_rules
         or new.exclusion_rules is distinct from old.exclusion_rules
         or new.scoring_method is distinct from old.scoring_method
         or new.baseline_label is distinct from old.baseline_label
         or new.baseline_config is distinct from old.baseline_config
         or new.candidate_label is distinct from old.candidate_label
         or new.candidate_config is distinct from old.candidate_config
         or new.permitted_tools is distinct from old.permitted_tools
         or new.time_limit_seconds is distinct from old.time_limit_seconds
         or new.cost_limit_cents is distinct from old.cost_limit_cents
         or new.trials is distinct from old.trials
         or new.human_assistance_policy is distinct from old.human_assistance_policy
         or new.failure_criteria is distinct from old.failure_criteria
         or new.supported_claim is distinct from old.supported_claim
         or new.claim_text is distinct from old.claim_text
         or new.minimum_effect is distinct from old.minimum_effect
         or new.noninferiority_margin is distinct from old.noninferiority_margin
         or new.max_disagreements is distinct from old.max_disagreements
         or new.fingerprint is distinct from old.fingerprint
         or new.registered_at is distinct from old.registered_at
         or new.registered_by is distinct from old.registered_by then
        raise exception 'the registered comparison is frozen; record a new program instead';
      end if;
      return new;
    end if;
    raise exception 'the registered comparison is frozen; record a new program instead';
  end if;

  if new.status = 'registered' then
    if new.fingerprint is null or new.registered_at is null or new.registered_by is null then
      raise exception 'registration records the fingerprint, the person and the time';
    end if;
    return new;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trials: the family comes from the task, not from the client
-- ---------------------------------------------------------------------------

create or replace function public.performance_trials_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_program public.performance_programs;
  v_family public.performance_task_families;
begin
  select * into v_program from public.performance_programs p where p.id = new.program_id;
  if not found then
    raise exception 'the comparison does not exist';
  end if;
  if v_program.status = 'draft' then
    raise exception 'register the comparison before recording a trial';
  end if;
  if v_program.status = 'closed' then
    raise exception 'this comparison is closed';
  end if;
  if new.workspace_id is distinct from v_program.workspace_id then
    raise exception 'a trial belongs to the workspace of its comparison';
  end if;
  if new.trial > v_program.trials then
    raise exception 'the registered plan allows % trials', v_program.trials;
  end if;

  select * into v_family
    from public.performance_task_families f
   where new.task_key = any (f.task_keys)
   limit 1;
  if not found then
    raise exception 'that task is outside the registered distribution';
  end if;
  new.family_key := v_family.key;

  if not (v_family.key = any (v_program.family_keys)) then
    raise exception 'that task belongs to a family this comparison did not register';
  end if;
  if not ((v_program.distribution -> 'task_keys') ? new.task_key) then
    raise exception 'that task was not part of this comparison''s registered distribution';
  end if;

  if not exists (
    select 1 from public.workspace_members m
     where m.workspace_id = v_program.workspace_id
       and m.user_id = new.recorded_by
       and m.status = 'active'
  ) then
    raise exception 'only a member of the workspace can record a trial';
  end if;

  if new.source = 'capability_run' and not exists (
    select 1
      from public.capability_eval_runs r
      join public.capability_evals e on e.id = r.eval_id
      join public.workspace_members m on m.user_id = e.user_id
     where r.id = new.source_id
       and m.workspace_id = v_program.workspace_id
       and m.status = 'active'
  ) then
    raise exception 'that capability run does not belong to a member of this workspace';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Reads: list adds the scope and the registered families
-- ---------------------------------------------------------------------------

create or replace function public.workspace_performance_programs(p_workspace_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_me uuid := auth.uid();
  v_rows jsonb;
  v_total integer;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;
  if public.workspace_role(p_workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'no-workspace');
  end if;

  select count(*) into v_total
    from public.performance_programs p
   where p.workspace_id = p_workspace_id;

  select coalesce(
           jsonb_agg(
             jsonb_build_object(
               'id', p.id,
               'title', p.title,
               'status', p.status,
               'scope', p.scope,
               'task_family', p.task_family,
               'family_keys', to_jsonb(p.family_keys),
               'families', coalesce(
                 (select jsonb_agg(entry.value ->> 'key')
                    from jsonb_array_elements(
                      coalesce(p.distribution -> 'families', '[]'::jsonb)
                    ) as entry),
                 jsonb_build_array(p.task_family)
               ),
               'supported_claim', p.supported_claim,
               'claim_text', p.claim_text,
               'baseline_label', p.baseline_label,
               'candidate_label', p.candidate_label,
               'trials', p.trials,
               'tasks', jsonb_array_length(p.distribution -> 'task_keys'),
               'expected_rows', jsonb_array_length(p.distribution -> 'task_keys') * p.trials * 2,
               'registered_at', p.registered_at,
               'created_at', p.created_at,
               'trial_rows', (
                 select count(*) from public.performance_trials t where t.program_id = p.id
               ),
               'baseline_rows', (
                 select count(*) from public.performance_trials t
                  where t.program_id = p.id and t.config = 'baseline'
               ),
               'candidate_rows', (
                 select count(*) from public.performance_trials t
                  where t.program_id = p.id and t.config = 'candidate'
               ),
               'human_references', (
                 select count(*) from public.performance_human_references h where h.program_id = p.id
               ),
               'disagreements', (
                 select count(*) from public.performance_review_marks m
                  where m.program_id = p.id and m.verdict = 'disagree'
               )
             )
             order by p.created_at desc
           ),
           '[]'::jsonb
         )
    into v_rows
    from public.performance_programs p
   where p.workspace_id = p_workspace_id;

  return jsonb_build_object('ok', true, 'total', v_total, 'programs', v_rows);
end;
$$;

-- ---------------------------------------------------------------------------
-- Report: every family gets its own numbers and its own verdict
-- ---------------------------------------------------------------------------

create or replace function public.workspace_performance_report(p_program_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
stable
as $$
declare
  v_me uuid := auth.uid();
  v_program public.performance_programs;
  v_entries jsonb;
  v_entry jsonb;
  v_family public.performance_task_families;
  v_key text;
  v_tasks integer;
  v_expected integer;

  v_b_rows integer;
  v_b_tasks integer;
  v_b_passes integer;
  v_b_partials integer;
  v_b_fails integer;
  v_b_mean numeric;
  v_b_cost_cents numeric;
  v_b_cost_units numeric;
  v_b_median numeric;
  v_b_max_cost integer;
  v_b_max_duration integer;
  v_b_human integer;

  v_c_rows integer;
  v_c_tasks integer;
  v_c_passes integer;
  v_c_partials integer;
  v_c_fails integer;
  v_c_mean numeric;
  v_c_cost_cents numeric;
  v_c_cost_units numeric;
  v_c_median numeric;
  v_c_max_cost integer;
  v_c_max_duration integer;
  v_c_human integer;

  v_gain numeric;
  v_cost_pct numeric;
  v_duration_pct numeric;
  v_noninf boolean;
  v_assist_ok boolean;
  v_limits_ok boolean;
  v_complete boolean;
  v_supported boolean;
  v_verdict text;
  v_reasons text[];

  v_families jsonb := '[]'::jsonb;
  v_all_reasons text[] := '{}';
  v_all_supported boolean := true;
  v_all_complete boolean := true;
  v_all_noninf boolean := true;
  v_all_assist boolean := true;
  v_all_limits boolean := true;
  v_total_b integer := 0;
  v_total_c integer := 0;
  v_reviewed integer := 0;
  v_disagreements integer := 0;
  v_refs integer := 0;
  v_participants integer := 0;
  v_reviews_ok boolean;
begin
  if v_me is null then
    return jsonb_build_object('ok', false, 'code', 'unauthenticated');
  end if;

  select * into v_program from public.performance_programs p where p.id = p_program_id;
  if not found then
    return jsonb_build_object('ok', false, 'code', 'not-found');
  end if;
  if public.workspace_role(v_program.workspace_id) is null then
    return jsonb_build_object('ok', false, 'code', 'no-workspace');
  end if;

  select count(*) into v_reviewed
    from public.performance_review_marks m
   where m.program_id = p_program_id;
  select count(*) into v_disagreements
    from public.performance_review_marks m
   where m.program_id = p_program_id and m.verdict = 'disagree';
  select count(*), coalesce(sum(h.participants), 0)
    into v_refs, v_participants
    from public.performance_human_references h
   where h.program_id = p_program_id;
  v_reviews_ok := v_disagreements <= v_program.max_disagreements;

  v_entries := coalesce(
    v_program.distribution -> 'families',
    jsonb_build_array(jsonb_build_object('key', v_program.task_family))
  );

  for v_entry in select * from jsonb_array_elements(v_entries)
  loop
    v_key := v_entry ->> 'key';
    select * into v_family from public.performance_task_families f where f.key = v_key;
    v_tasks := jsonb_array_length(coalesce(v_entry -> 'task_keys', to_jsonb(v_family.task_keys)));
    v_expected := v_tasks * v_program.trials;
    v_reasons := '{}';

    select
      count(*),
      count(distinct task_key),
      count(*) filter (where outcome = 'pass'),
      count(*) filter (where outcome = 'partial'),
      count(*) filter (where outcome = 'fail'),
      coalesce(avg(score), 0),
      coalesce(avg(cost_cents), 0),
      coalesce(avg(cost_units), 0),
      percentile_cont(0.5) within group (order by duration_ms),
      coalesce(max(cost_cents), 0),
      coalesce(max(duration_ms), 0),
      count(*) filter (where human_assisted)
    into
      v_b_rows, v_b_tasks, v_b_passes, v_b_partials, v_b_fails, v_b_mean,
      v_b_cost_cents, v_b_cost_units, v_b_median, v_b_max_cost, v_b_max_duration, v_b_human
    from public.performance_trials t
    where t.program_id = p_program_id
      and t.family_key = v_key
      and t.config = 'baseline';

    select
      count(*),
      count(distinct task_key),
      count(*) filter (where outcome = 'pass'),
      count(*) filter (where outcome = 'partial'),
      count(*) filter (where outcome = 'fail'),
      coalesce(avg(score), 0),
      coalesce(avg(cost_cents), 0),
      coalesce(avg(cost_units), 0),
      percentile_cont(0.5) within group (order by duration_ms),
      coalesce(max(cost_cents), 0),
      coalesce(max(duration_ms), 0),
      count(*) filter (where human_assisted)
    into
      v_c_rows, v_c_tasks, v_c_passes, v_c_partials, v_c_fails, v_c_mean,
      v_c_cost_cents, v_c_cost_units, v_c_median, v_c_max_cost, v_c_max_duration, v_c_human
    from public.performance_trials t
    where t.program_id = p_program_id
      and t.family_key = v_key
      and t.config = 'candidate';

    v_total_b := v_total_b + v_b_rows;
    v_total_c := v_total_c + v_c_rows;

    v_complete := v_b_rows = v_expected and v_c_rows = v_expected;
    v_gain := round(v_c_mean - v_b_mean, 4);
    v_cost_pct := case
      when v_b_cost_cents > 0 then round((v_b_cost_cents - v_c_cost_cents) / v_b_cost_cents * 100, 2)
      else null
    end;
    v_duration_pct := case
      when v_b_median is not null and v_b_median > 0 and v_c_median is not null
        then round((v_b_median - v_c_median) / v_b_median * 100, 2)
      else null
    end;
    v_noninf := v_c_mean + v_program.noninferiority_margin >= v_b_mean;
    v_assist_ok := v_c_human <= v_b_human;
    v_limits_ok := v_b_max_cost <= v_program.cost_limit_cents
      and v_c_max_cost <= v_program.cost_limit_cents
      and v_b_max_duration <= v_program.time_limit_seconds * 1000
      and v_c_max_duration <= v_program.time_limit_seconds * 1000;

    if not v_complete then
      v_reasons := array_append(
        v_reasons,
        format(
          '%s: %s of %s planned trials are recorded for the baseline and %s of %s for the candidate.',
          v_family.key, v_b_rows, v_expected, v_c_rows, v_expected
        )
      );
    end if;
    if not v_limits_ok then
      v_reasons := array_append(
        v_reasons,
        format('%s: a trial exceeded the registered cost or time limit.', v_family.key)
      );
    end if;
    if not v_reviews_ok then
      v_reasons := array_append(
        v_reasons,
        format(
          '%s: independent review disagrees on %s marked trials, above the allowance of %s.',
          v_family.key, v_disagreements, v_program.max_disagreements
        )
      );
    end if;
    if not v_assist_ok then
      v_reasons := array_append(
        v_reasons,
        format(
          '%s: the candidate needed human assistance in %s trials versus %s for the baseline.',
          v_family.key, v_c_human, v_b_human
        )
      );
    end if;
    if not v_noninf then
      v_reasons := array_append(
        v_reasons,
        format(
          '%s: the candidate scored %s below the baseline, more than the allowed margin of %s.',
          v_family.key, round(v_b_mean - v_c_mean, 4), v_program.noninferiority_margin
        )
      );
    end if;

    if v_program.supported_claim in ('benchmark', 'distribution') then
      if v_gain < v_program.minimum_effect then
        v_reasons := array_append(
          v_reasons,
          format(
            '%s: mean score improved by %s points, below the registered minimum effect of %s.',
            v_family.key, v_gain, v_program.minimum_effect
          )
        );
      end if;
      if v_program.supported_claim = 'distribution' and v_refs = 0 then
        v_reasons := array_append(
          v_reasons,
          format(
            '%s: no documented human reference exists for the real-world distribution, so this stays a benchmark result.',
            v_family.key
          )
        );
      end if;
    elsif v_program.supported_claim = 'faster' then
      if v_b_median is null or v_c_median is null then
        v_reasons := array_append(
          v_reasons,
          format('%s: latency was not recorded for both configurations.', v_family.key)
        );
      elsif v_duration_pct < v_program.minimum_effect then
        v_reasons := array_append(
          v_reasons,
          format(
            '%s: median latency fell by %s percent, below the registered minimum effect of %s percent.',
            v_family.key, v_duration_pct, v_program.minimum_effect
          )
        );
      end if;
    elsif v_program.supported_claim = 'lower_cost' then
      if v_cost_pct is null then
        v_reasons := array_append(
          v_reasons,
          format('%s: neither configuration recorded a measured cost.', v_family.key)
        );
      elsif v_cost_pct < v_program.minimum_effect then
        v_reasons := array_append(
          v_reasons,
          format(
            '%s: mean cost fell by %s percent, below the registered minimum effect of %s percent.',
            v_family.key, v_cost_pct, v_program.minimum_effect
          )
        );
      end if;
    end if;

    v_supported := v_complete and cardinality(v_reasons) = 0;
    v_verdict := case
      when not v_complete then 'awaiting_evidence'
      when v_supported then 'supported'
      else 'not_supported'
    end;

    v_families := v_families || jsonb_build_array(
      jsonb_build_object(
        'key', v_family.key,
        'version', v_family.version,
        'digest', v_family.suite_digest,
        'task_keys', coalesce(v_entry -> 'task_keys', to_jsonb(v_family.task_keys)),
        'tasks', v_tasks,
        'expected_rows', v_expected,
        'baseline', jsonb_build_object(
          'rows', v_b_rows, 'tasks', v_b_tasks,
          'passes', v_b_passes, 'partials', v_b_partials, 'fails', v_b_fails,
          'mean_score', round(v_b_mean, 4),
          'mean_cost_cents', round(v_b_cost_cents, 2),
          'mean_cost_units', round(v_b_cost_units, 2),
          'median_duration_ms', v_b_median,
          'max_cost_cents', v_b_max_cost,
          'max_duration_ms', v_b_max_duration,
          'human_assisted', v_b_human
        ),
        'candidate', jsonb_build_object(
          'rows', v_c_rows, 'tasks', v_c_tasks,
          'passes', v_c_passes, 'partials', v_c_partials, 'fails', v_c_fails,
          'mean_score', round(v_c_mean, 4),
          'mean_cost_cents', round(v_c_cost_cents, 2),
          'mean_cost_units', round(v_c_cost_units, 2),
          'median_duration_ms', v_c_median,
          'max_cost_cents', v_c_max_cost,
          'max_duration_ms', v_c_max_duration,
          'human_assisted', v_c_human
        ),
        'effect', jsonb_build_object(
          'score_gain', v_gain,
          'cost_reduction_pct', v_cost_pct,
          'latency_reduction_pct', v_duration_pct,
          'within_noninferiority', v_noninf,
          'assistance_matched', v_assist_ok,
          'within_limits', v_limits_ok
        ),
        'claim', jsonb_build_object(
          'supported', v_supported,
          'verdict', v_verdict,
          'complete', v_complete,
          'reasons', to_jsonb(v_reasons)
        )
      )
    );

    v_all_reasons := v_all_reasons || v_reasons;
    v_all_supported := v_all_supported and v_supported;
    v_all_complete := v_all_complete and v_complete;
    v_all_noninf := v_all_noninf and v_noninf;
    v_all_assist := v_all_assist and v_assist_ok;
    v_all_limits := v_all_limits and v_limits_ok;
  end loop;

  if not v_reviews_ok and cardinality(v_all_reasons) = 0 then
    v_all_reasons := array_append(
      v_all_reasons,
      format(
        'Independent review disagrees on %s marked trials, above the registered allowance of %s.',
        v_disagreements, v_program.max_disagreements
      )
    );
  end if;

  v_verdict := case
    when not v_all_complete then 'awaiting_evidence'
    when v_all_supported and cardinality(v_all_reasons) = 0 then 'supported'
    else 'not_supported'
  end;

  return jsonb_build_object(
    'ok', true,
    'scope', v_program.scope,
    'program', to_jsonb(v_program),
    'family', jsonb_build_object(
      'key', v_program.task_family,
      'version', (select f.version from public.performance_task_families f where f.key = v_program.task_family),
      'suite_digest', (select f.suite_digest from public.performance_task_families f where f.key = v_program.task_family),
      'task_keys', to_jsonb(coalesce(v_program.distribution -> 'task_keys', '[]'::jsonb)),
      'description', (select f.description from public.performance_task_families f where f.key = v_program.task_family)
    ),
    'families', v_families,
    'plan', jsonb_build_object(
      'tasks', jsonb_array_length(v_program.distribution -> 'task_keys'),
      'trials', v_program.trials,
      'expected_rows', jsonb_array_length(v_program.distribution -> 'task_keys') * v_program.trials * 2
    ),
    'baseline', jsonb_build_object(
      'rows', v_total_b,
      'tasks', (select count(distinct task_key) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline'),
      'passes', (select count(*) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline' and t.outcome = 'pass'),
      'partials', (select count(*) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline' and t.outcome = 'partial'),
      'fails', (select count(*) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline' and t.outcome = 'fail'),
      'mean_score', (select round(coalesce(avg(score), 0), 4) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline'),
      'mean_cost_cents', (select round(coalesce(avg(cost_cents), 0), 2) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline'),
      'mean_cost_units', (select round(coalesce(avg(cost_units), 0), 2) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline'),
      'median_duration_ms', (select percentile_cont(0.5) within group (order by duration_ms) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline'),
      'max_cost_cents', (select coalesce(max(cost_cents), 0) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline'),
      'max_duration_ms', (select coalesce(max(duration_ms), 0) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline'),
      'human_assisted', (select count(*) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline' and t.human_assisted)
    ),
    'candidate', jsonb_build_object(
      'rows', v_total_c,
      'tasks', (select count(distinct task_key) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate'),
      'passes', (select count(*) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate' and t.outcome = 'pass'),
      'partials', (select count(*) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate' and t.outcome = 'partial'),
      'fails', (select count(*) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate' and t.outcome = 'fail'),
      'mean_score', (select round(coalesce(avg(score), 0), 4) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate'),
      'mean_cost_cents', (select round(coalesce(avg(cost_cents), 0), 2) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate'),
      'mean_cost_units', (select round(coalesce(avg(cost_units), 0), 2) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate'),
      'median_duration_ms', (select percentile_cont(0.5) within group (order by duration_ms) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate'),
      'max_cost_cents', (select coalesce(max(cost_cents), 0) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate'),
      'max_duration_ms', (select coalesce(max(duration_ms), 0) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate'),
      'human_assisted', (select count(*) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate' and t.human_assisted)
    ),
    'effect', jsonb_build_object(
      'score_gain', (select round(coalesce(avg(score), 0), 4) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate')
        - (select round(coalesce(avg(score), 0), 4) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline'),
      'pooled', v_program.scope = 'all_families',
      'cost_reduction_pct', case
        when (select coalesce(avg(cost_cents), 0) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline') > 0
          then round(((
            (select coalesce(avg(cost_cents), 0) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline')
            - (select coalesce(avg(cost_cents), 0) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate')
          ) / (select coalesce(avg(cost_cents), 0) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline') * 100)::numeric, 2)
        else null
      end,
      'latency_reduction_pct', case
        when (select percentile_cont(0.5) within group (order by duration_ms) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline') > 0
          and (select percentile_cont(0.5) within group (order by duration_ms) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate') is not null
          then round(((
            (select percentile_cont(0.5) within group (order by duration_ms) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline')
            - (select percentile_cont(0.5) within group (order by duration_ms) from public.performance_trials t where t.program_id = p_program_id and t.config = 'candidate')
          ) / (select percentile_cont(0.5) within group (order by duration_ms) from public.performance_trials t where t.program_id = p_program_id and t.config = 'baseline') * 100)::numeric, 2)
        else null
      end,
      'within_noninferiority', v_all_noninf,
      'assistance_matched', v_all_assist,
      'within_limits', v_all_limits
    ),
    'reviews', jsonb_build_object(
      'reviewed', v_reviewed,
      'marked_trials', v_reviewed,
      'disagreements', v_disagreements,
      'max_disagreements', v_program.max_disagreements,
      'separated_from_recorder', true
    ),
    'human_references', jsonb_build_object(
      'count', v_refs,
      'participants', v_participants
    ),
    'claims', jsonb_build_object(
      'registered', v_program.supported_claim,
      'supported', v_all_supported and cardinality(v_all_reasons) = 0,
      'verdict', v_verdict,
      'complete', v_all_complete,
      'scope', v_program.scope,
      'pooled', v_program.scope = 'all_families',
      'reasons', to_jsonb(v_all_reasons),
      'refused', jsonb_build_array(
        jsonb_build_object(
          'claim', 'general_capability',
          'reason', 'One authored task family cannot support a broader general-capability claim, whatever the score on it.'
        ),
        jsonb_build_object(
          'claim', case when v_program.supported_claim = 'faster' then 'lower_cost' else 'faster' end,
          'reason', 'This program registered one claim only; the other comparison is not supported by evidence it did not collect.'
        ),
        jsonb_build_object(
          'claim', 'distribution',
          'reason', case
            when v_program.supported_claim = 'distribution' then 'Registered as this program''s claim; supported only with a documented human reference.'
            else 'The tasks are an authored benchmark, not a sample of a real-world task distribution.'
          end
        )
      )
    )
  );
end;
$$;

revoke all on function public.workspace_performance_report(uuid) from public, anon;
grant execute on function public.workspace_performance_report(uuid) to authenticated;
revoke all on function public.workspace_performance_programs(uuid) from public, anon;
grant execute on function public.workspace_performance_programs(uuid) to authenticated;
