import "server-only";
import crypto from "node:crypto";
import type { ProviderName } from "./types";

export type PaymentsConfig = {
  provider: ProviderName;
  apiKey: string;
  webhookSecret: string;
  productId?: string;
};

export type SupabaseAdminConfig = {
  url: string;
  serviceRoleKey: string;
};

let warnedMissingConfig = false;

/**
 * Reads payment configuration safely.
 * Returns null when required variables are missing without throwing at import time.
 */
export function getPaymentsConfig(): PaymentsConfig | null {
  const rawProvider = (process.env.PAYMENTS_PROVIDER || "dodo").toLowerCase();
  const provider: ProviderName = rawProvider === "lemonsqueezy" ? "lemonsqueezy" : "dodo";
  const apiKey = process.env.PAYMENTS_API_KEY;
  const webhookSecret = process.env.PAYMENTS_WEBHOOK_SECRET;
  const productId = process.env.PAYMENTS_PRODUCT_ID;

  if (!apiKey || !webhookSecret) {
    if (!warnedMissingConfig && process.env.NODE_ENV !== "test") {
      warnedMissingConfig = true;
      console.warn("[payments] PAYMENTS_API_KEY or PAYMENTS_WEBHOOK_SECRET is missing. Payments are disabled.");
    }
    return null;
  }

  return {
    provider,
    apiKey,
    webhookSecret,
    productId: productId || undefined,
  };
}

/**
 * Returns configuration for the server-only Supabase service-role client.
 * Returns null when missing without throwing at import time.
 */
export function getSupabaseAdminConfig(): SupabaseAdminConfig | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return { url, serviceRoleKey };
}

/**
 * Generates an HMAC-SHA256 signature for checkout metadata to guarantee
 * that user_id and product cannot be forged or tampered with.
 */
export function signMetadata(userId: string, product: string, secret?: string): string {
  const signingKey = secret ?? process.env.PAYMENTS_WEBHOOK_SECRET;
  if (!signingKey) {
    throw new Error("Cannot sign metadata: PAYMENTS_WEBHOOK_SECRET is missing");
  }
  return crypto.createHmac("sha256", signingKey).update(`${userId}:${product}`).digest("hex");
}

/**
 * Timing-safe verification of the checkout metadata signature.
 */
export function verifyMetadataSignature(
  userId: string,
  product: string,
  signature: string | undefined | null,
  secret?: string
): boolean {
  if (!signature) return false;
  const signingKey = secret ?? process.env.PAYMENTS_WEBHOOK_SECRET;
  if (!signingKey) return false;

  try {
    const expected = crypto.createHmac("sha256", signingKey).update(`${userId}:${product}`).digest("hex");
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    if (a.length !== b.length || a.length === 0) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
