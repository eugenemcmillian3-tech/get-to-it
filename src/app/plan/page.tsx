import type { Metadata } from "next";
import Link from "next/link";
import { DailyPlanBuilder } from "@/components/daily-plan-builder";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import {
  getDailyPlan,
  getDailyPlanCandidates,
  getPreferences,
} from "@/lib/data/preferences";
import { getReminderSettings } from "@/lib/data/reminders";
import { getIdentity } from "@/lib/identity";
import { localDate } from "@/lib/reminders";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { focusRing } from "@/lib/styles";

export const metadata: Metadata = { title: "Plan your day — GET TO IT" };

export default async function PlanPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, preferences, candidates, reminderSettings] = await Promise.all([
    getIdentity(session),
    getPreferences(session),
    getDailyPlanCandidates(session),
    getReminderSettings(session),
  ]);

  const day = localDate(reminderSettings.timezone);
  const existingPlan = await getDailyPlan(session, day);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href="/dashboard"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Back to your goals
        </Link>

        <h1 className="mt-4 text-2xl font-black leading-tight tracking-tight sm:text-3xl">
          Plan your day
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          Tell GET TO IT how much time you have, and it will propose a
          manageable selection from the tasks you already wrote. You choose,
          edit and approve the list. Nothing is scheduled and no task is
          started, moved or marked abandoned.
        </p>

        <div className="mt-6">
          <DailyPlanBuilder
            candidates={candidates}
            day={day}
            existingPlan={existingPlan}
            preferences={preferences}
            defaultMinutes={preferences.session_length_minutes ?? 30}
          />
        </div>

        <p className="mt-8 text-sm text-muted">
          <Link
            href="/settings"
            className={`rounded font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
          >
            Work preferences
          </Link>{" "}
          — session length, usual days and hours, task size, reply style and
          topics. Every field is optional.
        </p>
      </main>
    </div>
  );
}
