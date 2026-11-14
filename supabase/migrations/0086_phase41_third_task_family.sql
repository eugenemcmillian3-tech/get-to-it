-- GET TO IT — Phase 41: a third installed task family.
--
-- Programs can now register every installed family at once, so the set of
-- installed families is itself a thing that changes over time. This migration
-- adds the third family and nothing else: a program registered while two
-- families were installed keeps those two, refuses a trial keyed to this one,
-- and a program registered after this migration includes all three.
--
-- The family is request clarity: before a tool can be chosen, the request has to
-- name enough to act on. Its baseline acts on anything and invents the missing
-- referent; its candidate refuses a request that never says what to send, where,
-- or which repository.
--
-- The digest is what `suiteDigest()` computes over these twelve authored cases in
-- src/lib/performance-families.ts. A unit test keeps the two in step. The same
-- guards apply unchanged, because they read the family records rather than a
-- hardcoded list.

insert into public.performance_task_families (key, version, suite_digest, task_keys, description)
values (
  'request_clarity',
  '2026-11-14.1',
  'c23e6adf527ef82230f9fa9f33bd9aa21b0a6db8abdd31c79c57971878ce3b3d',
  array[
    'clear-channel-and-summary', 'clear-channel-list', 'clear-issue-title',
    'clear-repo-question', 'clear-standup-post', 'clear-issue-for-test',
    'ambiguous-it', 'ambiguous-update', 'ambiguous-issue', 'ambiguous-repo',
    'ambiguous-them', 'ambiguous-usual-place'
  ],
  'Deciding whether a request names enough to act on: send, list or open the named thing, or stop because the payload, destination or repository is missing. Twelve authored cases, scored pass or fail with no model call.'
)
on conflict (key) do update set
  version = excluded.version,
  suite_digest = excluded.suite_digest,
  task_keys = excluded.task_keys,
  description = excluded.description;
