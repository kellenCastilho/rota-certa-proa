export const PRODUCT_ID = 'com.kellencastilho.darota.premium.mensal';
export const BUNDLE_ID = 'com.kellencastilho.darota';
export const APP_ID = 6820302719;
export function subscriptionState(transaction, renewal, status, userId, now = Date.now()) {
  if (transaction.bundleId !== BUNDLE_ID || transaction.productId !== PRODUCT_ID ||
      transaction.appAccountToken?.toLowerCase() !== userId.toLowerCase() ||
      !/^\d{1,40}$/.test(transaction.originalTransactionId || '')) {
    throw new Error('SUBSCRIPTION_OWNER_MISMATCH');
  }
  const expires = status === 4 ? renewal?.gracePeriodExpiresDate : transaction.expiresDate;
  const active = [1, 4].includes(status) && !transaction.revocationDate &&
    Number.isSafeInteger(expires) && expires > now;
  return { original_transaction_id: transaction.originalTransactionId,
    transaction_id: transaction.transactionId, product_id: PRODUCT_ID,
    environment: transaction.environment, status, premium_until: active ? new Date(expires).toISOString() : null };
}
