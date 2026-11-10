import { redirect } from "next/navigation";

/**
 * There is no list page at /goals: the list lives on the dashboard and the only
 * real goal routes are /goals/[goalId] and its children. A typed or bookmarked
 * /goals used to fall through to a 404, so it redirects instead.
 */
export default function GoalsIndexPage(): never {
  redirect("/dashboard");
}
