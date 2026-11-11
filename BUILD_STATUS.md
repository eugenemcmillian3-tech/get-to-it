# Build status

| Phase | Scope | Status |
| --- | --- | --- |
| Phase 1 | Accounts, goals, tasks, saved results, progress (foundation) | Complete |
| Phase 2 | AI planning: structured plan preview, approval, request limits | Complete (live model call awaiting approval) |
| Phase 3 | Task workspace AI help: start, explain, draft, review, stuck options | Complete (live task-help call awaiting approval) |
| Phase 4 | Optional focus timer, progress figures, resume card, weekly check-in | Complete |
| Phase 5 | Release candidate: secrets review, account deletion, feedback, docs, commit | Complete (deployment awaiting approval) |
| Phase 6 | Optional in-app reminders, quiet hours, daily check-in, scheduler endpoint | Complete |
| Phase 7 | Template library, private templates, goal search, filters, archive | Complete |
| Phase 8 | One accountability partner, opt-in sharing, encouragement, block/report | Complete |
| Phase 9 | Action framework and one external connector | Not started — no connector was selected |
| Phase 10 | Prepaid AI credits, Stripe test-mode checkout, ledger, owner dashboard | Complete (test mode; $0.10 credit; no free plan; live payments not enabled) |
| Phase 11 | Optional work preferences, preference-aware suggestions, approved daily plan | Complete |
| Phase 12 | Optional learning mode: editable path, practice records, step help | Complete |
| Phase 13 | Small shared workspaces: roles, shared goals, assignments, comments | Complete |
| Phase 14 | Small workflows: input, AI draft, review, exact-content action approval, checkpoint | Complete (the only connector is explicitly simulated) |
| Phase 15 | Data export/import, account-control review, operations guide, health checks, isolated restore drill | Complete (restore tested on an isolated database) |
| Phase 16 | Future Paths: three plausible scenarios, evidence labels, comparison, rationale, review date, action-to-task conversion | Complete (live generation verified once) |
| Phase 17 | Think it through: five sequential review perspectives, shared record, disagreements, experiments, human decision, cancellation and call cap | Complete (live generation awaits approval) |
| Phase 18 | What's changing? radar: opt-in topics, recorded signals with source and both dates, six kinds, duplicate refusal, mute/dismiss, preparation tasks and learning goals | Complete |
| Phase 19 | Missions: workspace-owned problem records, shared tasks, evidence and assumptions with consent, labelled AI assistance, human decisions with dissent, share approval and separated impact tracking | Complete |
| Phase 20 | Outcomes and lessons: immutable expectation snapshots, append-only observations, four separated evaluation answers, optional forecast scoring, consented and versioned improvement proposals with rollback | Complete |
| Phase 21 | Build an App: captured intake, editable and approved specification, deterministic real-file generation for one Next.js/TypeScript/Tailwind stack (optional Supabase), file editor, atomic version snapshots with restore, and ZIP download | Complete |
| Phase 22 | Isolated preview workspace: separate unprivileged-namespace runner with no Docker/root, pinned dependency cache, typecheck/lint/test/build, signed preview origin, bounded AI repair loop with diffs and snapshots, stop/expiry cleanup | Complete |
| Phase 23 | Optional agent-team mode: six scoped roles, durable task queue and states, file ownership and conflicts, controlled branch integration with attribution, check evidence, human pause/reassign/reject/resume/cancel, hard concurrency/call/runtime limits | Complete (fixture and model-backed modes; model mode uses all six configured Ollama models with a hard credit budget) |
| Phase 24 | One GitHub, Vercel and Supabase integration per app: encrypted scoped connections, exact deployment plan, environment requirements, migration preview, explicit `DEPLOY` approval, staged pipeline, status polling, smoke checks and snapshot redeploy | Complete (stub-tested; no real external write) |
| Phase 25 | Project improvement workspace: inspect and clarify, bounded plan, approved isolated patch, tests, preview, diff review, reversible merge, editable memory, versioned skills, opt-in error records and factual evaluation | Complete (fixture-tested; no live model or deployment) |
| Phase 31 | Import my app: authorized GitHub or ZIP source, safe static inspection, editable app map, recorded baseline, and one bounded modernization proposal handed to existing change review | Complete (fixture-tested; no push or deployment) |
| Phase 32 | Evaluation workspace: bounded tasks across five categories, project snapshots with permission, deterministic checks separated from AI opinions, preserved failed runs, repeated trials, approved run budgets, versioned per-configuration capability profiles, and approval-gated routing/role recommendations with rollback | Complete (fixture-only; no paid model call, production configuration change, push or deployment) |
| Phase 33 | Versioned project model from specs, files, integrations and deployments; stale-source warnings; version comparison and Markdown changelog export; static API/role/job/field scenarios with evidence and unknowns; bounded approved experiments; atomic task conversion | Complete (static/source-only; synthetic requests blocked without an isolated runner; no external load test, push or deployment) |
| Phase 34 | Mission control: explicit project links, deliverable progress, dependency-aware planning, responsible owners, bounded agent jobs with mission-level limits, cancellation propagation, recovery and separate approvals | Complete (fixture-tested; no external write, deployment or guaranteed schedule) |
| Phase 35 | Experiment workspace: bounded question and hypothesis, linked future paths/radar/learning/missions/reviews, planning assistant, voluntary consent-gated feedback, measured-versus-opinion separation, separate outreach/publication/payment/deployment approvals, prototype promotion through the app builder, and a human continue/revise/stop review | Complete (fixture-tested; no real outreach, publication, payment, deployment or high-stakes research) |
| Phase 38 | Versioned capability evaluation: eight domains, development/validation/held-out splits, server-side answer keys no client role can read, contamination and repeated-exposure tracking, single-model versus orchestrated comparison with failure categories, cost, latency and variability, permission fixed at version creation, and human baselines only under a documented protocol | Complete (fixture-scored; no paid model call, deployment or permission change) |

Last updated: Phase 1 complete, plus optional AI suggestions: the goal page can
ask an open model (Ollama cloud API) for a starting point. Phase 2 adds
AI-assisted planning — a validated 3–7 task plan, previewed and editable before
it is saved, with database-enforced per-user, global and one-at-a-time request
limits on every AI entry point. Plan generation has not yet been run against the
live provider (that requires approval, since it spends the account's requests);
parsing, validation, staleness and limit rules are covered by fixture tests.
Phase 3 adds task-workspace help — help me start, explain this step, draft with
me, review my work and four "I'm stuck" options — where every answer waits in an
editable suggestion card, is only ever appended to the notes box when the person
chooses it, and never saves or completes anything on its own. Live task-help
generation has not been run against the provider either (same approval reason);
request validation, text normalization, merging and error handling are covered
by fixture tests, and the request limits are enforced in Postgres.
Phase 4 adds an optional, server-owned focus timer (start, pause, resume, finish)
whose elapsed time is derived from stored timestamps and written only by
database functions, four separate progress figures with no score, a "Continue
where you left off" card, and private weekly check-ins. Timer transitions,
concurrency, ownership and no-double-counting are exercised against Postgres;
timer maths, week boundaries and progress counting are unit tested.
Phase 5 prepares the release: environment and secret handling reviewed and
documented, no sample/demo mode anywhere, account deletion with a typed
confirmation, a durable usage ledger so deleting an account cannot restore spent
global allowance, a feedback form, documented AI data sharing and known
limitations, and a private pilot plan. The release candidate is committed and
identified by its revision; deployment has not been performed and awaits
approval.
Phase 6 adds optional in-app reminders for goals and tasks, with per-person time
and timezone, weekday selection, quiet hours that defer rather than drop,
per-slot deduplication in Postgres, snooze and dismiss, an in-app inbox, and an
optional daily check-in. Delivery needs no browser tab: a protected
`/api/reminders/run` endpoint runs the same idempotent pass for everyone, and
opening the inbox runs it for one person. No email, SMS or push channel exists.
Phase 7 adds a template library across six categories, with a preview and a
customise-before-saving form, private templates saved from an existing plan,
and goal organization: search, status and category filters, archive and
restore, and bounded pagination. Static templates live in code, so using one
never calls a model. Creating from a template copies it into an ordinary goal
and tasks, so the source is never modified, and saving a plan as a private
template copies only task names and time estimates — saved work, reflections
and AI answers are excluded by construction.
Phase 8 adds one accountability partner: expiring single-use invitations that
require acceptance, per-item sharing (goal titles, completion counts, a
milestone, a written check-in) that is off by default, one short encouragement
thread with database-enforced limits, and end/block/report controls. The partner
reads nothing directly — a security-definer snapshot returns only enabled
fields, and RLS keeps every underlying row owner-only. Invitations are never
emailed and no automated moderation is claimed.
Phase 10 adds prepaid AI credits. There is no free plan: new accounts start at
zero credits and every AI request is paid from the ledger. One credit costs
$0.10, sold in five one-time packs from $5/50 credits to $100/1,000 credits.
Credits are an append-only ledger in Postgres: one test-mode credit is reserved
before a model call and released if the call fails, the balance guard refuses an
overspend, and a purchase is credited only by a signature-verified Stripe webhook
whose event id can be processed once. A test-mode checkout creates a pending
payment from a database price, the success page adds nothing, refunds are full
and only for unused credits, and a refund that would go negative is parked for a
person. Token counts are recorded as the provider reports them; provider cost
stays explicitly unknown until an owner enters prices. The final model-specific
operation rate card remains unapproved and inactive; see `PRICING.md`.
`/owner` shows aggregate activity, AI outcomes, credits and payment states —
never task content — behind a database-side ownership check.
Phase 11 adds optional work preferences — session length, usual days and hours,
task size, communication style, topics, and a preferred reminder schedule — and
uses only what was explicitly saved to shape planning, task help and a daily
selection. Every field is optional and can be viewed, edited, reset, deleted or
switched off; with personalisation off, no preference line reaches a prompt and
no suggestion cites one. Suggestions carry a short reason such as “Suggested
because you selected 15-minute sessions.” The daily plan page proposes open
tasks from active goals that fit the time chosen, lets the person edit the
selection and approve it, refuses an overrun until the warning is confirmed, and
records a selection only: no task, deadline, plan or reminder is changed, and an
unselected task is never called abandoned. Preferences are never inferred from
reflections or conversations; there is no profiling, scoring or medical
inference.

Phase 12 adds an optional learning mode to an existing goal. A person says what
they want to learn, their experience, one concrete outcome and their weekly time;
the model drafts a path of explanations, practice, a small project and
checkpoints, which is saved only after the whole reply validates and stays fully
editable and skippable. Step-level help covers explaining the concept, a worked
example, a practice exercise, a hint and a review of the person's own answer;
nothing from those requests is saved automatically, and the hint request is
forbidden from giving the answer. Answers, AI feedback, the person's confidence
and their own completion mark are stored and shown separately, checkpoint
approval is the person's own act, and every generated step is labelled. The
feature does no retrieval, so it cites no sources and says so; the prompts forbid
invented citations, mastery-by-date promises and presenting feedback as a
qualification. Certificates, automated high-stakes grading and rankings are not
included.
Phase 13 adds small shared workspaces, separate from personal goals. An owner
runs membership, roles, workspace settings and deletion; admins manage shared
goals, tasks and assignments; members add tasks, comment and update work assigned
to them. Exactly one active owner is a database rule, promoting someone transfers
ownership, and the last owner must transfer or delete rather than leave a
workspace without an owner. Copying a personal goal in requires an explicit
confirmation, copies only the title and outcome into a workspace-owned row, and
records provenance without granting access; no workspace function reads personal
goals, saved work, reflections, learning records, focus sessions or AI
conversations. Membership writes go through role-checking functions, every read
policy requires an active membership so removal revokes access on the next
request, and membership and permission changes are audited as kinds and roles
only. Assignments and comments notify through the in-app inbox, each subject to
the member's own switches; there is no email, SMS or push channel. AI stays
personal and metered: no workspace budget or unmetered team path exists.
Phase 14 adds small workflows: an ordered sequence of exactly five step kinds
(user input, AI drafting, user review, approved connector action, completion
checkpoint) built in a form, not a graph editor, and modelled on “Prepare a
weekly project update”. A run pauses at input, review and the checkpoint, and
only the person confirms the finish. Editing a workflow writes an immutable
version and a run copies its steps, name and version at start, so an edit never
reaches a run already going. Each connector action needs its own approval
holding the exact connector, destination, content and hash; a trigger refuses to
change approved content, an approval can be consumed once, a partial unique index
allows one live or succeeded action per step, and execution claims the action
with one conditional status change, so a double submit cannot send twice. Retry
is set per step and refused when an earlier attempt succeeded, is executing or
ended uncertain. Every step keeps its output, so a later failure loses nothing,
and deleting a workflow leaves existing runs readable. There is no code step, no
arbitrary HTTP call, no browser automation and no background run; the only
connector is explicitly simulated and records the approved text inside the app.
Drafting is metered as its own AI request kind under the existing allowance and
credit ledger.
Phase 15 adds `/data`: a documented JSON export of goals and tasks, saved results,
weekly reflections and saved preferences (plus per-dataset CSVs and recorded focus
time, which is export-only), and a versioned, additive import of that same format.
An import is size-, schema- and count-checked, previewed before anything is
written, tied to a confirmation for that exact preview, and never trusts an
identifier from the file: every row is created under the signed-in account.
Existing goals and tasks are never edited, an existing week's reflection is
skipped, and saved preferences are replaced only with explicit approval; rejected
records are listed with reasons while valid records still import. Connector tokens
and payment credentials are absent from the format and cause a record to be
rejected. The page also states what account deletion removes, what is retained as
accounting only, and what is anonymised. `/api/health` reports configuration,
database reachability and the source revision without exposing a secret, and
operational logs carry event names, codes and counts only. OPERATIONS.md documents
configuration, forward-only migrations and their rollback limits, backup and
restore, the account matrix, test isolation and a reproducible release checklist.
Destructive database tests moved off the live project into an isolated embedded
Postgres restore drill that refuses to run against a database not named
`restore_test`.

Phase 16 adds `/futures`: three plausible futures for a decision — favorable
conditions, expected working assumptions and difficult conditions — with no
claim that any of them is likely. Each scenario holds starting assumptions,
possible developments, opportunities, risks, early signals, actions useful
whatever happens, reversible first steps and conditions that would justify
changing course, and every line carries an evidence label: what the person
provided, a retrieved fact with a source they supplied, an assumption, an
AI-generated possibility, or an unknown. No research tool is connected, so the
workspace states that the exercise is assumption-based; a "retrieved" line is
kept only when its URL appears in the person's own text, and percentages,
probabilities, guarantees and predictions are removed from generated text rather
than displayed. All three scenarios are saved only when the whole reply
validates, every scenario stays editable with rewritten lines relabelled as the
person's own, and the three can be compared side by side. A decision rationale,
a leaning and a review date are optional and clearable; any action can become one
ordinary task in a linked goal, at most once, and deleting the path never
deletes those tasks. Generation is a metered AI request kind, the three tables are
owner-only under RLS, and the pure contract is tested with fixtures plus the
isolated restore drill. Live generation against the provider still awaits
approval.

Phase 17 adds `/reviews`: one decision reviewed from five fixed perspectives —
planner, critic, research reviewer, human-impact reviewer and synthesizer — in
sequential stages with a hard cap of five AI requests. The person starts each
stage, sees the expected usage before creating a review, and can cancel between
stages. Every perspective reads the same question, context, constraints,
priorities and sources; only links the person supplied may be cited, and any
other URL is removed and relabelled as an assumption. Each stage returns options,
labelled evidence, counterarguments, unresolved disagreements, missing
information, a low-risk experiment with success and stop signals, and questions
for the person; the synthesizer adds trade-offs and an optional recommendation.
A failed stage is recorded as failed and the review ends partial rather than
complete, earlier answers stay readable, and cancellation skips unstarted stages.
The interface states that this is a summary rather than hidden reasoning and that
five answers from one model are not independent evidence. The person can reject
the recommendation and save their own decision. The pure contract is covered by
fixtures; live generation against the provider still awaits approval.

Phase 18 adds `/radar`: an opt-in radar for developments a person actually read.
Topics — AI and automation, work and careers, business and entrepreneurship,
education, community needs, technology and public policy — are off until chosen.
This build fetches and scrapes nothing, so each signal is recorded by hand with
its own source name and link, the source's publication date, and the retrieval
time; local, private and credential-bearing links are refused. Duplicate signals
are refused by a unique key on the normalised source plus publication date. Six
labels are kept apart — announced capability, released capability, research
result, opinion, speculation and observed change — and an announcement is never
shown as a release or a fact. Cards show where a signal applies, what remains
uncertain, and a relevance explanation that names only the followed topic and
the connected goal. Actions are explicit: save for later, dismiss and restore,
mute or unmute a topic, open scenario planning, create one preparation task, or
create one learning goal. No signal changes a plan on its own and the phase
spends no AI request. The pure rules are covered by fixtures, and the restore
drill covers ownership and account deletion.

Phase 19 adds missions inside existing team workspaces, reusing the membership,
roles and RLS from Phase 13. A mission records the problem, affected people, a
desired outcome, constraints, a category, a named human decision owner and a
review date, plus shared tasks, evidence and assumptions, decisions and outcomes.
AI assistance is optional and explicit: summaries, questions, plans, materials,
conflicting assumptions, simplification and measurement ideas are each one
request, kept as labelled suggestions that a person can accept, reject or
challenge; the model is instructed not to vote, impersonate, invent consensus,
publish or contact anyone, and personal stories without recorded consent are
never sent to it. Decisions record the approver and keep dissent in its own
words, and accepting a suggestion never creates one. Sharing is an owner-only
approval record with no publishing or contacting channel in the build. Impact is
four separate lists — work completed, outputs, participant reports and verified
outcomes — with no composite score and no claim of social impact from finished
tasks. The pure rules are covered by fixtures, and the restore drill proves that
removing a membership revokes access to the mission and its children.

Phase 20 adds `/outcomes`: reviews that compare an earlier expectation with what
happened. A review is started by hand from one of your own goals, future paths or
saved reviews, and the expectation snapshot is stored with a trigger that refuses
any later edit, so nothing can be rewritten to look more accurate. Observations
answer the six review questions and are append-only: the table has no update or
delete policy. Evaluation keeps action completed, desired result, expectation
accuracy and external conditions as four separate answers, with a note that
before and after is not proof of cause. Optional numerical forecasts store a
stated probability and resolution, score each with the Brier score and explain
the method, averaging only that review's resolved forecasts; there is no combined
intelligence or cross-person score. Improvement proposals cover planning prompts,
template structure, clarification questions and review timing; each requires
explicit consent and a scoped test set, approval creates a version, and rollback
retires the active version and restores the previous one. Shipped prompts,
permissions and safety rules are never changed at runtime, private content is not
used for training, and benefit is measured by useful work, user-confirmed
progress, fewer unwanted suggestions and better uncertainty, not engagement. The
pure rules are covered by fixtures, and the restore drill checks ownership,
append-only history and account deletion.

Phase 21 adds `/build`: an app intake becomes an editable specification, which
must be approved before generation. The generator supports one stack — Next.js,
TypeScript and Tailwind CSS, with Supabase added only when accounts are selected —
and produces real stored files, not chat code blocks: pages, navigation, owner-only
migrations, API routes with zod validation and visible error states, a README, an
`ACCEPTANCE.md`, an `.env.example` with names only, and clearly labelled MOCKED
integration stubs. Files live in their own tables, separate from tasks and saved
results. Each generation, edit and restore writes a complete version snapshot and
replaces the tree in one database function, so a failed generation cannot destroy
the last usable project and every restore is reversible. Paths and sizes are
validated in the app and in Postgres; traversal, absolute paths, backslashes,
reserved directories, real `.env` files and oversized requests are refused. The
editor, change summary and ZIP download reuse the signed-in account, and every
project, specification, file and snapshot is owner-only. Nothing is executed,
installed, deployed or purchased, no credential is invented, and no production
readiness is claimed. The pure rules are fixture-tested, and the restore drill
checks isolation, approved-spec immutability, version preservation and deletion.
The generator is deterministic and makes no model call, so it spends no AI requests.

Phase 22 adds an isolated preview workspace under `/build/[projectId]/workspace`.
Generated code runs in a separate runner process, never in the Next.js app. On
Linux the runner uses unprivileged user, mount, PID, UTS, IPC and network
namespaces, a tmpfs root and chroot, `prlimit` caps, wall-clock timeouts and
process-group cleanup. The project sees only its own directory, a read-only
pinned dependency cache and the runtime; it gets no host filesystem, no platform
credentials, no route off the machine and no access to another workspace. No
Docker and no root are required, and the runner refuses to start if those
namespaces are unavailable.

The app can start a workspace, run typecheck, lint, configured tests and build,
start a preview, inspect logs, download the project and stop the workspace. The
preview is a separate host with a short-lived signed token, no platform cookie,
no referrer and its own frame policy; unused previews expire. Repairs are bounded
to three repair attempts (two credits each, six credits per workspace), three AI
requests, ten minutes and 200,000 characters of log.
One iteration sends only the failing check and bounded source files, accepts only
full replacements of existing files under `app/`, `components/` or `lib/`,
refuses tests and configuration, saves a normal version snapshot, reruns every
check and shows the log, changed files and diff. A failure that remains is shown
as unresolved. No test is deleted and no error is hidden. The sandbox probe and
the deliberately broken generated app are covered by an opt-in integration test;
`npm run test:restore` checks the new owner-only tables.

Phase 23 adds optional agent-team mode under `/build/[projectId]/team`. A run is
built from one approved specification as a durable queue of six role types:
coordinator, frontend, backend, data, QA and security. Each task carries an
objective, inputs, allowed tools, expected artifacts, acceptance checks, file
claims and runtime/AI budgets. Roles have disjoint write roots; QA and security
are read-only, and no role has deployment, credential, external-action or
arbitrary-execution capabilities. The coordinator cannot append scope because
the queue is derived only from the approved spec and checked against its pages
and entities. Each task produces a logical branch; a later claim on a file owned
by an earlier task becomes a visible blocker. The owner can pause, resume,
reassign, reject, approve, resolve a claim conflict or cancel, and every state
change is recorded. Completed branches are integrated in one controlled step
only after all code tasks finish; stale bases and duplicate paths stop the merge
before any file is written. A successful merge snapshots a new app version with
per-file contributor attribution and runs sandbox checks; failures are recorded.
The run is capped at four concurrent agents, 24 AI calls, 1,800 seconds and 24
tasks, with no recursive spawning, unlimited retry or self-permission change.
The workers are deterministic controlled fixtures: they make no paid model call,
and the security reviewer is explicitly issue-finding, not a complete audit.
Fixture tests cover role boundaries, scope refusal, concurrency, a deliberate
claim conflict, stale/overlapping merges, attribution and hard limits. The
restore drill covers the new owner-only tables and cross-account refusal.

Phase 24 adds `/build/[projectId]/deploy` with one integration per role: GitHub
for the repository, Vercel for application hosting and Supabase for separate
development and production databases. Provider tokens and database URLs are
AES-256-GCM sealed with `DEPLOYMENT_VAULT_KEY`; browser roles cannot select the
sealed columns, and each connection belongs to one project. The page derives
environment names from actual generated code, distinguishes public and
server-only values, encrypts values supplied through protected fields, and
shows an exact plan before any external change: source version and digest,
repository/branch, hosting project, database targets, migration preview and
destructive flags, visibility, known/unknown costs and rollback limits. Approval
requires typing `DEPLOY` and is bound to the plan fingerprint. Pre-deploy checks
must pass first. The approved pipeline commits the snapshot, applies production
migrations only for a production plan, upserts Vercel environment names, creates
one deployment, polls it and runs a smoke check. A hosting API success is not
marked complete until smoke checks pass; partial failures and uncertain
migration state are recorded rather than retried blindly. A prior source
snapshot can be redeployed only through a fresh plan and approval. Provider
adapters and encryption are stub-tested; no real external write was made in this
phase.

Phase 25 adds `/build/[projectId]/improve`. A change request is inspected against
the current files, clarified when vague, and proposed as a plan of at most six
changed files with tests, permissions and limitations. Plan approval, patch
preparation, isolated tests and preview, diff review and merge are separate human
steps. Patches start from an exact base digest and preserve every unrelated file;
merge writes one reversible `app_versions` snapshot through
`replace_app_files`. Dashboard and mobile-navigation fixtures make real bounded
source edits; other categories create a clearly labelled review page or
integration stub and do not claim an arbitrary fix. Project memory is editable
across seven categories, refuses secrets, and is never a permission grant.
Merged changes can become versioned skills with fixed permissions; skills cannot
deploy or install tools. Observability is opt-in and manual: selected errors are
redacted, associated with a release and can propose a bounded repair without
sending a database or user rows to a model. Automation levels 1–3 all leave
production deployment to the separate Phase 24 approval. Evaluation counts
accepted/rejected changes, test outcomes, regressions, runtime, AI calls and
successful deployments without treating generated volume as success. The
workspace remains fixture-only; no live model or deployment was used.

No live payments, subscriptions, SMS, push notifications, public template galleries, paid templates,
user-generated public content, public communities, accountability messaging,
leaderboards, coaching marketplace, autonomous task execution or external
automation are included.

Phase 31 adds an `Import my app` path for the supported Next.js App Router, TypeScript and Tailwind stack. It validates archive bounds, rejects traversal and symbolic links, excludes secret and repository-instruction files, records an editable file-linked application map, runs the existing isolated sandbox for a baseline, and produces one bounded modernization proposal that must go through the existing Phase 25 plan/patch/test/preview/review gates. No push or deployment is performed.

Phase 32 adds an evaluation workspace at `/evaluations`. It reuses the existing team roles, bounded job/task patterns, project snapshots and fixture accounting, then compares at least two configurations on the same development and held-out tasks. Every trial is appended as evidence: configured/returned model identifiers, prompt version, tool calls, completion, deterministic checks, runtime, reported tokens, known versus estimated cost, and human review. Failed runs stay, acceptance material is immutable after the first run, and AI-judged opinions are separated from deterministic results. Capability profiles are versioned and cite their evidence and limitations. Recommendations retain a rollback snapshot and require explicit approval; they never change production routing, prompts or roles. Runs require an approved budget even though this phase makes no paid provider call. Tests use the existing fixtures; no live model, external action, push or deployment was used.

Phase 33 adds `/build/{projectId}/model`. It derives an immutable model version from the approved specification, current files, safe integration metadata and deployment records, then ties every record to a source digest. A changed source makes the model visibly stale and blocks new scenarios until a fresh version is built. API-change, new-role, background-job and database-field scenarios return potentially affected components, file-and-line evidence, assumptions, unknowns, proposed tests, reversible order and reversible experiments, while explicitly separating static narrative from measured results and avoiding performance or cost forecasts. Bounded experiments are owner-only, source-only and limited to four per scenario, twenty synthetic requests and thirty seconds. Contract inspection and source-size observation can run locally; synthetic requests are recorded as blocked without an isolated runner. No external URL, production user data or external load test is permitted. An experiment must be approved, and a database function atomically converts it once into an existing Build Room task. The model page compares any two retained snapshots and shows added, removed and changed pages, journeys, services, dependencies, entities, integrations, environments, constraints, assumptions and missing information with exact before/after values and evidence. A selected comparison can be downloaded as a Markdown changelog from an owner-scoped route that reads only the stored snapshots. Tests cover model versioning, version comparison, changelog formatting, stale warnings, owner isolation, experiment limits, external-target refusal and approval-gated conversion.

Phase 33 also pins the access guarantees at the HTTP boundary in the isolated restore drill. The drill drives the real `/build/{projectId}/model/changelog`, `/build/{projectId}/download` and `/build/{projectId}/room` routes against Postgres: the owner's changelog and archive downloads are verified while the project workspace link exists and again after it is removed (in separate fixtures), and the unlinked ZIP is parsed to confirm `app/page.tsx` and its seeded content. A project member whose membership was removed is denied on both download routes while the workspace link and their active workspace role still exist, and both downloads stay denied after the link is removed, each with the same generic `Not found` body carrying no project name, role or hint that the project exists. The Build Room page route takes its not-found path because the project-role lookup returns nothing, and the owner's Build Room page still renders the project name and owner role. These checks run as the authenticated database role, so the guarantees come from owner-scoped queries and RLS rather than from the route layer alone.

Phase 34 adds mission control to an existing workspace mission. A mission can explicitly link existing app projects, then record deliverables with accountable owners and review dates, finish-to-start dependencies, and agent jobs attached to the existing project task queue. Planning is computed from the recorded graph only: it proposes a dependency-aware order and parallel groups, and names missing owners, missing review dates, missing project links, cycles and resource conflicts instead of implying a guaranteed schedule. Mission limits (parallel jobs, total jobs, runtime and agent calls) apply in addition to project limits, with the smaller remaining allowance winning. A job cannot start before its job and milestone dependencies complete; a failed dependency pauses downstream work, cancellation propagates through downstream jobs, stale running jobs can be recovered after the runtime limit, and completed artifacts are never deleted. Scope changes, external writes, deployments and permission increases require a separate approval record; a requester cannot approve their own request and an agent cannot approve its own permission increase. The dashboard shows progress by deliverable, blocked dependencies, pending decisions, disagreements, resource use, saved test evidence and upcoming reviews, with no person ranking or surveillance score. Tests cover the pure planning, limit, cancellation, recovery and approval rules, plus the real Postgres RLS and bounded job RPCs in the isolated restore drill.

Phase 38 adds `/capability-eval`: a versioned capability evaluation workspace for eight domains — software building and repair, research synthesis, quantitative reasoning, document analysis, planning under constraints, tool selection and execution, recovery from errors, and adaptation to unfamiliar task formats. Each evaluation seeds development, validation and held-out tasks, two versioned configurations (a single-model baseline and an orchestrated system) with their model, orchestration, prompt and dataset versions, permitted tools, runtime and spend limits, scoring rubric and human-assistance allowance, and server-side answer keys stored in a table no client role can read. Scoring runs in the database: it returns counts, a failure category and a scoring detail, and never returns held-out key content. Repeated exposure of a held-out task to the same configuration is recorded as contamination. Runs are append-only and retain verified success, partial success, unsupported claims, permission violations, human interventions, recovery outcomes, cost and latency; reports separate domains, difficulty and split, and never present a single score or an AGI claim. A configuration's autonomy permission is fixed when the version is created and cannot be changed by any evaluation result. Human results are stored only with a documented collection protocol and measured numeric values, and are never invented. Fixture-scored only: no paid model call, deployment or permission change.
