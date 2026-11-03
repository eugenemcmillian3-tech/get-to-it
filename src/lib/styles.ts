/** Shared style tokens so the UI stays consistent across pages. */
export const focusRing =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

export const primaryButton =
  `inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand px-5 py-2.5 text-sm font-semibold tracking-wide text-white shadow-sm transition hover:bg-brand-strong disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;

export const secondaryButton =
  `inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl border border-line bg-card px-5 py-2.5 text-sm font-semibold text-ink transition hover:bg-brand-soft disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;

export const quietButton =
  `inline-flex min-h-9 cursor-pointer items-center justify-center gap-2 rounded-lg px-2.5 py-1.5 text-sm font-medium text-muted underline decoration-line underline-offset-4 transition hover:text-ink ${focusRing}`;

export const dangerButton =
  `inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-danger px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-danger-strong disabled:cursor-not-allowed disabled:opacity-60 ${focusRing}`;

export const inputClass =
  `w-full rounded-xl border border-line bg-card px-3.5 py-2.5 text-base text-ink placeholder:text-muted/70 ${focusRing}`;

export const labelClass = "block text-sm font-semibold text-ink";
export const hintClass = "mt-1 text-sm text-muted";
export const cardClass = "rounded-2xl border border-line bg-card p-4 shadow-[0_1px_0_rgba(26,22,19,0.04)] sm:p-5";
export const chipClass =
  "inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 text-xs font-medium text-muted";
