// The founding-offer reminder banner's rules (Pricing v2, Prompt 76). Pure, so they can be tested
// (lib/founder-banner.test.ts) and shared by the server slot, the pre-paint script and the client.
import { beforeDeadline, formatPrice, timeLeftShort } from "./pricing-offer.ts";

/** When this browser last dismissed the banner (ms since 1970, as text). */
export const BANNER_DISMISSED_KEY = "parlons-founder-banner-dismissed-v1";
/** A dismissal lasts 3 days. */
export const DISMISS_MS = 3 * 24 * 3_600_000;
/** In the last 48 hours the banner comes back, even if dismissed. */
export const LAST_HOURS_MS = 48 * 3_600_000;

/** Pages where the banner never shows: the pricing page itself, and checkout. */
export function bannerPathAllowed(pathname: string): boolean {
  return !/^\/(pricing|checkout)(\/|$)/.test(pathname);
}

/**
 * How far ahead of the shown time a dismissal may be and still count. The page's clock updates once
 * a minute, so a dismissal made just now is a little "ahead" of it; one more than a day ahead came
 * from a wrong device clock and is ignored (it would otherwise hide the banner for too long).
 */
export const DISMISS_AHEAD_MS = 24 * 3_600_000;

/** A dismissal still hides the banner: less than 3 days old, and not in the offer's last 48 hours. */
export function dismissalHides(dismissedAtMs: number | null, nowMs: number, founderEndsAt: string): boolean {
  if (dismissedAtMs === null || !Number.isFinite(dismissedAtMs)) return false;
  const inLastHours = Date.parse(founderEndsAt) - nowMs <= LAST_HOURS_MS;
  return !inLastHours && nowMs - dismissedAtMs < DISMISS_MS && dismissedAtMs <= nowMs + DISMISS_AHEAD_MS;
}

export type BannerInput = {
  pathname: string;
  /** A founder offer was on sale when the shared price was read (spots > 0, before the deadline). */
  founderOnSale: boolean;
  founderEndsAt: string;
  nowMs: number;
  dismissedAtMs: number | null;
  /** The signed-in learner has access (known from the server, or remembered for this user). */
  hasAccess: boolean;
};

export function bannerVisible(b: BannerInput): boolean {
  return (
    b.founderOnSale &&
    beforeDeadline(b.founderEndsAt, b.nowMs) &&
    bannerPathAllowed(b.pathname) &&
    !b.hasAccess &&
    !dismissalHides(b.dismissedAtMs, b.nowMs, b.founderEndsAt)
  );
}

/** "Founding offer: $8 for lifetime access, ends in 12 days." (null once it has ended). */
export function bannerText(founderCents: number, founderEndsAt: string, nowMs: number): string | null {
  const left = timeLeftShort(founderEndsAt, nowMs);
  return left ? `Founding offer: ${formatPrice(founderCents)} for lifetime access, ends in ${left}.` : null;
}

/**
 * Runs in the page before the banner is painted (an inline script just before it), so a dismissed
 * banner, or one for a learner remembered to have access, never shows and then disappears. It sets
 * data-founder-banner="hidden" on <html>; CSS hides the slot. The client component then agrees.
 * `accessKey` is the remembered-access key ({ userId, access }); it applies only while a session
 * cookie exists (the client checks the user properly afterwards).
 */
export function prePaintScript(founderEndsAt: string, accessKey: string): string {
  const ends = JSON.stringify(founderEndsAt);
  return (
    `(function(){try{var n=Date.now(),e=Date.parse(${ends}),h=false;` +
    `var t=parseInt(localStorage.getItem(${JSON.stringify(BANNER_DISMISSED_KEY)})||"",10);` +
    `if(t&&t<=n+${DISMISS_AHEAD_MS}&&n-t<${DISMISS_MS}&&e-n>${LAST_HOURS_MS})h=true;` +
    `var a=JSON.parse(localStorage.getItem(${JSON.stringify(accessKey)})||"null");` +
    `if(a&&a.access===true&&/(^|;\\s*)sb-[^=;]+-auth-token(\\.0)?=/.test(document.cookie))h=true;` +
    `if(h)document.documentElement.setAttribute("data-founder-banner","hidden");}catch(x){}})();`
  );
}
