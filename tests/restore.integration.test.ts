import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExportBundle, type ExportSource } from "@/lib/export";
import { parseImportFile, importRows } from "@/lib/import";
import { inspectPostgresSchema, testPostgresConnection } from "@/lib/integrations/database";

/**
 * Restore and authorization drill against an ISOLATED database.
 *
 * It never touches the live application database: the runner starts an embedded
 * Postgres in a temporary directory, creates a database called `restore_test`,
 * and this test refuses to run unless `current_database()` says so. No production
 * usage counter, quota or credential is read or changed.
 *
 * The drill replays every migration from scratch, seeds two accounts, then:
 *   * builds an export from one account's rows,
 *   * imports it back additively and checks the counts and content,
 *   * proves Row Level Security still isolates the two accounts,
 *   * deletes an account and checks what is removed and what is retained,
 *   * checks the health probe.
 */

const connectionString = process.env.RESTORE_TEST_DATABASE_URL;

const describeRestore = connectionString ? describe : describe.skip;

const EXPECTED_CORE_TABLES = 84;

type Seeded = {
  userId: string;
  email: string;
  goalId: string;
  taskId: string;
  otherGoalId: string;
  futurePathId: string;
  reviewId: string;
  radarSignalId: string;
  workspaceId: string;
  missionId: string;
  outcomeReviewId: string;
  improvementProposalId: string;
  appProjectId: string;
  appSpecId: string;
  appFileId: string;
  appVersionId: string;
};

describeRestore("isolated restore and authorization drill", () => {
  let client: Client;
  const accountA: Seeded = {
    userId: randomUUID(),
    email: `restore-a-${randomUUID()}@example.test`,
    goalId: randomUUID(),
    taskId: randomUUID(),
    otherGoalId: randomUUID(),
    futurePathId: randomUUID(),
    reviewId: randomUUID(),
    radarSignalId: randomUUID(),
    workspaceId: randomUUID(),
    missionId: randomUUID(),
    outcomeReviewId: randomUUID(),
    improvementProposalId: randomUUID(),
    appProjectId: randomUUID(),
    appSpecId: randomUUID(),
    appFileId: randomUUID(),
    appVersionId: randomUUID(),
  };
  const accountB: Seeded = {
    userId: randomUUID(),
    email: `restore-b-${randomUUID()}@example.test`,
    goalId: randomUUID(),
    taskId: randomUUID(),
    otherGoalId: randomUUID(),
    futurePathId: randomUUID(),
    reviewId: randomUUID(),
    radarSignalId: randomUUID(),
    workspaceId: randomUUID(),
    missionId: randomUUID(),
    outcomeReviewId: randomUUID(),
    improvementProposalId: randomUUID(),
    appProjectId: randomUUID(),
    appSpecId: randomUUID(),
    appFileId: randomUUID(),
    appVersionId: randomUUID(),
  };

  beforeAll(async () => {
    if (!connectionString) return;

    client = new Client({ connectionString });
    await client.connect();

    const name = await client.query<{ name: string }>("select current_database() as name");
    if (!name.rows[0]?.name.includes("restore_test")) {
      throw new Error(
        "Refusing to run: RESTORE_TEST_DATABASE_URL must point at a database whose name contains restore_test.",
      );
    }

    // Minimal Supabase auth shim, so the real migrations can run unchanged.
    await client.query(`
      do $$
      begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then
          create role anon nologin;
        end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then
          create role authenticated nologin;
        end if;
      end $$;
    `);
    // Supabase grants the API roles default privileges on new objects in
    // `public`; migrations then revoke what must stay server-only. Without this,
    // the drill would test a stricter database than the hosted one.
    await client.query(`
      alter default privileges in schema public
        grant select, insert, update, delete on tables to authenticated;
      alter default privileges in schema public
        grant select on tables to anon;
      alter default privileges in schema public
        grant usage, select on sequences to authenticated;
      alter default privileges in schema public
        grant execute on functions to anon, authenticated;
    `);

    await client.query("create schema if not exists auth");
    // The columns Supabase's own auth.users table exposes that the app's
    // migrations and triggers actually read.
    await client.query(`
      create table if not exists auth.users (
        id uuid primary key default gen_random_uuid(),
        email text unique,
        instance_id uuid,
        aud text default 'authenticated',
        role text default 'authenticated',
        raw_user_meta_data jsonb default '{}'::jsonb,
        raw_app_meta_data jsonb default '{}'::jsonb,
        email_confirmed_at timestamptz,
        last_sign_in_at timestamptz,
        created_at timestamptz not null default now(),
        updated_at timestamptz not null default now()
      );
    `);
    await client.query(`
      create or replace function auth.uid()
      returns uuid
      language sql
      stable
      as $fn$
        select ((nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'sub')::uuid
      $fn$;
    `);
    await client.query(`
      create or replace function auth.role()
      returns text
      language sql
      stable
      as $fn$
        select coalesce(
          ((nullif(current_setting('request.jwt.claims', true), '')::jsonb) ->> 'role'),
          'authenticated'
        )
      $fn$;
    `);
    // Supabase grants API roles access to the auth schema and helpers; without
    // this the drill would test a stricter database than the hosted one.
    await client.query(`
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      grant execute on function auth.role() to anon, authenticated;
    `);

    const directory = path.join(process.cwd(), "supabase/migrations");
    const files = (await readdir(directory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = await readFile(path.join(directory, file), "utf8");
      try {
        await client.query(sql);
      } catch (error) {
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
      }
    }

    await seedAccount(client, accountA, "A");
    await seedAccount(client, accountB, "B");
  }, 120_000);

  afterAll(async () => {
    if (client) await client.end();
  });

  async function asUser<T>(userId: string, run: () => Promise<T>): Promise<T> {
    await client.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify({ sub: userId, role: "authenticated" }),
    ]);
    await client.query("set role authenticated");
    try {
      return await run();
    } finally {
      await client.query("reset role");
      await client.query("select set_config('request.jwt.claims', '', false)");
    }
  }

  async function exportFor(seed: Seeded) {
    const goals = await client.query(
      `select id, title, desired_outcome, to_char(deadline, 'YYYY-MM-DD') as deadline,
              time_available_minutes, blocker, category, archived_at, created_at
         from public.goals where user_id = $1 order by created_at`,
      [seed.userId],
    );
    const tasks = await client.query(
      `select id, goal_id, title, status, completed_at, instructions, first_action,
              expected_deliverable, estimated_minutes, origin, created_at
         from public.tasks where user_id = $1 order by created_at`,
      [seed.userId],
    );
    const results = await client.query(
      `select task_id, content, updated_at from public.task_results where user_id = $1`,
      [seed.userId],
    );
    const reflections = await client.query(
      `select to_char(week_start, 'YYYY-MM-DD') as week_start,
              moved_forward, got_in_the_way, next_step, updated_at
         from public.weekly_checkins where user_id = $1`,
      [seed.userId],
    );
    const preferences = await client.query(
      `select session_length_minutes, work_days, work_start, work_end, task_size,
              communication_style, help_topics, personalization_enabled, updated_at
         from public.user_preferences where user_id = $1`,
      [seed.userId],
    );
    const sessions = await client.query(
      `select goal_id, task_id, status, started_at, finished_at,
              accumulated_seconds + coalesce(
                case when segment_started_at is null then 0
                     else greatest(0, extract(epoch from now() - segment_started_at))::int end, 0
              ) as seconds
         from public.focus_sessions where user_id = $1`,
      [seed.userId],
    );

    const source: ExportSource = {
      goals: goals.rows,
      tasks: tasks.rows,
      results: results.rows,
      reflections: reflections.rows.map((row) => ({
        ...row,
        week_start: String(row.week_start).slice(0, 10),
      })),
      preferences: preferences.rows[0] ?? null,
      focusSessions: sessions.rows,
    };

    return buildExportBundle(source, new Date().toISOString());
  }

  async function insertImportedPlan(seed: Seeded, plan: ReturnType<typeof importRows>) {
    const goalIds = plan.goals.map(() => randomUUID());

    for (const goal of plan.goals) {
      await client.query(
        `insert into public.goals
           (id, user_id, title, desired_outcome, deadline, time_available_minutes, blocker, category, archived_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          goalIds[goal.index],
          seed.userId,
          goal.values.title,
          goal.values.desired_outcome,
          goal.values.deadline,
          goal.values.time_available_minutes,
          goal.values.blocker,
          goal.values.category,
          goal.values.archived_at,
        ],
      );
    }

    const taskIds: string[] = [];
    for (const task of plan.tasks) {
      const id = randomUUID();
      taskIds.push(id);
      await client.query(
        `insert into public.tasks
           (id, user_id, goal_id, title, status, completed_at, instructions,
            first_action, expected_deliverable, estimated_minutes, origin)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          id,
          seed.userId,
          goalIds[task.goalIndex],
          task.values.title,
          task.values.status,
          task.values.completed_at,
          task.values.instructions,
          task.values.first_action,
          task.values.expected_deliverable,
          task.values.estimated_minutes,
          task.values.origin,
        ],
      );
    }

    for (const result of plan.results) {
      const offset = plan.goals
        .slice(0, result.goalIndex)
        .reduce((total, goal) => total + plan.tasks.filter((task) => task.goalIndex === goal.index).length, 0);
      const taskId = taskIds[offset + result.taskIndex];
      await client.query(
        `insert into public.task_results (task_id, user_id, content) values ($1,$2,$3)`,
        [taskId, seed.userId, result.content],
      );
    }

    for (const reflection of plan.reflections) {
      await client.query(
        `insert into public.weekly_checkins (user_id, week_start, moved_forward, got_in_the_way, next_step)
         values ($1,$2,$3,$4,$5) on conflict (user_id, week_start) do nothing`,
        [
          seed.userId,
          reflection.week_start,
          reflection.moved_forward,
          reflection.got_in_the_way,
          reflection.next_step,
        ],
      );
    }

    if (plan.preferences) {
      await client.query(
        `insert into public.user_preferences
           (user_id, session_length_minutes, work_days, work_start, work_end,
            task_size, communication_style, help_topics, personalization_enabled)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         on conflict (user_id) do update set
           session_length_minutes = excluded.session_length_minutes,
           work_days = excluded.work_days,
           work_start = excluded.work_start,
           work_end = excluded.work_end,
           task_size = excluded.task_size,
           communication_style = excluded.communication_style,
           help_topics = excluded.help_topics,
           personalization_enabled = excluded.personalization_enabled`,
        [
          seed.userId,
          plan.preferences.session_length_minutes,
          plan.preferences.work_days,
          plan.preferences.work_start,
          plan.preferences.work_end,
          plan.preferences.task_size,
          plan.preferences.communication_style,
          plan.preferences.help_topics,
          plan.preferences.personalization_enabled,
        ],
      );
    }
  }

  it("runs every migration on an empty database", async () => {
    const tables = await client.query<{ count: string }>(
      `select count(*)::text as count from information_schema.tables
        where table_schema = 'public'
          and table_name in ('goals','tasks','task_results','weekly_checkins','user_preferences',
                             'focus_sessions','workflows','workflow_runs','action_records',
                             'future_paths','future_scenarios','future_actions',
                             'reviews','review_stages','radar_topics','radar_signals',
                             'missions','mission_evidence','mission_decisions','mission_tasks',
                             'mission_outcomes','mission_suggestions','mission_reports',
                             'outcome_reviews','outcome_observations','outcome_forecasts',
                             'improvement_proposals','improvement_versions',
                             'app_projects','app_specs','app_files','app_versions',
                             'app_workspaces','app_workspace_runs',
                             'app_team_runs','app_team_tasks','app_team_integrations',
                             'app_team_events','app_provider_connections','app_env_values',
                             'app_deployments','app_deployment_events','app_project_memory',
                             'app_integrations',
                             'app_design_profiles','app_design_assets','app_design_versions',
                             'app_change_requests','app_change_events','app_skills',
                             'app_observability_settings','app_error_events','app_change_evaluations',
                             'app_project_members','app_build_tasks','app_changesets',
                             'app_changeset_reviews','app_build_comments','app_presence','app_share_links',
                             'app_releases','app_release_check_configs','app_release_check_runs',
                             'app_release_incidents','app_incident_events','app_release_automation',
                             'app_release_automation_events',
                             'app_api_keys','app_api_key_projects','app_api_rate_windows','app_api_usage',
                             'app_api_jobs','app_api_idempotency','app_api_webhooks',
                             'app_api_webhook_deliveries',
                             'app_composio_auth_attempts','app_composio_connections',
                             'app_composio_sessions','app_composio_tools','app_composio_tool_grants',
                             'app_composio_actions','app_composio_usage',
                             'supabase_account_connections','supabase_oauth_states')`,
    );
    expect(Number(tables.rows[0].count)).toBe(EXPECTED_CORE_TABLES);
  });

  it("exports only the account's own rows with local references", async () => {
    const bundle = await exportFor(accountA);

    expect(bundle.counts.goals).toBe(2);
    expect(bundle.counts.tasks).toBe(3);
    expect(bundle.goals[0].ref).toBe("g1");
    expect(JSON.stringify(bundle)).not.toContain(accountB.goalId);
    expect(JSON.stringify(bundle)).not.toContain(accountA.goalId);
    expect(JSON.stringify(bundle)).not.toContain("user_id");
  });

  it("re-imports the export additively without touching existing work", async () => {
    const bundle = await exportFor(accountA);
    const before = await client.query<{ goals: string; tasks: string }>(
      `select (select count(*) from public.goals where user_id = $1)::text as goals,
              (select count(*) from public.tasks where user_id = $1)::text as tasks`,
      [accountA.userId],
    );

    const parsed = parseImportFile(
      JSON.stringify(bundle),
      { goalTitles: bundle.goals.map((goal) => goal.title), reflectionWeeks: ["2026-10-26"], hasPreferences: true },
      { skipExistingGoalTitles: false, replacePreferences: false },
    );

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;

    expect(parsed.plan.rejected).toEqual([]);
    expect(parsed.plan.counts.goals).toBe(2);
    expect(parsed.plan.counts.tasks).toBe(3);
    // No overwriting, and existing preferences are left alone.
    expect(parsed.plan.counts.reflections).toBe(0);
    expect(parsed.plan.preferences).toBeNull();

    await insertImportedPlan(accountA, importRows(parsed.plan));

    const after = await client.query<{ goals: string; tasks: string; original: string }>(
      `select (select count(*) from public.goals where user_id = $1)::text as goals,
              (select count(*) from public.tasks where user_id = $1)::text as tasks,
              (select title from public.goals where id = $2) as original`,
      [accountA.userId, accountA.goalId],
    );

    expect(Number(after.rows[0].goals)).toBe(Number(before.rows[0].goals) + 2);
    expect(Number(after.rows[0].tasks)).toBe(Number(before.rows[0].tasks) + 3);
    expect(after.rows[0].original).toBe("Restore drill — goal A");

    const content = await client.query<{ content: string }>(
      `select content from public.task_results where user_id = $1 and content like 'Restore drill%'`,
      [accountA.userId],
    );
    expect(content.rows.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the two accounts isolated after the restore", async () => {
    const visibleToA = await asUser(accountA.userId, async () => {
      const rows = await client.query<{ count: string }>(
        "select count(*)::text as count from public.goals",
      );
      return Number(rows.rows[0].count);
    });

    const visibleToB = await asUser(accountB.userId, async () => {
      const rows = await client.query<{ count: string }>(
        "select count(*)::text as count from public.goals",
      );
      const foreign = await client.query(
        "select 1 from public.tasks where goal_id = $1",
        [accountA.goalId],
      );
      return { count: Number(rows.rows[0].count), foreign: foreign.rowCount };
    });

    expect(visibleToA).toBe(4);
    expect(visibleToB.count).toBe(2);
    expect(visibleToB.foreign).toBe(0);
  });

  it("refuses cross-account writes", async () => {
    await asUser(accountB.userId, async () => {
      await expect(
        client.query(
          `insert into public.tasks (user_id, goal_id, title) values ($1,$2,'intruder')`,
          [accountB.userId, accountA.goalId],
        ),
      ).rejects.toThrow();

      const updated = await client.query(
        `update public.goals set title = 'hijacked' where id = $1`,
        [accountA.goalId],
      );
      expect(updated.rowCount).toBe(0);
    });

    const title = await client.query<{ title: string }>(
      "select title from public.goals where id = $1",
      [accountA.goalId],
    );
    expect(title.rows[0].title).toBe("Restore drill — goal A");
  });

  it("keeps future paths owner-only and leaves the linked task alone", async () => {
    const mine = await client.query<{ count: string }>(
      "select count(*)::text as count from public.future_paths where user_id = $1",
      [accountA.userId],
    );
    expect(Number(mine.rows[0].count)).toBe(1);

    await asUser(accountB.userId, async () => {
      const foreign = await client.query<{ count: string }>(
        "select count(*)::text as count from public.future_paths where user_id = $1",
        [accountA.userId],
      );
      expect(Number(foreign.rows[0].count)).toBe(0);

      const scenarios = await client.query(
        "select 1 from public.future_scenarios where path_id = $1",
        [accountA.futurePathId],
      );
      expect(scenarios.rowCount).toBe(0);

      await expect(
        client.query(
          `insert into public.future_paths (user_id, decision, horizon, success_definition, model)
           values ($1, 'Intruder path', '1_year', 'Nothing real', 'fixture-model')`,
          [accountA.userId],
        ),
      ).rejects.toThrow(/row-level security/);
    });

    // The task a chosen action became is an ordinary task and is untouched by
    // reading or comparing the path.
    const task = await client.query<{ title: string }>(
      "select title from public.tasks where id = $1",
      [accountA.taskId],
    );
    expect(task.rows[0].title).toBe("First task");

    const link = await client.query<{ count: string }>(
      "select count(*)::text as count from public.future_actions where path_id = $1",
      [accountA.futurePathId],
    );
    expect(Number(link.rows[0].count)).toBe(1);
  });

  it("keeps reviews owner-only and preserves the human decision", async () => {
    const mine = await client.query<{ decision: string; count: string }>(
      `select count(*)::text as count, max(decision) as decision
         from public.reviews where user_id = $1`,
      [accountA.userId],
    );
    expect(Number(mine.rows[0].count)).toBe(1);
    expect(mine.rows[0].decision).toBe("Restore drill decision");

    await asUser(accountB.userId, async () => {
      const foreign = await client.query<{ count: string }>(
        "select count(*)::text as count from public.reviews where user_id = $1",
        [accountA.userId],
      );
      expect(Number(foreign.rows[0].count)).toBe(0);

      const stages = await client.query(
        "select 1 from public.review_stages where user_id = $1",
        [accountA.userId],
      );
      expect(stages.rowCount).toBe(0);

      await expect(
        client.query(
          `insert into public.reviews (user_id, question, model)
           values ($1, 'Intruder review question', 'fixture-model')`,
          [accountA.userId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("keeps radar signals owner-only and refuses a foreign insert", async () => {
    const mine = await client.query<{ count: string }>(
      "select count(*)::text as count from public.radar_signals where user_id = $1",
      [accountA.userId],
    );
    expect(Number(mine.rows[0].count)).toBe(1);

    const mineTopics = await client.query<{ count: string }>(
      "select count(*)::text as count from public.radar_topics where user_id = $1",
      [accountA.userId],
    );
    expect(Number(mineTopics.rows[0].count)).toBe(1);

    await asUser(accountB.userId, async () => {
      const foreign = await client.query<{ count: string }>(
        "select count(*)::text as count from public.radar_signals where user_id = $1",
        [accountA.userId],
      );
      expect(Number(foreign.rows[0].count)).toBe(0);

      const foreignTopics = await client.query(
        "select 1 from public.radar_topics where user_id = $1",
        [accountA.userId],
      );
      expect(foreignTopics.rowCount).toBe(0);

      await expect(
        client.query(
          `insert into public.radar_signals
             (user_id, topic, kind, headline, source_name, source_url,
              published_on, uncertainty, dedupe_key)
           values ($1, 'ai', 'opinion', 'Intruder radar signal', 'Intruder source',
                   'https://example.test/intruder', '2026-01-01',
                   'Nothing here is verified at all', 'intruder|2026-01-01')`,
          [accountA.userId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("keeps missions private to active members and revokes removed access", async () => {
    const mine = await client.query<{ count: string }>(
      "select count(*)::text as count from public.missions where workspace_id = $1",
      [accountA.workspaceId],
    );
    expect(Number(mine.rows[0].count)).toBe(1);

    await asUser(accountB.userId, async () => {
      const before = await client.query<{ count: string }>(
        "select count(*)::text as count from public.missions where workspace_id = $1",
        [accountA.workspaceId],
      );
      expect(Number(before.rows[0].count)).toBe(0);

      await expect(
        client.query(
          `insert into public.missions
             (workspace_id, created_by, title, category, problem, stakeholders, desired_outcome)
           values ($1, $2, 'Intruder mission', 'other',
                   'This problem is long enough for the drill check.',
                   'Some neighbours', 'A better outcome for everyone')`,
          [accountA.workspaceId, accountB.userId],
        ),
      ).rejects.toThrow(/row-level security/);
    });

    await client.query(
      `insert into public.workspace_members (workspace_id, user_id, role, status)
       values ($1, $2, 'member', 'active')`,
      [accountA.workspaceId, accountB.userId],
    );

    await asUser(accountB.userId, async () => {
      const joined = await client.query<{ count: string }>(
        "select count(*)::text as count from public.missions where workspace_id = $1",
        [accountA.workspaceId],
      );
      expect(Number(joined.rows[0].count)).toBe(1);

      const evidence = await client.query(
        "select 1 from public.mission_evidence where workspace_id = $1",
        [accountA.workspaceId],
      );
      expect(evidence.rowCount).toBe(1);
    });

    await client.query(
      `update public.workspace_members set status = 'removed'
        where workspace_id = $1 and user_id = $2`,
      [accountA.workspaceId, accountB.userId],
    );

    await asUser(accountB.userId, async () => {
      const after = await client.query<{ count: string }>(
        "select count(*)::text as count from public.missions where workspace_id = $1",
        [accountA.workspaceId],
      );
      expect(Number(after.rows[0].count)).toBe(0);

      const outcomes = await client.query(
        "select 1 from public.mission_outcomes where workspace_id = $1",
        [accountA.workspaceId],
      );
      expect(outcomes.rowCount).toBe(0);
    });
  });

  it("keeps outcome reviews owner-only and earlier notes append-only", async () => {
    const mine = await client.query<{ count: string }>(
      "select count(*)::text as count from public.outcome_reviews where user_id = $1",
      [accountA.userId],
    );
    expect(Number(mine.rows[0].count)).toBe(1);

    await asUser(accountB.userId, async () => {
      const foreign = await client.query<{ count: string }>(
        "select count(*)::text as count from public.outcome_reviews where user_id = $1",
        [accountA.userId],
      );
      expect(Number(foreign.rows[0].count)).toBe(0);

      await expect(
        client.query(
          `insert into public.outcome_reviews
             (user_id, source_kind, source_id, title, expectation_snapshot)
           values ($1, 'goal', $2, 'Intruder outcome', '{}'::jsonb)`,
          [accountA.userId, accountA.goalId],
        ),
      ).rejects.toThrow(/row-level security/);
    });

    await asUser(accountA.userId, async () => {
      const update = await client.query(
        "update public.outcome_observations set text = 'Rewritten in hindsight' where review_id = $1",
        [accountA.outcomeReviewId],
      );
      expect(update.rowCount).toBe(0);

      const removal = await client.query(
        "delete from public.outcome_observations where review_id = $1",
        [accountA.outcomeReviewId],
      );
      expect(removal.rowCount).toBe(0);
    });

    const unchanged = await client.query<{ text: string }>(
      "select text from public.outcome_observations where review_id = $1",
      [accountA.outcomeReviewId],
    );
    expect(unchanged.rows[0].text).toContain("drill assumption held");
  });

  it("keeps app projects owner-only and preserves versions through a restore", async () => {
    const mine = await client.query<{ count: string }>(
      "select count(*)::text as count from public.app_projects where user_id = $1",
      [accountA.userId],
    );
    expect(Number(mine.rows[0].count)).toBe(1);

    await asUser(accountB.userId, async () => {
      const foreign = await client.query<{ count: string }>(
        "select count(*)::text as count from public.app_projects where user_id = $1",
        [accountA.userId],
      );
      expect(Number(foreign.rows[0].count)).toBe(0);

      const files = await client.query(
        "select 1 from public.app_files where project_id = $1",
        [accountA.appProjectId],
      );
      expect(files.rowCount).toBe(0);

      await expect(
        client.query(
          `insert into public.app_projects
             (user_id, name, purpose, target_users, workflows, required_pages,
              entities, auth_requirements, definition_of_done)
           values ($1, 'Intruder app', 'This purpose is long enough.', 'Intruder users',
                   'Do something', '/ | Home', '', 'none', 'Nothing useful')`,
          [accountA.userId],
        ),
      ).rejects.toThrow(/row-level security/);

      // The generation function checks ownership itself, not only RLS.
      await expect(
        client.query("select public.replace_app_files($1, $2::jsonb, 'Intruder')", [
          accountA.appProjectId,
          JSON.stringify([{ path: "app/page.tsx", content: "intruder" }]),
        ]),
      ).rejects.toThrow(/project not found/);
    });

    await asUser(accountA.userId, async () => {
      // An approved specification is immutable, even for its owner: the update
      // policy only matches drafts, so this changes zero rows.
      const specUpdate = await client.query(
        "update public.app_specs set spec = '{}'::jsonb where id = $1",
        [accountA.appSpecId],
      );
      expect(specUpdate.rowCount).toBe(0);

      const specKept = await client.query<{ purpose: string }>(
        "select spec ->> 'purpose' as purpose from public.app_specs where id = $1",
        [accountA.appSpecId],
      );
      expect(specKept.rows[0].purpose).toContain("Restore drill app");

      const replaced = await client.query<{ version: number }>(
        "select public.replace_app_files($1, $2::jsonb, '2 files (1 added, 1 changed, 0 removed).') as version",
        [
          accountA.appProjectId,
          JSON.stringify([
            { path: "app/page.tsx", content: "export default function Page() { return 'new'; }" },
            { path: "README.md", content: "# Drill\n" },
          ]),
        ],
      );
      expect(Number(replaced.rows[0].version)).toBe(2);

      const older = await client.query<{ files: { path: string; content: string }[] }>(
        "select files from public.app_versions where project_id = $1 and version = 1",
        [accountA.appProjectId],
      );
      expect(older.rows[0].files).toHaveLength(1);
      expect(older.rows[0].files[0].content).toContain("return null");

      const restored = await client.query<{ version: number }>(
        "select public.restore_app_version($1, 1) as version",
        [accountA.appProjectId],
      );
      expect(Number(restored.rows[0].version)).toBe(3);

      const current = await client.query<{ path: string }>(
        "select path from public.app_files where project_id = $1 order by path",
        [accountA.appProjectId],
      );
      expect(current.rows.map((row) => row.path)).toEqual(["app/page.tsx"]);

      const kept = await client.query<{ count: string }>(
        "select count(*)::text as count from public.app_versions where project_id = $1",
        [accountA.appProjectId],
      );
      expect(Number(kept.rows[0].count)).toBe(3);
    });
  });

  it("enforces developer API scopes, revocation, quotas and project isolation", async () => {
    const mainHash = "a".repeat(64);
    const limitedHash = "b".repeat(64);
    const expiredHash = "c".repeat(64);
    const revokedHash = "d".repeat(64);
    const narrowHash = "9".repeat(64);
    const allScopes = [
      "projects:write",
      "specs:write",
      "builds:write",
      "builds:read",
      "previews:read",
      "deployments:propose",
    ];

    async function asAnon<T>(run: () => Promise<T>): Promise<T> {
      await client.query("select set_config('request.jwt.claims', '', false)");
      await client.query("set role anon");
      try {
        return await run();
      } finally {
        await client.query("reset role");
      }
    }

    type Guard = {
      ok: boolean;
      code?: string;
      project?: { id: string };
      project_id?: string;
      replayed?: boolean;
      proposal?: { status: string; approved: boolean; plan_hash: string };
      previews?: unknown[];
      job?: { id: string; status: string; result_version?: number; file_count?: number };
      spec?: unknown;
      files?: { path: string; content: string }[];
      version?: number;
      file_count?: number;
      deliveries?: { id: string; event: string }[];
      delivery?: { status: string; attempts: number };
    };

    async function call(sql: string, params: unknown[]): Promise<Guard> {
      const result = await asAnon(async () =>
        client.query<{ r: Guard }>(sql, params),
      );
      return result.rows[0].r;
    }

    await asUser(accountA.userId, async () => {
      for (const key of [
        { name: "Drill main key", prefix: "gti_aaaaaaaa", hash: mainHash, limit: 100, expires: new Date(Date.now() + 86_400_000) },
        { name: "Drill limited key", prefix: "gti_bbbbbbbb", hash: limitedHash, limit: 1, expires: new Date(Date.now() + 86_400_000) },
        { name: "Drill expired key", prefix: "gti_cccccccc", hash: expiredHash, limit: 100, expires: new Date(Date.now() - 60_000) },
        { name: "Drill revoked key", prefix: "gti_dddddddd", hash: revokedHash, limit: 100, expires: new Date(Date.now() + 86_400_000) },
      ]) {
        await client.query(
          "select public.create_project_api_key($1,$2,$3,$4,$5::text[],$6,$7)",
          [accountA.appProjectId, key.name, key.prefix, key.hash, allScopes, key.limit, key.expires],
        );
      }

      await client.query(
        "select public.create_project_api_key($1,$2,$3,$4,$5::text[],$6,$7)",
        [
          accountA.appProjectId,
          "Drill narrow key",
          "gti_99999999",
          narrowHash,
          ["previews:read"],
          100,
          new Date(Date.now() + 86_400_000),
        ],
      );

    });

    // Key ids are looked up as the restore owner; authenticated API roles only
    // see the hash-free safe view.
    const keyIds = await client.query<{ key_hash: string; id: string }>(
      "select key_hash, id from public.app_api_keys where user_id = $1",
      [accountA.userId],
    );
    const keyIdByHash = new Map(keyIds.rows.map((row) => [row.key_hash, row.id]));
    const mainKeyId = keyIdByHash.get(mainHash) ?? "";
    const revokedKeyId = keyIdByHash.get(revokedHash) ?? "";
    expect(mainKeyId).not.toBe("");
    expect(revokedKeyId).not.toBe("");

    await asUser(accountA.userId, async () => {
      await client.query("select public.revoke_project_api_key($1)", [revokedKeyId]);
    });

    // A valid, correctly scoped key reaches its own project only.
    const own = await call("select public.api_project_context($1,$2,$3) as r", [
      mainHash,
      accountA.appProjectId,
      "specs:write",
    ]);
    expect(own.ok).toBe(true);
    expect(own.project?.id).toBe(accountA.appProjectId);

    const foreign = await call("select public.api_project_context($1,$2,$3) as r", [
      mainHash,
      accountB.appProjectId,
      "specs:write",
    ]);
    expect(foreign.ok).toBe(false);
    expect(foreign.code).toBe("not_found");

    const wrongScope = await call("select public.api_project_context($1,$2,$3) as r", [
      narrowHash,
      accountA.appProjectId,
      "specs:write",
    ]);
    expect(wrongScope.code).toBe("scope_denied");

    const expired = await call("select public.api_project_context($1,$2,$3) as r", [
      expiredHash,
      accountA.appProjectId,
      "specs:write",
    ]);
    expect(expired.code).toBe("expired");

    const revoked = await call("select public.api_project_context($1,$2,$3) as r", [
      revokedHash,
      accountA.appProjectId,
      "specs:write",
    ]);
    expect(revoked.code).toBe("revoked");

    const previews = await call("select public.api_list_previews($1,$2,$3) as r", [
      mainHash,
      accountA.appProjectId,
      20,
    ]);
    expect(previews.ok).toBe(true);
    expect(Array.isArray(previews.previews)).toBe(true);

    // The limited key allows exactly one request in its minute window.
    const firstLimited = await call("select public.api_list_previews($1,$2,$3) as r", [
      limitedHash,
      accountA.appProjectId,
      20,
    ]);
    expect(firstLimited.ok).toBe(true);
    const secondLimited = await call("select public.api_list_previews($1,$2,$3) as r", [
      limitedHash,
      accountA.appProjectId,
      20,
    ]);
    expect(secondLimited.ok).toBe(false);
    expect(secondLimited.code).toBe("rate_limited");

    const limitedUsage = await client.query<{ status: number }>(
      `select u.status from public.app_api_usage u
         join public.app_api_keys k on k.id = u.key_id
        where k.key_hash = $1 and u.error_code = 'rate_limited'`,
      [limitedHash],
    );
    expect(limitedUsage.rows.some((row) => Number(row.status) === 429)).toBe(true);

    // Idempotent project creation: same key and body replay, different body conflicts.
    const intake = JSON.stringify({
      name: "API drill app",
      purpose: "A project created through the developer API drill.",
      target_users: "Drill operators",
      workflows: "Record a drill",
      required_pages: "/ | Home",
      entities: "",
      auth_requirements: "none",
      integrations: "",
      design_preferences: "",
      definition_of_done: "A drill record exists",
    });
    const spec = JSON.stringify({ stack: "nextjs-typescript-tailwind" });
    const created = await call("select public.api_create_project($1,$2,$3,$4::jsonb,$5::jsonb) as r", [
      mainHash,
      "drill-project-0001",
      "e".repeat(64),
      intake,
      spec,
    ]);
    expect(created.ok).toBe(true);
    const createdProjectId = created.project?.id ?? "";
    expect(createdProjectId).toMatch(/^[0-9a-f-]{36}$/);

    const replay = await call("select public.api_create_project($1,$2,$3,$4::jsonb,$5::jsonb) as r", [
      mainHash,
      "drill-project-0001",
      "e".repeat(64),
      intake,
      spec,
    ]);
    expect(replay.ok).toBe(true);
    expect(replay.replayed).toBe(true);
    expect(replay.project?.id).toBe(createdProjectId);

    const conflict = await call("select public.api_create_project($1,$2,$3,$4::jsonb,$5::jsonb) as r", [
      mainHash,
      "drill-project-0001",
      "f".repeat(64),
      intake,
      spec,
    ]);
    expect(conflict.ok).toBe(false);
    expect(conflict.code).toBe("idempotency_conflict");

    const createdCount = await client.query<{ count: string }>(
      "select count(*)::text as count from public.app_projects where id = $1",
      [createdProjectId],
    );
    expect(Number(createdCount.rows[0].count)).toBe(1);

    // A proposal is stored as a draft and never as an approval.
    await asUser(accountA.userId, async () => {
      await client.query("update public.app_projects set current_version = 1 where id = $1", [
        createdProjectId,
      ]);
    });

    const proposal = await call(
      "select public.api_create_deployment_proposal($1,$2,$3,$4::jsonb,$5,$6,$7,$8::jsonb,$9,$10) as r",
      [
        mainHash,
        createdProjectId,
        "preview",
        JSON.stringify({ version: 1, target: "preview" }),
        "1".repeat(64),
        1,
        "2".repeat(64),
        JSON.stringify([{ path: "app/page.tsx", content: "export default function Page() { return null; }" }]),
        "drill-proposal-0001",
        "3".repeat(64),
      ],
    );
    expect(proposal.ok, JSON.stringify(proposal)).toBe(true);
    expect(proposal.proposal?.status).toBe("draft");
    expect(proposal.proposal?.approved).toBe(false);

    const storedProposal = await client.query<{ status: string; approval_at: string | null }>(
      "select status, approval_at from public.app_deployments where project_id = $1",
      [createdProjectId],
    );
    expect(storedProposal.rows).toHaveLength(1);
    expect(storedProposal.rows[0].status).toBe("draft");
    expect(storedProposal.rows[0].approval_at).toBeNull();

    const approvedCount = await client.query<{ count: string }>(
      "select count(*)::text as count from public.app_deployments where project_id = $1 and status = 'approved'",
      [createdProjectId],
    );
    expect(Number(approvedCount.rows[0].count)).toBe(0);

    // A key without the deployments scope cannot read plan inputs.
    const readOnlyDeployment = await call("select public.api_deployment_inputs($1,$2) as r", [
      narrowHash,
      accountA.appProjectId,
    ]);
    expect(readOnlyDeployment.code).toBe("scope_denied");

    const deploymentKey = await call("select public.api_deployment_inputs($1,$2) as r", [
      mainHash,
      accountA.appProjectId,
    ]);
    expect(deploymentKey.ok).toBe(true);

    // The job lifecycle is stable, idempotent and cancelable while queued.
    const started = await call("select public.api_start_build_job($1,$2,$3,$4) as r", [
      mainHash,
      accountA.appProjectId,
      "drill-job-0001",
      "4".repeat(64),
    ]);
    expect(started.ok).toBe(true);
    const startedJobId = started.job?.id ?? "";
    expect(started.job?.status).toBe("queued");

    const startedAgain = await call("select public.api_start_build_job($1,$2,$3,$4) as r", [
      mainHash,
      accountA.appProjectId,
      "drill-job-0001",
      "4".repeat(64),
    ]);
    expect(startedAgain.replayed).toBe(true);
    expect(startedAgain.job?.id).toBe(startedJobId);

    const canceled = await call("select public.api_cancel_job($1,$2) as r", [
      mainHash,
      startedJobId,
    ]);
    expect(canceled.ok).toBe(true);
    expect(canceled.job?.status).toBe("canceled");

    // Register a webhook, then run one job to completion: claim, generate-store,
    // artifacts, and exactly one delivery row for the signed event.
    const webhookId = randomUUID();
    await asUser(accountA.userId, async () => {
      await client.query("select public.create_api_webhook($1,$2,$3,$4::text[],$5)", [
        webhookId,
        accountA.appProjectId,
        "https://example.test/hooks/gettoit",
        ["build.completed", "build.failed"],
        "v1.drill.sealed.webhook.secret",
      ]);
    });

    const buildJob = await call("select public.api_start_build_job($1,$2,$3,$4) as r", [
      mainHash,
      accountA.appProjectId,
      "drill-job-0002",
      "5".repeat(64),
    ]);
    expect(buildJob.ok).toBe(true);
    const buildJobId = buildJob.job?.id ?? "";

    const claimed = await call("select public.api_claim_job($1,$2) as r", [
      mainHash,
      buildJobId,
    ]);
    expect(claimed.ok).toBe(true);
    expect(claimed.spec).toBeTruthy();

    const completed = await call(
      "select public.api_complete_job($1,$2,$3::jsonb,$4) as r",
      [
        mainHash,
        buildJobId,
        JSON.stringify([
          { path: "app/page.tsx", content: "export default function Page() { return 'api'; }" },
          { path: "README.md", content: "# API build\n" },
        ]),
        "API build: 2 files (2 added, 0 changed, 0 removed).",
      ],
    );
    expect(completed.ok).toBe(true);
    expect(completed.job?.status).toBe("succeeded");
    expect(completed.job?.file_count).toBe(2);
    expect(completed.deliveries).toHaveLength(1);
    expect(completed.deliveries?.[0]?.event).toBe("build.completed");

    const artifacts = await call("select public.api_get_artifacts($1,$2,$3,$4::text) as r", [
      mainHash,
      buildJobId,
      10,
      null,
    ]);
    expect(artifacts.ok).toBe(true);
    expect(artifacts.file_count).toBe(2);
    expect(artifacts.files?.map((file) => file.path).sort()).toEqual([
      "README.md",
      "app/page.tsx",
    ]);

    const storedFiles = await client.query<{ count: string }>(
      "select count(*)::text as count from public.app_files where project_id = $1",
      [accountA.appProjectId],
    );
    expect(Number(storedFiles.rows[0].count)).toBe(2);

    const deliveryRows = await client.query<{ status: string }>(
      "select status from public.app_api_webhook_deliveries where job_id = $1",
      [buildJobId],
    );
    expect(deliveryRows.rows).toHaveLength(1);
    expect(deliveryRows.rows[0].status).toBe("pending");

    // Replaying the completion is idempotent and never queues a duplicate.
    const completedAgain = await call(
      "select public.api_complete_job($1,$2,$3::jsonb,$4) as r",
      [mainHash, buildJobId, JSON.stringify([{ path: "app/page.tsx", content: "ignored" }]), "Replay"],
    );
    expect(completedAgain.ok).toBe(true);
    expect(completedAgain.deliveries).toHaveLength(0);
    const afterReplay = await client.query<{ count: string }>(
      "select count(*)::text as count from public.app_api_webhook_deliveries where job_id = $1",
      [buildJobId],
    );
    expect(Number(afterReplay.rows[0].count)).toBe(1);

    const deliveryId = completed.deliveries?.[0]?.id ?? "";
    const recorded = await call("select public.api_record_delivery($1,$2,$3,$4) as r", [
      mainHash,
      deliveryId,
      true,
      null,
    ]);
    expect(recorded.ok, JSON.stringify(recorded)).toBe(true);
    expect(recorded.delivery?.status).toBe("delivered");

    // Usage is attributed to the key and project, and RLS hides it from account B.
    const usage = await client.query<{ operation: string; project_id: string }>(
      `select u.operation, u.project_id from public.app_api_usage u
         join public.app_api_keys k on k.id = u.key_id
        where k.key_hash = $1 order by u.created_at`,
      [mainHash],
    );
    expect(usage.rows.length).toBeGreaterThan(0);
    expect(usage.rows.some((row) => row.project_id === createdProjectId)).toBe(true);

    await asUser(accountB.userId, async () => {
      const hidden = await client.query<{ count: string }>(
        "select count(*)::text as count from public.app_api_usage where key_id = $1",
        [mainKeyId],
      );
      expect(Number(hidden.rows[0].count)).toBe(0);
    });
  });

  it("bounds Composio connections, grants, approvals and execution", async () => {
    type ComposeResult = {
      ok?: boolean;
      code?: string;
      message?: string;
      attempt?: { id: string; toolkit: string };
      connection?: { id: string; status: string; toolkit: string; account_label: string };
      connections?: { id: string; status: string; toolkit: string; account_label: string }[];
      count?: number;
      action_id?: string;
      replayed?: boolean;
      status?: string;
      arguments_hash?: string;
      approval_hash?: string;
      action?: { id: string; status: string; tool_slug: string; arguments: Record<string, unknown> };
      actions?: { id: string; status: string; arguments: unknown }[];
      calls?: number;
      writes?: number;
    };

    const rpc = async (userId: string, sql: string, params: unknown[]) =>
      asUser(userId, async () => (await client.query<{ r: ComposeResult }>(sql, params)).rows[0].r);

    const returnPath = `/build/${accountA.appProjectId}/connections`;
    const stateOne = "1".repeat(64);

    const begun = await rpc(accountA.userId, "select public.composio_begin_auth($1,$2,$3,$4) as r", [
      accountA.appProjectId,
      "github",
      stateOne,
      returnPath,
    ]);
    expect(begun.ok, JSON.stringify(begun)).toBe(true);
    const attemptId = begun.attempt?.id ?? "";
    expect(attemptId).toMatch(/^[0-9a-f-]{36}$/);

    const forgedAccount = await rpc(accountA.userId, "select public.composio_finish_auth($1,$2,$3,$4,$5) as r", [
      attemptId,
      stateOne,
      "completed",
      "not-a-connected-account",
      "bad",
    ]);
    expect(forgedAccount.ok).toBe(false);
    expect(forgedAccount.code).toBe("invalid_request");

    const finished = await rpc(accountA.userId, "select public.composio_finish_auth($1,$2,$3,$4,$5) as r", [
      attemptId,
      stateOne,
      "completed",
      "ca_drill_composio_1",
      "Drill GitHub",
    ]);
    expect(finished.ok, JSON.stringify(finished)).toBe(true);
    const connectionId = finished.connection?.id ?? "";
    expect(connectionId).not.toBe("");

    const listed = await rpc(accountA.userId, "select public.composio_list_connections($1) as r", [
      accountA.appProjectId,
    ]);
    expect(listed.connections).toHaveLength(1);
    expect(listed.connections?.[0]?.status).toBe("active");

    const foreignBegin = await rpc(accountB.userId, "select public.composio_begin_auth($1,$2,$3,$4) as r", [
      accountA.appProjectId,
      "github",
      "2".repeat(64),
      returnPath,
    ]);
    expect(foreignBegin.code).toBe("not_found");

    const tools = await rpc(accountA.userId, "select public.composio_replace_tools($1,$2::jsonb) as r", [
      connectionId,
      JSON.stringify([
        { slug: "GITHUB_CREATE_AN_ISSUE", name: "Create an issue", description: "Create a GitHub issue." },
        { slug: "NOTION_CREATE_NOTION_PAGE", name: "Create a page", description: "Wrong toolkit." },
      ]),
    ]);
    expect(tools.ok, JSON.stringify(tools)).toBe(true);
    expect(tools.count).toBe(1);

    const grant = await rpc(
      accountA.userId,
      "select public.composio_save_grant($1,$2,$3,$4,$5) as r",
      [accountA.appProjectId, connectionId, "GITHUB_CREATE_AN_ISSUE", "frontend", true],
    );
    expect(grant.ok, JSON.stringify(grant)).toBe(true);

    const unknownGrant = await rpc(
      accountA.userId,
      "select public.composio_save_grant($1,$2,$3,$4,$5) as r",
      [accountA.appProjectId, connectionId, "GITHUB_LIST_PULL_REQUESTS", "frontend", true],
    );
    expect(unknownGrant.code).toBe("unknown_tool");

    // A real agent task is required; this is what ties a request to a role.
    const run = await client.query<{ id: string }>(
      `insert into public.app_team_runs (project_id, user_id, spec_version, spec, status)
       values ($1, $2, 1, '{}'::jsonb, 'running')
       on conflict (project_id) do update set updated_at = now()
       returning id`,
      [accountA.appProjectId, accountA.userId],
    );
    const runId = run.rows[0].id;
    const task = await client.query<{ id: string }>(
      `insert into public.app_team_tasks
         (run_id, project_id, user_id, position, role, objective, status)
       values ($1, $2, $3, 7, 'frontend', 'Connect the approved plan to one GitHub issue', 'completed')
       on conflict (run_id, position) do update
         set role = 'frontend', objective = excluded.objective, status = 'completed'
       returning id`,
      [runId, accountA.appProjectId, accountA.userId],
    );
    const taskId = task.rows[0].id;

    const expired = await rpc(accountA.userId, "select public.composio_update_connection($1,$2) as r", [
      connectionId,
      "expired",
    ]);
    expect(expired.ok).toBe(true);
    const inactiveProposal = await rpc(
      accountA.userId,
      "select public.composio_propose_action($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as r",
      [
        accountA.appProjectId,
        connectionId,
        "GITHUB_CREATE_AN_ISSUE",
        "frontend",
        taskId,
        JSON.stringify({ owner: "drill", repo: "repo", title: "Inactive connection" }),
        "Inactive connection preview",
        "composio-drill-inactive",
      ],
    );
    expect(inactiveProposal.code).toBe("connection_inactive");
    const restored = await rpc(accountA.userId, "select public.composio_update_connection($1,$2) as r", [
      connectionId,
      "active",
    ]);
    expect(restored.ok).toBe(true);

    const argsOne = JSON.stringify({ owner: "drill", repo: "repo", title: "A bounded action" });
    const proposed = await rpc(
      accountA.userId,
      "select public.composio_propose_action($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as r",
      [
        accountA.appProjectId,
        connectionId,
        "GITHUB_CREATE_AN_ISSUE",
        "frontend",
        taskId,
        argsOne,
        "Create an issue on drill/repo",
        "composio-drill-action-1",
      ],
    );
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const actionId = proposed.action_id ?? "";

    const replay = await rpc(
      accountA.userId,
      "select public.composio_propose_action($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as r",
      [
        accountA.appProjectId,
        connectionId,
        "GITHUB_CREATE_AN_ISSUE",
        "frontend",
        taskId,
        argsOne,
        "Create an issue on drill/repo",
        "composio-drill-action-1",
      ],
    );
    expect(replay.replayed).toBe(true);
    expect(replay.action_id).toBe(actionId);

    const conflict = await rpc(
      accountA.userId,
      "select public.composio_propose_action($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as r",
      [
        accountA.appProjectId,
        connectionId,
        "GITHUB_CREATE_AN_ISSUE",
        "frontend",
        taskId,
        JSON.stringify({ owner: "drill", repo: "repo", title: "Changed after proposal" }),
        "Changed arguments preview",
        "composio-drill-action-1",
      ],
    );
    expect(conflict.code).toBe("idempotency_conflict");

    const deniedRole = await rpc(
      accountA.userId,
      "select public.composio_propose_action($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as r",
      [
        accountA.appProjectId,
        connectionId,
        "GITHUB_CREATE_AN_ISSUE",
        "qa",
        taskId,
        argsOne,
        "Wrong role",
        "composio-drill-role",
      ],
    );
    expect(deniedRole.code).toBe("not_granted");

    const beforeApproval = await rpc(accountA.userId, "select public.composio_claim_action($1) as r", [actionId]);
    expect(beforeApproval.ok).toBe(false);
    expect(beforeApproval.code).toBe("invalid_state");

    const zeroUsage = await rpc(accountA.userId, "select public.composio_usage($1) as r", [
      accountA.appProjectId,
    ]);
    expect(zeroUsage.calls).toBe(0);

    // Approval cannot be replaced by editing the stored argument object.
    await expect(
      asUser(accountA.userId, async () => {
        await client.query(
          "update public.app_composio_actions set arguments = '{\"owner\":\"attacker\"}'::jsonb where id = $1",
          [actionId],
        );
      }),
    ).rejects.toThrow(/permission denied/);

    const foreignApprove = await rpc(accountB.userId, "select public.composio_approve_action($1) as r", [actionId]);
    expect(foreignApprove.ok).toBe(false);

    const approved = await rpc(accountA.userId, "select public.composio_approve_action($1) as r", [actionId]);
    expect(approved.ok, JSON.stringify(approved)).toBe(true);
    expect(approved.approval_hash).toMatch(/^[a-f0-9]{64}$/);

    const claimed = await rpc(accountA.userId, "select public.composio_claim_action($1) as r", [actionId]);
    expect(claimed.ok, JSON.stringify(claimed)).toBe(true);
    expect(claimed.action?.status).toBe("executing");
    expect(claimed.action?.arguments).toMatchObject({ owner: "drill" });

    const secondClaim = await rpc(accountA.userId, "select public.composio_claim_action($1) as r", [actionId]);
    expect(secondClaim.ok).toBe(false);
    expect(secondClaim.code).toBe("busy");

    const completed = await rpc(
      accountA.userId,
      "select public.composio_complete_action($1,$2,$3::jsonb,$4,$5,$6) as r",
      [actionId, "succeeded", JSON.stringify({ issue: 42 }), "log_drill_1", null, null],
    );
    expect(completed.ok, JSON.stringify(completed)).toBe(true);

    const duplicateComplete = await rpc(
      accountA.userId,
      "select public.composio_complete_action($1,$2,$3::jsonb,$4,$5,$6) as r",
      [actionId, "succeeded", JSON.stringify({ issue: 42 }), "log_drill_1", null, null],
    );
    expect(duplicateComplete.ok).toBe(false);
    expect(duplicateComplete.code).toBe("invalid_state");

    // Uncertain outcomes are recorded and cannot be claimed again.
    const uncertainProposal = await rpc(
      accountA.userId,
      "select public.composio_propose_action($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as r",
      [
        accountA.appProjectId,
        connectionId,
        "GITHUB_CREATE_AN_ISSUE",
        "frontend",
        taskId,
        JSON.stringify({ owner: "drill", repo: "repo", title: "Timeout case" }),
        "Timeout preview",
        "composio-drill-action-2",
      ],
    );
    const uncertainId = uncertainProposal.action_id ?? "";
    await rpc(accountA.userId, "select public.composio_approve_action($1) as r", [uncertainId]);
    const uncertainClaim = await rpc(accountA.userId, "select public.composio_claim_action($1) as r", [uncertainId]);
    expect(uncertainClaim.ok).toBe(true);
    const uncertain = await rpc(
      accountA.userId,
      "select public.composio_complete_action($1,$2,$3::jsonb,$4,$5,$6) as r",
      [uncertainId, "uncertain", null, null, "timeout", "Provider timeout; outcome unknown."],
    );
    expect(uncertain.ok).toBe(true);
    const noRetry = await rpc(accountA.userId, "select public.composio_claim_action($1) as r", [uncertainId]);
    expect(noRetry.ok).toBe(false);

    // Daily external-tool quota is enforced before a new provider call.
    await client.query(
      "update public.app_composio_usage set calls = 100, writes = 100 where user_id = $1 and project_id = $2",
      [accountA.userId, accountA.appProjectId],
    );
    const quotaProposal = await rpc(
      accountA.userId,
      "select public.composio_propose_action($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as r",
      [
        accountA.appProjectId,
        connectionId,
        "GITHUB_CREATE_AN_ISSUE",
        "frontend",
        taskId,
        JSON.stringify({ owner: "drill", repo: "repo", title: "Over quota" }),
        "Quota preview",
        "composio-drill-action-3",
      ],
    );
    const quotaId = quotaProposal.action_id ?? "";
    await rpc(accountA.userId, "select public.composio_approve_action($1) as r", [quotaId]);
    const overQuota = await rpc(accountA.userId, "select public.composio_claim_action($1) as r", [quotaId]);
    expect(overQuota.ok).toBe(false);
    expect(overQuota.code).toBe("quota_exceeded");

    const cancelProposal = await rpc(
      accountA.userId,
      "select public.composio_propose_action($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as r",
      [
        accountA.appProjectId,
        connectionId,
        "GITHUB_CREATE_AN_ISSUE",
        "frontend",
        taskId,
        JSON.stringify({ owner: "drill", repo: "repo", title: "Cancelled case" }),
        "Cancel preview",
        "composio-drill-action-4",
      ],
    );
    const cancelId = cancelProposal.action_id ?? "";
    const cancelled = await rpc(accountA.userId, "select public.composio_cancel_action($1) as r", [cancelId]);
    expect(cancelled.ok).toBe(true);
    const cancelClaim = await rpc(accountA.userId, "select public.composio_claim_action($1) as r", [cancelId]);
    expect(cancelClaim.ok).toBe(false);

    // Disconnecting revokes locally, disables grants and cancels pending work.
    const pendingProposal = await rpc(
      accountA.userId,
      "select public.composio_propose_action($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as r",
      [
        accountA.appProjectId,
        connectionId,
        "GITHUB_CREATE_AN_ISSUE",
        "frontend",
        taskId,
        JSON.stringify({ owner: "drill", repo: "repo", title: "Pending at disconnect" }),
        "Pending at disconnect preview",
        "composio-drill-action-5",
      ],
    );
    const pendingId = pendingProposal.action_id ?? "";
    await rpc(accountA.userId, "select public.composio_approve_action($1) as r", [pendingId]);
    const disconnected = await rpc(accountA.userId, "select public.composio_disconnect($1,$2) as r", [
      connectionId,
      "revoke",
    ]);
    expect(disconnected.ok).toBe(true);
    expect(disconnected.status).toBe("revoked");

    const postDisconnect = await rpc(
      accountA.userId,
      "select public.composio_propose_action($1,$2,$3,$4,$5,$6::jsonb,$7,$8) as r",
      [
        accountA.appProjectId,
        connectionId,
        "GITHUB_CREATE_AN_ISSUE",
        "frontend",
        taskId,
        JSON.stringify({ owner: "drill", repo: "repo", title: "After disconnect" }),
        "After disconnect preview",
        "composio-drill-action-6",
      ],
    );
    expect(postDisconnect.code).toBe("connection_inactive");

    const pendingRow = await client.query<{ status: string }>(
      "select status from public.app_composio_actions where id = $1",
      [pendingId],
    );
    expect(pendingRow.rows[0]?.status).toBe("cancelled");

    const expiredBegin = await rpc(accountA.userId, "select public.composio_begin_auth($1,$2,$3,$4) as r", [
      accountA.appProjectId,
      "notion",
      "3".repeat(64),
      returnPath,
    ]);
    const expiredAttemptId = expiredBegin.attempt?.id ?? "";
    await client.query(
      "update public.app_composio_auth_attempts set expires_at = now() - interval '1 minute' where id = $1",
      [expiredAttemptId],
    );
    const expiredFinish = await rpc(accountA.userId, "select public.composio_finish_auth($1,$2,$3,$4,$5) as r", [
      expiredAttemptId,
      "3".repeat(64),
      "completed",
      "ca_drill_composio_2",
      "Expired attempt",
    ]);
    expect(expiredFinish.code).toBe("expired");

    const cancelledBegin = await rpc(accountA.userId, "select public.composio_begin_auth($1,$2,$3,$4) as r", [
      accountA.appProjectId,
      "notion",
      "4".repeat(64),
      returnPath,
    ]);
    const cancelledAttemptId = cancelledBegin.attempt?.id ?? "";
    const cancelledAuth = await rpc(accountA.userId, "select public.composio_finish_auth($1,$2,$3,$4,$5) as r", [
      cancelledAttemptId,
      "4".repeat(64),
      "cancelled",
      null,
      null,
    ]);
    expect(cancelledAuth.ok).toBe(true);
    expect(cancelledAuth.status).toBe("cancelled");

    const connectionCount = await client.query<{ count: string }>(
      "select count(*)::text as count from public.app_composio_connections where project_id = $1",
      [accountA.appProjectId],
    );
    expect(Number(connectionCount.rows[0].count)).toBe(1);

    const foreignSession = await rpc(accountB.userId, "select public.composio_save_session($1,$2,$3) as r", [
      accountA.appProjectId,
      "github",
      "sess_drill_foreign_123",
    ]);
    expect(foreignSession.code).toBe("not_found");

    await asUser(accountB.userId, async () => {
      const connections = await client.query("select 1 from public.app_composio_connections");
      const actions = await client.query("select 1 from public.app_composio_actions");
      expect(connections.rowCount).toBe(0);
      expect(actions.rowCount).toBe(0);
    });
  });

  it("keeps design profiles, references and versions owner-only", async () => {
    const versionId = randomUUID();
    const assetId = randomUUID();

    await asUser(accountA.userId, async () => {
      await client.query(
        `insert into public.app_design_profiles (project_id, user_id, brief, config)
         values ($1, $2, 'A design brief long enough for the drill.', '{}'::jsonb)
         on conflict (project_id) do update set brief = excluded.brief`,
        [accountA.appProjectId, accountA.userId],
      );
      await client.query(
        `insert into public.app_design_assets
           (id, project_id, user_id, kind, name, mime, bytes, sha256, content_base64,
            attribution, license_note, permission_confirmed)
         values ($1, $2, $3, 'screenshot', 'drill.png', 'image/png', 8, $4, 'iVBORw0KGgo=',
                 'Owner supplied', 'Owner supplied', true)`,
        [assetId, accountA.appProjectId, accountA.userId, "a".repeat(64)],
      );
      await client.query(
        `insert into public.app_design_versions
           (id, project_id, user_id, version, config, summary)
         values ($1, $2, $3, 1, '{}'::jsonb, 'Applied the drill design')`,
        [versionId, accountA.appProjectId, accountA.userId],
      );
    });

    await asUser(accountB.userId, async () => {
      expect((await client.query("select 1 from public.app_design_profiles where project_id = $1", [accountA.appProjectId])).rowCount).toBe(0);
      expect((await client.query("select 1 from public.app_design_assets where id = $1", [assetId])).rowCount).toBe(0);
      expect((await client.query("select 1 from public.app_design_versions where id = $1", [versionId])).rowCount).toBe(0);

      await expect(
        client.query(
          `insert into public.app_design_profiles (project_id, user_id, brief)
           values ($1, $2, 'A cross-account design brief for the drill.')`,
          [accountA.appProjectId, accountB.userId],
        ),
      ).rejects.toThrow(/row-level security/);
      await expect(
        client.query(
          `insert into public.app_design_assets
             (project_id, user_id, kind, name, mime, bytes, sha256, content_base64, permission_confirmed)
           values ($1, $2, 'asset', 'intruder.png', 'image/png', 8, $3, 'iVBORw0KGgo=', true)`,
          [accountA.appProjectId, accountB.userId, "b".repeat(64)],
        ),
      ).rejects.toThrow(/row-level security/);
    });

    await asUser(accountA.userId, async () => {
      expect((await client.query("select 1 from public.app_design_profiles where project_id = $1", [accountA.appProjectId])).rowCount).toBe(1);
      expect((await client.query("select 1 from public.app_design_assets where id = $1", [assetId])).rowCount).toBe(1);
      expect((await client.query("select 1 from public.app_design_versions where id = $1", [versionId])).rowCount).toBe(1);
      const update = await client.query("update public.app_design_versions set summary = 'changed' where id = $1", [versionId]);
      expect(update.rowCount).toBe(0);
    });
  });

  it("keeps preview workspaces owner-only", async () => {
    const workspace = await client.query<{ id: string }>(
      `insert into public.app_workspaces (project_id, user_id, runner_key, status)
       values ($1, $2, $3, 'stopped') returning id`,
      [accountA.appProjectId, accountA.userId, "a".repeat(32)],
    );
    const workspaceId = workspace.rows[0].id;

    await client.query(
      `insert into public.app_workspace_runs
         (workspace_id, project_id, user_id, kind, status, log)
       values ($1, $2, $3, 'checks', 'passed', 'seed')`,
      [workspaceId, accountA.appProjectId, accountA.userId],
    );

    await asUser(accountA.userId, async () => {
      const mine = await client.query("select 1 from public.app_workspaces where id = $1", [workspaceId]);
      expect(mine.rowCount).toBe(1);
    });

    await asUser(accountB.userId, async () => {
      const notMine = await client.query("select 1 from public.app_workspaces where id = $1", [workspaceId]);
      expect(notMine.rowCount).toBe(0);

      await expect(
        client.query(
          `insert into public.app_workspace_runs
             (workspace_id, project_id, user_id, kind, status)
           values ($1, $2, $3, 'checks', 'passed')`,
          [workspaceId, accountA.appProjectId, accountB.userId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("keeps agent-team runs and tasks owner-only", async () => {
    const run = await client.query<{ id: string }>(
      `insert into public.app_team_runs (project_id, user_id, spec_version, spec)
       values ($1, $2, 1, '{}'::jsonb)
       on conflict (project_id) do update set updated_at = now()
       returning id`,
      [accountA.appProjectId, accountA.userId],
    );
    const runId = run.rows[0].id;

    await client.query(
      `insert into public.app_team_tasks
         (run_id, project_id, user_id, position, role, objective)
       values ($1, $2, $3, 0, 'coordinator', 'Own the approved queue')`,
      [runId, accountA.appProjectId, accountA.userId],
    );

    await asUser(accountA.userId, async () => {
      const mine = await client.query("select 1 from public.app_team_runs where id = $1", [runId]);
      expect(mine.rowCount).toBe(1);
    });

    await asUser(accountB.userId, async () => {
      const notMine = await client.query("select 1 from public.app_team_runs where id = $1", [runId]);
      expect(notMine.rowCount).toBe(0);
      await expect(
        client.query(
          `insert into public.app_team_tasks
             (run_id, project_id, user_id, position, role, objective)
           values ($1, $2, $3, 1, 'qa', 'Attempt a cross-account task')`,
          [runId, accountA.appProjectId, accountB.userId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("keeps deployment connections and plans owner-only and sealed", async () => {
    const connection = await client.query<{ id: string }>(
      `insert into public.app_provider_connections
         (project_id, user_id, provider, account_label, external_ref, scope_label, secret_sealed)
       values ($1, $2, 'github', 'owner', 'owner/app', 'Contents read/write', 'v1.sealed')
       returning id`,
      [accountA.appProjectId, accountA.userId],
    );
    expect(connection.rows[0].id).toBeTruthy();

    const deployment = await client.query<{ id: string }>(
      `insert into public.app_deployments
         (project_id, user_id, target, snapshot_version, snapshot_digest, snapshot, plan, plan_hash, status)
       values ($1, $2, 'preview', 1, $3, '[{"path":"app/page.tsx","content":"export default function Page(){return null}"}]'::jsonb,
               '{}'::jsonb, $3, 'draft') returning id`,
      [accountA.appProjectId, accountA.userId, "a".repeat(64)],
    );
    const deploymentId = deployment.rows[0].id;

    await asUser(accountA.userId, async () => {
      const mine = await client.query("select 1 from public.app_deployments where id = $1", [deploymentId]);
      expect(mine.rowCount).toBe(1);
      const secret = await client.query<{ value: string }>(
        "select public.get_provider_secret($1, 'github') as value",
        [accountA.appProjectId],
      );
      expect(secret.rows[0].value).toBe("v1.sealed");
      await expect(
        client.query("select secret_sealed from public.app_provider_connections where id = $1", [
          connection.rows[0].id,
        ]),
      ).rejects.toThrow(/permission denied/);
    });

    await asUser(accountB.userId, async () => {
      const notMine = await client.query("select 1 from public.app_deployments where id = $1", [deploymentId]);
      expect(notMine.rowCount).toBe(0);
      const secret = await client.query<{ value: string | null }>(
        "select public.get_provider_secret($1, 'github') as value",
        [accountA.appProjectId],
      );
      expect(secret.rows[0].value).toBeNull();
      await expect(
        client.query(
          `insert into public.app_provider_connections
             (project_id, user_id, provider, account_label, external_ref, scope_label)
           values ($1, $2, 'vercel', 'other', 'prj_other', 'other project')`,
          [accountA.appProjectId, accountB.userId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("keeps release evidence, incidents and automation owner-controlled", async () => {
    const releaseId = randomUUID();
    const checkRunId = randomUUID();
    const deploymentId = randomUUID();

    await asUser(accountA.userId, async () => {
      await client.query(
        `insert into public.app_deployments
           (id, project_id, user_id, target, snapshot_version, snapshot_digest,
            snapshot, plan, plan_hash, status, checks, migration_state, source_commit)
         values ($1,$2,$3,'preview',3,$4,
                 '[{"path":"app/page.tsx","content":"export default function Page(){return null}"}]'::jsonb,
                 '{}'::jsonb,$4,'partial_failure',$5,'not_applied_preview','abc1234')`,
        [
          deploymentId,
          accountA.appProjectId,
          accountA.userId,
          "c".repeat(64),
          JSON.stringify([
            {
              name: "Repair health",
              label: "Repair health",
              status: "failed",
              code: null,
              detail: "The simulated deployment returned HTTP 500.",
            },
          ]),
        ],
      );
      await client.query(
        `insert into public.app_releases
           (id, project_id, user_id, version, deployment_id, source_revision, source_digest,
            changed_features, review)
         values ($1,$2,$3,3,$4,'abc1234',$5,'["Changed the repair page."]'::jsonb,
                 '{"what_unverified":["Passing tests do not establish that no defects exist."]}'::jsonb)`,
        [releaseId, accountA.appProjectId, accountA.userId, deploymentId, "c".repeat(64)],
      );
      await client.query(
        `insert into public.app_release_check_runs
           (id, release_id, project_id, user_id, name, kind, status, observed, detail)
         values ($1,$2,$3,$4,'Repair health','health','failed',$5,
                 'The configured health endpoint returned HTTP 500.')`,
        [
          checkRunId,
          releaseId,
          accountA.appProjectId,
          accountA.userId,
          JSON.stringify({ status: 500, synthetic: true }),
        ],
      );
      const automationBefore = await client.query<{ count: string }>(
        "select count(*)::text as count from public.app_release_automation where project_id = $1",
        [accountA.appProjectId],
      );
      expect(Number(automationBefore.rows[0].count)).toBe(0);
    });

    await asUser(accountB.userId, async () => {
      expect((await client.query("select 1 from public.app_releases where id = $1", [releaseId])).rowCount).toBe(0);
      await expect(
        client.query(
          `insert into public.app_release_incidents
             (project_id, release_id, user_id, title, trigger, evidence)
           values ($1,$2,$3,'Intruder incident','Intruder trigger','[{"detail":"intruder"}]'::jsonb)`,
          [accountA.appProjectId, releaseId, accountB.userId],
        ),
      ).rejects.toThrow();
    });

    const incidentId = await asUser(accountA.userId, async () => {
      const incident = await client.query<{ id: string }>(
        "select public.detect_app_release_incident($1,$2,'high') as id",
        [checkRunId, "Failed health check: Repair health"],
      );
      return incident.rows[0].id;
    });
    expect(incidentId).toBeTruthy();

    await asUser(accountA.userId, async () => {
      const incident = await client.query<{
        status: string;
        evidence: unknown[];
        root_cause: string | null;
        root_cause_confirmed: boolean;
      }>(
        "select status, evidence, root_cause, root_cause_confirmed from public.app_release_incidents where id = $1",
        [incidentId],
      );
      expect(incident.rows[0].status).toBe("evidence_collected");
      expect(incident.rows[0].evidence).toHaveLength(1);
      expect(incident.rows[0].root_cause).toBeNull();
      expect(incident.rows[0].root_cause_confirmed).toBe(false);

      const simulatedDeployment = await client.query<{ status: string; deployment_id: string }>(
        `select d.status, r.deployment_id
           from public.app_deployments d
           join public.app_releases r on r.deployment_id = d.id
          where r.id = $1`,
        [releaseId],
      );
      expect(simulatedDeployment.rows[0].status).toBe("partial_failure");
      expect(simulatedDeployment.rows[0].deployment_id).toBe(deploymentId);

      await expect(
        client.query(
          "select public.propose_app_incident_diagnosis($1,'Likely configuration','too short',true)",
          [incidentId],
        ),
      ).rejects.toThrow(/substantive supporting evidence/);

      await client.query(
        "select public.propose_app_incident_diagnosis($1,'Likely configuration','The check failed after a configuration name changed.',false)",
        [incidentId],
      );
      const diagnosed = await client.query<{ status: string; root_cause: string | null }>(
        "select status, root_cause from public.app_release_incidents where id = $1",
        [incidentId],
      );
      expect(diagnosed.rows[0].status).toBe("diagnosed");
      expect(diagnosed.rows[0].root_cause).toBeNull();

      await client.query(
        "select public.prepare_app_incident_recovery($1,'code_rollback',$2::jsonb)",
        [
          incidentId,
          JSON.stringify({
            steps: ["Create a new deployment from the previous source snapshot."],
            limitations: ["Database state is not changed."],
          }),
        ],
      );
      const prepared = await client.query<{ status: string; recovery_plan: { limitations: string[] } }>(
        "select status, recovery_plan from public.app_release_incidents where id = $1",
        [incidentId],
      );
      expect(prepared.rows[0].status).toBe("awaiting_approval");
      expect(prepared.rows[0].recovery_plan.limitations.join(" ")).toContain(
        "does not reverse a database migration",
      );

      await expect(
        client.query("select public.approve_app_incident_action($1,'yes')", [incidentId]),
      ).rejects.toThrow(/type APPROVE/);
      await client.query("select public.approve_app_incident_action($1,'APPROVE')", [incidentId]);

      const approved = await client.query<{ status: string; approved_at: string | null }>(
        "select status, approved_at from public.app_release_incidents where id = $1",
        [incidentId],
      );
      expect(approved.rows[0].status).toBe("approved");
      expect(approved.rows[0].approved_at).toBeTruthy();

      await expect(
        client.query(
          "select public.save_app_release_automation($1,true,'[]'::jsonb,'No known limitations.')",
          [accountA.appProjectId],
        ),
      ).rejects.toThrow(/at least one explicit condition/);

      await client.query(
        "select public.save_app_release_automation($1,true,$2::jsonb,'Cannot reverse a destructive migration.')",
        [accountA.appProjectId, JSON.stringify(["Two consecutive health check failures"])],
      );
      const enabled = await client.query<{ auto_rollback_enabled: boolean }>(
        "select auto_rollback_enabled from public.app_release_automation where project_id = $1",
        [accountA.appProjectId],
      );
      expect(enabled.rows[0].auto_rollback_enabled).toBe(true);

      await client.query("select public.disable_app_release_automation($1)", [accountA.appProjectId]);
      const disabled = await client.query<{ auto_rollback_enabled: boolean }>(
        "select auto_rollback_enabled from public.app_release_automation where project_id = $1",
        [accountA.appProjectId],
      );
      expect(disabled.rows[0].auto_rollback_enabled).toBe(false);
      const audit = await client.query<{ count: string }>(
        "select count(*)::text as count from public.app_release_automation_events where project_id = $1",
        [accountA.appProjectId],
      );
      expect(Number(audit.rows[0].count)).toBeGreaterThanOrEqual(2);
    });

    await asUser(accountB.userId, async () => {
      await expect(
        client.query(
          "select public.save_app_release_automation($1,true,$2::jsonb,'Cannot reverse a migration.')",
          [accountA.appProjectId, JSON.stringify(["Intruder condition"])],
        ),
      ).rejects.toThrow(/project access denied/);
    });
  });

  it("inspects PostgreSQL schema read-only against the isolated database", async () => {
    await testPostgresConnection(connectionString!);
    const tables = await inspectPostgresSchema(connectionString!);
    expect(tables.some((table) => table.name === "app_integrations")).toBe(true);
    expect(tables.find((table) => table.name === "app_integrations")?.columns.length).toBeGreaterThan(0);
  });

  it("keeps Integration Studio rows owner-only and seals credentials", async () => {
    const created = await asUser(accountA.userId, async () =>
      client.query<{ id: string }>(
        `select public.create_app_integration(
           $1, 'openapi_http', 'Owner API', $2::jsonb, '[]'::jsonb, '[]'::jsonb, 'draft'
         ) as id`,
        [accountA.appProjectId, JSON.stringify({ base_url: "https://api.example.test" })],
      ),
    );
    const integrationId = created.rows[0].id;

    await asUser(accountA.userId, async () => {
      await client.query("select public.save_app_integration_secrets($1, 'v1.dev', 'v1.prod')", [
        integrationId,
      ]);
      const secret = await client.query<{ value: string }>(
        "select public.get_app_integration_secret($1, 'development') as value",
        [integrationId],
      );
      expect(secret.rows[0].value).toBe("v1.dev");
      await expect(
        client.query("select development_secret_sealed from public.app_integrations where id = $1", [
          integrationId,
        ]),
      ).rejects.toThrow(/permission denied/);
    });

    await asUser(accountB.userId, async () => {
      const notMine = await client.query("select 1 from public.app_integrations where id = $1", [
        integrationId,
      ]);
      expect(notMine.rowCount).toBe(0);
      const secret = await client.query<{ value: string | null }>(
        "select public.get_app_integration_secret($1, 'development') as value",
        [integrationId],
      );
      expect(secret.rows[0].value).toBeNull();
      await expect(
        client.query(
          `select public.create_app_integration(
             $1, 'openapi_http', 'Intruder API', '{}'::jsonb, '[]'::jsonb, '[]'::jsonb, 'draft'
           )`,
          [accountA.appProjectId],
        ),
      ).rejects.toThrow(/project not found/);
    });
  });

  it("keeps Supabase OAuth tokens owner-only and sealed", async () => {
    const account = await client.query<{ id: string }>(
      `insert into public.supabase_account_connections
         (user_id, status, account_label, scopes, access_token_sealed, refresh_token_sealed, expires_at)
       values ($1, 'connected', 'Team', 'projects:read', 'v1.access', 'v1.refresh', now() + interval '1 hour')
       returning id`,
      [accountA.userId],
    );
    const accountId = account.rows[0].id;

    await asUser(accountA.userId, async () => {
      const view = await client.query(
        "select id, account_label from public.supabase_account_connections_safe where id = $1",
        [accountId],
      );
      expect(view.rowCount).toBe(1);
      const tokens = await client.query<{ access_token_sealed: string }>(
        "select access_token_sealed from public.get_supabase_account_tokens($1)",
        [accountId],
      );
      expect(tokens.rows[0].access_token_sealed).toBe("v1.access");
      await expect(
        client.query("select access_token_sealed from public.supabase_account_connections where id = $1", [accountId]),
      ).rejects.toThrow(/permission denied/);
    });

    await asUser(accountB.userId, async () => {
      const view = await client.query(
        "select id from public.supabase_account_connections_safe where id = $1",
        [accountId],
      );
      expect(view.rowCount).toBe(0);
      const tokens = await client.query(
        "select access_token_sealed from public.get_supabase_account_tokens($1)",
        [accountId],
      );
      expect(tokens.rowCount).toBe(0);
    });
  });

  it("keeps improvement memory and changes owner-only", async () => {
    const memory = await client.query<{ id: string }>(
      `insert into public.app_project_memory (project_id, user_id, kind, title, body)
       values ($1, $2, 'architecture', 'Stack', 'Next.js and TypeScript')
       returning id`,
      [accountA.appProjectId, accountA.userId],
    );
    const change = await client.query<{ id: string }>(
      `insert into public.app_change_requests
         (project_id, user_id, kind, request, base_version, base_digest, base_files)
       values ($1, $2, 'dashboard', 'Add a small dashboard', 1, $3,
               '[{"path":"app/page.tsx","content":"export default function Page(){return null}"}]'::jsonb)
       returning id`,
      [accountA.appProjectId, accountA.userId, "b".repeat(64)],
    );

    await asUser(accountA.userId, async () => {
      const mine = await client.query("select 1 from public.app_change_requests where id = $1", [change.rows[0].id]);
      expect(mine.rowCount).toBe(1);
    });
    await asUser(accountB.userId, async () => {
      expect((await client.query("select 1 from public.app_project_memory where id = $1", [memory.rows[0].id])).rowCount).toBe(0);
      expect((await client.query("select 1 from public.app_change_requests where id = $1", [change.rows[0].id])).rowCount).toBe(0);
      await expect(
        client.query(
          `insert into public.app_project_memory (project_id, user_id, kind, title, body)
           values ($1, $2, 'architecture', 'Cross-account', 'Nope')`,
          [accountA.appProjectId, accountB.userId],
        ),
      ).rejects.toThrow(/row-level security/);
    });
  });

  it("enforces Build Room roles, stale reviews, conflicts and revoked access", async () => {
    // The mission drill removed B from the workspace; restore membership so the
    // Build Room can test mapped roles and two-human review.
    await client.query(
      `insert into public.workspace_members (workspace_id, user_id, role, status)
       values ($1, $2, 'member', 'active')
       on conflict (workspace_id, user_id) do update set status = 'active', role = 'member'`,
      [accountA.workspaceId, accountB.userId],
    );

    await asUser(accountA.userId, async () => {
      await client.query("select public.link_app_workspace($1, $2)", [
        accountA.appProjectId,
        accountA.workspaceId,
      ]);
    });

    const bChangeset = await asUser(accountB.userId, async () => {
      const room = await client.query<{ room: { role: string } }>(
        "select public.get_app_build_room($1) as room",
        [accountA.appProjectId],
      );
      expect(room.rows[0].room.role).toBe("contributor");
      const created = await client.query<{ id: string }>(
        "select public.create_app_changeset($1,$2,$3,$4,$5) as id",
        [
          accountA.appProjectId,
          "B changes the page",
          "Contributor isolation drill",
          "app/page.tsx",
          "export default function Page() { return 'from B'; }",
        ],
      );
      const id = created.rows[0].id;
      await client.query("select public.submit_app_changeset($1)", [id]);
      await client.query(
        `select public.set_app_changeset_checks($1, $2::jsonb)`,
        [id, JSON.stringify([{ name: "files", label: "Files", status: "passed", code: null, log: "ok" }])],
      );
      await expect(
        client.query("select public.merge_app_changeset($1)", [id]),
      ).rejects.toThrow(/maintainer access required/);
      return id;
    });

    const aChangeset = await asUser(accountA.userId, async () => {
      await client.query("select public.add_app_project_member($1,$2,'reviewer')", [
        accountA.appProjectId,
        accountB.userId,
      ]);
      const created = await client.query<{ id: string }>(
        "select public.create_app_changeset($1,$2,$3,$4,$5) as id",
        [
          accountA.appProjectId,
          "A changes the page",
          "Owner isolation drill",
          "app/page.tsx",
          "export default function Page() { return 'from A'; }",
        ],
      );
      const id = created.rows[0].id;
      await client.query("select public.submit_app_changeset($1)", [id]);
      await client.query(
        `select public.set_app_changeset_checks($1, $2::jsonb)`,
        [id, JSON.stringify([{ name: "files", label: "Files", status: "passed", code: null, log: "ok" }])],
      );

      await expect(
        client.query("select public.review_app_changeset($1,'approve','')", [id]),
      ).rejects.toThrow(/cannot review your own changeset/);

      // A reviews B; B has been promoted to reviewer and reviews A.
      await client.query("select public.review_app_changeset($1,'approve','Approved B')", [bChangeset]);
      return id;
    });

    await asUser(accountB.userId, async () => {
      await client.query("select public.review_app_changeset($1,'approve','Approved A')", [aChangeset]);
    });

    await asUser(accountA.userId, async () => {
      const merged = await client.query<{ result: { ok: boolean; version: number } }>(
        "select public.merge_app_changeset($1) as result",
        [bChangeset],
      );
      expect(merged.rows[0].result.ok).toBe(true);

      const conflict = await client.query<{ result: { ok: boolean; conflicts: string[] } }>(
        "select public.merge_app_changeset($1) as result",
        [aChangeset],
      );
      expect(conflict.rows[0].result.ok).toBe(false);
      expect(conflict.rows[0].result.conflicts).toContain("app/page.tsx");

      const current = await client.query<{ content: string }>(
        "select content from public.app_files where project_id = $1 and path = 'app/page.tsx'",
        [accountA.appProjectId],
      );
      expect(current.rows[0].content).toContain("from B");

      // Resolve the conflict by rebasing onto the integrated files, then run
      // checks and get a fresh review before integrating the tested result.
      await client.query("select public.rebase_app_changeset($1)", [aChangeset]);
      await client.query("select public.submit_app_changeset($1)", [aChangeset]);
      await client.query(
        `select public.set_app_changeset_checks($1, $2::jsonb)`,
        [aChangeset, JSON.stringify([{ name: "files", label: "Files", status: "passed", code: null, log: "rebased" }])],
      );
    });
    await asUser(accountB.userId, async () => {
      await client.query("select public.review_app_changeset($1,'approve','Rebased and tested')", [aChangeset]);
    });
    await asUser(accountA.userId, async () => {
      const merged = await client.query<{ result: { ok: boolean; version: number } }>(
        "select public.merge_app_changeset($1) as result",
        [aChangeset],
      );
      expect(merged.rows[0].result.ok).toBe(true);
      const current = await client.query<{ content: string }>(
        "select content from public.app_files where project_id = $1 and path = 'app/page.tsx'",
        [accountA.appProjectId],
      );
      expect(current.rows[0].content).toContain("from A");
    });

    const stale = await asUser(accountA.userId, async () => {
      const created = await client.query<{ id: string }>(
        "select public.create_app_changeset($1,$2,$3,$4,$5) as id",
        [
          accountA.appProjectId,
          "Stale approval drill",
          "Review then edit",
          "app/page.tsx",
          "export default function Page() { return 'reviewed'; }",
        ],
      );
      return created.rows[0].id;
    });

    await asUser(accountA.userId, async () => {
      await client.query("select public.submit_app_changeset($1)", [stale]);
      await client.query(
        `select public.set_app_changeset_checks($1, $2::jsonb)`,
        [stale, JSON.stringify([{ name: "files", label: "Files", status: "passed", code: null, log: "ok" }])],
      );
    });
    await asUser(accountB.userId, async () => {
      await client.query("select public.review_app_changeset($1,'approve','Approved before edit')", [stale]);
    });
    await asUser(accountA.userId, async () => {
      await client.query(
        "select public.update_app_changeset($1,'Stale approval drill','Edited after review','app/page.tsx',$2)",
        [stale, "export default function Page() { return 'edited'; }"],
      );
      const row = await client.query<{ status: string; stale: boolean }>(
        `select status, reviewed_digest is distinct from content_digest as stale
           from public.app_changesets where id = $1`,
        [stale],
      );
      expect(row.rows[0].status).toBe("draft");
      expect(row.rows[0].stale).toBe(true);
      await expect(client.query("select public.merge_app_changeset($1)", [stale]))
        .rejects.toThrow(/not approved/);
    });

    // A completed agent branch can become an isolated changeset, but only by a
    // maintainer and only for files the agent declared it would touch.
    const agentRun = await client.query<{ id: string }>(
      `insert into public.app_team_runs (project_id, user_id, spec_version, spec)
       values ($1, $2, 1, '{}'::jsonb)
       on conflict (project_id) do update set updated_at = now()
       returning id`,
      [accountA.appProjectId, accountA.userId],
    );
    const agentTask = await client.query<{ id: string }>(
      `insert into public.app_team_tasks
         (run_id, project_id, user_id, position, role, objective, status,
          file_claims, branch_files, changed_files)
       values ($1, $2, $3, 5, 'frontend', 'Add an agent greeting', 'completed',
               '["app/page.tsx"]'::jsonb,
               '[{"path":"app/page.tsx","content":"export default function Page() { return 1; }"}]'::jsonb,
               '["app/page.tsx"]'::jsonb)
       returning id`,
      [agentRun.rows[0].id, accountA.appProjectId, accountA.userId],
    );
    const agentChangeset = await asUser(accountA.userId, async () => {
      const created = await client.query<{ id: string }>(
        "select public.create_agent_changeset_from_task($1) as id",
        [agentTask.rows[0].id],
      );
      return created.rows[0].id;
    });
    const agentRow = await client.query<{ author_kind: string; agent_role: string; files: { path: string }[] }>(
      "select author_kind, agent_role, files from public.app_changesets where id = $1",
      [agentChangeset],
    );
    expect(agentRow.rows[0].author_kind).toBe("agent");
    expect(agentRow.rows[0].agent_role).toBe("frontend");
    expect(agentRow.rows[0].files[0].path).toBe("app/page.tsx");

    const tokenHash = "a".repeat(64);
    await asUser(accountA.userId, async () => {
      await client.query("select public.create_app_share_link($1,$2,1)", [accountA.appProjectId, tokenHash]);
    });
    await asUser(accountB.userId, async () => {
      const shared = await client.query<{ preview: { ok: boolean; name: string } }>(
        "select public.get_shared_app_preview($1) as preview",
        [tokenHash],
      );
      expect(shared.rows[0].preview.ok).toBe(true);
      expect(shared.rows[0].preview.name).toContain("Restore drill app");
    });

    await asUser(accountA.userId, async () => {
      await client.query("select public.remove_app_project_member($1,$2)", [
        accountA.appProjectId,
        accountB.userId,
      ]);
    });
    await asUser(accountB.userId, async () => {
      await expect(
        client.query("select public.get_app_build_room($1)", [accountA.appProjectId]),
      ).rejects.toThrow(/project access denied/);
    });
  });

  it("answers the health probe without exposing data", async () => {
    const probe = await client.query<{ probe: { ok: boolean } }>(
      "select public.health_probe() as probe",
    );
    expect(probe.rows[0].probe.ok).toBe(true);
  });

  it("deletes one account and retains only accounting records", async () => {
    const usageBefore = await client.query<{ requests: number }>(
      "select coalesce(sum(requests), 0)::int as requests from public.ai_usage_daily",
    );

    await asUser(accountB.userId, async () => {
      const result = await client.query<{ deleted: { ok: boolean } }>(
        "select public.delete_my_account('DELETE') as deleted",
      );
      expect(result.rows[0].deleted.ok).toBe(true);
    });

    const gone = await client.query<{ count: string }>(
      `select count(*)::text as count from public.goals where user_id = $1`,
      [accountB.userId],
    );
    expect(Number(gone.rows[0].count)).toBe(0);

    // Future paths belong to the account and go with it.
    const pathsGone = await client.query<{ count: string }>(
      `select count(*)::text as count from public.future_paths where user_id = $1`,
      [accountB.userId],
    );
    expect(Number(pathsGone.rows[0].count)).toBe(0);

    const reviewsGone = await client.query<{ count: string }>(
      `select count(*)::text as count from public.reviews where user_id = $1`,
      [accountB.userId],
    );
    expect(Number(reviewsGone.rows[0].count)).toBe(0);

    const radarGone = await client.query<{ count: string }>(
      `select count(*)::text as count from public.radar_signals where user_id = $1`,
      [accountB.userId],
    );
    expect(Number(radarGone.rows[0].count)).toBe(0);

    const radarTopicsGone = await client.query<{ count: string }>(
      `select count(*)::text as count from public.radar_topics where user_id = $1`,
      [accountB.userId],
    );
    expect(Number(radarTopicsGone.rows[0].count)).toBe(0);

    const outcomesGone = await client.query<{ count: string }>(
      `select count(*)::text as count from public.outcome_reviews where user_id = $1`,
      [accountB.userId],
    );
    expect(Number(outcomesGone.rows[0].count)).toBe(0);

    const versionsGone = await client.query<{ count: string }>(
      `select count(*)::text as count from public.improvement_versions where user_id = $1`,
      [accountB.userId],
    );
    expect(Number(versionsGone.rows[0].count)).toBe(0);

    const appsGone = await client.query<{ count: string }>(
      `select count(*)::text as count from public.app_projects where user_id = $1`,
      [accountB.userId],
    );
    expect(Number(appsGone.rows[0].count)).toBe(0);

    const appFilesGone = await client.query<{ count: string }>(
      `select count(*)::text as count from public.app_files where user_id = $1`,
      [accountB.userId],
    );
    expect(Number(appFilesGone.rows[0].count)).toBe(0);

    const appVersionsGone = await client.query<{ count: string }>(
      `select count(*)::text as count from public.app_versions where user_id = $1`,
      [accountB.userId],
    );
    expect(Number(appVersionsGone.rows[0].count)).toBe(0);

    const user = await client.query("select 1 from auth.users where id = $1", [accountB.userId]);
    expect(user.rowCount).toBe(0);

    // The shared counter is a number with no account attached, and stays put.
    const usageAfter = await client.query<{ requests: number }>(
      "select coalesce(sum(requests), 0)::int as requests from public.ai_usage_daily",
    );
    expect(usageAfter.rows[0].requests).toBe(usageBefore.rows[0].requests);

    // Account A is untouched by B's deletion.
    const remaining = await client.query<{ count: string }>(
      `select count(*)::text as count from public.goals where user_id = $1`,
      [accountA.userId],
    );
    expect(Number(remaining.rows[0].count)).toBe(4);
  });
});

async function seedAccount(client: Client, seed: Seeded, label: string) {
  await client.query(
    "insert into auth.users (id, email, instance_id) values ($1,$2,'00000000-0000-0000-0000-000000000000')",
    [seed.userId, seed.email],
  );

  await client.query(
    `insert into public.goals
       (id, user_id, title, desired_outcome, deadline, time_available_minutes, blocker, category)
     values ($1,$2,$3,$4,'2026-12-01',45,'Restore drill blocker','launch')`,
    [seed.goalId, seed.userId, `Restore drill — goal ${label}`, `Outcome ${label}`],
  );

  await client.query(
    `insert into public.goals (id, user_id, title, desired_outcome, time_available_minutes, blocker)
     values ($1,$2,$3,$4,30,'Second drill blocker')`,
    [seed.otherGoalId, seed.userId, `Second goal ${label}`, `Second outcome ${label}`],
  );

  const taskIds = [seed.taskId, randomUUID(), randomUUID()];
  const titles = ["First task", "Second task", "Third task"];

  for (let index = 0; index < taskIds.length; index += 1) {
    await client.query(
      `insert into public.tasks
         (id, user_id, goal_id, title, status, completed_at, instructions, estimated_minutes, origin)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'manual')`,
      [
        taskIds[index],
        seed.userId,
        seed.goalId,
        titles[index],
        index === 0 ? "completed" : "todo",
        index === 0 ? new Date().toISOString() : null,
        index === 0 ? "Saved detail" : null,
        index === 0 ? 20 : null,
      ],
    );
  }

  await client.query(
    "insert into public.task_results (task_id, user_id, content) values ($1,$2,$3)",
    [seed.taskId, seed.userId, `Restore drill — saved work ${label}`],
  );

  await client.query(
    `insert into public.weekly_checkins (user_id, week_start, moved_forward, got_in_the_way, next_step)
     values ($1, '2026-10-26', $2, '', 'Next step')`,
    [seed.userId, `Restore drill — reflection ${label}`],
  );

  await client.query(
    `insert into public.user_preferences
       (user_id, session_length_minutes, work_days, work_start, work_end, task_size, communication_style, help_topics)
     values ($1, 25, array[1,2]::smallint[], '09:00', '12:00', 'small', 'concise', array['writing'])`,
    [seed.userId],
  );

  await client.query(
    `insert into public.focus_sessions
       (user_id, goal_id, task_id, status, started_at, finished_at, accumulated_seconds, segment_started_at)
     values ($1,$2,$3,'finished', now() - interval '1 hour', now() - interval '30 minutes', 1800, null)`,
    [seed.userId, seed.goalId, seed.taskId],
  );

  await client.query(
    `insert into public.future_paths
       (id, user_id, goal_id, decision, horizon, resources, constraints,
        success_definition, uncertainties, model)
     values ($1,$2,$3,$4,'1_year','Some savings','One hire at most',$5,'Client renewals','fixture-model')`,
    [
      seed.futurePathId,
      seed.userId,
      seed.goalId,
      `Restore drill — path ${label}`,
      `Success ${label}`,
    ],
  );

  const evidence = JSON.stringify([
    { text: "The current clients renew", label: "assumption", source_url: null },
  ]);

  await client.query(
    `insert into public.future_scenarios
       (path_id, user_id, kind, title, assumptions, developments, opportunities,
        risks, signals, actions, first_steps, change_conditions)
     values ($1,$2,'favorable','Favorable conditions',$3::jsonb,$3::jsonb,$3::jsonb,
             $3::jsonb,$3::jsonb,$3::jsonb,$3::jsonb,$3::jsonb)`,
    [seed.futurePathId, seed.userId, evidence],
  );

  await client.query(
    `insert into public.future_actions
       (path_id, user_id, scenario_kind, action_index, action_text, task_id)
     values ($1,$2,'favorable',0,'Keep the smallest offer running',$3)`,
    [seed.futurePathId, seed.userId, seed.taskId],
  );

  await client.query(
    `insert into public.reviews
       (id, user_id, question, context, constraints, priorities, sources, model,
        status, decision, decided_at, finished_at)
     values ($1,$2,$3,'Drill context','Drill constraints','["Income"]'::jsonb,
             '[]'::jsonb,'fixture-model','complete',$4, now(), now())`,
    [
      seed.reviewId,
      seed.userId,
      `Restore drill — review ${label}`,
      "Restore drill decision",
    ],
  );

  await client.query(
    `insert into public.review_stages
       (review_id, user_id, perspective, position, status, summary, assumptions,
        options, evidence, counterarguments, disagreements, missing_info,
        experiment, questions, tradeoffs, recommendation)
     values ($1,$2,'planner',1,'succeeded','Drill summary','["Drill assumption"]'::jsonb,
             '[{"title":"Drill option","description":"Drill description"}]'::jsonb,
             '[{"text":"Drill evidence","basis":"context","source_url":null}]'::jsonb,
             '[]'::jsonb,'["Drill disagreement"]'::jsonb,'["Drill missing"]'::jsonb,
             '{"title":"Drill test","steps":["One","Two"],"success_signal":"Works","stop_signal":"Stops"}'::jsonb,
             '["Drill question?"]'::jsonb,'[]'::jsonb, null)`,
    [seed.reviewId, seed.userId],
  );

  await client.query(
    `insert into public.radar_topics (user_id, topic) values ($1, 'ai')`,
    [seed.userId],
  );

  await client.query(
    `insert into public.radar_signals
       (id, user_id, topic, kind, headline, source_name, source_url,
        published_on, geography, sector, uncertainty, goal_id, dedupe_key)
     values ($1,$2,'ai','announced',$3,'Restore drill source',
             'https://example.test/drill', '2026-09-15', 'United Kingdom',
             'Drill sector', 'Drill uncertainty text', $4, $5)`,
    [
      seed.radarSignalId,
      seed.userId,
      `Restore drill — signal ${label}`,
      seed.goalId,
      `example.test/drill-${seed.userId}|2026-09-15`,
    ],
  );

  await client.query(
    `insert into public.workspaces (id, name, created_by) values ($1, $2, $3)`,
    [seed.workspaceId, `Restore drill workspace ${label}`, seed.userId],
  );

  await client.query(
    `insert into public.workspace_members (workspace_id, user_id, role, status)
     values ($1, $2, 'owner', 'active')`,
    [seed.workspaceId, seed.userId],
  );

  await client.query(
    `insert into public.missions
       (id, workspace_id, created_by, title, category, problem, stakeholders,
        desired_outcome, constraints, status, decision_owner_id, review_at,
        share_scope, share_approved_by, share_approved_at)
     values ($1,$2,$3,$4,'community',$5,$6,$7,'Drill constraints','active',$3,
             '2026-12-01',$8,$3, now())`,
    [
      seed.missionId,
      seed.workspaceId,
      seed.userId,
      `Restore drill — mission ${label}`,
      "The drill problem is long enough to pass the schema check.",
      "Neighbours and volunteers",
      "A shared, usable record of what the drill checked.",
      "Share the problem statement with the drill partner",
    ],
  );

  await client.query(
    `insert into public.mission_evidence
       (mission_id, workspace_id, author_id, kind, text, contains_personal_story,
        consent_note, consent_recorded_by, consent_at)
     values ($1,$2,$3,'evidence','The drill ramp is measured at three steps.',true,
             'The volunteer consented to this drill note.',$3, now())`,
    [seed.missionId, seed.workspaceId, seed.userId],
  );

  await client.query(
    `insert into public.mission_decisions
       (mission_id, workspace_id, created_by, title, summary, decided_by, dissent)
     values ($1,$2,$3,'Drill decision','The group approved the drill decision.',$3,
             'One member preferred a different order.')`,
    [seed.missionId, seed.workspaceId, seed.userId],
  );

  await client.query(
    `insert into public.mission_tasks
       (mission_id, workspace_id, created_by, title, status, assignee_id)
     values ($1,$2,$3,'Measure the entrance', 'completed', $3)`,
    [seed.missionId, seed.workspaceId, seed.userId],
  );

  await client.query(
    `insert into public.mission_outcomes
       (mission_id, workspace_id, reported_by, kind, text)
     values ($1,$2,$3,'participant','A visitor said the new ramp was easier.')`,
    [seed.missionId, seed.workspaceId, seed.userId],
  );

  await client.query(
    `insert into public.mission_suggestions
       (mission_id, workspace_id, requested_by, kind, body, model)
     values ($1,$2,$3,'questions',
             'Consider asking whether the entrance can be widened without structural work.',
             'fixture-model')`,
    [seed.missionId, seed.workspaceId, seed.userId],
  );

  await client.query(
    `insert into public.mission_reports
       (mission_id, workspace_id, reported_by, reason)
     values ($1,$2,$3,'A drill report about how a quote was recorded.')`,
    [seed.missionId, seed.workspaceId, seed.userId],
  );

  await client.query(
    `insert into public.outcome_reviews
       (id, user_id, source_kind, source_id, title, expectation_snapshot,
        review_at, status, action_completed, desired_result,
        expectation_accuracy, external_conditions, completed_at)
     values ($1,$2,'goal',$3,'Restore drill outcome review',
             $4::jsonb,'2026-12-01','completed','yes','partly','no',
             'unchanged', now())`,
    [
      seed.outcomeReviewId,
      seed.userId,
      seed.goalId,
      JSON.stringify({
        source: "goal",
        title: "Restore drill outcome review",
        summary: "Drill outcome expected",
        lines: [{ label: "Desired outcome", text: "Drill outcome expected" }],
        captured_at: "2026-01-01T00:00:00.000Z",
      }),
    ],
  );

  await client.query(
    `insert into public.outcome_observations
       (review_id, user_id, kind, text, verdict)
     values ($1,$2,'assumption','The drill assumption held in the drill.','held')`,
    [seed.outcomeReviewId, seed.userId],
  );

  await client.query(
    `insert into public.outcome_forecasts
       (review_id, user_id, statement, probability, resolution, resolved_at)
     values ($1,$2,'The drill forecast occurs',70,'occurred', now())`,
    [seed.outcomeReviewId, seed.userId],
  );

  await client.query(
    `insert into public.improvement_proposals
       (id, user_id, area, title, rationale, change_text, consent_confirmed, test_scope)
     values ($1,$2,'review_timing','Drill timing proposal',
             'A drill rationale that is long enough to pass.',
             'Suggest a review after fourteen days.', true,
             'My own next three decisions only')`,
    [seed.improvementProposalId, seed.userId],
  );

  await client.query(
    `insert into public.improvement_versions
       (user_id, proposal_id, area, version, content, status)
     values ($1,$2,'review_timing',1,'Suggest a review after fourteen days.','active')`,
    [seed.userId, seed.improvementProposalId],
  );

  await client.query(
    `insert into public.app_projects
       (id, user_id, name, purpose, target_users, workflows, required_pages,
        entities, auth_requirements, integrations, design_preferences,
        definition_of_done)
     values ($1,$2,$3,'A drill app that records repairs for a small workshop.',
             'Two workshop volunteers','Log a repair','/repairs | Repairs | See repairs',
             'repair: title, notes','supabase','Email reminders','Calm and clear',
             'A repair can be logged and found again')`,
    [seed.appProjectId, seed.userId, `Restore drill app ${label}`],
  );

  await client.query(
    `insert into public.app_specs (id, project_id, user_id, version, spec, approved_at)
     values ($1,$2,$3,1,$4::jsonb, now())`,
    [
      seed.appSpecId,
      seed.appProjectId,
      seed.userId,
      JSON.stringify({
        stack: "nextjs-typescript-tailwind",
        purpose: `Restore drill app ${label}`,
        pages: [{ path: "/", title: "Home", purpose: "Drill home" }],
        entities: [{ name: "repair", fields: ["title", "notes"] }],
        env_vars: ["NEXT_PUBLIC_SUPABASE_URL"],
        integrations: [],
      }),
    ],
  );

  await client.query(
    `insert into public.app_files (id, project_id, user_id, path, content)
     values ($1,$2,$3,'app/page.tsx','export default function Page() { return null; }')`,
    [seed.appFileId, seed.appProjectId, seed.userId],
  );

  await client.query(
    `insert into public.app_versions (id, project_id, user_id, version, summary, files)
     values ($1,$2,$3,1,'Generated 1 file.','[{"path":"app/page.tsx","content":"export default function Page() { return null; }"}]'::jsonb)`,
    [seed.appVersionId, seed.appProjectId, seed.userId],
  );

  await client.query(
    `update public.app_projects
        set status = 'generated', current_version = 1
      where id = $1`,
    [seed.appProjectId],
  );
}
