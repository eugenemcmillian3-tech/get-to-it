import { formatProgress, type TaskCounts } from "@/lib/progress";

export function ProgressBar({ counts }: { counts: TaskCounts }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 text-sm">
        <span className="font-medium text-ink">{formatProgress(counts)}</span>
        <span className="text-muted">{counts.percentComplete}%</span>
      </div>
      <div
        className="mt-2 h-2 w-full overflow-hidden rounded-full bg-line"
        role="progressbar"
        aria-label="Goal progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={counts.percentComplete}
      >
        <div
          className="h-full rounded-full bg-brand transition-[width] duration-300"
          style={{ width: `${counts.percentComplete}%` }}
        />
      </div>
    </div>
  );
}
