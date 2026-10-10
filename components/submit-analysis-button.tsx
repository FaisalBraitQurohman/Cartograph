"use client";

import { useFormStatus } from "react-dom";

/**
 * The button on the analysis form.
 *
 * A separate component because `useFormStatus` reads the enclosing form's state,
 * and it has to be inside the form to see it. The disabled state is the only thing
 * that stops a second paste while the first one is still being written - and it is
 * worth having, because two pastes of a URL that has not been stored yet would both
 * miss the one-analysis-per-repository check and race for the insert.
 */
export function SubmitAnalysisButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="shrink-0 rounded-md bg-accent px-4 py-2.5 text-xs font-medium text-white transition-opacity disabled:opacity-50"
    >
      {pending ? "Starting…" : "Analyse repository"}
    </button>
  );
}