"use client";

import Link from "next/link";
import { focusRing, primaryButton, secondaryButton } from "@/lib/styles";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-strong">
        GET TO IT
      </p>
      <h1 className="mt-3 text-2xl font-black tracking-tight">
        That didn&apos;t load.
      </h1>
      <p className="mt-3 leading-relaxed text-muted">
        Something went wrong on our side. Nothing you saved was lost — try
        again, or head back to your goals.
      </p>
      {error.digest ? (
        <p className="mt-2 text-xs text-muted">Reference: {error.digest}</p>
      ) : null}
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
        <button type="button" onClick={reset} className={primaryButton}>
          Try again
        </button>
        <Link href="/dashboard" className={secondaryButton}>
          Back to your goals
        </Link>
      </div>
      <Link
        href="/"
        className={`mt-6 inline-block rounded text-sm text-muted underline decoration-line underline-offset-4 ${focusRing}`}
      >
        Home
      </Link>
    </main>
  );
}
