import { DodoPaymentProvider } from "./dodo";
import { LemonSqueezyPaymentProvider } from "./lemonsqueezy";
import type { PaymentProvider, ProviderName } from "./types";

const dodo = new DodoPaymentProvider();
const lemonsqueezy = new LemonSqueezyPaymentProvider();

/**
 * Returns the active payment provider instance based on environment configuration
 * or an explicitly specified provider name.
 */
export function getPaymentProvider(name?: ProviderName): PaymentProvider {
  const configuredName = name ?? (process.env.PAYMENTS_PROVIDER?.toLowerCase() === "lemonsqueezy" ? "lemonsqueezy" : "dodo");
  return configuredName === "lemonsqueezy" ? lemonsqueezy : dodo;
}
