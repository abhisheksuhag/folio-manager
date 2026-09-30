import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Bookmark, Plus } from 'lucide-react';
import type { Security } from '../../shared/types';
import { dailyMovement, isFund } from '../../shared/research';
import { useWorkspace } from './Shell';
import { Button, Change, Modal, StockLogo } from './ui';
import { money, compact, dateLabel } from '../lib/format';
import { invalidateWorkspace, post } from '../lib/api';

export function SecurityTable({ securities, showWatchlist = true }: { securities: Security[]; showWatchlist?: boolean }) {
  const [save, setSave] = useState<Security | null>(null);
  return <>
    <div className="data-table-wrap"><table className="data-table research-table">
      <thead><tr><th>Company or fund</th><th>Price / NAV</th><th>Day change</th><th>Market cap</th><th>P/E</th><th>Sector / type</th><th><span className="sr-only">Details</span></th>{showWatchlist && <th><span className="sr-only">Watchlist</span></th>}</tr></thead>
      <tbody>{securities.map(s => {
        const change = dailyMovement(s); const href = '/app/stock/' + encodeURIComponent(s.id);
        return <tr key={s.id}>
          <td><Link className="security-cell" to={href}><StockLogo security={s} /><span><strong title={s.name}>{s.name}</strong><small>{s.country === 'IN' ? 'India' : 'US'} · {s.assetClass === 'Mutual fund' ? 'Mutual fund' : `${s.ticker} · ${s.exchange === 'UNKNOWN' ? 'Listing unconfirmed' : s.exchange}`}</small></span></Link></td>
          <td>{s.price > 0 ? money(s.price, s.currency, 2) : '—'}<small className="quote-date">{s.price > 0 && s.asOf ? dateLabel(s.asOf, true) : 'No quote'}</small></td>
          <td>{change !== undefined ? <Change value={change} /> : '—'}</td>
          <td>{!isFund(s) && s.marketCap ? compact(s.marketCap, s.currency) : '—'}</td>
          <td>{!isFund(s) && Number.isFinite(s.pe) ? s.pe!.toFixed(1) : '—'}</td>
          <td><span className="sector-label">{isFund(s) ? s.assetClass : !s.sector || /unavailable|unknown/i.test(s.sector) ? 'Not reported' : s.sector}</span></td>
          <td><Link to={href} className="text-link table-detail-link">{isFund(s) ? 'Composition' : 'Research'}<ArrowUpRight size={13} /></Link></td>
          {showWatchlist && <td><button className="icon-button" aria-label={`Watch ${s.name}`} onClick={() => setSave(s)}><Bookmark size={16} /></button></td>}
        </tr>;
      })}</tbody>
    </table></div>
    {save && <SaveToWatchlist security={save} onClose={() => setSave(null)} />}
  </>;
}

export function SaveToWatchlist({ security, onClose }: { security: Security; onClose: () => void }) {
  const w = useWorkspace(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false); const [name, setName] = useState('');
  const save = async (id: string) => {
    setBusy(true); setError('');
    try { await post(`/watchlists/${id}/items`, { securityId: security.id }); await invalidateWorkspace(); onClose(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return <Modal title="Add to a watchlist" onClose={onClose}>
    <p className="muted">Keep {security.name} close. This doesn’t add an investment to your portfolio.</p>
    <div className="watchlist-choices">{w.watchlists.map(l => <button key={l.id} disabled={busy || l.securityIds.includes(security.id)} onClick={() => save(l.id)}><Bookmark size={18} /><span>{l.name}<small>{l.securityIds.length} companies and funds</small></span><span>{l.securityIds.includes(security.id) ? 'Added' : 'Add'}</span></button>)}</div>
    <form className="inline-form" onSubmit={async e => {
      e.preventDefault(); setBusy(true); setError('');
      try { const { watchlist } = await post<{ watchlist: { id: string } }>('/watchlists', { name }); await save(watchlist.id); }
      catch (e) { setError((e as Error).message); setBusy(false); }
    }}><input aria-label="New watchlist name" placeholder="Name a new watchlist" value={name} maxLength={60} required onChange={e => setName(e.target.value)} /><Button disabled={busy || !name.trim()}><Plus size={15} />Create & add</Button></form>
    {error && <p className="inline-error" role="alert">{error}</p>}
  </Modal>;
}
