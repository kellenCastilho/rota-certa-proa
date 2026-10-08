import { configured, verifyNotification, refreshSubscription, sandboxAllowed, body } from '../server/appleSubscriptions.js';
import { PRODUCT_ID, BUNDLE_ID } from '../server/appleSubscriptionPolicy.js';
export async function POST(request) {
  if (!configured()) return new Response(null, { status: 503 });
  try {
    const input = await body(request, 65536);
    if (typeof input.signedPayload !== 'string' || input.signedPayload.length > 60000) return new Response(null, { status: 400 });
    const result = await verifyNotification(input.signedPayload);
    if (result.notification.notificationType === 'TEST') return new Response(null, { status: 200 });
    const signed = result.notification.data?.signedTransactionInfo;
    if (!signed) return new Response(null, { status: 200 });
    const t = await result.verifier.verifyAndDecodeTransaction(signed);
    if (t.productId !== PRODUCT_ID || t.bundleId !== BUNDLE_ID || !t.appAccountToken) return new Response(null, { status: 200 });
    if (result.environment === 'Sandbox' && !sandboxAllowed(t.appAccountToken)) return new Response(null, { status: 200 });
    await refreshSubscription(t.originalTransactionId, t.appAccountToken, result.environment, result.verifier);
    return new Response(null, { status: 200 });
  } catch { return new Response(null, { status: 503 }); }
}
