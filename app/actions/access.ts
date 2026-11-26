"use server";
// Whether the signed-in learner has access (hasActiveEntitlement), for hiding the founding-offer
// banner. The client calls it only when the browser holds a session cookie, so signed-out visitors
// make no call, and it never blocks a page: the banner is in the static page and this answers after.
import { getCurrentUser } from "@/lib/current-user";
import { hasActiveEntitlement } from "@/lib/purchases";

// "unknown" (the check failed) keeps the banner hidden and isn't remembered (Prompt 80).
export type AccessReply = { signedIn: false; access: false } | { signedIn: true; userId: string; access: boolean | "unknown" };

export async function getAccessAction(): Promise<AccessReply> {
  const user = await getCurrentUser();
  if (!user) return { signedIn: false, access: false };
  const state = await hasActiveEntitlement(user.id, "lessons");
  return { signedIn: true, userId: user.id, access: state === "unknown" ? "unknown" : state === "yes" };
}
