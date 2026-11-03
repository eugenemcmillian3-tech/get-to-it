export default function TaskLoading() {
  return (
    <div className="mx-auto w-full max-w-3xl px-5 py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading this task</span>
      <div className="h-4 w-40 animate-pulse rounded-full bg-line" />
      <div className="mt-5 h-8 w-1/2 animate-pulse rounded-xl bg-line" />
      <div className="mt-6 h-64 w-full animate-pulse rounded-2xl bg-line/70" />
      <div className="mt-4 h-11 w-40 animate-pulse rounded-xl bg-line/70" />
    </div>
  );
}
