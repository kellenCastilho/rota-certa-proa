import { AppStoreServerAPIClient, SignedDataVerifier, Environment } from '@apple/app-store-server-library';
import { createClient } from '@supabase/supabase-js';
import { PRODUCT_ID, BUNDLE_ID, APP_ID, subscriptionState } from './appleSubscriptionPolicy.js';

let rootsPromise;
const ROOT_URLS = [
  'https://www.apple.com/certificateauthority/AppleRootCA-G3.cer',
  'https://www.apple.com/certificateauthority/AppleRootCA-G2.cer',
  'https://www.apple.com/appleca/AppleIncRootCertificate.cer',
];
async function roots() {
  if (!rootsPromise) rootsPromise = Promise.all(ROOT_URLS.map(async (url) => {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) throw new Error('APPLE_CERTIFICATES_UNAVAILABLE');
    return Buffer.from(await res.arrayBuffer());
  })).catch((error) => { rootsPromise = undefined; throw error; });
  return rootsPromise;
}
export function configured() {
  return process.env.DAROTA_IAP_ENABLED === 'true' &&
    process.env.APPLE_IAP_PRIVATE_KEY && process.env.APPLE_IAP_KEY_ID &&
    process.env.APPLE_IAP_ISSUER_ID && process.env.SUPABASE_SECRET_KEY && process.env.SUPABASE_URL;
}
export function admin() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
}
export function sandboxAllowed(userId) {
  return (process.env.DAROTA_IAP_SANDBOX_USERS || '').split(',').map(x => x.trim().toLowerCase()).includes(userId.toLowerCase());
}
export async function verifier(environment) {
  return new SignedDataVerifier(await roots(), true, environment, BUNDLE_ID, APP_ID);
}
function api(environment) {
  return new AppStoreServerAPIClient(process.env.APPLE_IAP_PRIVATE_KEY.replace(/\\n/g, '\n'),
    process.env.APPLE_IAP_KEY_ID, process.env.APPLE_IAP_ISSUER_ID, BUNDLE_ID, environment);
}
export async function verifyTransaction(jws, userId) {
  // Never trust an unverified environment field to authorize premium.
  try {
    const v = await verifier(Environment.PRODUCTION);
    return { transaction: await v.verifyAndDecodeTransaction(jws), environment: Environment.PRODUCTION, verifier: v };
  } catch (productionError) {
    if (!sandboxAllowed(userId)) throw productionError;
    const v = await verifier(Environment.SANDBOX);
    return { transaction: await v.verifyAndDecodeTransaction(jws), environment: Environment.SANDBOX, verifier: v };
  }
}
export async function verifyNotification(jws) {
  for (const environment of [Environment.PRODUCTION, Environment.SANDBOX]) {
    try {
      const v = await verifier(environment);
      const notification = await v.verifyAndDecodeNotification(jws);
      return { notification, environment, verifier: v };
    } catch (error) { if (environment === Environment.SANDBOX) throw error; }
  }
}
export async function refreshSubscription(originalId, userId, environment, v) {
  if (environment === Environment.SANDBOX && !sandboxAllowed(userId)) throw new Error('SANDBOX_NOT_ALLOWED');
  const checkedAt = new Date().toISOString();
  const response = await api(environment).getAllSubscriptionStatuses(originalId);
  let selected;
  for (const group of response.data || []) {
    for (const item of group.lastTransactions || []) {
      if (!item.signedTransactionInfo) continue;
      const t = await v.verifyAndDecodeTransaction(item.signedTransactionInfo);
      if (t.productId !== PRODUCT_ID || t.originalTransactionId !== originalId) continue;
      const renewal = item.signedRenewalInfo ? await v.verifyAndDecodeRenewalInfo(item.signedRenewalInfo) : null;
      if (t.environment !== environment) throw new Error('ENVIRONMENT_MISMATCH');
      const state = subscriptionState(t, renewal, item.status, userId);
      if (!selected || (t.signedDate || 0) > selected.signedDate) selected = { ...state, signedDate: t.signedDate || 0 };
    }
  }
  if (!selected) throw new Error('SUBSCRIPTION_NOT_FOUND');
  const { data, error } = await admin().rpc('darota_record_apple_subscription', {
    p_user_id: userId, p_original_id: originalId, p_environment: environment,
    p_transaction_id: selected.transaction_id, p_status: selected.status,
    p_premium_until: selected.premium_until, p_checked_at: checkedAt,
  });
  if (error) throw new Error('SUBSCRIPTION_SAVE_FAILED');
  return data;
}
export async function authenticate(request) {
  const token = request.headers.get('authorization')?.match(/^Bearer (\S{1,4096})$/)?.[1];
  if (!token) return null;
  const { data, error } = await admin().auth.getUser(token);
  return error ? null : data?.user;
}
export function cors(request) {
  const origin = request.headers.get('origin');
  const allowed = new Set(['https://rota-certa-proa.vercel.app', 'capacitor://localhost',
    'http://localhost', 'https://localhost', 'http://localhost:5173']);
  if (origin && !allowed.has(origin)) return null;
  return { ...(origin ? { 'Access-Control-Allow-Origin': origin } : {}),
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Cache-Control': 'no-store', Vary: 'Origin' };
}
export async function body(request, limit = 32768) {
  const text = await request.text();
  if (Buffer.byteLength(text) > limit) throw new Error('INVALID_REQUEST');
  return JSON.parse(text);
}
