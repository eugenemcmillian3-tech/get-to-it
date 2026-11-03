"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import type { AuthState } from "@/lib/action-state";
import {
  createSupabaseServerClient,
  type ServerSupabaseClient,
} from "@/lib/supabase/server";
import {
  getSupabaseSettings,
  SETUP_REQUIRED_MESSAGE,
} from "@/lib/supabase/config";
import {
  firstErrorMessage,
  readText,
  safeNextPath,
  signInSchema,
  signUpSchema,
} from "@/lib/validation";

function friendlyAuthError(message: string): string {
  const text = message.toLowerCase();
  if (text.includes("invalid login credentials")) {
    return "That email and password don't match. Try again.";
  }
  if (text.includes("already registered") || text.includes("already been registered")) {
    return "There's already an account with that email. Sign in instead.";
  }
  if (text.includes("email not confirmed")) {
    return "Confirm your email first — the link is in your inbox.";
  }
  if (text.includes("rate limit") || text.includes("too many")) {
    return "Too many tries in a short time. Wait a minute, then try again.";
  }
  if (text.includes("password")) {
    return "Use at least 8 characters for your password.";
  }
  return "We couldn't complete that just now. Try again.";
}

async function requestOrigin(): Promise<string> {
  const headerList = await headers();
  const host =
    headerList.get("x-forwarded-host") ??
    headerList.get("host") ??
    "localhost:3000";
  const proto =
    headerList.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.0.0.1")
      ? "http"
      : "https");
  return `${proto}://${host}`;
}

async function clientOrSetupError(): Promise<ServerSupabaseClient> {
  if (!getSupabaseSettings()) throw new Error(SETUP_REQUIRED_MESSAGE);
  const supabase = await createSupabaseServerClient();
  if (!supabase) throw new Error(SETUP_REQUIRED_MESSAGE);
  return supabase;
}

export async function signInAction(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signInSchema.safeParse({
    email: readText(formData, "email"),
    password: readText(formData, "password"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  let supabase: ServerSupabaseClient;
  try {
    supabase = await clientOrSetupError();
  } catch {
    return { status: "error", message: SETUP_REQUIRED_MESSAGE };
  }

  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    return { status: "error", message: friendlyAuthError(error.message) };
  }

  revalidatePath("/", "layout");
  redirect(safeNextPath(readText(formData, "next")));
}

export async function signUpAction(
  _previous: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const parsed = signUpSchema.safeParse({
    display_name: readText(formData, "display_name"),
    email: readText(formData, "email"),
    password: readText(formData, "password"),
  });
  if (!parsed.success) {
    return { status: "error", message: firstErrorMessage(parsed.error) };
  }

  let supabase: ServerSupabaseClient;
  try {
    supabase = await clientOrSetupError();
  } catch {
    return { status: "error", message: SETUP_REQUIRED_MESSAGE };
  }

  const origin = await requestOrigin();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.display_name || null },
      emailRedirectTo: `${origin}/auth/callback`,
    },
  });

  if (error) {
    return { status: "error", message: friendlyAuthError(error.message) };
  }

  if (!data.session) {
    return {
      status: "success",
      message:
        "Almost there. Check your email for the confirmation link, then sign in.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOutAction(): Promise<void> {
  const supabase = await createSupabaseServerClient();
  if (supabase) {
    await supabase.auth.signOut();
  }
  revalidatePath("/", "layout");
  redirect("/");
}
