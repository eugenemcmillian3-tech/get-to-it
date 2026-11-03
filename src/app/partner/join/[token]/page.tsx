import type { Metadata } from "next";
import Link from "next/link";
import { PartnerJoinActions } from "@/components/partner-join-actions";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { requireSession } from "@/lib/auth";
import { getIdentity } from "@/lib/identity";
import { tokenLooksValid } from "@/lib/partner";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { cardClass, focusRing } from "@/lib/styles";

export const metadata: Metadata = { title: "Invitation — GET TO IT" };

export default async function PartnerJoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const identity = await getIdentity(session);
  const { token } = await params;
  const usable = tokenLooksValid(token);

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-6">
        <Link
          href="/partner"
          className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
        >
          ← Your partner page
        </Link>

        <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
          Someone would like to share progress with you
        </h1>

        <div className={`${cardClass} mt-5`}>
          <p className="text-sm leading-relaxed">
            Accepting links your account to theirs as an accountability partner.
            They see nothing you do not switch on, and you see nothing they do
            not switch on. Either of you can end it at any time.
          </p>

          <ul className="mt-3 space-y-1 text-sm text-muted">
            <li>· Goal titles, completion counts, a milestone or a check-in — each optional.</li>
            <li>· Never shared: task notes, saved work, AI conversations, reflections, focus sessions.</li>
            <li>· One short encouragement thread, text only.</li>
          </ul>

          {usable ? (
            <PartnerJoinActions token={token} />
          ) : (
            <p role="alert" className="mt-4 text-sm text-danger">
              This invitation link doesn&apos;t look complete. Ask them to send
              it again, or paste the code on your partner page.
            </p>
          )}

          <p className="mt-4 text-xs leading-relaxed text-muted">
            The invitation works once and expires seven days after it was made.
            If this link was forwarded to you, it will only work for the account
            whose email address the sender used.
          </p>
        </div>
      </main>
    </div>
  );
}
