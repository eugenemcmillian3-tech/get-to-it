import Link from "next/link";
import { focusRing, primaryButton } from "@/lib/styles";

export default function NotFound() {
  return (
    <main className="mx-auto w-full max-w-md px-5 py-16 text-center">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-strong">
        GET TO IT
      </p>
      <h1 className="mt-3 text-2xl font-black tracking-tight">
        We couldn&apos;t find that.
      </h1>
      <p className="mt-3 leading-relaxed text-muted">
        The goal or task you opened isn&apos;t here. It may have been deleted, or
        it belongs to a different account.
      </p>
      <Link href="/dashboard" className={`${primaryButton} mt-6`}>
        Back to your goals
      </Link>
      <Link
        href="/"
        className={`mt-6 block rounded text-sm text-muted underline decoration-line underline-offset-4 ${focusRing}`}
      >
        Home
      </Link>
    </main>
  );
}
