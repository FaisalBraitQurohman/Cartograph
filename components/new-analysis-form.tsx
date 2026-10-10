"use client";

import { SubmitAnalysisButton } from "@/components/submit-analysis-button";

/**
 * Paste a repository URL.
 *
 * A plain form posting to a server action. The action writes the rows, redirects to
 * the progress page, and only then starts the fetch - so this form never waits on a
 * parse, and the page it lands on is where the waiting happens.
 *
 * No client-side URL validation. The check that matters is `parseRepositoryUrl`,
 * which knows the nine forms a repository URL arrives in, and duplicating a
 * looser version of it here would be a second answer to the same question.
 */
export function NewAnalysisForm({
  action,
  error,
}: {
  action: (formData: FormData) => Promise<void>;
  error: string | null;
}) {
  return (
    <form action={action} className="rounded-lg border border-border bg-surface-raised/35 p-4 sm:p-5">
      <label htmlFor="url" className="block text-xs font-medium text-text">
        Analyse a public repository
      </label>
      <p className="mt-1 text-[11px] leading-4 text-text-muted">
        A GitHub URL or an <code className="font-mono">owner/repo</code> pair. Only
        public repositories — no token is asked for or stored.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          id="url"
          name="url"
          type="text"
          required
          autoComplete="off"
          spellCheck={false}
          placeholder="https://github.com/vuejs/devtools"
          className="min-w-0 flex-1 rounded-md border border-border bg-surface px-3 py-2.5 font-mono text-xs text-text outline-none placeholder:text-text-muted/60 focus:border-accent"
        />
        <SubmitAnalysisButton />
      </div>

      {/* A URL that does not name a repository never becomes a row, so it arrives
          here on the query string instead. Anything that did start — including a
          repository that does not exist — is a row on its own progress page. */}
      {error ? (
        <p role="alert" className="mt-3 text-[11px] leading-4 text-danger">
          {error}
        </p>
      ) : null}
    </form>
  );
}