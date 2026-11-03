import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import { localDate } from "@/lib/reminders";
import type {
  InboxDelivery,
  Reminder,
  ReminderDelivery,
  ReminderSettings,
} from "@/lib/types";

const LOAD_ERROR =
  "We couldn't load your reminders just now. Refresh the page to try again.";

/** Settings row, created with defaults on first use. */
export async function getReminderSettings(
  session: Session,
): Promise<ReminderSettings> {
  await session.supabase
    .from("reminder_settings")
    .upsert({ user_id: session.user.id }, { onConflict: "user_id", ignoreDuplicates: true });

  const { data, error } = await session.supabase
    .from("reminder_settings")
    .select(
      "user_id, timezone, remind_at, weekdays, quiet_from, quiet_to, enabled, daily_checkin, checkin_at",
    )
    .eq("user_id", session.user.id)
    .single();

  if (error || !data) {
    console.error("getReminderSettings failed:", error?.message);
    throw new DataError(LOAD_ERROR);
  }

  return data as ReminderSettings;
}

/** The reminder attached to one task, or to a goal when no task is given. */
export async function getReminderFor(
  session: Session,
  target: { taskId?: string; goalId: string },
): Promise<Reminder | null> {
  let query = session.supabase
    .from("reminders")
    .select("id, goal_id, task_id, enabled, next_due_at, last_delivered_at")
    .eq("user_id", session.user.id);

  query = target.taskId
    ? query.eq("task_id", target.taskId)
    : query.eq("goal_id", target.goalId).is("task_id", null);

  const { data, error } = await query.maybeSingle();

  if (error) {
    console.error("getReminderFor failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  return (data as Reminder | null) ?? null;
}

/**
 * The in-app inbox.
 *
 * Runs the delivery pass for this person first (so a due reminder appears even
 * if the scheduler has not run), then reads unread deliveries and resolves the
 * task and goal titles for each one.
 */
export async function getInbox(session: Session): Promise<{
  settings: ReminderSettings;
  deliveries: InboxDelivery[];
  intention: string | null;
  today: string;
}> {
  const settings = await getReminderSettings(session);

  const { error: passError } = await session.supabase.rpc("run_reminder_pass", {
    p_user: session.user.id,
  });
  if (passError) {
    // Delivery failures are shown honestly rather than swallowed silently.
    console.error("run_reminder_pass failed:", passError.message);
  }

  const { data: rows, error } = await session.supabase
    .from("reminder_deliveries")
    .select("id, reminder_id, kind, due_at, state, snoozed_until")
    .eq("user_id", session.user.id)
    .eq("state", "unread")
    .order("due_at", { ascending: true })
    .limit(25);

  if (error) {
    console.error("getInbox deliveries failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  const deliveries = (rows ?? []) as ReminderDelivery[];
  const reminderIds = [
    ...new Set(
      deliveries
        .map((delivery) => delivery.reminder_id)
        .filter((value): value is string => typeof value === "string"),
    ),
  ];

  const reminders = reminderIds.length
    ? ((
        await session.supabase
          .from("reminders")
          .select("id, task_id, goal_id")
          .in("id", reminderIds)
      ).data ?? [])
    : [];

  const taskIds = [
    ...new Set(
      (reminders as { task_id: string | null }[])
        .map((reminder) => reminder.task_id)
        .filter((value): value is string => typeof value === "string"),
    ),
  ];
  const goalIds = [
    ...new Set(
      (reminders as { goal_id: string | null }[])
        .map((reminder) => reminder.goal_id)
        .filter((value): value is string => typeof value === "string"),
    ),
  ];

  const tasks = taskIds.length
    ? ((
        await session.supabase
          .from("tasks")
          .select("id, title, goal_id")
          .in("id", taskIds)
      ).data ?? [])
    : [];
  const goals = goalIds.length
    ? ((
        await session.supabase
          .from("goals")
          .select("id, title")
          .in("id", goalIds)
      ).data ?? [])
    : [];

  const reminderById = new Map(
    (reminders as { id: string; task_id: string | null; goal_id: string | null }[]).map(
      (reminder) => [reminder.id, reminder],
    ),
  );
  const taskById = new Map(
    (tasks as { id: string; title: string; goal_id: string }[]).map((task) => [
      task.id,
      task,
    ]),
  );
  const goalById = new Map(
    (goals as { id: string; title: string }[]).map((goal) => [goal.id, goal]),
  );

  const enriched: InboxDelivery[] = deliveries.map((delivery) => {
    const reminder = delivery.reminder_id
      ? reminderById.get(delivery.reminder_id)
      : undefined;
    const task = reminder?.task_id ? taskById.get(reminder.task_id) : undefined;
    const goalId = reminder?.goal_id ?? task?.goal_id ?? null;
    const goal = goalId ? goalById.get(goalId) : undefined;

    return {
      ...delivery,
      taskId: reminder?.task_id ?? null,
      taskTitle: task?.title ?? null,
      goalId,
      goalTitle: goal?.title ?? null,
    };
  });

  const today = localDate(settings.timezone);
  const { data: intentionRow } = await session.supabase
    .from("daily_intentions")
    .select("intention")
    .eq("user_id", session.user.id)
    .eq("day", today)
    .maybeSingle();

  return {
    settings,
    deliveries: enriched,
    intention: (intentionRow as { intention: string } | null)?.intention ?? null,
    today,
  };
}
