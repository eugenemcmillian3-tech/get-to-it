import Link from "next/link";
import { getSession } from "@/lib/auth";
import { formatUsd } from "@/lib/credits/format";
import {
  CREDIT_PACK_DEFINITIONS,
  CREDIT_VALUE_LABEL,
} from "@/lib/credits/pricing";
import {
  cardClass,
  chipClass,
  focusRing,
  primaryButton,
  secondaryButton,
} from "@/lib/styles";

const STARTER_PACK = CREDIT_PACK_DEFINITIONS[0];

const FEATURES = [
  {
    kicker: "Start",
    title: "A next step, not a lecture",
    body: "Your dashboard surfaces one unfinished task and shows you a smaller version you can start with. No streak guilt, no score, no productivity theatre.",
  },
  {
    kicker: "Plan",
    title: "Plans you approve",
    body: "Ask for a goal plan and get 3–7 concrete tasks. Edit every field, remove what does not fit, or discard it. Nothing is saved until you say so.",
  },
  {
    kicker: "Work",
    title: "A real place to do the work",
    body: "Keep notes, drafts and results beside every task. Use the optional focus timer, then come back to the exact place you stopped.",
  },
  {
    kicker: "Notice",
    title: "Progress without the guilt",
    body: "Four plain figures show what you completed, saved and focused on. A private weekly check-in gives you somewhere to think without changing your plan.",
  },
  {
    kicker: "Include",
    title: "Share only what you choose",
    body: "Small workspaces add roles, shared goals, assignments and comments. An accountability partner sees only the switches you turn on.",
  },
  {
    kicker: "Build",
    title: "A controlled agent team",
    body: "Turn an approved app specification into a bounded queue for frontend, backend, data, QA and security roles. Every file has one owner and every limit is enforced.",
  },
];

const VALUES = [
  {
    title: "Prepaid, not recurring",
    body: "Buy a credit pack when you need one. There is no subscription and nothing renews behind your back.",
  },
  {
    title: "You see the price",
    body: `Most AI actions cost 1 credit (${CREDIT_VALUE_LABEL}); a build repair costs 2. The price is shown before a paid action starts.`,
  },
  {
    title: "Your work is portable",
    body: "Goals, tasks, saved work and records can be exported as plain JSON. You are not renting access to your own history.",
  },
  {
    title: "Human approval stays human",
    body: "AI proposes. You approve. Workflows pause for review, and the agent team cannot deploy, spend, or act outside its allowed tools.",
  },
];

const STEPS = [
  {
    number: "01",
    title: "Name the thing",
    body: "Write the outcome you keep avoiding. Add the time you really have and what is in the way.",
  },
  {
    number: "02",
    title: "Make it smaller",
    body: "Turn it into a short plan, pick one next step, and start a focus session when you are ready.",
  },
  {
    number: "03",
    title: "Keep the proof",
    body: "Save notes and results as you go. Your progress is a record of work, not a judgement of your week.",
  },
];

const TEAM_STEPS = [
  {
    title: "Approve the specification",
    body: "Pages, entities and acceptance checks are fixed before work starts. The coordinator cannot quietly add scope.",
  },
  {
    title: "Queue scoped roles",
    body: "Frontend, backend, data, QA and security get explicit tools, file ownership and a time and call budget.",
  },
  {
    title: "Run bounded tasks",
    body: "At most four agents advance at once. Conflicting file claims become a blocker for you to resolve, not a silent overwrite.",
  },
  {
    title: "Integrate once",
    body: "Completed branches merge in one owner-triggered step with attribution and checks. Nothing deploys or touches credentials.",
  },
];

const TEAM_LIMITS = [
  "1–4 agents per advance",
  "24 AI calls maximum",
  "60–1,800s runtime",
  "0 credits today — fixture only",
];

function ProductPreview() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:max-w-none">
      <div
        aria-hidden="true"
        className="absolute -inset-3 rounded-[2.5rem] bg-brand/10 blur-2xl"
      />
      <div className="relative rounded-[2rem] border border-line bg-card p-3 shadow-[0_30px_90px_rgba(26,22,19,0.16)] sm:p-4">
        <div className="flex items-center justify-between px-2 py-1.5 text-xs text-muted">
          <span className="font-semibold uppercase tracking-[0.16em]">
            Your workspace
          </span>
          <span>Private by default</span>
        </div>

        <div className="mt-2 rounded-2xl bg-ink p-5 text-paper">
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-paper/60">
            Today&apos;s next step
          </p>
          <p className="mt-2 text-xl font-semibold leading-snug">
            Write the first paragraph of the case study.
          </p>
          <div className="mt-4 flex flex-wrap gap-2 text-xs">
            <span className="rounded-full bg-white/10 px-2.5 py-1">
              10 min
            </span>
            <span className="rounded-full bg-white/10 px-2.5 py-1">
              1 credit if you ask AI
            </span>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            ["3", "notes kept"],
            ["2", "tasks done"],
            ["1", "goal"],
          ].map(([value, label]) => (
            <div key={label} className="rounded-xl bg-paper p-3">
              <p className="text-2xl font-black leading-none">{value}</p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-muted">
                {label}
              </p>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-2xl border border-line p-4">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold">Portfolio case study</span>
            <span className="text-muted">40%</span>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-line">
            <div className="h-full w-2/5 rounded-full bg-brand" />
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Next: add the outcome and one screenshot.
          </p>
        </div>

        <div className="mt-3 flex items-center justify-between rounded-2xl border border-line bg-paper px-4 py-3 text-xs">
          <span className="font-semibold">No subscription</span>
          <span className="text-muted">Credits never auto-renew</span>
        </div>
      </div>
    </div>
  );
}

export default async function LandingPage() {
  const session = await getSession();
  const startHref = session ? "/dashboard" : "/sign-up";
  const startLabel = session ? "Back to my workspace" : "Start with one goal";

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold"
      >
        Skip to content
      </a>

      <header className="sticky top-0 z-40 border-b border-line/80 bg-paper/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link
            href="/"
            className={`text-sm font-black uppercase tracking-[0.25em] ${focusRing}`}
          >
            GET TO IT
          </Link>

          <nav
            aria-label="Page"
            className="hidden items-center gap-5 text-sm font-medium text-muted md:flex"
          >
            <a
              href="#product"
              className={`rounded transition hover:text-ink ${focusRing}`}
            >
              Product
            </a>
            <a
              href="#pricing"
              className={`rounded transition hover:text-ink ${focusRing}`}
            >
              Pricing
            </a>
            <a
              href="#agent-team"
              className={`rounded transition hover:text-ink ${focusRing}`}
            >
              Agent team
            </a>
          </nav>

          <div className="flex items-center gap-3 text-sm">
            {session ? (
              <Link
                href="/dashboard"
                className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
              >
                My workspace
              </Link>
            ) : (
              <Link
                href="/sign-in"
                className={`font-semibold text-ink underline decoration-line underline-offset-4 ${focusRing}`}
              >
                Sign in
              </Link>
            )}
            <Link
              href={startHref}
              className={`${primaryButton} hidden sm:inline-flex`}
            >
              {session ? "Open dashboard" : "Get started"}
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-6xl px-5 pb-20">
        <section className="grid gap-10 pt-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center lg:pt-16">
          <div>
            <p className={`${chipClass} uppercase tracking-[0.14em]`}>
              From “I should” to “I did.”
            </p>
            <h1 className="mt-5 max-w-3xl text-4xl font-black leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
              Make the thing you keep putting off the thing you finished.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-muted">
              GET TO IT turns the work you have been avoiding into one clear
              next step, a plan you approve, and a private record of what you
              actually moved.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href={startHref} className={`${primaryButton} sm:px-7`}>
                {startLabel}
              </Link>
              <a href="#product" className={`${secondaryButton} sm:px-7`}>
                See what you get
              </a>
            </div>

            <p className="mt-4 max-w-lg text-sm leading-relaxed text-muted">
              No subscription. AI work is prepaid per action. Start with a
              {formatUsd(STARTER_PACK.amount_cents)} pack when you are ready —
              not before.
            </p>

            <dl className="mt-8 grid max-w-lg grid-cols-3 gap-4 border-t border-line pt-5">
              {[
                ["1", "next step, surfaced"],
                [CREDIT_VALUE_LABEL, "per credit"],
                ["0", "streak guilt"],
              ].map(([value, label]) => (
                <div key={label}>
                  <dt className="text-2xl font-black tracking-tight">
                    {value}
                  </dt>
                  <dd className="mt-1 text-xs leading-relaxed text-muted">
                    {label}
                  </dd>
                </div>
              ))}
            </dl>
          </div>

          <ProductPreview />
        </section>

        <section id="product" className="mt-20 scroll-mt-8">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-strong">
              What you get
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              One system from “I should” to “I did.”
            </h2>
            <p className="mt-3 leading-relaxed text-muted">
              Not another list. A place to decide, plan, start, save the proof,
              and come back without starting over.
            </p>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature, index) => (
              <article key={feature.title} className={cardClass}>
                <div className="flex items-center gap-2">
                  <span className="flex size-7 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong">
                    {String(index + 1).padStart(2, "0")}
                  </span>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted">
                    {feature.kicker}
                  </p>
                </div>
                <h3 className="mt-3 text-lg font-bold leading-snug">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {feature.body}
                </p>
              </article>
            ))}
          </div>
        </section>

        <section className="mt-20 rounded-[2rem] bg-ink p-6 text-paper shadow-[0_24px_80px_rgba(26,22,19,0.16)] sm:p-10">
          <div className="grid gap-8 lg:grid-cols-[0.85fr_1.15fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-paper/60">
                Why it is worth paying for
              </p>
              <h2 className="mt-2 text-3xl font-black leading-tight tracking-tight sm:text-4xl">
                You are paying for forward motion, not another subscription.
              </h2>
              <p className="mt-4 max-w-md text-sm leading-relaxed text-paper/70">
                The product is designed around one question: did this help you
                start and keep something real? If not, it is not worth the
                money.
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              {VALUES.map((value) => (
                <div
                  key={value.title}
                  className="rounded-2xl border border-white/10 bg-white/5 p-4"
                >
                  <h3 className="text-sm font-bold">{value.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-paper/70">
                    {value.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="pricing" className="mt-20 scroll-mt-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="max-w-2xl">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-strong">
                Simple pricing
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
                Start small. Pay for what you use.
              </h2>
              <p className="mt-3 leading-relaxed text-muted">
                One credit is {CREDIT_VALUE_LABEL}. AI actions are prepaid, so
                there is no surprise monthly bill and no auto-renewal.
              </p>
            </div>
            <Link
              href="/credits"
              className={`${secondaryButton} w-full sm:w-auto`}
            >
              See credit details
            </Link>
          </div>

          <div className="mt-6 grid gap-2.5 sm:grid-cols-2 lg:grid-cols-5">
            {CREDIT_PACK_DEFINITIONS.map((pack) => (
              <div
                key={pack.slug}
                className="rounded-2xl border border-line bg-card p-4"
              >
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted">
                  {pack.label}
                </p>
                <p className="mt-3 text-2xl font-black tracking-tight">
                  {formatUsd(pack.amount_cents)}
                </p>
                <p className="mt-1 text-xs text-muted">one-time</p>
              </div>
            ))}
          </div>

          <p className="mt-3 max-w-3xl text-xs leading-relaxed text-muted">
            Most AI actions cost 1 credit ({CREDIT_VALUE_LABEL}); a build repair
            attempt costs 2. The credits page shows the current price for every
            action and whether checkout is available on this deployment.
          </p>
        </section>

        <section className="mt-20">
          <div className="max-w-2xl">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-strong">
              How it works
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              Three moves, repeated.
            </h2>
          </div>

          <ol className="mt-6 grid gap-3 sm:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.number} className={cardClass}>
                <p className="text-sm font-black tracking-[0.16em] text-brand-strong">
                  {step.number}
                </p>
                <h3 className="mt-3 text-lg font-bold">{step.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {step.body}
                </p>
              </li>
            ))}
          </ol>
        </section>

        <section
          id="agent-team"
          className="mt-20 scroll-mt-8 rounded-[2rem] border border-line bg-card p-6 sm:p-10"
        >
          <div className="grid gap-8 lg:grid-cols-[1.05fr_0.95fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-strong">
                Build mode
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
                A team when the job is bigger than one step.
              </h2>
              <p className="mt-3 max-w-2xl leading-relaxed text-muted">
                The agent team is a controlled project mode, not an autonomous
                swarm. One approved specification becomes a bounded queue of
                scoped roles. Each role has explicit tools, file ownership and a
                budget; you decide when to advance, pause, reject or integrate.
              </p>

              <div className="mt-4 flex flex-wrap gap-2">
                {TEAM_LIMITS.map((limit) => (
                  <span key={limit} className={chipClass}>
                    {limit}
                  </span>
                ))}
              </div>

              <ol className="mt-6 space-y-3">
                {TEAM_STEPS.map((step, index) => (
                  <li key={step.title} className="flex gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-bold text-brand-strong">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="text-sm font-bold">{step.title}</h3>
                      <p className="mt-0.5 text-sm leading-relaxed text-muted">
                        {step.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="rounded-2xl bg-paper p-5">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted">
                What it is not
              </p>
              <ul className="mt-3 space-y-2 text-sm leading-relaxed text-muted">
                <li>No recursive spawning or unlimited retries.</li>
                <li>No deployment, production credentials or external actions.</li>
                <li>No agent can widen its own permissions or scope.</li>
                <li>No paid multi-agent calls today — the workers are fixtures.</li>
              </ul>
              <p className="mt-4 rounded-xl border border-line bg-card p-3 text-xs leading-relaxed text-muted">
                Fixture mode proves the queue, permissions, conflict handling
                and integration flow before spending money on live agents. It is
                deliberately honest about what is not built yet.
              </p>
              <Link
                href="/build"
                className={`${primaryButton} mt-5 w-full sm:w-auto`}
              >
                Open Build an App
              </Link>
            </div>
          </div>
        </section>

        <section
          id="stuck"
          className="mt-20 scroll-mt-8 grid gap-6 border-t border-line pt-10 lg:grid-cols-[0.8fr_1.2fr]"
        >
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-strong">
              When you are stuck
            </p>
            <h2 className="mt-2 text-3xl font-black tracking-tight sm:text-4xl">
              Stuck is information, not a verdict.
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-muted">
              Usually the next step is too big, too vague, or being carried
              alone. GET TO IT gives you a smaller way in instead of another
              reason to feel bad.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            {[
              [
                "Shrink it",
                "If a step takes more than ten minutes, cut it in half. Then cut it again.",
              ],
              [
                "Name the friction",
                "Write down what is actually in the way. The goal form has a field for it.",
              ],
              [
                "Take ten minutes",
                "One small step today beats a perfect plan you never start.",
              ],
            ].map(([title, body]) => (
              <div key={title} className="rounded-2xl bg-card p-4">
                <h3 className="text-sm font-bold">{title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">
                  {body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-20 rounded-[2rem] bg-brand p-7 text-white shadow-[0_24px_70px_rgba(228,87,46,0.28)] sm:p-10">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="max-w-2xl text-3xl font-black leading-tight tracking-tight sm:text-4xl">
                Your next step is already in there.
              </h2>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-white/80">
                Name it, make it smaller, and keep the proof. You can start with
                one goal and a {formatUsd(STARTER_PACK.amount_cents)} credit pack
                when you need AI help.
              </p>
            </div>
            <Link
              href={startHref}
              className={`inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-white px-6 py-3 text-sm font-bold text-brand-strong shadow-sm transition hover:bg-paper ${focusRing}`}
            >
              {startLabel}
            </Link>
          </div>
        </section>

        <section className="mt-10 border-t border-line pt-6">
          <p className="max-w-3xl text-xs leading-relaxed text-muted">
            GET TO IT helps you take action with everyday tasks. It does not
            diagnose or treat medical conditions. If you are struggling with
            your mental health, please reach out to a qualified professional.
          </p>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 px-5 py-8 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <span className="font-black uppercase tracking-[0.25em] text-ink">
            GET TO IT
          </span>
          <span>From “I should” to “I did.”</span>
          <Link
            href={session ? "/dashboard" : "/sign-in"}
            className={`rounded underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
          >
            {session ? "Open dashboard" : "Sign in"}
          </Link>
        </div>
      </footer>
    </div>
  );
}
