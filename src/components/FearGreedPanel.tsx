import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, RefreshCw } from 'lucide-react';
import { SENTIMENT_MARKETS, type SentimentId, type SentimentReading } from '../../shared/sentiment';
import { request } from '../lib/api';
import { dateLabel } from '../lib/format';
import './fear-greed.css';

const point=(value:number,radius=69)=>({x:100-Math.cos(value/100*Math.PI)*radius,y:83-Math.sin(value/100*Math.PI)*radius});
function Gauge({score,label,name,id}:{score:number|null;label:string|null;name:string;id:SentimentId}){
  const bands=id==='IN'?[0,30,50,70,100]:[0,25,45,55,75,100];
  const colors=id==='IN'?['#c58578','#dfbb8b','#afc47e','#719783']:['#c58578','#dfbb8b','#d5d3b5','#afc47e','#719783'];
  const marker=point(score??50);
  return <div className={`sentiment-gauge ${score===null?'sentiment-gauge-empty':''}`} role={score===null?undefined:'meter'} aria-label={`${name} fear and greed`} aria-valuemin={score===null?undefined:0} aria-valuemax={score===null?undefined:100} aria-valuenow={score??undefined} aria-valuetext={score===null?undefined:`${score.toFixed(1)} out of 100, ${label}`}>
    <svg viewBox="0 0 200 96" aria-hidden="true">
      {bands.slice(0,-1).map((start,i)=>{
        const a=point(start+.8),b=point(bands[i+1]-.8);
        return <path key={start} d={`M${a.x} ${a.y} A69 69 0 0 1 ${b.x} ${b.y}`} stroke={score===null?'var(--border)':colors[i]} strokeWidth="10" fill="none"/>;
      })}
      {score!==null&&<circle cx={marker.x} cy={marker.y} r="6" fill="var(--ink)" stroke="var(--canvas)" strokeWidth="3"/>}
    </svg>
    <div className="sentiment-score" aria-hidden="true"><strong>{score===null?'—':score.toFixed(1)}</strong>{score!==null&&<small>/ 100</small>}</div>
  </div>;
}

export function FearGreedPanel(){
  const titleId=useId();
  const {data,isPending,isError,isFetching,refetch}=useQuery({queryKey:['sentiment'],queryFn:()=>request<SentimentReading[]>('/sentiment'),staleTime:15*60_000,retry:false});
  const demo=data?.some(r=>r.demo);
  return <section className="sentiment-panel" aria-labelledby={titleId}>
    <header className="sentiment-header"><div><h2 id={titleId}>Fear &amp; greed</h2><p>A feel for the markets, beyond the prices.</p></div><div className="sentiment-actions">{demo&&<span className="sentiment-demo">Illustrative demo</span>}<button type="button" disabled={isFetching} onClick={()=>void refetch()} aria-label={isError?'Try again':'Refresh sentiment'}><RefreshCw size={14}/><span>{isFetching?'Updating…':isError?'Try again':'Refresh'}</span></button></div></header>
    <div className="sentiment-grid" aria-busy={isPending}>
      {SENTIMENT_MARKETS.map(market=>{
        const reading=data?.find(r=>r.id===market.id);
        const score=reading?.score??null;
        return <article className="sentiment-market" key={market.id} aria-label={`${market.name} sentiment`}>
          <div className="sentiment-market-title"><h3>{market.name}</h3>{market.id==='GLOBAL'&&<span>Blend</span>}{reading?.stale&&<span>Saved</span>}</div>
          <p className="sentiment-description">{market.description}</p>
          <Gauge score={score} label={reading?.label??null} name={market.name} id={market.id}/>
          <strong className="sentiment-label">{isPending?'Loading…':score===null?'Unavailable':reading?.label}</strong>
          <div className="sentiment-scale" aria-hidden="true"><span>0 · Fear</span><span>Greed · 100</span></div>
          <footer className="sentiment-source">
            <div>{market.url?<a href={market.url} target="_blank" rel="noreferrer">{market.source}<ArrowUpRight size={12}/></a>:<span>{market.source}</span>}{reading?.asOf&&<time dateTime={reading.asOf} title={new Date(reading.asOf).toLocaleString()}>{market.id==='GLOBAL'?'Oldest input · ':''}{dateLabel(reading.asOf,true)}</time>}</div>
            {reading?.notice&&!reading.demo&&<p>{reading.notice}</p>}
            {isError&&<p>Couldn’t load readings. Try again.</p>}
          </footer>
        </article>;
      })}
    </div>
    <details className="sentiment-method"><summary>How to read this</summary><div><p>Each score runs from 0 (extreme fear) to 100 (extreme greed). These describe sentiment, not expected returns. Each provider uses a different methodology; the readings are not directly equivalent.</p><p><strong>Global</strong> is Folio’s equal-weight average of US, India and Crypto, not a worldwide benchmark. All three readings must be available and no more than four days old. The date shown is the oldest input. Blend bands: below 25 extreme fear, below 45 fear, 45–55 neutral, above 55 greed, above 75 extreme greed.</p><p><strong>US</strong> uses CNN’s Fear &amp; Greed Index. <strong>India</strong> uses Tickertape’s Market Mood Index: below 30 extreme fear, 30–50 fear, 50 neutral, 50–70 greed, above 70 extreme greed. <strong>Crypto</strong> uses Alternative.me’s Bitcoin-focused index. US and Crypto labels follow their providers.</p><p>Feeds are cached for 30 minutes. If a feed fails, its last reading is marked Saved and excluded from Global. Demo scores are illustrative.</p></div></details>
  </section>;
}
