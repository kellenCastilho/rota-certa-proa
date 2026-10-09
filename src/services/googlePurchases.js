import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase } from '../lib/supabase';
const native = registerPlugin('DaRotaGooglePurchases');
export const androidSubscriptionsEnabled = () => Capacitor.getPlatform() === 'android' &&
  import.meta.env.VITE_DAROTA_ANDROID_SUBSCRIPTIONS_ENABLED === 'true' &&
  /^https:\/\//.test(import.meta.env.VITE_DAROTA_ANDROID_TERMS_URL || '');
async function submit(input, userId) {
  const { data } = await supabase.auth.getSession();
  if (!data.session || data.session.user.id !== userId) throw new Error('Entre novamente na sua conta.');
  const response = await fetch('https://rota-certa-proa.vercel.app/api/assinatura-google', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify(input), signal: AbortSignal.timeout(45000) });
  const result = await response.json();
  const current = await supabase.auth.getSession();
  if (current.data.session?.user.id !== userId) throw new Error('Entre novamente na sua conta.');
  if (!response.ok) throw new Error(result.error || 'Não foi possível confirmar a assinatura.');
  return result;
}
export const loadGoogleProduct = () => native.product();
export async function purchaseGooglePlan(userId) {
  const result = await native.purchase({ userId });
  if (result.status !== 'purchased') return result;
  return { ...await submit({ operation: 'verify', purchaseToken: result.purchaseToken }, userId), status: 'purchased' };
}
export async function synchronizeGooglePlan(userId) {
  const { purchases } = await native.transactions({ userId });
  for (const purchase of purchases || []) {
    if (purchase.status === 'purchased') await submit({ operation: 'verify', purchaseToken: purchase.purchaseToken }, userId);
  }
  return submit({ operation: 'status' }, userId);
}
export const listenGoogleTransactions = callback => native.addListener('transactionUpdated', callback);
