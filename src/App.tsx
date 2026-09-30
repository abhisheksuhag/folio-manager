import { Component, type ReactNode } from 'react';
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './lib/api';
import { Shell } from './components/Shell';
import { Landing } from './pages/Landing';
import { Auth } from './pages/Auth';
import { Dashboard } from './pages/Dashboard';
import { Portfolio } from './pages/Portfolio';
import { Explore, IndexPage, StockDetail } from './pages/Research';
import { Watchlists } from './pages/Watchlists';
import { Intelligence } from './pages/Intelligence';
import { Settings } from './pages/Settings';
class ErrorBoundary extends Component<{children:ReactNode},{error:Error|null}>{state={error:null as Error|null};static getDerivedStateFromError(error:Error){return {error};}render(){if(this.state.error)return <div className="loading-full"><h1>A little pause.</h1><p>The page hit an unexpected problem. Reload to try again.</p><button className="button primary" onClick={()=>window.location.reload()}>Reload Folio</button></div>;return this.props.children;}}
export default function App(){return <ErrorBoundary><QueryClientProvider client={queryClient}><BrowserRouter><Routes><Route path="/" element={<Landing/>}/><Route path="/login" element={<Auth/>}/><Route path="/register" element={<Auth register/>}/><Route path="/onboarding" element={<Navigate to="/app/settings" replace/>}/><Route path="/app" element={<Shell/>}><Route index element={<Dashboard/>}/><Route path="portfolio" element={<Portfolio/>}/><Route path="holdings" element={<Navigate to="/app/portfolio" replace/>}/><Route path="explore" element={<Explore/>}/><Route path="markets" element={<Navigate to="/app/explore" replace/>}/><Route path="index/:id" element={<IndexPage/>}/><Route path="stock/:id" element={<StockDetail/>}/><Route path="watchlists" element={<Watchlists/>}/><Route path="transactions" element={<Navigate to="/app/portfolio" replace/>}/><Route path="ai" element={<Intelligence/>}/><Route path="settings" element={<Settings/>}/><Route path="*" element={<div className="empty-state"><h1>This path is a little off track.</h1><Link className="button primary" to="/app">Back to your overview</Link></div>}/></Route><Route path="*" element={<div className="empty-state"><h1>This page hasn’t taken root.</h1><Link className="button primary" to="/">Back to Folio</Link></div>}/></Routes></BrowserRouter></QueryClientProvider></ErrorBoundary>}
