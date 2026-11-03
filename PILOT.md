# GET TO IT — private pilot

Instructions for a small invited group. **No participant results are claimed
here**: this file is the plan for collecting feedback, not a report on it.

## Who this is for

Five to eight people who each have one real thing they keep putting off. A
private pilot, not a launch: no community, no leaderboards, no notifications,
no messaging integrations.

## Before you invite anyone

1. The release is deployed and the source revision is recorded (see the release
   note in `BUILD_STATUS.md`).
2. Sign-up email works. Either email confirmation is on and delivery is
   configured, or it is off and accounts are usable immediately — decide before
   inviting people, because a broken confirmation link is the most common first
   failure.
3. `OLLAMA_API_KEY` and the AI request limits are set, and the per-person daily
   allowance suits the group size (default 15 requests per person per day, 200
   per day in total for everyone).
4. You have said, in the invitation, what is sent to the AI provider. Copy the
   "What gets sent to the AI provider" section of `README.md`; do not paraphrase
   it into something vaguer.

## Invitation text

> I'm trying out GET TO IT with a handful of people. It's a small tool for
> naming something you keep putting off, turning it into steps, and keeping the
> work you actually do — including an optional timer and an optional weekly
> check-in. It uses an open model to suggest next steps; the notes you save are
> sent with those requests, so keep genuinely private material out of it.
> You can delete your account yourself at any time. Reply to this message with
> anything that felt wrong.

## The four things worth asking about

Ask these as open questions; do not lead with suggestions. The pilot is about
what happened, not what you hope happened.

1. **Starting a task.** "When you opened it, what did you do first? Was there a
   point where you weren't sure what to click?"
2. **Producing useful work.** "Did you save anything you'd keep? If not, what
   stopped you — the editor, the task, or the moment?"
3. **Getting unstuck.** "Did you use the AI help or the timer? What did it say
   or do, and did it change what you did next?"
4. **Returning later.** "When you came back, could you tell where you'd left
   off? What was confusing about the first thirty seconds?"

Two extra questions that have been useful in this build:

- "Did anything you wrote get lost or look like it might?" (saved work, drafts,
  timer state)
- "Was anything asked of you that felt like a score or a judgement?"

## What to watch for without asking

- Someone refreshing mid-timer: the clock should recover, not restart.
- Someone deleting an account: the confirmation should be clear, and the
  shared AI allowance should not jump back up.
- Anyone using two tabs with the AI: the second request should say one is
  already running rather than spending another.
- Mobile use: the forms, the timer buttons and the dashboard figures.

## Ground rules for the pilot

- Do not put passwords, API keys or other people's personal data into goals,
  tasks or notes.
- One account per person; no shared logins.
- The AI can be wrong. Nothing it writes is applied automatically, and time on
  the timer never completes a task.
- Feedback goes through the form on the dashboard, or directly to you.

## After the pilot

Summarise what participants actually said, in their words, and label anything
you infer. Do not describe participant results as positive until participants
have said so. Record decisions that follow from the feedback as a separate
change, with the same review as any other.
