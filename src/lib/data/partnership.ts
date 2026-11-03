import type { Session } from "@/lib/auth";
import { DataError } from "@/lib/data/goals";
import type {
  EncouragementMessage,
  MyShareSettings,
  PartnerShared,
  PartnershipInvitation,
  PartnershipSummary,
} from "@/lib/types";

/**
 * Partnerships, read through the database's own functions.
 *
 * `my_partnership` and `partner_snapshot` are security-definer functions: the
 * partner's rows are never selectable, and the snapshot contains only fields
 * the partner switched on. Messages come through RLS, which only allows them
 * while the partnership is active.
 */

const LOAD_ERROR =
  "We couldn't load your partner page just now. Refresh the page to try again.";

const DEFAULT_SHARE: MyShareSettings = {
  goal_title: false,
  completion: false,
  milestone: false,
  checkin: false,
  milestone_text: null,
  checkin_text: null,
};

type MyPartnershipPayload = {
  ok?: boolean;
  code?: string;
  partnership?: PartnershipSummary | null;
  share?: Partial<MyShareSettings>;
};

type SnapshotPayload = {
  ok?: boolean;
  code?: string;
  partner_name?: string;
  shared?: PartnerShared;
};

export type PartnershipState = {
  partnership: PartnershipSummary | null;
  share: MyShareSettings;
  snapshot: { partner_name: string; shared: PartnerShared } | null;
  messages: EncouragementMessage[];
  invitations: PartnershipInvitation[];
};

export async function getPartnershipState(
  session: Session,
): Promise<PartnershipState> {
  const { data, error } = await session.supabase.rpc("my_partnership");

  if (error) {
    console.error("my_partnership failed:", error.message);
    throw new DataError(LOAD_ERROR);
  }

  const payload = (data ?? {}) as MyPartnershipPayload;
  if (payload.ok === false) throw new DataError(LOAD_ERROR);

  const partnership = payload.partnership ?? null;
  const share: MyShareSettings = {
    goal_title: payload.share?.goal_title ?? DEFAULT_SHARE.goal_title,
    completion: payload.share?.completion ?? DEFAULT_SHARE.completion,
    milestone: payload.share?.milestone ?? DEFAULT_SHARE.milestone,
    checkin: payload.share?.checkin ?? DEFAULT_SHARE.checkin,
    milestone_text: payload.share?.milestone_text ?? null,
    checkin_text: payload.share?.checkin_text ?? null,
  };

  const invitationsResult = await session.supabase
    .from("partnership_invitations")
    .select("id, invitee_email, token, status, created_at, expires_at")
    .eq("inviter_id", session.user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (invitationsResult.error) {
    console.error(
      "partnership invitations failed:",
      invitationsResult.error.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  const invitations = (invitationsResult.data ??
    []) as PartnershipInvitation[];

  if (!partnership) {
    return { partnership: null, share: DEFAULT_SHARE, snapshot: null, messages: [], invitations };
  }

  const [snapshotResult, messagesResult] = await Promise.all([
    session.supabase.rpc("partner_snapshot", { p_partnership_id: partnership.id }),
    session.supabase
      .from("encouragement_messages")
      .select("id, sender_id, body, created_at")
      .eq("partnership_id", partnership.id)
      .order("created_at", { ascending: true })
      .limit(50),
  ]);

  if (snapshotResult.error) {
    console.error("partner_snapshot failed:", snapshotResult.error.message);
    throw new DataError(LOAD_ERROR);
  }
  if (messagesResult.error) {
    console.error(
      "encouragement messages failed:",
      messagesResult.error.message,
    );
    throw new DataError(LOAD_ERROR);
  }

  const snapshotPayload = (snapshotResult.data ?? {}) as SnapshotPayload;

  return {
    partnership,
    share,
    snapshot: snapshotPayload.ok
      ? {
          partner_name: snapshotPayload.partner_name ?? "Your partner",
          shared: snapshotPayload.shared ?? {},
        }
      : null,
    messages: (messagesResult.data ?? []) as EncouragementMessage[],
    invitations,
  };
}
