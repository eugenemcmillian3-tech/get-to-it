"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import { getReminderSettings } from "@/lib/data/reminders";
import {
  isValidTimeZone,
  localDate,
  normalizeWeekdays,
  parseTimeOfDay,
} from "@/lib/reminders";
import { readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const NOT_AVAILABLE = "That item isn't available. Go back and open it again.";
const REMINDER_UNAVAILABLE =
  "We couldn't update that reminder. Nothing changed — try again.";

function fail(message: string): FormState {
  return { status: "error", message };
}

/**
 * Saves reminder preferences, then reschedules future reminders so the new
 * timezone or time applies. Anything already due keeps its original slot.
 */
export async function saveReminderSettingsAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const timezone = readText(formData, "timezone");
  const remindAt = parseTimeOfDay(readText(formData, "remind_at"));
  const checkinAt = parseTimeOfDay(readText(formData, "checkin_at"));
  const quietFrom = parseTimeOfDay(readText(formData, "quiet_from"));
  const quietTo = parseTimeOfDay(readText(formData, "quiet_to"));
  const weekdays = normalizeWeekdays(
    formData
      .getAll("weekdays")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value)),
  );

  const enabled = readText(formData, "enabled") === "true";
  const dailyCheckin = readText(formData, "daily_checkin") === "true";

  if (!isValidTimeZone(timezone)) {
    return fail("Pick one of the listed timezones.");
  }
  if (!remindAt || !checkinAt || !quietFrom || !quietTo) {
    return fail("Use times like 09:00 and 21:30.");
  }
  if (weekdays.length === 0) {
    return fail("Choose at least one day for reminders.");
  }

  const { error } = await session.supabase.from("reminder_settings").upsert(
    {
      user_id: session.user.id,
      timezone,
      remind_at: remindAt,
      weekdays,
      quiet_from: quietFrom,
      quiet_to: quietTo,
      enabled,
      daily_checkin: dailyCheckin,
      checkin_at: checkinAt,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("saveReminderSettingsAction failed:", error.message);
    return fail(REMINDER_UNAVAILABLE);
  }

  const { data: rescheduled, error: rescheduleError } = await session.supabase.rpc(
    "reschedule_my_reminders",
  );
  if (rescheduleError) {
    console.error("reschedule_my_reminders failed:", rescheduleError.message);
  }

  revalidatePath("/settings");
  revalidatePath("/reminders");
  revalidatePath("/dashboard");

  const count = Number(rescheduled ?? 0);

  return {
    status: "success",
    message:
      count > 0
        ? `Saved. ${count} reminder${count === 1 ? "" : "s"} rescheduled to this timezone. Anything already due keeps its original time.`
        : "Saved. Reminder times now use this timezone.",
    nonce: Date.now(),
  };
}

/** Turns one reminder on or off. Ownership is checked in the database too. */
export async function setReminderAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const goalId = readText(formData, "goal_id");
  const taskId = readText(formData, "task_id");
  const enabled = readText(formData, "enabled") === "true";

  if (goalId === "" && taskId === "") return fail(NOT_AVAILABLE);

  const { data, error } = await session.supabase.rpc("upsert_reminder", {
    p_task_id: taskId === "" ? null : taskId,
    p_goal_id: goalId === "" ? null : goalId,
    p_enabled: enabled,
  });

  if (error) {
    console.error("setReminderAction failed:", error.message);
    return fail(REMINDER_UNAVAILABLE);
  }

  const payload = (data ?? {}) as { ok?: boolean; code?: string };
  if (payload.ok !== true) {
    return fail(
      payload.code === "no-target"
        ? NOT_AVAILABLE
        : REMINDER_UNAVAILABLE,
    );
  }

  if (goalId !== "") revalidatePath(`/goals/${goalId}`);
  if (goalId !== "" && taskId !== "") {
    revalidatePath(`/goals/${goalId}/tasks/${taskId}`);
  }
  revalidatePath("/reminders");
  revalidatePath("/settings");

  return {
    status: "success",
    message: enabled ? "Reminder on." : "Reminder off. Nothing else changed.",
    nonce: Date.now(),
  };
}

/** Snooze or dismiss one inbox item. */
export async function reminderDeliveryAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const deliveryId = readText(formData, "delivery_id");
  const action = readText(formData, "action");
  const minutes = Number(readText(formData, "minutes") || "60");

  if (deliveryId === "" || (action !== "dismiss" && action !== "snooze")) {
    return fail(REMINDER_UNAVAILABLE);
  }

  const { data, error } = await session.supabase.rpc("reminder_action", {
    p_delivery_id: deliveryId,
    p_action: action,
    p_snooze_minutes: Number.isFinite(minutes) ? minutes : 60,
  });

  if (error) {
    console.error("reminderDeliveryAction failed:", error.message);
    return fail(REMINDER_UNAVAILABLE);
  }

  const payload = (data ?? {}) as { ok?: boolean; code?: string };
  if (payload.ok !== true) {
    return fail(
      payload.code === "no-delivery"
        ? "That reminder is no longer in your inbox. Reload to see the current list."
        : REMINDER_UNAVAILABLE,
    );
  }

  revalidatePath("/reminders");
  revalidatePath("/dashboard");

  return {
    status: "success",
    message: action === "snooze" ? "Snoozed." : "Dismissed.",
    nonce: Date.now(),
  };
}

/** The optional daily check-in: one short answer per local day. */
export async function saveDailyIntentionAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const intention = readText(formData, "intention");
  const deliveryId = readText(formData, "delivery_id");

  if (intention.length < 2) {
    return fail("Write one thing you want to move forward today.");
  }
  if (intention.length > 500) {
    return fail("Keep it under 500 characters.");
  }

  const settings = await getReminderSettings(session);
  const today = localDate(settings.timezone);

  const { error } = await session.supabase.from("daily_intentions").upsert(
    { user_id: session.user.id, day: today, intention },
    { onConflict: "user_id,day" },
  );

  if (error) {
    console.error("saveDailyIntentionAction failed:", error.message);
    return fail(
      "We couldn't save that. Your words are still in the box — try again.",
    );
  }

  if (deliveryId !== "") {
    const { error: dismissError } = await session.supabase
      .from("reminder_deliveries")
      .update({ state: "dismissed", snoozed_until: null })
      .eq("id", deliveryId)
      .eq("user_id", session.user.id);
    if (dismissError) {
      console.error("dismissing check-in delivery failed:", dismissError.message);
    }
  }

  revalidatePath("/reminders");
  revalidatePath("/dashboard");

  return {
    status: "success",
    message: "Saved for today. Only you can see it.",
    nonce: Date.now(),
  };
}
