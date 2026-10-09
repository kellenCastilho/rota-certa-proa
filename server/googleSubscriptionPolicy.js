import { createHash } from 'node:crypto';

export const GOOGLE_PACKAGE = 'com.kellencastilho.darota';
export const GOOGLE_PRODUCT = 'darota_premium_mensal';
export const GOOGLE_BASE_PLAN = 'mensal';
export function googleAccountId(userId) {
  return createHash('sha256').update(`darota:${userId.toLowerCase()}`).digest('hex');
}
export function googleSubscriptionState(value, userId, now = Date.now()) {
  if (value.externalAccountIdentifiers?.obfuscatedExternalAccountId !== googleAccountId(userId)) {
    throw new Error('SUBSCRIPTION_OWNER_MISMATCH');
  }
  const items = (value.lineItems || []).filter(item => item.productId === GOOGLE_PRODUCT &&
    item.offerDetails?.basePlanId === GOOGLE_BASE_PLAN && item.autoRenewingPlan);
  if (!items.length) throw new Error('PRODUCT_MISMATCH');
  const expiry = Math.max(...items.map(item => Date.parse(item.expiryTime)));
  if (!Number.isFinite(expiry)) throw new Error('INVALID_EXPIRY');
  const active = ['SUBSCRIPTION_STATE_ACTIVE', 'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
    'SUBSCRIPTION_STATE_CANCELED'].includes(value.subscriptionState) && expiry > now;
  return { status: value.subscriptionState, test: value.testPurchase != null,
    premiumUntil: active ? new Date(expiry).toISOString() : null,
    acknowledge: active && value.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_PENDING' };
}
