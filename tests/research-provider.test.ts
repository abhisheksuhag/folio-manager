import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../server/app.ts';
import type { Store } from '../server/db.ts';
import { indmoneyFundArguments, parseIndmoneyFundCompositionPayload, selectIndmoneyFundPayload } from '../server/providers/indmoney.ts';
import { parseAlphaEtfProfile, parseNiftyConstituents } from '../server/providers/research.ts';

type JsonInit = Omit<RequestInit, 'body'> & { body?: unknown };

class Client {
  cookie = '';
  csrf = '';
  constructor(readonly baseUrl: string) {}
  async request(path: string, init: JsonInit = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('cookie', this.cookie);
    if (this.csrf && !['GET', 'HEAD'].includes(init.method ?? 'GET')) headers.set('x-csrf-token', this.csrf);
    if (init.body !== undefined) headers.set('content-type', 'application/json');
    const response = await fetch(`${this.baseUrl}${path}`, {...init, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body)});
    const cookie = response.headers.get('set-cookie');
    if (cookie) this.cookie = cookie.split(';', 1)[0];
    return response;
  }
  async session() {
    const response = await this.request('/api/session');
    const body = await response.json() as { csrfToken: string };
    this.csrf = body.csrfToken;
  }
  async register(email: string) {
    await this.session();
    const response = await this.request('/api/auth/register', {method:'POST', body:{name:'Research Test', email, password:'correct horse battery staple'}});
    assert.equal(response.status, 200);
    await this.session();
  }
  async demo() {
    await this.session();
    const response = await this.request('/api/auth/demo', {method:'POST', body:{}});
    assert.equal(response.status, 200);
    await this.session();
  }
}

async function start(options: Record<string, unknown> = {}) {
  const app = createApp({databasePath:':memory:', environment:'test', ...options});
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address() as AddressInfo;
  return {app,server, client:new Client(`http://127.0.0.1:${address.port}`)};
}

async function close(server: Server) {
  server.close();
  await once(server, 'close');
}

test('known index metadata stays available when the public provider is unavailable', async () => {
  const {server, client} = await start();
  try {
    await client.register('known-index@example.test');
    for (const id of ['SP500','QQQ','NIFTY50','NIFTY100','NIFTY500']) {
      const response = await client.request(`/api/indices/${id}`);
      assert.equal(response.status, 200, id);
      const body = await response.json() as {id:string; name:string; securities:unknown[]; complete:boolean; notice?:string};
      assert.equal(body.id, id);
      assert.ok(body.name.length > 2);
      assert.deepEqual(body.securities, []);
      assert.equal(body.complete, false);
      assert.match(body.notice ?? '', /unavailable|not configured/i);
    }
    assert.equal((await client.request('/api/indices/NOTREAL')).status, 404);
  } finally { await close(server); }
});

test('demo explore and fund composition are hermetic and preserve partial coverage', async () => {
  const originalFetch = globalThis.fetch;
  let upstreamCalls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    upstreamCalls += 1;
    throw new Error('demo attempted an upstream request');
  };
  const {server, client} = await start();
  try {
    await client.demo();
    const exploreResponse = await client.request('/api/explore?market=US&universe=QQQ&q=QQQ');
    assert.equal(exploreResponse.status, 200);
    const explore = await exploreResponse.json() as {securities:Array<{ticker:string}>; indices:unknown[]; complete:boolean; notices:string[]};
    assert.deepEqual(explore.securities.map((item)=>item.ticker), ['QQQ']);
    assert.equal(explore.indices.length, 5);
    assert.equal(explore.complete, false);
    assert.ok(explore.notices.length > 0);

    const stockResponse = await client.request('/api/stocks/us%3Anasdaq%3Aqqq');
    assert.equal(stockResponse.status, 200);
    const stock = await stockResponse.json() as {fundamentals:{periods:unknown[]}; composition:{status:string;holdings:Array<{weight:number}>;asOf:string|null;expenseRatio?:number;aum?:number}};
    assert.deepEqual(stock.fundamentals.periods, []);
    assert.equal(stock.composition.status, 'partial');
    assert.ok(stock.composition.holdings.reduce((sum,item)=>sum+item.weight,0) < 100);
    assert.equal(stock.composition.asOf, '2026-08-31');
    assert.ok((stock.composition.expenseRatio ?? 0) > 0);
    assert.ok((stock.composition.aum ?? 0) > 0);
    assert.equal(upstreamCalls, 0);
  } finally {
    await close(server);
    globalThis.fetch = originalFetch;
  }
});

test('mutual funds never call the generic stock provider and retain their NAV', async () => {
  const originalFetch = globalThis.fetch;
  let providerCalls = 0;
  globalThis.fetch = async (input, init) => {
    if (String(input).startsWith('http://127.0.0.1:')) return originalFetch(input, init);
    providerCalls += 1;
    throw new Error('generic stock provider called');
  };
  const {server, client} = await start({alphaVantageKey:'fake-key'});
  try {
    await client.register('fund-dispatch@example.test');
    const csv = [
      'ticker,name,exchange,currency,country,assetClass,sector,quantity,averagePrice,price,previousClose,asOf',
      '2995,Parag Parikh Flexi Cap Fund,INDmoney,INR,IN,Mutual fund,Diversified,10,75,82.5,82.4,2026-09-04',
    ].join('\n');
    assert.equal((await client.request('/api/import', {method:'POST', body:{csv, broker:'Manual', kind:'holdings'}})).status, 200);
    const response = await client.request('/api/stocks/in%3Aindmoney%3A2995');
    assert.equal(response.status, 200);
    const stock = await response.json() as {security:{price:number}; fundamentals:{periods:unknown[]}; composition:{status:string;reason?:string}};
    assert.equal(stock.security.price, 82.5);
    assert.deepEqual(stock.fundamentals.periods, []);
    assert.equal(stock.composition.status, 'unavailable');
    assert.match(stock.composition.reason ?? '', /INDmoney|connection/i);
    assert.equal(providerCalls, 0);
  } finally {
    await close(server);
    globalThis.fetch = originalFetch;
  }
});

test('live explore validates filters and preserves useful local securities on provider failure', async () => {
  const researchFetch = async () => new Response('upstream down', {status:503});
  const {server, client} = await start({researchFetch});
  try {
    await client.register('partial-explore@example.test');
    const csv = [
      'ticker,name,exchange,currency,country,assetClass,sector,quantity,averagePrice,price,previousClose,asOf',
      'INFY,Infosys,NSE,INR,IN,Indian equity,Technology,1,1400,1540,1531,2026-09-04',
    ].join('\n');
    assert.equal((await client.request('/api/import', {method:'POST', body:{csv, broker:'Manual', kind:'holdings'}})).status, 200);
    const response = await client.request('/api/explore?market=IN&universe=ALL&q=info');
    assert.equal(response.status, 200);
    const body = await response.json() as {securities:Array<{ticker:string}>;complete:boolean;notices:string[]};
    assert.deepEqual(body.securities.map((item)=>item.ticker), ['INFY']);
    assert.equal(body.complete, false);
    assert.match(body.notices.join(' '), /503|unavailable/i);
    const selected=await (await client.request('/api/explore?market=IN&universe=NIFTY50&q=info')).json() as {securities:unknown[]};
    assert.deepEqual(selected.securities,[], 'Unverified local membership must not appear in a selected index');
    assert.equal((await client.request('/api/explore?market=GB')).status, 400);
    assert.equal((await client.request('/api/explore?universe=DOW')).status, 400);
  } finally { await close(server); }
});

test('Alpha Vantage ETF fractions become percentages exactly once and fetch date is not holdings date', () => {
  const composition=parseAlphaEtfProfile({
    net_assets:'325000000000',net_expense_ratio:'0.0020',
    holdings:[{symbol:'AAPL',description:'Apple Inc',weight:'0.125'}],
    sectors:[{sector:'Technology',weight:'0.60'}],
  },'QQQ','2026-09-07T10:20:30.000Z');
  assert.equal(composition.holdings[0].weight,12.5);
  assert.equal(composition.sectors[0].weight,60);
  assert.equal(composition.expenseRatio,0.2);
  assert.equal(composition.aum,325_000_000_000);
  assert.equal(composition.asOf,null);
  assert.equal(composition.fetchedAt,'2026-09-07T10:20:30.000Z');
  assert.deepEqual(composition.countries,[], 'A US-listed ETF can own international assets');
  assert.deepEqual(composition.assetAllocation,[], 'ETF_PROFILE does not report an asset allocation');
  assert.equal(composition.holdings[0].country,undefined);
  assert.equal(composition.holdings[0].securityId,undefined);
  assert.throws(()=>parseAlphaEtfProfile({holdings:[{symbol:'AAPL',description:'Apple Inc',weight:'12.5'}]},'QQQ'),/unrecognized|valid/i);
  assert.throws(()=>parseAlphaEtfProfile({holdings:[]},'QQQ'),/unrecognized/i);
});

test('official Nifty CSV parser requires documented identifiers and never invents weights', () => {
  const csv='Company Name,Industry,Symbol,Series,ISIN Code\nInfosys Ltd.,Information Technology,INFY,EQ,INE009A01021\n';
  const [security]=parseNiftyConstituents(csv,'NIFTY50');
  assert.equal(security.id,'in:nse:infy');
  assert.equal(security.isin,'INE009A01021');
  assert.equal(security.price,0);
  assert.equal('weight' in security,false);
  assert.throws(()=>parseNiftyConstituents('name,ticker\nInfosys,INFY\n','NIFTY50'),/schema/i);
});

test('INDmoney fund parser preserves provider percentages and rejects unknown payloads', () => {
  const composition=parseIndmoneyFundCompositionPayload({
    scheme_name:'Parag Parikh Flexi Cap Fund - Direct Growth',
    aum:1250000000000,expense_ratio:0.63,benchmark:'Nifty 500 TRI',category:'Flexi Cap',portfolio_date:'2026-08-31',
    holdings:[{security_name:'HDFC Bank Ltd',symbol:'HDFCBANK',isin:'INE040A01034',percentage_to_nav:8.2,sector:'Financials',country:'India'}],
    sector_allocation:[{name:'Financials',percentage:31.4}],country_allocation:[{name:'India',percentage:82}],asset_allocation:[{name:'Equity',percentage:91.5}],
  },'2026-09-07T10:20:30.000Z');
  assert.equal(composition.holdings[0].weight,8.2);
  assert.equal(composition.sectors[0].weight,31.4);
  assert.equal(composition.asOf,'2026-08-31');
  assert.equal(composition.fetchedAt,'2026-09-07T10:20:30.000Z');
  assert.equal(composition.status,'partial');
  assert.throws(()=>parseIndmoneyFundCompositionPayload({data:[]},'2026-09-07T10:20:30.000Z'),/unrecognized/i);
  assert.throws(()=>parseIndmoneyFundCompositionPayload({...composition,holdings:[{security_name:'Bad',percentage_to_nav:120}]},'2026-09-07T10:20:30.000Z'),/unrecognized|percentage/i);
});

test('INDmoney fund tool arguments use only an explicitly recognized read-only schema', () => {
  assert.deepEqual(indmoneyFundArguments({type:'object',properties:{ind_keys:{type:'array',items:{type:'string'}}},required:['ind_keys']},'2995'),{ind_keys:['2995']});
  assert.deepEqual(indmoneyFundArguments({type:'object',properties:{fund_code:{type:'string'}},required:['fund_code']},'2995'),{fund_code:'2995'});
  assert.throws(()=>indmoneyFundArguments({type:'object',properties:{query:{type:'string'}}},'2995'),/supported read-only/i);
  assert.throws(()=>indmoneyFundArguments({type:'object',properties:{fund_code:{type:'number'}}},'2995'),/supported read-only/i);
  assert.throws(()=>indmoneyFundArguments({type:'object',properties:{fund_code:{type:'string'}},required:['fund_code','account']},'2995'),/unsupported/i);
});

test('fund identity requires a matching provider key or exact scheme name',()=>{
  const right={scheme_name:'Example Fund Direct Growth',holdings:[]};
  assert.equal(selectIndmoneyFundPayload({'2995':right},'2995','Displayed fund name'),right);
  assert.equal(selectIndmoneyFundPayload({fund_details:right},'2995','Example Fund Direct Growth'),right);
  assert.throws(()=>selectIndmoneyFundPayload({fund_details:{...right,scheme_name:'Example Fund Regular Growth'}},'2995','Example Fund Direct Growth'),/identity/i);
});

test('Explore searches beyond index membership and retains recorded Indian prices on detail',async()=>{
  const {app,server,client}=await start({alphaVantageKey:'synthetic-key'});
  try{
    await client.register('remote-search@example.test');
    const store=app.locals.store as Store;
    store.writeCache('av:search:example',{bestMatches:[{'1. symbol':'EXAMPLE','2. name':'Example Company','3. type':'Equity','4. region':'United States','8. currency':'USD'}]},'Synthetic search','',60_000);
    const result=await (await client.request('/api/explore?market=US&q=example')).json() as {securities:Array<{ticker:string}>};
    assert.deepEqual(result.securities.map(s=>s.ticker),['EXAMPLE']);
    const csv='ticker,name,exchange,currency,country,assetClass,sector,quantity,averagePrice,price,previousClose,asOf\nINFY,Infosys,NSE,INR,IN,Indian equity,Technology,1,1400,1540,1531,2026-09-04';
    assert.equal((await client.request('/api/import',{method:'POST',body:{csv,broker:'Manual',kind:'holdings'}})).status,200);
    const response=await client.request('/api/stocks/in%3Anse%3Ainfy');
    assert.equal(response.status,200);
    const stock=await response.json() as {security:{price:number;exchange:string};notices:string[]};
    assert.equal(stock.security.price,1540);assert.equal(stock.security.exchange,'NSE');assert.ok(stock.notices.length);
  }finally{await close(server);}
});

test('searched ETFs stay openable and watchlistable only for the researching user', async () => {
  const originalFetch=globalThis.fetch;
  const providerFetch:typeof fetch=async(input,init)=>{
    if(String(input).startsWith('http://127.0.0.1:')) return originalFetch(input,init);
    const url=new URL(String(input));
    if(url.searchParams.get('function')==='SYMBOL_SEARCH') return new Response(JSON.stringify({bestMatches:[{'1. symbol':'QQQ','2. name':'Invesco QQQ Trust','3. type':'ETF','4. region':'United States','8. currency':'USD'}]}),{status:200,headers:{'content-type':'application/json'}});
    if(url.searchParams.get('function')==='ETF_PROFILE') return new Response(JSON.stringify({net_assets:'300000000000',net_expense_ratio:'0.002',holdings:[{symbol:'AAPL',description:'Apple Inc',weight:'0.08'}],sectors:[{sector:'Technology',weight:'0.50'}]}),{status:200,headers:{'content-type':'application/json'}});
    if(url.searchParams.get('function')==='GLOBAL_QUOTE')return Response.json({'Global Quote':{'01. symbol':'QQQ','05. price':'565','08. previous close':'560','07. latest trading day':'2026-09-04'}});
    if(url.searchParams.get('function')==='TIME_SERIES_DAILY')return Response.json({'Time Series (Daily)':{'2026-09-04':{'4. close':'565'},'2026-09-03':{'4. close':'560'}}});
    throw new Error(`Unexpected provider request ${url}`);
  };
  globalThis.fetch=providerFetch;
  const {server,client:first}=await start({alphaVantageKey:'fake-key',researchFetch:providerFetch,usdInr:87});
  try {
    await first.register('catalog-one@example.test');
    const search=await (await first.request('/api/search?q=QQQ')).json() as {securities:Array<{id:string;assetClass:string;exchange:string;asOf:string}>};
    assert.equal(search.securities[0].assetClass,'ETF');
    assert.equal(search.securities[0].exchange,'UNKNOWN');
    assert.equal(search.securities[0].asOf,'');
    const detail=await first.request('/api/stocks/us%3Aunknown%3Aqqq');
    assert.equal(detail.status,200);
    const stock=await detail.json() as {security:{price:number};history:unknown[];composition:{holdings:Array<{weight:number}>;asOf:null}};
    assert.equal(stock.composition.holdings[0].weight,8);
    assert.equal(stock.composition.asOf,null);
    assert.equal(stock.security.price,565);assert.equal(stock.history.length,2);
    const created=await (await first.request('/api/watchlists',{method:'POST',body:{name:'ETFs'}})).json() as {watchlist:{id:string}};
    assert.equal((await first.request(`/api/watchlists/${created.watchlist.id}/items`,{method:'POST',body:{securityId:'us:unknown:qqq'}})).status,200);
    const workspace=await (await first.request('/api/workspace')).json() as {securities:Array<{id:string;price:number}>};
    assert.equal(workspace.securities.find(s=>s.id==='us:unknown:qqq')?.price,565);

    const second=new Client(first.baseUrl);await second.register('catalog-two@example.test');
    const other=await (await second.request('/api/watchlists',{method:'POST',body:{name:'Other'}})).json() as {watchlist:{id:string}};
    assert.equal((await second.request(`/api/watchlists/${other.watchlist.id}/items`,{method:'POST',body:{securityId:'us:unknown:qqq'}})).status,400);
  } finally {await close(server);globalThis.fetch=originalFetch;}
});

test('known global crypto positions have a readable detail and foreign users cannot read them',async()=>{
  const {app,server,client}=await start();
  try{
    await client.register('crypto-fixture@example.test');const store=app.locals.store as Store;const user=store.getUserAuth('crypto-fixture@example.test')!.user;
    store.replaceBrokerHoldings(user.id,'Binance',[{accountId:'synthetic',quantity:.1,averagePrice:0,security:{id:'global:binance:btc',ticker:'BTC',name:'Bitcoin',exchange:'Binance',country:'GLOBAL',currency:'USD',assetClass:'Crypto',sector:'Crypto',color:'#444',price:60000,previousClose:0,indices:[],asOf:'2026-09-04',source:'Synthetic fixture'}}],'apikey');
    const response=await client.request('/api/stocks/global%3Abinance%3Abtc');assert.equal(response.status,200);
    const stock=await response.json() as {security:{assetClass:string;price:number}};assert.equal(stock.security.assetClass,'Crypto');assert.equal(stock.security.price,60000);
    const other=new Client(client.baseUrl);await other.register('crypto-other@example.test');assert.equal((await other.request('/api/stocks/global%3Abinance%3Abtc')).status,404);
  }finally{await close(server);}
});

test('constituent metadata enriches held prices and cannot erase recorded observations',async()=>{
  const researchFetch:typeof fetch=async()=>new Response('Company Name,Industry,Symbol,Series,ISIN Code\nInfosys Ltd.,Information Technology,INFY,EQ,INE009A01021\n');
  const {app,server,client}=await start({researchFetch});
  try{
    await client.register('quote-preservation@example.test');
    const csv='ticker,name,exchange,currency,country,assetClass,sector,quantity,averagePrice,price,previousClose,asOf\nINFY,Infosys,NSE,INR,IN,Indian equity,Technology,1,1400,1540,1531,2026-09-04';
    await client.request('/api/import',{method:'POST',body:{csv,broker:'Manual',kind:'holdings'}});
    for(let i=0;i<2;i++){
      const screen=await (await client.request('/api/explore?market=IN&universe=NIFTY50')).json() as {securities:Array<{price:number}>};
      assert.equal(screen.securities[0].price,1540);
    }
    const store=app.locals.store as Store;const user=store.getUserAuth('quote-preservation@example.test')!.user;const prior=store.researchSecurity(user.id,'in:nse:infy')!;
    store.upsertResearchSecurity(user.id,{...prior,price:0,previousClose:0,asOf:'',source:'Unpriced catalog'});
    assert.equal(store.researchSecurity(user.id,prior.id)?.price,1540);
  }finally{await close(server);}
});

test('official Nifty constituents are cached and retain unknown quote fields', async () => {
  let calls=0;
  const researchFetch:typeof fetch=async()=>{calls+=1;return new Response('Company Name,Industry,Symbol,Series,ISIN Code\nInfosys Ltd.,Information Technology,INFY,EQ,INE009A01021\n',{status:200});};
  const {server,client}=await start({researchFetch});
  try {
    await client.register('nifty-cache@example.test');
    for(let attempt=0;attempt<2;attempt+=1){
      const response=await client.request('/api/indices/NIFTY50');assert.equal(response.status,200);
      const index=await response.json() as {securities:Array<{price:number;previousClose:number;asOf:string;source:string}>;source:string;complete:boolean;notice?:string};
      assert.equal(index.securities[0].price,0);assert.equal(index.securities[0].previousClose,0);assert.equal(index.securities[0].asOf,'');
      assert.match(index.source,/NSE Indices/i);assert.equal(index.complete,false);assert.match(index.notice??'',/expected/i);
    }
    assert.equal(calls,1);
  } finally {await close(server);}
});

test('malformed cached index data is rejected without breaking known metadata', async () => {
  const {app,server,client}=await start();
  try {
    await client.register('bad-cache@example.test');
    (app.locals.store as Store).writeCache('research:index:NIFTY50',{securities:'not-an-array'},'corrupt cache','2099-01-01',60_000);
    const response=await client.request('/api/indices/NIFTY50');
    assert.equal(response.status,200);
    const body=await response.json() as {id:string;securities:unknown[];complete:boolean;notice?:string};
    assert.equal(body.id,'NIFTY50');assert.deepEqual(body.securities,[]);assert.equal(body.complete,false);assert.match(body.notice??'',/unavailable|cache/i);
  } finally {await close(server);}
});
