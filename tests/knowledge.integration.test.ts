import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  asAnon,
  asUser,
  assertIsolatedDatabase,
  bootstrapSupabase,
  replayMigrations,
} from "./support/phase37-db";

/**
 * Phase 37 regression harness, on an isolated database.
 *
 * The runner (`npm run test:knowledge`) starts an embedded Postgres, replays
 * every migration into it, and sets KNOWLEDGE_TEST_DATABASE_URL. This file
 * refuses to run without that variable, so a plain `npm test` skips it and it
 * can never be pointed at the hosted project.
 *
 * Every check is written against the rules the migration claims to enforce:
 * what a person may verify, what crosses a workspace boundary, who may approve
 * a transfer, and what a retraction or a deletion does to linked rows.
 */
const connectionString = process.env.KNOWLEDGE_TEST_DATABASE_URL;
const describeKnowledge = connectionString ? describe : describe.skip;

describeKnowledge("phase 37 knowledge layer", () => {
  let client: Client;
  const userA = randomUUID();
  const userB = randomUUID();
  const userC = randomUUID();
  const userD = randomUUID();
  const userE = randomUUID();
  const userF = randomUUID();
  const workspaceA = randomUUID();
  const workspaceB = randomUUID();
  const experimentId = randomUUID();
  const projectId = randomUUID();
  const changesetId = randomUUID();

  let claimId = "";
  let evidenceId = "";
  let hypothesisId = "";
  let suggestionId = "";
  let firstVersionId = "";
  let secondVersionId = "";
  let transferId = "";
  let copyId = "";

  const asA = <T>(run: () => Promise<T>) => asUser(client, userA, run);
  const asB = <T>(run: () => Promise<T>) => asUser(client, userB, run);
  const asC = <T>(run: () => Promise<T>) => asUser(client, userC, run);
  const asD = <T>(run: () => Promise<T>) => asUser(client, userD, run);
  const asF = <T>(run: () => Promise<T>) => asUser(client, userF, run);

  async function failure(run: () => Promise<unknown>): Promise<string> {
    try {
      await run();
    } catch (error) {
      return (error as Error).message;
    }
    throw new Error("expected the statement to fail, but it succeeded");
  }

  async function count(sql: string, values: unknown[] = []): Promise<number> {
    const result = await client.query<{ count: string }>(sql, values);
    return Number(result.rows[0]?.count ?? 0);
  }

  async function createEntry(values: {
    workspaceId: string;
    kind: string;
    claimType: string;
    title: string;
    statement: string;
    domain?: string;
  }): Promise<string> {
    const result = await asA(() =>
      client.query<{ id: string }>(
        "select public.knowledge_create_entry($1,$2,$3,$4,$5,$6) as id",
        [
          values.workspaceId,
          values.kind,
          values.claimType,
          values.title,
          values.statement,
          values.domain ?? "Volunteer onboarding",
        ],
      ),
    );
    return result.rows[0]?.id ?? "";
  }

  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await assertIsolatedDatabase(client);
    await bootstrapSupabase(client);
    await replayMigrations(client);

    for (const userId of [userA, userB, userC, userD, userE, userF]) {
      await client.query("insert into auth.users (id, email) values ($1,$2)", [
        userId,
        `phase37-${userId.slice(0, 8)}@example.test`,
      ]);
    }

    for (const [workspaceId, owner, name] of [
      [workspaceA, userA, "Shift finder pilot"],
      [workspaceB, userB, "Weekend programme"],
    ] as const) {
      await client.query("insert into public.workspaces (id, name, created_by) values ($1,$2,$3)", [
        workspaceId,
        name,
        owner,
      ]);
      await client.query(
        "insert into public.workspace_members (workspace_id, user_id, role, status) values ($1,$2,'owner','active')",
        [workspaceId, owner],
      );
    }

    // Phase 28 build room fixtures: a project owned by D, a changeset authored by
    // E, and F who has no role in the project at all.
    await client.query(
      `insert into public.app_projects
         (id, user_id, name, purpose, target_users, workflows, required_pages, entities,
          auth_requirements, integrations, definition_of_done)
       values ($1,$2,'Build room probe','A synthetic project used to probe project roles.',
               'Probe operators','Record one probe','/ | Home','','none','',
               'A probe record exists')`,
      [projectId, userD],
    );
    await client.query(
      "insert into public.app_project_members (project_id, user_id, role, status) values ($1,$2,'owner','active')",
      [projectId, userD],
    );
    await client.query(
      `insert into public.app_changesets
         (id, project_id, author_id, title, base_version, base_digest, base_files, files, status)
       values ($1,$2,$3,'Probe changeset',0,$4,$5::jsonb,$6::jsonb,'in_review')`,
      [
        changesetId,
        projectId,
        userE,
        "a".repeat(32),
        JSON.stringify([{ path: "app/page.tsx", content: "export default function Page() { return null; }" }]),
        JSON.stringify([{ path: "app/page.tsx", content: "export default function Page() { return null; }" }]),
      ],
    );

    await client.query(
      `insert into public.experiments
         (id, workspace_id, created_by, question, hypothesis, target_users,
          proposed_prototype, success_criteria, failure_criteria, time_limit_minutes,
          privacy_requirements, consent_requirements, stop_conditions, review_at)
       values ($1,$2,$3,
               'Do volunteers forget a confirmed shift when no reminder is sent?',
               'Most volunteers miss the shift without a reminder.',
               'Volunteers who signed up once',
               'A three-page synthetic shift finder',
               'Four of six miss the shift',
               'Nobody misses the shift',
               120,
               'Synthetic records only, no personal data',
               'Not applicable, synthetic data',
               'Stop after one synthetic run',
               current_date + 14)`,
      [experimentId, workspaceA, userA],
    );
  }, 180_000);

  afterAll(async () => {
    if (client) await client.end();
  });

  it("replays every migration and leaves the seven knowledge tables read-only for clients", async () => {
    expect(
      await count(
        `select count(*)::text as count from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'knowledge_%'`,
      ),
    ).toBe(7);

    expect(
      await count(
        `select count(*)::text as count from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname like 'knowledge_%' and c.relrowsecurity`,
      ),
    ).toBe(7);

    expect(
      await count(
        "select count(*)::text as count from pg_policies where schemaname = 'public' and tablename like 'knowledge_%'",
      ),
    ).toBe(7);

    const grants = await client.query<{ privilege_type: string }>(
      `select privilege_type from information_schema.role_table_grants
        where grantee = 'authenticated' and table_schema = 'public' and table_name like 'knowledge_%'`,
    );
    expect([...new Set(grants.rows.map((row) => row.privilege_type))]).toEqual(["SELECT"]);
  });

  it("keeps knowledge unavailable to anonymous callers", async () => {
    const denied = await asAnon(client, () =>
      failure(() =>
        client.query("select * from public.knowledge_retrieve($1,'','')", [workspaceA]),
      ),
    );
    expect(denied).toMatch(/permission denied/);

    const tableDenied = await asAnon(client, () =>
      failure(() => client.query("select 1 from public.knowledge_entries limit 1")),
    );
    expect(tableDenied).toMatch(/permission denied/);
  });

  it("records a claim from the experiment, with evidence, and verifies it", async () => {
    claimId = await createEntry({
      workspaceId: workspaceA,
      kind: "claim",
      claimType: "measured_observation",
      title: "Volunteers forget a confirmed shift",
      statement:
        "Four of six volunteers in the synthetic pilot missed a shift they had already confirmed.",
    });
    expect(claimId).toMatch(/^[0-9a-f-]{36}$/);

    const source = await asA(() =>
      client.query<{ id: string }>("select public.knowledge_add_source($1,$2,$3,$4) as id", [
        claimId,
        "experiment",
        experimentId,
        "Synthetic pilot",
      ]),
    );
    expect(source.rows[0]?.id).toBeTruthy();

    const evidence = await asA(() =>
      client.query<{ id: string }>(
        "select public.knowledge_add_evidence($1,$2,$3,$4,$5,$6) as id",
        [
          claimId,
          "supports",
          "measured_observation",
          "Four of six confirmed volunteers did not attend the synthetic shift.",
          "experiment",
          experimentId,
        ],
      ),
    );
    evidenceId = evidence.rows[0]?.id ?? "";
    expect(evidenceId).toBeTruthy();

    const shortNote = await asA(() =>
      failure(() =>
        client.query("select public.knowledge_set_verification($1,$2,$3)", [
          claimId,
          "supported",
          "too short",
        ]),
      ),
    );
    expect(shortNote).toMatch(/write the basis/);

    const outsider = await asB(() =>
      failure(() =>
        client.query("select public.knowledge_set_verification($1,$2,$3)", [
          claimId,
          "supported",
          "an outsider trying to verify this entry",
        ]),
      ),
    );
    expect(outsider).toMatch(/not a member of this workspace/);

    await asA(() =>
      client.query("select public.knowledge_set_verification($1,$2,$3)", [
        claimId,
        "supported",
        "Six synthetic records, one observed run, no reminder sent.",
      ]),
    );

    const verified = await client.query<{ verification_status: string; verified_by: string }>(
      "select verification_status, verified_by from public.knowledge_entries where id = $1",
      [claimId],
    );
    expect(verified.rows[0]?.verification_status).toBe("supported");
    expect(verified.rows[0]?.verified_by).toBe(userA);
  });

  it("never promotes an AI suggestion or a hypothesis to supported", async () => {
    hypothesisId = await createEntry({
      workspaceId: workspaceA,
      kind: "claim",
      claimType: "hypothesis",
      title: "Reminders would fix the missed shifts",
      statement: "A reminder one day before the shift would stop volunteers missing it.",
    });
    suggestionId = await createEntry({
      workspaceId: workspaceA,
      kind: "claim",
      claimType: "ai_suggestion",
      title: "Maybe shift reminders should be shorter",
      statement: "An assistant suggested shortening the reminder to one line of text.",
    });

    const hypothesis = await asA(() =>
      failure(() =>
        client.query("select public.knowledge_set_verification($1,$2,$3)", [
          hypothesisId,
          "supported",
          "The hypothesis sounds right to me and to the model.",
        ]),
      ),
    );
    expect(hypothesis).toMatch(/hypothesis is not supported by being restated/);

    const suggestion = await asA(() =>
      failure(() =>
        client.query("select public.knowledge_set_verification($1,$2,$3)", [
          suggestionId,
          "supported",
          "The assistant wrote this and it looks convincing.",
        ]),
      ),
    );
    expect(suggestion).toMatch(/AI suggestion is never promoted/);

    expect(
      await count(
        "select count(*)::text as count from public.knowledge_entries where claim_type <> 'measured_observation' and verification_status = 'supported'",
      ),
    ).toBe(0);
  });

  it("keeps one workspace's entries and retrieval invisible to the other", async () => {
    const foreign = await asB(() =>
      client.query<{ count: string }>(
        "select count(*)::text as count from public.knowledge_entries where workspace_id = $1",
        [workspaceA],
      ),
    );
    expect(Number(foreign.rows[0]?.count ?? 0)).toBe(0);

    const foreignRetrieval = await asB(() =>
      client.query("select * from public.knowledge_retrieve($1,'','')", [workspaceA]),
    );
    expect(foreignRetrieval.rowCount).toBe(0);

    const own = await asA(() =>
      client.query<{ title: string }>("select title from public.knowledge_retrieve($1,'','')", [
        workspaceA,
      ]),
    );
    expect(own.rows.map((row) => row.title)).toContain("Volunteers forget a confirmed shift");
  });

  it("records the recommendation the claim was built on", async () => {
    const impact = await asA(() =>
      client.query<{ id: string }>("select public.knowledge_mark_impact($1,$2,$3,$4,$5) as id", [
        claimId,
        "recommendation",
        null,
        "Reminder copy in the shift finder",
        "Proposed reminder wording",
      ]),
    );
    expect(impact.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("shows a transfer proposal to both workspaces and to nobody else", async () => {
    const proposed = await asA(() =>
      client.query<{ id: string }>(
        "select public.knowledge_propose_transfer($1,$2,$3,$4,$5,$6) as id",
        [
          claimId,
          workspaceB,
          "Both projects run single-session volunteer shifts with the same coordinator.",
          "The second programme runs weekend shifts and sends a printed schedule instead of an email.",
          "One synthetic run, four of six missed, no reminder sent.",
          "A reminder still helps when shifts happen only at weekends.",
        ],
      ),
    );
    transferId = proposed.rows[0]?.id ?? "";
    expect(transferId).toMatch(/^[0-9a-f-]{36}$/);

    for (const [label, as] of [
      ["source workspace", asA],
      ["target workspace", asB],
    ] as const) {
      const visible = await as(() =>
        client.query<{ count: string }>(
          "select count(*)::text as count from public.knowledge_transfers where id = $1",
          [transferId],
        ),
      );
      expect(Number(visible.rows[0]?.count ?? 0), label).toBe(1);
    }

    const outsider = await asC(() =>
      client.query<{ count: string }>(
        "select count(*)::text as count from public.knowledge_transfers where id = $1",
        [transferId],
      ),
    );
    expect(Number(outsider.rows[0]?.count ?? 0)).toBe(0);
  });

  it("refuses a transfer decision from anyone without a role in the target workspace", async () => {
    // Regression for 0052: `v_role not in ('owner','admin')` is NULL, not false,
    // for a non-member, so the guard used to fall through and approve.
    const selfApproval = await asA(() =>
      failure(() =>
        client.query("select public.knowledge_decide_transfer($1,$2,$3)", [
          transferId,
          true,
          "approving my own transfer",
        ]),
      ),
    );
    expect(selfApproval).toMatch(/only an owner or admin of the target workspace/);

    const stillProposed = await client.query<{ status: string }>(
      "select status from public.knowledge_transfers where id = $1",
      [transferId],
    );
    expect(stillProposed.rows[0]?.status).toBe("proposed");

    const approved = await asB(() =>
      client.query<{ id: string }>("select public.knowledge_decide_transfer($1,$2,$3) as id", [
        transferId,
        true,
        "Applies here too, worth testing.",
      ]),
    );
    copyId = approved.rows[0]?.id ?? "";
    expect(copyId).toMatch(/^[0-9a-f-]{36}$/);

    const copy = await client.query<{
      workspace_id: string;
      provenance: string;
      limitations: string;
      transferred_from_id: string;
    }>(
      "select workspace_id, provenance, limitations, transferred_from_id from public.knowledge_entries where id = $1",
      [copyId],
    );
    const row = copy.rows[0];
    expect(row?.workspace_id).toBe(workspaceB);
    expect(row?.transferred_from_id).toBe(claimId);
    expect(row?.provenance).toContain("Shift finder pilot");
    expect(row?.limitations).toContain("Shift finder pilot");
    expect(row?.limitations).toContain("Assumption to test");

    expect(
      await count("select count(*)::text as count from public.knowledge_evidence where entry_id = $1", [
        copyId,
      ]),
    ).toBe(0);

    expect(
      await count(
        "select count(*)::text as count from public.knowledge_sources where entry_id = $1 and source_kind = 'transfer'",
        [copyId],
      ),
    ).toBe(1);
  });

  it("refuses a retention purge from someone with no role in the workspace", async () => {
    const purge = await asA(() =>
      failure(() => client.query("select public.knowledge_purge_expired($1)", [workspaceB])),
    );
    expect(purge).toMatch(/only an owner or admin can purge/);
  });

  it("supersedes an entry and records the version links", async () => {
    firstVersionId = await createEntry({
      workspaceId: workspaceA,
      kind: "claim",
      claimType: "measured_observation",
      title: "Reminder timing after the rerun",
      statement:
        "A reminder one day before the shift cut the misses in the second synthetic run.",
    });

    const superseded = await asA(() =>
      client.query<{ id: string }>(
        "select public.knowledge_supersede_entry($1,$2,$3,$4,$5) as id",
        [
          firstVersionId,
          "Reminder timing after the rerun, revised",
          "A reminder one day before the shift cut the misses to one of six in the second synthetic run.",
          "Two synthetic runs",
          "The rerun reproduced the result with a smaller effect.",
        ],
      ),
    );
    secondVersionId = superseded.rows[0]?.id ?? "";
    expect(secondVersionId).toMatch(/^[0-9a-f-]{36}$/);

    const versions = await client.query<{
      id: string;
      status: string;
      supersedes_id: string | null;
      superseded_by_id: string | null;
    }>(
      "select id, status, supersedes_id, superseded_by_id from public.knowledge_entries where id = any($1::uuid[])",
      [[firstVersionId, secondVersionId]],
    );
    const byId = new Map(versions.rows.map((version) => [version.id, version]));
    expect(byId.get(firstVersionId)?.status).toBe("superseded");
    expect(byId.get(firstVersionId)?.superseded_by_id).toBe(secondVersionId);
    expect(byId.get(secondVersionId)?.supersedes_id).toBe(firstVersionId);
  });

  it("retracts the claim and marks the linked recommendation invalid", async () => {
    const retracted = await asA(() =>
      client.query<{ invalidated: number }>(
        "select public.knowledge_retract_entry($1,$2) as invalidated",
        [
          claimId,
          "The synthetic pilot was rerun and two of six attended, so the claim does not hold.",
        ],
      ),
    );
    expect(Number(retracted.rows[0]?.invalidated)).toBe(1);

    const impact = await client.query<{
      invalidated_at: string | null;
      invalidated_reason: string | null;
    }>("select invalidated_at, invalidated_reason from public.knowledge_impacts where entry_id = $1", [
      claimId,
    ]);
    expect(impact.rows[0]?.invalidated_at).not.toBeNull();
    expect(impact.rows[0]?.invalidated_reason).toContain("does not hold");

    const retrieval = await asA(() =>
      client.query<{ id: string }>("select id from public.knowledge_retrieve($1,'','')", [workspaceA]),
    );
    expect(retrieval.rows.map((row) => row.id)).not.toContain(claimId);

    const copyStillStands = await asB(() =>
      client.query<{ verification_status: string; status: string }>(
        "select verification_status, status from public.knowledge_entries where id = $1",
        [copyId],
      ),
    );
    expect(copyStillStands.rows[0]?.verification_status).not.toBe("retracted");
    expect(copyStillStands.rows[0]?.status).toBe("active");
  });

  it("purges linked entries past retention and clears the cascade links", async () => {
    await client.query(
      "update public.knowledge_entries set delete_after = current_date - 1 where id = any($1::uuid[])",
      [[firstVersionId, secondVersionId]],
    );

    const purged = await asA(() =>
      client.query<{ purged: number }>("select public.knowledge_purge_expired($1) as purged", [
        workspaceA,
      ]),
    );
    expect(Number(purged.rows[0]?.purged)).toBe(2);

    expect(
      await count(
        "select count(*)::text as count from public.knowledge_entries where id = any($1::uuid[])",
        [[firstVersionId, secondVersionId]],
      ),
    ).toBe(0);

    // A transferred copy points back at the source entry. Deleting the source
    // workspace must clear that link instead of raising (regression for 0053).
    await client.query("delete from public.workspaces where id = $1", [workspaceA]);

    const surviving = await client.query<{ transferred_from_id: string | null }>(
      "select transferred_from_id from public.knowledge_entries where id = $1",
      [copyId],
    );
    expect(surviving.rows[0]?.transferred_from_id).toBeNull();
  });

  it("refuses client writes and protects recorded evidence", async () => {
    // Its own entry and evidence, because the purge test above deleted the
    // workspace that held the earlier fixtures.
    const probe = await asB(() =>
      client.query<{ id: string }>(
        "select public.knowledge_create_entry($1,$2,$3,$4,$5,$6) as id",
        [
          workspaceB,
          "claim",
          "measured_observation",
          "Evidence guard probe",
          "A synthetic statement long enough for the evidence guard check.",
          "Testing",
        ],
      ),
    );
    const probeEntryId = probe.rows[0]?.id ?? "";
    expect(probeEntryId).toMatch(/^[0-9a-f-]{36}$/);

    const probeEvidence = await asB(() =>
      client.query<{ id: string }>("select public.knowledge_add_evidence($1,$2,$3,$4) as id", [
        probeEntryId,
        "supports",
        "measured_observation",
        "A synthetic supporting observation recorded for the guard check.",
      ]),
    );
    const probeEvidenceId = probeEvidence.rows[0]?.id ?? "";
    expect(probeEvidenceId).toMatch(/^[0-9a-f-]{36}$/);

    const insert = await asB(() =>
      failure(() =>
        client.query(
          `insert into public.knowledge_entries
             (workspace_id, created_by, owner_id, kind, claim_type, title, statement, domain)
           values ($1,$2,$2,'claim','project_fact','Written around the rules','A statement that skipped every function.','Testing')`,
          [workspaceB, userB],
        ),
      ),
    );
    expect(insert).toMatch(/permission denied|row-level security/);

    // The client role holds SELECT only, so it cannot delete evidence at all.
    const deniedDelete = await asB(() =>
      failure(() =>
        client.query("delete from public.knowledge_evidence where id = $1", [probeEvidenceId]),
      ),
    );
    expect(deniedDelete).toMatch(/permission denied/);

    // Even with the privilege, the trigger refuses to erase a recorded item.
    const guard = await failure(() =>
      client.query("delete from public.knowledge_evidence where id = $1", [probeEvidenceId]),
    );
    expect(guard).toMatch(/recorded evidence cannot be deleted/);

    expect(
      await count("select count(*)::text as count from public.knowledge_evidence where id = $1", [
        probeEvidenceId,
      ]),
    ).toBe(1);
  });

  it("records a correction and accepts it as a new version", async () => {
    const created = await asB(() =>
      client.query<{ id: string }>(
        "select public.knowledge_create_entry($1,$2,$3,$4,$5,$6) as id",
        [
          workspaceB,
          "claim",
          "measured_observation",
          "Correction target claim",
          "The original wording of the claim that a correction will replace.",
          "Testing",
        ],
      ),
    );
    const entryId = created.rows[0]?.id ?? "";
    expect(entryId).toMatch(/^[0-9a-f-]{36}$/);

    const outsider = await asC(() =>
      failure(() =>
        client.query("select public.knowledge_record_correction($1,$2,$3,$4)", [
          entryId,
          "correction",
          "An outsider proposing a change to a claim in another workspace.",
          "A replacement statement written by someone outside the workspace.",
        ]),
      ),
    );
    expect(outsider).toMatch(/not a member of this workspace/);

    const badKind = await asB(() =>
      failure(() =>
        client.query("select public.knowledge_record_correction($1,$2,$3)", [
          entryId,
          "rewrite",
          "An attempt with a kind the migration does not allow.",
        ]),
      ),
    );
    expect(badKind).toMatch(/choose correction or dispute/);

    const shortProposal = await asB(() =>
      failure(() =>
        client.query("select public.knowledge_record_correction($1,$2,$3,$4)", [
          entryId,
          "correction",
          "The number in this claim is wrong.",
          "too short",
        ]),
      ),
    );
    expect(shortProposal).toMatch(/proposes the replacement wording/);

    const recorded = await asB(() =>
      client.query<{ id: string }>(
        "select public.knowledge_record_correction($1,$2,$3,$4) as id",
        [
          entryId,
          "correction",
          "The rerun put the misses at two of six volunteers, not four.",
          "The rerun put the misses at two of six volunteers, not four of six.",
        ],
      ),
    );
    const correctionId = recorded.rows[0]?.id ?? "";
    expect(correctionId).toMatch(/^[0-9a-f-]{36}$/);

    const outsiderDecision = await asC(() =>
      failure(() =>
        client.query("select public.knowledge_decide_correction($1,$2,$3)", [
          correctionId,
          true,
          "an outsider deciding a correction",
        ]),
      ),
    );
    expect(outsiderDecision).toMatch(/not a member of this workspace/);

    const accepted = await asB(() =>
      client.query<{ id: string | null }>("select public.knowledge_decide_correction($1,$2,$3) as id", [
        correctionId,
        true,
        "The rerun confirms the correction.",
      ]),
    );
    const newVersionId = accepted.rows[0]?.id ?? "";
    expect(newVersionId).toMatch(/^[0-9a-f-]{36}$/);

    const versions = await client.query<{ id: string; status: string; statement: string }>(
      "select id, status, statement from public.knowledge_entries where id = any($1::uuid[])",
      [[entryId, newVersionId]],
    );
    const byId = new Map(versions.rows.map((row) => [row.id, row]));
    expect(byId.get(entryId)?.status).toBe("superseded");
    expect(byId.get(newVersionId)?.statement).toContain("two of six");

    const decision = await client.query<{ status: string; decided_by: string }>(
      "select status, decided_by from public.knowledge_corrections where id = $1",
      [correctionId],
    );
    expect(decision.rows[0]?.status).toBe("accepted");
    expect(decision.rows[0]?.decided_by).toBe(userB);

    const again = await asB(() =>
      failure(() =>
        client.query("select public.knowledge_decide_correction($1,$2,$3)", [
          correctionId,
          false,
          "trying to decide the same correction twice",
        ]),
      ),
    );
    expect(again).toMatch(/already decided/);
  });

  it("rejects a correction without touching the entry, and upholds a dispute", async () => {
    const created = await asB(() =>
      client.query<{ id: string }>(
        "select public.knowledge_create_entry($1,$2,$3,$4,$5,$6) as id",
        [
          workspaceB,
          "claim",
          "measured_observation",
          "Dispute target claim",
          "A claim that will be disputed and then withdrawn after the review.",
          "Testing",
        ],
      ),
    );
    const entryId = created.rows[0]?.id ?? "";

    await asB(() =>
      client.query("select public.knowledge_mark_impact($1,$2,$3,$4,$5)", [
        entryId,
        "recommendation",
        null,
        "Weekend volunteer reminder",
        "Built on the claim that is now disputed",
      ]),
    );

    const rejectedCorrection = await asB(() =>
      client.query<{ id: string }>(
        "select public.knowledge_record_correction($1,$2,$3,$4) as id",
        [
          entryId,
          "correction",
          "A rewording that the owner will reject after reading it.",
          "A replacement statement that will not be accepted here.",
        ],
      ),
    );
    const rejectedId = rejectedCorrection.rows[0]?.id ?? "";
    await asB(() =>
      client.query("select public.knowledge_decide_correction($1,$2,$3)", [
        rejectedId,
        false,
        "The original wording is the one that was observed.",
      ]),
    );

    const rejected = await client.query<{ status: string }>(
      "select status from public.knowledge_corrections where id = $1",
      [rejectedId],
    );
    expect(rejected.rows[0]?.status).toBe("rejected");

    const untouched = await client.query<{ status: string; statement: string }>(
      "select status, statement from public.knowledge_entries where id = $1",
      [entryId],
    );
    expect(untouched.rows[0]?.status).toBe("active");
    expect(untouched.rows[0]?.statement).toContain("will be disputed");

    const dispute = await asB(() =>
      client.query<{ id: string }>("select public.knowledge_record_correction($1,$2,$3) as id", [
        entryId,
        "dispute",
        "The observation behind this claim was recorded twice by mistake.",
      ]),
    );
    const disputeId = dispute.rows[0]?.id ?? "";

    const upheld = await asB(() =>
      client.query<{ id: string | null }>("select public.knowledge_decide_correction($1,$2,$3) as id", [
        disputeId,
        true,
        "The double count is confirmed, so the claim is withdrawn.",
      ]),
    );
    expect(upheld.rows[0]?.id ?? null).toBeNull();

    const retracted = await client.query<{ status: string; verification_status: string }>(
      "select status, verification_status from public.knowledge_entries where id = $1",
      [entryId],
    );
    expect(retracted.rows[0]?.status).toBe("retracted");
    expect(retracted.rows[0]?.verification_status).toBe("retracted");

    const impact = await client.query<{ invalidated_at: string | null }>(
      "select invalidated_at from public.knowledge_impacts where entry_id = $1",
      [entryId],
    );
    expect(impact.rows[0]?.invalidated_at).not.toBeNull();
  });

  it("refuses build-room actions from someone with no project role", async () => {
    // Regression for 0054: app_project_role() is NULL for a non-member, so the
    // guard `v_role not in (...)` used to fall through and permit the caller.
    const task = await asF(() =>
      failure(() =>
        client.query("select public.create_app_build_task($1,$2,$3,$4,$5,$6)", [
          projectId,
          "Task from a stranger",
          "A build task created without any role in this project.",
          "human",
          null,
          null,
        ]),
      ),
    );
    expect(task).toMatch(/contributor access required/);

    const owned = await asD(() =>
      client.query<{ id: string }>(
        "select public.create_app_build_task($1,$2,$3,$4,$5,$6) as id",
        [
          projectId,
          "Task from the owner",
          "A build task created by someone with a real project role.",
          "human",
          null,
          null,
        ],
      ),
    );
    expect(owned.rows[0]?.id).toMatch(/^[0-9a-f-]{36}$/);

    const review = await asF(() =>
      failure(() =>
        client.query("select public.review_app_changeset($1,$2,$3)", [
          changesetId,
          "approve",
          "an outsider approving a changeset",
        ]),
      ),
    );
    expect(review).toMatch(/reviewer access required/);

    await asD(() =>
      client.query("select public.review_app_changeset($1,$2,$3)", [
        changesetId,
        "approve",
        "The project owner reviewed the probe changeset.",
      ]),
    );
    const decided = await client.query<{ status: string }>(
      "select status from public.app_changesets where id = $1",
      [changesetId],
    );
    expect(decided.rows[0]?.status).toBe("approved");

    const link = await asD(() =>
      failure(() =>
        client.query("select public.link_app_workspace($1,$2)", [projectId, workspaceB]),
      ),
    );
    expect(link).toMatch(/workspace owner or admin required/);
  });

  it("refuses a share link for a project the caller does not belong to", async () => {
    // Regression for 0055: app_project_role() returns NULL for a non-member, so
    // `app_project_role(...) not in ('owner','maintainer')` fell through and a
    // stranger could mint a share link for any project.
    const denied = await asF(() =>
      failure(() =>
        client.query("select public.create_app_share_link($1,$2,$3)", [projectId, "a".repeat(64), 24]),
      ),
    );
    expect(denied).toMatch(/maintainer access required/);

    const minted = await asD(() =>
      client.query<{ result: { ok: boolean } }>(
        "select public.create_app_share_link($1,$2,$3) as result",
        [projectId, "b".repeat(64), 24],
      ),
    );
    expect(minted.rows[0]?.result.ok).toBe(true);
  });

  it("refuses mission-control actions from someone outside the workspace", async () => {
    // Regression for 0055: workspace_role() is NULL for a non-member, so
    // `workspace_role(...) not in ('owner','admin')` fell through and any
    // signed-in user could drive another workspace's mission jobs.
    const missionWorkspace = randomUUID();
    const missionId = randomUUID();
    const jobId = randomUUID();
    const approvalId = randomUUID();
    await client.query(
      "insert into public.workspaces (id, name, created_by) values ($1,'Mission probe workspace',$2)",
      [missionWorkspace, userA],
    );
    await client.query(
      "insert into public.workspace_members (workspace_id, user_id, role, status) values ($1,$2,'owner','active')",
      [missionWorkspace, userA],
    );
    await client.query(
      `insert into public.missions
         (id, workspace_id, created_by, title, category, problem, stakeholders,
          desired_outcome, constraints, status)
       values ($1,$2,$3,'Mission control probe','community',
               'A synthetic mission used to probe mission-control authorization.',
               'Probe operators','The probe mission stays under its owner control.',
               '', 'active')`,
      [missionId, missionWorkspace, userA],
    );
    await client.query(
      `insert into public.mission_projects (mission_id, workspace_id, project_id, label, linked_by)
       values ($1,$2,$3,'Probe project link',$4)`,
      [missionId, missionWorkspace, projectId, userA],
    );
    await client.query(
      `insert into public.mission_agent_jobs
         (id, mission_id, workspace_id, project_id, title, objective, role, dedupe_key, status)
       values ($1,$2,$3,$4,'Probe job','Prove a stranger cannot cancel this job.',
               'coordinator','probe-job','queued')`,
      [jobId, missionId, missionWorkspace, projectId],
    );
    await client.query(
      `insert into public.mission_approvals
         (id, mission_id, workspace_id, kind, summary, scope, requested_by,
          requested_by_kind, status)
       values ($1,$2,$3,'deployment','Probe approval','Deploy the synthetic probe.',
               $4,'human','pending')`,
      [approvalId, missionId, missionWorkspace, userE],
    );

    const cancelled = await asF(() =>
      client.query<{ result: { ok: boolean; code?: string } }>(
        "select public.mission_control_cancel_job($1) as result",
        [jobId],
      ),
    );
    expect(cancelled.rows[0]?.result).toMatchObject({ ok: false, code: "forbidden" });

    const decided = await asF(() =>
      client.query<{ result: { ok: boolean; code?: string } }>(
        "select public.mission_control_decide_approval($1,$2,$3) as result",
        [approvalId, "approved", "an outsider approving a deployment"],
      ),
    );
    expect(decided.rows[0]?.result).toMatchObject({ ok: false, code: "forbidden" });

    const ownerCancel = await asA(() =>
      client.query<{ result: { ok: boolean } }>(
        "select public.mission_control_cancel_job($1) as result",
        [jobId],
      ),
    );
    expect(ownerCancel.rows[0]?.result.ok).toBe(true);

    const ownerDecide = await asA(() =>
      client.query<{ result: { ok: boolean } }>(
        "select public.mission_control_decide_approval($1,$2,$3) as result",
        [approvalId, "approved", "the workspace owner approving"],
      ),
    );
    expect(ownerDecide.rows[0]?.result.ok).toBe(true);
  });

  it("refuses the remaining mission-control actions from an outsider", async () => {
    // The other four 0055 guards: claim, finish, cancel the mission, recover.
    const missionWorkspace = randomUUID();
    const missionId = randomUUID();
    const jobId = randomUUID();
    await client.query(
      "insert into public.workspaces (id, name, created_by) values ($1,'Mission ladder workspace',$2)",
      [missionWorkspace, userA],
    );
    await client.query(
      "insert into public.workspace_members (workspace_id, user_id, role, status) values ($1,$2,'owner','active')",
      [missionWorkspace, userA],
    );
    await client.query(
      `insert into public.missions
         (id, workspace_id, created_by, title, category, problem, stakeholders,
          desired_outcome, constraints, status)
       values ($1,$2,$3,'Mission ladder probe','community',
               'A synthetic mission used to probe every mission-control guard.',
               'Probe operators','Each guard refuses a caller from outside.',
               '', 'active')`,
      [missionId, missionWorkspace, userA],
    );
    await client.query(
      `insert into public.mission_projects (mission_id, workspace_id, project_id, label, linked_by)
       values ($1,$2,$3,'Ladder project link',$4)`,
      [missionId, missionWorkspace, projectId, userA],
    );
    await client.query(
      `insert into public.mission_agent_jobs
         (id, mission_id, workspace_id, project_id, title, objective, role, dedupe_key, status)
       values ($1,$2,$3,$4,'Ladder job','Prove every mission-control guard refuses an outsider.',
               'coordinator','ladder-job','queued')`,
      [jobId, missionId, missionWorkspace, projectId],
    );

    const denials: Array<[string, string, unknown[]]> = [
      ["claim", "select public.mission_control_claim_job($1) as result", [jobId]],
      ["finish", "select public.mission_control_finish_job($1,$2,$3) as result", [jobId, "completed", "outsider"]],
      ["cancel mission", "select public.mission_control_cancel_mission($1) as result", [missionId]],
      ["recover", "select public.mission_control_recover($1) as result", [missionId]],
    ];
    for (const [label, sql, args] of denials) {
      const denied = await asF(() => client.query<{ result: { ok: boolean; code?: string } }>(sql, args));
      expect({ label, result: denied.rows[0]?.result }).toMatchObject({
        label,
        result: { ok: false, code: "forbidden" },
      });
    }

    const claimed = await asA(() =>
      client.query<{ result: { ok: boolean } }>(
        "select public.mission_control_claim_job($1) as result",
        [jobId],
      ),
    );
    expect(claimed.rows[0]?.result.ok).toBe(true);

    const finished = await asA(() =>
      client.query<{ result: { ok: boolean } }>(
        "select public.mission_control_finish_job($1,$2,$3) as result",
        [jobId, "completed", "the owner finishing the job"],
      ),
    );
    expect(finished.rows[0]?.result.ok).toBe(true);

    const cancelledMission = await asA(() =>
      client.query<{ result: { ok: boolean } }>(
        "select public.mission_control_cancel_mission($1) as result",
        [missionId],
      ),
    );
    expect(cancelledMission.rows[0]?.result.ok).toBe(true);

    const recovered = await asA(() =>
      client.query<{ result: { ok: boolean } }>(
        "select public.mission_control_recover($1) as result",
        [missionId],
      ),
    );
    expect(recovered.rows[0]?.result.ok).toBe(true);
  });

  it("refuses a review decision that is missing rather than invalid", async () => {
    // Regression for 0056: `p_decision not in ('approve','request_changes')` is
    // NULL for a missing decision, so the check was skipped and the NULL reached
    // the insert, where only a column constraint stopped it.
    const freshChangeset = randomUUID();
    await client.query(
      `insert into public.app_changesets
         (id, project_id, author_id, title, base_version, base_digest, base_files, files, status)
       values ($1,$2,$3,'Decision probe',0,$4,$5::jsonb,$6::jsonb,'in_review')`,
      [
        freshChangeset,
        projectId,
        userE,
        "b".repeat(32),
        JSON.stringify([{ path: "app/page.tsx", content: "export default function Page() { return null; }" }]),
        JSON.stringify([{ path: "app/page.tsx", content: "export default function Page() { return null; }" }]),
      ],
    );

    const denied = await asD(() =>
      failure(() =>
        client.query("select public.review_app_changeset($1,$2,$3)", [
          freshChangeset,
          null,
          "a missing decision",
        ]),
      ),
    );
    expect(denied).toMatch(/invalid review decision/);
  });

  it("reports no schema drift and detects a function that differs", async () => {
    // The drift check compares live function bodies with the migrations after
    // 0054-0056 were applied through pg_get_functiondef, so stored text and
    // repository text can diverge without any behaviour change.
    const run = () =>
      spawnSync(process.execPath, ["scripts/schema-drift-check.mjs"], {
        encoding: "utf8",
        env: { ...process.env, SCHEMA_DRIFT_DATABASE_URL: connectionString },
      });

    const clean = run();
    expect(clean.stderr).toBe("");
    expect(clean.stdout).toMatch(/no drift/);

    // A check that cannot run must not look like a check that passed.
    const unarmed = spawnSync(process.execPath, ["scripts/schema-drift-check.mjs"], {
      encoding: "utf8",
      env: { ...process.env, SCHEMA_DRIFT_DATABASE_URL: "", DATABASE_URL: "", SCHEMA_DRIFT_REQUIRED: "1" },
    });
    expect(unarmed.status).toBe(1);
    expect(unarmed.stdout).toMatch(/nothing was compared/);

    const original = await client.query<{ def: string }>(
      "select pg_get_functiondef('public.mission_control_recover(uuid)'::regprocedure) as def",
    );
    await client.query(
      `create or replace function public.mission_control_recover(p_mission_id uuid)
       returns jsonb language plpgsql security definer set search_path = ''
       as $$ begin return '{"ok": false}'::jsonb; end; $$`,
    );
    const tampered = run();
    expect(tampered.status).toBe(1);
    expect(tampered.stderr).toMatch(/mission_control_recover/);
    expect(tampered.stderr).toMatch(/differ from the migrations/);

    await client.query(original.rows[0]?.def ?? "");
    expect(run().stdout).toMatch(/no drift/);

    // The committed snapshot must describe the migrations exactly, or a clean
    // drift result would be measured against stale expectations.
    const catalogRun = spawnSync(process.execPath, ["scripts/schema-drift-check.mjs", "--print-catalog"], {
      encoding: "utf8",
      maxBuffer: 40 * 1024 * 1024,
      env: { ...process.env, SCHEMA_DRIFT_DATABASE_URL: connectionString },
    });
    const live = JSON.parse(catalogRun.stdout);
    const committed = JSON.parse(readFileSync("supabase/schema.snapshot.json", "utf8"));
    expect(live).toEqual({
      policies: committed.policies,
      constraints: committed.constraints,
      indexes: committed.indexes,
    });

    // An object the migrations do not create is structural drift.
    await client.query(
      "create policy drift_probe on public.workspaces as restrictive for select to anon using (false)",
    );
    const structural = run();
    expect(structural.status).toBe(1);
    expect(structural.stderr).toMatch(/drift_probe/);
    await client.query("drop policy drift_probe on public.workspaces");
    expect(run().stdout).toMatch(/no drift/);
  });

  it("removes a deleted account's workspace and its knowledge", async () => {
    await client.query("delete from auth.users where id = $1", [userB]);

    expect(
      await count(
        "select count(*)::text as count from public.knowledge_entries where workspace_id = $1",
        [workspaceB],
      ),
    ).toBe(0);
    expect(
      await count(
        "select count(*)::text as count from public.knowledge_transfers where target_workspace_id = $1",
        [workspaceB],
      ),
    ).toBe(0);
  });
});
