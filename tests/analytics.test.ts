import { test } from 'node:test';
import assert from 'node:assert/strict';
import { portfolioTotals, timeWeightedReturns, riskMetrics, xirr, reconstructHistory } from '../shared/analytics.ts';
import type { Holding, Transaction } from '../shared/types.ts';
const stock = { id:'US:NASDAQ:AAPL',ticker:'AAPL',name:'Apple',exchange:'NASDAQ',currency:'USD',country:'US',assetClass:'US equity',sector:'Technology',color:'#000',price:120,previousClose:110,indices:[],asOf:'2026-01-01',source:'test' } as const;
const holding = {id:'h1',security:stock,broker:'INDmoney',accountId:'a',quantity:10,averagePrice:100} as unknown as Holding;
test('native prices are converted once and daily return uses previous market value',()=>{
 const t=portfolioTotals([holding],80,'INR'); assert.equal(t.value,96000); assert.equal(t.invested,80000); assert.equal(t.gain,16000); assert.ok(Math.abs(t.dailyPercent-9.090909)<.00001);
 assert.equal(portfolioTotals([holding],80,'USD').value,1200);
});
test('missing FX never generates a misleading mixed-currency total',()=>{assert.throws(()=>portfolioTotals([holding],0,'INR'),/exchange rate/i)});
test('deposits do not masquerade as investment performance',()=>{const r=timeWeightedReturns([{date:'2026-01-01',value:100,invested:100,netFlow:100},{date:'2026-01-02',value:200,invested:200,netFlow:100},{date:'2026-01-03',value:220,invested:200,netFlow:0}]);assert.equal(r[1].return,0);assert.ok(Math.abs(r[2].return-10)<1e-8)});
test('drawdown is measured from the previous peak and insufficient history hides annual metrics',()=>{const m=riskMetrics([{date:'2026-01-01',value:100,invested:100,netFlow:0},{date:'2026-01-02',value:120,invested:100,netFlow:0},{date:'2026-01-03',value:90,invested:100,netFlow:0}]);assert.equal(m.maxDrawdown,-25);assert.equal(m.volatility,null);assert.equal(m.cagr,null)});
test('XIRR annualizes dated cash flows and rejects flows with no sign change',()=>{assert.ok(Math.abs(xirr([{date:'2025-01-01',amount:-1000},{date:'2026-01-01',amount:1100}])!-.1)<1e-6);assert.equal(xirr([{date:'2025-01-01',amount:100}]),null)});
test('reconstruction holds historical quantities and accounts for splits, dividends, fees and withdrawals',()=>{
 const base={broker:'Manual',accountId:'a',currency:'INR',ticker:'ABC',name:'ABC',price:0,quantity:0} as const;
 const tx=[{...base,id:'1',date:'2026-01-01',type:'Deposit',amount:1000},{...base,id:'2',date:'2026-01-01',type:'Buy',securityId:'ABC',amount:500,quantity:5,price:100},{...base,id:'3',date:'2026-01-02',type:'Split',securityId:'ABC',amount:0,splitRatio:2},{...base,id:'4',date:'2026-01-02',type:'Dividend',amount:20},{...base,id:'5',date:'2026-01-02',type:'Fee',amount:5},{...base,id:'6',date:'2026-01-02',type:'Withdrawal',amount:100}] as Transaction[];
 const h=reconstructHistory(tx,[{date:'2026-01-01',prices:{ABC:100},USDINR:80},{date:'2026-01-02',prices:{ABC:55},USDINR:80}]);assert.equal(h[0].value,1000);assert.equal(h[1].value,965);assert.equal(h[1].netFlow,-100);assert.equal(h[1].invested,900);
});
test('reconstruction refuses missing historical prices',()=>{const tx=[{id:'1',date:'2026-01-01',type:'Buy',securityId:'ABC',ticker:'ABC',name:'ABC',broker:'Manual',accountId:'a',quantity:1,price:100,amount:100,currency:'INR'}] as Transaction[];assert.throws(()=>reconstructHistory(tx,[{date:'2026-01-01',prices:{},USDINR:80}]),/price/i)});
