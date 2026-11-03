import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { SetupNotice } from "@/components/setup-notice";
import { getSession } from "@/lib/auth";
import { getSupabaseSettings } from "@/lib/supabase/config";
import { focusRing } from "@/lib/styles";

export const metadata: Metadata = { title: "Create your account — GET TO IT" };

export default async function SignUpPage() {
  if (!getSupabaseSettings()) {
    return (
      <AuthShell
        title="Create your account"
        subtitle="One account keeps your goals and saved work private."
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
  if (session) redirect("/dashboard");

  return (
    <AuthShell
      title="Create your account"
      subtitle="Name the thing you've been putting off. Then keep going."
      footer={
        <>
          Already have an account?{" "}
          <Link
            href="/sign-in"
            className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
          >
            Sign in
          </Link>
        </>
      }
    >
      <AuthForm mode="sign-up" />
    </AuthShell>
  );
}
