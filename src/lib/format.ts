/** Formatting helpers shared by the goal views. */

export function formatDeadline(deadline: string | null): string | null {
  if (!deadline) return null;
  const date = new Date(`${deadline}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Shortens text to a limit, adding an ellipsis when it was cut. */
export function clip(text: string, limit: number): string {
  const clean = text.trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1).trimEnd()}…` : clean;
}

export function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  const rounded = Number.isInteger(hours) ? hours : Math.round(hours * 10) / 10;
  return `${rounded} hr`;
}
