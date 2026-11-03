import { formatFocusTotal } from "@/lib/focus";
import type { ProgressSnapshot } from "@/lib/progress";
import { cardClass } from "@/lib/styles";

/**
 * Four separate facts, never combined into one number.
 * There is no productivity score and no wellbeing score anywhere in GET TO IT.
 */
export function ProgressOverview({ progress }: { progress: ProgressSnapshot }) {
  const items = [
    {
      label: "Completed tasks",
      value: String(progress.completedTasks),
      note:
        progress.openTasks === 0
          ? "Nothing open right now."
          : `${progress.openTasks} still open.`,
    },
    {
      label: "Tasks with saved work",
      value: String(progress.savedWork),
      note: "Notes, drafts and results you kept.",
    },
    {
      label: "Completed goals",
      value: `${progress.completedGoals} of ${progress.totalGoals}`,
      note: "A goal counts once every task in it is complete.",
    },
    {
      label: "Focus time recorded",
      value: formatFocusTotal(progress.focusSeconds),
      note:
        progress.focusSessions === 1
          ? "From 1 focus session."
          : `From ${progress.focusSessions} focus sessions.`,
    },
  ];

  return (
    <section aria-labelledby="progress-heading" className="mt-10">
      <h2 id="progress-heading" className="text-lg font-bold">
        Your progress
      </h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Counts of what you actually did. No score, no streak, no rating of your
        week.
      </p>

      <dl className={`${cardClass} mt-3 grid grid-cols-2 gap-4 sm:grid-cols-4`}>
        {items.map((item) => (
          <div key={item.label}>
            <dt className="text-xs font-semibold uppercase tracking-wide text-muted">
              {item.label}
            </dt>
            <dd className="mt-1 text-2xl font-black leading-none">
              {item.value}
            </dd>
            <p className="mt-1.5 text-xs leading-relaxed text-muted">
              {item.note}
            </p>
          </div>
        ))}
      </dl>
    </section>
  );
}
