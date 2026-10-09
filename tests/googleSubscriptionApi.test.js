import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { POST, OPTIONS } from '../api/assinatura-google.js';
import { googleAccountId, GOOGLE_PRODUCT } from '../server/googleSubscriptionPolicy.js';
const id='00000000-0000-4000-8000-000000000001';
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
process.env.DAROTA_GOOGLE_IAP_ENABLED='true';
process.env.SUPABASE_URL='https://example.supabase.co'; process.env.SUPABASE_SECRET_KEY='mock-key';
process.env.GOOGLE_PLAY_SERVICE_ACCOUNT_JSON=JSON.stringify({type:'service_account',client_email:'test@example.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
let mode='active', rpcCalls=0, acknowledged=0;
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url, init={}) => {
 const path=String(url);
 if(path.endsWith('/auth/v1/user')) return Response.json({id,email:'demo@example.test'});
 if(path.includes('oauth2.googleapis.com')) return Response.json({access_token:'mock-oauth-token',expires_in:3600});
 if(path.endsWith(':acknowledge')) { acknowledged++; return new Response(null,{status:204}); }
 if(path.includes('subscriptionsv2/tokens/')) return Response.json({
  externalAccountIdentifiers:{obfuscatedExternalAccountId:googleAccountId(mode==='wrong-owner'?id.replace(/1$/,'2'):id)},
  subscriptionState:mode==='pending'?'SUBSCRIPTION_STATE_PENDING':'SUBSCRIPTION_STATE_ACTIVE',
  acknowledgementState:'ACKNOWLEDGEMENT_STATE_PENDING',
  ...(mode==='test'?{testPurchase:{}}:{}),
  lineItems:[{productId:GOOGLE_PRODUCT,offerDetails:{basePlanId:'mensal'},autoRenewingPlan:{},expiryTime:new Date(Date.now()+86400000).toISOString()}]});
 if(path.includes('/rest/v1/rpc/')) {
  rpcCalls++; const input=JSON.parse(init.body); assert.equal(input.p_user_id,id);
  return Response.json({premium:!!input.p_premium_until,premiumUntil:input.p_premium_until});
 }
 throw new Error('Unexpected mocked request');
};
after(()=>{globalThis.fetch=originalFetch;});
const request=input=>new Request('https://example.test/api/assinatura-google',{method:'POST',headers:{origin:'https://localhost',authorization:'Bearer mock-session','Content-Type':'application/json'},body:JSON.stringify(input)});
test('native origin permitted; unknown browser origin rejected',async()=>{
 assert.equal(OPTIONS(request({})).status,204);
 assert.equal(OPTIONS(new Request('https://example.test',{headers:{origin:'https://untrusted.test'}})).status,403);
});
test('invalid token rejected before purchase verification',async()=>{assert.equal((await POST(request({operation:'verify',purchaseToken:'bad'}))).status,400);});
test('wrong account cannot write entitlement',async()=>{
 mode='wrong-owner'; const before=rpcCalls; assert.equal((await POST(request({operation:'verify',purchaseToken:'token-google-valid'}))).status,403); assert.equal(rpcCalls,before);
});
test('test purchases require explicit server authorization',async()=>{
 mode='test'; const before=rpcCalls; delete process.env.DAROTA_GOOGLE_IAP_TEST_USERS;
 assert.equal((await POST(request({operation:'verify',purchaseToken:'token-google-test'}))).status,403); assert.equal(rpcCalls,before);
});
test('pending purchase never grants or acknowledges',async()=>{
 mode='pending'; const before=acknowledged; const result=await POST(request({operation:'verify',purchaseToken:'token-google-pending'}));
 assert.equal(result.status,200); assert.equal((await result.json()).premium,false); assert.equal(acknowledged,before);
});
test('verified active purchase saved then acknowledged',async()=>{
 mode='active'; const before=acknowledged; const result=await POST(request({operation:'verify',purchaseToken:'token-google-active'}));
 assert.equal(result.status,200); assert.equal((await result.json()).premium,true); assert.equal(acknowledged,before+1);
});
