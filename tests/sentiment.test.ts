import assert from 'node:assert/strict';
import { test } from 'node:test';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Store } from '../server/db.ts';
import { createApp } from '../server/app.ts';
import { parseSentiment, loadSentiment, demoSentiment } from '../server/providers/sentiment.ts';
import { globalSentiment, type SentimentReading } from '../shared/sentiment.ts';

const now=Date.now();
const date=new Date(now).toISOString();
const crypto={data:[{value:'74',value_classification:'Greed',timestamp:String(Math.floor(now/1000))}],metadata:{error:null}};
const india=(value:unknown=29)=>`<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({props:{pageProps:{nowData:{currentValue:value,date}}}})}</script>`;
const us={fear_and_greed:{score:44.5,rating:'fear',timestamp:date}};

test('provider scores retain dates, zero values and provider-specific sentiment bands',()=>{
  assert.equal(parseSentiment('US',us,now)?.score,44.5);
  assert.equal(parseSentiment('IN',india(),now)?.label,'Extreme fear');
  assert.equal(parseSentiment('IN',india(70),now)?.label,'Greed');
  assert.equal(parseSentiment('IN',india(0),now)?.score,0);
  assert.equal(parseSentiment('CRYPTO',crypto,now)?.label,'Greed');
  for(const score of [null,'',false,-1,101,'NaN'])assert.equal(parseSentiment('IN',india(score),now),null);
  assert.equal(parseSentiment('US',{fear_and_greed:{score:50,timestamp:'invalid'}},now),null);
  assert.equal(parseSentiment('US',{fear_and_greed:{score:50,timestamp:new Date(now+86400_000).toISOString()}},now),null);
  assert.equal(parseSentiment('CRYPTO',{...crypto,metadata:{error:'failed'}},now),null);
  assert.equal(parseSentiment('IN','<html>Service unavailable</html>',now),null);
});

test('global is an explicit full-coverage blend and never reweights missing or stale feeds',()=>{
  const rows=demoSentiment().slice(1).map(r=>({...r,asOf:date,stale:false,score:60}));
  const global=globalSentiment(rows);
  assert.equal(global.score,60);assert.equal(global.source,'Folio blend');
  assert.equal(globalSentiment(rows.slice(1)).score,null);
  assert.equal(globalSentiment(rows.map((r,i)=>i? r:{...r,stale:true})).score,null);
  assert.equal(globalSentiment([rows[0],rows[0],rows[2]]).score,null);
});

test('public GET feeds coalesce, cache, isolate failures and retain labeled saved readings',async()=>{
  const store=new Store(':memory:');let calls=0;let fail=false;
  const fetcher:typeof fetch=async(input,init)=>{
    calls++;assert.equal(init?.method,'GET');assert.equal(init.redirect,'error');
    assert.equal(new Headers(init.headers).has('authorization'),false);
    if(fail)throw new Error('upstream secret must not leak');
    return String(input).includes('tickertape')?new Response(india()):Response.json(String(input).includes('cnn')?us:crypto);
  };
  try{
    const [a,b]=await Promise.all([loadSentiment(store,fetcher),loadSentiment(store,fetcher)]);
    assert.deepEqual(a,b);assert.equal(calls,3);assert.equal(a.length,4);assert.notEqual(a[0].score,null);
    await loadSentiment(store,fetcher);assert.equal(calls,3);
    store.db.prepare("UPDATE cached_market_data SET expires_at='2000-01-01'").run();fail=true;
    const saved=await loadSentiment(store,fetcher);
    assert.equal(saved[0].score,null);assert.ok(saved.slice(1).every(r=>r.stale&&r.score!==null));
    assert.ok(!JSON.stringify(saved).includes('secret'));
    await loadSentiment(store,fetcher);assert.equal(calls,6);
  }finally{store.db.close();}
});

test('aged source timestamps are stale even when freshly fetched; failures never invent scores',async()=>{
  const store=new Store(':memory:');
  try{
    const result=await loadSentiment(store,async input=>String(input).includes('cnn')?Response.json({fear_and_greed:{score:50,timestamp:'2020-01-01T00:00:00Z'}}):new Response('blocked',{status:403}));
    assert.equal(result[0].score,null);assert.equal(result[1].stale,true);
    assert.equal(result[2].score,null);assert.equal(result[3].score,null);
  }finally{store.db.close();}
});

test('sentiment endpoint requires auth and demo makes no provider requests',async()=>{
  let calls=0;
  const app=createApp({environment:'test',databasePath:':memory:',researchFetch:async()=>{calls++;throw Error('blocked');}});
  const store=app.locals.store as Store;
  const user=store.createUser({name:'Demo',email:'sentiment@synthetic.invalid',demo:true});
  const token=store.createSession(user.id).token;
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/sentiment`;
  try{
    assert.equal((await fetch(url)).status,401);
    const response=await fetch(url,{headers:{cookie:`folio_session=${token}`}});
    assert.equal(response.status,200);
    const rows=await response.json() as SentimentReading[];
    assert.equal(rows.length,4);assert.ok(rows.every(r=>r.demo));assert.equal(calls,0);
  }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));store.db.close();}
});
