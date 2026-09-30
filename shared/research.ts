import type { FundComposition, FundConstituent, Security } from './types.ts';
export interface ScreenerFilters { query?:string;market?:string;asset?:string;sector?:string;sort?:string;maxPe?:number;minYield?:number;minCapUsdMillions?:number; }
const finite=(value:unknown):value is number=>typeof value==='number'&&Number.isFinite(value);
export function isFund(security:Security){return security.assetClass==='Mutual fund'||security.assetClass==='ETF';}
export function dailyMovement(security:Security):number|undefined{return security.price>0&&security.previousClose>0?(security.price/security.previousClose-1)*100:undefined;}
export function marketCapUsd(security:Security,fx:number):number|undefined{
 if(isFund(security))return undefined;
 if(!finite(security.marketCap)||security.marketCap<=0)return undefined;
 if(security.currency==='USD')return security.marketCap;
 return finite(fx)&&fx>0?security.marketCap/fx:undefined;
}
export function screenSecurities(securities:Security[],filters:ScreenerFilters,fx:number):Security[]{
 const q=(filters.query||'').trim().toLowerCase();
 const result=securities.filter(s=>{
  if(!['IN','US'].includes(s.country))return false;
  if(filters.market&&filters.market!=='ALL'&&s.country!==filters.market)return false;
  if(filters.asset==='stocks'&&!['Indian equity','US equity'].includes(s.assetClass))return false;
  if(filters.asset==='funds'&&s.assetClass!=='Mutual fund')return false;
  if(filters.asset==='etfs'&&s.assetClass!=='ETF')return false;
  if(filters.sector&&filters.sector!=='ALL'&&s.sector!==filters.sector)return false;
  if(q&&!`${s.name} ${s.ticker} ${s.isin||''}`.toLowerCase().includes(q))return false;
  if(finite(filters.maxPe)&&(isFund(s)||!finite(s.pe)||s.pe<=0||s.pe>filters.maxPe))return false;
  if(finite(filters.minYield)&&(!finite(s.dividendYield)||s.dividendYield<filters.minYield))return false;
  const cap=marketCapUsd(s,fx);
  if(finite(filters.minCapUsdMillions)&&(!finite(cap)||cap<filters.minCapUsdMillions*1e6))return false;
  return true;
 });
 const metric=(s:Security)=>filters.sort==='gainers'||filters.sort==='losers'?dailyMovement(s):filters.sort==='pe'?!isFund(s)&&s.pe!==undefined&&s.pe>0?s.pe:undefined:filters.sort==='yield'?s.dividendYield:filters.sort==='volume'?s.volume:marketCapUsd(s,fx);
 const ascending=filters.sort==='pe'||filters.sort==='losers';
 return result.sort((a,b)=>{
  if(filters.sort==='name')return a.name.localeCompare(b.name);
  const av=metric(a),bv=metric(b);if(!finite(av)&&!finite(bv))return a.name.localeCompare(b.name);if(!finite(av))return 1;if(!finite(bv))return -1;
  return (ascending?av-bv:bv-av)||a.name.localeCompare(b.name);
 });
}
export function compositionCoverage(composition:FundComposition){
 const reported=composition.holdings.reduce((sum,h)=>sum+h.weight,0);
 const valid=composition.holdings.every(h=>finite(h.weight)&&h.weight>=0&&h.weight<=100)&&finite(reported)&&reported<=100.1;
 return {reported:Math.round(reported*1000)/1000,unreported:Math.max(0,Math.round((100-reported)*1000)/1000),valid};
}
export function fundPositionExposure(value:number,constituent:FundConstituent):number|null{
 return finite(value)&&value>=0&&finite(constituent.weight)&&constituent.weight>=0&&constituent.weight<=100?value*constituent.weight/100:null;
}
