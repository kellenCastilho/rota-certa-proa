import test from 'node:test';
import assert from 'node:assert/strict';
import { subscriptionState, PRODUCT_ID, BUNDLE_ID } from '../server/appleSubscriptionPolicy.js';
import { SignedDataVerifier, Environment } from '@apple/app-store-server-library';
const user = '00000000-0000-4000-8000-000000000001';
const now = 1800000000000;
const transaction = { bundleId:BUNDLE_ID, productId:PRODUCT_ID, appAccountToken:user,
  originalTransactionId:'123456', transactionId:'789', environment:'Production', expiresDate:now+10000 };
test('active paid subscription grants access until verified expiration', () => {
  assert.equal(subscriptionState(transaction,null,1,user,now).premium_until,new Date(now+10000).toISOString());
});
test('expiry and billing retry without grace deny premium', () => {
  for (const status of [2,3,5,undefined]) assert.equal(subscriptionState(transaction,null,status,user,now).premium_until,null);
  assert.equal(subscriptionState({...transaction,expiresDate:now},null,1,user,now).premium_until,null);
});
test('revocation denies access even before expiration', () => {
  assert.equal(subscriptionState({...transaction,revocationDate:now-1},null,1,user,now).premium_until,null);
});
test('grace requires verified future grace expiration', () => {
  assert.equal(subscriptionState(transaction,{gracePeriodExpiresDate:now+20000},4,user,now).premium_until,new Date(now+20000).toISOString());
  for (const renewal of [null,{}, {gracePeriodExpiresDate:now-1}]) assert.equal(subscriptionState(transaction,renewal,4,user,now).premium_until,null);
});
test('wrong account, missing token, product or bundle cannot grant premium', () => {
  for (const change of [{appAccountToken:null},{appAccountToken:'other'},{productId:'fake'}, {bundleId:'other'}, {originalTransactionId:'invalid'}]) {
    assert.throws(() => subscriptionState({...transaction,...change},null,1,user,now),/OWNER_MISMATCH/);
  }
});
test('malformed unsigned transaction rejected by official Apple verifier', async () => {
  const v = new SignedDataVerifier([],false,Environment.PRODUCTION,BUNDLE_ID,6820302719);
  await assert.rejects(v.verifyAndDecodeTransaction('eyJhbGciOiJub25lIn0.eyJwcm9kdWN0SWQiOiJmYWtlIn0.'));
});
