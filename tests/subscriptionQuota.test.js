import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeQuotaStatus, getNewDeliveries, selectQuotaDeliveries, quotaNeedsSelection } from '../src/services/subscriptionQuota.js';
const batch = Array.from({length:80}, (_, i) => ({id:String(i), address:`Rua ${i}`}));
test('80 deliveries require selection of at most five, preserving addresses and order', () => {
  const status = normalizeQuotaStatus({enforced:true,premium:false,used:0});
  assert.equal(quotaNeedsSelection(status,batch.length), true);
  assert.deepEqual(selectQuotaDeliveries(batch,['7','3'],status.remaining),[batch[3],batch[7]]);
  assert.throws(() => selectQuotaDeliveries(batch,batch.slice(0,6).map(x=>x.id),status.remaining));
});
test('three registrations leave two, zero balance allows no additions', () => {
  assert.equal(normalizeQuotaStatus({enforced:true,premium:false,used:3}).remaining,2);
  const exhausted = normalizeQuotaStatus({enforced:true,premium:false,used:7});
  assert.equal(exhausted.remaining,0);
  assert.throws(() => selectQuotaDeliveries(batch,['1'],exhausted.remaining));
  assert.deepEqual(selectQuotaDeliveries(batch,[],exhausted.remaining),[]);
});
test('edits, duplicates and missing IDs do not count as new registrations', () => {
  assert.deepEqual(getNewDeliveries([{id:'a'}],[{id:'a',address:'edited'},{id:'b'},{id:'b'},{}]),[{id:'b'}]);
});
test('premium and disabled accounts retain unrestricted imports', () => {
  assert.equal(quotaNeedsSelection({enforced:false,premium:false,remaining:0},80),false);
  assert.equal(quotaNeedsSelection({enforced:true,premium:true,remaining:0},80),false);
});
test('malformed status fails closed instead of granting five more deliveries', () => {
  for (const used of [null,undefined,'0',-1,1.5,NaN]) assert.throws(() => normalizeQuotaStatus({enforced:true,premium:false,used}));
  assert.throws(() => normalizeQuotaStatus({used:0}));
});
