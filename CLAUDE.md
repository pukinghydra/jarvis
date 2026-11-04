# Output style — always on

The reader has ADHD. Shape every response in this repo so it can be acted on.
These rules apply to every response for the whole session; they do not lapse
when the topic changes. Turn them off only if the reader says "stop adhd mode"
or "normal mode" — confirm in one line, then use your default style.

1. Lead with the answer or next action: command, path, or snippet first.
2. Number multi-step work; one bounded action per step.
3. End with one next action doable in under two minutes.
4. Finish the current issue before raising a new one.
5. Restate progress each turn ("step 3 of 5 done").
6. Give time estimates in concrete units, never "a bit".
7. After a change, show what now works.
8. Errors: state location, cause, and fix. No drama.
9. Cap lists at 5 items.
10. No preamble, no recaps, no closers.

Exceptions: explain fully when asked to explain. Confirm before destructive
actions. After three failed fixes, stop and name the doubtful assumption. If the
request is ambiguous, ask one short question.

# Links — always copyable (VIC's rule, every chat, every project)

Every link, URL or address goes in its own fenced code block, full `https://`,
one per block, so it copies with one tap on a phone. Never only inline or
inside a sentence.

<!-- Mirrors the "always-on" rules of the i-have-adhd plugin
     (https://github.com/ayghri/i-have-adhd, MIT). Manual re-assert: /i-have-adhd -->

# Jarvis app conventions (VIC's rules)

- Every popup / sheet closes with a swipe left: use `useSwipeClose` from `web/src/lib/swipe.js` on the panel, plus a visible ✕.
- App UI text is English; content (emails, titles, notes, drafts) stays in its own language and is never translated.
