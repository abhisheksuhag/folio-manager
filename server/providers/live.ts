import { z } from 'zod';
import type { Fundamentals, Holding, HistoryPoint, Security } from '../../shared/types.ts';
import type { Store } from '../db.ts';

const AV_URL='https://www.alphavantage.co/query';

/** Alpha Vantage asks for at most one request per second; a burst gets a throttle
 *  envelope instead of data. Every call goes through one process-wide queue. */
const AV_MIN_INTERVAL_MS=1300;
let avTail:Promise<unknown>=Promise.resolve();
let avLastStarted=0;
export function avSchedule<T>(task:()=>Promise<T>):Promise<T> {
  const run=avTail.then(async()=>{
    const wait=AV_MIN_INTERVAL_MS-(Date.now()-avLastStarted);
    if(wait>0) await new Promise((resolve)=>setTimeout(resolve,wait));
    avLastStarted=Date.now();
    return task();
  });
  avTail=run.catch(()=>undefined);
  return run;
}

/** Throttling and bad symbols arrive as HTTP 200 with a prose field, never an error status. */
export function avNotice(payload:unknown):string|null {
  if(!payload||typeof payload!=='object') return null;
  const record=payload as Record<string,unknown>;
  const notice=record.Note??record.Information??record['Error Message'];
  return typeof notice==='string'?notice.replace(/\s+/g,' ').trim():null;
}

export class AlphaVantageUnavailable extends Error {}

async function jsonFetch(url:string,init:RequestInit={},timeoutMs=15_000):Promise<unknown> {
  const response=await fetch(url,{...init,signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  return response.json();
}

function avUrl(key:string,params:Record<string,string>):string {
  const url=new URL(AV_URL); for(const [name,value] of Object.entries({...params,apikey:key})) url.searchParams.set(name,value); return url.toString();
}

/** Cache TTLs. The free tier allows 25 calls a day, so repeat views must cost nothing. */
export const AV_TTL={quote:15*60_000,daily:12*60*60_000,overview:7*24*60*60_000,search:24*60*60_000} as const;

/**
 * One cached, rate-limited Alpha Vantage call. On failure a previously cached
 * payload is served rather than nothing - stale fundamentals beat a broken page.
 */
async function avCall(store:Store|null,key:string,params:Record<string,string>,cacheKey:string,ttlMs:number):Promise<unknown> {
  const hit=store?.readCache(cacheKey)??null;
  if(hit&&!hit.expired) return hit.payload;
  try {
    const payload=await avSchedule(()=>jsonFetch(avUrl(key,params)));
    const notice=avNotice(payload);
    if(notice) throw new AlphaVantageUnavailable(notice);
    store?.writeCache(cacheKey,payload,'Alpha Vantage',new Date().toISOString(),ttlMs);
    return payload;
  } catch(error) {
    if(hit) return hit.payload;
    throw error;
  }
}

function liveId(region:string,exchange:string,ticker:string):string {
  const country=region.toLowerCase().includes('india')||exchange.toUpperCase().includes('NSE')||exchange.toUpperCase().includes('BSE')?'in':'us';
  return `${country}:${exchange.toLowerCase()}:${ticker.toLowerCase()}`;
}

export function colorFor(value:string):string {
  let hash=0; for(const char of value) hash=(hash*31+char.charCodeAt(0))>>>0;
  return `hsl(${hash%360} 55% 45%)`;
}

export async function alphaSearch(store:Store|null,query:string,key:string):Promise<Security[]> {
  const data=await avCall(store,key,{function:'SYMBOL_SEARCH',keywords:query},`av:search:${query.toLowerCase()}`,AV_TTL.search) as Record<string,unknown>;
  const matches=Array.isArray(data.bestMatches)?data.bestMatches as Array<Record<string,unknown>>:[];
  return matches.slice(0,20).flatMap((row)=>{
    const ticker=String(row['1. symbol']??'').trim(); const name=String(row['2. name']??'').trim();
    const region=String(row['4. region']??''); const currency=String(row['8. currency']??'').toUpperCase();
    if(!ticker||!name||!['USD','INR'].includes(currency)) return [];
    // Alpha Vantage's field 3 is the instrument type, not the listing exchange.
    const type=String(row['3. type']??'').trim();
    const assetClass:Security['assetClass']=/mutual fund/i.test(type)?'Mutual fund':/ETF/i.test(type)?'ETF':currency==='INR'?'Indian equity':'US equity';
    const exchange='UNKNOWN';
    return [{id:liveId(region,exchange,ticker),ticker,name,exchange,currency:currency as 'USD'|'INR',country:currency==='INR'?'IN':'US',assetClass,sector:'Unavailable',color:colorFor(ticker),price:0,previousClose:0,indices:[],asOf:'',source:'Alpha Vantage symbol search'} satisfies Security];
  });
}

const quoteSchema=z.object({'01. symbol':z.string(),'05. price':z.coerce.number(),'06. volume':z.coerce.number().optional(),'07. latest trading day':z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),'08. previous close':z.coerce.number(),'10. change percent':z.string().optional()}).passthrough();

/**
 * The quote is required; history and fundamentals are enrichment. When those two
 * are throttled the page still renders with a price, and each unavailable part
 * says so in its own source label instead of failing the whole lookup.
 */
export async function alphaStock(store:Store|null,base:Security,key:string,includeOverview=true):Promise<{security:Security;history:HistoryPoint[];fundamentals:Fundamentals}> {
  // Do not silently replace an NSE instrument with the BSE listing under the same id.
  if(base.country==='IN') throw new AlphaVantageUnavailable('Alpha Vantage does not provide this exact Indian listing; an alternate exchange was not substituted.');
  const symbol=base.ticker;
  const quotePayload=await avCall(store,key,{function:'GLOBAL_QUOTE',symbol},`av:quote:${symbol}`,AV_TTL.quote) as Record<string,unknown>;
  const quoteRaw=quotePayload['Global Quote'];
  if(!quoteRaw||typeof quoteRaw!=='object'||!Object.keys(quoteRaw as object).length) {
    throw new AlphaVantageUnavailable(`Alpha Vantage has no quote for "${symbol}". Mutual funds and unsuffixed Indian tickers are outside its symbol universe.`);
  }
  const quote=quoteSchema.parse(quoteRaw);

  let history:HistoryPoint[]=[]; let historyNote='';
  try {
    const dailyPayload=await avCall(store,key,{function:'TIME_SERIES_DAILY',symbol,outputsize:'full'},`av:daily:${symbol}`,AV_TTL.daily) as Record<string,unknown>;
    const daily=dailyPayload['Time Series (Daily)'];
    if(daily&&typeof daily==='object') {
      history=Object.entries(daily as Record<string,Record<string,unknown>>).slice(0,1826)
        .map(([date,row])=>({date,value:Number(row['4. close']),invested:0,netFlow:0}))
        .filter((row)=>Number.isFinite(row.value)).reverse();
    }
  } catch(error) { historyNote=error instanceof Error?error.message:'unavailable'; }

  let overview:Record<string,unknown>={}; let overviewNote='';
  try { if(includeOverview)overview=await avCall(store,key,{function:'OVERVIEW',symbol},`av:overview:${symbol}`,AV_TTL.overview) as Record<string,unknown>; }
  catch(error) { overviewNote=error instanceof Error?error.message:'unavailable'; }

  const number=(name:string)=>{const value=Number(overview[name]); return Number.isFinite(value)?value:undefined;};
  const now=new Date().toISOString();
  const dividendFraction=number('DividendYield');
  const security:Security={...base,price:quote['05. price'],previousClose:quote['08. previous close'],volume:quote['06. volume'],marketCap:number('MarketCapitalization'),pe:number('PERatio'),eps:number('EPS'),dividendYield:dividendFraction===undefined?undefined:Number((dividendFraction*100).toFixed(8)),high52:number('52WeekHigh'),low52:number('52WeekLow'),sector:String(overview.Sector??base.sector),description:String(overview.Description??base.description??''),asOf:quote['07. latest trading day']??history.at(-1)?.date??'',source:historyNote||overviewNote?'Alpha Vantage (partial)':'Alpha Vantage'};
  // OVERVIEW exposes mixed TTM metrics, not a complete annual statement. The
  // FinancialPeriod contract requires every field, so no period is safer than zeros.
  const fundamentals:Fundamentals={periods:[],currency:base.currency,source:overviewNote?`Unavailable: ${overviewNote}`:'Alpha Vantage overview has no complete annual periods',asOf:quote['07. latest trading day']??now};
  return {security,history,fundamentals};
}

export async function alphaFxRate(key:string,from='USD',to='INR'):Promise<{rate:number;asOf:string}> {
  const payload=await avSchedule(()=>jsonFetch(avUrl(key,{function:'CURRENCY_EXCHANGE_RATE',from_currency:from,to_currency:to}))) as Record<string,unknown>;
  const notice=avNotice(payload);
  const quote=payload['Realtime Currency Exchange Rate'] as Record<string,unknown>|undefined;
  if(!quote) throw new AlphaVantageUnavailable(notice??'Alpha Vantage returned no exchange rate');
  const rate=Number(quote['5. Exchange Rate']);
  if(!Number.isFinite(rate)||rate<=0) throw new Error('Alpha Vantage returned an unusable exchange rate');
  const refreshed=String(quote['6. Last Refreshed']??'').trim();
  return {rate,asOf:refreshed?refreshed.replace(' ','T')+'Z':new Date().toISOString()};
}

export async function exchangeUpstoxCode(input:{code:string;clientId:string;clientSecret:string;redirectUri:string}):Promise<{accessToken:string;expiresAt:string}> {
  const body=new URLSearchParams({code:input.code,client_id:input.clientId,client_secret:input.clientSecret,redirect_uri:input.redirectUri,grant_type:'authorization_code'});
  const payload=await jsonFetch('https://api.upstox.com/v2/login/authorization/token',{method:'POST',headers:{accept:'application/json','content-type':'application/x-www-form-urlencoded'},body}) as Record<string,unknown>;
  const accessToken=String(payload.access_token??''); if(!accessToken) throw new Error('Upstox token response did not contain an access token');
  const expiresAt=typeof payload.expires_at==='string'?payload.expires_at:new Date(new Date().setHours(23,59,59,999)).toISOString();
  return {accessToken,expiresAt};
}

const upstoxHolding=z.object({instrument_token:z.string().optional(),trading_symbol:z.string(),quantity:z.coerce.number(),average_price:z.coerce.number(),last_price:z.coerce.number(),close_price:z.coerce.number().optional(),isin:z.string().optional(),exchange:z.string().optional()}).passthrough();

export async function fetchUpstoxHoldings(token:string):Promise<Array<Omit<Holding,'id'>>> {
  const response=await fetch('https://api.upstox.com/v2/portfolio/long-term-holdings',{headers:{accept:'application/json',authorization:`Bearer ${token}`},signal:AbortSignal.timeout(20_000)});
  if(response.status===401) { const error=new Error('Upstox authorization expired'); (error as Error&{status?:number}).status=401; throw error; }
  if(!response.ok) throw new Error(`Upstox holdings returned HTTP ${response.status}`);
  const payload=await response.json() as Record<string,unknown>;
  if(payload.status!=='success'||!Array.isArray(payload.data)) throw new Error('Upstox holdings returned an unrecognized success envelope');
  const data=payload.data;
  return data.map((item,index)=>{
    const row=upstoxHolding.parse(item); const exchange=(row.exchange??row.instrument_token?.split('|')[0]??'NSE').replace('_EQ','');
    const security:Security={id:`in:${exchange.toLowerCase()}:${row.trading_symbol.toLowerCase()}`,ticker:row.trading_symbol,name:row.trading_symbol,exchange,currency:'INR',country:'IN',assetClass:'Indian equity',sector:'Unavailable from Upstox holdings API',isin:row.isin,color:colorFor(row.trading_symbol),price:row.last_price,previousClose:row.close_price??row.last_price,indices:[],asOf:new Date().toISOString(),source:'Upstox holdings API'};
    return {security,broker:'Upstox' as const,accountId:'upstox',quantity:row.quantity,averagePrice:row.average_price};
  });
}
