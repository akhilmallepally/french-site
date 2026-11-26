"use server";
// Whether the signed-in learner has access (hasActiveEntitlement), for hiding the founding-offer
// banner. The client calls it only when the browser holds a session cookie, so signed-out visitors
// make no call, and it never blocks a page: the banner is in the static page and this answers after.
import { getCurrentUser } from "@/lib/current-user";
import { hasActiveEntitlement } from "@/lib/purchases";

export type AccessReply = { signedIn: false; access: false } | { signedIn: true; userId: string; access: boolean };

export async function getAccessAction(): Promise<AccessReply> {
  const user = await getCurrentUser();
  if (!user) return { signedIn: false, access: false };
  return { signedIn: true, userId: user.id, access: await hasActiveEntitlement(user.id, "lessons") };
}
