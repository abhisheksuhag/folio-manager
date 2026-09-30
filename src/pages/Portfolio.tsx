import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDownUp, ArrowUpRight, Download, Plus, Search } from 'lucide-react';
import { convert, riskMetrics } from '../../shared/analytics';
import { dailyMovement, isFund } from '../../shared/research';
import { useWorkspace } from '../components/Shell';
import { Button, Change, EmptyState, PageTitle, StockLogo } from '../components/ui';
import { PerformanceChart } from '../components/PerformanceChart';
import { AllocationPanel } from './Dashboard';
import { dateLabel, downloadCsv, money, percent } from '../lib/format';

export function Portfolio() {
  const w=useWorkspace(); const currency=w.user.currency; const [q,setQ]=useState(''); const [asset,setAsset]=useState('ALL'); const [broker,setBroker]=useState('ALL'); const [sort,setSort]=useState('value');
  const fxAvailable=Number.isFinite(w.fx.USDINR)&&w.fx.USDINR>0;
  const rows=w.holdings.map(h=>{
    const canConvert=h.security.currency===currency||fxAvailable;
    const value=canConvert&&h.security.price>0?convert(h.quantity*h.security.price,h.security.currency,currency,w.fx.USDINR):undefined;
    const invested=canConvert&&h.averagePrice>0?convert(h.quantity*h.averagePrice,h.security.currency,currency,w.fx.USDINR):undefined;
    const gain=value!==undefined&&invested!==undefined?value-invested:undefined;
    return {...h,value,invested,gain,return:gain!==undefined&&invested?gain/invested*100:undefined,daily:dailyMovement(h.security)};
  });
  const total=(key:'value'|'invested'|'gain')=>rows.every(r=>r[key]!==undefined)?rows.reduce((sum,r)=>sum+r[key]!,0):undefined;
  const value=total('value'),invested=total('invested'),gain=total('gain');
  const visible=rows.filter(h=>`${h.security.name} ${h.security.ticker}`.toLowerCase().includes(q.toLowerCase())&&(asset==='ALL'||h.security.assetClass===asset)&&(broker==='ALL'||h.broker===broker)).sort((a,b)=>sort==='name'?a.security.name.localeCompare(b.security.name):(b.value??-Infinity)-(a.value??-Infinity));
  const amount=(n?:number)=>n===undefined?'—':money(n,currency);
  const risks=riskMetrics(w.history);
  const quickAssets=[
    {value:'ALL',label:'All holdings'},
    {value:'Indian equity',label:'Indian stocks'},
    {value:'US equity',label:'US stocks'},
    {value:'Mutual fund',label:'Mutual funds'},
    {value:'ETF',label:'ETFs'},
    {value:'Crypto',label:'Crypto'},
    {value:'Retirement',label:'Retirement'},
    {value:'Cash',label:'Cash'},
  ].filter(option=>option.value==='ALL'||rows.some(h=>h.security.assetClass===option.value));
  return <div className="page-enter portfolio-page"><PageTitle title="Your investments, together." subtitle="See what you own, how it’s doing, and what’s inside your funds."><Button variant="secondary" disabled={!rows.length} onClick={()=>downloadCsv('folio-holdings.csv',[['Name','Type','Ticker','Units','Price / NAV','Native currency','Value '+currency,'Cost '+currency,'Return %','Platform','Valuation date'],...visible.map(h=>[h.security.name,h.security.assetClass,h.security.ticker,h.quantity,h.security.price||'',h.security.currency,h.value??'',h.invested??'',h.return??'',h.broker,h.security.asOf])])}><Download size={15}/>Export</Button><Link className="button primary" to="/app/settings"><Plus size={15}/>Add investments</Link></PageTitle>
    {!rows.length?<EmptyState title="Bring your investments together." description="Connect a platform or import a statement to start your portfolio." action="Add investments" to="/app/settings"/>:<>
      <div className="portfolio-overview"><div><span>Current value</span><strong>{amount(value)}</strong><small>{rows.length} positions · {new Set(rows.map(h=>h.broker)).size} platforms</small></div><div><span>Invested value</span><strong>{amount(invested)}</strong><small>Cost of your open positions</small></div><div><span>Unrealized gain / loss</span><strong className={gain!==undefined?(gain>=0?'positive':'negative'):''}>{amount(gain)}</strong><small>{gain!==undefined&&invested?percent(gain/invested*100):'Requires a price and cost basis for every position'}</small></div></div>
      {(value===undefined||invested===undefined)&&<p className="research-notice">{!fxAvailable&&rows.some(h=>h.security.currency!==currency)?'A USD/INR exchange rate is needed to combine currencies. Native prices remain available below.':'Some positions are missing a usable price or cost basis.'} Incomplete totals are shown as “—”.</p>}
      <section id="holdings" className="portfolio-holdings"><div className="section-heading"><h2>Your holdings <span className="count-label">{rows.length}</span></h2><span className="muted">Select a fund to see its composition</span></div>
      <div className="table-controls portfolio-controls">
      <div className="market-switch portfolio-quick-filters" role="group" aria-label="Quick asset filters">{quickAssets.map(option=><button type="button" key={option.value} className={asset===option.value?'active':''} aria-pressed={asset===option.value} onClick={()=>setAsset(option.value)}>{option.label}</button>)}</div>
      <div className="input-search"><Search size={16}/><input aria-label="Search holdings" value={q} placeholder="Find a holding" onChange={e=>setQ(e.target.value)}/></div><select aria-label="Filter by platform" value={broker} onChange={e=>setBroker(e.target.value)}><option value="ALL">All platforms</option>{[...new Set(rows.map(h=>h.broker))].map(b=><option key={b}>{b}</option>)}</select><select aria-label="Sort holdings" value={sort} onChange={e=>setSort(e.target.value)}><option value="value">Largest value</option><option value="name">Name, A–Z</option></select>{(q||asset!=='ALL'||broker!=='ALL')&&<button className="text-link" onClick={()=>{setQ('');setAsset('ALL');setBroker('ALL');}}>Clear filters</button>}</div>
      <p className="mobile-only mobile-scroll-hint">Swipe the table for values, returns, and portfolio weights.</p>{visible.length?<div className="data-table-wrap"><table className="data-table portfolio-table"><thead><tr><th>Investment</th><th>Units</th><th>Price / NAV</th><th>Current value</th><th>Day change</th><th>Total return</th><th>Portfolio weight</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{visible.map(h=>{const href='/app/stock/'+encodeURIComponent(h.security.id);return <tr key={h.id}><td><Link className="security-cell" to={href}><StockLogo security={h.security}/><span><strong title={h.security.name}>{h.security.name}</strong><small>{h.security.assetClass} · {h.broker}</small></span></Link></td><td>{h.quantity.toLocaleString('en-IN',{maximumFractionDigits:4})}</td><td>{h.security.price>0?money(h.security.price,h.security.currency,2):'—'}<small className="quote-date">{h.security.asOf&&h.security.price>0?dateLabel(h.security.asOf,true):'No quote'}</small></td><td className="table-emphasis">{amount(h.value)}</td><td>{h.daily!==undefined?<Change value={h.daily}/>: '—'}</td><td>{h.return!==undefined?<Change value={h.return}/>: '—'}<small className="quote-date">{h.gain!==undefined?amount(h.gain):'Cost basis unavailable'}</small></td><td>{value&&h.value!==undefined?<><span>{percent(h.value/value*100,false)}</span><span className="weight-track"><i style={{width:`${h.value/value*100}%`}}/></span></>:'—'}</td><td><Link className="text-link table-detail-link" to={href}>{isFund(h.security)?'Composition':'Details'}<ArrowUpRight size={13}/></Link></td></tr>;})}</tbody></table><div className="table-footer">{visible.length} of {rows.length} positions<span>Prices in native currency · Values in {currency}</span></div></div>:<div className="compact-unavailable"><strong>No holdings match these filters.</strong><p>Try another search or clear the filters.</p></div>}
      <p className="data-note">Open-position returns exclude realized gains, fees, and dividends. {fxAvailable?`USD/INR ${w.fx.USDINR.toFixed(2)} · ${w.fx.source}${w.fx.asOf?` · ${dateLabel(w.fx.asOf,true)}`:''}.`:''}</p></section>
      <div className={`portfolio-context ${value===undefined?'single-column':''}`}><section><PerformanceChart points={w.history} currency={currency} fx={currency==='USD'?(fxAvailable?1/w.fx.USDINR:NaN):1} demo={w.mode==='demo'} height={250}/>{w.history.length>1&&<div className="portfolio-history-stats"><div><span>Time-weighted CAGR</span><strong>{risks.cagr===null?'Needs one year':percent(risks.cagr)}</strong></div><div><span>Maximum drawdown</span><strong>{percent(risks.maxDrawdown)}</strong></div></div>}</section>{value!==undefined&&<AllocationPanel/>}</div>
    </>}
  </div>;
}
