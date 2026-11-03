export default function DashboardLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your goals</span>
      <div className="h-3 w-28 animate-pulse rounded-full bg-line" />
      <div className="mt-4 h-9 w-3/4 animate-pulse rounded-xl bg-line" />
      <div className="mt-3 h-4 w-full animate-pulse rounded-full bg-line" />
      <div className="mt-8 h-24 w-full animate-pulse rounded-2xl bg-line/70" />
      <div className="mt-6 space-y-3">
        <div className="h-36 w-full animate-pulse rounded-2xl bg-line/70" />
        <div className="h-36 w-full animate-pulse rounded-2xl bg-line/70" />
      </div>
    </div>
  );
}
