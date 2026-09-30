import type { Store } from '../db.ts';
import { globalSentiment, sentimentLabel, unavailableSentiment, type SentimentId, type SentimentLabel, type SentimentReading } from '../../shared/sentiment.ts';
import { DEMO_AS_OF } from './demo.ts';

type FeedId=Exclude<SentimentId,'GLOBAL'>;
const FEEDS:Record<FeedId,string>={
  US:'https://production.dataviz.cnn.io/index/fearandgreed/graphdata',
  IN:'https://www.tickertape.in/market-mood-index',
  CRYPTO:'https://api.alternative.me/fng/?limit=1',
};
const MAX_AGE=4*86400_000; // Allow weekends and exchange holidays, expose older readings as saved.
const TTL=30*60_000;
const inFlight=new WeakMap<Store,Map<FeedId,Promise<SentimentReading>>>();
const record=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const number=(value:unknown)=>typeof value==='number'||typeof value==='string'&&value.trim()!==''?Number(value):NaN;

export function parseSentiment(id:FeedId,payload:unknown,now=Date.now()):SentimentReading|null {
  let score:unknown,stamp:unknown,rating:unknown;
  if(id==='IN'){
    // Parse only public server-rendered JSON; never execute page scripts.
    if(typeof payload!=='string')return null;
    const script=payload.match(/<script\b[^>]*\bid=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i);
    if(!script)return null;
    let data:unknown;try{data=JSON.parse(script[1]);}catch{return null;}
    const row=record(record(record(record(data).props).pageProps).nowData);
    score=row.currentValue;stamp=row.date;
  }else if(id==='US'){
    const row=record(record(payload).fear_and_greed);score=row.score;stamp=row.timestamp;rating=row.rating;
  }else{
    const data=record(payload);if(record(data.metadata).error)return null;
    const row=record(Array.isArray(data.data)?data.data[0]:null);
    score=row.value;stamp=number(row.timestamp)*1000;rating=row.value_classification;
  }
  const value=number(score);
  const time=typeof stamp==='number'?stamp:typeof stamp==='string'?Date.parse(stamp):NaN;
  if(!Number.isFinite(value)||value<0||value>100||!Number.isFinite(time)||time<=0||time>now+5*60_000)return null;
  const labels:SentimentLabel[]=['Extreme fear','Fear','Neutral','Greed','Extreme greed'];
  const label=labels.find(s=>s.toLowerCase()===String(rating).toLowerCase())??sentimentLabel(value,id);
  return {...unavailableSentiment(id),score:value,label,asOf:new Date(time).toISOString(),stale:now-time>MAX_AGE,notice:undefined};
}

function age(reading:SentimentReading):SentimentReading {
  return reading.asOf&&Date.now()-Date.parse(reading.asOf)>MAX_AGE?{...reading,stale:true,notice:'Source reading is over four days old'}:reading;
}
async function loadFeed(store:Store,id:FeedId,fetcher?:typeof fetch):Promise<SentimentReading>{
  const key=`sentiment:v1:${id}`;
  const cached=store.readCache(key);
  const previous=cached?.payload as SentimentReading|undefined;
  if(previous&&!cached?.expired)return age(previous);
  if(!fetcher)return previous?.score!==null&&previous?{...previous,stale:true,notice:'Saved reading · feed unavailable'}:unavailableSentiment(id);
  let pending=inFlight.get(store);if(!pending){pending=new Map();inFlight.set(store,pending);}
  const existing=pending.get(id);if(existing)return existing;
  const operation=(async()=>{
    let result:SentimentReading;let ttl=TTL;
    try{
      const response=await fetcher(FEEDS[id],{method:'GET',headers:{Accept:id==='IN'?'text/html':'application/json'},redirect:'error',signal:AbortSignal.timeout(10_000)});
      if(!response.ok)throw Error('Feed unavailable');
      const parsed=parseSentiment(id,id==='IN'?await response.text():await response.json());
      if(!parsed)throw Error('Invalid reading');
      result=age(parsed);
    }catch{
      result=previous&&previous.score!==null?{...previous,stale:true,notice:'Saved reading · feed unavailable'}:unavailableSentiment(id);
      ttl=5*60_000;
    }
    store.writeCache(key,result,result.source,result.asOf??'',ttl);return result;
  })();
  pending.set(id,operation);
  try{return await operation;}finally{pending.delete(id);}
}
export async function loadSentiment(store:Store,fetcher?:typeof fetch):Promise<SentimentReading[]>{
  const rows=await Promise.all((['US','IN','CRYPTO'] as const).map(id=>loadFeed(store,id,fetcher)));
  return [globalSentiment(rows),...rows];
}
export function demoSentiment():SentimentReading[]{
  const rows=(['US','IN','CRYPTO'] as const).map((id,i)=>({...unavailableSentiment(id),score:[62,38,74][i],label:sentimentLabel([62,38,74][i],id),asOf:DEMO_AS_OF,stale:false,demo:true,notice:'Illustrative demo'}));
  return [{...globalSentiment(rows),demo:true,notice:'Illustrative demo'},...rows];
}
