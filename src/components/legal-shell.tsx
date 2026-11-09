import Link from "next/link";
import type { ReactNode } from "react";
import { focusRing } from "@/lib/styles";

const LEGAL_LINKS = [
  { href: "/terms", label: "Terms" },
  { href: "/privacy", label: "Privacy" },
  { href: "/refunds", label: "Refunds" },
];

/**
 * Public shell for the legal pages.
 *
 * These pages must stay reachable without an account: a person has to be able
 * to read the terms and the refund policy before they sign up or pay. They are
 * deliberately outside the signed-in prefixes in src/proxy.ts.
 */
export function LegalShell({
  title,
  summary,
  children,
}: {
  title: string;
  summary: string;
  children: ReactNode;
}) {
  return (
    <div className="min-h-dvh">
      <header className="border-b border-line/80 bg-paper/95">
        <div className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-3 px-5 py-4">
          <Link
            href="/"
            className={`text-sm font-black uppercase tracking-[0.25em] ${focusRing}`}
          >
            GET TO IT
          </Link>
          <nav aria-label="Legal pages" className="flex flex-wrap gap-3 text-sm font-medium">
            {LEGAL_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`rounded text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-3xl px-5 pb-16 pt-8">
        <h1 className="text-3xl font-black leading-tight tracking-tight sm:text-4xl">{title}</h1>
        <p className="mt-2 text-sm text-muted">Last updated 9 November 2026</p>
        <p className="mt-4 leading-relaxed text-muted">{summary}</p>

        <div className="mt-8 space-y-6 leading-relaxed">{children}</div>

        <footer className="mt-10 border-t border-line pt-4 text-sm text-muted">
          <p>
            Questions about this page: use the support request form on the Plans
            page once you are signed in, or reply to any receipt email you were
            sent.{" "}
            <Link
              href="/sign-in"
              className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
            >
              Sign in
            </Link>
            .
          </p>
        </footer>
      </main>
    </div>
  );
}
