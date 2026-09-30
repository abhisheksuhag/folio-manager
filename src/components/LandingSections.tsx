import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, Check, ChevronDown, FileText, Layers3, Search, Sprout } from 'lucide-react';

/** Original botanical artwork: separate accounts growing into one workspace. */
export function PortfolioGarden(){
  return <figure className="portfolio-garden">
    <svg viewBox="0 0 1080 320" role="img" aria-label="Indian stocks, US stocks, and funds connected to one growing portfolio">
      <ellipse cx="539" cy="285" rx="174" ry="13" fill="#dfe4cc"/>
      <path d="M30 245C182 197 239 276 383 226S704 183 824 239s169 13 226-11" fill="none" stroke="#d1d8bc"/>
      <path d="M286 119c116 0 57 140 177 140M796 101c-117 0-54 154-171 154" stroke="#9ca983" strokeWidth="1.5" strokeDasharray="4 7" fill="none"/>
      <g transform="translate(112 46) rotate(-8 92 73)">
        <rect x="4" y="8" width="174" height="136" rx="8" fill="#dce0cb"/>
        <rect width="174" height="136" rx="8" fill="#fffdf4" stroke="#cbd3b8"/>
        <rect x="16" y="16" width="29" height="29" rx="7" fill="#dafa58"/>
        <path d="M25 35v-9m6 9V22m6 13v-6" stroke="#475435" strokeWidth="2" strokeLinecap="round"/>
        <text x="56" y="35" fill="#343d2a" fontSize="12" fontWeight="600">Indian stocks</text>
        <path d="M17 75h139M17 99h139" stroke="#e2e4d8"/>
        <text x="17" y="68" fill="#6a735c" fontSize="10">Your companies</text>
        <text x="17" y="92" fill="#6a735c" fontSize="10">Your long-term plans</text>
        <text x="17" y="119" fill="#52693b" fontSize="10">Upstox</text>
        <circle cx="150" cy="115" r="4" fill="#a5ba79"/>
      </g>
      <g transform="translate(793 32) rotate(9 87 72)">
        <rect x="4" y="8" width="174" height="136" rx="8" fill="#dcd6e4"/>
        <rect width="174" height="136" rx="8" fill="#fffdf4" stroke="#cec5dd"/>
        <rect x="16" y="16" width="29" height="29" rx="7" fill="#e4d8f3"/>
        <circle cx="30" cy="30" r="9" fill="none" stroke="#77598f"/>
        <path d="M21 30h18m-9-9c-7 6-7 12 0 18 7-6 7-12 0-18" fill="none" stroke="#77598f"/>
        <text x="56" y="35" fill="#343d2a" fontSize="12" fontWeight="600">US investments</text>
        <path d="M17 75h139M17 99h139" stroke="#e2e4d8"/>
        <text x="17" y="68" fill="#6a735c" fontSize="10">A wider world</text>
        <text x="17" y="92" fill="#6a735c" fontSize="10">One familiar view</text>
        <text x="17" y="119" fill="#77598f" fontSize="10">INDmoney</text>
        <circle cx="150" cy="115" r="4" fill="#b5a0d5"/>
      </g>
      <g className="garden-leaves">
        <path d="M540 229c-1-72 3-112 0-161m0 124c-18-40-40-55-74-75m76 40c25-49 54-72 88-83" fill="none" stroke="#657b40" strokeWidth="4" strokeLinecap="round"/>
        <path d="M540 132c-61-8-88-59-63-104 49 9 81 48 63 104Z" fill="#dafa58" stroke="#a3b95e"/>
        <path d="M540 132c-21-39-39-65-63-104" fill="none" stroke="#a6be5b"/>
        <path d="M541 178c10-69 73-104 128-81-14 56-67 93-128 81Z" fill="#b5a0df" stroke="#9d86c7"/>
        <path d="M541 178c45-39 85-63 128-81" fill="none" stroke="#9275bb"/>
        <path d="M527 193c-77 3-110-39-105-84 58-3 101 27 105 84Z" fill="#b9cc8c" stroke="#97af67"/>
        <path d="M527 193c-37-43-71-67-105-84" fill="none" stroke="#8da65a"/>
        <path d="M546 102c-1-54 27-81 70-82 8 44-18 76-70 82Z" fill="#ebd1a7" stroke="#d3b58a"/>
        <path d="M546 102c22-36 44-60 70-82" fill="none" stroke="#c5a779"/>
      </g>
      <path d="M478 218h126l-15 60c-27 15-70 15-97 0Z" fill="#e7ddf0" stroke="#b9aacb"/>
      <path d="M498 224l9 52m22-52 3 58m20-58-3 58m24-58-9 52m22-52-9 45" stroke="#c8b9d7" strokeWidth="2"/>
      <rect x="469" y="207" width="143" height="19" rx="7" fill="#eee6f5" stroke="#b9aacb"/>
      <g transform="translate(346 227) rotate(-13)"><rect width="104" height="36" rx="18" fill="#f8eddb" stroke="#d8c5a4"/><text x="52" y="23" textAnchor="middle" fontSize="11" fill="#776044">Funds, too.</text></g>
      <g transform="translate(643 222) rotate(8)"><rect width="127" height="36" rx="18" fill="#f8f7ef" stroke="#bdc8a6"/><text x="63" y="23" textAnchor="middle" fontSize="11" fill="#52643e">Room to grow.</text></g>
      <path d="m364 64 4 10 10 4-10 4-4 10-4-10-10-4 10-4Zm368 97 3 8 8 3-8 3-3 8-3-8-8-3 8-3Z" fill="none" stroke="#889572" strokeWidth="1.5"/>
    </svg>
    <figcaption>Different roots. One growing picture.</figcaption>
  </figure>;
}

const steps=[
  {Icon:FileText,title:'Bring your investments.',text:'Connect a supported broker or import a statement. Start with what you already own.',label:'Connect or import'},
  {Icon:Layers3,title:'Find your bearings.',text:'See your holdings, allocation, and returns together. Keep the source of every number in view.',label:'See the whole picture'},
  {Icon:Search,title:'Follow a good question.',text:'Look inside a fund, explore a company, or save an idea for another day.',label:'Stay curious'},
];
export function GettingStarted(){
  return <section className="landing-start" id="how-it-works" aria-labelledby="start-title">
    <div className="start-heading"><h2 id="start-title">A little less setup.<br/><span>A lot more perspective.</span></h2><p>You don’t need another spreadsheet habit.<br/>Just a place to start.</p></div>
    <ol className="start-steps">{steps.map(({Icon,title,text,label},i)=><li key={title}>
      <div className="step-drawing"><span><Icon size={27} strokeWidth={1.4} aria-hidden="true"/></span>{i<2&&<svg viewBox="0 0 160 30" aria-hidden="true"><path d="M3 18C45-3 93 33 150 12m-12-5 12 5-9 10"/></svg>}</div>
      <h3>{title}</h3><p>{text}</p><span className="step-caption"><Check size={13} aria-hidden="true"/>{label}</span>
    </li>)}</ol>
    <Link to="/register" className="text-link">Find your starting point <ArrowRight size={17}/></Link>
  </section>;
}

const mixes={
  sectors:[{name:'Technology',weight:40,color:'#b5a0df'},{name:'Financial services',weight:30,color:'#c5db83'},{name:'Healthcare',weight:20,color:'#e8c795'},{name:'Other sectors',weight:10,color:'#93b6ac'}],
  markets:[{name:'India',weight:55,color:'#c5db83'},{name:'United States',weight:30,color:'#b5a0df'},{name:'Other markets',weight:15,color:'#e8c795'}],
};
export function FundPreview(){
  const [by,setBy]=useState<'sectors'|'markets'>('sectors');const rows=mixes[by];
  return <section className="landing-fund" aria-labelledby="fund-preview-title">
    <div className="fund-preview-copy"><span className="fund-paper-icon"><Layers3 size={33} strokeWidth={1.3} aria-hidden="true"/></span><h2 id="fund-preview-title">There’s more<br/>inside the label.</h2><p>A fund can hold a whole world of companies. See what’s underneath, how the pieces are weighted, and where your money is exposed.</p><p className="fund-preview-note">Holdings and allocations appear when the provider supplies them, with report dates and missing coverage clearly shown.</p><Link to="/register" className="text-link">Get to know what you own <ArrowUpRight size={17}/></Link></div>
    <div className="fund-preview-art">
      <span className="fund-margin-note">a closer look<svg viewBox="0 0 80 45" aria-hidden="true"><path d="M3 3c40-5 65 8 60 33m-9-9 9 9 10-11"/></svg></span>
      <div className="fund-sample-sheet">
        <div className="fund-sheet-heading"><span><Sprout size={17} aria-hidden="true"/>A fund, unfolded.</span><small>Illustrative example</small></div>
        <div className="fund-mix-switch" role="group" aria-label="Example fund breakdown"><button onClick={()=>setBy('sectors')} aria-pressed={by==='sectors'}>Sector mix</button><button onClick={()=>setBy('markets')} aria-pressed={by==='markets'}>Market mix</button></div>
        <div className="fund-mix-mosaic" aria-hidden="true">{rows.map(row=><div key={row.name} style={{flex:row.weight,background:row.color}}><span>{row.weight}%</span></div>)}</div>
        <div className="fund-mix-rows" aria-live="polite">{rows.map(row=><div key={row.name}><i style={{background:row.color}}/><span>{row.name}</span><strong>{row.weight}%</strong></div>)}</div>
        <div className="fund-sheet-foot"><Check size={13} aria-hidden="true"/>The pieces behind the percentage.</div>
      </div>
      <span className="fund-art-seal"><Search size={23} strokeWidth={1.5} aria-hidden="true"/>Stay<br/>curious.</span>
    </div>
  </section>;
}

const faqs=[
  ['Can I look around before connecting anything?','Yes. The demo opens an illustrative portfolio so you can explore holdings, research, and allocation without linking a broker. When you create your own workspace, it starts empty.'],
  ['What can I bring into Folio?','Connect supported Upstox, INDmoney, or Binance accounts, or use a supported CSV statement. Available holdings and research depend on the connection and the data your provider supplies.'],
  ['Can Folio make trades or move my money?','No. Folio is a tracker and research workspace. It reads investment data; it does not place orders or transfer money. Broker credentials stay encrypted on the server.'],
  ['Will linked Upstox holdings appear twice?','Upstox-tagged holdings mirrored through INDmoney are excluded. Connect Upstox directly for those positions. Genuine positions at other brokers are kept separately.'],
  ['Is everything live, all the time?','Data freshness depends on the provider and your latest sync. Folio shows sources and observation dates, and labels saved or unavailable data rather than filling the gaps with invented numbers.'],
];
export function LandingFaq(){
  return <section className="landing-faq" aria-labelledby="faq-title"><div><h2 id="faq-title">A few things<br/><span>you might wonder.</span></h2><p>Clarity starts before<br/>you connect a thing.</p><svg className="faq-sprig" viewBox="0 0 180 140" aria-hidden="true"><path d="M33 127C79 99 76 43 144 14" stroke="#8f9f6a" strokeWidth="2" fill="none"/><path d="M81 83C32 84 30 48 40 29c40 8 47 27 41 54Z" fill="#d6e3aa"/><path d="M93 62c3-38 41-58 64-49-5 35-26 51-64 49Z" fill="#b5a0df"/><path d="M56 112c26-43 61-29 70-12-21 23-44 25-70 12Z" fill="#e8c795"/></svg></div><div className="faq-list">{faqs.map(([question,answer])=><details key={question}><summary>{question}<ChevronDown size={18} aria-hidden="true"/></summary><p>{answer}</p></details>)}</div></section>;
}
