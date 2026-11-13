-- GET TO IT — Phase 41: a second installed task family.
--
-- A program that only ever sees one distribution cannot compare a result to a
-- genuinely different one, and a second family is a better answer than letting
-- someone type their own cases after seeing the first numbers.
--
-- This family is error recovery: a connector call has already failed, and the
-- next action — retry a transient error, resolve a missing parameter, or stop and
-- ask a person — is what gets scored. Its baseline deliberately retries every
-- failure regardless of cause; its candidate classifies the failure first.
--
-- The digest is what `suiteDigest()` computes over these twelve authored cases in
-- src/lib/performance-families.ts. A unit test keeps the two in step. The same
-- guards apply unchanged: a program may only register this digest and these task
-- keys, and a trial may only name a key in its own registered distribution.
--
-- Nothing else in the schema needs to change, because every guard reads the
-- family record rather than a hardcoded list.

insert into public.performance_task_families (key, version, suite_digest, task_keys, description)
values (
  'error_recovery',
  '2026-11-13.1',
  'e19cdcb8a09e6bfbbd84eea6d0ed0fa625f88239c57ff7fe1ecdb94cb6660619',
  array[
    'timeout-send', 'rate-limit-list', 'expired-token', 'missing-scope',
    'missing-parameter', 'duplicate-message', 'server-500', 'repo-not-found',
    'issue-exists', 'network-reset', 'channel-404', 'conflict-issue'
  ],
  'Deciding what to do after a connector call fails: retry a transient error, resolve a missing parameter, or stop and ask a person. Twelve authored cases, scored pass or fail with no model call.'
)
on conflict (key) do update set
  version = excluded.version,
  suite_digest = excluded.suite_digest,
  task_keys = excluded.task_keys,
  description = excluded.description;
