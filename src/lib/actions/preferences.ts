"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/lib/action-state";
import { getSession } from "@/lib/auth";
import {
  parsePreferenceValues,
  preferencesUpsertRow,
} from "@/lib/preferences";
import {
  normalizeWeekdays,
  parseTimeOfDay,
} from "@/lib/reminders";
import { readText } from "@/lib/validation";

const SESSION_EXPIRED = "Your session expired. Sign in again to keep going.";
const SAVE_FAILED =
  "We couldn't save your preferences. Nothing changed — try again.";

function fail(message: string): FormState {
  return { status: "error", message };
}

const EMPTY_VALUES = {
  session_length_minutes: null,
  work_days: null,
  work_start: null,
  work_end: null,
  task_size: null,
  communication_style: null,
  help_topics: null,
} as const;

/**
 * Saves the optional preferences, and the preferred reminder schedule.
 *
 * The schedule is the existing `reminder_settings` row, not a second copy: the
 * button is explicitly labelled, and future reminders are rescheduled. Nothing
 * is saved automatically, and no field is inferred from anything the person
 * wrote elsewhere.
 */
export async function savePreferencesAction(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const session = await getSession();
  if (!session) return fail(SESSION_EXPIRED);

  const parsed = parsePreferenceValues({
    sessionLength: readText(formData, "session_length_minutes"),
    workDays: formData.getAll("work_days").map((value) => String(value)),
    workStart: readText(formData, "work_start"),
    workEnd: readText(formData, "work_end"),
    taskSize: readText(formData, "task_size"),
    communicationStyle: readText(formData, "communication_style"),
    helpTopics: readText(formData, "help_topics"),
    personalizationEnabled:
      readText(formData, "personalization_enabled") === "true",
  });

  if (!parsed.ok) return fail(parsed.message);

  const remindersEnabled = readText(formData, "reminders_enabled") === "true";
  const remindAt = parseTimeOfDay(readText(formData, "remind_at"));
  const weekdays = normalizeWeekdays(
    formData
      .getAll("reminder_weekdays")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value)),
  );

  if (!remindAt) return fail("Use a reminder time like 09:00.");
  if (remindersEnabled && weekdays.length === 0) {
    return fail("Choose at least one day for reminders, or switch them off.");
  }

  const { error: preferencesError } = await session.supabase
    .from("user_preferences")
    .upsert(preferencesUpsertRow(session.user.id, parsed.values), {
      onConflict: "user_id",
    });

  if (preferencesError) {
    console.error("savePreferencesAction failed:", preferencesError.message);
    return fail(SAVE_FAILED);
  }

  const { error: reminderError } = await session.supabase
    .from("reminder_settings")
    .upsert(
      {
        user_id: session.user.id,
        enabled: remindersEnabled,
        remind_at: remindAt,
        weekdays:
          weekdays.length > 0 ? weekdays : [1, 2, 3, 4, 5],
      },
      { onConflict: "user_id" },
    );

  if (reminderError) {
    console.error("savePreferencesAction reminders failed:", reminderError.message);
    return fail(
      "Your preferences were saved, but the reminder schedule wasn't. Open Reminder settings and save it there.",
    );
  }

  const { error: rescheduleError } = await session.supabase.rpc(
    "reschedule_my_reminders",
  );
  if (rescheduleError) {
    console.error("reschedule_my_reminders failed:", rescheduleError.message);
  }

  revalidatePath("/settings");
  revalidatePath("/plan");
  revalidatePath("/dashboard");
  revalidatePath("/reminders");

  return {
    status: "success",
    message: parsed.values.personalization_enabled
      ? "Preferences saved. Suggestions will explain which of them they used."
      : "Preferences saved, with personalisation off. Nothing will be tailored until you switch it back on.",
    nonce: Date.now(),
  };
}

/** Switches personalisation off without deleting what was saved. */
export async function disablePersonalizationAction(): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const { error } = await session.supabase.from("user_preferences").upsert(
    {
      user_id: session.user.id,
      personalization_enabled: false,
    },
    { onConflict: "user_id" },
  );

  if (error) {
    console.error("disablePersonalizationAction failed:", error.message);
    return;
  }

  revalidatePath("/settings");
  revalidatePath("/plan");
  revalidatePath("/dashboard");
}

/** Clears every saved value, keeping the row and personalisation on. */
export async function resetPreferencesAction(): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const { error } = await session.supabase
    .from("user_preferences")
    .update({ ...EMPTY_VALUES, personalization_enabled: true })
    .eq("user_id", session.user.id);

  if (error) {
    console.error("resetPreferencesAction failed:", error.message);
    return;
  }

  revalidatePath("/settings");
  revalidatePath("/plan");
  revalidatePath("/dashboard");
}

/** Deletes the preferences row entirely. Nothing else is touched. */
export async function deletePreferencesAction(): Promise<void> {
  const session = await getSession();
  if (!session) return;

  const { error } = await session.supabase
    .from("user_preferences")
    .delete()
    .eq("user_id", session.user.id);

  if (error) {
    console.error("deletePreferencesAction failed:", error.message);
    return;
  }

  revalidatePath("/settings");
  revalidatePath("/plan");
  revalidatePath("/dashboard");
}
