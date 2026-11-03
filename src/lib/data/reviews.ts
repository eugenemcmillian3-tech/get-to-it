import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type { Review, ReviewStageRecord } from "@/lib/types";

/**
 * Review reads. Every query is owner-scoped by RLS and by an explicit
 * `user_id` filter, and a review never reads tasks, goals or another person's
 * records.
 */

const LOAD_ERROR =
  "We couldn't load that review just now. Refresh the page to try again.";

export async function listReviews(session: Session): Promise<Review[]> {
  const { data, error } = await session.supabase
    .from("reviews")
    .select("*")
    .eq("user_id", session.user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) {
    console.error("listReviews failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return (data ?? []) as Review[];
}

export type ReviewDetail = {
  review: Review;
  stages: ReviewStageRecord[];
};

export async function getReviewDetail(
  session: Session,
  reviewId: string,
): Promise<ReviewDetail | null> {
  const { data: review, error } = await session.supabase
    .from("reviews")
    .select("*")
    .eq("id", reviewId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (error) {
    console.error("getReviewDetail failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (!review) return null;

  const { data: stages, error: stagesError } = await session.supabase
    .from("review_stages")
    .select("*")
    .eq("review_id", reviewId)
    .eq("user_id", session.user.id)
    .order("position", { ascending: true });

  if (stagesError) {
    console.error("getReviewDetail stages failed:", stagesError.message);
    throw new DataError(LOAD_ERROR);
  }

  return {
    review: review as Review,
    stages: (stages ?? []) as ReviewStageRecord[],
  };
}
