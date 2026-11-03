import { SETUP_REQUIRED_MESSAGE } from "@/lib/supabase/config";
import { cardClass, hintClass } from "@/lib/styles";

export function SetupNotice() {
  return (
    <section className={cardClass} aria-labelledby="setup-heading">
      <h2 id="setup-heading" className="text-lg font-semibold">
        Connect Supabase to use GET TO IT
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        {SETUP_REQUIRED_MESSAGE}
      </p>
      <ol className="mt-4 list-decimal space-y-2 pl-5 text-sm leading-relaxed text-muted">
        <li>Create (or open) a Supabase project.</li>
        <li>
          Run{" "}
          <code className="rounded bg-paper px-1.5 py-0.5 text-xs">
            supabase/migrations/0001_phase1_init.sql
          </code>{" "}
          in the SQL editor. It creates the tables, triggers and row level
          security policies.
        </li>
        <li>
          Copy{" "}
          <code className="rounded bg-paper px-1.5 py-0.5 text-xs">.env.example</code>{" "}
          to{" "}
          <code className="rounded bg-paper px-1.5 py-0.5 text-xs">.env.local</code>{" "}
          and add your project URL and anon key.
        </li>
        <li>Restart the dev server.</li>
      </ol>
      <p className={hintClass}>
        Nothing is faked while you set this up: sign-in and data stay
        unavailable rather than showing sample accounts or placeholder goals.
      </p>
    </section>
  );
}
