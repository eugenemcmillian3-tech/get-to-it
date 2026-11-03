/**
 * Fixtures for the task-workspace help tests.
 *
 * Shaped like real model replies: plain text, a fenced block, markdown the
 * model added anyway, markup, and two kinds of empty answer.
 */

export const plainSuggestion =
  "Open the draft and read the first paragraph out loud. Then write one sentence about what is missing. That sentence is today's work.";

export const fencedSuggestion = [
  "```text",
  "Pick the smallest piece: the title, then the first two sentences.",
  "```",
].join("\n");

export const markdownSuggestion = [
  "## The next move",
  "",
  "**Open** the draft and write *one* sentence.",
  "- then read it back",
  "- then stop",
].join("\n");

export const htmlSuggestion =
  "<p>Write one sentence.</p><script>alert('nope')</script><b>Then stop.</b>";

export const emptySuggestion = "   \n\t\n  ";

export const punctuationOnlySuggestion = "——— ... !!! ??";
