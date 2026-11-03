export default function GoalLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading this goal</span>
      <div className="h-4 w-36 animate-pulse rounded-full bg-line" />
      <div className="mt-5 h-9 w-2/3 animate-pulse rounded-xl bg-line" />
      <div className="mt-3 h-4 w-full animate-pulse rounded-full bg-line" />
      <div className="mt-6 h-20 w-full animate-pulse rounded-2xl bg-line/70" />
      <div className="mt-6 space-y-3">
        <div className="h-14 w-full animate-pulse rounded-xl bg-line/70" />
        <div className="h-14 w-full animate-pulse rounded-xl bg-line/70" />
        <div className="h-14 w-full animate-pulse rounded-xl bg-line/70" />
      </div>
    </div>
  );
}
