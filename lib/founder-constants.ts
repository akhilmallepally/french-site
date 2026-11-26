// The founding offer's fixed facts, for the parts of the site that must stay static (the reminder
// banner is in every page, and pages are prerendered once, with no per-request data). The deadline is
// fixed (migration 0009 sets pricing_settings.founder_ends_at to this, and only a migration can change
// it), so it can be in the page. The prices are what pricing_settings holds today; the banner checks
// them against /api/founder-offer after loading, and test:gating fails if they ever differ.
// Checkout and every access decision still read the database, never these.

/** 31 December 2026, 23:59 in Bangkok. */
export const FOUNDER_ENDS_AT = "2026-12-31T16:59:00.000Z";
/** The founder price, once, lifetime access. */
export const FOUNDER_PRICE_CENTS = 800;
/** The yearly plan new buyers get after the founding offer (docs/plans/subscription.md). */
export const YEARLY_PRICE_CENTS = 1200;
