import Link from "next/link";
import { getSession } from "@/lib/auth";
import {
  cardClass,
  chipClass,
  focusRing,
  primaryButton,
  secondaryButton,
} from "@/lib/styles";

const STEPS = [
  {
    title: "Say what you want to accomplish",
    body: "One sentence. The thing you keep moving to tomorrow.",
  },
  {
    title: "Turn it into a plan",
    body: "Add what done looks like, the time you really have today, and what's in the way.",
  },
  {
    title: "Choose a next step",
    body: "Tasks are yours to write, rename, and complete. Start with the smallest one.",
  },
  {
    title: "Do the work and save it",
    body: "Every task has a workspace for notes and results. Save it without finishing.",
  },
  {
    title: "Come back and continue",
    body: "Progress is counted for you, so the next session starts where you left off.",
  },
];

export default async function LandingPage() {
  const session = await getSession();
  const startHref = session ? "/dashboard" : "/sign-up";
  const startLabel = session ? "BACK TO MY GOALS" : "LET'S GET TO IT";

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>

      <header className="mx-auto flex w-full max-w-3xl items-center justify-between px-5 py-5">
        <Link
          href="/"
          className={`text-sm font-black uppercase tracking-[0.25em] ${focusRing}`}
        >
          GET TO IT
        </Link>
        <nav aria-label="Account" className="text-sm">
          {session ? (
            <Link
              href="/dashboard"
              className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
            >
              My goals
            </Link>
          ) : (
            <Link
              href="/sign-in"
              className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
            >
              Sign in
            </Link>
          )}
        </nav>
      </header>

      <main id="main" className="mx-auto w-full max-w-3xl px-5 pb-20">
        <section className="pt-6 sm:pt-12">
          <p className={`${chipClass} uppercase tracking-wide`}>
            From “I should” to “I did.”
          </p>
          <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight sm:text-6xl">
            What have you been putting off?
          </h1>
          <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
            Name the thing. Break it into steps you can actually start. Do one
            piece of real work today — and keep it, so tomorrow is easier.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link href={startHref} className={`${primaryButton} sm:px-7`}>
              {startLabel}
            </Link>
            <a href="#stuck" className={`${secondaryButton} sm:px-7`}>
              I&apos;M STUCK
            </a>
          </div>
          <p className="mt-4 text-sm text-muted">
            No streak guilt. No scores. You decide the goal, the plan, and when
            something is done.
          </p>
        </section>

        <section aria-labelledby="how-it-works" className="mt-16">
          <h2 id="how-it-works" className="text-2xl font-black tracking-tight">
            How it works
          </h2>
          <ol className="mt-5 space-y-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className={cardClass}>
                <div className="flex gap-4">
                  <span
                    aria-hidden="true"
                    className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-bold text-brand-strong"
                  >
                    {index + 1}
                  </span>
                  <div>
                    <h3 className="font-semibold">{step.title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-muted">
                      {step.body}
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section
          id="stuck"
          aria-labelledby="stuck-heading"
          className="mt-16 scroll-mt-8 rounded-2xl border border-line bg-card p-5 sm:p-7"
        >
          <h2
            id="stuck-heading"
            className="text-2xl font-black tracking-tight"
          >
            I&apos;m stuck
          </h2>
          <p className="mt-3 max-w-xl leading-relaxed text-muted">
            Being stuck usually means the next step is too big, too vague, or
            carried alone. It isn&apos;t a character flaw, and it isn&apos;t a
            reason to give up on the goal.
          </p>
          <ul className="mt-5 grid gap-3 sm:grid-cols-3">
            <li className="rounded-xl bg-paper p-4">
              <h3 className="text-sm font-bold uppercase tracking-wide">
                Shrink it
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                If a step takes longer than ten minutes, cut it in half. Then
                cut it again if you need to.
              </p>
            </li>
            <li className="rounded-xl bg-paper p-4">
              <h3 className="text-sm font-bold uppercase tracking-wide">
                Name the friction
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                Write down what&apos;s actually in the way. “What&apos;s
                stopping you?” is a field in your goal, not a judgement.
              </p>
            </li>
            <li className="rounded-xl bg-paper p-4">
              <h3 className="text-sm font-bold uppercase tracking-wide">
                Take the next ten minutes
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">
                One small step today beats a perfect plan you never start.
              </p>
            </li>
          </ul>
          <Link href={startHref} className={`${primaryButton} mt-6 w-full sm:w-auto`}>
            {session ? "BACK TO MY GOALS" : "START WITH ONE SMALL STEP"}
          </Link>
        </section>

        <section
          aria-labelledby="promise-heading"
          className="mt-12 border-t border-line pt-8"
        >
          <h2 id="promise-heading" className="text-sm font-bold uppercase tracking-wide">
            What GET TO IT is
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            A place to turn “I should” into a plan and a plan into work you can
            see. Your goals, tasks, and saved work are private to your account.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-muted">
            GET TO IT helps you take action with everyday tasks. It doesn&apos;t
            diagnose or treat medical conditions. If you&apos;re struggling with
            your mental health, please reach out to a qualified professional.
          </p>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-1 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <span className="font-black uppercase tracking-[0.25em] text-ink">
            GET TO IT
          </span>
          <span>From “I should” to “I did.”</span>
        </div>
      </footer>
    </div>
  );
}
