import type { Metadata } from "next";
import Link from "next/link";
import { PreferencesPanel } from "@/components/preferences-form";
import { ReminderSettingsForm } from "@/components/reminder-settings-form";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getPreferences } from "@/lib/data/preferences";
import { getReminderSettings } from "@/lib/data/reminders";
import { getIdentity } from "@/lib/identity";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { focusRing } from "@/lib/styles";

export const metadata: Metadata = { title: "Settings — GET TO IT" };

export default async function SettingsPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, settings, preferences] = await Promise.all([
    getIdentity(session),
    getReminderSettings(session),
    getPreferences(session),
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
          Settings
        </h1>

        <div className="mt-4">
          <PreferencesPanel preferences={preferences} reminder={settings} />
        </div>

        <div className="mt-6">
          <ReminderSettingsForm settings={settings} />
        </div>

        <p className="mt-6 text-sm text-muted">
          <Link
            href="/data"
            className={`rounded font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
          >
            Export or import your data
          </Link>
        </p>

        <p className="mt-3 text-sm text-muted">
          <Link
            href="/reminders"
            className={`rounded font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
          >
            Open your reminder inbox
          </Link>
        </p>

        <p className="mt-3 text-sm text-muted">
          <Link
            href="/dashboard#delete-account"
            className={`rounded font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
          >
            Delete your account
          </Link>{" "}
          — remove your login and everything stored with it.
        </p>

        <p className="mt-8 text-xs leading-relaxed text-muted">
          Reminders are stored in your account. There is no email, SMS or push
          delivery in GET TO IT — the inbox is the only channel.
        </p>
      </main>
    </div>
  );
}
