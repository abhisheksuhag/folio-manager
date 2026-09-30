import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import cookieParser from 'cookie-parser';
import express, { type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import { z } from 'zod';
import type { AnalysisMessage, Broker, FundComposition, ScreenerData, Security, StockData, User, Workspace } from '../shared/types.ts';
import { loadConfig, type AppOptions } from './config.ts';
import { Store } from './db.ts';
import { importCsv, templates, type ImportKind } from './imports.ts';
import { hashPassword, openToken, randomToken, sealToken, verifyPassword } from './security.ts';
import { DEMO_AS_OF, DEMO_SOURCE, demoConstituents, demoIndices, demoSecurities, demoStock, demoWorkspace } from './providers/demo.ts';
import { alphaFxRate, alphaSearch, alphaStock, exchangeUpstoxCode, fetchUpstoxHoldings } from './providers/live.ts';
import { beginIndmoneyAuth, completeIndmoneyAuth, fetchIndianStock, fetchIndmoneyFundComposition, fetchIndmoneyHoldings, type IndmoneyAuthOptions } from './providers/indmoney.ts';
import { fetchBinanceHoldings, verifyBinanceCredentials, type BinanceCredentials } from './providers/binance.ts';
import { fetchAlphaEtfComposition, mergeSecurities, PUBLIC_INDICES, resolvePublicIndex } from './providers/research.ts';
import { demoMarketTrends, loadMarketTrend } from './providers/market-trends.ts';
import { MARKET_TRENDS } from '../shared/market-trends.ts';
import { demoSentiment, loadSentiment } from './providers/sentiment.ts';

const COOKIE='folio_session';
const unsafeMethods=new Set(['POST','PUT','PATCH','DELETE']);
type RequestState={token?:string;csrfToken?:string;user:User|null};
type StatefulRequest=Request&{folio?:RequestState};
const locks=new Map<string,Promise<void>>();

async function locked<T>(key:string,operation:()=>Promise<T>):Promise<T> {
  const previous=locks.get(key)??Promise.resolve(); let release!:()=>void;
  const current=new Promise<void>((resolve)=>{release=resolve;}); const queued=previous.then(()=>current); locks.set(key,queued);
  await previous; try{return await operation();} finally{release(); if(locks.get(key)===queued) locks.delete(key);}
}

function asyncRoute(handler:(request:StatefulRequest,response:Response,next:NextFunction)=>Promise<void>) {
  return (request:StatefulRequest,response:Response,next:NextFunction)=>void handler(request,response,next).catch(next);
}

function parseBody<T>(schema:z.ZodType<T>,request:Request):T {
  const result=schema.safeParse(request.body);
  if(!result.success) throw new HttpError(400,result.error.issues.map((issue)=>`${issue.path.join('.')||'body'}: ${issue.message}`).join('; '));
  return result.data;
}

class HttpError extends Error { constructor(readonly status:number,message:string){super(message);} }

function setSessionCookie(response:Response,token:string,production:boolean):void {
  response.cookie(COOKIE,token,{httpOnly:true,sameSite:'lax',secure:production,path:'/',maxAge:30*24*60*60*1000});
}

function requireUser(request:StatefulRequest):User {
  if(!request.folio?.user) throw new HttpError(401,'Authentication required');
  return request.folio.user;
}

function connectionBroker(value:string):'Upstox'|'INDmoney'|'Binance' {
  if(value==='upstox') return 'Upstox'; if(value==='indmoney') return 'INDmoney'; if(value==='binance') return 'Binance';
  throw new HttpError(404,'Broker not supported');
}

const LOGO_TTL=30*24*60*60_000;
const LOGO_MISS_TTL=7*24*60*60_000;

/**
 * Security ids are `country:exchange:ticker`. The logo provider keys US names on
 * the bare ticker and Indian ones on `TICKER.NS`. Ids whose ticker is an internal
 * code (INDmoney's `INDS01052`, a fund's `3598`) or a name resolve to nothing, so
 * those fall back to initials rather than triggering a pointless lookup.
 */
export function logoSymbol(id:string):string|null {
  const parts=id.split(':');
  if(parts.length<3) return null;
  const country=parts[0]!.toLowerCase();
  const ticker=parts.slice(2).join(':').toUpperCase().trim();
  if(!/^[A-Z][A-Z0-9.\-]{0,19}$/.test(ticker)) return null;
  if(/^INDS?\d+$/.test(ticker)) return null;
  if(country==='in') return `${ticker}.NS`;
  if(country==='us') return ticker;
  return null;
}

/** Binance credentials live sealed in the connection row's token column. */
function binanceCredentials(store:Store,config:ReturnType<typeof loadConfig>,userId:string):BinanceCredentials|null {
  if(!config.tokenEncryptionKey) return null;
  const row=store.connection(userId,'Binance');
  if(!row?.encrypted_token) return null;
  try {
    const parsed=JSON.parse(openToken(String(row.encrypted_token),config.tokenEncryptionKey)) as Partial<BinanceCredentials>;
    return parsed.apiKey&&parsed.apiSecret?{apiKey:parsed.apiKey,apiSecret:parsed.apiSecret}:null;
  } catch { return null; }
}

function indmoneyOptions(config:ReturnType<typeof loadConfig>,store:Store,userId:string):IndmoneyAuthOptions|null {
  if(!config.indmoneyMcpUrl||!config.indmoneyRedirectUri||!config.tokenEncryptionKey) return null;
  return {store,connectionId:`${userId}:indmoney`,redirectUri:config.indmoneyRedirectUri,encryptionKey:config.tokenEncryptionKey,serverUrl:config.indmoneyMcpUrl};
}

function capabilities(config:ReturnType<typeof loadConfig>) {
  return {upstox:Boolean(config.upstoxClientId&&config.upstoxClientSecret&&config.upstoxRedirectUri&&config.tokenEncryptionKey),indmoney:Boolean(config.indmoneyMcpUrl&&config.indmoneyRedirectUri&&config.tokenEncryptionKey),binance:Boolean(config.tokenEncryptionKey),marketData:Boolean(config.alphaVantageKey),ai:Boolean(config.aiApiUrl&&config.aiApiKey&&config.aiModel)};
}

const FX_CACHE_KEY='fx:USDINR';
/** Six hours keeps a day's traffic to four calls, well inside the free 25/day tier. */
const FX_TTL_MS=6*60*60*1000;
/** One refresh in flight per store, so a burst of requests can't stampede the provider. */
const fxRefreshes=new WeakMap<Store,Promise<void>>();

function refreshFx(store:Store,key:string):Promise<void> {
  const existing=fxRefreshes.get(store); if(existing) return existing;
  const pending=(async()=>{
    try { const {rate,asOf}=await alphaFxRate(key); store.writeCache(FX_CACHE_KEY,{rate},'Alpha Vantage USD/INR',asOf,FX_TTL_MS); }
    catch { /* Leave the cache as it is; resolveFx falls back to it or to USDINR. */ }
    finally { fxRefreshes.delete(store); }
  })();
  fxRefreshes.set(store,pending); return pending;
}

/**
 * Resolution order: a cached rate, then a live fetch, then the configured USDINR,
 * then explicit unavailability. Nothing here invents a rate.
 *
 * An expired cache is served immediately and refreshed out of band - a workspace
 * load should never wait on Alpha Vantage. Only a cold start with nothing cached
 * blocks, because the alternative is telling the user FX is unavailable when it
 * is merely not fetched yet.
 */
export async function resolveFx(store:Store,config:ReturnType<typeof loadConfig>):Promise<Workspace['fx']> {
  const manual=config.usdInr?{USDINR:config.usdInr,asOf:new Date().toISOString().slice(0,10),source:'Configured USDINR'}:null;
  if(!config.alphaVantageKey) return manual??{USDINR:0,asOf:'',source:'Unavailable: configure USDINR or an official FX provider'};
  const read=()=>{
    const entry=store.readCache(FX_CACHE_KEY);
    const rate=typeof (entry?.payload as {rate?:unknown})?.rate==='number'?(entry!.payload as {rate:number}).rate:0;
    return rate>0&&entry?{rate,asOf:entry.asOf,source:entry.source,expired:entry.expired}:null;
  };
  const cached=read();
  if(cached){
    if(cached.expired) void refreshFx(store,config.alphaVantageKey);
    return {USDINR:cached.rate,asOf:cached.asOf,source:cached.expired?`${cached.source} (cached)`:cached.source};
  }
  await refreshFx(store,config.alphaVantageKey);
  const seeded=read();
  if(seeded) return {USDINR:seeded.rate,asOf:seeded.asOf,source:seeded.source};
  return manual??{USDINR:0,asOf:'',source:'Unavailable: Alpha Vantage FX lookup failed and no USDINR is configured'};
}

async function liveWorkspace(store:Store,user:User,config:ReturnType<typeof loadConfig>):Promise<Workspace> {
  const fx=await resolveFx(store,config);
  const watched=new Set(store.watchlists(user.id).flatMap(list=>list.securityIds));
  const securities=mergeSecurities(store.researchSecurities(user.id).filter(s=>watched.has(s.id)),store.securities(user.id));
  const dates=[...securities.map((item)=>item.asOf),...store.history(user.id).map((item)=>item.date)].filter(Boolean).sort();
  return {user,holdings:store.holdings(user.id),transactions:store.transactions(user.id),history:store.history(user.id),securities,watchlists:store.watchlists(user.id),connections:store.connections(user.id),fx,capabilities:capabilities(config),asOf:dates.at(-1)??'',mode:'live'};
}

function normalizeId(value:string):string {
  if(value.length>180||!/^(?:in|us|global):[a-z0-9._-]+:[a-z0-9._-]+$/i.test(value)) throw new HttpError(400,'Unsupported security id');
  return value.toLowerCase();
}

function importedBase(id:string,existing:Security|null):Security {
  if(existing) return existing;
  const [country,exchange,ticker]=id.split(':');
  return {id,ticker:ticker.toUpperCase(),name:ticker.toUpperCase(),exchange:exchange.toUpperCase(),currency:country==='in'?'INR':'USD',country:country==='in'?'IN':'US',assetClass:country==='in'?'Indian equity':'US equity',sector:'Unavailable',color:'#64748b',price:0,previousClose:0,indices:[],asOf:'',source:'Alpha Vantage lookup'};
}

function unavailableComposition(source:string,reason:string):FundComposition {
  return {status:'unavailable',holdings:[],sectors:[],countries:[],assetAllocation:[],asOf:null,fetchedAt:new Date().toISOString(),source,reason};
}

function calculatedAnswer(question:string,workspace:Workspace,stock?:StockData):{content:string;sources:string[]} {
  const lower=question.toLowerCase(); const fx=workspace.fx.USDINR;
  if(workspace.holdings.some((holding)=>holding.security.currency==='USD')&&!(fx>0)) return {content:'I cannot calculate a mixed-currency portfolio total because USD/INR is unavailable. Configure a current FX observation first.',sources:[workspace.fx.source]};
  const values=workspace.holdings.map((holding)=>({holding,value:holding.quantity*holding.security.price*(holding.security.currency==='USD'?fx:1),day:holding.quantity*(holding.security.price-holding.security.previousClose)*(holding.security.currency==='USD'?fx:1)}));
  const total=values.reduce((sum,item)=>sum+item.value,0); const format=(value:number)=>new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR',maximumFractionDigits:0}).format(value);
  if(!values.length) return {content:'There are no holdings to analyse yet. Import a holdings CSV or connect a supported read-only provider first.',sources:['Current portfolio workspace']};
  if(/concentrat|allocation|sector|diversif/.test(lower)) {
    const groups=new Map<string,number>(); for(const item of values) groups.set(item.holding.security.sector,(groups.get(item.holding.security.sector)??0)+item.value);
    const ranked=[...groups].sort((a,b)=>b[1]-a[1]); const top=ranked[0];
    return {content:`${top[0]} is the largest sector at ${total?((top[1]/total)*100).toFixed(1):'0.0'}% (${format(top[1])}) of the ${format(total)} portfolio. The next largest allocations are ${ranked.slice(1,4).map(([name,value])=>`${name} ${((value/total)*100).toFixed(1)}%`).join(', ')||'not available'}.`,sources:['Current holdings and configured FX']};
  }
  if(/movement|today|daily|contributor|moved/.test(lower)) {
    const ranked=[...values].sort((a,b)=>Math.abs(b.day)-Math.abs(a.day)); const totalDay=values.reduce((sum,item)=>sum+item.day,0);
    return {content:`The estimated one-day move is ${format(totalDay)} from current versus previous close. The largest contributors are ${ranked.slice(0,4).map((item)=>`${item.holding.security.ticker} ${format(item.day)}`).join(', ')}.`,sources:['Current and previous closes','Configured FX']};
  }
  if(/best|worst|gain|perform/.test(lower)) {
    const ranked=values.map(({holding})=>({holding,returnPct:holding.averagePrice?((holding.security.price/holding.averagePrice)-1)*100:0})).sort((a,b)=>b.returnPct-a.returnPct);
    return {content:`By simple price return on current holdings, ${ranked[0].holding.security.ticker} is highest at ${ranked[0].returnPct.toFixed(1)}%, while ${ranked.at(-1)!.holding.security.ticker} is lowest at ${ranked.at(-1)!.returnPct.toFixed(1)}%. This excludes timing, cash flows, fees and taxes.`,sources:['Current holdings cost basis and quotes']};
  }
  if(/valuation|p\/e| pe |earnings|fundamental/.test(` ${lower} `)) {
    const target=stock?.security??values.find((item)=>lower.includes(item.holding.security.ticker.toLowerCase()))?.holding.security;
    if(!target) return {content:'Specify a security to discuss valuation. I can use imported or provider-supplied P/E, EPS and fundamental periods when available.',sources:['Current workspace schema']};
    const fields=[target.pe?`P/E ${target.pe.toFixed(1)}`:null,target.eps?`EPS ${target.eps}`:null,target.dividendYield!=null?`dividend yield ${target.dividendYield}%`:null].filter(Boolean);
    return {content:fields.length?`${target.ticker} has ${fields.join(', ')} as of ${target.asOf}. These figures describe the supplied data and are not a forecast.`:`Valuation fields for ${target.ticker} are unavailable from the current source (${target.source}). Configure market data or import supported fundamentals before drawing a valuation conclusion.`,sources:[target.source]};
  }
  return {content:'I can calculate allocation and concentration, daily movement contributors, simple best/worst holding returns, and supplied stock valuation fields. News, historic valuation multiples and forecasts are not available in the current structured data.',sources:['Current workspace schema']};
}

/**
 * OpenAI-compatible providers publish a base URL ("https://api.deepseek.com")
 * while the request belongs at /chat/completions. Posting to the bare host is a
 * 404, so accept either form rather than making the operator guess.
 */
export function chatCompletionsUrl(value:string):URL {
  const url=new URL(value);
  if(url.protocol!=='https:') throw new HttpError(503,'AI_API_URL must use HTTPS');
  if(!/\/(chat\/)?completions\/?$/.test(url.pathname)) {
    url.pathname=`${url.pathname.replace(/\/+$/,'')}/chat/completions`;
  }
  return url;
}

const AI_MAX_TOKENS=2000;

async function aiRequest(config:ReturnType<typeof loadConfig>,url:URL,messages:unknown[],effort?:string):Promise<{content:string;finishReason:string}> {
  const body:Record<string,unknown>={model:config.aiModel,max_tokens:AI_MAX_TOKENS,messages};
  if(effort) body.reasoning_effort=effort;
  const response=await fetch(url,{method:'POST',headers:{authorization:`Bearer ${config.aiApiKey}`,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(90_000)});
  if(!response.ok) {
    const detail=await response.text().catch(()=>'');
    throw new HttpError(502,`AI provider returned HTTP ${response.status} for ${url.origin}${url.pathname}${detail?`: ${detail.replace(/\s+/g,' ').slice(0,200)}`:''}`);
  }
  const payload=await response.json() as Record<string,unknown>; const choices=payload.choices;
  const choice=Array.isArray(choices)&&choices[0]&&typeof choices[0]==='object'?choices[0] as {message?:{content?:unknown};finish_reason?:unknown}:null;
  return {content:typeof choice?.message?.content==='string'?choice.message.content.trim():'',finishReason:String(choice?.finish_reason??'')};
}

async function aiAnswer(config:ReturnType<typeof loadConfig>,question:string,workspace:Workspace,stock?:StockData):Promise<string> {
  const url=chatCompletionsUrl(config.aiApiUrl!);
  const context={asOf:workspace.asOf,mode:workspace.mode,fx:workspace.fx,holdings:workspace.holdings.slice(0,40).map((item)=>({ticker:item.security.ticker,quantity:item.quantity,averagePrice:item.averagePrice,price:item.security.price,previousClose:item.security.previousClose,currency:item.security.currency,sector:item.security.sector,source:item.security.source,asOf:item.security.asOf})),stock:stock?{security:stock.security,fundamentals:stock.fundamentals}:undefined};
  const messages=[{role:'system',content:'Use only the supplied structured facts. Clearly distinguish facts from interpretation, state missing inputs, cite source/as-of labels, and never guarantee investment outcomes or invent news.'},{role:'user',content:JSON.stringify({question,context})}];

  const first=await aiRequest(config,url,messages,config.aiReasoningEffort);
  if(first.content) return first.content;
  // A reasoning model can spend the whole allowance thinking and return nothing.
  // Retry once with reasoning off rather than reporting a dead end; operators who
  // set AI_REASONING_EFFORT explicitly have already made that call.
  if(first.finishReason==='length'&&!config.aiReasoningEffort) {
    const retry=await aiRequest(config,url,messages,'none');
    if(retry.content) return retry.content;
  }
  if(first.finishReason==='length') throw new HttpError(502,'The AI provider used its whole output budget without answering. Set AI_REASONING_EFFORT=none, or choose a model that does not reason before replying.');
  throw new HttpError(502,'AI provider returned an unrecognized response; retry or disable AI configuration');
}

export function createApp(options:AppOptions={}) {
  const config=loadConfig(options); const store=new Store(config.databasePath); const app=express(); const production=config.environment==='production';
  app.disable('x-powered-by'); app.set('trust proxy',production?1:false);
  app.use(helmet({contentSecurityPolicy:production?undefined:false})); app.use(express.json({limit:'6mb'})); app.use(cookieParser());
  app.use('/api/auth',rateLimit({windowMs:15*60_000,limit:30,standardHeaders:'draft-8',legacyHeaders:false,skip:()=>config.environment==='test'}));
  app.use('/api',rateLimit({windowMs:60_000,limit:300,standardHeaders:'draft-8',legacyHeaders:false,skip:()=>config.environment==='test'}));
  app.use((request:StatefulRequest,_response,next)=>{const token=request.cookies?.[COOKIE] as string|undefined; const session=store.getSession(token); request.folio={token,user:session?.userId?store.getUser(session.userId):null,csrfToken:session?.csrfToken}; next();});
  app.use('/api',(request:StatefulRequest,_response,next)=>{
    if(!unsafeMethods.has(request.method)) return next();
    if(config.appOrigin&&request.headers.origin&&request.headers.origin!==config.appOrigin) return next(new HttpError(403,'Origin not allowed'));
    if(!request.folio?.csrfToken||request.get('x-csrf-token')!==request.folio.csrfToken) return next(new HttpError(403,'Invalid CSRF token'));
    next();
  });

  app.get('/api/session',(request:StatefulRequest,response)=>{
    if(!request.folio?.csrfToken){const session=store.createSession();request.folio={token:session.token,csrfToken:session.csrfToken,user:null};setSessionCookie(response,session.token,production);}
    response.json({user:request.folio.user,csrfToken:request.folio.csrfToken});
  });
  app.post('/api/auth/demo',(request:StatefulRequest,response)=>{
    if(request.folio?.user?.demo) return void response.json({user:request.folio.user});
    const user=store.createUser({name:'Alex Morgan',email:`demo-${randomToken(12)}@folio.local`,demo:true}); store.seedDemoWatchlist(user.id);
    const session=store.replaceSession(request.folio?.token,user.id); setSessionCookie(response,session.token,production); store.audit(user.id,'auth.demo'); response.json({user});
  });
  app.post('/api/auth/register',(request:StatefulRequest,response,next)=>{
    const input=parseBody(z.object({name:z.string().trim().min(1).max(80),email:z.string().trim().email().max(254),password:z.string().min(12).max(256)}).strict(),request);
    try {const user=store.createUser({name:input.name,email:input.email,passwordHash:hashPassword(input.password)});const session=store.replaceSession(request.folio?.token,user.id);setSessionCookie(response,session.token,production);store.audit(user.id,'auth.register');response.json({user});}
    catch(error){if(error instanceof Error&&/UNIQUE constraint failed/i.test(error.message)) return next(new HttpError(409,'An account with that email already exists'));next(error);}
  });
  app.post('/api/auth/login',(request:StatefulRequest,response)=>{
    const input=parseBody(z.object({email:z.string().trim().email(),password:z.string().min(1).max(256)}).strict(),request);const auth=store.getUserAuth(input.email);
    if(!auth?.passwordHash||!verifyPassword(input.password,auth.passwordHash)){store.audit(auth?.user.id??null,'auth.login',undefined,undefined,'denied');throw new HttpError(401,'Invalid email or password');}
    const session=store.replaceSession(request.folio?.token,auth.user.id);setSessionCookie(response,session.token,production);store.audit(auth.user.id,'auth.login');response.json({user:auth.user});
  });
  app.post('/api/auth/logout',(request:StatefulRequest,response)=>{store.audit(request.folio?.user?.id??null,'auth.logout');store.deleteSession(request.folio?.token);response.clearCookie(COOKIE,{path:'/'});response.json({ok:true});});

  app.get('/api/workspace',asyncRoute(async(request,response)=>{const user=requireUser(request);response.json(user.demo?demoWorkspace(user,store.watchlists(user.id)):await liveWorkspace(store,user,config));}));
  app.get('/api/sentiment',asyncRoute(async(request,response)=>{
    const user=requireUser(request);
    response.json(user.demo?demoSentiment():await loadSentiment(store,config.researchFetch));
  }));
  app.get('/api/market-trends',asyncRoute(async(request,response)=>{
    const user=requireUser(request);
    if(user.demo){response.json(demoMarketTrends());return;}
    let upstoxToken:string|undefined;
    const connection=store.connection(user.id,'Upstox');
    if(config.tokenEncryptionKey&&connection?.status==='connected'&&connection.encrypted_token&&(!connection.token_expires_at||String(connection.token_expires_at)>new Date().toISOString())){
      try{upstoxToken=openToken(String(connection.encrypted_token),config.tokenEncryptionKey);}catch{/* Keep the market ribbon usable if the connection needs renewal. */}
    }
    response.json(await Promise.all(MARKET_TRENDS.map(({id})=>loadMarketTrend({store,id,userId:user.id,fetcher:config.researchFetch,alphaKey:config.alphaVantageKey,upstoxToken}))));
  }));
  app.patch('/api/preferences',(request:StatefulRequest,response)=>{const user=requireUser(request);const input=parseBody(z.object({currency:z.enum(['INR','USD']),name:z.string().trim().min(1).max(80).optional()}).strict(),request);const updated=store.updateUser(user.id,input);store.audit(user.id,'preferences.update','user',user.id);response.json({user:updated});});

  app.get('/api/search',asyncRoute(async(request,response)=>{const user=requireUser(request);const query=z.string().trim().max(80).parse(request.query.q??'');if(!query){response.json({securities:[],indices:[]});return;}
    if(user.demo){const lower=query.toLowerCase();response.json({securities:demoSecurities.filter((item)=>`${item.ticker} ${item.name}`.toLowerCase().includes(lower)).slice(0,20),indices:demoIndices.filter((item)=>`${item.id} ${item.name}`.toLowerCase().includes(lower))});return;}
    const local=mergeSecurities(store.securities(user.id),store.researchSecurities(user.id)).filter((item)=>`${item.ticker} ${item.name}`.toLowerCase().includes(query.toLowerCase()));let remote:Security[]=[];if(config.alphaVantageKey){try{remote=await alphaSearch(store,query,config.alphaVantageKey);for(const item of remote)store.upsertResearchSecurity(user.id,item);}catch{if(!local.length)throw new HttpError(502,'Symbol search is temporarily unavailable. Please try again later.');}}const merged=new Map([...remote,...local].map((item)=>[item.id,item]));
    const indexMap=new Map<string,string>();for(const item of local)for(const id of item.indices)if(id.toLowerCase().includes(query.toLowerCase()))indexMap.set(id,id);response.json({securities:[...merged.values()].slice(0,20),indices:[...indexMap].map(([id,name])=>({id,name}))});
  }));
  app.get('/api/explore',asyncRoute(async(request,response)=>{const user=requireUser(request);const parsed=z.object({q:z.string().trim().max(80).default(''),universe:z.enum(['ALL','SP500','QQQ','NIFTY50','NIFTY100','NIFTY500']).default('ALL'),market:z.enum(['ALL','IN','US']).default('ALL')}).safeParse(request.query);if(!parsed.success)throw new HttpError(400,parsed.error.issues.map((issue)=>`${issue.path.join('.')}: ${issue.message}`).join('; '));
    const {q,universe,market}=parsed.data;const matches=(item:Security)=>((market==='ALL'||item.country===market)&&(universe==='ALL'||item.indices.includes(universe))&&(!q||`${item.ticker} ${item.name} ${item.isin??''}`.toLowerCase().includes(q.toLowerCase())));
    if(user.demo){response.json({securities:demoSecurities.filter(matches),indices:demoIndices,source:`${DEMO_SOURCE}; sample coverage`,asOf:DEMO_AS_OF,complete:false,notices:['Demo Explore contains illustrative sample securities, not complete market or index coverage.']} satisfies ScreenerData);return;}
    const local=mergeSecurities(store.securities(user.id),store.researchSecurities(user.id));
    const requested=universe==='ALL'?(market==='IN'?['NIFTY500']:market==='US'?['SP500','QQQ']:['NIFTY500','SP500','QQQ']):[universe];
    const indexResults=await Promise.all(requested.map((id)=>resolvePublicIndex({store,id,existing:local.filter((item)=>item.indices.includes(id)),observations:local,alphaKey:config.alphaVantageKey,fetcher:config.researchFetch})));
    const publicSecurities=indexResults.flatMap((item)=>item?.securities??[]);for(const item of publicSecurities)store.upsertResearchSecurity(user.id,item);
    let remote:Security[]=[];let searchNotice='';
    if(q.length>=2&&universe==='ALL'&&config.alphaVantageKey){try{remote=await alphaSearch(store,q,config.alphaVantageKey);for(const item of remote)store.upsertResearchSecurity(user.id,item);}catch{searchNotice='Symbol search is temporarily unavailable; available matches are retained.';}}
    const all=(universe==='ALL'?mergeSecurities(remote,publicSecurities,local):publicSecurities).filter(matches);
    const notices=[...indexResults.flatMap((item)=>item?.notice?[item.notice]:[]),...(searchNotice?[searchNotice]:[])];const sources=[...new Set(indexResults.flatMap((item)=>item?[item.source]:[]))];const dates=all.map((item)=>item.asOf).filter(Boolean).sort();
    response.json({securities:all,indices:PUBLIC_INDICES.map(({id,name,country})=>({id,name,country})),source:sources.join('; ')||'User-scoped securities',asOf:dates.at(-1)??'',complete:indexResults.length>0&&indexResults.every((item)=>item?.complete),notices} satisfies ScreenerData);
  }));
  app.get('/api/stocks/:id',asyncRoute(async(request,response)=>{const user=requireUser(request);const id=normalizeId(String(request.params.id));if(user.demo){const stock=demoStock(id);if(!stock)throw new HttpError(404,'Security not found');response.json(stock);return;}
    const existing=store.userHasSecurity(user.id,id)?store.securityForUser(user.id,id):store.researchSecurity(user.id,id);if(!existing&&(!config.alphaVantageKey||id.startsWith('global:')))throw new HttpError(404,'Security not found');const base=importedBase(id,existing);
    if(base.assetClass==='Mutual fund'||base.assetClass==='ETF'){
      let composition:FundComposition;
      if(base.assetClass==='ETF'&&base.country==='US'&&config.alphaVantageKey&&config.researchFetch){try{composition=await fetchAlphaEtfComposition(store,config.alphaVantageKey,base.ticker,config.researchFetch);}catch(error){composition=unavailableComposition('Alpha Vantage ETF_PROFILE',error instanceof Error?error.message:'ETF profile unavailable');}}
      else if(base.assetClass==='Mutual fund'){
        const options=indmoneyOptions(config,store,user.id);const connection=options?store.connection(user.id,'INDmoney'):null;
        if(options&&connection?.encrypted_token){try{composition=await fetchIndmoneyFundComposition(options,base);}catch(error){composition=unavailableComposition('INDmoney MCP get_mf_funds_details',error instanceof Error?error.message:'Fund composition unavailable');}}
        else composition=unavailableComposition('INDmoney MCP','Connect INDmoney read-only access to load this fund composition.');
      } else composition=unavailableComposition('Fund composition provider',base.country==='IN'?'Composition for this exact Indian ETF is not available from the configured provider.':'Configure Alpha Vantage to load this ETF composition.');
      let security=base;let history:StockData['history']=[];const notices=composition.status==='unavailable'?[composition.reason??'Composition unavailable']:[];
      if(base.assetClass==='ETF'&&base.country==='US'&&config.alphaVantageKey){try{const quoted=await alphaStock(store,base,config.alphaVantageKey,false);security=quoted.security;history=quoted.history;store.upsertResearchSecurity(user.id,security);}catch{notices.push('ETF quote or history is unavailable; the last recorded valuation is retained.');}}
      response.json({security,history,fundamentals:{periods:[],currency:base.currency,source:'Not applicable to fund composition',asOf:base.asOf},peers:[],composition,notices} satisfies StockData);return;
    }
    // Indian listings come from INDmoney when it is connected: NSE rather than BSE,
    // richer stats, and none of the 25-call daily Alpha Vantage budget.
    if(base.country==='IN'&&base.assetClass==='Indian equity'){
      const indOptions=indmoneyOptions(config,store,user.id);
      const connection=indOptions?store.connection(user.id,'INDmoney'):null;
      if(indOptions&&connection?.encrypted_token){
        try {
          const stock=await fetchIndianStock(indOptions,base);
          if(stock){store.upsertResearchSecurity(user.id,stock.security);response.json({...stock,peers:store.securities(user.id).filter((item)=>item.id!==id&&item.sector===stock.security.sector).slice(0,4)});return;}
        } catch(error){ console.warn('INDmoney stock lookup failed, falling back:',error instanceof Error?error.message:error); }
      }
    }
    if(config.alphaVantageKey&&base.country==='US'&&base.assetClass==='US equity'){let stock;try{stock=await alphaStock(store,base,config.alphaVantageKey);}catch{response.json({security:base,history:[],fundamentals:{periods:[],currency:base.currency,source:'Provider unavailable',asOf:''},peers:[],notices:['Market data is temporarily unavailable. The last recorded valuation is retained when available.']} satisfies StockData);return;}store.upsertResearchSecurity(user.id,stock.security);response.json({...stock,peers:store.securities(user.id).filter((item)=>item.id!==id&&item.sector===stock.security.sector).slice(0,4)});return;}
    response.json({security:base,history:[],fundamentals:{periods:[],currency:base.currency,source:base.country==='IN'?'Annual statements unavailable for this exact Indian listing':'Annual statements unavailable',asOf:''},peers:[],notices:[base.country==='IN'?'The last recorded valuation is shown. Research enrichment for this exact Indian listing is unavailable.':'Only recorded position data is available for this investment.']} satisfies StockData);
  }));
  app.get('/api/indices/:id',asyncRoute(async(request:StatefulRequest,response)=>{const user=requireUser(request);const id=String(request.params.id).toUpperCase();if(!/^[A-Z0-9._-]{1,40}$/.test(id))throw new HttpError(400,'Unsupported index id');
    if(user.demo){const securities=demoConstituents(id);const meta=demoIndices.find((item)=>item.id===id);if(!securities||!meta)throw new HttpError(404,'Index not found');response.json({id,name:meta.name,securities,source:`${DEMO_SOURCE}; sample constituents only`,asOf:DEMO_AS_OF,complete:false});return;}
    const existing=mergeSecurities(store.securities(user.id),store.researchSecurities(user.id)).filter((item)=>item.indices.includes(id));const data=await resolvePublicIndex({store,id,existing,observations:mergeSecurities(store.securities(user.id),store.researchSecurities(user.id)),alphaKey:config.alphaVantageKey,fetcher:config.researchFetch});if(!data)throw new HttpError(404,'Index not found');for(const item of data.securities)store.upsertResearchSecurity(user.id,item);response.json(data);
  }));

  app.post('/api/watchlists',(request:StatefulRequest,response)=>{const user=requireUser(request);const {name}=parseBody(z.object({name:z.string().trim().min(1).max(80)}).strict(),request);const watchlist=store.createWatchlist(user.id,name);store.audit(user.id,'watchlist.create','watchlist',watchlist.id);response.json({watchlist});});
  app.patch('/api/watchlists/:id',(request:StatefulRequest,response)=>{const user=requireUser(request);const {name}=parseBody(z.object({name:z.string().trim().min(1).max(80)}).strict(),request);const watchlist=store.renameWatchlist(user.id,String(request.params.id),name);if(!watchlist)throw new HttpError(404,'Watchlist not found');store.audit(user.id,'watchlist.update','watchlist',watchlist.id);response.json({watchlist});});
  app.delete('/api/watchlists/:id',(request:StatefulRequest,response)=>{const user=requireUser(request);const id=String(request.params.id);if(!store.deleteWatchlist(user.id,id))throw new HttpError(404,'Watchlist not found');store.audit(user.id,'watchlist.delete','watchlist',id);response.json({ok:true});});
  app.post('/api/watchlists/:id/items',(request:StatefulRequest,response)=>{const user=requireUser(request);const {securityId}=parseBody(z.object({securityId:z.string().min(1).max(180)}).strict(),request);const normalized=normalizeId(securityId);const exists=user.demo?demoSecurities.some((item)=>item.id===normalized):store.userHasSecurity(user.id,normalized)||Boolean(store.researchSecurity(user.id,normalized));if(!exists)throw new HttpError(400,'Security does not exist in this workspace');const watchlist=store.addWatchlistItem(user.id,String(request.params.id),normalized);if(!watchlist)throw new HttpError(404,'Watchlist not found');response.json({watchlist});});
  app.delete('/api/watchlists/:id/items/:securityId',(request:StatefulRequest,response)=>{const user=requireUser(request);const watchlist=store.removeWatchlistItem(user.id,String(request.params.id),normalizeId(String(request.params.securityId)));if(!watchlist)throw new HttpError(404,'Watchlist not found');response.json({watchlist});});

  app.post('/api/import',asyncRoute(async(request,response)=>{const user=requireUser(request);if(user.demo)throw new HttpError(400,'Demo portfolios are illustrative. Create a real account to import your data.');const input=parseBody(z.object({csv:z.string().min(1),broker:z.enum(['INDmoney','Upstox','Manual']),kind:z.enum(['holdings','transactions','history','constituents'])}).strict(),request);let imported:number;try{imported=await locked(`${user.id}:portfolio`,async()=>importCsv(store,user.id,input));}catch(error){throw new HttpError(400,error instanceof Error?error.message:'Invalid CSV');}store.audit(user.id,'import.complete',input.kind,undefined,`imported:${imported}`);response.json({imported});}));
  app.get('/api/import/template',(request,response)=>{const result=z.enum(['holdings','transactions','history','constituents']).safeParse(request.query.kind);if(!result.success)throw new HttpError(400,'Unknown import template kind');response.type('text/csv').attachment(`${result.data}-template.csv`).send(templates[result.data as ImportKind]);});

  app.post('/api/connections/upstox/connect',(request:StatefulRequest,response)=>{const user=requireUser(request);if(user.demo)throw new HttpError(400,'Create a real account before connecting a live broker.');if(!config.upstoxClientId||!config.upstoxClientSecret||!config.upstoxRedirectUri||!config.tokenEncryptionKey)throw new HttpError(503,'Upstox OAuth is not configured. Set UPSTOX_CLIENT_ID, UPSTOX_CLIENT_SECRET, UPSTOX_REDIRECT_URI and TOKEN_ENCRYPTION_KEY.');const state=randomToken();store.saveOAuthState(user.id,state,'Upstox');const url=new URL('https://api.upstox.com/v2/login/authorization/dialog');url.searchParams.set('response_type','code');url.searchParams.set('client_id',config.upstoxClientId);url.searchParams.set('redirect_uri',config.upstoxRedirectUri);url.searchParams.set('state',state);response.json({url:url.toString()});});
  app.get('/api/connections/upstox/callback',asyncRoute(async(request,response)=>{const code=typeof request.query.code==='string'?request.query.code:'';const state=typeof request.query.state==='string'?request.query.state:'';if(!code||!state)return void response.redirect('/app/settings?error=upstox_missing_callback');const connection=store.consumeOAuthState(state,'Upstox');if(!connection)return void response.redirect('/app/settings?error=upstox_invalid_state');if(!config.upstoxClientId||!config.upstoxClientSecret||!config.upstoxRedirectUri||!config.tokenEncryptionKey)return void response.redirect('/app/settings?error=upstox_not_configured');try{const token=await exchangeUpstoxCode({code,clientId:config.upstoxClientId,clientSecret:config.upstoxClientSecret,redirectUri:config.upstoxRedirectUri});store.saveBrokerToken(connection.id,sealToken(token.accessToken,config.tokenEncryptionKey),token.expiresAt);store.audit(connection.userId,'connection.upstox.connected','connection',connection.id);response.redirect('/app/settings?connected=upstox');}catch{response.redirect('/app/settings?error=upstox_exchange_failed');}}));
  app.post('/api/connections/indmoney/connect',asyncRoute(async(request,response)=>{
    const user=requireUser(request); if(user.demo)throw new HttpError(400,'Create a real account before connecting a live broker.');
    const options=indmoneyOptions(config,store,user.id); if(!options)throw new HttpError(503,'INDmoney is not configured. Set INDMONEY_REDIRECT_URI and TOKEN_ENCRYPTION_KEY.');
    store.ensureConnection(user.id,'INDmoney',['read holdings']);
    const state=randomToken(); store.saveOAuthState(user.id,state,'INDmoney');
    let url:string|null;
    try { url=await beginIndmoneyAuth(options,state); }
    catch(error){ throw new HttpError(502,`INDmoney authorization could not start: ${error instanceof Error?error.message:'provider error'}`); }
    if(!url){ store.audit(user.id,'connection.indmoney.reused','connection',options.connectionId); return void response.json({url:null,alreadyConnected:true}); }
    response.json({url});
  }));
  app.get('/api/connections/indmoney/callback',asyncRoute(async(request,response)=>{
    const code=typeof request.query.code==='string'?request.query.code:'';
    const state=typeof request.query.state==='string'?request.query.state:'';
    if(!code||!state)return void response.redirect('/app/settings?error=indmoney_missing_callback');
    const connection=store.consumeOAuthState(state,'INDmoney'); if(!connection)return void response.redirect('/app/settings?error=indmoney_invalid_state');
    const options=indmoneyOptions(config,store,connection.userId); if(!options)return void response.redirect('/app/settings?error=indmoney_not_configured');
    try { await completeIndmoneyAuth(options,code); store.audit(connection.userId,'connection.indmoney.connected','connection',connection.id); response.redirect('/app/settings?connected=indmoney'); }
    catch { response.redirect('/app/settings?error=indmoney_exchange_failed'); }
  }));
  app.post('/api/connections/binance/connect',asyncRoute(async(request,response)=>{
    const user=requireUser(request); if(user.demo)throw new HttpError(400,'Create a real account before connecting a live exchange.');
    if(!config.tokenEncryptionKey)throw new HttpError(503,'TOKEN_ENCRYPTION_KEY is required before storing exchange credentials.');
    const input=parseBody(z.object({apiKey:z.string().trim().min(16).max(256),apiSecret:z.string().trim().min(16).max(256)}).strict(),request);
    // Prove the credentials read balances before storing them, so a bad key fails
    // here rather than silently at the next sync.
    try { await verifyBinanceCredentials(input); }
    catch(error){ throw new HttpError(400,error instanceof Error?error.message:'Binance rejected these credentials'); }
    const id=store.ensureConnection(user.id,'Binance',['read spot balances']);
    store.saveBrokerTokens(id,sealToken(JSON.stringify(input),config.tokenEncryptionKey),null,undefined);
    store.setConnectionMethod(id,'apikey');
    store.audit(user.id,'connection.binance.connected','connection',id);
    response.json({ok:true});
  }));
  app.post('/api/connections/:broker/sync',asyncRoute(async(request,response)=>{
    const user=requireUser(request); if(user.demo)throw new HttpError(400,'Demo data cannot perform a live broker refresh.');
    const broker=connectionBroker(String(request.params.broker));
    try {
      await locked(`${user.id}:portfolio`,async()=>{
        if(broker==='Upstox'){
          if(!config.tokenEncryptionKey)throw new HttpError(503,'TOKEN_ENCRYPTION_KEY is required for Upstox sync');
          const connection=store.connection(user.id,'Upstox'); if(!connection?.encrypted_token)throw new HttpError(409,'Connect Upstox before syncing');
          try {
            const rows=await fetchUpstoxHoldings(openToken(String(connection.encrypted_token),config.tokenEncryptionKey));
            store.replaceBrokerHoldings(user.id,'Upstox',rows.map((row)=>({security:row.security,accountId:row.accountId,quantity:row.quantity,averagePrice:row.averagePrice})),'oauth');
          } catch(error) { if((error as {status?:number}).status===401)store.markExpired(String(connection.id)); throw error; }
        } else if(broker==='Binance'){
          const credentials=binanceCredentials(store,config,user.id);
          if(!credentials)throw new HttpError(409,'Connect Binance before syncing');
          const rows=await fetchBinanceHoldings(credentials);
          store.replaceBrokerHoldings(user.id,'Binance',rows.map((row)=>({security:row.security,accountId:row.accountId,quantity:row.quantity,averagePrice:row.averagePrice})),'apikey');
        } else {
          const options=indmoneyOptions(config,store,user.id); if(!options)throw new HttpError(503,'INDmoney is not configured. Set INDMONEY_REDIRECT_URI and TOKEN_ENCRYPTION_KEY, or use CSV import.');
          const connection=store.connection(user.id,'INDmoney'); if(!connection?.encrypted_token)throw new HttpError(409,'Connect INDmoney before syncing');
          // INDmoney aggregates other brokers; drop rows for brokers connected directly here.
          const directBrokers=store.connections(user.id).filter((item)=>item.broker!=='INDmoney'&&item.status==='connected').map((item)=>item.broker);
          let rows;
          try { rows=await fetchIndmoneyHoldings({...options,excludeBrokers:directBrokers}); }
          catch(error){ if((error as {status?:number}).status===401)store.markExpired(String(connection.id)); throw error; }
          store.replaceBrokerHoldings(user.id,'INDmoney',rows.map((row)=>({security:row.security,accountId:row.accountId,quantity:row.quantity,averagePrice:row.averagePrice})),'mcp');
        }
      });
    } catch(error) { if(error instanceof HttpError)throw error; throw new HttpError(502,`${broker} sync failed: ${error instanceof Error?error.message:'provider error'}`); }
    store.audit(user.id,'connection.sync','broker',broker); response.json({ok:true});
  }));
  app.delete('/api/connections/:id',(request:StatefulRequest,response)=>{const user=requireUser(request);const id=String(request.params.id);if(!store.deleteConnection(user.id,id))throw new HttpError(404,'Connection not found');store.audit(user.id,'connection.delete','connection',id);response.json({ok:true});});

  /**
   * Logos are proxied rather than hot-linked: helmet's production CSP is
   * `img-src 'self' data:`, so a third-party URL in an <img> renders in dev and
   * silently breaks on `npm start`. Proxying also keeps the logo provider from
   * seeing which tickers a user looks at. Results (including misses) are cached.
   */
  app.get('/api/logos/:id',asyncRoute(async(request,response)=>{
    const symbol=logoSymbol(String(request.params.id));
    if(!symbol) throw new HttpError(404,'No logo is available for this instrument');
    const cacheKey=`logo:${symbol}`;
    const hit=store.readCache(cacheKey);
    const serve=(entry:{missing?:boolean;type?:string;body?:string})=>{
      if(entry.missing||!entry.body||!entry.type) throw new HttpError(404,'No logo is available for this instrument');
      response.type(entry.type).set('Cache-Control','public, max-age=604800').send(Buffer.from(entry.body,'base64'));
    };
    if(hit&&!hit.expired) return void serve(hit.payload as {missing?:boolean;type?:string;body?:string});
    let payload:{missing?:boolean;type?:string;body?:string};
    try {
      const upstream=await fetch(`https://assets.parqet.com/logos/symbol/${encodeURIComponent(symbol)}`,{signal:AbortSignal.timeout(8_000)});
      const type=upstream.headers.get('content-type')??'';
      if(!upstream.ok||!type.startsWith('image/')) payload={missing:true};
      else {
        const bytes=Buffer.from(await upstream.arrayBuffer());
        // Guard against an oversized response landing in the cache table.
        payload=bytes.byteLength>256*1024?{missing:true}:{type,body:bytes.toString('base64')};
      }
    } catch { payload={missing:true}; }
    store.writeCache(cacheKey,payload,'Parqet logo',new Date().toISOString(),payload.missing?LOGO_MISS_TTL:LOGO_TTL);
    serve(payload);
  }));

  app.get('/api/analysis/messages',(request:StatefulRequest,response)=>{const user=requireUser(request);response.json({messages:store.messages(user.id)});});
  app.post('/api/analysis',asyncRoute(async(request,response)=>{const user=requireUser(request);const input=parseBody(z.object({question:z.string().trim().min(2).max(1200),securityId:z.string().max(180).optional()}).strict(),request);const workspace=user.demo?demoWorkspace(user,store.watchlists(user.id)):await liveWorkspace(store,user,config);let stock:StockData|undefined;if(input.securityId){const id=normalizeId(input.securityId);const owned=store.userHasSecurity(user.id,id)?store.securityForUser(user.id,id):store.researchSecurity(user.id,id);stock=user.demo?demoStock(id)??undefined:owned?{security:owned,history:[],fundamentals:{periods:[],currency:owned.currency,source:'Unavailable',asOf:owned.asOf},peers:[]}:undefined;if(!stock)throw new HttpError(400,'Security does not exist in this workspace');}
    const date=new Date().toISOString();const userMessage:AnalysisMessage={id:randomToken(14),role:'user',content:input.question,date};store.addMessage(user.id,userMessage);
    let content:string,sources:string[],kind:'calculated'|'ai';if(config.aiApiUrl&&config.aiApiKey&&config.aiModel){content=await aiAnswer(config,input.question,workspace,stock);sources=['Selected portfolio context supplied to configured AI provider'];kind='ai';}else{const answer=calculatedAnswer(input.question,workspace,stock);content=answer.content;sources=answer.sources;kind='calculated';}
    const message:AnalysisMessage={id:randomToken(14),role:'assistant',content,sources,kind,date:new Date().toISOString()};store.addMessage(user.id,message);response.json({message});
  }));

  app.use('/api',(request,response)=>response.status(404).json({error:'API route not found'}));
  {const clientDir=resolve('dist/client');if(existsSync(clientDir)){app.use(express.static(clientDir));app.use((request,response,next)=>{if(request.method==='GET'&&request.accepts('html'))response.sendFile(resolve(clientDir,'index.html'));else next();});}}
  app.use((error:unknown,request:Request,response:Response,_next:NextFunction)=>{const parserError=Boolean(error&&typeof error==='object'&&(error as {type?:unknown}).type==='entity.parse.failed');const status=error instanceof HttpError?error.status:error instanceof z.ZodError||parserError?400:500;const message=error instanceof HttpError?error.message:error instanceof z.ZodError?error.issues[0]?.message:parserError?'Invalid JSON body':'Internal server error';if(status===500&&config.environment!=='test')console.error('Server error',error);if(request.path.startsWith('/api'))response.status(status).json({error:message});else response.status(status).send(message);});
  app.locals.store=store; return app;
}
