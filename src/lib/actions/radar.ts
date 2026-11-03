"use server";

import { revalidatePath } from "next/cache";
import type { RadarState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { getRadarSignal } from "@/lib/data/radar";
import {
  dedupeKey,
  kindLabel,
  learningGoalOutcome,
  learningGoalTitle,
  parseTopicSelection,
  preparationTaskInstructions,
  preparationTaskTitle,
  publishedOnProblem,
  signalInputSchema,
  sourceUrlProblem,
  topicLabel,
  RADAR_TOPIC_SLUGS,
} from "@/lib/radar";
import { firstErrorMessage, isUuid, readText } from "@/lib/validation";

/**
 * Phase 18 actions.
 *
 * Nothing here performs a network request, reads a feed or touches a third
 * party. A signal exists because a person typed it after reading a source. The
 * only writes that create other records are the two preparation actions, and
 * each of those runs only when its own button is pressed.
 */

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That signal isn't one of yours.";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function fail(message: string): RadarState {
  return { status: "error", message, nonce: Date.now() };
}

function done(message: string): RadarState {
  return { status: "success", message, nonce: Date.now() };
}

function refresh(): void {
  revalidatePath("/radar");
}

/** Opting in and out of topics. Unticking a topic removes the opt-in only. */
export async function saveTopicsAction(
  _previous: RadarState,
  formData: FormData,
): Promise<RadarState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const selected = parseTopicSelection(formData.getAll("topics").map(String));
  const removed = RADAR_TOPIC_SLUGS.filter((topic) => !selected.includes(topic));

  if (removed.length > 0) {
    const { error } = await session.supabase
      .from("radar_topics")
      .delete()
      .eq("user_id", session.user.id)
      .in("topic", removed);

    if (error) {
      console.error("saveTopicsAction delete failed:", error.message);
      return fail("We couldn't change those topics. Nothing changed.");
    }
  }

  if (selected.length > 0) {
    const { error } = await session.supabase.from("radar_topics").upsert(
      selected.map((topic) => ({ user_id: session.user.id, topic })),
      { onConflict: "user_id,topic", ignoreDuplicates: true },
    );

    if (error) {
      console.error("saveTopicsAction upsert failed:", error.message);
      return fail("We couldn't save those topics. Nothing changed.");
    }
  }

  refresh();
  return done(
    selected.length === 0
      ? "No topics followed. The radar is off, and nothing new will appear."
      : `Following ${selected.length} ${selected.length === 1 ? "topic" : "topics"}. Nothing is fetched; you still add each signal yourself.`,
  );
}

/** Muting hides a followed topic's signals without unfollowing or deleting them. */
export async function muteTopicAction(
  _previous: RadarState,
  formData: FormData,
): Promise<RadarState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const topic = readText(formData, "topic").trim();
  const intent = readText(formData, "intent");
  if (!RADAR_TOPIC_SLUGS.includes(topic as (typeof RADAR_TOPIC_SLUGS)[number])) {
    return fail("That topic isn't one of the six.");
  }

  const { error } = await session.supabase
    .from("radar_topics")
    .update({ muted_at: intent === "mute" ? new Date().toISOString() : null })
    .eq("user_id", session.user.id)
    .eq("topic", topic);

  if (error) {
    console.error("muteTopicAction failed:", error.message);
    return fail("We couldn't change that topic. Nothing changed.");
  }

  refresh();
  return done(
    intent === "mute"
      ? `${topicLabel(topic)} is muted. Its signals are hidden; nothing was deleted.`
      : `${topicLabel(topic)} is unmuted again.`,
  );
}

/** Records one signal from a source the person read. No fetch, no AI request. */
export async function addSignalAction(
  _previous: RadarState,
  formData: FormData,
): Promise<RadarState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = signalInputSchema.safeParse({
    topic: readText(formData, "topic"),
    kind: readText(formData, "kind"),
    headline: readText(formData, "headline"),
    source_name: readText(formData, "source_name"),
    source_url: readText(formData, "source_url"),
    published_on: readText(formData, "published_on"),
    geography: readText(formData, "geography"),
    sector: readText(formData, "sector"),
    uncertainty: readText(formData, "uncertainty"),
    goal_id: readText(formData, "goal_id"),
  });

  if (!parsed.success) return fail(firstErrorMessage(parsed.error));

  const input = parsed.data;

  const linkProblem = sourceUrlProblem(input.source_url);
  if (linkProblem) return fail(linkProblem);

  const dateProblem = publishedOnProblem(input.published_on, todayIso());
  if (dateProblem) return fail(dateProblem);

  const { data: followed, error: topicError } = await session.supabase
    .from("radar_topics")
    .select("topic")
    .eq("user_id", session.user.id)
    .eq("topic", input.topic)
    .maybeSingle();

  if (topicError) {
    console.error("addSignalAction topic check failed:", topicError.message);
    return fail("We couldn't check your topics just now. Try again.");
  }

  if (!followed) {
    return fail(
      `Follow ${topicLabel(input.topic)} first, or choose a topic you already follow.`,
    );
  }

  if (input.goal_id !== "") {
    if (!isUuid(input.goal_id)) return fail("That goal isn't one of yours.");
    const { data: goal, error } = await session.supabase
      .from("goals")
      .select("id")
      .eq("id", input.goal_id)
      .eq("user_id", session.user.id)
      .maybeSingle();

    if (error || !goal) return fail("That goal isn't one of yours.");
  }

  const { error } = await session.supabase.from("radar_signals").insert({
    user_id: session.user.id,
    topic: input.topic,
    kind: input.kind,
    headline: input.headline,
    source_name: input.source_name,
    source_url: input.source_url,
    published_on: input.published_on,
    geography: input.geography === "" ? null : input.geography,
    sector: input.sector === "" ? null : input.sector,
    uncertainty: input.uncertainty,
    goal_id: input.goal_id === "" ? null : input.goal_id,
    dedupe_key: dedupeKey(input.source_url, input.published_on),
  });

  if (error) {
    if (error.code === "23505") {
      return fail(
        "That is already in your radar: the same source was recorded for the same publication date. Nothing was duplicated.",
      );
    }
    console.error("addSignalAction insert failed:", error.message);
    return fail("We couldn't save that signal. Nothing changed.");
  }

  refresh();
  return done(
    `Saved as “${kindLabel(input.kind)}”. That label stays on the card; it is not upgraded to a fact.`,
  );
}

/** Save for later, dismiss, or bring a dismissed signal back. */
export async function toggleSignalAction(
  _previous: RadarState,
  formData: FormData,
): Promise<RadarState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const signalId = readText(formData, "signal_id");
  const intent = readText(formData, "intent");
  if (!isUuid(signalId)) return fail(NOT_AVAILABLE);

  const update: Record<string, string | null> = {};

  if (intent === "save") update.saved_at = new Date().toISOString();
  else if (intent === "unsave") update.saved_at = null;
  else if (intent === "dismiss") update.dismissed_at = new Date().toISOString();
  else if (intent === "restore") update.dismissed_at = null;
  else return fail("That action isn't available.");

  const { error } = await session.supabase
    .from("radar_signals")
    .update(update)
    .eq("id", signalId)
    .eq("user_id", session.user.id);

  if (error) {
    console.error("toggleSignalAction failed:", error.message);
    return fail("We couldn't change that signal. Nothing changed.");
  }

  refresh();
  return done(
    intent === "save"
      ? "Saved for later."
      : intent === "unsave"
        ? "Removed from your saved list. The signal stays in the radar."
        : intent === "dismiss"
          ? "Dismissed. It is out of your feed and can be restored later."
          : "Back in your radar.",
  );
}

/**
 * Creates one small preparation task in a goal the person chooses. No deadline,
 * plan or status is changed, and the task is ordinary from then on.
 */
export async function createPreparationTaskAction(
  _previous: RadarState,
  formData: FormData,
): Promise<RadarState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const signalId = readText(formData, "signal_id");
  if (!isUuid(signalId)) return fail(NOT_AVAILABLE);

  const signal = await getRadarSignal(session, signalId);
  if (!signal) return fail(NOT_AVAILABLE);

  if (signal.experiment_task_id) {
    return done("That signal already has a preparation task.");
  }

  const chosenGoal = readText(formData, "goal_id");
  const goalId = chosenGoal !== "" ? chosenGoal : signal.goal_id;

  if (!goalId || !isUuid(goalId)) {
    return fail("Choose which goal this preparation belongs to first.");
  }

  const { data: goal, error: goalError } = await session.supabase
    .from("goals")
    .select("id, title")
    .eq("id", goalId)
    .eq("user_id", session.user.id)
    .maybeSingle();

  if (goalError || !goal) return fail("That goal isn't one of yours.");

  const { data: task, error: taskError } = await session.supabase
    .from("tasks")
    .insert({
      user_id: session.user.id,
      goal_id: goalId,
      title: preparationTaskTitle(signal),
      instructions: preparationTaskInstructions(signal, goal.title as string),
      origin: "manual",
    })
    .select("id")
    .single();

  if (taskError || !task) {
    console.error("createPreparationTaskAction task insert failed:", taskError?.message);
    return fail("We couldn't add that task. Nothing changed.");
  }

  const { error: linkError } = await session.supabase
    .from("radar_signals")
    .update({ experiment_task_id: task.id })
    .eq("id", signal.id)
    .eq("user_id", session.user.id);

  if (linkError) {
    await session.supabase.from("tasks").delete().eq("id", task.id);
    console.error("createPreparationTaskAction link failed:", linkError.message);
    return fail("We couldn't connect that task, so it was removed again.");
  }

  revalidatePath(`/goals/${goalId}`);
  refresh();
  return done("Added as an ordinary task in your goal. Edit or delete it like any other.");
}

/** Creates one learning goal. No AI learning plan is generated. */
export async function createLearningGoalAction(
  _previous: RadarState,
  formData: FormData,
): Promise<RadarState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const signalId = readText(formData, "signal_id");
  if (!isUuid(signalId)) return fail(NOT_AVAILABLE);

  const signal = await getRadarSignal(session, signalId);
  if (!signal) return fail(NOT_AVAILABLE);

  if (signal.learning_goal_id) {
    return done("That signal already has a learning goal.");
  }

  const { data: goal, error } = await session.supabase
    .from("goals")
    .insert({
      user_id: session.user.id,
      title: learningGoalTitle(signal),
      desired_outcome: learningGoalOutcome(signal),
      time_available_minutes: 60,
      category: "learn",
    })
    .select("id")
    .single();

  if (error || !goal) {
    console.error("createLearningGoalAction goal insert failed:", error?.message);
    return fail("We couldn't create that learning goal. Nothing changed.");
  }

  const { error: linkError } = await session.supabase
    .from("radar_signals")
    .update({ learning_goal_id: goal.id })
    .eq("id", signal.id)
    .eq("user_id", session.user.id);

  if (linkError) {
    await session.supabase.from("goals").delete().eq("id", goal.id);
    console.error("createLearningGoalAction link failed:", linkError.message);
    return fail("We couldn't connect that goal, so it was removed again.");
  }

  revalidatePath("/dashboard");
  refresh();
  return done("Learning goal created. Open it to add your own steps or a learning plan.");
}
