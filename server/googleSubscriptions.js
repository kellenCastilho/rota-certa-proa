import { createSign } from 'node:crypto';
import { admin } from './appleSubscriptions.js';
import { GOOGLE_PACKAGE, GOOGLE_PRODUCT, googleSubscriptionState } from './googleSubscriptionPolicy.js';

let accessToken, tokenUntil = 0, tokenPromise;
export const googleConfigured = () => process.env.DAROTA_GOOGLE_IAP_ENABLED === 'true' &&
  !!process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON && !!process.env.SUPABASE_SECRET_KEY && !!process.env.SUPABASE_URL;
export const googleTestAllowed = id => (process.env.DAROTA_GOOGLE_IAP_TEST_USERS || '')
  .split(',').map(s => s.trim().toLowerCase()).includes(id.toLowerCase());
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
async function credentialToken() {
  if (accessToken && Date.now() < tokenUntil) return accessToken;
  if (tokenPromise) return tokenPromise;
  tokenPromise = (async () => {
    const credential = JSON.parse(process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON);
    if (credential.type !== 'service_account' || !credential.client_email || !credential.private_key) throw new Error('GOOGLE_CONFIGURATION');
    const now = Math.floor(Date.now() / 1000);
    const content = `${encode({ alg: 'RS256', typ: 'JWT' })}.${encode({ iss: credential.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })}`;
    const signature = createSign('RSA-SHA256').update(content).sign(credential.private_key, 'base64url');
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(10000),
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${content}.${signature}` }) });
    const value = await response.json();
    if (!response.ok || !value.access_token) throw new Error('GOOGLE_AUTH_FAILED');
    accessToken = value.access_token; tokenUntil = Date.now() + Math.min(Number(value.expires_in) || 3600, 3600) * 1000 - 60000;
    return accessToken;
  })().finally(() => { tokenPromise = undefined; });
  return tokenPromise;
}
async function googleRequest(path, method = 'GET') {
  const token = await credentialToken();
  const response = await fetch(`https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${GOOGLE_PACKAGE}/${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(method === 'POST' ? { body: '{}' } : {}), signal: AbortSignal.timeout(15000) });
  if (!response.ok) { const error = new Error('GOOGLE_API_FAILED'); error.httpStatus = response.status; throw error; }
  return response.status === 204 ? null : response.text().then(text => text ? JSON.parse(text) : null);
}
export async function refreshGoogleSubscription(purchaseToken, userId) {
  const checkedAt = new Date().toISOString();
  const value = await googleRequest(`purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`);
  const state = googleSubscriptionState(value, userId);
  if (state.test && !googleTestAllowed(userId)) throw new Error('TEST_NOT_ALLOWED');
  // Persist only verified ownership and state; never grant access from the client receipt alone.
  const { data, error } = await admin().rpc('darota_record_google_subscription', {
    p_user_id: userId, p_token: purchaseToken, p_test: state.test, p_status: state.status,
    p_premium_until: state.premiumUntil, p_checked_at: checkedAt,
  });
  if (error) throw new Error('SUBSCRIPTION_SAVE_FAILED');
  if (state.acknowledge) {
    try { await googleRequest(`purchases/subscriptions/${GOOGLE_PRODUCT}/tokens/${encodeURIComponent(purchaseToken)}:acknowledge`, 'POST'); }
    catch (error) {
      // Parallel restore/focus/notification requests may have acknowledged it first.
      if (![400, 409].includes(error.httpStatus)) throw error;
      const latest = await googleRequest(`purchases/subscriptionsv2/tokens/${encodeURIComponent(purchaseToken)}`);
      googleSubscriptionState(latest, userId);
      if (latest.acknowledgementState !== 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED') throw error;
    }
  }
  return data;
}
export async function refreshGooglePlan(userId) {
  const { data: rows, error } = await admin().from('darota_google_subscriptions')
    .select('purchase_token,test_purchase').eq('user_id', userId).limit(20);
  if (error) throw new Error('STATUS_UNAVAILABLE');
  for (const row of rows || []) {
    if (row.test_purchase && !googleTestAllowed(userId)) continue;
    try { await refreshGoogleSubscription(row.purchase_token, userId); }
    catch (error) {
      // Google invalidates tokens more than 60 days after expiration. Stop retrying these indefinitely.
      if (error.httpStatus !== 410) throw error;
      const { error: saveError } = await admin().rpc('darota_record_google_subscription', {
        p_user_id: userId, p_token: row.purchase_token, p_test: row.test_purchase,
        p_status: 'SUBSCRIPTION_STATE_EXPIRED', p_premium_until: null, p_checked_at: new Date().toISOString(),
      });
      if (saveError) throw new Error('SUBSCRIPTION_SAVE_FAILED');
    }
  }
  const { data, error: planError } = await admin().rpc('darota_recompute_premium', { p_user_id: userId });
  if (planError) throw new Error('STATUS_UNAVAILABLE');
  return data;
}

