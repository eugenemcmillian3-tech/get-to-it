import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { SetupNotice } from "@/components/setup-notice";
import { getSession } from "@/lib/auth";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { focusRing } from "@/lib/styles";
import { safeNextPath } from "@/lib/validation";

export const metadata: Metadata = { title: "Sign in — GET TO IT" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const nextPath = safeNextPath(params.next);

  if (!getSupabaseSettings()) {
    return (
      <AuthShell
        title="Sign in"
        subtitle="Your goals are waiting — once the database is connected."
        footer={
          <Link
            href="/"
            className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
          >
            Back to the start
          </Link>
        }
      >
        <SetupNotice />
      </AuthShell>
    );
  }

  const session = await getSession();
  if (session) redirect(nextPath);

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in and pick up where you left off."
      footer={
        <>
          New here?{" "}
          <Link
            href="/sign-up"
            className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
          >
            Create an account
          </Link>
        </>
      }
    >
      <AuthForm
        mode="sign-in"
        nextPath={nextPath === "/dashboard" ? undefined : nextPath}
      />
    </AuthShell>
  );
}
