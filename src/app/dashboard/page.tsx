import type { Metadata } from "next";
import Link from "next/link";
import { CheckinForm } from "@/components/checkin-form";
import { DeleteAccountCard } from "@/components/delete-account-card";
import { FeedbackForm } from "@/components/feedback-form";
import { CreateGoalForm } from "@/components/forms";
import { NextStepCard } from "@/components/next-step-card";
import { ProgressBar } from "@/components/progress-bar";
import { ProgressOverview } from "@/components/progress-overview";
import { SetupNotice } from "@/components/setup-notice";
import { SiteHeader } from "@/components/site-header";
import { archiveGoalAction, restoreGoalAction } from "@/lib/actions/goals";
import { requireSession } from "@/lib/auth";
import { currentWeekStart } from "@/lib/focus";
import { listGoalsPage, listTaskStatuses } from "@/lib/data/goals";
import { getCurrentCheckin, getDashboardData } from "@/lib/data/progress";
import { formatDeadline, formatMinutes } from "@/lib/format";
import { getIdentity } from "@/lib/identity";
import { summarizeTaskStatuses } from "@/lib/progress";
import { getSupabaseSettings } from "@/lib/supabase/config";
import {
  cardClass,
  chipClass,
  focusRing,
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "@/lib/styles";
import {
  DEFAULT_GOAL_FILTERS,
  goalListHref,
  hasActiveGoalFilters,
  parseGoalListParams,
} from "@/lib/templates/helpers";
import { TEMPLATE_CATEGORIES, categoryLabel } from "@/lib/templates/library";

export const metadata: Metadata = { title: "Your goals — GET TO IT" };

const QUICK_LINKS = [
  {
    href: "/plan",
    label: "Plan today",
    note: "Fit tasks to the time you actually have.",
  },
  {
    href: "/templates",
    label: "Start from a template",
    note: "Use a proven outline instead of a blank page.",
  },
  {
    href: "/workspace",
    label: "Open workspaces",
    note: "Share goals and tasks with a small team.",
  },
  {
    href: "/workflows",
    label: "Run a workflow",
    note: "Move a repeatable process through review.",
  },
  {
    href: "/build",
    label: "Build an app",
    note: "Spec it, preview it, and use a controlled agent team.",
  },
];

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  if (!getSupabaseSettings()) {
    return (
      <main className="mx-auto w-full max-w-3xl px-5 py-10">
        <h1 className="text-3xl font-black tracking-tight sm:text-4xl">
          What have you been putting off?
        </h1>
        <div className="mt-6">
          <SetupNotice />
        </div>
      </main>
    );
  }

  const session = await requireSession();
  const params = await searchParams;
  const filters = parseGoalListParams(params);

  const [identity, page, statuses, dashboard, checkin] = await Promise.all([
    getIdentity(session),
    listGoalsPage(session, filters),
    listTaskStatuses(session),
    getDashboardData(session),
    getCurrentCheckin(session),
  ]);

  const filtered = hasActiveGoalFilters(filters);
  const firstResult = page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
  const lastResult = Math.min(page.page * page.pageSize, page.total);
  const firstName = identity.displayName.trim().split(/\s+/)[0] || "there";
  const todayLabel = new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());
  const goalCountLabel =
    page.total === 1 ? "1 goal" : `${page.total.toLocaleString("en-US")} goals`;

  return (
    <div className="min-h-dvh">
      <SiteHeader displayName={identity.displayName} email={identity.email} />

      <main className="mx-auto w-full max-w-5xl px-5 pb-16 pt-7">
        <section className="relative overflow-hidden rounded-[2rem] border border-line bg-[linear-gradient(135deg,#fffdfa_0%,#fdf0e8_58%,#f8e7d8_100%)] p-6 shadow-[0_1px_0_rgba(26,22,19,0.04)] sm:p-8">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -right-16 -top-24 size-64 rounded-full bg-brand/10 blur-3xl"
          />
          <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-strong">
                Your workspace · {todayLabel}
              </p>
              <h1 className="mt-3 max-w-2xl text-3xl font-black leading-tight tracking-tight sm:text-4xl">
                Good to see you, {firstName}.
              </h1>
              <p className="mt-3 max-w-2xl leading-relaxed text-muted">
                One clear next step, a plan you control, and a record of the work
                you actually moved. Start with the smallest useful thing.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href="/plan" className={primaryButton}>
                Plan my day
              </Link>
              <Link href="/templates" className={secondaryButton}>
                Use a template
              </Link>
            </div>
          </div>
        </section>

        <ProgressOverview progress={dashboard.progress} className="mt-6" />

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-6">
            <NextStepCard
              nextStep={dashboard.nextStep}
              activeSession={dashboard.activeSession}
              className=""
            />

            <section aria-labelledby="goals-heading">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <div>
                  <h2 id="goals-heading" className="text-lg font-bold">
                    Your goals
                  </h2>
                  <p className="mt-1 text-sm leading-relaxed text-muted">
                    Name the outcome, then keep the list small enough to act on.
                  </p>
                </div>
                <span className={chipClass}>{goalCountLabel}</span>
              </div>

              <form
                method="get"
                action="/dashboard"
                className="mt-4 rounded-2xl border border-line bg-card p-3"
              >
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8.5rem_10rem_auto] sm:items-end">
                  <div>
                    <label htmlFor="goal-search" className={labelClass}>
                      Search
                    </label>
                    <input
                      id="goal-search"
                      name="q"
                      type="search"
                      defaultValue={filters.q}
                      maxLength={80}
                      placeholder="Search titles and outcomes"
                      className={`mt-1.5 ${inputClass}`}
                    />
                  </div>
                  <div>
                    <label htmlFor="goal-state" className={labelClass}>
                      Status
                    </label>
                    <select
                      id="goal-state"
                      name="state"
                      defaultValue={filters.state}
                      className={`mt-1.5 ${inputClass}`}
                    >
                      <option value="active">Active</option>
                      <option value="archived">Archived</option>
                      <option value="all">All</option>
                    </select>
                  </div>
                  <div>
                    <label htmlFor="goal-category" className={labelClass}>
                      Category
                    </label>
                    <select
                      id="goal-category"
                      name="category"
                      defaultValue={filters.category}
                      className={`mt-1.5 ${inputClass}`}
                    >
                      <option value="all">All categories</option>
                      {TEMPLATE_CATEGORIES.map((entry) => (
                        <option key={entry.slug} value={entry.slug}>
                          {entry.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-end">
                    <button type="submit" className={`${secondaryButton} w-full`}>
                      Filter
                    </button>
                  </div>
                </div>

                {filtered ? (
                  <p className="mt-3 text-sm">
                    <Link
                      href={goalListHref(DEFAULT_GOAL_FILTERS)}
                      className={`rounded text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
                    >
                      Clear search and filters
                    </Link>
                  </p>
                ) : null}
              </form>

              {page.total > 0 ? (
                <p className="mt-3 text-sm text-muted">
                  Showing {firstResult}–{lastResult} of {page.total}{" "}
                  {page.total === 1 ? "goal" : "goals"}.
                </p>
              ) : null}

              {page.total === 0 ? (
                <div className={`${cardClass} mt-3`}>
                  {filtered ? (
                    <>
                      <p className="font-medium">No goals match that.</p>
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        Try a different word, or clear the filters to see
                        everything.
                      </p>
                    </>
                  ) : (
                    <>
                      <p className="font-medium">No goals yet.</p>
                      <p className="mt-1 text-sm leading-relaxed text-muted">
                        Add the thing you keep moving to tomorrow, or start from
                        a template. You can rename it, split it into tasks, or
                        delete it at any time.
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <ul className="mt-3 space-y-3">
                  {page.goals.map((goal) => {
                    const counts = summarizeTaskStatuses(
                      statuses.filter((task) => task.goal_id === goal.id),
                    );
                    const deadline = formatDeadline(goal.deadline);
                    const label = categoryLabel(goal.category);
                    const archived = goal.archived_at !== null;

                    return (
                      <li
                        key={goal.id}
                        className="rounded-2xl border border-line bg-card p-4 shadow-[0_1px_0_rgba(26,22,19,0.04)] transition hover:border-brand/25 sm:p-5"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                          <div className="min-w-0">
                            <div className="flex flex-wrap gap-2">
                              {label ? (
                                <span className={chipClass}>{label}</span>
                              ) : null}
                              {archived ? (
                                <span className={chipClass}>Archived</span>
                              ) : null}
                              {deadline ? (
                                <span className={chipClass}>Due {deadline}</span>
                              ) : (
                                <span className={chipClass}>No deadline</span>
                              )}
                              <span className={chipClass}>
                                {formatMinutes(goal.time_available_minutes)} today
                              </span>
                              {counts.inProgress > 0 ? (
                                <span className={chipClass}>
                                  {counts.inProgress} in progress
                                </span>
                              ) : null}
                            </div>

                            <h3 className="mt-2 text-lg font-semibold leading-snug">
                              <Link
                                href={`/goals/${goal.id}`}
                                className={`rounded hover:underline ${focusRing}`}
                              >
                                {goal.title}
                              </Link>
                            </h3>
                            <p className="mt-1 line-clamp-2 text-sm leading-relaxed text-muted">
                              {goal.desired_outcome}
                            </p>
                          </div>

                          <span className={`${chipClass} shrink-0`}>
                            {counts.percentComplete}% complete
                          </span>
                        </div>

                        <div className="mt-4">
                          <ProgressBar counts={counts} />
                        </div>

                        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-3">
                          <Link
                            href={`/goals/${goal.id}`}
                            className={`rounded text-sm font-semibold text-ink underline decoration-line underline-offset-4 hover:decoration-ink ${focusRing}`}
                          >
                            Open goal →
                          </Link>

                          <form
                            action={
                              archived ? restoreGoalAction : archiveGoalAction
                            }
                          >
                            <input
                              type="hidden"
                              name="goal_id"
                              value={goal.id}
                            />
                            <button
                              type="submit"
                              className={`cursor-pointer rounded text-sm font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink ${focusRing}`}
                            >
                              {archived ? "Restore" : "Archive"}
                            </button>
                          </form>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              {page.pageCount > 1 ? (
                <nav
                  aria-label="Goal pages"
                  className="mt-4 flex flex-wrap items-center justify-between gap-3"
                >
                  {page.page > 1 ? (
                    <Link
                      href={goalListHref(filters, { page: page.page - 1 })}
                      className={secondaryButton}
                    >
                      ← Newer goals
                    </Link>
                  ) : (
                    <span />
                  )}

                  <span className="text-sm text-muted">
                    Page {page.page} of {page.pageCount}
                  </span>

                  {page.page < page.pageCount ? (
                    <Link
                      href={goalListHref(filters, { page: page.page + 1 })}
                      className={secondaryButton}
                    >
                      Older goals →
                    </Link>
                  ) : (
                    <span />
                  )}
                </nav>
              ) : null}
            </section>
          </div>

          <aside className="space-y-6">
            <div id="add-goal">
              <CreateGoalForm
                defaultOpen={page.total === 0 && !filtered}
              />
            </div>

            <section className={cardClass} aria-labelledby="shortcuts-heading">
              <h2
                id="shortcuts-heading"
                className="text-xs font-semibold uppercase tracking-[0.18em] text-muted"
              >
                Shortcuts
              </h2>
              <ul className="mt-2 divide-y divide-line">
                {QUICK_LINKS.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className={`group flex items-start justify-between gap-3 rounded-xl px-1 py-2.5 transition hover:bg-paper ${focusRing}`}
                    >
                      <span>
                        <span className="block text-sm font-semibold">
                          {link.label}
                        </span>
                        <span className="mt-0.5 block text-xs leading-relaxed text-muted">
                          {link.note}
                        </span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="pt-0.5 text-muted transition group-hover:translate-x-0.5 group-hover:text-brand-strong"
                      >
                        →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </aside>
        </div>

        <div className="mt-10 grid gap-6 lg:grid-cols-2">
          <CheckinForm
            weekStart={currentWeekStart()}
            existing={checkin}
            className=""
          />
          <FeedbackForm className="" />
        </div>

        <div className="mt-10 border-t border-line pt-8">
          <DeleteAccountCard className="" />
        </div>
      </main>
    </div>
  );
}
