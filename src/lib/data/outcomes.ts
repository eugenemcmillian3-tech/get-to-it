import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  ImprovementProposal,
  ImprovementVersion,
  OutcomeForecast,
  OutcomeObservation,
  OutcomeReview,
} from "@/lib/types";

/**
 * Outcome reads.
 *
 * Everything here is owner-scoped by RLS and by an explicit `user_id` filter.
 * A review snapshot is read from its own row, never rebuilt from the goal,
 * future path or review it came from, so a later edit to the source cannot
 * change what the past expected.
 */

const LOAD_ERROR =
  "We couldn't load those outcomes just now. Refresh the page to try again.";

export async function listOutcomeReviews(session: Session): Promise<OutcomeReview[]> {
  const { data, error } = await session.supabase
    .from("outcome_reviews")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("listOutcomeReviews failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return (data ?? []) as OutcomeReview[];
}

export type OutcomeDetail = {
  review: OutcomeReview;
  observations: OutcomeObservation[];
  forecasts: OutcomeForecast[];
  proposals: ImprovementProposal[];
  versions: ImprovementVersion[];
};

export async function getOutcomeDetail(
  session: Session,
  reviewId: string,
): Promise<OutcomeDetail | null> {
  const { data: review, error } = await session.supabase
    .from("outcome_reviews")
    .select("*")
    .eq("id", reviewId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getOutcomeDetail review failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!review) return null;

  const [observations, forecasts, proposals, versions] = await Promise.all([
    session.supabase
      .from("outcome_observations")
      .select("*")
      .eq("review_id", reviewId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true }),
    session.supabase
      .from("outcome_forecasts")
      .select("*")
      .eq("review_id", reviewId)
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: true }),
    session.supabase
      .from("improvement_proposals")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    session.supabase
      .from("improvement_versions")
      .select("*")
      .eq("user_id", session.user.id)
      .order("area", { ascending: true })
      .order("version", { ascending: false }),
  ]);

  for (const result of [observations, forecasts, proposals, versions]) {
    if (result.error) {
      console.error("getOutcomeDetail child failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  return {
    review: review as OutcomeReview,
    observations: (observations.data ?? []) as OutcomeObservation[],
    forecasts: (forecasts.data ?? []) as OutcomeForecast[],
    proposals: (proposals.data ?? []) as ImprovementProposal[],
    versions: (versions.data ?? []) as ImprovementVersion[],
  };
}

export type ImprovementRecords = {
  proposals: ImprovementProposal[];
  versions: ImprovementVersion[];
};

export async function listImprovements(
  session: Session,
): Promise<ImprovementRecords> {
  const [proposals, versions] = await Promise.all([
    session.supabase
      .from("improvement_proposals")
      .select("*")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(50),
    session.supabase
      .from("improvement_versions")
      .select("*")
      .eq("user_id", session.user.id)
      .order("area", { ascending: true })
      .order("version", { ascending: false }),
  ]);

  for (const result of [proposals, versions]) {
    if (result.error) {
      console.error("listImprovements failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  return {
    proposals: (proposals.data ?? []) as ImprovementProposal[],
    versions: (versions.data ?? []) as ImprovementVersion[],
  };
}

export type OutcomeCandidate = {
  id: string;
  title: string;
  detail: string;
  reviewAt: string | null;
};

export type OutcomeCandidates = {
  goals: OutcomeCandidate[];
  paths: OutcomeCandidate[];
  reviews: OutcomeCandidate[];
};

/**
 * What can be reviewed. Only the person's own goals, future paths and reviews
 * are offered: workspace missions stay inside their workspace and are never
 * copied into a personal record.
 */
export async function listOutcomeCandidates(
  session: Session,
): Promise<OutcomeCandidates> {
  const [goals, paths, reviews] = await Promise.all([
    session.supabase
      .from("goals")
      .select("id, title, desired_outcome, deadline, created_at")
      .eq("user_id", session.user.id)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .limit(25),
    session.supabase
      .from("future_paths")
      .select("id, decision, chosen_kind, review_at, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(25),
    session.supabase
      .from("reviews")
      .select("id, question, chosen_option, decision, created_at")
      .eq("user_id", session.user.id)
      .order("created_at", { ascending: false })
      .limit(25),
  ]);

  for (const result of [goals, paths, reviews]) {
    if (result.error) {
      console.error("listOutcomeCandidates failed:", result.error.message);
      throw new DataError(LOAD_ERROR);
    }
  }

  return {
    goals: (goals.data ?? []).map((goal) => ({
      id: goal.id as string,
      title: goal.title as string,
      detail: goal.desired_outcome as string,
      reviewAt: (goal.deadline as string | null) ?? null,
    })),
    paths: (paths.data ?? []).map((path) => ({
      id: path.id as string,
      title: path.decision as string,
      detail: path.chosen_kind ? `Chosen scenario: ${path.chosen_kind}` : "No scenario chosen",
      reviewAt: (path.review_at as string | null) ?? null,
    })),
    reviews: (reviews.data ?? []).map((review) => ({
      id: review.id as string,
      title: review.question as string,
      detail:
        (review.decision as string | null) ??
        (review.chosen_option as string | null) ??
        "No decision saved",
      reviewAt: null,
    })),
  };
}
