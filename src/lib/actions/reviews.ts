"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ReviewState } from "@/lib/action-state";
import { finishAiRequest, reserveAiRequest } from "@/lib/ai/limits";
import { DEFAULT_AI_MODEL, isAiModel } from "@/lib/ai/models";
import { chatWithOllama, ollamaErrorMessage } from "@/lib/ai/ollama";
import { getSession } from "@/lib/auth";
import { getReviewDetail } from "@/lib/data/reviews";
import {
  PERSPECTIVES,
  PERSPECTIVE_LABELS,
  allowedSourceUrls,
  buildPerspectiveMessages,
  canRunStage,
  isTerminalReviewStatus,
  parsePerspectiveReply,
  parsePriorities,
  parseSources,
  perspectiveErrorMessage,
  reviewInputSchema,
  reviewOutcomeSchema,
  reviewStatusFor,
  type OutputParseResult,
  type Perspective,
  type PriorOutput,
  type ReviewStageOutput,
} from "@/lib/reviews";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";
import type { ReviewStageRecord } from "@/lib/types";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That review isn't available to you.";
const UNUSABLE =
  "That reply wasn't usable, so this perspective is marked failed. Earlier answers are unchanged and you can run a later perspective.";
const STAGE_TIMEOUT_MS = 60_000;

function fail(message: string, remaining?: number): ReviewState {
  return { status: "error", message, remaining, nonce: Date.now() };
}

function refresh(reviewId?: string): void {
  revalidatePath("/reviews");
  if (reviewId) revalidatePath(`/reviews/${reviewId}`);
}

/** Rebuilds a saved stage into the shape the next prompt expects. */
function outputOf(stage: ReviewStageRecord): ReviewStageOutput {
  return {
    summary: stage.summary ?? "",
    assumptions: stage.assumptions ?? [],
    options: stage.options ?? [],
    evidence: (stage.evidence ?? []).map((item) => ({
      text: item.text,
      basis: item.basis as ReviewStageOutput["evidence"][number]["basis"],
      source_url: item.source_url,
    })),
    counterarguments: stage.counterarguments ?? [],
    disagreements: stage.disagreements ?? [],
    missing_info: stage.missing_info ?? [],
    experiment: stage.experiment ?? null,
    questions: stage.questions ?? [],
    tradeoffs: stage.tradeoffs ?? [],
    recommendation: stage.recommendation,
  };
}

function nextPending(stages: ReviewStageRecord[]): ReviewStageRecord | null {
  return (
    [...stages]
      .sort((a, b) => a.position - b.position)
      .find((stage) => stage.status === "pending") ?? null
  );
}

/**
 * Creates a review and its five pending stage rows. No model is called here:
 * the person starts each perspective themselves, so the five-request cost is
 * visible before anything is spent.
 */
export async function createReviewAction(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const priorities = parsePriorities(readText(formData, "priorities"));
  const parsedSources = parseSources(readText(formData, "sources"));

  if (parsedSources.invalid.length > 0) {
    return fail(
      `These sources aren't full http or https links, so nothing was saved: ${parsedSources.invalid
        .map((line) => `“${line}”`)
        .join(", ")}.`,
    );
  }

  const parsed = reviewInputSchema.safeParse({
    question: readText(formData, "question"),
    context: readText(formData, "context"),
    constraints: readText(formData, "constraints"),
    priorities,
    sources: parsedSources.sources,
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  if (readText(formData, "acknowledge") !== "yes") {
    return fail(
      "Confirm that you understand this review can make up to five AI requests before it starts.",
    );
  }

  const requestedModel = readText(formData, "model");
  const model = isAiModel(requestedModel) ? requestedModel : DEFAULT_AI_MODEL;

  const { data: review, error } = await session.supabase
    .from("reviews")
    .insert({
      user_id: session.user.id,
      question: parsed.data.question,
      context: parsed.data.context,
      constraints: parsed.data.constraints,
      priorities: parsed.data.priorities,
      sources: parsed.data.sources,
      model,
      status: "in_progress",
      current_position: 0,
    })
    .select("id")
    .single();

  if (error || !review) {
    console.error("createReviewAction failed:", error?.message);
    return fail("We couldn't create that review. Try again.");
  }

  const reviewId = review.id as string;

  const { error: stagesError } = await session.supabase.from("review_stages").insert(
    PERSPECTIVES.map((perspective, index) => ({
      review_id: reviewId,
      user_id: session.user.id,
      perspective,
      position: index + 1,
      status: "pending",
    })),
  );

  if (stagesError) {
    console.error("createReviewAction stages failed:", stagesError.message);
    await session.supabase.from("reviews").delete().eq("id", reviewId);
    return fail("We couldn't set up the five perspectives, so nothing was kept.");
  }

  refresh(reviewId);
  redirect(`/reviews/${reviewId}`);
}

/**
 * Runs exactly one perspective, once.
 *
 * The stage is claimed with a conditional update, so a double click cannot make
 * two calls. A failure is recorded on the stage and the review moves to
 * `partial` or stays `in_progress`; earlier answers are never discarded. The
 * synthesizer is refused until at least one earlier perspective succeeded.
 */
export async function runNextPerspectiveAction(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const reviewId = readText(formData, "review_id");
  if (!isUuid(reviewId)) return fail(NOT_AVAILABLE);

  const detail = await getReviewDetail(session, reviewId);
  if (!detail) return fail(NOT_AVAILABLE);

  const { review, stages } = detail;

  if (review.cancel_requested_at || review.status === "cancelled") {
    return fail(perspectiveErrorMessage("cancelled"));
  }
  if (isTerminalReviewStatus(review.status)) {
    return fail(perspectiveErrorMessage("complete"));
  }

  const stage = nextPending(stages);
  if (!stage) {
    return fail(perspectiveErrorMessage("complete"));
  }

  const prior: PriorOutput[] = stages
    .filter(
      (entry) =>
        entry.status === "succeeded" &&
        entry.perspective !== "synthesizer" &&
        entry.summary !== null,
    )
    .map((entry) => ({ perspective: entry.perspective as Perspective, output: outputOf(entry) }));

  if (
    !canRunStage(
      review.status,
      stage.status,
      prior.length > 0,
      stage.perspective as Perspective,
    )
  ) {
    return fail(
      stage.perspective === "synthesizer"
        ? perspectiveErrorMessage("needs-context")
        : perspectiveErrorMessage("stage-done"),
    );
  }

  const claim = await session.supabase
    .from("review_stages")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", stage.id)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();

  if (claim.error) {
    console.error("runNextPerspectiveAction claim failed:", claim.error.message);
    return fail("We couldn't start that perspective. Nothing was sent.");
  }
  if (!claim.data) return fail(perspectiveErrorMessage("busy"));

  const reserved = await reserveAiRequest(session, "review", review.model);
  if (!reserved.ok) {
    await session.supabase
      .from("review_stages")
      .update({ status: "pending", started_at: null })
      .eq("id", stage.id);
    return fail(reserved.message);
  }

  const { id: requestId, remaining } = reserved.reservation;

  const input = {
    question: review.question,
    context: review.context,
    constraints: review.constraints,
    priorities: review.priorities,
    sources: review.sources,
  };

  let parsed: OutputParseResult;

  try {
    const reply = await chatWithOllama({
      model: review.model,
      messages: buildPerspectiveMessages(
        input,
        stage.perspective as Perspective,
        prior,
      ),
      temperature: 0.5,
      timeoutMs: STAGE_TIMEOUT_MS,
      format: "json",
    });

    parsed = parsePerspectiveReply(
      reply.content,
      allowedSourceUrls(review.sources),
      stage.perspective as Perspective,
    );

    if (parsed.kind === "invalid") {
      await finishAiRequest(session, requestId, "failed", parsed.reason);
      await failStage(session, review.id, stage, parsed.reason, stages);
      return fail(UNUSABLE, remaining);
    }

    await finishAiRequest(session, requestId, "succeeded", undefined, reply.tokens);
  } catch (error) {
    await finishAiRequest(session, requestId, "failed", "provider-error");
    await failStage(session, review.id, stage, "provider-error", stages);
    return fail(ollamaErrorMessage(error), remaining);
  }

  const output = parsed.output;

  const { error: stageError } = await session.supabase
    .from("review_stages")
    .update({
      status: "succeeded",
      summary: output.summary,
      assumptions: output.assumptions,
      options: output.options,
      evidence: output.evidence,
      counterarguments: output.counterarguments,
      disagreements: output.disagreements,
      missing_info: output.missing_info,
      experiment: output.experiment,
      questions: output.questions,
      tradeoffs: output.tradeoffs,
      recommendation: output.recommendation,
      error_code: null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", stage.id)
    .eq("user_id", session.user.id);

  if (stageError) {
    console.error("runNextPerspectiveAction stage update failed:", stageError.message);
    await failStage(session, review.id, stage, "save-failed", stages);
    return fail("The answer could not be saved, so this perspective is marked failed.");
  }

  const updated: ReviewStageRecord[] = stages.map((entry) =>
    entry.id === stage.id ? { ...entry, status: "succeeded" as const } : entry,
  );
  await settleReview(session, review.id, updated, stage.position);

  refresh(reviewId);
  return {
    status: "success",
    message: `${PERSPECTIVE_LABELS[stage.perspective as Perspective]} answered${
      parsed.adjustedSources > 0
        ? `; ${parsed.adjustedSources} unsupplied source ${parsed.adjustedSources === 1 ? "was" : "were"} removed and relabelled as an assumption`
        : ""
    }.`,
    remaining,
    nonce: Date.now(),
  };
}

async function failStage(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  reviewId: string,
  stage: ReviewStageRecord,
  code: string,
  stages: ReviewStageRecord[],
): Promise<void> {
  await session.supabase
    .from("review_stages")
    .update({
      status: "failed",
      error_code: code,
      finished_at: new Date().toISOString(),
    })
    .eq("id", stage.id);

  const updated: ReviewStageRecord[] = stages.map((entry) =>
    entry.id === stage.id ? { ...entry, status: "failed" as const } : entry,
  );
  await settleReview(session, reviewId, updated, stage.position);
}

/** Writes the review-level status implied by the stages, and finishes it. */
async function settleReview(
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>,
  reviewId: string,
  stages: ReviewStageRecord[],
  lastPosition: number,
): Promise<void> {
  const status = reviewStatusFor(false, stages);
  const terminal = isTerminalReviewStatus(status);

  await session.supabase
    .from("reviews")
    .update({
      status,
      current_position: Math.max(lastPosition, 0),
      finished_at: terminal ? new Date().toISOString() : null,
    })
    .eq("id", reviewId)
    // A review cancelled while a stage was in flight stays cancelled.
    .eq("status", "in_progress");
}

/**
 * Changes the priorities on the shared record.
 *
 * This applies to perspectives run from now on; answers already saved keep the
 * priorities they were given, because they are not rewritten after the fact.
 */
export async function updateReviewPrioritiesAction(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const reviewId = readText(formData, "review_id");
  if (!isUuid(reviewId)) return fail(NOT_AVAILABLE);

  const priorities = parsePriorities(readText(formData, "priorities"));

  const { error } = await session.supabase
    .from("reviews")
    .update({ priorities })
    .eq("id", reviewId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("updateReviewPrioritiesAction failed:", error.message);
    return fail("We couldn't change those priorities. Nothing changed.");
  }

  refresh(reviewId);
  return {
    status: "success",
    message:
      "Priorities updated for the perspectives you run next. Answers already saved keep the priorities they were given.",
    nonce: Date.now(),
  };
}

/**
 * Cancels between stages. Pending perspectives become skipped, and a stage that
 * is already running is left to finish rather than being reported as stopped.
 */
export async function cancelReviewAction(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const reviewId = readText(formData, "review_id");
  if (!isUuid(reviewId)) return fail(NOT_AVAILABLE);

  const detail = await getReviewDetail(session, reviewId);
  if (!detail) return fail(NOT_AVAILABLE);

  if (isTerminalReviewStatus(detail.review.status)) {
    return {
      status: "success",
      message: "This review has already finished, so nothing was cancelled.",
      nonce: Date.now(),
    };
  }

  const now = new Date().toISOString();

  const { error } = await session.supabase
    .from("reviews")
    .update({
      status: "cancelled",
      cancel_requested_at: now,
      finished_at: now,
    })
    .eq("id", reviewId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("cancelReviewAction failed:", error.message);
    return fail("We couldn't cancel that review. Nothing changed.");
  }

  await session.supabase
    .from("review_stages")
    .update({ status: "skipped", finished_at: now })
    .eq("review_id", reviewId)
    .eq("user_id", session.user.id)
    .eq("status", "pending");

  refresh(reviewId);
  return {
    status: "success",
    message:
      "Review cancelled. Finished perspectives stay readable, and no further requests will be made.",
    nonce: Date.now(),
  };
}

/**
 * Saves the person's own decision. The recommendation can be rejected and the
 * decision can ignore every option; nothing here argues or overwrites it later.
 */
export async function saveReviewOutcomeAction(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const reviewId = readText(formData, "review_id");
  if (!isUuid(reviewId)) return fail(NOT_AVAILABLE);

  const parsed = reviewOutcomeSchema.safeParse({
    chosen_option: readText(formData, "chosen_option"),
    decision: readText(formData, "decision"),
    rejected_recommendation: readText(formData, "rejected_recommendation") === "yes",
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const { error } = await session.supabase
    .from("reviews")
    .update({
      chosen_option:
        parsed.data.chosen_option.trim() === "" ? null : parsed.data.chosen_option.trim(),
      decision: parsed.data.decision.trim(),
      rejected_recommendation: parsed.data.rejected_recommendation,
      decided_at: new Date().toISOString(),
    })
    .eq("id", reviewId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("saveReviewOutcomeAction failed:", error.message);
    return fail("We couldn't save your decision. Nothing changed.");
  }

  refresh(reviewId);
  return {
    status: "success",
    message: "Your decision is saved. You can change it at any time.",
    nonce: Date.now(),
  };
}

export async function deleteReviewAction(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const reviewId = readText(formData, "review_id");
  if (!isUuid(reviewId)) return fail(NOT_AVAILABLE);

  const { error } = await session.supabase
    .from("reviews")
    .delete()
    .eq("id", reviewId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("deleteReviewAction failed:", error.message);
    return fail("We couldn't delete that review. Nothing changed.");
  }

  revalidatePath("/reviews");
  redirect("/reviews");
}
