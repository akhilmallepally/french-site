"use client";
// Shown when the access check failed (hasActiveEntitlement answered "unknown", Prompt 80): never the
// buy paywall (the learner may have paid) and never paid content (they may not have). Retry renders
// the server parts of the page again, which asks once more.
import { useRouter } from "next/navigation";
import { useTransition } from "react";

export const ACCESS_UNKNOWN_TITLE = "Couldn't check your access";

export function AccessUnknown({ compact = false, className = "" }: { compact?: boolean; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const retry = () => start(() => router.refresh());
  const button = (
    <button
      type="button"
      onClick={retry}
      disabled={pending}
      className="inline-flex min-h-10 items-center justify-center rounded-full border border-border bg-background px-5 py-2 text-sm font-medium transition hover:border-accent/40 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
    >
      {pending ? "Checking…" : "Retry"}
    </button>
  );
  if (compact) {
    return (
      <div role="status" data-testid="access-unknown" className={`rounded-xl border border-border bg-background p-4 text-center ${className}`}>
        <p className="text-sm font-medium">{ACCESS_UNKNOWN_TITLE}</p>
        <p className="mt-1 text-xs text-muted">Please try again in a moment.</p>
        <div className="mt-3">{button}</div>
      </div>
    );
  }
  return (
    <section role="status" data-testid="access-unknown" className={`mt-8 rounded-2xl border border-border bg-card px-6 py-10 text-center sm:px-10 ${className}`}>
      <h2 className="font-serif text-2xl font-semibold">{ACCESS_UNKNOWN_TITLE}</h2>
      <p className="mx-auto mt-3 max-w-md text-muted">
        Something went wrong while we checked your account. Nothing has changed: please try again in a moment.
      </p>
      <div className="mt-6">{button}</div>
    </section>
  );
}

/** The /practice lock slot's version: one line with a small Retry, the same height as the lock. */
export function AccessUnknownInline() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <span role="status" data-testid="access-unknown" className="inline-flex items-center gap-2 text-xs text-muted">
      <span>{ACCESS_UNKNOWN_TITLE}</span>
      <button type="button" onClick={() => start(() => router.refresh())} disabled={pending} className="font-medium text-accent underline-offset-2 hover:underline disabled:opacity-60">
        {pending ? "Checking…" : "Retry"}
      </button>
    </span>
  );
}
