"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useEffect } from "react";

/** Last-resort App Router boundary; Sentry is a no-op without a client DSN. */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-dvh">
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
          <Link
            href="/"
            className="mt-6 inline-block rounded text-sm text-muted underline decoration-line underline-offset-4"
          >
            Home
          </Link>
        </main>
      </body>
    </html>
  );
}
