import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Store } from '../server/db.ts';
import { loadMarketTrend, parseDailyCloses } from '../server/providers/market-trends.ts';
import { trendGeometry, type MarketTrend } from '../shared/market-trends.ts';
import { createApp } from '../server/app.ts';
import { sealToken } from '../server/security.ts';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';

test('sparkline and change share endpoints, including falling and flat series',()=>{
  const falling=trendGeometry([{date:'2026-09-03',value:100},{date:'2026-09-04',value:90}])!;
  assert.ok(Math.abs(falling.change+10)<1e-10);assert.equal(falling.end.y,33);
  const flat=trendGeometry([{date:'2026-09-03',value:100},{date:'2026-09-04',value:100}])!;
  assert.equal(flat.change,0);assert.equal(flat.path,'M3.00,19.00 L93.00,19.00');
  assert.equal(trendGeometry([{date:'2026-09-03',value:100}]),null);
});

test('daily closes are sorted, validated and preserve the Indian trading date',()=>{
  assert.deepEqual(parseDailyCloses({status:'success',data:{candles:[
    ['2026-09-04T00:00:00+05:30',1,2,1,24000],
    ['2026-09-03T00:00:00+05:30',1,2,1,24500],
    ['invalid',1,2,1,50],['2026-02-30',1,2,1,50],['2026-09-02',1,2,1,-1],
  ]}},'upstox'),[{date:'2026-09-03',value:24500},{date:'2026-09-04',value:24000}]);
  assert.deepEqual(parseDailyCloses({'Time Series (Daily)':{'2026-09-04':{'4. close':'110'},'2026-09-03':{'4. close':'100'},'2026-09-02':{'4. close':'NaN'}}},'alpha'),[{date:'2026-09-03',value:100},{date:'2026-09-04',value:110}]);
});

test('US trend uses a daily ETF proxy, caches requests, and retains stale history on failure',async()=>{
  const store=new Store(':memory:');let calls=0;let fail=false;
  const fetcher:typeof fetch=async(input,init)=>{
    calls++;const url=new URL(String(input));
    assert.equal(init?.method,'GET');assert.equal(url.searchParams.get('function'),'TIME_SERIES_DAILY');
    assert.equal(url.searchParams.get('symbol'),'SPY');assert.equal(url.searchParams.get('outputsize'),'compact');
    return Response.json(fail?{Information:'Rate limit'}:{'Time Series (Daily)':{'2026-09-03':{'4. close':'100'},'2026-09-04':{'4. close':'110'}}});
  };
  try {
    const opts={store,id:'SP500' as const,userId:'synthetic',alphaKey:'fake',fetcher};
    const [first,parallel]=await Promise.all([loadMarketTrend(opts),loadMarketTrend(opts)]);
    assert.equal(first.instrument,'SPY ETF proxy');assert.equal(first.points.length,2);assert.deepEqual(first,parallel);
    await loadMarketTrend(opts);assert.equal(calls,1);
    store.db.prepare("UPDATE cached_market_data SET expires_at='2000-01-01'").run();fail=true;
    const stale=await loadMarketTrend(opts);assert.equal(stale.stale,true);assert.deepEqual(stale.points,first.points);
    await loadMarketTrend(opts);assert.equal(calls,2);
  } finally {store.db.close();}
});

test('NIFTY requests only index history and unavailable feeds never fabricate charts',async()=>{
  const store=new Store(':memory:');let calls=0;
  const fetcher:typeof fetch=async(input,init)=>{
    calls++;assert.match(String(input),/historical-candle\/NSE_INDEX%7CNifty%2050\/days\/1\//);
    assert.equal(init?.method,'GET');assert.equal(new Headers(init?.headers).get('authorization'),'Bearer fake');
    return Response.json({status:'success',data:{candles:[['2026-09-03T00:00:00+05:30',1,2,1,24500],['2026-09-04T00:00:00+05:30',1,2,1,24000]]}});
  };
  try {
    const noKey=await loadMarketTrend({store,id:'NIFTY50',userId:'test',fetcher});
    assert.equal(noKey.points.length,0);assert.equal(calls,0);
    const trend=await loadMarketTrend({store,id:'NIFTY50',userId:'test',fetcher,upstoxToken:'fake'});
    assert.equal(trend.instrument,'Index');assert.equal(trend.points.at(-1)?.value,24000);assert.equal(calls,1);
    const failure=await loadMarketTrend({store,id:'QQQ',userId:'test',alphaKey:'fake',fetcher:async()=>Response.json({Information:'limit'})});
    assert.deepEqual(failure.points,[]);assert.match(failure.notice??'',/unavailable/i);
  } finally {store.db.close();}
});

test('trend endpoint requires a session and uses only that user’s active Upstox connection',async()=>{
  let calls=0;const encryptionKey='a'.repeat(64);
  const app=createApp({environment:'test',databasePath:':memory:',tokenEncryptionKey:encryptionKey,researchFetch:async(input,init)=>{
    calls++;assert.equal(new URL(String(input)).hostname,'api.upstox.com');
    assert.equal(new Headers(init?.headers).get('authorization'),'Bearer synthetic-token');
    return Response.json({status:'success',data:{candles:[['2026-09-03',1,2,1,24500],['2026-09-04',1,2,1,24000]]}});
  }});
  const store=app.locals.store as Store;
  const owner=store.createUser({name:'Owner',email:'owner@synthetic.invalid'});
  const other=store.createUser({name:'Other',email:'other@synthetic.invalid'});
  const connectionId=store.ensureConnection(owner.id,'Upstox');
  store.saveBrokerToken(connectionId,sealToken('synthetic-token',encryptionKey),'2000-01-01');
  const ownerToken=store.createSession(owner.id).token,otherToken=store.createSession(other.id).token;
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');
  const url=`http://127.0.0.1:${(server.address() as AddressInfo).port}/api/market-trends`;
  const get=(token:string)=>fetch(url,{headers:{cookie:`folio_session=${token}`}});
  try {
    assert.equal((await fetch(url)).status,401);
    const expired=await (await get(ownerToken)).json() as MarketTrend[];
    assert.ok(expired.every(item=>item.points.length===0));assert.equal(calls,0);
    store.saveBrokerToken(connectionId,sealToken('synthetic-token',encryptionKey),'2099-01-01');
    const result=await (await get(ownerToken)).json() as MarketTrend[];
    assert.equal(result.find(item=>item.id==='NIFTY50')?.points.length,2);assert.equal(calls,1);
    assert.ok(!JSON.stringify(result).includes('synthetic-token'));
    const foreign=await (await get(otherToken)).json() as MarketTrend[];
    assert.ok(foreign.every(item=>item.points.length===0));assert.equal(calls,1);
  }finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));store.db.close();}
});
