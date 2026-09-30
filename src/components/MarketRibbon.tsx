import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Globe2 } from 'lucide-react';
import { MARKET_TRENDS, trendGeometry, type MarketTrend } from '../../shared/market-trends';
import { request } from '../lib/api';
import { dateLabel, money, percent } from '../lib/format';

export function MarketRibbon(){
  const {data,isPending}=useQuery({queryKey:['market-trends'],queryFn:()=>request<MarketTrend[]>('/market-trends'),staleTime:15*60_000,retry:false});
  return <nav className="market-trends" aria-label="Market trends">
    <div className="market-trends-intro"><span>A look around <Globe2 size={14} aria-hidden="true"/></span><small>Recent daily closes</small></div>
    {MARKET_TRENDS.map(spec=>{
      const trend=data?.find(item=>item.id===spec.id);
      const points=trend?.points??[];const geometry=trendGeometry(points);const last=points.at(-1);
      const direction=geometry?(geometry.change>0?'positive':geometry.change<0?'negative':'neutral'):'';
      const details=geometry?`${trend?.instrument}. ${points.length} daily closes, ${dateLabel(points[0].date)} to ${dateLabel(last!.date)}. Period change ${percent(geometry.change)}. Source: ${trend?.source}.${trend?.notice?' '+trend.notice:''}`:trend?.notice??'History unavailable';
      return <Link key={spec.id} to={'/app/index/'+spec.id} className="market-trend" title={details} aria-label={`${spec.name}. ${details}`}>
        <div className="market-trend-name"><strong>{spec.name}</strong><small>{trend?.source==='Illustrative demo'?'Demo · ':''}{spec.instrument}{trend?.stale?' · saved':''}</small></div>
        {geometry?<><svg className={`market-sparkline ${direction}`} viewBox="0 0 96 38" role="img" aria-label={`${spec.name} daily price trend`}>
          <path d="M3 33H93" className="sparkline-baseline"/>
          <path d={geometry.path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          <circle cx={geometry.end.x} cy={geometry.end.y} r="2.5" fill="currentColor"/>
        </svg><div className="market-trend-values"><strong>{spec.currency?money(last!.value,spec.currency,2):last!.value.toLocaleString('en-IN',{maximumFractionDigits:2,minimumFractionDigits:2})}</strong><span className={direction}>{percent(geometry.change)} <small>period</small></span></div></>
        :<span className="market-trend-unavailable">{isPending?'Loading history…':'History unavailable'}<ArrowUpRight size={14} aria-hidden="true"/></span>}
      </Link>;
    })}
  </nav>;
}
