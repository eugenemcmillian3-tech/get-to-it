import Link from "next/link";
import { signOutAction } from "@/lib/actions/auth";
import { focusRing, quietButton } from "@/lib/styles";

export function SiteHeader({
  displayName,
  email,
}: {
  displayName: string;
  email: string;
}) {
  return (
    <header className="border-b border-line bg-paper">
      <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-4">
        <Link
          href="/dashboard"
          className={`text-sm font-black uppercase tracking-[0.25em] ${focusRing}`}
        >
          GET TO IT
        </Link>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <Link
            href="/billing"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Plans
          </Link>
          <Link
            href="/credits"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Credits
          </Link>
          <Link
            href="/workflows"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Workflows
          </Link>
          <Link
            href="/futures"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Future paths
          </Link>
          <Link
            href="/reviews"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Reviews
          </Link>
          <Link
            href="/radar"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Radar
          </Link>
          <Link
            href="/outcomes"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Outcomes
          </Link>
          <Link
            href="/build"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Build an App
          </Link>
          <Link
            href="/workspace"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Workspaces
          </Link>
          <Link
            href="/partner"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Partner
          </Link>
          <Link
            href="/templates"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Templates
          </Link>
          <Link
            href="/reminders"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Reminders
          </Link>
          <Link
            href="/data"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Your data
          </Link>
          <Link
            href="/settings"
            className={`rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            Settings
          </Link>
          <span
            className="max-w-[12rem] truncate text-sm text-muted sm:max-w-[16rem]"
            title={email}
          >
            {displayName}
          </span>
          <form action={signOutAction}>
            <button type="submit" className={quietButton}>
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );
}
