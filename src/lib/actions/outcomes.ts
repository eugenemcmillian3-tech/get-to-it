"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { OutcomeState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import {
  assessmentSchema,
  buildExpectationSnapshot,
  forecastResolutionSchema,
  forecastSchema,
  improvementBlockers,
  improvementSchema,
  isReviewComplete,
  nextVersionNumber,
  observationSchema,
  outcomeReviewSchema,
  rollbackPlan,
} from "@/lib/outcomes";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";
import type { ImprovementArea } from "@/lib/types";

/**
 * Phase 20 actions.
 *
 * Every write is owner-scoped by RLS and by an explicit `user_id` filter. No
 * action edits a snapshot or an earlier observation, and no action changes a
 * shipped prompt, permission or safety rule. Nothing here calls a model.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That review isn't available to you.";

function fail(message: string): OutcomeState {
  return { status: "error", message, nonce: Date.now() };
}

function done(message: string): OutcomeState {
  return { status: "success", message, nonce: Date.now() };
}

function refresh(reviewId?: string): void {
  revalidatePath("/outcomes");
  if (reviewId) revalidatePath(`/outcomes/${reviewId}`);
}

async function ownsReview(
  session: Awaited<ReturnType<typeof getSession>>,
  reviewId: string,
): Promise<boolean> {
  if (!session) return false;
  const { data } = await session.supabase
    .from("outcome_reviews")
    .select("id")
    .eq("id", reviewId)
    .eq("user_id", session.user.id)
    .maybeSingle();
  return Boolean(data);
}

/**
 * Captures the expectation from one earlier record and opens a review.
 *
 * The snapshot is built once and stored; the review never re-reads the source
 * afterwards, so editing a goal or a future path cannot change what it expected.
 */
export async function createOutcomeReviewAction(
  _previous: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const source = readText(formData, "source");
  const [kind, id] = source.split(":");
  if (!isUuid(id ?? "")) return fail("Choose a goal, future path or review to look back on.");

  const parsed = outcomeReviewSchema.safeParse({
    source_kind: kind,
    source_id: id,
    review_at: readText(formData, "review_at"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  const capturedAt = new Date().toISOString();
  let snapshotTitle = "";

  if (input.source_kind === "goal") {
    const { data: goal, error } = await session.supabase
      .from("goals")
      .select("title, desired_outcome, deadline, created_at")
      .eq("id", input.source_id)
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error || !goal) return fail("That goal isn't one of yours.");

    const snapshot = buildExpectationSnapshot(
      {
        kind: "goal",
        goal: {
          title: goal.title as string,
          desired_outcome: goal.desired_outcome as string,
          deadline: (goal.deadline as string | null) ?? null,
          created_at: goal.created_at as string,
        },
      },
      capturedAt,
    );
    snapshotTitle = snapshot.title;

    const result = await insertReview(session, input, snapshot);
    if (!result.ok) return result.state;
    refresh(result.id);
    redirect(`/outcomes/${result.id}`);
  }

  if (input.source_kind === "future_path") {
    const { data: path, error } = await session.supabase
      .from("future_paths")
      .select("decision, chosen_kind, rationale, review_at, created_at")
      .eq("id", input.source_id)
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error || !path) return fail("That future path isn't one of yours.");

    let scenario: { title: string; assumptions: string[] } | null = null;

    if (path.chosen_kind) {
      const { data: scenarioRow } = await session.supabase
        .from("future_scenarios")
        .select("title, assumptions")
        .eq("path_id", input.source_id)
        .eq("kind", path.chosen_kind)
        .maybeSingle();

      if (scenarioRow) {
        const assumptions = Array.isArray(scenarioRow.assumptions)
          ? (scenarioRow.assumptions as { text?: string }[]).map((item) =>
              typeof item === "string" ? item : (item.text ?? ""),
            )
          : [];
        scenario = {
          title: scenarioRow.title as string,
          assumptions: assumptions.filter((text) => text.trim() !== ""),
        };
      }
    }

    const snapshot = buildExpectationSnapshot(
      {
        kind: "future_path",
        path: {
          decision: path.decision as string,
          chosen_kind: (path.chosen_kind as string | null) ?? null,
          rationale: (path.rationale as string | null) ?? null,
          review_at: (path.review_at as string | null) ?? null,
          created_at: path.created_at as string,
        },
        scenario,
      },
      capturedAt,
    );
    snapshotTitle = snapshot.title;

    const result = await insertReview(session, input, snapshot);
    if (!result.ok) return result.state;
    refresh(result.id);
    redirect(`/outcomes/${result.id}`);
  }

  const { data: review, error } = await session.supabase
    .from("reviews")
    .select("question, chosen_option, decision, rejected_recommendation, created_at")
    .eq("id", input.source_id)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error || !review) return fail("That review isn't one of yours.");

  const snapshot = buildExpectationSnapshot(
    {
      kind: "review",
      review: {
        question: review.question as string,
        chosen_option: (review.chosen_option as string | null) ?? null,
        decision: (review.decision as string | null) ?? null,
        rejected_recommendation: Boolean(review.rejected_recommendation),
        created_at: review.created_at as string,
      },
    },
    capturedAt,
  );
  snapshotTitle = snapshot.title;

  const result = await insertReview(session, input, snapshot);
  if (!result.ok) return result.state;

  void snapshotTitle;
  refresh(result.id);
  redirect(`/outcomes/${result.id}`);
}

type InsertResult =
  | { ok: true; id: string }
  | { ok: false; state: OutcomeState };

async function insertReview(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  input: { source_kind: string; source_id: string; review_at: string },
  snapshot: ReturnType<typeof buildExpectationSnapshot>,
): Promise<InsertResult> {
  const { data, error } = await session.supabase
    .from("outcome_reviews")
    .insert({
      user_id: session.user.id,
      source_kind: input.source_kind,
      source_id: input.source_id,
      title: snapshot.title.slice(0, 200),
      expectation_snapshot: snapshot,
      review_at: input.review_at === "" ? null : input.review_at,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.code === "23505") {
      const { data: existing } = await session.supabase
        .from("outcome_reviews")
        .select("id")
        .eq("user_id", session.user.id)
        .eq("source_kind", input.source_kind)
        .eq("source_id", input.source_id)
        .maybeSingle();

      if (existing) {
        refresh(existing.id as string);
        redirect(`/outcomes/${existing.id}`);
      }
    }

    console.error("createOutcomeReviewAction failed:", error?.message);
    return { ok: false, state: fail("We couldn't start that review. Nothing changed.") };
  }

  return { ok: true, id: data.id as string };
}

export async function addObservationAction(
  _previous: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = observationSchema.safeParse({
    review_id: readText(formData, "review_id"),
    kind: readText(formData, "kind"),
    text: readText(formData, "text"),
    verdict: readText(formData, "verdict"),
    causation_note: readText(formData, "causation_note"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  if (!(await ownsReview(session, input.review_id))) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase.from("outcome_observations").insert({
    review_id: input.review_id,
    user_id: session.user.id,
    kind: input.kind,
    text: input.text,
    verdict: input.kind === "assumption" ? input.verdict : null,
    causation_note: input.causation_note === "" ? null : input.causation_note,
  });

  if (error) {
    console.error("addObservationAction failed:", error.message);
    return fail("We couldn't append that note. Nothing changed.");
  }

  refresh(input.review_id);
  return done("Appended to the record. Earlier notes were not changed.");
}

export async function saveAssessmentAction(
  _previous: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = assessmentSchema.safeParse({
    review_id: readText(formData, "review_id"),
    action_completed: readText(formData, "action_completed"),
    desired_result: readText(formData, "desired_result"),
    expectation_accuracy: readText(formData, "expectation_accuracy"),
    external_conditions: readText(formData, "external_conditions"),
    causation_note: readText(formData, "causation_note"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  if (!(await ownsReview(session, input.review_id))) return fail(NOT_AVAILABLE);

  const complete = isReviewComplete(input);

  const { error } = await session.supabase
    .from("outcome_reviews")
    .update({
      action_completed: input.action_completed,
      desired_result: input.desired_result,
      expectation_accuracy: input.expectation_accuracy,
      external_conditions: input.external_conditions,
      causation_note: input.causation_note === "" ? null : input.causation_note,
      status: complete ? "completed" : "open",
      completed_at: complete ? new Date().toISOString() : null,
    })
    .eq("id", input.review_id)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("saveAssessmentAction failed:", error.message);
    return fail("We couldn't save that assessment. Nothing changed.");
  }

  refresh(input.review_id);
  return done(
    complete
      ? "Assessment saved. The four answers stay separate; none of them implies another."
      : "Saved so far. Answer all four to mark the review complete.",
  );
}

export async function addForecastAction(
  _previous: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = forecastSchema.safeParse({
    review_id: readText(formData, "review_id"),
    statement: readText(formData, "statement"),
    probability: readText(formData, "probability"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  if (!(await ownsReview(session, input.review_id))) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase.from("outcome_forecasts").insert({
    review_id: input.review_id,
    user_id: session.user.id,
    statement: input.statement,
    probability: Number(input.probability),
  });

  if (error) {
    console.error("addForecastAction failed:", error.message);
    return fail("We couldn't record that forecast. Nothing changed.");
  }

  refresh(input.review_id);
  return done(
    "Forecast recorded with your stated probability. It cannot be rewritten later.",
  );
}

export async function resolveForecastAction(
  _previous: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = forecastResolutionSchema.safeParse({
    review_id: readText(formData, "review_id"),
    forecast_id: readText(formData, "forecast_id"),
    resolution: readText(formData, "resolution"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;
  if (!(await ownsReview(session, input.review_id))) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase
    .from("outcome_forecasts")
    .update({
      resolution: input.resolution,
      resolved_at: input.resolution === "pending" ? null : new Date().toISOString(),
    })
    .eq("id", input.forecast_id)
    .eq("user_id", session.user.id)
    .eq("review_id", input.review_id);

  if (error) {
    console.error("resolveForecastAction failed:", error.message);
    return fail(
      "That forecast couldn't be changed. A resolved forecast stays resolved so the record stays honest.",
    );
  }

  refresh(input.review_id);
  return done("Forecast resolution recorded.");
}

export async function createImprovementAction(
  _previous: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = improvementSchema.safeParse({
    area: readText(formData, "area"),
    title: readText(formData, "title"),
    rationale: readText(formData, "rationale"),
    change_text: readText(formData, "change_text"),
    consent_confirmed: readText(formData, "consent_confirmed") === "yes",
    test_scope: readText(formData, "test_scope"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const blockers = improvementBlockers({
    consentConfirmed: parsed.data.consent_confirmed,
    testScope: parsed.data.test_scope,
  });
  if (blockers.length > 0) return fail(blockers.join(" "));

  const { error } = await session.supabase.from("improvement_proposals").insert({
    user_id: session.user.id,
    area: parsed.data.area,
    title: parsed.data.title,
    rationale: parsed.data.rationale,
    change_text: parsed.data.change_text,
    consent_confirmed: true,
    test_scope: parsed.data.test_scope,
  });

  if (error) {
    console.error("createImprovementAction failed:", error.message);
    return fail("We couldn't save that proposal. Nothing changed.");
  }

  revalidatePath("/outcomes");
  return done(
    "Proposal recorded. Nothing changed in the app, and no private content is used for training.",
  );
}

export async function approveImprovementAction(
  _previous: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const proposalId = readText(formData, "proposal_id");
  if (!isUuid(proposalId)) return fail(NOT_AVAILABLE);

  const { data: proposal } = await session.supabase
    .from("improvement_proposals")
    .select("id, area, title, change_text, status")
    .eq("id", proposalId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!proposal) return fail(NOT_AVAILABLE);
  if (proposal.status !== "proposed") return fail("That proposal has already been decided.");

  const { data: versions, error: versionsError } = await session.supabase
    .from("improvement_versions")
    .select("id, area, version, status")
    .eq("user_id", session.user.id)
    .eq("area", proposal.area);

  if (versionsError) {
    console.error("approveImprovementAction versions failed:", versionsError.message);
    return fail("We couldn't check earlier versions. Nothing changed.");
  }

  const area = proposal.area as ImprovementArea;
  const rows = (versions ?? []) as { id: string; area: ImprovementArea; version: number; status: string }[];
  const current = rows.find((row) => row.status === "active");
  const version = nextVersionNumber(
    rows as { area: ImprovementArea; version: number }[],
    area,
  );

  const { error: insertError } = await session.supabase.from("improvement_versions").insert({
    user_id: session.user.id,
    proposal_id: proposalId,
    area,
    version,
    content: proposal.change_text as string,
    status: "active",
  });

  if (insertError) {
    console.error("approveImprovementAction insert failed:", insertError.message);
    return fail("We couldn't create that version. Nothing changed.");
  }

  if (current) {
    await session.supabase
      .from("improvement_versions")
      .update({ status: "superseded" })
      .eq("id", current.id)
      .eq("user_id", session.user.id);
  }

  await session.supabase
    .from("improvement_proposals")
    .update({ status: "approved" })
    .eq("id", proposalId)
    .eq("user_id", session.user.id);

  revalidatePath("/outcomes");
  return done(
    `Approved as version ${version} of ${area.replace(/_/g, " ")}. The app's shipped prompts are unchanged; the previous version can be restored.`,
  );
}

export async function rejectImprovementAction(
  _previous: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const proposalId = readText(formData, "proposal_id");
  if (!isUuid(proposalId)) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase
    .from("improvement_proposals")
    .update({ status: "rejected" })
    .eq("id", proposalId)
    .eq("user_id", session.user.id)
    .eq("status", "proposed");

  if (error) {
    console.error("rejectImprovementAction failed:", error.message);
    return fail("We couldn't record that decision. Nothing changed.");
  }

  revalidatePath("/outcomes");
  return done("Proposal rejected and kept for the record.");
}

export async function rollbackImprovementAction(
  _previous: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const proposalId = readText(formData, "proposal_id");
  if (!isUuid(proposalId)) return fail(NOT_AVAILABLE);

  const { data: proposal } = await session.supabase
    .from("improvement_proposals")
    .select("id, area, status")
    .eq("id", proposalId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (!proposal) return fail(NOT_AVAILABLE);

  const area = proposal.area as ImprovementArea;

  const { data: versions, error } = await session.supabase
    .from("improvement_versions")
    .select("id, area, version, status")
    .eq("user_id", session.user.id)
    .eq("area", area);

  if (error) {
    console.error("rollbackImprovementAction versions failed:", error.message);
    return fail("We couldn't check versions. Nothing changed.");
  }

  const plan = rollbackPlan(
    (versions ?? []) as { id: string; area: ImprovementArea; version: number; status: "active" | "superseded" | "rolled_back" }[],
    area,
  );

  if (!plan) return fail("There is no active version to roll back.");

  const { error: rollbackError } = await session.supabase
    .from("improvement_versions")
    .update({ status: "rolled_back", rolled_back_at: new Date().toISOString() })
    .eq("id", plan.rollbackId)
    .eq("user_id", session.user.id);

  if (rollbackError) {
    console.error("rollbackImprovementAction failed:", rollbackError.message);
    return fail("We couldn't roll that back. Nothing changed.");
  }

  if (plan.restoreId) {
    await session.supabase
      .from("improvement_versions")
      .update({ status: "active" })
      .eq("id", plan.restoreId)
      .eq("user_id", session.user.id);
  }

  await session.supabase
    .from("improvement_proposals")
    .update({ status: "rolled_back" })
    .eq("id", proposalId)
    .eq("user_id", session.user.id);

  revalidatePath("/outcomes");
  return done(
    plan.restoreVersion
      ? `Rolled back version ${plan.rollbackVersion}; version ${plan.restoreVersion} is the active record again.`
      : `Rolled back version ${plan.rollbackVersion}. No earlier version exists to restore.`,
  );
}

export async function deleteOutcomeReviewAction(
  _previous: OutcomeState,
  formData: FormData,
): Promise<OutcomeState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const reviewId = readText(formData, "review_id");
  if (!isUuid(reviewId)) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase
    .from("outcome_reviews")
    .delete()
    .eq("id", reviewId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("deleteOutcomeReviewAction failed:", error.message);
    return fail("We couldn't delete that review. Nothing changed.");
  }

  revalidatePath("/outcomes");
  redirect("/outcomes");
}
