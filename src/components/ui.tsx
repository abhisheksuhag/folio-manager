import { useEffect, useRef, type ReactNode, type ButtonHTMLAttributes } from 'react';
import { ArrowUpRight, ArrowDownRight, ArrowRight, X, LoaderCircle, Sprout, AlertCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { Security } from '../../shared/types';
import { percent } from '../lib/format';
export function Button({children,variant='primary',className='',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{variant?:'primary'|'secondary'|'ghost'|'dark'}){return <button className={`button ${variant} ${className}`} {...props}>{children}</button>;}
export function Logo({compact=false}:{compact?:boolean}){return <Link to="/" className="brand" aria-label="Folio home"><svg viewBox="0 0 32 34" aria-hidden="true"><path d="M5 30V16C5 7 14 2 27 3c0 13-8 18-19 17" fill="currentColor"/><path d="M8 22C10 14 17 10 23 7" fill="none" stroke="var(--canvas)" strokeWidth="2"/></svg>{!compact&&<span>folio<span className="brand-dot">.</span></span>}</Link>;}
export function Change({value,children}:{value:number;children?:ReactNode}){const Icon=value>=0?ArrowUpRight:ArrowDownRight;return <span className={`change ${value>=0?'positive':'negative'}`}><Icon size={14}/>{children||percent(value)}</span>;}
/**
 * Ids whose ticker is an internal code or a fund name have no logo upstream; the
 * proxy 404s for those and the <img> hides itself, leaving the initials visible.
 */
function logoSrc(security: Security): string | null {
  const parts = security.id.split(':');
  if (parts.length < 3) return null;
  const ticker = parts.slice(2).join(':').toUpperCase().trim();
  if (!/^[A-Z][A-Z0-9.\-]{0,19}$/.test(ticker) || /^INDS?\d+$/.test(ticker)) return null;
  if (parts[0] !== 'in' && parts[0] !== 'us') return null;
  return '/api/logos/' + encodeURIComponent(security.id);
}
export function StockLogo({security,size=36}:{security:Security;size?:number}){
  const src=security.logo??logoSrc(security);
  return <span className="stock-logo" style={{width:size,height:size,background:security.color||'#eee',color:security.color==='#ffffff'?'#222':'#fff'}} aria-hidden="true">{security.ticker==='AAPL'?<svg viewBox="0 0 24 24" width="20" fill="currentColor"><path d="M16.4 12.7c0-2 1.6-3 1.7-3.1-1-1.5-2.5-1.7-3-1.7-1.3-.1-2.5.8-3.2.8-.6 0-1.6-.8-2.7-.7-1.4 0-2.7.8-3.4 2-1.4 2.5-.4 6.2 1 8.2.6 1 1.4 2 2.5 1.9 1 0 1.4-.6 2.7-.6 1.2 0 1.6.6 2.7.6s1.8-1 2.5-1.9c.8-1.1 1.1-2.2 1.1-2.3-.1 0-1.9-.7-1.9-3.2ZM14.3 6.6c.6-.8 1-1.8.9-2.9-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-1 2.8 1 .1 2.1-.5 2.8-1.3Z"/></svg>:security.ticker==='MSFT'?<span className="microsoft-mark"><i/><i/><i/><i/></span>:security.ticker==='GOOGL'?<b className="google-mark">G</b>:security.ticker.slice(0,security.ticker.length>5?1:2)}{src&&<img className="stock-logo-image" src={src} alt="" loading="lazy" decoding="async" onError={e=>{e.currentTarget.hidden=true;}}/>}</span>;
}
export function PageTitle({title,subtitle,children}:{title:string;subtitle?:string;children?:ReactNode}){return <div className="page-heading"><div><h1>{title}</h1>{subtitle&&<p>{subtitle}</p>}</div><div className="heading-actions">{children}</div></div>;}
export function SectionTitle({title,to,action='View all',children}:{title:string;to?:string;action?:string;children?:ReactNode}){return <div className="section-heading"><h2>{title}</h2>{to?<Link className="text-link" to={to}>{action}<ArrowUpRight size={16}/></Link>:children}</div>;}
export function Loading({full=false}:{full?:boolean}){return <div className={full?'loading-full':'loading-block'} role="status"><LoaderCircle className="spin" size={25}/><span>Bringing your picture together…</span>{!full&&<div className="skeleton-lines"><i/><i/><i/></div>}</div>;}
export function ErrorState({error,retry}:{error:unknown;retry?:()=>void}){return <div className="empty-state error-state" role="alert"><AlertCircle size={30}/><h2>That didn’t come through.</h2><p>{error instanceof Error?error.message:'Please try again in a moment.'}</p>{retry&&<Button variant="secondary" onClick={retry}>Try again</Button>}</div>;}
export function EmptyState({title='Room to grow.',description,action,to}:{title?:string;description:string;action?:string;to?:string}){return <div className="empty-state"><div className="empty-icon"><Sprout size={34}/></div><h2>{title}</h2><p>{description}</p>{action&&to&&<Link className="button primary" to={to}>{action}<ArrowRight size={16}/></Link>}</div>;}
export function Modal({title,children,onClose,wide=false}:{title:string;children:ReactNode;onClose:()=>void;wide?:boolean}){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{const dialog=ref.current;dialog?.showModal();return()=>dialog?.close();},[]);
 return <dialog ref={ref} className={`modal ${wide?'wide':''}`} onCancel={onClose} onClick={e=>{if(e.target===e.currentTarget)onClose();}}><div className="modal-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><X size={20}/></button></div>{children}</dialog>;
}
export function Bloom({className=''}:{className?:string}){return <svg className={`bloom ${className}`} viewBox="0 0 220 230" fill="none" aria-hidden="true"><path d="M113 201c-2-35-1-75 6-110" stroke="#525d32" strokeWidth="3" strokeLinecap="round"/><path d="M110 176c-34-2-53-15-56-35 30-4 51 7 56 35Z" fill="#c2dc75"/><path d="M113 154c10-29 32-45 56-40-7 28-24 43-56 40Z" fill="#9db557"/><path d="M109 18c17-17 41-5 40 16 27-9 43 14 27 37 29 4 30 33 4 45 17 23-1 46-27 34 0 27-28 35-42 11-16 23-43 13-39-13-27 10-45-15-27-36C18 103 23 74 50 71 34 49 53 26 76 37 79 10 100 7 109 18Z" fill="#b8a0e4"/><path d="M105 59c5-3 12-3 17 0m-17 45c5 3 12 3 17 0m-32-24c0-5 2-9 6-12m44 12c0-5-2-9-6-12" stroke="#9b81cc" strokeWidth="1.5"/><ellipse cx="113" cy="82" rx="27" ry="28" fill="#daf65d"/><path d="M101 85c5 11 18 11 24 0" stroke="#384224" strokeWidth="2.5" strokeLinecap="round"/><circle cx="103" cy="75" r="2.5" fill="#384224"/><circle cx="123" cy="75" r="2.5" fill="#384224"/><path d="M80 211c22-12 45-12 67-1" stroke="#d3d6c7" strokeWidth="2" strokeLinecap="round"/></svg>;}
