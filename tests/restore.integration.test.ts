import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildExportBundle, type ExportSource } from "@/lib/export";
import { parseImportFile, importRows } from "@/lib/import";

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

const EXPECTED_CORE_TABLES = 51;

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
                             'app_change_requests','app_change_events','app_skills',
                             'app_observability_settings','app_error_events','app_change_evaluations',
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
       values ($1, $2, 1, '{}'::jsonb) returning id`,
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
