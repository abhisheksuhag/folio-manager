import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Layers3, Search } from 'lucide-react';
import type { Currency, FundAllocation, FundComposition as Composition } from '../../shared/types';
import { compositionCoverage, fundPositionExposure } from '../../shared/research';
import { dateLabel, money } from '../lib/format';

export function SourceLink({url, label='View source'}:{url?:string;label?:string}) {
  return url && /^https?:\/\//i.test(url) ? <a className="text-link source-link" href={url} target="_blank" rel="noreferrer">{label}<ArrowUpRight size={13}/></a> : null;
}

function AllocationBars({title,items}:{title:string;items:FundAllocation[]}) {
  const valid=items.length>0 && items.every(i=>Number.isFinite(i.weight)&&i.weight>=0&&i.weight<=100) && items.reduce((s,i)=>s+i.weight,0)<=100.1;
  const remainder=valid?Math.max(0,100-items.reduce((s,i)=>s+i.weight,0)):0;
  return <section className="fund-allocation"><h3>{title}</h3>{valid ? <div className="allocation-bars">{[...items].sort((a,b)=>b.weight-a.weight).concat(remainder>.1?[{name:'Unreported',weight:remainder}]:[]).map((item,i)=><div key={`${item.name}-${i}`}><div><span>{item.name}</span><strong>{item.weight.toFixed(2)}%</strong></div><span className="allocation-bar-track"><i style={{width:`${item.weight}%`}}/></span></div>)}</div>:<p className="muted">{items.length?'Allocation weights could not be verified.':'Not supplied by this provider.'}</p>}</section>;
}

export function FundComposition({composition,positionValue,currency}:{composition?:Composition;positionValue?:number;currency:Currency}) {
  const [q,setQ]=useState(''); const [all,setAll]=useState(false);
  const coverage=composition?compositionCoverage(composition):null;
  const usable=composition && composition.status!=='unavailable' && composition.holdings.length>0 && coverage?.valid;
  const rows=usable?[...composition.holdings].sort((a,b)=>b.weight-a.weight).filter(h=>`${h.name} ${h.ticker||''}`.toLowerCase().includes(q.trim().toLowerCase())):[];
  const showExposure=positionValue!==undefined&&Number.isFinite(positionValue)&&positionValue>=0;
  return <section className="fund-composition" id="composition">
    <div className="section-heading"><div><span className="eyebrow">LOOK INSIDE</span><h2>What your fund owns</h2></div><Layers3 size={24} strokeWidth={1.5}/></div>
    <p className="section-intro">The companies and assets behind a single investment.</p>
    {!usable?<div className="compact-unavailable"><strong>Composition isn’t available yet.</strong><p>{composition?.reason || (coverage&&!coverage.valid?'The provider’s holding weights could not be verified.':'This provider hasn’t supplied a holdings breakdown for this fund.')}</p><p>Your fund’s value and units can still be viewed above.</p></div>:<>
      <div className="composition-summary"><div><strong>{coverage.reported.toFixed(2)}%</strong><span>of fund holdings reported</span></div><div><strong>{composition.holdings.length}{composition.reportedHoldingCount&&composition.reportedHoldingCount>composition.holdings.length?` / ${composition.reportedHoldingCount}`:''}</strong><span>holdings shown{composition.reportedHoldingCount&&composition.reportedHoldingCount>composition.holdings.length?' / total reported':''}</span></div><div><strong>{composition.asOf?dateLabel(composition.asOf,true):'Not reported'}</strong><span>composition date</span></div></div>
      {(composition.status==='partial'||coverage.unreported>.1)&&<p className="research-notice">{coverage.unreported.toFixed(2)}% is outside this holdings breakdown. Weights are shown as reported; they are not scaled to fill the fund.{composition.reason?` ${composition.reason}`:''}</p>}
      <div className="section-heading holding-list-heading"><h3>Underlying holdings</h3><div className="input-search"><Search size={15}/><input aria-label="Search fund holdings" placeholder="Find an underlying company" value={q} onChange={e=>{setQ(e.target.value);setAll(false);}}/></div></div>
      <p className="mobile-only mobile-scroll-hint">Swipe the table to see more holding details.</p>
      <div className="data-table-wrap"><table className="data-table composition-table"><thead><tr><th>Company / asset</th><th>Weight in fund</th>{showExposure&&<th>Your estimated exposure</th>}<th>Sector</th></tr></thead><tbody>{(all?rows:rows.slice(0,10)).map((h,i)=><tr key={`${h.name}-${i}`}><td>{h.securityId?<Link className="composition-name text-link" to={'/app/stock/'+encodeURIComponent(h.securityId)}>{h.name}<ArrowUpRight size={13}/></Link>:<strong className="composition-name">{h.name}</strong>}{h.ticker&&<small className="quote-date">{h.ticker}</small>}</td><td><strong>{h.weight.toFixed(2)}%</strong><span className="weight-track"><i style={{width:`${h.weight}%`}}/></span></td>{showExposure&&<td>{money(fundPositionExposure(positionValue!,h)!,currency)}</td>}<td>{h.sector||'—'}</td></tr>)}</tbody></table>{!rows.length&&<p className="inline-empty">No underlying holdings match this search.</p>}</div>
      {rows.length>10&&<button className="button secondary composition-more" onClick={()=>setAll(!all)}>{all?'Show top 10':`Show all ${rows.length} holdings`}</button>}
      {showExposure&&<p className="data-note">Estimated exposure = your current fund value × reported holding weight. The composition and valuation dates may differ. This is indirect exposure through the fund.</p>}
    </>}
    {composition&&<><div className="fund-allocation-grid"><AllocationBars title="Sector allocation" items={composition.sectors}/><AllocationBars title="Geography" items={composition.countries}/><AllocationBars title="Asset allocation" items={composition.assetAllocation}/></div><div className="research-provenance"><p>{composition.source} · Composition: {composition.asOf?dateLabel(composition.asOf,true):'date not reported'}</p><p>Retrieved {dateLabel(composition.fetchedAt,true)}. Fund holdings can change between reports.</p><SourceLink url={composition.sourceUrl}/></div></>}
  </section>;
}
