export type TaskStatus = "todo" | "in_progress" | "completed";

export type Profile = {
  id: string;
  display_name: string | null;
  created_at: string;
};

export type GoalCategory =
  | "launch"
  | "job"
  | "content"
  | "learn"
  | "personal"
  | "business";

export type Goal = {
  id: string;
  user_id: string;
  title: string;
  desired_outcome: string;
  deadline: string | null;
  time_available_minutes: number;
  blocker: string | null;
  category: GoalCategory | null;
  archived_at: string | null;
  /** Set when the goal was created from a template; provenance only. */
  template_id: string | null;
  created_at: string;
  updated_at: string;
};

/** One suggested step in a template. Titles and times only. */
export type TemplateStep = {
  title: string;
  estimated_minutes: number;
  /** An example of what done might look like. Never a requirement. */
  example_deliverable: string | null;
};

/** A template from the static library, described in code rather than stored. */
export type GoalTemplate = {
  slug: string;
  category: GoalCategory;
  name: string;
  description: string;
  desired_outcome: string;
  steps: TemplateStep[];
  /** Premium templates need a premium_templates entitlement. */
  premium?: boolean;
};

/** A private, reusable template saved from one of this person's own plans. */
export type PersonalTemplate = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  desired_outcome: string;
  category: GoalCategory | null;
  steps: TemplateStep[];
  source_goal_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskOrigin = "manual" | "ai_plan";

export type Task = {
  id: string;
  goal_id: string;
  user_id: string;
  title: string;
  status: TaskStatus;
  completed_at: string | null;
  /** Plan detail: how to do it, in the model's words, editable by the person. */
  instructions: string | null;
  first_action: string | null;
  expected_deliverable: string | null;
  estimated_minutes: number | null;
  origin: TaskOrigin;
  sort_order: number;
  plan_id: string | null;
  created_at: string;
  updated_at: string;
};

export type TaskResult = {
  id: string;
  task_id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export type FocusSessionStatus = "running" | "paused" | "finished";

/** A focus session as the database reports it; `elapsed_seconds` is computed there. */
export type FocusSessionView = {
  id: string;
  task_id: string;
  goal_id: string;
  status: FocusSessionStatus;
  started_at: string;
  finished_at: string | null;
  elapsed_seconds: number;
};

export type FocusTotals = {
  today_seconds: number;
  week_seconds: number;
  total_seconds: number;
  session_count: number;
};

export type FocusSnapshot = {
  /** The one open session, if there is one. */
  session: FocusSessionView | null;
  totals: FocusTotals;
};

export type WeeklyCheckin = {
  id: string;
  week_start: string;
  moved_forward: string;
  got_in_the_way: string;
  next_step: string;
  updated_at: string;
};

export type ReminderSettings = {
  user_id: string;
  timezone: string;
  remind_at: string;
  weekdays: number[];
  quiet_from: string;
  quiet_to: string;
  enabled: boolean;
  daily_checkin: boolean;
  checkin_at: string;
};

export type Reminder = {
  id: string;
  goal_id: string | null;
  task_id: string | null;
  enabled: boolean;
  next_due_at: string | null;
  last_delivered_at: string | null;
};

export type ReminderDelivery = {
  id: string;
  reminder_id: string | null;
  kind: "reminder" | "checkin";
  due_at: string;
  state: "unread" | "snoozed" | "dismissed";
  snoozed_until: string | null;
};

export type InboxDelivery = ReminderDelivery & {
  taskId: string | null;
  taskTitle: string | null;
  goalId: string | null;
  goalTitle: string | null;
};

/** Phase 8: one accountability partner, explicit sharing, short messages. */
export type PartnershipSummary = {
  id: string;
  partner_name: string;
  started_at: string;
};

/** What this person has switched on for their partner. All off by default. */
export type MyShareSettings = {
  goal_title: boolean;
  completion: boolean;
  milestone: boolean;
  checkin: boolean;
  milestone_text: string | null;
  checkin_text: string | null;
};

/** Only the fields the partner switched on, as the database returns them. */
export type PartnerShared = {
  goal_titles?: string[] | null;
  completion?: {
    goals_total: number;
    goals_completed: number;
    tasks_total: number;
    tasks_completed: number;
  } | null;
  milestone?: string | null;
  checkin?: string | null;
  updated_at?: string;
};

export type PartnerSnapshot = {
  partner_name: string;
  shared: PartnerShared;
};

export type PartnershipInvitation = {
  id: string;
  invitee_email: string;
  token: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  created_at: string;
  expires_at: string;
};

export type EncouragementMessage = {
  id: string;
  sender_id: string;
  body: string;
  created_at: string;
};

/** Phase 10: prepaid AI credits. Every balance is a sum of ledger rows. */
export type CreditPack = {
  slug: string;
  credits: number;
  amount_cents: number;
  currency: string;
  label: string;
  sort_order: number;
};

export type CreditPayment = {
  id: string;
  pack_slug: string;
  credits: number;
  amount_cents: number;
  currency: string;
  status: "pending" | "paid" | "refunded" | "failed" | "canceled";
  receipt_url: string | null;
  created_at: string;
  refunded_at: string | null;
};

export type CreditLedgerEntry = {
  id: string;
  delta: number;
  reason: "purchase" | "ai_charge" | "ai_release" | "refund" | "adjustment" | "forfeit";
  note: string | null;
  created_at: string;
};

export type CreditSummary = {
  balance: number;
  free_used_today: number;
  free_limit: number;
  free_remaining: number;
  credits_spent_total: number;
  is_owner: boolean;
};

export type AiUsageRow = {
  id: string;
  kind: string;
  model: string;
  status: "in_flight" | "succeeded" | "failed";
  error_code: string | null;
  credits_charged: number;
  tokens_in: number | null;
  tokens_out: number | null;
  started_at: string;
};

/** Aggregate counters only: no private task content is ever selected. */
export type OwnerMetrics = Record<string, number | boolean | Record<string, number>>;

/** Phase 31: paid product offers. These are not AI credits. */
export type BillingOffer = {
  slug: string;
  label: string;
  description: string;
  price_cents: number;
  currency: string;
  quantity_label: string;
  min_quantity: number;
  max_quantity: number;
  seat_based: boolean;
  grants: string[];
  duration_days: number | null;
  sort_order: number;
};

export type BillingPurchase = {
  id: string;
  offer_slug: string;
  quantity: number;
  amount_cents: number;
  currency: string;
  status: "pending" | "paid" | "refunded" | "failed" | "canceled" | "expired";
  workspace_id: string | null;
  project_id: string | null;
  receipt_url: string | null;
  paid_at: string | null;
  refunded_at: string | null;
  created_at: string;
};

export type BillingEntitlement = {
  id: string;
  offer_slug: string;
  grants: string[];
  quantity: number;
  workspace_id: string | null;
  project_id: string | null;
  status: "active" | "revoked" | "expired";
  starts_at: string;
  expires_at: string | null;
  created_at: string;
};

export type SupportRequest = {
  id: string;
  subject: string;
  body: string;
  status: "open" | "closed";
  priority: "standard" | "priority";
  created_at: string;
};

export type AppCustomDomain = {
  id: string;
  project_id: string;
  domain: string;
  status: "pending" | "active" | "error";
  detail: Record<string, unknown>;
  created_at: string;
};

/** Phase 11: work habits a person typed in themselves. Every field is optional. */
export type TaskSize = "small" | "medium" | "large";

export type CommunicationStyle = "concise" | "encouraging" | "detailed";

export type UserPreferences = {
  user_id: string;
  /** Preferred length of one work session, in minutes. */
  session_length_minutes: number | null;
  /** 0 = Sunday. Null when no usual days were chosen. */
  work_days: number[] | null;
  work_start: string | null;
  work_end: string | null;
  task_size: TaskSize | null;
  communication_style: CommunicationStyle | null;
  help_topics: string[] | null;
  /** Off means saved preferences shape nothing at all. */
  personalization_enabled: boolean;
  updated_at: string | null;
};

/** An open task that can be offered for a daily plan, with its goal's title. */
export type DailyPlanCandidate = {
  id: string;
  title: string;
  status: TaskStatus;
  estimated_minutes: number | null;
  goal_id: string;
  goal_title: string;
};

/** One approved daily selection. Nothing here changes a task. */
export type DailyPlan = {
  id: string;
  day: string;
  minutes_available: number;
  task_ids: string[];
  total_minutes: number;
  unknown_estimates: number;
  over_limit: boolean;
  created_at: string;
  updated_at: string;
};

/** Phase 12: optional learning mode attached to an existing goal. */
export type LearningExperience = "new" | "some" | "confident";

export type LearningStepKind =
  | "explanation"
  | "practice"
  | "project"
  | "checkpoint";

export type LearningPlan = {
  id: string;
  goal_id: string;
  what_to_learn: string;
  experience: LearningExperience;
  outcome: string;
  minutes_per_week: number;
  model: string;
  created_at: string;
  updated_at: string;
};

export type LearningStep = {
  id: string;
  plan_id: string;
  position: number;
  kind: LearningStepKind;
  title: string;
  body: string;
  estimated_minutes: number;
  /** "skipped" means set aside by the person, not deleted. */
  status: "active" | "skipped";
  /** Checkpoints are suggestions until the person approves them. */
  approved_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * One saved exercise answer. AI feedback, user confidence and completion are
 * three separate columns on purpose: none of them implies another.
 */
export type LearningRecord = {
  id: string;
  step_id: string;
  goal_id: string;
  prompt: string | null;
  answer: string;
  feedback: string | null;
  confidence: number | null;
  revisit: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

/** Phase 13: a small shared workspace, separate from personal goals. */
export type WorkspaceRole = "owner" | "admin" | "member";

export type WorkspaceMemberStatus = "active" | "left" | "removed";

export type Workspace = {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** One membership row, including people who left, so comments stay attributed. */
export type WorkspaceMember = {
  user_id: string;
  display_name: string;
  role: WorkspaceRole;
  status: WorkspaceMemberStatus;
  joined_at: string;
};

export type WorkspaceInvitation = {
  id: string;
  invitee_email: string;
  role: "admin" | "member";
  token: string;
  status: "pending" | "accepted" | "declined" | "cancelled";
  created_at: string;
  expires_at: string;
};

/** A workspace-owned goal. Never a personal goal, even when it was copied. */
export type WorkspaceGoal = {
  id: string;
  workspace_id: string;
  title: string;
  desired_outcome: string;
  created_by: string | null;
  /** Provenance for a confirmed copy; grants no access to the personal goal. */
  source_goal_id: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkspaceTask = {
  id: string;
  workspace_id: string;
  goal_id: string;
  title: string;
  status: TaskStatus;
  assignee_id: string | null;
  created_by: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkspaceComment = {
  id: string;
  workspace_id: string;
  task_id: string;
  author_id: string | null;
  body: string;
  created_at: string;
};

export type WorkspaceNotificationKind =
  | "assigned"
  | "comment"
  | "role_changed"
  | "member_joined";

export type WorkspaceNotification = {
  id: string;
  workspace_id: string;
  kind: WorkspaceNotificationKind;
  goal_id: string | null;
  task_id: string | null;
  summary: string;
  read_at: string | null;
  created_at: string;
};

export type WorkspaceNotificationPrefs = {
  notify_assignments: boolean;
  notify_comments: boolean;
  notify_membership: boolean;
};

export type WorkspaceEventKind =
  | "workspace_created"
  | "workspace_renamed"
  | "member_invited"
  | "invitation_cancelled"
  | "member_joined"
  | "role_changed"
  | "member_removed"
  | "member_left"
  | "goal_created"
  | "goal_shared";

export type WorkspaceEvent = {
  id: string;
  workspace_id: string;
  actor_id: string | null;
  kind: WorkspaceEventKind;
  subject_user_id: string | null;
  detail: string | null;
  created_at: string;
};

/** Phase 14: small explicit workflows with exact-content action approvals. */
export type WorkflowStepKind =
  | "user_input"
  | "ai_draft"
  | "user_review"
  | "connector_action"
  | "checkpoint";

export type Workflow = {
  id: string;
  user_id: string;
  name: string;
  description: string | null;
  goal_id: string | null;
  current_version: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WorkflowVersion = {
  workflow_id: string;
  version: number;
  name: string;
  description: string | null;
  goal_id: string | null;
  steps: unknown;
  created_at: string;
};

export type WorkflowRunStatus =
  | "waiting_for_input"
  | "running"
  | "waiting_for_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "outcome_uncertain";

export type WorkflowRunStepStatus =
  | "pending"
  | "waiting_for_input"
  | "running"
  | "waiting_for_approval"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "outcome_uncertain";

export type WorkflowRun = {
  id: string;
  user_id: string;
  /** Null when the workflow was deleted after this run started. */
  workflow_id: string | null;
  workflow_name: string;
  workflow_version: number;
  goal_id: string | null;
  status: WorkflowRunStatus;
  current_position: number;
  context: unknown;
  error_code: string | null;
  started_at: string;
  finished_at: string | null;
  cancelled_at: string | null;
  /** Maximum AI credits this run may spend. */
  credit_budget: number;
  /** Credits reserved or spent by AI drafts in this run. */
  credits_spent: number;
  created_at: string;
  updated_at: string;
};

export type WorkflowRunStep = {
  id: string;
  run_id: string;
  user_id: string;
  position: number;
  kind: WorkflowStepKind;
  title: string;
  instructions: string | null;
  config: { connector?: string; destination?: string } | null;
  retry_policy: "manual" | "none";
  status: WorkflowRunStepStatus;
  attempt: number;
  output: unknown;
  error_code: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type ActionStatus =
  | "pending_approval"
  | "approved"
  | "executing"
  | "succeeded"
  | "failed"
  | "outcome_uncertain"
  | "cancelled"
  | "declined";

export type ActionRecord = {
  id: string;
  user_id: string;
  run_id: string;
  run_step_id: string;
  connector: string;
  action_kind: "save_document";
  destination: string;
  content: string;
  content_hash: string;
  status: ActionStatus;
  idempotency_key: string;
  attempts: number;
  simulated: boolean;
  external_ref: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type ActionApproval = {
  id: string;
  action_id: string;
  user_id: string;
  connector: string;
  destination: string;
  approved_content: string;
  approved_hash: string;
  approved_at: string;
  consumed_at: string | null;
};

/** Phase 16: three plausible futures for one decision. Never predictions. */
export type FutureScenarioKind = "favorable" | "expected" | "difficult";

export type FutureEvidenceLabel =
  | "user"
  | "retrieved"
  | "assumption"
  | "ai"
  | "unknown";

export type FutureEvidence = {
  text: string;
  label: FutureEvidenceLabel;
  /** Only for `retrieved`, and only a URL the person supplied. */
  source_url: string | null;
};

export type FuturePath = {
  id: string;
  user_id: string;
  goal_id: string | null;
  decision: string;
  horizon: string;
  resources: string;
  constraints: string;
  success_definition: string;
  uncertainties: string;
  model: string;
  /** The person's own choice after comparing. Null until they save one. */
  chosen_kind: FutureScenarioKind | null;
  rationale: string | null;
  rationale_saved_at: string | null;
  review_at: string | null;
  created_at: string;
  updated_at: string;
};

export type FutureScenario = {
  id: string;
  path_id: string;
  user_id: string;
  kind: FutureScenarioKind;
  title: string;
  assumptions: FutureEvidence[];
  developments: FutureEvidence[];
  opportunities: FutureEvidence[];
  risks: FutureEvidence[];
  signals: FutureEvidence[];
  actions: FutureEvidence[];
  first_steps: FutureEvidence[];
  change_conditions: FutureEvidence[];
  created_at: string;
  updated_at: string;
};

/** One action the person turned into an ordinary task. */
export type FutureActionLink = {
  id: string;
  path_id: string;
  user_id: string;
  scenario_kind: FutureScenarioKind;
  action_index: number;
  action_text: string;
  task_id: string;
  created_at: string;
};

/** Phase 17: five sequential review perspectives over one shared record. */
export type ReviewStageKind =
  | "planner"
  | "critic"
  | "research"
  | "human_impact"
  | "synthesizer";

export type ReviewStatus = "in_progress" | "complete" | "partial" | "cancelled";

export type ReviewStageStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export type ReviewSourceRecord = { title: string; url: string };

export type Review = {
  id: string;
  user_id: string;
  question: string;
  context: string;
  constraints: string;
  priorities: string[];
  sources: ReviewSourceRecord[];
  model: string;
  status: ReviewStatus;
  current_position: number;
  cancel_requested_at: string | null;
  error_code: string | null;
  chosen_option: string | null;
  decision: string | null;
  rejected_recommendation: boolean;
  decided_at: string | null;
  finished_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReviewStageRecord = {
  id: string;
  review_id: string;
  user_id: string;
  perspective: ReviewStageKind;
  position: number;
  status: ReviewStageStatus;
  summary: string | null;
  assumptions: string[] | null;
  options: { title: string; description: string }[] | null;
  evidence:
    | { text: string; basis: string; source_url: string | null }[]
    | null;
  counterarguments: string[] | null;
  disagreements: string[] | null;
  missing_info: string[] | null;
  experiment:
    | { title: string; steps: string[]; success_signal: string; stop_signal: string }
    | null;
  questions: string[] | null;
  tradeoffs: string[] | null;
  recommendation: string | null;
  error_code: string | null;
  started_at: string | null;
  finished_at: string | null;
};

/** Phase 20: outcomes and lessons over earlier expectations. */
export type OutcomeSourceKind = "goal" | "future_path" | "review";
export type OutcomeReviewStatus = "open" | "completed";
export type OutcomeObservationKind =
  | "observation"
  | "assumption"
  | "surprise"
  | "evidence"
  | "lesson"
  | "next_action";
export type AssumptionVerdict = "held" | "partly" | "failed" | "unknown";
export type AssessmentAnswer = "yes" | "partly" | "no" | "unknown";
export type ExternalChange = "changed" | "unchanged" | "unclear";
export type ForecastResolution = "pending" | "occurred" | "did_not_occur";
export type ImprovementArea =
  | "planning_prompt"
  | "template_structure"
  | "clarification_questions"
  | "review_timing";
export type ImprovementStatus = "proposed" | "approved" | "rejected" | "rolled_back";
export type ImprovementVersionStatus = "active" | "superseded" | "rolled_back";

/** The immutable record of what was expected when a review was created. */
export type ExpectationSnapshot = {
  source: OutcomeSourceKind;
  title: string;
  summary: string;
  lines: { label: string; text: string }[];
  captured_at: string;
};

export type OutcomeReview = {
  id: string;
  user_id: string;
  source_kind: OutcomeSourceKind;
  source_id: string;
  title: string;
  expectation_snapshot: ExpectationSnapshot;
  review_at: string | null;
  status: OutcomeReviewStatus;
  action_completed: AssessmentAnswer | null;
  desired_result: AssessmentAnswer | null;
  expectation_accuracy: AssessmentAnswer | null;
  external_conditions: ExternalChange | null;
  causation_note: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type OutcomeObservation = {
  id: string;
  review_id: string;
  user_id: string;
  kind: OutcomeObservationKind;
  text: string;
  verdict: AssumptionVerdict | null;
  causation_note: string | null;
  created_at: string;
};

export type OutcomeForecast = {
  id: string;
  review_id: string;
  user_id: string;
  statement: string;
  probability: number;
  resolution: ForecastResolution;
  resolved_at: string | null;
  created_at: string;
};

export type ImprovementProposal = {
  id: string;
  user_id: string;
  area: ImprovementArea;
  title: string;
  rationale: string;
  change_text: string;
  consent_confirmed: boolean;
  test_scope: string;
  status: ImprovementStatus;
  created_at: string;
  updated_at: string;
};

export type ImprovementVersion = {
  id: string;
  user_id: string;
  proposal_id: string | null;
  area: ImprovementArea;
  version: number;
  content: string;
  status: ImprovementVersionStatus;
  created_at: string;
  rolled_back_at: string | null;
};

/** Phase 19: workspace-owned missions with human governance and honest impact. */
export type MissionCategory =
  | "learning"
  | "community"
  | "accessibility"
  | "volunteer"
  | "environment"
  | "other";

export type MissionStatus = "draft" | "active" | "closed";
export type MissionEvidenceKind = "evidence" | "assumption";
export type MissionOutcomeKind = "work" | "output" | "participant" | "verified";
export type MissionSuggestionKind =
  | "summary"
  | "questions"
  | "plan"
  | "materials"
  | "conflicts"
  | "simplify"
  | "measures";
export type MissionSuggestionStatus =
  | "proposed"
  | "accepted"
  | "rejected"
  | "challenged";

export type Mission = {
  id: string;
  workspace_id: string;
  created_by: string | null;
  title: string;
  category: MissionCategory;
  problem: string;
  stakeholders: string;
  desired_outcome: string;
  constraints: string;
  status: MissionStatus;
  /** A named human member who owns decisions. Never an AI. */
  decision_owner_id: string | null;
  review_at: string | null;
  /** Recorded approval only: nothing in this build publishes or sends. */
  share_scope: string | null;
  share_approved_by: string | null;
  share_approved_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MissionEvidence = {
  id: string;
  mission_id: string;
  workspace_id: string;
  author_id: string | null;
  kind: MissionEvidenceKind;
  text: string;
  source_url: string | null;
  contains_personal_story: boolean;
  consent_note: string | null;
  consent_recorded_by: string | null;
  consent_at: string | null;
  created_at: string;
};

export type MissionDecision = {
  id: string;
  mission_id: string;
  workspace_id: string;
  created_by: string | null;
  title: string;
  summary: string;
  decided_by: string;
  decided_at: string;
  dissent: string | null;
  created_at: string;
};

export type MissionTask = {
  id: string;
  mission_id: string;
  workspace_id: string;
  created_by: string | null;
  title: string;
  status: TaskStatus;
  assignee_id: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MissionOutcome = {
  id: string;
  mission_id: string;
  workspace_id: string;
  reported_by: string | null;
  kind: MissionOutcomeKind;
  text: string;
  source_url: string | null;
  verified_by: string | null;
  verified_at: string | null;
  created_at: string;
};

export type MissionSuggestion = {
  id: string;
  mission_id: string;
  workspace_id: string;
  requested_by: string | null;
  kind: MissionSuggestionKind;
  body: string;
  model: string;
  status: MissionSuggestionStatus;
  challenge_note: string | null;
  challenged_by: string | null;
  challenged_at: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
};

export type MissionReport = {
  id: string;
  mission_id: string;
  workspace_id: string;
  reported_by: string | null;
  reason: string;
  resolved_at: string | null;
  resolved_by: string | null;
  created_at: string;
};

/** Phase 18: opt-in "what's changing?" radar. Signals are recorded, not fetched. */
export type RadarTopicSlug =
  | "ai"
  | "work"
  | "business"
  | "education"
  | "community"
  | "policy";

export type RadarSignalKind =
  | "announced"
  | "released"
  | "research"
  | "opinion"
  | "speculation"
  | "observed";

export type RadarTopic = {
  user_id: string;
  topic: RadarTopicSlug;
  /** Non-null hides this topic's signals without deleting them. */
  muted_at: string | null;
  created_at: string;
};

export type RadarSignal = {
  id: string;
  user_id: string;
  topic: RadarTopicSlug;
  kind: RadarSignalKind;
  /** What was reported, in the person's own words. */
  headline: string;
  source_name: string;
  source_url: string;
  /** The date the source published it. Never the retrieval date. */
  published_on: string;
  retrieved_at: string;
  geography: string | null;
  sector: string | null;
  /** What remains uncertain. Required, so no signal is presented as settled. */
  uncertainty: string;
  goal_id: string | null;
  dedupe_key: string;
  saved_at: string | null;
  dismissed_at: string | null;
  experiment_task_id: string | null;
  learning_goal_id: string | null;
  created_at: string;
  updated_at: string;
};

/** Phase 21: "Build an App" projects, specifications and generated files. */
export type AppProjectStatus = "intake" | "spec_draft" | "spec_approved" | "generated";
export type AppGenerationStatus = "none" | "succeeded" | "failed";

export type AppProject = {
  id: string;
  user_id: string;
  name: string;
  purpose: string;
  target_users: string;
  workflows: string;
  required_pages: string;
  entities: string;
  auth_requirements: "supabase" | "none";
  integrations: string;
  design_preferences: string;
  definition_of_done: string;
  stack: "nextjs-typescript-tailwind";
  status: AppProjectStatus;
  current_version: number;
  last_generation_status: AppGenerationStatus;
  last_generation_note: string | null;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppSpecRecord = {
  id: string;
  project_id: string;
  user_id: string;
  version: number;
  spec: import("@/lib/app-builder").AppSpec;
  approved_at: string | null;
  created_at: string;
};

export type AppFile = {
  id: string;
  project_id: string;
  user_id: string;
  path: string;
  content: string;
  updated_at: string;
};

export type AppVersion = {
  id: string;
  project_id: string;
  user_id: string;
  version: number;
  summary: string;
  files: { path: string; content: string }[];
  created_at: string;
};

export type AppIntegrationStatus = "draft" | "connected" | "error" | "disconnected";
export type AppIntegrationTestStatus = "never" | "passed" | "failed";

export type AppDesignProfile = {
  id: string;
  project_id: string;
  user_id: string;
  brief: string;
  config: import("@/lib/design").DesignConfig;
  created_at: string;
  updated_at: string;
};

export type AppDesignAsset = {
  id: string;
  project_id: string;
  user_id: string;
  kind: "screenshot" | "wireframe" | "asset";
  name: string;
  mime: "image/png" | "image/jpeg" | "image/webp";
  bytes: number;
  sha256: string;
  content_base64: string;
  attribution: string;
  license_note: string;
  permission_confirmed: boolean;
  created_at: string;
};

export type AppDesignVersion = {
  id: string;
  project_id: string;
  user_id: string;
  version: number;
  config: import("@/lib/design").DesignConfig;
  summary: string;
  diff: string;
  created_at: string;
};

export type AppIntegration = {
  id: string;
  project_id: string;
  user_id: string;
  kind: "openapi_http" | "postgres";
  name: string;
  status: AppIntegrationStatus;
  config: import("@/lib/integrations/registry").IntegrationConfig;
  allowed_operations: string[];
  mapping: import("@/lib/integrations/registry").IntegrationMapping[];
  last_tested_at: string | null;
  last_test_status: AppIntegrationTestStatus;
  last_test_note: string | null;
  connected_at: string | null;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppWorkspaceStatus =
  | "stopped"
  | "checking"
  | "checks_passed"
  | "checks_failed"
  | "preview"
  | "failed"
  | "canceled"
  | "expired";

export type AppWorkspace = {
  id: string;
  project_id: string;
  user_id: string;
  runner_key: string | null;
  status: AppWorkspaceStatus;
  started_at: string;
  expires_at: string | null;
  last_error: string | null;
  iterations: number;
  ai_requests: number;
  /** Maximum AI credits this workspace may spend. */
  credit_budget: number;
  /** Credits reserved or spent by repairs in this workspace. */
  credits_spent: number;
  created_at: string;
  updated_at: string;
};

export type AppWorkspaceRun = {
  id: string;
  workspace_id: string;
  project_id: string;
  user_id: string;
  kind: "checks" | "repair" | "preview" | "stop";
  status: "passed" | "failed" | "timed_out" | "skipped" | "canceled" | "error";
  iteration: number;
  checks: {
    name: string;
    label: string;
    status: "passed" | "failed" | "timed_out" | "skipped";
    code: number | null;
    log: string;
  }[];
  log: string;
  changed_files: string[];
  diff: string;
  ai_requests: number;
  error: string | null;
  created_at: string;
};

export type AppProvider = "github" | "vercel" | "supabase";

export type SupabaseAccountConnection = {
  id: string;
  user_id: string;
  status: "connected" | "error" | "revoked";
  account_label: string;
  scopes: string;
  expires_at: string | null;
  connected_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppProviderConnection = {
  id: string;
  project_id: string;
  user_id: string;
  provider: AppProvider;
  status: "connected" | "revoked" | "error";
  account_label: string;
  external_ref: string;
  scope_label: string;
  metadata: Record<string, unknown>;
  connected_at: string;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
};

export type AppEnvValue = {
  id: string;
  project_id: string;
  user_id: string;
  environment: "preview" | "production";
  name: string;
  visibility: "public" | "server";
  created_at: string;
  updated_at: string;
};

export type AppDeployment = {
  id: string;
  project_id: string;
  user_id: string;
  target: "preview" | "production";
  snapshot_version: number;
  snapshot_digest: string;
  plan: import("@/lib/deployments").DeploymentPlan;
  plan_hash: string;
  status: import("@/lib/deployments").DeploymentStatus;
  checks: {
    name: string;
    label: string;
    status: "passed" | "failed" | "timed_out" | "skipped";
    code: number | null;
    detail?: string;
  }[];
  approval_at: string | null;
  source_commit: string | null;
  external_deployment_id: string | null;
  deployment_url: string | null;
  migration_state: string;
  error: string | null;
  partial_failure: string | null;
  created_at: string;
  updated_at: string;
};

export type AppDeploymentEvent = {
  id: string;
  deployment_id: string;
  project_id: string;
  user_id: string;
  kind: string;
  detail: string;
  created_at: string;
};

export type ProjectMemoryRecord = {
  id: string;
  project_id: string;
  user_id: string;
  kind: import("@/lib/improvements").MemoryKind;
  title: string;
  body: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type AppChangeRequest = {
  id: string;
  project_id: string;
  user_id: string;
  kind: import("@/lib/improvements").ChangeKind;
  request: string;
  answers: string;
  status: import("@/lib/improvements").ChangeStatus;
  automation_level: number;
  base_version: number;
  base_digest: string;
  inspection: import("@/lib/improvements").ProjectInspection;
  questions: string[];
  plan: import("@/lib/improvements").ChangePlan;
  diff: string;
  checks: { name: string; label: string; status: string; code: number | null; log?: string }[];
  preview_url: string | null;
  runner_key: string | null;
  error: string | null;
  merged_version: number | null;
  created_at: string;
  updated_at: string;
};

export type AppSkill = {
  id: string;
  project_id: string;
  user_id: string;
  source_change_id: string | null;
  name: string;
  version: number;
  purpose: string;
  stack: string;
  required_permissions: string[];
  inputs: string[];
  expected_outputs: string[];
  tests: string[];
  limitations: string[];
  status: "verified" | "archived";
  created_at: string;
};

export type AppObservabilitySettings = {
  id: string;
  project_id: string;
  user_id: string;
  enabled: boolean;
  release_label: string;
  created_at: string;
  updated_at: string;
};

export type AppErrorEvent = {
  id: string;
  project_id: string;
  user_id: string;
  release_label: string;
  fingerprint: string;
  message: string;
  detail: string;
  redactions: number;
  status: "new" | "repair_proposed" | "dismissed";
  change_id: string | null;
  created_at: string;
};

export type AppChangeEvaluation = {
  change_id: string;
  project_id: string;
  user_id: string;
  accepted: boolean;
  rejected: boolean;
  tests_passed: boolean;
  regression_count: number;
  runtime_seconds: number;
  ai_calls: number;
  created_at: string;
};

export const TASK_STATUSES: TaskStatus[] = ["todo", "in_progress", "completed"];

export const GOAL_CATEGORY_SLUGS: GoalCategory[] = [
  "launch",
  "job",
  "content",
  "learn",
  "personal",
  "business",
];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  completed: "Completed",
};
