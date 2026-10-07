import React from './node_modules/react/index.js';
import {create,act} from './node_modules/react-test-renderer/index.js';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
globalThis.alert=()=>{};
let rows=[],rpcCalls=0,upserts=0,api,tree,quota,owner='alice';
globalThis.__quotaDb={
 from(table){
  let action='read',row,ids=[];
  const query={select(){return query;},eq(){return query;},order(){return query;},in(k,v){ids=v;return query;},delete(){action='delete';return query;},update(r){action='update';row=r;return query;},upsert(r){action='insert';row=r;return query;},then(done){let data=rows; if(action==='insert'){upserts++;rows.push({...row});data=[];} if(action==='update'){data=[{id:row.id}];} if(action==='delete'){rows=rows.filter(r=>!ids.includes(r.id));data=[];}return Promise.resolve({data,error:null}).then(done);}};
  return query;
 },
 async rpc(name,{p_deliveries}){rpcCalls++;rows.push(...p_deliveries);return {data:p_deliveries,error:null};}
};
const src=(await readFile(new URL('../../src/hooks/useDeliveries.js',import.meta.url),'utf8'))
 .replace('from "react"',`from ${JSON.stringify(new URL('./node_modules/react/index.js',import.meta.url).href)}`)
 .replace('import { supabase } from "../lib/supabase";','const supabase = globalThis.__quotaDb;')
 .replace('from "../services/subscriptionQuota"',`from ${JSON.stringify(new URL('../../src/services/subscriptionQuota.js',import.meta.url).href)}`);
const {default:useDeliveries}=await import('data:text/javascript;base64,'+Buffer.from(src).toString('base64'));
function Harness(){api=useDeliveries(owner,quota);return null;}
async function mount(q){quota=q;rows=[];rpcCalls=0;upserts=0;await act(async()=>{tree=create(React.createElement(Harness));});}
async function end(){await act(async()=>tree.unmount());}
await mount({enabled:true,prepareAdditions:async()=>null});
await act(async()=>{assert.equal((await api[1]([{id:'1',address:'Rua 1'}])).ok,false);});
assert.equal(rpcCalls,0);assert.equal(api[0].length,0);console.log('PASS cancellation makes no database write');await end();
await mount({enabled:true,prepareAdditions:async xs=>xs.slice(0,2)});
await act(async()=>{const result=await api[1](Array.from({length:80},(_,i)=>({id:String(i),address:'Rua '+i})));assert.equal(result.addedCount,2);});
assert.equal(api[0].length,2);assert.equal(rows.length,2);assert.equal(rpcCalls,1);assert.equal(upserts,0);console.log('PASS only selected deliveries are persisted, once');await end();
await mount({enabled:false});
await act(async()=>{const save=api[1];await Promise.all([save(xs=>[...xs,{id:'1',address:'Rua 1'}]),save(xs=>[...xs,{id:'2',address:'Rua 2'}])]);});
assert.equal(api[0].length,2);assert.equal(rows.length,2);assert.equal(rpcCalls,0);console.log('PASS queued additions preserve both deliveries with feature disabled');await end();
