// The founding-offer reminder banner's rules (Pricing v2; static pages since Prompt 77). Pure, so they
// can be tested (lib/founder-banner.test.ts) and shared by the layout's pre-paint script and the
// client component.
import { deadlineDate, formatPrice, timeLeftShort } from "./pricing-offer.ts";

/** When this browser last dismissed the banner (ms since 1970, as text). */
export const BANNER_DISMISSED_KEY = "parlons-founder-banner-dismissed-v1";
/** When this browser last learned the offer had ended (sold out): ms as text. */
export const BANNER_ENDED_KEY = "parlons-founder-offer-ended-v1";
/** A dismissal lasts 3 days. */
export const DISMISS_MS = 3 * 24 * 3_600_000;
/** In the last 48 hours the banner comes back, even if dismissed. */
export const LAST_HOURS_MS = 48 * 3_600_000;
/** A remembered "ended" (sold out) hides the banner before paint for an hour; the browser checks again anyway. */
export const ENDED_MEMORY_MS = 3_600_000;

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
  /** Not known to have ended: true until /api/founder-offer says otherwise (sold out, or the price can't be read). */
  founderOnSale: boolean;
  founderEndsAt: string;
  /** The browser's time, or null before the page has mounted (then only the static rules apply). */
  nowMs: number | null;
  dismissedAtMs: number | null;
  /** The signed-in learner has access (known from the server, or remembered for this user). */
  hasAccess: boolean;
};

/**
 * Whether the server's access answer hides the banner: access hides it, and so does "unknown" (the
 * check failed, Prompt 80): only a definite "no" lets it show.
 */
export function accessHidesBanner(access: boolean | "unknown"): boolean {
  return access !== false;
}

export function bannerVisible(b: BannerInput): boolean {
  if (!b.founderOnSale || !bannerPathAllowed(b.pathname) || b.hasAccess) return false;
  if (b.nowMs === null) return true; // the static page: the pre-paint script applies the time rules
  return b.nowMs < Date.parse(b.founderEndsAt) && !dismissalHides(b.dismissedAtMs, b.nowMs, b.founderEndsAt);
}

/**
 * "Founding offer: $8 for lifetime access, ends in 12 days. From 1 January: $12 per year." Before the
 * page has mounted (no clock in a static page) it says "until 31 December 2026" instead. Null once ended.
 */
export function bannerText(founderCents: number, yearlyCents: number, founderEndsAt: string, nowMs: number | null): string | null {
  const after = `From 1 January: ${formatPrice(yearlyCents)} per year.`;
  if (nowMs === null) return `Founding offer: ${formatPrice(founderCents)} for lifetime access until ${deadlineDate(founderEndsAt)}. ${after}`;
  const left = timeLeftShort(founderEndsAt, nowMs);
  return left ? `Founding offer: ${formatPrice(founderCents)} for lifetime access, ends in ${left}. ${after}` : null;
}

/**
 * Runs in the page before the banner is painted (an inline script in the layout), so a banner that
 * shouldn't show never flashes: after the deadline, when dismissed (3 days, except in the last 48
 * hours), when the offer was recently found sold out, or for a learner remembered to have access
 * (with a session cookie). It sets data-founder-banner="hidden" on <html>; CSS hides the slot, and the
 * client component then agrees. `accessKey` is the remembered-access key ({ userId, access }).
 */
export function prePaintScript(founderEndsAt: string, accessKey: string): string {
  const ends = JSON.stringify(founderEndsAt);
  return (
    `(function(){try{var n=Date.now(),e=Date.parse(${ends}),h=n>=e;` +
    `var t=parseInt(localStorage.getItem(${JSON.stringify(BANNER_DISMISSED_KEY)})||"",10);` +
    `if(t&&t<=n+${DISMISS_AHEAD_MS}&&n-t<${DISMISS_MS}&&e-n>${LAST_HOURS_MS})h=true;` +
    `var s=parseInt(localStorage.getItem(${JSON.stringify(BANNER_ENDED_KEY)})||"",10);` +
    `if(s&&n-s<${ENDED_MEMORY_MS}&&s<=n+${DISMISS_AHEAD_MS})h=true;` +
    `var a=JSON.parse(localStorage.getItem(${JSON.stringify(accessKey)})||"null");` +
    `if(a&&a.access===true&&/(^|;\\s*)sb-[^=;]+-auth-token(\\.0)?=/.test(document.cookie))h=true;` +
    `if(h)document.documentElement.setAttribute("data-founder-banner","hidden");}catch(x){}})();`
  );
}
