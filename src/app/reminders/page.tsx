import type { Metadata } from "next";
import Link from "next/link";
import { ReminderInbox } from "@/components/reminder-inbox";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getInbox } from "@/lib/data/reminders";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { focusRing } from "@/lib/styles";

export const metadata: Metadata = { title: "Reminders — GET TO IT" };

export default async function RemindersPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, inbox] = await Promise.all([
    getIdentity(session),
    getInbox(session),
  ]);

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
          Reminders
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted">
          In-app only. There are no emails, texts or push notifications, and
          nothing here is shared with anyone else.
        </p>

        <div className="mt-6">
          <ReminderInbox
            deliveries={inbox.deliveries}
            intention={inbox.intention}
            timezone={inbox.settings.timezone}
            dailyCheckin={inbox.settings.daily_checkin}
          />
        </div>

        <p className="mt-8 text-sm text-muted">
          <Link
            href="/settings"
            className={`rounded font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
          >
            Reminder settings
          </Link>{" "}
          — times, timezone, quiet hours, or switch reminders off entirely.
        </p>
      </main>
    </div>
  );
}
