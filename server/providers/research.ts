import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import type { FundComposition, IndexData, IndexMetadata, Security } from '../../shared/types.ts';
import type { Store } from '../db.ts';
import { avNotice, avSchedule, colorFor } from './live.ts';

export type PublicIndexId = 'SP500'|'QQQ'|'NIFTY50'|'NIFTY100'|'NIFTY500';

type IndexSpec = IndexMetadata & { sourceUrl:string; proxy?:string; expected:[number,number] };

export const PUBLIC_INDICES: readonly IndexSpec[] = [
  {id:'SP500',name:'S&P 500',country:'US',proxy:'SPY',sourceUrl:'https://www.alphavantage.co/documentation/#etf-profile',expected:[1,1000]},
  {id:'QQQ',name:'Nasdaq-100',country:'US',proxy:'QQQ',sourceUrl:'https://www.alphavantage.co/documentation/#etf-profile',expected:[1,200]},
  {id:'NIFTY50',name:'Nifty 50',country:'IN',sourceUrl:'https://www.niftyindices.com/IndexConstituent/ind_nifty50list.csv',expected:[45,55]},
  {id:'NIFTY100',name:'Nifty 100',country:'IN',sourceUrl:'https://www.niftyindices.com/IndexConstituent/ind_nifty100list.csv',expected:[90,110]},
  {id:'NIFTY500',name:'Nifty 500',country:'IN',sourceUrl:'https://www.niftyindices.com/IndexConstituent/ind_nifty500list.csv',expected:[450,550]},
] as const;

const INDEX_TTL_MS=24*60*60_000;
const ETF_TTL_MS=24*60*60_000;
const cachedSecurity=z.object({id:z.string(),ticker:z.string(),name:z.string(),exchange:z.string(),currency:z.enum(['INR','USD']),country:z.enum(['US','IN','GLOBAL']),assetClass:z.enum(['US equity','Indian equity','Mutual fund','ETF','Crypto','Retirement','Cash']),sector:z.string(),color:z.string(),price:z.number().finite(),previousClose:z.number().finite(),indices:z.array(z.string()),asOf:z.string(),source:z.string()}).passthrough();
const cachedIndex=z.object({id:z.string(),name:z.string(),securities:z.array(cachedSecurity).max(1000),source:z.string(),sourceUrl:z.string().optional(),asOf:z.string(),complete:z.boolean(),notice:z.string().optional()}).strict();
const cachedComposition=z.object({status:z.enum(['available','partial','unavailable']),holdings:z.array(z.object({name:z.string(),weight:z.number().finite().min(0).max(100)}).passthrough()).max(2000),sectors:z.array(z.object({name:z.string(),weight:z.number().finite().min(0).max(100)}).strict()),countries:z.array(z.object({name:z.string(),weight:z.number().finite().min(0).max(100)}).strict()),assetAllocation:z.array(z.object({name:z.string(),weight:z.number().finite().min(0).max(100)}).strict()),asOf:z.string().nullable(),fetchedAt:z.string(),source:z.string()}).passthrough();

export function publicIndex(id:string):IndexSpec|undefined {
  return PUBLIC_INDICES.find((item)=>item.id===id.toUpperCase());
}

function numeric(value:unknown):number|undefined {
  if(value===null||value===undefined||value==='') return undefined;
  const number=Number(String(value).replace(/,/g,''));
  return Number.isFinite(number)&&number>=0?number:undefined;
}

function percentFraction(value:unknown):number|undefined {
  const number=numeric(value);
  if(number===undefined||number>1) return undefined;
  return Number((number*100).toFixed(8));
}

const etfHolding=z.object({
  symbol:z.string().trim().min(1).max(40),
  description:z.string().trim().min(1).max(300),
  weight:z.union([z.string(),z.number()]),
}).passthrough();
const etfAllocation=z.object({
  sector:z.string().trim().min(1).max(120),
  weight:z.union([z.string(),z.number()]),
}).passthrough();
const etfProfile=z.object({
  net_assets:z.union([z.string(),z.number()]).optional(),
  net_expense_ratio:z.union([z.string(),z.number()]).optional(),
  holdings:z.array(etfHolding).min(1),
  sectors:z.array(etfAllocation).optional(),
}).passthrough();

/** Alpha Vantage documents weights and expense ratio as fractions. Convert once. */
export function parseAlphaEtfProfile(payload:unknown,symbol:string,fetchedAt=new Date().toISOString()):FundComposition {
  const parsed=etfProfile.safeParse(payload);
  if(!parsed.success) throw new Error('Alpha Vantage returned an unrecognized ETF profile');
  const holdings=parsed.data.holdings.flatMap((item)=>{
    const weight=percentFraction(item.weight);
    return weight===undefined?[]:[{name:item.description,ticker:item.symbol.toUpperCase(),weight}];
  });
  if(!holdings.length) throw new Error('Alpha Vantage ETF profile contained no valid holdings');
  const sectors=(parsed.data.sectors??[]).flatMap((item)=>{
    const weight=percentFraction(item.weight); return weight===undefined?[]:[{name:item.sector,weight}];
  });
  const total=holdings.reduce((sum,item)=>sum+item.weight,0);
  const expenseRatio=percentFraction(parsed.data.net_expense_ratio);
  const aum=numeric(parsed.data.net_assets);
  return {
    status:total>=99.5&&total<=100.5?'available':'partial',holdings,sectors,countries:[],assetAllocation:[],
    asOf:null,fetchedAt,source:`Alpha Vantage ETF_PROFILE (${symbol.toUpperCase()})`,sourceUrl:'https://www.alphavantage.co/documentation/#etf-profile',
    reportedHoldingCount:parsed.data.holdings.length,...(expenseRatio===undefined?{}:{expenseRatio}),...(aum===undefined?{}:{aum}),
    ...(total<99.5?{reason:`Published holdings cover ${total.toFixed(2)}%; the remainder is unreported.`}:{}),
  };
}

function securityFromFund(item:FundComposition['holdings'][number],indexId:string):Security|null {
  if(!item.ticker) return null;
  return {id:item.securityId??`us:unknown:${item.ticker.toLowerCase()}`,ticker:item.ticker,name:item.name,exchange:'UNKNOWN',currency:'USD',country:'US',assetClass:'US equity',sector:item.sector??'Unavailable',color:colorFor(item.ticker),price:0,previousClose:0,indices:[indexId],asOf:'',source:`Alpha Vantage ${indexId==='SP500'?'SPY':'QQQ'} ETF holdings proxy`};
}

export function parseNiftyConstituents(csv:string,indexId:PublicIndexId):Security[] {
  let rows:Record<string,string>[];
  try { rows=parse(csv,{columns:true,skip_empty_lines:true,trim:true,bom:true}) as Record<string,string>[]; }
  catch { throw new Error('NSE Indices returned invalid constituent CSV'); }
  if(!rows.length||rows.length>600) throw new Error('NSE Indices returned an implausible constituent count');
  const securities=rows.flatMap((row)=>{
    const ticker=String(row.Symbol??'').trim().toUpperCase();
    const name=String(row['Company Name']??'').trim();
    const isin=String(row['ISIN Code']??'').trim();
    const sector=String(row.Industry??'').trim();
    if(!ticker||!name||!/^INE[A-Z0-9]{9}$/.test(isin)) return [];
    return [{id:`in:nse:${ticker.toLowerCase()}`,ticker,name,exchange:'NSE',currency:'INR' as const,country:'IN' as const,assetClass:'Indian equity' as const,sector:sector||'Unavailable',isin,color:colorFor(ticker),price:0,previousClose:0,indices:[indexId],asOf:'',source:'NSE Indices constituent CSV'}];
  });
  if(!securities.length||securities.length!==rows.length) throw new Error('NSE Indices constituent CSV did not match the documented schema');
  return securities;
}

async function publicGet(fetcher:typeof fetch,url:string):Promise<Response> {
  const response=await fetcher(url,{method:'GET',headers:{accept:'application/json,text/csv;q=0.9'},signal:AbortSignal.timeout(15_000)});
  if(!response.ok) throw new Error(`public provider returned HTTP ${response.status}`);
  return response;
}

export async function fetchAlphaEtfComposition(store:Store,key:string,symbol:string,fetcher:typeof fetch):Promise<FundComposition> {
  const cacheKey=`research:v2:etf:${symbol.toUpperCase()}`;
  const rawCached=store.readCache(cacheKey);
  const parsedCached=rawCached?cachedComposition.safeParse(rawCached.payload):null;
  const cached=rawCached&&parsedCached?.success?{...rawCached,payload:parsedCached.data as FundComposition}:null;
  if(cached&&!cached.expired) return cached.payload;
  const url=new URL('https://www.alphavantage.co/query');
  url.searchParams.set('function','ETF_PROFILE');url.searchParams.set('symbol',symbol);url.searchParams.set('apikey',key);
  try {
    const payload=await avSchedule(async()=>await (await publicGet(fetcher,url.toString())).json());
    const notice=avNotice(payload); if(notice) throw new Error(notice);
    const composition=parseAlphaEtfProfile(payload,symbol);
    store.writeCache(cacheKey,composition,composition.source,composition.asOf??'',ETF_TTL_MS);
    return composition;
  } catch(error) {
    if(cached) return {...cached.payload as FundComposition,source:`${cached.source} (cached)`,reason:`Cached profile retained because refresh failed: ${error instanceof Error?error.message:'provider failure'}`};
    throw error;
  }
}

export async function resolvePublicIndex(input:{store:Store;id:string;existing:Security[];observations?:Security[];alphaKey?:string;fetcher?:typeof fetch}):Promise<IndexData|null> {
  const spec=publicIndex(input.id); if(!spec) return null;
  const unavailable=(reason:string):IndexData=>({id:spec.id,name:spec.name,securities:input.existing,source:input.existing.length?'User-scoped imported securities':'Public constituent provider unavailable',sourceUrl:spec.sourceUrl,asOf:input.existing.map((item)=>item.asOf).filter(Boolean).sort().at(-1)??'',complete:false,notice:reason});
  const rawCached=input.store.readCache(`research:index:${spec.id}`);
  const parsedCached=rawCached?cachedIndex.safeParse(rawCached.payload):null;
  const cached=rawCached&&parsedCached?.success&&parsedCached.data.id===spec.id?{...rawCached,payload:parsedCached.data as IndexData}:null;
  if(cached&&!cached.expired) {
    const value=cached.payload as IndexData;
    return {...value,securities:enrichConstituents(value.securities,input.observations??input.existing)};
  }
  if(!input.fetcher) return unavailable('Public constituent lookup is unavailable in this environment.');
  try {
    let data:IndexData;
    if(spec.country==='IN') {
      const csv=await (await publicGet(input.fetcher,spec.sourceUrl)).text();
      const securities=parseNiftyConstituents(csv,spec.id as PublicIndexId);
      const complete=securities.length>=spec.expected[0]&&securities.length<=spec.expected[1];
      const retrieved=new Date().toISOString();
      const dateNotice=`The constituent file does not publish an as-of date; retrieved ${retrieved}.`;
      data={id:spec.id,name:spec.name,securities,source:'NSE Indices official constituent CSV',sourceUrl:spec.sourceUrl,asOf:'',complete,notice:complete?dateNotice:`Provider returned ${securities.length} constituents; expected ${spec.expected[0]}-${spec.expected[1]}. ${dateNotice}`};
    } else {
      if(!input.alphaKey) return unavailable('Alpha Vantage is not configured; US index proxy holdings are unavailable.');
      const composition=await fetchAlphaEtfComposition(input.store,input.alphaKey,spec.proxy!,input.fetcher);
      const securities=composition.holdings.flatMap((item)=>{const security=securityFromFund(item,spec.id);return security?[security]:[];});
      data={id:spec.id,name:spec.name,securities,source:`Alpha Vantage ${spec.proxy} ETF holdings proxy`,sourceUrl:spec.sourceUrl,asOf:composition.asOf??'',complete:false,notice:`${spec.proxy} ETF holdings are a proxy and are not an exact official or complete ${spec.name} membership list.`};
    }
    input.store.writeCache(`research:index:${spec.id}`,data,data.source,data.asOf,INDEX_TTL_MS);
    return {...data,securities:enrichConstituents(data.securities,input.observations??input.existing)};
  } catch(error) {
    if(cached) {
      const value=cached.payload as IndexData;
      return {...value,securities:enrichConstituents(value.securities,input.observations??input.existing),source:`${cached.source} (cached)`,asOf:cached.asOf,complete:false,notice:`Cached constituents retained because refresh failed: ${error instanceof Error?error.message:'provider failure'}`};
    }
    return unavailable(`Public constituent lookup unavailable: ${error instanceof Error?error.message:'provider failure'}`);
  }
}

export function mergeSecurities(...groups:Security[][]):Security[] {
  const merged=new Map<string,Security>();
  for(const group of groups) for(const item of group) merged.set(item.id,{...(merged.get(item.id)??{}),...item,indices:[...new Set([...(merged.get(item.id)?.indices??[]),...item.indices])]});
  return [...merged.values()];
}

/** Current membership comes from the constituent list; user observations only enrich matching rows. */
export function enrichConstituents(members:Security[],observations:Security[]):Security[] {
  return members.map(member=>{
    const exact=observations.find(s=>s.id===member.id);
    const candidates=member.country==='US'?observations.filter(s=>s.country==='US'&&s.ticker===member.ticker&&s.exchange!=='UNKNOWN'):[];
    const observation=exact??(candidates.length===1?candidates[0]:undefined);
    return observation?{...member,...observation,indices:member.indices}:member;
  });
}
