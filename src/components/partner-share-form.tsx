"use client";

import { useActionState, useState } from "react";
import { SubmitButton } from "@/components/submit-button";
import { idleFormState } from "@/lib/action-state";
import { updateShareAction } from "@/lib/actions/partner";
import {
  CHECKIN_MAX_LENGTH,
  MILESTONE_MAX_LENGTH,
} from "@/lib/partner";
import {
  focusRing,
  hintClass,
  inputClass,
  labelClass,
  secondaryButton,
} from "@/lib/styles";
import type { MyShareSettings } from "@/lib/types";

/**
 * What your partner may see. Every switch starts off, and turning one off
 * clears the text behind it rather than leaving it sitting there.
 */
export function PartnerShareForm({ share }: { share: MyShareSettings }) {
  const [state, formAction] = useActionState(updateShareAction, idleFormState);

  const [goalTitle, setGoalTitle] = useState(share.goal_title);
  const [completion, setCompletion] = useState(share.completion);
  const [milestone, setMilestone] = useState(share.milestone);
  const [checkin, setCheckin] = useState(share.checkin);

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <p className="text-sm leading-relaxed text-muted">
        Nothing is shared until you tick it. Your task notes, saved work, AI
        conversations, reflections and focus sessions are never available to a
        partner, whatever you choose here.
      </p>

      <ul className="space-y-2">
        <ShareToggle
          id="share_goal_title"
          checked={goalTitle}
          onChange={setGoalTitle}
          title="Goal titles"
          description="The names of up to five active goals."
        />
        <ShareToggle
          id="share_completion"
          checked={completion}
          onChange={setCompletion}
          title="Completion status"
          description="Counts only: tasks completed and goals finished. No task names."
        />
        <ShareToggle
          id="share_milestone"
          checked={milestone}
          onChange={setMilestone}
          title="A milestone you choose"
          description="One short line you write here."
        />
        <ShareToggle
          id="share_checkin"
          checked={checkin}
          onChange={setCheckin}
          title="A written check-in"
          description="A few sentences about where you are. Yours to rewrite any time."
        />
      </ul>

      <div>
        <label className={labelClass} htmlFor="milestone_text">
          Milestone
        </label>
        <input
          id="milestone_text"
          name="milestone_text"
          maxLength={MILESTONE_MAX_LENGTH}
          defaultValue={share.milestone_text ?? ""}
          disabled={!milestone}
          placeholder="e.g. Finish the first draft of the portfolio page"
          className={`mt-1.5 ${inputClass} disabled:opacity-50`}
        />
      </div>

      <div>
        <label className={labelClass} htmlFor="checkin_text">
          Check-in
        </label>
        <textarea
          id="checkin_text"
          name="checkin_text"
          rows={3}
          maxLength={CHECKIN_MAX_LENGTH}
          defaultValue={share.checkin_text ?? ""}
          disabled={!checkin}
          placeholder="Where I got to, what I'm trying next."
          className={`mt-1.5 ${inputClass} disabled:opacity-50`}
        />
        <p className={hintClass}>
          This is separate from your private weekly reflection, which is never
          shared.
        </p>
      </div>

      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          aria-live="polite"
          className={
            state.status === "error" ? "text-sm text-danger" : "text-sm text-mint"
          }
        >
          {state.message}
        </p>
      ) : null}

      <SubmitButton pendingLabel="Saving…" className={`${secondaryButton} ${focusRing}`}>
        Save what I share
      </SubmitButton>
    </form>
  );
}

function ShareToggle({
  id,
  checked,
  onChange,
  title,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  title: string;
  description: string;
}) {
  return (
    <li className="rounded-xl border border-line bg-paper p-3">
      <div className="flex items-start gap-3">
        <input
          id={id}
          name={id}
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          className={`mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--color-brand)] ${focusRing}`}
        />
        <div>
          <label htmlFor={id} className="cursor-pointer text-sm font-semibold">
            {title}
          </label>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            {description}
          </p>
        </div>
      </div>
    </li>
  );
}
