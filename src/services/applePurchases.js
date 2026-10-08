import { Capacitor, registerPlugin } from '@capacitor/core';
import { supabase } from '../lib/supabase';
const native = registerPlugin('DaRotaPurchases');
export function iosSubscriptionsEnabled() {
  return Capacitor.getPlatform() === 'ios' && import.meta.env.VITE_DAROTA_IOS_SUBSCRIPTIONS_ENABLED === 'true';
}
async function submit(input, userId) {
  const { data } = await supabase.auth.getSession();
  if (!data.session || data.session.user.id !== userId) throw new Error('Entre novamente na sua conta.');
  const response = await fetch('https://rota-certa-proa.vercel.app/api/assinatura-apple', {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}` },
    body: JSON.stringify(input), signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Não foi possível confirmar a assinatura.');
  return result;
}
async function confirm(transaction, userId) {
  const result = await submit({ signedTransaction: transaction.signedTransaction }, userId);
  await native.finish({ transactionId: transaction.transactionId });
  return result;
}
export const loadAppleProduct = () => native.product();
export async function purchaseApplePlan(userId) {
  const result = await native.purchase({ accountToken: userId });
  if (result.status !== 'purchased') return result;
  return { ...await confirm(result, userId), status: 'purchased' };
}
export async function synchronizeApplePlan(userId, restore = false) {
  const result = restore ? await native.restore() : await native.transactions();
  for (const transaction of result.transactions || []) await confirm(transaction, userId);
  return submit({ operation: 'status' }, userId);
}
export function listenAppleTransactions(callback) { return native.addListener('transactionUpdated', callback); }
