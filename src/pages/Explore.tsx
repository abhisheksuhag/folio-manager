import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, ChevronDown, Download, Filter, Globe2, Search, X } from 'lucide-react';
import type { IndexData, ScreenerData } from '../../shared/types';
import { screenSecurities } from '../../shared/research';
import { request } from '../lib/api';
import { dateLabel, downloadCsv } from '../lib/format';
import { useWorkspace } from '../components/Shell';
import { Button, EmptyState, ErrorState, Loading, PageTitle } from '../components/ui';
import { SecurityTable } from '../components/SecurityTable';

export const indices = [
  { id: 'NIFTY50', name: 'NIFTY 50' }, { id: 'NIFTY100', name: 'NIFTY 100' }, { id: 'NIFTY500', name: 'NIFTY 500' },
  { id: 'SP500', name: 'S&P 500' }, { id: 'QQQ', name: 'Nasdaq-100 / QQQ' },
];

export function Explore({ markets: _legacy }: { markets?: boolean }) {
  const w = useWorkspace(); const [params, setParams] = useSearchParams();
  const market = params.get('market') || 'ALL'; const universe = params.get('universe') || 'ALL'; const asset = params.get('asset') || 'all';
  const [q, setQ] = useState(params.get('q') || ''); const [debounced, setDebounced] = useState(q);
  const [sector, setSector] = useState('ALL'); const [sort, setSort] = useState('cap'); const [advanced, setAdvanced] = useState(false);
  const [maxPe, setMaxPe] = useState(''); const [minYield, setMinYield] = useState(''); const [minCap, setMinCap] = useState(''); const [page, setPage] = useState(1);
  const update = (key: string, value: string) => setParams(current => { const next = new URLSearchParams(current); next.set(key, value); return next; }, { replace: true });
  useEffect(() => { const timer = setTimeout(() => { setDebounced(q.trim()); }, 350); return () => clearTimeout(timer); }, [q]);
  useEffect(() => { setPage(1); }, [q, market, universe, asset, sector, sort, maxPe, minYield, minCap]);
  const query = useQuery({ queryKey: ['explore', market, universe, debounced], queryFn: () => request<ScreenerData>(`/explore?market=${encodeURIComponent(market)}&universe=${encodeURIComponent(universe)}&q=${encodeURIComponent(debounced)}`), staleTime: 300_000 });
  const securities = query.data?.securities || [];
  const filtered = screenSecurities(securities, { query: q, market, asset, sector, sort, maxPe: maxPe ? Number(maxPe) : undefined, minYield: minYield ? Number(minYield) : undefined, minCapUsdMillions: minCap ? Number(minCap) : undefined }, w.fx.USDINR);
  const visible = filtered.slice((page - 1) * 30, page * 30); const activeCount = [maxPe, minYield, minCap].filter(Boolean).length; const priced = filtered.filter(s => s.price > 0).length;
  const reset = () => { setQ(''); setParams({}); setSector('ALL'); setMaxPe(''); setMinYield(''); setMinCap(''); setSort('cap'); };
  return <div className="page-enter screener-page">
    <PageTitle title="Find your next idea." subtitle="A clearer way to explore Indian and US stocks, mutual funds, and ETFs.">
      <Button variant="secondary" disabled={!filtered.length} onClick={() => downloadCsv('folio-screen.csv', [['Name', 'Ticker', 'Market', 'Type', 'Price', 'Currency', 'P/E', 'Market cap (native)', 'As of', 'Source'], ...filtered.map(s => [s.name, s.ticker, s.country, s.assetClass, s.price || '', s.currency, s.pe ?? '', s.marketCap ?? '', s.asOf, s.source])])}><Download size={15} />Export results</Button>
    </PageTitle>
    <div className="explore-intro"><div><Globe2 size={19} /><span>Two markets. One place to look.</span></div><div className="market-switch" aria-label="Research market">{[{ id: 'ALL', label: 'Both markets' }, { id: 'IN', label: 'India' }, { id: 'US', label: 'United States' }].map(m => <button key={m.id} aria-pressed={market === m.id} className={market === m.id ? 'active' : ''} onClick={() => { setParams(current=>{const next=new URLSearchParams(current);next.set('market',m.id);next.set('universe','ALL');return next;},{replace:true}); setSector('ALL'); }}>{m.label}</button>)}</div></div>
    <div className="screener-controls">
      <div className="input-search screener-search"><Search size={18} /><input value={q} aria-label="Search companies and funds" placeholder="Search a company, fund, or ticker" onChange={e => setQ(e.target.value)} />{q && <button className="icon-button" aria-label="Clear search" onClick={() => setQ('')}><X size={14} /></button>}</div>
      <label>What to explore<select aria-label="Asset type" value={asset} onChange={e => { update('asset', e.target.value); if (['funds', 'etfs'].includes(e.target.value)) { setMaxPe(''); setMinCap(''); setMinYield(''); } }}><option value="all">Stocks & funds</option><option value="stocks">Stocks</option><option value="funds">Mutual funds</option><option value="etfs">ETFs</option></select></label>
      <label>Universe<select aria-label="Research universe" value={universe} onChange={e => { update('universe', e.target.value); setSector('ALL'); }}><option value="ALL">All available</option>{indices.filter(i => market === 'ALL' || (market === 'IN' ? i.id.startsWith('NIFTY') : !i.id.startsWith('NIFTY'))).map(i => <option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
      <label>Sector<select aria-label="Sector" value={sector} onChange={e => setSector(e.target.value)}><option value="ALL">All sectors</option>{[...new Set(securities.map(s => s.sector))].filter(s => s && !/unavailable|unknown/i.test(s)).sort().map(s => <option key={s}>{s}</option>)}</select></label>
      <Button variant="secondary" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}><Filter size={15} />Filters{activeCount > 0 && <span className="filter-count">{activeCount}</span>}</Button>
    </div>
    {advanced && <div className="screener-filters"><label>Maximum P/E<input aria-label="Maximum P/E" type="number" min="0" step="1" placeholder="e.g. 25" value={maxPe} onChange={e => setMaxPe(e.target.value)} /></label><label>Dividend yield at least (%)<input aria-label="Minimum dividend yield" type="number" min="0" step="0.1" placeholder="e.g. 1.5" value={minYield} onChange={e => setMinYield(e.target.value)} /></label><label>Market cap at least (USD millions)<input aria-label="Minimum market cap" type="number" min="0" step="100" placeholder="e.g. 1000" value={minCap} onChange={e => setMinCap(e.target.value)} /></label><p>Valuation filters use reported values only. Missing data is excluded. Market caps are converted to USD using the portfolio’s dated exchange rate.</p></div>}
    <div className="screener-result-heading"><div><strong>{filtered.length} results</strong><span>{priced} with quotes{query.isFetching ? ' · Updating…' : ''}</span></div><div>{(q || activeCount || sector !== 'ALL' || universe !== 'ALL' || market !== 'ALL' || asset !== 'all') && <button className="text-link" onClick={reset}>Clear filters</button>}<label className="select-wrap"><select aria-label="Sort results" value={sort} onChange={e => setSort(e.target.value)}><option value="cap">Market cap, high to low</option><option value="name">Name, A–Z</option><option value="gainers">Day gainers</option><option value="losers">Day decliners</option><option value="pe">P/E, low to high</option><option value="yield">Dividend yield</option><option value="volume">Trading volume</option></select><ChevronDown size={13} /></label></div></div>
    {query.isLoading ? <Loading /> : query.error ? <ErrorState error={query.error} retry={() => query.refetch()} /> : visible.length ? <SecurityTable securities={visible} /> : <EmptyState title="No matches in this view." description={securities.length ? 'Try fewer filters or another company name. Missing metrics don’t count as zero.' : 'This universe has no data available yet. Try another market or search for a company or fund.'} />}
    {filtered.length > 30 && <div className="screener-pagination"><span>Showing {(page - 1) * 30 + 1}–{Math.min(page * 30, filtered.length)} of {filtered.length}</span><div><Button variant="secondary" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button><Button variant="secondary" disabled={page * 30 >= filtered.length} onClick={() => setPage(p => p + 1)}>Next<ArrowRight size={14} /></Button></div></div>}
    {query.data && <div className="research-provenance"><p><span className="status-dot" />{query.data.source}{query.data.asOf ? ` · ${dateLabel(query.data.asOf, true)}` : ''}</p>{query.data.notices.map((notice, i) => <p key={i}>{notice}</p>)}<p>Prices stay in their native currencies. “—” means a metric isn’t reported. Results cover the available universe, not every listed security.</p></div>}
  </div>;
}

export function IndexPage() {
  const { id } = useParams(); const w = useWorkspace(); const [q, setQ] = useState(''); const [sort, setSort] = useState('name');
  const query = useQuery({ queryKey: ['index', id], queryFn: () => request<IndexData>(`/indices/${encodeURIComponent(id!)}`), staleTime: 300_000 });
  if (query.isLoading) return <Loading />; if (query.error) return <ErrorState error={query.error} retry={() => query.refetch()} />;
  const d = query.data!; const items = screenSecurities(d.securities, { query: q, sort }, w.fx.USDINR);
  return <div className="page-enter"><Link className="back-link" to="/app/explore"><ArrowLeft size={14} />Back to Explore</Link><PageTitle title={d.name} subtitle="Understand the companies behind the bigger picture."><Link className="button secondary" to={`/app/explore?universe=${encodeURIComponent(d.id)}`}>Screen this universe<ArrowRight size={14} /></Link></PageTitle><div className="index-summary"><Globe2 size={31} /><div><strong>{d.securities.length} securities available</strong><p>{d.complete ? 'Provider constituent list' : 'Available coverage · may be incomplete'}</p></div><small>{d.source}<br />{d.asOf ? dateLabel(d.asOf, true) : 'Reporting date not supplied'}</small></div>{d.notice && <p className="research-notice">{d.notice}</p>}<div className="table-controls"><div className="input-search"><Search size={16} /><input aria-label="Search index constituents" placeholder="Find a company…" value={q} onChange={e => setQ(e.target.value)} /></div><select aria-label="Sort constituents" value={sort} onChange={e => setSort(e.target.value)}><option value="name">Name, A–Z</option><option value="cap">Market cap</option><option value="gainers">Day gainers</option></select></div>{items.length ? <SecurityTable securities={items} /> : <EmptyState title="This list isn’t available yet." description="The index is supported, but its data provider hasn’t supplied a usable constituent list. You can still search across Explore." action="Explore companies & funds" to="/app/explore" />}{d.sourceUrl && <a className="text-link source-link" href={d.sourceUrl} target="_blank" rel="noreferrer">View provider source<ArrowRight size={13} /></a>}</div>;
}
