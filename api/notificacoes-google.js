import { OAuth2Client } from 'google-auth-library';
import { admin, body } from '../server/appleSubscriptions.js';
import { googleConfigured, refreshGoogleSubscription } from '../server/googleSubscriptions.js';
import { GOOGLE_PACKAGE } from '../server/googleSubscriptionPolicy.js';
const oauth = new OAuth2Client();
export async function POST(request) {
  if (!googleConfigured() || !process.env.GOOGLE_RTDN_PUSH_EMAIL || !process.env.GOOGLE_RTDN_AUDIENCE) {
    return new Response(null, { status: 503 });
  }
  const jwt = request.headers.get('authorization')?.match(/^Bearer (\S{1,16384})$/)?.[1];
  if (!jwt) return new Response(null, { status: 401 });
  try {
    const ticket = await oauth.verifyIdToken({ idToken: jwt, audience: process.env.GOOGLE_RTDN_AUDIENCE });
    const identity = ticket.getPayload();
    if (identity?.email !== process.env.GOOGLE_RTDN_PUSH_EMAIL || identity.email_verified !== true) {
      return new Response(null, { status: 403 });
    }
  } catch { return new Response(null, { status: 401 }); }
  try {
    const envelope = await body(request, 32768);
    if (typeof envelope.message?.data !== 'string' || envelope.message.data.length > 20000) return new Response(null, { status: 400 });
    const message = JSON.parse(Buffer.from(envelope.message.data, 'base64').toString('utf8'));
    if (message.packageName !== GOOGLE_PACKAGE) return new Response(null, { status: 400 });
    if (message.testNotification) return new Response(null, { status: 204 });
    const token = message.subscriptionNotification?.purchaseToken || message.voidedPurchaseNotification?.purchaseToken;
    if (typeof token !== 'string' || token.length > 4096 || token.length < 10) return new Response(null, { status: 400 });
    const { data: row, error } = await admin().from('darota_google_subscriptions').select('user_id').eq('purchase_token', token).maybeSingle();
    if (error) throw new Error('STATUS_UNAVAILABLE');
    // Unknown purchases are established by the authenticated purchase endpoint, never by an unbound notification.
    if (row) await refreshGoogleSubscription(token, row.user_id);
    return new Response(null, { status: 204 });
  } catch {
    console.error('DAROTA_GOOGLE_NOTIFICATION_FAILED');
    return new Response(null, { status: 502 });
  }
}
