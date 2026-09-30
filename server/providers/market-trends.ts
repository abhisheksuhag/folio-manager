import type { Store } from '../db.ts';
import { MARKET_TRENDS, type DailyClose, type MarketTrend, type MarketTrendId } from '../../shared/market-trends.ts';
import { avNotice, avSchedule } from './live.ts';
import { DEMO_AS_OF } from './demo.ts';

function record(value:unknown):Record<string,unknown> {
  return value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
}

export function parseDailyCloses(payload:unknown,provider:'alpha'|'upstox'):DailyClose[] {
  const data=record(payload);
  const rows:unknown[][]=provider==='alpha'
    ?Object.entries(record(data['Time Series (Daily)'])).map(([date,row])=>[date,record(row)['4. close']])
    :data.status==='success'&&Array.isArray(record(data.data).candles)
      ?(record(data.data).candles as unknown[]).filter(Array.isArray).map(row=>[row[0],row[4]]):[];
  const points=new Map<string,number>();
  for(const [rawDate,rawValue] of rows){
    // Preserve the exchange's calendar date, including midnight candles in IST.
    const date=typeof rawDate==='string'?rawDate.slice(0,10):'';
    const value=typeof rawValue==='number'||typeof rawValue==='string'?Number(rawValue):NaN;
    const time=Date.parse(date+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==date||!Number.isFinite(value)||value<=0)continue;
    points.set(date,value);
  }
  return [...points].sort(([a],[b])=>a.localeCompare(b)).slice(-22).map(([date,value])=>({date,value}));
}

interface Options {store:Store;id:MarketTrendId;userId:string;fetcher?:typeof fetch;alphaKey?:string;upstoxToken?:string}
const inFlight=new WeakMap<Store,Map<string,Promise<MarketTrend>>>();
const TTL=12*60*60_000;

/** Only read-only daily market data. Coalesce requests and back off on failed feeds. */
export async function loadMarketTrend(options:Options):Promise<MarketTrend> {
  const {store,id,userId,fetcher,alphaKey,upstoxToken}=options;
  const spec=MARKET_TRENDS.find(item=>item.id===id)!;
  const indian=id==='NIFTY50';
  const base:MarketTrend={...spec,points:[],source:indian?'Upstox':'Alpha Vantage'};
  const key=`market-trend:v1:${indian?userId+':':''}${id}`;
  const cached=store.readCache(key);
  const previous=cached?.payload as MarketTrend|undefined;
  if(previous&&!cached?.expired)return previous;
  if(!fetcher||!(indian?upstoxToken:alphaKey))return previous?.points.length
    ?{...previous,stale:true,notice:'Saved history · feed unavailable'}
    :{...base,notice:indian?'Connect Upstox for history':'Configure market data for history'};
  let pending=inFlight.get(store);if(!pending){pending=new Map();inFlight.set(store,pending);}
  const existing=pending.get(key);if(existing)return existing;
  const operation=(async()=>{
    try {
      let url:URL;const headers:Record<string,string>={Accept:'application/json'};
      if(indian){
        const today=new Date().toISOString().slice(0,10);
        const from=new Date(Date.now()-60*86400_000).toISOString().slice(0,10);
        url=new URL(`https://api.upstox.com/v3/historical-candle/${encodeURIComponent('NSE_INDEX|Nifty 50')}/days/1/${today}/${from}`);
        headers.Authorization=`Bearer ${upstoxToken}`;
      }else{
        url=new URL('https://www.alphavantage.co/query');
        url.search=new URLSearchParams({function:'TIME_SERIES_DAILY',symbol:id==='SP500'?'SPY':'QQQ',outputsize:'compact',apikey:alphaKey!}).toString();
      }
      const read=async()=>{
        const response=await fetcher(url.toString(),{method:'GET',headers,signal:AbortSignal.timeout(12_000),redirect:'error'});
        if(!response.ok)throw new Error('Market history unavailable');
        return response.json() as Promise<unknown>;
      };
      const payload=indian?await read():await avSchedule(read);
      if(!indian&&avNotice(payload))throw new Error('Market history unavailable');
      const points=parseDailyCloses(payload,indian?'upstox':'alpha');
      if(points.length<2)throw new Error('Insufficient market history');
      const result={...base,points};
      store.writeCache(key,result,base.source,points.at(-1)!.date,TTL);return result;
    }catch{
      // Never replace recorded points with a synthetic chart or expose provider secrets.
      const result:MarketTrend=previous?.points.length?{...previous,stale:true,notice:'Saved history · feed unavailable'}:{...base,notice:'History temporarily unavailable'};
      store.writeCache(key,result,base.source,result.points.at(-1)?.date??'',5*60_000);return result;
    }
  })();
  pending.set(key,operation);
  try{return await operation;}finally{pending.delete(key);}
}

export function demoMarketTrends():MarketTrend[] {
  const dates:string[]=[];const day=new Date(DEMO_AS_OF);
  while(dates.length<22){if(day.getUTCDay()!==0&&day.getUTCDay()!==6)dates.unshift(day.toISOString().slice(0,10));day.setUTCDate(day.getUTCDate()-1);}
  return MARKET_TRENDS.map((spec,index)=>({...spec,source:'Illustrative demo',notice:'Illustrative demo',points:dates.map((date,i)=>{
    return {date,value:Number(((index===2?24000:500)*(1+(index===1?-.002:.0015)*i+.009*Math.sin(i*1.7+index))).toFixed(2))};
  })}));
}
