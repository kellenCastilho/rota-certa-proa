import test from 'node:test';
import assert from 'node:assert/strict';
import { googleAccountId, googleSubscriptionState, GOOGLE_PRODUCT } from '../server/googleSubscriptionPolicy.js';
const id = '00000000-0000-4000-8000-000000000001', now = Date.parse('2026-10-09T12:00:00Z');
const receipt = () => ({ externalAccountIdentifiers: { obfuscatedExternalAccountId: googleAccountId(id) },
  subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', acknowledgementState: 'ACKNOWLEDGEMENT_STATE_PENDING',
  lineItems: [{ productId: GOOGLE_PRODUCT, offerDetails: { basePlanId: 'mensal' }, autoRenewingPlan: {}, expiryTime: '2026-11-09T12:00:00Z' }] });
test('active, grace and cancelled retain access until expiry', () => {
  for (const status of ['ACTIVE', 'IN_GRACE_PERIOD', 'CANCELED']) {
    const value = receipt(); value.subscriptionState = 'SUBSCRIPTION_STATE_' + status;
    assert.ok(googleSubscriptionState(value, id, now).premiumUntil);
  }
});
test('pending, paused, on hold, expired and unknown never grant access', () => {
  for (const status of ['PENDING', 'PAUSED', 'ON_HOLD', 'EXPIRED', 'UNSPECIFIED']) {
    const value = receipt(); value.subscriptionState = 'SUBSCRIPTION_STATE_' + status;
    const state = googleSubscriptionState(value, id, now); assert.equal(state.premiumUntil, null); assert.equal(state.acknowledge, false);
  }
});
test('expired timestamps never grant access', () => assert.equal(googleSubscriptionState(receipt(), id, now + 40 * 86400000).premiumUntil, null));
test('cross-account receipts rejected', () => assert.throws(() => googleSubscriptionState(receipt(), id.replace(/1$/, '2'), now), /OWNER_MISMATCH/));
test('missing identity rejected', () => { const value = receipt(); delete value.externalAccountIdentifiers; assert.throws(() => googleSubscriptionState(value, id, now), /OWNER_MISMATCH/); });
test('wrong product, base plan and prepaid rejected', () => {
  for (const edit of [v => v.lineItems[0].productId = 'wrong', v => v.lineItems[0].offerDetails.basePlanId = 'annual', v => delete v.lineItems[0].autoRenewingPlan]) {
    const value = receipt(); edit(value); assert.throws(() => googleSubscriptionState(value, id, now), /PRODUCT_MISMATCH/);
  }
});
test('invalid expiry rejected', () => { const value = receipt(); value.lineItems[0].expiryTime = 'bad'; assert.throws(() => googleSubscriptionState(value, id, now), /INVALID_EXPIRY/); });
test('test purchases distinguished and acknowledged purchases not acknowledged again', () => {
  const value = receipt(); value.testPurchase = {}; value.acknowledgementState = 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED';
  const state = googleSubscriptionState(value, id, now); assert.equal(state.test, true); assert.equal(state.acknowledge, false);
});
test('account identifier stable and contains no email', () => { assert.match(googleAccountId(id), /^[0-9a-f]{64}$/); assert.equal(googleAccountId(id.toUpperCase()), googleAccountId(id)); });
