import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
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
      env: {
        ...process.env,
        SCHEMA_DRIFT_DATABASE_URL: "",
        DATABASE_URL: "",
        // A configured Management API credential arms the check too, so an
        // "unarmed" run has to clear it alongside the direct URL.
        SUPABASE_MANAGEMENT_API: "",
        SCHEMA_DRIFT_PROJECT_REF: "",
        SUPABASE_PROJECT_REF: "",
        SCHEMA_DRIFT_REQUIRED: "1",
      },
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

    // A stale snapshot must fail a release rather than silently shifting the
    // baseline the drift check compares against.
    const committedSnapshot = JSON.parse(readFileSync("supabase/schema.snapshot.json", "utf8"));
    const stalePath = path.join(tmpdir(), `schema-snapshot-${randomUUID()}.json`);
    writeFileSync(
      stalePath,
      JSON.stringify({ ...committedSnapshot, policies: committedSnapshot.policies.slice(1) }, null, 2) + "\n",
    );
    const stale = spawnSync(
      process.execPath,
      ["scripts/schema-snapshot.mjs", "--check", "--snapshot", stalePath],
      { encoding: "utf8", env: { ...process.env, SCHEMA_SNAPSHOT_PORT: "55444" } },
    );
    expect(stale.status).toBe(1);
    expect(stale.stderr).toMatch(/stale/);

    const current = spawnSync(process.execPath, ["scripts/schema-snapshot.mjs", "--check"], {
      encoding: "utf8",
      env: { ...process.env, SCHEMA_SNAPSHOT_PORT: "55444" },
    });
    expect(current.status).toBe(0);
    expect(current.stdout).toMatch(/matches the migrations/);

    // A text-only difference must be attributed to the engine: the snapshot is
    // written on one PostgreSQL major version and production may run another.
    const skewedSnapshot = path.join(tmpdir(), `schema-snapshot-skew-${randomUUID()}.json`);
    writeFileSync(
      skewedSnapshot,
      JSON.stringify(
        {
          ...committedSnapshot,
          generatedWith: "PostgreSQL 11.0 on x86_64-pc-linux-gnu",
          policies: committedSnapshot.policies.map((entry: { definition: string }, index: number) =>
            index === 0 ? { ...entry, definition: `${entry.definition} ` } : entry,
          ),
        },
        null,
        2,
      ) + "\n",
    );
    const skewed = spawnSync(process.execPath, ["scripts/schema-drift-check.mjs"], {
      encoding: "utf8",
      env: {
        ...process.env,
        SCHEMA_DRIFT_DATABASE_URL: connectionString,
        SCHEMA_DRIFT_SNAPSHOT: skewedSnapshot,
      },
    });
    const skewedOutput = `${skewed.stdout}${skewed.stderr}`;
    expect(skewed.status).toBe(0);
    expect(skewedOutput).toMatch(/differ only in text/);
    expect(skewedOutput).toMatch(/The engines differ \(snapshot PostgreSQL 11, live PostgreSQL \d+\)/);

    // With matching engines, formatting is no longer an explanation, so the same
    // text-only difference has to fail instead of warning.
    const { rows: [liveEngine] } = await client.query("select version() as version");
    const matchedSnapshot = path.join(tmpdir(), `schema-snapshot-matched-${randomUUID()}.json`);
    writeFileSync(
      matchedSnapshot,
      JSON.stringify(
        {
          ...committedSnapshot,
          generatedWith: liveEngine.version,
          policies: committedSnapshot.policies.map((entry: { definition: string }, index: number) =>
            index === 0 ? { ...entry, definition: `${entry.definition} and true` } : entry,
          ),
        },
        null,
        2,
      ) + "\n",
    );
    const matched = spawnSync(process.execPath, ["scripts/schema-drift-check.mjs"], {
      encoding: "utf8",
      env: {
        ...process.env,
        SCHEMA_DRIFT_DATABASE_URL: connectionString,
        SCHEMA_DRIFT_SNAPSHOT: matchedSnapshot,
      },
    });
    const matchedOutput = `${matched.stdout}${matched.stderr}`;
    expect(matched.status).toBe(1);
    expect(matchedOutput).toMatch(/real definition changes/);
  }, 180_000);

  it("keeps phase 38 held-out keys unreachable and permissions fixed", async () => {
    const owner = randomUUID();
    const outsider = randomUUID();
    const evalId = randomUUID();
    await client.query("insert into auth.users (id, email) values ($1, $2), ($3, $4)", [
      owner,
      `cap-owner-${owner}@example.test`,
      outsider,
      `cap-outsider-${outsider}@example.test`,
    ]);

    let taskId = "";
    let versionId = "";

    await asUser(client, owner, async () => {
      await client.query(
        "insert into public.capability_evals (id, user_id, name, status) values ($1, $2, $3, 'active')",
        [evalId, owner, "Phase 38 capability check"],
      );
      const task = await client.query<{ id: string }>(
        `insert into public.capability_eval_tasks
           (eval_id, user_id, domain, difficulty, split, title, task_spec, dataset_version, permitted_tools, runtime_seconds, spend_limit_cents, scoring_rubric)
         values ($1, $2, 'software_build_repair', 'medium', 'held_out', $3, '{}'::jsonb, 'dataset-v1', '[]'::jsonb, 120, 0, '{}'::jsonb)
         returning id`,
        [evalId, owner, "Held-out repair"],
      );
      taskId = task.rows[0].id;
      const version = await client.query<{ id: string }>(
        `insert into public.capability_eval_versions
           (eval_id, user_id, label, baseline_kind, model_version, orchestration_version, prompt_version, dataset_version, scoring_rubric, permitted_tools, autonomy_permission)
         values ($1, $2, 'Baseline', 'single_model_baseline', 'm1', 'none', 'p1', 'dataset-v1', '{}'::jsonb, '[]'::jsonb, 'none')
         returning id`,
        [evalId, owner],
      );
      versionId = version.rows[0].id;
      const seeded = await client.query<{ keys: number }>(
        "select public.capability_eval_seed_keys($1) as keys",
        [evalId],
      );
      expect(Number(seeded.rows[0].keys)).toBe(1);
    });

    // Even the owner cannot read the answer key table.
    expect(
      await failure(() =>
        asUser(client, owner, () => client.query("select * from public.capability_eval_answer_keys")),
      ),
    ).toMatch(/permission denied/i);

    const scored = await asUser(client, owner, () =>
      client.query<{ scored: Record<string, unknown> }>(
        "select public.capability_eval_score_task($1, $2::jsonb) as scored",
        [
          taskId,
          JSON.stringify({
            elements: ["reproduce"],
            claims: [{ text: "done", supported: true }],
          }),
        ],
      ),
    );
    const result = scored.rows[0].scored;
    expect(result.outcome).toBe("partial_success");
    expect(result.missing_count).toBe(2);
    expect(JSON.stringify(result)).not.toMatch(/patch|verify/);

    expect(
      await failure(() =>
        asUser(client, outsider, () =>
          client.query("select public.capability_eval_score_task($1, '{\"elements\":[]}'::jsonb)", [
            taskId,
          ]),
        ),
      ),
    ).toMatch(/unknown evaluation task/i);

    expect(
      await failure(() =>
        asUser(client, owner, () =>
          client.query(
            "update public.capability_eval_versions set autonomy_permission = 'acts_with_approval' where id = $1",
            [versionId],
          ),
        ),
      ),
    ).toMatch(/cannot expand autonomy permission/i);

    await asUser(client, owner, async () => {
      await client.query(
        `insert into public.capability_eval_runs
           (eval_id, version_id, task_id, user_id, domain, difficulty, split, trial, outcome, verified_success, scoring_detail)
         values ($1, $2, $3, $4, 'software_build_repair', 'medium', 'held_out', 1, 'partial_success', false, '{}'::jsonb)`,
        [evalId, versionId, taskId, owner],
      );
    });

    // The owner has no update policy, so the statement matches nothing; the
    // trigger itself refuses any edit that does reach a row.
    const blockedUpdate = await asUser(client, owner, () =>
      client.query("update public.capability_eval_runs set outcome = 'verified_success' where task_id = $1", [
        taskId,
      ]),
    );
    expect(blockedUpdate.rowCount).toBe(0);
    expect(
      await failure(() =>
        client.query("update public.capability_eval_runs set outcome = 'verified_success' where task_id = $1", [
          taskId,
        ]),
      ),
    ).toMatch(/append-only/i);

    expect(
      await failure(() =>
        asUser(client, owner, () =>
          client.query("update public.capability_eval_tasks set title = 'Rewritten' where id = $1", [
            taskId,
          ]),
        ),
      ),
    ).toMatch(/immutable after the first run/i);

    expect(
      await failure(() =>
        asUser(client, owner, () =>
          client.query(
            `insert into public.capability_eval_human_baselines
               (eval_id, user_id, domain, protocol_document, collected_by, sample_size, results)
             values ($1, $2, 'software_build_repair', 'stub', 'me', 1, '{"verified_rate": 0.5}'::jsonb)`,
            [evalId, owner],
          ),
        ),
      ),
    ).toMatch(/protocol_document|check constraint|violates/i);
  });

  it("refuses a run that exceeds its configuration limits", async () => {
    const owner = randomUUID();
    const evalId = randomUUID();
    await client.query("insert into auth.users (id, email) values ($1, $2)", [
      owner,
      `cap-limits-${owner}@example.test`,
    ]);

    let taskId = "";
    let versionId = "";

    await asUser(client, owner, async () => {
      await client.query(
        "insert into public.capability_evals (id, user_id, name, status) values ($1, $2, $3, 'active')",
        [evalId, owner, "Phase 38 limits"],
      );
      const task = await client.query<{ id: string }>(
        `insert into public.capability_eval_tasks
           (eval_id, user_id, domain, difficulty, split, title, task_spec, dataset_version, permitted_tools, runtime_seconds, spend_limit_cents, scoring_rubric)
         values ($1, $2, 'software_build_repair', 'easy', 'development', $3, '{}'::jsonb, 'dataset-v1', '[]'::jsonb, 120, 50, '{}'::jsonb)
         returning id`,
        [evalId, owner, "Budgeted repair"],
      );
      taskId = task.rows[0].id;
      const version = await client.query<{ id: string }>(
        `insert into public.capability_eval_versions
           (eval_id, user_id, label, baseline_kind, model_version, orchestration_version, prompt_version, dataset_version, scoring_rubric, permitted_tools, runtime_limit_seconds, spend_limit_cents, autonomy_permission)
         values ($1, $2, 'Budgeted', 'single_model_baseline', 'm1', 'none', 'p1', 'dataset-v1', '{}'::jsonb, '[]'::jsonb, 60, 50, 'none')
         returning id`,
        [evalId, owner],
      );
      versionId = version.rows[0].id;
    });

    const insertRun = (trial: number, cost: number, latency: number) =>
      asUser(client, owner, () =>
        client.query(
          `insert into public.capability_eval_runs
             (eval_id, version_id, task_id, user_id, domain, difficulty, split, trial, outcome, verified_success, cost_cents, latency_ms, scoring_detail)
           values ($1, $2, $3, $4, 'software_build_repair', 'easy', 'development', $5, 'verified_success', true, $6, $7, '{}'::jsonb)`,
          [evalId, versionId, taskId, owner, trial, cost, latency],
        ),
      );

    // Exactly at both ceilings is allowed: the limit is a ceiling, not a buffer.
    await insertRun(1, 50, 60_000);

    expect(await failure(() => insertRun(2, 51, 1_000))).toMatch(/cannot spend more/i);
    expect(await failure(() => insertRun(3, 0, 60_001))).toMatch(/time limit/i);
  });

  it("lets a recorded human baseline be retracted but never edited", async () => {
    const owner = randomUUID();
    const evalId = randomUUID();
    await client.query("insert into auth.users (id, email) values ($1, $2)", [
      owner,
      `cap-baseline-${owner}@example.test`,
    ]);

    let baselineId = "";
    await asUser(client, owner, async () => {
      await client.query(
        "insert into public.capability_evals (id, user_id, name, status) values ($1, $2, $3, 'active')",
        [evalId, owner, "Phase 38 baseline"],
      );
      const baseline = await client.query<{ id: string }>(
        `insert into public.capability_eval_human_baselines
           (eval_id, user_id, domain, protocol_document, collected_by, sample_size, results)
         values ($1, $2, 'software_build_repair', $3, 'E2E panel', 5, '{"verified_rate": 0.6}'::jsonb)
         returning id`,
        [
          evalId,
          owner,
          "Two reviewers scored twenty recorded attempts against the published rubric before any results were recorded.",
        ],
      );
      baselineId = baseline.rows[0].id;
    });

    // The recorded protocol cannot be rewritten, by grant or by trigger.
    expect(
      await failure(() =>
        asUser(client, owner, () =>
          client.query(
            "update public.capability_eval_human_baselines set protocol_document = 'rewritten' where id = $1",
            [baselineId],
          ),
        ),
      ),
    ).toMatch(/permission denied|immutable/i);

    const retracted = await asUser(client, owner, () =>
      client.query(
        "update public.capability_eval_human_baselines set status = 'retracted' where id = $1",
        [baselineId],
      ),
    );
    expect(retracted.rowCount).toBe(1);

    // Retraction hides the claim; the record and its evidence stay.
    const retained = await asUser(client, owner, () =>
      client.query<{
        status: string;
        protocol_document: string;
        sample_size: number;
        results: { verified_rate: number };
      }>(
        "select status, protocol_document, sample_size, results from public.capability_eval_human_baselines where id = $1",
        [baselineId],
      ),
    );
    expect(retained.rows).toHaveLength(1);
    expect(retained.rows[0].status).toBe("retracted");
    expect(retained.rows[0].sample_size).toBe(5);
    expect(retained.rows[0].results.verified_rate).toBe(0.6);
    expect(retained.rows[0].protocol_document).toContain("published rubric");

    // Even a role that can write the table cannot rewrite the evidence.
    expect(
      await failure(() =>
        client.query(
          "update public.capability_eval_human_baselines set sample_size = 9 where id = $1",
          [baselineId],
        ),
      ),
    ).toMatch(/immutable/i);
  });

  it("grades a machine-checkable task on a computed answer, not on named elements", async () => {
    const owner = randomUUID();
    const evalId = randomUUID();
    const taskId = randomUUID();
    await client.query("insert into auth.users (id, email) values ($1, $2)", [
      owner,
      `cap-authored-${owner}@example.test`,
    ]);

    await asUser(client, owner, async () => {
      await client.query(
        "insert into public.capability_evals (id, user_id, name, status) values ($1, $2, $3, 'active')",
        [evalId, owner, "Phase 38 authored"],
      );
      await client.query(
        `insert into public.capability_eval_tasks
           (id, eval_id, user_id, domain, difficulty, split, title, task_spec, dataset_version,
            permitted_tools, runtime_seconds, spend_limit_cents, scoring_rubric)
         values ($1, $2, $3, 'quantitative_reasoning', 'medium', 'development', 'Budget remainder',
           jsonb_build_object(
             'mode', 'authored_answer',
             'prompt', 'A job has a 240-minute budget. Setup takes 18 minutes. Each of the 6 failing checks is reproduced in 9 minutes and patched in 14 minutes. Verification takes 25 minutes once. How many minutes remain when the job is finished?',
             'required_elements', 0,
             'permitted_tools', '[]'::jsonb
           ),
           'dataset-v1', '[]'::jsonb, 120, 20,
           '{"pass": "correct", "partial": "n/a", "fail": "wrong"}'::jsonb)`,
        [taskId, evalId, owner],
      );
    });

    // The expected answer is written once, by the owner, and never read back.
    await asUser(client, owner, () =>
      client.query("select public.capability_eval_seed_authored_key($1, 59, null, 0)", [taskId]),
    );
    expect(
      await failure(() =>
        asUser(client, owner, () =>
          client.query("select public.capability_eval_seed_authored_key($1, 60, null, 0)", [taskId]),
        ),
      ),
    ).toMatch(/already has an answer key/i);

    const correct = await asUser(client, owner, () =>
      client.query<{ result: { outcome: string; verified_success: boolean } }>(
        `select public.capability_eval_score_answer($1, '{"answer": 59}'::jsonb) as result`,
        [taskId],
      ),
    );
    expect(correct.rows[0].result.outcome).toBe("verified_success");
    expect(correct.rows[0].result.verified_success).toBe(true);

    const wrong = await asUser(client, owner, () =>
      client.query<{ result: { outcome: string; failure_category: string | null } }>(
        `select public.capability_eval_score_answer($1, '{"answer": 58}'::jsonb) as result`,
        [taskId],
      ),
    );
    expect(wrong.rows[0].result.outcome).toBe("failed");
    expect(wrong.rows[0].result.failure_category).toBe("wrong_answer");

    const unreadable = await asUser(client, owner, () =>
      client.query<{ result: { failure_category: string | null } }>(
        `select public.capability_eval_score_answer($1, '{"answer": "59"}'::jsonb) as result`,
        [taskId],
      ),
    );
    expect(unreadable.rows[0].result.failure_category).toBe("unreadable_answer");

    // Neither a right nor a wrong answer may echo the expected value back.
    expect(JSON.stringify(correct.rows[0].result)).not.toContain("59");
    expect(JSON.stringify(wrong.rows[0].result)).not.toContain("59");

    // The element scorer must refuse this task: an empty element list would
    // otherwise satisfy an empty key and report a pass.
    expect(
      await failure(() =>
        asUser(client, owner, () =>
          client.query(
            `select public.capability_eval_score_task($1, '{"elements": []}'::jsonb)`,
            [taskId],
          ),
        ),
      ),
    ).toMatch(/exact answer/i);

    // A short text answer is graded the same way: exactly, after trimming and
    // case folding, and still without returning the expected value.
    const textTaskId = randomUUID();
    await asUser(client, owner, async () => {
      await client.query(
        `insert into public.capability_eval_tasks
           (id, eval_id, user_id, domain, difficulty, split, title, task_spec, dataset_version,
            permitted_tools, runtime_seconds, spend_limit_cents, scoring_rubric)
         values ($1, $2, $3, 'tool_selection_execution', 'easy', 'development', 'Pick a tool',
           jsonb_build_object('mode', 'authored_answer', 'answer_kind', 'text',
             'prompt', 'Only search, read_files and run_tests are permitted. Find which file references a symbol.',
             'required_elements', 0, 'permitted_tools', '[]'::jsonb),
           'dataset-v1', '[]'::jsonb, 120, 20,
           '{"pass": "correct", "partial": "n/a", "fail": "wrong"}'::jsonb)`,
        [textTaskId, evalId, owner],
      );
      await client.query(
        "select public.capability_eval_seed_authored_key($1, null, 'search', 0)",
        [textTaskId],
      );
    });

    const textRight = await asUser(client, owner, () =>
      client.query<{ result: { outcome: string } }>(
        `select public.capability_eval_score_answer($1, '{"answer": "  SEARCH "}'::jsonb) as result`,
        [textTaskId],
      ),
    );
    expect(textRight.rows[0].result.outcome).toBe("verified_success");

    const textWrong = await asUser(client, owner, () =>
      client.query<{ result: { outcome: string; failure_category: string | null } }>(
        `select public.capability_eval_score_answer($1, '{"answer": "read_files"}'::jsonb) as result`,
        [textTaskId],
      ),
    );
    expect(textWrong.rows[0].result.outcome).toBe("failed");
    expect(textWrong.rows[0].result.failure_category).toBe("wrong_answer");

    // A number where a label is expected is unreadable: the reply shape was
    // part of what the task asked for.
    const numberForText = await asUser(client, owner, () =>
      client.query<{ result: { failure_category: string | null } }>(
        `select public.capability_eval_score_answer($1, '{"answer": 1}'::jsonb) as result`,
        [textTaskId],
      ),
    );
    expect(numberForText.rows[0].result.failure_category).toBe("unreadable_answer");
    expect(JSON.stringify(textRight.rows[0].result)).not.toContain("search");

    // A key must hold exactly one expected answer.
    expect(
      await failure(() =>
        asUser(client, owner, () =>
          client.query("select public.capability_eval_seed_authored_key($1, 5, 'search', 0)", [
            textTaskId,
          ]),
        ),
      ),
    ).toMatch(/already has an answer key|exactly one expected answer/i);

    // A live run keeps the answer it submitted, and only its owner can read it.
    const versionId = randomUUID();
    const runId = randomUUID();
    await asUser(client, owner, async () => {
      await client.query(
        `insert into public.capability_eval_versions
           (id, eval_id, user_id, label, version, baseline_kind, model_version, orchestration_version,
            prompt_version, dataset_version, scoring_rubric, permitted_tools, runtime_limit_seconds,
            spend_limit_cents, human_assistance, autonomy_permission, status)
         values ($1, $2, $3, 'Live smoke', 2, 'single_model_baseline', 'deepseek-v4-pro', 'none',
           'live-prompt-v1', 'dataset-v1', '{}'::jsonb, '[]'::jsonb, 120, 20, 'none', 'none', 'active')`,
        [versionId, evalId, owner],
      );
      await client.query(
        `insert into public.capability_eval_runs
           (id, eval_id, version_id, task_id, user_id, domain, difficulty, split, trial, outcome,
            verified_success, unsupported_claims, permission_violations, human_interventions,
            recovery_attempts, cost_cents, latency_ms, failure_category, scoring_detail, submission)
         values ($1, $2, $3, $4, $5, 'quantitative_reasoning', 'medium', 'development', 1,
           'verified_success', true, 0, 0, 0, 0, 20, 879, null,
           '{"graded_by": "exact_number"}'::jsonb, '{"answer": 9, "kind": "number"}'::jsonb)`,
        [runId, evalId, versionId, taskId, owner],
      );
    });

    const stored = await asUser(client, owner, () =>
      client.query<{ submission: { answer: number } | null; cost_cents: number }>(
        "select submission, cost_cents from public.capability_eval_runs where id = $1",
        [runId],
      ),
    );
    expect(stored.rows).toHaveLength(1);
    expect(stored.rows[0].submission?.answer).toBe(9);
    expect(stored.rows[0].cost_cents).toBe(20);

    // The row is the owner's alone.
    const otherView = await asB(() =>
      client.query<{ count: string }>(
        "select count(*)::text as count from public.capability_eval_runs where id = $1",
        [runId],
      ),
    );
    expect(otherView.rows[0].count).toBe("0");

    // A submission that is not an object is refused outright.
    await expect(
      client.query(
        `insert into public.capability_eval_runs
           (eval_id, version_id, task_id, user_id, domain, difficulty, split, trial, outcome,
            verified_success, cost_cents, latency_ms, scoring_detail, submission)
         values ($1, $2, $3, $4, 'quantitative_reasoning', 'medium', 'development', 2,
           'failed', false, 0, 100, '{}'::jsonb, '"nine"'::jsonb)`,
        [evalId, versionId, taskId, owner],
      ),
    ).rejects.toThrow(/capability_eval_runs_submission_check/);

    // Somebody else cannot grade it.
    expect(
      await failure(() =>
        asB(() =>
          client.query(`select public.capability_eval_score_answer($1, '{"answer": 59}'::jsonb)`, [
            taskId,
          ]),
        ),
      ),
    ).toMatch(/unknown evaluation task/i);
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

/**
 * Phase 39: research missions.
 *
 * These checks use their own database connection because they create their own
 * workspace, but they run in the same replayed database as the Phase 37 block.
 */
describeKnowledge("phase 39 research missions", () => {
  let client: Client;
  const owner = randomUUID();
  const outsider = randomUUID();
  const workspaceId = randomUUID();
  const experimentId = randomUUID();
  const orchestrationId = randomUUID();
  let missionId = "";

  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    // The Phase 37 block above already bootstrapped and replayed the migrations
    // into this database; replaying them again would collide with existing
    // policies.
    await assertIsolatedDatabase(client);

    for (const userId of [owner, outsider]) {
      await client.query("insert into auth.users (id, email) values ($1,$2)", [
        userId,
        `phase39-${userId.slice(0, 8)}@example.test`,
      ]);
    }
    await client.query("insert into public.workspaces (id, name, created_by) values ($1,$2,$3)", [
      workspaceId,
      "Phase 39 research probe",
      owner,
    ]);
    await client.query(
      "insert into public.workspace_members (workspace_id, user_id, role, status) values ($1,$2,'owner','active')",
      [workspaceId, owner],
    );
    await client.query(
      `insert into public.experiments
         (id, workspace_id, created_by, question, hypothesis, target_users,
          proposed_prototype, success_criteria, failure_criteria, time_limit_minutes,
          privacy_requirements, consent_requirements, stop_conditions, review_at)
       values ($1,$2,$3,
               'Does a narrow viewport change review completion?',
               'Narrow viewports cause abandonment.',
               'Synthetic records only',
               'A one-screen synthetic review',
               'Completion differs by more than ten points',
               'Completion is flat across widths',
               120,
               'Synthetic records only, no personal data',
               'Not applicable, synthetic data',
               'Stop after one synthetic run',
               current_date + 14)`,
      [experimentId, workspaceId, owner],
    );
    await client.query(
      `insert into public.orchestrations
         (id, workspace_id, created_by, origin_kind, experiment_id, goal, review_at, status)
       values ($1,$2,$3,'experiment',$4,'Probe the narrow viewport claim end to end.',current_date + 14,'running')`,
      [orchestrationId, workspaceId, owner, experimentId],
    );

    const created = await asUser(client, owner, () =>
      client.query<{ id: string }>(
        `insert into public.research_missions
           (workspace_id, created_by, orchestration_id, question, scope, existing_evidence,
            required_source_tier, allowed_tools, deliverables, task_budget, agent_budget,
            retry_budget, spend_ceiling_cents, time_ceiling_minutes, stop_conditions,
            checkpoints, status)
         values ($1,$2,$3,
                 'Does a 320 px viewport change whether people finish the weekly review?',
                 'Synthetic data only, one review flow, no participants.',
                 'Internal notes claim narrow screens cause abandonment.',
                 'reputable_secondary',
                 array['read_workspace_records','read_web_page','draft_document'],
                 array['Sourced research brief','Proposed bounded experiment'],
                 4, 3, 1, 200, 120,
                 array['Stop when the spend ceiling is reached.'],
                 array['A person reviews the sources before synthesis.'],
                 'ready')
         returning id`,
        [workspaceId, owner, orchestrationId],
      ),
    );
    missionId = created.rows[0].id;
  }, 180_000);

  afterAll(async () => {
    if (client) await client.end();
  });

  async function addSource(values: {
    stance: string;
    statementKind: string;
    tier: string;
    verified: boolean;
    excerpt?: string;
  }): Promise<void> {
    await asUser(client, owner, () =>
      client.query(
        `insert into public.research_sources
           (mission_id, workspace_id, created_by, stance, statement_kind, source_tier,
            source_kind, title, locator, excerpt, verified)
         values ($1,$2,$3,$4,$5,$6,'dataset','Synthetic source','Synthetic export row 1',$7,$8)`,
        [
          missionId,
          workspaceId,
          owner,
          values.stance,
          values.statementKind,
          values.tier,
          values.excerpt ?? "Completion at 320 px was 41 percent lower for the same task.",
          values.verified,
        ],
      ),
    );
  }

  async function addFinding(values: {
    label: string;
    author: string;
    verifier: string | null;
    status: string;
    claim?: string;
    mission?: string;
  }): Promise<string> {
    const result = await asUser(client, owner, () =>
      client.query<{ id: string }>(
        `insert into public.research_findings
           (mission_id, workspace_id, created_by, claim, label, author_role,
            verifier_role, status, verified_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         returning id`,
        [
          values.mission ?? missionId,
          workspaceId,
          owner,
          values.claim ?? "In the synthetic export, completion tracked the field count.",
          values.label,
          values.author,
          values.verifier,
          values.status,
          values.verifier === null ? null : new Date().toISOString(),
        ],
      ),
    );
    return result.rows[0].id;
  }

  it("records the contract, its hypotheses and sourced evidence", async () => {
    await asUser(client, owner, () =>
      client.query(
        `insert into public.research_hypotheses (mission_id, workspace_id, created_by, statement, role)
         values ($1,$2,$3,'Narrow viewports cause abandonment.','leading'),
                ($1,$2,$3,'Required field count causes abandonment.','competing')`,
        [missionId, workspaceId, owner],
      ),
    );
    await addSource({ stance: "supports", statementKind: "quotation", tier: "primary", verified: true });
    await addSource({ stance: "contradicts", statementKind: "observation", tier: "reputable_secondary", verified: true });
    await addSource({ stance: "supports", statementKind: "inference", tier: "unverified", verified: false });

    const counts = await client.query<{ sources: string; contradictions: string }>(
      `select count(*)::text as sources,
              count(*) filter (where stance = 'contradicts')::text as contradictions
         from public.research_sources where mission_id = $1`,
      [missionId],
    );
    expect(counts.rows[0].sources).toBe("3");
    expect(counts.rows[0].contradictions).toBe("1");

    // The outsider sees none of it.
    const visible = await asUser(client, outsider, () =>
      client.query<{ count: string }>(
        "select count(*)::text as count from public.research_sources where mission_id = $1",
        [missionId],
      ),
    );
    expect(visible.rows[0].count).toBe("0");
  });

  it("refuses a discovery that no verified source supports", async () => {
    // A second mission with no sources at all: nothing can support a discovery.
    const empty = await asUser(client, owner, () =>
      client.query<{ id: string }>(
        `insert into public.research_missions
           (workspace_id, created_by, question, scope, required_source_tier, allowed_tools,
            deliverables, task_budget, stop_conditions, checkpoints, status)
         values ($1,$2,'Does anything support a claim with no sources?',
                 'A mission with no evidence at all.','primary',
                 array['read_web_page'], array['Sourced research brief'], 2,
                 array['Stop.'], array['A person reviews.'], 'ready')
         returning id`,
        [workspaceId, owner],
      ),
    );
    const emptyMissionId = empty.rows[0].id;

    let message = "";
    try {
      await addFinding({
        label: "discovery",
        author: "evidence_verifier",
        verifier: "synthesis_writer",
        status: "supported",
        claim: "Discovery: nothing at all supports this claim.",
        mission: emptyMissionId,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("cannot be a discovery");
  });

  it("refuses a conclusion verified by its own author function", async () => {
    let message = "";
    try {
      await addFinding({
        label: "observation",
        author: "investigator",
        verifier: "investigator",
        status: "supported",
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("same specialist function");
  });

  it("refuses a discovery while a verified source contradicts it", async () => {
    let message = "";
    try {
      await addFinding({
        label: "discovery",
        author: "investigator",
        verifier: "evidence_verifier",
        status: "supported",
        claim: "Discovery: the viewport alone explains the drop.",
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("contradicts");
  });

  it("keeps a proposal out of the evidence, and records an honest observation", async () => {
    await addSource({ stance: "supports", statementKind: "observation", tier: "primary", verified: true });
    const observationId = await addFinding({
      label: "observation",
      author: "investigator",
      verifier: "evidence_verifier",
      status: "supported",
      claim: "Completion fell as required fields rose at every width in the export.",
    });
    expect(observationId).not.toBe("");

    await addFinding({
      label: "proposal",
      author: "prototype_builder",
      verifier: null,
      status: "pending",
      claim: "Cap the review at three required fields and measure again.",
    });

    let message = "";
    try {
      await addFinding({
        label: "proposal",
        author: "prototype_builder",
        verifier: null,
        status: "supported",
        claim: "Cap the review at three required fields and measure again.",
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("proposal is not evidence");
  });

  it("refuses outreach tools and unbounded budgets", async () => {
    let toolMessage = "";
    try {
      await asUser(client, owner, () =>
        client.query(
          `insert into public.research_missions
             (workspace_id, created_by, question, scope, allowed_tools, deliverables,
              task_budget, stop_conditions, checkpoints)
           values ($1,$2,'Is outreach allowed here?','It is not.',
                   array['send_email'], array['Brief'], 4,
                   array['Stop.'], array['A person reviews.'])`,
          [workspaceId, owner],
        ),
      );
    } catch (error) {
      toolMessage = (error as Error).message;
    }
    expect(toolMessage).toContain("outreach");

    let budgetMessage = "";
    try {
      await asUser(client, owner, () =>
        client.query(
          `insert into public.research_missions
             (workspace_id, created_by, question, scope, allowed_tools, deliverables,
              task_budget, stop_conditions, checkpoints)
           values ($1,$2,'Can a mission run unlimited tasks?','It cannot.',
                   array['read_web_page'], array['Brief'], 400,
                   array['Stop.'], array['A person reviews.'])`,
          [workspaceId, owner],
        ),
      );
    } catch (error) {
      budgetMessage = (error as Error).message;
    }
    expect(budgetMessage).toContain("task_budget");
  });

  it("cancels the mission and the orchestration behind it", async () => {
    const result = await asUser(client, owner, () =>
      client.query<{ result: { ok: boolean } }>(
        "select public.research_cancel($1,'Synthetic mission cancelled by the harness.') as result",
        [missionId],
      ),
    );
    expect(result.rows[0].result.ok).toBe(true);

    const mission = await client.query<{ status: string }>(
      "select status from public.research_missions where id = $1",
      [missionId],
    );
    expect(mission.rows[0].status).toBe("cancelled");

    const orchestration = await client.query<{ status: string }>(
      "select status from public.orchestrations where id = $1",
      [orchestrationId],
    );
    expect(orchestration.rows[0].status).not.toBe("ready");

    // A cancelled mission cannot be restarted by editing it back.
    let message = "";
    try {
      await asUser(client, owner, () =>
        client.query("update public.research_missions set status = 'running' where id = $1", [
          missionId,
        ]),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("cannot be restarted");
  });

  it("adds a research plan only while the orchestration can still be planned", async () => {
    const draftOrchestration = randomUUID();
    await client.query(
      `insert into public.orchestrations
         (id, workspace_id, created_by, origin_kind, experiment_id, goal, review_at, status)
       values ($1,$2,$3,'experiment',$4,'Plan the research tasks for a draft run.',current_date + 14,'draft')`,
      [draftOrchestration, workspaceId, owner, experimentId],
    );

    const planned = await asUser(client, owner, () =>
      client.query<{ id: string }>(
        `insert into public.research_missions
           (workspace_id, created_by, orchestration_id, question, scope, required_source_tier,
            allowed_tools, deliverables, task_budget, agent_budget, retry_budget,
            spend_ceiling_cents, time_ceiling_minutes, stop_conditions, checkpoints, status)
         values ($1,$2,$3,'Does the plan respect the contract budgets?',
                 'A draft orchestration with room to plan.','reputable_secondary',
                 array['read_workspace_records'], array['Sourced research brief'],
                 4, 3, 1, 200, 120, array['Stop.'], array['A person reviews.'], 'ready')
         returning id`,
        [workspaceId, owner, draftOrchestration],
      ),
    );
    const plannedMission = planned.rows[0].id;
    expect(plannedMission).not.toBe("");

    // Four tasks, exactly the contract's task budget, each with a real purpose.
    await asUser(client, owner, () =>
      client.query(
        `insert into public.orchestration_tasks
           (orchestration_id, workspace_id, task_key, position, title, purpose, capability,
            depends_on, covers, input_refs, expected_output, verification_method,
            credits_micros, permissions, retry_limit)
         values
           ($1,$2,'research-investigate',0,
            'Collect sources for and against each hypothesis',
            'Record supporting and contradicting material with provenance.',
            'research','{}',array['sources'],'research_missions:' || $3,
            'A recorded result with evidence.','document_review',5000000,
            array['read_workspace_records'],1),
           ($1,$2,'research-verify',1,
            'Re-check each cited source against the original',
            'Confirm each quotation says what it is claimed to say.',
            'verification',array['research-investigate'],array['verification'],
            'research_missions:' || $3,'A recorded result with evidence.','document_review',5000000,
            array['read_workspace_records'],1),
           ($1,$2,'research-competing',2,
            'Argue the competing explanation',
            'Look for evidence that separates the two explanations.',
            'research',array['research-investigate'],array['alternatives'],
            'research_missions:' || $3,'A recorded result with evidence.','human_review',5000000,
            array['read_workspace_records'],1),
           ($1,$2,'research-method',3,
            'Check whether the method could produce the result',
            'Name the confounds before anything is called a finding.',
            'research',array['research-investigate'],array['limitations'],
            'research_missions:' || $3,'A recorded result with evidence.','human_review',5000000,
            array['read_workspace_records'],1)`,
        [draftOrchestration, workspaceId, plannedMission],
      ),
    );

    const taskCount = await client.query<{ count: string }>(
      "select count(*)::text as count from public.orchestration_tasks where orchestration_id = $1",
      [draftOrchestration],
    );
    expect(taskCount.rows[0].count).toBe("4");

    const spend = await client.query<{ total: string }>(
      "select coalesce(sum(credits_micros),0)::text as total from public.orchestration_tasks where orchestration_id = $1",
      [draftOrchestration],
    );
    expect(Number(spend.rows[0].total)).toBeLessThanOrEqual(200 * 100_000);

    // Verification reads the mission's records instead of trusting the task.
    async function verifyTask(taskKey: string): Promise<string> {
      try {
        await client.query(
          "update public.orchestration_tasks set status = 'verified' where orchestration_id = $1 and task_key = $2",
          [draftOrchestration, taskKey],
        );
        return "";
      } catch (error) {
        return (error as Error).message;
      }
    }

    expect(await verifyTask("research-investigate")).toContain("no source has been recorded");
    expect(await verifyTask("research-verify")).toContain("no source has been re-checked");
    expect(await verifyTask("research-method")).toContain("no finding");

    await asUser(client, owner, () =>
      client.query(
        `insert into public.research_sources
           (mission_id, workspace_id, created_by, stance, statement_kind, source_tier,
            source_kind, title, locator, excerpt, verified)
         values ($1,$2,$3,'supports','observation','primary','dataset',
                 'Synthetic source','Synthetic export row 2','Completion held flat.',false)`,
        [plannedMission, workspaceId, owner],
      ),
    );

    // A source exists but nobody has re-checked it, so verification still waits.
    expect(await verifyTask("research-investigate")).toBe("");
    expect(await verifyTask("research-verify")).toContain("no source has been re-checked");

    await asUser(client, owner, () =>
      client.query("update public.research_sources set verified = true where mission_id = $1", [
        plannedMission,
      ]),
    );
    expect(await verifyTask("research-verify")).toBe("");

    // The cancelled orchestration can no longer be planned: the queue refuses it.
    let message = "";
    try {
      await asUser(client, owner, () =>
        client.query(
          `insert into public.orchestration_tasks
             (orchestration_id, workspace_id, task_key, position, title, purpose, capability,
              expected_output, verification_method, credits_micros, permissions, retry_limit)
           values ($1,$2,'research-late',9,'Late task',
                   'A task added after the run was cancelled.',
                   'research','A recorded result.','document_review',1000,array[]::text[],1)`,
          [orchestrationId, workspaceId],
        ),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("row-level security");
  });

  it("links a proposed experiment as an ordinary Phase 35 record", async () => {
    await asUser(client, owner, () =>
      client.query("update public.research_missions set proposed_experiment_id = $2 where id = $1", [
        missionId,
        experimentId,
      ]),
    );
    const linked = await client.query<{ question: string }>(
      `select e.question from public.research_missions m
         join public.experiments e on e.id = m.proposed_experiment_id
        where m.id = $1`,
      [missionId],
    );
    expect(linked.rows[0].question).toContain("narrow viewport");
  });
});

/**
 * Phase 9: the GitHub issue handoff. The connection and transport are the
 * existing Composio path, so these checks cover the parts this phase owns: the
 * approval record, its immutability, duplicates and the audit trail.
 */
describeKnowledge("phase 9 github issue handoff", () => {
  let client: Client;
  const owner = randomUUID();
  const outsider = randomUUID();
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const connectionId = randomUUID();
  let requestId = "";

  beforeAll(async () => {
    client = new Client({ connectionString });
    await client.connect();
    await assertIsolatedDatabase(client);

    for (const userId of [owner, outsider]) {
      await client.query("insert into auth.users (id, email) values ($1,$2)", [
        userId,
        `phase9-${userId.slice(0, 8)}@example.test`,
      ]);
    }
    await client.query("insert into public.workspaces (id, name, created_by) values ($1,$2,$3)", [
      workspaceId,
      "Phase 9 connector probe",
      owner,
    ]);
    await client.query(
      "insert into public.workspace_members (workspace_id, user_id, role, status) values ($1,$2,'owner','active')",
      [workspaceId, owner],
    );
    await client.query(
      `insert into public.app_projects
         (id, user_id, name, purpose, target_users, workflows, required_pages, entities,
          auth_requirements, integrations, definition_of_done)
       values ($1,$2,'Connector probe','Probe the issue handoff.','Operators',
               'Create an issue','/ | Home','','none','',
               'An issue request is recorded')`,
      [projectId, owner],
    );
    await client.query(
      `insert into public.app_composio_connections
         (id, user_id, project_id, toolkit, connected_account_id, account_label, status)
       values ($1,$2,$3,'github','ca_probe_account_1','Probe account','active')`,
      [connectionId, owner, projectId],
    );

    const created = await asUser(client, owner, () =>
      client.query<{ id: string }>(
        `insert into public.github_issue_requests
           (workspace_id, user_id, connection_id, project_id, record_kind, record_id,
            repository, title, body, fingerprint, status)
         values ($1,$2,$3,$4,'mission',$5,'acme/roadmap',
                 '[Mission] Turn the finding into work',
                 'From GET TO IT: a person approved this before it was sent.',
                 $6,'draft')
         returning id`,
        [workspaceId, owner, connectionId, projectId, randomUUID(), "a".repeat(64)],
      ),
    );
    requestId = created.rows[0].id;
  }, 180_000);

  afterAll(async () => {
    if (client) await client.end();
  });

  it("records the draft and keeps it invisible to an outsider", async () => {
    const visible = await asUser(client, owner, () =>
      client.query<{ count: string }>(
        "select count(*)::text as count from public.github_issue_requests where id = $1",
        [requestId],
      ),
    );
    expect(visible.rows[0].count).toBe("1");

    const hidden = await asUser(client, outsider, () =>
      client.query<{ count: string }>(
        "select count(*)::text as count from public.github_issue_requests where id = $1",
        [requestId],
      ),
    );
    expect(hidden.rows[0].count).toBe("0");
  });

  it("refuses to send before approval", async () => {
    const result = await asUser(client, owner, () =>
      client.query<{ result: { ok: boolean; code: string } }>(
        "select public.github_issue_claim($1) as result",
        [requestId],
      ),
    );
    expect(result.rows[0].result).toMatchObject({ ok: false, code: "approval-required" });
  });

  it("binds the approval to the fingerprint and freezes the content", async () => {
    const approved = await asUser(client, owner, () =>
      client.query<{ result: { ok: boolean } }>(
        "select public.github_issue_approve($1) as result",
        [requestId],
      ),
    );
    expect(approved.rows[0].result.ok).toBe(true);

    const row = await client.query<{ status: string; approval_fingerprint: string }>(
      "select status, approval_fingerprint from public.github_issue_requests where id = $1",
      [requestId],
    );
    expect(row.rows[0].status).toBe("approved");
    expect(row.rows[0].approval_fingerprint).toBe("a".repeat(64));

    // A client has no update policy, so a direct edit silently touches nothing.
    const direct = await asUser(client, owner, () =>
      client.query(
        "update public.github_issue_requests set title = 'A quietly changed title' where id = $1",
        [requestId],
      ),
    );
    expect(direct.rowCount).toBe(0);

    // The definer RPCs can write, so the trigger must refuse them instead.
    let message = "";
    try {
      await client.query(
        "update public.github_issue_requests set title = 'A quietly changed title' where id = $1",
        [requestId],
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("cannot be rewritten");
  });

  it("sends once and never twice", async () => {
    const claimed = await asUser(client, owner, () =>
      client.query<{ result: { ok: boolean; attempt: number } }>(
        "select public.github_issue_claim($1) as result",
        [requestId],
      ),
    );
    expect(claimed.rows[0].result.ok).toBe(true);

    // A second claim while sending is refused, so a double click cannot send twice.
    const again = await asUser(client, owner, () =>
      client.query<{ result: { ok: boolean; code: string } }>(
        "select public.github_issue_claim($1) as result",
        [requestId],
      ),
    );
    expect(again.rows[0].result).toMatchObject({ ok: false, code: "already-sending" });

    // A completion without an issue link is refused rather than recorded as sent.
    const withoutIssue = await asUser(client, owner, () =>
      client.query<{ result: { ok: boolean; code: string } }>(
        "select public.github_issue_complete($1, true, null, null) as result",
        [requestId],
      ),
    );
    expect(withoutIssue.rows[0].result).toMatchObject({ ok: false, code: "missing-issue" });

    const sent = await asUser(client, owner, () =>
      client.query<{ result: { ok: boolean } }>(
        "select public.github_issue_complete($1, true, $2, 12, 'log_probe') as result",
        [requestId, "https://github.com/acme/roadmap/issues/12"],
      ),
    );
    expect(sent.rows[0].result.ok).toBe(true);

    const row = await client.query<{ status: string; issue_number: number; issue_url: string }>(
      "select status, issue_number, issue_url from public.github_issue_requests where id = $1",
      [requestId],
    );
    expect(row.rows[0].status).toBe("sent");
    expect(row.rows[0].issue_number).toBe(12);

    let message = "";
    try {
      await client.query(
        "update public.github_issue_requests set status = 'failed' where id = $1",
        [requestId],
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("a sent issue request is final");
  });

  it("refuses a duplicate fingerprint for the same record", async () => {
    const recordId = randomUUID();
    await asUser(client, owner, () =>
      client.query(
        `insert into public.github_issue_requests
           (workspace_id, user_id, connection_id, project_id, record_kind, record_id,
            repository, title, body, fingerprint, status)
         values ($1,$2,$3,$4,'mission',$5,'acme/roadmap','Same content once',
                 'The same body, recorded again.', $6, 'draft')`,
        [workspaceId, owner, connectionId, projectId, recordId, "b".repeat(64)],
      ),
    );

    let message = "";
    try {
      await asUser(client, owner, () =>
        client.query(
          `insert into public.github_issue_requests
             (workspace_id, user_id, connection_id, project_id, record_kind, record_id,
              repository, title, body, fingerprint, status)
           values ($1,$2,$3,$4,'mission',$5,'acme/roadmap','Same content once',
                   'The same body, recorded again.', $6, 'draft')`,
          [workspaceId, owner, connectionId, projectId, recordId, "b".repeat(64)],
        ),
      );
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain("duplicate key value");
  });

  it("refuses a send when the connection is no longer active", async () => {
    const inactiveRequest = await asUser(client, owner, () =>
      client.query<{ id: string }>(
        `insert into public.github_issue_requests
           (workspace_id, user_id, connection_id, project_id, record_kind, record_id,
            repository, title, body, fingerprint, status)
         values ($1,$2,$3,$4,'mission',$5,'acme/roadmap','A request on a dead connection',
                 'This should never be sent.', $6, 'draft')
         returning id`,
        [workspaceId, owner, connectionId, projectId, randomUUID(), "c".repeat(64)],
      ),
    );
    const inactiveId = inactiveRequest.rows[0].id;

    await asUser(client, owner, () =>
      client.query("select public.github_issue_approve($1)", [inactiveId]),
    );
    await client.query(
      "update public.app_composio_connections set status = 'revoked' where id = $1",
      [connectionId],
    );

    const claim = await asUser(client, owner, () =>
      client.query<{ result: { ok: boolean; code: string } }>(
        "select public.github_issue_claim($1) as result",
        [inactiveId],
      ),
    );
    expect(claim.rows[0].result).toMatchObject({ ok: false, code: "connection-inactive" });
  });

  it("appends the audit trail instead of editing it", async () => {
    const events = await client.query<{ kind: string }>(
      "select kind from public.github_issue_events where request_id = $1 order by created_at",
      [requestId],
    );
    const kinds = events.rows.map((row) => row.kind);
    expect(kinds).toEqual(["drafted", "approved", "send_started", "sent"]);
  });
});
