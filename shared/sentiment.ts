export const SENTIMENT_MARKETS = [
  {id:'GLOBAL',name:'Global',source:'Folio blend',url:null,description:'Equal-weight blend · US, India & Crypto'},
  {id:'US',name:'US',source:'CNN',url:'https://www.cnn.com/markets/fear-and-greed',description:'Fear & Greed Index'},
  {id:'IN',name:'India',source:'Tickertape',url:'https://www.tickertape.in/market-mood-index',description:'Market Mood Index'},
  {id:'CRYPTO',name:'Crypto',source:'Alternative.me',url:'https://alternative.me/crypto/fear-and-greed-index/',description:'Bitcoin-focused sentiment'},
] as const;
export type SentimentId = typeof SENTIMENT_MARKETS[number]['id'];
export type SentimentLabel = 'Extreme fear'|'Fear'|'Neutral'|'Greed'|'Extreme greed';
export interface SentimentReading {
  id:SentimentId;
  score:number|null;
  label:SentimentLabel|null;
  asOf:string|null;
  source:string;
  stale:boolean;
  demo?:boolean;
  notice?:string;
}
export function sentimentLabel(value:number,id:SentimentId):SentimentLabel {
  if(id==='IN')return value<30?'Extreme fear':value<50?'Fear':value===50?'Neutral':value<=70?'Greed':'Extreme greed';
  return value<25?'Extreme fear':value<45?'Fear':value<=55?'Neutral':value<=75?'Greed':'Extreme greed';
}
export function unavailableSentiment(id:SentimentId,notice='Reading temporarily unavailable'):SentimentReading {
  return {id,score:null,label:null,asOf:null,source:SENTIMENT_MARKETS.find(m=>m.id===id)!.source,stale:false,notice};
}
export function globalSentiment(readings:SentimentReading[]):SentimentReading {
  const parts=(['US','IN','CRYPTO'] as const).map(id=>readings.find(r=>r.id===id));
  if(parts.some(r=>!r||r.score===null||r.stale||!r.asOf))return unavailableSentiment('GLOBAL','Needs recent readings from all three markets');
  const score=Number((parts.reduce((sum,r)=>sum+r!.score!,0)/3).toFixed(1));
  return {id:'GLOBAL',score,label:sentimentLabel(score,'GLOBAL'),asOf:parts.map(r=>r!.asOf!).sort()[0],source:'Folio blend',stale:false,demo:parts.every(r=>r!.demo)};
}
