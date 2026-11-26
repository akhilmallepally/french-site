"use client";
// Opens the Dodo customer portal (app/actions/subscription.ts) and goes there. The action takes no
// input; the button only shows its one plain message if anything goes wrong.
import { useState, useTransition } from "react";
import { openSubscriptionPortalAction } from "@/app/actions/subscription";
import { PORTAL_ERROR_MESSAGE } from "@/lib/portal";

export function ManageSubscriptionButton() {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const open = () => {
    setError(null);
    start(async () => {
      try {
        const reply = await openSubscriptionPortalAction();
        if (reply.status === "ok") {
          window.location.assign(reply.url);
          return;
        }
        setError(reply.message);
      } catch {
        setError(PORTAL_ERROR_MESSAGE);
      }
    });
  };
  return (
    <div>
      <button
        type="button"
        onClick={open}
        disabled={pending}
        className="inline-flex min-h-10 items-center justify-center rounded-full bg-accent px-5 py-2 text-sm font-medium text-white transition hover:opacity-90 disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        {pending ? "Opening…" : "Manage subscription"}
      </button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}
