// "Your access" at the top of /progress (docs/plans/subscription.md, section 5; Prompt 81). Server
// side, inside its own <Suspense>, so the rest of /progress stays as it was (prerendered, read in the
// browser). Signed-out visitors make no access call (getCurrentUser answers from the missing
// cookie); a learner without access sees nothing here.
import { AccessUnknown } from "@/components/access-unknown";
import { ManageSubscriptionButton } from "@/components/manage-subscription-button";
import { accessBox, type AccessBox as Box } from "@/lib/access-wording";
import { getCurrentUser } from "@/lib/current-user";
import { getAccessDetails } from "@/lib/purchases";

export async function AccessBox() {
  const user = await getCurrentUser();
  if (!user) return null;
  return <AccessBoxView box={accessBox(await getAccessDetails(user.id, "lessons"))} />;
}

/** The box for each state (kept apart from the reads, so it renders the same for every state). */
export function AccessBoxView({ box }: { box: Box }) {
  if (box.kind === "none") return null;
  if (box.kind === "unknown") return <AccessUnknown compact className="mt-6" />;
  const warn = box.kind === "subscription" && box.warn;
  return (
    <section id="your-access" aria-labelledby="your-access-title" data-testid="access-box" className={`mt-6 rounded-xl border p-4 ${warn ? "border-red-300 bg-red-50 dark:border-red-900 dark:bg-red-950/30" : "border-accent/20 bg-accent/5"}`}>
      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted">Your access</h2>
      <p id="your-access-title" className={`mt-1 font-medium ${warn ? "text-red-800 dark:text-red-300" : "text-accent"}`}>
        {box.title}
      </p>
      {box.kind === "subscription" && (
        <div className="mt-3">
          <ManageSubscriptionButton />
        </div>
      )}
    </section>
  );
}
