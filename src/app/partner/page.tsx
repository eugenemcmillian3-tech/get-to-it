import type { Metadata } from "next";
import Link from "next/link";
import { PartnerEncouragement } from "@/components/partner-encouragement";
import { PartnerInviteForm } from "@/components/partner-invite-form";
import { PartnerJoinActions } from "@/components/partner-join-actions";
import { PartnerSafety } from "@/components/partner-safety";
import { PartnerShareForm } from "@/components/partner-share-form";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { cancelInvitationAction } from "@/lib/actions/partner";
import { requireSession } from "@/lib/auth";
import { getPartnershipState } from "@/lib/data/partnership";
import { getIdentity } from "@/lib/identity";
import {
  describeShared,
  formatMessageTime,
  invitePath,
} from "@/lib/partner";
import { getSupabaseSettings } from "@/lib/supabase/config";
import {
  cardClass,
  chipClass,
  focusRing,
  quietButton,
  secondaryButton,
} from "@/lib/styles";

export const metadata: Metadata = { title: "Your partner — GET TO IT" };

function joinedLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export default async function PartnerPage() {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <SetupNotice />
      </main>
    );
  }

  const session = await requireSession();
  const [identity, state] = await Promise.all([
    getIdentity(session),
    getPartnershipState(session),
  ]);

  const partnership = state.partnership;

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

        <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
          {partnership ? `You and ${partnership.partner_name}` : "A partner, if you want one"}
        </h1>
        <p className="mt-3 max-w-xl leading-relaxed text-muted">
          One person, invited by you. Nothing is shared until you tick it, and
          you can end the whole thing in two clicks.
        </p>

        {partnership ? (
          <>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className={chipClass}>
                Sharing since {joinedLabel(partnership.started_at)}
              </span>
              <span className={chipClass}>One partner</span>
            </div>

            <section aria-labelledby="partner-shares-heading" className="mt-8">
              <h2 id="partner-shares-heading" className="text-lg font-bold">
                What {partnership.partner_name} shares
              </h2>

              {(() => {
                const items = describeShared(state.snapshot?.shared ?? {});
                if (items.length === 0) {
                  return (
                    <p className="mt-2 rounded-xl border border-dashed border-line p-4 text-sm leading-relaxed text-muted">
                      Nothing yet. They haven&apos;t switched anything on, and
                      that is the default — you are not missing a hidden view.
                    </p>
                  );
                }

                return (
                  <dl className="mt-3 space-y-3">
                    {items.map((item) => (
                      <div key={item.key} className={cardClass}>
                        <dt className="text-xs font-bold uppercase tracking-[0.15em] text-muted">
                          {item.label}
                        </dt>
                        <dd className="mt-1 whitespace-pre-wrap break-words leading-relaxed">
                          {item.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                );
              })()}

              {state.snapshot?.shared.updated_at ? (
                <p className="mt-2 text-xs text-muted">
                  Last updated {formatMessageTime(state.snapshot.shared.updated_at)}
                </p>
              ) : null}
            </section>

            <section aria-labelledby="my-share-heading" className="mt-10">
              <h2 id="my-share-heading" className="text-lg font-bold">
                What you share with {partnership.partner_name}
              </h2>
              <PartnerShareForm share={state.share} />
            </section>

            <PartnerEncouragement
              partnershipId={partnership.id}
              partnerName={partnership.partner_name}
              myId={session.user.id}
              messages={state.messages}
            />

            <PartnerSafety
              partnershipId={partnership.id}
              partnerName={partnership.partner_name}
            />
          </>
        ) : (
          <>
            <section aria-labelledby="invite-heading" className="mt-8">
              <h2 id="invite-heading" className="text-lg font-bold">
                Invite someone
              </h2>
              <div className={`${cardClass} mt-3`}>
                <PartnerInviteForm />
              </div>
            </section>

            {state.invitations.length > 0 ? (
              <section aria-labelledby="pending-heading" className="mt-8">
                <h2 id="pending-heading" className="text-lg font-bold">
                  Waiting to be accepted
                </h2>

                <ul className="mt-3 space-y-2">
                  {state.invitations.map((invitation) => (
                    <li
                      key={invitation.id}
                      className="rounded-xl border border-line bg-card p-3.5"
                    >
                      <p className="text-sm font-semibold">
                        {invitation.invitee_email}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        Expires {formatMessageTime(invitation.expires_at)}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-3">
                        <Link
                          href={invitePath(invitation.token)}
                          className={`rounded text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
                        >
                          Open the link
                        </Link>
                        <form action={cancelInvitationAction}>
                          <input
                            type="hidden"
                            name="invitation_id"
                            value={invitation.id}
                          />
                          <button type="submit" className={quietButton}>
                            Cancel invitation
                          </button>
                        </form>
                      </div>
                    </li>
                  ))}
                </ul>

                <p className="mt-2 text-xs leading-relaxed text-muted">
                  A pending invitation says nothing about whether that address
                  has an account. Only the account with that email can accept,
                  and the link works once.
                </p>
              </section>
            ) : null}

            <section aria-labelledby="join-heading" className="mt-8 border-t border-line pt-6">
              <h2 id="join-heading" className="text-lg font-bold">
                Have an invitation?
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                Open the link they sent, or paste the code here.
              </p>
              <div className={`${cardClass} mt-3`}>
                <PartnerJoinActions />
              </div>
            </section>

            <p className="mt-8 text-xs leading-relaxed text-muted">
              Sharing is opt-in and item by item. Task notes, saved work, AI
              conversations, weekly reflections and focus sessions are never
              available to a partner.
            </p>

            <p className="mt-6">
              <Link href="/dashboard" className={secondaryButton}>
                Back to your goals
              </Link>
            </p>
          </>
        )}
      </main>
    </div>
  );
}
