import Link from "next/link";
import { signOutAction } from "@/lib/actions/auth";
import { focusRing, quietButton } from "@/lib/styles";

const NAV_LINKS = [
  { href: "/dashboard", label: "Goals" },
  { href: "/plan", label: "Plan" },
  { href: "/templates", label: "Templates" },
  { href: "/workspace", label: "Workspaces" },
  { href: "/workflows", label: "Workflows" },
  { href: "/build", label: "Build an App" },
  { href: "/futures", label: "Future paths" },
  { href: "/reviews", label: "Reviews" },
  { href: "/radar", label: "Radar" },
  { href: "/outcomes", label: "Outcomes" },
  { href: "/partner", label: "Partner" },
  { href: "/reminders", label: "Reminders" },
  { href: "/billing", label: "Plans" },
  { href: "/credits", label: "Credits" },
  { href: "/data", label: "Your data" },
  { href: "/settings", label: "Settings" },
];

export function SiteHeader({
  displayName,
  email,
}: {
  displayName: string;
  email: string;
}) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/80 bg-paper/95 backdrop-blur">
      <div className="mx-auto w-full max-w-5xl px-5">
        <div className="flex min-h-16 flex-wrap items-center justify-between gap-3 py-3">
          <Link
            href="/dashboard"
            className={`text-sm font-black uppercase tracking-[0.25em] ${focusRing}`}
          >
            GET TO IT
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            <span
              className="max-w-[11rem] truncate text-sm text-muted sm:max-w-[18rem]"
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

        <nav
          aria-label="Primary"
          className="-mx-1 flex gap-1 overflow-x-auto pb-2 [scrollbar-width:none]"
        >
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`whitespace-nowrap rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted transition hover:bg-card hover:text-ink ${focusRing}`}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
